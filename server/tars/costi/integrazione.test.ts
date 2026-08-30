// Cost hardening — le prove END-TO-END attraverso il runtime reale:
// il run degrada con un messaggio controllato quando il budget è
// esaurito, il CRM resta indifferente, e NESSUN test tocca la rete.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../../_core/context";
import { appRouter } from "../../routers";
import { getUtentiStore } from "../../routers/utenti";
import {
  azzeraArchivioPerTest,
  statisticheRun,
  turniDiConversazione,
} from "../archivio";
import { costruisciContesto } from "../contesto";
import { creaProviderFinto, rispostaTesto } from "../openai/fake";
import { azzeraCacheTarsPerTest, eseguiRun } from "../orchestratore";
import { azzeraRateLimitTarsPerTest } from "../../routers/tars";
import {
  avvolgiConGovernor,
  MESSAGGIO_BUDGET_RUN,
} from "./governor";
import {
  creaLedgerMemoriaPerTest,
  impostaLedgerPerTest,
} from "./ledger";
import { nanoInUsd, usdInNano } from "./tariffe";

const SEDE = 94001;
const DIREZIONE_ID = 94011;
const COMMERCIALE_ID = 94012;
const MODELLO = "gpt-5.6-terra";

for (const [id, ruoli] of [
  [DIREZIONE_ID, ["direzione"]],
  [COMMERCIALE_ID, ["commerciale"]],
] as const) {
  const utenti = getUtentiStore() as any[];
  if (!utenti.some(u => u.id === id)) {
    utenti.push({
      id,
      nome: `Costi${id}`,
      cognome: "Tars",
      email: `tars-costi-${id}@example.test`,
      attivo: true,
      ruoli: [...ruoli],
      ruolo: ruoli[0],
      sediIds: [SEDE],
    });
  }
}

function contestoTrpc(
  userId = DIREZIONE_ID,
  roles: string[] = ["direzione"]
): TrpcContext {
  return {
    user: {
      id: userId,
      role: roles.includes("direzione") ? "admin" : "user",
      ruolo: roles[0],
      ruoli: roles,
      name: `Utente ${userId}`,
    } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId: SEDE,
    sediIds: [SEDE],
  };
}

let ledger: ReturnType<typeof creaLedgerMemoriaPerTest>;

beforeEach(() => {
  azzeraCacheTarsPerTest();
  azzeraArchivioPerTest();
  azzeraRateLimitTarsPerTest();
  ledger = creaLedgerMemoriaPerTest();
  impostaLedgerPerTest(ledger);
});

afterEach(() => {
  impostaLedgerPerTest(null);
  vi.restoreAllMocks();
  delete process.env.TARS_MODEL_INTERACTIVE;
  delete process.env.TARS_PROVIDER;
  delete process.env.OPENAI_API_KEY;
});

const configurazioneMinima = {
  limiti: {
    runNano: usdInNano(0.001)!, // troppo piccolo per qualunque chiamata
    giornoNano: usdInNano(0.001)!,
    meseNano: usdInNano(0.001)!,
  },
  perRunUsd: 0.001,
  giornalieroUsd: 0.001,
  mensileUsd: 0.001,
  margineStima: 1.25,
  scadenzaPrenotazioneMs: 600_000,
};

/**
 * La stima REALE di una chiamata con il catalogo strumenti corrente:
 * i test dei tetti derivano i limiti da qui invece di scrivere numeri a
 * mano, che invecchierebbero al primo strumento aggiunto.
 */
async function stimaPerRunCorrente(contesto: {
  sedeId: number;
  utenteId: number;
}): Promise<number> {
  const sonda = creaLedgerMemoriaPerTest();
  const governato = avvolgiConGovernor(
    creaProviderFinto(() => rispostaTesto("sonda")),
    contesto,
    {
      configurazione: {
        ...configurazioneMinima,
        limiti: {
          runNano: usdInNano(10)!,
          giornoNano: usdInNano(10)!,
          meseNano: usdInNano(10)!,
        },
      },
      ledger: sonda,
    }
  );
  const contestoRun = await costruisciContesto(contestoTrpc());
  await eseguiRun({
    contesto: contestoRun,
    provider: governato,
    messaggio: "sonda di stima",
    configurazione: { modello: MODELLO },
  });
  return sonda.righe()[0].costoPrenotatoNano;
}

describe("cost hardening — end to end nel runtime", () => {
  it("budget esaurito: il run degrada col messaggio controllato e NON chiama il provider", async () => {
    const contesto = await costruisciContesto(contestoTrpc());
    let chiamateSottostanti = 0;
    const governato = avvolgiConGovernor(
      creaProviderFinto(() => {
        chiamateSottostanti += 1;
        return rispostaTesto("non dovrebbe accadere");
      }),
      { sedeId: contesto.sedeId, utenteId: contesto.utenteId },
      { configurazione: configurazioneMinima, ledger }
    );

    const esito = await eseguiRun({
      contesto,
      provider: governato,
      messaggio: "Una domanda qualunque",
      configurazione: { modello: MODELLO },
    });

    expect(esito.stato).toBe("degradato");
    expect(esito.testo).toBe(MESSAGGIO_BUDGET_RUN);
    expect(chiamateSottostanti).toBe(0);
    // Nessuna prenotazione lasciata appesa.
    expect(ledger.righe()).toHaveLength(0);

    // L'utente vede il messaggio nel turno persistito.
    const turni = await turniDiConversazione(esito.conversazioneId, SEDE);
    expect(turni[turni.length - 1].contenuto).toBe(MESSAGGIO_BUDGET_RUN);
  });

  it("il budget esaurito NON apre il circuito né innesca retry", async () => {
    const contesto = await costruisciContesto(contestoTrpc());
    let chiamateSottostanti = 0;
    const governato = avvolgiConGovernor(
      creaProviderFinto(() => {
        chiamateSottostanti += 1;
        return rispostaTesto("mai");
      }),
      { sedeId: contesto.sedeId, utenteId: contesto.utenteId },
      { configurazione: configurazioneMinima, ledger }
    );
    for (let i = 0; i < 4; i++) {
      const esito = await eseguiRun({
        contesto,
        provider: governato,
        messaggio: `Domanda ${i}`,
        configurazione: { modello: MODELLO },
      });
      // Sempre lo stesso messaggio: mai «il modello non è disponibile».
      expect(esito.testo).toBe(MESSAGGIO_BUDGET_RUN);
    }
    expect(chiamateSottostanti).toBe(0);
  });

  it("il tetto per-run ferma un run multi-strumento a metà, conservando le azioni già fatte", async () => {
    const contesto = await costruisciContesto(contestoTrpc());
    // Budget sufficiente per UNA chiamata, non per due (la stima col
    // catalogo strumenti reale è ~0,03 USD: v. il test successivo).
    // I limiti si DERIVANO dalla stima misurata a runtime: così il test
    // non si rompe se il catalogo strumenti o il prompt crescono
    // (revisione). Tetto = una stima + un margine che non basta per due
    // chiamate dopo un consumo reale pesante.
    const stimaUnitaria = await stimaPerRunCorrente(contesto);
    const runNano = Math.round(stimaUnitaria * 1.2);
    const configurazione = {
      ...configurazioneMinima,
      limiti: {
        runNano,
        giornoNano: usdInNano(2)!,
        meseNano: usdInNano(20)!,
      },
      perRunUsd: nanoInUsd(runNano),
      giornalieroUsd: 2,
      mensileUsd: 20,
    };
    const governato = avvolgiConGovernor(
      creaProviderFinto(() => ({
        tipo: "tool_call" as const,
        chiamate: [
          {
            id: "c1",
            nome: "leggi_promemoria_in_scadenza",
            argomenti: "{}",
          },
        ],
        // Consumo reale alto: dopo la 1ª chiamata il tetto per-run è pieno.
        uso: { input: 5_000, output: 1_200, cachedInput: 0, cacheWrite: 0 },
      })),
      { sedeId: contesto.sedeId, utenteId: contesto.utenteId },
      { configurazione, ledger }
    );

    const esito = await eseguiRun({
      contesto,
      provider: governato,
      messaggio: "Fai molte cose",
      configurazione: { modello: MODELLO },
    });
    expect(esito.stato).toBe("degradato");
    expect(esito.testo).toBe(MESSAGGIO_BUDGET_RUN);
    // Le chiamate avvenute sono contabilizzate e CHIUSE: nessuna
    // prenotazione appesa dopo il blocco.
    const righe = ledger.righe();
    expect(righe.length).toBeGreaterThan(0);
    expect(righe.every(r => r.stato === "settled")).toBe(true);
    // Il consumo del run non supera mai il tetto.
    const consumo = await ledger.consumoCorrente({
      runId: esito.runId,
      adesso: new Date(),
    });
    expect(consumo.runNano).toBeLessThanOrEqual(configurazione.limiti.runNano);
    // Lo strumento eseguito prima del blocco resta nel conto del run.
    expect(esito.strumentiUsati).toContain("leggi_promemoria_in_scadenza");
  });

  it("MISURA: la prenotazione per chiamata col catalogo reale e quante ne consente il tetto approvato", async () => {
    const contesto = await costruisciContesto(contestoTrpc());
    let stimaVista = 0;
    const configurazione = {
      ...configurazioneMinima,
      limiti: {
        runNano: usdInNano(0.1)!,
        giornoNano: usdInNano(2)!,
        meseNano: usdInNano(20)!,
      },
      perRunUsd: 0.1,
      giornalieroUsd: 2,
      mensileUsd: 20,
    };
    const governato = avvolgiConGovernor(
      creaProviderFinto(() => rispostaTesto("ok")),
      { sedeId: contesto.sedeId, utenteId: contesto.utenteId },
      { configurazione, ledger }
    );
    await eseguiRun({
      contesto,
      provider: governato,
      messaggio: "Quante ne posso fare?",
      configurazione: { modello: MODELLO },
    });
    stimaVista = ledger.righe()[0].costoPrenotatoNano;

    // Il numero è MISURATO, non dichiarato: se il catalogo strumenti
    // cresce e la prenotazione supera un terzo del tetto per-run, questo
    // test lo fa notare prima che lo scopra un utente.
    expect(stimaVista).toBeGreaterThan(0);
    expect(stimaVista).toBeLessThan(usdInNano(0.1)! / 3);
  });

  it("un run con più chiamate al modello resta sotto il tetto approvato da 0,10 USD", async () => {
    const contesto = await costruisciContesto(contestoTrpc());
    const configurazione = {
      ...configurazioneMinima,
      limiti: {
        runNano: usdInNano(0.1)!,
        giornoNano: usdInNano(2)!,
        meseNano: usdInNano(20)!,
      },
      perRunUsd: 0.1,
      giornalieroUsd: 2,
      mensileUsd: 20,
    };
    // Consumo reale realistico CON prompt caching (il prefisso stabile
    // è la parte cache-abile): 2.000 pieni + 6.000 cached + 400 output.
    let passi = 0;
    const governato = avvolgiConGovernor(
      creaProviderFinto(() => {
        passi += 1;
        return passi <= 3
          ? {
              tipo: "tool_call" as const,
              chiamate: [
                {
                  id: `c${passi}`,
                  nome: "leggi_promemoria_in_scadenza",
                  argomenti: "{}",
                },
              ],
              uso: {
                input: 8_000,
                cachedInput: 6_000,
                output: 400,
                cacheWrite: 0,
              },
            }
          : {
              tipo: "messaggio" as const,
              testo: "Finito.",
              uso: {
                input: 8_000,
                cachedInput: 6_000,
                output: 400,
                cacheWrite: 0,
              },
            };
      }),
      { sedeId: contesto.sedeId, utenteId: contesto.utenteId },
      { configurazione, ledger }
    );
    const esito = await eseguiRun({
      contesto,
      provider: governato,
      messaggio: "Un run con tre giri di strumenti",
      configurazione: { modello: MODELLO },
    });
    expect(esito.stato).toBe("ok");
    expect(ledger.righe()).toHaveLength(4); // 3 tool call + risposta
    const consumo = await ledger.consumoCorrente({
      runId: esito.runId,
      adesso: new Date(),
    });
    expect(consumo.runNano).toBeLessThanOrEqual(usdInNano(0.1)!);
  });

  it("con Tars spento non esiste alcuna contabilità e il CRM risponde normalmente", async () => {
    process.env.FLAG_TARS = "off";
    try {
      const caller = appRouter.createCaller(contestoTrpc());
      await expect(caller.tars.invia({ messaggio: "ciao" })).rejects.toMatchObject(
        { code: "PRECONDITION_FAILED" }
      );
      await expect(caller.tars.costi()).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      // Il CRM NON è Tars: i suoi router rispondono come sempre
      // (revisione: prima si asseriva solo il rifiuto di Tars).
      const commesse = await caller.commesse.list();
      expect(Array.isArray(commesse)).toBe(true);
      const permessi = await caller.permessi.mie();
      expect(permessi).toBeTruthy();
      expect(ledger.righe()).toHaveLength(0);
    } finally {
      delete process.env.FLAG_TARS;
    }
  });

  it("DOPPIO CLICK: due invii identici IN VOLO producono un solo run", async () => {
    const caller = appRouter.createCaller(contestoTrpc());
    const primaDelDoppio = await statisticheRun(SEDE);

    const [prima, seconda] = await Promise.all([
      caller.tars.invia({ messaggio: "Domanda doppia identica" }),
      caller.tars.invia({ messaggio: "Domanda doppia identica" }),
    ]);
    expect(seconda.runId).toBe(prima.runId); // un solo run, una sola spesa

    const dopoIlDoppio = await statisticheRun(SEDE);
    expect(dopoIlDoppio.totale - primaDelDoppio.totale).toBe(1);

    // Un solo turno di risposta nella conversazione (non due).
    const turni = await turniDiConversazione(prima.conversazioneId, SEDE);
    expect(turni.filter(t => t.ruolo === "tars")).toHaveLength(1);
  });

  it("una domanda RIPETUTA dopo la risposta è un run nuovo, non un replay muto", async () => {
    // Il contrario del doppio click: qui l'utente ha già visto la
    // risposta e richiede volutamente. Deve ottenere un turno nuovo,
    // altrimenti il messaggio sparisce nel nulla (seconda revisione).
    const caller = appRouter.createCaller(contestoTrpc());
    const apertura = await caller.tars.invia({ messaggio: "Apri la chat" });
    const conversazioneId = apertura.conversazioneId;

    // STESSA chiave di dedup (stessa conversazione, stesso testo) ma in
    // sequenza: il primo è già concluso quando parte il secondo.
    const prima = await caller.tars.invia({
      messaggio: "Ripetimi la cosa",
      conversazioneId,
    });
    const seconda = await caller.tars.invia({
      messaggio: "Ripetimi la cosa",
      conversazioneId,
    });
    expect(seconda.runId).not.toBe(prima.runId);

    const turni = await turniDiConversazione(conversazioneId, SEDE);
    // apertura + due ripetizioni = 3 domande e 3 risposte.
    expect(turni.filter(t => t.ruolo === "utente")).toHaveLength(3);
    expect(turni.filter(t => t.ruolo === "tars")).toHaveLength(3);
  });

  it("i limiti del run resistono a una configurazione malformata (fail-closed)", async () => {
    process.env.TARS_MAX_MODEL_CALLS = "non-un-numero";
    try {
      const contesto = await costruisciContesto(contestoTrpc());
      let chiamate = 0;
      const esito = await eseguiRun({
        contesto,
        // Copione che chiama strumenti all'infinito: senza un tetto
        // valido girerebbe finché non finisce il budget (o mai).
        provider: creaProviderFinto(() => {
          chiamate += 1;
          return {
            tipo: "tool_call" as const,
            chiamate: [
              {
                id: `c${chiamate}`,
                nome: "leggi_promemoria_in_scadenza",
                argomenti: "{}",
              },
            ],
            uso: { input: 100, output: 10, cachedInput: 0, cacheWrite: 0 },
          };
        }),
        messaggio: "Loop con configurazione rotta",
        // Passi alti di proposito: l'UNICO tetto che può fermare il
        // loop è `maxChiamateModello`, che qui arriva da una variabile
        // malformata. Se degradasse a NaN il confronto sarebbe sempre
        // falso e il loop girerebbe 51 volte.
        configurazione: { modello: MODELLO, maxPassiStrumenti: 50 },
      });
      // Il default (8) resta in vigore: il run degrada, non gira a vuoto.
      expect(esito.stato).toBe("degradato");
      expect(chiamate).toBeLessThanOrEqual(8);
      expect(chiamate).toBeGreaterThan(0);
    } finally {
      delete process.env.TARS_MAX_MODEL_CALLS;
    }
  });

  it("i limiti tecnici del run NON si travestono da guasto del provider", async () => {
    const contesto = await costruisciContesto(contestoTrpc());
    let chiamate = 0;
    const provider = creaProviderFinto(() => {
      chiamate += 1;
      return {
        tipo: "tool_call" as const,
        chiamate: [
          { id: `c${chiamate}`, nome: "leggi_promemoria_in_scadenza", argomenti: "{}" },
        ],
        uso: { input: 100, output: 10, cachedInput: 0, cacheWrite: 0 },
      };
    });
    const esito = await eseguiRun({
      contesto,
      provider,
      messaggio: "Loop lungo",
      configurazione: { modello: MODELLO, maxChiamateModello: 2 },
    });
    expect(esito.stato).toBe("degradato");
    // Messaggio veritiero: il modello è disponibile, è il RUN ad avere
    // un tetto (revisione: prima diceva «il modello non è disponibile»).
    expect(esito.testo).toContain("passaggi");
    expect(esito.testo).not.toContain("non è al momento disponibile");

    // E il circuito NON si è aperto: un run successivo parte davvero.
    const dopo = await eseguiRun({
      contesto,
      provider: creaProviderFinto(() => rispostaTesto("tutto bene")),
      messaggio: "Domanda normale dopo il limite",
      configurazione: { modello: MODELLO },
    });
    expect(dopo.stato).toBe("ok");
  });

  it("la lettura dei costi è riservata alla direzione e non espone contenuti", async () => {
    const commerciale = appRouter.createCaller(
      contestoTrpc(COMMERCIALE_ID, ["commerciale"])
    );
    await expect(commerciale.tars.costi()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    const direzione = appRouter.createCaller(contestoTrpc());
    const costi = await direzione.tars.costi();
    expect(costi.budgetConfigurato).toMatchObject({
      perRunUsd: 0.1,
      giornalieroUsd: 2,
      mensileUsd: 20,
    });
    expect(costi.provider.tipo).toBe("finto");
    expect(costi.provider.motivoIndisponibilita).toBeTruthy();
    // Solo numeri e stati: nessun testo di conversazione o documento.
    const serializzato = JSON.stringify(costi);
    expect(serializzato).not.toMatch(/promemoria|commessa|prompt|messaggio/i);
  });

  it("budget e diagnosi infrastrutturale non sono visibili a chi non è direzione", async () => {
    const commerciale = appRouter.createCaller(
      contestoTrpc(COMMERCIALE_ID, ["commerciale"])
    );
    const stato = await commerciale.tars.stato();
    // Il tipo di provider sì (è già nella UI), i soldi e i motivi
    // infrastrutturali no (revisione: prima li vedeva chiunque).
    expect(stato.providerDettaglio.tipo).toBe("finto");
    expect(stato.providerDettaglio.budget).toBeNull();
    expect(stato.providerDettaglio.motivoIndisponibilita).toBeNull();
    expect(JSON.stringify(stato)).not.toContain("OPENAI_API_KEY");

    // Alla direzione invece serve la diagnosi completa.
    const direzione = appRouter.createCaller(contestoTrpc());
    const statoDirezione = await direzione.tars.stato();
    expect(statoDirezione.providerDettaglio.budget).not.toBeNull();
    expect(statoDirezione.providerDettaglio.motivoIndisponibilita).toBeTruthy();
  });

  it("il fake NON maschera una configurazione di produzione errata", async () => {
    process.env.TARS_PROVIDER = "openai";
    process.env.TARS_MODEL_INTERACTIVE = "modello-non-a-catalogo";
    const direzione = appRouter.createCaller(contestoTrpc());
    const stato = await direzione.tars.stato();
    expect(stato.provider).toBe("finto");
    expect(stato.providerDettaglio.motivoIndisponibilita).toBeTruthy();
  });

  it("la guardia GLOBALE anti-rete è attiva e morde su qualunque host esterno", async () => {
    // Non è un mock locale: è il setup della suite (server/_core/
    // testSetup.ts), quindi vale per TUTTI i file di test. Se domani un
    // test collegasse per errore il provider reale, fallirebbe qui
    // invece di uscire verso Internet (revisione).
    await expect(fetch("https://api.openai.com/v1/responses")).rejects.toThrow(
      /RETE VIETATA NEI TEST/
    );
    await expect(fetch("https://example.com")).rejects.toThrow(
      /RETE VIETATA NEI TEST/
    );

    // Copre anche node:http/https, cioè axios (usato da _core/sdk.ts e
    // importato da ogni test dei router): senza, la guardia sarebbe
    // aggirabile senza accorgersene (revisione conclusiva).
    // `.default` è l'oggetto CJS che axios ottiene con require(): è
    // quello che la guardia patcha (il namespace ESM ha binding
    // immutabili e non è la strada che le librerie usano).
    const https = (await import("node:https")).default;
    expect(() =>
      https.request("https://api.openai.com/v1/responses")
    ).toThrow(/RETE VIETATA NEI TEST/);
    const http = (await import("node:http")).default;
    expect(() => http.get("http://example.com/x")).toThrow(
      /RETE VIETATA NEI TEST/
    );
    // Localhost resta permesso — non lo si prova aprendo un socket vero
    // (morirebbe in modo asincrono e farebbe fallire l'intera suite):
    // lo dimostra il resto della suite, che usa server in-process.

    // E un run normale col fake non la sfiora nemmeno.
    const contesto = await costruisciContesto(contestoTrpc());
    const esito = await eseguiRun({
      contesto,
      provider: creaProviderFinto(() => rispostaTesto("tutto locale")),
      messaggio: "Domanda offline",
    });
    expect(esito.stato).toBe("ok");
  });

  it("il provider REALE, se mai invocato in un test, non raggiunge la rete", async () => {
    // Prova diretta del percorso pericoloso: si costruisce l'adapter
    // grezzo (unico punto con `fetch` verso OpenAI) e lo si invoca. La
    // guardia globale lo ferma prima di qualunque byte in uscita.
    process.env.FLAG_TARS = "on";
    process.env.OPENAI_API_KEY = "sk-finta-per-il-test";
    try {
      const { creaProviderRealeGrezzo } = await import("../openai/adapter");
      const grezzo = creaProviderRealeGrezzo();
      await expect(
        grezzo.rispondi({
          modello: MODELLO,
          istruzioni: "x",
          input: [{ ruolo: "user", contenuto: "y" }],
          strumenti: [],
          maxOutputToken: 10,
          chiaveCachePrompt: "k",
          timeoutMs: 1_000,
          identita: {
            runId: "r",
            passo: 0,
            tentativo: 1,
            conversazioneId: null,
          },
        })
      ).rejects.toThrow();
    } finally {
      delete process.env.FLAG_TARS;
      delete process.env.OPENAI_API_KEY;
    }
  });
});
