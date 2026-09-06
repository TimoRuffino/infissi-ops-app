// Anteprime delle evidenze (06/09/2026, «Dove l'ho letto»): le pagine di un
// documento rese in JPEG e conservate nello storage, così la vignetta può
// mostrare il ritaglio da cui un valore è stato letto senza aprire il file.
//
// Quando si rende: quando i byte sono già in mano — dopo la lettura del
// worker dei costi, della lettura del contratto, dell'analisi D7
// (`scaldaAnteprime`, best-effort, mai un errore per chi legge) — e a
// richiesta per i documenti letti prima (`leggiAnteprima`: la prima
// apertura scarica il file e rende tutte le pagine in un colpo, al massimo
// venti; chiamate concorrenti condividono lo stesso rendering).
//
// Dove si salva: object storage via `putFile`, mai in JSONB; sul documento
// resta solo un metadato piccolo (`Documento.anteprime`: versione, impronta,
// formato, dpi, pagine, chiavi). Le anteprime sono derivate e rigenerabili:
// se mancano si rifanno, se il documento sparisce spariscono con lui.
// Le foto non si rendono: l'immagine è il documento stesso.
//
// Spec: docs/superpowers/specs/2026-09-06-anteprime-evidenze-design.md §4.

import { getFile, putFile } from "../_core/fileStorage";
import { interruttoreAttivo } from "../platform/interruttori";
import {
  getDocumentoCommessaById,
  leggiDocumentoCommessaDaStorage,
  salvaAnteprimeDocumento,
  type Documento,
} from "../routers/preventiviContratti";
import { renderizzaPagine } from "./ocr";

/** Bump quando cambia il modo di rendere (dpi, formato): le vecchie si rifanno. */
export const ANTEPRIME_VERSIONE = 1;
export const ANTEPRIME_DPI = 150;
export const ANTEPRIME_QUALITA = 75;
/** Stesso tetto dell'analisi documentale e dell'OCR. */
export const ANTEPRIME_MAX_PAGINE = 20;
export const ANTEPRIME_MAX_BYTE = 15 * 1024 * 1024;
const TIMEOUT_RENDERING_MS = 60_000;

export type AnteprimeDocumento = {
  versione: number;
  /** L'impronta del documento reso: se cambia, le anteprime non valgono più. */
  checksum: string | null;
  /** `jpeg` = pagine rese nello storage; `originale` = il file stesso è l'immagine (foto). */
  formato: "jpeg" | "originale";
  dpi: number;
  pagine: number;
  /** Chiavi di storage, una per pagina (vuote per `originale`). */
  chiavi: string[];
  /** Quando sono state rese (ISO). */
  rese: string;
};

export type EsitoAnteprima =
  | { esito: "ok"; buffer: Buffer; mimeType: string }
  | { esito: "fuori_intervallo"; pagine: number }
  | {
      esito: "non_disponibile";
      codice: "spento" | "documento" | "troppo_grande" | "rendering" | "storage";
      motivo: string;
    };

export function anteprimeAttive(): boolean {
  return interruttoreAttivo("anteprimeEvidenze");
}

function eImmagine(mimeType: string | null | undefined): boolean {
  return /^image\//i.test(mimeType ?? "");
}

/** Le anteprime del documento valgono ancora: stessa versione e stessa impronta. */
export function anteprimeValide(documento: Pick<Documento, "anteprime" | "checksum">): boolean {
  const a = documento.anteprime;
  if (!a) return false;
  return a.versione === ANTEPRIME_VERSIONE && (a.checksum ?? null) === (documento.checksum ?? null);
}

// Un rendering per documento alla volta: la seconda richiesta aspetta la prima.
const inCorso = new Map<number, Promise<AnteprimeDocumento | null>>();

/**
 * Rende le pagine del documento e le salva nello storage; restituisce il
 * metadato salvato sul documento, oppure null se l'interruttore è spento,
 * il file è troppo grande o il rendering fallisce (motivo nei log).
 */
export function rendiAnteprime(input: {
  documento: Documento;
  sedeId: number;
  bytes: Buffer;
}): Promise<AnteprimeDocumento | null> {
  if (!anteprimeAttive()) return Promise.resolve(null);
  const { documento } = input;
  const pendente = inCorso.get(documento.id);
  if (pendente) return pendente;
  const esecuzione = rendiAnteprimeInterno(input).finally(() => {
    inCorso.delete(documento.id);
  });
  inCorso.set(documento.id, esecuzione);
  return esecuzione;
}

async function rendiAnteprimeInterno(input: {
  documento: Documento;
  sedeId: number;
  bytes: Buffer;
}): Promise<AnteprimeDocumento | null> {
  const { documento, sedeId, bytes } = input;
  const partenza = Date.now();
  if (bytes.length === 0 || bytes.length > ANTEPRIME_MAX_BYTE) {
    console.info("[anteprime] saltate: dimensione fuori limite", {
      documentoId: documento.id,
      byte: bytes.length,
    });
    return null;
  }
  const checksum = documento.checksum ?? null;
  if (eImmagine(documento.mimeType)) {
    const meta: AnteprimeDocumento = {
      versione: ANTEPRIME_VERSIONE,
      checksum,
      formato: "originale",
      dpi: 0,
      pagine: 1,
      chiavi: [],
      rese: new Date().toISOString(),
    };
    salvaAnteprimeDocumento(documento.id, meta);
    return meta;
  }
  const rendering = await renderizzaPagine(bytes, {
    dpi: ANTEPRIME_DPI,
    maxPagine: ANTEPRIME_MAX_PAGINE,
    timeoutMs: TIMEOUT_RENDERING_MS,
    formato: "jpeg",
    qualita: ANTEPRIME_QUALITA,
  });
  if (rendering.esito === "errore") {
    console.warn("[anteprime] rendering fallito", {
      documentoId: documento.id,
      motivo: rendering.motivo.slice(0, 200),
    });
    return null;
  }
  const chiavi: string[] = [];
  try {
    for (const [indice, immagine] of rendering.immagini.entries()) {
      const salvata = await putFile(
        "anteprime",
        sedeId,
        documento.id,
        `${checksum ?? "senza-impronta"}-p${indice + 1}.jpg`,
        immagine,
        "image/jpeg"
      );
      chiavi.push(salvata.storageKey);
    }
  } catch (errore: any) {
    console.warn("[anteprime] storage fallito", {
      documentoId: documento.id,
      motivo: String(errore?.message ?? errore).slice(0, 200),
    });
    return null;
  }
  const meta: AnteprimeDocumento = {
    versione: ANTEPRIME_VERSIONE,
    checksum,
    formato: "jpeg",
    dpi: ANTEPRIME_DPI,
    pagine: chiavi.length,
    chiavi,
    rese: new Date().toISOString(),
  };
  salvaAnteprimeDocumento(documento.id, meta);
  console.info("[anteprime] rese", {
    documentoId: documento.id,
    pagine: chiavi.length,
    ms: Date.now() - partenza,
    msPerPagina: chiavi.length ? Math.round((Date.now() - partenza) / chiavi.length) : null,
  });
  return meta;
}

/**
 * Scalda le anteprime quando i byte sono già in mano (worker, lettura del
 * contratto, analisi): best-effort, non lancia mai — chi legge non deve
 * fallire per una vignetta.
 */
export async function scaldaAnteprime(
  documento: Documento,
  sedeId: number,
  bytes: Buffer
): Promise<void> {
  if (!anteprimeAttive()) return;
  if (anteprimeValide(documento)) return;
  try {
    await rendiAnteprime({ documento, sedeId, bytes });
  } catch (errore: any) {
    console.warn("[anteprime] scaldata fallita", {
      documentoId: documento.id,
      motivo: String(errore?.message ?? errore).slice(0, 200),
    });
  }
}

/**
 * Una pagina resa del documento, nella sede data: la rende a richiesta se
 * manca. Esiti espliciti: fuori intervallo, non disponibile con il codice.
 */
export async function leggiAnteprima(
  documentoId: number,
  sedeId: number,
  pagina: number
): Promise<EsitoAnteprima> {
  if (!anteprimeAttive()) {
    return { esito: "non_disponibile", codice: "spento", motivo: "Anteprime disattivate (FLAG_ANTEPRIME_EVIDENZE)." };
  }
  let documento = getDocumentoCommessaById(documentoId, sedeId);
  if (!documento) {
    return { esito: "non_disponibile", codice: "documento", motivo: "Documento non trovato." };
  }
  if (!Number.isInteger(pagina) || pagina < 1) {
    return { esito: "fuori_intervallo", pagine: documento.anteprime?.pagine ?? 0 };
  }
  if (!anteprimeValide(documento)) {
    const letto = await leggiDocumentoCommessaDaStorage(documentoId, sedeId);
    if (!letto) {
      return { esito: "non_disponibile", codice: "storage", motivo: "File non disponibile nello storage." };
    }
    if (letto.buffer.length > ANTEPRIME_MAX_BYTE) {
      return { esito: "non_disponibile", codice: "troppo_grande", motivo: "Il file supera i 15 MB: apri il PDF." };
    }
    const meta = await rendiAnteprime({ documento: letto.documento, sedeId, bytes: letto.buffer });
    if (!meta) {
      return { esito: "non_disponibile", codice: "rendering", motivo: "Rendering della pagina non riuscito: apri il PDF." };
    }
    documento = getDocumentoCommessaById(documentoId, sedeId) ?? documento;
  }
  const meta = documento.anteprime!;
  if (pagina > meta.pagine) return { esito: "fuori_intervallo", pagine: meta.pagine };
  if (meta.formato === "originale") {
    const letto = await leggiDocumentoCommessaDaStorage(documentoId, sedeId);
    if (!letto) {
      return { esito: "non_disponibile", codice: "storage", motivo: "File non disponibile nello storage." };
    }
    return { esito: "ok", buffer: letto.buffer, mimeType: documento.mimeType || "image/jpeg" };
  }
  const buffer = await getFile(meta.chiavi[pagina - 1]);
  if (!buffer) {
    // La pagina resa è sparita dallo storage: si dimentica il metadato, così
    // la prossima richiesta la rifà.
    salvaAnteprimeDocumento(documento.id, null);
    return { esito: "non_disponibile", codice: "storage", motivo: "Pagina resa non trovata nello storage: riprova." };
  }
  return { esito: "ok", buffer, mimeType: "image/jpeg" };
}
