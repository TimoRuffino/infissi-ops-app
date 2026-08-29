// Verifica dello storage SENZA SCRITTURE (release hardening 29/08/2026).
//
// Questo comando appartiene alla checklist read-only
// (docs/runbooks/verifica-produzione-readonly.md): configura + un GET su
// una chiave inesistente per provare endpoint e credenziali. Non scrive,
// non cancella, non lascia oggetti `_health/`. La sonda completa
// put/get/checksum/delete è `pnpm storage:probe-write`, separata e
// dichiarata. Un test statico (server/_core/checklistReadOnly.test.ts)
// impedisce a questo script di tornare a scrivere.

import "dotenv/config";
import {
  probeStorageReadOnly,
  storageConfiguration,
} from "../server/_core/fileStorage";

async function main() {
  const config = storageConfiguration();
  console.log("\n==== VERIFICA STORAGE (sola lettura) ====");
  console.log(`Driver richiesto: ${config.requestedDriver}`);
  console.log(
    `Configurazione:   ${config.configured ? "completa" : "incompleta"}`
  );
  if (config.endpoint) console.log(`Endpoint:          ${config.endpoint}`);
  if (config.bucket) console.log(`Bucket:            ${config.bucket}`);
  if (config.region) console.log(`Regione:           ${config.region}`);
  if (!config.configured) {
    console.error(`Mancano:           ${config.missing.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const esito = await probeStorageReadOnly();
  console.log(
    `Sonda GET (nessuna scrittura): OK (${esito.latencyMs} ms, driver ${esito.driver})`
  );
  console.log(
    "Per la sonda completa put/get/checksum/delete: pnpm storage:probe-write --scrivi"
  );
}

main().catch(error => {
  console.error("Verifica storage fallita:", error?.message ?? error);
  process.exit(1);
});
