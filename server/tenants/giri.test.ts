import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { modalitaTenantStretta, tenantCorrente } from "./contestoCorrente";
import {
  __azzeraStatiGiriPerTest,
  conTenantDellaSede,
  perOgniTenantAttivo,
  statoGiro,
  tenantsAttivi,
  trovaNeiTenant,
} from "./giri";
import { getTenantRepository, resetTenantRepositoryForTesting } from "./repository";
import { getSediStore } from "../routers/sedi";

describe("giri per tenant e per sede", () => {
  beforeEach(() => {
    delete process.env.FLAG_MULTI_AZIENDA; // nei test = acceso
    resetTenantRepositoryForTesting();
    modalitaTenantStretta(false);
    getSediStore().length = 0;
    getSediStore().push(
      { id: 10, tenantId: 1, nome: "A", attiva: true } as any,
      { id: 20, tenantId: 2, nome: "B", attiva: true } as any
    );
  });
  afterEach(() => {
    delete process.env.FLAG_MULTI_AZIENDA;
    modalitaTenantStretta(false);
    getSediStore().length = 0;
  });

  it("conTenantDellaSede usa il tenant della sede", () => {
    expect(conTenantDellaSede(10, () => tenantCorrente())).toBe(1);
    expect(conTenantDellaSede(20, () => tenantCorrente())).toBe(2);
  });

  // R20: il ripiego sul tenant 1 per una sede sconosciuta era una porta
  // aperta — con l'interruttore acceso ora lancia, spento resta com'era.
  it("conTenantDellaSede: sede sconosciuta → lancia a interruttore acceso, tenant 1 a spento", () => {
    expect(() => conTenantDellaSede(999_999, () => tenantCorrente())).toThrow(
      "[tenant] sede sconosciuta: 999999"
    );
    process.env.FLAG_MULTI_AZIENDA = "off";
    expect(conTenantDellaSede(999_999, () => tenantCorrente())).toBe(1);
  });

  it("tenantsAttivi: 1 se il control plane è vuoto o spento, altrimenti i tenant attivi", async () => {
    expect(tenantsAttivi()).toEqual([1]);
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "Ruffino Group" });
    await repo.inserisci({ id: 2, slug: "acme", nome: "Acme" });
    await repo.inserisci({ id: 3, slug: "sospesa", nome: "Sospesa", stato: "sospeso" });
    expect(tenantsAttivi()).toEqual([1, 2]);
    process.env.FLAG_MULTI_AZIENDA = "off";
    expect(tenantsAttivi()).toEqual([1]);
  });

  it("perOgniTenantAttivo esegue ogni tenant nel suo contesto e un errore non ferma gli altri", async () => {
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "Ruffino Group" });
    await repo.inserisci({ id: 2, slug: "acme", nome: "Acme" });
    const visti: Array<number | null> = [];
    await perOgniTenantAttivo("prova", async id => {
      if (id === 1) throw new Error("boom");
      visti.push(tenantCorrente());
    });
    expect(visti).toEqual([2]);
  });

  // Il titolo nomina quattro gradini e il tetto: il test li percorre tutti
  // (fix wave finale). Prima si fermava a 30 minuti e le due attese più
  // lunghe — con il clamp, che è la parte che evita l'attesa infinita —
  // restavano solo scritte.
  it("tre errori consecutivi sospendono l'azienda per 15, poi 30, 60, 120 minuti; il tetto resta 120; il giro riuscito riarma; le altre aziende girano", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-08T10:00:00Z"), toFake: ["Date"] });
    __azzeraStatiGiriPerTest();
    // Ogni giro fallito parla (un errore per il giro, uno per la
    // sospensione): si zittisce e si tiene da parte l'ultima riga, che è
    // quella che dichiara i minuti.
    const righe: string[] = [];
    const errore = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      righe.push(a.map(String).join(" "));
    });
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "Ruffino Group" });
    await repo.inserisci({ id: 2, slug: "acme", nome: "Acme" });
    const visti: number[] = [];
    const giro = (fallisce: boolean) =>
      perOgniTenantAttivo("prova", async t => { visti.push(t); if (t === 2 && fallisce) throw new Error("boom"); });
    /** Tre giri falliti = una sospensione; restituisce i minuti dichiarati. */
    const treGiriFalliti = async (): Promise<number> => {
      await giro(true); await giro(true); await giro(true);
      return (statoGiro("prova", 2).sospesoFinoA - Date.now()) / 60_000;
    };
    try {
      expect(await treGiriFalliti()).toBe(15);
      expect(statoGiro("prova", 2)).toMatchObject({ erroriConsecutivi: 0, sospensioni: 1 });
      visti.length = 0;
      await giro(true);
      expect(visti).toEqual([1]); // il tenant 2 è saltato
      vi.setSystemTime(Date.now() + 16 * 60_000);
      expect(await treGiriFalliti()).toBe(30);
      vi.setSystemTime(Date.now() + 31 * 60_000);
      expect(await treGiriFalliti()).toBe(60);
      vi.setSystemTime(Date.now() + 61 * 60_000);
      expect(await treGiriFalliti()).toBe(120);
      vi.setSystemTime(Date.now() + 121 * 60_000);
      // Quinta sospensione: l'attesa non cresce oltre il tetto.
      expect(await treGiriFalliti()).toBe(120);
      expect(statoGiro("prova", 2)).toMatchObject({ sospensioni: 5 });
      expect(righe.at(-1)).toBe("[prova] tenant 2 sospeso per 120 min: boom");
      vi.setSystemTime(Date.now() + 121 * 60_000);
      await giro(false);
      expect(statoGiro("prova", 2)).toEqual({ erroriConsecutivi: 0, sospesoFinoA: 0, sospensioni: 0 });
      const eventi = await repo.eventi(2);
      expect(eventi.map(e => e.tipo)).toEqual([
        "worker_sospeso", "worker_sospeso", "worker_sospeso", "worker_sospeso", "worker_sospeso", "worker_riarmato",
      ]);
      expect(eventi.slice(0, 5).map(e => e.dettagli?.minuti)).toEqual([15, 30, 60, 120, 120]);
      expect(eventi[0].dettagli).toEqual({ etichetta: "prova", minuti: 15, errore: "boom" });
      expect(await repo.eventi(1)).toEqual([]);
    } finally {
      errore.mockRestore();
      vi.useRealTimers();
    }
  });

  it("trovaNeiTenant restituisce il primo esito non nullo con il suo tenant", async () => {
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "Ruffino Group" });
    await repo.inserisci({ id: 2, slug: "acme", nome: "Acme" });
    const visitati: number[] = [];
    const trovato = await trovaNeiTenant("prova", tenantId => {
      visitati.push(tenantId);
      return tenantId === 2 ? { sedeId: 20, tenant: tenantCorrente() } : null;
    });
    expect(visitati).toEqual([1, 2]);
    expect(trovato).toEqual({ tenantId: 2, valore: { sedeId: 20, tenant: 2 } });
  });

  it("trovaNeiTenant: null se nessuno trova, e l'errore di un tenant non ferma gli altri", async () => {
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "Ruffino Group" });
    await repo.inserisci({ id: 2, slug: "acme", nome: "Acme" });
    const errore = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const trovato = await trovaNeiTenant("prova", async tenantId => {
        if (tenantId === 1) throw new Error("boom");
        return null;
      });
      expect(trovato).toBeNull();
      expect(errore).toHaveBeenCalledTimes(1);
    } finally {
      errore.mockRestore();
    }
  });
});

