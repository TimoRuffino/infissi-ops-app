import { describe, expect, it } from "vitest";
import { navigationItemState, parseTarsTab } from "./navigation";

describe("parseTarsTab", () => {
  it("restores a recognized Tars tab from the query", () => {
    expect(parseTarsTab("?tab=registro", true)).toBe("registro");
  });

  it("falls back to chat for unavailable or unknown tabs", () => {
    expect(parseTarsTab("?tab=registro", false)).toBe("chat");
    expect(parseTarsTab("?tab=sconosciuta", true)).toBe("chat");
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
