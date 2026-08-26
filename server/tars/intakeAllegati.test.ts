// La pre-analisi decide se Tars può proporre subito o deve aprire il file:
// sbagliarla costa un documento archiviato sulla commessa sbagliata, o un
// allegato utile buttato perché "IMG_4821.jpg" non diceva niente.

import { describe, expect, it } from "vitest";
import {
  analizzaAllegatiComunicazione,
  analizzaAllegato,
  rigaAllegatiPerPrompt,
  tipiRiconoscibili,
} from "./intakeAllegati";
import { DOC_TIPI } from "../routers/preventiviContratti";

describe("analizzaAllegato", () => {
  it("legge tipo e cliente da 'misure Rossi'", () => {
    const analisi = analizzaAllegato({ nome: "misure Rossi.pdf" });
    expect(analisi.tipo).toBe("misure");
    expect(analisi.nomiCandidati).toContain("rossi");
    expect(analisi.richiedeLettura).toBe(false);
  });

  it("regge separatori e accenti", () => {
    const analisi = analizzaAllegato({ nome: "Misure_Esecutive-Bianchi.PDF" });
    expect(analisi.tipo).toBe("misure");
    expect(analisi.nomiCandidati).toContain("bianchi");
  });

  it("preferisce il tipo più specifico", () => {
    expect(analizzaAllegato({ nome: "conferma ordine Wnd.pdf" }).tipo).toBe(
      "conferma_ordine"
    );
    expect(analizzaAllegato({ nome: "DDT posa Rossi.pdf" }).tipo).toBe(
      "ddt_posa"
    );
  });

  it("riconosce i tipi che prima finivano in 'altro'", () => {
    expect(
      analizzaAllegato({ nome: "carta d'identita Verdi.jpg" }).tipo
    ).toBe("documento_identita");
    expect(analizzaAllegato({ nome: "planimetria Neri.pdf" }).tipo).toBe(
      "planimetria"
    );
    expect(analizzaAllegato({ nome: "visura camerale.pdf" }).tipo).toBe(
      "visura"
    );
  });

  it("un nome muto chiede la lettura del contenuto", () => {
    for (const nome of [
      "IMG_4821.jpg",
      "scan0003.pdf",
      "documento.pdf",
      "WhatsApp Image 2026-08-26 at 10.11.32.jpeg",
    ]) {
      const analisi = analizzaAllegato({ nome });
      expect(analisi.richiedeLettura).toBe(true);
      expect(analisi.descrizione).toContain("leggi_allegato");
    }
  });

  it("l'oggetto salva un nome muto", () => {
    const analisi = analizzaAllegato({
      nome: "IMG_4821.jpg",
      oggetto: "Misure Rossi via Marconi",
    });
    expect(analisi.tipo).toBe("misure");
    expect(analisi.nomiCandidati).toContain("rossi");
    expect(analisi.richiedeLettura).toBe(false);
  });

  it("il codice commessa basta da solo", () => {
    const analisi = analizzaAllegato({ nome: "COM-2026-035.pdf" });
    expect(analisi.codiceCommessa).toBe("COM-2026-035");
    expect(analisi.richiedeLettura).toBe(false);
  });

  it("un tipo senza riferimento a chi riguarda va comunque aperto", () => {
    const analisi = analizzaAllegato({ nome: "preventivo.pdf" });
    expect(analisi.tipo).toBe("preventivo");
    expect(analisi.richiedeLettura).toBe(true);
  });

  it("non scambia una parola contenuta per il tipo", () => {
    expect(analizzaAllegato({ nome: "lavoro straordinario.pdf" }).tipo).toBe(
      null
    );
  });

  it("scarta le parole che non sono mai un nome", () => {
    const analisi = analizzaAllegato({
      nome: "preventivo definitivo rev 2 Rossi.pdf",
    });
    expect(analisi.nomiCandidati).toEqual(["rossi"]);
  });
});

describe("rigaAllegatiPerPrompt", () => {
  it("numera gli allegati con l'indice reale", () => {
    const riga = rigaAllegatiPerPrompt(
      analizzaAllegatiComunicazione({
        allegati: [{ nome: "misure Rossi.pdf" }, { nome: "IMG_1.jpg" }],
        oggetto: null,
      })
    );
    expect(riga).toContain("[0] misure Rossi.pdf");
    expect(riga).toContain("[1] IMG_1.jpg");
    expect(riga).toContain("leggi_allegato");
  });

  it("senza allegati dice nessuno", () => {
    expect(rigaAllegatiPerPrompt([])).toBe("nessuno");
  });
});

describe("allineamento con i tipi del fascicolo", () => {
  it("ogni tipo riconosciuto esiste in DOC_TIPI", () => {
    for (const tipo of tipiRiconoscibili()) {
      expect(DOC_TIPI).toContain(tipo);
    }
  });
});
