import { describe, expect, it } from "vitest";
import type {
  RigaFattura,
  ScadenzaFattura,
  TipoRiga,
} from "@shared/fatturazione/tipi";
import { DICITURE } from "@shared/fatturazione/diciture";
import {
  badgeStatoFattura,
  DICITURE_SELEZIONABILI,
  etichettaTabFattura,
  ibanSembraValido,
  indicatoreLimite,
  nomeFileFattura,
  raggruppaRighe,
  riepilogoControlli,
  riepilogoView,
  scadenzeQuadrano,
  sommaScadenzeCent,
  testoDicitura,
} from "./fatturaView";

const riga = (
  tipo: TipoRiga,
  extra: Partial<RigaFattura> = {}
): RigaFattura => ({
  id: 1,
  fatturaId: 1,
  ordine: 1,
  tipo,
  descrizione: tipo,
  quantita: 1,
  prezzoUnitCent: 0,
  importoCent: 0,
  aliquota: tipo === "intestazione" || tipo === "nota" ? null : 22,
  voceComputoCodice: null,
  rigaCommessaId: null,
  limiteCent: null,
  beneSignificativo: false,
  derivata:
    tipo === "markup" || tipo === "storno_bs" || tipo === "riaddebito_bs",
  ...extra,
});

const scadenza = (
  numero: number,
  quotaPct: number,
  importoCent: number,
  extra: Partial<ScadenzaFattura> = {}
): ScadenzaFattura => ({
  id: numero,
  fatturaId: 1,
  numero,
  quotaPct,
  data: "2026-09-01",
  importoCent,
  descrizione: null,
  ficPaymentId: null,
  stato: "attesa",
  ...extra,
});

// Numeri della fattura reale del caso 127 (v. brief Task 14 / plan
// fatturazione-dal-contratto): riepilogo IVA, imponibile, IVA, totale,
// pattuito e markup così come li scrive il motore.
const fatturaCaso127 = {
  riepilogo: [
    { aliquota: 22 as const, imponibileCent: 404887, impostaCent: 89075 },
    { aliquota: 10 as const, imponibileCent: 959718, impostaCent: 95972 },
  ],
  imponibileCent: 1364605,
  ivaCent: 185047,
  totaleCent: 1549652,
  deltaPattuitoCent: 0,
  pattuitoCent: 1549652,
  pattuitoTipo: "lordo" as const,
  markupCent: 215359,
};

describe("fatturaView", () => {
  it("badgeStatoFattura mappa ogni stato al testo e al tono giusti", () => {
    expect(badgeStatoFattura("bozza", false)).toEqual({
      testo: "Bozza",
      tono: "neutro",
    });
    expect(badgeStatoFattura("in_emissione", false)).toEqual({
      testo: "In emissione",
      tono: "attenzione",
    });
    expect(badgeStatoFattura("emessa", true)).toEqual({
      testo: "Emessa (prova SdI)",
      tono: "attenzione",
    });
    expect(badgeStatoFattura("emessa", false)).toEqual({
      testo: "Emessa",
      tono: "ok",
    });
    expect(badgeStatoFattura("inviata", false)).toEqual({
      testo: "Inviata allo SdI",
      tono: "ok",
    });
    expect(badgeStatoFattura("consegnata", false)).toEqual({
      testo: "Consegnata",
      tono: "ok",
    });
    expect(badgeStatoFattura("scartata", false)).toEqual({
      testo: "Scartata dallo SdI",
      tono: "errore",
    });
    expect(badgeStatoFattura("rifiutata", false)).toEqual({
      testo: "Rifiutata dal cliente",
      tono: "errore",
    });
    expect(badgeStatoFattura("mancata_consegna", false)).toEqual({
      testo: "Mancata consegna",
      tono: "attenzione",
    });
    expect(badgeStatoFattura("annullata", false)).toEqual({
      testo: "Annullata",
      tono: "neutro",
    });
  });

  // Uno stato nuovo lato server (o una risposta più recente del bundle
  // che il browser ha in cache) non deve far sparire il badge — e con
  // lui, in React, la riga che lo contiene.
  it("badgeStatoFattura non si rompe su uno stato che non conosce", () => {
    expect(badgeStatoFattura("stato_futuro" as never, false)).toEqual({
      testo: "stato_futuro",
      tono: "neutro",
    });
  });

  // Sequenza reale del generatore: intestazione+2 beni, markup subito dopo
  // l'ultimo bene, poi l'intestazione dei servizi, il servizio, storno e
  // riaddebito BS (in coda, non contigui al markup) e infine una nota.
  it("raggruppa le righe tenendo le intestazioni nel gruppo che introducono", () => {
    const righe = [
      riga("intestazione", {
        id: 1,
        ordine: 1,
        descrizione: DICITURE.intestazione,
      }),
      riga("bene", {
        id: 2,
        ordine: 2,
        descrizione: "Finestra A",
        importoCent: 100000,
      }),
      riga("bene", {
        id: 3,
        ordine: 3,
        descrizione: "Finestra B",
        importoCent: 50000,
      }),
      riga("markup", {
        id: 4,
        ordine: 4,
        descrizione: DICITURE.markup,
        importoCent: 15000,
      }),
      riga("intestazione", {
        id: 5,
        ordine: 5,
        descrizione: DICITURE.prestazioni,
      }),
      riga("servizio", {
        id: 6,
        ordine: 6,
        descrizione: "Posa in opera",
        importoCent: 30000,
        aliquota: 10,
      }),
      riga("storno_bs", {
        id: 7,
        ordine: 7,
        descrizione: DICITURE.storno_bs,
        importoCent: -5000,
      }),
      riga("riaddebito_bs", {
        id: 8,
        ordine: 8,
        descrizione: DICITURE.riaddebito_bs,
        importoCent: 5000,
        aliquota: 10,
      }),
      riga("nota", { id: 9, ordine: 9, descrizione: "Pagamento 50/40/10" }),
    ];

    const gruppi = raggruppaRighe(righe);
    expect(gruppi.map(g => g.chiave)).toEqual([
      "beni",
      "servizi",
      "derivate",
      "note",
    ]);

    const beni = gruppi.find(g => g.chiave === "beni")!;
    expect(beni.titolo).toBe("Beni");
    expect(beni.righe.map(r => r.tipo)).toEqual([
      "intestazione",
      "bene",
      "bene",
    ]);
    expect(beni.totaleCent).toBe(150000);

    const servizi = gruppi.find(g => g.chiave === "servizi")!;
    expect(servizi.righe.map(r => r.tipo)).toEqual([
      "intestazione",
      "servizio",
    ]);
    expect(servizi.totaleCent).toBe(30000);

    const derivate = gruppi.find(g => g.chiave === "derivate")!;
    expect(derivate.righe.map(r => r.tipo)).toEqual([
      "markup",
      "storno_bs",
      "riaddebito_bs",
    ]);
    expect(derivate.totaleCent).toBe(15000);

    const note = gruppi.find(g => g.chiave === "note")!;
    expect(note.righe.map(r => r.tipo)).toEqual(["nota"]);
    expect(note.totaleCent).toBe(0);
  });

  it("indicatoreLimite segnala entro/oltre solo per i servizi con limite", () => {
    expect(
      indicatoreLimite(
        riga("servizio", { limiteCent: 50000, importoCent: 40000 })
      )
    ).toEqual({
      stato: "ok",
      testo: "entro il limite (€ 500,00)",
    });
    expect(
      indicatoreLimite(
        riga("servizio", { limiteCent: 50000, importoCent: 60000 })
      )
    ).toEqual({
      stato: "oltre",
      testo: "oltre il limite di € 100,00",
    });
    expect(
      indicatoreLimite(
        riga("servizio", { limiteCent: null, importoCent: 40000 })
      ).stato
    ).toBe("n_a");
    expect(
      indicatoreLimite(riga("bene", { limiteCent: 50000, importoCent: 40000 }))
        .stato
    ).toBe("n_a");
  });

  it("riepilogoView mostra le aliquote, IVA, totale e markup del caso 127", () => {
    expect(riepilogoView(fatturaCaso127)).toEqual([
      { etichetta: "22 %", valore: "€ 4.048,87 / € 890,75" },
      { etichetta: "10 %", valore: "€ 9.597,18 / € 959,72" },
      { etichetta: "IVA", valore: "€ 1.850,47" },
      { etichetta: "Totale", valore: "€ 15.496,52" },
      { etichetta: "Markup", valore: "€ 2.153,59" },
    ]);
  });

  it("riepilogoView aggiunge «Δ pattuito» con tono attenzione solo se il delta non è zero", () => {
    expect(
      riepilogoView(fatturaCaso127).some(r => r.etichetta === "Δ pattuito")
    ).toBe(false);

    const conDelta = { ...fatturaCaso127, deltaPattuitoCent: 500 };
    expect(riepilogoView(conDelta).at(-1)).toEqual({
      etichetta: "Δ pattuito",
      valore: "€ 5,00",
      tono: "attenzione",
    });
  });

  it("riepilogoView mette tono errore sulla riga Markup quando il markup è negativo", () => {
    const conMarkupNegativo = { ...fatturaCaso127, markupCent: -300044 };
    expect(
      riepilogoView(conMarkupNegativo).find(r => r.etichetta === "Markup")
    ).toEqual({
      etichetta: "Markup",
      valore: "€ -3.000,44",
      tono: "errore",
    });
  });

  it("riepilogoControlli separa errori, avvisi e conta gli ok", () => {
    expect(
      riepilogoControlli([
        { esito: "errore", messaggio: "Il totale non torna con le scadenze." },
        {
          esito: "avviso",
          messaggio: "Il computo dei limiti non è aggiornato.",
        },
        { esito: "ok", messaggio: "Cliente valido." },
        { esito: "ok", messaggio: "Diciture complete." },
      ])
    ).toEqual({
      errori: ["Il totale non torna con le scadenze."],
      avvisi: ["Il computo dei limiti non è aggiornato."],
      ok: 2,
    });
  });

  // 50/40/10 del caso 127: 774.826 + 619.861 + 154.965 = 1.549.652.
  it("le scadenze del caso 127 sommano al totale (50/40/10)", () => {
    const scadenze = [
      scadenza(1, 50, 774826),
      scadenza(2, 40, 619861),
      scadenza(3, 10, 154965),
    ];
    expect(sommaScadenzeCent(scadenze)).toBe(1549652);
    expect(scadenzeQuadrano(scadenze, 1549652)).toBe(true);
    expect(scadenzeQuadrano(scadenze, 1549653)).toBe(false);
  });

  it("testoDicitura legge da DICITURE con la chiave stessa come fallback", () => {
    expect(testoDicitura("markup")).toBe(DICITURE.markup);
    expect(testoDicitura("chiave_mai_vista")).toBe("chiave_mai_vista");
  });

  it("etichettaTabFattura riassume lo stato delle fatture della commessa", () => {
    expect(etichettaTabFattura(undefined)).toBe("Fattura");
    expect(etichettaTabFattura([])).toBe("Fattura");
    expect(
      etichettaTabFattura([
        { stato: "bozza", tipo: "fattura", inviataDryRun: false },
      ])
    ).toBe("Fattura · bozza");
    expect(
      etichettaTabFattura([
        { stato: "consegnata", tipo: "fattura", inviataDryRun: false },
      ])
    ).toBe("Fattura ✓");
    expect(
      etichettaTabFattura([
        { stato: "consegnata", tipo: "fattura", inviataDryRun: false },
        { stato: "scartata", tipo: "nota_credito", inviataDryRun: false },
      ])
    ).toBe("Fattura !");
  });

  it("nomeFileFattura sostituisce lo slash del numero e gestisce la bozza", () => {
    expect(
      nomeFileFattura({ numero: "127/2026", tipo: "fattura" }, "pdf")
    ).toBe("Fattura 127-2026.pdf");
    expect(
      nomeFileFattura({ numero: "1/2026", tipo: "nota_credito" }, "xml")
    ).toBe("Nota di credito 1-2026.xml");
    expect(nomeFileFattura({ numero: null, tipo: "fattura" }, "pdf")).toBe(
      "Fattura bozza.pdf"
    );
  });

  it("DICITURE_SELEZIONABILI tiene solo le diciture in calce (R28)", () => {
    // Ogni chiave offerta all'operatore deve esistere davvero: una chiave
    // sconosciuta verrebbe rifiutata dal router (`z.enum` su DICITURE).
    for (const chiave of DICITURE_SELEZIONABILI) {
      expect(Object.keys(DICITURE)).toContain(chiave);
    }
    // I testi di riga li stampa il generatore al posto giusto: spuntarli
    // qui li duplicherebbe in fondo al documento.
    const testiDiRiga = [
      "intestazione",
      "seguira_ddt",
      "beni_significativi",
      "beni_autonomi",
      "prestazioni",
      "markup",
      "storno_bs",
      "riaddebito_bs",
    ];
    for (const chiave of testiDiRiga) {
      expect(DICITURE_SELEZIONABILI).not.toContain(chiave);
    }
    // Le due liste insieme coprono tutte le chiavi: una dicitura nuova non
    // può restare fuori da entrambe senza far fallire questo test.
    expect(DICITURE_SELEZIONABILI.length + testiDiRiga.length).toBe(
      Object.keys(DICITURE).length
    );
  });

  it("ibanSembraValido verifica il formato italiano e il modulo 97", () => {
    expect(ibanSembraValido("IT60X0542811101000000123456")).toBe(true);
    expect(ibanSembraValido("it60 x054 2811 1010 0000 0123 456")).toBe(true);
    // Stessa forma, cifra di controllo sbagliata (60 → 61): mod 97 fallisce.
    expect(ibanSembraValido("IT61X0542811101000000123456")).toBe(false);
    expect(ibanSembraValido("DE60X0542811101000000123456")).toBe(false);
    expect(ibanSembraValido("")).toBe(false);
  });
});
