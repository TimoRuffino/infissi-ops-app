// server/tenants/boot.ts
// Avvio del modulo tenant, subito dopo bootstrapAll(): schema del control
// plane, cache, e — con l'interruttore acceso — seed del tenant 1,
// proprietari di ripiego, comandi in attesa e il ciclo ogni 30 s. In
// produzione un fallimento dello schema ferma l'avvio (come policy ed eventi).
import { interruttoreAttivo } from "../platform/interruttori";
import { INTERVALLO_COMANDI_MS } from "./costanti";
import { getTenantRepository } from "./repository";
import { assicuraTenantPredefinito, eseguiComandiInAttesa } from "./servizio";

let intervallo: NodeJS.Timeout | null = null;

function riferisci(esito: { eseguiti: number; falliti: number }) {
  if (esito.eseguiti || esito.falliti) {
    console.log(`[tenants] comandi: ${esito.eseguiti} eseguiti, ${esito.falliti} falliti`);
  }
}

export async function avviaTenants(): Promise<void> {
  const repo = getTenantRepository();
  await repo.ensureSchema();
  await repo.caricaCache();
  if (!interruttoreAttivo("multiAzienda")) {
    const attesa = await repo.comandiInAttesa();
    console.log(
      `[tenants] FLAG_MULTI_AZIENDA spento: contesto mono-azienda` +
        (attesa.length ? `, ${attesa.length} comandi in attesa non eseguiti` : "")
    );
    return;
  }
  await assicuraTenantPredefinito();
  riferisci(await eseguiComandiInAttesa());
  fermaTenants();
  intervallo = setInterval(() => {
    eseguiComandiInAttesa()
      .then(riferisci)
      .catch(errore => console.error("[tenants] ciclo comandi:", errore));
  }, INTERVALLO_COMANDI_MS);
  intervallo.unref();
}

export function fermaTenants(): void {
  if (intervallo) {
    clearInterval(intervallo);
    intervallo = null;
  }
}
