import { beforeEach, describe, expect, it } from "vitest";
import { getTenantRepository, resetTenantRepositoryForTesting } from "./repository";

beforeEach(() => {
  resetTenantRepositoryForTesting();
});

describe("repository tenant in memoria", () => {
  it("semina il tenant 1 in modo idempotente e assegna gli id successivi", async () => {
    const repo = getTenantRepository();
    await repo.ensureSchema();
    const t1 = await repo.assicuraTenantPredefinito();
    const ancora = await repo.assicuraTenantPredefinito();
    expect(t1.id).toBe(1);
    expect(ancora.id).toBe(1);
    expect(t1.slug).toBe("ruffino-group");
    expect(t1.stato).toBe("attivo");
    const acme = await repo.inserisci({ slug: "acme", nome: "Acme Infissi" });
    expect(acme.id).toBe(2);
    expect(repo.perSlug("acme")?.id).toBe(2);
    expect(repo.perId(3)).toBeNull();
    expect(repo.tutti().map(t => t.id)).toEqual([1, 2]);
  });

  it("rifiuta slug duplicati", async () => {
    const repo = getTenantRepository();
    await repo.inserisci({ slug: "acme", nome: "Acme" });
    await expect(repo.inserisci({ slug: "acme", nome: "Acme bis" })).rejects.toThrow(/slug/);
  });

  it("aggiorna lo stato e registra eventi in ordine", async () => {
    const repo = getTenantRepository();
    const t = await repo.inserisci({ slug: "acme", nome: "Acme" });
    const sospeso = await repo.aggiornaStato(t.id, "sospeso", "insoluto");
    expect(sospeso.stato).toBe("sospeso");
    expect(repo.perId(t.id)?.motivoStato).toBe("insoluto");
    await repo.registraEvento({ tenantId: t.id, tipo: "creato", attore: "boot" });
    await repo.registraEvento({ tenantId: t.id, tipo: "sospeso", attore: "script:tenant@qui", motivo: "insoluto" });
    const eventi = await repo.eventi(t.id);
    expect(eventi.map(e => e.tipo)).toEqual(["creato", "sospeso"]);
    expect(eventi[1].motivo).toBe("insoluto");
  });

  it("i comandi passano da in_attesa a eseguito o errore, uno alla volta", async () => {
    const repo = getTenantRepository();
    const a = await repo.accodaComando({ tipo: "sospendi", tenantId: 1, payload: { slug: "ruffino-group", motivo: "prova" }, richiestoDa: "script:tenant@qui" });
    const b = await repo.accodaComando({ tipo: "riattiva", tenantId: 1, payload: { slug: "ruffino-group", motivo: "prova" }, richiestoDa: "script:tenant@qui" });
    expect((await repo.comandiInAttesa()).map(c => c.id)).toEqual([a.id, b.id]);

    const primo = await repo.prendiEdEsegui(async c => ({ visto: c.id }));
    expect(primo).toBe("eseguito");
    expect((await repo.comando(a.id))?.esito).toEqual({ visto: a.id });

    const secondo = await repo.prendiEdEsegui(async () => {
      throw new Error("payload rotto");
    });
    expect(secondo).toBe("errore");
    expect((await repo.comando(b.id))?.esito).toEqual({ errore: "payload rotto" });
    expect((await repo.comando(b.id))?.eseguitoAt).toBeInstanceOf(Date);

    expect(await repo.prendiEdEsegui(async () => ({}))).toBe("nessuno");
    expect(await repo.comandiInAttesa()).toEqual([]);
  });
});
