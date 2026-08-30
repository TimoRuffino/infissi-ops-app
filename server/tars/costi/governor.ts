// Budget governor (cost hardening) — spec §27, decisioni 41-47.
//
// È il DECORATORE attraverso cui passa OGNI chiamata a un provider a
// pagamento: prenota prima, riconcilia dopo, rifiuta quando un tetto
// non regge. Nessun router, strumento, retry o profilo può chiamare il
// provider aggirandolo (guardia strutturale in costi/confine.test.ts).
//
// Fail-closed ovunque: configurazione mancante/invalida/negativa,
// tariffa sconosciuta o ledger non autorevole ⇒ il provider reale non
// nasce e nessuna chiamata parte.

import {
  ErroreProvider,
  type RichiestaProvider,
  type RispostaProvider,
  type TarsProvider,
} from "../provider";
import {
  ledgerCorrente,
  type LedgerCosti,
  type LimitiNano,
} from "./ledger";
import { costoNano, tariffaDi, usdInNano, type TariffaModello } from "./tariffe";

export const MESSAGGIO_BUDGET =
  "Tars ha raggiunto temporaneamente il limite di utilizzo configurato. Nessuna operazione è stata eseguita.";

/** Errore del governor: l'orchestratore lo degrada come gli altri. */
export class ErroreBudget extends ErroreProvider {
  constructor(
    public readonly limite: "run" | "giorno" | "mese",
    public readonly consumoNano: number
  ) {
    super(MESSAGGIO_BUDGET, "configurazione", false);
    this.name = "ErroreBudget";
  }
}

export type ConfigurazioneBudget = {
  limiti: LimitiNano;
  perRunUsd: number;
  giornalieroUsd: number;
  mensileUsd: number;
  /** Margine prudenziale sulla stima dell'input. */
  margineStima: number;
  scadenzaPrenotazioneMs: number;
};

export const BUDGET_DEFAULT_USD = {
  perRun: 0.1,
  giornaliero: 2,
  mensile: 20,
} as const;

/**
 * Legge i limiti dall'ambiente. Un valore presente ma non valido
 * (non numerico, ≤ 0) o una gerarchia incoerente (run > giorno > mese)
 * rende il provider reale INDISPONIBILE: mai un default silenzioso al
 * posto di una configurazione sbagliata.
 */
export function configurazioneBudget():
  | { ok: true; configurazione: ConfigurazioneBudget }
  | { ok: false; motivo: string } {
  const leggi = (
    variabile: string,
    predefinito: number
  ): { valore: number } | { errore: string } => {
    const grezzo = process.env[variabile]?.trim();
    if (grezzo == null || grezzo === "") return { valore: predefinito };
    const numero = Number(grezzo);
    if (!Number.isFinite(numero) || numero <= 0) {
      return { errore: `${variabile} non è un importo valido in USD.` };
    }
    return { valore: numero };
  };

  const perRun = leggi("TARS_MAX_COST_PER_RUN_USD", BUDGET_DEFAULT_USD.perRun);
  if ("errore" in perRun) return { ok: false, motivo: perRun.errore };
  const giorno = leggi("TARS_DAILY_BUDGET_USD", BUDGET_DEFAULT_USD.giornaliero);
  if ("errore" in giorno) return { ok: false, motivo: giorno.errore };
  const mese = leggi("TARS_MONTHLY_BUDGET_USD", BUDGET_DEFAULT_USD.mensile);
  if ("errore" in mese) return { ok: false, motivo: mese.errore };

  const runNano = usdInNano(perRun.valore);
  const giornoNano = usdInNano(giorno.valore);
  const meseNano = usdInNano(mese.valore);
  if (runNano == null || giornoNano == null || meseNano == null) {
    return { ok: false, motivo: "Limiti di budget non convertibili." };
  }
  if (runNano > giornoNano || giornoNano > meseNano) {
    return {
      ok: false,
      motivo:
        "Limiti incoerenti: deve valere per-run ≤ giornaliero ≤ mensile.",
    };
  }

  const margine = Number(process.env.TARS_MARGINE_STIMA ?? 1.25);
  const scadenza = Number(
    process.env.TARS_SCADENZA_PRENOTAZIONE_MS ?? 600_000
  );
  if (!Number.isFinite(margine) || margine < 1) {
    return { ok: false, motivo: "TARS_MARGINE_STIMA non valido (minimo 1)." };
  }
  if (!Number.isFinite(scadenza) || scadenza <= 0) {
    return { ok: false, motivo: "TARS_SCADENZA_PRENOTAZIONE_MS non valido." };
  }

  return {
    ok: true,
    configurazione: {
      limiti: { runNano, giornoNano, meseNano },
      perRunUsd: perRun.valore,
      giornalieroUsd: giorno.valore,
      mensileUsd: mese.valore,
      margineStima: margine,
      scadenzaPrenotazioneMs: scadenza,
    },
  };
}

/**
 * Stima PRUDENZIALE del costo massimo di una chiamata: input dai
 * caratteri del payload (≈4 caratteri per token) col margine, tariffato
 * SEMPRE a prezzo pieno (lo sconto cache si scopre solo dopo), più
 * l'intero `max_output_tokens` — che per contratto Responses include
 * anche i reasoning token.
 */
export function stimaCostoNano(
  richiesta: RichiestaProvider,
  tariffa: TariffaModello,
  margine: number
): number {
  const caratteri =
    richiesta.istruzioni.length +
    richiesta.input.reduce((somma, m) => somma + m.contenuto.length, 0) +
    richiesta.strumenti.reduce(
      (somma, s) =>
        somma +
        s.nome.length +
        s.descrizione.length +
        JSON.stringify(s.parametri).length,
      0
    );
  const tokenInput = Math.ceil((caratteri / 4) * margine);
  return Number(
    costoNano(tariffa, {
      input: tokenInput,
      cachedInput: 0,
      output: richiesta.maxOutputToken,
    })
  );
}

export type ContestoCosto = {
  sedeId: number;
  utenteId: number;
};

/**
 * Avvolge un provider a pagamento col governor. Il provider
 * sottostante viene invocato SOLO dopo una prenotazione riuscita.
 */
export function avvolgiConGovernor(
  sottostante: TarsProvider,
  contesto: ContestoCosto,
  opzioni: {
    configurazione: ConfigurazioneBudget;
    ledger?: LedgerCosti;
    adesso?: () => Date;
  }
): TarsProvider {
  const ledger = opzioni.ledger ?? ledgerCorrente();
  const orologio = opzioni.adesso ?? (() => new Date());

  return {
    nome: `${sottostante.nome}+governor`,
    async rispondi(richiesta: RichiestaProvider): Promise<RispostaProvider> {
      const tariffa = tariffaDi(richiesta.modello);
      if (!tariffa) {
        // Modello senza tariffa nota: nessuna chiamata, mai.
        throw new ErroreProvider(
          `Modello «${richiesta.modello}» senza tariffa attiva nel catalogo: chiamata non autorizzata.`,
          "configurazione",
          false
        );
      }

      const identita = richiesta.identita;
      if (!identita) {
        throw new ErroreProvider(
          "Chiamata senza identità di run: impossibile contabilizzarla.",
          "configurazione",
          false
        );
      }
      const chiamataId = `${identita.runId}:${identita.passo}:${identita.tentativo}`;
      const adesso = orologio();

      // Le prenotazioni appese (crash/riavvio) si chiudono come
      // `expired` MANTENENDO il costo contato.
      await ledger
        .scadiPrenotazioniVecchie(
          opzioni.configurazione.scadenzaPrenotazioneMs,
          adesso
        )
        .catch(() => 0);

      const stima = stimaCostoNano(
        richiesta,
        tariffa,
        opzioni.configurazione.margineStima
      );
      const prenotazione = await ledger.prenota({
        chiamataId,
        runId: identita.runId,
        sedeId: contesto.sedeId,
        utenteId: contesto.utenteId,
        conversazioneId: identita.conversazioneId ?? null,
        modello: richiesta.modello,
        costoPrenotatoNano: stima,
        limiti: opzioni.configurazione.limiti,
        adesso,
      });

      if (prenotazione.esito === "rifiutata") {
        throw new ErroreBudget(
          prenotazione.limite,
          prenotazione.limite === "run"
            ? prenotazione.consumo.runNano
            : prenotazione.limite === "giorno"
              ? prenotazione.consumo.giornoNano
              : prenotazione.consumo.meseNano
        );
      }
      if (
        prenotazione.esito === "gia_presente" &&
        prenotazione.riga.stato !== "reserved"
      ) {
        // Stessa chiamata già conclusa: non si riesegue e non si
        // contabilizza due volte (idempotenza del retry/doppio invio).
        throw new ErroreProvider(
          "Chiamata già contabilizzata: non viene ripetuta.",
          "configurazione",
          false
        );
      }

      let risposta: RispostaProvider;
      try {
        risposta = await sottostante.rispondi(richiesta);
      } catch (errore) {
        const categoria =
          errore instanceof ErroreProvider ? errore.categoria : "rete";
        // Conservativo: 4xx e 429 non generano token → si rilascia;
        // timeout/rete/risposta invalida possono averli generati →
        // la prenotazione resta CONTATA come `uncertain`.
        const senzaConsumo =
          categoria === "configurazione" || categoria === "rate_limit";
        await ledger
          .chiudi({
            chiamataId,
            stato: senzaConsumo ? "released" : "uncertain",
            motivo: categoria,
          })
          .catch(() => undefined);
        throw errore;
      }

      const reale = Number(
        costoNano(tariffa, {
          input: risposta.uso.input,
          cachedInput: risposta.uso.cachedInput,
          output: risposta.uso.output,
        })
      );
      await ledger
        .riconcilia({
          chiamataId,
          costoRealeNano: reale,
          tokenInput: risposta.uso.input,
          tokenCached: risposta.uso.cachedInput,
          tokenOutput: risposta.uso.output,
        })
        .catch(() => undefined);

      return risposta;
    },
  };
}
