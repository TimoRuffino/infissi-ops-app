// La conferma Alias vera (Ordini_di_Vendi_1602923(1).pdf, 04/09/2026) come
// la restituisce pdf.js: colonne incollate, etichette dopo i valori. Ciò
// che una persona ci legge subito — «VS.RIFERIMENTO GIACOMAZZI GIUL», il
// fornitore in testa, il numero documento, la settimana di approntamento —
// deve leggerlo anche l'estrattore.

import { describe, expect, it } from "vitest";
import { estraiConfermaOrdine } from "./estrazioneConferma";

const PAGINA_1 = [
  "Conferma Ordine",
  "ALIAS Srl Porte blindate",
  "Via E.Berlinguer, 22",
  "29020 Settima di Gossolengo (PC)",
  "Tel. (+39) 0523.364040 - Fax (+39) 0523.364044",
  "Cod.Fisc.Reg.Impr.PC 01344690332",
  "Rea 154191 Cap.Soc. € 500.000,00 i.v.",
  "www.aliasblindate.com - Info@aliasblindate.com",
  "Codice fiscale 01500270119",
  "Partita IVA IT 01500270119",
  "Pagina 1 / 2",
  "VIA F. CRISPI, 135",
  "RUFFINO GROUP SRLS",
  "006604Spettabile",
  "19100 - LA SPEZIA - SP - IT Italia",
  "Destinatario",
  "Codice identificativo destinatario: E3Z6C46",
  "AGENTE",
  "DE - DOOR DESIGN S.R.L.",
  "2026 - CV 003746 23/02/2026del",
  "N.DOCUMENTO CAUSALE",
  "001 Ordine Italia",
  "VS.RIFERIMENTO",
  "GIACOMAZZI GIUL",
  "Approntamento [1]",
  "Compilatore conferma",
  "Veronica Gregori",
  "2026 Settimana 21",
  "KPO44 KIT PORTA",
  "NR 1,00 22 99819,47",
].join("\n");

const PAGINA_2 = [
  "Tot. Merce 908,73",
  "Tot. Spese 40,00",
  "Tot. Imponibile 948,73",
  "Tot. Imposta 208,72",
  "Tot. Ordine 1.157,45",
  "PORTO FRANCO ADDEBITO IN FATTURAConsegna VETTORE",
].join("\n");

describe("estraiConfermaOrdine — conferma Alias reale", () => {
  const e = estraiConfermaOrdine([PAGINA_1, PAGINA_2], {
    codiceOrdine: null,
    fornitoreNome: null,
    righeOrdine: [],
  });

  it("legge il vostro riferimento sulla riga sotto l'etichetta", () => {
    expect(e.riferimentoCliente?.valore).toBe("GIACOMAZZI GIUL");
  });

  it("legge il fornitore dall'intestazione, non il destinatario né l'agente", () => {
    expect(e.fornitoreCitato?.valore).toBe("ALIAS Srl Porte blindate");
    expect(e.fornitoreCitato?.evidenza.confidenza).toBe("bassa");
  });

  it("legge il numero documento del fornitore accanto a «N.DOCUMENTO» e la data del documento incollata a «del»", () => {
    expect(e.numeroConferma?.valore).toBe("CV 003746");
    expect(e.dataDocumento?.valore).toBe("2026-02-23");
    expect(e.dateConsegna).toEqual([]);
  });

  it("la settimana di approntamento non è una consegna e porta l'anno", () => {
    expect(e.settimaneConsegna).toEqual([]);
    expect(e.settimaneApprontamento?.map(s => [s.valore, s.anno])).toEqual([[21, 2026]]);
  });

  it("imponibile e totale del documento", () => {
    expect(e.imponibileDocumento?.valore).toBe(948.73);
    expect(e.totaleDocumento?.valore).toBe(1157.45);
  });
});
