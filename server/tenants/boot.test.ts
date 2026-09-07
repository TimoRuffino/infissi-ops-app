import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSediStore } from "../routers/sedi";
import { avviaTenants, completaTenants, fermaTenants, preparaTenants } from "./boot";
import { INTERVALLO_COMANDI_MS } from "./costanti";
import { righeTenantSedi } from "./regole";
import { getTenantRepository, resetTenantRepositoryForTesting } from "./repository";
import * as servizioModulo from "./servizio";

const SEDE_A = 91201;
const SEDE_B = 91202;

/** Due sedi di prova nello store vivo, con il loro ripristino. */
function seminaSedi(): () => void {
  const sedi = getSediStore();
  const quante = sedi.length;
  const now = new Date();
  const base = { citta: null, indirizzo: null, attiva: true, createdAt: now, updatedAt: now };
  sedi.push(
    { ...base, id: SEDE_A, tenantId: 1, nome: "Sede tenant 1" },
    { ...base, id: SEDE_B, tenantId: 2, nome: "Sede tenant 2" }
  );
  return () => sedi.splice(quante);
}

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

  it("spento: schema, cache e la sola riga del tenant 1 nel control plane; nessun altro store toccato, comandi lasciati in attesa", async () => {
    process.env.FLAG_MULTI_AZIENDA = "off";
    const repo = getTenantRepository();
    await repo.accodaComando({
      tipo: "sospendi",
      tenantId: 1,
      payload: { slug: "ruffino-group", motivo: "resta in attesa" },
      richiestoDa: "script:tenant@test",
    });
    await avviaTenants();
    // Task 12 fix round 1 (Ruling R13): la riga control plane del tenant 1 si
    // semina anche a interruttore spento — è additiva e inerte finché il
    // flag resta spento, ma serve allo specchio e al backfill del deploy
    // spento. Nessun altro tenant, nessun comando eseguito.
    expect(repo.perId(1)?.slug).toBe("ruffino-group");
    expect(repo.tutti().map(t => t.id)).toEqual([1]);
    expect((await repo.comandiInAttesa()).length).toBe(1);
  });
});

describe("preparaTenants", () => {
  it("spento: restituisce [1] e semina SOLO la riga del tenant 1 nel control plane (Ruling R13)", async () => {
    process.env.FLAG_MULTI_AZIENDA = "off";
    const repo = getTenantRepository();
    const ids = await preparaTenants();
    expect(ids).toEqual([1]);
    expect(repo.perId(1)?.slug).toBe("ruffino-group");
    expect(repo.tutti().map(t => t.id)).toEqual([1]);
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

  it("spento: la riga del tenant 1 è già seminata da preparaTenants; completaTenants non allinea il proprietario né esegue i comandi in attesa", async () => {
    process.env.FLAG_MULTI_AZIENDA = "off";
    const repo = getTenantRepository();
    const spiaAllinea = vi.spyOn(servizioModulo, "allineaTenantPredefinito");
    await repo.accodaComando({
      tipo: "sospendi",
      tenantId: 1,
      payload: { slug: "ruffino-group", motivo: "resta in attesa" },
      richiestoDa: "script:tenant@test",
    });
    await preparaTenants();
    // Ruling R13: la riga del tenant 1 esiste già dopo `preparaTenants`, a
    // interruttore spento. Ciò che resta condizionato all'interruttore, in
    // `completaTenants`, è solo la parte che tocca gli store: l'allineamento
    // del proprietario di ripiego e i comandi in attesa.
    expect(repo.perId(1)?.slug).toBe("ruffino-group");
    await completaTenants();
    expect(spiaAllinea).not.toHaveBeenCalled();
    expect((await repo.comandiInAttesa()).length).toBe(1);
  });

  it("sincronizza lo specchio tenant_sedi anche a interruttore spento", async () => {
    process.env.FLAG_MULTI_AZIENDA = "off";
    const ripristina = seminaSedi();
    try {
      const repo = getTenantRepository();
      const spia = vi.spyOn(repo, "sincronizzaTenantSedi");
      const attese = righeTenantSedi(getSediStore());
      expect(attese).toEqual([
        { sedeId: SEDE_A, tenantId: 1 },
        { sedeId: SEDE_B, tenantId: 2 },
      ]);
      await preparaTenants();
      await completaTenants();
      expect(spia).toHaveBeenCalledWith(attese);
      // A interruttore spento il control plane ha SOLO la riga del tenant 1
      // (seminata da `preparaTenants`, Ruling R13): lo specchio registra la
      // sede del tenant 1 e SALTA SEDE_B, il cui tenant 2 non esiste ancora
      // nel control plane — non un errore (su Postgres sarebbe la chiave
      // esterna a rifiutarla, e il boot morirebbe lì se non saltassimo).
      expect(await repo.tenantSedi()).toEqual([{ sedeId: SEDE_A, tenantId: 1 }]);
    } finally {
      ripristina();
    }
  });

  it("acceso: lo specchio contiene le sedi dei tenant esistenti", async () => {
    const ripristina = seminaSedi();
    try {
      const repo = getTenantRepository();
      await preparaTenants(); // semina il tenant 1
      const due = await repo.inserisci({ slug: "due", nome: "Due Srl" });
      await completaTenants();
      expect(await repo.tenantSedi()).toEqual([
        { sedeId: SEDE_A, tenantId: 1 },
        { sedeId: SEDE_B, tenantId: due.id },
      ]);
    } finally {
      ripristina();
    }
  });
});
