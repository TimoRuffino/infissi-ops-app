// server/fatture/generatore.test.ts
import { describe, expect, it } from "vitest";
import type { Computo, Contratto, RigaContratto } from "@shared/limiti/tipi";
import { FATTURAZIONE_CONFIG_DEFAULT } from "@shared/fatturazione/tipi";
import { descrizioneRigaBene, generaBozza, ricalcola, scadenzeDaRate } from "./generatore";

const ora = new Date("2026-09-04T10:00:00Z");
function contratto(extra: Partial<Contratto> = {}): Contratto {
  return {
    commessaId: 1, sedeId: 1, pattuitoCent: 1549472, pattuitoTipo: "lordo", posaInclusa: true, notePosa: null,
    comuneCantiere: "Sarzana", codiceIstat: null, zonaClimatica: "D", zonaManuale: false, piano: 2, distanzaKm: null,
    detrazioneTipo: "ristrutturazione", detrazioneImmobile: "prima_casa", detrazionePct: 50, dataFirma: "2026-09-03",
    rate: [], opzioniComputo: { rilievo: "foro", speseProfessionali: false, eventuali: [] },
    hashRighe: "h1", hashParametri: "h2", origine: "manuale", documentoId: null, createdBy: null, updatedBy: null,
    createdAt: ora, updatedAt: ora, ...extra,
  } as Contratto;
}
function riga(id: number, descrizione: string, quantita: number, L: number, H: number, prezzoTotCent: number, beneSignificativo = true): RigaContratto {
  return {
    id, sedeId: 1, commessaId: 1, ordine: id, categoria: "serramento_pvc", tipologia: "C25077-e", oscuranteIntegrato: null,
    oscuranteTipologia: null, descrizione, quantita, larghezzaMm: L, altezzaMm: H, mq: 0, misuraDei: null,
    prezzoUnitCent: null, prezzoTotCent, beneSignificativo, accessori: [], note: null, origine: "manuale", evidenza: null,
    createdAt: ora, updatedAt: ora,
  };
}
function computo(): Computo {
  const voce = (ordine: number, gruppo: any, codice: string, descrizione: string, limiteCent: number, extra: any = {}) => ({
    gruppo, codice, descrizione, codiceDei: null, unita: "cad", prezzoUnitCent: 0, quantita: 1, limiteCent, dettaglio: {}, ordine,
    inclusa: true, inCheck1: true, inCheck2: true, ...extra,
  });
  return {
    id: 7, sedeId: 1, commessaId: 1, hashRighe: "h1", hashParametri: "h2", tariffeAl: "2022-04-15", zona: "D", esito: "ok",
    check1Cent: 1951984, check2Cent: 1930728, deiProdottiCent: 1723146, limiteCent: 1930728, detraibileCent: 1408611,
    detrazioneStimataCent: 704306, avvertenze: [], createdBy: null, createdAt: ora,
    voci: [
      voce(1, "prodotti", "massimale_A", "Serramenti — massimale Allegato A", 1603976, { unita: "mq", quantita: 20.5638, prezzoUnitCent: 78000 }),
      voce(10, "opere", "rilievo_foro", "Rilievo tecnico delle misure esecutive", 18051),
      voce(11, "opere", "posa", "POSA IN OPERA certificata", 131400),
      voce(12, "opere", "spese_professionali", "Spese professionali", 60000, { inclusa: false }),
      voce(13, "opere", "altri_servizi", "Altri servizi 2 %", 25000),
      voce(14, "eventuali", "dime", "Dime", 129384, { inclusa: false }),
    ],
  } as Computo;
}
const righe = [riga(1, "Portafinestra a 2 ante a battente", 3, 1900, 2400, 778373), riga(2, "Finestra a 2 ante a battente", 2, 1660, 1540, 295082), riga(3, "Maniglie mod. Lama", 6, 0, 0, 60000, false)];
const base = { cliente: null, commessa: { codice: "COM-2026-001", indirizzo: "Via Alta 80", citta: "Sarzana" }, config: { ...FATTURAZIONE_CONFIG_DEFAULT, sedeId: 1, updatedAt: ora }, dataFattura: "2026-09-04" };

describe("generaBozza", () => {
  it("beni dalle righe, servizi dai limiti arrotondati per difetto, derivate e nota limite", () => {
    const b = generaBozza({ contratto: contratto(), righe, computo: computo(), ...base });
    const tipi = b.righe.map(r => r.tipo);
    expect(tipi[0]).toBe("intestazione");
    expect(b.righe.filter(r => r.tipo === "bene")).toHaveLength(3);
    expect(b.righe.find(r => r.rigaCommessaId === 1)!.descrizione).toBe("N.3 Portafinestra a 2 ante a battente L1900 x H2400");
    expect(b.righe.find(r => r.rigaCommessaId === 3)!.beneSignificativo).toBe(false);
    const servizi = b.righe.filter(r => r.tipo === "servizio");
    expect(servizi.map(s => s.voceComputoCodice)).toEqual(["rilievo_foro", "posa"]); // niente spese prof. (esclusa), altri_servizi, dime
    expect(servizi[0].importoCent).toBe(18000); // 180,51 → 180
    expect(servizi[0].limiteCent).toBe(18051);
    expect(b.righe.some(r => r.tipo === "markup" && r.derivata)).toBe(true);
    expect(b.righe.filter(r => r.tipo === "nota").at(-1)!.descrizione).toMatch(/Calcolo limite massimo spesa zona climatica D/);
    expect(b.diciture).toEqual(["intervento_manutenzione", "bonifico_ristrutturazione", "indicare_cf", "copia_ade", "pagamento_50_40_10", "spese_professionali_escluse"]);
    expect(b.intestazioneCantiere).toBe("Intervento da effettuare presso Via Alta 80 Sarzana");
    expect(b.scadenze.map(s => s.quotaPct)).toEqual([50, 40, 10]);
    expect(b.avvertenze).toContain("Cliente senza codice fiscale: obbligatorio con la detrazione.");
  });
  it("senza computo: nessun servizio e avvertenza", () => {
    const b = generaBozza({ contratto: contratto(), righe, computo: null, ...base });
    expect(b.righe.filter(r => r.tipo === "servizio")).toHaveLength(0);
    expect(b.avvertenze).toContain("Computo assente: nessun servizio proposto.");
  });
});

describe("ricalcola", () => {
  it("toglie le derivate vecchie, ricalcola dal risolutore e rinumera", () => {
    const righeIn = [
      { ordine: 1, tipo: "bene", descrizione: "b", quantita: 1, prezzoUnitCent: 884746, importoCent: 884746, aliquota: 22, voceComputoCodice: null, rigaCommessaId: 1, limiteCent: null, beneSignificativo: true, derivata: false },
      { ordine: 2, tipo: "markup", descrizione: "vecchio", quantita: 1, prezzoUnitCent: 1, importoCent: 1, aliquota: 10, voceComputoCodice: null, rigaCommessaId: null, limiteCent: null, beneSignificativo: false, derivata: true },
      { ordine: 3, tipo: "servizio", descrizione: "s", quantita: 1, prezzoUnitCent: 264500, importoCent: 264500, aliquota: 10, voceComputoCodice: "posa", rigaCommessaId: null, limiteCent: 300000, beneSignificativo: false, derivata: false },
    ] as const;
    const { righe: out, esito } = ricalcola({ righe: righeIn as any, pattuitoCent: 1549652, pattuitoTipo: "lordo" });
    expect(esito.markupCent).toBe(215359);
    expect(out.map(r => r.tipo)).toEqual(["bene", "markup", "servizio", "storno_bs", "riaddebito_bs"]);
    expect(out.map(r => r.ordine)).toEqual([1, 2, 3, 4, 5]);
    expect(out.find(r => r.tipo === "storno_bs")!.importoCent).toBe(-479859);
    expect(out.find(r => r.tipo === "riaddebito_bs")!.importoCent).toBe(479859);
  });
});

describe("scadenzeDaRate", () => {
  it("default 50/40/10 con date 0/60/75 giorni e resto sull'ultima", () => {
    const s = scadenzeDaRate([], 1549652, "2026-09-04");
    expect(s.map(x => x.importoCent)).toEqual([774826, 619861, 154965]);
    expect(s.map(x => x.data)).toEqual(["2026-09-04", "2026-11-03", "2026-11-18"]);
    expect(s.reduce((a, x) => a + x.importoCent, 0)).toBe(1549652);
  });
  it("usa data e giorni della rata quando ci sono", () => {
    const s = scadenzeDaRate([{ numero: 1, quotaPct: 70, giorni: null, data: "2026-10-01", descrizione: "Agos" }, { numero: 2, quotaPct: 30, giorni: 10, data: null, descrizione: null }], 100000, "2026-09-04");
    expect(s.map(x => x.data)).toEqual(["2026-10-01", "2026-09-14"]);
    expect(s.map(x => x.importoCent)).toEqual([70000, 30000]);
  });
});

describe("descrizioneRigaBene", () => {
  it("senza misure niente L×H", () => {
    expect(descrizioneRigaBene(riga(9, "Maniglie", 6, 0, 0, 1))).toBe("N.6 Maniglie");
  });
});
