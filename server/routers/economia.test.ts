import { describe, expect, it } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import { upsertDocumentiEmessi } from "./ficFatture";
import { ficCosti, upsertCostiFic } from "./ficCosti";

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
    expect(overview.crm.costiManualiStimati).toBe(999);
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
    });
  });

  it("espone il break-even del mese corrente usando solo costi FiC classificati", async () => {
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

    expect(risultato.stato).toBe("disponibile");
    expect(risultato.affidabilita).toBe("media");
    expect(risultato.margineContribuzione).toBeCloseTo(0.6);
    expect(risultato.obiettivoMensile).toBeCloseTo(1_666.666, 2);
  });
});
