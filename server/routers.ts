import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { commesseRouter } from "./routers/commesse";
import { apertureRouter } from "./routers/aperture";
import { interventiRouter } from "./routers/interventi";
import { anomalieRouter } from "./routers/anomalie";
import { ticketRouter } from "./routers/ticket";
import { ticketAllegatiRouter } from "./routers/ticketAllegati";
import { squadreRouter } from "./routers/squadre";
import { garanzieRouter } from "./routers/garanzie";
import { verbaliRouter } from "./routers/verbali";
import { clientiRouter } from "./routers/clienti";
import { fornitoriRouter } from "./routers/fornitori";
import { produzioneRouter } from "./routers/produzione";
import { timelineRouter } from "./routers/timeline";
import { reclamiRifacimentiRouter } from "./routers/reclamiRifacimenti";
import { utentiRouter, getUtentiStore } from "./routers/utenti";
import { preventiviContrattiRouter } from "./routers/preventiviContratti";
import { notificheRouter } from "./routers/notifiche";
import { createLocalToken, type LocalUser } from "./localAuth";
import { TRPCError } from "@trpc/server";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    login: publicProcedure
      .input(
        z.object({
          email: z.string().email(),
          password: z.string().min(1),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const utenti = getUtentiStore();
        const utente = utenti.find(
          (u: any) =>
            u.email.toLowerCase() === input.email.toLowerCase() && u.attivo
        );
        if (!utente) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Email o password non validi",
          });
        }
        // Check stored password (exact match, case-sensitive)
        if (utente.password !== input.password) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Email o password non validi",
          });
        }

        const ruoli: string[] = Array.isArray(utente.ruoli) && utente.ruoli.length > 0
          ? utente.ruoli
          : [utente.ruolo ?? "direzione"];
        const primaryRuolo = ruoli[0];
        const localUser: LocalUser = {
          id: utente.id,
          openId: `local-${utente.id}`,
          name: `${utente.nome} ${utente.cognome}`,
          email: utente.email,
          loginMethod: "local",
          role: ruoli.includes("direzione") ? "admin" : "user",
          ruolo: primaryRuolo,
          ruoli,
          createdAt: utente.createdAt,
          updatedAt: utente.updatedAt,
          lastSignedIn: new Date(),
        };

        const token = await createLocalToken(localUser);
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, token, {
          ...cookieOptions,
          maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        });

        return localUser;
      }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  commesse: commesseRouter,
  aperture: apertureRouter,
  interventi: interventiRouter,
  anomalie: anomalieRouter,
  ticket: ticketRouter,
  ticketAllegati: ticketAllegatiRouter,
  squadre: squadreRouter,
  garanzie: garanzieRouter,
  verbali: verbaliRouter,
  clienti: clientiRouter,
  fornitori: fornitoriRouter,
  produzione: produzioneRouter,
  timeline: timelineRouter,
  reclamiRifacimenti: reclamiRifacimentiRouter,
  utenti: utentiRouter,
  preventiviContratti: preventiviContrattiRouter,
  notifiche: notificheRouter,
});

export type AppRouter = typeof appRouter;
