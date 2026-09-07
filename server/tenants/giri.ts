// server/tenants/giri.ts
// Giri per tenant e per sede (Fix round 1, Task 7): chi deve girare "una
// volta per ogni tenant attivo" (worker, riconciliazioni al boot), "nel
// tenant di questa sede" (funzioni scritte per sede, non per tenant) o
// "cercare in tutti i tenant" (le rotte anonime, che hanno un URL solo per
// tutta l'installazione).
//
// Separato da ./contestoCorrente (che resta una foglia del grafo dei moduli)
// perché queste funzioni hanno bisogno di ../routers/sedi (il tenant della
// sede) e ./repository (l'elenco dei tenant), che a loro volta risalgono fino
// a routers/utenti: tenerle in contestoCorrente.ts chiuderebbe un ciclo con
// _core/trpc.ts (che importa `conTenant` da lì) e farebbe crashare al
// semplice import qualunque entry point che importi un router prima di
// contestoCorrente.ts.
import { interruttoreAttivo } from "../platform/interruttori";
import { TENANT_PREDEFINITO_ID } from "./costanti";
import { conTenant } from "./contestoCorrente";
import { getSedeById } from "../routers/sedi";
import { getTenantRepository } from "./repository";

/**
 * Esegue `fn` nel tenant a cui appartiene la sede.
 *
 * Fail-closed (fix wave finale, R20): a interruttore ACCESO una sede che non
 * esiste lancia, invece di ripiegare sul tenant 1. Il ripiego era comodo ma
 * pericoloso: un worker (o una rotta anonima) con un `sedeId` sbagliato
 * avrebbe letto — e scritto — nell'archivio di Ruffino Group per conto di
 * un'altra azienda. Il messaggio è interno e non deve mai raggiungere
 * l'utente. A interruttore spento resta il tenant 1, cioè il comportamento
 * di sempre. `tenantIdDellaSede` (./contesto) conserva il ripiego per i suoi
 * chiamanti: qui non si usa proprio per non ereditarlo.
 */
export function conTenantDellaSede<T>(sedeId: number, fn: () => T): T {
  const sede = getSedeById(sedeId);
  if (!sede) {
    if (interruttoreAttivo("multiAzienda")) {
      throw new Error(`[tenant] sede sconosciuta: ${sedeId}`);
    }
    return conTenant(TENANT_PREDEFINITO_ID, fn);
  }
  return conTenant(sede.tenantId ?? TENANT_PREDEFINITO_ID, fn);
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

/**
 * Il primo tenant in cui `fn` trova qualcosa, e ciò che ha trovato.
 *
 * Serve alle rotte anonime (webhook WhatsApp, feed ICS): l'URL è uno solo per
 * tutta l'installazione — Meta lo configura una volta, Google lo sottoscrive
 * con un token — quindi il proprietario non si sa dal contesto della
 * richiesta, si scopre guardando negli store di ogni tenant. È
 * `perOgniTenantAttivo` con un valore di ritorno e l'uscita al primo esito:
 * come lì, l'errore di un tenant viene registrato e non ferma gli altri.
 */
export async function trovaNeiTenant<T>(
  etichetta: string,
  fn: (tenantId: number) => Promise<T | null> | T | null
): Promise<{ tenantId: number; valore: T } | null> {
  for (const tenantId of tenantsAttivi()) {
    try {
      const valore = await conTenant(tenantId, () => fn(tenantId));
      if (valore != null) return { tenantId, valore };
    } catch (errore) {
      console.error(`[${etichetta}] tenant ${tenantId}:`, errore instanceof Error ? errore.message : errore);
    }
  }
  return null;
}
