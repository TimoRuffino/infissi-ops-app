// Smistamento end-to-end con API OpenAI mockata: mail non collegata ->
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
import {
  _resetSmistamentoPerTest,
  leggiStatoSmistamento,
  programmaSmistamento,
  recuperaCodeSmistamento,
  smistaComunicazioni,
} from "./smistamento";
import {
  getComunicazione,
  insertComunicazione,
  listDaAnalizzare,
  _resetComunicazioniInMemoria,
} from "./comunicazioni";
import { openaiScript, toOpenAIResponse } from "./openaiTestHelpers";

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

const usage = { input_tokens: 100, output_tokens: 50 };

async function attendi(check: () => Promise<boolean>): Promise<boolean> {
  for (let i = 0; i < 60; i++) {
    if (await check()) return true;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return false;
}

async function inserisciMailTest(messageId: string, oggetto: string) {
  return insertComunicazione({
    sedeId: 1,
    casellaId: 1,
    messageId,
    canale: "email",
    direzione: "in",
    mittente: "contatto@example.com",
    mittenteNome: null,
    destinatari: [],
    oggetto,
    testo: "Richiesta operativa da classificare.",
    allegati: [],
    clienteId: null,
    commessaId: null,
    matchConfidenza: "nessuna",
    matchMotivo: null,
    stato: "nuova",
    receivedAt: new Date(),
  });
}

describe("smistamento", () => {
  const realFetch = global.fetch;
  beforeAll(() => {
    process.env.OPENAI_API_KEY = "test-key";
  });
  beforeEach(() => {
    _resetComunicazioniInMemoria();
    _resetSmistamentoPerTest();
  });
  afterAll(() => {
    _resetSmistamentoPerTest();
    global.fetch = realFetch;
    delete process.env.OPENAI_API_KEY;
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

    global.fetch = openaiScript([
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

    const fetchSpy = openaiScript([
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

    global.fetch = openaiScript([
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
    global.fetch = openaiScript([
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

    global.fetch = openaiScript([
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

    global.fetch = openaiScript([
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

  it("oltre 10 mail programma subito il lotto successivo", async () => {
    getTarsConfig().attivo = true;
    const mails = [];
    for (let i = 0; i < 11; i++) {
      mails.push(
        (await inserisciMailTest(`<lotto-${i}@example.com>`, `Richiesta ${i}`))!
      );
    }
    const classifica = (mail: (typeof mails)[number], i: number) => ({
      type: "tool_use",
      id: `tu_lotto_${i}`,
      name: "classifica_comunicazione",
      input: {
        comunicazioneId: mail.id,
        categoria: "operativa",
        confidenza: "alta",
        dubbio: false,
        motivo: "Richiesta operativa esplicita.",
      },
    });
    global.fetch = openaiScript([
      {
        stop_reason: "tool_use",
        usage,
        content: mails.slice(0, 10).map(classifica),
      },
      {
        stop_reason: "end_turn",
        usage,
        content: [{ type: "text", text: "Primo lotto classificato." }],
      },
      {
        stop_reason: "tool_use",
        usage,
        content: [classifica(mails[10], 10)],
      },
      {
        stop_reason: "end_turn",
        usage,
        content: [{ type: "text", text: "Secondo lotto classificato." }],
      },
    ]);

    await smistaComunicazioni(1);
    expect(await listDaAnalizzare(1, 20)).toHaveLength(1);
    expect((await leggiStatoSmistamento(1)).stato).toBe("programmato");

    await smistaComunicazioni(1);
    expect(await listDaAnalizzare(1, 20)).toHaveLength(0);
  });

  it("un arrivo durante il run non perde il risveglio della coda", async () => {
    getTarsConfig().attivo = true;
    const prima = (await inserisciMailTest(
      "<durante-run-1@example.com>",
      "Prima richiesta"
    ))!;
    let sbloccaPrima!: (response: any) => void;
    const primaRisposta = new Promise<any>(resolve => {
      sbloccaPrima = resolve;
    });
    let chiamata = 0;
    global.fetch = vi.fn(async () => {
      chiamata++;
      if (chiamata === 1) return primaRisposta;
      return {
        ok: true,
        json: async () =>
          toOpenAIResponse({
            stop_reason: "end_turn",
            usage,
            content: [{ type: "text", text: "Classificata." }],
          }),
        text: async () => "",
      };
    }) as any;

    const run = smistaComunicazioni(1);
    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const seconda = (await inserisciMailTest(
      "<durante-run-2@example.com>",
      "Seconda richiesta"
    ))!;
    programmaSmistamento(1, 0);
    sbloccaPrima({
      ok: true,
      json: async () =>
        toOpenAIResponse({
          stop_reason: "tool_use",
          usage,
          content: [
            {
              type: "tool_use",
              id: "tu_durante_run",
              name: "classifica_comunicazione",
              input: {
                comunicazioneId: prima.id,
                categoria: "operativa",
                confidenza: "alta",
                dubbio: false,
                motivo: "Richiesta operativa esplicita.",
              },
            },
          ],
        }),
      text: async () => "",
    });
    await run;

    expect((await listDaAnalizzare(1, 10)).map(c => c.id)).toEqual([
      seconda.id,
    ]);
    expect((await leggiStatoSmistamento(1)).stato).toBe("programmato");
  });

  it("un errore API mantiene la pausa anche se arriva un nuovo trigger", async () => {
    getTarsConfig().attivo = true;
    await inserisciMailTest("<api-down@example.com>", "Richiesta con API giù");
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      text: async () => "temporaneamente non disponibile",
    })) as any;

    const prima = Date.now();
    await smistaComunicazioni(1);
    programmaSmistamento(1, 0);
    const stato = await leggiStatoSmistamento(1);

    expect(stato.stato).toBe("pausa_errore");
    expect(stato.ripresaAt!.getTime() - prima).toBeGreaterThan(14 * 60_000);
  });

  it("il recupero trova una coda rimasta pendente dopo il bootstrap", async () => {
    getTarsConfig().attivo = true;
    await inserisciMailTest("<dopo-restart@example.com>", "Richiesta pendente");

    await recuperaCodeSmistamento();

    expect((await leggiStatoSmistamento(1)).stato).toBe("programmato");
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
    expect((await leggiStatoSmistamento(1)).stato).toBe("disattivato");
  });

  it("classifica automaticamente con la sola OPENAI_API_KEY", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    getTarsConfig().attivo = true;
    const mail = (await inserisciMailTest(
      "<openai-auto@example.com>",
      "Richiesta preventivo infissi"
    ))!;
    let chiamata = 0;
    global.fetch = vi.fn(async () => {
      chiamata++;
      return {
        ok: true,
        json: async () =>
          chiamata === 1
            ? {
                id: "resp_auto",
                model: "gpt-5.6-terra",
                status: "completed",
                output: [
                  {
                    id: "fc_auto",
                    type: "function_call",
                    call_id: "call_auto",
                    name: "classifica_comunicazione",
                    arguments: JSON.stringify({
                      comunicazioneId: mail.id,
                      categoria: "nuovo_lead",
                      confidenza: "alta",
                      dubbio: false,
                      motivo: "Richiesta esplicita di preventivo per infissi.",
                    }),
                    status: "completed",
                  },
                ],
                usage: { input_tokens: 100, output_tokens: 50 },
              }
            : {
                id: "resp_auto_done",
                model: "gpt-5.6-terra",
                status: "completed",
                output: [
                  {
                    id: "msg_auto_done",
                    type: "message",
                    role: "assistant",
                    status: "completed",
                    content: [{ type: "output_text", text: "Classificata." }],
                  },
                ],
                usage: { input_tokens: 50, output_tokens: 10 },
              },
        text: async () => "",
      };
    }) as any;

    try {
      await smistaComunicazioni(1);
      expect(await listDaAnalizzare(1, 10)).toHaveLength(0);
      expect((await getComunicazione(mail.id, 1))?.categoria).toBe(
        "nuovo_lead"
      );
    } finally {
      delete process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = "test-key";
    }
  });
});
