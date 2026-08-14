import "dotenv/config";
import {
  probeStorage,
  storageConfiguration,
} from "../server/_core/fileStorage";

async function main() {
  const config = storageConfiguration();
  console.log("\n==== VERIFICA STORAGE ====");
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

  const result = await probeStorage();
  console.log(
    `Sonda put/get/checksum/delete: OK (${result.bytes} byte, ${result.latencyMs} ms)`
  );
}

main().catch(error => {
  console.error("Verifica storage fallita:", error?.message ?? error);
  process.exit(1);
});
