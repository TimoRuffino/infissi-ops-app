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
import { ficFatture, statoFattura } from "./ficFatture";

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

function riepilogoCrm(sedeId: number) {
  const commesse = getCommesseStore().filter(
    (commessa: any) => commessa.sedeId === sedeId
  );
  const attive = commesse.filter(
    (commessa: any) => !commessa.archivedAt && commessa.stato !== "archiviata"
  );
  let pattuito = 0;
  let incassato = 0;
  let residuo = 0;
  let costiManualiStimati = 0;
  let costoPosaStimato = 0;
  let commesseConPattuito = 0;

  for (const commessa of attive as any[]) {
    const pagamenti: any[] = Array.isArray(commessa.pagamenti)
      ? commessa.pagamenti
      : [];
    const costi: any[] = Array.isArray(commessa.costi) ? commessa.costi : [];
    const incassoCommessa = pagamenti.reduce(
      (somma, pagamento) => somma + Number(pagamento.importo ?? 0),
      0
    );
    if (Number(commessa.importoTotale) > 0) {
      const importo = Number(commessa.importoTotale);
      pattuito += importo;
      incassato += incassoCommessa;
      residuo += Math.max(0, importo - incassoCommessa);
      commesseConPattuito++;
    }
    costiManualiStimati += costi.reduce(
      (somma, costo) => somma + Number(costo.importo ?? 0),
      0
    );
    costoPosaStimato += Number(commessa.costoPosaStimato ?? 0);
  }
  const margineStimato = pattuito - costiManualiStimati - costoPosaStimato;
  return {
    pattuito,
    incassato,
    residuo,
    commesseAttive: attive.length,
    commesseConPattuito,
    costiManualiStimati,
    costoPosaStimato,
    margineStimato,
    margineStimatoPerc: pattuito > 0 ? margineStimato / pattuito : null,
    // Alias temporanei per le viste ancora in migrazione.
    costiFornitore: costiManualiStimati,
    costoPosa: costoPosaStimato,
    margineLordo: margineStimato,
    marginePerc: pattuito > 0 ? margineStimato / pattuito : null,
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
        crm: riepilogoCrm(sedeId),
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
      return calcolaBreakEven({
        anno: input.anno,
        mese: input.mese,
        documentiEmessi: documentiEmessi(sedeId),
        costi: documentiRicevuti(sedeId),
      });
    }),
});
