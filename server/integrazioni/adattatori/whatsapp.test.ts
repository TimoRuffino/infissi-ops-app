import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { Ctx } from "../contratto";
import { configWhatsApp } from "../../comunicazioni/whatsapp";
import { whatsapp } from "./whatsapp";

const ctx = { user: { id: 1, role: "admin" }, sedeId: 1, tenantId: 1 } as unknown as Ctx;

beforeEach(() => {
  configWhatsApp.length = 0;
  process.env.WHATSAPP_APP_ID = "app";
  process.env.WHATSAPP_CONFIG_ID = "config";
  process.env.WHATSAPP_APP_SECRET = "segreto";
});
afterEach(() => {
  configWhatsApp.length = 0;
  delete process.env.WHATSAPP_APP_ID;
  delete process.env.WHATSAPP_CONFIG_ID;
  delete process.env.WHATSAPP_APP_SECRET;
});

function seminaNumero(campi: Record<string, unknown> = {}) {
  configWhatsApp.push({
    id: 1,
    sedeId: 1,
    numero: "+39 0187 872687",
    phoneNumberId: "123",
    wabaId: "456",
    attiva: true,
    tokenCifrato: "v1.finto",
    appSecretCifrato: "",
    verifyToken: "vt",
    ultimoErrore: null,
    ...campi,
  } as any);
}

describe("adattatore whatsapp", () => {
  it("nessun numero: da collegare, senza problema", async () => {
    const s = await whatsapp.stato(ctx);
    expect(s.collegato).toBe(false);
    expect(s.problema).toBeNull();
  });

  it("lo stato nomina il numero, non dice «ok»", async () => {
    seminaNumero();
    const s = await whatsapp.stato(ctx);
    expect(s.collegato).toBe(true);
    expect(s.soggetto).toBe("+39 0187 872687");
  });

  it("il numero di un'altra sede non compare", async () => {
    seminaNumero({ sedeId: 2, numero: "+39 000 altra" });
    const s = await whatsapp.stato(ctx);
    expect(s.collegato).toBe(false);
    expect(s.soggetto).toBeNull();
  });

  it("avvia restituisce il popup con il config id, non un url", async () => {
    await expect(whatsapp.avvia!(ctx)).resolves.toEqual({
      tipo: "popup",
      configId: "config",
    });
  });

  it("senza app di piattaforma pronta, avvia rifiuta invece di aprire un popup cieco", async () => {
    delete process.env.WHATSAPP_CONFIG_ID;
    await expect(whatsapp.avvia!(ctx)).rejects.toThrow(/piattaforma/i);
  });

  it("la finestra di 24 ore scaduta si racconta in italiano, non come errore Meta", async () => {
    seminaNumero({ ultimoErrore: "history sync window expired after 24 hours" });
    const p = await whatsapp.verifica(ctx);
    expect(p?.azione).toBe("ricollega");
    expect(p?.causa).toMatch(/24 ore/);
    expect(p?.causa).not.toMatch(/expired/);
  });

  it("nessun errore registrato: nessun problema", async () => {
    seminaNumero();
    expect(await whatsapp.verifica(ctx)).toBeNull();
  });
});
