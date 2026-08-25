import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  addCommessaToCliente,
  getClienteById,
  removeCommessaFromCliente,
} from "./clienti";
import { getUtentiStore } from "./utenti";
import {
  requireOwnershipOrDirezione,
  assertSedeScope,
  requireDirezione,
  requireDirezioneOAmministrazione,
} from "../_core/permissions";
import { calcolaMargine } from "../_core/margine";
import { getOrdiniPerMargine } from "./fornitori";
import {
  hasPreventivoOrContratto,
  statoHasRequiredDoc,
  REQUIRED_DOC_TIPI_PER_STATO,
  DOC_TIPO_LABEL,
} from "./preventiviContratti";
import { persistedStore } from "../_core/persistence";
import { publishAssignmentEvent } from "../events/publish";

// Tipologie di lavorazione che una commessa può comprendere. Elenco chiuso
// per poter raggruppare e filtrare; "Altro" resta come valvola di sfogo.
export const TIPOLOGIE_PRODOTTO = [
  "Infissi",
  "Porte interne",
  "Portoncino / Blindato",
  "Zanzariere",
  "Persiane",
  "Avvolgibili / Tapparelle",
  "Cassonetti",
  "Controtelai",
  "Tende da sole",
  "Veneziane",
  "Grate",
  "Vetri",
  "Scale",
  "Altro",
] as const;

// ── State machine: allowed transitions ──────────────────────────────────────
export const STATI_COMMESSA = [
  "preventivo",
  "misure_esecutive",
  "aggiornamento_contratto",
  "fatture_pagamento",
  "da_ordinare",
  "produzione",
  "ordini_ultimazione",
  "attesa_posa",
  "finiture_saldo",
  "interventi_regolazioni",
  "archiviata",
] as const;
type StatoCommessa = typeof STATI_COMMESSA[number];

// Forward + backward (prev step) transitions allowed
const TRANSIZIONI_VALIDE: Record<StatoCommessa, StatoCommessa[]> = {
  preventivo:              ["misure_esecutive"],
  misure_esecutive:        ["preventivo", "aggiornamento_contratto"],
  aggiornamento_contratto: ["misure_esecutive", "fatture_pagamento"],
  fatture_pagamento:       ["aggiornamento_contratto", "da_ordinare"],
  da_ordinare:             ["fatture_pagamento", "produzione"],
  produzione:              ["da_ordinare", "ordini_ultimazione"],
  ordini_ultimazione:      ["produzione", "attesa_posa"],
  attesa_posa:             ["ordini_ultimazione", "finiture_saldo"],
  finiture_saldo:          ["attesa_posa", "interventi_regolazioni"],
  interventi_regolazioni:  ["finiture_saldo", "archiviata"],
  archiviata:              ["interventi_regolazioni"],
};

function validateTransizione(statoAttuale: string, nuovoStato: string): void {
  const allowed = TRANSIZIONI_VALIDE[statoAttuale as StatoCommessa];
  if (!allowed || !allowed.includes(nuovoStato as StatoCommessa)) {
    throw new Error(
      `Transizione non consentita: ${statoAttuale} → ${nuovoStato}. ` +
      `Transizioni valide da "${statoAttuale}": ${allowed?.join(", ") ?? "nessuna"}`
    );
  }
}

let nextId = 1;

// Per-commessa monotonic prodotto id counter (lives in memory; ids are unique
// within a single commessa.prodotti array, which is all we need).
function nextProdottoId(commessa: any): number {
  const current: any[] = Array.isArray(commessa.prodotti) ? commessa.prodotti : [];
  return current.length ? Math.max(...current.map((p) => p.id ?? 0)) + 1 : 1;
}

const _store = persistedStore<any>("commesse", (items) => {
  nextId = items.length ? Math.max(...items.map((x: any) => x.id)) + 1 : 1;
  for (const c of items) {
    // Backfill prodotti[] so the field is always an array.
    if (!Array.isArray((c as any).prodotti)) (c as any).prodotti = [];
    // Backfill assegnatoA on legacy records — falls back to createdBy if set.
    if ((c as any).assegnatoA === undefined) {
      (c as any).assegnatoA = (c as any).createdBy ?? null;
    }
    // Soft-archive flag. ISO date string (YYYY-MM-DDTHH:mm:ss.sssZ) when set.
    // Orthogonal to `stato`: archiving does NOT change stato so board position
    // and progress are preserved on restore.
    if ((c as any).archivedAt === undefined) {
      (c as any).archivedAt = null;
    }
    // Backfill sede scope → default sede (id 1) for pre-multi-sede records.
    if ((c as any).sedeId === undefined) (c as any).sedeId = 1;
    // Payment tracker fields (saldi).
    if ((c as any).importoTotale === undefined) (c as any).importoTotale = null;
    // Margine (P0.2): manual estimate of the posa cost, € — direzione-only.
    if ((c as any).costoPosaStimato === undefined) (c as any).costoPosaStimato = null;
    // Registro costi fornitore — inserito direttamente in scheda commessa.
    if (!Array.isArray((c as any).costi)) (c as any).costi = [];
    if ((c as any).importoIncassato === undefined) (c as any).importoIncassato = 0;
    // Acconti register — importoIncassato is derived from it. Legacy records
    // with a bare incassato figure get a single imported entry.
    if (!Array.isArray((c as any).pagamenti)) (c as any).pagamenti = [];
    if (((c as any).importoIncassato ?? 0) > 0 && (c as any).pagamenti.length === 0) {
      (c as any).pagamenti = [
        {
          id: 1,
          importo: (c as any).importoIncassato,
          data: null,
          metodo: null,
          note: "Importo importato",
          createdAt: (c as any).updatedAt ?? new Date(),
        },
      ];
    }
  }
});
const commesse = _store.items;

// Auto-generate codice: COM-YYYY-NNN (zero-padded, sequential per year)
function generaCodiceCommessa(): string {
  const year = new Date().getFullYear();
  const yearCodes = commesse
    .filter((c) => typeof c.codice === "string" && c.codice.startsWith(`COM-${year}-`))
    .map((c) => parseInt(c.codice.split("-")[2] ?? "0", 10))
    .filter((n) => !isNaN(n));
  const next = (yearCodes.length ? Math.max(...yearCodes) : 0) + 1;
  return `COM-${year}-${String(next).padStart(3, "0")}`;
}

export function getCommesseStore() {
  return commesse;
}

export function getCommessaById(id: number) {
  return commesse.find((c) => c.id === id) ?? null;
}

// Cascade archive/restore: when a cliente is (un)archived, its commesse follow.
// Returns the count of commesse touched. Used by clienti.archive/restore.
export function setCommesseArchivedByCliente(
  clienteId: number,
  archived: boolean
): number {
  const now = new Date();
  let touched = 0;
  for (const c of commesse) {
    if (c.clienteId !== clienteId) continue;
    const target = archived ? now.toISOString() : null;
    if ((c.archivedAt ?? null) === target) continue;
    // When restoring, only un-archive commesse that were archived together
    // with the cliente (heuristic: any archived one) — simplest is to clear.
    c.archivedAt = target;
    c.updatedAt = now;
    touched++;
  }
  if (touched > 0) _store.save();
  return touched;
}

// Called by clienti.update so the denormalized `cliente` display string on
// every commessa pointing at this clienteId stays in sync with the canonical
// nome/cognome on the cliente record. Also refreshes per-commessa copies of
// telefono/email/indirizzo/citta WHEN they still match the previous cliente
// value — that way commesse that explicitly overrode those fields (e.g. a
// cantiere address different from the home address) keep their override.
export function syncClienteOnCommesse(
  clienteId: number,
  updatedCliente: {
    nome?: string;
    cognome?: string;
    telefono?: string | null;
    email?: string | null;
    indirizzo?: string | null;
    citta?: string | null;
  },
  previousCliente: {
    nome?: string;
    cognome?: string;
    telefono?: string | null;
    email?: string | null;
    indirizzo?: string | null;
    citta?: string | null;
  }
): number {
  let touched = 0;
  // Display name convention is "Cognome Nome" (global, §naming).
  const prevDisplay = `${previousCliente.cognome ?? ""} ${previousCliente.nome ?? ""}`.trim();
  const newDisplay = `${
    updatedCliente.cognome ?? previousCliente.cognome ?? ""
  } ${updatedCliente.nome ?? previousCliente.nome ?? ""}`.trim();

  for (const c of commesse) {
    if (c.clienteId !== clienteId) continue;
    let changed = false;

    // Always refresh the display name — it's derived from cliente and should
    // never drift.
    if (c.cliente !== newDisplay) {
      c.cliente = newDisplay;
      changed = true;
    }

    // For per-commessa contact fields, only overwrite if the commessa still
    // carries the exact previous cliente value (i.e. user never overrode).
    // This preserves legitimate cantiere-vs-home differences.
    const maybeSync = (
      field: "telefono" | "email" | "indirizzo" | "citta"
    ) => {
      if (updatedCliente[field] === undefined) return;
      const prev = previousCliente[field] ?? null;
      const next = updatedCliente[field] ?? null;
      if ((c as any)[field] === prev && prev !== next) {
        (c as any)[field] = next;
        changed = true;
      }
    };
    maybeSync("telefono");
    maybeSync("email");
    maybeSync("indirizzo");
    maybeSync("citta");

    if (changed) {
      c.updatedAt = new Date();
      touched++;
    }

    // Suppress unused warning when nothing changed but display also unchanged.
    void prevDisplay;
  }
  if (touched > 0) _store.save();
  return touched;
}

export const commesseRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        stato: z.string().optional(),
        search: z.string().optional(),
        clienteId: z.number().optional(),
        assegnatoA: z.number().optional(),
        // Archive scope:
        //   "exclude" (default) — only active commesse (archivedAt IS NULL)
        //   "only"              — only archived commesse (archivedAt IS NOT NULL)
        //   "all"               — both (used rarely, e.g. admin exports)
        archived: z.enum(["exclude", "only", "all"]).optional(),
      }).optional()
    )
    .query(({ input, ctx }) => {
      let result = commesse.filter((c) => c.sedeId === ctx.sedeId);
      const scope = input?.archived ?? "exclude";
      if (scope === "exclude") {
        result = result.filter((c) => !c.archivedAt);
      } else if (scope === "only") {
        result = result.filter((c) => !!c.archivedAt);
      }
      if (input?.stato) {
        result = result.filter((c) => c.stato === input.stato);
      }
      if (input?.clienteId) {
        result = result.filter((c) => c.clienteId === input.clienteId);
      }
      if (input?.assegnatoA !== undefined) {
        result = result.filter((c) => c.assegnatoA === input.assegnatoA);
      }
      if (input?.search) {
        const q = input.search.toLowerCase();
        result = result.filter(
          (c) =>
            c.codice.toLowerCase().includes(q) ||
            c.cliente.toLowerCase().includes(q) ||
            c.citta?.toLowerCase().includes(q)
        );
      }
      // Strip the heavy `prodotti` array from list responses — list pages
      // never read it; only commesse.byId needs the full object.
      return result
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        // prodotti/pagamenti restano fuori per non appesantire la lista, ma
        // il CONTEGGIO degli acconti serve alla pagina Pagamenti per proporre
        // la rata successiva: senza, suggeriva sempre "1° acconto".
        .map(({ prodotti, pagamenti, ...rest }) => ({
          ...rest,
          nPagamenti: Array.isArray(pagamenti) ? pagamenti.length : 0,
          // Sintesi delle lavorazioni per la colonna in lista: solo nome e
          // quantità, non l'intero prodotto con dimensioni e note.
          prodottiSintesi: (Array.isArray(prodotti) ? prodotti : []).map(
            (p: any) => ({ nome: p.nome, quantita: p.quantita ?? 1 })
          ),
        }));
    }),

  byId: protectedProcedure.input(z.number()).query(({ input, ctx }) => {
    const commessa = commesse.find((c) => c.id === input);
    // Cross-sede isolation: only return the commessa if it belongs to the
    // active sede. Mismatch → null (treated as "not found" by the client).
    if (!commessa || commessa.sedeId !== ctx.sedeId) return null;
    return commessa;
  }),

  create: protectedProcedure
    .input(
      z.object({
        clienteId: z.number().optional(),
        cliente: z.string().optional(),
        indirizzo: z.string().optional(),
        citta: z.string().optional(),
        telefono: z.string().optional(),
        email: z.string().optional(),
        priorita: z.enum(["bassa", "media", "alta", "urgente"]).optional(),
        importoTotale: z.number().nonnegative().nullable().optional(),
        note: z.string().optional(),
        // Indicative delivery — either a preset offset (30/60/90 days) OR a
        // free-form date picked from the calendar. The two are mutually
        // exclusive at display time but the schema accepts both for
        // backwards compatibility with already-persisted records.
        consegnaIndicativa: z.enum(["30", "60", "90"]).optional(),
        dataConsegnaIndicativa: z.string().optional(),
        assegnatoA: z.number().nullable().optional(),
        // Di cosa si tratta: tipologia + quantità, indicate già in creazione.
        prodotti: z
          .array(
            z.object({
              nome: z.string().min(1),
              quantita: z.number().int().min(1).default(1),
            })
          )
          .optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const now = new Date();
      const id = nextId++;
      const {
        clienteId: inputClienteId,
        cliente: clienteName,
        prodotti: inputProdotti,
        ...rest
      } = input;

      // Derive cliente display name + inherit owner from cliente if linked.
      let clienteDisplay = clienteName ?? "";
      let inheritedAssegnatoA: number | null = null;
      if (inputClienteId) {
        const c = getClienteById(inputClienteId);
        if (c) {
          clienteDisplay = `${c.cognome} ${c.nome}`.trim();
          inheritedAssegnatoA = c.assegnatoA ?? null;
        }
      }
      // Owner resolution priority: explicit input > cliente's owner > current user.
      const assegnatoA =
        input.assegnatoA !== undefined
          ? input.assegnatoA
          : inheritedAssegnatoA ?? ctx.user?.id ?? null;

      const commessa = {
        id,
        // Stamp the active sede so the commessa belongs to the current showroom.
        sedeId: ctx.sedeId ?? 1,
        codice: generaCodiceCommessa(),
        clienteId: inputClienteId ?? null,
        cliente: clienteDisplay,
        indirizzo: rest.indirizzo ?? null,
        citta: rest.citta ?? null,
        telefono: rest.telefono ?? null,
        email: rest.email ?? null,
        stato: "preventivo" as const,
        importoTotale: input.importoTotale ?? null,
        importoIncassato: 0,
        costoPosaStimato: null,
        costi: [],
        pagamenti: [],
        priorita: input.priorita ?? "media",
        squadraId: null,
        dataApertura: now.toISOString().split("T")[0],
        consegnaIndicativa: input.consegnaIndicativa ?? null, // "30" | "60" | "90"
        dataConsegnaIndicativa: input.dataConsegnaIndicativa ?? null, // ISO date when operator picks a calendar date instead of an offset
        dataConsegnaConfermata: null, // set when stato=produzione
        dataChiusura: null,
        note: rest.note ?? null,
        prodotti: (inputProdotti ?? []).map((p, i) => ({
          id: i + 1,
          nome: p.nome,
          tipologia: null,
          quantita: p.quantita ?? 1,
          dimensioni: null,
          note: null,
          createdAt: now,
        })) as any[],
        assegnatoA,
        createdBy: ctx.user?.id ?? null,
        createdAt: now,
        updatedAt: now,
      };
      commesse.push(commessa);
      // Link commessa back to cliente
      if (inputClienteId) {
        addCommessaToCliente(inputClienteId, id);
      }
      _store.save();
      await publishAssignmentEvent({
        sedeId: commessa.sedeId,
        entityType: "commessa",
        entityId: commessa.id,
        previousAssigneeId: null,
        assigneeId: commessa.assegnatoA,
        actorUserId: ctx.user?.id ?? null,
        updatedAt: now,
        link: `/commesse/${commessa.id}`,
      });
      return commessa;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        cliente: z.string().optional(),
        clienteId: z.number().nullable().optional(),
        indirizzo: z.string().optional(),
        citta: z.string().optional(),
        telefono: z.string().optional(),
        email: z.string().optional(),
        stato: z.enum(STATI_COMMESSA).optional(),
        priorita: z.enum(["bassa", "media", "alta", "urgente"]).optional(),
        importoTotale: z.number().nonnegative().nullable().optional(),
        // importoIncassato NON è accettato qui: è la somma del registro
        // pagamenti[], ricalcolata da add/update/removePagamento. Accettarlo
        // permetteva di scrivere un incassato slegato dal registro (es. 99999
        // con zero acconti), rompendo residui, KPI e notifiche.
        costoPosaStimato: z.number().nonnegative().nullable().optional(),
        squadraId: z.number().nullable().optional(),
        note: z.string().optional(),
        consegnaIndicativa: z.enum(["30", "60", "90"]).nullable().optional(),
        dataConsegnaIndicativa: z.string().nullable().optional(),
        dataConsegnaConfermata: z.string().nullable().optional(),
        assegnatoA: z.number().nullable().optional(),
        // When true, skip the "required doc uploaded" gate on forward
        // transitions. Used by the client after the operator has confirmed
        // an explicit "procedi comunque" dialog. The state-machine
        // transizione check is NEVER bypassed (shape of the workflow is
        // still enforced).
        force: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const idx = commesse.findIndex((c) => c.id === input.id);
      if (idx === -1) throw new Error("Commessa non trovata");
      assertSedeScope(commesse[idx], ctx.sedeId);
      const previousAssigneeId = commesse[idx].assegnatoA ?? null;
      // Il costo posa alimenta il margine: scrivibile solo da chi lo vede.
      if (input.costoPosaStimato !== undefined) {
        requireDirezioneOAmministrazione(ctx.user);
      }
      // Enforce state machine on stato transitions
      if (input.stato && input.stato !== commesse[idx].stato) {
        validateTransizione(commesse[idx].stato, input.stato);
        // Gate: forward transitions require the current stato's required doc
        // to have been uploaded. Backward transitions are always allowed.
        const currentIdx = STATI_COMMESSA.indexOf(commesse[idx].stato as any);
        const nextIdx = STATI_COMMESSA.indexOf(input.stato as any);
        const isForward = nextIdx > currentIdx;
        if (isForward && !input.force) {
          const required = REQUIRED_DOC_TIPI_PER_STATO[commesse[idx].stato] ?? [];
          if (required.length > 0 && !statoHasRequiredDoc(commesse[idx].id, commesse[idx].stato)) {
            const labels = required.map((t) => DOC_TIPO_LABEL[t]).join(" o ");
            // Thrown error is human-readable but ALSO carries a structured
            // "DOC_GATE_BLOCKED" marker the client can match on to show the
            // "procedi comunque" confirmation instead of a generic toast.
            throw new Error(
              `DOC_GATE_BLOCKED: Non è stato caricato il file "${labels}" per lo stato "${commesse[idx].stato.replace(/_/g, " ")}". Procedere comunque?`
            );
          }
        }
      }
      const { id, force: _force, ...updates } = input;
      void _force;
      // If clienteId changes to a real id, resolve display name + link back to
      // that cliente's commesseIds so the relationship is kept consistent.
      let resolvedCliente = updates.cliente;
      const prevClienteId: number | null = commesse[idx].clienteId ?? null;
      if (
        updates.clienteId !== undefined &&
        updates.clienteId !== null &&
        updates.clienteId !== prevClienteId
      ) {
        const linked = getClienteById(updates.clienteId);
        if (linked) {
          resolvedCliente = `${linked.cognome} ${linked.nome}`.trim();
          addCommessaToCliente(updates.clienteId, commesse[idx].id);
        }
        // Detach from the previous cliente so its commesseIds index stays
        // accurate and doesn't carry stale references.
        if (prevClienteId != null) {
          removeCommessaFromCliente(prevClienteId, commesse[idx].id);
        }
      }
      // Normalize the mutually-exclusive consegna fields: writing one
      // clears the other so the persisted record can never carry both.
      if (updates.dataConsegnaIndicativa !== undefined) {
        if (updates.dataConsegnaIndicativa) {
          updates.consegnaIndicativa = null;
        }
      } else if (updates.consegnaIndicativa !== undefined && updates.consegnaIndicativa) {
        updates.dataConsegnaIndicativa = null;
      }
      // State rollback cleanup: leaving "produzione" backward voids the
      // confirmed delivery date (it was specific to that production run);
      // leaving "archiviata" backward clears the closure date.
      const prevStato: string = commesse[idx].stato;
      if (input.stato && input.stato !== prevStato) {
        const isForwardChange =
          STATI_COMMESSA.indexOf(input.stato as any) >
          STATI_COMMESSA.indexOf(prevStato as any);
        if (!isForwardChange) {
          if (prevStato === "produzione") {
            (updates as any).dataConsegnaConfermata = null;
          }
          if (prevStato === "archiviata") {
            (updates as any).dataChiusura = null;
          }
        }
      }
      commesse[idx] = {
        ...commesse[idx],
        ...updates,
        cliente: resolvedCliente ?? commesse[idx].cliente,
        updatedAt: new Date(),
      };
      if (input.stato === "archiviata") {
        commesse[idx].dataChiusura = new Date().toISOString().split("T")[0];
      }
      _store.save();
      if (input.assegnatoA !== undefined) {
        await publishAssignmentEvent({
          sedeId: commesse[idx].sedeId,
          entityType: "commessa",
          entityId: commesse[idx].id,
          previousAssigneeId,
          assigneeId: commesse[idx].assegnatoA ?? null,
          actorUserId: ctx.user?.id ?? null,
          updatedAt: commesse[idx].updatedAt,
          link: `/commesse/${commesse[idx].id}`,
        });
      }
      return commesse[idx];
    }),

  // Dedicated endpoint for confirming delivery date when stato hits produzione
  confermaDataConsegna: protectedProcedure
    .input(z.object({ id: z.number(), dataConsegna: z.string() }))
    .mutation(({ input, ctx }) => {
      const idx = commesse.findIndex((c) => c.id === input.id);
      if (idx === -1) throw new Error("Commessa non trovata");
      assertSedeScope(commesse[idx], ctx.sedeId);
      commesse[idx] = {
        ...commesse[idx],
        dataConsegnaConfermata: input.dataConsegna,
        updatedAt: new Date(),
      };
      _store.save();
      return commesse[idx];
    }),

  delete: protectedProcedure
    .input(z.number())
    .mutation(async ({ input, ctx }) => {
      const idx = commesse.findIndex((c) => c.id === input);
      if (idx === -1) throw new Error("Commessa non trovata");
      assertSedeScope(commesse[idx], ctx.sedeId);
      // Only the creator/owner or a direzione user can hard-delete.
      requireOwnershipOrDirezione(commesse[idx], ctx.user);
      // Detach the commessa id from the cliente's index so it doesn't
      // linger as a stale reference.
      const clienteId: number | null = commesse[idx].clienteId ?? null;
      const commessaId: number = commesse[idx].id;
      commesse.splice(idx, 1);
      if (clienteId != null) {
        removeCommessaFromCliente(clienteId, commessaId);
      }
      // Cascade: warehouse products belong to the commessa. Dynamic import
      // avoids a static circular dependency (magazzino imports commesse).
      const { deleteMagazzinoByCommessa } = await import("./magazzino");
      deleteMagazzinoByCommessa(commessaId);
      // Cascade: documents (JSONB metadata + storage bytes) die with the
      // commessa — otherwise they linger orphaned in the collection.
      const { deleteDocumentiByCommessa } = await import("./preventiviContratti");
      deleteDocumentiByCommessa(commessaId);
      _store.save();
      return { success: true };
    }),

  // Latest acconti across the sede — feeds the Pagamenti page "ultimi
  // incassi" strip without shipping every register in commesse.list.
  pagamentiRecenti: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(15) }).optional())
    .query(({ input, ctx }) => {
      const out: any[] = [];
      for (const c of commesse) {
        if (c.sedeId !== ctx.sedeId) continue;
        if (!Array.isArray(c.pagamenti)) continue;
        for (const p of c.pagamenti) {
          out.push({
            ...p,
            commessaId: c.id,
            codice: c.codice,
            cliente: c.cliente,
            stato: c.stato,
          });
        }
      }
      out.sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
      return out.slice(0, input?.limit ?? 15);
    }),

  // ── Margine (P0.2) ─────────────────────────────────────────────────────────
  // Economia della singola commessa: direzione o amministrazione.
  margine: protectedProcedure.input(z.number()).query(({ input, ctx }) => {
    requireDirezioneOAmministrazione(ctx.user);
    const c = commesse.find((x) => x.id === input);
    assertSedeScope(c, ctx.sedeId);
    // Ordini fornitore già registrati nel modulo Fornitori: proposti come
    // import una tantum finché il registro costi della commessa è vuoto.
    const ordiniImportabili =
      (c!.costi ?? []).length === 0
        ? getOrdiniPerMargine(input, ctx.sedeId).filter(
            (o) => o.importoTotale > 0 && o.stato !== "bozza" && o.stato !== "contestato"
          )
        : [];
    return { ...calcolaMargine(c!), ordiniImportabili };
  }),

  // ── Registro costi fornitore (embedded sulla commessa) ─────────────────────
  // Stesso schema del registro acconti: si scrive dalla scheda commessa, e il
  // margine è sempre ricalcolato dalla somma — nessun totale denormalizzato.
  addCosto: protectedProcedure
    .input(z.object({
      commessaId: z.number(),
      importo: z.number().positive(),
      fornitore: z.string().nullable().optional(),
      descrizione: z.string().nullable().optional(),
      data: z.string().nullable().optional(), // "YYYY-MM-DD"
      numeroOrdine: z.string().nullable().optional(),
      note: z.string().nullable().optional(),
    }))
    .mutation(({ input, ctx }) => {
      requireDirezioneOAmministrazione(ctx.user);
      const c = commesse.find((x) => x.id === input.commessaId);
      assertSedeScope(c, ctx.sedeId);
      if (!Array.isArray(c!.costi)) c!.costi = [];
      const nextCid = c!.costi.length
        ? Math.max(...c!.costi.map((x: any) => x.id ?? 0)) + 1
        : 1;
      c!.costi.push({
        id: nextCid,
        importo: input.importo,
        fornitore: input.fornitore?.trim() || null,
        descrizione: input.descrizione?.trim() || null,
        data: input.data || null,
        numeroOrdine: input.numeroOrdine?.trim() || null,
        note: input.note?.trim() || null,
        createdAt: new Date(),
      });
      c!.updatedAt = new Date();
      _store.save();
      return c;
    }),

  updateCosto: protectedProcedure
    .input(z.object({
      commessaId: z.number(),
      costoId: z.number(),
      importo: z.number().positive().optional(),
      fornitore: z.string().nullable().optional(),
      descrizione: z.string().nullable().optional(),
      data: z.string().nullable().optional(),
      numeroOrdine: z.string().nullable().optional(),
      note: z.string().nullable().optional(),
    }))
    .mutation(({ input, ctx }) => {
      requireDirezioneOAmministrazione(ctx.user);
      const c = commesse.find((x) => x.id === input.commessaId);
      assertSedeScope(c, ctx.sedeId);
      const co = (c!.costi ?? []).find((x: any) => x.id === input.costoId);
      if (!co) throw new Error("Costo non trovato");
      if (input.importo !== undefined) co.importo = input.importo;
      if (input.fornitore !== undefined) co.fornitore = input.fornitore?.trim() || null;
      if (input.descrizione !== undefined) co.descrizione = input.descrizione?.trim() || null;
      if (input.data !== undefined) co.data = input.data || null;
      if (input.numeroOrdine !== undefined) co.numeroOrdine = input.numeroOrdine?.trim() || null;
      if (input.note !== undefined) co.note = input.note?.trim() || null;
      c!.updatedAt = new Date();
      _store.save();
      return c;
    }),

  removeCosto: protectedProcedure
    .input(z.object({ commessaId: z.number(), costoId: z.number() }))
    .mutation(({ input, ctx }) => {
      requireDirezioneOAmministrazione(ctx.user);
      const c = commesse.find((x) => x.id === input.commessaId);
      assertSedeScope(c, ctx.sedeId);
      if (!Array.isArray(c!.costi)) c!.costi = [];
      const ci = c!.costi.findIndex((x: any) => x.id === input.costoId);
      if (ci === -1) throw new Error("Costo non trovato");
      c!.costi.splice(ci, 1);
      c!.updatedAt = new Date();
      _store.save();
      return c;
    }),

  // Import una tantum degli ordini fornitore già registrati nel modulo
  // Fornitori, per non riscrivere a mano quanto è già a sistema.
  importaCostiDaOrdini: protectedProcedure
    .input(z.number())
    .mutation(({ input, ctx }) => {
      requireDirezioneOAmministrazione(ctx.user);
      const c = commesse.find((x) => x.id === input);
      assertSedeScope(c, ctx.sedeId);
      if (!Array.isArray(c!.costi)) c!.costi = [];
      const ordini = getOrdiniPerMargine(input, ctx.sedeId).filter(
        (o) => o.importoTotale > 0 && o.stato !== "bozza" && o.stato !== "contestato"
      );
      let nextCid = c!.costi.length
        ? Math.max(...c!.costi.map((x: any) => x.id ?? 0)) + 1
        : 1;
      let importati = 0;
      for (const o of ordini) {
        // Idempotente: salta gli ordini già importati (stesso numero).
        if (c!.costi.some((x: any) => x.numeroOrdine === o.codiceOrdine)) continue;
        c!.costi.push({
          id: nextCid++,
          importo: o.importoTotale,
          fornitore: o.fornitoreNome,
          descrizione: "Ordine fornitore",
          data: null,
          numeroOrdine: o.codiceOrdine,
          note: null,
          createdAt: new Date(),
        });
        importati++;
      }
      c!.updatedAt = new Date();
      _store.save();
      return { importati };
    }),

  // Vista aggregata per la pagina /marginalita: solo direzione. Esclude le
  // commesse archiviate (stato o soft-archive) — sono storia, non gestione.
  marginalita: protectedProcedure.query(({ ctx }) => {
    requireDirezione(ctx.user);
    const utenti = getUtentiStore() as any[];
    return commesse
      .filter(
        (c) =>
          c.sedeId === ctx.sedeId &&
          c.stato !== "archiviata" &&
          !c.archivedAt
      )
      .map((c) => {
        const assegnatario = utenti.find((u) => u.id === c.assegnatoA);
        return {
          id: c.id,
          codice: c.codice,
          cliente: c.cliente,
          stato: c.stato,
          dataApertura: c.dataApertura ?? null,
          assegnatoA: c.assegnatoA ?? null,
          assegnatoNome: assegnatario
            ? `${assegnatario.cognome ?? ""} ${assegnatario.nome ?? ""}`.trim()
            : null,
          ...calcolaMargine(c),
        };
      });
  }),

  // ── Acconti / pagamenti (embedded register on commessa) ────────────────────
  // importoIncassato is always recomputed as the sum of the register so the
  // board chips, dashboard items and notifications stay consistent.
  addPagamento: protectedProcedure
    .input(z.object({
      commessaId: z.number(),
      importo: z.number().positive(),
      data: z.string().nullable().optional(), // "YYYY-MM-DD"
      metodo: z.enum(["bonifico", "contanti", "assegno", "pos", "finanziamento", "altro"]).nullable().optional(),
      // Che rata è: 1°–5° acconto oppure saldo finale.
      tipo: z.enum(["acconto_1", "acconto_2", "acconto_3", "acconto_4", "acconto_5", "saldo"]).nullable().optional(),
      note: z.string().optional(),
    }))
    .mutation(({ input, ctx }) => {
      const idx = commesse.findIndex((c) => c.id === input.commessaId);
      if (idx === -1) throw new Error("Commessa non trovata");
      assertSedeScope(commesse[idx], ctx.sedeId);
      const c = commesse[idx];
      if (!Array.isArray(c.pagamenti)) c.pagamenti = [];
      const nextPid = c.pagamenti.length
        ? Math.max(...c.pagamenti.map((p: any) => p.id ?? 0)) + 1
        : 1;
      c.pagamenti.push({
        id: nextPid,
        importo: input.importo,
        data: input.data ?? null,
        metodo: input.metodo ?? null,
        tipo: input.tipo ?? null,
        note: input.note?.trim() || null,
        createdAt: new Date(),
      });
      c.importoIncassato = c.pagamenti.reduce((s: number, p: any) => s + (p.importo ?? 0), 0);
      c.updatedAt = new Date();
      _store.save();
      return c;
    }),

  updatePagamento: protectedProcedure
    .input(z.object({
      commessaId: z.number(),
      pagamentoId: z.number(),
      importo: z.number().positive().optional(),
      data: z.string().nullable().optional(),
      metodo: z.enum(["bonifico", "contanti", "assegno", "pos", "finanziamento", "altro"]).nullable().optional(),
      tipo: z.enum(["acconto_1", "acconto_2", "acconto_3", "acconto_4", "acconto_5", "saldo"]).nullable().optional(),
      note: z.string().nullable().optional(),
    }))
    .mutation(({ input, ctx }) => {
      const idx = commesse.findIndex((c) => c.id === input.commessaId);
      if (idx === -1) throw new Error("Commessa non trovata");
      assertSedeScope(commesse[idx], ctx.sedeId);
      const c = commesse[idx];
      const p = (c.pagamenti ?? []).find((x: any) => x.id === input.pagamentoId);
      if (!p) throw new Error("Acconto non trovato");
      if (input.importo !== undefined) p.importo = input.importo;
      if (input.data !== undefined) p.data = input.data || null;
      if (input.metodo !== undefined) p.metodo = input.metodo ?? null;
      if (input.tipo !== undefined) p.tipo = input.tipo ?? null;
      if (input.note !== undefined) p.note = input.note?.trim() || null;
      c.importoIncassato = c.pagamenti.reduce((s: number, x: any) => s + (x.importo ?? 0), 0);
      c.updatedAt = new Date();
      _store.save();
      return c;
    }),

  removePagamento: protectedProcedure
    .input(z.object({ commessaId: z.number(), pagamentoId: z.number() }))
    .mutation(({ input, ctx }) => {
      const idx = commesse.findIndex((c) => c.id === input.commessaId);
      if (idx === -1) throw new Error("Commessa non trovata");
      assertSedeScope(commesse[idx], ctx.sedeId);
      const c = commesse[idx];
      if (!Array.isArray(c.pagamenti)) c.pagamenti = [];
      const pi = c.pagamenti.findIndex((p: any) => p.id === input.pagamentoId);
      if (pi === -1) throw new Error("Acconto non trovato");
      c.pagamenti.splice(pi, 1);
      c.importoIncassato = c.pagamenti.reduce((s: number, p: any) => s + (p.importo ?? 0), 0);
      c.updatedAt = new Date();
      _store.save();
      return c;
    }),

  // ── Prodotti desiderati (embedded list on commessa) ────────────────────────
  addProdotto: protectedProcedure
    .input(z.object({
      commessaId: z.number(),
      nome: z.string().min(1),
      tipologia: z.string().optional(),
      quantita: z.number().int().min(1).default(1),
      dimensioni: z.string().optional(),
      note: z.string().optional(),
    }))
    .mutation(({ input, ctx }) => {
      const idx = commesse.findIndex((c) => c.id === input.commessaId);
      if (idx === -1) throw new Error("Commessa non trovata");
      assertSedeScope(commesse[idx], ctx.sedeId);
      if (!Array.isArray(commesse[idx].prodotti)) commesse[idx].prodotti = [];
      const prodotto = {
        id: nextProdottoId(commesse[idx]),
        nome: input.nome,
        tipologia: input.tipologia ?? null,
        quantita: input.quantita ?? 1,
        dimensioni: input.dimensioni ?? null,
        note: input.note ?? null,
        createdAt: new Date(),
      };
      commesse[idx].prodotti.push(prodotto);
      commesse[idx].updatedAt = new Date();
      _store.save();
      return prodotto;
    }),

  updateProdotto: protectedProcedure
    .input(z.object({
      commessaId: z.number(),
      prodottoId: z.number(),
      nome: z.string().optional(),
      tipologia: z.string().nullable().optional(),
      quantita: z.number().int().min(1).optional(),
      dimensioni: z.string().nullable().optional(),
      note: z.string().nullable().optional(),
    }))
    .mutation(({ input, ctx }) => {
      const idx = commesse.findIndex((c) => c.id === input.commessaId);
      if (idx === -1) throw new Error("Commessa non trovata");
      assertSedeScope(commesse[idx], ctx.sedeId);
      const prodotti: any[] = commesse[idx].prodotti ?? [];
      const pIdx = prodotti.findIndex((p) => p.id === input.prodottoId);
      if (pIdx === -1) throw new Error("Prodotto non trovato");
      const { commessaId, prodottoId, ...updates } = input;
      prodotti[pIdx] = { ...prodotti[pIdx], ...updates };
      commesse[idx].updatedAt = new Date();
      _store.save();
      return prodotti[pIdx];
    }),

  removeProdotto: protectedProcedure
    .input(z.object({ commessaId: z.number(), prodottoId: z.number() }))
    .mutation(({ input, ctx }) => {
      const idx = commesse.findIndex((c) => c.id === input.commessaId);
      if (idx === -1) throw new Error("Commessa non trovata");
      assertSedeScope(commesse[idx], ctx.sedeId);
      const prodotti: any[] = commesse[idx].prodotti ?? [];
      const pIdx = prodotti.findIndex((p) => p.id === input.prodottoId);
      if (pIdx === -1) throw new Error("Prodotto non trovato");
      prodotti.splice(pIdx, 1);
      commesse[idx].updatedAt = new Date();
      _store.save();
      return { success: true };
    }),

  stats: protectedProcedure.query(({ ctx }) => {
    // Archived commesse (soft-archive) are excluded from every aggregation so
    // dashboard counters don't pollute with jobs the client declined.
    // Also scoped to the active sede.
    const active = commesse.filter(
      (c) => !c.archivedAt && c.sedeId === ctx.sedeId
    );
    const total = active.length;
    const preventivi = active.filter((c) => c.stato === "preventivo").length;
    const inCorso = active.filter((c) =>
      !["preventivo", "finiture_saldo", "interventi_regolazioni", "archiviata"].includes(c.stato)
    ).length;
    const chiuse = active.filter((c) => ["finiture_saldo", "interventi_regolazioni", "archiviata"].includes(c.stato)).length;
    const urgenti = active.filter(
      (c) => c.priorita === "urgente" && c.stato !== "archiviata"
    ).length;
    return { total, preventivi, inCorso, chiuse, urgenti };
  }),

  // Aggregated by priority for dashboard card
  byPriorita: protectedProcedure.query(({ ctx }) => {
    const buckets: Record<string, any[]> = { urgente: [], alta: [], media: [], bassa: [] };
    for (const c of commesse) {
      if (c.sedeId !== ctx.sedeId) continue;
      if (c.archivedAt) continue;
      if (c.stato === "archiviata") continue;
      if (buckets[c.priorita]) buckets[c.priorita].push(c);
    }
    // Sort each bucket newest first
    for (const k of Object.keys(buckets)) {
      buckets[k].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }
    return buckets;
  }),

  // ── Classifica venditori ──────────────────────────────────────────────────
  // Leaderboard of "commerciale" users ranked by number of ACTIVE commesse
  // they own (assegnatoA). "Active" here = stato from "misure_esecutive"
  // onwards (preventivo excluded — not yet a real job) up to and including
  // "interventi_regolazioni"; "archiviata" stato and soft-archived commesse
  // are excluded.

  // ── Soft archive ──────────────────────────────────────────────────────────
  // Sets `archivedAt` to now. The commessa keeps its stato, prodotti,
  // documenti, aperture, interventi — nothing is destroyed. Restore just
  // clears the flag. Safe to re-archive after restore.
  archive: protectedProcedure
    .input(z.number())
    .mutation(({ input, ctx }) => {
      const idx = commesse.findIndex((c) => c.id === input);
      if (idx === -1) throw new Error("Commessa non trovata");
      assertSedeScope(commesse[idx], ctx.sedeId);
      // Archive is the safe, reversible path — open to anyone in the sede.
      if (commesse[idx].archivedAt) return commesse[idx];
      commesse[idx] = {
        ...commesse[idx],
        archivedAt: new Date().toISOString(),
        updatedAt: new Date(),
      };
      _store.save();
      return commesse[idx];
    }),

  restore: protectedProcedure
    .input(z.number())
    .mutation(({ input, ctx }) => {
      const idx = commesse.findIndex((c) => c.id === input);
      if (idx === -1) throw new Error("Commessa non trovata");
      assertSedeScope(commesse[idx], ctx.sedeId);
      if (!commesse[idx].archivedAt) return commesse[idx];
      commesse[idx] = {
        ...commesse[idx],
        archivedAt: null,
        updatedAt: new Date(),
      };
      _store.save();
      return commesse[idx];
    }),
});
