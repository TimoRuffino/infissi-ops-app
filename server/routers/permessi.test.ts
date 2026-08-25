import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";
import { CAPABILITIES } from "../authz/capabilities";
import { getUtentiStore } from "./utenti";

const SEDE = 98601;
const OTHER_SEDE = 98602;
const DIRECTION_ID = 98611;
const SALES_ID = 98612;
const SUPPORT_ID = 98613;
const REMOTE_ID = 98614;

function context(
  userId: number,
  ruoli: string[],
  sedeId = SEDE,
  sediIds = [sedeId]
): TrpcContext {
  return {
    user: {
      id: userId,
      role: ruoli.includes("direzione") ? "admin" : "user",
      ruolo: ruoli[0],
      ruoli,
      sediIds,
      name: `Utente ${userId}`,
    } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds,
  };
}

const users = getUtentiStore();
let initialLength = 0;

beforeEach(() => {
  initialLength = users.length;
  const now = new Date("2026-08-25T09:00:00.000Z");
  users.push(
    {
      id: DIRECTION_ID,
      nome: "Diana",
      cognome: "Direzione",
      email: "diana.scope@example.test",
      password: "hash-direzione-segreto",
      ruoli: ["direzione"],
      sediIds: [SEDE],
      attivo: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: SALES_ID,
      nome: "Carlo",
      cognome: "Commerciale",
      email: "carlo.scope@example.test",
      password: "hash-commerciale-segreto",
      ruoli: ["commerciale"],
      sediIds: [SEDE],
      attivo: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: SUPPORT_ID,
      nome: "Paola",
      cognome: "Supporto",
      email: "paola.scope@example.test",
      password: "hash-supporto-segreto",
      ruoli: ["post_vendita"],
      sediIds: [SEDE],
      attivo: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: REMOTE_ID,
      nome: "Remo",
      cognome: "Remoto",
      email: "remo.scope@example.test",
      password: "hash-remoto-segreto",
      ruoli: ["commerciale"],
      sediIds: [OTHER_SEDE],
      attivo: true,
      createdAt: now,
      updatedAt: now,
    }
  );
});

afterEach(() => {
  users.splice(initialLength);
});

describe("utenti sede-scoped", () => {
  it("mostra solo colleghi con almeno una sede condivisa e non espone password", async () => {
    const caller = appRouter.createCaller(context(SALES_ID, ["commerciale"]));
    const list = await caller.utenti.list();

    expect(list.map(user => user.id)).toEqual(
      expect.arrayContaining([DIRECTION_ID, SALES_ID, SUPPORT_ID])
    );
    expect(list.map(user => user.id)).not.toContain(REMOTE_ID);
    expect(list.every(user => !("password" in user))).toBe(true);
    expect(await caller.utenti.byId(REMOTE_ID)).toBeNull();
    expect((await caller.utenti.stats()).total).toBe(3);
  });

  it("richiede alla direzione adminScope esplicito per vedere tutte le sedi", async () => {
    const caller = appRouter.createCaller(
      context(DIRECTION_ID, ["direzione"], SEDE, [SEDE, OTHER_SEDE])
    );

    expect((await caller.utenti.list()).map(user => user.id)).not.toContain(
      REMOTE_ID
    );
    expect(
      (await caller.utenti.list({ adminScope: true })).map(user => user.id)
    ).toContain(REMOTE_ID);
    expect(
      await caller.utenti.byId({ id: REMOTE_ID, adminScope: true })
    ).toMatchObject({
      id: REMOTE_ID,
      hasPassword: true,
    });
    expect(
      (await caller.utenti.stats({ adminScope: true })).total
    ).toBeGreaterThanOrEqual(4);
  });

  it("nega adminScope a chi non e direzione", async () => {
    await expect(
      appRouter
        .createCaller(context(SALES_ID, ["commerciale"]))
        .utenti.list({ adminScope: true })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("permessi", () => {
  it("espone una preview completa e privacy-safe solo alla direzione", async () => {
    const direction = appRouter.createCaller(
      context(DIRECTION_ID, ["direzione"])
    );
    const preview = await direction.permessi.preview({ userId: SALES_ID });

    expect(preview.user).toMatchObject({ id: SALES_ID, nome: "Carlo" });
    expect(preview.user).not.toHaveProperty("password");
    expect(preview.capabilities).toHaveLength(CAPABILITIES.length);
    expect(
      preview.capabilities.find(item => item.capability === "cliente.read")
    ).toMatchObject({
      inherited: true,
      effective: true,
    });
    await expect(
      appRouter
        .createCaller(context(SALES_ID, ["commerciale"]))
        .permessi.preview({ userId: SALES_ID })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("crea, sostituisce e rimuove un override motivato", async () => {
    const caller = appRouter.createCaller(context(DIRECTION_ID, ["direzione"]));

    await expect(
      caller.permessi.updateOverride({
        userId: SALES_ID,
        capability: "economia.read",
        effect: "allow",
        reason: "breve",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await caller.permessi.updateOverride({
      userId: SALES_ID,
      capability: "economia.read",
      effect: "allow",
      reason: "Accesso temporaneo per supportare la chiusura mensile.",
    });
    let preview = await caller.permessi.preview({ userId: SALES_ID });
    expect(
      preview.capabilities.find(item => item.capability === "economia.read")
    ).toMatchObject({
      effective: true,
      source: "override",
    });

    await caller.permessi.updateOverride({
      userId: SALES_ID,
      capability: "economia.read",
      effect: "inherit",
      reason: "Chiusura mensile conclusa e accesso non piu necessario.",
    });
    preview = await caller.permessi.preview({ userId: SALES_ID });
    expect(
      preview.capabilities.find(item => item.capability === "economia.read")
    ).toMatchObject({
      effective: false,
      source: "role",
    });
  });

  it("crea e revoca deleghe con finestra temporale valida", async () => {
    const caller = appRouter.createCaller(context(DIRECTION_ID, ["direzione"]));
    const startsAt = new Date(Date.now() - 60_000);
    const expiresAt = new Date(Date.now() + 86_400_000);

    await expect(
      caller.permessi.createDelegation({
        delegatorUserId: DIRECTION_ID,
        delegateUserId: SUPPORT_ID,
        capability: "economia.read",
        startsAt: expiresAt,
        expiresAt: startsAt,
        reason: "Copertura amministrativa durante assenza programmata.",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const delegation = await caller.permessi.createDelegation({
      delegatorUserId: DIRECTION_ID,
      delegateUserId: SUPPORT_ID,
      capability: "economia.read",
      startsAt,
      expiresAt,
      reason: "Copertura amministrativa durante assenza programmata.",
    });
    expect(delegation).toMatchObject({
      delegateUserId: SUPPORT_ID,
      revokedAt: null,
    });

    await caller.permessi.revokeDelegation({
      id: delegation.id,
      userId: SUPPORT_ID,
      reason: "La copertura amministrativa non e piu necessaria.",
    });
    const preview = await caller.permessi.preview({ userId: SUPPORT_ID });
    expect(
      preview.delegations.find(item => item.id === delegation.id)?.revokedAt
    ).toBeInstanceOf(Date);
    const audit = await caller.permessi.auditSummary({
      userId: SUPPORT_ID,
      days: 30,
    });
    expect(audit.changes.map(item => item.action)).toEqual(
      expect.arrayContaining(["delegation_created", "delegation_revoked"])
    );
  });

  it("non consente di gestire utenti fuori dalla sede attiva", async () => {
    const caller = appRouter.createCaller(context(DIRECTION_ID, ["direzione"]));
    await expect(
      caller.permessi.preview({ userId: REMOTE_ID })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
