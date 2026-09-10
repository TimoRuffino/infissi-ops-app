# Staging con dati demo e accesso di prova permanente — design

Data: 2026-09-10 · Stato: approvato per esecuzione · Piano: `docs/superpowers/plans/2026-09-10-staging-demo.md`

## Problema

Oggi ogni push su `main` è un deploy in produzione (`docs/runbooks/multi-azienda.md:31`).
Le modifiche UI arrivano ai clienti senza che nessuno le abbia viste in un
browser contro un server vero: i tre crash React in produzione e il bug della
cornice sono passati così. Il runbook multi-azienda nomina «staging» in
quattro punti (`multi-azienda.md:299,643,653,991`) come luogo dove far
nascere le aziende di prova, ma l'ambiente non è mai stato creato.

## Obiettivo

Un ambiente Railway «staging» separato dalla produzione, con:

1. **dati demo** seminati da soli al primo avvio su database vuoto;
2. **accesso di prova permanente**: un link con token che apre una sessione
   da utente demo senza digitare password (gli agenti non possono digitarne);
3. **zero effetti esterni**: staging non parla mai con IMAP, Fatture in
   Cloud/SdI, Google Drive, Meta, Resend, OpenAI;
4. la possibilità di accendere **ambienti per PR** (Railway PR environments)
   sopra lo stesso meccanismo, senza altro codice.

## Non obiettivi

- Copiare dati di produzione in staging (vietato: vedi rischio R2).
- Un secondo giro OAuth (FiC, Drive, WhatsApp) su dominio staging: i
  callback sono registrati presso i fornitori per il solo dominio di
  produzione e non si derivano mai dall'header `Host` (guardia
  `server/integrazioni/guardie.test.ts`).
- Test end-to-end Playwright (punto 17 della lista direzione: lavoro
  separato che questo ambiente abilita).
- Repliche multiple: vale anche in staging il vincolo di UNA replica
  (`docs/runbooks/verifica-produzione-readonly.md:13`).

## Fatti che vincolano il design

- **`NODE_ENV` deve valere `production` anche in staging.** I 25 interruttori
  sono fail-closed: un `NODE_ENV` «staging» o assente vale produzione = tutto
  spento (`server/platform/interruttori.ts:129-135`), ma i gate di sicurezza
  su `JWT_SECRET` (`server/localAuth.ts:15`) e `BOOTSTRAP_ADMIN_PASSWORD`
  (`server/routers/utenti.ts:83-94`) scattano solo con `production` esatto.
  Un ambiente con `NODE_ENV` assente girerebbe col segreto JWT di sviluppo
  hardcoded. Quindi: l'identità dell'ambiente NON passa da `NODE_ENV`.
- **Quattro giri di fondo partono senza interruttore** e toccano servizi
  esterni veri: scheduler backup Drive (`server/_core/index.ts:189`), sync
  FiC (`:193`), sonda SdI (`:197`), poller IMAP (`:201`). Con un database
  vuoto non trovano credenziali, ma se qualcuno ripristinasse in staging un
  backup di produzione leggerebbero caselle vere e scriverebbero sul Drive
  vero entro 60 secondi.
- `railway.json:8` (`pnpm start`, che imposta `NODE_ENV=production`) e
  `nixpacks.toml:15` (`node dist/index.js`, che NON lo imposta) dicono cose
  diverse: un ambiente nuovo che partisse dal solo nixpacks avrebbe
  `NODE_ENV` assente.
- Se la `PORT` è occupata il server scivola in silenzio su `PORT+1…+20`
  (`server/_core/index.ts:434-439`) e l'healthcheck Railway non trova nessuno.
- Non esiste alcun seed demo: le launch config «demo» creano solo l'admin di
  bootstrap; `seedDemo()` di `server/routers/timeline.ts:306` completa solo
  la timeline della commessa 1, se esiste.
- Il seed dell'admin è vincolato a `firstBoot && items.length === 0`
  (`server/routers/utenti.ts:121`): ogni nuovo seed deve rispettare la stessa
  condizione per non riscrivere dati veri dopo un flake DNS.
- Senza `RESEND_API_KEY` la posta di piattaforma non parte e il pannello
  mostra il link d'invito da copiare (`server/_core/postaPiattaforma.ts`):
  in staging è il comportamento desiderato, non un guasto.
- Su Railway senza volume il driver storage `local` rifiuta i `putFile` a
  meno di `STORAGE_ALLOW_EPHEMERAL=1` (`server/_core/fileStorage.ts:548-558`).
- Tars senza `TARS_PROVIDER=openai` + `OPENAI_API_KEY` usa il provider finto
  (`server/tars/costi/providerGovernato.ts:47-69`): i flussi UI restano
  testabili senza spendere un centesimo.

## Decisioni

**D1 — L'identità dell'ambiente è una variabile nuova, `AMBIENTE`.**
Letta in un solo modulo, `server/_core/ambiente.ts`, che espone
`ambienteStaging(): boolean`, vero solo per il valore esatto `staging`
(stesso stile fail-closed degli interruttori: qualunque altro valore, o
l'assenza, vale produzione). Nessun altro file legge `process.env.AMBIENTE`.

**D2 — In staging i quattro giri esterni non partono.**
Le quattro partenze escono da `index.ts` e si spostano in
`server/_core/giriEsterni.ts` (`avviaGiriEsterni()`), che in staging fa
early-return con una riga di log. Così anche un futuro ripristino di un
backup di produzione in staging (punto 7 della lista direzione: prove di
ripristino mensili) resta inerte. I worker interni (promemoria, eventi,
Centro Azioni, comandi tenant) restano accesi: servono a provare il prodotto.
In più, in staging ogni risposta porta `X-Robots-Tag: noindex, nofollow`.

**D3 — L'accesso di prova è un link con token, non una password.**
Rotta Express anonima `GET /api/staging/entra?token=…`, montata SOLO se
`ambienteStaging()` e `STAGING_ACCESSO_TOKEN` è impostata. Confronto in tempo
costante; su esito buono apre la sessione dell'utente demo (l'admin di
bootstrap, `BOOTSTRAP_ADMIN_EMAIL`) con `apriSessioneLocale`
(`server/localAuth.ts:176`) e redirige a `/`. Qualunque fallimento risponde
404 senza dettagli. Il JWT dura 7 giorni ma il link ri-autentica ogni volta:
è questo l'«accesso che non scade». In produzione la rotta non esiste
(gate doppio: ambiente + token), con guardia strutturale nei test.

**D4 — I dati demo nascono al boot, solo su store vuoti.**
`server/staging/semeDemo.ts`, invocato da `startServer()` dopo
`bootstrapAll`/`completaTenants`, dentro `conTenant(TENANT_PREDEFINITO_ID)`.
Condizione: `ambienteStaging()` E store `clienti` e `commesse` entrambi
vuoti (stessa filosofia del seed admin). Il seme usa SOLO i percorsi di
dominio esistenti: `createClienteFromSync` (`server/routers/clienti.ts:96`)
e `creaCommessa` (`server/routers/commesse.ts:695`), mai push a mano di
record inventati. Le date sono sempre relative a `new Date()` (mai fisse:
`[[test-bombe-a-orologeria]]`). Contenuto v1: 6 clienti (2 con Ragione
sociale) e 6 commesse con prodotti, importi e priorità realistici da
serramentista. Estensioni (preventivi, interventi, fatture) sono incrementi
futuri dello stesso modulo.

**D5 — Storage effimero in v1.**
`STORAGE_ALLOW_EPHEMERAL=1`: gli upload funzionano, i file muoiono a ogni
deploy. Accettabile per un ambiente di verifica; il passaggio a un bucket
R2 `wyndoor-staging` dedicato è un'operazione solo-Railway documentata nel
runbook, senza modifiche di codice.

**D6 — Il banner d'ambiente è servito dal server.**
Nuova procedura pubblica `system.ambiente` → `{ staging: boolean }`.
Componente client `BannerAmbiente` sul modello di `AvvisoAzienda`
(`client/src/components/abbonamento/AvvisoAzienda.tsx`), montato negli
stessi due punti (`ModularControlLayout.tsx:233`,
`LegacyDashboardLayout.tsx:457`): fascia sottile, token semantici `warning`,
non chiudibile, `role="status"`. In produzione la query risponde
`staging:false` e il componente non rende nulla.

**D7 — Deploy allineato e porta fissa.**
`nixpacks.toml` passa a `cmd = "pnpm start"` (identico a `railway.json`).
In produzione/Railway la porta non scansiona più: o si lega a `PORT` o il
processo esce e il restart policy fa il suo lavoro; la scansione resta solo
in sviluppo locale.

**D8 — Ambienti per PR: solo configurazione Railway.**
Con D1–D7 a terra, gli ambienti per PR sono una levetta Railway (PR
environments che forkano l'ambiente `staging`): ogni PR riceve servizio +
Postgres nuovi e vuoti, il seme demo gira da solo, il link d'accesso usa lo
stesso token. Nessun codice in più. La creazione dell'ambiente `staging`,
le variabili e la levetta PR sono operazioni manuali su Railway, dichiarate
nel runbook e MAI presentate come concluse dal codice.

## Variabili dell'ambiente staging (runbook)

| Variabile | Valore in staging |
|---|---|
| `AMBIENTE` | `staging` |
| `DATABASE_URL` | riferimento al Postgres di staging (mai quello di produzione) |
| `JWT_SECRET` | casuale, ≥32 caratteri, diverso dalla produzione |
| `MAIL_ENCRYPTION_KEY` | casuale, diversa dalla produzione |
| `BOOTSTRAP_ADMIN_EMAIL` | `demo@wyndoor.com` |
| `BOOTSTRAP_ADMIN_PASSWORD` | casuale forte (≥12), custodita fuori dal repo |
| `BOOTSTRAP_ADMIN_NAME` / `_SURNAME` | `Demo` / `Wyndoor` |
| `PLATFORM_ADMIN_EMAILS` | `demo@wyndoor.com` |
| `APP_BASE_URL` | dominio staging (es. `https://staging.wyndoor.com` o quello generato da Railway) |
| `STAGING_ACCESSO_TOKEN` | casuale, ≥32 caratteri |
| `STORAGE_ALLOW_EPHEMERAL` | `1` (v1; poi bucket R2 dedicato) |
| `FLAG_*` | specchio colonna-per-colonna dei flag accesi in produzione (`handoff.md` §11-sexdecies), incluso `FLAG_MULTI_AZIENDA=on` |
| **MAI impostate** | `RESEND_API_KEY`, `OPENAI_API_KEY`, `TARS_PROVIDER`, `FIC_OAUTH_*`, `GOOGLE_OAUTH_*`, `GOOGLE_SERVICE_ACCOUNT_*`, `WHATSAPP_*`, `VAPID_*`, `S3_*` (finché non nasce il bucket staging), `FATTURAZIONE_SDI_DRY_RUN` (resta acceso di default) |

## Rischi e mitigazioni

- **R1 — La rotta d'accesso finisce accesa in produzione.** Doppio gate
  (`AMBIENTE=staging` esatto + token presente), guardia strutturale che
  verifica il montaggio condizionato, 404 opaco, confronto in tempo costante,
  nessun log del token.
- **R2 — Dati di produzione in staging.** D2 rende inerti i giri esterni,
  ma la regola resta organizzativa e va scritta nel runbook: in staging non
  si ripristinano backup di produzione contenenti credenziali vere senza
  prima azzerare `caselle_email` e le integrazioni. (La prova di ripristino
  mensile del punto 7 userà questo stesso ambiente: D2 è il prerequisito.)
- **R3 — Il seme demo gira in produzione.** Gate `ambienteStaging()` +
  store vuoti: in produzione gli store non sono vuoti e l'ambiente non è
  staging. Test di idempotenza: due esecuzioni consecutive non duplicano.
- **R4 — Scostamento fra staging e produzione.** Stesso branch di build,
  stesso `railway.json`, stessi flag: le uniche differenze ammesse sono le
  variabili della tabella. Il runbook impone di aggiornare staging quando si
  aggiunge una variabile in produzione (voce nella Definizione di completato
  del runbook).
