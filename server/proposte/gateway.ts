// Approval gateway delle proposte di azione (D7, slice 3 — PRD §19.4).
//
// Fondazione GENERALE ma strettamente tipizzata, separata dai router
// business: qui vivono il registro chiuso dei tipi di azione, lo store
// delle proposte, la macchina a stati e i comandi. Il gateway non conosce
// tRPC, non decide autorizzazioni (le fa il router, con il doppio
// requisito di capability) e non esegue MAI nulla da solo: una proposta
// diventa effetto reale soltanto attraverso `applicaProposta`, dopo
// approvazione umana e con il valore corrente ancora identico allo
// snapshot. È la stessa fondazione su cui poggerà il futuro agente: le
// proposte restano proposte, chi le applica è una persona autorizzata.
//
// Macchina a stati:
//   proposta → approvata → applicata | fallita
//   proposta | approvata → rifiutata | annullata | scaduta | obsoleta
// `scaduta` = superata la scadenza temporale; `obsoleta` = i dati sorgente
// sono cambiati rispetto allo snapshot (serve una nuova revisione). Tutti
// gli esiti restano nel record, con cronologia append-only.

import { createHash } from "node:crypto";
import { persistedStore } from "../_core/persistence";
import type { Capability } from "../authz/capabilities";
import type { Evidenza } from "../documenti/estrazioneConferma";

export const TIPI_AZIONE_PROPOSTA = [
  "ordine_fornitore.aggiorna_data_consegna",
] as const;
export type TipoAzioneProposta = (typeof TIPI_AZIONE_PROPOSTA)[number];

export type StatoProposta =
  | "proposta"
  | "approvata"
  | "rifiutata"
  | "applicata"
  | "fallita"
  | "annullata"
  | "scaduta"
  | "obsoleta";

export type EventoProposta = {
  tipo: StatoProposta | "creata";
  utenteId: number | null;
  motivo: string | null;
  at: Date;
};

export type PropostaAzione = {
  id: number;
  sedeId: number;
  tipo: TipoAzioneProposta;
  /** Origine documentale: da dove nasce la proposta e con quali prove. */
  documentoId: number;
  documentoNome: string;
  byteChecksum: string | null;
  analisiId: number | null;
  evidenza: Evidenza | null;
  /** Oggetto dell'azione. */
  ordineId: number;
  commessaId: number | null;
  /** Valore corrente al momento della generazione e valore proposto. */
  valoreCorrente: string | null;
  valoreProposto: string;
  motivazione: string;
  /** Versioni dei componenti che hanno prodotto i dati della proposta. */
  versioni: Record<string, string | null>;
  /** Autore: la pipeline deterministica, mai una persona. */
  autore: "sistema";
  stato: StatoProposta;
  eventi: EventoProposta[];
  chiaveIdempotenza: string;
  scadeIl: Date;
  createdAt: Date;
  updatedAt: Date;
};

export const SCADENZA_PROPOSTA_GIORNI = 30;

/**
 * Definizione di un tipo di azione: la capability dell'operazione finale,
 * come rileggere il valore corrente dal dato autorevole, come descrivere
 * l'effetto esatto e come applicarlo. È l'UNICO punto in cui il gateway
 * tocca il dominio, e solo attraverso comandi tipizzati registrati qui.
 */
export type DefinizioneAzioneProposta = {
  tipo: TipoAzioneProposta;
  etichetta: string;
  capabilityFinale: Capability;
  leggiValoreCorrente(proposta: PropostaAzione): string | null;
  descriviEffetto(proposta: PropostaAzione): string;
  applica(proposta: PropostaAzione): void | Promise<void>;
};

const registro = new Map<TipoAzioneProposta, DefinizioneAzioneProposta>();

export function registraAzioneProposta(def: DefinizioneAzioneProposta): void {
  registro.set(def.tipo, def);
}

export function definizioneAzione(
  tipo: TipoAzioneProposta
): DefinizioneAzioneProposta {
  const def = registro.get(tipo);
  if (!def) {
    throw new Error(`Tipo di azione non registrato nel gateway: ${tipo}`);
  }
  return def;
}

let nextPropostaId = 1;
const _proposteStore = persistedStore<PropostaAzione>(
  "proposte_azioni",
  items => {
    nextPropostaId = items.length
      ? Math.max(...items.map(item => item.id)) + 1
      : 1;
  }
);
const proposte = _proposteStore.items;

/** Lettura per il Centro Azioni e i test: MAI mutare da fuori. */
export function getProposteStore(): readonly PropostaAzione[] {
  return proposte;
}

export function propostaById(
  sedeId: number,
  id: number
): PropostaAzione | null {
  const trovata = proposte.find(p => p.id === id && p.sedeId === sedeId);
  return trovata ?? null;
}

export function propostePerOrdine(
  sedeId: number,
  ordineId: number
): PropostaAzione[] {
  return proposte
    .filter(p => p.sedeId === sedeId && p.ordineId === ordineId)
    .sort((a, b) => b.id - a.id);
}

const STATI_APERTI = new Set<StatoProposta>(["proposta", "approvata"]);

/**
 * Hash dell'ANTEPRIMA mostrata all'umano: lega il click di approvazione a
 * esattamente ciò che era sullo schermo (valori, effetto descritto,
 * versioni dello snapshot). Se la proposta viene rigenerata o l'effetto
 * descritto cambia tra il render e il click, l'hash non corrisponde più e
 * la conferma va rifiutata — è il lucchetto ottimistico della frontiera
 * unica R2/R3, complementare alla freschezza sul valore corrente.
 */
export function hashAnteprimaProposta(proposta: PropostaAzione): string {
  let effetto: string | null = null;
  try {
    effetto = definizioneAzione(proposta.tipo).descriviEffetto(proposta);
  } catch {
    effetto = null;
  }
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: proposta.id,
        sedeId: proposta.sedeId,
        tipo: proposta.tipo,
        ordineId: proposta.ordineId,
        documentoId: proposta.documentoId,
        byteChecksum: proposta.byteChecksum,
        valoreCorrente: proposta.valoreCorrente,
        valoreProposto: proposta.valoreProposto,
        versioni: proposta.versioni,
        effetto,
      })
    )
    .digest("hex");
}

function transiziona(
  proposta: PropostaAzione,
  stato: StatoProposta,
  utenteId: number | null,
  motivo: string | null
): PropostaAzione {
  proposta.stato = stato;
  proposta.eventi.push({ tipo: stato, utenteId, motivo, at: new Date() });
  proposta.updatedAt = new Date();
  _proposteStore.save();
  return proposta;
}

/**
 * Scadenza e invalidazione, applicate PRIMA di ogni lettura o decisione:
 * una proposta oltre la scadenza diventa `scaduta`; una il cui valore
 * corrente non corrisponde più allo snapshot diventa `obsoleta` e richiede
 * una nuova revisione. Nessuna delle due applica niente.
 */
export function verificaFreschezza(
  proposta: PropostaAzione,
  now = new Date()
): PropostaAzione {
  if (!STATI_APERTI.has(proposta.stato)) return proposta;
  if (proposta.scadeIl.getTime() <= now.getTime()) {
    return transiziona(
      proposta,
      "scaduta",
      null,
      "Scadenza superata senza una decisione."
    );
  }
  let corrente: string | null;
  try {
    corrente = definizioneAzione(proposta.tipo).leggiValoreCorrente(proposta);
  } catch (errore: any) {
    return transiziona(
      proposta,
      "obsoleta",
      null,
      `Dato sorgente non più leggibile: ${String(errore?.message ?? errore)}`
    );
  }
  if ((corrente ?? null) !== (proposta.valoreCorrente ?? null)) {
    return transiziona(
      proposta,
      "obsoleta",
      null,
      `Il valore corrente è cambiato (ora: ${corrente ?? "nessuno"}, nello snapshot: ${proposta.valoreCorrente ?? "nessuno"}): serve una nuova revisione.`
    );
  }
  return proposta;
}

export function creaProposta(input: {
  sedeId: number;
  tipo: TipoAzioneProposta;
  documentoId: number;
  documentoNome: string;
  byteChecksum: string | null;
  analisiId: number | null;
  evidenza: Evidenza | null;
  ordineId: number;
  commessaId: number | null;
  valoreCorrente: string | null;
  valoreProposto: string;
  motivazione: string;
  versioni: Record<string, string | null>;
  now?: Date;
}): { proposta: PropostaAzione; riusata: boolean } {
  definizioneAzione(input.tipo); // il tipo deve esistere nel registro chiuso
  const chiave = [
    input.tipo,
    input.sedeId,
    input.ordineId,
    input.documentoId,
    input.byteChecksum ?? "-",
    input.valoreProposto,
  ].join("|");

  // Idempotenza: una proposta APERTA con la stessa chiave non si duplica.
  // Gli esiti terminali restano in cronologia; una proposta identica già
  // applicata non viene rigenerata (l'effetto esiste già). Il riuso passa
  // PRIMA dalla freschezza (revisione): una proposta rimasta aperta su
  // dati nel frattempo cambiati diventa obsoleta/scaduta qui, e al suo
  // posto ne nasce una nuova con lo snapshot aggiornato.
  const esistente = proposte.find(
    p =>
      p.chiaveIdempotenza === chiave &&
      (STATI_APERTI.has(p.stato) || p.stato === "applicata")
  );
  if (esistente) {
    const fresca =
      esistente.stato === "applicata"
        ? esistente
        : verificaFreschezza(esistente, input.now);
    if (STATI_APERTI.has(fresca.stato) || fresca.stato === "applicata") {
      return { proposta: fresca, riusata: true };
    }
  }

  const now = input.now ?? new Date();
  const proposta: PropostaAzione = {
    id: nextPropostaId++,
    sedeId: input.sedeId,
    tipo: input.tipo,
    documentoId: input.documentoId,
    documentoNome: input.documentoNome,
    byteChecksum: input.byteChecksum,
    analisiId: input.analisiId,
    evidenza: input.evidenza,
    ordineId: input.ordineId,
    commessaId: input.commessaId,
    valoreCorrente: input.valoreCorrente,
    valoreProposto: input.valoreProposto,
    motivazione: input.motivazione,
    versioni: input.versioni,
    autore: "sistema",
    stato: "proposta",
    eventi: [{ tipo: "creata", utenteId: null, motivo: null, at: now }],
    chiaveIdempotenza: chiave,
    scadeIl: new Date(
      now.getTime() + SCADENZA_PROPOSTA_GIORNI * 86_400_000
    ),
    createdAt: now,
    updatedAt: now,
  };
  proposte.push(proposta);
  _proposteStore.save();
  return { proposta, riusata: false };
}

export function approvaProposta(input: {
  sedeId: number;
  id: number;
  utenteId: number | null;
  now?: Date;
}): PropostaAzione {
  const trovata = propostaById(input.sedeId, input.id);
  if (!trovata) throw new Error("Proposta non trovata.");
  const fresca = verificaFreschezza(trovata, input.now);
  if (fresca.stato !== "proposta") {
    throw new Error(
      `La proposta non è più approvabile: stato ${fresca.stato}.`
    );
  }
  return transiziona(fresca, "approvata", input.utenteId, null);
}

export function rifiutaProposta(input: {
  sedeId: number;
  id: number;
  utenteId: number | null;
  motivo: string | null;
}): PropostaAzione {
  const trovata = propostaById(input.sedeId, input.id);
  if (!trovata) throw new Error("Proposta non trovata.");
  if (!STATI_APERTI.has(trovata.stato)) {
    throw new Error(`La proposta è già chiusa: stato ${trovata.stato}.`);
  }
  return transiziona(trovata, "rifiutata", input.utenteId, input.motivo);
}

export function annullaProposta(input: {
  sedeId: number;
  id: number;
  utenteId: number | null;
  motivo: string | null;
}): PropostaAzione {
  const trovata = propostaById(input.sedeId, input.id);
  if (!trovata) throw new Error("Proposta non trovata.");
  if (!STATI_APERTI.has(trovata.stato)) {
    throw new Error(`La proposta è già chiusa: stato ${trovata.stato}.`);
  }
  return transiziona(trovata, "annullata", input.utenteId, input.motivo);
}

/**
 * Applica una proposta APPROVATA. Ricontrolla la freschezza (valore
 * corrente identico allo snapshot) subito prima di eseguire; l'esecuzione
 * passa solo dal comando tipizzato registrato per quel tipo. Un errore
 * durante l'applicazione produce `fallita` con il motivo, mai un effetto
 * parziale nascosto. Idempotente: una proposta già applicata non riesegue.
 */
export async function applicaProposta(input: {
  sedeId: number;
  id: number;
  utenteId: number | null;
  now?: Date;
}): Promise<{ proposta: PropostaAzione; riusata: boolean }> {
  const trovata = propostaById(input.sedeId, input.id);
  if (!trovata) throw new Error("Proposta non trovata.");
  if (trovata.stato === "applicata") {
    return { proposta: trovata, riusata: true };
  }
  if (trovata.stato !== "approvata") {
    throw new Error(
      trovata.stato === "proposta"
        ? "La proposta non è ancora approvata."
        : `La proposta non è più applicabile: stato ${trovata.stato}.`
    );
  }
  const fresca = verificaFreschezza(trovata, input.now);
  if (fresca.stato !== "approvata") {
    throw new Error(
      `La proposta non è più applicabile: stato ${fresca.stato}.`
    );
  }
  const def = definizioneAzione(fresca.tipo);
  try {
    await def.applica(fresca);
  } catch (errore: any) {
    transiziona(
      fresca,
      "fallita",
      input.utenteId,
      String(errore?.message ?? errore)
    );
    throw new Error(
      `Applicazione non riuscita: ${String(errore?.message ?? errore)}`
    );
  }
  return {
    proposta: transiziona(fresca, "applicata", input.utenteId, null),
    riusata: false,
  };
}
