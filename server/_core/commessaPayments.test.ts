import { describe, expect, it } from "vitest";
import {
  calcolaImportoIncassato,
  fingerprintPagamento,
  normalizzaPagamentoLegacy,
  pagamentoCompatibile,
  ricalcolaImportoIncassato,
} from "./commessaPayments";

describe("commessa payments", () => {
  it("esclude gli storni dall'incassato", () => {
    expect(
      calcolaImportoIncassato([
        { importo: 1_220, stato: "attivo" },
        { importo: 400, stato: "stornato" },
      ])
    ).toBe(1_220);
  });

  it("tratta un record legacy come manuale attivo", () => {
    expect(
      normalizzaPagamentoLegacy({
        id: 1,
        importo: 500,
        data: null,
        createdAt: new Date("2026-08-20T10:00:00.000Z"),
      })
    ).toMatchObject({
      origine: "manuale",
      stato: "attivo",
      ficDocumentoId: null,
      ficRataId: null,
      ficSourceKey: null,
      ficStato: null,
      ficUltimoSyncAt: null,
      stornatoAt: null,
      updatedAt: null,
    });
  });

  it("riconosce un manuale con stesso importo e data mancante", () => {
    expect(
      pagamentoCompatibile(
        normalizzaPagamentoLegacy({ id: 1, importo: 1_220, data: null }),
        { importo: 1_220, dataPagamento: "2026-08-20" }
      )
    ).toBe("data_da_completare");
  });

  it("distingue una corrispondenza esatta da un importo diverso", () => {
    const pagamento = normalizzaPagamentoLegacy({
      id: 1,
      importo: 1_220,
      data: "2026-08-20",
    });
    expect(
      pagamentoCompatibile(pagamento, {
        importo: 1_220,
        dataPagamento: "2026-08-20",
      })
    ).toBe("esatto");
    expect(
      pagamentoCompatibile(pagamento, {
        importo: 1_221,
        dataPagamento: "2026-08-20",
      })
    ).toBe("nessuno");
  });

  it("ricalcola e salva l'incassato sulla commessa", () => {
    const commessa = {
      importoIncassato: 999,
      pagamenti: [
        { importo: 100, stato: "attivo" },
        { importo: 30, stato: "stornato" },
      ],
    };
    expect(ricalcolaImportoIncassato(commessa)).toBe(100);
    expect(commessa.importoIncassato).toBe(100);
  });

  it("produce un fingerprint monetario stabile", () => {
    expect(
      fingerprintPagamento({
        importo: 1220,
        data: "2026-08-20",
        stato: "attivo",
      })
    ).toBe("1220.00|2026-08-20|attivo");
  });
});
