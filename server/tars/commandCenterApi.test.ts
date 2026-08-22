import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import { getTarsConfig, proposte } from "./stores";

function context(sedeId: number): TrpcContext {
  return {
    user: {
      id: 1,
      role: "admin",
      ruoli: ["direzione"],
      name: "Direzione",
    } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}

describe("tars.commandCenter", () => {
  const ids = [991_001, 991_002];

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    getTarsConfig(1).attivo = true;
    getTarsConfig(2).attivo = true;
    proposte.push(
      {
        id: ids[0],
        sedeId: 1,
        tipo: "collega_comunicazione",
        titolo: "Collega la richiesta alla commessa",
        motivazione: "Il codice commessa è presente nella comunicazione",
        confidenza: "alta",
        payload: { comunicazioneId: 71, canale: "email" },
        commessaId: 12,
        clienteId: 8,
        opzioni: null,
        risposta: null,
        stato: "pendente",
        esito: null,
        motivoRifiuto: null,
        esecuzioneId: null,
        trigger: "smistamento",
        createdAt: new Date(),
        decisaAt: null,
        decisaDa: null,
        decisaDaNome: null,
        seguitoAt: null,
        seguitoEsecuzioneId: null,
        origineId: null,
        chiaveAzione: "collega:email:71:commessa:12",
      },
      {
        id: ids[1],
        sedeId: 2,
        tipo: "ticket",
        titolo: "Dato di un'altra sede",
        motivazione: "Non deve essere visibile",
        confidenza: "alta",
        payload: {},
        commessaId: 99,
        clienteId: null,
        opzioni: null,
        risposta: null,
        stato: "pendente",
        esito: null,
        motivoRifiuto: null,
        esecuzioneId: null,
        trigger: "test",
        createdAt: new Date(),
        decisaAt: null,
        decisaDa: null,
        decisaDaNome: null,
        seguitoAt: null,
        seguitoEsecuzioneId: null,
        origineId: null,
        chiaveAzione: "ticket:altra-sede",
      }
    );
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    for (const id of ids) {
      const index = proposte.findIndex(item => item.id === id);
      if (index >= 0) proposte.splice(index, 1);
    }
  });

  it("restituisce solo priorità della sede attiva con fonti", async () => {
    const result = await appRouter
      .createCaller(context(1))
      .tars.commandCenter.get({ limit: 8 });

    expect(result.priorities.some(item => item.proposalId === ids[0])).toBe(true);
    expect(result.priorities.some(item => item.proposalId === ids[1])).toBe(false);
    expect(result.priorities.find(item => item.proposalId === ids[0])?.evidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "email", id: "71" })])
    );
  });
});
