import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { requireDirezione } from "../_core/permissions";
import {
  getStorageDriver,
  probeStorage,
  storageConfiguration,
} from "../_core/fileStorage";
import { migrateFilesToStorage } from "../_core/fileStorageMigrate";
import { getAllStoreSnapshots } from "../_core/persistence";

// Direzione-only surface for the P0.1 storage migration: check how many
// documents still carry inline base64, and run the migration (dry-run or
// apply) without shelling into the container.

export const fileStorageAdminRouter = router({
  status: protectedProcedure.query(({ ctx }) => {
    requireDirezione(ctx.user);
    const configuration = storageConfiguration();
    const keys = ["preventivi_documenti", "ticket_allegati"];
    const snapshots = getAllStoreSnapshots().filter(s => keys.includes(s.key));
    return {
      driver: configuration.configured
        ? getStorageDriver().name
        : configuration.requestedDriver,
      configuration,
      collections: snapshots.map(s => {
        let inline = 0;
        let migrati = 0;
        let inlineBytes = 0;
        for (const r of s.items as any[]) {
          if (r.storageKey) migrati++;
          else if (r.dataBase64) {
            inline++;
            inlineBytes += Math.floor((r.dataBase64.length * 3) / 4);
          }
        }
        return {
          key: s.key,
          total: s.items.length,
          inline,
          migrati,
          inlineBytes,
        };
      }),
    };
  }),

  probe: protectedProcedure.mutation(async ({ ctx }) => {
    requireDirezione(ctx.user);
    const configuration = storageConfiguration();
    if (!configuration.configured) {
      throw new Error(
        `Storage non configurato: mancano ${configuration.missing.join(", ")}`
      );
    }
    return probeStorage();
  }),

  migrate: protectedProcedure
    .input(
      z.object({
        apply: z.boolean().default(false),
        skipBackupCheck: z.boolean().default(false),
      })
    )
    .mutation(async ({ input, ctx }) => {
      requireDirezione(ctx.user);
      return migrateFilesToStorage(input);
    }),
});
