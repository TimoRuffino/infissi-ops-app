// Fix round 1 (Task 5 WS4, R10): `ErroreQuotaStorage` (la quota che blocca,
// spec WS4 §6) deve propagarsi da `ticketAllegati.upload` — non ricadere nel
// fallback `dataBase64` inline, pensato SOLO per un guasto infrastrutturale
// dello storage. Il fallback bypasserebbe sia il blocco sia il ledger
// (`ricalcolaStorage` non conta i record `dataBase64`).
//
// Driver in memoria via `__impostaDriverPerTest` (stesso pattern di
// `fileStorage.tenant.test.ts`): `putFile` è quello VERO, così il gancio
// registrato con `impostaVerificaQuota` gira per davvero dentro `putFile`,
// non in un mock che lo aggirerebbe.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";
import {
  __impostaDriverPerTest,
  impostaVerificaQuota,
  type StorageDriver,
} from "../_core/fileStorage";

const SEDE = 96201;

function context(sedeId: number): TrpcContext {
  return {
    user: {
      id: sedeId + 10_000,
      role: "admin",
      ruolo: "direzione",
      ruoli: ["direzione"],
      name: "Allegati Test",
    } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
    tenantId: 1,
    tenant: null,
  };
}

function driverInMemoria(): StorageDriver & { file: Map<string, Buffer> } {
  const file = new Map<string, Buffer>();
  return {
    name: "local",
    file,
    async put(k, b) {
      file.set(k, b);
    },
    async get(k) {
      return file.get(k) ?? null;
    },
    async openRead() {
      return null;
    },
    async delete(k) {
      file.delete(k);
    },
    async head(k) {
      const b = file.get(k);
      return b ? { bytes: b.length } : null;
    },
  };
}

describe("ticketAllegati.upload — la quota che blocca (R10)", () => {
  let driver = driverInMemoria();

  beforeEach(() => {
    delete process.env.FLAG_MULTI_AZIENDA; // nei test = acceso
    driver = driverInMemoria();
    __impostaDriverPerTest(driver);
  });

  afterEach(() => {
    delete process.env.FLAG_MULTI_AZIENDA;
    __impostaDriverPerTest(null);
    impostaVerificaQuota(null);
  });

  it("con la quota esaurita l'upload rifiuta con PRECONDITION_FAILED e non ricade sul base64 inline", async () => {
    const caller = appRouter.createCaller(context(SEDE));
    const ticket = await caller.ticket.create({
      oggetto: "Serranda bloccata",
      categoria: "altro",
    });

    impostaVerificaQuota(async () => ({ messaggio: "Spazio esaurito: prova" }));

    await expect(
      caller.ticketAllegati.upload({
        ticketId: ticket.id,
        nome: "foto.png",
        mimeType: "image/png",
        size: 3,
        dataBase64: Buffer.from("abc").toString("base64"),
      })
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "Spazio esaurito: prova",
    });

    // Il driver non ha mai visto il file (il gancio rifiuta prima di
    // `driver.put`) e nessun allegato è stato creato — né su storage né
    // come ripiego inline.
    expect(driver.file.size).toBe(0);
    await expect(caller.ticketAllegati.byTicket(ticket.id)).resolves.toHaveLength(0);
  });

  it("senza gancio di quota l'upload va a buon fine com'era prima (nessuna regressione)", async () => {
    const caller = appRouter.createCaller(context(SEDE));
    const ticket = await caller.ticket.create({
      oggetto: "Vetro rigato",
      categoria: "difetto_prodotto",
    });

    const salvato = await caller.ticketAllegati.upload({
      ticketId: ticket.id,
      nome: "foto.png",
      mimeType: "image/png",
      size: 3,
      dataBase64: Buffer.from("abc").toString("base64"),
    });

    expect(salvato.hasData).toBe(true);
    expect(driver.file.size).toBe(1);
    await expect(caller.ticketAllegati.byTicket(ticket.id)).resolves.toHaveLength(1);
  });
});
