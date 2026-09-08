// server/abbonamenti/provider.test.ts
// Adattatore del provider di pagamento (spec WS4 §5): con "nessuno" ogni
// metodo di checkout risponde null, e `applicaEventoProvider` (servizio.ts)
// applica gli eventi che un provider vero manderebbe via webhook, idempotente
// per `evento.id`. Stesso allestimento di servizio.test.ts: repository in
// memoria, mai `__resetPersistenzaPerTest()` (non c'è persistenza reale qui).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTenantRepository, resetTenantRepositoryForTesting } from "../tenants/repository";
import { getSediStore } from "../routers/sedi";
import { applicaEventoProvider, concediOmaggio, creaProva, valutaAbbonamento } from "./servizio";
import { providerCorrente } from "./provider";

const T0 = new Date("2026-09-08T09:00:00Z");
const giorni = (n: number) => new Date(T0.getTime() + n * 86_400_000);
const attore = { tipo: "script" as const, nome: "test" };

describe("abbonamenti: provider di pagamento", () => {
  beforeEach(async () => {
    delete process.env.FLAG_MULTI_AZIENDA;
    resetTenantRepositoryForTesting();
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "Ruffino Group" });
    await repo.inserisci({ id: 2, slug: "acme", nome: "Acme" });
    getSediStore().length = 0;
    getSediStore().push({ id: 20, tenantId: 2, nome: "HQ", attiva: true } as any);
  });
  afterEach(() => {
    resetTenantRepositoryForTesting();
    getSediStore().length = 0;
    vi.useRealTimers();
  });

  it('providerCorrente è "nessuno": checkout, portale ed evento rispondono sempre null', async () => {
    const p = providerCorrente();
    expect(p.nome).toBe("nessuno");
    expect(
      await p.avviaCheckout({ tenantId: 2, periodicita: "monthly", ritornoUrl: "https://example.test/ritorno" })
    ).toBeNull();
    expect(await p.urlPortale(2)).toBeNull();
    expect(await p.verificaEvento({}, Buffer.from(""))).toBeNull();
  });

  it("pagamento_riuscito riattiva un abbonamento sospeso e applica il periodo; l'evento ripetuto è duplicato senza nuovi eventi", async () => {
    const repo = getTenantRepository();
    await creaProva(2, T0, attore);
    await valutaAbbonamento(2, giorni(30.1)); // prova scaduta -> past_due
    await valutaAbbonamento(2, giorni(37.2)); // insoluto oltre tolleranza -> suspended
    expect(repo.abbonamentoDi(2)?.stato).toBe("suspended");
    expect(repo.perId(2)?.stato).toBe("sospeso");

    const periodo = { inizio: giorni(37.2), fine: giorni(67.2) };
    const esito = await applicaEventoProvider(
      { id: "ev1", tipo: "pagamento_riuscito", tenantId: 2, periodo, periodicita: "monthly" },
      giorni(37.2)
    );
    expect(esito).toBe("applicato");

    const a = repo.abbonamentoDi(2)!;
    expect(a).toMatchObject({ stato: "active", tipo: "paid", periodicita: "monthly" });
    expect(a.finePeriodo?.toISOString()).toBe(periodo.fine.toISOString());
    expect(a.prossimoRinnovo?.toISOString()).toBe(periodo.fine.toISOString());
    expect(repo.perId(2)?.stato).toBe("attivo");

    const eventiPrima = await repo.eventi(2);
    const ripetuto = await applicaEventoProvider(
      { id: "ev1", tipo: "pagamento_riuscito", tenantId: 2, periodo, periodicita: "monthly" },
      giorni(40)
    );
    expect(ripetuto).toBe("duplicato");
    const eventiDopo = await repo.eventi(2);
    expect(eventiDopo).toHaveLength(eventiPrima.length);
  });

  it("pagamento_fallito su un abbonamento active porta a past_due con insolutoDal", async () => {
    const repo = getTenantRepository();
    await creaProva(2, T0, attore);
    await concediOmaggio(2, { motivo: "pilota", scadenza: null }, attore, T0);
    expect(repo.abbonamentoDi(2)?.stato).toBe("active");

    const esito = await applicaEventoProvider(
      { id: "ev2", tipo: "pagamento_fallito", tenantId: 2, periodo: null },
      giorni(5)
    );
    expect(esito).toBe("applicato");
    const a = repo.abbonamentoDi(2)!;
    expect(a.stato).toBe("past_due");
    expect(a.insolutoDal?.toISOString()).toBe(giorni(5).toISOString());
  });

  it("disdetta imposta disdettaAFinePeriodo", async () => {
    const repo = getTenantRepository();
    await creaProva(2, T0, attore);
    expect(repo.abbonamentoDi(2)?.disdettaAFinePeriodo).toBe(false);

    const esito = await applicaEventoProvider(
      { id: "ev3", tipo: "disdetta", tenantId: 2, periodo: null },
      giorni(3)
    );
    expect(esito).toBe("applicato");
    expect(repo.abbonamentoDi(2)?.disdettaAFinePeriodo).toBe(true);
  });

  it("un evento del provider per il tenant 1 è rifiutato: è la proprietaria della piattaforma", async () => {
    await expect(
      applicaEventoProvider({ id: "ev4", tipo: "pagamento_riuscito", tenantId: 1, periodo: null }, T0)
    ).rejects.toThrow("proprietaria della piattaforma");
  });
});
