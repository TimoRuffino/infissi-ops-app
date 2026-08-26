import { describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";
import { getCommesseStore } from "./commesse";
import {
  allineaTimelineAlBoard,
  reconcileTimelineBoardStates,
} from "./timeline";

function context(sedeId: number): TrpcContext {
  return {
    user: {
      id: sedeId + 10_000,
      role: "admin",
      ruolo: "direzione",
      ruoli: ["direzione"],
      name: "Timeline Test",
    } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}

describe("timeline ordine e stato commessa", () => {
  it("completa una milestone e avanza la commessa rispettando il gate documentale", async () => {
    const caller = appRouter.createCaller(context(97101));
    let commessa = await caller.commesse.create({ cliente: "Timeline Seed" });
    // La timeline demo occupa storicamente commessaId=1 nel test store.
    if (commessa.id === 1) {
      commessa = await caller.commesse.create({ cliente: "Timeline Gate" });
    }
    const [rilievo] = await caller.timeline.byCommessa(commessa.id);

    await expect(
      caller.timeline.updateStep({
        id: rilievo.id,
        stato: "completato",
      })
    ).rejects.toThrow("DOC_GATE_BLOCKED");

    expect(await caller.commesse.byId(commessa.id)).toMatchObject({
      stato: "preventivo",
    });
    expect((await caller.timeline.byCommessa(commessa.id))[0]).toMatchObject({
      stato: "da_fare",
    });

    await caller.timeline.updateStep({
      id: rilievo.id,
      stato: "completato",
      force: true,
    });

    expect(await caller.commesse.byId(commessa.id)).toMatchObject({
      stato: "misure_esecutive",
    });
  });

  it("non cambia colonna per uno step che non e una milestone", async () => {
    const caller = appRouter.createCaller(context(97102));
    const commessa = await caller.commesse.create({ cliente: "Timeline Neutra" });
    const steps = await caller.timeline.byCommessa(commessa.id);
    const invioFattura = steps.find((step) => step.stepNumber === 4)!;

    await caller.timeline.updateStep({
      id: invioFattura.id,
      stato: "completato",
    });

    expect(await caller.commesse.byId(commessa.id)).toMatchObject({
      stato: "preventivo",
    });
  });

  it("riaprire uno step non riporta indietro la commessa", async () => {
    const caller = appRouter.createCaller(context(97103));
    const commessa = await caller.commesse.create({ cliente: "Timeline Riaperta" });
    const [rilievo] = await caller.timeline.byCommessa(commessa.id);

    await caller.timeline.updateStep({
      id: rilievo.id,
      stato: "completato",
      force: true,
    });
    await caller.timeline.updateStep({
      id: rilievo.id,
      stato: "da_fare",
    });

    expect(await caller.commesse.byId(commessa.id)).toMatchObject({
      stato: "misure_esecutive",
    });
  });

  it("segue tutte le colonne del board senza saltare transizioni", async () => {
    const caller = appRouter.createCaller(context(97104));
    const commessa = await caller.commesse.create({ cliente: "Timeline Completa" });
    const steps = await caller.timeline.byCommessa(commessa.id);
    const milestones = [
      [1, "misure_esecutive"],
      [2, "aggiornamento_contratto"],
      [3, "fatture_pagamento"],
      [5, "da_ordinare"],
      [6, "produzione"],
      [10, "ordini_ultimazione"],
      [11, "attesa_posa"],
      [15, "finiture_saldo"],
      [17, "interventi_regolazioni"],
      [18, "archiviata"],
    ] as const;

    for (const [stepNumber, stato] of milestones) {
      const step = steps.find((item) => item.stepNumber === stepNumber)!;
      await caller.timeline.updateStep({
        id: step.id,
        stato: "completato",
        force: true,
      });
      expect(await caller.commesse.byId(commessa.id)).toMatchObject({ stato });
    }
  });

  it("riallinea le commesse storiche alla milestone completata piu avanzata", async () => {
    const caller = appRouter.createCaller(context(97105));
    const commessa = await caller.commesse.create({ cliente: "Timeline Storica" });
    const steps = await caller.timeline.byCommessa(commessa.id);

    for (const stepNumber of [1, 2, 3, 5, 6]) {
      const step = steps.find((item) => item.stepNumber === stepNumber)!;
      await caller.timeline.updateStep({
        id: step.id,
        stato: "completato",
        force: true,
      });
    }

    const stored = getCommesseStore().find((item) => item.id === commessa.id)!;
    stored.stato = "misure_esecutive";

    expect(reconcileTimelineBoardStates().aggiornate).toBeGreaterThanOrEqual(1);
    expect(await caller.commesse.byId(commessa.id)).toMatchObject({
      stato: "produzione",
    });
    expect(reconcileTimelineBoardStates()).toMatchObject({ aggiornate: 0 });
  });

  it("la riconciliazione non arretra commesse gia piu avanti", async () => {
    const caller = appRouter.createCaller(context(97106));
    const commessa = await caller.commesse.create({ cliente: "Timeline Avanti" });
    const [rilievo] = await caller.timeline.byCommessa(commessa.id);
    const stored = getCommesseStore().find((item) => item.id === commessa.id)!;
    stored.stato = "finiture_saldo";

    await caller.timeline.updateStep({
      id: rilievo.id,
      stato: "completato",
      force: true,
    });

    expect(reconcileTimelineBoardStates()).toMatchObject({ aggiornate: 0 });
    expect(await caller.commesse.byId(commessa.id)).toMatchObject({
      stato: "finiture_saldo",
    });
  });
});

// Board → timeline: l'altro verso del collegamento. Chi lavora dal Kanban
// non deve lasciare indietro una timeline che nessuno chiuderà più.
describe("allineaTimelineAlBoard", () => {
  it("completa le milestone raggiunte dalla board", async () => {
    const caller = appRouter.createCaller(context(1));
    const cliente = await caller.clienti.create({
      nome: "Board",
      cognome: "Allineato",
    });
    const commessa = await caller.commesse.create({ clienteId: cliente.id });
    await caller.timeline.byCommessa(commessa.id);

    // "aggiornamento_contratto" copre le milestone 1 e 2.
    expect(
      allineaTimelineAlBoard(commessa.id, "aggiornamento_contratto", "Tars")
    ).toBe(2);

    const steps = await caller.timeline.byCommessa(commessa.id);
    expect(steps[0].stato).toBe("completato");
    expect(steps[1].stato).toBe("completato");
    expect(steps[1].utente).toBe("Tars");
    expect(steps[2].stato).toBe("da_fare");
  });

  it("è idempotente e non riapre né arretra", async () => {
    const caller = appRouter.createCaller(context(1));
    const cliente = await caller.clienti.create({
      nome: "Idem",
      cognome: "Potente",
    });
    const commessa = await caller.commesse.create({ clienteId: cliente.id });
    await caller.timeline.byCommessa(commessa.id);

    allineaTimelineAlBoard(commessa.id, "fatture_pagamento");
    expect(allineaTimelineAlBoard(commessa.id, "fatture_pagamento")).toBe(0);
    // Arretrare la board non riapre il lavoro già fatto.
    expect(allineaTimelineAlBoard(commessa.id, "preventivo")).toBe(0);
    const steps = await caller.timeline.byCommessa(commessa.id);
    expect(steps.filter(s => s.stato === "completato")).toHaveLength(3);
  });

  it("ignora uno stato sconosciuto e una commessa senza timeline", () => {
    expect(allineaTimelineAlBoard(999_999, "produzione")).toBe(0);
    expect(allineaTimelineAlBoard(1, "stato_inventato")).toBe(0);
  });
});
