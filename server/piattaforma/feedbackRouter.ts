// server/piattaforma/feedbackRouter.ts
// Il router del bottone «Segnala un problema» (PRD §60.16), montato come
// `feedback`. Un solo endpoint: la segnalazione parte, diventa una mail e
// finisce lì.
//
// `sessionProcedure`, NON `protectedProcedure`: la `guardiaTenant` rifiuta
// le mutation di un'azienda sospesa o in sola lettura, e un'azienda bloccata
// è precisamente quella che ha più bisogno di scrivere a supporto. Qui non
// si tocca nessuno store di dominio, quindi non serve il contesto tenant:
// azienda e sede si leggono dal contesto della richiesta, come fa già
// `tenants.mio`.
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { creaLimiteTentativi } from "../_core/limiteTentativi";
import { UNAUTHED_ERR_MSG } from "@shared/const";
import { router, sessionProcedure } from "../_core/trpc";
import { getSedeById } from "../routers/sedi";
import { TENANT_PREDEFINITO_ID, TENANT_PREDEFINITO_NOME } from "../tenants/costanti";
import { ruoliDi } from "../tenants/regole";
import { getTenantRepository } from "../tenants/repository";
import { MESSAGGI_FEEDBACK } from "./costanti";
import { IMMAGINE_MAX_BYTE, TIPI_FEEDBACK, inviaFeedback } from "./feedback";
import { baseUrlDa } from "./inviti";

// Cinque all'ora per persona: abbastanza per raccontare tre bug di fila in
// una mattinata storta, non abbastanza perché una pagina impazzita riempia
// la casella di supporto.
const limiteFeedback = creaLimiteTentativi({
  finestraMs: 60 * 60 * 1000,
  massimo: 5,
  messaggio: MESSAGGI_FEEDBACK.troppiInvii,
});

/** Solo per i test: azzera il limitatore delle segnalazioni. */
export function __azzeraLimiteFeedbackPerTest(): void {
  if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY");
  limiteFeedback.__azzeraTutto();
}

// La base64 di 2 MB sta in ~2,8 MB di caratteri: il tetto sulla stringa
// ferma il messaggio enorme prima che zod lo copi, il conto dei byte veri lo
// fa `assicuraImmagineValida`.
const BASE64_MAX_CARATTERI = Math.ceil((IMMAGINE_MAX_BYTE / 3) * 4) + 1024;

export const feedbackRouter = router({
  invia: sessionProcedure
    .input(
      z.object({
        tipo: z.enum(TIPI_FEEDBACK),
        testo: z.string().trim().min(10).max(4000),
        /** Il percorso da cui è partita: lo ripulisce `paginaSicura`. */
        pagina: z.string().max(300).nullable().optional(),
        immagine: z
          .object({
            nome: z.string().trim().min(1).max(120),
            tipo: z.string().trim().max(60),
            contenutoBase64: z.string().max(BASE64_MAX_CARATTERI),
          })
          .nullable()
          .optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const utente = ctx.user;
      if (!utente) throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });

      const chiave = `feedback:${utente.id}`;
      limiteFeedback.verifica(chiave);
      // Ogni invio consuma un colpo: qui non esiste un «tentativo riuscito»
      // che azzera il contatore.
      limiteFeedback.fallito(chiave);

      const email = (utente as { email?: string | null }).email?.trim();
      if (!email) {
        // Senza indirizzo la mail partirebbe senza un `reply_to` valido:
        // supporto risponderebbe nel vuoto. Meglio dirlo subito.
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: MESSAGGI_FEEDBACK.nonRiuscito,
        });
      }

      const tenantId = ctx.tenantId ?? TENANT_PREDEFINITO_ID;
      const tenant = ctx.tenant ?? getTenantRepository().perId(tenantId);
      const sede = ctx.sedeId != null ? getSedeById(ctx.sedeId) : null;
      const nome =
        (utente as { nome?: string | null }).nome?.trim() ||
        (utente as { name?: string | null }).name?.trim() ||
        email;

      await inviaFeedback({
        tipo: input.tipo,
        testo: input.testo,
        immagine: input.immagine ?? null,
        contesto: {
          azienda: {
            id: tenantId,
            nome: tenant?.nome ?? TENANT_PREDEFINITO_NOME,
            stato: tenant?.stato ?? "attivo",
          },
          sede: sede?.nome ?? null,
          utente: { nome, email, ruoli: ruoliDi(utente as any) },
          pagina: input.pagina ?? null,
          browser: ctx.req.get?.("user-agent")?.slice(0, 200) ?? null,
          baseUrl: baseUrlDa(ctx.req),
        },
      });

      return { ok: true as const };
    }),
});
