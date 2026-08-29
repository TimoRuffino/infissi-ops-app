import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import {
  assicuraInterruttore,
  type Interruttore,
} from "../platform/interruttori";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

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

export const protectedProcedure = t.procedure.use(requireUser);

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

export const adminProcedure = t.procedure.use(
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
