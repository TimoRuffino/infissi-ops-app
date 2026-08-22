export type TarsTab = "chat" | "pendenti" | "decise" | "registro";

const TARS_TABS = new Set<TarsTab>([
  "chat",
  "pendenti",
  "decise",
  "registro",
]);

export function parseTarsTab(search: string, direzione: boolean): TarsTab {
  const value = new URLSearchParams(search).get("tab");
  if (!value || !TARS_TABS.has(value as TarsTab)) return "chat";
  if (value === "registro" && !direzione) return "chat";
  return value as TarsTab;
}

export function isPathActive(location: string, path: string): boolean {
  return path === "/"
    ? location === "/"
    : location === path || location.startsWith(`${path}/`);
}

export function navigationItemState(
  location: string,
  path: string,
  childPaths: string[]
): { active: boolean; containsActiveChild: boolean } {
  const containsActiveChild = childPaths.some(childPath =>
    isPathActive(location, childPath)
  );
  return {
    active: childPaths.length === 0 && isPathActive(location, path),
    containsActiveChild,
  };
}
