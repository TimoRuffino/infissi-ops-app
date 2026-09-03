// Leggere DAVVERO una conferma d'ordine allegata a una mail (direzione
// 03/09/2026: «Tars deve leggere e capire le conf. ordine»).
//
// Il detector `confermeMancanti` lavora sui NOMI dei file: è veloce e gira
// su tutta la sede. Qui si apre il documento — testo del PDF, OCR quando
// il PDF è scansionato — e si estrae il contenuto: fornitore, riferimento
// d'ordine, codici commessa citati, date di consegna e soprattutto
// l'IMPONIBILE, che è il costo del margine.
//
// Serve a decidere: se il documento cita il codice della commessa, il
// dubbio del nome file si scioglie e l'archiviazione diventa certa.
//
// Costoso (l'OCR può durare minuti): si chiama su UN allegato per volta,
// mai in massa e mai dalla fotografia giornaliera.

import { leggiAllegatoRaw } from "../../comunicazioni/allegati";
import type { Comunicazione } from "../../comunicazioni/comunicazioni";
import {
  estraiConfermaOrdine,
  type EstrazioneConferma,
} from "../../documenti/estrazioneConferma";
import { estraiTestoDocumento } from "../../documenti/parserRegistry";

export type LetturaConferma = {
  nomeFile: string;
  mimeType: string;
  /** Come si è ottenuto il testo: utile a spiegare una lettura incerta. */
  fonteTesto: "testo_pdf" | "ocr" | "nessuna";
  pagine: number;
  estrazione: EstrazioneConferma | null;
  /** Il codice commessa atteso compare nel documento? */
  citaLaCommessa: boolean;
  avvertenze: string[];
};

export type DipendenzeLettura = {
  leggiAllegato: (
    comunicazione: Comunicazione,
    allegatoIndex: number
  ) => Promise<{ buffer: Buffer; nome: string; mimeType: string }>;
  /**
   * Testo del documento: il registry sceglie il parser dal mime e ricade
   * DA SOLO sull'OCR locale quando il PDF è una scansione — la stessa
   * pipeline dell'analisi documentale, non una seconda.
   */
  estraiTesto: (
    buffer: Buffer,
    mimeType: string,
    nome: string
  ) => Promise<
    | { pagine: string[]; daOcr: boolean; avvertenze: string[] }
    | { pagine: null; motivo: string }
  >;
};

export function dipendenzeLetturaReali(): DipendenzeLettura {
  return {
    leggiAllegato: (comunicazione, allegatoIndex) =>
      leggiAllegatoRaw(comunicazione, allegatoIndex),
    estraiTesto: async (buffer, mimeType, nome) => {
      const esito = await estraiTestoDocumento(buffer, mimeType, nome);
      if (esito.esito === "estratto") {
        return {
          pagine: esito.pagine,
          daOcr: esito.ocr != null,
          avvertenze: esito.avvertenze ?? [],
        };
      }
      return {
        pagine: null,
        motivo:
          esito.esito === "scansione_senza_testo"
            ? (esito.motivo ??
              "PDF scansionato e OCR non riuscito: il contenuto non è stato compreso.")
            : "motivo" in esito
              ? esito.motivo
              : "Documento non supportato.",
      };
    },
  };
}

export async function leggiConfermaAllegata(input: {
  comunicazione: Comunicazione;
  allegatoIndex: number;
  codiceCommessa?: string | null;
  fornitoreAtteso?: string | null;
  deps?: DipendenzeLettura;
}): Promise<LetturaConferma> {
  const deps = input.deps ?? dipendenzeLetturaReali();
  const avvertenze: string[] = [];
  const raw = await deps.leggiAllegato(input.comunicazione, input.allegatoIndex);

  const testo = await deps.estraiTesto(raw.buffer, raw.mimeType, raw.nome);
  if (testo.pagine == null) {
    return {
      nomeFile: raw.nome,
      mimeType: raw.mimeType,
      fonteTesto: "nessuna",
      pagine: 0,
      estrazione: null,
      citaLaCommessa: false,
      avvertenze: [
        `${testo.motivo} Apri il file e registra i dati a mano.`,
      ],
    };
  }
  const pagine = testo.pagine;
  const fonteTesto: LetturaConferma["fonteTesto"] = testo.daOcr
    ? "ocr"
    : "testo_pdf";
  avvertenze.push(...testo.avvertenze);
  if (testo.daOcr) {
    avvertenze.push(
      "PDF scansionato: testo ricostruito con OCR, verifica gli importi prima di registrarli."
    );
  }

  const estrazione = estraiConfermaOrdine(pagine, {
    codiceOrdine: null,
    fornitoreNome: input.fornitoreAtteso ?? null,
    righeOrdine: [],
  });

  const codice = input.codiceCommessa?.trim().toLowerCase() ?? null;
  const citaLaCommessa = codice
    ? estrazione.codiciCommessaCitati.some(
        c => c.valore.trim().toLowerCase() === codice
      ) || pagine.join(" ").toLowerCase().includes(codice)
    : false;

  if (!estrazione.imponibileDocumento && estrazione.totaleDocumento) {
    avvertenze.push(
      "Il documento dichiara un totale ma non l'imponibile: il costo del margine va confermato a mano (l'IVA non si scorpora per stima)."
    );
  }

  return {
    nomeFile: raw.nome,
    mimeType: raw.mimeType,
    fonteTesto,
    pagine: pagine.length,
    estrazione,
    citaLaCommessa,
    avvertenze,
  };
}
