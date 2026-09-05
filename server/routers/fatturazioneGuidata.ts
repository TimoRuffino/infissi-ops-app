// server/routers/fatturazioneGuidata.ts
// Punto di ingresso guidato alla fatturazione (piano 4): l'elenco delle
// commesse da fatturare, con lo stato dei quattro passi e gli importi
// (`daFare`), e lo stesso record per una singola commessa (`passi`) — usato
// sia dalla pagina a passi sia dalle tab Contratto/Limiti/Fattura in sola
// lettura della pagina commessa. Nessuna mutation qui: i passi si lavorano
// con le procedure già esistenti (contratti, computo, fatture) — v.
// CLAUDE.md, «Agente AI» (l'automatismo che decide gli stati resta nei
// servizi di dominio, mai reimplementato dal router).
//
// Specifica: docs/superpowers/specs/2026-09-05-fatturazione-guidata-design.md
// §4 (modello), §5 (server), §7 (permessi, sede, flag).
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { Contratto } from "@shared/limiti/tipi";
import type { Computo } from "@shared/limiti/tipi";
import type { Fattura, StatoFattura } from "@shared/fatturazione/tipi";
import type { CommessaDaFatturare, StatoDaFatturare } from "@shared/fatturazione/passi";
import { calcolaPassi, STATI_FATTURA_EMESSA, type IngressoPassi } from "../fatturazione/passi";
import { procedureConInterruttore, router } from "../_core/trpc";
import { authorizeCoreOperation, effectiveCapabilitySet } from "../authz/enforcement";
import { interruttoreAttivo } from "../platform/interruttori";
import { istanteComeLocale } from "../tars/tempo";
import { getCommessaById, getCommesseStore } from "./commesse";
import { getDocumentiDiCommessa, type Documento } from "./preventiviContratti";
import { stepsDiCommessa } from "./timeline";
import { leggiContratto } from "../contratti/servizio";
import { ultimoComputo } from "../computo/servizio";
import { fatturePerCommessa } from "../fatture/servizio";
import { ficFatture } from "./ficFatture";
import { DEFAULT_SEDE_ID } from "./sedi";

const procedura = procedureConInterruttore("limiti");

/** Gli unici due stati della commessa che compaiono nell'elenco (§2, §4.1). */
const STATI_DA_FATTURARE: ReadonlySet<StatoDaFatturare> = new Set([
  "aggiornamento_contratto",
  "fatture_pagamento",
]);

function sedeCorrente(ctx: { sedeId: number | null }): number {
  return ctx.sedeId ?? DEFAULT_SEDE_ID;
}

function commessaInSede(commessaId: number, sedeId: number): any {
  const commessa: any = getCommessaById(commessaId);
  if (!commessa || (commessa.sedeId ?? DEFAULT_SEDE_ID) !== sedeId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Commessa non trovata." });
  }
  return commessa;
}

/** Da euro (`commessa.importoTotale`) a centesimi: riserva del pattuito senza contratto strutturato (§4.3). */
function centDaEuro(euro: number | null | undefined): number | null {
  return euro == null ? null : Math.round(euro * 100);
}

/**
 * Da quando la commessa è nello stato attuale. `stepsDiCommessa` non
 * espone a quale StatoCommessa corrisponde ciascuna milestone (la mappa
 * `STATO_PER_MILESTONE` è privata di timeline.ts): si usa qui lo stesso
 * proxy già affidabile altrove nel dominio (`commesse/attivita.ts`), la
 * `dataCompletamento` più recente tra gli step completati. Nel percorso
 * ordinario (avanzamento in sequenza, mai retrocesso senza riaprire gli
 * step) coincide con l'ingresso nello stato corrente; senza nessuno step
 * completato resta `updatedAt` della commessa.
 */
function statoDalDiCommessa(commessa: { id: number; updatedAt: unknown }): string | null {
  let piuRecente: string | null = null;
  for (const step of stepsDiCommessa(commessa.id)) {
    if (step.stato !== "completato" || !step.dataCompletamento) continue;
    if (piuRecente == null || step.dataCompletamento > piuRecente) {
      piuRecente = step.dataCompletamento;
    }
  }
  if (piuRecente) return piuRecente;
  const updatedAt = commessa.updatedAt;
  // Ruling P4-R4: niente più `toISOString()` grezzo (il giorno UTC
  // dell'istante) — si riduce subito al giorno di calendario Europe/Rome,
  // la stessa unità già usata dal ramo `piuRecente` sopra e da `giorniTra`.
  if (updatedAt instanceof Date) return istanteComeLocale(updatedAt).slice(0, 10);
  return typeof updatedAt === "string" ? updatedAt : null;
}

/**
 * Giorni di calendario interi (Europe/Rome) tra `dataIso` e `adesso`.
 *
 * Ruling P4-R4: entrambi i lati passano da `istanteComeLocale` prima dello
 * `.slice(0,10)`. Prima, `dataIso` veniva tagliato grezzo (giorno UTC)
 * mentre `adesso` passava già da `istanteComeLocale` (giorno Roma): tra le
 * 22 e le 24 UTC i due giorni divergono di uno (a Roma è già il giorno
 * dopo) e il conteggio sballava di ±1. `dataIso` può essere una data pura
 * `YYYY-MM-DD` (dagli step di timeline) o un istante ISO completo (dal
 * fallback `updatedAt`, ora anch'esso ridotto a un giorno più sopra): in
 * entrambi i casi `new Date(...)` lo ancora a mezzanotte UTC o all'istante
 * esatto, e uno spostamento di sole 1-2 ore verso Roma non attraversa mai
 * la mezzanotte di un'altra volta.
 */
function giorniTra(dataIso: string, adesso: Date): number {
  const epoca = (yyyyMmDd: string) => Date.parse(`${yyyyMmDd}T00:00:00Z`);
  const giorno = istanteComeLocale(new Date(dataIso)).slice(0, 10);
  const oggi = istanteComeLocale(adesso).slice(0, 10);
  return Math.round((epoca(oggi) - epoca(giorno)) / 86_400_000);
}

type StatoComputo = { computo: Computo | null; valido: boolean; motivo: string | null };

type DatiCommessa = {
  commessa: any;
  documenti: Documento[];
  contratto: Contratto | null;
  righeContratto: number;
  statoComputo: StatoComputo;
  /** Ordinate dalla più vecchia: `calcolaPassi` legge l'ultima non annullata come stato corrente (Ruling P4-R2). */
  fatture: Fattura[];
};

/**
 * Tutto ciò che serve per una commessa in un solo giro: una lettura per
 * store (contratto, computo, fatture), mai una per l'altra dentro un
 * ciclo. `getDocumentiDiCommessa` è sincrona: resta fuori dal Promise.all.
 */
async function leggiDatiCommessa(sedeId: number, commessa: any): Promise<DatiCommessa> {
  const documenti = getDocumentiDiCommessa(commessa.id);
  const [{ contratto, righe }, statoComputo, fattureGrezze] = await Promise.all([
    leggiContratto(sedeId, commessa.id),
    ultimoComputo(sedeId, commessa.id),
    fatturePerCommessa(sedeId, commessa.id),
  ]);
  return {
    commessa,
    documenti,
    contratto,
    righeContratto: righe.length,
    statoComputo,
    fatture: [...fattureGrezze].sort((a, b) => a.id - b.id),
  };
}

/** §4.2: una fattura CRM di tipo `fattura` arrivata a uno stato "emessa o successivo" toglie la commessa dall'elenco. */
function haFatturaCrmEmessa(dati: Pick<DatiCommessa, "fatture">): boolean {
  return dati.fatture.some((f) => f.tipo === "fattura" && STATI_FATTURA_EMESSA.has(f.stato));
}

/** §4.2: una fattura FiC collegata (di qualunque stato) toglie la commessa dall'elenco. */
function haFatturaFicCollegata(sedeId: number, commessaId: number): boolean {
  return ficFatture.some((f) => f.sedeId === sedeId && f.commessaId === commessaId);
}

/** Lo stesso record per l'elenco e per la pagina a passi di una commessa (§5). */
function costruisciRecord(
  dati: DatiCommessa,
  mostraImporti: boolean,
  adesso: Date
): CommessaDaFatturare {
  const { commessa, documenti, contratto, righeContratto, statoComputo, fatture } = dati;

  const ingresso: IngressoPassi = {
    documenti: documenti.map((d) => ({ tipo: d.tipo, mimeType: d.mimeType })),
    contratto: contratto
      ? { righe: righeContratto, pattuitoCent: contratto.pattuitoCent, pattuitoTipo: contratto.pattuitoTipo }
      : null,
    computo: statoComputo.computo
      ? { valido: statoComputo.valido, esito: statoComputo.computo.esito }
      : null,
    fatture: fatture.map((f) => ({ stato: f.stato, totaleCent: f.totaleCent, tipo: f.tipo })),
    flag: {
      limiti: interruttoreAttivo("limiti"),
      fatturazione: interruttoreAttivo("fatturazione"),
    },
  };
  const risultato = calcolaPassi(ingresso);
  const statoDal = statoDalDiCommessa(commessa);

  return {
    commessaId: commessa.id,
    codice: commessa.codice,
    cliente: commessa.cliente,
    stato: commessa.stato,
    statoDal,
    giorniNelloStato: statoDal != null ? giorniTra(statoDal, adesso) : null,
    documenti: {
      totale: documenti.length,
      contratti: documenti.filter((d) => d.tipo === "contratto").length,
    },
    passi: risultato.passi,
    prossimoPasso: risultato.prossimoPasso,
    pattuitoCent: mostraImporti ? contratto?.pattuitoCent ?? centDaEuro(commessa.importoTotale) : null,
    pattuitoTipo: mostraImporti ? contratto?.pattuitoTipo ?? null : null,
    fatturaPrevistaCent: mostraImporti ? risultato.fatturaPrevistaCent : null,
    fatturaPrevistaStima: risultato.fatturaPrevistaStima,
    // `calcolaPassi` resta agnostico dei tipi di @shared/fatturazione/tipi
    // (nessuno store, nessun import di dominio): qui si restringe di nuovo
    // al contratto pubblico dell'API.
    fatturaStato: risultato.fatturaStato as StatoFattura | null,
  };
}

export const fatturazioneGuidataRouter = router({
  daFare: procedura.query(async ({ ctx }): Promise<CommessaDaFatturare[]> => {
    const sedeId = sedeCorrente(ctx);
    await authorizeCoreOperation({
      ctx,
      endpoint: "fatturazioneGuidata.daFare",
      capability: "contratto.read",
      resourceType: "commessa",
      resource: { sedeId },
      legacyAllowed: "capability",
    });
    const caps = await effectiveCapabilitySet(ctx, ["economia.read"]);
    const mostraImporti = caps.has("economia.read");

    // Filtro grezzo (sede, stato, fattura FiC) prima di leggere: sono poche
    // decine di commesse, e da qui in poi una sola lettura per store,
    // mai un giro nidificato sulle fatture di ognuna.
    const candidate = getCommesseStore().filter(
      (c: any) =>
        (c.sedeId ?? DEFAULT_SEDE_ID) === sedeId &&
        STATI_DA_FATTURARE.has(c.stato) &&
        !haFatturaFicCollegata(sedeId, c.id)
    );

    const dati = await Promise.all(candidate.map((c: any) => leggiDatiCommessa(sedeId, c)));
    const senzaFatturaEmessa = dati.filter((d) => !haFatturaCrmEmessa(d));

    const adesso = new Date();
    const elenco = senzaFatturaEmessa.map((d) => costruisciRecord(d, mostraImporti, adesso));

    return elenco.sort((a, b) => {
      const perGiorni = (b.giorniNelloStato ?? 0) - (a.giorniNelloStato ?? 0);
      return perGiorni !== 0 ? perGiorni : a.codice.localeCompare(b.codice);
    });
  }),

  passi: procedura
    .input(z.object({ commessaId: z.number().int() }))
    .query(async ({ input, ctx }): Promise<CommessaDaFatturare> => {
      const sedeId = sedeCorrente(ctx);
      const commessa = commessaInSede(input.commessaId, sedeId);
      await authorizeCoreOperation({
        ctx,
        endpoint: "fatturazioneGuidata.passi",
        capability: "contratto.read",
        resourceType: "commessa",
        resource: { sedeId },
        legacyAllowed: "capability",
      });
      const caps = await effectiveCapabilitySet(ctx, ["economia.read"]);
      const dati = await leggiDatiCommessa(sedeId, commessa);
      return costruisciRecord(dati, caps.has("economia.read"), new Date());
    }),
});
