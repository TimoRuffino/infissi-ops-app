// server/tenants/pietreMiliari.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __azzeraPietreMiliariPerTest, segnaPietraMiliare } from "./pietreMiliari";
import { getTenantRepository, resetTenantRepositoryForTesting } from "./repository";

beforeEach(async () => {
  resetTenantRepositoryForTesting();
  __azzeraPietreMiliariPerTest();
  await getTenantRepository().assicuraTenantPredefinito();
});

afterEach(() => {
  delete process.env.FLAG_MULTI_AZIENDA;
  vi.restoreAllMocks();
});

describe("segnaPietraMiliare", () => {
  it("registra una volta sola, anche azzerando la cache (l'evento a terra basta)", async () => {
    const repo = getTenantRepository();
    const t = await repo.inserisci({ slug: "acme", nome: "Acme" });
    await segnaPietraMiliare(t.id, "prima_commessa", { id: 7 });
    await segnaPietraMiliare(t.id, "prima_commessa", { id: 8 });
    __azzeraPietreMiliariPerTest(); // come un riavvio del processo
    await segnaPietraMiliare(t.id, "prima_commessa", { id: 9 });
    const eventi = (await repo.eventi(t.id)).filter(e => e.tipo === "prima_commessa");
    expect(eventi).toHaveLength(1);
    expect(eventi[0]).toMatchObject({ attore: "sistema", dettagli: { id: 7 } });
    // Tappe diverse restano indipendenti.
    await segnaPietraMiliare(t.id, "prima_fattura", { id: 1 });
    expect((await repo.eventi(t.id)).filter(e => e.tipo === "prima_fattura")).toHaveLength(1);
  });

  it("a interruttore spento non registra; un errore del repository non propaga", async () => {
    process.env.FLAG_MULTI_AZIENDA = "off";
    await segnaPietraMiliare(1, "prima_commessa");
    delete process.env.FLAG_MULTI_AZIENDA;
    const repo = getTenantRepository();
    expect((await repo.eventi(1)).length).toBe(0);
    const rotto = vi.spyOn(repo, "registraEvento").mockRejectedValue(new Error("db giù"));
    void rotto;
    const silenzia = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(segnaPietraMiliare(1, "prima_commessa")).resolves.toBeUndefined();
    expect(silenzia).toHaveBeenCalled();
  });
});
