# WS4 «Abbonamenti» — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ogni tenant ha un abbonamento nel control plane (prova di 30 giorni, omaggio, insoluto → sola lettura), lo storage e Tars superata quota e tolleranza fermano solo ciò che costa, l'azienda vede stato e consumi; con `FLAG_MULTI_AZIENDA` spento nulla agisce.

**Architecture:** tabella `abbonamenti` scritta solo da `server/tenants/repository.ts`; dominio in `server/abbonamenti/` (stati e transizioni, worker ogni 6 ore via `perOgniTenantAttivo`, adattatore del provider con implementazione «nessuno», politica di quota e budget); due ganci iniettati al boot — `impostaVerificaQuota` in `fileStorage.ts` e `impostaPoliticaTarsAzienda` nel governor di Tars — come il contabile del WS3; ledger dei costi con somma per azienda e mese; query `tenants.abbonamento`/`tenants.consumi`, avviso nella shell e scheda in Integrazioni; comandi `pnpm tenant abbonamento`.

**Tech Stack:** Node 20, TypeScript, postgres-js (`kvSql`), tRPC 11, vitest (fake timers `toFake: ["Date"]`), React 19 + shadcn per la scheda; Postgres 16 in Docker per i `*.pg.test.ts`.

**Spec:** `docs/superpowers/specs/2026-09-08-ws4-abbonamenti-design.md` (citata come «spec §n»). Spec madre: `docs/superpowers/specs/2026-09-06-saas-multi-azienda-design.md` (§4, §9–§11, §16.3, §18-bis). WS3: `docs/superpowers/specs/2026-09-08-ws3-file-integrazioni-design.md`.

## Global Constraints

- **Branch:** `feature/ws4-abbonamenti` (da `feature/ws3-file-integrazioni` @ `a44fc37`; spec al commit `f5ff33a`). Mai commit su `main`. Mai `git stash`.
- **Commit:** messaggi in italiano, prefissi `feat|fix|test|docs(abbonamenti|tenant|storage|tars|client|…)`; ogni commit termina con `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- **Interruttore:** `interruttoreAttivo("multiAzienda")` è ON nei test per default (`delete process.env.FLAG_MULTI_AZIENDA`), OFF con `process.env.FLAG_MULTI_AZIENDA = "off"`; ripristinare in `afterEach`. A interruttore spento: nessun worker degli abbonamenti, nessun rifiuto di upload, nessun limite Tars per azienda; i seed (riga omaggio del tenant 1) e le tabelle esistono comunque.
- **Control plane:** `abbonamenti` (e `tenant_storage.soglia_100_dal`) scritte SOLO da `server/tenants/repository.ts` (`confine.test.ts` esteso). `kv_store` solo da `persistence.ts`.
- **Contesto:** `tenantCorrente()` (foglia `server/tenants/contestoCorrente.ts`); `tenantIdDellaSede` in `server/tenants/contesto.ts`; giri con `perOgniTenantAttivo` (interruttore del WS3). I moduli di `server/abbonamenti/` importano `server/tenants/*`, `server/_core/fileStorage`, `server/tars/costi/governor` (per il tipo della politica) e `server/notifications/*`; `fileStorage.ts` e il governor NON importano `server/abbonamenti` (ricevono ganci iniettati).
- **Messaggi utente** (`server/abbonamenti/costanti.ts` `MESSAGGI_ABBONAMENTO`): `spazioEsaurito(gb)` = `Spazio esaurito: l'azienda ha superato i ${gb} GB inclusi. Libera spazio o chiedi capacità aggiuntiva.`; `budgetTars` = `Tars ha esaurito il budget mensile dell'azienda; le funzioni che non costano restano disponibili, il budget si rinnova il primo del mese.`; `tenant1Intoccabile` = `Il tenant 1 è la proprietaria della piattaforma: niente omaggio, proroga o disdetta.`; sola lettura = `MESSAGGI.solaLettura` del WS1.
- **Costanti** (`server/abbonamenti/costanti.ts`): `GIORNI_PROVA = 30`, `GIORNI_TOLLERANZA_INSOLUTO = 7`, `GIORNI_AVVISO = [7, 3, 1]`, `TOLLERANZA_PREDEFINITA_GIORNI = 7`, `budgetTarsPredefinitoEur()` da `SAAS_BUDGET_TARS_EUR_MESE` (default `25`), `cambioEurUsd()` da `SAAS_CAMBIO_EUR_USD` (default `1.08`), `eurInNano(eur) = Math.round(eur * cambio * 1e9)`, `nanoInEur`. Il ledger Tars conta in nano-USD.
- **Tempo:** ogni funzione che decide sul tempo riceve `adesso: Date` (test con `vi.useFakeTimers({ now, toFake: ["Date"] })`); i giorni si contano su istanti (`fine.getTime() - adesso.getTime()`), mai su date locali.
- **Test:** `pnpm check` (esclude i test), `pnpm vitest run <file>`, `pnpm test`; pg: `DATABASE_URL=postgres://postgres:test@localhost:55433/perf_test pnpm vitest run <files> --no-file-parallelism` (Docker `perf-pg-test`); nei file che importano i router mai `__resetPersistenzaPerTest()` (regola pre-1 del WS3). Baseline: i 3 test HEIC «sips» possono essere rossi sulla macchina.
- **Client:** solo `client/src/components/abbonamento/*` (nuovi), i due layout e `Integrazioni.tsx`; token semantici di `index.css`, lucide, `aria-label`; verifica a 1440×900 e 390×844 con il login demo dell'anteprima (memoria: `launch.json` + harness `.mts` che semina gli store).
- **Nomi in italiano**, commenti che spiegano il perché; niente segreti nei log.

---

### Task 1: Control plane — tabella `abbonamenti`, `soglia_100_dal`, tipi ed eventi, repository

**Files:**
- Modify: `server/tenants/tipi.ts`, `server/tenants/costanti.ts` (`MESSAGGI.schemaAssente` con sette tabelle), `server/tenants/repository.ts` (tipo, memoria, Postgres), `server/tenants/confine.test.ts` (guardia: `abbonamenti` scritta solo dal repository)
- Test: `server/tenants/repository.test.ts`, `server/tenants/repository.pg.test.ts` (aggiungere `abbonamenti` ai `DROP TABLE`)

**Interfaces:**
- Produces:
  ```ts
  // tipi.ts
  export type TipoEvento = …oggi… | "abbonamento_creato" | "abbonamento_stato" | "abbonamento_omaggio" | "abbonamento_prova_prorogata" | "abbonamento_avviso" | "abbonamento_modificato" | "tars_soglia" | "storage_bloccato" | "storage_sbloccato" | "tars_bloccato" | "tars_sbloccato";
  export type TipoComando = …oggi… | "imposta_abbonamento";
  export type TipoAbbonamento = "paid" | "complimentary";
  export type Periodicita = "monthly" | "yearly";
  export type StatoAbbonamento = "trialing" | "active" | "past_due" | "grace" | "suspended" | "cancelled";
  export type Omaggio = { motivo: string; attore: string; dataIso: string; scadenzaIso: string | null };
  export type Abbonamento = {
    tenantId: number; tipo: TipoAbbonamento; periodicita: Periodicita | null; stato: StatoAbbonamento;
    inizioPeriodo: Date; finePeriodo: Date | null; prossimoRinnovo: Date | null; disdettaAFinePeriodo: boolean;
    budgetTarsNanoMese: number | null; extraTarsNano: number; extraTarsMese: string | null;
    tolleranzaStorageGiorni: number; tolleranzaTarsGiorni: number;
    tarsSogliaAvvisata: 0 | 50 | 80 | 100; tarsSogliaMese: string | null; tarsSoglia100Dal: Date | null;
    insolutoDal: Date | null; provider: string; providerRef: Record<string, unknown> | null; omaggio: Omaggio | null;
    createdAt: Date; updatedAt: Date;
  };
  export type StatoStorage = { …oggi…; soglia100Dal: Date | null };
  // repository.ts (TenantRepository)
  abbonamentoDi(tenantId: number): Abbonamento | null;               // dalla cache (caricata in caricaCache)
  abbonamenti(): Abbonamento[];
  salvaAbbonamento(a: Abbonamento): Promise<Abbonamento>;             // upsert intero, updated_at = NOW(), aggiorna la cache
  impostaSoglia100Storage(tenantId: number, dal: Date | null): Promise<void>;
  ```

- [ ] **Step 1: Test in memoria che falliscono** — in `repository.test.ts` (describe esistente):

```ts
  it("abbonamenti: upsert intero, cache, soglia_100 dello storage", async () => {
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "Ruffino Group" });
    expect(repo.abbonamentoDi(1)).toBeNull();
    const ora = new Date("2026-09-08T10:00:00Z");
    const a = await repo.salvaAbbonamento({
      tenantId: 1, tipo: "complimentary", periodicita: null, stato: "active",
      inizioPeriodo: ora, finePeriodo: null, prossimoRinnovo: null, disdettaAFinePeriodo: false,
      budgetTarsNanoMese: null, extraTarsNano: 0, extraTarsMese: null,
      tolleranzaStorageGiorni: 7, tolleranzaTarsGiorni: 7,
      tarsSogliaAvvisata: 0, tarsSogliaMese: null, tarsSoglia100Dal: null,
      insolutoDal: null, provider: "nessuno", providerRef: null,
      omaggio: { motivo: "proprietaria", attore: "boot", dataIso: ora.toISOString(), scadenzaIso: null },
      createdAt: ora, updatedAt: ora,
    });
    expect(a.stato).toBe("active");
    expect(repo.abbonamentoDi(1)?.omaggio?.motivo).toBe("proprietaria");
    const b = await repo.salvaAbbonamento({ ...a, stato: "suspended", insolutoDal: ora });
    expect(repo.abbonamentoDi(1)?.stato).toBe("suspended");
    expect(b.updatedAt.getTime()).toBeGreaterThanOrEqual(a.updatedAt.getTime());
    expect(repo.abbonamenti().map(x => x.tenantId)).toEqual([1]);
    await repo.aggiornaStorage(1, 10, 1);
    await repo.impostaSoglia100Storage(1, ora);
    expect((await repo.storageDi(1))?.soglia100Dal?.toISOString()).toBe(ora.toISOString());
    await repo.impostaSoglia100Storage(1, null);
    expect((await repo.storageDi(1))?.soglia100Dal).toBeNull();
  });
```

- [ ] **Step 2: Vederlo fallire** — `pnpm vitest run server/tenants/repository.test.ts`. Expected: FAIL (`abbonamentoDi` non è una funzione).

- [ ] **Step 3: Tipi e costanti** — `tipi.ts` come nelle Interfaces; `costanti.ts`: `MESSAGGI.schemaAssente` elenca `tenants, tenant_eventi, tenant_comandi, tenant_sedi, tenant_storage, oauth_state, abbonamenti`.

- [ ] **Step 4: Repository in memoria**

```ts
  const abbonamentiMem = new Map<number, Abbonamento>();
  // …nel repo:
    abbonamentoDi: id => clone(abbonamentiMem.get(id) ?? null),
    abbonamenti: () => [...abbonamentiMem.values()].sort((a, b) => a.tenantId - b.tenantId).map(clone),
    async salvaAbbonamento(a) {
      if (!tenants.some(t => t.id === a.tenantId)) throw new Error(`tenant ${a.tenantId} inesistente`);
      const salvato: Abbonamento = { ...clone(a), createdAt: abbonamentiMem.get(a.tenantId)?.createdAt ?? a.createdAt, updatedAt: new Date() };
      abbonamentiMem.set(a.tenantId, salvato);
      return clone(salvato);
    },
    async impostaSoglia100Storage(tenantId, dal) {
      rigaStorage(tenantId).soglia100Dal = dal;
    },
```

`rigaStorage`/`storageDi`/`aggiornaStorage`/`impostaStorage` in memoria portano `soglia100Dal: null` nel record iniziale e lo conservano.

- [ ] **Step 5: Repository Postgres** — DDL in `creaSchema` dopo `oauth_state` (SQL della spec §3, verbatim), `ALTER TABLE tenant_storage ADD COLUMN IF NOT EXISTS soglia_100_dal TIMESTAMPTZ`, CHECK di `tenant_comandi` con `imposta_abbonamento` (lista inline e guardia `pg_constraint` del WS3: la condizione «definizione senza `imposta_abbonamento`» sostituisce quella su `ripristina_archivi`), `verificaSchema` con `to_regclass('abbonamenti')`. Mappatura:

```ts
  const rigaAbbonamento = (r: any): Abbonamento => ({
    tenantId: Number(r.tenant_id), tipo: r.tipo, periodicita: r.periodicita ?? null, stato: r.stato,
    inizioPeriodo: new Date(r.inizio_periodo), finePeriodo: r.fine_periodo ? new Date(r.fine_periodo) : null,
    prossimoRinnovo: r.prossimo_rinnovo ? new Date(r.prossimo_rinnovo) : null,
    disdettaAFinePeriodo: Boolean(r.disdetta_a_fine_periodo),
    budgetTarsNanoMese: r.budget_tars_nano_mese == null ? null : Number(r.budget_tars_nano_mese),
    extraTarsNano: Number(r.extra_tars_nano ?? 0), extraTarsMese: r.extra_tars_mese ?? null,
    tolleranzaStorageGiorni: Number(r.tolleranza_storage_giorni), tolleranzaTarsGiorni: Number(r.tolleranza_tars_giorni),
    tarsSogliaAvvisata: Number(r.tars_soglia_avvisata) as Abbonamento["tarsSogliaAvvisata"],
    tarsSogliaMese: r.tars_soglia_mese ?? null, tarsSoglia100Dal: r.tars_soglia_100_dal ? new Date(r.tars_soglia_100_dal) : null,
    insolutoDal: r.insoluto_dal ? new Date(r.insoluto_dal) : null,
    provider: r.provider ?? "nessuno", providerRef: r.provider_ref ?? null, omaggio: r.omaggio ?? null,
    createdAt: new Date(r.created_at), updatedAt: new Date(r.updated_at),
  });
```

`caricaCache` carica anche `SELECT * FROM abbonamenti` in `cacheAbbonamenti: Map<number, Abbonamento>`; `salvaAbbonamento` fa `INSERT … ON CONFLICT (tenant_id) DO UPDATE SET <ogni colonna> = EXCLUDED.<colonna>, updated_at = NOW() RETURNING *` (i JSON con `sql.json`), aggiorna la cache; `impostaSoglia100Storage` = `INSERT INTO tenant_storage (tenant_id, soglia_100_dal) VALUES (…) ON CONFLICT (tenant_id) DO UPDATE SET soglia_100_dal = EXCLUDED.soglia_100_dal, aggiornato_il = NOW()`; `rigaStorage` legge `soglia_100_dal`.

- [ ] **Step 6: Test Postgres** — in `repository.pg.test.ts` (DROP con `abbonamenti`): salva/rilegge un abbonamento con date e JSON, upsert che cambia stato, `caricaCache()` su un repository nuovo che ritrova l'abbonamento, `impostaSoglia100Storage` prima di ogni delta, comando `imposta_abbonamento` accettato dal CHECK, idempotenza dello schema (secondo `ensureSchema` senza errori). `confine.test.ts`: la regex delle scritture copre `abbonamenti`.

- [ ] **Step 7: Eseguire** — `pnpm vitest run server/tenants`; pg trio + `repository.pg.test.ts` in sequenza; `pnpm check`. Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/tenants/tipi.ts server/tenants/costanti.ts server/tenants/repository.ts server/tenants/repository.test.ts server/tenants/repository.pg.test.ts server/tenants/confine.test.ts
git commit -m "feat(tenant): tabella abbonamenti, soglia_100_dal dello storage, tipi di evento e comando del WS4 nel control plane"
```

---

### Task 2: Dominio dell'abbonamento — stati, transizioni, avvisi, seed del tenant 1

**Files:**
- Create: `server/abbonamenti/tipi.ts` (riesporta i tipi di `server/tenants/tipi.ts` + `Attore`), `server/abbonamenti/costanti.ts`, `server/abbonamenti/servizio.ts`
- Test: `server/abbonamenti/servizio.test.ts`

**Interfaces:**
- Consumes: repository del Task 1; `sospendi`/`riattiva` di `server/tenants/servizio.ts`; `TENANT_PREDEFINITO_ID`.
- Produces (usati dai task 3, 4, 5, 6, 7):
  ```ts
  // costanti.ts
  export const GIORNI_PROVA = 30; export const GIORNI_TOLLERANZA_INSOLUTO = 7; export const GIORNI_AVVISO = [7, 3, 1] as const;
  export const TOLLERANZA_PREDEFINITA_GIORNI = 7;
  export function budgetTarsPredefinitoEur(): number;      // SAAS_BUDGET_TARS_EUR_MESE, default 25; valore non valido → errore chiaro
  export function cambioEurUsd(): number;                   // SAAS_CAMBIO_EUR_USD, default 1.08
  export function eurInNano(eur: number): number; export function nanoInEur(nano: number): number;
  export const MESSAGGI_ABBONAMENTO = { spazioEsaurito: (gb: number) => string, budgetTars: string, tenant1Intoccabile: string };
  export function meseLocale(adesso: Date): string;         // "AAAA-MM" Europe/Rome (riusa periodiLocali del ledger)
  export function giorniInteriFino(fine: Date, adesso: Date): number; // Math.ceil((fine - adesso) / 86_400_000), può essere negativo
  // servizio.ts
  export async function creaProva(tenantId: number, adesso: Date, attore: Attore): Promise<Abbonamento>;             // idempotente
  export async function assicuraAbbonamentoPredefinito(adesso: Date): Promise<Abbonamento>;                          // tenant 1 omaggio senza scadenza, budget null
  export async function concediOmaggio(tenantId: number, input: { motivo: string; scadenza: Date | null }, attore: Attore, adesso: Date): Promise<Abbonamento>;
  export async function prorogaProva(tenantId: number, giorni: number, motivo: string, attore: Attore, adesso: Date): Promise<Abbonamento>;
  export async function impostaBudgetTars(tenantId: number, budgetNano: number | null, attore: Attore): Promise<Abbonamento>;
  export async function aggiungiExtraTars(tenantId: number, extraNano: number, attore: Attore, adesso: Date): Promise<Abbonamento>;
  export async function impostaTolleranze(tenantId: number, input: { storage?: number; tars?: number }, attore: Attore): Promise<Abbonamento>;
  export async function impostaDisdetta(tenantId: number, disdetta: boolean, attore: Attore): Promise<Abbonamento>;
  export async function valutaAbbonamento(tenantId: number, adesso: Date): Promise<{ transizione: StatoAbbonamento | null; avviso: number | null }>;
  export function giorniAllaScadenza(a: Abbonamento, adesso: Date): number | null;
  ```

- [ ] **Step 1: Test che falliscono** — `server/abbonamenti/servizio.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTenantRepository, resetTenantRepositoryForTesting } from "../tenants/repository";
import { getSediStore } from "../routers/sedi";
import { GIORNI_PROVA, eurInNano } from "./costanti";
import {
  aggiungiExtraTars, assicuraAbbonamentoPredefinito, concediOmaggio, creaProva, giorniAllaScadenza,
  impostaBudgetTars, impostaDisdetta, prorogaProva, valutaAbbonamento,
} from "./servizio";

const T0 = new Date("2026-09-08T09:00:00Z");
const giorni = (n: number) => new Date(T0.getTime() + n * 86_400_000);
const attore = { tipo: "script" as const, nome: "test" };

describe("abbonamenti: stati e transizioni", () => {
  beforeEach(async () => {
    delete process.env.FLAG_MULTI_AZIENDA;
    resetTenantRepositoryForTesting();
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "Ruffino Group" });
    await repo.inserisci({ id: 2, slug: "acme", nome: "Acme" });
    getSediStore().length = 0;
    getSediStore().push({ id: 20, tenantId: 2, nome: "HQ", attiva: true } as any);
  });
  afterEach(() => { resetTenantRepositoryForTesting(); getSediStore().length = 0; vi.useRealTimers(); });

  it("creaProva: 30 giorni, budget predefinito, idempotente; tenant 1 omaggio senza scadenza", async () => {
    const a = await creaProva(2, T0, attore);
    expect(a).toMatchObject({ tipo: "paid", stato: "trialing", periodicita: null, tolleranzaStorageGiorni: 7, tolleranzaTarsGiorni: 7 });
    expect(a.finePeriodo?.toISOString()).toBe(giorni(GIORNI_PROVA).toISOString());
    expect(a.budgetTarsNanoMese).toBe(eurInNano(25));
    expect((await creaProva(2, giorni(1), attore)).finePeriodo?.toISOString()).toBe(a.finePeriodo?.toISOString());
    const uno = await assicuraAbbonamentoPredefinito(T0);
    expect(uno).toMatchObject({ tenantId: 1, tipo: "complimentary", stato: "active", finePeriodo: null, budgetTarsNanoMese: null });
    expect((await getTenantRepository().eventi(2)).map(e => e.tipo)).toEqual(["abbonamento_creato"]);
  });

  it("avvisi a 7, 3 e 1 giorno una volta sola; poi insoluto; dopo 7 giorni sola lettura", async () => {
    const repo = getTenantRepository();
    await creaProva(2, T0, attore);
    expect(await valutaAbbonamento(2, giorni(10))).toEqual({ transizione: null, avviso: null });
    expect(await valutaAbbonamento(2, giorni(23))).toEqual({ transizione: null, avviso: 7 });
    expect(await valutaAbbonamento(2, giorni(23.5))).toEqual({ transizione: null, avviso: null });
    expect(await valutaAbbonamento(2, giorni(27))).toEqual({ transizione: null, avviso: 3 });
    expect(await valutaAbbonamento(2, giorni(29))).toEqual({ transizione: null, avviso: 1 });
    expect(await valutaAbbonamento(2, giorni(30.1))).toEqual({ transizione: "past_due", avviso: null });
    expect(repo.abbonamentoDi(2)?.insolutoDal?.toISOString()).toBe(giorni(30.1).toISOString());
    expect(repo.perId(2)?.stato).toBe("attivo");
    expect(await valutaAbbonamento(2, giorni(33))).toEqual({ transizione: null, avviso: null });
    expect(await valutaAbbonamento(2, giorni(37.2))).toEqual({ transizione: "suspended", avviso: null });
    expect(repo.perId(2)?.stato).toBe("sospeso");
    expect(repo.perId(2)?.motivoStato).toContain("insoluto");
    const tipi = (await repo.eventi(2)).map(e => e.tipo);
    expect(tipi.filter(t => t === "abbonamento_avviso")).toHaveLength(3);
    expect(tipi.filter(t => t === "abbonamento_stato")).toHaveLength(2);
    expect(tipi).toContain("sospeso");
  });

  it("omaggio riattiva un sospeso; proroga riporta in prova; disdetta", async () => {
    const repo = getTenantRepository();
    await creaProva(2, T0, attore);
    await valutaAbbonamento(2, giorni(30.1));
    await valutaAbbonamento(2, giorni(38));
    const om = await concediOmaggio(2, { motivo: "pilota", scadenza: giorni(120) }, attore, giorni(38));
    expect(om).toMatchObject({ tipo: "complimentary", stato: "active", insolutoDal: null });
    expect(om.omaggio?.motivo).toBe("pilota");
    expect(repo.perId(2)?.stato).toBe("attivo");
    expect(giorniAllaScadenza(om, giorni(38))).toBe(82);
    expect(await valutaAbbonamento(2, giorni(113.5))).toEqual({ transizione: null, avviso: 7 });
    expect(await valutaAbbonamento(2, giorni(120.5))).toEqual({ transizione: "past_due", avviso: null });
    const pr = await prorogaProva(2, 15, "fiera", attore, giorni(121));
    expect(pr).toMatchObject({ stato: "trialing", insolutoDal: null });
    expect(pr.finePeriodo?.toISOString()).toBe(giorni(136).toISOString());
    const dis = await impostaDisdetta(2, true, attore);
    expect(dis.disdettaAFinePeriodo).toBe(true);
    expect(await valutaAbbonamento(2, giorni(136.5))).toEqual({ transizione: "cancelled", avviso: null });
    expect(repo.perId(2)?.stato).toBe("sospeso");
  });

  it("budget ed extra: l'extra vale solo nel mese; mese nuovo azzera soglie ed extra", async () => {
    const repo = getTenantRepository();
    await creaProva(2, T0, attore);
    await impostaBudgetTars(2, eurInNano(40), attore);
    await aggiungiExtraTars(2, eurInNano(10), attore, T0);
    let a = repo.abbonamentoDi(2)!;
    expect(a.budgetTarsNanoMese).toBe(eurInNano(40));
    expect(a.extraTarsNano).toBe(eurInNano(10));
    expect(a.extraTarsMese).toBe("2026-09");
    await repo.salvaAbbonamento({ ...a, tarsSogliaAvvisata: 80, tarsSogliaMese: "2026-09" });
    await valutaAbbonamento(2, new Date("2026-10-01T06:00:00Z"));
    a = repo.abbonamentoDi(2)!;
    expect(a.extraTarsNano).toBe(0);
    expect(a.tarsSogliaAvvisata).toBe(0);
    expect(a.tarsSogliaMese).toBe("2026-10");
  });

  it("il tenant 1 non si tocca: omaggio, proroga, disdetta rifiutati; budget e tolleranze ammessi", async () => {
    await assicuraAbbonamentoPredefinito(T0);
    await expect(concediOmaggio(1, { motivo: "x", scadenza: null }, attore, T0)).rejects.toThrow("proprietaria della piattaforma");
    await expect(prorogaProva(1, 10, "x", attore, T0)).rejects.toThrow("proprietaria della piattaforma");
    await expect(impostaDisdetta(1, true, attore)).rejects.toThrow("proprietaria della piattaforma");
    expect((await impostaBudgetTars(1, eurInNano(100), attore)).budgetTarsNanoMese).toBe(eurInNano(100));
    expect(await valutaAbbonamento(1, giorni(400))).toEqual({ transizione: null, avviso: null });
  });
});
```

- [ ] **Step 2: Vederli fallire** — `pnpm vitest run server/abbonamenti/servizio.test.ts`. Expected: FAIL (modulo assente).

- [ ] **Step 3: Implementare** — `costanti.ts` come nelle Interfaces (`meseLocale` riusa `periodiLocali` di `server/tars/costi/ledger.ts`; `giorniInteriFino` con `Math.ceil`). `servizio.ts`:

```ts
// server/abbonamenti/servizio.ts
// Unico punto che cambia stato a un abbonamento (spec WS4 §4). Ogni
// transizione lascia un evento; la sola lettura resta quella del WS1
// (`sospendi`/`riattiva` del tenant): qui si decide QUANDO, non COME.
import { TENANT_PREDEFINITO_ID } from "../tenants/costanti";
import { getTenantRepository } from "../tenants/repository";
import { riattiva, sospendi } from "../tenants/servizio";
import { attoreTesto, type Attore } from "../tenants/tipi";
import type { Abbonamento, StatoAbbonamento } from "./tipi";
import { GIORNI_AVVISO, GIORNI_PROVA, GIORNI_TOLLERANZA_INSOLUTO, MESSAGGI_ABBONAMENTO, TOLLERANZA_PREDEFINITA_GIORNI, budgetTarsPredefinitoEur, eurInNano, giorniInteriFino, meseLocale } from "./costanti";

function esistente(tenantId: number): Abbonamento {
  const a = getTenantRepository().abbonamentoDi(tenantId);
  if (!a) throw new Error(`Abbonamento del tenant ${tenantId} inesistente`);
  return a;
}
function nonIlTenant1(tenantId: number): void {
  if (tenantId === TENANT_PREDEFINITO_ID) throw new Error(MESSAGGI_ABBONAMENTO.tenant1Intoccabile);
}
async function evento(tenantId: number, tipo: Parameters<ReturnType<typeof getTenantRepository>["registraEvento"]>[0]["tipo"], attore: Attore | "boot", dettagli: Record<string, unknown>, motivo: string | null = null) {
  await getTenantRepository().registraEvento({ tenantId, tipo, attore: attore === "boot" ? "boot" : attoreTesto(attore), motivo, dettagli });
}

async function cambiaStato(a: Abbonamento, stato: StatoAbbonamento, motivo: string, attore: Attore | "boot", adesso: Date, extra: Partial<Abbonamento> = {}): Promise<Abbonamento> {
  const repo = getTenantRepository();
  const da = a.stato;
  const salvato = await repo.salvaAbbonamento({ ...a, ...extra, stato });
  await evento(a.tenantId, "abbonamento_stato", attore, { da, a: stato }, motivo);
  const tenant = repo.perId(a.tenantId);
  const att = attore === "boot" ? { tipo: "boot" as const } : attore;
  if (stato === "suspended" || stato === "cancelled") {
    if (tenant?.stato === "attivo") await sospendi(a.tenantId, `insoluto: ${motivo}`, att);
  } else if (tenant?.stato === "sospeso" && (tenant.motivoStato ?? "").startsWith("insoluto")) {
    await riattiva(a.tenantId, motivo, att);
  }
  return salvato;
}

export async function creaProva(tenantId, adesso, attore) { … se esiste ritorna; altrimenti salva { tipo: "paid", periodicita: null, stato: "trialing", inizioPeriodo: adesso, finePeriodo: adesso + GIORNI_PROVA giorni, budgetTarsNanoMese: eurInNano(budgetTarsPredefinitoEur()), tolleranze 7/7, provider "nessuno", … } + evento abbonamento_creato { stato, finePeriodo } }
export async function assicuraAbbonamentoPredefinito(adesso) { … tenant 1: se manca salva complimentary/active/finePeriodo null/budget null/omaggio { motivo: "Ruffino Group, proprietaria della piattaforma", attore: "boot", dataIso, scadenzaIso: null } + evento abbonamento_creato }
export async function concediOmaggio(tenantId, input, attore, adesso) { nonIlTenant1; a = esistente; return cambiaStato(a, "active", `omaggio: ${input.motivo}`, attore, adesso, { tipo: "complimentary", periodicita: null, finePeriodo: input.scadenza, prossimoRinnovo: null, insolutoDal: null, disdettaAFinePeriodo: false, omaggio: { motivo, attore: attoreTesto(attore), dataIso: adesso.toISOString(), scadenzaIso: input.scadenza?.toISOString() ?? null } }) + evento abbonamento_omaggio }
export async function prorogaProva(tenantId, giorni, motivo, attore, adesso) { nonIlTenant1; a = esistente; if (!(a.stato === "trialing" || (a.stato === "past_due" && a.tipo === "paid" && a.periodicita == null))) throw new Error("Si proroga solo una prova"); base = max(a.finePeriodo ?? adesso, adesso); return cambiaStato(a, "trialing", `proroga: ${motivo}`, attore, adesso, { finePeriodo: base + giorni, insolutoDal: null }) + evento abbonamento_prova_prorogata { giorni, finePeriodo } }
export async function impostaBudgetTars / aggiungiExtraTars / impostaTolleranze / impostaDisdetta { salva + evento abbonamento_modificato { campo, prima, dopo }; disdetta e tolleranze e budget ammessi al tenant 1 tranne la disdetta }
export function giorniAllaScadenza(a, adesso) { return a.finePeriodo ? giorniInteriFino(a.finePeriodo, adesso) : null; }

export async function valutaAbbonamento(tenantId, adesso) {
  const repo = getTenantRepository();
  let a = repo.abbonamentoDi(tenantId);
  if (!a || tenantId === TENANT_PREDEFINITO_ID) return { transizione: null, avviso: null };
  // mese nuovo: soglie Tars ed extra ripartono
  const mese = meseLocale(adesso);
  if (a.tarsSogliaMese !== mese) {
    a = await repo.salvaAbbonamento({ ...a, tarsSogliaAvvisata: 0, tarsSogliaMese: mese, tarsSoglia100Dal: null, extraTarsNano: a.extraTarsMese === mese ? a.extraTarsNano : 0, extraTarsMese: a.extraTarsMese === mese ? a.extraTarsMese : null });
  }
  if (a.stato === "past_due" && a.insolutoDal && adesso.getTime() - a.insolutoDal.getTime() > GIORNI_TOLLERANZA_INSOLUTO * 86_400_000) {
    await cambiaStato(a, "suspended", "tolleranza dell'insoluto scaduta", "boot", adesso);
    return { transizione: "suspended", avviso: null };
  }
  if ((a.stato === "trialing" || a.stato === "active") && a.finePeriodo && adesso.getTime() > a.finePeriodo.getTime()) {
    if (a.disdettaAFinePeriodo) { await cambiaStato(a, "cancelled", "disdetta a fine periodo", "boot", adesso); return { transizione: "cancelled", avviso: null }; }
    await cambiaStato(a, "past_due", a.stato === "trialing" ? "prova scaduta senza pagamento" : "periodo scaduto senza rinnovo", "boot", adesso, { insolutoDal: adesso });
    return { transizione: "past_due", avviso: null };
  }
  if ((a.stato === "trialing" || a.stato === "active") && a.finePeriodo) {
    const giorni = giorniInteriFino(a.finePeriodo, adesso);
    const soglia = GIORNI_AVVISO.find(g => giorni === g);   // esattamente 7, 3 o 1 giorni interi (ceil)
    if (soglia != null) {
      const gia = (await repo.eventi(tenantId, { ultimi: 50 })).some(e => e.tipo === "abbonamento_avviso" && e.dettagli?.giorniAllaScadenza === soglia && e.dettagli?.fineIso === a.finePeriodo!.toISOString());
      if (!gia) { await evento(tenantId, "abbonamento_avviso", "boot", { giorniAllaScadenza: soglia, fineIso: a.finePeriodo.toISOString() }); return { transizione: null, avviso: soglia }; }
    }
  }
  return { transizione: null, avviso: null };
}
```

(Scrivere per esteso le funzioni abbozzate qui con `…`; l'`avviso` a 7 giorni scatta quando `giorniInteriFino` vale esattamente 7: con il worker ogni 6 ore l'avviso arriva nel giorno giusto, e la deduplicazione sugli eventi evita i doppi.)

- [ ] **Step 4: Eseguire** — `pnpm vitest run server/abbonamenti server/tenants`; `pnpm check`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/abbonamenti/tipi.ts server/abbonamenti/costanti.ts server/abbonamenti/servizio.ts server/abbonamenti/servizio.test.ts
git commit -m "feat(abbonamenti): prova di 30 giorni, omaggio, insoluto e sola lettura, proroga, budget ed extra, tenant 1 intoccabile"
```

---

### Task 3: Aggancio al tenant — prova alla creazione, seed del tenant 1, worker, comando `imposta_abbonamento`, CLI

**Files:**
- Create: `server/abbonamenti/worker.ts`
- Modify: `server/tenants/servizio.ts` (`crea` :63-160, `eseguiComando`), `server/tenants/boot.ts` (`completaTenants`), `server/_core/index.ts` (listen), `server/tenants/comandi.ts`, `scripts/tenant.ts` (`USO`, `elenco`, sottocomando `abbonamento`)
- Test: `server/tenants/servizio.test.ts`, `server/tenants/boot.test.ts`, `server/abbonamenti/worker.test.ts`, `server/tenants/cli.test.ts` (parti pure)

**Interfaces:**
- Produces:
  ```ts
  // comandi.ts
  export const schemaPayloadAbbonamento = z.discriminatedUnion("azione", [
    z.object({ azione: z.literal("omaggio"), slug, motivo: testo(500), scadenza: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() }),
    z.object({ azione: z.literal("proroga"), slug, motivo: testo(500), giorni: z.number().int().min(1).max(365) }),
    z.object({ azione: z.literal("quota"), slug, quotaGb: z.number().int().min(1).max(100_000) }),
    z.object({ azione: z.literal("budget_tars"), slug, eur: z.number().min(0).max(100_000).nullable() }),   // null = nessun tetto
    z.object({ azione: z.literal("extra_tars"), slug, eur: z.number().positive().max(100_000) }),
    z.object({ azione: z.literal("tolleranze"), slug, storage: z.number().int().min(0).max(365).optional(), tars: z.number().int().min(0).max(365).optional() }),
    z.object({ azione: z.literal("disdetta"), slug, disdetta: z.boolean() }),
  ]);
  // worker.ts
  export async function giroAbbonamenti(adesso?: Date): Promise<void>;   // perOgniTenantAttivo("abbonamenti", t => valutaAbbonamento(t, adesso))
  export function avviaWorkerAbbonamenti(): void;                         // subito + ogni 6 ore (setInterval.unref), solo con interruttore acceso
  export function fermaWorkerAbbonamenti(): void;
  ```

- [ ] **Step 1: Test che falliscono**
  - `servizio.test.ts` (tenants): dopo `crea(...)` con interruttore acceso l'abbonamento del nuovo tenant è `trialing` con `finePeriodo` a +30 giorni (`vi.useFakeTimers`); un comando `imposta_abbonamento` `{ azione: "omaggio", slug: "acme", motivo: "pilota", scadenza: null }` eseguito da `eseguiComandiInAttesa()` porta `complimentary/active` e l'esito `{ tenantId, stato: "active", tipo: "complimentary" }`; `{ azione: "budget_tars", eur: 40 }` → `budgetTarsNanoMese = eurInNano(40)`; `{ azione: "quota", quotaGb: 200 }` → `storageQuotaBytes = 200 * 1024 ** 3`.
  - `boot.test.ts`: `completaTenants()` con interruttore acceso semina l'abbonamento omaggio del tenant 1 (`abbonamentoDi(1)` non null, `tipo complimentary`); a interruttore spento lo semina lo stesso (è una riga di control plane inerte, come la riga del tenant 1).
  - `worker.test.ts`: due tenant attivi, uno in prova scaduta → dopo `giroAbbonamenti(adesso)` il primo è `past_due` e l'altro intatto; un tenant sospeso non viene valutato (`tenantsAttivi()` lo esclude); a interruttore spento `avviaWorkerAbbonamenti()` non crea il timer (esportare `__timerAttivoPerTest()` o verificare via `fermaWorkerAbbonamenti` senza errori).
  - `cli.test.ts`: `anteprima()` di un comando `imposta_abbonamento` non ha segreti da mascherare (smoke).

- [ ] **Step 2: Vederli fallire** — `pnpm vitest run server/tenants/servizio.test.ts server/tenants/boot.test.ts server/abbonamenti`. Expected: FAIL.

- [ ] **Step 3: Implementare**
  - `crea` (tenants/servizio.ts): subito dopo l'evento `creato` (dentro `if (!tenant)`), `await creaProva(tenant.id, new Date(), attore)` — import con `await import("../abbonamenti/servizio")` per evitare il ciclo servizio→abbonamenti→servizio.
  - `completaTenants` (boot.ts): prima del ramo `if (!interruttoreAttivo(...))`, `await assicuraAbbonamentoPredefinito(new Date())` in try/catch con log (control plane, sempre); nel ramo acceso, dopo `riferisci(await eseguiComandiInAttesa())`, `avviaWorkerAbbonamenti()`.
  - `worker.ts`: `giroAbbonamenti` con `perOgniTenantAttivo("abbonamenti", async t => { await valutaAbbonamento(t, adesso ?? new Date()); })` — le transizioni e gli avvisi producono anche le notifiche del Task 7 (qui solo eventi); `avviaWorkerAbbonamenti`: `if (!interruttoreAttivo("multiAzienda")) return;` poi `void giroAbbonamenti()` e `setInterval(() => void giroAbbonamenti(), 6 * 3_600_000).unref()`; `index.ts`: nel callback di `listen`, dopo il ricalcolo dello storage, `avviaWorkerAbbonamenti()` (import dinamico come gli altri).
  - `eseguiComando`: `case "imposta_abbonamento"` → `const p = schemaPayloadAbbonamento.parse(...)`, `id = comando.tenantId ?? tenantDaSlug(p.slug).id`, `switch (p.azione)`: `omaggio` → `concediOmaggio(id, { motivo, scadenza: p.scadenza ? new Date(p.scadenza + "T23:59:59+02:00") : null }, attore, new Date())`; `proroga` → `prorogaProva`; `quota` → `repo.impostaQuotaStorage(id, p.quotaGb * 1024 ** 3)` + evento `abbonamento_modificato { campo: "quota", prima, dopo }`; `budget_tars` → `impostaBudgetTars(id, p.eur == null ? null : eurInNano(p.eur), attore)`; `extra_tars` → `aggiungiExtraTars(id, eurInNano(p.eur), attore, new Date())`; `tolleranze` → `impostaTolleranze`; `disdetta` → `impostaDisdetta`; esito `{ tenantId, tipo, stato, finePeriodo }` dell'abbonamento aggiornato (`await import("../abbonamenti/servizio")`).
  - `scripts/tenant.ts`: sottocomando `abbonamento` che traduce i flag in UNA azione (`--omaggio [--scadenza=AAAA-MM-GG]`, `--proroga=<giorni>`, `--quota-gb=<n>`, `--budget-tars-eur=<n|nessuno>`, `--extra-tars-eur=<n>`, `--tolleranza-storage=<gg>`/`--tolleranza-tars=<gg>` (insieme = un'azione `tolleranze`), `--disdetta`/`--annulla-disdetta`); più azioni insieme → errore «Un'azione per comando»; `--motivo` obbligatorio per omaggio e proroga; `tipo = "imposta_abbonamento"`, `tenantId = t.id`; `USO` aggiornato; `elenco` stampa per ogni tenant `  abbonamento: <tipo> <stato>, fine <ISO|nessuna>, insoluto dal <ISO|->` leggendo `repo.abbonamentoDi(t.id)` (cache già caricata da `caricaCache`).

- [ ] **Step 4: Eseguire** — `pnpm vitest run server/tenants server/abbonamenti`; `pnpm check`; smoke `DATABASE_URL=… pnpm --silent tenant elenco` (stampa la riga abbonamento o la sonda dello schema). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/abbonamenti/worker.ts server/abbonamenti/worker.test.ts server/tenants/servizio.ts server/tenants/servizio.test.ts server/tenants/boot.ts server/tenants/boot.test.ts server/_core/index.ts server/tenants/comandi.ts scripts/tenant.ts server/tenants/cli.test.ts
git commit -m "feat(abbonamenti): prova alla creazione del tenant, omaggio del tenant 1 al boot, worker ogni 6 ore, comando imposta_abbonamento e pnpm tenant abbonamento"
```

---

### Task 4: Adattatore del provider di pagamento («nessuno») ed eventi del provider

**Files:**
- Create: `server/abbonamenti/provider.ts`
- Modify: `server/abbonamenti/servizio.ts` (`applicaEventoProvider`)
- Test: `server/abbonamenti/provider.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type EventoProvider = { id: string; tipo: "pagamento_riuscito" | "pagamento_fallito" | "disdetta"; tenantId: number; periodo: { inizio: Date; fine: Date } | null; periodicita?: "monthly" | "yearly" };
  export type ProviderPagamenti = {
    nome: string;
    avviaCheckout(input: { tenantId: number; periodicita: "monthly" | "yearly"; ritornoUrl: string }): Promise<string | null>;
    urlPortale(tenantId: number): Promise<string | null>;
    verificaEvento(intestazioni: Record<string, string>, corpo: Buffer): Promise<EventoProvider | null>;
  };
  export function providerCorrente(): ProviderPagamenti;      // "nessuno": ogni metodo → null
  export function __impostaProviderPerTest(p: ProviderPagamenti | null): void;
  // servizio.ts
  export async function applicaEventoProvider(evento: EventoProvider, adesso: Date): Promise<"applicato" | "duplicato">;
  ```

- [ ] **Step 1: Test che falliscono** — `provider.test.ts`: `providerCorrente().nome === "nessuno"` e i tre metodi rispondono `null`; `applicaEventoProvider({ id: "ev1", tipo: "pagamento_riuscito", tenantId: 2, periodo: {inizio, fine}, periodicita: "monthly" })` su un tenant `past_due` → `active`, `tipo paid`, `periodicita monthly`, `finePeriodo = fine`, `prossimoRinnovo = fine`, tenant riattivato; la stessa chiamata di nuovo → `"duplicato"` senza eventi nuovi; `pagamento_fallito` su `active` → `past_due` con `insolutoDal`; `disdetta` → `disdettaAFinePeriodo = true`; un evento per il tenant 1 → errore «proprietaria».

- [ ] **Step 2: Vederli fallire** — `pnpm vitest run server/abbonamenti/provider.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implementare** — `provider.ts` con `providerNessuno` e la variabile di override per i test; `applicaEventoProvider`: deduplica con un evento `abbonamento_modificato` `{ campo: "provider_evento", evento: id }` già presente negli ultimi 500 eventi del tenant (`repo.eventi(tenantId, { ultimi: 500 })`) → `"duplicato"`; altrimenti applica (`cambiaStato` o `salvaAbbonamento` con `providerRef: { ultimoEvento: id }`), registra l'evento e ritorna `"applicato"`. Nessuna rotta HTTP.

- [ ] **Step 4: Eseguire** — `pnpm vitest run server/abbonamenti`; `pnpm check`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/abbonamenti/provider.ts server/abbonamenti/provider.test.ts server/abbonamenti/servizio.ts
git commit -m "feat(abbonamenti): adattatore del provider di pagamento con implementazione «nessuno» ed eventi del provider idempotenti"
```

---

### Task 5: Quota storage che blocca — gancio in `putFile`, tolleranza, eventi

**Files:**
- Create: `server/abbonamenti/quota.ts`
- Modify: `server/_core/fileStorage.ts` (`impostaVerificaQuota`, `ErroreQuotaStorage`, `putFile`), `server/tenants/storage.ts` (`applicaSoglie` con `soglia100Dal`), `server/tenants/boot.ts` (registrazione del gancio in `preparaTenants` accanto al contabile)
- Test: `server/_core/fileStorage.tenant.test.ts`, `server/tenants/storage.test.ts`, `server/abbonamenti/quota.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // fileStorage.ts
  export type VerificaQuota = (tenantId: number, bytes: number) => Promise<{ messaggio: string } | null>;
  export function impostaVerificaQuota(v: VerificaQuota | null): void;
  export class ErroreQuotaStorage extends TRPCError { constructor(messaggio: string) /* code PRECONDITION_FAILED */ }
  // quota.ts
  export async function verificaCaricamento(tenantId: number, bytes: number, adesso?: Date): Promise<{ messaggio: string } | null>;
  export function bloccoStorage(stato: StatoStorage, abbonamento: Abbonamento | null, adesso: Date): { bloccato: boolean; bloccoDal: Date | null }; // puro
  export function registraGanciQuota(): void;   // impostaVerificaQuota(verificaCaricamento)
  ```

- [ ] **Step 1: Test che falliscono**
  - `fileStorage.tenant.test.ts`: con `impostaVerificaQuota(async () => ({ messaggio: "Spazio esaurito" }))`, `putFile` in `conTenant(2, …)` rifiuta con `ErroreQuotaStorage` (`code === "PRECONDITION_FAILED"`, messaggio) e il driver NON ha ricevuto il file; senza gancio scrive; un gancio che lancia → l'upload fallisce con quell'errore (fail-closed, mai un upload «di comodo»).
  - `storage.test.ts`: `applicaSoglie` al primo 100 % imposta `soglia100Dal` (via `impostaSoglia100Storage`), non la sposta ai giri successivi, la azzera scendendo sotto il 100 %.
  - `quota.test.ts` (puro + memoria): `bloccoStorage`: sotto quota → non bloccato; a quota con `soglia100Dal` più recente della tolleranza → non bloccato ma `bloccoDal = soglia100Dal + tolleranza`; oltre → bloccato; abbonamento assente → tolleranza predefinita 7; `verificaCaricamento(2, 10)` con `process.env.FLAG_MULTI_AZIENDA = "off"` → `null` sempre; con flag acceso e blocco → `{ messaggio: MESSAGGI_ABBONAMENTO.spazioEsaurito(gb) }` e un evento `storage_bloccato` (una volta al giorno: dedup sugli ultimi eventi); tornando sotto quota → `storage_sbloccato`.

- [ ] **Step 2: Vederli fallire** — `pnpm vitest run server/_core/fileStorage.tenant.test.ts server/tenants/storage.test.ts server/abbonamenti/quota.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implementare**
  - `fileStorage.ts`: dopo il contabile, `let verificaQuota: VerificaQuota | null = null; export function impostaVerificaQuota(...)`; `class ErroreQuotaStorage extends TRPCError` (`import { TRPCError } from "@trpc/server"`); in `putFile`, dopo `tenantPerStorage` e prima di `driver.put`: `if (verificaQuota) { const rifiuto = await verificaQuota(tenantId, buffer.length); if (rifiuto) throw new ErroreQuotaStorage(rifiuto.messaggio); }` — commento: la quota conta e avvisa dal WS3, blocca solo qui e solo col gancio registrato al boot (spec WS4 §6).
  - `storage.ts` `applicaSoglie`: dopo il calcolo di `raggiunta`: `if (raggiunta === 100 && !stato.soglia100Dal) await repo.impostaSoglia100Storage(tenantId, new Date()); if (raggiunta < 100 && stato.soglia100Dal) { await repo.impostaSoglia100Storage(tenantId, null); }` (l'evento `storage_sbloccato` lo registra `quota.ts` quando rileva il cambio, non qui).
  - `quota.ts`: `bloccoStorage` puro; `verificaCaricamento`: `if (!interruttoreAttivo("multiAzienda")) return null;` → `stato = await repo.storageDi(tenantId)`; `a = repo.abbonamentoDi(tenantId)`; `{ bloccato, bloccoDal } = bloccoStorage(...)`; se bloccato → evento `storage_bloccato` se l'ultimo evento di quel tipo del giorno manca (`repo.eventi(tenantId, { ultimi: 50 })`), ritorna il messaggio con `gb = Math.round(quotaBytes / 1024 ** 3)`; altrimenti `null`. `registraGanciQuota()` chiamato in `preparaTenants()` subito dopo `impostaContabileStorage(...)`.

- [ ] **Step 4: Eseguire** — `pnpm vitest run server/_core/fileStorage.tenant.test.ts server/tenants server/abbonamenti server/routers/preventiviContratti.test.ts server/routers/ticketAllegati.test.ts`; `pnpm check`. Verificare leggendo (nessuna modifica): `server/comunicazioni/imap.ts` e `server/documenti/anteprime.ts` hanno il `try/catch` intorno a `putFile`; `server/comunicazioni/whatsapp.ts` `conservaMediaWhatsApp` cattura l'errore (se no, aggiungere il catch con log: un media non conservato non è un errore del webhook). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/_core/fileStorage.ts server/_core/fileStorage.tenant.test.ts server/tenants/storage.ts server/tenants/storage.test.ts server/tenants/boot.ts server/abbonamenti/quota.ts server/abbonamenti/quota.test.ts server/comunicazioni/whatsapp.ts
git commit -m "feat(storage): la quota blocca i caricamenti nuovi dopo la tolleranza — gancio in putFile, soglia_100_dal, eventi di blocco e sblocco"
```

---

### Task 6: Budget Tars per azienda — ledger, governor, politica iniettata, soglie

**Files:**
- Modify: `server/tars/costi/ledger.ts` (tipi, Postgres `prenota`, memoria), `server/tars/costi/governor.ts` (`ContestoCosto`, messaggi, `ErroreBudget`, `impostaPoliticaTarsAzienda`, `avvolgiConGovernor`), `server/tars/costi/providerGovernato.ts` (`creaProviderPerRun` risolve il tenant), `server/abbonamenti/quota.ts` (politica), `server/tenants/boot.ts` (registrazione)
- Test: `server/tars/costi/ledger.pg.test.ts` (esiste? altrimenti crearlo con il pattern pg), `server/tars/costi/governor.test.ts` (esistente: estendere), `server/abbonamenti/quota.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // ledger.ts
  export type ConsumoCorrente = { …oggi…; aziendaMeseNano?: number };
  export type EsitoPrenotazione = … | { esito: "rifiutata"; limite: "run" | "giorno" | "mese" | "classe" | "azienda"; consumo; richiestoNano };
  prenota(input: { …oggi…; tenantId: number; limiteAziendaMeseNano?: number | null })   // null/assente = nessun tetto d'azienda
  // governor.ts
  export type ContestoCosto = { sedeId: number; utenteId: number; tenantId: number };
  export const MESSAGGIO_BUDGET_AZIENDA: string;   // = MESSAGGI_ABBONAMENTO.budgetTars (copiato: il governor non importa server/abbonamenti)
  export type PoliticaTarsAzienda = {
    limite(tenantId: number, adesso: Date): Promise<{ limiteNano: number | null; bloccante: boolean }>;
    dopoPrenotazione(tenantId: number, aziendaMeseNano: number, adesso: Date): Promise<void>;
  };
  export function impostaPoliticaTarsAzienda(p: PoliticaTarsAzienda | null): void;
  // quota.ts
  export function politicaTarsAzienda(): PoliticaTarsAzienda;
  export function sogliaTars(consumoNano: number, budgetNano: number | null): 0 | 50 | 80 | 100;
  ```

- [ ] **Step 1: Test che falliscono**
  - Ledger in memoria (`creaLedgerMemoriaPerTest`): due tenant, righe del mese per il tenant 2 → `consumo.aziendaMeseNano` conta solo il tenant 2; `limiteAziendaMeseNano` superato → `rifiutata` con `limite: "azienda"`; `null` → nessun rifiuto d'azienda.
  - Ledger Postgres (`ledger.pg.test.ts`, lock dedicato, tabella `tars_costi` pulita delle proprie righe in `afterAll`): stesse asserzioni su Postgres vero, e l'INSERT scrive `tenant_id`.
  - Governor (`governor.test.ts`): con politica `{ limite: async () => ({ limiteNano: 100, bloccante: true }) }` e consumo 90 + stima 20 → `ErroreBudget` con `limite === "azienda"` e messaggio `MESSAGGIO_BUDGET_AZIENDA`; con `bloccante: false` la chiamata passa e `dopoPrenotazione` riceve `aziendaMeseNano`; senza politica → comportamento di oggi.
  - `quota.test.ts`: `sogliaTars`; `politicaTarsAzienda().limite(2, adesso)` → `{ limiteNano: budget + extra, bloccante }` (bloccante solo con `tarsSoglia100Dal + tolleranzaTars < adesso`; flag spento → `limiteNano: null`; tenant 1 → `null`); `dopoPrenotazione(2, nano, adesso)` registra `tars_soglia` 50/80/100 una volta per mese, imposta `tarsSoglia100Dal` al 100 %, e `tars_bloccato` al primo rifiuto (chiamata da `limite` quando bloccante — o dal governor: scegliere `dopoPrenotazione` con un flag `rifiutata: boolean`).

- [ ] **Step 2: Vederli fallire**. Expected: FAIL.

- [ ] **Step 3: Implementare**
  - `ledger.ts`: `prenota` Postgres aggiunge alla SELECT `COALESCE(SUM(…) FILTER (WHERE mese_locale = ${mese} AND COALESCE(tenant_id, 1) = ${input.tenantId}), 0) AS azienda`; `consumo.aziendaMeseNano`; dopo il controllo di classe: `if (input.limiteAziendaMeseNano != null && consumo.aziendaMeseNano + input.costoPrenotatoNano > input.limiteAziendaMeseNano) return { esito: "rifiutata", limite: "azienda", … }`; l'INSERT scrive `tenant_id` (`${input.tenantId}`); la memoria fa lo stesso con `r.tenantId` (aggiungere `tenantId` a `RigaCosto` e `rigaDa`; il trigger del WS2 resta la rete per chi non lo passa).
  - `governor.ts`: `ContestoCosto.tenantId`; `MESSAGGIO_BUDGET_AZIENDA`; `messaggioPerLimite("azienda")`; `ErroreBudget.limite` unione con `"azienda"` (il costruttore usa il messaggio d'azienda per quel limite); `impostaPoliticaTarsAzienda`; in `avvolgiConGovernor.rispondi`, prima di `ledger.prenota`: `const politica = politicaAzienda ? await politicaAzienda.limite(contesto.tenantId, adesso) : null;` e `limiteAziendaMeseNano: politica?.bloccante ? politica.limiteNano : null`, `tenantId: contesto.tenantId`; dopo la prenotazione (riuscita o rifiutata per azienda) `void politica?.dopoPrenotazione(contesto.tenantId, prenotazione.consumo.aziendaMeseNano + (riuscita ? stima : 0), adesso, { rifiutata })` con catch e log (mai bloccare la chiamata per un avviso).
  - `providerGovernato.ts` `creaProviderPerRun`: `tenantId: tenantCorrente() ?? tenantIdDellaSede(input.sedeId)` (import da `../../tenants/contestoCorrente` e `../../tenants/contesto`); `runEval.ts` passa `tenantId: 1`.
  - `quota.ts`: `politicaTarsAzienda()` con `limite` (abbonamento in cache; `null` se flag spento, tenant 1 o `budgetTarsNanoMese == null`; `limiteNano = budget + (extraTarsMese === mese ? extraTarsNano : 0)`; `bloccante = tarsSoglia100Dal != null && adesso - tarsSoglia100Dal > tolleranzaTars giorni`) e `dopoPrenotazione` (soglie → eventi `tars_soglia { percentuale, mese }`, `tarsSogliaAvvisata`, `tarsSoglia100Dal` al 100 %; `tars_bloccato` al primo rifiuto del giorno; `tars_sbloccato` quando un mese nuovo o un budget alzato tolgono il blocco) salvando via `salvaAbbonamento`. `registraGanciQuota()` registra anche `impostaPoliticaTarsAzienda(politicaTarsAzienda())`.

- [ ] **Step 4: Eseguire** — `pnpm vitest run server/tars/costi server/abbonamenti server/tars/orchestratore.test.ts`; pg `ledger.pg.test.ts` in sequenza; `pnpm check`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/tars/costi/ledger.ts server/tars/costi/governor.ts server/tars/costi/providerGovernato.ts server/tars/costi/*.test.ts server/tars/eval/runEval.ts server/abbonamenti/quota.ts server/abbonamenti/quota.test.ts server/tenants/boot.ts
git commit -m "feat(tars): budget mensile per azienda — somma per tenant nel ledger, limite d'azienda nel governor, soglie ed eventi, blocco dopo la tolleranza"
```

---

### Task 7: Notifiche a proprietario e direzione, query `tenants.abbonamento` e `tenants.consumi`

**Files:**
- Create: `server/abbonamenti/notifiche.ts`
- Modify: `server/abbonamenti/servizio.ts` (chiama le notifiche nelle transizioni e negli avvisi), `server/abbonamenti/quota.ts` (notifiche alle soglie e ai blocchi), `server/tenants/router.ts`
- Test: `server/abbonamenti/notifiche.test.ts`, `server/tenants/router.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // notifiche.ts
  export type TipoNotificaAzienda = "abbonamento.avviso" | "abbonamento.insoluto" | "abbonamento.sospeso" | "consumi.storage" | "consumi.tars";
  export async function notificaAzienda(input: { tenantId: number; tipo: TipoNotificaAzienda; titolo: string; corpo: string; chiave: string; priorita: "high" | "normal"; adesso: Date }): Promise<number>; // quante notifiche create
  export function destinatariAzienda(tenantId: number): Array<{ id: number; sedeId: number }>;   // proprietari e direzione attivi, con la prima sede attiva del tenant fra le loro
  // router.ts
  abbonamento: protectedProcedure.query(...)  // spec §8
  consumi: protectedProcedure.query(...)      // spec §8; budgetEur/extraEur null per chi non è proprietario/direzione
  ```

- [ ] **Step 1: Test che falliscono** — `notifiche.test.ts`: con `setNotificationRepositoryForTesting(createMemoryNotificationRepository())`, utenti del tenant 2 (un proprietario, una direzione, un commerciale) su sede 20 e `platform_feature_flags` della sede 20 con `notificationMode: "active"` → `notificaAzienda(...)` crea 2 notifiche (mai al commerciale), `canonicalKey = chiave + destinatario`, una seconda chiamata con la stessa chiave non duplica; con `notificationMode` non attivo → 0 e nessun errore. `router.test.ts`: `abbonamento()` per il tenant 2 in prova → `{ tipo: "paid", stato: "trialing", giorniAllaScadenza: 30, solaLettura: false, … }`; `consumi()` per direzione → `tars.budgetEur = 25`, per un utente `commerciale` → `budgetEur: null`; tenant 1 → `tars.percentuale: null`.

- [ ] **Step 2: Vederli fallire**. Expected: FAIL.

- [ ] **Step 3: Implementare** — `notifiche.ts`: `destinatariAzienda` da `getUtentiStore()` (`presidioDi(u).tenantId === tenantId && attivo && (ruoli ∋ proprietario|direzione)`), sede = prima sede attiva del tenant fra le `sediIds` dell'utente (altrimenti la prima attiva del tenant); per ogni destinatario, se `getFeatureFlags(sedeId).notificationMode === "active"`: `repository.upsert(draft)` con `type: input.tipo`, `link: "/integrazioni?scheda=abbonamento"`, `groupKey: "azienda:" + tipo`, `sourceEventId: null`, `entityRefs: [{ type: "tenant", id }]`; se `created` → `publishNotificationSignal` + `deliverStoredNotification`; mai lanciare (log). `servizio.ts`: `valutaAbbonamento` chiama `notificaAzienda` per avviso (titolo «La prova di Wyndoor finisce fra N giorni», corpo con la data), insoluto («Abbonamento scaduto: 7 giorni per regolarizzare», high), sospeso («Azienda in sola lettura», high). `quota.ts`: soglie storage/Tars 80 e 100 % e blocchi → `consumi.storage`/`consumi.tars` (`normal` all'80 %, `high` al 100 % e ai blocchi). Router: `abbonamento` e `consumi` come in spec §8 (`tenantDelContesto(ctx)`, `giorniAllaScadenza`, `bloccoStorage`, `sogliaTars`, `percentualeStorage`; `solaLettura = tenant.stato === "sospeso"`).

- [ ] **Step 4: Eseguire** — `pnpm vitest run server/abbonamenti server/tenants server/notifications`; `pnpm check`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/abbonamenti/notifiche.ts server/abbonamenti/notifiche.test.ts server/abbonamenti/servizio.ts server/abbonamenti/quota.ts server/tenants/router.ts server/tenants/router.test.ts
git commit -m "feat(abbonamenti): notifiche a proprietario e direzione e query tenants.abbonamento e tenants.consumi"
```

---

### Task 8: Client — avviso nella shell e scheda «Abbonamento e consumi»

**Files:**
- Create: `client/src/components/abbonamento/AvvisoAzienda.tsx`, `client/src/components/abbonamento/AbbonamentoCard.tsx`, `client/src/components/abbonamento/testi.ts` (frasi pure, testabili)
- Modify: `client/src/components/layout/ModularControlLayout.tsx` (sopra `PageContainer`), `client/src/components/layout/LegacyDashboardLayout.tsx` (sopra `PageContainer` nel `main`), `client/src/pages/Integrazioni.tsx` (nuova `SezioneHub` «Abbonamento e consumi» prima di «Canali», visibile a `canManage`)
- Test: `client/src/components/abbonamento/testi.test.ts` (vitest puro), verifica nel browser

**Interfaces:**
- Consumes: `trpc.tenants.abbonamento.useQuery()`, `trpc.tenants.consumi.useQuery()`, `trpc.tenants.mio`; `isDirezione`, `hasRuolo(user, "proprietario")`.
- Produces: `frasiAvviso(abbonamento, consumi, adesso): Array<{ chiave: string; testo: string; tono: "attenzione" | "errore" }>` in `testi.ts` (pura: prova ≤ 7 giorni, insoluto, sola lettura, storage ≥ 80 % / bloccato con data, Tars ≥ 80 % / bloccato).

- [ ] **Step 1: Test puro che fallisce** — `testi.test.ts`: per ogni caso una frase attesa in italiano (es. «La prova gratuita finisce fra 3 giorni», «Abbonamento scaduto: da 2 giorni in attesa di pagamento, poi sola lettura», «Azienda in sola lettura: nessuna modifica finché l'abbonamento non è regolarizzato», «Spazio al 92 %: oltre il 100 % i caricamenti si fermano dopo 7 giorni», «Caricamenti fermi dal 15/09/2026: libera spazio o chiedi capacità», «Tars all'85 % del budget del mese», «Tars fermo per questo mese»); nessuna frase sotto le soglie.

- [ ] **Step 2: Implementare** — `AvvisoAzienda`: legge le due query (`staleTime` 60 s, `retry: false`, nessuna se non autenticato), calcola `frasiAvviso`, mostra una riga per frase con `role="status"`, icona lucide `AlertTriangle`/`Ban`, link «Dettagli» a `/integrazioni?scheda=abbonamento`, pulsante «Chiudi» che salva le chiavi chiuse in `sessionStorage` (rientra se la chiave cambia); token semantici (`bg-warning-soft`/`bg-danger-soft`, `text-text-1`); niente scroll orizzontale, `min-w-0`. `AbbonamentoCard`: `DataSurface` con tipo (badge «Abbonamento omaggio» se `complimentary`), stato tradotto (in prova / attivo / in attesa di pagamento / sola lettura / disdetto), scadenza e giorni, due barre (`role="progressbar"`, `aria-valuenow`) per storage e Tars con percentuale e «blocco dal <data>» se in tolleranza; testo «Per estendere la prova o chiedere capacità scrivi a …» (nessun pulsante di pagamento con provider `nessuno`). `Integrazioni.tsx`: `?scheda=abbonamento` scrolla alla scheda (`id="abbonamento"`).

- [ ] **Step 3: Verifica** — `pnpm check`, `pnpm vitest run client/src/components/abbonamento`, `pnpm build`; browser con il login demo dell'anteprima (memoria «Verifica UI in anteprima demo»): seminare un tenant in prova a 3 giorni e uno storage al 92 % nell'harness, controllare 1440×900 e 390×844, console senza errori, nessuno scroll orizzontale; screenshot nel report.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/abbonamento client/src/components/layout/ModularControlLayout.tsx client/src/components/layout/LegacyDashboardLayout.tsx client/src/pages/Integrazioni.tsx
git commit -m "feat(client): avviso dell'azienda nella shell e scheda «Abbonamento e consumi» in Integrazioni"
```

---

### Task 9: Documentazione — runbook, PRD §60.12, handoff, CLAUDE.md, storage-r2, spec §2-bis

**Files:**
- Modify: `docs/runbooks/multi-azienda.md` (titolo con WS4; sezione «## WS4 — abbonamenti» prima di «## Verifica in sola lettura»: boot, worker, comandi `abbonamento` con esempi, percorso prova → insoluto → sola lettura e come riaprire (omaggio/proroga, non `stato --riattiva`), quota che blocca e tolleranza, budget Tars e `SAAS_BUDGET_TARS_EUR_MESE`/`SAAS_CAMBIO_EUR_USD`, notifiche solo dove il centro notifiche della sede è attivo, «Produzione, in ordine (WS4)», «Errori che l'operatore può vedere (WS4)» da spec §10), `documento_requisiti_infissi_ops.md` (`**Versione:**` 5.66 con la catena intatta; §60 titolo; nuova `### 60.12 Workstream 4 — abbonamenti (implementato su branch, 08/09/2026; non in produzione)` 15–30 righe), `handoff.md` («Aggiornato», blocco «Novità — WS4», voce 21), `CLAUDE.md` (invarianti: `abbonamenti` scritta solo dal repository; `putFile` può rifiutare per quota → `PRECONDITION_FAILED`; il budget Tars per azienda passa dal governor; nessun blocco a flag spento), `docs/storage-r2.md` (blocco dopo la tolleranza), spec `2026-09-08-ws4-abbonamenti-design.md` (§2-bis con i ruling del registro; §6 senza le rotte Express 413: nessuna rotta Express carica file; §8: notifiche solo con `notificationMode` attivo)
- Test: `shared/brand.test.ts`, `pnpm check`, `pnpm test`, `pnpm build`

- [ ] **Step 1–4:** scrivere, verificare ogni comando/messaggio nelle fonti, eseguire i test, commit:

```bash
git add docs/runbooks/multi-azienda.md documento_requisiti_infissi_ops.md handoff.md CLAUDE.md docs/storage-r2.md docs/superpowers/specs/2026-09-08-ws4-abbonamenti-design.md
git commit -m "docs(ws4): runbook, PRD §60.12, handoff, CLAUDE.md, storage-r2 e ruling della spec per gli abbonamenti"
```

---

## Self-review del piano (fatto alla stesura)

- **Copertura della spec:** §3 → T1; §4 → T2, T3; §5 → T4; §6 → T5; §7 → T6; §8 → T7, T8; §9 → T3; §10 errori → test dei task; §11 test → in ogni task; §12 rilascio, §13 file → T9 e i task; deviazioni già note (nessuna rotta Express 413; notifiche solo con `notificationMode` attivo) da scrivere in §2-bis.
- **Coerenza dei tipi:** `Abbonamento`, `StatoAbbonamento`, `Omaggio` (T1) usati in T2–T8; `VerificaQuota`/`ErroreQuotaStorage` (T5); `PoliticaTarsAzienda`/`ContestoCosto.tenantId`/`limite "azienda"` (T6); `notificaAzienda` (T7); `frasiAvviso` (T8).
- **Ordine:** T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9; T4 e T5 sono indipendenti fra loro ma restano in sequenza.
