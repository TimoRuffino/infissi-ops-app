import { describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";
import { getUtentiStore } from "../routers/utenti";
import { setFeatureFlags } from "../platform/featureFlags";
import { requireAssignableUser } from "./assignments";

const SEDE = 88301;
const OTHER_SEDE = 88302;

function context(
  userId: number,
  roles = ["commerciale"],
  sedeId = SEDE
): TrpcContext {
  return {
    user: {
      id: userId,
      role: roles.includes("direzione") ? "admin" : "user",
      ruolo: roles[0],
      ruoli: roles,
      name: `Utente ${userId}`,
    } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}

describe("capability sui router operativi", () => {
  it("consente creazione e modifica proprie ma nega record altrui e cancellazione", async () => {
    setFeatureFlags(
      SEDE,
      { policyMode: "enforce" },
      { actorUserId: 1, reason: "Test capability core router" }
    );
    const owner = appRouter.createCaller(context(88311));
    const colleague = appRouter.createCaller(context(88312));
    const own = await owner.clienti.create({ nome: "Mario", cognome: "Proprio" });
    const other = await colleague.clienti.create({ nome: "Anna", cognome: "Altrui" });

    await expect(
      owner.clienti.update({ id: own.id, telefono: "0187000001" })
    ).resolves.toMatchObject({ telefono: "0187000001" });
    await expect(
      owner.clienti.update({ id: other.id, telefono: "0187000002" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(owner.clienti.delete(own.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("protegge i campi economici e mantiene state machine e ownership", async () => {
    setFeatureFlags(
      SEDE,
      { policyMode: "enforce" },
      { actorUserId: 1, reason: "Test capability commesse" }
    );
    const owner = appRouter.createCaller(context(88321));
    const commessa = await owner.commesse.create({ cliente: "Cliente Policy" });

    await expect(
      owner.commesse.update({ id: commessa.id, importoTotale: 10_000 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      owner.commesse.update({
        id: commessa.id,
        stato: "misure_esecutive",
        force: true,
      })
    ).resolves.toMatchObject({ stato: "misure_esecutive" });
  });

  it("non rivela record di un'altra sede anche alla direzione", async () => {
    setFeatureFlags(
      SEDE,
      { policyMode: "enforce" },
      { actorUserId: 1, reason: "Test isolamento policy" }
    );
    setFeatureFlags(
      OTHER_SEDE,
      { policyMode: "enforce" },
      { actorUserId: 1, reason: "Test isolamento policy" }
    );
    const remote = await appRouter
      .createCaller(context(88331, ["commerciale"], OTHER_SEDE))
      .clienti.create({ nome: "Fuori", cognome: "Sede" });

    await expect(
      appRouter
        .createCaller(context(1, ["direzione"], SEDE))
        .clienti.update({ id: remote.id, note: "Non visibile" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("accetta solo assegnatari attivi, della sede e compatibili", () => {
    const users = getUtentiStore();
    const initialLength = users.length;
    users.push(
      {
        id: 88341,
        attivo: true,
        ruoli: ["post_vendita"],
        sediIds: [SEDE],
      },
      {
        id: 88342,
        attivo: false,
        ruoli: ["post_vendita"],
        sediIds: [SEDE],
      },
      {
        id: 88343,
        attivo: true,
        ruoli: ["post_vendita"],
        sediIds: [OTHER_SEDE],
      }
    );

    try {
      expect(() =>
        requireAssignableUser({
          assigneeUserId: 88341,
          sedeId: SEDE,
          requiredCapability: "ticket.manage",
        })
      ).not.toThrow();
      expect(() =>
        requireAssignableUser({ assigneeUserId: 88342, sedeId: SEDE })
      ).toThrow(/non .*attivo/i);
      expect(() =>
        requireAssignableUser({ assigneeUserId: 88343, sedeId: SEDE })
      ).toThrow(/non trovato/i);
    } finally {
      users.splice(initialLength);
    }
  });
});
