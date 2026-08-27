// Import dell'anagrafica clienti da un export CSV di Fatture in Cloud.
//
//   npx tsx scripts/importa-clienti.ts <file.csv>                  # simulazione
//   npx tsx scripts/importa-clienti.ts <file.csv> --apply
//   npx tsx scripts/importa-clienti.ts <file.csv> --apply --arricchisci
//   npx tsx scripts/importa-clienti.ts <file.csv> --sede=2 --dettaglio
//
// Da Excel: aprire il file e salvarlo come CSV UTF-8, oppure esportare in CSV
// direttamente da Fatture in Cloud.
//
// ATTENZIONE — NON USARLO CONTRO UN'ISTANZA IN ESECUZIONE.
//
// `persistedStore` tiene i clienti in memoria e li riscrive interi a ogni
// salvataggio: un processo separato che scrive sul database viene sovrascritto
// dal primo salvataggio del server vivo. È lo stesso motivo per cui il reset
// del pattuito è passato dall'interfaccia. Qui l'import va fatto a servizio
// fermo, oppure aggiungendo una procedura come `commesse.resetPattuiti`.
//
// L'import non elimina e non sovrascrive mai: crea i mancanti e, solo con
// `--arricchisci`, riempie i campi VUOTI di chi c'è già.

import { readFileSync } from "node:fs";
import { bootstrapAll, flushAll } from "../server/_core/persistence";
import "../server/routers";
import {
  getClientiStore,
  createClienteFromSync,
  saveClientiStore,
} from "../server/routers/clienti";
import { COMPANY_RE, splitPersona } from "../server/routers/fattureInCloud";
import {
  importaClienti,
  leggiRighe,
  type EsitoRiga,
} from "../server/_core/importaClienti";

function argomento(nome: string): string | null {
  const trovato = process.argv.find(a => a.startsWith(`--${nome}=`));
  return trovato ? trovato.split("=").slice(1).join("=") : null;
}

async function main() {
  const percorso = process.argv[2];
  if (!percorso || percorso.startsWith("--")) {
    console.error(
      "Uso: npx tsx scripts/importa-clienti.ts <file.csv> [--apply] [--arricchisci] [--sede=N] [--dettaglio]"
    );
    process.exit(1);
  }
  const apply = process.argv.includes("--apply");
  const arricchisci = process.argv.includes("--arricchisci");
  const dettaglio = process.argv.includes("--dettaglio");
  const sedeId = Number(argomento("sede") ?? 1);

  const righe = leggiRighe(readFileSync(percorso, "utf8"));
  if (righe.length === 0) {
    console.error("Nessuna riga leggibile: controlla che il CSV abbia le intestazioni.");
    process.exit(1);
  }

  await bootstrapAll();
  const clienti = getClientiStore();

  const report = importaClienti(
    righe,
    { apply, arricchisci },
    {
      clientiEsistenti: clienti as any,
      sedeId,
      crea: dati => {
        const creato = createClienteFromSync({
          sedeId: dati.sedeId,
          cognome: dati.cognome,
          nome: dati.nome,
          tipo: dati.tipo,
          partitaIva: dati.partitaIva,
          codiceFiscale: dati.codiceFiscale,
        });
        // `createClienteFromSync` copre solo identità e nome: i contatti si
        // scrivono qui, sullo stesso record appena creato.
        Object.assign(creato, {
          email: dati.email ?? null,
          telefono: dati.telefono ?? null,
          indirizzo: dati.indirizzo ?? null,
          citta: dati.citta ?? null,
          cap: dati.cap ?? null,
          note: dati.note ?? null,
        });
        return creato.id;
      },
      arricchisci: (clienteId, campi) => {
        const cliente: any = clienti.find((c: any) => c.id === clienteId);
        if (!cliente) return;
        Object.assign(cliente, campi, { updatedAt: new Date() });
      },
      salva: saveClientiStore,
      isAzienda: nome => COMPANY_RE.test(nome),
      dividiPersona: (nome, cf) => splitPersona(nome, cf),
    }
  );

  console.log("\n════ IMPORT CLIENTI ════");
  console.log(`Modalità:      ${report.dryRun ? "SIMULAZIONE (nessuna scrittura)" : "APPLY"}`);
  console.log(`Sede:          ${report.sedeId}`);
  console.log(`Arricchimento: ${arricchisci ? "sì (solo campi vuoti)" : "no"}`);
  console.log(`\nRighe lette:            ${report.righeLette}`);
  console.log(`Da creare:              ${report.creati}`);
  console.log(`Già in anagrafica:      ${report.giaPresenti}`);
  console.log(`Ripetuti nel file:      ${report.duplicatiNelFile}`);
  console.log(`Scartati:               ${report.scartati}`);
  if (arricchisci) {
    console.log(`Campi vuoti riempiti:   ${report.campiArricchiti}`);
  }

  const perCriterio = report.esiti.reduce((acc: Record<string, number>, e) => {
    if (e.esito === "gia_presente") acc[e.criterio] = (acc[e.criterio] ?? 0) + 1;
    return acc;
  }, {});
  if (Object.keys(perCriterio).length > 0) {
    console.log("\nRiconosciuti per:");
    for (const [criterio, n] of Object.entries(perCriterio)) {
      console.log(`  ${criterio.padEnd(16)} ${n}`);
    }
  }

  const mostra = (titolo: string, filtro: (e: EsitoRiga) => boolean, max: number) => {
    const elenco = report.esiti.filter(filtro);
    if (elenco.length === 0) return;
    console.log(`\n${titolo} (${elenco.length}):`);
    for (const e of elenco.slice(0, dettaglio ? elenco.length : max)) {
      const extra =
        e.esito === "gia_presente"
          ? ` → #${e.clienteId} per ${e.criterio}${e.campiArricchiti.length ? ` · riempiti: ${e.campiArricchiti.join(", ")}` : ""}`
          : e.esito === "duplicato_nel_file"
            ? ` → ${e.criterio}`
            : e.esito === "scartato"
              ? ` → ${e.motivo}`
              : "";
      console.log(`  ${e.riga.denominazione}${extra}`);
    }
    if (!dettaglio && elenco.length > max) {
      console.log(`  … altri ${elenco.length - max} (usa --dettaglio)`);
    }
  };

  mostra("DA CREARE", e => e.esito === "creato", 25);
  mostra("RIPETUTI NEL FILE", e => e.esito === "duplicato_nel_file", 10);
  mostra("SCARTATI", e => e.esito === "scartato", 10);

  if (report.dryRun) {
    console.log("\nNessuna scrittura. Rilancia con --apply quando i numeri tornano.");
  } else {
    await flushAll();
    console.log("\nFatto.");
  }
  process.exit(0);
}

main().catch(e => {
  console.error("Import fallito:", e);
  process.exit(1);
});
