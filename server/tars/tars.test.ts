// Test end-to-end di Tars con l'API Anthropic mockata: il loop chiama gli
// strumenti veri (caller tRPC, store in memoria), solo l'LLM è scriptato.
// Copre: analizza → tool di lettura → proposta → approvazione → mutation
// reale, più nessuna_azione e il rifiuto con motivo.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { appRouter } from "../routers";
import { bloccoDecisioni, buildSystemPrompt } from "./prompt";
import type { TrpcContext } from "../_core/context";
import {
  proposte,
  esecuzioni,
  getTarsConfig,
  budgetMensileSuperato,
  costoEsecuzioneUsd,
} from "./stores";
import {
  eseguiStrumento,
  TOOL_DEFS,
  toolDefsForTrigger,
  type ToolRuntime,
} from "./tools";
import { callAnthropic } from "./anthropic";

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
});

// ── Un rifiuto è definitivo ────────────────────────────────────────────────
// Il blocco nel system prompt è un suggerimento; questo è il muro. Serve a
// una cosa sola: che l'operatore non veda due volte la stessa proposta.
describe("tars — proposta rifiutata non torna", () => {
  const realFetch = global.fetch;
  beforeAll(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
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

    global.fetch = anthropicScript([
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
    global.fetch = anthropicScript([
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
    global.fetch = anthropicScript([
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

    global.fetch = anthropicScript([
      propostaPagamento(commessa.id, 2500, titolo),
      chiusura,
    ]) as any;
    await caller.tars.analizza({ commessaId: commessa.id });

    global.fetch = anthropicScript([
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

    global.fetch = anthropicScript([
      propostaPagamento(
        commessa.id,
        3000,
        `Registra acconto €3.000 su ${commessa.codice}`
      ),
      chiusura,
    ]) as any;
    const primo = await caller.tars.analizza({ commessaId: commessa.id });
    await caller.tars.proposte.approva({ id: primo.proposte[0].id });

    global.fetch = anthropicScript([
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
    expect(registro.strumenti[0].esito).toMatch(/già stata gestita/);
    expect(
      proposte.filter(p => p.commessaId === commessa.id && p.tipo === "pagamento")
    ).toHaveLength(1);
  });
});

// ── Seguito di una decisione ───────────────────────────────────────────────
// Approvare una segnalazione conferma un problema, non lo risolve: Tars
// riparte una volta per proporre l'azione che lo chiude.
describe("tars — seguito dell'approvazione", () => {
  const realFetch = global.fetch;
  beforeAll(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
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

    global.fetch = anthropicScript([
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
    global.fetch = anthropicScript([
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

    global.fetch = anthropicScript([
      {
        stop_reason: "tool_use",
        usage,
        content: [
          {
            type: "tool_use",
            id: "tu_1",
            name: "nessuna_azione",
            input: { motivo: "Tutto coerente: nessun passo mancante." },
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
    process.env.ANTHROPIC_API_KEY = "test-key";
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  it("costoEsecuzioneUsd: prezzi giusti per modello, cache scontata", () => {
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

    global.fetch = anthropicScript([
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
    global.fetch = anthropicScript([
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
    expect(smistamento.map(t => t.name)).toContain("leggi_allegato");
    expect(audit.map(t => t.name)).toEqual([
      "leggi_quadro_azienda",
      "proponi_segnalazione",
      "proponi_miglioramento_processo",
      "chiedi_chiarimento",
      "nessuna_azione",
    ]);
    expect(toolDefsForTrigger("chat")).toBe(TOOL_DEFS);
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

  it("non duplica lo stesso miglioramento di processo riformulato", async () => {
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
      proposta: "Introdurre una revisione settimanale delle commesse ferme",
      impatto: "Ridurre il tempo medio senza aggiornamenti",
      metrica: "12 commesse ferme su 40 attive",
      motivazione: "Il quadro aziendale mostra 12 commesse ferme.",
      confidenza: "alta",
    };
    const prima = await eseguiStrumento(
      rt,
      "proponi_miglioramento_processo",
      { ...base, titolo: "Rivedi ogni settimana le commesse ferme" }
    );
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

  it("abilita la cache automatica sul prefisso crescente dei messaggi", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    let body: any = null;
    global.fetch = vi.fn(async (_url, init: any) => {
      body = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({
          id: "msg_test",
          model: "claude-test",
          role: "assistant",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "ok" }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      } as any;
    }) as any;

    await callAnthropic({
      model: "claude-test",
      system: "system stabile",
      messages: [{ role: "user", content: "ciao" }],
      tools: toolDefsForTrigger("riconciliazione_fatture"),
    });

    expect(body.cache_control).toEqual({ type: "ephemeral" });
    expect(body.messages).toEqual([{ role: "user", content: "ciao" }]);
    expect(body.system[0].cache_control.ttl).toBe("1h");
    expect(body.tools.at(-1).cache_control.ttl).toBe("1h");
  });
});
