import { describe, expect, it } from "vitest";
import { OPZIONI_COMPUTO_DEFAULT } from "@shared/limiti/tipi";
import {
  accessoriDisponibili,
  avvisiForm,
  beneSignificativoDefault,
  erroriForm,
  etichettaAccessorio,
  etichettaCategoria,
  etichettaTipologia,
  mqRigaForm,
  parametriDaServer,
  parametriVuoti,
  prodottiPerOscurante,
  prodottiPerRiga,
  quantitaAccessorioModificabile,
  rateDefault,
  riepilogoContratto,
  rigaDaLegacy,
  rigaDaServer,
  rigaVuota,
  totaleRigheCent,
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
    // Niente riferimenti condivisi: modificare il form non tocca la costante.
    p.opzioniComputo.eventuali.push("dime");
    expect(OPZIONI_COMPUTO_DEFAULT.eventuali).toEqual([]);
  });

  it("un contratto salvato torna nel form senza hash né firme", () => {
    const p = parametriDaServer({
      commessaId: 42, sedeId: 1, pattuitoCent: 1539500, pattuitoTipo: "lordo", posaInclusa: true,
      notePosa: null, comuneCantiere: "Sarzana", codiceIstat: "011026", zonaClimatica: "D",
      zonaManuale: false, piano: 2, distanzaKm: 18, detrazioneTipo: "ristrutturazione",
      detrazioneImmobile: "prima_casa", detrazionePct: 50, dataFirma: "2026-08-20",
      rate: rateDefault(), opzioniComputo: { rilievo: "pezzo", speseProfessionali: true, eventuali: ["dime"] },
      hashRighe: "h1", hashParametri: "h2", origine: "manuale", documentoId: null,
      createdBy: 1, updatedBy: 1, createdAt: new Date(), updatedAt: new Date(),
    });
    expect(p.pattuitoCent).toBe(1539500);
    expect(p.zonaClimatica).toBe("D");
    expect(p.opzioniComputo).toEqual({ rilievo: "pezzo", speseProfessionali: true, eventuali: ["dime"] });
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
});
