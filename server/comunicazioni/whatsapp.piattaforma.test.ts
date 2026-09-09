import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
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
    delete process.env.WHATSAPP_VERIFY_TOKEN;
  });

  it("senza la variabile, un token qualsiasi non passa", () => {
    delete process.env.WHATSAPP_VERIFY_TOKEN;
    expect(verifyTokenValido("verify-di-piattaforma")).toBe(false);
  });

  it("i token per sede continuano a valere", () => {
    expect(verifyTokenValido(getAppWhatsApp(1).verifyToken)).toBe(true);
  });

  it("una variabile vuota non apre la porta a un token vuoto", () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "   ";
    expect(verifyTokenValido("")).toBe(false);
    expect(verifyTokenValido("   ")).toBe(false);
    delete process.env.WHATSAPP_VERIFY_TOKEN;
  });
});
