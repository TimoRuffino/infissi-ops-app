// Il tenant «corrente» di una richiesta, di un giro di worker o di un
// comando: vive in AsyncLocalStorage e lo leggono solo persistence.ts (via
// resolver) e le guardie. Nessun altro modulo tocca l'ALS direttamente.
//
// Fix round 1 (Task 7): questo modulo è una FOGLIA del grafo — importa SOLO
// interruttori, costanti e _core/persistence (guardia strutturale in
// server/tenants/confine.test.ts). I giri per tenant e per sede
// (conTenantDellaSede, tenantsAttivi, perOgniTenantAttivo) vivono in
// server/tenants/giri.ts perché hanno bisogno di ./contesto e ./repository,
// che risalgono fino a routers/sedi e routers/utenti: importarli da qui
// chiuderebbe un ciclo con _core/trpc.ts (che importa `conTenant` da questo
// modulo) e farebbe crashare al semplice import qualunque entry point che
// importi un router prima di questo modulo (v. _core/ordineImport.test.ts).
import { AsyncLocalStorage } from "node:async_hooks";
import { impostaResolverTenant } from "../_core/persistence";
import { interruttoreAttivo } from "../platform/interruttori";
import { TENANT_PREDEFINITO_ID } from "./costanti";

type Contesto = { tenantId: number };

const als = new AsyncLocalStorage<Contesto>();
let strettoNeiTest = false;

/** Esegue `fn` con il tenant nel contesto (si propaga ad await, promise e timer creati dentro). */
export function conTenant<T>(tenantId: number, fn: () => T): T {
  return als.run({ tenantId }, fn);
}

/**
 * Interruttore spento → sempre il tenant 1. Acceso → il tenant nel contesto;
 * senza contesto: `null` (fail-closed), salvo nei test, dove si ripiega sul
 * tenant 1 perché quasi ogni test chiama i moduli fuori da una richiesta.
 * `modalitaTenantStretta(true)` toglie il ripiego nei test che verificano
 * che un worker dichiari il tenant.
 */
export function tenantCorrente(): number | null {
  if (!interruttoreAttivo("multiAzienda")) return TENANT_PREDEFINITO_ID;
  const contesto = als.getStore();
  if (contesto) return contesto.tenantId;
  if (process.env.NODE_ENV === "test" && !strettoNeiTest) return TENANT_PREDEFINITO_ID;
  return null;
}

export function modalitaTenantStretta(attiva: boolean): void {
  if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY_MODALITA_TENANT_STRETTA");
  strettoNeiTest = attiva;
}

// Auto-registrazione (spec §3.5, Task 6): senza questa riga, prima che
// qualcuno importi questo modulo, ogni accesso a uno store persistito fuori
// dai test lancerebbe «senza resolver del tenant» (persistence.ts) e il
// server non potrebbe fare boot fuori da NODE_ENV=test. `index.ts` la
// richiama esplicitamente anche lui, solo per leggibilità dell'ordine di
// boot — ma è questa riga a contare, al semplice import del modulo.
impostaResolverTenant(tenantCorrente);
