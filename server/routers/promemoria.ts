import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { TrpcContext } from "../_core/context";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getReminderService,
  ReminderNotFoundError,
} from "../reminders/service";

const idInput = z.object({ id: z.number().int().positive() });

const snoozeInput = z.discriminatedUnion("kind", [
  z.object({
    id: z.number().int().positive(),
    kind: z.literal("preset"),
    preset: z.enum(["15m", "1h", "tomorrow_9"]),
  }),
  z.object({
    id: z.number().int().positive(),
    kind: z.literal("custom"),
    localDateTime: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  }),
]);

function personalScope(ctx: TrpcContext) {
  const sedeId = Number(ctx.sedeId);
  const recipientUserId = Number(ctx.user?.id);
  if (
    !Number.isInteger(sedeId) ||
    sedeId <= 0 ||
    !Number.isInteger(recipientUserId) ||
    recipientUserId <= 0
  ) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Sessione non valida.",
    });
  }
  return { sedeId, recipientUserId };
}

const DATE_ERROR_MESSAGES = new Set([
  "REMINDER_TIME_OFFSET_REQUIRED",
  "REMINDER_TIME_INVALID",
  "REMINDER_LOCAL_TIME_INVALID",
  "REMINDER_LOCAL_TIME_AMBIGUOUS",
]);

async function runPersonal<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ReminderNotFoundError) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Promemoria non trovato.",
      });
    }
    if (error instanceof Error && error.message === "REMINDER_TIME_NOT_FUTURE") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Scegli una data e ora future.",
      });
    }
    if (error instanceof Error && DATE_ERROR_MESSAGES.has(error.message)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Data o ora del promemoria non valida.",
      });
    }
    throw error;
  }
}

export const promemoriaRouter = router({
  due: protectedProcedure.query(async ({ ctx }) => ({
    items: await getReminderService().listPopupDue(personalScope(ctx)),
  })),

  dismissPopup: protectedProcedure
    .input(idInput)
    .mutation(({ input, ctx }) =>
      runPersonal(() =>
        getReminderService().dismissPopup({
          ...personalScope(ctx),
          id: input.id,
        }),
      ),
    ),

  complete: protectedProcedure.input(idInput).mutation(({ input, ctx }) =>
    runPersonal(() =>
      getReminderService().complete({
        ...personalScope(ctx),
        id: input.id,
      }),
    ),
  ),

  snooze: protectedProcedure.input(snoozeInput).mutation(({ input, ctx }) =>
    runPersonal(() =>
      getReminderService().snooze({
        ...personalScope(ctx),
        ...input,
      }),
    ),
  ),

  cancel: protectedProcedure.input(idInput).mutation(({ input, ctx }) =>
    runPersonal(() =>
      getReminderService().cancel({
        ...personalScope(ctx),
        id: input.id,
      }),
    ),
  ),
});
