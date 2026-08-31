import { createHash } from "node:crypto";
import type { Comunicazione } from "../../comunicazioni/comunicazioni";
import type {
  EsitoParser,
  MetadatiOcr,
} from "../../documenti/parserRegistry";

export const MAX_TESTO_ALLEGATO_TARS = 60_000;
export const MAX_BYTE_ANALISI_ALLEGATO_TARS = 15 * 1024 * 1024;
export const MAX_BYTE_ARCHIVIO_COMUNICAZIONE = 10 * 1024 * 1024;

const MIME_ARCHIVIABILI_DA_COMUNICAZIONE = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

export type PaginaAllegatoTars = {
  numero: number;
  testo: string;
  troncata: boolean;
};

export type LetturaAllegatoTars = {
  metadati: {
    comunicazioneId: number;
    commessaId: number;
    index: number;
    nome: string;
    mimeType: string;
    sizeDichiarata: number;
    sizeEffettiva: number | null;
    storageDisponibile: boolean;
    metadatiImmutabili: true;
  };
  checksumSha256: string | null;
  fingerprintFonte: string | null;
  parser: {
    stato:
      | "estratto"
      | "scansione_senza_testo"
      | "illeggibile"
      | "non_supportato"
      | "non_disponibile";
    nome: string | null;
    versione: string | null;
    motivo: string | null;
    ocr: MetadatiOcr | null;
  };
  pagine: PaginaAllegatoTars[];
  avvertenze: string[];
  archiviazione: {
    stato:
      | "archiviabile"
      | "analizzabile_non_archiviabile"
      | "non_archiviabile";
    blocco: string | null;
  };
  contenutoNonFidato: true;
};

export function fingerprintAllegatoComunicazione(input: {
  comunicazione: Comunicazione;
  allegatoIndex: number;
  nome: string;
  mimeType: string;
  sizeEffettiva: number;
  checksumSha256: string;
}): string {
  const allegato = input.comunicazione.allegati[input.allegatoIndex];
  return `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        sedeId: input.comunicazione.sedeId,
        commessaId: input.comunicazione.commessaId,
        comunicazioneId: input.comunicazione.id,
        messageId: input.comunicazione.messageId,
        receivedAt: input.comunicazione.receivedAt.toISOString(),
        allegatoIndex: input.allegatoIndex,
        nomeDichiarato: allegato?.nome ?? null,
        mimeDichiarato: allegato?.mimeType ?? null,
        sizeDichiarata: allegato?.size ?? null,
        nomeLetto: input.nome,
        mimeLetto: input.mimeType,
        sizeEffettiva: input.sizeEffettiva,
        checksumSha256: input.checksumSha256,
      })
    )
    .digest("hex")}`;
}

export function limitaPagineAllegato(
  pagine: readonly string[],
  massimo = MAX_TESTO_ALLEGATO_TARS
): { pagine: PaginaAllegatoTars[]; troncato: boolean } {
  let residuo = massimo;
  let troncato = false;
  const risultato: PaginaAllegatoTars[] = [];
  for (let index = 0; index < pagine.length; index += 1) {
    const originale = String(pagine[index] ?? "");
    const testo = originale.slice(0, Math.max(0, residuo));
    const paginaTroncata = testo.length < originale.length;
    risultato.push({ numero: index + 1, testo, troncata: paginaTroncata });
    residuo -= testo.length;
    if (paginaTroncata || residuo <= 0) {
      troncato = paginaTroncata || index < pagine.length - 1;
      break;
    }
  }
  return { pagine: risultato, troncato };
}

export function statoArchiviazioneAllegato(
  mimeType: string,
  sizeEffettiva: number
): LetturaAllegatoTars["archiviazione"] {
  if (!MIME_ARCHIVIABILI_DA_COMUNICAZIONE.has(mimeType)) {
    return {
      stato: "non_archiviabile",
      blocco: `Il formato ${mimeType || "sconosciuto"} non è ammesso dal fascicolo per allegati importati da comunicazioni.`,
    };
  }
  if (sizeEffettiva > MAX_BYTE_ANALISI_ALLEGATO_TARS) {
    return {
      stato: "non_archiviabile",
      blocco:
        "Il file supera sia il limite di analisi di 15 MB sia il limite canonico di 10 MB per gli allegati importati da comunicazioni.",
    };
  }
  if (sizeEffettiva > MAX_BYTE_ARCHIVIO_COMUNICAZIONE) {
    return {
      stato: "analizzabile_non_archiviabile",
      blocco:
        "Il file è leggibile entro il limite di analisi di 15 MB, ma supera il limite canonico di 10 MB per gli allegati importati da comunicazioni.",
    };
  }
  return { stato: "archiviabile", blocco: null };
}

export function esitoParserSanitizzato(esito: EsitoParser): Pick<
  LetturaAllegatoTars,
  "parser" | "pagine" | "avvertenze"
> {
  if (esito.esito === "estratto") {
    const limitato = limitaPagineAllegato(esito.pagine);
    return {
      parser: {
        stato: "estratto",
        nome: esito.parser,
        versione: esito.versione,
        motivo: null,
        ocr: esito.ocr ?? null,
      },
      pagine: limitato.pagine,
      avvertenze: [
        ...esito.avvertenze.map(a => String(a).slice(0, 500)),
        ...(limitato.troncato
          ? ["Testo limitato a 60.000 caratteri per questa lettura Tars."]
          : []),
      ],
    };
  }
  if (esito.esito === "non_supportato") {
    return {
      parser: {
        stato: "non_supportato",
        nome: null,
        versione: null,
        motivo: String(esito.motivo).slice(0, 500),
        ocr: null,
      },
      pagine: [],
      avvertenze: [],
    };
  }
  return {
    parser: {
      stato: esito.esito,
      nome: esito.parser,
      versione: esito.versione,
      motivo:
        esito.esito === "illeggibile"
          ? "Documento illeggibile, corrotto o protetto."
          : "Il documento non contiene testo utilizzabile con la configurazione OCR corrente.",
      ocr: null,
    },
    pagine: [],
    avvertenze: [],
  };
}
