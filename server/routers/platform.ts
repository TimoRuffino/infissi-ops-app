// I flag di piattaforma, per il client.
//
// Erano esposti soltanto da `tars.config.get`, quindi rimuovendo Tars il
// client perdeva anche `realtimeNotifications` — e con lui lo stream SSE
// delle notifiche, che non c'entra niente con l'agente.

import { protectedProcedure, router } from "../_core/trpc";
import { getFeatureFlags } from "../platform/featureFlags";
import { DEFAULT_SEDE_ID } from "./sedi";

export const platformRouter = router({
  /** Sola lettura, per qualunque utente autenticato: decide come si comporta la UI. */
  flags: protectedProcedure.query(({ ctx }) =>
    getFeatureFlags(ctx.sedeId ?? DEFAULT_SEDE_ID)
  ),
});
