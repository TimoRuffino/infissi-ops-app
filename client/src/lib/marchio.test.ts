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
const LOCKUP = readFileSync(
  join("client", "src", "components", "brand", "WyndorLockup.tsx"),
  "utf8"
);
const SIDEBAR = readFileSync(
  join("client", "src", "components", "layout", "NavigationSidebar.tsx"),
  "utf8"
);
const LEGACY = readFileSync(
  join("client", "src", "components", "layout", "LegacyDashboardLayout.tsx"),
  "utf8"
);
const LOGIN = readFileSync(join("client", "src", "pages", "LoginPage.tsx"), "utf8");

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

describe("il marchio nella chrome", () => {
  it("non lascia in vita il filtro che appiattiva il logo", () => {
    expect(CSS).not.toContain("sidebar-logo");
    expect(CSS).not.toMatch(/filter:\s*brightness\(0\)/);
  });

  it("monta il marchio come componente, non come immagine fissa", () => {
    for (const [nome, sorgente] of [
      ["NavigationSidebar", SIDEBAR],
      ["LegacyDashboardLayout", LEGACY],
      ["LoginPage", LOGIN],
    ] as const) {
      expect(sorgente, nome).not.toContain('src="/logo.svg"');
    }
    expect(SIDEBAR).toContain("<WyndorLockup");
    expect(LEGACY).toContain("<WyndorLockup");
    expect(LOGIN).toContain("<WyndorMark");
  });

  it("mostra il segno anche a barra compressa, non un'iniziale", () => {
    expect(SIDEBAR).toContain("<WyndorMark");
  });

  it("scrive la parola come testo, non come tracciato", () => {
    // Un lockup con la parola in curve non è selezionabile, non scala con le
    // preferenze dell'utente e non arriva agli screen reader.
    // Il confronto tollera a capo e indentazione: in JSX la parola sta su una
    // riga sua fra i due tag.
    expect(LOCKUP).toMatch(/>\s*Wyndor\s*</);
  });
});
