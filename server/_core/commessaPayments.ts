export type MetodoPagamento =
  | "bonifico"
  | "contanti"
  | "assegno"
  | "pos"
  | "finanziamento"
  | "altro";

export type TipoPagamento =
  | "acconto_1"
  | "acconto_2"
  | "acconto_3"
  | "acconto_4"
  | "acconto_5"
  | "saldo";

export type OriginePagamento = "manuale" | "fic";
export type StatoPagamento = "attivo" | "stornato";

export type PagamentoCommessa = {
  id: number;
  importo: number;
  data: string | null;
  metodo: MetodoPagamento | null;
  tipo: TipoPagamento | null;
  note: string | null;
  origine: OriginePagamento;
  stato: StatoPagamento;
  ficDocumentoId: number | null;
  ficRataId: number | null;
  ficSourceKey: string | null;
  ficStato: string | null;
  ficUltimoSyncAt: Date | null;
  stornatoAt: Date | null;
  createdAt: Date;
  updatedAt: Date | null;
};

function dateOrNull(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizzaPagamentoLegacy(value: any): PagamentoCommessa {
  return {
    ...value,
    id: Number(value?.id ?? 0),
    importo: Number(value?.importo ?? 0),
    data: value?.data ? String(value.data) : null,
    metodo: value?.metodo ?? null,
    tipo: value?.tipo ?? null,
    note: value?.note ?? null,
    origine: value?.origine === "fic" ? "fic" : "manuale",
    stato: value?.stato === "stornato" ? "stornato" : "attivo",
    ficDocumentoId:
      value?.ficDocumentoId == null ? null : Number(value.ficDocumentoId),
    ficRataId: value?.ficRataId == null ? null : Number(value.ficRataId),
    ficSourceKey: value?.ficSourceKey ? String(value.ficSourceKey) : null,
    ficStato: value?.ficStato ? String(value.ficStato) : null,
    ficUltimoSyncAt: dateOrNull(value?.ficUltimoSyncAt),
    stornatoAt: dateOrNull(value?.stornatoAt),
    createdAt: dateOrNull(value?.createdAt) ?? new Date(),
    updatedAt: dateOrNull(value?.updatedAt),
  };
}

export function calcolaImportoIncassato(
  pagamenti: ReadonlyArray<
    Pick<PagamentoCommessa, "importo"> & { stato?: string }
  >
): number {
  const totale = pagamenti.reduce(
    (sum, pagamento) =>
      pagamento.stato === "stornato"
        ? sum
        : sum + (Number.isFinite(Number(pagamento.importo)) ? Number(pagamento.importo) : 0),
    0
  );
  return Math.round((totale + Number.EPSILON) * 100) / 100;
}

export function ricalcolaImportoIncassato(commessa: {
  pagamenti?: any[];
  importoIncassato?: number;
}): number {
  const totale = calcolaImportoIncassato(
    Array.isArray(commessa.pagamenti) ? commessa.pagamenti : []
  );
  commessa.importoIncassato = totale;
  return totale;
}

export function pagamentoCompatibile(
  pagamento: Pick<PagamentoCommessa, "importo" | "data" | "stato">,
  rata: { importo: number; dataPagamento: string | null }
): "esatto" | "data_da_completare" | "nessuno" {
  if (pagamento.stato !== "attivo") return "nessuno";
  if (Math.abs(Number(pagamento.importo) - Number(rata.importo)) >= 0.01) {
    return "nessuno";
  }
  if (pagamento.data === rata.dataPagamento) return "esatto";
  if (pagamento.data == null && rata.dataPagamento != null) {
    return "data_da_completare";
  }
  return "nessuno";
}

export function fingerprintPagamento(value: {
  importo: number;
  data: string | null;
  stato: StatoPagamento;
}): string {
  return `${Number(value.importo).toFixed(2)}|${value.data ?? "-"}|${value.stato}`;
}
