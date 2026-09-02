// Effetti deterministici dello smistamento (D1, D2): collegamento certo,
// archiviazione degli allegati riconosciuti, scrittura del triage,
// apertura della proposta. Qui il modello non entra: entra il suo esito
// già verificato, e ogni effetto passa dai servizi canonici del CRM.

import {
  collegaAutomaticoComunicazione,
  salvaEsitoTarsComunicazione,
  setClassificazioneComunicazione,
  setMatchComunicazione,
  type Comunicazione,
} from "../../comunicazioni/comunicazioni";
import { leggiAllegatoRaw } from "../../comunicazioni/allegati";
import {
  archiviaAllegatoComunicazione,
  findDocumentoComunicazione,
  type DocTipo,
} from "../../routers/preventiviContratti";
import { getCommessaById } from "../../routers/commesse";
import { classificaAllegatoComunicazione } from "../documenti/classificazione";
import type { EsitoAnalisi, AllegatoPerAnalisi } from "./analisi";
import type { EsitoCandidati } from "./candidati";
import type { CandidatoCollegamento } from "./types";
import type {
  EsitoSmistamento,
  PianoAllegato,
  StatoProposta,
} from "./types";
import { VERSIONE_SMISTAMENTO } from "./types";

/** Tipi che valgono un posto nel fascicolo anche da soli. */
const TIPI_ARCHIVIABILI: ReadonlySet<DocTipo> = new Set<DocTipo>([
  "preventivo",
  "contratto",
  "misure",
  "fattura",
  "ordine",
  "conferma_ordine",
  "ddt_consegna",
  "ddt_posa",
  "ddt_finale",
  "saldo",
  "planimetria",
  "certificazione",
  "visura",
  "documento_identita",
]);

const MIME_DOCUMENTO = /pdf|msword|officedocument|xml|pkcs7|p7s|text\/plain|csv/i;
const MIME_IMMAGINE = /^image\//i;
const IMMAGINE_MINIMA_BYTE = 30 * 1024;

export type DipendenzeApplica = {
  leggiRaw: typeof leggiAllegatoRaw;
  /** Commessa in sede (id, cliente, archiviazione) per il collegamento sicuro dal modello. */
  leggiCommessa: (
    commessaId: number,
    sedeId: number
  ) => { id: number; clienteId: number | null; archivedAt: Date | string | null } | null;
  archivia: typeof archiviaAllegatoComunicazione;
  documentoEsistente: typeof findDocumentoComunicazione;
  collegaAutomatico: typeof collegaAutomaticoComunicazione;
  collegaManuale: typeof setMatchComunicazione;
  classifica: typeof setClassificazioneComunicazione;
  salvaEsito: typeof salvaEsitoTarsComunicazione;
};

export const DIPENDENZE_APPLICA_REALI: DipendenzeApplica = {
  leggiRaw: leggiAllegatoRaw,
  leggiCommessa: (commessaId, sedeId) => {
    const c: any = getCommessaById(commessaId);
    if (!c || c.sedeId !== sedeId) return null;
    return { id: c.id, clienteId: c.clienteId ?? null, archivedAt: c.archivedAt ?? null };
  },
  archivia: archiviaAllegatoComunicazione,
  documentoEsistente: findDocumentoComunicazione,
  collegaAutomatico: collegaAutomaticoComunicazione,
  collegaManuale: setMatchComunicazione,
  classifica: setClassificazioneComunicazione,
  salvaEsito: salvaEsitoTarsComunicazione,
};

/**
 * Decisione D2 per ogni allegato: il modello propone, il classificatore
 * lessicale controlla, il codice decide. Immagini solo da WhatsApp e solo
 * se non minuscole (loghi/firme). Un allegato «altro» non finisce mai nel
 * fascicolo da solo.
 */
export function pianificaAllegati(input: {
  comunicazione: Comunicazione;
  allegati: readonly AllegatoPerAnalisi[];
  analisi: EsitoAnalisi;
}): PianoAllegato[] {
  const { comunicazione } = input;
  return input.allegati.map(a => {
    const modello = input.analisi.allegati.find(x => x.indice === a.indice);
    const lessicale = classificaAllegatoComunicazione({
      nome: a.nome,
      mimeType: a.mimeType,
      oggetto: comunicazione.oggetto,
      testo: a.testo,
    });
    const tipo: DocTipo = modello?.tipo ?? lessicale.tipo;
    const immagine = MIME_IMMAGINE.test(a.mimeType);
    const documento = MIME_DOCUMENTO.test(a.mimeType);
    let archiviare = false;
    let motivo = "";
    if (immagine) {
      const fotoCantiere =
        comunicazione.canale === "whatsapp" &&
        a.size >= IMMAGINE_MINIMA_BYTE &&
        (tipo === "foto" || modello?.archiviareSecondoModello === true);
      archiviare = fotoCantiere;
      motivo = fotoCantiere
        ? "Foto da conversazione WhatsApp collegata alla commessa."
        : a.size < IMMAGINE_MINIMA_BYTE
          ? "Immagine piccola (logo/firma/icona): non archiviata."
          : "Immagine da email: si archivia solo su richiesta.";
    } else if (documento) {
      const concordi = modello ? modello.tipo === lessicale.tipo : false;
      const tipoForte = TIPI_ARCHIVIABILI.has(tipo);
      const modelloDeciso =
        modello?.archiviareSecondoModello === true && modello.confidenza === "alta";
      const lessicaleDeciso = lessicale.confidenza === "alta" && TIPI_ARCHIVIABILI.has(lessicale.tipo);
      archiviare = tipoForte && (concordi || modelloDeciso || lessicaleDeciso);
      motivo = archiviare
        ? `Riconosciuto come ${tipo}${concordi ? " (modello e regole concordi)" : modelloDeciso ? " (modello, confidenza alta)" : " (regole, confidenza alta)"}.`
        : tipoForte
          ? `Tipo ${tipo} incerto: modello e regole non concordano.`
          : `Tipo «${tipo}»: non è un documento del fascicolo.`;
    } else {
      motivo = `Formato ${a.mimeType || "sconosciuto"}: non archiviato automaticamente.`;
    }
    return {
      indice: a.indice,
      nome: a.nome,
      tipo,
      confidenza: modello?.confidenza ?? lessicale.confidenza,
      archiviare,
      motivo: modello?.motivo ? `${motivo} ${modello.motivo}`.trim() : motivo,
    };
  });
}

/** Sotto questo punteggio un candidato non regge da solo un collegamento automatico. */
export const PUNTEGGIO_MINIMO_SICURO = 30;
/** Un secondo candidato commessa entro questo margine rende il caso ambiguo. */
export const MARGINE_SICURO = 20;

/**
 * Collegamento sicuro senza verdetto deterministico (Tars libero, 02/09
 * sera): il modello indica una COMMESSA con confidenza alta e quella
 * commessa è l'unico candidato commessa, oppure stacca nettamente il
 * secondo. Le ambiguità (due commesse dello stesso cliente) e le commesse
 * archiviate restano proposte. Le prime proposte reali erano «unica
 * commessa candidata», «unica commessa attiva della cliente»: chiedere un
 * click era inutile, e la direzione lo ha detto.
 */
export function collegamentoSicuroDalModello(
  collegamento: EsitoAnalisi["collegamento"],
  lista: readonly CandidatoCollegamento[],
  leggiCommessa: (
    commessaId: number
  ) => { id: number; clienteId: number | null; archivedAt: Date | string | null } | null
): { commessaId: number; clienteId: number | null; motivo: string } | null {
  if (!collegamento || collegamento.tipo !== "commessa" || collegamento.confidenza !== "alta") {
    return null;
  }
  const commesse = [...lista]
    .filter(c => c.tipo === "commessa")
    .sort((a, b) => b.punteggio - a.punteggio);
  const scelto = commesse.find(c => c.id === collegamento.id);
  if (!scelto || scelto.punteggio < PUNTEGGIO_MINIMO_SICURO) return null;
  const rivale = commesse.find(c => c.id !== scelto.id);
  if (rivale && rivale.punteggio >= scelto.punteggio - MARGINE_SICURO) return null;
  const commessa = leggiCommessa(scelto.id);
  if (!commessa || commessa.archivedAt) return null;
  return {
    commessaId: commessa.id,
    clienteId: commessa.clienteId,
    motivo: `${collegamento.motivo} (candidato unico verificato)`,
  };
}

async function archiviaPianificati(input: {
  comunicazione: Comunicazione;
  commessaId: number;
  piano: readonly PianoAllegato[];
  nota: string;
  createdBy: number | null;
  deps: DipendenzeApplica;
}): Promise<{
  archiviati: EsitoSmistamento["archiviati"];
  avvertenze: string[];
}> {
  const archiviati: EsitoSmistamento["archiviati"] = [];
  const avvertenze: string[] = [];
  for (const voce of input.piano) {
    if (!voce.archiviare) continue;
    const esistente = input.deps.documentoEsistente(
      input.comunicazione.sedeId,
      input.comunicazione.id,
      voce.indice
    );
    if (esistente) {
      archiviati.push({ indice: voce.indice, documentoId: esistente.id, tipo: esistente.tipo });
      continue;
    }
    try {
      const raw = await input.deps.leggiRaw(input.comunicazione, voce.indice);
      const documento = await input.deps.archivia({
        sedeId: input.comunicazione.sedeId,
        comunicazioneId: input.comunicazione.id,
        allegatoIndex: voce.indice,
        commessaId: input.commessaId,
        nome: raw.nome,
        tipo: voce.tipo,
        note: input.nota,
        mimeType: raw.mimeType,
        buffer: raw.buffer,
        createdBy: input.createdBy,
        vietaRiassegnazione: true,
      });
      // Byte identici già nel fascicolo (altra mail, upload a mano): il
      // dominio restituisce il documento esistente senza duplicarlo.
      const attesoSuffisso = `:${input.comunicazione.id}:${voce.indice}`;
      if (
        documento.source !== "comunicazione" ||
        !String(documento.sourceRef ?? "").endsWith(attesoSuffisso)
      ) {
        avvertenze.push(
          `Allegato «${voce.nome}» già presente nel fascicolo (documento #${documento.id}): non duplicato.`
        );
      }
      archiviati.push({ indice: voce.indice, documentoId: documento.id, tipo: documento.tipo });
    } catch (errore) {
      avvertenze.push(
        `Allegato «${voce.nome}» non archiviato: ${errore instanceof Error ? errore.message.slice(0, 160) : "errore"}`
      );
    }
  }
  return { archiviati, avvertenze };
}

export type EsitoApplica = {
  esito: EsitoSmistamento;
  propostaStato: StatoProposta;
};

/**
 * Applica l'esito a una comunicazione appena smistata. Ordine: collega
 * (solo certo) → archivia (solo se collegata) → triage → proposta.
 */
export async function applicaSmistamento(input: {
  comunicazione: Comunicazione;
  candidati: EsitoCandidati;
  analisi: EsitoAnalisi;
  allegati: readonly AllegatoPerAnalisi[];
  deps?: DipendenzeApplica;
}): Promise<EsitoApplica> {
  const deps = input.deps ?? DIPENDENZE_APPLICA_REALI;
  const { comunicazione, candidati, analisi } = input;
  const avvertenze = [...analisi.avvertenze];

  // 1. Collegamento.
  let commessaCollegata: number | null = comunicazione.commessaId ?? null;
  let clienteCollegato: number | null = comunicazione.clienteId ?? null;
  let collegamento: EsitoSmistamento["collegamento"];
  let propostaStato: StatoProposta = "nessuna";
  // Verdetto deterministico (codice nel testo, filo già collegato…) oppure
  // collegamento sicuro dal modello (confidenza alta + candidato senza rivali).
  const verdetto =
    candidati.certo ??
    (commessaCollegata == null
      ? collegamentoSicuroDalModello(analisi.collegamento, candidati.candidati, id =>
          deps.leggiCommessa(id, comunicazione.sedeId)
        )
      : null);
  if (verdetto) {
    if (commessaCollegata == null) {
      const fatto = await deps.collegaAutomatico(comunicazione.id, comunicazione.sedeId, {
        clienteId: verdetto.clienteId,
        commessaId: verdetto.commessaId,
        motivo: `Smistamento Tars: ${verdetto.motivo}`,
      });
      if (fatto) {
        commessaCollegata = verdetto.commessaId;
        clienteCollegato = verdetto.clienteId ?? clienteCollegato;
      } else {
        avvertenze.push("Collegamento certo non applicato: la comunicazione risultava già collegata.");
      }
    }
    collegamento = {
      esito: "certo",
      commessaId: commessaCollegata,
      clienteId: clienteCollegato,
      confidenza: "alta",
      motivo: verdetto.motivo,
    };
  } else if (analisi.collegamento && commessaCollegata == null) {
    const proposto = analisi.collegamento;
    // Un cliente già agganciato non si ripropone; una commessa sì. Una
    // confidenza «bassa» non diventa una proposta: chi decide riceve solo
    // ciò che il modello sostiene davvero (prime proposte reali: una
    // proposta a confidenza bassa col motivo che la contraddiceva).
    // Un candidato SOLO cliente (senza commessa) a confidenza media è
    // rumore (riesame 02/09 sera: «il riferimento contiene il cognome
    // Baldacci, coerente con il cliente candidato»): si propone solo se alta.
    const inutile =
      (proposto.tipo === "cliente" && clienteCollegato === proposto.id) ||
      proposto.confidenza === "bassa" ||
      (proposto.tipo === "cliente" && proposto.confidenza !== "alta");
    if (inutile) {
      collegamento = {
        esito: "nessuno",
        commessaId: null,
        clienteId: clienteCollegato,
        confidenza: "bassa",
        motivo:
          proposto.confidenza === "bassa"
            ? `Indizio debole, nessuna proposta: ${proposto.motivo}`
            : "Cliente già collegato; nessuna commessa individuabile.",
      };
    } else {
      collegamento = {
        esito: "proposto",
        commessaId: proposto.tipo === "commessa" ? proposto.id : null,
        clienteId:
          proposto.tipo === "cliente"
            ? proposto.id
            : candidati.candidati.find(c => c.tipo === "cliente")?.id ?? clienteCollegato,
        confidenza: proposto.confidenza,
        motivo: proposto.motivo,
      };
      propostaStato = "aperta";
    }
  } else {
    collegamento = {
      esito: commessaCollegata != null ? "certo" : "nessuno",
      commessaId: commessaCollegata,
      clienteId: clienteCollegato,
      confidenza: commessaCollegata != null ? "alta" : "bassa",
      motivo:
        commessaCollegata != null
          ? comunicazione.matchMotivo ?? "Già collegata."
          : "Nessun candidato sostenuto dal contenuto.",
    };
  }

  // 2. Allegati: piano sempre, archiviazione solo con commessa collegata.
  const piano = pianificaAllegati({ comunicazione, allegati: input.allegati, analisi });
  let archiviati: EsitoSmistamento["archiviati"] = [];
  if (commessaCollegata != null && piano.some(p => p.archiviare)) {
    const esito = await archiviaPianificati({
      comunicazione,
      commessaId: commessaCollegata,
      piano,
      nota: `Archiviato automaticamente da Tars (smistamento): ${collegamento.motivo}`.slice(0, 300),
      createdBy: null,
      deps,
    });
    archiviati = esito.archiviati;
    avvertenze.push(...esito.avvertenze);
  }

  // 3. Triage sulle colonne della comunicazione (lette dalla UI).
  const esito: EsitoSmistamento = {
    versione: VERSIONE_SMISTAMENTO,
    fonte: analisi.fonte,
    modello: analisi.modello,
    categoria: analisi.categoria,
    urgenza: analisi.urgenza,
    riepilogo: analisi.riepilogo,
    richiedeRisposta: analisi.richiedeRisposta,
    azioneSuggerita:
      propostaStato === "aperta" ? "collega" : analisi.azioneSuggerita,
    istruzione: analisi.istruzione,
    collegamento,
    allegati: piano,
    archiviati,
    candidati: candidati.candidati,
    segnali: candidati.segnali,
  };
  await deps.classifica(comunicazione.id, comunicazione.sedeId, {
    categoria: esito.categoria,
    motivo: `Smistamento Tars (${esito.fonte}): ${esito.riepilogo}`.slice(0, 300),
    fonte: "tars",
    score: esito.fonte === "modello" ? 90 : 60,
  });
  await deps.salvaEsito(comunicazione.id, comunicazione.sedeId, {
    riepilogo: esito.riepilogo,
    istruzione: istruzioneCompleta(esito, avvertenze),
  });
  return { esito, propostaStato };
}

function istruzioneCompleta(esito: EsitoSmistamento, avvertenze: string[]): string {
  const parti = [esito.istruzione];
  if (esito.collegamento.esito === "proposto") {
    parti.push(`Proposta: ${esito.collegamento.motivo}`);
  }
  if (esito.archiviati.length > 0) {
    parti.push(`Archiviati nel fascicolo: ${esito.archiviati.length} allegati.`);
  }
  if (avvertenze.length > 0) parti.push(avvertenze.join(" "));
  return parti.filter(Boolean).join(" ").slice(0, 900);
}

/**
 * Approvazione umana della proposta: collega (atto umano ⇒ gestita) e
 * archivia gli allegati pianificati. Chi chiama ha già verificato
 * capability, sede e stato «aperta» del record.
 */
export async function applicaPropostaApprovata(input: {
  comunicazione: Comunicazione;
  esito: EsitoSmistamento;
  utente: { id: number; nome: string };
  deps?: DipendenzeApplica;
}): Promise<{ esito: EsitoSmistamento; avvertenze: string[] }> {
  const deps = input.deps ?? DIPENDENZE_APPLICA_REALI;
  const { comunicazione, esito } = input;
  const commessaId = esito.collegamento.commessaId;
  const clienteId = esito.collegamento.clienteId ?? comunicazione.clienteId ?? null;
  await deps.collegaManuale(comunicazione.id, comunicazione.sedeId, {
    clienteId,
    commessaId,
    confidenza: "alta",
    motivo: `Collegamento proposto da Tars, approvato da ${input.utente.nome}.`,
  });
  let archiviati = esito.archiviati;
  const avvertenze: string[] = [];
  if (commessaId != null && esito.allegati.some(a => a.archiviare)) {
    const risultato = await archiviaPianificati({
      comunicazione,
      commessaId,
      piano: esito.allegati,
      nota: `Archiviato da Tars su approvazione di ${input.utente.nome}: ${esito.collegamento.motivo}`.slice(0, 300),
      createdBy: input.utente.id,
      deps,
    });
    archiviati = risultato.archiviati;
    avvertenze.push(...risultato.avvertenze);
  }
  return {
    esito: {
      ...esito,
      collegamento: { ...esito.collegamento, esito: "certo", commessaId, clienteId },
      archiviati,
      azioneSuggerita: "nessuna",
    },
    avvertenze,
  };
}
