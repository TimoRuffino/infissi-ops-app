import { describe, expect, it } from "vitest";

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
});
