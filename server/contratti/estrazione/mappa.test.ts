// Test della mappatura deterministica esito modello → proposta di contratto
// (piano 3, Task 4). Il modello dice tipo, materiale, ante e testo libero;
// il codice DEI, la categoria, gli accessori, la posa, il pattuito, le rate,
// il cantiere e i controlli li decide QUESTO codice, dal catalogo
// (`shared/limiti/tariffe-seed.json`) e senza mai indovinare in silenzio.
//
// Due casi, entrambi anonimi e sintetici (nessun cliente, indirizzo o PDF
// reale): un preventivo con tre righe PVC, coprifili, maniglie e posa
// (numeri del caso «127» del piano) e un preventivo con persiane elencate
// come righe a sé (caso «129»), che l'abbinamento D-E deve riportare sulle
// finestre corrispondenti. Le pagine sintetiche contengono davvero i
// frammenti citati dall'esito finto: le evidenze si verificano sul testo.

import { describe, expect, it } from "vitest";
import type { CampoProposto, RigaProposta } from "@shared/contratti/estrazione";
import type { CategoriaRiga, ZonaClimatica } from "@shared/limiti/tipi";
import { prodottiPer, tariffeAttive } from "../../computo/tariffe";
import {
  abbinaOscuranti,
  accessoriDaEtichette,
  categoriaPer,
  costruisciProposta,
  materialeEffettivo,
  oscuranteDei,
  tipologiaDei,
  type ContestoMappa,
} from "./mappa";
import type { EsitoModello, TipoProdotto } from "./schema";

const TARIFFE = tariffeAttive();

function riga(parziale: Partial<EsitoModello["righe"][number]>): EsitoModello["righe"][number] {
  return {
    descrizione: "riga",
    tipoProdotto: "finestra",
    materiale: "pvc",
    nAnte: 2,
    quantita: 1,
    larghezzaMm: null,
    altezzaMm: null,
    prezzoTotale: null,
    prezzoUnitario: null,
    oscuranteAbbinato: "nessuno",
    lamelleOrientabili: false,
    accessori: [],
    pagina: 1,
    frammento: "riga",
    ...parziale,
  };
}

/** Righe di proposta costruite a mano: servono a provare `abbinaOscuranti` da sola. */
function campoTest<T>(valore: T): CampoProposto<T> {
  return { valore, evidenza: null, daVerificare: false, nota: null };
}

function rigaProposta(p: {
  ordine: number;
  categoria: CategoriaRiga;
  descrizione: string;
  quantita: number;
  larghezzaMm: number | null;
  altezzaMm: number | null;
  prezzoTotCent: number | null;
}): RigaProposta {
  return {
    ordine: p.ordine,
    categoria: campoTest(p.categoria),
    tipologia: campoTest<string | null>(null),
    descrizione: campoTest(p.descrizione),
    quantita: campoTest(p.quantita),
    larghezzaMm: campoTest(p.larghezzaMm),
    altezzaMm: campoTest(p.altezzaMm),
    prezzoTotCent: campoTest(p.prezzoTotCent),
    oscuranteIntegrato: campoTest(null),
    oscuranteTipologia: campoTest<string | null>(null),
    accessori: [],
    beneSignificativo: true,
    note: null,
    avvertenze: [],
  };
}

function finestraEPersiana(finestre: number, persiane: number): RigaProposta[] {
  return [
    rigaProposta({
      ordine: 1,
      categoria: "serramento_pvc",
      descrizione: "Finestra 1 anta in PVC",
      quantita: finestre,
      larghezzaMm: 900,
      altezzaMm: 1200,
      prezzoTotCent: 120000 * finestre,
    }),
    rigaProposta({
      ordine: 2,
      categoria: "persiana",
      descrizione: "Persiana in alluminio",
      quantita: persiane,
      larghezzaMm: 900,
      altezzaMm: 1200,
      prezzoTotCent: 60000 * persiane,
    }),
  ];
}

function esito(parziale: Partial<EsitoModello>): EsitoModello {
  return {
    righe: [],
    pattuito: { totaleLordo: null, totaleImponibile: null, ivaDescrizione: null, pagina: 1, frammento: "" },
    posa: { inclusa: false, prezzo: null, descrizione: null, pagina: 1, frammento: "" },
    rate: [],
    cantiere: { indirizzo: null, comune: null, provincia: null, piano: null, pagina: 1, frammento: "" },
    cliente: { nome: null, codiceFiscale: null, pagina: 1, frammento: "" },
    dataDocumento: null,
    dataFirma: null,
    riferimento: null,
    detrazione: "non_indicata",
    note: "",
    ...parziale,
  };
}

// ── Caso 127: tre righe PVC, coprifili, maniglie, posa ──────────────────────

const PAGINE_127 = [
  [
    "PREVENTIVO N. 127 del 12/03/2026",
    "Cliente: Rossi Mario - Via delle Mimose 4 - Sarzana (SP)",
    "Rif. offerta: PR-127/2026",
    "1) Portafinestra 2 ante in PVC Konfortline, finitura Real Wood, anta a ribalta",
    "   Larghezza 1400 mm Altezza 2300 mm - quantita 1 - 5.200,00 €",
    "2) Finestra 2 ante in PVC Konfortline bianco",
    "   Larghezza 1400 mm Altezza 1300 mm - quantita 1 - 4.800,00 €",
    "3) Finestra 2 ante in PVC Konfortline bianco",
    "   Larghezza 1200 mm Altezza 1300 mm - quantita 1 - 2.136,11 €",
    "4) Coprifili in PVC su misura - 600,00 €",
    "5) Maniglie in ottone - 250,00 €",
    "6) Trasporto e posa in opera - 1.100,00 €",
  ].join("\n"),
  [
    "Totale IVA Esclusa 14.086,11 €",
    "IVA 10% agevolata 1.408,61 €",
    "Totale IVA Inclusa 15.494,72 €",
    "Termini di pagamento: acconto del 50% alla firma, 40% alla consegna, 10% a fine lavori",
  ].join("\n"),
];

const ESITO_127 = esito({
  righe: [
    riga({
      descrizione: "Portafinestra 2 ante in PVC Konfortline, finitura Real Wood, anta a ribalta",
      tipoProdotto: "portafinestra",
      larghezzaMm: 1400,
      altezzaMm: 2300,
      prezzoTotale: 5200,
      accessori: ["anta a ribalta", "Real Wood"],
      frammento: "Portafinestra 2 ante in PVC Konfortline, finitura Real Wood",
    }),
    riga({
      descrizione: "Finestra 2 ante in PVC Konfortline bianco",
      larghezzaMm: 1400,
      altezzaMm: 1300,
      prezzoTotale: 4800,
      frammento: "Larghezza 1400 mm Altezza 1300 mm - quantita 1 - 4.800,00 €",
    }),
    riga({
      descrizione: "Finestra 2 ante in PVC Konfortline bianco",
      larghezzaMm: 1200,
      altezzaMm: 1300,
      prezzoTotale: 2136.11,
      frammento: "Larghezza 1200 mm Altezza 1300 mm",
    }),
    riga({
      descrizione: "Coprifili in PVC su misura",
      tipoProdotto: "accessorio",
      nAnte: 0,
      prezzoTotale: 600,
      frammento: "Coprifili in PVC su misura",
    }),
    riga({
      descrizione: "Maniglie in ottone",
      tipoProdotto: "accessorio",
      materiale: "altro",
      nAnte: 0,
      prezzoTotale: 250,
      frammento: "Maniglie in ottone",
    }),
    riga({
      descrizione: "Trasporto e posa in opera",
      tipoProdotto: "servizio",
      materiale: "altro",
      nAnte: 0,
      prezzoTotale: 1100,
      frammento: "Trasporto e posa in opera",
    }),
  ],
  pattuito: {
    totaleLordo: 15494.72,
    totaleImponibile: 14086.11,
    ivaDescrizione: "IVA 10% agevolata",
    pagina: 2,
    frammento: "Totale IVA Inclusa 15.494,72 €",
  },
  posa: {
    inclusa: true,
    prezzo: 1100,
    descrizione: "Trasporto e posa in opera",
    pagina: 1,
    frammento: "Trasporto e posa in opera",
  },
  rate: [
    { quotaPct: 50, descrizione: "acconto alla firma", scadenza: null, pagina: 2, frammento: "Termini di pagamento: acconto del 50% alla firma" },
    { quotaPct: 40, descrizione: "alla consegna", scadenza: null, pagina: 2, frammento: "40% alla consegna" },
    { quotaPct: 10, descrizione: "a fine lavori", scadenza: null, pagina: 2, frammento: "10% a fine lavori" },
  ],
  cliente: { nome: "Rossi Mario", codiceFiscale: null, pagina: 1, frammento: "Cliente: Rossi Mario" },
  dataDocumento: "12/03/2026",
  riferimento: "PR-127/2026",
});

const CONTESTO_127: ContestoMappa = {
  tariffe: TARIFFE,
  clienteCommessa: {
    nome: "Rossi Mario",
    indirizzo: "Via delle Mimose 4",
    citta: "Sarzana (SP)",
    codiceFiscale: null,
    tipoDetrazione: "ecobonus",
  },
  pagine: PAGINE_127,
};

describe("costruisciProposta — caso 127", () => {
  const proposta = costruisciProposta(ESITO_127, CONTESTO_127, false);

  it("tiene cinque righe: la posa non è una riga di contratto", () => {
    expect(proposta.righe).toHaveLength(5);
    expect(proposta.righe.map(r => r.ordine)).toEqual([1, 2, 3, 4, 5]);
    expect(proposta.righe.map(r => r.descrizione.valore)).not.toContain("Trasporto e posa in opera");
  });

  it("sceglie i codici DEI dal catalogo: portafinestra 2 ante e finestre 2 ante", () => {
    expect(proposta.righe[0].categoria.valore).toBe("serramento_pvc");
    expect(proposta.righe[0].tipologia.valore).toBe("C25077-e");
    expect(proposta.righe[1].tipologia.valore).toBe("C25077-c");
    expect(proposta.righe[2].tipologia.valore).toBe("C25077-c");
    expect(proposta.righe[0].avvertenze).toEqual([]);
  });

  it("traduce le etichette del modello in accessori del catalogo", () => {
    expect(proposta.righe[0].accessori).toEqual([
      { codice: "serramento.C25126", quantita: 1, etichetta: "anta a ribalta" },
      { codice: "serramento.C25088-a", quantita: 1, etichetta: "Real Wood" },
    ]);
    expect(proposta.righe[1].accessori).toEqual([]);
  });

  it("coprifili e maniglie restano righe accessorio non significative", () => {
    expect(proposta.righe[3].categoria.valore).toBe("accessorio");
    expect(proposta.righe[3].beneSignificativo).toBe(false);
    expect(proposta.righe[3].tipologia.valore).toBeNull();
    expect(proposta.righe[4].categoria.valore).toBe("accessorio");
    expect(proposta.righe[4].beneSignificativo).toBe(false);
  });

  it("ogni riga porta misure, prezzo in centesimi ed evidenza verificata", () => {
    const prima = proposta.righe[0];
    expect(prima.larghezzaMm.valore).toBe(1400);
    expect(prima.altezzaMm.valore).toBe(2300);
    expect(prima.prezzoTotCent.valore).toBe(520000);
    expect(prima.descrizione.evidenza?.pagina).toBe(1);
    expect(prima.descrizione.daVerificare).toBe(false);
    expect(proposta.righe[2].prezzoTotCent.valore).toBe(213611);
  });

  it("la posa alimenta posaInclusa, posaCent e notePosa", () => {
    expect(proposta.posaInclusa.valore).toBe(true);
    expect(proposta.posaCent.valore).toBe(110000);
    expect(proposta.notePosa).toContain("Trasporto e posa in opera");
  });

  it("il pattuito è il totale IVA inclusa", () => {
    expect(proposta.pattuitoCent.valore).toBe(1549472);
    expect(proposta.pattuitoTipo.valore).toBe("lordo");
    expect(proposta.pattuitoCent.evidenza?.pagina).toBe(2);
  });

  it("le rate diventano tre quote senza giorni", () => {
    expect(proposta.rate.valore).toEqual([
      { numero: 1, quotaPct: 50, giorni: null, data: null, descrizione: "acconto alla firma" },
      { numero: 2, quotaPct: 40, giorni: null, data: null, descrizione: "alla consegna" },
      { numero: 3, quotaPct: 10, giorni: null, data: null, descrizione: "a fine lavori" },
    ]);
    expect(proposta.rate.daVerificare).toBe(false);
    expect(proposta.controlli.find(c => c.codice === "rate_somma")).toBeUndefined();
  });

  it("senza cantiere propone la città del cliente, dichiarandola da verificare", () => {
    expect(proposta.comuneCantiere.valore).toBe("Sarzana");
    expect(proposta.comuneCantiere.daVerificare).toBe(true);
    expect(proposta.comuneCantiere.nota).toContain("cliente");
    expect(proposta.indirizzoCantiere.valore).toBe("Via delle Mimose 4");
    expect(proposta.indirizzoCantiere.daVerificare).toBe(true);
    expect(proposta.controlli.find(c => c.codice === "zona_cantiere")).toBeUndefined();
    // La zona dei codici DEI viene dal cliente, non dal cantiere: va detto.
    expect(proposta.controlli.find(c => c.codice === "zona_da_cliente")?.esito).toBe("avviso");
  });

  it("la data del documento diventa data firma da verificare", () => {
    expect(proposta.dataFirma.valore).toBe("2026-03-12");
    expect(proposta.dataFirma.daVerificare).toBe(true);
    expect(proposta.riferimento.valore).toBe("PR-127/2026");
  });

  it("la detrazione non indicata arriva dal cliente CRM, da verificare", () => {
    expect(proposta.detrazioneTipo.valore).toBe("ecobonus");
    expect(proposta.detrazioneTipo.daVerificare).toBe(true);
    expect(proposta.detrazioneTipo.nota).toContain("cliente");
  });

  it("il controllo righe_vs_pattuito torna: 12.386,11 + 600 + 1.100 = 14.086,11", () => {
    const controllo = proposta.controlli.find(c => c.codice === "righe_vs_pattuito");
    expect(controllo?.esito).toBe("ok");
    const somma = proposta.righe.reduce((s, r) => s + (r.prezzoTotCent.valore ?? 0), 0);
    expect(somma + (proposta.posaCent.valore ?? 0)).toBe(1408611);
  });

  it("il cliente citato coincide con quello della commessa", () => {
    expect(proposta.clienteCitato.valore).toBe("Rossi Mario");
    expect(proposta.controlli.find(c => c.codice === "cliente_citato")?.esito).toBe("ok");
  });
});

describe("controlli", () => {
  it("segnala l'IVA non scorporabile quando il pattuito è lordo senza aliquota unica", () => {
    const proposta = costruisciProposta(
      esito({
        righe: [riga({ prezzoTotale: 1000, larghezzaMm: 1200, altezzaMm: 1400 })],
        pattuito: { totaleLordo: 1220, totaleImponibile: null, ivaDescrizione: "IVA 10% e 22%", pagina: 1, frammento: "" },
      }),
      { ...CONTESTO_127, pagine: [""] },
      false
    );
    const controllo = proposta.controlli.find(c => c.codice === "righe_vs_pattuito");
    expect(controllo?.esito).toBe("avviso");
    expect(controllo?.messaggio).toContain("IVA mista");
  });

  it("segnala lo scarto oltre l'euro fra somma righe e imponibile", () => {
    const proposta = costruisciProposta(
      esito({
        righe: [riga({ prezzoTotale: 1000, larghezzaMm: 1200, altezzaMm: 1400 })],
        pattuito: { totaleLordo: null, totaleImponibile: 1500, ivaDescrizione: null, pagina: 1, frammento: "" },
      }),
      { ...CONTESTO_127, pagine: [""] },
      false
    );
    expect(proposta.controlli.find(c => c.codice === "righe_vs_pattuito")?.esito).toBe("avviso");
  });

  it("senza righe e senza pattuito produce due errori, e il troncamento un avviso", () => {
    const proposta = costruisciProposta(esito({}), { ...CONTESTO_127, pagine: [""] }, true);
    expect(proposta.controlli.find(c => c.codice === "nessuna_riga")?.esito).toBe("errore");
    expect(proposta.controlli.find(c => c.codice === "pattuito")?.esito).toBe("errore");
    expect(proposta.controlli.find(c => c.codice === "documento_troncato")?.esito).toBe("avviso");
    expect(proposta.pattuitoCent.valore).toBeNull();
    expect(proposta.rate.valore).toEqual([]);
    expect(proposta.rate.daVerificare).toBe(true);
  });

  it("segnala serramenti senza misure, righe senza prezzo e rate che non fanno 100", () => {
    const proposta = costruisciProposta(
      esito({
        righe: [riga({ descrizione: "Finestra senza misure" })],
        pattuito: { totaleLordo: null, totaleImponibile: 100, ivaDescrizione: null, pagina: 1, frammento: "" },
        rate: [{ quotaPct: 50, descrizione: "acconto", scadenza: "30/06/2026", pagina: 1, frammento: "" }],
      }),
      { ...CONTESTO_127, pagine: [""] },
      false
    );
    expect(proposta.controlli.find(c => c.codice === "righe_senza_misure")?.esito).toBe("avviso");
    expect(proposta.controlli.find(c => c.codice === "righe_senza_prezzo")?.esito).toBe("avviso");
    expect(proposta.controlli.find(c => c.codice === "rate_somma")?.esito).toBe("avviso");
    expect(proposta.rate.valore[0].data).toBe("2026-06-30");
  });

  it("avvisa quando il documento cita un cliente diverso da quello della commessa", () => {
    const proposta = costruisciProposta(
      esito({ cliente: { nome: "Verdi Giuseppe", codiceFiscale: null, pagina: 1, frammento: "" } }),
      { ...CONTESTO_127, pagine: [""] },
      false
    );
    const controllo = proposta.controlli.find(c => c.codice === "cliente_citato");
    expect(controllo?.esito).toBe("avviso");
    expect(controllo?.messaggio).toContain("Verdi Giuseppe");
  });

  // I1/P3-R12: «Condominio» e «Via» non identificano nessuno.
  it("due condomini di vie diverse non sono lo stesso cliente", () => {
    const proposta = costruisciProposta(
      esito({ cliente: { nome: "Condominio Via Roma 12", codiceFiscale: null, pagina: 1, frammento: "" } }),
      { ...CONTESTO_127, clienteCommessa: { ...CONTESTO_127.clienteCommessa, nome: "Condominio Via Milano 5" }, pagine: [""] },
      false
    );
    const controllo = proposta.controlli.find(c => c.codice === "cliente_citato");
    expect(controllo?.esito).toBe("avviso");
    expect(controllo?.messaggio).toContain("Condominio Via Roma 12");
  });

  it("lo stesso condominio della stessa via resta coerente", () => {
    const proposta = costruisciProposta(
      esito({ cliente: { nome: "Condominio Via Roma 12", codiceFiscale: null, pagina: 1, frammento: "" } }),
      { ...CONTESTO_127, clienteCommessa: { ...CONTESTO_127.clienteCommessa, nome: "Condominio Via Roma" }, pagine: [""] },
      false
    );
    expect(proposta.controlli.find(c => c.codice === "cliente_citato")?.esito).toBe("ok");
  });

  it("un nome fatto solo di parole comuni non è confrontabile, e lo dice", () => {
    const proposta = costruisciProposta(
      esito({ cliente: { nome: "Condominio di Via 12", codiceFiscale: null, pagina: 1, frammento: "" } }),
      { ...CONTESTO_127, pagine: [""] },
      false
    );
    const controllo = proposta.controlli.find(c => c.codice === "cliente_citato");
    expect(controllo?.esito).toBe("avviso");
    expect(controllo?.messaggio).toContain("non confrontabile");
  });

  it("avvisa sul codice fiscale diverso e sul comune che non risolve la zona", () => {
    const proposta = costruisciProposta(
      esito({
        cliente: { nome: "Rossi Mario", codiceFiscale: "RSSMRA80A01H501U", pagina: 1, frammento: "" },
        cantiere: { indirizzo: null, comune: "Comune Inesistente", provincia: null, piano: null, pagina: 1, frammento: "" },
      }),
      {
        ...CONTESTO_127,
        clienteCommessa: { ...CONTESTO_127.clienteCommessa, codiceFiscale: "VRDGPP70B02F205Z" },
        pagine: [""],
      },
      false
    );
    expect(proposta.controlli.find(c => c.codice === "codice_fiscale")?.esito).toBe("avviso");
    const zona = proposta.controlli.find(c => c.codice === "zona_cantiere");
    expect(zona?.esito).toBe("avviso");
    expect(zona?.messaggio).toContain("Comune Inesistente");
  });

  // Minore: uno sconto in percentuale non rende «mista» l'IVA.
  it("uno sconto in percentuale non impedisce lo scorporo dell'IVA", () => {
    const proposta = costruisciProposta(
      esito({
        righe: [riga({ prezzoTotale: 1000, larghezzaMm: 1200, altezzaMm: 1400 })],
        pattuito: {
          totaleLordo: 1100,
          totaleImponibile: null,
          ivaDescrizione: "sconto 5% — IVA 10%",
          pagina: 1,
          frammento: "",
        },
      }),
      { ...CONTESTO_127, pagine: [""] },
      false
    );
    expect(proposta.controlli.find(c => c.codice === "righe_vs_pattuito")?.esito).toBe("ok");
  });

  // I5/P3-R16: la posa si porta via i servizi, non i prodotti.
  it("una riga con misure che cita la posa resta una riga, dichiarandolo", () => {
    const proposta = costruisciProposta(
      esito({
        righe: [
          riga({
            descrizione: "Fornitura e posa in opera di n. 3 finestre in PVC",
            tipoProdotto: "altro",
            nAnte: 2,
            quantita: 3,
            larghezzaMm: 1200,
            altezzaMm: 1400,
            prezzoTotale: 3000,
            frammento: "",
          }),
        ],
      }),
      { ...CONTESTO_127, pagine: [""] },
      false
    );
    expect(proposta.righe).toHaveLength(1);
    expect(proposta.righe[0].avvertenze.join(" ")).toContain("cita la posa");
    expect(proposta.posaCent.valore).toBeNull();
  });

  it("una riga di posa senza misure resta un servizio", () => {
    const proposta = costruisciProposta(
      esito({
        righe: [riga({ descrizione: "Posa in opera", tipoProdotto: "altro", nAnte: 0, prezzoTotale: 900, frammento: "" })],
      }),
      { ...CONTESTO_127, pagine: [""] },
      false
    );
    expect(proposta.righe).toHaveLength(0);
    expect(proposta.posaCent.valore).toBe(90000);
  });
});

// ── Caso 129 ridotto: persiane elencate come righe a sé (D-E) ───────────────

const PAGINE_129 = [
  [
    "PREVENTIVO N. 129 del 05/04/2026",
    "Cantiere: Via dei Gelsi 12, Sarzana (SP)",
    "1) N. 3 finestre 1 anta in PVC bianco - 900 x 1200 mm - 3.600,00 €",
    "2) N. 3 persiane in alluminio verniciato, senza lamelle orientabili - 900 x 1200 mm - 1.800,00 €",
    "3) N. 1 persiana in alluminio verniciato - 1500 x 2200 mm - 900,00 €",
  ].join("\n"),
];

const ESITO_129 = esito({
  righe: [
    riga({
      descrizione: "N. 3 finestre 1 anta in PVC bianco",
      tipoProdotto: "finestra",
      nAnte: 1,
      quantita: 3,
      larghezzaMm: 900,
      altezzaMm: 1200,
      prezzoTotale: 3600,
      frammento: "N. 3 finestre 1 anta in PVC bianco",
    }),
    riga({
      descrizione: "N. 3 persiane in alluminio verniciato, senza lamelle orientabili",
      tipoProdotto: "persiana",
      materiale: "alluminio",
      nAnte: 1,
      quantita: 3,
      larghezzaMm: 900,
      altezzaMm: 1200,
      prezzoTotale: 1800,
      frammento: "N. 3 persiane in alluminio verniciato, senza lamelle orientabili",
    }),
    riga({
      descrizione: "N. 1 persiana in alluminio verniciato",
      tipoProdotto: "persiana",
      materiale: "alluminio",
      nAnte: 2,
      quantita: 1,
      larghezzaMm: 1500,
      altezzaMm: 2200,
      prezzoTotale: 900,
      frammento: "N. 1 persiana in alluminio verniciato - 1500 x 2200 mm",
    }),
  ],
  pattuito: { totaleLordo: null, totaleImponibile: 6300, ivaDescrizione: "IVA 10%", pagina: 1, frammento: "" },
  cantiere: { indirizzo: "Via dei Gelsi 12", comune: "Sarzana", provincia: "SP", piano: 1, pagina: 1, frammento: "Cantiere: Via dei Gelsi 12, Sarzana (SP)" },
});

describe("abbinamento degli oscuranti (D-E)", () => {
  const proposta = costruisciProposta(ESITO_129, { ...CONTESTO_127, pagine: PAGINE_129 }, false);

  it("porta la persiana con le stesse misure sulla riga finestra e ne assorbe il prezzo", () => {
    expect(proposta.righe).toHaveLength(2);
    const finestre = proposta.righe[0];
    expect(finestre.categoria.valore).toBe("serramento_pvc");
    expect(finestre.oscuranteIntegrato.valore).toBe("persiana");
    expect(finestre.oscuranteTipologia.valore).toBe("C15079-a");
    expect(finestre.prezzoTotCent.valore).toBe(540000);
    expect(finestre.note).toContain("persiana abbinata");
  });

  it("la persiana senza finestra corrispondente resta una riga persiana, con la sua voce DEI", () => {
    const persiana = proposta.righe[1];
    expect(persiana.categoria.valore).toBe("persiana");
    expect(persiana.quantita.valore).toBe(1);
    expect(persiana.prezzoTotCent.valore).toBe(90000);
    expect(persiana.larghezzaMm.valore).toBe(1500);
    // Stessa scelta del percorso abbinato: 2 ante, senza lamelle orientabili.
    expect(persiana.tipologia.valore).toBe("C15079-b");
  });

  it("il cantiere esplicito vince sull'indirizzo del cliente", () => {
    expect(proposta.comuneCantiere.valore).toBe("Sarzana");
    expect(proposta.comuneCantiere.daVerificare).toBe(false);
    expect(proposta.provinciaCantiere).toBe("SP");
    expect(proposta.piano.valore).toBe(1);
    expect(proposta.controlli.find(c => c.codice === "zona_da_cliente")).toBeUndefined();
  });

  it("non tocca le righe ricevute, nemmeno quando l'abbinamento avviene davvero", () => {
    const righe = finestraEPersiana(2, 2);
    const copia = JSON.parse(JSON.stringify(righe));
    const abbinate = abbinaOscuranti(righe);
    expect(JSON.parse(JSON.stringify(righe))).toEqual(copia);
    // L'abbinamento è successo: il test non è vacuo.
    expect(abbinate).toHaveLength(1);
    expect(abbinate[0].oscuranteIntegrato.valore).toBe("persiana");
  });

  it("la tolleranza è di 10 mm: a 11 mm le due righe non sono lo stesso foro", () => {
    const dieci = finestraEPersiana(1, 1);
    dieci[1].larghezzaMm = campoTest<number | null>(910);
    expect(abbinaOscuranti(dieci)).toHaveLength(1);

    const undici = finestraEPersiana(1, 1);
    undici[1].larghezzaMm = campoTest<number | null>(911);
    expect(abbinaOscuranti(undici)).toHaveLength(2);
  });
});

// ── I3: l'abbinamento non gonfia le quantità (P3-R14) ───────────────────────

describe("abbinaOscuranti — quantità (P3-R14)", () => {
  it("3 finestre e 1 persiana non si abbinano: marcarle tutte gonfierebbe il computo", () => {
    const righe = abbinaOscuranti(finestraEPersiana(3, 1));
    expect(righe).toHaveLength(2);
    expect(righe[0].oscuranteIntegrato.valore).toBeNull();
    expect(righe[0].prezzoTotCent.valore).toBe(360000);
    expect(righe[1].quantita.valore).toBe(1);
    expect(righe[1].avvertenze.join(" ")).toContain("non abbinata: quantità diversa");
  });

  it("2 finestre e 2 persiane si abbinano e la riga oscurante sparisce", () => {
    const righe = abbinaOscuranti(finestraEPersiana(2, 2));
    expect(righe).toHaveLength(1);
    expect(righe[0].oscuranteIntegrato.valore).toBe("persiana");
    expect(righe[0].prezzoTotCent.valore).toBe(240000 + 120000);
  });

  it("1 finestra e 3 persiane: si abbina la quota di una, le altre due restano riga", () => {
    const righe = abbinaOscuranti(finestraEPersiana(1, 3));
    expect(righe).toHaveLength(2);
    expect(righe[0].oscuranteIntegrato.valore).toBe("persiana");
    expect(righe[0].prezzoTotCent.valore).toBe(120000 + 60000);
    expect(righe[1].quantita.valore).toBe(2);
    expect(righe[1].prezzoTotCent.valore).toBe(120000);
  });
});

// ── Funzioni pubbliche usate dalla mappatura ────────────────────────────────

describe("materialeEffettivo", () => {
  it("tiene il materiale dichiarato dal modello", () => {
    expect(materialeEffettivo(riga({ materiale: "alluminio" }))).toBe("alluminio");
  });

  it("deduce il PVC dai marchi e dalla sigla, l'alluminio e il legno-alluminio dal testo", () => {
    expect(materialeEffettivo(riga({ materiale: "sconosciuto", descrizione: "Serramento Konfortline bianco" }))).toBe("pvc");
    expect(materialeEffettivo(riga({ materiale: "sconosciuto", descrizione: "Finestra WnD 70" }))).toBe("pvc");
    expect(materialeEffettivo(riga({ materiale: "sconosciuto", descrizione: "Finestra in alluminio a taglio termico" }))).toBe("alluminio");
    expect(materialeEffettivo(riga({ materiale: "sconosciuto", descrizione: "Finestra legno-alluminio rovere" }))).toBe("legno_alluminio");
    expect(materialeEffettivo(riga({ materiale: "sconosciuto", descrizione: "Finestra in legno di pino" }))).toBe("legno");
    expect(materialeEffettivo(riga({ materiale: "sconosciuto", descrizione: "Serramento su misura" }))).toBe("sconosciuto");
  });
});

describe("categoriaPer", () => {
  it("mappa i serramenti sul materiale e i servizi su nessuna riga", () => {
    expect(categoriaPer("finestra", "pvc")).toBe("serramento_pvc");
    expect(categoriaPer("scorrevole", "alluminio")).toBe("serramento_alluminio");
    expect(categoriaPer("fisso", "legno")).toBe("serramento_legno");
    expect(categoriaPer("portafinestra", "legno_alluminio")).toBe("serramento_legno_alluminio");
    expect(categoriaPer("finestra", "sconosciuto")).toBe("serramento_pvc");
    expect(categoriaPer("servizio", "altro")).toBeNull();
    expect(categoriaPer("tapparella", "pvc")).toBe("tapparella");
    expect(categoriaPer("controtelaio", "acciaio")).toBe("controtelaio");
  });

  it("il materiale non riconosciuto lascia un'avvertenza sulla riga", () => {
    const proposta = costruisciProposta(
      esito({
        righe: [
          riga({
            materiale: "sconosciuto",
            descrizione: "Serramento su misura",
            larghezzaMm: 1000,
            altezzaMm: 1000,
            prezzoTotale: 100,
            frammento: "Serramento su misura",
          }),
        ],
      }),
      { ...CONTESTO_127, pagine: ["Serramento su misura 1000 x 1000"] },
      false
    );
    // L'evidenza c'è: il «da verificare» viene dal materiale indovinato.
    expect(proposta.righe[0].descrizione.evidenza).not.toBeNull();
    expect(proposta.righe[0].categoria.valore).toBe("serramento_pvc");
    expect(proposta.righe[0].avvertenze.join(" ")).toContain("materiale non riconosciuto");
    // Una categoria indovinata nasce da verificare.
    expect(proposta.righe[0].categoria.daVerificare).toBe(true);
  });
});

describe("tipologiaDei", () => {
  it("in zona D sceglie la voce alluminio delle zone C-D", () => {
    const scelta = tipologiaDei(
      TARIFFE,
      "serramento_alluminio",
      { tipoProdotto: "finestra", nAnte: 2, descrizione: "Finestra 2 ante in alluminio" },
      "D"
    );
    expect(scelta.codice).toBe("C15039-c");
    expect(scelta.avvertenza).toBeNull();
  });

  it("senza zona nota prende il primo candidato per codice e lo dichiara", () => {
    const scelta = tipologiaDei(
      TARIFFE,
      "serramento_alluminio",
      { tipoProdotto: "finestra", nAnte: 2, descrizione: "Finestra 2 ante in alluminio" },
      null
    );
    expect(scelta.codice).toBe("C15038-c");
    expect(scelta.avvertenza).toContain("più voci DEI possibili");
  });

  it("distingue scorrevole alzante, complanare e telaio fisso", () => {
    expect(tipologiaDei(TARIFFE, "serramento_pvc", { tipoProdotto: "fisso", nAnte: 0, descrizione: "Fisso PVC" }, null).codice).toBe("C25077-a");
    // P3-R15: a parità vince la voce SENZA «> 1,3 W/mqK» (C25080, non C25079).
    expect(
      tipologiaDei(TARIFFE, "serramento_pvc", { tipoProdotto: "scorrevole", nAnte: 2, descrizione: "Scorrevole alzante PVC" }, null).codice
    ).toBe("C25080");
  });

  it("le categorie senza voce DEI non ricevono codice né avvertenza", () => {
    expect(tipologiaDei(TARIFFE, "accessorio", { tipoProdotto: "accessorio", nAnte: 0, descrizione: "Maniglie" }, null)).toEqual({
      codice: null,
      avvertenza: null,
    });
  });

  // Minore: una riga persiana autonoma sceglie come il percorso abbinato
  // (lamelle e forma), non «la prima voce della famiglia».
  it("per una riga persiana autonoma sceglie per lamelle e forma", () => {
    const senzaLamelle = tipologiaDei(
      TARIFFE,
      "persiana",
      { tipoProdotto: "persiana", nAnte: 2, descrizione: "Persiane in alluminio verniciato" },
      null
    );
    expect(senzaLamelle.codice).toBe("C15079-b");
    expect(senzaLamelle.avvertenza).toBeNull();

    const conLamelle = tipologiaDei(
      TARIFFE,
      "persiana",
      { tipoProdotto: "persiana", nAnte: 1, descrizione: "Persiane in alluminio per portafinestra", lamelleOrientabili: true },
      null
    );
    expect(conLamelle.codice).toBe("C15078-c");
  });
});

// ── C2/I4: la natura del serramento e il foglio del catalogo (P3-R10, P3-R15) ─

describe("tipologiaDei — scorrevoli, portefinestre e fogli (P3-R10, P3-R15)", () => {
  it("la portafinestra scorrevole complanare prende la voce scorrevole, non quella a battente", () => {
    const scelta = tipologiaDei(
      TARIFFE,
      "serramento_pvc",
      { tipoProdotto: "portafinestra", nAnte: 2, descrizione: "Portafinestra scorrevole complanare in PVC a 2 ante" },
      null
    );
    expect(scelta.codice).toBe("C25077-g");
  });

  it("lo scorrevole dichiarato finestra resta finestra e preferisce la voce migliore", () => {
    expect(
      tipologiaDei(
        TARIFFE,
        "serramento_pvc",
        { tipoProdotto: "scorrevole", nAnte: 2, descrizione: "Finestra scorrevole complanare in PVC" },
        null
      ).codice
    ).toBe("C25077-f");
  });

  it("lo scorrevole senza finestra né portafinestra nel testo lo dichiara", () => {
    const scelta = tipologiaDei(
      TARIFFE,
      "serramento_pvc",
      { tipoProdotto: "scorrevole", nAnte: 2, descrizione: "Scorrevole complanare in PVC bianco" },
      null
    );
    expect(scelta.avvertenza).toContain("finestra o portafinestra non indicato");
  });

  it("quando nessuna voce ha la natura descritta lo dichiara invece di tacere", () => {
    const scelta = tipologiaDei(
      TARIFFE,
      "serramento_pvc",
      { tipoProdotto: "portafinestra", nAnte: 1, descrizione: "Portafinestra scorrevole alzante in PVC" },
      null
    );
    expect(scelta.codice).toBe("C25077-g");
    expect(scelta.avvertenza).toContain("alzante");
  });

  it("il legno-alluminio in zona D usa il foglio legno-alluminio, non quello alluminio-legno", () => {
    expect(
      tipologiaDei(
        TARIFFE,
        "serramento_legno_alluminio",
        { tipoProdotto: "finestra", nAnte: 2, descrizione: "Finestra 2 ante in legno-alluminio" },
        "D"
      ).codice
    ).toBe("C25102-c");
    expect(
      tipologiaDei(
        TARIFFE,
        "serramento_legno_alluminio",
        { tipoProdotto: "scorrevole", nAnte: 2, descrizione: "Portafinestra scorrevole alzante in legno-alluminio" },
        "D"
      ).codice
    ).toBe("C25106-c");
  });

  // Sonda esaustiva: ogni voce serramento del seed (Velux escluse: non hanno
  // un tipoProdotto del modello) deve essere raggiungibile da almeno una
  // combinazione plausibile di tipo, ante e zona con la sua stessa
  // descrizione. Le uniche escluse sono quelle che una regola DICHIARATA
  // mette sempre in secondo piano.
  it("ogni voce serramento del catalogo è raggiungibile, tranne le duplicate dichiarate", () => {
    const CATEGORIA: Record<string, CategoriaRiga> = {
      pvc: "serramento_pvc",
      alluminio: "serramento_alluminio",
      legno: "serramento_legno",
      legno_alluminio: "serramento_legno_alluminio",
      alluminio_legno: "serramento_legno_alluminio",
    };
    const TIPI: TipoProdotto[] = ["finestra", "portafinestra", "scorrevole", "fisso"];
    const ZONE: Array<ZonaClimatica | null> = ["A", "B", "C", "D", "E", "F", null];
    const voci = prodottiPer(TARIFFE, "serramento").filter(p => p.famiglia !== "velux");
    const raggiunti = new Set<string>();
    for (const voce of voci) {
      const categoria = CATEGORIA[voce.famiglia];
      for (const tipoProdotto of TIPI) {
        for (const zona of ZONE) {
          for (const nAnte of [0, 1, 2, 3, 4]) {
            const codice = tipologiaDei(TARIFFE, categoria, { tipoProdotto, nAnte, descrizione: voce.nome }, zona).codice;
            if (codice) raggiunti.add(codice);
          }
        }
      }
    }
    const mancanti = voci.filter(v => !raggiunti.has(v.codice)).map(v => v.codice).sort();
    expect(voci).toHaveLength(116);
    expect(mancanti).toEqual([
      // Trasmittanza peggiore: a parità la scelta va alla voce migliore (P3-R15),
      // queste restano una scelta a mano dell'operatore.
      "C25076-f",
      "C25076-g",
      "C25079",
      // Foglio ALLUMINIO-LEGNO dove il foglio LEGNO-ALLUMINIO copre la stessa
      // zona e la stessa forma: il materiale dichiarato è `legno_alluminio` e
      // vince il suo foglio (P3-R15). Restano raggiungibili le zone A, B e C
      // (che il foglio LEGNO-ALLUMINIO non copre) e le portefinestre a 1 anta
      // (che lì non esistono: C15058-d, C15059-d).
      "C15058-a",
      "C15058-b",
      "C15058-c",
      "C15058-e",
      "C15059-a",
      "C15059-b",
      "C15059-c",
      "C15059-e",
      "C15062-a",
      "C15062-b",
      "C15062-c",
      "C15063-a",
      "C15063-b",
    ].sort());
  });
});

// ── N1/P3-R24: la natura si legge solo nel segmento del serramento ─────────

describe("tipologiaDei — la natura si legge solo prima dell'accessorio (P3-R24)", () => {
  it("(a) un accessorio scorrevole non rende scorrevole la finestra", () => {
    // «con zanzariera scorrevole» è dopo la parola «zanzariera»: fuori dal
    // segmento del serramento. Prima di questo fix il giro 1 avrebbe letto
    // «scorrevole» in tutta la descrizione e scelto C15043-a (complanare).
    const scelta = tipologiaDei(
      TARIFFE,
      "serramento_alluminio",
      { tipoProdotto: "finestra", nAnte: 2, descrizione: "Finestra 2 ante in alluminio con zanzariera scorrevole" },
      "D"
    );
    expect(scelta.codice).toBe("C15039-c");
    expect(scelta.avvertenza).toBeNull();
  });

  it("(b) «scorrevole» nel segmento del serramento vince sul tipo del modello, e lo dichiara", () => {
    // Qui «scorrevole» descrive il serramento stesso, non un accessorio:
    // il tipo dichiarato dal modello (finestra) e il testo si contraddicono,
    // si segue il testo ma la contraddizione è un'avvertenza, mai silenziosa.
    const scelta = tipologiaDei(
      TARIFFE,
      "serramento_alluminio",
      { tipoProdotto: "finestra", nAnte: 2, descrizione: "Finestra scorrevole 2 ante in alluminio" },
      "D"
    );
    expect(scelta.codice).toBe("C15043-a");
    expect(scelta.avvertenza).toBe("descrizione scorrevole, tipo del modello finestra: verifica");
  });

  it("(c) vale anche per il legno: l'oscurante scorrevole non è il serramento", () => {
    const scelta = tipologiaDei(
      TARIFFE,
      "serramento_legno",
      { tipoProdotto: "finestra", nAnte: 2, descrizione: "Finestra 2 ante in legno con zanzariera scorrevole" },
      "D"
    );
    expect(scelta.codice).toBe("C25053-c");
    expect(scelta.avvertenza).toBeNull();
  });

  it("(d) la portafinestra scorrevole complanare in PVC resta raggiungibile", () => {
    // Non regredisce rispetto al giro 1: nessun accessorio nel testo, quindi
    // il segmento è la descrizione intera e il risultato non cambia.
    const scelta = tipologiaDei(
      TARIFFE,
      "serramento_pvc",
      { tipoProdotto: "portafinestra", nAnte: 2, descrizione: "Portafinestra scorrevole complanare in PVC a 2 ante" },
      null
    );
    expect(scelta.codice).toBe("C25077-g");
  });

  it("la contraddizione arriva fino alla riga: tipologia da verificare con l'avvertenza in nota", () => {
    const descrizione = "Finestra scorrevole in PVC";
    const proposta = costruisciProposta(
      esito({
        righe: [
          riga({
            descrizione,
            tipoProdotto: "finestra",
            materiale: "pvc",
            nAnte: 1,
            larghezzaMm: 900,
            altezzaMm: 1200,
            prezzoTotale: 1200,
            frammento: descrizione,
          }),
        ],
      }),
      { ...CONTESTO_127, pagine: [descrizione] },
      false
    );
    const riga0 = proposta.righe[0];
    expect(riga0.tipologia.nota).toContain("descrizione scorrevole, tipo del modello finestra: verifica");
    expect(riga0.tipologia.daVerificare).toBe(true);
    expect(riga0.avvertenze.join(" ")).toContain("descrizione scorrevole");
  });
});

describe("oscuranteDei", () => {
  it("persiane in alluminio: distingue lamelle orientabili e forma", () => {
    expect(oscuranteDei(TARIFFE, "persiana", "alluminio", false, 1, false).codice).toBe("C15079-a");
    expect(oscuranteDei(TARIFFE, "persiana", "alluminio", false, 2, true).codice).toBe("C15078-b");
    expect(oscuranteDei(TARIFFE, "persiana", "alluminio", true, 2, true).codice).toBe("C15078-d");
    // Voce unica dopo i filtri: nessuna scelta da dichiarare.
    expect(oscuranteDei(TARIFFE, "persiana", "alluminio", false, 1, false).avvertenza).toBeNull();
  });

  it("persiane in legno: finestra o portafinestra, 1 o 2 ante", () => {
    expect(oscuranteDei(TARIFFE, "persiana", "legno", false, 2, false).codice).toBe("C25063-b");
    expect(oscuranteDei(TARIFFE, "persiana", "legno", true, 1, false).codice).toBe("C25063-a");
  });

  it("tapparelle: la prima voce della famiglia", () => {
    expect(oscuranteDei(TARIFFE, "tapparella", "pvc", false, 1, false).codice).toBe("C25089-a");
    expect(oscuranteDei(TARIFFE, "tapparella", "alluminio", false, 1, false).codice).toBe("C15084-b");
    expect(oscuranteDei(TARIFFE, "tapparella", "acciaio", false, 1, false).codice).toBe("C15085-a");
  });

  it("scuri: unica famiglia legno, forma dal nome", () => {
    expect(oscuranteDei(TARIFFE, "scuro", "legno", true, 2, false).codice).toBe("C25068-d");
  });

  // I2/P3-R13: più voci valide → la scelta si dichiara, non si prende in silenzio.
  it("con più voci valide dichiara quale ha scelto", () => {
    const scelta = oscuranteDei(TARIFFE, "persiana", "pvc", false, 1, false);
    expect(scelta.codice).toBe("C25081-a");
    expect(scelta.avvertenza).toContain("più voci DEI possibili");

    const tapparella = oscuranteDei(TARIFFE, "tapparella", "pvc", false, 1, false);
    expect(tapparella.avvertenza).toContain("più voci DEI possibili");
  });

  it("senza famiglia riconoscibile non inventa un codice", () => {
    const scelta = oscuranteDei(TARIFFE, "persiana", "acciaio", false, 1, false);
    expect(scelta.codice).toBeNull();
    expect(scelta.avvertenza).toContain("acciaio");
  });
});

// ── C3: il materiale dell'oscurante si legge DOPO la parola che lo nomina ───

describe("oscurante integrato della riga (P3-R11)", () => {
  function propostaConOscurante(descrizione: string): ReturnType<typeof costruisciProposta> {
    return costruisciProposta(
      esito({
        righe: [
          riga({
            descrizione,
            tipoProdotto: "finestra",
            nAnte: 1,
            larghezzaMm: 900,
            altezzaMm: 1200,
            prezzoTotale: 1200,
            oscuranteAbbinato: "persiana",
            lamelleOrientabili: false,
            frammento: descrizione,
          }),
        ],
      }),
      { ...CONTESTO_127, pagine: [descrizione] },
      false
    );
  }

  it("legge il materiale della persiana dal suo pezzo di testo, non da tutta la riga", () => {
    const riga0 = propostaConOscurante("Finestra 1 anta in PVC con persiana in alluminio senza lamelle orientabili").righe[0];
    expect(riga0.oscuranteIntegrato.valore).toBe("persiana");
    expect(riga0.oscuranteTipologia.valore).toBe("C15079-a");
    expect(riga0.oscuranteTipologia.daVerificare).toBe(false);
    expect(riga0.avvertenze).toEqual([]);
  });

  it("con due materiali nella riga e nessuno sull'oscurante propone il PVC dichiarandolo", () => {
    const riga0 = propostaConOscurante("Finestra 1 anta in PVC con maniglia in alluminio e persiana").righe[0];
    expect(riga0.oscuranteTipologia.valore).toBe("C25081-a");
    expect(riga0.oscuranteTipologia.daVerificare).toBe(true);
    expect(riga0.avvertenze.join(" ")).toContain("materiale dell'oscurante non indicato");
  });

  // N2/P3-R25: due materiali nel segmento dell'oscurante — vince quello che
  // compare prima per posizione, non il PVC per precedenza fissa.
  it("con due materiali nel segmento dell'oscurante vince quello che compare prima (P3-R25)", () => {
    const riga0 = propostaConOscurante("Finestra 1 anta con persiana in alluminio e telaio in PVC").righe[0];
    expect(riga0.oscuranteTipologia.valore).toBe("C15079-a");
    expect(riga0.oscuranteTipologia.daVerificare).toBe(false);
    expect(riga0.avvertenze).toEqual([]);
  });
});

describe("accessoriDaEtichette", () => {
  it("riconosce ribalta, pellicolatura e coprifili maggiorati sul PVC", () => {
    expect(accessoriDaEtichette(TARIFFE, "serramento_pvc", ["anta a ribalta", "Real Wood", "coprifili da 100 mm"], false, 2)).toEqual([
      { codice: "serramento.C25126", quantita: 1, etichetta: "anta a ribalta" },
      { codice: "serramento.C25088-a", quantita: 1, etichetta: "Real Wood" },
      { codice: "serramento.C25088-i", quantita: 1, etichetta: "coprifili da 100 mm" },
    ]);
  });

  it("non duplica lo stesso codice e ignora le etichette sconosciute", () => {
    expect(accessoriDaEtichette(TARIFFE, "serramento_pvc", ["ribalta", "anta a ribalta", "colore canapa"], false, 2)).toEqual([
      { codice: "serramento.C25126", quantita: 1, etichetta: "ribalta" },
    ]);
  });

  it("la soglia ribassata vale solo per le portefinestre", () => {
    expect(accessoriDaEtichette(TARIFFE, "serramento_pvc", ["soglia ribassata"], false, 1)).toEqual([]);
    expect(accessoriDaEtichette(TARIFFE, "serramento_pvc", ["soglia ribassata"], true, 1)).toEqual([
      { codice: "serramento.C25088-c", quantita: 1, etichetta: "soglia ribassata" },
    ]);
  });

  it("sull'alluminio sceglie anodizzazione, verniciatura e acustica", () => {
    expect(accessoriDaEtichette(TARIFFE, "serramento_alluminio", ["anodizzazione elettrocolore"], false, 2)[0].codice).toBe(
      "serramento.C15054-b"
    );
    expect(accessoriDaEtichette(TARIFFE, "serramento_alluminio", ["verniciatura colori speciali"], false, 2)[0].codice).toBe(
      "serramento.C15054-c"
    );
    expect(accessoriDaEtichette(TARIFFE, "serramento_alluminio", ["effetto legno"], false, 2)[0].codice).toBe("serramento.C15054-d");
    expect(accessoriDaEtichette(TARIFFE, "serramento_alluminio", ["vetro acustico"], false, 2)[0].codice).toBe("serramento.C15055");
  });

  it("l'anta a ribalta del legno-alluminio è la voce del suo foglio", () => {
    expect(accessoriDaEtichette(TARIFFE, "serramento_legno_alluminio", ["anta a ribalta"], false, 2)[0].codice).toBe(
      "serramento.C25124"
    );
  });

  // Minore: «coprifilo 180 mm» non è un coprifilo da 80.
  it("il numero del coprifilo si legge intero, non come sottostringa", () => {
    expect(accessoriDaEtichette(TARIFFE, "serramento_pvc", ["coprifilo 180 mm"], false, 2)).toEqual([]);
    expect(accessoriDaEtichette(TARIFFE, "serramento_pvc", ["coprifili da 80 mm"], false, 2)[0].codice).toBe(
      "serramento.C25088-h"
    );
  });

  // Minore: le categorie senza famiglia fissa la deducono dalla descrizione,
  // altrimenti il loro catalogo accessori resta vuoto.
  it("gli accessori di persiane e tapparelle escono dal catalogo del loro gruppo", () => {
    expect(
      accessoriDaEtichette(TARIFFE, "persiana", ["finitura pellicolata"], false, 1, "Persiane in PVC bianco")[0].codice
    ).toBe("persiana.C25084-a");
    expect(
      accessoriDaEtichette(TARIFFE, "tapparella", ["motore elettrico fino a 60 kg"], false, 1, "Tapparella in PVC")[0]
        .codice
    ).toBe("avvolgibile.C25091-e");
  });

  it("le etichette non riconosciute finiscono nella nota della riga", () => {
    const proposta = costruisciProposta(
      esito({ righe: [riga({ accessori: ["colore canapa"], larghezzaMm: 1000, altezzaMm: 1000, prezzoTotale: 100 })] }),
      { ...CONTESTO_127, pagine: [""] },
      false
    );
    expect(proposta.righe[0].note).toContain("accessori da verificare: colore canapa");
  });
});
