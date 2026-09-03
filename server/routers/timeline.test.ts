import { describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";
import { getCommesseStore } from "./commesse";
import {
  allineaTimelineAlBoard,
  migraStepTimeline,
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
    const dataSpedizione = steps.find((step) => step.stepNumber === 7)!;

    await caller.timeline.updateStep({
      id: dataSpedizione.id,
      stato: "completato",
    });

    expect(await caller.commesse.byId(commessa.id)).toMatchObject({
      stato: "preventivo",
    });
  });

  it("nasce con 16 step: niente invio fattura, ordine e conferma fusi", async () => {
    const caller = appRouter.createCaller(context(97107));
    const commessa = await caller.commesse.create({ cliente: "Timeline Nuova" });
    const steps = await caller.timeline.byCommessa(commessa.id);

    expect(steps).toHaveLength(16);
    const etichette = steps.map((step) => step.label);
    expect(etichette).not.toContain("Invio Fattura al Cliente");
    expect(etichette).not.toContain("Ordine Merce al Fornitore");
    // Dopo «Fatturazione» si passa direttamente all'acconto del cliente, e
    // l'ordine al fornitore vive nella sola conferma.
    expect(steps[2].label).toBe("Fatturazione");
    expect(steps[3].label).toBe("Pagamento 1\u00B0 Acconto Cliente");
    expect(steps[4].label).toBe("Conferma Ordine Fornitore (allegato)");
  });

  it("porta in produzione quando il fornitore ha confermato", async () => {
    const caller = appRouter.createCaller(context(97108));
    const commessa = await caller.commesse.create({ cliente: "Timeline Conferma" });
    const steps = await caller.timeline.byCommessa(commessa.id);

    for (const stepNumber of [1, 2, 3, 4]) {
      const step = steps.find((item) => item.stepNumber === stepNumber)!;
      await caller.timeline.updateStep({
        id: step.id,
        stato: "completato",
        force: true,
      });
    }
    expect(await caller.commesse.byId(commessa.id)).toMatchObject({
      stato: "da_ordinare",
    });

    const conferma = steps.find((item) => item.stepNumber === 5)!;
    expect(conferma.label).toBe("Conferma Ordine Fornitore (allegato)");
    await caller.timeline.updateStep({
      id: conferma.id,
      stato: "completato",
      force: true,
    });

    expect(await caller.commesse.byId(commessa.id)).toMatchObject({
      stato: "produzione",
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
      [4, "da_ordinare"],
      [5, "produzione"],
      [8, "ordini_ultimazione"],
      [9, "attesa_posa"],
      [13, "finiture_saldo"],
      [15, "interventi_regolazioni"],
      [16, "archiviata"],
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

    for (const stepNumber of [1, 2, 3, 4, 5]) {
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

// Le timeline già salvate vanno ripulite al bootstrap: qui si verifica la
// funzione pura che `onLoad` applica allo store persistito.
describe("migrazione degli step della timeline", () => {
  function passo(commessaId: number, stepNumber: number, label: string) {
    return {
      id: commessaId * 100 + stepNumber,
      commessaId,
      stepNumber,
      label,
      stato: "da_fare",
      dataCompletamento: null,
      utente: null,
      note: null,
      allegato: null,
    } as any;
  }

  function completo(passo: any, data: string, utente: string, note: string) {
    return {
      ...passo,
      stato: "completato",
      dataCompletamento: data,
      utente,
      note,
    };
  }

  it("toglie l'invio fattura e rinumera gli step senza lasciare buchi", () => {
    const caricati = [
      passo(7, 1, "Rilievo Misure"),
      passo(7, 2, "Firma Contratto (allegato)"),
      passo(7, 3, "Fatturazione"),
      passo(7, 4, "Invio Fattura al Cliente"),
      passo(7, 5, "Pagamento 1\u00B0 Acconto Cliente"),
    ];

    expect(migraStepTimeline(caricati)).toBe(true);
    expect(caricati.map((step) => [step.stepNumber, step.label])).toEqual([
      [1, "Rilievo Misure"],
      [2, "Firma Contratto (allegato)"],
      [3, "Fatturazione"],
      [4, "Pagamento 1\u00B0 Acconto Cliente"],
    ]);
  });

  it("rinumera ogni commessa per conto suo e non ripassa due volte", () => {
    const caricati = [
      passo(1, 1, "Fatturazione"),
      passo(1, 2, "Invio Fattura al Cliente"),
      passo(1, 3, "Pagamento 1\u00B0 Acconto Cliente"),
      passo(2, 1, "Rilievo Misure"),
      passo(2, 2, "Invio Fattura al Cliente"),
    ];

    expect(migraStepTimeline(caricati)).toBe(true);
    expect(
      caricati.filter((s) => s.commessaId === 1).map((s) => s.stepNumber)
    ).toEqual([1, 2]);
    expect(
      caricati.filter((s) => s.commessaId === 2).map((s) => s.stepNumber)
    ).toEqual([1]);
    // Uno store già migrato non viene riscritto a ogni avvio.
    expect(migraStepTimeline(caricati)).toBe(false);
  });

  it("fonde l'ordine nella conferma portandosi dietro la spunta", () => {
    const caricati = [
      passo(9, 4, "Pagamento 1\u00B0 Acconto Cliente"),
      completo(
        passo(9, 5, "Ordine Merce al Fornitore"),
        "2026-03-04",
        "Anna Russo",
        "Ordinato al fornitore per telefono"
      ),
      passo(9, 6, "Conferma Ordine Fornitore (allegato)"),
      passo(9, 7, "Pagamento Acconto Fornitore"),
    ];

    expect(migraStepTimeline(caricati)).toBe(true);

    const conferma = caricati.find((s) =>
      s.label.startsWith("Conferma Ordine Fornitore")
    )!;
    // Chi aveva spuntato l'ordine non deve ritrovarsi il passo riaperto:
    // era lo stesso gesto, quindi data, esecutore e nota si travasano.
    expect(conferma).toMatchObject({
      // I quattro passi di partenza diventano tre e si rinumerano da 1.
      stepNumber: 2,
      stato: "completato",
      dataCompletamento: "2026-03-04",
      utente: "Anna Russo",
      note: "Ordinato al fornitore per telefono",
    });
    expect(caricati.map((s) => s.stepNumber)).toEqual([1, 2, 3]);
  });

  it("non sovrascrive una conferma già spuntata e tiene le due note", () => {
    const caricati = [
      completo(
        passo(11, 5, "Ordine Merce al Fornitore"),
        "2026-03-04",
        "Anna Russo",
        "Ordinato per telefono"
      ),
      completo(
        passo(11, 6, "Conferma Ordine Fornitore (allegato)"),
        "2026-03-09",
        "Marco Ferrara",
        "Conferma CO_4471 allegata"
      ),
    ];

    expect(migraStepTimeline(caricati)).toBe(true);

    expect(caricati).toHaveLength(1);
    expect(caricati[0]).toMatchObject({
      stepNumber: 1,
      dataCompletamento: "2026-03-09",
      utente: "Marco Ferrara",
      note: "Conferma CO_4471 allegata · Ordinato per telefono",
    });
  });

  it("continua a togliere il DDT finale ritirato in precedenza", () => {
    const caricati = [
      passo(3, 1, "Pagamento Ultimo Cliente (Saldo)"),
      passo(3, 2, "Fine Lavori \u2014 DDT Finale"),
      passo(3, 3, "Recensione del Cliente"),
    ];

    expect(migraStepTimeline(caricati)).toBe(true);
    expect(caricati.map((step) => step.label)).toEqual([
      "Pagamento Ultimo Cliente (Saldo)",
      "Recensione del Cliente",
    ]);
  });
});
