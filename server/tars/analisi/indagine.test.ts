// Punto 19 del piano «Tars più intelligente»: l'analisi può chiedere prima
// di rispondere. Solo letture, pochi giri, e quello che torna è un dato.

import { describe, expect, it } from "vitest";
import { REGISTRO_AZIONI } from "../azioni/registry";
import {
  CHIAMATE_MASSIME_INDAGINE,
  GIRI_MASSIMI_INDAGINE,
  contestoDiIndagine,
  eseguiLettura,
  rispostaPerIlModello,
  strumentiDiIndagine,
} from "./indagine";

describe("il perimetro dell'indagine", () => {
  const strumenti = strumentiDiIndagine();
  const nomi = new Set(strumenti.map(s => s.nome));

  it("ci sono le letture", () => {
    expect(nomi.has("leggi_commessa")).toBe(true);
    expect(nomi.has("cerca_commesse")).toBe(true);
    expect(nomi.has("leggi_fascicolo_commessa")).toBe(true);
  });

  it("e NON c'è nessuna scrittura", () => {
    for (const nome of [
      "crea_ticket",
      "transizione_adiacente_commessa",
      "archivia_commessa",
      "registra_costo_fornitore",
      "archivia_allegato_comunicazione",
    ]) {
      expect(nomi.has(nome)).toBe(false);
    }
  });

  it("il perimetro è esattamente le azioni R0 senza effetto", () => {
    const attese = REGISTRO_AZIONI.filter(
      a => a.rischio === "R0" && a.strumento.effetto === "nessuno"
    ).length;
    expect(strumenti).toHaveLength(attese);
  });

  it("ogni strumento porta descrizione e forma dell'input", () => {
    for (const s of strumenti) {
      expect(s.descrizione.length).toBeGreaterThan(10);
      expect(s.parametri).toHaveProperty("type", "object");
    }
  });
});

describe("il contesto di lettura", () => {
  it("è di sistema, sulla sede, con le capability della direzione", () => {
    const c = contestoDiIndagine(42);
    expect(c.utenteId).toBe(0);
    expect(c.sedeId).toBe(42);
    expect(c.direzione).toBe(true);
    expect(c.capability.has("commessa.read")).toBe(true);
  });
});

describe("eseguire una lettura", () => {
  const contesto = contestoDiIndagine(97_777);

  it("uno strumento fuori perimetro non si esegue, e lo dice", async () => {
    const esito = await eseguiLettura({
      nome: "archivia_commessa",
      argomenti: { commessaId: 1 },
      contesto,
      ammessi: new Set(["leggi_commessa"]),
    });
    expect(esito.errore).toContain("qui si può solo leggere");
    expect(esito.contenuto).toBe("");
  });

  it("uno strumento inesistente non fa cadere il giro", async () => {
    const esito = await eseguiLettura({
      nome: "strumento_inventato",
      argomenti: {},
      contesto,
      ammessi: new Set(["strumento_inventato"]),
    });
    expect(esito.errore).toBe("Strumento sconosciuto.");
  });

  it("parametri sbagliati diventano un dato, non un'eccezione", async () => {
    const esito = await eseguiLettura({
      nome: "leggi_commessa",
      argomenti: { commessaId: "non un numero" },
      contesto,
      ammessi: new Set(["leggi_commessa"]),
    });
    expect(esito.errore).toContain("Parametri non validi");
  });

  it("l'errore torna al modello come JSON, non come testo libero", () => {
    expect(rispostaPerIlModello({ nome: "x", contenuto: "", errore: "rotto" })).toBe(
      '{"errore":"rotto"}'
    );
    expect(rispostaPerIlModello({ nome: "x", contenuto: "", errore: null })).toBe(
      '{"vuoto":true}'
    );
  });
});

describe("i tetti", () => {
  it("pochi giri e poche chiamate: un ciclo che non converge non gira all'infinito", () => {
    expect(GIRI_MASSIMI_INDAGINE).toBeLessThanOrEqual(6);
    expect(CHIAMATE_MASSIME_INDAGINE).toBeLessThanOrEqual(20);
  });
});
