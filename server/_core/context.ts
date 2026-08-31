import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { parse as parseCookieHeader } from "cookie";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { verifyLocalSession, type LocalUser } from "../localAuth";
import { SEDE_COOKIE } from "@shared/const";
import { allowedSediForUser, DEFAULT_SEDE_ID } from "../routers/sedi";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: (User | LocalUser) | null;
  // Active sede for this request. Null only when unauthenticated. Scoped
  // routers read this to isolate data per location (showroom).
  sedeId: number | null;
  // Full set of sede ids the user may access (direzione = all).
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

  // Resolve the active sede. The requested sede comes from the `active_sede`
  // cookie but is ONLY honoured when the user is actually assigned to it —
  // otherwise we fall back to their first allowed sede (or the default). This
  // makes the cookie non-authoritative: tampering can never widen access.
  let sedeId: number | null = null;
  let sediIds: number[] = [];
  if (user) {
    sediIds = allowedSediForUser(user);
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
        : sediIds[0] ?? DEFAULT_SEDE_ID;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    sedeId,
    sediIds,
  };
}
