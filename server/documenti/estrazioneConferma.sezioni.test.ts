// Più conferme nello stesso PDF (Bertolotto, 04/09/2026): tre ordini in
// otto pagine, ognuno con il suo riquadro «RIEPILOGO COSTI». Nomi cambiati.

import { describe, expect, it } from "vitest";
import {
  estraiConfermaOrdine,
  estraiConfermeNelDocumento,
  sezioniConferma,
} from "./estrazioneConferma";

const contesto = { codiceOrdine: null, fornitoreNome: null, righeOrdine: [] as const };

function intestazione(numero: string, tipo: string): string {
  return [
    "BERTOLOTTO S.p.A unipersonale",
    "Circonvallazione G. Giolitti, 43/45   CF e P.IVA IT02761400049",
    "TIPO ORDINE   SPETT.LE   DESTINAZIONE",
    `${tipo}   RUFFINO GROUP SRLS   RUFFINO GROUP SRLS C/O`,
    "NUMERO   DATA   PAGINA   19124 LA SPEZIA (SP)",
    `${numero}   19/02/2026   1/2   ITALIA`,
    "AGENTE   PORTO   MOBILE   PERS. RIF.",
    "POMATI ANDREA   FRANCO",
    "VOSTRO RIF.",
    "ROSSI CANTIERE",
  ].join("\n");
}

function riepilogo(merce: string, netto: string, imponibile: string, imposta: string, ordine: string): string {
  return [
    "RIEPILOGO COSTI",
    `TOT. MERCE ${merce}`,
    "SCONTO 7085,36",
    `VALORE NETTO ${netto}`,
    `TOTALE IMPONIBILE ${imponibile}`,
    `TOTALE IMPOSTA ${imposta}`,
    `TOTALE ORDINE ${ordine} |EUR`,
    "NOTA IMPORTANTE: i CERTIFICATI verranno rilasciati a SALDO TOTALE della FORNITURA",
  ].join("\n");
}

const PAGINE = [
  intestazione("VI/26/2292", "ORDINI DI VENDITA ITALIA") + "\n1 PORTA MODELLO A   NR 1,00   1.200,00",
  "2 PORTA MODELLO B   NR 1,00   1.100,00\n3 MANIGLIA   NR 2,00   50,00",
  riepilogo("12612,01", "5526,65", "4846,65", "1108,15", "5.954,80"),
  "ALLEGATO TECNICO: schemi di montaggio",
  intestazione("VT/26/96", "ORDINI CLIENTI MERCHANDISING") + "\n1 ESPOSITORE   NR 1,00   542,64",
  riepilogo("600,00", "542,64", "542,64", "119,38", "662,02"),
  intestazione("VI/26/2293", "ORDINI DI VENDITA ITALIA") +
    "\n1 KIT COPRIFILI   NR 3,00   176,49\n" +
    riepilogo("580,00", "529,48", "529,48", "116,49", "645,97"),
  "CONDIZIONI GENERALI DI VENDITA\nArt. 1 …",
];

describe("sezioniConferma", () => {
  it("chiude una sezione a ogni riquadro totali e lascia le code all'ultima", () => {
    expect(sezioniConferma(PAGINE)).toEqual([
      { da: 0, a: 2 },
      { da: 3, a: 5 },
      { da: 6, a: 7 },
    ]);
  });
  it("un documento con un riquadro solo è una sezione sola; senza riquadri idem", () => {
    expect(sezioniConferma(PAGINE.slice(0, 3))).toEqual([{ da: 0, a: 2 }]);
    expect(sezioniConferma(["solo testo", "altro testo"])).toEqual([{ da: 0, a: 1 }]);
  });
});

describe("estraiConfermeNelDocumento", () => {
  const letto = estraiConfermeNelDocumento(PAGINE, contesto);

  it("legge ogni sezione da sola: numero dall'intestazione NUMERO/DATA, imponibile e totale ordine (non il totale merce di listino)", () => {
    expect(letto.sezioni.map(s => s.estrazione.numeroConferma?.valore)).toEqual([
      "VI/26/2292",
      "VT/26/96",
      "VI/26/2293",
    ]);
    expect(letto.sezioni.map(s => s.estrazione.imponibileDocumento?.valore)).toEqual([4846.65, 542.64, 529.48]);
    expect(letto.sezioni.map(s => s.estrazione.totaleDocumento?.valore)).toEqual([5954.8, 662.02, 645.97]);
    // Le pagine delle evidenze sono quelle del file intero, non della sezione.
    expect(letto.sezioni[1].estrazione.imponibileDocumento?.evidenza.pagina).toBe(6);
  });

  it("la lettura principale somma imponibili e totali e unisce i numeri", () => {
    expect(letto.estrazione.imponibileDocumento?.valore).toBe(5918.77);
    expect(letto.estrazione.totaleDocumento?.valore).toBe(7262.79);
    expect(letto.estrazione.numeroConferma?.valore).toBe("VI/26/2292 + VT/26/96 + VI/26/2293");
    expect(letto.estrazione.imponibileDocumento?.evidenza.frammento).toContain("somma di 3 conferme");
    expect(letto.motivoSomma).toBeNull();
  });

  it("se una sezione non ha l'imponibile la somma non si fa, e il motivo lo dice", () => {
    const monche = [...PAGINE];
    monche[5] = "RIEPILOGO COSTI\nTOTALE ORDINE 662,02 |EUR";
    const senza = estraiConfermeNelDocumento(monche, contesto);
    expect(senza.sezioni).toHaveLength(3);
    expect(senza.estrazione.imponibileDocumento).toBeNull();
    expect(senza.motivoSomma).toContain("3 conferme");
    expect(senza.motivoSomma).toContain("pagine 4-6");
  });

  it("letto come un documento solo, il totale di listino avrebbe vinto: la lettura a sezioni evita l'errore", () => {
    const intero = estraiConfermaOrdine(PAGINE, contesto);
    // Un documento solo: l'imponibile esplicito più alto (4846,65) e non la somma.
    expect(intero.imponibileDocumento?.valore).toBe(4846.65);
    expect(letto.estrazione.imponibileDocumento?.valore).toBe(5918.77);
  });
});

describe("totale del documento — priorità delle etichette", () => {
  it("«TOTALE ORDINE» batte «TOT. MERCE» anche se più piccolo", () => {
    const e = estraiConfermaOrdine([riepilogo("12612,01", "5526,65", "4846,65", "1108,15", "5.954,80")], contesto);
    expect(e.totaleDocumento?.valore).toBe(5954.8);
    expect(e.totaleDocumento?.alternative?.map(a => a.valore)).toContain(12612.01);
    expect(e.imponibileDocumento?.valore).toBe(4846.65);
  });
});
