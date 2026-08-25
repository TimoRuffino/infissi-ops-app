export type RefreshableTarsProposal = {
  id: number;
  origineId: number | null;
  tipo: string;
  stato: string;
  seguitoAt: Date | string | null;
  esito: string | null;
};

export function chatNeedsRefresh(
  proposte: RefreshableTarsProposal[]
): boolean {
  const parentIds = new Set(
    proposte
      .map(proposta => proposta.origineId)
      .filter((id): id is number => id != null)
  );
  return proposte.some(
    proposta =>
      (proposta.tipo === "domanda" &&
        proposta.stato === "risposta" &&
        proposta.seguitoAt != null &&
        !parentIds.has(proposta.id)) ||
      (proposta.stato === "approvata" && !proposta.esito)
  );
}
