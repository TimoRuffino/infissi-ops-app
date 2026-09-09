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
import { Readable } from "stream";
import { TRPCError } from "@trpc/server";
import { tenantCorrente } from "../tenants/contestoCorrente";
import { TENANT_PREDEFINITO_ID } from "../tenants/costanti";

// ── Driver interface ────────────────────────────────────────────────────────

export type StorageDriver = {
  name: "local" | "s3";
  put(key: string, buffer: Buffer, mimeType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  openRead(
    key: string,
    range?: { start: number; end: number }
  ): Promise<{
    stream: Readable;
    totalBytes: number;
    contentLength: number;
  } | null>;
  delete(key: string): Promise<void>;
  head?(key: string): Promise<{ bytes: number } | null>;
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

// ── Chiavi per azienda (WS3, spec §3.1) ─────────────────────────────────────
// Ogni file NUOVO nasce sotto `tenant/<id>/…`, tenant 1 compreso; le chiavi
// nude sono i file di Ruffino Group caricati prima del WS3 e restano
// leggibili dove sono (decisione 2). La cintura in lettura confronta il
// tenant della chiave con quello del contesto: i record sono già per
// tenant (WS2), qui si ferma il record corrotto o l'errore di programmazione.
const RE_CHIAVE_TENANT = /^tenant\/(\d+)\//;

export function chiaveStorage(
  tenantId: number,
  collezione: string,
  parentId: number,
  recordId: number,
  nome: string
): string {
  return `tenant/${tenantId}/${buildStorageKey(collezione, parentId, recordId, nome)}`;
}

export function tenantDellaChiave(storageKey: string): number {
  const m = RE_CHIAVE_TENANT.exec(storageKey);
  return m ? Number(m[1]) : TENANT_PREDEFINITO_ID;
}

function tenantPerStorage(operazione: string): number {
  const t = tenantCorrente();
  if (t == null) throw new Error(`[fileStorage] ${operazione} senza tenant nel contesto`);
  return t;
}

function chiaveDelTenantCorrente(storageKey: string, operazione: string): boolean {
  if (tenantDellaChiave(storageKey) === tenantPerStorage(operazione)) return true;
  // Mai la chiave nel log: dice l'id di un record di un'altra azienda.
  console.warn(`[fileStorage] ${operazione} rifiutata: chiave di un'altra azienda`);
  return false;
}

// ── Contabile dei byte (spec §3.2) ──────────────────────────────────────────
// Iniettato al boot da server/tenants (come il resolver del tenant in
// persistence.ts): questo modulo non importa il control plane. Best effort:
// un errore di contabilità è un log, mai un upload rifiutato.
export type ContabileStorage = {
  aggiungi(tenantId: number, bytes: number, file: number): Promise<void>;
  togli(tenantId: number, bytes: number, file: number): Promise<void>;
};
let contabile: ContabileStorage | null = null;
export function impostaContabileStorage(c: ContabileStorage | null): void {
  contabile = c;
}

// ── Quota che blocca (WS4, spec §6) ─────────────────────────────────────────
// La quota conta e avvisa dal WS3 (server/tenants/storage.ts): blocca SOLO
// qui e SOLO col gancio registrato al boot (server/abbonamenti/quota.ts,
// dietro FLAG_MULTI_AZIENDA — `registraGanciQuota()` in `preparaTenants()`).
// Senza gancio (script, test, boot prima di quel punto) nessun controllo,
// come oggi.
export type VerificaQuota = (tenantId: number, bytes: number) => Promise<{ messaggio: string } | null>;
let verificaQuota: VerificaQuota | null = null;
export function impostaVerificaQuota(v: VerificaQuota | null): void {
  verificaQuota = v;
}

/** Spazio esaurito oltre la tolleranza: tRPC la mostra come le altre `TRPCError` di dominio. */
export class ErroreQuotaStorage extends TRPCError {
  constructor(messaggio: string) {
    super({ code: "PRECONDITION_FAILED", message: messaggio });
    this.name = "ErroreQuotaStorage";
  }
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
  async openRead(key, range) {
    try {
      const fullPath = localPathFor(key);
      const stat = await fs.promises.stat(fullPath);
      const totalBytes = stat.size;
      if (range) {
        const start = Math.max(0, range.start);
        const end = Math.min(range.end, totalBytes - 1);
        if (start > end) return null;
        return {
          stream: fs.createReadStream(fullPath, { start, end }),
          totalBytes,
          contentLength: end - start + 1,
        };
      }
      return {
        stream: fs.createReadStream(fullPath),
        totalBytes,
        contentLength: totalBytes,
      };
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
  async head(key) {
    try {
      const stat = await fs.promises.stat(localPathFor(key));
      return { bytes: stat.size };
    } catch (e: any) {
      if (e?.code === "ENOENT") return null;
      throw e;
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

function parseS3ContentRange(
  value: string | null | undefined
): { start: number; end: number; total: number } | null {
  if (!value) return null;
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value.trim());
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    !Number.isSafeInteger(total)
  ) {
    return null;
  }
  return { start, end, total };
}

function parseContentLengthFromS3Headers(headers: Headers): {
  totalBytes: number;
  contentLength: number;
} {
  const contentLengthRaw = Number(headers.get("content-length"));
  const parsedContentLength = Number.isFinite(contentLengthRaw)
    ? contentLengthRaw
    : null;
  const contentRange = parseS3ContentRange(headers.get("content-range"));
  if (contentRange) {
    const totalBytes = contentRange.total;
    const computed = contentRange.end - contentRange.start + 1;
    return {
      totalBytes,
      contentLength: parsedContentLength ?? Math.max(0, computed),
    };
  }
  return {
    totalBytes: parsedContentLength ?? 0,
    contentLength: parsedContentLength ?? 0,
  };
}

// Minimal AWS Signature V4 for path-style S3 requests. Only what we need:
// no query params, single object per request, payload hash always computed.
async function s3Fetch(
  cfg: S3Config,
  method: "PUT" | "GET" | "DELETE" | "HEAD",
  key: string,
  body?: Buffer,
  mimeType?: string,
  extraHeaders?: Record<string, string>
): Promise<Response> {
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
  if (extraHeaders) {
    for (const [name, value] of Object.entries(extraHeaders)) {
      headers[name.toLowerCase()] = value;
    }
  }
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
  return await fetch(url, {
    method,
    headers: { ...headers, authorization },
    body: body as any,
  });
}

// Minimal AWS Signature V4 for path-style S3 requests.
async function s3Request(
  cfg: S3Config,
  method: "PUT" | "GET" | "DELETE" | "HEAD",
  key: string,
  body?: Buffer,
  mimeType?: string
): Promise<{ status: number; body: Buffer }> {
  const res = await s3Fetch(cfg, method, key, body, mimeType);
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
    async openRead(key, range) {
      const headers: Record<string, string> = {};
      if (range) {
        headers.range = `bytes=${range.start}-${range.end}`;
      }
      const res = await s3Fetch(cfg, "GET", key, undefined, undefined, headers);
      if (res.status === 404) {
        const corpo = await res.text();
        if (corpo.includes("NoSuchBucket")) {
          throw new Error(
            `STORAGE S3: bucket inesistente o errato (404 NoSuchBucket): ${corpo.slice(0, 200)}`
          );
        }
        return null;
      }
      if (res.status < 200 || res.status >= 300) {
        const corpo = await res.text();
        throw new Error(
          `STORAGE S3: lettura fallita (${res.status}): ${corpo.slice(0, 300)}`
        );
      }

      const { totalBytes, contentLength } = parseContentLengthFromS3Headers(
        res.headers
      );
      if (!res.body) {
        return {
          stream: Readable.from([]),
          totalBytes,
          contentLength: 0,
        };
      }
      return {
        stream: Readable.fromWeb(res.body as any),
        totalBytes,
        contentLength,
      };
    },
    async delete(key) {
      const res = await s3Request(cfg, "DELETE", key);
      // 204 expected; 404 is fine (already gone).
      if (res.status >= 300 && res.status !== 404) {
        throw new Error(`STORAGE S3: delete fallito (${res.status})`);
      }
    },
    async head(key) {
      const res = await s3Fetch(cfg, "HEAD", key);
      if (res.status === 404) return null;
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`STORAGE S3: head fallito (${res.status})`);
      }
      return { bytes: Number(res.headers.get("content-length") ?? 0) };
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

/**
 * Solo test: inietta un driver finto (o azzera per tornare alla risoluzione
 * pigra dall'env al prossimo `getStorageDriver()`). Stesso pattern di
 * `modalitaTenantStretta` in contestoCorrente.ts.
 */
export function __impostaDriverPerTest(driver: StorageDriver | null): void {
  if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY_DRIVER_STORAGE");
  _driver = driver;
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

/** Store a buffer; returns { storageKey, checksum }. Il tenant viene dal contesto (WS3). */
export async function putFile(
  collection: string,
  parentId: number,
  recordId: number,
  originalName: string,
  buffer: Buffer,
  mimeType: string
): Promise<{ storageKey: string; checksum: string }> {
  const tenantId = tenantPerStorage("scrittura");
  // La quota conta e avvisa dal WS3, blocca solo qui e solo col gancio
  // registrato al boot (spec WS4 §6): un rifiuto (o un gancio che lancia)
  // fa fallire l'upload — fail-closed, mai un upload «di comodo».
  if (verificaQuota) {
    const rifiuto = await verificaQuota(tenantId, buffer.length);
    if (rifiuto) throw new ErroreQuotaStorage(rifiuto.messaggio);
  }
  const driver = getStorageDriver();
  assertDurableDriver(driver);
  const storageKey = chiaveStorage(
    tenantId,
    collection,
    parentId,
    recordId,
    originalName
  );
  await driver.put(storageKey, buffer, mimeType);
  if (contabile) {
    // Fire-and-forget: un guasto della contabilità non deve bloccare
    // l'upload, solo farlo sapere.
    void contabile
      .aggiungi(tenantId, buffer.length, 1)
      .catch(e => console.warn(`[fileStorage] contabilità non aggiornata (${tenantId}):`, e));
  }
  return { storageKey, checksum: sha256Hex(buffer) };
}

export async function getFile(storageKey: string): Promise<Buffer | null> {
  if (!chiaveDelTenantCorrente(storageKey, "lettura")) return null;
  return getStorageDriver().get(storageKey);
}

export async function openFileReadStream(
  storageKey: string,
  range?: { start: number; end: number }
): Promise<{ stream: Readable; totalBytes: number; contentLength: number } | null> {
  if (!chiaveDelTenantCorrente(storageKey, "lettura")) return null;
  const driver = getStorageDriver();
  if (!driver.openRead) return null;
  return driver.openRead(storageKey, range);
}

// Dimensione del file sullo storage, se il driver la sa dare. Non passa
// dalla cintura in lettura: la usano il ricalcolo e `deleteFileQuiet`,
// sempre su chiavi già scoperte tramite un record dell'azienda del
// contesto — qui si leggono solo i byte, non il contenuto.
export async function statFile(storageKey: string): Promise<{ bytes: number } | null> {
  const driver = getStorageDriver();
  if (!driver.head) return null;
  return driver.head(storageKey);
}

/**
 * Best-effort delete; `bytes` è la dimensione registrata sul record, se
 * manca si legge con `head`. Non passa dalla cintura in lettura: i
 * chiamanti sono già router che hanno verificato il record nel proprio
 * tenant (WS2) — qui si scioglie solo il conto dei byte.
 *
 * Cancellazione e contabilità hanno due `catch` distinti (fix wave finale):
 * con uno solo, una contabilità che falliva lasciava nel log «delete
 * fallito» su un file cancellato benissimo, e chi leggeva quel log andava a
 * cercare un file che non c'era più. Sono due guasti diversi e si rimediano
 * in due modi diversi (il secondo con `pnpm tenant storage --ricalcola`).
 *
 * Se la dimensione non si conosce — nessun `bytes` sul record e un driver
 * senza `head` — il file si cancella e il ledger NON si tocca: scontare
 * zero byte «ma un file» sballerebbe il conto dei file senza sistemare
 * quello dei byte.
 */
export function deleteFileQuiet(storageKey: string | null | undefined, bytes?: number | null): void {
  if (!storageKey) return;
  const driver = getStorageDriver();
  void (async () => {
    let n = bytes ?? null;
    if (n == null && driver.head) {
      const info = await driver.head(storageKey);
      if (!info) return; // già assente: niente da cancellare né da scontare
      n = info.bytes;
    }
    await driver.delete(storageKey);
    return n;
  })()
    .then(n => {
      if (n == null || !contabile) return;
      const tenantId = tenantDellaChiave(storageKey);
      void contabile
        .togli(tenantId, n, 1)
        .catch(e => console.warn(`[fileStorage] contabilità non aggiornata per ${storageKey}:`, e));
    })
    .catch(e => console.warn(`[fileStorage] delete fallito per ${storageKey}:`, e));
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

/**
 * Gli allegati si scaricano solo se lo storage è durevole. Col driver
 * `local` su Railway finirebbero inline in JSONB: esattamente il problema
 * da 103 MB che il progetto sta già rimandando. Vive qui dal 08/09/2026
 * perché la regola vale per la posta e per WhatsApp allo stesso modo.
 */
export function storageDurevole(): boolean {
  try {
    const driver = getStorageDriver();
    if (driver.name !== "local") return true;
    if (!process.env.RAILWAY_ENVIRONMENT) return true; // locale: filesystem vero
    return process.env.STORAGE_ALLOW_EPHEMERAL === "1";
  } catch {
    return false;
  }
}
