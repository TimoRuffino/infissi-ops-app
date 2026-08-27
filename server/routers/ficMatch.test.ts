// Match fattura → commessa: sono soldi, quindi le regole devono essere
// noiose. Un segnale basta per allegare; la parità non si scioglie a caso.

import { describe, expect, it } from "vitest";
import {
  trovaCommessaPerFattura,
  estraiCodiceCommessa,
  verificaCollegamento,
} from "./ficMatch";

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

  it("l'indirizzo da solo propone ma non collega: e' il posto, non il cliente", () => {
    // Palazzine e condomini: stesso civico, clienti che non c'entrano fra
    // loro. Collegare qui significava sommare due lavori nello stesso
    // pattuito.
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
    expect(esito.commessaId).toBeNull();
    expect(esito.incerto).toBe(true);
    expect(esito.candidati[0]).toMatchObject({ commessaId: 10, incerto: true });
  });

  it("indirizzo piu' un altro segnale collega", () => {
    const esito = trovaCommessaPerFattura({
      fattura: fattura({
        clienteNome: "Rossi Mario",
        clienteIndirizzo: "Via Guglielmo Marconi 14",
        clienteCitta: "Sarzana",
      }),
      commesse: [
        commessa({
          cliente: "Mario Rossi",
          indirizzo: "via marconi guglielmo, 14",
          citta: "SARZANA",
        }),
      ],
      clienti: [],
    });
    expect(esito.commessaId).toBe(10);
    expect(esito.incerto).toBe(false);
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

describe("contraddizioni", () => {
  const anagrafica = (extra: Partial<any> = {}) => ({
    id: 7,
    nome: "Mario",
    cognome: "Rossi",
    email: null,
    telefono: null,
    indirizzo: null,
    citta: null,
    partitaIva: null,
    codiceFiscale: null,
    ...extra,
  });

  it("partita IVA diversa esclude la commessa anche col telefono uguale", () => {
    // Il telefono e' quello dello studio o del familiare: la partita IVA
    // dice che l'intestatario e' un'altra impresa.
    const esito = trovaCommessaPerFattura({
      fattura: fattura({
        clienteNome: "Beta Srl",
        clienteVat: "IT02222222222",
        clienteTelefono: "3451234567",
      }),
      commesse: [commessa({ clienteId: 7, telefono: "3451234567" })],
      clienti: [
        anagrafica({ cognome: "Alfa", nome: "Srl", partitaIva: "01111111111" }),
      ],
    });
    expect(esito.commessaId).toBeNull();
    expect(esito.candidati).toEqual([]);
    expect(esito.motivo).toContain("Scartata");
    expect(esito.motivo).toContain("va creata la commessa");
  });

  it("un cliente in anagrafica diverso esclude la commessa", () => {
    const esito = trovaCommessaPerFattura({
      fattura: fattura({ clienteId: 9, clienteTelefono: "3451234567" }),
      commesse: [commessa({ clienteId: 7, telefono: "3451234567" })],
      clienti: [anagrafica()],
    });
    expect(esito.commessaId).toBeNull();
    expect(esito.candidati).toEqual([]);
  });

  it("un nome diverso lascia il candidato ma non collega", () => {
    const esito = trovaCommessaPerFattura({
      fattura: fattura({
        clienteNome: "Bianchi Lucia",
        clienteTelefono: "3451234567",
      }),
      commesse: [commessa({ cliente: "Rossi Mario", telefono: "3451234567" })],
      clienti: [],
    });
    expect(esito.commessaId).toBeNull();
    expect(esito.incerto).toBe(true);
    expect(esito.candidati[0].contraddizioni).toEqual(["cognome_nome"]);
    expect(esito.candidati[0].dubbio).toBe("intestatario diverso");
  });

  it("la stessa partita IVA copre una ragione sociale riscritta", () => {
    const esito = trovaCommessaPerFattura({
      fattura: fattura({
        clienteNome: "Alfa Srl Unipersonale",
        clienteVat: "IT01111111111",
      }),
      commesse: [commessa({ clienteId: 7 })],
      clienti: [
        anagrafica({ cognome: "Alfa", nome: "Srl", partitaIva: "01111111111" }),
      ],
    });
    expect(esito.commessaId).toBe(10);
    expect(esito.incerto).toBe(false);
  });

  it("il codice commessa in fattura vince anche sulla contraddizione", () => {
    const esito = trovaCommessaPerFattura({
      fattura: fattura({
        clienteNome: "Bianchi Lucia",
        clienteVat: "IT02222222222",
        descrizione: "Saldo COM 2026 035",
      }),
      commesse: [commessa({ clienteId: 7, codice: "COM-2026-035" })],
      clienti: [
        anagrafica({ cognome: "Rossi", nome: "Mario", partitaIva: "01111111111" }),
      ],
    });
    expect(esito.commessaId).toBe(10);
    expect(esito.incerto).toBe(false);
  });

  it("due fatture di clienti diversi non finiscono sulla stessa commessa", () => {
    // Il caso vero: due intestatari nello stesso stabile. La prima fattura
    // e' del cliente della commessa, la seconda no.
    const commesse = [
      commessa({
        id: 10,
        cliente: "Rossi Mario",
        indirizzo: "Via Guglielmo Marconi 14",
        citta: "Sarzana",
      }),
    ];
    const sua = trovaCommessaPerFattura({
      fattura: fattura({
        clienteNome: "Rossi Mario",
        clienteIndirizzo: "Via Guglielmo Marconi 14",
        clienteCitta: "Sarzana",
      }),
      commesse,
      clienti: [],
    });
    const altrui = trovaCommessaPerFattura({
      fattura: fattura({
        id: 2,
        clienteNome: "Bianchi Lucia",
        clienteIndirizzo: "Via Guglielmo Marconi 14",
        clienteCitta: "Sarzana",
      }),
      commesse,
      clienti: [],
    });
    expect(sua.commessaId).toBe(10);
    expect(altrui.commessaId).toBeNull();
    expect(altrui.incerto).toBe(true);
  });
});

describe("verificaCollegamento", () => {
  it("segnala una fattura gia' collegata alla commessa di un altro", () => {
    const esito = verificaCollegamento({
      fattura: fattura({ clienteNome: "Bianchi Lucia" }),
      commessa: commessa({ cliente: "Rossi Mario" }),
      cliente: null,
    });
    expect(esito.avviso).toBe("intestatario diverso");
  });

  it("tace quando l'intestatario e' lo stesso", () => {
    const esito = verificaCollegamento({
      fattura: fattura({ clienteNome: "Mario Rossi" }),
      commessa: commessa({ cliente: "Rossi Mario" }),
      cliente: null,
    });
    expect(esito.avviso).toBeNull();
  });

  it("tace quando il codice commessa e' scritto in fattura", () => {
    const esito = verificaCollegamento({
      fattura: fattura({
        clienteNome: "Bianchi Lucia",
        descrizione: "Saldo COM 2026 035",
      }),
      commessa: commessa({ cliente: "Rossi Mario", codice: "COM-2026-035" }),
      cliente: null,
    });
    expect(esito.avviso).toBeNull();
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
