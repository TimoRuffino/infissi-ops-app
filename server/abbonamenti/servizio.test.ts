import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTenantRepository, resetTenantRepositoryForTesting } from "../tenants/repository";
import { getSediStore } from "../routers/sedi";
import { GIORNI_PROVA, eurInNano } from "./costanti";
import {
  aggiungiExtraTars, assicuraAbbonamentoPredefinito, concediOmaggio, creaProva, giorniAllaScadenza,
  impostaBudgetTars, impostaDisdetta, prorogaProva, valutaAbbonamento,
} from "./servizio";

const T0 = new Date("2026-09-08T09:00:00Z");
const giorni = (n: number) => new Date(T0.getTime() + n * 86_400_000);
const attore = { tipo: "script" as const, nome: "test" };

describe("abbonamenti: stati e transizioni", () => {
  beforeEach(async () => {
    delete process.env.FLAG_MULTI_AZIENDA;
    resetTenantRepositoryForTesting();
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "Ruffino Group" });
    await repo.inserisci({ id: 2, slug: "acme", nome: "Acme" });
    getSediStore().length = 0;
    getSediStore().push({ id: 20, tenantId: 2, nome: "HQ", attiva: true } as any);
  });
  afterEach(() => { resetTenantRepositoryForTesting(); getSediStore().length = 0; vi.useRealTimers(); });

  it("creaProva: 30 giorni, budget predefinito, idempotente; tenant 1 omaggio senza scadenza", async () => {
    const a = await creaProva(2, T0, attore);
    expect(a).toMatchObject({ tipo: "paid", stato: "trialing", periodicita: null, tolleranzaStorageGiorni: 7, tolleranzaTarsGiorni: 7 });
    expect(a.finePeriodo?.toISOString()).toBe(giorni(GIORNI_PROVA).toISOString());
    expect(a.budgetTarsNanoMese).toBe(eurInNano(25));
    expect((await creaProva(2, giorni(1), attore)).finePeriodo?.toISOString()).toBe(a.finePeriodo?.toISOString());
    const uno = await assicuraAbbonamentoPredefinito(T0);
    expect(uno).toMatchObject({ tenantId: 1, tipo: "complimentary", stato: "active", finePeriodo: null, budgetTarsNanoMese: null });
    expect((await getTenantRepository().eventi(2)).map(e => e.tipo)).toEqual(["abbonamento_creato"]);
  });

  it("avvisi a 7, 3 e 1 giorno una volta sola; poi insoluto; dopo 7 giorni sola lettura", async () => {
    const repo = getTenantRepository();
    await creaProva(2, T0, attore);
    expect(await valutaAbbonamento(2, giorni(10))).toEqual({ transizione: null, avviso: null });
    expect(await valutaAbbonamento(2, giorni(23))).toEqual({ transizione: null, avviso: 7 });
    expect(await valutaAbbonamento(2, giorni(23.5))).toEqual({ transizione: null, avviso: null });
    expect(await valutaAbbonamento(2, giorni(27))).toEqual({ transizione: null, avviso: 3 });
    expect(await valutaAbbonamento(2, giorni(29))).toEqual({ transizione: null, avviso: 1 });
    expect(await valutaAbbonamento(2, giorni(30.1))).toEqual({ transizione: "past_due", avviso: null });
    expect(repo.abbonamentoDi(2)?.insolutoDal?.toISOString()).toBe(giorni(30.1).toISOString());
    expect(repo.perId(2)?.stato).toBe("attivo");
    expect(await valutaAbbonamento(2, giorni(33))).toEqual({ transizione: null, avviso: null });
    expect(await valutaAbbonamento(2, giorni(37.2))).toEqual({ transizione: "suspended", avviso: null });
    expect(repo.perId(2)?.stato).toBe("sospeso");
    expect(repo.perId(2)?.motivoStato).toContain("insoluto");
    const tipi = (await repo.eventi(2)).map(e => e.tipo);
    expect(tipi.filter(t => t === "abbonamento_avviso")).toHaveLength(3);
    expect(tipi.filter(t => t === "abbonamento_stato")).toHaveLength(2);
    expect(tipi).toContain("sospeso");
  });

  it("omaggio riattiva un sospeso; proroga riporta in prova; disdetta", async () => {
    const repo = getTenantRepository();
    await creaProva(2, T0, attore);
    await valutaAbbonamento(2, giorni(30.1));
    await valutaAbbonamento(2, giorni(38));
    const om = await concediOmaggio(2, { motivo: "pilota", scadenza: giorni(120) }, attore, giorni(38));
    expect(om).toMatchObject({ tipo: "complimentary", stato: "active", insolutoDal: null });
    expect(om.omaggio?.motivo).toBe("pilota");
    expect(repo.perId(2)?.stato).toBe("attivo");
    expect(giorniAllaScadenza(om, giorni(38))).toBe(82);
    expect(await valutaAbbonamento(2, giorni(113.5))).toEqual({ transizione: null, avviso: 7 });
    expect(await valutaAbbonamento(2, giorni(120.5))).toEqual({ transizione: "past_due", avviso: null });
    const pr = await prorogaProva(2, 15, "fiera", attore, giorni(121));
    expect(pr).toMatchObject({ stato: "trialing", insolutoDal: null });
    expect(pr.finePeriodo?.toISOString()).toBe(giorni(136).toISOString());
    const dis = await impostaDisdetta(2, true, attore);
    expect(dis.disdettaAFinePeriodo).toBe(true);
    expect(await valutaAbbonamento(2, giorni(136.5))).toEqual({ transizione: "cancelled", avviso: null });
    expect(repo.perId(2)?.stato).toBe("sospeso");
  });

  it("budget ed extra: l'extra vale solo nel mese; mese nuovo azzera soglie ed extra", async () => {
    const repo = getTenantRepository();
    await creaProva(2, T0, attore);
    await impostaBudgetTars(2, eurInNano(40), attore);
    await aggiungiExtraTars(2, eurInNano(10), attore, T0);
    let a = repo.abbonamentoDi(2)!;
    expect(a.budgetTarsNanoMese).toBe(eurInNano(40));
    expect(a.extraTarsNano).toBe(eurInNano(10));
    expect(a.extraTarsMese).toBe("2026-09");
    await repo.salvaAbbonamento({ ...a, tarsSogliaAvvisata: 80, tarsSogliaMese: "2026-09" });
    await valutaAbbonamento(2, new Date("2026-10-01T06:00:00Z"));
    a = repo.abbonamentoDi(2)!;
    expect(a.extraTarsNano).toBe(0);
    expect(a.tarsSogliaAvvisata).toBe(0);
    expect(a.tarsSogliaMese).toBe("2026-10");
  });

  it("il tenant 1 non si tocca: omaggio, proroga, disdetta rifiutati; budget e tolleranze ammessi", async () => {
    await assicuraAbbonamentoPredefinito(T0);
    await expect(concediOmaggio(1, { motivo: "x", scadenza: null }, attore, T0)).rejects.toThrow("proprietaria della piattaforma");
    await expect(prorogaProva(1, 10, "x", attore, T0)).rejects.toThrow("proprietaria della piattaforma");
    await expect(impostaDisdetta(1, true, attore)).rejects.toThrow("proprietaria della piattaforma");
    expect((await impostaBudgetTars(1, eurInNano(100), attore)).budgetTarsNanoMese).toBe(eurInNano(100));
    expect(await valutaAbbonamento(1, giorni(400))).toEqual({ transizione: null, avviso: null });
  });
});
