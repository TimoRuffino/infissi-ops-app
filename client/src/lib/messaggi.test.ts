import { describe, expect, it } from "vitest";
import {
  emailMessageHref,
  parseEmailMessageId,
  parseEmailView,
  sourceHref,
} from "./messaggi";

describe("parseEmailView", () => {
  it("accepts an approved Email view", () => {
    expect(parseEmailView("?view=lead")).toBe("lead");
  });

  it("falls back to the operational queue for an unknown view", () => {
    expect(parseEmailView("?view=ignota")).toBe("da_gestire");
  });
});

describe("Email message navigation", () => {
  it("builds the canonical deep link with URL encoding", () => {
    expect(emailMessageHref(42)).toBe("/messaggi/email?messaggio=42");
    expect(sourceHref({ tipo: "email", id: 42 })).toBe(
      "/messaggi/email?messaggio=42"
    );
  });

  it("accepts only positive integer message IDs", () => {
    expect(parseEmailMessageId("?messaggio=42")).toBe(42);
    expect(parseEmailMessageId("?messaggio=-1")).toBeNull();
    expect(parseEmailMessageId("?messaggio=4.2")).toBeNull();
    expect(parseEmailMessageId("?messaggio=testo")).toBeNull();
  });
});
