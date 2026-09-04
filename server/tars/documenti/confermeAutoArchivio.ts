// Le conferme d'ordine CERTE si archiviano da sole (direzione 03/09/2026:
// «se è sicuro può collegarle in automatico come nel caso di Tesconi, se
// ha dubbi deve chiedere conferma»; e la sera: «vale per tutte le commesse
// da Da ordinare in poi, quindi vanno cercate e collegate anche se in stati
// successivi»).
//
// Certa = la mail è GIÀ collegata a quella commessa (da una persona, o dallo
// smistamento con confidenza alta), il file si dichiara conferma d'ordine
// nel nome E — dalla notte del 04/09, caso Giacomazzi — il TESTO del
// documento cita la commessa (codice, cliente, indirizzo, ordine noto) e
// non è la copia di una conferma già nel fascicolo. Dal pomeriggio del
// 04/09 («le conferme ordine sono ferme») è certa anche la conferma di una
// mail NON collegata a niente, quando il suo testo cita QUESTA commessa e
// nessun'altra: allora si archivia e la mail viene collegata. Non è
// un'opinione del modello: sono le regole di `confermeMancanti.ts`,
// `ricercaCommessaNelDocumento.ts` e `verificaConfermaPerFascicolo`.
// Tutto il resto resta una proposta, dove decide una persona.
//
// Archiviare la conferma fa nascere costo e merce (regola del fascicolo):
// da qui in poi non serve altro. Ogni archiviazione porta `origine:
// "automatico"` e finisce nel registro delle conferme.

import {
  collegaAutomaticoComunicazione,
  getLiveComunicazione,
} from "../../comunicazioni/comunicazioni";
import { leggiAllegatoRaw } from "../../comunicazioni/allegati";
import { verificaConfermaPerFascicolo } from "../../commesse/costoDaConferma";
import { archiviaAllegatoComunicazione } from "../../routers/preventiviContratti";
import { getCommessaById } from "../../routers/commesse";
import { getSediStore } from "../../routers/sedi";
import { dipendenzeConfermeReali } from "../strumenti/ricerca";
import {
  confermeOrdineMancanti,
  type CandidatoConferma,
  type DipendenzeConfermeMancanti,
} from "./confermeMancanti";

const RITARDO_BOOT_MS = 45_000;
const INTERVALLO_MS = 10 * 60_000;
export const ARCHIVIAZIONI_PER_GIRO = 10;
/** Utente di sistema dei worker (stesso dello smistamento e dell'analisi). */
const UTENTE_SISTEMA = 0;
/** Quanti file NUOVI leggere per giro (scansioni comprese, con il modello). */
const LETTURE_PER_GIRO = 8;

export type DipendenzeAutoArchivio = {
  conferme: DipendenzeConfermeMancanti;
  leggiRaw: typeof leggiAllegatoRaw;
  getComunicazione: typeof getLiveComunicazione;
  archivia: typeof archiviaAllegatoComunicazione;
  /** Il testo deve citare la commessa e non essere una copia. */
  verifica: typeof verificaConfermaPerFascicolo;
  /** La mail di una conferma trovata dal testo viene collegata alla commessa. */
  collega: typeof collegaAutomaticoComunicazione;
  commessa: (commessaId: number) => any | null;
  /** Identità con cui il worker paga le letture visive; null = solo OCR. */
  visione: { sedeId: number; utenteId: number } | null;
};

export function dipendenzeAutoArchivioReali(sedeId: number): DipendenzeAutoArchivio {
  const visione = { sedeId, utenteId: UTENTE_SISTEMA };
  return {
    conferme: dipendenzeConfermeReali({ visione, massimoLetture: LETTURE_PER_GIRO }),
    leggiRaw: leggiAllegatoRaw,
    getComunicazione: getLiveComunicazione,
    archivia: archiviaAllegatoComunicazione,
    verifica: verificaConfermaPerFascicolo,
    collega: collegaAutomaticoComunicazione,
    commessa: commessaId => getCommessaById(commessaId) ?? null,
    visione,
  };
}

export type EsitoGiroAutoArchivio = {
  commesseEsaminate: number;
  archiviate: number;
  /** Candidati certi dal nome ma non dal testo: lasciati alla proposta. */
  saltate: number;
  errori: number;
  /** Mail collegate alla commessa perché il testo della conferma la citava. */
  collegate: number;
  /** Cosa ha visto la ricerca: quanti candidati, e cosa dice il loro testo. */
  candidati: { certe: number; probabili: number; nonLetti: number; nonLeggibili: number };
  dettagli: Array<{
    commessaId: number;
    codice: string | null;
    nomeFile: string;
    esito: "archiviata" | "saltata" | "errore";
    motivo: string | null;
    documentoId: number | null;
  }>;
};

export const NOTA_AUTO_ARCHIVIO =
  "Archiviata automaticamente: la mail è collegata a questa commessa e il file si dichiara conferma d'ordine.";
export const NOTA_AUTO_ARCHIVIO_DAL_TESTO =
  "Archiviata automaticamente: il testo della conferma cita questa commessa e nessun'altra.";

export async function eseguiGiroAutoArchivio(input: {
  sedeId: number;
  deps?: DipendenzeAutoArchivio;
  limite?: number;
}): Promise<EsitoGiroAutoArchivio> {
  const deps = input.deps ?? dipendenzeAutoArchivioReali(input.sedeId);
  const limite = input.limite ?? ARCHIVIAZIONI_PER_GIRO;
  const esito: EsitoGiroAutoArchivio = {
    commesseEsaminate: 0,
    archiviate: 0,
    saltate: 0,
    errori: 0,
    collegate: 0,
    candidati: { certe: 0, probabili: 0, nonLetti: 0, nonLeggibili: 0 },
    dettagli: [],
  };
  const righe = await confermeOrdineMancanti({
    sedeId: input.sedeId,
    deps: deps.conferme,
    limite: 200,
  });
  for (const riga of righe) {
    esito.commesseEsaminate += 1;
    for (const c of riga.candidati) {
      if (c.certezza === "certa") esito.candidati.certe += 1;
      else esito.candidati.probabili += 1;
      if (c.riscontroTesto === "non_letto") esito.candidati.nonLetti += 1;
      if (c.riscontroTesto === "non_leggibile") esito.candidati.nonLeggibili += 1;
    }
    const certe = riga.candidati.filter(c => c.certezza === "certa");
    if (certe.length === 0) continue;
    // Più conferme certe sulla stessa commessa (più fornitori): tutte, una
    // per allegato; lo stesso allegato non si archivia due volte grazie al
    // sourceRef, e una copia dello stesso ordine si ferma alla verifica.
    for (const candidato of certe) {
      if (esito.archiviate >= limite) return esito;
      const fatto = await archiviaCandidato(input.sedeId, riga.commessaId, candidato, deps);
      esito.dettagli.push({
        commessaId: riga.commessaId,
        codice: riga.codice,
        nomeFile: candidato.nomeFile,
        ...fatto,
      });
      if (fatto.esito === "archiviata") esito.archiviate += 1;
      else if (fatto.esito === "saltata") esito.saltate += 1;
      else esito.errori += 1;
      if (fatto.collegata) esito.collegate += 1;
    }
  }
  return esito;
}

async function archiviaCandidato(
  sedeId: number,
  commessaId: number,
  candidato: CandidatoConferma,
  deps: DipendenzeAutoArchivio
): Promise<{
  esito: "archiviata" | "saltata" | "errore";
  motivo: string | null;
  documentoId: number | null;
  collegata: boolean;
}> {
  try {
    const comunicazione = await deps.getComunicazione(candidato.comunicazioneId, sedeId);
    if (!comunicazione) {
      return { esito: "errore", motivo: "Comunicazione non più disponibile.", documentoId: null, collegata: false };
    }
    // La certezza vale al momento dell'archiviazione, non a quello della
    // ricerca: la mail deve essere ANCORA collegata a questa commessa,
    // oppure a nessuna se la certezza viene dal testo del file.
    const dalTesto = candidato.riscontroTesto === "cita";
    if (comunicazione.commessaId !== commessaId && !(dalTesto && comunicazione.commessaId == null)) {
      return {
        esito: "errore",
        motivo: "La mail non è più collegata a questa commessa.",
        documentoId: null,
        collegata: false,
      };
    }
    const raw = await deps.leggiRaw(comunicazione, candidato.allegatoIndex);
    // Il testo lo ha già letto la ricerca (memoria di dodici ore): la
    // verifica lo riusa; se manca, rilegge con OCR e — con l'identità del
    // worker — con il modello: una scansione non ferma la conferma.
    const pagine = deps.conferme.leggiCommessaNelDocumento
      ? (await deps.conferme.leggiCommessaNelDocumento(comunicazione, candidato.allegatoIndex, [])).pagine
      : null;
    const verifica = await deps.verifica({
      commessaId,
      nomeFile: raw.nome,
      mimeType: raw.mimeType,
      buffer: raw.buffer,
      pagine,
      lettura: { visione: deps.visione },
    });
    if (!verifica.ok) {
      return { esito: "saltata", motivo: verifica.motivo, documentoId: null, collegata: false };
    }
    const nota = dalTesto && comunicazione.commessaId == null ? NOTA_AUTO_ARCHIVIO_DAL_TESTO : NOTA_AUTO_ARCHIVIO;
    const documento = await deps.archivia({
      sedeId,
      comunicazioneId: candidato.comunicazioneId,
      allegatoIndex: candidato.allegatoIndex,
      commessaId,
      nome: raw.nome,
      tipo: "conferma_ordine",
      mimeType: raw.mimeType,
      buffer: raw.buffer,
      createdBy: null,
      note: `${nota} ${verifica.motivo}`.slice(0, 300),
      vietaRiassegnazione: true,
      origine: "automatico",
    });
    // La mail «di nessuno» ora è di questa commessa: si vede nei Messaggi
    // e nella scheda, con il motivo scritto.
    let collegata = false;
    if (comunicazione.commessaId == null) {
      const commessa = deps.commessa(commessaId);
      collegata = await deps.collega(comunicazione.id, sedeId, {
        clienteId: commessa?.clienteId ?? null,
        commessaId,
        motivo: `Conferma d'ordine archiviata da Tars: ${verifica.motivo}`.slice(0, 300),
      });
    }
    return { esito: "archiviata", motivo: verifica.motivo, documentoId: documento.id, collegata };
  } catch (errore) {
    return {
      esito: "errore",
      motivo: errore instanceof Error ? errore.message.slice(0, 200) : "errore sconosciuto",
      documentoId: null,
      collegata: false,
    };
  }
}

export function autoArchivioAttivo(): boolean {
  return (process.env.CONFERME_AUTO_ARCHIVIO ?? "on").trim().toLowerCase() !== "off";
}

const inCorso = new Set<number>();

async function giroTutteLeSedi(): Promise<void> {
  for (const sede of getSediStore()) {
    if (!sede.attiva || inCorso.has(sede.id)) continue;
    inCorso.add(sede.id);
    try {
      const esito = await eseguiGiroAutoArchivio({ sedeId: sede.id });
      const candidati = esito.candidati.certe + esito.candidati.probabili;
      // Anche un giro senza effetti dice cosa ha visto: «se non l'ha
      // trovata deve dirmelo» vale pure per i log.
      if (esito.archiviate > 0 || esito.errori > 0 || esito.saltate > 0 || candidati > 0) {
        console.info("[conferme-auto-archivio] giro", {
          sedeId: sede.id,
          commesseEsaminate: esito.commesseEsaminate,
          candidati: esito.candidati,
          archiviate: esito.archiviate,
          collegate: esito.collegate,
          saltate: esito.saltate,
          errori: esito.errori,
          dettagli: esito.dettagli.map(d => ({
            commessa: d.codice ?? d.commessaId,
            file: d.nomeFile,
            esito: d.esito,
            motivo: d.motivo,
          })),
        });
      }
    } catch (errore) {
      console.error("[conferme-auto-archivio] giro fallito", {
        sedeId: sede.id,
        message: errore instanceof Error ? errore.message : "unknown",
      });
    } finally {
      inCorso.delete(sede.id);
    }
  }
}

export function startConfermeAutoArchivioWorker(): void {
  if (!autoArchivioAttivo()) {
    console.info("[conferme-auto-archivio] spento (CONFERME_AUTO_ARCHIVIO=off)");
    return;
  }
  const boot = setTimeout(() => void giroTutteLeSedi(), RITARDO_BOOT_MS);
  boot.unref?.();
  const timer = setInterval(() => void giroTutteLeSedi(), INTERVALLO_MS);
  timer.unref?.();
  console.info("[conferme-auto-archivio] attivo", {
    intervalloMs: INTERVALLO_MS,
    perGiro: ARCHIVIAZIONI_PER_GIRO,
    letturePerGiro: LETTURE_PER_GIRO,
  });
}
