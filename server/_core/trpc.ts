import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import {
  assicuraInterruttore,
  type Interruttore,
} from "../platform/interruttori";
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

export const protectedProcedure = publicProcedure.use(requireUser);

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

export const adminProcedure = publicProcedure.use(
  t.middleware(async opts => {
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
  }),
);
