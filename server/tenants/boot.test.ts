import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { avviaTenants, fermaTenants } from "./boot";
import { INTERVALLO_COMANDI_MS } from "./costanti";
import { getTenantRepository, resetTenantRepositoryForTesting } from "./repository";

beforeEach(() => {
  resetTenantRepositoryForTesting();
  vi.useFakeTimers();
});

afterEach(() => {
  fermaTenants();
  vi.useRealTimers();
  delete process.env.FLAG_MULTI_AZIENDA;
});

describe("avviaTenants", () => {
  it("acceso: semina il tenant 1 ed esegue i comandi al boot e ogni 30 s", async () => {
    const repo = getTenantRepository();
    await avviaTenants();
    expect(repo.perId(1)?.slug).toBe("ruffino-group");
    await repo.accodaComando({
      tipo: "sospendi",
      tenantId: 1,
      payload: { slug: "ruffino-group", motivo: "prova del boot" },
      richiestoDa: "script:tenant@test",
    });
    await vi.advanceTimersByTimeAsync(INTERVALLO_COMANDI_MS + 10);
    expect(repo.perId(1)?.stato).toBe("sospeso");
  });

  it("spento: schema e cache, nessun seed, comandi lasciati in attesa", async () => {
    process.env.FLAG_MULTI_AZIENDA = "off";
    const repo = getTenantRepository();
    await repo.accodaComando({
      tipo: "sospendi",
      tenantId: 1,
      payload: { slug: "ruffino-group", motivo: "resta in attesa" },
      richiestoDa: "script:tenant@test",
    });
    await avviaTenants();
    expect(repo.perId(1)).toBeNull();
    expect((await repo.comandiInAttesa()).length).toBe(1);
  });
});
