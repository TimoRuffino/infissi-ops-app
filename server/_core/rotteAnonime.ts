// server/_core/rotteAnonime.ts
// I corpi delle rotte Express che non hanno un utente: handshake e webhook
// di WhatsApp (li chiama Meta) e feed ICS (li scarica Google Calendar).
//
// Perché esistono qui e non dentro `index.ts` (fix wave finale, F1):
//
//  1. TENANT. Senza utente non c'è tenant nel contesto della richiesta, ma
//     ogni store che queste rotte leggono (`whatsapp_app`, `whatsapp_config`,
//     `calendar_tokens`) è PER TENANT. L'URL però è UNO per tutta
//     l'installazione: Meta lo configura una volta, Google lo sottoscrive con
//     un token. Il proprietario si scopre quindi cercando in ogni tenant
//     attivo (`trovaNeiTenant`), e il lavoro vero si esegue nel contesto del
//     tenant della sede trovata (`conTenantDellaSede`). Con l'interruttore
//     spento `trovaNeiTenant` fa un giro solo, sul tenant 1: comportamento
//     di oggi invariato.
//  2. PROVABILITÀ. Express 4 non cattura la promise rifiutata di un handler
//     `async`: una lettura che lancia farebbe cadere il processo, e Meta e i
//     calendari riprovano — un ciclo di riavvii. Il rifiuto va gestito nel
//     chiamante, e queste funzioni devono essere provabili senza alzare un
//     server HTTP.
//
// Gli import dei moduli di dominio restano dinamici, come nelle rotte di
// prima: tengono questo modulo fuori dal grafo statico di `index.ts` e non
// anticipano il caricamento dei router rispetto al boot dei tenant.
import { conTenantDellaSede, trovaNeiTenant } from "../tenants/giri";

/** Il tenant e la sede a cui appartiene un webhook WhatsApp verificato. */
export type MittenteWhatsApp = { tenantId: number; sedeId: number };

/**
 * GET /api/webhook/whatsapp — l'handshake di Meta. Il verify token vale se
 * lo riconosce QUALUNQUE tenant: l'URL del callback è uno solo, e la seconda
 * azienda non potrebbe altrimenti validare il proprio.
 */
export async function verifyTokenDiQualcheTenant(token: string): Promise<boolean> {
  if (!token) return false;
  const { verifyTokenValido } = await import("../comunicazioni/whatsapp");
  const trovato = await trovaNeiTenant("whatsapp-webhook", () =>
    verifyTokenValido(token) ? true : null
  );
  return trovato != null;
}

/**
 * POST /api/webhook/whatsapp — di chi è questa firma?
 *
 * Il payload dice a quale numero appartiene, ma leggerlo prima di verificare
 * significherebbe fidarsi: si prova invece la firma con ogni app secret
 * disponibile — quello del numero o, con l'Embedded Signup, quello a livello
 * di app — tenant per tenant. Il primo che valida è il proprietario, e la sua
 * sede dice in quale archivio va scritto il messaggio.
 *
 * `null` = nessuno ha la chiave giusta: si rifiuta senza aver letto nulla.
 */
export async function mittenteWebhookWhatsApp(
  raw: Buffer,
  firma: string | undefined
): Promise<MittenteWhatsApp | null> {
  const { verificaFirma, configWhatsApp, appSecretPer, tutteLeAppWhatsApp } =
    await import("../comunicazioni/whatsapp");
  const { decryptSecret } = await import("./secretBox");
  const trovato = await trovaNeiTenant<number>("whatsapp-webhook", () => {
    for (const c of configWhatsApp) {
      if (!c.attiva) continue;
      const segreto = appSecretPer(c);
      if (segreto && verificaFirma(raw, firma, segreto)) return c.sedeId;
    }
    for (const a of tutteLeAppWhatsApp()) {
      if (!a.appSecretCifrato) continue;
      let segreto: string;
      try {
        segreto = decryptSecret(a.appSecretCifrato);
      } catch {
        continue; // chiave di cifratura assente o cambiata
      }
      if (verificaFirma(raw, firma, segreto)) return a.sedeId;
    }
    return null;
  });
  return trovato == null ? null : { tenantId: trovato.tenantId, sedeId: trovato.valore };
}

/** I `phone_number_id` distinti del payload, nell'ordine in cui compaiono. */
export function numeriDelPayload(payload: unknown): string[] {
  const numeri: string[] = [];
  for (const entry of (payload as any)?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const id = change?.value?.metadata?.phone_number_id;
      if (id != null && !numeri.includes(String(id))) numeri.push(String(id));
    }
  }
  return numeri;
}

/** Lo stesso payload ridotto alle entry/changes di un numero. */
export function payloadDelNumero(payload: any, phoneNumberId: string): any {
  const entry = (payload?.entry ?? [])
    .map((e: any) => ({ ...e, changes: (e?.changes ?? []).filter((c: any) => String(c?.value?.metadata?.phone_number_id ?? "") === phoneNumberId) }))
    .filter((e: any) => e.changes.length > 0);
  return { ...payload, entry };
}

/**
 * L'ingestione, DOPO la firma, azienda per azienda in base al numero (WS3
 * spec §6): con l'Embedded Signup il segreto dell'app è uno per tutte le
 * aziende, quindi la firma non dice di chi è il messaggio — lo dice il
 * `phone_number_id`, cercato in `configWhatsApp` di ogni azienda attiva.
 * Un numero che nessuna azienda segue si logga e basta: Meta non deve riprovare.
 */
export async function ingestisciWebhookPerNumero(payload: unknown): Promise<{ ricevuti: number; numeriSconosciuti: string[] }> {
  const { ingestisciWebhook, configPerPhoneNumberId } = await import("../comunicazioni/whatsapp");
  let ricevuti = 0;
  const numeriSconosciuti: string[] = [];
  for (const numero of numeriDelPayload(payload)) {
    const trovato = await trovaNeiTenant<number>("whatsapp-webhook", () => configPerPhoneNumberId(numero)?.sedeId ?? null);
    if (!trovato) {
      numeriSconosciuti.push(numero);
      console.warn(`[whatsapp-webhook] numero sconosciuto: ${numero}`);
      continue;
    }
    ricevuti += await conTenantDellaSede(trovato.valore, () => ingestisciWebhook(payloadDelNumero(payload, numero)));
  }
  return { ricevuti, numeriSconosciuti };
}

export type FeedIcs = { corpo: string; nomeFile: string };

/**
 * GET /api/ics/:token/:feed — il feed della sede a cui appartiene il token.
 * `null` = token sconosciuto (404): nessuna informazione su quali token
 * esistano, in nessun tenant.
 */
export async function feedIcsPerToken(
  token: string,
  feed: string
): Promise<FeedIcs | null> {
  if (!token) return null;
  const { sedeForToken, buildIcs } = await import("../routers/calendarSync");
  const trovato = await trovaNeiTenant("ics", () => sedeForToken(token));
  if (!trovato) return null;
  const sedeId = trovato.valore;
  const feedKey = (feed || "tutti.ics").replace(/\.ics$/i, "");
  const corpo = conTenantDellaSede(sedeId, () => buildIcs(sedeId, feedKey));
  return { corpo, nomeFile: `ruffino-${feedKey}.ics` };
}
