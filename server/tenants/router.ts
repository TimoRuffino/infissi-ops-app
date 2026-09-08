// server/tenants/router.ts
import { router, sessionProcedure } from "../_core/trpc";
import { interruttoreAttivo } from "../platform/interruttori";
import {
  QUOTA_STORAGE_PREDEFINITA_BYTES,
  RUOLO_PROPRIETARIO,
  TENANT_PREDEFINITO_ID,
  TENANT_PREDEFINITO_NOME,
  TENANT_PREDEFINITO_SLUG,
} from "./costanti";
import { ruoliDi } from "./regole";
import { getTenantRepository } from "./repository";
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
});
