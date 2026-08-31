const MEBIBYTE = 1024 * 1024;

export const COMMESSA_UPLOAD_MAX_MB = 250;
export const COMMESSA_UPLOAD_MAX_BYTES = COMMESSA_UPLOAD_MAX_MB * MEBIBYTE;

// Il fallback inline esiste solo per compatibilità con piccoli documenti.
// Un video non deve mai trasformarsi in centinaia di MB dentro kv_store.
export const COMMESSA_UPLOAD_INLINE_FALLBACK_MAX_BYTES = 10 * MEBIBYTE;

export const COMMESSA_UPLOAD_ALLOWED_MIME_TYPES = [
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
  "video/mp4",
  "video/quicktime",
  "video/webm",
] as const;

const allowedMimeTypes = new Set<string>(COMMESSA_UPLOAD_ALLOWED_MIME_TYPES);

const videoMimeByExtension: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
};

export const COMMESSA_UPLOAD_ACCEPT = [
  ...COMMESSA_UPLOAD_ALLOWED_MIME_TYPES,
  ".mp4",
  ".mov",
  ".webm",
].join(",");

export function normalizzaMimeUploadCommessa(
  nome: string,
  mimeType: string
): string {
  if (allowedMimeTypes.has(mimeType)) return mimeType;

  const lowerName = nome.toLowerCase();
  const extension = Object.keys(videoMimeByExtension).find(ext =>
    lowerName.endsWith(ext)
  );
  if (
    extension &&
    (!mimeType ||
      mimeType === "application/octet-stream" ||
      mimeType.startsWith("video/"))
  ) {
    return videoMimeByExtension[extension];
  }

  return mimeType || "application/octet-stream";
}

export function erroreUploadCommessa(
  actualBytes: number,
  mimeType: string
): string | null {
  if (!allowedMimeTypes.has(mimeType)) {
    return `Tipo di file non consentito: ${mimeType || "sconosciuto"}`;
  }
  if (actualBytes > COMMESSA_UPLOAD_MAX_BYTES) {
    return `Il file supera il limite di ${COMMESSA_UPLOAD_MAX_MB} MB.`;
  }
  return null;
}
