import { describe, expect, it } from "vitest";
import {
  codiceFiscaleValido,
  partitaIvaValida,
  normalizzaProvincia,
} from "./fiscale";

describe("codiceFiscaleValido", () => {
  it("accetta un CF con checksum corretto e rifiuta uno alterato", () => {
    // CF sintetico calcolato con l'algoritmo ufficiale: RSSMRA85T10A562S
    expect(codiceFiscaleValido("RSSMRA85T10A562S")).toBe(true);
    expect(codiceFiscaleValido("rssmra85t10a562s")).toBe(true);
    expect(codiceFiscaleValido("RSSMRA85T10A562T")).toBe(false);
    expect(codiceFiscaleValido("RSSMRA85T10A56")).toBe(false);
    expect(codiceFiscaleValido("")).toBe(false);
  });
  it("gestisce l'omocodia (cifre sostituite da lettere)", () => {
    // RSSMRA85T10A562S con l'ultima cifra del comune omocodificata (2 → N)
    // e checksum ricalcolato con lo stesso algoritmo: H, non la lettera
    // scritta a mano nella bozza del piano (vedi report del task per il calcolo).
    expect(codiceFiscaleValido("RSSMRA85T10A56NH")).toBe(true);
  });
});

describe("partitaIvaValida", () => {
  it("usa il controllo di Luhn a 11 cifre", () => {
    expect(partitaIvaValida("01500270119")).toBe(true);
    expect(partitaIvaValida("01500270118")).toBe(false);
    expect(partitaIvaValida("IT01500270119")).toBe(true);
    expect(partitaIvaValida("123")).toBe(false);
  });
});

describe("normalizzaProvincia", () => {
  it("estrae la sigla da forme diverse", () => {
    expect(normalizzaProvincia("La Spezia (SP)")).toBe("SP");
    expect(normalizzaProvincia("(sp)")).toBe("SP");
    expect(normalizzaProvincia("SP")).toBe("SP");
    expect(normalizzaProvincia("Sarzana")).toBe(null);
    expect(normalizzaProvincia(null)).toBe(null);
  });
});
