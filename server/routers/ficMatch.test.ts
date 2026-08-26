// Match fattura → commessa: sono soldi, quindi le regole devono essere
// noiose. Un segnale basta per allegare; la parità non si scioglie a caso.

import { describe, expect, it } from "vitest";
import { trovaCommessaPerFattura, estraiCodiceCommessa } from "./ficMatch";

const fattura = (extra: Partial<any> = {}) => ({
  id: 1,
  numero: "12/A",
  clienteNome: "Rossi Mario",
  clienteVat: null,
  clienteCf: null,
  clienteEmail: null,
  clienteTelefono: null,
  clienteIndirizzo: null,
  clienteCitta: null,
  descrizione: null,
  clienteId: null,
  ...extra,
});

const commessa = (extra: Partial<any> = {}) => ({
  id: 10,
  codice: "COM-2026-035",
  clienteId: null,
  cliente: null,
  email: null,
  telefono: null,
  indirizzo: null,
  citta: null,
  ...extra,
});

describe("trovaCommessaPerFattura", () => {
  it("aggancia col solo telefono, anche in formato diverso", () => {
    const esito = trovaCommessaPerFattura({
      fattura: fattura({ clienteTelefono: "+39 345 123 45 67" }),
      commesse: [commessa({ telefono: "3451234567" })],
      clienti: [],
    });
    expect(esito.commessaId).toBe(10);
    expect(esito.segnali).toEqual(["telefono"]);
  });

  it("aggancia con la sola email dell'anagrafica cliente", () => {
    const esito = trovaCommessaPerFattura({
      fattura: fattura({ clienteEmail: "M.Rossi@Example.IT" }),
      commesse: [commessa({ clienteId: 7 })],
      clienti: [
        {
          id: 7,
          nome: "Mario",
          cognome: "Rossi",
          email: "m.rossi@example.it",
          telefono: null,
          indirizzo: null,
          citta: null,
          partitaIva: null,
          codiceFiscale: null,
        },
      ],
    });
    expect(esito.commessaId).toBe(10);
    expect(esito.segnali).toContain("email");
  });

  it("aggancia col nome comunque sia ordinato", () => {
    const esito = trovaCommessaPerFattura({
      fattura: fattura({ clienteNome: "MARIO  ROSSI" }),
      commesse: [commessa({ cliente: "Rossi Mario" })],
      clienti: [],
    });
    expect(esito.commessaId).toBe(10);
    expect(esito.segnali).toEqual(["cognome_nome"]);
  });

  it("il codice commessa citato nell'oggetto vince su tutto", () => {
    const esito = trovaCommessaPerFattura({
      fattura: fattura({
        clienteNome: "Bianchi Lucia",
        descrizione: "Saldo lavori COM 2026 035",
      }),
      commesse: [
        commessa({ id: 10, codice: "COM-2026-035" }),
        commessa({ id: 11, codice: "COM-2026-099", cliente: "Bianchi Lucia" }),
      ],
      clienti: [],
    });
    expect(esito.commessaId).toBe(10);
    expect(esito.segnali).toContain("codice_commessa");
  });

  it("un indirizzo generico non basta da solo", () => {
    const esito = trovaCommessaPerFattura({
      fattura: fattura({ clienteNome: "Altro Cliente", clienteIndirizzo: "Via" }),
      commesse: [commessa({ indirizzo: "Via" })],
      clienti: [],
    });
    expect(esito.commessaId).toBeNull();
    expect(esito.ambiguo).toBe(false);
  });

  it("indirizzo con città aggancia anche senza altri segnali", () => {
    const esito = trovaCommessaPerFattura({
      fattura: fattura({
        clienteNome: "Intestatario Diverso",
        clienteIndirizzo: "Via Guglielmo Marconi 14",
        clienteCitta: "Sarzana",
      }),
      commesse: [
        commessa({ indirizzo: "via marconi guglielmo, 14", citta: "SARZANA" }),
      ],
      clienti: [],
    });
    expect(esito.commessaId).toBe(10);
    expect(esito.segnali).toEqual(["indirizzo"]);
  });

  it("due commesse con la stessa forza restano ambigue", () => {
    const esito = trovaCommessaPerFattura({
      fattura: fattura({ clienteTelefono: "3451234567" }),
      commesse: [
        commessa({ id: 10, codice: "COM-2026-001", telefono: "3451234567" }),
        commessa({ id: 11, codice: "COM-2026-002", telefono: "345 1234567" }),
      ],
      clienti: [],
    });
    expect(esito.commessaId).toBeNull();
    expect(esito.ambiguo).toBe(true);
    expect(esito.candidati).toHaveLength(2);
  });

  it("più segnali battono un segnale solo, senza ambiguità", () => {
    const esito = trovaCommessaPerFattura({
      fattura: fattura({
        clienteNome: "Rossi Mario",
        clienteTelefono: "3451234567",
      }),
      commesse: [
        commessa({ id: 10, codice: "COM-2026-001", telefono: "3451234567" }),
        commessa({
          id: 11,
          codice: "COM-2026-002",
          telefono: "3451234567",
          cliente: "Rossi Mario",
        }),
      ],
      clienti: [],
    });
    expect(esito.commessaId).toBe(11);
    expect(esito.ambiguo).toBe(false);
  });

  it("nessun segnale in comune → nessun aggancio", () => {
    const esito = trovaCommessaPerFattura({
      fattura: fattura({ clienteNome: "Sconosciuto Tizio" }),
      commesse: [commessa({ cliente: "Rossi Mario" })],
      clienti: [],
    });
    expect(esito.commessaId).toBeNull();
    expect(esito.candidati).toEqual([]);
  });
});

describe("estraiCodiceCommessa", () => {
  it.each([
    ["COM-2026-035", "COM-2026-035"],
    ["com 2026 35", "COM-2026-035"],
    ["Rif. COM_2026_7 saldo", "COM-2026-007"],
  ])("normalizza %s", (input, atteso) => {
    expect(estraiCodiceCommessa(input)).toBe(atteso);
  });

  it("ignora un testo senza codice", () => {
    expect(estraiCodiceCommessa("Fattura saldo lavori")).toBeNull();
  });
});
