// server/fatture/generatore.test.ts
import { describe, expect, it } from "vitest";
import type { Computo, Contratto, RigaContratto } from "@shared/limiti/tipi";
import { DICITURE } from "@shared/fatturazione/diciture";
import { FATTURAZIONE_CONFIG_DEFAULT, type ClienteSnapshot } from "@shared/fatturazione/tipi";
import { ORDINE_SERVIZI_DA_TENERE, QUOTA_BENI_SIGNIFICATIVI, bilancia, descrizioneRigaBene, generaBozza, ricalcola, scadenzeDaRate } from "./generatore";

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
/** Lo stesso computo con la voce delle spese professionali inclusa: è quello che il motore produce con l'opzione attiva sul contratto. */
function computoConSpese(): Computo {
  const c = computo();
  return { ...c, voci: c.voci.map(v => (v.codice === "spese_professionali" ? { ...v, inclusa: true } : v)) };
}
function cliente(praticaEdilizia: ClienteSnapshot["praticaEdilizia"]): ClienteSnapshot {
  return {
    clienteId: 1, nome: "Rossi Mario", tipo: "privato", codiceFiscale: "RSSMRA85T10A562S", partitaIva: null,
    indirizzo: "Via Alta 80", cap: "19038", citta: "Sarzana", provincia: "SP", email: null, pec: null,
    codiceDestinatario: "0000000", ficEntityId: null, praticaEdilizia,
  };
}
const SPESE_PROFESSIONALI = { rilievo: "foro" as const, speseProfessionali: true, eventuali: [] };
const righe = [riga(1, "Portafinestra a 2 ante a battente", 3, 1900, 2400, 778373), riga(2, "Finestra a 2 ante a battente", 2, 1660, 1540, 295082), riga(3, "Maniglie mod. Lama", 6, 0, 0, 60000, false)];
// `bilancia: false`: questi test guardano la proposta grezza (beni a contratto, servizi ai limiti); il bilanciamento ha i suoi test in fondo.
const base = { cliente: null, commessa: { codice: "COM-2026-001", indirizzo: "Via Alta 80", citta: "Sarzana" }, config: { ...FATTURAZIONE_CONFIG_DEFAULT, sedeId: 1, updatedAt: ora }, dataFattura: "2026-09-04", bilancia: false };

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
  it("senza computo: nessun servizio e avvertenza; comuneCantiere vuoto ricade su commessa.citta", () => {
    const b = generaBozza({ contratto: contratto({ comuneCantiere: "" }), righe, computo: null, ...base });
    expect(b.righe.filter(r => r.tipo === "servizio")).toHaveLength(0);
    expect(b.avvertenze).toContain("Computo assente: nessun servizio proposto.");
    expect(b.intestazioneCantiere).toBe("Intervento da effettuare presso Via Alta 80 Sarzana");
  });
  it("senza righe bene (tutte senza prezzo) il markup precede l'intestazione «prestazioni», non l'apertura fattura", () => {
    const righeSenzaPrezzo = righe.map(r => ({ ...r, prezzoTotCent: null }));
    const b = generaBozza({ contratto: contratto(), righe: righeSenzaPrezzo, computo: computo(), ...base });
    expect(b.righe.filter(r => r.tipo === "bene")).toHaveLength(0);
    expect(b.righe.map(r => r.tipo)).toEqual(["intestazione", "intestazione", "markup", "intestazione", "servizio", "servizio", "nota"]);
    expect(b.righe.map(r => r.ordine)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(b.righe.filter(r => r.tipo === "storno_bs" || r.tipo === "riaddebito_bs")).toHaveLength(0); // B=0 → storno 0
    expect(b.avvertenze.filter(a => a.includes("senza prezzo"))).toHaveLength(3);
  });

  // R17 (fatture 92 e 106): le spese di documentazione non sono una
  // prestazione al 10 %, sono una riga al 22 % che entra nei beni
  // significativi — nel riepilogo il 22 % vale B + 150 − P.
  it("R17: le spese di documentazione sono un bene al 22 % dalla configurazione, non un servizio al 10 %", () => {
    const conSpese = contratto({ opzioniComputo: SPESE_PROFESSIONALI });
    const b = generaBozza({ contratto: conSpese, righe, computo: computoConSpese(), ...base });
    const spese = b.righe.find(r => r.voceComputoCodice === "spese_professionali")!;
    expect(spese.tipo).toBe("bene");
    expect(spese.descrizione).toBe("Spese per documentazione detrazione");
    expect(spese.aliquota).toBe(22);
    expect(spese.beneSignificativo).toBe(true);
    expect(spese.quantita).toBe(1);
    expect(spese.importoCent).toBe(15000);
    expect(spese.prezzoUnitCent).toBe(15000);
    expect(spese.limiteCent).toBe(60000);
    expect(spese.derivata).toBe(false);
    expect(spese.rigaCommessaId).toBeNull();
    // Niente servizio al 10 % per la stessa voce, e la dicitura «escluse» sparisce.
    expect(b.righe.filter(r => r.tipo === "servizio").map(r => r.voceComputoCodice)).toEqual(["rilievo_foro", "posa"]);
    expect(b.diciture).not.toContain("spese_professionali_escluse");
    // Sta nel blocco dei beni significativi, prima dei beni autonomi.
    expect(b.righe.findIndex(r => r.descrizione === DICITURE.beni_autonomi)).toBeGreaterThan(b.righe.indexOf(spese));

    const beniSignificativi = b.righe.filter(r => r.tipo === "bene" && r.beneSignificativo).reduce((s, r) => s + r.importoCent, 0);
    expect(beniSignificativi).toBe(778373 + 295082 + 15000);
    const { esito } = ricalcola({ righe: b.righe, pattuitoCent: conSpese.pattuitoCent, pattuitoTipo: conSpese.pattuitoTipo });
    expect(esito.riepilogo.find(r => r.aliquota === 22)!.imponibileCent).toBe(
      beniSignificativi - Math.min(beniSignificativi, esito.prestazioneCent)
    );
  });

  it("R17: l'importo delle spese viene dalla configurazione di sede; senza computo resta senza limite", () => {
    const b = generaBozza({
      contratto: contratto({ opzioniComputo: SPESE_PROFESSIONALI }), righe, computo: null, ...base,
      config: { ...base.config, speseDocumentazioneCent: 20000 },
    });
    const spese = b.righe.find(r => r.voceComputoCodice === "spese_professionali")!;
    expect(spese.importoCent).toBe(20000);
    expect(spese.limiteCent).toBeNull();
    expect(b.diciture).not.toContain("spese_professionali_escluse");
  });

  // R19 (fatture 106 e 119).
  it("R19: con la CILA l'intervento è straordinario e le note portano il template della pratica", () => {
    const b = generaBozza({ contratto: contratto(), righe, computo: computo(), ...base, cliente: cliente("cila") });
    expect(b.diciture).toContain("intervento_straordinaria");
    expect(b.diciture).not.toContain("intervento_manutenzione");
    expect(b.note).toBe("CILA N. {numero} del {data}, rilasciata dal Comune di {comune} e intestata a {intestatario}.");
  });

  it("R19: la CIL compila il tipo ma lascia la manutenzione ordinaria; senza pratica le note restano vuote", () => {
    const conCil = generaBozza({ contratto: contratto(), righe, computo: computo(), ...base, cliente: cliente("cil") });
    expect(conCil.note?.startsWith("CIL N. {numero}")).toBe(true);
    expect(conCil.diciture).toContain("intervento_manutenzione");
    const conScia = generaBozza({ contratto: contratto(), righe, computo: computo(), ...base, cliente: cliente("scia") });
    expect(conScia.note?.startsWith("SCIA N. {numero}")).toBe(true);
    expect(conScia.diciture).toContain("intervento_straordinaria");
    const senza = generaBozza({ contratto: contratto(), righe, computo: computo(), ...base, cliente: cliente("nessuna") });
    expect(senza.note).toBeNull();
    expect(senza.diciture).toContain("intervento_manutenzione");
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

describe("bilancia — la bozza nasce come la fa la commercialista (fase 2 dello studio, 06/09/2026)", () => {
  const somma = (righe: any[], f: (r: any) => boolean) => righe.filter(f).reduce((s: number, r: any) => s + r.importoCent, 0);
  // 85 % di 10.734,55 = 9.124,37 → 9.120,00 ai 10 €; la quota che diventa markup è 1.614,55.
  const CONTRATTO_BENI = 778373 + 295082;
  const BENI_IN_FATTURA = Math.round((CONTRATTO_BENI * QUOTA_BENI_SIGNIFICATIVI) / 1000) * 1000;
  const QUOTA_MARKUP = CONTRATTO_BENI - BENI_IN_FATTURA;

  it("i beni significativi vanno in fattura all'85 % del contratto (ai 10 €, in proporzione) e la quota diventa markup", () => {
    const b = generaBozza({ contratto: contratto(), righe, computo: computo(), ...base, bilancia: true });
    expect(BENI_IN_FATTURA).toBe(912000);
    expect(somma(b.righe, r => r.tipo === "bene" && r.beneSignificativo)).toBe(BENI_IN_FATTURA);
    const r1 = b.righe.find(r => r.rigaCommessaId === 1)!, r2 = b.righe.find(r => r.rigaCommessaId === 2)!;
    expect(Math.abs(r1.importoCent / r2.importoCent - 778373 / 295082)).toBeLessThan(0.001);
    expect(r1.prezzoUnitCent).toBe(r1.importoCent);
    // Le maniglie (non significative) restano a contratto.
    expect(b.righe.find(r => r.rigaCommessaId === 3)!.importoCent).toBe(60000);
    // (it-IT raggruppa le migliaia solo da 10.000 in su: «9120,00».)
    expect(b.avvertenze.some(a => a.startsWith("Beni significativi in fattura a € 9120,00 (85 % del contratto, € 10.734,55): la differenza di € 1614,55"))).toBe(true);
  });

  it("pattuito capiente: servizi ai limiti, markup = quota dei beni + residuo, nessun taglio", () => {
    const b = generaBozza({ contratto: contratto(), righe, computo: computo(), ...base, bilancia: true });
    const grezza = generaBozza({ contratto: contratto(), righe, computo: computo(), ...base });
    expect(b.righe.filter(r => r.tipo === "servizio").map(r => r.importoCent)).toEqual([18000, 131400]);
    const residuo = grezza.righe.find(r => r.tipo === "markup")!.importoCent;
    expect(residuo).toBeGreaterThan(0);
    const markup = b.righe.find(r => r.tipo === "markup")!.importoCent;
    // Il markup cresce almeno della quota dei beni; con il pattuito lordo cresce di più, perché
    // ogni euro passato dal 22 % al 10 % alza l'imponibile a parità di lordo (qui ~395 €).
    expect(markup).toBeGreaterThanOrEqual(residuo + QUOTA_MARKUP);
    expect(markup).toBeLessThan(residuo + QUOTA_MARKUP + 60000);
    expect(b.avvertenze.some(a => a.startsWith("Servizi a €") || a.startsWith("Il pattuito non copre"))).toBe(false);
    const { esito } = ricalcola({ righe: b.righe, pattuitoCent: 1549472, pattuitoTipo: "lordo" });
    expect(Math.abs(esito.totaleCent - 1549472)).toBeLessThanOrEqual(1);
  });

  it("pattuito stretto: i beni restano a contratto e i servizi prendono il residuo, nell'ordine della commercialista", () => {
    // Lordo 14.664,15: con i beni a contratto (10.734,55 + 600) i servizi ai limiti (1.494) non ci stanno.
    const stretto = contratto({ pattuitoCent: 1466415 });
    const b = generaBozza({ contratto: stretto, righe, computo: computo(), ...base, bilancia: true });
    expect(somma(b.righe, r => r.tipo === "bene" && r.beneSignificativo)).toBe(BENI_IN_FATTURA);
    const servizi = b.righe.filter(r => r.tipo === "servizio");
    const S = somma(servizi, () => true);
    expect(S).toBeGreaterThan(0);
    expect(S).toBeLessThan(18000 + 131400);
    for (const r of servizi) expect(r.importoCent % 100).toBe(0);
    // Il rilievo viene prima della posa nell'ordine: resta intero, la posa prende il resto.
    expect(ORDINE_SERVIZI_DA_TENERE.indexOf("rilievo_foro")).toBeLessThan(ORDINE_SERVIZI_DA_TENERE.indexOf("posa"));
    expect(servizi.find(r => r.voceComputoCodice === "rilievo_foro")!.importoCent).toBe(18000);
    expect(servizi.find(r => r.voceComputoCodice === "posa")!.importoCent).toBeLessThan(131400);
    // Il markup è la quota dei beni (più i centesimi dell'arrotondamento all'euro), mai negativo.
    const markup = b.righe.find(r => r.tipo === "markup")!.importoCent;
    expect(markup).toBeGreaterThanOrEqual(QUOTA_MARKUP);
    expect(markup).toBeLessThan(QUOTA_MARKUP + 20000);
    expect(b.avvertenze.some(a => a.startsWith("Servizi a €") && a.includes("«POSA IN OPERA certificata» a €"))).toBe(true);
    expect(b.righe.find(r => r.rigaCommessaId === 3)!.importoCent).toBe(60000);
    const { esito } = ricalcola({ righe: b.righe, pattuitoCent: stretto.pattuitoCent, pattuitoTipo: stretto.pattuitoTipo });
    expect(esito.totaleCent).toBe(1466415);
  });

  it("pattuito strettissimo: le voci in coda spariscono dalla bozza, i beni restano a contratto", () => {
    // Come 128/2026: una finestra a 775,08 + zanzariera 137,50, servizi ai limiti 1.494, pattuito 1.320,41 lordo.
    const guaita = contratto({ pattuitoCent: 132041 });
    const righeG = [riga(1, "Finestra a 1 anta", 1, 1150, 1790, 77508), riga(2, "Zanzariera", 1, 0, 0, 13750, false)];
    const b = generaBozza({ contratto: guaita, righe: righeG, computo: computo(), ...base, bilancia: true });
    const finestra = b.righe.find(r => r.rigaCommessaId === 1)!;
    expect(finestra.importoCent).toBe(Math.round((77508 * QUOTA_BENI_SIGNIFICATIVI) / 1000) * 1000);
    const servizi = b.righe.filter(r => r.tipo === "servizio");
    expect(servizi.length).toBeGreaterThan(0);
    for (const r of servizi) expect(r.importoCent % 100).toBe(0);
    expect(somma(servizi, () => true)).toBeLessThan(18000 + 131400);
    const markup = b.righe.find(r => r.tipo === "markup")!.importoCent;
    expect(markup).toBeGreaterThanOrEqual(0);
    // La zanzariera non è significativa: resta a contratto e al 10 %.
    expect(b.righe.find(r => r.rigaCommessaId === 2)!).toMatchObject({ importoCent: 13750, aliquota: 10, beneSignificativo: false });
    expect(b.avvertenze.some(a => a.startsWith("Beni significativi in fattura"))).toBe(true);
    expect(b.avvertenze.some(a => a.startsWith("Servizi a €"))).toBe(true);
    // Il lordo torna al pattuito a meno del centesimo dell'IVA mista (`deltaPattuitoCent` lo dichiara).
    const { esito } = ricalcola({ righe: b.righe, pattuitoCent: guaita.pattuitoCent, pattuitoTipo: guaita.pattuitoTipo });
    expect(Math.abs(esito.totaleCent - 132041)).toBeLessThanOrEqual(1);
  });

  it("pattuito sotto i beni a contratto: nessun servizio, beni ridotti, markup mai negativo, avvertenza", () => {
    const sotto = contratto({ pattuitoCent: 100000 });
    const righeS = [riga(1, "Finestra a 1 anta", 1, 1150, 1790, 77508), riga(2, "Finestra a 2 ante", 1, 1500, 1400, 90000)];
    const b = generaBozza({ contratto: sotto, righe: righeS, computo: computo(), ...base, bilancia: true });
    expect(b.righe.filter(r => r.tipo === "servizio")).toEqual([]);
    expect(somma(b.righe, r => r.tipo === "bene")).toBeLessThan(77508 + 90000);
    expect(b.righe.find(r => r.tipo === "markup")!.importoCent).toBeGreaterThanOrEqual(0);
    expect(b.avvertenze.some(a => a.startsWith("Il pattuito non copre i beni a contratto"))).toBe(true);
    const { esito } = ricalcola({ righe: b.righe, pattuitoCent: sotto.pattuitoCent, pattuitoTipo: sotto.pattuitoTipo });
    expect(esito.totaleCent).toBe(100000);
  });

  it("senza detrazione i beni restano a contratto: nessuna quota, nessun markup dai beni", () => {
    const b = generaBozza({ contratto: contratto({ detrazioneTipo: "nessuna" }), righe, computo: computo(), ...base, bilancia: true });
    expect(somma(b.righe, r => r.tipo === "bene" && r.beneSignificativo)).toBe(CONTRATTO_BENI);
    expect(b.avvertenze.some(a => a.startsWith("Beni significativi in fattura"))).toBe(false);
  });

  it("bilancia è pura e, con quota 1 e pattuito capiente, non tocca le righe", () => {
    const righeIn = generaBozza({ contratto: contratto(), righe, computo: computo(), ...base }).righe.filter(r => !r.derivata);
    const copia = righeIn.map(r => ({ ...r }));
    const esito = bilancia({ righe: righeIn, pattuitoCent: 1549472, pattuitoTipo: "lordo", quotaBeni: 1 });
    expect(esito.avvertenze).toEqual([]);
    expect(esito.righe.map(r => r.importoCent)).toEqual(copia.map(r => r.importoCent));
    expect(righeIn).toEqual(copia);
  });

  it("i beni non significativi nascono al 10 % e il riepilogo li tiene nella prestazione", () => {
    const b = generaBozza({ contratto: contratto(), righe, computo: computo(), ...base });
    const maniglie = b.righe.find(r => r.rigaCommessaId === 3)!;
    expect(maniglie).toMatchObject({ aliquota: 10, beneSignificativo: false });
    const { esito } = ricalcola({ righe: b.righe, pattuitoCent: 1549472, pattuitoTipo: "lordo" });
    const righe22 = b.righe.filter(r => r.aliquota === 22).reduce((s, r) => s + r.importoCent, 0);
    const righe10 = b.righe.filter(r => r.aliquota === 10).reduce((s, r) => s + r.importoCent, 0);
    expect(righe22).toBe(esito.riepilogo.find(r => r.aliquota === 22)!.imponibileCent);
    expect(righe10).toBe(esito.riepilogo.find(r => r.aliquota === 10)!.imponibileCent);
  });
});
