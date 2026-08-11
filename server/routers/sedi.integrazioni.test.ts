// Le integrazioni sono per sede. Questo test esiste perché la separazione è
// invisibile finché non si sbaglia: un token, una fattura o un interruttore
// condivisi non danno errore — mostrano semplicemente i dati di un'altra
// azienda del gruppo dentro la pagina sbagliata.
//
// Fuori dal perimetro, per scelta: il backup su Google Drive resta uno per
// installazione (una copia di tutto, non una per sede).

import { describe, expect, it } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import { upsertFatture, ficFatture } from "./ficFatture";
import { getTarsConfig } from "../tars/stores";
import {
  getAppWhatsApp,
  verifyTokenValido,
  tutteLeAppWhatsApp,
} from "../tars/whatsapp";

function ctxSede(sedeId: number): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "local-1",
      name: "Admin Ruffino",
      email: "admin@ruffinogroup.it",
      loginMethod: "local",
      role: "admin",
      ruolo: "direzione",
      ruoli: ["direzione"],
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } as any,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    sedeId,
    sediIds: [1, 2],
  };
}

const fattura = (id: number, importo: number) => ({
  id,
  numero: `${id}/A`,
  data: `${new Date().getFullYear()}-03-14`,
  clienteNome: "Cliente Di Prova",
  clienteVat: null,
  clienteCf: null,
  importoNetto: importo,
  importoLordo: importo,
  rate: [],
});

describe("integrazioni separate per sede", () => {
  it("le fatture di una sede non entrano nell'elenco dell'altra", async () => {
    upsertFatture([fattura(70001, 1000)], 1);
    upsertFatture([fattura(70002, 2000)], 2);

    const dellaUno = await appRouter.createCaller(ctxSede(1)).ficFatture.list();
    const dellaDue = await appRouter.createCaller(ctxSede(2)).ficFatture.list();

    expect(dellaUno.map((f) => f.id)).toContain(70001);
    expect(dellaUno.map((f) => f.id)).not.toContain(70002);
    expect(dellaDue.map((f) => f.id)).toContain(70002);
    expect(dellaDue.map((f) => f.id)).not.toContain(70001);
  });

  it("una fattura di un'altra sede non si collega né si ignora", async () => {
    const caller = appRouter.createCaller(ctxSede(1));
    // NOT_FOUND, non FORBIDDEN: l'id non deve confermare che il dato esista.
    await expect(
      caller.ficFatture.ignora({ ficId: 70002, ignorata: true })
    ).rejects.toThrow(/non trovata/i);
    expect(ficFatture.find((f) => f.id === 70002)!.ignorata).toBe(false);
  });

  it("l'Economia di una sede non conta il fatturato dell'altra", async () => {
    const uno = await appRouter.createCaller(ctxSede(1)).economia.overview();
    const due = await appRouter.createCaller(ctxSede(2)).economia.overview();
    // La sede 2 ha una sola fattura, da 2000: se contasse anche quelle della
    // sede 1 il totale sarebbe più alto.
    expect(due.fic.fatture).toBe(1);
    expect(due.fic.fatturato).toBe(2000);
    // E la sede 1 non vede la fattura da 2000 della sede 2.
    expect(uno.fic.fatturato).toBeGreaterThanOrEqual(1000);
    expect(uno.fic.fatture).toBe(
      ficFatture.filter((f) => f.sedeId === 1 && !f.ignorata).length
    );
  });

  it("Tars si accende su una sede sola", async () => {
    await appRouter.createCaller(ctxSede(1)).tars.config.setAttivo({ attivo: true });
    expect(getTarsConfig(1).attivo).toBe(true);
    expect(getTarsConfig(2).attivo).toBe(false);

    // E il modello è una scelta per sede.
    await appRouter
      .createCaller(ctxSede(2))
      .tars.config.setModello({ modello: "claude-sonnet-5" });
    expect(getTarsConfig(2).modello).toBe("claude-sonnet-5");
    expect(getTarsConfig(1).modello).toBe("claude-opus-5");
  });

  it("ogni sede ha la sua app Meta, e il webhook accetta entrambe", () => {
    const uno = getAppWhatsApp(1);
    const due = getAppWhatsApp(2);
    expect(uno.id).not.toBe(due.id);
    expect(uno.verifyToken).not.toBe(due.verifyToken);
    // L'URL del callback è uno: l'handshake deve valere per tutte le sedi.
    expect(verifyTokenValido(uno.verifyToken)).toBe(true);
    expect(verifyTokenValido(due.verifyToken)).toBe(true);
    expect(tutteLeAppWhatsApp().length).toBeGreaterThanOrEqual(2);
  });

  it("un app secret salvato su una sede non compare sull'altra", async () => {
    process.env.MAIL_ENCRYPTION_KEY =
      process.env.MAIL_ENCRYPTION_KEY ?? "a".repeat(64);
    await appRouter
      .createCaller(ctxSede(1))
      .mail.whatsapp.setApp({ appId: "111", configId: "222" });

    const appUno = await appRouter.createCaller(ctxSede(1)).mail.whatsapp.app();
    const appDue = await appRouter.createCaller(ctxSede(2)).mail.whatsapp.app();
    expect(appUno.appId).toBe("111");
    expect(appDue.appId).toBe("");
  });
});
