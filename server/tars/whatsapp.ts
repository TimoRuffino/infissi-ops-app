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

import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { persistedStore } from "../_core/persistence";
import { decryptSecret, encryptSecret, isEncrypted } from "../_core/secretBox";
import { normalizzaTelefono } from "@shared/telefono";
import {
  insertComunicazione,
  massimoCasellaIdWhatsApp,
  trovaCasellaWhatsAppStorica,
  type Allegato,
  type NuovaComunicazione,
} from "./comunicazioni";
import { matchComunicazione } from "./match";
import { getClientiStore } from "../routers/clienti";
import { getCommesseStore } from "../routers/commesse";
import { DEFAULT_SEDE_ID } from "../routers/sedi";
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
  // Coexistence: quando l'onboarding è avvenuto e se lo storico è stato
  // richiesto. Meta dà 24 ore per chiederlo, poi il numero va rifatto.
  onboardingAt: Date | null;
  storicoRichiestoAt: Date | null;
  storicoUltimoEventoAt: Date | null;
  storicoProgresso: number | null;
  storicoCompletatoAt: Date | null;
  // Campo legacy: resta per compatibilità con i dati esistenti, ma da ora
  // indica una consegna completata, non la sola accettazione della richiesta.
  storicoSincronizzato: Date | null;
  // Telemetria tecnica del webhook. Non contiene testo, numeri, nomi o
  // identificativi dei messaggi: serve solo a distinguere un evento mai
  // consegnato da uno ricevuto e poi deduplicato.
  diagnosticaWebhook?: DiagnosticaWebhookWhatsApp;
  createdAt: Date;
  updatedAt: Date;
};

export type DiagnosticaWebhookWhatsApp = {
  ultimoWebhookAt: Date | null;
  ultimoCampo: string | null;
  ultimoEchoAt: Date | null;
  eventiWebhook: number;
  eventiEcho: number;
  messaggiEchoRicevuti: number;
  messaggiEchoRegistrati: number;
  ultimoEsito: "registrato" | "duplicato" | "senza_messaggi" | null;
};

function diagnosticaWebhookVuota(): DiagnosticaWebhookWhatsApp {
  return {
    ultimoWebhookAt: null,
    ultimoCampo: null,
    ultimoEchoAt: null,
    eventiWebhook: 0,
    eventiEcho: 0,
    messaggiEchoRicevuti: 0,
    messaggiEchoRegistrati: 0,
    ultimoEsito: null,
  };
}

function diagnosticaWebhook(c: ConfigWhatsApp): DiagnosticaWebhookWhatsApp {
  if (!c.diagnosticaWebhook) c.diagnosticaWebhook = diagnosticaWebhookVuota();
  return c.diagnosticaWebhook;
}

let nextId = 1;
let codaConfigurazione: Promise<void> = Promise.resolve();

async function conBloccoConfigurazione<T>(fn: () => Promise<T>): Promise<T> {
  const precedente = codaConfigurazione;
  let sblocca!: () => void;
  codaConfigurazione = new Promise<void>(resolve => {
    sblocca = resolve;
  });
  await precedente;
  try {
    return await fn();
  } finally {
    sblocca();
  }
}

const _store = persistedStore<ConfigWhatsApp>("whatsapp_config", (items) => {
  nextId = items.length ? Math.max(...items.map((c) => c.id)) + 1 : 1;
  for (const c of items) {
    if (c.messaggiRicevuti === undefined) c.messaggiRicevuti = 0;
    if (c.storicoSincronizzato === undefined) c.storicoSincronizzato = null;
    if (c.storicoRichiestoAt === undefined) {
      // Le versioni precedenti salvavano qui l'istante in cui Meta aveva
      // accettato la richiesta, non la fine della consegna.
      c.storicoRichiestoAt = c.storicoSincronizzato ?? null;
    }
    if (c.storicoUltimoEventoAt === undefined) c.storicoUltimoEventoAt = null;
    if (c.storicoProgresso === undefined) c.storicoProgresso = null;
    if (c.storicoCompletatoAt === undefined) c.storicoCompletatoAt = null;
    if (c.onboardingAt === undefined) c.onboardingAt = null;
    if (c.diagnosticaWebhook === undefined) {
      c.diagnosticaWebhook = diagnosticaWebhookVuota();
    }
    // Le configurazioni create dal collegamento col QR prima di questa
    // correzione hanno il verify token vuoto: senza, l'handshake del
    // callback non trova nulla da confrontare e Meta rifiuta l'URL.
    if (!c.verifyToken) c.verifyToken = nuovoVerifyToken();
  }
});

// ── Configurazione a livello di app (una sola, non per sede) ────────────────
// L'app Meta è una: id, configuration id del Login for Business e app secret
// valgono per tutti i numeri. L'app secret sta qui perché serve a due cose —
// scambiare il code dell'Embedded Signup e verificare la firma dei webhook.

export type AppWhatsApp = {
  id: number;
  // Un'app Meta per sede. Ogni sede ha il suo numero, e un numero vive in
  // un portfolio aziendale: obbligare due sedi a condividere app id, config
  // id e app secret significherebbe obbligarle a condividere il portfolio.
  sedeId: number;
  appId: string;
  // Configuration ID del Facebook Login for Business, quello che porta al
  // flusso di coexistence (scansione del QR dall'app del telefono).
  configId: string;
  appSecretCifrato: string;
  // Il webhook su Meta si configura una volta per app, e va validato prima
  // che esista un numero: serve quindi un verify token che non dipenda da
  // nessuna configurazione. Non è una credenziale — è la stringa che Meta
  // rimanda nell'handshake — ma resta imprevedibile.
  verifyToken: string;
  updatedAt: Date;
};

let nextAppId = 2;

function appVuota(sedeId: number, id: number): AppWhatsApp {
  return {
    id,
    sedeId,
    appId: "",
    configId: "",
    appSecretCifrato: "",
    verifyToken: nuovoVerifyToken(),
    updatedAt: new Date(),
  };
}

const _appStore = persistedStore<AppWhatsApp>("whatsapp_app", (items, meta) => {
  if (items.length === 0 && meta.firstBoot) {
    items.push(appVuota(DEFAULT_SEDE_ID, 1));
  }
  for (const a of items) {
    // Installazioni salvate prima che il token esistesse.
    if (!a.verifyToken) a.verifyToken = nuovoVerifyToken();
    // L'unico record di prima era, di fatto, quello della sede principale.
    if (a.sedeId === undefined) a.sedeId = DEFAULT_SEDE_ID;
  }
  nextAppId = items.length ? Math.max(...items.map((a) => a.id)) + 1 : 1;
});

export function getAppWhatsApp(sedeId: number | null): AppWhatsApp {
  const sede = sedeId ?? DEFAULT_SEDE_ID;
  let a = _appStore.items.find((x) => x.sedeId === sede);
  if (!a) {
    a = appVuota(sede, nextAppId++);
    _appStore.items.push(a);
    _appStore.save();
  }
  if (!a.verifyToken) {
    a.verifyToken = nuovoVerifyToken();
    _appStore.save();
  }
  return a;
}

/** Tutte le app configurate, per il webhook: l'endpoint è uno per tutte. */
export function tutteLeAppWhatsApp(): AppWhatsApp[] {
  return _appStore.items;
}

export const saveAppWhatsApp = () => _appStore.save();

/** Vista sicura: l'app secret non esce mai. */
export function appPubblica(sedeId: number | null) {
  const a = getAppWhatsApp(sedeId);
  return {
    appId: a.appId,
    configId: a.configId,
    appSecretConfigurato: !!a.appSecretCifrato,
    verifyToken: a.verifyToken,
    pronta: !!a.appId && !!a.configId && !!a.appSecretCifrato,
  };
}

export const configWhatsApp = _store.items;
export const saveConfigWhatsApp = () => _store.save();
export const newConfigWhatsAppId = (
  preferito?: number,
  massimoStorico = 0
) => {
  nextId = Math.max(nextId, massimoStorico + 1);
  if (preferito != null && Number.isInteger(preferito) && preferito > 0) {
    if (configWhatsApp.some(c => c.id === preferito)) {
      throw new Error("Identificativo configurazione WhatsApp gia in uso.");
    }
    nextId = Math.max(nextId, preferito + 1);
    return preferito;
  }
  return nextId++;
};

export function proteggiSegreto(plain: string): string {
  return isEncrypted(plain) ? plain : encryptSecret(plain);
}

/** Stringa casuale per l'handshake del webhook: non è una credenziale. */
export function nuovoVerifyToken(): string {
  return randomBytes(24).toString("hex");
}

/** Vista sicura per il client: nessun segreto esce da qui. */
export function configPubblica(c: ConfigWhatsApp) {
  const { tokenCifrato, appSecretCifrato, ...rest } = c;
  return {
    ...rest,
    diagnosticaWebhook:
      c.diagnosticaWebhook ?? diagnosticaWebhookVuota(),
    tokenConfigurato: !!tokenCifrato,
    // L'app secret può stare sul numero (configurazione a mano) o a livello
    // di app (Embedded Signup): per la UI conta che ce ne sia uno.
    appSecretConfigurato:
      !!appSecretCifrato || !!getAppWhatsApp(c.sedeId).appSecretCifrato,
  };
}

/**
 * L'app secret da usare per un numero: quello specifico se c'è, altrimenti
 * quello dell'app. Con l'Embedded Signup i numeri non ne hanno uno proprio.
 */
export function appSecretPer(c: ConfigWhatsApp): string | null {
  const cifrato = c.appSecretCifrato || getAppWhatsApp(c.sedeId).appSecretCifrato;
  if (!cifrato) return null;
  try {
    return decryptSecret(cifrato);
  } catch {
    return null;
  }
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

/**
 * Il token vale per l'handshake? Quello dell'app basta: Meta valida l'URL
 * una volta sola, e in quel momento un numero può non esserci ancora.
 */
export function verifyTokenValido(token: string): boolean {
  if (!token) return false;
  // L'URL del webhook è uno per tutta l'installazione: l'handshake accetta
  // il token di qualunque sede, altrimenti la seconda sede non riuscirebbe
  // mai a validare il proprio callback.
  if (tutteLeAppWhatsApp().some((a) => a.verifyToken === token)) return true;
  return configPerVerifyToken(token) != null;
}

// ── Embedded Signup (coexistence) ───────────────────────────────────────────
// Il flusso: il titolare preme «Collega», Meta apre il popup, lui scansiona
// il QR dall'app WhatsApp Business del telefono, e alla fine il browser ci
// restituisce un `code`. Qui lo scambiamo per un token, sottoscriviamo l'app
// alla WABA e ci facciamo dare i numeri: la configurazione si compila da
// sola, senza copiare id a mano.

/** code → business access token (di sistema, non scade). */
async function scambiaCode(code: string, sedeId: number): Promise<string> {
  const app = getAppWhatsApp(sedeId);
  if (!app.appId || !app.appSecretCifrato) {
    throw new Error(
      "Configurazione dell'app Meta incompleta: servono App ID e App secret."
    );
  }
  const params = new URLSearchParams({
    client_id: app.appId,
    client_secret: decryptSecret(app.appSecretCifrato),
    code,
  });
  const res = await fetch(`${GRAPH}/oauth/access_token?${params}`);
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || !body?.access_token) {
    throw new Error(
      `Scambio del codice fallito: ${body?.error?.message ?? res.status}`
    );
  }
  return body.access_token as string;
}

/** Senza questa sottoscrizione i webhook della WABA non arrivano. */
async function sottoscriviApp(wabaId: string, token: string): Promise<void> {
  const res = await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || body?.success === false) {
    throw new Error(
      `Sottoscrizione della WABA fallita: ${body?.error?.message ?? res.status}`
    );
  }
}

async function numeriDellaWaba(
  wabaId: string,
  token: string
): Promise<Array<{ id: string; display_phone_number?: string; verified_name?: string }>> {
  const res = await fetch(`${GRAPH}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Lettura dei numeri fallita: ${body?.error?.message ?? res.status}`
    );
  }
  return body?.data ?? [];
}

/**
 * Sincronizza contatti e storico dopo l'onboarding.
 *
 * Meta concede 24 ore: oltre quella finestra il numero va offboardato e
 * rifatto. Per questo parte da sola subito dopo il collegamento, e non da
 * un bottone che qualcuno potrebbe dimenticare di premere.
 *
 * L'ordine conta: prima i contatti, poi i messaggi.
 */
export async function sincronizzaStorico(
  config: ConfigWhatsApp
): Promise<{ ok: boolean; errore: string | null }> {
  if (!config.tokenCifrato || !config.phoneNumberId) {
    return { ok: false, errore: "Numero non ancora configurato." };
  }
  const token = decryptSecret(config.tokenCifrato);
  const chiedi = async (sync_type: string) => {
    const res = await fetch(`${GRAPH}/${config.phoneNumberId}/smb_app_data`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", sync_type }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
    }
  };
  try {
    await chiedi("smb_app_state_sync");
    await chiedi("history");
    config.storicoRichiestoAt = new Date();
    config.storicoUltimoEventoAt = null;
    config.storicoProgresso = 0;
    config.storicoCompletatoAt = null;
    config.storicoSincronizzato = null;
    config.ultimoErrore = null;
    config.updatedAt = new Date();
    saveConfigWhatsApp();
    return { ok: true, errore: null };
  } catch (e: any) {
    const errore = `Sincronizzazione storico fallita: ${e?.message ?? e}`;
    config.ultimoErrore = errore;
    config.updatedAt = new Date();
    saveConfigWhatsApp();
    return { ok: false, errore };
  }
}

/**
 * Completa l'onboarding a partire dal code restituito dal popup.
 * Crea (o aggiorna) la configurazione del numero e avvia il sync storico.
 */
export async function completaOnboarding(params: {
  code: string;
  wabaId: string;
  phoneNumberId?: string;
  sedeId: number;
  nome?: string;
}): Promise<ConfigWhatsApp> {
  const token = await scambiaCode(params.code, params.sedeId);
  await sottoscriviApp(params.wabaId, token);
  const numeri = await numeriDellaWaba(params.wabaId, token);
  if (numeri.length === 0) {
    throw new Error("Nessun numero trovato su questo account WhatsApp Business.");
  }
  // Se il popup ha detto quale numero è (sessionInfoVersion 3), è quello.
  // Altrimenti si prende il primo: con la coexistence il numero è uno.
  const numero =
    numeri.find((n) => n.id === params.phoneNumberId) ?? numeri[0];

  const now = new Date();
  const config = await conBloccoConfigurazione(async () => {
    const configurazioneAltraSede = configWhatsApp.find(
      c => c.phoneNumberId === numero.id && c.sedeId !== params.sedeId
    );
    if (configurazioneAltraSede) {
      throw new Error("Numero WhatsApp non disponibile per questa sede.");
    }

    let corrente = configWhatsApp.find(
      c => c.phoneNumberId === numero.id && c.sedeId === params.sedeId
    );
    if (!corrente) {
      const [casellaStorica, massimoStorico] = await Promise.all([
        trovaCasellaWhatsAppStorica({
          sedeId: params.sedeId,
          numeroAccount: numero.display_phone_number ?? "",
          escludiCasellaIds: configWhatsApp.map(c => c.id),
        }),
        massimoCasellaIdWhatsApp(),
      ]);
      corrente = {
        id: newConfigWhatsAppId(casellaStorica ?? undefined, massimoStorico),
        sedeId: params.sedeId,
        nome:
          params.nome?.trim() || numero.verified_name || "Numero aziendale",
        numero: numero.display_phone_number ?? "",
        phoneNumberId: numero.id,
        wabaId: params.wabaId,
        tokenCifrato: encryptSecret(token),
        // La firma dei webhook si verifica con l'app secret a livello di app.
        appSecretCifrato: "",
        verifyToken: nuovoVerifyToken(),
        attiva: true,
        ultimoMessaggio: null,
        messaggiRicevuti: 0,
        ultimoErrore: null,
        onboardingAt: now,
        storicoRichiestoAt: null,
        storicoUltimoEventoAt: null,
        storicoProgresso: null,
        storicoCompletatoAt: null,
        storicoSincronizzato: null,
        createdAt: now,
        updatedAt: now,
      };
      configWhatsApp.push(corrente);
    } else {
      corrente.wabaId = params.wabaId;
      corrente.tokenCifrato = encryptSecret(token);
      corrente.numero = numero.display_phone_number ?? corrente.numero;
      corrente.attiva = true;
      corrente.onboardingAt = now;
      corrente.storicoRichiestoAt = null;
      corrente.storicoUltimoEventoAt = null;
      corrente.storicoProgresso = null;
      corrente.storicoCompletatoAt = null;
      corrente.storicoSincronizzato = null;
      corrente.ultimoErrore = null;
      corrente.updatedAt = now;
    }
    saveConfigWhatsApp();
    return corrente;
  });

  // Le 24 ore partono adesso: non si aspetta un'azione umana.
  void sincronizzaStorico(config).catch(() => {});
  return config;
}

// ── Prova connessione ───────────────────────────────────────────────────────
// Legge account e numeri dalla WABA. Serve a due cose: dire all'operatore
// se il collegamento regge davvero, e — per la App Review di Meta —
// registrare un uso effettivo di whatsapp_business_management, che loro
// pretendono prima di esaminare la richiesta.
// Sola lettura: nessuna di queste chiamate modifica alcunché.

function messaggioErroreMeta(status: number, body: any): string {
  const msg = body?.error?.message ?? `HTTP ${status}`;
  const code = body?.error?.code;
  if (status === 401 || code === 190) {
    return "Token rifiutato da Meta: è scaduto o è stato revocato. Rifai il collegamento col QR.";
  }
  if (status === 403 || code === 200) {
    return "Permessi insufficienti: l'app non ha ancora whatsapp_business_management in accesso avanzato, oppure il token non li porta.";
  }
  if (status === 404) {
    return "Account WhatsApp Business non trovato con questo token: il WABA ID potrebbe non essere più valido.";
  }
  if (code === 4 || code === 80007 || status === 429) {
    return "Limite di richieste raggiunto: riprova tra qualche minuto.";
  }
  return msg;
}

// Ogni chiamata dichiara quale permesso esercita: la App Review conta le
// chiamate per permesso, e serve vedere quale ha fatto scattare il
// contatore. Una che fallisce non ferma le altre — con più tentativi
// indipendenti si scopre esattamente cosa manca.
export type EsitoChiamata = {
  permesso: string;
  endpoint: string;
  ok: boolean;
  dettaglio: string;
};

export async function provaConnessione(config: ConfigWhatsApp): Promise<{
  ok: boolean;
  errore: string | null;
  account: string | null;
  numeri: Array<{
    id: string;
    numero: string | null;
    nome: string | null;
    qualita: string | null;
    stato: string | null;
    suAppBusiness: boolean | null;
    coesistenza: boolean;
  }>;
  chiamate: EsitoChiamata[];
}> {
  const vuoto = { account: null, numeri: [] as any[], chiamate: [] as EsitoChiamata[] };
  if (!config.tokenCifrato) {
    return { ok: false, errore: "Nessun token: completa prima il collegamento.", ...vuoto };
  }
  if (!config.wabaId) {
    return { ok: false, errore: "WABA ID mancante sulla configurazione.", ...vuoto };
  }
  let token: string;
  try {
    token = decryptSecret(config.tokenCifrato);
  } catch {
    return {
      ok: false,
      errore: "Token non decifrabile: MAIL_ENCRYPTION_KEY è cambiata dopo il salvataggio.",
      ...vuoto,
    };
  }

  const chiamate: EsitoChiamata[] = [];
  const chiama = async (
    permesso: string,
    endpoint: string,
    path: string
  ): Promise<any | null> => {
    try {
      const res = await fetch(`${GRAPH}${path}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        chiamate.push({
          permesso,
          endpoint,
          ok: false,
          dettaglio: messaggioErroreMeta(res.status, body),
        });
        return null;
      }
      chiamate.push({ permesso, endpoint, ok: true, dettaglio: "chiamata riuscita" });
      return body;
    } catch (e: any) {
      chiamate.push({
        permesso,
        endpoint,
        ok: false,
        dettaglio: e?.message ?? String(e),
      });
      return null;
    }
  };

  // whatsapp_business_management — l'account e i suoi numeri.
  const account = await chiama(
    "whatsapp_business_management",
    `GET /${config.wabaId}`,
    `/${config.wabaId}?fields=id,name`
  );
  const numeri = await chiama(
    "whatsapp_business_management",
    `GET /${config.wabaId}/phone_numbers`,
    `/${config.wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,platform_type,is_on_biz_app`
  );

  // business_management — Meta conta le chiamate sull'oggetto Business,
  // non quelle sulla WABA: owner_business_info passa ma non muove il
  // contatore della App Review. Serve leggere il Business direttamente,
  // e il suo id lo si ricava proprio da owner_business_info.
  const proprietario = await chiama(
    "business_management",
    `GET /${config.wabaId}?fields=owner_business_info`,
    `/${config.wabaId}?fields=id,owner_business_info`
  );
  const businessId =
    proprietario?.owner_business_info?.id ?? proprietario?.owner_business_info?.business_id;

  if (businessId) {
    await chiama(
      "business_management",
      `GET /${businessId}`,
      `/${businessId}?fields=id,name,verification_status`
    );
    await chiama(
      "business_management",
      `GET /${businessId}/owned_whatsapp_business_accounts`,
      `/${businessId}/owned_whatsapp_business_accounts?fields=id,name`
    );
  } else {
    // Senza id del proprietario resta solo la via generica, che sui token
    // da utente di sistema di norma risponde "(#100) Missing Permission".
    await chiama(
      "business_management",
      "GET /me/businesses",
      "/me/businesses?fields=id,name"
    );
  }

  const ok = chiamate.some((c) => c.ok);
  const fallite = chiamate.filter((c) => !c.ok);
  const errore = ok
    ? fallite.length > 0
      ? `${fallite.length} chiamate su ${chiamate.length} non riuscite — vedi il dettaglio.`
      : null
    : (fallite[0]?.dettaglio ?? "Nessuna chiamata riuscita.");

  config.ultimoErrore = ok ? null : errore;
  config.updatedAt = new Date();
  saveConfigWhatsApp();

  return {
    ok,
    errore,
    account: account?.name ?? (ok ? config.wabaId : null),
    numeri: (numeri?.data ?? []).map((n: any) => {
      const stato = n.platform_type ?? null;
      const suAppBusiness =
        typeof n.is_on_biz_app === "boolean" ? n.is_on_biz_app : null;

      return {
        id: String(n.id),
        numero: n.display_phone_number ?? null,
        nome: n.verified_name ?? null,
        qualita: n.quality_rating ?? null,
        stato,
        suAppBusiness,
        coesistenza: stato === "CLOUD_API" && suAppBusiness === true,
      };
    }),
    chiamate,
  };
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
    if (fileRes.status === 404 || fileRes.status === 410) {
      throw new Error(
        `Il media WhatsApp è scaduto o non più disponibile (${fileRes.status}).`
      );
    }
    throw new Error(`Download del media fallito (${fileRes.status}).`);
  }
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  return { buffer, mimeType: meta.mime_type ?? "application/octet-stream" };
}

// ── Ingestione ──────────────────────────────────────────────────────────────

type MessaggioWa = {
  id: string;
  from: string;
  // Presenti sugli echo (messaggi in uscita): lì `from` è il nostro numero
  // e la controparte va cercata qui.
  to?: string;
  recipient_id?: string;
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

// Un messaggio dal webhook, qualunque sia il campo che l'ha portato.
type Origine = {
  // "in"  — scritto dal cliente
  // "out" — scritto dall'ufficio dal telefono (echo della coexistence)
  direzione: "in" | "out";
  // Lo storico non è novità: entra archiviato e fuori dalla coda di Tars.
  storico: boolean;
  // Nei webhook history Meta identifica la conversazione con thread.id.
  // È la fonte canonica anche quando il singolo messaggio outbound non ha `to`.
  controparte?: string;
};

async function registraMessaggio(
  m: MessaggioWa,
  config: ConfigWhatsApp,
  profili: Record<string, string>,
  origine: Origine,
  ctx: { clienti: any[]; commesse: any[] }
): Promise<boolean> {
  // Su un echo `from` è il nostro numero e il cliente sta in `to`: per
  // agganciare la conversazione serve sempre il numero del CLIENTE.
  const controparte =
    origine.controparte ??
    (origine.direzione === "out" ? (m.to ?? m.recipient_id) : m.from);
  const numero = normalizzaTelefono(controparte);
  if (!numero) throw new Error("controparte non determinabile");
  const testo = testoDaMessaggio(m);
  const allegati = allegatiDaMessaggio(m);
  const match = matchComunicazione({
    mittente: numero,
    oggetto: "",
    testo,
    clienti: ctx.clienti,
    commesse: ctx.commesse,
    canale: "whatsapp",
  });

  // Fuori dalla coda dell'agente: lo storico importato, gli echo (li ha
  // scritti l'ufficio, non c'è nulla da proporre) e le cortesie brevi su
  // conversazioni già agganciate.
  const triviale =
    match.commessaId != null &&
    allegati.length === 0 &&
    testo.trim().length < SOGLIA_TRIVIALE;
  const fuoriCoda = origine.storico || origine.direzione === "out" || triviale;

  const nuova: NuovaComunicazione = {
    sedeId: config.sedeId,
    casellaId: config.id,
    messageId: String(m.id),
    uid: null,
    canale: "whatsapp",
    direzione: origine.direzione,
    mittente: numero,
    mittenteNome: profili[String(controparte)] || null,
    destinatari: [config.numero],
    oggetto: "",
    testo,
    allegati,
    clienteId: match.clienteId,
    commessaId: match.commessaId,
    matchConfidenza: match.confidenza,
    matchMotivo: match.motivo,
    // Lo storico nasce già letto: non deve gonfiare il contatore delle
    // novità con conversazioni di sei mesi fa.
    stato: origine.storico ? "vista" : "nuova",
    tarsAnalizzata: fuoriCoda,
    receivedAt: m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date(),
  };

  const inserita = await insertComunicazione(nuova);
  return inserita != null;
}

/**
 * Elabora il payload di un webhook già verificato. Ritorna quanti messaggi
 * sono stati registrati. Non lancia sui singoli messaggi malformati: un
 * messaggio strano non deve far fallire l'intera consegna, altrimenti Meta
 * riprova all'infinito.
 *
 * Con la coexistence arrivano quattro tipi di contenuto:
 *   messages           — messaggi in arrivo dal cliente
 *   smb_message_echoes — messaggi scritti dall'ufficio dal telefono
 *   history            — lo storico sincronizzato dopo l'onboarding
 *   smb_app_state_sync — i contatti della rubrica (non sono messaggi)
 */
export async function ingestisciWebhook(payload: any): Promise<number> {
  let registrati = 0;
  const sediDaSmistare = new Set<number>();
  let daSalvare = false;

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

      const oraWebhook = new Date();
      const campo = String(
        change?.field ??
          (Array.isArray(value.message_echoes)
            ? "smb_message_echoes"
            : Array.isArray(value.history)
              ? "history"
              : Array.isArray(value.state_sync)
                ? "smb_app_state_sync"
                : Array.isArray(value.messages)
                  ? "messages"
                  : "sconosciuto")
      );
      const diagnostica = diagnosticaWebhook(config);
      diagnostica.ultimoWebhookAt = oraWebhook;
      diagnostica.ultimoCampo = campo;
      diagnostica.eventiWebhook += 1;
      const messaggiEchoNelCambio = Array.isArray(value.message_echoes)
        ? value.message_echoes.length
        : 0;
      if (campo === "smb_message_echoes") {
        diagnostica.ultimoEchoAt = oraWebhook;
        diagnostica.eventiEcho += 1;
        diagnostica.messaggiEchoRicevuti += messaggiEchoNelCambio;
      }
      daSalvare = true;

      const sedeId = config.sedeId;
      const ctx = {
        clienti: getClientiStore().filter((c: any) => c.sedeId === sedeId),
        commesse: getCommesseStore().filter((c: any) => c.sedeId === sedeId),
      };
      // Il profilo del contatto arriva a parte, indicizzato per wa_id.
      const profili: Record<string, string> = {};
      for (const c of value?.contacts ?? []) {
        if (c?.wa_id) profili[String(c.wa_id)] = c?.profile?.name ?? "";
      }

      // Ogni lotto: i messaggi e da dove vengono.
      const lotti: Array<{ messaggi: MessaggioWa[]; origine: Origine }> = [];

      if (Array.isArray(value.messages) && value.messages.length > 0) {
        lotti.push({
          messaggi: value.messages,
          origine: { direzione: "in", storico: false },
        });
      }
      if (
        Array.isArray(value.message_echoes) &&
        value.message_echoes.length > 0
      ) {
        lotti.push({
          messaggi: value.message_echoes,
          origine: { direzione: "out", storico: false },
        });
      }
      // Lo storico arriva a blocchi, ciascuno con i propri messaggi e la
      // direzione dichiarata per messaggio.
      for (const blocco of value.history ?? []) {
        config.storicoUltimoEventoAt = oraWebhook;
        const progressoRaw = Number(blocco?.metadata?.progress);
        if (Number.isFinite(progressoRaw)) {
          const progresso = Math.max(0, Math.min(100, progressoRaw));
          config.storicoProgresso = Math.max(
            config.storicoProgresso ?? 0,
            progresso
          );
          if (progresso >= 100) {
            config.storicoCompletatoAt ??= oraWebhook;
            config.storicoSincronizzato ??= config.storicoCompletatoAt;
            config.ultimoErrore = null;
          }
        }
        config.updatedAt = oraWebhook;
        daSalvare = true;
        for (const thread of blocco?.threads ?? []) {
          const messaggi: MessaggioWa[] = thread?.messages ?? [];
          if (messaggi.length === 0) continue;
          const controparte = normalizzaTelefono(thread?.id) ?? undefined;
          // In uno stesso thread ci sono entrambe le direzioni: si separa
          // guardando chi è il mittente rispetto al nostro numero.
          const nostro = normalizzaTelefono(config.numero);
          const inArrivo = messaggi.filter(
            (m) => normalizzaTelefono(m.from) !== nostro
          );
          const inUscita = messaggi.filter(
            (m) => normalizzaTelefono(m.from) === nostro
          );
          if (inArrivo.length > 0) {
            lotti.push({
              messaggi: inArrivo,
              origine: { direzione: "in", storico: true, controparte },
            });
          }
          if (inUscita.length > 0) {
            lotti.push({
              messaggi: inUscita,
              origine: { direzione: "out", storico: true, controparte },
            });
          }
        }
      }

      let nelLotto = 0;
      for (const { messaggi, origine } of lotti) {
        for (const m of messaggi) {
          try {
            const ok = await registraMessaggio(m, config, profili, origine, ctx);
            if (ok) {
              registrati++;
              nelLotto++;
              if (!origine.storico && origine.direzione === "out") {
                diagnostica.messaggiEchoRegistrati += 1;
              }
              if (!origine.storico && origine.direzione === "in") {
                sediDaSmistare.add(sedeId);
              }
            }
          } catch (e: any) {
            if (e?.message === "controparte non determinabile") {
              console.warn(
                "[whatsapp] messaggio ignorato: controparte non determinabile"
              );
            } else {
              console.warn(
                "[whatsapp] messaggio non elaborato:",
                e?.message ?? "errore sconosciuto"
              );
            }
          }
        }
      }

      const messaggiNelCambio = lotti.reduce(
        (totale, lotto) => totale + lotto.messaggi.length,
        0
      );
      diagnostica.ultimoEsito =
        nelLotto > 0
          ? "registrato"
          : messaggiNelCambio > 0
            ? "duplicato"
            : "senza_messaggi";

      if (nelLotto > 0) {
        config.ultimoMessaggio = new Date();
        config.messaggiRicevuti = (config.messaggiRicevuti ?? 0) + nelLotto;
        config.ultimoErrore = null;
        config.updatedAt = new Date();
        daSalvare = true;
      }
    }
  }

  if (daSalvare) saveConfigWhatsApp();
  // Lo smistamento parte solo per i messaggi veri in arrivo: lo storico e
  // gli echo non generano proposte.
  for (const sedeId of Array.from(sediDaSmistare)) {
    programmaSmistamento(sedeId);
  }
  return registrati;
}
