// Contratto del marchio Wyndor.
//
// Non esiste ambiente DOM nei test di questo progetto (vitest gira in
// `node`), quindi il marchio si verifica come si verificano i token in
// tokenDiscipline.test.ts: leggendo sorgente e CSS. È meno di un test di
// rendering, ma coglie esattamente i modi in cui un marchio si rompe qui —
// un hex al posto del token, un filtro che lo appiattisce, un tracciato
// ridisegnato a occhio.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CSS = readFileSync(join("client", "src", "index.css"), "utf8");
const MARK = readFileSync(
  join("client", "src", "components", "brand", "WyndorMark.tsx"),
  "utf8"
);

/** Anta in apertura, spec 07/09/2026 Appendice A. Normativo. */
const ANTA_IN_APERTURA =
  "M53.321 9.862 L85.321 21.062 A4 4 0 0 1 88 24.838 " +
  "L88 75.162 A4 4 0 0 1 85.321 78.938 L53.321 90.138 " +
  "A4 4 0 0 1 48 86.362 L48 13.638 A4 4 0 0 1 53.321 9.862 Z";

/** Corpo di un blocco CSS, dal selettore alla prima graffa di chiusura. */
function blocco(selettore: string): string {
  const inizio = CSS.indexOf(`\n${selettore} {`);
  if (inizio < 0) return "";
  return CSS.slice(inizio, CSS.indexOf("\n}", inizio));
}

describe("marchio Wyndor", () => {
  it("dichiara l'accento del marchio nel tema chiaro e in quello scuro", () => {
    expect(blocco(":root")).toMatch(/--brand-accent:\s*#e8a33d/i);
    expect(blocco(".dark")).toMatch(/--brand-accent:\s*#f0b657/i);
  });

  it("espone l'accento come utility Tailwind", () => {
    expect(CSS).toMatch(/--color-brand-accent:\s*var\(--brand-accent\)/);
  });

  it("colora il segno col tema, mai con un hex", () => {
    expect(MARK).toContain('fill="currentColor"');
    expect(MARK).toContain('fill="var(--brand-accent)"');
    expect(MARK).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("riproduce il tracciato canonico dell'anta in apertura", () => {
    expect(MARK.replace(/\s+/g, " ")).toContain(ANTA_IN_APERTURA);
  });

  it("usa il viewBox stretto sull'ingombro", () => {
    expect(MARK).toContain('viewBox="9 5 82 90"');
  });
});
