// server/tenants/boot.ts
// Avvio del modulo tenant in due tempi (Task 6, spec §3.5; Task 12 fix round 1,
// Ruling R13): `preparaTenants()` gira PRIMA di `bootstrapAll` — schema del
// control plane, cache e il seed della riga `tenants` del tenant 1
// (`repo.assicuraTenantPredefinito()`), SEMPRE, anche a interruttore spento.
// Quella riga è control plane, additiva e inerte a interruttore spento
// (nessuna lettura di dominio la consulta), ma serve allo specchio
// `tenant_sedi` e al backfill di `tenant_id` del deploy spento (spec §7.1,
// §8: specchio, colonne, trigger e backfill vanno verificati PRIMA di
// accendere il flag). Gli store dei tenant (`utenti`, `sedi`, …) non sono
// ancora caricati a questo punto, quindi qui non si tocca il proprietario di
// ripiego. `completaTenants()` gira DOPO — backfill/allineamento sugli
// store, comandi in attesa e il ciclo ogni 30 s, questi sì condizionati
// all'interruttore. In produzione un fallimento dello schema ferma l'avvio
// (come policy ed eventi).
import { kvSql } from "../_core/persistence";
import { interruttoreAttivo } from "../platform/interruttori";
import { getSediStore } from "../routers/sedi";
import { INTERVALLO_COMANDI_MS, TENANT_PREDEFINITO_ID } from "./costanti";
import { righeTenantSedi } from "./regole";
import { getTenantRepository } from "./repository";
import { allineaTenantPredefinito, eseguiComandiInAttesa } from "./servizio";
import { applicaTenantIdAlleTabelle, type EsitoTabelle } from "./tabelle";

let intervallo: NodeJS.Timeout | null = null;

function riferisci(esito: { eseguiti: number; falliti: number }) {
  if (esito.eseguiti || esito.falliti) {
    console.log(`[tenants] comandi: ${esito.eseguiti} eseguiti, ${esito.falliti} falliti`);
  }
}

/**
 * Control plane soltanto, PRIMA di `bootstrapAll`: schema, cache e
 * `repo.assicuraTenantPredefinito()` — la riga `tenants` del tenant 1 — SEMPRE,
 * subito dopo `caricaCache()`, a prescindere dall'interruttore (Task 12 fix
 * round 1, Ruling R13): è control plane, additiva (`ON CONFLICT DO NOTHING`)
 * e inerte a interruttore spento, ma serve allo specchio `tenant_sedi` e al
 * backfill del deploy spento. Ritorna gli id da istanziare in `bootstrapAll`:
 * a interruttore spento solo il tenant 1; acceso, tutti i tenant in cache —
 * anche i sospesi, che restano leggibili (sola lettura, mai nei cicli dei
 * worker).
 */
export async function preparaTenants(): Promise<number[]> {
  const repo = getTenantRepository();
  await repo.ensureSchema();
  await repo.caricaCache();
  await repo.assicuraTenantPredefinito();
  if (!interruttoreAttivo("multiAzienda")) return [TENANT_PREDEFINITO_ID];
  return repo.tutti().map(t => t.id);
}

/**
 * DOPO `bootstrapAll`: gli store dei tenant sono già caricati, quindi si può
 * allineare il proprietario di ripiego, eseguire i comandi in attesa e
 * avviare il ciclo ogni 30 s — questi TRE restano condizionati
 * all'interruttore. Non tocca mai lo schema: quello è compito, una volta
 * sola, di `preparaTenants`, che ha già seminato la riga del tenant 1 anche
 * a interruttore spento (Ruling R13).
 */
export async function completaTenants(): Promise<void> {
  const repo = getTenantRepository();
  // Lo specchio sede → tenant si allinea SEMPRE, anche a interruttore spento:
  // è additivo (nessuna lettura di dominio lo consulta) e serve al trigger
  // `tenant_id`, che gira comunque. La riga del tenant 1 esiste già (la
  // semina `preparaTenants`, sempre): con l'interruttore spento tutte le
  // sedi sono sue e questa sincronizzazione le scrive davvero nello
  // specchio, non resta un no-op silenzioso.
  await repo.sincronizzaTenantSedi(righeTenantSedi(getSediStore()));
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
 * Colonna `tenant_id`, indice, trigger e backfill sulle tabelle relazionali
 * per sede (Task 12). Gira nel boot del server dopo gli altri `ensureSchema()`
 * espliciti — quelli creano le tabelle su cui questa lavora — e DOPO
 * `completaTenants`, che ha già allineato lo specchio `tenant_sedi` da cui il
 * backfill legge. Senza database (sviluppo in memoria) non c'è nulla da fare
 * e ritorna `null`. In produzione un errore qui ferma l'avvio come gli altri
 * schemi: si lascia propagare.
 */
export async function applicaSchemaTabelleTenant(): Promise<EsitoTabelle | null> {
  if (!kvSql) return null;
  const esito = await applicaTenantIdAlleTabelle(kvSql);
  const backfill = Object.fromEntries(Object.entries(esito.backfill).filter(([, n]) => n > 0));
  console.log(
    `[tenants] tabelle: ${esito.applicate.length} applicate, ${esito.assenti.length} assenti` +
      (esito.assenti.length ? ` (${esito.assenti.join(", ")})` : "") +
      `, backfill: ${JSON.stringify(backfill)}`
  );
  return esito;
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
