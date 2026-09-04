import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TarsProvider } from "../tars/provider";
import { azzeraCacheVisionePerTest } from "./letturaVisiva";
import { estraiTestoDocumento } from "./parserRegistry";

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

  it("un formato che il modello non accetta (HEIC) resta fermo con il motivo", async () => {
    const esito = await estraiTestoDocumento(PNG, "image/heic", "foto.heic", {
      ocr: false,
      visione: { sedeId: 1, utenteId: 7, deps: { provider: () => providerConTesto("x"), modello: "m" } },
    });
    expect(esito.esito).toBe("scansione_senza_testo");
    expect(esito.esito === "scansione_senza_testo" && esito.motivo).toMatch(/heic.*non è accettato/i);
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
