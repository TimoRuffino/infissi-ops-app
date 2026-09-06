import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TarsProvider } from "../tars/provider";
import { azzeraCacheVisionePerTest } from "./letturaVisiva";
import { estraiTestoDocumento } from "./parserRegistry";
import { jsPDF } from "jspdf";

// Una foto (PNG di un pixel: per il parser è un'immagine senza livello di
// testo) letta SENZA OCR: la lettura visiva è l'unica strada, e parte solo
// se chi chiama passa un'identità.

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

function providerConTesto(testo: string, richieste: unknown[] = []): TarsProvider {
  return {
    nome: "finto-visione",
    async rispondi(richiesta) {
      richieste.push(richiesta);
      return {
        tipo: "messaggio",
        testo,
        uso: { input: 900, output: 100, cachedInput: 0, cacheWrite: 0 },
      };
    },
  };
}

describe("estraiTestoDocumento — foto e lettura visiva", () => {
  beforeEach(() => {
    vi.stubEnv("FLAG_LETTURA_VISIVA", "on");
    azzeraCacheVisionePerTest();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("una foto senza identità per la visione resta «scansione senza testo», senza chiamate", async () => {
    const richieste: unknown[] = [];
    const esito = await estraiTestoDocumento(PNG, "image/png", "foto.png", { ocr: false });
    expect(esito.esito).toBe("scansione_senza_testo");
    expect(esito.esito === "scansione_senza_testo" && esito.parser).toBe("immagine");
    expect(richieste).toHaveLength(0);
  });

  it("con l'identità la foto viene trascritta dal modello: parser «visione», avvertenza e token", async () => {
    const richieste: unknown[] = [];
    const esito = await estraiTestoDocumento(PNG, "image/png", "foto.png", {
      ocr: false,
      visione: {
        sedeId: 1,
        utenteId: 7,
        deps: { provider: () => providerConTesto("BT GLASS Srl\nTotale   7.762,25", richieste), modello: "m" },
      },
    });
    expect(esito.esito).toBe("estratto");
    if (esito.esito !== "estratto") return;
    expect(esito.parser).toBe("visione");
    expect(esito.pagine).toEqual(["BT GLASS Srl\nTotale   7.762,25"]);
    expect(esito.visione).toEqual({ modello: "m", pagine: 1, tokenInput: 900, tokenOutput: 100 });
    expect(esito.avvertenze[0]).toContain("trascritto dal modello");
    expect(richieste).toHaveLength(1);
  });

  it("una foto chiamata HEIC con dentro un PNG passa al modello come PNG (06/09/2026: l'HEIC si converte in testa)", async () => {
    const richieste: unknown[] = [];
    const esito = await estraiTestoDocumento(PNG, "image/heic", "foto.heic", {
      ocr: false,
      visione: { sedeId: 1, utenteId: 7, deps: { provider: () => providerConTesto("Letta", richieste), modello: "m" } },
    });
    expect(esito.esito === "estratto" && esito.parser).toBe("visione");
    expect(richieste).toHaveLength(1);
  });

  it("un HEIC corrotto è illeggibile con il motivo, e il modello non viene chiamato", async () => {
    const richieste: unknown[] = [];
    const esito = await estraiTestoDocumento(Buffer.from("non è una foto"), "image/heic", "rotta.heic", {
      ocr: false,
      visione: { sedeId: 1, utenteId: 7, deps: { provider: () => providerConTesto("x", richieste), modello: "m" } },
    });
    expect(esito.esito).toBe("illeggibile");
    expect(esito.esito === "illeggibile" && esito.motivo).toMatch(/HEIC non convertibile/);
    expect(richieste).toHaveLength(0);
  });

  it("con preferisciVisione il modello legge per primo, senza aspettare l'esito dell'OCR", async () => {
    const richieste: unknown[] = [];
    const esito = await estraiTestoDocumento(PNG, "image/png", "foto.png", {
      preferisciVisione: true,
      visione: { sedeId: 1, utenteId: 7, deps: { provider: () => providerConTesto("Contratto 1", richieste), modello: "m" } },
    });
    expect(esito.esito === "estratto" && esito.parser).toBe("visione");
    expect(richieste).toHaveLength(1);
  });

  it("con preferisciVisione e visione non disponibile si passa all'OCR (o resta senza testo se manca anche quello)", async () => {
    const esito = await estraiTestoDocumento(PNG, "image/png", "foto.png", {
      preferisciVisione: true,
      ocr: false,
      visione: { sedeId: 1, utenteId: 7, deps: { provider: () => null, modello: "m" } },
    });
    expect(esito.esito).toBe("scansione_senza_testo");
    expect(esito.esito === "scansione_senza_testo" && esito.motivo).toContain("Lettura visiva non riuscita");
  });

  it("un PDF misto (pagina scansionata + pagina di testo) con preferisciVisione: la pagina vuota è trascritta dal modello, l'altra resta nativa", async () => {
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    doc.addImage(new Uint8Array(PNG), "PNG", 10, 10, 100, 100);
    doc.addPage();
    doc.text("Condizioni generali di vendita. Art. 1 Oggetto del contratto.", 14, 20);
    const misto = Buffer.from(doc.output("arraybuffer"));
    const richieste: unknown[] = [];
    const esito = await estraiTestoDocumento(misto, "application/pdf", "misto.pdf", {
      preferisciVisione: true,
      visione: { sedeId: 1, utenteId: 7, deps: { provider: () => providerConTesto("Finestra a 2 ante   Prez. Tot.   1.186,48 €", richieste), modello: "m" } },
    });
    expect(esito.esito).toBe("estratto");
    if (esito.esito !== "estratto") return;
    expect(esito.parser).toBe("pdf-testo-nativo");
    expect(esito.pagine[0]).toContain("Finestra a 2 ante");
    expect(esito.pagine[1]).toContain("Condizioni generali di vendita");
    expect(esito.avvertenze.some(a => a.startsWith("1 pagine senza testo trascritte dal modello"))).toBe(true);
  });

  it("se la lettura visiva non è disponibile il documento resta com'era, con il motivo in coda", async () => {
    const esito = await estraiTestoDocumento(PNG, "image/png", "foto.png", {
      ocr: false,
      visione: { sedeId: 1, utenteId: 7, deps: { provider: () => null, modello: "m" } },
    });
    expect(esito.esito).toBe("scansione_senza_testo");
    expect(esito.esito === "scansione_senza_testo" && esito.motivo).toContain("Lettura visiva non riuscita");
  });
});

// ── Riquadri per la lettura «visione prima» (anteprime, 06/09/2026) ────────
// Quando il modello legge per primo, tesseract gira solo per le posizioni
// delle parole: la geometria arriva non allineata e serve alla vignetta.
import { jsPDF } from "jspdf";
import { disponibilitaOcr, renderizzaPaginePng } from "./ocr";

const binariPresenti = (await disponibilitaOcr()).disponibile;

async function pngConTesto(righe: string[]): Promise<Buffer> {
  const doc = new jsPDF();
  doc.setFontSize(18);
  righe.forEach((riga, n) => doc.text(riga, 14, 30 + n * 14));
  const rendering = await renderizzaPaginePng(Buffer.from(doc.output("arraybuffer")), {
    dpi: 150,
    maxPagine: 1,
    timeoutMs: 30_000,
  });
  if (rendering.esito !== "ok") throw new Error(rendering.motivo);
  return rendering.immagini[0];
}

describe.skipIf(!binariPresenti)("estraiTestoDocumento — riquadri dall'OCR dopo la visione", { timeout: 120_000 }, () => {
  beforeEach(() => {
    vi.stubEnv("FLAG_LETTURA_VISIVA", "on");
    vi.stubEnv("FLAG_OCR", "on");
    azzeraCacheVisionePerTest();
  });

  it("con «visione prima» il testo è del modello e la geometria, non allineata, viene da tesseract", async () => {
    const png = await pngConTesto(["CONFERMA ORDINE 4471", "Totale imponibile 1.234,00"]);
    const esito = await estraiTestoDocumento(png, "image/png", "scan.png", {
      preferisciVisione: true,
      ocr: { lingue: "eng" },
      visione: {
        sedeId: 1,
        utenteId: 7,
        deps: { provider: () => providerConTesto("CONFERMA ORDINE 4471\nTotale imponibile 1.234,00"), modello: "m" },
      },
    });
    expect(esito.esito).toBe("estratto");
    if (esito.esito !== "estratto") return;
    expect(esito.parser).toBe("visione");
    expect(esito.geometria?.[0]?.allineata).toBe(false);
    expect(esito.geometria?.[0]?.righe.length).toBeGreaterThan(0);
    const parole = esito.geometria![0]!.righe.flatMap(r => r.tratti.map(t => t.testo.toLowerCase()));
    expect(parole.some(p => p.includes("imponibile") || p.includes("conferma"))).toBe(true);
  });

  it("con l'OCR vietato dal chiamante la visione resta senza geometria", async () => {
    const png = await pngConTesto(["Solo visione"]);
    const esito = await estraiTestoDocumento(png, "image/png", "scan2.png", {
      preferisciVisione: true,
      ocr: false,
      visione: { sedeId: 1, utenteId: 7, deps: { provider: () => providerConTesto("Solo visione"), modello: "m" } },
    });
    expect(esito.esito === "estratto" && esito.geometria).toBeFalsy();
  });
});
