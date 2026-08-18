// Smistamento end-to-end con API Anthropic mockata: mail non collegata →
// Tars propone il collegamento → l'approvazione aggancia davvero la
// comunicazione. E la mail irrilevante, una volta esaminata, non torna
// in coda.

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import { getTarsConfig } from "./stores";
import { smistaComunicazioni } from "./smistamento";
import {
  getComunicazione,
  insertComunicazione,
  listDaAnalizzare,
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

async function attendi(check: () => Promise<boolean>): Promise<boolean> {
  for (let i = 0; i < 60; i++) {
    if (await check()) return true;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return false;
}

describe("smistamento", () => {
  const realFetch = global.fetch;
  beforeAll(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
  });
  beforeEach(() => _resetComunicazioniInMemoria());
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
      testo:
        "Buongiorno, in merito al cantiere della sig.ra Ferrari a Sarzana…",
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
            id: "tu_classifica",
            name: "classifica_comunicazione",
            input: {
              comunicazioneId: mail!.id,
              categoria: "operativa",
              confidenza: "alta",
              dubbio: false,
              motivo: "La mail cita un cantiere e una cliente identificabili.",
            },
          },
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
    const proposta = pendenti.find(
      (p: any) => p.tipo === "collega_comunicazione"
    );
    expect(proposta).toBeDefined();
    expect(proposta!.payload.comunicazioneId).toBe(mail!.id);
    expect(await listDaAnalizzare(1, 10)).toHaveLength(0);

    // Prima dell'approvazione la mail NON è collegata.
    let com = await getComunicazione(mail!.id, 1);
    expect(com!.commessaId).toBeNull();

    // Approvazione → aggancio reale.
    await caller.tars.proposte.approva({ id: proposta!.id });
    com = await getComunicazione(mail!.id, 1);
    expect(com!.commessaId).toBe(commessa.id);
    expect(com!.matchConfidenza).toBe("alta");
  });

  it("newsletter: viene classificata da Tars e poi esclusa", async () => {
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
      segnaliFiltro: {
        listUnsubscribe: "<mailto:unsubscribe@fornitore-cancelleria.it>",
        precedence: "bulk",
      },
      receivedAt: new Date(),
    });
    expect(spam).not.toBeNull();

    const fetchSpy = anthropicScript([
      {
        stop_reason: "tool_use",
        usage,
        content: [
          {
            type: "tool_use",
            id: "tu_spam",
            name: "classifica_comunicazione",
            input: {
              comunicazioneId: spam!.id,
              categoria: "offerta_marketing",
              confidenza: "alta",
              dubbio: false,
              motivo:
                "Newsletter promozionale massiva con disiscrizione e nessuna richiesta operativa.",
            },
          },
        ],
      },
      {
        stop_reason: "end_turn",
        usage,
        content: [{ type: "text", text: "Newsletter classificata." }],
      },
    ]);
    global.fetch = fetchSpy;

    await smistaComunicazioni(1);
    expect(fetchSpy).toHaveBeenCalled();
    expect(await listDaAnalizzare(1, 10)).toHaveLength(0);
    const com = await getComunicazione(spam!.id, 1);
    expect(com!.tarsAnalizzata).toBe(true);
    expect(com!.categoria).toBe("offerta_marketing");
    expect(com!.classificazioneFonte).toBe("tars");
    expect(com!.commessaId).toBeNull();
  });

  it("un dubbio di Tars resta visibile e dichiarato", async () => {
    getTarsConfig().attivo = true;
    const mail = await insertComunicazione({
      sedeId: 1,
      casellaId: 1,
      messageId: "<dubbia@example.com>",
      canale: "email",
      direzione: "in",
      mittente: "portale@example.com",
      mittenteNome: null,
      destinatari: [],
      oggetto: "Contatto",
      testo: "Vorrei informazioni. Disiscriviti dalle notifiche.",
      allegati: [],
      clienteId: null,
      commessaId: null,
      matchConfidenza: "nessuna",
      matchMotivo: null,
      stato: "nuova",
      receivedAt: new Date(),
    });

    global.fetch = anthropicScript([
      {
        stop_reason: "tool_use",
        usage,
        content: [
          {
            type: "tool_use",
            id: "tu_dubbio",
            name: "classifica_comunicazione",
            input: {
              comunicazioneId: mail!.id,
              categoria: "offerta_marketing",
              confidenza: "media",
              dubbio: true,
              motivo:
                "Potrebbe essere una richiesta reale inoltrata da un portale, ma il testo è incompleto.",
            },
          },
        ],
      },
      {
        stop_reason: "end_turn",
        usage,
        content: [{ type: "text", text: "Serve verifica umana." }],
      },
    ]);

    await smistaComunicazioni(1);
    const classificata = await getComunicazione(mail!.id, 1);
    expect(classificata?.categoria).toBe("da_classificare");
    expect(classificata?.classificazioneFonte).toBe("tars");
    expect(classificata?.classificazioneMotivo).toContain("Tars ha un dubbio");
    expect(await listDaAnalizzare(1, 10)).toHaveLength(0);
  });

  it("una mail saltata dal modello resta in coda per il tentativo successivo", async () => {
    getTarsConfig().attivo = true;
    const mail = await insertComunicazione({
      sedeId: 1,
      casellaId: 1,
      messageId: "<saltata@example.com>",
      canale: "email",
      direzione: "in",
      mittente: "contatto@example.com",
      mittenteNome: null,
      destinatari: [],
      oggetto: "Informazioni",
      testo: "Potete richiamarmi?",
      allegati: [],
      clienteId: null,
      commessaId: null,
      matchConfidenza: "nessuna",
      matchMotivo: null,
      stato: "nuova",
      receivedAt: new Date(),
    });
    global.fetch = anthropicScript([
      {
        stop_reason: "end_turn",
        usage,
        content: [{ type: "text", text: "Analisi incompleta." }],
      },
    ]);

    await smistaComunicazioni(1);
    expect((await listDaAnalizzare(1, 10)).map(c => c.id)).toContain(mail!.id);
    expect((await getComunicazione(mail!.id, 1))?.tarsAnalizzata).toBe(false);
  });

  it("Tars chiede l'assegnatario, poi propone e crea il lead", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    getTarsConfig().attivo = true;
    const mail = await insertComunicazione({
      sedeId: 1,
      casellaId: 1,
      messageId: "<nuovo-lead@example.com>",
      canale: "email",
      direzione: "in",
      mittente: "luca.bianchi@example.com",
      mittenteNome: "Luca Bianchi",
      destinatari: ["info@ruffinogroup.it"],
      oggetto: "Richiesta preventivo nuovi infissi",
      testo: "Vorrei un sopralluogo per sostituire sei finestre a Lerici.",
      allegati: [],
      clienteId: null,
      commessaId: null,
      matchConfidenza: "nessuna",
      matchMotivo: null,
      stato: "nuova",
      receivedAt: new Date(),
    });
    expect(mail?.categoria).toBe("da_classificare");

    global.fetch = anthropicScript([
      {
        stop_reason: "tool_use",
        usage,
        content: [
          {
            type: "tool_use",
            id: "tu_classifica_lead",
            name: "classifica_comunicazione",
            input: {
              comunicazioneId: mail!.id,
              categoria: "nuovo_lead",
              confidenza: "alta",
              dubbio: false,
              motivo: "Richiesta esplicita di preventivo e sopralluogo.",
            },
          },
          {
            type: "tool_use",
            id: "tu_assegnatari",
            name: "leggi_assegnatari",
            input: {},
          },
        ],
      },
      {
        stop_reason: "tool_use",
        usage,
        content: [
          {
            type: "tool_use",
            id: "tu_domanda",
            name: "chiedi_chiarimento",
            input: {
              comunicazioneId: mail!.id,
              domanda: "A chi assegno la richiesta di Luca Bianchi?",
              contesto:
                "È una nuova richiesta di preventivo senza cliente o commessa corrispondenti.",
              opzioni: ["Admin Ruffino"],
            },
          },
        ],
      },
      {
        stop_reason: "end_turn",
        usage,
        content: [{ type: "text", text: "Mi serve l'assegnatario." }],
      },
    ]);

    const esito = await caller.tars.analizzaComunicazione({
      comunicazioneId: mail!.id,
      istruzione: "Se è un nuovo contatto, prepara cliente e commessa.",
    });
    expect(esito.proposte.some((p: any) => p.tipo === "crea_lead")).toBe(false);
    const domanda = esito.proposte.find((p: any) => p.tipo === "domanda");
    expect(domanda).toBeDefined();
    expect(domanda.payload.comunicazioneId).toBe(mail!.id);
    expect(domanda.opzioni).toContain("Admin Ruffino");
    expect((await getComunicazione(mail!.id, 1))?.categoria).toBe("nuovo_lead");

    global.fetch = anthropicScript([
      {
        stop_reason: "tool_use",
        usage,
        content: [
          {
            type: "tool_use",
            id: "tu_cerca_cliente",
            name: "cerca_clienti",
            input: { query: "Luca Bianchi" },
          },
          {
            type: "tool_use",
            id: "tu_cerca_commessa",
            name: "cerca_commesse",
            input: { query: "Luca Bianchi Lerici" },
          },
        ],
      },
      {
        stop_reason: "tool_use",
        usage,
        content: [
          {
            type: "tool_use",
            id: "tu_lead",
            name: "proponi_nuovo_lead",
            input: {
              comunicazioneId: mail!.id,
              nome: "Luca",
              cognome: "Bianchi",
              tipo: "privato",
              email: "luca.bianchi@example.com",
              citta: "Lerici",
              assegnatoA: 1,
              prodotti: [{ nome: "Finestre", quantita: 6 }],
              titolo: "Crea il lead Luca Bianchi",
              motivazione:
                "La mail chiede preventivo e sopralluogo; l'operatore l'ha assegnata ad Admin Ruffino.",
              confidenza: "alta",
            },
          },
        ],
      },
      {
        stop_reason: "end_turn",
        usage,
        content: [{ type: "text", text: "Ho preparato il nuovo lead." }],
      },
    ]);

    const risposta: any = await caller.tars.proposte.rispondi({
      id: domanda.id,
      risposta: "Admin Ruffino",
    });
    expect(risposta.seguitoAvviato).toBe(true);
    const propostaArrivata = await attendi(async () => {
      const pendenti = await caller.tars.proposte.list({ stato: "pendente" });
      return pendenti.some(
        (p: any) => p.tipo === "crea_lead" && p.origineId === domanda.id
      );
    });
    expect(propostaArrivata).toBe(true);

    const pendenti = await caller.tars.proposte.list({ stato: "pendente" });
    const proposta = pendenti.find(
      (p: any) => p.tipo === "crea_lead" && p.origineId === domanda.id
    );
    expect(proposta).toBeDefined();
    expect(proposta.payload.comunicazioneId).toBe(mail!.id);
    expect(proposta.payload.assegnatoA).toBe(1);

    await caller.tars.proposte.approva({ id: proposta.id });
    const collegata = await getComunicazione(mail!.id, 1);
    expect(collegata?.clienteId).not.toBeNull();
    expect(collegata?.commessaId).not.toBeNull();
    expect(collegata?.tarsAnalizzata).toBe(true);
    const creata = await caller.commesse.byId(collegata!.commessaId!);
    expect(creata?.stato).toBe("preventivo");
    expect(creata?.prodotti[0]?.quantita).toBe(6);
    expect(creata?.assegnatoA).toBe(1);
    const cliente = await caller.clienti.byId(collegata!.clienteId!);
    expect(cliente?.assegnatoA).toBe(1);
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
    expect(await listDaAnalizzare(1, 10)).toHaveLength(1);
  });
});
