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

  it("apre la cassa solo dietro pagamento.read e separa la registrazione", () => {
    const source = routeSource("../pages/Pagamenti.tsx");

    expect(source).toMatch(/import PageHeader/);
    expect(source).toMatch(/import DataSurface/);
    expect(source).toMatch(/<PageHeader/);
    expect(source).toMatch(/<DataSurface/);
    // Il capability set arriva dal provider: niente seconda `permessi.mie`.
    expect(source).toMatch(/useOperationalContext/);
    expect(source).toMatch(/economicRoutePermissions\(/);
    expect(source).not.toMatch(/trpc\.permessi\.mie/);
    // Senza lettura la route non monta nessuna query economica.
    expect(source).toMatch(/if \(!permissions\.canReadPayments\)/);
    expect(source).toMatch(/kind: "permission"/);
    // Registrare è una capability a sé, e l'incassato non è un input.
    expect(source).toMatch(/canRecordPayments/);
    expect(source).toMatch(/parseEuroPositivo\(/);
    expect(source).not.toMatch(/importoIncassato: /);
  });

  it("chiude la contabilità sulla capability effettiva, non sul ruolo", () => {
    const source = routeSource("../pages/Economia.tsx");

    expect(source).toMatch(/import PageHeader/);
    expect(source).toMatch(/import DataSurface/);
    expect(source).toMatch(/<PageHeader/);
    expect(source).toMatch(/<DataSurface/);
    expect(source).toMatch(/economicRoutePermissions\(/);
    // Il controllo per ruolo è sostituito, non affiancato.
    expect(source).not.toMatch(/isDirezione\(/);
    expect(source).not.toMatch(/hasRuolo\(/);
    // Nessuna query FiC parte prima del via libera del contesto.
    const gate = /enabled: operationalStatus === "ready" && canReadEconomy/g;
    expect(source.match(gate)?.length).toBe(3);
    expect(source).toMatch(/kind: "permission"/);
  });

  it("mantiene la marginalità direzione-only e dichiarata come stima", () => {
    const source = routeSource("../pages/Marginalita.tsx");

    expect(source).toMatch(/import PageHeader/);
    expect(source).toMatch(/import DataSurface/);
    expect(source).toMatch(/<PageHeader/);
    expect(source).toMatch(/<DataSurface/);
    // La guardia resta quella di route: nessuna capability la sostituisce.
    expect(source).not.toMatch(/economicRoutePermissions/);
    expect(source).not.toMatch(/useOperationalContext/);
    // Il disclaimer è visibile, non solo nei commenti del codice.
    expect(source).toMatch(/Stima CRM, non contabilità/);
    expect(source).toMatch(/warning=\{DISCLAIMER\}/);
    // Il colore della fascia non è mai l'unico segnale.
    expect(source).toMatch(/fasciaLabel\(/);
    expect(source).toMatch(/formatEuroSimbolo\(/);
  });

  it("compone l'inbox Email come workspace a tre zone", () => {
    const source = routeSource("../pages/messaggi/EmailPage.tsx");

    expect(source).toMatch(/import PageHeader/);
    expect(source).toMatch(/import DataSurface/);
    expect(source).toMatch(/<PageHeader/);
    expect(source).toMatch(/variant="workbench"/);
    expect(source).toMatch(/<DataSurface/);
    // Tre zone solo da 1280px, due da 1024px: sotto resta un pane alla volta.
    expect(source).toMatch(
      /xl:grid-cols-\[15rem_minmax\(19rem,0\.9fr\)_minmax\(0,1\.65fr\)\]/
    );
    expect(source).toMatch(/aria-label="Workspace Email"/);
    // Niente griglia di metriche decorative: restano i conteggi delle code.
    expect(source).not.toMatch(/aria-label="Metriche email"/);
    // Un conteggio assente si scrive, non si finge zero.
    expect(source).toMatch(/countLabel\(/);
    // Le caselle restano direzione-only, specchio UX del router.
    expect(source).toMatch(/isDirezione\(user\)/);
  });

  it("compone il workspace WhatsApp come archivio in sola lettura", () => {
    const source = routeSource("../pages/messaggi/WhatsAppPage.tsx");
    const thread = routeSource("../components/messaggi/WhatsAppThread.tsx");

    expect(source).toMatch(/import PageHeader/);
    expect(source).toMatch(/<PageHeader/);
    expect(source).toMatch(/variant="workbench"/);
    expect(source).toMatch(/aria-label="Workspace WhatsApp"/);
    // Tre pane solo da 1280px, un pane solo sotto i 1024px.
    expect(source).toMatch(/TRI_PANE_QUERY = "\(min-width: 1280px\)"/);
    expect(source).toMatch(/SINGLE_PANE_QUERY = "\(max-width: 1023px\)"/);
    // Sotto la soglia il contesto è uno sheet, non una terza colonna schiacciata.
    expect(source).toMatch(/<Sheet /);
    // Il canale resta di sola lettura: nessuna superficie di composizione.
    expect(source).toMatch(/Sola lettura/);
    expect(thread).toMatch(/Sola lettura/);
    expect(source).not.toMatch(/Textarea/);
    expect(thread).not.toMatch(/Textarea/);
    expect(thread).not.toMatch(/inviaMessaggio|whatsapp\.invia/);
  });

  it("compone la coda ticket come queue post-vendita", () => {
    const source = routeSource("../pages/TicketList.tsx");

    expect(source).toMatch(/import PageHeader/);
    expect(source).toMatch(/import DataSurface/);
    expect(source).toMatch(/<PageHeader/);
    expect(source).toMatch(/variant="workbench"/);
    expect(source).toMatch(/<DataSurface/);
    // Il filtro passa dall'helper puro, non da una closure nella pagina.
    expect(source).toMatch(/ticketMatchesQueueFilter\(/);
    // Gli stati e le transizioni restano quelli del router.
    expect(source).toMatch(/nextQueueAdvance\(/);
    expect(source).not.toMatch(/"risolto"/);
    // Il contratto di route chiede `ticket.create`: la CTA lo rispetta.
    expect(source).toMatch(/supportQueuePermissions\(/);
    expect(source).toMatch(/permissions\.canCreateTicket/);
    // Righe dense a partire da lg, record card impilata sotto.
    expect(source).toMatch(
      /lg:grid-cols-\[minmax\(14rem,1fr\)_minmax\(0,1\.4fr\)_auto\]/
    );
    // Una coda filtrata a vuoto non è "tutto a posto".
    expect(source).toMatch(/Nessun ticket corrisponde ai filtri correnti/);
    // Il nome del cliente passa dalla convenzione condivisa.
    expect(source).toMatch(/personName\(/);
  });

  it("separa reclami e rifacimenti in due code con contatori", () => {
    const source = routeSource("../pages/ReclamiRifacimenti.tsx");

    expect(source).toMatch(/import PageHeader/);
    expect(source).toMatch(/import DataSurface/);
    expect(source).toMatch(/<PageHeader/);
    expect(source).toMatch(/variant="workbench"/);
    expect(source).toMatch(/<DataSurface/);
    expect(source).toMatch(/aria-label="Code post-vendita"/);
    // Le transizioni restano quelle del router, un passo alla volta.
    expect(source).toMatch(/nextReclamoAdvance\(/);
    expect(source).toMatch(/nextRifacimentoAdvance\(/);
    // Niente griglia KPI né percentuali di avanzamento inventate.
    expect(source).not.toMatch(/text-2xl font-bold/);
    expect(source).not.toMatch(/<Progress|\d+%/);
    // Gli importi passano dagli helper euro condivisi.
    expect(source).toMatch(/formatEuroSimbolo\(/);
    expect(source).toMatch(/parseEuroNonNegativo\(/);
    // La conferma di eliminazione nomina il record e la conseguenza.
    expect(source).toMatch(/sparisce dallo storico della commessa/);
  });

  it("compone la chat aziendale come workspace di conversazione", () => {
    const source = routeSource("../pages/ChatAziendale.tsx");

    expect(source).toMatch(/import PageHeader/);
    expect(source).toMatch(/<PageHeader/);
    expect(source).toMatch(/variant="workbench"/);
    expect(source).toMatch(/aria-label="Workspace chat"/);
    // Un pane alla volta sotto i 1024px, con un ritorno all'elenco esplicito.
    expect(source).toMatch(/SINGLE_PANE_QUERY = "\(max-width: 1023px\)"/);
    expect(source).toMatch(/aria-label="Torna all'elenco conversazioni"/);
    // Chat e notifiche restano due code distinte, e la pagina lo dice.
    expect(source).toMatch(/Centro azioni/);
    expect(source).toMatch(/href="\/notifiche"/);
    // Il polling resta quello esistente: nessuna connessione dedicata.
    expect(source).toMatch(/INTERVALLO_AGGIORNAMENTO_MS = 5_000/);
    // Il composer resta perché `chat.invia` esiste davvero, e non fa doppio invio.
    expect(source).toMatch(/trpc\.chat\.invia\.useMutation/);
    expect(source).toMatch(/!bozza\.trim\(\) \|\| invia\.isPending/);
    // Le tinte avatar restano coppie token, non hex né palette numerica.
    expect(source).toMatch(/bg-success text-on-success/);
  });

  it("compone la conoscenza aziendale con header e superfici del sistema", () => {
    const source = routeSource("../pages/Conoscenza.tsx");

    expect(source).toMatch(/import PageHeader/);
    expect(source).toMatch(/import DataSurface/);
    expect(source).toMatch(/<PageHeader/);
    expect(source).toMatch(/<DataSurface/);
  });
});
