// Task 10 (WS2 «porta aperta»): il giro orario del sync Fatture in Cloud
// gira per tenant, ognuno nel suo contesto. Prima scorreva `allSedeIds()`
// (store globale delle sedi: tutte le aziende) fuori da qualunque contesto,
// e `getCfg(sedeId)` — che legge lo store per tenant `fic_config` — con
// FLAG_MULTI_AZIENDA acceso falliva per ogni sede.
//
// `dip.sync` (default `runFicSync`) è iniettabile solo per i test, come
// `dip.giro` di `startSondaFattureWorker`: qui la produzione non lo passa
// mai. Nessuna rete.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __registraTenantNotoPerTest, storeDi } from "../_core/persistence";
import { modalitaTenantStretta, tenantCorrente } from "../tenants/contestoCorrente";
import {
  getTenantRepository,
  resetTenantRepositoryForTesting,
} from "../tenants/repository";
import { getSediStore } from "./sedi";
import { giroFic, type FicConfig } from "./fattureInCloud";

const cfgCollegata = (id: number, sedeId: number): FicConfig => ({
  id,
  sedeId,
  accessTokenCifrato: "v1.finto",
  refreshTokenCifrato: null,
  accessTokenExpiresAt: null,
  oauthConnectedAt: null,
  authMode: "manual",
  companyId: 700 + sedeId,
  enabled: true,
  lastSyncAt: null,
  lastResult: null,
  lastStats: null,
  economicScopesReady: true,
  scopeScrittura: false,
});

describe("scheduler Fatture in Cloud per tenant (Task 10)", () => {
  const visti: Array<{ sedeId: number; tenant: number | null }> = [];

  beforeEach(async () => {
    delete process.env.FLAG_MULTI_AZIENDA; // nei test = acceso
    modalitaTenantStretta(true);
    resetTenantRepositoryForTesting();
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "RG" });
    await repo.inserisci({ id: 2, slug: "acme", nome: "Acme" });
    __registraTenantNotoPerTest(2);
    getSediStore().length = 0;
    getSediStore().push(
      { id: 10, tenantId: 1, nome: "A", attiva: true } as any,
      { id: 20, tenantId: 2, nome: "B", attiva: true } as any,
      { id: 22, tenantId: 2, nome: "D", attiva: false } as any
    );
    storeDi<FicConfig>(1, "fic_config").length = 0;
    storeDi<FicConfig>(2, "fic_config").length = 0;
    storeDi<FicConfig>(1, "fic_config").push(cfgCollegata(1, 10));
    storeDi<FicConfig>(2, "fic_config").push(cfgCollegata(2, 20));
    visti.length = 0;
  });
  afterEach(() => modalitaTenantStretta(false));

  it("ogni sede collegata gira nel contesto del suo tenant, leggendo la sua configurazione", async () => {
    const errore = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await giroFic({
        sync: async sedeId => {
          visti.push({ sedeId, tenant: tenantCorrente() });
        },
      });
      expect(errore).not.toHaveBeenCalled();
    } finally {
      errore.mockRestore();
    }
    expect(visti).toEqual([
      { sedeId: 10, tenant: 1 },
      { sedeId: 20, tenant: 2 },
    ]);
  });

  it("un errore su una sede non ferma le altre", async () => {
    const errore = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await giroFic({
        sync: async sedeId => {
          visti.push({ sedeId, tenant: tenantCorrente() });
          if (sedeId === 10) throw new Error("token scaduto");
        },
      });
      expect(errore).toHaveBeenCalledTimes(1);
    } finally {
      errore.mockRestore();
    }
    expect(visti.map(v => v.sedeId)).toEqual([10, 20]);
  });

  it("una sede senza configurazione collegata non viene sincronizzata (invariato)", async () => {
    storeDi<FicConfig>(2, "fic_config").length = 0;
    await giroFic({
      sync: async sedeId => {
        visti.push({ sedeId, tenant: tenantCorrente() });
      },
    });
    expect(visti.map(v => v.sedeId)).toEqual([10]);
  });
});
