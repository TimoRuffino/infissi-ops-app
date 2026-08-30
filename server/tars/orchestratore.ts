// Orchestratore di Tars (T1) — docs/tars/architettura-tars-v2.md §9.
//
// Un run: contesto autorizzato → (C0) → loop modello↔strumenti con budget
// e C1 → risposta con evidenze → archivio + telemetria. Il provider è
// INIETTATO (fake nei test; quello reale nasce solo dietro FLAG_TARS con
// chiave presente). Ogni errore degrada in una risposta onesta, mai in un
// 500 grezzo; con il circuito aperto non si chiama proprio il modello.

import { createHash } from "node:crypto";
import {
  aggiungiTurno,
  creaConversazione,
  conversazioneDiUtente,
  registraRun,
  turniDiConversazione,
} from "./archivio";
import { comeDefinizioneProvider, PROFILO_VERSIONE, strumentiPerContesto } from "./profili";
import { tarsAttivo } from "../platform/interruttori";
import { ErroreBudget, messaggioPerLimite } from "./costi/governor";
import { contestoMemorie, fingerprintMemorie } from "./memoria";
import { PROMPT_SISTEMA, PROMPT_VERSIONE } from "./prompt/v4";
import {
  ErroreProvider,
  type MessaggioTars,
  type TarsProvider,
  type UsoToken,
} from "./provider";
import type { ContestoRun, EsitoAzione, EvidenzaTars } from "./strumenti/tipi";
import { versioniAncoraValide } from "./versioni";

/** Proiezione di un'azione eseguita nel run, per risposta/archivio/UI. */
export type AzioneRun = {
  strumento: string;
  stato: string;
  motivo: string | null;
  entitaToccate: string[];
  undoDisponibile: boolean;
  undoVia: EsitoAzione["undoVia"];
  /** L3: l'UNICA conferma umana da mostrare come bottone nella UI. */
  conferma: EsitoAzione["conferma"] | null;
  assunzioni: string[];
  descrizione: string;
};

export type ConfigurazioneRun = {
  modello: string;
  maxPassiStrumenti: number;
  maxOutputToken: number;
  timeoutProviderMs: number;
  cronologiaMassima: number;
  /** Tetto duro di chiamate al modello per run (spec §27.47). */
  maxChiamateModello: number;
  /** Tetto sul tempo totale del run, retry compresi. */
  maxRunMs: number;
  /** Tetto sui caratteri di contesto inviati al modello. */
  maxCaratteriContesto: number;
};

/**
 * Legge un limite numerico dall'ambiente FAIL-CLOSED: un valore
 * malformato torna al default, non a `NaN`. Con `NaN` un confronto come
 * `chiamate >= NaN` è sempre falso e il tetto sparirebbe in silenzio
 * (revisione: era l'opposto della politica applicata al budget).
 */
function limiteDaEnv(variabile: string, predefinito: number): number {
  const grezzo = process.env[variabile]?.trim();
  if (!grezzo) return predefinito;
  const numero = Number(grezzo);
  if (!Number.isFinite(numero) || numero <= 0) {
    console.warn(
      `[tars] ${variabile} non valido («${grezzo}»): uso il valore predefinito ${predefinito}.`
    );
    return predefinito;
  }
  return numero;
}

/**
 * Limiti motivati (spec §27.47): abbastanza larghi da non rendere Tars
 * ottuso, abbastanza stretti da rendere impossibile un loop costoso.
 * 8 chiamate = 6 passi di strumenti + risposta finale + un retry.
 * 60k caratteri ≈ 24k token: scelto perché una chiamata al MASSIMO del
 * contesto resti sotto il tetto per-run da 0,10 USD (≈0,075 USD stimati)
 * — un limite più largo sarebbe irraggiungibile, perché il budget
 * morderebbe prima (revisione). Da raffinare dopo gli eval reali.
 */
export function configurazioneRunDefault(): ConfigurazioneRun {
  return {
    modello: process.env.TARS_MODEL_INTERACTIVE?.trim() || "fake-interattivo",
    maxPassiStrumenti: limiteDaEnv("TARS_MAX_TOOL_STEPS", 6),
    maxOutputToken: limiteDaEnv("TARS_MAX_OUTPUT_TOKENS", 1200),
    timeoutProviderMs: limiteDaEnv("TARS_PROVIDER_TIMEOUT_MS", 45_000),
    cronologiaMassima: 24,
    maxChiamateModello: limiteDaEnv("TARS_MAX_MODEL_CALLS", 8),
    maxRunMs: limiteDaEnv("TARS_MAX_RUN_MS", 180_000),
    maxCaratteriContesto: limiteDaEnv("TARS_MAX_CONTEXT_CHARS", 60_000),
  };
}

export type RispostaRun = {
  runId: string;
  conversazioneId: number;
  stato: "ok" | "degradato";
  testo: string;
  evidenze: EvidenzaTars[];
  strumentiUsati: string[];
  azioni: AzioneRun[];
  omissioni: string[];
  uso: UsoToken;
  cache: { c0Hit: boolean; c1Hit: number; c1Miss: number };
  versioni: { prompt: string; profilo: string; modello: string };
};

// ── C0 v2: stessa domanda, stesso perimetro, ENTITÀ NON CAMBIATE ───────
// Dedupe a TTL breve per (principal, sede, capFingerprint, domanda
// normalizzata, versioni prompt/profilo) + verifica delle versioni di
// entità osservate nel run (decisione 19): il riuso richiede TTL valido
// E versioni correnti identiche; un riferimento non sondabile nega il
// riuso (fail-closed sulla freschezza).
const C0_TTL_MS = Number(process.env.TARS_C0_TTL_MS ?? 90_000);
const C0_MAX_VOCI = 200;
const cacheC0 = new Map<
  string,
  { risposta: RispostaRun; scade: number; versioni: Record<string, string> }
>();

function chiaveC0(
  contesto: ContestoRun,
  domanda: string,
  improntaStoria: string
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        u: contesto.utenteId,
        s: contesto.sedeId,
        caps: contesto.capabilityFingerprint,
        d: domanda.trim().toLowerCase().replace(/\s+/g, " "),
        pv: PROMPT_VERSIONE,
        tv: PROFILO_VERSIONE,
        // Revisione: la stessa frase in conversazioni con cronologie
        // diverse NON è la stessa domanda («e il gate è soddisfatto?»
        // risolve il referente dalla cronologia). Due conversazioni
        // fresche condividono l'impronta vuota: il riuso buono resta.
        st: improntaStoria,
        // T7 (decisione 35): una memoria nuova/invalidata nega il riuso.
        mem: tarsAttivo("tarsMemory")
          ? fingerprintMemorie(contesto.sedeId, contesto.utenteId)
          : "off",
      })
    )
    .digest("hex");
}

/** Solo per i test. */
export function azzeraCacheTarsPerTest(): void {
  cacheC0.clear();
  circuito.aperturaFino = 0;
  circuito.erroriConsecutivi = 0;
}

/**
 * Limite INTERNO del run (chiamate, tempo, contesto): non è un guasto
 * del provider — non deve aprire il circuito globale né far dire
 * all'utente che «il modello non è disponibile» (revisione).
 */
export class ErroreLimiteRun extends Error {
  constructor(
    public readonly limite: "chiamate" | "tempo" | "contesto",
    public readonly messaggioUtente: string
  ) {
    super(`limite_run_${limite}`);
    this.name = "ErroreLimiteRun";
  }
}

// ── Circuit breaker semplice sul provider ───────────────────────────────
const circuito = { erroriConsecutivi: 0, aperturaFino: 0 };
const CIRCUITO_SOGLIA = 3;
const CIRCUITO_PAUSA_MS = 60_000;

function chiaveCachePrompt(contesto: ContestoRun, modello: string): string {
  const ambiente = process.env.NODE_ENV ?? "development";
  return `tars:${ambiente}:${modello}:${PROMPT_VERSIONE}:${PROFILO_VERSIONE}:${contesto.capabilityFingerprint}`;
}

function sanifica(errore: unknown): string {
  if (errore instanceof ErroreProvider) return errore.message;
  const messaggio = String((errore as any)?.message ?? "");
  if (messaggio.startsWith("NOT_FOUND") || messaggio.startsWith("FORBIDDEN")) {
    return messaggio;
  }
  console.error("[tars] errore non previsto:", errore);
  return "Errore interno durante l'esecuzione dello strumento.";
}

export async function eseguiRun(input: {
  contesto: ContestoRun;
  provider: TarsProvider;
  messaggio: string;
  conversazioneId?: number | null;
  configurazione?: Partial<ConfigurazioneRun>;
}): Promise<RispostaRun> {
  const config = { ...configurazioneRunDefault(), ...input.configurazione };
  const { contesto } = input;
  const runId = createHash("sha256")
    .update(`${Date.now()}:${contesto.utenteId}:${Math.random()}`)
    .digest("hex")
    .slice(0, 12);

  // Conversazione: esistente (dell'utente, della sede) o nuova.
  let conversazioneId = input.conversazioneId ?? null;
  if (conversazioneId != null) {
    const trovata = await conversazioneDiUtente(
      conversazioneId,
      contesto.sedeId,
      contesto.utenteId
    );
    if (!trovata) throw new Error("NOT_FOUND: conversazione non trovata.");
  } else {
    const creata = await creaConversazione({
      sedeId: contesto.sedeId,
      utenteId: contesto.utenteId,
      titolo: input.messaggio.slice(0, 60) || "Conversazione",
    });
    conversazioneId = creata.id;
  }

  await aggiungiTurno({
    conversazioneId,
    sedeId: contesto.sedeId,
    ruolo: "utente",
    contenuto: input.messaggio,
  });

  // Cronologia della conversazione (gli ULTIMI n turni): serve anche
  // alla chiave C0, che deve distinguere la stessa frase in contesti
  // conversazionali diversi.
  const precedenti = await turniDiConversazione(
    conversazioneId,
    contesto.sedeId,
    config.cronologiaMassima
  );
  const improntaStoria = createHash("sha256")
    .update(
      precedenti
        .slice(0, -1) // l'ultimo è il messaggio corrente appena salvato
        .map(t => `${t.ruolo}:${t.contenuto}`)
        .join("\u0000")
    )
    .digest("hex")
    .slice(0, 16);
  const chiaveC0Corrente = chiaveC0(contesto, input.messaggio, improntaStoria);

  // C0: risposta già data per la stessa domanda nello stesso perimetro,
  // riusabile SOLO se le entità osservate non sono cambiate.
  const c0 = cacheC0.get(chiaveC0Corrente);
  if (
    c0 &&
    c0.scade > Date.now() &&
    !versioniAncoraValide(c0.versioni, contesto.sedeId)
  ) {
    cacheC0.delete(chiaveC0Corrente);
  }
  if (
    c0 &&
    c0.scade > Date.now() &&
    versioniAncoraValide(c0.versioni, contesto.sedeId)
  ) {
    const riuso: RispostaRun = {
      ...c0.risposta,
      runId,
      conversazioneId,
      // Questo run non ha consumato token: la telemetria non copia
      // l'uso del run originale (revisione).
      uso: { input: 0, output: 0, cachedInput: 0, cacheWrite: 0 },
      cache: { ...c0.risposta.cache, c0Hit: true },
    };
    await aggiungiTurno({
      conversazioneId,
      sedeId: contesto.sedeId,
      ruolo: "tars",
      contenuto: riuso.testo,
      payload: { evidenze: riuso.evidenze, cache: riuso.cache, runId },
    });
    await registraRun({
      sedeId: contesto.sedeId,
      utenteId: contesto.utenteId,
      conversazioneId,
      stato: "ok",
      provider: "cache-c0",
      modello: config.modello,
      versioni: { prompt: PROMPT_VERSIONE, profilo: PROFILO_VERSIONE },
      contatori: { c0Hit: 1, modelCallEvitate: 1 },
      errore: null,
    });
    return riuso;
  }

  const messaggi: MessaggioTars[] = precedenti.map(t =>
    t.ruolo === "utente"
      ? { ruolo: "user" as const, contenuto: t.contenuto }
      : { ruolo: "assistant" as const, contenuto: t.contenuto }
  );

  // T7 (decisione 35): le memorie valide entrano come messaggio di
  // CONTESTO in coda, prima dell'ultimo messaggio utente — mai nel
  // prefisso stabile (C2 intatta). Dati, non istruzioni.
  if (tarsAttivo("tarsMemory")) {
    const memorie = contestoMemorie(contesto.sedeId, contesto.utenteId);
    if (memorie) {
      messaggi.splice(Math.max(messaggi.length - 1, 0), 0, {
        ruolo: "user",
        contenuto: memorie,
      });
    }
  }

  const strumenti = strumentiPerContesto(contesto);
  const perProvider = strumenti.map(comeDefinizioneProvider);
  const strumentiPerNome = new Map(strumenti.map(s => [s.nome, s] as const));

  // C1: dedupe delle tool call nel run.
  const cacheC1 = new Map<string, string>();
  let c1Hit = 0;
  let c1Miss = 0;

  const evidenze: EvidenzaTars[] = [];
  const omissioni = new Set<string>();
  const strumentiUsati: string[] = [];
  const azioni: AzioneRun[] = [];
  const versioniOsservate: Record<string, string> = {};
  const uso: UsoToken = { input: 0, output: 0, cachedInput: 0, cacheWrite: 0 };

  const esitoDegradato = async (
    motivo: string,
    errore: string | null
  ): Promise<RispostaRun> => {
    const risposta: RispostaRun = {
      runId,
      conversazioneId: conversazioneId!,
      stato: "degradato",
      testo: motivo,
      evidenze,
      strumentiUsati,
      azioni,
      omissioni: [...omissioni],
      uso,
      cache: { c0Hit: false, c1Hit, c1Miss },
      versioni: {
        prompt: PROMPT_VERSIONE,
        profilo: PROFILO_VERSIONE,
        modello: config.modello,
      },
    };
    await aggiungiTurno({
      conversazioneId: conversazioneId!,
      sedeId: contesto.sedeId,
      ruolo: "tars",
      contenuto: motivo,
      payload: { degradato: true, azioni, runId },
    });
    await registraRun({
      sedeId: contesto.sedeId,
      utenteId: contesto.utenteId,
      conversazioneId,
      stato: "degradato",
      provider: input.provider.nome,
      modello: config.modello,
      versioni: { prompt: PROMPT_VERSIONE, profilo: PROFILO_VERSIONE },
      contatori: { c1Hit, c1Miss, passi: strumentiUsati.length },
      errore,
    });
    return risposta;
  };

  if (circuito.aperturaFino > Date.now()) {
    return esitoDegradato(
      "In questo momento non riesco a interrogare il modello (protezione attiva dopo errori ripetuti). Il CRM funziona normalmente; riprova tra qualche minuto.",
      "circuito_aperto"
    );
  }

  // Limiti duri del run (spec §27.47): chiamate al modello, tempo
  // totale, dimensione del contesto. Sono tetti di sicurezza, non
  // euristiche: superarli degrada onestamente invece di spendere.
  const iniziatoIl = Date.now();
  let chiamateModello = 0;
  const chiamaProvider = async (passo: number, tentativo: number) => {
    if (chiamateModello >= config.maxChiamateModello) {
      throw new ErroreLimiteRun(
        "chiamate",
        "Ho raggiunto il numero massimo di passaggi previsto per una singola richiesta. Riformula o restringi la domanda."
      );
    }
    if (Date.now() - iniziatoIl > config.maxRunMs) {
      throw new ErroreLimiteRun(
        "tempo",
        "Questa richiesta ha superato il tempo massimo previsto. Riprova con una domanda più circoscritta."
      );
    }
    const caratteri =
      PROMPT_SISTEMA.length +
      messaggi.reduce(
        (somma, m) =>
          somma +
          m.contenuto.length +
          // I turni assistant portano il payload nelle tool call, non
          // nel contenuto: contarlo o il tetto sarebbe cieco (revisione).
          (m.ruolo === "assistant"
            ? (m.chiamate ?? []).reduce(
                (t, c) => t + c.nome.length + c.argomenti.length,
                0
              )
            : 0),
        0
      );
    if (caratteri > config.maxCaratteriContesto) {
      throw new ErroreLimiteRun(
        "contesto",
        "Ho raccolto troppi dati per una singola richiesta. Chiedimi una cosa alla volta."
      );
    }
    chiamateModello += 1;
    return input.provider.rispondi({
      modello: config.modello,
      istruzioni: PROMPT_SISTEMA,
      input: messaggi,
      strumenti: perProvider,
      maxOutputToken: config.maxOutputToken,
      chiaveCachePrompt: chiaveCachePrompt(contesto, config.modello),
      timeoutMs: config.timeoutProviderMs,
      identita: {
        runId,
        passo,
        tentativo,
        conversazioneId,
      },
    });
  };

  let risposta: Awaited<ReturnType<TarsProvider["rispondi"]>> | null = null;
  for (let passo = 0; passo <= config.maxPassiStrumenti; passo++) {
    try {
      risposta = await chiamaProvider(passo, 1);
      circuito.erroriConsecutivi = 0;
    } catch (errore) {
      // Budget esaurito e limiti interni del run NON sono guasti del
      // provider: nessun retry, nessun circuito aperto, messaggio
      // dedicato e veritiero all'utente.
      if (errore instanceof ErroreBudget) {
        return esitoDegradato(
          messaggioPerLimite(errore.limite),
          `budget_${errore.limite}`
        );
      }
      if (errore instanceof ErroreLimiteRun) {
        return esitoDegradato(errore.messaggioUtente, errore.message);
      }
      const transitorio =
        errore instanceof ErroreProvider && errore.transitorio;
      if (transitorio && passo === 0) {
        // Un solo retry, solo sul primo passo e solo per errori transitori.
        try {
          risposta = await chiamaProvider(passo, 2);
          circuito.erroriConsecutivi = 0;
        } catch (secondo) {
          if (secondo instanceof ErroreBudget) {
            return esitoDegradato(
              messaggioPerLimite(secondo.limite),
              `budget_${secondo.limite}`
            );
          }
          if (secondo instanceof ErroreLimiteRun) {
            return esitoDegradato(secondo.messaggioUtente, secondo.message);
          }
          circuito.erroriConsecutivi += 1;
          if (circuito.erroriConsecutivi >= CIRCUITO_SOGLIA) {
            circuito.aperturaFino = Date.now() + CIRCUITO_PAUSA_MS;
          }
          return esitoDegradato(
            "Il modello non è al momento raggiungibile. Il CRM funziona normalmente; i dati restano consultabili dalle pagine.",
            sanifica(secondo)
          );
        }
      } else {
        circuito.erroriConsecutivi += 1;
        if (circuito.erroriConsecutivi >= CIRCUITO_SOGLIA) {
          circuito.aperturaFino = Date.now() + CIRCUITO_PAUSA_MS;
        }
        return esitoDegradato(
          "Il modello non è al momento disponibile. Il CRM funziona normalmente.",
          sanifica(errore)
        );
      }
    }

    uso.input += risposta.uso.input;
    uso.output += risposta.uso.output;
    uso.cachedInput += risposta.uso.cachedInput;
    uso.cacheWrite += risposta.uso.cacheWrite;

    if (risposta.tipo === "messaggio") break;

    // Il turno assistant con le function call precede gli output degli
    // strumenti (contratto Responses; revisione: senza, il provider reale
    // rifiuterebbe i function_call_output orfani).
    messaggi.push({
      ruolo: "assistant",
      contenuto: "",
      chiamate: risposta.chiamate,
    });

    if (passo === config.maxPassiStrumenti) {
      return esitoDegradato(
        "Ho raggiunto il limite di passaggi per questa richiesta senza arrivare a una risposta completa: riformula o restringi la domanda.",
        "budget_strumenti_esaurito"
      );
    }

    for (const chiamata of risposta.chiamate) {
      const strumento = strumentiPerNome.get(chiamata.nome);
      let esitoTesto: string;
      if (!strumento) {
        esitoTesto = `ERRORE: strumento «${chiamata.nome}» non presente nel profilo autorizzato.`;
      } else {
        const chiaveC1 = `${strumento.nome}@${strumento.versione}:${chiamata.argomenti}`;
        const inCache = cacheC1.get(chiaveC1);
        if (inCache != null) {
          c1Hit += 1;
          esitoTesto = inCache;
        } else {
          c1Miss += 1;
          strumentiUsati.push(strumento.nome);
          try {
            const grezzi = JSON.parse(chiamata.argomenti || "{}");
            const validati = strumento.schemaInput.parse(grezzi);
            const esito = await strumento.esegui(contesto, validati);
            if (esito && Array.isArray((esito as any).evidenze)) {
              evidenze.push(...(esito as any).evidenze);
              for (const o of (esito as any).omissioni ?? []) omissioni.add(o);
            }
            Object.assign(
              versioniOsservate,
              (esito as any)?.versioniEntita ?? {}
            );
            if ((esito as EsitoAzione)?.tipo === "azione") {
              const azione = esito as EsitoAzione;
              azioni.push({
                strumento: azione.strumento,
                stato: azione.stato,
                motivo: azione.motivo,
                entitaToccate: azione.entitaToccate,
                undoDisponibile: azione.undoDisponibile,
                undoVia: azione.undoVia,
                conferma: azione.conferma ?? null,
                assunzioni: azione.assunzioni,
                descrizione:
                  azione.evidenze[0]?.descrizione ?? azione.strumento,
              });
            }
            esitoTesto = JSON.stringify(esito);
          } catch (errore) {
            esitoTesto = `ERRORE: ${sanifica(errore)}`;
          }
          // Spec §10 C1: niente errori cachati — un retry identico del
          // modello deve poter rieseguire dopo un errore transitorio.
          if (!esitoTesto.startsWith("ERRORE")) {
            cacheC1.set(chiaveC1, esitoTesto);
          }
        }
      }
      messaggi.push({
        ruolo: "tool",
        toolCallId: chiamata.id,
        nome: chiamata.nome,
        contenuto: esitoTesto,
      });
    }
  }

  if (!risposta || risposta.tipo !== "messaggio") {
    return esitoDegradato(
      "Non sono riuscito a produrre una risposta per questa richiesta.",
      "nessuna_risposta"
    );
  }

  const finale: RispostaRun = {
    runId,
    conversazioneId,
    stato: "ok",
    testo: risposta.testo,
    evidenze,
    strumentiUsati,
    azioni,
    omissioni: [...omissioni],
    uso,
    cache: { c0Hit: false, c1Hit, c1Miss },
    versioni: {
      prompt: PROMPT_VERSIONE,
      profilo: PROFILO_VERSIONE,
      modello: config.modello,
    },
  };

  // Un run con azioni non è una «domanda deterministica»: non entra in C0
  // (spec §20, decisione 14) — la protezione dal doppio invio resta
  // all'idempotenza degli strumenti, che riesegue e risponde il vero.
  if (azioni.length === 0) {
    // Le voci scadute si potano qui (revisione: il solo size-cap le
    // lasciava vivere indefinitamente sotto le 200 voci).
    const adesso = Date.now();
    for (const [chiave, voce] of cacheC0) {
      if (voce.scade <= adesso) cacheC0.delete(chiave);
    }
    cacheC0.set(chiaveC0Corrente, {
      risposta: finale,
      scade: adesso + C0_TTL_MS,
      versioni: versioniOsservate,
    });
    if (cacheC0.size > C0_MAX_VOCI) {
      const prima = cacheC0.keys().next().value;
      if (prima) cacheC0.delete(prima);
    }
  }

  await aggiungiTurno({
    conversazioneId,
    sedeId: contesto.sedeId,
    ruolo: "tars",
    contenuto: finale.testo,
    payload: {
      evidenze: finale.evidenze,
      strumentiUsati,
      azioni,
      omissioni: finale.omissioni,
      uso,
      runId,
    },
  });
  await registraRun({
    sedeId: contesto.sedeId,
    utenteId: contesto.utenteId,
    conversazioneId,
    stato: "ok",
    provider: input.provider.nome,
    modello: config.modello,
    versioni: { prompt: PROMPT_VERSIONE, profilo: PROFILO_VERSIONE },
    contatori: {
      c1Hit,
      c1Miss,
      tokenInput: uso.input,
      tokenOutput: uso.output,
      tokenCached: uso.cachedInput,
      tokenCacheWrite: uso.cacheWrite,
      evidenze: evidenze.length,
      strumenti: strumentiUsati.length,
      azioni: azioni.length,
      chiamateModello,
      durataMs: Date.now() - iniziatoIl,
    },
    errore: null,
  });
  return finale;
}
