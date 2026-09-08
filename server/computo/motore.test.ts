// server/computo/motore.test.ts
// Tre commesse reali (fixture) ricalcolate dal foglio «CALCOLO NUOVI LIMITI»:
// sono il giudice del motore. I casi limite coprono ciò che il foglio non
// mostra: zona mancante, piano alto, minimo 1 mq, controtelai, righe senza DEI.
import { describe, expect, it } from "vitest";
import { euroToCent } from "@shared/euroCent";
import type { CorrezioneVoce } from "@shared/limiti/tipi";
import casi from "./__fixtures__/casi-reali.json";
import { calcolaLimiti, type ParametriMotore, type RigaMotore } from "./motore";
import { tariffeAttive, tariffeEdizione } from "./tariffe";

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
/**
 * Le tariffe con cui riprodurre un foglio: l'edizione del listino più i prezzi
 * unitari delle opere e il coefficiente €/mc dello smaltimento come stanno in
 * QUEL foglio (le copie compilate li ritoccano a mano). Solo per le fixture:
 * il CRM calcola con `tariffeAttive()`.
 */
function tariffeDelCaso(caso: { edizione?: string; tariffeFoglio?: { opere?: Record<string, number>; smaltimentoEuroMc?: number | null } }) {
  const base = tariffeEdizione(caso.edizione);
  const tf = caso.tariffeFoglio;
  if (!tf) return base;
  const coefficienti = { ...base.coefficienti };
  if (tf.smaltimentoEuroMc != null) coefficienti.smaltimentoEuroMc = tf.smaltimentoEuroMc;
  // Il minimo delle spese professionali (CHECK1 E35: 600 oggi, 185 nei fogli del 2022) è un coefficiente, non un prezzo d'opera.
  if (tf.opere?.spese_professionali != null) coefficienti.speseProfessionaliMinEuro = tf.opere.spese_professionali;
  return {
    ...base,
    opere: base.opere.map(o => (tf.opere && tf.opere[o.codice] != null ? { ...o, prezzo: tf.opere[o.codice] } : o)),
    coefficienti,
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
      const e = calcolaLimiti(caso.righe.map(rigaDaFixture), caso.parametri as ParametriMotore, tariffeDelCaso(caso as any));
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
    // 589,57 × 1,68 = 990,48; tapparella: il cassonetto aggiunge 25 cm di telo
    // su tutta la LARGHEZZA e le guide 5 cm su tutta l'ALTEZZA, quindi
    // mq 1,68 + 0,05 × (1,40 + 0,25) + 0,25 × (1,20 + 0,05) = 2,075
    // → 111,11 × 2,075 = 230,55; motore 176.
    expect(Math.abs(voce(e, "dei_riga_1").limiteCent - euroToCent(990.4776 + 230.55325 + 176))).toBeLessThanOrEqual(1);
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

  it("un cassonetto abbinato al serramento pesa nel massimale B, non in A", () => {
    // Blocco B del foglio: `oscuranteIntegrato` dichiara l'abbinamento (T9/Z9),
    // la tapparella che il cassonetto ospita è già prezzata sulla riga del
    // serramento — quindi nessuna seconda voce DEI e nessun fail-closed.
    const abbinato: RigaMotore = { ...cassonetto, oscuranteIntegrato: "tapparella", oscuranteTipologia: null };
    const inA = calcolaLimiti([cassonetto], parametri, t);
    const inB = calcolaLimiti([abbinato], parametri, t);
    expect(voce(inA, "massimale_A").limiteCent).toBe(euroToCent(780 * 1.2));
    expect(voce(inA, "massimale_B").limiteCent).toBe(0);
    expect(voce(inB, "massimale_A").limiteCent).toBe(0);
    expect(voce(inB, "massimale_B").limiteCent).toBe(euroToCent(900 * 1.2));
    expect(inB.esito).toBe("ok");
    // Tutto il resto somma i cassonetti A e B nello stesso gruppo: rilievo al
    // pezzo (1/8), rimozione tapparelle, smaltimento, tiro, posa, e la voce DEI
    // resta quella del solo cassonetto.
    for (const codice of ["rilievo_pezzo", "rimozione_tapparelle", "smaltimento", "tiro_piano", "posa", "protezione", "dime", "dei_riga_1"]) {
      expect(voce(inB, codice).limiteCent, codice).toBe(voce(inA, codice).limiteCent);
    }
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

describe("motore limiti — correzioni a mano (08/09/2026)", () => {
  const caso = casi.casi[0];
  const righe = () => caso.righe.map(rigaDaFixture);
  const parametri = caso.parametri as ParametriMotore;
  const con = (...correzioni: CorrezioneVoce[]): ParametriMotore => ({ ...parametri, opzioni: { ...parametri.opzioni, correzioni } });
  const nessuna = { quantita: null, prezzoUnitCent: null, limiteCent: null, inclusa: null, motivo: null };
  const base = calcolaLimiti(righe(), parametri, t);
  const opereCheck2 = (e: ReturnType<typeof calcolaLimiti>) =>
    e.voci.filter(v => v.inclusa && v.inCheck2 && v.gruppo !== "prodotti").reduce((s, v) => s + v.limiteCent, 0);

  it("senza correzioni non cambia nulla", () => {
    expect(calcolaLimiti(righe(), con(), t)).toEqual(base);
  });

  it("quantità corretta: il limite si ricalcola, la voce conserva i valori calcolati, i totali seguono, l'avvertenza lo dichiara", () => {
    const e = calcolaLimiti(righe(), con({ ...nessuna, codice: "progettazione", quantita: 10, motivo: "progetto esecutivo" }), t);
    const v = voce(e, "progettazione");
    const b = voce(base, "progettazione");
    expect(v.quantita).toBe(10);
    expect(v.limiteCent).toBe(b.prezzoUnitCent * 10);
    expect(v.dettaglio).toMatchObject({
      correzione: "progetto esecutivo", limiteForzato: false, quantitaCalcolata: b.quantita,
      prezzoCalcolatoCent: b.prezzoUnitCent, limiteCalcolatoCent: b.limiteCent, inclusaCalcolata: b.inclusa,
    });
    expect(e.check1Cent).toBe(base.check1Cent + (b.inclusa ? v.limiteCent - b.limiteCent : 0));
    expect(e.avvertenze.some(a => a.includes("«") && a.includes("corretta a mano") && a.includes("progetto esecutivo"))).toBe(true);
  });

  it("la formula conserva il suo fattore (posa: ore × installatori × prezzo) e la parte fissa (pulizia)", () => {
    const e = calcolaLimiti(righe(), con({ ...nessuna, codice: "posa", quantita: 8 }, { ...nessuna, codice: "pulizia", quantita: 10 }), t);
    const posa = voce(e, "posa");
    expect(posa.limiteCent).toBe(Math.round(posa.prezzoUnitCent * 8 * t.coefficienti.installatori));
    expect(voce(base, "posa").dettaglio.fattore).toBe(t.coefficienti.installatori);
    const pulizia = voce(e, "pulizia");
    const fisso = euroToCent(voce(base, "pulizia").dettaglio.fisso as number);
    expect(pulizia.limiteCent).toBe(fisso + pulizia.prezzoUnitCent * 10);
    expect(voce(base, "pulizia").dettaglio.fattore).toBeUndefined();
  });

  it("prezzo corretto su un massimale: € 900/mq per i mq del blocco", () => {
    const e = calcolaLimiti(righe(), con({ ...nessuna, codice: "massimale_A", prezzoUnitCent: 90000 }), t);
    const v = voce(e, "massimale_A");
    expect(v.limiteCent).toBe(Math.round(90000 * v.quantita));
    expect(v.dettaglio.prezzoCalcolatoCent).toBe(voce(base, "massimale_A").prezzoUnitCent);
  });

  it("un limite forzato vince su quantità e prezzo; «esclusa» toglie la voce dai totali; un codice ignoto è ignorato con avvertenza", () => {
    const e = calcolaLimiti(righe(), con(
      { ...nessuna, codice: "sviluppo_ordine", quantita: 99, limiteCent: 123456 },
      { ...nessuna, codice: "posa", inclusa: false, motivo: "posa del cliente" },
      { ...nessuna, codice: "voce_che_non_esiste", quantita: 1 }
    ), t);
    const sviluppo = voce(e, "sviluppo_ordine");
    expect(sviluppo.limiteCent).toBe(123456);
    expect(sviluppo.dettaglio.limiteForzato).toBe(true);
    const posa = voce(e, "posa");
    expect(posa.inclusa).toBe(false);
    expect(posa.limiteCent).toBe(voce(base, "posa").limiteCent);
    expect(e.check1Cent).toBe(base.check1Cent - voce(base, "sviluppo_ordine").limiteCent + 123456 - voce(base, "posa").limiteCent);
    expect(e.avvertenze.some(a => a.includes("esclusa dai totali") && a.includes("posa del cliente"))).toBe(true);
    expect(e.avvertenze.some(a => a.includes("voce_che_non_esiste") && a.includes("ignorata"))).toBe(true);
  });

  it("una voce DEI corretta entra nel totale prodotti (T6) e nel CHECK 2 in centesimi", () => {
    const e = calcolaLimiti(righe(), con({ ...nessuna, codice: "dei_riga_1", limiteCent: 100000, motivo: "prezzo concordato" }), t);
    expect(voce(e, "dei_riga_1").limiteCent).toBe(100000);
    const sommaDei = e.voci.filter(v => v.inclusa && v.codice.startsWith("dei_riga_")).reduce((s, v) => s + v.limiteCent, 0);
    expect(e.deiProdottiCent).toBe(sommaDei);
    expect(e.check2Cent).toBe(sommaDei + opereCheck2(e));
    expect(e.limiteCent).toBe(Math.min(e.check1Cent, e.check2Cent!));
  });
});
