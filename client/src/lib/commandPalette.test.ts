import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { NavigationAccess } from "./navigation";
import {
  compileTarsDraftPath,
  paletteRecentsKey,
  readPaletteRecents,
  rememberPaletteRecent,
  revalidateRecent,
  sanitizeRecent,
  type PaletteRecent,
} from "./commandPalette";

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function access(
  capabilities: readonly string[] = [],
  tars = false
): NavigationAccess {
  return {
    user: { ruoli: ["commerciale"] },
    capabilities: new Set(capabilities),
    flags: { tars },
    capabilityStatus: "resolved",
  };
}

describe("palette recents persistence", () => {
  it("namespaces storage by the committed operational scope", () => {
    expect(paletteRecentsKey(null)).toBeNull();
    expect(paletteRecentsKey("scope-alfa")).not.toBe(
      paletteRecentsKey("scope-beta")
    );
    expect(paletteRecentsKey("scope-alfa")).toContain("scope-alfa");

    const storage = new MemoryStorage();
    storage.setItem(
      "rf-palette-recenti-7",
      JSON.stringify([{ kind: "route", label: "Legacy", path: "/" }])
    );
    expect(readPaletteRecents(storage, "scope-alfa")).toEqual([]);
  });

  it("treats malformed storage and unknown kinds as empty or invalid", () => {
    const storage = new MemoryStorage();
    const key = paletteRecentsKey("scope-alfa")!;
    storage.setItem(key, "{");
    expect(readPaletteRecents(storage, "scope-alfa")).toEqual([]);

    storage.setItem(
      key,
      JSON.stringify([
        { kind: "sconosciuto", label: "No", path: "/clienti/1" },
        { kind: "cliente", label: "Rimosso", path: "/clienti/1/storico" },
        { kind: "route", label: "Dashboard", path: "/" },
      ])
    );
    expect(readPaletteRecents(storage, "scope-alfa")).toEqual([
      { kind: "route", label: "Dashboard", path: "/" },
    ]);
  });

  it("deduplicates newest-first and caps the list at six", () => {
    const storage = new MemoryStorage();
    for (let id = 1; id <= 7; id += 1) {
      rememberPaletteRecent(storage, "scope-alfa", {
        kind: "cliente",
        label: `Cliente ${id}`,
        path: `/clienti/${id}`,
      });
    }
    rememberPaletteRecent(storage, "scope-alfa", {
      kind: "cliente",
      label: "Cliente quattro aggiornato",
      path: "/clienti/4",
    });

    const recents = readPaletteRecents(storage, "scope-alfa");
    expect(recents).toHaveLength(6);
    expect(recents[0]).toEqual({
      kind: "cliente",
      label: "Cliente quattro aggiornato",
      path: "/clienti/4",
    });
    expect(recents.filter(recent => recent.path === "/clienti/4")).toHaveLength(
      1
    );
    expect(recents.map(recent => recent.path)).not.toContain("/clienti/1");
  });
});

describe("palette recent validation", () => {
  it("sanitizes finite kinds and rejects removed entity path shapes", () => {
    expect(
      sanitizeRecent({
        kind: "commessa",
        label: "  COM-2026-001  ",
        path: "/commesse/42",
      })
    ).toEqual({
      kind: "commessa",
      label: "COM-2026-001",
      path: "/commesse/42",
    });
    expect(
      sanitizeRecent({
        kind: "cliente",
        label: "Record rimosso",
        path: "/clienti/42/archivio",
      })
    ).toBeNull();
    expect(
      sanitizeRecent({
        kind: "commessa",
        label: "Record rimosso",
        path: "/commesse/non-numerica",
      })
    ).toBeNull();
  });

  it("revalidates routes and records against current effective access", () => {
    const tars: PaletteRecent = {
      kind: "route",
      label: "Tars",
      path: "/tars",
    };
    const economia: PaletteRecent = {
      kind: "route",
      label: "Contabilità",
      path: "/economia",
    };
    const cliente: PaletteRecent = {
      kind: "cliente",
      label: "Cliente 12",
      path: "/clienti/12",
    };
    const removedRoute: PaletteRecent = {
      kind: "route",
      label: "Vecchia pagina",
      path: "/pagina-rimossa",
    };

    expect(revalidateRecent(tars, access(["tars.use"], true))).toBe(true);
    expect(revalidateRecent(tars, access(["tars.use"], false))).toBe(false);
    expect(revalidateRecent(economia, access([]))).toBe(false);
    expect(revalidateRecent(economia, access(["economia.read"]))).toBe(true);
    expect(revalidateRecent(cliente, access([]))).toBe(false);
    expect(revalidateRecent(cliente, access(["cliente.read"]))).toBe(true);
    expect(revalidateRecent(removedRoute, access([]))).toBe(false);
  });
});

describe("Tars palette handoff", () => {
  it("compiles a draft URL without representing a send operation", () => {
    expect(compileTarsDraftPath("  Analizza ritardo & costo  ")).toBe(
      "/tars?q=Analizza%20ritardo%20%26%20costo"
    );
    expect(compileTarsDraftPath("   ")).toBeNull();
  });

  it("keeps provider procedures out of the typing surface", () => {
    const source = readFileSync(
      new URL("../components/CommandPalette.tsx", import.meta.url),
      "utf8"
    );
    expect(source).toContain("compileTarsDraftPath");
    expect(source).toContain("bozza, non invia");
    expect(source).not.toMatch(/trpc\.tars\./);
  });

  it("clears and closes the dialog when the committed scope changes", () => {
    const source = readFileSync(
      new URL("../components/CommandPalette.tsx", import.meta.url),
      "utf8"
    );
    expect(source).toContain("previousScope.current === scopeKey");
    expect(source).toContain("setRecents([])");
    expect(source).toMatch(/if \(open\) onOpenChange\(false\)/);
  });
});
