// server/_core/limiteTentativi.test.ts
// Limitatore di tentativi condiviso (WS6 §3.2): stessa logica del vecchio
// limitatore di login in-memory di routers.ts, parametrizzata così anche la
// conferma password del pannello piattaforma e la pagina d'invito possono
// usarla con la propria finestra e la propria chiave.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { creaLimiteTentativi } from "./limiteTentativi";

describe("creaLimiteTentativi", () => {
  // Come server/tenants/router.test.ts: i timer finti nascono e muoiono
  // fuori dal singolo `it`, così un test che lancia prima di raggiungere
  // `vi.useRealTimers()` non lascia il clock finto acceso per gli altri.
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-09-09T10:00:00Z") });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("blocca al massimo dentro la finestra, riapre dopo, azzera su successo", () => {
    const l = creaLimiteTentativi({ finestraMs: 1000, massimo: 2, messaggio: "troppi" });
    expect(() => l.verifica("A@x.it")).not.toThrow();
    l.fallito("a@x.it");
    l.fallito("a@x.it");
    expect(() => l.verifica("a@x.it")).toThrow(/troppi/);
    vi.advanceTimersByTime(1001);
    expect(() => l.verifica("a@x.it")).not.toThrow();
    l.fallito("a@x.it");
    l.fallito("a@x.it");
    l.azzera("a@x.it");
    expect(() => l.verifica("a@x.it")).not.toThrow();
  });

  it("verifica lancia TOO_MANY_REQUESTS con il messaggio configurato", () => {
    const l = creaLimiteTentativi({ finestraMs: 1000, massimo: 1, messaggio: "fermo" });
    l.fallito("chi@x.it");
    try {
      l.verifica("chi@x.it");
      throw new Error("doveva lanciare");
    } catch (errore: any) {
      expect(errore.code).toBe("TOO_MANY_REQUESTS");
      expect(errore.message).toBe("fermo");
    }
  });

  it("__azzeraTutto svuota ogni chiave (solo in test)", () => {
    const l = creaLimiteTentativi({ finestraMs: 1000, massimo: 1, messaggio: "fermo" });
    l.fallito("uno@x.it");
    l.fallito("due@x.it");
    l.__azzeraTutto();
    expect(() => l.verifica("uno@x.it")).not.toThrow();
    expect(() => l.verifica("due@x.it")).not.toThrow();
  });
});
