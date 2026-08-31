import { describe, expect, it } from "vitest";
import {
  emailMessageHref,
  legacyMessageRedirect,
  parseConversationKey,
  parseEmailMessageId,
  parseEmailView,
  parseWhatsAppConversationSelection,
  restoredScrollTop,
  initialThreadScrollTop,
  emailBulkExclusionCopy,
  communicationIdsForConversation,
  sourceHref,
  whatsappConversationHref,
} from "./messaggi";

describe("legacy navigation redirects", () => {
  it("moves recognized Email query parameters to the canonical route", () => {
    expect(
      legacyMessageRedirect("/comunicazioni?view=lead&messaggio=42&debug=true")
    ).toBe("/messaggi/email?view=lead&messaggio=42");
  });

  // Il segnalibro storico deve restare intatto dopo la migrazione del
  // fallback: vista e messaggio arrivano fino alla route canonica.
  it("conserva vista e messaggio di un deep link legacy", () => {
    expect(legacyMessageRedirect("/comunicazioni?view=lead&messaggio=42")).toBe(
      "/messaggi/email?view=lead&messaggio=42"
    );
  });
});

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

  it("conserva la vista corrente nel link al messaggio", () => {
    expect(emailMessageHref(42, "lead")).toBe(
      "/messaggi/email?view=lead&messaggio=42"
    );
    expect(parseEmailView("?view=lead&messaggio=42")).toBe("lead");
    expect(parseEmailMessageId("?view=lead&messaggio=42")).toBe(42);
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
  it("positions the initial thread at the newest message", () => {
    expect(initialThreadScrollTop(1_260)).toBe(1_260);
  });

  it("keeps the previous content anchored after older messages are prepended", () => {
    expect(restoredScrollTop(120, 1_000, 1_260)).toBe(380);
    expect(restoredScrollTop(120, 1_000, 980)).toBe(120);
  });
});

describe("WhatsApp thread context", () => {
  it("mantiene il deep link di una conversazione quando si apre il contesto", () => {
    expect(whatsappConversationHref("wa:8:+393331112222")).toBe(
      "/messaggi/whatsapp?conversazione=wa%3A8%3A%2B393331112222"
    );
    expect(
      communicationIdsForConversation("wa:8:+393331112222", {
        key: "wa:8:+393331112222",
        ids: [11, 12],
      })
    ).toEqual([11, 12]);
  });

  it("non espone ID finché nessun thread è stato caricato", () => {
    // `key: null` è lo stato iniziale del workspace: nessun thread caricato,
    // quindi nessun ID da passare al pannello contesto.
    expect(
      communicationIdsForConversation("wa:8:+393331112222", {
        key: null,
        ids: [11, 12],
      })
    ).toEqual([]);
  });

  it("does not expose retained message IDs after switching conversation", () => {
    expect(
      communicationIdsForConversation("wa:2:+393332222222", {
        key: "wa:1:+393331111111",
        ids: [11, 12],
      })
    ).toEqual([]);
    expect(
      communicationIdsForConversation("wa:1:+393331111111", {
        key: "wa:1:+393331111111",
        ids: [11, 12],
      })
    ).toEqual([11, 12]);
  });
});

describe("Email bulk exclusion", () => {
  it("builds counted confirmation copy for spam and newsletter", () => {
    expect(emailBulkExclusionCopy("spam", 3)).toEqual({
      title: "Segnare 3 email come spam?",
      description: "Le 3 email selezionate verranno escluse dalla coda operativa.",
      confirmLabel: "Segna come spam",
    });
    expect(emailBulkExclusionCopy("offerta_marketing", 1).title).toBe(
      "Escludere 1 email come newsletter?"
    );
  });
});
