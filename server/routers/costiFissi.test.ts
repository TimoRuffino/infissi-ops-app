// Costi fissi dichiarati a mano.
//
// Il punto di pareggio si calcola su questi numeri: una cadenza sbagliata o
// un periodo che non si chiude producono un obiettivo di fatturato falso, e
// nessuno se ne accorge finché l'anno non è finito.

import { describe, expect, it } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import { importoMensile } from "./costiFissi";
import { candidatiFissiPerSede, upsertCostiFic } from "./ficCosti";

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
});

describe("costiFissi router", () => {
  it("classificare un fornitore come fisso lo mette nel registro e lo toglie dalla coda", async () => {
    // La regressione riportata: si classificava un costo come fisso e non
    // succedeva niente. Il totale restava a zero perche' il registro era uno
    // store separato, e il candidato restava in coda perche' l'esclusione
    // guardava solo chi era stato dichiarato NON fisso.
    const sedeId = 70;
    const caller = appRouter.createCaller(ctx(sedeId));
    upsertCostiFic(
      ["01", "02", "03"].map((mese, index) => ({
        id: 70_001 + index,
        tipo: "expense" as const,
        data: `2026-${mese}-10`,
        fornitoreId: 70,
        fornitoreNome: "TIM S.p.A.",
        categoriaFic: "Utenze",
        descrizione: "Canone telefonia",
        centro: null,
        numeroDocumento: `TIM-${mese}`,
        importoNetto: 750,
        importoIva: 165,
        importoLordo: 915,
        rate: [],
      })),
      sedeId,
      "costi-tim"
    );
    const periodo = { anno: 2026, mese: 4 } as const;

    expect(candidatiFissiPerSede(sedeId)).toHaveLength(1);
    expect((await caller.costiFissi.list(periodo)).totaleMensile).toBe(0);

    await caller.ficCosti.spostaFornitore({
      fornitore: "TIM S.p.A.",
      classificazione: "fisso",
    });

    const dopo = await caller.costiFissi.list(periodo);
    // €2.250 su tre mesi coperti.
    expect(dopo.totaleFic).toBe(750);
    expect(dopo.totaleMensile).toBe(750);
    expect(dopo.righe).toHaveLength(1);
    expect(dopo.righe[0]).toMatchObject({ fonte: "fic", documenti: 3 });
    // E sparisce dalla coda: una domanda con risposta non si rifà.
    expect(candidatiFissiPerSede(sedeId)).toEqual([]);
  });

  it("classificare un fornitore come straordinario lo toglie da entrambe le liste", async () => {
    const sedeId = 75;
    const caller = appRouter.createCaller(ctx(sedeId));
    upsertCostiFic(
      ["01", "02", "03"].map((mese, index) => ({
        id: 75_001 + index,
        tipo: "expense" as const,
        data: `2026-${mese}-10`,
        fornitoreId: 75,
        fornitoreNome: "Canone Escluso S.r.l.",
        categoriaFic: "Servizi",
        descrizione: "Canone da decidere",
        centro: null,
        numeroDocumento: `ESCLUSO-${mese}`,
        importoNetto: 420,
        importoIva: 92.4,
        importoLordo: 512.4,
        rate: [],
      })),
      sedeId,
      "costi-escluso"
    );
    expect(candidatiFissiPerSede(sedeId)).toHaveLength(1);

    await caller.ficCosti.spostaFornitore({
      fornitore: "Canone Escluso S.r.l.",
      classificazione: "straordinario",
    });

    expect(candidatiFissiPerSede(sedeId)).toEqual([]);
    const registro = await caller.costiFissi.list({ anno: 2026, mese: 4 });
    expect(registro.righe).toEqual([]);
    expect(registro.totaleMensile).toBe(0);
  });

  it("una voce dichiarata sullo stesso fornitore non raddoppia il costo", async () => {
    // L'affitto arriva sia come fattura passiva sia come voce scritta a mano:
    // sommarli sarebbe pagarlo due volte nel calcolo del pareggio.
    const sedeId = 78;
    const caller = appRouter.createCaller(ctx(sedeId));
    upsertCostiFic(
      ["01", "02", "03"].map((mese, index) => ({
        id: 78_001 + index,
        tipo: "expense" as const,
        data: `2026-${mese}-05`,
        fornitoreId: 78,
        fornitoreNome: "Immobiliare Rossi S.r.l.",
        categoriaFic: "Affitti",
        descrizione: "Canone capannone",
        centro: null,
        numeroDocumento: `AFF-${mese}`,
        importoNetto: 1_000,
        importoIva: 220,
        importoLordo: 1_220,
        rate: [],
      })),
      sedeId,
      "costi-affitto"
    );
    await caller.ficCosti.spostaFornitore({
      fornitore: "Immobiliare Rossi S.r.l.",
      classificazione: "fisso",
    });
    const periodo = { anno: 2026, mese: 4 } as const;
    expect((await caller.costiFissi.list(periodo)).totaleMensile).toBe(1_000);

    await caller.costiFissi.create({
      descrizione: "Affitto capannone",
      fornitore: "IMMOBILIARE ROSSI SRL",
      importo: 1_100,
      cadenza: "mensile",
      dal: "2025-01",
      categoria: "immobili",
    });

    const dopo = await caller.costiFissi.list(periodo);
    expect(dopo.righe).toHaveLength(1);
    expect(dopo.righe[0]).toMatchObject({
      fonte: "dichiarato",
      sostituisceFic: 1_000,
    });
    expect(dopo.totaleMensile).toBe(1_100);
  });

  it("il registro di una sede non vede i fissi FiC di un'altra", async () => {
    const sedeUno = 76;
    const sedeDue = 77;
    const uno = appRouter.createCaller(ctx(sedeUno));
    const due = appRouter.createCaller(ctx(sedeDue));
    const righe = (sedeId: number) =>
      ["01", "02", "03"].map((mese, index) => ({
        id: sedeId * 1_000 + index,
        tipo: "expense" as const,
        data: `2026-${mese}-10`,
        fornitoreId: 91,
        fornitoreNome: "Chiave Condivisa SRL",
        categoriaFic: "Servizi",
        descrizione: "Canone condiviso",
        centro: null,
        numeroDocumento: `CONDIVISA-${sedeId}-${mese}`,
        importoNetto: 880,
        importoIva: 193.6,
        importoLordo: 1_073.6,
        rate: [],
      }));
    upsertCostiFic(righe(sedeUno), sedeUno, "costi-condivisi-uno");
    upsertCostiFic(righe(sedeDue), sedeDue, "costi-condivisi-due");

    await uno.ficCosti.spostaFornitore({
      fornitore: "Chiave Condivisa SRL",
      classificazione: "fisso",
    });

    const periodo = { anno: 2026, mese: 4 } as const;
    expect((await uno.costiFissi.list(periodo)).totaleMensile).toBe(880);
    // La regola creata dalla sede 76 non deve classificare i documenti della 77.
    expect((await due.costiFissi.list(periodo)).totaleMensile).toBe(0);
  });

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
