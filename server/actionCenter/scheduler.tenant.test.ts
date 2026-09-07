// Task 10 (WS2 «porta aperta»): il giro di riconciliazione del Centro Azioni
// gira per tenant, ognuno nel suo contesto. Prima girava su `getSediStore()`
// (store globale: tutte le sedi di tutte le aziende) fuori da qualunque
// contesto, e con FLAG_MULTI_AZIENDA acceso ogni `collectCurrentSignals`
// falliva con «accesso allo store … senza tenant nel contesto» — lo si vede
// nel log di boot fin dal primo tick.
//
// Il punto d'osservazione è `collectCurrentSignals` (in `./sources`, un file
// diverso da `./scheduler`): registra la sede e il tenant nel contesto. Le
// altre dipendenze del reconcile sono neutralizzate perché questo test
// riguarda solo il contesto del giro, non il reconcile.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { modalitaTenantStretta, tenantCorrente } from "../tenants/contestoCorrente";
import {
  getTenantRepository,
  resetTenantRepositoryForTesting,
} from "../tenants/repository";
import { getSediStore } from "../routers/sedi";

const visti: Array<{ sedeId: number; tenant: number | null }> = [];

vi.mock("./sources", () => ({
  collectCurrentSignals: vi.fn((sedeId: number) => {
    visti.push({ sedeId, tenant: tenantCorrente() });
    if (sedeId === 20) throw new Error("segnali non disponibili");
    return [];
  }),
}));
vi.mock("../tars/smistamento/segnali", () => ({
  segnaliSmistamento: vi.fn(async () => []),
}));
vi.mock("../tars/followup/preventivi", () => ({
  segnaliFollowupPreventivi: vi.fn(async () => []),
}));
vi.mock("../tars/proattivita/worker", () => ({
  osservaDaReconcile: vi.fn(async () => {}),
}));
vi.mock("./repository", () => ({
  getActionCaseRepository: vi.fn(() => ({})),
}));
vi.mock("./reconcile", async originale => ({
  ...(await originale<typeof import("./reconcile")>()),
  reconcileActionCases: vi.fn(async () => ({
    created: 0,
    updated: 0,
    unchanged: 0,
    autoResolved: 0,
    reopened: 0,
    queuedForTars: 0,
  })),
}));

import { reconcileAllSites } from "./scheduler";

describe("Centro Azioni: riconciliazione per tenant (Task 10)", () => {
  beforeEach(async () => {
    delete process.env.FLAG_MULTI_AZIENDA; // nei test = acceso
    modalitaTenantStretta(true);
    resetTenantRepositoryForTesting();
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "RG" });
    await repo.inserisci({ id: 2, slug: "acme", nome: "Acme" });
    getSediStore().length = 0;
    getSediStore().push(
      { id: 10, tenantId: 1, nome: "A", attiva: true } as any,
      { id: 20, tenantId: 2, nome: "B", attiva: true } as any,
      { id: 21, tenantId: 2, nome: "C", attiva: true } as any,
      { id: 22, tenantId: 2, nome: "D", attiva: false } as any
    );
    visti.length = 0;
  });
  afterEach(() => modalitaTenantStretta(false));

  it("ogni sede attiva gira nel contesto del suo tenant e un errore non ferma le altre", async () => {
    const errore = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await reconcileAllSites();
      // Le sedi partono dentro `conTenant`: la promise avviata con `void`
      // eredita il contesto anche senza await.
      await new Promise(resolve => setTimeout(resolve, 0));
    } finally {
      errore.mockRestore();
    }
    expect(visti).toEqual([
      { sedeId: 10, tenant: 1 },
      { sedeId: 20, tenant: 2 },
      { sedeId: 21, tenant: 2 },
    ]);
  });

  it("le sedi non attive restano fuori dal giro (invariato)", async () => {
    await reconcileAllSites();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(visti.map(v => v.sedeId)).not.toContain(22);
  });
});
