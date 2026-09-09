// I8 della revisione (spec §9): un'integrazione che fallisce non annulla le
// altre. `Promise.all` faceva sparire l'intero elenco per un adattatore che
// lanciava — la pagina Impostazioni restava vuota, e il cliente non poteva
// nemmeno vedere quali collegamenti fossero a posto.
import { describe, expect, it, vi, afterEach } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import { messaggioBreve } from "./errori";
import { adattatoreDi } from "./registro";

function ctx(): TrpcContext {
  return {
    user: { id: 1, role: "admin", ruolo: "direzione", ruoli: ["direzione"] } as any,
    req: { protocol: "https", headers: {}, get: () => "app.wyndoor.com" } as any,
    res: {} as TrpcContext["res"],
    sedeId: 1,
    sediIds: [1],
    tenantId: 1,
    tenant: null,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("un adattatore rotto non svuota l'elenco", () => {
  it("elenco: gli altri restano, il rotto diventa un problema da assistenza", async () => {
    vi.spyOn(adattatoreDi("backup")!, "stato").mockRejectedValue(
      new Error("Drive non risponde")
    );

    const stati = await appRouter.createCaller(ctx()).integrazioni.elenco();

    expect(stati.map(s => s.chiave)).toContain("fic");
    const rotto = stati.find(s => s.chiave === "backup")!;
    expect(rotto.collegato).toBe(false);
    expect(rotto.problema?.azione).toBe("assistenza");
    expect(rotto.problema?.causa).toMatch(/Stato non disponibile/i);
  });

  it("attivazione: il passo rotto resta nell'elenco, da fare", async () => {
    vi.spyOn(adattatoreDi("email")!, "stato").mockRejectedValue(
      new Error("caselle illeggibili")
    );

    const passi = await appRouter.createCaller(ctx()).integrazioni.attivazione();

    expect(passi.map(p => p.chiave)).toContain("email");
    expect(passi.find(p => p.chiave === "email")?.esito).toBe("da_fare");
    expect(passi.length).toBeGreaterThan(1);
  });
});

describe("il messaggio di un guasto non porta fuori segreti", () => {
  it("tiene la prima riga e la accorcia", () => {
    const lungo = new Error(`Drive non risponde: ${"a".repeat(400)}\nstack qui`);
    const breve = messaggioBreve(lungo);
    expect(breve.length).toBeLessThanOrEqual(120);
    expect(breve).not.toContain("stack qui");
  });

  it("cancella le stringhe che sembrano un token", () => {
    const breve = messaggioBreve(
      new Error("token rifiutato: ya29.A0ARrdaM9xKlmNOPqrstuvWXYZ0123456789abcdef")
    );
    expect(breve).not.toContain("ya29.A0ARrdaM9xKlmNOPqrstuvWXYZ0123456789abcdef");
    expect(breve).toMatch(/token rifiutato/);
  });

  it("un errore senza messaggio non lascia la frase a metà", () => {
    expect(messaggioBreve(undefined)).toBeTruthy();
    expect(messaggioBreve({} as unknown)).toBeTruthy();
  });
});
