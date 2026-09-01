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
  type ClasseCosto,
  type LedgerCosti,
  type LimitiNano,
} from "./ledger";
import { costoNano, tariffaDi, usdInNano, type TariffaModello } from "./tariffe";

export const MESSAGGIO_BUDGET =
  "Tars ha raggiunto temporaneamente il limite di utilizzo configurato. Nessuna operazione è stata eseguita.";

/**
 * Il tetto PER RUN non è «l'installazione è a secco»: è questa
 * richiesta che è diventata troppo grande. Dirlo com'è, altrimenti
 * l'utente pensa che Tars sia fermo per tutti (revisione).
 */
export const MESSAGGIO_BUDGET_RUN =
  "Questa richiesta è diventata troppo grande per essere completata entro il limite previsto. Nessuna operazione è stata eseguita: prova a chiedermi una cosa alla volta.";

export const MESSAGGIO_BUDGET_CLASSE =
  "Questa funzione di Tars ha esaurito il proprio budget dedicato (le altre funzioni non sono toccate). Nessuna operazione è stata eseguita.";

export function messaggioPerLimite(
  limite: "run" | "giorno" | "mese" | "classe"
): string {
  if (limite === "run") return MESSAGGIO_BUDGET_RUN;
  if (limite === "classe") return MESSAGGIO_BUDGET_CLASSE;
  return MESSAGGIO_BUDGET;
}

/** Errore del governor: l'orchestratore lo degrada come gli altri. */
export class ErroreBudget extends ErroreProvider {
  constructor(
    public readonly limite: "run" | "giorno" | "mese" | "classe",
    public readonly consumoNano: number
  ) {
    super(MESSAGGIO_BUDGET, "configurazione", false);
    this.name = "ErroreBudget";
  }
}

/**
 * Budget giornaliero della CLASSE di costo (T9): partizione del budget
 * globale, mai un ampliamento. `interactive` non ha un tetto separato
 * (vale il globale). Dal 01/09/2026 (gate §8) una variabile ASSENTE
 * significa nessun tetto per la classe; uno 0 ESPLICITO resta il kill
 * switch della classe; una variabile invalida BLOCCA la sola classe
 * interessata.
 */
export function limiteClasseGiornalieroNano(
  classe: ClasseCosto
):
  | { ok: true; limiteNano: number | null }
  | { ok: false; motivo: string } {
  if (classe === "interactive") return { ok: true, limiteNano: null };
  const variabile = `TARS_BUDGET_${classe.toUpperCase()}_USD`;
  const grezzo = process.env[variabile]?.trim();
  if (grezzo == null || grezzo === "") return { ok: true, limiteNano: null };
  const numero = Number(grezzo);
  if (!Number.isFinite(numero) || numero < 0) {
    return { ok: false, motivo: `${variabile} non è un importo valido in USD.` };
  }
  const nano = usdInNano(numero);
  if (nano == null) {
    return { ok: false, motivo: `${variabile} non è convertibile.` };
  }
  return { ok: true, limiteNano: nano };
}

export type ConfigurazioneBudget = {
  limiti: LimitiNano;
  perRunUsd: number | null;
  giornalieroUsd: number | null;
  mensileUsd: number | null;
  /** Margine prudenziale sulla stima dell'input. */
  margineStima: number;
  scadenzaPrenotazioneMs: number;
};

/**
 * Legge i limiti dall'ambiente. Dal 01/09/2026 (gate §8, «un cervello
 * operativo non ha bisogno di budget») una variabile ASSENTE significa
 * nessun tetto; un valore presente ma non valido (non numerico, ≤ 0) o
 * una gerarchia incoerente FRA I TETTI IMPOSTATI rende il provider
 * reale INDISPONIBILE: mai un default silenzioso al posto di una
 * configurazione sbagliata. La contabilità sul ledger resta identica
 * con o senza tetti.
 */
export function configurazioneBudget():
  | { ok: true; configurazione: ConfigurazioneBudget }
  | { ok: false; motivo: string } {
  const leggi = (
    variabile: string
  ): { valore: number | null } | { errore: string } => {
    const grezzo = process.env[variabile]?.trim();
    if (grezzo == null || grezzo === "") return { valore: null };
    const numero = Number(grezzo);
    if (!Number.isFinite(numero) || numero <= 0) {
      return { errore: `${variabile} non è un importo valido in USD.` };
    }
    return { valore: numero };
  };

  const perRun = leggi("TARS_MAX_COST_PER_RUN_USD");
  if ("errore" in perRun) return { ok: false, motivo: perRun.errore };
  const giorno = leggi("TARS_DAILY_BUDGET_USD");
  if ("errore" in giorno) return { ok: false, motivo: giorno.errore };
  const mese = leggi("TARS_MONTHLY_BUDGET_USD");
  if ("errore" in mese) return { ok: false, motivo: mese.errore };

  // Distinzione deliberata: `null` = nessun tetto (variabile assente),
  // `undefined` = conversione fallita (fail-closed più sotto).
  const inNano = (usd: number | null): number | null | undefined =>
    usd == null ? null : usdInNano(usd) ?? undefined;
  const runNano = inNano(perRun.valore);
  const giornoNano = inNano(giorno.valore);
  const meseNano = inNano(mese.valore);
  if (runNano === undefined || giornoNano === undefined || meseNano === undefined) {
    return { ok: false, motivo: "Limiti di budget non convertibili." };
  }
  if (
    (runNano != null && giornoNano != null && runNano > giornoNano) ||
    (giornoNano != null && meseNano != null && giornoNano > meseNano) ||
    (runNano != null && meseNano != null && runNano > meseNano)
  ) {
    return {
      ok: false,
      motivo:
        "Limiti incoerenti: deve valere per-run ≤ giornaliero ≤ mensile.",
    };
  }
  // Tetto di sanità: uno zero di troppo (200 invece di 20) non deve
  // passare in silenzio. Vale solo per un mensile IMPOSTATO: l'assenza
  // di tetti è la decisione registrata, non un errore da intercettare.
  const TETTO_SANITA_USD = Number(
    process.env.TARS_TETTO_SANITA_USD?.trim() || 1_000
  );
  if (
    mese.valore != null &&
    Number.isFinite(TETTO_SANITA_USD) &&
    mese.valore > TETTO_SANITA_USD
  ) {
    return {
      ok: false,
      motivo: `Budget mensile ${mese.valore} USD oltre il tetto di sanità (${TETTO_SANITA_USD} USD): confermalo con TARS_TETTO_SANITA_USD.`,
    };
  }

  // Stessa politica dei limiti: una stringa vuota o malformata è un
  // errore di configurazione, non un default silenzioso (revisione).
  const grezzoMargine = process.env.TARS_MARGINE_STIMA?.trim();
  const margine = grezzoMargine ? Number(grezzoMargine) : 1.25;
  const grezzoScadenza = process.env.TARS_SCADENZA_PRENOTAZIONE_MS?.trim();
  const scadenza = grezzoScadenza ? Number(grezzoScadenza) : 600_000;
  if (!Number.isFinite(margine) || margine < 1) {
    return { ok: false, motivo: "TARS_MARGINE_STIMA non valido (minimo 1)." };
  }
  if (!Number.isFinite(scadenza) || scadenza <= 0) {
    return { ok: false, motivo: "TARS_SCADENZA_PRENOTAZIONE_MS non valido." };
  }
  // La scadenza deve superare il timeout della chiamata, altrimenti una
  // prenotazione ancora VIVA verrebbe marcata `expired` da una chiamata
  // concorrente e la riconciliazione (che aggiorna solo le `reserved`)
  // non registrerebbe più il costo reale (revisione).
  // Stesso default dell'orchestratore (`configurazioneRunDefault`): un
  // default più basso qui renderebbe questa validazione più permissiva
  // del timeout realmente in uso.
  const timeoutProvider = Number(process.env.TARS_PROVIDER_TIMEOUT_MS ?? 90_000);
  if (Number.isFinite(timeoutProvider) && scadenza <= timeoutProvider * 2) {
    return {
      ok: false,
      motivo:
        "TARS_SCADENZA_PRENOTAZIONE_MS deve essere almeno il doppio del timeout della chiamata.",
    };
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
 * Rapporto caratteri→token usato per la stima. NON è la media (≈4 per
 * l'italiano discorsivo): è il caso PEGGIORE realistico per il nostro
 * payload, che è in larga parte JSON di schemi e dati strutturati, dove
 * la tokenizzazione è molto più fitta (~2,5 caratteri per token). Una
 * stima ottimistica renderebbe il tetto valicabile dal costo reale — il
 * tetto deve essere un soffitto, quindi si sovrastima per contratto.
 */
const CARATTERI_PER_TOKEN_PESSIMISTICO = 2.5;

export function tokenInputStimati(
  richiesta: RichiestaProvider,
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
  return Math.ceil((caratteri / CARATTERI_PER_TOKEN_PESSIMISTICO) * margine);
}

/**
 * Stima PRUDENZIALE del costo massimo di una chiamata: input dai
 * caratteri del payload col rapporto pessimistico e il margine, più
 * l'intero `max_output_tokens` — che per contratto Responses include
 * anche i reasoning token.
 *
 * L'ingresso è tariffato alla tariffa PIÙ CARA possibile, cioè quella
 * di scrittura in cache (1,25× l'input pieno). Non è pessimismo
 * gratuito: prima della chiamata non sappiamo quanta parte del prompt
 * sarà letta dalla cache, scritta in cache o pagata piena, e una stima
 * che assumesse il prezzo pieno sarebbe sotto il costo reale ogni volta
 * che il prefisso cambia — cioè proprio quando il prompt è nuovo. Una
 * stima che non è un soffitto non è una protezione.
 */
export function stimaCostoNano(
  richiesta: RichiestaProvider,
  tariffa: TariffaModello,
  margine: number
): number {
  const token = tokenInputStimati(richiesta, margine);
  return Number(
    costoNano(tariffa, {
      input: token,
      cachedInput: 0,
      cacheWrite: token,
      output: richiesta.maxOutputToken,
    })
  );
}

export type ContestoCosto = {
  sedeId: number;
  utenteId: number;
};

/**
 * Un uso è plausibile solo se i numeri sono finiti, non negativi, e
 * almeno uno è positivo: una chiamata riuscita che dichiara zero token
 * ovunque significa che non abbiamo letto il consumo, non che è stato
 * gratuito.
 */
export function usoPlausibile(uso: {
  input: number;
  output: number;
  cachedInput: number;
  cacheWrite?: number;
}): boolean {
  const scritti = uso.cacheWrite ?? 0;
  const valori = [uso.input, uso.output, uso.cachedInput, scritti];
  if (valori.some(v => !Number.isFinite(v) || v < 0)) return false;
  // cached e cache write sono entrambi sottoinsiemi dell'input, e
  // disgiunti fra loro: un token o è letto dalla cache o ci viene
  // scritto. Se la somma sfonda l'input, il contratto è cambiato e
  // tariffare quei numeri produrrebbe un costo inventato.
  if (uso.cachedInput + scritti > uso.input) return false;
  return uso.input > 0 || uso.output > 0;
}

/**
 * Avvolge un provider a pagamento col governor. Il provider
 * sottostante viene invocato SOLO dopo una prenotazione riuscita.
 */
export function avvolgiConGovernor(
  sottostante: TarsProvider,
  contesto: ContestoCosto,
  opzioni: {
    configurazione: ConfigurazioneBudget;
    classe?: ClasseCosto;
    ledger?: LedgerCosti;
    adesso?: () => Date;
  }
): TarsProvider {
  const ledger = opzioni.ledger ?? ledgerCorrente();
  const orologio = opzioni.adesso ?? (() => new Date());
  const classe: ClasseCosto = opzioni.classe ?? "interactive";

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

      const limiteClasse = limiteClasseGiornalieroNano(classe);
      if (!limiteClasse.ok) {
        // Configurazione invalida: blocca SOLO questa classe.
        throw new ErroreBudget("classe", 0);
      }
      if (limiteClasse.limiteNano === 0) {
        // Classe senza budget: nessuna chiamata, nessuna scrittura.
        throw new ErroreBudget("classe", 0);
      }

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
        classe,
        limiteClasseNano: limiteClasse.limiteNano,
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
              : prenotazione.limite === "classe"
                ? prenotazione.consumo.classeGiornoNano ?? 0
                : prenotazione.consumo.meseNano
        );
      }
      if (prenotazione.esito === "gia_presente") {
        // Stessa chiamata già vista: non si riesegue e non si
        // contabilizza due volte (idempotenza del retry/doppio invio).
        // Vale ANCHE per una riga ancora `reserved`: era l'unico ramo
        // che avrebbe chiamato il provider senza verificare i tetti
        // (revisione).
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

      // FAIL-CLOSED sull'uso: se il provider non riporta consumi
      // plausibili (campo assente, mappatura cambiata, numeri non
      // finiti) NON si riconcilia a zero — sarebbe l'unico punto
      // fail-OPEN del sistema: la prenotazione verrebbe liberata per una
      // chiamata che il provider ha comunque fatturato. Si chiude come
      // `uncertain`, che resta CONTATO al valore prenotato.
      if (!usoPlausibile(risposta.uso)) {
        await ledger
          .chiudi({
            chiamataId,
            stato: "uncertain",
            motivo: "uso non riportato dal provider",
          })
          .catch(() => undefined);
        return risposta;
      }

      const reale = Number(
        costoNano(tariffa, {
          input: risposta.uso.input,
          cachedInput: risposta.uso.cachedInput,
          cacheWrite: risposta.uso.cacheWrite,
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
