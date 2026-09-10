import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Loader2 } from "lucide-react";
import { lazy, Suspense, useEffect } from "react";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";
import RequireDirezione from "./components/RequireDirezione";
import RequirePiattaforma from "./components/RequirePiattaforma";
import { legacyMessageRedirect } from "./lib/messaggi";
import { produzioneRedirect } from "./lib/navigation";
import { routeContractForLocation } from "./lib/routeContract";

const NotFound = lazy(() => import("./pages/NotFound"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const CommesseList = lazy(() => import("./pages/CommesseList"));
const CommessaDetail = lazy(() => import("./pages/CommessaDetail"));
const Planning = lazy(() => import("./pages/Planning"));
const TicketList = lazy(() => import("./pages/TicketList"));
const RilievoDetail = lazy(() => import("./pages/RilievoDetail"));
const VerbaleChiusura = lazy(() => import("./pages/VerbaleChiusura"));
const SquadreList = lazy(() => import("./pages/SquadreList"));
const ClientiList = lazy(() => import("./pages/ClientiList"));
const ClienteDetail = lazy(() => import("./pages/ClienteDetail"));
const Integrazioni = lazy(() => import("./pages/Integrazioni"));
const Tars = lazy(() => import("./pages/Tars"));
const KanbanBoard = lazy(() => import("./pages/KanbanBoard"));
const Magazzino = lazy(() => import("./pages/Magazzino"));
const Fornitori = lazy(() => import("./pages/Fornitori"));
const Pagamenti = lazy(() => import("./pages/Pagamenti"));
const Marginalita = lazy(() => import("./pages/Marginalita"));
const ReclamiRifacimenti = lazy(() => import("./pages/ReclamiRifacimenti"));
const UtentiList = lazy(() => import("./pages/UtentiList"));
const Preventivatori = lazy(() => import("./pages/Preventivatori"));
const PreventivatoreFivizzanese = lazy(
  () => import("./pages/PreventivatoreFivizzanese")
);
const PreventivatorePuntoDelSerramento = lazy(
  () => import("./pages/PreventivatorePuntoDelSerramento")
);
const Archivio = lazy(() => import("./pages/Archivio"));
const SediList = lazy(() => import("./pages/SediList"));
const ChatAziendale = lazy(() => import("./pages/ChatAziendale"));
const Conoscenza = lazy(() => import("./pages/Conoscenza"));
const Economia = lazy(() => import("./pages/Economia"));
const Fatturazione = lazy(() => import("./pages/Fatturazione"));
const FatturazioneCommessa = lazy(() => import("./pages/FatturazioneCommessa"));
const FatturaStampa = lazy(() => import("./pages/FatturaStampa"));
const LimitiStampa = lazy(() => import("./pages/LimitiStampa"));
const EmailPage = lazy(() => import("./pages/messaggi/EmailPage"));
const WhatsAppPage = lazy(() => import("./pages/messaggi/WhatsAppPage"));
const Notifiche = lazy(() => import("./pages/Notifiche"));
const AziendeList = lazy(() => import("./pages/piattaforma/AziendeList"));
const AziendaDetail = lazy(() => import("./pages/piattaforma/AziendaDetail"));
const InvitoPage = lazy(() => import("./pages/InvitoPage"));
const ProvaPage = lazy(() => import("./pages/ProvaPage"));

function RouteLoading() {
  return (
    <div className="grid min-h-[45dvh] place-items-center" role="status">
      <Loader2 className="h-6 w-6 animate-spin text-text-3" />
      <span className="sr-only">Caricamento</span>
    </div>
  );
}

function LegacyRedirect({
  redirect,
}: {
  redirect: (location: string) => string;
}) {
  const [location, setLocation] = useLocation();

  useEffect(() => {
    setLocation(redirect(`${location}${window.location.search}`), {
      replace: true,
    });
  }, [location, redirect, setLocation]);

  return <RouteLoading />;
}

function RouteContractSurface({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const route = routeContractForLocation(location);

  return (
    <div
      className="contents"
      data-route-id={route.path}
      data-route-kind={route.kind}
    >
      {children}
    </div>
  );
}

function Router() {
  return (
    <Switch>
      {/* Stampa della fattura: pagina senza shell, aperta in una scheda
          nuova; le query tRPC restano protette dal cookie di sessione. */}
      <Route path="/fatture/:id/stampa">
        {() => (
          <Suspense fallback={<RouteLoading />}>
            <FatturaStampa />
          </Suspense>
        )}
      </Route>
      {/* Stampa dei limiti di spesa della commessa: stessa forma della
          stampa fattura (07/09/2026). */}
      <Route path="/commesse/:id/limiti/stampa">
        {() => (
          <Suspense fallback={<RouteLoading />}>
            <LimitiStampa />
          </Suspense>
        )}
      </Route>
      {/* Invito del proprietario di una azienda nuova (WS6 §6.3): pagina
          pubblica, senza sessione e senza shell — chi la apre non ha ancora
          una password. Deve stare qui fuori, prima di DashboardLayout, o il
          layout la manderebbe al login. */}
      <Route path="/invito/:token">
        {() => (
          <Suspense fallback={<RouteLoading />}>
            <InvitoPage />
          </Suspense>
        )}
      </Route>
      {/* Iscrizione pubblica «Prova gratuita» (ciclo di vita, D7): stessa
          natura dell'invito qui sopra — pubblica, senza sessione, fuori
          dalla shell. Il server decide se le iscrizioni sono aperte. */}
      <Route path="/prova">
        {() => (
          <Suspense fallback={<RouteLoading />}>
            <ProvaPage />
          </Suspense>
        )}
      </Route>
      <Route>
        {() => (
    <DashboardLayout>
      <Suspense fallback={<RouteLoading />}>
        <RouteContractSurface>
          <Switch>
            <Route path="/" component={Dashboard} />
            <Route path="/clienti" component={ClientiList} />
            <Route path="/clienti/:id" component={ClienteDetail} />
            <Route path="/kanban" component={KanbanBoard} />
            <Route path="/magazzino" component={Magazzino} />
            {/* Le conferme d'ordine non hanno più una pagina a parte
            (07/09/2026, direzione: «la pagina fornitori e conferme d'ordine
            devono essere insieme»): vivono in Fornitori, dove si vedono
            insieme al fornitore che le manda e alla merce che portano. */}
            <Route path="/conferme-ordine">
              {() => <LegacyRedirect redirect={() => "/fornitori"} />}
            </Route>
            <Route path="/pagamenti" component={Pagamenti} />
            <Route path="/economia" component={Economia} />
            <Route path="/fatturazione" component={Fatturazione} />
            <Route path="/fatturazione/:id" component={FatturazioneCommessa} />
            <Route path="/marginalita">
              {() => (
                <RequireDirezione>
                  <Marginalita />
                </RequireDirezione>
              )}
            </Route>
            <Route path="/commesse" component={CommesseList} />
            <Route path="/commesse/:id" component={CommessaDetail} />
            <Route
              path="/commesse/:commessaId/aperture/:aperturaId/rilievo"
              component={RilievoDetail}
            />
            <Route path="/verbale/:interventoId" component={VerbaleChiusura} />
            <Route path="/planning" component={Planning} />
            <Route path="/ticket">{() => <TicketList />}</Route>
            {/* Le garanzie non hanno più una pagina (04/09/2026): la rotta
            resta come redirect, perché notifiche e segnalibri già salvati
            devono atterrare dove il lavoro è rimasto, non su un 404 muto.
            Si leggono e si registrano dalla scheda cliente. */}
            <Route path="/garanzie">
              {() => <LegacyRedirect redirect={() => "/clienti"} />}
            </Route>
            {/* Leggibile da tutti (serve a posatori e ufficio per sapere chi
            è in cantiere); creare/modificare resta direzione, sia lato
            server (adminProcedure) sia nei comandi della pagina. */}
            <Route path="/squadre" component={SquadreList} />
            {/* Fornitori è tornata una pagina il 07/09/2026: l'archivio
            delle conferme d'ordine per fornitore, da cui si collegano alle
            commesse (e da lì nascono costo e consegna). */}
            <Route path="/fornitori" component={Fornitori} />
            <Route path="/preventivatori" component={Preventivatori} />
            <Route
              path="/preventivatori/fivizzanese/persiane"
              component={PreventivatoreFivizzanese}
            />
            <Route
              path="/preventivatori/punto-del-serramento/persiane"
              component={PreventivatorePuntoDelSerramento}
            />
            {/* La pagina Produzione è stata rimossa (29/08/2026, PRD §20):
            i segnalibri atterrano sul Board, dove la colonna «Produzione»
            segue le commesse in quello stato. */}
            <Route path="/produzione/*?">
              {() => <LegacyRedirect redirect={produzioneRedirect} />}
            </Route>
            <Route path="/reclami" component={ReclamiRifacimenti} />
            <Route path="/archivio" component={Archivio} />
            {/* User management is direzione-only: the server gates utenti
            create/update/delete with adminProcedure, so a client-side guard
            here gives non-direzione users a clear blocked state instead of a
            FORBIDDEN error on save. */}
            <Route path="/utenti">
              {() => (
                <RequireDirezione>
                  <UtentiList />
                </RequireDirezione>
              )}
            </Route>
            <Route path="/sedi">
              {() => (
                <RequireDirezione>
                  <SediList />
                </RequireDirezione>
              )}
            </Route>
            <Route path="/messaggi/email" component={EmailPage} />
            <Route path="/messaggi/whatsapp" component={WhatsAppPage} />
            <Route path="/chat" component={ChatAziendale} />
            <Route path="/notifiche" component={Notifiche} />
            <Route path="/comunicazioni">
              {() => <LegacyRedirect redirect={legacyMessageRedirect} />}
            </Route>
            <Route path="/conoscenza">
              {() => (
                <RequireDirezione>
                  <Conoscenza />
                </RequireDirezione>
              )}
            </Route>
            <Route path="/integrazioni" component={Integrazioni} />
            <Route path="/tars" component={Tars} />
            {/* Pannello della piattaforma (WS6 §8): amministra TUTTE le
            aziende di Wyndoor, quindi non è guardato da un ruolo ma dalla
            capacità di piattaforma, che il server calcola da
            PLATFORM_ADMIN_EMAILS. L'elenco prima della scheda: l'ordine
            conta, `/piattaforma/:slug` mangerebbe `/piattaforma`. */}
            <Route path="/piattaforma">
              {() => (
                <RequirePiattaforma>
                  <AziendeList />
                </RequirePiattaforma>
              )}
            </Route>
            {/* `key={params.slug}`: passando da un'azienda all'altra senza
            uscire dalla rotta, React riuserebbe lo stesso componente e con
            lui il suo stato — comandi lunghi in corso, dialoghi aperti,
            l'ultimo esito mostrato — che appartengono all'azienda di prima.
            Con la chiave la scheda si rimonta pulita. */}
            <Route path="/piattaforma/:slug">
              {params => (
                <RequirePiattaforma>
                  <AziendaDetail key={params.slug} />
                </RequirePiattaforma>
              )}
            </Route>
            {/* Fallback Modular Control. `/404` è l'indirizzo esplicito, la
            route senza path raccoglie tutto il resto: l'ordine conta e non va
            invertito. Entrambe rendono la stessa pagina dentro la shell
            autenticata, quindi il landmark `main` resta quello della shell. */}
            <Route path="/404" component={NotFound} />
            <Route component={NotFound} />
          </Switch>
        </RouteContractSurface>
      </Suspense>
    </DashboardLayout>
        )}
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      {/* Modular Control espone il tema dal menu profilo; il renderer legacy
          resta un rollback separato. La preferenza vive in rf-theme. */}
      <ThemeProvider defaultTheme="light" switchable storageKey="rf-theme">
        <TooltipProvider>
          <Toaster
            position="top-right"
            richColors
            closeButton
            expand
            toastOptions={{
              className: "rounded-xl border shadow-lg",
              duration: 4500,
            }}
          />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
