// Test end-to-end di Tars con OpenAI Responses mockata: il loop chiama gli
// strumenti veri (caller tRPC, store in memoria), solo l'LLM è scriptato.
// Copre: analizza → tool di lettura → proposta → approvazione → mutation
// reale, più nessuna_azione e il rifiuto con motivo.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { appRouter } from "../routers";
import {
  bloccoDecisioni,
  buildSystemPrompt,
  buildSystemPromptForTrigger,
} from "./prompt";
import type { TrpcContext } from "../_core/context";
import {
  proposte,
  esecuzioni,
  getTarsConfig,
  budgetMensileSuperato,
  costoEsecuzioneUsd,
  applicaMigrazioneConfigTars,
  normalizeExecutionMetadata,
  tarsOutcomes,
  newPropostaId,
  getChat,
  saveChat,
} from "./stores";
import {
  eseguiStrumento,
  TOOL_DEFS,
  toolDefsForTrigger,
  type ToolRuntime,
} from "./tools";
import { callOpenAI } from "./openai";
import { openaiScript } from "./openaiTestHelpers";
import {
  buildPromptCacheKey,
  buildContextPreload,
  visibilityScopeForUser,
} from "./loop";
import {
  deleteComunicazione,
  getComunicazione,
  insertComunicazione,
} from "./comunicazioni";
import { deleteFileQuiet, putFile } from "../_core/fileStorage";
import { deleteDocumentiByCommessa } from "../routers/preventiviContratti";
import type { EntityContextSnapshot } from "./context/types";
import {
  setFeatureFlags,
  setFeatureFlagsForTesting,
} from "../platform/featureFlags";
import { processExperimentRepository } from "./processExperiments";
import { extractProcessMetrics, type CompanyFrame } from "./processMetrics";
import { getActionCaseRepository } from "../actionCenter/repository";
import { upsertDocumentiEmessi } from "../routers/ficFatture";
import { upsertCostiFic } from "../routers/ficCosti";
import { createMemoryReminderRepository } from "../reminders/repository";
import {
  createReminderService,
  setReminderServiceForTesting,
} from "../reminders/service";
import { createMemoryNotificationRepository } from "../notifications/repository";
import { getUtentiStore } from "../routers/utenti";
import { meritaSeguito } from "./seguito";

afterEach(() => {
  vi.useRealTimers();
  setReminderServiceForTesting(null);
});

function seedProcessSnapshot(sedeId = 1) {
  const frame: CompanyFrame = {
    clienti: { attivi: 40, senzaTelefonoOEmail: 3, nonAssegnati: 2 },
    commesse: {
      attive: 40,
      nonAssegnate: 4,
      ferme: Array.from({ length: 12 }, (_, index) => ({ id: 10_000 + index })),
    },
    operativita: {
      interventiDaPresidiare: [{ id: 20_001 }, { id: 20_002 }],
      merceInRitardo: [{ id: 30_001 }],
    },
    tars: { esecuzioni30Giorni: 20, errori30Giorni: 2 },
  };
  processExperimentRepository.saveSnapshot(
    sedeId,
    extractProcessMetrics(frame),
    new Date()
  );
}

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

describe("tars", () => {
  const realFetch = global.fetch;
  beforeAll(() => {
    process.env.OPENAI_API_KEY = "test-key";
  });
  afterAll(() => {
    global.fetch = realFetch;
    delete process.env.OPENAI_API_KEY;
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

    global.fetch = openaiScript([
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
    const [approvata, concorrente] = await Promise.all([
      caller.tars.proposte.approva({ id: proposta.id }),
      caller.tars.proposte.approva({ id: proposta.id }),
    ]);
    expect(approvata.stato).toBe("approvata");
    expect(concorrente.stato).toBe("approvata");

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

    global.fetch = openaiScript([
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

    global.fetch = openaiScript([
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
      {
        stop_reason: "end_turn",
        usage,
        content: [{ type: "text", text: "Fatto." }],
      },
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
    expect(proposte.every(p => p.sedeId === 1)).toBe(true);
  });
});

describe("tars — contesto scoped ed evidence-first", () => {
  const snapshot = (
    overrides: Partial<EntityContextSnapshot> = {}
  ): EntityContextSnapshot => ({
    id: 1,
    key: {
      sedeId: 1,
      entityType: "commessa",
      entityId: 44,
      scope: "operativo",
    },
    version: 3,
    schemaVersion: "1",
    collectorVersion: "1",
    policyVersion: "policy-enforce-v1",
    fingerprint: "ctx-44-v3",
    facts: [
      {
        key: "commessa.stato",
        value: { stato: "produzione" },
        confidence: "certain",
        evidence: [
          {
            sourceType: "commessa",
            sourceId: "44",
            label: "Scheda commessa",
            version: "2026-08-25T08:00:00.000Z",
            link: "/commesse/44",
          },
        ],
      },
    ],
    evidence: [],
    summary: {
      summary: "La commessa è in produzione.",
      openQuestions: [],
      risks: [],
      nextActions: [],
    },
    state: "ready",
    errorCode: null,
    createdAt: new Date("2026-08-25T08:00:00.000Z"),
    expiresAt: new Date("2026-08-25T09:00:00.000Z"),
    stale: false,
    definitive: true,
    ...overrides,
  });

  it("deriva lo scope dalle capability e rispetta gli override di negazione", () => {
    const commerciale = { id: 7, ruoli: ["commerciale"], sediIds: [1] };
    const amministrazione = {
      id: 8,
      ruoli: ["amministrazione"],
      sediIds: [1],
    };
    const direzione = { id: 9, ruoli: ["direzione"], sediIds: [1] };

    expect(visibilityScopeForUser(commerciale, 1, [])).toBe("operativo");
    expect(visibilityScopeForUser(amministrazione, 1, [])).toBe(
      "amministrazione"
    );
    expect(visibilityScopeForUser(direzione, 1, [])).toBe("direzione");
    expect(
      visibilityScopeForUser(direzione, 1, [
        {
          capability: "economia.read",
          effect: "deny",
          sedeId: 1,
          source: "override",
        },
      ])
    ).toBe("operativo");
  });

  it("precarica soltanto fatti compatti e dichiara un contesto scaduto", () => {
    const fresh = buildContextPreload(snapshot());
    expect(fresh.useLiveFallback).toBe(false);
    expect(fresh.content).toContain("fatto_verificato");
    expect(fresh.content).toContain("ctx-44-v3");
    expect(fresh.evidenceRefs).toHaveLength(1);
    expect(fresh.factsRead).toBe(1);

    const stale = buildContextPreload(
      snapshot({ stale: true, definitive: false })
    );
    expect(stale.useLiveFallback).toBe(true);
    expect(stale.content).toMatch(/scaduto|stale/i);
    expect(stale.factsRead).toBe(0);
  });

  it("il fallback live non espone dati amministrativi a un commerciale", async () => {
    const commessa = await appRouter.createCaller(makeCtx()).commesse.create({
      cliente: "Scope Commerciale",
      importoTotale: 12_500,
    });
    const ctx = makeCtx();
    (ctx.user as any).role = "user";
    (ctx.user as any).ruolo = "commerciale";
    (ctx.user as any).ruoli = ["commerciale"];
    const rt: ToolRuntime = {
      ctx,
      esecuzioneId: 999_800,
      trigger: "on_demand",
      maxProposte: 3,
      proposteIds: [],
      terminato: null,
      contextScope: "operativo",
      evidenceRefs: [],
    };

    const result = await eseguiStrumento(rt, "leggi_fascicolo_commessa", {
      commessaId: commessa.id,
    });
    const fascicolo = JSON.parse(result.content);
    expect(fascicolo.contesto.scope).toBe("operativo");
    expect(fascicolo.commessa).not.toHaveProperty("importoTotale");
    expect(fascicolo.commessa).not.toHaveProperty("pagamenti");
    expect(fascicolo.commessa).not.toHaveProperty("costi");
    expect(rt.factsRevalidated).toBeGreaterThan(0);
  });

  it("non crea una proposta importante senza alcuna prova verificata", async () => {
    const rt: ToolRuntime = {
      ctx: makeCtx(),
      esecuzioneId: 999_801,
      trigger: "audit_processi",
      maxProposte: 3,
      proposteIds: [],
      terminato: null,
      evidenceRefs: [],
    };
    const result = await eseguiStrumento(rt, "proponi_bozza_risposta", {
      destinatario: "Cliente",
      canale: "email",
      testo: "Testo",
      titolo: "Invia aggiornamento al cliente",
      motivazione: "La situazione richiede un aggiornamento.",
      confidenza: "alta",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/prova|evidenza/i);
  });

  it("applica default neutrali ai metadati di contesto legacy", () => {
    const legacy: Record<string, unknown> = {};
    normalizeExecutionMetadata(legacy);
    expect(legacy).toMatchObject({
      contextFingerprint: null,
      contextScope: null,
      contextCacheHit: false,
      evidenceRefs: [],
      factsRead: 0,
      factsRevalidated: 0,
    });
  });
});

describe("tars — routing intent bounded", () => {
  it("usa il workflow minimo per un comando esplicito senza una chiamata di routing", async () => {
    const ctx = makeCtx();
    const bodies: any[] = [];
    const realFetch = global.fetch;
    process.env.OPENAI_API_KEY = "test-key";
    setFeatureFlagsForTesting(
      1,
      { plannerMode: "active" },
      { actorUserId: 1, reason: "Test intent router" }
    );
    global.fetch = vi.fn(async (_url, init: any) => {
      bodies.push(JSON.parse(init.body));
      return {
        ok: true,
        json: async () => ({
          id: "resp_intent_bounded",
          model: "gpt-5.6-sol",
          status: "completed",
          output: [
            {
              id: "msg_intent_bounded",
              type: "message",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: "Mi manca il telefono." }],
            },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      } as any;
    }) as any;

    try {
      const { runTars } = await import("./loop");
      await runTars({
        ctx,
        trigger: "chat",
        commessaId: null,
        richiesta: "Crea cliente e commessa per Mario Rossi",
      });

      expect(bodies).toHaveLength(1);
      expect(bodies[0].tools.map((tool: any) => tool.name)).toEqual([
        "cerca_clienti",
        "leggi_cliente",
        "cerca_commesse",
        "leggi_assegnatari",
        "proponi_nuovo_lead",
        "chiedi_chiarimento",
        "nessuna_azione",
      ]);
      expect(bodies[0].input.at(-1).content).toContain(
        'intent="create_customer_job"'
      );
    } finally {
      global.fetch = realFetch;
      delete process.env.OPENAI_API_KEY;
      setFeatureFlags(
        1,
        { plannerMode: "off" },
        { actorUserId: 1, reason: "Ripristino test intent router" }
      );
    }
  });
});

describe("tars.chat", () => {
  const realFetch = global.fetch;
  beforeAll(() => {
    process.env.OPENAI_API_KEY = "test-key";
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

    global.fetch = openaiScript([
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
              motivazione:
                "Richiesto dall'operatore in chat; pattuito coerente.",
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
            text: "Pronto: approva qui sotto e registro la rata.",
          },
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
    await caller.tars.proposte.approva({
      id: (risposta.proposte[0] as any).id,
    });
    const c = await caller.commesse.byId(commessa.id);
    expect(c!.importoIncassato).toBe(1500);

    // Pulizia della conversazione.
    await caller.tars.chat.pulisci();
    expect(await caller.tars.chat.get()).toHaveLength(0);
  });

  it("crea cliente e commessa da chat senza richiedere una comunicazione", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    await caller.tars.config.setAttivo({ attivo: true });

    global.fetch = openaiScript([
      {
        stop_reason: "tool_use",
        usage,
        content: [
          {
            type: "tool_use",
            id: "tu_cerca_cliente_chat",
            name: "cerca_clienti",
            input: { query: "Giulia Ferri" },
          },
          {
            type: "tool_use",
            id: "tu_assegnatari_chat",
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
            id: "tu_crea_cliente_commessa_chat",
            name: "proponi_nuovo_lead",
            input: {
              nome: "Giulia",
              cognome: "Ferri",
              tipo: "privato",
              email: "giulia.ferri@example.com",
              citta: "Sarzana",
              assegnatoA: 1,
              prodotti: [{ nome: "Finestre", quantita: 4 }],
              titolo: "Crea cliente e commessa per Giulia Ferri",
              motivazione:
                "L'operatore ha richiesto esplicitamente in chat una nuova anagrafica con commessa preventivo.",
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
            text: "Ho preparato la creazione: approva la proposta.",
          },
        ],
      },
    ]) as any;

    const risposta = await caller.tars.chat.invia({
      testo:
        "Crea il cliente Giulia Ferri e una commessa per 4 finestre a Sarzana, assegnata a me.",
    });
    expect(risposta.proposte).toHaveLength(1);
    expect((risposta.proposte[0] as any).tipo).toBe("crea_lead");
    expect(
      await caller.clienti.list({ search: "giulia.ferri@example.com" })
    ).toHaveLength(0);

    await caller.tars.proposte.approva({
      id: (risposta.proposte[0] as any).id,
    });

    const clientiCreati = await caller.clienti.list({
      search: "giulia.ferri@example.com",
    });
    expect(clientiCreati).toHaveLength(1);
    expect(clientiCreati[0].assegnatoA).toBe(1);
    const commesseCreate = await caller.commesse.list({
      clienteId: clientiCreati[0].id,
    });
    expect(commesseCreate).toHaveLength(1);
    expect(commesseCreate[0].stato).toBe("preventivo");
    expect(commesseCreate[0].prodottiSintesi).toEqual([
      { nome: "Finestre", quantita: 4 },
    ]);
    expect(commesseCreate[0].assegnatoA).toBe(1);

    await caller.tars.chat.pulisci();
  });

  it("da chat trova per numero un allegato WhatsApp e lo propone alla commessa nominata", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    await caller.tars.config.setAttivo({ attivo: true });
    const cliente = await caller.clienti.create({
      nome: "Mario",
      cognome: "Rossi Chat",
      telefono: "+39 340 222 3344",
    });
    const commessa = await caller.commesse.create({
      clienteId: cliente.id,
      cliente: "Rossi Chat Mario",
    });
    const bytes = Buffer.from("foto whatsapp da chat", "utf8");
    const stored = await putFile(
      "tars_chat_test",
      commessa.id,
      999_157,
      "foto-cantiere.jpg",
      bytes,
      "image/jpeg"
    );
    const comunicazione = await insertComunicazione({
      sedeId: 1,
      casellaId: 999_157,
      messageId: "wamid.tars-chat-document-1",
      canale: "whatsapp",
      direzione: "in",
      mittente: "393402223344",
      mittenteNome: "Mario Rossi Chat",
      destinatari: ["Ufficio Ruffino"],
      oggetto: "WhatsApp",
      testo: "Foto del cantiere da mettere in commessa.",
      allegati: [
        {
          nome: "foto-cantiere.jpg",
          mimeType: "image/jpeg",
          size: bytes.length,
          storageKey: stored.storageKey,
          mediaId: "MEDIA_TARS_CHAT_DOCUMENT_1",
        },
      ],
      clienteId: cliente.id,
      commessaId: null,
      matchConfidenza: "alta",
      matchMotivo: "Numero del cliente riconosciuto",
      stato: "nuova",
      receivedAt: new Date("2026-08-25T14:00:00Z"),
    });
    expect(comunicazione?.categoria).toBe("da_classificare");

    global.fetch = openaiScript([
      {
        stop_reason: "tool_use",
        usage,
        content: [
          {
            type: "tool_use",
            id: "tu_cerca_wa_chat",
            name: "cerca_comunicazioni",
            input: {
              canale: "whatsapp",
              query: "+39 340 222 3344",
              limite: 10,
            },
          },
          {
            type: "tool_use",
            id: "tu_cerca_commessa_chat",
            name: "cerca_commesse",
            input: { query: "Mario Rossi Chat" },
          },
        ],
      },
      {
        stop_reason: "tool_use",
        usage,
        content: [
          {
            type: "tool_use",
            id: "tu_classifica_wa_chat",
            name: "classifica_comunicazione",
            input: {
              comunicazioneId: comunicazione!.id,
              categoria: "operativa",
              confidenza: "alta",
              dubbio: false,
              motivo:
                "L'operatore identifica il file come foto della commessa Mario Rossi Chat.",
            },
          },
        ],
      },
      {
        stop_reason: "tool_use",
        usage,
        content: [
          {
            type: "tool_use",
            id: "tu_archivia_wa_chat",
            name: "proponi_archivia_allegato",
            input: {
              comunicazioneId: comunicazione!.id,
              allegatoIndex: 0,
              commessaId: commessa.id,
              tipoDocumento: "foto",
              evidenze: [
                "Numero WhatsApp indicato dall'operatore",
                "Una sola commessa Mario Rossi Chat",
              ],
              titolo: "Archivia la foto WhatsApp di Mario Rossi Chat",
              motivazione:
                "Il numero, il mittente e la commessa nominata dall'operatore corrispondono.",
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
            text: "Ho trovato una sola foto: approva la proposta per archiviarla.",
          },
        ],
      },
    ]) as any;

    try {
      const risposta = await caller.tars.chat.invia({
        testo:
          "Allega il file inviato dal numero +39 340 222 3344 alla commessa Mario Rossi Chat.",
      });
      expect(risposta.proposte).toEqual([
        expect.objectContaining({
          tipo: "archivia_allegato",
          commessaId: commessa.id,
        }),
      ]);

      await caller.tars.proposte.approva({
        id: (risposta.proposte[0] as any).id,
      });
      expect(await caller.preventiviContratti.byCommessa(commessa.id)).toEqual(
        [
          expect.objectContaining({
            nome: "Foto Rossi Chat Mario.jpg",
            sourceRef: `1:${comunicazione!.id}:0`,
          }),
        ]
      );
    } finally {
      await caller.tars.chat.pulisci();
      deleteDocumentiByCommessa(commessa.id);
      await deleteComunicazione(comunicazione!.id, 1);
      deleteFileQuiet(stored.storageKey);
      global.fetch = realFetch;
    }
  });
});

// ── Un rifiuto è definitivo ────────────────────────────────────────────────
// Il blocco nel system prompt è un suggerimento; questo è il muro. Serve a
// una cosa sola: che l'operatore non veda due volte la stessa proposta.
describe("tars — proposta rifiutata non torna", () => {
  const realFetch = global.fetch;
  beforeAll(() => {
    process.env.OPENAI_API_KEY = "test-key";
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  function propostaPagamento(
    commessaId: number,
    importo: number,
    titolo: string
  ) {
    return {
      stop_reason: "tool_use",
      usage,
      content: [
        {
          type: "tool_use",
          id: "tu_1",
          name: "proponi_pagamento",
          input: {
            commessaId,
            importo,
            data: "2026-08-10",
            tipo: "acconto_1",
            titolo,
            motivazione: "Prova di ripetizione.",
            confidenza: "alta",
          },
        },
      ],
    };
  }
  const chiusura = {
    stop_reason: "end_turn",
    usage,
    content: [{ type: "text", text: "Chiudo." }],
  };

  it("la stessa proposta non rientra in coda, e il modello sa perché", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    await caller.tars.config.setAttivo({ attivo: true });
    const commessa = await caller.commesse.create({
      cliente: "Ripetizione Srl",
      importoTotale: 2000,
    });
    const titolo = `Registra acconto €1.000 su ${commessa.codice}`;

    global.fetch = openaiScript([
      propostaPagamento(commessa.id, 1000, titolo),
      chiusura,
    ]) as any;
    const primo = await caller.tars.analizza({ commessaId: commessa.id });
    expect(primo.proposte).toHaveLength(1);

    await caller.tars.proposte.rifiuta({
      id: primo.proposte[0].id,
      motivo: "azione_non_necessaria",
    });

    // Identica: payload uguale.
    global.fetch = openaiScript([
      propostaPagamento(commessa.id, 1000, titolo),
      chiusura,
    ]) as any;
    const secondo = await caller.tars.analizza({ commessaId: commessa.id });
    expect(secondo.proposte).toHaveLength(0);
    // Il modello riceve il motivo del rifiuto: è quello che gli evita di
    // riscrivere la stessa proposta con altre parole.
    const registro = esecuzioni.find(e => e.id === secondo.esecuzioneId)!;
    expect(registro.strumenti[0].esito).toMatch(/gi\u00e0 stata rifiutata/);
    expect(registro.strumenti[0].esito).toMatch(/azione non necessaria/);

    // Riscritta: payload diverso, stesso titolo → bloccata comunque.
    global.fetch = openaiScript([
      propostaPagamento(commessa.id, 999, titolo),
      chiusura,
    ]) as any;
    const terzo = await caller.tars.analizza({ commessaId: commessa.id });
    expect(terzo.proposte).toHaveLength(0);

    // In coda resta solo la rifiutata: nessun doppione.
    const suQuesta = proposte.filter(p => p.commessaId === commessa.id);
    expect(suQuesta).toHaveLength(1);
    expect(suQuesta[0].stato).toBe("rifiutata");
  });

  it("una proposta identica già pendente non si duplica", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const commessa = await caller.commesse.create({
      cliente: "Doppione Spa",
      importoTotale: 5000,
    });
    const titolo = `Registra acconto €2.500 su ${commessa.codice}`;

    global.fetch = openaiScript([
      propostaPagamento(commessa.id, 2500, titolo),
      chiusura,
    ]) as any;
    await caller.tars.analizza({ commessaId: commessa.id });

    global.fetch = openaiScript([
      propostaPagamento(commessa.id, 2500, titolo),
      chiusura,
    ]) as any;
    const secondo = await caller.tars.analizza({ commessaId: commessa.id });
    expect(secondo.proposte).toHaveLength(0);
    expect(
      proposte.filter(
        p => p.commessaId === commessa.id && p.stato === "pendente"
      )
    ).toHaveLength(1);
  });

  it("un'azione già approvata non viene proposta di nuovo", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const commessa = await caller.commesse.create({
      cliente: "Approvazione Unica Srl",
      importoTotale: 6000,
    });

    global.fetch = openaiScript([
      propostaPagamento(
        commessa.id,
        3000,
        `Registra acconto €3.000 su ${commessa.codice}`
      ),
      chiusura,
    ]) as any;
    const primo = await caller.tars.analizza({ commessaId: commessa.id });
    await caller.tars.proposte.approva({ id: primo.proposte[0].id });

    global.fetch = openaiScript([
      propostaPagamento(
        commessa.id,
        3000,
        `Aggiungi il primo acconto da €3.000 a ${commessa.codice}`
      ),
      chiusura,
    ]) as any;
    const secondo = await caller.tars.analizza({ commessaId: commessa.id });

    expect(secondo.proposte).toHaveLength(0);
    const registro = esecuzioni.find(e => e.id === secondo.esecuzioneId)!;
    expect(registro.proposteDuplicateBloccate).toBe(1);
    expect(registro.strumenti[0].esito).toMatch(/gia presente o da correggere/);
    expect(
      proposte.filter(
        p => p.commessaId === commessa.id && p.tipo === "pagamento"
      )
    ).toHaveLength(1);
  });
});

// ── Seguito di una decisione ───────────────────────────────────────────────
// Approvare una segnalazione conferma un problema, non lo risolve: Tars
// riparte una volta per proporre l'azione che lo chiude.
describe("tars — seguito dell'approvazione", () => {
  const realFetch = global.fetch;
  beforeAll(() => {
    process.env.OPENAI_API_KEY = "test-key";
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  async function attendi(cond: () => boolean, ms = 3000) {
    const fine = Date.now() + ms;
    while (Date.now() < fine) {
      if (cond()) return true;
      await new Promise(r => setTimeout(r, 20));
    }
    return cond();
  }

  it("segnalazione approvata → proposta di azione, e il seguito non si ripete", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    await caller.tars.config.setAttivo({ attivo: true });
    const commessa = await caller.commesse.create({
      cliente: "Seguito Test",
      importoTotale: 4000,
    });

    global.fetch = openaiScript([
      {
        stop_reason: "tool_use",
        usage,
        content: [
          {
            type: "tool_use",
            id: "tu_1",
            name: "proponi_segnalazione",
            input: {
              severita: "alta",
              descrizione:
                "Il cliente sollecita su una posa già data per fatta.",
              commessaId: commessa.id,
              titolo: `Incoerenza sulla posa di ${commessa.codice}`,
              motivazione:
                "La timeline dice posata, il cliente scrive che non lo è.",
              confidenza: "alta",
            },
          },
        ],
      },
      {
        stop_reason: "end_turn",
        usage,
        content: [{ type: "text", text: "Segnalato." }],
      },
    ]) as any;

    const analisi = await caller.tars.analizza({ commessaId: commessa.id });
    const segnalazione = analisi.proposte[0];
    expect(segnalazione.tipo).toBe("segnalazione");

    // Il seguito parte all'approvazione: da qui il modello propone l'azione.
    global.fetch = openaiScript([
      {
        stop_reason: "tool_use",
        usage,
        content: [
          {
            type: "tool_use",
            id: "tu_2",
            name: "proponi_ticket",
            input: {
              commessaId: commessa.id,
              oggetto: "Verifica posa contestata",
              descrizione: "Il cliente sostiene che la posa non è avvenuta.",
              categoria: "difetto_posa",
              priorita: "alta",
              titolo: `Apri ticket verifica posa su ${commessa.codice}`,
              motivazione:
                "La segnalazione approvata resta aperta: serve un intervento.",
              confidenza: "alta",
            },
          },
        ],
      },
      {
        stop_reason: "end_turn",
        usage,
        content: [{ type: "text", text: "Proposto il ticket." }],
      },
    ]) as any;

    const approvata: any = await caller.tars.proposte.approva({
      id: segnalazione.id,
    });
    expect(approvata.seguitoAvviato).toBe(true);

    const arrivata = await attendi(() =>
      proposte.some(p => p.origineId === segnalazione.id)
    );
    expect(arrivata).toBe(true);

    const seguito = proposte.find(p => p.origineId === segnalazione.id)!;
    expect(seguito.tipo).toBe("ticket");
    expect(seguito.stato).toBe("pendente");
    expect(seguito.trigger).toBe("seguito");

    // Approvare il seguito NON genera un altro seguito: la catena finisce.
    const decisa: any = await caller.tars.proposte.approva({ id: seguito.id });
    expect(decisa.seguitoAvviato).toBe(false);
    expect(proposte.filter(p => p.origineId === seguito.id)).toHaveLength(0);
  });

  it("l'analisi resta leggibile sulla commessa dopo la decisione", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const commessa = await caller.commesse.create({ cliente: "Memoria Test" });

    global.fetch = openaiScript([
      {
        stop_reason: "tool_use",
        usage,
        content: [
          {
            type: "tool_use",
            id: "tu_1",
            name: "nessuna_azione",
            input: {
              motivo:
                "Tutto coerente: documenti al loro posto, saldo a zero e nessun passo mancante.",
            },
          },
        ],
      },
    ]) as any;
    await caller.tars.analizza({ commessaId: commessa.id });

    const storico = await caller.tars.esecuzioni.perCommessa({
      commessaId: commessa.id,
    });
    expect(storico).toHaveLength(1);
    expect(storico[0].riepilogo).toMatch(/coerente/);
  });
});

// ── Budget mensile ─────────────────────────────────────────────────────────
// La spesa è una stima dai token, ma il muro è vero: automatici fermi,
// umani con errore che dice il numero.
describe("tars — budget mensile", () => {
  const realFetch = global.fetch;
  beforeAll(() => {
    process.env.OPENAI_API_KEY = "test-key";
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  it("costoEsecuzioneUsd: prezzi giusti per modello, cache scontata", () => {
    // 1M token in + 1M out su Terra: 2 + 12 = 14 $.
    expect(
      costoEsecuzioneUsd({
        modello: "gpt-5.6-terra",
        tokensIn: 1_000_000,
        tokensOut: 1_000_000,
        tokensCacheRead: 0,
        tokensCacheWrite5m: 0,
        tokensCacheWrite1h: 0,
      })
    ).toBeCloseTo(14);
    // Luna è il modello ad alto volume: 0,2 + 1,2 = 1,4 $.
    expect(
      costoEsecuzioneUsd({
        modello: "gpt-5.6-luna",
        tokensIn: 1_000_000,
        tokensOut: 1_000_000,
        tokensCacheRead: 0,
        tokensCacheWrite5m: 0,
        tokensCacheWrite1h: 0,
      })
    ).toBeCloseTo(1.4);
    // I modelli Claude restano coperti per lo storico dei costi.
    // 1M token in + 1M out su Sonnet: 3 + 15 = 18 $.
    expect(
      costoEsecuzioneUsd({
        modello: "claude-sonnet-5",
        tokensIn: 1_000_000,
        tokensOut: 1_000_000,
        tokensCacheRead: 0,
        tokensCacheWrite5m: 0,
        tokensCacheWrite1h: 0,
      })
    ).toBeCloseTo(18);
    // Cache read su Opus: 0.1× dell'input → 1M letti dalla cache = 0.5 $.
    expect(
      costoEsecuzioneUsd({
        modello: "claude-opus-5",
        tokensIn: 0,
        tokensOut: 0,
        tokensCacheRead: 1_000_000,
        tokensCacheWrite5m: 0,
        tokensCacheWrite1h: 0,
      })
    ).toBeCloseTo(0.5);
    // Scrittura a 1 ora: 2× l'input. 1M token su Sonnet = 6 $, non 3.75.
    expect(
      costoEsecuzioneUsd({
        modello: "claude-sonnet-5",
        tokensIn: 0,
        tokensOut: 0,
        tokensCacheRead: 0,
        tokensCacheWrite5m: 0,
        tokensCacheWrite1h: 1_000_000,
      })
    ).toBeCloseTo(6);
    // La stessa quantità a 5 minuti costa 1.25×.
    expect(
      costoEsecuzioneUsd({
        modello: "claude-sonnet-5",
        tokensIn: 0,
        tokensOut: 0,
        tokensCacheRead: 0,
        tokensCacheWrite5m: 1_000_000,
        tokensCacheWrite1h: 0,
      })
    ).toBeCloseTo(3.75);
    // Modello sconosciuto → prezzo Opus (per eccesso, mai per difetto).
    expect(
      costoEsecuzioneUsd({
        modello: null,
        tokensIn: 1_000_000,
        tokensOut: 0,
        tokensCacheRead: 0,
        tokensCacheWrite5m: 0,
        tokensCacheWrite1h: 0,
      })
    ).toBeCloseTo(5);
  });

  it("oltre il budget: analizza rifiuta col numero, sotto budget passa", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    await caller.tars.config.setAttivo({ attivo: true });
    const commessa = await caller.commesse.create({ cliente: "Budget Test" });

    // Un'esecuzione da ~30 $ su un budget di 20: il muro deve chiudere.
    await caller.tars.config.setBudget({ budgetMensileUsd: 20 });
    esecuzioni.push({
      id: 999_001,
      sedeId: 1,
      trigger: "on_demand",
      modello: "claude-opus-5",
      commessaId: null,
      richiesta: "",
      strumenti: [],
      proposteIds: [],
      riepilogo: null,
      tokensIn: 1_000_000, // 5 $
      tokensOut: 1_000_000, // 25 $
      tokensCacheRead: 0,
      tokensCacheWrite5m: 0,
      tokensCacheWrite1h: 0,
      durataMs: 0,
      esito: "ok",
      errore: null,
      utenteId: null,
      utenteNome: null,
      createdAt: new Date(),
    });
    expect(budgetMensileSuperato(1)).toBe(true);

    await expect(
      caller.tars.analizza({ commessaId: commessa.id })
    ).rejects.toThrow(/Budget mensile di Tars esaurito.*\$20/);
    await expect(caller.tars.chat.invia({ testo: "ciao" })).rejects.toThrow(
      /Budget mensile/
    );

    // Il budget non tocca le altre sedi.
    expect(budgetMensileSuperato(2)).toBe(false);

    // Tetto alzato → si riparte.
    await caller.tars.config.setBudget({ budgetMensileUsd: 100 });
    expect(budgetMensileSuperato(1)).toBe(false);

    // Pulizia: l'esecuzione finta non deve sporcare gli altri test.
    const idx = esecuzioni.findIndex(e => e.id === 999_001);
    esecuzioni.splice(idx, 1);
    await caller.tars.config.setBudget({ budgetMensileUsd: 25 });
  });

  it("i lavori automatici girano sul modello economico", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    await caller.tars.config.setAttivo({ attivo: true });
    const commessa = await caller.commesse.create({ cliente: "Modello Test" });

    global.fetch = openaiScript([
      {
        stop_reason: "tool_use",
        usage,
        content: [
          {
            type: "tool_use",
            id: "tu_1",
            name: "nessuna_azione",
            input: { motivo: "Niente da fare." },
          },
        ],
      },
    ]) as any;

    // on_demand → modello principale.
    const r1 = await caller.tars.analizza({ commessaId: commessa.id });
    const e1 = esecuzioni.find(e => e.id === r1.esecuzioneId)!;
    expect(e1.modello).toBe(getTarsConfig(1).modello);

    // trigger economico → modello automatico.
    global.fetch = openaiScript([
      {
        stop_reason: "tool_use",
        usage,
        content: [
          {
            type: "tool_use",
            id: "tu_2",
            name: "nessuna_azione",
            input: { motivo: "Niente." },
          },
        ],
      },
    ]) as any;
    const { runTars } = await import("./loop");
    const e2 = await runTars({
      ctx,
      trigger: "smistamento",
      commessaId: null,
      richiesta: "test",
    });
    expect(e2.modello).toBe(getTarsConfig(1).modelloAutomatico);
    expect(e2.modello).not.toBe(getTarsConfig(1).modello);
  });

  it("dopo il budget strumenti concede un solo turno finale senza tool", async () => {
    const ctx = makeCtx();
    const config = getTarsConfig(1);
    const maxPrima = config.maxToolCalls;
    config.maxToolCalls = 1;
    let chiamate = 0;
    const usaTool = {
      stop_reason: "tool_use",
      usage,
      content: [
        {
          type: "tool_use",
          id: "tu_budget",
          name: "leggi_quadro_azienda",
          input: {},
        },
      ],
    };
    global.fetch = openaiScript([usaTool, usaTool, usaTool, usaTool]);
    const fetchOriginale = global.fetch;
    const corpi: any[] = [];
    global.fetch = vi.fn(async (...args: any[]) => {
      chiamate++;
      corpi.push(JSON.parse(args[1].body));
      if (chiamate > 4) throw new Error("loop strumenti non terminato");
      return (fetchOriginale as any)(...args);
    }) as any;

    try {
      const { runTars } = await import("./loop");
      const esecuzione = await runTars({
        ctx,
        trigger: "on_demand",
        commessaId: null,
        richiesta: "Controlla il quadro.",
      });

      expect(esecuzione.esito).toBe("budget_esaurito");
      expect(chiamate).toBe(2);
      expect(corpi[0].tools.length).toBeGreaterThan(0);
      expect(corpi[1]).not.toHaveProperty("tools");
    } finally {
      config.maxToolCalls = maxPrima;
    }
  });

  it("contabilizza i token anche quando OpenAI restituisce incomplete", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        id: "resp_incomplete_loop",
        model: "gpt-5.6-terra",
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output: [],
        usage: {
          input_tokens: 150,
          output_tokens: 20,
          input_tokens_details: {
            cached_tokens: 100,
            cache_write_tokens: 25,
          },
        },
      }),
    })) as any;
    const { runTars } = await import("./loop");
    const esecuzione = await runTars({
      ctx: makeCtx(),
      trigger: "on_demand",
      commessaId: null,
      richiesta: "Analizza.",
    });

    expect(esecuzione.esito).toBe("errore");
    expect(esecuzione.tokensIn).toBe(25);
    expect(esecuzione.tokensOut).toBe(20);
    expect(esecuzione.tokensCacheRead).toBe(100);
    expect(esecuzione.tokensCacheWrite5m).toBe(25);
  });

  it("migra i modelli Claude senza sovrascrivere i guardrail della sede", () => {
    const config = {
      ...getTarsConfig(1),
      modello: "claude-opus-5",
      modelloAutomatico: "claude-sonnet-5",
      maxToolCalls: 7,
      timeoutMs: 45_000,
      versioneDefault: 3,
    };

    applicaMigrazioneConfigTars(config);

    expect(config.modello).toBe("gpt-5.6-sol");
    expect(config.modelloAutomatico).toBe("gpt-5.6-terra");
    expect(config.maxToolCalls).toBe(7);
    expect(config.timeoutMs).toBe(45_000);
    expect(config.versioneDefault).toBe(4);
  });
});

// ── Il prefisso della cache deve restare immobile ──────────────────────────
// system e strumenti sono la parte cara del prompt e stanno a monte di tutto:
// se qualcosa di volatile ci finisce dentro, ogni click su «approva» butta via
// la cache. Questo test è il guardiano di quell'invariante.
describe("tars — prefisso stabile per la cache", () => {
  it("il system prompt non contiene le decisioni, che cambiano a ogni click", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const commessa = await caller.commesse.create({ cliente: "Cache Test" });

    const prima = buildSystemPrompt(1);

    // Una decisione: prima finiva nel system e ne cambiava i byte.
    proposte.push({
      id: 999_100,
      sedeId: 1,
      tipo: "segnalazione",
      titolo: "Titolo che non deve entrare nel system",
      motivazione: "x",
      confidenza: "alta",
      payload: {},
      commessaId: commessa.id,
      clienteId: null,
      opzioni: null,
      risposta: null,
      stato: "rifiutata",
      esito: null,
      motivoRifiuto: "azione_non_necessaria",
      esecuzioneId: null,
      trigger: "on_demand",
      createdAt: new Date(),
      decisaAt: new Date(),
      decisaDa: 1,
      decisaDaNome: "Admin",
      seguitoAt: null,
      seguitoEsecuzioneId: null,
      origineId: null,
      requestedByUserId: null,
      hiddenForUserIds: [],
    });

    const dopo = buildSystemPrompt(1);
    expect(dopo).toBe(prima); // byte identici → la cache regge
    expect(dopo).not.toContain("Titolo che non deve entrare nel system");

    // Il blocco esiste ancora: è solo montato nel turno utente.
    const blocco = bloccoDecisioni(1);
    expect(blocco).toContain("Titolo che non deve entrare nel system");
    expect(blocco).toContain("azione non necessaria");

    proposte.splice(
      proposte.findIndex(p => p.id === 999_100),
      1
    );
  });
});

describe("tars — profili e cache operativa", () => {
  const realFetch = global.fetch;
  afterAll(() => {
    global.fetch = realFetch;
  });

  it("carica solo gli strumenti necessari nei trigger automatici", () => {
    const riconciliazione = toolDefsForTrigger("riconciliazione_fatture");
    const smistamento = toolDefsForTrigger("smistamento");
    const audit = toolDefsForTrigger("audit_processi");
    const nomi = riconciliazione.map(t => t.name);

    expect(riconciliazione.length).toBeLessThan(TOOL_DEFS.length / 2);
    expect(JSON.stringify(riconciliazione).length).toBeLessThan(
      JSON.stringify(TOOL_DEFS).length * 0.45
    );
    expect(nomi).toContain("proponi_collegamento_fattura");
    expect(nomi).toContain("leggi_fascicolo_commessa");
    expect(nomi).not.toContain("proponi_ticket");
    expect(smistamento.map(t => t.name)).toEqual([
      "classifica_comunicazione",
      "cerca_clienti",
      "cerca_commesse",
      "leggi_fascicolo_commessa",
      "leggi_allegato",
      "proponi_collegamento",
      "proponi_archivia_allegato",
      "chiedi_chiarimento",
      "nessuna_azione",
    ]);
    expect(JSON.stringify(smistamento).length).toBeLessThan(
      JSON.stringify(TOOL_DEFS).length * 0.25
    );
    expect(audit.map(t => t.name)).toEqual([
      "leggi_assegnatari",
      "leggi_quadro_azienda",
      "proponi_segnalazione",
      "proponi_miglioramento_processo",
      "chiedi_chiarimento",
      "nessuna_azione",
    ]);
    const gestioneDocumento = toolDefsForTrigger(
      "chat",
      "manage_document"
    ).map(t => t.name);
    expect(gestioneDocumento).toContain("cerca_comunicazioni");
    expect(gestioneDocumento).toContain("cerca_commesse");
    expect(gestioneDocumento).toContain("proponi_archivia_allegato");
    expect(toolDefsForTrigger("chat")).toBe(TOOL_DEFS);
  });

  it("espone proponi_promemoria solo nei percorsi umani previsti", () => {
    expect(toolDefsForTrigger("chat").map((tool) => tool.name)).toContain(
      "proponi_promemoria",
    );
    expect(toolDefsForTrigger("seguito").map((tool) => tool.name)).toContain(
      "proponi_promemoria",
    );
    expect(toolDefsForTrigger("smistamento").map((tool) => tool.name)).not.toContain(
      "proponi_promemoria",
    );
    expect(toolDefsForTrigger("audit_processi").map((tool) => tool.name)).not.toContain(
      "proponi_promemoria",
    );
  });

  it("il prompt distingue promemoria, nota e calendario", () => {
    const prompt = buildSystemPrompt(1);
    expect(prompt).toContain("promemoria personale");
    expect(prompt).toContain("chiedi sempre quando");
    expect(prompt).toContain("non usare proponi_nota_timeline");
  });

  it("rifiuta un promemoria senza domanda temporale risposta", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T10:00:00.000Z"));
    const rt: ToolRuntime = {
      ctx: makeCtx(),
      esecuzioneId: 999_901,
      trigger: "chat",
      maxProposte: 3,
      proposteIds: [],
      terminato: null,
      origineId: null,
      risultatiCache: new Map(),
    };

    const result = await eseguiStrumento(rt, "proponi_promemoria", {
      text: "Invia preventivo",
      remindAtIso: "2026-08-27T09:00:00+02:00",
      timezone: "Europe/Rome",
      titolo: "Invia preventivo",
      motivazione: "Richiesto dall'operatore",
      confidenza: "alta",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("chiedere quando");
  });

  it("non deduplica le domande promemoria di due utenti diversi", async () => {
    const firstCtx = makeCtx();
    const secondCtx = {
      ...firstCtx,
      user: { ...(firstCtx.user as any), id: 2, openId: "local-2" },
    } as TrpcContext;
    const runtime = (ctx: TrpcContext, executionId: number): ToolRuntime => ({
      ctx,
      esecuzioneId: executionId,
      trigger: "chat",
      maxProposte: 3,
      proposteIds: [],
      terminato: null,
      risultatiCache: new Map(),
    });
    const first = runtime(firstCtx, 999_904);
    const second = runtime(secondCtx, 999_905);
    const input = {
      domanda: "Quando vuoi che te lo ricordi?",
      contesto: "Serve data e ora.",
      intent: "promemoria",
      requestedText: "Inviare il preventivo",
    };

    expect((await eseguiStrumento(first, "chiedi_chiarimento", input)).isError)
      .not.toBe(true);
    expect((await eseguiStrumento(second, "chiedi_chiarimento", input)).isError)
      .not.toBe(true);
    expect(first.proposteIds).toHaveLength(1);
    expect(second.proposteIds).toHaveLength(1);

    for (const id of [...first.proposteIds, ...second.proposteIds]) {
      const index = proposte.findIndex((item) => item.id === id);
      if (index >= 0) proposte.splice(index, 1);
    }
  });

  it("consente un secondo chiarimento temporale senza catene automatiche generiche", async () => {
    const rt: ToolRuntime = {
      ctx: makeCtx(),
      esecuzioneId: 999_906,
      trigger: "seguito",
      maxProposte: 3,
      proposteIds: [],
      terminato: null,
      origineId: 999_000,
      risultatiCache: new Map(),
    };
    await eseguiStrumento(rt, "chiedi_chiarimento", {
      domanda: "A che ora esatta?",
      contesto: "La risposta precedente non contieneva un'ora.",
      intent: "promemoria",
      requestedText: "Inviare il preventivo",
    });
    const id = rt.proposteIds[0];
    const question = proposte.find((item) => item.id === id)!;
    question.stato = "risposta";
    question.risposta = "Alle 9";

    expect(meritaSeguito(question)).toBe(true);

    const index = proposte.findIndex((item) => item.id === id);
    if (index >= 0) proposte.splice(index, 1);
  });

  it("crea il promemoria solo dopo domanda, risposta e approvazione del richiedente", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T10:00:00.000Z"));
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const users = getUtentiStore();
    const insertedUser = !users.some((user: any) => Number(user.id) === 1);
    if (insertedUser) {
      users.push({
        id: 1,
        nome: "Admin",
        cognome: "Ruffino",
        attivo: true,
        sediIds: [1],
        ruoli: ["direzione"],
      });
    }
    const reminders = createMemoryReminderRepository();
    setReminderServiceForTesting(
      createReminderService({
        reminders,
        notifications: createMemoryNotificationRepository(),
        now: () => new Date(),
      }),
    );
    const createdProposalIds: number[] = [];

    const questionRuntime: ToolRuntime = {
      ctx,
      esecuzioneId: 999_902,
      trigger: "chat",
      maxProposte: 3,
      proposteIds: [],
      terminato: null,
      origineId: null,
      risultatiCache: new Map(),
    };
    const asked = await eseguiStrumento(
      questionRuntime,
      "chiedi_chiarimento",
      {
        domanda: "Quando vuoi che te lo ricordi?",
        contesto: "Serve una data e un'ora esatte.",
        intent: "promemoria",
        requestedText: "Chiamare Rossi",
      },
    );
    expect(asked.isError).not.toBe(true);
    const questionId = questionRuntime.proposteIds[0];
    createdProposalIds.push(questionId);
    const question = proposte.find((item) => item.id === questionId)!;
    question.seguitoAt = new Date();
    await caller.tars.proposte.rispondi({
      id: questionId,
      risposta: "27 agosto 2026 alle 09:00",
    });

    const proposalRuntime: ToolRuntime = {
      ...questionRuntime,
      esecuzioneId: 999_903,
      trigger: "seguito",
      proposteIds: [],
      origineId: questionId,
    };
    const proposed = await eseguiStrumento(
      proposalRuntime,
      "proponi_promemoria",
      {
        text: "Chiamare Rossi",
        remindAtIso: "2026-08-27T09:00:00+02:00",
        timezone: "Europe/Rome",
        titolo: "Ricorda di chiamare Rossi",
        motivazione: "Data e ora confermate dall'operatore.",
        confidenza: "alta",
      },
    );
    expect(proposed.isError).not.toBe(true);
    const proposalId = proposalRuntime.proposteIds[0];
    createdProposalIds.push(proposalId);

    const approved = await caller.tars.proposte.approva({ id: proposalId });
    expect(approved.stato).toBe("approvata");
    expect(approved.requestedByName).toBe("Admin Ruffino");
    const repeated = await caller.tars.proposte.approva({ id: proposalId });
    expect(repeated.approvazioneRipetuta).toBe(true);
    expect(await reminders.findById(1, 1, 1)).toMatchObject({
      sourceProposalId: proposalId,
      recipientUserId: 1,
      text: "Chiamare Rossi",
    });

    const otherCtx = {
      ...ctx,
      user: { ...(ctx.user as any), id: 2, openId: "local-2" },
    } as TrpcContext;
    const otherCaller = appRouter.createCaller(otherCtx);
    await expect(
      otherCaller.tars.proposte.rispondi({
        id: questionId,
        risposta: "Domani alle 10",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      otherCaller.tars.proposte.approva({ id: proposalId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    for (const id of createdProposalIds) {
      const index = proposte.findIndex((item) => item.id === id);
      if (index >= 0) proposte.splice(index, 1);
    }
    if (insertedUser) {
      const index = users.findIndex((user: any) => Number(user.id) === 1);
      if (index >= 0) users.splice(index, 1);
    }
  });

  it("usa per lo smistamento un prompt compatto che protegge opportunità e sicurezza", () => {
    const completo = buildSystemPrompt(1);
    const smistamento = buildSystemPromptForTrigger(1, "smistamento");

    expect(smistamento.length).toBeLessThan(completo.length * 0.45);
    expect(smistamento).toMatch(/non esegui nulla/i);
    expect(smistamento).toMatch(/contenuto esterno.*non.*istruzione/is);
    expect(smistamento).toMatch(/richiesta di preventivo/i);
    expect(smistamento).toMatch(/da_classificare/i);
    expect(smistamento).toMatch(/classifica.*ogni comunicazione/is);
    expect(smistamento).toMatch(/allegat.*proponi_archivia_allegato/is);
    expect(smistamento).not.toContain("cerca_comunicazioni");
    expect(completo).toMatch(
      /numero.*indirizzo email.*cerca_comunicazioni.*cerca_commesse/is
    );
    expect(completo).toMatch(
      /WhatsApp.*da_classificare.*classifica_comunicazione/is
    );
  });

  it("segmenta la cache per sede, profilo e modello con una chiave breve", () => {
    const sedeUno = buildPromptCacheKey(1, "smistamento", "gpt-5.6-terra");
    const sedeDue = buildPromptCacheKey(2, "smistamento", "gpt-5.6-terra");

    expect(sedeUno).toBe("tars:v2:s1:smistamento:gpt-5.6-terra");
    expect(sedeDue).not.toBe(sedeUno);
    expect(sedeUno.length).toBeLessThanOrEqual(64);
  });

  it("costruisce un quadro aziendale compatto e sede-scoped", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    await caller.clienti.create({ nome: "Quadro", cognome: "Azienda" });
    await caller.commesse.create({
      cliente: "Quadro Azienda",
      priorita: "urgente",
    });
    const rt: ToolRuntime = {
      ctx,
      esecuzioneId: 999_150,
      trigger: "audit_processi",
      maxProposte: 3,
      proposteIds: [],
      terminato: null,
      risultatiCache: new Map(),
      toolCacheHits: 0,
      duplicatiBloccati: 0,
    };

    const result = await eseguiStrumento(rt, "leggi_quadro_azienda", {
      giorniFermo: 10,
    });
    expect(result.isError).toBeFalsy();
    const quadro = JSON.parse(result.content);
    expect(quadro.clienti.totali).toBeGreaterThan(0);
    expect(quadro.commesse.attive).toBeGreaterThan(0);
    expect(quadro.commesse.urgenti).toBeGreaterThan(0);
    expect(quadro).toHaveProperty("qualita");
    expect(quadro).toHaveProperty("produzioneAcquisti");
    expect(quadro).toHaveProperty("tars.duplicatiBloccati30Giorni");
  });

  it("legge l'economia con fonti e valori FiC compatti", async () => {
    const sedeId = 98;
    const ctx = { ...makeCtx(), sedeId, sediIds: [sedeId] };
    const anno = new Date().getFullYear();
    upsertDocumentiEmessi(
      [
        {
          id: 99801,
          tipo: "invoice",
          numero: "TARS-98",
          data: `${anno}-02-10`,
          clienteNome: "Cliente Tars Economia",
          clienteVat: null,
          clienteCf: null,
          importoNetto: 1_000,
          importoIva: 220,
          importoLordo: 1_220,
          rate: [
            {
              importo: 600,
              stato: "paid",
              scadenza: null,
              dataPagamento: `${anno}-03-12`,
            },
          ],
        },
      ],
      sedeId,
      "tars-economia"
    );
    upsertCostiFic(
      [
        {
          id: 99802,
          tipo: "expense",
          data: `${anno}-02-11`,
          fornitoreId: null,
          fornitoreNome: "Fornitore Tars Economia",
          categoriaFic: "Materiali",
          descrizione: "Materiali",
          centro: null,
          numeroDocumento: "CT-98",
          importoNetto: 400,
          importoIva: 88,
          importoLordo: 488,
          rate: [
            {
              importo: 200,
              stato: "paid",
              scadenza: null,
              dataPagamento: `${anno}-03-15`,
            },
          ],
        },
      ],
      sedeId,
      "tars-economia"
    );
    const rt: ToolRuntime = {
      ctx,
      esecuzioneId: 999_151,
      trigger: "on_demand",
      maxProposte: 3,
      proposteIds: [],
      terminato: null,
      risultatiCache: new Map(),
      toolCacheHits: 0,
      duplicatiBloccati: 0,
    };

    const result = await eseguiStrumento(rt, "leggi_economia", { anno });
    const economia = JSON.parse(result.content);

    expect(result.isError).toBeFalsy();
    expect(economia.fonteEffettivi).toBe("Fatture in Cloud");
    expect(economia.periodo).toEqual({
      anno,
      criteri: {
        competenza: "data documento",
        cassa: "data pagamento",
      },
    });
    expect(economia.venditeFiC.netto).toBe(1_000);
    expect(economia.acquistiFiC.netto).toBe(400);
    expect(economia.confrontoIncassi).toMatchObject({
      crm: 0,
      fic: 600,
      scostamento: -600,
    });
    expect(economia.andamentoMensile[2]).toMatchObject({
      incassiCrmCassa: 0,
      incassiFicCassa: 600,
      usciteFicCassa: 200,
    });
    expect(economia).not.toHaveProperty("fic");
    expect(economia).toHaveProperty("coperturaCostiFissi.affidabilita");
  });

  it("espone a Tars l'id FiC necessario per collegare una fattura letta", async () => {
    const sedeId = 99;
    const ctx = { ...makeCtx(), sedeId, sediIds: [sedeId] };
    const anno = new Date().getFullYear();
    upsertDocumentiEmessi(
      [
        {
          id: 999_301,
          tipo: "invoice",
          numero: "124",
          data: `${anno}-08-26`,
          clienteNome: "Picchia Marco",
          clienteVat: null,
          clienteCf: null,
          importoNetto: 9_067.21,
          importoIva: 1_994.79,
          importoLordo: 11_062,
          rate: [],
        },
      ],
      sedeId,
      "tars-fic-id"
    );
    const rt: ToolRuntime = {
      ctx,
      esecuzioneId: 999_301,
      trigger: "on_demand",
      maxProposte: 3,
      proposteIds: [],
      terminato: null,
      risultatiCache: new Map(),
      toolCacheHits: 0,
      duplicatiBloccati: 0,
    };

    const result = await eseguiStrumento(rt, "leggi_fatture_cloud", {
      query: "Picchia",
      soloNonRiconciliate: true,
    });
    const fatture = JSON.parse(result.content);

    expect(result.isError).toBeFalsy();
    expect(fatture).toContainEqual(
      expect.objectContaining({
        ficId: 999_301,
        numero: "124",
        riconciliazione: "non_abbinabile",
      })
    );
  });

  it("propone di archiviare un allegato operativo nella commessa verificata", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const cliente = await caller.clienti.create({
      nome: "Marco",
      cognome: "Picchia",
      email: "picchia-documenti@example.test",
    });
    const commessa = await caller.commesse.create({
      clienteId: cliente.id,
      cliente: "Picchia Marco",
    });
    const bytes = Buffer.from("misure esecutive", "utf8");
    const stored = await putFile(
      "tars_test",
      commessa.id,
      1,
      "Misure Picchia.pdf",
      bytes,
      "application/pdf"
    );
    const comunicazione = await insertComunicazione({
      sedeId: 1,
      casellaId: 1,
      messageId: "tars-document-intake-1",
      canale: "email",
      direzione: "in",
      mittente: "picchia-documenti@example.test",
      mittenteNome: "Marco Picchia",
      destinatari: ["ufficio@example.test"],
      oggetto: "Misure Picchia",
      testo: "In allegato le misure esecutive.",
      allegati: [
        {
          nome: "Misure Picchia.pdf",
          mimeType: "application/pdf",
          size: bytes.length,
          storageKey: stored.storageKey,
        },
      ],
      clienteId: cliente.id,
      commessaId: null,
      matchConfidenza: "media",
      matchMotivo: "Mittente cliente riconosciuto",
      stato: "nuova",
      receivedAt: new Date("2026-08-25T12:00:00Z"),
      categoria: "operativa",
    });
    const rt: ToolRuntime = {
      ctx,
      esecuzioneId: 999_155,
      trigger: "gestione_comunicazione",
      comunicazioneId: comunicazione!.id,
      maxProposte: 3,
      proposteIds: [],
      terminato: null,
      evidenceRefs: [
        {
          type: "email",
          id: String(comunicazione!.id),
          label: "Misure Picchia",
        },
      ],
    };

    try {
      const ricerca = await eseguiStrumento(rt, "cerca_comunicazioni", {
        canale: "email",
        query: "picchia-documenti@example.test",
      });
      expect(JSON.parse(ricerca.content)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: comunicazione!.id,
            categoria: "operativa",
            allegati: [
              expect.objectContaining({
                indice: 0,
                nome: "Misure Picchia.pdf",
              }),
            ],
          }),
        ])
      );

      const result = await eseguiStrumento(rt, "proponi_archivia_allegato", {
        comunicazioneId: comunicazione!.id,
        allegatoIndex: 0,
        commessaId: commessa.id,
        tipoDocumento: "misure",
        nomeSuggerito: "Misure esecutive Picchia Marco.pdf",
        evidenze: ["Nome file", "Mittente collegato al cliente"],
        titolo: "Archivia le misure di Picchia",
        motivazione: "La mail contiene le misure esecutive della commessa.",
        confidenza: "alta",
      });

      expect(result.isError).toBeFalsy();
      expect(
        proposte.find(item => item.id === rt.proposteIds[0])
      ).toMatchObject({
        tipo: "archivia_allegato",
        commessaId: commessa.id,
        clienteId: cliente.id,
        payload: {
          comunicazioneId: comunicazione!.id,
          allegatoIndex: 0,
          attachmentName: "Misure Picchia.pdf",
          expectedMimeType: "application/pdf",
          tipoDocumento: "misure",
          nomeSuggerito: "Misure esecutive Picchia Marco.pdf",
        },
      });

      const approvata = await caller.tars.proposte.approva({
        id: rt.proposteIds[0],
      });
      expect(approvata.stato).toBe("approvata");
      expect(approvata.esito).toMatch(/Misure esecutive Picchia Marco\.pdf/);
      expect(await getComunicazione(comunicazione!.id, 1)).toMatchObject({
        clienteId: cliente.id,
        commessaId: commessa.id,
        stato: "gestita",
      });
      const documenti = await caller.preventiviContratti.byCommessa(
        commessa.id
      );
      expect(documenti).toEqual([
        expect.objectContaining({
          nome: "Misure esecutive Picchia Marco.pdf",
          tipo: "misure",
          source: "comunicazione",
          sourceRef: `1:${comunicazione!.id}:0`,
          hasData: true,
        }),
      ]);
      const dettaglio = await caller.preventiviContratti.byId(documenti[0].id);
      expect(Buffer.from(dettaglio!.dataBase64, "base64")).toEqual(bytes);
    } finally {
      deleteDocumentiByCommessa(commessa.id);
      await deleteComunicazione(comunicazione!.id, 1);
      deleteFileQuiet(stored.storageKey);
    }
  });

  it("smista e archivia un allegato WhatsApp nella commessa verificata", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const cliente = await caller.clienti.create({
      nome: "Allegati",
      cognome: "WhatsApp",
      telefono: "+39 340 000 1111",
    });
    const commessa = await caller.commesse.create({
      clienteId: cliente.id,
      cliente: "WhatsApp Allegati",
    });
    const bytes = Buffer.from("foto difetto whatsapp", "utf8");
    const encryptionKeyBefore = process.env.MAIL_ENCRYPTION_KEY;
    process.env.MAIL_ENCRYPTION_KEY = "chiave-whatsapp-test";
    const { configWhatsApp, proteggiSegreto } = await import("./whatsapp");
    const whatsappConfigId = 999_156;
    configWhatsApp.push({
      id: whatsappConfigId,
      sedeId: 1,
      nome: "WhatsApp test allegati",
      numero: "+39 0187 000000",
      phoneNumberId: "PHONE_TARS_DOCUMENT_INTAKE_1",
      wabaId: "WABA_TARS_DOCUMENT_INTAKE_1",
      tokenCifrato: proteggiSegreto("token-whatsapp-test"),
      appSecretCifrato: proteggiSegreto("app-secret-whatsapp-test"),
      verifyToken: "verify-token-whatsapp-test",
      attiva: true,
      ultimoMessaggio: null,
      messaggiRicevuti: 0,
      ultimoErrore: null,
      onboardingAt: null,
      storicoRichiestoAt: null,
      storicoUltimoEventoAt: null,
      storicoProgresso: null,
      storicoCompletatoAt: null,
      storicoSincronizzato: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    let esitoMedia: "troppo_grande" | "scaduto" | "disponibile" =
      "troppo_grande";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/MEDIA_TARS_DOCUMENT_INTAKE_1")) {
          return new Response(
            JSON.stringify({
              url: "https://media.example.test/difetto.jpg",
              mime_type: "image/jpeg",
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (url === "https://media.example.test/difetto.jpg") {
          if (esitoMedia === "scaduto") {
            return new Response("Media scaduto", { status: 410 });
          }
          if (esitoMedia === "troppo_grande") {
            return new Response(Buffer.alloc(10 * 1024 * 1024 + 1), {
              status: 200,
              headers: { "content-type": "image/jpeg" },
            });
          }
          return new Response(bytes, {
            status: 200,
            headers: { "content-type": "image/jpeg" },
          });
        }
        throw new Error(`URL inatteso nel test WhatsApp: ${url}`);
      })
    );
    const comunicazione = await insertComunicazione({
      sedeId: 1,
      casellaId: whatsappConfigId,
      messageId: "wamid.tars-document-intake-1",
      canale: "whatsapp",
      direzione: "in",
      mittente: "+393400001111",
      mittenteNome: "WhatsApp Allegati",
      destinatari: ["Ufficio Ruffino"],
      oggetto: "WhatsApp",
      testo: "Questa e la foto del difetto.",
      allegati: [
        {
          nome: "difetto.jpg",
          mimeType: "image/jpeg",
          size: bytes.length,
          storageKey: null,
          mediaId: "MEDIA_TARS_DOCUMENT_INTAKE_1",
        },
      ],
      clienteId: cliente.id,
      commessaId: null,
      matchConfidenza: "alta",
      matchMotivo: "Numero WhatsApp del cliente con una sola commessa attiva",
      stato: "nuova",
      receivedAt: new Date("2026-08-25T13:00:00Z"),
      categoria: "operativa",
    });
    const rt: ToolRuntime = {
      ctx,
      esecuzioneId: 999_156,
      trigger: "smistamento",
      comunicazioneId: comunicazione!.id,
      maxProposte: 3,
      proposteIds: [],
      terminato: null,
      evidenceRefs: [
        {
          type: "whatsapp",
          id: String(comunicazione!.id),
          label: "Foto difetto WhatsApp",
        },
      ],
    };

    let restorePutFile: (() => void) | null = null;
    try {
      const ricerca = await eseguiStrumento(rt, "cerca_comunicazioni", {
        canale: "whatsapp",
        query: "+39 340 000 1111",
      });
      expect(JSON.parse(ricerca.content)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: comunicazione!.id,
            categoria: "operativa",
            allegati: [
              expect.objectContaining({
                indice: 0,
                nome: "difetto.jpg",
              }),
            ],
          }),
        ])
      );

      const result = await eseguiStrumento(rt, "proponi_archivia_allegato", {
        comunicazioneId: comunicazione!.id,
        allegatoIndex: 0,
        commessaId: commessa.id,
        tipoDocumento: "foto",
        evidenze: ["Numero cliente", "Una sola commessa attiva"],
        titolo: "Archivia la foto ricevuta su WhatsApp",
        motivazione:
          "Il messaggio WhatsApp contiene una foto operativa della commessa.",
        confidenza: "alta",
      });

      expect(result.isError).toBeFalsy();
      expect(
        proposte.find(item => item.id === rt.proposteIds[0])
      ).toMatchObject({
        tipo: "archivia_allegato",
        commessaId: commessa.id,
        clienteId: cliente.id,
        payload: {
          comunicazioneId: comunicazione!.id,
          allegatoIndex: 0,
          attachmentName: "difetto.jpg",
          expectedMimeType: "image/jpeg",
          tipoDocumento: "foto",
          nomeSuggerito: "Foto WhatsApp Allegati.jpg",
        },
      });

      await expect(
        caller.tars.proposte.approva({ id: rt.proposteIds[0] })
      ).rejects.toThrow(/10MB/);
      expect(await getComunicazione(comunicazione!.id, 1)).toMatchObject({
        commessaId: null,
        stato: "nuova",
      });
      expect(
        await caller.preventiviContratti.byCommessa(commessa.id)
      ).toHaveLength(0);

      esitoMedia = "scaduto";
      await expect(
        caller.tars.proposte.approva({ id: rt.proposteIds[0] })
      ).rejects.toThrow(/media WhatsApp.*non pi[uù] disponibile/i);
      expect(await getComunicazione(comunicazione!.id, 1)).toMatchObject({
        commessaId: null,
        stato: "nuova",
      });

      esitoMedia = "disponibile";
      const fileStorageModule = await import("../_core/fileStorage");
      const putFileSpy = vi
        .spyOn(fileStorageModule, "putFile")
        .mockRejectedValueOnce(new Error("storage test non disponibile"));
      restorePutFile = () => putFileSpy.mockRestore();
      await expect(
        caller.tars.proposte.approva({ id: rt.proposteIds[0] })
      ).rejects.toThrow(/storage documenti non.*disponibile/i);
      expect(await getComunicazione(comunicazione!.id, 1)).toMatchObject({
        commessaId: null,
        stato: "nuova",
      });
      expect(
        await caller.preventiviContratti.byCommessa(commessa.id)
      ).toHaveLength(0);
      putFileSpy.mockRestore();
      restorePutFile = null;

      const approvata = await caller.tars.proposte.approva({
        id: rt.proposteIds[0],
      });
      expect(approvata.stato).toBe("approvata");
      expect(approvata.esito).toMatch(/Foto WhatsApp Allegati\.jpg/);
      expect(await getComunicazione(comunicazione!.id, 1)).toMatchObject({
        clienteId: cliente.id,
        commessaId: commessa.id,
        stato: "gestita",
      });
      const documenti = await caller.preventiviContratti.byCommessa(
        commessa.id
      );
      expect(documenti).toEqual([
        expect.objectContaining({
          nome: "Foto WhatsApp Allegati.jpg",
          tipo: "foto",
          source: "comunicazione",
          sourceRef: `1:${comunicazione!.id}:0`,
          hasData: true,
        }),
      ]);
      const dettaglio = await caller.preventiviContratti.byId(documenti[0].id);
      expect(Buffer.from(dettaglio!.dataBase64, "base64")).toEqual(bytes);
    } finally {
      deleteDocumentiByCommessa(commessa.id);
      await deleteComunicazione(comunicazione!.id, 1);
      const configIndex = configWhatsApp.findIndex(
        config => config.id === whatsappConfigId
      );
      if (configIndex >= 0) configWhatsApp.splice(configIndex, 1);
      restorePutFile?.();
      vi.unstubAllGlobals();
      if (encryptionKeyBefore === undefined) {
        delete process.env.MAIL_ENCRYPTION_KEY;
      } else {
        process.env.MAIL_ENCRYPTION_KEY = encryptionKeyBefore;
      }
    }
  });

  it("chiude una commessa con una sola proposta solo quando tutti i vincoli sono soddisfatti", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const commessa = await caller.commesse.create({
      cliente: "Chiusura Verificata",
      importoTotale: 0,
    });
    const documentTypes = [
      "preventivo",
      "misure",
      "contratto",
      "fattura",
      "ordine",
      "ddt_consegna",
      "ddt_posa",
      "ddt_finale",
    ] as const;
    for (const tipo of documentTypes) {
      await caller.preventiviContratti.upload({
        commessaId: commessa.id,
        nome: `${tipo}.pdf`,
        tipo,
        mimeType: "application/pdf",
        size: 3,
        dataBase64: Buffer.from(tipo).toString("base64"),
      });
    }
    const rt: ToolRuntime = {
      ctx,
      esecuzioneId: 999_156,
      trigger: "chat",
      maxProposte: 3,
      proposteIds: [],
      terminato: null,
      evidenceRefs: [
        {
          sourceType: "commessa",
          sourceId: String(commessa.id),
          label: commessa.codice,
          version: "test-ready",
        },
      ],
    };

    try {
      const readinessTool = await eseguiStrumento(
        rt,
        "verifica_chiusura_commessa",
        { commessaId: commessa.id }
      );
      expect(JSON.parse(readinessTool.content).ready).toBe(true);
      const fingerprint = JSON.parse(readinessTool.content).fingerprint;

      const proposed = await eseguiStrumento(rt, "proponi_chiusura_commessa", {
        commessaId: commessa.id,
        readinessFingerprint: fingerprint,
        titolo: `Chiudi ${commessa.codice} - Chiusura Verificata`,
        motivazione:
          "Saldo, fascicolo documentale e pratiche operative risultano completi.",
        confidenza: "alta",
      });
      expect(proposed.isError).toBeFalsy();
      const proposalId = rt.proposteIds[0];
      expect(proposte.find(item => item.id === proposalId)).toMatchObject({
        tipo: "chiudi_commessa",
        commessaId: commessa.id,
        payload: { readinessFingerprint: fingerprint },
      });

      const approved = await caller.tars.proposte.approva({ id: proposalId });
      expect(approved.stato).toBe("approvata");
      expect(await caller.commesse.byId(commessa.id)).toMatchObject({
        stato: "archiviata",
      });
    } finally {
      deleteDocumentiByCommessa(commessa.id);
    }
  });

  it("non duplica lo stesso miglioramento di processo riformulato", async () => {
    seedProcessSnapshot();
    const rt: ToolRuntime = {
      ctx: makeCtx(),
      esecuzioneId: 999_160,
      trigger: "audit_processi",
      maxProposte: 3,
      proposteIds: [],
      terminato: null,
      risultatiCache: new Map(),
      toolCacheHits: 0,
      duplicatiBloccati: 0,
    };
    const base = {
      area: "commesse",
      problema: "Dodici commesse ferme oltre dieci giorni",
      azione: "Introdurre una revisione settimanale delle commesse ferme",
      impatto: "Ridurre il tempo medio senza aggiornamenti",
      metricKey: "commesse_ferme_10g",
      sampleSize: 40,
      baselineValue: 12,
      baselineDenominator: 40,
      targetValue: 6,
      responsabileId: 1,
      dataVerifica: new Date(Date.now() + 14 * 86_400_000)
        .toISOString()
        .slice(0, 10),
      motivazione: "Il quadro aziendale mostra 12 commesse ferme.",
      confidenza: "alta",
    };
    const prima = await eseguiStrumento(rt, "proponi_miglioramento_processo", {
      ...base,
      titolo: "Rivedi ogni settimana le commesse ferme",
    });
    const seconda = await eseguiStrumento(
      rt,
      "proponi_miglioramento_processo",
      { ...base, titolo: "Programma il controllo settimanale delle commesse" }
    );

    expect(prima.isError).toBeFalsy();
    expect(seconda.isError).toBe(true);
    expect(seconda.content).toMatch(/già in attesa/);
    expect(rt.proposteIds).toHaveLength(1);
    expect(rt.duplicatiBloccati).toBe(1);
  });

  it("rifiuta esperimenti con baseline inventata o obiettivo non migliorativo", async () => {
    seedProcessSnapshot();
    const rt: ToolRuntime = {
      ctx: makeCtx(),
      esecuzioneId: 999_161,
      trigger: "audit_processi",
      maxProposte: 3,
      proposteIds: [],
      terminato: null,
    };
    const base = {
      area: "commesse",
      problema: "Commesse ferme oltre dieci giorni",
      azione: "Revisionare le commesse ferme ogni lunedì",
      impatto: "Ridurre le commesse ferme",
      metricKey: "commesse_ferme_10g",
      sampleSize: 40,
      baselineDenominator: 40,
      targetValue: 6,
      responsabileId: 1,
      dataVerifica: new Date(Date.now() + 14 * 86_400_000)
        .toISOString()
        .slice(0, 10),
      titolo: "Esperimento sulle commesse ferme",
      motivazione: "Il quadro mostra un pattern ricorrente.",
      confidenza: "alta",
    };

    const stale = await eseguiStrumento(rt, "proponi_miglioramento_processo", {
      ...base,
      baselineValue: 99,
    });
    const noImprovement = await eseguiStrumento(
      rt,
      "proponi_miglioramento_processo",
      { ...base, baselineValue: 12, targetValue: 14 }
    );
    expect(stale.isError).toBe(true);
    expect(stale.content).toMatch(/baseline/i);
    expect(noImprovement.isError).toBe(true);
    expect(noImprovement.content).toMatch(/obiettivo/i);
  });

  it("approvando un esperimento crea il presidio assegnato nel Centro Azioni", async () => {
    const sedeId = 999_162;
    seedProcessSnapshot(sedeId);
    const ctx = makeCtx();
    ctx.sedeId = sedeId;
    ctx.sediIds = [sedeId];
    const rt: ToolRuntime = {
      ctx,
      esecuzioneId: 999_162,
      trigger: "audit_processi",
      maxProposte: 3,
      proposteIds: [],
      terminato: null,
    };
    const reviewDate = new Date(Date.now() + 14 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const proposed = await eseguiStrumento(
      rt,
      "proponi_miglioramento_processo",
      {
        area: "organizzazione",
        problema: "Una esecuzione Tars su dieci fallisce",
        azione: "Rivedere gli errori Tars ogni mattina",
        impatto: "Ridurre le esecuzioni fallite",
        metricKey: "tars_errori_30g",
        sampleSize: 20,
        baselineValue: 10,
        baselineDenominator: 20,
        targetValue: 5,
        responsabileId: 1,
        dataVerifica: reviewDate,
        titolo: "Dimezza gli errori Tars",
        motivazione: "La baseline verificata mostra un errore ogni dieci run.",
        confidenza: "alta",
      }
    );
    expect(proposed.isError).toBeFalsy();

    const approved = await appRouter
      .createCaller(ctx)
      .tars.proposte.approva({ id: rt.proposteIds[0] });
    const canonicalKey = `processo:${sedeId}:tars_errori_30g`;
    const experiment = processExperimentRepository.findOpenExperiment(
      sedeId,
      canonicalKey
    );
    const actionCase = await getActionCaseRepository().findByCanonicalKey(
      sedeId,
      canonicalKey
    );

    expect(approved.esito).toMatch(/Centro Azioni/i);
    expect(experiment).toMatchObject({
      proposalId: rt.proposteIds[0],
      responsibleUserId: 1,
      targetValue: 5,
      actionCaseId: actionCase?.id,
    });
    expect(actionCase).toMatchObject({
      targetType: "proposta_tars",
      targetId: rt.proposteIds[0],
      assigneeUserId: 1,
      status: "da_valutare",
    });
  });

  it("corregge un esperimento, insegna l'errore a Tars e approva i valori modificati", async () => {
    const sedeId = 999_163;
    seedProcessSnapshot(sedeId);
    const ctx = makeCtx();
    ctx.sedeId = sedeId;
    ctx.sediIds = [sedeId];
    const caller = appRouter.createCaller(ctx);
    const responsabile = await caller.utenti.create({
      nome: "Stefano",
      cognome: "Esperimenti",
      email: "stefano.esperimenti.999163@ruffinogroup.test",
      ruoli: ["commerciale"],
      sediIds: [sedeId],
      password: "Test-password-999163!",
    });
    const rt: ToolRuntime = {
      ctx,
      esecuzioneId: 999_163,
      trigger: "audit_processi",
      maxProposte: 3,
      proposteIds: [],
      terminato: null,
    };
    const proposed = await eseguiStrumento(
      rt,
      "proponi_miglioramento_processo",
      {
        area: "organizzazione",
        problema: "Dodici commesse ferme oltre dieci giorni",
        azione: "Farle controllare ogni mattina alla direzione",
        impatto: "Ridurre le commesse ferme",
        metricKey: "commesse_ferme_10g",
        sampleSize: 40,
        baselineValue: 12,
        baselineDenominator: 40,
        targetValue: 8,
        responsabileId: 1,
        dataVerifica: new Date(Date.now() + 14 * 86_400_000)
          .toISOString()
          .slice(0, 10),
        titolo: "Presidia le commesse ferme",
        motivazione: "La baseline mostra un arretrato ricorrente.",
        confidenza: "alta",
      }
    );
    expect(proposed.isError).toBeFalsy();
    const proposalId = rt.proposteIds[0];
    const reviewDate = new Date(Date.now() + 21 * 86_400_000)
      .toISOString()
      .slice(0, 10);

    const corrected = await caller.tars.proposte.correggiEsperimento({
      id: proposalId,
      feedback:
        "L'assegnatario e sbagliato: il controllo operativo spetta a Stefano.",
      azione:
        "Stefano controlla ogni lunedi le commesse ferme e assegna le priorita",
      targetValue: 5,
      responsibleId: responsabile.id,
      reviewDate,
    });

    expect(corrected).toMatchObject({
      stato: "pendente",
      payload: {
        targetValue: 5,
        responsibleId: responsabile.id,
        responsibleName: "Stefano Esperimenti",
        reviewDate,
      },
    });
    expect(corrected.payload.azione).toMatch(/Stefano controlla/);
    expect(corrected.correzioni).toHaveLength(1);
    expect(corrected.correzioni[0]).toMatchObject({
      userId: 1,
      feedback:
        "L'assegnatario e sbagliato: il controllo operativo spetta a Stefano.",
      before: { responsibleId: 1, targetValue: 8 },
      after: { responsibleId: responsabile.id, targetValue: 5 },
    });
    expect(bloccoDecisioni(sedeId)).toContain(
      "L'assegnatario e sbagliato: il controllo operativo spetta a Stefano."
    );
    expect(
      tarsOutcomes.some(
        outcome =>
          outcome.sedeId === sedeId &&
          outcome.capability === "processo.propose" &&
          outcome.eventType === "modified"
      )
    ).toBe(true);

    await caller.tars.proposte.approva({ id: proposalId });
    const canonicalKey = `processo:${sedeId}:commesse_ferme_10g`;
    const experiment = processExperimentRepository.findOpenExperiment(
      sedeId,
      canonicalKey
    );
    const actionCase = await getActionCaseRepository().findByCanonicalKey(
      sedeId,
      canonicalKey
    );
    expect(experiment).toMatchObject({
      responsibleUserId: responsabile.id,
      targetValue: 5,
      action:
        "Stefano controlla ogni lunedi le commesse ferme e assegna le priorita",
    });
    expect(actionCase?.assigneeUserId).toBe(responsabile.id);
  });

  it("rifiuta correzioni di esperimenti non migliorative o fuori sede", async () => {
    const sedeId = 999_164;
    seedProcessSnapshot(sedeId);
    const ctx = makeCtx();
    ctx.sedeId = sedeId;
    ctx.sediIds = [sedeId];
    const rt: ToolRuntime = {
      ctx,
      esecuzioneId: 999_164,
      trigger: "audit_processi",
      maxProposte: 3,
      proposteIds: [],
      terminato: null,
    };
    await eseguiStrumento(rt, "proponi_miglioramento_processo", {
      area: "organizzazione",
      problema: "Dodici commesse ferme oltre dieci giorni",
      azione: "Controllare le commesse ferme ogni lunedi",
      impatto: "Ridurre le commesse ferme",
      metricKey: "commesse_ferme_10g",
      sampleSize: 40,
      baselineValue: 12,
      baselineDenominator: 40,
      targetValue: 6,
      responsabileId: 1,
      dataVerifica: new Date(Date.now() + 14 * 86_400_000)
        .toISOString()
        .slice(0, 10),
      titolo: "Riduci le commesse ferme",
      motivazione: "La baseline mostra un pattern operativo.",
      confidenza: "alta",
    });
    const caller = appRouter.createCaller(ctx);
    const base = {
      id: rt.proposteIds[0],
      feedback: "L'obiettivo o il responsabile proposto non sono corretti.",
      azione:
        "Controllare ogni lunedi le commesse ferme e assegnare le priorita",
      targetValue: 6,
      responsibleId: 1,
      reviewDate: new Date(Date.now() + 21 * 86_400_000)
        .toISOString()
        .slice(0, 10),
    };

    await expect(
      caller.tars.proposte.correggiEsperimento({
        ...base,
        targetValue: 13,
      })
    ).rejects.toThrow(/obiettivo/i);
    await expect(
      caller.tars.proposte.correggiEsperimento({
        ...base,
        targetValue: -1,
      })
    ).rejects.toThrow(/obiettivo/i);
    await expect(
      caller.tars.proposte.correggiEsperimento({
        ...base,
        targetValue: 5.5,
      })
    ).rejects.toThrow(/intero/i);
    await expect(
      caller.tars.proposte.correggiEsperimento({
        ...base,
        responsibleId: 999_999,
      })
    ).rejects.toThrow(/responsabile/i);
  });

  it("non corregge un esperimento mentre un'altra sessione lo sta approvando", async () => {
    const sedeId = 999_165;
    seedProcessSnapshot(sedeId);
    const ctx = makeCtx();
    ctx.sedeId = sedeId;
    ctx.sediIds = [sedeId];
    const rt: ToolRuntime = {
      ctx,
      esecuzioneId: 999_165,
      trigger: "audit_processi",
      maxProposte: 3,
      proposteIds: [],
      terminato: null,
    };
    const reviewDate = new Date(Date.now() + 21 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    await eseguiStrumento(rt, "proponi_miglioramento_processo", {
      area: "organizzazione",
      problema: "Dodici commesse ferme oltre dieci giorni",
      azione: "Controllare ogni lunedi le commesse ferme",
      impatto: "Ridurre le commesse ferme",
      metricKey: "commesse_ferme_10g",
      sampleSize: 40,
      baselineValue: 12,
      baselineDenominator: 40,
      targetValue: 6,
      responsabileId: 1,
      dataVerifica: reviewDate,
      titolo: "Presidia le commesse ferme senza conflitti",
      motivazione: "La baseline mostra un pattern operativo.",
      confidenza: "alta",
    });
    const proposalId = rt.proposteIds[0];
    const caller = appRouter.createCaller(ctx);
    const repository = getActionCaseRepository();
    const originalEnsureSchema = repository.ensureSchema.bind(repository);
    let releaseApproval!: () => void;
    let approvalReachedRepository!: () => void;
    const approvalGate = new Promise<void>(resolve => {
      releaseApproval = resolve;
    });
    const repositoryReached = new Promise<void>(resolve => {
      approvalReachedRepository = resolve;
    });
    repository.ensureSchema = async () => {
      approvalReachedRepository();
      await approvalGate;
      return originalEnsureSchema();
    };

    try {
      const approval = caller.tars.proposte.approva({ id: proposalId });
      await repositoryReached;
      await expect(
        caller.tars.proposte.correggiEsperimento({
          id: proposalId,
          feedback:
            "Non modificare la proposta mentre un altro operatore la approva.",
          azione: "Controllare ogni venerdi le commesse ferme",
          targetValue: 5,
          responsibleId: 1,
          reviewDate,
        })
      ).rejects.toThrow(/approvazione in corso/i);
      releaseApproval();
      await approval;
    } finally {
      releaseApproval();
      repository.ensureSchema = originalEnsureSchema;
    }
  });

  it("non espone proposte senza ownership a un altro operatore", async () => {
    const privateSedeId = 999_170;
    seedProcessSnapshot(privateSedeId);
    const ownerCtx = makeCtx();
    ownerCtx.sedeId = privateSedeId;
    ownerCtx.sediIds = [privateSedeId];
    const rt: ToolRuntime = {
      ctx: ownerCtx,
      esecuzioneId: 999_170,
      trigger: "audit_processi",
      maxProposte: 3,
      proposteIds: [],
      terminato: null,
    };
    const created = await eseguiStrumento(
      rt,
      "proponi_miglioramento_processo",
      {
        area: "organizzazione",
        problema: "Segnale sintetico riservato alla direzione",
        azione: "Verificare il perimetro di lettura delle proposte",
        impatto: "Nessuna esposizione tra operatori",
        metricKey: "clienti_senza_contatti",
        sampleSize: 40,
        baselineValue: 3,
        baselineDenominator: 40,
        targetValue: 1,
        responsabileId: 1,
        dataVerifica: new Date(Date.now() + 14 * 86_400_000)
          .toISOString()
          .slice(0, 10),
        motivazione: "Test ACL della coda Tars.",
        confidenza: "alta",
        titolo: "Verifica ACL proposte 999170",
      }
    );
    expect(created.isError).toBeFalsy();
    const id = rt.proposteIds[0];
    const commercialCtx = makeCtx();
    commercialCtx.sedeId = privateSedeId;
    commercialCtx.sediIds = [privateSedeId];
    (commercialCtx.user as any) = {
      ...(commercialCtx.user as any),
      id: 999_171,
      role: "user",
      ruolo: "commerciale",
      ruoli: ["commerciale"],
    };
    const caller = appRouter.createCaller(commercialCtx);
    expect(
      (await caller.tars.proposte.list()).map(item => item.id)
    ).not.toContain(id);
    await expect(caller.tars.proposte.approva({ id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rimuove una proposta fallita solo dalla vista dell'utente e la conserva per audit", async () => {
    const sedeId = 999_180;
    const proposalId = newPropostaId();
    proposte.push({
      id: proposalId,
      sedeId,
      tipo: "nota_timeline",
      titolo: "Proposta non più eseguibile",
      motivazione: "Il riferimento originario non è più disponibile.",
      confidenza: "media",
      payload: { commessaId: 123, testo: "Nota non più valida" },
      commessaId: null,
      clienteId: null,
      opzioni: null,
      risposta: null,
      stato: "errore",
      esito: "Proposta non trovata.",
      motivoRifiuto: null,
      esecuzioneId: null,
      trigger: "chat",
      createdAt: new Date(),
      decisaAt: new Date(),
      decisaDa: 1,
      decisaDaNome: "Admin Ruffino",
      seguitoAt: null,
      seguitoEsecuzioneId: null,
      origineId: null,
      requestedByUserId: null,
      chiaveAzione: `test:rimozione:${proposalId}`,
      evidenceRefs: [],
      correzioni: [],
      hiddenForUserIds: [],
    } as any);

    const ownerCtx = makeCtx();
    ownerCtx.sedeId = sedeId;
    ownerCtx.sediIds = [sedeId];
    const ownerChat = getChat(sedeId, 1);
    ownerChat.messaggi.push({
      ruolo: "tars",
      testo: "Ho preparato la proposta.",
      proposteIds: [proposalId],
      createdAt: new Date(),
    });
    saveChat();
    const ownerCaller = appRouter.createCaller(ownerCtx);

    expect(
      (await ownerCaller.tars.proposte.list()).map(item => item.id)
    ).toContain(proposalId);

    await expect(
      ownerCaller.tars.proposte.rimuovi({ id: proposalId })
    ).resolves.toEqual({ success: true });

    expect(
      (await ownerCaller.tars.proposte.list()).map(item => item.id)
    ).not.toContain(proposalId);
    expect(
      (await ownerCaller.tars.chat.get()).flatMap(message =>
        message.proposte.map(item => item.id)
      )
    ).not.toContain(proposalId);
    expect(proposte.find(item => item.id === proposalId)).toMatchObject({
      id: proposalId,
      hiddenForUserIds: [1],
    });

    const otherCtx = makeCtx();
    otherCtx.sedeId = sedeId;
    otherCtx.sediIds = [sedeId];
    (otherCtx.user as any) = {
      ...(otherCtx.user as any),
      id: 2,
      openId: "local-2",
    };
    const otherCaller = appRouter.createCaller(otherCtx);
    expect(
      (await otherCaller.tars.proposte.list()).map(item => item.id)
    ).toContain(proposalId);
  });

  it("rimuove domande pendenti dalla vista personale ma non da un'altra sede", async () => {
    const sedeId = 999_181;
    const proposalId = newPropostaId();
    proposte.push({
      id: proposalId,
      sedeId,
      tipo: "domanda",
      titolo: "Quale commessa devo usare?",
      motivazione: "Tars attende una scelta dell'operatore.",
      confidenza: "alta",
      payload: {},
      commessaId: null,
      clienteId: null,
      opzioni: ["Commessa A", "Commessa B"],
      risposta: null,
      stato: "pendente",
      esito: null,
      motivoRifiuto: null,
      esecuzioneId: null,
      trigger: "chat",
      createdAt: new Date(),
      decisaAt: null,
      decisaDa: null,
      decisaDaNome: null,
      seguitoAt: null,
      seguitoEsecuzioneId: null,
      origineId: null,
      requestedByUserId: null,
      chiaveAzione: `test:rimozione:${proposalId}`,
      evidenceRefs: [],
      correzioni: [],
      hiddenForUserIds: [],
    } as any);

    const sameSiteCtx = makeCtx();
    sameSiteCtx.sedeId = sedeId;
    sameSiteCtx.sediIds = [sedeId];
    await expect(
      appRouter
        .createCaller(sameSiteCtx)
        .tars.proposte.rimuovi({ id: proposalId })
    ).resolves.toEqual({ success: true });
    expect(proposte.find(item => item.id === proposalId)).toMatchObject({
      hiddenForUserIds: [1],
      stato: "pendente",
    });

    const otherSiteCtx = makeCtx();
    otherSiteCtx.sedeId = sedeId + 1;
    otherSiteCtx.sediIds = [sedeId + 1];
    await expect(
      appRouter
        .createCaller(otherSiteCtx)
        .tars.proposte.rimuovi({ id: proposalId })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("legge il fascicolo completo una volta e riusa le richieste duplicate", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const commessa = await caller.commesse.create({
      cliente: "Cache Fascicolo",
      importoTotale: 4200,
    });
    const rt: ToolRuntime = {
      ctx,
      esecuzioneId: 999_200,
      trigger: "on_demand",
      maxProposte: 3,
      proposteIds: [],
      terminato: null,
      risultatiCache: new Map(),
      toolCacheHits: 0,
    };

    const prima = await eseguiStrumento(rt, "leggi_fascicolo_commessa", {
      commessaId: commessa.id,
    });
    expect(prima.isError).toBeFalsy();
    const fascicolo = JSON.parse(prima.content);
    expect(fascicolo.commessa.id).toBe(commessa.id);
    expect(fascicolo).toHaveProperty("timeline");
    expect(fascicolo).toHaveProperty("docGate");
    expect(fascicolo).toHaveProperty("magazzino");

    const seconda = await eseguiStrumento(rt, "leggi_fascicolo_commessa", {
      commessaId: commessa.id,
    });
    expect(JSON.parse(seconda.content).cacheHit).toBe(true);
    expect(rt.toolCacheHits).toBe(1);
  });

  it("distingue cliente e ufficio nel contesto WhatsApp restituito a Tars", async () => {
    const marker = "contesto-direzione-wa-999201";
    const base = {
      sedeId: 1,
      casellaId: 999_201,
      canale: "whatsapp" as const,
      mittente: "+393331112222",
      mittenteNome: "Cliente Contesto",
      destinatari: ["+390187872687"],
      oggetto: "",
      allegati: [],
      clienteId: null,
      commessaId: null,
      matchConfidenza: "nessuna" as const,
      matchMotivo: null,
      stato: "gestita" as const,
      tarsAnalizzata: true,
    };
    const ricevuto = await insertComunicazione({
      ...base,
      messageId: `${marker}-in`,
      direzione: "in",
      testo: `${marker} richiesta del cliente`,
      receivedAt: new Date("2026-08-18T09:00:00Z"),
    });
    const inviato = await insertComunicazione({
      ...base,
      messageId: `${marker}-out`,
      direzione: "out",
      testo: `${marker} risposta dell'ufficio`,
      receivedAt: new Date("2026-08-18T09:01:00Z"),
    });
    const rt: ToolRuntime = {
      ctx: makeCtx(),
      esecuzioneId: 999_201,
      trigger: "on_demand",
      maxProposte: 3,
      proposteIds: [],
      terminato: null,
      risultatiCache: new Map(),
    };

    try {
      const result = await eseguiStrumento(rt, "cerca_comunicazioni", {
        canale: "whatsapp",
        query: marker,
        limite: 10,
      });
      expect(result.isError).toBeFalsy();
      expect(JSON.parse(result.content)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            direzione: "in",
            autore: "cliente",
            da: "Cliente Contesto <+393331112222>",
            a: "Ufficio Ruffino",
            testo: expect.stringContaining("richiesta del cliente"),
          }),
          expect.objectContaining({
            direzione: "out",
            autore: "ufficio",
            da: "Ufficio Ruffino",
            a: "Cliente Contesto <+393331112222>",
            testo: expect.stringContaining("risposta dell'ufficio"),
          }),
        ])
      );
    } finally {
      if (ricevuto) await deleteComunicazione(ricevuto.id, 1);
      if (inviato) await deleteComunicazione(inviato.id, 1);
    }
  });

  it("abilita la cache automatica sul prefisso crescente dei messaggi", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    let body: any = null;
    global.fetch = vi.fn(async (_url, init: any) => {
      body = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({
          id: "resp_test",
          model: "gpt-5.6-terra",
          status: "completed",
          output: [
            {
              id: "msg_test",
              type: "message",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: "ok" }],
            },
          ],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      } as any;
    }) as any;

    await callOpenAI({
      model: "gpt-5.6-terra",
      instructions: "system stabile",
      input: [{ role: "user", content: "ciao" }],
      tools: toolDefsForTrigger("riconciliazione_fatture"),
      promptCacheKey: "tars:riconciliazione:gpt-5.6-terra",
    });

    expect(body.store).toBe(false);
    expect(body.input[0]).toEqual({
      type: "message",
      role: "developer",
      content: [
        {
          type: "input_text",
          text: "system stabile",
          prompt_cache_breakpoint: { mode: "explicit" },
        },
      ],
    });
    expect(body.input[1]).toEqual({ role: "user", content: "ciao" });
    expect(body.prompt_cache_options).toEqual({ mode: "explicit", ttl: "30m" });
    expect(body.prompt_cache_key).toBe("tars:riconciliazione:gpt-5.6-terra");
    expect(body.tools.at(-1)).toMatchObject({
      type: "function",
      strict: false,
    });
  });

  it("ripassa reasoning e function output con lo stesso call_id", async () => {
    const corpi: any[] = [];
    let chiamata = 0;
    global.fetch = vi.fn(async (_url, init: any) => {
      corpi.push(JSON.parse(init.body));
      chiamata++;
      return {
        ok: true,
        json: async () =>
          chiamata === 1
            ? {
                id: "resp_tool",
                model: "gpt-5.6-sol",
                status: "completed",
                output: [
                  {
                    id: "rs_1",
                    type: "reasoning",
                    encrypted_content: "cifrato-test",
                    summary: [],
                  },
                  {
                    id: "fc_1",
                    type: "function_call",
                    call_id: "call_quadro",
                    name: "leggi_quadro_azienda",
                    arguments: "{}",
                    status: "completed",
                  },
                ],
                usage: { input_tokens: 100, output_tokens: 20 },
              }
            : {
                id: "resp_finale",
                model: "gpt-5.6-sol",
                status: "completed",
                output: [
                  {
                    id: "msg_finale",
                    type: "message",
                    content: [
                      { type: "output_text", text: "Analisi conclusa." },
                    ],
                  },
                ],
                usage: { input_tokens: 120, output_tokens: 10 },
              },
      } as any;
    }) as any;

    const { runTars } = await import("./loop");
    await runTars({
      ctx: makeCtx(),
      trigger: "on_demand",
      commessaId: null,
      richiesta: "Leggi il quadro.",
    });

    expect(corpi).toHaveLength(2);
    expect(corpi[1].input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "rs_1",
          type: "reasoning",
          encrypted_content: "cifrato-test",
        }),
        expect.objectContaining({
          type: "function_call",
          call_id: "call_quadro",
        }),
        expect.objectContaining({
          type: "function_call_output",
          call_id: "call_quadro",
        }),
      ])
    );
  });
});

describe("tars — guardie proposte economiche gia soddisfatte", () => {
  const runtime = (ctx: TrpcContext, id: number): ToolRuntime => ({
    ctx,
    esecuzioneId: id,
    trigger: "on_demand",
    maxProposte: 3,
    proposteIds: [],
    terminato: null,
    risultatiCache: new Map(),
    toolCacheHits: 0,
    duplicatiBloccati: 0,
  });

  it("non propone un pagamento con importo e data gia presenti", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const commessa = await caller.commesse.create({ cliente: "No-op pagamento" });
    await caller.commesse.addPagamento({
      commessaId: commessa.id,
      importo: 1_220,
      data: "2026-08-20",
    });
    const rt = runtime(ctx, 999_501);
    const result = await eseguiStrumento(rt, "proponi_pagamento", {
      commessaId: commessa.id,
      importo: 1_220,
      data: "2026-08-20",
      titolo: "Registra pagamento duplicato",
      motivazione: "Test guardia live.",
      confidenza: "alta",
    });
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/gia presente o da correggere/i);
    expect(rt.proposteIds).toHaveLength(0);
  });

  it("non propone una rata quando il manuale ha la data nulla", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const commessa = await caller.commesse.create({ cliente: "No-op data" });
    await caller.commesse.addPagamento({
      commessaId: commessa.id,
      importo: 800,
      data: null,
    });
    const rt = runtime(ctx, 999_502);
    const result = await eseguiStrumento(rt, "proponi_pagamento", {
      commessaId: commessa.id,
      importo: 800,
      data: "2026-08-21",
      titolo: "Registra rata con data FiC",
      motivazione: "Test guardia data incompleta.",
      confidenza: "alta",
    });
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/gia presente o da correggere/i);
    expect(rt.proposteIds).toHaveLength(0);
  });

  it("rimuove il pattuito semanticamente uguale dalla modifica", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const commessa = await caller.commesse.create({
      cliente: "No-op pattuito",
      importoTotale: 5_000,
    });
    const rt = runtime(ctx, 999_503);
    const result = await eseguiStrumento(rt, "proponi_modifica_commessa", {
      commessaId: commessa.id,
      importoTotale: 5_000,
      titolo: "Imposta pattuito duplicato",
      motivazione: "Test guardia modifica.",
      confidenza: "alta",
    });
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/nessuna modifica effettiva/i);
    expect(rt.proposteIds).toHaveLength(0);
  });
});

// L'analisi che l'operatore lancia dal banner della commessa deve sempre
// restituire qualcosa di leggibile: una proposta, una domanda, oppure il
// motivo per cui è tutto in ordine. Un nessuna_azione nudo produceva un
// riepilogo vuoto (loop.ts usa il motivo come riepilogo) e sembrava un
// analisi che non aveva fatto niente.
describe("tars — l'analisi commessa non chiude a mani vuote", () => {
  const runtime = (trigger: string): ToolRuntime => ({
    ctx: makeCtx(),
    esecuzioneId: 999_400,
    trigger,
    maxProposte: 3,
    proposteIds: [],
    terminato: null,
    risultatiCache: new Map(),
    toolCacheHits: 0,
    duplicatiBloccati: 0,
  });

  it("on_demand: nessuna_azione senza motivo viene rifiutata", async () => {
    const rt = runtime("on_demand");
    const res = await eseguiStrumento(rt, "nessuna_azione", { motivo: "" });

    expect(res.isError).toBe(true);
    // Il run NON deve terminare: il modello deve motivare o chiedere.
    expect(rt.terminato).toBeNull();
  });

  it("on_demand: un motivo generico non basta", async () => {
    const rt = runtime("on_demand");
    const res = await eseguiStrumento(rt, "nessuna_azione", {
      motivo: "Tutto ok.",
    });

    expect(res.isError).toBe(true);
    expect(rt.terminato).toBeNull();
  });

  it("on_demand: con la lettura della situazione chiude regolarmente", async () => {
    const rt = runtime("on_demand");
    const motivo =
      "Commessa in attesa_posa: DDT di consegna caricato, saldo residuo zero, " +
      "squadra assegnata e nessun ticket aperto. Niente da proporre.";
    const res = await eseguiStrumento(rt, "nessuna_azione", { motivo });

    expect(res.isError).toBeFalsy();
    expect(rt.terminato?.motivo).toBe(motivo);
  });

  it("smistamento: nessuna_azione nuda resta valida", async () => {
    // La coda mail chiude in lotto senza motivo: il vincolo non deve
    // estendersi lì o lo smistamento si blocca.
    const rt = runtime("smistamento");
    const res = await eseguiStrumento(rt, "nessuna_azione", {});

    expect(res.isError).toBeFalsy();
    expect(rt.terminato).not.toBeNull();
  });
});
