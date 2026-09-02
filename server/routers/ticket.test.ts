// I ticket si leggono anche dalla commessa a cui sono collegati: `list`
// filtra per `commessaId` e non deve mai far uscire un ticket da un'altra
// sede, nemmeno indovinando l'id della commessa.

import { describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";

const SEDE = 96101;
const ALTRA_SEDE = 96102;

function context(sedeId: number): TrpcContext {
  return {
    user: {
      id: sedeId + 10_000,
      role: "admin",
      ruolo: "direzione",
      ruoli: ["direzione"],
      name: "Ticket Test",
    } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}

describe("ticket collegati alla commessa", () => {
  it("filtra i ticket della commessa richiesta e lascia fuori gli altri", async () => {
    const caller = appRouter.createCaller(context(SEDE));
    const commessa = await caller.commesse.create({ cliente: "Ticket Sua" });
    const altra = await caller.commesse.create({ cliente: "Ticket Altrui" });

    const suo = await caller.ticket.create({
      commessaId: commessa.id,
      oggetto: "Maniglia da regolare",
      categoria: "regolazione",
    });
    await caller.ticket.create({
      commessaId: altra.id,
      oggetto: "Vetro rigato",
      categoria: "difetto_prodotto",
    });
    // Un ticket senza commessa non deve comparire su nessuna scheda.
    await caller.ticket.create({
      oggetto: "Chiamata senza commessa",
      categoria: "altro",
    });

    const collegati = await caller.ticket.list({ commessaId: commessa.id });

    expect(collegati.map((t: any) => t.id)).toEqual([suo.id]);
    expect(collegati[0]).toMatchObject({
      oggetto: "Maniglia da regolare",
      commessaId: commessa.id,
      stato: "aperto",
    });
  });

  it("non mostra i ticket di un'altra sede nemmeno con l'id giusto", async () => {
    const caller = appRouter.createCaller(context(SEDE));
    const commessa = await caller.commesse.create({ cliente: "Ticket Isolato" });
    await caller.ticket.create({
      commessaId: commessa.id,
      oggetto: "Riservato alla sede",
      categoria: "garanzia",
    });

    const estraneo = appRouter.createCaller(context(ALTRA_SEDE));

    expect(await estraneo.ticket.list({ commessaId: commessa.id })).toEqual([]);
  });
});
