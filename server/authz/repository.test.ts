import { describe, expect, it } from "vitest";
import {
  assertAdministrativeContinuity,
  createMemoryPolicyRepository,
} from "./repository";

describe("policy repository", () => {
  it("isola override e deleghe per sede e ignora quelli scaduti", async () => {
    const repository = createMemoryPolicyRepository();
    const now = new Date("2026-08-25T10:00:00Z");

    await repository.createOverride({
      sedeId: 1,
      userId: 7,
      capability: "economia.read",
      effect: "allow",
      reason: "Copertura amministrativa temporanea",
      createdBy: 1,
      startsAt: null,
      expiresAt: null,
      createdAt: now,
    });
    await repository.createOverride({
      sedeId: 2,
      userId: 7,
      capability: "cliente.delete",
      effect: "allow",
      reason: "Eccezione di altra sede",
      createdBy: 1,
      startsAt: null,
      expiresAt: null,
      createdAt: now,
    });
    await repository.createDelegation({
      sedeId: 1,
      delegatorUserId: 1,
      delegateUserId: 7,
      capability: "intervento.assign",
      reason: "Sostituzione ferie gia conclusa",
      startsAt: new Date("2026-08-20T08:00:00Z"),
      expiresAt: new Date("2026-08-24T18:00:00Z"),
      createdAt: now,
    });

    expect(
      await repository.listEffectiveOverrides({ sedeId: 1, userId: 7, now })
    ).toEqual([
      expect.objectContaining({
        capability: "economia.read",
        effect: "allow",
        sedeId: 1,
        source: "override",
      }),
    ]);
  });

  it("revoca una delega senza cancellarne lo storico", async () => {
    const repository = createMemoryPolicyRepository();
    const createdAt = new Date("2026-08-25T10:00:00Z");
    const delegation = await repository.createDelegation({
      sedeId: 1,
      delegatorUserId: 1,
      delegateUserId: 9,
      capability: "cliente.assign",
      reason: "Copertura sede durante assenza",
      startsAt: createdAt,
      expiresAt: new Date("2026-08-26T18:00:00Z"),
      createdAt,
    });

    expect(
      await repository.revokeDelegation({
        id: delegation.id,
        sedeId: 2,
        revokedBy: 1,
        reason: "Tentativo da altra sede",
        revokedAt: new Date("2026-08-25T11:00:00Z"),
      })
    ).toBe(false);

    expect(
      await repository.revokeDelegation({
        id: delegation.id,
        sedeId: 1,
        revokedBy: 1,
        reason: "Rientro anticipato del delegante",
        revokedAt: new Date("2026-08-25T11:00:00Z"),
      })
    ).toBe(true);
    expect(
      await repository.listEffectiveOverrides({
        sedeId: 1,
        userId: 9,
        now: new Date("2026-08-25T12:00:00Z"),
      })
    ).toEqual([]);
    expect(await repository.listDelegations({ sedeId: 1, userId: 9 })).toHaveLength(1);
  });

  it("impedisce di rimuovere l'ultima capacita amministrativa attiva", () => {
    const users = [
      { id: 1, attivo: true, ruoli: ["direzione"], sediIds: [1] },
      { id: 2, attivo: true, ruoli: ["commerciale"], sediIds: [1] },
    ];

    expect(() =>
      assertAdministrativeContinuity({
        sedeId: 1,
        users,
        targetUserId: 1,
        capability: "tars.manage_policy",
        effect: "deny",
      })
    ).toThrow(/ultima capacita amministrativa/i);

    expect(() =>
      assertAdministrativeContinuity({
        sedeId: 1,
        users: [
          ...users,
          { id: 3, attivo: true, ruoli: ["direzione"], sediIds: [1] },
        ],
        targetUserId: 1,
        capability: "tars.manage_policy",
        effect: "deny",
      })
    ).not.toThrow();
  });
});
