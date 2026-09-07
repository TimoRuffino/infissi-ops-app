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

  it("azzera passwordHash nel payload alla chiusura del comando crea (Minor 1)", async () => {
    const repo = getTenantRepository();
    const payload = {
      slug: "acme",
      nome: "Acme Infissi",
      sede: { nome: "Acme Infissi" },
      proprietario: {
        nome: "Mario",
        cognome: "Rossi",
        email: "mario@acme.test",
        passwordHash: "scrypt$deadbeef$…",
      },
    };
    const comando = await repo.accodaComando({
      tipo: "crea",
      tenantId: null,
      payload,
      richiestoDa: "script:tenant@test",
    });
    expect((await repo.comando(comando.id))?.payload.proprietario).toMatchObject({
      passwordHash: payload.proprietario.passwordHash,
    });
    await repo.prendiEdEsegui(async () => ({ tenantId: 1 }));
    const chiuso = await repo.comando(comando.id);
    expect(chiuso?.stato).toBe("eseguito");
    expect((chiuso?.payload as any)?.proprietario?.passwordHash).toBeUndefined();
    // Il resto del payload resta leggibile (non è un redact totale).
    expect((chiuso?.payload as any)?.proprietario?.email).toBe("mario@acme.test");
  });

  it("lo specchio delle sedi in memoria è idempotente, segue il tenant di una sede e salta i tenant inesistenti", async () => {
    const repo = getTenantRepository();
    await repo.assicuraTenantPredefinito();
    const due = await repo.inserisci({ slug: "due", nome: "Due Srl" });
    expect(await repo.tenantSedi()).toEqual([]);
    await repo.sincronizzaTenantSedi([
      { sedeId: 2, tenantId: 1 },
      { sedeId: 1, tenantId: 1 },
    ]);
    await repo.sincronizzaTenantSedi([{ sedeId: 1, tenantId: 1 }]);
    // Ordinate per sede, come la variante Postgres.
    expect(await repo.tenantSedi()).toEqual([
      { sedeId: 1, tenantId: 1 },
      { sedeId: 2, tenantId: 1 },
    ]);
    await repo.sincronizzaTenantSedi([{ sedeId: 2, tenantId: due.id }]);
    expect(await repo.tenantSedi()).toEqual([
      { sedeId: 1, tenantId: 1 },
      { sedeId: 2, tenantId: due.id },
    ]);
    // Tenant inesistente: la riga viene saltata, come farebbe la chiave
    // esterna su Postgres. Non è un errore.
    await repo.sincronizzaTenantSedi([{ sedeId: 3, tenantId: 99 }]);
    expect((await repo.tenantSedi()).map(r => r.sedeId)).toEqual([1, 2]);
    await repo.sincronizzaTenantSedi([]);
    expect((await repo.tenantSedi()).length).toBe(2);
  });
});
