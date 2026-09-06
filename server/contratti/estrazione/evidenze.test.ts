// Test delle evidenze verificate (piano 3, Task 4). Un valore proposto dal
// modello vale solo se la sua citazione esiste DAVVERO nel testo del PDF:
// qui si controlla che la ricerca sopravviva alle differenze di forma che
// il parser introduce (legature «ﬁ», spazi multipli, accenti, apostrofi
// tipografici), che la pagina restituita sia quella vera anche quando il
// modello sbaglia numero, e che un frammento troppo corto o assente non
// produca mai un'evidenza inventata.
//
// Nessun dato reale: pagine sintetiche con un nome inventato.

import { describe, expect, it } from "vitest";
import { campo, normalizzaTesto, verificaEvidenza } from "./evidenze";

// «inﬁssi» = legatura tipografica ﬁ, come la restituisce unpdf su molti PDF.
const PAGINE = [
  [
    "PREVENTIVO N. 127 del 12/03/2026",
    "Cliente: Rossi Mario – Via delle Mimose 4 – Sarzana (SP)",
    "Fornitura di inﬁssi   in PVC per l’abitazione di città",
  ].join("\n"),
  [
    "Totale IVA Inclusa 15.494,72 €",
    "Termini di pagamento: acconto del 50% alla firma",
  ].join("\n"),
];

describe("normalizzaTesto", () => {
  it("minuscola, scioglie le legature, toglie gli accenti e collassa gli spazi", () => {
    expect(normalizzaTesto("  Fornitura di inﬁssi   in PVC\nper l’abitazione di città  ")).toBe(
      "fornitura di infissi in pvc per l'abitazione di citta"
    );
  });

  it("uniforma virgolette tipografiche e apostrofi", () => {
    expect(normalizzaTesto("L’“esempio”")).toBe('l\'"esempio"');
  });
});

describe("verificaEvidenza", () => {
  it("trova il frammento nella pagina indicata nonostante legature e spazi", () => {
    const trovata = verificaEvidenza(PAGINE, 1, "Fornitura di infissi in PVC");
    expect(trovata).not.toBeNull();
    expect(trovata?.pagina).toBe(1);
    // Il frammento restituito è il testo VERO della pagina (legatura compresa),
    // con gli spazi collassati: è quello che l'operatore riconoscerà nel PDF.
    expect(trovata?.frammento).toBe("Fornitura di inﬁssi in PVC");
  });

  it("cerca nelle altre pagine e dichiara la pagina vera quando il modello sbaglia numero", () => {
    const trovata = verificaEvidenza(PAGINE, 1, "totale iva inclusa 15.494,72");
    expect(trovata?.pagina).toBe(2);
    expect(trovata?.frammento).toBe("Totale IVA Inclusa 15.494,72");
  });

  it("porta gli scarti veri del frammento nella pagina (anteprime delle evidenze)", () => {
    const trovata = verificaEvidenza(PAGINE, 2, "totale iva inclusa 15.494,72")!;
    expect(trovata.posizione).toBeTruthy();
    expect(PAGINE[1].slice(trovata.posizione!.inizio, trovata.posizione!.fine)).toBe("Totale IVA Inclusa 15.494,72");
  });

  it("restituisce null quando il frammento non esiste nel documento", () => {
    expect(verificaEvidenza(PAGINE, 1, "Fornitura di serramenti in alluminio")).toBeNull();
  });

  it("restituisce null per un frammento troppo corto (meno di 6 caratteri)", () => {
    expect(verificaEvidenza(PAGINE, 1, "IVA")).toBeNull();
    expect(verificaEvidenza(PAGINE, 1, "  127 ")).toBeNull();
  });

  it("non inventa una pagina fuori intervallo", () => {
    const trovata = verificaEvidenza(PAGINE, 9, "acconto del 50% alla firma");
    expect(trovata?.pagina).toBe(2);
  });
});

describe("campo", () => {
  it("senza evidenza il campo nasce da verificare", () => {
    const c = campo<string | null>(null, null);
    expect(c).toEqual({ valore: null, evidenza: null, daVerificare: true, nota: null });
  });

  it("con evidenza il campo nasce verificato", () => {
    const evidenza = verificaEvidenza(PAGINE, 1, "Fornitura di infissi in PVC");
    const c = campo("PVC", evidenza);
    expect(c.daVerificare).toBe(false);
    expect(c.evidenza?.pagina).toBe(1);
  });

  it("l'opzione esplicita vince sul default e la nota viene conservata", () => {
    const evidenza = verificaEvidenza(PAGINE, 1, "Fornitura di infissi in PVC");
    const c = campo("PVC", evidenza, { daVerificare: true, nota: "dedotto dalla descrizione" });
    expect(c.daVerificare).toBe(true);
    expect(c.nota).toBe("dedotto dalla descrizione");
  });
});

// Fase 4 dello studio (06/09/2026): sul testo trascritto dal modello la
// citazione quasi mai è letterale — «...» per saltare un tratto, « - » fra
// le colonne di una riga ricomposta.
describe("verificaEvidenza — citazioni a pezzi", () => {
  const PAGINA = [
    "Misure Foro (esterno telaio alette escluse):   Prez. Unit.   1.694,97 €",
    "Larghezza: 1390mm - Altezza: 1540mm   Q.tà   2",
    "Metri quadri: 2,14   Sconto   30%",
    "Finestra a 2 ante DX con ribalta   Prez. Tot.   2.173,94 €",
    "Blindato ad un'anta ALIAS STEEL C L 1000 x H 2100 mm € 2.635,00 € 2.108,00",
  ].join("\n");

  it("con i puntini ogni pezzo deve esserci, nell'ordine: l'evidenza va dal primo all'ultimo", () => {
    const e = verificaEvidenza([PAGINA], 1, "Blindato ad un'anta ALIAS STEEL ... L 1000 x H 2100 mm");
    expect(e?.pagina).toBe(1);
    expect(e?.frammento).toBe("Blindato ad un'anta ALIAS STEEL C L 1000 x H 2100 mm");
    expect(verificaEvidenza([PAGINA], 1, "Blindato ad un'anta ... L 3000 x H 2100 mm")).toBeNull();
    // Ordine sbagliato: non è la stessa riga.
    expect(verificaEvidenza([PAGINA], 1, "L 1000 x H 2100 mm ... Blindato ad un'anta ALIAS")).toBeNull();
  });

  it("una riga ricomposta con « - » vale se il 70 % dei pezzi sta nella pagina, vicino", () => {
    const e = verificaEvidenza([PAGINA], 1, "Q.tà 2 - Finestra a 2 ante DX con ribalta - Larghezza: 1390mm - Altezza: 1540mm - Prez. Tot. 2.173,94 €");
    expect(e?.pagina).toBe(1);
    expect(e?.frammento).toContain("Larghezza: 1390mm - Altezza: 1540mm");
    expect(e?.frammento).toContain("Prez. Tot. 2.173,94 €");
    // Pezzi quasi tutti inventati: niente evidenza.
    expect(verificaEvidenza([PAGINA], 1, "Porta scorrevole in legno - Larghezza: 900mm - Altezza: 2100mm - Prez. Tot. 999,00 €")).toBeNull();
  });
});
