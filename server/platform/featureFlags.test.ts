import { describe, expect, it } from "vitest";
import {
  getFeatureFlags,
  listFeatureFlagAudit,
  setFeatureFlags,
} from "./featureFlags";

describe("platform feature flags", () => {
  it("parte con default conservativi e isola le sedi", () => {
    expect(getFeatureFlags(9101)).toMatchObject({
      eventBusMode: "off",
      notificationMode: "legacy",
      realtimeNotifications: false,
      policyMode: "legacy",
      contextEngineMode: "off",
      plannerMode: "off",
      semanticSearchMode: "off",
      autonomyCapabilities: [],
    });

    setFeatureFlags(9101, { eventBusMode: "shadow" }, {
      actorUserId: 7,
      reason: "Avvio controllato eventi",
    });

    expect(getFeatureFlags(9101).eventBusMode).toBe("shadow");
    expect(getFeatureFlags(9102).eventBusMode).toBe("off");
  });

  it("registra autore, motivo e differenze", () => {
    setFeatureFlags(
      9201,
      { realtimeNotifications: true, plannerMode: "shadow" },
      { actorUserId: 11, reason: "Collaudo sede" }
    );

    expect(listFeatureFlagAudit(9201).at(-1)).toMatchObject({
      sedeId: 9201,
      actorUserId: 11,
      reason: "Collaudo sede",
      changes: {
        realtimeNotifications: { from: false, to: true },
        plannerMode: { from: "off", to: "shadow" },
      },
    });
  });
});
