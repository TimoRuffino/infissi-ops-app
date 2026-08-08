// Economia — la situazione contabile in una pagina.
//
// Aggrega ciò che il CRM già sa, senza inventare nulla:
//   fatturato    dalle fatture FIC sincronizzate
//   incassato    dal registro acconti delle commesse (fonte di verità CRM)
//   da incassare pattuito − incassato, mai negativo PER COMMESSA (il bug
//                del «max sugli aggregati» è già stato pagato una volta)
//   costi        registro costi[] + costo posa stimato
//   margine      stessa formula pura di calcolaMargine
//
// Solo direzione e amministrazione: sono i dati economici dell'azienda.

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { requireDirezioneOAmministrazione } from "../_core/permissions";
import { getCommesseStore } from "./commesse";
import { ficFatture, statoFattura } from "./ficFatture";

function mese(data: string | null | undefined): number | null {
  if (!data || !/^\d{4}-\d{2}/.test(data)) return null;
  return Number(data.slice(5, 7));
}

export const economiaRouter = router({
  overview: protectedProcedure
    .input(z.object({ anno: z.number().int().optional() }).optional())
    .query(({ input, ctx }) => {
      requireDirezioneOAmministrazione(ctx.user);
      const anno = input?.anno ?? new Date().getFullYear();
      const annoStr = String(anno);
      const commesse = getCommesseStore().filter(
        (c: any) => c.sedeId === ctx.sedeId
      );

      // ── Lato CRM: pattuito, incassato, residuo, costi ────────────────
      let pattuito = 0;
      let incassato = 0;
      let residuo = 0;
      let costiFornitore = 0;
      let costoPosa = 0;
      let commesseConPattuito = 0;
      const incassiMese = new Array(12).fill(0);
      const costiMese = new Array(12).fill(0);

      for (const c of commesse as any[]) {
        if (c.archivedAt && !String(c.dataChiusura ?? "").startsWith(annoStr)) {
          // Le archiviate contano solo per i movimenti dell'anno.
        }
        const pag: any[] = Array.isArray(c.pagamenti) ? c.pagamenti : [];
        const cst: any[] = Array.isArray(c.costi) ? c.costi : [];

        // Movimenti dell'anno, per mese.
        for (const p of pag) {
          if (String(p.data ?? "").startsWith(annoStr)) {
            const m = mese(p.data);
            if (m) incassiMese[m - 1] += p.importo ?? 0;
          }
        }
        for (const k of cst) {
          if (String(k.data ?? "").startsWith(annoStr)) {
            const m = mese(k.data);
            if (m) costiMese[m - 1] += k.importo ?? 0;
          }
        }

        // Fotografia sulle attive: pattuito, incassato, residuo, costi.
        if (c.archivedAt) continue;
        if (c.importoTotale != null && c.importoTotale > 0) {
          pattuito += c.importoTotale;
          commesseConPattuito++;
          const inc = pag.reduce((s, p) => s + (p.importo ?? 0), 0);
          incassato += inc;
          // Per commessa, mai negativo: un sovrapagamento non deve
          // cancellare il credito di un'altra.
          residuo += Math.max(0, c.importoTotale - inc);
        }
        costiFornitore += cst.reduce((s, k) => s + (k.importo ?? 0), 0);
        costoPosa += c.costoPosaStimato ?? 0;
      }

      // ── Lato FIC: fatturato e incassi da fattura ─────────────────────
      const fattureAnno = ficFatture.filter((f) => f.data.startsWith(annoStr));
      let fatturato = 0;
      let incassatoFic = 0;
      let daIncassareFic = 0;
      const fatturatoMese = new Array(12).fill(0);
      let daRiconciliare = 0;
      for (const f of fattureAnno) {
        if (f.ignorata) continue;
        fatturato += f.importoLordo;
        const m = mese(f.data);
        if (m) fatturatoMese[m - 1] += f.importoLordo;
        for (const r of f.rate) {
          if (r.stato === "paid") incassatoFic += r.importo;
          else daIncassareFic += r.importo;
        }
        const s = statoFattura(f, commesse);
        if (s.stato === "da_riconciliare" || s.stato === "non_abbinabile") {
          daRiconciliare++;
        }
      }

      const margineLordo = pattuito - costiFornitore - costoPosa;

      return {
        anno,
        crm: {
          pattuito,
          incassato,
          residuo,
          costiFornitore,
          costoPosa,
          margineLordo,
          marginePerc: pattuito > 0 ? margineLordo / pattuito : null,
          commesseAttive: commesse.filter((c: any) => !c.archivedAt).length,
          commesseConPattuito,
        },
        fic: {
          disponibile: fattureAnno.length > 0,
          fatture: fattureAnno.filter((f) => !f.ignorata).length,
          fatturato,
          incassato: incassatoFic,
          daIncassare: daIncassareFic,
          daRiconciliare,
        },
        // Andamento per mese: fatturato (FIC), incassi e costi (CRM).
        mesi: Array.from({ length: 12 }, (_, i) => ({
          mese: i + 1,
          fatturato: fatturatoMese[i],
          incassi: incassiMese[i],
          costi: costiMese[i],
        })),
      };
    }),
});
