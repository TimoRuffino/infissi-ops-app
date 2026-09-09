// server/abbonamenti/worker.ts
// Il giro periodico degli abbonamenti (spec WS4 §4.1): un giro per ogni
// tenant attivo, subito dopo il `listen` del server e poi ogni 6 ore, come il
// worker di FiC (`server/fatture/sonda.ts`) — `setInterval` con `unref()`,
// mai un cron esterno. `perOgniTenantAttivo` (`server/tenants/giri.ts`) fa il
// resto: esclude i sospesi (`tenantsAttivi()`), isola un tenant che fallisce
// dall'altro, e sospende un'azienda rumorosa con l'interruttore per
// (worker, azienda) del WS3.
//
// A `FLAG_MULTI_AZIENDA` spento il worker non parte (decisione 6 dell'08/09):
// l'unica riga che esiste a interruttore spento è l'omaggio del tenant 1,
// seminato da `completaTenants` PRIMA di questo avvio (control plane,
// sempre) — nessun giro lo tocca comunque, `valutaAbbonamento` esce subito
// per id.
import { interruttoreAttivo } from "../platform/interruttori";
import { TENANT_PREDEFINITO_ID } from "../tenants/costanti";
import { perOgniTenantAttivo } from "../tenants/giri";
import { getTenantRepository } from "../tenants/repository";
import { valutaAbbonamento } from "./servizio";

/** Ogni 6 ore: gli stati dell'abbonamento non hanno bisogno di più fretta. */
const INTERVALLO_MS = 6 * 3_600_000;

/**
 * Un giro su ogni tenant attivo (spec §4.1), tutti allo stesso istante: chi
 * scade "oggi" scade per l'intero giro, non per chi capita prima nell'elenco.
 * `adesso` è per i test; il worker vero non lo passa mai e cade su
 * `new Date()`, presa una volta sola all'inizio del giro.
 *
 * Task 3 fix round 1 (Ruling R8): un tenant "normale" (≠ 1) senza riga
 * abbonamento è un'anomalia — `crea` la semina sempre, anche per un tenant
 * già esistente (idempotente) — ma il worker non la ripara da solo: logga e
 * salta, l'operatore rilancia `pnpm tenant crea` con lo stesso slug (idempotente
 * anche per l'abbonamento). Il tenant 1 resta escluso da questo controllo:
 * non ha mai bisogno di una riga abbonamento (`valutaAbbonamento` esce
 * subito per id, spec §4), quindi la sua assenza non è un'anomalia da
 * segnalare.
 */
export async function giroAbbonamenti(adesso?: Date): Promise<void> {
  const istante = adesso ?? new Date();
  const repo = getTenantRepository();
  await perOgniTenantAttivo("abbonamenti", async tenantId => {
    if (tenantId !== TENANT_PREDEFINITO_ID && !repo.abbonamentoDi(tenantId)) {
      console.warn(`[abbonamenti] tenant ${tenantId} senza abbonamento: rilancia pnpm tenant crea`);
      return;
    }
    await valutaAbbonamento(tenantId, istante);
  });
}

let intervallo: NodeJS.Timeout | null = null;

/**
 * Chiamata SOLO da `index.ts`, dopo il `listen` (Task 3 fix round 1, Ruling
 * R7): mai da `completaTenants`, che gira PRIMA del listen — vedi il
 * commento lì. Solo con l'interruttore acceso. Un giro subito, poi ogni 6
 * ore. Resta idempotente (`if (intervallo) return;`) come rete di sicurezza,
 * stesso pattern di `startSondaFattureWorker`, anche se oggi un solo
 * chiamante la usa.
 */
export function avviaWorkerAbbonamenti(): void {
  if (!interruttoreAttivo("multiAzienda")) return;
  if (intervallo) return;
  void giroAbbonamenti();
  intervallo = setInterval(() => void giroAbbonamenti(), INTERVALLO_MS);
  intervallo.unref();
}

export function fermaWorkerAbbonamenti(): void {
  if (intervallo) clearInterval(intervallo);
  intervallo = null;
}

/** Solo per i test: se il timer del worker è attivo in questo momento. */
export function __timerAttivoPerTest(): boolean {
  if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY_TIMER_ABBONAMENTI");
  return intervallo !== null;
}
