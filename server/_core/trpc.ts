import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import {
  assicuraInterruttore,
  interruttoreAttivo,
  type Interruttore,
} from "../platform/interruttori";
import { MESSAGGI } from "../tenants/costanti";
import { portaChiusaPerTenant } from "../tenants/regole";
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

// Guardie del tenant (WS1, spec §5.2). Solo con FLAG_MULTI_AZIENDA acceso:
//  - porta chiusa: finché il WS2 non rende tenant-aware gli archivi, ogni
//    tenant diverso dal predefinito viene rifiutato (`portaChiusaPerTenant`,
//    da togliere nel WS2 insieme al suo gemello nel login);
//  - sola lettura: le mutation di un tenant sospeso muoiono qui;
//    `sedi.switch` scrive solo un cookie ed è esente;
//  - sede attiva obbligatoria, quando il contesto viene da un tenant reale
//    (`ctx.tenant` non nullo: lo mette solo createContext).
const guardiaTenant = t.middleware(async ({ ctx, next, type, path }) => {
  if (interruttoreAttivo("multiAzienda")) {
    if (ctx.tenantId == null || portaChiusaPerTenant(ctx.tenantId)) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: MESSAGGI.portaChiusa });
    }
    if (ctx.tenant) {
      if (type === "mutation" && ctx.tenant.stato === "sospeso" && path !== "sedi.switch") {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: MESSAGGI.solaLettura });
      }
      if (ctx.sedeId == null) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: MESSAGGI.senzaSede });
      }
    }
  }
  return next();
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
