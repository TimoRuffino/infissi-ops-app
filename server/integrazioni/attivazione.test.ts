import { describe, expect, it, beforeEach } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import { passiAttivazione, segnaSaltata, righeAttivazione } from "./attivazione";

function ctx(): TrpcContext {
  return {
    user: { id: 1, role: "admin", ruolo: "direzione" } as any,
    req: { protocol: "https", headers: {}, get: () => "app.wyndoor.com" } as any,
    res: {} as TrpcContext["res"],
    sedeId: 1,
    sediIds: [1],
    tenantId: 1,
    tenant: null,
  };
}

beforeEach(() => {
  righeAttivazione.length = 0;
});

describe("percorso di attivazione", () => {
  it("nasce con tutti i passi da fare, nell'ordine del registro", async () => {
    const passi = await passiAttivazione(ctx());
    expect(passi[0].chiave).toBe("fic");
    expect(
      passi.every(p => p.esito === "da_fare" || p.esito === "collegata")
    ).toBe(true);
  });

  it("«salta» è disponibile su ogni passo e non blocca il resto", async () => {
    await appRouter.createCaller(ctx()).integrazioni.salta({ chiave: "email" });
    const passi = await passiAttivazione(ctx());
    expect(passi.find(p => p.chiave === "email")?.esito).toBe("saltata");
    expect(passi.find(p => p.chiave === "fic")?.esito).not.toBe("saltata");
  });

  it("il percorso riparte da dove si era interrotto", async () => {
    segnaSaltata("email");
    const passi = await passiAttivazione(ctx());
    expect(passi.find(p => p.chiave === "email")?.esito).toBe("saltata");
  });

  it("un'integrazione collegata risulta collegata anche se nessuno l'ha segnata", async () => {
    // `passiAttivazione` legge lo stato reale degli adattatori: il percorso
    // non tiene una seconda verità accanto a quella del dominio.
    const passi = await passiAttivazione(ctx());
    expect(passi.find(p => p.chiave === "agente")?.esito).toBe("collegata");
  });

  it("saltare non nasconde il passo: resta nell'elenco, con il suo esito", async () => {
    segnaSaltata("email");
    const passi = await passiAttivazione(ctx());
    expect(passi.map(p => p.chiave)).toContain("email");
  });
});
