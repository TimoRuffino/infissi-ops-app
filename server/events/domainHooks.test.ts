import { describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { setFeatureFlags } from "../platform/featureFlags";
import { appRouter } from "../routers";
import { getBusinessEventRepository } from "./repository";

function context(sedeId: number): TrpcContext {
  return {
    user: {
      id: 940001,
      role: "admin",
      ruolo: "direzione",
      ruoli: ["direzione"],
      name: "Event Test",
    } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}

describe("domain assignment event hooks", () => {
  it("pubblica creazione e riassegnazione di cliente e commessa", async () => {
    const sedeId = 940101;
    setFeatureFlags(
      sedeId,
      { eventBusMode: "shadow" },
      { actorUserId: 940001, reason: "Test integrazione eventi" }
    );
    const caller = appRouter.createCaller(context(sedeId));
    const cliente = await caller.clienti.create({
      nome: "Cliente",
      cognome: "Evento",
      assegnatoA: 940002,
    });
    await caller.clienti.update({ id: cliente.id, assegnatoA: 940003 });
    const commessa = await caller.commesse.create({
      clienteId: cliente.id,
      assegnatoA: 940002,
      prodotti: [{ nome: "Infissi", quantita: 1 }],
    });
    await caller.commesse.update({ id: commessa.id, assegnatoA: 940003 });
    const ticket = await caller.ticket.create({
      oggetto: "Regolazione finestra test",
      categoria: "regolazione",
      assegnatoA: 940002,
    } as any);
    await caller.ticket.update({ id: ticket.id, assegnatoA: 940003 } as any);

    const repository = getBusinessEventRepository();
    const events = await repository.claim({
      consumerName: "domain-hooks-test",
      workerId: "test",
      eventTypes: ["cliente.assigned", "commessa.assigned", "ticket.assigned"],
      limit: 20,
      now: new Date(Date.now() + 1_000),
    });
    const scoped = events.filter(event => event.sedeId === sedeId);

    expect(scoped.map(event => event.eventType)).toEqual([
      "cliente.assigned",
      "cliente.assigned",
      "commessa.assigned",
      "commessa.assigned",
      "ticket.assigned",
      "ticket.assigned",
    ]);
    expect(scoped.map(event => event.payload.assigneeId)).toEqual([
      940002,
      940003,
      940002,
      940003,
      940002,
      940003,
    ]);
  });
});
