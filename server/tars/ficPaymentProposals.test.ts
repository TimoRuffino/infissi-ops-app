import { describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { fingerprintPagamento } from "../_core/commessaPayments";
import { appRouter } from "../routers";
import { getCommesseStore } from "../routers/commesse";
import { ficFatture, upsertFatture } from "../routers/ficFatture";
import {
  confermaRiconciliazioneManuale,
  type FicPaymentIssue,
} from "../routers/ficPagamenti";
import {
  creaProposteCorrezionePagamento,
  superaProposteFicObsolete,
} from "./ficPaymentProposals";
import { chiaveAzioneProposta, newPropostaId, proposte } from "./stores";

function ctx(sedeId: number): TrpcContext {
  return {
    user: {
      id: sedeId,
      openId: `fic-proposals-${sedeId}`,
      name: "Direzione",
      email: `fic-proposals-${sedeId}@example.test`,
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

async function commessaConPagamento(sedeId: number, importo = 1_220) {
  const caller = appRouter.createCaller(ctx(sedeId));
  const created = await caller.commesse.create({
    cliente: `Correzione FiC ${sedeId}`,
    importoTotale: 5_000,
  });
  await caller.commesse.addPagamento({
    commessaId: created.id,
    importo,
    data: "2026-08-20",
  });
  const commessa = getCommesseStore().find(item => item.id === created.id)!;
  return { caller, commessa };
}

function registraRataFic(input: {
  sedeId: number;
  commessaId: number;
  ficDocumentoId: number;
  ficSourceKey: string;
  importo: number;
  dataPagamento: string | null;
  stato?: string;
}) {
  upsertFatture(
    [
      {
        id: input.ficDocumentoId,
        numero: String(input.ficDocumentoId),
        data: "2026-08-01",
        clienteNome: `Correzione FiC ${input.sedeId}`,
        clienteVat: null,
        clienteCf: null,
        importoNetto: input.importo,
        importoLordo: input.importo,
        rate: [
          {
            id: Number(input.ficSourceKey.replace(/^rate:/, "")) || null,
            sourceKey: input.ficSourceKey,
            importo: input.importo,
            scadenza: input.dataPagamento,
            stato: input.stato ?? "paid",
            dataPagamento: input.dataPagamento,
          },
        ],
      },
    ],
    input.sedeId
  );
  const fattura = ficFatture.find(
    item =>
      item.sedeId === input.sedeId && item.id === input.ficDocumentoId
  )!;
  fattura.commessaId = input.commessaId;
  fattura.commessaMatch = "manuale";
  fattura.collegataAMano = true;
  return fattura;
}

describe("proposte correzione pagamenti FiC", () => {
  it("deduplica la stessa correzione per source key e fingerprint", async () => {
    const sedeId = 401;
    const { commessa } = await commessaConPagamento(sedeId);
    const pagamento = commessa.pagamenti[0];
    const issue: FicPaymentIssue = {
      tipo: "correggi_manuale",
      sedeId,
      commessaId: commessa.id,
      pagamentoId: pagamento.id,
      ficDocumentoId: 401_001,
      ficSourceKey: "rate:444",
      expectedFingerprint: fingerprintPagamento(pagamento),
      patch: { data: "2026-08-21" },
    };

    const first = creaProposteCorrezionePagamento([issue], sedeId);
    const second = creaProposteCorrezionePagamento([issue], sedeId);

    expect(first.create).toBe(1);
    expect(second.create).toBe(0);
    expect(
      proposte.filter(
        proposta =>
          proposta.sedeId === sedeId && proposta.tipo === "correzione_pagamento"
      )
    ).toHaveLength(1);
  });

  it("marca superate le proposte economiche gia soddisfatte", async () => {
    const sedeId = 402;
    const { caller, commessa } = await commessaConPagamento(sedeId);
    const now = new Date("2026-08-26T10:00:00.000Z");
    const candidates = [
      {
        tipo: "pagamento",
        payload: {
          commessaId: commessa.id,
          importo: 1_220,
          data: "2026-08-20",
        },
        titolo: "Registra pagamento gia presente",
      },
      {
        tipo: "modifica_commessa",
        payload: {
          commessaId: commessa.id,
          campi: { importoTotale: 5_000 },
        },
        titolo: "Imposta pattuito gia presente",
      },
    ];
    for (const candidate of candidates) {
      proposte.push({
        id: newPropostaId(),
        sedeId,
        tipo: candidate.tipo,
        titolo: candidate.titolo,
        motivazione: "Storico FiC da risanare.",
        confidenza: "alta",
        payload: candidate.payload,
        commessaId: commessa.id,
        clienteId: null,
        opzioni: null,
        risposta: null,
        stato: "pendente",
        esito: null,
        motivoRifiuto: null,
        esecuzioneId: null,
        trigger: "fic_sync",
        createdAt: new Date("2026-08-25T10:00:00.000Z"),
        decisaAt: null,
        decisaDa: null,
        decisaDaNome: null,
        seguitoAt: null,
        seguitoEsecuzioneId: null,
        origineId: null,
        requestedByUserId: null,
        chiaveAzione: chiaveAzioneProposta({
          ...candidate,
          commessaId: commessa.id,
        }),
        evidenceRefs: [],
        correzioni: [],
      } as any);
    }

    const count = superaProposteFicObsolete(sedeId, now);

    expect(count).toBe(2);
    expect(
      proposte.filter(
        proposta => proposta.sedeId === sedeId && proposta.stato === "superata"
      )
    ).toHaveLength(2);
    await expect(
      caller.tars.proposte.list({ stato: "superata" })
    ).resolves.toHaveLength(2);
  });

  it("supera senza errore una correzione se il pagamento e cambiato", async () => {
    const sedeId = 403;
    const { caller, commessa } = await commessaConPagamento(sedeId);
    const pagamento = commessa.pagamenti[0];
    const issue: FicPaymentIssue = {
      tipo: "correggi_manuale",
      sedeId,
      commessaId: commessa.id,
      pagamentoId: pagamento.id,
      ficDocumentoId: 403_001,
      ficSourceKey: "rate:403",
      expectedFingerprint: fingerprintPagamento(pagamento),
      patch: { data: "2026-08-21" },
    };
    creaProposteCorrezionePagamento([issue], sedeId);
    const proposta = proposte.find(
      item => item.sedeId === sedeId && item.tipo === "correzione_pagamento"
    )!;
    await caller.commesse.updatePagamento({
      commessaId: commessa.id,
      pagamentoId: pagamento.id,
      importo: 1_300,
    });

    await expect(
      caller.tars.proposte.approva({ id: proposta.id })
    ).resolves.toMatchObject({ stato: "superata" });
    expect(proposta.stato).toBe("superata");
    expect(commessa.pagamenti[0].importo).toBe(1_300);
  });

  it("supera la correzione se FiC cambia importo o data della rata", async () => {
    const sedeId = 408;
    const { commessa } = await commessaConPagamento(sedeId);
    const pagamento = commessa.pagamenti[0];
    const fattura = registraRataFic({
      sedeId,
      commessaId: commessa.id,
      ficDocumentoId: 408_001,
      ficSourceKey: "rate:408",
      importo: 1_410.14,
      dataPagamento: "2026-02-10",
    });
    creaProposteCorrezionePagamento(
      [
        {
          tipo: "correggi_manuale",
          sedeId,
          commessaId: commessa.id,
          pagamentoId: pagamento.id,
          ficDocumentoId: fattura.id,
          ficSourceKey: "rate:408",
          expectedFingerprint: fingerprintPagamento(pagamento),
          patch: { importo: 1_410.14, data: "2026-02-10" },
        },
      ],
      sedeId
    );
    const proposta = proposte.find(
      item => item.sedeId === sedeId && item.tipo === "correzione_pagamento"
    )!;
    Object.assign(fattura.rate[0], {
      importo: 1_500,
      dataPagamento: "2026-02-11",
    });

    expect(superaProposteFicObsolete(sedeId)).toBe(1);
    expect(proposta.stato).toBe("superata");
    expect(commessa.pagamenti[0].importo).toBe(1_220);
  });

  it("ricontrolla FiC anche al click e non applica una proposta vecchia", async () => {
    const sedeId = 409;
    const { caller, commessa } = await commessaConPagamento(sedeId);
    const pagamento = commessa.pagamenti[0];
    const fattura = registraRataFic({
      sedeId,
      commessaId: commessa.id,
      ficDocumentoId: 409_001,
      ficSourceKey: "rate:409",
      importo: 1_410.14,
      dataPagamento: "2026-02-10",
    });
    creaProposteCorrezionePagamento(
      [
        {
          tipo: "correggi_manuale",
          sedeId,
          commessaId: commessa.id,
          pagamentoId: pagamento.id,
          ficDocumentoId: fattura.id,
          ficSourceKey: "rate:409",
          expectedFingerprint: fingerprintPagamento(pagamento),
          patch: { importo: 1_410.14, data: "2026-02-10" },
        },
      ],
      sedeId
    );
    const proposta = proposte.find(
      item => item.sedeId === sedeId && item.tipo === "correzione_pagamento"
    )!;
    fattura.rate[0].importo = 1_500;
    const incassatoPrima = commessa.importoIncassato;

    await expect(
      caller.tars.proposte.approva({ id: proposta.id })
    ).resolves.toMatchObject({ stato: "superata" });
    expect(commessa.pagamenti[0].importo).toBe(1_220);
    expect(commessa.importoIncassato).toBe(incassatoPrima);
  });

  it("supera la correzione se la rata FiC e gia collegata a un altro pagamento", async () => {
    const sedeId = 406;
    const { caller, commessa } = await commessaConPagamento(sedeId);
    const pagamentoDaCorreggere = commessa.pagamenti[0];
    await caller.commesse.addPagamento({
      commessaId: commessa.id,
      importo: 1_410.14,
      data: "2026-02-10",
    });
    const pagamentoGiaCollegato = commessa.pagamenti[1];
    const issue: FicPaymentIssue = {
      tipo: "correggi_manuale",
      sedeId,
      commessaId: commessa.id,
      pagamentoId: pagamentoDaCorreggere.id,
      ficDocumentoId: 406_001,
      ficSourceKey: "rate:406",
      expectedFingerprint: fingerprintPagamento(pagamentoDaCorreggere),
      patch: { importo: 1_410.14, data: "2026-02-10" },
    };
    creaProposteCorrezionePagamento([issue], sedeId);
    const proposta = proposte.find(
      item => item.sedeId === sedeId && item.tipo === "correzione_pagamento"
    )!;
    confermaRiconciliazioneManuale({
      sedeId,
      ficDocumentoId: 406_001,
      ficSourceKey: "rate:406",
      commessaId: commessa.id,
      pagamentoId: pagamentoGiaCollegato.id,
    });

    expect(
      superaProposteFicObsolete(
        sedeId,
        new Date("2026-08-26T15:00:00.000Z")
      )
    ).toBe(1);
    expect(proposta.stato).toBe("superata");
  });

  it("blocca l'approvazione stale senza cambiare incassato o pagamenti", async () => {
    const sedeId = 407;
    const { caller, commessa } = await commessaConPagamento(sedeId);
    const pagamentoDaCorreggere = commessa.pagamenti[0];
    const issue: FicPaymentIssue = {
      tipo: "correggi_manuale",
      sedeId,
      commessaId: commessa.id,
      pagamentoId: pagamentoDaCorreggere.id,
      ficDocumentoId: 407_001,
      ficSourceKey: "rate:407",
      expectedFingerprint: fingerprintPagamento(pagamentoDaCorreggere),
      patch: { importo: 1_410.14, data: "2026-02-10" },
    };
    creaProposteCorrezionePagamento([issue], sedeId);
    const proposta = proposte.find(
      item => item.sedeId === sedeId && item.tipo === "correzione_pagamento"
    )!;
    await caller.commesse.addPagamento({
      commessaId: commessa.id,
      importo: 1_410.14,
      data: "2026-02-10",
    });
    const pagamentoGiaCollegato = commessa.pagamenti[1];
    confermaRiconciliazioneManuale({
      sedeId,
      ficDocumentoId: 407_001,
      ficSourceKey: "rate:407",
      commessaId: commessa.id,
      pagamentoId: pagamentoGiaCollegato.id,
    });
    const incassatoPrima = commessa.importoIncassato;

    await expect(
      caller.tars.proposte.approva({ id: proposta.id })
    ).resolves.toMatchObject({ stato: "superata" });
    expect(commessa.pagamenti[0]).toMatchObject({
      importo: 1_220,
      data: "2026-08-20",
      stato: "attivo",
    });
    expect(commessa.pagamenti[1]).toMatchObject({
      importo: 1_410.14,
      data: "2026-02-10",
      stato: "attivo",
    });
    expect(commessa.importoIncassato).toBe(incassatoPrima);
  });

  it("storna il doppione manuale soltanto dopo approvazione", async () => {
    const sedeId = 404;
    const { caller, commessa } = await commessaConPagamento(sedeId);
    await caller.commesse.addPagamento({
      commessaId: commessa.id,
      importo: 1_220,
      data: "2026-08-20",
    });
    const doppione = commessa.pagamenti[1];
    registraRataFic({
      sedeId,
      commessaId: commessa.id,
      ficDocumentoId: 404_001,
      ficSourceKey: "rate:404",
      importo: 1_220,
      dataPagamento: "2026-08-20",
      stato: "not_paid",
    });
    confermaRiconciliazioneManuale({
      sedeId,
      ficDocumentoId: 404_001,
      ficSourceKey: "rate:404",
      commessaId: commessa.id,
      pagamentoId: doppione.id,
    });
    const issue: FicPaymentIssue = {
      tipo: "correggi_manuale",
      sedeId,
      commessaId: commessa.id,
      pagamentoId: doppione.id,
      ficDocumentoId: 404_001,
      ficSourceKey: "rate:404",
      expectedFingerprint: fingerprintPagamento(doppione),
      patch: { stato: "stornato" },
    };
    creaProposteCorrezionePagamento([issue], sedeId);
    const proposta = proposte.find(
      item => item.sedeId === sedeId && item.tipo === "correzione_pagamento"
    )!;

    expect(commessa.importoIncassato).toBe(2_440);
    expect(commessa.pagamenti[1].stato).toBe("attivo");
    await caller.tars.proposte.approva({ id: proposta.id });

    expect(commessa.pagamenti[1].stato).toBe("stornato");
    expect(commessa.importoIncassato).toBe(1_220);
  });

  it("richiede la scelta del manuale ambiguo prima dell'approvazione", async () => {
    const sedeId = 405;
    const { caller, commessa } = await commessaConPagamento(sedeId);
    await caller.commesse.addPagamento({
      commessaId: commessa.id,
      importo: 1_220,
      data: "2026-08-20",
    });
    registraRataFic({
      sedeId,
      commessaId: commessa.id,
      ficDocumentoId: 405_001,
      ficSourceKey: "rate:405",
      importo: 1_220,
      dataPagamento: "2026-08-21",
    });
    const issue: FicPaymentIssue = {
      tipo: "scegli_manuale",
      sedeId,
      commessaId: commessa.id,
      ficDocumentoId: 405_001,
      ficSourceKey: "rate:405",
      candidati: commessa.pagamenti.map((pagamento: any) => ({
        pagamentoId: pagamento.id,
        expectedFingerprint: fingerprintPagamento(pagamento),
        patch: { data: "2026-08-21" },
      })),
    };
    creaProposteCorrezionePagamento([issue], sedeId);
    const proposta = proposte.find(
      item => item.sedeId === sedeId && item.tipo === "correzione_pagamento"
    )!;

    await expect(
      caller.tars.proposte.approva({ id: proposta.id })
    ).rejects.toThrow("Seleziona il pagamento da riconciliare");
    expect(proposta.stato).toBe("pendente");

    await caller.tars.proposte.selezionaPagamentoRiconciliazione({
      id: proposta.id,
      pagamentoId: commessa.pagamenti[1].id,
    });
    await expect(
      caller.tars.proposte.approva({ id: proposta.id })
    ).resolves.toMatchObject({ stato: "approvata" });
    expect(commessa.pagamenti[1].data).toBe("2026-08-21");
  });
});
