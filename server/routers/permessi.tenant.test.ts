import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";
import { getUtentiStore } from "./utenti";

const SEDE = 97101;
const DIREZIONE_ID = 97111;
const TARGET_ID = 97112;

function context(userId: number, ruoli: string[]): TrpcContext {
  return {
    user: {
      id: userId,
      role: ruoli.includes("direzione") ? "admin" : "user",
      ruolo: ruoli[0],
      ruoli,
      name: `Utente ${userId}`,
    } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId: SEDE,
    sediIds: [SEDE],
  } as TrpcContext;
}

const utenti = getUtentiStore();
let lunghezzaIniziale = 0;

beforeEach(() => {
  lunghezzaIniziale = utenti.length;
  const now = new Date();
  utenti.push(
    { id: DIREZIONE_ID, nome: "Dora", cognome: "Direzione", email: "dora@ws1.test", ruoli: ["direzione"], sediIds: [SEDE], attivo: true, tenantId: 1, createdAt: now, updatedAt: now },
    { id: TARGET_ID, nome: "Tino", cognome: "Target", email: "tino@ws1.test", ruoli: ["commerciale"], sediIds: [SEDE], attivo: true, tenantId: 1, createdAt: now, updatedAt: now }
  );
});

afterEach(() => {
  utenti.splice(lunghezzaIniziale);
});

describe("tenant.manage_proprietari non si concede per override né per delega", () => {
  it("updateOverride risponde FORBIDDEN", async () => {
    const caller = appRouter.createCaller(context(DIREZIONE_ID, ["direzione"]));
    await expect(
      caller.permessi.updateOverride({
        userId: TARGET_ID,
        capability: "tenant.manage_proprietari",
        effect: "allow",
        reason: "provo a concedermela da direzione",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("createDelegation risponde FORBIDDEN", async () => {
    const caller = appRouter.createCaller(context(DIREZIONE_ID, ["direzione"]));
    await expect(
      caller.permessi.createDelegation({
        delegatorUserId: DIREZIONE_ID,
        delegateUserId: TARGET_ID,
        capability: "tenant.manage_proprietari",
        startsAt: new Date("2026-09-07T00:00:00Z"),
        expiresAt: new Date("2026-09-14T00:00:00Z"),
        reason: "delega vietata dalla spec WS1",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
