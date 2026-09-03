import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";
import { getClienteById } from "./clienti";
import { getCommessaById } from "./commesse";
import { assertSedeScope, isDirezione } from "../_core/permissions";
import { authorizeCoreOperation } from "../authz/enforcement";
import {
  TIPI_INTERVENTO,
  esecutorePerTipo,
  titoloDaNotaImportata,
} from "@shared/interventi";
import {
  chiaveRicerca,
  numeroCorrisponde,
  testoCorrisponde,
} from "../_core/ricerca";
import { getClientiStore } from "./clienti";
import { getSquadreStore } from "./squadre";
import { getUtentiStore } from "./utenti";
import { getCommesseStore } from "./commesse";

/** Etichette leggibili dei tipi: chi cerca «ferie» deve trovarle. */
const CALENDARI_LABEL: Record<string, string> = {
  rilievo: "Rilievo",
  posa: "Posa",
  assistenza: "Interventi Regolazioni",
  consegna: "Consegna",
  appuntamento: "Appuntamento",
  riunione: "Riunione",
  ferie: "Ferie assenze",
  altro: "Altro",
};

/** Giorni fra due date `YYYY-MM-DD`; senza data, in fondo all'elenco. */
function distanzaGiorni(data: string | null | undefined, oggi: string): number {
  if (!data) return 10_000;
  const a = Date.parse(`${data}T12:00:00Z`);
  const b = Date.parse(`${oggi}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 10_000;
  return Math.abs(Math.round((a - b) / 86_400_000));
}

let nextId = 1;
const _interventiStore = persistedStore<any>("interventi", (loaded) => {
  // One-shot cleanup: hard-delete any legacy "annullato" records so they
  // no longer appear in the calendar. Mutates the loaded array in place,
  // then schedules a save so the DB reflects the pruned state.
  const before = loaded.length;
  for (let i = loaded.length - 1; i >= 0; i--) {
    if (loaded[i]?.stato === "annullato") loaded.splice(i, 1);
  }
  const removed = before - loaded.length;
  if (removed > 0) {
    console.log(`[interventi] pruned ${removed} legacy annullato record(s) on load`);
    // Defer save until after bootstrap so ensureSchema has completed.
    setTimeout(() => _interventiStore.save(), 0);
  }
  // Backfill sede scope → default sede (id 1) for pre-multi-sede records.
  for (const i of loaded) {
    if ((i as any).sedeId === undefined) (i as any).sedeId = 1;
    // Chi esegue un rilievo è una persona, non una squadra di posa: il campo
    // nasce vuoto sui record già esistenti e si riempie quando qualcuno li
    // riapre. Nessuna riscrittura all'avvio: un rilievo storico senza tecnico
    // resta senza tecnico, che è la verità.
    if ((i as any).tecnicoId === undefined) (i as any).tecnicoId = null;
    // Gli eventi arrivati dalla migrazione Google hanno il titolo vero
    // sepolto in fondo alla nota, dopo sessanta caratteri di provenienza
    // uguali per tutti. Il calendario mostrava quelli, quindi ogni blocco
    // diceva la stessa frase. Il titolo si estrae una volta e diventa un
    // campo suo; la nota resta intatta, è la traccia di dove viene.
    if ((i as any).titolo === undefined) {
      (i as any).titolo = titoloDaNotaImportata((i as any).note) ?? null;
    }
  }
  nextId = loaded.length ? Math.max(...loaded.map((x: any) => x.id)) + 1 : 1;
});
const interventi = _interventiStore.items;

// Exposed for the ICS calendar feed (server/routers/calendarSync.ts).
export function getInterventiStore() {
  return interventi;
}

// I tipi di evento e le regole su chi li esegue vivono in `shared/`: le usa
// anche la Dashboard per decidere cosa è davvero scoperto, e due copie
// vorrebbero dire un elenco che segnala lavoro già assegnato.
export {
  TIPI_INTERVENTO,
  TIPI_CON_ESECUTORE,
  esecutorePerTipo,
  senzaEsecutore,
  titoloDaNotaImportata,
} from "@shared/interventi";
export type { TipoIntervento } from "@shared/interventi";

export const interventiRouter = router({
  list: protectedProcedure
    .input(z.object({
      commessaId: z.number().optional(),
      stato: z.string().optional(),
      tipo: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
    }).optional())
    .query(({ input, ctx }) => {
      let result = interventi.filter((i) => i.sedeId === ctx.sedeId);
      if (input?.commessaId) result = result.filter((i) => i.commessaId === input.commessaId);
      if (input?.stato) result = result.filter((i) => i.stato === input.stato);
      if (input?.tipo) result = result.filter((i) => i.tipo === input.tipo);
      if (input?.from) result = result.filter((i) => i.dataPianificata >= input.from!);
      if (input?.to) result = result.filter((i) => i.dataPianificata <= input.to!);
      return result.sort((a, b) => (a.dataPianificata ?? "").localeCompare(b.dataPianificata ?? ""));
    }),

  byId: protectedProcedure.input(z.number()).query(({ input, ctx }) => {
    const i = interventi.find((i) => i.id === input);
    if (!i || i.sedeId !== ctx.sedeId) return null;
    return i;
  }),

  /**
   * Cerca un appuntamento in tutto il calendario, non solo nel periodo
   * mostrato.
   *
   * Filtrare il mese aperto sarebbe inutile: si cerca proprio quello che non
   * si vede. Quindi la ricerca ignora le date e le restituisce, così chi
   * trova sa dove andare.
   *
   * Stesse regole di clienti e commesse (`_core/ricerca`): senza accenti da
   * entrambi i lati, e i numeri confrontati per sole cifre — «forli» trova
   * «Forlì», «3401234567» trova «+39 340 1234567».
   */
  cerca: protectedProcedure
    .input(
      z.object({
        q: z.string().min(1).max(200),
        limite: z.number().int().min(1).max(50).optional(),
      })
    )
    .query(({ input, ctx }) => {
      const chiave = chiaveRicerca(input.q);
      if (!chiave) return [];
      const limite = input.limite ?? 25;
      const oggi = new Date().toISOString().slice(0, 10);
      const commesse = new Map<number, any>(
        (getCommesseStore() as any[])
          .filter(c => c.sedeId === ctx.sedeId)
          .map(c => [c.id, c])
      );
      const clienti = new Map<number, any>(
        (getClientiStore() as any[]).map(c => [c.id, c])
      );
      const squadre = new Map<number, any>(
        (getSquadreStore() as any[]).map(s => [s.id, s])
      );
      const utenti = new Map<number, any>(
        (getUtentiStore() as any[]).map(u => [u.id, u])
      );

      const trovati = interventi
        .filter(i => i.sedeId === ctx.sedeId && i.stato !== "annullato")
        .map(i => {
          const commessa = i.commessaId ? commesse.get(i.commessaId) : null;
          const cliente = commessa?.clienteId
            ? clienti.get(commessa.clienteId)
            : null;
          const squadra = i.squadraId ? squadre.get(i.squadraId) : null;
          const tecnico = i.tecnicoId ? utenti.get(i.tecnicoId) : null;
          const nomeCliente = cliente
            ? `${cliente.cognome ?? ""} ${cliente.nome ?? ""}`.trim()
            : (commessa?.cliente ?? "");
          const esecutore = tecnico
            ? `${tecnico.cognome ?? ""} ${tecnico.nome ?? ""}`.trim()
            : squadra
              ? `${squadra.nome}${squadra.caposquadra ? ` — ${squadra.caposquadra}` : ""}`
              : null;
          return { i, commessa, cliente, nomeCliente, esecutore };
        })
        .filter(({ i, commessa, cliente, nomeCliente, esecutore }) => {
          // Tutto quello che una persona ricorda di un appuntamento: chi,
          // dove, che lavoro, quale commessa, chi ci va, e la nota.
          const testi = [
            nomeCliente,
            // Anche l'ordine inverso: chi cerca digita «Mario Rossi» tanto
            // quanto «Rossi Mario».
            cliente ? `${cliente.nome ?? ""} ${cliente.cognome ?? ""}`.trim() : null,
            i.titolo,
            i.note,
            i.indirizzo,
            commessa?.indirizzo,
            commessa?.citta,
            commessa?.codice,
            esecutore,
            i.tipo,
            CALENDARI_LABEL[i.tipo],
          ];
          if (testoCorrisponde(testi, chiave)) return true;
          return numeroCorrisponde(
            [cliente?.telefono, commessa?.telefono],
            chiave
          );
        })
        // I più vicini a oggi per primi: si cerca quasi sempre qualcosa di
        // imminente, non un lavoro di due anni fa. `oggi` si calcola una
        // volta, non a ogni confronto.
        .sort((a, b) => {
          const da = distanzaGiorni(a.i.dataPianificata, oggi);
          const db = distanzaGiorni(b.i.dataPianificata, oggi);
          if (da !== db) return da - db;
          return (a.i.oraInizio ?? "").localeCompare(b.i.oraInizio ?? "");
        })
        .slice(0, limite);

      return trovati.map(({ i, commessa, nomeCliente, esecutore }) => ({
        id: i.id,
        data: i.dataPianificata ?? null,
        oraInizio: i.oraInizio ?? null,
        oraFine: i.oraFine ?? null,
        tipo: i.tipo,
        titolo: nomeCliente || i.titolo || null,
        commessaCodice: commessa?.codice ?? null,
        indirizzo: i.indirizzo || commessa?.indirizzo || null,
        esecutore,
      }));
    }),

  create: protectedProcedure
    .input(z.object({
      commessaId: z.number().nullable().optional(),
      // «Collega a → Cliente» (03/09 sera): appuntamento con un cliente
      // senza commessa (showroom, primo contatto). Con tutti i link null
      // l'evento è libero (ferie, riunioni).
      clienteId: z.number().nullable().optional(),
      squadraId: z.number().nullable().optional(),
      /** Chi fa il rilievo: un utente con ruolo `tecnico_rilievi`. */
      tecnicoId: z.number().nullable().optional(),
      /** Nome dell'appuntamento quando non c'è un cliente a dargliene uno. */
      titolo: z.string().max(200).nullable().optional(),
      tipo: z.enum(TIPI_INTERVENTO),
      dataPianificata: z.string().optional(),
      oraInizio: z.string().nullable().optional(), // "HH:MM"
      oraFine: z.string().nullable().optional(),   // "HH:MM"
      indirizzo: z.string().optional(),
      note: z.string().optional(),
      ticketId: z.number().nullable().optional(),
      reclamoId: z.number().nullable().optional(),
      rifacimentoId: z.number().nullable().optional(),
      // Migrazione calendario (T4/D2): chiave dell'evento esterno di
      // origine (`google:<sorgente>:<uid>:<data>`) — la dedupe del
      // reimport vive su questo campo.
      origineEsterna: z.string().max(200).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await authorizeCoreOperation({
        ctx,
        endpoint: "interventi.create",
        capability: "intervento.plan",
        resourceType: "intervento",
      });
      if (input.squadraId !== undefined || input.tecnicoId !== undefined) {
        await authorizeCoreOperation({
          ctx,
          endpoint: "interventi.assign",
          capability: "intervento.assign",
          resourceType: "intervento",
        });
      }
      if (input.commessaId != null) {
        assertSedeScope(getCommessaById(input.commessaId), ctx.sedeId);
      }
      if (input.clienteId != null) {
        assertSedeScope(getClienteById(input.clienteId) as any, ctx.sedeId);
      }
      const now = new Date();
      const esecutore = esecutorePerTipo(input);
      const intervento = {
        id: nextId++,
        ...input,
        sedeId: ctx.sedeId ?? 1,
        commessaId: input.commessaId ?? null,
        clienteId: input.clienteId ?? null,
        squadraId: esecutore.squadraId,
        tecnicoId: esecutore.tecnicoId,
        // Se non lo passa chi crea, si prova a ricavarlo dalla nota: è il
        // caso della migrazione, che la nota la scrive in quella forma.
        titolo:
          (input.titolo?.trim() || titoloDaNotaImportata(input.note)) ?? null,
        ticketId: input.ticketId ?? null,
        reclamoId: input.reclamoId ?? null,
        rifacimentoId: input.rifacimentoId ?? null,
        origineEsterna: input.origineEsterna ?? null,
        oraInizio: input.oraInizio ?? null,
        oraFine: input.oraFine ?? null,
        stato: "pianificato" as const,
        dataInizio: null,
        dataFine: null,
        createdBy: ctx.user?.id ?? null,
        createdAt: now,
        updatedAt: now,
      };
      interventi.push(intervento);
      _interventiStore.save();
      return intervento;
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      commessaId: z.number().nullable().optional(),
      clienteId: z.number().nullable().optional(),
      squadraId: z.number().nullable().optional(),
      /** Chi fa il rilievo: un utente con ruolo `tecnico_rilievi`. */
      tecnicoId: z.number().nullable().optional(),
      /** Nome dell'appuntamento quando non c'è un cliente a dargliene uno. */
      titolo: z.string().max(200).nullable().optional(),
      tipo: z.enum(TIPI_INTERVENTO).optional(),
      dataPianificata: z.string().optional(),
      oraInizio: z.string().nullable().optional(),
      oraFine: z.string().nullable().optional(),
      indirizzo: z.string().optional(),
      note: z.string().optional(),
      ticketId: z.number().nullable().optional(),
      reclamoId: z.number().nullable().optional(),
      rifacimentoId: z.number().nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const idx = interventi.findIndex((i) => i.id === input.id);
      if (idx === -1) throw new Error("Intervento non trovato");
      assertSedeScope(interventi[idx], ctx.sedeId);
      const parent = interventi[idx].commessaId == null
        ? null
        : getCommessaById(interventi[idx].commessaId);
      const policyResource = {
        ...interventi[idx],
        createdBy: interventi[idx].createdBy ?? parent?.createdBy ?? null,
        assegnatoA: parent?.assegnatoA ?? null,
      };
      await authorizeCoreOperation({
        ctx,
        endpoint: "interventi.update",
        capability: "intervento.plan",
        resourceType: "intervento",
        resource: policyResource,
      });
      if (input.squadraId !== undefined || input.tecnicoId !== undefined) {
        await authorizeCoreOperation({
          ctx,
          endpoint: "interventi.assign",
          capability: "intervento.assign",
          resourceType: "intervento",
          resource: policyResource,
        });
      }
      if (input.commessaId != null) {
        assertSedeScope(getCommessaById(input.commessaId), ctx.sedeId);
      }
      if (input.clienteId != null) {
        assertSedeScope(getClienteById(input.clienteId) as any, ctx.sedeId);
      }
      const { id, ...updates } = input;
      const unito = { ...interventi[idx], ...updates };
      // Il tipo può cambiare in questa stessa chiamata: l'esecutore si decide
      // sul tipo risultante, non su quello di prima. Una posa che diventa
      // rilievo lascia andare la squadra, che quel lavoro non lo farà.
      interventi[idx] = {
        ...unito,
        ...esecutorePerTipo(unito),
        updatedAt: new Date(),
      };
      _interventiStore.save();
      return interventi[idx];
    }),

  delete: protectedProcedure
    .input(z.number())
    .mutation(async ({ input, ctx }) => {
      const idx = interventi.findIndex((i) => i.id === input);
      if (idx === -1) throw new Error("Intervento non trovato");
      assertSedeScope(interventi[idx], ctx.sedeId);
      const parent = interventi[idx].commessaId == null
        ? null
        : getCommessaById(interventi[idx].commessaId);
      const uid = ctx.user?.id ?? null;
      await authorizeCoreOperation({
        ctx,
        endpoint: "interventi.delete",
        capability: "intervento.delete",
        resourceType: "intervento",
        resource: {
          ...interventi[idx],
          createdBy: interventi[idx].createdBy ?? parent?.createdBy ?? null,
          assegnatoA: parent?.assegnatoA ?? null,
        },
        legacyAllowed:
          parent == null ||
          isDirezione(ctx.user) ||
          (uid != null && (parent.createdBy === uid || parent.assegnatoA === uid)),
      });
      interventi.splice(idx, 1);
      _interventiStore.save();
      return { success: true };
    }),

  updateStato: protectedProcedure
    .input(z.object({
      id: z.number(),
      // "annullato" intentionally NOT in the enum: cancellations go through
      // the hard `delete` endpoint. Legacy `annullato` rows are purged on
      // load (see _interventiStore.onLoad above) and the UI hides them.
      stato: z.enum(["pianificato", "in_corso", "completato", "sospeso"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const idx = interventi.findIndex((i) => i.id === input.id);
      if (idx === -1) throw new Error("Intervento non trovato");
      assertSedeScope(interventi[idx], ctx.sedeId);
      const parent = interventi[idx].commessaId == null
        ? null
        : getCommessaById(interventi[idx].commessaId);
      await authorizeCoreOperation({
        ctx,
        endpoint: "interventi.updateState",
        capability: "intervento.plan",
        resourceType: "intervento",
        resource: {
          ...interventi[idx],
          createdBy: interventi[idx].createdBy ?? parent?.createdBy ?? null,
          assegnatoA: parent?.assegnatoA ?? null,
        },
      });
      interventi[idx].stato = input.stato;
      if (input.stato === "in_corso") interventi[idx].dataInizio = new Date();
      if (input.stato === "completato") interventi[idx].dataFine = new Date();
      interventi[idx].updatedAt = new Date();
      _interventiStore.save();
      return interventi[idx];
    }),
});
