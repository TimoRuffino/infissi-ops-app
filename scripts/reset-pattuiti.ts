// Reset una tantum di pattuito, piano rate e pagamenti manuali.
//
//   npx tsx scripts/reset-pattuiti.ts                     # dry-run
//   npx tsx scripts/reset-pattuiti.ts --apply             # esegue
//   npx tsx scripts/reset-pattuiti.ts --apply --sede=2    # una sola sede
//   npx tsx scripts/reset-pattuiti.ts --apply --tenant=2  # un'altra azienda
//   npx tsx scripts/reset-pattuiti.ts --apply --includi-archiviate
//
// `--tenant=<id>` sceglie l'azienda su cui lavorare (default: 1, Ruffino
// Group). Ogni store è per tenant: senza contesto il Proxy di `persistence`
// non saprebbe quale archivio aprire, e con `--tenant` sbagliato si
// azzererebbero i pattuiti di un'altra azienda. Il tenant compare nella riga
// di intestazione del report: leggerlo prima di dare `--apply`.
//
// Richiede DATABASE_URL: senza, tocca solo lo store in memoria e non
// dimostra nulla sui dati Railway. Su Railway usare `railway run`.
//
// DISTRUTTIVO: i pagamenti con origine "manuale" vengono eliminati. Il
// comando si rifiuta di partire senza un backup Drive riuscito nelle
// ultime 24 ore, come `storage:migrate`.
//
// ATTENZIONE — NON USARLO CONTRO UN'ISTANZA IN ESECUZIONE.
//
// `persistedStore` tiene ogni raccolta come array in memoria e `save()`
// riscrive l'intera riga JSONB. Un processo separato che scrive sul database
// non tocca la copia in memoria del server vivo: al primo salvataggio di
// quest'ultimo — e il sync FiC ne fa uno da solo ogni 6 ore — il reset viene
// sovrascritto per intero. Non e' un rischio di orario: e' certo.
//
// Su un'istanza attiva usa `Impostazioni -> Reset pattuito e pagamenti
// manuali` (procedura `commesse.resetPattuiti`, direzione soltanto): li' la
// mutazione avviene sullo stesso array che il server tiene, quindi regge.
// Questo script resta utile a servizio fermo o su un ripristino offline.

import { bootstrapAll, flushAll } from "../server/_core/persistence";
import { conTenant } from "../server/tenants/contestoCorrente";
import { TENANT_PREDEFINITO_ID } from "../server/tenants/costanti";
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

/** `--tenant=<id>`: intero positivo, default il tenant 1. */
function tenantScelto(): number {
  const grezzo = process.argv.find(a => a.startsWith("--tenant="));
  if (!grezzo) return TENANT_PREDEFINITO_ID;
  const valore = Number(grezzo.slice("--tenant=".length));
  if (!Number.isInteger(valore) || valore <= 0) {
    console.error(`--tenant deve essere un intero positivo (ricevuto: ${grezzo.slice("--tenant=".length)})`);
    process.exit(1);
  }
  return valore;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const tenantId = tenantScelto();
  console.log(
    `Reset pattuiti — tenant ${tenantId} — ${apply ? "APPLY" : "dry-run"}`
  );

  await bootstrapAll();
  // Ogni store è per tenant: il corpo dello script gira nel contesto
  // dell'azienda scelta, come una richiesta o un giro di worker.
  const report = conTenant(tenantId, () => resetPattuiti(
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
  ));

  console.log("\n════ RESET PATTUITO E RATE ════");
  console.log(
    `Modalità: ${report.dryRun ? "DRY-RUN (nessuna scrittura)" : "APPLY"}`
  );
  console.log(`Tenant:   ${tenantId}`);
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
