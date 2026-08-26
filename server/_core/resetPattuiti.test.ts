// Il reset elimina dati che non tornano indietro: le guardie contano quanto
// l'effetto.

import { describe, expect, it, vi } from "vitest";
import { resetPattuiti } from "./resetPattuiti";
import { ricalcolaImportoIncassato } from "./commessaPayments";

vi.mock("./persistence", () => ({
  getAllStoreSnapshots: () => snapshots,
}));

let snapshots: Array<{ key: string; items: any[] }> = [];

function conBackupRecente() {
  snapshots = [
    {
      key: "backup_log",
      items: [{ ok: true, finishedAt: new Date().toISOString() }],
    },
  ];
}

function senzaBackup() {
  snapshots = [];
}

const commesseDiProva = () => [
  {
    id: 1,
    codice: "COM-2026-001",
    sedeId: 1,
    stato: "produzione",
    importoTotale: 5_000,
    pattuitoFonte: "manuale",
    pattuitoFicDocumentoIds: [],
    pianoRate: [{ id: 1, importo: 5_000, origine: "manuale" }],
    pagamenti: [
      { id: 1, importo: 1_000, origine: "manuale", stato: "attivo" },
      { id: 2, importo: 2_000, origine: "fic", stato: "attivo" },
    ],
    importoIncassato: 3_000,
  },
  {
    id: 2,
    codice: "COM-2025-090",
    sedeId: 1,
    stato: "archiviata",
    importoTotale: 9_000,
    pagamenti: [{ id: 1, importo: 9_000, origine: "manuale", stato: "attivo" }],
    importoIncassato: 9_000,
  },
  {
    id: 3,
    codice: "COM-2026-500",
    sedeId: 2,
    stato: "produzione",
    importoTotale: 1_000,
    pagamenti: [],
    importoIncassato: 0,
  },
];

const deps = (commesse: any[]) => ({
  commesse,
  save: vi.fn(),
  ricalcolaImportoIncassato,
});

describe("resetPattuiti", () => {
  it("senza backup recente rifiuta l'apply e non tocca niente", () => {
    senzaBackup();
    const commesse = commesseDiProva();
    const d = deps(commesse);
    const report = resetPattuiti({ apply: true }, d);

    expect(report.refusedReason).toContain("RESET RIFIUTATO");
    expect(commesse[0].importoTotale).toBe(5_000);
    expect(d.save).not.toHaveBeenCalled();
  });

  it("il dry-run conta senza scrivere, anche senza backup", () => {
    senzaBackup();
    const commesse = commesseDiProva();
    const d = deps(commesse);
    const report = resetPattuiti({ apply: false }, d);

    expect(report.refusedReason).toBeUndefined();
    expect(report.commesseEsaminate).toBe(2); // l'archiviata resta fuori
    expect(report.pattuitiAzzerati).toBe(2);
    expect(report.pagamentiManualiRimossi).toBe(1);
    expect(report.pagamentiFicConservati).toBe(1);
    expect(commesse[0].importoTotale).toBe(5_000);
    expect(d.save).not.toHaveBeenCalled();
  });

  it("azzera pattuito e rate, conserva i movimenti FiC", () => {
    conBackupRecente();
    const commesse = commesseDiProva();
    const d = deps(commesse);
    resetPattuiti({ apply: true }, d);

    expect(commesse[0].importoTotale).toBeNull();
    expect(commesse[0].pattuitoFonte).toBeNull();
    expect(commesse[0].pianoRate).toEqual([]);
    expect(commesse[0].pagamenti).toEqual([
      expect.objectContaining({ id: 2, origine: "fic" }),
    ]);
    expect(commesse[0].importoIncassato).toBe(2_000);
    expect(d.save).toHaveBeenCalled();
  });

  it("non tocca le archiviate se non richiesto", () => {
    conBackupRecente();
    const commesse = commesseDiProva();
    resetPattuiti({ apply: true }, deps(commesse));
    expect(commesse[1].importoTotale).toBe(9_000);

    const altre = commesseDiProva();
    resetPattuiti({ apply: true, includiArchiviate: true }, deps(altre));
    expect(altre[1].importoTotale).toBeNull();
  });

  it("il filtro sede lascia intatte le altre sedi", () => {
    conBackupRecente();
    const commesse = commesseDiProva();
    resetPattuiti({ apply: true, sedeId: 1 }, deps(commesse));
    expect(commesse[0].importoTotale).toBeNull();
    expect(commesse[2].importoTotale).toBe(1_000);
  });
});
