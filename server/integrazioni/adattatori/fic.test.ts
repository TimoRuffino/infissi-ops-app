import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Ctx } from "../contratto";
import * as ficMod from "../../routers/fattureInCloud";
import { fic } from "./fic";

const ctx = { user: { id: 7, role: "admin" }, sedeId: 1, tenantId: 1 } as unknown as Ctx;

const cfgBase = {
  id: 1,
  sedeId: 1,
  accessTokenCifrato: "v1.finto",
  refreshTokenCifrato: null,
  accessTokenExpiresAt: null,
  oauthConnectedAt: new Date(),
  authMode: "oauth" as const,
  companyId: null,
  enabled: true,
  lastSyncAt: null,
  lastResult: null,
  lastStats: null,
  economicScopesReady: false,
  scopeScrittura: false,
};

beforeEach(() => {
  process.env.FIC_OAUTH_REDIRECT_URI =
    "https://app.wyndoor.com/api/oauth/fic/callback";
  process.env.FIC_OAUTH_CLIENT_ID = "id-di-piattaforma";
  process.env.FIC_OAUTH_CLIENT_SECRET = "segreto-di-piattaforma";
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.FIC_OAUTH_REDIRECT_URI;
  delete process.env.FIC_OAUTH_CLIENT_ID;
  delete process.env.FIC_OAUTH_CLIENT_SECRET;
});

describe("adattatore fic", () => {
  it("token valido ma nessuna azienda scelta: collegato, con azione «scegli»", async () => {
    vi.spyOn(ficMod, "getCfg").mockReturnValue({ ...cfgBase, companyId: null } as any);

    const s = await fic.stato(ctx);
    expect(s.collegato).toBe(true);
    expect(s.problema?.azione).toBe("scegli");
    expect(s.problema?.causa).toMatch(/azienda/i);
  });

  it("azienda scelta: nessun problema", async () => {
    vi.spyOn(ficMod, "getCfg").mockReturnValue({ ...cfgBase, companyId: 42 } as any);

    const s = await fic.stato(ctx);
    expect(s.collegato).toBe(true);
    expect(s.problema).toBeNull();
  });

  it("non collegato: da collegare, senza problema", async () => {
    vi.spyOn(ficMod, "getCfg").mockReturnValue({
      ...cfgBase,
      accessTokenCifrato: null,
      oauthConnectedAt: null,
    } as any);

    const s = await fic.stato(ctx);
    expect(s.collegato).toBe(false);
    expect(s.problema).toBeNull();
  });

  // Spec §6 e §9: il callback appartiene alla piattaforma. Se manca, offrire
  // «Collega» vorrebbe dire mandare il cliente a scoprire il guasto a metà
  // giro, con un messaggio di Fatture in Cloud invece del nostro.
  it("senza callback di piattaforma lo stato dichiara «assistenza» invece di invitare a collegare", async () => {
    delete process.env.FIC_OAUTH_REDIRECT_URI;
    vi.spyOn(ficMod, "getCfg").mockReturnValue({
      ...cfgBase,
      accessTokenCifrato: null,
      oauthConnectedAt: null,
    } as any);

    const s = await fic.stato(ctx);
    expect(s.collegato).toBe(false);
    expect(s.problema?.azione).toBe("assistenza");
  });

  it("senza client OAuth di piattaforma vale lo stesso: «assistenza»", async () => {
    vi.spyOn(ficMod, "ficOAuthClientFromEnv").mockReturnValue(null);
    vi.spyOn(ficMod, "getCfg").mockReturnValue({
      ...cfgBase,
      accessTokenCifrato: null,
      oauthConnectedAt: null,
    } as any);

    const s = await fic.stato(ctx);
    expect(s.problema?.azione).toBe("assistenza");
  });

  it("il problema di piattaforma non nomina mai un segreto", async () => {
    delete process.env.FIC_OAUTH_REDIRECT_URI;
    process.env.FIC_OAUTH_CLIENT_SECRET = "segreto-da-non-dire";
    vi.spyOn(ficMod, "getCfg").mockReturnValue({
      ...cfgBase,
      accessTokenCifrato: null,
      oauthConnectedAt: null,
    } as any);

    const s = await fic.stato(ctx);
    expect(JSON.stringify(s)).not.toContain("segreto-da-non-dire");
    delete process.env.FIC_OAUTH_CLIENT_SECRET;
  });

  it("un collegamento che già funziona non diventa un caso di assistenza", async () => {
    delete process.env.FIC_OAUTH_REDIRECT_URI;
    vi.spyOn(ficMod, "getCfg").mockReturnValue({ ...cfgBase, companyId: 42 } as any);

    const s = await fic.stato(ctx);
    expect(s.collegato).toBe(true);
    expect(s.problema).toBeNull();
  });

  it("avvia chiede la sola lettura: la scrittura si chiede al primo bisogno", async () => {
    vi.spyOn(ficMod, "ficOAuthClientFromEnv").mockReturnValue({
      clientId: "a",
      clientSecret: "b",
    });
    vi.spyOn(ficMod, "issueFicOAuthState").mockResolvedValue("stato-1");
    const costruisci = vi
      .spyOn(ficMod, "buildFicAuthUrl")
      .mockReturnValue("https://api-v2.fattureincloud.it/oauth/authorize?x=1");

    await fic.avvia!(ctx);
    expect(costruisci).toHaveBeenCalledWith(
      "https://app.wyndoor.com/api/oauth/fic/callback",
      "stato-1",
      ficMod.FIC_SCOPES_LETTURA
    );
  });

  it("avvia({ scrittura: true }) chiede gli scope di scrittura", async () => {
    vi.spyOn(ficMod, "ficOAuthClientFromEnv").mockReturnValue({
      clientId: "a",
      clientSecret: "b",
    });
    vi.spyOn(ficMod, "issueFicOAuthState").mockResolvedValue("stato-2");
    const costruisci = vi
      .spyOn(ficMod, "buildFicAuthUrl")
      .mockReturnValue("https://api-v2.fattureincloud.it/oauth/authorize?x=2");

    await fic.avvia!(ctx, { scrittura: true });
    expect(costruisci).toHaveBeenCalledWith(
      expect.any(String),
      "stato-2",
      ficMod.FIC_SCOPES_SCRITTURA
    );
  });

  it("senza callback canonico non si avvia nessun giro OAuth", async () => {
    delete process.env.FIC_OAUTH_REDIRECT_URI;
    const emetti = vi.spyOn(ficMod, "issueFicOAuthState");

    await expect(fic.avvia!(ctx)).rejects.toThrow(/FIC_OAUTH_REDIRECT_URI/);
    expect(emetti).not.toHaveBeenCalled();
  });
});
