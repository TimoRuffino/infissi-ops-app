// Foto HEIC/HEIF (06/09/2026): l'iPhone salva così, ma né tesseract, né il
// modello, né i browser (Chrome, Firefox) aprono il formato. Fino a oggi una
// conferma fotografata in HEIC finiva «non leggibile» e la vignetta «Dove
// l'ho letto» non poteva mostrarla. Si converte in JPEG una volta sola, in
// testa alla cascata di lettura (`estraiTestoDocumento`) e nelle anteprime,
// con `heic-convert`: libheif compilato in WebAssembly, nessun binario di
// sistema, quindi funziona su Railway com'è. Il file originale non si
// tocca: la conversione vive in memoria, con una piccola cache per
// impronta perché lettura e anteprime chiedono la stessa foto una dopo
// l'altra.

import { createHash } from "node:crypto";

export const QUALITA_JPEG_HEIC = 0.85;
/** Quante conversioni restano in memoria: la stessa foto letta e resa, non un archivio. */
const CACHE_MASSIMA = 8;

const MIME_HEIC = /^image\/hei[cf]$/i;
const ESTENSIONE_HEIC = /\.hei[cf]$/i;

/** Il mime dichiarato o l'estensione dicono HEIC/HEIF. */
export function eHeic(mimeType: string | null | undefined, nomeFile?: string | null): boolean {
  return MIME_HEIC.test(mimeType ?? "") || ESTENSIONE_HEIC.test(nomeFile ?? "");
}

export type EsitoHeic =
  | { esito: "ok"; bytes: Buffer; mimeType: string; convertita: boolean }
  | { esito: "errore"; motivo: string };

function magiaJpeg(bytes: Buffer): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function magiaPng(bytes: Buffer): boolean {
  return bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

const cache = new Map<string, Buffer>();

function ricorda(impronta: string, jpeg: Buffer): void {
  cache.set(impronta, jpeg);
  while (cache.size > CACHE_MASSIMA) {
    const piuVecchia = cache.keys().next().value;
    if (piuVecchia === undefined) break;
    cache.delete(piuVecchia);
  }
}

/**
 * Se il documento è una foto HEIC/HEIF la restituisce come JPEG; ogni altro
 * formato passa com'è. Un file chiamato HEIC ma con dentro un JPEG o un PNG
 * (iPhone «più compatibile», o un rinominato) non si converte: si corregge
 * solo il mime. Un HEIC corrotto è un errore con il motivo, mai un lancio.
 */
export async function convertiSeHeic(bytes: Buffer, mimeType: string, nomeFile?: string | null): Promise<EsitoHeic> {
  if (!eHeic(mimeType, nomeFile)) return { esito: "ok", bytes, mimeType, convertita: false };
  if (magiaJpeg(bytes)) return { esito: "ok", bytes, mimeType: "image/jpeg", convertita: false };
  if (magiaPng(bytes)) return { esito: "ok", bytes, mimeType: "image/png", convertita: false };
  const impronta = createHash("sha256").update(bytes).digest("hex");
  const inCache = cache.get(impronta);
  if (inCache) return { esito: "ok", bytes: inCache, mimeType: "image/jpeg", convertita: true };
  const partenza = Date.now();
  try {
    // Import pigro: libheif (9 MB di WebAssembly) si carica alla prima foto, non all'avvio del server.
    const { default: convert } = await import("heic-convert");
    const uscita = await convert({ buffer: bytes, format: "JPEG", quality: QUALITA_JPEG_HEIC });
    const jpeg = Buffer.isBuffer(uscita) ? uscita : Buffer.from(uscita as ArrayBuffer);
    if (!magiaJpeg(jpeg)) {
      return { esito: "errore", motivo: "Foto HEIC non convertibile: la conversione non ha prodotto un JPEG." };
    }
    ricorda(impronta, jpeg);
    console.info("[heic] foto convertita in JPEG", {
      file: (nomeFile ?? "").slice(0, 60),
      byteIn: bytes.length,
      byteOut: jpeg.length,
      ms: Date.now() - partenza,
    });
    return { esito: "ok", bytes: jpeg, mimeType: "image/jpeg", convertita: true };
  } catch (errore: any) {
    const motivo = String(errore?.message ?? errore).slice(0, 200);
    console.warn("[heic] conversione fallita", { file: (nomeFile ?? "").slice(0, 60), byte: bytes.length, motivo });
    return { esito: "errore", motivo: `Foto HEIC non convertibile: ${motivo}` };
  }
}
