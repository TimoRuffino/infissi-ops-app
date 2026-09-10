// server/staging/rotta.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getUtentiStore } from "../routers/utenti";
import { montaRottaStaging } from "./rotta";

const TOKEN = "token-di-prova-lungo-almeno-32-caratteri!";
const salvate = {
  AMBIENTE: process.env.AMBIENTE,
  STAGING_ACCESSO_TOKEN: process.env.STAGING_ACCESSO_TOKEN,
  BOOTSTRAP_ADMIN_EMAIL: process.env.BOOTSTRAP_ADMIN_EMAIL,
};
afterEach(() => {
  for (const [k, v] of Object.entries(salvate)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function appFinta() {
  const rotte: Record<string, Function> = {};
  return {
    app: { get: (p: string, h: Function) => { rotte[p] = h; } } as any,
    rotte,
  };
}

function resFinta() {
  const res: any = {
    statusCode: 0, redirectUrl: null as string | null, cookies: [] as any[],
    headersSent: false,
    status(c: number) { this.statusCode = c; return this; },
    end() { this.headersSent = true; },
    redirect(c: number, u: string) { this.statusCode = c; this.redirectUrl = u; this.headersSent = true; },
    cookie(nome: string, valore: string, opz: any) { this.cookies.push({ nome, valore, opz }); },
  };
  return res;
}

const reqFinta = (token?: string) =>
  ({ query: token === undefined ? {} : { token }, protocol: "https", headers: {}, get: () => undefined }) as any;

describe("montaRottaStaging", () => {
  beforeEach(() => {
    process.env.AMBIENTE = "staging";
    process.env.STAGING_ACCESSO_TOKEN = TOKEN;
    process.env.BOOTSTRAP_ADMIN_EMAIL = "demo-rotta@test.local";
    const utenti = getUtentiStore() as any[];
    if (!utenti.some((u: any) => u.email === "demo-rotta@test.local")) {
      utenti.push({
        id: 998, email: "demo-rotta@test.local", attivo: true,
        ruoli: ["direzione"], sediIds: [1], tenantId: 1,
        nome: "Demo", cognome: "Rotta",
        createdAt: new Date(), updatedAt: new Date(),
      });
    }
  });

  it("non monta nulla fuori da staging", () => {
    delete process.env.AMBIENTE;
    const { app, rotte } = appFinta();
    expect(montaRottaStaging(app)).toBe(false);
    expect(Object.keys(rotte)).toHaveLength(0);
  });

  it("non monta nulla con token assente o corto", () => {
    process.env.STAGING_ACCESSO_TOKEN = "corto";
    const { app, rotte } = appFinta();
    expect(montaRottaStaging(app)).toBe(false);
    expect(Object.keys(rotte)).toHaveLength(0);
  });

  it("token sbagliato: 404 opaco, nessun cookie", async () => {
    const { app, rotte } = appFinta();
    expect(montaRottaStaging(app)).toBe(true);
    const res = resFinta();
    await rotte["/api/staging/entra"](reqFinta("sbagliato-ma-della-stessa-lunghezza!!!!!!"), res);
    expect(res.statusCode).toBe(404);
    expect(res.cookies).toHaveLength(0);
  });

  it("token giusto: cookie di sessione e redirect a /", async () => {
    const { app, rotte } = appFinta();
    montaRottaStaging(app);
    const res = resFinta();
    await rotte["/api/staging/entra"](reqFinta(TOKEN), res);
    expect(res.redirectUrl).toBe("/");
    expect(res.cookies.some((c: any) => c.nome === "app_session_id")).toBe(true);
  });
});
