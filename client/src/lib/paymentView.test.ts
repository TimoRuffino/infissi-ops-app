import { describe, expect, it } from "vitest";
import { presentFicSyncStats, presentPagamento } from "./paymentView";

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
