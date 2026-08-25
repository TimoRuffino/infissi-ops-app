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
import { permessiRouter } from "./routers/permessi";
import { preventiviContrattiRouter } from "./routers/preventiviContratti";
import { notificheRouter } from "./routers/notifiche";
import { sediRouter } from "./routers/sedi";
import { calendarSyncRouter } from "./routers/calendarSync";
import { externalCalendarsRouter } from "./routers/externalCalendars";
import { backupRouter } from "./routers/backup";
import { magazzinoRouter } from "./routers/magazzino";
import { fattureInCloudRouter } from "./routers/fattureInCloud";
import { fileStorageAdminRouter } from "./routers/fileStorageAdmin";
import { tarsRouter } from "./routers/tars";
import { mailRouter } from "./routers/mail";
import { ficFattureRouter } from "./routers/ficFatture";
import { economiaRouter } from "./routers/economia";
import { diagnosticaRouter } from "./routers/diagnostica";
import {
  createLocalToken,
  clearLocalSessionFromRequest,
  type LocalUser,
} from "./localAuth";
import { verifyPassword } from "./_core/password";
import { TRPCError } from "@trpc/server";

// ── Login rate limiting ──────────────────────────────────────────────────
// In-memory per-email throttle: after MAX_LOGIN_ATTEMPTS failed attempts
// inside LOGIN_WINDOW_MS the account is locked until the window expires.
// Blunts brute-force / credential-stuffing. A successful login clears the
// counter. Keyed by lowercased email so a targeted account stays protected
// even if the attacker rotates IP addresses.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const loginAttempts = new Map<string, { count: number; firstAt: number }>();

function checkLoginRateLimit(email: string): void {
  const key = email.toLowerCase();
  const rec = loginAttempts.get(key);
  if (!rec) return;
  if (Date.now() - rec.firstAt > LOGIN_WINDOW_MS) {
    loginAttempts.delete(key);
    return;
  }
  if (rec.count >= MAX_LOGIN_ATTEMPTS) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Troppi tentativi di accesso. Riprova tra qualche minuto.",
    });
  }
}

function recordLoginFailure(email: string): void {
  const key = email.toLowerCase();
  const rec = loginAttempts.get(key);
  if (!rec || Date.now() - rec.firstAt > LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, firstAt: Date.now() });
  } else {
    rec.count++;
  }
}

function clearLoginAttempts(email: string): void {
  loginAttempts.delete(email.toLowerCase());
}

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
        // Block before doing any work if the account is rate-limited.
        checkLoginRateLimit(input.email);
        const utenti = getUtentiStore();
        const utente = utenti.find(
          (u: any) =>
            u.email.toLowerCase() === input.email.toLowerCase() && u.attivo
        );
        if (!utente) {
          recordLoginFailure(input.email);
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Email o password non validi",
          });
        }
        // Verify against the scrypt hash (verifyPassword also tolerates a
        // legacy plaintext value, though the utenti store upgrades those to
        // hashes on load).
        if (!verifyPassword(input.password, utente.password)) {
          recordLoginFailure(input.email);
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Email o password non validi",
          });
        }
        // Success — reset the failure counter for this account.
        clearLoginAttempts(input.email);

        const ruoli: string[] =
          Array.isArray(utente.ruoli) && utente.ruoli.length > 0
            ? utente.ruoli
            : [utente.ruolo ?? "direzione"];
        const primaryRuolo = ruoli[0];
        const localUser: LocalUser = {
          id: utente.id,
          openId: `local-${utente.id}`,
          name: `${utente.cognome} ${utente.nome}`.trim(),
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
      // Invalidate the server-side session cache entry too — not just the
      // cookie — so a captured token can't be replayed after logout.
      clearLocalSessionFromRequest(ctx.req);
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
  permessi: permessiRouter,
  preventiviContratti: preventiviContrattiRouter,
  notifiche: notificheRouter,
  sedi: sediRouter,
  calendarSync: calendarSyncRouter,
  externalCalendars: externalCalendarsRouter,
  backup: backupRouter,
  magazzino: magazzinoRouter,
  fattureInCloud: fattureInCloudRouter,
  fileStorage: fileStorageAdminRouter,
  tars: tarsRouter,
  mail: mailRouter,
  ficFatture: ficFattureRouter,
  economia: economiaRouter,
  diagnostica: diagnosticaRouter,
});

export type AppRouter = typeof appRouter;
