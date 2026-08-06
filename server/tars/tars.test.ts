// Test end-to-end di Tars con l'API Anthropic mockata: il loop chiama gli
// strumenti veri (caller tRPC, store in memoria), solo l'LLM è scriptato.
// Copre: analizza → tool di lettura → proposta → approvazione → mutation
// reale, più nessuna_azione e il rifiuto con motivo.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import { proposte, getTarsConfig } from "./stores";

function makeCtx(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "local-1",
      name: "Admin Ruffino",
      email: "admin@ruffinogroup.it",
      loginMethod: "local",
      role: "admin",
      ruolo: "direzione",
      ruoli: ["direzione"],
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } as any,
    req: { protocol: "http", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    sedeId: 1,
    sediIds: [1],
  };
}

// Risposte Anthropic scriptate, consumate in ordine da ogni fetch.
function anthropicScript(responses: any[]) {
  let i = 0;
  return vi.fn(async () => {
    const body = responses[Math.min(i++, responses.length - 1)];
    return {
      ok: true,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as any;
  });
}

const usage = { input_tokens: 100, output_tokens: 50 };

describe("tars", () => {
  const realFetch = global.fetch;
  beforeAll(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
  });
  afterAll(() => {
    global.fetch = realFetch;
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("analizza → legge → propone pagamento → approvazione esegue la mutation reale", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);

    // Attiva l'agente (di default è spento).
    await caller.tars.config.setAttivo({ attivo: true });
    expect(getTarsConfig().attivo).toBe(true);

    // Dati di prova: cliente + commessa con pattuito.
    const cliente = await caller.clienti.create({
      nome: "Mario",
      cognome: "Rossi",
      telefono: "3401234567",
    });
    const commessa = await caller.commesse.create({
      clienteId: cliente.id,
      importoTotale: 8640,
      citta: "Sarzana",
    });

    global.fetch = anthropicScript([
      {
        stop_reason: "tool_use",
        usage,
        content: [
          { type: "text", text: "Guardo il fascicolo." },
          {
            type: "tool_use",
            id: "tu_1",
            name: "leggi_commessa",
            input: { commessaId: commessa.id },
          },
        ],
      },
      {
        stop_reason: "tool_use",
        usage,
        content: [
          {
            type: "tool_use",
            id: "tu_2",
            name: "proponi_pagamento",
            input: {
              commessaId: commessa.id,
              importo: 4320,
              data: "2026-08-01",
              metodo: "bonifico",
              tipo: "acconto_1",
              nota: "Fattura FIC 2026/312",
              titolo: `Registra acconto €4.320 su ${commessa.codice}`,
              motivazione:
                "La fattura FIC 2026/312 risulta pagata ma il registro acconti non la riporta.",
              confidenza: "alta",
            },
          },
        ],
      },
      {
        stop_reason: "end_turn",
        usage,
        content: [
          {
            type: "text",
            text: "Ho verificato il fascicolo e proposto la registrazione del primo acconto.",
          },
        ],
      },
    ]) as any;

    const esito = await caller.tars.analizza({ commessaId: commessa.id });

    expect(esito.esito).toBe("ok");
    expect(esito.proposte).toHaveLength(1);
    const proposta = esito.proposte[0];
    expect(proposta.tipo).toBe("pagamento");
    expect(proposta.stato).toBe("pendente");
    expect(proposta.payload.importo).toBe(4320);
    expect(proposta.payload.tipo).toBe("acconto_1");
    expect(esito.riepilogo).toMatch(/primo acconto/);

    // Prima dell'approvazione la commessa NON è cambiata.
    let c = await caller.commesse.byId(commessa.id);
    expect(c!.importoIncassato ?? 0).toBe(0);

    // Approvazione → passa da commesse.addPagamento con il ctx dell'operatore.
    const approvata = await caller.tars.proposte.approva({ id: proposta.id });
    expect(approvata.stato).toBe("approvata");

    c = await caller.commesse.byId(commessa.id);
    expect(c!.importoIncassato).toBe(4320);
    expect(c!.pagamenti).toHaveLength(1);
    expect(c!.pagamenti[0].tipo).toBe("acconto_1");
    expect(c!.pagamenti[0].note).toBe("Fattura FIC 2026/312");
  });

  it("nessuna_azione termina senza proposte", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const commessa = await caller.commesse.create({ cliente: "Verdi Anna" });

    global.fetch = anthropicScript([
      {
        stop_reason: "tool_use",
        usage,
        content: [
          {
            type: "tool_use",
            id: "tu_1",
            name: "nessuna_azione",
            input: { motivo: "La commessa è appena aperta: tutto coerente." },
          },
        ],
      },
    ]) as any;

    const esito = await caller.tars.analizza({ commessaId: commessa.id });
    expect(esito.esito).toBe("ok");
    expect(esito.proposte).toHaveLength(0);
    expect(esito.riepilogo).toMatch(/appena aperta/);
  });

  it("rifiuta registra il motivo e non tocca i dati", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const commessa = await caller.commesse.create({
      cliente: "Bianchi Luca",
      importoTotale: 1000,
    });

    global.fetch = anthropicScript([
      {
        stop_reason: "tool_use",
        usage,
        content: [
          {
            type: "tool_use",
            id: "tu_1",
            name: "proponi_pagamento",
            input: {
              commessaId: commessa.id,
              importo: 500,
              data: "2026-08-05",
              titolo: "Registra acconto €500",
              motivazione: "Prova.",
              confidenza: "media",
            },
          },
        ],
      },
      { stop_reason: "end_turn", usage, content: [{ type: "text", text: "Fatto." }] },
    ]) as any;

    const esito = await caller.tars.analizza({ commessaId: commessa.id });
    const rifiutata = await caller.tars.proposte.rifiuta({
      id: esito.proposte[0].id,
      motivo: "azione_non_necessaria",
    });
    expect(rifiutata.stato).toBe("rifiutata");
    expect(rifiutata.motivoRifiuto).toBe("azione_non_necessaria");

    const c = await caller.commesse.byId(commessa.id);
    expect(c!.importoIncassato ?? 0).toBe(0);
    // Una proposta decisa non è più approvabile.
    await expect(
      caller.tars.proposte.approva({ id: rifiutata.id })
    ).rejects.toThrow(/già decisa/);
  });

  it("commesse archiviate: analisi rifiutata", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const commessa = await caller.commesse.create({ cliente: "Neri Paola" });
    await caller.commesse.archive(commessa.id);

    await expect(
      caller.tars.analizza({ commessaId: commessa.id })
    ).rejects.toThrow(/archiviate/);
  });

  it("le proposte restano nella coda sede-scoped", () => {
    // Tutte le proposte create nei test appartengono alla sede 1.
    expect(proposte.every((p) => p.sedeId === 1)).toBe(true);
  });
});

describe("tars.chat", () => {
  const realFetch = global.fetch;
  beforeAll(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  it("un ordine in chat diventa proposta nel messaggio di risposta", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    await caller.tars.config.setAttivo({ attivo: true });
    const commessa = await caller.commesse.create({
      cliente: "Chat Test",
      importoTotale: 3000,
    });

    global.fetch = anthropicScript([
      {
        stop_reason: "tool_use",
        usage,
        content: [
          { type: "text", text: "Controllo la commessa." },
          {
            type: "tool_use",
            id: "tu_1",
            name: "leggi_commessa",
            input: { commessaId: commessa.id },
          },
        ],
      },
      {
        stop_reason: "tool_use",
        usage,
        content: [
          {
            type: "tool_use",
            id: "tu_2",
            name: "proponi_pagamento",
            input: {
              commessaId: commessa.id,
              importo: 1500,
              data: "2026-08-06",
              tipo: "acconto_1",
              titolo: `Registra acconto €1.500 su ${commessa.codice}`,
              motivazione: "Richiesto dall'operatore in chat; pattuito coerente.",
              confidenza: "alta",
            },
          },
        ],
      },
      {
        stop_reason: "end_turn",
        usage,
        content: [
          { type: "text", text: "Pronto: approva qui sotto e registro la rata." },
        ],
      },
    ]) as any;

    const risposta = await caller.tars.chat.invia({
      testo: `registra un acconto di 1500 euro su ${commessa.codice}`,
    });
    expect(risposta.ruolo).toBe("tars");
    expect(risposta.proposte).toHaveLength(1);
    expect((risposta.proposte[0] as any).tipo).toBe("pagamento");

    // La conversazione è persistita e idratata.
    const storia = await caller.tars.chat.get();
    expect(storia.length).toBe(2);
    expect(storia[0].ruolo).toBe("utente");
    expect(storia[1].proposte).toHaveLength(1);

    // Approvazione dalla chat → mutation reale.
    await caller.tars.proposte.approva({ id: (risposta.proposte[0] as any).id });
    const c = await caller.commesse.byId(commessa.id);
    expect(c!.importoIncassato).toBe(1500);

    // Pulizia della conversazione.
    await caller.tars.chat.pulisci();
    expect(await caller.tars.chat.get()).toHaveLength(0);
  });
});
