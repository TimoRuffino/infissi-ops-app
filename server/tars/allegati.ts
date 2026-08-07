// Lettura degli allegati per Tars.
//
// Gli allegati non sono salvati nel CRM (lo storage documenti è ancora
// `local`): la casella IMAP è la fonte di verità, e da lì si ripescano al
// momento del bisogno. Il messaggio si ritrova per UID (colonna nuova) o,
// sui record vecchi, per Message-ID. Poi mailparser estrae l'allegato e
// qui se ne tira fuori il testo.
//
// Formati: PDF (unpdf → testo), text/* e csv (così come sono). Il resto
// viene dichiarato non leggibile, con nome e peso — meglio un limite
// esplicito che un silenzio.

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { extractText, getDocumentProxy } from "unpdf";
import { decryptSecret } from "../_core/secretBox";
import { caselle, type Casella } from "./caselle";
import type { Comunicazione } from "./comunicazioni";

const MAX_TESTO_ALLEGATO = 15_000;
const MAX_BYTE = 15 * 1024 * 1024;

export async function estraiTestoAllegato(
  buffer: Buffer,
  mimeType: string,
  nome: string
): Promise<string> {
  const mime = (mimeType || "").toLowerCase();
  const estensione = nome.toLowerCase().split(".").pop() ?? "";

  if (mime.includes("pdf") || estensione === "pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    const pulito = (text ?? "").replace(/[ \t]+\n/g, "\n").trim();
    if (!pulito) {
      return "(PDF senza testo estraibile — probabilmente una scansione. Servirebbe l'OCR, che non è disponibile.)";
    }
    return pulito.slice(0, MAX_TESTO_ALLEGATO);
  }

  if (
    mime.startsWith("text/") ||
    ["csv", "txt", "log"].includes(estensione)
  ) {
    return buffer.toString("utf8").slice(0, MAX_TESTO_ALLEGATO);
  }

  return `(Formato non leggibile: ${mimeType || estensione || "sconosciuto"}, ${Math.round(
    buffer.length / 1024
  )} KB. So leggere PDF e file di testo.)`;
}

/**
 * Ripesca un allegato dal canale d'origine e ne restituisce il testo.
 * Nulla è archiviato nel CRM: la casella (o Meta) resta la fonte.
 */
export async function leggiAllegato(
  comunicazione: Comunicazione,
  nomeAllegato: string
): Promise<{ testo: string; nome: string; mimeType: string }> {
  return comunicazione.canale === "whatsapp"
    ? leggiAllegatoDaWhatsApp(comunicazione, nomeAllegato)
    : leggiAllegatoDaCasella(comunicazione, nomeAllegato);
}

// WhatsApp: il media si scarica da Meta con l'id ricevuto nel webhook.
// Attenzione operativa: Meta conserva i media ~30 giorni, dopodiché
// l'allegato di una conversazione vecchia non è più recuperabile.
async function leggiAllegatoDaWhatsApp(
  comunicazione: Comunicazione,
  nomeAllegato: string
): Promise<{ testo: string; nome: string; mimeType: string }> {
  const { configWhatsApp, scaricaMedia } = await import("./whatsapp");
  const config = configWhatsApp.find((c) => c.id === comunicazione.casellaId);
  if (!config) {
    throw new Error("Il numero WhatsApp d'origine non è più configurato.");
  }
  const dichiarato = comunicazione.allegati.find(
    (a) => a.nome.toLowerCase() === nomeAllegato.toLowerCase()
  );
  if (!dichiarato?.mediaId) {
    const nomi = comunicazione.allegati.map((a) => a.nome).join(", ");
    throw new Error(
      `Nessun allegato "${nomeAllegato}" su questo messaggio. Presenti: ${nomi || "nessuno"}.`
    );
  }
  const { buffer, mimeType } = await scaricaMedia(config, dichiarato.mediaId);
  if (buffer.length > MAX_BYTE) {
    throw new Error(
      `L'allegato pesa ${Math.round(buffer.length / 1024 / 1024)} MB: oltre il limite di lettura.`
    );
  }
  const testo = await estraiTestoAllegato(buffer, mimeType, nomeAllegato);
  return { testo, nome: nomeAllegato, mimeType };
}

export async function leggiAllegatoDaCasella(
  comunicazione: Comunicazione,
  nomeAllegato: string
): Promise<{ testo: string; nome: string; mimeType: string }> {
  const casella: Casella | undefined = caselle.find(
    (c) => c.id === comunicazione.casellaId
  );
  if (!casella) {
    throw new Error(
      "La casella d'origine di questo messaggio non è più configurata."
    );
  }

  const dichiarato = comunicazione.allegati.find(
    (a) => a.nome.toLowerCase() === nomeAllegato.toLowerCase()
  );
  if (!dichiarato) {
    const nomi = comunicazione.allegati.map((a) => a.nome).join(", ");
    throw new Error(
      `Nessun allegato "${nomeAllegato}" su questo messaggio. Presenti: ${nomi || "nessuno"}.`
    );
  }
  if ((dichiarato.size ?? 0) > MAX_BYTE) {
    throw new Error(
      `L'allegato pesa ${Math.round((dichiarato.size ?? 0) / 1024 / 1024)} MB: oltre il limite di lettura.`
    );
  }

  const client = new ImapFlow({
    host: casella.host,
    port: casella.porta,
    secure: casella.tls,
    auth: {
      user: casella.indirizzo,
      pass: decryptSecret(casella.passwordCifrata),
    },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 45_000,
  });

  try {
    await client.connect();
    await client.mailboxOpen(casella.cartella || "INBOX", { readOnly: true });

    // Per UID quando c'è; altrimenti ricerca per Message-ID (record vecchi).
    let uid = comunicazione.uid;
    if (uid == null) {
      const trovati = await client.search(
        { header: { "message-id": comunicazione.messageId } },
        { uid: true }
      );
      uid = Array.isArray(trovati) && trovati.length > 0 ? trovati[0] : null;
    }
    if (uid == null) {
      throw new Error(
        "Messaggio non più presente nella casella (spostato o cancellato dal client di posta)."
      );
    }

    const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
    if (!msg || !msg.source) {
      throw new Error("Messaggio non recuperabile dalla casella.");
    }

    const parsed: any = await simpleParser(msg.source);
    const allegato = (parsed.attachments ?? []).find(
      (a: any) => (a.filename ?? "").toLowerCase() === nomeAllegato.toLowerCase()
    );
    if (!allegato) {
      throw new Error(`Allegato "${nomeAllegato}" non trovato nel messaggio scaricato.`);
    }

    const mimeType = allegato.contentType ?? dichiarato.mimeType;
    const testo = await estraiTestoAllegato(allegato.content, mimeType, nomeAllegato);
    return { testo, nome: nomeAllegato, mimeType };
  } finally {
    await client.logout().catch(() => {
      try {
        client.close();
      } catch {
        /* già chiusa */
      }
    });
  }
}
