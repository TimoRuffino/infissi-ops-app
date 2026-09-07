// server/tars/contesto.tenant.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { contestoDiProva } from "../_core/contestoDiProva";
import { getSediStore } from "../routers/sedi";
import { getTenantRepository, resetTenantRepositoryForTesting } from "../tenants/repository";
import type { TenantRecord } from "../tenants/tipi";
import { catalogoAzioniPerContesto } from "./azioni/policy";
import { costruisciContesto } from "./contesto";
import { callerPer, contestoServer } from "./strumenti/comune";

const sedi = getSediStore();
let nS = 0;
let t1: TenantRecord;

beforeEach(async () => {
  resetTenantRepositoryForTesting();
  // Tenant 1 deterministico: senza, getTenantRepository().perId(1) letto da
  // contestoServer() darebbe null in un repository di prova vuoto, e il
  // confronto con `.tenant` dipenderebbe dall'ordine dei test.
  t1 = await getTenantRepository().assicuraTenantPredefinito();
  nS = sedi.length;
});

afterEach(() => {
  sedi.splice(nS);
});

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
    // Il record del tenant viene dal repository (assicuraTenantPredefinito
    // nel beforeEach), non da un fallback locale: stesso valore di perId(1).
    expect(contestoServer(c).tenant).toEqual(t1);
  });

  it("sola lettura via Tars: mutation rifiutata su un tenant sospeso, query consentita", async () => {
    const now = new Date();
    const sedeReale = {
      id: 97833,
      tenantId: 1,
      nome: "Sede Tars sola lettura",
      citta: null,
      indirizzo: null,
      attiva: true,
      createdAt: now,
      updatedAt: now,
    };
    sedi.push(sedeReale);
    await getTenantRepository().aggiornaStato(1, "sospeso", "prova");

    const contesto = await costruisciContesto(
      contestoDiProva({ utenteId: 97834, sedeId: sedeReale.id, tenantId: 1 })
    );
    const caller = await callerPer(contesto);

    await expect(caller.clienti.create({ nome: "Mario", cognome: "Tars" })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "Azienda sospesa: il gestionale è in sola lettura.",
    });
    await expect(caller.clienti.list({})).resolves.toBeDefined();
  });
});
