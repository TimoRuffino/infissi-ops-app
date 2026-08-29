
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

/**
 * La pagina «Produzione» è stata rimossa il 29/08/2026 (release hardening,
 * PRD §20): non era usata. I segnalibri e i vecchi link atterrano sul
 * Board, la superficie operativa dove la colonna «Produzione» segue le
 * commesse in quello stato. Query string e sottopercorsi si scartano: la
 * vecchia pagina non aveva deep link con stato proprio.
 */
export function produzioneRedirect(_location: string): string {
  return "/kanban";
}
