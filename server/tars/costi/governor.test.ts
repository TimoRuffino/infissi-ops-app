// Budget Tars PER AZIENDA nel governor (WS4, spec §7).
//
// Il provider sottostante è finto e il ledger è quello in memoria (come in
// `costi.test.ts`): qui si prova solo ciò che il WS4 aggiunge — il tenant nel
// contesto, il tetto d'azienda iniettato dalla politica e l'avviso alle
// soglie, che non deve mai bloccare la chiamata.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { creaProviderFinto } from "../openai/fake";
import type { RichiestaProvider } from "../provider";
import {
  avvolgiConGovernor,
  ErroreBudget,
  impostaPoliticaTarsAzienda,
  MESSAGGIO_BUDGET,
  MESSAGGIO_BUDGET_AZIENDA,
  messaggioPerLimite,
  stimaCostoNano,
  type ConfigurazioneBudget,
  type ContestoCosto,
  type PoliticaTarsAzienda,
} from "./governor";
import { creaLedgerMemoriaPerTest, impostaLedgerPerTest } from "./ledger";
import { tariffaDi, usdInNano } from "./tariffe";

const MODELLO = "gpt-5.6-terra";
const TENANT = 42;
const CONTESTO: ContestoCosto = { sedeId: 3, utenteId: 7, tenantId: TENANT };

const VARIABILI = [
  "TARS_MAX_COST_PER_RUN_USD",
  "TARS_DAILY_BUDGET_USD",
  "TARS_MONTHLY_BUDGET_USD",
  "TARS_MARGINE_STIMA",
  "TARS_SERVICE_TIER",
  "TARS_REASONING_INTERACTIVE",
];

/** Nessun tetto globale: sotto prova c'è solo il tetto d'azienda. */
function configSenzaTetti(): ConfigurazioneBudget {
  return {
    limiti: { runNano: null, giornoNano: null, meseNano: null },
    perRunUsd: null,
    giornalieroUsd: null,
    mensileUsd: null,
    margineStima: 1.25,
    scadenzaPrenotazioneMs: 600_000,
  };
}

function richiesta(runId: string, passo = 1): RichiestaProvider {
  return {
    modello: MODELLO,
    istruzioni: "x".repeat(4_000),
    input: [{ ruolo: "user", contenuto: "domanda" }],
    strumenti: [],
    maxOutputToken: 1200,
    chiaveCachePrompt: "tars:test",
    timeoutMs: 45_000,
    identita: { runId, passo, tentativo: 1, conversazioneId: 1 },
  };
}

const providerFinto = () =>
  creaProviderFinto(() => ({
    tipo: "messaggio" as const,
    testo: "ok",
    uso: { input: 1_000, output: 100, cachedInput: 0, cacheWrite: 0 },
  }));

/** La stima che il governor prenoterà per `richiesta()` (tariffa del catalogo). */
function stimaAttesa(): number {
  return stimaCostoNano(richiesta("stima"), tariffaDi(MODELLO)!, 1.25);
}

/**
 * Politica finta che registra le chiamate di `dopoPrenotazione` e le rende
 * attendibili: il governor la invoca senza aspettarla (un avviso non deve
 * ritardare una risposta), quindi il test aspetta questa promessa.
 */
function politicaFinta(limite: { limiteNano: number | null; bloccante: boolean }) {
  const chiamate: Array<{ tenantId: number; aziendaMeseNano: number; rifiutata: boolean }> = [];
  let sblocca: () => void = () => undefined;
  let attesa = new Promise<void>(r => (sblocca = r));
  const politica: PoliticaTarsAzienda = {
    limite: async () => limite,
    dopoPrenotazione: async (tenantId, aziendaMeseNano, _adesso, esito) => {
      chiamate.push({ tenantId, aziendaMeseNano, rifiutata: esito.rifiutata });
      sblocca();
    },
  };
  return {
    politica,
    chiamate,
    /** Aspetta la prossima `dopoPrenotazione` (o esce se è già arrivata). */
    async prossima(): Promise<void> {
      await Promise.race([attesa, new Promise(r => setTimeout(r, 500))]);
      attesa = new Promise<void>(r => (sblocca = r));
    },
  };
}

let ledger: ReturnType<typeof creaLedgerMemoriaPerTest>;

beforeEach(() => {
  for (const chiave of VARIABILI) delete process.env[chiave];
  ledger = creaLedgerMemoriaPerTest();
  impostaLedgerPerTest(ledger);
});

afterEach(() => {
  impostaLedgerPerTest(null);
  impostaPoliticaTarsAzienda(null);
  for (const chiave of VARIABILI) delete process.env[chiave];
});

/** Consumo già a terra per un'azienda, senza passare dal governor. */
async function semina(tenantId: number, costoNano: number, id: string): Promise<void> {
  await ledger.prenota({
    chiamataId: `semina-${id}`,
    runId: `semina-${id}`,
    tenantId,
    sedeId: 3,
    utenteId: 7,
    conversazioneId: null,
    modello: MODELLO,
    costoPrenotatoNano: costoNano,
    limiti: { runNano: null, giornoNano: null, meseNano: null },
    adesso: new Date(),
  });
}

describe("governor — tenant nel ledger", () => {
  it("la riga prenotata porta il tenant del contesto", async () => {
    const governato = avvolgiConGovernor(providerFinto(), CONTESTO, {
      configurazione: configSenzaTetti(),
    });
    await governato.rispondi(richiesta("run-tenant"));
    expect(ledger.righe().map(r => r.tenantId)).toEqual([TENANT]);
  });

  it("senza politica iniettata il comportamento è quello di oggi: nessun tetto d'azienda", async () => {
    await semina(TENANT, usdInNano(5)!, "grosso");
    const governato = avvolgiConGovernor(providerFinto(), CONTESTO, {
      configurazione: configSenzaTetti(),
    });
    const risposta = await governato.rispondi(richiesta("run-senza-politica"));
    expect(risposta.tipo).toBe("messaggio");
  });
});

describe("governor — tetto d'azienda", () => {
  it("politica bloccante e budget esaurito: ErroreBudget «azienda» col messaggio d'azienda", async () => {
    const consumo = usdInNano(0.09)!;
    await semina(TENANT, consumo, "quasi-pieno");
    const finta = politicaFinta({ limiteNano: consumo + stimaAttesa() - 1, bloccante: true });
    impostaPoliticaTarsAzienda(finta.politica);

    const governato = avvolgiConGovernor(providerFinto(), CONTESTO, {
      configurazione: configSenzaTetti(),
    });
    const errore = await governato.rispondi(richiesta("run-oltre")).catch(e => e);

    expect(errore).toBeInstanceOf(ErroreBudget);
    expect((errore as ErroreBudget).limite).toBe("azienda");
    expect((errore as ErroreBudget).message).toBe(MESSAGGIO_BUDGET_AZIENDA);
    expect((errore as ErroreBudget).consumoNano).toBe(consumo);
    expect(messaggioPerLimite("azienda")).toBe(MESSAGGIO_BUDGET_AZIENDA);
    expect(MESSAGGIO_BUDGET_AZIENDA).not.toBe(MESSAGGIO_BUDGET);

    // Nessuna riga nuova: la chiamata non è partita.
    expect(ledger.righe()).toHaveLength(1);

    // La politica sa del rifiuto, col consumo del mese (senza la stima).
    await finta.prossima();
    expect(finta.chiamate).toEqual([
      { tenantId: TENANT, aziendaMeseNano: consumo, rifiutata: true },
    ]);
  });

  it("politica NON bloccante: la chiamata passa e la politica riceve il consumo del mese con la stima", async () => {
    const consumo = usdInNano(0.09)!;
    await semina(TENANT, consumo, "in-tolleranza");
    const finta = politicaFinta({ limiteNano: 1, bloccante: false }); // tetto assurdo, non bloccante
    impostaPoliticaTarsAzienda(finta.politica);

    const governato = avvolgiConGovernor(providerFinto(), CONTESTO, {
      configurazione: configSenzaTetti(),
    });
    const risposta = await governato.rispondi(richiesta("run-avviso"));
    expect(risposta.tipo).toBe("messaggio");

    await finta.prossima();
    expect(finta.chiamate).toEqual([
      {
        tenantId: TENANT,
        aziendaMeseNano: consumo + stimaAttesa(),
        rifiutata: false,
      },
    ]);
  });

  it("il consumo di un'ALTRA azienda non conta nel tetto di questa", async () => {
    await semina(99, usdInNano(5)!, "altra-azienda");
    const finta = politicaFinta({ limiteNano: usdInNano(1)!, bloccante: true });
    impostaPoliticaTarsAzienda(finta.politica);

    const governato = avvolgiConGovernor(providerFinto(), CONTESTO, {
      configurazione: configSenzaTetti(),
    });
    const risposta = await governato.rispondi(richiesta("run-altra"));
    expect(risposta.tipo).toBe("messaggio");
  });

  it("un guasto della politica non blocca la chiamata (l'avviso non è la risposta)", async () => {
    impostaPoliticaTarsAzienda({
      limite: async () => ({ limiteNano: null, bloccante: false }),
      dopoPrenotazione: async () => {
        throw new Error("control plane giù");
      },
    });
    const governato = avvolgiConGovernor(providerFinto(), CONTESTO, {
      configurazione: configSenzaTetti(),
    });
    const risposta = await governato.rispondi(richiesta("run-guasto"));
    expect(risposta.tipo).toBe("messaggio");
  });

  it("un rifiuto dei tetti GLOBALI non chiama la politica d'azienda", async () => {
    const finta = politicaFinta({ limiteNano: usdInNano(10)!, bloccante: true });
    impostaPoliticaTarsAzienda(finta.politica);
    const configurazione: ConfigurazioneBudget = {
      ...configSenzaTetti(),
      limiti: { runNano: 1, giornoNano: 1, meseNano: 1 },
    };

    const governato = avvolgiConGovernor(providerFinto(), CONTESTO, { configurazione });
    const errore = await governato.rispondi(richiesta("run-globale")).catch(e => e);

    expect(errore).toBeInstanceOf(ErroreBudget);
    expect((errore as ErroreBudget).limite).toBe("run");
    await finta.prossima();
    expect(finta.chiamate).toEqual([]);
  });
});
