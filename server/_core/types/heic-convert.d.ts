// `heic-convert` non porta tipi: il contratto che usiamo (server/documenti/heic.ts).
declare module "heic-convert" {
  type OpzioniConversione = {
    buffer: Buffer | Uint8Array | ArrayBuffer;
    format: "JPEG" | "PNG";
    /** Solo per JPEG, fra 0 e 1. */
    quality?: number;
  };
  function convert(opzioni: OpzioniConversione): Promise<Buffer | ArrayBuffer | Uint8Array>;
  export = convert;
}
