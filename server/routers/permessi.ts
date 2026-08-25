import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { requireDirezione } from "../_core/permissions";
import {
  CAPABILITIES,
  capabilitiesForRoles,
  type Capability,
} from "../authz/capabilities";
import { can } from "../authz/policy";
import {
  assertAdministrativeContinuity,
  getPolicyRepository,
} from "../authz/repository";
import { getUtentiStore } from "./utenti";

const capabilitySchema = z.enum(CAPABILITIES);
const reasonSchema = z
  .string()
  .trim()
  .min(10, "Spiega il motivo in almeno 10 caratteri.")
  .max(500, "Il motivo non puo superare 500 caratteri.");

function directionContext(ctx: any) {
  requireDirezione(ctx.user);
  if (ctx.sedeId == null || ctx.user?.id == null) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Sessione non valida.",
    });
  }
  return { sedeId: ctx.sedeId as number, actorUserId: Number(ctx.user.id) };
}

function rolesFor(user: any): string[] {
  if (Array.isArray(user.ruoli) && user.ruoli.length > 0) return user.ruoli;
  return user.ruolo ? [user.ruolo] : [];
}

function findUserInSede(userId: number, sedeId: number) {
  const user = getUtentiStore().find(
    candidate =>
      candidate.id === userId &&
      Array.isArray(candidate.sediIds) &&
      candidate.sediIds.includes(sedeId)
  );
  if (!user) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Utente non trovato." });
  }
  return user;
}

function publicUser(user: any) {
  const { password, ...safe } = user;
  return safe;
}

async function revokeActiveOverrides(input: {
  sedeId: number;
  userId: number;
  capability: Capability;
  actorUserId: number;
  reason: string;
  now: Date;
}) {
  const repository = getPolicyRepository();
  const records = await repository.listOverrides({
    sedeId: input.sedeId,
    userId: input.userId,
  });
  for (const record of records) {
    if (record.capability !== input.capability || record.revokedAt != null)
      continue;
    const revoked = await repository.revokeOverride({
      id: record.id,
      sedeId: input.sedeId,
      revokedBy: input.actorUserId,
      reason: input.reason,
      revokedAt: input.now,
    });
    if (revoked) {
      await repository.recordPolicyChange({
        sedeId: input.sedeId,
        actorUserId: input.actorUserId,
        targetUserId: input.userId,
        action: "override_revoked",
        capability: input.capability,
        reason: input.reason,
        createdAt: input.now,
      });
    }
  }
}

export const permessiRouter = router({
  preview: protectedProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ input, ctx }) => {
      const { sedeId } = directionContext(ctx);
      const user = findUserInSede(input.userId, sedeId);
      const repository = getPolicyRepository();
      const now = new Date();
      const [overrides, delegations, effectiveOverrides] = await Promise.all([
        repository.listOverrides({ sedeId, userId: user.id }),
        repository.listDelegations({ sedeId, userId: user.id }),
        repository.listEffectiveOverrides({ sedeId, userId: user.id, now }),
      ]);
      const inherited = capabilitiesForRoles(rolesFor(user));

      return {
        user: publicUser(user),
        inherited: Array.from(inherited),
        overrides,
        delegations,
        capabilities: CAPABILITIES.map(capability => {
          const active = effectiveOverrides.filter(
            item => item.capability === capability
          );
          const decision = can({
            user,
            capability,
            activeSedeId: sedeId,
            overrides: effectiveOverrides,
            now,
          });
          const direct = active.find(item => item.source === "override");
          const delegated = active.find(item => item.source === "delegation");
          return {
            capability,
            inherited: inherited.has(capability),
            effective: decision.allowed,
            effect: decision.effect,
            source: direct ? "override" : delegated ? "delegation" : "role",
            reason: decision.reason,
          } as const;
        }),
      };
    }),

  updateOverride: protectedProcedure
    .input(
      z.object({
        userId: z.number(),
        capability: capabilitySchema,
        effect: z.enum(["allow", "deny", "inherit"]),
        reason: reasonSchema,
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { sedeId, actorUserId } = directionContext(ctx);
      const user = findUserInSede(input.userId, sedeId);
      const now = new Date();
      if (input.effect === "deny") {
        try {
          assertAdministrativeContinuity({
            sedeId,
            users: getUtentiStore().map(candidate => ({
              id: candidate.id,
              attivo: Boolean(candidate.attivo),
              ruoli: rolesFor(candidate),
              sediIds: Array.isArray(candidate.sediIds)
                ? candidate.sediIds
                : [],
            })),
            targetUserId: user.id,
            capability: input.capability,
            effect: input.effect,
          });
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              error instanceof Error
                ? error.message
                : "Modifica non consentita.",
          });
        }
      }

      await revokeActiveOverrides({
        sedeId,
        userId: user.id,
        capability: input.capability,
        actorUserId,
        reason: input.reason,
        now,
      });
      if (input.effect === "inherit") return { success: true, override: null };

      const repository = getPolicyRepository();
      const override = await repository.createOverride({
        sedeId,
        userId: user.id,
        capability: input.capability,
        effect: input.effect,
        reason: input.reason,
        createdBy: actorUserId,
        startsAt: null,
        expiresAt: null,
        createdAt: now,
      });
      await repository.recordPolicyChange({
        sedeId,
        actorUserId,
        targetUserId: user.id,
        action: "override_created",
        capability: input.capability,
        reason: input.reason,
        createdAt: now,
      });
      return { success: true, override };
    }),

  createDelegation: protectedProcedure
    .input(
      z.object({
        delegatorUserId: z.number(),
        delegateUserId: z.number(),
        capability: capabilitySchema,
        startsAt: z.coerce.date(),
        expiresAt: z.coerce.date(),
        reason: reasonSchema,
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { sedeId, actorUserId } = directionContext(ctx);
      if (input.delegateUserId === input.delegatorUserId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Scegli due utenti diversi.",
        });
      }
      if (input.expiresAt <= input.startsAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La scadenza deve essere successiva all'inizio.",
        });
      }
      const delegator = findUserInSede(input.delegatorUserId, sedeId);
      const delegate = findUserInSede(input.delegateUserId, sedeId);
      if (!delegator.attivo || !delegate.attivo) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La delega richiede utenti attivi.",
        });
      }
      const repository = getPolicyRepository();
      const delegatorOverrides = await repository.listEffectiveOverrides({
        sedeId,
        userId: delegator.id,
        now: input.startsAt,
      });
      const decision = can({
        user: delegator,
        capability: input.capability,
        activeSedeId: sedeId,
        overrides: delegatorOverrides,
        now: input.startsAt,
      });
      if (!decision.allowed) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Il delegante non possiede questa capacita.",
        });
      }

      const now = new Date();
      const delegation = await repository.createDelegation({
        sedeId,
        delegatorUserId: delegator.id,
        delegateUserId: delegate.id,
        capability: input.capability,
        reason: input.reason,
        startsAt: input.startsAt,
        expiresAt: input.expiresAt,
        createdAt: now,
      });
      await repository.recordPolicyChange({
        sedeId,
        actorUserId,
        targetUserId: delegate.id,
        action: "delegation_created",
        capability: input.capability,
        reason: input.reason,
        createdAt: now,
      });
      return delegation;
    }),

  revokeDelegation: protectedProcedure
    .input(
      z.object({ id: z.number(), userId: z.number(), reason: reasonSchema })
    )
    .mutation(async ({ input, ctx }) => {
      const { sedeId, actorUserId } = directionContext(ctx);
      findUserInSede(input.userId, sedeId);
      const repository = getPolicyRepository();
      const records = await repository.listDelegations({
        sedeId,
        userId: input.userId,
      });
      const delegation = records.find(
        item => item.id === input.id && item.revokedAt == null
      );
      if (!delegation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Delega non trovata.",
        });
      }
      const now = new Date();
      const revoked = await repository.revokeDelegation({
        id: delegation.id,
        sedeId,
        revokedBy: actorUserId,
        reason: input.reason,
        revokedAt: now,
      });
      if (!revoked) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Delega non trovata.",
        });
      }
      await repository.recordPolicyChange({
        sedeId,
        actorUserId,
        targetUserId: input.userId,
        action: "delegation_revoked",
        capability: delegation.capability,
        reason: input.reason,
        createdAt: now,
      });
      return { success: true };
    }),

  auditSummary: protectedProcedure
    .input(
      z.object({
        userId: z.number().optional(),
        days: z.number().int().min(1).max(90).default(30),
      })
    )
    .query(async ({ input, ctx }) => {
      const { sedeId } = directionContext(ctx);
      if (input.userId != null) findUserInSede(input.userId, sedeId);
      const repository = getPolicyRepository();
      const [changes, diffs] = await Promise.all([
        repository.listPolicyChanges({ sedeId, userId: input.userId }),
        repository.listAuditDiffs({ sedeId, days: input.days }),
      ]);
      return {
        days: input.days,
        changes,
        diffs,
        totals: {
          changes: changes.length,
          comparisons: diffs.length,
          disagreements: diffs.filter(
            item => item.legacyAllowed !== item.proposedAllowed
          ).length,
        },
      };
    }),
});
