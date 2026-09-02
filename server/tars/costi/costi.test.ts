// Cost hardening — le prove del budget governor (spec §27).
//
// Il provider sottostante è SEMPRE finto: nessun test tocca la rete.
// Il ledger è quello in memoria (stessa semantica dell'autorevole), che
// NON abilita mai il provider reale: lo prova `confine.test.ts`.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  avvolgiConGovernor,
  configurazioneBudget,
  ErroreBudget,
  MESSAGGIO_BUDGET,
  messaggioPerLimite,
  stimaCostoNano,
  tokenInputStimati,
  usoPlausibile,
  type ConfigurazioneBudget,
} from "./governor";
import {
  costoContato,
  creaLedgerMemoriaPerTest,
  impostaLedgerPerTest,
  ledgerAutorevoleDisponibile,
  periodiLocali,
} from "./ledger";
import {
  CATALOGO_TARIFFE,
  costoNano,
  nanoInUsd,
  tariffaDi,
  usdInNano,
} from "./tariffe";
import { creaProviderFinto } from "../openai/fake";
import { ErroreProvider, type RichiestaProvider } from "../provider";
import { creaProviderPerRun, statoProvider } from "./providerGovernato";

const MODELLO = "gpt-5.6-terra";

function config(
  parziale: Partial<{ run: number; giorno: number; mese: number }> = {}
): ConfigurazioneBudget {
  const runUsd = parziale.run ?? 0.1;
  const giornoUsd = parziale.giorno ?? 2;
  const meseUsd = parziale.mese ?? 20;
  return {
    limiti: {
      runNano: usdInNano(runUsd)!,
      giornoNano: usdInNano(giornoUsd)!,
      meseNano: usdInNano(meseUsd)!,
    },
    perRunUsd: runUsd,
    giornalieroUsd: giornoUsd,
    mensileUsd: meseUsd,
    margineStima: 1.25,
    scadenzaPrenotazioneMs: 600_000,
  };
}

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

function richiesta(
  identita: { runId: string; passo: number; tentativo: number },
  opzioni: { caratteri?: number; maxOutput?: number } = {}
): RichiestaProvider {
  return {
    modello: MODELLO,
    istruzioni: "x".repeat(opzioni.caratteri ?? 4_000),
    input: [{ ruolo: "user", contenuto: "domanda" }],
    strumenti: [],
    maxOutputToken: opzioni.maxOutput ?? 1200,
    chiaveCachePrompt: "tars:test",
    timeoutMs: 45_000,
    identita: { ...identita, conversazioneId: 1 },
  };
}

const usoNullo = { input: 0, output: 0, cachedInput: 0, cacheWrite: 0 };

function providerConUso(uso: Partial<typeof usoNullo>) {
  return creaProviderFinto(() => ({
    tipo: "messaggio" as const,
    testo: "ok",
    uso: { ...usoNullo, ...uso },
  }));
}

// Riferimenti di calcolo usati dai test dei tetti (tariffa terra):
//   stima per chiamata standard (4.000 caratteri, 1.200 output)
//     = ceil(4007/2,5 * 1,25)=2004 input * 2 µ$ + 1.200 * 12 µ$ ≈ 0,0184 USD
//   consumo REALE «pesante» (5.000 input, 1.200 output)
//     = 10.000 + 14.400 µ$ = 0,0244 USD
const USO_PESANTE = { input: 5_000, cachedInput: 0, output: 1_200 };
const REALE_PESANTE_NANO = 24_400_000;

const VARIABILI_BUDGET = [
  "TARS_BUDGET_DOCUMENT_INTELLIGENCE_USD",
  "TARS_BUDGET_PROACTIVE_COMMESSA_USD",
  "TARS_BUDGET_PATTERN_AZIENDA_USD",
  "TARS_BUDGET_MIGLIORAMENTO_CRM_USD",
  "TARS_BUDGET_EVAL_USD",
  "TARS_MAX_COST_PER_RUN_USD",
  "TARS_DAILY_BUDGET_USD",
  "TARS_MONTHLY_BUDGET_USD",
  "TARS_MARGINE_STIMA",
  "TARS_SCADENZA_PRENOTAZIONE_MS",
  "TARS_SERVICE_TIER",
  "TARS_PROVIDER",
  "OPENAI_API_KEY",
  "FLAG_TARS",
  "TARS_MODEL_INTERACTIVE",
];

let ledger: ReturnType<typeof creaLedgerMemoriaPerTest>;

beforeEach(() => {
  // Ambiente pulito PRIMA di ogni test: un'ereditarietà dalla shell di
  // CI farebbe fallire le asserzioni sui default (revisione).
  for (const chiave of VARIABILI_BUDGET) delete process.env[chiave];
  ledger = creaLedgerMemoriaPerTest();
  impostaLedgerPerTest(ledger);
});

afterEach(() => {
  impostaLedgerPerTest(null);
  for (const chiave of VARIABILI_BUDGET) delete process.env[chiave];
});

describe("tariffe — catalogo chiuso e aritmetica esatta", () => {
  it("il modello approvato ha la tariffa attesa; uno sconosciuto è rifiutato", () => {
    const tariffa = tariffaDi(MODELLO)!;
    expect(tariffa).toMatchObject({
      input: 2_000_000_000,
      cachedInput: 200_000_000,
      output: 12_000_000_000,
      stato: "attiva",
    });
    // Il flagship, approvato il 30/08/2026, è tariffato a LISTINO
    // (non al prezzo promozionale): il tetto deve sovrastimare.
    expect(tariffaDi("gpt-5.6-sol")).toMatchObject({
      input: 5_000_000_000,
      cachedInput: 500_000_000,
      output: 30_000_000_000,
      stato: "attiva",
    });
    expect(tariffaDi("gpt-5.6-inesistente")).toBeNull();
    expect(tariffaDi("modello-inventato")).toBeNull();
    // Il catalogo resta CHIUSO: due modelli approvati, non uno di più.
    expect(
      CATALOGO_TARIFFE.filter(t => t.stato === "attiva").map(t => t.modello)
    ).toEqual(["gpt-5.6-sol", "gpt-5.6-terra"]);
  });

  it("input, cached input e output sono tariffati SEPARATAMENTE (cached ⊆ input)", () => {
    const tariffa = tariffaDi(MODELLO)!;
    // 10.000 input di cui 6.000 cached, 1.000 output:
    // 4.000 * 2 + 6.000 * 0.2 + 1.000 * 12 µ$ = 8.000 + 1.200 + 12.000 µ$
    const costo = costoNano(tariffa, {
      input: 10_000,
      cachedInput: 6_000,
      output: 1_000,
    });
    expect(Number(costo)).toBe(8_000_000 + 1_200_000 + 12_000_000);
    expect(nanoInUsd(costo)).toBeCloseTo(0.021_2, 6);

    // Se il cached fosse tariffato come input pieno il numero sarebbe
    // diverso: la distinzione è misurabile, non decorativa.
    const senzaSconto = costoNano(tariffa, {
      input: 10_000,
      cachedInput: 0,
      output: 1_000,
    });
    expect(Number(senzaSconto)).toBeGreaterThan(Number(costo));
  });

  it("la SCRITTURA in cache è tariffata 1,25×, non a prezzo pieno né gratis", () => {
    const tariffa = tariffaDi(MODELLO)!;
    // 10.000 input di cui 4.000 scritti in cache, nessuna lettura:
    // 6.000 * 2 + 4.000 * 2,5 + 1.000 * 12 µ$.
    const conScrittura = costoNano(tariffa, {
      input: 10_000,
      cachedInput: 0,
      cacheWrite: 4_000,
      output: 1_000,
    });
    expect(Number(conScrittura)).toBe(12_000_000 + 10_000_000 + 12_000_000);

    // Il confronto che fa mordere il test: se `cacheWrite` fosse
    // ignorato (o tariffato come input normale) il costo sarebbe più
    // basso di così, ed è esattamente l'errore che sotto-contabilizzava
    // la spesa reale su GPT-5.6.
    const comeInputNormale = costoNano(tariffa, {
      input: 10_000,
      cachedInput: 0,
      output: 1_000,
    });
    expect(Number(conScrittura)).toBeGreaterThan(Number(comeInputNormale));
    expect(Number(conScrittura) - Number(comeInputNormale)).toBe(
      // Il sovrapprezzo è esattamente 0,25× la tariffa di input,
      // che è espressa per MILIONE di token.
      (4_000 * (tariffa.input / 4)) / 1_000_000
    );
  });

  it("cached e cache write sono disgiunti: se la somma sfonda l'input, è incoerente", () => {
    const tariffa = tariffaDi(MODELLO)!;
    expect(() =>
      costoNano(tariffa, {
        input: 1_000,
        cachedInput: 700,
        cacheWrite: 700,
        output: 10,
      })
    ).toThrow(/COSTO_INCOERENTE/);
    expect(
      usoPlausibile({ input: 1_000, cachedInput: 700, cacheWrite: 700, output: 10 })
    ).toBe(false);
    expect(
      usoPlausibile({ input: 1_000, cachedInput: 300, cacheWrite: 400, output: 10 })
    ).toBe(true);
  });

  it("il service tier scala la tariffa: priority 2×, flex 0,5×, ignoto 1×", () => {
    const base = tariffaDi(MODELLO)!;
    process.env.TARS_SERVICE_TIER = "priority";
    const priority = tariffaDi(MODELLO)!;
    expect(priority.input).toBe(base.input * 2);
    expect(priority.cachedInput).toBe(base.cachedInput * 2);
    expect(priority.cacheWrite).toBe(base.cacheWrite * 2);
    expect(priority.output).toBe(base.output * 2);
    process.env.TARS_SERVICE_TIER = "flex";
    expect(tariffaDi(MODELLO)!.input).toBe(base.input / 2);
    // Valore ignoto: l'adapter non manda il campo, quindi la tariffa
    // resta quella base — i numeri combaciano per costruzione.
    process.env.TARS_SERVICE_TIER = "turbo-inventato";
    expect(tariffaDi(MODELLO)!.input).toBe(base.input);
    delete process.env.TARS_SERVICE_TIER;
  });

  it("nessun floating point: importi USD → nanodollari interi", () => {
    expect(usdInNano(0.1)).toBe(100_000_000);
    expect(usdInNano(2)).toBe(2_000_000_000);
    expect(usdInNano(20)).toBe(20_000_000_000);
    expect(usdInNano(0)).toBeNull();
    expect(usdInNano(-1)).toBeNull();
    expect(usdInNano(Number.NaN)).toBeNull();
    expect(Number.isInteger(usdInNano(0.07)!)).toBe(true);
  });
});

describe("configurazione — fail-closed", () => {
  it("senza variabili non c'è ALCUN tetto (decisione 01/09/2026, gate §8)", () => {
    const esito = configurazioneBudget();
    expect(esito.ok).toBe(true);
    if (esito.ok) {
      expect(esito.configurazione.perRunUsd).toBeNull();
      expect(esito.configurazione.giornalieroUsd).toBeNull();
      expect(esito.configurazione.mensileUsd).toBeNull();
      expect(esito.configurazione.limiti).toEqual({
        runNano: null,
        giornoNano: null,
        meseNano: null,
      });
    }
  });

  it("un valore impostato resta un tetto applicato, non un consiglio", () => {
    process.env.TARS_DAILY_BUDGET_USD = "5";
    const esito = configurazioneBudget();
    expect(esito.ok).toBe(true);
    if (esito.ok) {
      expect(esito.configurazione.giornalieroUsd).toBe(5);
      expect(esito.configurazione.perRunUsd).toBeNull();
    }
  });

  it("valori invalidi, negativi o incoerenti rendono il budget NON configurato", () => {
    process.env.TARS_DAILY_BUDGET_USD = "abc";
    expect(configurazioneBudget().ok).toBe(false);
    process.env.TARS_DAILY_BUDGET_USD = "-3";
    expect(configurazioneBudget().ok).toBe(false);
    process.env.TARS_DAILY_BUDGET_USD = "2";
    process.env.TARS_MAX_COST_PER_RUN_USD = "50"; // > giornaliero
    const incoerente = configurazioneBudget();
    expect(incoerente.ok).toBe(false);
    if (!incoerente.ok) expect(incoerente.motivo).toContain("incoerenti");
  });

  it("la gerarchia si valuta solo fra i tetti impostati", () => {
    // Solo il per-run: nessun giornaliero con cui essere incoerente.
    process.env.TARS_MAX_COST_PER_RUN_USD = "50";
    expect(configurazioneBudget().ok).toBe(true);
  });

  it("il tetto di sanità vale solo per un mensile impostato", () => {
    process.env.TARS_MONTHLY_BUDGET_USD = "5000";
    const oltre = configurazioneBudget();
    expect(oltre.ok).toBe(false);
    if (!oltre.ok) expect(oltre.motivo).toContain("sanità");
    delete process.env.TARS_MONTHLY_BUDGET_USD;
    expect(configurazioneBudget().ok).toBe(true);
  });
});

describe("governor — prenotazione, riconciliazione, tetti", () => {
  it("prenota prudenzialmente, poi riconcilia al costo REALE liberando il resto", async () => {
    const governato = avvolgiConGovernor(
      providerConUso({ input: 1_000, cachedInput: 400, output: 100 }),
      { sedeId: 1, utenteId: 7 },
      { configurazione: config(), ledger }
    );
    const req = richiesta({ runId: "run-a", passo: 0, tentativo: 1 });
    const stima = stimaCostoNano(req, tariffaDi(MODELLO)!, 1.25);
    await governato.rispondi(req);

    const [riga] = ledger.righe();
    expect(riga.stato).toBe("settled");
    expect(riga.costoPrenotatoNano).toBe(stima);
    // Reale = 600*2 + 400*0.2 + 100*12 µ$ = 1.200 + 80 + 1.200 µ$
    expect(riga.costoRealeNano).toBe(1_200_000 + 80_000 + 1_200_000);
    expect(riga.costoRealeNano!).toBeLessThan(riga.costoPrenotatoNano);
    expect(costoContato(riga)).toBe(riga.costoRealeNano);
    expect(riga.tokenCached).toBe(400);
  });

  it("senza tetti la spesa passa MA resta contabilizzata riga per riga", async () => {
    const governato = avvolgiConGovernor(
      providerConUso(USO_PESANTE),
      { sedeId: 1, utenteId: 1 },
      { configurazione: configSenzaTetti(), ledger }
    );
    for (let passo = 0; passo < 5; passo++) {
      const esito = await governato.rispondi(
        richiesta({ runId: "run-libero", passo, tentativo: 1 })
      );
      expect(esito.tipo).toBe("messaggio");
    }
    // Nessun rifiuto, ma il ledger ha TUTTE le righe riconciliate: la
    // contabilità sopravvive all'eliminazione dei tetti (gate §8).
    expect(ledger.righe()).toHaveLength(5);
    for (const riga of ledger.righe()) {
      expect(riga.stato).toBe("settled");
      expect(riga.costoRealeNano).toBe(REALE_PESANTE_NANO);
    }
  });

  it("blocca il tetto PER RUN aggregando tutte le chiamate dello stesso run", async () => {
    const governato = avvolgiConGovernor(
      providerConUso(USO_PESANTE),
      { sedeId: 1, utenteId: 7 },
      { configurazione: config({ run: 0.04 }), ledger }
    );
    // 1ª chiamata: consuma davvero 0,0244 USD del tetto da 0,04.
    await governato.rispondi(richiesta({ runId: "r", passo: 0, tentativo: 1 }));
    expect(ledger.righe()[0].costoRealeNano).toBe(REALE_PESANTE_NANO);
    // 2ª chiamata dello STESSO run: 0,0244 già speso + stima 0,0169 > 0,04.
    const errore = await governato
      .rispondi(richiesta({ runId: "r", passo: 1, tentativo: 1 }))
      .catch(e => e);
    expect(errore).toBeInstanceOf(ErroreBudget);
    expect((errore as ErroreBudget).limite).toBe("run");

    // Un ALTRO run riparte da zero sul tetto per-run.
    await expect(
      governato.rispondi(richiesta({ runId: "r2", passo: 0, tentativo: 1 }))
    ).resolves.toMatchObject({ tipo: "messaggio" });
  });

  it("blocca il tetto GIORNALIERO anche per un run nuovo", async () => {
    // Orologio iniettato: un run a cavallo della mezzanotte di Roma
    // darebbe «mese» invece di «giorno» (revisione).
    const adesso = new Date("2026-08-10T09:00:00.000Z");
    const perGiorno = avvolgiConGovernor(
      providerConUso(USO_PESANTE),
      { sedeId: 1, utenteId: 7 },
      {
        configurazione: config({ run: 0.04, giorno: 0.04 }),
        ledger,
        adesso: () => adesso,
      }
    );
    await perGiorno.rispondi(richiesta({ runId: "g1", passo: 0, tentativo: 1 }));
    const errore = await perGiorno
      .rispondi(richiesta({ runId: "g2", passo: 0, tentativo: 1 }))
      .catch(e => e);
    expect(errore).toBeInstanceOf(ErroreBudget);
    expect((errore as ErroreBudget).limite).toBe("giorno");
    // Il messaggio distingue «l'installazione è a secco» (giorno/mese)
    // da «questa richiesta è troppo grande» (run): l'utente deve capire
    // se riprovare più tardi o riformulare (revisione).
    expect(messaggioPerLimite("giorno")).toBe(MESSAGGIO_BUDGET);
    expect(messaggioPerLimite("mese")).toBe(MESSAGGIO_BUDGET);
    expect(messaggioPerLimite("run")).not.toBe(MESSAGGIO_BUDGET);
    expect(messaggioPerLimite("run")).toContain("troppo grande");
  });

  it("blocca il tetto MENSILE anche in un GIORNO diverso", async () => {
    let adesso = new Date("2026-08-10T09:00:00.000Z");
    const perMese = avvolgiConGovernor(
      providerConUso(USO_PESANTE),
      { sedeId: 1, utenteId: 7 },
      {
        configurazione: config({ run: 0.04, giorno: 0.04, mese: 0.04 }),
        ledger,
        adesso: () => adesso,
      }
    );
    await perMese.rispondi(richiesta({ runId: "m1", passo: 0, tentativo: 1 }));
    // Giorno dopo: i tetti run e giorno sono liberi, il MESE no.
    adesso = new Date("2026-08-11T09:00:00.000Z");
    const errore = await perMese
      .rispondi(richiesta({ runId: "m2", passo: 0, tentativo: 1 }))
      .catch(e => e);
    expect(errore).toBeInstanceOf(ErroreBudget);
    expect((errore as ErroreBudget).limite).toBe("mese");

    // Il mese SUCCESSIVO riparte pulito.
    adesso = new Date("2026-09-01T09:00:00.000Z");
    await expect(
      perMese.rispondi(richiesta({ runId: "m3", passo: 0, tentativo: 1 }))
    ).resolves.toMatchObject({ tipo: "messaggio" });
  });

  it("le sedi NON possono sommarsi oltre il tetto globale", async () => {
    const configurazione = config({ run: 0.04, giorno: 0.04 });
    const sedeUno = avvolgiConGovernor(
      providerConUso(USO_PESANTE),
      { sedeId: 1, utenteId: 7 },
      { configurazione, ledger }
    );
    const sedeDue = avvolgiConGovernor(
      providerConUso(USO_PESANTE),
      { sedeId: 2, utenteId: 8 },
      { configurazione, ledger }
    );
    await sedeUno.rispondi(richiesta({ runId: "s1", passo: 0, tentativo: 1 }));
    await expect(
      sedeDue.rispondi(richiesta({ runId: "s2", passo: 0, tentativo: 1 }))
    ).rejects.toBeInstanceOf(ErroreBudget);
  });

  it("prenotazioni CONCORRENTI: passa ESATTAMENTE il numero che il tetto consente", async () => {
    // Il tetto è misurato sulle PRENOTAZIONI (il picco), non sul consumo
    // riconciliato: asserire il consumo finale non morderebbe, perché la
    // riconciliazione lo riduce ben sotto il tetto (revisione).
    const stimaUnitaria = stimaCostoNano(
      richiesta({ runId: "x", passo: 0, tentativo: 1 }),
      tariffaDi(MODELLO)!,
      1.25
    );
    const capienza = 3;
    const giornoNano = stimaUnitaria * capienza + 1_000; // spazio per 3, non 4
    const governato = avvolgiConGovernor(
      providerConUso({ input: 10, output: 10 }),
      { sedeId: 1, utenteId: 7 },
      {
        configurazione: {
          ...config(),
          limiti: {
            runNano: usdInNano(1)!,
            giornoNano,
            meseNano: usdInNano(1)!,
          },
        },
        ledger,
      }
    );
    const esiti = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        governato.rispondi(richiesta({ runId: `c${i}`, passo: 0, tentativo: 1 }))
      )
    );
    const riuscite = esiti.filter(e => e.status === "fulfilled").length;
    const rifiutate = esiti.filter(
      e => e.status === "rejected" && (e as any).reason instanceof ErroreBudget
    ).length;
    expect(riuscite).toBe(capienza);
    expect(rifiutate).toBe(10 - capienza);
    // Il PICCO prenotato non ha mai superato il tetto.
    const piccoPrenotato = ledger
      .righe()
      .reduce((somma, r) => somma + r.costoPrenotatoNano, 0);
    expect(piccoPrenotato).toBeLessThanOrEqual(giornoNano);
  });

  it("la stessa chiamata ripetuta (retry/doppio click) non prenota due volte", async () => {
    const governato = avvolgiConGovernor(
      providerConUso({ input: 10, output: 10 }),
      { sedeId: 1, utenteId: 7 },
      { configurazione: config(), ledger }
    );
    const req = richiesta({ runId: "idem", passo: 0, tentativo: 1 });
    await governato.rispondi(req);
    // Stessa identità: la riga è già conclusa → nessuna seconda
    // contabilizzazione e nessuna seconda chiamata al provider.
    await expect(governato.rispondi(req)).rejects.toThrow(
      /già contabilizzata/
    );
    expect(ledger.righe()).toHaveLength(1);
  });

  it("un RETRY vero (tentativo 2) è una chiamata distinta e contabilizzata", async () => {
    const governato = avvolgiConGovernor(
      providerConUso({ input: 10, output: 10 }),
      { sedeId: 1, utenteId: 7 },
      { configurazione: config(), ledger }
    );
    await governato.rispondi(richiesta({ runId: "r", passo: 0, tentativo: 1 }));
    await governato.rispondi(richiesta({ runId: "r", passo: 0, tentativo: 2 }));
    expect(ledger.righe()).toHaveLength(2);
    expect(new Set(ledger.righe().map(r => r.chiamataId)).size).toBe(2);
  });
});

describe("governor — esiti anomali conservativi", () => {
  it("timeout e risposta invalida restano CONTATI (uncertain)", async () => {
    for (const categoria of ["timeout", "rete", "risposta_invalida"] as const) {
      const suo = creaLedgerMemoriaPerTest();
      const governato = avvolgiConGovernor(
        creaProviderFinto(() => {
          throw new ErroreProvider("guasto", categoria, true);
        }),
        { sedeId: 1, utenteId: 7 },
        { configurazione: config(), ledger: suo }
      );
      await expect(
        governato.rispondi(richiesta({ runId: "u", passo: 0, tentativo: 1 }))
      ).rejects.toBeInstanceOf(ErroreProvider);
      const [riga] = suo.righe();
      expect(riga.stato).toBe("uncertain");
      expect(costoContato(riga)).toBe(riga.costoPrenotatoNano);
      expect(costoContato(riga)).toBeGreaterThan(0);
    }
  });

  it("4xx e rate limit NON consumano: prenotazione rilasciata", async () => {
    for (const categoria of ["configurazione", "rate_limit"] as const) {
      const suo = creaLedgerMemoriaPerTest();
      const governato = avvolgiConGovernor(
        creaProviderFinto(() => {
          throw new ErroreProvider("rifiutata", categoria, false);
        }),
        { sedeId: 1, utenteId: 7 },
        { configurazione: config(), ledger: suo }
      );
      await expect(
        governato.rispondi(richiesta({ runId: "r", passo: 0, tentativo: 1 }))
      ).rejects.toBeInstanceOf(ErroreProvider);
      const [riga] = suo.righe();
      expect(riga.stato).toBe("released");
      expect(costoContato(riga)).toBe(0);
    }
  });

  it("riavvio fra prenotazione e riconciliazione: la spesa resta contata (expired)", async () => {
    const adesso = new Date("2026-08-30T10:00:00.000Z");
    // Prenotazione «orfana» come dopo un crash.
    const prenotazione = await ledger.prenota({
      chiamataId: "orfana",
      runId: "crash",
      sedeId: 1,
      utenteId: 7,
      conversazioneId: null,
      modello: MODELLO,
      costoPrenotatoNano: usdInNano(0.03)!,
      limiti: config().limiti,
      adesso,
    });
    expect(prenotazione.esito).toBe("prenotata");
    // Il consumo la conta già da `reserved`.
    const primaDelloScadere = await ledger.consumoCorrente({
      runId: "crash",
      adesso,
    });
    expect(primaDelloScadere.giornoNano).toBe(usdInNano(0.03));

    const dopo = new Date(adesso.getTime() + 20 * 60_000);
    expect(await ledger.scadiPrenotazioniVecchie(600_000, dopo)).toBe(1);
    const righe = ledger.righe();
    expect(righe[0].stato).toBe("expired");
    expect(costoContato(righe[0])).toBe(usdInNano(0.03));
  });

  it("un modello senza tariffa non parte MAI, nemmeno col budget libero", async () => {
    const governato = avvolgiConGovernor(
      providerConUso({ input: 10, output: 10 }),
      { sedeId: 1, utenteId: 7 },
      { configurazione: config(), ledger }
    );
    await expect(
      governato.rispondi({
        ...richiesta({ runId: "x", passo: 0, tentativo: 1 }),
        modello: "gpt-5.6-inesistente",
      })
    ).rejects.toThrow(/senza tariffa attiva/);
    expect(ledger.righe()).toHaveLength(0);
  });

  it("una chiamata senza identità di run è rifiutata (non contabilizzabile)", async () => {
    const governato = avvolgiConGovernor(
      providerConUso({ input: 10, output: 10 }),
      { sedeId: 1, utenteId: 7 },
      { configurazione: config(), ledger }
    );
    const senzaIdentita = { ...richiesta({ runId: "x", passo: 0, tentativo: 1 }) };
    delete (senzaIdentita as any).identita;
    await expect(governato.rispondi(senzaIdentita)).rejects.toThrow(
      /identità/
    );
    expect(ledger.righe()).toHaveLength(0);
  });
});

describe("governor — uso non plausibile e stima come soffitto", () => {
  it("una risposta SENZA uso non azzera la spesa: resta contata come incerta", async () => {
    // Provider grezzo (non il fake, che rimpiazza l'uso zero con una
    // simulazione): qui serve proprio il caso «usage assente».
    const senzaUso = {
      nome: "senza-uso",
      async rispondi() {
        return {
          tipo: "messaggio" as const,
          testo: "ok",
          uso: { input: 0, output: 0, cachedInput: 0, cacheWrite: 0 },
        };
      },
    };
    const governato = avvolgiConGovernor(
      senzaUso,
      { sedeId: 1, utenteId: 7 },
      { configurazione: config(), ledger }
    );
    await governato.rispondi(richiesta({ runId: "u0", passo: 0, tentativo: 1 }));
    const [riga] = ledger.righe();
    // Sarebbe il solo punto fail-OPEN: costo reale 0 su una chiamata che
    // il provider ha comunque fatturato (revisione).
    expect(riga.stato).toBe("uncertain");
    expect(costoContato(riga)).toBe(riga.costoPrenotatoNano);
    expect(costoContato(riga)).toBeGreaterThan(0);
  });

  it("un uso incoerente (cached > input) non viene contabilizzato a sconto", async () => {
    const incoerente = {
      nome: "incoerente",
      async rispondi() {
        return {
          tipo: "messaggio" as const,
          testo: "ok",
          uso: { input: 100, cachedInput: 900, output: 10, cacheWrite: 0 },
        };
      },
    };
    const governato = avvolgiConGovernor(
      incoerente,
      { sedeId: 1, utenteId: 7 },
      { configurazione: config(), ledger }
    );
    await governato.rispondi(richiesta({ runId: "u1", passo: 0, tentativo: 1 }));
    expect(ledger.righe()[0].stato).toBe("uncertain");
    // E la funzione di costo si rifiuta di calcolare quel caso.
    expect(() =>
      costoNano(tariffaDi(MODELLO)!, {
        input: 100,
        cachedInput: 900,
        output: 10,
      })
    ).toThrow(/INCOERENTE/);
  });

  it("la stima è un SOFFITTO: copre il costo reale di un payload tokenizzato fitto", () => {
    const tariffa = tariffaDi(MODELLO)!;
    const req = richiesta({ runId: "s", passo: 0, tentativo: 1 }, {
      caratteri: 20_000,
    });
    const stima = stimaCostoNano(req, tariffa, 1.25);
    const caratteri =
      req.istruzioni.length +
      req.input.reduce((s, m) => s + m.contenuto.length, 0);
    // Caso peggiore realistico per JSON/strutturato: ~2,5 char/token,
    // con TUTTO l'ingresso scritto in cache — la tariffa più cara che
    // OpenAI possa applicare a quei token (1,25×). Se la stima tornasse
    // a tariffare l'input a prezzo pieno, qui sarebbe sotto il costo
    // reale e il test fallirebbe: è la guardia contro il ritorno del
    // difetto scoperto il 31/08/2026.
    const tokenPeggiori = Math.ceil(caratteri / 2.5);
    const realePeggiore = Number(
      costoNano(tariffa, {
        input: tokenPeggiori,
        cachedInput: 0,
        cacheWrite: tokenPeggiori,
        output: req.maxOutputToken,
      })
    );
    expect(stima).toBeGreaterThanOrEqual(realePeggiore);
    expect(tokenInputStimati(req, 1.25)).toBeGreaterThanOrEqual(
      Math.ceil(caratteri / 2.5)
    );

    // SENZA margine il confronto isola la TARIFFA: col margine a 1,25
    // il test non discriminerebbe, perché 1,25 di margine compensa per
    // coincidenza il moltiplicatore 1,25 della scrittura in cache e la
    // stima resterebbe (di poco) sufficiente anche tariffando l'input a
    // prezzo pieno. Verificato con mutazione: senza questa asserzione,
    // rimettere `cacheWrite: 0` nella stima non fa fallire nulla.
    const stimaSenzaMargine = stimaCostoNano(req, tariffa, 1);
    const realeSenzaMargine = Number(
      costoNano(tariffa, {
        input: tokenInputStimati(req, 1),
        cachedInput: 0,
        cacheWrite: tokenInputStimati(req, 1),
        output: req.maxOutputToken,
      })
    );
    expect(stimaSenzaMargine).toBeGreaterThanOrEqual(realeSenzaMargine);
  });
});

describe("periodi — calendario Europe/Rome", () => {
  it("distingue l'ora SOLARE da quella legale (un offset fisso non basta)", () => {
    // 15/01/2026 22:30 UTC = 23:30 CET → stesso giorno. Con un offset
    // fisso +02:00 darebbe il 16: il test discrimina CET da CEST.
    expect(periodiLocali(new Date("2026-01-15T22:30:00.000Z"))).toEqual({
      giorno: "2026-01-15",
      mese: "2026-01",
    });
    // 15/07/2026 22:30 UTC = 00:30 CEST del 16 → giorno successivo.
    expect(periodiLocali(new Date("2026-07-15T22:30:00.000Z")).giorno).toBe(
      "2026-07-16"
    );
    // Cambio d'anno: 31/12 23:30 UTC = 00:30 CET del 1° gennaio.
    expect(periodiLocali(new Date("2026-12-31T23:30:00.000Z"))).toEqual({
      giorno: "2027-01-01",
      mese: "2027-01",
    });
  });

  it("il giorno è quello di Roma anche a cavallo della mezzanotte UTC", () => {
    // 30/08/2026 23:30 UTC = 31/08 01:30 a Roma (CEST).
    expect(periodiLocali(new Date("2026-08-30T23:30:00.000Z"))).toEqual({
      giorno: "2026-08-31",
      mese: "2026-08",
    });
    // 31/08/2026 22:30 UTC = 01/09 00:30 a Roma → mese NUOVO.
    expect(periodiLocali(new Date("2026-08-31T22:30:00.000Z"))).toEqual({
      giorno: "2026-09-01",
      mese: "2026-09",
    });
  });

  it("attorno al cambio d'ora il giorno resta corretto", () => {
    // Ultima domenica di ottobre 2026 (25/10): 00:30 UTC = 02:30 CEST.
    expect(periodiLocali(new Date("2026-10-25T00:30:00.000Z")).giorno).toBe(
      "2026-10-25"
    );
    // Dopo il ritorno all'ora solare: 01:30 UTC = 02:30 CET, stesso giorno.
    expect(periodiLocali(new Date("2026-10-25T01:30:00.000Z")).giorno).toBe(
      "2026-10-25"
    );
    // 29/03/2026 (ora legale): 00:30 UTC = 01:30 CET.
    expect(periodiLocali(new Date("2026-03-29T00:30:00.000Z")).giorno).toBe(
      "2026-03-29"
    );
  });
});

describe("provider reale — condizioni cumulative", () => {
  it("ogni condizione mancante blocca il reale, col motivo DICHIARATO", () => {
    const senzaNulla = statoProvider(MODELLO);
    expect(senzaNulla.tipo).toBe("finto");
    expect(senzaNulla.motivoIndisponibilita).toContain("TARS_PROVIDER");

    process.env.TARS_PROVIDER = "openai";
    // FLAG_TARS spento: la guardia del confine, non solo quella del
    // router (revisione: prima non era provata a questo livello).
    process.env.FLAG_TARS = "off";
    expect(statoProvider(MODELLO).motivoIndisponibilita).toContain(
      "FLAG_TARS"
    );
    delete process.env.FLAG_TARS;

    expect(statoProvider(MODELLO).motivoIndisponibilita).toContain(
      "OPENAI_API_KEY"
    );

    process.env.OPENAI_API_KEY = "sk-non-usata-nei-test";
    expect(statoProvider("modello-ignoto").motivoIndisponibilita).toContain(
      "tariffa attiva"
    );

    process.env.TARS_MAX_COST_PER_RUN_USD = "non-un-numero";
    expect(statoProvider(MODELLO).motivoIndisponibilita).toContain("Budget");
    delete process.env.TARS_MAX_COST_PER_RUN_USD;

    // Tutto a posto tranne il ledger autorevole (nei test manca PG):
    // il provider reale resta comunque disabilitato.
    expect(ledgerAutorevoleDisponibile()).toBe(false);
    const finale = statoProvider(MODELLO);
    expect(finale.tipo).toBe("finto");
    expect(finale.motivoIndisponibilita).toContain("Ledger");
  });

  it("la FABBRICA restituisce il fake quando manca una condizione, mai il reale nudo", () => {
    let usatoIlCopione = false;
    const fabbrica = () =>
      creaProviderPerRun({
        modello: MODELLO,
        sedeId: 1,
        utenteId: 7,
        copioneFinto: () => {
          usatoIlCopione = true;
          return {
            tipo: "messaggio" as const,
            testo: "fake",
            uso: { ...usoNullo, input: 1, output: 1 },
          };
        },
      });

    // Nessuna condizione: fake.
    expect(fabbrica().nome).toBe("finto");

    // Provider richiesto + chiave presente, ma senza ledger autorevole
    // (e senza PG nei test) resta fake: la difesa in profondità della
    // fabbrica è provata, non solo la diagnostica (revisione).
    process.env.TARS_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-non-usata-nei-test";
    const provider = fabbrica();
    expect(provider.nome).toBe("finto");
    expect(provider.nome).not.toContain("governor");
    expect(usatoIlCopione).toBe(false); // il copione si usa solo se invocato
  });

  it("quando il reale nascerebbe, nasce GOVERNATO (mai nudo)", () => {
    // Si prova la composizione: il wrapper porta sempre il suffisso.
    const governato = avvolgiConGovernor(
      creaProviderFinto(() => ({
        tipo: "messaggio" as const,
        testo: "x",
        uso: { ...usoNullo, input: 1, output: 1 },
      })),
      { sedeId: 1, utenteId: 7 },
      { configurazione: config(), ledger }
    );
    expect(governato.nome).toContain("+governor");
  });
});


describe("governor — classi di costo (T9)", () => {
  const identita = (runId: string) => ({ runId, passo: 0, tentativo: 1 });

  it("una classe di background SENZA variabile non ha tetto (gate §8)", async () => {
    const governato = avvolgiConGovernor(
      providerConUso(USO_PESANTE),
      { sedeId: 1, utenteId: 1 },
      { configurazione: config(), classe: "proactive_commessa", ledger }
    );
    const esito = await governato.rispondi(
      richiesta(identita("run-classe-libera"))
    );
    expect(esito.tipo).toBe("messaggio");
    expect(ledger.righe()).toHaveLength(1);
    expect(ledger.righe()[0].classe).toBe("proactive_commessa");
  });

  it("uno 0 ESPLICITO resta il kill switch della classe: bloccata PRIMA del ledger; interactive non è toccata", async () => {
    process.env.TARS_BUDGET_PROACTIVE_COMMESSA_USD = "0";
    const governato = avvolgiConGovernor(
      providerConUso(USO_PESANTE),
      { sedeId: 1, utenteId: 1 },
      { configurazione: config(), classe: "proactive_commessa", ledger }
    );
    await expect(
      governato.rispondi(richiesta(identita("run-classe-0")))
    ).rejects.toMatchObject({ name: "ErroreBudget", limite: "classe" });
    expect(ledger.righe()).toHaveLength(0);

    const interattivo = avvolgiConGovernor(
      providerConUso(USO_PESANTE),
      { sedeId: 1, utenteId: 1 },
      { configurazione: config(), ledger }
    );
    const esito = await interattivo.rispondi(
      richiesta(identita("run-interactive"))
    );
    expect(esito.tipo).toBe("messaggio");
    expect(ledger.righe()).toHaveLength(1);
    expect(ledger.righe()[0].classe).toBe("interactive");
  });

  it("con un budget di classe valido la spesa si ferma al tetto della classe, non del globale", async () => {
    process.env.TARS_BUDGET_PATTERN_AZIENDA_USD = "0.02";
    const governato = avvolgiConGovernor(
      providerConUso(USO_PESANTE),
      { sedeId: 1, utenteId: 1 },
      { configurazione: config({ giorno: 10 }), classe: "pattern_azienda", ledger }
    );
    const primo = await governato.rispondi(richiesta(identita("run-pa-1")));
    expect(primo.tipo).toBe("messaggio");
    expect(ledger.righe()[0].classe).toBe("pattern_azienda");
    // Il secondo run sfora il tetto di classe (0,02 USD) ben prima del
    // giornaliero globale (10 USD).
    await expect(
      governato.rispondi(richiesta(identita("run-pa-2")))
    ).rejects.toMatchObject({ name: "ErroreBudget", limite: "classe" });
    // La classe interattiva continua a lavorare sullo stesso ledger.
    const interattivo = avvolgiConGovernor(
      providerConUso(USO_PESANTE),
      { sedeId: 1, utenteId: 1 },
      { configurazione: config({ giorno: 10 }), ledger }
    );
    await expect(
      interattivo.rispondi(richiesta(identita("run-int-2")))
    ).resolves.toMatchObject({ tipo: "messaggio" });
  });

  it("una variabile di classe invalida blocca SOLO quella classe e non aggira il totale", async () => {
    process.env.TARS_BUDGET_EVAL_USD = "non-un-numero";
    const evalGovernato = avvolgiConGovernor(
      providerConUso(USO_PESANTE),
      { sedeId: 1, utenteId: 1 },
      { configurazione: config(), classe: "eval", ledger }
    );
    await expect(
      evalGovernato.rispondi(richiesta(identita("run-eval")))
    ).rejects.toMatchObject({ name: "ErroreBudget", limite: "classe" });
    expect(ledger.righe()).toHaveLength(0);

    // Il globale resta l'hard ceiling per la classe interattiva.
    const interattivo = avvolgiConGovernor(
      providerConUso(USO_PESANTE),
      { sedeId: 1, utenteId: 1 },
      { configurazione: config({ run: 0.001, giorno: 2, mese: 20 }), ledger }
    );
    await expect(
      interattivo.rispondi(richiesta(identita("run-tetto")))
    ).rejects.toMatchObject({ name: "ErroreBudget", limite: "run" });
  });

  it("il messaggio per il limite di classe è dedicato e onesto", () => {
    expect(messaggioPerLimite("classe")).toContain("budget dedicato");
    expect(messaggioPerLimite("classe")).not.toBe(MESSAGGIO_BUDGET);
  });
});
