// server/abbonamenti/worker.ts
// Il giro periodico degli abbonamenti (spec WS4 §4.1): un giro per ogni
// tenant attivo, subito dopo il boot e poi ogni 6 ore, come il worker di FiC
// (`server/fatture/sonda.ts`) — `setInterval` con `unref()`, mai un cron
// esterno. `perOgniTenantAttivo` (`server/tenants/giri.ts`) fa il resto:
// esclude i sospesi (`tenantsAttivi()`), isola un tenant che fallisce
// dall'altro, e sospende un'azienda rumorosa con l'interruttore per
// (worker, azienda) del WS3.
//
// A `FLAG_MULTI_AZIENDA` spento il worker non parte (decisione 6 dell'08/09):
// l'unica riga che esiste a interruttore spento è l'omaggio del tenant 1,
// seminato da `completaTenants` PRIMA di questo avvio (control plane,
// sempre) — nessun giro lo tocca comunque, `valutaAbbonamento` esce subito
// per id.
import { interruttoreAttivo } from "../platform/interruttori";
import { perOgniTenantAttivo } from "../tenants/giri";
import { valutaAbbonamento } from "./servizio";

/** Ogni 6 ore: gli stati dell'abbonamento non hanno bisogno di più fretta. */
const INTERVALLO_MS = 6 * 3_600_000;

/**
 * Un giro su ogni tenant attivo (spec §4.1), tutti allo stesso istante: chi
 * scade "oggi" scade per l'intero giro, non per chi capita prima nell'elenco.
 * `adesso` è per i test; il worker vero non lo passa mai e cade su
 * `new Date()`, presa una volta sola all'inizio del giro.
 */
export async function giroAbbonamenti(adesso?: Date): Promise<void> {
  const istante = adesso ?? new Date();
  await perOgniTenantAttivo("abbonamenti", async tenantId => {
    await valutaAbbonamento(tenantId, istante);
  });
}

let intervallo: NodeJS.Timeout | null = null;

/**
 * Chiamata da `completaTenants` dopo il boot, e da `index.ts` dopo il
 * `listen` (Task 3): solo con l'interruttore acceso. Un giro subito, poi
 * ogni 6 ore. Idempotente — senza un `fermaWorkerAbbonamenti()` di mezzo una
 * seconda chiamata non apre un secondo intervallo (stesso pattern di
 * `startSondaFattureWorker`).
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
