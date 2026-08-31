export interface OperationalScopeInput {
  userId: number | string;
  sedeId: number | string;
  capabilities: readonly string[];
}

export const SCOPED_UI_PREFIX = "rf-ui";
export const ACTIVE_OPERATIONAL_SCOPE_KEY = `${SCOPED_UI_PREFIX}:active-scope`;

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// Codifica solo alfabetica: una scope key non espone ID, capability o valori
// di dominio nemmeno per coincidenza di formattazione.
function opaqueHash(value: string): string {
  let remainder = fnv1a(value);
  let result = "";
  for (let index = 0; index < 7; index += 1) {
    result += String.fromCharCode(97 + (remainder % 26));
    remainder = Math.floor(remainder / 26);
  }
  return result;
}

export function authorizationFingerprint(
  capabilities: readonly string[]
): string {
  const normalized = [...new Set(capabilities)].sort().join("\u001f");
  return `auth-${opaqueHash(normalized)}`;
}

export function operationalScopeKey(input: OperationalScopeInput): string {
  const fingerprint = authorizationFingerprint(input.capabilities);
  return `scope-${opaqueHash(
    `${String(input.userId)}\u001e${String(input.sedeId)}\u001e${fingerprint}`
  )}`;
}

export function scopedStorageKey(base: string, scope: string): string {
  return `${SCOPED_UI_PREFIX}:${scope}:${encodeURIComponent(base)}`;
}

export function clearScopedUiState(
  storage: Pick<Storage, "length" | "key" | "removeItem">,
  previousScope: string
): number {
  try {
    const prefix = `${SCOPED_UI_PREFIX}:${previousScope}:`;
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
    return keys.length;
  } catch {
    return 0;
  }
}

export function readActiveOperationalScope(
  storage: Pick<Storage, "getItem">
): string | null {
  try {
    return storage.getItem(ACTIVE_OPERATIONAL_SCOPE_KEY);
  } catch {
    return null;
  }
}

export function writeActiveOperationalScope(
  storage: Pick<Storage, "setItem">,
  scope: string
): void {
  try {
    storage.setItem(ACTIVE_OPERATIONAL_SCOPE_KEY, scope);
  } catch {
    // Le preferenze non devono bloccare il lavoro se lo storage è indisponibile.
  }
}

export function clearActiveOperationalScope(
  storage: Pick<Storage, "removeItem">
): void {
  try {
    storage.removeItem(ACTIVE_OPERATIONAL_SCOPE_KEY);
  } catch {
    // Lo svuotamento della cache in memoria resta il confine primario.
  }
}

function queryPath(queryKey: unknown): string[] {
  if (!Array.isArray(queryKey) || queryKey.length === 0) return [];
  const head = queryKey[0];
  if (Array.isArray(head)) {
    return head.filter((part): part is string => typeof part === "string");
  }
  if (typeof head === "string") return head.split(".").filter(Boolean);
  return [];
}

const GLOBAL_QUERY_ALLOWLIST = new Set([
  "auth.me",
  "platform.interruttori",
  "sedi.list",
]);

export function isAuthMeQueryKey(queryKey: unknown): boolean {
  return queryPath(queryKey).join(".") === "auth.me";
}

export function isProtectedQueryKey(queryKey: unknown): boolean {
  const path = queryPath(queryKey).join(".");
  if (!path) return true;
  return !GLOBAL_QUERY_ALLOWLIST.has(path);
}

export interface SedeTransitionOperations<TActive, TCapabilities> {
  cancelProtectedQueries: () => Promise<void>;
  changeSede: () => Promise<void>;
  removeProtectedQueries: () => void | Promise<void>;
  clearPreviousScope: () => void | Promise<void>;
  refetchActiveSede: () => Promise<TActive>;
  refetchCapabilities: () => Promise<TCapabilities>;
  commitScope: (active: TActive, capabilities: TCapabilities) => void;
}

export async function runSedeTransition<TActive, TCapabilities>(
  operations: SedeTransitionOperations<TActive, TCapabilities>
): Promise<void> {
  await operations.cancelProtectedQueries();
  await operations.changeSede();
  await operations.removeProtectedQueries();
  await operations.clearPreviousScope();
  const [active, capabilities] = await Promise.all([
    operations.refetchActiveSede(),
    operations.refetchCapabilities(),
  ]);
  operations.commitScope(active, capabilities);
}

export interface OperationalSessionCleanup {
  cancelProtectedQueries: () => Promise<void>;
  clearScopedState: () => void | Promise<void>;
  clearQueryCache: () => void | Promise<void>;
  clearAuth: () => void;
}

export async function clearOperationalSession(
  operations: OperationalSessionCleanup
): Promise<void> {
  await operations.cancelProtectedQueries();
  await operations.clearScopedState();
  await operations.clearQueryCache();
  operations.clearAuth();
}
