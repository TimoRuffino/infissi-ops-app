import {
  ficCosti,
  saveFicCosti,
  type ClassificazioneCosto,
  type CostoFic,
} from "../routers/ficCosti";
import { callOpenAI, openaiConfigured } from "./openai";
import { getTarsConfig } from "./stores";

const CLASSI: ClassificazioneCosto[] = [
  "fisso",
  "variabile_commessa",
  "straordinario",
  "dubbio",
];
const MAX_COSTI_PER_LOTTO = 100;

type RisultatoClassificazione = {
  id: number;
  classificazione: ClassificazioneCosto;
  confidenza: number;
  motivazione: string;
};

function firmaCosto(costo: CostoFic): string {
  return JSON.stringify({
    tipo: costo.tipo,
    data: costo.data,
    fornitore: costo.fornitoreNome,
    categoria: costo.categoriaFic,
    descrizione: costo.descrizione,
    centro: costo.centro,
    importoNetto: costo.importoNetto,
  });
}

function parseRisultati(text: string): RisultatoClassificazione[] {
  const parsed = JSON.parse(text) as { risultati?: unknown };
  if (!Array.isArray(parsed.risultati)) return [];
  return parsed.risultati.flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (
      typeof row.id !== "number" ||
      typeof row.classificazione !== "string" ||
      !CLASSI.includes(row.classificazione as ClassificazioneCosto) ||
      typeof row.confidenza !== "number" ||
      typeof row.motivazione !== "string"
    ) {
      return [];
    }
    return [
      {
        id: row.id,
        classificazione: row.classificazione as ClassificazioneCosto,
        confidenza: Math.max(0, Math.min(1, row.confidenza)),
        motivazione: row.motivazione.trim().slice(0, 240),
      },
    ];
  });
}

export async function classificaCostiFic(
  sedeId: number,
  ids?: number[],
  signal?: AbortSignal
): Promise<{
  classificati: number;
  dubbi: number;
  errore: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}> {
  const richiesti = ids ? new Set(ids) : null;
  const candidati = ficCosti.filter(
    costo =>
      costo.sedeId === sedeId &&
      costo.presenteInFic &&
      (richiesti == null || richiesti.has(costo.id)) &&
      costo.fonteClassificazione !== "utente" &&
      costo.fonteClassificazione !== "regola"
  );
  if (candidati.length === 0) {
    return {
      classificati: 0,
      dubbi: 0,
      errore: null,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
    };
  }
  if (!openaiConfigured()) {
    return {
      classificati: 0,
      dubbi: candidati.length,
      errore: "OPENAI_API_KEY non configurata.",
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
    };
  }

  const firme = new Map(candidati.map(costo => [costo.id, firmaCosto(costo)]));
  const occorrenze = new Map<string, number>();
  for (const costo of ficCosti) {
    if (costo.sedeId !== sedeId || !costo.presenteInFic) continue;
    const key = costo.fornitoreNome.trim().toLowerCase();
    occorrenze.set(key, (occorrenze.get(key) ?? 0) + 1);
  }
  const model = getTarsConfig(sedeId).modelloAutomatico;
  let classificati = 0;
  let dubbi = 0;
  let errore: string | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;

  for (
    let offset = 0;
    offset < candidati.length;
    offset += MAX_COSTI_PER_LOTTO
  ) {
    const lotto = candidati.slice(offset, offset + MAX_COSTI_PER_LOTTO);
    const input = lotto.map(costo => ({
      id: costo.id,
      data: costo.data,
      fornitore: costo.fornitoreNome,
      categoria: costo.categoriaFic,
      descrizione: costo.descrizione,
      centro: costo.centro,
      importoNetto: costo.importoNetto,
      ricorrenzaFornitore:
        occorrenze.get(costo.fornitoreNome.trim().toLowerCase()) ?? 1,
    }));

    try {
      const response = await callOpenAI({
        model,
        instructions: [
          "Classifica costi aziendali italiani provenienti da Fatture in Cloud.",
          "Usa fisso per costi operativi ricorrenti non legati a una commessa.",
          "Usa variabile_commessa per materiali, posa o servizi che crescono con i lavori venduti.",
          "Usa straordinario per investimenti o eventi non ricorrenti.",
          "Usa dubbio se i metadati non bastano. Non inventare collegamenti a commesse.",
          "Restituisci un risultato per ogni id e una motivazione concreta e breve.",
        ].join("\n"),
        input: [{ role: "user", content: JSON.stringify(input) }],
        tools: [],
        maxTokens: 6_000,
        reasoningEffort: "low",
        promptCacheKey: `tars:v1:s${sedeId}:classifica-costi-fic:${model}`,
        signal,
        responseFormat: {
          name: "classificazione_costi_fic",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              risultati: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    id: { type: "number" },
                    classificazione: { type: "string", enum: CLASSI },
                    confidenza: { type: "number", minimum: 0, maximum: 1 },
                    motivazione: { type: "string", maxLength: 240 },
                  },
                  required: [
                    "id",
                    "classificazione",
                    "confidenza",
                    "motivazione",
                  ],
                },
              },
            },
            required: ["risultati"],
          },
        },
      });
      inputTokens += response.usage.inputTokens;
      outputTokens += response.usage.outputTokens;
      cachedInputTokens += response.usage.cachedInputTokens;
      const perId = new Map(
        parseRisultati(response.text).map(item => [item.id, item])
      );

      for (const iniziale of lotto) {
        const costo = ficCosti.find(
          item => item.id === iniziale.id && item.sedeId === sedeId
        );
        if (
          !costo ||
          costo.fonteClassificazione === "utente" ||
          costo.fonteClassificazione === "regola" ||
          firmaCosto(costo) !== firme.get(costo.id)
        ) {
          continue;
        }
        const risultato = perId.get(costo.id);
        const affidabile = risultato && risultato.confidenza >= 0.75;
        costo.classificazione = affidabile
          ? risultato.classificazione
          : "dubbio";
        costo.fonteClassificazione = "tars";
        costo.confidenza = risultato?.confidenza ?? 0;
        costo.motivazione =
          risultato?.motivazione || "Metadati insufficienti per classificare.";
        costo.aggiornatoAt = new Date();
        if (costo.classificazione === "dubbio") dubbi++;
        else classificati++;
      }
    } catch (errorLotto) {
      if (signal?.aborted) throw signal.reason;
      errore ??=
        errorLotto instanceof Error ? errorLotto.message : "Errore OpenAI";
      dubbi += lotto.length;
      console.warn(
        `[tars] classificazione costi FiC fallita: ${lotto.length} record restano dubbi`
      );
    }
  }

  saveFicCosti();
  console.info(
    `[tars] costi FiC: ${classificati} classificati, ${dubbi} dubbi, ${inputTokens} input token (${cachedInputTokens} cache), ${outputTokens} output token`
  );
  return {
    classificati,
    dubbi,
    errore,
    inputTokens,
    outputTokens,
    cachedInputTokens,
  };
}
