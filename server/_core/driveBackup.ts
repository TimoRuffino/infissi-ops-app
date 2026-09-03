import crypto from "crypto";
import fs from "fs";
import path from "path";
import { jsPDF } from "jspdf";
import autoTableImport from "jspdf-autotable";
import { getFile, sha256Hex } from "./fileStorage";

// tsx/esbuild ESM-CJS interop: depending on the bundler the callable lands
// either on the namespace itself or on .default.
const autoTable: (doc: any, opts: any) => void =
  (autoTableImport as any)?.default ?? (autoTableImport as any);
import { persistedStore, getAllStoreSnapshots } from "./persistence";

// ── Nightly Google Drive backup ──────────────────────────────────────────────
//
// Every night at 00:00 Europe/Rome the CRM exports an organized snapshot:
//
//   Backup CRM 2026-06-12/
//     database/<store>.json                ← raw dump of every store
//     Sede <nome>/
//       Utenti.json                        ← users of the sede (no passwords)
//       Clienti/
//         <Cognome Nome> (CL-7)/
//           Scheda cliente.pdf             ← same scheda as the app
//           cliente.json
//           Commesse/
//             <CODICE>/
//               commessa.json
//               Preventivi e contratti/…   ← uploaded files by type
//               Misure/…
//               Fatture e pagamenti/…
//               Ordini/… , DDT/… , Foto e altro/…
//               Ticket <id>/…              ← ticket attachments
//
// Destination: the shared Drive folder configured below (BACKUP_FOLDER_ID).
// Auth: Google service account (env GOOGLE_SERVICE_ACCOUNT_JSON or
// GOOGLE_SERVICE_ACCOUNT_FILE). The Drive folder must be shared with the
// service account's email as Editor. Zero npm deps: JWT is signed with node
// crypto and Drive v3 is called over plain REST.
//
// When Drive credentials are missing the same tree is written to ./backups
// on the server disk, so the nightly snapshot still exists.

const DEFAULT_FOLDER_ID = "1t24aYym8QRG4W8VTjPV9gA1BJ9LGphN0";

// ── Config + log stores ──────────────────────────────────────────────────────

type BackupConfig = {
  id: number;
  folderId: string;
  enabled: boolean;
};

const _configStore = persistedStore<BackupConfig>("backup_config", () => {});
const configRows = _configStore.items;

function getConfig(): BackupConfig {
  if (configRows.length === 0) {
    configRows.push({ id: 1, folderId: DEFAULT_FOLDER_ID, enabled: true });
    _configStore.save();
  }
  return configRows[0];
}

export function updateConfig(
  patch: Partial<Pick<BackupConfig, "folderId" | "enabled">>
) {
  const cfg = getConfig();
  if (patch.folderId !== undefined) cfg.folderId = patch.folderId.trim();
  if (patch.enabled !== undefined) cfg.enabled = patch.enabled;
  _configStore.save();
  return cfg;
}

type BackupLog = {
  id: number;
  startedAt: Date;
  finishedAt: Date | null;
  ok: boolean | null;
  target: "drive" | "locale" | null;
  trigger: "schedulato" | "manuale";
  rootName: string;
  files: number;
  bytes: number;
  error: string | null;
};

let nextLogId = 1;
const _logStore = persistedStore<BackupLog>("backup_log", loaded => {
  nextLogId = loaded.length ? Math.max(...loaded.map((x: any) => x.id)) + 1 : 1;
});
const logRows = _logStore.items;

// ── Service account / Drive REST ─────────────────────────────────────────────

// ── OAuth (user account) ─────────────────────────────────────────────────────
// Personal Google accounts can't receive uploads from service accounts (no
// storage quota), so the primary mode is OAuth: the operator connects their
// own Google account once; the CRM then writes with scope drive.file (it can
// only see files it created) into an app-created "Backup CRM Ruffino" folder
// that the operator may move/share anywhere — ownership and quota are the
// user's.

type OAuthRow = {
  id: number;
  refreshToken: string;
  email: string | null;
  rootFolderId: string | null;
  connectedAt: Date;
};

const _oauthStore = persistedStore<OAuthRow>("backup_oauth", () => {});
const oauthRows = _oauthStore.items;

// ── File fallback for OAuth credentials ─────────────────────────────────────
// persistedStore is Postgres-backed; without DATABASE_URL (local installs)
// it's memory-only and the refresh token would die on every restart, forcing
// a re-authorization. The token is too important for that: mirror it to a
// mode-600 file under ./data and reload it at boot when the store is empty.
const OAUTH_FILE = path.join(process.cwd(), "data", "backup-oauth.json");

function saveOAuthFile(): void {
  try {
    fs.mkdirSync(path.dirname(OAUTH_FILE), { recursive: true });
    fs.writeFileSync(OAUTH_FILE, JSON.stringify(oauthRows[0] ?? null), {
      mode: 0o600,
    });
  } catch (e) {
    console.error("[backup] impossibile salvare il token su file:", e);
  }
}

function loadOAuthFile(): void {
  try {
    if (oauthRows.length > 0) return; // DB row wins
    if (!fs.existsSync(OAUTH_FILE)) return;
    const row = JSON.parse(fs.readFileSync(OAUTH_FILE, "utf8"));
    if (row?.refreshToken) {
      oauthRows.push({ ...row, connectedAt: new Date(row.connectedAt) });
    }
  } catch (e) {
    console.error("[backup] impossibile leggere il token da file:", e);
  }
}
// Load eagerly at module init (after bootstrapAll the DB rows, if any, are
// already in; this only fills the gap when the DB is absent/empty).
setTimeout(loadOAuthFile, 0);

export function oauthClientFromEnv(): {
  clientId: string;
  clientSecret: string;
} | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

// One-shot anti-CSRF states for the authorize redirect, issued only to
// direzione via tRPC. 10 minute TTL.
const pendingStates = new Map<string, number>();

export function issueOAuthState(): string {
  const state = crypto.randomBytes(16).toString("hex");
  pendingStates.set(state, Date.now() + 10 * 60_000);
  return state;
}

function consumeOAuthState(state: string): boolean {
  const exp = pendingStates.get(state);
  pendingStates.delete(state);
  return exp != null && Date.now() < exp;
}

export function buildAuthUrl(
  redirectUri: string,
  state: string
): string | null {
  const client = oauthClientFromEnv();
  if (!client) return null;
  const p = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/drive.file",
    access_type: "offline",
    prompt: "consent", // force refresh_token issuance even on re-connect
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

export async function handleOAuthCallback(
  code: string,
  state: string,
  redirectUri: string
): Promise<void> {
  if (!consumeOAuthState(state))
    throw new Error("Stato OAuth non valido o scaduto");
  const client = oauthClientFromEnv();
  if (!client) throw new Error("Client OAuth non configurato");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(
      `Scambio codice OAuth fallito (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`
    );
  }
  const j: any = await res.json();
  if (!j.refresh_token) {
    throw new Error(
      "Google non ha restituito un refresh token — riprova il collegamento"
    );
  }
  // Identify the connected account for the UI.
  let email: string | null = null;
  try {
    const about = await fetch(`${DRIVE}/about?fields=user(emailAddress)`, {
      headers: { authorization: `Bearer ${j.access_token}` },
    });
    if (about.ok)
      email = ((await about.json()) as any)?.user?.emailAddress ?? null;
  } catch {
    /* non-fatal */
  }
  oauthRows.length = 0;
  oauthRows.push({
    id: 1,
    refreshToken: j.refresh_token,
    email,
    rootFolderId: null,
    connectedAt: new Date(),
  });
  oauthCachedToken = null;
  _oauthStore.save();
  saveOAuthFile();
}

export function disconnectOAuth(): void {
  oauthRows.length = 0;
  oauthCachedToken = null;
  _oauthStore.save();
  try {
    fs.rmSync(OAUTH_FILE, { force: true });
  } catch {
    /* ignore */
  }
}

let oauthCachedToken: { token: string; expiresAt: number } | null = null;

async function getOAuthAccessToken(): Promise<string> {
  if (oauthCachedToken && Date.now() < oauthCachedToken.expiresAt - 60_000) {
    return oauthCachedToken.token;
  }
  const client = oauthClientFromEnv();
  const row = oauthRows[0];
  if (!client || !row) throw new Error("Account Google non collegato");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: row.refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(
      `Refresh token Google rifiutato (HTTP ${res.status}) — ricollega l'account da Impostazioni`
    );
  }
  const j: any = await res.json();
  oauthCachedToken = {
    token: j.access_token,
    expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000,
  };
  return oauthCachedToken.token;
}

// Find-or-create the app-owned backup root in the connected account's Drive.
// drive.file only sees files this app created, so the lookup is cheap and the
// folder survives being moved or renamed by the operator (we track its id).
async function ensureOAuthRoot(token: string): Promise<string> {
  const row = oauthRows[0];
  if (!row) throw new Error("Account Google non collegato");
  if (row.rootFolderId) {
    const res = await fetch(
      `${DRIVE}/files/${row.rootFolderId}?fields=id,trashed&supportsAllDrives=true`,
      { headers: { authorization: `Bearer ${token}` } }
    );
    if (res.ok) {
      const j: any = await res.json();
      if (!j.trashed) return row.rootFolderId;
    }
  }
  const id = await driveCreateFolder(token, "Backup CRM Ruffino", "root");
  row.rootFolderId = id;
  _oauthStore.save();
  saveOAuthFile();
  return id;
}

// Where does the backup root live right now? Lets the UI/operator verify the
// folder after moving it (drive.file still sees app-created files anywhere).
export async function checkBackupRoot(): Promise<{
  ok: boolean;
  name?: string;
  parents?: string[];
  trashed?: boolean;
  error?: string;
}> {
  try {
    const row = oauthRows[0];
    if (!row?.rootFolderId)
      return { ok: false, error: "Nessuna cartella di backup ancora creata" };
    const token = await getOAuthAccessToken();
    const res = await fetch(
      `${DRIVE}/files/${row.rootFolderId}?fields=id,name,trashed,parents&supportsAllDrives=true`,
      { headers: { authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const j: any = await res.json();
    return {
      ok: true,
      name: j.name,
      parents: j.parents ?? [],
      trashed: !!j.trashed,
    };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "errore" };
  }
}

type ServiceAccount = { client_email: string; private_key: string };

export function loadServiceAccount(): ServiceAccount | null {
  try {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
      ? process.env.GOOGLE_SERVICE_ACCOUNT_JSON
      : process.env.GOOGLE_SERVICE_ACCOUNT_FILE
        ? fs.readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_FILE, "utf8")
        : null;
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (!j.client_email || !j.private_key) return null;
    return { client_email: j.client_email, private_key: j.private_key };
  } catch {
    return null;
  }
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const b64url = (s: Buffer | string) =>
    Buffer.from(s)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/drive",
      aud: "https://oauth2.googleapis.com/token",
      iat: nowSec,
      exp: nowSec + 3600,
    })
  );
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer
    .sign(sa.private_key)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const jwt = `${header}.${claims}.${signature}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${jwt}`,
  });
  if (!res.ok) {
    throw new Error(
      `Token Google rifiutato (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`
    );
  }
  const j: any = await res.json();
  cachedToken = {
    token: j.access_token,
    expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000,
  };
  return cachedToken.token;
}

const DRIVE = "https://www.googleapis.com/drive/v3";

// ── Chiamate a Drive, con ritentativi ───────────────────────────────────────
// Drive risponde 503 "Transient failure" quando ha un problema suo, e 429 o
// 403 rateLimitExceeded quando le richieste arrivano troppo dense — un
// backup è 650 file di fila, quindi succede. Google documenta una cosa sola
// per questi casi: riprovare con attese crescenti.
//
// Senza ritentativi un singolo 503 sulla prima cartella buttava via l'intero
// backup notturno, ed è esattamente quello che è accaduto.

const TENTATIVI_DRIVE = 5;

/** Errori che passano da soli: ha senso solo riprovare. Esportata per i test. */
export function erroreTransitorio(status: number, corpo: string): boolean {
  if (status === 429 || status >= 500) return true;
  // 403 è ambiguo: permessi (definitivo) o quota di frequenza (transitorio).
  if (status === 403) {
    return /rateLimitExceeded|userRateLimitExceeded|backendError/i.test(corpo);
  }
  return false;
}

export function attesaMs(tentativo: number, retryAfter: string | null): number {
  const secondi = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(secondi) && secondi > 0) {
    return Math.min(secondi * 1000, 60_000);
  }
  // 1s, 2s, 4s, 8s… più un pizzico di casualità, così più richieste in coda
  // non ripartono tutte nello stesso istante.
  return (
    Math.min(1000 * 2 ** tentativo, 30_000) + Math.floor(Math.random() * 500)
  );
}

export async function driveFetch(
  url: string,
  init: RequestInit,
  cosa: string
): Promise<Response> {
  let ultimo = "";
  for (let tentativo = 0; tentativo < TENTATIVI_DRIVE; tentativo++) {
    const res = await fetch(url, init);
    if (res.ok) return res;

    const corpo = await res.text().catch(() => "");
    ultimo = `HTTP ${res.status}: ${corpo.slice(0, 300)}`;
    const ritentabile = erroreTransitorio(res.status, corpo);
    const ultimoGiro = tentativo === TENTATIVI_DRIVE - 1;

    if (!ritentabile) throw new Error(`${cosa} fallita (${ultimo})`);
    if (ultimoGiro) {
      throw new Error(
        `${cosa} fallita: Google Drive ha risposto ${res.status} anche dopo ${TENTATIVI_DRIVE} tentativi. Non è un problema di configurazione — è un guasto momentaneo di Drive. Riprova con «Esegui adesso», o aspetta il backup di stanotte.`
      );
    }

    const attesa = attesaMs(tentativo, res.headers.get("retry-after"));
    console.warn(
      `[backup] ${cosa}: ${ultimo} — ritento tra ${Math.round(attesa / 1000)}s (${tentativo + 1}/${TENTATIVI_DRIVE})`
    );
    await new Promise(r => setTimeout(r, attesa));
  }
  throw new Error(`${cosa} fallita (${ultimo})`);
}

async function driveFindFolder(
  token: string,
  name: string,
  parentId: string
): Promise<string | null> {
  const q = encodeURIComponent(
    `name = '${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  );
  const res = await driveFetch(
    `${DRIVE}/files?q=${q}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { authorization: `Bearer ${token}` } },
    `Ricerca della cartella "${name}" su Drive`
  );
  const j: any = await res.json();
  return j.files?.[0]?.id ?? null;
}

async function driveCreateFolder(
  token: string,
  name: string,
  parentId: string
): Promise<string> {
  const res = await driveFetch(
    `${DRIVE}/files?supportsAllDrives=true&fields=id`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId],
      }),
    },
    `Creazione della cartella "${name}" su Drive`
  );
  return ((await res.json()) as any).id;
}

async function driveUploadFile(
  token: string,
  name: string,
  mimeType: string,
  data: Buffer,
  parentId: string
): Promise<void> {
  const boundary = `bk${crypto.randomBytes(12).toString("hex")}`;
  const meta = JSON.stringify({ name, parents: [parentId] });
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`
    ),
    Buffer.from(
      `--${boundary}\r\ncontent-type: ${mimeType || "application/octet-stream"}\r\n\r\n`
    ),
    data,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  // Il corpo è un Buffer, non uno stream: si può rispedire tale e quale a
  // ogni tentativo.
  await driveFetch(
    `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
    `Caricamento di "${name}" su Drive`
  );
}

// ── Backup tree ──────────────────────────────────────────────────────────────

type BackupFile = {
  segments: string[]; // folder path inside the backup root
  name: string;
  mimeType: string;
  data: Buffer;
};

function sanitizeName(s: string): string {
  return (
    (s ?? "")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 90) || "senza-nome"
  );
}

function jsonFile(
  segments: string[],
  name: string,
  value: unknown
): BackupFile {
  return {
    segments,
    name,
    mimeType: "application/json",
    data: Buffer.from(JSON.stringify(value, null, 2), "utf8"),
  };
}

function sanitizeUtente(u: any) {
  const { password, ...rest } = u ?? {};
  return rest;
}

// Map upload doc tipo → human folder name.
function docFolder(tipo: string): string {
  if (tipo === "preventivo" || tipo === "contratto")
    return "Preventivi e contratti";
  if (tipo === "misure") return "Misure";
  if (tipo === "fattura" || tipo === "saldo") return "Fatture e pagamenti";
  if (tipo === "conferma_ordine") return "Ordini";
  if (tipo?.startsWith("ddt")) return "DDT";
  return "Foto e altro";
}

const fmtDate = (v: any) => {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("it-IT");
};

// Scheda cliente PDF — server-side twin of the one in ClienteDetail.
function buildSchedaPdf(
  c: any,
  commesse: any[],
  interventi: any[],
  tickets: any[],
  garanzie: any[],
  utenti: any[]
): Buffer {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const marginX = 14;
  const accent: [number, number, number] = [37, 99, 235];
  let y = 16;
  const displayName =
    `${c.cognome ?? ""} ${c.nome ?? ""}`.trim() || `Cliente ${c.id}`;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(`Scheda cliente — ${displayName}`, marginX, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(
    `Backup del ${new Date().toLocaleDateString("it-IT")} — Ruffino Flow`,
    marginX,
    y
  );
  doc.setTextColor(0);
  y += 4;

  const section = (title: string) => {
    if (y > 262) {
      doc.addPage();
      y = 16;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(title, marginX, y + 4);
    doc.setFont("helvetica", "normal");
    y += 7;
  };

  const assegnatario = utenti.find((u: any) => u.id === c.assegnatoA);
  const resRow = c.indirizzo
    ? `${c.indirizzo}${c.cap ? `, ${c.cap}` : ""}${c.citta ? ` ${c.citta}` : ""}`
    : "—";
  const lavRow =
    c.indirizzoLavoro || c.cittaLavoro
      ? `${c.indirizzoLavoro || c.indirizzo || ""}${c.capLavoro ? `, ${c.capLavoro}` : ""}${
          c.cittaLavoro || c.citta ? ` ${c.cittaLavoro || c.citta}` : ""
        }`.trim()
      : "Come residenza";

  autoTable(doc, {
    startY: y,
    head: [["Anagrafica", ""]],
    body: [
      ["Tipo", (c.tipo ?? "privato").replace(/_/g, " ")],
      ["Telefono", c.telefono || "—"],
      ["Email", c.email || "—"],
      ["Codice fiscale", c.codiceFiscale || "—"],
      ["Partita IVA", c.partitaIva || "—"],
      ["Residenza (fatturazione)", resRow],
      ["Indirizzo lavori", lavRow],
      ["Detrazione fiscale", c.detrazione ? c.tipoDetrazione || "Sì" : "No"],
      ["Pratica edilizia", c.praticaEdilizia ?? "nessuna"],
      ["Finanziamento", c.interesseFinanziamento ? "Interessato" : "No"],
      [
        "Assegnato a",
        assegnatario
          ? `${assegnatario.cognome ?? ""} ${assegnatario.nome ?? ""}`.trim()
          : "—",
      ],
    ],
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 1.8 },
    headStyles: { fillColor: accent, fontSize: 10 },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 52 } },
    margin: { left: marginX, right: marginX },
  });
  y = (doc as any).lastAutoTable.finalY + 5;

  if (c.note) {
    autoTable(doc, {
      startY: y,
      head: [["Note"]],
      body: [[c.note]],
      theme: "grid",
      styles: { fontSize: 9, cellPadding: 1.8 },
      headStyles: { fillColor: accent, fontSize: 10 },
      margin: { left: marginX, right: marginX },
    });
    y = (doc as any).lastAutoTable.finalY + 5;
  }

  if (commesse.length > 0) {
    section(`Commesse (${commesse.length})`);
    autoTable(doc, {
      startY: y,
      head: [["Codice", "Stato", "Priorità", "Città", "Consegna"]],
      body: commesse.map((cm: any) => [
        cm.codice ?? `#${cm.id}`,
        (cm.stato ?? "").replace(/_/g, " "),
        cm.priorita ?? "—",
        cm.citta || "—",
        cm.dataConsegnaConfermata
          ? fmtDate(cm.dataConsegnaConfermata)
          : cm.dataConsegnaIndicativa
            ? `${fmtDate(cm.dataConsegnaIndicativa)} (indicativa)`
            : cm.consegnaIndicativa
              ? `~${cm.consegnaIndicativa} gg`
              : "—",
      ]),
      theme: "striped",
      styles: { fontSize: 8.5, cellPadding: 1.6 },
      headStyles: { fillColor: accent, fontSize: 9 },
      margin: { left: marginX, right: marginX },
    });
    y = (doc as any).lastAutoTable.finalY + 5;
  }

  if (interventi.length > 0) {
    section(`Appuntamenti (${interventi.length})`);
    autoTable(doc, {
      startY: y,
      head: [["Data", "Ora", "Tipo", "Stato", "Note"]],
      body: interventi.map((i: any) => [
        fmtDate(i.dataPianificata),
        i.oraInizio ? `${i.oraInizio}${i.oraFine ? `–${i.oraFine}` : ""}` : "—",
        (i.tipo ?? "").replace(/_/g, " "),
        (i.stato ?? "pianificato").replace(/_/g, " "),
        i.note || "",
      ]),
      theme: "striped",
      styles: { fontSize: 8.5, cellPadding: 1.6 },
      headStyles: { fillColor: accent, fontSize: 9 },
      margin: { left: marginX, right: marginX },
    });
    y = (doc as any).lastAutoTable.finalY + 5;
  }

  if (tickets.length > 0) {
    section(`Ticket assistenza (${tickets.length})`);
    autoTable(doc, {
      startY: y,
      head: [["#", "Oggetto", "Categoria", "Priorità", "Stato"]],
      body: tickets.map((t: any) => [
        `#${t.id}`,
        t.oggetto ?? "—",
        (t.categoria ?? "").replace(/_/g, " "),
        t.priorita ?? "—",
        (t.stato ?? "").replace(/_/g, " "),
      ]),
      theme: "striped",
      styles: { fontSize: 8.5, cellPadding: 1.6 },
      headStyles: { fillColor: accent, fontSize: 9 },
      margin: { left: marginX, right: marginX },
    });
    y = (doc as any).lastAutoTable.finalY + 5;
  }

  if (garanzie.length > 0) {
    section(`Garanzie (${garanzie.length})`);
    autoTable(doc, {
      startY: y,
      head: [["Tipo", "Descrizione", "Fornitore", "Scadenza"]],
      body: garanzie.map((g: any) => [
        g.tipo ?? "—",
        g.descrizione ?? "—",
        g.fornitore || "—",
        fmtDate(g.dataScadenza),
      ]),
      theme: "striped",
      styles: { fontSize: 8.5, cellPadding: 1.6 },
      headStyles: { fillColor: accent, fontSize: 9 },
      margin: { left: marginX, right: marginX },
    });
  }

  return Buffer.from(doc.output("arraybuffer"));
}

function snapshotByKey(): Record<string, any[]> {
  const out: Record<string, any[]> = {};
  for (const s of getAllStoreSnapshots()) out[s.key] = s.items;
  return out;
}

type BackupFileRecord = {
  id?: number;
  nome?: string;
  dataBase64?: string | null;
  storageKey?: string | null;
  checksum?: string | null;
};

/**
 * Resolve the canonical bytes for a record included in the backup.
 * Migrated records use object storage; legacy records still use inline base64.
 */
export async function resolveBackupFileData(
  record: BackupFileRecord,
  load: (storageKey: string) => Promise<Buffer | null> = getFile
): Promise<Buffer | null> {
  const label =
    record.nome || (record.id != null ? `#${record.id}` : "senza nome");
  if (record.storageKey) {
    const data = await load(record.storageKey);
    if (!data) {
      throw new Error(
        `Backup incompleto: file \"${label}\" non trovato nello storage (${record.storageKey})`
      );
    }
    if (record.checksum && sha256Hex(data) !== record.checksum) {
      throw new Error(
        `Backup incompleto: checksum non valido per \"${label}\" (${record.storageKey})`
      );
    }
    return data;
  }
  if (record.dataBase64) return Buffer.from(record.dataBase64, "base64");
  return null;
}

export async function buildBackupTree(): Promise<{
  rootName: string;
  files: BackupFile[];
}> {
  const stores = snapshotByKey();
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  const rootName = `Backup CRM ${y}-${m}-${d}`;

  const files: BackupFile[] = [];

  // 1. Raw database dump — everything, restorable.
  for (const [key, items] of Object.entries(stores)) {
    if (key === "backup_log") continue; // noise
    const value = key === "utenti" ? items.map(sanitizeUtente) : items;
    files.push(jsonFile(["database"], `${key}.json`, value));
  }

  const sedi: any[] = stores["sedi"] ?? [];
  const utenti: any[] = (stores["utenti"] ?? []).map(sanitizeUtente);
  const clienti: any[] = stores["clienti"] ?? [];
  const commesse: any[] = stores["commesse"] ?? [];
  const documenti: any[] = stores["preventivi_documenti"] ?? [];
  const tickets: any[] = stores["tickets"] ?? [];
  const ticketAllegati: any[] = stores["ticket_allegati"] ?? [];
  const interventi: any[] = stores["interventi"] ?? [];
  const garanzie: any[] = stores["garanzie"] ?? [];

  const sediList = sedi.length > 0 ? sedi : [{ id: 1, nome: "Principale" }];

  for (const sede of sediList) {
    const sedeSeg = `Sede ${sanitizeName(sede.nome ?? `#${sede.id}`)}`;

    // Users assigned to the sede (sediIds array, legacy single sedeId).
    const sedeUtenti = utenti.filter((u: any) => {
      const ids: number[] = Array.isArray(u.sediIds)
        ? u.sediIds
        : u.sedeId
          ? [u.sedeId]
          : [];
      return ids.length === 0 || ids.includes(sede.id);
    });
    files.push(jsonFile([sedeSeg], "Utenti.json", sedeUtenti));

    for (const c of clienti.filter((x: any) => (x.sedeId ?? 1) === sede.id)) {
      const displayName =
        `${c.cognome ?? ""} ${c.nome ?? ""}`.trim() || `Cliente ${c.id}`;
      const clienteSeg = [
        sedeSeg,
        "Clienti",
        `${sanitizeName(displayName)} (CL-${c.id})`,
      ];

      const clienteCommesse = commesse.filter(
        (cm: any) =>
          cm.clienteId === c.id || (c.commesseIds ?? []).includes(cm.id)
      );
      const commessaIds = new Set(clienteCommesse.map((cm: any) => cm.id));
      const clienteInterventi = interventi.filter((i: any) =>
        commessaIds.has(i.commessaId)
      );
      const clienteTicket = tickets.filter((t: any) =>
        commessaIds.has(t.commessaId)
      );
      const clienteGaranzie = garanzie.filter((g: any) =>
        commessaIds.has(g.commessaId)
      );

      files.push(jsonFile(clienteSeg, "cliente.json", c));
      try {
        files.push({
          segments: clienteSeg,
          name: "Scheda cliente.pdf",
          mimeType: "application/pdf",
          data: buildSchedaPdf(
            c,
            clienteCommesse,
            clienteInterventi,
            clienteTicket,
            clienteGaranzie,
            utenti
          ),
        });
      } catch (e: any) {
        files.push(
          jsonFile(clienteSeg, "scheda-errore.json", {
            errore: e?.message ?? "PDF generation failed",
          })
        );
      }

      for (const cm of clienteCommesse) {
        const cmSeg = [
          ...clienteSeg,
          "Commesse",
          sanitizeName(cm.codice ?? `COM-${cm.id}`),
        ];
        files.push(jsonFile(cmSeg, "commessa.json", cm));

        // Uploaded documents grouped by type.
        for (const doc of documenti.filter(
          (x: any) => x.commessaId === cm.id
        )) {
          const data = await resolveBackupFileData(doc);
          if (!data) continue;
          files.push({
            segments: [...cmSeg, docFolder(doc.tipo)],
            name: sanitizeName(doc.nome ?? `doc-${doc.id}`),
            mimeType: doc.mimeType || "application/octet-stream",
            data,
          });
        }

        // Ticket attachments under the commessa.
        for (const t of clienteTicket.filter(
          (x: any) => x.commessaId === cm.id
        )) {
          const all = ticketAllegati.filter((a: any) => a.ticketId === t.id);
          for (const a of all) {
            const data = await resolveBackupFileData(a);
            if (!data) continue;
            files.push({
              segments: [...cmSeg, `Ticket ${t.id}`],
              name: sanitizeName(a.nome ?? `allegato-${a.id}`),
              mimeType: a.mimeType || "application/octet-stream",
              data,
            });
          }
        }
      }
    }

    // Commesse of the sede without a linked cliente — still backed up.
    const orphan = commesse.filter(
      (cm: any) =>
        (cm.sedeId ?? 1) === sede.id &&
        !clienti.some(
          (c: any) =>
            c.id === cm.clienteId || (c.commesseIds ?? []).includes(cm.id)
        )
    );
    for (const cm of orphan) {
      const cmSeg = [
        sedeSeg,
        "Commesse senza cliente",
        sanitizeName(cm.codice ?? `COM-${cm.id}`),
      ];
      files.push(jsonFile(cmSeg, "commessa.json", cm));
      for (const doc of documenti.filter((x: any) => x.commessaId === cm.id)) {
        const data = await resolveBackupFileData(doc);
        if (!data) continue;
        files.push({
          segments: [...cmSeg, docFolder(doc.tipo)],
          name: sanitizeName(doc.nome ?? `doc-${doc.id}`),
          mimeType: doc.mimeType || "application/octet-stream",
          data,
        });
      }

      for (const t of tickets.filter((x: any) => x.commessaId === cm.id)) {
        for (const a of ticketAllegati.filter(
          (x: any) => x.ticketId === t.id
        )) {
          const data = await resolveBackupFileData(a);
          if (!data) continue;
          files.push({
            segments: [...cmSeg, `Ticket ${t.id}`],
            name: sanitizeName(a.nome ?? `allegato-${a.id}`),
            mimeType: a.mimeType || "application/octet-stream",
            data,
          });
        }
      }
    }
  }

  return { rootName, files };
}

// ── Writers ──────────────────────────────────────────────────────────────────

async function writeLocal(
  rootName: string,
  files: BackupFile[]
): Promise<void> {
  const base = path.join(process.cwd(), "backups", rootName);
  for (const f of files) {
    const dir = path.join(base, ...f.segments.map(sanitizeName));
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, f.name), f.data);
  }
}

async function writeDrive(
  token: string,
  folderId: string,
  rootName: string,
  files: BackupFile[]
): Promise<void> {
  const folderCache = new Map<string, string>();

  async function ensureFolder(segments: string[]): Promise<string> {
    let parent = folderId;
    let keyPath = "";
    for (const seg of [rootName, ...segments]) {
      keyPath += `/${seg}`;
      const hit = folderCache.get(keyPath);
      if (hit) {
        parent = hit;
        continue;
      }
      const found = await driveFindFolder(token, seg, parent);
      const id = found ?? (await driveCreateFolder(token, seg, parent));
      folderCache.set(keyPath, id);
      parent = id;
    }
    return parent;
  }

  for (const f of files) {
    const parent = await ensureFolder(f.segments);
    await driveUploadFile(token, f.name, f.mimeType, f.data, parent);
  }
}

// ── Runner + scheduler ───────────────────────────────────────────────────────

let running = false;

export async function runBackup(
  trigger: "schedulato" | "manuale"
): Promise<BackupLog> {
  if (running) throw new Error("Backup già in corso");
  running = true;
  const cfg = getConfig();
  const log: BackupLog = {
    id: nextLogId++,
    startedAt: new Date(),
    finishedAt: null,
    ok: null,
    target: null,
    trigger,
    rootName: "",
    files: 0,
    bytes: 0,
    error: null,
  };
  logRows.push(log);
  // Keep the log bounded.
  while (logRows.length > 60) logRows.shift();
  _logStore.save();

  try {
    const { rootName, files } = await buildBackupTree();
    log.rootName = rootName;
    log.files = files.length;
    log.bytes = files.reduce((s, f) => s + f.data.length, 0);

    // Mode priority: connected user account (OAuth) → service account →
    // local disk fallback. OAuth first because personal Google accounts
    // reject service-account uploads (no storage quota).
    const oauthReady = oauthClientFromEnv() && oauthRows.length > 0;
    const sa = loadServiceAccount();
    if (oauthReady) {
      const token = await getOAuthAccessToken();
      const base = await ensureOAuthRoot(token);
      await writeDrive(token, base, rootName, files);
      log.target = "drive";
    } else if (sa) {
      const token = await getAccessToken(sa);
      await writeDrive(token, cfg.folderId, rootName, files);
      log.target = "drive";
    } else {
      await writeLocal(rootName, files);
      log.target = "locale";
    }
    log.ok = true;
  } catch (e: any) {
    log.ok = false;
    log.error = e?.message ?? "Errore sconosciuto";
  } finally {
    log.finishedAt = new Date();
    _logStore.save();
    running = false;
  }
  return log;
}

function msUntilRomeMidnight(): number {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const [h, m, s] = fmt.format(new Date()).split(":").map(Number);
  const elapsed = h * 3600 + m * 60 + s;
  // Never below 60s — protects against clock weirdness double-firing.
  return Math.max((86400 - elapsed) * 1000, 60_000);
}

let scheduled: NodeJS.Timeout | null = null;

// Ritentativi della notte. Il wrapper su Drive copre il singolo 503; questo
// copre il caso in cui Drive sia giù per qualche minuto — succede, e senza
// questo la notte resta senza backup fino a 24 ore dopo.
const RITENTATIVI_NOTTURNI = 3;
const ATTESA_RITENTATIVO_MS = 20 * 60_000;

async function backupNotturnoConRitentativi(): Promise<void> {
  for (let tentativo = 1; tentativo <= RITENTATIVI_NOTTURNI; tentativo++) {
    const log = await runBackup("schedulato");
    if (log.ok) return;
    if (tentativo === RITENTATIVI_NOTTURNI) {
      console.error(
        `[backup] notturno fallito ${RITENTATIVI_NOTTURNI} volte, ultimo errore: ${log.error}`
      );
      return;
    }
    console.warn(
      `[backup] notturno fallito (${log.error}) — ritento tra 20 minuti (${tentativo}/${RITENTATIVI_NOTTURNI})`
    );
    await new Promise(r => setTimeout(r, ATTESA_RITENTATIVO_MS));
  }
}

export function startBackupScheduler(): void {
  if (scheduled) return;
  const arm = () => {
    const delay = msUntilRomeMidnight();
    scheduled = setTimeout(async () => {
      try {
        if (getConfig().enabled) {
          await backupNotturnoConRitentativi();
        }
      } catch (e) {
        console.error("[backup] nightly run failed:", e);
      } finally {
        arm(); // re-arm for the next midnight regardless of outcome
      }
    }, delay);
    // Don't keep the process alive only for the timer.
    scheduled.unref?.();
    console.log(
      `[backup] prossimo backup automatico tra ${Math.round(delay / 60000)} minuti (00:00 Europe/Rome)`
    );
  };
  arm();
}

export function backupStatus() {
  const cfg = getConfig();
  const sa = loadServiceAccount();
  const oauthRow = oauthRows[0] ?? null;
  const oauthClientReady = !!oauthClientFromEnv();
  const mode: "oauth" | "service_account" | null =
    oauthClientReady && oauthRow ? "oauth" : sa ? "service_account" : null;
  const last = [...logRows].sort((a, b) => b.id - a.id)[0] ?? null;
  return {
    driveConfigurato: mode !== null,
    mode,
    oauthClientReady,
    oauthEmail: oauthRow?.email ?? null,
    rootFolderId: oauthRow?.rootFolderId ?? null,
    serviceAccountEmail: sa?.client_email ?? null,
    folderId: cfg.folderId,
    enabled: cfg.enabled,
    inCorso: running,
    ultimoBackup: last,
    prossimoTraMs: cfg.enabled ? msUntilRomeMidnight() : null,
  };
}

export function backupLog(limit = 15) {
  return [...logRows].sort((a, b) => b.id - a.id).slice(0, limit);
}
