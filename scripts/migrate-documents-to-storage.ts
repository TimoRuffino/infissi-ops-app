// P0.1 — migrate legacy base64 documents out of the JSONB collections into
// the fileStorage driver.
//
//   npx tsx scripts/migrate-documents-to-storage.ts                       # dry-run
//   npx tsx scripts/migrate-documents-to-storage.ts --apply               # esegue
//   npx tsx scripts/migrate-documents-to-storage.ts --apply --skip-backup-check
//   npx tsx scripts/migrate-documents-to-storage.ts --apply --tenant=2    # un'altra azienda
//
// `--tenant=<id>` sceglie l'azienda su cui lavorare (default: 1, Ruffino
// Group). Ogni collezione migrabile (preventivi_documenti, ticket_allegati)
// è per tenant: senza contesto il Proxy di `persistence` non saprebbe quale
// archivio aprire, e con `--tenant` sbagliato si migrerebbero i documenti di
// un'altra azienda. Il tenant compare nella riga di avvio: leggerlo prima
// di dare `--apply`.
//
// Needs DATABASE_URL (run on Railway with `railway run`, or locally with the
// prod URL exported). The same migration is also exposed to direzione via
// the tRPC procedure fileStorage.migrate.
//
// ATTENZIONE — NON USARLO CONTRO UN'ISTANZA IN ESECUZIONE.
//
// `persistedStore` tiene ogni raccolta come array in memoria e `save()`
// riscrive l'intera riga JSONB. Un processo separato che scrive sul database
// non tocca la copia in memoria del server vivo: al primo salvataggio di
// quest'ultimo — e capita da solo — il lavoro di questo script verrebbe
// sovrascritto per intero. Eseguire a servizio fermo, oppure passare dalla
// procedura tRPC fileStorage.migrate (direzione, dalla UI).

import { bootstrapAll, flushAll } from "../server/_core/persistence";
import { conTenant } from "../server/tenants/contestoCorrente";
import { TENANT_PREDEFINITO_ID } from "../server/tenants/costanti";
// Importing the app router registers every persistedStore + the migratable
// collections (side effects of the router modules).
import "../server/routers";
import { migrateFilesToStorage } from "../server/_core/fileStorageMigrate";

function argomento(nome: string): string | null {
  const trovato = process.argv.find(a => a.startsWith(`--${nome}=`));
  return trovato ? trovato.split("=").slice(1).join("=") : null;
}

/** `--tenant=<id>`: intero positivo, default il tenant 1. */
function tenantScelto(): number {
  const grezzo = argomento("tenant");
  if (grezzo == null) return TENANT_PREDEFINITO_ID;
  const valore = Number(grezzo);
  if (!Number.isInteger(valore) || valore <= 0) {
    console.error(`--tenant deve essere un intero positivo (ricevuto: ${grezzo})`);
    process.exit(1);
  }
  return valore;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const skipBackupCheck = process.argv.includes("--skip-backup-check");
  const tenantId = tenantScelto();
  console.log(`Tenant: ${tenantId}`);

  await bootstrapAll({ tenantIds: [tenantId] });
  // Ogni collezione migrabile è per tenant: il corpo dello script gira nel
  // contesto dell'azienda scelta, come una richiesta o un giro di worker.
  const report = await conTenant(tenantId, () =>
    migrateFilesToStorage({ apply, skipBackupCheck })
  );

  console.log("\n════ REPORT MIGRAZIONE STORAGE ════");
  console.log(`Modalità: ${report.dryRun ? "DRY-RUN (nessuna scrittura)" : "APPLY"}`);
  console.log(`Driver:   ${report.driver}`);
  if (report.refusedReason) {
    console.error(`\n${report.refusedReason}`);
    process.exitCode = 1;
  }
  for (const c of report.collections) {
    console.log(
      `\n${c.key}: totale ${c.total} | già migrati ${c.giaMigrati} | da migrare ${c.daMigrare}` +
        (report.dryRun
          ? ""
          : ` | migrati ${c.migrati} | falliti ${c.falliti} | ${(c.bytes / 1024 / 1024).toFixed(1)}MB spostati`)
    );
    for (const e of c.errori) console.error(`  ✗ ${e}`);
  }
  if (apply) await flushAll();
  process.exit(process.exitCode ?? 0);
}

main().catch((e) => {
  console.error("Migrazione fallita:", e);
  process.exit(1);
});
