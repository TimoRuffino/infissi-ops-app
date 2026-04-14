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
      connect_timeout: 10,
      ssl: DATABASE_URL.includes("sslmode=require") || DATABASE_URL.includes("railway")
        ? { rejectUnauthorized: false }
        : undefined,
    })
  : null;

let schemaReady = false;

async function ensureSchema() {
  if (!sql || schemaReady) return;
  await sql`CREATE TABLE IF NOT EXISTS kv_store (
    key TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  schemaReady = true;
}

type StoreEntry = {
  key: string;
  items: any[];
  onLoad?: (items: any[]) => void;
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
  onLoad?: (items: T[]) => void
): PersistedStore<T> {
  if (registry.has(key)) {
    throw new Error(`[persistence] duplicate store key: ${key}`);
  }
  const items: any[] = [];
  registry.set(key, { key, items, onLoad: onLoad as any });
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
  if (!sql) return;
  const store = registry.get(key);
  if (!store) return;
  try {
    const json = JSON.stringify(store.items);
    await sql`
      INSERT INTO kv_store (key, data, updated_at)
      VALUES (${key}, ${json}::jsonb, NOW())
      ON CONFLICT (key) DO UPDATE
        SET data = EXCLUDED.data, updated_at = NOW()
    `;
  } catch (e) {
    console.error(`[persistence] save failed for ${key}:`, e);
  }
}

export async function bootstrapAll() {
  if (!sql) {
    console.warn(
      "[persistence] DATABASE_URL missing — data will NOT be persisted (in-memory only)"
    );
    // Still trigger onLoad with empty arrays so nextId defaults are set.
    registry.forEach((store) => store.onLoad?.(store.items));
    return;
  }
  try {
    await ensureSchema();
  } catch (e) {
    console.error("[persistence] ensureSchema failed:", e);
    registry.forEach((store) => store.onLoad?.(store.items));
    return;
  }

  const entries: Array<[string, StoreEntry]> = [];
  registry.forEach((store, key) => entries.push([key, store]));
  for (const [key, store] of entries) {
    try {
      const rows = await sql`SELECT data FROM kv_store WHERE key = ${key} LIMIT 1`;
      if (rows.length > 0) {
        const raw = rows[0].data;
        // JSONB driver returns parsed JSON; re-serialize then parse with reviver
        // to restore Date objects from ISO strings.
        const restored = JSON.parse(JSON.stringify(raw), reviveDates);
        if (Array.isArray(restored)) {
          store.items.length = 0;
          store.items.push(...restored);
        }
      }
      store.onLoad?.(store.items);
      console.log(`[persistence] loaded ${key}: ${store.items.length} items`);
    } catch (e) {
      console.error(`[persistence] load failed for ${key}:`, e);
      store.onLoad?.(store.items);
    }
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
