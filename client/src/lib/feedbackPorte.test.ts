// client/src/lib/feedbackPorte.test.ts
// Le porte del canale verso supporto (PRD §60.16). Sono tre, e ognuna serve
// una situazione diversa: il menu profilo (desktop, mouse), la palette ⌘K
// (chi usa la tastiera) e il piede della navigazione — che sul TELEFONO è
// l'unica raggiungibile dal menu in basso, perché lì la palette non c'è e il
// menu profilo sta in cima. La terza è nata da una segnalazione: «non vedo
// la possibilità di segnalare bug nel menu in basso».
//
// Prova strutturale, come `modularControlShell.test.ts`: non rende i
// componenti, verifica che i punti d'ingresso non spariscano in un
// rimaneggiamento della cornice.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const COMPONENTS = new URL("../components/", import.meta.url);

function sorgente(percorso: string): string {
  return readFileSync(new URL(percorso, COMPONENTS), "utf8");
}

describe("le porte del feedback", () => {
  it("il dialogo vive una volta sola, sopra entrambe le cornici", () => {
    const dashboard = sorgente("DashboardLayout.tsx");
    expect(dashboard).toContain("FeedbackProvider");
    expect(dashboard).toMatch(
      /<FeedbackProvider>[\s\S]*ModularControlLayout[\s\S]*LegacyDashboardLayout[\s\S]*<\/FeedbackProvider>/
    );
  });

  it("il menu profilo ha la voce", () => {
    const menu = sorgente("layout/UserMenu.tsx");
    expect(menu).toContain("useFeedback");
    expect(menu).toContain("Segnala un problema");
  });

  it("la palette ⌘K ha le due voci", () => {
    const palette = sorgente("CommandPalette.tsx");
    expect(palette).toContain("useFeedback");
    expect(palette).toContain("Segnala un problema");
    expect(palette).toContain("Manda un consiglio");
  });

  it("il piede della navigazione ha la voce: è la porta del telefono", () => {
    const sidebar = sorgente("layout/NavigationSidebar.tsx");
    expect(sidebar).toContain("useFeedback");
    expect(sidebar).toContain("Segnala un problema");
  });

  it("dal cassetto del telefono l'azione chiude il cassetto", () => {
    // Senza `onAzione` il dialogo si aprirebbe sopra un pannello che resta
    // aperto dietro: la catena va da ModularControlLayout a NavigationSidebar
    // passando per CompactNavigation, e ogni anello deve reggere.
    const modular = sorgente("layout/ModularControlLayout.tsx");
    const compact = sorgente("layout/CompactNavigation.tsx");
    const sidebar = sorgente("layout/NavigationSidebar.tsx");

    expect(modular).toMatch(/<CompactNavigation[\s\S]*?onAzione=\{[\s\S]*?\/>/);
    expect(compact).toMatch(/<NavigationSidebar[\s\S]*?onAzione=\{onAzione\}/);
    expect(sidebar).toContain("onFatto={onAzione}");
  });
});
