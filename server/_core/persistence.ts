// KV-backed persistence for in-memory router stores.
//
// Pattern:
//   const _store = persistedStore<MyType>("clienti");
//   const clienti = _store.items;   // Proxy: risolve il tenant corrente a ogni chiamata
//   clienti.push({ id: _store.prossimoId(), ... });
//   // ...after mutation:  _store.save();
//
// Ogni store dichiarato è una FAMIGLIA con un'istanza per tenant: la chiave
// in kv_store è `tenant:<id>:<nome>` e il tenant 1 tiene la chiave nuda di
// sempre (alias: nessuna migrazione di dati). Una famiglia dichiarata
// `{ ambito: "globale" }` resta una sola istanza per tutta l'installazione.
// Chi sia il tenant corrente lo dice un resolver iniettato da fuori
// (impostaResolverTenant): qui non si importa server/tenants.
//
// Persists each collection as a single JSONB blob under key in kv_store.
// Debounced (200ms) to batch rapid mutations. Dates re-hydrated on load.

import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;

/**
 * Quante connessioni il processo tiene aperte verso Postgres.
 *
 * Erano cinque, e questo stesso client lo usano diciotto moduli: chat,
 * comunicazioni, notifiche, promemoria, Centro Azioni, tutti gli archivi di
 * Tars e la persistenza JSONB di ogni store. Nello stesso processo girano
 * anche i lavori di fondo — il worker eventi interroga il database ogni
 * secondo, la riconciliazione passa 188 casi al minuto, lo smistamento
 * chiama il modello dieci volte al minuto — quindi le richieste delle
 * persone si mettevano in coda dietro di loro.
 *
 * Nei log di produzione si vedeva il segno: quasi ogni procedura con lo
 * stesso pavimento di mezzo secondo, dalla più pesante alla più banale.
 * `permessi.mie` 871 ms, `notifiche.unreadCount` 831 ms, `chat.nonLetti`
 * fino a 2,3 s per una sola query aggregata. Un pavimento uguale per tutti
 * non è lavoro: è attesa.
 *
 * Venti lasciano respiro senza avvicinarsi a nessun limite ragionevole di
 * Postgres, e `idle_timeout` le richiude appena non servono. Regolabile con
 * DB_POOL_MAX senza toccare il codice.
 */
export function dimensionePool(grezzo: string | undefined): number {
  const n = Number(grezzo);
  if (!Number.isFinite(n) || n < 1) return 20;
  // Un tetto: oltre non si guadagna niente e si rischia di esaurire i posti
  // del database, che sono condivisi con le migrazioni e con psql.
  return Math.min(Math.floor(n), 50);
}

const sql = DATABASE_URL
  ? postgres(DATABASE_URL, {
      max: dimensionePool(process.env.DB_POOL_MAX),
      idle_timeout: 20,
      // Railway's internal DNS (postgres.railway.internal) can take a few
      // seconds to resolve on cold container boot. Give it room.
      connect_timeout: 30,
      ssl: DATABASE_URL.includes("sslmode=require") || DATABASE_URL.includes("railway")
        ? { rejectUnauthorized: false }
        : undefined,
    })
  : null;

// Transient network failures we should retry on. Railway's private DNS in
// particular tends to emit EAI_AGAIN during the first ~1–10s of container
// life while the internal resolver warms up.
const TRANSIENT_CODES = new Set([
  "EAI_AGAIN",
  "ENOTFOUND",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EPIPE",
]);

function isTransient(e: any): boolean {
  if (!e) return false;
  if (e.code && typeof e.code === "string" && TRANSIENT_CODES.has(e.code)) {
    return true;
  }
  // Some drivers nest the cause.
  if (e.cause) return isTransient(e.cause);
  return false;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxAttempts = 12
): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      if (!isTransient(e) || i === maxAttempts - 1) throw e;
      // Exponential backoff capped at 5s: 250, 500, 1000, 2000, 4000, 5000...
      const delay = Math.min(5000, 250 * 2 ** i);
      console.warn(
        `[persistence] ${label} transient error (${e.code ?? e.errno}), retry ${i + 1}/${maxAttempts} in ${delay}ms`
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

let schemaPromise: Promise<void> | null = null;

function ensureSchema(): Promise<void> {
  if (!sql) return Promise.resolve();
  if (!schemaPromise) {
    schemaPromise = withRetry(
      () => sql`CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`.then(() => undefined),
      "ensureSchema"
    ).catch((e) => {
      console.error("[persistence] ensureSchema failed:", e);
      // Reset so next attempt can retry from scratch.
      schemaPromise = null;
      throw e;
    });
  }
  return schemaPromise;
}

// Metadata passed to onLoad so callers can tell "no DB row yet (truly first
// boot)" apart from "DB row exists with an empty array" (user deleted all).
// Seeds should only ever run when firstBoot is true, otherwise a user's
// intentional empty state gets clobbered on every cold start.
// `tenantId` è quello dell'istanza caricata (null per le famiglie globali):
// un onLoad che semina o ricalcola sa per chi sta lavorando.
export type LoadMeta = { firstBoot: boolean; tenantId: number | null };

/** Una famiglia vive per tenant (una istanza per azienda) o una volta sola. */
export type AmbitoStore = "tenant" | "globale";

// = TENANT_PREDEFINITO_ID di server/tenants/costanti.ts. Nessun import:
// persistence non dipende da server/tenants (test strutturale in Task 15).
const TENANT_PREDEFINITO = 1;

// Una famiglia è lo store come lo dichiara il modulo («clienti»); le sue
// istanze sono gli archivi veri, uno per tenant, ognuno con la propria
// chiave in kv_store e il proprio ciclo di carico/salvataggio.
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
  // false until bootstrapAll has successfully queried the DB for this key
  // (even a "no row" cold result counts as loaded). While false we refuse to
  // save — otherwise a transient DNS failure at boot would let a seed/empty
  // in-memory state overwrite real data on disk.
  loaded: boolean;
};

const famiglie = new Map<string, Famiglia>();
const registry = new Map<string, StoreEntry>(); // per chiave, come prima
const noti = new Set<number>([TENANT_PREDEFINITO]);
const saveTimers = new Map<string, NodeJS.Timeout>();
const SAVE_DEBOUNCE_MS = 200;
// Vero dopo bootstrapAll: uno store registrato più tardi (modulo importato
// in modo dinamico) si carica da solo, altrimenti resterebbe «non caricato»
// e i suoi salvataggi sarebbero rinviati per sempre.
let bootstrapEseguito = false;
// Chi sa qual è il tenant della richiesta in corso. Lo inietta chi conosce
// il contesto (server/tenants/contestoCorrente.ts): qui non si importa.
let resolverTenant: (() => number | null) | null = null;

export function impostaResolverTenant(resolver: () => number | null): void {
  resolverTenant = resolver;
}

export function tenantsNoti(): number[] {
  return [...noti].sort((a, b) => a - b);
}

/** Il tenant 1 tiene le chiavi di sempre (alias): nessuna migrazione di dati. */
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
  // `structuredClone(proxy)` invece esplode (DataCloneError): per copiarlo
  // partire sempre da `[...items]`.
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

// Date revival for ISO-ish strings produced by JSON.stringify(new Date(...)).
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;

function reviveDates(_k: string, v: any): any {
  if (typeof v === "string" && ISO_DATE_RE.test(v)) {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
  }
  return v;
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
  // Le istanze prima della registrazione: una famiglia senza istanze nella
  // mappa sarebbe una famiglia che `istanzaCorrente` non sa risolvere.
  const nuove: StoreEntry[] = f.ambito === "globale" ? [creaIstanza(f, null)] : [...noti].map(id => creaIstanza(f, id));
  famiglie.set(nome, f);
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
  storeLocks.clear();
  famiglie.clear();
  registry.clear();
  noti.clear();
  noti.add(TENANT_PREDEFINITO);
  resolverTenant = null;
  bootstrapEseguito = false;
}
export function __registraTenantNotoPerTest(tenantId: number): void {
  if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY_TENANT_NOTO");
  registraTenantNoto(tenantId);
  for (const f of famiglie.values()) if (f.ambito === "tenant" && !f.istanze.has(tenantId)) creaIstanza(f, tenantId);
}

/**
 * Carica dal DB uno store registrato DOPO bootstrapAll. Se nel frattempo il
 * modulo ha già messo elementi in memoria, restano in coda a quelli letti:
 * meglio un doppione da riconciliare che una perdita silenziosa.
 */
async function caricaTardivo(entry: StoreEntry): Promise<void> {
  console.warn(
    `[persistence] store ${entry.key} registrato dopo il bootstrap: lo carico ora`
  );
  try {
    await ensureSchema();
  } catch {
    void backgroundRecover();
    return;
  }
  const inMemoria = entry.items.splice(0, entry.items.length);
  const caricato = await caricaEntry(entry);
  if (inMemoria.length > 0) {
    entry.items.push(...inMemoria);
    console.warn(
      `[persistence] store ${entry.key}: ${inMemoria.length} elementi scritti prima del caricamento, accodati`
    );
  }
  if (!caricato) void backgroundRecover();
}

function risolviStoreAtomici(
  stores: readonly PersistedStore<unknown>[]
): StoreEntry[] {
  const entries = stores.map(store => {
    // La famiglia dice quale istanza: quella del tenant corrente.
    const f = storeKeys.get(store as object);
    if (!f) throw new Error("[persistence] store atomico non registrato");
    const entry = istanzaCorrente(f);
    if (!entry.loaded)
      throw new Error(`[persistence] store ${entry.key} non caricato`);
    return entry;
  });
  return Array.from(
    new Map(entries.map(entry => [entry.key, entry])).values()
  ).sort((a, b) => a.key.localeCompare(b.key));
}

async function bloccaStore(chiave: string): Promise<() => void> {
  const precedente = storeLocks.get(chiave) ?? Promise.resolve();
  let rilascia!: () => void;
  const occupato = new Promise<void>(risolvi => {
    rilascia = risolvi;
  });
  const coda = precedente.then(() => occupato);
  storeLocks.set(chiave, coda);
  await precedente;
  return () => {
    rilascia();
    if (storeLocks.get(chiave) === coda) storeLocks.delete(chiave);
  };
}

async function conStoreBloccati<T>(
  chiavi: readonly string[],
  operazione: () => Promise<T>
): Promise<T> {
  const rilasci = Array<() => void>();
  try {
    for (const chiave of [...new Set(chiavi)].sort()) {
      rilasci.push(await bloccaStore(chiave));
    }
    return await operazione();
  } finally {
    for (const rilascia of rilasci.reverse()) rilascia();
  }
}

function annullaSalvataggiPendenti(entries: readonly StoreEntry[]): StoreEntry[] {
  const annullati: StoreEntry[] = [];
  for (const entry of entries) {
    const timer = saveTimers.get(entry.key);
    if (timer) {
      clearTimeout(timer);
      annullati.push(entry);
    }
    saveTimers.delete(entry.key);
  }
  return annullati;
}

function rischedulaSalvataggi(entries: readonly StoreEntry[]) {
  for (const entry of entries) scheduleSave(entry.key);
}

async function salvaEntriesAtomici(
  entries: readonly StoreEntry[]
): Promise<void> {
  if (!sql) return;
  await ensureSchema();
  // I blob vanno congelati insieme prima del BEGIN: un await fra due store
  // non può così osservare revisioni diverse degli array live. La fotografia
  // è la stringa stessa, e una passata basta: prima erano tre — stringify,
  // parse, e di nuovo stringify dentro il driver — su collezioni da qualche
  // megabyte, tutte sincrone, con il processo che nel frattempo non poteva
  // rispondere a nessuno.
  //
  // Il `::text` non è ornamentale: senza, postgres-js deduce che il
  // parametro è jsonb e codifica la stringa COME stringa JSON, e nella
  // colonna finisce `"[...]"` invece di `[...]`. È già successo (v. la
  // migrazione di riparazione in server/chat/store.ts); il contratto delle
  // due forme è fissato in server/_core/jsonbSnapshot.pg.test.ts, su
  // PostgreSQL vero.
  const payloads = entries.map(entry => ({
    key: entry.key,
    json: JSON.stringify(entry.items),
  }));
  await withRetry(
    () =>
      sql.begin(async tx => {
        for (const payloadDaSalvare of payloads) {
          await tx`
            INSERT INTO kv_store (key, data, updated_at)
            VALUES (${payloadDaSalvare.key}, ${payloadDaSalvare.json}::text::jsonb, NOW())
            ON CONFLICT (key) DO UPDATE
              SET data = EXCLUDED.data, updated_at = NOW()
          `;
        }
      }),
    `save atomico(${entries.map(entry => entry.key).join(",")})`
  );
}

/**
 * Serializza una mutation multi-store fino al suo commit o rollback.
 * L'ordine lessicografico delle chiavi evita deadlock tra insiemi sovrapposti.
 */
export async function conTransazioneStoreAtomica<T>(
  stores: readonly PersistedStore<unknown>[],
  operazione: (commit: () => Promise<void>) => Promise<T>
): Promise<T> {
  const entries = risolviStoreAtomici(stores);
  return conStoreBloccati(
    entries.map(entry => entry.key),
    async () => {
      const salvataggiSospesi = annullaSalvataggiPendenti(entries);
      let commitRiuscito = false;
      try {
        return await operazione(async () => {
          await salvaEntriesAtomici(entries);
          commitRiuscito = true;
        });
      } finally {
        // Un timer sospeso rappresenta una mutation precedente ancora dirty.
        // Il commit atomico la assorbe soltanto se ha davvero avuto successo;
        // altrimenti il debounce deve poterla ritentare dopo il rollback/gate.
        if (!commitRiuscito) rischedulaSalvataggi(salvataggiSospesi);
      }
    }
  );
}

/** Scrive più blob JSONB nella stessa transazione PostgreSQL. */
export async function saveStoresAtomically(
  stores: readonly PersistedStore<unknown>[]
): Promise<void> {
  await conTransazioneStoreAtomica(stores, commit => commit());
}

function scheduleSave(key: string) {
  if (!sql) return;
  const prev = saveTimers.get(key);
  if (prev) clearTimeout(prev);
  saveTimers.set(
    key,
    setTimeout(() => {
      saveTimers.delete(key);
      void flushSave(key);
    }, SAVE_DEBOUNCE_MS)
  );
}

async function flushSave(key: string) {
  return conStoreBloccati([key], () => flushSaveBloccato(key));
}

async function flushSaveBloccato(key: string) {
  if (!sql) {
    console.warn(`[persistence] save skipped for ${key} — no DATABASE_URL`);
    return;
  }
  const store = registry.get(key);
  if (!store) return;
  // Hard guard: refuse to write anything until bootstrap has seen the DB for
  // this key. Otherwise an EAI_AGAIN on cold boot would let the seeded /
  // empty in-memory array overwrite whatever's in DB. Re-queue instead so
  // the save survives until bootstrap completes.
  if (!store.loaded) {
    console.warn(
      `[persistence] save deferred for ${key} — bootstrap not complete yet`
    );
    setTimeout(() => scheduleSave(key), 1000);
    return;
  }
  try {
    // Guarantee schema before any write — protects against the race where a
    // module-level seed schedules a save before bootstrapAll runs ensureSchema.
    await ensureSchema();
    // Use sql.json() so postgres-js encodes as proper JSONB (not a JSON
    // string primitive). Passing a pre-stringified value + ::jsonb cast
    // double-encodes it — stored as jsonb string, not jsonb array.
    const payload = sql.json(store.items as any);
    await withRetry(
      () => sql`
        INSERT INTO kv_store (key, data, updated_at)
        VALUES (${key}, ${payload}, NOW())
        ON CONFLICT (key) DO UPDATE
          SET data = EXCLUDED.data, updated_at = NOW()
      `.then(() => undefined),
      `save(${key})`
    );
    console.log(
      `[persistence] saved ${key}: ${store.items.length} items`
    );
  } catch (e) {
    console.error(`[persistence] save FAILED for ${key}:`, e);
    // Re-queue: transient failures shouldn't permanently drop the write.
    setTimeout(() => scheduleSave(key), 2000);
  }
}

/**
 * Carica ogni istanza registrata. `tenantIds` è la lista dei tenant da
 * istanziare — la prepara chi conosce il control plane (server/tenants/boot.ts)
 * e la passa qui: `persistence.ts` non importa server/tenants. Con un tenant
 * solo il carico è identico a quello di sempre, chiave per chiave.
 */
export async function bootstrapAll(opzioni: { tenantIds?: number[] } = {}) {
  for (const id of opzioni.tenantIds ?? []) registraTenantNoto(id);
  for (const f of famiglie.values()) {
    if (f.ambito !== "tenant") continue;
    for (const id of noti) if (!f.istanze.has(id)) creaIstanza(f, id);
  }
  if (!sql) {
    console.warn(
      "[persistence] DATABASE_URL missing — data will NOT be persisted (in-memory only)"
    );
    // No DB at all → treat as first boot so seed callbacks can populate
    // initial data locally.
    registry.forEach((store) => dopoCaricamento(store, true));
    bootstrapEseguito = true;
    return;
  }
  try {
    await ensureSchema();
  } catch (e) {
    console.error(
      "[persistence] ensureSchema failed after retries — keeping stores UNLOADED; saves will be blocked to protect DB",
      e
    );
    // Don't flip loaded=true here. onLoad runs with empty arrays so nextId
    // defaults don't explode, but saves stay blocked (flushSave re-queues)
    // until a later ensureSchema succeeds. CRITICAL: firstBoot=false —
    // we don't know the DB state, so seeds must NOT run. Otherwise a
    // transient DNS failure would re-seed over real data every deploy.
    registry.forEach((store) =>
      store.onLoad?.(store.items, { firstBoot: false, tenantId: store.tenantId })
    );
    bootstrapEseguito = true;
    // Background: keep trying so the app can recover once DNS warms up.
    void backgroundRecover();
    return;
  }

  const entries: StoreEntry[] = [];
  registry.forEach((store) => entries.push(store));
  for (const store of entries) await caricaEntry(store);
  bootstrapEseguito = true;

  // If any key failed to load, start a background retry so the app can
  // self-heal when DNS / network finally comes up.
  const anyUnloaded = Array.from(registry.values()).some((s) => !s.loaded);
  if (anyUnloaded) void backgroundRecover();
}

/**
 * Dà gli archivi a un tenant nato a caldo (`tenants.servizio.crea`): un'istanza
 * per ogni famiglia per tenant, caricata dal DB (righe assenti → firstBoot →
 * seed col tenant giusto). O tutte o nessuna: se una famiglia non si carica,
 * le istanze già create spariscono e il tenant torna sconosciuto, così il
 * comando fallisce senza lasciare un tenant a metà.
 */
export async function istanziaStoresPerTenant(tenantId: number): Promise<void> {
  if (noti.has(tenantId)) return;
  registraTenantNoto(tenantId);
  const create: StoreEntry[] = [];
  try {
    for (const f of famiglie.values()) if (f.ambito === "tenant") create.push(creaIstanza(f, tenantId));
    for (const entry of create) {
      if (!sql) {
        dopoCaricamento(entry, true);
        continue;
      }
      const ok = await caricaEntry(entry);
      if (!ok) throw new Error(`[persistence] store ${entry.key} non caricato`);
    }
  } catch (e) {
    for (const entry of create) {
      registry.delete(entry.key);
      entry.famiglia.istanze.delete(tenantId);
    }
    noti.delete(tenantId);
    throw e;
  }
}

/**
 * Chiude il caricamento di un'istanza: backfill additivo di `tenantId`
 * (spec §3.4), massimo degli id per il contatore della famiglia, `onLoad` del
 * modulo, `loaded`. Il backfill tocca solo i record oggetto senza `tenantId`
 * numerico — uno già scritto non si cambia mai, nemmeno se discorda: lo conta
 * `pnpm tenant verifica`. Il risalvataggio si programma DOPO `loaded = true`
 * (altrimenti la guardia di `flushSave` lo rinvierebbe) e subito, non dietro
 * un `setTimeout(0)`: così un `flushAll()` che segue il bootstrap lo trova in
 * coda e lo scrive, invece di lasciarlo a un turno del ciclo che potrebbe
 * arrivare dopo la chiusura del processo.
 */
function dopoCaricamento(store: StoreEntry, firstBoot: boolean): void {
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
    scheduleSave(store.key);
  }
}

/** Carica un solo store dal DB (con retry). `false` = resta non caricato, salvataggi bloccati. */
async function caricaEntry(store: StoreEntry): Promise<boolean> {
  if (!sql) return false;
  const key = store.key;
  try {
    const rows = await withRetry(
      () => sql`SELECT data FROM kv_store WHERE key = ${key} LIMIT 1`,
      `load(${key})`
    );
    const firstBoot = rows.length === 0;
    if (rows.length > 0) {
      let raw = rows[0].data;
      // Legacy recovery: early versions double-encoded the payload
      // (stored as a JSONB string whose value is the JSON text of the
      // array). Detect and unwrap.
      if (typeof raw === "string") {
        try {
          raw = JSON.parse(raw);
          console.warn(
            `[persistence] load ${key}: unwrapped legacy double-encoded payload — will be rewritten on next save`
          );
          // Schedule a rewrite with the correct JSONB encoding.
          setTimeout(() => scheduleSave(key), 0);
        } catch (e) {
          console.error(
            `[persistence] load ${key}: payload is a string but not JSON:`,
            e
          );
        }
      }
      const rawType = Array.isArray(raw) ? "array" : typeof raw;
      // Re-serialize + parse with reviver to restore Date objects from ISO.
      let restored: any;
      try {
        restored = JSON.parse(JSON.stringify(raw), reviveDates);
      } catch (parseErr) {
        console.error(
          `[persistence] parse failed for ${key} (rawType=${rawType}):`,
          parseErr
        );
        restored = raw;
      }
      if (Array.isArray(restored)) {
        store.items.length = 0;
        store.items.push(...restored);
      } else {
        console.warn(
          `[persistence] load ${key}: DB row exists but data is not an array (rawType=${rawType}). Ignoring.`
        );
      }
    } else {
      console.log(`[persistence] load ${key}: no row in DB (cold)`);
    }
    dopoCaricamento(store, firstBoot);
    console.log(`[persistence] loaded ${key}: ${store.items.length} items`);
    return true;
  } catch (e) {
    console.error(
      `[persistence] load FAILED for ${key} after retries — keeping UNLOADED; saves for this key are blocked`,
      e
    );
    // firstBoot=false — we can't prove the DB is empty, so don't seed.
    store.onLoad?.(store.items, { firstBoot: false, tenantId: store.tenantId });
    // NOT setting loaded=true. Saves stay blocked until a background
    // recovery pass succeeds.
    return false;
  }
}

// Periodically retry bootstrap for stores that never loaded. Exits as soon
// as everything is loaded. Used after transient DNS failures at boot so the
// app recovers without a manual restart.
let recovering = false;
async function backgroundRecover() {
  if (recovering || !sql) return;
  recovering = true;
  try {
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise((r) => setTimeout(r, 5000));
      const pending = Array.from(registry.values()).filter((s) => !s.loaded);
      if (pending.length === 0) {
        console.log("[persistence] backgroundRecover: all stores loaded, exiting");
        return;
      }
      try {
        await ensureSchema();
      } catch {
        continue;
      }
      for (const store of pending) {
        try {
          const rows = await sql`SELECT data FROM kv_store WHERE key = ${store.key} LIMIT 1`;
          const firstBoot = rows.length === 0;
          if (rows.length > 0) {
            const raw = rows[0].data;
            const restored = JSON.parse(JSON.stringify(raw), reviveDates);
            if (Array.isArray(restored)) {
              store.items.length = 0;
              store.items.push(...restored);
            }
          }
          dopoCaricamento(store, firstBoot);
          console.log(
            `[persistence] backgroundRecover loaded ${store.key}: ${store.items.length} items`
          );
        } catch (e) {
          console.warn(
            `[persistence] backgroundRecover still failing for ${store.key} (attempt ${attempt + 1}/30)`
          );
        }
      }
    }
    const stillPending = Array.from(registry.values()).filter((s) => !s.loaded);
    if (stillPending.length > 0) {
      console.error(
        `[persistence] backgroundRecover giving up after 30 attempts; unloaded keys: ${stillPending.map((s) => s.key).join(", ")}`
      );
    }
  } finally {
    recovering = false;
  }
}

// ── Letture di sola lettura ─────────────────────────────────────────────────
// `pnpm tenant verifica` (spec §7.2) deve leggere il DATABASE, non il registro
// in memoria: contare i record di una chiave che nessuno ha istanziato è
// esattamente il suo mestiere. Nessuna scrittura, nessuno schema, nessun
// effetto sul registro.

/** Il blob di una chiave di kv_store. `null` se la riga manca o non è un array. */
export async function leggiBlobDaDb(key: string): Promise<any[] | null> {
  if (!sql) return null;
  const rows = await sql`SELECT data FROM kv_store WHERE key = ${key} LIMIT 1`;
  if (rows.length === 0) return null;
  const raw = typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : rows[0].data;
  return Array.isArray(raw) ? raw : null;
}

/** Tutte le chiavi di kv_store, in ordine: legacy e `tenant:n:*` insieme. */
export async function elencaChiaviDaDb(): Promise<string[]> {
  if (!sql) return [];
  return (await sql`SELECT key FROM kv_store ORDER BY key`).map(r => String(r.key));
}

export async function flushAll() {
  const pending = Array.from(saveTimers.keys());
  for (const key of pending) {
    const t = saveTimers.get(key);
    if (t) clearTimeout(t);
    saveTimers.delete(key);
    await flushSave(key);
  }
}

// Flush on shutdown so the final mutation isn't lost mid-debounce.
function installShutdownHandlers() {
  if (!sql) return;
  let closing = false;
  const onExit = async (sig: string) => {
    if (closing) return;
    closing = true;
    console.log(`[persistence] ${sig} received, flushing...`);
    try {
      await flushAll();
      await sql!.end({ timeout: 5 });
    } catch (e) {
      console.error("[persistence] shutdown error:", e);
    }
    process.exit(0);
  };
  process.on("SIGTERM", () => void onExit("SIGTERM"));
  process.on("SIGINT", () => void onExit("SIGINT"));
}

installShutdownHandlers();

export { sql as kvSql };
