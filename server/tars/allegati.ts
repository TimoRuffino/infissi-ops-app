// Lettura degli allegati per Tars.
//
// Prima dell'archiviazione, gli allegati vengono riletti dal canale d'origine:
// casella IMAP per le email e Graph API per WhatsApp. Le email si ritrovano
// per UID (o Message-ID sui record legacy); i media WhatsApp per mediaId.
// Dopo l'approvazione, i byte vengono salvati nello storage documentale.
//
// Formati: PDF (unpdf → testo), text/* e csv (così come sono). Il resto
// viene dichiarato non leggibile, con nome e peso — meglio un limite
// esplicito che un silenzio.

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { extractText, getDocumentProxy } from "unpdf";
import { decryptSecret } from "../_core/secretBox";
import { getFile } from "../_core/fileStorage";
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

  if (mime.startsWith("text/") || ["csv", "txt", "log"].includes(estensione)) {
    return buffer.toString("utf8").slice(0, MAX_TESTO_ALLEGATO);
  }

  return `(Formato non leggibile: ${mimeType || estensione || "sconosciuto"}, ${Math.round(
    buffer.length / 1024
  )} KB. So leggere PDF e file di testo.)`;
}

/**
 * Ripesca un allegato dal canale d'origine e ne restituisce il testo.
 * Se il file non è già nello storage, il canale d'origine resta la fonte.
 */
export async function leggiAllegato(
  comunicazione: Comunicazione,
  nomeAllegato: string
): Promise<{ testo: string; nome: string; mimeType: string }> {
  const allegatoIndex = comunicazione.allegati.findIndex(
    allegato => allegato.nome.toLowerCase() === nomeAllegato.toLowerCase()
  );
  if (allegatoIndex < 0) {
    const nomi = comunicazione.allegati
      .map(allegato => allegato.nome)
      .join(", ");
    throw new Error(
      `Nessun allegato "${nomeAllegato}" su questo messaggio. Presenti: ${nomi || "nessuno"}.`
    );
  }
  const raw = await leggiAllegatoRaw(comunicazione, allegatoIndex);
  return {
    testo: await estraiTestoAllegato(raw.buffer, raw.mimeType, raw.nome),
    nome: raw.nome,
    mimeType: raw.mimeType,
  };
}

export type AllegatoRaw = {
  buffer: Buffer;
  nome: string;
  mimeType: string;
};

export function allegatoImapIndicizzato<
  T extends {
    filename?: string | null;
    contentType?: string | null;
    content: Buffer | Uint8Array;
  },
>(
  allegatiImap: T[],
  allegatiDichiarati: Array<{ nome: string }>,
  allegatoIndex: number
): T | null {
  const nome = allegatiDichiarati[allegatoIndex]?.nome.toLowerCase();
  if (!nome) return null;
  const occorrenza = allegatiDichiarati
    .slice(0, allegatoIndex + 1)
    .filter(allegato => allegato.nome.toLowerCase() === nome).length - 1;
  return (
    allegatiImap.filter(
      allegato => (allegato.filename ?? "").toLowerCase() === nome
    )[occorrenza] ?? null
  );
}

/** Legge i byte originali, preferendo lo storage durevole quando disponibile. */
export async function leggiAllegatoRaw(
  comunicazione: Comunicazione,
  allegatoIndex: number
): Promise<AllegatoRaw> {
  const dichiarato = comunicazione.allegati[allegatoIndex];
  if (!dichiarato) throw new Error("Allegato non trovato nel messaggio.");
  if ((dichiarato.size ?? 0) > MAX_BYTE) {
    throw new Error(
      `L'allegato pesa ${Math.round((dichiarato.size ?? 0) / 1024 / 1024)} MB: oltre il limite di lettura.`
    );
  }

  if (dichiarato.storageKey) {
    const buffer = await getFile(dichiarato.storageKey);
    if (!buffer) throw new Error("Allegato non disponibile nello storage.");
    if (buffer.length > MAX_BYTE) {
      throw new Error("L'allegato supera il limite di lettura di 15 MB.");
    }
    return {
      buffer,
      nome: dichiarato.nome,
      mimeType: dichiarato.mimeType,
    };
  }

  return comunicazione.canale === "whatsapp"
    ? leggiAllegatoRawDaWhatsApp(comunicazione, allegatoIndex)
    : leggiAllegatoRawDaCasella(comunicazione, allegatoIndex);
}

// WhatsApp: il media si scarica da Meta con l'id ricevuto nel webhook.
// Attenzione operativa: Meta conserva i media ~30 giorni, dopodiché
// l'allegato di una conversazione vecchia non è più recuperabile.
async function leggiAllegatoRawDaWhatsApp(
  comunicazione: Comunicazione,
  allegatoIndex: number
): Promise<AllegatoRaw> {
  const { configWhatsApp, scaricaMedia } = await import("./whatsapp");
  const config = configWhatsApp.find(
    c => c.id === comunicazione.casellaId && c.sedeId === comunicazione.sedeId
  );
  if (!config) {
    throw new Error("Il numero WhatsApp d'origine non è più configurato.");
  }
  const dichiarato = comunicazione.allegati[allegatoIndex];
  if (!dichiarato?.mediaId) {
    throw new Error("Il media WhatsApp non è più recuperabile.");
  }
  const { buffer, mimeType } = await scaricaMedia(config, dichiarato.mediaId);
  if (buffer.length > MAX_BYTE) {
    throw new Error(
      `L'allegato pesa ${Math.round(buffer.length / 1024 / 1024)} MB: oltre il limite di lettura.`
    );
  }
  return { buffer, nome: dichiarato.nome, mimeType };
}

export async function leggiAllegatoDaCasella(
  comunicazione: Comunicazione,
  nomeAllegato: string
): Promise<{ testo: string; nome: string; mimeType: string }> {
  const allegatoIndex = comunicazione.allegati.findIndex(
    allegato => allegato.nome.toLowerCase() === nomeAllegato.toLowerCase()
  );
  if (allegatoIndex < 0) {
    throw new Error(`Allegato "${nomeAllegato}" non trovato nel messaggio.`);
  }
  const raw = await leggiAllegatoRaw(comunicazione, allegatoIndex);
  return {
    testo: await estraiTestoAllegato(raw.buffer, raw.mimeType, raw.nome),
    nome: raw.nome,
    mimeType: raw.mimeType,
  };
}

async function leggiAllegatoRawDaCasella(
  comunicazione: Comunicazione,
  allegatoIndex: number
): Promise<AllegatoRaw> {
  const casella: Casella | undefined = caselle.find(
    c => c.id === comunicazione.casellaId && c.sedeId === comunicazione.sedeId
  );
  if (!casella) {
    throw new Error(
      "La casella d'origine di questo messaggio non è più configurata."
    );
  }

  const dichiarato = comunicazione.allegati[allegatoIndex]!;

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

    const msg = await client.fetchOne(
      String(uid),
      { source: true },
      { uid: true }
    );
    if (!msg || !msg.source) {
      throw new Error("Messaggio non recuperabile dalla casella.");
    }

    const parsed: any = await simpleParser(msg.source);
    const allegato = allegatoImapIndicizzato(
      parsed.attachments ?? [],
      comunicazione.allegati,
      allegatoIndex
    );
    if (!allegato) {
      throw new Error(
        `Allegato "${dichiarato.nome}" non trovato nel messaggio scaricato.`
      );
    }

    const mimeType = allegato.contentType ?? dichiarato.mimeType;
    const buffer = Buffer.from(allegato.content);
    if (buffer.length > MAX_BYTE) {
      throw new Error("L'allegato supera il limite di lettura di 15 MB.");
    }
    return { buffer, nome: dichiarato.nome, mimeType };
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
