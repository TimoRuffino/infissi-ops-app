// Costi fissi dichiarati a mano.
//
// Il punto di pareggio si calcola su questi numeri: una cadenza sbagliata o
// un periodo che non si chiude producono un obiettivo di fatturato falso, e
// nessuno se ne accorge finché l'anno non è finito.

import { describe, expect, it } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import { importoMensile, mesiNelPeriodo } from "./costiFissi";
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
  it("conferma una proposta FiC una sola volta", async () => {
    // La regressione: due click o due retry non devono raddoppiare il costo
    // registrato e quindi il punto di pareggio.
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
    const candidato = candidatiFissiPerSede(sedeId)[0];

    const first = await caller.costiFissi.confermaDaFic({
      chiave: candidato.chiave,
      descrizione: "Canone TIM",
      cadenza: "mensile",
      categoria: "servizi",
      dal: "2026-01",
    });
    const second = await caller.costiFissi.confermaDaFic({
      chiave: candidato.chiave,
      descrizione: "Canone TIM",
      cadenza: "mensile",
      categoria: "servizi",
      dal: "2026-01",
    });

    expect(first.origine).toBe("fic");
    expect(first.ficChiaveRicorrenza).toBe(candidato.chiave);
    expect(second.id).toBe(first.id);
    expect((await caller.costiFissi.list()).totaleMensile).toBe(candidato.importo);
  });

  it("restituisce la conferma FiC anche dopo che il candidato viene escluso", async () => {
    // Se un retry cercasse ancora il candidato prima del registro, una
    // successiva esclusione del fornitore trasformerebbe una conferma già
    // scritta in un falso NOT_FOUND.
    const sedeId = 75;
    const caller = appRouter.createCaller(ctx(sedeId));
    upsertCostiFic(
      ["01", "02", "03"].map((mese, index) => ({
        id: 75_001 + index,
        tipo: "expense" as const,
        data: `2026-${mese}-10`,
        fornitoreId: 75,
        fornitoreNome: "Canone Escluso SRL",
        categoriaFic: "Servizi",
        descrizione: "Canone da confermare",
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
    const candidato = candidatiFissiPerSede(sedeId)[0];
    const input = {
      chiave: candidato.chiave,
      descrizione: "Canone escluso",
      cadenza: "mensile" as const,
      categoria: "servizi" as const,
      dal: "2026-01",
    };
    const confermato = await caller.costiFissi.confermaDaFic(input);

    await caller.ficCosti.spostaFornitore({
      fornitore: "Canone Escluso SRL",
      classificazione: "straordinario",
    });
    expect(candidatiFissiPerSede(sedeId)).toEqual([]);

    const retry = await caller.costiFissi.confermaDaFic(input);
    expect(retry.id).toBe(confermato.id);
  });

  it("non restituisce la conferma di un'altra sede con la stessa chiave FiC", async () => {
    // La chiave ricorrente non contiene la sede: il registro deve quindi
    // includere sempre lo scope nel controllo di idempotenza.
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
    const candidatoUno = candidatiFissiPerSede(sedeUno)[0];
    const candidatoDue = candidatiFissiPerSede(sedeDue)[0];
    expect(candidatoDue.chiave).toBe(candidatoUno.chiave);

    const input = {
      chiave: candidatoUno.chiave,
      descrizione: "Canone condiviso",
      cadenza: "mensile" as const,
      categoria: "servizi" as const,
      dal: "2026-01",
    };
    const confermatoUno = await uno.costiFissi.confermaDaFic(input);
    const confermatoDue = await due.costiFissi.confermaDaFic(input);

    expect(confermatoDue.id).not.toBe(confermatoUno.id);
    expect(confermatoDue.sedeId).toBe(sedeDue);
    expect((await uno.costiFissi.list()).voci).toHaveLength(1);
    expect((await due.costiFissi.list()).voci).toHaveLength(1);
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
