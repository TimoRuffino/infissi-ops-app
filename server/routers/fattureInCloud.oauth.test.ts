import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";
import {
  buildFicAuthUrl,
  FIC_SCOPES_LETTURA,
  FIC_SCOPES_SCRITTURA,
  handleFicOAuthCallback,
  issueFicOAuthState,
} from "./fattureInCloud";

function makeCtx(): TrpcContext {
  return {
    user: {
      id: 1,
      role: "admin",
      ruolo: "direzione",
      ruoli: ["direzione"],
      email: "admin@ruffinogroup.it",
    } as any,
    req: {
      protocol: "https",
      get: () => "crm.example.test",
      headers: {},
    } as any,
    res: {} as any,
    sedeId: 1,
    sediIds: [1],
  };
}

const realFetch = global.fetch;
const envBefore = {
  clientId: process.env.FIC_OAUTH_CLIENT_ID,
  clientSecret: process.env.FIC_OAUTH_CLIENT_SECRET,
  encryptionKey: process.env.MAIL_ENCRYPTION_KEY,
};

beforeEach(() => {
  process.env.FIC_OAUTH_CLIENT_ID = "client-test";
  process.env.FIC_OAUTH_CLIENT_SECRET = "secret-test";
  process.env.MAIL_ENCRYPTION_KEY = "test-only-encryption-key";
});

afterEach(() => {
  global.fetch = realFetch;
  if (envBefore.clientId === undefined) delete process.env.FIC_OAUTH_CLIENT_ID;
  else process.env.FIC_OAUTH_CLIENT_ID = envBefore.clientId;
  if (envBefore.clientSecret === undefined)
    delete process.env.FIC_OAUTH_CLIENT_SECRET;
  else process.env.FIC_OAUTH_CLIENT_SECRET = envBefore.clientSecret;
  if (envBefore.encryptionKey === undefined)
    delete process.env.MAIL_ENCRYPTION_KEY;
  else process.env.MAIL_ENCRYPTION_KEY = envBefore.encryptionKey;
  vi.restoreAllMocks();
});

function response(status: number, value: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => value,
    text: async () => JSON.stringify(value),
  } as any;
}

describe("OAuth Fatture in Cloud", () => {
  it("costruisce un consenso read-only con state e redirect esatti", () => {
    const url = buildFicAuthUrl(
      "https://crm.example.test/api/oauth/fic/callback",
      "state-123"
    );
    const parsed = new URL(url!);
    expect(parsed.origin + parsed.pathname).toBe(
      "https://api-v2.fattureincloud.it/oauth/authorize"
    );
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("client_id")).toBe("client-test");
    expect(parsed.searchParams.get("state")).toBe("state-123");
    expect(parsed.searchParams.get("scope")).toBe(
      "entity.clients:r issued_documents.invoices:r issued_documents.credit_notes:r received_documents:r"
    );
  });

  it("scambia il codice, cifra i token e seleziona l'unica azienda", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response(200, {
          access_token: "a/abcdefghijklmnopqrstuvwxyz.0123456789",
          refresh_token: "r/abcdefghijklmnopqrstuvwxyz.0123456789",
          expires_in: 86_400,
        })
      )
      .mockResolvedValueOnce(
        response(200, { data: { companies: [{ id: 77, name: "Ruffino" }] } })
      );
    global.fetch = fetchMock as any;

    const redirectUri = "https://crm.example.test/api/oauth/fic/callback";
    const state = issueFicOAuthState(1, redirectUri);
    await handleFicOAuthCallback("c/codice-monouso", state);

    const status = await appRouter
      .createCaller(makeCtx())
      .fattureInCloud.status();
    expect(status.authMode).toBe("oauth");
    expect(status.connected).toBe(true);
    expect(status.companyId).toBe(77);
    expect(status.configured).toBe(true);
    expect(status.tokenMasked).not.toContain("abcdefghijklmnopqrstuvwxyz");

    const tokenBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(tokenBody).toMatchObject({
      grant_type: "authorization_code",
      client_id: "client-test",
      client_secret: "secret-test",
      redirect_uri: redirectUri,
      code: "c/codice-monouso",
    });
    await expect(handleFicOAuthCallback("c/riuso", state)).rejects.toThrow(
      /non valido o scaduto/
    );
  });

  it("rinnova automaticamente un access token in scadenza", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response(200, {
          access_token: "a/token-in-scadenza-abcdefghijklmnopqrstuvwxyz",
          refresh_token: "r/refresh-abcdefghijklmnopqrstuvwxyz012345",
          expires_in: 60,
        })
      )
      .mockResolvedValueOnce(response(200, { data: { companies: [] } }))
      .mockResolvedValueOnce(
        response(200, {
          access_token: "a/token-rinnovato-abcdefghijklmnopqrstuvwxyz",
          refresh_token: "r/refresh-rinnovato-abcdefghijklmnopqrstuvwxyz",
          expires_in: 86_400,
        })
      )
      .mockResolvedValueOnce(
        response(200, {
          data: { companies: [{ id: 88, name: "Ruffino Due" }] },
        })
      );
    global.fetch = fetchMock as any;

    const state = issueFicOAuthState(
      1,
      "https://crm.example.test/api/oauth/fic/callback"
    );
    await handleFicOAuthCallback("c/nuovo", state);
    const companies = await appRouter
      .createCaller(makeCtx())
      .fattureInCloud.companies();

    expect(companies).toEqual([{ id: 88, name: "Ruffino Due" }]);
    const refreshBody = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(refreshBody).toMatchObject({
      grant_type: "refresh_token",
      client_id: "client-test",
      client_secret: "secret-test",
      refresh_token: "r/refresh-abcdefghijklmnopqrstuvwxyz012345",
    });
  });

  it("oauthStartUrl({ scrittura: true }) chiede lo scope di scrittura e il callback lo salva", async () => {
    const { url } = await appRouter
      .createCaller(makeCtx())
      .fattureInCloud.oauthStartUrl({ scrittura: true });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("scope")).toBe(FIC_SCOPES_SCRITTURA);
    const state = parsed.searchParams.get("state")!;

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response(200, {
          access_token: "a/scrittura-abcdefghijklmnopqrstuvwxyz",
          refresh_token: "r/scrittura-abcdefghijklmnopqrstuvwxyz",
          expires_in: 86_400,
        })
      )
      .mockResolvedValueOnce(response(200, { data: { companies: [] } }));
    global.fetch = fetchMock as any;

    await handleFicOAuthCallback("c/scrittura", state);
    const status = await appRouter
      .createCaller(makeCtx())
      .fattureInCloud.status();
    expect(status.scopeScrittura).toBe(true);
  });

  it("oauthStartUrl senza scrittura resta sullo scope di lettura", async () => {
    const { url } = await appRouter
      .createCaller(makeCtx())
      .fattureInCloud.oauthStartUrl();
    const parsed = new URL(url);
    expect(parsed.searchParams.get("scope")).toBe(FIC_SCOPES_LETTURA);
    const state = parsed.searchParams.get("state")!;

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response(200, {
          access_token: "a/lettura-abcdefghijklmnopqrstuvwxyz",
          refresh_token: "r/lettura-abcdefghijklmnopqrstuvwxyz",
          expires_in: 86_400,
        })
      )
      .mockResolvedValueOnce(response(200, { data: { companies: [] } }));
    global.fetch = fetchMock as any;

    await handleFicOAuthCallback("c/lettura", state);
    const status = await appRouter
      .createCaller(makeCtx())
      .fattureInCloud.status();
    expect(status.scopeScrittura).toBe(false);
  });
});
