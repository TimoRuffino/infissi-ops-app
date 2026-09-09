// Task 12 (WS3): il pannello storage è per azienda. Prima di questo fix
// `status()` filtrava gli store snapshot per `s.key` nuda — con gli store
// per tenant la chiave nuda è l'alias del tenant 1, quindi ogni azienda
// vedeva i conteggi di Ruffino Group. Qui si verifica che ogni tenant veda
// SOLO le proprie collezioni.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { __registraTenantNotoPerTest, storeDi } from "../_core/persistence";
// L'import dei router registra `preventivi_documenti` e `ticket_allegati`
// (side effect dei moduli `preventiviContratti.ts` / `ticketAllegati.ts`).
import "../routers";
import { fileStorageAdminRouter } from "./fileStorageAdmin";
import type { Documento } from "./preventiviContratti";

const UTENTE = 90611;
const SEDE = 90601;

function context(tenantId: number, ruoli: string[] = ["direzione"]): TrpcContext {
  return {
    user: {
      id: UTENTE,
      role: ruoli.includes("direzione") ? "admin" : "user",
      ruolo: ruoli[0],
      ruoli,
      name: `Utente ${UTENTE}`,
    } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId: SEDE,
    sediIds: [SEDE],
    tenantId,
    tenant: null,
  };
}

describe("fileStorageAdminRouter per tenant (Task 12)", () => {
  beforeEach(() => {
    delete process.env.FLAG_MULTI_AZIENDA; // nei test = acceso
    __registraTenantNotoPerTest(2);
    // Ogni test riparte da collezioni vuote per entrambi i tenant: gli
    // store sono moduli condivisi da tutto il file (mai un reset globale
    // qui, si importano i router).
    storeDi<Documento>(1, "preventivi_documenti").length = 0;
    storeDi<Documento>(2, "preventivi_documenti").length = 0;
    storeDi<any>(1, "ticket_allegati").length = 0;
    storeDi<any>(2, "ticket_allegati").length = 0;
  });
  afterEach(() => {
    delete process.env.FLAG_MULTI_AZIENDA;
  });

  it("status: il tenant 2 vede solo i propri documenti, il tenant 1 non li vede", async () => {
    storeDi<Documento>(2, "preventivi_documenti").push(
      { id: 1, dataBase64: "QUJD" } as any, // "ABC" in base64 → 3 byte
      {
        id: 2,
        storageKey: "tenant/2/preventivi_documenti/1/2-aaaaaaaa.pdf",
      } as any
    );

    const perTenant2 = await fileStorageAdminRouter.createCaller(context(2)).status();
    const collezioneTenant2 = perTenant2.collections.find(c => c.key === "preventivi_documenti");
    expect(collezioneTenant2).toEqual({
      key: "preventivi_documenti",
      total: 2,
      inline: 1,
      migrati: 1,
      inlineBytes: 3,
    });

    const perTenant1 = await fileStorageAdminRouter.createCaller(context(1)).status();
    const collezioneTenant1 = perTenant1.collections.find(c => c.key === "preventivi_documenti");
    expect(collezioneTenant1?.total).toBe(0);
  });

  it("status: un utente non di direzione riceve FORBIDDEN", async () => {
    await expect(
      fileStorageAdminRouter.createCaller(context(1, ["commerciale"])).status()
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
