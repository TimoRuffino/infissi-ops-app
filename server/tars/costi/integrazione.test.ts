// Cost hardening — le prove END-TO-END attraverso il runtime reale:
// il run degrada con un messaggio controllato quando il budget è
// esaurito, il CRM resta indifferente, e NESSUN test tocca la rete.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../../_core/context";
import { appRouter } from "../../routers";
import { getUtentiStore } from "../../routers/utenti";
import { azzeraArchivioPerTest, turniDiConversazione } from "../archivio";
import { costruisciContesto } from "../contesto";
import { creaProviderFinto, rispostaTesto } from "../openai/fake";
import { azzeraCacheTarsPerTest, eseguiRun } from "../orchestratore";
import { azzeraRateLimitTarsPerTest } from "../../routers/tars";
import { avvolgiConGovernor, MESSAGGIO_BUDGET } from "./governor";
import {
  creaLedgerMemoriaPerTest,
  impostaLedgerPerTest,
} from "./ledger";
import { usdInNano } from "./tariffe";

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
    expect(esito.testo).toBe(MESSAGGIO_BUDGET);
    expect(chiamateSottostanti).toBe(0);
    // Nessuna prenotazione lasciata appesa.
    expect(ledger.righe()).toHaveLength(0);

    // L'utente vede il messaggio nel turno persistito.
    const turni = await turniDiConversazione(esito.conversazioneId, SEDE);
    expect(turni[turni.length - 1].contenuto).toBe(MESSAGGIO_BUDGET);
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
      expect(esito.testo).toBe(MESSAGGIO_BUDGET);
    }
    expect(chiamateSottostanti).toBe(0);
  });

  it("il tetto per-run ferma un run multi-strumento a metà, conservando le azioni già fatte", async () => {
    const contesto = await costruisciContesto(contestoTrpc());
    // Budget sufficiente per UNA chiamata, non per due (la stima col
    // catalogo strumenti reale è ~0,03 USD: v. il test successivo).
    const configurazione = {
      ...configurazioneMinima,
      limiti: {
        runNano: usdInNano(0.05)!,
        giornoNano: usdInNano(2)!,
        meseNano: usdInNano(20)!,
      },
      perRunUsd: 0.05,
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
    expect(esito.testo).toBe(MESSAGGIO_BUDGET);
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

  it("con Tars spento non esiste alcuna contabilità né alcuna chiamata", async () => {
    process.env.FLAG_TARS = "off";
    try {
      const caller = appRouter.createCaller(contestoTrpc());
      await expect(caller.tars.invia({ messaggio: "ciao" })).rejects.toMatchObject(
        { code: "PRECONDITION_FAILED" }
      );
      await expect(caller.tars.costi()).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(ledger.righe()).toHaveLength(0);
    } finally {
      delete process.env.FLAG_TARS;
    }
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

  it("il fake NON maschera una configurazione di produzione errata", async () => {
    process.env.TARS_PROVIDER = "openai";
    process.env.TARS_MODEL_INTERACTIVE = "modello-non-a-catalogo";
    const direzione = appRouter.createCaller(contestoTrpc());
    const stato = await direzione.tars.stato();
    expect(stato.provider).toBe("finto");
    expect(stato.providerDettaglio.motivoIndisponibilita).toBeTruthy();
  });

  it("nessuna richiesta di rete parte durante i run di test", async () => {
    const spiaFetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => {
        throw new Error("RETE VIETATA NEI TEST");
      });
    const contesto = await costruisciContesto(contestoTrpc());
    const esito = await eseguiRun({
      contesto,
      provider: creaProviderFinto(() => rispostaTesto("tutto locale")),
      messaggio: "Domanda offline",
    });
    expect(esito.stato).toBe("ok");
    expect(spiaFetch).not.toHaveBeenCalled();
  });
});
