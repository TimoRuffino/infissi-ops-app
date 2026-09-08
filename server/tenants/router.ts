// server/tenants/router.ts
import { protectedProcedure, router, sessionProcedure } from "../_core/trpc";
import { interruttoreAttivo } from "../platform/interruttori";
import {
  QUOTA_STORAGE_PREDEFINITA_BYTES,
  RUOLO_PROPRIETARIO,
  TENANT_PREDEFINITO_ID,
  TENANT_PREDEFINITO_NOME,
  TENANT_PREDEFINITO_SLUG,
} from "./costanti";
import { ruoliDi, tenantDelContesto } from "./regole";
import { getTenantRepository } from "./repository";
import { percentualeStorage } from "./storage";
import type { TenantRecord } from "./tipi";

function tenantPredefinitoSintetico(): TenantRecord {
  const now = new Date();
  return {
    id: TENANT_PREDEFINITO_ID,
    slug: TENANT_PREDEFINITO_SLUG,
    nome: TENANT_PREDEFINITO_NOME,
    stato: "attivo",
    motivoStato: null,
    createdAt: now,
    updatedAt: now,
    storageQuotaBytes: QUOTA_STORAGE_PREDEFINITA_BYTES,
  };
}

export const tenantsRouter = router({
  /**
   * L'azienda della sessione. `sessionProcedure`: risponde anche dietro la
   * porta chiusa e in sola lettura, così il client sa sempre dove si trova.
   */
  mio: sessionProcedure.query(({ ctx }) => {
    const multiAzienda = interruttoreAttivo("multiAzienda");
    const tenant =
      ctx.tenant ??
      getTenantRepository().perId(ctx.tenantId ?? TENANT_PREDEFINITO_ID) ??
      tenantPredefinitoSintetico();
    return {
      id: tenant.id,
      slug: tenant.slug,
      nome: tenant.nome,
      stato: tenant.stato,
      // `ctx.user` è `User | LocalUser`: il ramo OAuth (`User`) non ha
      // `ruoli`/`ruolo`, quindi tsc rifiuta l'assegnazione strutturale
      // ("weak type") anche se a runtime `ruoliDi` gestisce già l'assenza.
      proprietario: ruoliDi(ctx.user as any).includes(RUOLO_PROPRIETARIO),
      multiAzienda,
    };
  }),

  /** Uso dello storage dell'azienda della sessione: conta e avvisa, non blocca (spec WS3 §3.2). */
  storage: protectedProcedure.query(async ({ ctx }) => {
    const tenantId = tenantDelContesto(ctx);
    const stato = await getTenantRepository().storageDi(tenantId);
    const quotaBytes = stato?.quotaBytes ?? getTenantRepository().perId(tenantId)?.storageQuotaBytes ?? QUOTA_STORAGE_PREDEFINITA_BYTES;
    const bytes = stato?.bytes ?? 0;
    return {
      bytes,
      file: stato?.file ?? 0,
      quotaBytes,
      percentuale: percentualeStorage(bytes, quotaBytes),
      sogliaAvvisata: stato?.sogliaAvvisata ?? 0,
      ricalcolatoIl: stato?.ricalcolatoIl ?? null,
    };
  }),
});
