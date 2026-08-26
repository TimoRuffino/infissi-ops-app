# Chiarezza FiC ed Economia Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendere confrontabili gli incassi FiC e CRM per anno e data effettiva, mantenere i documenti ignorati nei totali contabili e ridisegnare la Panoramica Economia con perimetri leggibili.

**Architecture:** Le funzioni pure in `economiaFic.ts` separano competenza e cassa; il router aggiunge il flusso CRM annuale senza alterare il portafoglio attivo esistente. La UI riceve un contratto esplicito e presenta bande operative senza card annidate, con due viste mensili distinte.

**Tech Stack:** TypeScript, Vitest, tRPC 11, React 19, Tailwind 4, shadcn/Radix.

**Spec:** `docs/superpowers/specs/2026-08-25-economia-fic-break-even-design.md`

## Global Constraints

- Applicare `sedeId` a ogni lettura e aggregazione business.
- `importoIncassato` resta derivato da `pagamenti[]` e non diventa un input.
- Fatturato e costi FiC restano netti IVA per competenza; lordo e IVA sono separati.
- Le rate di cassa usano `dataPagamento`; i movimenti senza data non vengono inventati.
- Usare gli helper di `client/src/lib/euro.ts` per ogni importo.
- Usare token semantici, layout denso e nessuno scroll orizzontale globale.
- Nessun commit automatico: l'utente ha richiesto lavoro diretto su `main`, non il commit.

---

### Task 1: Separare competenza e cassa FiC

**Files:**
- Modify: `server/_core/economiaFic.ts`
- Test: `server/_core/economiaFic.test.ts`

**Interfaces:**
- Consumes: `DocumentoEconomico`, rate FiC normalizzate con `dataPagamento`.
- Produces: `calcolaAggregatiFic(documenti, anno)` con incassi/uscite mensili per data pagamento e contatori senza data.

- [x] **Step 1: Scrivere i test fallenti**

```ts
it("attribuisce gli incassi al mese del pagamento", () => {
  const risultato = calcolaAggregatiFic([
    documento("invoice", "2025-12-20", 1_000, {
      rate: [{ importo: 1_220, stato: "paid", dataPagamento: "2026-02-03" }],
    }),
  ], 2026);
  expect(risultato.vendite.pagato).toBe(1_220);
  expect(risultato.mesi[1].incassi).toBe(1_220);
});

it("mantiene le fatture ignorate nei totali", () => {
  const risultato = calcolaAggregatiFic([
    documento("invoice", "2026-03-02", 200, { ignorato: true }),
  ], 2026);
  expect(risultato.vendite.netto).toBe(200);
});
```

- [x] **Step 2: Verificare il rosso**

Run: `pnpm vitest run server/_core/economiaFic.test.ts`
Expected: FAIL perché gli incassi usano ancora il mese documento e gli ignorati sono esclusi.

- [x] **Step 3: Implementare il minimo**

Estendere `RataEconomica` con `dataPagamento`, calcolare competenza per `documento.data`, cassa per `rata.dataPagamento` e registrare `pagatoSenzaData` senza assegnazione mensile. `presenteInFic=false` resta l'unico motivo contabile di esclusione.

- [x] **Step 4: Verificare il verde**

Run: `pnpm vitest run server/_core/economiaFic.test.ts`
Expected: PASS.

### Task 2: Esporre il confronto annuale CRM/FiC

**Files:**
- Modify: `server/routers/economia.ts`
- Test: `server/routers/economia.test.ts`

**Interfaces:**
- Consumes: `calcolaAggregatiFic`, `getCommesseStore()` e `pagamenti[].data`.
- Produces: `overview.confrontoIncassi` e `mesi[].incassiCrm`; preserva `overview.crm` come portafoglio attivo all-time.

- [x] **Step 1: Scrivere il test fallente**

```ts
expect(overview.confrontoIncassi).toMatchObject({
  crm: 700,
  fic: 600,
  scostamento: 100,
  crmSenzaData: 50,
});
expect(overview.mesi[3].incassiCrm).toBe(700);
```

La fixture include un pagamento datato su commessa archiviata e uno senza data.

- [x] **Step 2: Verificare il rosso**

Run: `pnpm vitest run server/routers/economia.test.ts`
Expected: FAIL perché il contratto `confrontoIncassi` non esiste.

- [x] **Step 3: Implementare il minimo**

Aggregare tutti i pagamenti della sede per data, indipendentemente dallo stato attuale della commessa; esporre separatamente importi e conteggi senza data. Rimuovere `!fattura.ignorata` dal conteggio contabile e aggiungere `escluseRiconciliazione`.

- [x] **Step 4: Verificare il verde e la compatibilita**

Run: `pnpm vitest run server/routers/economia.test.ts server/tars/tars.test.ts`
Expected: PASS.

### Task 3: Ridisegnare Panoramica e coda fatture

**Files:**
- Create: `client/src/components/economia/EconomiaPanoramica.tsx`
- Modify: `client/src/pages/Economia.tsx`
- Modify: `client/src/lib/economiaView.ts`
- Test: `client/src/lib/economiaView.test.ts`

**Interfaces:**
- Consumes: `trpc.economia.overview({ anno })` con `confrontoIncassi`, `crm`, `vendite`, `acquisti` e `mesi`.
- Produces: vista `Controllo incassi`, bande FiC, portafoglio CRM separato e andamento `competenza | cassa`.

- [x] **Step 1: Scrivere il test fallente della presentazione**

```ts
expect(statoScostamentoIncassi(0, 0, true)).toBe("allineato");
expect(statoScostamentoIncassi(100, 0, true)).toBe("da_verificare");
expect(statoScostamentoIncassi(0, 2, true)).toBe("dati_incompleti");
expect(statoScostamentoIncassi(0, 0, false)).toBe("dati_non_disponibili");
```

- [x] **Step 2: Verificare il rosso**

Run: `pnpm vitest run client/src/lib/economiaView.test.ts`
Expected: FAIL perché l'helper non esiste.

- [x] **Step 3: Implementare helper e UI**

Creare bande con divisori, etichette `anno/fonte/base`, messaggio esplicito sul portafoglio CRM e tab mensili `Competenza`/`Cassa`. Rinomina `Ignora` in `Escludi dalla riconciliazione` e correggi tooltip/testi senza cambiare la mutation esistente.

- [x] **Step 4: Verificare tipi e test mirati**

Run: `pnpm vitest run client/src/lib/economiaView.test.ts && pnpm check`
Expected: PASS.

### Task 4: Documentare e verificare il rilascio

**Files:**
- Modify: `handoff.md`
- Modify: `docs/superpowers/specs/2026-08-25-economia-fic-break-even-design.md`

**Interfaces:**
- Consumes: contratto finale verificato.
- Produces: runbook aggiornato con significato di competenza, cassa, ignorati e pagamenti senza data.

- [x] **Step 1: Aggiornare il runbook**

Documentare che `Incassato FiC` usa `dataPagamento`, `Incassato CRM` usa `pagamenti[].data`, gli ignorati restano nei totali e il portafoglio CRM e all-time.

- [x] **Step 2: Eseguire la verifica completa**

Run: `pnpm check && pnpm test && pnpm build && git diff --check`
Expected: tutti i comandi terminano con exit code 0.

- [x] **Step 3: Verificare la UI**

Controllare `/economia` a `1440x900` e `390x844`, console pulita, focus visibile e nessuno scroll orizzontale globale.

Verificato il 26/08/2026: `scrollWidth === clientWidth` su entrambe le
viewport, console senza warning/errori, vista mobile mensile senza tabelle
orizzontali e tab `Cassa` operativa.
