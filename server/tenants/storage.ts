// server/tenants/storage.ts
// Contabilità dei byte per azienda (WS3, spec §3.2): il ledger vive nel
// control plane (`tenant_storage`), lo aggiorna ogni put/delete di
// fileStorage.ts attraverso il contabile iniettato, e le soglie 50/80/100 %
// della quota diventano eventi di `tenant_eventi`. Nessun blocco: la quota
// conta e avvisa (decisione 5); chi blocca è il WS4.
import type { ContabileStorage } from "../_core/fileStorage";
import { getTenantRepository } from "./repository";
import type { StatoStorage } from "./tipi";

export const SOGLIE_STORAGE = [50, 80, 100] as const;
export type SogliaStorage = 0 | 50 | 80 | 100;

export function percentualeStorage(bytes: number, quotaBytes: number): number {
  if (quotaBytes <= 0) return 0;
  return Math.round((bytes / quotaBytes) * 1000) / 10;
}

export function sogliaRaggiunta(bytes: number, quotaBytes: number): SogliaStorage {
  const p = quotaBytes > 0 ? (bytes / quotaBytes) * 100 : 0;
  let raggiunta: SogliaStorage = 0;
  for (const s of SOGLIE_STORAGE) if (p >= s) raggiunta = s;
  return raggiunta;
}

/**
 * Avvisa la soglia più alta raggiunta se è superiore all'ultima avvisata
 * (un evento per attraversamento, mai uno per upload); sotto il 50 % si
 * riarma, così un'azienda che libera spazio e lo riempie di nuovo riceve
 * un nuovo avviso.
 */
export async function applicaSoglie(stato: StatoStorage, attore = "sistema"): Promise<SogliaStorage | null> {
  const repo = getTenantRepository();
  const raggiunta = sogliaRaggiunta(stato.bytes, stato.quotaBytes);
  if (raggiunta > stato.sogliaAvvisata) {
    await repo.registraEvento({
      tenantId: stato.tenantId,
      tipo: "storage_soglia",
      attore,
      dettagli: { percentuale: raggiunta, bytes: stato.bytes, quotaBytes: stato.quotaBytes },
    });
    await repo.impostaSogliaAvvisata(stato.tenantId, raggiunta);
    return raggiunta;
  }
  if (raggiunta === 0 && stato.sogliaAvvisata > 0) {
    await repo.impostaSogliaAvvisata(stato.tenantId, 0);
  }
  return null;
}

export function creaContabileStorage(): ContabileStorage {
  return {
    async aggiungi(tenantId, bytes, file) {
      await applicaSoglie(await getTenantRepository().aggiornaStorage(tenantId, bytes, file));
    },
    async togli(tenantId, bytes, file) {
      await applicaSoglie(await getTenantRepository().aggiornaStorage(tenantId, -bytes, -file));
    },
  };
}
