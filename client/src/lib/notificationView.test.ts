import { describe, expect, it } from "vitest";
import {
  notificationQueueView,
  notificationViewHref,
  parseNotificationView,
} from "./notificationView";

describe("parseNotificationView", () => {
  it("accetta le viste approvate del Centro azioni", () => {
    expect(parseNotificationView("?view=critical")).toBe("critical");
    expect(parseNotificationView("?view=resolved")).toBe("resolved");
    expect(parseNotificationView("?view=impostazioni")).toBe("impostazioni");
    expect(parseNotificationView("?view=mine")).toBe("mine");
  });

  it("ricade sulla coda personale per una vista sconosciuta o assente", () => {
    expect(parseNotificationView("?view=non-valida")).toBe("mine");
    expect(parseNotificationView("")).toBe("mine");
    expect(parseNotificationView("?altro=1")).toBe("mine");
  });

  it("legge la vista anche accanto ad altri parametri", () => {
    expect(parseNotificationView("?altro=1&view=resolved")).toBe("resolved");
  });
});

describe("notificationQueueView", () => {
  it("tiene la coda personale mentre le preferenze sono aperte", () => {
    expect(notificationQueueView("impostazioni")).toBe("mine");
  });

  it("conserva i filtri reali della coda", () => {
    expect(notificationQueueView("critical")).toBe("critical");
    expect(notificationQueueView("resolved")).toBe("resolved");
    expect(notificationQueueView("mine")).toBe("mine");
  });
});

describe("notificationViewHref", () => {
  it("costruisce link condivisibili e ricaricabili", () => {
    expect(notificationViewHref("mine")).toBe("/notifiche");
    expect(notificationViewHref("critical")).toBe("/notifiche?view=critical");
    expect(notificationViewHref("impostazioni")).toBe(
      "/notifiche?view=impostazioni"
    );
  });

  it("produce indirizzi che il parser riconosce", () => {
    for (const view of ["mine", "critical", "resolved", "impostazioni"] as const) {
      const href = notificationViewHref(view);
      expect(parseNotificationView(href.split("?")[1] ?? "")).toBe(view);
    }
  });
});
