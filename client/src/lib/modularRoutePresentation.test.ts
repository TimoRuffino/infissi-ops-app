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
    // La vista vive nell'URL: nessuno stato locale che si perde al refresh.
    expect(source).toMatch(/parseNotificationView\(/);
    expect(source).toMatch(/notificationViewHref\(/);
    expect(source).toMatch(/useSearch\(\)/);
    expect(source).not.toMatch(/useState<View>/);
    // Le preferenze sono una disclosure accanto alla coda, non un overlay.
    expect(source).toMatch(/aria-expanded=\{settingsView\}/);
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

  it("compone il magazzino come schede di consegne per commessa", () => {
    const source = routeSource("../pages/Magazzino.tsx");
    const card = routeSource(
      "../components/magazzino/CommessaConsegneCard.tsx"
    );

    expect(source).toMatch(/import PageHeader/);
    expect(source).toMatch(/import DataSurface/);
    expect(source).toMatch(/<PageHeader/);
    expect(source).toMatch(/variant="workbench"/);
    expect(source).toMatch(/<DataSurface/);
    // Il raggruppamento per commessa è la struttura della pagina, non un
    // dettaglio della scheda: una colonna sotto lg, due sopra.
    expect(source).toMatch(/<CommessaConsegneCard/);
    expect(source).toMatch(/grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2/);
    // Gli stati di consegna vengono dalla matrice pura, non da regole locali,
    // e restano leggibili come testo dentro la scheda.
    expect(source).toMatch(/deliveryState\(/);
    expect(card).toMatch(/deliveryState\(/);
    expect(card).toMatch(/deliveryStateCopy\(/);
    // A vista libera resta visibile anche la commessa eleggibile senza
    // consegne: è il buco da notare e l'ingresso per registrare la prima.
    // Con ricerca, fornitore o stato attivi resta fuori.
    expect(source).toMatch(/if \(!filtriAttivi\)/);
    expect(card).toMatch(/Nessuna consegna registrata/);
    expect(card).toMatch(/onAddConsegna\(commessa\.id\)/);
    // Una vista filtrata a vuoto non è "tutto a posto".
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
    // Il pulsante finale crea cliente e prima commessa in una sola mutation
    // sede-scoped; senza `commessa.create` torna a creare solo il cliente.
    expect(source).toMatch(/clienti\.createConCommessa\.useMutation/);
    expect(source).toMatch(/Crea cliente e commessa/);
    expect(source).toMatch(/canCreateCommessa/);
    expect(source).toMatch(/Crea solo il cliente/);
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

  it("mostra dentro la commessa i ticket che le sono collegati", () => {
    const source = routeSource("../pages/CommessaDetail.tsx");

    // La scheda commessa interroga i ticket della sola commessa aperta: il
    // filtro resta del router, che applica anche lo scope di sede.
    expect(source).toMatch(/trpc\.ticket\.list\.useQuery\(\{ commessaId \}\)/);
    expect(source).toMatch(/value="ticket"/);
    expect(source).toMatch(/Nessun ticket collegato a questa commessa/);
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

  it("compone l'inbox Email come coda densa a due zone", () => {
    const source = routeSource("../pages/messaggi/EmailPage.tsx");
    const list = routeSource("../components/messaggi/EmailMessageList.tsx");
    const reader = routeSource("../components/messaggi/EmailMessageReader.tsx");

    expect(source).toMatch(/import PageHeader/);
    expect(source).toMatch(/<PageHeader/);
    // Una fascia sola e alta quanto i suoi pulsanti: niente eyebrow, niente
    // descrizione, niente riga di metadati. Il conteggio sta accanto al titolo.
    expect(source).toMatch(/variant="compact"/);
    expect(source).not.toMatch(/eyebrow=/);
    expect(source).not.toMatch(/Posta operativa/);
    expect(source).not.toMatch(/Coda unica di richieste/);
    expect(source).not.toMatch(/metadata=/);
    expect(source).toMatch(/\{queueSummary\}/);
    // Le code restano una riga di chip: nessun pannello attorno, nessun rail.
    expect(source).not.toMatch(/aria-label="Code e filtri email"/);
    expect(source).not.toMatch(/<DataSurface/);
    expect(source).toMatch(/aria-label="Code email"/);
    // Due zone da 1024px: elenco a larghezza fissa, lettura tutto il resto.
    expect(source).toMatch(
      /lg:grid-cols-\[20rem_minmax\(0,1fr\)\] xl:grid-cols-\[22rem_minmax\(0,1fr\)\]/
    );
    expect(source).toMatch(/aria-label="Workspace Email"/);
    // Sopra i 1200px l'altezza viene solo dalla shell: il riquadro
    // lista+lettura chiude in fondo all'area di lavoro, senza spazio morto.
    expect(source).toMatch(/max-\[1199px\]:h-\[calc\(100dvh-8rem\)\]/);
    expect(source).not.toMatch(/min-\[1200px\]:h-auto/);
    // Niente griglia di metriche decorative: restano i conteggi delle code.
    expect(source).not.toMatch(/aria-label="Metriche email"/);
    // Un conteggio assente si scrive, non si finge zero.
    expect(source).toMatch(/countLabel\(/);
    // Un solo controllo per i filtri, che dichiara quanti sono attivi.
    expect(source).toMatch(/emailActiveFilterCount\(/);
    expect(source).toMatch(/emailFilterLabel\(activeFilters\)/);
    expect(source).toMatch(/filtersControl=\{filtersControl\}/);
    // Le caselle restano direzione-only, specchio UX del router.
    expect(source).toMatch(/isDirezione\(user\)/);
    // Sul telefono il messaggio aperto si prende anche la testata di pagina.
    expect(source).toMatch(/const headerVisible = showList \|\| !compact;/);
    // Riga da 70px: tre righe di testo, nessun avatar che rubi larghezza.
    expect(list).toMatch(/min-h-\[70px\]/);
    expect(list).not.toMatch(/function initials/);
    // L'oggetto e l'elemento piu leggibile della riga.
    expect(list).toMatch(/text-\[15px\] leading-5 text-text-1/);
    // Ricerca, filtri, conteggio, selezione e azioni di massa: una fascia sola.
    expect(list).toMatch(/function ListToolbar/);
    expect(list).not.toMatch(/function ListStatusBar/);
    // Nessuna funzione persa nella compressione.
    expect(list).toMatch(/Seleziona tutte le email della pagina/);
    expect(list).toMatch(/aria-label="Segna le email selezionate come spam"/);
    expect(list).toMatch(/aria-label="Pagina successiva"/);
    // Il corpo del messaggio si legge: 16px, interlinea larga, misura di riga.
    expect(reader).toMatch(/text-base leading-\[1\.7\]/);
    expect(reader).toMatch(/max-w-\[66ch\]/);
    // Anche un URL senza spazi resta dentro la colonna.
    expect(reader).toMatch(/\[overflow-wrap:anywhere\]/);
  });

  it("compone il workspace WhatsApp come archivio in sola lettura", () => {
    const source = routeSource("../pages/messaggi/WhatsAppPage.tsx");
    const thread = routeSource("../components/messaggi/WhatsAppThread.tsx");

    expect(source).toMatch(/import PageHeader/);
    expect(source).toMatch(/<PageHeader/);
    expect(source).toMatch(/variant=\{mobile \? "compact" : "workbench"\}/);
    expect(source).toMatch(/aria-label="Workspace WhatsApp"/);
    // Tre pane solo da 1280px, un pane solo sotto i 1024px.
    expect(source).toMatch(/TRI_PANE_QUERY = "\(min-width: 1280px\)"/);
    expect(source).toMatch(/SINGLE_PANE_QUERY = "\(max-width: 1023px\)"/);
    // L'elenco ha una larghezza dichiarata: il resto va alla conversazione.
    expect(source).toMatch(
      /lg:grid-cols-\[19rem_minmax\(0,1fr\)\] xl:grid-cols-\[20rem_minmax\(0,1fr\)\]/
    );
    // Sul telefono la conversazione aperta si prende anche la testata.
    expect(source).toMatch(/const headerVisible = showList \|\| !mobile;/);
    // Sotto la soglia il contesto è uno sheet, non una terza colonna schiacciata.
    expect(source).toMatch(/<Sheet /);
    // Le bolle hanno una misura di riga: mai a tutta larghezza sul desktop.
    expect(thread).toMatch(/sm:max-w-\[min\(78%,38rem\)\]/);
    // Il testo della conversazione si legge come quello di un'email.
    expect(thread).toMatch(/text-base leading-\[1\.6\]/);
    expect(thread).toMatch(/\[overflow-wrap:anywhere\]/);
    // Una cronologia lunga si legge per giornate.
    expect(thread).toMatch(/dayLabel\(/);
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
    // Un solo controllo apre la zona espansa, e dichiara cosa apre.
    expect(source.match(/aria-expanded=\{isExpanded\}/g)?.length).toBe(1);
    expect(source).toMatch(/aria-controls=\{dettaglioId\}/);
    expect(source).toMatch(/dettaglio e allegati/);
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
    // L'invio non disabilita il campo: il fuoco resta dov'è.
    expect(source).toMatch(/disabled=\{!canaleAttivo\}/);
    // Le tinte avatar restano coppie token, non hex né palette numerica.
    expect(source).toMatch(/bg-success text-on-success/);
  });

  it("compone il registro garanzie con scadenze dichiarate a parole", () => {
    const source = routeSource("../pages/GaranzieList.tsx");

    expect(source).toMatch(/import PageHeader/);
    expect(source).toMatch(/import DataSurface/);
    expect(source).toMatch(/<PageHeader/);
    expect(source).toMatch(/<DataSurface/);
    // Il tono della scadenza passa dall'helper puro: nessuna soglia locale.
    expect(source).toMatch(/warrantyExpiryTone\(/);
    expect(source).toMatch(/warrantyExpiryLabel\(/);
    // La finestra del server resta dichiarata per quella che è (90 giorni).
    expect(source).toMatch(/in scadenza entro 90 giorni/);
    // Registrare e modificare resta direzione, specchio UX di `adminProcedure`.
    expect(source).toMatch(/isDirezione\(user\)/);
    // Un filtro senza risultati non è "nessuna garanzia registrata".
    expect(source).toMatch(/Nessuna garanzia di questo tipo/);
    // Lo stato del record non viene dedotto dalla data.
    expect(source).toMatch(/statoRegistro/);
  });

  it("compone la gestione utenti senza esporre credenziali", () => {
    const source = routeSource("../pages/UtentiList.tsx");

    expect(source).toMatch(/import PageHeader/);
    expect(source).toMatch(/import DataSurface/);
    expect(source).toMatch(/<PageHeader/);
    expect(source).toMatch(/<DataSurface/);
    // Righe dense da lg, record card impilata sotto.
    expect(source).toMatch(
      /lg:grid-cols-\[minmax\(14rem,1fr\)_minmax\(0,1\.1fr\)_auto\]/
    );
    // La gestione resta direzione, specchio UX di `adminProcedure`.
    expect(source).toMatch(/isDirezione\(user\)/);
    // Accessi, capability e deleghe restano nel dialog dedicato.
    expect(source).toMatch(/<UserPermissionsDialog/);
    // Il nome passa dalla convenzione condivisa, non da concatenazioni locali.
    expect(source).toMatch(/personName\(/);
    // Solo l'indicatore autorizzato dal server: mai hash, token o password.
    expect(source).toMatch(/hasPassword/);
    expect(source).not.toMatch(/u\.password|user\.password/);
    // Un filtro senza risultati non è "nessun utente".
    expect(source).toMatch(/Nessun utente corrisponde ai filtri correnti/);
  });

  it("compone l'hub preventivatori come ingresso guidato", () => {
    const source = routeSource("../pages/Preventivatori.tsx");

    expect(source).toMatch(/import PageHeader/);
    expect(source).toMatch(/import DataSurface/);
    expect(source).toMatch(/<PageHeader/);
    expect(source).toMatch(/<DataSurface/);
    // Le route passano dal modulo puro: la pagina non tiene una sua mappa.
    expect(source).toMatch(/from "@\/lib\/preventivatori"/);
    expect(source).not.toMatch(/"\/preventivatori\/fivizzanese\/persiane"/);
    // Un prodotto senza calcolatore è informazione passiva, non un bottone.
    expect(source).toMatch(/Non disponibile in Ruffino Flow/);
    expect(source).not.toMatch(/In sviluppo/);
    // L'unica superficie focale è quella dei preventivatori pronti.
    expect(source.match(/tone="focal"/g)?.length).toBe(1);
    // Una ricerca senza risultati non è "nessun preventivatore".
    expect(source).toMatch(/Nessuna corrispondenza/);
  });

  it("compone il preventivatore Fivizzanese come flusso da campo", () => {
    const source = routeSource("../pages/PreventivatoreFivizzanese.tsx");

    expect(source).toMatch(/import DataSurface/);
    expect(source).toMatch(/import StickyActionBar/);
    expect(source).toMatch(/<MobileFieldHeader/);
    expect(source).toMatch(/<DataSurface/);
    expect(source).toMatch(/<StickyActionBar/);
    // I confini numerici passano dal modulo puro condiviso.
    expect(source).toMatch(/millimetriDaInput\(/);
    expect(source).toMatch(/areaMetriQuadri\(/);
    // Il payload di upload resta quello del router: nessun campo nuovo.
    expect(source).toMatch(/tipo: "preventivo"/);
    expect(source).toMatch(/keepNome: true/);
    // Gli importi nascono dal listino, non da endpoint economici del CRM.
    expect(source).toMatch(/trpc\.commesse\.list/);
    expect(source).not.toMatch(/trpc\.economia|trpc\.pagamenti|trpc\.fic/);
    // Un totale parziale si dichiara invece di sembrare definitivo.
    expect(source).toMatch(/Totale parziale/);
    // Una sola superficie focale per viewport: il riepilogo.
    expect(source.match(/tone="focal"/g)?.length).toBe(1);
    // Misure numeriche e leggibili a 16px sul telefono.
    expect(source).toMatch(/inputMode="numeric"/);
    expect(source).toMatch(/min-h-12 min-w-0 text-base md:min-h-11 md:text-sm/);
  });

  it("compone Punto del Serramento con lo stesso contratto di flusso", () => {
    const source = routeSource("../pages/PreventivatorePuntoDelSerramento.tsx");

    expect(source).toMatch(/import DataSurface/);
    expect(source).toMatch(/import StickyActionBar/);
    expect(source).toMatch(/<MobileFieldHeader/);
    expect(source).toMatch(/<DataSurface/);
    expect(source).toMatch(/<StickyActionBar/);
    // Stesso confine numerico dell'altro preventivatore.
    expect(source).toMatch(/millimetriDaInput\(/);
    // Il prezzo resta quello del lookup di listino, con grouping conservato.
    expect(source).toMatch(/lookupPrezzo\(/);
    expect(source).toMatch(/<SelectGroup/);
    expect(source).toMatch(/coloreSuffix\(/);
    // Le due condizioni che rendono il totale non definitivo restano esplicite.
    expect(source).toMatch(/Fuori dal range di listino/);
    expect(source).toMatch(/Colore a preventivo/);
    expect(source).toMatch(/Totale parziale/);
    // Upload identico e nessuna derivazione da endpoint economici.
    expect(source).toMatch(/tipo: "preventivo"/);
    expect(source).toMatch(/keepNome: true/);
    expect(source).not.toMatch(/trpc\.economia|trpc\.pagamenti|trpc\.fic/);
    expect(source.match(/tone="focal"/g)?.length).toBe(1);
    expect(source).toMatch(/inputMode="numeric"/);
    expect(source).toMatch(/min-h-12 min-w-0 text-base md:min-h-11 md:text-sm/);
  });

  it("compone la conoscenza aziendale con header e superfici del sistema", () => {
    const source = routeSource("../pages/Conoscenza.tsx");

    expect(source).toMatch(/import PageHeader/);
    expect(source).toMatch(/import DataSurface/);
    expect(source).toMatch(/<PageHeader/);
    expect(source).toMatch(/<DataSurface/);
  });

  it("compone l'hub Impostazioni sugli stati che il server conosce", () => {
    const source = routeSource("../pages/Integrazioni.tsx");

    expect(source).toMatch(/import DataSurface/);
    expect(source).toMatch(/import PageHeader/);
    expect(source).toMatch(/import StatePanel/);
    expect(source).toMatch(/<PageHeader/);
    expect(source).toMatch(/<DataSurface/);
    expect(source).toMatch(/<StatePanel/);
    // Il gate di pagina è dichiarato specchio del server, non una capability.
    expect(source).toMatch(/const canManage = isDirezione\(user\)/);
    expect(source).toMatch(/Specchio UX del `requireDirezione`/);
    // Un FORBIDDEN nasconde il pannello, un errore vero resta visibile.
    expect(source).toMatch(/permessoNegato\(/);
    expect(source).toMatch(/kind: "error"/);
    // Hub di amministrazione: nessuna superficie focale, nessun gradiente.
    expect(source).not.toMatch(/tone="focal"/);
  });

  it("compone il 404 come errore operativo dentro la shell", () => {
    const source = routeSource("../pages/NotFound.tsx");

    expect(source).toMatch(/import DataSurface/);
    expect(source).toMatch(/import PageHeader/);
    expect(source).toMatch(/<PageHeader/);
    expect(source).toMatch(/<DataSurface/);
    // Il landmark `main` è di ShellWorkspace: la pagina non ne apre un secondo.
    expect(source).not.toMatch(/<main/);
    // Stato esplicito con la via di uscita, non una pagina vuota.
    expect(source).toMatch(/kind: "unavailable"/);
    expect(source).toMatch(/Torna alla dashboard/);
    // La query di un deep link può portare id o filtri: fuori dall'errore.
    expect(source).toMatch(/location\.split\("\?"\)\[0\]/);
    // Errore operativo: niente marketing, niente superficie focale.
    expect(source).not.toMatch(/tone="focal"/);
  });
});
