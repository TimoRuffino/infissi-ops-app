// Risposte a «Quale intendi: A oppure B?»: progressivo, codice, ordinale,
// nome — tutto ciò che identifica UN candidato; l'ambiguità resta tale.

import { describe, expect, it } from "vitest";
import {
  domandaChiarificazioneRipetuta,
  risolviRispostaChiarificazione,
} from "./chiarimento";

const CANDIDATI = [
  { commessaId: 103, codice: "COM-2026-096", cliente: "Bertoli Duilio" },
  { commessaId: 204, codice: "COM-2026-190", cliente: "IMMOBILIARE BERTOLI di Bertoli Duilio" },
  { commessaId: 64, codice: "COM-2026-064", cliente: "Torino Antonio" },
];

function scelto(messaggio: string) {
  const esito = risolviRispostaChiarificazione(messaggio, CANDIDATI);
  return esito.stato === "scelto" ? esito.candidato.commessaId : esito.stato;
}

describe("risolviRispostaChiarificazione", () => {
  it("accetta il progressivo nudo, con articolo, con zeri, e il codice completo", () => {
    expect(scelto("096")).toBe(103);
    expect(scelto("96")).toBe(103);
    expect(scelto("la commessa 096")).toBe(103);
    expect(scelto("la 190")).toBe(204);
    expect(scelto("COM-2026-064")).toBe(64);
    expect(scelto("com 2026 190")).toBe(204);
    expect(scelto("2026-096")).toBe(103);
  });

  it("accetta gli ordinali e il nome del cliente; il nome corto preferisce l'etichetta più corta", () => {
    expect(scelto("la prima")).toBe(103);
    expect(scelto("la seconda")).toBe(204);
    expect(scelto("torino")).toBe(64);
    expect(scelto("quella dell'immobiliare")).toBe(204);
    expect(scelto("bertoli")).toBe(103);
    expect(scelto("Bertoli Duilio")).toBe(103);
  });

  it("un numero che è anche ordinale vince come progressivo solo se esiste", () => {
    const conDue = [
      { commessaId: 1, codice: "COM-2026-002", cliente: "Rossi" },
      { commessaId: 2, codice: "COM-2026-031", cliente: "Verdi" },
    ];
    const esito = risolviRispostaChiarificazione("2", conDue);
    expect(esito.stato === "scelto" && esito.candidato.commessaId).toBe(1);
    const esito2 = risolviRispostaChiarificazione("2", CANDIDATI);
    expect(esito2.stato === "scelto" && esito2.candidato.commessaId).toBe(204);
  });

  it("non riconosciuta o ambigua: nessuna scelta a caso", () => {
    expect(scelto("boh")).toBe("non_riconosciuta");
    expect(scelto("999")).toBe("non_riconosciuta");
    const ambiguo = risolviRispostaChiarificazione("duilio", CANDIDATI);
    // «duilio» copre entrambe le Bertoli: vince quella con meno parole estranee.
    expect(ambiguo.stato === "scelto" && ambiguo.candidato.commessaId).toBe(103);
    const pari = risolviRispostaChiarificazione("commessa", CANDIDATI);
    expect(pari.stato).toBe("non_riconosciuta");
  });

  it("la domanda ripetuta spiega come rispondere", () => {
    const testo = domandaChiarificazioneRipetuta(CANDIDATI);
    expect(testo).toContain("1) COM-2026-096 — Bertoli Duilio");
    expect(testo).toContain("col numero");
  });
});
