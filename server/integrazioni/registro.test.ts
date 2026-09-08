import { describe, expect, it, vi } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import { REGISTRO, adattatoreDi } from "./registro";

function ctx(sedeId = 1): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "local-1",
      name: "Admin Ruffino",
      email: "admin@ruffinogroup.it",
      loginMethod: "local",
      role: "admin",
      ruolo: "direzione",
      ruoli: ["direzione"],
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } as any,
    req: { protocol: "https", headers: {}, get: () => "app.wyndoor.com" } as any,
    res: {} as TrpcContext["res"],
    sedeId,
    sediIds: [1, 2],
    tenantId: 1,
    tenant: null,
  };
}

describe("registro delle integrazioni", () => {
  it("l'ordine è quello dell'attivazione, non l'alfabeto", () => {
    // Sottosuccessione: gli adattatori entrano nel registro man mano che i
    // loro task atterrano, ma sempre in quest'ordine. Il Task 12 sostituisce
    // questa asserzione con l'elenco completo.
    const atteso = ["fic", "email", "whatsapp", "backup", "agente"];
    const presenti = REGISTRO.map(a => a.chiave);
    expect(presenti).toEqual(atteso.filter(c => presenti.includes(c)));
  });

  it("una chiave sconosciuta non risolve", () => {
    expect(adattatoreDi("inesistente" as any)).toBeNull();
  });

  it("elenco risponde con uno Stato per ogni adattatore registrato", async () => {
    const stati = await appRouter.createCaller(ctx()).integrazioni.elenco();
    expect(stati.map(s => s.chiave)).toEqual(REGISTRO.map(a => a.chiave));
  });

  it("stato() non effettua nessuna chiamata di rete", async () => {
    const spia = vi.spyOn(globalThis, "fetch");
    await appRouter.createCaller(ctx()).integrazioni.elenco();
    expect(spia).not.toHaveBeenCalled();
    spia.mockRestore();
  });

  it("l'agente non si collega: nessun avvio, nessuno scollegamento", async () => {
    const agente = adattatoreDi("agente")!;
    expect(agente.avvia).toBeUndefined();
    expect(agente.scollega).toBeUndefined();
  });
});
