// server/tenants/servizio.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "../_core/password";
import * as persistenceModulo from "../_core/persistence";
import { getSediStore } from "../routers/sedi";
import { getUtentiStore } from "../routers/utenti";
import { getTenantRepository, resetTenantRepositoryForTesting } from "./repository";
import {
  assegnaProprietario,
  assicuraTenantPredefinito,
  crea,
  eseguiComandiInAttesa,
  revocaProprietario,
  riattiva,
  sospendi,
} from "./servizio";

const sedi = getSediStore();
const utenti = getUtentiStore();
let nS = 0;
let nU = 0;
const script = { tipo: "script" as const, nome: "script:tenant@test" };

beforeEach(() => {
  resetTenantRepositoryForTesting();
  nS = sedi.length;
  nU = utenti.length;
});

afterEach(() => {
  sedi.splice(nS);
  utenti.splice(nU);
  delete process.env.FLAG_MULTI_AZIENDA;
  vi.restoreAllMocks();
});

const inputAcme = () => ({
  slug: "acme",
  nome: "Acme Infissi",
  sede: { nome: "Acme Infissi", citta: "Sarzana" },
  proprietario: { nome: "Mario", cognome: "Rossi", email: "mario@acme.test", passwordHash: hashPassword("Password-lunga-12") },
});

describe("crea", () => {
  it("crea tenant, prima sede e proprietario+direzione, con gli eventi", async () => {
    const esito = await crea(inputAcme(), script);
    expect(esito.creatoOra).toBe(true);
    expect(esito.tenant.slug).toBe("acme");
    const sede = sedi.find(s => s.id === esito.sedeId)!;
    expect(sede.tenantId).toBe(esito.tenant.id);
    const utente = utenti.find(u => u.id === esito.utenteId)!;
    expect(utente.ruoli).toEqual(["proprietario", "direzione"]);
    expect(utente.sediIds).toEqual([esito.sedeId]);
    expect(utente.tenantId).toBe(esito.tenant.id);
    const eventi = await getTenantRepository().eventi(esito.tenant.id);
    expect(eventi.map(e => e.tipo)).toEqual(["creato", "proprietario_assegnato"]);
    expect(eventi[0].attore).toBe("script:tenant@test");
  });

  it("è idempotente per slug e rifiuta slug non validi ed email di altre aziende", async () => {
    const primo = await crea(inputAcme(), script);
    const secondo = await crea(inputAcme(), script);
    expect(secondo.creatoOra).toBe(false);
    expect(secondo.tenant.id).toBe(primo.tenant.id);
    expect(secondo.sedeId).toBe(primo.sedeId);
    expect(secondo.utenteId).toBe(primo.utenteId);
    await expect(crea({ ...inputAcme(), slug: "Acme" }, script)).rejects.toThrow(/Slug/);
    await expect(crea({ ...inputAcme(), slug: "altra" }, script)).rejects.toThrow(/altra azienda/);
    expect(getTenantRepository().perSlug("altra")).toBeNull();
  });

  it("tenant esistente senza sedi: completa sede e proprietario, senza un secondo evento creato (Important 4)", async () => {
    const repo = getTenantRepository();
    const preesistente = await repo.inserisci({ slug: "acme", nome: "Acme Infissi" });
    const esito = await crea(inputAcme(), script);
    expect(esito.creatoOra).toBe(false);
    expect(esito.tenant.id).toBe(preesistente.id);
    const sede = sedi.find(s => s.id === esito.sedeId)!;
    expect(sede.tenantId).toBe(preesistente.id);
    const utente = utenti.find(u => u.id === esito.utenteId)!;
    expect(utente.tenantId).toBe(preesistente.id);
    const eventi = await repo.eventi(preesistente.id);
    // Nessun evento "creato": la riga tenant non è nata in questa chiamata.
    expect(eventi.map(e => e.tipo)).toEqual(["proprietario_assegnato"]);
  });

  it("un commit fallito ripristina sedi e utenti spinti in questo giro; l'evento creato resta (Important 4)", async () => {
    // conTransazioneStoreAtomica reale non fallisce mai in test (niente
    // DATABASE_URL: `commit()` interno è un no-op) — la sostituiamo con una
    // versione che esegue comunque il callback di `crea` (così sede e utente
    // vengono davvero spinti negli array vivi) ma il cui `commit` rilancia.
    vi.spyOn(persistenceModulo, "conTransazioneStoreAtomica").mockImplementationOnce(
      (async (_stores: unknown, operazione: (commit: () => Promise<void>) => Promise<unknown>) =>
        operazione(async () => {
          throw new Error("commit fallito (prova)");
        })) as typeof persistenceModulo.conTransazioneStoreAtomica
    );
    await expect(crea(inputAcme(), script)).rejects.toThrow(/commit fallito/);
    const tenant = getTenantRepository().perSlug("acme");
    expect(tenant).not.toBeNull();
    expect(sedi.some(s => s.tenantId === tenant!.id)).toBe(false);
    expect(utenti.some((u: any) => u.tenantId === tenant!.id)).toBe(false);
    const eventi = await getTenantRepository().eventi(tenant!.id);
    expect(eventi.map(e => e.tipo)).toEqual(["creato"]);
  });
});

describe("stato e proprietari", () => {
  it("sospende e riattiva con eventi e cache aggiornata", async () => {
    const { tenant } = await crea(inputAcme(), script);
    const sospeso = await sospendi(tenant.id, "insoluto", script);
    expect(sospeso.stato).toBe("sospeso");
    expect(getTenantRepository().perId(tenant.id)?.stato).toBe("sospeso");
    await riattiva(tenant.id, "pagato", script);
    expect(getTenantRepository().perId(tenant.id)?.stato).toBe("attivo");
    const tipi = (await getTenantRepository().eventi(tenant.id)).map(e => e.tipo);
    expect(tipi.slice(-2)).toEqual(["sospeso", "riattivato"]);
  });

  it("assegna e revoca il ruolo con la guardia dell'ultimo proprietario", async () => {
    const { tenant, sedeId, utenteId } = await crea(inputAcme(), script);
    const now = new Date();
    utenti.push({ id: 97701, nome: "S", cognome: "T", email: "s@acme.test", ruoli: ["direzione"], sediIds: [sedeId], attivo: true, tenantId: tenant.id, password: "scrypt$x", createdAt: now, updatedAt: now });
    await expect(revocaProprietario(tenant.id, utenteId, script)).rejects.toThrow(/ultimo proprietario/);
    await assegnaProprietario(tenant.id, 97701, script);
    expect(utenti.find(u => u.id === 97701)!.ruoli).toEqual(["direzione", "proprietario"]);
    await revocaProprietario(tenant.id, utenteId, script);
    expect(utenti.find(u => u.id === utenteId)!.ruoli).toEqual(["direzione"]);
    await expect(assegnaProprietario(tenant.id, 999_999, script)).rejects.toThrow(/inesistente/);
  });
});

describe("assicuraTenantPredefinito", () => {
  it("semina il tenant 1 e dà il ruolo alla prima direzione attiva senza proprietari", async () => {
    const now = new Date();
    utenti.push({ id: 97702, nome: "D", cognome: "Uno", email: "d1@t1.test", ruoli: ["direzione", "amministrazione", "commerciale"], sediIds: [1], attivo: true, tenantId: 1, password: "scrypt$x", createdAt: now, updatedAt: now });
    utenti.push({ id: 97703, nome: "D", cognome: "Due", email: "d2@t1.test", ruoli: ["direzione"], sediIds: [1], attivo: true, tenantId: 1, password: "scrypt$x", createdAt: now, updatedAt: now });
    const giaProprietari = utenti.filter(u => (u.ruoli ?? []).includes("proprietario") && u.tenantId === 1).map(u => u.id);
    await assicuraTenantPredefinito();
    expect(getTenantRepository().perId(1)?.slug).toBe("ruffino-group");
    const oraProprietari = utenti.filter(u => (u.ruoli ?? []).includes("proprietario") && u.tenantId === 1).map(u => u.id);
    // Se il tenant 1 non aveva proprietari, il primo candidato per id con meno di
    // 3 ruoli lo riceve (97702 ha già tre ruoli, quindi 97703 se l'utente 1 non c'è).
    expect(oraProprietari.length).toBeGreaterThanOrEqual(1);
    expect(oraProprietari.length).toBe(Math.max(giaProprietari.length, 1));
    await assicuraTenantPredefinito();
    expect(utenti.filter(u => (u.ruoli ?? []).includes("proprietario") && u.tenantId === 1).length).toBe(oraProprietari.length);
  });
});

describe("eseguiComandiInAttesa", () => {
  it("esegue i comandi in ordine e segna gli errori senza fermarsi", async () => {
    const repo = getTenantRepository();
    await repo.assicuraTenantPredefinito();
    const a = await repo.accodaComando({ tipo: "crea", tenantId: null, payload: inputAcme(), richiestoDa: "script:tenant@test" });
    const b = await repo.accodaComando({ tipo: "sospendi", tenantId: null, payload: { slug: "acme", motivo: "prova" }, richiestoDa: "script:tenant@test" });
    const c = await repo.accodaComando({ tipo: "riattiva", tenantId: null, payload: { slug: "non-esiste", motivo: "prova" }, richiestoDa: "script:tenant@test" });
    const esito = await eseguiComandiInAttesa();
    expect(esito).toEqual({ eseguiti: 2, falliti: 1 });
    expect((await repo.comando(a.id))?.stato).toBe("eseguito");
    expect((await repo.comando(b.id))?.stato).toBe("eseguito");
    expect((await repo.comando(c.id))?.esito).toMatchObject({ errore: expect.stringMatching(/non-esiste/) });
    expect(repo.perSlug("acme")?.stato).toBe("sospeso");
  });

  it("con l'interruttore spento non esegue nulla", async () => {
    process.env.FLAG_MULTI_AZIENDA = "off";
    const repo = getTenantRepository();
    await repo.accodaComando({ tipo: "crea", tenantId: null, payload: inputAcme(), richiestoDa: "script:tenant@test" });
    expect(await eseguiComandiInAttesa()).toEqual({ eseguiti: 0, falliti: 0 });
    expect((await repo.comandiInAttesa()).length).toBe(1);
  });

  it("un payload crea non valido finisce in errore con un messaggio zod, senza bloccare i comandi successivi (Important 4)", async () => {
    const repo = getTenantRepository();
    const invalido = await repo.accodaComando({
      tipo: "crea",
      tenantId: null,
      payload: { slug: "x" },
      richiestoDa: "script:tenant@test",
    });
    const valido = await repo.accodaComando({
      tipo: "crea",
      tenantId: null,
      payload: inputAcme(),
      richiestoDa: "script:tenant@test",
    });
    const esito = await eseguiComandiInAttesa();
    expect(esito).toEqual({ eseguiti: 1, falliti: 1 });
    const comandoInvalido = await repo.comando(invalido.id);
    expect(comandoInvalido?.stato).toBe("errore");
    expect(typeof (comandoInvalido?.esito as any)?.errore).toBe("string");
    expect((comandoInvalido?.esito as any)?.errore.length).toBeGreaterThan(0);
    expect((await repo.comando(valido.id))?.stato).toBe("eseguito");
    expect(getTenantRepository().perSlug("acme")).not.toBeNull();
  });
});
