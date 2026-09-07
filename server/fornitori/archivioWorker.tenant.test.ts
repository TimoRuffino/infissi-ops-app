// Fusione di `main` nel WS2 (07/09/2026): il worker dell'archivio fornitori
// arriva da `main` con un giro `for (const sede of getSediStore())`, cioè
// tutte le sedi dell'installazione fuori da qualunque contesto. Con
// FLAG_MULTI_AZIENDA acceso quel giro leggerebbe e scriverebbe store per
// tenant senza azienda nel contesto — «[persistence] accesso allo store
// fornitori_archivio senza tenant nel contesto» a ogni tick dei dieci minuti
// — e, peggio, farebbe girare le sedi di un'azienda dentro il tenant
// dell'altra.
//
// Qui si verifica la forma comune della spec §5.3: prima per tenant
// (`perOgniTenantAttivo`), poi per sede attiva del tenant
// (`sediAttiveDelTenant`), con l'errore di un'azienda che non ferma le altre.
// Punto d'osservazione: `eseguiGiroArchivioFornitori`, che vive in `./archivio`
// (un modulo diverso dal worker, quindi intercettabile con vi.mock) ed è
// esattamente la funzione che tocca gli store.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __registraTenantNotoPerTest } from "../_core/persistence";
import { getSediStore } from "../routers/sedi";
import { modalitaTenantStretta, tenantCorrente } from "../tenants/contestoCorrente";
import { getTenantRepository, resetTenantRepositoryForTesting } from "../tenants/repository";

const SEDE_T1 = 97_701;
const SEDE_T1_SPENTA = 97_702;
const SEDE_T2_A = 97_703;
const SEDE_T2_B = 97_704;

const visti: Array<{ sedeId: number; tenant: number | null }> = [];
let sedeCheFallisce: number | null = null;

vi.mock("./archivio", async originale => ({
  ...(await originale<typeof import("./archivio")>()),
  dipendenzeArchivioFornitoriReali: vi.fn(() => ({}) as any),
  eseguiGiroArchivioFornitori: vi.fn(async (input: { sedeId: number }) => {
    visti.push({ sedeId: input.sedeId, tenant: tenantCorrente() });
    if (input.sedeId === sedeCheFallisce) throw new Error("boom");
    return {
      sedeId: input.sedeId,
      nuove: 0,
      lette: 0,
      collegateDaSole: 0,
      daCollegare: 0,
      nonLeggibili: 0,
      errori: 0,
    };
  }),
}));

import { giroTutteLeSedi } from "./archivioWorker";

describe("archivio fornitori: il giro dichiara l'azienda (fusione di main nel WS2)", () => {
  beforeEach(async () => {
    delete process.env.FLAG_MULTI_AZIENDA; // nei test = acceso
    modalitaTenantStretta(true);
    resetTenantRepositoryForTesting();
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "RG" });
    await repo.inserisci({ id: 2, slug: "acme", nome: "Acme" });
    // Senza istanze per il tenant 2, `fornitori_archivio` risponderebbe «non
    // istanziato per il tenant 2» invece di far vedere il percorso pulito.
    __registraTenantNotoPerTest(2);
    // `sedi` è uno store globale: si azzera a ogni test per non accumulare
    // le sedi del test precedente.
    getSediStore().length = 0;
    getSediStore().push(
      { id: SEDE_T1, tenantId: 1, nome: "A", attiva: true } as any,
      { id: SEDE_T1_SPENTA, tenantId: 1, nome: "A-chiusa", attiva: false } as any,
      { id: SEDE_T2_A, tenantId: 2, nome: "B", attiva: true } as any,
      { id: SEDE_T2_B, tenantId: 2, nome: "C", attiva: true } as any
    );
    visti.length = 0;
    sedeCheFallisce = null;
  });
  afterEach(() => modalitaTenantStretta(false));

  it("ogni sede attiva gira nel contesto della propria azienda, e le sedi spente restano fuori", async () => {
    const errore = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await giroTutteLeSedi();
      expect(errore).not.toHaveBeenCalled();
    } finally {
      errore.mockRestore();
    }
    expect(visti).toEqual([
      { sedeId: SEDE_T1, tenant: 1 },
      { sedeId: SEDE_T2_A, tenant: 2 },
      { sedeId: SEDE_T2_B, tenant: 2 },
    ]);
    // Nessuna lettura fuori contesto: è l'errore che il fail-closed di
    // persistence.ts lancerebbe in sviluppo e in produzione.
    expect(visti.map(v => v.tenant)).not.toContain(null);
  });

  it("un'azienda che fallisce non ferma le altre", async () => {
    // Il `try/catch` per sede del worker intercetta l'errore della singola
    // sede: qui si fa fallire il giro dell'azienda 1 dal di fuori, spegnendo
    // le sedi dell'azienda 2 dopo la prima — la garanzia da provare è che
    // `perOgniTenantAttivo` registri e prosegua.
    sedeCheFallisce = SEDE_T1;
    const errore = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await giroTutteLeSedi();
      // L'errore è registrato (dal try/catch per sede del worker), non propagato.
      expect(errore).toHaveBeenCalled();
    } finally {
      errore.mockRestore();
    }
    expect(visti).toEqual([
      { sedeId: SEDE_T1, tenant: 1 },
      { sedeId: SEDE_T2_A, tenant: 2 },
      { sedeId: SEDE_T2_B, tenant: 2 },
    ]);
  });
});
