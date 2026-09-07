# WS2 — Porta aperta: archivi per tenant (spec tecnica)

**Data:** 07/09/2026 · **Stato:** approvata in chat a sezioni dalla direzione
(cinque decisioni + design in sette sezioni) e **implementata** in 15 task
sul branch `feature/ws2-porta-aperta` (07/09/2026, `964fb6b`…HEAD); non su
`main`, non in produzione. Le decisioni prese durante l'esecuzione sono
in §2-bis e le sezioni che ne sono cambiate portano la nota
«(esecuzione, R\<n\>)» ·
**Spec madre:** `docs/superpowers/specs/2026-09-06-saas-multi-azienda-design.md`
(§12.3–12.5, §13, §14, §16.1, §16.5, §17 punto 2) · **Precedente:**
`docs/superpowers/specs/2026-09-06-ws1-fondazione-tenant-design.md` ·
**Branch:** `feature/ws2-porta-aperta`, nato dal branch del WS1
(`feature/ws1-fondazione-tenant`, PR #3 verso `main`); se la PR #3 viene
fusa prima, il branch si ribasa su `main`.

> Il WS1 ha messo il tenant nel contesto e ha chiuso la porta: ogni tenant
> diverso da Ruffino Group viene rifiutato perché gli archivi sono ancora
> quelli di oggi. Il WS2 apre la porta: ogni store JSONB ha un'istanza per
> tenant, le tabelle SQL portano `tenant_id`, ogni punto d'ingresso fuori
> richiesta (worker, backup, rotte Express) dichiara il tenant, e la porta
> chiusa sparisce. Ruffino Group non cambia di una virgola: le sue chiavi
> restano quelle di oggi.

## 1. Obiettivo, perimetro, non-obiettivi

**Obiettivo.** Con `FLAG_MULTI_AZIENDA` acceso, un tenant diverso da 1 può
usare il gestionale con i propri dati, isolati per costruzione; con
l'interruttore spento il codice si comporta esattamente come oggi.

**Entra nel WS2.**
- Store JSONB per tenant (§3): chiavi `tenant:<id>:<store>` dal tenant 2 in
  poi; il tenant 1 tiene le chiavi di oggi (alias, §2 decisione 1).
- Id dei record unici in tutta l'installazione (§4).
- Contesto del tenant corrente (`AsyncLocalStorage`), guardia unica per tRPC
  ed Express, worker con il tenant nel contesto, Tars invariato (§5).
- Colonna `tenant_id` sulle 33 tabelle SQL con `sede_id`, riempita da un
  trigger a partire dalla tabella specchio `tenant_sedi` (§6).
- Migrazione additiva di Ruffino Group e verifica in sola lettura da CLI (§7).
- Tenant creato a caldo con i suoi store istanziati (§3.5).
- Rimozione di `portaChiusaPerTenant` e del gemello nel login (§5.2).

**Resta fuori (WS3 e oltre, spec madre §17).**
- Prefissi del tenant sulle chiavi storage, conteggio dei byte, cascate di
  cancellazione (WS3).
- Backup ed export per tenant, restore, credenziali Drive per tenant (WS3).
- `state` OAuth persistito e legato a tenant/sede/utente, instradamento dei
  webhook per tenant (WS3).
- Retry, lease e dead-letter per tenant nei worker: nel WS2 i worker sono
  solo *scoped*; l'isolamento del guasto resta quello di oggi, un errore per
  sede non ferma le altre (WS3).
- Abbonamenti, prova gratuita, onboarding, Platform Admin, pilota (WS4–WS7).
- Caricamento pigro degli store per tenant: tutti gli store di tutti i tenant
  stanno in memoria come oggi; limite noto (§12), da rivedere al WS8.

## 2. Decisioni prese in chat (07/09/2026)

| # | Tema | Decisione | Alternative scartate |
|---|---|---|---|
| 1 | Chiavi del tenant 1 | **Alias**: `chiaveStore(1, nome) = nome`; dal tenant 2 `tenant:<id>:<nome>`. Nessuna copia, nessun cutover. Devia da spec madre §14.2 punti 3–4 (copia + legacy in sola lettura) e dal §18 («chiavi tenant:<id>:<store> accanto alle legacy in sola lettura»): stesso isolamento, zero spostamento di dati, rollback = redeploy | copia SQL al boot armato con cutover e finestra di rollback (doppio spazio, scritture post-cutover perse al rollback, rischio per store registrati tardi); rinomina atomica al boot armato (uniforme ma stessa cerimonia e stesso rischio sui registrati tardi) |
| 2 | Accesso agli store | **Contesto implicito**: `store.items` è un Proxy che risolve il tenant corrente da `AsyncLocalStorage`; i moduli non cambiano; fail-closed senza tenant; `storeDi(tenantId, nome)` interno a `persistence.ts` per migrazione, verifica e Platform Admin | parametro `tenantId` esplicito in ogni punto d'uso (centinaia di modifiche in 50 moduli) |
| 3 | Id dei record | **Unici globali**: un contatore per famiglia di store, `store.prossimoId()`; i 26 `let nextId` di modulo passano all'helper | contatori per tenant (ogni riferimento incrociato e ogni tabella dovrebbe portare il tenant) |
| 4 | `tenant_id` sulle tabelle SQL | **Sì, via trigger**: specchio `tenant_sedi`, `ADD COLUMN`, indice, trigger `BEFORE INSERT`, backfill al boot; nessun INSERT da toccare; query invariate (per sede) | scrivere `tenant_id` nei 33 siti di INSERT; rinviare al WS3 |
| 5 | Perimetro | **Store + guardie + worker scoped** (§1) | minimo (solo store e porta aperta: con il contesto fail-closed i worker vanno comunque avvolti); esteso (retry/dead-letter per tenant, assegnato al WS3 dalla spec madre) |

Restano valide le decisioni del WS1 (spec WS1 §2) e le «decisioni
consolidate» della spec madre §18, con la sola deviazione della riga 1,
registrata qui e nel PRD §60.

## 2-bis. Decisioni in corso d'opera (07/09/2026)

Diciotto scelte prese mentre il piano veniva eseguito, quando il codice
vero ha contraddetto la lettera della spec o del piano. Ognuna è un
emendamento a questo documento: le sezioni sotto sono già corrette di
conseguenza e portano la nota «(esecuzione, R\<n\>)». Registro completo:
`.superpowers/sdd/2026-09-07-ws2-porta-aperta/progress.md`.

| # | Che cosa | Perché | Costo se sbagliata |
|---|---|---|---|
| R1 | `pnpm tenant verifica` gira PRIMA di `caricaCache()` e non pretende il control plane: se `tenant_sedi` manca lo dice e salta le discordanze delle tabelle | il rapporto di partenza si lancia prima del deploy, su un database senza tabelle tenant | un rapporto meno completo su un database mai avviato col WS1 |
| R2 | gli helper di scansione dei sorgenti (`fileSorgente`, `relativo`, `RADICE`) escono da `confine.test.ts` in `server/_core/sorgentiDiProva.ts` | importare un file `.test.ts` da un altro test farebbe girare due volte le sue suite | un file di supporto in più sotto `pnpm check` |
| R3 | il backfill di `tenantId` timbra i record SOLO al caricamento, mai alla scrittura | la scrittura calda non deve pagare una scansione, e il campo è comunque ignorato dal codice precedente | un record nato dopo il boot resta senza `tenantId` fino al riavvio (la verifica lo conta; l'isolamento è per chiave, quindi intatto) |
| R4 | il risalvataggio dopo il backfill chiama `scheduleSave` direttamente, non dietro `setTimeout(…, 0)` | `loaded` è già true, così un `flushAll()` successivo lo trova in coda | nessuno (stesso debounce) |
| R5 | `famiglia.maxId` si calcola DOPO `onLoad`, non prima | un seed spinto dentro `onLoad` deve alzare il contatore | `prossimoId()` potrebbe restituire un id già usato da un seed |
| R6 | il backfill timbra e risalva SOLO con `bootstrapAll({ backfill: true })`: lo passa il boot del server, mai gli script | uno script che risalva la sua copia stantia del blob mentre il server vivo scrive la sua è il clobber che il repo vieta | nessuno: il server timbra comunque al boot |
| R7 | la regex del test strutturale sugli id copre anche le arrow tipizzate (`(x: any) => x.id`) | il pattern del piano non attraversava le parentesi e lasciava passare lo stile del repo | nessuno (test più severo) |
| R8 | gli accessi agli store AL BOOT fuori da una richiesta sono responsabilità del boot, non dei worker: riconciliazione della timeline e conteggio del costo-da-conferma girano in `perOgniTenantAttivo` dentro `index.ts` | con l'interruttore acceso il server deve arrivare a `listen` (§3.5) | un giro di riconciliazione in più per tenant, idempotente |
| R9 | `contestoCorrente.ts` diventa un modulo FOGLIA (solo interruttori, costanti, `_core/persistence`); `conTenantDellaSede`, `tenantsAttivi`, `perOgniTenantAttivo` passano in `server/tenants/giri.ts` | `trpc.ts` → `contestoCorrente` → `contesto` → `routers/sedi` → `trpc` era un ciclo che rendeva `protectedProcedure` undefined a seconda dell'ordine di import | un file in più e qualche import da aggiornare |
| R10 | il callback di `hub.subscribe` in `notifications/sse.ts` gira dentro `conTenantDellaSede(sedeId, …)` (cintura) | oggi il repository delle notifiche riceve `sedeId` esplicito e non tocca store, ma domani una lettura per tenant girerebbe sotto il tenant di chi pubblica | una chiamata in più per notifica |
| R11 | l'analisi azienda automatica gira solo sulle sedi **attive** del tenant (prima: tutte) | una sede chiusa non merita un'analisi a costo di modello, e i worker gemelli filtrano già `attiva` | una sede disattivata non riceve più l'analisi giornaliera automatica (la richiesta manuale da `/tars` resta) |
| R12 | lo scheduler FiC itera `sediAttiveDelTenant`, non `sediDelTenant` | `allSedeIds()` filtrava già `attiva`: è la scelta che preserva il comportamento | nessuno |
| R13 | `preparaTenants()` semina la riga `tenants` del tenant 1 **anche a interruttore spento** (`ON CONFLICT DO NOTHING`); resta condizionata all'interruttore solo la parte sugli store | specchio e backfill di `tenant_id` devono avvenire nel deploy spento, verificabili prima dell'accensione (§7.1, §8) | una riga in `tenants` in più in produzione, inerte finché l'interruttore è spento |
| R14 | `applicaTenantIdAlleTabelle` fa SOLO il DDL, con `lock_timeout` per tabella (timeout → tabella rinviata al boot successivo); il backfill è `backfillTenantIdSulleTabelle`, a lotti, DOPO `server.listen`, in sottofondo | il primo boot spento non deve tenere il server fuori dalla porta né bloccare gli altri client con lock esclusivi | il backfill finisce qualche secondo dopo il `listen` invece che prima (la verifica CLI lo conferma); una tabella con lock scaduto resta senza colonna fino al boot successivo |
| R15 | la forma documentata per l'automazione è `pnpm --silent tenant verifica --json` (o `npx tsx scripts/tenant.ts verifica --json`) | banner e trailer `ELIFECYCLE` sono di pnpm, non dello script: senza `--silent` lo stdout non è JSON valido | un operatore che dimentica `--silent` deve ritagliare l'output |
| R16 | un blob di `kv_store` che non è un array conta come anomalia (`blobNonValido`), non come store vuoto | è la peggiore condizione d'integrità che lo strumento possa incontrare, e il piano la faceva passare in silenzio | nessuno |
| R17 | in `server/routers/clienti.ts` i «non trovato» diventano `TRPCError NOT_FOUND`; l'idioma negli altri router resta un lavoro a parte | il 500 non fa trapelare nulla (stesso messaggio per id assente e altrui) ma non è il contratto della §9, e riscrivere 19 router esula dal WS2 | negli altri router un id altrui risponde 500 invece di 404 fino alla pulizia (§9) |
| R18 | gli insiemi di esenzione di `pnpm tenant verifica` (§7.2) hanno una guardia strutturale, `server/tenants/verifica.confine.test.ts`: l'ambito delle famiglie si legge dai sorgenti (`dichiarazioniPersistedStore` in `sorgentiDiProva.ts`, condiviso con `storeGlobali.test.ts`), la forma del record (con o senza `sedeId`) è una classificazione a mano che il test confronta con l'inventario delle dichiarazioni, con i tipi dei record e con il comportamento di `verificaStore`, famiglia per famiglia | senza guardia una famiglia nuova senza `sedeId` diretto farebbe segnalare ogni sua riga a ogni giro, e lo si scoprirebbe solo su un database vero (è successo con `timeline_steps`) | una famiglia nuova fa fallire un test finché qualcuno non ne dichiara la forma |

## 3. Persistenza per tenant (`server/_core/persistence.ts`)

È l'unico file che conosce lo schema delle chiavi di `kv_store`: nessun
altro modulo legge o scrive `kv_store` (verificato il 07/09/2026: zero
occorrenze fuori da `persistence.ts` e dai test).

### 3.1 Famiglie, istanze, chiavi

```ts
type AmbitoStore = "tenant" | "globale";

export function persistedStore<T>(
  nome: string,
  onLoad?: (items: T[], meta: LoadMeta) => void,
  opzioni?: { ambito?: AmbitoStore }          // default "tenant"
): PersistedStore<T>;

export type PersistedStore<T> = {
  items: T[];              // Proxy: vedi §3.2
  save: () => void;        // salva l'istanza del tenant corrente
  prossimoId: () => number; // §4
};

export type LoadMeta = { firstBoot: boolean; tenantId: number | null };

export function chiaveStore(tenantId: number, nome: string): string;
// 1 → nome (chiavi di oggi); n ≥ 2 → `tenant:${n}:${nome}`
```

- Una **famiglia** per nome: `{ nome, ambito, onLoad, istanze: Map<tenantId, StoreEntry>, maxId }`.
  Una **istanza** = l'attuale `StoreEntry` (`key`, `items` reale, `loaded`),
  con `key = chiaveStore(tenantId, nome)`. Le famiglie `globale` hanno una
  sola istanza con `key = nome` e non consultano mai il tenant.
- Un nome che inizia con `tenant:` viene rifiutato alla registrazione; il
  doppione di nome resta un errore come oggi.
- **Store globali** (dichiarati con `{ ambito: "globale" }`, tutti gli altri
  45 non cambiano una riga): `sedi`, `utenti` (control plane, `tenantId` sui
  record dal WS1), `platform_feature_flags`, `platform_feature_flag_audit`
  (flag di piattaforma per sede, spec madre §7), `backup_config`,
  `backup_oauth`, `backup_log` (backup globale fino al WS3).
- **Store per tenant**, con nota per quelli che il riscontro sul codice
  chiamava «globali»: `notifiche_read` (per `userId`: ogni utente appartiene a
  un solo tenant), `timeline_steps` (ambito via commessa), `tars_memoria` (per
  sede e utente), le configurazioni delle integrazioni per sede
  (`caselle_email`, `whatsapp_config`, `whatsapp_app`, `fic_config`,
  `calendar_tokens`, `external_calendars`), `whatsapp_conversation_aliases`,
  `business_event_assignment_fingerprints` e tutti gli archivi business.

### 3.2 Il Proxy

`store.items` è un `Proxy` il cui bersaglio è un array vuoto (così
`Array.isArray` è vero) e i cui trap inoltrano tutto all'array reale
dell'istanza corrente: `get` (i metodi vengono legati all'array reale, così
`filter`, `push`, `splice`, `sort`, l'iteratore e `length` lavorano
direttamente su di esso), `set` (indice, `length`), `has`, `deleteProperty`,
`ownKeys`, `getOwnPropertyDescriptor`, `defineProperty`. Un modulo che tiene
`const clienti = _store.items` a livello di modulo continua a funzionare
senza modifiche; ogni chiamata risolve il tenant al momento della chiamata,
non dell'import.

Risoluzione dell'istanza corrente, in quest'ordine:
1. famiglia `globale` → l'unica istanza;
2. interruttore spento → istanza del tenant 1 (`TENANT_PREDEFINITO_ID`);
3. interruttore acceso → `tenantCorrente()` da `AsyncLocalStorage` (§5.1);
   se assente → `Error("[persistence] accesso allo store <nome> senza tenant nel contesto")`;
   se il tenant non ha l'istanza → `Error("[persistence] store <nome> non istanziato per il tenant <id>")`.
   Eccezione dichiarata: con `NODE_ENV === "test"` (e senza
   `modalitaTenantStretta(true)`) il resolver ripiega sul tenant 1, perché
   quasi ogni test chiama i moduli fuori da una richiesta; lo stesso vale
   quando nessun resolver è stato registrato. In sviluppo e in produzione
   non c'è ripiego.

Fail-closed per costruzione: nessun percorso restituisce l'array di un altro
tenant o un array vuoto «di comodo».

Costo: un trap per chiamata di metodo, non per elemento (`filter` viene
letto una volta ed eseguito dall'array reale); un trap per accesso a indice
(`clienti[idx]`), raro. Trascurabile rispetto ai ~147 ms di un round trip
verso Postgres.

`storeDi<T>(tenantId, nome): T[]` (export interno, usato da verifica,
migrazione e domani dal Platform Admin) restituisce l'array reale di
un'istanza senza passare dal contesto: mai nei router.

### 3.3 Salvataggio, lock, transazioni multi-store

- `save()` → `scheduleSave(chiave dell'istanza corrente)`; debounce 200 ms,
  lock e retry per chiave come oggi. Due tenant che salvano lo stesso store
  non si aspettano: chiavi diverse, lock diversi.
- `storeKeys: WeakMap<PersistedStore, Famiglia>`; `risolviStoreAtomici`
  mappa ogni store all'istanza del tenant corrente (stessa regola di §3.2),
  quindi `conTransazioneStoreAtomica` e `saveStoresAtomically` (consumatori
  oggi: `routers/commesse.ts`, `tenants/servizio.ts`) scrivono le chiavi del
  tenant corrente nella stessa transazione. L'ordine lessicografico delle
  chiavi vale anche fra `tenant:2:clienti` e `tenant:2:commesse`.
- `flushAll()` e lo shutdown scorrono tutti i timer, quindi tutte le istanze.

### 3.4 `onLoad`, seed, backfill

- `onLoad(items, { firstBoot, tenantId })` gira **per istanza** con l'array
  reale; `tenantId` è `null` per le famiglie globali.
- I seed (`firstBoot && items.length === 0`) devono usare `tenantId`: oggi
  solo `whatsapp_app` (`server/comunicazioni/whatsapp.ts:187-190`) semina con
  `DEFAULT_SEDE_ID`; passa a `sedePredefinita(meta.tenantId)` e non semina se
  il tenant non ha sedi. `utenti` e `sedi` sono globali e restano come sono.
- **Backfill additivo centrale**: dopo il caricamento di un'istanza di
  famiglia `tenant`, ogni record oggetto senza `tenantId` numerico lo riceve
  dall'istanza; se almeno uno è cambiato, log
  `[persistence] backfill tenantId <key>: N record` e salvataggio
  programmato. Nessun `onLoad` di modulo da toccare. Un record con `tenantId`
  già presente e diverso dall'istanza NON viene toccato: viene contato dalla
  verifica (§7.2). Il campo in più è ignorato dal codice precedente.
  **(esecuzione, R6)** Il backfill è **su richiesta**: timbra e risalva solo
  se il chiamante passa `bootstrapAll({ backfill: true })`. Lo fa il boot del
  server (`server/_core/index.ts`); i cinque script che chiamano
  `bootstrapAll()` nudo (reset pattuiti, riconciliazione degli eventi
  business, migrazione dei documenti, backfill delle notifiche, importazione
  clienti) leggono e basta — nessuno di loro deve riscrivere la propria copia
  stantia del blob mentre il server vivo scrive la sua. Il flag vale per
  tutto il processo, quindi anche per le istanze nate dopo il boot
  (`istanziaStoresPerTenant`, caricamento tardivo, `backgroundRecover`).
  **(esecuzione, R3)** Il timbro avviene **solo al caricamento**, mai alla
  scrittura: un record creato dopo il boot resta senza `tenantId` fino al
  riavvio successivo, che lo timbra. Non è un buco d'isolamento — quello è
  garantito dalla chiave dell'istanza, non dal campo — ed è ciò che
  `pnpm tenant verifica` conta come `senzaTenant`.
  **(esecuzione, R5)** `famiglia.maxId` (§4) si aggiorna DOPO `onLoad`, così
  un record seminato dentro `onLoad` alza il contatore.

### 3.5 Boot e tenant creato a caldo

Ordine in `server/_core/index.ts` (`startServer`):

0. `impostaResolverTenant(tenantCorrente)` (§5.1), prima di tutto il resto.
1. `preparaTenants()` (nuovo, `server/tenants/boot.ts`): `ensureSchema()`
   del control plane, `caricaCache()`, `assicuraTenantPredefinito()`.
   Restituisce gli id dei tenant da istanziare: tutti quelli in cache (anche
   sospesi: leggibili), oppure `[1]` a interruttore spento. Non tocca gli
   store. **(esecuzione, R13)** Il seed della riga `tenants` del tenant 1
   avviene **sempre**, anche a interruttore spento (`ON CONFLICT DO
   NOTHING`): senza quella riga lo specchio `tenant_sedi` resterebbe vuoto
   (`INSERT … WHERE EXISTS tenants`) e `tenant_id` resterebbe NULL fino al
   primo boot acceso — cioè la migrazione additiva non sarebbe verificabile
   nel deploy spento, contro §7.1 e §8. Resta condizionata all'interruttore
   solo la parte sugli store (proprietario di ripiego, comandi, ciclo). Nota:
   «inerte» non vuol dire invisibile — anche a flag spento `tenants.mio` e
   `ctx.tenant` leggono quella riga, con gli stessi valori.
2. `bootstrapAll({ tenantIds, backfill: true })`: istanzia e carica le
   famiglie globali e, per ogni tenant, le famiglie `tenant`.
   `persistence.ts` non importa `server/tenants/*` (la lista arriva come
   parametro: nessun ciclo di import; test strutturale in `confine.test.ts`).
   Lo stesso ordine di caricamento di oggi, chiave per chiave. `backfill:
   true` lo passa solo il server (§3.4, R6).
3. (vedi il passo 5 per gli `ensureSchema()` espliciti: `completaTenants()` viene prima, perché il contesto di ogni richiesta e dei worker usa il backfill di utenti e sedi).
4. `completaTenants()` (rinomina dell'attuale `avviaTenants()` senza la
   parte di schema/cache): `sincronizzaTenantSedi()` (§6.1) sempre, poi —
   solo a interruttore acceso — backfill di `tenantId` su utenti e sedi
   (WS1), proprietario di ripiego, comandi in attesa e ciclo ogni 30 s.
5. Gli `ensureSchema()` espliciti dei repository SQL già presenti nel boot
   (`index.ts`), poi `applicaSchemaTabelleTenant()` → `applicaTenantIdAlleTabelle()`
   (§6.2): dopo, così più tabelle esistono già al primo boot.
   Specchio e colonne girano anche a interruttore spento (additivi, come il
   backfill di WS1): così il deploy spento li verifica prima
   dell'accensione.
6. Worker (ognuno per tenant, §5.3) e `server.listen` come oggi. Fra i
   «worker» del boot ci sono anche due giri che toccano gli store una volta
   sola e che **(esecuzione, R8)** sono responsabilità del boot, non dei
   worker: la riconciliazione della timeline (`reconcileTimelineBoardStates`)
   e il conteggio iniziale del costo-da-conferma girano dentro
   `perOgniTenantAttivo`, in `index.ts`.
7. **(esecuzione, R14)** DOPO `server.listen`, in sottofondo:
   `avviaBackfillTabelleTenant()` → `backfillTenantIdSulleTabelle()` (§6.2).
   Il backfill delle righe già a terra non deve tenere il servizio fuori
   dalla porta.

**Tenant a caldo** (`tenants.servizio.crea`, comando `crea` del WS1): dopo
l'inserimento del tenant e della sede, prima dell'utente proprietario, il
servizio chiama `istanziaStoresPerTenant(tenantId)` (export di
`persistence.ts`): crea un'istanza per ogni famiglia `tenant`, la carica
(`caricaEntry`: righe assenti → `firstBoot` → seed col tenant giusto), la
segna `loaded`. Se una famiglia fallisce il caricamento, le istanze già
create del tenant vengono rimosse e il comando finisce in `errore` come oggi
(nessun tenant «a metà»). `riattiva`/`sospendi` non toccano le istanze.

### 3.6 Registrazione tardiva

Una famiglia registrata dopo il boot (modulo importato dinamicamente) si
carica da sola per **ogni** tenant noto (`caricaTardivo` per istanza), con
lo stesso avviso di oggi. La lista dei tenant noti è quella passata a
`bootstrapAll` più quelli istanziati a caldo (`persistence.ts` la tiene in
un `Set`).

### 3.7 Memoria

Tutti gli store di tutti i tenant restano in memoria (accesso sincrono,
come oggi). Nessun caricamento pigro nel WS2 (§12).

**(esecuzione)** Il riepilogo per tenant (`[persistence] tenant <id>: N
store, M record`) non è stato costruito: al boot resta il log per chiave che
c'era già — `[persistence] loaded <key>: N items`, una riga per istanza,
quindi con le chiavi `tenant:n:*` già distinte per tenant. Chi vuole il
conteggio aggregato lo ha, in sola lettura e senza toccare il processo, da
`pnpm tenant verifica` (§7.2).

### 3.8 Snapshot e strumenti installazione-wide

`getAllStoreSnapshots()` restituisce tutte le istanze come
`{ key, items, nome, tenantId }` (i due campi nuovi sono additivi). I cinque
consumatori — `driveBackup.ts` (backup notturno globale fino al WS3),
`fileStorageAdmin.ts`, `secretBox.ts` (ricifratura dei segreti),
`resetPattuiti.ts`, `fileStorageMigrate.ts` — operano su tutta
l'installazione per natura e continuano a farlo, includendo le chiavi
`tenant:n:*`. Il ripristino di un backup resta per chiave, come oggi.

### 3.9 Casi noti da prevenire

- `structuredClone(proxy)` lancia `DataCloneError`: il piano cerca
  `structuredClone` sugli array degli store (oggi 63 usi, nessuno sull'array
  intero) e, se ne trova, li sostituisce con `[...items]`.
- Identità: `_store.items === arrayReale` è falso; nessun codice del repo
  confronta l'identità degli array degli store (da verificare nel piano con
  una ricerca).
- Un riferimento all'array preso dentro una richiesta e usato in un
  `setTimeout` mantiene il contesto (`AsyncLocalStorage` si propaga ai timer
  creati dentro il contesto); usato da un `EventEmitter` esterno (IMAP,
  WebSocket) NO: il gestore va avvolto (§5.4).

## 4. Id globali

- Ogni famiglia tiene `maxId`: al caricamento di ogni istanza
  `maxId = max(maxId, max degli id numerici dei record)`, calcolato DOPO
  `onLoad` (**esecuzione, R5**); `prossimoId()` restituisce `++maxId`. Gli
  store senza id numerici non lo usano.
- **(esecuzione)** I moduli convertiti sono **29**, non 23: alla lista del
  piano se ne sono aggiunti sei trovati durante la conversione —
  `_core/driveBackup.ts` (store `backup_log`), `comunicazioni/caselle.ts`,
  `routers/fornitori.ts`, `routers/notifiche.ts`, `routers/produzione.ts`,
  `routers/reclamiRifacimenti.ts`. Il test strutturale
  (`server/_core/idGlobali.test.ts`) vieta nuovi contatori locali e
  **(esecuzione, R7)** riconosce anche le arrow tipizzate
  (`(x: any) => x.id`), che il pattern del piano lasciava passare.
- I 23 moduli con store per tenant che generano id localmente — 15 con
  `let nextId = 1` + riga in `onLoad`
  (`nextId = items.length ? Math.max(...items.map(x => x.id)) + 1 : 1`) +
  `nextId++`, e 8 con il massimo calcolato inline all'inserimento
  (`ficPagamenti`, `fattureInCloud`, `conoscenza`, `transizioni`,
  `filtroComunicazioni`, `proposte/gateway`, `documenti/analisi`,
  `documenti/collegamenti`) — passano a `_store.prossimoId()` (e
  `riservaIdFinoA(n)` dove un modulo alza il contatore da uno storico):
  codemod con revisione, elencati nel piano. Restano invariati `sedi.ts` e
  `utenti.ts` (globali) e i contatori dei repository in memoria delle
  tabelle SQL, che non sono `persistedStore`. Un test strutturale vieta
  nuovi contatori locali.
- Un id di un altro tenant risponde `NOT_FOUND` come oggi per la sede
  (`assertSedeScope`); nessun `assertTenantScope` in più nei router:
  l'istanza del tenant non contiene record altrui.

## 5. Contesto corrente, guardie, worker

### 5.1 `server/tenants/contestoCorrente.ts` e `giri.ts` (nuovi)

**(esecuzione, R9)** I due file sono due perché uno solo riapriva un ciclo:
`_core/trpc.ts` → `contestoCorrente` → `contesto` → `routers/sedi` →
`trpc.ts`, che lasciava `protectedProcedure` a `undefined` se un router
veniva importato prima. `contestoCorrente.ts` è quindi una **foglia** del
grafo dei moduli (importa solo `platform/interruttori`, `./costanti`,
`_core/persistence`; guardia strutturale in `confine.test.ts`), e tutto ciò
che ha bisogno del control plane o delle sedi vive in `giri.ts`.

```ts
// server/tenants/contestoCorrente.ts — FOGLIA
export function conTenant<T>(tenantId: number, fn: () => T): T;        // als.run
export function tenantCorrente(): number | null;   // spento → 1; acceso → dal contesto
export function modalitaTenantStretta(attiva: boolean): void; // solo test: toglie il ripiego sul tenant 1

// server/tenants/giri.ts — importa contestoCorrente, contesto, repository
export function conTenantDellaSede<T>(sedeId: number, fn: () => T): T; // tenantIdDellaSede (WS1)
export function tenantsAttivi(): number[];         // spento o control plane vuoto → [1]; acceso → i tenant `attivo`
export function perOgniTenantAttivo(etichetta: string, fn: (tenantId: number) => Promise<void>): Promise<void>;
```

`persistence.ts` non importa nessuno dei due (ciclo): riceve il resolver con
`impostaResolverTenant(tenantCorrente)`, che `contestoCorrente.ts` chiama
da sé quando viene importato e `index.ts` ripete al boot; senza resolver e
con interruttore acceso, ogni accesso a uno store `tenant` è un errore
(fail-closed anche qui), salvo il ripiego dei test (§3.2).

I worker che scrivono saltano i tenant sospesi (sola lettura, e Tars costa):
`perOgniTenantAttivo` itera solo gli `attivo`, ognuno nel suo contesto, e un
errore di un tenant non ferma gli altri.

### 5.2 Guardia unica: `motivoRifiutoTenant` (`server/tenants/regole.ts`)

```ts
export type Rifiuto = { codice: "PRECONDITION_FAILED"; messaggio: string };
export function motivoRifiutoTenant(
  ctx: Pick<TrpcContext, "tenantId" | "tenant" | "sedeId">,
  op: { scrittura: boolean; esente?: boolean }
): Rifiuto | null;
```

Pura, senza IO. `null` a interruttore spento. Con interruttore acceso, in
ordine: `ctx.tenant` sospeso e `op.scrittura` e non `esente` → `MESSAGGI.solaLettura`;
`ctx.tenant` presente e `ctx.sedeId == null` → `MESSAGGI.senzaSede`. La
porta chiusa non esiste più: `portaChiusaPerTenant` sparisce da
`regole.ts`, da `trpc.ts` e dal login in `routers.ts:146`.

- `guardiaTenant` (`trpc.ts`): `const r = motivoRifiutoTenant(ctx, { scrittura: type === "mutation", esente: path === "sedi.switch" }); if (r) throw new TRPCError(...)`; poi
  `return conTenant(ctx.tenantId, () => next())` (a interruttore spento
  `conTenant(1, …)`, innocuo).
- `sessionProcedure` resta senza guardia e senza contesto (`tenants.mio`
  legge solo `ctx.tenant`).
- **Rotte Express** che costruiscono il contesto con `createContext`:
  `commessaFileRoutes.ts` (upload e download documenti), `anteprimaRoutes.ts`,
  `allegatoMailRoutes.ts`, `notifications/sse.ts`. Helper
  `rifiutaTenant(res, ctx, op): boolean` in `server/tenants/express.ts`:
  se `motivoRifiutoTenant` non è nullo risponde `412 { error: messaggio }` e
  restituisce `true`; altrimenti il gestore gira dentro
  `conTenant(ctx.tenantId, …)`. Upload = scrittura; download, anteprime, SSE
  = lettura.

### 5.3 Worker: ogni giro per sede dichiara il tenant

Forma comune: prima per tenant, poi per sede —
`perOgniTenantAttivo(etichetta, async t => { for (const sede of sediAttiveDelTenant(t)) … })`
per i giri che scorrono le sedi; `conTenantDellaSede(x.sedeId, …)` per le
unità di lavoro che arrivano già con la sede (eventi, promemoria, righe SQL,
callback di una casella). Il comportamento «un errore per sede non ferma le
altre» resta quello di oggi; in più un errore di un tenant non ferma gli
altri tenant.
Punti d'ingresso (checklist del piano, ognuno con un test che il giro passa
dal contesto):

| Punto d'ingresso | File |
|---|---|
| Action center, riconciliazione per sede | `server/actionCenter/scheduler.ts` |
| Smistamento comunicazioni | `server/tars/smistamento/worker.ts` |
| Analisi azienda | `server/tars/analisi/worker.ts` |
| Follow-up preventivi | `server/tars/followup/worker.ts` |
| Archiviazione conferme | `server/tars/documenti/confermeAutoArchivio.ts` |
| Costo da conferma | `server/commesse/costoDaConferma.ts` |
| Sonda fatture | `server/fatture/sonda.ts` |
| Scheduler FiC | `server/routers/fattureInCloud.ts` (giro per `allSedeIds()`) |
| Poller mail IMAP | `server/comunicazioni/imap.ts` (per casella → sede della casella) |
| Promemoria | `server/reminders/worker.ts` |
| Backup Drive (`buildBackupTree`, cartelle per sede) | `server/_core/driveBackup.ts` |
| Worker degli eventi business (coda durevole, evento con `sedeId`) | `server/events/worker.ts` |
| Ponte notifiche Postgres (`startNotificationPgBridge`) | `server/notifications/sse.ts` |
| **(esecuzione, R8)** Riconciliazione della timeline e conteggio iniziale del costo-da-conferma, al boot | `server/_core/index.ts` |

`snapshotByKey()` del backup legge il registro (`getAllStoreSnapshots`), non
passa dal Proxy e non ha bisogno del contesto.

**Precisazioni dell'esecuzione.**
- **(R11)** L'analisi azienda automatica (`tars/analisi/worker.ts`) gira ora
  solo sulle sedi **attive** del tenant; prima girava su tutte. È un cambio
  di comportamento: una sede disattivata non riceve più l'analisi
  giornaliera (la richiesta manuale da `/tars` resta).
- **(R12)** Lo scheduler FiC itera `sediAttiveDelTenant`: `allSedeIds()`
  filtrava già `attiva`, quindi il comportamento è invariato.
  `tars/followup/worker.ts` resta invece su `sediDelTenant` (tutte), sempre
  per non cambiare comportamento.
- **(R10)** In `notifications/sse.ts` anche il callback di `hub.subscribe`
  — il flush verso una connessione già aperta, innescato da un publish di
  chiunque — gira dentro `conTenantDellaSede(sedeId, …)`: cintura, non
  correzione di un difetto attuale.
- IMAP: poller e watcher IDLE girano entrambi per tenant. Durante il Task 10
  si è scoperto e corretto un guasto che non c'entrava col multi-azienda: il
  processo moriva a 60 s per un'eccezione non intercettata in
  `riavviaWatchers`, lanciata dal `setTimeout` del poller.

### 5.4 Tars

Un run parte dentro una richiesta tRPC (contesto già impostato) o dentro un
worker avvolto. `contestoServer` (`server/tars/contesto.ts`) pretende già
`tenantId`; `eseguiRun` (`server/tars/orchestratore.ts`) avvolge comunque l'esecuzione in
`conTenant(contesto.tenantId, …)` come cintura di sicurezza (idempotente se
il contesto c'è già). Strumenti, catalogo e governor non cambiano.

### 5.5 Test e contesto di prova

Nei test l'interruttore è **acceso** per default (`interruttoreAttivo`:
con la variabile assente vale acceso in `development` e `test`, spento in
produzione). Per non riscrivere i 262 file esistenti, che chiamano i moduli
fuori da una richiesta, `tenantCorrente()` senza contesto ripiega sul tenant
1 solo con `NODE_ENV === "test"` (§3.2); i test che verificano che un worker
o una rotta dichiari il tenant chiamano `modalitaTenantStretta(true)` e
usano `conTenant(n, …)` esplicito. I test dei router passano da
`guardiaTenant`, che imposta il contesto da `ctx.tenantId`. `contestoDiProva`
resta com'è.

## 6. Tabelle SQL

### 6.1 Specchio `tenant_sedi` (control plane, `server/tenants/repository.ts`)

```sql
CREATE TABLE IF NOT EXISTS tenant_sedi (
  sede_id BIGINT PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Derivata dallo store `sedi` (`sede.tenantId`), quindi autoriparante:
`sincronizzaTenantSedi()` (`server/tenants/servizio.ts`) fa
`INSERT … ON CONFLICT (sede_id) DO UPDATE` per ogni sede dello store, al
boot (§3.5 passo 4) e dopo ogni sede creata (`creaSedeInterna`, usata da
`sedi.create` e da `crea` del tenant). Una sede non cambia mai tenant.

### 6.2 `server/tenants/tabelle.ts` (nuovo)

**(esecuzione, R14)** DDL e backfill sono due funzioni, non una: il primo
boot spento non deve tenere il server fuori dalla porta per tutto il tempo
del backfill, né bloccare gli altri client con lock esclusivi senza scadenza.

```ts
export const TABELLE_PER_SEDE: readonly string[]; // le 33 di seguito

// Solo DDL — prima di server.listen
export async function applicaTenantIdAlleTabelle(
  sql, opzioni?: { soloTabelle?: string[]; lockTimeout?: string }
): Promise<{ applicate: string[]; assenti: string[]; rinviate: string[]; specchio: number }>;

// Solo dati, a lotti — dopo server.listen, in sottofondo
export async function backfillTenantIdSulleTabelle(
  sql, opzioni?: { soloTabelle?: string[]; dimensioneLotto?: number }
): Promise<{ totale: number; righe: Record<string, number>; ms: Record<string, number> }>;
```

- Il DDL gira con `SET LOCAL lock_timeout` per tabella (`'5s'` di default):
  se il lock non arriva (`55P03`/`57014`) la tabella finisce in `rinviate`
  (log, nessun errore) e ci riprova il boot successivo; ogni altro errore
  propaga e ferma l'avvio, come gli altri `ensureSchema()`. L'esistenza delle 33 tabelle si risolve con una sola
  query, non 33 `to_regclass`.
- La funzione del trigger tollera `tenant_sedi` assente (`EXCEPTION
  undefined_table → RETURN NEW`): colonne e trigger si installano lo stesso,
  `tenant_id` resta NULL finché lo specchio non esiste.
- Il backfill lavora a lotti (`ctid … LIMIT`, 5000 righe) e logga righe e ms
  per tabella. Gira a ogni boot: quando non c'è più nulla da riempire costa
  una manciata di query a vuoto in sottofondo.
- Il test `tabelle.pg.test.ts` limita entrambe le funzioni alle proprie
  tabelle e rimuove trigger e funzione in `afterAll`: il database di prova è
  condiviso e non va avvelenato.

Le 33 tabelle (inventario del 07/09/2026, verificato da un test
strutturale che estrae i blocchi `CREATE TABLE IF NOT EXISTS … ( … )` con
`sede_id` da `server/**/*.ts`): `azioni_operative`, `azioni_operative_eventi`,
`business_events`, `capability_delegations`, `capability_overrides`,
`chat_canali`, `chat_letture`, `chat_messaggi`, `commessa_contratti`,
`commessa_righe`, `computi`, `comunicazioni`, `contratto_estrazioni`,
`fattura_eventi`, `fatturazione_config`, `fatture`, `notification_preferences`,
`notifications`, `policy_audit_diffs`, `policy_change_events`, `promemoria`,
`promemoria_eventi`, `push_subscriptions`, `tars_analisi_azienda`,
`tars_azioni_esecuzioni`, `tars_cache_entries`, `tars_conversazioni`,
`tars_costi`, `tars_miglioramenti`, `tars_osservazioni`, `tars_run`,
`tars_smistamento`, `tars_turni`.

Per ogni tabella esistente, in una transazione per tabella (le assenti sono
create pigramente e ricevono tutto al boot successivo):

```sql
SET LOCAL lock_timeout = '5s';                    -- (esecuzione, R14)
ALTER TABLE <t> ADD COLUMN IF NOT EXISTS tenant_id BIGINT;
CREATE INDEX IF NOT EXISTS <t>_tenant_id_idx ON <t> (tenant_id);
DROP TRIGGER IF EXISTS <t>_tenant_id ON <t>;
CREATE TRIGGER <t>_tenant_id BEFORE INSERT ON <t>
  FOR EACH ROW EXECUTE FUNCTION tenant_id_dalla_sede();
```

E poi, DOPO `server.listen`, in sottofondo, a lotti (**esecuzione, R14**):

```sql
UPDATE <t> t SET tenant_id = s.tenant_id
  FROM tenant_sedi s
 WHERE t.ctid IN (SELECT ctid FROM <t>
                   WHERE tenant_id IS NULL
                     AND sede_id IN (SELECT sede_id FROM tenant_sedi)
                   LIMIT 5000)
   AND t.sede_id = s.sede_id;
```

La funzione, creata una volta (`CREATE OR REPLACE`), tollerante allo
specchio ancora assente (**esecuzione, R14**):

```sql
CREATE OR REPLACE FUNCTION tenant_id_dalla_sede() RETURNS trigger AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    BEGIN
      SELECT tenant_id INTO NEW.tenant_id FROM tenant_sedi WHERE sede_id = NEW.sede_id;
    EXCEPTION WHEN undefined_table THEN
      NEW.tenant_id := NULL;
    END;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
```

- Le query restano per sede: le sedi hanno id globali e un solo tenant,
  quindi il filtro di sede isola già. `tenant_id` serve a export, backup,
  cancellazione e statistiche per tenant (WS3–WS6) e alla verifica.
- Nessun `NOT NULL` nel WS2: lo specchio non è transazionale con l'insert
  (una riga inserita fra la creazione della sede e la sincronizzazione resta
  a NULL) e le tabelle pigre nascono senza trigger; il backfill del boot
  successivo chiude i buchi e la verifica (§7.2) li conta.
- Il valore lo scrive il database, mai l'applicazione: un INSERT che passa
  `tenant_id` esplicito resta lecito (il trigger non lo sovrascrive) ma nel
  WS2 non ne esiste nessuno.

## 7. Migrazione additiva e verifica

### 7.1 Che cosa cambia nei dati di Ruffino Group

Solo aggiunte, tutte ignorate dal codice precedente:
- `tenantId: 1` sui record degli store per tenant (§3.4), come il WS1 ha
  fatto per utenti e sedi;
- tabella `tenant_sedi` (§6.1);
- colonna `tenant_id`, indice e trigger sulle 33 tabelle (§6.2), righe
  riempite con il tenant della sede.

Nessuna copia, nessuna rinomina, nessun cutover: le chiavi di `kv_store`
del tenant 1 sono quelle di oggi (§2 decisione 1). **Rollback** = redeploy
del build precedente: le chiavi `tenant:n:*`, `tenant_sedi`, `tenant_id` e i
campi in più restano nel database, invisibili e innocui; nessun dato da
ripristinare. Il backup Drive riuscito nelle 24 ore precedenti resta
obbligatorio prima del deploy (runbook), come nel WS1.

### 7.2 `pnpm tenant verifica` (sola lettura)

Sottocomando nuovo di `scripts/tenant.ts`, logica in
`server/tenants/verifica.ts` (pura sui dati letti, testabile senza database):

- legge `SELECT key, data FROM kv_store` tramite una funzione di sola lettura
  di `persistence.ts` (`leggiBlobDaDb(key)` / `elencaChiaviDaDb()`), mai il
  registro in memoria; la mappa sede → tenant viene dal blob `sedi`;
- per ogni chiave (legacy e `tenant:n:*`): numero di record, record senza
  `tenantId` (`senzaTenant`), con `tenantId` diverso da quello della chiave
  (`tenantDiscorde`), con `sedeId` assente o non esistente
  (`sedeSconosciuta`), id doppi (`idDoppi`) e **(esecuzione, R16)** un blob
  che non è un array (`blobNonValido`, vale 1 anomalia: un `?? []`
  silenzioso trasformerebbe un blob corrotto in uno store vuoto);
- **(esecuzione)** tre insiemi di esenzione, perché non tutte le famiglie
  hanno tutti i campi: `FAMIGLIE_GLOBALI` (`sedi`, `utenti`, `backup_config`,
  `backup_log`, `backup_oauth`: nessun tenant né sede confrontabile — esenti
  da `senzaTenant`, `tenantDiscorde` e `sedeSconosciuta`),
  `FAMIGLIE_GLOBALI_PER_SEDE` (`platform_feature_flags`,
  `platform_feature_flag_audit`: globali ma con un `sedeId` vero, quindi
  esenti solo dai controlli sul tenant) e `FAMIGLIE_SENZA_SEDE_DIRETTA` (per
  tenant, ma senza `sedeId` sul record). **(esecuzione, R18)** Non sono
  liste a mano senza rete: `server/tenants/verifica.confine.test.ts` le
  confronta con l'inventario delle dichiarazioni nei sorgenti (l'ambito) e
  con una classificazione della forma del record, con o senza `sedeId`, che
  una famiglia nuova deve aggiornare per far passare il test, e prova il
  comportamento di `verificaStore` famiglia per famiglia;
- per ogni tabella di `TABELLE_PER_SEDE` presente: righe con `sede_id`
  sconosciuto, con `tenant_id` nullo, con `tenant_id` diverso dal tenant
  della sede (join su `tenant_sedi`); tabelle o colonne assenti segnalate,
  non errore. Attenzione: `sedeSconosciuta` lato tabelle è relativa a
  `tenant_sedi`, lato store al blob `sedi` — uno specchio stantio si vede
  come anomalia di tabella anche con il blob perfettamente coerente;
- **(esecuzione, R1)** il ramo `verifica` gira PRIMA di `caricaCache()` e non
  pretende il control plane: se `tenant_sedi` manca lo dichiara e salta le
  discordanze delle tabelle (exit `0` se non c'è altro). È il caso normale
  del rapporto di partenza, lanciato su un database dove il WS1 non è mai
  partito;
- stampa un rapporto (tabella; `--json` per il formato macchina) ed esce
  con `1` se trova orfani, discordanze o doppioni, `0` altrimenti, `2` per
  uso errato. Non esegue DDL (usa il repository con `creaSchema: false`,
  come gli altri sottocomandi).
  **(esecuzione, R15)** Per l'automazione la forma è
  `pnpm --silent tenant verifica --json` (oppure
  `npx tsx scripts/tenant.ts verifica --json`): senza `--silent`, pnpm
  scrive il proprio banner prima del `{` e, a exit 1, la riga `ELIFECYCLE`
  dopo — lo stdout non è JSON valido. L'exit `1` resta in ogni forma: sotto
  `set -e` va gestito.

Va lanciata prima del deploy (rapporto di partenza: tutto a `tenantId`
assente è atteso), dopo il deploy a interruttore spento (zero record senza
`tenantId`, zero righe a NULL nelle tabelle esistenti) e dopo
l'accensione.

## 8. Interruttore, boot, rilascio

- `FLAG_MULTI_AZIENDA` resta l'unico interruttore, con la semantica del WS1
  (`interruttoreAttivo("multiAzienda")`, fail-closed). Spento: contesto
  mono-azienda, tenant 1 ovunque, Proxy che risolve sempre il tenant 1,
  worker che passano da `conTenantDellaSede` senza effetto. Acceso: contesto
  per richiesta, istanze per tenant, guardie, tenant ≥ 2 ammessi.
- Ordine in produzione (runbook `docs/runbooks/multi-azienda.md`, sezione
  «WS2 — archivi per tenant»): (1) backup Drive riuscito nelle 24 ore;
  (2) `pnpm tenant verifica` di partenza; (3) deploy a interruttore spento —
  al boot, PRIMA del `listen`: seed della riga `tenants` del tenant 1 (R13),
  specchio `tenant_sedi`, colonne, indici e trigger, con la riga
  `[tenants] tabelle: …`; DOPO il `listen`, in sottofondo: il backfill di
  `tenant_id`, con la riga `[tenants] backfill tenant_id: …` (R14) — quindi
  il passo (4) va fatto **dopo** aver visto la seconda riga;
  (4) `pnpm tenant verifica`: zero record senza `tenantId`, zero righe a
  NULL; (5) accensione (già fatta se il WS1 è acceso), poi un nuovo login;
  (6) nessun tenant 2 in produzione finché il WS3 non separa storage, backup
  e credenziali: regola di runbook, non gate di codice. Il primo tenant 2
  nasce in staging, con `pnpm tenant crea`.
- Il codice del WS2 funziona anche con il WS1 mai acceso: il backfill e le
  colonne sono indipendenti dall'interruttore.

## 9. Errori

| Situazione | Dove | Esito |
|---|---|---|
| mutation o upload con tenant sospeso | tRPC, Express | `PRECONDITION_FAILED` / `412`, «Azienda sospesa: il gestionale è in sola lettura.» |
| tenant senza sede attiva | tRPC, Express, SSE | `PRECONDITION_FAILED` / `412`, «L'azienda non ha una sede attiva.» |
| record di un altro tenant per id | router | `NOT_FOUND` («Risorsa non trovata.»): l'istanza non lo contiene, `assertSedeScope` lo conferma |
| accesso a uno store senza tenant nel contesto (interruttore acceso) | `persistence.ts` | `Error` interno, log `[persistence] …`; la richiesta fallisce con `INTERNAL_SERVER_ERROR`, mai dati altrui |
| store non istanziato per un tenant noto | `persistence.ts` | `Error` interno (tenant creato a metà: comando in `errore`) |
| tenant creato a caldo, caricamento di una famiglia fallito | `servizio.crea` | istanze rimosse, comando `errore`, evento `comando_fallito` |
| `pnpm tenant verifica` trova orfani o discordanze | CLI | exit `1`, rapporto |
| script contro database senza control plane | CLI | «Tabelle del control plane del tenant assenti…» (WS1); `verifica` è l'eccezione: gira lo stesso (esecuzione, R1) |

**(esecuzione, R17) Residuo aperto sulla terza riga.** Il contratto «un id di
un altro tenant risponde `NOT_FOUND`» vale oggi in
`server/routers/clienti.ts`, corretto nel Task 14. Negli altri **19 router**
restano **96 siti** che lanciano `throw new Error("… non trovato")`: fuori
da una `TRPCError` diventano `INTERNAL_SERVER_ERROR`, quindi un id di un
altro tenant risponde **500 invece di 404**. Non è una fuga di dati — il
messaggio è identico per un id inesistente e per uno altrui, e l'istanza
dello store non contiene comunque record altrui — ma non è il contratto di
questa tabella. La pulizia (sostituire l'idioma con `TRPCError NOT_FOUND` e
`MESSAGGI.nonTrovato`) è un lavoro a parte, fuori dal WS2: elenco dei siti
nel rapporto del Task 14.

## 10. Test

- **Persistenza** (`server/_core/persistence.tenant.test.ts`, in memoria):
  due tenant con lo stesso store vedono array diversi; `push`/`filter`/
  iteratore/`JSON.stringify`/`length`/indice attraverso il Proxy;
  fail-closed senza contesto con interruttore acceso; interruttore spento =
  tenant 1 senza contesto; `save()` e `conTransazioneStoreAtomica` scrivono
  la chiave del tenant corrente; famiglia globale ignora il contesto;
  registrazione tardiva per ogni tenant; `istanziaStoresPerTenant` con seed
  che riceve `tenantId`; backfill centrale di `tenantId` (contato e
  salvato); `chiaveStore(1, x) === x`; nome `tenant:*` rifiutato.
- **Postgres vero** (`persistence.tenant.pg.test.ts`): le chiavi
  `tenant:2:clienti` finiscono in `kv_store` e la chiave legacy resta
  intatta; `getAllStoreSnapshots` elenca tutte le istanze.
- **Id** (`prossimoId`): unici fra tenant, `maxId` da tutte le istanze,
  store senza id numerici.
- **Guardia** (`regole.test.ts`, `guardieTenant.test.ts`,
  `express.test.ts`): tabella di `motivoRifiutoTenant`; tRPC e le quattro
  rotte Express rispondono con lo stesso messaggio; porta chiusa sparita
  (tenant 2 passa; login del tenant 2 passa).
- **Router incrociati** (`crossSede.test.ts` esteso, `crossTenant.test.ts`):
  utente del tenant 2 con sede propria: liste vuote sui record del tenant
  1, `NOT_FOUND` per id; nessuno schema di input accetta `tenantId`
  (strutturale, già in WS1).
- **Worker**: per ogni riga della tabella in §5.3 un test che, con
  interruttore acceso, il giro per sede passa da `conTenantDellaSede` (spia
  su `tenantCorrente()` dentro il corpo) e che un errore di una sede non
  ferma le altre.
- **Tabelle** (`tabelle.test.ts` strutturale: `TABELLE_PER_SEDE` uguale
  all'inventario estratto dai sorgenti; `tabelle.pg.test.ts` su Postgres
  vero: colonna, indice, trigger che riempie `tenant_id` da `tenant_sedi`,
  backfill delle righe a NULL, tabella assente saltata con log,
  idempotenza di due boot).
- **Specchio**: `sincronizzaTenantSedi` idempotente, sede nuova subito
  visibile al trigger.
- **Verifica CLI** (`verifica.test.ts` pura: orfani, doppioni, discordanze,
  exit code; `cli.test.ts` per il parsing).
- **Boot** (`boot.test.ts`): `preparaTenants` → `bootstrapAll` →
  `completaTenants` nell'ordine, con interruttore spento istanzia solo il
  tenant 1.
- **Tars** (`contesto.tenant.test.ts` esteso): `eseguiRun` gira dentro il
  contesto del tenant del run.
- `pnpm check`, `pnpm test`, `pnpm build` verdi; baseline dei 3 test HEIC
  legati alla macchina.

## 11. File toccati

Aggiornata a fine esecuzione (07/09/2026): la colonna dice che cosa c'è
davvero nel branch, non che cosa era previsto.

| File | Modifica |
|---|---|
| `server/_core/persistence.ts` | famiglie e istanze, `chiaveStore`, Proxy, `ambito`, `LoadMeta.tenantId`, backfill centrale opt-in (R6), `prossimoId`/`riservaIdFinoA`, `bootstrapAll({ tenantIds, backfill })`, `istanziaStoresPerTenant`, `storeDi`, `impostaResolverTenant`, `tenantsNoti`, `leggiBlobDaDb`/`elencaChiaviDaDb`, snapshot con `nome`/`tenantId` |
| `server/tenants/contestoCorrente.ts` (nuovo) | FOGLIA (R9): `conTenant`, `tenantCorrente`, `modalitaTenantStretta`, auto-registrazione del resolver |
| `server/tenants/giri.ts` (nuovo, R9) | `conTenantDellaSede`, `tenantsAttivi`, `perOgniTenantAttivo` |
| `server/tenants/regole.ts` | `motivoRifiutoTenant`, `tenantDelContesto`, `righeTenantSedi`; via `portaChiusaPerTenant` |
| `server/tenants/express.ts` (nuovo) | `rifiutaTenant(res, ctx, op)`, `conTenantDelContesto(ctx, fn)` |
| `server/tenants/tabelle.ts` (nuovo) | `TABELLE_PER_SEDE`, `applicaTenantIdAlleTabelle` (solo DDL), `backfillTenantIdSulleTabelle` (R14) |
| `server/tenants/verifica.ts` (nuovo) | logica pura del rapporto: `tenantDellaChiave`, `verificaStore`, `rapportoBlobNonValido`, `riassumi`, `formattaRapporto` |
| `server/tenants/repository.ts` | tabella `tenant_sedi`, `sincronizzaTenantSedi` (scrittura), `assicuraTenantPredefinito` chiamato anche a flag spento (R13) |
| `server/tenants/servizio.ts` | `istanziaStoresPerTenant` in `crea`, `sincronizzaTenantSedi` dopo la sede, pulizia in caso di errore |
| `server/tenants/boot.ts` | `preparaTenants`, `completaTenants`, `applicaSchemaTabelleTenant`, `avviaBackfillTabelleTenant` |
| `server/_core/index.ts` | nuovo ordine di boot, `impostaResolverTenant`, giri al boot per tenant (R8), backfill delle tabelle dopo il `listen` (R14) |
| `server/_core/trpc.ts` | guardia con `motivoRifiutoTenant` + `conTenant` |
| `server/routers.ts` | via la porta chiusa dal login |
| `server/_core/commessaFileRoutes.ts`, `anteprimaRoutes.ts`, `allegatoMailRoutes.ts`, `server/notifications/sse.ts` | `rifiutaTenant` + `conTenantDelContesto` |
| i file della tabella §5.3 | corpo per tenant (`perOgniTenantAttivo`) e per sede (`conTenantDellaSede`) |
| `server/tars/orchestratore.ts` (`eseguiRun`) | cintura `conTenant(contesto.tenantId, …)` |
| `server/routers/clienti.ts` | 4 «non trovato» → `TRPCError NOT_FOUND` (R17) |
| 7 dichiarazioni di store globali | `{ ambito: "globale" }` |
| `server/comunicazioni/whatsapp.ts` | seed con `meta.tenantId` |
| 29 moduli con `nextId` (23 del piano + 6) | `_store.prossimoId()` |
| `scripts/tenant.ts`, `server/tenants/cli.ts` | sottocomando `verifica` |
| `server/_core/sorgentiDiProva.ts` (nuovo, R2) | `fileSorgente`, `relativo`, `RADICE` per i test strutturali |
| `server/_core/contestoDiProva.ts` | `conTenantDiProva` |
| `docs/runbooks/multi-azienda.md`, PRD §60.10, `handoff.md`, `CLAUDE.md` (regola del contesto implicito), `docs/tars/architettura-tars-v2.md` | documentazione |

## 12. Rischi e limiti noti

- **Contesto implicito**: chi scrive codice fuori richiesta deve avvolgerlo
  in `conTenant`; l'errore è rumoroso (fail-closed) e i test per worker lo
  intercettano. Regola in `CLAUDE.md`: «ogni punto d'ingresso fuori
  richiesta dichiara il tenant con `conTenant`/`conTenantDellaSede`».
- **Memoria per tenant**: tutto in memoria; con decine di tenant servirà il
  caricamento pigro (accesso asincrono agli store: cambio profondo, WS8).
- **Specchio non transazionale**: `tenant_id` può restare a NULL per una
  finestra breve; niente `NOT NULL`; verifica e backfill al boot.
- **Tabelle pigre**: colonna e trigger arrivano al boot successivo.
- **Librerie con callback propri** (IMAP, WebSocket): il contesto si perde
  al confine; ogni gestore va avvolto (checklist §5.3).
- **`structuredClone` e identità del Proxy** (§3.9).
- **Backup globale**: fino al WS3 un archivio unico contiene tutti i tenant
  (accesso solo direzione del tenant 1: motivo in più per non avere tenant
  2 in produzione prima del WS3).
- **Una replica**: come nel WS1 (cache e cicli in-process).
- **Deviazione dal design madre** (§2 decisione 1): registrata nel PRD §60;
  la rinomina a chiavi uniformi resta possibile in futuro con un solo
  `UPDATE` reversibile, se mai servisse.

**Aggiunti dall'esecuzione (07/09/2026).**
- **96 «non trovato» a 500** in 19 router (§9, R17): un id di un altro
  tenant risponde `INTERNAL_SERVER_ERROR` invece di `NOT_FOUND`. Nessuna
  fuga di dati, ma non è il contratto: pulizia a parte, prima del WS3.
- **`Sede …/Utenti.json` del backup** include, in ogni sede, gli utenti
  senza `sediIds` di **tutti** i tenant: `utenti` è globale e il backup lo è
  fino al WS3. Motivo in più per non avere un tenant 2 in produzione prima
  del WS3.
- **`riavviaWatchers` (IMAP) non è atomico** con due o più tenant: fra un
  tenant e l'altro c'è una finestra di microtask senza guardia di rientro.
  Con un tenant solo non si vede.
- **Il backfill delle tabelle rigira a ogni boot**: quando non c'è più nulla
  da riempire costa una manciata di query a vuoto in sottofondo.
- **`tenant_id` non si aggiorna mai** dopo il primo timbro: se un giorno una
  sede cambiasse tenant, le righe già timbrate resterebbero al tenant
  vecchio. Oggi una sede non si sposta (si disattiva).

## 13. Cosa viene dopo

Il piano (`docs/superpowers/plans/2026-09-07-ws2-porta-aperta.md`) ha
scomposto questa spec in 15 task con test, tutti eseguiti il 07/09/2026 sul
branch `feature/ws2-porta-aperta`. Restano fuori, in ordine: la pulizia dei
96 «non trovato» a 500 nei 19 router (§9, R17) e poi il **WS3** — prefissi e
byte dello storage, backup ed export per tenant, `state` OAuth persistito,
retry e dead-letter per tenant.
