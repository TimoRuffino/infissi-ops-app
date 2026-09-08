// Il contatore dei dodici giorni per l'invio allo SdI. Funzione pura,
// stessa in server e client, in giorni di calendario Europe/Rome.
import { describe, expect, it } from "vitest";
import {
  GIORNI_INVIO_SDI,
  giorniPerInvioSdi,
  toniScadenzaSdi,
} from "./scadenzaSdi";

describe("giorniPerInvioSdi", () => {
  it("il giorno dopo l'emissione ne restano undici", () => {
    expect(
      giorniPerInvioSdi("2026-09-04", new Date("2026-09-05T12:00:00Z"))
    ).toBe(11);
  });

  it("il giorno stesso ne restano dodici", () => {
    expect(
      giorniPerInvioSdi("2026-09-04", new Date("2026-09-04T08:00:00Z"))
    ).toBe(GIORNI_INVIO_SDI);
  });

  it("l'ultimo giorno utile vale zero, non uno", () => {
    expect(
      giorniPerInvioSdi("2026-09-04", new Date("2026-09-16T12:00:00Z"))
    ).toBe(0);
    // E le 23:00 UTC dello stesso giorno sono già il 17 a Roma: -1.
    expect(
      giorniPerInvioSdi("2026-09-04", new Date("2026-09-16T23:00:00Z"))
    ).toBe(-1);
  });

  it("dopo la scadenza il conto è negativo", () => {
    expect(
      giorniPerInvioSdi("2026-09-04", new Date("2026-09-18T10:00:00Z"))
    ).toBe(-2);
  });

  // Lo stesso motivo per cui `iso()` in emissione usa il fuso italiano:
  // a mezzanotte e mezza di Sarzana l'UTC è ancora il giorno prima, e il
  // contatore sbaglierebbe di uno.
  it("conta i giorni di calendario italiani, non quelli UTC", () => {
    // 22:30 UTC del 5 = 00:30 del 6 a Roma: il giorno è già cambiato.
    expect(
      giorniPerInvioSdi("2026-09-04", new Date("2026-09-05T22:30:00Z"))
    ).toBe(10);
  });

  it("una data che non è una data non inventa un conto", () => {
    expect(giorniPerInvioSdi("", new Date("2026-09-05T12:00:00Z"))).toBeNull();
    expect(
      giorniPerInvioSdi("scritta a mano", new Date("2026-09-05T12:00:00Z"))
    ).toBeNull();
  });
});

describe("toniScadenzaSdi", () => {
  it("neutro finché c'è tempo, ambra negli ultimi tre giorni, rosso a zero e oltre", () => {
    expect(toniScadenzaSdi(11).tono).toBe("neutro");
    expect(toniScadenzaSdi(4).tono).toBe("neutro");
    expect(toniScadenzaSdi(3).tono).toBe("attenzione");
    expect(toniScadenzaSdi(1).tono).toBe("attenzione");
    expect(toniScadenzaSdi(0).tono).toBe("errore");
    expect(toniScadenzaSdi(-1).tono).toBe("errore");
  });

  it("il testo dice i giorni al plurale, al singolare e il ritardo", () => {
    expect(toniScadenzaSdi(11).testo).toBe("11 giorni per l'invio allo SdI");
    expect(toniScadenzaSdi(1).testo).toBe("1 giorno per l'invio allo SdI");
    expect(toniScadenzaSdi(0).testo).toBe("Ultimo giorno per l'invio allo SdI");
    expect(toniScadenzaSdi(-1).testo).toBe("Scaduta da 1 giorno");
    expect(toniScadenzaSdi(-3).testo).toBe("Scaduta da 3 giorni");
  });
});
