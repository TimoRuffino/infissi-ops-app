import { sediAttiveDelTenant } from "../routers/sedi";
import { segnaliFollowupPreventivi } from "../tars/followup/preventivi";
import { osservaDaReconcile } from "../tars/proattivita/worker";
import { segnaliSmistamento } from "../tars/smistamento/segnali";
import { perOgniTenantAttivo } from "../tenants/giri";
import { getActionCaseRepository } from "./repository";
import { parseActionCenterMode, reconcileActionCases } from "./reconcile";
import { groupSignals } from "./signals";
import { collectCurrentSignals } from "./sources";

const RECOVERY_INTERVAL_MS = 60_000;
const BOOT_DELAY_MS = 5_000;
const DEBOUNCE_MS = 750;
const running = new Set<number>();
const pending = new Set<number>();
const timers = new Map<number, NodeJS.Timeout>();

export const ACTION_CENTER_MODE = parseActionCenterMode(
  process.env.ACTION_CENTER_MODE
);

export async function runActionReconcile(sedeId: number): Promise<void> {
  if (ACTION_CENTER_MODE === "legacy") return;
  if (running.has(sedeId)) {
    pending.add(sedeId);
    return;
  }
  running.add(sedeId);
  try {
    const now = new Date();
    // Segnali sincroni dagli store + segnali dello smistamento Tars (asincroni,
    // dal registro): un solo reconcile, un solo insieme di casi. Un errore
    // dello smistamento non toglie i casi ordinari.
    const daStore = collectCurrentSignals(sedeId, now);
    const daSmistamento = await segnaliSmistamento(sedeId, now).catch(error => {
      console.error("[tars-smistamento] segnali non disponibili", {
        sedeId,
        message: error instanceof Error ? error.message : "unknown",
      });
      return [];
    });
    // Follow-up preventivi (T5/D3): stesso reconcile, mai uno separato.
    const daFollowup = await segnaliFollowupPreventivi(sedeId, now).catch(error => {
      console.error("[tars-followup] segnali non disponibili", {
        sedeId,
        message: error instanceof Error ? error.message : "unknown",
      });
      return [];
    });
    const signals = [...daStore, ...daSmistamento, ...daFollowup];
    const drafts = groupSignals(signals, now);
    const result = await reconcileActionCases({
      repository: getActionCaseRepository(),
      sedeId,
      drafts,
      now,
    });
    if (
      result.created > 0 ||
      result.updated > 0 ||
      result.autoResolved > 0 ||
      result.reopened > 0
    ) {
      console.info("[action-center] reconcile", {
        mode: ACTION_CENTER_MODE,
        sedeId,
        signals: signals.length,
        cases: drafts.length,
        suppressedDuplicates: Math.max(0, signals.length - drafts.length),
        ...result,
      });
    }
    // Osservatore Tars (T6): consuma gli stessi draft riconciliati, dietro
    // flag fail-closed. Un suo errore non tocca il Centro Azioni.
    try {
      await osservaDaReconcile({ sedeId, drafts, now });
    } catch (error) {
      console.error("[tars-osservatore] osservazione fallita", {
        sedeId,
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  } catch (error) {
    console.error("[action-center] reconcile failed", {
      sedeId,
      message: error instanceof Error ? error.message : "unknown",
    });
  } finally {
    running.delete(sedeId);
    if (pending.delete(sedeId)) scheduleActionReconcile(sedeId);
  }
}

export function scheduleActionReconcile(sedeId: number): void {
  const previous = timers.get(sedeId);
  if (previous) clearTimeout(previous);
  const timer = setTimeout(() => {
    timers.delete(sedeId);
    void runActionReconcile(sedeId);
  }, DEBOUNCE_MS);
  timer.unref?.();
  timers.set(sedeId, timer);
}

/**
 * Il giro di recupero: un tenant alla volta, ognuno nel suo contesto, e
 * dentro il contesto le sue sedi attive. `runActionReconcile` legge gli
 * store per tenant (segnali, casi): avviata con `void` dentro `conTenant`
 * eredita comunque il contesto — il contesto corrente segue la promise.
 * Prima leggeva `getSediStore()` (globale: le sedi di tutte le aziende)
 * fuori da qualunque contesto.
 */
export async function reconcileAllSites(): Promise<void> {
  await perOgniTenantAttivo("action-center", async tenantId => {
    for (const sede of sediAttiveDelTenant(tenantId)) void runActionReconcile(sede.id);
  });
}

export function startActionCenterScheduler(): void {
  if (ACTION_CENTER_MODE === "legacy") {
    console.info("[action-center] legacy mode");
    return;
  }
  const bootTimer = setTimeout(() => void reconcileAllSites(), BOOT_DELAY_MS);
  bootTimer.unref?.();
  const interval = setInterval(() => void reconcileAllSites(), RECOVERY_INTERVAL_MS);
  interval.unref?.();
  console.info(`[action-center] ${ACTION_CENTER_MODE} mode enabled`);
}
