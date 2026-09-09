# WS6 — Pannello Piattaforma: aziende, abbonamenti, inviti e audit dall'app (spec tecnica)

Sesto workstream del SaaS multi-azienda (design madre
`docs/superpowers/specs/2026-09-06-saas-multi-azienda-design.md`, §6.2, §9,
§11, §12.1, §15, §17 punto 6). Nasce il 09/09/2026, il giorno in cui WS3 e WS4
sono andati su `main` e `FLAG_MULTI_AZIENDA` è stato acceso in produzione.
Branch `feature/ws6-pannello-piattaforma` da `main` 37c1889.

## 1. Obiettivo, perimetro, non-obiettivi

**Obiettivo.** Chi possiede la piattaforma (oggi la direzione di Ruffino
Group) gestisce tutte le aziende dall'app, senza riga di comando: elenco con
stato, abbonamento, spazio, Tars, guasti dei worker e ultimo backup; creazione
di un'azienda nuova con invito via email al proprietario; sospensione e
riattivazione; omaggio, proroga, budget Tars, extra, quota, tolleranze,
disdetta; proprietari; ricalcolo dello spazio; ripristino degli archivi; eventi
e comandi come traccia di ogni azione.

**Perimetro.**
- Una sezione `/piattaforma` nel CRM, visibile e apribile solo a chi ha la
  capacità di piattaforma (§3).
- Un router tRPC `piattaforma` che legge il control plane e scrive SOLO tramite
  i comandi di `tenant_comandi`, eseguiti subito dalla stessa funzione del giro
  dei 30 secondi (§5).
- La tabella `tenant_inviti`, la pagina pubblica `/invito/<token>` e il
  mittente transazionale della piattaforma (Resend via HTTP) (§6, §7).
- Documentazione: runbook, PRD §60.13, handoff, `CLAUDE.md`.

**Non-obiettivi (dichiarati, non dimenticati).**
- Stripe e ogni provider di pagamento: l'adattatore del WS4 resta «nessuno».
  La creazione automatica dal pagamento (§9 del design madre) chiamerà lo
  stesso `crea` e lo stesso invito di questa spec (§13).
- MFA per il Platform Admin (design madre §15): rimandata, vedi §2.
- Accesso di supporto alle aziende (impersonazione con motivazione, scadenza e
  audit): fuori. Il pannello non offre alcun percorso verso clienti, commesse,
  messaggi o documenti (§8).
- Reset password self-service, inviti agli utenti non proprietari, marchio del
  rivenditore, export aziendale: fuori (sono l'altra metà del WS5 del design
  madre). La tabella degli inviti nasce con un campo `tipo` per accoglierli.
- Cancellazione di un'azienda: fuori (oggi non esiste in nessun percorso).
- Un comando `pnpm tenant invita`: fuori. L'invito porta un segreto (il link)
  che non deve restare in `tenant_comandi`; lo consegna solo il pannello (§6.4).

## 2. Decisioni prese in chat (09/09/2026)

1. **Identità: stesso utente, potere in più.** Chi amministra la piattaforma è
   un utente attivo di Ruffino Group (tenant 1) la cui email compare in
   `PLATFORM_ADMIN_EMAILS`. È una **deviazione dichiarata** dal design madre
   (§6.2/§15/§18: identità separata fuori dallo store `utenti`, con MFA). Motivo:
   oggi la piattaforma ha una sola persona che la amministra ed è anche la
   proprietaria del tenant 1; un secondo login e un TOTP da costruire sono
   costo senza beneficio finché non esiste un secondo amministratore. Cosa resta
   del design: la capacità non si assegna dall'app (solo dal server), il pannello
   non vede dati business, ogni azione è registrata con l'autore, le azioni
   sensibili chiedono di reinserire la password. La MFA arriverà come passo
   proprio, per gli amministratori e per i proprietari delle aziende.
2. **Primo accesso del proprietario: invito via email con link.** Niente
   password provvisoria consegnata a mano: l'utente nasce con una password
   inutilizzabile e la sceglie da sé dalla pagina d'invito.
3. **Posta in uscita della piattaforma: servizio transazionale (Resend).**
   Mittente `no-reply@wyndoor.com`, chiave nell'ambiente, record DNS a carico
   della direzione. Senza chiave il flusso non si rompe: il pannello mostra il
   link da consegnare a mano.
4. **Esecuzione immediata dei comandi.** Il pannello registra il comando in
   `tenant_comandi` e lo esegue subito con la stessa funzione del giro dei 30
   secondi, prendendolo in carico in modo atomico; risponde con l'esito.
   Ricalcolo dello spazio e ripristino degli archivi restano in coda.

## 2-bis. Decisioni in corso d'opera

Il registro dell'esecuzione
(`.superpowers/sdd/2026-09-09-ws6-pannello-piattaforma/progress.md`) ha
prodotto tredici ruling, in ordine di apparizione: due prima del Task 1
(pre-flight, sul piano), otto durante la revisione dei task (R1…R8) e tre
dalla revisione finale del branch intero (R9…R11), chiusi in un'unica fix
wave. Ognuno con che cosa è stato deciso, perché, e il costo se la decisione
fosse sbagliata.

**Ruling pre-1.** La rotta `/piattaforma/:slug` la registra il Task 8 (con un
componente provvisorio, segnaposto per `AziendaDetail`, che rimanda
all'elenco) e il Task 9 la sostituisce per intero con la scheda vera. Motivo:
così il Task 8 chiude con rotte, menu e contratto delle rotte
(`routeContract.ts`) già coerenti, senza dover aspettare la scheda completa.
Costo se sbagliato: nessuno — è un ordine di consegna, non una scelta di
comportamento.

**Ruling pre-2.** `passwordSchema` di `server/routers/utenti.ts` diventa
`export const passwordSchema` (consumato dal Task 5 nel router pubblico
`inviti`), senza cambiarne testo né vincoli. Motivo: un solo schema di
validazione della password in tutto il repository, mai una seconda copia per
la pagina d'invito. Costo se sbagliato: nessuno.

**R1** (dopo la review del Task 1). `comandiDi`, `storageTutti` ed
`eventiRecenti` — le tre letture in blocco su Postgres — non erano mai state
esercitate contro un database vero: solo l'implementazione in memoria aveva
test. Il router del pannello (Task 6) costruisce l'elenco delle aziende
proprio su questi tre metodi, quindi la lacuna era a monte di tutto ciò che
segue. Deciso: tre test nuovi in `repository.pg.test.ts`, fatti SUBITO (Task 2
già chiuso, nessun conflitto) e prima di partire col Task 3. Esito: nessun bug
nel SQL, i tre metodi hanno passato i test al primo tentativo — la lacuna era
di copertura, non di correttezza. Costo se sbagliato: un test in più.

**R2** (dopo la review del Task 2). Il test «se il giro dei 30 s ha già preso
il comando, `eseguiComandoSubito` aspetta e restituisce la riga chiusa» non
provava nessuna attesa reale: il repository in MEMORIA non aveva alcun claim
sul comando in esecuzione (`FOR UPDATE SKIP LOCKED` esiste solo su Postgres),
quindi un secondo `prendiEdEsegui` concorrente poteva rieseguirlo invece di
aspettare. Deciso: (a) un insieme `inEsecuzione` nel repository in memoria,
così un comando già preso non viene ripreso da un secondo chiamante; (b) due
test con timer reali che provano davvero il ciclo di attesa e lo scadere di
`attesaMs`; (c) la fixture del ledger dei costi, duplicata fra i due
`describe` di `costi.test.ts`, portata a costanti condivise, e il confronto
sul tenant 1 in `ledger.pg.test.ts` allargato da uguaglianza stretta a `≥`
(tenant 1 è condiviso con `pgConcorrenza.test.ts`, che ci scrive sopra) —
fatti insieme perché nello stesso file. Costo se sbagliato: un test in più e
una simulazione più fedele; nessun rischio sul codice di produzione, che su
Postgres si comportava già correttamente.

**R3** (dopo la review del Task 3). `utenteAmministratore` e `tenants.mio`
consideravano amministratore chiunque avesse l'`id` numerico giusto, senza
controllare `loginMethod`: un utente OAuth legacy con lo stesso `id` numerico
di un amministratore locale sarebbe stato risolto contro lo store del tenant 1
e trattato come amministratore. Non sfruttabile oggi (OAuth è spento in
produzione e, a flag acceso, `createContext` scarta già gli utenti non
locali), ma un confine di sicurezza su cui i task successivi costruiscono.
Deciso: (a) `utenteAmministratore` richiede `loginMethod === "local"` **e**
`id` numerico, come già fa `risolviTenantPerUtente`
(`server/tenants/contesto.ts`); (b) `tenants.mio` chiama lo stesso helper
condiviso invece di rileggere lo store per conto proprio (elimina anche la
duplicazione fra `accesso.ts` e `router.ts`); (c) un test con un utente OAuth
dallo stesso `id` numerico → `null`/`FORBIDDEN`; (d) i fake timer del test del
limitatore spostati in `beforeEach`/`afterEach`. Costo se sbagliato: nessuno.

**R4** (dopo la review del Task 5). Nel catch di `inviti.accetta`, un errore
inatteso (per esempio un guasto del database) veniva scartato in silenzio e
diventava lo stesso `NOT_FOUND` di un token sbagliato: un bug vero sarebbe
stato indistinguibile da un token indovinato a caso. Deciso: se l'errore non è
`MESSAGGI_PIATTAFORMA.invitoNonValido`, loggare
`console.error("[inviti] accettazione fallita: <messaggio>")` — solo il
messaggio, mai il token — prima di rilanciare la stessa risposta di sempre
(nessun segnale in più per chi tenta di enumerare token); in più,
`attoreTesto({ tipo: "utente", id })` al posto di una stringa scritta a mano
per l'evento `invito_accettato`, e `__azzeraLimiteInvitiPerTest` per isolare i
test dal limitatore condiviso, per simmetria con `accesso.ts`. Costo se
sbagliato: una riga di log in più.

**R5** (dopo la review del Task 6). Lo sketch del brief indicava per
`ultimoBackup`/`backup` solo un sottoinsieme di campi (`finishedAt, ok, files,
bytes, target`), ma l'implementazione porta l'intero record di `BackupLog`
(`trigger`, `error`, `id` compresi). Deciso: accettata così com'è — nessun
segreto nel record, la scheda client lo usa già per intero, e duplicare il
tipo `BackupLog` solo per il pannello sarebbe stato un costo senza beneficio —
annotata qui e in §5.1. Costo se sbagliato: nessuno.

**R6** (dopo la review del Task 7). La mutation più rischiosa del router —
`ripristina` con `scrivi: true`, l'unico ramo davvero sensibile del comando —
non aveva nessun test sul cancello della password. Deciso: aggiungere in
`router.test.ts` password corretta → comando in coda; nessuna password o
password sbagliata → `UNAUTHORIZED` e nessun comando accodato; più quattro
lacune minori chiuse nello stesso giro (il ramo `revoca` di `proprietario` mai
esercitato, uno slug sconosciuto su ciascuna mutation → `NOT_FOUND`, l'evento
`invito_annullato` mai asserito, il campo `email` mancante nella fixture
`context()`). Fatto DOPO il Task 8 (un solo implementer alla volta sul codice
server; il Task 8 tocca solo client). Costo se sbagliato: nessuno.

**R7** (dopo la review del Task 8). `NuovaAziendaDialog` mostrava «Azienda
creata» e «Apri la scheda» anche quando il comando `crea` era finito in
`errore` (per esempio un'email già di un'altra azienda): un percorso
raggiungibile e previsto dalla spec §8, ma non guardato dal componente.
Deciso: titolo, descrizione e il pulsante «Apri la scheda» seguono
`comando.stato` (`esitoCreazione`, funzione pura e testata) — con `errore` o
`in_attesa` oltre il timeout diventa «Creazione non riuscita» con «Riprova»;
una guardia (`apertoRef`) ignora un esito arrivato dopo che il dialogo è stato
chiuso; nella pagina d'invito ogni errore di `anteprima` (token rifiutato da
zod compreso) mostra sempre il testo amichevole, mai il messaggio tecnico.
Fatto DOPO il Task 9 (stesso file `NuovaAziendaDialog.tsx` in lavorazione).
Costo se sbagliato: nessuno.

**R8** (dopo la review del Task 9). `AziendaDetail` seguiva UN solo comando
lungo alla volta: avviare un ricalcolo e poi, prima che si chiudesse, un
ripristino in prova faceva perdere il polling e il toast del primo (il
comando restava comunque accodato e si chiudeva sul server, ma senza più
nessuno che lo interrogasse). Deciso: i comandi lunghi si seguono in una mappa
per id (`SeguiComando`, un'istanza — e un polling — per id, mai un hook
condizionale); il gating del tenant 1 («Anche Ruffino Group») si applica anche
al ripristino vero, non solo alla sospensione; il ripiego morto
`eur: extraEur ?? 0` sull'extra Tars è sostituito da una guardia esplicita che
non accoda nulla senza un importo. `TENANT_PIATTAFORMA_ID` duplicato in due
file client e l'assenza di un invito a un indirizzo email libero (per
costruzione: `crea` semina sempre un proprietario) restano deferred alla
revisione finale del branch. Costo se sbagliato: nessuno.

**R9** (revisione finale del branch, Important I1). `invita` non chiedeva la
password e restituiva il `link` anche quando la posta era partita. La spec
§3.2 classificava l'invito fra le azioni non sensibili, ragionando sul fatto
che non cambia nulla nei dati; ma un link d'invito è la presa dell'account
del proprietario di un'altra azienda — chi ce l'ha sceglie la password ed
entra — e nessuno lo aveva guardato da lì. Obiezione accolta contro la spec.
Deciso: `invita` accetta `passwordConferma` e la verifica prima di emettere
qualunque token; il `link` esce verso il browser SOLO con `inviato === false`,
in `invita` e nell'invito che `crea` manda da sé — se la posta è partita il
token è già nella casella giusta e una seconda copia nella pagina
dell'amministratore è soltanto un'altra copia da rubare (cronologia,
screenshot, appunti). Lato client «Invia invito» passa dallo stesso dialogo
`ConfermaPassword` delle altre azioni. Costo se sbagliato: un campo in più
nel dialogo, e un link da rimandare invece che da rileggere.

**R10** (revisione finale, Important I2). Il runbook consigliava
`FLAG_MULTI_AZIENDA=off` come rollback, ma a interruttore spento
`createContext` fissa `tenantId = 1` per chiunque e `allowedSediForUser` non
guarda l'azienda: la sessione di un utente del tenant 2 lo porterebbe dentro
Ruffino Group, con tutte le sue sedi. Il difetto era già su `main` — solo che
prima creare una seconda azienda voleva dire una riga di comando, e dopo il
WS6 è un dialogo. Deciso: guardia di codice, non solo di documentazione. A
flag spento `auth.login` risponde `PRECONDITION_FAILED`
(`MESSAGGI.multiAziendaSpento`, «Accesso non disponibile: il multi-azienda
della piattaforma è spento.») **dopo** la verifica della password — senza
credenziali giuste non si scopre quali email appartengono a un'altra azienda
— e `createContext` tratta quella sessione come inesistente, con una riga
`[tenants] sessione rifiutata a interruttore spento (tenant <id>)`;
`inviti.anteprima` e `inviti.accetta` rifiutano allo stesso modo, senza
consumare il token. Il runbook dice che il rollback a `off` vale finché
l'unica azienda è il tenant 1: per fermarne una si sospende. Costo se
sbagliato: un login rifiutato a interruttore spento a un utente che comunque
non deve entrare.

**R11** (revisione finale, Important I3–I6 e i minori a buon mercato). Tutto
il resto della revisione finale, raccolto in una sola ondata perché nessuno
dei punti valeva un giro a sé. Documentazione: i tre banner «Stato al 08/09»
del runbook dicevano ancora che WS3 e WS4 non erano su `main` (I3) e la
sezione WS6 era accodata dopo le sezioni di coda invece che prima come le
altre (I4). Codice: un avviso al boot se `APP_BASE_URL` manca, con la base
mostrata accanto al link d'invito (I5); la scheda dell'azienda si rilegge
ogni 60 s invece di 15 e `schedaAzienda` dichiara di ricomporre l'elenco
intero per tenerne una riga (I6); `TENANT_PIATTAFORMA_ID` in un modulo client
solo; `key={slug}` sulla rotta della scheda; la password azzerata da
«Riprova»; l'indice parziale unico `tenant_inviti_valido_idx` con un
ritentativo in `emettiInvito`; `adesso` onorato dal driver Postgres degli
inviti; un limite di tentativi anche su `anteprima`, per indirizzo;
`payloadSenzaSegreti` applicato ai comandi che il pannello restituisce.
Restano deferred, dichiarati: il token dell'invito nella query string
(`anteprima` è una query e `httpBatchLink` la manda in GET: farne una
mutation è un cambio di contratto lato client, da fare a parte),
`RequirePiattaforma` senza test DOM, l'invito non annullato quando l'utente
viene disattivato, `tenants.mio` chiesto a tutti dal `UserMenu`. Costo se
sbagliato: nessuno — sono tutte scelte reversibili in un commit.

**Ancora aperti** (minori, lasciati deliberatamente fuori da questo
workstream — nessuno blocca il rilascio):

- `emettiInvito` non è auto-concorrente: due inviti emessi nello stesso
  istante per lo stesso utente potrebbero restare entrambi validi (idea
  proposta dal reviewer del Task 1: un indice parziale unico su
  `(tenant_id, utente_id) WHERE usato_il IS NULL AND annullato_il IS NULL`).
- In `ledger.pg.test.ts`, nel test di coerenza fra `consumoAziendeMese` e
  `consumoAziendaMese`, un confronto sul tenant 1 resta a uguaglianza stretta
  invece di `≥` (R2 ha corretto il confronto sulla somma condivisa, non
  questo secondo confronto puntuale): può soffrire di scritture concorrenti
  di `pgConcorrenza.test.ts`.
- `server/_core/postaPiattaforma.test.ts`: il ramo `AbortError` del timeout e
  una risposta 2xx senza corpo JSON non sono coperti da un test;
  `postaConfigurata() === true` non è asserito direttamente.
- `server/piattaforma/router.test.ts`: uno spy senza `restoreAllMocks`
  (innocuo: la repo finta viene azzerata a ogni test).
  `server/piattaforma/confine.test.ts`: l'allow-list dei path relativi resta
  fragile a eventuali sottocartelle (fragilità ereditata da prima del WS6).
- Client, `esitoCreazione` (`pages/piattaforma/testi.ts`): lo stato
  `"eseguito"` senza nota né invito produce una descrizione vuota — un caso
  che il server oggi non produce mai.
- Nessun invito a un indirizzo email libero dal pannello: `crea` semina
  sempre un proprietario, quindi non esiste oggi un percorso per invitare un
  indirizzo che non sia già un utente dell'azienda.
- **Il token dell'invito viaggia in GET.** `inviti.anteprima` è una query e
  `httpBatchLink` mette l'input nella query string: il token finisce nei log
  di accesso del proxy e nella cronologia del browser. Non è un buco (il
  token è monouso, dura sette giorni e chi apre il link ce l'ha già), ma
  farne una mutation è un cambio di contratto lato client: rimandato a parte.
  Nel frattempo `anteprima` ha il suo limite di tentativi per indirizzo (R11).
- **`RequirePiattaforma` non ha un test.** È una guardia di rendering con tre
  stati (attesa, permesso, rifiuto) e nel repository non esiste un harness
  `.test.tsx`: la logica pura sta in `piattaformaGateLabel`, testata, ma il
  componente che la usa no. La verità resta lato server
  (`piattaformaProcedure`), quindi il rischio è una pagina che lampeggia, non
  un accesso indebito.
- **Disattivare un utente non annulla i suoi inviti.** Un invito già emesso
  resta valido: chi lo accetta rimette `attivo = true` (è il modo in cui il
  proprietario entra la prima volta). Oggi non è un percorso raggiungibile
  per sbaglio — l'unico utente con un invito in sospeso è un proprietario
  appena creato — ma quando il pannello saprà invitare altri utenti andrà
  chiuso: annullare gli inviti vivi dell'utente disattivato.
- **`tenants.mio` viene chiesto a ogni utente** dal `UserMenu`, solo per
  sapere se mostrare la voce «Piattaforma»: una query in più per chiunque,
  per un segnale che riguarda una persona sola. Innocua oggi (la risposta è
  piccola e in cache), da rivedere se il menu diventerà più caro.
- `schedaAzienda` (`server/piattaforma/letture.ts`) ricompone l'elenco intero
  e ne tiene una riga: paga il costo di tutte le aziende per mostrarne una.
  Con le aziende che si contano sulle dita va bene — la composizione dei campi
  resta in un posto solo — e la scheda si rilegge ogni 60 s invece di 15 (I6).
  Quando le aziende saranno decine, la lettura per singolo tenant è un
  rifacimento della sola `schedaAzienda`: `storageDi`, `comandiDi`, `eventi` e
  `consumoAziendaMese` esistono già nella forma «per un'azienda».

## 3. Accesso

### 3.1 Capacità di piattaforma

- Variabile d'ambiente `PLATFORM_ADMIN_EMAILS`: email separate da virgola,
  confronto senza maiuscole e senza spazi. Letta a ogni chiamata (come
  `interruttoreAttivo`), nessuna cache: togliere un'email vale subito.
- `server/piattaforma/accesso.ts`:
  - `emailAmministratori(): Set<string>`;
  - `amministraPiattaforma(user: { email?: string; tenantId?: number; attivo?: boolean } | null): boolean`
    — vero solo se l'utente è presente, attivo, del tenant
    `TENANT_PREDEFINITO_ID` e con email nell'elenco. Pura, testata.
- Builder in `server/_core/trpc.ts`:
  `export const piattaformaProcedure = sessionProcedure.use(requirePiattaforma)`.
  `requirePiattaforma` rilegge l'utente dallo store (i ruoli e `attivo` vengono
  dallo store, non dal JWT, come fa `createContext`) e rifiuta con `FORBIDDEN`
  e `MESSAGGI_PIATTAFORMA.nonAmministratore`. **Non** passa da `guardiaTenant`:
  l'amministratore agisce SU un'altra azienda, non dentro la propria, e deve
  poter riattivare anche il tenant 1 sospeso. Conseguenza: nel router nessun
  contesto tenant implicito; ogni lettura di uno store per tenant è avvolta in
  `conTenant(tenantId, …)` esplicito (§5.3).
- `tenants.mio` (già `sessionProcedure`) aggiunge `piattaforma: boolean`
  calcolato con `amministraPiattaforma`. È l'unico segnale che il client usa.

### 3.2 Conferma della password sulle azioni sensibili

- Le mutation sensibili accettano `passwordConferma: z.string().min(1)` e la
  verificano con `verifyPassword` (`server/_core/password.ts:52`) contro il
  record dell'amministratore, letto con `conTenant(TENANT_PREDEFINITO_ID, () =>
  getUtentiStore())`. Errore: `UNAUTHORIZED` con
  `MESSAGGI_PIATTAFORMA.passwordNonCorretta`.
- Limite di tentativi: lo stesso del login (5 in 15 minuti per chiave). Il
  limitatore in memoria di `server/routers.ts:60-96` viene estratto in
  `server/_core/limiteTentativi.ts` come
  `creaLimiteTentativi({ finestraMs, massimo })` → `{ verifica(chiave), fallito(chiave), azzera(chiave) }`;
  il login lo usa con gli stessi numeri (comportamento invariato, test esistenti
  verdi); il pannello con chiave `conferma:<email>`; la pagina d'invito con
  chiave `invito:<hash del token>` (§6.3).
- Sono sensibili: `crea`, `sospendi`, `riattiva`, `proprietario`,
  `abbonamento` (tutte le azioni), `ripristina` con `scrivi: true` e — dalla
  revisione finale del branch, ruling **R9** — anche `invita`: un link
  d'invito vale la presa dell'account del proprietario di un'altra azienda,
  quindi chi lo emette conferma di essere ancora lui. Non lo sono:
  `ricalcolaStorage`, `ripristina` in prova, `annullaInvito` (annullare toglie
  potere, non ne dà).
- Sempre per R9, il `link` esce verso il browser **solo** quando la posta non
  è partita (`inviato === false`), in `invita` e nell'invito che `crea` manda
  da sé: se la posta è partita il token è già nella casella del proprietario e
  una seconda copia nella pagina dell'amministratore sarebbe soltanto un'altra
  copia da rubare.

### 3.3 Interruttore spento

Con `FLAG_MULTI_AZIENDA` spento le query del pannello rispondono (mostrano il
tenant 1 e il suo omaggio), ogni mutation rifiuta con `PRECONDITION_FAILED` e
`MESSAGGI_PIATTAFORMA.solaLetturaFlagSpento`, e la pagina lo dice in testa. I
comandi non verrebbero comunque eseguiti (`eseguiComandiInAttesa` è un no-op a
flag spento). Nessun interruttore nuovo: il pannello è gated dall'identità.

## 4. Control plane

### 4.1 Tabella `tenant_inviti` (nuova, scritta SOLO da `server/tenants/repository.ts`)

```sql
CREATE TABLE IF NOT EXISTS tenant_inviti (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id),
  utente_id BIGINT NOT NULL,
  email TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'proprietario' CHECK (tipo IN ('proprietario')),
  token_hash TEXT NOT NULL UNIQUE,
  scade_il TIMESTAMPTZ NOT NULL,
  creato_da TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  usato_il TIMESTAMPTZ,
  annullato_il TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS tenant_inviti_tenant_idx ON tenant_inviti (tenant_id, created_at DESC);
-- Un solo invito vivo per utente e azienda (fix wave finale): la regola che
-- `emettiInvito` applica nel codice, applicata anche dalla tabella.
CREATE UNIQUE INDEX IF NOT EXISTS tenant_inviti_valido_idx
  ON tenant_inviti (tenant_id, utente_id)
  WHERE usato_il IS NULL AND annullato_il IS NULL;
```

- Il token in chiaro (`randomBytes(32).toString("base64url")`) esce una volta
  sola dal metodo che lo emette; a terra resta `sha256` esadecimale. Nessun
  log lo contiene.
- Tipi in `server/tenants/tipi.ts`:
  `TipoInvito = "proprietario"`,
  `TenantInvito = { id; tenantId; utenteId; email; tipo; scadeIl: Date; creatoDa: string; createdAt: Date; usatoIl: Date | null; annullatoIl: Date | null }`
  (mai il token né l'hash nel tipo di lettura).
- `TTL_INVITO_MS = 7 * 24 * 60 * 60 * 1000` in `server/tenants/costanti.ts`.
- `verificaSchema` sonda **otto** tabelle; `MESSAGGI.schemaAssente` elenca anche
  `tenant_inviti`; `repository.pg.test.ts` la aggiunge alle due liste `DROP
  TABLE` (§11).
- `TipoEvento` nuovi: `invito_inviato` (`dettagli: { invitoId, utenteId, email,
  scadeIl, inviato: boolean, motivo?: string }`), `invito_accettato`
  (`{ invitoId, utenteId }`), `invito_annullato` (`{ invitoId }`).

### 4.2 Metodi nuovi di `TenantRepository` (Postgres e memoria, stessa semantica)

```ts
emettiInvito(input: { tenantId: number; utenteId: number; email: string; tipo: TipoInvito; creatoDa: string; adesso?: Date }): Promise<{ invito: TenantInvito; token: string }>;
// annulla prima ogni invito NON USATO dello stesso utente (annullato_il = adesso, scaduti compresi:
// è la condizione esatta di tenant_inviti_valido_idx); poi inserisce. Se due chiamate corrono e la
// seconda perde (23505 sull'indice), rifà annulla+inserisci UNA volta: alla fine ne resta uno solo
invitoPerToken(token: string, adesso?: Date): Promise<TenantInvito | null>;  // valido: non usato, non annullato, non scaduto rispetto ad `adesso`
consumaInvito(token: string, adesso?: Date): Promise<TenantInvito | null>;   // UPDATE … WHERE token_hash = $1 AND usato_il IS NULL AND annullato_il IS NULL AND scade_il > $adesso RETURNING *
invitiDi(tenantId: number): Promise<TenantInvito[]>;                            // più recenti prima
annullaInvito(id: number): Promise<TenantInvito | null>;                         // solo se non usato
pulisciInvitiScaduti(): Promise<number>;                                          // cancella gli scaduti da più di 30 giorni; al boot con pulisciStateScaduti
comandiDi(tenantId: number, opzioni?: { ultimi?: number }): Promise<TenantComando[]>; // per la scheda
storageTutti(): Promise<StatoStorage[]>;                                          // una query per tutte le aziende
eventiRecenti(input: { tipi: TipoEvento[]; da: Date }): Promise<TenantEvento[]>;  // una query, tutte le aziende, per i worker sospesi
prendiEdEsegui(esegui, opzioni?: { soloId?: number }): Promise<"eseguito" | "errore" | "nessuno">; // con soloId: AND id = $1
```

`prendiEdEsegui` conserva `FOR UPDATE SKIP LOCKED` dentro la transazione: se
il giro dei 30 secondi ha già preso il comando, il pannello riceve `"nessuno"`
e legge la riga (§5.2). La repo in memoria replica il filtro.

### 4.3 Attore «piattaforma»

`Attore` guadagna la variante `{ tipo: "piattaforma"; email: string }`;
`attoreTesto` la rende `piattaforma:<email>`. `eseguiComando` ricava l'attore da
`richiestoDa`: se inizia per `piattaforma:` è un attore piattaforma con quella
email, altrimenti resta `{ tipo: "script", nome: richiestoDa }` (comportamento
invariato per lo script). Così `tenant_eventi` dice «piattaforma:t.ruffino@…»,
non «script:…», per tutto ciò che nasce dal pannello.

### 4.4 Ledger Tars

`LedgerCosti` guadagna `consumoAziendeMese(input: { adesso: Date }): Promise<Map<number, number>>`
(nano-USD per `tenant_id`, `COALESCE(tenant_id, 1)`, stesso `CASE stato` di
`consumoAziendaMese`): una query per l'elenco, non una per azienda. In memoria:
somma sull'array. Senza database autorevole l'elenco mostra «—», mai uno zero
bugiardo (stessa regola di `tenants.consumi`).

## 5. Router `piattaforma` (server)

Nuova cartella `server/piattaforma/` (il nome `platform` è occupato dai flag
per il client, `server/routers/platform.ts`). Montato in `server/routers.ts`
come `piattaforma`. Tutte le procedure usano `piattaformaProcedure`; gli input
individuano l'azienda per `slug`, mai per `tenantId` (guardia
`server/tenants/confine.test.ts:15-18`). Un'azienda sconosciuta risponde
`NOT_FOUND` «Risorsa non trovata.» (`oppureNotFound`).

### 5.1 Letture (`server/piattaforma/letture.ts`, chiamate dal router)

- `aziende` → `AziendaRiga[]`, una per tenant in `repo.tutti()`, con:
  `{ id, slug, nome, stato, motivoStato, createdAt,
     abbonamento: { tipo, stato, finePeriodo, prossimoRinnovo, omaggio: { scadenzaIso } | null, insolutoDal, disdettaAFinePeriodo } | null,
     storage: { bytes, file, quotaBytes, percentuale, soglia100Dal, ricalcolatoIl } | null,
     tars: { mese, consumoEur: number | null, budgetEur: number | null, extraEur: number, percentuale: number | null, bloccoDal: Date | null },
     workerSospesi: Array<{ etichetta; finoA; errore }>,
     comandiInAttesa: number,
     ultimoBackup: { finishedAt: Date | null; ok: boolean | null; files: number; bytes: number; target } | null,
     proprietari: Array<{ id; nome; cognome; email; attivo }>,
     invitoInSospeso: { email; scadeIl } | null }`.
  **Regola di costo (memoria: ~147 ms per round trip):** l'elenco fa al più
  cinque query in tutto — `storageTutti()`, `eventiRecenti({ tipi:
  ["worker_sospeso","worker_riarmato"], da: adesso − 24 h })`,
  `comandiInAttesa()`, `consumoAziendeMese`, `invitiDi` per le sole aziende
  senza proprietario attivo (di solito zero) — più letture in memoria
  (`abbonamentoDi`, `workerSospesi` pura, `backupLog(1)` e proprietari via
  `conTenant`). Mai una query per azienda nel ciclo.
- `azienda({ slug })` → tutto quanto sopra più: `sedi: Array<{ id; nome; attiva }>`
  (da `repo.tenantSedi()` filtrato e dallo store `sedi` via `conTenant`),
  `abbonamento` completo (campi di `Abbonamento` in unità umane: euro, GB,
  giorni), `eventi: TenantEvento[]` (ultimi 50), `comandi: TenantComando[]`
  (ultimi 20, `payload` già senza segreti), `inviti: TenantInvito[]`,
  `backup: BackupLog[]` (ultimi 5 via `conTenant(tenantId, () => backupLog(5))`),
  `provider: string`. (R5: `ultimoBackup` e `backup` portano il record
  intero di `BackupLog` — `trigger`, `error` e `id` compresi, non solo il
  sottoinsieme sopra — perché non contiene segreti e la scheda client lo usa
  già per intero; duplicare il tipo solo per il pannello sarebbe stato un
  costo senza beneficio.)
- `comando({ id })` → `TenantComando | null`, per seguire ricalcolo e ripristino.

### 5.2 Scritture: accoda ed esegui subito

`server/tenants/servizio.ts` esporta
`eseguiComandoSubito(id: number): Promise<TenantComando>`: chiama
`repo.prendiEdEsegui(eseguiComando, { soloId: id })`; qualunque sia l'esito
(`eseguito`, `errore`, `nessuno` perché il giro lo ha già preso) rilegge
`repo.comando(id)` e, se è ancora `in_attesa`, attende fino a 10 s
(passi da 500 ms) prima di restituirlo così com'è. Il router:

```
1. verifica la password se l'azione è sensibile (§3.2);
2. costruisce il payload con lo STESSO schema zod di server/tenants/comandi.ts
   (schemaPayloadCrea, schemaPayloadStato, schemaPayloadProprietario,
   schemaPayloadStorage, schemaPayloadRipristino, schemaPayloadAbbonamento);
3. repo.accodaComando({ tipo, tenantId, payload, richiestoDa: `piattaforma:${email}` });
4. se il tipo è ricalcola_storage o ripristina_archivi → risponde { comando } subito;
   altrimenti → eseguiComandoSubito(id) e risponde { comando } con stato ed esito.
```

Mutation (input → tipo di comando):
- `crea({ slug, nome, sede: { nome, citta? }, proprietario: { nome, cognome, email, telefono? }, omaggio?: { motivo, scadenza?: string }, passwordConferma })` →
  `crea` con `proprietario.passwordHash = hashPassword(passwordInutilizzabile())`
  (`randomBytes(32)` in base64url: nessuno può entrare prima dell'invito). Dopo
  l'esito `eseguito` con `creatoOra: true`: se `omaggio` è dato accoda ed esegue
  `imposta_abbonamento { azione: "omaggio", slug, motivo, scadenza }`; poi manda
  l'invito (§6) e risponde `{ comando, invito: { invito, inviato, motivo?, baseUrl, link? } }`
  (stessa regola R9 sul `link`).
  Se il tenant esisteva già (`creatoOra: false`) non manda inviti e lo dice.
- `sospendi({ slug, motivo, ancheTenant1?, passwordConferma })` → `sospendi`;
  per il tenant 1 senza `ancheTenant1` rifiuta con lo stesso messaggio dello
  script («Sospendere il tenant 1 mette Ruffino Group in sola lettura…»).
- `riattiva({ slug, motivo, passwordConferma })` → `riattiva`.
- `proprietario({ slug, email, azione: "assegna" | "revoca", passwordConferma })` →
  `assegna_proprietario` / `revoca_proprietario`.
- `abbonamento(payload di schemaPayloadAbbonamento & { passwordConferma })` →
  `imposta_abbonamento`. Le regole del tenant 1 (`nonIlTenant1`) restano quelle
  del servizio: il pannello mostra l'errore, non lo aggira.
- `ricalcolaStorage({ slug })` → `ricalcola_storage` (in coda).
- `ripristina({ slug, backup, solo?, scrivi, ancheTenant1?, passwordConferma? })` →
  `ripristina_archivi` (in coda); `passwordConferma` obbligatoria se `scrivi`.
- `invita({ slug, email?, passwordConferma })` → non è un comando (§6.4): chiama
  il servizio degli inviti per il proprietario dell'azienda (se `email` manca e i
  proprietari sono più d'uno, rifiuta e chiede quale); risponde
  `{ invito: TenantInvito, inviato, motivo?, baseUrl, link? }` — il `link` c'è
  solo con `inviato === false` (R9), la `baseUrl` dice da quale indirizzo è
  composto (I5).
- `annullaInvito({ id })` → `repo.annullaInvito(id)` + evento `invito_annullato`.

### 5.3 Cosa il router NON fa

- Non importa moduli business: né `server/routers/*` (salvo `utenti` per
  `getUtentiStore`/`creaUtenteInterno` già usati da `tenants/servizio.ts`), né
  `server/comunicazioni`, `server/fatture`, `server/tars/strumenti`,
  `server/documenti`. Guardia strutturale `server/piattaforma/confine.test.ts`
  (§11).
- Non chiama `storeDi` (la guardia esistente copre `server/routers/`; la nuova
  copre `server/piattaforma/`). Le letture per tenant passano da
  `conTenant(tenantId, …)` dentro `letture.ts`, con un commento per ciascuna
  che dice cosa legge e perché è control plane (proprietari, sedi, backup).
- Non espone segreti: `payloadSenzaSegreti` resta sul comando; il token
  dell'invito esce solo nel `link` della risposta della mutation che lo crea.

## 6. Inviti

### 6.1 Servizio `server/piattaforma/inviti.ts`

```ts
export async function invitaProprietario(input: {
  tenantId: number; utenteId?: number; email?: string;
  attore: Attore; adesso: Date; baseUrl: string;
}): Promise<{ invito: TenantInvito; link: string; inviato: boolean; motivo?: string }>;
export async function accettaInvito(input: { token: string; password: string; adesso: Date }): Promise<{ tenantId: number; utenteId: number; email: string }>;
export function anteprimaInvito(input: { token: string; adesso: Date }): Promise<{ azienda: string; email: string; nome: string; scadeIl: Date } | null>;
```

- `invitaProprietario`: trova l'utente dentro `conTenant(tenantId, …)` (per id,
  o per email, o l'unico con ruolo `proprietario`); emette l'invito con
  `repo.emettiInvito` (che annulla i precedenti dello stesso utente); compone il
  link `${baseUrl}/invito/${token}`; manda la posta (§7); registra
  `invito_inviato` con `inviato` e l'eventuale `motivo`; **non lancia** se la
  posta fallisce: il link torna al chiamante, che lo mostra da copiare.
- `accettaInvito`: `repo.consumaInvito(token)` (atomico, monouso); se `null` →
  `MESSAGGI_PIATTAFORMA.invitoNonValido`; dentro `conTenant(tenantId, …)` imposta
  `utente.password = hashPassword(password)` e `attivo = true`, salva lo store;
  registra `invito_accettato`; torna i dati per aprire la sessione.
- `baseUrl`: `APP_BASE_URL` (senza barra finale) se presente, altrimenti
  `${req.protocol}://${req.get("host")}` (lo stesso ripiego di
  `fattureInCloud.ts` per il redirect OAuth). In produzione va impostata
  (`https://app.wyndoor.com`, il dominio dell'app; finché il dominio non cambia).
  Se manca, `avvisaBaseUrlMancante()` scrive UN avviso al boot (I5) e
  `invitaProprietario` restituisce `baseUrl` insieme al link, così il
  pannello dice sotto al link su quale indirizzo è nato.

### 6.2 Router pubblico `inviti` (`server/piattaforma/invitiRouter.ts`, montato come `inviti`)

- `anteprima({ token })` (`publicProcedure`) → `{ azienda, email, nome, scadeIl }`
  o `NOT_FOUND` con `invitoNonValido`. Non consuma.
- `accetta({ token, password })` (`publicProcedure`, `password` con lo stesso
  `passwordSchema` di `utenti.ts`: 12–256 caratteri): limite di tentativi con
  chiave `invito:<sha256(token)>`; `accettaInvito`; poi apre la sessione come
  `auth.login`: la parte «costruisci `LocalUser`, `createLocalToken`, cookie
  `COOKIE_NAME` con `getSessionCookieOptions`» viene estratta da
  `server/routers.ts` in `server/localAuth.ts` come
  `apriSessioneLocale(ctx, utente): Promise<LocalUser>` e riusata dal login
  (comportamento invariato). Risponde con il `LocalUser`.

### 6.3 Pagina pubblica `/invito/:token`

`client/src/pages/InvitoPage.tsx`, montata in `App.tsx` FUORI dalla shell
(accanto alle rotte di stampa, righe 96-114): carica `inviti.anteprima`;
mostra azienda, nome ed email; chiede password e conferma (minimo 12
caratteri, stesso testo d'errore del server); su successo
`utils.auth.me.invalidate()` e `setLocation("/")`: `DashboardLayout` mostra la
shell perché `auth.me` ora risponde con l'utente. Invito non valido: stato
«Questo invito non è valido o è scaduto: chiedi un nuovo invito» con il
contatto della piattaforma. Nessun tentativo di indovinare: il token non appare
mai in un log né in un titolo.

### 6.4 Perché l'invito non è un comando

Un comando lascia il suo `esito` in `tenant_comandi`; il link dell'invito è un
segreto a tempo e non deve restare a terra. L'invito quindi è un servizio
chiamato direttamente dal pannello, con il proprio evento di audit
(`invito_inviato` senza token). Lo stesso servizio verrà chiamato dal futuro
onboarding a pagamento.

## 7. Posta della piattaforma

`server/_core/postaPiattaforma.ts`:

```ts
export type MessaggioPosta = { a: string; oggetto: string; testo: string; html?: string };
export type EsitoPosta = { inviato: true; id: string } | { inviato: false; motivo: string };
export async function inviaPosta(m: MessaggioPosta): Promise<EsitoPosta>;
export function postaConfigurata(): boolean;
export function __impostaPostaPerTest(finta: ((m: MessaggioPosta) => Promise<EsitoPosta>) | null): void;
```

- Provider: Resend, `POST https://api.resend.com/emails`, header
  `Authorization: Bearer ${RESEND_API_KEY}`, corpo `{ from, to: [a], subject,
  text, html }`; timeout 10 s (`AbortController`); risposta non 2xx →
  `{ inviato: false, motivo: "Resend ha risposto <stato>" }` senza corpo nel log;
  errore di rete → `{ inviato: false, motivo }`. Non lancia mai.
- `from` = `POSTA_PIATTAFORMA_MITTENTE`, default `Wyndoor <no-reply@wyndoor.com>`.
- Senza `RESEND_API_KEY`: `{ inviato: false, motivo: MESSAGGI_PIATTAFORMA.postaNonConfigurata }`.
- Log: una riga `[posta] invio a <dominio del destinatario>: ok|fallito (<motivo>)`
  — mai l'indirizzo intero, mai l'oggetto, mai il corpo.
- Testo dell'invito (`server/piattaforma/testi.ts`, funzione pura testata):
  oggetto «Il tuo accesso a Wyndoor per <Azienda>»; corpo: saluto per nome,
  chi lo ha creato («la piattaforma Wyndoor»), il link, «vale 7 giorni e si usa
  una volta sola», «se non aspettavi questo messaggio ignoralo». Versione
  testo e versione HTML minima (un paragrafo e un link), grafia «Wyndoor».
- Nei test la rete è vietata (`server/_core/testSetup.ts`): il mittente vero si
  prova con `global.fetch` rimpiazzato (convenzione di
  `driveBackup.test.ts:68-162`); il resto usa `__impostaPostaPerTest`.

## 8. Ciò che l'amministratore vede (client)

- **Accesso.** `client/src/components/RequirePiattaforma.tsx` sul modello di
  `RequireDirezione.tsx`, con adapter puro `piattaformaGateLabel({ mio, loading })`
  in `client/src/lib/piattaforma.ts` (`"allowed" | "blocked" | "loading"`) che
  legge `tenants.mio.piattaforma`. Voce «Piattaforma» in `UserMenu.tsx` accanto
  a «Impostazioni», solo se `mio.piattaforma`. Rotte in `App.tsx`:
  `/piattaforma` e `/piattaforma/:slug` dentro la shell, `/invito/:token` fuori.
- **`/piattaforma` — `client/src/pages/piattaforma/AziendeList.tsx`.**
  `PageHeader` con «Nuova azienda»; avviso in testa se il flag è spento;
  tabella `DataSurface` (desktop) e schede (sotto 768 px) con: nome e slug,
  stato (badge, motivo al passaggio), abbonamento (tipo, stato con `tonoStato`,
  fine con `dataItaliana`), spazio (`byteScritti`, percentuale, «fermo dal…» se
  bloccato), Tars del mese (consumo/budget in euro, `—` se non noto), worker
  sospesi (conteggio, dettaglio al passaggio), ultimo backup (data, esito),
  comandi in attesa. Riga cliccabile → scheda. Ricerca per nome o slug.
  Ruffino Group compare come le altre, con l'etichetta «piattaforma».
- **Dialogo «Nuova azienda» — `NuovaAziendaDialog.tsx`.** Campi: slug
  (regola `SLUG_RE`, suggerito dal nome), ragione sociale, prima sede (nome,
  città), proprietario (nome, cognome, email, telefono), «Omaggio subito»
  (interruttore con motivo e scadenza facoltativa), password di conferma.
  All'esito: riepilogo con «Invito inviato a …» oppure «Posta non
  configurata: copia questo link e consegnalo» con il link e un pulsante
  «Copia». Errori del servizio (slug già usato, email già esistente) mostrati
  così come arrivano.
- **`/piattaforma/:slug` — `AziendaDetail.tsx`.** Sezioni (sezioni piatte,
  niente card annidate, `min-w-0`): Stato (sospendi/riattiva con motivo; per il
  tenant 1 la conferma in più); Abbonamento (tipo, stato, fine, omaggio,
  disdetta; azioni: omaggio, proroga, disdetta/annulla disdetta); Spazio
  (usato/quota, tolleranza, blocco; azioni: quota, tolleranza, ricalcola con
  avanzamento del comando); Tars (consumo, budget, extra, tolleranza, blocco;
  azioni: budget, extra, tolleranza); Proprietari e inviti (elenco, invita o
  reinvia, annulla invito, assegna o revoca proprietario per email); Backup e
  ripristino (ultimi 5 backup; ripristina in prova / vero, con `--solo` e la
  conferma per il tenant 1); Eventi (ultimi 50, attore leggibile); Comandi
  (ultimi 20 con stato ed esito). Ogni azione sensibile apre `ConfermaPassword.tsx`
  (dialogo con motivo/campi dell'azione + password), mostra l'esito del comando
  e rinfresca la scheda.
- **Testi.** Riuso di `client/src/components/abbonamento/testi.ts`; i testi
  nuovi in `client/src/pages/piattaforma/testi.ts` (pure, testate). Tutto in
  italiano, grafia «Wyndoor».
- **Verifica visiva** a 1440×900 e 390×844 con il login demo e un harness che
  semina due aziende in memoria (memoria: «Verifica UI in anteprima demo»);
  console pulita.

## 9. Comandi e audit

- Ogni scrittura dal pannello è una riga di `tenant_comandi` con
  `richiesto_da = piattaforma:<email>` e, alla chiusura, `esito` e
  `eseguito_at`; gli eventi conseguenti portano `attore = piattaforma:<email>`.
  Gli inviti lasciano `invito_inviato`/`invito_accettato`/`invito_annullato`.
- `pnpm tenant elenco` e `pnpm tenant verifica` restano validi e mostrano gli
  stessi dati; nessun comando dello script cambia forma.
- L'accesso al pannello non è registrato come evento (è una lettura); un
  tentativo rifiutato di conferma password è contato dal limitatore e loggato
  come `[piattaforma] conferma password rifiutata per <dominio email>`.

## 10. Errori

`server/piattaforma/costanti.ts`, `MESSAGGI_PIATTAFORMA`:

- `nonAmministratore`: «Questa sezione è riservata all'amministrazione della piattaforma.» (`FORBIDDEN`)
- `passwordNonCorretta`: «Password non corretta.» (`UNAUTHORIZED`)
- `solaLetturaFlagSpento`: «Con FLAG_MULTI_AZIENDA spento il pannello è in sola lettura.» (`PRECONDITION_FAILED`)
- `invitoNonValido`: «Questo invito non è valido o è scaduto: chiedi un nuovo invito.» (`NOT_FOUND`)
- `postaNonConfigurata`: «Posta della piattaforma non configurata: copia il link e consegnalo a mano.»
- `proprietarioAmbiguo`: «L'azienda ha più proprietari: indica l'email di chi invitare.» (`BAD_REQUEST`)
- `tenantGiaEsistente`: «L'azienda esiste già: nessun invito inviato.» (esito informativo di `crea`)
- azienda sconosciuta: `NOT_FOUND` «Risorsa non trovata.» (`oppureNotFound`)
- troppi tentativi: `TOO_MANY_REQUESTS`, stesso testo del login.

Gli errori del dominio (slug non valido, email già esistente, tenant 1
intoccabile, ultimo proprietario) arrivano dal comando come `esito.errore` e
il pannello li mostra così come sono.

## 11. Test

- `server/piattaforma/accesso.test.ts`: `amministraPiattaforma` (elenco vuoto,
  maiuscole/spazi, utente non attivo, tenant ≠ 1); `piattaformaProcedure`
  rifiuta `FORBIDDEN`; conferma password verde/rossa e limite di tentativi.
- `server/_core/limiteTentativi.test.ts`: finestra, massimo, azzera; il login
  esistente resta coperto dai suoi test.
- `server/tenants/repository.test.ts` + `repository.pg.test.ts`: inviti
  (emissione annulla i precedenti, per-token valido/scaduto/usato/annullato,
  consumo atomico monouso — due consumi concorrenti: uno solo vince —,
  `invitiDi`, `annullaInvito`, pulizia), `comandiDi`, `storageTutti`,
  `eventiRecenti`, `prendiEdEsegui({ soloId })` (prende solo quello; con il
  giro che lo ha già preso → `nessuno`).
- `server/tenants/servizio.test.ts`: `eseguiComandoSubito` (esito immediato;
  attesa bounded se un altro lo ha preso); attore `piattaforma:` negli eventi.
- `server/tars/costi/ledger.test.ts` + `ledger.pg.test.ts`: `consumoAziendeMese`
  con due aziende e righe senza `tenant_id`.
- `server/piattaforma/inviti.test.ts`: invito, reinvio (il vecchio non vale
  più), posta assente → link comunque, accettazione imposta la password e
  attiva l'utente, secondo uso rifiutato, scaduto rifiutato; eventi.
- `server/piattaforma/router.test.ts` (memoria, due aziende seminate):
  `aziende` in ≤ 5 query (contatore sulle chiamate della repo finta),
  `azienda` completa, ogni mutation → comando registrato con
  `richiestoDa` giusto ed esito; `crea` con password inutilizzabile, omaggio e
  invito; flag spento → sola lettura; tenant sconosciuto → `NOT_FOUND`;
  nessuna procedura accetta `tenantId`.
- `server/piattaforma/invitiRouter.test.ts`: anteprima, accettazione con
  sessione (cookie impostato), limite di tentativi.
- `server/_core/postaPiattaforma.test.ts`: senza chiave; con chiave e `fetch`
  finto (2xx, 4xx, rete rotta, timeout); log senza indirizzo.
- `server/piattaforma/confine.test.ts`: nessun import business, niente
  `storeDi`, nessun campo `tenantId` negli schemi, il token non compare in
  `console.*`.
- Client: `piattaforma.ts` (gate label), `testi.ts`, `RequirePiattaforma`
  (tre stati). Verifica a 1440 e 390.
- Suite intera, `pnpm check`, `pnpm build`, `shared/brand.test.ts`.

## 12. Rilascio

- DDL additiva (`tenant_inviti`) creata al boot; `verificaSchema` a otto
  tabelle: `pnpm tenant verifica` di un build vecchio contro il database nuovo
  continua a passare (sonda sette tabelle che ci sono ancora).
- Variabili d'ambiente su Railway, servizio Wyndoor: `PLATFORM_ADMIN_EMAILS`
  (obbligatoria per vedere il pannello), `RESEND_API_KEY` (facoltativa: senza,
  link da copiare), `POSTA_PIATTAFORMA_MITTENTE` (facoltativa),
  `APP_BASE_URL` (consigliata).
- Fuori dal codice, a carico della direzione: account Resend, dominio
  `wyndoor.com` verificato (record SPF/DKIM che Resend indica), chiave API.
- Ordine: deploy → impostare `PLATFORM_ADMIN_EMAILS` e riavviare → login →
  «Piattaforma» nel menu → creare l'azienda pilota → l'invito arriva (o si
  copia il link) → il proprietario entra.
- Rollback = build precedente: la tabella resta a terra, invisibile e innocua;
  un invito già emesso non si accetta finché il codice nuovo non torna.

## 13. Cosa viene dopo

- **Stripe (WS4 parte provider):** webhook `checkout.session.completed` →
  `applicaEventoProvider` + `creaDaProvider` che chiama `crea` e
  `invitaProprietario`; il pannello mostrerà `provider` e `providerRef`.
- **MFA** per amministratori e proprietari; **accesso di supporto** con
  motivazione e scadenza; **reset password** (stessa tabella, `tipo = 'reset'`);
  inviti agli altri utenti; marchio del rivenditore.

## 14. File toccati

| Area | File |
|---|---|
| Control plane | `server/tenants/tipi.ts`, `costanti.ts`, `repository.ts`, `repository.test.ts`, `repository.pg.test.ts`, `servizio.ts` (attore, `eseguiComandoSubito`), `servizio.test.ts`, `boot.ts` (pulizia inviti) |
| Accesso | `server/piattaforma/accesso.ts` (+test), `server/_core/trpc.ts` (`piattaformaProcedure`), `server/_core/limiteTentativi.ts` (+test), `server/routers.ts` (login sul limitatore condiviso, `apriSessioneLocale`, montaggio dei router), `server/localAuth.ts`, `server/tenants/router.ts` (`mio.piattaforma`) |
| Pannello | `server/piattaforma/router.ts`, `letture.ts`, `costanti.ts`, `router.test.ts`, `confine.test.ts` |
| Inviti e posta | `server/piattaforma/inviti.ts` (+test), `invitiRouter.ts` (+test), `testi.ts` (+test), `server/_core/postaPiattaforma.ts` (+test) |
| Tars | `server/tars/costi/ledger.ts` (+test, +pg test) |
| Client | `client/src/App.tsx`, `components/RequirePiattaforma.tsx`, `components/layout/UserMenu.tsx`, `lib/piattaforma.ts` (+test), `pages/piattaforma/{AziendeList,AziendaDetail,NuovaAziendaDialog,ConfermaPassword,testi}.tsx/ts` (+test), `pages/InvitoPage.tsx` |
| Docs | `docs/runbooks/multi-azienda.md` (sezione WS6), `documento_requisiti_infissi_ops.md` (5.87, §60.13, §33), `handoff.md`, `CLAUDE.md` |

## 15. Modifica azienda (decisione del 09/09/2026)

Decisione della direzione in chat, la sera del 09/09/2026: «devo poter
modificare le aziende una volta create». Perimetro: **tutto** — dati,
fatturazione, sede, proprietario. Piano in 5 task,
`docs/superpowers/plans/2026-09-09-modifica-azienda.md`; branch
`feature/modifica-azienda` da `main` @ `d896101` (che contiene già
WS1-WS6, questo compreso).

### 15.1 Che cosa si corregge

- **Azienda**: ragione sociale, slug (con l'avviso che cambiare lo slug
  sposta l'indirizzo della scheda e il riferimento da riga di comando),
  note.
- **Fatturazione** (colonne additive su `tenants`, non previste dal WS6
  originario): P.IVA (11 cifre), codice fiscale (11-16 caratteri), sede
  legale, email amministrativa, PEC, codice SDI (7 caratteri) — tutti
  facoltativi, nessuna validazione fiscale oltre forma e lunghezza; una
  stringa vuota azzera il campo (`vuotoANull` in `server/tenants/comandi.ts`).
- **Sede predefinita**: nome, città — sostituita per intero (non è un patch
  parziale), e deve appartenere al tenant.
- **Proprietario**: nome, cognome, email, telefono — sostituiti per intero
  come la sede; se l'email cambia prima che l'invito sia accettato, il
  router lo riemette (§15.3).

### 15.2 Contratto

Due comandi nuovi in `tenant_comandi`, eseguiti **subito** come le altre
mutation non in coda (§5.2): `modifica_tenant`, `modifica_proprietario`.

```
schemaPayloadModificaTenant = z.object({
  slug,
  nome?: testo(120),
  nuovoSlug?: slug,
  note?: string | null,          // "" → null (vuotoANull)
  fatturazione?: {                // .partial(): un campo assente non tocca quello salvato
    partitaIva, codiceFiscale, indirizzoLegale,
    emailAmministrativa, pec, codiceSdi,      // ognuno string | null, "" → null
  },
  sede?: { id, nome, citta: string | null },  // sostituisce nome+città insieme
})

schemaPayloadModificaProprietario = z.object({
  slug,
  utenteId?: number,   // assente + un solo proprietario → quello; assente + 0 o 2+ → rifiuta
  nome, cognome, email,
  telefono?: string | null,       // "" → null
})
```

Router `piattaforma` (stesso shape meno `slug`, più `passwordConferma` —
azione sensibile, §3.2):

- `modifica(...)` → accoda ed esegue `modifica_tenant`; risponde
  `{ comando, slug }` — `slug` è quello nuovo se il comando è eseguito e lo
  slug è cambiato davvero, altrimenti quello di partenza (copre sia il
  rifiuto del dominio sia un comando ancora `in_attesa`).
- `modificaProprietario(...)` → accoda ed esegue `modifica_proprietario`;
  se `esito.emailCambiata` ed esiste un invito ancora valido per **quello
  specifico** `utenteId`, lo annulla (`repo.annullaInvito`, evento
  `invito_annullato`) e ne emette uno nuovo con `invitaProprietario`
  (evento `invito_inviato`, stessa regola R9: il `link` torna solo se la
  posta non è partita); risponde `{ comando, invito }` (`invito: null` se
  l'email non è cambiata, o se è cambiata ma quel proprietario non ha un
  invito pendente).

Eventi (`server/tenants/tipi.ts`): `tenant_modificato`
(`{ campi: [{ campo, prima, dopo }] }`, solo i campi davvero cambiati),
`slug_cambiato` (`{ da, a }`, solo se lo slug cambia davvero),
`proprietario_modificato` (`{ utenteId, campi }`).

### 15.3 Regole

- **Il tenant 1 non cambia slug**: un `nuovoSlug` diverso da quello attuale
  su `TENANT_PREDEFINITO_ID` è rifiutato (`MESSAGGI.tenant1SlugIntoccabile`)
  prima di toccare il control plane; gli altri campi nello stesso payload
  restano applicabili.
- **Email del proprietario unica su tutta l'installazione**,
  case-insensitive, come `creaUtenteInterno`: la propria email attuale non
  è un conflitto con se stessa.
- **L'invito si riemette SOLO per il proprietario toccato**: la ricerca
  dell'invito pendente è per `utenteId`, non per l'intera azienda — con più
  proprietari, cambiare l'email di uno non deve annullare l'invito ancora
  in sospeso di un altro.
- **`accettaInvito` rifiuta se l'email non coincide più**: se
  `modifica_proprietario` girasse fuori dal router (un domani, dal giro dei
  30 s) e cambiasse l'email di un proprietario con un invito ancora
  "valido" per definizione tecnica (non usato, non annullato, non
  scaduto), quel link punterebbe a un'identità superata. `accettaInvito`
  confronta l'email dell'invito con quella corrente dell'utente
  (case-insensitive) e rifiuta con lo stesso esito generico di un token
  scaduto o annullato — nessun dettaglio in più per chi tenta un vecchio
  link.
- **Nessun tocco a password o sessione**: cambiare l'email del proprietario
  non tocca la sua password né la sua sessione (ruling pre-1 del ledger).

### 15.4 Decisioni d'esecuzione (dal ledger)

Registro: `.superpowers/sdd/2026-09-09-modifica-azienda/progress.md`.

- **Ruling pre-1.** Cambiare l'email del proprietario non tocca la sua
  password né la sessione; l'invito pendente si annulla e si riemette dal
  router (Task 3) con l'attore piattaforma. Costo se sbagliato: un invito
  in più.
- **Sei nit della revisione di Task 2**, chiuse come pre-passo del Task 3:
  `utenteId` assente e **zero** proprietari è un NOT_FOUND generico, non
  l'ambiguità (che resta per due o più); una modifica di sola `sede` non
  sposta più `tenants.updated_at` (`aggiornaTenant` non è chiamato a patch
  vuoto); `MESSAGGI.emailGiaInUso` sostituisce un letterale nudo;
  `vuotoANull` (stringa vuota → `null`) applicato anche a `note`, ai sei
  campi di fatturazione, a `sede.citta` e al telefono del proprietario;
  `partitaIva` ha ora `.trim()` come i suoi simili; `slugValido(nuovoSlug)`
  in testa a `modificaTenant` come difesa in profondità.
- **Fix round 1 di Task 3** (revisione opus, CHANGES_REQUIRED): il tipo
  dell'input di `vuotoANull` non era più `unknown` lato zod 4
  (`z.preprocess` senza l'input annotato) — guardia di tipo nuova
  (`server/tenants/comandi.tipi.assert.ts`); un secondo test con due
  proprietari prova che l'invito riemesso tocca solo quello giusto;
  `accettaInvito` rifiuta se l'email non coincide più (§15.3);
  `annullaInvito` può tornare `null` per una corsa vera (l'invito appena
  accettato da chi lo possedeva) — nessun evento, nessun reinvio in quel
  caso; l'helper `invitoValido` è unico ed esportato dal repository invece
  di tre copie identiche.
- **Client (Task 4).** Un dialogo, quattro pannelli a tab (non
  `<details>`: quindici campi in colonna in un dialogo alto quanto lo
  schermo non si leggerebbero); un solo «Salva» con la password, che manda
  al più due mutation in fila (`modifica`, poi `modificaProprietario` se il
  pannello Proprietario è cambiato); dopo un cambio di slug la scheda non
  si invalida per il vecchio indirizzo (andrebbe in `NOT_FOUND`) — si
  invalida l'elenco e si naviga alla scheda nuova solo alla chiusura del
  dialogo.

### 15.5 Verificato

`pnpm check` pulito; `pnpm test` (senza `DATABASE_URL`) 355 file passati +
15 saltati (3864 test passati + 88 saltati), zero falliti; `pnpm build`
riuscito (`dist/index.js` 3.6 MB, avviso di dimensione preesistente);
`DATABASE_URL=… npx vitest run --no-file-parallelism` sui quattro
`*.pg.test.ts` di `server/tenants` (`repository`, `storage`, `tabelle`,
`ripristino`): 4 file passati, 26 test passati, zero falliti. **Non
verificato:** il salvataggio vero dal pannello contro un server reale (il
montaggio di verifica del Task 4 usa un link tRPC finto, la password non
si digita in sessione); nessun tocco a Railway. Su branch
`feature/modifica-azienda`, PR aperta: il merge è una decisione della
direzione.
