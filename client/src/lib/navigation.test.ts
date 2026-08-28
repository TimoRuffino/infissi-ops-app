import { describe, expect, it } from "vitest";
import { navigationItemState } from "./navigation";


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
