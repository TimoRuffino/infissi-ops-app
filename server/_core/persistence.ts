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

const sql = DATABASE_URL
  ? postgres(DATABASE_URL, {
      max: 5,
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
  return {
    items: items as T[],
    save: () => scheduleSave(key),
  };
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
