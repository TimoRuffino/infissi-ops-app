import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";
import { publishAssignmentEvent } from "../events/publish";
import { assertSedeScope, requireDirezione } from "../_core/permissions";
import { requireAssignableUser } from "../authz/assignments";
import { authorizeCoreOperation } from "../authz/enforcement";
import type { TrpcContext } from "../_core/context";
import {
  chiaveRicerca,
  numeroCorrisponde,
  testoCorrisponde,
} from "../_core/ricerca";
// NOTE: imported lazily inside the update handler to avoid a circular-
// import cycle (commesse.ts already imports from this file).

// ── Referenti (contacts per client) ─────────────────────────────────────────

type Referente = {
  nome: string;
  ruolo: string; // "cliente_finale" | "architetto" | "direttore_lavori" | "amministratore" | "altro"
  telefono?: string;
  email?: string;
};

// ── In-memory data ──────────────────────────────────────────────────────────

let nextId = 1;

const _store = persistedStore<any>("clienti", (items) => {
  nextId = items.length ? Math.max(...items.map((x: any) => x.id)) + 1 : 1;
  // Backfill assegnatoA on legacy records — defaults to createdBy if present.
  for (const c of items) {
    if ((c as any).assegnatoA === undefined) {
      (c as any).assegnatoA = (c as any).createdBy ?? null;
    }
    // Backfill sede scope → default sede (id 1) for pre-multi-sede records.
    if ((c as any).sedeId === undefined) (c as any).sedeId = 1;
    // Soft-archive flag (ISO string when archived, else null).
    if ((c as any).archivedAt === undefined) (c as any).archivedAt = null;
  }
});
const clienti = _store.items;

// ── Exported store operations (used by commesse router) ─────────────────────

export function addCommessaToCliente(clienteId: number, commessaId: number) {
  const idx = clienti.findIndex((c) => c.id === clienteId);
  if (idx === -1) return;
  if (!clienti[idx].commesseIds.includes(commessaId)) {
    clienti[idx].commesseIds = [...clienti[idx].commesseIds, commessaId];
    _store.save();
  }
}

/**
 * Detach a commessa id from a cliente's `commesseIds` index. Called when a
 * commessa is re-linked to a different cliente or hard-deleted, so the old
 * cliente doesn't carry a stale reference.
 */
export function removeCommessaFromCliente(
  clienteId: number,
  commessaId: number
) {
  const idx = clienti.findIndex((c) => c.id === clienteId);
  if (idx === -1) return;
  const list: number[] = clienti[idx].commesseIds ?? [];
  if (!list.includes(commessaId)) return;
  clienti[idx].commesseIds = list.filter((id) => id !== commessaId);
  _store.save();
}

// Read-only view + minimal creator for the Fatture in Cloud sync (runs
// outside a request context, so sedeId defaults to the primary sede).
export function getClientiStore() {
  return clienti;
}

export function createClienteFromSync(data: {
  // La sede del token che ha letto la fattura: il cliente nasce dove è
  // stato fatturato, non sempre sulla sede principale.
  sedeId: number;
  cognome: string;
  nome: string;
  tipo: "privato" | "azienda" | "condominio" | "ente_pubblico";
  codiceFiscale?: string;
  partitaIva?: string;
  email?: string | null;
  telefono?: string | null;
  indirizzo?: string | null;
  citta?: string | null;
  cap?: string | null;
}) {
  const now = new Date();
  const cliente = {
    id: nextId++,
    sedeId: data.sedeId,
    nome: data.nome,
    cognome: data.cognome,
    tipo: data.tipo,
    codiceFiscale: data.codiceFiscale ?? null,
    partitaIva: data.partitaIva ?? null,
    email: data.email ?? null,
    telefono: data.telefono ?? null,
    indirizzo: data.indirizzo ?? null,
    citta: data.citta ?? null,
    cap: data.cap ?? null,
    commesseIds: [],
    createdAt: now,
    updatedAt: now,
  };
  clienti.push(cliente);
  _store.save();
  return cliente;
}

/** Persiste la raccolta: serve agli import e alle manutenzioni una tantum. */
export function saveClientiStore(): void {
  _store.save();
}

export function getClienteById(id: number) {
  return clienti.find((c) => c.id === id) ?? null;
}

const PRATICA_EDILIZIA = ["nessuna", "cil", "cila", "scia"] as const;
const TIPO_DETRAZIONE = ["ecobonus", "ristrutturazione"] as const;

// ── Creazione cliente ───────────────────────────────────────────────────────

const creaClienteInput = z.object({
  nome: z.string().min(1),
  cognome: z.string().min(1),
  tipo: z.enum(["privato", "azienda", "condominio", "ente_pubblico"]).optional(),
  codiceFiscale: z.string().optional(),
  partitaIva: z.string().optional(),
  // Legacy "indirizzo/citta/cap" → kept as RESIDENZA (used by admin
  // for fatture). New explicit fields below for work-site address.
  indirizzo: z.string().optional(),
  citta: z.string().optional(),
  cap: z.string().optional(),
  // Work-site address — what the commessa cares about. Falls back to
  // residenza when not provided.
  indirizzoLavoro: z.string().optional(),
  cittaLavoro: z.string().optional(),
  capLavoro: z.string().optional(),
  telefono: z.string().optional(),
  email: z.string().optional(),
  detrazione: z.boolean().optional(),
  // Which detrazione the client wants — only meaningful when
  // detrazione === true. Null when no detrazione requested.
  tipoDetrazione: z.enum(TIPO_DETRAZIONE).nullable().optional(),
  interesseFinanziamento: z.boolean().optional(),
  praticaEdilizia: z.enum(PRATICA_EDILIZIA).optional(),
  referenti: z.array(z.object({
    nome: z.string(),
    ruolo: z.string(),
    telefono: z.string().optional(),
    email: z.string().optional(),
  })).optional(),
  note: z.string().optional(),
  assegnatoA: z.number().nullable().optional(),
});
type CreaClienteInput = z.infer<typeof creaClienteInput>;

/**
 * Percorso unico di `clienti.create` e `clienti.createConCommessa`: la
 * policy, la sede, l'assegnatario di default e l'evento di assegnazione
 * non si duplicano.
 */
export async function creaCliente(
  ctx: Pick<TrpcContext, "user" | "sedeId" | "sediIds">,
  input: CreaClienteInput
) {
  await authorizeCoreOperation({
    ctx,
    endpoint: "clienti.create",
    capability: "cliente.create",
    resourceType: "cliente",
  });
  const now = new Date();
  const { assegnatoA: inputAssegnato, ...rest } = input;
  if (inputAssegnato !== undefined && inputAssegnato !== ctx.user?.id) {
    requireAssignableUser({
      assigneeUserId: inputAssegnato,
      sedeId: ctx.sedeId ?? 1,
      requiredCapability: "cliente.update_operational",
    });
  }
  const cliente = {
    id: nextId++,
    ...rest,
    // Stamp the active sede so the cliente belongs to the current showroom.
    sedeId: ctx.sedeId ?? 1,
    tipo: input.tipo ?? "privato",
    detrazione: input.detrazione ?? false,
    tipoDetrazione: input.tipoDetrazione ?? null,
    interesseFinanziamento: input.interesseFinanziamento ?? false,
    praticaEdilizia: input.praticaEdilizia ?? "nessuna",
    referenti: input.referenti ?? [],
    commesseIds: [] as number[],
    // Default owner: explicit input, else current user. Ownership binds
    // every future commessa back to the user who onboarded the cliente.
    assegnatoA: inputAssegnato !== undefined ? inputAssegnato : ctx.user?.id ?? null,
    createdBy: ctx.user?.id ?? null,
    createdAt: now,
    updatedAt: now,
  };
  clienti.push(cliente);
  _store.save();
  await publishAssignmentEvent({
    sedeId: cliente.sedeId,
    entityType: "cliente",
    entityId: cliente.id,
    previousAssigneeId: null,
    assigneeId: cliente.assegnatoA,
    actorUserId: ctx.user?.id ?? null,
    updatedAt: now,
    link: `/clienti/${cliente.id}`,
  });
  return cliente;
}

export const clientiRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        search: z.string().optional(),
        tipo: z.string().optional(),
        assegnatoA: z.number().optional(),
        // exclude (default) = active only; only = archived; all = both.
        archived: z.enum(["exclude", "only", "all"]).optional(),
      }).optional()
    )
    .query(({ input, ctx }) => {
      let result = clienti.filter((c) => c.sedeId === ctx.sedeId);
      const scope = input?.archived ?? "exclude";
      if (scope === "exclude") result = result.filter((c) => !c.archivedAt);
      else if (scope === "only") result = result.filter((c) => !!c.archivedAt);
      if (input?.tipo) result = result.filter((c) => c.tipo === input.tipo);
      if (input?.assegnatoA !== undefined) {
        result = result.filter((c) => c.assegnatoA === input.assegnatoA);
      }
      // Chi cerca un cliente parte da quello che ha sottomano: il numero da
      // cui l'hanno chiamato, la mail di un preventivo, la via del cantiere.
      // Nome, città e mail da soli lasciavano fuori proprio quei casi.
      // Referenti compresi: la telefonata arriva spesso dall'architetto o
      // dall'amministratore, non dall'intestatario.
      const chiave = input?.search ? chiaveRicerca(input.search) : null;
      if (chiave) {
        result = result.filter((c) => {
          const referenti: Referente[] = Array.isArray(c.referenti)
            ? c.referenti
            : [];
          return (
            testoCorrisponde(
              [
                // Entrambi gli ordini: in anagrafica si scrive «Rossi Mario»
                // tanto quanto «Mario Rossi».
                `${c.nome ?? ""} ${c.cognome ?? ""}`,
                `${c.cognome ?? ""} ${c.nome ?? ""}`,
                c.email,
                c.indirizzo,
                c.citta,
                c.cap,
                c.indirizzoLavoro,
                c.cittaLavoro,
                c.capLavoro,
                c.codiceFiscale,
                c.partitaIva,
                ...referenti.flatMap((r) => [r.nome, r.email]),
              ],
              chiave
            ) ||
            numeroCorrisponde(
              [c.telefono, ...referenti.map((r) => r.telefono)],
              chiave
            )
          );
        });
      }
      return result.sort((a, b) =>
        `${a.cognome} ${a.nome}`.localeCompare(`${b.cognome} ${b.nome}`)
      );
    }),

  byId: protectedProcedure.input(z.number()).query(({ input, ctx }) => {
    const c = clienti.find((c) => c.id === input);
    if (!c || c.sedeId !== ctx.sedeId) return null;
    return c;
  }),

  create: protectedProcedure
    .input(creaClienteInput)
    .mutation(({ input, ctx }) => creaCliente(ctx, input)),

  /**
   * Cliente e prima commessa in una richiesta sola: è il pulsante «Crea
   * cliente e commessa» del dialog. La commessa nasce in `preventivo` con
   * l'indirizzo di lavoro (fallback residenza), telefono, email e
   * assegnatario del cliente, esattamente come farebbe `commesse.create`.
   */
  createConCommessa: protectedProcedure
    .input(creaClienteInput)
    .mutation(async ({ input, ctx }) => {
      // `commessa.create` si verifica PRIMA di scrivere: chi può creare
      // clienti ma non commesse non deve ritrovarsi un cliente orfano.
      // `creaCommessa` la ricontrolla per conto suo, com'è giusto che sia.
      await authorizeCoreOperation({
        ctx,
        endpoint: "clienti.createConCommessa",
        capability: "commessa.create",
        resourceType: "commessa",
      });
      const cliente = await creaCliente(ctx, input);
      // Import lazy: commesse.ts importa già da questo file (v. nota in testa).
      const { creaCommessa } = await import("./commesse");
      const commessa = await creaCommessa(ctx, {
        clienteId: cliente.id,
        indirizzo: cliente.indirizzoLavoro || cliente.indirizzo || undefined,
        citta: cliente.cittaLavoro || cliente.citta || undefined,
        telefono: cliente.telefono || undefined,
        email: cliente.email || undefined,
      });
      return { cliente, commessa };
    }),

  /**
   * Import dell'anagrafica da un export CSV di Fatture in Cloud.
   *
   * Sta qui e non solo nello script perché `persistedStore` tiene i clienti
   * in memoria e li riscrive interi a ogni salvataggio: una scrittura fatta
   * da un processo separato viene sovrascritta dal primo salvataggio del
   * server vivo. È lo stesso motivo per cui il reset del pattuito è passato
   * dall'interfaccia.
   *
   * Non elimina e non sovrascrive mai: crea i mancanti e, solo con
   * `arricchisci`, riempie i campi VUOTI di chi c'è già.
   */
  importaDaCsv: protectedProcedure
    .input(
      z.object({
        csv: z.string().min(10).max(20_000_000),
        apply: z.boolean().default(false),
        arricchisci: z.boolean().default(false),
      })
    )
    .mutation(async ({ input, ctx }) => {
      requireDirezione(ctx.user);
      const sedeId = ctx.sedeId ?? 1;
      const [{ importaClienti, leggiRighe }, { COMPANY_RE, splitPersona }] =
        await Promise.all([
          import("../_core/importaClienti"),
          import("./fattureInCloud"),
        ]);

      const righe = leggiRighe(input.csv);
      if (righe.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Nessuna riga leggibile: serve un CSV con la riga di intestazione dell'export Fatture in Cloud.",
        });
      }

      const report = importaClienti(
        righe,
        { apply: input.apply, arricchisci: input.arricchisci },
        {
          clientiEsistenti: clienti as any,
          sedeId,
          crea: dati => {
            const creato: any = createClienteFromSync({
              sedeId: dati.sedeId,
              cognome: dati.cognome,
              nome: dati.nome,
              tipo: dati.tipo,
              partitaIva: dati.partitaIva,
              codiceFiscale: dati.codiceFiscale,
            });
            Object.assign(creato, {
              email: dati.email ?? null,
              telefono: dati.telefono ?? null,
              indirizzo: dati.indirizzo ?? null,
              citta: dati.citta ?? null,
              cap: dati.cap ?? null,
              note: dati.note ?? null,
              // Import massivo: nessun proprietario. Assegnarli tutti a chi
              // preme il bottone riempirebbe la sua coda di centinaia di
              // clienti che non ha mai visto.
              assegnatoA: null,
              createdBy: ctx.user?.id ?? null,
            });
            return creato.id;
          },
          arricchisci: (clienteId, campi) => {
            const cliente: any = clienti.find((c: any) => c.id === clienteId);
            if (!cliente) return;
            Object.assign(cliente, campi, { updatedAt: new Date() });
          },
          salva: () => _store.save(),
          isAzienda: nome => COMPANY_RE.test(nome),
          dividiPersona: (nome, cf) => splitPersona(nome, cf),
        }
      );

      // Gli esiti riga per riga sono centinaia: al client serve il conteggio
      // e un campione, non l'elenco intero.
      const campione = (esito: string, max: number) =>
        report.esiti
          .filter(e => e.esito === esito)
          .slice(0, max)
          .map(e => e.riga.denominazione);

      return {
        dryRun: report.dryRun,
        righeLette: report.righeLette,
        creati: report.creati,
        giaPresenti: report.giaPresenti,
        duplicatiNelFile: report.duplicatiNelFile,
        scartati: report.scartati,
        campiArricchiti: report.campiArricchiti,
        esempiDaCreare: campione("creato", 15),
        esempiRipetuti: campione("duplicato_nel_file", 8),
        esempiScartati: campione("scartato", 8),
      };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        nome: z.string().optional(),
        cognome: z.string().optional(),
        tipo: z.enum(["privato", "azienda", "condominio", "ente_pubblico"]).optional(),
        codiceFiscale: z.string().optional(),
        partitaIva: z.string().optional(),
        indirizzo: z.string().optional(),
        citta: z.string().optional(),
        cap: z.string().optional(),
        indirizzoLavoro: z.string().optional(),
        cittaLavoro: z.string().optional(),
        capLavoro: z.string().optional(),
        telefono: z.string().optional(),
        email: z.string().optional(),
        detrazione: z.boolean().optional(),
        tipoDetrazione: z.enum(TIPO_DETRAZIONE).nullable().optional(),
        interesseFinanziamento: z.boolean().optional(),
        praticaEdilizia: z.enum(PRATICA_EDILIZIA).optional(),
        referenti: z.array(z.object({
          nome: z.string(),
          ruolo: z.string(),
          telefono: z.string().optional(),
          email: z.string().optional(),
        })).optional(),
        note: z.string().optional(),
        assegnatoA: z.number().nullable().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const idx = clienti.findIndex((c) => c.id === input.id);
      if (idx === -1) throw new Error("Cliente non trovato");
      assertSedeScope(clienti[idx], ctx.sedeId);
      await authorizeCoreOperation({
        ctx,
        endpoint: "clienti.update",
        capability: "cliente.update_operational",
        resourceType: "cliente",
        resource: clienti[idx],
      });
      if (input.assegnatoA !== undefined) {
        await authorizeCoreOperation({
          ctx,
          endpoint: "clienti.assign",
          capability: "cliente.assign",
          resourceType: "cliente",
          resource: clienti[idx],
        });
        if (input.assegnatoA !== ctx.user?.id) {
          requireAssignableUser({
            assigneeUserId: input.assegnatoA,
            sedeId: ctx.sedeId ?? 1,
            requiredCapability: "cliente.update_operational",
          });
        }
      }
      const prev = { ...clienti[idx] };
      const { id, ...updates } = input;
      clienti[idx] = { ...clienti[idx], ...updates, updatedAt: new Date() };
      _store.save();

      // Cascade: propagate nome/cognome (always) and contact fields (when the
      // commessa hasn't overridden them) to every linked commessa. Lazy
      // import to break the commesse ↔ clienti circular dep.
      const { syncClienteOnCommesse } = await import("./commesse");
      syncClienteOnCommesse(
        input.id,
        {
          nome: input.nome,
          cognome: input.cognome,
          telefono: input.telefono,
          email: input.email,
          indirizzo: input.indirizzo,
          citta: input.citta,
        },
        {
          nome: prev.nome,
          cognome: prev.cognome,
          telefono: prev.telefono,
          email: prev.email,
          indirizzo: prev.indirizzo,
          citta: prev.citta,
        }
      );

      if (input.assegnatoA !== undefined) {
        await publishAssignmentEvent({
          sedeId: clienti[idx].sedeId,
          entityType: "cliente",
          entityId: clienti[idx].id,
          previousAssigneeId: prev.assegnatoA ?? null,
          assigneeId: clienti[idx].assegnatoA ?? null,
          actorUserId: ctx.user?.id ?? null,
          updatedAt: clienti[idx].updatedAt,
          link: `/clienti/${clienti[idx].id}`,
        });
      }

      return clienti[idx];
    }),

  delete: protectedProcedure
    .input(z.number())
    .mutation(async ({ input, ctx }) => {
      const idx = clienti.findIndex((c) => c.id === input);
      if (idx === -1) throw new Error("Cliente non trovato");
      assertSedeScope(clienti[idx], ctx.sedeId);
      await authorizeCoreOperation({
        ctx,
        endpoint: "clienti.delete",
        capability: "cliente.delete",
        resourceType: "cliente",
        resource: clienti[idx],
      });
      clienti.splice(idx, 1);
      _store.save();
      return { success: true };
    }),

  stats: protectedProcedure.query(({ ctx }) => {
    const scoped = clienti.filter((c) => c.sedeId === ctx.sedeId && !c.archivedAt);
    return {
      totale: scoped.length,
      privati: scoped.filter((c) => c.tipo === "privato").length,
      aziende: scoped.filter((c) => c.tipo === "azienda").length,
      condomini: scoped.filter((c) => c.tipo === "condominio").length,
      entiPubblici: scoped.filter((c) => c.tipo === "ente_pubblico").length,
    };
  }),

  // ── Soft archive (cliente + its commesse) ──────────────────────────────────
  // Open to anyone in the sede (archive is reversible, not destructive).
  // Archiving a cliente also archives every commessa linked to it; restore
  // brings both back.
  archive: protectedProcedure.input(z.number()).mutation(async ({ input, ctx }) => {
    const idx = clienti.findIndex((c) => c.id === input);
    if (idx === -1) throw new Error("Cliente non trovato");
    assertSedeScope(clienti[idx], ctx.sedeId);
    await authorizeCoreOperation({
      ctx,
      endpoint: "clienti.archive",
      capability: "cliente.archive",
      resourceType: "cliente",
      resource: clienti[idx],
    });
    if (!clienti[idx].archivedAt) {
      clienti[idx] = {
        ...clienti[idx],
        archivedAt: new Date().toISOString(),
        updatedAt: new Date(),
      };
      _store.save();
    }
    const { setCommesseArchivedByCliente } = await import("./commesse");
    setCommesseArchivedByCliente(input, true);
    return clienti[idx];
  }),

  restore: protectedProcedure.input(z.number()).mutation(async ({ input, ctx }) => {
    const idx = clienti.findIndex((c) => c.id === input);
    if (idx === -1) throw new Error("Cliente non trovato");
    assertSedeScope(clienti[idx], ctx.sedeId);
    await authorizeCoreOperation({
      ctx,
      endpoint: "clienti.restore",
      capability: "cliente.archive",
      resourceType: "cliente",
      resource: clienti[idx],
    });
    if (clienti[idx].archivedAt) {
      clienti[idx] = { ...clienti[idx], archivedAt: null, updatedAt: new Date() };
      _store.save();
    }
    const { setCommesseArchivedByCliente } = await import("./commesse");
    setCommesseArchivedByCliente(input, false);
    return clienti[idx];
  }),
});
