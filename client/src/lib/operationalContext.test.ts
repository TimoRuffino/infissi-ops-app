import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import {
  ACTIVE_OPERATIONAL_SCOPE_KEY,
  SCOPED_UI_PREFIX,
  authorizationFingerprint,
  clearOperationalSession,
  clearScopedUiState,
  isAuthMeQueryKey,
  isProtectedQueryKey,
  operationalScopeKey,
  runSedeTransition,
  scopedStorageKey,
} from "./operationalContext";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("chiavi del contesto operativo", () => {
  it("ordina e deduplica le capability prima del fingerprint", () => {
    expect(authorizationFingerprint(["pagamento.read", "cliente.read"])).toBe(
      authorizationFingerprint(["cliente.read", "pagamento.read"])
    );
    expect(
      authorizationFingerprint([
        "cliente.read",
        "cliente.read",
        "pagamento.read",
      ])
    ).toBe(authorizationFingerprint(["cliente.read", "pagamento.read"]));
  });

  it("distingue utente, sede e insieme autorizzativo senza esporli nella chiave", () => {
    const base = operationalScopeKey({
      userId: 11,
      sedeId: 21,
      capabilities: ["cliente.read"],
    });
    const altroUtente = operationalScopeKey({
      userId: 12,
      sedeId: 21,
      capabilities: ["cliente.read"],
    });
    const altraSede = operationalScopeKey({
      userId: 11,
      sedeId: 22,
      capabilities: ["cliente.read"],
    });
    const altriPermessi = operationalScopeKey({
      userId: 11,
      sedeId: 21,
      capabilities: ["cliente.read", "pagamento.read"],
    });

    expect(new Set([base, altroUtente, altraSede, altriPermessi]).size).toBe(4);
    expect(base).not.toContain("11");
    expect(base).not.toContain("21");
    expect(base).not.toContain("cliente.read");
    expect(
      operationalScopeKey({
        userId: 11,
        sedeId: 21,
        capabilities: ["cliente.read"],
      })
    ).toBe(base);
  });

  it("costruisce namespace UI scoped e rimuove solo quello precedente", () => {
    const storage = new MemoryStorage();
    const precedente = operationalScopeKey({
      userId: 1,
      sedeId: 1,
      capabilities: [],
    });
    const corrente = operationalScopeKey({
      userId: 1,
      sedeId: 2,
      capabilities: [],
    });
    const vecchiaLarghezza = scopedStorageKey("layout.sidebar", precedente);
    const vecchiRecenti = scopedStorageKey("navigation.recents", precedente);
    const nuovaLarghezza = scopedStorageKey("layout.sidebar", corrente);

    storage.setItem(vecchiaLarghezza, "280");
    storage.setItem(vecchiRecenti, "[]");
    storage.setItem(nuovaLarghezza, "240");
    storage.setItem("rf-theme", "dark");
    storage.setItem(ACTIVE_OPERATIONAL_SCOPE_KEY, precedente);

    expect(vecchiaLarghezza.startsWith(`${SCOPED_UI_PREFIX}:`)).toBe(true);
    expect(clearScopedUiState(storage, precedente)).toBe(2);
    expect(storage.getItem(vecchiaLarghezza)).toBeNull();
    expect(storage.getItem(vecchiRecenti)).toBeNull();
    expect(storage.getItem(nuovaLarghezza)).toBe("240");
    expect(storage.getItem("rf-theme")).toBe("dark");
    expect(storage.getItem(ACTIVE_OPERATIONAL_SCOPE_KEY)).toBe(precedente);
  });

  it("non rompe il flusso se lo storage del browser è indisponibile", () => {
    const unavailable = {
      get length(): number {
        throw new Error("storage negato");
      },
      key: () => null,
      removeItem: () => undefined,
    };
    expect(clearScopedUiState(unavailable, "scope-test")).toBe(0);
  });
});

describe("classificazione della query cache", () => {
  const query = (path: string[]) => [path, { type: "query" }];

  it("mantiene soltanto l'allowlist globale durante un cambio sede", () => {
    expect(isProtectedQueryKey(query(["auth", "me"]))).toBe(false);
    expect(isProtectedQueryKey(query(["sedi", "list"]))).toBe(false);
    expect(isProtectedQueryKey(query(["platform", "interruttori"]))).toBe(
      false
    );

    expect(isProtectedQueryKey(query(["sedi", "active"]))).toBe(true);
    expect(isProtectedQueryKey(query(["permessi", "mie"]))).toBe(true);
    expect(isProtectedQueryKey(query(["commesse", "list"]))).toBe(true);
    expect(isProtectedQueryKey(query(["platform", "flags"]))).toBe(true);
    expect(isProtectedQueryKey(["chiave-sconosciuta"])).toBe(true);
  });

  it("riconosce auth.me in tutte le forme di chiave supportate", () => {
    expect(isAuthMeQueryKey(query(["auth", "me"]))).toBe(true);
    expect(isAuthMeQueryKey(["auth.me", { type: "query" }])).toBe(true);
    expect(isAuthMeQueryKey(query(["auth", "logout"]))).toBe(false);
  });
});

describe("ordine fail-closed delle transizioni", () => {
  it("cancella prima del cambio, rimuove dopo conferma e committa solo dopo i refetch", async () => {
    const ordine: string[] = [];

    await runSedeTransition({
      cancelProtectedQueries: async () => {
        ordine.push("cancel");
      },
      changeSede: async () => {
        ordine.push("mutate");
      },
      removeProtectedQueries: () => {
        ordine.push("remove");
      },
      clearPreviousScope: () => {
        ordine.push("clear-scope");
      },
      refetchActiveSede: async () => {
        ordine.push("refetch-active");
        return { id: 22 };
      },
      refetchCapabilities: async () => {
        ordine.push("refetch-capabilities");
        return ["cliente.read"];
      },
      commitScope: (active, capabilities) => {
        ordine.push(`commit-${active.id}-${capabilities.length}`);
      },
    });

    expect(ordine).toEqual([
      "cancel",
      "mutate",
      "remove",
      "clear-scope",
      "refetch-active",
      "refetch-capabilities",
      "commit-22-1",
    ]);
  });

  it("collega gli orchestratori verificati al provider e al logout reali", () => {
    const provider = readFileSync(
      "client/src/contexts/OperationalContext.tsx",
      "utf8"
    );
    const authHook = readFileSync("client/src/_core/hooks/useAuth.ts", "utf8");
    const generation = readFileSync(
      "client/src/contexts/UiGenerationContext.tsx",
      "utf8"
    );

    expect(provider).toContain("runSedeTransition({");
    expect(provider).toContain("activeSedeQuery.refetch()");
    expect(provider).toContain("capabilitiesQuery.refetch()");
    expect(authHook).toContain("clearOperationalSession({");
    expect(generation).toContain("flags?.uiV2");
    expect(generation).toContain(
      'root.setAttribute("data-ui-system", "modular-control")'
    );
  });

  it("non rimuove cache né committa se il server rifiuta il cambio", async () => {
    const remove = vi.fn();
    const commit = vi.fn();

    await expect(
      runSedeTransition({
        cancelProtectedQueries: async () => undefined,
        changeSede: async () => {
          throw new Error("negato");
        },
        removeProtectedQueries: remove,
        clearPreviousScope: vi.fn(),
        refetchActiveSede: async () => ({ id: 2 }),
        refetchCapabilities: async () => [],
        commitScope: commit,
      })
    ).rejects.toThrow("negato");

    expect(remove).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it("dopo la conferma non committa se la nuova sede non viene rifatta", async () => {
    const remove = vi.fn();
    const commit = vi.fn();
    await expect(
      runSedeTransition({
        cancelProtectedQueries: async () => undefined,
        changeSede: async () => undefined,
        removeProtectedQueries: remove,
        clearPreviousScope: vi.fn(),
        refetchActiveSede: async () => {
          throw new Error("refetch fallito");
        },
        refetchCapabilities: async () => [],
        commitScope: commit,
      })
    ).rejects.toThrow("refetch fallito");
    expect(remove).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
  });

  it("logout svuota contesto e cache prima di pubblicare auth null", async () => {
    const ordine: string[] = [];
    await clearOperationalSession({
      cancelProtectedQueries: async () => {
        ordine.push("cancel");
      },
      clearScopedState: () => {
        ordine.push("clear-scope");
      },
      clearQueryCache: () => {
        ordine.push("clear-cache");
      },
      clearAuth: () => {
        ordine.push("auth-null");
      },
    });
    expect(ordine).toEqual([
      "cancel",
      "clear-scope",
      "clear-cache",
      "auth-null",
    ]);
  });
});
