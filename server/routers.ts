import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { creaLimiteTentativi } from "./_core/limiteTentativi";
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
import { promemoriaRouter } from "./routers/promemoria";
import { sediRouter } from "./routers/sedi";
import { calendarSyncRouter } from "./routers/calendarSync";
import { externalCalendarsRouter } from "./routers/externalCalendars";
import { backupRouter } from "./routers/backup";
import { magazzinoRouter } from "./routers/magazzino";
import { fattureInCloudRouter } from "./routers/fattureInCloud";
import { fileStorageAdminRouter } from "./routers/fileStorageAdmin";
import { conoscenzaRouter } from "./routers/conoscenza";
import { platformRouter } from "./routers/platform";
import { mailRouter } from "./routers/mail";
import { ficFattureRouter } from "./routers/ficFatture";
import { ficCostiRouter } from "./routers/ficCosti";
import { costiFissiRouter } from "./routers/costiFissi";
import { economiaRouter } from "./routers/economia";
import { diagnosticaRouter } from "./routers/diagnostica";
import { chatRouter } from "./routers/chat";
import { analisiDocumentiRouter } from "./routers/analisiDocumenti";
import { contrattiRouter } from "./routers/contratti";
import { estrazioniContrattoRouter } from "./routers/estrazioniContratto";
import { computoRouter } from "./routers/computo";
import { tariffeRouter } from "./routers/tariffe";
import { fattureRouter } from "./routers/fatture";
import { fatturazioneConfigRouter } from "./routers/fatturazioneConfig";
import { fatturazioneGuidataRouter } from "./routers/fatturazioneGuidata";
import { proposteRouter } from "./routers/proposte";
import { tarsRouter } from "./routers/tars";
import { tenantsRouter } from "./tenants/router";
import { apriSessioneLocale, clearLocalSessionFromRequest } from "./localAuth";
import { verifyPassword } from "./_core/password";
import { TRPCError } from "@trpc/server";

// ── Login rate limiting ──────────────────────────────────────────────────
// In-memory per-email throttle: after 5 failed attempts inside 15 minutes
// the account is locked until the window expires. Blunts brute-force /
// credential-stuffing. A successful login clears the counter. Keyed by
// lowercased email so a targeted account stays protected even if the
// attacker rotates IP addresses. Estratto in server/_core/limiteTentativi.ts
// (WS6 §3.2): la conferma password del pannello piattaforma riusa la stessa
// logica, con la propria chiave.
const limiteLogin = creaLimiteTentativi({
  finestraMs: 15 * 60 * 1000,
  massimo: 5,
  messaggio: "Troppi tentativi di accesso. Riprova tra qualche minuto.",
});

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
        limiteLogin.verifica(input.email);
        const utenti = getUtentiStore();
        const utente = utenti.find(
          (u: any) =>
            u.email.toLowerCase() === input.email.toLowerCase() && u.attivo
        );
        if (!utente) {
          limiteLogin.fallito(input.email);
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Email o password non validi",
          });
        }
        // Verify against the scrypt hash (verifyPassword also tolerates a
        // legacy plaintext value, though the utenti store upgrades those to
        // hashes on load).
        if (!verifyPassword(input.password, utente.password)) {
          limiteLogin.fallito(input.email);
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Email o password non validi",
          });
        }
        // Success — reset the failure counter for this account.
        limiteLogin.azzera(input.email);

        return apriSessioneLocale(ctx, utente);
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
  promemoria: promemoriaRouter,
  sedi: sediRouter,
  calendarSync: calendarSyncRouter,
  externalCalendars: externalCalendarsRouter,
  backup: backupRouter,
  magazzino: magazzinoRouter,
  fattureInCloud: fattureInCloudRouter,
  fileStorage: fileStorageAdminRouter,
  conoscenza: conoscenzaRouter,
  platform: platformRouter,
  tenants: tenantsRouter,
  mail: mailRouter,
  ficFatture: ficFattureRouter,
  ficCosti: ficCostiRouter,
  costiFissi: costiFissiRouter,
  economia: economiaRouter,
  diagnostica: diagnosticaRouter,
  chat: chatRouter,
  analisiDocumenti: analisiDocumentiRouter,
  contratti: contrattiRouter,
  estrazioniContratto: estrazioniContrattoRouter,
  computo: computoRouter,
  tariffe: tariffeRouter,
  fatture: fattureRouter,
  fatturazioneConfig: fatturazioneConfigRouter,
  fatturazioneGuidata: fatturazioneGuidataRouter,
  proposte: proposteRouter,
  tars: tarsRouter,
});

export type AppRouter = typeof appRouter;
