import { describe, expect, it } from "vitest";
import {
  menuItems,
  navigationItemState,
  produzioneRedirect,
  visibile,
  vociNavigazione,
} from "./navigation";

describe("navigationItemState", () => {
  it("opens a group for its active child without activating the parent", () => {
    expect(
      navigationItemState("/messaggi/email", "/messaggi/email", [
        "/messaggi/email",
        "/messaggi/whatsapp",
      ])
    ).toEqual({ active: false, containsActiveChild: true });
  });

  it("activates a matching leaf item", () => {
    expect(navigationItemState("/chat", "/chat", [])).toEqual({
      active: true,
      containsActiveChild: false,
    });
  });
});

describe("produzioneRedirect", () => {
  it("manda la vecchia route al Board, qualunque sia il resto dell'URL", () => {
    expect(produzioneRedirect("/produzione")).toBe("/kanban");
    expect(produzioneRedirect("/produzione?tab=bom")).toBe("/kanban");
    expect(produzioneRedirect("/produzione/qualcosa")).toBe("/kanban");
  });
});

describe("navigation visibility contracts", () => {
  const pagamenti = menuItems
    .flatMap(item => item.children ?? [item])
    .find(item => item.path === "/pagamenti")!;

  it("shows direct Pagamenti navigation only with pagamento.read", () => {
    const commerciale = { ruoli: ["commerciale"] };

    expect(visibile(pagamenti, commerciale, new Set(), null)).toBe(false);
    expect(
      visibile(pagamenti, commerciale, new Set(["pagamento.read"]), null)
    ).toBe(true);
  });

  it("does not expose Tars navigation while the master flag is off", () => {
    const direzione = { ruoli: ["direzione"] };

    expect(
      vociNavigazione(direzione, null, { tars: false }).some(
        item => item.path === "/tars"
      )
    ).toBe(false);
    expect(
      vociNavigazione(direzione, null, { tars: true }).some(
        item => item.path === "/tars"
      )
    ).toBe(true);
  });
});
