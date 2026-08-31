# Tars v2 — architettura e contratti (T0)

> Redatto il 29/08/2026 sul mandato Tars v2 della direzione, dopo il merge
> della base (`84717e2`: authz economica, Document Intelligence D7,
> approval gateway, kill switch). Questo documento è la SPEC di T1-T9:
> ogni slice implementa ciò che qui è deciso, e ogni divergenza va
> registrata qui prima del codice. Il prompt runtime NON è questo
> documento: sarà compatto, versionato e valutato con eval.

> **Riallineamento T0, 31/08/2026.** Questa è la specifica corrente del
> runtime presente in `server/tars/`, non il registro della rimozione storica
> del 28/08. La matrice verificata dominio→servizio→tool è
> [`matrice-azioni-tars.md`](matrice-azioni-tars.md); conserva con precisione
> ciò che esiste, ciò che è solo proposta e ciò che manca. Nessuna voce
> storica può essere usata per dedurre che il runtime corrente sia assente.

## 1. Identità e perimetro

Tars è il cervello operativo di Ruffino Flow: comprende la situazione
aziendale attraverso strumenti tipizzati e autorizzati, collega i dati dei
reparti, risponde con evidenze, individua anomalie, prepara e coordina il
lavoro, esegue direttamente le azioni sicure richieste. Non è un chatbot,
non è un superutente, non sostituisce state machine, FiC o i configuratori
dei produttori, non è un secondo database. «Nessuna azione» è un risultato
valido.

**Architettura a orchestratore centrale UNICO** (decisione di mandato):
niente rete di agenti nel primo rilascio; una eventuale evoluzione
multi-agent richiede eval che dimostrino un limite preciso del singolo
orchestratore.

## 2. Collocazione nel codice

```
server/tars/
  openai/adapter.ts        ← unico punto di contatto col provider (DI)
  openai/fake.ts           ← provider deterministico per test/eval
  orchestratore.ts         ← loop del run: contesto→modello→tool→risposta
  profili.ts               ← profili strumenti (piccoli, per superficie)
  strumenti/               ← definizioni tipizzate (registro chiuso)
  contesto.ts              ← principal, sede, capability fingerprint, budget
  conversazioni.ts         ← persistenza conversazioni/turni (CRM-side)
  cache/                   ← C0 fingerprint, C1 per-run, C2 prompt caching
  telemetria.ts            ← metriche run/cache senza PII
  prompt/v1.ts             ← prompt di sistema versionato
server/routers/tars.ts     ← router tRPC sottile (valida, autorizza, invoca)
client/src/pages/Tars.tsx  ← pagina /tars (T1 minimale)
```

Regole: il router non contiene logica; l'orchestratore non conosce tRPC;
gli strumenti non conoscono il modello; NIENTE nei router business.

Nota di layout (T1, registrata in T2): conversazioni/turni/run/telemetria
vivono insieme in `archivio.ts`; C0 e C1 vivono nell'orchestratore (LRU
in-process, come da §10 «Storage»); il prompt corrente è `prompt/v2.ts`
(v1 conservato come storia). Parità comportamentale con questo §2; la
separazione in file dedicati si fa quando C3/C4 (T3) la rendono reale.
In T2 si aggiunge `tempo.ts` (risoluzione deterministica delle
espressioni temporali italiane) e `strumenti/promemoria.ts` (azioni L1).

## 3. Provider OpenAI

- **Responses API server-side** (ragionamento, function calling,
  Structured Outputs, streaming). La documentazione corrente si consulta
  al momento dell'implementazione: nessun parametro copiato dal vecchio
  `server/_core/llm.ts`.
- **`store:false` come obiettivo iniziale**: conversazioni e stato SOLO
  nel CRM; replay controllato della cronologia necessaria; gestione degli
  eventuali reasoning item cifrati come blob opachi legati al run;
  compaction dopo milestone. Nessun vector store del provider, nessun
  upload permanente di documenti senza decisione privacy esplicita.
- `safety_identifier` stabile e privacy-preserving: hash HMAC di
  (utenteId, sedeId) con chiave server, mai dati leggibili.
- **Adapter con dependency injection**: `TarsProvider` è un'interfaccia
  (`rispondi(run) → stream eventi`); l'implementazione OpenAI legge la
  chiave SOLO da env al momento della chiamata; il fake deterministico
  (script di scenari) serve test, eval offline e sviluppo. Con
  `FLAG_TARS=off` o chiave assente l'adapter reale non viene MAI
  istanziato: nessuna chiamata involontaria. L'uso reale della chiave
  residua di produzione è un gate della direzione (modello, budget,
  momento) — fino ad allora solo fake.
- Modelli e budget da configurazione, mai slug nel codice:
  `TARS_MODEL_INTERACTIVE`, `TARS_MODEL_AUTOMATION`,
  `TARS_REASONING_INTERACTIVE`, `TARS_REASONING_AUTOMATION`, budget
  output/tool-call, timeout, fallback. Scelte definitive solo dopo eval
  comparativi su due configurazioni; reasoning elevato solo dove gli eval
  mostrano guadagno; snapshot stabili in produzione; modello e config
  registrati per ogni run.

## 4. Fonti autorevoli e conflitti

Vale `docs/source-of-truth-matrix.md`. In sintesi operativa: le regole
software (state machine, gate, permessi, formule, idempotenza) sono
deterministiche e il modello non le reinterpreta; FiC è autorevole per il
fiscale; i configuratori dei produttori per le configurazioni tecniche;
l'ordine CRM per l'ordine emesso; la conferma originale per il ricevuto;
il confronto è derivato e mostra le prove; le comunicazioni originali per
ciò che il mittente ha scritto; le correzioni umane verificate battono le
inferenze; le inferenze di Tars sono il livello meno autorevole. Conflitto
fra fonti autorevoli = mostrato, mai risolto in silenzio: fonti
identificate, processo aziendale indicato, azione proposta secondo il
rischio, decisione umana tracciata.

## 5. Autorizzazione

- Il principal del run è l'utente autenticato: `sedeId`, ruoli, capability
  effettive via `effectiveCapabilitySet`/`authorizeCoreOperation` con
  `legacyAllowed:"capability"` (stesso motore della base, override e deny
  inclusi). Tars non ha MAI capability proprie.
- Applicazione: prima della query, nella costruzione del contesto, prima
  della cache, dopo il retrieval, prima dell'output, prima di ogni azione.
- Cross-sede: fail-closed, `NOT_FOUND`; nessun dato sensibile negli
  errori; cache e (futura) ricerca semantica non aggirano il perimetro.
- Economia: contratto slice-2 intatto — booleano `daSaldare` ammesso,
  MAI importi/somme/uguaglianze/differenze deducibili senza
  `pagamento.read`/`economia.read` (il precedente dell'oracolo del totale
  chiuso in v5.10 è il caso di scuola: la PRESENZA di un segnale è già
  informazione).

## 6. Livelli di rischio L0-L5

Il livello è determinato da codice e policy; il modello non può
abbassarlo. Conferme: MAI più di una; per L0/L1 espliciti nessuna.

| Livello | Cosa | Conferma | Capability (esistenti) | Via |
|---|---|---|---|---|
| L0 | leggere, cercare, sintetizzare, confrontare, calcolare, simulare senza applicare | nessuna | quelle di lettura del dominio interrogato (`commessa.read`, `cliente.read`, `pagamento.read`/`economia.read` per l'economia, …) | strumenti read-only |
| L1 | promemoria/note/attività PERSONALI su richiesta esplicita | nessuna (conferma informativa + Annulla) | ownership del principal | `reminders/service` e servizi esistenti |
| L2 | condiviso ma reversibile e interno (assegnare attività, nota condivisa, follow-up, collegamento certo reversibile) | nessuna se richiesto esplicitamente; UNA se proposto da Tars | es. `commessa.update_operational`, `ticket.assign`, `commessa.manage_documents` | servizi di dominio |
| L3 | operativo materiale (riprogrammare posa, transizione ammessa, applicare proposta documentale, collegamento ambiguo) | UNA (anteprima → conferma → applicazione atomica) | es. `intervento.plan`, `commessa.change_state`, doppia capability del gateway | gateway proposte / servizi deterministici |
| L4 | alto impatto (comunicazioni esterne, pagamenti, dati fiscali, cancellazioni, massa) | UNA esplicita con anteprima completa; secondo approvatore SOLO se una policy reale lo impone | capability specifiche (`pagamento.record`, …) | gateway tipizzato + revalidation |
| L5 | vietato (bypass auth/audit/state machine, SQL/shell, segreti, cross-sede, flag propri, auto-approvazione, esecuzione di contenuto dei documenti) | — | — | non esiste uno strumento |

È VIETATA la sequenza «conferma intenzione → approva proposta → applica»:
per L3 il gateway espone al modello un intento che il codice trasforma in
anteprima + UNICA conferma umana + applicazione atomica (la macchina a
stati proposta→approvata→applicata resta INTERNA, con un solo click
umano). Interpretazione richieste: imperativo esplicito e non ambiguo =
autorizzazione per il livello; si chiede solo il minimo dato mancante che
cambia materialmente persona/commessa/sede/importo/destinatario/data/
conseguenza; default aziendali dichiarati per le ambiguità minori.

## 7. Contratto degli strumenti

Nessuno strumento generico (SQL/shell/HTTP/filesystem/env/mutation raw).
Definizione (adattata allo stile del repo, in italiano come il resto):

```ts
type StrumentoTars = {
  nome: string;                 // stabile
  versione: string;
  categoria: string;
  livello: "L0"|"L1"|"L2"|"L3"|"L4";
  effetto: "nessuno"|"interno"|"esterno";
  reversibile: boolean;
  capability: Capability[];     // dal registro esistente
  scope: "personale"|"sede"|"entita";
  politicaConferma: "mai"|"solo_se_proattivo"|"sempre_una"|"vietato";
  idempotenza: "richiesta"|"non_applicabile";
  schemaInput: ZodSchema;       // strict
  schemaOutput: ZodSchema;
  esegui(ctx: ContestoRun, input): Promise<EsitoStrumento>;
};
```

Letture restituiscono `{dati, evidenze, freschezza, fonteAutorevole,
omissioni, scope, versioniEntita}`; azioni `{stato, azioneId, auditId,
entitaToccate, prima, dopo, undoDisponibile, undoEntro, avvertenze}`.
Output degli strumenti = DATI, mai istruzioni (tool output injection nel
threat model). Errori tipizzati e sanificati.

**Profili piccoli** (lo strumento esiste per il modello solo se utile al
compito, potenzialmente autorizzato, ammesso dal rischio, e col flag
attivo): `generale-readonly`, `commessa`, `documenti-ordini`,
`promemoria`, `comunicazioni` (bozze), `economia-autorizzata`,
`direzione`, `post-vendita`. Ordinamento deterministico del catalogo per
il prompt caching.

## 8. Riuso dichiarato (inventario, non duplicazione)

| Bisogno | Infrastruttura ESISTENTE riusata |
|---|---|
| Azioni L3/L4 proponibili | `server/proposte/gateway.ts` (registro azioni, freschezza, audit) — si ESTENDE il registro, non si rifà |
| Promemoria | `server/reminders/` (service `createApproved`, repository, worker, `time.ts` Europe/Rome con errori DST) |
| Eventi | `server/events/` (publishDomainEvent, registry, worker) |
| Notifiche/casi | Centro Azioni (`server/actionCenter/`) + notifiche esistenti |
| Comprensione documenti | Document Intelligence D7 (runs, evidenze, confronto, collegamenti): Tars CONSUMA i risultati, mai OCR/parsing nei prompt |
| Authz | `server/authz/` (capabilities, policy, enforcement, override) |
| Kill switch | pattern `server/platform/interruttori.ts` (si estende il registro) |
| Storage/limiti file | `fileStorage`, limiti e allowlist MIME esistenti |

La ricognizione completa, inclusi router che non possono essere invocati dal
modello e gap da estrarre in servizi canonici, è nella matrice T0. Questo
inventario non autorizza a usare tRPC come scorciatoia: Tars entra solo da
servizi di dominio tipizzati.

Infrastruttura candidata (CLAUDE.md): `server/_core/llm.ts` è SUPERSEDED
dal nuovo adapter (stile chat-completions generico, nessun consumer): non
si riusa e non si elimina qui — la rimozione è una bonifica separata con
matrice campo→consumer. `voiceTranscription.ts` e `imageGeneration.ts`
restano candidati fuori dal perimetro del primo rilascio.

## 9. Runtime del run

Ogni run conosce: utente, sede, ruoli, capability effettive (fingerprint),
entità contestuale, canale, lingua, fuso, profilo strumenti, livello di
rischio massimo, versioni (prompt/policy/strumenti/schema), budget
residuo. Loop limitato (max tool-call configurabile), timeout per passo e
totale, retry selettivi solo su errori transitori del provider, circuit
breaker (aperture su errori consecutivi → degradazione), streaming verso
il client, idempotency key per le azioni, risposta finale anche in
degradazione («non ho potuto completare X; ecco cosa so e cosa manca»).
Con OpenAI irraggiungibile o `FLAG_TARS=off`: il CRM non se ne accorge
(nessuna dipendenza di avvio), la UI mostra stato comprensibile, i
processi deterministici continuano.

## 10. Caching C0-C6

Obiettivo: latenza, costo, token, query e stabilità SENZA toccare
autorizzazione, freschezza, isolamento, audit. L'autorizzazione si
verifica prima di leggere la cache e prima di restituire.

- **C0 (T1)** — evitare il modello: fingerprint del contesto rilevante
  (entità+versioni+capability+prompt/tool version); se nulla è cambiato e
  la domanda è deterministica → risposta senza model call («zero model
  call» è il miglior hit). Matching deterministico prima del modello.
- **C1 (T1)** — per-run: dedup delle tool call identiche (chiave:
  tool+versione+input normalizzato+sede+principal+capability
  fingerprint+versioni entità), promise deduplication, niente errori
  cachati, vita = il run.
- **C2 (T1)** — prompt caching OpenAI: prefisso stabile (istruzioni →
  catalogo strumenti ordinato → contesto dinamico in coda), profili
  piccoli versionati, chiave
  `tars:<env>:<model>:<promptV>:<toolProfileV>:<policyV>:<capHash>` senza
  PII; misurare `cached_tokens`/`cache_write_tokens`/hit/costo/latenza
  PRIMA di attivare breakpoint espliciti ovunque.
- **C3 (T3)** — fascicoli sintetici persistenti per entità (fatti
  strutturati + fonti + versioni + open questions + fingerprint);
  ricostruzione solo su input cambiati; su errore si conserva l'ultima
  versione valida marcata stale, mai usata per azioni critiche.
- **C4 (T3)** — cache cross-run con chiave minima
  sede+principal+authzFingerprint+scope+toolV+schemaV+policyV+promptV+
  inputHash+entityVersions; condivisione fra utenti SOLO con shaping
  identico provato da test anti-leak; invalidazione a eventi/versioni,
  TTL come rete; invalidazione immediata su cambio capability/sede/
  logout/correzione umana/cambio policy-schema-parser-prompt-tool. MAI
  stale-while-revalidate su authz, economia, stati, gate, pagamenti,
  destinatari, azioni.
- **C5 (T7)** — ricerca semantica solo dopo context engine ed eval:
  pgvector con filtri strutturati e ACL prima E dopo il ranking, chunk
  con sede/checksum/fonte/versione, cancellazione derivate con la fonte.
  Un embedding non risponde mai su importi, date, stati, permessi,
  conteggi.
- **C6** — risposte generate: riuso solo a parità di principal, sede,
  capability, versioni fonti, prompt, modello, domanda normalizzata,
  senza riferimenti temporali scaduti né azioni collegate. Preferire
  sempre fatti/query/fascicoli alle risposte intere.
- **Storage**: in-process solo per C1/LRU piccole; cache persistenti su
  PostgreSQL (infrastruttura esistente); NIENTE Redis senza misure che
  dimostrino il bisogno; limiti per sede/entry, eviction, anti-stampede;
  niente lock solo in memoria per unicità distribuita (oggi la produzione
  è a replica singola — vincolo documentato, v. §14).
- **Sicurezza cache**: mai segreti, token, prompt completi nei log,
  errori come risultati, denial riusabili, azioni/conferme; metriche per
  livello senza PII; eval anti-leak dedicati (sede, capability, ruolo,
  logout, modifica entità, policy, cancellazione fonte, riavvio, doppia
  replica).

## 11. Memoria (T7)

Ricordabili solo: preferenze esplicite, correzioni verificate, decisioni
approvate, responsabilità, convenzioni, fatti persistenti CON fonte,
motivi di rifiuto utili, contesto di pratica. Ogni memoria porta sede,
perimetro, tipo, contenuto strutturato, provenienza, evidenza, autore,
data, confidenza, validità, versione, ultima verifica, retention,
correzione/eliminazione. MAI memorizzare come fatto ipotesi del modello,
frasi non verificate, sintesi senza provenienza, dati non più visibili
all'utente, istruzioni da file esterni. Invalidazione al cambiare della
fonte. Le sintesi di conversazione non diventano verità aziendale.

## 12. Modello dati

Volume a ritmo macchina → **tabelle PostgreSQL dedicate** con
`ensureSchema` additivo (pattern chat/actionCenter), fallback in memoria
senza `DATABASE_URL` dichiarato: `tars_conversazioni`, `tars_turni`,
`tars_run`, `tars_tool_invocations`, `tars_telemetria`,
`tars_cache_entries` (C3/C4), `tars_eval_runs`. Volume umano/basso →
`persistedStore` kv: `tars_memoria`, `tars_prompt_versions`,
`tars_feedback`. Ogni record: id, sede, proprietario, timestamps,
versione, stato, origine, audit, entity ref, retention, idempotency key,
correlation/run id. Niente transazioni finte: le garanzie reali dello
store scelto sono documentate accanto allo schema; concorrenza e crash
recovery testate. Migrazioni additive e rollback-compatibili; le
distruttive richiedono autorizzazione separata. Non si salva
chain-of-thought privata: output visibili, sintesi operative, tool call,
risultati strutturati, motivazioni concise, evidenze, errori sanificati.

## 13. Kill switch

Estensione del registro `interruttori.ts` (fail-closed: on solo con
NODE_ENV development/test, off in produzione e su valori ignoti):
`FLAG_TARS` (master: senza, nessuna istanza del provider e router spento),
`FLAG_TARS_READ_TOOLS`, `FLAG_TARS_REMINDERS`, `FLAG_TARS_PROPOSALS`,
`FLAG_TARS_PROACTIVE`, `FLAG_TARS_COMMUNICATIONS`,
`FLAG_TARS_SEMANTIC_SEARCH`. Server-side sempre; UI seconda barriera;
Tars non può leggere/modificare i propri flag via strumenti.

## 14. Threat model (minacce → mitigazioni)

| Minaccia | Mitigazione |
|---|---|
| Prompt injection da PDF/email/allegati | contenuto = dato inerte; nessuna istruzione da tool output; frasi ostili restano frammenti di evidenza (già provato dagli eval D7); eval adversarial dedicati |
| Tool output injection | schema output strict, testo mai promosso a istruzione, sanificazione |
| Cross-sede / escalation capability | motore authz a ogni passo, NOT_FOUND, capability fingerprint nelle chiavi cache, eval leakage |
| Deduzione economica (oracoli) | shaping prima dell'output, niente segnali la cui presenza riveli cifre (precedente v5.10), eval di deduzione |
| Cache poisoning/confusion | chiavi con versioni+authz, niente errori cachati, invalidazione a eventi, test anti-leak |
| Replay / doppia applicazione / azioni stale | idempotency key, freschezza del gateway, revalidation all'applicazione, conferme non riusabili |
| Race su repliche | oggi replica singola (vincolo verificato in checklist); lease persistenti prima di ogni scale-out (T2 scheduler) |
| Cost/DoS | budget token e tool-call per run, rate limit per utente e sede, timeout, circuit breaker |
| Log sensibili | telemetria senza PII, prompt mai nei log, errori sanificati |
| Allucinazione | evidenze obbligatorie per le affermazioni rilevanti, «dato mancante» come esito, mai «nessun problema» per assenza di dati |
| Indisponibilità OpenAI | degradazione totale, CRM indipendente, risposta di stato |
| File malevoli (zip, macro, path traversal, SSRF) | registro parser allowlist, nessuna esecuzione contenuti, limiti tempo/memoria/pagine, niente HTTP arbitrario |

## 15. Osservabilità

Per run: run/trace id, sede anonimizzata, profilo, modello, reasoning,
versioni (prompt/tool/policy), strumenti usati, tempi, retry, token
(cached/write inclusi), costo stimato, stato, errore tipizzato, numero
evidenze, azioni proposte/eseguite, conferme richieste/evitate, undo,
feedback. Mai come label: email, telefoni, nomi, testi, prompt, entity id
ad alta cardinalità. Viste diagnostiche per direzione (run falliti, code,
cache, costi, latenza, qualità, kill switch, rollout).

## 16. Eval

Dataset versionato; fake provider deterministico per il grosso; casi
OpenAI reali SOLO su autorizzazione (gate chiave/budget). Categorie:
capacità (fatti, ricerca, fascicolo, state machine, gate, confronto
documenti, cross-domain, scelta strumenti e NON-uso, promemoria, bozze,
proposte, rifiuti, evidenze, dati mancanti, conflitti), autorizzazione
(ruoli, override, cambio sede/ruolo, record inesistenti/altrui, economia
omessa e deduzioni, cache di altri, semantica non autorizzata),
promemoria (date relative, DST, ricorrenze, concorrenza, downtime,
doppio evento), sicurezza (injection, SQL/segreti richiesti, replay,
stale, doppia applicazione, costi, loop, offline), **attrito** (misurato:
promemoria esplicito=0 conferme, personale=0, condivisa esplicita
reversibile=0/1 da policy, proposta da Tars=1, materiale=1, esterno=1,
vietato=0+rifiuto; un aumento ingiustificato delle conferme è una
regressione). Metriche: groundedness, precision/recall anomalie, tool
selection/argument accuracy, authorization leakage, action success,
idempotenza, FP/FN, utilità, domande inutili, numero conferme, latenza,
costo, token, cache hit, undo rate, feedback. I sintetici non dichiarano
accuratezza reale.

## 17. UX

Pagina `/tars` (T1: conversazione + stato funzioni + azioni eseguite;
poi briefing/situazioni/promemoria/proposte) + pannello contestuale nelle
superfici principali (T3+). Risposte: conclusione prima, poi prove;
freschezza e omissioni dichiarate; pulsante Annulla dove disponibile;
UNICA conferma dove richiesta; italiano; tono diretto, calmo, operativo,
mai teatrale né servile; errori riconosciuti con fonte corretta.
Accessibilità e responsive come da CLAUDE.md; superfici nuove ispezionate
visivamente.

## 18. Piano T1-T9 (exit criteria nel mandato §33)

T1 runtime read-only (adapter+orchestratore+conversazioni+strumenti
L0+evidenze+telemetria+budget+kill switch+C0/C1/C2+`/tars`); T2
promemoria L1 su `server/reminders` (zero approvazioni, DST, scheduler,
idempotenza, undo, attrito); T3 fascicoli+C3/C4+pannello contestuale; T4
briefing/situazioni/proattività shadow; T5 azioni L2 + gateway L3/L4
(UNA conferma); T6 strumenti DI+comunicazioni (invio L4); T7 memoria+
ricerca ibrida; T8 shadow+pilot; T9 rollout per capability con soglie,
osservazione, rollback, owner, esito. DoD complessiva = §37 del mandato.

## 19. Decisioni registrate in T0

1. Orchestratore unico, niente multi-agent nel primo rilascio.
2. `store:false`; stato nel CRM; tabelle PG dedicate per il volume
   macchina, kv per il volume umano.
3. `llm.ts` superseded dal nuovo adapter (rimozione = bonifica separata);
   `voiceTranscription`/`imageGeneration` fuori perimetro.
4. Kill switch Tars nel registro `interruttori.ts` esistente.
5. Provider dietro DI con fake deterministico; NESSUNA chiamata reale
   fino al gate chiave/budget della direzione.
6. Il gateway proposte D7 è IL gateway di Tars per L3/L4: si estende il
   registro azioni (un intento → una conferma → applicazione atomica).
7. Promemoria: si riusa `server/reminders` così com'è; il parsing
   temporale di Tars produce input per quel service, non un nuovo motore.
8. Replica singola come vincolo di produzione corrente: ogni componente
   nuovo che assuma di più (lease, lock) lo dichiara e lo testa.

## 20. Decisioni registrate in T2 (promemoria L1)

9. **Riuso con estensione additiva dichiarata**: `server/reminders`
   resta il motore; si aggiungono SOLO metodi di lettura
   (`listPersonal`, `get`) a repository e service per l'agenda
   («questa settimana») e per prima/dopo delle azioni. Nessuna modifica
   allo schema `promemoria`: il collegamento resta commessa/cliente
   (campi esistenti); ordini e documenti si citano nel testo del
   promemoria finché una decisione non estende lo schema.
10. **Parsing temporale deterministico lato server** (`server/tars/tempo.ts`):
   il modello passa l'espressione dell'utente così com'è; il server la
   risolve con due semantiche distinte — *calendario* (data+ora locali
   Europe/Rome, convertite con `parseRomeLocalDateTime` esistente: gli
   errori DST `REMINDER_LOCAL_TIME_INVALID`/`AMBIGUOUS` restano la
   verità) e *durata* («tra due ore» = istante esatto, immune ai cambi
   d'ora). Default aziendali DICHIARATI (sempre riportati come
   assunzioni nell'esito): mattina=09:00, pomeriggio=15:00, sera=18:00,
   giorno senza orario=09:00, solo-orario già passato oggi→domani,
   giorno della settimana=prossima occorrenza (oggi se ancora futura).
11. **Idempotenza della creazione**: `canonicalKey` deterministica
   `tars:u<utente>:<hash(testo normalizzato|istante)>`; il vincolo
   `UNIQUE (sede_id, canonical_key)` del repository è la garanzia; il
   doppio invio restituisce «già esistente» (0 duplicati). La
   ricreazione dopo un annullo usa la catena deterministica
   `:dopo<idPrecedente>` (stessa doppia richiesta → stessa catena →
   stessa dedup).
12. **Nessuno scheduler nuovo**: consegna via worker esistente
   (`claimDue` con `FOR UPDATE SKIP LOCKED` = transizione atomica su
   PG; dedupe notifiche per `reminder:<id>:<revision>`); replica
   singola documentata (§14). Edge dichiarato: uno spostamento sull'ora
   locale ripetuta d'autunno viene rifiutato con errore onesto, non
   indovinato.
13. **Undo L1**: undo della creazione = annullamento immediato; la UI
   mostra «Annulla» che chiama il router `promemoria.cancel` ESISTENTE
   (zero passaggi dal modello). L'annullamento non è reversibile (si
   ricrea): dichiarato nell'esito con testo e orario per ricreare.
14. **C0 e azioni**: i run che eseguono azioni NON entrano in C0 (una
   risposta con effetti non è una «domanda deterministica»); C1 resta
   attiva nel run come guardia anti doppia tool call. Prompt `v2` e
   profilo `l1-v1`: le versioni nelle chiavi invalidano C0/C2 da sole.

## 21. Decisioni registrate in T3 (fascicoli, C3/C4, pannello)

15. **Fascicolo commessa al pavimento di capability**: il fascicolo C3
   contiene SOLO fatti visibili a chiunque abbia `commessa.read`
   (stato, gate, transizioni, ordini senza importi, date, `daSaldare`
   booleano sanzionato, domande aperte deterministiche). NIENTE
   economia e NIENTE derivati direzione-only (nemmeno conteggi delle
   analisi DI: la loro esistenza è informazione). Così il fascicolo è
   condivisibile a livello di sede per costruzione — il caso «shaping
   identico provato da test anti-leak» richiesto da C4 — e l'economia
   resta solo nelle letture vive sagomate (`leggi_commessa`).
16. **Storage C3/C4**: tabella `tars_cache_entries` (§12) con campo
   `tipo` (`fascicolo` oggi; altri consumatori domani), fallback in
   memoria dichiarato; ogni voce porta sede, chiave, payload, versioni
   osservate, marcatura stale, timestamps.
17. **Invalidazione = verifica delle versioni alla lettura**, non TTL
   cieco: il registro `versioni.ts` sonda a costo trascurabile le
   versioni correnti (commessa/ordine → `updatedAt`; lista ordini di
   una commessa → hash id+versione, così un ordine NUOVO invalida). Si
   ricostruisce solo su input cambiati; su errore di ricostruzione si
   serve l'ultima versione valida MARCATA stale (mai per azioni).
   L'aggancio agli eventi di dominio arriva con la proattività (T4)
   come ottimizzazione, non come fondamento di correttezza.
18. **C4 = meccanismo attivo, consumatori misurati**: chiavi, store,
   versioni e test anti-leak sono implementati e il fascicolo C3 ne è
   il primo consumatore reale. NON si avvolgono in cache le letture
   in-memory dei tool (microsecondi: rischio senza guadagno, coerente
   con «niente Redis senza misure» §10). Nuovi consumatori C4 si
   aggiungono quando esiste una lettura davvero costosa.
19. **C0 v2 con versioni di entità**: le risposte cache-abili
   registrano le versioni osservate nel run; il riuso richiede TTL
   valido E versioni correnti identiche. Riferimenti che il registro
   non sa sondare = riuso NEGATO (fail-closed sulla freschezza).
20. **Pannello contestuale**: card Tars in CommessaDetail dietro i
   flag, alimentata dalla query dedicata `tars.fascicolo` (nessun run
   del modello, nessun token): fatti, gate, domande aperte, freschezza
   e link a `/tars`. Con i flag spenti il pannello non esiste nel DOM.

## 22. Decisioni registrate in T4 (briefing, situazioni, shadow)

21. **Briefing = derivazione deterministica a richiesta**: zero token,
   zero scritture di dominio, il modello non partecipa. Composizione:
   promemoria di oggi (personali), casi «mine» del Centro Azioni,
   segnalazioni di sede. Vive nella pagina `/tars` sopra la chat.
22. **Proattività SHADOW senza emissioni**: nessun caso, notifica o
   promemoria viene creato. Le segnalazioni v1 sono due rilevatori
   deterministici — ordine in ritardo (consegna prevista superata senza
   effettiva) e conflitto consegna prevista/data confermata al cliente
   — AGGANCIATE ai casi aperti del Centro Azioni per commessa (solo un
   booleano «già seguito»: mai contenuti di casi altrui). Il rumore si
   misura: ogni briefing registra un run `proattivita-shadow` con
   contatori (segnalazioni, agganciate, promemoria, casi). Emissioni
   reali solo dopo l'osservazione shadow (T8), sui canali ESISTENTI.
   Il rilevatore dei gate fermi resta futuro (già visibile nel
   fascicolo, non va duplicato come rumore).
23. **Nessun worker nuovo**: la valutazione avviene alla richiesta del
   briefing; l'aggancio agli eventi di dominio arriva con
   l'attivazione reale della proattività.
24. **Gating**: briefing dietro `tars`+`tarsReadTools`; la sezione
   segnalazioni anche dietro `tarsProactive` (spenta → `null`, la UI
   non la mostra). In produzione tutto resta spento.

## 23. Decisioni registrate in T5 (azioni L2, gateway L3)

25. **L2 su servizi esistenti**: le prime azioni condivise reversibili
   sono le transizioni del Centro Azioni — prendere in carico e
   rinviare (con l'espressione temporale del parser T2) — via
   `transitionActionCase` (authz del servizio: mine/direzione,
   `expectedFingerprint` anti-stale, eventi del caso come audit,
   publishAssignmentEvent per i cambi assegnatario). Richiesta
   esplicita = ZERO conferme; l'undo è dichiarato nel risultato
   (riprendere/rinviare di nuovo), non un click.
26. **Nuovo interruttore** `FLAG_TARS_L2_ACTIONS` (`tarsL2Actions`)
   aggiunto al registro del §13, fail-closed come gli altri: le azioni
   L2 non viaggiano sotto il flag dei promemoria né delle proposte.
27. **L3 via gateway D7** (decisione 6): la coerenza documento↔ordine e
   la generazione escono dal router in
   `generazione.generaDaOrdineEDocumento` (unica fonte; il router la
   richiama DOPO la sua authz, identica). Lo strumento
   `proponi_data_consegna` (direzione, capability
   `fornitore.manage_ordini`, interruttori documentIntelligence +
   proposte + tarsProposals) genera la proposta INERTE e restituisce
   l'anteprima con il campo `conferma`. Il modello NON può approvare:
   nessuno strumento di approvazione esiste in alcun profilo (L5).
28. **UNICA conferma umana**: nuova procedura
   `proposte.approvaEApplica` — la stessa doppia capability di
   approva/applica (`autorizzaDecisione`), poi approvazione +
   applicazione in sequenza, atomica per l'utente (fallimento di
   applicazione → stato `fallita`, errore onesto). La macchina interna
   proposta→approvata→applicata resta invariata; le procedure separate
   restano per la UI documentale esistente.
29. **Più interruttori per strumento**: il campo `interruttore` accetta
   anche una lista (tutti richiesti). Prompt `v3`, profilo `l3-v1`.

## 24. Decisioni registrate in T6 (documenti e comunicazioni)

30. **NESSUN INVIO da Tars**: il dominio comunicazioni oggi è un
   ARCHIVIO dei canali (IMAP in lettura, WhatsApp coexistence senza API
   di invio): un invio programmatico non esiste nel CRM. L'«invio L4»
   del piano T6 resta APERTO come gate della direzione (nuova
   integrazione esterna SMTP/WhatsApp API + estensione del registro del
   gateway). Le bozze restano nella chat: persisterle nel dominio
   comunicazioni richiederebbe un concetto di bozza che lo schema (
   archivio di messaggi dei canali) non ha — estensione non decisa.
31. **Lettura comunicazioni**: strumento L0 `leggi_comunicazioni` per
   commessa/cliente — metadati + ESTRATTI brevi (mai corpi integrali
   nel contesto del modello: superficie di injection e volume PII
   ridotti; il contenuto è sempre un DATO). Dietro tarsReadTools +
   tarsCommunications; i corpi completi si leggono nel modulo Messaggi.
32. **Trigger di analisi (L2)**: la coerenza fascicolo/collegamento e
   l'avvio dell'analisi escono dal router in
   `server/documenti/analisiOrdine.ts` (unica fonte; il router la
   richiama dopo `requireDirezione`); lo strumento
   `analizza_conferma_ordine` (direzione, tarsL2Actions +
   documentIntelligence) riusa il servizio: idempotenza per firma già
   nel dominio, i run sono append-only (nessun undo: dichiarato).
33. **Residui legacy `tars_*` su comunicazioni CONGELATI** (CLAUDE.md):
   il nuovo Tars non legge e non scrive `tarsAnalizzata`,
   `tarsRiepilogo`, `tarsIstruzione`, `salvaEsitoTarsComunicazione` e
   la coda `listDaAnalizzare`. Profilo `l3-v2`.

## 25. Decisioni registrate in T7 (memoria; C5 differita)

34. **Memoria v1** su kv `tars_memoria` (§12, volume umano): perimetro
   `utente` (preferenze personali) o `sede` (convenzioni, SOLO
   direzione); tipi CHIUSI (preferenza, correzione, decisione,
   convenzione, responsabilita, contesto); ogni voce porta fonte,
   autore, versione, validità, timestamps. Lo strumento `ricorda` vale
   solo su richiesta esplicita (regola nel prompt; contenuto breve e
   strutturato, mai ipotesi del modello); `dimentica` INVALIDA, non
   cancella (la storia resta: audit).
35. **Le memorie entrano nel run come messaggio di CONTESTO in coda**
   (mai nel prefisso stabile: C2 intatta), marcate esplicitamente come
   dati; il fingerprint delle memorie valide entra nella chiave C0
   (una memoria nuova o invalidata invalida il riuso delle risposte).
   La memoria NON è fonte autorevole: i dati CRM correnti passano
   dagli strumenti (regola nel prompt).
36. **C5 ricerca semantica DIFFERITA** al gate chiave/budget della
   direzione: gli embeddings sono chiamate reali al provider.
   `FLAG_TARS_SEMANTIC_SEARCH` resta spento e nessun codice semantico
   esiste; la ricerca di T7 è strutturata (scope, tipo, testo) sulle
   memorie.
37. **Nuovo interruttore** `FLAG_TARS_MEMORY` (`tarsMemory`),
   fail-closed: gli strumenti memoria e l'iniezione del contesto
   esistono solo con il flag acceso. Prompt `v4`, profilo `l3-v3`.

## 26. Decisioni registrate in T8/T9 (eval, shadow, rollout)

38. **Eval offline come comando**: `pnpm eval:tars` esegue i casi
   deterministici col provider finto e produce un rapporto versionato
   in `docs/reports/` — misura CONTRATTO, attrito (L1 esplicito=0
   conferme, L3=1), isolamento (sede/utente/economia), duplicati, DST,
   kill switch, degradazione. È SINTETICO: non dichiara l'accuratezza
   del modello reale (selezione strumenti e injection-resistance del
   modello si misurano SOLO con i casi OpenAI, dopo il gate). Il test
   vitest sulle soglie critiche fa fallire la CI se una metrica critica
   regredisce.
39. **T8 shadow/pilot e T9 rollout sono operazioni della direzione**:
   il codice consegna runbook (fasi, soglie, osservazione, rollback,
   owner per flag) e telemetria; l'accensione di qualunque flag in
   produzione resta il gate. Ordine di rollout proposto nel runbook:
   readTools → memoria/promemoria → L2 → proposte → proattività;
   comunicazioni-lettura a parte; invio e semantica NON esistono.
40. **Gate OpenAI**: la proposta modello/budget/limiti/circuito
   economico/numero di eval reali viene presentata alla direzione su
   fonti ufficiali OpenAI correnti; NESSUNA chiamata reale fino
   all'autorizzazione (il default resta il provider finto).

## 27. Decisioni registrate nel cost hardening (budget governor)

> Mandato di chiusura del 30/08/2026: tetto di spesa software PRIMA del
> merge. Limiti approvati: 0,10 USD per run, 2,00 USD al giorno, 20,00
> USD al mese. Modello iniziale ESCLUSIVO `gpt-5.6-terra`.

41. **Confine unico e non aggirabile**: il governor NON è un controllo
   sparso ma un DECORATORE del provider. `adapter.ts` esporta soltanto
   `creaProviderRealeGrezzo`, importabile SOLO da
   `costi/providerGovernato.ts`; il router usa `creaProviderPerRun()`.
   Un test strutturale fallisce se: (a) qualcuno importa il grezzo
   altrove, (b) compare un `fetch` verso un provider a pagamento fuori
   dall'adapter, (c) tornano consumatori di `_core/llm.ts`,
   `imageGeneration.ts`, `voiceTranscription.ts` (percorsi legacy che
   aggirerebbero il governor: restano senza consumatori, CLAUDE.md).
42. **Contabilità in NANODOLLARI interi** (1e-9 USD), mai floating
   point: le tariffe si esprimono come `nanoUsdPerMilioneToken` (interi
   esatti per i prezzi correnti) e il costo si calcola in `BigInt`
   arrotondando PER ECCESSO. Storage `BIGINT` su PostgreSQL.
43. **Catalogo tariffe versionato e chiuso** (`costi/tariffe.ts`):
   modello, versione/data della tariffa, input/cachedInput/output,
   unità, fonte documentale, stato attivo|deprecato. Un modello senza
   tariffa ATTIVA = provider reale indisponibile (fail-closed). Oggi
   una sola voce attiva: `gpt-5.6-terra` (2,00 / 0,20 / 12,00 USD per
   milione, developers.openai.com, consultata il 30/08/2026). Nessun
   fallback automatico ad altri modelli: cambiare modello richiede una
   voce di catalogo e una decisione registrata.
44. **PostgreSQL è un PREREQUISITO del provider reale**: le prenotazioni
   atomiche vivono su `tars_costi` con `pg_advisory_xact_lock` globale
   (il tetto globale attraversa le sedi, quindi il lock è globale: i
   volumi previsti — pochi run al minuto — lo rendono innocuo). Senza
   `DATABASE_URL` il ledger sarebbe solo in memoria: in quel caso il
   provider reale NON nasce (fail-closed, §3 del mandato). Il fake non
   è governato perché non produce costi, ma non maschera la
   configurazione: `tars.stato` dichiara sempre perché il reale è
   indisponibile.
45. **Prenota → chiama → riconcilia**, con stati
   `reserved|settled|released|expired|uncertain`. Stima prudenziale:
   input = caratteri/2,5 +25% di margine alla tariffa PIENA (rapporto
   pessimistico: v. decisione 49) (mai
   scontata: il cache hit si scopre solo dopo), output =
   `max_output_tokens` intero (che per contratto Responses include i
   reasoning token: la stima li copre già). Consumo contato =
   `settled`→costo reale; `reserved|expired|uncertain`→costo prenotato;
   `released`→0. Una prenotazione non riconciliata (crash, riavvio)
   resta CONTATA al valore prenotato: si sovrastima, mai si sottostima.
46. **Esiti incerti conservativi per categoria d'errore**: `timeout`,
   `rete` e `risposta_invalida` → `uncertain` TRATTENUTO (il provider
   può aver generato i token); `configurazione` (4xx) e `rate_limit`
   (429) → `released` (nessuna generazione). Ogni chiamata ha una
   chiave idempotente `runId:passo:tentativo`: ripeterla non prenota né
   contabilizza due volte (`ON CONFLICT DO NOTHING`).
47. **Limiti tecnici del run** espliciti e configurabili, scelti per non
   rendere Tars ottuso ma per rendere impossibile un loop costoso, da
   raffinare dopo gli eval reali: max 8 chiamate modello per run (6
   passi di strumenti + risposta + un retry), 1200 token di output per
   risposta, 1 solo retry (già), 45s per chiamata, 180s per run intero,
   120.000 caratteri di contesto (≈30k token, un quarto della finestra
   del modello), 30 estratti/documenti per lettura.
48. **Lettura amministrativa** `tars.costi` (direzione-only, come gli
   altri endpoint di diagnostica): spesa giorno/mese, residui, numero
   run, costo medio/massimo, cache hit, blocchi del governor, errori
   del provider. I totali sono GLOBALI (tutte le sedi) perché il tetto
   è globale: il payload lo dichiara (`ambito: "globale"`). Anche
   `tars.stato` limita alla direzione budget e motivi infrastrutturali.
   Nessuna UI in questa slice: endpoint e telemetria verificabili.
   Telemetria senza PII: identificatori opachi, mai prompt, documenti,
   estratti o ragionamento del modello.

### Correzioni dopo la revisione indipendente (30/08/2026)

49. **La stima è un SOFFITTO, non una media**: rapporto pessimistico di
   2,5 caratteri per token (il payload è JSON di schemi e dati, non
   prosa) più il margine. Una stima ottimistica renderebbe il tetto
   valicabile dal costo reale proprio negli stati non riconciliati.
50. **Uso non plausibile = `uncertain`, mai riconciliazione a zero**:
   se `usage` manca, non è finito, è tutto a zero o dichiara più token
   cached che di input, la prenotazione resta CONTATA. Era l'unico
   punto fail-open possibile.
51. **I limiti interni del run non sono guasti del provider**
   (`ErroreLimiteRun`): non aprono il circuito globale e non dicono
   all'utente che «il modello non è disponibile».
52. **Il ledger autorevole si prova su PostgreSQL vero**: cinque test
   (schema idempotente, 20 prenotazioni concorrenti, idempotenza della
   chiave, stati, riepilogo) girano contro un database reale, in CI con
   un servizio dedicato. Il ledger in memoria non poteva accorgersi che
   `COALESCE(...) FILTER (...)` è SQL invalido.
53. **Guardia di rete GLOBALE nei test** (`server/_core/testSetup.ts`):
   nessun file della suite può raggiungere un host esterno; il percorso
   pericoloso (adapter reale) è invocato davvero in un test per
   dimostrarlo.
54. **Doppio click**: due invii identici ravvicinati condividono un solo
   run (dedup applicativa nel router), quindi un solo addebito.

## 28. Potenziamento approvato (30/08/2026)

Indirizzo della direzione: «Tars va reso potente, non preoccuparti dei
costi». Non è la rimozione delle protezioni: è lo spostamento dei tetti
al livello in cui smettono di limitare il lavoro legittimo e continuano
a fermare il guasto. Le decisioni restano registrate qui perché il
prossimo che legge il codice sappia che i numeri sono scelti, non
ereditati.

55. **Modello di riferimento: `gpt-5.6-sol`** (flagship, «complex
   professional work»), affiancato a `gpt-5.6-terra` che resta in
   catalogo come alternativa economica. Il catalogo resta CHIUSO e
   fail-closed: un modello senza tariffa non parte, nemmeno a budget
   libero. La tariffa registrata è quella di LISTINO (5,00 / 0,50 /
   30,00 USD per milione), non quella promozionale in corso: il tetto
   deve sovrastimare, e alla scadenza della promozione non serve
   toccare nulla.
56. **Reasoning `high` sull'interattivo.** Il costo del ragionamento è
   già dentro il tetto: per contratto della Responses API i reasoning
   token sono conteggiati nell'output, e la prenotazione riserva
   l'intero `max_output_tokens` prima della chiamata.
57. **Tetti: 2,00 USD per run, 20,00 al giorno, 200,00 al mese**, con
   tetto di sanità a 1.000. Il per-run non è una media attesa ma un
   soffitto: un run tipico costa 0,05-0,20 USD, quindi il giornaliero
   copre oltre cento richieste complete. Il per-run vale 2,00 e non
   1,00 per una ragione misurata, non estetica: al contesto massimo una
   singola chiamata prenota ≈0,72 USD, e con un tetto da 1,00 il
   secondo passo di ragionamento sarebbe stato impossibile — i limiti
   dichiarati sarebbero stati finzione. Un test lo verifica.
58. **Spazio per ragionare davvero**: 20 chiamate al modello, 16 passi
   di strumenti, 240.000 caratteri di contesto (meno di un decimo della
   finestra del modello), 4.000 token di risposta, 40 turni di
   cronologia, 10 minuti per run. Sono limiti di FORMA, non di costo:
   la protezione economica è il governor, e resta invariata in tutti i
   suoi meccanismi (prenotazione, riconciliazione, stati, idempotenza).
59. **Quello che il potenziamento NON cambia**: nessuna capability
   nuova, nessun allentamento dell'isolamento per sede, nessuna
   mutazione autonoma. Tars resta un agente che propone e che agisce
   solo dove il dominio glielo consente. Rendere potente il
   ragionamento non significa ampliare l'autorità.

60. **La scrittura in cache non è gratuita** (scoperta il 31/08/2026,
   guida ufficiale «Prompt caching»): su GPT-5.6 e successivi costa
   **1,25× la tariffa di input non cachato**, mentre la lettura costa
   0,1×. Il catalogo ha ora una tariffa `cacheWrite` per ogni modello e
   `costoNano` la applica separatamente: i token scritti in cache sono
   input a tariffa maggiorata, quindi vanno sottratti dalla quota a
   prezzo pieno, non sommati ad essa. Prima di questa correzione il
   dato veniva raccolto lungo tutto il percorso (`UsoToken.cacheWrite`,
   letto dall'adapter e registrato in telemetria) ma **non tariffato**:
   il ledger sotto-contabilizzava fino al 25% su ogni prompt nuovo.
61. **La stima prenota alla tariffa PIÙ CARA** (`cacheWrite`), non a
   prezzo pieno. Prima della chiamata non è dato sapere quanta parte
   del prompt verrà letta dalla cache, scritta in cache o pagata
   piena; una stima a prezzo pieno sarebbe sotto il costo reale ogni
   volta che il prefisso cambia, cioè proprio quando il prompt è nuovo.
   La decisione 49 («la stima è un soffitto») era violata di fatto.
62. **Il test del soffitto va misurato SENZA margine.** Col margine a
   1,25 il confronto non discrimina, perché compensa per coincidenza
   il moltiplicatore 1,25 della scrittura in cache: la mutazione che
   riporta la stima al prezzo pieno passava inosservata. La verifica
   ora isola la tariffa dal margine. È il motivo per cui il criterio
   di un test non è che passi, ma che fallisca quando deve.

## 29. Riallineamento T0 — verità, guardrail e accettazione (31/08/2026)

63. **Stato verificato, storia conservata.** La rimozione del 28/08 è un
   registro storico, non la descrizione del presente: il runtime, i profili e
   gli strumenti Tars sono nel repository. Il loro perimetro effettivo — non
   promesse né cronologia — è la matrice delle azioni T0. Le righe `gap` sono
   lavoro da realizzare, non capacità da dichiarare all'utente.
64. **Quattro divieti strutturali.** Nessun tool Tars accetta `force`; non
   esiste una chiamata tRPC dal modello; non esiste SQL generico né uno
   strumento `executeSql`/`updateRecord`; nessun provider a pagamento nasce
   fuori da `costi/providerGovernato.ts`. La presenza retrocompatibile di
   `force` nel router `commesse.update` non è un'autorizzazione per Tars e non
   potrà esserlo. Le mutate usano servizi canonici, controlli sede/capability,
   idempotenza, audit e rilettura/versione server-side.
65. **Mandato T0 documentale.** Questa tranche modifica esclusivamente
   documentazione Tars e guardrail; non modifica alcun file `client/`. La
   guardia del delta deve rifiutare `client/` prima della chiusura.
66. **Accettazione Maccari vincolante.** Il test end-to-end da costruire usa il
   comando «Analizza l'allegato dell'ultima email di Maccari. Se appartiene
   alla commessa, archivialo nel fascicolo e, se non trovi problemi, passa la
   commessa a misure esecutive.» Deve risolvere l'entità, trovare email e
   allegato, analizzare e verificare appartenenza, archiviare/classificare,
   controllare il gate e applicare solo una transizione adiacente R1/L2
   consentita, con evidenze, audit e Undo. Esiti obbligatori: esecuzione
   diretta solo con corrispondenza certa+gate valido; una sola domanda se
   ambigua; nessuna scrittura critica se incoerente; archivio eventuale ma
   niente transizione con gate invalido; `NOT_FOUND`/spiegazione minima senza
   leak per capability assente. Oggi la catena completa non esiste: la
   matrice la registra come gap, quindi questo è un criterio di accettazione,
   non un risultato già ottenuto.
67. **Regressione promemoria Maccari.** «Imposta un promemoria fra un'ora:
   finanziamento Maccari» deve creare esattamente un promemoria personale,
   collegato alla commessa risolta, senza proposta intermedia e senza
   duplicati al retry. Lo strumento esistente soddisfa il contratto di
   idempotenza; il test E2E completo con la risoluzione implicita resta parte
   della regressione Maccari.
68. **Tre livelli proattivi obbligatori.** L1 osserva la singola commessa con
   evidenze, urgenza, confidenza, azione, fingerprint, stato e ultima
   verifica; L2 espone pattern trasversali senza trasformare correlazioni in
   causalità; L3 produce proposte di miglioramento strutturate da un
   `SafeProductCatalog` autorizzato, senza repository, segreti, commit o
   deploy. Oggi esistono solo due segnali L1 in shadow e telemetria del
   rumore: L2 e L3, l'emissione persistente, l'auto-risoluzione e la relativa
   suite sono gap espliciti. Il mandato non è completo finché tutti e tre non
   sono implementati e testati.
