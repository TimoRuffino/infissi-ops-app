// Test della parte deterministica dell'ingestione posta: cifratura dei
// segreti, aggancio mail→commessa, idempotenza dell'insert.
//
// Il giro IMAP vero non è coperto qui: richiede un server. Quello che conta
// è che le regole di aggancio siano prevedibili e che rileggere la stessa
// casella non duplichi nulla.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  isEncrypted,
  secretBoxConfigured,
} from "../_core/secretBox";
import { estraiCodiceCommessa, matchComunicazione } from "./match";
import {
  insertComunicazione,
  listComunicazioni,
  _resetComunicazioniInMemoria,
} from "./comunicazioni";

const CLIENTI = [
  { id: 1, nome: "Mario", cognome: "Rossi", email: "mario.rossi@example.com" },
  { id: 2, nome: "Anna", cognome: "Verdi", email: "anna.verdi@example.com" },
  { id: 3, nome: " ", cognome: "Condominio Aurora", email: null },
];

const COMMESSE = [
  { id: 10, codice: "COM-2026-035", clienteId: 1, stato: "produzione", email: null },
  { id: 11, codice: "COM-2026-051", clienteId: 2, stato: "attesa_posa", email: "cantiere@example.com" },
  { id: 12, codice: "COM-2026-052", clienteId: 2, stato: "preventivo", email: null },
  { id: 13, codice: "COM-2025-001", clienteId: 1, stato: "archiviata", email: null, archivedAt: new Date() },
];

describe("secretBox", () => {
  const prev = process.env.MAIL_ENCRYPTION_KEY;
  beforeAll(() => {
    process.env.MAIL_ENCRYPTION_KEY = "chiave-di-test-non-usare-in-produzione";
  });
  afterAll(() => {
    if (prev === undefined) delete process.env.MAIL_ENCRYPTION_KEY;
    else process.env.MAIL_ENCRYPTION_KEY = prev;
  });

  it("cifra e decifra restituendo il valore originale", () => {
    expect(secretBoxConfigured()).toBe(true);
    const segreto = "p@ssw0rd della casella";
    const cifrato = encryptSecret(segreto);
    expect(cifrato).not.toContain(segreto);
    expect(isEncrypted(cifrato)).toBe(true);
    expect(decryptSecret(cifrato)).toBe(segreto);
  });

  it("due cifrature dello stesso testo differiscono (IV casuale)", () => {
    expect(encryptSecret("uguale")).not.toBe(encryptSecret("uguale"));
  });

  it("rifiuta un testo cifrato manomesso", () => {
    const cifrato = encryptSecret("segreto");
    const parti = cifrato.split(".");
    // Altera il ciphertext lasciando intatto il tag: GCM deve accorgersene.
    const manomesso = [parti[0], parti[1], parti[2], Buffer.from("altro").toString("base64")].join(".");
    expect(() => decryptSecret(manomesso)).toThrow();
  });

  it("rifiuta un formato sconosciuto", () => {
    expect(() => decryptSecret("password-in-chiaro")).toThrow(/formato/);
  });
});

describe("estraiCodiceCommessa", () => {
  it("riconosce le varianti di punteggiatura", () => {
    expect(estraiCodiceCommessa("rif. COM-2026-035 grazie")).toBe("COM-2026-035");
    expect(estraiCodiceCommessa("COM 2026 35")).toBe("COM-2026-035");
    expect(estraiCodiceCommessa("com_2026_035")).toBe("COM-2026-035");
  });
  it("non inventa codici", () => {
    expect(estraiCodiceCommessa("nessun riferimento qui")).toBeNull();
    expect(estraiCodiceCommessa("COMPLIMENTI 2026")).toBeNull();
  });
});

describe("matchComunicazione", () => {
  const base = { clienti: CLIENTI as any, commesse: COMMESSE as any };

  it("il codice nel testo vince su tutto, con confidenza alta", () => {
    const m = matchComunicazione({
      ...base,
      mittente: "sconosciuto@fornitore.it",
      oggetto: "Conferma ordine",
      testo: "In riferimento alla COM-2026-035 confermiamo la merce.",
    });
    expect(m.commessaId).toBe(10);
    expect(m.clienteId).toBe(1);
    expect(m.confidenza).toBe("alta");
  });

  it("mittente cliente con una sola commessa attiva → aggancio pieno", () => {
    const m = matchComunicazione({
      ...base,
      mittente: "Mario.Rossi@Example.com",
      oggetto: "Domanda",
      testo: "Buongiorno, a che punto siamo?",
    });
    expect(m.clienteId).toBe(1);
    expect(m.commessaId).toBe(10); // la 13 è archiviata, non conta
    expect(m.confidenza).toBe("alta");
  });

  it("cliente con più commesse attive: aggancia il cliente, non indovina la commessa", () => {
    const m = matchComunicazione({
      ...base,
      mittente: "anna.verdi@example.com",
      oggetto: "Aggiornamento",
      testo: "Ci sono novità?",
    });
    expect(m.clienteId).toBe(2);
    expect(m.commessaId).toBeNull();
    expect(m.confidenza).toBe("media");
    expect(m.motivo).toMatch(/COM-2026-051.*COM-2026-052/);
  });

  it("email di contatto della commessa", () => {
    const m = matchComunicazione({
      ...base,
      mittente: "cantiere@example.com",
      oggetto: "Accesso al cantiere",
      testo: "Il cancello è aperto dalle 8.",
    });
    expect(m.commessaId).toBe(11);
    expect(m.confidenza).toBe("media");
  });

  it("codice citato ma inesistente: lo dice invece di tacere", () => {
    const m = matchComunicazione({
      ...base,
      mittente: "tizio@altro.it",
      oggetto: "COM-2026-999",
      testo: "vedi oggetto",
    });
    expect(m.commessaId).toBeNull();
    expect(m.confidenza).toBe("bassa");
    expect(m.motivo).toMatch(/non corrisponde/);
  });

  it("mai una commessa archiviata", () => {
    const m = matchComunicazione({
      ...base,
      mittente: "x@y.it",
      oggetto: "vecchia pratica",
      testo: "riferimento COM-2025-001",
    });
    expect(m.commessaId).toBeNull();
  });

  it("nessun indizio → nessun aggancio", () => {
    const m = matchComunicazione({
      ...base,
      mittente: "newsletter@spam.it",
      oggetto: "Offerta imperdibile",
      testo: "Compra ora!",
    });
    expect(m.confidenza).toBe("nessuna");
    expect(m.clienteId).toBeNull();
    expect(m.commessaId).toBeNull();
  });

  it("cognome lungo e univoco nell'oggetto: aggancio ma dichiarato incerto", () => {
    const m = matchComunicazione({
      ...base,
      mittente: "studio@architetti.it",
      oggetto: "Preventivo Condominio Aurora",
      testo: "In allegato la richiesta.",
    });
    expect(m.clienteId).toBe(3);
    expect(m.confidenza).toBe("bassa");
  });
});

describe("ingestione comunicazioni", () => {
  beforeAll(() => _resetComunicazioniInMemoria());

  const nuova = (messageId: string, oggetto: string) => ({
    sedeId: 1,
    casellaId: 1,
    messageId,
    canale: "email" as const,
    direzione: "in" as const,
    mittente: "mario.rossi@example.com",
    mittenteNome: "Mario Rossi",
    destinatari: ["ordini@ruffinogroup.it"],
    oggetto,
    testo: "corpo del messaggio",
    allegati: [],
    clienteId: 1,
    commessaId: 10,
    matchConfidenza: "alta" as const,
    matchMotivo: "test",
    stato: "nuova" as const,
    receivedAt: new Date("2026-08-06T10:00:00Z"),
  });

  it("inserisce e poi ignora il duplicato sullo stesso message_id", async () => {
    const prima = await insertComunicazione(nuova("<abc@example.com>", "Prima"));
    expect(prima).not.toBeNull();

    const doppia = await insertComunicazione(nuova("<abc@example.com>", "Prima"));
    expect(doppia).toBeNull();

    const rows = await listComunicazioni({ sedeId: 1 });
    expect(rows).toHaveLength(1);
  });

  it("la stessa mail su una casella diversa è un'altra riga", async () => {
    const altra = await insertComunicazione({
      ...nuova("<abc@example.com>", "Prima"),
      casellaId: 2,
    });
    expect(altra).not.toBeNull();
  });

  it("filtra per commessa e per non collegate", async () => {
    await insertComunicazione({
      ...nuova("<sciolta@example.com>", "Senza commessa"),
      commessaId: null,
      clienteId: null,
      matchConfidenza: "nessuna",
    });
    const perCommessa = await listComunicazioni({ sedeId: 1, commessaId: 10 });
    expect(perCommessa.every((c) => c.commessaId === 10)).toBe(true);

    const sciolte = await listComunicazioni({ sedeId: 1, soloNonCollegate: true });
    expect(sciolte).toHaveLength(1);
    expect(sciolte[0].oggetto).toBe("Senza commessa");
  });

  it("non mostra le comunicazioni di un'altra sede", async () => {
    await insertComunicazione({
      ...nuova("<altrasede@example.com>", "Altra sede"),
      sedeId: 2,
    });
    const sede1 = await listComunicazioni({ sedeId: 1 });
    expect(sede1.some((c) => c.oggetto === "Altra sede")).toBe(false);
  });
});
