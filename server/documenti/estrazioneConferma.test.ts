// Unit test dell'estrattore nati dai rilievi della revisione indipendente
// (release hardening): confini dei riferimenti su TUTTI i percorsi di
// ricerca, importi con punteggiatura di frase e migliaia all'italiana,
// date di calendario impossibili, priorità della consegna sulla
// spedizione. Sono i casi in cui un errore d'estrazione diventerebbe una
// proposta sbagliata da approvare.

import { describe, expect, it } from "vitest";
import { estraiConfermaOrdine } from "./estrazioneConferma";

function estrai(testo: string, contesto?: Partial<Parameters<typeof estraiConfermaOrdine>[1]>) {
  return estraiConfermaOrdine([testo], {
    codiceOrdine: null,
    fornitoreNome: null,
    righeOrdine: [],
    ...contesto,
  });
}

describe("estrazioneConferma — confini dei riferimenti", () => {
  it("il riferimento al NOSTRO ordine non si accontenta di un prefisso", () => {
    const conPrefisso = estrai("Vs. ordine: ORD-100 del 12/08", {
      codiceOrdine: "ORD-10",
    });
    expect(conPrefisso.riferimentoOrdine).toBeNull();
    const esatto = estrai("Vs. ordine: ORD-10 del 12/08", {
      codiceOrdine: "ORD-10",
    });
    expect(esatto.riferimentoOrdine?.valore).toBe("ORD-10");
  });

  it("il fornitore citato richiede il nome intero, non un frammento incollato", () => {
    const incollato = estrai("Fornito da WNDX Serramenti", {
      fornitoreNome: "WND",
    });
    expect(incollato.fornitoreCitato).toBeNull();
  });
});

describe("estrazioneConferma — importi", () => {
  it("la punteggiatura di frase dopo il totale non lo distrugge", () => {
    const esito = estrai("Totale documento: EUR 1.234,50.");
    expect(esito.totaleDocumento?.valore).toBe(1234.5);
  });

  it("«1.234» senza decimali è milleduecentotrentaquattro, non 1,23", () => {
    const esito = estrai("Totale documento: EUR 1.234");
    expect(esito.totaleDocumento?.valore).toBe(1234);
  });
});

describe("estrazioneConferma — date", () => {
  it("una data di calendario impossibile (31/02) non diventa mai un valore", () => {
    const esito = estrai("Consegna prevista: 31/02/2026");
    expect(esito.dateConsegna).toHaveLength(0);
  });

  it("fra spedizione e consegna vince la consegna, qualunque sia l'ordine nel testo", () => {
    const esito = estrai(
      "Spedizione: 05/09/2026 dal nostro magazzino. Consegna prevista: 12/09/2026."
    );
    expect(esito.dateConsegna[0]?.valore).toBe("2026-09-12");
    expect(esito.dateConsegna.map(d => d.valore)).toContain("2026-09-05");
  });
});

describe("estrazioneConferma — imponibile (base del margine)", () => {
  it("legge l'imponibile dichiarato, distinto dal totale ivato", () => {
    const esito = estrai(
      "Totale imponibile: € 1.000,00\nIVA 22%: € 220,00\nTotale documento: € 1.220,00"
    );
    expect(esito.imponibileDocumento?.valore).toBe(1000);
    expect(esito.totaleDocumento?.valore).toBe(1220);
  });

  it("senza etichetta imponibile lo ricava per differenza da totale e IVA", () => {
    const esito = estrai("Totale documento: € 1.220,00\nIVA 22% € 220,00");
    expect(esito.totaleDocumento?.valore).toBe(1220);
    expect(esito.imponibileDocumento?.valore).toBe(1000);
  });

  it("senza IVA dichiarata non inventa nessuno scorporo", () => {
    const esito = estrai("Totale documento: € 1.220,00");
    expect(esito.totaleDocumento?.valore).toBe(1220);
    expect(esito.imponibileDocumento).toBeNull();
  });

  it("una partita IVA non è un importo di imposta", () => {
    const esito = estrai(
      "P.IVA 01234567890\nTotale documento: € 500,00"
    );
    expect(esito.imponibileDocumento).toBeNull();
  });
});
