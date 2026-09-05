// server/computo/motore.test.ts
// Tre commesse reali (fixture) ricalcolate dal foglio «CALCOLO NUOVI LIMITI»:
// sono il giudice del motore. I casi limite coprono ciò che il foglio non
// mostra: zona mancante, piano alto, minimo 1 mq, controtelai, righe senza DEI.
import { describe, expect, it } from "vitest";
import { euroToCent } from "@shared/euroCent";
import casi from "./__fixtures__/casi-reali.json";
import { calcolaLimiti, type ParametriMotore, type RigaMotore } from "./motore";
import { tariffeAttive } from "./tariffe";

const t = tariffeAttive(new Date("2026-09-03"));

function rigaDaFixture(r: any): RigaMotore {
  return {
    categoria: r.categoria, tipologia: r.tipologia, oscuranteIntegrato: r.oscuranteIntegrato,
    oscuranteTipologia: r.oscuranteTipologia, descrizione: r.descrizione, quantita: r.quantita,
    larghezzaMm: r.larghezzaMm, altezzaMm: r.altezzaMm,
    mq: Math.round(((r.larghezzaMm ?? 0) * (r.altezzaMm ?? 0) * r.quantita) / 1_000_000 * 1e6) / 1e6,
    misuraDei: r.misuraDei ?? null, prezzoTotCent: r.prezzoTotCent, beneSignificativo: true,
    accessori: (r.accessori as string[]).map(codice => ({ codice, quantita: r.quantita })),
  };
}
const voce = (esito: ReturnType<typeof calcolaLimiti>, codice: string) => {
  const v = esito.voci.find(x => x.codice === codice);
  if (!v) throw new Error(`voce mancante: ${codice}`);
  return v;
};

describe("motore limiti — casi reali", () => {
  for (const caso of casi.casi) {
    // Un caso con `salta` è raccolto per intero ma non riproducibile finché il
    // motore (o il seed) non copre quel foglio: il motivo sta nella fixture e
    // l'analisi nel report R22. Togliere `salta` è la prova che è risolto.
    const salta = (caso as { salta?: string }).salta;
    (salta ? it.skip : it)(`riproduce il foglio per ${caso.nome}${salta ? ` — saltato: ${salta}` : ""}`, () => {
      const e = calcolaLimiti(caso.righe.map(rigaDaFixture), caso.parametri as ParametriMotore, t);
      // Ogni voce è arrotondata al centesimo; il foglio somma valori non arrotondati:
      // sui totali si ammettono pochi centesimi (tolleranzaTotaliCent), mai di più.
      const toll = caso.attesi.tolleranzaCent;
      const tollTot = caso.attesi.tolleranzaTotaliCent;
      for (const [codice, euro] of Object.entries(caso.attesi.voci)) {
        expect(Math.abs(voce(e, codice).limiteCent - euroToCent(euro as number)), `${codice}`).toBeLessThanOrEqual(toll);
      }
      expect(Math.abs((e.deiProdottiCent ?? 0) - euroToCent(caso.attesi.deiProdotti)), "dei").toBeLessThanOrEqual(toll);
      expect(Math.abs(e.check1Cent - euroToCent(caso.attesi.check1)), "check1").toBeLessThanOrEqual(tollTot);
      expect(Math.abs((e.check2Cent ?? 0) - euroToCent(caso.attesi.check2)), "check2").toBeLessThanOrEqual(tollTot);
      expect(e.limiteCent).toBe(Math.min(e.check1Cent, e.check2Cent!));
      expect(e.esito).toBe("ok");
    });
  }

  it("le voci portano inclusione e appartenenza ai check", () => {
    const caso = casi.casi[0];
    const e = calcolaLimiti(caso.righe.map(rigaDaFixture), caso.parametri as ParametriMotore, t);
    expect(voce(e, "massimale_A")).toMatchObject({ inclusa: true, inCheck1: true, inCheck2: false });
    expect(voce(e, "dei_riga_1")).toMatchObject({ inclusa: true, inCheck1: false, inCheck2: true });
    expect(voce(e, "posa")).toMatchObject({ inclusa: true, inCheck1: true, inCheck2: false });
    expect(voce(e, "rilievo_pezzo").inclusa).toBe(false);
    expect(voce(e, "spese_professionali").inclusa).toBe(false);
    expect(voce(e, "piattaforma").inclusa).toBe(false);
    expect(voce(e, "dei_riga_1").dettaglio).toMatchObject({ codiceDei: "C25077-e", mq: 4.75 });
  });

  it("le opzioni spostano il rilievo, includono spese ed eventuali", () => {
    const caso = casi.casi[0];
    const base = calcolaLimiti(caso.righe.map(rigaDaFixture), caso.parametri as ParametriMotore, t);
    const e = calcolaLimiti(caso.righe.map(rigaDaFixture), { ...(caso.parametri as ParametriMotore), opzioni: { rilievo: "pezzo", speseProfessionali: true, eventuali: ["piattaforma"] } }, t);
    expect(voce(e, "rilievo_pezzo").inclusa).toBe(true);
    expect(voce(e, "rilievo_foro").inclusa).toBe(false);
    expect(e.check1Cent).toBe(base.check1Cent - voce(base, "rilievo_foro").limiteCent + voce(e, "rilievo_pezzo").limiteCent + 60000 + 51792);
    expect(e.check2Cent).toBe(base.check2Cent! - voce(base, "rilievo_foro").limiteCent + voce(e, "rilievo_pezzo").limiteCent + 60000 + 51792);
  });

  it("detraibile e detrazione stimata sull'imponibile stimato del pattuito lordo", () => {
    const caso = casi.casi[2]; // 127: 15.494,72 lordo → 14.086,11 imponibile stimato < limite
    const e = calcolaLimiti(caso.righe.map(rigaDaFixture), caso.parametri as ParametriMotore, t);
    expect(e.detraibileCent).toBe(1408611);
    expect(e.detrazioneStimataCent).toBe(704306);
  });
});

describe("motore limiti — casi limite", () => {
  const caso = casi.casi[2];
  const righe = () => caso.righe.map(rigaDaFixture);
  const parametri = caso.parametri as ParametriMotore;

  it("senza zona: massimali a zero, esito incompleto, avvertenza esplicita", () => {
    const e = calcolaLimiti(righe(), { ...parametri, zona: null }, t);
    expect(voce(e, "massimale_A").limiteCent).toBe(0);
    expect(e.esito).toBe("incompleto");
    expect(e.avvertenze.join(" ")).toMatch(/zona/i);
  });

  it("oltre il 4° piano il tiro costa il 30 % in più; senza km il trasporto è zero con avvertenza", () => {
    const e = calcolaLimiti(righe(), { ...parametri, piano: 5, distanzaKm: null }, t);
    expect(voce(e, "tiro_piano").limiteCent).toBe(Math.round(voce(calcolaLimiti(righe(), parametri, t), "tiro_piano").limiteCent * 1.3));
    expect(voce(e, "trasporto").limiteCent).toBe(0);
    expect(e.avvertenze.join(" ")).toMatch(/distanza/i);
  });

  it("minimo 1 mq sul totale della riga e accessori a perimetro", () => {
    const r: RigaMotore = { categoria: "serramento_pvc", tipologia: "C25077-b", oscuranteIntegrato: null, oscuranteTipologia: null, descrizione: "piccola", quantita: 1, larghezzaMm: 600, altezzaMm: 800, mq: 0.48, misuraDei: null, prezzoTotCent: 50000, beneSignificativo: true, accessori: [{ codice: "serramento.C25126", quantita: 1 }, { codice: "serramento.C25088-h", quantita: 1 }] };
    const e = calcolaLimiti([r], parametri, t);
    // 601,07 × 1 + ribalta 70 + coprifili 1,65 × 2 × (0,6 + 0,8) = 675,69
    expect(voce(e, "dei_riga_1").limiteCent).toBe(67569);
  });

  it("tapparella abbinata: mq maggiorati con minimo 1,8 e motore a pezzo", () => {
    const r: RigaMotore = { categoria: "serramento_pvc", tipologia: "C25077-c", oscuranteIntegrato: "tapparella", oscuranteTipologia: "C25089-a", descrizione: "con tapparella", quantita: 1, larghezzaMm: 1200, altezzaMm: 1400, mq: 1.68, misuraDei: null, prezzoTotCent: 100000, beneSignificativo: true, accessori: [{ codice: "avvolgibile.C25091-d", quantita: 1 }] };
    const e = calcolaLimiti([r], parametri, t);
    // 589,57 × 1,68 = 990,48; tapparella: mq 1,68 + 0,05 × 1,45 + 0,25 × 1,45 = 2,115 → 111,11 × 2,115 = 235,00; motore 176
    expect(Math.abs(voce(e, "dei_riga_1").limiteCent - euroToCent(990.4776 + 234.99765 + 176))).toBeLessThanOrEqual(1);
    expect(voce(e, "massimale_B").limiteCent).toBe(euroToCent(900 * 1.68));
  });

  it("cassonetto: voce scelta dalla classe di mq per pezzo", () => {
    const r: RigaMotore = { categoria: "cassonetto", tipologia: "C25095-a", oscuranteIntegrato: null, oscuranteTipologia: null, descrizione: "cassonetti", quantita: 2, larghezzaMm: 1500, altezzaMm: 400, mq: 1.2, misuraDei: null, prezzoTotCent: 60000, beneSignificativo: true, accessori: [] };
    const e = calcolaLimiti([r], parametri, t);
    // 0,6 mq/pezzo → classe 150×40 (C25095-b) 261,13 × 2
    expect(voce(e, "dei_riga_1")).toMatchObject({ limiteCent: 52226, dettaglio: expect.objectContaining({ voceScelta: "C25095-b" }) });
  });

  it("controtelaio in acciaio sotto 1,2 mq è fatturato a 1,2 mq; variante ignota = avvertenza", () => {
    const controtelaio: RigaMotore = { categoria: "controtelaio", tipologia: "C15145-a", oscuranteIntegrato: null, oscuranteTipologia: null, descrizione: "Controtelaio acciaio", quantita: 2, larghezzaMm: null, altezzaMm: null, mq: 0, misuraDei: 1, prezzoTotCent: null, beneSignificativo: false, accessori: [] };
    const e = calcolaLimiti([...righe(), controtelaio], parametri, t);
    expect(voce(e, "controtelaio_1").limiteCent).toBe(6662); // 55,52 × 1,2
    expect(voce(e, "controtelaio_1")).toMatchObject({ inCheck1: true, inCheck2: true });
    const e2 = calcolaLimiti([...righe(), { ...controtelaio, tipologia: "XX" }], parametri, t);
    expect(e2.avvertenze.join(" ")).toMatch(/controtelaio/i);
  });

  it("una riga senza voce DEI rende CHECK2 non calcolabile: limite = CHECK1, esito incompleto", () => {
    const e = calcolaLimiti([...righe(), { ...righe()[0], tipologia: "sconosciuta" }], parametri, t);
    expect(e.check2Cent).toBeNull();
    expect(e.deiProdottiCent).toBeNull();
    expect(e.limiteCent).toBe(e.check1Cent);
    expect(e.esito).toBe("incompleto");
    const e2 = calcolaLimiti([...righe(), { ...righe()[0], oscuranteIntegrato: "persiana", oscuranteTipologia: null }], parametri, t);
    expect(e2.check2Cent).toBeNull();
    expect(e2.avvertenze.join(" ")).toMatch(/oscurante/i);
  });

  it("un accessorio del gruppo sbagliato è ignorato con avvertenza", () => {
    const e = calcolaLimiti([{ ...righe()[0], accessori: [{ codice: "persiana.C15154-b", quantita: 1 }] }], parametri, t);
    expect(e.avvertenze.join(" ")).toMatch(/accessorio/i);
  });

  const finestra: RigaMotore = { categoria: "serramento_pvc", tipologia: "C25077-c", oscuranteIntegrato: null, oscuranteTipologia: null, descrizione: "finestra", quantita: 1, larghezzaMm: 1200, altezzaMm: 1400, mq: 1.68, misuraDei: null, prezzoTotCent: 100000, beneSignificativo: true, accessori: [] };

  it("la soglia per portefinestre su una finestra è ignorata con avvertenza, e il limite non cambia", () => {
    const senza = calcolaLimiti([finestra], parametri, t);
    const con = calcolaLimiti([{ ...finestra, accessori: [{ codice: "serramento.C25088-c", quantita: 1 }] }], parametri, t);
    expect(voce(con, "dei_riga_1").limiteCent).toBe(voce(senza, "dei_riga_1").limiteCent);
    expect(con.check2Cent).toBe(senza.check2Cent);
    expect(con.avvertenze.join(" ")).toMatch(/soglia.*non applicabile/i);
  });

  it("un accessorio di un'altra famiglia è ignorato: pellicolatura PVC su un serramento in alluminio", () => {
    const r: RigaMotore = { categoria: "serramento_alluminio", tipologia: "C15040-c", oscuranteIntegrato: null, oscuranteTipologia: null, descrizione: "alluminio 2 ante", quantita: 1, larghezzaMm: 1200, altezzaMm: 1400, mq: 1.68, misuraDei: null, prezzoTotCent: 200000, beneSignificativo: true, accessori: [{ codice: "serramento.C25088-a", quantita: 1 }] };
    const e = calcolaLimiti([r], parametri, t);
    expect(voce(e, "dei_riga_1").limiteCent).toBe(euroToCent(729.6 * 1.68)); // niente 15 % di pellicolatura
    expect(e.avvertenze.join(" ")).toMatch(/pellicolat.*non applicabile/i);
  });

  it("una tipologia di un'altra famiglia rende CHECK2 non calcolabile", () => {
    const e = calcolaLimiti([{ ...righe()[0], categoria: "serramento_legno" }], parametri, t); // codice PVC su categoria legno
    expect(e.check2Cent).toBeNull();
    expect(e.esito).toBe("incompleto");
    expect(e.avvertenze.join(" ")).toMatch(/famiglia/i);
  });

  const cassonetto: RigaMotore = { categoria: "cassonetto", tipologia: "C25095-a", oscuranteIntegrato: null, oscuranteTipologia: null, descrizione: "cassonetti", quantita: 2, larghezzaMm: 1500, altezzaMm: 400, mq: 1.2, misuraDei: null, prezzoTotCent: 60000, beneSignificativo: true, accessori: [] };

  it("la classe del cassonetto si cerca nella serie della voce scelta, non in tutta la famiglia", () => {
    const e = calcolaLimiti([{ ...cassonetto, tipologia: "C25096-b" }], parametri, t);
    // 0,6 mq/pezzo → classe 150×40 della serie C25096 (421,16), non 261,13 della C25095.
    expect(voce(e, "dei_riga_1")).toMatchObject({ limiteCent: euroToCent(421.16 * 2), unita: "cad", prezzoUnitCent: 42116, dettaglio: expect.objectContaining({ voceScelta: "C25096-b" }) });
  });

  it("un cassonetto fuori da ogni classe tiene la voce scelta e lo dichiara", () => {
    const r: RigaMotore = { ...cassonetto, tipologia: "C15080-a", quantita: 1, larghezzaMm: 1500, altezzaMm: 700, mq: 1.05 };
    const e = calcolaLimiti([r], parametri, t); // 1,05 mq/pezzo cade nel buco tra le classi monoblocco
    expect(voce(e, "dei_riga_1")).toMatchObject({ limiteCent: euroToCent(547.32), dettaglio: expect.objectContaining({ voceScelta: "C15080-a" }) });
    expect(e.avvertenze.join(" ")).toMatch(/nessuna classe di cassonetto copre 1\.05 mq\/pezzo/i);
  });

  it("una misura DEI mancante vale zero, dichiarato: controtelaio e cassonetto a metro", () => {
    const e = calcolaLimiti([...righe(), { categoria: "controtelaio", tipologia: "C15145-a", oscuranteIntegrato: null, oscuranteTipologia: null, descrizione: "Controtelaio acciaio", quantita: 2, larghezzaMm: null, altezzaMm: null, mq: 0, misuraDei: null, prezzoTotCent: null, beneSignificativo: false, accessori: [] }], parametri, t);
    expect(voce(e, "controtelaio_1").limiteCent).toBe(0);
    expect(e.avvertenze.join(" ")).toMatch(/Controtelaio.*misura DEI mancante/i);
    const e2 = calcolaLimiti([{ ...cassonetto, tipologia: "C25094" }], parametri, t);
    expect(voce(e2, "dei_riga_1")).toMatchObject({ limiteCent: 0, unita: "m" });
    expect(e2.avvertenze.join(" ")).toMatch(/misura DEI mancante/i);
  });
});
