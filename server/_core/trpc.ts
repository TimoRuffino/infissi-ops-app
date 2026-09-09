import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { assicuraInterruttore, type Interruttore } from "../platform/interruttori";
import { MESSAGGI_PIATTAFORMA } from "../piattaforma/costanti";
import { TENANT_PREDEFINITO_ID } from "../tenants/costanti";
import { conTenant } from "../tenants/contestoCorrente";
import { motivoRifiutoTenant } from "../tenants/regole";
import type { TrpcContext } from "./context";
import { rigaProceduraLenta, vaSegnalata } from "./osservabilita";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;

// Quanto ha atteso chi ha chiamato. Sta sulla procedura base, quindi copre
// anche quelle pubbliche: se il ritardo è nell'autenticazione o nel contesto,
// deve comparire lo stesso. Scrive solo sopra la soglia — v. osservabilita.ts.
const cronometro = t.middleware(async ({ path, next }) => {
  const inizio = Date.now();
  const esito = await next();
  const durata = Date.now() - inizio;
  if (vaSegnalata(durata)) {
    console.warn(rigaProceduraLenta(path, durata, esito.ok ? "ok" : "errore"));
  }
  return esito;
});

export const publicProcedure = t.procedure.use(cronometro);

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

// Guardia unica del tenant (WS2, spec §5.2): `motivoRifiutoTenant` (pura,
// server/tenants/regole.ts) decide il rifiuto, questo middleware lo applica
// e mette il tenant nel contesto per tutta la procedura, così gli store lo
// leggono da lì invece che dai parametri. Solo con FLAG_MULTI_AZIENDA
// acceso: sola lettura (le mutation di un tenant sospeso muoiono qui;
// `sedi.switch` scrive solo un cookie ed è esente) e sede attiva
// obbligatoria, quando il contesto viene da un tenant reale (`ctx.tenant`
// non nullo: lo mette solo createContext).
const guardiaTenant = t.middleware(async ({ ctx, next, type, path }) => {
  const rifiuto = motivoRifiutoTenant(ctx, { scrittura: type === "mutation", esente: path === "sedi.switch" });
  if (rifiuto) throw new TRPCError({ code: rifiuto.codice, message: rifiuto.messaggio });
  // Il tenant nel contesto per tutta la procedura: gli store lo leggono da qui.
  return conTenant(ctx.tenantId ?? TENANT_PREDEFINITO_ID, () => next());
});

/** Autenticato, SENZA guardie tenant: solo `tenants.mio` e, domani, l'onboarding. */
export const sessionProcedure = publicProcedure.use(requireUser);

export const protectedProcedure = sessionProcedure.use(guardiaTenant);

// Release hardening: procedura protetta che verifica ANCHE un kill switch
// prima di qualunque lavoro. I router della Document Intelligence si
// costruiscono da qui, così un endpoint nuovo nasce già dietro il flag
// invece di dover ricordare la guardia a mano (revisione).
export const procedureConInterruttore = (nome: Interruttore) =>
  protectedProcedure.use(
    t.middleware(({ next }) => {
      assicuraInterruttore(nome);
      return next();
    })
  );

// Direzione (legacy `role: "admin"`), come oggi: FORBIDDEN anche per gli
// anonimi. Le guardie del tenant valgono anche qui.
const requireAdmin = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user || ctx.user.role !== 'admin') {
    throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const adminProcedure = publicProcedure.use(requireAdmin).use(guardiaTenant);

// WS6 §3.1: chi amministra la piattaforma (server/piattaforma/accesso.ts).
// Autenticato, ma SENZA guardiaTenant — l'amministratore agisce SU
// un'altra azienda, non dentro la propria, e deve poter riattivare anche il
// tenant 1 sospeso. Conseguenza per chi costruisce un router qui sopra:
// nessun contesto tenant implicito, ogni lettura di uno store per tenant va
// avvolta in `conTenant(tenantId, …)` esplicito.
//
// Import dinamico invece che in cima al file: `accesso.ts` importa
// `routers/utenti.ts`, che importa questo stesso modulo per `adminProcedure`
// e `protectedProcedure` — un import statico qui riaprirebbe il ciclo
// trpc.ts → accesso.ts → routers/utenti.ts → trpc.ts e farebbe crashare al
// semplice import qualunque entry point che carichi un router prima di
// questo file.
const requirePiattaforma = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  const { utenteAmministratore } = await import("../piattaforma/accesso");
  const record = utenteAmministratore(ctx.user as any);
  if (!record) throw new TRPCError({ code: "FORBIDDEN", message: MESSAGGI_PIATTAFORMA.nonAmministratore });
  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
      amministratore: { id: Number(record.id), email: String(record.email).toLowerCase() },
    },
  });
});
export const piattaformaProcedure = publicProcedure.use(requirePiattaforma);
