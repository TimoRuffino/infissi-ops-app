// Password hashing — scrypt (Node built-in `crypto`, no external dependency).
//
// Versioned storage format:
//   scrypt$<N>$<saltHex>$<hashHex>   ← new (since v3)
//   scrypt$<saltHex>$<hashHex>       ← legacy (N defaulted to Node's 2^14)
//
// `verifyPassword` accepts both — and also a legacy PLAINTEXT stored value
// so existing users (seeded before hashing was introduced) can still log in;
// the seed/onLoad path upgrades plaintext to a hash at boot.

import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

const PREFIX = "scrypt$";
const KEYLEN = 64;
const SALT_BYTES = 16;

// scrypt cost parameters. N raised to 2^15 (32768) — more cost than Node's
// default (2^14) without becoming user-noticeable on a login.
const DEFAULT_N = 1 << 15; // 32768
const LEGACY_N = 1 << 14;  // 16384 — Node default; only used to verify old hashes
const SCRYPT_R = 8;
const SCRYPT_P = 1;
// maxmem must be ≥ 128 * N * r. Default in Node is 32 MiB which is too tight
// for N=32768. Allow up to 64 MiB.
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

/** Hash a plaintext password. Returns the `scrypt$N$salt$hash` storage string. */
export function hashPassword(plain: string): string {
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(plain, salt, KEYLEN, {
    N: DEFAULT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
  return `${PREFIX}${DEFAULT_N}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/** True when `stored` is a scrypt hash (any version), false for plaintext. */
export function isHashed(stored: unknown): boolean {
  return typeof stored === "string" && stored.startsWith(PREFIX);
}

/**
 * Verify `plain` against a `stored` value. Handles three cases:
 *   - new scrypt format (4 parts with embedded N)
 *   - legacy scrypt format (3 parts, N=16384)
 *   - legacy plaintext (caller is expected to re-hash on success)
 *
 * Constant-time comparison on the hashed branches.
 */
export function verifyPassword(plain: string, stored: unknown): boolean {
  if (typeof stored !== "string" || stored.length === 0) return false;

  if (!isHashed(stored)) {
    // Legacy plaintext fallback — exact match.
    return plain === stored;
  }

  const parts = stored.split("$");
  let N: number;
  let saltHex: string;
  let hashHex: string;
  if (parts.length === 4) {
    // ["scrypt", "<N>", "<saltHex>", "<hashHex>"]
    N = parseInt(parts[1], 10);
    if (!Number.isFinite(N) || N <= 0) return false;
    saltHex = parts[2];
    hashHex = parts[3];
  } else if (parts.length === 3) {
    // ["scrypt", "<saltHex>", "<hashHex>"] — legacy
    N = LEGACY_N;
    saltHex = parts[1];
    hashHex = parts[2];
  } else {
    return false;
  }
  if (!saltHex || !hashHex) return false;

  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  if (expected.length === 0) return false;

  const actual = scryptSync(plain, salt, expected.length, {
    N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
