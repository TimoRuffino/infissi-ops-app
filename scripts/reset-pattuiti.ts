// Reset una tantum di pattuito, piano rate e pagamenti manuali.
//
//   npx tsx scripts/reset-pattuiti.ts                     # dry-run
//   npx tsx scripts/reset-pattuiti.ts --apply             # esegue
//   npx tsx scripts/reset-pattuiti.ts --apply --sede=2    # una sola sede
//   npx tsx scripts/reset-pattuiti.ts --apply --includi-archiviate
//
// Richiede DATABASE_URL: senza, tocca solo lo store in memoria e non
// dimostra nulla sui dati Railway. Su Railway usare `railway run`.
//
// DISTRUTTIVO: i pagamenti con origine "manuale" vengono eliminati. Il
// comando si rifiuta di partire senza un backup Drive riuscito nelle
// ultime 24 ore, come `storage:migrate`.

import { bootstrapAll, flushAll } from "../server/_core/persistence";
// L'import dei router registra gli store persistiti.
import "../server/routers";
import { getCommesseStore, saveCommesseStore } from "../server/routers/commesse";
import { ricalcolaImportoIncassato } from "../server/_core/commessaPayments";
import { resetPattuiti } from "../server/_core/resetPattuiti";

function argomentoNumerico(nome: string): number | null {
  const trovato = process.argv.find(arg => arg.startsWith(`--${nome}=`));
  if (!trovato) return null;
  const valore = Number(trovato.split("=")[1]);
  return Number.isFinite(valore) ? valore : null;
}

async function main() {
  const apply = process.argv.includes("--apply");

  await bootstrapAll();
  const report = resetPattuiti(
    {
      apply,
      sedeId: argomentoNumerico("sede"),
      skipBackupCheck: process.argv.includes("--skip-backup-check"),
      includiArchiviate: process.argv.includes("--includi-archiviate"),
    },
    {
      commesse: getCommesseStore(),
      save: saveCommesseStore,
      ricalcolaImportoIncassato,
    }
  );

  console.log("\n════ RESET PATTUITO E RATE ════");
  console.log(
    `Modalità: ${report.dryRun ? "DRY-RUN (nessuna scrittura)" : "APPLY"}`
  );
  console.log(`Sede:     ${report.sedeId ?? "tutte"}`);
  if (report.refusedReason) {
    console.error(`\n${report.refusedReason}`);
    process.exit(1);
  }
  console.log(`Commesse esaminate:        ${report.commesseEsaminate}`);
  console.log(`Pattuiti azzerati:         ${report.pattuitiAzzerati}`);
  console.log(`Piani rate rimossi:        ${report.pianiRimossi}`);
  console.log(`Pagamenti manuali rimossi: ${report.pagamentiManualiRimossi}`);
  console.log(`Pagamenti FiC conservati:  ${report.pagamentiFicConservati}`);
  if (report.commesseSaltate.length > 0) {
    console.log(`Saltate (archiviate):      ${report.commesseSaltate.length}`);
  }
  if (report.dryRun) {
    console.log(
      "\nNessuna scrittura eseguita. Rilancia con --apply dopo un backup Drive verificato."
    );
  } else {
    console.log(
      "\nFatto. Lancia ora `Sincronizza ora` in Integrazioni per ogni sede: il pattuito verrà ricostruito dalle fatture FiC."
    );
    await flushAll();
  }
  process.exit(0);
}

main().catch(e => {
  console.error("Reset fallito:", e);
  process.exit(1);
});
