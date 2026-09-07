// server/tenants/boot.ts
// Avvio del modulo tenant in due tempi (Task 6, spec §3.5): `preparaTenants()`
// gira PRIMA di `bootstrapAll` — schema del control plane, cache e, con
// l'interruttore acceso, il seed della SOLA riga `tenants` predefinita: gli
// store dei tenant (`utenti`, `sedi`, …) non sono ancora caricati a questo
// punto, quindi qui non si tocca il proprietario di ripiego. `completaTenants()`
// gira DOPO — backfill/allineamento sugli store, comandi in attesa e il ciclo
// ogni 30 s. In produzione un fallimento dello schema ferma l'avvio (come
// policy ed eventi).
import { interruttoreAttivo } from "../platform/interruttori";
import { INTERVALLO_COMANDI_MS, TENANT_PREDEFINITO_ID } from "./costanti";
import { getTenantRepository } from "./repository";
import { allineaTenantPredefinito, eseguiComandiInAttesa } from "./servizio";

let intervallo: NodeJS.Timeout | null = null;

function riferisci(esito: { eseguiti: number; falliti: number }) {
  if (esito.eseguiti || esito.falliti) {
    console.log(`[tenants] comandi: ${esito.eseguiti} eseguiti, ${esito.falliti} falliti`);
  }
}

/**
 * Control plane soltanto, PRIMA di `bootstrapAll`: schema + cache e, con
 * l'interruttore acceso, `repo.assicuraTenantPredefinito()` — la sola riga
 * `tenants`. Ritorna gli id da istanziare in `bootstrapAll`: anche i tenant
 * sospesi, che restano leggibili (sola lettura, mai nei cicli dei worker).
 */
export async function preparaTenants(): Promise<number[]> {
  const repo = getTenantRepository();
  await repo.ensureSchema();
  await repo.caricaCache();
  if (!interruttoreAttivo("multiAzienda")) return [TENANT_PREDEFINITO_ID];
  await repo.assicuraTenantPredefinito();
  return repo.tutti().map(t => t.id);
}

/**
 * DOPO `bootstrapAll`: gli store dei tenant sono già caricati, quindi si può
 * allineare il proprietario di ripiego, eseguire i comandi in attesa e
 * avviare il ciclo ogni 30 s. Non tocca mai lo schema: quello è compito, una
 * volta sola, di `preparaTenants`.
 */
export async function completaTenants(): Promise<void> {
  const repo = getTenantRepository();
  if (!interruttoreAttivo("multiAzienda")) {
    const attesa = await repo.comandiInAttesa();
    console.log(
      `[tenants] FLAG_MULTI_AZIENDA spento: contesto mono-azienda` +
        (attesa.length ? `, ${attesa.length} comandi in attesa non eseguiti` : "")
    );
    return;
  }
  await allineaTenantPredefinito();
  riferisci(await eseguiComandiInAttesa());
  fermaTenants();
  intervallo = setInterval(() => {
    eseguiComandiInAttesa()
      .then(riferisci)
      .catch(errore => console.error("[tenants] ciclo comandi:", errore));
  }, INTERVALLO_COMANDI_MS);
  intervallo.unref();
}

/**
 * @deprecated Il boot del server chiama `preparaTenants()` prima di
 * `bootstrapAll({ tenantIds, backfill: true })` e `completaTenants()` dopo
 * (Task 6): la separazione esiste perché gli store dei tenant non sono
 * caricati finché `bootstrapAll` non gira. Questa funzione resta solo per i
 * test meno recenti che provano il boot come un blocco unico.
 */
export async function avviaTenants(): Promise<void> {
  await preparaTenants();
  await completaTenants();
}

export function fermaTenants(): void {
  if (intervallo) {
    clearInterval(intervallo);
    intervallo = null;
  }
}
