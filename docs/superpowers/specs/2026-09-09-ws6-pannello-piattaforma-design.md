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
   Mittente `noreply@wyndoor.com`, chiave nell'ambiente, record DNS a carico
   della direzione. Senza chiave il flusso non si rompe: il pannello mostra il
   link da consegnare a mano.
4. **Esecuzione immediata dei comandi.** Il pannello registra il comando in
   `tenant_comandi` e lo esegue subito con la stessa funzione del giro dei 30
   secondi, prendendolo in carico in modo atomico; risponde con l'esito.
   Ricalcolo dello spazio e ripristino degli archivi restano in coda.

## 2-bis. Decisioni in corso d'opera

Il registro dell'esecuzione
(`.superpowers/sdd/2026-09-09-ws6-pannello-piattaforma/progress.md`) ha
prodotto dieci ruling, in ordine di apparizione: due prima del Task 1
(pre-flight, sul piano) e otto durante la revisione dei task (R1…R8). Ognuno
con che cosa è stato deciso, perché, e il costo se la decisione fosse
sbagliata.

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
- `TENANT_PIATTAFORMA_ID` è ricopiato in due file client (`AziendeList.tsx`,
  `AziendaDetail.tsx`, che lo passa come prop `tenant1` ai componenti
  figli) perché il client non può importare `TENANT_PREDEFINITO_ID` dal
  server: da unificare in un modulo condiviso se un terzo punto ne avrà
  bisogno.
- Nessun invito a un indirizzo email libero dal pannello: `crea` semina
  sempre un proprietario, quindi non esiste oggi un percorso per invitare un
  indirizzo che non sia già un utente dell'azienda.

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
  `abbonamento` (tutte le azioni), `ripristina` con `scrivi: true`. Non lo sono:
  `ricalcolaStorage`, `ripristina` in prova, `invita`, `annullaInvito`.

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
// annulla prima ogni invito ancora valido dello stesso utente (annullato_il = NOW()); poi inserisce
invitoPerToken(token: string, adesso?: Date): Promise<TenantInvito | null>;  // valido: non usato, non annullato, non scaduto
consumaInvito(token: string, adesso?: Date): Promise<TenantInvito | null>;   // UPDATE … WHERE token_hash = $1 AND usato_il IS NULL AND annullato_il IS NULL AND scade_il > NOW() RETURNING *
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
  l'invito (§6) e risponde `{ comando, invito: { link, inviato, motivo? } }`.
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
- `invita({ slug, email? })` → non è un comando (§6.4): chiama il servizio degli
  inviti per il proprietario dell'azienda (se `email` manca e i proprietari sono
  più d'uno, rifiuta e chiede quale); risponde `{ invito: TenantInvito, link, inviato, motivo? }`.
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
  (`https://crm-ruffinogroup.up.railway.app` finché il dominio non cambia).

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
- `from` = `POSTA_PIATTAFORMA_MITTENTE`, default `Wyndoor <noreply@wyndoor.com>`.
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
