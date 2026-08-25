import { TRPCError } from "@trpc/server";
import { getUtentiStore } from "../routers/utenti";
import type { Capability } from "./capabilities";
import { can } from "./policy";

export function requireAssignableUser(input: {
  assigneeUserId: number | null;
  sedeId: number;
  requiredCapability?: Capability;
}): void {
  if (input.assigneeUserId == null) return;
  const user = getUtentiStore().find(candidate => candidate.id === input.assigneeUserId);
  if (!user || !Array.isArray(user.sediIds) || !user.sediIds.includes(input.sedeId)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Assegnatario non trovato." });
  }
  if (!user.attivo) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "L'assegnatario non e attivo." });
  }
  if (input.requiredCapability) {
    const decision = can({
      user,
      capability: input.requiredCapability,
      activeSedeId: input.sedeId,
    });
    if (!decision.allowed) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "L'assegnatario non ha un profilo compatibile con l'attivita.",
      });
    }
  }
}
