// server/abbonamenti/worker.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTenantRepository, resetTenantRepositoryForTesting } from "../tenants/repository";
import { riattiva } from "../tenants/servizio";
import { creaProva } from "./servizio";
import {
  __timerAttivoPerTest,
  avviaWorkerAbbonamenti,
  fermaWorkerAbbonamenti,
  giroAbbonamenti,
} from "./worker";

const T0 = new Date("2026-09-08T09:00:00Z");
const giorni = (n: number) => new Date(T0.getTime() + n * 86_400_000);
const attore = { tipo: "script" as const, nome: "test" };

describe("giroAbbonamenti", () => {
  beforeEach(async () => {
    delete process.env.FLAG_MULTI_AZIENDA; // nei test = acceso
    resetTenantRepositoryForTesting();
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "Ruffino Group" });
    await repo.inserisci({ id: 2, slug: "acme", nome: "Acme" });
    await repo.inserisci({ id: 3, slug: "sospesa", nome: "Sospesa Srl", stato: "sospeso" });
  });

  afterEach(() => {
    resetTenantRepositoryForTesting();
    delete process.env.FLAG_MULTI_AZIENDA;
  });

  it("valuta solo i tenant attivi: la prova scaduta del tenant 2 diventa past_due; il tenant 1 resta intoccato; il sospeso non viene valutato", async () => {
    const repo = getTenantRepository();
    // Prova di 30 giorni iniziata 40 giorni fa: scaduta da 10 giorni a T0.
    await creaProva(2, giorni(-40), attore);
    // Stessa prova scaduta anche per il tenant 3, MA è sospeso: se
    // `tenantsAttivi()` lo escludesse solo a metà, questa riga smaschererebbe
    // la falla (la 3 diventerebbe past_due esattamente come la 2).
    await creaProva(3, giorni(-40), attore);

    await giroAbbonamenti(T0);

    expect(repo.abbonamentoDi(2)?.stato).toBe("past_due");
    expect(repo.abbonamentoDi(2)?.insolutoDal?.toISOString()).toBe(T0.toISOString());

    // Il tenant 1 è la proprietaria della piattaforma: `valutaAbbonamento`
    // esce subito per id, non ha nemmeno bisogno di una riga abbonamento.
    expect(repo.abbonamentoDi(1)).toBeNull();
    expect(repo.perId(1)?.stato).toBe("attivo");

    // Il sospeso non è fra i `tenantsAttivi()`: la sua prova, scaduta quanto
    // quella del tenant 2, resta `trialing` perché il worker non l'ha mai
    // guardata.
    expect(repo.abbonamentoDi(3)?.stato).toBe("trialing");
    expect(repo.perId(3)?.stato).toBe("sospeso");
  });

  it("con l'interruttore spento valuta solo il tenant 1 (tenantsAttivi ripiega su di lui) e nessuno cambia stato", async () => {
    process.env.FLAG_MULTI_AZIENDA = "off";
    const repo = getTenantRepository();
    await creaProva(2, giorni(-40), attore);

    await giroAbbonamenti(T0);

    // Il tenant 2 non è mai stato guardato: la sua prova, scaduta, resta trialing.
    expect(repo.abbonamentoDi(2)?.stato).toBe("trialing");
  });

  it("un tenant attivo senza abbonamento (diverso dal tenant 1) viene segnalato e saltato, senza lanciare (Task 3 fix round 1, Ruling R8)", async () => {
    const repo = getTenantRepository();
    // Il tenant 2 non ha mai una prova in questo test (nessuna `creaProva`):
    // è l'anomalia che il worker deve segnalare, non riparare da solo.
    const spia = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(giroAbbonamenti(T0)).resolves.toBeUndefined();

    // Le asserzioni PRIMA di `mockRestore()`: restituire l'implementazione
    // originale azzera anche `mock.calls` (come `mockReset`), quindi
    // controllarle dopo troverebbe sempre zero chiamate.
    expect(spia).toHaveBeenCalledWith("[abbonamenti] tenant 2 senza abbonamento: rilancia pnpm tenant crea");
    // Il tenant 1 non ha un abbonamento nemmeno lui in questo test, ma per
    // lui non è un'anomalia (spec §4: `valutaAbbonamento` esce subito per
    // id) — nessun avviso a suo nome.
    expect(spia.mock.calls.some(args => String(args[0]).includes("tenant 1 "))).toBe(false);
    spia.mockRestore();
    expect(repo.abbonamentoDi(2)).toBeNull();
  });

  it("R15: un'azienda riaperta a mano col contratto sospeso torna in sola lettura al giro successivo", async () => {
    const repo = getTenantRepository();
    await creaProva(2, giorni(-40), attore); // prova finita a giorni(-10)
    await giroAbbonamenti(T0); // insoluto
    await giroAbbonamenti(giorni(8)); // tolleranza scaduta: sola lettura
    expect(repo.abbonamentoDi(2)?.stato).toBe("suspended");
    expect(repo.perId(2)?.stato).toBe("sospeso");

    // `pnpm tenant stato --riattiva` riapre l'azienda ma non paga il
    // contratto: fino a qui il worker non la guardava nemmeno più (non era
    // fra i `tenantsAttivi()`), da qui sì.
    await riattiva(2, "riaperta a mano dall'operatore", attore);
    expect(repo.perId(2)?.stato).toBe("attivo");

    await giroAbbonamenti(giorni(9));

    expect(repo.perId(2)?.stato).toBe("sospeso");
    expect(repo.perId(2)?.motivoStato).toMatch(/^abbonamento: /);
    expect(repo.abbonamentoDi(2)?.stato).toBe("suspended");
  });
});

describe("avviaWorkerAbbonamenti / fermaWorkerAbbonamenti", () => {
  beforeEach(() => {
    resetTenantRepositoryForTesting();
  });

  afterEach(() => {
    fermaWorkerAbbonamenti();
    delete process.env.FLAG_MULTI_AZIENDA;
    vi.useRealTimers();
  });

  it("a interruttore spento non crea il timer", () => {
    process.env.FLAG_MULTI_AZIENDA = "off";
    avviaWorkerAbbonamenti();
    expect(__timerAttivoPerTest()).toBe(false);
  });

  it("a interruttore acceso crea il timer subito; fermaWorkerAbbonamenti lo azzera; una seconda avvia non ne apre un altro", () => {
    vi.useFakeTimers({ now: T0, toFake: ["Date", "setInterval", "clearInterval"] });
    process.env.FLAG_MULTI_AZIENDA = "on";

    const setIntervalSpy = vi.spyOn(global, "setInterval");
    avviaWorkerAbbonamenti();
    expect(__timerAttivoPerTest()).toBe(true);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 6 * 3_600_000);

    // Idempotente: senza un `ferma` di mezzo non si apre un secondo intervallo
    // (come `startSondaFattureWorker`, stesso pattern).
    avviaWorkerAbbonamenti();
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    fermaWorkerAbbonamenti();
    expect(__timerAttivoPerTest()).toBe(false);
  });
});
