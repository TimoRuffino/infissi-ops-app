import { describe, expect, it } from "vitest";
import {
  riferimentiOrdineDocumento,
  riscontroCommessaNelTesto,
  stessoOrdine,
} from "./riscontroCommessa";

// Il testo che la pipeline legge da una conferma Alias vera (04/09/2026):
// il cliente compare come «VS.RIFERIMENTO GIACOMAZZI GIUL», troncato.
const ALIAS = [
  "Conferma Ordine",
  "ALIAS Srl Porte blindate",
  "RUFFINO GROUP SRLS",
  "2026 - CV 003746 23/02/2026del",
  "VS.RIFERIMENTO",
  "GIACOMAZZI GIUL",
  "Approntamento [1]",
  "2026 Settimana 21",
  "KPO44 KIT PORTA",
].join("\n");

describe("riscontroCommessaNelTesto", () => {
  it("il cognome del cliente nel testo basta, anche con il nome troncato", () => {
    const r = riscontroCommessaNelTesto(ALIAS, {
      codice: "COM-2026-096",
      cliente: "Giacomazzi Giulia",
    });
    expect(r.ok).toBe(true);
    expect(r.prove).toEqual(["cliente giacomazzi"]);
  });

  it("l'oggetto della mail non conta: un documento che non cita la commessa non passa", () => {
    const r = riscontroCommessaNelTesto(ALIAS, {
      codice: "COM-2026-097",
      cliente: "Rossi Mario",
      indirizzo: "Via Garibaldi 4",
      citta: "Sarzana",
    });
    expect(r.ok).toBe(false);
    expect(r.motivo).toContain("non cita");
  });

  it("codice commessa, indirizzo del cantiere o ordine noto sono riscontri validi", () => {
    expect(
      riscontroCommessaNelTesto("Rif. commessa COM-2026-096 del cliente", {
        codice: "COM-2026-096",
        cliente: "Nessuno Qui",
      }).prove
    ).toEqual(["codice COM-2026-096"]);
    expect(
      riscontroCommessaNelTesto("Consegna in Via Fratelli Rosselli 12, Lerici", {
        codice: null,
        cliente: "Bianchi",
        indirizzo: "Via Fratelli Rosselli 12",
        citta: "Lerici",
      }).ok
    ).toBe(true);
    expect(
      riscontroCommessaNelTesto("Vs. ordine n. CO-4471 del 01/09", {
        codice: null,
        cliente: "Verdi",
        riferimentiOrdine: ["CO 4471"],
      }).prove
    ).toEqual(["ordine CO 4471"]);
  });

  it("le parole generiche della ragione sociale non identificano nessuno", () => {
    const r = riscontroCommessaNelTesto("Spett.le Condominio Via Roma, ordine confermato", {
      codice: null,
      cliente: "Condominio Via Roma",
    });
    expect(r.ok).toBe(false);
  });
});

describe("riferimenti d'ordine e duplicati", () => {
  it("tre copie dello stesso ordine condividono il numero nel nome del file", () => {
    const a = riferimentiOrdineDocumento({ nomeFile: "Ordini_di_Vendi_1602923(1).pdf" });
    const b = riferimentiOrdineDocumento({ nomeFile: "Ordini_di_Vendi_1602923(1) (3).pdf" });
    const c = riferimentiOrdineDocumento({ nomeFile: "Ordini_di_Vendi_1606338(1).pdf" });
    expect(a).toEqual(["1602923"]);
    expect(stessoOrdine(a, b)).toBe("1602923");
    expect(stessoOrdine(a, c)).toBeNull();
  });

  it("il riferimento letto nel testo si aggiunge a quello del nome", () => {
    const r = riferimentiOrdineDocumento({
      nomeFile: "conferma.pdf",
      riferimentoOrdine: "CV 003746",
      numeroConferma: null,
    });
    expect(r).toEqual(["cv003746"]);
  });
});
