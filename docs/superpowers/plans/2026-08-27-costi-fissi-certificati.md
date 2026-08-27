# Costi fissi certificati Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fare del registro confermato l'unica fonte del totale costi fissi e usare FiC soltanto per proporre candidati.

**Architecture:** `costi_fissi_manuali` conserva voci manuali e confermate da FiC. Il rilevatore di ricorrenza resta puro e genera candidati; sync e Tars non possono più trasformare una ricorrenza in costo fisso certo. Acquisti mantiene classificazione aziendale senza associazione a commesse.

**Tech Stack:** TypeScript, tRPC 11, React 19, React Query, Vitest, persistedStore JSONB.

**Spec:** `docs/superpowers/specs/2026-08-27-costi-fissi-certificati-commesse-fic-design.md`

## Global Constraints

- Tutte le letture e scritture business sono filtrate per `sedeId`.
- Una decisione Tars o aritmetica non entra nel totale senza conferma umana.
- Nessun costo FiC viene associato o sommato a una commessa.
- I valori legacy restano leggibili e non vengono cancellati.
- Ogni cambiamento di comportamento nasce da un test fallente.

---

### Task 1: Registro confermato e candidati FiC

**Files:**
- Modify: `server/routers/costiFissi.ts`
- Modify: `server/routers/ficCosti.ts`
- Modify: `server/_core/costiRicorrenti.ts`
- Test: `server/routers/costiFissi.test.ts`
- Test: `server/_core/costiRicorrenti.test.ts`

**Interfaces:**
- Produces: `origine: "manuale" | "fic"`, `ficChiaveRicorrenza: string | null` su `CostoFissoManuale`.
- Produces: `candidatiFissiPerSede(sedeId): GruppoRicorrente[]`.
- Produces: mutation `costiFissi.confermaDaFic`.
- Consumes: `rilevaCostiRicorrenti(costi, sedeId)`.

- [ ] **Step 1: Scrivere test fallente: ricorrenza non classifica documenti**

Nel test di `upsertCostiFic`, inserire tre spese mensili uguali e verificare:

```ts
expect(rows.every(costo => costo.classificazione === "dubbio")).toBe(true);
expect(result.fissiPerRicorrenza).toBe(0);
expect(candidatiFissiPerSede(sedeId)).toHaveLength(1);
```

- [ ] **Step 2: Eseguire RED**

Run: `pnpm vitest run server/_core/costiRicorrenti.test.ts server/routers/ficCosti.test.ts`

Expected: FAIL perché `upsertCostiFic` chiama ancora `applicaCostiRicorrenti`.

- [ ] **Step 3: Separare proposta da decisione**

Rimuovere l'applicazione automatica da `upsertCostiFic`. Aggiungere:

```ts
export function candidatiFissiPerSede(sedeId: number): GruppoRicorrente[] {
  const esclusi = fornitoriNonFissi(sedeId);
  return rilevaCostiRicorrenti(ficCosti, sedeId).filter(
    gruppo => !esclusi.has(chiaveFornitore(gruppo.fornitore))
  );
}
```

`ricorrenti` usa questo helper e restituisce `totaleMensilePotenziale`, mai `totaleMensile` contabile.

- [ ] **Step 4: Scrivere test fallente: conferma crea una sola voce**

```ts
const first = await caller.costiFissi.confermaDaFic({
  chiave: candidato.chiave,
  descrizione: "Canone TIM",
  cadenza: "mensile",
  categoria: "servizi",
  dal: "2026-01",
});
const second = await caller.costiFissi.confermaDaFic(/* stesso input */);
expect(second.id).toBe(first.id);
expect((await caller.costiFissi.list()).totaleMensile).toBe(candidato.importo);
```

- [ ] **Step 5: Eseguire RED**

Run: `pnpm vitest run server/routers/costiFissi.test.ts`

Expected: FAIL perché mutation e campi origine non esistono.

- [ ] **Step 6: Implementare conferma idempotente**

Backfill su `CostoFissoManuale`:

```ts
origine: "manuale" | "fic";
ficChiaveRicorrenza: string | null;
```

`create` imposta `origine: "manuale"`. `confermaDaFic` trova candidato nella sede, crea o restituisce voce con `origine: "fic"`, importo proposto e chiave univoca per sede.

- [ ] **Step 7: Eseguire GREEN**

Run: `pnpm vitest run server/_core/costiRicorrenti.test.ts server/routers/ficCosti.test.ts server/routers/costiFissi.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/_core/costiRicorrenti.ts server/_core/costiRicorrenti.test.ts server/routers/ficCosti.ts server/routers/ficCosti.test.ts server/routers/costiFissi.ts server/routers/costiFissi.test.ts
git commit -m "fix(economia): require fixed-cost confirmation"
```

### Task 2: Rimuovere costi FiC dalle commesse

**Files:**
- Modify: `server/routers/ficCosti.ts`
- Modify: `server/routers/commesse.ts`
- Modify: `server/_core/margine.ts`
- Modify: `server/_core/margine.test.ts`
- Modify: `client/src/pages/CommessaDetail.tsx`
- Test: `server/routers/ficCosti.test.ts`

**Interfaces:**
- Removes: `costiFicPerCommessa`, `totaliCostiFicPerCommessa`, `candidatiCommessaPerCosto`.
- Removes: procedures `assegnaCommessa`, `candidatiCommessa`.
- Produces: `calcolaMargine(commessa)` usa soltanto `commessa.costi` e posa.

- [ ] **Step 1: Scrivere test fallente sul margine**

```ts
const risultato = calcolaMargine(
  { importoTotale: 10_000, costi: [], costoPosaStimato: 1_000 },
  [{ id: 9, importo: 2_000 } as any]
);
expect(risultato.costiFornitore).toBe(0);
expect(risultato.margineLordo).toBe(9_000);
```

- [ ] **Step 2: Eseguire RED**

Run: `pnpm vitest run server/_core/margine.test.ts`

Expected: FAIL con `costiFornitore` pari a 2.000.

- [ ] **Step 3: Rimuovere integrazione**

Ripristinare firma `calcolaMargine(commessa)`. `CostoCommessa` torna manuale, senza `origine` e `ficCostoId`. Rimuovere import/helper FiC da `commesse.ts` e rendering FiC da `CommessaDetail.tsx`.

- [ ] **Step 4: Rimuovere API di assegnazione**

Eliminare helper e procedure sopra elencati. Conservare `CostoFic.commessaId` e backfill soltanto per leggere record legacy.

- [ ] **Step 5: Eseguire GREEN**

Run: `pnpm vitest run server/_core/margine.test.ts server/routers/ficCosti.test.ts server/routers/commesse.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/routers/ficCosti.ts server/routers/commesse.ts server/_core/margine.ts server/_core/margine.test.ts client/src/pages/CommessaDetail.tsx server/routers/ficCosti.test.ts
git commit -m "refactor(economia): detach purchases from jobs"
```

### Task 3: Totale certo e UI di classificazione

**Files:**
- Modify: `server/routers/economia.ts`
- Modify: `server/_core/economiaFic.ts`
- Modify: `server/_core/economiaFic.test.ts`
- Modify: `client/src/components/economia/CostiFissi.tsx`
- Modify: `client/src/components/economia/CostiFicReview.tsx`
- Modify: `client/src/components/economia/BreakEvenPanel.tsx`

**Interfaces:**
- Consumes: `costiFissiManualiPerSede(sedeId)` come sola fonte fissa.
- Consumes: `ficCosti.ricorrenti` come candidati esclusi.
- Produces: `daCoprireMensile === costiFissiMensili` come indicatore principale.

- [ ] **Step 1: Scrivere test fallente sul pareggio**

```ts
const result = calcolaBreakEven({
  periodoDa: "2025-09-01",
  periodoA: "2026-08-31",
  documentiEmessi: [],
  documentiRicevuti: [{ classificazione: "fisso", importoNetto: 99_000 }],
  costiFissiDichiarati: [{ mensile: 2_500, mesiNelPeriodo: 12 }],
});
expect(result.costiFissiMensili).toBe(2_500);
expect(result.daCoprireMensile).toBe(2_500);
```

- [ ] **Step 2: Eseguire RED**

Run: `pnpm vitest run server/_core/economiaFic.test.ts`

Expected: FAIL perché i documenti FiC classificati fissi entrano ancora nel totale o viene applicato il margine.

- [ ] **Step 3: Correggere calcolo principale**

Il totale fisso usa solo `costiFissiDichiarati`. Conservare eventuale scenario con margine in campo separato; `daCoprireMensile` deve essere il totale mensile certo.

- [ ] **Step 4: Semplificare Acquisti**

Rimuovere `AssegnaCommessa`, vista `Senza commessa`, query candidati e icone link. Rinominare bottone `Commessa` in `Variabile`; inviare ancora `variabile_commessa` per compatibilità storage.

- [ ] **Step 5: Costruire Costi fissi in tre blocchi**

Mostrare `Totale certo`, `Registro confermato`, `Da confermare da FiC`. Per candidato, bottone `Conferma fisso` apre form precompilato; `Variabile` e `Straordinario` salvano regola umana ed eliminano candidato.

- [ ] **Step 6: Eseguire test e typecheck mirati**

Run: `pnpm vitest run server/_core/economiaFic.test.ts server/routers/costiFissi.test.ts server/routers/ficCosti.test.ts && pnpm check`

Expected: PASS, zero errori TypeScript.

- [ ] **Step 7: Commit**

```bash
git add server/routers/economia.ts server/_core/economiaFic.ts server/_core/economiaFic.test.ts client/src/components/economia/CostiFissi.tsx client/src/components/economia/CostiFicReview.tsx client/src/components/economia/BreakEvenPanel.tsx
git commit -m "feat(economia): show confirmed fixed costs"
```

### Task 4: Contratto e verifica globale

**Files:**
- Modify: `handoff.md`
- Modify: `docs/superpowers/specs/2026-08-25-economia-fic-break-even-design.md`

**Interfaces:**
- Produces: documentazione coerente con registro confermato e assenza costo-commessa.

- [ ] **Step 1: Aggiornare documentazione**

Segnare come superate formula automatica e associazione FiC-commessa. Documentare campi origine, flusso conferma e compatibilità `variabile_commessa`.

- [ ] **Step 2: Verificare tutto**

Run: `pnpm check && pnpm test && pnpm build`

Expected: tutti i comandi escono `0`.

- [ ] **Step 3: Commit**

```bash
git add handoff.md docs/superpowers/specs/2026-08-25-economia-fic-break-even-design.md
git commit -m "docs(economia): record confirmed-cost contract"
```

