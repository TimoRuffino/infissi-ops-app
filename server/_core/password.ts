// Password hashing — scrypt (Node built-in `crypto`, no external dependency).
//
// Stored format:  scrypt$<saltHex>$<hashHex>
//
// `verifyPassword` also accepts a legacy PLAINTEXT stored value so existing
// users (seeded before hashing was introduced) can still log in; the caller
// is expected to re-hash on the first successful login (see routers.ts).

import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

const PREFIX = "scrypt$";
const KEYLEN = 64;
const SALT_BYTES = 16;

/** Hash a plaintext password. Returns the `scrypt$salt$hash` storage string. */
export function hashPassword(plain: string): string {
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(plain, salt, KEYLEN);
  return `${PREFIX}${salt.toString("hex")}$${hash.toString("hex")}`;
}

/** True when `stored` is already a scrypt hash (not legacy plaintext). */
export function isHashed(stored: unknown): boolean {
  return typeof stored === "string" && stored.startsWith(PREFIX);
}

/**
 * Verify `plain` against a `stored` value. Handles both the scrypt format
 * and legacy plaintext. Constant-time comparison for the hashed branch.
 */
export function verifyPassword(plain: string, stored: unknown): boolean {
  if (typeof stored !== "string" || stored.length === 0) return false;

  if (!isHashed(stored)) {
    // Legacy plaintext fallback — exact match. Caller re-hashes on success.
    return plain === stored;
  }

  const parts = stored.split("$");
  // ["scrypt", "<saltHex>", "<hashHex>"]
  if (parts.length !== 3 || !parts[1] || !parts[2]) return false;

  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  if (expected.length === 0) return false;

  const actual = scryptSync(plain, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
