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

function meseDocumento(data: string): number | null {
  if (!/^\d{4}-\d{2}/.test(data)) return null;
  const value = Number(data.slice(5, 7));
  return value >= 1 && value <= 12 ? value : null;
}

function documentoUtilizzabile(documento: DocumentoEconomico): boolean {
  return documento.presenteInFic !== false && documento.ignorato !== true;
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
  const prefissoAnno = `${anno}-`;

  for (const documento of documenti) {
    if (
      !documentoUtilizzabile(documento) ||
      !documento.data.startsWith(prefissoAnno)
    ) {
      continue;
    }
    const lato = latoDocumento(documento.tipo);
    const totali = lato === "vendite" ? vendite : acquisti;
    const segno = segnoDocumento(documento.tipo);
    totali.netto += segno * documento.importoNetto;
    totali.iva += segno * documento.importoIva;
    totali.lordo += segno * documento.importoLordo;
    totali.documenti++;
    if (segno < 0) totali.noteCredito++;

    const mese = meseDocumento(documento.data);
    if (mese) {
      const aggregatoMese = mesi[mese - 1];
      if (lato === "vendite") {
        aggregatoMese.venditeNetto += segno * documento.importoNetto;
        aggregatoMese.venditeLordo += segno * documento.importoLordo;
      } else {
        aggregatoMese.acquistiNetto += segno * documento.importoNetto;
        aggregatoMese.acquistiLordo += segno * documento.importoLordo;
      }
    }

    for (const rata of documento.rate ?? []) {
      if (rata.stato === "paid") {
        totali.pagato += segno * rata.importo;
        if (mese) {
          if (lato === "vendite")
            mesi[mese - 1].incassi += segno * rata.importo;
          else mesi[mese - 1].uscite += segno * rata.importo;
        }
      } else if (rata.stato === "not_paid") {
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
  const giorno = data.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(giorno) && giorno >= da && giorno <= a;
}

export function calcolaBreakEven(input: BreakEvenInput): BreakEvenResult {
  const osservato = new Date(Date.UTC(input.anno, input.mese - 1, 1));
  const fineBaseDate = new Date(Date.UTC(input.anno, input.mese - 1, 0));
  const inizioBaseDate = new Date(
    Date.UTC(fineBaseDate.getUTCFullYear(), fineBaseDate.getUTCMonth() - 11, 1)
  );
  const periodoDa = `${chiaveMese(inizioBaseDate)}-01`;
  const periodoA = fineBaseDate.toISOString().slice(0, 10);
  const meseOsservato = chiaveMese(osservato);

  const emessiBase = input.documentiEmessi.filter(
    documento =>
      documentoUtilizzabile(documento) &&
      dataInIntervallo(documento.data, periodoDa, periodoA)
  );
  const costiBase = input.costi.filter(
    documento =>
      documentoUtilizzabile(documento) &&
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
        documentoUtilizzabile(documento) &&
        documento.data.startsWith(`${meseOsservato}-`)
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
