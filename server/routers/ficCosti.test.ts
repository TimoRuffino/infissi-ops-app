import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import {
  candidatiFissiPerSede,
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
  it("la ricorrenza propone costi fissi senza classificare i documenti", async () => {
    // Se `upsertCostiFic` tornasse a promuovere i documenti a fisso, il
    // registro confermato e il punto di pareggio conterebbero una decisione
    // che nessuno ha preso.
    const sedeId = 80;
    const caller = appRouter.createCaller(ctx(sedeId));
    const rows = [
      costo(80_001, { data: "2026-01-10", fornitoreNome: "Canoni TIM SPA" }),
      costo(80_002, { data: "2026-02-10", fornitoreNome: "Canoni TIM SPA" }),
      costo(80_003, { data: "2026-03-10", fornitoreNome: "Canoni TIM SPA" }),
    ];

    const result = upsertCostiFic(rows, sedeId, "costi-ricorrenza");
    const salvati = ficCosti.filter(
      costo => costo.sedeId === sedeId && costo.id >= 80_001 && costo.id <= 80_003
    );

    expect(salvati.every(costo => costo.classificazione === "dubbio")).toBe(true);
    expect(result.fissiPerRicorrenza).toBe(0);
    expect(candidatiFissiPerSede(sedeId)).toHaveLength(1);
    expect((await caller.ficCosti.ricorrenti()).totaleMensilePotenziale).toBe(500);
  });

  it("classificare un candidato lo toglie dalla coda e non lo fa tornare", async () => {
    // La coda «Da confermare» e' l'unico posto da cui un costo fisso puo'
    // nascere: se un candidato scartato ricomparisse al sync successivo, la
    // decisione dell'operatore varrebbe zero.
    const sedeId = 83;
    const caller = appRouter.createCaller(ctx(sedeId));
    // Ragione sociale col PUNTO, di proposito: e' la forma in cui FiC
    // scrive quasi tutti i fornitori veri, ed e' quella che rompeva
    // l'esclusione. Con "SRL" attaccato il bug non si vedeva.
    const rate = ["01", "02", "03"].map((m, i) =>
      costo(83_001 + i, {
        data: `2026-${m}-10`,
        fornitoreNome: "ALD Automotive Italia S.r.l.",
        importoNetto: 1_850,
      })
    );
    upsertCostiFic(rate, sedeId, "costi-coda");
    expect((await caller.ficCosti.ricorrenti()).gruppi).toHaveLength(1);

    await caller.ficCosti.spostaFornitore({
      fornitore: "ALD Automotive Italia S.r.l.",
      classificazione: "straordinario",
    });
    expect((await caller.ficCosti.ricorrenti()).gruppi).toHaveLength(0);

    // Un quarto documento identico non riapre la questione.
    upsertCostiFic(
      [
        costo(83_004, {
          data: "2026-04-10",
          fornitoreNome: "ALD AUTOMOTIVE ITALIA SRL",
          importoNetto: 1_850,
        }),
      ],
      sedeId,
      "costi-coda-2"
    );
    expect((await caller.ficCosti.ricorrenti()).gruppi).toHaveLength(0);
  });

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
    const gruppi = await caller.ficCosti.perFornitore({ anno: 2025 });
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

describe("togliere un fornitore dai costi fissi", () => {
  it("sposta tutti i documenti, non solo i dubbi, e aggiorna la regola", async () => {
    const sedeId = 97;
    const caller = appRouter.createCaller(ctx(sedeId));
    upsertCostiFic(
      [
        costo(97_001, {
          data: "2025-04-10",
          fornitoreNome: "Sciacca Trasporti SRL",
          importoNetto: 1_850,
        }),
        costo(97_002, {
          data: "2025-05-10",
          fornitoreNome: "SCIACCA TRASPORTI S.R.L.",
          importoNetto: 1_850,
        }),
        costo(97_003, {
          data: "2025-06-10",
          fornitoreNome: "Sciacca Trasporti SRL",
          importoNetto: 1_850,
        }),
      ],
      sedeId,
      "costi-sciacca"
    );
    // Tre mesi consecutivi allo stesso importo: l'aritmetica lo propone, ma
    // la classificazione resta una decisione dell'operatore.
    const nostri = () =>
      ficCosti.filter(c => c.sedeId === sedeId && c.id >= 97_001 && c.id <= 97_003);
    expect(nostri().every(c => c.classificazione === "dubbio")).toBe(true);
    expect(candidatiFissiPerSede(sedeId)).toHaveLength(1);

    // Ma e' manodopera di commessa, e va tolto tutto insieme.
    const esito = await caller.ficCosti.spostaFornitore({
      fornitore: "Sciacca Trasporti SRL",
      classificazione: "variabile_commessa",
    });
    expect(esito.aggiornati).toBe(3);
    // Due forme scritte, due regole: lasciarne una indietro faceva rientrare
    // i documenti nuovi.
    expect(esito.formeScritte).toBe(2);
    expect(nostri().every(c => c.classificazione === "variabile_commessa")).toBe(
      true
    );

    // E l'aritmetica non lo riporta dentro al sync successivo.
    upsertCostiFic(
      [
        costo(97_004, {
          data: "2025-07-10",
          fornitoreNome: "Sciacca Trasporti SRL",
          importoNetto: 1_850,
        }),
      ],
      sedeId,
      "costi-sciacca-2"
    );
    const tutti = ficCosti.filter(
      c => c.sedeId === sedeId && c.id >= 97_001 && c.id <= 97_004
    );
    expect(tutti).toHaveLength(4);
    expect(tutti.some(c => c.classificazione === "fisso")).toBe(false);
  });
});

describe("registro acquisti", () => {
  it("mostra i fornitori di TUTTE le classificazioni, non solo la coda", async () => {
    // La regressione: la scheda Acquisti interrogava solo i `dubbio`, in
    // entrambe le viste. Finito di classificare, gli acquisti sparivano dalla
    // pagina e non restava un posto dove vederli.
    const sedeId = 88;
    const caller = appRouter.createCaller(ctx(sedeId));
    upsertCostiFic(
      [
        costo(88_001, { fornitoreNome: "Affitti Rossi SRL", data: "2026-03-01" }),
        costo(88_002, { fornitoreNome: "Materiali Bianchi SRL", data: "2026-03-02" }),
        costo(88_003, { fornitoreNome: "Trattoria Verdi", data: "2026-03-03" }),
      ],
      sedeId,
      "acquisti-registro"
    );

    expect(await caller.ficCosti.perFornitore({ anno: 2026 })).toHaveLength(3);

    await caller.ficCosti.spostaFornitore({
      fornitore: "Affitti Rossi SRL",
      classificazione: "fisso",
    });
    await caller.ficCosti.spostaFornitore({
      fornitore: "Materiali Bianchi SRL",
      classificazione: "variabile_commessa",
    });
    await caller.ficCosti.spostaFornitore({
      fornitore: "Trattoria Verdi",
      classificazione: "straordinario",
    });

    // Classificato tutto, il registro resta pieno.
    const tutti = await caller.ficCosti.perFornitore({ anno: 2026 });
    expect(tutti).toHaveLength(3);
    expect(tutti.every(g => g.daClassificare === 0)).toBe(true);
    // E la coda è vuota, che è cosa diversa dal registro.
    expect(
      await caller.ficCosti.perFornitore({ anno: 2026, classificazione: "dubbio" })
    ).toEqual([]);
  });

  it("filtra per classificazione e dice quella prevalente", async () => {
    const sedeId = 89;
    const caller = appRouter.createCaller(ctx(sedeId));
    upsertCostiFic(
      [
        costo(89_001, { fornitoreNome: "Canone Alfa SRL", data: "2026-01-10" }),
        costo(89_002, { fornitoreNome: "Canone Alfa SRL", data: "2026-02-10" }),
        costo(89_003, { fornitoreNome: "Beta Materiali SRL", data: "2026-02-11" }),
      ],
      sedeId,
      "acquisti-filtri"
    );
    await caller.ficCosti.spostaFornitore({
      fornitore: "Canone Alfa SRL",
      classificazione: "fisso",
    });

    const fissi = await caller.ficCosti.perFornitore({
      anno: 2026,
      classificazione: "fisso",
    });
    expect(fissi).toHaveLength(1);
    expect(fissi[0]).toMatchObject({
      fornitore: "Canone Alfa SRL",
      documenti: 2,
      prevalente: "fisso",
      totale: 1_000,
    });

    const dubbi = await caller.ficCosti.perFornitore({
      anno: 2026,
      classificazione: "dubbio",
    });
    expect(dubbi.map(g => g.fornitore)).toEqual(["Beta Materiali SRL"]);
  });

  it("le note di credito passive abbassano il totale del fornitore", async () => {
    const sedeId = 90;
    const caller = appRouter.createCaller(ctx(sedeId));
    upsertCostiFic(
      [
        costo(90_001, { fornitoreNome: "Reso SRL", data: "2026-04-01" }),
        costo(90_002, {
          fornitoreNome: "Reso SRL",
          data: "2026-04-02",
          tipo: "passive_credit_note" as const,
          importoNetto: 200,
        }),
      ],
      sedeId,
      "acquisti-note"
    );
    const gruppi = await caller.ficCosti.perFornitore({ anno: 2026 });
    expect(gruppi[0].totale).toBe(300);
  });
});
