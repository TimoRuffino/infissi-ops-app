// Cifratura dei segreti a riposo (AES-256-GCM).
//
// Perché serve: il backup notturno chiama getAllStoreSnapshots() e manda
// OGNI raccolta su Google Drive. Una password di casella email salvata in
// chiaro in un persistedStore finirebbe in chiaro nel backup — e una
// password cPanel non dà solo lettura IMAP, dà anche invio SMTP.
//
// Qui dentro cifriamo con una chiave che vive SOLO nelle variabili
// d'ambiente: nel backup finisce ciphertext, inutile senza la chiave.
//
// Formato: "v1.<iv_b64>.<tag_b64>.<ciphertext_b64>" — versionato, così un
// domani si può ruotare algoritmo o chiave riconoscendo i vecchi valori.

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";

const PREFIX = "v1";
const ALGO = "aes-256-gcm";

export class SecretBoxNotConfigured extends Error {
  constructor() {
    super(
      "MAIL_ENCRYPTION_KEY non configurata: senza chiave le password delle caselle non possono essere salvate."
    );
    this.name = "SecretBoxNotConfigured";
  }
}

export function secretBoxConfigured(): boolean {
  return !!process.env.MAIL_ENCRYPTION_KEY;
}

// La chiave d'ambiente può essere una passphrase qualsiasi: la riduciamo a
// 32 byte con sha256. Non è key-stretching (non protegge da una passphrase
// debole indovinata offline), ma la chiave non è un segreto scelto da un
// umano da ricordare — va generata a caso, vedi README della card.
function key(): Buffer {
  const raw = process.env.MAIL_ENCRYPTION_KEY;
  if (!raw) throw new SecretBoxNotConfigured();
  return createHash("sha256").update(raw, "utf8").digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12); // 96 bit, raccomandato per GCM
  const cipher = createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX,
    iv.toString("base64"),
    tag.toString("base64"),
    enc.toString("base64"),
  ].join(".");
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error("Segreto in formato non riconosciuto.");
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv(
    ALGO,
    key(),
    Buffer.from(ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  // Se la chiave è sbagliata o il dato è stato manomesso, final() lancia:
  // il tag GCM è autenticazione, non solo integrità.
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** True quando il valore ha il formato di un segreto cifrato da noi. */
export function isEncrypted(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(`${PREFIX}.`);
}
