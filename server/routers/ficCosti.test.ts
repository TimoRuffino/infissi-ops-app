import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import {
  candidatiCommessaPerCosto,
  classificaConRegole,
  costiFicPerCommessa,
  ficCosti,
  finalizzaSnapshotCosti,
  upsertCostiFic,
} from "./ficCosti";
import { calcolaMargine } from "../_core/margine";

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

describe("costi di commessa", () => {
  it("assegnare un costo lo fa entrare nel margine senza riscriverlo", async () => {
    // Il difetto vero: `commessaId` esisteva nel dato e nessuna mutation lo
    // scriveva, quindi i costi «Commessa» non arrivavano mai al margine e
    // qualcuno li ribatteva a mano nella scheda.
    const sedeId = 91;
    const caller = appRouter.createCaller(ctx(sedeId));
    const cliente = await caller.clienti.create({
      nome: "Ada",
      cognome: "Margine",
    });
    const commessa = await caller.commesse.create({
      clienteId: cliente.id,
      importoTotale: 10_000,
    });
    upsertCostiFic(
      [costo(91_001, { importoNetto: 4_000, fornitoreNome: "Vetreria Alfa" })],
      sedeId,
      "costi-margine"
    );

    expect(costiFicPerCommessa(commessa.id, sedeId)).toEqual([]);

    await caller.ficCosti.assegnaCommessa({
      id: 91_001,
      commessaId: commessa.id,
    });

    const assegnati = costiFicPerCommessa(commessa.id, sedeId);
    expect(assegnati).toHaveLength(1);
    expect(assegnati[0]).toMatchObject({
      fornitore: "Vetreria Alfa",
      importo: 4_000,
      origine: "fic",
    });
    // Assegnare implica la classificazione: un costo che sta su una commessa
    // e' un costo di commessa.
    expect(
      ficCosti.find(c => c.id === 91_001 && c.sedeId === sedeId)!.classificazione
    ).toBe("variabile_commessa");

    const margine = await caller.commesse.margine(commessa.id);
    expect(margine.costiFornitore).toBe(4_000);
    expect(margine.margineLordo).toBe(6_000);
    expect(margine.datiIncompleti).toBe(false);

    await caller.ficCosti.assegnaCommessa({ id: 91_001, commessaId: null });
    expect((await caller.commesse.margine(commessa.id)).costiFornitore).toBe(0);
  });

  it("una nota di credito passiva abbatte il costo, non lo aumenta", () => {
    const sedeId = 92;
    upsertCostiFic(
      [
        costo(92_001, { importoNetto: 1_000 }),
        costo(92_002, {
          tipo: "passive_credit_note" as const,
          importoNetto: 250,
        }),
      ],
      sedeId,
      "costi-nc"
    );
    for (const id of [92_001, 92_002]) {
      ficCosti.find(c => c.id === id && c.sedeId === sedeId)!.commessaId = 7;
    }
    const voci = costiFicPerCommessa(7, sedeId);
    expect(calcolaMargine({ importoTotale: 5_000 }, voci).costiFornitore).toBe(750);
  });

  it("una commessa di un'altra sede non si puo' assegnare", async () => {
    const sedeId = 93;
    const caller = appRouter.createCaller(ctx(sedeId));
    const altra = appRouter.createCaller(ctx(94));
    const cliente = await altra.clienti.create({ nome: "Nino", cognome: "Altrove" });
    const commessaAltrui = await altra.commesse.create({ clienteId: cliente.id });
    upsertCostiFic([costo(93_001)], sedeId, "costi-sede");
    await expect(
      caller.ficCosti.assegnaCommessa({
        id: 93_001,
        commessaId: commessaAltrui.id,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("il codice commessa scritto nel documento e' il primo candidato", () => {
    const candidati = candidatiCommessaPerCosto(
      {
        descrizione: "Fornitura serramenti rif. COM 2026 012",
        numeroDocumento: "FT-99",
        fornitoreNome: "Vetreria Alfa",
        data: "2026-05-04",
      },
      [
        { id: 1, codice: "COM-2026-012", cliente: "Rossi", costi: [] },
        {
          id: 2,
          codice: "COM-2026-050",
          cliente: "Bianchi",
          costi: [{ fornitore: "Vetreria Alfa Srl" }],
        },
      ]
    );
    expect(candidati[0]).toMatchObject({
      commessaId: 1,
      motivo: "codice nel documento",
    });
    expect(candidati[1]).toMatchObject({ commessaId: 2 });
  });
});

describe("arretrato per anno", () => {
  it("conta il lavoro in sospeso di tutti gli anni, non solo di quello aperto", async () => {
    const sedeId = 95;
    const caller = appRouter.createCaller(ctx(sedeId));
    upsertCostiFic(
      [
        costo(95_001, { data: "2025-03-04", fornitoreNome: "Trattoria Uno" }),
        costo(95_002, { data: "2025-06-11", fornitoreNome: "Trattoria Due" }),
        costo(95_003, { data: "2026-02-02", fornitoreNome: "Trattoria Tre" }),
      ],
      sedeId,
      "costi-arretrato"
    );
    const arretrati = await caller.ficCosti.arretrati();
    expect(arretrati.find(a => a.anno === 2025)?.daClassificare).toBe(2);
    expect(arretrati.find(a => a.anno === 2026)?.daClassificare).toBe(1);
  });

  it("i documenti da classificare si chiudono per fornitore e in blocco", async () => {
    const sedeId = 96;
    const caller = appRouter.createCaller(ctx(sedeId));
    upsertCostiFic(
      [
        costo(96_001, { data: "2025-01-10", fornitoreNome: "Brianzatende SRL" }),
        costo(96_002, { data: "2025-02-10", fornitoreNome: "BRIANZATENDE S.R.L." }),
        costo(96_003, { data: "2025-03-10", fornitoreNome: "Ristorante Da Carlo" }),
      ],
      sedeId,
      "costi-gruppi"
    );
    const gruppi = await caller.ficCosti.daClassificarePerFornitore({ anno: 2025 });
    // Le forme societarie non fanno due fornitori diversi.
    const brianza = gruppi.find(g => g.documenti === 2);
    expect(brianza?.ids).toHaveLength(2);
    expect(gruppi).toHaveLength(2);

    const esito = await caller.ficCosti.riclassificaMolti({
      ids: [96_003],
      classificazione: "straordinario",
    });
    expect(esito.aggiornati).toBe(1);
    expect(
      ficCosti.find(c => c.id === 96_003 && c.sedeId === sedeId)!.classificazione
    ).toBe("straordinario");
  });
});
