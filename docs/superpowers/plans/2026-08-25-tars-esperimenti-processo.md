# Tars Esperimenti Di Processo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sostituire i consigli generici `Tars migliora il processo` con esperimenti operativi misurabili, assegnati nel Centro Azioni e rivalutati automaticamente alla scadenza.

**Architecture:** Un registro tipizzato trasforma il quadro aziendale in metriche compatte e snapshot storici per sede. Tars puo proporre un esperimento solo su una metrica registrata e con campione sufficiente; l'approvazione crea un record persistente e un'azione assegnata, mentre un reconciler alla scadenza misura lo stesso indicatore e registra l'esito.

**Tech Stack:** TypeScript, persistedStore JSONB, PostgreSQL Action Center repository, tRPC 11, Vitest, scheduler Node, React 19.

**Spec:** `docs/superpowers/specs/2026-08-25-tars-cervello-azienda-design.md` sezione 4.8.

## Global Constraints

- Una proposta richiede almeno due casi oppure una metrica aggregata con denominatore almeno 2.
- Ogni proposta contiene responsabile, baseline, obiettivo, azione concreta e data di verifica.
- Senza uno di questi elementi non viene persistita alcuna proposta.
- L'approvazione crea un piano assegnato nel Centro Azioni; non modifica automaticamente il processo aziendale.
- Alla scadenza Tars rilegge la stessa metrica e classifica `migliorato`, `invariato` o `peggiorato`.
- La stessa chiave metrica/processo non produce una nuova proposta finche l'esperimento precedente e aperto.
- Gli snapshot sono sede-scoped, compatti e non contengono corpi mail, allegati, base64, token o dati personali non necessari.
- Il confronto usa snapshot storici, mai una singola anomalia.
- Nessuna nuova dipendenza runtime.

---

## File Map

- `server/tars/processMetrics.ts`: registry delle metriche supportate e calcolo tipizzato.
- `server/tars/processMetrics.test.ts`: valori, campioni, direzione e case refs.
- `server/tars/processExperiments.ts`: snapshot ed esperimenti persistenti con backfill `onLoad`.
- `server/tars/processExperiments.test.ts`: dedupe, transizioni e retention.
- `server/tars/auditProcessi.ts`: acquisizione snapshot prima dell'audit e prompt basato su trend.
- `server/tars/tools.ts`: quadro storico e proposta con schema rigoroso.
- `server/tars/stores.ts`: payload/chiave canonica della proposta.
- `server/tars/esecutore.ts`: creazione esperimento e Action Center case.
- `server/actionCenter/types.ts`: signal kind `process_experiment`.
- `server/tars/processExperimentReview.ts`: revisione degli esperimenti scaduti.
- `server/tars/processExperimentReview.test.ts`: confronto, evento e idempotenza scheduler.
- `client/src/components/TarsPropostaCard.tsx`: card con baseline, target e responsabile.
- `client/src/pages/TarsCommandCenter.tsx`: esiti e link al Centro Azioni.

### Task 1: Registry di metriche operative

**Files:**
- Create: `server/tars/processMetrics.ts`
- Create: `server/tars/processMetrics.test.ts`
- Modify: `server/tars/tools.ts`

**Interfaces:**
- Produces: `ProcessMetricKey`.
- Produces: `extractProcessMetrics(quadro: CompanyFrame): ProcessMetricReading[]`.
- Produces: `metricImprovement(metric, baseline, current, tolerance): ProcessExperimentOutcome`.

```ts
export type ProcessMetricKey =
  | "commesse_ferme_10g"
  | "commesse_non_assegnate"
  | "clienti_senza_contatti"
  | "interventi_senza_squadra"
  | "merce_in_ritardo"
  | "tars_errori_30g";

export type ProcessMetricReading = {
  key: ProcessMetricKey;
  label: string;
  value: number;
  denominator: number;
  unit: "count" | "percent";
  desiredDirection: "lower" | "higher";
  caseRefs: Array<{ type: string; id: number }>;
};

export type ProcessExperimentOutcome =
  | "migliorato"
  | "invariato"
  | "peggiorato";
```

- [ ] **Step 1: Scrivere i test rossi del registry**

```ts
it("estrae le commesse ferme con campione e riferimenti", () => {
  const quadro = {
    commesse: {
      attive: 23,
      nonAssegnate: 0,
      ferme: [{ id: 7 }, { id: 9 }],
    },
    clienti: { attivi: 23, senzaTelefonoOEmail: 0 },
    operativita: { interventiDaPresidiare: [], merceInRitardo: [] },
    tars: { esecuzioni30Giorni: 10, errori30Giorni: 0 },
  } as CompanyFrame;
  const metric = extractProcessMetrics(quadro)
    .find(item => item.key === "commesse_ferme_10g");
  expect(metric).toMatchObject({ value: 2, denominator: 23, desiredDirection: "lower" });
  expect(metric?.caseRefs).toEqual([{ type: "commessa", id: 7 }, { type: "commessa", id: 9 }]);
});
```

Testare la soglia percentuale con tolleranza 1 punto e conteggio con tolleranza 0: 8 -> 3 e migliorato; 8 -> 8 invariato; 8 -> 10 peggiorato.

- [ ] **Step 2: Verificare il fallimento**

Run: `pnpm exec vitest run server/tars/processMetrics.test.ts`

Expected: FAIL per modulo assente.

- [ ] **Step 3: Estrarre il tipo `CompanyFrame`**

Spostare la costruzione dell'oggetto restituito da `leggi_quadro_azienda` in un helper esportato `buildCompanyFrame(rt, giorniFermo)` oppure tipizzare il valore corrente senza duplicare le query. Correggere nello stesso punto eventuali conteggi doppi di `motiviRifiuto` e aggiungere un test con un solo rifiuto uguale a conteggio 1.

- [ ] **Step 4: Implementare il registry chiuso**

Ogni metrica deve avere estrattore, etichetta, denominatore e direzione definiti nel codice. Non accettare path arbitrari forniti dal modello. Limitare `caseRefs` a 20 id, senza nomi, corpi o descrizioni cliente.

- [ ] **Step 5: Verificare i test verdi**

Run: `pnpm exec vitest run server/tars/processMetrics.test.ts server/tars/tars.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/tars/processMetrics.ts server/tars/processMetrics.test.ts server/tars/tools.ts server/tars/tars.test.ts
git commit -m "feat(tars): define measurable process metrics"
```

### Task 2: Snapshot ed esperimenti persistenti

**Files:**
- Create: `server/tars/processExperiments.ts`
- Create: `server/tars/processExperiments.test.ts`

**Interfaces:**
- Produces: `saveProcessSnapshot`, `listProcessSnapshots`, `createProcessExperiment`, `findOpenProcessExperiment`, `completeProcessExperiment`.

```ts
export type ProcessSnapshot = {
  id: number;
  sedeId: number;
  capturedAt: Date;
  metrics: ProcessMetricReading[];
};

export type ProcessExperiment = {
  id: number;
  sedeId: number;
  proposalId: number;
  actionCaseId: number | null;
  canonicalKey: string;
  metricKey: ProcessMetricKey;
  action: string;
  responsibleUserId: number;
  baselineValue: number;
  baselineDenominator: number;
  targetValue: number;
  dueAt: Date;
  status: "aperto" | "valutato";
  outcome: ProcessExperimentOutcome | null;
  measuredValue: number | null;
  measuredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
```

- [ ] **Step 1: Scrivere i test rossi dello store**

Verificare scope sede, retention snapshot di 90 giorni, massimo uno snapshot per sede/giorno, creazione idempotente per `proposalId`, ricerca aperta per `canonicalKey`, completamento idempotente e conversione Date in `onLoad`.

- [ ] **Step 2: Verificare il fallimento**

Run: `pnpm exec vitest run server/tars/processExperiments.test.ts`

Expected: FAIL per store assente.

- [ ] **Step 3: Implementare due persisted store compatti**

Usare chiavi `tars_process_snapshots` e `tars_process_experiments`. `saveProcessSnapshot` sostituisce lo snapshot dello stesso giorno/sede e rimuove record oltre 90 giorni. `createProcessExperiment` restituisce l'esistente per la stessa `proposalId` e rifiuta una seconda chiave aperta.

- [ ] **Step 4: Verificare i test verdi**

Run: `pnpm exec vitest run server/tars/processExperiments.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/tars/processExperiments.ts server/tars/processExperiments.test.ts
git commit -m "feat(tars): persist process experiments"
```

### Task 3: Audit basato su trend e proposta rigorosa

**Files:**
- Modify: `server/tars/auditProcessi.ts`
- Modify: `server/tars/tools.ts`
- Modify: `server/tars/stores.ts`
- Modify: `server/tars/tars.test.ts`

**Interfaces:**
- Consumes: snapshot e registry delle Task 1-2.
- Changes: payload `miglioramento_processo`.

```ts
export type ProcessImprovementPayload = {
  area: string;
  metricKey: ProcessMetricKey;
  sampleSize: number;
  caseRefs: Array<{ type: string; id: number }>;
  baselineValue: number;
  baselineDenominator: number;
  targetValue: number;
  action: string;
  responsibleUserId: number;
  reviewDate: string;
  expectedImpact: string;
};
```

- [ ] **Step 1: Scrivere test rossi della proposta**

Rifiutare: `sampleSize=1`; responsabile inesistente/altra sede; review date precedente a 7 giorni o oltre 90; target non migliorativo; metrica non registrata; baseline diversa dall'ultimo snapshot; esperimento della stessa chiave gia aperto. Accettare l'esempio 8/23 -> target 3 in 30 giorni.

- [ ] **Step 2: Verificare il fallimento**

Run: `pnpm exec vitest run server/tars/tars.test.ts`

Expected: FAIL perché lo schema attuale accetta solo testo libero.

- [ ] **Step 3: Acquisire snapshot prima di ogni audit**

In `eseguiAuditProcessi`, costruire il quadro una volta, estrarre metriche e salvare lo snapshot prima di chiamare il modello. Esporre al modello ultimi 7 snapshot, variazione e case refs limitate; non ripetere le query tramite `leggi_quadro_azienda` nello stesso run, usando preload/tool cache del run.

- [ ] **Step 4: Rendere rigoroso `proponi_miglioramento_processo`**

Lo schema richiede tutti i campi di `ProcessImprovementPayload`. Il tool rilegge ultimo snapshot e assegnatari di sede, valida campione, target e data, calcola `canonicalKey = processo:<sedeId>:<metricKey>` e blocca se `findOpenProcessExperiment` trova un record.

- [ ] **Step 5: Aggiornare chiave azione e prompt**

La proposta usa la chiave canonica del processo, non titolo/problema. Il prompt ammette massimo tre esperimenti, vieta consigli generici e richiede `nessuna_azione` quando mancano trend o ownership.

- [ ] **Step 6: Verificare i test verdi**

Run: `pnpm exec vitest run server/tars/tars.test.ts server/tars/processMetrics.test.ts server/tars/processExperiments.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/tars/auditProcessi.ts server/tars/tools.ts server/tars/stores.ts server/tars/tars.test.ts
git commit -m "feat(tars): propose measurable process experiments"
```

### Task 4: Approvazione crea un piano nel Centro Azioni

**Files:**
- Modify: `server/actionCenter/types.ts`
- Modify: `server/actionCenter/repository.test.ts`
- Modify: `server/tars/esecutore.ts`
- Modify: `server/tars/tars.test.ts`

**Interfaces:**
- Adds: `ActionSignalKind` value `process_experiment`.
- Consumes: `getActionCaseRepository().upsertDraft(draft, now)`.
- Produces: esperimento con `actionCaseId` e ActionCase assegnato al responsabile.

- [ ] **Step 1: Scrivere il test end-to-end rosso**

Approvare una proposta valida e verificare un'azione con:

```ts
expect(action).toMatchObject({
  canonicalKey: `processo:1:commesse_ferme_10g`,
  targetType: "proposta_tars",
  targetId: proposta.id,
  assigneeUserId: 7,
  dueAt: new Date("2026-09-24T12:00:00.000Z"),
  nextAction: { sourceKind: "process_experiment", label: "Esegui controllo settimanale" },
});
```

Seconda approvazione deve restituire gli stessi `actionCaseId` ed `experimentId`.

- [ ] **Step 2: Verificare il fallimento**

Run: `pnpm exec vitest run server/tars/tars.test.ts server/actionCenter/repository.test.ts`

Expected: FAIL perché l'approvazione e ancora una presa d'atto.

- [ ] **Step 3: Implementare il case esecutore**

Rivalidare responsabile, ultimo snapshot e assenza di esperimento aperto; creare l'esperimento; fare `upsertDraft` con priorita `alta`, link `/tars?tab=centro-azioni`, signal contenente solo metric key, baseline, target e review date; aggiornare l'esperimento con `actionCaseId`. Se `upsertDraft` fallisce, il retry riusa l'esperimento aperto e completa il collegamento.

- [ ] **Step 4: Verificare i test verdi**

Run: `pnpm exec vitest run server/tars/tars.test.ts server/actionCenter/repository.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/actionCenter/types.ts server/actionCenter/repository.test.ts server/tars/esecutore.ts server/tars/tars.test.ts
git commit -m "feat(tars): assign process experiments"
```

### Task 5: Revisione automatica alla scadenza

**Files:**
- Create: `server/tars/processExperimentReview.ts`
- Create: `server/tars/processExperimentReview.test.ts`
- Modify: `server/_core/index.ts`

**Interfaces:**
- Produces: `reviewDueProcessExperiments(input: { now: Date; sedeId?: number }): Promise<ProcessReviewResult>`.
- Produces: `startProcessExperimentReviewScheduler(): void` con primo controllo a 2 minuti e intervallo 60 minuti.

- [ ] **Step 1: Scrivere test rossi del reconciler**

Casi: esperimento futuro ignorato; scaduto 8 -> 3 migliorato; 8 -> 8 invariato; 8 -> 10 peggiorato; metrica non disponibile resta aperta e riprova dopo 24 ore; doppio scheduler non duplica evento.

- [ ] **Step 2: Verificare il fallimento**

Run: `pnpm exec vitest run server/tars/processExperimentReview.test.ts`

Expected: FAIL per reconciler assente.

- [ ] **Step 3: Implementare misurazione e transizione**

Per ogni esperimento `aperto` con `dueAt <= now`, ricostruire il quadro della sua sede, leggere la stessa `metricKey`, calcolare outcome con il registry, chiamare `completeProcessExperiment`, aggiungere evento Action Center `esperimento_valutato` con baseline/target/current/outcome e portare l'azione a `risolta`. Nessun modello e necessario per classificare l'esito numerico.

- [ ] **Step 4: Registrare lo scheduler al bootstrap**

Avviare un solo timer `unref`; ogni errore e isolato per esperimento e logga solo id, sede e codice errore, senza payload business.

- [ ] **Step 5: Verificare i test verdi**

Run: `pnpm exec vitest run server/tars/processExperimentReview.test.ts server/actionCenter/service.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/tars/processExperimentReview.ts server/tars/processExperimentReview.test.ts server/_core/index.ts
git commit -m "feat(tars): measure process experiment outcomes"
```

### Task 6: UI utile per decisione e risultato

**Files:**
- Modify: `client/src/components/TarsPropostaCard.tsx`
- Modify: `client/src/pages/TarsCommandCenter.tsx`
- Modify: `client/src/lib/messaggi.ts`

**Interfaces:**
- Consumes: `ProcessImprovementPayload`, esito esecutore e ActionCase link.
- Produces: card leggibile senza testo generico `Tars migliora il processo` come contenuto principale.

- [ ] **Step 1: Renderizzare la proposta come esperimento**

Mostrare nell'ordine: problema misurato (`8 su 23`), andamento recente, azione concreta, responsabile, target (`massimo 3`), verifica (`24 settembre`), evidenze apribili. Il pulsante primario resta Approva; dopo approvazione diventa `Apri nel Centro Azioni`.

- [ ] **Step 2: Renderizzare l'esito**

Nel Command Center mostrare `Migliorato`, `Invariato` o `Peggiorato`, baseline, risultato e data. Non usare soli colori: aggiungere icona e testo. Conservare densita operativa, radius massimo 8 px e token semantici.

- [ ] **Step 3: Verificare check e build**

Run: `pnpm check && pnpm build`

Expected: exit code 0.

- [ ] **Step 4: QA browser**

A 1440x900 e 390x844 verificare card pendente, card approvata e risultato; nessun testo troncato, overflow orizzontale o card annidata; target touch almeno 40 px e focus visibile.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/TarsPropostaCard.tsx client/src/pages/TarsCommandCenter.tsx client/src/lib/messaggi.ts
git commit -m "feat(tars): show measurable process experiments"
```

### Task 7: Documentazione, osservabilita e verifica completa

**Files:**
- Modify: `PRD.md`
- Modify: `handoff.md`
- Modify: `docs/superpowers/specs/2026-08-25-tars-cervello-azienda-design.md`

**Interfaces:**
- Produces: contratto dati, runbook scheduler, retention e metriche supportate documentati.

- [ ] **Step 1: Aggiornare i documenti**

Documentare registry iniziale, retention 90 giorni, vincoli proposta, dedupe, Action Center, revisione numerica, stati esperimento e procedura per diagnosticare scheduler/snapshot senza leggere dati sensibili.

- [ ] **Step 2: Eseguire verifica completa**

Run: `pnpm check && pnpm test && pnpm build`

Expected: tre exit code 0.

- [ ] **Step 3: Controllare diff e segreti**

Run: `git diff --check && git diff --cached -- . ':!pnpm-lock.yaml' | rg -n "(sk-[A-Za-z0-9_-]{20,}|password\s*[:=]|access[_-]?token\s*[:=])" || true`

Expected: nessun errore whitespace e nessun segreto reale; stringhe di test devono essere chiaramente fittizie.

- [ ] **Step 4: Commit**

```bash
git add PRD.md handoff.md docs/superpowers/specs/2026-08-25-tars-cervello-azienda-design.md
git commit -m "docs(tars): document process experiments"
```
