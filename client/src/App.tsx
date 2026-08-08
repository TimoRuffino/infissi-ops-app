import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";
import Dashboard from "./pages/Dashboard";
import CommesseList from "./pages/CommesseList";
import CommessaDetail from "./pages/CommessaDetail";
import Planning from "./pages/Planning";
import TicketList from "./pages/TicketList";
import RilievoDetail from "./pages/RilievoDetail";
import VerbaleChiusura from "./pages/VerbaleChiusura";
import GaranzieList from "./pages/GaranzieList";
import SquadreList from "./pages/SquadreList";
import ClientiList from "./pages/ClientiList";
import ClienteDetail from "./pages/ClienteDetail";
import Integrazioni from "./pages/Integrazioni";
import FornitoriList from "./pages/FornitoriList";
import Produzione from "./pages/Produzione";
import KanbanBoard from "./pages/KanbanBoard";
import Magazzino from "./pages/Magazzino";
import Pagamenti from "./pages/Pagamenti";
import Marginalita from "./pages/Marginalita";
import ReclamiRifacimenti from "./pages/ReclamiRifacimenti";
import UtentiList from "./pages/UtentiList";
import Preventivatori from "./pages/Preventivatori";
import PreventivatoreFivizzanese from "./pages/PreventivatoreFivizzanese";
import PreventivatorePuntoDelSerramento from "./pages/PreventivatorePuntoDelSerramento";
import Archivio from "./pages/Archivio";
import SediList from "./pages/SediList";
import TarsInbox from "./pages/TarsInbox";
import Conoscenza from "./pages/Conoscenza";
import Comunicazioni from "./pages/Comunicazioni";
import Economia from "./pages/Economia";
import RequireDirezione from "./components/RequireDirezione";

function Router() {
  return (
    <DashboardLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/clienti" component={ClientiList} />
        <Route path="/clienti/:id" component={ClienteDetail} />
        <Route path="/kanban" component={KanbanBoard} />
        <Route path="/magazzino" component={Magazzino} />
        <Route path="/pagamenti" component={Pagamenti} />
        <Route path="/economia" component={Economia} />
        <Route path="/marginalita">
          {() => <RequireDirezione><Marginalita /></RequireDirezione>}
        </Route>
        <Route path="/commesse" component={CommesseList} />
        <Route path="/commesse/:id" component={CommessaDetail} />
        <Route path="/commesse/:commessaId/aperture/:aperturaId/rilievo" component={RilievoDetail} />
        <Route path="/verbale/:interventoId" component={VerbaleChiusura} />
        <Route path="/planning" component={Planning} />
        <Route path="/ticket">{() => <TicketList />}</Route>
        {/* Direzione-only surfaces. Hidden from the sidebar — reached via
            the Impostazioni hub. A client-side guard shows a blocked state
            so non-direzione users get a clear message instead of a silent
            404; the routes themselves are still registered so deep links
            work for authorized users. */}
        <Route path="/garanzie">
          {() => <RequireDirezione><GaranzieList /></RequireDirezione>}
        </Route>
        {/* Leggibile da tutti (serve a posatori e ufficio per sapere chi
            è in cantiere); creare/modificare resta direzione, sia lato
            server (adminProcedure) sia nei comandi della pagina. */}
        <Route path="/squadre" component={SquadreList} />
        <Route path="/fornitori">
          {() => <RequireDirezione><FornitoriList /></RequireDirezione>}
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
        <Route path="/produzione">
          {() => <RequireDirezione><Produzione /></RequireDirezione>}
        </Route>
        <Route path="/reclami" component={ReclamiRifacimenti} />
        <Route path="/archivio" component={Archivio} />
        {/* User management is direzione-only: the server gates utenti
            create/update/delete with adminProcedure, so a client-side guard
            here gives non-direzione users a clear blocked state instead of a
            FORBIDDEN error on save. */}
        <Route path="/utenti">
          {() => <RequireDirezione><UtentiList /></RequireDirezione>}
        </Route>
        <Route path="/sedi">
          {() => <RequireDirezione><SediList /></RequireDirezione>}
        </Route>
        <Route path="/inbox" component={TarsInbox} />
        <Route path="/comunicazioni" component={Comunicazioni} />
        <Route path="/conoscenza">
          {() => <RequireDirezione><Conoscenza /></RequireDirezione>}
        </Route>
        <Route path="/integrazioni" component={Integrazioni} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
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
