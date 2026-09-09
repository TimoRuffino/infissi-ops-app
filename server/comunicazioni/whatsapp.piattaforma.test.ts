import { describe, expect, it, beforeAll, beforeEach, afterEach } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import { istanziaStoresPerTenant } from "../_core/persistence";
import {
  getTenantRepository,
  resetTenantRepositoryForTesting,
} from "../tenants/repository";
import type { TenantRecord } from "../tenants/tipi";
import {
  appEffettiva,
  appPubblica,
  configWhatsApp,
  getAppWhatsApp,
  saveAppWhatsApp,
  tutteLeAppWhatsApp,
  verifyTokenValido,
} from "./whatsapp";

function ctxDirezione(sedeId: number): TrpcContext {
  return {
    user: {
      id: 1,
      role: "admin",
      ruolo: "direzione",
      ruoli: ["direzione"],
    } as any,
    req: { protocol: "https", headers: {} } as any,
    res: {} as TrpcContext["res"],
    sedeId,
    sediIds: [sedeId],
    tenantId: 1,
    tenant: null,
  };
}

beforeEach(() => {
  process.env.WHATSAPP_APP_ID = "app-di-piattaforma";
  process.env.WHATSAPP_CONFIG_ID = "config-di-piattaforma";
  process.env.WHATSAPP_APP_SECRET = "segreto-di-piattaforma";
});
afterEach(() => {
  delete process.env.WHATSAPP_APP_ID;
  delete process.env.WHATSAPP_CONFIG_ID;
  delete process.env.WHATSAPP_APP_SECRET;
  delete process.env.WHATSAPP_VERIFY_TOKEN;
});

describe("app WhatsApp di piattaforma", () => {
  it("una sede senza credenziali proprie è pronta: le prende dalla piattaforma", () => {
    const pub = appPubblica(1);
    expect(pub.appId).toBe("app-di-piattaforma");
    expect(pub.configId).toBe("config-di-piattaforma");
    expect(pub.appSecretConfigurato).toBe(true);
    expect(pub.pronta).toBe(true);
  });

  it("l'app secret non esce mai dalla vista pubblica", () => {
    expect(JSON.stringify(appPubblica(1))).not.toContain("segreto-di-piattaforma");
  });

  // I10 della revisione: l'override vince o perde COME UNITÀ. Mescolare
  // l'App ID di una sede col Configuration ID della piattaforma dà una
  // coppia che non è di nessuno: Meta rifiuta il login e il messaggio parla
  // di una configurazione che nessuno ha scritto così.
  it("l'override per sede vince come unità: è la via di fuga se l'app di piattaforma viene limitata", () => {
    const a = getAppWhatsApp(2);
    a.appId = "app-della-sede";
    a.configId = "config-della-sede";
    a.appSecretCifrato = "v1.finto";
    saveAppWhatsApp();

    expect(appPubblica(2).appId).toBe("app-della-sede");
    expect(appPubblica(2).configId).toBe("config-della-sede");
  });

  it("un override a metà non si mescola con la piattaforma: vale la piattaforma, intera", () => {
    const a = getAppWhatsApp(4);
    a.appId = "app-della-sede";
    a.configId = "";
    a.appSecretCifrato = "";
    saveAppWhatsApp();

    const eff = appEffettiva(4);
    expect(eff.appId).toBe("app-di-piattaforma");
    expect(eff.configId).toBe("config-di-piattaforma");
    expect(eff.leggiAppSecret()).toBe("segreto-di-piattaforma");
  });

  it("senza variabili di piattaforma e senza override, non è pronta", () => {
    delete process.env.WHATSAPP_APP_ID;
    delete process.env.WHATSAPP_CONFIG_ID;
    delete process.env.WHATSAPP_APP_SECRET;
    expect(appPubblica(3).pronta).toBe(false);
  });

  it("il verify token resta per record: non arriva dall'ambiente", () => {
    expect(appPubblica(1).verifyToken).toBeTruthy();
    expect(tutteLeAppWhatsApp().length).toBeGreaterThan(0);
  });
});

// I5: il gate che accende un numero guardava solo il record per sede, quindi
// con l'app di piattaforma pronta l'attivazione veniva rifiutata chiedendo un
// app secret che c'era già.
describe("attivazione di un numero con l'app di piattaforma", () => {
  it("l'app secret di piattaforma basta ad accendere il numero", async () => {
    process.env.MAIL_ENCRYPTION_KEY =
      process.env.MAIL_ENCRYPTION_KEY ?? "a".repeat(64);
    const caller = appRouter.createCaller(ctxDirezione(1));
    const creata = await caller.mail.whatsapp.create({
      nome: "Numero di prova",
      numero: "+39 000 0000",
      phoneNumberId: "PN-PIATTAFORMA-1",
      wabaId: "WABA-PIATTAFORMA-1",
      token: "token-di-prova",
      verifyToken: "verify-di-prova",
    });
    // Nessun app secret sul numero, nessun override sulla sede: c'è solo
    // quello della piattaforma.
    const app = getAppWhatsApp(1);
    app.appSecretCifrato = "";
    saveAppWhatsApp();

    const aggiornata = await caller.mail.whatsapp.update({
      id: creata.id,
      attiva: true,
    });
    expect(aggiornata.attiva).toBe(true);

    const i = configWhatsApp.findIndex(c => c.id === creata.id);
    if (i >= 0) configWhatsApp.splice(i, 1);
  });
});

// Il verify token si configura una volta su Meta, a livello di app: la
// piattaforma ne ha uno suo, e l'handshake deve accettarlo anche prima che
// esista un numero o un record per sede.
describe("verify token del webhook", () => {
  it("il token di piattaforma passa l'handshake", () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "verify-di-piattaforma";
    expect(verifyTokenValido("verify-di-piattaforma")).toBe(true);
  });

  it("senza la variabile, un token qualsiasi non passa", () => {
    expect(verifyTokenValido("verify-di-piattaforma")).toBe(false);
  });

  it("i token per sede continuano a valere", () => {
    expect(verifyTokenValido(getAppWhatsApp(1).verifyToken)).toBe(true);
  });

  it("una variabile vuota non apre la porta a un token vuoto", () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "   ";
    expect(verifyTokenValido("")).toBe(false);
    expect(verifyTokenValido("   ")).toBe(false);
  });
});

// Direzione, 09/09/2026: «le aziende non dovrebbero vedere né modificare
// queste cose». Webhook, verify token, credenziali proprie e percorso a mano
// sono dell'app Meta della piattaforma: al cliente resta «Collega col QR».
describe("la configurazione dell'app è della piattaforma, non delle aziende clienti", () => {
  // Un'azienda cliente vera, con i suoi store: il middleware tRPC entra nel
  // tenant della sessione (`conTenant`), e senza store istanziati la
  // lettura dell'app fallirebbe per un'altra ragione.
  let t2: TenantRecord;
  beforeAll(async () => {
    resetTenantRepositoryForTesting();
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "Ruffino Group" });
    t2 = await repo.inserisci({ slug: "acme-whatsapp", nome: "Acme Infissi" });
    await istanziaStoresPerTenant(t2.id);
  });

  function ctxAzienda(tenantId: number, sedeId: number): TrpcContext {
    return { ...ctxDirezione(sedeId), tenantId };
  }

  it("`app` dice a chi gestisce la piattaforma che può vederla, col verify token", async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "verify-di-piattaforma";
    const caller = appRouter.createCaller(ctxAzienda(1, 1));
    const app = await caller.mail.whatsapp.app();
    expect(app.piattaforma).toBe(true);
    expect(app.verifyToken).toBeTruthy();
  });

  it("a un'azienda cliente `app` risponde senza verify token e senza il diritto di vedere", async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "verify-di-piattaforma";
    const caller = appRouter.createCaller(ctxAzienda(t2.id, 7));
    const app = await caller.mail.whatsapp.app();
    expect(app.piattaforma).toBe(false);
    expect(app.verifyToken).toBeNull();
    expect(JSON.stringify(app)).not.toContain("verify-di-piattaforma");
    // Il QR resta suo: l'app di piattaforma è pronta anche per lei.
    expect(app.pronta).toBe(true);
  });

  it("senza tenant nella sessione la porta è chiusa", async () => {
    const caller = appRouter.createCaller({ ...ctxDirezione(1), tenantId: null });
    const app = await caller.mail.whatsapp.app();
    expect(app.piattaforma).toBe(false);
    expect(app.verifyToken).toBeNull();
  });

  it("un'azienda cliente non scrive le credenziali proprie dell'app", async () => {
    const caller = appRouter.createCaller(ctxAzienda(t2.id, 7));
    await expect(
      caller.mail.whatsapp.setApp({ appId: "app-del-cliente" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getAppWhatsApp(7).appId).not.toBe("app-del-cliente");
  });

  it("un'azienda cliente non apre il percorso a mano: il numero si collega col QR", async () => {
    const caller = appRouter.createCaller(ctxAzienda(t2.id, 7));
    const prima = configWhatsApp.length;
    await expect(
      caller.mail.whatsapp.create({
        nome: "Numero a mano",
        verifyToken: "verify-del-cliente",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(configWhatsApp.length).toBe(prima);
  });

  it("chi gestisce la piattaforma continua a scrivere le credenziali proprie", async () => {
    const caller = appRouter.createCaller(ctxAzienda(1, 8));
    const esito = await caller.mail.whatsapp.setApp({ appId: "app-della-sede-8" });
    expect(esito.propri.appId).toBe("app-della-sede-8");
    const a = getAppWhatsApp(8);
    a.appId = "";
    saveAppWhatsApp();
  });
});
