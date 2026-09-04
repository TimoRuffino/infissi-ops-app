// La commessa si cerca DENTRO la conferma: cognome, indirizzo, codice o
// ordine noto contro tutte le commesse vive. Una sola forte = trovata;
// due dello stesso cliente = vince quella che aspetta la conferma; solo
// indizi deboli = decide una persona; l'azienda stessa non è mai un
// candidato. Il lettore ricorda il testo, rispetta il tetto di letture e
// ritenta con il modello una scansione che l'OCR non ha letto.

import { beforeEach, describe, expect, it } from "vitest";
import type { EsitoParser } from "../../documenti/parserRegistry";
import {
  azzeraMemoriaRicercaPerTest,
  cercaCommessaNelTesto,
  commessaInterna,
  creaLettoreCommessaNelDocumento,
  type CommessaRicercabile,
} from "./ricercaCommessaNelDocumento";

const COMMESSE: CommessaRicercabile[] = [
  { id: 1, codice: "COM-2026-001", cliente: "Pistone Angelo", stato: "produzione" },
  { id: 2, codice: "COM-2026-002", cliente: "Giacomazzi Giulia", stato: "da_ordinare", indirizzo: "Via Roma 12", citta: "Sarzana" },
  { id: 3, codice: "COM-2026-003", cliente: "Giacomazzi Giulia", stato: "preventivo" },
  { id: 4, codice: "COM-2026-004", cliente: "Rossi Mario", stato: "produzione" },
  { id: 5, codice: "COM-2026-005", cliente: "Ruffino Group Srls", stato: "produzione" },
  { id: 6, codice: "COM-2026-006", cliente: "Archiviata Tizia", stato: "produzione", archivedAt: new Date() },
];

const riferimenti = (c: CommessaRicercabile) => ({
  codice: c.codice ?? null,
  cliente: c.cliente ?? null,
  indirizzo: c.indirizzo ?? null,
  citta: c.citta ?? null,
  riferimentiOrdine: c.id === 4 ? ["ORD-778899"] : [],
});

const INTERNE = new Set(["ruffino", "timothy"]);

describe("cercaCommessaNelTesto", () => {
  it("un cognome pieno citato da una sola commessa viva: unica", () => {
    const esito = cercaCommessaNelTesto({
      pagine: ["Spett.le Ruffino Group Srls", "Vs. rif.: PISTONE ANGELO", "Totale imponibile 1.200,00"],
      commesse: COMMESSE,
      paroleInterne: INTERNE,
      riferimenti,
    });
    expect(esito.esito).toBe("unica");
    expect(esito.commessaId).toBe(1);
    expect(esito.candidati.map(c => c.commessaId)).toEqual([1]);
    expect(esito.motivo).toContain("pistone");
  });

  it("due commesse dello stesso cliente: vince quella che aspetta la conferma", () => {
    const esito = cercaCommessaNelTesto({
      pagine: ["Rif. cliente: GIACOMAZZI GIULIA"],
      commesse: COMMESSE,
      paroleInterne: INTERNE,
      riferimenti,
    });
    expect(esito.esito).toBe("unica");
    expect(esito.commessaId).toBe(2);
    expect(esito.motivo).toContain("in attesa di conferma");
  });

  it("due commesse entrambe in attesa con lo stesso riferimento: ambigua", () => {
    const commesse = COMMESSE.map(c => (c.id === 3 ? { ...c, stato: "produzione" } : c));
    const esito = cercaCommessaNelTesto({
      pagine: ["Rif. cliente: GIACOMAZZI GIULIA"],
      commesse,
      paroleInterne: INTERNE,
      riferimenti,
    });
    expect(esito.esito).toBe("ambigua");
    expect(esito.commessaId).toBeNull();
    expect(esito.candidati.map(c => c.commessaId).sort()).toEqual([2, 3]);
  });

  it("un cognome corto o quasi uguale è un indizio debole: decide una persona", () => {
    const esito = cercaCommessaNelTesto({
      pagine: ["Rif. ROSSI"],
      commesse: COMMESSE,
      paroleInterne: INTERNE,
      riferimenti,
    });
    expect(esito.esito).toBe("ambigua");
    expect(esito.candidati[0]).toMatchObject({ commessaId: 4, forza: "debole" });
  });

  it("un ordine già noto alla commessa vale come prova forte", () => {
    const esito = cercaCommessaNelTesto({
      pagine: ["Conferma ordine n. ORD-778899 del 01/09/2026"],
      commesse: COMMESSE,
      paroleInterne: INTERNE,
      riferimenti,
    });
    expect(esito).toMatchObject({ esito: "unica", commessaId: 4 });
  });

  it("l'azienda stessa e le commesse archiviate non sono mai candidate; senza citazioni: nessuna", () => {
    const esito = cercaCommessaNelTesto({
      pagine: ["Spett.le RUFFINO GROUP SRLS", "Rif. TIZIA ARCHIVIATA", "Merce varia"],
      commesse: COMMESSE,
      paroleInterne: INTERNE,
      riferimenti,
    });
    expect(esito.esito).toBe("nessuna");
    expect(commessaInterna(COMMESSE[4], INTERNE)).toBe(true);
    expect(commessaInterna(COMMESSE[0], INTERNE)).toBe(false);
  });
});

describe("creaLettoreCommessaNelDocumento", () => {
  beforeEach(() => azzeraMemoriaRicercaPerTest());

  const sorgente = (id: number) => ({
    sedeId: 1,
    comunicazioneId: id,
    allegatoIndex: 0,
    leggi: async () => ({ buffer: Buffer.from("pdf"), mimeType: "application/pdf", nome: `conf-${id}.pdf` }),
  });

  it("legge una volta, ricorda il testo e rispetta il tetto di letture", async () => {
    let letture = 0;
    const lettore = creaLettoreCommessaNelDocumento({
      massimoLetture: 1,
      paroleInterne: () => INTERNE,
      riferimenti,
      estraiTesto: async (): Promise<EsitoParser> => {
        letture += 1;
        return { esito: "estratto", parser: "test", versione: "1", pagine: ["Vs. rif. PISTONE ANGELO"], avvertenze: [] };
      },
    });
    const primo = await lettore(sorgente(10), COMMESSE);
    expect(primo).toMatchObject({ esito: "unica", commessaId: 1, fonteTesto: "testo_pdf" });
    expect(primo.pagine).toEqual(["Vs. rif. PISTONE ANGELO"]);
    const ripetuto = await lettore(sorgente(10), COMMESSE);
    expect(ripetuto.esito).toBe("unica");
    expect(letture).toBe(1);
    // Il tetto: il secondo file resta «non letto», senza errori.
    const oltre = await lettore(sorgente(11), COMMESSE);
    expect(oltre.esito).toBe("non_letto");
    expect(letture).toBe(1);
  });

  it("una scansione non letta senza modello si ritenta quando c'è l'identità per la visione", async () => {
    const chiamate: Array<boolean> = [];
    const estraiTesto = async (_b: Buffer, _m: string, _n: string, opzioni?: any): Promise<EsitoParser> => {
      const conVisione = Boolean(opzioni?.visione);
      chiamate.push(conVisione);
      return conVisione
        ? { esito: "estratto", parser: "visione", versione: "1", pagine: ["Rif. GIACOMAZZI GIULIA"], avvertenze: [], visione: { modello: "m", versione: "1", pagine: 1, caratteri: 20 } as any }
        : { esito: "scansione_senza_testo", motivo: "OCR non riuscito" } as any;
    };
    const senza = creaLettoreCommessaNelDocumento({ paroleInterne: () => INTERNE, riferimenti, estraiTesto });
    expect((await senza(sorgente(20), COMMESSE)).esito).toBe("non_leggibile");
    const con = creaLettoreCommessaNelDocumento({
      visione: { sedeId: 1, utenteId: 0 },
      paroleInterne: () => INTERNE,
      riferimenti,
      estraiTesto,
    });
    const esito = await con(sorgente(20), COMMESSE);
    expect(esito).toMatchObject({ esito: "unica", commessaId: 2, fonteTesto: "visione" });
    expect(chiamate).toEqual([false, true]);
  });
});
