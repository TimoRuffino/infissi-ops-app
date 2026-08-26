export type TipoDocumentoEconomico =
  | "invoice"
  | "credit_note"
  | "expense"
  | "passive_credit_note";

export type ClassificazioneCostoEconomico =
  | "fisso"
  | "variabile_commessa"
  | "straordinario"
  | "dubbio";

export type RataEconomica = {
  importo: number;
  stato: string;
  scadenza?: string | null;
  dataPagamento?: string | null;
};

export type DocumentoEconomico = {
  tipo: TipoDocumentoEconomico;
  data: string;
  importoNetto: number;
  importoIva: number;
  importoLordo: number;
  rate: RataEconomica[];
  presenteInFic: boolean;
  ignorato?: boolean;
  classificazione?: ClassificazioneCostoEconomico | null;
};

export type TotaliEconomici = {
  netto: number;
  iva: number;
  lordo: number;
  pagato: number;
  pagatoSenzaData: number;
  ratePagateSenzaData: number;
  aperto: number;
  documenti: number;
  noteCredito: number;
};

export type AggregatiFic = {
  anno: number;
  vendite: TotaliEconomici;
  acquisti: TotaliEconomici;
  mesi: Array<{
    mese: number;
    venditeNetto: number;
    venditeLordo: number;
    incassi: number;
    acquistiNetto: number;
    acquistiLordo: number;
    uscite: number;
  }>;
};

const ZERO_TOTALI = (): TotaliEconomici => ({
  netto: 0,
  iva: 0,
  lordo: 0,
  pagato: 0,
  pagatoSenzaData: 0,
  ratePagateSenzaData: 0,
  aperto: 0,
  documenti: 0,
  noteCredito: 0,
});

export function segnoDocumento(tipo: TipoDocumentoEconomico): 1 | -1 {
  return tipo === "credit_note" || tipo === "passive_credit_note" ? -1 : 1;
}

function latoDocumento(tipo: TipoDocumentoEconomico): "vendite" | "acquisti" {
  return tipo === "invoice" || tipo === "credit_note" ? "vendite" : "acquisti";
}

function partiDataValida(data: string | null | undefined): {
  anno: number;
  mese: number;
  giorno: number;
} | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data ?? "");
  if (!match) return null;
  const annoData = Number(match[1]);
  const mese = Number(match[2]);
  const giorno = Number(match[3]);
  const verificata = new Date(Date.UTC(annoData, mese - 1, giorno));
  if (
    verificata.getUTCFullYear() !== annoData ||
    verificata.getUTCMonth() + 1 !== mese ||
    verificata.getUTCDate() !== giorno
  ) {
    return null;
  }
  return { anno: annoData, mese, giorno };
}

export function classificaDataAnnuale(
  data: string | null | undefined,
  anno: number
): number | "fuori_periodo" | "non_valida" {
  const parti = partiDataValida(data);
  if (!parti) return "non_valida";
  return parti.anno === anno ? parti.mese : "fuori_periodo";
}

function documentoContabilizzabile(documento: DocumentoEconomico): boolean {
  return documento.presenteInFic !== false;
}

export function calcolaAggregatiFic(
  documenti: DocumentoEconomico[],
  anno: number
): AggregatiFic {
  const vendite = ZERO_TOTALI();
  const acquisti = ZERO_TOTALI();
  const mesi = Array.from({ length: 12 }, (_, index) => ({
    mese: index + 1,
    venditeNetto: 0,
    venditeLordo: 0,
    incassi: 0,
    acquistiNetto: 0,
    acquistiLordo: 0,
    uscite: 0,
  }));
  for (const documento of documenti) {
    if (!documentoContabilizzabile(documento)) continue;
    const lato = latoDocumento(documento.tipo);
    const totali = lato === "vendite" ? vendite : acquisti;
    const segno = segnoDocumento(documento.tipo);
    const meseDocumento = classificaDataAnnuale(documento.data, anno);
    const nelPeriodo = typeof meseDocumento === "number";

    if (nelPeriodo) {
      totali.netto += segno * documento.importoNetto;
      totali.iva += segno * documento.importoIva;
      totali.lordo += segno * documento.importoLordo;
      totali.documenti++;
      if (segno < 0) totali.noteCredito++;

      if (typeof meseDocumento === "number") {
        const aggregatoMese = mesi[meseDocumento - 1];
        if (lato === "vendite") {
          aggregatoMese.venditeNetto += segno * documento.importoNetto;
          aggregatoMese.venditeLordo += segno * documento.importoLordo;
        } else {
          aggregatoMese.acquistiNetto += segno * documento.importoNetto;
          aggregatoMese.acquistiLordo += segno * documento.importoLordo;
        }
      }
    }

    for (const rata of documento.rate ?? []) {
      if (rata.stato === "paid") {
        const mesePagamento = classificaDataAnnuale(rata.dataPagamento, anno);
        if (typeof mesePagamento === "number") {
          totali.pagato += segno * rata.importo;
          if (lato === "vendite")
            mesi[mesePagamento - 1].incassi += segno * rata.importo;
          else mesi[mesePagamento - 1].uscite += segno * rata.importo;
        } else if (mesePagamento === "non_valida") {
          totali.pagatoSenzaData += segno * rata.importo;
          totali.ratePagateSenzaData++;
        }
      } else if (rata.stato === "not_paid" && nelPeriodo) {
        totali.aperto += segno * rata.importo;
      }
    }
  }

  return { anno, vendite, acquisti, mesi };
}

export type BreakEvenInput = {
  anno: number;
  mese: number;
  documentiEmessi: DocumentoEconomico[];
  costi: DocumentoEconomico[];
};

export type BreakEvenResult = {
  stato: "disponibile" | "dati_insufficienti";
  affidabilita: "alta" | "media" | "insufficiente";
  mesiCoperti: number;
  periodoDa: string;
  periodoA: string;
  fatturatoBase: number;
  costiVariabili: number;
  costiFissi: number;
  margineContribuzione: number | null;
  costiFissiMensili: number | null;
  obiettivoMensile: number | null;
  fatturatoMese: number;
  ancoraDaFatturare: number | null;
  documentiDubbi: number;
  importoDubbio: number;
  motivi: string[];
};

function chiaveMese(data: Date): string {
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, "0")}`;
}

function dataInIntervallo(data: string, da: string, a: string): boolean {
  return partiDataValida(data) != null && data >= da && data <= a;
}

export function calcolaBreakEven(input: BreakEvenInput): BreakEvenResult {
  const fineBaseDate = new Date(Date.UTC(input.anno, input.mese - 1, 0));
  const inizioBaseDate = new Date(
    Date.UTC(fineBaseDate.getUTCFullYear(), fineBaseDate.getUTCMonth() - 11, 1)
  );
  const periodoDa = `${chiaveMese(inizioBaseDate)}-01`;
  const periodoA = fineBaseDate.toISOString().slice(0, 10);

  const emessiBase = input.documentiEmessi.filter(
    documento =>
      documentoContabilizzabile(documento) &&
      dataInIntervallo(documento.data, periodoDa, periodoA)
  );
  const costiBase = input.costi.filter(
    documento =>
      documentoContabilizzabile(documento) &&
      dataInIntervallo(documento.data, periodoDa, periodoA)
  );

  const fatturatoBase = emessiBase.reduce(
    (somma, documento) =>
      somma + segnoDocumento(documento.tipo) * documento.importoNetto,
    0
  );
  const costiVariabili = costiBase
    .filter(documento => documento.classificazione === "variabile_commessa")
    .reduce(
      (somma, documento) =>
        somma + segnoDocumento(documento.tipo) * documento.importoNetto,
      0
    );
  const costiFissi = costiBase
    .filter(documento => documento.classificazione === "fisso")
    .reduce(
      (somma, documento) =>
        somma + segnoDocumento(documento.tipo) * documento.importoNetto,
      0
    );
  const dubbi = costiBase.filter(
    documento => documento.classificazione === "dubbio"
  );
  const importoDubbio = dubbi.reduce(
    (somma, documento) =>
      somma + segnoDocumento(documento.tipo) * documento.importoNetto,
    0
  );

  const mesiConDati = new Set<string>();
  for (const documento of [...emessiBase, ...costiBase]) {
    if (
      latoDocumento(documento.tipo) === "acquisti" &&
      documento.classificazione === "dubbio"
    ) {
      continue;
    }
    mesiConDati.add(documento.data.slice(0, 7));
  }
  const mesiCoperti = mesiConDati.size;
  const margineContribuzione =
    fatturatoBase > 0 ? (fatturatoBase - costiVariabili) / fatturatoBase : null;
  const motivi: string[] = [];
  if (mesiCoperti < 3) {
    motivi.push("Servono almeno tre mesi di dati economici.");
  }
  if (fatturatoBase <= 0) {
    motivi.push("Il fatturato netto del periodo base deve essere positivo.");
  }
  if (margineContribuzione == null || margineContribuzione <= 0) {
    motivi.push("Il margine di contribuzione non è positivo.");
  }

  const fatturatoMese = input.documentiEmessi
    .filter(
      documento =>
        documentoContabilizzabile(documento) &&
        classificaDataAnnuale(documento.data, input.anno) === input.mese
    )
    .reduce(
      (somma, documento) =>
        somma + segnoDocumento(documento.tipo) * documento.importoNetto,
      0
    );

  if (motivi.length > 0) {
    return {
      stato: "dati_insufficienti",
      affidabilita: "insufficiente",
      mesiCoperti,
      periodoDa,
      periodoA,
      fatturatoBase,
      costiVariabili,
      costiFissi,
      margineContribuzione,
      costiFissiMensili: null,
      obiettivoMensile: null,
      fatturatoMese,
      ancoraDaFatturare: null,
      documentiDubbi: dubbi.length,
      importoDubbio,
      motivi,
    };
  }

  const costiFissiMensili = costiFissi / mesiCoperti;
  const obiettivoMensile = costiFissiMensili / margineContribuzione!;
  return {
    stato: "disponibile",
    affidabilita: mesiCoperti >= 12 ? "alta" : "media",
    mesiCoperti,
    periodoDa,
    periodoA,
    fatturatoBase,
    costiVariabili,
    costiFissi,
    margineContribuzione,
    costiFissiMensili,
    obiettivoMensile,
    fatturatoMese,
    ancoraDaFatturare: Math.max(0, obiettivoMensile - fatturatoMese),
    documentiDubbi: dubbi.length,
    importoDubbio,
    motivi,
  };
}
