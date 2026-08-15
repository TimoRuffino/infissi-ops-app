import { z } from "zod";
import crypto from "crypto";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";
import {
  decryptSecret,
  encryptSecret,
  secretBoxConfigured,
} from "../_core/secretBox";
import { DEFAULT_SEDE_ID, allSedeIds } from "./sedi";
import { getClientiStore, createClienteFromSync } from "./clienti";
import {
  generaProposteRiconciliazione,
  upsertFatture,
  type RataFic,
} from "./ficFatture";

// ── Fatture in Cloud → CRM sync ──────────────────────────────────────────────
// Polls the FiC API (v2) for the current year's issued invoices and creates
// any client that doesn't exist in the CRM yet. Read-only towards FiC;
// OAuth Authorization Code is the primary mode, with automatic refresh.

const FIC = "https://api-v2.fattureincloud.it";
const FIC_SCOPES = "entity.clients:r issued_documents.invoices:r";
const FIC_CALLBACK_PATH = "/api/oauth/fic/callback";

type FicAuthMode = "manual" | "oauth";

type FicConfig = {
  id: number;
  // Una configurazione per sede: due sedi possono fatturare da due aziende
  // diverse su Fatture in Cloud, con token e company id propri.
  sedeId: number;
  // Cifrato a riposo. Il token FIC dà accesso in lettura a tutta la
  // contabilità dell'azienda, e il backup notturno spedisce ogni store su
  // Drive: in chiaro finirebbe là dentro.
  accessTokenCifrato: string | null;
  refreshTokenCifrato: string | null;
  accessTokenExpiresAt: Date | null;
  oauthConnectedAt: Date | null;
  authMode: FicAuthMode;
  companyId: number | null;
  enabled: boolean;
  lastSyncAt: Date | null;
  lastResult: string | null;
};

let nextCfgId = 2;

const _cfgStore = persistedStore<FicConfig>("fic_config", items => {
  for (const c of items as any[]) {
    if (c.sedeId === undefined) c.sedeId = DEFAULT_SEDE_ID;
    // Migrazione del token salvato in chiaro dalla versione precedente.
    if (c.accessToken) {
      if (secretBoxConfigured()) {
        c.accessTokenCifrato = encryptSecret(c.accessToken);
        c.accessToken = null;
      } else {
        // Senza chiave non si può cifrare: il token resta dov'è e continua a
        // funzionare, ma lo diciamo — è un segreto che va nel backup.
        console.warn(
          "[fic] token in chiaro non cifrato: MAIL_ENCRYPTION_KEY non configurata"
        );
      }
    }
    if (c.accessTokenCifrato === undefined) c.accessTokenCifrato = null;
    if (c.refreshTokenCifrato === undefined) c.refreshTokenCifrato = null;
    if (c.accessTokenExpiresAt === undefined) c.accessTokenExpiresAt = null;
    if (c.oauthConnectedAt === undefined) c.oauthConnectedAt = null;
    if (c.authMode !== "oauth") c.authMode = "manual";
  }
  nextCfgId = items.length ? Math.max(...items.map(c => c.id)) + 1 : 1;
});
const cfgRows = _cfgStore.items;

function getCfg(sedeId: number | null): FicConfig {
  const sede = sedeId ?? DEFAULT_SEDE_ID;
  let c = cfgRows.find(x => x.sedeId === sede);
  if (!c) {
    c = {
      id: nextCfgId++,
      sedeId: sede,
      accessTokenCifrato: null,
      refreshTokenCifrato: null,
      accessTokenExpiresAt: null,
      oauthConnectedAt: null,
      authMode: "manual",
      companyId: null,
      enabled: false,
      lastSyncAt: null,
      lastResult: null,
    };
    cfgRows.push(c);
    _cfgStore.save();
  }
  return c;
}

function assertChiaveCifratura() {
  if (!secretBoxConfigured()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "MAIL_ENCRYPTION_KEY non configurata sul server: senza chiave il token di Fatture in Cloud non può essere salvato in sicurezza (finirebbe in chiaro nel backup).",
    });
  }
}

function leggiSegreto(cifrato: string | null): string | null {
  if (!cifrato) return null;
  try {
    return decryptSecret(cifrato);
  } catch {
    return null;
  }
}

/** Il token in chiaro, solo al momento della chiamata. */
function tokenDi(cfg: FicConfig): string | null {
  if (!cfg.accessTokenCifrato) return (cfg as any).accessToken ?? null;
  return leggiSegreto(cfg.accessTokenCifrato);
}

export function ficOAuthClientFromEnv(): {
  clientId: string;
  clientSecret: string;
} | null {
  const clientId = process.env.FIC_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.FIC_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

type PendingFicState = {
  sedeId: number;
  redirectUri: string;
  expiresAt: number;
};

const pendingFicStates = new Map<string, PendingFicState>();

export function issueFicOAuthState(
  sedeId: number,
  redirectUri: string
): string {
  const state = crypto.randomBytes(24).toString("base64url");
  pendingFicStates.set(state, {
    sedeId,
    redirectUri,
    expiresAt: Date.now() + 10 * 60_000,
  });
  return state;
}

function consumeFicOAuthState(state: string): PendingFicState | null {
  const pending = pendingFicStates.get(state) ?? null;
  pendingFicStates.delete(state);
  if (!pending || pending.expiresAt <= Date.now()) return null;
  return pending;
}

export function buildFicAuthUrl(
  redirectUri: string,
  state: string
): string | null {
  const client = ficOAuthClientFromEnv();
  if (!client) return null;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: client.clientId,
    redirect_uri: redirectUri,
    scope: FIC_SCOPES,
    state,
  });
  return `${FIC}/oauth/authorize?${params.toString()}`;
}

type FicTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};

async function requestFicToken(
  payload: Record<string, string>
): Promise<FicTokenResponse> {
  const res = await fetch(`${FIC}/oauth/token`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(
      `OAuth Fatture in Cloud fallito (HTTP ${res.status}): ${(await res.text()).slice(0, 240)}`
    );
  }
  return (await res.json()) as FicTokenResponse;
}

function salvaTokenOAuth(cfg: FicConfig, token: FicTokenResponse): void {
  if (!token.access_token || !tokenSembraValido(token.access_token)) {
    throw new Error(
      "Fatture in Cloud non ha restituito un access token valido"
    );
  }
  assertChiaveCifratura();
  cfg.accessTokenCifrato = encryptSecret(token.access_token);
  if (token.refresh_token)
    cfg.refreshTokenCifrato = encryptSecret(token.refresh_token);
  cfg.accessTokenExpiresAt = new Date(
    Date.now() + Math.max(60, Number(token.expires_in) || 86_400) * 1000
  );
  cfg.oauthConnectedAt ??= new Date();
  cfg.authMode = "oauth";
  delete (cfg as any).accessToken;
  _cfgStore.save();
}

export async function handleFicOAuthCallback(
  code: string,
  state: string
): Promise<{ sedeId: number }> {
  const pending = consumeFicOAuthState(state);
  if (!pending) throw new Error("Stato OAuth non valido o scaduto");
  const client = ficOAuthClientFromEnv();
  if (!client) throw new Error("Client OAuth Fatture in Cloud non configurato");
  const token = await requestFicToken({
    grant_type: "authorization_code",
    client_id: client.clientId,
    client_secret: client.clientSecret,
    redirect_uri: pending.redirectUri,
    code,
  });
  if (!token.refresh_token) {
    throw new Error("Fatture in Cloud non ha restituito il refresh token");
  }
  const cfg = getCfg(pending.sedeId);
  salvaTokenOAuth(cfg, token);

  // Riduce un passaggio: quando l'account espone una sola azienda, la
  // selezioniamo subito. Gli account multi-azienda restano espliciti in UI.
  try {
    const companies = await ficGet("/user/companies", token.access_token!);
    const list: any[] = companies?.data?.companies ?? [];
    if (list.length === 1) {
      cfg.companyId = Number(list[0].id);
      _cfgStore.save();
    }
  } catch {
    // Il collegamento OAuth è valido anche se la scoperta azienda fallisce.
  }
  return { sedeId: pending.sedeId };
}

const refreshInFlight = new Map<number, Promise<string>>();

async function refreshFicToken(cfg: FicConfig): Promise<string> {
  const existing = refreshInFlight.get(cfg.sedeId);
  if (existing) return existing;
  const promise = (async () => {
    const client = ficOAuthClientFromEnv();
    const refreshToken = leggiSegreto(cfg.refreshTokenCifrato);
    if (!client || !refreshToken) {
      throw new Error(
        "Collegamento OAuth incompleto: ricollega Fatture in Cloud"
      );
    }
    const token = await requestFicToken({
      grant_type: "refresh_token",
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: refreshToken,
    });
    salvaTokenOAuth(cfg, token);
    return token.access_token!;
  })().finally(() => refreshInFlight.delete(cfg.sedeId));
  refreshInFlight.set(cfg.sedeId, promise);
  return promise;
}

export async function accessTokenFic(cfg: FicConfig): Promise<string | null> {
  const token = tokenDi(cfg);
  if (cfg.authMode !== "oauth") return token;
  const expiresAt = cfg.accessTokenExpiresAt
    ? new Date(cfg.accessTokenExpiresAt).getTime()
    : 0;
  if (token && expiresAt > Date.now() + 5 * 60_000) return token;
  return refreshFicToken(cfg);
}

// Il token manuale ha una forma precisa: "a/" + un JWT. Il Client ID (che
// si incolla nella stessa schermata di Fatture in Cloud, un rigo sopra) non
// ce l'ha — ed è l'errore più facile da fare, perché i due valori vivono
// accanto. Meglio dirlo al salvataggio che lasciare un 401 senza spiegazione.
export function tokenSembraValido(t: string): boolean {
  return /^a\/[A-Za-z0-9._-]{20,}$/.test(t.trim());
}

// Gli errori dell'API arrivano in inglese e generici: qui diventano frasi
// che dicono all'operatore cosa fare.
function messaggioErroreFic(status: number, corpo: string): string {
  if (status === 401) {
    return "Token rifiutato da Fatture in Cloud: è scaduto, è stato revocato, oppure non è un token (controlla di non aver incollato il Client ID).";
  }
  if (status === 403) {
    return "Token valido ma senza i permessi necessari: nelle Applicazioni connesse abilita la lettura di «Fatture emesse» e «Anagrafica», poi rigenera il token.";
  }
  if (status === 404) {
    return "Azienda non trovata con questo token: ripremi «Trova azienda» e riseleziona quella giusta.";
  }
  if (status === 429) {
    return "Troppe richieste verso Fatture in Cloud: riprova tra qualche minuto.";
  }
  return `Fatture in Cloud HTTP ${status}: ${corpo.slice(0, 200)}`;
}

async function ficGet(path: string, token: string): Promise<any> {
  const res = await fetch(`${FIC}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(messaggioErroreFic(res.status, await res.text()));
  }
  return await res.json();
}

const MAX_FATTURA_PDF_BYTES = 10 * 1024 * 1024;

/** Scarica il PDF ufficiale senza inoltrare il bearer token all'URL firmato. */
export async function scaricaFatturaPdf(
  sedeId: number,
  ficId: number
): Promise<Buffer> {
  const cfg = getCfg(sedeId);
  const token = await accessTokenFic(cfg);
  if (!token || !cfg.companyId) {
    throw new Error(
      "Fatture in Cloud non configurato per questa sede: collega l'account e seleziona l'azienda."
    );
  }
  const response = await ficGet(
    `/c/${cfg.companyId}/issued_documents/${ficId}?fields=id,url`,
    token
  );
  const pdfUrl = typeof response?.data?.url === "string"
    ? response.data.url.trim()
    : "";
  if (!/^https:\/\//i.test(pdfUrl)) {
    throw new Error(
      "Fatture in Cloud non ha restituito il PDF della fattura. Riprova tra poco."
    );
  }
  const pdfResponse = await fetch(pdfUrl, {
    headers: { accept: "application/pdf" },
  });
  if (!pdfResponse.ok) {
    throw new Error(
      `Download PDF fattura fallito (HTTP ${pdfResponse.status}). Riprova il collegamento.`
    );
  }
  const declaredSize = Number(pdfResponse.headers.get("content-length") ?? 0);
  if (declaredSize > MAX_FATTURA_PDF_BYTES) {
    throw new Error("Il PDF della fattura supera il limite di 10MB.");
  }
  const pdf = Buffer.from(await pdfResponse.arrayBuffer());
  if (pdf.length > MAX_FATTURA_PDF_BYTES) {
    throw new Error("Il PDF della fattura supera il limite di 10MB.");
  }
  if (pdf.length < 5 || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("Il file ricevuto da Fatture in Cloud non è un PDF valido.");
  }
  return pdf;
}

// ── Name handling (same CF-validated split used by the manual migration) ────
function stripAcc(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}
function normKey(s: string): string {
  return stripAcc(s)
    .toLowerCase()
    .replace(/[^a-z0-9' ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}
function consonants(s: string): string {
  const clean = stripAcc(s)
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase();
  const cons = clean.replace(/[AEIOU]/g, "");
  const vows = clean.replace(/[^AEIOU]/g, "");
  return (cons + vows + "XXX").slice(0, 3);
}
const COMPANY_RE =
  /\b(S\.?R\.?L\.?S?|S\.?P\.?A\.?|S\.?N\.?C\.?|S\.?A\.?S\.?|SOC(IETA)?'?|COOP|CONDOMINIO|IMPRESA|COSTRUZIONI|EDIL\w*|STUDIO|HOTEL|RISTORANTE|BAR|IMMOBILIARE|SERVICE|GROUP|ITALIA|DITTA|&)\b/i;

function splitPersona(
  full: string,
  cf: string | null
): { cognome: string; nome: string } {
  const toks = full.trim().split(/\s+/);
  if (toks.length === 1) return { cognome: full, nome: full };
  if (cf && /^[A-Za-z]{6}/.test(cf)) {
    const target = cf.toUpperCase().slice(0, 3);
    for (let i = toks.length - 1; i >= 1; i--) {
      if (consonants(toks.slice(0, i).join(" ")) === target) {
        return {
          cognome: toks.slice(0, i).join(" "),
          nome: toks.slice(i).join(" "),
        };
      }
    }
    for (let i = 1; i < toks.length; i++) {
      if (consonants(toks.slice(i).join(" ")) === target) {
        return {
          cognome: toks.slice(i).join(" "),
          nome: toks.slice(0, i).join(" "),
        };
      }
    }
  }
  return { cognome: toks.slice(0, -1).join(" "), nome: toks[toks.length - 1] };
}

// ── Sync ─────────────────────────────────────────────────────────────────────
// Un lucchetto per sede: la sede 2 non deve aspettare il giro della sede 1.
const syncing = new Set<number>();

export async function runFicSync(sedeId: number): Promise<string> {
  const cfg = getCfg(sedeId);
  const token = await accessTokenFic(cfg);
  if (!token || !cfg.companyId) {
    throw new Error("Token o azienda non configurati");
  }
  if (syncing.has(sedeId)) throw new Error("Sincronizzazione già in corso");
  syncing.add(sedeId);
  try {
    const year = new Date().getFullYear();
    const entities: Array<{
      name: string;
      vat: string | null;
      cf: string | null;
    }> = [];
    const fatture: Array<{
      id: number;
      numero: string;
      data: string;
      clienteNome: string;
      clienteVat: string | null;
      clienteCf: string | null;
      importoNetto: number;
      importoLordo: number;
      rate: RataFic[];
    }> = [];
    for (let page = 1; page <= 10; page++) {
      const j = await ficGet(
        `/c/${cfg.companyId}/issued_documents?type=invoice&per_page=100&page=${page}&fields=id,number,numeration,date,entity,amount_net,amount_gross,payments_list`,
        token
      );
      const rows: any[] = j?.data ?? [];
      for (const r of rows) {
        if (!r?.date || !String(r.date).startsWith(String(year))) continue;
        const e = r.entity ?? {};
        if (!e.name) continue;
        entities.push({
          name: String(e.name).trim(),
          vat: e.vat_number ? String(e.vat_number) : null,
          cf: e.tax_code ? String(e.tax_code) : null,
        });
        fatture.push({
          id: Number(r.id),
          numero: `${r.number ?? "?"}${r.numeration ?? ""}`,
          data: String(r.date),
          clienteNome: String(e.name).trim(),
          clienteVat: e.vat_number ? String(e.vat_number) : null,
          clienteCf: e.tax_code ? String(e.tax_code) : null,
          importoNetto: Number(r.amount_net ?? 0),
          importoLordo: Number(r.amount_gross ?? 0),
          rate: (Array.isArray(r.payments_list) ? r.payments_list : []).map(
            (p: any) => ({
              importo: Number(p.amount ?? 0),
              scadenza: p.due_date ? String(p.due_date) : null,
              stato: String(p.status ?? "not_paid"),
              dataPagamento: p.paid_date ? String(p.paid_date) : null,
            })
          ),
        });
      }
      if (rows.length < 100) break;
    }

    // L'anagrafica di questa sede: un omonimo in un'altra sede non deve
    // impedire la creazione del cliente qui, e viceversa.
    const clienti = getClientiStore().filter(
      (c: any) => (c.sedeId ?? DEFAULT_SEDE_ID) === sedeId
    );
    const have = new Set<string>();
    for (const c of clienti) {
      have.add(normKey(`${c.cognome ?? ""} ${c.nome ?? ""}`));
    }

    let created = 0;
    const seen = new Set<string>();
    for (const e of entities) {
      const key = normKey(e.name);
      if (!key || seen.has(key) || have.has(key)) continue;
      seen.add(key);
      const isCompany = !!(e.vat && e.vat !== "0") || COMPANY_RE.test(e.name);
      if (isCompany) {
        createClienteFromSync({
          sedeId,
          cognome: e.name,
          nome: " ",
          tipo: /condominio/i.test(e.name) ? "condominio" : "azienda",
          partitaIva: e.vat ?? undefined,
        });
      } else {
        const sp = splitPersona(e.name, e.cf);
        createClienteFromSync({
          sedeId,
          cognome: sp.cognome,
          nome: sp.nome,
          tipo: "privato",
          codiceFiscale:
            e.cf && /^[A-Za-z0-9]{16}$/.test(e.cf)
              ? e.cf.toUpperCase()
              : undefined,
        });
      }
      created++;
    }

    // Fatture nello store locale + riconciliazione: le rate incassate su
    // FIC diventano PROPOSTE di registrazione, mai scritture dirette.
    const { nuove, aggiornate } = upsertFatture(fatture, sedeId);
    const proposteCreate = generaProposteRiconciliazione(sedeId);

    // Le orfane (cliente sconosciuto o ambiguo) vanno a Tars, che indaga e
    // propone il collegamento. Fire-and-forget col suo debounce: il sync
    // non deve aspettare l'agente.
    const { programmaSmistamentoFatture } = await import("../tars/smistamento");
    programmaSmistamentoFatture(sedeId);

    const result = `${new Date().toLocaleString("it-IT")}: ${entities.length} fatture ${year} (${nuove} nuove, ${aggiornate} aggiornate), ${created} nuovi clienti, ${proposteCreate} proposte di riconciliazione`;
    cfg.lastSyncAt = new Date();
    cfg.lastResult = result;
    _cfgStore.save();
    return result;
  } catch (e: any) {
    const cfg2 = getCfg(sedeId);
    cfg2.lastSyncAt = new Date();
    cfg2.lastResult = `ERRORE: ${e?.message ?? "sconosciuto"}`;
    _cfgStore.save();
    throw e;
  } finally {
    syncing.delete(sedeId);
  }
}

// Poll every 6 hours while enabled.
let ficTimer: NodeJS.Timeout | null = null;
export function startFicScheduler(): void {
  if (ficTimer) return;
  ficTimer = setInterval(
    async () => {
      // Ogni sede col suo giro: se una ha il token scaduto, le altre
      // continuano. Un errore per sede non ferma la fila.
      for (const sedeId of allSedeIds()) {
        try {
          const cfg = getCfg(sedeId);
          const hasCredential =
            !!cfg.accessTokenCifrato ||
            !!cfg.refreshTokenCifrato ||
            !!(cfg as any).accessToken;
          if (cfg.enabled && hasCredential && cfg.companyId) {
            await runFicSync(sedeId);
          }
        } catch (e) {
          console.error(`[fic] sync automatico sede ${sedeId} fallito:`, e);
        }
      }
    },
    6 * 60 * 60 * 1000
  );
  ficTimer.unref?.();
}

function maskToken(t: string | null): string | null {
  if (!t) return null;
  return t.length <= 10 ? "•••" : t.slice(0, 6) + "…" + t.slice(-4);
}

export const fattureInCloudRouter = router({
  status: adminProcedure.query(({ ctx }) => {
    const cfg = getCfg(ctx.sedeId);
    const token = tokenDi(cfg);
    return {
      configured: !!(token && cfg.companyId),
      connected: !!token || !!cfg.refreshTokenCifrato,
      authMode: cfg.authMode,
      oauthClientReady: !!ficOAuthClientFromEnv(),
      oauthConnectedAt: cfg.oauthConnectedAt,
      accessTokenExpiresAt: cfg.accessTokenExpiresAt,
      tokenMasked: maskToken(token),
      companyId: cfg.companyId,
      enabled: cfg.enabled,
      lastSyncAt: cfg.lastSyncAt,
      lastResult: cfg.lastResult,
    };
  }),

  saveConfig: adminProcedure
    .input(
      z.object({
        accessToken: z.string().min(10).optional(),
        companyId: z.number().nullable().optional(),
        enabled: z.boolean().optional(),
      })
    )
    .mutation(({ input, ctx }) => {
      const cfg = getCfg(ctx.sedeId);
      if (input.accessToken !== undefined) {
        const t = input.accessToken.trim();
        if (!tokenSembraValido(t)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Questo non è un token di Fatture in Cloud: quello giusto comincia con «a/» ed è molto lungo. Se il valore che hai incollato somiglia a un codice breve, è il Client ID — serve a generare il token, non a sostituirlo.",
          });
        }
        assertChiaveCifratura();
        cfg.accessTokenCifrato = encryptSecret(t);
        cfg.refreshTokenCifrato = null;
        cfg.accessTokenExpiresAt = null;
        cfg.oauthConnectedAt = null;
        cfg.authMode = "manual";
        // Il campo in chiaro della versione precedente non deve sopravvivere.
        delete (cfg as any).accessToken;
      }
      if (input.companyId !== undefined) cfg.companyId = input.companyId;
      if (input.enabled !== undefined) cfg.enabled = input.enabled;
      _cfgStore.save();
      return { success: true } as const;
    }),

  oauthStartUrl: adminProcedure.mutation(({ ctx }) => {
    assertChiaveCifratura();
    if (!ficOAuthClientFromEnv()) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Configura FIC_OAUTH_CLIENT_ID e FIC_OAUTH_CLIENT_SECRET sul server prima di collegare l'account.",
      });
    }
    const redirectUri =
      process.env.FIC_OAUTH_REDIRECT_URI?.trim() ||
      `${ctx.req.protocol}://${ctx.req.get("host")}${FIC_CALLBACK_PATH}`;
    const state = issueFicOAuthState(
      ctx.sedeId ?? DEFAULT_SEDE_ID,
      redirectUri
    );
    const url = buildFicAuthUrl(redirectUri, state);
    if (!url) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "OAuth FIC non configurato",
      });
    }
    return { url, redirectUri };
  }),

  disconnectOAuth: adminProcedure.mutation(({ ctx }) => {
    const cfg = getCfg(ctx.sedeId);
    cfg.accessTokenCifrato = null;
    cfg.refreshTokenCifrato = null;
    cfg.accessTokenExpiresAt = null;
    cfg.oauthConnectedAt = null;
    cfg.authMode = "manual";
    cfg.companyId = null;
    cfg.enabled = false;
    delete (cfg as any).accessToken;
    _cfgStore.save();
    return { success: true } as const;
  }),

  // Companies visible to the token — lets the UI offer a picker.
  companies: adminProcedure.mutation(async ({ ctx }) => {
    const token = await accessTokenFic(getCfg(ctx.sedeId));
    if (!token) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Salva prima il token",
      });
    }
    const j = await ficGet("/user/companies", token);
    const list: any[] = j?.data?.companies ?? [];
    return list.map(c => ({
      id: c.id as number,
      name: String(c.name ?? c.id),
    }));
  }),

  syncNow: adminProcedure.mutation(async ({ ctx }) => {
    return { result: await runFicSync(ctx.sedeId ?? DEFAULT_SEDE_ID) };
  }),
});
