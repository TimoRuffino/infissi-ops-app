# WS2 «Porta aperta» — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Esito (07/09/2026).** Piano **eseguito**: 15 task su 15, sul branch `feature/ws2-porta-aperta` (`964fb6b`…HEAD), non su `main` e non in produzione. Dove il codice vero ha contraddetto la lettera di questo piano, la decisione è registrata come «Ruling R1…R17»: le trovi riassunte nella spec, sezione **§2-bis «Decisioni in corso d'opera»**, e per esteso nel registro d'esecuzione `.superpowers/sdd/2026-09-07-ws2-porta-aperta/progress.md`. Quando questo piano e la spec divergono, **vale la spec**: è stata corretta a fine esecuzione. Runbook operativo: `docs/runbooks/multi-azienda.md`, sezione «WS2 — archivi per tenant». Riassunto per la direzione: PRD §60.10.

**Goal:** con `FLAG_MULTI_AZIENDA` acceso un tenant diverso da Ruffino Group usa il gestionale con i propri archivi, isolati per costruzione; con l'interruttore spento il codice si comporta come oggi.

**Architecture:** `persistence.ts` diventa un registro a famiglie (un'istanza per tenant e store, chiave `tenant:<id>:<nome>`, alias per il tenant 1) e restituisce array-Proxy che risolvono il tenant corrente da `AsyncLocalStorage`; una guardia pura serve tRPC ed Express; ogni punto d'ingresso fuori richiesta dichiara il tenant; le 33 tabelle SQL con `sede_id` ricevono `tenant_id` da un trigger alimentato dalla tabella specchio `tenant_sedi`; la migrazione di Ruffino Group è solo additiva e verificabile da CLI.

**Tech Stack:** Node 20 (`AsyncLocalStorage`, `Proxy`), TypeScript, postgres-js (`kvSql`), tRPC 11, Express, vitest; Postgres 16 in Docker per i test `*.pg.test.ts`.

**Spec:** `docs/superpowers/specs/2026-09-07-ws2-porta-aperta-design.md` (sezioni citate come «spec §n»). Spec madre: `docs/superpowers/specs/2026-09-06-saas-multi-azienda-design.md`. WS1: `docs/superpowers/specs/2026-09-06-ws1-fondazione-tenant-design.md`.

## Global Constraints

- **Branch:** `feature/ws2-porta-aperta` (nasce dal branch del WS1 `feature/ws1-fondazione-tenant`, HEAD `94180e1`; se la PR #3 viene fusa prima, ribasare su `main`). Mai commit su `main` (= produzione Railway). Mai `git stash` (stash condiviso fra worktree): per accantonare, commit WIP.
- **Commit:** messaggi in italiano, prefissi `feat|fix|test|docs|chore(tenant|persistence|…)`; ogni commit termina con `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- **Interruttore:** `FLAG_MULTI_AZIENDA` via `interruttoreAttivo("multiAzienda")` (`server/platform/interruttori.ts`): con la variabile assente è **acceso in `development` e `test`**, spento in produzione. Nei test quindi il multi-azienda è ON per default; spegnerlo con `process.env.FLAG_MULTI_AZIENDA = "off"` e ripristinare in `afterEach`.
- **Contesto implicito:** `persistence.ts` NON importa `server/tenants/*` (riceve il resolver con `impostaResolverTenant`); `server/tenants/contestoCorrente.ts` importa `interruttori`, `costanti`, `repository`, `contesto`. Nessun altro modulo legge `AsyncLocalStorage` direttamente.
- **`kv_store`** è letto e scritto solo da `server/_core/persistence.ts` (fuori dai test). Le tabelle `tenant*` sono scritte solo da `server/tenants/repository.ts` (test strutturale `confine.test.ts`); `UPDATE <tabella> SET tenant_id` in `server/tenants/tabelle.ts` è ammesso perché non è `INSERT INTO tenant`.
- **Fail-closed:** con interruttore acceso, un accesso a uno store per tenant senza tenant nel contesto lancia `Error("[persistence] accesso allo store <nome> senza tenant nel contesto")`; ripiego sul tenant 1 SOLO con `NODE_ENV === "test"` e senza `modalitaTenantStretta(true)`. Mai un array vuoto «di comodo», mai dati di un altro tenant.
- **Chiavi:** `chiaveStore(1, nome) === nome`; `chiaveStore(n, nome) === \`tenant:${n}:${nome}\`` per n ≥ 2. Un nome di store che inizia con `tenant:` è rifiutato.
- **Store globali** (solo questi, con `{ ambito: "globale" }`): `sedi`, `utenti`, `platform_feature_flags`, `platform_feature_flag_audit`, `backup_config`, `backup_oauth`, `backup_log`.
- **Id:** unici nell'installazione: `store.prossimoId()` e `store.riservaIdFinoA(n)`; nessun `let next*Id` di modulo e nessun `Math.max(...items.map(x => x.id)) + 1` fuori da `persistence.ts` (test strutturale), eccetto `sedi.ts` e `utenti.ts` (globali, invariati).
- **Messaggi** (`server/tenants/costanti.ts` `MESSAGGI`): riusare `solaLettura`, `senzaSede`, `nonTrovato`; nessun messaggio nuovo verso l'utente.
- **Tabelle con `sede_id`** (33, spec §6.2): la costante `TABELLE_PER_SEDE` deve coincidere con l'inventario estratto dai sorgenti (test strutturale).
- **Test:** `pnpm check` (tsc, esclude i test), `pnpm vitest run <file>` per i singoli file, `pnpm test` per la suite; baseline: 3 test HEIC «sips» rossi sulla macchina di sviluppo (`server/documenti/{anteprime,heic,parserRegistry.heic}.test.ts`) non sono regressioni. I test `*.pg.test.ts` girano solo con `DATABASE_URL` (Docker: vedi intestazione di `server/tenants/repository.pg.test.ts`) e sono `describe.skipIf`.
- **Tsconfig** esclude i test da `pnpm check`: gli errori di tipo nei test emergono solo da vitest.
- **Niente segreti** nei log, nei payload e nel repository. Nessun `structuredClone` sull'array intero di uno store.
- **Nomi in italiano** per funzioni, file e messaggi nuovi, come nel resto di `server/tenants/`.

---

### Task 1: Contesto corrente del tenant (`AsyncLocalStorage`)

**Files:**
- Create: `server/tenants/contestoCorrente.ts`
- Test: `server/tenants/contestoCorrente.test.ts`

**Interfaces:**
- Consumes: `interruttoreAttivo` (`server/platform/interruttori.ts`), `TENANT_PREDEFINITO_ID` (`server/tenants/costanti.ts`), `getTenantRepository().tutti()` (`server/tenants/repository.ts`), `tenantIdDellaSede` (`server/tenants/contesto.ts`).
- Produces (usati dai task 2, 6–11):
  ```ts
  export function conTenant<T>(tenantId: number, fn: () => T): T;
  export function tenantCorrente(): number | null;
  export function conTenantDellaSede<T>(sedeId: number, fn: () => T): T;
  export function tenantsAttivi(): number[];
  export function perOgniTenantAttivo(etichetta: string, fn: (tenantId: number) => Promise<void>): Promise<void>;
  export function modalitaTenantStretta(attiva: boolean): void; // solo test
  ```

- [ ] **Step 1: Scrivere il test che fallisce**

```ts
// server/tenants/contestoCorrente.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  conTenant,
  conTenantDellaSede,
  modalitaTenantStretta,
  perOgniTenantAttivo,
  tenantCorrente,
  tenantsAttivi,
} from "./contestoCorrente";
import { getTenantRepository, resetTenantRepositoryForTesting } from "./repository";

describe("contesto corrente del tenant", () => {
  beforeEach(() => {
    delete process.env.FLAG_MULTI_AZIENDA; // nei test = acceso
    resetTenantRepositoryForTesting();
    modalitaTenantStretta(false);
  });
  afterEach(() => {
    delete process.env.FLAG_MULTI_AZIENDA;
    modalitaTenantStretta(false);
  });

  it("dentro conTenant risolve il tenant, anche attraverso await e timer", async () => {
    const visto = await conTenant(7, async () => {
      await new Promise(r => setTimeout(r, 1));
      return tenantCorrente();
    });
    expect(visto).toBe(7);
  });

  it("annidato: l'interno vince e l'esterno torna alla fine", async () => {
    await conTenant(2, async () => {
      expect(tenantCorrente()).toBe(2);
      await conTenant(3, async () => expect(tenantCorrente()).toBe(3));
      expect(tenantCorrente()).toBe(2);
    });
  });

  it("nei test senza contesto ripiega sul tenant 1; in modalità stretta è null", () => {
    expect(tenantCorrente()).toBe(1);
    modalitaTenantStretta(true);
    expect(tenantCorrente()).toBeNull();
  });

  it("con interruttore spento è sempre 1, anche dentro conTenant(5)", () => {
    process.env.FLAG_MULTI_AZIENDA = "off";
    expect(tenantCorrente()).toBe(1);
    expect(conTenant(5, () => tenantCorrente())).toBe(1);
  });

  it("conTenantDellaSede usa il tenant della sede (1 se la sede non esiste)", () => {
    expect(conTenantDellaSede(999_999, () => tenantCorrente())).toBe(1);
  });

  it("tenantsAttivi: 1 se il control plane è vuoto o spento, altrimenti i tenant attivi", async () => {
    expect(tenantsAttivi()).toEqual([1]);
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "Ruffino Group" });
    await repo.inserisci({ id: 2, slug: "acme", nome: "Acme" });
    await repo.inserisci({ id: 3, slug: "sospesa", nome: "Sospesa", stato: "sospeso" });
    expect(tenantsAttivi()).toEqual([1, 2]);
    process.env.FLAG_MULTI_AZIENDA = "off";
    expect(tenantsAttivi()).toEqual([1]);
  });

  it("perOgniTenantAttivo esegue ogni tenant nel suo contesto e un errore non ferma gli altri", async () => {
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "Ruffino Group" });
    await repo.inserisci({ id: 2, slug: "acme", nome: "Acme" });
    const visti: Array<number | null> = [];
    await perOgniTenantAttivo("prova", async id => {
      if (id === 1) throw new Error("boom");
      visti.push(tenantCorrente());
    });
    expect(visti).toEqual([2]);
  });
});
```

- [ ] **Step 2: Eseguire il test e vederlo fallire**

Run: `pnpm vitest run server/tenants/contestoCorrente.test.ts`
Expected: FAIL — `Cannot find module './contestoCorrente'`.

- [ ] **Step 3: Implementare**

```ts
// server/tenants/contestoCorrente.ts
// Il tenant «corrente» di una richiesta, di un giro di worker o di un
// comando: vive in AsyncLocalStorage e lo leggono solo persistence.ts (via
// resolver) e le guardie. Nessun altro modulo tocca l'ALS direttamente.
import { AsyncLocalStorage } from "node:async_hooks";
import { interruttoreAttivo } from "../platform/interruttori";
import { TENANT_PREDEFINITO_ID } from "./costanti";
import { tenantIdDellaSede } from "./contesto";
import { getTenantRepository } from "./repository";

type Contesto = { tenantId: number };

const als = new AsyncLocalStorage<Contesto>();
let strettoNeiTest = false;

/** Esegue `fn` con il tenant nel contesto (si propaga ad await, promise e timer creati dentro). */
export function conTenant<T>(tenantId: number, fn: () => T): T {
  return als.run({ tenantId }, fn);
}

/**
 * Interruttore spento → sempre il tenant 1. Acceso → il tenant nel contesto;
 * senza contesto: `null` (fail-closed), salvo nei test, dove si ripiega sul
 * tenant 1 perché quasi ogni test chiama i moduli fuori da una richiesta.
 * `modalitaTenantStretta(true)` toglie il ripiego nei test che verificano
 * che un worker dichiari il tenant.
 */
export function tenantCorrente(): number | null {
  if (!interruttoreAttivo("multiAzienda")) return TENANT_PREDEFINITO_ID;
  const contesto = als.getStore();
  if (contesto) return contesto.tenantId;
  if (process.env.NODE_ENV === "test" && !strettoNeiTest) return TENANT_PREDEFINITO_ID;
  return null;
}

export function conTenantDellaSede<T>(sedeId: number, fn: () => T): T {
  return conTenant(tenantIdDellaSede(sedeId), fn);
}

/** I tenant per cui girano i worker: attivi (mai i sospesi: sola lettura), 1 se il control plane è vuoto o l'interruttore spento. */
export function tenantsAttivi(): number[] {
  if (!interruttoreAttivo("multiAzienda")) return [TENANT_PREDEFINITO_ID];
  const tutti = getTenantRepository().tutti();
  if (tutti.length === 0) return [TENANT_PREDEFINITO_ID];
  return tutti.filter(t => t.stato === "attivo").map(t => t.id);
}

/** Un giro per tenant, ognuno nel suo contesto; un errore di un tenant non ferma gli altri. */
export async function perOgniTenantAttivo(
  etichetta: string,
  fn: (tenantId: number) => Promise<void>
): Promise<void> {
  for (const tenantId of tenantsAttivi()) {
    try {
      await conTenant(tenantId, () => fn(tenantId));
    } catch (errore) {
      console.error(`[${etichetta}] tenant ${tenantId}:`, errore instanceof Error ? errore.message : errore);
    }
  }
}

export function modalitaTenantStretta(attiva: boolean): void {
  if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY_MODALITA_TENANT_STRETTA");
  strettoNeiTest = attiva;
}
```

- [ ] **Step 4: Eseguire il test e vederlo passare**

Run: `pnpm vitest run server/tenants/contestoCorrente.test.ts`
Expected: PASS (7 test).

- [ ] **Step 5: Commit**

```bash
git add server/tenants/contestoCorrente.ts server/tenants/contestoCorrente.test.ts
git commit -m "feat(tenant): contesto corrente del tenant su AsyncLocalStorage (conTenant, tenantCorrente, perOgniTenantAttivo)"
```

---

### Task 2: `persistence.ts` — famiglie, chiavi, Proxy, resolver, salvataggio per tenant

**Files:**
- Modify: `server/_core/persistence.ts` (tipi e registro alle righe 129-200, `risolviStoreAtomici` 229-243, `getAllStoreSnapshots` 176-181, `persistedStore` 183-201)
- Test: `server/_core/persistence.tenant.test.ts`

**Interfaces:**
- Consumes: nulla di nuovo (il resolver arriva dall'esterno).
- Produces:
  ```ts
  export type AmbitoStore = "tenant" | "globale";
  export type LoadMeta = { firstBoot: boolean; tenantId: number | null };
  export type PersistedStore<T> = { items: T[]; save: () => void; prossimoId: () => number; riservaIdFinoA: (n: number) => void };
  export function persistedStore<T>(nome: string, onLoad?: (items: T[], meta: LoadMeta) => void, opzioni?: { ambito?: AmbitoStore }): PersistedStore<T>;
  export function chiaveStore(tenantId: number, nome: string): string;
  export function impostaResolverTenant(resolver: () => number | null): void;
  export function storeDi<T = any>(tenantId: number, nome: string): T[];   // array reale, mai nei router
  export function tenantsNoti(): number[];
  export function getAllStoreSnapshots(): Array<{ key: string; items: any[]; nome: string; tenantId: number | null }>;
  ```
  `prossimoId`/`riservaIdFinoA` si completano nel Task 4 (qui esistono e funzionano sulla famiglia). Il boot per tenant (`bootstrapAll({ tenantIds })`, `istanziaStoresPerTenant`) è del Task 3: in questo task `persistedStore` crea le istanze per i tenant già noti (`tenantsNoti` parte da `[1]`) e `registraTenantNoto(id)` è interno.

- [ ] **Step 1: Scrivere i test che falliscono**

```ts
// server/_core/persistence.tenant.test.ts
// Senza DATABASE_URL: gli store vivono in memoria (loaded = true), il che
// basta per provare famiglie, Proxy, chiavi e resolver.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chiaveStore,
  getAllStoreSnapshots,
  impostaResolverTenant,
  persistedStore,
  storeDi,
  __resetPersistenzaPerTest,
  __registraTenantNotoPerTest,
} from "./persistence";

let tenant: number | null = 1;
const resolver = () => tenant;

describe("persistence per tenant", () => {
  beforeEach(() => {
    __resetPersistenzaPerTest();
    impostaResolverTenant(resolver);
    __registraTenantNotoPerTest(2);
    tenant = 1;
  });
  afterEach(() => __resetPersistenzaPerTest());

  it("chiaveStore: alias per il tenant 1, prefisso dagli altri", () => {
    expect(chiaveStore(1, "clienti")).toBe("clienti");
    expect(chiaveStore(2, "clienti")).toBe("tenant:2:clienti");
  });

  it("rifiuta nomi con prefisso tenant: e doppioni", () => {
    expect(() => persistedStore("tenant:2:x")).toThrow(/tenant:/);
    persistedStore("doppio");
    expect(() => persistedStore("doppio")).toThrow(/duplicate/);
  });

  it("due tenant vedono array diversi attraverso lo stesso Proxy", () => {
    const s = persistedStore<{ id: number; nome: string }>("clienti");
    const clienti = s.items;
    clienti.push({ id: 1, nome: "Uno" });
    tenant = 2;
    expect(clienti.length).toBe(0);
    clienti.push({ id: 2, nome: "Due" });
    expect(clienti.filter(c => c.id === 2)).toHaveLength(1);
    expect([...clienti].map(c => c.nome)).toEqual(["Due"]);
    expect(JSON.stringify(clienti)).toBe('[{"id":2,"nome":"Due"}]');
    expect(Array.isArray(clienti)).toBe(true);
    tenant = 1;
    expect(clienti[0]?.nome).toBe("Uno");
    clienti.length = 0;
    expect(storeDi(1, "clienti")).toEqual([]);
    expect(storeDi(2, "clienti")).toEqual([{ id: 2, nome: "Due" }]);
  });

  it("splice, indice, findIndex e sort lavorano sull'array reale del tenant", () => {
    const s = persistedStore<any>("commesse");
    const commesse = s.items;
    commesse.push({ id: 3 }, { id: 1 }, { id: 2 });
    commesse.sort((a, b) => a.id - b.id);
    const idx = commesse.findIndex(c => c.id === 2);
    commesse[idx] = { id: 2, nota: "x" };
    commesse.splice(0, 1);
    expect(storeDi(1, "commesse")).toEqual([{ id: 2, nota: "x" }, { id: 3 }]);
  });

  it("senza tenant nel contesto l'accesso è un errore, mai un array altrui", () => {
    const s = persistedStore<any>("interventi");
    tenant = null;
    expect(() => s.items.length).toThrow(/senza tenant nel contesto/);
    expect(() => s.items.push({ id: 1 })).toThrow(/senza tenant nel contesto/);
  });

  it("un tenant non istanziato è un errore esplicito", () => {
    const s = persistedStore<any>("verbali");
    tenant = 9;
    expect(() => s.items.length).toThrow(/non istanziato per il tenant 9/);
  });

  it("una famiglia globale ignora il contesto", () => {
    const s = persistedStore<any>("sedi", undefined, { ambito: "globale" });
    tenant = null;
    s.items.push({ id: 1 });
    tenant = 2;
    expect(s.items.length).toBe(1);
    expect(storeDi(1, "sedi")).toHaveLength(1);
  });

  it("gli snapshot elencano ogni istanza con nome e tenant", () => {
    persistedStore<any>("garanzie");
    persistedStore<any>("utenti", undefined, { ambito: "globale" });
    const chiavi = getAllStoreSnapshots().map(s => [s.key, s.nome, s.tenantId]);
    expect(chiavi).toEqual(
      expect.arrayContaining([["garanzie", "garanzie", 1], ["tenant:2:garanzie", "garanzie", 2], ["utenti", "utenti", null]])
    );
  });

  it("senza resolver: nei test ripiega sul tenant 1, fuori dai test è un errore", () => {
    __resetPersistenzaPerTest();
    const s = persistedStore<any>("anomalie");
    expect(s.items.length).toBe(0); // NODE_ENV=test → tenant 1
    const prima = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(() => s.items.length).toThrow(/senza resolver/);
    } finally {
      process.env.NODE_ENV = prima;
    }
  });
});
```

- [ ] **Step 2: Eseguire i test e vederli fallire**

Run: `pnpm vitest run server/_core/persistence.tenant.test.ts`
Expected: FAIL — export mancanti (`chiaveStore`, `impostaResolverTenant`, …).

- [ ] **Step 3: Implementare in `persistence.ts`**

Sostituire il blocco «tipi e registro» (da `export type LoadMeta` a `persistedStore` incluso) con:

```ts
export type LoadMeta = { firstBoot: boolean; tenantId: number | null };
export type AmbitoStore = "tenant" | "globale";

// = TENANT_PREDEFINITO_ID di server/tenants/costanti.ts. Nessun import:
// persistence non dipende da server/tenants (test strutturale in Task 15).
const TENANT_PREDEFINITO = 1;

type Famiglia = {
  nome: string;
  ambito: AmbitoStore;
  onLoad?: (items: any[], meta: LoadMeta) => void;
  istanze: Map<number, StoreEntry>; // per tenant (famiglie "tenant")
  globale: StoreEntry | null;       // l'unica istanza (famiglie "globale")
  maxId: number;                    // Task 4
};

type StoreEntry = {
  key: string;
  nome: string;
  tenantId: number | null;
  famiglia: Famiglia;
  items: any[];
  onLoad?: (items: any[], meta: LoadMeta) => void;
  loaded: boolean;
};

const famiglie = new Map<string, Famiglia>();
const registry = new Map<string, StoreEntry>(); // per chiave, come prima
const noti = new Set<number>([TENANT_PREDEFINITO]);
const saveTimers = new Map<string, NodeJS.Timeout>();
const SAVE_DEBOUNCE_MS = 200;
let bootstrapEseguito = false;
let resolverTenant: (() => number | null) | null = null;

export function impostaResolverTenant(resolver: () => number | null): void {
  resolverTenant = resolver;
}

export function tenantsNoti(): number[] {
  return [...noti].sort((a, b) => a - b);
}

export function chiaveStore(tenantId: number, nome: string): string {
  return tenantId === TENANT_PREDEFINITO ? nome : `tenant:${tenantId}:${nome}`;
}

function tenantRichiesto(nome: string): number {
  if (!resolverTenant) {
    // Nei test quasi tutto gira fuori da una richiesta e senza importare
    // contestoCorrente.ts: ripiego sul tenant 1. Altrove è un errore.
    if (process.env.NODE_ENV === "test") return TENANT_PREDEFINITO;
    throw new Error(`[persistence] accesso allo store ${nome} senza resolver del tenant`);
  }
  const tenantId = resolverTenant();
  if (tenantId == null) throw new Error(`[persistence] accesso allo store ${nome} senza tenant nel contesto`);
  return tenantId;
}

function istanzaCorrente(f: Famiglia): StoreEntry {
  if (f.ambito === "globale") return f.globale!;
  const tenantId = tenantRichiesto(f.nome);
  const entry = f.istanze.get(tenantId);
  if (!entry) throw new Error(`[persistence] store ${f.nome} non istanziato per il tenant ${tenantId}`);
  return entry;
}

function creaIstanza(f: Famiglia, tenantId: number | null): StoreEntry {
  const key = tenantId == null ? f.nome : chiaveStore(tenantId, f.nome);
  if (registry.has(key)) throw new Error(`[persistence] duplicate store key: ${key}`);
  // loaded=true quando non c'è DB — test e sviluppo locale salvano liberamente.
  const entry: StoreEntry = { key, nome: f.nome, tenantId, famiglia: f, items: [], onLoad: f.onLoad, loaded: !sql };
  registry.set(key, entry);
  if (tenantId == null) f.globale = entry;
  else f.istanze.set(tenantId, entry);
  return entry;
}

/** L'array reale di un'istanza: per migrazione, verifica e Platform Admin. MAI nei router. */
export function storeDi<T = any>(tenantId: number, nome: string): T[] {
  const f = famiglie.get(nome);
  if (!f) throw new Error(`[persistence] store ${nome} sconosciuto`);
  const entry = f.ambito === "globale" ? f.globale : f.istanze.get(tenantId);
  if (!entry) throw new Error(`[persistence] store ${nome} non istanziato per il tenant ${tenantId}`);
  return entry.items as T[];
}

function proxyArray(f: Famiglia): any[] {
  // Il bersaglio è un array vuoto: Array.isArray(proxy) è vero e JSON.stringify
  // lo tratta da array. Ogni trap inoltra all'array reale del tenant corrente.
  const reale = () => istanzaCorrente(f).items;
  return new Proxy([] as any[], {
    get(_t, prop) {
      const arr = reale();
      const v = Reflect.get(arr, prop, arr);
      return typeof v === "function" ? v.bind(arr) : v;
    },
    set(_t, prop, value) {
      return Reflect.set(reale(), prop, value);
    },
    has(_t, prop) {
      return Reflect.has(reale(), prop);
    },
    deleteProperty(_t, prop) {
      return Reflect.deleteProperty(reale(), prop);
    },
    ownKeys() {
      return Reflect.ownKeys(reale());
    },
    getOwnPropertyDescriptor(_t, prop) {
      return Reflect.getOwnPropertyDescriptor(reale(), prop);
    },
    defineProperty(_t, prop, desc) {
      return Reflect.defineProperty(reale(), prop, desc);
    },
  });
}

export type PersistedStore<T> = {
  items: T[];
  save: () => void;
  prossimoId: () => number;
  riservaIdFinoA: (n: number) => void;
};

const storeKeys = new WeakMap<object, Famiglia>();
const storeLocks = new Map<string, Promise<void>>();

// Fotografia di ogni istanza registrata — backup, ricifratura, migrazioni.
// Gli items sono gli array vivi: chi legge NON deve mutarli.
export function getAllStoreSnapshots(): Array<{ key: string; items: any[]; nome: string; tenantId: number | null }> {
  return Array.from(registry.values()).map(e => ({ key: e.key, items: e.items, nome: e.nome, tenantId: e.tenantId }));
}

export function persistedStore<T>(
  nome: string,
  onLoad?: (items: T[], meta: LoadMeta) => void,
  opzioni: { ambito?: AmbitoStore } = {}
): PersistedStore<T> {
  if (nome.startsWith("tenant:")) throw new Error(`[persistence] nome di store non ammesso: ${nome}`);
  if (famiglie.has(nome)) throw new Error(`[persistence] duplicate store key: ${nome}`);
  const f: Famiglia = { nome, ambito: opzioni.ambito ?? "tenant", onLoad: onLoad as any, istanze: new Map(), globale: null, maxId: 0 };
  famiglie.set(nome, f);
  const nuove: StoreEntry[] = f.ambito === "globale" ? [creaIstanza(f, null)] : [...noti].map(id => creaIstanza(f, id));
  const store: PersistedStore<T> = {
    items: proxyArray(f) as T[],
    save: () => scheduleSave(istanzaCorrente(f).key),
    prossimoId: () => ++f.maxId,
    riservaIdFinoA: n => { if (n > f.maxId) f.maxId = n; },
  };
  storeKeys.set(store, f);
  if (sql && bootstrapEseguito) for (const entry of nuove) void caricaTardivo(entry);
  return store;
}

function registraTenantNoto(tenantId: number): void {
  noti.add(tenantId);
}

// ── Solo test ───────────────────────────────────────────────────────────────
export function __resetPersistenzaPerTest(): void {
  if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY_RESET_PERSISTENZA");
  for (const t of saveTimers.values()) clearTimeout(t);
  saveTimers.clear();
  famiglie.clear();
  registry.clear();
  noti.clear();
  noti.add(TENANT_PREDEFINITO);
  resolverTenant = null;
}
export function __registraTenantNotoPerTest(tenantId: number): void {
  if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY_TENANT_NOTO");
  registraTenantNoto(tenantId);
  for (const f of famiglie.values()) if (f.ambito === "tenant" && !f.istanze.has(tenantId)) creaIstanza(f, tenantId);
}
```

Poi adeguare il resto del file:
- `risolviStoreAtomici`: `const f = storeKeys.get(store as object); const entry = f ? istanzaCorrente(f) : null;` (il resto invariato: dedup per `key`, ordine lessicografico, controllo `loaded`).
- `caricaTardivo` e `caricaEntry`: `store.onLoad?.(store.items, { firstBoot, tenantId: store.tenantId })` (tre punti: `caricaEntry`, il ramo di errore di `caricaEntry`, `backgroundRecover`); nel ramo «no DB» di `bootstrapAll` idem con `firstBoot: true`.
- `bootstrapAll` resta con la firma attuale in questo task (il Task 3 la estende).
- Il commento di testa del file (`// Pattern:`) aggiornato: `const clienti = _store.items; // Proxy: risolve il tenant corrente a ogni chiamata` e `id: _store.prossimoId()`.

- [ ] **Step 4: Eseguire i test**

Run: `pnpm vitest run server/_core/persistence.tenant.test.ts && pnpm check`
Expected: PASS (9 test); `pnpm check` verde. Possibile errore di tipo in `server/_core/fileStorageMigrate.ts` (usa `PersistedStore<T>`): aggiungere i due campi nuovi dove costruisce oggetti di quel tipo, se lo fa.

- [ ] **Step 5: Suite completa di regressione**

Run: `pnpm vitest run 2>&1 | grep -E "^ FAIL|Test Files|Tests  "`
Expected: solo i 3 HEIC di baseline. Se un test accede a uno store senza resolver (errore «senza resolver del tenant»), NON aggiungere ripieghi in `persistence.ts`: registrare in `server/_core/testSetup.ts` il resolver di prova (Task 6, Step 3b) — anticiparlo qui se serve, con lo stesso codice.

- [ ] **Step 6: Commit**

```bash
git add server/_core/persistence.ts server/_core/persistence.tenant.test.ts server/_core/testSetup.ts
git commit -m "feat(persistence): famiglie di store per tenant, chiavi con alias del tenant 1, Proxy sul tenant corrente, resolver iniettato"
```

---

### Task 3: `persistence.ts` — boot per tenant, istanze a caldo, backfill centrale, letture di sola lettura

**Files:**
- Modify: `server/_core/persistence.ts` (`bootstrapAll`, `caricaEntry`, `backgroundRecover`, `caricaTardivo`)
- Test: `server/_core/persistence.tenant.test.ts` (estendere), `server/_core/persistence.tenant.pg.test.ts` (nuovo, Postgres vero)

**Interfaces:**
- Produces:
  ```ts
  export async function bootstrapAll(opzioni?: { tenantIds?: number[]; backfill?: boolean }): Promise<void>; // backfill: solo il boot del server (Ruling R6)
  export async function istanziaStoresPerTenant(tenantId: number): Promise<void>;
  export async function leggiBlobDaDb(key: string): Promise<any[] | null>;   // sola lettura, null se la riga manca
  export async function elencaChiaviDaDb(): Promise<string[]>;
  ```

- [ ] **Step 1: Test in memoria (estendere `persistence.tenant.test.ts`)**

```ts
  it("bootstrapAll({ tenantIds }) istanzia ogni famiglia per ogni tenant (senza DB: firstBoot per tutti)", async () => {
    const seed: Array<number | null> = [];
    persistedStore<any>("squadre", (items, meta) => { seed.push(meta.tenantId); if (meta.firstBoot) items.push({ id: 1, tenantId: meta.tenantId }); });
    await bootstrapAll({ tenantIds: [1, 2, 5] });
    expect(seed.sort()).toEqual([1, 2, 5]);
    expect(storeDi(5, "squadre")).toEqual([{ id: 1, tenantId: 5 }]);
    expect(tenantsNoti()).toEqual([1, 2, 5]);
  });

  it("istanziaStoresPerTenant crea le istanze di un tenant nuovo dopo il boot", async () => {
    const s = persistedStore<any>("tickets");
    await bootstrapAll({ tenantIds: [1] });
    await istanziaStoresPerTenant(4);
    tenant = 4;
    s.items.push({ id: 1 });
    expect(storeDi(4, "tickets")).toHaveLength(1);
    expect(tenantsNoti()).toEqual([1, 2, 4]); // il 2 viene dal beforeEach
  });
```

- [ ] **Step 2: Test su Postgres vero (`persistence.tenant.pg.test.ts`)**

```ts
// Come server/tenants/repository.pg.test.ts (stesso container Docker).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kvSql } from "./persistence";
import {
  bootstrapAll, chiaveStore, elencaChiaviDaDb, flushAll, impostaResolverTenant, istanziaStoresPerTenant,
  leggiBlobDaDb, persistedStore, storeDi, __resetPersistenzaPerTest,
} from "./persistence";

const conDatabase = Boolean(process.env.DATABASE_URL && kvSql);
let tenant: number | null = 1;

describe.skipIf(!conDatabase)("persistence per tenant su Postgres", () => {
  const sql = kvSql!;
  beforeAll(async () => {
    await sql`DELETE FROM kv_store WHERE key IN ('prova_pg', 'tenant:2:prova_pg', 'tenant:3:prova_pg')`;
    await sql`INSERT INTO kv_store (key, data) VALUES ('prova_pg', '[{"id":1,"sedeId":1}]'::jsonb)`;
    __resetPersistenzaPerTest();
    impostaResolverTenant(() => tenant);
  });
  afterAll(async () => {
    await sql`DELETE FROM kv_store WHERE key IN ('prova_pg', 'tenant:2:prova_pg', 'tenant:3:prova_pg')`;
    __resetPersistenzaPerTest();
  });

  it("carica la chiave legacy per il tenant 1, backfilla tenantId e scrive tenant:2:* per il tenant 2", async () => {
    const s = persistedStore<any>("prova_pg");
    await bootstrapAll({ tenantIds: [1, 2] });
    expect(storeDi(1, "prova_pg")).toEqual([{ id: 1, sedeId: 1, tenantId: 1 }]); // backfill centrale
    tenant = 2;
    s.items.push({ id: 2, sedeId: 9 });
    s.save();
    await flushAll();
    expect(await leggiBlobDaDb("tenant:2:prova_pg")).toEqual([{ id: 2, sedeId: 9, tenantId: 2 }]);
    expect(await leggiBlobDaDb("prova_pg")).toEqual([{ id: 1, sedeId: 1, tenantId: 1 }]); // risalvato dal backfill
    expect(await elencaChiaviDaDb()).toEqual(expect.arrayContaining(["prova_pg", "tenant:2:prova_pg"]));
    expect(chiaveStore(3, "prova_pg")).toBe("tenant:3:prova_pg");
    await istanziaStoresPerTenant(3);
    expect(storeDi(3, "prova_pg")).toEqual([]);
  });
});
```

Nota: `flushAll` attende i salvataggi programmati; il backfill programma il salvataggio dopo `loaded = true`.

- [ ] **Step 3: Eseguire e vedere fallire**

Run: `pnpm vitest run server/_core/persistence.tenant.test.ts` (senza DB) e, con Docker acceso, `DATABASE_URL=postgres://postgres:test@localhost:55433/perf_test pnpm vitest run server/_core/persistence.tenant.pg.test.ts`
Expected: FAIL — `bootstrapAll` non accetta opzioni / export mancanti.

- [ ] **Step 4: Implementare**

```ts
function dopoCaricamento(store: StoreEntry, firstBoot: boolean): void {
  // Backfill additivo (spec §3.4): solo famiglie per tenant, solo record oggetto.
  let backfill = 0;
  if (store.tenantId != null) {
    for (const r of store.items) {
      if (r && typeof r === "object" && typeof (r as any).tenantId !== "number") {
        (r as any).tenantId = store.tenantId;
        backfill++;
      }
    }
  }
  for (const r of store.items) {
    const id = (r as any)?.id;
    if (typeof id === "number" && id > store.famiglia.maxId) store.famiglia.maxId = id;
  }
  store.onLoad?.(store.items, { firstBoot, tenantId: store.tenantId });
  store.loaded = true;
  if (backfill > 0) {
    console.log(`[persistence] backfill tenantId ${store.key}: ${backfill} record`);
    setTimeout(() => scheduleSave(store.key), 0);
  }
}
```

- In `caricaEntry`: sostituire `store.onLoad?.(store.items, { firstBoot }); store.loaded = true;` con `dopoCaricamento(store, firstBoot)`. Nel ramo di errore resta `store.onLoad?.(store.items, { firstBoot: false, tenantId: store.tenantId })` senza `loaded`.
- In `backgroundRecover`: stesso `dopoCaricamento(store, firstBoot)` al posto delle due righe.
- `bootstrapAll(opzioni = {})`: all'inizio `for (const id of opzioni.tenantIds ?? []) registraTenantNoto(id); for (const f of famiglie.values()) if (f.ambito === "tenant") for (const id of noti) if (!f.istanze.has(id)) creaIstanza(f, id);` poi il codice attuale (ramo senza DB: `dopoCaricamento(store, true)` per ogni entry; ramo con DB invariato).
- `istanziaStoresPerTenant(tenantId)`:
  ```ts
  export async function istanziaStoresPerTenant(tenantId: number): Promise<void> {
    if (noti.has(tenantId)) return;
    registraTenantNoto(tenantId);
    const create: StoreEntry[] = [];
    try {
      for (const f of famiglie.values()) if (f.ambito === "tenant") create.push(creaIstanza(f, tenantId));
      for (const entry of create) {
        if (!sql) { dopoCaricamento(entry, true); continue; }
        const ok = await caricaEntry(entry);
        if (!ok) throw new Error(`[persistence] store ${entry.key} non caricato`);
      }
    } catch (e) {
      for (const entry of create) { registry.delete(entry.key); entry.famiglia.istanze.delete(tenantId); }
      noti.delete(tenantId);
      throw e;
    }
  }
  ```
- `caricaTardivo(entry)` invariato ma chiamato per ogni istanza nuova (già nel Task 2).
- Letture di sola lettura:
  ```ts
  export async function leggiBlobDaDb(key: string): Promise<any[] | null> {
    if (!sql) return null;
    const rows = await sql`SELECT data FROM kv_store WHERE key = ${key} LIMIT 1`;
    if (rows.length === 0) return null;
    const raw = typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : rows[0].data;
    return Array.isArray(raw) ? raw : null;
  }
  export async function elencaChiaviDaDb(): Promise<string[]> {
    if (!sql) return [];
    return (await sql`SELECT key FROM kv_store ORDER BY key`).map(r => String(r.key));
  }
  ```

- [ ] **Step 5: Eseguire i test (memoria + Postgres) e `pnpm check`**

Expected: PASS. Con Docker spento il test pg risulta `skipped` (accettabile solo se il revisore lo ha visto verde almeno una volta: dirlo nel report).

- [ ] **Step 6: Commit**

```bash
git add server/_core/persistence.ts server/_core/persistence.tenant.test.ts server/_core/persistence.tenant.pg.test.ts
git commit -m "feat(persistence): boot per tenant, istanze a caldo, backfill centrale di tenantId, letture di sola lettura da kv_store"
```

---

### Task 4: Id globali — `prossimoId()` nei 23 moduli e test strutturale

**Files:**
- Modify (store per tenant con contatore locale — 15): `server/comunicazioni/whatsapp.ts` (108, 126, 240), `server/routers/anomalie.ts` (7, 9), `server/routers/aperture.ts` (7, 9), `server/routers/clienti.ts` (31, 60; 2 usi), `server/routers/commesse.ts` (88, 142; 2 usi), `server/routers/garanzie.ts` (6, 8), `server/routers/interventi.ts` (44, 76), `server/routers/magazzino.ts` (44, 46; 2 usi), `server/routers/preventiviContratti.ts` (112, 139; 4 usi), `server/routers/squadre.ts` (6, 8), `server/routers/ticket.ts` (22, 25), `server/routers/ticketAllegati.ts` (31, 33), `server/routers/timeline.ts` (179, 182), `server/routers/verbali.ts` (6, 8), `server/tars/memoria.ts` (40, 42, 163).
- Modify (generatori inline — 8): `server/routers/ficPagamenti.ts:97` (`nextLinkId`), `server/routers/fattureInCloud.ts:114` (`nextCfgId`), `server/routers/conoscenza.ts:42` (`nextVoceId`), `server/commesse/transizioni.ts:86`, `server/comunicazioni/filtroComunicazioni.ts:54` (`nextRegolaId`), `server/proposte/gateway.ts:114`, `server/documenti/analisi.ts:99`, `server/documenti/collegamenti.ts:44`.
- NON toccare: `server/routers/sedi.ts`, `server/routers/utenti.ts` (globali), `server/platform/featureFlags.ts:61` (globale), i `let nextId` dentro i repository in memoria delle tabelle SQL (`actionCenter`, `computo`, `contratti`, `contratti/estrazione`, `events`, `reminders`, `tars/proattivita/*`: non sono `persistedStore`).
- Test: `server/_core/idGlobali.test.ts` (strutturale) + caso in `persistence.tenant.test.ts`.

**Interfaces:** consuma `prossimoId`/`riservaIdFinoA` (Task 2).

- [ ] **Step 1: Test che falliscono**

In `persistence.tenant.test.ts`:
```ts
  it("prossimoId è unico fra i tenant e riparte dal massimo caricato", async () => {
    const s = persistedStore<any>("aperture");
    tenant = 1; s.items.push({ id: 10 });
    tenant = 2; s.items.push({ id: 3 });
    await bootstrapAll({ tenantIds: [1, 2] }); // senza DB: dopoCaricamento aggiorna maxId
    expect(s.prossimoId()).toBe(11);
    tenant = 1;
    expect(s.prossimoId()).toBe(12);
    s.riservaIdFinoA(50);
    expect(s.prossimoId()).toBe(51);
  });
```

`server/_core/idGlobali.test.ts` (stile di `server/tenants/confine.test.ts`: legge i sorgenti):
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fileSorgente, relativo } from "../tenants/confine.test"; // se non esportati, copiare le due funzioni
const AMMESSI = new Set(["server/routers/sedi.ts", "server/routers/utenti.ts", "server/platform/featureFlags.ts"]);
const NON_STORE = /server\/(actionCenter|computo|contratti|events|reminders|tars\/proattivita)\//;
describe("id globali", () => {
  it("nessun contatore di id locale nei moduli con store per tenant", () => {
    const colpevoli = fileSorgente(["server"]).filter(f => !/\.test\.ts$/.test(f) && !NON_STORE.test(f) && !AMMESSI.has(relativo(f)))
      .filter(f => /\blet next[A-Za-z]*Id\b|Math\.max\([^)]*\.map\([^)]*\.id\)[^;]*\+\s*1/.test(readFileSync(f, "utf8")))
      .map(relativo).filter(f => f !== "server/_core/persistence.ts");
    expect(colpevoli).toEqual([]);
  });
});
```

- [ ] **Step 2: Eseguire e vedere fallire** — `pnpm vitest run server/_core/idGlobali.test.ts server/_core/persistence.tenant.test.ts` → FAIL con l'elenco dei 23 file.

- [ ] **Step 3: Codemod e revisione a mano**

Per ogni modulo con contatore locale: togliere `let nextId = 1;` e la riga di `onLoad` che lo ricalcola; sostituire `nextId++` con `<store>.prossimoId()` (il nome della variabile store è quello del modulo: `_store`, `_appStore`, ecc.). In `whatsapp.ts:240` `nextId = Math.max(nextId, massimoStorico + 1)` diventa `_store.riservaIdFinoA(massimoStorico)`; in `tars/memoria.ts:163` (`nextId = 1` in un reset) sparisce. Per i generatori inline: `id: items.length ? Math.max(...items.map(x => x.id)) + 1 : 1` diventa `id: <store>.prossimoId()`; `nextLinkId`/`nextCfgId`/`nextVoceId`/`nextRegolaId` seguono la stessa regola. Verificare con `git grep -n "nextId\|next[A-Z][a-z]*Id" server` che restino solo i file ammessi.

- [ ] **Step 4: Eseguire i test dei moduli toccati e la suite**

Run: `pnpm vitest run server/routers server/comunicazioni server/tars/memoria.test.ts server/documenti server/proposte server/commesse && pnpm check`
Expected: PASS (baseline HEIC a parte). Attenzione ai test che contano gli id da 1 dopo un reset dello store: ora `maxId` non torna a 0 fra i test dello stesso file se lo store non viene ricreato — adeguare il test, non il codice.

- [ ] **Step 5: Commit**

```bash
git add -A server
git commit -m "refactor(persistence): id globali fra i tenant con prossimoId() in 23 moduli; test strutturale contro i contatori locali"
```

---

### Task 5: Store globali dichiarati e seed WhatsApp col tenant

**Files:**
- Modify: `server/routers/sedi.ts:42`, `server/routers/utenti.ts:111`, `server/platform/featureFlags.ts:41` e `:58`, `server/_core/driveBackup.ts:54`, `:89`, `:112` (aggiungere `{ ambito: "globale" }`), `server/comunicazioni/whatsapp.ts:187-190` (seed).
- Test: `server/_core/storeGlobali.test.ts` (strutturale), `server/comunicazioni/whatsapp.test.ts` (estendere).

**Interfaces:** consuma `persistedStore(nome, onLoad, { ambito })` (Task 2), `sedePredefinita(tenantId)` (`server/routers/sedi.ts`), `LoadMeta.tenantId`.

- [ ] **Step 1: Test strutturale che fallisce**

```ts
// server/_core/storeGlobali.test.ts — le sole sette famiglie globali (spec §3.1)
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fileSorgente, relativo } from "../tenants/confine.test";
const ATTESI = ["backup_config", "backup_log", "backup_oauth", "platform_feature_flag_audit", "platform_feature_flags", "sedi", "utenti"];
describe("store globali", () => {
  it("esattamente sette store dichiarano ambito globale", () => {
    const trovati: string[] = [];
    for (const f of fileSorgente(["server"]).filter(f => !/\.test\.ts$/.test(f))) {
      const s = readFileSync(f, "utf8");
      for (const m of s.matchAll(/persistedStore(?:<[^>]*>)?\(\s*"([a-z_]+)"[\s\S]{0,400}?\{\s*ambito:\s*"globale"\s*\}/g)) trovati.push(m[1]);
    }
    expect(trovati.sort()).toEqual(ATTESI);
  });
});
```

Nota: `fileSorgente`/`relativo` in `confine.test.ts` vanno esportati (sono già funzioni di modulo: aggiungere `export`).

- [ ] **Step 2: Test del seed WhatsApp (estendere `whatsapp.test.ts`)**

```ts
  it("il seed dell'app WhatsApp usa la sede predefinita del tenant, non la sede 1", async () => {
    // Un tenant 2 con una sede propria nello store globale `sedi`.
    __registraTenantNotoPerTest(2);
    const sedi = getSediStore();
    sedi.push({ id: 777, tenantId: 2, nome: "Acme", citta: null, indirizzo: null, attiva: true, createdAt: new Date(), updatedAt: new Date() } as any);
    await bootstrapAll({ tenantIds: [1, 2] });
    const app2 = storeDi<any>(2, "whatsapp_app");
    expect(app2).toHaveLength(1);
    expect(app2[0].sedeId).toBe(777);
    expect(storeDi<any>(1, "whatsapp_app").some(a => a.id === app2[0].id)).toBe(false); // id globali
  });
```

- [ ] **Step 3: Eseguire e vedere fallire** — `pnpm vitest run server/_core/storeGlobali.test.ts server/comunicazioni/whatsapp.test.ts`.

- [ ] **Step 4: Implementare**

Le sette dichiarazioni: terzo argomento `{ ambito: "globale" }` (per le due chiamate su più righe in `featureFlags.ts:58` e `driveBackup.ts:89` l'argomento va dopo la callback). Il seed:

```ts
const _appStore = persistedStore<AppWhatsApp>("whatsapp_app", (items, meta) => {
  if (items.length === 0 && meta.firstBoot) {
    // Il tenant nuovo semina sulla sua sede predefinita; il tenant 1 sulla sede storica.
    const sedeId = meta.tenantId == null ? DEFAULT_SEDE_ID : sedePredefinita(meta.tenantId);
    if (sedeId != null) items.push(appVuota(sedeId, _appStore.prossimoId()));
  }
  // … il resto invariato
});
```

`_appStore` è già definita quando `onLoad` gira (al boot, non all'import). Import di `sedePredefinita` da `../routers/sedi` (già importato `DEFAULT_SEDE_ID` da lì).

- [ ] **Step 5: Test e check** — `pnpm vitest run server/_core/storeGlobali.test.ts server/comunicazioni/whatsapp.test.ts server/tenants && pnpm check` → PASS.

- [ ] **Step 6: Commit**

```bash
git add -A server
git commit -m "feat(persistence): i sette store globali dichiarano l'ambito; il seed WhatsApp semina sulla sede del tenant"
```

---

### Task 6: Ordine di boot, resolver, tenant a caldo in `servizio.crea`

**Files:**
- Modify: `server/tenants/boot.ts`, `server/_core/index.ts:38-46`, `server/tenants/servizio.ts:56-140` (`crea`), `server/tenants/contestoCorrente.ts` (auto-registrazione del resolver).
- Test: `server/tenants/boot.test.ts`, `server/tenants/servizio.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  // server/tenants/boot.ts
  export async function preparaTenants(): Promise<number[]>; // schema + cache (+ seed tenant 1 se acceso); id da istanziare
  export async function completaTenants(): Promise<void>;    // backfill utenti/sedi, proprietario di ripiego, comandi, ciclo
  export function fermaTenants(): void;                       // invariata
  ```
  `avviaTenants()` resta come `await completaTenants()` dopo `preparaTenants()` per i test esistenti, marcata deprecata.

- [ ] **Step 1: Test che falliscono**

`boot.test.ts` (estendere): «`preparaTenants` restituisce `[1]` a interruttore spento e tutti i tenant in cache (anche sospesi) acceso»; «`completaTenants` non tocca lo schema (spia su `ensureSchema` del repository: chiamato solo da `preparaTenants`)».

`servizio.test.ts` (estendere): «`crea` di un tenant nuovo istanzia i suoi store: dopo `crea`, `storeDi(tenant.id, "clienti")` è `[]` e `tenantsNoti()` lo contiene»; «se `istanziaStoresPerTenant` fallisce (mock che lancia), la sede e l'utente creati in questo giro vengono tolti e il tenant resta» (stesso stile del test già presente sul commit fallito).

- [ ] **Step 2: Eseguire e vedere fallire.**

- [ ] **Step 3: Implementare**

`contestoCorrente.ts`, in coda al modulo: `impostaResolverTenant(tenantCorrente);` (import da `../_core/persistence`; direzione ammessa). `index.ts` lo ripete esplicitamente per leggibilità.

`boot.ts`:
```ts
export async function preparaTenants(): Promise<number[]> {
  const repo = getTenantRepository();
  await repo.ensureSchema();
  await repo.caricaCache();
  if (!interruttoreAttivo("multiAzienda")) return [TENANT_PREDEFINITO_ID];
  await assicuraTenantPredefinito();
  return repo.tutti().map(t => t.id); // anche i sospesi: leggibili
}

export async function completaTenants(): Promise<void> {
  const repo = getTenantRepository();
  if (!interruttoreAttivo("multiAzienda")) {
    const attesa = await repo.comandiInAttesa();
    console.log(`[tenants] FLAG_MULTI_AZIENDA spento: contesto mono-azienda` + (attesa.length ? `, ${attesa.length} comandi in attesa non eseguiti` : ""));
    return;
  }
  riferisci(await eseguiComandiInAttesa());
  fermaTenants();
  intervallo = setInterval(() => { eseguiComandiInAttesa().then(riferisci).catch(e => console.error("[tenants] ciclo comandi:", e)); }, INTERVALLO_COMANDI_MS);
  intervallo.unref();
}
```
Attenzione: `assicuraTenantPredefinito()` oggi fa anche il backfill di utenti/sedi e il proprietario di ripiego (leggere `servizio.ts`): quelle parti leggono gli store globali, che in `preparaTenants` NON sono ancora caricati. Separare: `preparaTenants` chiama solo la parte di control plane (seed della riga `tenants`, `repo.assicuraTenantPredefinito()`), `completaTenants` chiama la parte sugli store (`assicuraTenantPredefinito()` del servizio, rinominata se serve in `allineaTenantPredefinito()`).

`index.ts`:
```ts
  const { impostaResolverTenant } = await import("./persistence");
  const { tenantCorrente } = await import("../tenants/contestoCorrente");
  impostaResolverTenant(tenantCorrente);
  const { preparaTenants, completaTenants } = await import("../tenants/boot");
  const tenantIds = await preparaTenants();
  // `backfill: true` solo qui: il server timbra `tenantId` sui record e risalva;
  // gli script chiamano bootstrapAll() senza opzioni e non scrivono mai (Ruling R6).
  await bootstrapAll({ tenantIds, backfill: true });
  await completaTenants();
```

`servizio.crea`, dentro la transazione, subito dopo aver determinato `sedeId` e prima di `creaUtenteInterno`: `await istanziaStoresPerTenant(tenantId);` (idempotente: se il tenant è già noto non fa nulla). Il `catch` esistente già toglie sede e utente.

- [ ] **Step 4: Test e boot locale**

Run: `pnpm vitest run server/tenants server/_core/persistence.tenant.test.ts && pnpm check`
Poi un boot locale senza database (`pnpm dev` per 20 secondi, o `NODE_ENV=development tsx server/_core/index.ts` se il repo lo permette): nel log `[persistence] tenant 1: … store` e nessun errore `[persistence]`. Con `DATABASE_URL` del Docker di prova: idem, e `SELECT key FROM kv_store` mostra solo chiavi legacy (un solo tenant).

- [ ] **Step 5: Commit**

```bash
git add -A server
git commit -m "feat(tenant): boot in tre tempi (control plane, store per tenant, completamento); tenant creato a caldo con i suoi store"
```

---

### Task 7: Guardia unica `motivoRifiutoTenant`; via la porta chiusa

**Files:**
- Modify: `server/tenants/regole.ts` (via `portaChiusaPerTenant`, nuova `motivoRifiutoTenant`), `server/_core/trpc.ts:49-74`, `server/routers.ts:53-151` (login), `server/tenants/confine.test.ts` (test della porta chiusa), `server/tenants/costanti.ts` (nessun messaggio nuovo).
- Test: `server/tenants/regole.test.ts`, `server/_core/guardieTenant.test.ts`, `server/routers/utenti.tenant.test.ts` o il test del login esistente.

**Interfaces:**
- Produces (spec §5.2):
  ```ts
  export type Rifiuto = { codice: "PRECONDITION_FAILED"; messaggio: string };
  export function motivoRifiutoTenant(
    ctx: { tenantId: number | null; tenant: TenantRecord | null; sedeId: number | null },
    op: { scrittura: boolean; esente?: boolean }
  ): Rifiuto | null;
  ```

- [ ] **Step 1: Test che falliscono**

`regole.test.ts`:
```ts
describe("motivoRifiutoTenant", () => {
  const attivo = { id: 2, slug: "acme", nome: "Acme", stato: "attivo", motivoStato: null, createdAt: new Date(), updatedAt: new Date() } as TenantRecord;
  const sospeso = { ...attivo, stato: "sospeso" } as TenantRecord;
  beforeEach(() => { delete process.env.FLAG_MULTI_AZIENDA; });
  afterEach(() => { delete process.env.FLAG_MULTI_AZIENDA; });
  it("interruttore spento: mai un rifiuto", () => {
    process.env.FLAG_MULTI_AZIENDA = "off";
    expect(motivoRifiutoTenant({ tenantId: 2, tenant: sospeso, sedeId: null }, { scrittura: true })).toBeNull();
  });
  it("tenant 2 attivo con sede: passa in lettura e scrittura (la porta chiusa non esiste più)", () => {
    expect(motivoRifiutoTenant({ tenantId: 2, tenant: attivo, sedeId: 5 }, { scrittura: true })).toBeNull();
  });
  it("sospeso: scrittura rifiutata, lettura e sedi.switch (esente) ammesse", () => {
    expect(motivoRifiutoTenant({ tenantId: 2, tenant: sospeso, sedeId: 5 }, { scrittura: true })?.messaggio).toBe(MESSAGGI.solaLettura);
    expect(motivoRifiutoTenant({ tenantId: 2, tenant: sospeso, sedeId: 5 }, { scrittura: false })).toBeNull();
    expect(motivoRifiutoTenant({ tenantId: 2, tenant: sospeso, sedeId: 5 }, { scrittura: true, esente: true })).toBeNull();
  });
  it("senza sede attiva: rifiuto, anche in lettura", () => {
    expect(motivoRifiutoTenant({ tenantId: 2, tenant: attivo, sedeId: null }, { scrittura: false })?.messaggio).toBe(MESSAGGI.senzaSede);
  });
  it("tenant nullo nel contesto (test a mano) senza record: nessun rifiuto, come nel WS1", () => {
    expect(motivoRifiutoTenant({ tenantId: 1, tenant: null, sedeId: 1 }, { scrittura: true })).toBeNull();
  });
});
```

`guardieTenant.test.ts`: sostituire i casi «porta chiusa» con «il tenant 2 passa» e aggiungere «dentro una procedura protetta `tenantCorrente()` è il tenant del contesto» (router di prova con una query che restituisce `tenantCorrente()`, `modalitaTenantStretta(true)` nel test).

`confine.test.ts`: il test «portaChiusaPerTenant ha esattamente due chiamanti» diventa «`portaChiusaPerTenant` non compare più in `server/`».

Login: nel test esistente del login con tenant (cercare `portaChiusa` nei test di `routers`), il caso «tenant 2 rifiutato» diventa «tenant 2 entra».

- [ ] **Step 2: Eseguire e vedere fallire.**

- [ ] **Step 3: Implementare**

`regole.ts`:
```ts
import { interruttoreAttivo } from "../platform/interruttori";
import { MESSAGGI, RUOLO_PROPRIETARIO, SLUG_RE } from "./costanti";
import type { TenantRecord } from "./tipi";

export type Rifiuto = { codice: "PRECONDITION_FAILED"; messaggio: string };

/** Guardia unica di tRPC ed Express (spec WS2 §5.2). Pura: legge solo l'interruttore. */
export function motivoRifiutoTenant(
  ctx: { tenantId: number | null; tenant: TenantRecord | null; sedeId: number | null },
  op: { scrittura: boolean; esente?: boolean }
): Rifiuto | null {
  if (!interruttoreAttivo("multiAzienda")) return null;
  if (!ctx.tenant) return null; // contesto senza record (test a mano): nessuna guardia, come nel WS1
  if (op.scrittura && !op.esente && ctx.tenant.stato === "sospeso") {
    return { codice: "PRECONDITION_FAILED", messaggio: MESSAGGI.solaLettura };
  }
  if (ctx.sedeId == null) return { codice: "PRECONDITION_FAILED", messaggio: MESSAGGI.senzaSede };
  return null;
}
```
Togliere `portaChiusaPerTenant` e l'import di `TENANT_PREDEFINITO_ID` se non più usato.

`trpc.ts`:
```ts
const guardiaTenant = t.middleware(async ({ ctx, next, type, path }) => {
  const rifiuto = motivoRifiutoTenant(ctx, { scrittura: type === "mutation", esente: path === "sedi.switch" });
  if (rifiuto) throw new TRPCError({ code: rifiuto.codice, message: rifiuto.messaggio });
  // Il tenant nel contesto per tutta la procedura: gli store lo leggono da qui.
  return conTenant(ctx.tenantId ?? TENANT_PREDEFINITO_ID, () => next());
});
```
Aggiornare il commento sopra (niente più porta chiusa). `routers.ts`: rimuovere il blocco `if (interruttoreAttivo("multiAzienda") && portaChiusaPerTenant(tenantUtente)) {…}` e gli import inutilizzati (`portaChiusaPerTenant`; `MESSAGGI`/`TENANT_PREDEFINITO_ID`/`interruttoreAttivo` solo se non usati altrove nel file).

- [ ] **Step 4: Test e check** — `pnpm vitest run server/tenants server/_core/guardieTenant.test.ts server/routers && pnpm check` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A server
git commit -m "feat(tenant): guardia unica motivoRifiutoTenant, tenant nel contesto di ogni procedura protetta, porta chiusa rimossa"
```

---

### Task 8: Rotte Express e SSE dentro il contesto del tenant

**Files:**
- Create: `server/tenants/express.ts`
- Modify: `server/_core/commessaFileRoutes.ts:114-122` (upload, middleware) e `:199-203` (download), `server/_core/anteprimaRoutes.ts:46-50`, `server/_core/allegatoMailRoutes.ts:55-59`, `server/notifications/sse.ts:128-132`.
- Test: `server/tenants/express.test.ts` (nuovo), `server/_core/anteprimaRoutes.test.ts`, `server/_core/allegatoMailRoutes.test.ts`, `server/notifications/sse.test.ts` (estendere), `server/_core/commessaFileRoutes.tenant.test.ts` (nuovo).

**Interfaces:**
```ts
// server/tenants/express.ts
export function rifiutaTenant(res: Response, ctx: { tenantId: number | null; tenant: TenantRecord | null; sedeId: number | null }, op: { scrittura: boolean }): boolean;
export function conTenantDelContesto<T>(ctx: { tenantId: number | null }, fn: () => T): T; // conTenant(ctx.tenantId ?? 1, fn)
```

- [ ] **Step 1: Test che falliscono**

`express.test.ts`: con `res` finto (`status().json()`), tenant sospeso + `scrittura: true` → `412` e `{ error: MESSAGGI.solaLettura }`, ritorna `true`; tenant attivo → `false` e nessuna risposta.

Nei test delle rotte (già presenti: hanno un modo per iniettare il contesto — `sse.ts` accetta `options.createContext`; per le altre vedere come i test esistenti costruiscono `createContext`, di solito con `vi.mock("./context")`): un caso «tenant sospeso: upload/download rifiutato con 412 e messaggio» e un caso «dentro il gestore `tenantCorrente()` è il tenant del contesto» (`modalitaTenantStretta(true)`; spia dentro una dipendenza mockata, per esempio `getDocumentoCommessaById`). Per `commessaFileRoutes` non c'è un test: crearne uno minimo sul middleware di upload (chiama `next()` dentro `conTenant`: dentro `next` la spia legge `tenantCorrente()`).

- [ ] **Step 2: Eseguire e vedere fallire.**

- [ ] **Step 3: Implementare**

```ts
// server/tenants/express.ts
import type { Response } from "express";
import { TENANT_PREDEFINITO_ID } from "./costanti";
import { conTenant } from "./contestoCorrente";
import { motivoRifiutoTenant } from "./regole";
import type { TenantRecord } from "./tipi";

type Ctx = { tenantId: number | null; tenant: TenantRecord | null; sedeId: number | null };

/** Stessa guardia di tRPC per le rotte Express: 412 con lo stesso messaggio. */
export function rifiutaTenant(res: Response, ctx: Ctx, op: { scrittura: boolean }): boolean {
  const rifiuto = motivoRifiutoTenant(ctx, op);
  if (!rifiuto) return false;
  res.status(412).json({ error: rifiuto.messaggio });
  return true;
}

export function conTenantDelContesto<T>(ctx: { tenantId: number | null }, fn: () => T): T {
  return conTenant(ctx.tenantId ?? TENANT_PREDEFINITO_ID, fn);
}
```

Nelle rotte, subito dopo il controllo `!context.user || context.sedeId == null`:
- upload (middleware): `if (rifiutaTenant(res, context, { scrittura: true })) return; res.locals.commessaUploadContext = context; return conTenantDelContesto(context, () => next());` (il resto della catena — multer e il gestore — gira dentro il contesto: `next()` è sincrono e i callback che crea ereditano l'ALS);
- download, anteprima, allegato: `if (rifiutaTenant(res, context, { scrittura: false })) return; await conTenantDelContesto(context, async () => { …resto del gestore… });`
- SSE: `if (rifiutaTenant(res, context, { scrittura: false })) return;` e il corpo dentro `conTenantDelContesto`. Il ponte Postgres (`startNotificationPgBridge`) non tocca store: invariato.

- [ ] **Step 4: Test e check** — `pnpm vitest run server/tenants/express.test.ts server/_core/anteprimaRoutes.test.ts server/_core/allegatoMailRoutes.test.ts server/notifications/sse.test.ts server/_core/commessaFileRoutes.tenant.test.ts && pnpm check`.

- [ ] **Step 5: Commit**

```bash
git add -A server
git commit -m "feat(tenant): rotte Express e SSE con la guardia del tenant (412) e il tenant nel contesto"
```

---

### Task 9: Worker Tars per tenant (smistamento, analisi, follow-up, conferme)

**Files:**
- Modify: `server/tars/smistamento/worker.ts:551-560`, `server/tars/analisi/worker.ts:55` e `:166`, `server/tars/followup/worker.ts:18-34`, `server/tars/documenti/confermeAutoArchivio.ts:241-250`.
- Test: `server/tars/smistamento/worker.test.ts`, `server/tars/documenti/confermeAutoArchivio.test.ts` (estendere), `server/tars/analisi/worker.tenant.test.ts`, `server/tars/followup/worker.tenant.test.ts` (nuovi).

**Interfaces:** consuma `perOgniTenantAttivo`, `tenantCorrente`, `modalitaTenantStretta` (Task 1), `sediAttiveDelTenant`/`sediDelTenant` (`server/routers/sedi.ts`).

- [ ] **Step 1: Test che falliscono (stesso schema per i quattro)**

```ts
// esempio: server/tars/followup/worker.tenant.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { modalitaTenantStretta, tenantCorrente } from "../../tenants/contestoCorrente";
import { getTenantRepository, resetTenantRepositoryForTesting } from "../../tenants/repository";
import { getSediStore } from "../../routers/sedi";
const visti: Array<{ sedeId: number; tenant: number | null }> = [];
vi.mock("./solleciti", () => ({
  giroSollecitiPreventivi: vi.fn(async ({ sedeId }: { sedeId: number }) => {
    visti.push({ sedeId, tenant: tenantCorrente() });
    if (sedeId === 20) throw new Error("boom");
    return { creati: 0, errori: 0 };
  }),
}));
import { giroFollowup } from "./worker";

describe("follow-up per tenant", () => {
  beforeEach(async () => {
    delete process.env.FLAG_MULTI_AZIENDA;
    modalitaTenantStretta(true);
    resetTenantRepositoryForTesting();
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "RG" });
    await repo.inserisci({ id: 2, slug: "acme", nome: "Acme" });
    getSediStore().push({ id: 10, tenantId: 1, nome: "A", attiva: true } as any, { id: 20, tenantId: 2, nome: "B", attiva: true } as any, { id: 21, tenantId: 2, nome: "C", attiva: true } as any);
    visti.length = 0;
  });
  afterEach(() => modalitaTenantStretta(false));
  it("ogni sede gira nel contesto del suo tenant e un errore non ferma le altre", async () => {
    await giroFollowup(new Date("2026-09-07T10:00:00+02:00"));
    expect(visti).toEqual([{ sedeId: 10, tenant: 1 }, { sedeId: 20, tenant: 2 }, { sedeId: 21, tenant: 2 }]);
  });
});
```
(Il modulo da mockare è quello che il worker chiama per sede: leggere l'import nel file; per `smistamento` è `eseguiGiroSmistamento`, per l'analisi `generaAnalisiAzienda`/`deps`, per le conferme `eseguiGiroAutoArchivio`.)

- [ ] **Step 2: Eseguire e vedere fallire** (senza contesto, `tenantCorrente()` è `null` in modalità stretta).

- [ ] **Step 3: Implementare — forma comune**

```ts
async function giroTutteLeSedi(): Promise<void> {
  if (!smistamentoAttivo()) return;
  await perOgniTenantAttivo("tars-smistamento", async tenantId => {
    for (const sede of sediAttiveDelTenant(tenantId)) {
      if (inCorso.has(sede.id)) continue;
      inCorso.add(sede.id);
      try { /* corpo invariato */ } finally { inCorso.delete(sede.id); }
    }
  });
}
```
- `followup/worker.ts`: `for (const sede of getSediStore())` → `perOgniTenantAttivo("tars-followup", async t => { for (const sede of sediDelTenant(t)) { …try/catch invariato… } })` (oggi gira anche sulle sedi non attive: mantenere `sediDelTenant`).
- `confermeAutoArchivio.ts`: come lo smistamento (`sediAttiveDelTenant`).
- `analisi/worker.ts`: `deps.sedi` diventa `() => sediAttiveDelTenant(tenantCorrente() ?? TENANT_PREDEFINITO_ID).map(s => s.id)` e il tick chiama `perOgniTenantAttivo("tars-analisi", () => eseguiGiroAnalisi(deps))` (nome della funzione di giro: quello reale del file). Con interruttore spento tutto equivale a oggi (`tenantsAttivi() === [1]`, `tenantCorrente() === 1`).

- [ ] **Step 4: Test e check** — i quattro test più `pnpm vitest run server/tars && pnpm check`.

- [ ] **Step 5: Commit**

```bash
git add -A server
git commit -m "feat(tars): i worker di smistamento, analisi, follow-up e conferme girano per tenant, ognuno nel suo contesto"
```

---

### Task 10: Worker operativi per tenant (action center, costo da conferma, sonda, FiC, promemoria, eventi, IMAP, backup)

**Files:**
- Modify: `server/actionCenter/scheduler.ts:104-108`, `server/commesse/costoDaConfermaWorker.ts:143-156` (`giro`), `server/fatture/sonda.ts:185-215` (`giroSonda`, ciclo per sede), `server/routers/fattureInCloud.ts:1106-1129` (`startFicScheduler`), `server/reminders/worker.ts:30-80` (ciclo per promemoria), `server/events/worker.ts:50` (`consumer.handle(event)`), `server/comunicazioni/imap.ts:487` (`sincronizzaTutte`), `:509-540` (`avviaWatcher`), `:565` (`riavviaWatchers`), `:578-600` (`avviaPollerMail`), `server/_core/driveBackup.ts:793-810` (`snapshotByKey`) e `:835-1016` (`buildBackupTree`).
- Test: estendere `server/events/worker.test.ts`, `server/reminders/worker.test.ts`, `server/fatture/sonda.test.ts`, `server/_core/driveBackup.test.ts`; nuovi `server/actionCenter/scheduler.tenant.test.ts`, `server/commesse/costoDaConfermaWorker.tenant.test.ts`, `server/routers/fattureInCloud.scheduler.test.ts`, `server/comunicazioni/imap.tenant.test.ts`.

**Interfaces:** consuma `perOgniTenantAttivo`, `conTenantDellaSede`, `tenantCorrente`, `modalitaTenantStretta` (Task 1), `chiaveStore` (Task 2), `sediAttiveDelTenant`/`sediDelTenant` (`server/routers/sedi.ts`), `tenantIdDellaSede` (`server/tenants/contesto.ts`).

- [ ] **Step 1: Test che falliscono (uno per punto d'ingresso, stile del Task 9)**

Per ciascuno: `modalitaTenantStretta(true)`, repository con i tenant 1 e 2, sedi 10 (t1) e 20 (t2) nello store `sedi`, la funzione «per unità di lavoro» mockata registra `tenantCorrente()`; atteso: il tenant della sede/dell'evento/del promemoria, e un errore su una unità non ferma le altre. Per IMAP: due caselle (sede 10 e sede 20) nello store `caselle_email` di ciascun tenant (`storeDi(2, "caselle_email").push(...)`), `sincronizzaCasella` mockata registra il tenant; il giro del poller le visita entrambe. Per il backup: `buildBackupTree` con una sede del tenant 2 e una commessa in `storeDi(2, "commesse")` → la cartella «Sede …» del tenant 2 contiene la sua commessa e quella del tenant 1 no.

- [ ] **Step 2: Eseguire e vedere fallire.**

- [ ] **Step 3: Implementare, punto per punto**

- `scheduler.ts`:
  ```ts
  function reconcileAllSites(): void {
    void perOgniTenantAttivo("action-center", async tenantId => {
      for (const sede of sediAttiveDelTenant(tenantId)) void runActionReconcile(sede.id);
    });
  }
  ```
  (le promise avviate dentro `conTenant` ereditano il contesto anche senza `await`).
- `costoDaConfermaWorker.ts`, in `giro()`: la chiamata a `eseguiGiroCostiDaConferma()` diventa `await perOgniTenantAttivo("costo-da-conferma", () => eseguiGiroCostiDaConferma().then(() => undefined))`; `documentiDaLeggere()` legge gli store del tenant corrente da sé.
- `sonda.ts`, `giroSonda`: le righe arrivano da SQL già raggruppate per sede; il corpo di `for (const [sedeId, righeSede] of perSede)` va dentro `await conTenantDellaSede(sedeId, async () => { … })` (il `try/catch` per sede resta).
- `fattureInCloud.ts`: estrarre il corpo del `setInterval` in `export async function giroFic(): Promise<void>` che fa `await perOgniTenantAttivo("fic", async tenantId => { for (const sedeId of sediDelTenant(tenantId).map(s => s.id)) { …corpo invariato… } })`; lo scheduler chiama `void giroFic()`.
- `reminders/worker.ts`: il corpo di `for (const reminder of pending)` dentro `await conTenantDellaSede(reminder.sedeId, async () => { … })`.
- `events/worker.ts:50`: `await conTenantDellaSede(event.sedeId, () => consumer.handle(event));` (se `event.sedeId` può mancare, `TENANT_PREDEFINITO_ID` con un `console.warn` una volta).
- `imap.ts`: (a) `avviaPollerMail` → il `giro` diventa `await perOgniTenantAttivo("imap", async () => { const attive = caselle.filter(c => c.attiva); if (attive.length === 0) return; const esiti = await sincronizzaTutte(); … })`; (b) `riavviaWatchers()` scorre le caselle di ogni tenant: `await perOgniTenantAttivo("imap-watcher", async () => { for (const casella of caselle.filter(c => c.attiva)) avviaOAggiorna(casella); })` con la `Map` dei watcher per `casella.id` (id globali); (c) dentro `avviaWatcher(casella)`, i callback del client (`client.on("exists", () => syncPresto())` e il ciclo di riconnessione) chiamano `conTenantDellaSede(casella.sedeId, () => syncPresto())`: il confine con la libreria IMAP perde il contesto, qui lo si rimette.
- `driveBackup.ts`: `snapshotByKey()` invariato (tutte le chiavi). In `buildBackupTree` sostituire le letture `stores["commesse"]` (e le altre per tenant: `preventivi_documenti`, `tickets`, `ticket_allegati`, `interventi`, `garanzie`, …) con `const di = (sede: { id: number }, nome: string): any[] => stores[chiaveStore(tenantIdDellaSede(sede.id), nome)] ?? [];` usato dentro il ciclo per sede; `sedi` e `utenti` restano globali. Il corpo del ciclo per sede dentro `await conTenantDellaSede(sede.id, async () => { … })` (se chiama funzioni di modulo che leggono store). I file JSON del backup (uno per chiave) includono già `tenant:n:*`.

- [ ] **Step 4: Test e check** — `pnpm vitest run server/actionCenter server/commesse server/fatture server/reminders server/events server/comunicazioni server/_core/driveBackup.test.ts server/routers/fattureInCloud.scheduler.test.ts && pnpm check`.

- [ ] **Step 5: Commit**

```bash
git add -A server
git commit -m "feat(tenant): action center, costo da conferma, sonda, FiC, promemoria, eventi, IMAP e backup girano per tenant nel loro contesto"
```

---

### Task 11: Cintura di sicurezza in `eseguiRun` (Tars)

**Files:**
- Modify: `server/tars/orchestratore.ts:360`
- Test: `server/tars/contesto.tenant.test.ts` (estendere) o `server/tars/orchestratore.test.ts`.

- [ ] **Step 1: Test che fallisce** — con `modalitaTenantStretta(true)`, un provider finto che invoca uno strumento di prova il quale registra `tenantCorrente()`; `eseguiRun({ contesto: { …, tenantId: 2 }, … })` chiamato FUORI da `conTenant` → lo strumento vede `2`.

- [ ] **Step 2: Vedere fallire** (`null`).

- [ ] **Step 3: Implementare** — rinominare l'attuale funzione in `async function eseguiRunNelContesto(input)` (non esportata) e aggiungere:
  ```ts
  /** Cintura (spec WS2 §5.4): il run gira sempre nel contesto del suo tenant, chiunque lo chiami. */
  export async function eseguiRun(input: Parameters<typeof eseguiRunNelContesto>[0]): Promise<RispostaRun> {
    return conTenant(input.contesto.tenantId, () => eseguiRunNelContesto(input));
  }
  ```

- [ ] **Step 4: Test** — `pnpm vitest run server/tars && pnpm check`.

- [ ] **Step 5: Commit** — `git commit -m "feat(tars): eseguiRun gira sempre nel contesto del tenant del run"`.

---

### Task 12: Specchio `tenant_sedi`, colonna `tenant_id` con trigger, backfill al boot

**Files:**
- Create: `server/tenants/tabelle.ts`, `server/tenants/tabelle.test.ts` (strutturale), `server/tenants/tabelle.pg.test.ts`
- Modify: `server/tenants/repository.ts` (DDL `tenant_sedi`, metodi `sincronizzaTenantSedi`, `tenantSedi`), `server/tenants/regole.ts` (`righeTenantSedi`), `server/tenants/servizio.ts` (`crea`: sincronizzazione dopo il commit), `server/routers/sedi.ts:189-190` (`create`: sincronizzazione dopo il salvataggio), `server/tenants/boot.ts` (`completaTenants` sincronizza; nuova `applicaSchemaTabelleTenant`), `server/_core/index.ts` (chiamata dopo il blocco degli `ensureSchema()` espliciti, prima di `avviaSondaLoop`).
- Test: `server/tenants/repository.pg.test.ts`, `server/tenants/regole.test.ts`, `server/tenants/boot.test.ts` (estendere).

**Interfaces:**
```ts
// repository.ts (aggiunte a TenantRepository)
sincronizzaTenantSedi(righe: ReadonlyArray<{ sedeId: number; tenantId: number }>): Promise<void>;
tenantSedi(): Promise<Array<{ sedeId: number; tenantId: number }>>;
// regole.ts
export function righeTenantSedi(sedi: ReadonlyArray<{ id: number; tenantId?: number | null }>): Array<{ sedeId: number; tenantId: number }>; // tenantId mancante → 1
// tabelle.ts
export const TABELLE_PER_SEDE: readonly string[];
export type EsitoTabelle = { applicate: string[]; assenti: string[]; backfill: Record<string, number> };
export async function applicaTenantIdAlleTabelle(sql: NonNullable<typeof kvSql>): Promise<EsitoTabelle>;
// boot.ts
export async function applicaSchemaTabelleTenant(): Promise<EsitoTabelle | null>; // null senza database
```

- [ ] **Step 1: Test che falliscono**

`tabelle.test.ts` (strutturale, stesso stile di `confine.test.ts`):
```ts
const inventario = new Set<string>();
for (const f of fileSorgente(["server"]).filter(f => !/\.test\.ts$/.test(f))) {
  const s = readFileSync(f, "utf8");
  for (const m of s.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_]+)\s*\(([\s\S]*?)\)\s*`/g)) if (/\bsede_id\b/.test(m[2])) inventario.add(m[1]);
}
it("TABELLE_PER_SEDE coincide con le tabelle che hanno sede_id nei sorgenti", () => {
  expect([...TABELLE_PER_SEDE].sort()).toEqual([...inventario].sort());
});
it("sono 33 il 07/09/2026: chi ne aggiunge una aggiorna la costante e la spec", () => expect(TABELLE_PER_SEDE).toHaveLength(33));
```

`tabelle.pg.test.ts` (Postgres vero; crea una tabella minima con il nome di una della lista se assente, poi la elimina):
```ts
it("aggiunge colonna, indice e trigger; il trigger ricava tenant_id da tenant_sedi; il backfill chiude i NULL", async () => {
  await sql`DROP TABLE IF EXISTS promemoria`;
  await sql`CREATE TABLE promemoria (id BIGSERIAL PRIMARY KEY, sede_id BIGINT NOT NULL, testo TEXT)`;
  const repo = getTenantRepository(); await repo.ensureSchema(); await repo.assicuraTenantPredefinito();
  await repo.inserisci({ slug: "acme", nome: "Acme" }); // id 2
  await repo.sincronizzaTenantSedi([{ sedeId: 1, tenantId: 1 }, { sedeId: 5, tenantId: 2 }]);
  await sql`INSERT INTO promemoria (sede_id, testo) VALUES (1, 'prima del trigger')`;
  const esito = await applicaTenantIdAlleTabelle(sql);
  expect(esito.applicate).toContain("promemoria");
  expect(esito.backfill.promemoria).toBe(1);
  await sql`INSERT INTO promemoria (sede_id, testo) VALUES (5, 'dopo il trigger')`;
  await sql`INSERT INTO promemoria (sede_id, testo) VALUES (77, 'sede ignota')`;
  const righe = await sql`SELECT sede_id, tenant_id FROM promemoria ORDER BY id`;
  expect(righe.map(r => [Number(r.sede_id), r.tenant_id == null ? null : Number(r.tenant_id)])).toEqual([[1, 1], [5, 2], [77, null]]);
  const bis = await applicaTenantIdAlleTabelle(sql); // idempotente
  expect(bis.backfill.promemoria).toBe(0);
  await sql`DROP TABLE promemoria`;
});
it("una tabella assente viene saltata e segnalata", async () => {
  const esito = await applicaTenantIdAlleTabelle(sql);
  expect(esito.assenti).toContain("tars_turni");
});
```

`repository.pg.test.ts`: `sincronizzaTenantSedi` idempotente e aggiorna il tenant di una sede (`tenantSedi()` lo riflette). `regole.test.ts`: `righeTenantSedi` mette 1 dove manca. `boot.test.ts`: `completaTenants` chiama `sincronizzaTenantSedi` con le righe dello store `sedi` anche a interruttore spento.

- [ ] **Step 2: Eseguire e vedere fallire.**

- [ ] **Step 3: Implementare**

`repository.ts` (Postgres, dentro `creaSchema`):
```sql
CREATE TABLE IF NOT EXISTS tenant_sedi (
  sede_id BIGINT PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
```
e i metodi:
```ts
async sincronizzaTenantSedi(righe) {
  await ensureSchema();
  if (righe.length === 0) return;
  await sql.begin(async tx => {
    for (const r of righe) {
      await tx`INSERT INTO tenant_sedi (sede_id, tenant_id) VALUES (${r.sedeId}, ${r.tenantId})
        ON CONFLICT (sede_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, updated_at = NOW()`;
    }
  });
},
async tenantSedi() {
  await ensureSchema();
  return (await sql`SELECT sede_id, tenant_id FROM tenant_sedi ORDER BY sede_id`).map(r => ({ sedeId: Number(r.sede_id), tenantId: Number(r.tenant_id) }));
},
```
(in memoria: una `Map<number, number>`). La sonda `verificaSchema` (`creaSchema: false`) controlla anche `tenant_sedi`.

`tabelle.ts`:
```ts
import type { kvSql } from "../_core/persistence";
export const TABELLE_PER_SEDE = ["azioni_operative", "azioni_operative_eventi", "business_events", "capability_delegations", "capability_overrides", "chat_canali", "chat_letture", "chat_messaggi", "commessa_contratti", "commessa_righe", "computi", "comunicazioni", "contratto_estrazioni", "fattura_eventi", "fatturazione_config", "fatture", "notification_preferences", "notifications", "policy_audit_diffs", "policy_change_events", "promemoria", "promemoria_eventi", "push_subscriptions", "tars_analisi_azienda", "tars_azioni_esecuzioni", "tars_cache_entries", "tars_conversazioni", "tars_costi", "tars_miglioramenti", "tars_osservazioni", "tars_run", "tars_smistamento", "tars_turni"] as const;

export async function applicaTenantIdAlleTabelle(sql: NonNullable<typeof kvSql>): Promise<EsitoTabelle> {
  const esito: EsitoTabelle = { applicate: [], assenti: [], backfill: {} };
  await sql`CREATE OR REPLACE FUNCTION tenant_id_dalla_sede() RETURNS trigger AS $$
    BEGIN
      IF NEW.tenant_id IS NULL THEN
        SELECT tenant_id INTO NEW.tenant_id FROM tenant_sedi WHERE sede_id = NEW.sede_id;
      END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql`;
  for (const t of TABELLE_PER_SEDE) {
    const presente = (await sql`SELECT to_regclass(${t}) AS r`)[0]?.r;
    if (!presente) { esito.assenti.push(t); continue; }
    const n = await sql.begin(async tx => {
      await tx.unsafe(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS tenant_id BIGINT`);
      await tx.unsafe(`CREATE INDEX IF NOT EXISTS ${t}_tenant_id_idx ON ${t} (tenant_id)`);
      await tx.unsafe(`DROP TRIGGER IF EXISTS ${t}_tenant_id ON ${t}`);
      await tx.unsafe(`CREATE TRIGGER ${t}_tenant_id BEFORE INSERT ON ${t} FOR EACH ROW EXECUTE FUNCTION tenant_id_dalla_sede()`);
      const r = await tx.unsafe(`UPDATE ${t} t SET tenant_id = s.tenant_id FROM tenant_sedi s WHERE t.tenant_id IS NULL AND t.sede_id = s.sede_id`);
      return r.count ?? 0;
    });
    esito.applicate.push(t);
    esito.backfill[t] = n;
  }
  return esito;
}
```
I nomi di tabella vengono SOLO dalla costante (mai da input): `unsafe` è ammesso qui e va commentato. Log al boot: `[tenants] tabelle: N applicate, M assenti (…), R rinviate (…), specchio K sedi` prima del `listen`, e `[tenants] backfill tenant_id: T righe in X ms (…)` dopo il `listen`.

> **Corretto in esecuzione (Ruling R14, spec §2-bis e §6.2):** lo schizzo qui sopra è superato. `applicaTenantIdAlleTabelle(sql, { soloTabelle?, lockTimeout? })` fa SOLO il DDL, con `SET LOCAL lock_timeout` per tabella (timeout → tabella in `rinviate`, riprovata al boot successivo) e una sola query per sapere quali tabelle esistono; la funzione del trigger tollera `tenant_sedi` assente. Il backfill è una funzione separata, `backfillTenantIdSulleTabelle(sql, { soloTabelle?, dimensioneLotto? })`, a lotti da 5000 righe (`ctid … LIMIT`), lanciata DOPO `server.listen` da `avviaBackfillTabelleTenant()`. L'esito del DDL è `{ applicate, assenti, rinviate, specchio }`, quello del backfill `{ totale, righe, ms }`.

`regole.ts`: `righeTenantSedi(sedi)` → `sedi.map(s => ({ sedeId: s.id, tenantId: typeof s.tenantId === "number" ? s.tenantId : TENANT_PREDEFINITO_ID }))`.

`boot.ts`: in `completaTenants`, PRIMA del ramo «interruttore spento»: `await getTenantRepository().sincronizzaTenantSedi(righeTenantSedi(getSediStore()));` (import di `getSediStore` da `../routers/sedi`); nuova `applicaSchemaTabelleTenant()`: `if (!kvSql) return null; const esito = await applicaTenantIdAlleTabelle(kvSql); console.log(…); return esito;` (in produzione un errore qui ferma l'avvio come gli altri schemi: lasciare propagare).

`index.ts`: dopo `startEventWorkers();` → `const { applicaSchemaTabelleTenant } = await import("../tenants/boot"); await applicaSchemaTabelleTenant();`.

`sedi.ts` (`create`, dopo `_store.save()`): `void getTenantRepository().sincronizzaTenantSedi(righeTenantSedi(getSediStore())).catch(e => console.error("[tenants] specchio sedi:", e));` (import di `getTenantRepository` e `righeTenantSedi`: `repository.ts` e `regole.ts` non importano `routers/sedi`, nessun ciclo nuovo). `servizio.crea`, dopo la transazione riuscita: `await repo.sincronizzaTenantSedi(righeTenantSedi(getSediStore()));`.

- [ ] **Step 4: Test (memoria + Postgres) e check.**

- [ ] **Step 5: Commit**

```bash
git add -A server
git commit -m "feat(tenant): specchio tenant_sedi, tenant_id con trigger e backfill sulle 33 tabelle per sede"
```

---

### Task 13: `pnpm tenant verifica` (sola lettura)

**Files:**
- Create: `server/tenants/verifica.ts`, `server/tenants/verifica.test.ts`
- Modify: `scripts/tenant.ts` (sottocomando `verifica [--json]`), `server/tenants/cli.ts` (nulla di nuovo nel parser: `--json` è un flag), `server/tenants/cli.test.ts` (un caso), `server/tenants/confine.test.ts` (lo script non legge `kv_store` direttamente: usa `leggiBlobDaDb`/`elencaChiaviDaDb`).

**Interfaces:**
```ts
// verifica.ts (pura)
export type RapportoStore = { chiave: string; tenantId: number; nome: string; record: number; senzaTenant: number; tenantDiscorde: number; sedeSconosciuta: number; idDoppi: number };
export type RapportoTabella = { tabella: string; presente: boolean; conColonna: boolean; righe: number; sedeSconosciuta: number; tenantNullo: number; tenantDiscorde: number };
export type Rapporto = { store: RapportoStore[]; tabelle: RapportoTabella[]; anomalie: number };
export function tenantDellaChiave(key: string): { tenantId: number; nome: string }; // "clienti" → {1,"clienti"}; "tenant:2:clienti" → {2,"clienti"}
export function verificaStore(chiave: string, record: unknown[], sedi: Map<number, number>): RapportoStore; // sedi: sedeId → tenantId
export function riassumi(store: RapportoStore[], tabelle: RapportoTabella[]): Rapporto;
export function formattaRapporto(r: Rapporto): string;
```

- [ ] **Step 1: Test che falliscono (`verifica.test.ts`)** — `tenantDellaChiave` sui due casi; `verificaStore("clienti", [...], sedi)` conta: record senza `tenantId`, con `tenantId` ≠ 1, con `sedeId` assente o non in `sedi`, id doppi; le famiglie globali (`sedi`, `utenti`, `platform_feature_flags`, `platform_feature_flag_audit`, `backup_*`) NON contano `senzaTenant`; `riassumi` somma le anomalie; `formattaRapporto` produce una tabella leggibile con i totali. `cli.test.ts`: `opzioni(["node","tenant","verifica","--json"])` → `sotto === "verifica"`, `flag.has("json")`.

- [ ] **Step 2: Vedere fallire.**

- [ ] **Step 3: Implementare** — `verifica.ts` pura come da firme (le anomalie sono `senzaTenant + tenantDiscorde + sedeSconosciuta + idDoppi` per gli store e `sedeSconosciuta + tenantNullo + tenantDiscorde` per le tabelle presenti con colonna). In `scripts/tenant.ts`, ramo `verifica` prima di `crea`:
  ```ts
  if (sotto === "verifica") {
    const sedi = new Map<number, number>();
    for (const s of (await leggiBlobDaDb("sedi")) ?? []) sedi.set(Number(s.id), typeof s.tenantId === "number" ? s.tenantId : TENANT_PREDEFINITO_ID);
    const store: RapportoStore[] = [];
    for (const chiave of await elencaChiaviDaDb()) store.push(verificaStore(chiave, (await leggiBlobDaDb(chiave)) ?? [], sedi));
    const tabelle: RapportoTabella[] = [];
    for (const t of TABELLE_PER_SEDE) {
      const presente = Boolean((await sql`SELECT to_regclass(${t}) AS r`)[0]?.r);
      if (!presente) { tabelle.push({ tabella: t, presente: false, conColonna: false, righe: 0, sedeSconosciuta: 0, tenantNullo: 0, tenantDiscorde: 0 }); continue; }
      const conColonna = (await sql`SELECT 1 FROM information_schema.columns WHERE table_name = ${t} AND column_name = 'tenant_id'`).length > 0;
      const [r] = await sql.unsafe(`SELECT COUNT(*)::int AS righe,
        COUNT(*) FILTER (WHERE s.sede_id IS NULL)::int AS sede_sconosciuta,
        ${conColonna ? "COUNT(*) FILTER (WHERE t.tenant_id IS NULL)::int" : "0"} AS tenant_nullo,
        ${conColonna ? "COUNT(*) FILTER (WHERE t.tenant_id IS NOT NULL AND s.tenant_id IS NOT NULL AND t.tenant_id <> s.tenant_id)::int" : "0"} AS tenant_discorde
        FROM ${t} t LEFT JOIN tenant_sedi s ON s.sede_id = t.sede_id`);
      tabelle.push({ tabella: t, presente, conColonna, righe: r.righe, sedeSconosciuta: r.sede_sconosciuta, tenantNullo: r.tenant_nullo, tenantDiscorde: r.tenant_discorde });
    }
    const rapporto = riassumi(store, tabelle);
    console.log(flag.has("json") ? JSON.stringify(rapporto, null, 2) : formattaRapporto(rapporto));
    return rapporto.anomalie > 0 ? 1 : 0;
  }
  ```
  Se `tenant_sedi` non esiste (control plane mai creato) la join fallisce: intercettare e segnare le tabelle come `presente` con `tenantNullo` non calcolabile e una riga di avviso; l'exit resta `0` se non ci sono altre anomalie. Nessun DDL. Aggiornare l'intestazione dello script e l'`USO`.

- [ ] **Step 4: Test, check e prova con il Docker** — `pnpm vitest run server/tenants && pnpm check`; poi `DATABASE_URL=… pnpm tenant verifica` contro il database di prova: rapporto e exit `0`.

- [ ] **Step 5: Commit** — `git commit -m "feat(tenant): pnpm tenant verifica — rapporto in sola lettura su store per tenant e tabelle per sede"`.

---

### Task 14: Test incrociati fra tenant sui router e login del tenant 2

**Files:**
- Create: `server/routers/crossTenant.test.ts`
- Modify: il test del login con tenant (cercare `portaChiusa` in `server/**/*.test.ts` dopo il Task 7; probabilmente `server/routers/utenti.tenant.test.ts` o `server/routers.tenant.test.ts`).

- [ ] **Step 1: Scrivere `crossTenant.test.ts`**

```ts
import { beforeAll, describe, expect, it } from "vitest";
import { contestoDiProva } from "../_core/contestoDiProva";
import { istanziaStoresPerTenant } from "../_core/persistence";
import { appRouter } from "../routers";
import { getSediStore } from "./sedi";
import { getTenantRepository, resetTenantRepositoryForTesting } from "../tenants/repository";
import type { TenantRecord } from "../tenants/tipi";

let t1: TenantRecord, t2: TenantRecord, sospeso: TenantRecord;
const SEDE1 = 90301, SEDE2 = 90302, SEDE3 = 90303;

beforeAll(async () => {
  delete process.env.FLAG_MULTI_AZIENDA; // acceso
  resetTenantRepositoryForTesting();
  const repo = getTenantRepository();
  t1 = await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "RG" });
  t2 = await repo.inserisci({ slug: "acme", nome: "Acme" });
  sospeso = await repo.inserisci({ slug: "ferma", nome: "Ferma", stato: "sospeso" });
  await istanziaStoresPerTenant(t2.id);
  await istanziaStoresPerTenant(sospeso.id);
  const now = new Date();
  getSediStore().push(
    { id: SEDE1, tenantId: 1, nome: "RG", citta: null, indirizzo: null, attiva: true, createdAt: now, updatedAt: now },
    { id: SEDE2, tenantId: t2.id, nome: "Acme", citta: null, indirizzo: null, attiva: true, createdAt: now, updatedAt: now },
    { id: SEDE3, tenantId: sospeso.id, nome: "Ferma", citta: null, indirizzo: null, attiva: true, createdAt: now, updatedAt: now }
  );
});

const caller = (utenteId: number, sedeId: number, tenant: TenantRecord) =>
  appRouter.createCaller(contestoDiProva({ utenteId, sedeId, tenantId: tenant.id, tenant }));

describe("isolamento fra tenant", () => {
  it("un cliente del tenant 1 non esiste per il tenant 2: lista vuota, byId nullo, mutation NOT_FOUND", async () => {
    const c = await caller(1, SEDE1, t1).clienti.create({ nome: "Mario", cognome: "Uno" });
    expect(await caller(2, SEDE2, t2).clienti.list({})).toEqual([]);
    expect(await caller(2, SEDE2, t2).clienti.byId({ id: c.id })).toBeNull();
    await expect(caller(2, SEDE2, t2).clienti.update({ id: c.id, nome: "X" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("le sedi elencate sono solo quelle del tenant", async () => {
    const sedi = await caller(2, SEDE2, t2).sedi.list();
    expect(sedi.map((s: any) => s.id)).toEqual([SEDE2]);
  });
  it("tenant sospeso: le mutation sono rifiutate, le letture no", async () => {
    await expect(caller(3, SEDE3, sospeso).clienti.create({ nome: "A", cognome: "B" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await caller(3, SEDE3, sospeso).clienti.list({})).toEqual([]);
  });
  it("tenant senza sede attiva: rifiuto anche in lettura", async () => {
    await expect(caller(2, null as any, t2).clienti.list({})).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});
```
(Adattare i nomi delle procedure — `clienti.list`, `clienti.byId`, `sedi.list` — a quelli reali di `server/routers/*.ts`, leggendo `crossSede.test.ts` per i payload minimi.)

- [ ] **Step 2: Eseguire**: deve passare già con i task 1–12 fatti; se non passa, è un difetto da correggere nel task responsabile (non nel test).

- [ ] **Step 3: Login del tenant 2** — nel test del login, il caso «tenant 2 rifiutato dalla porta chiusa» diventa «tenant 2 entra e `tenants.mio` risponde con il suo slug».

- [ ] **Step 4: Commit** — `git commit -m "test(tenant): isolamento fra tenant sui router, tenant sospeso e senza sede, login del tenant 2"`.

---

### Task 15: Documentazione, regole strutturali e chiusura

**Files:**
- Modify: `docs/superpowers/specs/2026-09-07-ws2-porta-aperta-design.md` (solo se l'esecuzione ha deviato: le precisazioni note — ripiego nei test, 23 moduli, `perOgniTenantAttivo`, ordine del boot — sono già nella spec dal 07/09), `docs/runbooks/multi-azienda.md` (sezione WS2), `documento_requisiti_infissi_ops.md` (§60.10 e versione), `handoff.md` (Novità, §3 mappa, voce 21), `CLAUDE.md` (regola del contesto implicito e degli store globali), `docs/tars/architettura-tars-v2.md` (una riga su `conTenant` in `eseguiRun`), `server/tenants/confine.test.ts` (tre guardie nuove).
- Test: `server/tenants/confine.test.ts`.

- [ ] **Step 1: Guardie strutturali** (in `confine.test.ts`): «`server/_core/persistence.ts` non importa da `../tenants/`»; «`AsyncLocalStorage` compare solo in `server/tenants/contestoCorrente.ts`»; «`storeDi(` non compare in `server/routers/` né in `server/tars/strumenti/`»; «`TENANT_PREDEFINITO` in `persistence.ts` vale `TENANT_PREDEFINITO_ID`» (import della costante nel test e confronto con la regex sul sorgente).

- [ ] **Step 2: Runbook** — sezione «WS2 — archivi per tenant»: cosa fa il boot (specchio, colonne, trigger, backfill, log attesi `[persistence] tenant 1: …`, `[tenants] tabelle: …`), `pnpm tenant verifica` prima e dopo, ordine in produzione (spec §8), regola «nessun tenant 2 in produzione prima del WS3», l'errore `[persistence] accesso allo store … senza tenant nel contesto` (che cosa significa e dove guardare), rollback = redeploy.

- [ ] **Step 3: PRD e handoff** — PRD: nuova §60.10 «Workstream 2 — porta aperta (contratto implementato su branch)» con decisioni, deviazione dalla §14.2 (alias), stato dei test, non verificato (produzione); versione `5.53`. Handoff: Novità WS2, mappa `server/tenants/` aggiornata (`contestoCorrente.ts`, `express.ts`, `tabelle.ts`, `verifica.ts`), voce 21 aggiornata con il WS2, checklist deploy.

- [ ] **Step 4: CLAUDE.md** — nella sezione Invarianti: «Ogni punto d'ingresso fuori richiesta (worker, scheduler, callback di librerie, script) dichiara il tenant con `conTenant`, `conTenantDellaSede` o `perOgniTenantAttivo`; gli store per tenant senza contesto falliscono. `storeDi` solo in migrazioni, verifica e Platform Admin. Store globali: solo i sette elencati nella spec WS2 §3.1.»

- [ ] **Step 5: Verifica finale** — `pnpm check && pnpm test && pnpm build` (baseline HEIC a parte); con Docker: `DATABASE_URL=… pnpm vitest run server/tenants server/_core/persistence.tenant.pg.test.ts`; boot locale col Docker e `pnpm tenant verifica` → exit 0.

- [ ] **Step 6: Commit** — `git commit -m "docs(tenant): WS2 porta aperta — runbook, PRD §60.10, handoff, regola del contesto implicito, guardie strutturali"`.

---

## Copertura della spec (auto-revisione del piano)

| Spec | Task |
|---|---|
| §1 perimetro, §2 decisioni | tutti; deviazione dalla §14.2 registrata nel Task 15 |
| §3.1 famiglie, chiavi, globali | 2, 5 |
| §3.2 Proxy, fail-closed, `storeDi` | 2, 6 (ripiego nei test), 15 (guardie) |
| §3.3 salvataggio e transazioni | 2 |
| §3.4 onLoad, seed, backfill | 3, 5 |
| §3.5 boot, tenant a caldo | 3, 6 |
| §3.6 registrazione tardiva | 2 (per istanza), 3 |
| §3.7 memoria (log per tenant) | 3 (log in `bootstrapAll`) |
| §3.8 snapshot | 2, 10 (backup) |
| §3.9 casi noti | 2 (`structuredClone`: ricerca nel Task 2 Step 5 se la suite lo segnala), 15 |
| §4 id globali | 4 |
| §5.1 contesto | 1, 6 |
| §5.2 guardia unica, porta chiusa | 7, 8 |
| §5.3 worker | 9, 10 |
| §5.4 Tars | 11 |
| §5.5 test | 1, 6 |
| §6 tabelle, specchio | 12 |
| §7 migrazione additiva, verifica | 3 (backfill), 13 |
| §8 interruttore e rilascio | 15 (runbook) |
| §9 errori | 2, 7, 8, 13 |
| §10 test | ogni task; incrociati nel 14 |
| §11 file | corrispondono ai task |
| §12 rischi | 15 (documentati) |

**Coerenza dei nomi fra task:** `conTenant`, `tenantCorrente`, `conTenantDellaSede`, `tenantsAttivi`, `perOgniTenantAttivo`, `modalitaTenantStretta` (1) · `chiaveStore`, `impostaResolverTenant`, `storeDi`, `tenantsNoti`, `__resetPersistenzaPerTest`, `__registraTenantNotoPerTest`, `prossimoId`, `riservaIdFinoA` (2) · `bootstrapAll({ tenantIds })`, `istanziaStoresPerTenant`, `leggiBlobDaDb`, `elencaChiaviDaDb` (3) · `preparaTenants`, `completaTenants`, `applicaSchemaTabelleTenant` (6, 12) · `motivoRifiutoTenant`, `Rifiuto` (7) · `rifiutaTenant`, `conTenantDelContesto` (8) · `sincronizzaTenantSedi`, `tenantSedi`, `righeTenantSedi`, `TABELLE_PER_SEDE`, `applicaTenantIdAlleTabelle` (12) · `tenantDellaChiave`, `verificaStore`, `riassumi`, `formattaRapporto` (13).
