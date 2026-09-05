// Test dell'arricchimento facoltativo dal layout WnD (piano 3, Task 4, D-A).
// Il riconoscimento del layout NON è un requisito della lettura: quando il
// testo ha le etichette esatte del configuratore (blocchi «N. Rif. Stanza»,
// «Riepilogo Costi», «Totale IVA Incl.», «Termini di pagamento») si correggono
// misure, quantità, prezzi, pattuito e rate con evidenze certe; su qualunque
// altro contratto la proposta del modello resta intatta.
//
// Fixture sintetiche: nessun PDF reale, nessun cliente reale.

import { describe, expect, it } from "vitest";
import { tariffeAttive } from "../../computo/tariffe";
import { arricchisciDaLayoutWnd, riconosceLayoutWnd } from "./layoutWnd";
import { costruisciProposta, type ContestoMappa } from "./mappa";
import type { EsitoModello } from "./schema";

const PAGINE_WND = [
  [
    "Konfortline - Preventivo n. 127 del 12/03/2026",
    "Cliente: Rossi Mario",
    "",
    "1. Rif. Stanza: Soggiorno",
    "Prodotto: Portafinestra 2 ante in PVC Konfortline, finitura Real Wood",
    "Larghezza 1400 mm Altezza 2300 mm",
    "Vetro: basso emissivo",
    "Riepilogo",
    "Portafinestra 2 ante 5.200,00 € 0,00 € 1 0,00 € (0%) 5.200,00 €",
    "",
    "2. Rif. Stanza: Cucina",
    "Prodotto: Finestra 2 ante in PVC Konfortline bianco",
    "Larghezza 1400 mm Altezza 1300 mm",
    "Vetro: basso emissivo",
    "Riepilogo",
    "Finestra 2 ante 2.400,00 € 0,00 € 2 0,00 € (0%) 4.800,00 €",
    "",
    "3. Rif. Stanza: Camera",
    "Prodotto: Finestra 2 ante in PVC Konfortline bianco",
    "Larghezza 1200 mm Altezza 1300 mm",
    "Vetro: basso emissivo",
    "Riepilogo",
    "Finestra 2 ante 2.136,11 € 0,00 € 1 0,00 € (0%) 2.136,11 €",
  ].join("\n"),
  [
    "Riepilogo Costi",
    "Prodotto Prezzo unit. Installazione Quantità Sconto Totale",
    "Portafinestra 2 ante 5.200,00 € 0,00 € 1 0,00 € (0%) 5.200,00 €",
    "Finestra 2 ante 2.400,00 € 0,00 € 2 0,00 € (0%) 4.800,00 €",
    "Finestra 2 ante 2.136,11 € 0,00 € 1 0,00 € (0%) 2.136,11 €",
    "Coprifili in PVC su misura 600,00 € 0,00 € 1 0,00 € (0%) 600,00 €",
    "Maniglie in ottone 250,00 € 0,00 € 1 0,00 € (0%) 250,00 €",
    "Trasporto e posa in opera 1.100,00 € 0,00 € 1 0,00 € (0%) 1.100,00 €",
    "Totale IVA Esc. 14.086,11 €",
    "IVA 10% 1.408,61 €",
    "Totale IVA Incl. 15.494,72 €",
    "Termini di pagamento: ACCONTO DEL 50% ALLA FIRMA, 40% ALLA CONSEGNA, 10% A FINE LAVORI",
  ].join("\n"),
];

const PAGINE_WORD = [
  [
    "CONTRATTO DI FORNITURA E POSA",
    "Art. 1 Oggetto: fornitura e posa in opera di n. 3 serramenti in PVC.",
    "Art. 2 Corrispettivo: importo complessivo di € 9.800,00 IVA inclusa.",
    "Art. 3 Pagamento: 50% alla firma, saldo alla consegna.",
  ].join("\n"),
];

function riga(parziale: Partial<EsitoModello["righe"][number]>): EsitoModello["righe"][number] {
  return {
    descrizione: "riga",
    tipoProdotto: "finestra",
    materiale: "pvc",
    nAnte: 2,
    quantita: 1,
    larghezzaMm: null,
    altezzaMm: null,
    prezzoTotale: null,
    prezzoUnitario: null,
    oscuranteAbbinato: "nessuno",
    lamelleOrientabili: false,
    accessori: [],
    pagina: 1,
    frammento: "riga",
    ...parziale,
  };
}

// Il modello ha letto le righe ma ha sbagliato altezza e quantità e non ha
// trovato né prezzi né totali: è esattamente il caso in cui il layout aiuta.
const ESITO_INCERTO: EsitoModello = {
  righe: [
    riga({
      descrizione: "Portafinestra 2 ante in PVC Konfortline, finitura Real Wood",
      tipoProdotto: "portafinestra",
      larghezzaMm: 1400,
      altezzaMm: 2200,
      frammento: "Prodotto: Portafinestra 2 ante in PVC Konfortline, finitura Real Wood",
    }),
    riga({
      descrizione: "Finestra 2 ante in PVC Konfortline bianco",
      frammento: "2. Rif. Stanza: Cucina",
    }),
    riga({
      descrizione: "Finestra 2 ante in PVC Konfortline bianco",
      frammento: "3. Rif. Stanza: Camera",
    }),
  ],
  pattuito: { totaleLordo: null, totaleImponibile: null, ivaDescrizione: null, pagina: 2, frammento: "Riepilogo Costi" },
  posa: { inclusa: true, prezzo: null, descrizione: null, pagina: 2, frammento: "Trasporto e posa in opera" },
  rate: [],
  cantiere: { indirizzo: null, comune: "Sarzana", provincia: "SP", piano: null, pagina: 1, frammento: "Cliente: Rossi Mario" },
  cliente: { nome: "Rossi Mario", codiceFiscale: null, pagina: 1, frammento: "Cliente: Rossi Mario" },
  dataDocumento: "12/03/2026",
  dataFirma: null,
  riferimento: "127",
  detrazione: "non_indicata",
  note: "",
};

const CONTESTO: ContestoMappa = {
  tariffe: tariffeAttive(),
  clienteCommessa: { nome: "Rossi Mario", indirizzo: null, citta: "Sarzana (SP)", codiceFiscale: null, tipoDetrazione: null },
  pagine: PAGINE_WND,
};

describe("riconosceLayoutWnd", () => {
  it("riconosce il preventivo del configuratore dalle due etichette", () => {
    expect(riconosceLayoutWnd(PAGINE_WND)).toBe(true);
  });

  it("non riconosce un contratto in prosa", () => {
    expect(riconosceLayoutWnd(PAGINE_WORD)).toBe(false);
    expect(riconosceLayoutWnd([])).toBe(false);
  });
});

describe("arricchisciDaLayoutWnd", () => {
  const proposta = costruisciProposta(ESITO_INCERTO, CONTESTO, false);
  const arricchita = arricchisciDaLayoutWnd(PAGINE_WND, proposta);

  it("corregge misure, quantità e prezzo di ogni riga con evidenza certa", () => {
    const prima = arricchita.righe[0];
    expect(prima.larghezzaMm.valore).toBe(1400);
    expect(prima.altezzaMm.valore).toBe(2300);
    expect(prima.quantita.valore).toBe(1);
    expect(prima.prezzoTotCent.valore).toBe(520000);
    expect(prima.altezzaMm.daVerificare).toBe(false);
    expect(prima.prezzoTotCent.evidenza?.pagina).toBe(1);
    expect(prima.prezzoTotCent.evidenza?.frammento).toContain("5.200,00");
  });

  it("assegna i blocchi alle righe in ordine anche con descrizioni identiche", () => {
    expect(arricchita.righe[1].larghezzaMm.valore).toBe(1400);
    expect(arricchita.righe[1].altezzaMm.valore).toBe(1300);
    expect(arricchita.righe[1].quantita.valore).toBe(2);
    expect(arricchita.righe[1].prezzoTotCent.valore).toBe(480000);
    expect(arricchita.righe[2].larghezzaMm.valore).toBe(1200);
    expect(arricchita.righe[2].prezzoTotCent.valore).toBe(213611);
  });

  it("prende il pattuito dal totale IVA inclusa", () => {
    expect(proposta.pattuitoCent.valore).toBeNull();
    expect(arricchita.pattuitoCent.valore).toBe(1549472);
    expect(arricchita.pattuitoTipo.valore).toBe("lordo");
    expect(arricchita.pattuitoCent.daVerificare).toBe(false);
    expect(arricchita.pattuitoCent.evidenza?.pagina).toBe(2);
  });

  it("legge i termini di pagamento come rate", () => {
    expect(proposta.rate.valore).toEqual([]);
    expect(arricchita.rate.valore.map(r => r.quotaPct)).toEqual([50, 40, 10]);
    expect(arricchita.rate.valore.map(r => r.numero)).toEqual([1, 2, 3]);
    expect(arricchita.rate.valore[0].descrizione).toContain("ACCONTO DEL 50%");
    expect(arricchita.rate.valore.every(r => r.giorni === null && r.data === null)).toBe(true);
    expect(arricchita.rate.daVerificare).toBe(false);
  });

  it("con il solo totale IVA esclusa propone l'imponibile", () => {
    const pagine = [PAGINE_WND[0], PAGINE_WND[1].replace(/Totale IVA Incl\..*\n?/, "")];
    const soloEsc = arricchisciDaLayoutWnd(pagine, costruisciProposta(ESITO_INCERTO, { ...CONTESTO, pagine }, false));
    expect(soloEsc.pattuitoCent.valore).toBe(1408611);
    expect(soloEsc.pattuitoTipo.valore).toBe("imponibile");
  });

  // C1/P3-R9: i controlli sono derivati dai numeri, e i numeri qui cambiano.
  it("ricalcola i controlli sui valori nuovi e conserva quelli non derivabili", () => {
    const conIva = arricchisciDaLayoutWnd(PAGINE_WND, proposta, { ivaDescrizione: "IVA 10%", troncato: false });
    // Prima dell'arricchimento il pattuito non c'era e i prezzi nemmeno.
    expect(proposta.controlli.find(c => c.codice === "pattuito")?.esito).toBe("errore");
    expect(proposta.controlli.find(c => c.codice === "righe_senza_prezzo")?.esito).toBe("avviso");
    // Dopo: pattuito valorizzato, nessun controllo lo smentisce.
    expect(conIva.pattuitoCent.valore).toBe(1549472);
    expect(conIva.controlli.find(c => c.codice === "pattuito")).toBeUndefined();
    expect(conIva.controlli.find(c => c.codice === "righe_senza_prezzo")).toBeUndefined();
    // La somma delle righe lette (12.136,11) non copre l'imponibile (14.086,11):
    // il documento ha anche coprifili, maniglie e posa che il modello non ha letto.
    const somma = conIva.controlli.find(c => c.codice === "righe_vs_pattuito");
    expect(somma?.esito).toBe("avviso");
    expect(somma?.messaggio).toContain("14086,11");
    // Il controllo del cliente non è derivabile dai numeri: resta.
    expect(conIva.controlli.find(c => c.codice === "cliente_citato")?.esito).toBe("ok");
    // Un solo controllo per codice: l'arricchimento non li accumula.
    const codici = conIva.controlli.map(c => c.codice);
    expect(new Set(codici).size).toBe(codici.length);
  });

  it("senza descrizione dell'IVA la somma delle righe non si verifica, e lo dice", () => {
    const arricchitaSenzaIva = arricchisciDaLayoutWnd(PAGINE_WND, proposta);
    const somma = arricchitaSenzaIva.controlli.find(c => c.codice === "righe_vs_pattuito");
    expect(somma?.esito).toBe("avviso");
    expect(somma?.messaggio).toContain("IVA mista");
  });

  it("non tocca la proposta quando il layout non è quello", () => {
    const proposta = costruisciProposta(ESITO_INCERTO, { ...CONTESTO, pagine: PAGINE_WORD }, false);
    expect(arricchisciDaLayoutWnd(PAGINE_WORD, proposta)).toBe(proposta);
  });

  it("non muta la proposta ricevuta", () => {
    const originale = costruisciProposta(ESITO_INCERTO, CONTESTO, false);
    const copia = JSON.parse(JSON.stringify(originale));
    arricchisciDaLayoutWnd(PAGINE_WND, originale);
    expect(JSON.parse(JSON.stringify(originale))).toEqual(copia);
  });
});
