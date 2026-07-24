// P0.1 — migrate legacy base64 documents out of the JSONB collections into
// the fileStorage driver.
//
//   npx tsx scripts/migrate-documents-to-storage.ts            # dry-run
//   npx tsx scripts/migrate-documents-to-storage.ts --apply    # esegue
//   npx tsx scripts/migrate-documents-to-storage.ts --apply --skip-backup-check
//
// Needs DATABASE_URL (run on Railway with `railway run`, or locally with the
// prod URL exported). The same migration is also exposed to direzione via
// the tRPC procedure fileStorage.migrate.

import { bootstrapAll, flushAll } from "../server/_core/persistence";
// Importing the app router registers every persistedStore + the migratable
// collections (side effects of the router modules).
import "../server/routers";
import { migrateFilesToStorage } from "../server/_core/fileStorageMigrate";

async function main() {
  const apply = process.argv.includes("--apply");
  const skipBackupCheck = process.argv.includes("--skip-backup-check");

  await bootstrapAll();
  const report = await migrateFilesToStorage({ apply, skipBackupCheck });

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
