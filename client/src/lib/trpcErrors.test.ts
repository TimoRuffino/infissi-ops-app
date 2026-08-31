import { describe, expect, it } from "vitest";

import { permessoNegato } from "./trpcErrors";

describe("permessoNegato", () => {
  it("riconosce i due codici con cui il server rifiuta l'accesso", () => {
    expect(permessoNegato({ data: { code: "FORBIDDEN" } })).toBe(true);
    expect(permessoNegato({ data: { code: "UNAUTHORIZED" } })).toBe(true);
  });

  it("non tratta un guasto come un rifiuto di permesso", () => {
    // Senza questa distinzione un errore di rete farebbe sparire il pannello
    // in silenzio, invece di offrire un ritentativo.
    expect(permessoNegato({ data: { code: "INTERNAL_SERVER_ERROR" } })).toBe(
      false
    );
    expect(permessoNegato({ data: { code: "TIMEOUT" } })).toBe(false);
    expect(permessoNegato({ data: { code: "NOT_FOUND" } })).toBe(false);
  });

  it("resta falso quando non c'è errore o il codice manca", () => {
    // Una richiesta fallita sulla rete non porta payload: `data` è null.
    expect(permessoNegato(null)).toBe(false);
    expect(permessoNegato(undefined)).toBe(false);
    expect(permessoNegato({})).toBe(false);
    expect(permessoNegato({ data: null })).toBe(false);
    expect(permessoNegato({ data: {} })).toBe(false);
  });

  it("non confonde un codice simile con un rifiuto", () => {
    expect(permessoNegato({ data: { code: "forbidden" } })).toBe(false);
    expect(permessoNegato({ data: { code: "FORBIDDEN_EXTRA" } })).toBe(false);
  });
});
