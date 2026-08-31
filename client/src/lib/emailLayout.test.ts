import { describe, expect, it } from "vitest";

import { emailPaneVisibility, EMAIL_COMPACT_QUERY } from "./emailLayout";

describe("layout email", () => {
  it("riserva tutta la vista al messaggio su schermi compatti e in focus", async () => {
    const modulePath = "./emailLayout";
    const layout = await import(modulePath).catch(() => null);

    expect(
      layout?.emailPaneVisibility({
        compact: true,
        selectedId: 42,
        focus: false,
      })
    ).toEqual({ showList: false, showReader: true, canFocus: false });
    expect(
      layout?.emailPaneVisibility({
        compact: false,
        selectedId: 42,
        focus: true,
      })
    ).toEqual({ showList: false, showReader: true, canFocus: true });
  });

  it("mantiene lista e lettore affiancati sul desktop", async () => {
    const modulePath = "./emailLayout";
    const layout = await import(modulePath).catch(() => null);

    expect(
      layout?.emailPaneVisibility({
        compact: false,
        selectedId: 42,
        focus: false,
      })
    ).toEqual({ showList: true, showReader: true, canFocus: true });
    expect(
      layout?.emailPaneVisibility({
        compact: true,
        selectedId: null,
        focus: false,
      })
    ).toEqual({ showList: true, showReader: false, canFocus: false });
  });

  it("mantiene lista e lettore a tablet, ma sul telefono mostra un solo pane", () => {
    expect(
      emailPaneVisibility({ compact: false, selectedId: 42, focus: false })
    ).toEqual({
      showList: true,
      showReader: true,
      canFocus: true,
    });
    expect(
      emailPaneVisibility({ compact: true, selectedId: 42, focus: false })
    ).toEqual({
      showList: false,
      showReader: true,
      canFocus: false,
    });
  });

  it("dichiara la soglia compatta al telefono, non al tablet", () => {
    // Il tri-pane parte da 1280px, il due-pane da 1024px: solo sotto i 1024px
    // la pagina diventa single-pane.
    expect(EMAIL_COMPACT_QUERY).toBe("(max-width: 1023px)");
  });
});
