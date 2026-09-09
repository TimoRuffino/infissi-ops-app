// server/_core/postaPiattaforma.ts
// Mittente transazionale della piattaforma (spec §7): oggi il solo invito
// (Task 5), domani ogni altra posta "piattaforma verso azienda" che non
// passa da notification.ts (quella è per gli utenti dentro un'azienda già
// creata). Provider Resend via `fetch` semplice: nessun SDK, un solo
// endpoint, non lancia mai — chi chiama riceve sempre un esito e decide se
// mostrare il link a mano.
import { MESSAGGI_PIATTAFORMA } from "../piattaforma/costanti";

export type MessaggioPosta = {
  a: string;
  oggetto: string;
  testo: string;
  html?: string;
};

export type EsitoPosta =
  | { inviato: true; id: string }
  | { inviato: false; motivo: string };

type Mittente = (m: MessaggioPosta) => Promise<EsitoPosta>;

const MITTENTE_PREDEFINITO = "Wyndoor <no-reply@wyndoor.com>";
const URL_RESEND = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

/** Sostituita solo nei test (`__impostaPostaPerTest`), mai a runtime. */
let finta: Mittente | null = null;

/** Vero se `RESEND_API_KEY` è impostata: senza, ogni invio torna `inviato: false`. */
export function postaConfigurata(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

/** Solo il dominio del destinatario: mai l'indirizzo intero nei log. */
const dominio = (a: string): string => a.split("@")[1] ?? "?";

async function inviaConResend(m: MessaggioPosta): Promise<EsitoPosta> {
  const chiave = process.env.RESEND_API_KEY?.trim();
  if (!chiave) {
    return { inviato: false, motivo: MESSAGGI_PIATTAFORMA.postaNonConfigurata };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(URL_RESEND, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${chiave}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from:
          process.env.POSTA_PIATTAFORMA_MITTENTE?.trim() ||
          MITTENTE_PREDEFINITO,
        to: [m.a],
        subject: m.oggetto,
        text: m.testo,
        html: m.html,
      }),
    });
    if (!r.ok) {
      return { inviato: false, motivo: `Resend ha risposto ${r.status}` };
    }
    const corpo = (await r.json().catch(() => ({}))) as { id?: string };
    return { inviato: true, id: String(corpo.id ?? "") };
  } catch (e) {
    const motivo =
      e instanceof Error && e.name === "AbortError"
        ? `Resend non ha risposto entro ${TIMEOUT_MS / 1000} s`
        : `Rete: ${e instanceof Error ? e.message : String(e)}`;
    return { inviato: false, motivo };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Invia un messaggio della piattaforma (spec §7). Non lancia mai: ogni
 * fallimento — chiave assente, HTTP non 2xx, rete rotta — torna
 * `{ inviato: false, motivo }`. Logga una riga sola con il solo dominio del
 * destinatario: mai l'indirizzo intero, mai l'oggetto, mai il corpo.
 */
export async function inviaPosta(m: MessaggioPosta): Promise<EsitoPosta> {
  const esito = await (finta ?? inviaConResend)(m);
  if (esito.inviato) {
    console.log(`[posta] invio a ${dominio(m.a)}: ok`);
  } else {
    console.warn(`[posta] invio a ${dominio(m.a)}: fallito (${esito.motivo})`);
  }
  return esito;
}

/** Solo per i test: sostituisce il mittente vero, o lo ripristina con `null`. */
export function __impostaPostaPerTest(f: Mittente | null): void {
  if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY_POSTA");
  finta = f;
}
