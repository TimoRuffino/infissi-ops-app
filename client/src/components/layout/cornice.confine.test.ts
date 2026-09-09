import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guardia strutturale della cornice desktop (regime ≥ 1200 px): il documento
 * non deve poter scorrere MAI. Il 09/09/2026 il percorso guidato delle
 * integrazioni trascinava in su l'intera cornice di 88 px — margine più
 * barra di contesto — e la rotella non la riportava giù: `scrollIntoView`
 * scorre tutti gli antenati, finestra compresa, e la finestra aveva
 * qualcosa da scorrere perché le etichette `sr-only` e gli input nascosti di
 * Radix, posizionati in assoluto, avevano come blocco contenitore la
 * finestra e non l'area di lavoro. Tre regole, tre righe che non devono
 * tornare indietro.
 */
const radice = fileURLToPath(new URL("../../../../", import.meta.url));
/** Il sorgente senza i commenti: le regole valgono per il codice, non per chi le spiega. */
const leggi = (percorso: string) =>
  readFileSync(radice + percorso, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("la cornice desktop non scorre", () => {
  it("il main dell'area di lavoro è `relative`: contiene gli elementi posizionati in assoluto delle pagine", () => {
    const sorgente = leggi("client/src/components/layout/ShellWorkspace.tsx");
    const main = sorgente.match(/<main[\s\S]*?className="([^"]+)"/);
    expect(main, "il <main> di ShellWorkspace con la sua className").not.toBeNull();
    expect(main![1].split(/\s+/)).toContain("relative");
  });

  it("la navigazione è alta quanto la sua colonna (`h-full`), non un calcolo sul viewport che sfora di due pixel", () => {
    const sorgente = leggi("client/src/components/layout/ModularControlLayout.tsx");
    expect(sorgente).not.toContain("h-[calc(100dvh-32px)]");
    expect(sorgente).toMatch(/"sticky top-4 h-full min-h-0/);
  });

  it("la pagina Impostazioni e il percorso guidato scorrono con `portaInCima`, mai con `scrollIntoView`", () => {
    for (const percorso of [
      "client/src/pages/Integrazioni.tsx",
      "client/src/integrazioni/PercorsoAttivazione.tsx",
      "client/src/integrazioni/SchedaIntegrazione.tsx",
    ]) {
      expect(leggi(percorso), percorso).not.toContain("scrollIntoView");
    }
    expect(leggi("client/src/pages/Integrazioni.tsx")).toContain(
      'from "@/lib/scorrimento"'
    );
  });
});
