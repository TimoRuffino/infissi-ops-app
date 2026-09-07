// Contesto del run (T1): principal, tenant, sede, capability effettive e il
// loro fingerprint (entra nelle chiavi di cache C0/C1/C2: due utenti con
// perimetri diversi non condividono MAI una riga di cache).

import { createHash } from "node:crypto";
import type { TrpcContext } from "../_core/context";
import { CAPABILITIES } from "../authz/capabilities";
import { effectiveCapabilitySet } from "../authz/enforcement";
import type { ContestoRun } from "./strumenti/tipi";

function ruoliDi(user: any): string[] {
  if (Array.isArray(user?.ruoli) && user.ruoli.length) return user.ruoli;
  if (user?.ruolo) return [user.ruolo];
  if (user?.role === "admin") return ["direzione"];
  return [];
}

export async function costruisciContesto(
  ctx: Pick<TrpcContext, "user" | "sedeId" | "sediIds" | "tenantId">
): Promise<ContestoRun> {
  const utenteId = ctx.user?.id;
  if (utenteId == null) {
    throw new Error("UNAUTHORIZED: sessione non valida.");
  }
  // Niente fallback (WS1): una sessione senza azienda o senza sede non
  // costruisce un contesto, non ripiega sulla sede 1.
  if (ctx.tenantId == null) {
    throw new Error("UNAUTHORIZED: sessione senza azienda.");
  }
  if (ctx.sedeId == null) {
    throw new Error("UNAUTHORIZED: sessione senza sede.");
  }
  const tenantId = ctx.tenantId;
  const sedeId = ctx.sedeId;
  const capability = await effectiveCapabilitySet(ctx, CAPABILITIES);
  const ruoli = ruoliDi(ctx.user);
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        tenant: tenantId,
        sede: sedeId,
        ruoli: [...ruoli].sort(),
        capability: [...capability].sort(),
      })
    )
    .digest("hex")
    .slice(0, 16);
  return {
    utenteId,
    tenantId,
    sedeId,
    ruoli,
    direzione: ruoli.includes("direzione"),
    capability,
    capabilityFingerprint: fingerprint,
    lingua: "it",
    fuso: "Europe/Rome",
  };
}
