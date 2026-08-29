import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Loader2 } from "lucide-react";
import { lazy, Suspense, useEffect } from "react";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";
import RequireDirezione from "./components/RequireDirezione";
import { legacyMessageRedirect } from "./lib/messaggi";
import { produzioneRedirect } from "./lib/navigation";

const NotFound = lazy(() => import("./pages/NotFound"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const CommesseList = lazy(() => import("./pages/CommesseList"));
const CommessaDetail = lazy(() => import("./pages/CommessaDetail"));
const Planning = lazy(() => import("./pages/Planning"));
const TicketList = lazy(() => import("./pages/TicketList"));
const RilievoDetail = lazy(() => import("./pages/RilievoDetail"));
const VerbaleChiusura = lazy(() => import("./pages/VerbaleChiusura"));
const GaranzieList = lazy(() => import("./pages/GaranzieList"));
const SquadreList = lazy(() => import("./pages/SquadreList"));
const ClientiList = lazy(() => import("./pages/ClientiList"));
const ClienteDetail = lazy(() => import("./pages/ClienteDetail"));
const Integrazioni = lazy(() => import("./pages/Integrazioni"));
const FornitoriList = lazy(() => import("./pages/FornitoriList"));
const KanbanBoard = lazy(() => import("./pages/KanbanBoard"));
const Magazzino = lazy(() => import("./pages/Magazzino"));
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
const EmailPage = lazy(() => import("./pages/messaggi/EmailPage"));
const WhatsAppPage = lazy(() => import("./pages/messaggi/WhatsAppPage"));
const Notifiche = lazy(() => import("./pages/Notifiche"));

function RouteLoading() {
  return (
    <div className="grid min-h-[45dvh] place-items-center" role="status">
      <Loader2 className="h-6 w-6 animate-spin text-text-3" />
      <span className="sr-only">Caricamento</span>
    </div>
  );
}

function LegacyRedirect({ redirect }: { redirect: (location: string) => string }) {
  const [location, setLocation] = useLocation();

  useEffect(() => {
    setLocation(redirect(`${location}${window.location.search}`), {
      replace: true,
    });
  }, [location, redirect, setLocation]);

  return <RouteLoading />;
}

function Router() {
  return (
    <DashboardLayout>
      <Suspense fallback={<RouteLoading />}>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/clienti" component={ClientiList} />
          <Route path="/clienti/:id" component={ClienteDetail} />
          <Route path="/kanban" component={KanbanBoard} />
          <Route path="/magazzino" component={Magazzino} />
          <Route path="/pagamenti" component={Pagamenti} />
          <Route path="/economia" component={Economia} />
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
          {/* Direzione-only surfaces. Hidden from the sidebar — reached via
            the Impostazioni hub. A client-side guard shows a blocked state
            so non-direzione users get a clear message instead of a silent
            404; the routes themselves are still registered so deep links
            work for authorized users. */}
          <Route path="/garanzie">
            {() => (
              <RequireDirezione>
                <GaranzieList />
              </RequireDirezione>
            )}
          </Route>
          {/* Leggibile da tutti (serve a posatori e ufficio per sapere chi
            è in cantiere); creare/modificare resta direzione, sia lato
            server (adminProcedure) sia nei comandi della pagina. */}
          <Route path="/squadre" component={SquadreList} />
          <Route path="/fornitori">
            {() => (
              <RequireDirezione>
                <FornitoriList />
              </RequireDirezione>
            )}
          </Route>
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
          <Route path="/produzione">
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
          <Route path="/404" component={NotFound} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </DashboardLayout>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
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
