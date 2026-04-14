import { SignJWT, jwtVerify } from "jose";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { COOKIE_NAME } from "@shared/const";

// ── Local auth for development/demo (no external OAuth required) ────────────

const LOCAL_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "ruffino-cartelletta-local-dev-secret-2026"
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

// In-memory sessions: JWT → user
const sessions = new Map<string, LocalUser>();

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

  sessions.set(token, user);
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
  if (cached) return cached;

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

    sessions.set(token, user);
    return user;
  } catch {
    return null;
  }
}

export function clearLocalSession(token: string) {
  sessions.delete(token);
}
