import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { getAppWhatsApp, appPubblica, tutteLeAppWhatsApp } from "./whatsapp";

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

  it("l'override per sede vince: è la via di fuga se l'app di piattaforma viene limitata", () => {
    const a = getAppWhatsApp(2);
    a.appId = "app-della-sede";
    expect(appPubblica(2).appId).toBe("app-della-sede");
    expect(appPubblica(2).configId).toBe("config-di-piattaforma");
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
