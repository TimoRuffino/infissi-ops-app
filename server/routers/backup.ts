import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import {
  backupLog,
  backupStatus,
  buildAuthUrl,
  disconnectOAuth,
  issueOAuthState,
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

  // Begin the "connect your Google account" flow. The one-shot state is
  // issued here (direzione-only) so the anonymous express callback can
  // verify the redirect really originated from an authorized session.
  oauthStartUrl: adminProcedure.mutation(({ ctx }) => {
    const req = ctx.req;
    const redirectUri = `${req.protocol}://${req.get("host")}/api/oauth/gdrive/callback`;
    const url = buildAuthUrl(redirectUri, issueOAuthState());
    if (!url) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Client OAuth non configurato: imposta GOOGLE_OAUTH_CLIENT_ID e GOOGLE_OAUTH_CLIENT_SECRET sul server",
      });
    }
    return { url };
  }),

  disconnectOAuth: adminProcedure.mutation(() => {
    disconnectOAuth();
    return { success: true } as const;
  }),
});
