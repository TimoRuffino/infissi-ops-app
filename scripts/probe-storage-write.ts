// Sonda COMPLETA dello storage: put → get → checksum → delete di un
// oggetto `_health/`. SCRIVE (e poi cancella) sul bucket configurato:
// per questo NON fa parte della checklist read-only e richiede il flag
// esplicito `--scrivi`. Uso tipico: prima di una migrazione reale
// (docs/storage-r2.md), o dalla card Integrazioni (stessa sonda via
// fileStorage.probe, admin).

import "dotenv/config";
import { probeStorage, storageConfiguration } from "../server/_core/fileStorage";

async function main() {
  if (!process.argv.includes("--scrivi")) {
    console.error(
      "Questa sonda SCRIVE un oggetto _health/ di prova sul bucket configurato.\n" +
        "Non è una verifica read-only: rilancia con `--scrivi` per confermare.\n" +
        "Per la verifica senza scritture usa `pnpm storage:check`."
    );
    process.exit(1);
  }
  const config = storageConfiguration();
  if (!config.configured) {
    console.error(`Storage non configurato. Mancano: ${config.missing.join(", ")}`);
    process.exit(1);
  }
  const esito = await probeStorage();
  console.log(
    `Sonda put/get/checksum/delete: OK (${esito.bytes} byte, ${esito.latencyMs} ms, driver ${esito.driver})`
  );
}

main().catch(error => {
  console.error("Sonda storage fallita:", error?.message ?? error);
  process.exit(1);
});
