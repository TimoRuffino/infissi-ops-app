import { describe, expect, it } from "vitest";
import { OPZIONI_COMPUTO_DEFAULT } from "@shared/limiti/tipi";
import type {
  CategoriaRiga,
  DetrazioneTipo,
  OscuranteIntegrato,
  PattuitoTipo,
  RataContratto,
} from "@shared/limiti/tipi";
import type {
  CampoProposto,
  PropostaContratto,
  RigaProposta,
} from "@shared/contratti/estrazione";
import {
  accessoriCompatibili,
  accessoriDisponibili,
  avvisiForm,
  beneSignificativoDefault,
  campiDaVerificare,
  erroriForm,
  etichettaAccessorio,
  etichettaCategoria,
  etichettaTipologia,
  mqRigaForm,
  opzioniTipologia,
  parametriDaProposta,
  parametriDaServer,
  parametriVuoti,
  prodottiPerOscurante,
  prodottiPerRiga,
  quantitaAccessorioModificabile,
  rateDefault,
  riepilogoControlli,
  riepilogoContratto,
  rigaDaLegacy,
  rigaDaProposta,
  rigaDaServer,
  rigaVuota,
  totaleRigheCent,
  zonaPerRevisione,
  type AccessorioCatalogo,
  type ProdottoCatalogo,
} from "./contrattoView";

const parametriBase = {
  pattuitoCent: 0,
  pattuitoTipo: "lordo" as const,
  posaInclusa: true,
  notePosa: null,
  comuneCantiere: null,
  zonaManuale: true,
  zonaClimatica: null,
  piano: null,
  distanzaKm: null,
  detrazioneTipo: "nessuna" as const,
  detrazioneImmobile: null,
  detrazionePct: null,
  dataFirma: null,
  rate: [{ numero: 1, quotaPct: 60, giorni: 0, data: null, descrizione: null }],
  opzioniComputo: OPZIONI_COMPUTO_DEFAULT,
  origine: "manuale" as const,
  documentoId: null,
};

const prodotto = (p: Partial<ProdottoCatalogo> & { codice: string }): ProdottoCatalogo => ({
  gruppo: "serramento",
  famiglia: "pvc",
  nome: p.codice,
  prezzo: 100,
  unita: "mq",
  zone: null,
  portafinestra: false,
  ...p,
});
const accessorio = (a: Partial<AccessorioCatalogo> & { codice: string }): AccessorioCatalogo => ({
  gruppo: "serramento",
  famiglie: [],
  nome: a.codice,
  regola: "pct_mq",
  valore: 10,
  soloPortafinestra: false,
  ...a,
});

// Fabbriche della proposta di estrazione (piano 3): un campo proposto è
// sempre valore + evidenza + verifica, e il default qui è il caso pessimo —
// niente valore, niente evidenza — così ogni test dichiara solo ciò che
// conta per sé.
const campo = <T>(valore: T, extra: Partial<CampoProposto<T>> = {}): CampoProposto<T> => ({
  valore,
  evidenza: null,
  daVerificare: false,
  nota: null,
  ...extra,
});

const proposta = (patch: Partial<PropostaContratto> = {}): PropostaContratto => ({
  righe: [],
  pattuitoCent: campo<number | null>(null),
  pattuitoTipo: campo<PattuitoTipo | null>(null),
  posaInclusa: campo(true),
  posaCent: campo<number | null>(null),
  notePosa: null,
  rate: campo<RataContratto[]>([]),
  comuneCantiere: campo<string | null>(null),
  indirizzoCantiere: campo<string | null>(null),
  provinciaCantiere: null,
  piano: campo<number | null>(null),
  dataFirma: campo<string | null>(null),
  riferimento: campo<string | null>(null),
  clienteCitato: campo<string | null>(null),
  detrazioneTipo: campo<DetrazioneTipo | null>(null),
  note: null,
  controlli: [],
  avvertenze: [],
  ...patch,
});

const rigaProposta = (patch: Partial<RigaProposta> = {}): RigaProposta => ({
  ordine: 1,
  categoria: campo<CategoriaRiga>("serramento_pvc"),
  tipologia: campo<string | null>(null),
  descrizione: campo("Finestra"),
  quantita: campo(1),
  larghezzaMm: campo<number | null>(null),
  altezzaMm: campo<number | null>(null),
  prezzoTotCent: campo<number | null>(null),
  oscuranteIntegrato: campo<OscuranteIntegrato | null>(null),
  oscuranteTipologia: campo<string | null>(null),
  quotaOscuranteCent: null,
  accessori: [],
  beneSignificativo: true,
  note: null,
  avvertenze: [],
  ...patch,
});

describe("contrattoView", () => {
  it("una riga nuova è un serramento PVC, bene significativo, senza misure", () => {
    const r = rigaVuota();
    expect(r.categoria).toBe("serramento_pvc");
    expect(r.beneSignificativo).toBe(true);
    expect(r.quantita).toBe(1);
    expect(r.tipologia).toBeNull();
    expect(r.oscuranteTipologia).toBeNull();
    expect(r.chiave).toMatch(/^r-/);
    expect(rigaVuota().chiave).not.toBe(r.chiave);
  });

  it("il bene significativo segue la categoria", () => {
    expect(beneSignificativoDefault("serramento_pvc")).toBe(true);
    expect(beneSignificativoDefault("controtelaio")).toBe(false);
    expect(beneSignificativoDefault("altro")).toBe(false);
    // P3-R7: coprifili, maniglie e simili sono «altri beni» nelle fatture reali.
    expect(beneSignificativoDefault("accessorio")).toBe(false);
    expect(rigaVuota("controtelaio").beneSignificativo).toBe(false);
  });

  it("mq e totali come il server", () => {
    expect(mqRigaForm({ quantita: 3, larghezzaMm: 1900, altezzaMm: 2400 })).toBe(13.68);
    // Sei decimali come mqRiga del servizio: 5,1128 mq, non 5,113.
    expect(mqRigaForm({ quantita: 2, larghezzaMm: 1660, altezzaMm: 1540 })).toBe(5.1128);
    expect(mqRigaForm({ quantita: 1, larghezzaMm: null, altezzaMm: 1540 })).toBe(0);
    expect(totaleRigheCent([{ prezzoTotCent: 500000 }, { prezzoTotCent: null }, { prezzoTotCent: 324746 }])).toBe(824746);
  });

  it("etichette leggibili e rate 50/40/10", () => {
    expect(etichettaCategoria("serramento_legno_alluminio")).toBe("Serramento legno-alluminio");
    expect(rateDefault().map(r => r.quotaPct)).toEqual([50, 40, 10]);
    expect(rateDefault().reduce((s, r) => s + r.quotaPct, 0)).toBe(100);
    // Ogni rata ha giorni o data: il servizio rifiuta le rate senza scadenza.
    expect(rateDefault().every(r => r.giorni != null || r.data != null)).toBe(true);
  });

  it("la tipologia si legge dal catalogo DEI, non da un elenco fisso", () => {
    const prodotti = [prodotto({ codice: "C25077-c", nome: "PVC finestra a 2 ante" })];
    expect(etichettaTipologia("C25077-c", prodotti)).toBe("PVC finestra a 2 ante");
    expect(etichettaTipologia("C99999-z", prodotti)).toBe("C99999-z");
    expect(etichettaTipologia(null, prodotti)).toBe("—");
  });

  it("il riepilogo per il banner", () => {
    expect(riepilogoContratto({ pattuitoCent: 1539500, pattuitoTipo: "lordo", zonaClimatica: "D" }, 6)).toBe("6 righe · pattuito € 15.395,00 lordo · zona D");
    expect(riepilogoContratto({ pattuitoCent: 100000, pattuitoTipo: "imponibile", zonaClimatica: null }, 1)).toBe("1 riga · pattuito € 1.000,00 imponibile");
    expect(riepilogoContratto(null, 0)).toBe("Contratto non ancora inserito");
  });

  it("gli errori del form anticipano quelli del server", () => {
    const errori = erroriForm(parametriBase, [{ ...rigaVuota(), descrizione: "" }]);
    expect(errori).toEqual(expect.arrayContaining([
      expect.stringMatching(/pattuito/i),
      expect.stringMatching(/zona/i),
      expect.stringMatching(/rate/i),
      expect.stringMatching(/descrizione/i),
    ]));
  });

  it("una rata senza scadenza e una misura a metà sono errori", () => {
    const errori = erroriForm(
      { ...parametriBase, pattuitoCent: 1000, zonaManuale: false, rate: [{ numero: 1, quotaPct: 100, giorni: null, data: null, descrizione: null }] },
      [{ ...rigaVuota(), descrizione: "Finestra", larghezzaMm: 1200, altezzaMm: null }]
    );
    expect(errori).toEqual(expect.arrayContaining([
      expect.stringMatching(/rata 1/i),
      expect.stringMatching(/altezza/i),
    ]));
    expect(errori.some(e => /pattuito/i.test(e))).toBe(false);
  });

  it("un contratto completo non ha errori", () => {
    const righe = [{ ...rigaVuota(), descrizione: "Finestra", larghezzaMm: 1660, altezzaMm: 1540 }];
    expect(erroriForm({ ...parametriBase, pattuitoCent: 1539500, zonaManuale: false, rate: rateDefault() }, righe)).toEqual([]);
  });

  it("la voce DEI mancante è un avviso, non un errore", () => {
    const prodotti = [
      prodotto({ codice: "C25077-c", nome: "PVC finestra a 2 ante" }),
      prodotto({ codice: "C15078-a", gruppo: "avvolgibile", famiglia: "pvc", nome: "Avvolgibile PVC" }),
    ];
    const senzaVoce = { ...rigaVuota(), descrizione: "Finestra" };
    expect(avvisiForm([senzaVoce], prodotti)).toEqual([expect.stringMatching(/riga 1/i)]);
    expect(erroriForm({ ...parametriBase, pattuitoCent: 1000, zonaManuale: false, rate: rateDefault() }, [senzaVoce])).toEqual([]);

    const conVoce = { ...senzaVoce, tipologia: "C25077-c" };
    expect(avvisiForm([conVoce], prodotti)).toEqual([]);
    // Tipologia di un altro gruppo: il computo non la sa prezzare.
    expect(avvisiForm([{ ...senzaVoce, tipologia: "C15078-a" }], prodotti)).toHaveLength(1);
    // Categoria senza voce DEI: nessun avviso.
    expect(avvisiForm([{ ...senzaVoce, categoria: "altro" }], prodotti)).toEqual([]);
    // Oscurante dichiarato ma senza voce DEI.
    expect(avvisiForm([{ ...conVoce, oscuranteIntegrato: "tapparella" }], prodotti)).toEqual([
      expect.stringMatching(/oscurante/i),
    ]);
    expect(avvisiForm([{ ...conVoce, oscuranteIntegrato: "tapparella", oscuranteTipologia: "C15078-a" }], prodotti)).toEqual([]);
    // Catalogo non ancora caricato: non si accusa una tipologia già scritta.
    expect(avvisiForm([conVoce], [])).toEqual([]);
  });

  it("il catalogo si filtra per categoria, zona e oscurante", () => {
    const prodotti = [
      prodotto({ codice: "pvc-1" }),
      prodotto({ codice: "all-1", famiglia: "alluminio", zone: ["D", "E"] }),
      prodotto({ codice: "all-2", famiglia: "alluminio", zone: ["A", "B"] }),
      prodotto({ codice: "tap-1", gruppo: "avvolgibile", famiglia: "pvc" }),
    ];
    expect(prodottiPerRiga(prodotti, "serramento_pvc", "D").map(p => p.codice)).toEqual(["pvc-1"]);
    expect(prodottiPerRiga(prodotti, "serramento_alluminio", "D").map(p => p.codice)).toEqual(["all-1"]);
    expect(prodottiPerRiga(prodotti, "serramento_alluminio", null).map(p => p.codice)).toEqual(["all-1", "all-2"]);
    expect(prodottiPerRiga(prodotti, "altro", "D")).toEqual([]);
    expect(prodottiPerOscurante(prodotti, "tapparella").map(p => p.codice)).toEqual(["tap-1"]);
  });

  it("gli accessori seguono il prodotto della riga e quello dell'oscurante", () => {
    const accessori = [
      accessorio({ codice: "serramento.pellicola", famiglie: ["pvc"], nome: "Pellicolata" }),
      accessorio({ codice: "serramento.maniglione", soloPortafinestra: true, regola: "cad_pezzo", nome: "Maniglione" }),
      accessorio({ codice: "serramento.legno", famiglie: ["legno"], nome: "Solo legno" }),
      accessorio({ codice: "avvolgibile.motore", gruppo: "avvolgibile", regola: "cad_pezzo", nome: "Motore" }),
    ];
    const finestra = prodotto({ codice: "pvc-1" });
    const portafinestra = prodotto({ codice: "pvc-2", portafinestra: true });
    const tapparella = prodotto({ codice: "tap-1", gruppo: "avvolgibile", famiglia: "pvc" });

    expect(accessoriDisponibili(accessori, [finestra]).map(a => a.codice)).toEqual(["serramento.pellicola"]);
    expect(accessoriDisponibili(accessori, [portafinestra]).map(a => a.codice)).toEqual([
      "serramento.pellicola",
      "serramento.maniglione",
    ]);
    expect(accessoriDisponibili(accessori, [finestra, tapparella]).map(a => a.codice)).toEqual([
      "serramento.pellicola",
      "avvolgibile.motore",
    ]);
    expect(accessoriDisponibili(accessori, [null, undefined])).toEqual([]);

    expect(etichettaAccessorio("avvolgibile.motore", accessori)).toBe("Motore");
    expect(etichettaAccessorio("sconosciuto", accessori)).toBe("sconosciuto");
    // Percentuali e forfait non hanno una quantità da digitare.
    expect(quantitaAccessorioModificabile("pct_mq")).toBe(false);
    expect(quantitaAccessorioModificabile("cad_fisso")).toBe(false);
    expect(quantitaAccessorioModificabile("cad_pezzo")).toBe(true);
    expect(quantitaAccessorioModificabile("m_perimetro")).toBe(true);
  });

  it("la voce già scelta resta nell'elenco anche quando i filtri la escludono", () => {
    const prodotti = [
      prodotto({ codice: "pvc-1", nome: "PVC 1 anta" }),
      prodotto({ codice: "all-fuori", famiglia: "alluminio", nome: "Alluminio zona A", zone: ["A"] }),
      prodotto({ codice: "tap-1", gruppo: "avvolgibile", famiglia: "pvc", nome: "Avvolgibile" }),
    ];
    // Nessuna voce scelta: solo l'elenco filtrato.
    expect(opzioniTipologia(prodotti, "serramento_pvc", "D", null)).toEqual([
      { codice: "pvc-1", etichetta: "PVC 1 anta", anomala: false },
    ]);
    // Voce già scelta e già nell'elenco: nessun doppione.
    expect(opzioniTipologia(prodotti, "serramento_pvc", "D", "pvc-1")).toHaveLength(1);
    // Fuori zona: in coda, con il perché nell'etichetta.
    expect(opzioniTipologia(prodotti, "serramento_alluminio", "D", "all-fuori")).toEqual([
      { codice: "all-fuori", etichetta: "Alluminio zona A — fuori zona", anomala: true },
    ]);
    // Voce di un altro gruppo e codice sconosciuto (contratti vecchi).
    expect(opzioniTipologia(prodotti, "serramento_pvc", "D", "tap-1").at(-1)).toEqual({
      codice: "tap-1", etichetta: "Avvolgibile — altra categoria", anomala: true,
    });
    expect(opzioniTipologia(prodotti, "serramento_pvc", "D", "finestra_2_ante").at(-1)).toEqual({
      codice: "finestra_2_ante", etichetta: "finestra_2_ante — non in catalogo", anomala: true,
    });
  });

  it("la voce fuori zona è un avviso, con la descrizione della riga", () => {
    const prodotti = [prodotto({ codice: "all-a", famiglia: "alluminio", nome: "Alluminio zona A", zone: ["A"] })];
    const riga = {
      ...rigaVuota("serramento_alluminio"),
      descrizione: "Finestra cucina",
      tipologia: "all-a",
    };
    expect(avvisiForm([riga], prodotti, "D")).toEqual([
      'Riga 1 «Finestra cucina»: la tipologia «Alluminio zona A» non vale per la zona D.',
    ]);
    // Nella sua zona non c'è niente da dire; senza zona non si giudica.
    expect(avvisiForm([riga], prodotti, "A")).toEqual([]);
    expect(avvisiForm([riga], prodotti, null)).toEqual([]);
    // Riga senza descrizione: resta il solo numero.
    expect(avvisiForm([{ ...riga, descrizione: "  " }], prodotti, "D")[0]).toMatch(/^Riga 1: /);
  });

  it("gli accessori non compatibili cadono quando cambia il prodotto", () => {
    const accessori = [
      accessorio({ codice: "serramento.pellicola" }),
      accessorio({ codice: "avvolgibile.motore", gruppo: "avvolgibile", regola: "cad_pezzo" }),
    ];
    const scelti = [
      { codice: "serramento.pellicola", quantita: 2 },
      { codice: "avvolgibile.motore", quantita: 1 },
    ];
    expect(accessoriCompatibili(scelti, accessori)).toEqual(scelti);
    expect(accessoriCompatibili(scelti, [accessori[0]])).toEqual([{ codice: "serramento.pellicola", quantita: 2 }]);
    expect(accessoriCompatibili(scelti, [])).toEqual([]);
  });

  it("un prodotto legacy diventa una riga da completare", () => {
    const r = rigaDaLegacy({ id: 3, nome: "Finestra cucina", tipologia: "PVC", quantita: 2, dimensioni: "120x140", note: null });
    expect(r.descrizione).toBe("Finestra cucina");
    expect(r.quantita).toBe(2);
    expect(r.origine).toBe("prodotto_legacy");
    expect(r.note).toBe("120x140");
    // Categoria «altro»: nessun gruppo DEI, quindi la tipologia legacy resta
    // testo libero e non produce avvisi.
    expect(r.categoria).toBe("altro");
    expect(r.tipologia).toBe("PVC");
    expect(avvisiForm([r], [prodotto({ codice: "C25077-c" })])).toEqual([]);
  });

  it("i parametri vuoti partono dalle opzioni di computo di default", () => {
    const p = parametriVuoti();
    expect(p.opzioniComputo).toEqual(OPZIONI_COMPUTO_DEFAULT);
    expect(p.rate.map(r => r.quotaPct)).toEqual([50, 40, 10]);
    expect(p.posaCent).toBeNull();
    // Niente riferimenti condivisi: modificare il form non tocca la costante.
    p.opzioniComputo.eventuali.push("dime");
    expect(OPZIONI_COMPUTO_DEFAULT.eventuali).toEqual([]);
  });

  it("un contratto salvato torna nel form senza hash né firme", () => {
    const p = parametriDaServer({
      commessaId: 42, sedeId: 1, pattuitoCent: 1539500, pattuitoTipo: "lordo", posaInclusa: true,
      posaCent: 110000, notePosa: null, comuneCantiere: "Sarzana", codiceIstat: "011026", zonaClimatica: "D",
      zonaManuale: false, piano: 2, distanzaKm: 18, detrazioneTipo: "ristrutturazione",
      detrazioneImmobile: "prima_casa", detrazionePct: 50, dataFirma: "2026-08-20",
      rate: rateDefault(), opzioniComputo: { rilievo: "pezzo", speseProfessionali: true, eventuali: ["dime"] },
      hashRighe: "h1", hashParametri: "h2", origine: "manuale", documentoId: null, estrazioneId: 7,
      createdBy: 1, updatedBy: 1, createdAt: new Date(), updatedAt: new Date(),
    });
    expect(p.pattuitoCent).toBe(1539500);
    expect(p.posaCent).toBe(110000);
    expect(p.estrazioneId).toBe(7);
    expect(p.zonaClimatica).toBe("D");
    expect(p.opzioniComputo).toEqual({ rilievo: "pezzo", speseProfessionali: true, eventuali: ["dime"] });
    // La percentuale non torna indietro: per il servizio sarebbe un override
    // manuale e la detrazione smetterebbe di seguire tipo, immobile e anno.
    expect(p.detrazionePct).toBeNull();
    expect(Object.keys(p)).not.toContain("hashRighe");
    expect(Object.keys(p)).not.toContain("sedeId");
    expect(Object.keys(p)).not.toContain("codiceIstat");
  });

  it("una riga salvata torna nel form senza i campi calcolati dal server", () => {
    const r = rigaDaServer({
      id: 7, sedeId: 1, commessaId: 42, ordine: 1, categoria: "serramento_pvc", tipologia: "C25077-c",
      oscuranteIntegrato: null, oscuranteTipologia: null, descrizione: "Finestra", quantita: 2,
      larghezzaMm: 1660, altezzaMm: 1540, mq: 5.1128, misuraDei: null, prezzoUnitCent: null,
      prezzoTotCent: 300000, beneSignificativo: true, accessori: [{ codice: "serramento.pellicola", quantita: 2 }],
      note: null, origine: "manuale", evidenza: null, createdAt: new Date(), updatedAt: new Date(),
    });
    expect(r.chiave).toBe("r-7");
    expect(r.descrizione).toBe("Finestra");
    expect(r.accessori).toEqual([{ codice: "serramento.pellicola", quantita: 2 }]);
    expect(Object.keys(r)).not.toContain("mq");
    expect(Object.keys(r)).not.toContain("sedeId");
    expect(Object.keys(r)).not.toContain("createdAt");
  });

  it("una proposta senza pattuito apre il form su zero e «lordo», non su un buco", () => {
    const p = parametriDaProposta(proposta(), 31);
    // Il contratto è di origine estrazione e sa da quale documento viene;
    // l'id dell'estrazione lo scrive il server quando applica (P3-R21).
    expect(p.pattuitoCent).toBe(0);
    expect(p.pattuitoTipo).toBe("lordo");
    expect(p.detrazioneTipo).toBe("nessuna");
    expect(p.origine).toBe("estrazione");
    expect(p.documentoId).toBe(31);
    expect(p.estrazioneId).toBeNull();
    // La zona la deriva il server dal comune: la proposta non la sceglie
    // a mano, altrimenti il form partirebbe con un override mai chiesto.
    expect(p.zonaManuale).toBe(false);
    expect(p.zonaClimatica).toBeNull();
    expect(p.distanzaKm).toBeNull();
    expect(p.detrazioneImmobile).toBeNull();
    expect(p.detrazionePct).toBeNull();
    expect(p.opzioniComputo).toEqual(OPZIONI_COMPUTO_DEFAULT);
    // Niente riferimenti condivisi con la costante, come per `parametriVuoti`.
    p.opzioniComputo.eventuali.push("dime");
    expect(OPZIONI_COMPUTO_DEFAULT.eventuali).toEqual([]);
  });

  it("i valori letti dal contratto arrivano nel form come sono", () => {
    const rate: RataContratto[] = [
      { numero: 1, quotaPct: 30, giorni: 0, data: null, descrizione: "All'ordine" },
      { numero: 2, quotaPct: 70, giorni: 30, data: null, descrizione: null },
    ];
    const p = parametriDaProposta(
      proposta({
        pattuitoCent: campo<number | null>(1539500, { evidenza: { pagina: 2, frammento: "€ 15.395,00" } }),
        pattuitoTipo: campo<PattuitoTipo | null>("imponibile"),
        posaInclusa: campo(true),
        posaCent: campo<number | null>(110000),
        notePosa: "Posa compresa a corpo",
        comuneCantiere: campo<string | null>("Sarzana"),
        piano: campo<number | null>(2),
        dataFirma: campo<string | null>("2026-08-20"),
        detrazioneTipo: campo<DetrazioneTipo | null>("ristrutturazione"),
        rate: campo(rate),
      }),
      31
    );
    expect(p.pattuitoCent).toBe(1539500);
    expect(p.pattuitoTipo).toBe("imponibile");
    expect(p.posaInclusa).toBe(true);
    expect(p.posaCent).toBe(110000);
    expect(p.notePosa).toBe("Posa compresa a corpo");
    expect(p.comuneCantiere).toBe("Sarzana");
    expect(p.piano).toBe(2);
    expect(p.dataFirma).toBe("2026-08-20");
    expect(p.detrazioneTipo).toBe("ristrutturazione");
    expect(p.rate).toEqual(rate);
    // Copiate, non condivise: correggere una quota nel form non riscrive
    // la proposta che l'operatore sta confrontando col PDF.
    p.rate[0].quotaPct = 50;
    expect(rate[0].quotaPct).toBe(30);
  });

  it("una riga proposta conserva evidenza e accessori, e nasce «estrazione»", () => {
    const r = rigaDaProposta(
      rigaProposta({
        categoria: campo<CategoriaRiga>("serramento_alluminio"),
        tipologia: campo<string | null>("C25077-c"),
        descrizione: campo("Finestra 2 ante", {
          evidenza: { pagina: 3, frammento: "n. 2 finestra due ante" },
          daVerificare: true,
        }),
        quantita: campo(2),
        larghezzaMm: campo<number | null>(1660),
        altezzaMm: campo<number | null>(1540),
        prezzoTotCent: campo<number | null>(300000),
        oscuranteIntegrato: campo<OscuranteIntegrato | null>("tapparella"),
        oscuranteTipologia: campo<string | null>("C15078-a"),
        accessori: [{ codice: "serramento.pellicola", quantita: 2, etichetta: "Pellicola" }],
        beneSignificativo: false,
        note: "Da rilevare",
      })
    );
    expect(r.categoria).toBe("serramento_alluminio");
    expect(r.tipologia).toBe("C25077-c");
    expect(r.descrizione).toBe("Finestra 2 ante");
    expect(r.quantita).toBe(2);
    expect(r.larghezzaMm).toBe(1660);
    expect(r.altezzaMm).toBe(1540);
    expect(r.prezzoTotCent).toBe(300000);
    expect(r.oscuranteIntegrato).toBe("tapparella");
    expect(r.oscuranteTipologia).toBe("C15078-a");
    expect(r.beneSignificativo).toBe(false);
    expect(r.note).toBe("Da rilevare");
    expect(r.origine).toBe("estrazione");
    // L'evidenza della riga è quella della descrizione: il servizio non la
    // ricalcola in `applicaEstrazione`, arriva da qui e resta sulla riga.
    expect(r.evidenza).toEqual({ pagina: 3, frammento: "n. 2 finestra due ante" });
    // L'etichetta serve solo a mostrare l'accessorio: al server va il codice.
    expect(r.accessori).toEqual([{ codice: "serramento.pellicola", quantita: 2 }]);
    // Campi che il contratto strutturato calcola o chiede a mano.
    expect(r.misuraDei).toBeNull();
    expect(r.prezzoUnitCent).toBeNull();
    // Due righe uguali restano due voci distinte nel form.
    expect(rigaDaProposta(rigaProposta()).chiave).not.toBe(rigaDaProposta(rigaProposta()).chiave);
  });

  // P3-R29: `note` della riga ha un limite nello schema del contratto (500
  // caratteri). Una nota più lunga faceva fallire il salvataggio DOPO che
  // l'operatore aveva rivisto tutta la proposta: si taglia qui.
  it("una nota di riga più lunga del limite arriva tagliata, non fa fallire l'applicazione", () => {
    const lunga = "a".repeat(600);
    const r = rigaDaProposta(rigaProposta({ note: lunga }));
    expect(r.note).toHaveLength(500);
    expect(r.note).toBe("a".repeat(500));
    // Una nota corta resta intatta, e «nessuna nota» resta nessuna nota.
    expect(rigaDaProposta(rigaProposta({ note: "Da rilevare" })).note).toBe("Da rilevare");
    expect(rigaDaProposta(rigaProposta({ note: null })).note).toBeNull();
  });

  // P3-R30: la zona del contratto salvato vale per la proposta solo se
  // parlano dello stesso cantiere. Applicando, il server la ricava dal
  // comune (`zonaManuale: false`): mostrare la zona di un altro comune
  // filtrerebbe il catalogo DEI su prezzi che non saranno quelli.
  describe("zonaPerRevisione (P3-R30)", () => {
    const salvato = { comuneCantiere: "Sarzana", zonaClimatica: "D" as const };

    it("stesso comune, anche scritto diversamente: vale la zona salvata", () => {
      expect(zonaPerRevisione(proposta({ comuneCantiere: campo<string | null>("Sarzana") }), salvato)).toBe("D");
      expect(zonaPerRevisione(proposta({ comuneCantiere: campo<string | null>("  sarzana  ") }), salvato)).toBe("D");
      expect(zonaPerRevisione(proposta({ comuneCantiere: campo<string | null>("SARZANA") }), salvato)).toBe("D");
      expect(zonaPerRevisione(proposta({ comuneCantiere: campo<string | null>("La  Spezia") }), {
        comuneCantiere: "La Spezia",
        zonaClimatica: "D",
      })).toBe("D");
    });

    it("comune diverso, non indicato o contratto assente: nessuna zona", () => {
      expect(zonaPerRevisione(proposta({ comuneCantiere: campo<string | null>("Lerici") }), salvato)).toBeNull();
      // Il PDF non dice il comune: non c'è niente su cui riconoscere il cantiere.
      expect(zonaPerRevisione(proposta({ comuneCantiere: campo<string | null>(null) }), salvato)).toBeNull();
      expect(zonaPerRevisione(proposta({ comuneCantiere: campo<string | null>("   ") }), salvato)).toBeNull();
      // Contratto salvato senza comune: nemmeno lui ha un cantiere da confrontare.
      expect(
        zonaPerRevisione(proposta({ comuneCantiere: campo<string | null>(null) }), {
          comuneCantiere: null,
          zonaClimatica: "D",
        })
      ).toBeNull();
      expect(zonaPerRevisione(proposta({ comuneCantiere: campo<string | null>("Sarzana") }), null)).toBeNull();
      expect(zonaPerRevisione(proposta({ comuneCantiere: campo<string | null>("Sarzana") }), undefined)).toBeNull();
      // Stesso comune ma il contratto salvato non ha zona: niente da mostrare.
      expect(
        zonaPerRevisione(proposta({ comuneCantiere: campo<string | null>("Sarzana") }), {
          comuneCantiere: "Sarzana",
          zonaClimatica: null,
        })
      ).toBeNull();
    });
  });

  it("i controlli della proposta si dividono in errori e avvisi", () => {
    const { errori, avvisi } = riepilogoControlli([
      { codice: "somma_righe", esito: "errore", messaggio: "Le righe sommano meno del pattuito." },
      { codice: "misure", esito: "avviso", messaggio: "Riga 2 senza misure." },
      { codice: "iva", esito: "ok", messaggio: "IVA coerente col layout." },
      { codice: "rate", esito: "errore", messaggio: "Le rate non fanno 100%." },
    ]);
    expect(errori).toEqual([
      "Le righe sommano meno del pattuito.",
      "Le rate non fanno 100%.",
    ]);
    expect(avvisi).toEqual(["Riga 2 senza misure."]);
  });

  it("i campi da verificare arrivano con l'etichetta del form, in ordine", () => {
    const etichette = campiDaVerificare(
      proposta({
        pattuitoCent: campo<number | null>(1539500, { daVerificare: true }),
        comuneCantiere: campo<string | null>("Sarzana", { daVerificare: true }),
        dataFirma: campo<string | null>(null, { daVerificare: true }),
        piano: campo<number | null>(2),
      })
    );
    expect(etichette).toEqual(["Pattuito", "Comune del cantiere", "Data firma"]);
    expect(campiDaVerificare(proposta())).toEqual([]);
  });

  // Il dialog nasconde il prezzo della posa quando la posa non è inclusa:
  // mandare l'operatore a verificare una casella che non c'è è un vicolo cieco.
  it("«Prezzo della posa» non è da verificare quando la posa non è inclusa", () => {
    const conPosa = proposta({
      posaInclusa: campo(true),
      posaCent: campo<number | null>(null, { daVerificare: true }),
    });
    expect(campiDaVerificare(conPosa)).toEqual(["Prezzo della posa"]);

    const senzaPosa = proposta({
      posaInclusa: campo(false),
      posaCent: campo<number | null>(null, { daVerificare: true }),
    });
    expect(campiDaVerificare(senzaPosa)).toEqual([]);
    // La posa in sé resta verificabile: è la casella nascosta a sparire.
    const posaDaVerificare = proposta({
      posaInclusa: campo(false, { daVerificare: true }),
      posaCent: campo<number | null>(null, { daVerificare: true }),
    });
    expect(campiDaVerificare(posaDaVerificare)).toEqual(["Posa"]);
  });
});
