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
const FAVICON = readFileSync(join("client", "public", "favicon.svg"), "utf8");
const LOGO = readFileSync(join("client", "public", "logo.svg"), "utf8");
const GENERA_ICONE = readFileSync(join("scripts", "genera-icone.ts"), "utf8");
const MARCHIO_CONDIVISO = readFileSync(join("shared", "marchio.ts"), "utf8");

/** Anta in apertura, spec 07/09/2026 Appendice A. Normativo. */
const ANTA_IN_APERTURA =
  "M53.321 9.862 L85.321 21.062 A4 4 0 0 1 88 24.838 " +
  "L88 75.162 A4 4 0 0 1 85.321 78.938 L53.321 90.138 " +
  "A4 4 0 0 1 48 86.362 L48 13.638 A4 4 0 0 1 53.321 9.862 Z";

/**
 * Anta fissa, spec 07/09/2026 Appendice A. Normativo. Prima della revisione
 * del 07/09/2026 solo il tracciato dell'anta in apertura era ancorato:
 * questo rettangolo poteva divergere fra i portatori del marchio senza che
 * nessun test se ne accorgesse.
 */
const ANTA_FISSA_RETT = 'x="12" y="16" width="27" height="68" rx="4"';

/**
 * Confronto tollerante ad a-capo, indentazione e — caso di
 * `scripts/genera-icone.ts`, che compone TRACCIATO da tre literal invece di
 * un attributo unico — alle giunzioni `"..." + "..."` fra stringhe
 * concatenate: sciolte in un unico spazio, cosicché il tracciato risulti lo
 * stesso testo sia scritto su un attributo unico sia diviso a pezzi.
 */
function normalizza(testo: string): string {
  return testo.replace(/\s+/g, " ").replace(/"\s*\+\s*"/g, "");
}

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

  it("dichiara il colore dell'anta fissa nel tema chiaro e in quello scuro, mai in Modular Control", () => {
    expect(blocco(":root")).toMatch(/--brand-mark:\s*#d92f55/i);
    expect(blocco(".dark")).toMatch(/--brand-mark:\s*#ff6b79/i);
    // In Modular Control --primary è un altro borgogna (--primitive-brand):
    // se --brand-mark comparisse anche in questi blocchi, il marchio
    // tornerebbe a uscire in due colori diversi a seconda del sistema
    // visivo — esattamente il difetto che questo token corregge.
    expect(blocco('[data-ui-system="modular-control"]')).not.toMatch(
      /--brand-mark/
    );
    expect(blocco('[data-ui-system="modular-control"].dark')).not.toMatch(
      /--brand-mark/
    );
  });

  it("espone il colore dell'anta fissa come utility Tailwind", () => {
    expect(CSS).toMatch(/--color-brand-mark:\s*var\(--brand-mark\)/);
  });

  it("colora il segno col tema, mai con un hex", () => {
    expect(MARK).toContain('fill="currentColor"');
    expect(MARK).toContain('fill="var(--brand-accent)"');
    expect(MARK).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("riproduce il tracciato canonico dell'anta in apertura", () => {
    expect(normalizza(MARK)).toContain(ANTA_IN_APERTURA);
  });

  it("riproduce il rettangolo canonico dell'anta fissa", () => {
    expect(normalizza(MARK)).toContain(ANTA_FISSA_RETT);
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

/** Larghezza e altezza lette dall'header IHDR, senza dipendenze. */
function dimensioniPng(percorso: string): { larghezza: number; altezza: number } {
  const b = readFileSync(percorso);
  const firma = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(b.subarray(0, 8).equals(firma), `${percorso} non è un PNG`).toBe(true);
  return { larghezza: b.readUInt32BE(16), altezza: b.readUInt32BE(20) };
}

describe("file statici del marchio", () => {
  it("la favicon porta il tracciato canonico e i colori del tema chiaro", () => {
    expect(normalizza(FAVICON)).toContain(ANTA_IN_APERTURA);
    expect(normalizza(FAVICON)).toContain(ANTA_FISSA_RETT);
    expect(FAVICON).toContain("#d92f55");
    expect(FAVICON).toContain("#e8a33d");
  });

  it("il logo statico porta lo stesso segno, col margine invece del riquadro stretto", () => {
    // logo.svg tiene viewBox="0 0 100 100" col margine (spec §4.2): a
    // differenza della favicon non è ritagliato sull'ingombro, ma il segno
    // dentro — rettangolo e tracciato — deve restare lo stesso o le due
    // superfici divergono in silenzio.
    expect(normalizza(LOGO)).toContain(ANTA_IN_APERTURA);
    expect(normalizza(LOGO)).toContain(ANTA_FISSA_RETT);
    expect(LOGO).toContain("#d92f55");
    expect(LOGO).toContain("#e8a33d");
    expect(LOGO).toContain('viewBox="0 0 100 100"');
  });

  it("lo script che genera le icone raster non ridisegna il segno di suo", () => {
    // scripts/genera-icone.ts tiene una copia di TRACCIATO e del rettangolo
    // dell'anta fissa per comporre l'SVG sorgente passato a sharp (non è
    // raggiunto da vitest: server/**, shared/**, client/src/lib/**). Se il
    // segno cambia nel componente e questa copia non segue, `pnpm icone`
    // rigenera apple-touch-icon.png e icon-192.png con la forma vecchia,
    // senza che nessun test se ne accorga.
    expect(normalizza(GENERA_ICONE)).toContain(ANTA_IN_APERTURA);
    expect(normalizza(GENERA_ICONE)).toContain(ANTA_FISSA_RETT);
  });

  it("shared/marchio.ts dichiara lo stesso riquadro del viewBox stretto", () => {
    // RIQUADRO_SEGNO è x/y/larghezza/altezza dello stesso viewBox="9 5 82 90"
    // di WyndorMark.tsx e favicon.svg, riscritto a mano come oggetto perché
    // inquadraturaIcona() lavora su numeri, non su un attributo SVG. Se il
    // segno cambia riquadro nel componente e questo non segue, le icone
    // generate inquadrano la forma vecchia — e shared/marchio.test.ts non lo
    // coglie: verifica solo la matematica dei margini, non questi numeri di
    // partenza.
    expect(MARCHIO_CONDIVISO).toMatch(
      /x:\s*9,\s*y:\s*5,\s*larghezza:\s*82,\s*altezza:\s*90/
    );
  });

  it("esiste l'icona che iOS sa leggere", () => {
    expect(dimensioniPng(join("client", "public", "apple-touch-icon.png"))).toEqual(
      { larghezza: 180, altezza: 180 }
    );
  });

  it("esiste l'icona che il service worker cerca da sempre", () => {
    // notification-sw.js punta a /icon-192.png per icon e badge.
    expect(dimensioniPng(join("client", "public", "icon-192.png"))).toEqual({
      larghezza: 192,
      altezza: 192,
    });
  });

  it("index.html non offre più un SVG a iOS, che lo ignora", () => {
    const html = readFileSync(join("client", "index.html"), "utf8");
    expect(html).toContain('rel="apple-touch-icon" href="/apple-touch-icon.png"');
  });
});
