import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { avviaTenants, completaTenants, fermaTenants, preparaTenants } from "./boot";
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

describe("preparaTenants", () => {
  it("spento: restituisce [1] e non semina nulla nel control plane", async () => {
    process.env.FLAG_MULTI_AZIENDA = "off";
    const repo = getTenantRepository();
    const ids = await preparaTenants();
    expect(ids).toEqual([1]);
    expect(repo.perId(1)).toBeNull();
  });

  it("acceso: semina il tenant 1 e restituisce tutti i tenant in cache, anche i sospesi", async () => {
    const repo = getTenantRepository();
    const primi = await preparaTenants();
    expect(primi).toEqual([1]);
    expect(repo.perId(1)?.slug).toBe("ruffino-group");
    const sospesa = await repo.inserisci({ slug: "sospesa", nome: "Sospesa Srl", stato: "sospeso" });
    const ids = await preparaTenants();
    expect([...ids].sort((a, b) => a - b)).toEqual([1, sospesa.id].sort((a, b) => a - b));
  });
});

describe("completaTenants", () => {
  it("non tocca lo schema: ensureSchema del repository lo chiama solo preparaTenants", async () => {
    const repo = getTenantRepository();
    const spy = vi.spyOn(repo, "ensureSchema");
    await preparaTenants();
    expect(spy).toHaveBeenCalledTimes(1);
    await completaTenants();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("spento: non semina nulla, lascia i comandi in attesa", async () => {
    process.env.FLAG_MULTI_AZIENDA = "off";
    const repo = getTenantRepository();
    await repo.accodaComando({
      tipo: "sospendi",
      tenantId: 1,
      payload: { slug: "ruffino-group", motivo: "resta in attesa" },
      richiestoDa: "script:tenant@test",
    });
    await preparaTenants();
    await completaTenants();
    expect(repo.perId(1)).toBeNull();
    expect((await repo.comandiInAttesa()).length).toBe(1);
  });
});
