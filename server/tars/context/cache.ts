type CacheInput<T> = {
  key: string;
  sedeId: number;
  scope: string;
  versions: string[];
  ttlMs: number;
  load: () => Promise<T>;
};

type CacheEntry = {
  value: unknown;
  expiresAt: number;
  bytes: number;
};

export type QueryCache = {
  get<T>(input: CacheInput<T>): Promise<{ value: T; hit: boolean }>;
  invalidate(input: { sedeId: number; keyPrefix?: string }): number;
  stats(sedeId: number): {
    entries: number;
    bytes: number;
    hits: number;
    misses: number;
  };
};

function compositeKey(
  input: Pick<CacheInput<unknown>, "key" | "scope" | "versions">
) {
  return `${input.scope}:${input.key}:${input.versions.slice().sort().join("|")}`;
}

function serializedBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function createQueryCache(
  options: {
    maxEntriesPerSede?: number;
    maxEntryBytes?: number;
    now?: () => number;
  } = {}
): QueryCache {
  const maxEntries = Math.max(1, options.maxEntriesPerSede ?? 200);
  const maxEntryBytes = Math.max(256, options.maxEntryBytes ?? 256 * 1024);
  const now = options.now ?? Date.now;
  const stores = new Map<number, Map<string, CacheEntry>>();
  const inflight = new Map<string, Promise<unknown>>();
  const counters = new Map<number, { hits: number; misses: number }>();

  const counter = (sedeId: number) => {
    const value = counters.get(sedeId) ?? { hits: 0, misses: 0 };
    counters.set(sedeId, value);
    return value;
  };

  return {
    async get<T>(input: CacheInput<T>) {
      const store = stores.get(input.sedeId) ?? new Map<string, CacheEntry>();
      stores.set(input.sedeId, store);
      const key = compositeKey(input);
      const existing = store.get(key);
      if (existing && existing.expiresAt > now()) {
        store.delete(key);
        store.set(key, existing);
        counter(input.sedeId).hits += 1;
        return { value: existing.value as T, hit: true };
      }
      if (existing) store.delete(key);
      counter(input.sedeId).misses += 1;

      const inflightKey = `${input.sedeId}:${key}`;
      const pending = inflight.get(inflightKey);
      if (pending) {
        counter(input.sedeId).hits += 1;
        return { value: (await pending) as T, hit: true };
      }

      const loading = input.load();
      inflight.set(inflightKey, loading);
      try {
        const value = await loading;
        const bytes = serializedBytes(value);
        if (bytes <= maxEntryBytes && input.ttlMs > 0) {
          store.set(key, {
            value,
            bytes,
            expiresAt: now() + input.ttlMs,
          });
          while (store.size > maxEntries) {
            const oldest = store.keys().next().value as string | undefined;
            if (!oldest) break;
            store.delete(oldest);
          }
        }
        return { value, hit: false };
      } finally {
        inflight.delete(inflightKey);
      }
    },

    invalidate(input) {
      const store = stores.get(input.sedeId);
      if (!store) return 0;
      let removed = 0;
      for (const key of Array.from(store.keys())) {
        const rawKey = key.slice(key.indexOf(":") + 1);
        if (!input.keyPrefix || rawKey.startsWith(input.keyPrefix)) {
          store.delete(key);
          removed += 1;
        }
      }
      return removed;
    },

    stats(sedeId) {
      const store = stores.get(sedeId) ?? new Map<string, CacheEntry>();
      const counts = counter(sedeId);
      return {
        entries: store.size,
        bytes: Array.from(store.values()).reduce(
          (sum, entry) => sum + entry.bytes,
          0
        ),
        hits: counts.hits,
        misses: counts.misses,
      };
    },
  };
}

const queryCache = createQueryCache();

export function getCachedQuery<T>(input: CacheInput<T>) {
  return queryCache.get(input);
}

export function invalidateCachedQueries(input: {
  sedeId: number;
  keyPrefix?: string;
}) {
  return queryCache.invalidate(input);
}

export function contextCacheStats(sedeId: number) {
  return queryCache.stats(sedeId);
}
