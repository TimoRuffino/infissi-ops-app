// T2 — il parser temporale è deterministico e dichiarato: stesse
// espressioni, stessi esiti; ogni default aziendale compare in
// `assunzioni`; ciò che non si riconosce è un errore tipizzato, mai
// un'ipotesi. Il DST NON si decide qui: la conversione locale→istante
// resta a reminders/time.ts (provato in promemoria.test.ts).

import { describe, expect, it } from "vitest";
import { parseRomeLocalDateTime } from "../reminders/time";
import {
  ErroreTempo,
  formattaIstanteLocale,
  risolviEspressioneTempo,
} from "./tempo";

// Sabato 29/08/2026, 10:30 Europe/Rome (CEST, UTC+2).
const ADESSO = new Date("2026-08-29T08:30:00.000Z");

function locale(espressione: string, adesso = ADESSO, ancora?: string) {
  const r = risolviEspressioneTempo(espressione, adesso, ancora);
  if (r.tipo !== "locale") throw new Error(`atteso locale, avuto ${r.tipo}`);
  return r;
}

describe("tempo — espressioni di calendario", () => {
  it("«domani alle 9» → il giorno dopo alle 09:00, senza assunzioni", () => {
    const r = locale("domani alle 9");
    expect(r.dataLocale).toBe("2026-08-30");
    expect(r.oraLocale).toBe("09:00");
    expect(r.assunzioni).toEqual([]);
  });

  it("«domani» senza orario → 09:00 dichiarate come assunzione", () => {
    const r = locale("domani");
    expect(r.oraLocale).toBe("09:00");
    expect(r.assunzioni.join(" ")).toContain("09:00");
  });

  it("«venerdì» da sabato → il venerdì successivo alle 09:00", () => {
    const r = locale("venerdì");
    expect(r.dataLocale).toBe("2026-09-04");
    expect(r.oraLocale).toBe("09:00");
  });

  it("il giorno della settimana è OGGI se l'orario è ancora futuro, +7 se passato", () => {
    // ADESSO è sabato 10:30: «sabato alle 12» = oggi; «sabato alle 8» = +7.
    expect(locale("sabato alle 12").dataLocale).toBe("2026-08-29");
    const passato = locale("sabato alle 8");
    expect(passato.dataLocale).toBe("2026-09-05");
    expect(passato.assunzioni.join(" ")).toContain("prossimo");
  });

  it("«lunedì mattina» → lunedì successivo, 09:00 da fascia dichiarata", () => {
    const r = locale("lunedì mattina");
    expect(r.dataLocale).toBe("2026-08-31");
    expect(r.oraLocale).toBe("09:00");
    expect(r.assunzioni.join(" ")).toContain("mattina");
  });

  it("«domani pomeriggio» → 15:00 dichiarate; «stasera» → oggi alle 18:00", () => {
    const pomeriggio = locale("domani pomeriggio");
    expect(pomeriggio.dataLocale).toBe("2026-08-30");
    expect(pomeriggio.oraLocale).toBe("15:00");
    const sera = locale("stasera");
    expect(sera.dataLocale).toBe("2026-08-29");
    expect(sera.oraLocale).toBe("18:00");
  });

  it("solo orario: oggi se futuro, domani (dichiarato) se già passato", () => {
    expect(locale("alle 15")).toMatchObject({ dataLocale: "2026-08-29" });
    const passato = locale("alle 8");
    expect(passato.dataLocale).toBe("2026-08-30");
    expect(passato.assunzioni.join(" ")).toContain("domani");
  });

  it("«il 15 settembre alle 10» → data esplicita; se già passata quest'anno slitta dichiarando", () => {
    const r = locale("il 15 settembre alle 10");
    expect(r).toMatchObject({ dataLocale: "2026-09-15", oraLocale: "10:00" });
    const slittata = locale("il 3 gennaio");
    expect(slittata.dataLocale).toBe("2027-01-03");
    expect(slittata.assunzioni.join(" ")).toContain("2027");
  });

  it("«il 15/09» e «il 15» (prossima occorrenza) funzionano", () => {
    expect(locale("il 15/09").dataLocale).toBe("2026-09-15");
    expect(locale("il 15").dataLocale).toBe("2026-09-15");
    expect(locale("il 30").dataLocale).toBe("2026-08-30");
  });

  it("«tra tre giorni» conserva l'orario locale corrente", () => {
    const r = locale("tra tre giorni");
    expect(r.dataLocale).toBe("2026-09-01");
    expect(r.oraLocale).toBe("10:30");
  });

  it("«tre giorni prima» richiede l'ancora e la usa", () => {
    const r = locale("tre giorni prima", ADESSO, "2026-09-12");
    expect(r).toMatchObject({ dataLocale: "2026-09-09", oraLocale: "09:00" });
    expect(() => risolviEspressioneTempo("tre giorni prima", ADESSO)).toThrow(
      ErroreTempo
    );
    try {
      risolviEspressioneTempo("tre giorni prima", ADESSO);
    } catch (errore) {
      expect((errore as ErroreTempo).codice).toBe("ANCORA_RICHIESTA");
    }
  });
});

describe("tempo — durate esatte (istante)", () => {
  it("«tra due ore» e «tra mezz'ora» sono durate esatte dal momento attuale", () => {
    const dueOre = risolviEspressioneTempo("tra due ore", ADESSO);
    expect(dueOre.tipo).toBe("istante");
    if (dueOre.tipo === "istante") {
      expect(new Date(dueOre.iso).getTime() - ADESSO.getTime()).toBe(
        2 * 3_600_000
      );
    }
    const mezza = risolviEspressioneTempo("tra mezz'ora", ADESSO);
    if (mezza.tipo === "istante") {
      expect(new Date(mezza.iso).getTime() - ADESSO.getTime()).toBe(1_800_000);
    }
    const una = risolviEspressioneTempo("tra un'ora", ADESSO);
    if (una.tipo === "istante") {
      expect(new Date(una.iso).getTime() - ADESSO.getTime()).toBe(3_600_000);
    }
  });

  it("una durata che attraversa il cambio d'ora resta esatta", () => {
    // Sabato 28/03/2026 ore 23:00 Rome (CET): la notte dopo scatta l'ora legale.
    const vigilia = new Date("2026-03-28T22:00:00.000Z");
    const r = risolviEspressioneTempo("tra sei ore", vigilia);
    expect(r.tipo).toBe("istante");
    if (r.tipo === "istante") {
      expect(new Date(r.iso).getTime() - vigilia.getTime()).toBe(6 * 3_600_000);
    }
  });
});

describe("tempo — errori tipizzati, mai ipotesi", () => {
  it("date inesistenti sul calendario vengono rifiutate", () => {
    for (const brutta of ["il 31 aprile", "il 30 febbraio"]) {
      try {
        risolviEspressioneTempo(brutta, ADESSO);
        expect.unreachable(`«${brutta}» doveva essere rifiutata`);
      } catch (errore) {
        expect((errore as ErroreTempo).codice).toBe("DATA_NON_VALIDA");
      }
    }
  });

  it("un orario impossibile viene rifiutato", () => {
    try {
      risolviEspressioneTempo("domani alle 25", ADESSO);
      expect.unreachable("doveva essere rifiutata");
    } catch (errore) {
      expect((errore as ErroreTempo).codice).toBe("DATA_NON_VALIDA");
    }
  });

  it("un'espressione sconosciuta produce NON_RICONOSCIUTA con esempi", () => {
    try {
      risolviEspressioneTempo("quando capita", ADESSO);
      expect.unreachable("doveva essere rifiutata");
    } catch (errore) {
      expect((errore as ErroreTempo).codice).toBe("NON_RICONOSCIUTA");
      expect((errore as ErroreTempo).message).toContain("domani alle 9");
    }
  });
});

describe("tempo — la conversione locale→istante resta a reminders/time", () => {
  it("«domani alle 9» attraverso il cambio d'ora produce le 9 LOCALI (07:00Z d'estate)", () => {
    // 28/03/2026 (CET, UTC+1) → domani 09:00 è già CEST (UTC+2).
    const vigilia = new Date("2026-03-28T10:00:00.000Z");
    const r = locale("domani alle 9", vigilia);
    expect(r.dataLocale).toBe("2026-03-29");
    const istante = parseRomeLocalDateTime(
      `${r.dataLocale}T${r.oraLocale}`,
      vigilia
    );
    expect(istante.toISOString()).toBe("2026-03-29T07:00:00.000Z");
  });

  it("formattaIstanteLocale mostra l'ora di Roma", () => {
    expect(formattaIstanteLocale(new Date("2026-03-29T07:00:00.000Z"))).toBe(
      "dom 29/03/2026 09:00"
    );
  });
});
