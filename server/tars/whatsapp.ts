// WhatsApp Business — connettore in SOLA LETTURA.
//
// Fase 1: i messaggi in arrivo entrano in `comunicazioni` e diventano
// contesto per Tars. In questo file NON esiste alcuna funzione che invii
// un messaggio: come per gli strumenti dell'agente, l'assenza è la
// garanzia. L'invio sarà un lavoro separato, con approvazione esplicita e
// template Meta.
//
// Coexistence: il numero resta attivo nell'app WhatsApp Business del
// telefono e in parallelo consegna i messaggi al webhook. L'ufficio non
// perde lo strumento che usa ogni giorno.
//
// Segreti: il token di accesso e l'app secret sono cifrati con secretBox,
// perché il backup notturno spedisce ogni raccolta su Drive.

import { createHmac, timingSafeEqual } from "crypto";
import { persistedStore } from "../_core/persistence";
import { decryptSecret, encryptSecret, isEncrypted } from "../_core/secretBox";
import { normalizzaTelefono } from "@shared/telefono";
import {
  insertComunicazione,
  type Allegato,
  type NuovaComunicazione,
} from "./comunicazioni";
import { matchComunicazione } from "./match";
import { getClientiStore } from "../routers/clienti";
import { getCommesseStore } from "../routers/commesse";
import { programmaSmistamento } from "./smistamento";

const GRAPH_VERSION = "v21.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

// Messaggi brevissimi già agganciati (un "ok", un "grazie", un pollice in
// su) non meritano un'esecuzione dell'agente: entrano nello storico ma
// non nella coda di analisi. Sotto questa soglia, senza media.
const SOGLIA_TRIVIALE = 15;

export type ConfigWhatsApp = {
  id: number;
  sedeId: number;
  // Etichetta leggibile: "Numero aziendale", "Commerciale".
  nome: string;
  // Numero in formato leggibile, solo per la UI.
  numero: string;
  // Id del numero su Meta (non è il numero di telefono).
  phoneNumberId: string;
  wabaId: string;
  // Cifrati. Mai restituiti al client.
  tokenCifrato: string;
  appSecretCifrato: string;
  // Token che Meta rimanda nella verifica del webhook (GET). In chiaro:
  // non è un segreto di accesso, serve solo a riconoscere la chiamata.
  verifyToken: string;
  attiva: boolean;
  ultimoMessaggio: Date | null;
  messaggiRicevuti: number;
  ultimoErrore: string | null;
  createdAt: Date;
  updatedAt: Date;
};

let nextId = 1;
const _store = persistedStore<ConfigWhatsApp>("whatsapp_config", (items) => {
  nextId = items.length ? Math.max(...items.map((c) => c.id)) + 1 : 1;
  for (const c of items) {
    if (c.messaggiRicevuti === undefined) c.messaggiRicevuti = 0;
  }
});

export const configWhatsApp = _store.items;
export const saveConfigWhatsApp = () => _store.save();
export const newConfigWhatsAppId = () => nextId++;

export function proteggiSegreto(plain: string): string {
  return isEncrypted(plain) ? plain : encryptSecret(plain);
}

/** Vista sicura per il client: nessun segreto esce da qui. */
export function configPubblica(c: ConfigWhatsApp) {
  const { tokenCifrato, appSecretCifrato, ...rest } = c;
  return {
    ...rest,
    tokenConfigurato: !!tokenCifrato,
    appSecretConfigurato: !!appSecretCifrato,
  };
}

// ── Verifica della firma ────────────────────────────────────────────────────

/**
 * Meta firma ogni webhook con HMAC-SHA256 sul corpo GREZZO. Va verificata
 * prima di guardare il contenuto: senza, chiunque conosca l'URL potrebbe
 * iniettare messaggi falsi nel CRM — e quei messaggi finiscono a Tars.
 *
 * Il confronto è a tempo costante.
 */
export function verificaFirma(
  rawBody: Buffer,
  header: string | undefined,
  appSecret: string
): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  const atteso = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const ricevuto = header.slice("sha256=".length);
  const a = Buffer.from(atteso, "hex");
  const b = Buffer.from(ricevuto, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/** La configurazione a cui appartiene un phone_number_id. */
export function configPerPhoneNumberId(id: string): ConfigWhatsApp | undefined {
  return configWhatsApp.find((c) => c.phoneNumberId === id && c.attiva);
}

/** La configurazione che risponde a un verify token (handshake GET). */
export function configPerVerifyToken(token: string): ConfigWhatsApp | undefined {
  return configWhatsApp.find((c) => c.verifyToken === token);
}

// ── Media (download on-demand) ──────────────────────────────────────────────

/**
 * Scarica un media WhatsApp. Due passaggi: dall'id si ottiene un URL
 * temporaneo, poi si scarica col token nell'header. Come per gli allegati
 * IMAP, si fa al bisogno: il CRM non archivia nulla.
 */
export async function scaricaMedia(
  config: ConfigWhatsApp,
  mediaId: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  const token = decryptSecret(config.tokenCifrato);
  const metaRes = await fetch(`${GRAPH}/${mediaId}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!metaRes.ok) {
    throw new Error(
      `Media non recuperabile da WhatsApp (${metaRes.status}). Meta conserva i media circa 30 giorni.`
    );
  }
  const meta: any = await metaRes.json();
  if (!meta?.url) throw new Error("Media senza URL di download.");

  const fileRes = await fetch(meta.url, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!fileRes.ok) {
    throw new Error(`Download del media fallito (${fileRes.status}).`);
  }
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  return { buffer, mimeType: meta.mime_type ?? "application/octet-stream" };
}

// ── Ingestione ──────────────────────────────────────────────────────────────

type MessaggioWa = {
  id: string;
  from: string;
  timestamp?: string;
  type: string;
  text?: { body?: string };
  image?: { id: string; mime_type?: string; caption?: string };
  document?: { id: string; mime_type?: string; filename?: string; caption?: string };
  audio?: { id: string; mime_type?: string };
  video?: { id: string; mime_type?: string; caption?: string };
  location?: { latitude?: number; longitude?: number; name?: string };
  // I tipi non gestiti (sticker, reaction, contacts…) finiscono nel ramo
  // generico: si registra che è arrivato qualcosa, senza inventarne il
  // contenuto.
};

// Il testo che vale la pena registrare, per tipo di messaggio.
function testoDaMessaggio(m: MessaggioWa): string {
  if (m.type === "text") return m.text?.body ?? "";
  if (m.type === "image") return m.image?.caption ?? "(immagine)";
  if (m.type === "video") return m.video?.caption ?? "(video)";
  if (m.type === "document") {
    const nome = m.document?.filename ?? "documento";
    return m.document?.caption ? `${m.document.caption}\n(${nome})` : `(${nome})`;
  }
  if (m.type === "audio") return "(messaggio vocale)";
  if (m.type === "location") {
    const l = m.location;
    return `(posizione${l?.name ? `: ${l.name}` : ""}${
      l?.latitude != null ? ` — ${l.latitude},${l.longitude}` : ""
    })`;
  }
  return `(messaggio di tipo ${m.type})`;
}

function allegatiDaMessaggio(m: MessaggioWa): Allegato[] {
  const media =
    m.type === "image"
      ? { id: m.image?.id, mime: m.image?.mime_type, nome: "immagine.jpg" }
      : m.type === "document"
        ? {
            id: m.document?.id,
            mime: m.document?.mime_type,
            nome: m.document?.filename ?? "documento",
          }
        : m.type === "video"
          ? { id: m.video?.id, mime: m.video?.mime_type, nome: "video.mp4" }
          : m.type === "audio"
            ? { id: m.audio?.id, mime: m.audio?.mime_type, nome: "audio.ogg" }
            : null;
  if (!media?.id) return [];
  return [
    {
      nome: media.nome,
      mimeType: media.mime ?? "application/octet-stream",
      // Meta non dichiara la dimensione nel webhook: si scopre al download.
      size: 0,
      storageKey: null,
      mediaId: media.id,
    },
  ];
}

/**
 * Elabora il payload di un webhook già verificato. Ritorna quanti messaggi
 * sono stati registrati. Non lancia sui singoli messaggi malformati: un
 * messaggio strano non deve far fallire l'intera consegna, altrimenti Meta
 * riprova all'infinito.
 */
export async function ingestisciWebhook(payload: any): Promise<number> {
  let registrati = 0;
  const sediDaSmistare = new Set<number>();

  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      if (!value) continue;
      const phoneNumberId = value?.metadata?.phone_number_id;
      const config = phoneNumberId
        ? configPerPhoneNumberId(String(phoneNumberId))
        : undefined;
      // Numero non configurato (o spento): si ignora in silenzio. Non è un
      // errore — Meta può consegnare eventi di numeri che non seguiamo.
      if (!config) continue;

      // `statuses` sono le ricevute di consegna dei NOSTRI invii: in sola
      // lettura non ci riguardano.
      const messaggi: MessaggioWa[] = value?.messages ?? [];
      if (messaggi.length === 0) continue;

      const sedeId = config.sedeId;
      const clienti = getClientiStore().filter((c: any) => c.sedeId === sedeId);
      const commesse = getCommesseStore().filter((c: any) => c.sedeId === sedeId);
      // Il profilo mittente arriva a parte, indicizzato per wa_id.
      const profili: Record<string, string> = {};
      for (const c of value?.contacts ?? []) {
        if (c?.wa_id) profili[String(c.wa_id)] = c?.profile?.name ?? "";
      }

      for (const m of messaggi) {
        try {
          const numero = normalizzaTelefono(m.from) ?? String(m.from ?? "");
          const testo = testoDaMessaggio(m);
          const allegati = allegatiDaMessaggio(m);
          const match = matchComunicazione({
            mittente: numero,
            oggetto: "",
            testo,
            clienti,
            commesse,
            canale: "whatsapp",
          });

          // Un "ok" su una conversazione già agganciata non merita
          // un'esecuzione dell'agente: entra nello storico e basta.
          const triviale =
            match.commessaId != null &&
            allegati.length === 0 &&
            testo.trim().length < SOGLIA_TRIVIALE;

          const nuova: NuovaComunicazione = {
            sedeId,
            casellaId: config.id,
            messageId: String(m.id),
            uid: null,
            canale: "whatsapp",
            direzione: "in",
            mittente: numero,
            mittenteNome: profili[String(m.from)] || null,
            destinatari: [config.numero],
            oggetto: "",
            testo,
            allegati,
            clienteId: match.clienteId,
            commessaId: match.commessaId,
            matchConfidenza: match.confidenza,
            matchMotivo: match.motivo,
            stato: "nuova",
            tarsAnalizzata: triviale,
            receivedAt: m.timestamp
              ? new Date(Number(m.timestamp) * 1000)
              : new Date(),
          };

          const inserita = await insertComunicazione(nuova);
          if (inserita) {
            registrati++;
            if (!triviale) sediDaSmistare.add(sedeId);
          }
        } catch (e: any) {
          console.warn(
            `[whatsapp] messaggio ${m?.id} non elaborato:`,
            e?.message ?? e
          );
        }
      }

      config.ultimoMessaggio = new Date();
      config.messaggiRicevuti = (config.messaggiRicevuti ?? 0) + messaggi.length;
      config.ultimoErrore = null;
      config.updatedAt = new Date();
    }
  }

  if (registrati > 0) saveConfigWhatsApp();
  for (const sedeId of Array.from(sediDaSmistare)) {
    programmaSmistamento(sedeId);
  }
  return registrati;
}
