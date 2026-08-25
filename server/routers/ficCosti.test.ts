import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import {
  classificaConRegole,
  ficCosti,
  finalizzaSnapshotCosti,
  upsertCostiFic,
} from "./ficCosti";

function ctx(sedeId: number): TrpcContext {
  return {
    user: {
      id: sedeId,
      openId: `economia-${sedeId}`,
      name: "Direzione",
      email: `economia-${sedeId}@example.test`,
      loginMethod: "local",
      role: "admin",
      ruolo: "direzione",
      ruoli: ["direzione"],
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } as any,
    req: { protocol: "http", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    sedeId,
    sediIds: [sedeId],
  };
}

const costo = (id: number, extra: Partial<any> = {}) => ({
  id,
  tipo: "expense" as const,
  data: "2026-07-10",
  fornitoreId: 77,
  fornitoreNome: "Energia Italia SPA",
  categoriaFic: "Utenze",
  descrizione: "Energia elettrica",
  centro: null,
  numeroDocumento: `E-${id}`,
  importoNetto: 500,
  importoIva: 110,
  importoLordo: 610,
  rate: [],
  ...extra,
});

describe("registro costi FiC", () => {
  it("uno snapshot incompleto non nasconde record, quello completo si", () => {
    const sedeId = 81;
    upsertCostiFic([costo(88101), costo(88102)], sedeId, "costi-a");
    upsertCostiFic([costo(88101)], sedeId, "costi-b");

    expect(
      finalizzaSnapshotCosti({
        sedeId,
        tipo: "expense",
        periodoDa: "2026-01-01",
        periodoA: "2026-12-31",
        syncId: "costi-b",
        completo: false,
      })
    ).toBe(0);
    expect(ficCosti.find(c => c.id === 88102)!.presenteInFic).toBe(true);

    expect(
      finalizzaSnapshotCosti({
        sedeId,
        tipo: "expense",
        periodoDa: "2026-01-01",
        periodoA: "2026-12-31",
        syncId: "costi-b",
        completo: true,
      })
    ).toBe(1);
    expect(ficCosti.find(c => c.id === 88102)!.presenteInFic).toBe(false);
  });

  it("una correzione utente crea una regola esplicita che prevale su Tars", async () => {
    const sedeId = 82;
    const caller = appRouter.createCaller(ctx(sedeId));
    upsertCostiFic([costo(88201)], sedeId, "regola-a");

    await caller.ficCosti.riclassifica({
      id: 88201,
      classificazione: "fisso",
      ricorda: true,
    });

    upsertCostiFic([costo(88202)], sedeId, "regola-b");
    const secondo = ficCosti.find(c => c.id === 88202 && c.sedeId === sedeId)!;
    expect(classificaConRegole(secondo)).toBe("fisso");
    expect(secondo.classificazione).toBe("fisso");
    expect(secondo.fonteClassificazione).toBe("regola");

    upsertCostiFic(
      [costo(88203, { categoriaFic: null })],
      sedeId,
      "regola-generica"
    );
    await caller.ficCosti.riclassifica({
      id: 88203,
      classificazione: "straordinario",
      ricorda: true,
    });
    expect(classificaConRegole(secondo)).toBe("fisso");

    const primo = ficCosti.find(c => c.id === 88201 && c.sedeId === sedeId)!;
    primo.classificazione = "variabile_commessa";
    primo.fonteClassificazione = "tars";
    await caller.ficCosti.riclassifica({
      id: 88201,
      classificazione: "straordinario",
      ricorda: false,
    });
    expect(primo.classificazione).toBe("straordinario");
    expect(primo.fonteClassificazione).toBe("utente");
  });

  it("non rivela un costo appartenente a un'altra sede", async () => {
    upsertCostiFic([costo(88301)], 83, "scope-a");
    const caller = appRouter.createCaller(ctx(84));

    await expect(
      caller.ficCosti.riclassifica({
        id: 88301,
        classificazione: "fisso",
        ricorda: false,
      })
    ).rejects.toMatchObject<Partial<TRPCError>>({ code: "NOT_FOUND" });
  });
});
