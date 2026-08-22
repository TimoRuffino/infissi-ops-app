import { describe, expect, it } from "vitest";
import { navigationItemState, parseTarsTab } from "./navigation";

describe("parseTarsTab", () => {
  it("restores a recognized Tars tab from the query", () => {
    expect(parseTarsTab("?tab=registro", true)).toBe("registro");
    expect(parseTarsTab("?tab=proposte", false)).toBe("proposte");
  });

  it("falls back to oggi for unavailable or unknown tabs", () => {
    expect(parseTarsTab("?tab=registro", false)).toBe("oggi");
    expect(parseTarsTab("?tab=sconosciuta", true)).toBe("oggi");
    expect(parseTarsTab("", true)).toBe("oggi");
  });
});

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
    expect(navigationItemState("/tars", "/tars", [])).toEqual({
      active: true,
      containsActiveChild: false,
    });
  });
});
