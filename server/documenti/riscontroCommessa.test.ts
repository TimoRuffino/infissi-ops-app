import { describe, expect, it } from "vitest";
import {
  riferimentiOrdineDocumento,
  riscontroCommessaNelTesto,
  sembraData,
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

  it("la via dell'azienda, la città e le parole comuni di via non sono un indirizzo di cantiere (04/09/2026)", () => {
    const conferma = [
      "Spett.le RUFFINO GROUP SRLS",
      "Via Francesco Crispi 12 - 19124 La Spezia",
      "Conferma d'ordine n. 4471 del 31/07/26",
      "Consegna: c/o Vs. sede",
    ].join("\n");
    // Un cantiere in Via Crispi (la via dell'azienda): non si distingue.
    expect(
      riscontroCommessaNelTesto(conferma, {
        codice: null,
        cliente: "Bianchi Paolo",
        indirizzo: "Via Francesco Crispi 30",
        citta: "La Spezia",
        paroleEscluse: ["Francesco", "Crispi"],
      }).ok
    ).toBe(false);
    // «Via della Chiesa, La Spezia»: «della» e «chiesa» non identificano nessuno.
    expect(
      riscontroCommessaNelTesto(conferma + "\nVia della Chiesa", {
        codice: null,
        cliente: "Verdi Anna",
        indirizzo: "Via della Chiesa 3",
        citta: "La Spezia",
      }).ok
    ).toBe(false);
    // Una via distintiva subito dopo «via» vale, anche con un refuso.
    const r = riscontroCommessaNelTesto(conferma + "\nCantiere: Via Rosselli 8, Lerici", {
      codice: null,
      cliente: "Neri Luca",
      indirizzo: "Via Roselli 8",
      citta: "Lerici",
    });
    expect(r.ok).toBe(true);
    expect(r.prove[0]).toMatch(/^indirizzo roselli lerici/);
    // Una data (31/07/26 → «310726») non è un ordine noto.
    expect(
      riscontroCommessaNelTesto(conferma, {
        codice: null,
        cliente: "Gialli Ugo",
        riferimentiOrdine: ["310726"],
      }).ok
    ).toBe(false);
  });
});

describe("nomi propri e nome completo", () => {
  const ordinePail = [
    "PAIL SERRAMENTI - Conferma ordine 2634169",
    "Spett.le RUFFINO GROUP SRLS Via Francesco Crispi 12 La Spezia",
    "Agente: Stefano Bruni",
    "Rif.: SOST. Angelo Pistone",
    "Porta interna laccata 800x2100",
  ].join("\n");

  it("un nome proprio da solo non identifica un cliente («Via Francesco Crispi» non è il sig. Francesco)", () => {
    expect(
      riscontroCommessaNelTesto(ordinePail, { codice: null, cliente: "Francesco Marini" }).ok
    ).toBe(false);
    // Due nomi propri sparsi nel testo non sono il cliente «Stefano Angelo».
    expect(
      riscontroCommessaNelTesto(ordinePail, { codice: null, cliente: "Stefano Angelo" }).ok
    ).toBe(false);
  });

  it("il nome completo vicino nel testo vale, in qualunque ordine; il cognome dell'anagrafica vale da solo", () => {
    const pieno = riscontroCommessaNelTesto(ordinePail, { codice: null, cliente: "Pistone Angelo" });
    expect(pieno.ok).toBe(true);
    expect(pieno.prove).toEqual(["cliente pistone angelo"]);
    const cognome = riscontroCommessaNelTesto(ordinePail, {
      codice: null,
      cliente: "Angelo Pistone Junior",
      cognome: "Pistone",
    });
    expect(cognome.ok).toBe(true);
    expect(cognome.prove[0]).toMatch(/^cliente pistone/);
    // La via dell'azienda non vale nemmeno come cognome.
    expect(
      riscontroCommessaNelTesto(ordinePail, {
        codice: null,
        cliente: "Crispi Marco",
        paroleEscluse: ["Francesco", "Crispi"],
      }).ok
    ).toBe(false);
  });
});

describe("sembraData", () => {
  it("riconosce le date a sei e otto cifre, non i numeri d'ordine", () => {
    expect(sembraData("310726")).toBe(true);
    expect(sembraData("01092026")).toBe(true);
    expect(sembraData("20260901")).toBe(true);
    expect(sembraData("2634169")).toBe(false);
    expect(sembraData("1684077")).toBe(false);
    expect(sembraData("cv003746")).toBe(false);
    expect(riferimentiOrdineDocumento({ nomeFile: "richiesta bonifico per merce_310726 (2).pdf" })).toEqual([]);
    expect(riferimentiOrdineDocumento({ nomeFile: "conf. montagnana03-08-2026-152737.pdf" })).toEqual(["152737"]);
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
