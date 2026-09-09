import { SignJWT, jwtVerify } from "jose";
import { parse as parseCookieHeader } from "cookie";
import type { Request, Response } from "express";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";

// ── Local auth for development/demo (no external OAuth required) ────────────

// JWT signing secret. In production a real JWT_SECRET is MANDATORY — without
// it an attacker could forge a token (role:"admin") using the well-known
// dev fallback string and take over any account. Fail hard at boot instead
// of silently running with a guessable secret. The fallback exists only so
// local dev / tests work without extra setup.
const JWT_SECRET_RAW = process.env.JWT_SECRET;
if (!JWT_SECRET_RAW && process.env.NODE_ENV === "production") {
  throw new Error(
    "JWT_SECRET environment variable is required in production. " +
      "Refusing to start with the insecure dev fallback secret."
  );
}
const LOCAL_SECRET = new TextEncoder().encode(
  JWT_SECRET_RAW || "ruffino-cartelletta-local-dev-secret-2026"
);

export type LocalUser = {
  id: number;
  openId: string;
  name: string | null;
  email: string | null;
  loginMethod: string | null;
  role: "user" | "admin";
  ruolo: string; // primary role (first of ruoli), kept for backward compat
  ruoli: string[]; // 1..3 roles
  createdAt: Date;
  updatedAt: Date;
  lastSignedIn: Date;
};

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — matches JWT exp

// In-memory session cache: token → { user, expMs }. Entries are evicted
// lazily on access and by the periodic sweep below, so the Map can't grow
// unbounded as tokens are issued over the lifetime of the process.
const sessions = new Map<string, { user: LocalUser; expMs: number }>();

// Periodic sweep of expired cache entries. unref() so it never keeps the
// process alive on its own.
setInterval(() => {
  const now = Date.now();
  sessions.forEach((entry, token) => {
    if (entry.expMs <= now) sessions.delete(token);
  });
}, 60 * 60 * 1000).unref();

export async function createLocalToken(user: LocalUser): Promise<string> {
  const token = await new SignJWT({
    sub: String(user.id),
    email: user.email,
    name: user.name,
    role: user.role,
    ruolo: user.ruolo,
    ruoli: user.ruoli,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .setIssuedAt()
    .sign(LOCAL_SECRET);

  sessions.set(token, { user, expMs: Date.now() + SESSION_TTL_MS });
  return token;
}

export async function verifyLocalSession(
  req: Request
): Promise<LocalUser | null> {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;

  const cookies = parseCookieHeader(cookieHeader);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;

  // Check in-memory cache first
  const cached = sessions.get(token);
  if (cached) {
    if (cached.expMs > Date.now()) return cached.user;
    sessions.delete(token); // expired — fall through to a fresh JWT verify
  }

  // Verify JWT
  try {
    const { payload } = await jwtVerify(token, LOCAL_SECRET, {
      algorithms: ["HS256"],
    });

    if (!payload.sub || !payload.email) return null;

    // Reconstruct user from JWT payload
    const ruoliFromJwt = Array.isArray(payload.ruoli) ? (payload.ruoli as string[]) : null;
    const ruoloFromJwt = (payload.ruolo as string) || "direzione";
    const ruoli = ruoliFromJwt && ruoliFromJwt.length > 0 ? ruoliFromJwt : [ruoloFromJwt];
    const user: LocalUser = {
      id: Number(payload.sub),
      openId: `local-${payload.sub}`,
      name: (payload.name as string) || null,
      email: (payload.email as string) || null,
      loginMethod: "local",
      role: (payload.role as "user" | "admin") || "user",
      ruolo: ruoloFromJwt,
      ruoli,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    };

    const expMs =
      typeof payload.exp === "number"
        ? payload.exp * 1000
        : Date.now() + SESSION_TTL_MS;
    sessions.set(token, { user, expMs });
    return user;
  } catch {
    return null;
  }
}

export function clearLocalSession(token: string) {
  sessions.delete(token);
}

/**
 * Invalidate the server-side session for the token carried by `req`'s
 * cookie. Called on logout so a captured token can't be replayed from the
 * in-memory cache after the user signs out.
 */
export function clearLocalSessionFromRequest(req: Request) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return;
  const token = parseCookieHeader(cookieHeader)[COOKIE_NAME];
  if (token) sessions.delete(token);
}

/**
 * Il `LocalUser` per `utente` (record dello store, con `ruoli`/`ruolo` e i
 * timestamp). Estratto da `auth.login` (WS6 §3.1) perché il pannello
 * piattaforma apre sessioni locali anche per gli inviti accettati, con la
 * stessa forma esatta di utente che il login produce oggi.
 */
export function localUserDa(utente: any): LocalUser {
  const ruoli: string[] =
    Array.isArray(utente.ruoli) && utente.ruoli.length > 0
      ? utente.ruoli
      : [utente.ruolo ?? "direzione"];
  const primaryRuolo = ruoli[0];
  return {
    id: utente.id,
    openId: `local-${utente.id}`,
    name: `${utente.cognome} ${utente.nome}`.trim(),
    email: utente.email,
    loginMethod: "local",
    role: ruoli.includes("direzione") ? "admin" : "user",
    ruolo: primaryRuolo,
    ruoli,
    createdAt: utente.createdAt,
    updatedAt: utente.updatedAt,
    lastSignedIn: new Date(),
  };
}

/**
 * Apre una sessione locale per `utente`: firma il JWT e imposta il cookie di
 * sessione con la stessa durata del login (7 giorni). Riusabile da
 * `auth.login` e da ogni punto che oggi fa accedere un utente locale senza
 * passare da email+password (WS6: invito accettato).
 */
export async function apriSessioneLocale(
  ctx: { req: Request; res: Response },
  utente: any
): Promise<LocalUser> {
  const localUser = localUserDa(utente);
  const token = await createLocalToken(localUser);
  ctx.res.cookie(COOKIE_NAME, token, {
    ...getSessionCookieOptions(ctx.req),
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 giorni, come il login
  });
  return localUser;
}
