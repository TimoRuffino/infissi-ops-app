// server/tenants/giri.ts
// Giri per tenant e per sede (Fix round 1, Task 7): chi deve girare "una
// volta per ogni tenant attivo" (worker, riconciliazioni al boot) o "nel
// tenant di questa sede" (funzioni scritte per sede, non per tenant).
//
// Separato da ./contestoCorrente (che resta una foglia del grafo dei moduli)
// perché queste funzioni hanno bisogno di ./contesto (tenantIdDellaSede) e
// ./repository (l'elenco dei tenant), che a loro volta risalgono fino a
// routers/sedi e routers/utenti: tenerle in contestoCorrente.ts chiuderebbe
// un ciclo con _core/trpc.ts (che importa `conTenant` da lì) e farebbe
// crashare al semplice import qualunque entry point che importi un router
// prima di contestoCorrente.ts.
import { interruttoreAttivo } from "../platform/interruttori";
import { TENANT_PREDEFINITO_ID } from "./costanti";
import { conTenant } from "./contestoCorrente";
import { tenantIdDellaSede } from "./contesto";
import { getTenantRepository } from "./repository";

export function conTenantDellaSede<T>(sedeId: number, fn: () => T): T {
  return conTenant(tenantIdDellaSede(sedeId), fn);
}

/** I tenant per cui girano i worker: attivi (mai i sospesi: sola lettura), 1 se il control plane è vuoto o l'interruttore spento. */
export function tenantsAttivi(): number[] {
  if (!interruttoreAttivo("multiAzienda")) return [TENANT_PREDEFINITO_ID];
  const tutti = getTenantRepository().tutti();
  if (tutti.length === 0) return [TENANT_PREDEFINITO_ID];
  return tutti.filter(t => t.stato === "attivo").map(t => t.id);
}

/** Un giro per tenant, ognuno nel suo contesto; un errore di un tenant non ferma gli altri. */
export async function perOgniTenantAttivo(
  etichetta: string,
  fn: (tenantId: number) => Promise<void>
): Promise<void> {
  for (const tenantId of tenantsAttivi()) {
    try {
      await conTenant(tenantId, () => fn(tenantId));
    } catch (errore) {
      console.error(`[${etichetta}] tenant ${tenantId}:`, errore instanceof Error ? errore.message : errore);
    }
  }
}
