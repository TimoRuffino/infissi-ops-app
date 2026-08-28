import { describe, expect, it } from "vitest";
import {
  calcolaCostiFissiAzienda,
  type CostoFicPerFissi,
  type VoceDichiarata,
} from "./costiFissiAzienda";

function costo(over: Partial<CostoFicPerFissi> = {}): CostoFicPerFissi {
  return {
    id: 1,
    sedeId: 1,
    tipo: "expense",
    data: "2026-01-15",
    fornitoreNome: "TIM S.p.A.",
    descrizione: "Canone",
    categoriaFic: "Telefonia",
    importoNetto: 100,
    classificazione: "fisso",
    fonteClassificazione: "utente",
    presenteInFic: true,
    ...over,
  };
}

function voce(over: Partial<VoceDichiarata> = {}): VoceDichiarata {
  return {
    id: 1,
    descrizione: "Stipendi",
    fornitore: null,
    importo: 12_000,
    mensile: 12_000,
    cadenza: "mensile",
    categoria: "personale",
    dal: "2026-01",
    al: null,
    note: null,
    ...over,
  };
}

const PERIODO = { periodoDa: "2026-01-01", periodoA: "2026-03-31", sedeId: 1 };

describe("costi fissi dell'azienda", () => {
  it("mensilizza i documenti FiC classificati fisso sui mesi coperti", () => {
    // Tre mesi di dati, €300 in tutto: €100 al mese.
    const r = calcolaCostiFissiAzienda({
      costiFic: [
        costo({ id: 1, data: "2026-01-10" }),
        costo({ id: 2, data: "2026-02-10" }),
        costo({ id: 3, data: "2026-03-10" }),
      ],
      dichiarati: [],
      ...PERIODO,
    });
    expect(r.mesiCoperti).toBe(3);
    expect(r.totaleFic).toBe(100);
    expect(r.totaleMensile).toBe(100);
    expect(r.righe).toHaveLength(1);
    expect(r.righe[0]).toMatchObject({
      fonte: "fic",
      fornitore: "TIM S.p.A.",
      documenti: 3,
      totalePeriodo: 300,
    });
  });

  it("è QUESTO il numero che la classificazione in Acquisti produce", () => {
    // La regressione: classificare un fornitore come `fisso` non alzava
    // nessun totale, e sembrava che la classificazione non si salvasse.
    const dubbio = calcolaCostiFissiAzienda({
      costiFic: [costo({ classificazione: "dubbio", fonteClassificazione: null })],
      dichiarati: [],
      ...PERIODO,
    });
    expect(dubbio.totaleMensile).toBe(0);
    expect(dubbio.documentiDaClassificare).toBe(1);

    const classificato = calcolaCostiFissiAzienda({
      costiFic: [costo({ classificazione: "fisso" })],
      dichiarati: [],
      ...PERIODO,
    });
    expect(classificato.totaleMensile).toBe(100);
    expect(classificato.documentiDaClassificare).toBe(0);
  });

  it("somma le voci dichiarate a quelle FiC", () => {
    const r = calcolaCostiFissiAzienda({
      costiFic: [costo()],
      dichiarati: [voce({ mensile: 12_000 })],
      ...PERIODO,
    });
    expect(r.totaleFic).toBe(100);
    expect(r.totaleDichiarato).toBe(12_000);
    expect(r.totaleMensile).toBe(12_100);
  });

  it("una voce dichiarata sullo stesso fornitore rimpiazza l'aggregato FiC", () => {
    // Contarli entrambi sarebbe contare due volte lo stesso affitto.
    const r = calcolaCostiFissiAzienda({
      costiFic: [
        costo({ id: 1, fornitoreNome: "Immobiliare Rossi S.r.l.", data: "2026-01-05" }),
        costo({ id: 2, fornitoreNome: "IMMOBILIARE ROSSI SRL", data: "2026-02-05" }),
      ],
      dichiarati: [
        voce({ descrizione: "Affitto capannone", fornitore: "Immobiliare Rossi srl", mensile: 900 }),
      ],
      ...PERIODO,
    });
    expect(r.righe).toHaveLength(1);
    expect(r.righe[0].fonte).toBe("dichiarato");
    expect(r.righe[0].sostituisceFic).toBe(100); // 200 / 2 mesi coperti
    expect(r.totaleMensile).toBe(900);
  });

  it("ignora le voci dichiarate non più valide alla fine del periodo", () => {
    const r = calcolaCostiFissiAzienda({
      costiFic: [],
      dichiarati: [
        voce({ id: 1, descrizione: "Chiuso", dal: "2025-01", al: "2026-01", mensile: 500 }),
        voce({ id: 2, descrizione: "In corso", dal: "2026-03", al: null, mensile: 700 }),
        voce({ id: 3, descrizione: "Futuro", dal: "2026-06", al: null, mensile: 900 }),
      ],
      ...PERIODO,
    });
    expect(r.righe.map(r => r.descrizione)).toEqual(["In corso"]);
    expect(r.totaleMensile).toBe(700);
  });

  it("le note di credito passive abbattono il fisso del fornitore", () => {
    const r = calcolaCostiFissiAzienda({
      costiFic: [
        costo({ id: 1, importoNetto: 300, data: "2026-01-10" }),
        costo({ id: 2, tipo: "passive_credit_note", importoNetto: 150, data: "2026-02-10" }),
      ],
      dichiarati: [],
      ...PERIODO,
    });
    expect(r.righe[0].totalePeriodo).toBe(150);
    expect(r.totaleMensile).toBe(75); // 150 / 2 mesi
  });

  it("resta fuori chi non è della sede, chi è sparito da FiC e chi è fuori periodo", () => {
    const r = calcolaCostiFissiAzienda({
      costiFic: [
        costo({ id: 1, sedeId: 2, fornitoreNome: "Altra sede" }),
        costo({ id: 2, presenteInFic: false, fornitoreNome: "Cancellato" }),
        costo({ id: 3, data: "2025-11-01", fornitoreNome: "Vecchio" }),
        costo({ id: 4, data: "2026-02-01", fornitoreNome: "Buono" }),
      ],
      dichiarati: [],
      ...PERIODO,
    });
    expect(r.righe.map(r => r.fornitore)).toEqual(["Buono"]);
  });

  it("non divide mai per zero quando non c'è un solo mese classificato", () => {
    const r = calcolaCostiFissiAzienda({
      costiFic: [costo({ classificazione: "dubbio" })],
      dichiarati: [],
      ...PERIODO,
    });
    expect(r.mesiCoperti).toBe(1);
    expect(Number.isFinite(r.totaleMensile)).toBe(true);
  });
});
