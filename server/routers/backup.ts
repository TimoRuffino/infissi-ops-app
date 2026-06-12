import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import {
  backupLog,
  backupStatus,
  runBackup,
  updateConfig,
} from "../_core/driveBackup";

// Nightly Drive backup — direzione only: status, manual run, log, config.
export const backupRouter = router({
  status: adminProcedure.query(() => backupStatus()),

  log: adminProcedure.query(() => backupLog(15)),

  runNow: adminProcedure.mutation(async () => {
    return await runBackup("manuale");
  }),

  updateConfig: adminProcedure
    .input(
      z.object({
        folderId: z.string().min(5).optional(),
        enabled: z.boolean().optional(),
      })
    )
    .mutation(({ input }) => updateConfig(input)),
});
