// Leggere DAVVERO una conferma d'ordine allegata a una mail (direzione
// 03/09/2026: «Tars deve leggere e capire le conf. ordine»).
//
// Il detector `confermeMancanti` lavora sui NOMI dei file: è veloce e gira
// su tutta la sede. Qui si apre il documento — testo del PDF, OCR quando
// il PDF è scansionato — e si estrae il contenuto: fornitore, riferimento
// d'ordine, il NOSTRO riferimento riportato dal fornitore, codici commessa
// citati, date di consegna e soprattutto l'IMPONIBILE, che è il costo del
// margine.
//
// Serve a decidere: se il documento cita la commessa — codice, cliente
// (anche troncato: «VS.RIFERIMENTO GIACOMAZZI GIUL»), indirizzo del
// cantiere o un ordine già noto — il dubbio del nome file si scioglie e
// l'archiviazione diventa certa. Lo stesso riscontro che governa lo
// smistamento (04/09/2026: «Tars deve controllare sempre anche il
// riferimento all'interno della conf. ordine»).
//
// Costoso (l'OCR può durare minuti): si chiama su UN allegato per volta,
// mai in massa e mai dalla fotografia giornaliera.

import { leggiAllegatoRaw } from "../../comunicazioni/allegati";
import type { Comunicazione } from "../../comunicazioni/comunicazioni";
import { riferimentiDellaCommessa } from "../../commesse/costoDaConferma";
import {
  estraiConfermeNelDocumento,
  type EstrazioneConferma,
} from "../../documenti/estrazioneConferma";
import type { IdentitaLettura } from "../../documenti/letturaVisiva";
import { estraiTestoDocumento } from "../../documenti/parserRegistry";
import {
  riscontroCommessaNelTesto,
  type RiscontroCommessa,
} from "../../documenti/riscontroCommessa";
import { getCommessaById } from "../../routers/commesse";
import { leggiDocumentoCommessaDaStorage } from "../../routers/preventiviContratti";

export type LetturaConferma = {
  nomeFile: string;
  mimeType: string;
  /** Come si è ottenuto il testo: utile a spiegare una lettura incerta. */
  fonteTesto: "testo_pdf" | "ocr" | "visione" | "nessuna";
  pagine: number;
  estrazione: EstrazioneConferma | null;
  /**
   * Il documento cita la commessa? Non solo il codice: anche il cliente,
   * l'indirizzo del cantiere o un ordine già noto (vedi `riscontro`).
   */
  citaLaCommessa: boolean;
  /** Il riscontro dettagliato, quando una commessa è nota. */
  riscontro: RiscontroCommessa | null;
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
   * pipeline dell'analisi documentale, non una seconda. Con un'identità
   * (`visione`) può chiedere al modello di trascrivere le pagine che l'OCR
   * non legge: è la lettura esplicita di UN file chiesta in chat.
   */
  estraiTesto: (
    buffer: Buffer,
    mimeType: string,
    nome: string,
    visione?: IdentitaLettura | null
  ) => Promise<
    | { pagine: string[]; daOcr: boolean; daVisione?: boolean; avvertenze: string[] }
    | { pagine: null; motivo: string }
  >;
};

export function dipendenzeLetturaReali(): DipendenzeLettura {
  return {
    leggiAllegato: (comunicazione, allegatoIndex) =>
      leggiAllegatoRaw(comunicazione, allegatoIndex),
    estraiTesto: async (buffer, mimeType, nome, visione) => {
      const esito = await estraiTestoDocumento(buffer, mimeType, nome, {
        visione: visione ?? null,
      });
      if (esito.esito === "estratto") {
        return {
          pagine: esito.pagine,
          daOcr: esito.ocr != null,
          daVisione: esito.visione != null,
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

/** Dal testo letto alla lettura: estrazione, riscontro e avvertenze, uguali per allegato e documento. */
function componiLettura(input: {
  raw: { nome: string; mimeType: string };
  testo:
    | { pagine: string[]; daOcr: boolean; daVisione?: boolean; avvertenze: string[] }
    | { pagine: null; motivo: string };
  codiceCommessa: string | null;
  commessa: any | null;
  fornitoreAtteso: string | null;
  numeroOrdineAtteso: string | null;
}): LetturaConferma {
  const { raw, testo } = input;
  if (testo.pagine == null) {
    return {
      nomeFile: raw.nome,
      mimeType: raw.mimeType,
      fonteTesto: "nessuna",
      pagine: 0,
      estrazione: null,
      citaLaCommessa: false,
      riscontro: null,
      avvertenze: [`${testo.motivo} Apri il file e registra i dati a mano.`],
    };
  }
  const pagine = testo.pagine;
  const avvertenze = [...testo.avvertenze];
  if (testo.daVisione) {
    avvertenze.push(
      "Scansione o foto trascritta dal modello: verifica gli importi sul documento prima di registrarli."
    );
  } else if (testo.daOcr) {
    avvertenze.push(
      "PDF scansionato: testo ricostruito con OCR, verifica gli importi prima di registrarli."
    );
  }
  const documentoLetto = estraiConfermeNelDocumento(pagine, {
    codiceOrdine: input.numeroOrdineAtteso,
    fornitoreNome: input.fornitoreAtteso,
    righeOrdine: [],
  });
  const estrazione = documentoLetto.estrazione;
  if (documentoLetto.sezioni.length > 1) {
    avvertenze.push(
      documentoLetto.motivoSomma ??
        `Il file contiene ${documentoLetto.sezioni.length} conferme (${documentoLetto.sezioni
          .map(s => `${s.estrazione.numeroConferma?.valore ?? `pagine ${s.da + 1}-${s.a + 1}`}: ${s.estrazione.imponibileDocumento?.valore?.toFixed(2) ?? "?"}`)
          .join("; ")}): l'imponibile riportato è la somma.`
    );
  }

  // Riscontro pieno quando la commessa è nota; solo il codice altrimenti.
  let riscontro: RiscontroCommessa | null = null;
  const codice = input.codiceCommessa?.trim().toLowerCase() ?? null;
  let citaLaCommessa = codice
    ? estrazione.codiciCommessaCitati.some(c => c.valore.trim().toLowerCase() === codice) ||
      pagine.join(" ").toLowerCase().includes(codice)
    : false;
  if (input.commessa) {
    riscontro = riscontroCommessaNelTesto(pagine, riferimentiDellaCommessa(input.commessa));
    citaLaCommessa = citaLaCommessa || riscontro.ok;
  }

  if (!estrazione.imponibileDocumento && estrazione.totaleDocumento) {
    avvertenze.push(
      "Il documento dichiara un totale ma non l'imponibile: il costo del margine va confermato a mano (l'IVA non si scorpora per stima)."
    );
  }
  if (input.commessa && riscontro && !riscontro.ok) {
    avvertenze.push(
      `${riscontro.motivo} Non archiviarla né registrarne il costo senza che l'utente confermi che è di questa commessa.`
    );
  }

  return {
    nomeFile: raw.nome,
    mimeType: raw.mimeType,
    fonteTesto: testo.daVisione ? "visione" : testo.daOcr ? "ocr" : "testo_pdf",
    pagine: pagine.length,
    estrazione,
    citaLaCommessa,
    riscontro,
    avvertenze,
  };
}

export async function leggiConfermaAllegata(input: {
  comunicazione: Comunicazione;
  allegatoIndex: number;
  codiceCommessa?: string | null;
  /** La commessa per cui si legge (oggetto vivo dello store): abilita il riscontro pieno. */
  commessa?: any | null;
  fornitoreAtteso?: string | null;
  /** Identità per la lettura visiva (chi paga sul ledger); assente = solo OCR. */
  visione?: IdentitaLettura | null;
  deps?: DipendenzeLettura;
}): Promise<LetturaConferma> {
  const deps = input.deps ?? dipendenzeLetturaReali();
  const raw = await deps.leggiAllegato(input.comunicazione, input.allegatoIndex);
  const testo = await deps.estraiTesto(raw.buffer, raw.mimeType, raw.nome, input.visione ?? null);
  return componiLettura({
    raw,
    testo,
    codiceCommessa: input.codiceCommessa ?? input.commessa?.codice ?? null,
    commessa: input.commessa ?? null,
    fornitoreAtteso: input.fornitoreAtteso ?? null,
    numeroOrdineAtteso: null,
  });
}

/**
 * Lo stesso, ma su un documento GIÀ nel fascicolo della commessa: è il caso
 * normale quando la conferma è stata archiviata (a mano o da Tars) e resta
 * da leggerne l'importo per il margine. La commessa è quella del fascicolo.
 */
export async function leggiConfermaDocumento(input: {
  documentoId: number;
  sedeId: number;
  codiceCommessa?: string | null;
  fornitoreAtteso?: string | null;
  numeroOrdineAtteso?: string | null;
  /** Identità per la lettura visiva (chi paga sul ledger); assente = solo OCR. */
  visione?: IdentitaLettura | null;
  deps?: Pick<DipendenzeLettura, "estraiTesto"> & {
    leggiDocumento?: (
      documentoId: number,
      sedeId: number
    ) => Promise<{ buffer: Buffer; nome: string; mimeType: string; commessaId?: number } | null>;
  };
}): Promise<LetturaConferma | null> {
  const estraiTesto =
    input.deps?.estraiTesto ?? dipendenzeLetturaReali().estraiTesto;
  const leggiDocumento =
    input.deps?.leggiDocumento ??
    (async (documentoId: number, sedeId: number) => {
      const letto = await leggiDocumentoCommessaDaStorage(documentoId, sedeId);
      if (!letto) return null;
      return {
        buffer: letto.buffer,
        nome: letto.documento.nome,
        mimeType: letto.documento.mimeType,
        commessaId: letto.documento.commessaId,
      };
    });

  const raw = await leggiDocumento(input.documentoId, input.sedeId);
  if (!raw) return null;
  const commessa: any =
    raw.commessaId != null ? (getCommessaById(raw.commessaId) ?? null) : null;
  const testo = await estraiTesto(raw.buffer, raw.mimeType, raw.nome, input.visione ?? null);
  return componiLettura({
    raw,
    testo,
    codiceCommessa: input.codiceCommessa ?? commessa?.codice ?? null,
    commessa,
    fornitoreAtteso: input.fornitoreAtteso ?? null,
    numeroOrdineAtteso: input.numeroOrdineAtteso ?? null,
  });
}
