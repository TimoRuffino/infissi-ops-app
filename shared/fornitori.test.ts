// I nomi dei fornitori come li scrivono i PDF e le mail, ricondotti al nome
// aziendale (07/09/2026: dieci nomi per Alias nel magazzino, referenti e
// agenti presi per fornitori).

import { describe, expect, it } from "vitest";
import {
  SEED_FORNITORI_TENANT_1,
  riconoscitoreFornitori,
  type FornitoreRiconoscibile,
} from "./fornitori";

/** Il riconoscitore costruito sul seed: è il comportamento di sempre. */
const r = () => riconoscitoreFornitori(SEED_FORNITORI_TENANT_1);

describe("normalizzaFornitore", () => {
  it("riconosce il fornitore dal testo della conferma, comunque scritto", () => {
    expect(r().normalizza("ALIAS Srl Porte blindate")).toBe("Alias");
    expect(r().normalizza("Alias")).toBe("Alias");
    expect(r().normalizza("OSKURA SRL")).toBe("Oskura");
    expect(r().normalizza("Brianzatende Srl")).toBe("Brianzatende");
    expect(r().normalizza("BRIANZA TENDE S.R.L.")).toBe("Brianzatende");
    expect(r().normalizza("Henry glass s.r.l.")).toBe("Henry Glass");
    expect(r().normalizza("HenryGlass")).toBe("Henry Glass");
    expect(r().normalizza("PAIL SERRAMENTI - Domenico Cinalli")).toBe("Pail");
    expect(r().normalizza("Primed s.r.l.")).toBe("Primed");
    expect(r().normalizza("ferramentafivizzanese.it")).toBe("Fivizzanese");
    expect(r().normalizza("Wnd")).toBe("Wnd");
    expect(r().normalizza("BT Glass . Ordini")).toBe("BT Glass");
    // L'agenzia che firma le conferme Alias, anche senza la mail.
    expect(r().normalizza("DE - DOOR DESIGN S.R.L. Veronica Gregori CECCONI")).toBe("Alias");
  });

  it("riconosce il fornitore dal dominio della mail quando il testo è un agente o un referente", () => {
    expect(
      r().normalizza("DE - DOOR DESIGN S.R.L. Veronica Gregori CECCONI", "v.gregori@aliasblindate.com")
    ).toBe("Alias");
    expect(r().normalizza("REFERENTE Natascia De Biasi -", "ordini@pailporte.com")).toBe("Pail");
    expect(r().normalizza(null, "vendite@oskura.it")).toBe("Oskura");
    expect(r().nome("qualunque", "paola.cattai@henryglass.it")).toBe("Henry Glass");
  });

  it("un referente senza dominio noto non è un fornitore; un nome sconosciuto resta, ripulito", () => {
    expect(r().normalizza("REFERENTE Natascia De Biasi -")).toBeNull();
    expect(r().normalizza("Sig. Mario Rossi")).toBeNull();
    expect(r().normalizza("")).toBeNull();
    expect(r().normalizza(null)).toBeNull();
    expect(r().normalizza("Palmira Iacobitti")).toBe("Palmira Iacobitti");
    expect(r().normalizza("Vetreria Ligure Srl - Ufficio ordini")).toBe("Vetreria Ligure Srl");
    // Due lettere non sono un nome: si passa al segmento dopo.
    expect(r().normalizza("XY - Vetreria Ligure Srl")).toBe("Vetreria Ligure Srl");
  });

  it("le chiavi corte valgono solo come parola intera («wnd» non è dentro «downdraft»)", () => {
    expect(r().nome("sistema downdraft per cucine")).toBeNull();
    expect(r().nome("Aliasi Srl")).toBeNull();
  });

  it("riconduce il portale al fornitore che rappresenta", () => {
    // Antenore è il portale di Wnd/Oknoplast (direzione, 10/09/2026): 94 mail
    // finivano in «Da riconoscere» perché il dominio non è del produttore.
    expect(r().nome(null, "noreply@antenore.biz")).toBe("Wnd");
    expect(r().nome("Antenore", null)).toBe("Wnd");
    expect(r().normalizza("Portale Antenore", "info@antenore.biz")).toBe("Wnd");
    // Un fornitore vero vince sul portale: il suo dominio è più preciso.
    expect(r().nome(null, "ordini@pailporte.com")).toBe("Pail");
    // Un dominio qualunque non diventa un fornitore.
    expect(r().nome(null, "mario@gmail.com")).toBeNull();
  });

  it("il seed non ha doppioni fra i produttori e contiene i fornitori veri", () => {
    const nomi = SEED_FORNITORI_TENANT_1.filter(f => !f.portaleDi).map(f => f.nome);
    expect(new Set(nomi).size).toBe(nomi.length);
    expect(nomi).toContain("Alias");
    expect(nomi).toContain("Pail");
  });

  it("due elenchi diversi riconoscono cose diverse: è il punto di tutto", () => {
    const mio: FornitoreRiconoscibile[] = [
      { nome: "Vetreria Bianchi", chiavi: ["vetreriabianchi", "bianchi"] },
    ];
    const altro = riconoscitoreFornitori(mio);
    expect(altro.nome(null, "ordini@vetreriabianchi.it")).toBe("Vetreria Bianchi");
    // Alias è dei venticinque della Ruffino: qui non esiste.
    expect(altro.nome(null, "v.gregori@aliasblindate.com")).toBeNull();
    // E viceversa.
    expect(r().nome(null, "ordini@vetreriabianchi.it")).toBeNull();
  });

  it("un elenco vuoto non riconosce niente e non esplode", () => {
    const vuoto = riconoscitoreFornitori([]);
    expect(vuoto.nome("Alias", "v.gregori@aliasblindate.com")).toBeNull();
    expect(vuoto.normalizza("ALIAS Srl Porte blindate")).toBe("ALIAS Srl Porte blindate");
    // Un pattern che non può combaciare con NIENTE, mai con tutto:
    // `new RegExp("")` combacerebbe con ogni mittente esistente.
    expect(new RegExp(vuoto.sorgenteMittenti(), "i").test("chiunque@ovunque.it")).toBe(false);
  });
});

describe("sorgenteMittenti", () => {
  const re = () => new RegExp(r().sorgenteMittenti(), "i");

  it("riconosce gli indirizzi dei fornitori veri", () => {
    for (const indirizzo of [
      "amministrazione@primed.it",
      "v.gregori@aliasblindate.com",
      "ordini@pailporte.com",
      "vendite@oskura.it",
      "noreply@antenore.biz",
      "paola.cattai@henryglass.it",
    ]) {
      expect(re().test(indirizzo)).toBe(true);
    }
  });

  it("non riconosce gli indirizzi qualunque", () => {
    for (const indirizzo of ["mario@gmail.com", "info@comune.laspezia.it", "noreply@stripe.com"]) {
      expect(re().test(indirizzo)).toBe(false);
    }
  });
});
