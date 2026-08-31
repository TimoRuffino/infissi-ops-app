import { describe, expect, it } from "vitest";
import {
  parseNotificationEvent,
  reconnectDelayMs,
  selectLeaderTab,
} from "./notificationStream";

describe("notification stream helpers", () => {
  it("valida payload SSE privacy-safe", () => {
    expect(
      parseNotificationEvent(
        JSON.stringify({
          notificationId: 12,
          entityRefs: [{ type: "commessa", id: "42" }],
        })
      )
    ).toEqual({ notificationId: 12, entityRefs: [{ type: "commessa", id: "42" }] });
    expect(parseNotificationEvent(JSON.stringify({ notificationId: "12", body: "segreto" }))).toBeNull();
  });

  it("rifiuta un evento senza riferimenti entita completi", () => {
    // Un ref senza `id` non è navigabile: l'evento intero viene scartato invece
    // di arrivare al client mezzo vuoto.
    expect(
      parseNotificationEvent(
        JSON.stringify({ notificationId: 7, entityRefs: [{ type: "ticket" }] })
      )
    ).toBeNull();
    expect(
      parseNotificationEvent(
        JSON.stringify({ notificationId: 7, entityRefs: [{ id: "9" }] })
      )
    ).toBeNull();
    expect(
      parseNotificationEvent(
        JSON.stringify({ notificationId: 7, entityRefs: [{ type: "ticket", id: 9 }] })
      )
    ).toBeNull();
  });

  it("elegge deterministicamente una sola scheda viva", () => {
    const now = 10_000;
    expect(
      selectLeaderTab(
        new Map([
          ["tab-b", now],
          ["tab-a", now - 1_000],
          ["tab-old", now - 20_000],
        ]),
        now,
        12_000
      )
    ).toBe("tab-a");
  });

  it("limita il backoff a trenta secondi", () => {
    expect(reconnectDelayMs(0)).toBe(1_000);
    expect(reconnectDelayMs(10)).toBe(30_000);
  });
});
