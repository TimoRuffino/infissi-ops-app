// Task 10 (WS2 «porta aperta»): l'ingestione della posta gira per tenant,
// ognuno nel suo contesto. `caselle` è il Proxy dello store per tenant: fuori
// da un contesto, con FLAG_MULTI_AZIENDA acceso, il poller esplode; dentro il
// contesto del tenant 1 vedrebbe soltanto le caselle di Ruffino Group e la
// posta delle altre aziende non entrerebbe mai.
//
// Niente rete: `dip.sincronizza` e `dip.avvia` (default `sincronizzaTutte` e
// `avviaWatcher`) sono iniettabili solo per i test — la produzione non li
// passa mai, come `dip.giro` di `startSondaFattureWorker`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __registraTenantNotoPerTest, storeDi } from "../_core/persistence";
import { modalitaTenantStretta, tenantCorrente } from "../tenants/contestoCorrente";
import {
  getTenantRepository,
  resetTenantRepositoryForTesting,
} from "../tenants/repository";
import { getSediStore } from "../routers/sedi";
import type { Casella } from "./caselle";
import { giroPollerMail, riavviaWatchers } from "./imap";

const casella = (id: number, sedeId: number, attiva = true): Casella => ({
  id,
  sedeId,
  nome: `Casella ${id}`,
  indirizzo: `casella${id}@example.test`,
  host: "imap.example.test",
  porta: 993,
  tls: true,
  passwordCifrata: "v1.finta",
  cartella: "INBOX",
  attiva,
  ultimoUid: null,
  uidValidity: null,
  ultimaSync: null,
  ultimoErrore: null,
  messaggiImportati: 0,
  createdAt: new Date("2026-09-01T00:00:00Z"),
  updatedAt: new Date("2026-09-01T00:00:00Z"),
});

describe("posta IMAP per tenant (Task 10)", () => {
  beforeEach(async () => {
    delete process.env.FLAG_MULTI_AZIENDA; // nei test = acceso
    modalitaTenantStretta(true);
    resetTenantRepositoryForTesting();
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "RG" });
    await repo.inserisci({ id: 2, slug: "acme", nome: "Acme" });
    __registraTenantNotoPerTest(2);
    getSediStore().length = 0;
    getSediStore().push(
      { id: 10, tenantId: 1, nome: "A", attiva: true } as any,
      { id: 20, tenantId: 2, nome: "B", attiva: true } as any
    );
    storeDi<Casella>(1, "caselle_email").length = 0;
    storeDi<Casella>(2, "caselle_email").length = 0;
    storeDi<Casella>(1, "caselle_email").push(casella(1, 10));
    storeDi<Casella>(2, "caselle_email").push(casella(2, 20), casella(3, 20, false));
  });
  afterEach(() => modalitaTenantStretta(false));

  it("il poller fa un giro per tenant, ognuno con le sue caselle nel suo contesto", async () => {
    const visti: Array<{ tenant: number | null; caselle: number[] }> = [];
    const errore = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await giroPollerMail({
        sincronizza: async () => {
          const { caselle } = await import("./caselle");
          visti.push({
            tenant: tenantCorrente(),
            caselle: caselle.filter(c => c.attiva).map(c => c.id),
          });
          return [];
        },
      });
      expect(errore).not.toHaveBeenCalled();
    } finally {
      errore.mockRestore();
    }
    expect(visti).toEqual([
      { tenant: 1, caselle: [1] },
      { tenant: 2, caselle: [2] },
    ]);
  });

  it("un tenant senza caselle attive non chiama la sincronizzazione, e un errore non ferma gli altri", async () => {
    storeDi<Casella>(1, "caselle_email").length = 0;
    const visti: Array<number | null> = [];
    const errore = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await giroPollerMail({
        sincronizza: async () => {
          visti.push(tenantCorrente());
          throw new Error("IMAP non risponde");
        },
      });
      expect(errore).toHaveBeenCalledTimes(1);
    } finally {
      errore.mockRestore();
    }
    expect(visti).toEqual([2]);
  });

  it("i watcher IDLE nascono per ogni tenant, ognuno nel contesto della sua casella", async () => {
    const avviati: Array<{ id: number; sedeId: number; tenant: number | null }> = [];
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await riavviaWatchers({
        avvia: c => {
          avviati.push({ id: c.id, sedeId: c.sedeId, tenant: tenantCorrente() });
          return { stop: () => {} };
        },
      });
    } finally {
      log.mockRestore();
    }
    expect(avviati).toEqual([
      { id: 1, sedeId: 10, tenant: 1 },
      { id: 2, sedeId: 20, tenant: 2 },
    ]);
  });

  it("un secondo giro ferma i watcher precedenti di tutti i tenant", async () => {
    const fermati: number[] = [];
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await riavviaWatchers({
        avvia: c => ({ stop: () => fermati.push(c.id) }),
      });
      await riavviaWatchers({ avvia: () => ({ stop: () => {} }) });
    } finally {
      log.mockRestore();
    }
    expect(fermati.sort()).toEqual([1, 2]);
  });
});
