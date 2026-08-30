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
import { PROMPT_SISTEMA, PROMPT_VERSIONE } from "./prompt/v2";
import {
  ErroreProvider,
  type MessaggioTars,
  type TarsProvider,
  type UsoToken,
} from "./provider";
import type { ContestoRun, EsitoAzione, EvidenzaTars } from "./strumenti/tipi";

/** Proiezione di un'azione eseguita nel run, per risposta/archivio/UI. */
export type AzioneRun = {
  strumento: string;
  stato: string;
  motivo: string | null;
  entitaToccate: string[];
  undoDisponibile: boolean;
  undoVia: EsitoAzione["undoVia"];
  assunzioni: string[];
  descrizione: string;
};

export type ConfigurazioneRun = {
  modello: string;
  maxPassiStrumenti: number;
  maxOutputToken: number;
  timeoutProviderMs: number;
  cronologiaMassima: number;
};

export function configurazioneRunDefault(): ConfigurazioneRun {
  return {
    modello: process.env.TARS_MODEL_INTERACTIVE?.trim() || "fake-interattivo",
    maxPassiStrumenti: Number(process.env.TARS_MAX_TOOL_STEPS ?? 6),
    maxOutputToken: Number(process.env.TARS_MAX_OUTPUT_TOKENS ?? 1200),
    timeoutProviderMs: Number(process.env.TARS_PROVIDER_TIMEOUT_MS ?? 45_000),
    cronologiaMassima: 24,
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

// ── C0: stessa domanda, stesso perimetro, contesto non cambiato ─────────
// V1 onesta: dedupe a TTL breve per (principal, sede, capFingerprint,
// domanda normalizzata, versioni prompt/profilo). Il fingerprint sulle
// versioni di entità arriva con i fascicoli (T3): il TTL corto evita di
// servire risposte su dati cambiati nel frattempo.
const C0_TTL_MS = Number(process.env.TARS_C0_TTL_MS ?? 90_000);
const C0_MAX_VOCI = 200;
const cacheC0 = new Map<string, { risposta: RispostaRun; scade: number }>();

function chiaveC0(contesto: ContestoRun, domanda: string): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        u: contesto.utenteId,
        s: contesto.sedeId,
        caps: contesto.capabilityFingerprint,
        d: domanda.trim().toLowerCase().replace(/\s+/g, " "),
        pv: PROMPT_VERSIONE,
        tv: PROFILO_VERSIONE,
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

  // C0: risposta già data per la stessa domanda nello stesso perimetro.
  const c0 = cacheC0.get(chiaveC0(contesto, input.messaggio));
  if (c0 && c0.scade > Date.now()) {
    const riuso: RispostaRun = {
      ...c0.risposta,
      runId,
      conversazioneId,
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

  // Cronologia della conversazione per il provider (limitata).
  const precedenti = await turniDiConversazione(
    conversazioneId,
    contesto.sedeId,
    config.cronologiaMassima
  );
  const messaggi: MessaggioTars[] = precedenti.map(t =>
    t.ruolo === "utente"
      ? { ruolo: "user" as const, contenuto: t.contenuto }
      : { ruolo: "assistant" as const, contenuto: t.contenuto }
  );

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

  let risposta: Awaited<ReturnType<TarsProvider["rispondi"]>> | null = null;
  for (let passo = 0; passo <= config.maxPassiStrumenti; passo++) {
    try {
      risposta = await input.provider.rispondi({
        modello: config.modello,
        istruzioni: PROMPT_SISTEMA,
        input: messaggi,
        strumenti: perProvider,
        maxOutputToken: config.maxOutputToken,
        chiaveCachePrompt: chiaveCachePrompt(contesto, config.modello),
        timeoutMs: config.timeoutProviderMs,
      });
      circuito.erroriConsecutivi = 0;
    } catch (errore) {
      const transitorio =
        errore instanceof ErroreProvider && errore.transitorio;
      if (transitorio && passo === 0) {
        // Un solo retry, solo sul primo passo e solo per errori transitori.
        try {
          risposta = await input.provider.rispondi({
            modello: config.modello,
            istruzioni: PROMPT_SISTEMA,
            input: messaggi,
            strumenti: perProvider,
            maxOutputToken: config.maxOutputToken,
            chiaveCachePrompt: chiaveCachePrompt(contesto, config.modello),
            timeoutMs: config.timeoutProviderMs,
          });
          circuito.erroriConsecutivi = 0;
        } catch (secondo) {
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
            if ((esito as EsitoAzione)?.tipo === "azione") {
              const azione = esito as EsitoAzione;
              azioni.push({
                strumento: azione.strumento,
                stato: azione.stato,
                motivo: azione.motivo,
                entitaToccate: azione.entitaToccate,
                undoDisponibile: azione.undoDisponibile,
                undoVia: azione.undoVia,
                assunzioni: azione.assunzioni,
                descrizione:
                  azione.evidenze[0]?.descrizione ?? azione.strumento,
              });
            }
            esitoTesto = JSON.stringify(esito);
          } catch (errore) {
            esitoTesto = `ERRORE: ${sanifica(errore)}`;
          }
          cacheC1.set(chiaveC1, esitoTesto);
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
    cacheC0.set(chiaveC0(contesto, input.messaggio), {
      risposta: finale,
      scade: Date.now() + C0_TTL_MS,
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
    },
    errore: null,
  });
  return finale;
}
