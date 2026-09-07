// Task 9 (WS2 «porta aperta»): il giro dei solleciti preventivi gira per
// tenant, ognuno nel suo contesto — altrimenti ogni sede di un tenant
// diverso dal predefinito verrebbe letta fuori dal contesto giusto (con
// FLAG_MULTI_AZIENDA acceso, il default nei test). Il modulo da mockare è
// quello che il worker chiama per sede: `giroSollecitiPreventivi` vive in
// `./preventivi`, un file diverso da `./worker` — si può sostituire senza
// toccare `giroFollowup`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { modalitaTenantStretta, tenantCorrente } from "../../tenants/contestoCorrente";
import { getTenantRepository, resetTenantRepositoryForTesting } from "../../tenants/repository";
import { getSediStore } from "../../routers/sedi";

const visti: Array<{ sedeId: number; tenant: number | null }> = [];
vi.mock("./preventivi", () => ({
  giroSollecitiPreventivi: vi.fn(async ({ sedeId }: { sedeId: number }) => {
    visti.push({ sedeId, tenant: tenantCorrente() });
    if (sedeId === 20) throw new Error("boom");
    return { creati: 0, saltati: 0, errori: 0 };
  }),
}));
import { giroFollowup } from "./worker";

describe("follow-up per tenant (Task 9)", () => {
  beforeEach(async () => {
    delete process.env.FLAG_MULTI_AZIENDA; // nei test = acceso
    modalitaTenantStretta(true);
    resetTenantRepositoryForTesting();
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "RG" });
    await repo.inserisci({ id: 2, slug: "acme", nome: "Acme" });
    // Store globale (ambito «globale»): azzerato a ogni test di questo file
    // per non accumulare le sedi del test precedente.
    getSediStore().length = 0;
    getSediStore().push(
      { id: 10, tenantId: 1, nome: "A", attiva: true } as any,
      { id: 20, tenantId: 2, nome: "B", attiva: true } as any,
      { id: 21, tenantId: 2, nome: "C", attiva: true } as any
    );
    visti.length = 0;
  });
  afterEach(() => modalitaTenantStretta(false));

  it("ogni sede gira nel contesto del suo tenant e un errore non ferma le altre", async () => {
    await giroFollowup(new Date("2026-09-07T10:00:00+02:00"));
    expect(visti).toEqual([
      { sedeId: 10, tenant: 1 },
      { sedeId: 20, tenant: 2 },
      { sedeId: 21, tenant: 2 },
    ]);
  });

  it("una sede non attiva viene comunque sollecitata (invariato: solo le sedi attive del giro smistamento sono escluse altrove)", async () => {
    getSediStore().push({ id: 22, tenantId: 2, nome: "D", attiva: false } as any);
    await giroFollowup(new Date("2026-09-07T10:00:00+02:00"));
    expect(visti.map(v => v.sedeId)).toContain(22);
  });
});
