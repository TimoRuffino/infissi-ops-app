import { describe, expect, it } from "vitest";
import {
  emailMessageHref,
  parseConversationKey,
  parseEmailMessageId,
  parseEmailView,
  parseWhatsAppConversationSelection,
  restoredScrollTop,
  sourceHref,
  whatsappConversationHref,
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

describe("WhatsApp conversation navigation", () => {
  it("builds and parses the canonical conversation deep link", () => {
    expect(whatsappConversationHref("wa:8:+393331112222")).toBe(
      "/messaggi/whatsapp?conversazione=wa%3A8%3A%2B393331112222"
    );
    expect(parseConversationKey("wa:8:+393331112222")).toEqual({
      casellaId: 8,
      controparte: "+393331112222",
    });
    expect(parseConversationKey("email:8:x")).toBeNull();
  });

  it("preserves an invalid deep link so the page can show recovery actions", () => {
    expect(
      parseWhatsAppConversationSelection("?conversazione=email%3A8%3Ax")
    ).toEqual({
      key: "email:8:x",
      conversation: null,
      invalid: true,
    });
    expect(parseWhatsAppConversationSelection("")).toEqual({
      key: null,
      conversation: null,
      invalid: false,
    });
  });
});

describe("WhatsApp thread scroll", () => {
  it("keeps the previous content anchored after older messages are prepended", () => {
    expect(restoredScrollTop(120, 1_000, 1_260)).toBe(380);
    expect(restoredScrollTop(120, 1_000, 980)).toBe(120);
  });
});
