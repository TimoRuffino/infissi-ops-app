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

describe("disciplina dei token (UI v2)", () => {
  it("pagine e componenti non usano la palette numerica di Tailwind", () => {
    const violazioni: string[] = [];
    for (const radice of RADICI) {
      for (const percorso of fileTsx(radice)) {
        const contenuto = readFileSync(percorso, "utf8");
        for (const riga of contenuto.split("\n").entries()) {
          const [i, testo] = riga;
          const match = testo.match(PALETTE);
          if (match) {
            violazioni.push(`${percorso}:${i + 1} → ${match.join(", ")}`);
          }
        }
      }
    }
    expect(
      violazioni,
      `Classi di palette hardcoded trovate (usa i token semantici):\n${violazioni.join("\n")}`
    ).toEqual([]);
  });
});
