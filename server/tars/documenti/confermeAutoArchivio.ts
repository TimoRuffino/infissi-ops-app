// Le conferme d'ordine CERTE si archiviano da sole (direzione 03/09/2026:
// «se è sicuro può collegarle in automatico come nel caso di Tesconi, se
// ha dubbi deve chiedere conferma»; e la sera: «vale per tutte le commesse
// da Da ordinare in poi, quindi vanno cercate e collegate anche se in stati
// successivi»).
//
// Certa = la mail è GIÀ collegata a quella commessa (da una persona, o dallo
// smistamento con confidenza alta) e il file si dichiara conferma d'ordine
// nel nome. Non è un'opinione del modello: è la regola di
// `confermeMancanti.ts`. Tutto il resto («probabile») resta una proposta
// nella Situazione di Tars, dove decide una persona.
//
// Archiviare la conferma fa nascere costo e merce (regola del fascicolo):
// da qui in poi non serve altro. Ogni archiviazione porta `origine:
// "automatico"` e finisce nel registro delle conferme.

import { getLiveComunicazione } from "../../comunicazioni/comunicazioni";
import { leggiAllegatoRaw } from "../../comunicazioni/allegati";
import { archiviaAllegatoComunicazione } from "../../routers/preventiviContratti";
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

export type DipendenzeAutoArchivio = {
  conferme: DipendenzeConfermeMancanti;
  leggiRaw: typeof leggiAllegatoRaw;
  getComunicazione: typeof getLiveComunicazione;
  archivia: typeof archiviaAllegatoComunicazione;
};

export function dipendenzeAutoArchivioReali(): DipendenzeAutoArchivio {
  return {
    conferme: dipendenzeConfermeReali(),
    leggiRaw: leggiAllegatoRaw,
    getComunicazione: getLiveComunicazione,
    archivia: archiviaAllegatoComunicazione,
  };
}

export type EsitoGiroAutoArchivio = {
  commesseEsaminate: number;
  archiviate: number;
  saltate: number;
  errori: number;
  dettagli: Array<{
    commessaId: number;
    codice: string | null;
    nomeFile: string;
    esito: "archiviata" | "errore";
    motivo: string | null;
    documentoId: number | null;
  }>;
};

export const NOTA_AUTO_ARCHIVIO =
  "Archiviata automaticamente: la mail è collegata a questa commessa e il file si dichiara conferma d'ordine.";

export async function eseguiGiroAutoArchivio(input: {
  sedeId: number;
  deps?: DipendenzeAutoArchivio;
  limite?: number;
}): Promise<EsitoGiroAutoArchivio> {
  const deps = input.deps ?? dipendenzeAutoArchivioReali();
  const limite = input.limite ?? ARCHIVIAZIONI_PER_GIRO;
  const esito: EsitoGiroAutoArchivio = {
    commesseEsaminate: 0,
    archiviate: 0,
    saltate: 0,
    errori: 0,
    dettagli: [],
  };
  const righe = await confermeOrdineMancanti({
    sedeId: input.sedeId,
    deps: deps.conferme,
    limite: 200,
  });
  for (const riga of righe) {
    esito.commesseEsaminate += 1;
    const certe = riga.candidati.filter(c => c.certezza === "certa");
    if (certe.length === 0) continue;
    // Più conferme certe sulla stessa commessa (più fornitori): tutte, una
    // per allegato; lo stesso allegato non si archivia due volte grazie al
    // sourceRef.
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
      else esito.errori += 1;
    }
  }
  return esito;
}

async function archiviaCandidato(
  sedeId: number,
  commessaId: number,
  candidato: CandidatoConferma,
  deps: DipendenzeAutoArchivio
): Promise<{ esito: "archiviata" | "errore"; motivo: string | null; documentoId: number | null }> {
  try {
    const comunicazione = await deps.getComunicazione(candidato.comunicazioneId, sedeId);
    if (!comunicazione) {
      return { esito: "errore", motivo: "Comunicazione non più disponibile.", documentoId: null };
    }
    // La mail deve essere ANCORA collegata a questa commessa: la certezza
    // vale al momento dell'archiviazione, non a quello della ricerca.
    if (comunicazione.commessaId !== commessaId) {
      return {
        esito: "errore",
        motivo: "La mail non è più collegata a questa commessa.",
        documentoId: null,
      };
    }
    const documento = await deps.archivia({
      sedeId,
      comunicazioneId: candidato.comunicazioneId,
      allegatoIndex: candidato.allegatoIndex,
      commessaId,
      nome: candidato.nomeFile,
      tipo: "conferma_ordine",
      mimeType: candidato.mimeType,
      buffer: async () => (await deps.leggiRaw(comunicazione, candidato.allegatoIndex)).buffer,
      createdBy: null,
      note: NOTA_AUTO_ARCHIVIO,
      vietaRiassegnazione: true,
      origine: "automatico",
    });
    return { esito: "archiviata", motivo: null, documentoId: documento.id };
  } catch (errore) {
    return {
      esito: "errore",
      motivo: errore instanceof Error ? errore.message.slice(0, 200) : "errore sconosciuto",
      documentoId: null,
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
      if (esito.archiviate > 0 || esito.errori > 0) {
        console.info("[conferme-auto-archivio] giro", {
          sedeId: sede.id,
          commesseEsaminate: esito.commesseEsaminate,
          archiviate: esito.archiviate,
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
  });
}
