import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function routeSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("route migrate alla grammatica Modular Control", () => {
  it("compone il Centro azioni con header e superfici del sistema", () => {
    const source = routeSource("../pages/Notifiche.tsx");

    expect(source).toMatch(/import PageHeader/);
    expect(source).toMatch(/import DataSurface/);
    expect(source).toMatch(/<PageHeader/);
    expect(source).toMatch(/<DataSurface/);
  });

  it("compone la gestione sedi con header e superfici del sistema", () => {
    const source = routeSource("../pages/SediList.tsx");

    expect(source).toMatch(/import PageHeader/);
    expect(source).toMatch(/import DataSurface/);
    expect(source).toMatch(/<PageHeader/);
    expect(source).toMatch(/<DataSurface/);
    expect(source).toMatch(/min-h-11 min-w-11/);
    expect(source).toMatch(
      /<Button className="min-h-11" onClick=\{openCreate\}/
    );
  });

  it("compone l'archivio con header e superfici del sistema", () => {
    const source = routeSource("../pages/Archivio.tsx");

    expect(source).toMatch(/import PageHeader/);
    expect(source).toMatch(/import DataSurface/);
    expect(source).toMatch(/<PageHeader/);
    expect(source).toMatch(/<DataSurface/);
  });

  it("compone il calendario come workbench capability-aware", () => {
    const source = routeSource("../pages/Planning.tsx");

    expect(source).toMatch(/import PageHeader/);
    expect(source).toMatch(/import DataSurface/);
    expect(source).toMatch(/<PageHeader/);
    expect(source).toMatch(/variant="workbench"/);
    expect(source).toMatch(/<DataSurface/);
    // Le CTA passano dalla matrice pura, non da ruoli letti nella pagina.
    expect(source).toMatch(/planningPermissions\(/);
    expect(source).toMatch(/<PlanningToolbar/);
    expect(source).toMatch(/<PlanningAgenda/);
    // L'evento Google apre solo lo sheet in sola lettura.
    expect(source).toMatch(/mode="read-external"/);
  });

  it("compone il roster squadre con header e superfici del sistema", () => {
    const source = routeSource("../pages/SquadreList.tsx");

    expect(source).toMatch(/import PageHeader/);
    expect(source).toMatch(/import DataSurface/);
    expect(source).toMatch(/<PageHeader/);
    expect(source).toMatch(/<DataSurface/);
    // Il roster vive in una card senza logica autorizzativa.
    expect(source).toMatch(/<SquadraRosterCard/);
    // La gestione resta direzione-only, specchio UX di `adminProcedure`.
    expect(source).toMatch(/isDirezione\(user\)/);
    // Chi non è direzione legge il roster: niente permission-state sulla lista.
    expect(source).toMatch(/Gestione squadre riservata alla direzione\./);
  });

  it("compone il magazzino come coda di consegne leggibile", () => {
    const source = routeSource("../pages/Magazzino.tsx");

    expect(source).toMatch(/import PageHeader/);
    expect(source).toMatch(/import DataSurface/);
    expect(source).toMatch(/<PageHeader/);
    expect(source).toMatch(/variant="workbench"/);
    expect(source).toMatch(/<DataSurface/);
    expect(source).toMatch(/<ConsegneAgenda/);
    // Gli stati di consegna vengono dalla matrice pura, non da regole locali.
    expect(source).toMatch(/deliveryState\(/);
    // Una coda filtrata a vuoto non è "tutto a posto".
    expect(source).toMatch(/Nessuna consegna corrisponde ai filtri correnti/);
    // "Segna ricevuto" scrive esattamente id + arrivato, nient'altro.
    expect(source).toMatch(/\{ id, arrivato \}/);
    // L'eleggibilità resta del server: il messaggio tRPC va mostrato com'è.
    expect(source).toMatch(/create\.error/);
  });

  it("compone Clienti con header, superficie dati e capability effettive", () => {
    const source = routeSource("../pages/ClientiList.tsx");

    expect(source).toMatch(/import PageHeader/);
    expect(source).toMatch(/import DataSurface/);
    expect(source).toMatch(/useOperationalContext/);
    expect(source).toMatch(/customerPermissions/);
    expect(source).toMatch(/personName\(c/);
  });

  it("compone le commesse senza esporre cifre a chi non le riceve", () => {
    const source = routeSource("../pages/CommesseList.tsx");

    expect(source).toMatch(/import PageHeader/);
    expect(source).toMatch(/import DataSurface/);
    expect(source).toMatch(/<PageHeader/);
    expect(source).toMatch(/<DataSurface/);
    expect(source).toMatch(/commesseListPermissions\(/);
    // Il dialog "nuovo cliente" ha la capability cliente, non quella commessa.
    expect(source).toMatch(/customerPermissions\(/);
    // Le cifre si mostrano solo quando il router le ha mandate.
    expect(source).toMatch(/vedeCifre && c\.importoTotale != null/);
    // L'importo pattuito entra nel payload solo con `economia.read`, e mai
    // come 0 di sostituzione.
    expect(source).toMatch(
      /canCreateWithAmount && importoValido != null\s*\?\s*\{ importoTotale: importoValido \}/
    );
    // Archiviare resta il percorso reversibile di ogni utente della sede:
    // nessuna capability inventata.
    expect(source).not.toMatch(/commessa\.archive/);
    expect(source).toMatch(/personName\(/);
  });

  it("compone la scheda cliente come record capability-aware", () => {
    const source = routeSource("../pages/ClienteDetail.tsx");

    expect(source).toMatch(/import PageHeader/);
    expect(source).toMatch(/import DataSurface/);
    expect(source).toMatch(/variant="record"/);
    expect(source).toMatch(/useOperationalContext/);
    expect(source).toMatch(/customerPermissions/);
    // Il nome del cliente passa dalla convenzione condivisa, non da una
    // concatenazione locale.
    expect(source).toMatch(/personName\(c\)/);
    // Un `byId` nullo resta il Not Found esistente, senza dettagli né id.
    expect(source).toMatch(/Cliente non trovato/);
    // L'assegnatario si invia solo con la capability dedicata.
    expect(source).toMatch(/canAssignCustomer/);
  });

  it("compone la conoscenza aziendale con header e superfici del sistema", () => {
    const source = routeSource("../pages/Conoscenza.tsx");

    expect(source).toMatch(/import PageHeader/);
    expect(source).toMatch(/import DataSurface/);
    expect(source).toMatch(/<PageHeader/);
    expect(source).toMatch(/<DataSurface/);
  });
});
