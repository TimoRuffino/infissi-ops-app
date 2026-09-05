// Fixture sintetiche dell'eval della lettura del contratto (piano 3, Task 9).
//
// Ogni caso costruisce un documento REALE (PDF nativo via jsPDF, o scansione
// vera: stesso testo renderizzato in immagine con pdftoppm e reimpacchettato
// come PDF senza layer testuale) e dichiara: l'«esito finto» — cosa si finge
// abbia risposto il modello, coerente col testo del documento — e l'atteso
// — cosa la mappatura deterministica (costruisciProposta/arricchisciDaLayoutWnd)
// deve produrre a partire da quell'esito finto. Le fixture NON dimostrano
// l'accuratezza del modello reale: misurano che parser + mappatura restino
// corretti su casi controllati. `casoWnd()` è la STESSA fixture usata da
// `../estrazione/layoutWnd.test.ts` (Ruling P3-R8 punto 7/P3-R26): un'unica
// definizione, il test la importa da qui.
//
// I casi reali anonimizzati si aggiungono in `casi-reali/<nome>/` (fuori dal
// repository, `.gitignore`): mai un nome cliente, indirizzo, CF o PDF reale
// qui dentro — solo dati sintetici.

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { jsPDF } from "jspdf";
import { configOcrDefault } from "../../documenti/ocr";
import { tariffeAttive } from "../../computo/tariffe";
import type { ContestoMappa } from "../estrazione/mappa";
import type { EsitoModello } from "../estrazione/schema";

const execFileAsync = promisify(execFile);

export type AttesoRigaContratto = {
  larghezzaMm: number | null;
  altezzaMm: number | null;
  quantita: number | null;
  prezzoTotCent: number | null;
};

export type AttesoCasoContratto = {
  layoutWndRiconosciuto: boolean;
  numeroRighe: number;
  pattuitoCent: number | null;
  pattuitoTipo: "lordo" | "imponibile" | null;
  /** Percentuali delle rate, nell'ordine in cui la proposta le elenca. */
  rateQuote: number[];
  comuneCantiere?: string | null;
  /** Solo quando i valori riga sono noti con certezza (es. dal layout WnD). */
  righe?: AttesoRigaContratto[];
  /** Codici di controllo che DEVONO comparire nella proposta finale. */
  controlliAttesi: string[];
  /** Codici di controllo che NON devono comparire. */
  controlliVietati: string[];
};

export type CasoContrattoEval = {
  nome: string;
  descrizione: string;
  /** Il PDF vero da dare in pasto a `estraiTestoDocumento`. */
  bytes: Buffer;
  /** true solo per la scansione: senza pdftoppm/tesseract il caso si salta. */
  richiedeBinari: boolean;
  /** Testo di riferimento (per pagina) usato per costruire esito finto e atteso. */
  pagine: string[];
  /** Quel che si finge abbia risposto il modello; `null` per i casi reali. */
  esitoFinto: EsitoModello | null;
  contesto: ContestoMappa;
  atteso: AttesoCasoContratto;
};

/** Un `.text()` per riga, come `server/documenti/eval/casi.ts`: la geometria
 * ricostruisce ogni riga esattamente (verificato empiricamente sul layout WnD,
 * simboli «€» inclusi, con l'estrattore reale `pagineDaDocumento`). */
function pdfNativo(pagine: string[][]): Buffer {
  const doc = new jsPDF();
  doc.setFontSize(11);
  pagine.forEach((righe, indice) => {
    if (indice > 0) doc.addPage();
    righe.forEach((riga, n) => doc.text(riga, 14, 20 + n * 7));
  });
  return Buffer.from(doc.output("arraybuffer"));
}

/** Scansione vera: rendering con pdftoppm e reimpacchettamento immagine (come server/documenti/eval/casi.ts). */
async function pdfScansionato(pagine: string[][], opzioni?: { dpi?: number }): Promise<Buffer> {
  const cartella = await fs.mkdtemp(path.join(os.tmpdir(), "ruffino-eval-contratti-"));
  try {
    const ingresso = path.join(cartella, "nativo.pdf");
    await fs.writeFile(ingresso, pdfNativo(pagine));
    await execFileAsync(configOcrDefault().binari.pdftoppm, [
      "-r",
      String(opzioni?.dpi ?? 200),
      "-png",
      ingresso,
      path.join(cartella, "img"),
    ]);
    const nomi = (await fs.readdir(cartella))
      .filter(n => n.endsWith(".png"))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    for (const [indice, nome] of nomi.entries()) {
      if (indice > 0) doc.addPage();
      const png = await fs.readFile(path.join(cartella, nome));
      doc.addImage(new Uint8Array(png), "PNG", 0, 0, 210, 297);
    }
    return Buffer.from(doc.output("arraybuffer"));
  } finally {
    await fs.rm(cartella, { recursive: true, force: true }).catch(() => {});
  }
}

function rigaModello(parziale: Partial<EsitoModello["righe"][number]>): EsitoModello["righe"][number] {
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

// ── Caso 1: layout del configuratore WnD ─────────────────────────────────
//
// Stesso identico testo di `../estrazione/layoutWnd.test.ts` (PAGINE_WND):
// preventivo a 3 righe PVC (portafinestra + 2 finestre), coprifilo, maniglie
// e posa nel «Riepilogo Costi», totali 14.086,11 (imponibile) / 15.494,72
// (IVA inclusa), termini di pagamento 50/40/10. Nessun cliente reale: «Rossi
// Mario» è il nome sintetico già usato in tutta la suite dell'estrazione.

const RIGHE_WND_PAGINA_1 = [
  "Konfortline - Preventivo n. 127 del 12/03/2026",
  "Cliente: Rossi Mario",
  "",
  "1. Rif. Stanza: Soggiorno",
  "Prodotto: Portafinestra 2 ante in PVC Konfortline, finitura Real Wood",
  "Larghezza 1400 mm Altezza 2300 mm",
  "Vetro: basso emissivo",
  "Riepilogo",
  "Portafinestra 2 ante 5.200,00 € 0,00 € 1 0,00 € (0%) 5.200,00 €",
  "",
  "2. Rif. Stanza: Cucina",
  "Prodotto: Finestra 2 ante in PVC Konfortline bianco",
  "Larghezza 1400 mm Altezza 1300 mm",
  "Vetro: basso emissivo",
  "Riepilogo",
  "Finestra 2 ante 2.400,00 € 0,00 € 2 0,00 € (0%) 4.800,00 €",
  "",
  "3. Rif. Stanza: Camera",
  "Prodotto: Finestra 2 ante in PVC Konfortline bianco",
  "Larghezza 1200 mm Altezza 1300 mm",
  "Vetro: basso emissivo",
  "Riepilogo",
  "Finestra 2 ante 2.136,11 € 0,00 € 1 0,00 € (0%) 2.136,11 €",
];

const RIGHE_WND_PAGINA_2 = [
  "Riepilogo Costi",
  "Prodotto Prezzo unit. Installazione Quantità Sconto Totale",
  "Portafinestra 2 ante 5.200,00 € 0,00 € 1 0,00 € (0%) 5.200,00 €",
  "Finestra 2 ante 2.400,00 € 0,00 € 2 0,00 € (0%) 4.800,00 €",
  "Finestra 2 ante 2.136,11 € 0,00 € 1 0,00 € (0%) 2.136,11 €",
  "Coprifili in PVC su misura 600,00 € 0,00 € 1 0,00 € (0%) 600,00 €",
  "Maniglie in ottone 250,00 € 0,00 € 1 0,00 € (0%) 250,00 €",
  "Trasporto e posa in opera 1.100,00 € 0,00 € 1 0,00 € (0%) 1.100,00 €",
  "Totale IVA Esc. 14.086,11 €",
  "IVA 10% 1.408,61 €",
  "Totale IVA Incl. 15.494,72 €",
  "Termini di pagamento: ACCONTO DEL 50% ALLA FIRMA, 40% ALLA CONSEGNA, 10% A FINE LAVORI",
];

/**
 * L'esito finto è VOLUTAMENTE incerto (come `ESITO_INCERTO` in
 * layoutWnd.test.ts): il modello ha letto le righe ma ha sbagliato
 * un'altezza e non ha trovato prezzi né totali — è esattamente il caso in
 * cui l'arricchimento dal layout WnD deve intervenire e la corregge.
 */
function esitoFintoWnd(): EsitoModello {
  return {
    righe: [
      rigaModello({
        descrizione: "Portafinestra 2 ante in PVC Konfortline, finitura Real Wood",
        tipoProdotto: "portafinestra",
        larghezzaMm: 1400,
        altezzaMm: 2200, // sbagliata: il layout la corregge a 2300
        frammento: "Prodotto: Portafinestra 2 ante in PVC Konfortline, finitura Real Wood",
      }),
      rigaModello({
        descrizione: "Finestra 2 ante in PVC Konfortline bianco",
        frammento: "2. Rif. Stanza: Cucina",
      }),
      rigaModello({
        descrizione: "Finestra 2 ante in PVC Konfortline bianco",
        frammento: "3. Rif. Stanza: Camera",
      }),
    ],
    pattuito: { totaleLordo: null, totaleImponibile: null, ivaDescrizione: null, pagina: 2, frammento: "Riepilogo Costi" },
    posa: { inclusa: true, prezzo: null, descrizione: null, pagina: 2, frammento: "Trasporto e posa in opera" },
    rate: [],
    cantiere: { indirizzo: null, comune: "Sarzana", provincia: "SP", piano: null, pagina: 1, frammento: "Cliente: Rossi Mario" },
    cliente: { nome: "Rossi Mario", codiceFiscale: null, pagina: 1, frammento: "Cliente: Rossi Mario" },
    dataDocumento: "12/03/2026",
    dataFirma: null,
    riferimento: "127",
    detrazione: "non_indicata",
    note: "",
  };
}

export function casoWnd(): CasoContrattoEval {
  const pagine = [RIGHE_WND_PAGINA_1.join("\n"), RIGHE_WND_PAGINA_2.join("\n")];
  return {
    nome: "wnd-preventivo-3-righe",
    descrizione: "Preventivo del configuratore WnD: 3 righe PVC, coprifilo, maniglie e posa nel Riepilogo Costi",
    bytes: pdfNativo([RIGHE_WND_PAGINA_1, RIGHE_WND_PAGINA_2]),
    richiedeBinari: false,
    pagine,
    esitoFinto: esitoFintoWnd(),
    contesto: {
      tariffe: tariffeAttive(),
      clienteCommessa: { nome: "Rossi Mario", indirizzo: null, citta: "Sarzana (SP)", codiceFiscale: null, tipoDetrazione: null },
      pagine,
    },
    atteso: {
      layoutWndRiconosciuto: true,
      numeroRighe: 3,
      pattuitoCent: 1_549_472,
      pattuitoTipo: "lordo",
      rateQuote: [50, 40, 10],
      comuneCantiere: "Sarzana",
      righe: [
        { larghezzaMm: 1400, altezzaMm: 2300, quantita: 1, prezzoTotCent: 520_000 },
        { larghezzaMm: 1400, altezzaMm: 1300, quantita: 2, prezzoTotCent: 480_000 },
        { larghezzaMm: 1200, altezzaMm: 1300, quantita: 1, prezzoTotCent: 213_611 },
      ],
      // P3-R22: senza ivaDescrizione dal modello, l'arricchimento usa la riga
      // IVA unica del layout ("IVA 10%") e il controllo resta un avviso (la
      // somma delle righe lette non copre l'imponibile: mancano coprifili,
      // maniglie e posa che il modello finto non ha proposto come righe).
      controlliAttesi: ["righe_vs_pattuito"],
      controlliVietati: ["pattuito", "righe_senza_prezzo", "nessuna_riga", "documento_troncato"],
    },
  };
}

// ── Caso 2: contratto in prosa (Word) ────────────────────────────────────
//
// Nessun layout riconoscibile: la mappatura si affida solo all'esito del
// modello. Un pattuito unico «IVA inclusa» (nessuna aliquota indicata) rende
// il controllo di somma un avviso, mai un errore o un numero inventato.

const RIGHE_WORD = [
  "CONTRATTO DI FORNITURA E POSA IN OPERA",
  "Cliente: Verdi Luca",
  "Cantiere: Via Roma 12, La Spezia (SP)",
  "Riferimento pratica: CTR-2026-014",
  "Data: 01/03/2026",
  "Art. 1 Oggetto: fornitura e posa in opera di n. 4 finestre in PVC a due ante colore bianco, e n. 2 persiane in alluminio a battente.",
  "Art. 2 Corrispettivo: importo complessivo di € 9.800,00 IVA inclusa.",
  "Art. 3 Pagamento: 50% all'ordine, 50% a fine lavori.",
];

function esitoFintoWord(): EsitoModello {
  return {
    righe: [
      rigaModello({
        descrizione: "n. 4 finestre in PVC a due ante colore bianco",
        tipoProdotto: "finestra",
        materiale: "pvc",
        nAnte: 2,
        quantita: 4,
        frammento: "fornitura e posa in opera di n. 4 finestre in PVC a due ante colore bianco",
      }),
      rigaModello({
        descrizione: "n. 2 persiane in alluminio a battente",
        tipoProdotto: "persiana",
        materiale: "alluminio",
        nAnte: 0,
        quantita: 2,
        frammento: "n. 2 persiane in alluminio a battente",
      }),
    ],
    pattuito: {
      totaleLordo: 9800,
      totaleImponibile: null,
      ivaDescrizione: "IVA inclusa",
      pagina: 1,
      frammento: "importo complessivo di € 9.800,00 IVA inclusa",
    },
    posa: { inclusa: true, prezzo: null, descrizione: null, pagina: 1, frammento: "fornitura e posa in opera" },
    rate: [
      { quotaPct: 50, descrizione: "50% all'ordine", scadenza: null, pagina: 1, frammento: "50% all'ordine" },
      { quotaPct: 50, descrizione: "50% a fine lavori", scadenza: null, pagina: 1, frammento: "50% a fine lavori" },
    ],
    cantiere: {
      indirizzo: "Via Roma 12",
      comune: "La Spezia",
      provincia: "SP",
      piano: null,
      pagina: 1,
      frammento: "Cantiere: Via Roma 12, La Spezia (SP)",
    },
    cliente: { nome: "Verdi Luca", codiceFiscale: null, pagina: 1, frammento: "Cliente: Verdi Luca" },
    dataDocumento: "01/03/2026",
    dataFirma: null,
    riferimento: "CTR-2026-014",
    detrazione: "non_indicata",
    note: "",
  };
}

export function casoWord(): CasoContrattoEval {
  const pagine = [RIGHE_WORD.join("\n")];
  return {
    nome: "word-prosa-finestre-persiane",
    descrizione: "Contratto in prosa: 4 finestre PVC + 2 persiane alluminio, pattuito unico IVA inclusa",
    bytes: pdfNativo([RIGHE_WORD]),
    richiedeBinari: false,
    pagine,
    esitoFinto: esitoFintoWord(),
    contesto: {
      tariffe: tariffeAttive(),
      clienteCommessa: { nome: "Verdi Luca", indirizzo: null, citta: "La Spezia (SP)", codiceFiscale: null, tipoDetrazione: null },
      pagine,
    },
    atteso: {
      layoutWndRiconosciuto: false,
      numeroRighe: 2,
      pattuitoCent: 980_000,
      pattuitoTipo: "lordo",
      rateQuote: [50, 50],
      // «IVA inclusa» non è un'aliquota numerica: la somma resta un avviso,
      // mai un'invenzione (P3-R1). Nessuna misura né prezzo per riga: due
      // avvisi in più, sempre e solo avvisi.
      controlliAttesi: ["righe_vs_pattuito", "righe_senza_misure", "righe_senza_prezzo", "cliente_citato"],
      controlliVietati: ["pattuito", "nessuna_riga", "documento_troncato", "rate_somma"],
    },
  };
}

// ── Caso 3: la stessa prosa, ma come scansione vera ──────────────────────
//
// Stesso testo del caso 2, reso come immagine (nessun layer testuale) e
// letto tramite OCR locale: richiede pdftoppm/tesseract, si salta senza. Il
// testo OCR è rumoroso per costruzione: l'atteso numerico eredita quello del
// caso 2 (l'esito finto non dipende dal testo del parser), ma il giudizio
// sulle evidenze non fa promesse di accuratezza OCR — coerente con
// `server/documenti/eval`.
export async function casoScansione(): Promise<CasoContrattoEval> {
  const base = casoWord();
  const bytes = await pdfScansionato([RIGHE_WORD]).catch(() => Buffer.alloc(0));
  return {
    ...base,
    nome: "scansione-prosa-finestre-persiane",
    descrizione: "Come il contratto in prosa, ma reso come immagine (scansione vera) e letto via OCR locale",
    bytes,
    richiedeBinari: true,
  };
}

export async function casiContrattoSintetici(): Promise<CasoContrattoEval[]> {
  return [casoWnd(), casoWord(), await casoScansione()];
}

/**
 * Casi reali anonimizzati: `casi-reali/<nome>/documento.pdf` + `atteso.json`
 * accanto. La cartella è in `.gitignore`: i documenti reali NON entrano MAI
 * nel repository (stessa procedura di `docs/reports/d7-eval-2026-08-29.md`).
 * Senza un provider reale disponibile questi casi si saltano (nessun esito
 * finto: non si può fingere la lettura di un documento sconosciuto).
 */
export async function caricaCasiContrattoReali(): Promise<CasoContrattoEval[]> {
  const radice = path.join(import.meta.dirname, "casi-reali");
  const casi: CasoContrattoEval[] = [];
  let voci: string[];
  try {
    voci = await fs.readdir(radice);
  } catch {
    return casi; // La cartella non esiste: nessun caso reale, nessun errore.
  }
  for (const voce of voci.sort()) {
    const cartella = path.join(radice, voce);
    try {
      const [bytes, attesoRaw] = await Promise.all([
        fs.readFile(path.join(cartella, "documento.pdf")),
        fs.readFile(path.join(cartella, "atteso.json"), "utf8"),
      ]);
      const atteso = JSON.parse(attesoRaw);
      const attesoCaso = atteso.atteso ?? {};
      casi.push({
        nome: `reale-${voce}`,
        descrizione: String(atteso.descrizione ?? "caso reale anonimizzato"),
        bytes,
        richiedeBinari: Boolean(atteso.richiedeBinari ?? false),
        pagine: [],
        esitoFinto: null,
        contesto: {
          tariffe: tariffeAttive(),
          clienteCommessa: atteso.clienteCommessa ?? {
            nome: null,
            indirizzo: null,
            citta: null,
            codiceFiscale: null,
            tipoDetrazione: null,
          },
          pagine: [],
        },
        atteso: {
          layoutWndRiconosciuto: Boolean(attesoCaso.layoutWndRiconosciuto ?? false),
          numeroRighe: Number(attesoCaso.numeroRighe ?? 0),
          pattuitoCent: attesoCaso.pattuitoCent ?? null,
          pattuitoTipo: attesoCaso.pattuitoTipo ?? null,
          rateQuote: attesoCaso.rateQuote ?? [],
          comuneCantiere: attesoCaso.comuneCantiere,
          righe: attesoCaso.righe,
          controlliAttesi: attesoCaso.controlliAttesi ?? [],
          controlliVietati: attesoCaso.controlliVietati ?? [],
        },
      });
    } catch (errore: any) {
      console.warn(`[eval] caso reale «${voce}» ignorato: ${String(errore?.message ?? errore)}`);
    }
  }
  return casi;
}
