// server/tars/contesto.tenant.test.ts
import { describe, expect, it } from "vitest";
import { contestoDiProva } from "../_core/contestoDiProva";
import { catalogoAzioniPerContesto } from "./azioni/policy";
import { costruisciContesto } from "./contesto";
import { contestoServer } from "./strumenti/comune";

describe("ContestoRun con il tenant (WS1)", () => {
  it("porta tenantId e il fingerprint cambia col tenant", async () => {
    const a = await costruisciContesto(contestoDiProva({ utenteId: 97801, sedeId: 97811, tenantId: 1 }));
    const b = await costruisciContesto(contestoDiProva({ utenteId: 97801, sedeId: 97811, tenantId: 2 }));
    expect(a.tenantId).toBe(1);
    expect(b.tenantId).toBe(2);
    expect(a.capabilityFingerprint).not.toBe(b.capabilityFingerprint);
  });

  it("senza sede o senza azienda la sessione è rifiutata, niente fallback", async () => {
    await expect(
      costruisciContesto(contestoDiProva({ utenteId: 97801, sedeId: null, tenantId: 1 }))
    ).rejects.toThrow(/sessione senza sede/);
    await expect(
      costruisciContesto(contestoDiProva({ utenteId: 97801, sedeId: 97811, tenantId: null }))
    ).rejects.toThrow(/sessione senza azienda/);
  });

  it("il catalogo è vuoto senza un tenant valido e il ctx di dominio porta il tenant", async () => {
    const c = await costruisciContesto(contestoDiProva({ utenteId: 97801, sedeId: 97811, tenantId: 1 }));
    expect(catalogoAzioniPerContesto(c).length).toBeGreaterThan(0);
    expect(catalogoAzioniPerContesto({ ...c, tenantId: 0 })).toEqual([]);
    expect(contestoServer(c).tenantId).toBe(1);
  });
});
