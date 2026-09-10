// L'elenco di sinistra della pagina Fornitori: i fornitori dell'azienda,
// più i mittenti da cui è arrivata una conferma e che non sono ancora
// censiti. Chi ha da decidere sta in cima.
import { describe, expect, it } from "vitest";
import { componiElencoFornitori, daDecidere, type RigaRiepilogo } from "./fornitoriView";

const riga = (fornitore: string, extra: Partial<RigaRiepilogo> = {}): RigaRiepilogo => ({
  fornitore,
  daCollegare: 0,
  incerte: 0,
  collegateTars: 0,
  nelFascicolo: 0,
  inArrivo: 0,
  inRitardo: 0,
  ...extra,
});

describe("componiElencoFornitori", () => {
  it("tre fasce: chi ha da decidere, il resto dell'anagrafica, i candidati", () => {
    const elenco = componiElencoFornitori({
      anagrafica: [
        { id: 1, ragioneSociale: "Alias", attivo: true },
        { id: 2, ragioneSociale: "Pail", attivo: true },
      ],
      riepilogo: [riga("Alias", { daCollegare: 110 }), riga("Pail")],
      candidati: [{ nome: "Vetreria Bianchi", dominio: "vetreriabianchi.it", conferme: 4 }],
    });
    expect(elenco.map(v => v.nome)).toEqual(["Alias", "Pail", "Vetreria Bianchi"]);
    expect(elenco[0].tipo).toBe("anagrafica");
    expect(elenco[2].tipo).toBe("candidato");
  });

  it("un candidato che ha da decidere passa davanti al resto dell'anagrafica", () => {
    const elenco = componiElencoFornitori({
      anagrafica: [{ id: 1, ragioneSociale: "Pail", attivo: true }],
      riepilogo: [riga("Pail"), riga("Primed", { incerte: 7 })],
      candidati: [{ nome: "Primed", dominio: "primed.it", conferme: 7 }],
    });
    expect(elenco.map(v => v.nome)).toEqual(["Primed", "Pail"]);
    expect(daDecidere(elenco[0])).toBe(7);
  });

  it("un fornitore censito non compare anche come candidato", () => {
    const elenco = componiElencoFornitori({
      anagrafica: [{ id: 1, ragioneSociale: "Alias", attivo: true }],
      riepilogo: [riga("Alias", { nelFascicolo: 2 })],
      candidati: [{ nome: "alias", dominio: "aliasblindate.com", conferme: 2 }],
    });
    expect(elenco).toHaveLength(1);
    expect(elenco[0].tipo).toBe("anagrafica");
  });

  it("un fornitore censito che non ha ancora scritto compare lo stesso, senza riepilogo", () => {
    // È la differenza col vecchio elenco, che veniva solo dall'archivio.
    const elenco = componiElencoFornitori({
      anagrafica: [{ id: 1, ragioneSociale: "Korus", attivo: false }],
      riepilogo: [],
      candidati: [],
    });
    expect(elenco[0]).toMatchObject({ tipo: "anagrafica", attivo: false, riepilogo: null });
    expect(daDecidere(elenco[0])).toBe(0);
  });

  it("a anagrafica vuota restano solo i candidati: è l'azienda che comincia", () => {
    const elenco = componiElencoFornitori({
      anagrafica: [],
      riepilogo: [riga("Oskura", { daCollegare: 16 }), riga("Primed", { daCollegare: 40 })],
      candidati: [
        { nome: "Oskura", dominio: "oskura.it", conferme: 16 },
        { nome: "Primed", dominio: "primed.it", conferme: 40 },
      ],
    });
    expect(elenco.map(v => v.nome)).toEqual(["Primed", "Oskura"]);
    expect(elenco.every(v => v.tipo === "candidato")).toBe(true);
  });
});
