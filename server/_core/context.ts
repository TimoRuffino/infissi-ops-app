import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { parse as parseCookieHeader } from "cookie";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { verifyLocalSession, type LocalUser } from "../localAuth";
import { SEDE_COOKIE } from "@shared/const";
import { allowedSediForUser, DEFAULT_SEDE_ID } from "../routers/sedi";
import { interruttoreAttivo } from "../platform/interruttori";
import { TENANT_PREDEFINITO_ID } from "../tenants/costanti";
import { risolviTenantPerUtente, sediAmmesse } from "../tenants/contesto";
import type { TenantRecord } from "../tenants/tipi";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: (User | LocalUser) | null;
  // Azienda della sessione (WS1, spec §5.1). Null solo se non autenticato;
  // con FLAG_MULTI_AZIENDA spento vale sempre 1 (Ruffino Group).
  tenantId: number | null;
  // Il record del tenant: null se non autenticato o interruttore spento.
  tenant: TenantRecord | null;
  // Active sede for this request. Null only when unauthenticated (or, con il
  // multi-azienda acceso, quando il tenant non ha una sede attiva).
  sedeId: number | null;
  // Full set of sede ids the user may access (direzione = all del tenant).
  sediIds: number[];
};

export async function createContext(
  opts: Pick<CreateExpressContextOptions, "req" | "res"> &
    Partial<Pick<CreateExpressContextOptions, "info">>
): Promise<TrpcContext> {
  let user: (User | LocalUser) | null = null;

  // Try OAuth auth first
  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch {
    user = null;
  }

  // Fallback to local auth (dev/demo mode)
  if (!user) {
    try {
      user = await verifyLocalSession(opts.req);
    } catch {
      user = null;
    }
  }

  const multiAzienda = interruttoreAttivo("multiAzienda");
  let tenantId: number | null = null;
  let tenant: TenantRecord | null = null;
  let sedeId: number | null = null;
  let sediIds: number[] = [];

  if (user && multiAzienda) {
    // L'utente si rilegge dallo store: un JWT valido non basta più a chi è
    // stato cancellato o disattivato, e il tenant non è mai un claim del token.
    const risolto = risolviTenantPerUtente(user);
    if (!risolto) {
      user = null;
    } else {
      tenantId = risolto.tenantId;
      tenant = risolto.tenant;
      sediIds = sediAmmesse(risolto.utente, tenantId);
    }
  } else if (user) {
    tenantId = TENANT_PREDEFINITO_ID;
    sediIds = allowedSediForUser(user);
  }

  // Resolve the active sede. The requested sede comes from the `active_sede`
  // cookie but is ONLY honoured when the user is actually assigned to it —
  // otherwise we fall back to their first allowed sede. This makes the cookie
  // non-authoritative: tampering can never widen access.
  if (user) {
    let requested: number | null = null;
    const cookieHeader = opts.req.headers.cookie;
    if (cookieHeader) {
      const raw = parseCookieHeader(cookieHeader)[SEDE_COOKIE];
      const parsed = raw ? parseInt(raw, 10) : NaN;
      if (Number.isFinite(parsed)) requested = parsed;
    }
    sedeId =
      requested != null && sediIds.includes(requested)
        ? requested
        : sediIds[0] ?? (multiAzienda ? null : DEFAULT_SEDE_ID);
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    tenantId,
    tenant,
    sedeId,
    sediIds,
  };
}
