# FiC Payments and Invoice Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendere idempotente la sincronizzazione FiC dei pagamenti, proporre soltanto correzioni reali sui movimenti manuali e archiviare il PDF di ogni fattura nella commessa collegata.

**Architecture:** Un dominio pagamenti condiviso calcola l'incassato e protegge i record FiC; un registro sede-scoped collega ogni rata FiC al pagamento CRM corrispondente. Il sync persiste soltanto collegamenti di commessa certi, applica le variazioni ai movimenti FiC, trasforma le anomalie manuali in proposte Tars deduplicate e usa un servizio idempotente per il PDF.

**Tech Stack:** TypeScript, Express/tRPC 11, `persistedStore` JSONB, React 19, React Query, Tailwind 4, shadcn/Radix, Vitest, storage locale o S3-compatible.

**Spec:** `docs/superpowers/specs/2026-08-26-fic-pagamenti-allegati-design.md`

## Global Constraints

- `commessa.importoTotale` resta il pattuito CRM e non viene scritto dal sync FiC.
- `commessa.importoIncassato` deriva soltanto dai pagamenti `attivo` e non e mai un input aggiornabile.
- FiC fa fede per fatture emesse, rate, importi, date di pagamento e storni.
- Il sync modifica automaticamente soltanto pagamenti con `origine = "fic"`.
- I pagamenti manuali vengono corretti o stornati soltanto dopo approvazione di direzione o amministrazione.
- Tars propone e non esegue autonomamente; ogni proposta usa la deduplica canonica comune.
- Ogni entita, lookup e mutation business e `sedeId` scoped; fuori sede restituisce `NOT_FOUND`.
- Nessun nuovo blob base64 viene salvato in JSONB; i PDF usano `fileStorage` e mantengono il fallback in lettura per i record legacy.
- Nessun token, URL firmato, payload cliente completo o byte PDF viene scritto nei log.
- Nessuna nuova dipendenza npm.
- La UI usa gli helper di `client/src/lib/euro.ts`, token semantici e non introduce scroll orizzontale globale.
- Il worktree contiene modifiche preesistenti non appartenenti a questo piano. Prima di ogni commit eseguire `git status --short` e `git diff --cached`; sui file gia modificati usare staging per hunk e non includere modifiche Promemoria o documentazione altrui.

---

### Task 1: Dominio pagamenti e incassato derivato

**Files:**
- Create: `server/_core/commessaPayments.ts`
- Create: `server/_core/commessaPayments.test.ts`
- Modify: `server/routers/commesse.ts`
- Test: `server/routers/economia.test.ts`
- Test: `server/tars/tars.test.ts`

**Interfaces:**
- Produces: `PagamentoCommessa`, `normalizzaPagamentoLegacy`, `calcolaImportoIncassato`, `ricalcolaImportoIncassato`, `pagamentoCompatibile` e `fingerprintPagamento`.
- Produces: `saveCommesseStore()` per i servizi deterministici interni.
- Preserves: input pubblico di `addPagamento`, `updatePagamento` e `removePagamento` per i record manuali.
- Enforces: le mutation manuali restituiscono `PRECONDITION_FAILED` su record `origine = "fic"`.

- [ ] **Step 1: Scrivere i test fallenti del dominio**

Creare casi distinti per backfill, somma attiva, storno e compatibilita con data manuale nulla:

```ts
import { describe, expect, it } from "vitest";
import {
  calcolaImportoIncassato,
  normalizzaPagamentoLegacy,
  pagamentoCompatibile,
} from "./commessaPayments";

describe("commessa payments", () => {
  it("esclude gli storni dall'incassato", () => {
    expect(
      calcolaImportoIncassato([
        { importo: 1_220, stato: "attivo" },
        { importo: 400, stato: "stornato" },
      ] as any)
    ).toBe(1_220);
  });

  it("tratta un record legacy come manuale attivo", () => {
    expect(normalizzaPagamentoLegacy({ id: 1, importo: 500 } as any)).toMatchObject({
      origine: "manuale",
      stato: "attivo",
      ficDocumentoId: null,
      ficRataId: null,
    });
  });

  it("riconosce un manuale con stesso importo e data mancante", () => {
    expect(
      pagamentoCompatibile(
        { importo: 1_220, data: null, stato: "attivo" } as any,
        { importo: 1_220, dataPagamento: "2026-08-20" } as any
      )
    ).toBe("data_da_completare");
  });
});
```

- [ ] **Step 2: Eseguire i test e osservare il RED corretto**

Run: `pnpm exec vitest run server/_core/commessaPayments.test.ts`

Expected: FAIL per modulo o export mancanti, non per fixture invalide.

- [ ] **Step 3: Implementare tipi e funzioni pure minime**

Usare queste firme e arrotondare soltanto il risultato monetario finale ai centesimi:

```ts
export type OriginePagamento = "manuale" | "fic";
export type StatoPagamento = "attivo" | "stornato";

export type PagamentoCommessa = {
  id: number;
  importo: number;
  data: string | null;
  metodo: string | null;
  tipo: string | null;
  note: string | null;
  origine: OriginePagamento;
  stato: StatoPagamento;
  ficDocumentoId: number | null;
  ficRataId: number | null;
  ficSourceKey: string | null;
  ficStato: string | null;
  ficUltimoSyncAt: Date | null;
  stornatoAt: Date | null;
  createdAt: Date;
  updatedAt: Date | null;
};

export function normalizzaPagamentoLegacy(value: any): PagamentoCommessa;
export function calcolaImportoIncassato(pagamenti: readonly any[]): number;
export function ricalcolaImportoIncassato(commessa: any): number;
export function pagamentoCompatibile(
  pagamento: PagamentoCommessa,
  rata: { importo: number; dataPagamento: string | null }
): "esatto" | "data_da_completare" | "nessuno";
export function fingerprintPagamento(value: {
  importo: number;
  data: string | null;
  stato: StatoPagamento;
}): string;
```

- [ ] **Step 4: Integrare backfill e mutation commesse**

In `commesse.ts` normalizzare ogni elemento di `pagamenti[]` durante `onLoad`,
ricalcolare sempre `importoIncassato` e usare il medesimo helper dopo add,
update e remove. I nuovi record manuali devono includere:

```ts
{
  origine: "manuale",
  stato: "attivo",
  ficDocumentoId: null,
  ficRataId: null,
  ficSourceKey: null,
  ficStato: null,
  ficUltimoSyncAt: null,
  stornatoAt: null,
  updatedAt: null,
}
```

Prima di update/remove, se `p.origine === "fic"`, lanciare `TRPCError` con
`code: "PRECONDITION_FAILED"` e messaggio `Il pagamento proviene da Fatture in Cloud e viene aggiornato dalla sincronizzazione.`.

- [ ] **Step 5: Aggiungere test router per immutabilita e regressione economica**

Iniettare un pagamento FiC nello store e verificare che update/remove falliscano;
verificare in `economia.test.ts` che uno storno non contribuisca al totale CRM.

- [ ] **Step 6: Eseguire il GREEN mirato**

Run: `pnpm exec vitest run server/_core/commessaPayments.test.ts server/routers/economia.test.ts server/tars/tars.test.ts`

Expected: PASS senza warning nuovi.

- [ ] **Step 7: Committare il dominio pagamenti**

```bash
git add server/_core/commessaPayments.ts server/_core/commessaPayments.test.ts server/routers/commesse.ts server/routers/economia.test.ts server/tars/tars.test.ts
git diff --cached --check
git commit -m "feat(payments): derive receipts from active ledger"
```

---

### Task 2: Identita rate FiC e collegamento certo della commessa

**Files:**
- Modify: `server/routers/ficFatture.ts`
- Modify: `server/routers/fattureInCloud.ts`
- Modify: `server/routers/ficFatture.test.ts`

**Interfaces:**
- Produces: `RataFic.id`, `RataFic.sourceKey`, `PdfSyncFic`, `clienteMatch` e `commessaMatch` su `FatturaFic`.
- Produces: `normalizzaRate(value, documentoId)` e `collegaFattureAutomatiche(sedeId)`.
- Changes: `commessaPerFattura` restituisce soltanto il collegamento persistito; importo e nome restano evidenze Tars.
- Consumes: clienti e commesse filtrati per sede.

- [ ] **Step 1: Scrivere test fallenti per ID rata e match fiscale**

Estendere `ficFatture.test.ts` con questi comportamenti:

```ts
it("normalizza l'id stabile della rata FiC", () => {
  expect(
    normalizzaRate(
      [{ id: 444, amount: 1220, status: "paid", paid_date: "2026-08-20" }],
      9001
    )[0]
  ).toMatchObject({ id: 444, sourceKey: "rate:444" });
});

it("non persiste un collegamento basato soltanto sul pattuito", () => {
  const result = collegaFattureAutomatiche(1);
  expect(result.collegate).toBe(0);
  expect(ficFatture[0].commessaId).toBeNull();
});

it("collega automaticamente identita fiscale e unica commessa attiva", () => {
  const result = collegaFattureAutomatiche(1);
  expect(result.collegate).toBe(1);
  expect(ficFatture[0].commessaId).toBe(commessa.id);
  expect(ficFatture[0].commessaMatch).toBe("automatico_fiscale");
});
```

Aggiungere un caso con due commesse e uno con cliente omonimo di altra sede.

- [ ] **Step 2: Eseguire il RED mirato**

Run: `pnpm exec vitest run server/routers/ficFatture.test.ts -t "rata|automaticamente|pattuito|altra sede"`

Expected: FAIL per proprietà o helper mancanti e per il vecchio match inferito.

- [ ] **Step 3: Estendere i tipi e i backfill FiC**

Usare i contratti:

```ts
export type RataFic = {
  id: number | null;
  sourceKey: string;
  importo: number;
  scadenza: string | null;
  stato: "paid" | "not_paid" | "reversed" | string;
  dataPagamento: string | null;
};

export type PdfSyncFic = {
  stato: "non_collegata" | "in_attesa" | "archiviata" | "errore";
  ultimoTentativoAt: Date | null;
  ultimoErrore: string | null;
};

export type ClienteMatchFic = "fiscale" | "nome_univoco" | "nessuno";
export type CommessaMatchFic =
  | "manuale"
  | "automatico_fiscale"
  | "nessuno";
```

Per ID nulli generare `legacy:<documentoId>:<due_date>:<amount>:<indice>` e
promuovere la chiave a `rate:<id>` soltanto se la vecchia rata ha una
corrispondenza univoca. Se cambiano i fatti di una rata legacy non univoca,
lasciarla ambigua al Task 3.

- [ ] **Step 4: Implementare il match automatico conservativo**

Normalizzare partita IVA e codice fiscale rimuovendo spazi e punteggiatura.
`collegaFattureAutomatiche` salva `commessaId` soltanto con un cliente fiscale
univoco e una sola commessa attiva della stessa sede. Salvare
`collegataAMano = false`, `commessaMatch = "automatico_fiscale"` e non toccare
un collegamento manuale esistente.

- [ ] **Step 5: Eliminare il collegamento virtuale dalla query**

`ficFatture.list` deve restituire `commessaId: f.commessaId`, mai
`statoFattura(...).commessa?.id`. `statoFattura` usa soltanto la commessa
persistita e considera una fattura senza link `non_abbinabile` o
`da_riconciliare` in base alla proposta Tars presente.

- [ ] **Step 6: Eseguire l'intera suite fatture**

Run: `pnpm exec vitest run server/routers/ficFatture.test.ts`

Expected: PASS; aggiornare le vecchie aspettative che descrivevano il match
virtuale o la proposta di pattuito.

- [ ] **Step 7: Committare identita e collegamento**

```bash
git add server/routers/ficFatture.ts server/routers/fattureInCloud.ts server/routers/ficFatture.test.ts
git diff --cached --check
git commit -m "feat(fic): persist safe invoice job links"
```

---

### Task 3: Motore idempotente di riconciliazione pagamenti

**Files:**
- Create: `server/routers/ficPagamenti.ts`
- Create: `server/routers/ficPagamenti.test.ts`
- Modify: `server/routers/commesse.ts`
- Modify: `server/routers/ficFatture.ts`

**Interfaces:**
- Produces: store `fic_pagamenti_links`, `RiconciliazioneRataFic`, `FicPaymentIssue`, `FicPaymentSyncStats` e `riconciliaPagamentiFic`.
- Consumes: `FatturaFic[]`, `getCommesseStore()`, `saveCommesseStore()`, helper del Task 1.
- Returns: anomalie strutturate; non crea direttamente proposte Tars.

- [ ] **Step 1: Scrivere test fallenti per creazione idempotente**

```ts
it("crea una sola riga FiC dopo due riconciliazioni identiche", () => {
  riconciliaPagamentiFic({ sedeId: 1, snapshotCompleto: true, now });
  riconciliaPagamentiFic({ sedeId: 1, snapshotCompleto: true, now });

  expect(commessa.pagamenti).toHaveLength(1);
  expect(commessa.pagamenti[0]).toMatchObject({
    origine: "fic",
    stato: "attivo",
    ficDocumentoId: 9001,
    ficRataId: 444,
    ficSourceKey: "rate:444",
  });
  expect(commessa.importoIncassato).toBe(1_220);
});
```

- [ ] **Step 2: Scrivere test fallenti per manuali e ambiguita**

Provare separatamente:

```ts
it("collega un manuale con data nulla senza duplicarlo", () => {
  const result = riconciliaPagamentiFic({ sedeId: 1, snapshotCompleto: true, now });
  expect(commessa.pagamenti).toHaveLength(1);
  expect(result.issues).toEqual([
    expect.objectContaining({ tipo: "correggi_manuale", pagamentoId: 1 }),
  ]);
});

it("non scrive quando due manuali sono compatibili", () => {
  const result = riconciliaPagamentiFic({ sedeId: 1, snapshotCompleto: true, now });
  expect(result.stats.ambiguita).toBe(1);
  expect(result.issues[0].tipo).toBe("scegli_manuale");
  expect(ficPaymentLinks).toHaveLength(0);
});
```

- [ ] **Step 3: Eseguire il RED del motore**

Run: `pnpm exec vitest run server/routers/ficPagamenti.test.ts`

Expected: FAIL per file e funzioni mancanti.

- [ ] **Step 4: Implementare store e tipi**

```ts
export type RiconciliazioneRataFic = {
  id: number;
  sedeId: number;
  ficDocumentoId: number;
  ficRataId: number | null;
  ficSourceKey: string;
  commessaId: number;
  pagamentoId: number;
  target: "manuale" | "fic";
  stato: "confermata" | "da_verificare" | "superata";
  createdAt: Date;
  updatedAt: Date;
};

export type FicPaymentIssue =
  | { tipo: "correggi_manuale"; sedeId: number; commessaId: number; pagamentoId: number; ficDocumentoId: number; ficSourceKey: string; expectedFingerprint: string; patch: { importo?: number; data?: string | null; stato?: "stornato" } }
  | { tipo: "scegli_manuale"; sedeId: number; commessaId: number; ficDocumentoId: number; ficSourceKey: string; candidati: Array<{ pagamentoId: number; expectedFingerprint: string; patch: { importo?: number; data?: string | null; stato?: "stornato" } }> }
  | { tipo: "verifica_spostamento"; sedeId: number; commessaId: number; pagamentoId: number; ficDocumentoId: number; ficSourceKey: string };

export type FicPaymentSyncStats = {
  pagamentiCreati: number;
  pagamentiAggiornati: number;
  pagamentiStornati: number;
  pagamentiRiattivati: number;
  manualiRiconciliati: number;
  correzioniProposte: number;
  ambiguita: number;
  proposteSuperate: number;
  pdfArchiviati: number;
  pdfFalliti: number;
};

export function riconciliaPagamentiFic(input: {
  sedeId: number;
  snapshotCompleto: boolean;
  now?: Date;
}): { stats: FicPaymentSyncStats; issues: FicPaymentIssue[] };
```

L'`onLoad` del nuovo store deve backfillare sede, date e stato senza creare
link mancanti per euristica.

- [ ] **Step 5: Implementare l'ordine di matching approvato**

Applicare nell'ordine: link esistente, nota FiC univoca, importo+data esatti,
importo con data manuale nulla, nessun candidato, ambiguita. Un link manuale
non autorizza mai una mutation del pagamento. Un link FiC aggiorna importo,
data e stato sul medesimo record.

- [ ] **Step 6: Scrivere e osservare test RED per storni e spostamenti**

I test devono fallire prima dell'implementazione di ciascun caso:

```ts
it("storna ma conserva una rata reversed", () => {
  const result = riconciliaPagamentiFic({ sedeId: 1, snapshotCompleto: true, now });
  expect(result.stats.pagamentiStornati).toBe(1);
  expect(commessa.pagamenti[0].stato).toBe("stornato");
  expect(commessa.importoIncassato).toBe(0);
});

it("non storna una rata assente durante snapshot incompleto", () => {
  riconciliaPagamentiFic({ sedeId: 1, snapshotCompleto: false, now });
  expect(commessa.pagamenti[0].stato).toBe("attivo");
});
```

Aggiungere riattivazione, rata rimossa dopo snapshot completo, spostamento dei
record FiC e manuale lasciato nella vecchia commessa con issue
`verifica_spostamento`.

- [ ] **Step 7: Implementare storno, riattivazione e spostamento convergente**

Quando cambia commessa, impostare il vecchio record FiC `stornato`, marcare il
vecchio link `superata`, creare il nuovo record con la stessa source key nella
destinazione e ricalcolare entrambe le commesse. Non eliminare righe.

- [ ] **Step 8: Eseguire il GREEN completo**

Run: `pnpm exec vitest run server/routers/ficPagamenti.test.ts server/_core/commessaPayments.test.ts server/routers/ficFatture.test.ts`

Expected: PASS con due sync identici e zero duplicati.

- [ ] **Step 9: Committare il motore**

```bash
git add server/routers/ficPagamenti.ts server/routers/ficPagamenti.test.ts server/routers/commesse.ts server/routers/ficFatture.ts
git diff --cached --check
git commit -m "feat(fic): reconcile payments idempotently"
```

---

### Task 4: Allegato PDF idempotente e ricollegamento

**Files:**
- Create: `server/routers/ficAllegati.ts`
- Create: `server/routers/ficAllegati.test.ts`
- Create: `server/routers/preventiviContratti.test.ts`
- Modify: `server/routers/fattureInCloud.ts`
- Modify: `server/routers/ficFatture.ts`
- Modify: `server/routers/preventiviContratti.ts`
- Modify: `server/routers/ficFatture.test.ts`

**Interfaces:**
- Produces: `ensureFicInvoiceAttachment`, `ensureFicInvoiceAttachments`, `findDocumentoFic` e stato PDF persistito.
- Consumes: `scaricaFatturaPdf`, `upsertDocumentoFic`, `fileStorage` e `FatturaFic.commessaId` persistito.
- Guarantees: un errore PDF non annulla collegamento o riconciliazione economica.

- [ ] **Step 1: Scrivere test fallenti per ordine e retry**

```ts
it("mantiene il collegamento se il primo download PDF fallisce", async () => {
  const result = await caller.ficFatture.collega({ ficId: 9001, commessaId: 10 });
  expect(result.pdf.stato).toBe("errore");
  expect(ficFatture[0].commessaId).toBe(10);
});

it("ritenta e archivia un solo documento", async () => {
  const first = await ensureFicInvoiceAttachment({ sedeId: 1, fattura, createdBy: 1 });
  const second = await ensureFicInvoiceAttachment({ sedeId: 1, fattura, createdBy: 1 });
  expect(second.documentoId).toBe(first.documentoId);
  expect(findDocumentoFic(1, 9001)?.id).toBe(first.documentoId);
  expect(fattura.pdfSync.stato).toBe("archiviata");
});
```

Aggiungere un caso di spostamento: lo stesso `sourceRef` deve puntare alla nuova
commessa dopo il retry.

In `preventiviContratti.test.ts`, mockare `putFile` affinche rigetti e provare
che `upsertDocumentoFic` rigetti senza creare un documento con `dataBase64`.

- [ ] **Step 2: Eseguire il RED PDF**

Run: `pnpm exec vitest run server/routers/ficAllegati.test.ts server/routers/preventiviContratti.test.ts server/routers/ficFatture.test.ts -t "PDF|download|spost|base64"`

Expected: FAIL perché il link attuale viene salvato dopo il download e il
servizio non esiste.

- [ ] **Step 3: Rendere lo storage FiC conforme**

In `upsertDocumentoFic`, se `putFile` fallisce non creare `dataBase64`; rilanciare
`StorageAllegatoTemporaneamenteNonDisponibile`. Aggiungere:

```ts
export function findDocumentoFic(
  sedeId: number,
  ficId: number
): Documento | null;
```

La ricerca usa `sourceRef = fic:<sedeId>:<ficId>` e non restituisce record di
un'altra sede.

- [ ] **Step 4: Implementare il servizio allegati**

```ts
export type FicPdfEnsureResult = {
  stato: "archiviata" | "errore" | "non_collegata";
  documentoId: number | null;
  errore: string | null;
};

export async function ensureFicInvoiceAttachment(input: {
  sedeId: number;
  fattura: FatturaFic;
  createdBy: number | null;
  signal?: AbortSignal;
  downloadPdf?: (sedeId: number, ficId: number, signal?: AbortSignal) => Promise<Buffer>;
}): Promise<FicPdfEnsureResult>;

export async function ensureFicInvoiceAttachments(input: {
  sedeId: number;
  createdBy: number | null;
  signal?: AbortSignal;
}): Promise<{ pdfArchiviati: number; pdfFalliti: number }>;
```

Impostare `in_attesa` prima del tentativo, `archiviata` al successo ed `errore`
con messaggio sanitizzato al fallimento. Non persistere l'URL FiC.

- [ ] **Step 5: Riordinare la mutation collega**

Validare sede e commessa, salvare `f.commessaId`, `collegataAMano` e
`commessaMatch`, poi chiamare riconciliazione e PDF. La risposta usa:

```ts
{
  success: true,
  paymentStats: FicPaymentSyncStats,
  correzioniProposte: number,
  pdf: FicPdfEnsureResult,
}
```

Lo scollegamento non cancella il PDF o i pagamenti: marca la fattura
`non_collegata`, lascia audit e produce riconciliazione al prossimo link.

- [ ] **Step 6: Eseguire test storage e router**

Run: `pnpm exec vitest run server/routers/ficAllegati.test.ts server/routers/preventiviContratti.test.ts server/routers/ficFatture.test.ts`

Expected: PASS; nessun nuovo `dataBase64` FiC.

- [ ] **Step 7: Committare il servizio PDF**

```bash
git add server/routers/ficAllegati.ts server/routers/ficAllegati.test.ts server/routers/preventiviContratti.test.ts server/routers/fattureInCloud.ts server/routers/ficFatture.ts server/routers/preventiviContratti.ts server/routers/ficFatture.test.ts
git diff --cached --check
git commit -m "feat(fic): archive invoice PDFs idempotently"
```

---

### Task 5: Correzioni Tars, stato superata e guardie no-op

**Files:**
- Create: `server/tars/ficPaymentProposals.ts`
- Create: `server/tars/ficPaymentProposals.test.ts`
- Modify: `server/tars/stores.ts`
- Modify: `server/tars/tools.ts`
- Modify: `server/tars/esecutore.ts`
- Modify: `server/tars/commandCenter.ts`
- Modify: `server/routers/commesse.ts`
- Modify: `server/routers/tars.ts`
- Modify: `server/tars/tars.test.ts`

**Interfaces:**
- Adds: tipo proposta `correzione_pagamento`, stato `superata`, capability `pagamento.correct`.
- Produces: `creaProposteCorrezionePagamento`, `superaProposteFicObsolete`, mutation `commesse.correggiPagamento` e mutation `tars.proposte.selezionaPagamentoRiconciliazione`.
- Consumes: `FicPaymentIssue[]`, fingerprint del Task 1 e link del Task 3.
- Enforces: approvazione solo direzione/amministrazione e controllo optimistic dei valori correnti.

- [ ] **Step 1: Scrivere test fallenti per chiave canonica e superamento**

```ts
it("deduplica la stessa correzione FiC per source key e fingerprint", () => {
  const first = creaProposteCorrezionePagamento([issue], 1);
  const second = creaProposteCorrezionePagamento([issue], 1);
  expect(first.create).toBe(1);
  expect(second.create).toBe(0);
});

it("marca superate le proposte pagamento gia soddisfatte", () => {
  const count = superaProposteFicObsolete(1);
  expect(count).toBe(2);
  expect(proposte.filter(p => p.stato === "superata")).toHaveLength(2);
});
```

- [ ] **Step 2: Eseguire il RED proposte**

Run: `pnpm exec vitest run server/tars/ficPaymentProposals.test.ts server/tars/tars.test.ts -t "correzione|superata|soddisfatta"`

Expected: FAIL per tipo e helper mancanti.

- [ ] **Step 3: Estendere store, deduplica e API di elenco**

Aggiungere `correzione_pagamento` a `TIPI_PROPOSTA` e
`TIPI_ALTO_RISCHIO`, `superata` a `StatoProposta`, alla validazione zod di
`tars.proposte.list` e alla chiave canonica:

```ts
case "correzione_pagamento":
  effetto = {
    ficDocumentoId: pay.ficDocumentoId,
    ficSourceKey: pay.ficSourceKey,
    pagamentoId: pay.pagamentoId ?? null,
    patch: pay.patch,
    expectedFingerprint: pay.expectedFingerprint,
  };
  break;
```

`propostaGiaGestita` deve considerare `superata` decisa e non deve ricrearla.

- [ ] **Step 4: Implementare creazione e risanamento storico**

`creaProposteCorrezionePagamento` trasforma soltanto issue della stessa sede e
usa `evidenceRefs` fattura/rata. `correggi_manuale` e
`verifica_spostamento` diventano `correzione_pagamento`; `scegli_manuale`
diventa la stessa proposta con `pagamentoId: null` e l'elenco strutturato
`candidati`. La proposta ambigua non e approvabile finche l'operatore non
seleziona un candidato. Per duplicati pendenti si conserva la piu vecchia.
`superaProposteFicObsolete` imposta:

```ts
{
  stato: "superata",
  esito: "Azione gia soddisfatta o sostituita dalla riconciliazione FiC.",
  decisaAt: now,
  decisaDa: null,
  decisaDaNome: null,
}
```

Non modificare proposte rifiutate o approvate.

Usare le firme:

```ts
export function creaProposteCorrezionePagamento(
  issues: readonly FicPaymentIssue[],
  sedeId: number,
  now?: Date
): { create: number; ambigue: number };

export function superaProposteFicObsolete(
  sedeId: number,
  now?: Date
): number;
```

- [ ] **Step 5: Scrivere test RED per approvazione stale e doppione manuale**

```ts
it("non applica una correzione se il pagamento e cambiato", async () => {
  await expect(caller.tars.proposte.approva({ id: proposta.id })).rejects.toThrow(
    "Il pagamento e cambiato dopo la proposta"
  );
  expect(commessa.pagamenti[0].importo).toBe(1_300);
});

it("storna il doppione manuale soltanto dopo approvazione", async () => {
  await caller.tars.proposte.approva({ id: proposta.id });
  expect(commessa.pagamenti[1].stato).toBe("stornato");
  expect(commessa.importoIncassato).toBe(1_220);
});

it("richiede la scelta del manuale ambiguo prima dell'approvazione", async () => {
  await expect(caller.tars.proposte.approva({ id: proposta.id })).rejects.toThrow(
    "Seleziona il pagamento da riconciliare"
  );
  await caller.tars.proposte.selezionaPagamentoRiconciliazione({
    id: proposta.id,
    pagamentoId: 2,
  });
  await expect(caller.tars.proposte.approva({ id: proposta.id })).resolves.toBeTruthy();
});
```

- [ ] **Step 6: Implementare mutation ed esecutore**

La mutation accetta il payload esatto:

```ts
z.object({
  commessaId: z.number(),
  pagamentoId: z.number(),
  ficDocumentoId: z.number(),
  ficSourceKey: z.string().min(1),
  expectedFingerprint: z.string().min(1),
  patch: z.object({
    importo: z.number().positive().optional(),
    data: z.string().nullable().optional(),
    metodo: z.enum(["bonifico", "contanti", "assegno", "pos", "finanziamento", "altro"]).nullable().optional(),
    tipo: z.enum(["acconto_1", "acconto_2", "acconto_3", "acconto_4", "acconto_5", "saldo"]).nullable().optional(),
    note: z.string().nullable().optional(),
    stato: z.literal("stornato").optional(),
  }),
})
```

Richiedere direzione/amministrazione, verificare sede e fingerprint, applicare
la patch a un record manuale, aggiornare il link e ricalcolare l'incassato.
`esecutore.ts` chiama questa mutation nel case `correzione_pagamento`.

La mutation `selezionaPagamentoRiconciliazione` accetta `{ id, pagamentoId }`,
richiede una proposta pendente `correzione_pagamento`, verifica che il candidato
appartenga al payload e alla stessa sede, quindi copia nel payload
`pagamentoId`, `expectedFingerprint` e `patch` del candidato selezionato. Non
applica ancora la correzione; l'approvazione resta un secondo gesto esplicito.

- [ ] **Step 7: Scrivere test RED per tool generici no-op**

Provare che `proponi_pagamento` non crea una proposta con stesso importo/data o
stesso importo e data CRM nulla, e che `proponi_modifica_commessa` non propone
`importoTotale` gia uguale.

- [ ] **Step 8: Implementare le guardie live**

Prima di `creaProposta`, leggere la commessa in sede. Rimuovere da `campi` i
valori semanticamente uguali; se vuoto, restituire
`Nessuna modifica effettiva: i dati sono gia aggiornati.`. Per il pagamento,
usare `pagamentoCompatibile`; con esito diverso da `nessuno`, restituire
`Pagamento gia presente o da correggere: non creare una nuova rata.`.

- [ ] **Step 9: Aggiornare command center e capability**

Mappare `correzione_pagamento` a `pagamento.correct`, usare la stessa priorita
economica di `pagamento` e la conclusione
`Il registro CRM non coincide con la rata autorevole di Fatture in Cloud.`.
Escludere `superata` dalle code pendenti mantenendola consultabile nello storico.

- [ ] **Step 10: Eseguire il GREEN Tars**

Run: `pnpm exec vitest run server/tars/ficPaymentProposals.test.ts server/tars/tars.test.ts server/tars/commandCenter.test.ts`

Expected: PASS, incluse le verifiche metadati richieste dalle modifiche tool.

- [ ] **Step 11: Committare soltanto gli hunk FiC/Tars**

`server/routers/tars.ts` e gia modificato nel worktree: verificare e selezionare
soltanto gli hunk di `correzione_pagamento`/`superata`.

```bash
git add server/tars/ficPaymentProposals.ts server/tars/ficPaymentProposals.test.ts server/tars/stores.ts server/tars/tools.ts server/tars/esecutore.ts server/tars/commandCenter.ts server/routers/commesse.ts server/tars/tars.test.ts
git add -p -- server/routers/tars.ts
git diff --cached --check
git diff --cached --name-only
git commit -m "fix(tars): replace duplicate receipts with corrections"
```

---

### Task 6: Orchestrazione completa del sync e statistiche

**Files:**
- Modify: `server/routers/fattureInCloud.ts`
- Modify: `server/routers/fattureInCloud.oauth.test.ts`
- Modify: `server/routers/ficFatture.ts`
- Modify: `server/routers/ficFatture.test.ts`
- Modify: `server/routers/ficPagamenti.test.ts`

**Interfaces:**
- Produces: `FicSyncResult`, `FicConfig.lastStats` e risposta `syncNow` strutturata.
- Produces: helper interno `creaClientiMancanti(sedeId, entities)` che restituisce il numero creato.
- Orchestrates: mirror documenti, creazione clienti, link automatici, pagamenti, proposte, PDF e classificazione costi.
- Replaces: proposta automatica di pattuito e proposta additiva di pagamento.

- [ ] **Step 1: Scrivere test end-to-end fallente del sync ripetuto**

Usare il mock HTTP gia presente in `ficFatture.test.ts` con una fattura, rata
`id: 444` pagata e PDF valido. Eseguire due volte:

```ts
const first = await runFicSync(1);
const documentAfterFirst = findDocumentoFic(1, fatturaId);
const second = await runFicSync(1);

expect(first.stats.pagamentiCreati).toBe(1);
expect(second.stats.pagamentiCreati).toBe(0);
expect(second.stats.pagamentiAggiornati).toBe(0);
expect(commessa.pagamenti.filter((p: any) => p.ficRataId === 444)).toHaveLength(1);
expect(findDocumentoFic(1, fatturaId)?.id).toBe(documentAfterFirst?.id);
```

- [ ] **Step 2: Scrivere test fallenti per fetch incompleto e parzialita PDF**

Provare che una pagina fallita non storni una rata e che un PDF fallito produca
`pdfFalliti: 1` senza annullare `pagamentiCreati: 1`.

- [ ] **Step 3: Eseguire il RED di orchestrazione**

Run: `pnpm exec vitest run server/routers/ficFatture.test.ts server/routers/fattureInCloud.oauth.test.ts -t "sync|PDF|incomplet"`

Expected: FAIL perché `runFicSync` restituisce ancora una stringa e genera
proposte additive.

- [ ] **Step 4: Implementare `FicSyncResult` e backfill config**

```ts
export type FicSyncResult = {
  result: string;
  complete: boolean;
  stats: FicPaymentSyncStats;
};
```

Aggiungere `lastStats: FicPaymentSyncStats | null` a `FicConfig`; il backfill e
null. `syncNow` restituisce direttamente `FicSyncResult`, mentre scheduler e
`lastResult` continuano a usare `result`.

- [ ] **Step 5: Ordinare il flusso di sincronizzazione**

Nel blocco di successo eseguire esattamente:

`fattureComplete` vale true soltanto quando il flusso paginato
`issued_documents.invoices` e riuscito ed e completo; un errore nei costi non
deve falsificare lo snapshot rate, mentre un errore nelle fatture deve impedirne
gli storni.

```ts
upsertDocumentiEmessi(...);
creaClientiMancanti(...);
const links = collegaFattureAutomatiche(sedeId);
const payments = riconciliaPagamentiFic({ sedeId, snapshotCompleto: fattureComplete });
const corrections = creaProposteCorrezionePagamento(payments.issues, sedeId);
const superseded = superaProposteFicObsolete(sedeId);
const pdf = await ensureFicInvoiceAttachments({ sedeId, signal: controller.signal });
```

Sommare i contatori senza contare come aggiornato un pagamento FiC i cui valori
sono identici. Avviare smistamento Tars soltanto per fatture ancora orfane.

- [ ] **Step 6: Rimuovere il vecchio generatore pattuito/pagamento**

Eliminare da `generaProposteRiconciliazione` le proposte
`modifica_commessa.importoTotale` e `pagamento`. Conservare soltanto il percorso
di collegamento ambiguo oppure rinominare l'helper in
`generaProposteCollegamentoFatture` e aggiornare tutti i caller.

- [ ] **Step 7: Salvare esito e statistiche privacy-safe**

La stringa finale include solo conteggi, per esempio:

```text
OK · pagamenti +1/aggiornati 0/stornati 0 · correzioni 1 · PDF 1 archiviati, 0 falliti
```

Non includere nomi clienti, numeri fattura completi o errori grezzi.

- [ ] **Step 8: Eseguire suite sync complete**

Run: `pnpm exec vitest run server/routers/ficFatture.test.ts server/routers/ficPagamenti.test.ts server/routers/ficAllegati.test.ts server/routers/fattureInCloud.oauth.test.ts`

Expected: PASS senza nuove proposte `pagamento` o `modifica_commessa` originate
dal sync.

- [ ] **Step 9: Committare l'orchestrazione**

```bash
git add server/routers/fattureInCloud.ts server/routers/fattureInCloud.oauth.test.ts server/routers/ficFatture.ts server/routers/ficFatture.test.ts server/routers/ficPagamenti.test.ts
git diff --cached --check
git commit -m "feat(fic): sync receipts and attachment status"
```

---

### Task 7: UI trasparente per origine, storni e PDF

**Files:**
- Create: `client/src/lib/paymentView.ts`
- Create: `client/src/lib/paymentView.test.ts`
- Modify: `client/src/pages/CommessaDetail.tsx`
- Modify: `client/src/pages/Economia.tsx`
- Modify: `client/src/pages/Integrazioni.tsx`
- Modify: `client/src/components/TarsPropostaCard.tsx`

**Interfaces:**
- Produces: `presentPagamento` e `presentFicSyncStats` per copy e permessi UI testabili.
- Consumes: nuovi campi tRPC di pagamenti, fatture, PDF, proposte e sync stats.
- Enforces: azioni modifica/rimozione visibili soltanto sui pagamenti manuali.

- [ ] **Step 1: Scrivere test fallenti per presentazione pagamenti**

```ts
import { describe, expect, it } from "vitest";
import { presentPagamento, presentFicSyncStats } from "./paymentView";

it("presenta un pagamento FiC stornato come non modificabile", () => {
  expect(
    presentPagamento({ origine: "fic", stato: "stornato", ficDocumentoId: 9001 })
  ).toMatchObject({ origineLabel: "FiC", statoLabel: "Stornato", canEdit: false });
});

it("riassume i contatori del sync", () => {
  expect(presentFicSyncStats({ pagamentiCreati: 1, correzioniProposte: 2, pdfFalliti: 1 } as any))
    .toContain("1 pagamento importato");
});
```

- [ ] **Step 2: Eseguire il RED UI puro**

Run: `pnpm exec vitest run client/src/lib/paymentView.test.ts`

Expected: FAIL per modulo mancante.

- [ ] **Step 3: Implementare helper di presentazione**

```ts
export function presentPagamento(p: any): {
  origineLabel: "Manuale" | "FiC";
  statoLabel: "Attivo" | "Stornato";
  canEdit: boolean;
  canRemove: boolean;
  fatturaLabel: string | null;
};

export type FicSyncStatsView = {
  pagamentiCreati?: number;
  pagamentiAggiornati?: number;
  pagamentiStornati?: number;
  pagamentiRiattivati?: number;
  manualiRiconciliati?: number;
  correzioniProposte?: number;
  ambiguita?: number;
  proposteSuperate?: number;
  pdfArchiviati?: number;
  pdfFalliti?: number;
};

export function presentFicSyncStats(stats: FicSyncStatsView): string[];
```

Le stringhe usano plurali italiani deterministici e non ricostruiscono importi.

- [ ] **Step 4: Aggiornare la scheda commessa**

Usare `commessa.importoIncassato` invece della riduzione client. Mostrare badge
`Manuale`/`FiC`, badge `Stornato`, riferimento fattura e opacita semantica sugli
storni. Non montare i pulsanti Pencil/Trash per FiC. I pulsanti manuali solo
icona mantengono `title` e aggiungono `aria-label`.

- [ ] **Step 5: Aggiornare Economia e collegamento fattura**

Mostrare soltanto link persistiti, badge `Automatico`/`Manuale` e stato PDF.
La toast di `collega` distingue:

```text
Fattura collegata · pagamenti riconciliati · PDF archiviato
Fattura collegata · PDF da ritentare
```

Non affermare mai `PDF allegato` quando `pdf.stato === "errore"`.

- [ ] **Step 6: Aggiornare Integrazioni e card Tars**

Sotto `lastResult`, rendere i contatori con `presentFicSyncStats`. Aggiungere
label e payload leggibile per `correzione_pagamento`; per `superata` mostrare
`Superata — azione gia soddisfatta o sostituita` senza pulsanti decisionali.
Se `pagamentoId` e null, mostrare il select dei `candidati` e chiamare
`selezionaPagamentoRiconciliazione`; nascondere Approva finche la mutation non
ha salvato la scelta e invalidato `tars.proposte`.

- [ ] **Step 7: Eseguire test client e typecheck**

Run: `pnpm exec vitest run client/src/lib/paymentView.test.ts client/src/lib/economiaView.test.ts && pnpm check`

Expected: PASS senza errori TypeScript.

- [ ] **Step 8: Verificare visualmente desktop e mobile**

Avviare `pnpm dev`, aprire Economia e una commessa con pagamenti a 1440x900 e
390x844. Verificare: nessuno scroll orizzontale globale, badge leggibili,
stornati visibili, pulsanti FiC assenti, stato PDF coerente e console senza
errori. Salvare screenshot temporanei fuori dal repository oppure non salvarli.

- [ ] **Step 9: Committare la UI**

```bash
git add client/src/lib/paymentView.ts client/src/lib/paymentView.test.ts client/src/pages/CommessaDetail.tsx client/src/pages/Economia.tsx client/src/pages/Integrazioni.tsx client/src/components/TarsPropostaCard.tsx
git diff --cached --check
git commit -m "feat(ui): expose FiC receipt and PDF status"
```

---

### Task 8: Documentazione, regressione completa e consegna

**Files:**
- Modify: `handoff.md`
- Modify: `documento_requisiti_infissi_ops.md`
- Modify: `Agente_Ruffino_Ops.md`
- Regenerate when safe: `PRD_infissi_ops_v4.pdf`
- Verify: all files changed by Tasks 1-7

**Interfaces:**
- Documents: autorita FiC, pattuito CRM, storni auditabili, proposta di correzione, sync stats e retry PDF.
- Verifies: repository checks, storage constraints, UI e assenza di regressioni Tars.

- [ ] **Step 1: Ispezionare e preservare le modifiche documentali preesistenti**

Run:

```bash
git diff -- handoff.md documento_requisiti_infissi_ops.md Agente_Ruffino_Ops.md scripts/build-prd-pdf.sh PRD_infissi_ops_v4.pdf
```

Annotare i blocchi gia presenti e aggiungere la nuova sezione senza riscriverli.
Non stageare il PDF binario se risultava gia modificato prima di questo piano.

- [ ] **Step 2: Aggiornare i contratti operativi**

Documentare testualmente queste regole esatte:

```text
- Pattuito: fonte CRM, mai derivato dalle fatture.
- Fatture/rate/date/storni: fonte FiC.
- Il sync scrive solo pagamenti origine FiC.
- I manuali discordanti producono correzioni Tars approvabili.
- Gli storni restano in audit e non alimentano importoIncassato.
- Il PDF viene archiviato dopo il link e ritentato in caso di errore.
```

Aggiornare la sezione Tars con `correzione_pagamento`, `superata` e le guardie
no-op.

- [ ] **Step 3: Rigenerare il PRD soltanto senza sovrascrivere lavoro altrui**

Se `scripts/build-prd-pdf.sh` e `PRD_infissi_ops_v4.pdf` non hanno modifiche
preesistenti non committate, eseguire:

```bash
bash scripts/build-prd-pdf.sh
```

Altrimenti aggiornare solo il Markdown sorgente, lasciare il PDF intatto e
dichiarare la rigenerazione non eseguita nella consegna.

- [ ] **Step 4: Eseguire le suite mirate ad alto rischio**

Run:

```bash
pnpm exec vitest run server/_core/commessaPayments.test.ts server/routers/ficPagamenti.test.ts server/routers/ficAllegati.test.ts server/routers/ficFatture.test.ts server/tars/ficPaymentProposals.test.ts server/tars/tars.test.ts server/routers/economia.test.ts client/src/lib/paymentView.test.ts
```

Expected: PASS, zero test saltati per il nuovo flusso.

- [ ] **Step 5: Eseguire la verifica completa**

Run, uno alla volta:

```bash
pnpm check
pnpm test
pnpm build
```

Expected: exit code 0 per tutti. Se un errore e preesistente, registrare comando,
test/file e prova che non dipende dalle modifiche; non dichiarare completamento
finche un errore introdotto dal piano resta aperto.

- [ ] **Step 6: Controllare storage e segreti**

Run:

```bash
pnpm storage:check
rg -n "dataBase64.*FIC|accessToken|refreshToken|pdfUrl" server/routers/fic*.ts server/routers/fattureInCloud.ts
```

Expected: storage check riuscito; nessun nuovo blob FiC o log di segreti. Non
eseguire `storage:migrate`.

- [ ] **Step 7: Riesaminare il diff finale**

Run:

```bash
git status --short
git diff --check
git diff --stat
git diff --cached --check
```

Verificare che modifiche Promemoria, notifiche e altre modifiche preesistenti
non siano state incluse nei commit di questo piano.

- [ ] **Step 8: Committare soltanto gli hunk documentali FiC**

```bash
git add -p -- handoff.md documento_requisiti_infissi_ops.md Agente_Ruffino_Ops.md
git diff --cached --check
git commit -m "docs: document FiC payment authority"
```

Se il PDF era pulito prima del piano ed e stato rigenerato, aggiungerlo allo
stesso commit; altrimenti lasciarlo fuori.

- [ ] **Step 9: Preparare la consegna verificabile**

Riportare: commit creati, test e comandi con esito, casi browser desktop/mobile,
eventuali modifiche preesistenti rimaste intatte, stato della rigenerazione PDF
e assenza di operazioni esterne su Railway/R2/OAuth.
