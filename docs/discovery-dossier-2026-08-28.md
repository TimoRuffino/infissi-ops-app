# Discovery Dossier — Fase 0 (28/08/2026)

> Ricognizione completa del repository dopo la rimozione di Tars, prima di
> qualsiasi evoluzione. Base: `main` @ `f0bb919` («remove Tars, keep the
> communications it was living on top of»), tree pulito, allineato a origin.
>
> Marcatori: **VERIFICATO** (osservato in codice/test/runtime) ·
> **DOCUMENTATO** (dichiarato ma non verificato) · **INFERENZA** ·
> **IPOTESI** · **BLOCCO** (serve accesso o decisione esterna).

## 1. Executive summary

- Il CRM è **interamente deterministico** e in salute: baseline verde
  (`pnpm check` ✅, `pnpm test` 489/489 ✅, `pnpm build` ✅). VERIFICATO.
- La rimozione di Tars è chirurgica e coerente lato codice: le comunicazioni
  sopravvivono in `server/comunicazioni/`, l'infrastruttura piattaforma
  (eventi, notifiche, authz, Centro Azioni, promemoria, chat) è viva e
  testata. VERIFICATO.
- La **documentazione non ha seguito il codice**: PRD v5.0 dichiara il CRM
  deterministico ma conserva intere sezioni normative (MUST) che impongono
  comportamenti Tars; handoff, AGENTS.md, CLAUDE.md, script npm, copy UI di
  `/conoscenza` e runbook raccontano un agente che non esiste. È il debito
  più urgente perché inquina le fonti 3–5 della gerarchia. VERIFICATO.
- Il **router centrale (`commesse.ts`) non ha un file di test proprio**: la
  state machine, il doc gate e i cleanup di rollback sono coperti solo di
  riflesso. VERIFICATO (nessun `commesse.test.ts` nel repo).
- Due lacune di autorizzazione reali ma non urgenti (API espone dati economici
  a ruoli non economici; registrazione pagamenti senza capability check):
  richiedono una decisione, non un fix silenzioso. VERIFICATO, §9.
- I due mandati ricevuti (ricostruzione Tars subito vs evoluzione CRM con
  agente rimandato) **confliggono sulla sequenza**: la proposta è seguire il
  secondo (coerente con `f0bb919`) e usare il primo come capitolato del futuro
  agente. Decisione D1, §13.

## 2. Baseline verificata

| Voce | Esito |
|---|---|
| Commit | `f0bb919`, branch `main`, sincronizzato con `origin/main`, tree pulito |
| `pnpm check` | ✅ nessun errore (tsc `--noEmit`, strict) |
| `pnpm test` | ✅ 59 file, 489 test, 0 falliti (vitest, ~6 s) |
| `pnpm build` | ✅ vite 3113 moduli + esbuild server 892 kB; nessun warning oltre soglia |
| Node / pnpm | v25.9.0 / 10.4.1 |
| `.env` locale | Solo `GOOGLE_OAUTH_*` e `MAIL_ENCRYPTION_KEY`; **niente `DATABASE_URL`** → ogni run locale è in memoria |
| Runtime | Avvio dev isolato riuscito (porta 5199, dati sintetici); v. §5.1 |

Attenzione operativa permanente: **Railway deploya `main`** (handoff §0).
Ogni push su `main` è un deploy di produzione. VERIFICATO (handoff) /
BLOCCO (non ho accesso Railway per confermare pipeline e numero di repliche).

## 3. Coverage ledger

Perimetro: 342 file TypeScript, ~95.900 righe (server 170 file / 48.361
righe; client 156 / 46.111; shared 7 / 795; scripts 9 / 593). 59 file di test.

- **Letto semanticamente** (integrale): `documento_requisiti_infissi_ops.md`
  (1.765 righe), `handoff.md` (1.041), `AGENTS.md`, `CLAUDE.md`,
  `docs/tars-rimosso-2026-08-28.md`, `docs/storage-r2.md`, `package.json`,
  `tsconfig.json`, `drizzle/schema.ts`, `.env.example`,
  `server/routers.ts`, `server/routers/commesse.ts`, `economia.ts`,
  `ficMatch.ts`, `server/_core/{index,trpc,context,permissions,persistence}.ts`,
  `server/authz/capabilities.ts`, `server/platform/featureFlags.ts`,
  `server/events/{registry,publish}.ts`, `server/actionCenter/{scheduler,signals(parziale)}.ts`,
  `client/src/App.tsx`, `client/src/lib/roles.ts`,
  `scripts/{run-tars-evals,rebuild-tars-context}.ts`, `.claude/launch.json`.
- **Letto strutturalmente** (inventario, firme, grep mirati su invarianti:
  `sedeId` 1.984 occorrenze, store, DDL, procedure, residui `tars`): tutto il
  resto di `server/` e `client/src/`, inclusi i file >1.000 righe
  (`comunicazioni.ts` 2.105 — letti modello, DDL e code; `ficFatture.ts`,
  `ficPagamenti.ts`, `whatsapp.ts`, `driveBackup.ts`, `CommessaDetail.tsx`
  3.499, `ClienteDetail.tsx`, `Integrazioni.tsx`).
- **Non letti riga per riga**: i preventivatori, la maggioranza dei componenti
  UI, i test più lunghi. Il loro comportamento è documentato dal PRD e coperto
  dai test verdi. **Non affermo di aver analizzato ogni riga.**
- **Richiede verifica runtime su Railway** (BLOCCO da locale): valori dei
  feature flag per sede, `ACTION_CENTER_MODE` effettivo, conteggi dati reali,
  esecuzione delle query PostgreSQL di chat/comunicazioni (localmente gira il
  fallback in memoria — il PRD stesso lo dichiara, §51.9).
- Nota: `graphify-out/` esiste ma è indicizzato al 26/08, **prima** della
  rimozione di Tars: da rigenerare prima di usarlo come mappa.

## 4. Mappa architetturale (com'è davvero)

Monolite modulare Node/Express/tRPC 11 + React 19/Vite 7. Un processo, worker
interni, niente code esterne.

**Persistenza a tre regimi** — VERIFICATO:
1. `kv_store` JSONB via `persistedStore` (≈45 raccolte: clienti, commesse,
   documenti, ticket, magazzino, produzione, fornitori, garanzie, timeline,
   fic_*, caselle, alias WhatsApp, conoscenza, flag…). Array in memoria,
   save debounciato full-row, guardie anti-sovrascrittura al boot,
   flush su SIGTERM.
2. Tabelle PostgreSQL dedicate (21): `comunicazioni(+migrazioni)`,
   `azioni_operative(+eventi)`, `chat_*`, `promemoria(+eventi)`,
   `business_events(+processing)`, `notifications(+deliveries+preferences)`,
   `push_subscriptions`, `capability_overrides/delegations`, `policy_*`,
   `users` (legacy OAuth). Ognuna con `ensureSchema` proprio e fallback in
   memoria senza `DATABASE_URL`.
3. File: `fileStorage` driver `local`/S3-R2, `storageKey`+SHA-256, fallback
   `dataBase64` legacy.

**Contorno**: ~332 procedure tRPC (6 public, 269 protected, 57 admin) in 37
router; autenticazione locale JWT+cookie con rate-limit per email; multi-sede
risolto server-side (cookie non autoritativo); authz a due livelli (ruoli
legacy + motore capability dietro `policyMode`, default `legacy`); eventi con
outbox-like repository, dedupe key, 2 consumer (proiettore notifiche, chat
assegnazioni), attivi solo con `eventBusMode≠off`; scheduler interni: backup
Drive 00:00, FiC 6h, IMAP 5 min, promemoria 15 s, Centro Azioni 60 s.

**Tipi di dominio**: non esiste un layer condiviso; ogni router definisce le
proprie shape (zod agli input, `any` diffuso negli store). `shared/` contiene
solo errori, label, telefono, listini. VERIFICATO — rilevante per Tranche 2/3.

## 5. Mappa dei processi end-to-end

Percorso canonico (PRD §7, codice conforme):
`preventivo → misure_esecutive → aggiornamento_contratto → fatture_pagamento →
da_ordinare → produzione → ordini_ultimazione → attesa_posa → finiture_saldo →
interventi_regolazioni → archiviata`, transizioni solo adiacenti nei due versi,
gate documentale per stato con `force` esplicito, soft-archive ortogonale,
timeline 18 step sincronizzata bidirezionale solo-in-avanti.

Denaro: pattuito a doppio regime (FiC-derivato / manuale), registro
`pagamenti[]` con origine `fic|manuale`, riconciliazione 1:1, incassato sempre
derivato; economia aziendale solo da FiC (imponibili netti, costi fissi «in
forza», break-even additivo). Comunicazioni: ingest idempotente, match
deterministico, code operative manuali (nessuna classificazione automatica dal
28/08). Post-vendita: ticket (anche senza commessa), interventi, verbali,
garanzie, reclami/rifacimenti, anomalie, NC produzione.

### 5.1 Verifica runtime (dati sintetici, in memoria)

Percorso provato nel browser su run dev isolato — VERIFICATO:
login bootstrap admin → Dashboard (feed, KPI, calendario) → creazione cliente
→ scheda cliente (residenza/lavoro, WhatsApp deep-link, scheda PDF) →
creazione commessa con prodotti (`COM-2026-001`, 4× Infissi, +60gg) → scheda
commessa (gate «Mancano 2 documenti», pattuito manuale, margine «dati
incompleti») → tentato avanzamento → dialog «File richiesto non caricato…
Procedi comunque» → forza → Board con card in Misure Esecutive → Economia
(«dati insufficienti» spiegato, non zero muto) → Email (coda vuota corretta)
→ vista mobile 390px senza scroll orizzontale (`scrollWidth==clientWidth`).
Console pulita, con **una** eccezione strutturale: il blocco del doc gate
arriva al client come HTTP 500 (v. R6).

## 6. Matrice delle fonti autorevoli

Estratta in un documento vivente: **`docs/source-of-truth-matrix.md`**.
Sintesi delle regole di conflitto: server > documenti; correzione umana >
automatismo, sempre; snapshot integrazioni mai distruttivi; conflitto vero =
esposto, mai risolto in silenzio.

## 7. Catalogo delle invarianti (con stato dei test)

| # | Invariante | Dove vive | Test |
|---|---|---|---|
| I1 | Transizioni solo adiacenti, `force` non tocca la sequenza | `validateTransizione` | **MANCANTE** un property-test dedicato (coperta di riflesso da `timeline.test`) |
| I2 | Gate documentale per stato con `statoAtUpload` | `preventiviContratti` | **MANCANTE** diretto |
| I3 | Rollback: uscire da `produzione` azzera `dataConsegnaConfermata`; da `archiviata` azzera `dataChiusura`; ingresso in `archiviata` imposta `dataChiusura` | `commesse.update` | **MANCANTE** |
| I4 | `sedeId` su ogni entità; mismatch → `NOT_FOUND` | `assertSedeScope` + filtri list | Parziale (`authz/coreRouters.test`, `sedi.integrazioni.test`, `preventiviContratti.test`); mancano negativi sistematici sui router principali |
| I5 | `importoIncassato` derivato, mai input | `commessaPayments` + schema update | ✅ `commessaPayments.test` |
| I6 | Pattuito FiC non scrivibile a mano (`PRECONDITION_FAILED`) | `assertPattuitoScrivibile` | Parziale (via `ficFatture.test`); manca il test diretto della mutation |
| I7 | Riconciliazione 1:1 nei due versi, fingerprint anti-stale | `ficPagamenti` | ✅ (suite ampia) |
| I8 | Snapshot FiC non distruttivi | sync fatture/costi | ✅ |
| I9 | Costi fissi: solo in forza, periodo base unico, precedenza dichiarato | `costiFissiAzienda`, `costiRicorrenti` | ✅ |
| I10 | Timeline↔Board solo in avanti, idempotente | `timeline.ts` | ✅ |
| I11 | Eventi: dedupe key, consumer idempotenti, lease/dead-letter | `events/*` | ✅ |
| I12 | Ingest comunicazioni idempotente, tombstone su delete | `comunicazioni.ts` | ✅ in memoria; **BLOCCO**: query PG reali non provate da locale |
| I13 | Cookie sede mai autoritativo | `context.ts` | Indiretto |
| I14 | Password: scrypt versionato, upgrade al boot, niente seed | `password.ts`, `utenti` | ✅ parziale (`auth.logout.test`) |
| I15 | Contenuti esterni (email/PDF/WhatsApp) = dati, mai istruzioni | tutta l'ingestione | Strutturale (nessun interprete esiste più) |

## 8. Contraddizioni e debito (registro)

Formato: conflitto → evidenza → decisione proposta → conseguenza → test.

| ID | Conflitto | Evidenza | Decisione proposta | Test/verifica |
|---|---|---|---|---|
| C1 | Mandato «ricostruire Tars ora» vs mandato «Tars progetto separato dopo le fondazioni» | HEAD=`f0bb919`; `docs/tars-rimosso-2026-08-28.md` | Sequenza del secondo mandato; il primo diventa capitolato della Tranche 7 (**decisione D1**) | — |
| C2 | PRD v5.0 «interamente deterministico» vs §51.2–51.3, §53.2–53.4, parti di §40.4–40.5 che impongono Tars con MUST | PRD righe 1483+ vs §50 | Riscrivere le sezioni sul comportamento corrente; spostare il resto in appendice storica | grep «Tars» sul PRD = solo storico |
| C3 | PRD §51.4: route `/tars` e redirect `/inbox` obbligatori | `App.tsx` non li ha | PRD da correggere | — |
| C4 | PRD §2 «watcher IMAP ogni 60 s» vs codice 5 min | `imap.ts:579` | PRD da correggere | — |
| C5 | handoff §5/§7 descrivono flussi Tars al presente vs §6 rimozione | handoff | Separare «corrente» da «storico» | — |
| C6 | AGENTS.md/CLAUDE.md: sezione normativa «## Tars» + riferimento a `server/tars/tars.test.ts` inesistente | file | Sostituire con «nessun agente + predisposizione futura» | — |
| C7 | `package.json` `tars:eval`/`tars:eval:live` → script che importano `server/tars/*` rimosso; **fuori dal perimetro tsc** (tsconfig non include `scripts/`) | `scripts/run-tars-evals.ts`, `rebuild-tars-context.ts` | Rimuovere script npm e file (recuperabili da git) | `pnpm check` resta verde |
| C8 | `/conoscenza` dice all'utente «Ogni voce attiva viene letta da Tars a ogni esecuzione» | `Conoscenza.tsx:123` | Correggere il copy (la scheda resta) | visivo |
| C9 | `.env.example` commenta `OPENAI_API_KEY` sotto «# Tars»; `_core/llm.ts` (332 righe), `voiceTranscription.ts`, `imageGeneration.ts` hanno **zero importatori** | grep import | Rimuovere i moduli orfani e la variabile dall'esempio | `pnpm check`/`build` |
| C10 | `docs/runbooks/tars-*.md` e `docs/reports/tars-brain-rollout-checklist.md` nominano Tars ma coprono infrastruttura viva (eventi/notifiche) | ls docs | Rinominare/annotare senza perdere contenuto | — |
| C11 | `statoCodaTars`, `sediConCodaTars`, `markAnalizzate`, coda `tars_analizzata=FALSE`: scritte e filtrate, **zero chiamanti** | grep | Lasciare colonne e campi (voluti per il futuro agente), annotare nel codice «senza consumatore dal 28/08/2026»; niente rimozioni (**decisione D5**) | — |
| C12 | `ComponentShowcase.tsx` (1.437 righe) non importato da nessuna route | grep | Rimuovere o spostare in strumento dev (**decisione D6**) | build |
| C13 | PRD §5.2: assegnatario cliente «default utente corrente»; il form invia `null` esplicito → cliente «Non assegnato» (server farebbe il default se il campo fosse omesso) | runtime + `clienti.ts:227` | Stabilire quale dei due è l'intento; allineare form o PRD | test UI |
| C14 | Commento in `ficMatch.ts` cita `tars/match.ts` (ora `comunicazioni/match.ts`) | codice | Correzione cosmetica in slice | — |

## 9. Rischi di produzione e sicurezza

In ordine di peso. Nessuno richiede intervento d'urgenza; R1–R3 sono
strutturali e già mitigati da regole operative scritte.

- **R1 · Deploy = push su `main`.** Nessun ambiente intermedio dichiarato.
  Mitigazione: lavorare su branch, merge solo dopo checklist handoff §10.
  Valutare in Tranche 1/2 un gate CI. VERIFICATO (handoff)/BLOCCO (config
  Railway non ispezionabile da qui).
- **R2 · `persistedStore` e scritture esterne.** `save()` riscrive l'intera
  riga dalla memoria: uno script fuori processo viene sovrascritto (incidente
  reale del 26/08, documentato). Regola già in vigore: si passa dal processo.
  La soluzione vera è la normalizzazione degli aggregati caldi (Tranche 2).
- **R3 · Concorrenza.** Array in memoria + full-row write assumono
  **una** istanza. BLOCCO: confermare su Railway repliche=1. Anche il
  rate-limit login è per processo.
- **R4 · `commesse.byId` restituisce `pagamenti[]`, `costi[]`,
  `importoTotale` a qualunque ruolo autenticato della sede.** La UI nasconde
  la card Economia, l'API no (`margine` è gated, l'oggetto grezzo no). Chiudere
  significa filtrare per capability → cambia il contratto per i client.
  **Decisione D3a.** VERIFICATO.
- **R5 · `addPagamento`/`updatePagamento`/`removePagamento` senza
  `authorizeCoreOperation`**: qualunque utente della sede registra o rimuove
  incassi manuali (la capability `pagamento.record` esiste ma non è
  consultata in questi percorsi). **Decisione D3b.** VERIFICATO.
- **R6 · `DOC_GATE_BLOCKED` è un `Error` generico** → tRPC lo serializza
  come 500: nei log un blocco di processo è indistinguibile da un crash, e il
  client fa matching sul prefisso del messaggio. Fix piccolo ma di contratto
  (server+client insieme). VERIFICATO a runtime.
- **R7 · CSP assente** (tracciata come follow-up nel PRD §3.5). Confermo.
- **R8 · Cronologia git con vecchie password seed**; `gh` locale revocato.
  Decisione purge (riscrittura SHA) ancora aperta — resta dell'operatore.
- **R9 · Webhook WhatsApp**: firma HMAC su raw body prima del parse, multi
  app-secret — corretto. Nessun rilievo. VERIFICATO.
- **R10 · Script rotti fuori typecheck** (C7): il verde di `pnpm check` non
  copre `scripts/`. Aggiungere `scripts/` al perimetro tsc dopo la pulizia.

## 10. Gap contro il lavoro reale del rivenditore

> Riscritto il 28/08/2026 dopo la correzione della direzione: il metro non è
> «cosa pubblicizzano i concorrenti», è «cosa serve al lavoro reale del
> rivenditore». **Principio fissato: orchestrare, non replicare.**
> Configurazioni tecniche, listini e compatibilità restano nei software dei
> produttori — il CRM li importa e li collega (adapter PDF/Excel/XML/CSV/API),
> senza ricalcolarli con motori propri meno affidabili. Fatture in Cloud resta
> la fonte fiscale autorevole: il CRM governa fatture, incassi, residui e
> marginalità attraverso l'integrazione, senza diventare un secondo software
> fiscale. **Non sono gap**: un preventivatore universale, un motore listini
> proprietario, la fatturazione nativa o l'invio SDI interno.

Gap veri, riletti con questo metro — INFERENZA da validare caso per caso:

- **Aggancio dei dati dei produttori**: `aperture` è un'anagrafica piatta e
  non esiste un punto dove far atterrare preventivi/configurazioni prodotte
  dai software dei fornitori (Antenore è in attesa, §PRD 27.7). Il modello
  `apertura → configurazione → commessa → ordine → posa → garanzia` serve da
  contenitore dei loro dati autorevoli, non da configuratore.
- **Filo commessa→ordine→ricezione**: ordini fornitore scollegati da ciò che
  la commessa richiede; magazzino per commessa senza riserve/disponibilità.
- **Readiness posa**: nessun gate merce+documenti+squadra prima
  dell'appuntamento; nessuna modalità cantiere degradata.
- **Qualità**: NC e post-vendita esistono ma senza causa radice strutturata
  né costo della qualità aggregato.
- **Punti già sopra la media di categoria**: riconciliazione FiC (1:1,
  fingerprint, snapshot non distruttivi), disciplina multi-sede, break-even
  spiegabile, comunicazioni unificate con matching deterministico correggibile.

## 11. Roadmap (sequenza approvata dalla direzione il 28/08/2026 — D1)

Il nuovo agente **non** aspetta la fine di tutte le tranche CRM: parte come
workstream separato appena le sue fondamenta sono affidabili, e procede in
parallelo all'evoluzione dei domini.

1. **Verità e sicurezza** — riconciliazione documentale (C2–C14),
   property-test I1–I6, negativi cross-sede, chiusura R4/R5 (slice 2, spec
   approvata). ➔ Slice 1 eseguita il 28/08/2026 («La verità torna una sola»).
2. **Document Intelligence (D7)** — la slice successiva alle fondamenta di
   sicurezza e autorizzazione: pipeline documentale verificabile con priorità
   alle conferme d'ordine PDF dei fornitori (requisiti in PRD §54.6).
   Prerequisito dichiarato delle capacità operative avanzate dell'agente.
3. **Contratti dati/eventi per l'agente** — read-API tipizzate e autorizzate,
   eventi affidabili sui domini che l'agente osserva, evidence ref,
   command/approval gateway, dataset di eval. La Document Intelligence ne è
   il primo consumatore reale; è anche il momento di normalizzare gli
   aggregati caldi di `kv_store` che quei contratti toccano (risolve R2/R3
   alla radice).
4. **Nuovo Tars come workstream separato** — progettazione e sviluppo sul
   capitolato «ricostruzione Tars» (visione in PRD §54), in shadow per sede,
   con eval prima di ogni autonomia; le capacità operative avanzate arrivano
   solo dopo la Document Intelligence.
5. **Evoluzione progressiva degli altri domini** — in parallelo ai punti 3-4,
   nell'ordine di valore: aggancio dati produttori e dossier tecnico
   (`CommessaDetail` da scomporre), filo commessa→ordine→ricezione→readiness,
   commerciale, produzione/posa/qualità. Sempre per vertical slice
   reversibili.

## 12. Prima vertical slice proposta (attende D2)

**«La verità torna una sola: documentazione riconciliata e state machine
blindata».** Nessun cambiamento di comportamento runtime.

- **Problema**: le fonti normative contraddicono il codice (C2–C10); il
  router centrale non ha test propri (I1–I3); il verde di CI non copre gli
  script rotti (R10).
- **Contenuto**:
  1. PRD: §2/§25/§40.4–40.5/§50/§51/§53 riscritti sul comportamento corrente;
     sezioni Tars in appendice storica; correzioni C3/C4.
  2. handoff: §5/§7 separati in «corrente» vs «storico»; riferimenti Tars
     marcati.
  3. AGENTS.md + CLAUDE.md: sezione Tars sostituita da «nessun agente;
     predisposizioni per il futuro» + collegamento a
     `docs/tars-rimosso-2026-08-28.md`.
  4. Pulizia: script npm `tars:eval*`, `scripts/run-tars-evals.ts`,
     `scripts/rebuild-tars-context.ts`, `_core/llm.ts`,
     `voiceTranscription.ts`, `imageGeneration.ts`, `ComponentShowcase.tsx`
     (D6), copy `/conoscenza`, `.env.example`, commento C14; `scripts/` entra
     nel perimetro tsc; runbook rinominati (C10).
  5. Test nuovi: property-test transizioni (tutte le coppie valide/invalide,
     `force` che non salta la sequenza), cleanup di rollback (I3), doc gate
     per stato con `statoAtUpload` (I2), negativi cross-sede su
     `commesse/clienti/ticket` (I4), scrittura pattuito su fonte `fic` (I6).
- **Invarianti protette**: tutte quelle di §7; la slice non tocca dati né
  contratti API.
- **Acceptance**: `pnpm check/test/build` verdi; `grep -ri tars` su
  PRD/handoff/AGENTS restituisce solo sezioni storiche; i nuovi test
  falliscono se si allenta la state machine.
- **Rollback**: `git revert` del commit; nessuna migrazione, nessun dato.
- **Fuori scope dichiarato**: D3 (authz), R6 (forma errore doc gate), ogni
  modifica runtime.

## 13. Decisioni (registro — decise dalla direzione il 28/08/2026)

- **D1 — Sequenza dei mandati. DECISA:** verità/invarianti/test/sicurezza →
  contratti dati/eventi per l'agente → nuovo Tars come workstream separato →
  evoluzione progressiva degli altri domini in parallelo. L'agente non
  aspetta il completamento dell'intero CRM, ma non nasce su fondamenta
  contraddittorie. (§11)
- **D2 — Slice 1 APPROVATA ed eseguita** il 28/08/2026 (handoff, «La verità
  torna una sola»): la visione del futuro Tars non è stata cancellata dal
  PRD ma spostata in §54, marcata non implementata; `llm.ts`,
  `voiceTranscription.ts` e `imageGeneration.ts` inventariati come
  infrastruttura candidata, non rimossi.
- **D3 — Lacune authz R4/R5 APPROVATE** come slice separata subito dopo la
  Slice 1, via capability layer (non ruoli hardcoded), stessa policy su API e
  UI, payload senza dati sensibili per chi non è autorizzato, test
  positivi/negativi per ruolo/capability/ownership/sede. Se il comportamento
  corrente di un ruolo operativo è ambiguo, la matrice va documentata prima
  del cambio. Spec: `docs/reports/slice-2-authz-economia-proposta.md`.
- **D4 — Railway: NESSUNA operazione esterna.** Checklist read-only
  preparata: `docs/runbooks/verifica-produzione-readonly.md`. Si esegue solo
  su autorizzazione esplicita.
- **D5 — Residui `tars_*`: DECISO lasciarli**, annotati come compatibilità.
  Rimozione solo quando esisteranno modello del nuovo Tars, matrice
  campo→consumer, decisione di migrazione ed eventuale backfill/rollback.
- **D6 — `ComponentShowcase.tsx`: rimozione APPROVATA** previa nuova verifica
  (zero route/import/riferimenti runtime/build) — eseguita nella Slice 1.
- **D7 — Document Intelligence. DECISA** dalla direzione il 28/08/2026 (nel
  mandato indicata come «D6»; qui D7 perché D6 era già assegnata): la
  comprensione dei documenti è una fondazione del futuro agente, con priorità
  assoluta alle conferme d'ordine dei fornitori in PDF (digitali e
  scansionati). Pipeline testo nativo+tabelle+OCR+visione con stati
  osservabili; estrazione di fornitore, numero conferma, riferimenti
  ordine/commessa, righe, codici, quantità, misure, colori, prezzi, date di
  consegna, note e variazioni; confronto con l'ordine originario (quantità,
  prezzo, configurazione, consegna); ogni valore con evidenza verificabile
  (documento, pagina, estratto, confidenza); originale conservato, duplicati
  rilevati, elaborazioni tracciate e riproducibili; collegamenti ambigui →
  conferma umana; nessun dato critico estratto dall'AI modifica
  automaticamente commesse, importi, date, ordini o appuntamenti; contenuti
  trattati come non attendibili (malware, prompt injection); architettura a
  registro di parser estendibile (immagini, DOCX, XLSX, CSV, XML, email,
  ZIP) senza dichiarare supporto universale non verificato. **Non
  implementata in questa slice**: requisiti completi in PRD §54.6;
  posizione in roadmap §11 — dopo la Slice 2 authz, prima delle capacità
  operative avanzate dell'agente.
- **Correzione benchmark RECEPITA** (§10): orchestrare i dati dei produttori
  e di FiC, non replicarne i motori.

## Blocchi dichiarati

- Nessun accesso a Railway/produzione da questa sessione: flag, repliche,
  conteggi e query PG reali restano **non verificati** (etichettati BLOCCO).
- Nessuna operazione esterna è stata eseguita: niente deploy, niente
  migrazioni, niente scritture su servizi. Il run di verifica era locale e in
  memoria, ed è stato spento.
