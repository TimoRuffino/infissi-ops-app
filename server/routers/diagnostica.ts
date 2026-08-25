import { protectedProcedure, router } from "../_core/trpc";
import { requireDirezione } from "../_core/permissions";
import { collectOperationalDiagnostics } from "../observability/metrics";

export const diagnosticaRouter = router({
  snapshot: protectedProcedure.query(({ ctx }) => {
    requireDirezione(ctx.user);
    return collectOperationalDiagnostics(ctx.sedeId ?? 1);
  }),
});
