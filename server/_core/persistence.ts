// KV-backed persistence for in-memory router stores.
//
// Pattern:
//   let nextId = 1;
//   const _store = persistedStore<MyType>("clienti", (items) => {
//     nextId = items.length ? Math.max(...items.map((x) => x.id)) + 1 : 1;
//   });
//   const clienti = _store.items;   // stable ref; mutate in place
//   // ...after mutation:  _store.save();
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
export type LoadMeta = { firstBoot: boolean };

type StoreEntry = {
  key: string;
  items: any[];
  onLoad?: (items: any[], meta: LoadMeta) => void;
  // false until bootstrapAll has successfully queried the DB for this key
  // (even a "no row" cold result counts as loaded). While false we refuse to
  // save — otherwise a transient DNS failure at boot would let a seed/empty
  // in-memory state overwrite real data on disk.
  loaded: boolean;
};

const registry = new Map<string, StoreEntry>();
const saveTimers = new Map<string, NodeJS.Timeout>();
const SAVE_DEBOUNCE_MS = 200;

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
};

const storeKeys = new WeakMap<object, string>();
const storeLocks = new Map<string, Promise<void>>();

// Read-only snapshot of every registered store — used by the nightly backup
// so it never needs a per-router getter. Items are the live arrays: callers
// must NOT mutate them.
export function getAllStoreSnapshots(): Array<{ key: string; items: any[] }> {
  return Array.from(registry.values()).map((e) => ({
    key: e.key,
    items: e.items,
  }));
}

export function persistedStore<T>(
  key: string,
  onLoad?: (items: T[], meta: LoadMeta) => void
): PersistedStore<T> {
  if (registry.has(key)) {
    throw new Error(`[persistence] duplicate store key: ${key}`);
  }
  const items: any[] = [];
  // loaded=true when no DB at all — lets tests / local dev save freely.
  registry.set(key, { key, items, onLoad: onLoad as any, loaded: !sql });
  const store: PersistedStore<T> = {
    items: items as T[],
    save: () => scheduleSave(key),
  };
  storeKeys.set(store, key);
  return store;
}

function risolviStoreAtomici(
  stores: readonly PersistedStore<unknown>[]
): StoreEntry[] {
  const entries = stores.map(store => {
    const key = storeKeys.get(store as object);
    const entry = key ? registry.get(key) : null;
    if (!key || !entry)
      throw new Error("[persistence] store atomico non registrato");
    if (!entry.loaded)
      throw new Error(`[persistence] store ${key} non caricato`);
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

export async function bootstrapAll() {
  if (!sql) {
    console.warn(
      "[persistence] DATABASE_URL missing — data will NOT be persisted (in-memory only)"
    );
    // No DB at all → treat as first boot so seed callbacks can populate
    // initial data locally.
    registry.forEach((store) => {
      store.onLoad?.(store.items, { firstBoot: true });
      store.loaded = true;
    });
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
      store.onLoad?.(store.items, { firstBoot: false })
    );
    // Background: keep trying so the app can recover once DNS warms up.
    void backgroundRecover();
    return;
  }

  const entries: Array<[string, StoreEntry]> = [];
  registry.forEach((store, key) => entries.push([key, store]));
  for (const [key, store] of entries) {
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
      store.onLoad?.(store.items, { firstBoot });
      store.loaded = true;
      console.log(`[persistence] loaded ${key}: ${store.items.length} items`);
    } catch (e) {
      console.error(
        `[persistence] load FAILED for ${key} after retries — keeping UNLOADED; saves for this key are blocked`,
        e
      );
      // firstBoot=false — we can't prove the DB is empty, so don't seed.
      store.onLoad?.(store.items, { firstBoot: false });
      // NOT setting loaded=true. Saves stay blocked until a background
      // recovery pass succeeds.
    }
  }

  // If any key failed to load, start a background retry so the app can
  // self-heal when DNS / network finally comes up.
  const anyUnloaded = Array.from(registry.values()).some((s) => !s.loaded);
  if (anyUnloaded) void backgroundRecover();
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
          store.onLoad?.(store.items, { firstBoot });
          store.loaded = true;
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
