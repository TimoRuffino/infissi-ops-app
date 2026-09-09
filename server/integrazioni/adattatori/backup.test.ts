import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Ctx } from "../contratto";
import * as drive from "../../_core/driveBackup";
import { backup } from "./backup";

const ctx = { user: { id: 1, role: "admin" }, sedeId: 1, tenantId: 1 } as unknown as Ctx;

beforeEach(() => {
  process.env.GOOGLE_OAUTH_REDIRECT_URI =
    "https://app.wyndoor.com/api/oauth/gdrive/callback";
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
});

describe("adattatore backup", () => {
  it("Drive collegato: lo stato nomina l'account, non dice solo «ok»", async () => {
    vi.spyOn(drive, "backupStatus").mockReturnValue({
      driveConfigurato: true,
      mode: "oauth",
      oauthEmail: "titolare@example.it",
    } as any);

    const s = await backup.stato(ctx);
    expect(s.collegato).toBe(true);
    expect(s.soggetto).toBe("titolare@example.it");
    expect(s.problema).toBeNull();
  });

  it("Drive non collegato: nessun problema, è semplicemente da collegare", async () => {
    vi.spyOn(drive, "backupStatus").mockReturnValue({
      driveConfigurato: false,
      mode: null,
      oauthEmail: null,
    } as any);

    const s = await backup.stato(ctx);
    expect(s.collegato).toBe(false);
    expect(s.problema).toBeNull();
  });

  it("la cartella non è più raggiungibile: problema con rimedio «ricollega»", async () => {
    vi.spyOn(drive, "checkBackupRoot").mockResolvedValue({
      ok: false,
      error: "File not found",
    } as any);

    const p = await backup.verifica(ctx);
    expect(p?.azione).toBe("ricollega");
    expect(p?.rimedio).not.toBe("");
  });

  it("la cartella risponde: nessun problema", async () => {
    vi.spyOn(drive, "checkBackupRoot").mockResolvedValue({ ok: true } as any);
    expect(await backup.verifica(ctx)).toBeNull();
  });

  // C2: le due metà del giro OAuth devono presentare a Google lo stesso
  // redirect. L'autorizzazione parte dal callback canonico; lo scambio, che
  // vive su una rotta anonima, lo rilegge dallo state.
  it("avvia mette il callback canonico nello state, non solo nell'URL", async () => {
    vi.spyOn(drive, "oauthClientFromEnv").mockReturnValue({
      clientId: "x",
      clientSecret: "y",
    });
    const emetti = vi.spyOn(drive, "issueOAuthState").mockResolvedValue("stato-1");
    vi.spyOn(drive, "buildAuthUrl").mockReturnValue(
      "https://accounts.google.com/o/oauth2/v2/auth?x=1"
    );

    await backup.avvia!(ctx);

    expect(emetti).toHaveBeenCalledWith(
      1,
      "https://app.wyndoor.com/api/oauth/gdrive/callback"
    );
  });

  it("senza callback canonico non offre il collegamento", async () => {
    delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
    vi.spyOn(drive, "oauthClientFromEnv").mockReturnValue({
      clientId: "x",
      clientSecret: "y",
    });

    await expect(backup.avvia!(ctx)).rejects.toThrow(/GOOGLE_OAUTH_REDIRECT_URI/);
  });
});
