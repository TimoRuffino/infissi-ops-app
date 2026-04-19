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
import ReclamiRifacimenti from "./pages/ReclamiRifacimenti";
import UtentiList from "./pages/UtentiList";
import Preventivatori from "./pages/Preventivatori";
import PreventivatoreFivizzanese from "./pages/PreventivatoreFivizzanese";
import PreventivatorePuntoDelSerramento from "./pages/PreventivatorePuntoDelSerramento";
import RequireDirezione from "./components/RequireDirezione";

function Router() {
  return (
    <DashboardLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/clienti" component={ClientiList} />
        <Route path="/clienti/:id" component={ClienteDetail} />
        <Route path="/kanban" component={KanbanBoard} />
        <Route path="/commesse" component={CommesseList} />
        <Route path="/commesse/:id" component={CommessaDetail} />
        <Route path="/commesse/:commessaId/aperture/:aperturaId/rilievo" component={RilievoDetail} />
        <Route path="/verbale/:interventoId" component={VerbaleChiusura} />
        <Route path="/planning" component={Planning} />
        <Route path="/ticket" component={TicketList} />
        {/* Direzione-only surfaces. Hidden from the sidebar — reached via
            the Impostazioni hub. A client-side guard shows a blocked state
            so non-direzione users get a clear message instead of a silent
            404; the routes themselves are still registered so deep links
            work for authorized users. */}
        <Route path="/garanzie">
          {() => <RequireDirezione><GaranzieList /></RequireDirezione>}
        </Route>
        <Route path="/squadre">
          {() => <RequireDirezione><SquadreList /></RequireDirezione>}
        </Route>
        <Route path="/fornitori">
          {() => <RequireDirezione><FornitoriList /></RequireDirezione>}
        </Route>
        <Route path="/preventivatori">
          {() => <RequireDirezione><Preventivatori /></RequireDirezione>}
        </Route>
        <Route path="/preventivatori/fivizzanese/persiane">
          {() => (
            <RequireDirezione>
              <PreventivatoreFivizzanese />
            </RequireDirezione>
          )}
        </Route>
        <Route path="/preventivatori/punto-del-serramento/persiane">
          {() => (
            <RequireDirezione>
              <PreventivatorePuntoDelSerramento />
            </RequireDirezione>
          )}
        </Route>
        <Route path="/produzione">
          {() => <RequireDirezione><Produzione /></RequireDirezione>}
        </Route>
        <Route path="/reclami" component={ReclamiRifacimenti} />
        <Route path="/utenti" component={UtentiList} />
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
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
