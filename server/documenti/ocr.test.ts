// D7 slice 4 — OCR locale con Tesseract 5: rilevamento esplicito di
// binario mancante, lingua mancante, timeout e limiti; fallback nel
// registro parser senza mai presentare come «analizzato» un contenuto non
// riconosciuto; idempotenza dei run legata alla firma OCR (versione,
// lingue effettive, configurazione); pulizia delle directory temporanee.
//
// Le prove che richiedono i binari veri (tesseract + pdftoppm) si saltano
// da sole quando mancano: il resto del contratto si prova comunque.

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { jsPDF } from "jspdf";
import {
  SOGLIA_CONFIDENZA_MEDIA,
  azzeraCacheOcrPerTest,
  configOcrDefault,
  disponibilitaOcr,
  eseguiOcrPdf,
  firmaOcrCorrente,
  lingueEffettive,
  parseTsv,
  richiedeRevisione,
} from "./ocr";
import { estraiTestoDocumento } from "./parserRegistry";
import { eseguiAnalisiConferma } from "./analisi";

const execFileAsync = promisify(execFile);

const disponibilita = await disponibilitaOcr();
const binariPresenti = disponibilita.disponibile;

function pdfNativo(righe: string[]): Buffer {
  const doc = new jsPDF();
  doc.setFontSize(16);
  righe.forEach((riga, n) => doc.text(riga, 14, 24 + n * 12));
  return Buffer.from(doc.output("arraybuffer"));
}

/**
 * Una vera "scansione": il PDF nativo viene renderizzato in PNG con
 * pdftoppm e reimpacchettato come pagina-immagine senza layer testuale.
 */
async function pdfScansionato(righe: string[], dpi = 200): Promise<Buffer> {
  const cartella = await fs.mkdtemp(path.join(os.tmpdir(), "ruffino-fix-"));
  try {
    const ingresso = path.join(cartella, "nativo.pdf");
    await fs.writeFile(ingresso, pdfNativo(righe));
    await execFileAsync(configOcrDefault().binari.pdftoppm, [
      "-r",
      String(dpi),
      "-png",
      "-f",
      "1",
      "-l",
      "1",
      ingresso,
      path.join(cartella, "img"),
    ]);
    const nomePng = (await fs.readdir(cartella)).find(n => n.endsWith(".png"))!;
    const png = await fs.readFile(path.join(cartella, nomePng));
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    doc.addImage(new Uint8Array(png), "PNG", 0, 0, 210, 297);
    return Buffer.from(doc.output("arraybuffer"));
  } finally {
    await fs.rm(cartella, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Isola os.tmpdir() su una cartella dedicata per la durata di `fn`, così
 * la verifica di pulizia non vede le directory di altri test concorrenti.
 * `residui` elenca ciò che l'OCR ha lasciato: deve essere vuoto.
 */
async function conTmpdirIsolata<T>(
  fn: () => Promise<T>
): Promise<{ risultato: T; residui: string[] }> {
  const isola = await fs.mkdtemp(path.join(os.tmpdir(), "ruffino-isola-"));
  const originale = process.env.TMPDIR;
  process.env.TMPDIR = isola;
  try {
    const risultato = await fn();
    return { risultato, residui: await fs.readdir(isola) };
  } finally {
    if (originale === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = originale;
    await fs.rm(isola, { recursive: true, force: true }).catch(() => {});
  }
}

afterEach(() => {
  delete process.env.OCR_TESSERACT_BIN;
  delete process.env.OCR_PDFTOPPM_BIN;
  azzeraCacheOcrPerTest();
});

describe("ocr — contratto senza binari", () => {
  it("binario mancante → ocr_non_disponibile con motivo esplicito, mai un fallback silenzioso", async () => {
    const esito = await eseguiOcrPdf(pdfNativo(["prova"]), {
      config: {
        binari: {
          pdftoppm: "/nonexistent/pdftoppm",
          tesseract: "/nonexistent/tesseract",
        },
      },
    });
    expect(esito.esito).toBe("ocr_non_disponibile");
    expect((esito as any).motivo).toContain("Binario mancante");
  });

  it("troppe pagine → ocr_fallito prima di lanciare qualsiasi processo", async () => {
    const esito = await eseguiOcrPdf(pdfNativo(["prova"]), {
      numeroPagine: 999,
      config: {
        binari: {
          pdftoppm: "/nonexistent/pdftoppm",
          tesseract: "/nonexistent/tesseract",
        },
      },
    });
    expect(esito.esito).toBe("ocr_fallito");
    expect((esito as any).motivo).toContain("oltre il limite OCR");
  });

  it("lingue effettive = richieste ∩ installate, con le mancanti dichiarate", () => {
    expect(lingueEffettive("ita+eng", ["eng", "deu"])).toEqual({
      effettive: ["eng"],
      mancanti: ["ita"],
    });
    expect(lingueEffettive("ita", ["eng"])).toEqual({
      effettive: [],
      mancanti: ["ita"],
    });
  });

  it("richiedeRevisione scatta sotto le soglie di confidenza", () => {
    const buona = { testo: "x", confidenza: SOGLIA_CONFIDENZA_MEDIA + 10, parole: 5 };
    expect(richiedeRevisione([buona])).toBe(false);
    expect(
      richiedeRevisione([{ testo: "x", confidenza: 40, parole: 5 }])
    ).toBe(true);
    expect(richiedeRevisione([])).toBe(true);
  });

  it("con l'OCR indisponibile la firma è «assente» e la scansione resta ferma col motivo", async () => {
    process.env.OCR_TESSERACT_BIN = "/nonexistent/tesseract";
    process.env.OCR_PDFTOPPM_BIN = "/nonexistent/pdftoppm";
    azzeraCacheOcrPerTest();
    expect(await firmaOcrCorrente()).toBe("assente");
  });
});

describe.skipIf(!binariPresenti)("ocr — con i binari reali", { timeout: 120_000 }, () => {
  it("una scansione diventa «estratto» via pdf-ocr, con confidenze e avvertenze", async () => {
    const bytes = await pdfScansionato([
      "CONFERMA D'ORDINE",
      "Vs. ordine: ORD-OCR-77",
      "Consegna prevista: 24/09/2026",
    ]);
    // Prova di controllo: senza OCR è davvero una scansione senza testo.
    const senzaOcr = await estraiTestoDocumento(
      bytes,
      "application/pdf",
      "scan.pdf",
      { ocr: false }
    );
    expect(senzaOcr.esito).toBe("scansione_senza_testo");
    expect((senzaOcr as any).motivo).toContain("non viene compreso");

    const { risultato: conOcr, residui } = await conTmpdirIsolata(() =>
      estraiTestoDocumento(bytes, "application/pdf", "scan.pdf", {
        ocr: { lingue: "eng" },
      })
    );
    expect(conOcr.esito).toBe("estratto");
    if (conOcr.esito !== "estratto") return;
    expect(conOcr.parser).toBe("pdf-ocr");
    expect(conOcr.pagine.join("\n")).toContain("ORD-OCR-77");
    expect(conOcr.pagine.join("\n")).toContain("24/09/2026");
    expect(conOcr.ocr?.confidenzaMedia).toBeGreaterThan(0);
    expect(typeof conOcr.ocr?.daVerificare).toBe("boolean");
    expect(conOcr.avvertenze.join(" ")).toContain("OCR locale");
    // Le directory temporanee non restano in giro.
    expect(residui).toEqual([]);
  });

  it("lingua non installata → ocr_fallito col motivo, niente esecuzione parziale", async () => {
    const esito = await eseguiOcrPdf(await pdfScansionato(["ciao"]), {
      config: { lingue: "xyz" },
    });
    expect(esito.esito).toBe("ocr_fallito");
    expect((esito as any).motivo).toContain("xyz");
  });

  it("timeout complessivo → ocr_fallito esplicito e directory ripulita", async () => {
    const bytes = await pdfScansionato(["testo lungo"]);
    const { risultato: esito, residui } = await conTmpdirIsolata(() =>
      eseguiOcrPdf(bytes, {
        config: { timeoutTotaleMs: 1, lingue: "eng" },
      })
    );
    expect(esito.esito).toBe("ocr_fallito");
    expect((esito as any).motivo).toContain("Timeout");
    expect(residui).toEqual([]);
  });

  it("la cache per impronta+firma non rifà l'OCR dello stesso file", async () => {
    const bytes = await pdfScansionato(["Documento identico"]);
    const primo = await eseguiOcrPdf(bytes, { config: { lingue: "eng" } });
    const secondo = await eseguiOcrPdf(bytes, { config: { lingue: "eng" } });
    expect(primo.esito).toBe("ocr_completato");
    expect(secondo).toBe(primo);
  });

  it("idempotenza dei run: la firma OCR fa parte della chiave (assente → disponibile → riuso)", async () => {
    const bytes = await pdfScansionato([
      "CONFERMA D'ORDINE",
      "Vs. ordine: ORD-OCR-IDEM",
      "Consegna prevista: 24/09/2026",
    ]);
    const documento = {
      id: 987001,
      commessaId: 987002,
      nome: "conferma-scansione.pdf",
      mimeType: "application/pdf",
      dataBase64: bytes.toString("base64"),
    };
    const ordine = {
      id: 987003,
      codiceOrdine: "ORD-OCR-IDEM",
      commessaCodice: null,
      dataConsegnaPrevista: "2026-09-10",
      importoTotale: null,
      righe: [],
      fornitoreNome: null,
    };

    // 1) OCR indisponibile: il run si ferma da scansione, firma «assente».
    process.env.OCR_TESSERACT_BIN = "/nonexistent/tesseract";
    process.env.OCR_PDFTOPPM_BIN = "/nonexistent/pdftoppm";
    azzeraCacheOcrPerTest();
    const fermo = await eseguiAnalisiConferma({
      sedeId: 987000,
      documento,
      ordine,
      createdBy: null,
    });
    expect(fermo.run.stato).toBe("scansione_senza_testo");
    expect(fermo.run.ocrFirma).toBe("assente");
    expect(fermo.run.motivoStato).toContain("Binario mancante");

    // 2) L'OCR compare: la firma cambia, il run fermo NON viene riusato.
    delete process.env.OCR_TESSERACT_BIN;
    delete process.env.OCR_PDFTOPPM_BIN;
    azzeraCacheOcrPerTest();
    const analizzato = await eseguiAnalisiConferma({
      sedeId: 987000,
      documento,
      ordine,
      createdBy: null,
    });
    expect(analizzato.riusata).toBe(false);
    expect(analizzato.run.id).not.toBe(fermo.run.id);
    expect(analizzato.run.stato).toBe("analizzata");
    expect(analizzato.run.parser).toBe("pdf-ocr");
    expect(analizzato.run.ocrFirma).toContain("pdf-ocr@");
    expect(
      analizzato.run.differenze.map(differenza => differenza.tipo)
    ).toContain("consegna_diversa");

    // 3) Stessa configurazione → riuso, nessun terzo run.
    const terzo = await eseguiAnalisiConferma({
      sedeId: 987000,
      documento,
      ordine,
      createdBy: null,
    });
    expect(terzo.riusata).toBe(true);
    expect(terzo.run.id).toBe(analizzato.run.id);
  });
});

describe("parseTsv — testo e riquadri delle parole", () => {
  it("tiene i riquadri, le righe e gli scarti dentro la riga", () => {
    const tsv = [
      "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
      "1\t1\t0\t0\t0\t0\t0\t0\t1240\t1754\t-1\t",
      "5\t1\t1\t1\t1\t1\t100\t200\t120\t30\t95\tTotale",
      "5\t1\t1\t1\t1\t2\t230\t200\t160\t30\t93\timponibile",
      "5\t1\t1\t1\t1\t3\t900\t200\t140\t30\t91\t7.762,25",
      "5\t1\t1\t1\t2\t1\t100\t250\t60\t30\t90\tIVA",
    ].join("\n");
    const pagina = parseTsv(tsv);
    expect(pagina.testo).toBe("Totale imponibile 7.762,25\nIVA");
    expect(pagina.confidenza).toBe(92);
    expect(pagina.parole).toBe(4);
    expect(pagina.geometria).toMatchObject({ larghezza: 1240, altezza: 1754, allineata: true });
    const [riga1, riga2] = pagina.geometria!.righe;
    expect(riga1.inizio).toBe(0);
    expect(riga2.inizio).toBe("Totale imponibile 7.762,25".length + 1);
    const valore = riga1.tratti[2];
    expect(pagina.testo.slice(valore.inizio, valore.fine)).toBe("7.762,25");
    expect(valore).toMatchObject({ x0: 900, x1: 1040 });
    expect(riga1).toMatchObject({ y0: 200, y1: 230 });
  });

  it("senza la riga di pagina del TSV la geometria manca ma il testo c'è", () => {
    const pagina = parseTsv("5\t1\t1\t1\t1\t1\t10\t10\t50\t20\t80\tciao\n");
    expect(pagina.testo).toBe("ciao");
    expect(pagina.geometria).toBeNull();
  });
});
