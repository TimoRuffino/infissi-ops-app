// Reset del pattuito e del registro pagamenti manuali.
//
// Serve una volta sola, al passaggio di contratto del 26/08/2026: da qui in
// avanti il pattuito è Fatture in Cloud, e i valori inseriti a mano negli
// anni precedenti sono una verità parallela che non riconcilia con niente.
//
// È DISTRUTTIVO e non ha un undo applicativo: i pagamenti con
// `origine="manuale"` vengono rimossi, non stornati. Lo storno serve a dire
// "questo movimento c'era e non vale più"; qui stiamo dicendo "questo
// registro non è mai stato la fonte". Il ripristino passa dal backup Drive.
//
// I movimenti `origine="fic"` non si toccano: li riscrive il sync, sono già
// riconciliati uno-a-uno con le rate e cancellarli farebbe solo ricrearli.

import { getAllStoreSnapshots } from "./persistence";

export type ResetPattuitiReport = {
  dryRun: boolean;
  sedeId: number | null;
  commesseEsaminate: number;
  pattuitiAzzerati: number;
  pianiRimossi: number;
  pagamentiManualiRimossi: number;
  pagamentiFicConservati: number;
  commesseSaltate: Array<{ id: number; codice: string; motivo: string }>;
  refusedReason?: string;
};

function lastBackupOkWithin(hours: number): boolean {
  const snapshot = getAllStoreSnapshots().find(s => s.key === "backup_log");
  if (!snapshot) return false;
  const cutoff = Date.now() - hours * 3600 * 1000;
  return snapshot.items.some((riga: any) => {
    if (riga?.ok !== true || !riga?.finishedAt) return false;
    const istante = new Date(riga.finishedAt).getTime();
    return !Number.isNaN(istante) && istante >= cutoff;
  });
}

export type ResetPattuitiDeps = {
  commesse: any[];
  save: () => void;
  ricalcolaImportoIncassato: (commessa: any) => number;
};

export function resetPattuiti(
  opts: {
    apply: boolean;
    sedeId?: number | null;
    skipBackupCheck?: boolean;
    includiArchiviate?: boolean;
  },
  deps: ResetPattuitiDeps
): ResetPattuitiReport {
  const report: ResetPattuitiReport = {
    dryRun: !opts.apply,
    sedeId: opts.sedeId ?? null,
    commesseEsaminate: 0,
    pattuitiAzzerati: 0,
    pianiRimossi: 0,
    pagamentiManualiRimossi: 0,
    pagamentiFicConservati: 0,
    commesseSaltate: [],
  };

  if (opts.apply && !opts.skipBackupCheck && !lastBackupOkWithin(24)) {
    report.refusedReason =
      "RESET RIFIUTATO: nessun backup Drive riuscito nelle ultime 24 ore. " +
      "I pagamenti manuali vengono eliminati, non stornati: senza backup " +
      "recente non sono recuperabili. Esegui un backup manuale (Integrazioni " +
      "→ Backup) e rilancia, oppure passa --skip-backup-check assumendotene " +
      "la responsabilità.";
    return report;
  }

  for (const commessa of deps.commesse) {
    if (opts.sedeId != null && (commessa.sedeId ?? 1) !== opts.sedeId) continue;
    if (!opts.includiArchiviate && commessa.stato === "archiviata") {
      report.commesseSaltate.push({
        id: commessa.id,
        codice: String(commessa.codice ?? commessa.id),
        motivo: "archiviata",
      });
      continue;
    }
    report.commesseEsaminate++;

    if (commessa.importoTotale != null) report.pattuitiAzzerati++;
    const piano = Array.isArray(commessa.pianoRate) ? commessa.pianoRate : [];
    if (piano.length > 0) report.pianiRimossi++;

    const pagamenti = Array.isArray(commessa.pagamenti)
      ? commessa.pagamenti
      : [];
    const daFic = pagamenti.filter((p: any) => p.origine === "fic");
    const manuali = pagamenti.length - daFic.length;
    report.pagamentiManualiRimossi += manuali;
    report.pagamentiFicConservati += daFic.length;

    if (!opts.apply) continue;

    commessa.importoTotale = null;
    commessa.pattuitoFonte = null;
    commessa.pattuitoFicDocumentoIds = [];
    commessa.pattuitoAggiornatoAt = null;
    commessa.pianoRate = [];
    commessa.pagamenti = daFic;
    deps.ricalcolaImportoIncassato(commessa);
    commessa.updatedAt = new Date();
  }

  if (opts.apply) deps.save();
  return report;
}
