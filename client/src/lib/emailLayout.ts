// Contratto di layout dell'inbox Email.
//
// Tre regimi, una sola soglia dichiarata qui perché pagina e test la leggano
// dallo stesso posto:
// - >= 1280px: rail delle code + lista + lettore (tre zone);
// - 1024-1279px: lista + lettore (due zone), il rail collassa nella barra
//   filtri sopra il workspace;
// - < 1024px: un pane alla volta, lista oppure lettore.
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
