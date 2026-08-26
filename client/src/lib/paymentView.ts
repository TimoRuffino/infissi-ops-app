type PagamentoViewInput = {
  origine?: "manuale" | "fic" | null;
  stato?: "attivo" | "stornato" | null;
  ficDocumentoId?: number | null;
};

export function presentPagamento(p: PagamentoViewInput): {
  origineLabel: "Manuale" | "FiC";
  statoLabel: "Attivo" | "Stornato";
  canEdit: boolean;
  canRemove: boolean;
  fatturaLabel: string | null;
} {
  const isFic = p.origine === "fic";
  return {
    origineLabel: isFic ? "FiC" : "Manuale",
    statoLabel: p.stato === "stornato" ? "Stornato" : "Attivo",
    canEdit: !isFic,
    canRemove: !isFic,
    fatturaLabel:
      isFic && p.ficDocumentoId != null
        ? `Fattura FiC #${p.ficDocumentoId}`
        : null,
  };
}

export type FicSyncStatsView = {
  pagamentiCreati?: number;
  pagamentiAggiornati?: number;
  pagamentiStornati?: number;
  pagamentiRiattivati?: number;
  manualiRiconciliati?: number;
  correzioniProposte?: number;
  ambiguita?: number;
  proposteSuperate?: number;
  pdfArchiviati?: number;
  pdfFalliti?: number;
};

function voce(
  count: number | undefined,
  singolare: string,
  plurale: string
): string | null {
  if (!count || count < 1) return null;
  return `${count} ${count === 1 ? singolare : plurale}`;
}

export function presentFicSyncStats(stats: FicSyncStatsView): string[] {
  return [
    voce(stats.pagamentiCreati, "pagamento importato", "pagamenti importati"),
    voce(
      stats.pagamentiAggiornati,
      "pagamento aggiornato",
      "pagamenti aggiornati"
    ),
    voce(stats.pagamentiStornati, "pagamento stornato", "pagamenti stornati"),
    voce(
      stats.pagamentiRiattivati,
      "pagamento riattivato",
      "pagamenti riattivati"
    ),
    voce(
      stats.manualiRiconciliati,
      "pagamento manuale riconciliato",
      "pagamenti manuali riconciliati"
    ),
    voce(stats.correzioniProposte, "correzione proposta", "correzioni proposte"),
    voce(stats.ambiguita, "ambiguità da verificare", "ambiguità da verificare"),
    voce(stats.proposteSuperate, "proposta superata", "proposte superate"),
    voce(stats.pdfArchiviati, "PDF archiviato", "PDF archiviati"),
    voce(stats.pdfFalliti, "PDF da ritentare", "PDF da ritentare"),
  ].filter((item): item is string => item !== null);
}
