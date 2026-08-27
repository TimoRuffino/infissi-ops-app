// Costi fissi dichiarati a mano.
//
// Il punto di pareggio si calcola su questi numeri: una cadenza sbagliata o
// un periodo che non si chiude producono un obiettivo di fatturato falso, e
// nessuno se ne accorge finché l'anno non è finito.

import { describe, expect, it } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import { importoMensile, mesiNelPeriodo } from "./costiFissi";

function ctx(sedeId: number): TrpcContext {
  return {
    user: {
      id: sedeId,
      openId: `fissi-${sedeId}`,
      name: "Direzione",
      email: `fissi-${sedeId}@example.test`,
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

describe("mensilizzazione", () => {
  it("una cadenza annuale non è un costo di gennaio", () => {
    expect(importoMensile({ importo: 1_200, cadenza: "annuale" })).toBe(100);
    expect(importoMensile({ importo: 900, cadenza: "trimestrale" })).toBe(300);
    expect(importoMensile({ importo: 250, cadenza: "mensile" })).toBe(250);
  });

  it("conta solo i mesi dentro il periodo, non quelli prima o dopo", () => {
    const voce = { dal: "2026-03", al: "2026-06" };
    expect(mesiNelPeriodo(voce, "2026-01-01", "2026-12-31")).toBe(4);
    expect(mesiNelPeriodo(voce, "2026-05-01", "2026-12-31")).toBe(2);
    expect(mesiNelPeriodo(voce, "2026-07-01", "2026-12-31")).toBe(0);
    // Senza fine dichiarata la voce corre fino al termine del periodo.
    expect(
      mesiNelPeriodo({ dal: "2026-01", al: null }, "2026-01-01", "2026-12-31")
    ).toBe(12);
  });
});

describe("costiFissi router", () => {
  it("crea, mensilizza, aggiorna e cancella", async () => {
    const caller = appRouter.createCaller(ctx(71));
    const creato = await caller.costiFissi.create({
      descrizione: "Stipendi operai",
      importo: 18_000,
      cadenza: "mensile",
      dal: "2026-01",
      categoria: "personale",
    });
    expect(creato.mensile).toBe(18_000);

    const inps = await caller.costiFissi.create({
      descrizione: "INPS",
      importo: 9_000,
      cadenza: "trimestrale",
      dal: "2026-01",
      categoria: "tasse",
    });
    expect(inps.mensile).toBe(3_000);

    const elenco = await caller.costiFissi.list();
    expect(elenco.totaleMensile).toBe(21_000);
    // Ordinati per peso: il costo più grosso è la prima domanda.
    expect(elenco.voci[0].descrizione).toBe("Stipendi operai");

    await caller.costiFissi.update({ id: inps.id, importo: 12_000 });
    expect((await caller.costiFissi.list()).totaleMensile).toBe(22_000);

    await caller.costiFissi.remove({ id: inps.id });
    expect((await caller.costiFissi.list()).voci).toHaveLength(1);
  });

  it("rifiuta un periodo che finisce prima di cominciare", async () => {
    const caller = appRouter.createCaller(ctx(72));
    await expect(
      caller.costiFissi.create({
        descrizione: "Affitto",
        importo: 1_000,
        cadenza: "mensile",
        dal: "2026-06",
        al: "2026-03",
        categoria: "immobili",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("non mostra né tocca le voci di un'altra sede", async () => {
    const uno = appRouter.createCaller(ctx(73));
    const due = appRouter.createCaller(ctx(74));
    const voce = await uno.costiFissi.create({
      descrizione: "Affitto capannone",
      importo: 2_500,
      cadenza: "mensile",
      dal: "2026-01",
      categoria: "immobili",
    });
    expect((await due.costiFissi.list()).voci).toHaveLength(0);
    await expect(
      due.costiFissi.remove({ id: voce.id })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
