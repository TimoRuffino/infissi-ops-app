import { describe, expect, it } from "vitest";
import { controlliCliente, snapshotCliente } from "./cliente";

describe("snapshotCliente", () => {
  it("privato senza PEC → codice destinatario 0000000, provincia dalla città", () => {
    const s = snapshotCliente({ id: 3, tipo: "privato", nome: "Mario", cognome: "Rossi", codiceFiscale: "RSSMRA85T10A562S", indirizzo: "Via Alta 80", cap: "19038", citta: "Sarzana (SP)" }, {});
    expect(s).toMatchObject({ clienteId: 3, nome: "Rossi Mario", provincia: "SP", codiceDestinatario: "0000000", pec: null, ficEntityId: null });
  });
  it("azienda con ragione sociale e P.IVA", () => {
    const s = snapshotCliente({ id: 4, tipo: "azienda", ragioneSociale: "Alfa Srl", nome: "", cognome: "", partitaIva: "01500270119", pec: "alfa@pec.it", codiceDestinatario: "ABC1234", citta: "La Spezia (SP)" }, { indirizzo: "Via X 1" });
    expect(s.nome).toBe("Alfa Srl");
    expect(s.indirizzo).toBe("Via X 1");
    expect(s.codiceDestinatario).toBe("ABC1234");
  });

  // La convenzione del CRM (§5.2 dei requisiti) non ha un campo
  // `ragioneSociale` sul cliente: per aziende, condomini ed enti la
  // denominazione sta tutta in `cognome` e `nome` è uno spazio. Lo
  // snapshot deve ricomporla indivisa, come fa `clienteDisplay` in
  // `server/routers/commesse.ts`.
  it("condominio alla convenzione del CRM: denominazione in cognome, nome uno spazio", () => {
    const s = snapshotCliente({ id: 7, tipo: "condominio", cognome: "Condominio Via Roma 12", nome: " ", codiceFiscale: "80012345678", citta: "Sarzana (SP)", indirizzo: "Via Roma 12", cap: "19038" }, {});
    expect(s.nome).toBe("Condominio Via Roma 12");
    expect(s.tipo).toBe("condominio");
    expect(s.citta).toBe("Sarzana");
  });

  // R19: la pratica edilizia guida la dicitura dell'intervento in fattura
  // (generatore.ts). Il campo esiste sul cliente dal CRM: qui si fotografa
  // com'è, con "nessuna" come default per i record che non l'hanno mai avuto.
  it("la pratica edilizia entra nello snapshot, «nessuna» quando manca o non è riconosciuta", () => {
    const con = (praticaEdilizia: unknown) =>
      snapshotCliente({ id: 3, tipo: "privato", nome: "Mario", cognome: "Rossi", praticaEdilizia }, {}).praticaEdilizia;
    expect(con("cila")).toBe("cila");
    expect(con("scia")).toBe("scia");
    expect(con("cil")).toBe("cil");
    expect(con(undefined)).toBe("nessuna");
    expect(con("permesso_di_costruire")).toBe("nessuna");
    expect(snapshotCliente(null, {}).praticaEdilizia).toBe("nessuna");
  });

  it("senza cliente collegato ricade sui dati della commessa", () => {
    const s = snapshotCliente(null, { cliente: "Bianchi Elena", indirizzo: "Via Alta 80", citta: "Sarzana" });
    expect(s).toMatchObject({ clienteId: null, nome: "Bianchi Elena", tipo: "privato", indirizzo: "Via Alta 80", citta: "Sarzana", provincia: "", cap: "" });
  });
});

describe("controlliCliente", () => {
  const base = { clienteId: 1, nome: "Rossi Mario", tipo: "privato" as const, codiceFiscale: "RSSMRA85T10A562S", partitaIva: null, indirizzo: "Via Alta 80", cap: "19038", citta: "Sarzana", provincia: "SP", email: null, pec: null, codiceDestinatario: "0000000", ficEntityId: null };
  it("privato completo: nessun errore", () => {
    expect(controlliCliente(base, "ristrutturazione").filter(c => c.esito === "errore")).toEqual([]);
  });
  it("CF sbagliato e provincia mancante sono errori", () => {
    const errori = controlliCliente({ ...base, codiceFiscale: "RSSMRA85T10A562T", provincia: "" }, "nessuna").filter(c => c.esito === "errore").map(c => c.codice);
    expect(errori).toEqual(expect.arrayContaining(["cliente_cf", "cliente_provincia"]));
  });
  it("azienda: P.IVA valida e recapito SdI", () => {
    const errori = controlliCliente({ ...base, tipo: "azienda", codiceFiscale: null, partitaIva: "01500270118", codiceDestinatario: "0000000", pec: null }, "nessuna").map(c => c.codice);
    expect(errori).toEqual(expect.arrayContaining(["cliente_piva", "cliente_sdi"]));
  });

  it("il condominio è in regola col codice fiscale numerico, e la PEC vale come recapito SdI", () => {
    const controlli = controlliCliente({ ...base, tipo: "condominio", codiceFiscale: "80012345678", partitaIva: null, pec: "condominio@pec.it" }, "nessuna");
    expect(controlli.filter(c => c.esito === "errore")).toEqual([]);
    expect(controlli.map(c => c.esito)).toEqual(["ok"]);
  });

  it("con la detrazione il codice fiscale è obbligatorio anche per l'azienda", () => {
    const codici = controlliCliente({ ...base, tipo: "azienda", codiceFiscale: null, partitaIva: "01500270119", codiceDestinatario: "ABC1234" }, "ecobonus").map(c => c.codice);
    expect(codici).toEqual(["cliente_cf_bonus"]);
  });

  it("anagrafica vuota: nome, indirizzo, CAP e città sono errori distinti", () => {
    const codici = controlliCliente({ ...base, nome: "", indirizzo: "", cap: "", citta: "" }, "nessuna").filter(c => c.esito === "errore").map(c => c.codice);
    expect(codici).toEqual(["cliente_nome", "cliente_indirizzo", "cliente_cap", "cliente_citta"]);
  });
});
