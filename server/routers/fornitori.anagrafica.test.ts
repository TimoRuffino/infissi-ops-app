// L'anagrafica dei fornitori dal router: campi nuovi, candidati dedotti
// dall'archivio, e l'importazione una tantum dei venticinque.
import { describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";
import { fornitoriDiSede } from "../fornitori/anagrafica";
import { getUtentiStore } from "./utenti";

const SEDE = 96_601;
const DIREZIONE_ID = 96_611;

{
  const utenti = getUtentiStore() as any[];
  if (!utenti.some(u => u.id === DIREZIONE_ID)) {
    utenti.push({
      id: DIREZIONE_ID,
      nome: "Dir",
      cognome: "Anagrafica",
      email: "anagrafica-dir@example.test",
      attivo: true,
      ruoli: ["direzione"],
      ruolo: "direzione",
      sediIds: [SEDE],
    });
  }
}

function contesto(tenantId = 1): TrpcContext {
  return {
    user: { id: DIREZIONE_ID, role: "admin", ruolo: "direzione", ruoli: ["direzione"], name: "Dir" } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId: SEDE,
    sediIds: [SEDE],
    tenantId,
    tenant: null,
  };
}
const direzione = (tenantId = 1) => appRouter.createCaller(contesto(tenantId));

describe("anagrafica fornitori dal router", () => {
  it("crea un fornitore con chiavi, canale e portali, senza partita IVA", async () => {
    const f = await direzione().fornitori.create({
      ragioneSociale: "Vetreria Bianchi",
      categoria: "vetro",
      chiavi: ["vetreriabianchi", "bianchi"],
      canale: "mail",
      portaleDomini: [],
    });
    expect(f.chiavi).toEqual(["vetreriabianchi", "bianchi"]);
    expect(f.canale).toBe("mail");
    expect(f.partitaIva).toBeUndefined();
  });

  it("un fornitore creato senza i campi nuovi li riceve col default", async () => {
    const f = await direzione().fornitori.create({
      ragioneSociale: "Ferramenta Rossi",
      categoria: "ferramenta",
    });
    expect(f.chiavi).toEqual([]);
    expect(f.canale).toBe("mail");
    expect(f.portaleDomini).toEqual([]);
  });

  it("importa i venticinque una volta sola, e solo per il tenant 1", async () => {
    const primo = await direzione().fornitori.importaSeed();
    expect(primo.creati).toBe(25);
    const secondo = await direzione().fornitori.importaSeed();
    expect(secondo.creati).toBe(0);
    expect(fornitoriDiSede(SEDE).filter(f => f.ragioneSociale === "Alias")).toHaveLength(1);
    // Wnd nasce col portale Antenore, non come due fornitori.
    const wnd = fornitoriDiSede(SEDE).filter(f => f.ragioneSociale === "Wnd");
    expect(wnd).toHaveLength(1);
    expect(wnd[0].portaleDomini).toContain("antenore");
    expect(wnd[0].canale).toBe("portale");
    await expect(direzione(2).fornitori.importaSeed()).rejects.toThrow();
  });
});
