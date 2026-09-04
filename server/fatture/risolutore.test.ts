// server/fatture/risolutore.test.ts
import { describe, expect, it } from "vitest";
import casi from "./__fixtures__/fatture-reali.json";
import { impostaCent, riequilibraBeni, risolvi } from "./risolutore";

describe("risolutore — fatture reali", () => {
  for (const caso of casi.casi) {
    it(`${caso.nome} torna al centesimo`, () => {
      const esito = risolvi(caso.input as any);
      expect(esito.prestazioneCent).toBe(caso.atteso.prestazioneCent);
      expect(esito.markupCent).toBe(caso.atteso.markupCent);
      expect(esito.stornoCent).toBe(caso.atteso.stornoCent);
      expect(esito.casoBeniSignificativi).toBe(caso.atteso.caso);
      expect(esito.riepilogo).toEqual(caso.atteso.riepilogo);
      expect(esito.imponibileCent).toBe(caso.atteso.imponibileCent);
      expect(esito.ivaCent).toBe(caso.atteso.ivaCent);
      expect(esito.totaleCent).toBe(caso.atteso.totaleCent);
      expect(esito.deltaPattuitoCent).toBe(caso.atteso.deltaPattuitoCent);
      expect(esito.avvertenze).toEqual([]);
    });
  }
});

describe("risolutore — regole", () => {
  it("impostaCent arrotonda half-up", () => {
    expect(impostaCent(959718, 10)).toBe(95972); // 95.971,8 → 95.972
    expect(impostaCent(404887, 22)).toBe(89075); // 89.075,14
    expect(impostaCent(5, 10)).toBe(1); // 0,5 → 1
  });
  it("lordo del contratto 127 (15.494,72) torna esatto con la ricerca del centesimo", () => {
    const e = risolvi({ pattuitoCent: 1549472, pattuitoTipo: "lordo", beniSignificativiCent: 884746, beniAltriCent: 0, serviziCent: 264500 });
    expect(e.totaleCent).toBe(1549472);
    expect(e.deltaPattuitoCent).toBe(0);
    expect(e.markupCent).toBe(215175);
  });
  it("con i prezzi del contratto il markup è negativo e l'avvertenza lo dice", () => {
    const e = risolvi({ pattuitoCent: 1549472, pattuitoTipo: "lordo", beniSignificativiCent: 1298611, beniAltriCent: 0, serviziCent: 264500 });
    expect(e.markupCent).toBeLessThan(0);
    expect(e.avvertenze[0]).toMatch(/superano il pattuito/);
    expect(e.stornoCent).toBe(0);
  });
  it("senza beni tutto va al 10 %", () => {
    const e = risolvi({ pattuitoCent: 110000, pattuitoTipo: "lordo", beniSignificativiCent: 0, beniAltriCent: 0, serviziCent: 60000 });
    expect(e.casoBeniSignificativi).toBe("senza_beni");
    expect(e.riepilogo).toEqual([{ aliquota: 10, imponibileCent: 100000, impostaCent: 10000 }]);
    expect(e.markupCent).toBe(40000);
  });
  it("delta dichiarato quando nessun centesimo torna", () => {
    // G scelto apposta perché nessun P in ±3 centesimi dia il totale esatto.
    // Nota: il piano originale indicava pattuitoCent 1.000.001, ma con quel
    // valore il P di primo tentativo (148.981) azzecca già il totale G senza
    // bisogno di ricerca (verificato a mano e con la corsa dei test): la
    // ricerca del centesimo lo avrebbe trovato al passo 0, deltaPattuitoCent
    // sarebbe stato 0 e l'asserzione sotto sarebbe fallita. 1.000.003 con
    // gli stessi B/S dà invece P iniziale 148.983 → totale 1.000.004 (delta
    // 1), e nessuno dei P in ±3 (148.980..148.986) tocca 1.000.003 esatto.
    const e = risolvi({ pattuitoCent: 1000003, pattuitoTipo: "lordo", beniSignificativiCent: 700000, beniAltriCent: 0, serviziCent: 100000 });
    expect(Math.abs(e.deltaPattuitoCent)).toBeGreaterThan(0);
    expect(Math.abs(e.deltaPattuitoCent)).toBeLessThanOrEqual(3);
  });
  it("riequilibraBeni scala in proporzione e chiude il resto sull'ultima", () => {
    expect(riequilibraBeni([1000, 3000], 2000)).toEqual([500, 1500]);
    expect(riequilibraBeni([333, 333, 334], 500)).toEqual([167, 167, 166]);
    expect(riequilibraBeni([100], 0)).toEqual([0]);
    expect(riequilibraBeni([], 100)).toEqual([]);
  });
});
