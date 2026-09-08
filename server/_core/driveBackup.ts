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
import {
  persistedStore,
  getAllStoreSnapshots,
  type LoadMeta,
} from "./persistence";
import { conTenantDellaSede, perOgniTenantAttivo } from "../tenants/giri";
import { sediDelTenant } from "../routers/sedi";
import { presidioDi } from "../tenants/regole";
import { conTenant, tenantCorrente } from "../tenants/contestoCorrente";
import { getTenantRepository } from "../tenants/repository";
import { TENANT_PREDEFINITO_ID } from "../tenants/costanti";
import { decryptSecret, encryptSecret, secretBoxConfigured } from "./secretBox";
import { PRODOTTO } from "@shared/brand";

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

const _configStore = persistedStore<BackupConfig>("backup_config", (rows, meta) => {
  // Per azienda (WS3): il tenant 1 tiene la riga di sempre (alias della chiave
  // nuda); le altre partono senza cartella condivisa — il loro Drive è il loro.
  if (rows.length === 0 && meta.tenantId != null && meta.tenantId !== TENANT_PREDEFINITO_ID) {
    rows.push({ id: 1, folderId: "", enabled: true });
  }
});
const configRows = _configStore.items;

/**
 * L'azienda del contesto, o un errore. Dal WS3 il backup è di un'azienda
 * sola: token, cartella radice, configurazione e log sono i suoi. Un
 * chiamante fuori contesto (un timer, una rotta anonima) deve dichiarare il
 * tenant con `conTenant`, non ripiegare in silenzio su Ruffino Group.
 */
function tenantObbligatorio(): number {
  const t = tenantCorrente();
  if (t == null) throw new Error("[backup] operazione senza tenant nel contesto");
  return t;
}

function getConfig(): BackupConfig {
  if (configRows.length === 0) {
    // La cartella condivisa del service account è di Ruffino Group: nessuna
    // altra azienda la eredita (il suo backup passa dal proprio OAuth).
    const folderId = tenantObbligatorio() === TENANT_PREDEFINITO_ID ? DEFAULT_FOLDER_ID : "";
    configRows.push({ id: 1, folderId, enabled: true });
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

const _logStore = persistedStore<BackupLog>("backup_log", () => {});
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
  /** Cifrato con MAIL_ENCRYPTION_KEY (WS3): il campo in chiaro `refreshToken` esiste solo nei blob del WS2 e sparisce al caricamento. */
  refreshTokenCifrato: string;
  refreshToken?: string;
  email: string | null;
  rootFolderId: string | null;
  connectedAt: Date;
};

// ── Specchio su file delle credenziali OAuth, uno per azienda ───────────────
// persistedStore is Postgres-backed; without DATABASE_URL (local installs)
// it's memory-only and the refresh token would die on every restart, forcing
// a re-authorization. The token is too important for that: mirror it to a
// mode-600 file under ./data and reload it at boot when the store is empty.
// Il tenant 1 conserva `data/backup-oauth.json` — il file esiste già in
// produzione; ogni altra azienda ha il suo, come ha il suo archivio.
function fileOAuth(tenantId: number): string {
  return path.join(
    process.cwd(),
    "data",
    tenantId === TENANT_PREDEFINITO_ID
      ? "backup-oauth.json"
      : `backup-oauth-${tenantId}.json`
  );
}

/**
 * Nei test lo specchio su disco non si tocca, né in lettura né in scrittura.
 * La suite gira anche su un'installazione vera: senza questa guardia un giro
 * di `pnpm test` leggeva `data/backup-oauth.json`, lo cifrava con la chiave
 * di prova e lo riscriveva — il token buono diventava illeggibile. (È
 * successo la prima volta che questi test sono girati.)
 */
function specchioSuFileDisattivato(): boolean {
  return process.env.NODE_ENV === "test";
}

function salvaOAuthSuFile(rows: OAuthRow[], tenantId: number): void {
  if (specchioSuFileDisattivato()) return;
  try {
    const file = fileOAuth(tenantId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // La riga è già cifrata: sul disco finisce ciphertext, mai il token.
    fs.writeFileSync(file, JSON.stringify(rows[0] ?? null), { mode: 0o600 });
  } catch (e) {
    console.error("[backup] impossibile salvare il token su file:", e);
  }
}

function caricaOAuthDaFile(rows: OAuthRow[], tenantId: number): void {
  if (specchioSuFileDisattivato()) return;
  try {
    if (rows.length > 0) return; // DB row wins
    const file = fileOAuth(tenantId);
    if (!fs.existsSync(file)) return;
    const row = JSON.parse(fs.readFileSync(file, "utf8"));
    // Accetta sia lo specchio nuovo (cifrato) sia quello del WS2 (in chiaro):
    // il secondo lo cifra la migrazione qui sotto, subito dopo.
    if (row?.refreshTokenCifrato || row?.refreshToken) {
      rows.push({ ...row, connectedAt: new Date(row.connectedAt) });
    }
  } catch (e) {
    console.error("[backup] impossibile leggere il token da file:", e);
  }
}

/** L'`onLoad` di `backup_oauth`: specchio su file e cifratura dei blob del WS2. */
function alCaricamentoOAuth(rows: OAuthRow[], meta: LoadMeta): void {
  const tenantId = meta.tenantId ?? TENANT_PREDEFINITO_ID;
  if (rows.length === 0) caricaOAuthDaFile(rows, tenantId);
  // Migrazione a senso unico (spec §4.2, §11): un rollback al codice precedente
  // non rilegge il token cifrato e il Drive va ricollegato — è scritto nel runbook.
  for (const r of rows) {
    if (r.refreshToken && !r.refreshTokenCifrato) {
      if (!secretBoxConfigured()) {
        console.warn(
          `[backup] tenant ${tenantId}: MAIL_ENCRYPTION_KEY assente, il refresh token resta in chiaro`
        );
        continue;
      }
      r.refreshTokenCifrato = encryptSecret(r.refreshToken);
      delete r.refreshToken;
      // `save()` del Proxy salva l'istanza del tenant NEL CONTESTO, e il
      // caricamento gira fuori da ogni contesto: si dichiara il tenant.
      conTenant(tenantId, () => _oauthStore.save());
      salvaOAuthSuFile(rows, tenantId);
    }
  }
}

const _oauthStore = persistedStore<OAuthRow>("backup_oauth", alCaricamentoOAuth);
const oauthRows = _oauthStore.items;

/** Solo nei test: la stessa funzione che `persistedStore` riceve come `onLoad`. */
export function __alCaricamentoOAuthPerTest(rows: OAuthRow[], meta: LoadMeta): void {
  if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY_CARICAMENTO_OAUTH");
  alCaricamentoOAuth(rows, meta);
}

/** Il refresh token della riga: cifrato di norma, in chiaro solo se la migrazione non ha potuto girare. */
function refreshTokenDi(row: OAuthRow): string {
  if (row.refreshTokenCifrato) return decryptSecret(row.refreshTokenCifrato);
  if (row.refreshToken) return row.refreshToken;
  throw new Error("Account Google non collegato");
}

export function oauthClientFromEnv(): {
  clientId: string;
  clientSecret: string;
} | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

// Lo `state` anti-CSRF vive in `oauth_state` (control plane, WS3 spec §5),
// non più in una mappa di processo: sopravvive a un deploy fra l'avvio del
// collegamento e il ritorno da Google, e dice da quale azienda e da quale
// utente era partito. Consumo una tantum, TTL di 10 minuti.
export async function issueOAuthState(utenteId: number): Promise<string> {
  return getTenantRepository().emettiStateOAuth({
    tipo: "gdrive",
    tenantId: tenantObbligatorio(),
    sedeId: null,
    utenteId,
    payload: {},
  });
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
  // La rotta è anonima: quale sia l'azienda lo dice lo state, non il contesto.
  const riga = await getTenantRepository().consumaStateOAuth(state, "gdrive");
  if (!riga) throw new Error("Stato OAuth non valido o scaduto");
  const client = oauthClientFromEnv();
  if (!client) throw new Error("Client OAuth non configurato");
  // Il refresh token vive solo cifrato (spec §4.2): senza chiave non si
  // salva, e lo si dice prima di andare a prenderlo da Google.
  if (!secretBoxConfigured()) {
    throw new Error(
      "MAIL_ENCRYPTION_KEY non configurata sul server: senza chiave il refresh token di Drive non può essere salvato."
    );
  }
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
  // Da qui in giù si scrive nell'archivio dell'azienda dello state.
  conTenant(riga.tenantId, () => {
    oauthRows.length = 0;
    oauthRows.push({
      id: 1,
      refreshTokenCifrato: encryptSecret(j.refresh_token),
      email,
      rootFolderId: null,
      connectedAt: new Date(),
    });
    oauthCachedToken.delete(riga.tenantId);
    _oauthStore.save();
    salvaOAuthSuFile(oauthRows, riga.tenantId);
  });
}

export function disconnectOAuth(): void {
  const tenantId = tenantObbligatorio();
  oauthRows.length = 0;
  oauthCachedToken.delete(tenantId);
  _oauthStore.save();
  // La stessa guardia delle altre due strade dello specchio: un test che
  // scollega il Drive non deve cancellare il `data/backup-oauth.json` di
  // un'installazione vera (la suite gira anche lì).
  if (specchioSuFileDisattivato()) return;
  try {
    fs.rmSync(fileOAuth(tenantId), { force: true });
  } catch {
    /* ignore */
  }
}

// Un token d'accesso per azienda: la cache non deve mai servire a un'azienda
// il token di un'altra (spec §4.1).
const oauthCachedToken = new Map<number, { token: string; expiresAt: number }>();

async function getOAuthAccessToken(): Promise<string> {
  const tenantId = tenantObbligatorio();
  const inCache = oauthCachedToken.get(tenantId);
  if (inCache && Date.now() < inCache.expiresAt - 60_000) return inCache.token;
  const client = oauthClientFromEnv();
  const row = oauthRows[0];
  if (!client || !row) throw new Error("Account Google non collegato");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: refreshTokenDi(row),
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(
      `Refresh token Google rifiutato (HTTP ${res.status}) — ricollega l'account da Impostazioni`
    );
  }
  const j: any = await res.json();
  const nuovo = {
    token: j.access_token as string,
    expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000,
  };
  oauthCachedToken.set(tenantId, nuovo);
  return nuovo.token;
}

/** 1 → la cartella di sempre; ogni altra azienda ha la sua, col suo nome. */
export function nomeCartellaRadice(tenantId: number): string {
  if (tenantId === TENANT_PREDEFINITO_ID) return "Backup CRM Ruffino";
  const nome = getTenantRepository().perId(tenantId)?.nome ?? `azienda ${tenantId}`;
  return `Backup ${PRODOTTO} — ${nome}`;
}

// Find-or-create the app-owned backup root in the connected account's Drive.
// drive.file only sees files this app created, so the lookup is cheap and the
// folder survives being moved or renamed by the operator (we track its id).
async function ensureOAuthRoot(token: string): Promise<string> {
  const tenantId = tenantObbligatorio();
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
  // Il nome della cartella del tenant 1 è la chiave con cui si ritrovano i
  // backup già fatti (driveBackup.brand.test.ts): non si rinomina.
  const id =
    tenantId === TENANT_PREDEFINITO_ID
      ? await driveCreateFolder(token, "Backup CRM Ruffino", "root")
      : await driveCreateFolder(token, nomeCartellaRadice(tenantId), "root");
  row.rootFolderId = id;
  _oauthStore.save();
  salvaOAuthSuFile(oauthRows, tenantId);
  return id;
}

/** Token e cartella radice dell'azienda del contesto (Task 8). */
export async function tokenERadiceDelTenant(): Promise<{ token: string; rootId: string }> {
  const token = await getOAuthAccessToken();
  return { token, rootId: await ensureOAuthRoot(token) };
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

/**
 * I figli di una cartella su Drive (WS3 §4.4, ripristino): la `q` è costruita
 * come in `driveFindFolder`, ma qui serve la lista intera — i `<nome>.json`
 * di `database/` — non il primo id. Passa da `driveFetch`, quindi eredita i
 * ritentativi sui 429/503 di Drive.
 *
 * Legge UNA pagina sola (`pageSize=1000`, nessun `nextPageToken`): i due usi
 * sono `database/`, che tiene qualche decina di file — uno per store — e la
 * radice dell'azienda, dove la ricerca è già filtrata per nome. Mille è un
 * tetto che nessuno dei due sfiora; se un giorno lo sfiorasse, qui servirebbe
 * il ciclo sulle pagine, non un `pageSize` più grande.
 */
export async function driveElencaFigli(
  token: string,
  parentId: string,
  filtro: { nome?: string; soloCartelle?: boolean } = {}
): Promise<Array<{ id: string; name: string; mimeType: string }>> {
  const parti = [`'${parentId}' in parents`, "trashed = false"];
  if (filtro.nome) parti.push(`name = '${filtro.nome.replace(/'/g, "\\'")}'`);
  if (filtro.soloCartelle) parti.push("mimeType = 'application/vnd.google-apps.folder'");
  const q = encodeURIComponent(parti.join(" and "));
  const res = await driveFetch(
    `${DRIVE}/files?q=${q}&fields=files(id,name,mimeType)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { authorization: `Bearer ${token}` } },
    "Elenco di una cartella su Drive"
  );
  return (((await res.json()) as any).files ?? []) as Array<{ id: string; name: string; mimeType: string }>;
}

/** Il contenuto di un dump `database/<nome>.json` del backup (WS3 §4.4). */
export async function driveScaricaJson(token: string, fileId: string): Promise<unknown> {
  const res = await driveFetch(
    `${DRIVE}/files/${fileId}?alt=media&supportsAllDrives=true`,
    { headers: { authorization: `Bearer ${token}` } },
    "Scaricamento di un dump da Drive"
  );
  return res.json();
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

// Nel backup non finisce materiale di password, con nessuno dei due nomi che
// il codice usa: `password` è il campo dello store (contiene l'hash),
// `passwordHash` è il nome dell'input di `creaUtenteInterno` — un domani
// potrebbe essere anche quello del campo.
function sanitizeUtente(u: any) {
  const { password, passwordHash, ...rest } = u ?? {};
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
    `Backup del ${new Date().toLocaleDateString("it-IT")} — ${PRODOTTO}`,
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

/**
 * Gli store dell'azienda del contesto, per NOME (mai la chiave
 * `tenant:n:…`), con le famiglie globali filtrate.
 *
 * `getAllStoreSnapshots()` è la fotografia dell'INTERA installazione: ogni
 * istanza di ogni famiglia, tutte le aziende insieme. Finito nel Drive di
 * un'azienda, quel dump le avrebbe consegnato l'archivio delle altre — il
 * backup è l'unico punto in cui gli store si leggono senza passare dal
 * Proxy del tenant, quindi il filtro è qui e non altrove. Le quattro
 * famiglie globali (`server/_core/storeGlobali.test.ts`) non hanno un
 * `tenantId` di istanza e vanno filtrate riga per riga: `sedi` e `utenti`
 * per tenant, i due `platform_feature_flag*` per le sedi dell'azienda
 * (i loro record sono per sede, non per tenant — v. `FAMIGLIE_GLOBALI_PER_SEDE`
 * in server/tenants/verifica.ts).
 */
function snapshotDelTenant(tenantId: number): Record<string, any[]> {
  const out: Record<string, any[]> = {};
  const sediMie = new Set(sediDelTenant(tenantId).map(s => s.id));
  for (const s of getAllStoreSnapshots()) {
    if (s.tenantId === tenantId) {
      out[s.nome] = s.items;
      continue;
    }
    if (s.tenantId != null) continue; // istanza di un'altra azienda
    switch (s.nome) {
      case "sedi":
        out.sedi = s.items.filter(
          (x: any) => (x.tenantId ?? TENANT_PREDEFINITO_ID) === tenantId
        );
        break;
      case "utenti":
        out.utenti = s.items.filter((u: any) => presidioDi(u).tenantId === tenantId);
        break;
      case "platform_feature_flags":
      case "platform_feature_flag_audit":
        out[s.nome] = s.items.filter((x: any) => sediMie.has(x.sedeId));
        break;
      default:
        break; // nessun'altra famiglia globale (storeGlobali.test.ts)
    }
  }
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
  // L'albero è di UN'AZIENDA: quella del contesto. Il timer notturno gira
  // fuori da ogni richiesta e dichiara il tenant a ogni giro (giroNotturno).
  const tenantId = tenantObbligatorio();
  const stores = snapshotDelTenant(tenantId);
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  const rootName = `Backup CRM ${y}-${m}-${d}`;

  const files: BackupFile[] = [];

  // 1. Raw database dump — l'archivio dell'azienda, ripristinabile. I nomi
  // sono quelli delle famiglie (`clienti.json`), mai le chiavi di istanza
  // (`tenant:2:clienti.json`): chi ripristina legge un albero che non
  // racconta niente delle altre aziende.
  for (const [nome, items] of Object.entries(stores)) {
    if (nome === "backup_log") continue; // noise
    // `backup_oauth` custodisce il refresh token cifrato del Drive
    // dell'azienda: un segreto a riposo non parte per il Drive stesso, dove
    // chiunque abbia accesso alla cartella lo leggerebbe. Il ripristino lo
    // salta comunque (STORE_ESCLUSI_DAL_RIPRISTINO), quindi non manca a nessuno.
    if (nome === "backup_oauth") continue;
    const value = nome === "utenti" ? items.map(sanitizeUtente) : items;
    files.push(jsonFile(["database"], `${nome}.json`, value));
  }

  // `sedi` e `utenti` sono store globali: `snapshotDelTenant` li ha già
  // filtrati sull'azienda del contesto.
  const sedi: any[] = stores["sedi"] ?? [];
  const utenti: any[] = (stores["utenti"] ?? []).map(sanitizeUtente);
  // Tutto il resto è già dell'azienda: `stores[nome]` è la sua istanza.
  const di = (nome: string): any[] => stores[nome] ?? [];

  // Il ripiego «Principale» è la sede implicita di Ruffino Group prima che
  // le sedi esistessero: un'altra azienda senza sedi non ha niente da
  // salvare per sede, e inventargliene una la manderebbe su una sede che
  // non è sua (`conTenantDellaSede` lancerebbe, giustamente).
  const sediList =
    sedi.length > 0
      ? sedi
      : tenantId === TENANT_PREDEFINITO_ID
        ? [{ id: 1, nome: "Principale" }]
        : [];

  for (const sede of sediList) {
    // Il backup gira su un timer, fuori da ogni richiesta: il contesto
    // del tenant della sede copre anche quel che il corpo chiama a valle.
    await conTenantDellaSede(sede.id, async () => {
      const clienti = di("clienti");
      const commesse = di("commesse");
      const documenti = di("preventivi_documenti");
      const tickets = di("tickets");
      const ticketAllegati = di("ticket_allegati");
      const interventi = di("interventi");
      const garanzie = di("garanzie");

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
    });
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

// Un backup per volta PER AZIENDA: due aziende diverse possono girare
// insieme, la stessa azienda no (spec §4.1).
const running = new Set<number>();

export async function runBackup(
  trigger: "schedulato" | "manuale"
): Promise<BackupLog> {
  const tenantId = tenantObbligatorio();
  if (running.has(tenantId)) throw new Error("Backup già in corso");
  running.add(tenantId);
  const cfg = getConfig();
  const log: BackupLog = {
    id: _logStore.prossimoId(),
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
    // I due ripieghi valgono SOLO per Ruffino Group: il service account
    // scrive nella sua cartella condivisa e il disco è quello del server.
    // Per un'altra azienda il Drive è il suo: senza OAuth il backup fallisce
    // e lo dice nel log, invece di finire da qualche altra parte.
    const oauthReady = oauthClientFromEnv() && oauthRows.length > 0;
    const sa = tenantId === TENANT_PREDEFINITO_ID ? loadServiceAccount() : null;
    if (oauthReady) {
      const token = await getOAuthAccessToken();
      const base = await ensureOAuthRoot(token);
      await writeDrive(token, base, rootName, files);
      log.target = "drive";
    } else if (sa) {
      const token = await getAccessToken(sa);
      await writeDrive(token, cfg.folderId, rootName, files);
      log.target = "drive";
    } else if (tenantId === TENANT_PREDEFINITO_ID) {
      await writeLocal(rootName, files);
      log.target = "locale";
    } else {
      throw new Error(
        "Account Google non collegato: collega il Drive dell'azienda da Integrazioni → Backup"
      );
    }
    log.ok = true;
  } catch (e: any) {
    log.ok = false;
    log.error = e?.message ?? "Errore sconosciuto";
  } finally {
    log.finishedAt = new Date();
    _logStore.save();
    running.delete(tenantId);
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
let ATTESA_RITENTATIVO_MS = 20 * 60_000;

/** Solo nei test: i tre tentativi senza i 20 minuti veri fra l'uno e l'altro. `null` rimette l'attesa di produzione. */
export function __impostaAttesaRitentativoPerTest(ms: number | null): void {
  if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY_ATTESA_RITENTATIVO");
  ATTESA_RITENTATIVO_MS = ms ?? 20 * 60_000;
}

/**
 * I tre tentativi della notte, e RESTITUISCE l'ultimo log invece di
 * inghiottirlo (fix wave finale, R16): `runBackup` non lancia mai — scrive
 * l'errore nel log — quindi senza questo valore di ritorno chi chiama non
 * saprebbe mai che il backup di quell'azienda non c'è, e l'interruttore per
 * (worker, azienda) non potrebbe scattare. I due log restano quelli di
 * prima: un avviso a ogni ritentativo, un errore dopo l'ultimo.
 */
async function backupNotturnoConRitentativi(): Promise<BackupLog> {
  let ultimo = await runBackup("schedulato");
  for (let tentativo = 2; tentativo <= RITENTATIVI_NOTTURNI && !ultimo.ok; tentativo++) {
    console.warn(
      `[backup] notturno fallito (${ultimo.error}) — ritento tra 20 minuti (${tentativo - 1}/${RITENTATIVI_NOTTURNI})`
    );
    await new Promise(r => setTimeout(r, ATTESA_RITENTATIVO_MS));
    ultimo = await runBackup("schedulato");
  }
  if (!ultimo.ok) {
    console.error(
      `[backup] notturno fallito ${RITENTATIVI_NOTTURNI} volte, ultimo errore: ${ultimo.error}`
    );
  }
  return ultimo;
}

/**
 * La notte, un backup per ogni azienda attiva: ognuna nel suo contesto, col
 * suo Drive, la sua configurazione e il suo log. `perOgniTenantAttivo`
 * isola gli errori — un'azienda che fallisce non toglie il backup alle
 * altre — e tiene l'interruttore per (worker, azienda). `enabled` si legge
 * DENTRO il contesto perché è la riga di configurazione di quell'azienda.
 *
 * Due regole aggiunte dalla revisione finale (R16):
 *  - un'azienda diversa da Ruffino Group che non ha ancora collegato il suo
 *    Drive viene SALTATA con una riga di log, senza ritentativi e senza
 *    errore. `backup_config` nasce con `enabled: true` per tutte, quindi
 *    senza questo salto ogni notte l'azienda avrebbe fatto tre tentativi
 *    con due attese da 20 minuti — davanti a tutte le altre, per un esito
 *    noto in partenza. Non è un guasto: è un'azienda che non ha collegato
 *    niente. Il tenant 1 non si salta mai (ha i suoi ripieghi: service
 *    account e disco locale);
 *  - un backup davvero fallito LANCIA, così `perOgniTenantAttivo` conta
 *    l'errore: senza, l'interruttore del worker «backup» non sarebbe mai
 *    potuto scattare, perché `runBackup` scrive l'errore nel log e non
 *    lancia mai.
 */
async function giroNotturno(): Promise<void> {
  await perOgniTenantAttivo("backup", async tenantId => {
    if (!getConfig().enabled) return;
    if (tenantId !== TENANT_PREDEFINITO_ID && oauthRows.length === 0) {
      console.log(`[backup] tenant ${tenantId}: Drive non collegato, salto`);
      return;
    }
    const log = await backupNotturnoConRitentativi();
    if (!log.ok) throw new Error(log.error ?? "backup fallito");
  });
}

/** Solo nei test: la stessa funzione che chiama il timer di mezzanotte. */
export function __eseguiGiroNotturnoPerTest(): Promise<void> {
  if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY_GIRO_NOTTURNO");
  return giroNotturno();
}

export function startBackupScheduler(): void {
  if (scheduled) return;
  const arm = () => {
    const delay = msUntilRomeMidnight();
    scheduled = setTimeout(async () => {
      try {
        // Il timer gira fuori da ogni richiesta: il tenant lo dichiara
        // `giroNotturno`, un'azienda attiva alla volta.
        await giroNotturno();
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
  const tenantId = tenantObbligatorio();
  const cfg = getConfig();
  // Il service account (e la sua cartella condivisa) è di Ruffino Group: per
  // un'altra azienda quella modalità non esiste proprio.
  const sa = tenantId === TENANT_PREDEFINITO_ID ? loadServiceAccount() : null;
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
    inCorso: running.has(tenantId),
    ultimoBackup: last,
    prossimoTraMs: cfg.enabled ? msUntilRomeMidnight() : null,
  };
}

export function backupLog(limit = 15) {
  return [...logRows].sort((a, b) => b.id - a.id).slice(0, limit);
}
