import { describe, expect, it } from "vitest";
import {
  presentFicSyncStats,
  presentPagamento,
  presentPaymentCorrection,
} from "./paymentView";

describe("presentazione pagamenti", () => {
  it("presenta un pagamento FiC stornato come non modificabile", () => {
    expect(
      presentPagamento({
        origine: "fic",
        stato: "stornato",
        ficDocumentoId: 9001,
      })
    ).toEqual({
      origineLabel: "FiC",
      statoLabel: "Stornato",
      canEdit: false,
      canRemove: false,
      fatturaLabel: "Fattura FiC #9001",
    });
  });

  it("mantiene modificabili soltanto i pagamenti manuali", () => {
    expect(
      presentPagamento({ origine: "manuale", stato: "attivo" })
    ).toMatchObject({
      origineLabel: "Manuale",
      statoLabel: "Attivo",
      canEdit: true,
      canRemove: true,
      fatturaLabel: null,
    });
    expect(
      presentPagamento({ origine: "fic", stato: "attivo" })
    ).toMatchObject({ canEdit: false, canRemove: false });
  });
});

describe("presentazione sincronizzazione FiC", () => {
  it("riassume soltanto i contatori non nulli con plurali italiani", () => {
    expect(
      presentFicSyncStats({
        pagamentiCreati: 1,
        correzioniProposte: 2,
        pdfFalliti: 1,
      })
    ).toEqual([
      "1 pagamento importato",
      "2 correzioni proposte",
      "1 PDF da ritentare",
    ]);
  });

  it("distingue aggiornamenti, storni, riconciliazioni e PDF archiviati", () => {
    expect(
      presentFicSyncStats({
        pagamentiAggiornati: 2,
        pagamentiStornati: 1,
        pagamentiRiattivati: 3,
        manualiRiconciliati: 1,
        ambiguita: 2,
        proposteSuperate: 1,
        pdfArchiviati: 4,
      })
    ).toEqual([
      "2 pagamenti aggiornati",
      "1 pagamento stornato",
      "3 pagamenti riattivati",
      "1 pagamento manuale riconciliato",
      "2 ambiguità da verificare",
      "1 proposta superata",
      "4 PDF archiviati",
    ]);
  });

  it("non mostra una lista vuota come attività", () => {
    expect(presentFicSyncStats({})).toEqual([]);
  });
});

describe("presentazione correzione pagamento", () => {
  it("confronta il pagamento CRM con la rata FiC e calcola il delta incassato", () => {
    expect(
      presentPaymentCorrection({
        expectedFingerprint: "1762.67|2026-01-26|attivo",
        patch: { importo: 1_410.14, data: "2026-02-10" },
      })
    ).toEqual({
      current: {
        importo: 1_762.67,
        data: "2026-01-26",
        stato: "attivo",
      },
      proposed: {
        importo: 1_410.14,
        data: "2026-02-10",
        stato: "attivo",
      },
      deltaIncassato: -352.53,
    });
  });

  it("considera uno storno come uscita completa dall'incassato", () => {
    expect(
      presentPaymentCorrection({
        expectedFingerprint: "1220.00|2026-08-20|attivo",
        patch: { stato: "stornato" },
      })
    ).toMatchObject({
      proposed: { importo: 1_220, stato: "stornato" },
      deltaIncassato: -1_220,
    });
  });

  it("non inventa valori correnti se il fingerprint non e leggibile", () => {
    expect(
      presentPaymentCorrection({
        expectedFingerprint: "fingerprint-non-valido",
        patch: { importo: 1_410.14 },
      })
    ).toBeNull();
  });
});
