// Task 10 (WS2 «porta aperta»): il giro ricorrente del worker «costo da
// conferma» gira per tenant, ognuno nel suo contesto. Il Task 6 aveva già
// sistemato il conteggio del boot (costoDaConfermaWorker.boot.test.ts), ma
// il `giro()` che parte ogni minuto chiamava ancora
// `eseguiGiroCostiDaConferma()` fuori da qualunque contesto: con
// FLAG_MULTI_AZIENDA acceso ogni tick logga «accesso allo store
// preventivi_documenti senza tenant nel contesto».
//
// Punto d'osservazione: `documentiConfermaOrdine` (in
// `../routers/preventiviContratti`, un file diverso dal worker), che è
// esattamente la lettura di store che il contesto deve coprire.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __registraTenantNotoPerTest } from "../_core/persistence";
import { modalitaTenantStretta, tenantCorrente } from "../tenants/contestoCorrente";
import {
  getTenantRepository,
  resetTenantRepositoryForTesting,
} from "../tenants/repository";

const visti: Array<number | null> = [];
vi.mock("../routers/preventiviContratti", async originale => ({
  ...(await originale<typeof import("../routers/preventiviContratti")>()),
  documentiConfermaOrdine: vi.fn(() => {
    visti.push(tenantCorrente());
    return [];
  }),
}));

import { eseguiGiroCostiPerOgniTenant } from "./costoDaConfermaWorker";

describe("costo da conferma: giro ricorrente per tenant (Task 10)", () => {
  beforeEach(async () => {
    delete process.env.FLAG_MULTI_AZIENDA; // nei test = acceso
    modalitaTenantStretta(true);
    resetTenantRepositoryForTesting();
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "RG" });
    await repo.inserisci({ id: 2, slug: "acme", nome: "Acme" });
    __registraTenantNotoPerTest(2);
    visti.length = 0;
  });
  afterEach(() => modalitaTenantStretta(false));

  it("un giro per ogni tenant attivo, ognuno nel suo contesto", async () => {
    const errore = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await eseguiGiroCostiPerOgniTenant();
      expect(errore).not.toHaveBeenCalled();
    } finally {
      errore.mockRestore();
    }
    // `eseguiGiroCostiDaConferma` legge le conferme due volte per giro
    // (il lotto e il conteggio delle rimaste): quel che conta è che nessuna
    // lettura avvenga fuori contesto e che i tenant siano tutti e due.
    expect(visti.length).toBeGreaterThanOrEqual(2);
    expect(visti).not.toContain(null);
    expect([...new Set(visti)].sort()).toEqual([1, 2]);
  });
});
