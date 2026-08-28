import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  calcolaAggregatiFic,
  calcolaBreakEven,
  classificaDataAnnuale,
  type DocumentoEconomico,
} from "../_core/economiaFic";
import { requireDirezioneOAmministrazione } from "../_core/permissions";
import { protectedProcedure, router } from "../_core/trpc";
import { getCommesseStore } from "./commesse";
import { ficCosti } from "./ficCosti";
import { costiFissiAzienda, impostazioniPareggio } from "./costiFissi";
import { ficFatture, statoFattura } from "./ficFatture";
import { calcolaImportoIncassato } from "../_core/commessaPayments";
import { annoCommessa } from "../_core/annoCommessa";

function documentiEmessi(sedeId: number): DocumentoEconomico[] {
  return ficFatture
    .filter(documento => documento.sedeId === sedeId)
    .map(documento => ({
      tipo: documento.tipo,
      data: documento.data,
      importoNetto: documento.importoNetto,
      importoIva: documento.importoIva,
      importoLordo: documento.importoLordo,
      rate: documento.rate,
      presenteInFic: documento.presenteInFic,
      ignorato: documento.ignorata,
    }));
}

function documentiRicevuti(sedeId: number): DocumentoEconomico[] {
  return ficCosti
    .filter(documento => documento.sedeId === sedeId)
    .map(documento => ({
      tipo: documento.tipo,
      data: documento.data,
      importoNetto: documento.importoNetto,
      importoIva: documento.importoIva,
      importoLordo: documento.importoLordo,
      rate: documento.rate,
      presenteInFic: documento.presenteInFic,
      classificazione: documento.classificazione,
    }));
}

/**
 * Le commesse dell'anno viste dal CRM.
 *
 * Due cambi rispetto alla versione precedente, entrambi per poter mettere
 * questi numeri accanto a quelli FiC senza mentire:
 *
 * 1. È dell'ANNO, non all-time. Prima sommava tutte le commesse attive e il
 *    totale finiva a fianco di un fatturato annuale: due perimetri diversi
 *    presentati come confrontabili.
 * 2. Include le archiviate. Una commessa chiusa e archiviata a marzo è
 *    lavoro del 2026 esattamente come una ancora aperta, e toglierla faceva
 *    calare il pattuito dell'anno mentre l'anno andava avanti.
 *
 * Il pattuito è diviso per provenienza perché è la differenza che la
 * direzione cerca: quello delle commesse fatturate è la stessa cifra che sta
 * in FiC (lordo), quello delle commesse senza fattura è il di più che solo il
 * CRM conosce — lavoro concordato e non ancora fatturato.
 */
function riepilogoCommesse(sedeId: number, anno: number) {
  const dellAnno = (getCommesseStore() as any[]).filter(
    commessa => commessa.sedeId === sedeId && annoCommessa(commessa) === anno
  );

  let pattuito = 0;
  let pattuitoDaFattura = 0;
  let pattuitoSoloCrm = 0;
  let incassato = 0;
  let residuo = 0;
  let conFattura = 0;
  let senzaFattura = 0;
  let senzaPattuito = 0;
  let costiManualiStimati = 0;
  let costoPosaStimato = 0;

  for (const commessa of dellAnno) {
    const haFattura = (commessa.pattuitoFicDocumentoIds ?? []).length > 0;
    if (haFattura) conFattura++;
    else senzaFattura++;

    const costi: any[] = Array.isArray(commessa.costi) ? commessa.costi : [];
    costiManualiStimati += costi.reduce(
      (somma, costo) => somma + Number(costo.importo ?? 0),
      0
    );
    costoPosaStimato += Number(commessa.costoPosaStimato ?? 0);

    const importo = Number(commessa.importoTotale ?? 0);
    if (!(importo > 0)) {
      senzaPattuito++;
      continue;
    }
    const pagamenti: any[] = Array.isArray(commessa.pagamenti)
      ? commessa.pagamenti
      : [];
    const incasso = calcolaImportoIncassato(pagamenti);
    pattuito += importo;
    if (haFattura) pattuitoDaFattura += importo;
    else pattuitoSoloCrm += importo;
    incassato += incasso;
    residuo += Math.max(0, importo - incasso);
  }

  const arrotonda = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
  const attive = (getCommesseStore() as any[]).filter(
    commessa =>
      commessa.sedeId === sedeId &&
      !commessa.archivedAt &&
      commessa.stato !== "archiviata"
  ).length;

  return {
    anno,
    commesse: dellAnno.length,
    commesseAttive: attive,
    commesseConPattuito: dellAnno.length - senzaPattuito,
    commesseSenzaPattuito: senzaPattuito,
    commesseConFattura: conFattura,
    commesseSenzaFattura: senzaFattura,
    pattuito: arrotonda(pattuito),
    pattuitoDaFattura: arrotonda(pattuitoDaFattura),
    pattuitoSoloCrm: arrotonda(pattuitoSoloCrm),
    incassato: arrotonda(incassato),
    residuo: arrotonda(residuo),
    costiManualiStimati: arrotonda(costiManualiStimati),
    costoPosaStimato: arrotonda(costoPosaStimato),
  };
}

function flussoCassaCrm(sedeId: number, anno: number) {
  const mesi = Array.from({ length: 12 }, () => 0);
  let incassato = 0;
  let senzaData = 0;
  let pagamentiSenzaData = 0;

  for (const commessa of getCommesseStore() as any[]) {
    if (commessa.sedeId !== sedeId) continue;
    const pagamenti: any[] = Array.isArray(commessa.pagamenti)
      ? commessa.pagamenti
      : [];
    for (const pagamento of pagamenti) {
      if (pagamento.stato === "stornato") continue;
      const importo = Number(pagamento.importo ?? 0);
      if (!Number.isFinite(importo)) continue;
      const mesePagamento = classificaDataAnnuale(pagamento.data, anno);
      if (mesePagamento === "non_valida") {
        senzaData += importo;
        pagamentiSenzaData++;
        continue;
      }
      if (mesePagamento === "fuori_periodo") {
        continue;
      }
      incassato += importo;
      mesi[mesePagamento - 1] += importo;
    }
  }

  return { incassato, senzaData, pagamentiSenzaData, mesi };
}

export const economiaRouter = router({
  overview: protectedProcedure
    .input(z.object({ anno: z.number().int().optional() }).optional())
    .query(({ input, ctx }) => {
      requireDirezioneOAmministrazione(ctx.user);
      const anno = input?.anno ?? new Date().getFullYear();
      const sedeId = ctx.sedeId ?? 1;
      const emessi = documentiEmessi(sedeId);
      const ricevuti = documentiRicevuti(sedeId);
      const aggregati = calcolaAggregatiFic([...emessi, ...ricevuti], anno);
      const cassaCrm = flussoCassaCrm(sedeId, anno);
      const ficIncassiDisponibili = emessi.some(
        documento => documento.presenteInFic !== false
      );
      const commesse = getCommesseStore().filter(
        (commessa: any) => commessa.sedeId === sedeId
      );
      const fattureAnno = ficFatture.filter(
        fattura =>
          fattura.sedeId === sedeId &&
          fattura.tipo === "invoice" &&
          fattura.presenteInFic &&
          typeof classificaDataAnnuale(fattura.data, anno) === "number"
      );
      const escluseRiconciliazione = fattureAnno.filter(
        fattura => fattura.ignorata
      ).length;
      const daRiconciliare = fattureAnno.filter(fattura => {
        const stato = statoFattura(fattura, commesse).stato;
        return stato === "da_riconciliare" || stato === "non_abbinabile";
      }).length;
      const costiAnno = ficCosti.filter(
        costo =>
          costo.sedeId === sedeId &&
          costo.presenteInFic &&
          typeof classificaDataAnnuale(costo.data, anno) === "number"
      );
      const documentiDubbi = costiAnno.filter(
        costo => costo.classificazione === "dubbio"
      );
      const importoDubbio = documentiDubbi.reduce(
        (somma, costo) =>
          somma +
          (costo.tipo === "passive_credit_note" ? -1 : 1) * costo.importoNetto,
        0
      );

      const vendite = {
        disponibile: aggregati.vendite.documenti > 0,
        fatture: fattureAnno.length,
        noteCredito: aggregati.vendite.noteCredito,
        documenti: aggregati.vendite.documenti,
        netto: aggregati.vendite.netto,
        iva: aggregati.vendite.iva,
        lordo: aggregati.vendite.lordo,
        incassato: aggregati.vendite.pagato,
        incassatoSenzaData: aggregati.vendite.pagatoSenzaData,
        ratePagateSenzaData: aggregati.vendite.ratePagateSenzaData,
        daIncassare: aggregati.vendite.aperto,
        daRiconciliare,
        escluseRiconciliazione,
      };
      const acquisti = {
        disponibile: aggregati.acquisti.documenti > 0,
        documenti: aggregati.acquisti.documenti,
        noteCredito: aggregati.acquisti.noteCredito,
        netto: aggregati.acquisti.netto,
        iva: aggregati.acquisti.iva,
        lordo: aggregati.acquisti.lordo,
        pagato: aggregati.acquisti.pagato,
        pagatoSenzaData: aggregati.acquisti.pagatoSenzaData,
        ratePagateSenzaData: aggregati.acquisti.ratePagateSenzaData,
        daPagare: aggregati.acquisti.aperto,
        dubbi: documentiDubbi.length,
        importoDubbio,
      };

      return {
        anno,
        crm: riepilogoCommesse(sedeId, anno),
        vendite,
        acquisti,
        confrontoIncassi: {
          anno,
          disponibile: ficIncassiDisponibili,
          crm: cassaCrm.incassato,
          fic: vendite.incassato,
          scostamento: cassaCrm.incassato - vendite.incassato,
          crmSenzaData: cassaCrm.senzaData,
          pagamentiCrmSenzaData: cassaCrm.pagamentiSenzaData,
          ficSenzaData: vendite.incassatoSenzaData,
          rateFicSenzaData: vendite.ratePagateSenzaData,
          affidabile:
            ficIncassiDisponibili &&
            cassaCrm.pagamentiSenzaData === 0 &&
            vendite.ratePagateSenzaData === 0,
        },
        // Alias compatibile: ora il fatturato è correttamente netto IVA.
        fic: {
          disponibile: vendite.disponibile,
          fatture: vendite.fatture,
          fatturato: vendite.netto,
          incassato: vendite.incassato,
          incassatoSenzaData: vendite.incassatoSenzaData,
          daIncassare: vendite.daIncassare,
          daRiconciliare: vendite.daRiconciliare,
        },
        mesi: aggregati.mesi.map(mese => ({
          ...mese,
          fatturato: mese.venditeNetto,
          incassi: mese.incassi,
          incassiCrm: cassaCrm.mesi[mese.mese - 1],
          costi: mese.acquistiNetto,
        })),
      };
    }),

  breakEven: protectedProcedure
    .input(
      z.object({
        anno: z.number().int(),
        mese: z.number().int().min(1).max(12),
      })
    )
    .query(({ input, ctx }) => {
      requireDirezioneOAmministrazione(ctx.user);
      const annoCorrente = new Date().getFullYear();
      if (input.anno !== annoCorrente) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Il punto di pareggio è disponibile per l'anno corrente.",
        });
      }
      const sedeId = ctx.sedeId ?? 1;
      const impostazioni = impostazioniPareggio(sedeId);
      // Stesso periodo e stesso totale del registro dei costi fissi: due
      // finestre diverse davano due numeri diversi per la stessa azienda.
      const fissi = costiFissiAzienda(sedeId, {
        anno: input.anno,
        mese: input.mese,
      });
      return {
        ...calcolaBreakEven({
          periodoDa: fissi.periodoDa,
          periodoA: fissi.periodoA,
          documentiEmessi: documentiEmessi(sedeId),
          documentiRicevuti: documentiRicevuti(sedeId),
          costiFissiMensili: fissi.totaleMensile,
          costiFissiFicMensili: fissi.totaleFic,
          costiFissiDichiaratiMensili: fissi.totaleDichiarato,
          margineManuale: impostazioni.margineManuale,
          includiStraordinari: impostazioni.includiStraordinari,
        }),
        // Da dove esce il costo fisso, senza cambiare pagina: la cifra grande
        // non si crede se non si vede cosa c'è dentro.
        vociFisse: fissi.righe.length,
        fissiDaClassificare: fissi.documentiDaClassificare,
      };
    }),
});
