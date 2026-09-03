// Tariffe del computo limiti in lettura per la direzione. La modifica con
// validità (tabella `tariffe`) è nel piano 2: intanto chi decide vede cosa
// vale oggi e da quando, invece di fidarsi di un foglio.
import { procedureConInterruttore, router } from "../_core/trpc";
import { authorizeCoreOperation } from "../authz/enforcement";
import { tariffeAttive } from "../computo/tariffe";
import { DEFAULT_SEDE_ID } from "./sedi";

const procedura = procedureConInterruttore("limiti");

export const tariffeRouter = router({
  limiti: procedura.query(async ({ ctx }) => {
    const sedeId = ctx.sedeId ?? DEFAULT_SEDE_ID;
    await authorizeCoreOperation({
      ctx, endpoint: "tariffe.limiti", capability: "tariffe.manage",
      resourceType: "tariffe", resource: { sedeId }, legacyAllowed: "capability",
    });
    return tariffeAttive();
  }),
});
