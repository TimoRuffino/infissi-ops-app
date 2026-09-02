// Analisi della comunicazione (smistamento, D3): il modello capisce
// (categoria, urgenza, riepilogo, allegati) e PROPONE un collegamento
// scegliendo fra i candidati deterministici; il server verifica ogni id.
// Senza provider reale c'è il percorso deterministico: stesse forme,
// meno intelligenza, mai un buco.

import { z } from "zod";
import { CATEGORIE_COMUNICAZIONE, classificaComunicazione } from "../../comunicazioni/filtroComunicazioni";
import type { Comunicazione } from "../../comunicazioni/comunicazioni";
import { DOC_TIPI, type DocTipo } from "../../routers/preventiviContratti";
import { classificaAllegatoComunicazione } from "../documenti/classificazione";
import type { RichiestaProvider, TarsProvider } from "../provider";
import { PROMPT_SMISTAMENTO, PROMPT_SMISTAMENTO_VERSIONE } from "./prompt";
import {
  AZIONI_SUGGERITE,
  URGENZE,
  type CandidatoCollegamento,
  type SegnaliMittente,
} from "./types";

export const MODELLO_SMISTAMENTO_DEFAULT = "gpt-5.6-terra";

export function modelloSmistamento(): string {
  return process.env.TARS_MODEL_SMISTAMENTO?.trim() || MODELLO_SMISTAMENTO_DEFAULT;
}

// 6.000 → 3.500 (02/09 sera): i token d'ingresso erano il grosso del costo.
const TESTO_MASSIMO = 3_500;
const TESTO_ALLEGATO_MASSIMO = 2_500;
const ALLEGATI_CON_TESTO = 2;

export type AllegatoPerAnalisi = {
  indice: number;
  nome: string;
  mimeType: string;
  size: number;
  /** Testo estratto (pdf/docx), troncato; null se non leggibile. */
  testo: string | null;
  stato: "testo" | "immagine" | "non_letto";
};

const CONFIDENZE = ["alta", "media", "bassa"] as const;

const schemaEsitoModello = z
  .object({
    categoria: z.enum(CATEGORIE_COMUNICAZIONE),
    urgenza: z.enum(URGENZE),
    riepilogo: z.string().min(1).max(600),
    richiedeRisposta: z.boolean(),
    azioneSuggerita: z.enum(AZIONI_SUGGERITE),
    istruzione: z.string().max(400),
    collegamento: z
      .object({
        tipo: z.enum(["commessa", "cliente", "nessuno"]),
        id: z.number().int().min(0),
        confidenza: z.enum(CONFIDENZE),
        motivo: z.string().max(400),
      })
      .strict(),
    allegati: z
      .array(
        z
          .object({
            indice: z.number().int().min(0),
            tipo: z.enum(DOC_TIPI),
            confidenza: z.enum(CONFIDENZE),
            archiviare: z.boolean(),
            motivo: z.string().max(300),
          })
          .strict()
      )
      .max(40),
  })
  .strict();

export type EsitoModello = z.infer<typeof schemaEsitoModello>;

/** JSON Schema strict (Responses API): tutto required, niente extra. */
export const SCHEMA_JSON_SMISTAMENTO: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "categoria",
    "urgenza",
    "riepilogo",
    "richiedeRisposta",
    "azioneSuggerita",
    "istruzione",
    "collegamento",
    "allegati",
  ],
  properties: {
    categoria: { type: "string", enum: [...CATEGORIE_COMUNICAZIONE] },
    urgenza: { type: "string", enum: [...URGENZE] },
    riepilogo: { type: "string" },
    richiedeRisposta: { type: "boolean" },
    azioneSuggerita: { type: "string", enum: [...AZIONI_SUGGERITE] },
    istruzione: { type: "string" },
    collegamento: {
      type: "object",
      additionalProperties: false,
      required: ["tipo", "id", "confidenza", "motivo"],
      properties: {
        tipo: { type: "string", enum: ["commessa", "cliente", "nessuno"] },
        id: { type: "integer" },
        confidenza: { type: "string", enum: [...CONFIDENZE] },
        motivo: { type: "string" },
      },
    },
    allegati: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["indice", "tipo", "confidenza", "archiviare", "motivo"],
        properties: {
          indice: { type: "integer" },
          tipo: { type: "string", enum: [...DOC_TIPI] },
          confidenza: { type: "string", enum: [...CONFIDENZE] },
          archiviare: { type: "boolean" },
          motivo: { type: "string" },
        },
      },
    },
  },
};

export type InputAnalisi = {
  comunicazione: Comunicazione;
  candidati: readonly CandidatoCollegamento[];
  segnali: SegnaliMittente;
  allegati: readonly AllegatoPerAnalisi[];
  /** Etichette leggibili dei candidati commessa: stato e cliente. */
  contestoCandidati?: ReadonlyMap<number, { stato: string; cliente: string }>;
};

/** Il messaggio utente per il modello: sezioni fisse, contenuto tra marcatori. */
export function costruisciInputModello(input: InputAnalisi): string {
  const c = input.comunicazione;
  const righe: string[] = [];
  righe.push(`CANALE: ${c.canale} (${c.direzione === "in" ? "in ingresso" : "in uscita"})`);
  righe.push(`MITTENTE: ${c.mittenteNome ? `${c.mittenteNome} <${c.mittente}>` : c.mittente}`);
  righe.push(`DESTINATARI: ${c.destinatari.join(", ") || "-"}`);
  righe.push(`RICEVUTA: ${c.receivedAt.toISOString()}`);
  righe.push(
    `SEGNALI: mittente interno all'azienda=${input.segnali.interno ? "sì" : "no"}; inoltro=${input.segnali.inoltro ? "sì" : "no"}${input.segnali.mittenteOriginale ? `; mittente originale=${input.segnali.mittenteOriginale}` : ""}`
  );
  if (c.clienteId != null || c.commessaId != null) {
    righe.push(
      `COLLEGAMENTO ATTUALE: cliente=${c.clienteId ?? "-"} commessa=${c.commessaId ?? "-"} (${c.matchMotivo ?? "senza motivo"})`
    );
  }
  righe.push(`OGGETTO: ${c.oggetto || "(senza oggetto)"}`);
  righe.push("");
  righe.push("CANDIDATI (usa SOLO questi id; 0 = nessuno):");
  if (input.candidati.length === 0) righe.push("- nessun candidato");
  for (const cand of input.candidati) {
    const extra =
      cand.tipo === "commessa" && input.contestoCandidati?.get(cand.id)
        ? ` [stato: ${input.contestoCandidati.get(cand.id)!.stato}]`
        : "";
    righe.push(
      `- ${cand.tipo} id=${cand.id}: ${cand.etichetta}${extra} (punteggio ${cand.punteggio}) — ${cand.motivi.join(" ")}`
    );
  }
  righe.push("");
  righe.push("ALLEGATI:");
  if (input.allegati.length === 0) righe.push("- nessuno");
  for (const a of input.allegati) {
    righe.push(
      `- indice=${a.indice} nome=«${a.nome}» tipo=${a.mimeType} dimensione=${a.size} byte stato=${a.stato}`
    );
    if (a.testo) {
      righe.push(`  <<<TESTO ALLEGATO ${a.indice}>>>`);
      righe.push(a.testo.slice(0, TESTO_ALLEGATO_MASSIMO));
      righe.push(`  <<<FINE TESTO ALLEGATO ${a.indice}>>>`);
    }
  }
  righe.push("");
  righe.push("<<<TESTO COMUNICAZIONE>>>");
  righe.push(c.testo.slice(0, TESTO_MASSIMO) || "(vuoto)");
  righe.push("<<<FINE TESTO COMUNICAZIONE>>>");
  return righe.join("\n");
}

export type EsitoAnalisi = {
  fonte: "modello" | "deterministico";
  modello: string | null;
  categoria: EsitoModello["categoria"];
  urgenza: EsitoModello["urgenza"];
  riepilogo: string;
  richiedeRisposta: boolean;
  azioneSuggerita: EsitoModello["azioneSuggerita"];
  istruzione: string;
  /** Verificato: l'id è fra i candidati, oppure null. */
  collegamento: {
    tipo: "commessa" | "cliente";
    id: number;
    confidenza: (typeof CONFIDENZE)[number];
    motivo: string;
  } | null;
  allegati: Array<{
    indice: number;
    tipo: DocTipo;
    confidenza: (typeof CONFIDENZE)[number];
    archiviareSecondoModello: boolean;
    motivo: string;
  }>;
  avvertenze: string[];
};

/** Rimuove importi in euro dai testi che il modello ha prodotto (pavimento economico). */
export function senzaImportiEuro(testo: string): string {
  return testo.replace(
    /(?:€|\beur(?:o|i)?\b)\s*\d[\d.,]*|\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?\s*(?:€|\beur(?:o|i)?\b)|\d+[.,]\d{2}\s*(?:€|\beur(?:o|i)?\b)|\d+\s*(?:€|\beur(?:o|i)?\b)/gi,
    "un importo"
  );
}

function verifica(
  grezzo: EsitoModello,
  input: InputAnalisi,
  modello: string
): EsitoAnalisi {
  const avvertenze: string[] = [];
  let collegamento: EsitoAnalisi["collegamento"] = null;
  if (grezzo.collegamento.tipo !== "nessuno" && grezzo.collegamento.id > 0) {
    const candidato = input.candidati.find(
      c => c.tipo === grezzo.collegamento.tipo && c.id === grezzo.collegamento.id
    );
    if (candidato) {
      collegamento = {
        tipo: candidato.tipo,
        id: candidato.id,
        confidenza: grezzo.collegamento.confidenza,
        motivo: senzaImportiEuro(grezzo.collegamento.motivo || candidato.motivi.join(" ")),
      };
    } else {
      avvertenze.push(
        `Il modello ha indicato ${grezzo.collegamento.tipo} ${grezzo.collegamento.id}, che non è fra i candidati: ignorato.`
      );
    }
  }
  const indiciValidi = new Set(input.allegati.map(a => a.indice));
  const allegati = grezzo.allegati
    .filter(a => {
      if (indiciValidi.has(a.indice)) return true;
      avvertenze.push(`Allegato ${a.indice} indicato dal modello ma inesistente: ignorato.`);
      return false;
    })
    .map(a => ({
      indice: a.indice,
      tipo: a.tipo,
      confidenza: a.confidenza,
      archiviareSecondoModello: a.archiviare,
      motivo: senzaImportiEuro(a.motivo),
    }));
  return {
    fonte: "modello",
    modello,
    categoria: grezzo.categoria,
    urgenza: grezzo.urgenza,
    riepilogo: senzaImportiEuro(grezzo.riepilogo).slice(0, 600),
    richiedeRisposta: grezzo.richiedeRisposta,
    azioneSuggerita: grezzo.azioneSuggerita,
    istruzione: senzaImportiEuro(grezzo.istruzione).slice(0, 400),
    collegamento,
    allegati,
    avvertenze,
  };
}

/** Chiave C2 dello smistamento: prefisso stabile per il prompt caching. */
export function chiaveCacheSmistamento(modello: string): string {
  return `tars-smist-${PROMPT_SMISTAMENTO_VERSIONE}-${modello}`.slice(0, 64);
}

export async function analizzaConModello(
  input: InputAnalisi & {
    provider: TarsProvider;
    modello: string;
    identita: RichiestaProvider["identita"];
    timeoutMs?: number;
  }
): Promise<EsitoAnalisi> {
  const richiesta: RichiestaProvider = {
    modello: input.modello,
    istruzioni: PROMPT_SMISTAMENTO,
    input: [{ ruolo: "user", contenuto: costruisciInputModello(input) }],
    strumenti: [],
    maxOutputToken: 1_200,
    chiaveCachePrompt: chiaveCacheSmistamento(input.modello),
    timeoutMs: input.timeoutMs ?? 60_000,
    identita: input.identita,
    formatoJson: { nome: "smistamento_comunicazione", schema: SCHEMA_JSON_SMISTAMENTO },
  };
  const risposta = await input.provider.rispondi(richiesta);
  if (risposta.tipo !== "messaggio") {
    throw new Error("SMISTAMENTO_RISPOSTA_INVALIDA: il modello ha chiamato strumenti inesistenti.");
  }
  let grezzo: unknown;
  try {
    grezzo = JSON.parse(risposta.testo);
  } catch {
    throw new Error("SMISTAMENTO_RISPOSTA_INVALIDA: JSON non decodificabile.");
  }
  const validato = schemaEsitoModello.safeParse(grezzo);
  if (!validato.success) {
    throw new Error(
      `SMISTAMENTO_RISPOSTA_INVALIDA: ${validato.error.issues.map(i => i.path.join(".") + " " + i.message).join("; ").slice(0, 300)}`
    );
  }
  return verifica(validato.data, input, input.modello);
}

/**
 * Percorso senza modello: regole del filtro per la categoria, allegati
 * dal classificatore lessicale, collegamento dal miglior candidato solo
 * se nettamente sopra gli altri. Stesse forme dell'esito del modello.
 */
export function analisiDeterministica(input: InputAnalisi): EsitoAnalisi {
  const c = input.comunicazione;
  const filtro = classificaComunicazione({
    sedeId: c.sedeId,
    mittente: c.mittente,
    oggetto: c.oggetto,
    testo: c.testo,
    allegati: c.allegati,
    clienteId: c.clienteId,
    commessaId: c.commessaId,
  });
  const migliore = input.candidati[0];
  const secondo = input.candidati[1];
  const collegamento =
    migliore && migliore.punteggio >= 60 && (!secondo || migliore.punteggio - secondo.punteggio >= 20)
      ? {
          tipo: migliore.tipo,
          id: migliore.id,
          confidenza: (migliore.punteggio >= 85 ? "alta" : "media") as "alta" | "media",
          motivo: migliore.motivi.join(" "),
        }
      : null;
  const allegati = input.allegati.map(a => {
    const classe = classificaAllegatoComunicazione({
      nome: a.nome,
      mimeType: a.mimeType,
      oggetto: c.oggetto,
      testo: a.testo,
    });
    return {
      indice: a.indice,
      tipo: classe.tipo,
      confidenza: classe.confidenza,
      archiviareSecondoModello: classe.tipo !== "altro" && classe.confidenza !== "bassa",
      motivo: classe.segnali.join(", ") || "classificazione lessicale",
    };
  });
  const riepilogo = senzaImportiEuro(
    `${c.oggetto || "Senza oggetto"}${c.testo ? ` — ${c.testo.replace(/\s+/g, " ").slice(0, 160)}` : ""}`
  );
  const richiedeRisposta =
    c.direzione === "in" &&
    !input.segnali.interno &&
    (filtro.categoria === "nuovo_lead" || filtro.categoria === "operativa");
  return {
    fonte: "deterministico",
    modello: null,
    categoria: filtro.categoria,
    urgenza: filtro.categoria === "nuovo_lead" ? "alta" : "normale",
    riepilogo,
    richiedeRisposta,
    azioneSuggerita: collegamento
      ? "collega"
      : allegati.some(a => a.archiviareSecondoModello)
        ? "archivia_allegati"
        : filtro.categoria === "spam" || filtro.categoria === "offerta_marketing"
          ? "ignora"
          : "nessuna",
    istruzione: filtro.motivo,
    collegamento,
    allegati,
    avvertenze: ["Analisi senza modello: regole locali."],
  };
}
