import {
  navigationDestinations,
  type NavigationAccess,
} from "@/lib/navigation";
import { scopedStorageKey } from "@/lib/operationalContext";

const PALETTE_RECENTS_BASE = "palette-recents";
export const MAX_PALETTE_RECENTS = 6;
export const MAX_PALETTE_QUERY_LENGTH = 1200;

export type PaletteRecent = {
  label: string;
  path: string;
  kind: "route" | "cliente" | "commessa";
};

type PaletteStorage = Pick<Storage, "getItem" | "setItem">;

export function paletteRecentsKey(scopeKey: string | null): string | null {
  return scopeKey ? scopedStorageKey(PALETTE_RECENTS_BASE, scopeKey) : null;
}

function safeLocalPath(path: string): boolean {
  return (
    path.startsWith("/") &&
    !path.startsWith("//") &&
    !/[\\?#\s\u0000-\u001f\u007f]/.test(path) &&
    path.length <= 512
  );
}

export function sanitizeRecent(candidate: unknown): PaletteRecent | null {
  if (!candidate || typeof candidate !== "object") return null;
  const value = candidate as Record<string, unknown>;
  if (
    value.kind !== "route" &&
    value.kind !== "cliente" &&
    value.kind !== "commessa"
  ) {
    return null;
  }
  if (typeof value.label !== "string" || typeof value.path !== "string") {
    return null;
  }

  const label = value.label.trim().slice(0, 160);
  const path = value.path.trim();
  if (!label || !safeLocalPath(path)) return null;
  if (value.kind === "cliente" && !/^\/clienti\/\d+$/.test(path)) return null;
  if (value.kind === "commessa" && !/^\/commesse\/\d+$/.test(path)) {
    return null;
  }

  return { kind: value.kind, label, path };
}

export function readPaletteRecents(
  storage: Pick<PaletteStorage, "getItem">,
  scopeKey: string | null
): PaletteRecent[] {
  const key = paletteRecentsKey(scopeKey);
  if (!key) return [];
  try {
    const raw = storage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];

    const seen = new Set<string>();
    const result: PaletteRecent[] = [];
    for (const candidate of parsed) {
      const recent = sanitizeRecent(candidate);
      if (!recent || seen.has(recent.path)) continue;
      seen.add(recent.path);
      result.push(recent);
      if (result.length === MAX_PALETTE_RECENTS) break;
    }
    return result;
  } catch {
    return [];
  }
}

export function rememberPaletteRecent(
  storage: PaletteStorage,
  scopeKey: string | null,
  candidate: PaletteRecent
): void {
  const key = paletteRecentsKey(scopeKey);
  const recent = sanitizeRecent(candidate);
  if (!key || !recent) return;
  try {
    const previous = readPaletteRecents(storage, scopeKey).filter(
      item => item.path !== recent.path
    );
    storage.setItem(
      key,
      JSON.stringify([recent, ...previous].slice(0, MAX_PALETTE_RECENTS))
    );
  } catch {
    // Storage bloccato: la palette continua a navigare senza persistenza.
  }
}

export function revalidateRecent(
  candidate: PaletteRecent,
  access: NavigationAccess
): boolean {
  const recent = sanitizeRecent(candidate);
  if (!recent) return false;
  const visiblePaths = new Set(
    navigationDestinations(access).map(destination => destination.path)
  );

  if (recent.kind === "route") return visiblePaths.has(recent.path);
  if (recent.kind === "cliente") return visiblePaths.has("/clienti");
  return visiblePaths.has("/commesse");
}

/** Produces a draft-only deep link. The Tars page still requires explicit send. */
export function compileTarsDraftPath(query: string): string | null {
  const draft = query.trim().slice(0, MAX_PALETTE_QUERY_LENGTH);
  return draft ? `/tars?q=${encodeURIComponent(draft)}` : null;
}
