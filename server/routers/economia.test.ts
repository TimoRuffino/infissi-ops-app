import { describe, expect, it } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import { ficFatture, upsertDocumentiEmessi } from "./ficFatture";
import { ficCosti, upsertCostiFic } from "./ficCosti";
import { getCommesseStore } from "./commesse";

function ctx(sedeId: number): TrpcContext {
  return {
    user: {
      id: sedeId,
      openId: `economia-router-${sedeId}`,
      name: "Direzione",
      email: `economia-router-${sedeId}@example.test`,
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

describe("economia FiC", () => {
  it("esclude i pagamenti stornati dai totali CRM", async () => {
    const sedeId = 92;
    const caller = appRouter.createCaller(ctx(sedeId));
    const commessa = await caller.commesse.create({
      cliente: "Cliente storni",
      importoTotale: 1_000,
    });
    await caller.commesse.addPagamento({
      commessaId: commessa.id,
      importo: 300,
      data: "2026-04-15",
    });
    await caller.commesse.addPagamento({
      commessaId: commessa.id,
      importo: 100,
      data: "2026-04-16",
    });
    const stored = getCommesseStore().find(item => item.id === commessa.id)!;
    stored.pagamenti[1].stato = "stornato";

    const overview = await caller.economia.overview({ anno: 2026 });

    expect(overview.crm.incassato).toBe(300);
    expect(overview.confrontoIncassi.crm).toBe(300);
  });

  it("impedisce modifica e rimozione manuale di un pagamento FiC", async () => {
    const sedeId = 93;
    const caller = appRouter.createCaller(ctx(sedeId));
    const commessa = await caller.commesse.create({
      cliente: "Cliente immutabile",
      importoTotale: 1_000,
    });
    await caller.commesse.addPagamento({
      commessaId: commessa.id,
      importo: 500,
      data: "2026-04-15",
    });
    const stored = getCommesseStore().find(item => item.id === commessa.id)!;
    Object.assign(stored.pagamenti[0], {
      origine: "fic",
      ficDocumentoId: 9301,
      ficRataId: 44,
      ficSourceKey: "rate:44",
    });

    await expect(
      caller.commesse.updatePagamento({
        commessaId: commessa.id,
        pagamentoId: stored.pagamenti[0].id,
        importo: 600,
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      caller.commesse.removePagamento({
        commessaId: commessa.id,
        pagamentoId: stored.pagamenti[0].id,
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("separa contratti CRM, vendite FiC e acquisti FiC", async () => {
    const sedeId = 91;
    const caller = appRouter.createCaller(ctx(sedeId));
    const commessa = await caller.commesse.create({
      cliente: "Cliente economia",
      importoTotale: 5_000,
    });
    await caller.commesse.addCosto({
      commessaId: commessa.id,
      importo: 999,
      fornitore: "Costo manuale",
    });
    await caller.commesse.addPagamento({
      commessaId: commessa.id,
      importo: 300,
      data: "2026-04-15",
    });
    await caller.commesse.addPagamento({
      commessaId: commessa.id,
      importo: 50,
      data: null,
    });
    await caller.commesse.addPagamento({
      commessaId: commessa.id,
      importo: 25,
      data: "2026-19-01",
    });
    const commessaArchiviata = await caller.commesse.create({
      cliente: "Cliente storico economia",
      importoTotale: 2_000,
    });
    await caller.commesse.addPagamento({
      commessaId: commessaArchiviata.id,
      importo: 400,
      data: "2026-04-18",
    });
    await caller.commesse.archive(commessaArchiviata.id);
    const callerAltraSede = appRouter.createCaller(ctx(190));
    const commessaAltraSede = await callerAltraSede.commesse.create({
      cliente: "Cliente altra sede economia",
      importoTotale: 9_000,
    });
    await callerAltraSede.commesse.addPagamento({
      commessaId: commessaAltraSede.id,
      importo: 9_000,
      data: "2026-04-19",
    });
    await callerAltraSede.commesse.archive(commessaAltraSede.id);

    upsertDocumentiEmessi(
      [
        {
          id: 89101,
          tipo: "invoice",
          numero: "91/A",
          data: "2026-04-10",
          clienteNome: "Cliente economia",
          clienteVat: null,
          clienteCf: null,
          importoNetto: 1_000,
          importoIva: 220,
          importoLordo: 1_220,
          rate: [
            {
              importo: 600,
              stato: "paid",
              scadenza: null,
              dataPagamento: "2026-04-12",
            },
            {
              importo: 620,
              stato: "not_paid",
              scadenza: "2026-05-10",
              dataPagamento: null,
            },
          ],
        },
        {
          id: 89102,
          tipo: "credit_note",
          numero: "NC-91",
          data: "2026-04-20",
          clienteNome: "Cliente economia",
          clienteVat: null,
          clienteCf: null,
          importoNetto: 100,
          importoIva: 22,
          importoLordo: 122,
          rate: [],
        },
      ],
      sedeId,
      "overview-emessi"
    );
    upsertCostiFic(
      [
        {
          id: 89201,
          tipo: "expense",
          data: "2026-04-11",
          fornitoreId: 1,
          fornitoreNome: "Fornitore FiC",
          categoriaFic: "Materiali",
          descrizione: "Materiali",
          centro: null,
          numeroDocumento: "C-1",
          importoNetto: 400,
          importoIva: 88,
          importoLordo: 488,
          rate: [],
        },
        {
          id: 89202,
          tipo: "passive_credit_note",
          data: "2026-04-21",
          fornitoreId: 1,
          fornitoreNome: "Fornitore FiC",
          categoriaFic: "Materiali",
          descrizione: "Reso",
          centro: null,
          numeroDocumento: "NC-C-1",
          importoNetto: 50,
          importoIva: 11,
          importoLordo: 61,
          rate: [],
        },
      ],
      sedeId,
      "overview-costi"
    );

    const overview = await caller.economia.overview({ anno: 2026 });

    expect(overview.crm.pattuito).toBe(5_000);
    expect(overview.crm.incassato).toBe(375);
    expect(overview.crm.costiManualiStimati).toBe(999);
    expect(overview.confrontoIncassi).toMatchObject({
      disponibile: true,
      crm: 700,
      fic: 600,
      scostamento: 100,
      crmSenzaData: 75,
      pagamentiCrmSenzaData: 2,
      ficSenzaData: 0,
      rateFicSenzaData: 0,
    });
    expect(overview.vendite).toMatchObject({
      netto: 900,
      iva: 198,
      lordo: 1_098,
      incassato: 600,
      daIncassare: 620,
      fatture: 1,
      noteCredito: 1,
    });
    expect(overview.acquisti).toMatchObject({
      netto: 350,
      iva: 77,
      lordo: 427,
      documenti: 2,
    });
    expect(overview.acquisti.netto).not.toBe(999);
    expect(overview.mesi[3]).toMatchObject({
      venditeNetto: 900,
      acquistiNetto: 350,
      incassiCrm: 700,
    });
  });

  it("mantiene le fatture escluse dalla riconciliazione nei totali FiC", async () => {
    const sedeId = 93;
    const caller = appRouter.createCaller(ctx(sedeId));
    upsertDocumentiEmessi(
      [
        {
          id: 89601,
          tipo: "invoice",
          numero: "93/IGN",
          data: "2026-06-10",
          clienteNome: "Cliente escluso dalla riconciliazione",
          clienteVat: null,
          clienteCf: null,
          importoNetto: 200,
          importoIva: 44,
          importoLordo: 244,
          rate: [],
        },
      ],
      sedeId,
      "overview-ignorata"
    );
    const fattura = ficFatture.find(
      documento => documento.sedeId === sedeId && documento.id === 89601
    );
    if (!fattura) throw new Error("Fixture FiC non creata");
    fattura.ignorata = true;

    const overview = await caller.economia.overview({ anno: 2026 });

    expect(overview.vendite).toMatchObject({
      fatture: 1,
      netto: 200,
      escluseRiconciliazione: 1,
      daRiconciliare: 0,
    });
  });

  it("non presenta come verificato un confronto senza mirror FiC", async () => {
    const sedeId = 94;
    const caller = appRouter.createCaller(ctx(sedeId));
    const overview = await caller.economia.overview({ anno: 2026 });

    expect(overview.confrontoIncassi).toMatchObject({
      disponibile: false,
      crm: 0,
      fic: 0,
      affidabile: false,
    });
  });

  it("non usa i costi FiC classificati senza una conferma nel registro", async () => {
    const now = new Date();
    const anno = now.getFullYear();
    const mese = now.getMonth() + 1;
    const sedeId = 92;
    const caller = appRouter.createCaller(ctx(sedeId));
    const emessi = [];
    const costi = [];
    for (let offset = 3; offset >= 1; offset--) {
      const date = new Date(Date.UTC(anno, mese - 1 - offset, 10));
      const data = date.toISOString().slice(0, 10);
      emessi.push({
        id: 89300 + offset,
        tipo: "invoice" as const,
        numero: `BE-${offset}`,
        data,
        clienteNome: "Cliente break even",
        clienteVat: null,
        clienteCf: null,
        importoNetto: 10_000,
        importoIva: 2_200,
        importoLordo: 12_200,
        rate: [],
      });
      costi.push(
        {
          id: 89400 + offset,
          tipo: "expense" as const,
          data,
          fornitoreId: null,
          fornitoreNome: `Fisso ${offset}`,
          categoriaFic: "Utenze",
          descrizione: null,
          centro: null,
          numeroDocumento: null,
          importoNetto: 1_000,
          importoIva: 220,
          importoLordo: 1_220,
          rate: [],
        },
        {
          id: 89500 + offset,
          tipo: "expense" as const,
          data,
          fornitoreId: null,
          fornitoreNome: `Variabile ${offset}`,
          categoriaFic: "Materiali",
          descrizione: null,
          centro: null,
          numeroDocumento: null,
          importoNetto: 4_000,
          importoIva: 880,
          importoLordo: 4_880,
          rate: [],
        }
      );
    }
    upsertDocumentiEmessi(emessi, sedeId, "break-even-emessi");
    upsertCostiFic(costi, sedeId, "break-even-costi");
    for (const costo of ficCosti.filter(c => c.sedeId === sedeId)) {
      costo.classificazione = costo.fornitoreNome.startsWith("Fisso")
        ? "fisso"
        : "variabile_commessa";
      costo.fonteClassificazione = "utente";
    }

    const risultato = await caller.economia.breakEven({ anno, mese });

    expect(risultato.margineContribuzione).toBeCloseTo(0.6);
    expect(risultato.daCoprireMensile).toBe(0);
    // Registro vuoto: nessun minimo da fatturare. Restituire zero avrebbe
    // detto "obiettivo raggiunto" a chi non ha confermato un solo costo.
    expect(risultato.stato).toBe("dati_insufficienti");
    expect(risultato.obiettivoMensile).toBeNull();
    expect(risultato.motivi.join(" ")).toContain("Nessun costo fisso confermato");
  });
});
