// Test dell'arricchimento dal layout del preventivo Ruffino 2025 (fase 3
// dello studio sui dati reali, 06/09/2026). Fixture sintetica che imita il
// testo OCR di quel layout (righe «Larghezza: … - Altezza: … Prez. Tot.»,
// quantità «Q.ta»/«Qt» sopra, totali in fondo): nessun PDF reale, nessun
// cliente reale.

import { describe, expect, it } from "vitest";
import { tariffeAttive } from "../../computo/tariffe";
import { casoWnd } from "../eval/casi";
import { arricchisciDaLayoutPreventivo, blocchiPreventivo, riconosceLayoutPreventivo } from "./layoutPreventivo";
import { costruisciProposta, type ContestoMappa } from "./mappa";
import type { EsitoModello } from "./schema";

const PAGINE_PREVENTIVO = [
  [
    "RuffinoGroup Via F. Crispi 135",
    "Nuovo preventivo del 1-lug-2025 Preventivo",
    "Egr. Sig. Rossi Mario",
    "Finestra a 2 ante DX con ribalta, profilo WnD: Prez. Unit. 1.552,81 €",
    "Larghezza: 1380mm - Altezza: 1530mm .",
    "Metri quadri: 2,11 Q.ta 2",
    "Finestra a 2 ante DX con ribalta Sconto 30%",
    "Larghezza: 1380mm - Altezza: 1530mm Prez. Tot. 2.173,94€",
    "Profilo: WnD Konfortline",
    "Finestra a 1 anta DX con ribalta: Prez. Unit. 948,53 €",
    "Larghezza: 880mm - Altezza: 1530mm Qt 1",
    "Metri quadri: 1,35",
    "Finestra a 1 anta DX con ribalta Sconto 30%",
    "Larghezza: 880mm - Altezza: 1530mm Prez. Tot. 663,97 €",
    "Coprifilo piatto 2,5x30 Qt 4 Prez. Tot. 100,97 €",
  ].join("\n"),
  [
    "Riepilogo Importi",
    "Totale Imponibile Beni: 2.837,91 €",
    "Totale Imponibile Complessivo: 2.938,88 €",
    "IVA Standard (22%): 624,54 €",
    "Totale Complessivo IVA Compresa: 3.563,42 €",
  ].join("\n"),
];

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

// Il modello ha letto le misure ma ha preso il prezzo unitario per totale,
// la quantità sbagliata e nessun pattuito: il caso visto sui contratti veri.
const ESITO: EsitoModello = {
  righe: [
    riga({ descrizione: "Finestra a 2 ante DX con ribalta", larghezzaMm: 1380, altezzaMm: 1530, quantita: 1, prezzoTotale: 1552.81, frammento: "Finestra a 2 ante DX con ribalta Sconto 30%" }),
    riga({ descrizione: "Finestra a 1 anta DX con ribalta", nAnte: 1, larghezzaMm: 880, altezzaMm: 1530, frammento: "Finestra a 1 anta DX con ribalta Sconto 30%" }),
    riga({ descrizione: "Coprifilo piatto 2,5x30", tipoProdotto: "accessorio", quantita: 4, prezzoTotale: 100.97, frammento: "Coprifilo piatto 2,5x30 Qt 4" }),
  ],
  pattuito: { totaleLordo: null, totaleImponibile: null, ivaDescrizione: null, pagina: 2, frammento: "Riepilogo Importi" },
  posa: { inclusa: true, prezzo: null, descrizione: null, pagina: 1, frammento: "Preventivo" },
  rate: [],
  cantiere: { indirizzo: null, comune: null, provincia: null, piano: null, pagina: 0, frammento: "" },
  cliente: { nome: "Rossi Mario", codiceFiscale: null, pagina: 1, frammento: "Egr. Sig. Rossi Mario" },
  dataDocumento: "01/07/2025",
  dataFirma: null,
  riferimento: null,
  detrazione: "non_indicata",
  note: "",
};

const CONTESTO: ContestoMappa = {
  tariffe: tariffeAttive(),
  clienteCommessa: { nome: "Rossi Mario", indirizzo: null, citta: "Sarzana (SP)", codiceFiscale: null, tipoDetrazione: null },
  pagine: PAGINE_PREVENTIVO,
};

describe("riconosceLayoutPreventivo / blocchiPreventivo", () => {
  it("riconosce il preventivo dalla riga «Larghezza … Altezza … Prez. Tot.» e ne legge i blocchi con quantità e nome", () => {
    expect(riconosceLayoutPreventivo(PAGINE_PREVENTIVO)).toBe(true);
    const blocchi = blocchiPreventivo(PAGINE_PREVENTIVO);
    expect(blocchi.map(b => [b.larghezzaMm, b.altezzaMm, b.quantita, b.prezzoTotCent, b.nome])).toEqual([
      [1380, 1530, 2, 217394, "Finestra a 2 ante DX con ribalta"],
      [880, 1530, 1, 66397, "Finestra a 1 anta DX con ribalta"],
    ]);
    expect(blocchi[0].evidenza).toEqual({ pagina: 1, frammento: "Larghezza: 1380mm - Altezza: 1530mm Prez. Tot. 2.173,94€" });
  });

  it("non scambia il layout WnD né un contratto in prosa per il preventivo", () => {
    expect(riconosceLayoutPreventivo(casoWnd().pagine)).toBe(false);
    expect(riconosceLayoutPreventivo(["Art. 2 Corrispettivo: importo complessivo di € 9.800,00 IVA inclusa."])).toBe(false);
    expect(riconosceLayoutPreventivo([])).toBe(false);
  });
});

describe("arricchisciDaLayoutPreventivo", () => {
  it("riscrive quantità e prezzo delle righe con le stesse misure, il pattuito lordo dai totali, e ricalcola i controlli", () => {
    const proposta = costruisciProposta(ESITO, CONTESTO, false);
    const arricchita = arricchisciDaLayoutPreventivo(PAGINE_PREVENTIVO, proposta, { ivaDescrizione: null, troncato: false });

    const [finestra2, finestra1, coprifilo] = arricchita.righe;
    expect(finestra2.quantita).toMatchObject({ valore: 2, daVerificare: false });
    expect(finestra2.prezzoTotCent).toMatchObject({ valore: 217394, daVerificare: false });
    expect(finestra2.larghezzaMm.evidenza).toEqual({ pagina: 1, frammento: "Larghezza: 1380mm - Altezza: 1530mm Prez. Tot. 2.173,94€" });
    expect(finestra1.prezzoTotCent).toMatchObject({ valore: 66397, daVerificare: false });
    expect(finestra1.quantita.valore).toBe(1);
    // Il coprifilo non ha misure: resta com'era.
    expect(coprifilo.prezzoTotCent.valore).toBe(proposta.righe[2].prezzoTotCent.valore);

    expect(arricchita.pattuitoCent).toMatchObject({ valore: 356342, daVerificare: false });
    expect(arricchita.pattuitoTipo).toMatchObject({ valore: "lordo", daVerificare: false });
    expect(arricchita.pattuitoCent.evidenza?.frammento).toBe("Totale Complessivo IVA Compresa: 3.563,42 €");
    expect(arricchita.avvertenze.some(a => a.startsWith("Layout del preventivo riconosciuto: misure, quantità e prezzi di 2 righe su 2 blocchi"))).toBe(true);
    // Controlli ricalcolati sulla proposta arricchita: il pattuito c'è.
    expect(arricchita.controlli.some(c => c.codice === "pattuito_mancante")).toBe(false);
  });

  it("una riga con misure diverse dal documento non si tocca; con più totali diversi il pattuito resta da verificare", () => {
    const esitoSbagliato: EsitoModello = { ...ESITO, righe: [riga({ descrizione: "Finestra", larghezzaMm: 1400, altezzaMm: 1530, prezzoTotale: 999 })] };
    const pagine = [PAGINE_PREVENTIVO[0], `${PAGINE_PREVENTIVO[1]}\nTotale Complessivo IVA Compresa: 3.900,00 €`];
    const proposta = costruisciProposta(esitoSbagliato, { ...CONTESTO, pagine }, false);
    const arricchita = arricchisciDaLayoutPreventivo(pagine, proposta);
    expect(arricchita.righe[0].prezzoTotCent.valore).toBe(99900);
    expect(arricchita.pattuitoCent).toMatchObject({ valore: 356342, daVerificare: true });
  });

  it("su un altro layout restituisce la proposta identica", () => {
    const pagine = ["Contratto in prosa senza righe di preventivo."];
    const proposta = costruisciProposta(ESITO, { ...CONTESTO, pagine }, false);
    expect(arricchisciDaLayoutPreventivo(pagine, proposta)).toBe(proposta);
  });
});
