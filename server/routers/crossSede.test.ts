// Test negativi cross-sede sulle entità principali oltre alle commesse
// (coperte in commesse.test.ts): un id valido di un'altra sede deve
// comportarsi come inesistente — null in lettura, NOT_FOUND in mutazione —
// senza mai confermare che il record esista (invariante I4 del dossier).

import { describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";

const SEDE = 90201;
const ALTRA_SEDE = 90202;

function context(userId: number, sedeId: number): TrpcContext {
  return {
    user: {
      id: userId,
      role: "admin",
      ruolo: "direzione",
      ruoli: ["direzione"],
      name: `Utente ${userId}`,
    } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}

const locale = () => appRouter.createCaller(context(90211, SEDE));
const remoto = () => appRouter.createCaller(context(90212, ALTRA_SEDE));

describe("isolamento sede: clienti", () => {
  it("byId restituisce null e le mutation NOT_FOUND, anche alla direzione", async () => {
    const cliente = await locale().clienti.create({
      nome: "Mario",
      cognome: "Isolato",
    });

    await expect(remoto().clienti.byId(cliente.id)).resolves.toBeNull();
    await expect(
      remoto().clienti.update({ id: cliente.id, telefono: "0187000099" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const lista = await remoto().clienti.list({});
    expect(lista.some((c: any) => c.id === cliente.id)).toBe(false);
  });
});

describe("isolamento sede: ticket", () => {
  it("update, cambio stato e delete di un ticket altrui rispondono NOT_FOUND", async () => {
    const ticket = await locale().ticket.create({
      oggetto: "Spiffero dalla finestra",
      categoria: "regolazione",
    });

    await expect(
      remoto().ticket.update({ id: ticket.id, oggetto: "intrusione" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      remoto().ticket.updateStato({ id: ticket.id, stato: "assegnato" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(remoto().ticket.delete(ticket.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    // Nella propria sede il ticket resta intatto e lavorabile.
    await expect(
      locale().ticket.update({ id: ticket.id, priorita: "alta" })
    ).resolves.toMatchObject({ priorita: "alta" });
  });
});
