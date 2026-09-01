import { describe, expect, it } from "vitest";

import {
  emailActiveFilterCount,
  emailFilterLabel,
  emailPaneVisibility,
  EMAIL_COMPACT_QUERY,
} from "./emailLayout";

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
    // Due zone da 1024px in su: elenco e lettore. Solo sotto i 1024px la
    // pagina diventa single-pane.
    expect(EMAIL_COMPACT_QUERY).toBe("(max-width: 1023px)");
  });
});

describe("filtri della coda email", () => {
  it("conta solo i filtri che l'operatore ha davvero scelto", () => {
    expect(
      emailActiveFilterCount({
        mailboxId: null,
        assigneeId: null,
        category: null,
        categoryLocked: false,
      })
    ).toBe(0);
    expect(
      emailActiveFilterCount({
        mailboxId: 3,
        assigneeId: 7,
        category: "operativa",
        categoryLocked: false,
      })
    ).toBe(3);
  });

  it("non conta la categoria imposta dalla vista Nuovi lead", () => {
    expect(
      emailActiveFilterCount({
        mailboxId: null,
        assigneeId: null,
        category: "nuovo_lead",
        categoryLocked: true,
      })
    ).toBe(0);
    expect(
      emailActiveFilterCount({
        mailboxId: 2,
        assigneeId: null,
        category: "nuovo_lead",
        categoryLocked: true,
      })
    ).toBe(1);
  });

  it("dichiara quanti filtri sono attivi, anche quando non ce ne sono", () => {
    expect(emailFilterLabel(0)).toBe("Filtri: nessuno attivo");
    expect(emailFilterLabel(1)).toBe("Filtri: 1 attivo");
    expect(emailFilterLabel(3)).toBe("Filtri: 3 attivi");
  });
});
