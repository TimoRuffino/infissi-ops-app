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
import { impostaContabileStorage } from "../_core/fileStorage";
import { kvSql } from "../_core/persistence";
import { interruttoreAttivo } from "../platform/interruttori";
import { getSediStore } from "../routers/sedi";
// WS4 (Task 3): nessun ciclo a importare questo da qui — `boot.ts` non è fra
// i moduli che `abbonamenti/servizio.ts` risale (a differenza di
// `tenants/servizio.ts`, importato da lì per `sospendi`/`riattiva`: lì
// l'import resta dinamico). Import statico qui, come gli altri di questo
// file. Il worker degli abbonamenti (`abbonamenti/worker.ts`) NON si importa
// più da questo modulo (Task 3 fix round 1, Ruling R7): parte SOLO dopo il
// `listen`, in `_core/index.ts` — mai dal boot, che gira prima.
import { assicuraAbbonamentoPredefinito } from "../abbonamenti/servizio";
// Stesso ragionamento del commento qui sopra: `quota.ts` non risale a
// `boot.ts`, import statico sicuro (WS4, Task 5).
import { registraGanciQuota } from "../abbonamenti/quota";
import { INTERVALLO_COMANDI_MS, TENANT_PREDEFINITO_ID } from "./costanti";
import { righeTenantSedi } from "./regole";
import { getTenantRepository } from "./repository";
import { allineaTenantPredefinito, eseguiComandiInAttesa } from "./servizio";
import { creaContabileStorage, ricalcolaStorageSeManca } from "./storage";
import {
  applicaTenantIdAlleTabelle,
  backfillTenantIdSulleTabelle,
  type EsitoTabelle,
} from "./tabelle";

let intervallo: NodeJS.Timeout | null = null;

function riferisci(esito: { eseguiti: number; falliti: number }) {
  if (esito.eseguiti || esito.falliti) {
    console.log(`[tenants] comandi: ${esito.eseguiti} eseguiti, ${esito.falliti} falliti`);
  }
}

/**
 * Control plane soltanto, PRIMA di `bootstrapAll`: schema, cache, spazzata
 * degli `state` OAuth scaduti e
 * `repo.assicuraTenantPredefinito()` — la riga `tenants` del tenant 1 — SEMPRE,
 * subito dopo `caricaCache()`, a prescindere dall'interruttore (Task 12 fix
 * round 1, Ruling R13): è control plane, additiva (`ON CONFLICT DO NOTHING`)
 * e inerte a interruttore spento, ma serve allo specchio `tenant_sedi` e al
 * backfill del deploy spento. Ritorna gli id da istanziare in `bootstrapAll`:
 * a interruttore spento solo il tenant 1; acceso, tutti i tenant in cache —
 * anche i sospesi, che restano leggibili (sola lettura, mai nei cicli dei
 * worker).
 *
 * «Inerte» non vuol dire invisibile: anche a interruttore spento quella riga
 * è ciò che leggono `tenants.mio` (via `perId(1)` in cache) e il `ctx.tenant`
 * di Tars, con gli stessi valori. Cambiare a mano `nome`, `slug` o `stato`
 * del tenant 1 nel database ha quindi effetto sul prodotto anche a flag
 * spento — in particolare `stato = 'sospeso'`, che `mio` riporta al client.
 */
export async function preparaTenants(): Promise<number[]> {
  const repo = getTenantRepository();
  await repo.ensureSchema();
  await repo.caricaCache();
  // Gli `state` OAuth scaduti (WS3 §5): due righe per collegamento, dieci
  // minuti di vita, nessuno che le tolga. Sicurezza non ne dipende — la
  // scadenza e il consumo unico sono in SQL — ma una tabella che cresce e
  // non cala è debito: si spazza al boot, dove costa una DELETE sola.
  // Un errore qui non deve fermare l'avvio: il control plane è già a posto.
  try {
    const rimossi = await repo.pulisciStateScaduti();
    if (rimossi > 0) console.log(`[tenants] oauth_state: ${rimossi} state scaduti rimossi`);
  } catch (errore) {
    console.error("[tenants] pulizia oauth_state:", errore instanceof Error ? errore.message : errore);
  }
  // Gli inviti scaduti da più di 30 giorni (WS6, pannello piattaforma, spec
  // §4.2): stessa cautela della spazzata qui sopra, in un try/catch a parte
  // così un guasto in uno dei due non nasconde il messaggio dell'altro.
  try {
    const inviti = await repo.pulisciInvitiScaduti();
    if (inviti) console.log(`[tenants] inviti scaduti rimossi: ${inviti}`);
  } catch (errore) {
    console.error("[tenants] pulizia inviti:", errore instanceof Error ? errore.message : errore);
  }
  await repo.assicuraTenantPredefinito();
  // Il contabile dei byte (WS3): fileStorage.ts non importa il control plane
  // e lo riceve da qui, come persistence.ts riceve il resolver del tenant.
  impostaContabileStorage(creaContabileStorage());
  // La quota che blocca (WS4, spec §6) e il tetto Tars per azienda (§7):
  // stesso pattern del contabile, ganci iniettati — senza questa chiamata
  // `putFile` non blocca mai nulla e il budget governor non conosce alcun
  // tetto d'azienda. Entrambi restano inerti a interruttore spento.
  registraGanciQuota();
  if (!interruttoreAttivo("multiAzienda")) return [TENANT_PREDEFINITO_ID];
  return repo.tutti().map(t => t.id);
}

/**
 * DOPO `bootstrapAll`: gli store dei tenant sono già caricati, quindi si può
 * allineare il proprietario di ripiego, eseguire i comandi in attesa e
 * avviare il ciclo ogni 30 s — questi TRE restano condizionati
 * all'interruttore. Non tocca mai lo schema: quello è compito, una volta
 * sola, di `preparaTenants`, che ha già seminato la riga del tenant 1 anche a
 * interruttore spento (Ruling R13). Il worker degli abbonamenti NON parte da
 * qui (Task 3 fix round 1, Ruling R7): questa funzione gira PRIMA di
 * `server.listen`, e il worker deve partire dopo — lo avvia `_core/index.ts`,
 * nel callback del `listen`.
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
  // L'omaggio del tenant 1 (WS4 spec §4) è control plane quanto la sua riga
  // `tenants`: nasce SEMPRE, anche a interruttore spento (l'unica aggiunta
  // visibile in quel caso, decisione 6 dell'08/09). Un errore qui non deve
  // impedire l'avvio — come lo schema, ma qui non c'è nulla che debba
  // fermare il boot per un'unica riga del control plane.
  try {
    await assicuraAbbonamentoPredefinito(new Date());
  } catch (errore) {
    console.error("[tenants] abbonamento del tenant 1:", errore instanceof Error ? errore.message : errore);
  }
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
 * Colonna `tenant_id`, indice e trigger sulle tabelle relazionali per sede
 * (Task 12). Solo DDL: il backfill delle righe già a terra è
 * `avviaBackfillTabelleTenant`, che gira dopo il `listen` (Ruling R14). Va
 * nel boot del server dopo gli altri `ensureSchema()` espliciti — quelli
 * creano le tabelle su cui questa lavora — e DOPO `completaTenants`, che ha
 * già allineato lo specchio `tenant_sedi` da cui il trigger legge. Senza
 * database (sviluppo in memoria) non c'è nulla da fare e ritorna `null`. In
 * produzione un errore qui ferma l'avvio come gli altri schemi: si lascia
 * propagare — tranne il lock non ottenuto, che rinvia la singola tabella al
 * boot successivo invece di far morire l'avvio.
 */
export async function applicaSchemaTabelleTenant(): Promise<EsitoTabelle | null> {
  if (!kvSql) return null;
  const esito = await applicaTenantIdAlleTabelle(kvSql);
  console.log(
    `[tenants] tabelle: ${esito.applicate.length} applicate, ${esito.assenti.length} assenti` +
      (esito.assenti.length ? ` (${esito.assenti.join(", ")})` : "") +
      `, ${esito.rinviate.length} rinviate` +
      (esito.rinviate.length ? ` (${esito.rinviate.join(", ")})` : "") +
      `, specchio ${esito.specchio} sedi`
  );
  return esito;
}

/**
 * Il backfill di `tenant_id`, a lotti, DOPO che il server ha aperto la porta
 * (Ruling R14): sul primo deploy a interruttore spento riscrive ogni riga
 * delle tabelle per sede, e farlo prima del `listen` terrebbe il servizio
 * giù per tutto quel tempo. Gira in sottofondo, quindi un errore si logga e
 * basta: il boot successivo ci riprova, e nel frattempo `tenant_id` NULL non
 * rompe niente (nessuna query di dominio lo legge). Senza database non fa
 * nulla.
 */
export async function avviaBackfillTabelleTenant(): Promise<void> {
  if (!kvSql) return;
  const inizio = Date.now();
  try {
    const esito = await backfillTenantIdSulleTabelle(kvSql);
    // Nel dettaglio solo le tabelle con almeno una riga toccata: con 30
    // tabelle a zero la riga di log sarebbe illeggibile.
    const dettaglio = Object.entries(esito.righe)
      .filter(([, n]) => n > 0)
      .map(([tabella, n]) => `${tabella}: ${n}/${esito.ms[tabella]} ms`)
      .join(", ");
    console.log(
      `[tenants] backfill tenant_id: ${esito.totale} righe in ${Date.now() - inizio} ms` +
        (dettaglio ? ` (${dettaglio})` : "")
    );
  } catch (errore) {
    console.error("[tenants] backfill tenant_id:", errore);
  }
}

/**
 * Il ledger dello storage (WS3, Task 4), dopo il `listen` come il backfill
 * qui sopra: un'azienda alla volta, senza tenere giù l'avvio. Chi ha già una
 * riga la salta (`ricalcolaStorageSeManca`); da lì in poi ci pensano put e
 * delete. Ogni tenant ha già il proprio try/catch interno — questo strato in
 * più è la stessa cautela di `avviaBackfillTabelleTenant`, per l'imprevisto
 * in cui il giro stesso fallisca.
 */
export async function avviaRicalcoloStorageIniziale(tenantIds: number[]): Promise<void> {
  try {
    await ricalcolaStorageSeManca(tenantIds);
  } catch (errore) {
    console.error("[tenants] ricalcolo storage iniziale:", errore);
  }
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
