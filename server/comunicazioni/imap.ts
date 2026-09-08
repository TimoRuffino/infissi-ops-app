// Connettore IMAP — l'ingestione della posta.
//
// Sola lettura, in senso stretto: la cartella si apre con readOnly, quindi
// il CRM non marca come letti i messaggi che il titolare della casella non
// ha ancora aperto. Nessun invio, nessuna cancellazione, nessuno spostamento.
//
// Ingestione incrementale per UID: si riparte da `ultimoUid` e si prendono
// solo i messaggi successivi. Se il server cambia uidValidity (casella
// ricostruita) si riparte da capo — l'insert idempotente su message_id
// impedisce comunque i duplicati.
//
// Alla prima sincronizzazione NON si aspira lo storico: si prendono gli
// ultimi PRIMA_SYNC_MAX messaggi. Una casella con vent'anni di posta
// altrimenti bloccherebbe il server per ore e riempirebbe la tabella di
// materiale che non serve a nessuno.

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { decryptSecret } from "../_core/secretBox";
import { putFile, storageDurevole } from "../_core/fileStorage";
import {
  insertComunicazione,
  MAX_TESTO,
  type Allegato,
} from "./comunicazioni";
import { matchComunicazione } from "./match";
import { caselle, saveCaselle, type Casella } from "./caselle";
import { getCommesseStore } from "../routers/commesse";
import { getClientiStore } from "../routers/clienti";
import { conTenantDellaSede, perOgniTenantAttivo } from "../tenants/giri";

// Prima sincronizzazione e importazione storico: per DATA, non per numero.
// Sei mesi di posta, con un tetto duro a protezione del server (e nostra).
const PRIMA_SYNC_GIORNI = 180;
const MAX_BACKFILL = 1000;
const MAX_PER_SYNC = 200;
const MAX_ALLEGATO_BYTE = 15 * 1024 * 1024;
// La posta più vecchia di così entra col match ma NON in coda di analisi
// Tars: la triage è per il flusso in arrivo, non per l'archivio.
const PRE_ANALIZZATA_GIORNI = 3;

function èStorica(receivedAt: Date): boolean {
  return (
    Date.now() - receivedAt.getTime() >
    PRE_ANALIZZATA_GIORNI * 24 * 60 * 60 * 1000
  );
}

export type EsitoSync = {
  casellaId: number;
  nome: string;
  importate: number;
  saltate: number;
  errore: string | null;
};

function testoDaMail(parsed: any): string {
  const base: string =
    (typeof parsed.text === "string" && parsed.text.trim()) ||
    // Ultimo fallback: l'HTML ridotto a testo. Grezzo ma leggibile, e
    // serve solo a classificare.
    (typeof parsed.html === "string"
      ? parsed.html
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/gi, " ")
          .replace(/\s+/g, " ")
      : "") ||
    "";
  return base.trim().slice(0, MAX_TESTO);
}

function indirizzi(campo: any): string[] {
  if (!campo) return [];
  const arr = Array.isArray(campo) ? campo : [campo];
  const out: string[] = [];
  for (const a of arr) {
    for (const v of a?.value ?? []) {
      if (v?.address) out.push(String(v.address).toLowerCase());
    }
  }
  return out;
}

function headerTesto(parsed: any, nome: string): string | null {
  const valore = parsed?.headers?.get?.(nome);
  if (valore == null) return null;
  if (typeof valore === "string" || typeof valore === "number") {
    return String(valore);
  }
  if (Array.isArray(valore)) return valore.map(String).join(", ");
  try {
    return JSON.stringify(valore);
  } catch {
    return String(valore);
  }
}

/** Costruisce le opzioni di connessione da una casella configurata. */
function opzioniConnessione(casella: Casella, perWatcher = false) {
  return {
    host: casella.host,
    port: casella.porta,
    secure: casella.tls,
    auth: {
      user: casella.indirizzo,
      pass: decryptSecret(casella.passwordCifrata),
    },
    // Su hosting condiviso i log verbosi di imapflow non servono a nessuno.
    logger: false as const,
    // Le connessioni di sincronizzazione entrano, leggono ed escono: niente
    // IDLE. Il watcher invece VIVE in IDLE: il server segnala l'arrivo di
    // posta e noi sincronizziamo subito, senza aspettare il poller.
    disableAutoIdle: !perWatcher,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    // Il watcher resta connesso a lungo; le sync no.
    socketTimeout: perWatcher ? 10 * 60_000 : 60_000,
  };
}

/**
 * Verifica credenziali e raggiungibilità senza importare nulla.
 * Ritorna il numero di messaggi nella cartella.
 */
export async function testaCasella(
  casella: Casella
): Promise<{ ok: true; messaggi: number } | { ok: false; errore: string }> {
  const client = new ImapFlow(opzioniConnessione(casella));
  try {
    await client.connect();
    const box = await client.mailboxOpen(casella.cartella || "INBOX", {
      readOnly: true,
    });
    return { ok: true, messaggi: box.exists ?? 0 };
  } catch (e: any) {
    return { ok: false, errore: messaggioErrore(e) };
  } finally {
    await client.logout().catch(() => client.close());
  }
}

// Gli errori IMAP arrivano in inglese e criptici: qui diventano frasi che
// dicono all'operatore cosa fare.
function messaggioErrore(e: any): string {
  const raw = e?.responseText || e?.message || String(e);
  const code = e?.code ?? "";
  if (/AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed/i.test(raw)) {
    return "Credenziali rifiutate dal server: controlla indirizzo e password della casella.";
  }
  if (code === "ENOTFOUND" || /getaddrinfo/i.test(raw)) {
    return "Server non trovato: controlla il nome host (di solito mail.tuodominio.it).";
  }
  if (code === "ECONNREFUSED") {
    return "Connessione rifiutata: porta sbagliata o IMAP disabilitato sulla casella.";
  }
  if (code === "ETIMEDOUT" || /timeout/i.test(raw)) {
    return "Timeout di connessione: host o porta probabilmente errati, o il server sta limitando gli accessi.";
  }
  if (/certificate/i.test(raw)) {
    return "Certificato TLS non valido: verifica host e porta (993 con TLS).";
  }
  if (/NONEXISTENT|Mailbox doesn't exist/i.test(raw)) {
    return "Cartella inesistente sul server: di norma è INBOX.";
  }
  return raw.slice(0, 300);
}

// Un messaggio grezzo → una riga in comunicazioni. Condiviso tra la
// sincronizzazione incrementale e l'importazione dello storico. Ritorna
// true se inserita, false se già presente.
async function elaboraMessaggio(params: {
  casella: Casella;
  uid: number;
  source: Buffer;
  internalDate: Date | null;
  clienti: any[];
  commesse: any[];
  durevole: boolean;
  /** "out" per la cartella degli inviati: il fascicolo ha due lati. */
  direzione?: "in" | "out";
}): Promise<boolean> {
  const { casella, uid, clienti, commesse, durevole } = params;
  const direzione = params.direzione ?? "in";
  const parsed: any = await simpleParser(params.source);
  const mittente = parsed.from?.value?.[0]?.address?.toLowerCase() ?? "";
  const oggetto = (parsed.subject ?? "").toString();
  const testo = testoDaMail(parsed);
  const messageId = parsed.messageId ?? `uid-${casella.id}-${uid}`;

  const allegati: Allegato[] = [];
  for (const a of parsed.attachments ?? []) {
    // Gli inline (firme, loghi) non sono allegati per l'utente.
    if (a.contentDisposition === "inline" && !a.filename) continue;
    const nome = a.filename ?? "allegato";
    const record: Allegato = {
      nome,
      mimeType: a.contentType ?? "application/octet-stream",
      size: a.size ?? a.content?.length ?? 0,
      storageKey: null,
    };
    if (durevole && record.size > 0 && record.size <= MAX_ALLEGATO_BYTE) {
      try {
        const { storageKey } = await putFile(
          "comunicazioni",
          casella.id,
          uid,
          nome,
          a.content,
          record.mimeType
        );
        record.storageKey = storageKey;
      } catch (e: any) {
        // Allegato non salvato ≠ mail persa: si registra comunque, con
        // l'elenco. Lo storage si sistema a parte.
        console.warn(`[imap] allegato non salvato (${nome}):`, e?.message ?? e);
      }
    }
    allegati.push(record);
  }

  // In uscita il mittente siamo noi: la controparte da riconoscere è il
  // destinatario, altrimenti ogni messaggio inviato si collegherebbe a
  // nessuno (o peggio, a noi stessi).
  const controparte =
    direzione === "out"
      ? (indirizzi(parsed.to)[0] ?? mittente)
      : mittente;
  const match = matchComunicazione({
    mittente: controparte,
    oggetto,
    testo,
    clienti,
    commesse,
  });
  const receivedAt =
    parsed.date ?? params.internalDate ?? new Date();

  const inserita = await insertComunicazione({
    sedeId: casella.sedeId,
    casellaId: casella.id,
    messageId,
    uid,
    canale: "email",
    direzione,
    mittente,
    mittenteNome: parsed.from?.value?.[0]?.name ?? null,
    destinatari: [...indirizzi(parsed.to), ...indirizzi(parsed.cc)],
    oggetto,
    testo,
    allegati,
    clienteId: match.clienteId,
    commessaId: match.commessaId,
    matchConfidenza: match.confidenza,
    matchMotivo: match.motivo,
    // Un messaggio partito da noi non è lavoro in arrivo: entra già
    // gestito, e serve come memoria di cosa è stato mandato a chi.
    stato: direzione === "out" ? "gestita" : "nuova",
    tarsAnalizzata: direzione === "out" || èStorica(receivedAt),
    segnaliFiltro: {
      spamStatus: headerTesto(parsed, "x-spam-status"),
      spamFlag: headerTesto(parsed, "x-spam-flag"),
      spamScore:
        headerTesto(parsed, "x-spam-score") ??
        headerTesto(parsed, "x-spam-level"),
      listUnsubscribe: headerTesto(parsed, "list-unsubscribe"),
      precedence: headerTesto(parsed, "precedence"),
    },
    receivedAt,
  });
  return inserita != null;
}

/** Sincronizza una casella. Non lancia: l'esito porta l'errore con sé. */
export async function sincronizzaCasella(casella: Casella): Promise<EsitoSync> {
  const esito: EsitoSync = {
    casellaId: casella.id,
    nome: casella.nome,
    importate: 0,
    saltate: 0,
    errore: null,
  };

  const client = new ImapFlow(opzioniConnessione(casella));
  try {
    await client.connect();
    const box = await client.mailboxOpen(casella.cartella || "INBOX", {
      readOnly: true,
    });

    const uidValidity = String(box.uidValidity ?? "");
    // uidValidity diversa = gli UID precedenti non significano più nulla.
    const ripartiDaCapo =
      casella.uidValidity != null && casella.uidValidity !== uidValidity;
    if (ripartiDaCapo) {
      console.warn(
        `[imap] ${casella.indirizzo}: uidValidity cambiata (${casella.uidValidity} → ${uidValidity}), riparto dagli ultimi messaggi`
      );
    }

    const dopo =
      ripartiDaCapo || casella.ultimoUid == null ? null : casella.ultimoUid;

    let range: string | number[];
    let limite: number;
    if (dopo != null) {
      range = `${dopo + 1}:*`;
      limite = MAX_PER_SYNC;
    } else {
      // Prima sincronizzazione: per DATA — gli ultimi PRIMA_SYNC_GIORNI di
      // posta, col tetto MAX_BACKFILL. Non tutto l'archivio.
      const since = new Date(Date.now() - PRIMA_SYNC_GIORNI * 86_400_000);
      const uids = await client.search({ since }, { uid: true });
      range = (Array.isArray(uids) ? uids : [])
        .sort((a, b) => a - b)
        .slice(-MAX_BACKFILL);
      limite = MAX_BACKFILL;
      console.log(
        `[imap] ${casella.indirizzo}: prima sincronizzazione, ${range.length} messaggi negli ultimi ${PRIMA_SYNC_GIORNI} giorni`
      );
    }

    // Anagrafiche in memoria una volta sola: il match gira per ogni mail.
    const sedeId = casella.sedeId;
    const clienti = getClientiStore().filter((c: any) => c.sedeId === sedeId);
    const commesse = getCommesseStore().filter((c: any) => c.sedeId === sedeId);
    const durevole = storageDurevole();

    let maxUid = dopo ?? 0;
    let visti = 0;

    // Con zero UID trovati non si chiama fetch (un set vuoto non è un
    // range valido): il giro sotto semplicemente non parte.
    const daLeggere: Array<string | number[]> =
      Array.isArray(range) && range.length === 0 ? [] : [range];
    for (const r of daLeggere)
    for await (const msg of client.fetch(
      r as any,
      { uid: true, source: true, envelope: true, internalDate: true },
      { uid: true }
    )) {
      if (visti >= limite) break;
      visti++;
      const uid = msg.uid ?? 0;
      if (uid > maxUid) maxUid = uid;
      // `${n}:*` restituisce sempre almeno un messaggio anche quando non ce
      // ne sono di nuovi: scartiamo quelli già visti.
      if (dopo != null && uid <= dopo) {
        esito.saltate++;
        continue;
      }
      if (!msg.source) {
        esito.saltate++;
        continue;
      }

      try {
        const inserita = await elaboraMessaggio({
          casella,
          uid,
          source: msg.source,
          internalDate: msg.internalDate ? new Date(msg.internalDate as any) : null,
          clienti,
          commesse,
          durevole,
        });
        if (inserita) esito.importate++;
        else esito.saltate++;
      } catch (e: any) {
        // Una mail malformata non deve fermare la sincronizzazione.
        console.warn(
          `[imap] messaggio uid ${uid} non elaborato:`,
          e?.message ?? e
        );
        esito.saltate++;
      }
    }

    // ── Il lato in uscita del fascicolo (punto 30 del piano 08/09/2026).
    // Stessa connessione, stessa logica incrementale, altra cartella. Vive
    // solo se la casella dichiara `cartellaInviati`: leggere gli inviati
    // cambia cosa entra nel CRM, e si accende una casella alla volta.
    if (casella.cartellaInviati) {
      try {
        const boxOut = await client.mailboxOpen(casella.cartellaInviati, {
          readOnly: true,
        });
        const dopoOut = casella.ultimoUidInviati ?? null;
        let rangeOut: string | number[];
        if (dopoOut != null) {
          rangeOut = `${dopoOut + 1}:*`;
        } else {
          const since = new Date(Date.now() - PRIMA_SYNC_GIORNI * 86_400_000);
          const uids = await client.search({ since }, { uid: true });
          rangeOut = (Array.isArray(uids) ? uids : [])
            .sort((a, b) => a - b)
            .slice(-MAX_BACKFILL);
        }
        let maxUidOut = dopoOut ?? 0;
        let vistiOut = 0;
        const daLeggereOut: Array<string | number[]> =
          Array.isArray(rangeOut) && rangeOut.length === 0 ? [] : [rangeOut];
        for (const r of daLeggereOut)
          for await (const msg of client.fetch(
            r as any,
            { uid: true, source: true, envelope: true, internalDate: true },
            { uid: true }
          )) {
            if (vistiOut >= MAX_PER_SYNC) break;
            vistiOut++;
            const uidOut = msg.uid ?? 0;
            if (uidOut > maxUidOut) maxUidOut = uidOut;
            if ((dopoOut != null && uidOut <= dopoOut) || !msg.source) {
              esito.saltate++;
              continue;
            }
            try {
              const inserita = await elaboraMessaggio({
                casella,
                uid: uidOut,
                source: msg.source,
                internalDate: msg.internalDate ? new Date(msg.internalDate as any) : null,
                clienti,
                commesse,
                durevole,
                direzione: "out",
              });
              if (inserita) esito.importate++;
              else esito.saltate++;
            } catch (e: any) {
              console.warn(
                `[imap] inviato uid ${uidOut} non elaborato:`,
                e?.message ?? e
              );
              esito.saltate++;
            }
          }
        casella.ultimoUidInviati = maxUidOut > 0 ? maxUidOut : casella.ultimoUidInviati;
        void boxOut;
      } catch (e: any) {
        // La cartella degli inviati che non si apre non deve far fallire
        // la posta in arrivo: si annota e si va avanti.
        console.warn(
          `[imap] ${casella.indirizzo}: cartella inviati «${casella.cartellaInviati}» non leggibile:`,
          e?.message ?? e
        );
      }
    }

    // Avanza il segnalibro solo dopo un giro andato a buon fine.
    casella.ultimoUid = maxUid > 0 ? maxUid : casella.ultimoUid;
    casella.uidValidity = uidValidity;
    casella.ultimaSync = new Date();
    casella.ultimoErrore = null;
    casella.messaggiImportati =
      (casella.messaggiImportati ?? 0) + esito.importate;
    casella.updatedAt = new Date();
    saveCaselle();

  } catch (e: any) {
    esito.errore = messaggioErrore(e);
    casella.ultimoErrore = esito.errore;
    casella.ultimaSync = new Date();
    casella.updatedAt = new Date();
    saveCaselle();
  } finally {
    await client.logout().catch(() => {
      try {
        client.close();
      } catch {
        /* la connessione era già andata */
      }
    });
  }

  return esito;
}

/**
 * Importa lo storico di una casella GIÀ sincronizzata: il segnalibro UID è
 * avanti e da solo non torna indietro, quindi qui si cerca per data
 * (ultimi PRIMA_SYNC_GIORNI, tetto MAX_BACKFILL) e si lascia che l'insert
 * idempotente scarti ciò che c'è già. Le mail vecchie entrano col match ma
 * fuori dalla coda di analisi Tars. Il segnalibro non viene toccato.
 */
export async function importaStorico(casella: Casella): Promise<EsitoSync> {
  const esito: EsitoSync = {
    casellaId: casella.id,
    nome: casella.nome,
    importate: 0,
    saltate: 0,
    errore: null,
  };
  const client = new ImapFlow(opzioniConnessione(casella));
  try {
    await client.connect();
    await client.mailboxOpen(casella.cartella || "INBOX", { readOnly: true });

    const since = new Date(Date.now() - PRIMA_SYNC_GIORNI * 86_400_000);
    const uids = await client.search({ since }, { uid: true });
    const lista = (Array.isArray(uids) ? uids : [])
      .sort((a, b) => a - b)
      .slice(-MAX_BACKFILL);
    console.log(
      `[imap] ${casella.indirizzo}: importazione storico, ${lista.length} messaggi candidati`
    );

    const sedeId = casella.sedeId;
    const clienti = getClientiStore().filter((c: any) => c.sedeId === sedeId);
    const commesse = getCommesseStore().filter((c: any) => c.sedeId === sedeId);
    const durevole = storageDurevole();

    if (lista.length > 0) {
      for await (const msg of client.fetch(
        lista,
        { uid: true, source: true, internalDate: true },
        { uid: true }
      )) {
        const uid = msg.uid ?? 0;
        if (!msg.source) {
          esito.saltate++;
          continue;
        }
        try {
          const inserita = await elaboraMessaggio({
            casella,
            uid,
            source: msg.source,
            internalDate: msg.internalDate
              ? new Date(msg.internalDate as any)
              : null,
            clienti,
            commesse,
            durevole,
          });
          if (inserita) esito.importate++;
          else esito.saltate++;
        } catch (e: any) {
          console.warn(
            `[imap] storico: messaggio uid ${uid} non elaborato:`,
            e?.message ?? e
          );
          esito.saltate++;
        }
      }
    }
  } catch (e: any) {
    esito.errore = messaggioErrore(e);
  } finally {
    await client.logout().catch(() => {
      try {
        client.close();
      } catch {
        /* la connessione era già andata */
      }
    });
  }
  return esito;
}

/** Sincronizza tutte le caselle attive di una sede (o di tutte). */
export async function sincronizzaTutte(sedeId?: number): Promise<EsitoSync[]> {
  const target = caselle.filter(
    (c) => c.attiva && (sedeId == null || c.sedeId === sedeId)
  );
  const esiti: EsitoSync[] = [];
  // In serie: su hosting condiviso le connessioni parallele si fanno
  // limitare, e non c'è alcuna fretta.
  for (const c of target) {
    esiti.push(await sincronizzaCasella(c));
  }
  return esiti;
}

// ── Watcher IDLE ────────────────────────────────────────────────────────────
// Una connessione persistente per casella attiva: il server IMAP segnala
// l'arrivo di posta (evento `exists`) e la sincronizzazione parte subito.
// Se la connessione cade si riprova con backoff (30s → 5min); il poller
// qui sotto resta come rete di sicurezza per quando l'IDLE non funziona.

type Watcher = { stop: () => void };
const watchers = new Map<number, Watcher>();

function avviaWatcher(casella: Casella): Watcher {
  let fermo = false;
  let client: ImapFlow | null = null;
  let backoffMs = 30_000;
  let syncTimer: NodeJS.Timeout | null = null;

  // L'evento può arrivare a raffica (una mail per volta): si sincronizza
  // qualche secondo dopo l'ultimo avviso, una volta sola.
  // Il confine con imapflow perde il contesto del tenant: i suoi callback
  // (`exists`, la riconnessione) girano fuori da qualunque `conTenant`.
  // Il contesto si rimette qui, l'unico punto in cui il watcher tocca gli
  // store — così vale per ogni chiamante di `syncPresto`, presente e futuro.
  const syncPresto = () => {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncTimer = null;
      void conTenantDellaSede(casella.sedeId, () =>
        sincronizzaCasella(casella)
      ).catch(() => {});
    }, 3_000);
  };

  const vita = async () => {
    while (!fermo) {
      try {
        client = new ImapFlow(opzioniConnessione(casella, true));
        // L'handler d'errore va attaccato PRIMA di connect: un errore senza
        // listener butta giù il processo.
        client.on("error", () => {});
        client.on("exists", () => syncPresto());
        await client.connect();
        await client.mailboxOpen(casella.cartella || "INBOX", { readOnly: true });
        backoffMs = 30_000; // connessione riuscita: reset del backoff
        // Resta qui finché la connessione vive; imapflow tiene l'IDLE da solo.
        await new Promise<void>((resolve) => {
          client!.on("close", () => resolve());
          client!.on("error", () => resolve());
        });
      } catch {
        // Connessione fallita: si ritenta sotto con backoff.
      }
      if (fermo) break;
      await new Promise((r) => setTimeout(r, backoffMs));
      backoffMs = Math.min(backoffMs * 2, 5 * 60_000);
    }
  };
  void vita();

  return {
    stop: () => {
      fermo = true;
      if (syncTimer) clearTimeout(syncTimer);
      try {
        client?.close();
      } catch {
        /* già chiusa */
      }
    },
  };
}

/**
 * Allinea i watcher alle caselle attive di OGNI azienda. Da chiamare a ogni
 * modifica: la mappa è per `casella.id` (gli id sono globali fra i tenant),
 * quindi fermare tutto e ripartire resta corretto anche quando la chiamata
 * arriva da una richiesta di un solo tenant — prima, in quel caso, i
 * watcher delle altre aziende restavano fermi.
 *
 * `dip.avvia` (default `avviaWatcher`) è iniettabile solo per i test.
 */
export async function riavviaWatchers(dip?: {
  avvia?: (casella: Casella) => Watcher;
}): Promise<void> {
  const avvia = dip?.avvia ?? avviaWatcher;
  for (const w of Array.from(watchers.values())) w.stop();
  watchers.clear();
  await perOgniTenantAttivo("imap-watcher", async () => {
    for (const c of caselle.filter((c) => c.attiva)) {
      watchers.set(c.id, avvia(c));
    }
  });
  if (watchers.size > 0) {
    console.log(`[imap] watcher IDLE su ${watchers.size} caselle`);
  }
}

// ── Poller (rete di sicurezza) ──────────────────────────────────────────────

let timer: NodeJS.Timeout | null = null;
const INTERVALLO_MS = 5 * 60 * 1000;

/**
 * Un giro del poller: una passata per ogni azienda attiva, nel suo contesto.
 * `caselle` è il Proxy dello store per tenant — dentro `conTenant` elenca
 * le caselle di quel tenant, e `sincronizzaTutte()` sincronizza le sue.
 * Fuori da qualunque contesto (com'era prima) il giro esplodeva al primo
 * accesso allo store. Il try/catch resta per tenant: una casella che non
 * risponde non ferma le altre aziende.
 *
 * `dip.sincronizza` (default `sincronizzaTutte`) è iniettabile solo per i test.
 */
export async function giroPollerMail(dip?: {
  sincronizza?: (sedeId?: number) => Promise<EsitoSync[]>;
}): Promise<void> {
  const sincronizza = dip?.sincronizza ?? sincronizzaTutte;
  await perOgniTenantAttivo("imap", async () => {
    try {
      const attive = caselle.filter((c) => c.attiva);
      if (attive.length === 0) return;
      const esiti = await sincronizza();
      const tot = esiti.reduce((s, e) => s + e.importate, 0);
      if (tot > 0) console.log(`[imap] poller: ${tot} nuove comunicazioni`);
    } catch (e: any) {
      console.error("[imap] poller:", e?.message ?? e);
    }
  });
}

export function avviaPollerMail() {
  if (timer) return;
  timer = setInterval(() => void giroPollerMail(), INTERVALLO_MS);
  // Primo giro (e primi watcher) dopo un minuto: lascia finire il
  // bootstrap degli store, che a freddo può metterci qualche secondo.
  setTimeout(() => {
    void giroPollerMail();
    void riavviaWatchers();
  }, 60_000);
  console.log("[imap] poller avviato (ogni 5 minuti) + watcher IDLE");
}
