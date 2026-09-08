import { describe, expect, it } from "vitest";
import type { Computo, Contratto, RigaContratto } from "@shared/limiti/tipi";
import { hrefStampaLimiti, intestazioneLimiti, righeContrattoStampa, sezioniComputoStampa, totaliComputoStampa } from "./limitiStampaView";

const ora = new Date("2026-09-07T08:00:00Z");

const contratto = {
  zonaClimatica: "D",
  piano: 2,
  distanzaKm: 12,
  detrazioneTipo: "ristrutturazione",
  detrazionePct: 50,
  pattuitoCent: 1549472,
  pattuitoTipo: "lordo",
  comuneCantiere: "Sarzana",
  dataFirma: "2026-09-03",
} satisfies Pick<Contratto, "zonaClimatica" | "piano" | "distanzaKm" | "detrazioneTipo" | "detrazionePct" | "pattuitoCent" | "pattuitoTipo" | "comuneCantiere" | "dataFirma">;

function riga(id: number, extra: Partial<RigaContratto>): RigaContratto {
  return {
    id, sedeId: 1, commessaId: 1, ordine: id, categoria: "serramento_pvc", tipologia: "C25077-e", oscuranteIntegrato: null,
    oscuranteTipologia: null, descrizione: "Finestra a 2 ante", quantita: 2, larghezzaMm: 1200, altezzaMm: 1400, mq: 3.36,
    misuraDei: null, prezzoUnitCent: null, prezzoTotCent: 180000, beneSignificativo: true, accessori: [], note: null,
    origine: "manuale", evidenza: null, createdAt: ora, updatedAt: ora, ...extra,
  };
}

const computo: Computo = {
  id: 7, sedeId: 1, commessaId: 1, hashRighe: "h", hashParametri: "p", tariffeAl: "2022-04-15", zona: "D", esito: "ok",
  check1Cent: 1951984, check2Cent: 1930728, deiProdottiCent: 1723146, limiteCent: 1930728, detraibileCent: 1408611,
  detrazioneStimataCent: 704306, avvertenze: ["Piano 2: tiro al piano maggiorato."], createdBy: null, createdAt: ora,
  voci: [
    { gruppo: "prodotti", codice: "massimale_A", descrizione: "Serramenti — massimale Allegato A", codiceDei: null, unita: "€/mq", prezzoUnitCent: 78000, quantita: 3.36, limiteCent: 262080, dettaglio: { zona: "D" }, ordine: 1, inclusa: true, inCheck1: true, inCheck2: false },
    { gruppo: "prodotti", codice: "dei_riga_1", descrizione: "Finestra a 2 ante (DEI C25077-e)", codiceDei: "C25077-e", unita: "€/mq", prezzoUnitCent: 51000, quantita: 3.36, limiteCent: 171360, dettaglio: {}, ordine: 2, inclusa: true, inCheck1: false, inCheck2: true },
    { gruppo: "opere", codice: "posa", descrizione: "POSA IN OPERA certificata", codiceDei: "M01024", unita: "€/ore", prezzoUnitCent: 3650, quantita: 6, limiteCent: 21900, dettaglio: {}, ordine: 10, inclusa: true, inCheck1: true, inCheck2: true },
    { gruppo: "opere", codice: "spese_professionali", descrizione: "Spese professionali", codiceDei: null, unita: "%", prezzoUnitCent: 0, quantita: 1, limiteCent: 60000, dettaglio: {}, ordine: 12, inclusa: false, inCheck1: true, inCheck2: false },
  ],
};

describe("limitiStampaView", () => {
  it("intestazione: parametri del contratto nell'ordine del foglio, poi listino, data ed esito del computo", () => {
    expect(intestazioneLimiti(contratto, computo).map(v => `${v.etichetta}: ${v.valore}`)).toEqual([
      "Cantiere: Sarzana",
      "Zona climatica: D",
      "Piano: 2",
      "Distanza: 12 km",
      "Detrazione: Ristrutturazione (bonus casa) 50 %",
      "Pattuito: € 15.494,72 lordo",
      "Contratto firmato il: 03/09/2026",
      "Listino: 15/04/2022",
      "Calcolato il: 07/09/2026",
      "Esito: Completo",
    ]);
    expect(intestazioneLimiti(null, null)).toEqual([]);
  });

  it("righe del contratto: numero d'ordine, misure in mm, mq e prezzo; senza misure il trattino", () => {
    const righe = righeContrattoStampa([riga(2, {}), riga(1, { descrizione: "Zanzariera", categoria: "zanzariera", larghezzaMm: null, altezzaMm: null, mq: 0, prezzoTotCent: null, quantita: 1 })]);
    expect(righe.map(r => [r.descrizione, r.categoria, r.quantita, r.misure, r.mq, r.prezzo])).toEqual([
      ["Zanzariera", "Zanzariera", "1", "—", "—", "—"],
      ["Finestra a 2 ante", "Serramento PVC", "2", "1200 × 1400 mm", "3,36", "€ 1.800,00"],
    ]);
  });

  it("sezioni del computo: CHECK 1 e CHECK 2 separati, le voci non incluse marcate e fuori dal totale", () => {
    const sezioni = sezioniComputoStampa(computo);
    expect(sezioni.map(s => s.etichetta)).toEqual(["Prodotti · CHECK 1 (Allegato A)", "Prodotti · CHECK 2 (DEI per riga)", "Opere complementari"]);
    expect(sezioni[1]).toMatchObject({ totale: "€ 17.231,46" });
    const opere = sezioni[2];
    expect(opere.righe.map(r => [r.descrizione, r.codiceDei, r.inclusa])).toEqual([
      ["POSA IN OPERA certificata", "M01024", true],
      ["Spese professionali", "", false],
    ]);
    expect(opere.totale).toBe("€ 219,00");
  });

  it("totali e indirizzo della stampa", () => {
    expect(totaliComputoStampa(computo).map(v => v.valore)).toEqual(["€ 19.519,84", "€ 19.307,28", "€ 17.231,46", "€ 19.307,28", "€ 14.086,11", "€ 7.043,06"]);
    expect(hrefStampaLimiti(42)).toBe("/commesse/42/limiti/stampa");
  });
});
