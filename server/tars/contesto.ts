// Contesto del run (T1): principal, sede, capability effettive e il loro
// fingerprint (entra nelle chiavi di cache C0/C1/C2: due utenti con
// perimetri diversi non condividono MAI una riga di cache).

import { createHash } from "node:crypto";
import type { TrpcContext } from "../_core/context";
import { CAPABILITIES } from "../authz/capabilities";
import { effectiveCapabilitySet } from "../authz/enforcement";
import { DEFAULT_SEDE_ID } from "../routers/sedi";
import type { ContestoRun } from "./strumenti/tipi";

function ruoliDi(user: any): string[] {
  if (Array.isArray(user?.ruoli) && user.ruoli.length) return user.ruoli;
  if (user?.ruolo) return [user.ruolo];
  if (user?.role === "admin") return ["direzione"];
  return [];
}

export async function costruisciContesto(
  ctx: Pick<TrpcContext, "user" | "sedeId" | "sediIds">
): Promise<ContestoRun> {
  const utenteId = ctx.user?.id;
  const sedeId = ctx.sedeId ?? DEFAULT_SEDE_ID;
  if (utenteId == null) {
    throw new Error("UNAUTHORIZED: sessione non valida.");
  }
  const capability = await effectiveCapabilitySet(ctx, CAPABILITIES);
  const ruoli = ruoliDi(ctx.user);
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        sede: sedeId,
        ruoli: [...ruoli].sort(),
        capability: [...capability].sort(),
      })
    )
    .digest("hex")
    .slice(0, 16);
  return {
    utenteId,
    sedeId,
    ruoli,
    direzione: ruoli.includes("direzione"),
    capability,
    capabilityFingerprint: fingerprint,
    lingua: "it",
    fuso: "Europe/Rome",
  };
}
