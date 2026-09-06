// Foto HEIC (06/09/2026): si convertono in JPEG in memoria, una volta; un
// file chiamato HEIC con dentro un JPEG passa com'è; un HEIC corrotto è un
// errore con il motivo. La prova con una foto vera vuole `sips` (macOS).

import { describe, expect, it } from "vitest";
import { convertiSeHeic, eHeic } from "./heic";
import { heicDiProva } from "./heicDiProva";

const fotoVera = await heicDiProva(["CONFERMA D'ORDINE", "Totale imponibile EUR 1.234,00"]);

describe("eHeic", () => {
  it("riconosce mime ed estensione, in ogni maiuscola", () => {
    expect(eHeic("image/heic")).toBe(true);
    expect(eHeic("image/HEIF", "x.jpg")).toBe(true);
    expect(eHeic("application/octet-stream", "IMG_0042.HEIC")).toBe(true);
    expect(eHeic(null, "foto.heif")).toBe(true);
    expect(eHeic("image/jpeg", "foto.jpg")).toBe(false);
    expect(eHeic(null, null)).toBe(false);
  });
});

describe("convertiSeHeic — senza conversione", () => {
  it("un formato che non è HEIC passa com'è, stesso buffer", async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
    const esito = await convertiSeHeic(jpeg, "image/jpeg", "foto.jpg");
    expect(esito).toMatchObject({ esito: "ok", mimeType: "image/jpeg", convertita: false });
    if (esito.esito === "ok") expect(esito.bytes).toBe(jpeg);
  });

  it("un file chiamato HEIC con dentro un JPEG non si converte: si corregge il mime", async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 0]);
    const esito = await convertiSeHeic(jpeg, "image/heic", "IMG_0042.HEIC");
    expect(esito).toMatchObject({ esito: "ok", mimeType: "image/jpeg", convertita: false });
    if (esito.esito === "ok") expect(esito.bytes).toBe(jpeg);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    expect(await convertiSeHeic(png, "image/heic")).toMatchObject({ esito: "ok", mimeType: "image/png", convertita: false });
  });

  it("un HEIC corrotto è un errore con il motivo, mai un lancio", async () => {
    const esito = await convertiSeHeic(Buffer.from("questo non è un HEIC, per niente"), "image/heic", "rotta.heic");
    expect(esito.esito).toBe("errore");
    if (esito.esito === "errore") expect(esito.motivo).toContain("Foto HEIC non convertibile");
  });
});

describe.skipIf(!fotoVera)("convertiSeHeic — con una foto HEIC vera (sips)", { timeout: 60_000 }, () => {
  it("produce un JPEG, e la seconda richiesta della stessa foto viene dalla cache", async () => {
    const prima = await convertiSeHeic(fotoVera!, "image/heic", "pagina.heic");
    expect(prima).toMatchObject({ esito: "ok", mimeType: "image/jpeg", convertita: true });
    if (prima.esito !== "ok") return;
    expect([...prima.bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect(prima.bytes.length).toBeGreaterThan(1000);
    const seconda = await convertiSeHeic(fotoVera!, "image/heic", "pagina.heic");
    expect(seconda.esito).toBe("ok");
    if (seconda.esito === "ok") expect(seconda.bytes).toBe(prima.bytes);
  });
});
