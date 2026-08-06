// Router posta — configurazione caselle e lettura delle comunicazioni.
//
// Le caselle le gestisce solo la direzione: una casella configurata è una
// fonte di dati personali (clienti e, se si collegano quelle personali,
// colleghi). La password entra e non esce più: nessuna procedura qui la
// restituisce, nemmeno cifrata.

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { assertSedeScope, requireDirezione } from "../_core/permissions";
import { secretBoxConfigured } from "../_core/secretBox";
import {
  caselle,
  casellaPubblica,
  newCasellaId,
  proteggiPassword,
  saveCaselle,
  type Casella,
} from "../tars/caselle";
import {
  riavviaWatchers,
  sincronizzaCasella,
  sincronizzaTutte,
  testaCasella,
} from "../tars/imap";
import {
  deleteComunicazione,
  deleteComunicazioniByCasella,
  getComunicazione,
  listComunicazioni,
  segnaTutteViste,
  setMatchComunicazione,
  setStatoComunicazione,
  statsComunicazioni,
} from "../tars/comunicazioni";
import { getCommessaById } from "./commesse";

function trovaCasella(id: number, sedeId: number | null): Casella {
  const c = caselle.find((x) => x.id === id);
  assertSedeScope(c ?? null, sedeId);
  return c!;
}

function assertChiaveCifratura() {
  if (!secretBoxConfigured()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "MAIL_ENCRYPTION_KEY non configurata sul server: senza chiave le password delle caselle non possono essere salvate in sicurezza.",
    });
  }
}

export const mailRouter = router({
  // ── Caselle ───────────────────────────────────────────────────────────
  caselle: router({
    list: protectedProcedure.query(({ ctx }) => {
      requireDirezione(ctx.user);
      return caselle
        .filter((c) => c.sedeId === ctx.sedeId)
        .map(casellaPubblica)
        .sort((a, b) => a.nome.localeCompare(b.nome));
    }),

    // Nome e indirizzo delle caselle, per il filtro in /comunicazioni.
    // Aperto a tutti gli autenticati (list completa resta direzione-only):
    // niente host, niente stato, niente diagnostica.
    opzioni: protectedProcedure.query(({ ctx }) => {
      return caselle
        .filter((c) => c.sedeId === ctx.sedeId)
        .map((c) => ({ id: c.id, nome: c.nome, indirizzo: c.indirizzo }))
        .sort((a, b) => a.nome.localeCompare(b.nome));
    }),

    stato: protectedProcedure.query(({ ctx }) => {
      const mie = caselle.filter((c) => c.sedeId === ctx.sedeId);
      return {
        chiaveConfigurata: secretBoxConfigured(),
        totali: mie.length,
        attive: mie.filter((c) => c.attiva).length,
        conErrori: mie.filter((c) => !!c.ultimoErrore).length,
      };
    }),

    create: protectedProcedure
      .input(
        z.object({
          nome: z.string().min(1).max(80),
          indirizzo: z.string().email(),
          host: z.string().min(1).max(200),
          porta: z.number().int().min(1).max(65535).default(993),
          tls: z.boolean().default(true),
          password: z.string().min(1).max(500),
          cartella: z.string().min(1).max(100).default("INBOX"),
        })
      )
      .mutation(({ input, ctx }) => {
        requireDirezione(ctx.user);
        assertChiaveCifratura();
        const dup = caselle.some(
          (c) =>
            c.sedeId === ctx.sedeId &&
            c.indirizzo.toLowerCase() === input.indirizzo.toLowerCase()
        );
        if (dup) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Questa casella è già configurata.",
          });
        }
        const now = new Date();
        const casella: Casella = {
          id: newCasellaId(),
          sedeId: ctx.sedeId ?? 1,
          nome: input.nome.trim(),
          indirizzo: input.indirizzo.trim().toLowerCase(),
          host: input.host.trim(),
          porta: input.porta,
          tls: input.tls,
          passwordCifrata: proteggiPassword(input.password),
          cartella: input.cartella.trim() || "INBOX",
          // Si aggiunge spenta: prima si prova la connessione, poi si accende.
          attiva: false,
          ultimoUid: null,
          uidValidity: null,
          ultimaSync: null,
          ultimoErrore: null,
          messaggiImportati: 0,
          createdAt: now,
          updatedAt: now,
        };
        caselle.push(casella);
        saveCaselle();
        riavviaWatchers();
        return casellaPubblica(casella);
      }),

    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          nome: z.string().min(1).max(80).optional(),
          host: z.string().min(1).max(200).optional(),
          porta: z.number().int().min(1).max(65535).optional(),
          tls: z.boolean().optional(),
          // Assente = password invariata. Cambiarla resetta il segnalibro
          // solo se cambia anche la cartella, non da sola.
          password: z.string().min(1).max(500).optional(),
          cartella: z.string().min(1).max(100).optional(),
          attiva: z.boolean().optional(),
        })
      )
      .mutation(({ input, ctx }) => {
        requireDirezione(ctx.user);
        const c = trovaCasella(input.id, ctx.sedeId);
        if (input.password !== undefined) {
          assertChiaveCifratura();
          c.passwordCifrata = proteggiPassword(input.password);
        }
        if (input.nome !== undefined) c.nome = input.nome.trim();
        if (input.host !== undefined) c.host = input.host.trim();
        if (input.porta !== undefined) c.porta = input.porta;
        if (input.tls !== undefined) c.tls = input.tls;
        if (input.cartella !== undefined && input.cartella !== c.cartella) {
          c.cartella = input.cartella.trim() || "INBOX";
          // Cartella diversa = UID di un altro spazio: si riparte.
          c.ultimoUid = null;
          c.uidValidity = null;
        }
        if (input.attiva !== undefined) c.attiva = input.attiva;
        c.updatedAt = new Date();
        saveCaselle();
        riavviaWatchers();
        return casellaPubblica(c);
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number(), cancellaComunicazioni: z.boolean().default(false) }))
      .mutation(async ({ input, ctx }) => {
        requireDirezione(ctx.user);
        const c = trovaCasella(input.id, ctx.sedeId);
        const idx = caselle.findIndex((x) => x.id === c.id);
        caselle.splice(idx, 1);
        saveCaselle();
        riavviaWatchers();
        let cancellate = 0;
        if (input.cancellaComunicazioni) {
          cancellate = await deleteComunicazioniByCasella(c.id);
        }
        return { success: true as const, cancellate };
      }),

    // Prova credenziali e raggiungibilità senza importare niente.
    test: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        requireDirezione(ctx.user);
        const c = trovaCasella(input.id, ctx.sedeId);
        const esito = await testaCasella(c);
        if (esito.ok) {
          c.ultimoErrore = null;
        } else {
          c.ultimoErrore = esito.errore;
        }
        c.updatedAt = new Date();
        saveCaselle();
        return esito;
      }),

    sync: protectedProcedure
      .input(z.object({ id: z.number().optional() }).optional())
      .mutation(async ({ input, ctx }) => {
        requireDirezione(ctx.user);
        if (input?.id != null) {
          const c = trovaCasella(input.id, ctx.sedeId);
          return [await sincronizzaCasella(c)];
        }
        return sincronizzaTutte(ctx.sedeId ?? undefined);
      }),
  }),

  // ── Comunicazioni ─────────────────────────────────────────────────────
  comunicazioni: router({
    list: protectedProcedure
      .input(
        z
          .object({
            commessaId: z.number().optional(),
            clienteId: z.number().optional(),
            casellaId: z.number().optional(),
            stato: z.enum(["nuova", "vista", "gestita"]).optional(),
            search: z.string().max(200).optional(),
            soloNonCollegate: z.boolean().optional(),
            limit: z.number().int().min(1).max(200).optional(),
            offset: z.number().int().min(0).optional(),
          })
          .optional()
      )
      .query(async ({ input, ctx }) => {
        return listComunicazioni({
          sedeId: ctx.sedeId ?? 1,
          commessaId: input?.commessaId ?? null,
          clienteId: input?.clienteId ?? null,
          casellaId: input?.casellaId ?? null,
          stato: input?.stato,
          search: input?.search,
          soloNonCollegate: input?.soloNonCollegate,
          limit: input?.limit,
          offset: input?.offset,
        });
      }),

    segnaTutteViste: protectedProcedure.mutation(async ({ ctx }) => {
      const n = await segnaTutteViste(ctx.sedeId ?? 1);
      return { aggiornate: n };
    }),

    byId: protectedProcedure
      .input(z.number())
      .query(async ({ input, ctx }) => {
        return getComunicazione(input, ctx.sedeId ?? 1);
      }),

    stats: protectedProcedure.query(async ({ ctx }) => {
      return statsComunicazioni(ctx.sedeId ?? 1);
    }),

    setStato: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          stato: z.enum(["nuova", "vista", "gestita"]),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const ok = await setStatoComunicazione(
          input.id,
          ctx.sedeId ?? 1,
          input.stato
        );
        if (!ok) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Comunicazione non trovata.",
          });
        }
        return { success: true as const };
      }),

    // Elimina dal CRM. La casella non viene toccata: il messaggio resta
    // visibile nel client di posta. Tombstone, quindi non riappare alla
    // prossima sincronizzazione.
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const ok = await deleteComunicazione(input.id, ctx.sedeId ?? 1);
        if (!ok) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Comunicazione non trovata.",
          });
        }
        return { success: true as const };
      }),

    // Correzione manuale dell'aggancio: l'operatore sposta una mail sulla
    // commessa giusta quando il match automatico ha sbagliato.
    collega: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          commessaId: z.number().nullable(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const sedeId = ctx.sedeId ?? 1;
        let clienteId: number | null = null;
        if (input.commessaId != null) {
          const commessa = getCommessaById(input.commessaId);
          assertSedeScope(commessa ?? null, ctx.sedeId);
          clienteId = (commessa as any).clienteId ?? null;
        }
        const ok = await setMatchComunicazione(input.id, sedeId, {
          clienteId,
          commessaId: input.commessaId,
          confidenza: input.commessaId == null ? "nessuna" : "alta",
          motivo:
            input.commessaId == null
              ? null
              : "Collegata a mano da un operatore.",
        });
        if (!ok) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Comunicazione non trovata.",
          });
        }
        return { success: true as const };
      }),
  }),
});
