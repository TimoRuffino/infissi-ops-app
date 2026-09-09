// server/abbonamenti/notifiche.ts
// Le notifiche che l'azienda riceve sul proprio contratto e sulle proprie
// risorse misurate (spec WS4 §8): scadenza della prova, insoluto, sola
// lettura, storage e budget Tars vicini o oltre il limite.
//
// Destinatari: proprietari e direzione ATTIVI dell'azienda — chi può fare
// qualcosa (pagare, chiedere una proroga, liberare spazio, alzare il
// budget). Un commerciale non riceve nulla: l'avviso in shell (§8) è
// un'altra strada, non questa.
//
// Il canale è quello delle notifiche già in casa (`server/notifications/`):
// stesso repository, stesso segnale SSE, stessa consegna push, stesso
// interruttore per sede (`notificationMode: "active"`). Niente di nuovo da
// tenere in piedi, e una sede ancora in `legacy`/`shadow` semplicemente non
// riceve — senza errori, senza righe scritte.
//
// Nessuna di queste chiamate può far fallire ciò che la origina: una
// transizione di stato, un caricamento, una chiamata a Tars valgono di più
// di una notifica. `notificaAzienda` non lancia mai: registra e restituisce
// quante ne ha create.
import { deliverStoredNotification } from "../notifications/deliveryWorker";
import { getNotificationRepository } from "../notifications/repository";
import { publishNotificationSignal } from "../notifications/sse";
import { getFeatureFlags } from "../platform/featureFlags";
import { sediAttiveDelTenant } from "../routers/sedi";
import { getUtentiStore } from "../routers/utenti";
import { RUOLO_PROPRIETARIO } from "../tenants/costanti";
import { presidioDi } from "../tenants/regole";

export type TipoNotificaAzienda =
  | "abbonamento.avviso"
  | "abbonamento.insoluto"
  | "abbonamento.sospeso"
  | "consumi.storage"
  | "consumi.tars";

/** La scheda «Abbonamento e consumi» (spec §8): unica destinazione utile. */
const LINK_SCHEDA = "/integrazioni?scheda=abbonamento";

const RUOLI_DESTINATARI = [RUOLO_PROPRIETARIO, "direzione"];

export type DestinatarioAzienda = { id: number; sedeId: number };

/**
 * Proprietari e direzione attivi dell'azienda, ciascuno con la sede in cui
 * riceverà la notifica: la prima sede attiva del tenant fra le sue, altrimenti
 * la prima sede attiva del tenant. Le notifiche sono per sede (`sedeId` fa
 * parte della chiave di lettura del feed): un destinatario senza una sede
 * risolvibile — azienda senza sedi attive — viene saltato, perché una
 * notifica scritta su una sede che non gli appartiene non gliela farebbe
 * comunque leggere.
 */
export function destinatariAzienda(tenantId: number): DestinatarioAzienda[] {
  const sediAttive = sediAttiveDelTenant(tenantId).map(s => s.id);
  if (sediAttive.length === 0) return [];
  const destinatari: DestinatarioAzienda[] = [];
  for (const utente of getUtentiStore()) {
    const presidio = presidioDi(utente);
    if (!presidio.attivo || presidio.tenantId !== tenantId) continue;
    if (!presidio.ruoli.some(r => RUOLI_DESTINATARI.includes(r))) continue;
    const sue: unknown = (utente as { sediIds?: unknown }).sediIds;
    const sueIds = Array.isArray(sue) ? sue : [];
    const sedeId = sediAttive.find(id => sueIds.includes(id)) ?? sediAttive[0];
    destinatari.push({ id: presidio.id, sedeId });
  }
  return destinatari;
}

function avvisa(tipo: TipoNotificaAzienda, tenantId: number, utenteId: number | null, errore: unknown): void {
  const dettaglio = errore instanceof Error ? errore.message : String(errore);
  // Mai dati dell'utente oltre agli id: qui passano titoli e corpi che
  // nominano l'azienda, e un log non è il posto dove tenerli.
  console.warn(
    `[abbonamenti] notifica ${tipo} non consegnata (tenant ${tenantId}` +
      `${utenteId == null ? "" : `, utente ${utenteId}`}): ${dettaglio}`
  );
}

/**
 * Scrive la notifica a ogni destinatario la cui sede ha le notifiche attive e
 * restituisce quante ne ha CREATE. `chiave` identifica l'evento (non il
 * destinatario): la `canonicalKey` finale la completa con l'id di chi riceve,
 * così lo stesso evento non arriva due volte alla stessa persona ma arriva a
 * tutte. È la deduplicazione che rende innocuo chiamare questa funzione da un
 * worker che ripassa: la seconda volta `created` è falso e non si consegna
 * nulla.
 */
export async function notificaAzienda(input: {
  tenantId: number;
  tipo: TipoNotificaAzienda;
  titolo: string;
  corpo: string;
  chiave: string;
  priorita: "high" | "normal";
  adesso: Date;
}): Promise<number> {
  let create = 0;
  try {
    const destinatari = destinatariAzienda(input.tenantId);
    if (destinatari.length === 0) return 0;
    const repository = getNotificationRepository();
    for (const destinatario of destinatari) {
      try {
        if (getFeatureFlags(destinatario.sedeId).notificationMode !== "active") continue;
        const esito = await repository.upsert({
          sedeId: destinatario.sedeId,
          recipientUserId: destinatario.id,
          canonicalKey: `${input.chiave}:${destinatario.id}`,
          type: input.tipo,
          priority: input.priorita,
          title: input.titolo,
          body: input.corpo,
          link: LINK_SCHEDA,
          groupKey: `azienda:${input.tipo}`,
          // Nessun evento business dietro: qui la sorgente è il dominio
          // degli abbonamenti, non il bus (spec §8, variante del piano).
          sourceEventId: null,
          entityRefs: [{ type: "tenant", id: String(input.tenantId) }],
          createdAt: input.adesso,
          expiresAt: null,
        });
        if (!esito.created) continue;
        create += 1;
        const segnale = {
          notificationId: esito.id,
          recipientUserId: destinatario.id,
          sedeId: destinatario.sedeId,
        };
        await publishNotificationSignal(segnale);
        await deliverStoredNotification(segnale);
      } catch (errore) {
        avvisa(input.tipo, input.tenantId, destinatario.id, errore);
      }
    }
  } catch (errore) {
    avvisa(input.tipo, input.tenantId, null, errore);
  }
  return create;
}
