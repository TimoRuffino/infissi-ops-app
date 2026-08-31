// Guardia strutturale del design system (UI v2 «Frame & Flow»).
//
// Le pagine e i componenti applicativi NON usano la palette numerica di
// Tailwind (bg-red-100, text-amber-600…): ogni colore passa dai token
// semantici di index.css, che seguono i due temi e l'interruttore UI v2.
// Lo sweep del 31/08/2026 ha portato il conteggio a zero; questo test
// impedisce che risalga di nascosto. Le primitive in components/ui/ sono
// escluse: lì il vincolo è dei token shadcn.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const RADICI = ["client/src/pages", "client/src/components"];
const ESCLUSE = [join("client", "src", "components", "ui")];

// Palette numerica Tailwind (colore-numero). I token semantici del
// progetto (danger-soft, st-misure, surface-2…) non hanno questa forma.
const PALETTE =
  /\b(?:bg|text|border|ring|from|via|to|fill|stroke|outline|decoration|divide|accent|caret|shadow)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}\b/g;

function fileTsx(dir: string): string[] {
  const out: string[] = [];
  for (const nome of readdirSync(dir)) {
    const percorso = join(dir, nome);
    if (ESCLUSE.some(e => percorso.includes(e))) continue;
    if (statSync(percorso).isDirectory()) out.push(...fileTsx(percorso));
    else if (nome.endsWith(".tsx")) out.push(percorso);
  }
  return out;
}

// Un testo bianco fisso su un pieno semantico si rompe in dark, dove quel
// pieno è una tinta chiara (bianco su success dark: 2,07:1). Vanno usati i
// foreground accoppiati `text-on-*`. La revisione del 31/08/2026 ha trovato
// così quattro superfici illeggibili.
const BIANCO_SU_SEMANTICO =
  /\bbg-(?:success|warning|danger|info|brand|structure)(?:\/\d+)?\b[^"'`]*\btext-white\b|\btext-white\b[^"'`]*\bbg-(?:success|warning|danger|info|brand|structure)(?:\/\d+)?\b/g;

// Colori arbitrari nelle classi (text-[#…], bg-[#…]). Le deroghe scritte
// sono in docs/design/ruffino-flow-anti-ai-slop.md §6.
const HEX_ARBITRARIO = /\b(?:bg|text|border|ring|fill|stroke)-\[#[0-9a-fA-F]{3,8}\]/g;
const DEROGHE_HEX = [
  // Verde di brand WhatsApp: colore di terze parti, non del design system.
  "client/src/components/WhatsAppCard.tsx",
  "client/src/components/WhatsAppButton.tsx",
  // Palette degli avatar: tinte scure fisse, leggibili in entrambi i temi.
  "client/src/pages/ChatAziendale.tsx",
  // Residui Manus senza alcun consumatore (zero import): la loro rimozione
  // è una decisione a sé, non una modifica di skin.
  "client/src/components/ManusDialog.tsx",
  "client/src/components/AIChatBox.tsx",
];

function scansiona(regex: RegExp, salta: string[] = []): string[] {
  const violazioni: string[] = [];
  for (const radice of RADICI) {
    for (const percorso of fileTsx(radice)) {
      if (salta.some(s => percorso.includes(s))) continue;
      const contenuto = readFileSync(percorso, "utf8");
      contenuto.split("\n").forEach((testo, i) => {
        const match = testo.match(regex);
        if (match) violazioni.push(`${percorso}:${i + 1} → ${match.join(", ")}`);
      });
    }
  }
  return violazioni;
}

describe("disciplina dei token (UI v2)", () => {
  it("pagine e componenti non usano la palette numerica di Tailwind", () => {
    const violazioni = scansiona(PALETTE);
    expect(
      violazioni,
      `Classi di palette hardcoded trovate (usa i token semantici):\n${violazioni.join("\n")}`
    ).toEqual([]);
  });

  it("nessun testo bianco fisso sopra un colore semantico pieno", () => {
    const violazioni = scansiona(BIANCO_SU_SEMANTICO);
    expect(
      violazioni,
      `text-white su pieno semantico (usa text-on-*, illeggibile in dark):\n${violazioni.join("\n")}`
    ).toEqual([]);
  });

  it("nessun colore arbitrario nelle classi, fuori dalle deroghe scritte", () => {
    const violazioni = scansiona(HEX_ARBITRARIO, DEROGHE_HEX);
    expect(
      violazioni,
      `Hex arbitrari nelle classi (usa i token o registra una deroga):\n${violazioni.join("\n")}`
    ).toEqual([]);
  });
});
