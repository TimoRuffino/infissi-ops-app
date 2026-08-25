# Economia FiC e Break-even Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendere FiC la fonte dei valori economici effettivi e mostrare in Pagamenti quanto fatturare ogni mese per coprire i costi fissi.

**Architecture:** Un ledger normalizzato separa documenti emessi e ricevuti, mantenendo gli store JSONB esistenti e i collegamenti alle commesse. Funzioni pure calcolano valori per competenza, flussi di cassa e break-even; Tars classifica solo i nuovi costi e lascia i dubbi in revisione. Le pagine Contabilita e Pagamenti consumano esclusivamente questi contratti server.

**Tech Stack:** TypeScript, Express/tRPC 11, persistedStore JSONB, React 19, React Query, Tailwind 4, shadcn/Radix, Vitest, OpenAI Responses API.

**Spec:** `docs/superpowers/specs/2026-08-25-economia-fic-break-even-design.md`

## Global Constraints

- Tutte le entita, query e mutation economiche sono `sedeId` scoped.
- Direzione e amministrazione possono leggere e correggere; un id fuori sede produce `NOT_FOUND`.
- Fatturato e costi effettivi sono netti IVA e provengono soltanto da FiC.
- Le note di credito rettificano i valori con segno opposto.
- Tars classifica automaticamente ma non collega un costo a una commessa senza approvazione.
- Le classificazioni `dubbio` non entrano nel break-even.
- Nessuna nuova dipendenza e nessun blob base64 nel ledger JSONB.
- La UI usa token semantici, Plus Jakarta Sans e non crea scroll orizzontale globale.

---

### Task 1: Funzioni contabili pure

**Files:**
- Create: `server/_core/economiaFic.ts`
- Test: `server/_core/economiaFic.test.ts`

**Interfaces:**
- Produces: `segnoDocumento(tipo)`, `calcolaAggregatiFic(documenti, anno)`, `calcolaBreakEven(input)` e relativi tipi.
- Consumes: importi normalizzati, rate FiC e classificazioni gia validate dagli store.

- [ ] **Step 1: Scrivere test fallenti per segni e rate**

Verificare fattura meno nota di credito, expense meno passive credit note, `paid` nei flussi e solo `not_paid` nei residui.

- [ ] **Step 2: Eseguire i test mirati e osservare il fallimento**

Run: `pnpm vitest run server/_core/economiaFic.test.ts`

- [ ] **Step 3: Implementare aggregati annuali e mensili**

La funzione deve restituire netto, IVA, lordo, pagato, da pagare e dodici mesi, escludendo `presenteInFic === false` e documenti ignorati.

- [ ] **Step 4: Implementare il break-even mobile**

Input esatto:

```ts
type BreakEvenInput = {
  anno: number;
  mese: number;
  documentiEmessi: DocumentoEconomico[];
  costi: CostoEconomico[];
};
```

Output con `stato`, `affidabilita`, mesi coperti, margine di contribuzione, costi fissi medi, obiettivo, fatturato del mese, residuo e valore dei dubbi.

- [ ] **Step 5: Verificare casi 12 mesi, 3-11 mesi e insufficienti**

Run: `pnpm vitest run server/_core/economiaFic.test.ts`

### Task 2: Mirror documenti emessi e snapshot

**Files:**
- Modify: `server/routers/ficFatture.ts`
- Modify: `server/routers/ficFatture.test.ts`

**Interfaces:**
- Produces: `FatturaFic.tipo`, IVA, presenza e metadati sync; `upsertDocumentiEmessi(rows, sedeId, sync)`.
- Preserves: `upsertFatture` come wrapper compatibile e tutti i collegamenti/PDF correnti.

- [ ] **Step 1: Scrivere fixture fallenti per backfill e snapshot 52/54**

Provare che due record non visti da uno snapshot completo diventano assenti e che uno snapshot incompleto non li modifica.

- [ ] **Step 2: Estendere tipo e `onLoad`**

Aggiungere `tipo`, `importoIva`, `presenteInFic`, `ultimoSyncId`, `ultimoVistoAt`; i campi sync legacy partono null.

- [ ] **Step 3: Implementare upsert e finalizzazione snapshot**

Un aggiornamento non deve sovrascrivere `commessaId`, `collegataAMano`, `ignorata` o il documento PDF.

- [ ] **Step 4: Escludere note di credito e record assenti dalla riconciliazione fatture**

Le proposte di pattuito/incasso restano riservate alle fatture presenti.

- [ ] **Step 5: Eseguire i test del router**

Run: `pnpm vitest run server/routers/ficFatture.test.ts`

### Task 3: Registro costi FiC e regole

**Files:**
- Create: `server/routers/ficCosti.ts`
- Create: `server/routers/ficCosti.test.ts`
- Modify: `server/routers.ts`

**Interfaces:**
- Produces: store `fic_costi`, store `fic_regole_costi`, `upsertCostiFic`, `finalizzaSnapshotCosti`, `classificaConRegole`, router `ficCosti`.
- Consumes: `RataFic`, `ClassificazioneCosto`, permessi e `assertSedeScope`.

- [ ] **Step 1: Scrivere test fallenti per isolamento sede e precedence**

Provare regola utente sopra Tars, correzione auditabile e `NOT_FOUND` fuori sede.

- [ ] **Step 2: Implementare store e backfill**

I nuovi costi senza decisione partono `dubbio`; le correzioni utente sopravvivono a ogni sync.

- [ ] **Step 3: Implementare router di elenco, riclassificazione e regole**

Le mutation accettano una classe chiusa e una scelta esplicita per ricordare la regola.

- [ ] **Step 4: Implementare snapshot ricevuti**

Solo uno snapshot completo puo impostare `presenteInFic = false`.

- [ ] **Step 5: Eseguire i test mirati**

Run: `pnpm vitest run server/routers/ficCosti.test.ts`

### Task 4: Classificatore Tars efficiente

**Files:**
- Create: `server/tars/classificaCostiFic.ts`
- Create: `server/tars/classificaCostiFic.test.ts`
- Modify: `server/routers/ficCosti.ts`

**Interfaces:**
- Produces: `classificaCostiFic(sedeId, ids?)` e hook test del provider.
- Consumes: regole confermate, `callOpenAI`, modello automatico della sede e record nuovi/variati.

- [ ] **Step 1: Scrivere test fallenti per batch, cache e fallback**

Provare un'unica richiesta per lotto, `prompt_cache_key` stabile, output strutturato, regole non inviate al modello e fallimento convertito in `dubbio` senza rompere il sync.

- [ ] **Step 2: Implementare schema JSON strutturato**

Ogni elemento restituisce `id`, classe, confidenza 0-1 e motivazione breve; input limitato a metadati economici.

- [ ] **Step 3: Applicare risultati solo ai record ancora invariati**

Una correzione utente concorrente prevale sempre.

- [ ] **Step 4: Esporre contatori privacy-safe**

Loggare soltanto numero classificati/dubbi e token usage, mai descrizioni o fornitori.

- [ ] **Step 5: Eseguire test Tars e provider**

Run: `pnpm vitest run server/tars/classificaCostiFic.test.ts server/tars/openai.test.ts`

### Task 5: Sincronizzazione FiC completa

**Files:**
- Modify: `server/routers/fattureInCloud.ts`
- Modify: `server/routers/fattureInCloud.oauth.test.ts`
- Modify: `server/routers/ficFatture.test.ts`

**Interfaces:**
- Produces: OAuth con scope note di credito/documenti ricevuti, fetch paginato corrente+precedente, snapshot per flusso, stato permessi economici.
- Consumes: gli upsert delle Task 2-3 e il classificatore della Task 4.

- [ ] **Step 1: Scrivere test fallenti per scope e paginazione completa**

Verificare `issued_documents.credit_notes:r`, `received_documents:r`, due anni, quattro flussi e nessuna finalizzazione al superamento del limite.

- [ ] **Step 2: Estrarre helper di fetch paginato**

Usare il filtro FiC `q` sul campo `date`, `fields` espliciti e un risultato `{ rows, complete }`.

- [ ] **Step 3: Normalizzare fatture, note e costi**

Calcolare IVA come `gross - net` solo quando FiC non la espone; preservare segno nel tipo, non nell'importo memorizzato.

- [ ] **Step 4: Rendere atomico ogni flusso logico**

Un flusso fallito conserva il suo snapshot precedente; l'esito dichiara il sync incompleto e i conteggi per tipo.

- [ ] **Step 5: Avviare classificazione dopo il salvataggio**

Il sync risponde senza dipendere dal successo OpenAI; la classificazione opera sui soli nuovi/variati.

- [ ] **Step 6: Aggiornare stato Integrazioni**

Mostrare `permessiEconomiciDaAggiornare` finche il token non supera una lettura dei nuovi endpoint.

- [ ] **Step 7: Eseguire test sync/OAuth**

Run: `pnpm vitest run server/routers/fattureInCloud.oauth.test.ts server/routers/ficFatture.test.ts server/routers/ficCosti.test.ts`

### Task 6: API Economia e break-even

**Files:**
- Modify: `server/routers/economia.ts`
- Create: `server/routers/economia.test.ts`
- Modify: `server/tars/tools.ts`
- Modify: `server/tars/tars.test.ts`

**Interfaces:**
- Produces: `economia.overview({anno})` a tre sezioni e `economia.breakEven({anno,mese})`.
- Consumes: aggregati puri, fatture presenti, costi presenti e classificati.

- [ ] **Step 1: Scrivere test fallenti sul perimetro omogeneo**

Provare netto/lordo/IVA, note di credito, costi FiC, rate e assenza dei costi manuali dai totali effettivi.

- [ ] **Step 2: Sostituire il vecchio overview**

Restituire `crm`, `vendite`, `acquisti`, `mesi` e copertura dati; mantenere alias deprecati solo dove necessari alla compatibilita immediata.

- [ ] **Step 3: Aggiungere query break-even**

Rifiutare anni diversi dal corrente e delegare ogni calcolo alla funzione pura.

- [ ] **Step 4: Aggiornare `leggi_economia` di Tars**

Il fascicolo direzione riceve valori compatti, fonti, periodo e affidabilita senza dump dei documenti.

- [ ] **Step 5: Eseguire test router e Tars**

Run: `pnpm vitest run server/routers/economia.test.ts server/tars/tars.test.ts`

### Task 7: UI Contabilita, Pagamenti e revisione costi

**Files:**
- Modify: `client/src/pages/Economia.tsx`
- Modify: `client/src/pages/Pagamenti.tsx`
- Modify: `client/src/pages/Integrazioni.tsx`
- Create: `client/src/components/economia/BreakEvenPanel.tsx`
- Create: `client/src/components/economia/CostiFicReview.tsx`
- Create: `client/src/lib/economiaView.test.ts`
- Create: `client/src/lib/economiaView.ts`

**Interfaces:**
- Produces: tre bande contabili, tab Acquisti, pannello Copertura costi fissi e revisione dubbi.
- Consumes: `economia.overview`, `economia.breakEven`, `ficCosti.list/riclassifica`, stato FiC.

- [ ] **Step 1: Scrivere test fallenti per adattatori di vista**

Provare percentuale progress, clamp, etichette affidabilita e stato dati insufficienti senza logica monetaria duplicata nei componenti.

- [ ] **Step 2: Costruire `BreakEvenPanel`**

Usare griglia responsive, progress stabile, dettagli formula accessibili e CTA verso i costi dubbi.

- [ ] **Step 3: Inserire il pannello sopra Ultimi incassi**

La pagina Pagamenti mantiene i flussi acconto esistenti e distingue fatturato da incassato.

- [ ] **Step 4: Ridisegnare Panoramica Economia**

Tre bande non annidate: Contratti CRM, Vendite FiC, Acquisti FiC. Ogni valore mostra netto/lordo, periodo e fonte.

- [ ] **Step 5: Aggiungere tab Acquisti e revisione dubbi**

Tabella desktop e righe mobile con select classificazione e checkbox esplicita per la regola.

- [ ] **Step 6: Aggiornare card Integrazioni**

Spiegare la richiesta di ricollegamento solo quando manca il nuovo set di scope.

- [ ] **Step 7: Eseguire test client e typecheck**

Run: `pnpm vitest run client/src/lib/economiaView.test.ts && pnpm check`

### Task 8: Documentazione, regressioni e QA

**Files:**
- Modify: `documento_requisiti_infissi_ops.md`
- Modify: `handoff.md`
- Modify: `PRD_infissi_ops_v4.pdf` tramite `scripts/build-prd-pdf.sh`

**Interfaces:**
- Produces: contratto aggiornato, runbook OAuth/sync e stato operativo per Railway.

- [ ] **Step 1: Aggiornare PRD e handoff**

Documentare formule, scope, riconnessione FiC, classificazione Tars, record assenti e limite del ledger bancario futuro.

- [ ] **Step 2: Rigenerare il PDF PRD**

Run: `bash scripts/build-prd-pdf.sh`

- [ ] **Step 3: Eseguire suite completa**

Run: `pnpm check && pnpm test && pnpm build`

- [ ] **Step 4: Avviare server locale e verificare la UI**

Controllare `/economia`, `/pagamenti`, `/integrazioni` a 1440x900, 1279x800 e 390x844, console pulita e assenza di scroll orizzontale globale.

- [ ] **Step 5: Verificare diff e segreti**

Run: `git diff --check && git status --short && rg -n "sk-|Bearer [A-Za-z0-9]" --glob '!pnpm-lock.yaml' .`

- [ ] **Step 6: Commit finale**

Committare soltanto i file di questa implementazione; dichiarare che Railway richiede riconnessione FiC dopo il deploy.
