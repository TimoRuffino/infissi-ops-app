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
  schemaPayloadModificaProprietario,
  schemaPayloadModificaTenant,
  schemaPayloadProprietario,
  schemaPayloadRipristino,
  schemaPayloadStato,
  schemaPayloadStorage,
} from "../tenants/comandi";
import { SLUG_RE, TENANT_PREDEFINITO_ID } from "../tenants/costanti";
import { getTenantRepository, invitoValido, payloadSenzaSegreti } from "../tenants/repository";
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
  return senzaSegreti(subito ? await eseguiComandoSubito(c.id) : c);
}

/**
 * Il payload di un comando `crea` porta `proprietario.passwordHash` finché il
 * comando non si chiude (il repository lo toglie alla chiusura): se
 * `eseguiComandoSubito` esaurisce i suoi 10 s, o se il comando resta in coda,
 * quell'hash uscirebbe verso il browser. Ogni comando che il pannello
 * restituisce passa di qui.
 */
function senzaSegreti(comando: TenantComando): TenantComando {
  return { ...comando, payload: payloadSenzaSegreti(comando.payload) };
}

/**
 * Un hash che nessuno conosce e nessuno può usare per accedere: la password
 * vera del proprietario arriva solo con l'invito (spec §5.2), mai da `crea`.
 */
const passwordInutilizzabile = () => hashPassword(randomBytes(32).toString("base64url"));

/** L'invito come esce verso il browser: il `link` c'è solo quando serve (R9). */
type EsitoInvitoPubblico = {
  invito: Awaited<ReturnType<typeof invitaProprietario>>["invito"];
  inviato: boolean;
  /** La base da cui è composto il link (I5): il pannello la mostra sotto al link. */
  baseUrl: string;
  motivo?: string;
  link?: string;
};

/**
 * R9 (revisione finale del branch): un link d'invito vale la presa
 * dell'account del proprietario di un'altra azienda. Se la posta è partita
 * il token è già nella casella giusta e una seconda copia nel browser
 * dell'amministratore sarebbe solo un'altra copia da rubare (cronologia,
 * screenshot, appunti); se la posta NON è partita quel link è l'unica copia
 * che esiste e va consegnato a mano, quindi esce. La regola vale sia per
 * `invita` sia per l'invito che `crea` manda da sé.
 */
function esitoPubblico(esito: Awaited<ReturnType<typeof invitaProprietario>>): EsitoInvitoPubblico {
  const { link, ...resto } = esito;
  return esito.inviato ? resto : { ...resto, link };
}

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
    .query(async ({ input }) => {
      const comando = await getTenantRepository().comando(input.id);
      return comando && senzaSegreti(comando);
    }),

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
      return { comando, omaggio, invito: esitoPubblico(invito) };
    }),

  /**
   * Ragione sociale, slug, note, dati di fatturazione, prima sede
   * («Modifica azienda», piano 09/09/2026, Task 3). `slug` individua
   * l'azienda; `nuovoSlug`, se presente e diverso, la sposta di indirizzo —
   * il tenant 1 non si tocca: il servizio rifiuta con
   * `tenant1SlugIntoccabile` e qui arriva come un comando in errore, non
   * diversamente da come le altre mutation mostrano un rifiuto del dominio.
   * La risposta porta lo slug FINALE: quello nuovo se il cambio è riuscito,
   * altrimenti quello di partenza, così il chiamante sa sempre su quale
   * scheda restare (e il client naviga solo se davvero è cambiato).
   *
   * Task 3 fix round 1: «quello di partenza» copre DUE casi, non uno solo.
   * Il primo è il rifiuto del dominio (`comando.stato === "errore"`, es.
   * tenant 1). Il secondo è meno ovvio: `subito: true` fa aspettare
   * `eseguiComandoSubito`, che ha un suo timeout — se il lock del giro dei
   * 30s non si libera in tempo il comando resta `in_attesa` quando la
   * risposta parte, `esito` è `null` e lo slug tornato è quello VECCHIO
   * anche se il cambio potrebbe ancora succedere poco dopo, quando il giro
   * dei 30s riprende quel comando. La risposta non lo sa: un chiamante che
   * deve esserne sicuro rilegge `comando({id: comando.id})`.
   */
  modifica: piattaformaProcedure
    .input(
      conPassword({
        ...schemaPayloadModificaTenant.omit({ slug: true }).shape,
        slug: slugInput,
      })
    )
    .mutation(async ({ input, ctx }) => {
      assicuraScrivibile();
      confermaPassword(ctx.user as any, input.passwordConferma);
      const t = tenantDaSlug(input.slug);
      const { passwordConferma: _passwordConferma, ...payload } = input;
      const comando = await accodaEdEsegui(
        ctx,
        "modifica_tenant",
        t.id,
        schemaPayloadModificaTenant.parse(payload),
        true
      );
      const esito = comando.stato === "eseguito" ? (comando.esito as { tenantId: number; slug: string }) : null;
      return { comando, slug: esito?.slug ?? input.slug };
    }),

  /**
   * Nome, cognome, email, telefono del proprietario. Se l'email cambia e
   * l'azienda ha per lui un invito ancora valido (non accettato), quel link
   * punta a un indirizzo che non è più il suo: si annulla e se ne emette uno
   * nuovo verso il nuovo indirizzo, come `invita` (R9: il link esce solo se
   * la posta non è partita). Un proprietario che ha già accettato il suo
   * invito non ne ha uno da rinnovare: cambiargli l'email non manda nulla.
   */
  modificaProprietario: piattaformaProcedure
    .input(
      conPassword({
        ...schemaPayloadModificaProprietario.omit({ slug: true }).shape,
        slug: slugInput,
      })
    )
    .mutation(async ({ input, ctx }) => {
      assicuraScrivibile();
      confermaPassword(ctx.user as any, input.passwordConferma);
      const t = tenantDaSlug(input.slug);
      const { passwordConferma: _passwordConferma, ...payload } = input;
      const comando = await accodaEdEsegui(
        ctx,
        "modifica_proprietario",
        t.id,
        schemaPayloadModificaProprietario.parse(payload),
        true
      );
      if (comando.stato !== "eseguito") return { comando, invito: null };
      const esito = comando.esito as { tenantId: number; utenteId: number; emailCambiata: boolean };
      if (!esito.emailCambiata) return { comando, invito: null };

      const repo = getTenantRepository();
      const adesso = new Date();
      const inviti = await repo.invitiDi(t.id);
      const pendente = inviti.find(i => i.utenteId === esito.utenteId && invitoValido(i, adesso));
      if (!pendente) return { comando, invito: null };

      // Fix round 1 (Task 3, revisione): `annullaInvito` torna `null` se fra
      // la lettura di `inviti` qui sopra e questa chiamata qualcun altro lo
      // ha già consumato (accettato) — una corsa vera, non solo teorica: lo
      // stesso invito potrebbe essere aperto in una scheda dell'invito nello
      // stesso istante. In quel caso non c'è nulla da annullare né da
      // rimpiazzare: niente evento `invito_annullato` per un invito che non
      // è stato toccato, niente reinvio sopra un accettato.
      const annullato = await repo.annullaInvito(pendente.id);
      if (!annullato) return { comando, invito: null };
      await repo.registraEvento({
        tenantId: t.id,
        tipo: "invito_annullato",
        attore: `piattaforma:${ctx.amministratore.email}`,
        dettagli: { invitoId: annullato.id },
      });
      const invito = await invitaProprietario({
        tenantId: t.id,
        utenteId: esito.utenteId,
        attore: { tipo: "piattaforma", email: ctx.amministratore.email },
        adesso,
        baseUrl: baseUrlDa(ctx.req),
      });
      return { comando, invito: esitoPubblico(invito) };
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
   *
   * Sensibile (R9): emettere un invito significa aprire la porta di un'altra
   * azienda a chi riceve il link, quindi chiede `passwordConferma` come le
   * altre azioni sensibili (spec §3.2) — la conferma viene PRIMA di emettere
   * qualunque token.
   */
  invita: piattaformaProcedure
    .input(conPassword({ slug: slugInput, email: z.string().trim().email().optional() }))
    .mutation(async ({ input, ctx }) => {
      assicuraScrivibile();
      confermaPassword(ctx.user as any, input.passwordConferma);
      const t = tenantDaSlug(input.slug);
      try {
        return esitoPubblico(
          await invitaProprietario({
            tenantId: t.id,
            email: input.email,
            attore: { tipo: "piattaforma", email: ctx.amministratore.email },
            adesso: new Date(),
            baseUrl: baseUrlDa(ctx.req),
          })
        );
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
