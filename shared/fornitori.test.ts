// I nomi dei fornitori come li scrivono i PDF e le mail, ricondotti al nome
// aziendale (07/09/2026: dieci nomi per Alias nel magazzino, referenti e
// agenti presi per fornitori).

import { describe, expect, it } from "vitest";
import { FORNITORI, fornitoreNoto, normalizzaFornitore } from "./fornitori";

describe("normalizzaFornitore", () => {
  it("riconosce il fornitore dal testo della conferma, comunque scritto", () => {
    expect(normalizzaFornitore("ALIAS Srl Porte blindate")).toBe("Alias");
    expect(normalizzaFornitore("Alias")).toBe("Alias");
    expect(normalizzaFornitore("OSKURA SRL")).toBe("Oskura");
    expect(normalizzaFornitore("Brianzatende Srl")).toBe("Brianzatende");
    expect(normalizzaFornitore("BRIANZA TENDE S.R.L.")).toBe("Brianzatende");
    expect(normalizzaFornitore("Henry glass s.r.l.")).toBe("Henry Glass");
    expect(normalizzaFornitore("HenryGlass")).toBe("Henry Glass");
    expect(normalizzaFornitore("PAIL SERRAMENTI - Domenico Cinalli")).toBe("Pail");
    expect(normalizzaFornitore("Primed s.r.l.")).toBe("Primed");
    expect(normalizzaFornitore("ferramentafivizzanese.it")).toBe("Fivizzanese");
    expect(normalizzaFornitore("Wnd")).toBe("Wnd");
    expect(normalizzaFornitore("BT Glass . Ordini")).toBe("BT Glass");
    // L'agenzia che firma le conferme Alias, anche senza la mail.
    expect(normalizzaFornitore("DE - DOOR DESIGN S.R.L. Veronica Gregori CECCONI")).toBe("Alias");
  });

  it("riconosce il fornitore dal dominio della mail quando il testo è un agente o un referente", () => {
    expect(
      normalizzaFornitore("DE - DOOR DESIGN S.R.L. Veronica Gregori CECCONI", "v.gregori@aliasblindate.com")
    ).toBe("Alias");
    expect(normalizzaFornitore("REFERENTE Natascia De Biasi -", "ordini@pailporte.com")).toBe("Pail");
    expect(normalizzaFornitore(null, "vendite@oskura.it")).toBe("Oskura");
    expect(fornitoreNoto("qualunque", "paola.cattai@henryglass.it")).toBe("Henry Glass");
  });

  it("un referente senza dominio noto non è un fornitore; un nome sconosciuto resta, ripulito", () => {
    expect(normalizzaFornitore("REFERENTE Natascia De Biasi -")).toBeNull();
    expect(normalizzaFornitore("Sig. Mario Rossi")).toBeNull();
    expect(normalizzaFornitore("")).toBeNull();
    expect(normalizzaFornitore(null)).toBeNull();
    expect(normalizzaFornitore("Palmira Iacobitti")).toBe("Palmira Iacobitti");
    expect(normalizzaFornitore("Vetreria Ligure Srl - Ufficio ordini")).toBe("Vetreria Ligure Srl");
    // Due lettere non sono un nome: si passa al segmento dopo.
    expect(normalizzaFornitore("XY - Vetreria Ligure Srl")).toBe("Vetreria Ligure Srl");
  });

  it("le chiavi corte valgono solo come parola intera («wnd» non è dentro «downdraft»)", () => {
    expect(fornitoreNoto("sistema downdraft per cucine")).toBeNull();
    expect(fornitoreNoto("Aliasi Srl")).toBeNull();
  });

  it("la lista dei nomi è quella dei filtri, senza doppioni", () => {
    expect(new Set(FORNITORI).size).toBe(FORNITORI.length);
    expect(FORNITORI).toContain("Alias");
    expect(FORNITORI).toContain("Pail");
  });
});
