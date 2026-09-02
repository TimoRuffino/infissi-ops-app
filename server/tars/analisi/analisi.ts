// Sintesi giornaliera: fotografia → modello (JSON strict) → verifica
// deterministica. Senza provider: sintesi deterministica dai contatori.

import { z } from "zod";
import type { RichiestaProvider, TarsProvider } from "../provider";
import { senzaImportiEuro } from "../smistamento/analisi";
import { entitaDellaFotografia, testoFotografia } from "./fotografia";
import { PROMPT_ANALISI, PROMPT_ANALISI_VERSIONE, SCHEMA_JSON_ANALISI } from "./prompt";
import {
  PRIORITA_PUNTO,
  TIPI_PUNTO,
  VERSIONE_ANALISI_AZIENDA,
  type EsitoAnalisiAzienda,
  type FotografiaAzienda,
  type PropostaAnalisi,
  type PuntoAnalisi,
} from "./types";

const MODELLO_ANALISI_DEFAULT = "gpt-5.6-sol";
const SINTESI_MASSIMA = 900;
const TESTO_MASSIMO = 400;
const PUNTI_MASSIMI = 8;
const PROPOSTE_MASSIME = 6;
const DOMANDE_MASSIME = 3;

export function modelloAnalisi(): string {
  return process.env.TARS_MODEL_ANALISI?.trim() || MODELLO_ANALISI_DEFAULT;
}

const schemaEsitoModello = z.object({
  sintesi: z.string(),
  punti: z
    .array(
      z.object({
        tipo: z.enum(TIPI_PUNTO),
        priorita: z.enum(PRIORITA_PUNTO),
        testo: z.string(),
        entita: z.array(z.string()),
      })
    )
    .default([]),
  proposte: z
    .array(
      z.object({
        testo: z.string(),
        richiestaPerTars: z.string(),
        entita: z.array(z.string()),
      })
    )
    .default([]),
  domande: z.array(z.string()).default([]),
});

type EsitoModello = z.infer<typeof schemaEsitoModello>;

const ORDINE_PRIORITA: Record<string, number> = { alta: 0, media: 1, bassa: 2 };

function pulisci(testo: string, massimo: number): string {
  return senzaImportiEuro(testo).replace(/\s+/g, " ").trim().slice(0, massimo);
}

/** Verifica deterministica: entità solo dalla fotografia, importi scrubbati, limiti. */
export function verificaEsito(
  grezzo: EsitoModello,
  fotografia: FotografiaAzienda,
  modello: string
): EsitoAnalisiAzienda {
  const note = entitaDellaFotografia(fotografia);
  const avvertenze: string[] = [];
  let scartate = 0;
  const filtraEntita = (lista: string[]): { entita: string[]; link: string | null } => {
    const valide = lista.filter(r => {
      if (note.has(r)) return true;
      scartate += 1;
      return false;
    });
    const link = valide.map(r => note.get(r) ?? null).find(l => l != null) ?? null;
    return { entita: valide, link };
  };

  const punti: PuntoAnalisi[] = grezzo.punti
    .filter(p => p.testo.trim().length > 0)
    .map(p => ({ tipo: p.tipo, priorita: p.priorita, testo: pulisci(p.testo, TESTO_MASSIMO), ...filtraEntita(p.entita) }))
    .sort((a, b) => ORDINE_PRIORITA[a.priorita] - ORDINE_PRIORITA[b.priorita])
    .slice(0, PUNTI_MASSIMI);
  const proposte: PropostaAnalisi[] = grezzo.proposte
    .filter(p => p.testo.trim().length > 0 && p.richiestaPerTars.trim().length > 0)
    .map(p => ({
      testo: pulisci(p.testo, TESTO_MASSIMO),
      richiestaPerTars: pulisci(p.richiestaPerTars, TESTO_MASSIMO),
      ...filtraEntita(p.entita),
    }))
    .slice(0, PROPOSTE_MASSIME);
  const domande = grezzo.domande
    .map(d => pulisci(d, TESTO_MASSIMO))
    .filter(Boolean)
    .slice(0, DOMANDE_MASSIME);
  if (scartate > 0) {
    avvertenze.push(`${scartate} riferimenti indicati dal modello non erano nella fotografia: ignorati.`);
  }
  return {
    versione: VERSIONE_ANALISI_AZIENDA,
    fonte: "modello",
    modello,
    sintesi: pulisci(grezzo.sintesi, SINTESI_MASSIMA) || "Il modello non ha prodotto una sintesi.",
    punti,
    proposte,
    domande,
    avvertenze,
    contatori: fotografia.contatori,
    fattiConsiderati: fotografia.sezioni.reduce((n, s) => n + s.fatti.length, 0),
  };
}

/** Chiave C2 dell'analisi: prefisso stabile per il prompt caching. */
export function chiaveCacheAnalisi(modello: string): string {
  return `tars-analisi-${PROMPT_ANALISI_VERSIONE}-${modello}`.slice(0, 64);
}

export async function analizzaConModello(input: {
  fotografia: FotografiaAzienda;
  provider: TarsProvider;
  modello: string;
  identita: RichiestaProvider["identita"];
  timeoutMs?: number;
}): Promise<EsitoAnalisiAzienda> {
  const richiesta: RichiestaProvider = {
    modello: input.modello,
    istruzioni: PROMPT_ANALISI,
    input: [{ ruolo: "user", contenuto: testoFotografia(input.fotografia) }],
    strumenti: [],
    maxOutputToken: 2_500,
    chiaveCachePrompt: chiaveCacheAnalisi(input.modello),
    timeoutMs: input.timeoutMs ?? 120_000,
    identita: input.identita,
    formatoJson: { nome: "analisi_azienda", schema: SCHEMA_JSON_ANALISI },
  };
  const risposta = await input.provider.rispondi(richiesta);
  if (risposta.tipo !== "messaggio") {
    throw new Error("ANALISI_RISPOSTA_INVALIDA: il modello ha chiamato strumenti inesistenti.");
  }
  let grezzo: unknown;
  try {
    grezzo = JSON.parse(risposta.testo);
  } catch {
    throw new Error("ANALISI_RISPOSTA_INVALIDA: JSON non decodificabile.");
  }
  const validato = schemaEsitoModello.safeParse(grezzo);
  if (!validato.success) {
    throw new Error(
      `ANALISI_RISPOSTA_INVALIDA: ${validato.error.issues.map(i => i.path.join(".") + " " + i.message).join("; ").slice(0, 300)}`
    );
  }
  return verificaEsito(validato.data, input.fotografia, input.modello);
}

/** Senza modello: i contatori parlano da soli, niente proposte inventate. */
export function analisiDeterministica(fotografia: FotografiaAzienda): EsitoAnalisiAzienda {
  const c = fotografia.contatori;
  const parti: string[] = [];
  parti.push(`${c.commesseAttive ?? 0} commesse attive${c.commesseUrgenti ? ` (${c.commesseUrgenti} urgenti)` : ""}.`);
  if ((c.casiAperti ?? 0) > 0) parti.push(`${c.casiAperti} casi aperti nel Centro Azioni${c.casiCritici ? `, ${c.casiCritici} critici` : ""}.`);
  if ((c.comunicazioniUrgenti ?? 0) + (c.comunicazioniDaRispondere ?? 0) + (c.comunicazioniDaDecidere ?? 0) > 0) {
    parti.push(`Comunicazioni: ${c.comunicazioniUrgenti ?? 0} urgenti, ${c.comunicazioniDaRispondere ?? 0} da rispondere, ${c.comunicazioniDaDecidere ?? 0} da decidere.`);
  }
  if ((c.ticketAperti ?? 0) > 0) parti.push(`${c.ticketAperti} ticket aperti${c.ticketUrgenti ? ` (${c.ticketUrgenti} alta priorità)` : ""}.`);
  if ((c.interventiSettimana ?? 0) > 0) parti.push(`${c.interventiSettimana} interventi in settimana${c.interventiSenzaSquadra ? `, ${c.interventiSenzaSquadra} senza squadra` : ""}.`);
  const punti: PuntoAnalisi[] = [];
  const casi = fotografia.sezioni.find(s => s.chiave === "casi")?.fatti ?? [];
  for (const fatto of casi.slice(0, 4)) {
    punti.push({ tipo: "rischio", priorita: fatto.testo.startsWith("[critica]") ? "alta" : "media", testo: fatto.testo, entita: fatto.entita, link: fatto.link });
  }
  const ferme = (fotografia.sezioni.find(s => s.chiave === "commesse")?.fatti ?? []).filter(f => f.chiave.endsWith(":ferma"));
  for (const fatto of ferme.slice(0, 3)) {
    punti.push({ tipo: "anomalia", priorita: "media", testo: fatto.testo, entita: fatto.entita, link: fatto.link });
  }
  return {
    versione: VERSIONE_ANALISI_AZIENDA,
    fonte: "deterministica",
    modello: null,
    sintesi: `Sintesi senza modello. ${parti.join(" ")}`.slice(0, SINTESI_MASSIMA),
    punti: punti.slice(0, PUNTI_MASSIMI),
    proposte: [],
    domande: [],
    avvertenze: ["Provider del modello non disponibile: sintesi deterministica dai contatori."],
    contatori: fotografia.contatori,
    fattiConsiderati: fotografia.sezioni.reduce((n, s) => n + s.fatti.length, 0),
  };
}
