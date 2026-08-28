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

