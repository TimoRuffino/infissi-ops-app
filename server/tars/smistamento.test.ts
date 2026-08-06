// Smistamento end-to-end con API Anthropic mockata: mail non collegata →
// Tars propone il collegamento → l'approvazione aggancia davvero la
// comunicazione. E la mail irrilevante, una volta esaminata, non torna
// in coda.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import { getTarsConfig } from "./stores";
import { smistaComunicazioni } from "./smistamento";
import {
  getComunicazione,
  insertComunicazione,
  listDaSmistare,
  _resetComunicazioniInMemoria,
} from "./comunicazioni";

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

function anthropicScript(responses: any[]) {
  let i = 0;
  return vi.fn(async () => ({
    ok: true,
    json: async () => responses[Math.min(i++, responses.length - 1)],
    text: async () => "",
  })) as any;
}

const usage = { input_tokens: 100, output_tokens: 50 };

describe("smistamento", () => {
  const realFetch = global.fetch;
  beforeAll(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    _resetComunicazioniInMemoria();
  });
  afterAll(() => {
    global.fetch = realFetch;
    delete process.env.ANTHROPIC_API_KEY;
    getTarsConfig().attivo = false;
  });

  it("mail senza commessa → proposta di collegamento → approvazione aggancia", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    getTarsConfig().attivo = true;

    const commessa = await caller.commesse.create({
      cliente: "Ferrari Giulia",
      citta: "Sarzana",
    });

    const mail = await insertComunicazione({
      sedeId: 1,
      casellaId: 1,
      messageId: "<da-smistare@example.com>",
      canale: "email",
      direzione: "in",
      mittente: "architetto@studio.it",
      mittenteNome: "Studio Tecnico",
      destinatari: ["ordini@ruffinogroup.it"],
      oggetto: "Infissi cantiere Ferrari",
      testo: "Buongiorno, in merito al cantiere della sig.ra Ferrari a Sarzana…",
      allegati: [],
      clienteId: null,
      commessaId: null,
      matchConfidenza: "nessuna",
      matchMotivo: null,
      stato: "nuova",
      receivedAt: new Date(),
    });
    expect(mail).not.toBeNull();

    global.fetch = anthropicScript([
      {
        stop_reason: "tool_use",
        usage,
        content: [
          {
            type: "tool_use",
            id: "tu_1",
            name: "cerca_commesse",
            input: { query: "Ferrari" },
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
            name: "proponi_collegamento",
            input: {
              comunicazioneId: mail!.id,
              commessaId: commessa.id,
              titolo: `Collega la mail dello Studio Tecnico a ${commessa.codice}`,
              motivazione:
                "La mail cita il cantiere Ferrari a Sarzana; la commessa corrisponde per cliente e città.",
              confidenza: "media",
            },
          },
        ],
      },
      {
        stop_reason: "end_turn",
        usage,
        content: [{ type: "text", text: "Proposto un collegamento." }],
      },
    ]);

    await smistaComunicazioni(1);

    // Proposta creata, mail marcata come esaminata.
    const pendenti = await caller.tars.proposte.list({ stato: "pendente" });
    const proposta = pendenti.find((p: any) => p.tipo === "collega_comunicazione");
    expect(proposta).toBeDefined();
    expect(proposta!.payload.comunicazioneId).toBe(mail!.id);
    expect(await listDaSmistare(1, 10)).toHaveLength(0);

    // Prima dell'approvazione la mail NON è collegata.
    let com = await getComunicazione(mail!.id, 1);
    expect(com!.commessaId).toBeNull();

    // Approvazione → aggancio reale.
    await caller.tars.proposte.approva({ id: proposta!.id });
    com = await getComunicazione(mail!.id, 1);
    expect(com!.commessaId).toBe(commessa.id);
    expect(com!.matchConfidenza).toBe("alta");
  });

  it("mail irrilevante: nessuna proposta, ma esaminata e fuori dalla coda", async () => {
    getTarsConfig().attivo = true;
    const spam = await insertComunicazione({
      sedeId: 1,
      casellaId: 1,
      messageId: "<newsletter@example.com>",
      canale: "email",
      direzione: "in",
      mittente: "news@fornitore-cancelleria.it",
      mittenteNome: null,
      destinatari: [],
      oggetto: "Offerte di agosto",
      testo: "Sconti su carta e toner!",
      allegati: [],
      clienteId: null,
      commessaId: null,
      matchConfidenza: "nessuna",
      matchMotivo: null,
      stato: "nuova",
      receivedAt: new Date(),
    });
    expect(spam).not.toBeNull();

    global.fetch = anthropicScript([
      {
        stop_reason: "tool_use",
        usage,
        content: [
          {
            type: "tool_use",
            id: "tu_1",
            name: "nessuna_azione",
            input: { motivo: "Solo una newsletter commerciale: nessun collegamento sensato." },
          },
        ],
      },
    ]);

    await smistaComunicazioni(1);
    expect(await listDaSmistare(1, 10)).toHaveLength(0);
    const com = await getComunicazione(spam!.id, 1);
    expect(com!.tarsAnalizzata).toBe(true);
    expect(com!.commessaId).toBeNull();
  });

  it("con Tars spento non parte e non consuma la coda", async () => {
    getTarsConfig().attivo = false;
    const mail = await insertComunicazione({
      sedeId: 1,
      casellaId: 1,
      messageId: "<con-tars-spento@example.com>",
      canale: "email",
      direzione: "in",
      mittente: "qualcuno@cliente.it",
      mittenteNome: null,
      destinatari: [],
      oggetto: "Richiesta",
      testo: "Vorrei un preventivo.",
      allegati: [],
      clienteId: null,
      commessaId: null,
      matchConfidenza: "nessuna",
      matchMotivo: null,
      stato: "nuova",
      receivedAt: new Date(),
    });
    expect(mail).not.toBeNull();

    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as any;
    await smistaComunicazioni(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await listDaSmistare(1, 10)).toHaveLength(1);
  });
});
