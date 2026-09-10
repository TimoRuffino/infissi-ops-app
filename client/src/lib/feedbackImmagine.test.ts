// client/src/lib/feedbackImmagine.test.ts
// Le parti pure della preparazione dell'immagine: il conto dei byte decide
// se l'allegato parte, e deve dare lo stesso numero del server
// (`byteDaBase64` di server/piattaforma/feedback.ts).
import { describe, expect, it } from "vitest";

import {
  IMMAGINE_MAX_BYTE,
  base64Da,
  byteDaBase64,
  misuraRidotta,
  pesoLeggibile,
  tipoAmmesso,
} from "./feedbackImmagine";

describe("base64Da", () => {
  it("tiene solo i byte dopo il prefisso", () => {
    expect(base64Da("data:image/jpeg;base64,QUJD")).toBe("QUJD");
    expect(base64Da("QUJD")).toBe("");
  });
});

describe("byteDaBase64", () => {
  it("conta i byte veri, riempimento compreso", () => {
    expect(byteDaBase64("")).toBe(0);
    // "abc" → QUJD (nessun =), "abcd" → QUJDZA== (due =)
    expect(byteDaBase64("QUJD")).toBe(3);
    expect(byteDaBase64("QUJDZA==")).toBe(4);
    expect(byteDaBase64("QUJDZGU=")).toBe(5);
  });

  it("il limite del client è quello del server", () => {
    expect(IMMAGINE_MAX_BYTE).toBe(2 * 1024 * 1024);
  });
});

describe("misuraRidotta", () => {
  it("lascia stare ciò che sta già dentro il limite", () => {
    expect(misuraRidotta(1200, 800)).toEqual({ larghezza: 1200, altezza: 800 });
  });

  it("porta il lato lungo al limite tenendo le proporzioni", () => {
    expect(misuraRidotta(3200, 2000)).toEqual({ larghezza: 1600, altezza: 1000 });
    expect(misuraRidotta(1000, 4000)).toEqual({ larghezza: 400, altezza: 1600 });
  });

  it("non produce mai un lato a zero", () => {
    expect(misuraRidotta(4000, 1)).toEqual({ larghezza: 1600, altezza: 1 });
    expect(misuraRidotta(0, 0)).toEqual({ larghezza: 0, altezza: 0 });
  });
});

describe("tipoAmmesso", () => {
  it("solo immagini, e solo tre formati", () => {
    expect(tipoAmmesso("image/png")).toBe(true);
    expect(tipoAmmesso("image/jpeg")).toBe(true);
    expect(tipoAmmesso("image/webp")).toBe(true);
    expect(tipoAmmesso("image/heic")).toBe(false);
    expect(tipoAmmesso("application/pdf")).toBe(false);
  });
});

describe("pesoLeggibile", () => {
  it("byte, kB, MB", () => {
    expect(pesoLeggibile(512)).toBe("512 B");
    expect(pesoLeggibile(320_000)).toBe("313 kB");
    expect(pesoLeggibile(1_572_864)).toBe("1.5 MB");
  });
});
