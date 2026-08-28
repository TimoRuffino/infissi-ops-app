// Caselle email configurate — quali mailbox il CRM legge.
//
// Host, utente e flag stanno in kv_store come tutto il resto. La password
// NO: viene cifrata con secretBox prima di toccare lo store, perché il
// backup notturno spedisce ogni raccolta su Google Drive e una password
// cPanel dà anche l'invio SMTP, non solo la lettura.
//
// Nessuna procedura restituisce mai la password, nemmeno cifrata.

import { persistedStore } from "../_core/persistence";
import { encryptSecret, isEncrypted } from "../_core/secretBox";

export type Casella = {
  id: number;
  sedeId: number;
  // Etichetta leggibile: "Ordini", "Amministrazione", "Andrea Facci".
  nome: string;
  indirizzo: string; // = utente IMAP su cPanel
  host: string;
  porta: number;
  tls: boolean;
  // Cifrata (formato "v1.…"). Mai esposta al client.
  passwordCifrata: string;
  cartella: string; // "INBOX"
  attiva: boolean;
  // Ingestione incrementale: UID dell'ultimo messaggio letto su questa
  // cartella. IMAP garantisce UID crescenti dentro una uidValidity: se il
  // server la cambia (ricostruzione casella) ripartiamo da capo, e
  // l'insert idempotente su message_id evita i duplicati.
  ultimoUid: number | null;
  uidValidity: string | null;
  // Diagnostica dell'ultima sincronizzazione.
  ultimaSync: Date | null;
  ultimoErrore: string | null;
  messaggiImportati: number;
  createdAt: Date;
  updatedAt: Date;
};

let nextCasellaId = 1;
const _store = persistedStore<Casella>("caselle_email", (items) => {
  nextCasellaId = items.length ? Math.max(...items.map((c) => c.id)) + 1 : 1;
  for (const c of items) {
    if (c.cartella === undefined) c.cartella = "INBOX";
    if (c.messaggiImportati === undefined) c.messaggiImportati = 0;
    if (c.uidValidity === undefined) c.uidValidity = null;
  }
});

export const caselle = _store.items;
export const saveCaselle = () => _store.save();
export const newCasellaId = () => nextCasellaId++;

/** Prepara una password per lo store: sempre cifrata, mai in chiaro. */
export function proteggiPassword(plain: string): string {
  return isEncrypted(plain) ? plain : encryptSecret(plain);
}

/** Vista sicura per il client: tutto tranne il segreto. */
export function casellaPubblica(c: Casella) {
  const { passwordCifrata, ...rest } = c;
  return { ...rest, passwordConfigurata: !!passwordCifrata };
}
