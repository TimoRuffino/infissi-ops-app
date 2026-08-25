import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  calcolaAggregatiFic,
  calcolaBreakEven,
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
      const commesse = getCommesseStore().filter(
        (commessa: any) => commessa.sedeId === sedeId
      );
      const fattureAnno = ficFatture.filter(
        fattura =>
          fattura.sedeId === sedeId &&
          fattura.tipo === "invoice" &&
          fattura.presenteInFic &&
          !fattura.ignorata &&
          fattura.data.startsWith(String(anno))
      );
      const daRiconciliare = fattureAnno.filter(fattura => {
        const stato = statoFattura(fattura, commesse).stato;
        return stato === "da_riconciliare" || stato === "non_abbinabile";
      }).length;
      const costiAnno = ficCosti.filter(
        costo =>
          costo.sedeId === sedeId &&
          costo.presenteInFic &&
          costo.data.startsWith(String(anno))
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
        daIncassare: aggregati.vendite.aperto,
        daRiconciliare,
      };
      const acquisti = {
        disponibile: aggregati.acquisti.documenti > 0,
        documenti: aggregati.acquisti.documenti,
        noteCredito: aggregati.acquisti.noteCredito,
        netto: aggregati.acquisti.netto,
        iva: aggregati.acquisti.iva,
        lordo: aggregati.acquisti.lordo,
        pagato: aggregati.acquisti.pagato,
        daPagare: aggregati.acquisti.aperto,
        dubbi: documentiDubbi.length,
        importoDubbio,
      };

      return {
        anno,
        crm: riepilogoCrm(sedeId),
        vendite,
        acquisti,
        // Alias compatibile: ora il fatturato è correttamente netto IVA.
        fic: {
          disponibile: vendite.disponibile,
          fatture: vendite.fatture,
          fatturato: vendite.netto,
          incassato: vendite.incassato,
          daIncassare: vendite.daIncassare,
          daRiconciliare: vendite.daRiconciliare,
        },
        mesi: aggregati.mesi.map(mese => ({
          ...mese,
          fatturato: mese.venditeNetto,
          incassi: mese.incassi,
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
