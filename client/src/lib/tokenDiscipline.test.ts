// Guardia strutturale del design system «Modular Control».
//
// Ogni colore applicativo passa dai token semantici di index.css. Le sole
// deroghe sono colori di identità di terze parti, registrati qui e nella
// documentazione del sistema visivo.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const RADICE_CLIENT = join("client", "src");
const CSS = readFileSync(join(RADICE_CLIENT, "index.css"), "utf8");

function fileSorgente(dir: string, estensioni: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const nome of readdirSync(dir)) {
    const percorso = join(dir, nome);
    if (statSync(percorso).isDirectory()) {
      out.push(...fileSorgente(percorso, estensioni));
      continue;
    }
    if (!estensioni.has(extname(nome))) continue;
    if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(nome)) continue;
    out.push(percorso);
  }
  return out;
}

const FILE_APPLICAZIONE = fileSorgente(RADICE_CLIENT, new Set([".ts", ".tsx"]));
const FILE_UI = fileSorgente(RADICE_CLIENT, new Set([".css", ".ts", ".tsx"]));

const PALETTE =
  /\b(?:bg|text|border|ring|from|via|to|fill|stroke|outline|decoration|divide|accent|caret|shadow)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}\b/g;

const BIANCO_SU_SEMANTICO =
  /\bbg-(?:success|warning|danger|info|brand|structure|focal)(?:\/\d+)?\b[^"'`]*\btext-white\b|\btext-white\b[^"'`]*\bbg-(?:success|warning|danger|info|brand|structure|focal)(?:\/\d+)?\b/g;

const HEX_ARBITRARIO =
  /\b(?:bg|text|border|ring|fill|stroke)-\[#[0-9a-fA-F]{3,8}\]/g;
const DEROGHE_HEX = [
  // Verde ufficiale WhatsApp: identità di terza parte.
  join("client", "src", "components", "WhatsAppCard.tsx"),
  join("client", "src", "components", "WhatsAppButton.tsx"),
];

function scansiona(
  regex: RegExp,
  file = FILE_APPLICAZIONE,
  salta: string[] = []
): string[] {
  const violazioni: string[] = [];
  for (const percorso of file) {
    if (salta.includes(percorso)) continue;
    const contenuto = readFileSync(percorso, "utf8");
    contenuto.split("\n").forEach((testo, i) => {
      const match = testo.match(regex);
      if (match) violazioni.push(`${percorso}:${i + 1} → ${match.join(", ")}`);
    });
  }
  return violazioni;
}

function dichiarazioni(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const blocco = CSS.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!blocco) return {};
  return Object.fromEntries(
    [...blocco[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(match => [
      match[1],
      match[2].trim(),
    ])
  );
}

function normalizzaValori(
  dichiarazioniCss: Record<string, string>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(dichiarazioniCss).map(([token, valore]) => [
      token,
      valore
        .replace(/\s+/g, " ")
        .replace(/\(\s+/g, "(")
        .replace(/\s+\)/g, ")")
        .trim()
        .toLowerCase(),
    ])
  );
}

const PALETTE_CHIARA = {
  "--primitive-chrome": "#D8D5DC",
  "--primitive-canvas": "#F7F5F6",
  "--primitive-surface": "#FFFFFF",
  "--primitive-sunken": "#F2EEF0",
  "--primitive-ink": "#20171B",
  "--primitive-muted": "#71656A",
  "--primitive-border": "#E6DDE0",
  "--primitive-control": "#8A7A82",
  "--primitive-brand": "#8B1E3F",
  "--primitive-on-brand": "#FFFFFF",
  "--primitive-brand-soft": "#F7E5EB",
  "--primitive-brand-soft-ink": "#6E1733",
  "--primitive-mora": "#5B468E",
  "--primitive-anchor": "#241821",
  "--primitive-success": "#237353",
  "--primitive-warning": "#A84B32",
  "--primitive-danger": "#B4233D",
  "--primitive-info": "#3B5FA6",
  "--primitive-focal-gradient":
    "linear-gradient(135deg, #3A1725 0%, #6C2448 56%, #884B79 100%)",
};

const PALETTE_SCURA = {
  "--primitive-chrome": "#0F0D12",
  "--primitive-canvas": "#151216",
  "--primitive-surface": "#201B20",
  "--primitive-sunken": "#171217",
  "--primitive-raised": "#2A2228",
  "--primitive-ink": "#FCF8F9",
  "--primitive-muted": "#BDAFB5",
  "--primitive-border": "#473B42",
  "--primitive-control": "#7B6B73",
  "--primitive-brand": "#F09AB2",
  "--primitive-on-brand": "#32101B",
  "--primitive-brand-soft": "#451A2A",
  "--primitive-brand-soft-ink": "#FFB8CB",
  "--primitive-mora": "#B6A6E8",
  "--primitive-focal-gradient":
    "linear-gradient(135deg, #2A1721 0%, #522039 56%, #6B4163 100%)",
};

describe("contratto cromatico Modular Control", () => {
  it("espone il marker di sistema e i tre livelli di token", () => {
    const chiaro = normalizzaValori(
      dichiarazioni('[data-ui-system="modular-control"]')
    );
    expect(chiaro).toMatchObject(normalizzaValori(PALETTE_CHIARA));
    expect(chiaro).toMatchObject(
      normalizzaValori({
        "--color-workspace": "var(--primitive-canvas)",
        "--color-focal": "var(--primitive-anchor)",
        "--shell-chrome": "var(--color-chrome)",
        "--context-surface": "var(--color-surface)",
        "--table-header-surface": "var(--color-surface-sunken)",
        "--inspector-surface": "var(--color-surface-raised)",
      })
    );
  });

  it("ridefinisce esplicitamente la palette approvata nel quadrante scuro", () => {
    const scuro = normalizzaValori(
      dichiarazioni('[data-ui-system="modular-control"].dark')
    );
    expect(scuro).toMatchObject(normalizzaValori(PALETTE_SCURA));
  });

  it("non conserva marker, firme o nomi del concept rifiutato", () => {
    const firmeRifiutate = [
      ["data", "ui", "v2"].join("-"),
      ["rf", "frame"].join("-"),
      ["rf", "rail"].join("-"),
      ["rf", "reveal"].join("-"),
      ["rf", "latch"].join("-"),
      "Frame" + " & Flow",
    ];
    const violazioni = FILE_UI.flatMap(percorso => {
      const contenuto = readFileSync(percorso, "utf8");
      return firmeRifiutate
        .filter(firma => contenuto.includes(firma))
        .map(firma => `${percorso} → ${firma}`);
    });
    expect(violazioni).toEqual([]);
  });
});

describe("disciplina dei token applicativi", () => {
  it("non usa la palette numerica di Tailwind", () => {
    const violazioni = scansiona(PALETTE);
    expect(
      violazioni,
      `Classi di palette hardcoded trovate (usa i token semantici):\n${violazioni.join("\n")}`
    ).toEqual([]);
  });

  it("non mette testo bianco fisso sopra un colore semantico pieno", () => {
    const violazioni = scansiona(BIANCO_SU_SEMANTICO);
    expect(
      violazioni,
      `text-white su pieno semantico (usa text-on-*):\n${violazioni.join("\n")}`
    ).toEqual([]);
  });

  it("non usa colori arbitrari fuori dalle deroghe di terze parti", () => {
    const violazioni = scansiona(
      HEX_ARBITRARIO,
      FILE_APPLICAZIONE,
      DEROGHE_HEX
    );
    expect(
      violazioni,
      `Hex arbitrari nelle classi (usa i token o registra una deroga):\n${violazioni.join("\n")}`
    ).toEqual([]);
  });
});
