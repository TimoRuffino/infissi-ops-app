// File storage layer for uploaded documents (P0.1 of the AI plan).
//
// Before this module, every uploaded file lived base64-inside the JSONB blob
// of its collection (preventivi_documenti, ticket_allegati) — so EVERY save
// of the collection rewrote every byte of every file. This module moves the
// bytes out: records keep only metadata + `storageKey`, and the bytes live
// in one of two drivers:
//
//   - "local" (default): files under ./data/files/<key>. Fine for dev and
//     for a Railway deployment with an attached volume. WARNING: without a
//     volume, Railway's filesystem is ephemeral — see the guard in
//     fileStorageMigrate.ts.
//   - "s3": any S3-compatible endpoint (Cloudflare R2, AWS S3, MinIO) via
//     REST + SigV4 signed with node:crypto.
//
// Env:
//   STORAGE_DRIVER=local|s3        (default local)
//   S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
//   S3_BUCKET=ruffino-crm-files
//   S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY
//   S3_REGION=auto                 (R2 wants "auto"; AWS wants a real region)
//
// Reads stay retro-compatible: records that still carry dataBase64 are
// served from the legacy field (see the routers), so nothing breaks before
// or during the migration.

import crypto from "crypto";
import fs from "fs";
import path from "path";

// ── Driver interface ────────────────────────────────────────────────────────

export type StorageDriver = {
  name: "local" | "s3";
  put(key: string, buffer: Buffer, mimeType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
};

// ── Key helpers ─────────────────────────────────────────────────────────────

// Storage keys are generated server-side only — but sanitize anyway so a
// weird filename can never traverse out of the root ("../../etc/passwd").
function sanitizeSegment(s: string): string {
  return s
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^\.+/, "_")
    .slice(0, 80);
}

/** Build a storage key: "<collection>/<parentId>/<recordId>-<rand><ext>". */
export function buildStorageKey(
  collection: string,
  parentId: number,
  recordId: number,
  originalName: string
): string {
  const dotIdx = originalName.lastIndexOf(".");
  const ext = dotIdx > 0 ? sanitizeSegment(originalName.slice(dotIdx)) : "";
  const rand = crypto.randomBytes(4).toString("hex");
  return `${sanitizeSegment(collection)}/${parentId}/${recordId}-${rand}${ext.startsWith("_") ? "." + ext.slice(1) : ext}`;
}

export function sha256Hex(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

// ── Local driver ────────────────────────────────────────────────────────────

const LOCAL_ROOT = path.join(process.cwd(), "data", "files");

function localPathFor(key: string): string {
  // Re-validate on every access: the key comes from DB records which an
  // admin could in principle hand-edit. Resolve and ensure containment.
  const p = path.resolve(LOCAL_ROOT, key);
  if (!p.startsWith(path.resolve(LOCAL_ROOT) + path.sep)) {
    throw new Error(`STORAGE: chiave non valida: ${key}`);
  }
  return p;
}

const localDriver: StorageDriver = {
  name: "local",
  async put(key, buffer) {
    const p = localPathFor(key);
    await fs.promises.mkdir(path.dirname(p), { recursive: true });
    await fs.promises.writeFile(p, buffer);
  },
  async get(key) {
    try {
      return await fs.promises.readFile(localPathFor(key));
    } catch (e: any) {
      if (e?.code === "ENOENT") return null;
      throw e;
    }
  },
  async delete(key) {
    try {
      await fs.promises.unlink(localPathFor(key));
    } catch (e: any) {
      if (e?.code !== "ENOENT") throw e;
    }
  },
};

// ── S3-compatible driver (SigV4, no deps) ───────────────────────────────────

type S3Config = {
  endpoint: string; // https://<account>.r2.cloudflarestorage.com
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
};

const S3_REQUIRED_ENV = [
  "S3_ENDPOINT",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
] as const;

export type StorageConfiguration = {
  requestedDriver: "local" | "s3";
  configured: boolean;
  missing: string[];
  endpoint: string | null;
  bucket: string | null;
  region: string | null;
};

/** Safe diagnostics: never returns access keys or secrets. */
export function storageConfiguration(): StorageConfiguration {
  const requestedDriver =
    (process.env.STORAGE_DRIVER || "local").toLowerCase() === "s3"
      ? "s3"
      : "local";
  const missing =
    requestedDriver === "s3"
      ? S3_REQUIRED_ENV.filter(name => !process.env[name])
      : [];
  return {
    requestedDriver,
    configured: missing.length === 0,
    missing: [...missing],
    endpoint:
      requestedDriver === "s3"
        ? (process.env.S3_ENDPOINT?.replace(/\/+$/, "") ?? null)
        : null,
    bucket: requestedDriver === "s3" ? (process.env.S3_BUCKET ?? null) : null,
    region: requestedDriver === "s3" ? process.env.S3_REGION || "auto" : null,
  };
}

function s3ConfigFromEnv(): S3Config | null {
  const endpoint = process.env.S3_ENDPOINT?.replace(/\/+$/, "");
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    region: process.env.S3_REGION || "auto",
  };
}

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

// Minimal AWS Signature V4 for path-style S3 requests. Only what we need:
// no query params, single object per request, payload hash always computed.
async function s3Request(
  cfg: S3Config,
  method: "PUT" | "GET" | "DELETE",
  key: string,
  body?: Buffer,
  mimeType?: string
): Promise<{ status: number; body: Buffer }> {
  const url = new URL(`${cfg.endpoint}/${cfg.bucket}/${key}`);
  const now = new Date();
  const amzDate = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, ""); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = crypto
    .createHash("sha256")
    .update(body ?? Buffer.alloc(0))
    .digest("hex");

  // Canonical request. Path segments must be URI-encoded but slashes kept.
  const canonicalUri = url.pathname
    .split("/")
    .map(seg => encodeURIComponent(seg))
    .join("/");
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (body && mimeType) headers["content-type"] = mimeType;
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames
    .map(h => `${h}:${headers[h].trim()}\n`)
    .join("");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = [
    method,
    canonicalUri,
    "", // query string
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    crypto.createHash("sha256").update(canonicalRequest, "utf8").digest("hex"),
  ].join("\n");

  const kDate = hmac(`AWS4${cfg.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, cfg.region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = crypto
    .createHmac("sha256", kSigning)
    .update(stringToSign, "utf8")
    .digest("hex");

  const authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(url, {
    method,
    headers: { ...headers, authorization },
    body: body as any,
  });
  const resBody = Buffer.from(await res.arrayBuffer());
  return { status: res.status, body: resBody };
}

function makeS3Driver(cfg: S3Config): StorageDriver {
  return {
    name: "s3",
    async put(key, buffer, mimeType) {
      const res = await s3Request(cfg, "PUT", key, buffer, mimeType);
      if (res.status < 200 || res.status >= 300) {
        throw new Error(
          `STORAGE S3: upload fallito (${res.status}): ${res.body.toString("utf8").slice(0, 300)}`
        );
      }
    },
    async get(key) {
      const res = await s3Request(cfg, "GET", key);
      if (res.status === 404) {
        // S3/R2 rispondono 404 sia per chiave assente (NoSuchKey) sia per
        // BUCKET assente o sbagliato (NoSuchBucket): il secondo non è un
        // "file mancante", è una configurazione rotta — e la sonda
        // read-only non deve dichiararla OK (revisione hardening).
        const corpo = res.body.toString("utf8");
        if (corpo.includes("NoSuchBucket")) {
          throw new Error(
            `STORAGE S3: bucket inesistente o errato (404 NoSuchBucket): ${corpo.slice(0, 200)}`
          );
        }
        return null;
      }
      if (res.status < 200 || res.status >= 300) {
        throw new Error(
          `STORAGE S3: lettura fallita (${res.status}): ${res.body.toString("utf8").slice(0, 300)}`
        );
      }
      return res.body;
    },
    async delete(key) {
      const res = await s3Request(cfg, "DELETE", key);
      // 204 expected; 404 is fine (already gone).
      if (res.status >= 300 && res.status !== 404) {
        throw new Error(`STORAGE S3: delete fallito (${res.status})`);
      }
    },
  };
}

// ── Facade ──────────────────────────────────────────────────────────────────

let _driver: StorageDriver | null = null;

export function getStorageDriver(): StorageDriver {
  if (_driver) return _driver;
  const requested = (process.env.STORAGE_DRIVER || "local").toLowerCase();
  if (requested === "s3") {
    const cfg = s3ConfigFromEnv();
    if (!cfg) {
      throw new Error(
        "STORAGE: STORAGE_DRIVER=s3 ma mancano S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY"
      );
    }
    _driver = makeS3Driver(cfg);
  } else {
    _driver = localDriver;
  }
  console.log(`[fileStorage] driver attivo: ${_driver.name}`);
  return _driver;
}

// On Railway WITHOUT a volume the container filesystem is ephemeral: a
// local-driver write would succeed today and silently vanish at the next
// deploy. Until s3 is configured (or a volume is attached and the opt-in
// env is set), refuse the put — callers fall back to legacy inline base64,
// which is exactly the pre-P0.1 behavior and loses nothing.
function assertDurableDriver(driver: StorageDriver): void {
  if (
    driver.name === "local" &&
    process.env.RAILWAY_ENVIRONMENT &&
    process.env.STORAGE_ALLOW_EPHEMERAL !== "1"
  ) {
    throw new Error(
      "STORAGE: driver local su Railway senza volume (filesystem effimero). Configura STORAGE_DRIVER=s3 oppure monta un volume e imposta STORAGE_ALLOW_EPHEMERAL=1."
    );
  }
}

/** Store a buffer; returns { storageKey, checksum }. */
export async function putFile(
  collection: string,
  parentId: number,
  recordId: number,
  originalName: string,
  buffer: Buffer,
  mimeType: string
): Promise<{ storageKey: string; checksum: string }> {
  const driver = getStorageDriver();
  assertDurableDriver(driver);
  const storageKey = buildStorageKey(
    collection,
    parentId,
    recordId,
    originalName
  );
  await driver.put(storageKey, buffer, mimeType);
  return { storageKey, checksum: sha256Hex(buffer) };
}

export async function getFile(storageKey: string): Promise<Buffer | null> {
  return getStorageDriver().get(storageKey);
}

/** Best-effort delete — storage orphans are harmless, missing files are not. */
export function deleteFileQuiet(storageKey: string | null | undefined): void {
  if (!storageKey) return;
  getStorageDriver()
    .delete(storageKey)
    .catch(e =>
      console.warn(`[fileStorage] delete fallito per ${storageKey}:`, e)
    );
}

export type StorageProbeResult = {
  driver: StorageDriver["name"];
  ok: true;
  latencyMs: number;
  bytes: number;
};

export type StorageReadOnlyProbeResult = {
  driver: StorageDriver["name"];
  ok: true;
  latencyMs: number;
};

/**
 * Sonda di SOLA LETTURA: un GET su una chiave `_health/` inesistente prova
 * endpoint, credenziali ed esistenza del bucket (404 NoSuchBucket lancia;
 * la chiave mancante risponde null) senza scrivere MAI nulla. Nota per
 * AWS con policy minime senza `s3:ListBucket`: il GET di una chiave
 * assente può rispondere 403 → la sonda fallisce in modo CAUTO (falso
 * allarme, mai falso OK); su R2 il 404 è la norma. La sonda completa
 * put/get/delete resta `probeStorage`, separata e dichiarata
 * (`pnpm storage:probe-write`).
 */
export async function probeStorageReadOnly(
  driver: StorageDriver = getStorageDriver()
): Promise<StorageReadOnlyProbeResult> {
  assertDurableDriver(driver);
  const started = Date.now();
  const chiave = `_health/readonly-probe-${crypto.randomUUID()}.txt`;
  const letto = await driver.get(chiave);
  if (letto != null) {
    // Non dovrebbe esistere: non lo tocchiamo, ma lo segnaliamo.
    throw new Error(
      `STORAGE: la chiave sonda ${chiave} esiste già — verifica manuale richiesta`
    );
  }
  return { driver: driver.name, ok: true, latencyMs: Date.now() - started };
}

/** Put → get → checksum → delete, without leaving application data behind. */
export async function probeStorage(
  driver: StorageDriver = getStorageDriver()
): Promise<StorageProbeResult> {
  assertDurableDriver(driver);
  const started = Date.now();
  const payload = Buffer.from(
    `ruffino-storage-probe:${crypto.randomUUID()}`,
    "utf8"
  );
  const key = `_health/${Date.now()}-${crypto.randomBytes(4).toString("hex")}.txt`;
  let written = false;
  try {
    await driver.put(key, payload, "text/plain; charset=utf-8");
    written = true;
    const readBack = await driver.get(key);
    if (!readBack)
      throw new Error("STORAGE: la sonda scritta non è rileggibile");
    if (sha256Hex(readBack) !== sha256Hex(payload)) {
      throw new Error("STORAGE: checksum della sonda non valido");
    }
  } finally {
    if (written) await driver.delete(key);
  }
  return {
    driver: driver.name,
    ok: true,
    latencyMs: Date.now() - started,
    bytes: payload.length,
  };
}
