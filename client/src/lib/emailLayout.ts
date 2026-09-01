// Contratto di layout dell'inbox Email.
//
// Due zone, non tre: leggere è l'atto principale della pagina, quindi il
// riquadro di lettura non divide più lo spazio con un rail di navigazione
// permanente. Le code vivono in una striscia di chip sopra il workspace e i
// filtri dietro un unico controllo accanto alla ricerca.
// - >= 1024px: elenco a larghezza fissa + lettore che prende tutto il resto;
// - < 1024px: un pane alla volta, elenco oppure lettore.
export const EMAIL_COMPACT_QUERY = "(max-width: 1023px)";

export function emailPaneVisibility({
  compact,
  selectedId,
  focus,
}: {
  compact: boolean;
  selectedId: number | null;
  focus: boolean;
}): { showList: boolean; showReader: boolean; canFocus: boolean } {
  const showReader = selectedId != null;
  const canFocus = !compact && showReader;
  return {
    showList: !showReader || (!compact && !focus),
    showReader,
    canFocus,
  };
}

/**
 * Quanti filtri restringono davvero la coda. La categoria non conta quando la
 * vista la impone già (Nuovi lead): sarebbe un filtro che l'operatore non ha
 * scelto e non può togliere.
 */
export function emailActiveFilterCount({
  mailboxId,
  assigneeId,
  category,
  categoryLocked,
}: {
  mailboxId: number | null;
  assigneeId: number | null;
  category: string | null;
  categoryLocked: boolean;
}): number {
  let count = 0;
  if (mailboxId != null) count += 1;
  if (assigneeId != null) count += 1;
  if (category != null && !categoryLocked) count += 1;
  return count;
}

/** Il controllo unico dei filtri dichiara sempre quanti ne sono attivi. */
export function emailFilterLabel(count: number): string {
  if (count <= 0) return "Filtri: nessuno attivo";
  return count === 1 ? "Filtri: 1 attivo" : `Filtri: ${count} attivi`;
}
