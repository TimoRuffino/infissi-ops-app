// Worker dei solleciti preventivi (T5/D3): un giro ogni mezz'ora dopo le
// 07:00 locali. La dedupe è del canonicalKey dei promemoria: rigirare non
// duplica. I casi «perso» NON passano da qui: viaggiano come segnali nel
// reconcile del Centro Azioni.

import { TZDate } from "@date-fns/tz";
import { tarsAttivo } from "../../platform/interruttori";
import { getSediStore } from "../../routers/sedi";
import { giroSollecitiPreventivi } from "./preventivi";

const INTERVALLO_MS = 30 * 60 * 1000;
const ORA_MINIMA_LOCALE = 7;

export function followupPreventiviAttivo(): boolean {
  return tarsAttivo("tarsProactive") && tarsAttivo("tarsReminders");
}

export async function giroFollowup(now = new Date()): Promise<void> {
  const locale = new TZDate(now, "Europe/Rome");
  if (locale.getHours() < ORA_MINIMA_LOCALE) return;
  for (const sede of getSediStore()) {
    try {
      const esito = await giroSollecitiPreventivi({ sedeId: sede.id, adesso: now });
      if (esito.creati > 0 || esito.errori > 0) {
        console.info("[tars-followup] solleciti preventivi", { sedeId: sede.id, ...esito });
      }
    } catch (errore) {
      console.error(
        `[tars-followup] sede ${sede.id}:`,
        errore instanceof Error ? errore.message : errore
      );
    }
  }
}

let timer: NodeJS.Timeout | null = null;
let inCorso = false;

export function startFollowupPreventiviWorker(): void {
  if (timer) return;
  const tick = async () => {
    if (inCorso || !followupPreventiviAttivo()) return;
    inCorso = true;
    try {
      await giroFollowup();
    } finally {
      inCorso = false;
    }
  };
  timer = setInterval(() => void tick(), INTERVALLO_MS);
  timer.unref?.();
  setTimeout(() => void tick(), 25_000).unref?.();
}

export function stopFollowupPreventiviWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
