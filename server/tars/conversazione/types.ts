import { z } from "zod";
import { SUPERFICI_TARS, type SuperficieTars } from "../strumenti/tipi";

export type CandidatoChiarificazioneCommessa = {
  commessaId: number;
  codice: string;
  cliente: string;
};

export type ChiarificazionePendente = {
  tipo: "commessa";
  candidati: CandidatoChiarificazioneCommessa[];
};

const schemaCandidatoChiarificazione = z.object({
  commessaId: z.number().int().positive(),
  codice: z.string().min(1).max(80),
  cliente: z.string().min(1).max(200),
}).strict();

/** Schema completo del JSONB persistito; un payload parzialmente rotto è scartato. */
export const schemaContestoConversazionePersistito = z.object({
  commessaId: z.number().int().positive().nullable(),
  clienteId: z.number().int().positive().nullable(),
  comunicazioneId: z.number().int().positive().nullable(),
  allegatoIndex: z.number().int().nonnegative().nullable(),
  superficie: z.enum(SUPERFICI_TARS).nullable(),
  versioniEntita: z.record(z.string().min(1), z.string()),
  chiarificazionePendente: z.object({
    tipo: z.literal("commessa"),
    candidati: z.array(schemaCandidatoChiarificazione).min(2).max(4),
  }).strict().nullable(),
}).strict();

/** Backfill mirato della sola forma T2 iniziale; non tollera altri payload. */
export function analizzaContestoConversazionePersistito(valore: unknown) {
  const diretto = schemaContestoConversazionePersistito.safeParse(valore);
  if (diretto.success) return diretto;
  if (!valore || typeof valore !== "object" || Array.isArray(valore)) {
    return diretto;
  }
  const oggetto = valore as Record<string, unknown>;
  const pendente = oggetto.chiarificazionePendente;
  if (!pendente || typeof pendente !== "object" || Array.isArray(pendente)) {
    return diretto;
  }
  const legacy = pendente as Record<string, unknown>;
  if (legacy.tipo !== "commessa" || !Array.isArray(legacy.candidati)) {
    return diretto;
  }
  return schemaContestoConversazionePersistito.safeParse({
    ...oggetto,
    chiarificazionePendente: {
      tipo: "commessa",
      candidati: legacy.candidati,
    },
  });
}

/**
 * Hint conversazionale persistente. Non contiene capability e non concede
 * autorità: ogni consumer deve rileggere la fonte CRM prima di usarlo.
 */
export type ContestoConversazione = {
  commessaId: number | null;
  clienteId: number | null;
  comunicazioneId: number | null;
  allegatoIndex: number | null;
  superficie: SuperficieTars | null;
  versioniEntita: Record<string, string>;
  chiarificazionePendente: ChiarificazionePendente | null;
  versione: number;
};

export type PatchContestoConversazione = Partial<
  Omit<ContestoConversazione, "versione">
>;

export type CandidatoResolverCommessa =
  CandidatoChiarificazioneCommessa & {
    punteggio: number;
    evidenze: string[];
  };

export type EsitoResolverCommessa =
  | { stato: "unico"; candidato: CandidatoResolverCommessa }
  | {
      stato: "ambiguo";
      candidati: CandidatoResolverCommessa[];
      domanda: string;
    }
  | { stato: "non_trovato"; candidati: [] };

export function contestoConversazioneVuoto(): ContestoConversazione {
  return {
    commessaId: null,
    clienteId: null,
    comunicazioneId: null,
    allegatoIndex: null,
    superficie: null,
    versioniEntita: {},
    chiarificazionePendente: null,
    versione: 0,
  };
}

export function domandaChiarificazioneCommessa(
  candidati: readonly CandidatoChiarificazioneCommessa[]
): string {
  const opzioni = candidati
    .slice(0, 4)
    .map(c => `${c.codice} — ${c.cliente}`);
  return `Quale intendi: ${opzioni.join(" oppure ")}?`;
}
