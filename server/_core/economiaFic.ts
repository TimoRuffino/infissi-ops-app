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
  anno?: number;
  mese?: number;
  periodoDa?: string;
  periodoA?: string;
  documentiEmessi: readonly DocumentoEconomico[];
  costi?: readonly DocumentoEconomico[];
  documentiRicevuti?: readonly DocumentoEconomico[];
  /**
   * Costi fissi dell'azienda al mese, già sommati: fatture d'acquisto FiC
   * classificate `fisso` più le voci dichiarate a mano. Il calcolo, con la
   * regola che evita di contare due volte lo stesso fornitore, sta in
   * `costiFissiAzienda.ts`. Qui arriva un numero solo perché il pareggio non
   * deve avere una seconda opinione su quanto costa l'azienda.
   */
  costiFissiMensili?: number;
  /** La quota che arriva da FiC. Serve solo a spiegare il totale. */
  costiFissiFicMensili?: number;
  /** La quota dichiarata a mano. Serve solo a spiegare il totale. */
  costiFissiDichiaratiMensili?: number;
  /**
   * Margine di contribuzione imposto (0–1). Quello calcolato esce dagli
   * ultimi dodici mesi: se in quel periodo molti costi erano ancora da
   * classificare, la percentuale non descrive l'azienda e conviene fissarla.
   */
  margineManuale?: number | null;
  /**
   * Contare gli straordinari fra i costi da coprire. Sui dati veli sono piu'
   * dei costi fissi e oggi non entrano da nessuna parte: ne' fissi ne'
   * variabili, quindi spariscono dal pareggio.
   */
  includiStraordinari?: boolean;
};

export type BreakEvenResult = {
  stato: "disponibile" | "dati_insufficienti";
  affidabilita: "alta" | "media" | "insufficiente";
  mesiCoperti: number;
  periodoDa: string;
  periodoA: string;
  fatturatoBase: number;
  costiVariabili: number;
  /** Costi fissi del periodo base, per confronto con fatturato e variabili. */
  costiFissi: number;
  /** Le due quote del costo fisso mensile, per spiegare da dove viene. */
  costiFissiFicMensili: number;
  costiFissiDichiaratiMensili: number;
  /** Straordinari del periodo: dentro il conto solo se richiesto. */
  costiStraordinari: number;
  straordinariInclusi: boolean;
  /** Il margine che i documenti dicono, anche quando ne viene imposto un altro. */
  margineCalcolato: number | null;
  margineFonte: "calcolato" | "manuale";
  /** Costi fissi al mese: il numero da coprire, prima del margine. */
  daCoprireMensile: number | null;
  margineContribuzione: number | null;
  costiFissiMensili: number | null;
  obiettivoMensile: number | null;
  /** Fatturato netto FiC del mese di riferimento. */
  fatturatoMese: number;
  /** Quale mese è, in "YYYY-MM". Il pannello lo etichetta con questo, non
   *  con la data di oggi: quando i due divergevano il numero sembrava
   *  sbagliato invece che di un altro mese. */
  meseFatturato: string;
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
  let periodoDa: string;
  let periodoA: string;
  if (input.periodoDa && input.periodoA) {
    periodoDa = input.periodoDa;
    periodoA = input.periodoA;
  } else if (input.anno != null && input.mese != null) {
    const fineBaseDate = new Date(Date.UTC(input.anno, input.mese - 1, 0));
    const inizioBaseDate = new Date(
      Date.UTC(fineBaseDate.getUTCFullYear(), fineBaseDate.getUTCMonth() - 11, 1)
    );
    periodoDa = `${chiaveMese(inizioBaseDate)}-01`;
    periodoA = fineBaseDate.toISOString().slice(0, 10);
  } else {
    throw new Error("Periodo break-even incompleto.");
  }

  const documentiRicevuti = input.documentiRicevuti ?? input.costi ?? [];

  const emessiBase = input.documentiEmessi.filter(
    documento =>
      documentoContabilizzabile(documento) &&
      dataInIntervallo(documento.data, periodoDa, periodoA)
  );
  const costiBase = documentiRicevuti.filter(
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
  const costiFissiFicMensili =
    Math.round((input.costiFissiFicMensili ?? 0) * 100) / 100;
  const costiFissiDichiaratiMensili =
    Math.round((input.costiFissiDichiaratiMensili ?? 0) * 100) / 100;
  const costiStraordinari = costiBase
    .filter(documento => documento.classificazione === "straordinario")
    .reduce(
      (somma, documento) =>
        somma + segnoDocumento(documento.tipo) * documento.importoNetto,
      0
    );
  const straordinariInclusi = input.includiStraordinari === true;
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
  const margineCalcolato =
    fatturatoBase > 0 ? (fatturatoBase - costiVariabili) / fatturatoBase : null;
  // Un margine imposto vale anche quando i documenti non basterebbero a
  // calcolarlo: e' il caso per cui esiste.
  const margineImposto =
    input.margineManuale != null &&
    input.margineManuale > 0 &&
    input.margineManuale <= 1
      ? input.margineManuale
      : null;
  const margineContribuzione = margineImposto ?? margineCalcolato;
  const margineFonte: "calcolato" | "manuale" =
    margineImposto != null ? "manuale" : "calcolato";
  // Quanto costa esistere ogni mese. Non dipende dal margine, quindi si
  // calcola prima: e' la risposta anche quando l'obiettivo non e'
  // calcolabile, ed e' il numero che la direzione chiedeva di vedere nudo.
  const fissiMensili =
    Math.round(
      (input.costiFissiMensili ??
        costiFissiFicMensili + costiFissiDichiaratiMensili) * 100
    ) / 100;
  const daCoprireMensile =
    Math.round(
      (fissiMensili +
        (straordinariInclusi && mesiCoperti > 0
          ? costiStraordinari / mesiCoperti
          : 0)) *
        100
    ) / 100;
  // Il costo fisso sull'intero periodo base: serve solo per leggerlo accanto
  // al fatturato e ai variabili, che sono anch'essi totali di periodo.
  const costiFissi = Math.round(fissiMensili * mesiCoperti * 100) / 100;

  const motivi: string[] = [];
  // Senza costi fissi confermati il minimo da fatturare varrebbe zero, e il
  // pannello direbbe "obiettivo raggiunto" a chi non ha ancora registrato
  // uno stipendio. Uno zero rassicurante e' peggio di un numero mancante.
  if (daCoprireMensile <= 0) {
    motivi.push(
      "Nessun costo fisso: classifica come «Fisso» gli acquisti che tornano ogni mese, e aggiungi stipendi, contributi e affitti in Contabilità → Costi fissi."
    );
  }
  if (mesiCoperti < 3) {
    motivi.push("Servono almeno tre mesi di dati economici.");
  }
  if (fatturatoBase <= 0) {
    motivi.push("Il fatturato netto del periodo base deve essere positivo.");
  }
  if (margineContribuzione == null || margineContribuzione <= 0) {
    motivi.push("Il margine di contribuzione non è positivo.");
  }

  const meseRiferimento =
    input.anno != null && input.mese != null
      ? `${input.anno}-${String(input.mese).padStart(2, "0")}`
      : periodoA.slice(0, 7);
  const fatturatoMese = input.documentiEmessi
    .filter(
      documento =>
        documentoContabilizzabile(documento) &&
        (input.anno != null && input.mese != null
          ? classificaDataAnnuale(documento.data, input.anno) === input.mese
          : documento.data.slice(0, 7) === meseRiferimento)
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
      costiFissiFicMensili,
      costiFissiDichiaratiMensili,
      costiStraordinari,
      straordinariInclusi,
      margineCalcolato,
      margineFonte,
      daCoprireMensile,
      margineContribuzione,
      costiFissiMensili: daCoprireMensile,
      obiettivoMensile: null,
      fatturatoMese,
      meseFatturato: meseRiferimento,
      ancoraDaFatturare: null,
      documentiDubbi: dubbi.length,
      importoDubbio,
      motivi,
    };
  }

  // I due addendi si mensilizzano in modo diverso, di proposito.
  //
  // Le fatture FiC si dividono per i mesi coperti: e' una media storica, ed
  // e' l'unico modo di leggerle. Le voci dichiarate invece hanno una data di
  // inizio e una di fine, quindi non serve stimarle: quello che conta per il
  // pareggio e' il peso di OGGI. Un canone chiuso a marzo non deve alzare
  // l'obiettivo di agosto, e uno acceso a luglio deve pesare per intero
  // subito, non per un dodicesimo.
  const costiFissiMensili = daCoprireMensile;
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
    costiFissiFicMensili,
    costiFissiDichiaratiMensili,
    costiStraordinari,
    straordinariInclusi,
    margineCalcolato,
    margineFonte,
    daCoprireMensile,
    margineContribuzione,
    costiFissiMensili,
    obiettivoMensile,
    fatturatoMese,
    meseFatturato: meseRiferimento,
    ancoraDaFatturare: Math.max(0, obiettivoMensile - fatturatoMese),
    documentiDubbi: dubbi.length,
    importoDubbio,
    motivi,
  };
}
