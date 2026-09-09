// server/piattaforma/router.ts
// Le LETTURE (WS6 spec §5.1) e le MUTATION (Task 7, spec §5.2) del pannello
// piattaforma: elenco delle aziende, scheda di una, un comando per id (per
// seguire ricalcolo e ripristino accodati), e le azioni che accodano un
// comando in `tenant_comandi` e — salvo `ricalcolaStorage`/`ripristina` —
// lo eseguono subito (`eseguiComandoSubito`). Ogni procedura passa da
// `piattaformaProcedure` (server/_core/trpc.ts): nessun contesto tenant
// implicito (spec §3.1) — l'azienda si individua per `slug`, mai per
// `tenantId` (guardia confine.test.ts, già coperta dalla guardia globale di
// server/tenants/confine.test.ts). Le mutation sensibili (spec §3.2)
// verificano `passwordConferma` PRIMA di accodare: nessun comando resta in
// giro per un tentativo con la password sbagliata.
import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { hashPassword } from "../_core/password";
import { oppureNotFound } from "../_core/permissions";
import { piattaformaProcedure, router } from "../_core/trpc";
import { interruttoreAttivo } from "../platform/interruttori";
import {
  schemaPayloadAbbonamento,
  schemaPayloadCrea,
  schemaPayloadProprietario,
  schemaPayloadRipristino,
  schemaPayloadStato,
  schemaPayloadStorage,
} from "../tenants/comandi";
import { SLUG_RE, TENANT_PREDEFINITO_ID } from "../tenants/costanti";
import { getTenantRepository } from "../tenants/repository";
import { eseguiComandoSubito } from "../tenants/servizio";
import type { TenantComando, TipoComando } from "../tenants/tipi";
import { confermaPassword } from "./accesso";
import { MESSAGGI_PIATTAFORMA } from "./costanti";
import { baseUrlDa, invitaProprietario } from "./inviti";
import { elencoAziende, schedaAzienda } from "./letture";

/** Uno slug valido (spec §5): individua l'azienda, mai `tenantId` (confine.test.ts). */
const slugInput = z.string().regex(SLUG_RE);

/** Le mutation sensibili (spec §3.2) aggiungono questo campo al loro shape. */
const conPassword = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ ...shape, passwordConferma: z.string().min(1) });

/** A interruttore spento il pannello è in sola lettura (spec §3.3): rifiuta PRIMA di accodare. */
function assicuraScrivibile(): void {
  if (!interruttoreAttivo("multiAzienda")) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: MESSAGGI_PIATTAFORMA.solaLetturaFlagSpento });
  }
}

/** Slug sconosciuto → NOT_FOUND «Risorsa non trovata.», mai un indizio per enumerarlo. */
function tenantDaSlug(slug: string) {
  return oppureNotFound(getTenantRepository().perSlug(slug));
}

/**
 * Accoda con l'attore piattaforma (spec §4.3: `richiestoDa` diventa
 * `piattaforma:<email>`, così gli eventi dicono chi ha agito dal pannello) e,
 * se `subito`, esegue con `eseguiComandoSubito` (spec §5.2) invece di
 * lasciare il comando `in_attesa` per il giro dei 30 s.
 */
async function accodaEdEsegui(
  ctx: { amministratore: { email: string } },
  tipo: TipoComando,
  tenantId: number | null,
  payload: Record<string, unknown>,
  subito: boolean
): Promise<TenantComando> {
  const repo = getTenantRepository();
  const c = await repo.accodaComando({
    tipo,
    tenantId,
    payload,
    richiestoDa: `piattaforma:${ctx.amministratore.email}`,
  });
  return subito ? eseguiComandoSubito(c.id) : c;
}

/**
 * Un hash che nessuno conosce e nessuno può usare per accedere: la password
 * vera del proprietario arriva solo con l'invito (spec §5.2), mai da `crea`.
 */
const passwordInutilizzabile = () => hashPassword(randomBytes(32).toString("base64url"));

export const piattaformaRouter = router({
  /** L'elenco di tutte le aziende: abbonamento, spazio, Tars, worker sospesi, ultimo backup e proprietari (spec §5.1). */
  aziende: piattaformaProcedure.query(() => elencoAziende(new Date())),

  /** La scheda completa di un'azienda. Slug sconosciuto → NOT_FOUND «Risorsa non trovata.» */
  azienda: piattaformaProcedure
    .input(z.object({ slug: z.string().regex(SLUG_RE) }))
    .query(async ({ input }) => oppureNotFound(await schedaAzienda(input.slug, new Date()))),

  /** Un comando per id, per seguire l'esito di ricalcolo e ripristino accodati (`null` se non esiste). */
  comando: piattaformaProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(({ input }) => getTenantRepository().comando(input.id)),

  /**
   * Crea l'azienda (sede, proprietario) con una password inutilizzabile
   * (spec §5.2): nessuno può entrare prima di accettare l'invito. Se il
   * comando va a buon fine su un tenant NUOVO ed è dato un `omaggio`, accoda
   * ed esegue anche `imposta_abbonamento`; poi manda l'invito al
   * proprietario. Se il tenant esisteva già (`crea` è idempotente per slug)
   * non manda nulla e lo dice in `nota`.
   */
  crea: piattaformaProcedure
    .input(
      conPassword({
        slug: slugInput,
        nome: z.string().trim().min(1).max(120),
        sede: z.object({
          nome: z.string().trim().min(1).max(120),
          citta: z.string().trim().max(80).nullable().optional(),
        }),
        proprietario: z.object({
          nome: z.string().trim().min(1).max(80),
          cognome: z.string().trim().min(1).max(80),
          email: z.string().trim().email(),
          telefono: z.string().trim().max(40).nullable().optional(),
        }),
        omaggio: z
          .object({
            motivo: z.string().trim().min(1).max(500),
            scadenza: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
          })
          .optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      assicuraScrivibile();
      confermaPassword(ctx.user as any, input.passwordConferma);
      const payload = schemaPayloadCrea.parse({
        slug: input.slug,
        nome: input.nome,
        sede: input.sede,
        proprietario: { ...input.proprietario, passwordHash: passwordInutilizzabile() },
      });
      const comando = await accodaEdEsegui(ctx, "crea", null, payload, true);
      if (comando.stato !== "eseguito") return { comando, invito: null, omaggio: null };
      const esito = comando.esito as { tenantId: number; creatoOra: boolean };
      if (!esito.creatoOra) {
        return { comando, invito: null, omaggio: null, nota: MESSAGGI_PIATTAFORMA.tenantGiaEsistente };
      }
      const omaggio = input.omaggio
        ? await accodaEdEsegui(
            ctx,
            "imposta_abbonamento",
            esito.tenantId,
            schemaPayloadAbbonamento.parse({ azione: "omaggio", slug: input.slug, ...input.omaggio }),
            true
          )
        : null;
      const invito = await invitaProprietario({
        tenantId: esito.tenantId,
        email: input.proprietario.email,
        attore: { tipo: "piattaforma", email: ctx.amministratore.email },
        adesso: new Date(),
        baseUrl: baseUrlDa(ctx.req),
      });
      return { comando, omaggio, invito };
    }),

  /**
   * Sospende l'azienda. Il tenant 1 (Ruffino Group) richiede `ancheTenant1`:
   * senza, rifiuta con lo stesso messaggio dello script `pnpm tenant
   * sospendi` — sospenderlo mette la piattaforma stessa in sola lettura.
   */
  sospendi: piattaformaProcedure
    .input(
      conPassword({
        slug: slugInput,
        motivo: z.string().trim().min(3).max(500),
        ancheTenant1: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      assicuraScrivibile();
      confermaPassword(ctx.user as any, input.passwordConferma);
      const t = tenantDaSlug(input.slug);
      if (t.id === TENANT_PREDEFINITO_ID && !input.ancheTenant1) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: MESSAGGI_PIATTAFORMA.tenant1SospensioneConferma });
      }
      return {
        comando: await accodaEdEsegui(
          ctx,
          "sospendi",
          t.id,
          schemaPayloadStato.parse({ slug: input.slug, motivo: input.motivo }),
          true
        ),
      };
    }),

  /** Riattiva l'azienda (nessuna conferma aggiuntiva per il tenant 1: riattivare non toglie nulla). */
  riattiva: piattaformaProcedure
    .input(conPassword({ slug: slugInput, motivo: z.string().trim().min(3).max(500) }))
    .mutation(async ({ input, ctx }) => {
      assicuraScrivibile();
      confermaPassword(ctx.user as any, input.passwordConferma);
      const t = tenantDaSlug(input.slug);
      return {
        comando: await accodaEdEsegui(
          ctx,
          "riattiva",
          t.id,
          schemaPayloadStato.parse({ slug: input.slug, motivo: input.motivo }),
          true
        ),
      };
    }),

  /** Assegna o revoca il ruolo proprietario a un utente già dell'azienda. */
  proprietario: piattaformaProcedure
    .input(
      conPassword({
        slug: slugInput,
        email: z.string().trim().email(),
        azione: z.enum(["assegna", "revoca"]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      assicuraScrivibile();
      confermaPassword(ctx.user as any, input.passwordConferma);
      const t = tenantDaSlug(input.slug);
      const tipo: TipoComando = input.azione === "assegna" ? "assegna_proprietario" : "revoca_proprietario";
      return {
        comando: await accodaEdEsegui(
          ctx,
          tipo,
          t.id,
          schemaPayloadProprietario.parse({ slug: input.slug, email: input.email }),
          true
        ),
      };
    }),

  /**
   * Una delle sette azioni di `schemaPayloadAbbonamento` (spec §9). Le
   * regole del tenant 1 (`nonIlTenant1`) restano quelle del servizio: il
   * pannello mostra l'errore del dominio in `comando.esito.errore`, non lo
   * aggira.
   */
  abbonamento: piattaformaProcedure
    .input(z.intersection(schemaPayloadAbbonamento, z.object({ passwordConferma: z.string().min(1) })))
    .mutation(async ({ input, ctx }) => {
      assicuraScrivibile();
      confermaPassword(ctx.user as any, input.passwordConferma);
      const { passwordConferma: _passwordConferma, ...payload } = input;
      const t = tenantDaSlug(payload.slug);
      return {
        comando: await accodaEdEsegui(ctx, "imposta_abbonamento", t.id, schemaPayloadAbbonamento.parse(payload), true),
      };
    }),

  /** Non sensibile (spec §3.2): resta `in_attesa`, la esegue il giro dei 30 s. */
  ricalcolaStorage: piattaformaProcedure
    .input(z.object({ slug: slugInput }))
    .mutation(async ({ input, ctx }) => {
      assicuraScrivibile();
      const t = tenantDaSlug(input.slug);
      return {
        comando: await accodaEdEsegui(
          ctx,
          "ricalcola_storage",
          t.id,
          schemaPayloadStorage.parse({ slug: input.slug }),
          false
        ),
      };
    }),

  /**
   * In coda come `ricalcolaStorage`: il server la esegue al giro dei 30 s
   * perché è lui a parlare col Drive dell'azienda. Sensibile SOLO con
   * `scrivi: true` (una prova non tocca nulla, spec §3.2).
   */
  ripristina: piattaformaProcedure
    .input(
      z.object({
        slug: slugInput,
        backup: z.string().trim().min(1).max(120),
        solo: z.array(z.string().trim().min(1)).nullable().optional(),
        scrivi: z.boolean(),
        ancheTenant1: z.boolean().optional(),
        passwordConferma: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      assicuraScrivibile();
      if (input.scrivi) confermaPassword(ctx.user as any, input.passwordConferma ?? "");
      const t = tenantDaSlug(input.slug);
      const { passwordConferma: _passwordConferma, ...payload } = input;
      return {
        comando: await accodaEdEsegui(
          ctx,
          "ripristina_archivi",
          t.id,
          schemaPayloadRipristino.parse(payload),
          false
        ),
      };
    }),

  /**
   * Non è un comando (spec §6.4): il link è un segreto a tempo che non deve
   * restare a terra. Se manca `email` e l'azienda ha più proprietari,
   * `invitaProprietario` rifiuta con `proprietarioAmbiguo`: qui diventa
   * `BAD_REQUEST` invece di propagare un `Error` generico.
   */
  invita: piattaformaProcedure
    .input(z.object({ slug: slugInput, email: z.string().trim().email().optional() }))
    .mutation(async ({ input, ctx }) => {
      assicuraScrivibile();
      const t = tenantDaSlug(input.slug);
      try {
        return await invitaProprietario({
          tenantId: t.id,
          email: input.email,
          attore: { tipo: "piattaforma", email: ctx.amministratore.email },
          adesso: new Date(),
          baseUrl: baseUrlDa(ctx.req),
        });
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : String(e) });
      }
    }),

  /** Annulla un invito non ancora usato; `null` se non esiste o è già stato usato. */
  annullaInvito: piattaformaProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      assicuraScrivibile();
      const repo = getTenantRepository();
      const invito = await repo.annullaInvito(input.id);
      if (invito) {
        await repo.registraEvento({
          tenantId: invito.tenantId,
          tipo: "invito_annullato",
          attore: `piattaforma:${ctx.amministratore.email}`,
          dettagli: { invitoId: invito.id },
        });
      }
      return invito;
    }),
});
