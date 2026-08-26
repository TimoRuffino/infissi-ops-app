import { describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";
import { getCommesseStore } from "./commesse";
import { ficFatture, upsertFatture } from "./ficFatture";
import {
  confermaRiconciliazioneManuale,
  ficPaymentLinks,
  riconciliaPagamentiFic,
} from "./ficPagamenti";

function ctx(sedeId: number): TrpcContext {
  return {
    user: {
      id: sedeId,
      openId: `fic-payments-${sedeId}`,
      name: "Direzione",
      email: `fic-payments-${sedeId}@example.test`,
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

async function setupInvoice(input: {
  sedeId: number;
  ficId: number;
  rate?: Array<{
    id: number | null;
    sourceKey: string;
    importo: number;
    scadenza: string | null;
    stato: string;
    dataPagamento: string | null;
  }>;
}) {
  const caller = appRouter.createCaller(ctx(input.sedeId));
  const commessa = await caller.commesse.create({
    cliente: `Cliente ${input.sedeId}`,
    importoTotale: 5_000,
  });
  upsertFatture(
    [
      {
        id: input.ficId,
        numero: `${input.ficId}/A`,
        data: "2026-08-01",
        clienteNome: `Cliente ${input.sedeId}`,
        clienteVat: null,
        clienteCf: null,
        importoNetto: 1_000,
        importoLordo: 1_220,
        rate: input.rate ?? [
          {
            id: 444,
            sourceKey: "rate:444",
            importo: 1_220,
            scadenza: "2026-08-20",
            stato: "paid",
            dataPagamento: "2026-08-20",
          },
        ],
      },
    ],
    input.sedeId
  );
  const fattura = ficFatture.find(
    item => item.sedeId === input.sedeId && item.id === input.ficId
  )!;
  fattura.commessaId = commessa.id;
  fattura.commessaMatch = "manuale";
  fattura.collegataAMano = true;
  const stored = getCommesseStore().find(item => item.id === commessa.id)!;
  return { caller, commessa: stored, fattura };
}

describe("riconciliazione pagamenti FiC", () => {
  it("crea una sola riga FiC dopo due riconciliazioni identiche", async () => {
    const sedeId = 201;
    const { commessa } = await setupInvoice({
      sedeId,
      ficId: 201_001,
    });
    const now = new Date("2026-08-21T10:00:00.000Z");

    const first = riconciliaPagamentiFic({
      sedeId,
      snapshotCompleto: true,
      now,
    });
    const second = riconciliaPagamentiFic({
      sedeId,
      snapshotCompleto: true,
      now,
    });

    expect(first.stats.pagamentiCreati).toBe(1);
    expect(second.stats.pagamentiCreati).toBe(0);
    expect(second.stats.pagamentiAggiornati).toBe(0);
    expect(commessa.pagamenti).toHaveLength(1);
    expect(commessa.pagamenti[0]).toMatchObject({
      origine: "fic",
      stato: "attivo",
      ficDocumentoId: 201_001,
      ficRataId: 444,
      ficSourceKey: "rate:444",
    });
    expect(commessa.importoIncassato).toBe(1_220);
    expect(
      ficPaymentLinks.filter(
        link => link.sedeId === sedeId && link.ficDocumentoId === 201_001
      )
    ).toHaveLength(1);
  });

  it("collega un manuale con data nulla senza duplicarlo", async () => {
    const sedeId = 202;
    const { caller, commessa } = await setupInvoice({
      sedeId,
      ficId: 202_001,
    });
    await caller.commesse.addPagamento({
      commessaId: commessa.id,
      importo: 1_220,
      data: null,
    });

    const result = riconciliaPagamentiFic({
      sedeId,
      snapshotCompleto: true,
      now: new Date("2026-08-21T10:00:00.000Z"),
    });

    expect(commessa.pagamenti).toHaveLength(1);
    expect(commessa.importoIncassato).toBe(1_220);
    expect(result.stats.pagamentiCreati).toBe(0);
    expect(result.issues).toEqual([
      expect.objectContaining({
        tipo: "correggi_manuale",
        pagamentoId: commessa.pagamenti[0].id,
        patch: { data: "2026-08-20" },
      }),
    ]);
  });

  it("non riusa lo stesso pagamento manuale per due rate della fattura", async () => {
    const sedeId = 210;
    const { caller, commessa, fattura } = await setupInvoice({
      sedeId,
      ficId: 210_001,
      rate: [
        {
          id: 701,
          sourceKey: "rate:701",
          importo: 1_762.67,
          scadenza: "2026-01-26",
          stato: "paid",
          dataPagamento: "2026-01-26",
        },
        {
          id: 702,
          sourceKey: "rate:702",
          importo: 1_410.14,
          scadenza: "2026-02-10",
          stato: "paid",
          dataPagamento: "2026-02-10",
        },
      ],
    });
    await caller.commesse.addPagamento({
      commessaId: commessa.id,
      importo: 1_762.67,
      data: "2026-01-26",
      note: `Fattura FIC ${fattura.numero} — prima rata`,
    });

    const result = riconciliaPagamentiFic({
      sedeId,
      snapshotCompleto: true,
      now: new Date("2026-08-26T14:00:00.000Z"),
    });

    expect(result.issues).toEqual([]);
    expect(commessa.pagamenti).toHaveLength(2);
    expect(commessa.pagamenti[0]).toMatchObject({
      origine: "manuale",
      importo: 1_762.67,
      data: "2026-01-26",
      stato: "attivo",
    });
    expect(commessa.pagamenti[1]).toMatchObject({
      origine: "fic",
      importo: 1_410.14,
      data: "2026-02-10",
      ficSourceKey: "rate:702",
      stato: "attivo",
    });
    expect(commessa.importoIncassato).toBe(3_172.81);

    const activeLinks = ficPaymentLinks.filter(
      link =>
        link.sedeId === sedeId &&
        link.ficDocumentoId === 210_001 &&
        link.stato !== "superata"
    );
    expect(activeLinks).toHaveLength(2);
    expect(new Set(activeLinks.map(link => link.pagamentoId)).size).toBe(2);
  });

  it("ripara due link storici che riusano lo stesso pagamento manuale", async () => {
    const sedeId = 211;
    const { caller, commessa, fattura } = await setupInvoice({
      sedeId,
      ficId: 211_001,
      rate: [
        {
          id: 801,
          sourceKey: "rate:801",
          importo: 1_762.67,
          scadenza: "2026-01-26",
          stato: "paid",
          dataPagamento: "2026-01-26",
        },
        {
          id: 802,
          sourceKey: "rate:802",
          importo: 1_410.14,
          scadenza: "2026-02-10",
          stato: "paid",
          dataPagamento: "2026-02-10",
        },
      ],
    });
    await caller.commesse.addPagamento({
      commessaId: commessa.id,
      importo: 1_762.67,
      data: "2026-01-26",
      note: `Fattura FIC ${fattura.numero} — prima rata`,
    });
    const pagamentoId = commessa.pagamenti[0].id;
    confermaRiconciliazioneManuale({
      sedeId,
      ficDocumentoId: fattura.id,
      ficSourceKey: "rate:801",
      commessaId: commessa.id,
      pagamentoId,
    });
    confermaRiconciliazioneManuale({
      sedeId,
      ficDocumentoId: fattura.id,
      ficSourceKey: "rate:802",
      commessaId: commessa.id,
      pagamentoId,
    });

    const result = riconciliaPagamentiFic({
      sedeId,
      snapshotCompleto: true,
      now: new Date("2026-08-26T14:30:00.000Z"),
    });

    expect(result.issues).toEqual([]);
    expect(commessa.pagamenti).toHaveLength(2);
    expect(commessa.pagamenti[0]).toMatchObject({
      origine: "manuale",
      importo: 1_762.67,
      data: "2026-01-26",
      stato: "attivo",
    });
    expect(commessa.pagamenti[1]).toMatchObject({
      origine: "fic",
      importo: 1_410.14,
      data: "2026-02-10",
      ficSourceKey: "rate:802",
      stato: "attivo",
    });
    expect(commessa.importoIncassato).toBe(3_172.81);
    expect(
      ficPaymentLinks.find(
        link =>
          link.sedeId === sedeId &&
          link.ficDocumentoId === fattura.id &&
          link.ficSourceKey === "rate:801" &&
          link.target === "manuale"
      )?.stato
    ).toBe("confermata");
    expect(
      ficPaymentLinks.find(
        link =>
          link.sedeId === sedeId &&
          link.ficDocumentoId === fattura.id &&
          link.ficSourceKey === "rate:802" &&
          link.target === "manuale"
      )?.stato
    ).toBe("superata");
    expect(
      ficPaymentLinks.some(
        link =>
          link.sedeId === sedeId &&
          link.ficDocumentoId === fattura.id &&
          link.ficSourceKey === "rate:802" &&
          link.target === "fic" &&
          link.stato === "confermata"
      )
    ).toBe(true);
  });

  it("non scrive quando due manuali sono compatibili", async () => {
    const sedeId = 203;
    const { caller, commessa } = await setupInvoice({
      sedeId,
      ficId: 203_001,
    });
    await caller.commesse.addPagamento({
      commessaId: commessa.id,
      importo: 1_220,
      data: "2026-08-20",
    });
    await caller.commesse.addPagamento({
      commessaId: commessa.id,
      importo: 1_220,
      data: "2026-08-20",
    });

    const result = riconciliaPagamentiFic({
      sedeId,
      snapshotCompleto: true,
      now: new Date("2026-08-21T10:00:00.000Z"),
    });

    expect(commessa.pagamenti).toHaveLength(2);
    expect(result.stats.ambiguita).toBe(1);
    expect(result.issues[0]).toMatchObject({
      tipo: "scegli_manuale",
      candidati: [
        { pagamentoId: commessa.pagamenti[0].id },
        { pagamentoId: commessa.pagamenti[1].id },
      ],
    });
    expect(
      ficPaymentLinks.filter(
        link => link.sedeId === sedeId && link.ficDocumentoId === 203_001
      )
    ).toHaveLength(0);
  });

  it("storna e riattiva la stessa rata FiC senza cancellarla", async () => {
    const sedeId = 204;
    const { commessa, fattura } = await setupInvoice({
      sedeId,
      ficId: 204_001,
    });
    const now = new Date("2026-08-21T10:00:00.000Z");
    riconciliaPagamentiFic({ sedeId, snapshotCompleto: true, now });

    fattura.rate[0].stato = "reversed";
    const reversed = riconciliaPagamentiFic({
      sedeId,
      snapshotCompleto: true,
      now: new Date("2026-08-22T10:00:00.000Z"),
    });

    expect(reversed.stats.pagamentiStornati).toBe(1);
    expect(commessa.pagamenti).toHaveLength(1);
    expect(commessa.pagamenti[0].stato).toBe("stornato");
    expect(commessa.importoIncassato).toBe(0);

    fattura.rate[0].stato = "paid";
    const paidAgain = riconciliaPagamentiFic({
      sedeId,
      snapshotCompleto: true,
      now: new Date("2026-08-23T10:00:00.000Z"),
    });
    expect(paidAgain.stats.pagamentiRiattivati).toBe(1);
    expect(commessa.pagamenti).toHaveLength(1);
    expect(commessa.pagamenti[0].stato).toBe("attivo");
    expect(commessa.importoIncassato).toBe(1_220);
  });

  it("storna una rata rimossa soltanto dopo snapshot completo", async () => {
    const sedeId = 205;
    const { commessa, fattura } = await setupInvoice({
      sedeId,
      ficId: 205_001,
    });
    const now = new Date("2026-08-21T10:00:00.000Z");
    riconciliaPagamentiFic({ sedeId, snapshotCompleto: true, now });
    fattura.rate = [];

    riconciliaPagamentiFic({
      sedeId,
      snapshotCompleto: false,
      now: new Date("2026-08-22T10:00:00.000Z"),
    });
    expect(commessa.pagamenti[0].stato).toBe("attivo");

    const complete = riconciliaPagamentiFic({
      sedeId,
      snapshotCompleto: true,
      now: new Date("2026-08-23T10:00:00.000Z"),
    });
    expect(complete.stats.pagamentiStornati).toBe(1);
    expect(commessa.pagamenti[0].stato).toBe("stornato");
    expect(commessa.importoIncassato).toBe(0);
  });

  it("storna le rate quando la fattura sparisce da uno snapshot completo", async () => {
    const sedeId = 209;
    const { commessa, fattura } = await setupInvoice({
      sedeId,
      ficId: 209_001,
    });
    riconciliaPagamentiFic({
      sedeId,
      snapshotCompleto: true,
      now: new Date("2026-08-21T10:00:00.000Z"),
    });
    fattura.presenteInFic = false;

    const result = riconciliaPagamentiFic({
      sedeId,
      snapshotCompleto: true,
      now: new Date("2026-08-22T10:00:00.000Z"),
    });

    expect(result.stats.pagamentiStornati).toBe(1);
    expect(commessa.pagamenti[0].stato).toBe("stornato");
    expect(commessa.importoIncassato).toBe(0);
  });

  it("non storna un manuale automaticamente quando FiC revoca la rata", async () => {
    const sedeId = 206;
    const { caller, commessa, fattura } = await setupInvoice({
      sedeId,
      ficId: 206_001,
    });
    await caller.commesse.addPagamento({
      commessaId: commessa.id,
      importo: 1_220,
      data: "2026-08-20",
    });
    riconciliaPagamentiFic({
      sedeId,
      snapshotCompleto: true,
      now: new Date("2026-08-21T10:00:00.000Z"),
    });
    fattura.rate[0].stato = "reversed";

    const result = riconciliaPagamentiFic({
      sedeId,
      snapshotCompleto: true,
      now: new Date("2026-08-22T10:00:00.000Z"),
    });

    expect(commessa.pagamenti[0].stato).toBe("attivo");
    expect(commessa.importoIncassato).toBe(1_220);
    expect(result.issues).toEqual([
      expect.objectContaining({
        tipo: "correggi_manuale",
        pagamentoId: commessa.pagamenti[0].id,
        patch: { stato: "stornato" },
      }),
    ]);
  });

  it("sposta i movimenti FiC lasciando audit nella vecchia commessa", async () => {
    const sedeId = 207;
    const {
      caller,
      commessa: oldCommessa,
      fattura,
    } = await setupInvoice({
      sedeId,
      ficId: 207_001,
    });
    riconciliaPagamentiFic({
      sedeId,
      snapshotCompleto: true,
      now: new Date("2026-08-21T10:00:00.000Z"),
    });
    const newCommessa = await caller.commesse.create({
      cliente: "Nuova destinazione",
      importoTotale: 5_000,
    });
    const storedNew = getCommesseStore().find(
      item => item.id === newCommessa.id
    )!;
    fattura.commessaId = newCommessa.id;

    const result = riconciliaPagamentiFic({
      sedeId,
      snapshotCompleto: true,
      now: new Date("2026-08-22T10:00:00.000Z"),
    });

    expect(result.stats.pagamentiStornati).toBe(1);
    expect(result.stats.pagamentiCreati).toBe(1);
    expect(oldCommessa.pagamenti[0].stato).toBe("stornato");
    expect(oldCommessa.importoIncassato).toBe(0);
    expect(storedNew.pagamenti).toHaveLength(1);
    expect(storedNew.pagamenti[0]).toMatchObject({
      origine: "fic",
      stato: "attivo",
      ficSourceKey: "rate:444",
    });
    expect(storedNew.importoIncassato).toBe(1_220);
  });

  it("non sposta il manuale ma segnala il cambio commessa", async () => {
    const sedeId = 208;
    const {
      caller,
      commessa: oldCommessa,
      fattura,
    } = await setupInvoice({
      sedeId,
      ficId: 208_001,
    });
    await caller.commesse.addPagamento({
      commessaId: oldCommessa.id,
      importo: 1_220,
      data: "2026-08-20",
    });
    riconciliaPagamentiFic({
      sedeId,
      snapshotCompleto: true,
      now: new Date("2026-08-21T10:00:00.000Z"),
    });
    const newCommessa = await caller.commesse.create({
      cliente: "Nuova destinazione manuale",
      importoTotale: 5_000,
    });
    const storedNew = getCommesseStore().find(
      item => item.id === newCommessa.id
    )!;
    fattura.commessaId = newCommessa.id;

    const result = riconciliaPagamentiFic({
      sedeId,
      snapshotCompleto: true,
      now: new Date("2026-08-22T10:00:00.000Z"),
    });

    expect(oldCommessa.pagamenti[0].stato).toBe("attivo");
    expect(oldCommessa.importoIncassato).toBe(1_220);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        tipo: "verifica_spostamento",
        commessaId: oldCommessa.id,
        pagamentoId: oldCommessa.pagamenti[0].id,
      })
    );
    expect(storedNew.pagamenti).toHaveLength(1);
    expect(storedNew.pagamenti[0]).toMatchObject({
      origine: "fic",
      stato: "attivo",
      ficSourceKey: "rate:444",
    });
  });
});
