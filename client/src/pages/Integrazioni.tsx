import { Badge } from "@/components/ui/badge";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Settings,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ExternalLink,
  Calendar,
  ListTodo,
  RefreshCw,
  Truck,
  Users,
  Shield,
  Calculator,
  ArrowRight,
  Lock,
  Copy,
  Check,
  Plus,
  Trash2,
  Power,
  Download,
  Database,
  Play,
  Link2,
  Unlink2,
  KeyRound,
  Square,
} from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { isDirezione } from "@/lib/roles";
import { presentFicSyncStats } from "@/lib/paymentView";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import CaselleEmailCard from "@/components/CaselleEmailCard";
import WhatsAppCard from "@/components/WhatsAppCard";

// Direzione-only surfaces exposed from the Impostazioni hub. Paths match the
// guarded routes in App.tsx; adding a new entry here automatically surfaces
// it to direzione users without touching the sidebar.
const GESTIONE_LINKS: Array<{
  icon: any;
  label: string;
  path: string;
  description: string;
}> = [
  {
    icon: Truck,
    label: "Fornitori",
    path: "/fornitori",
    description: "Anagrafica fornitori, ordini, listini",
  },
  {
    icon: Users,
    label: "Squadre",
    path: "/squadre",
    description: "Squadre di posa e assegnazioni",
  },
  {
    icon: Shield,
    label: "Garanzie",
    path: "/garanzie",
    description: "Registro garanzie e scadenze",
  },
  {
    icon: Calculator,
    label: "Preventivatori",
    path: "/preventivatori",
    description: "Calcolatori prezzo per azienda e prodotto",
  },
];

export default function Integrazioni() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const canManage = isDirezione(user);

  // Integration states (would be persisted in real app)
  const [todoEnabled, setTodoEnabled] = useState(false);
  const [todoConfig, setTodoConfig] = useState({
    clientId: "",
    tenantId: "",
    autoCreateTasks: true,
    syncBidirectional: true,
    defaultList: "Ruffino Flow",
  });

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Settings className="h-6 w-6" />
          Impostazioni
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Gestione avanzata e configurazione integrazioni
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Caselle email, WhatsApp e Fatture in Cloud valgono{" "}
          <strong>per la sede selezionata</strong> (la scegli in alto nella
          barra laterale): ogni sede ha i suoi collegamenti e può tenerne alcuni
          spenti. Il backup su Google Drive è l'eccezione — è uno per tutta
          l'installazione, e salva i dati di tutte le sedi.
        </p>
      </div>

      {/* Gestione — direzione only. Hub per le sezioni operative avanzate
          non esposte nella sidebar principale. */}
      {canManage && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Gestione
            </h2>
            <Badge variant="outline" className="text-[10px] gap-1">
              <Lock className="h-3 w-3" />
              Direzione
            </Badge>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {GESTIONE_LINKS.map(link => (
              <button
                key={link.path}
                onClick={() => setLocation(link.path)}
                className="group text-left rounded-lg border bg-background hover:bg-accent hover:border-primary/40 transition-all p-4"
              >
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <link.icon className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">{link.label}</p>
                      <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {link.description}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Integrazioni */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Integrazioni
        </h2>

        {/* Microsoft To Do */}
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent">
                  <ListTodo className="h-5 w-5 text-accent-foreground" />
                </div>
                <div className="min-w-0">
                  <CardTitle className="text-base">Microsoft To Do</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Sincronizzazione task operativi bidirezionale
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 sm:justify-end">
                {todoEnabled ? (
                  <Badge className="text-xs bg-green-100 text-green-800 hover:bg-green-100">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Attiva
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs">
                    <AlertCircle className="h-3 w-3 mr-1" />
                    Non configurata
                  </Badge>
                )}
                <Switch
                  aria-label="Attiva la sincronizzazione con Microsoft To Do"
                  checked={todoEnabled}
                  onCheckedChange={setTodoEnabled}
                />
              </div>
            </div>
          </CardHeader>
          {todoEnabled && (
            <CardContent className="space-y-4 border-t pt-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Client ID (Azure AD)</Label>
                  <Input
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    value={todoConfig.clientId}
                    onChange={e =>
                      setTodoConfig({ ...todoConfig, clientId: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Tenant ID</Label>
                  <Input
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    value={todoConfig.tenantId}
                    onChange={e =>
                      setTodoConfig({ ...todoConfig, tenantId: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Lista predefinita</Label>
                <Input
                  value={todoConfig.defaultList}
                  onChange={e =>
                    setTodoConfig({
                      ...todoConfig,
                      defaultList: e.target.value,
                    })
                  }
                />
              </div>
              <Separator />
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Comportamento
                </h4>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">
                      Creazione automatica task
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Crea task su To Do alla creazione di interventi, anomalie
                      e ticket
                    </p>
                  </div>
                  <Switch
                    checked={todoConfig.autoCreateTasks}
                    onCheckedChange={v =>
                      setTodoConfig({ ...todoConfig, autoCreateTasks: v })
                    }
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">
                      Sincronizzazione bidirezionale
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Completando il task su To Do, lo stato si aggiorna
                      nell'app
                    </p>
                  </div>
                  <Switch
                    checked={todoConfig.syncBidirectional}
                    onCheckedChange={v =>
                      setTodoConfig({ ...todoConfig, syncBidirectional: v })
                    }
                  />
                </div>
              </div>
              <Separator />
              <div className="flex items-center gap-3">
                <Button size="sm" disabled={!todoConfig.clientId}>
                  <ExternalLink className="h-3.5 w-3.5 mr-1" />
                  Autorizza con Microsoft
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!todoConfig.clientId}
                >
                  <RefreshCw className="h-3.5 w-3.5 mr-1" />
                  Test connessione
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Richiede un'app registrata su Azure Active Directory con
                permessi Tasks.ReadWrite. Il token verrà gestito in modo sicuro
                dal server con refresh automatico.
              </p>
            </CardContent>
          )}
        </Card>

        {/* Le card raggruppate per tema, con aria in mezzo: dodici card in
          colonna unica erano un muro in cui niente si distingueva. */}
        <div className="space-y-2 pt-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b pb-1.5">
            Agente
          </h3>
        </div>

        <div className="space-y-2 pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b pb-1.5">
            Canali — email e WhatsApp
          </h3>
          <div className="space-y-4">
            <CaselleEmailCard />
            <WhatsAppCard />
          </div>
        </div>

        <div className="space-y-2 pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b pb-1.5">
            Contabilità
          </h3>
          <FattureInCloudCard />
          <ImportaClientiCard />
          <ResetPattuitiCard />
        </div>

        <div className="space-y-2 pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b pb-1.5">
            Calendari
          </h3>
          <div className="space-y-4">
            <GoogleCalendarImport />
            <GoogleCalendarSync />
          </div>
        </div>

        <div className="space-y-2 pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b pb-1.5">
            Sistema
          </h3>
          <BackupDrive />
        </div>

        {/* Info */}
        <Card className="bg-muted/30 mt-4">
          <CardContent className="p-4">
            <h4 className="text-sm font-semibold mb-2">
              Come funzionano le integrazioni
            </h4>
            <div className="space-y-2 text-xs text-muted-foreground">
              <p>
                <strong>Microsoft To Do:</strong> Alla creazione di un
                intervento, anomalia o ticket, viene generato un task con deep
                link alla risorsa. Le checklist di posa vengono mappate come
                sotto-task. Lo stato si sincronizza in entrambe le direzioni.
              </p>
              <p>
                <strong>Google Calendar:</strong> ogni sede pubblica feed iCal
                (uno per tipo di appuntamento + uno con tutti). Aggiungi il link
                in Google Calendar con «Altri calendari → Da URL» e gli
                appuntamenti compaiono e si aggiornano da soli (sola lettura su
                Google). Ruota il token per revocare tutte le iscrizioni.
              </p>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}



// ── Fatture in Cloud → clienti automatici ────────────────────────────────────
// Every 6h (or on demand) the CRM reads the year's issued invoices and
// creates any client that's still missing — keeps the anagrafica aligned
// with the fatturazione without manual imports.
// Reset di pattuito, rate e pagamenti manuali — direzione soltanto.
//
// Sta qui e non solo nello script perche' uno script esterno non regge: il
// server tiene le commesse in memoria e le riscrive intere al primo salvataggio,
// quindi una scrittura fatta da fuori viene sovrascritta dal primo sync utile.
// Da questo bottone la mutazione avviene dentro il processo vivo.
// Import anagrafica da un export Fatture in Cloud — direzione soltanto.
//
// Il file lo legge il browser e ne manda il testo: l'alternativa era un
// upload con storage temporaneo per un'operazione che si fa due volte l'anno.
// Simula sempre per primo — la simulazione dice quanti ne creerebbe, ed è il
// numero su cui si decide.
function ImportaClientiCard() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [csv, setCsv] = useState<string | null>(null);
  const [nomeFile, setNomeFile] = useState<string | null>(null);
  const [arricchisci, setArricchisci] = useState(true);
  const [report, setReport] = useState<any>(null);

  const importa = trpc.clienti.importaDaCsv.useMutation({
    onSuccess: r => {
      setReport(r);
      if (!r.dryRun) {
        toast.success(
          `${r.creati} clienti creati · ${r.campiArricchiti} campi riempiti`
        );
        utils.clienti.invalidate();
      }
    },
    onError: e => toast.error(e.message),
  });

  if (!isDirezione(user)) return null;

  const scegli = async (file: File | undefined) => {
    if (!file) return;
    setReport(null);
    setNomeFile(file.name);
    setCsv(await file.text());
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Importa clienti da Fatture in Cloud
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Carica l&apos;export dei clienti in <strong>CSV</strong>. Chi c&apos;è
          già viene riconosciuto da partita IVA, codice fiscale o nome e{" "}
          <strong>non viene duplicato</strong>. Nessun cliente viene mai
          eliminato o sovrascritto.
        </p>
        <p className="text-xs text-muted-foreground">
          Da Excel: <em>File → Salva come → CSV UTF-8</em>. Da Fatture in Cloud
          si può esportare direttamente in CSV.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <input
            id="import-clienti-file"
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={e => scegli(e.target.files?.[0])}
          />
          <Button asChild variant="outline" size="sm" className="h-10">
            <label htmlFor="import-clienti-file" className="cursor-pointer">
              Scegli il file CSV
            </label>
          </Button>
          {nomeFile && (
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {nomeFile}
            </span>
          )}
        </div>

        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={arricchisci}
            onChange={e => setArricchisci(e.target.checked)}
          />
          <span>
            Riempi i campi vuoti dei clienti già presenti (email, telefono,
            indirizzo). Non sovrascrive mai un dato esistente.
          </span>
        </label>

        {report && (
          <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-2">
            <p className="font-medium">
              {report.dryRun ? "Simulazione — nessuna scrittura" : "Importato"}
            </p>
            <ul className="space-y-0.5 tabular-nums">
              <li>Righe lette: {report.righeLette}</li>
              <li className="font-medium">
                {report.dryRun ? "Da creare" : "Creati"}: {report.creati}
              </li>
              <li>Già in anagrafica: {report.giaPresenti}</li>
              <li>Ripetuti nel file: {report.duplicatiNelFile}</li>
              {report.scartati > 0 && <li>Scartati: {report.scartati}</li>}
              {arricchisci && (
                <li>Campi vuoti riempiti: {report.campiArricchiti}</li>
              )}
            </ul>
            {report.esempiDaCreare?.length > 0 && (
              <div>
                <p className="text-muted-foreground">
                  Esempi fra i nuovi:
                </p>
                <p className="mt-0.5">
                  {report.esempiDaCreare.slice(0, 8).join(" · ")}
                </p>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            className="h-10"
            disabled={!csv || importa.isPending}
            onClick={() =>
              importa.mutate({ csv: csv!, apply: false, arricchisci })
            }
          >
            {importa.isPending && (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            )}
            Simula
          </Button>
          <Button
            size="sm"
            className="h-10"
            disabled={!csv || !report || !report.dryRun || importa.isPending}
            onClick={() =>
              importa.mutate({ csv: csv!, apply: true, arricchisci })
            }
          >
            Importa {report?.dryRun ? `${report.creati} clienti` : ""}
          </Button>
        </div>
        {!report && (
          <p className="text-[11px] text-muted-foreground">
            Simula prima: il numero della simulazione è quello che verrà creato.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ResetPattuitiCard() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [includiArchiviate, setIncludiArchiviate] = useState(false);
  const [tutteLeSedi, setTutteLeSedi] = useState(false);
  const [report, setReport] = useState<any>(null);
  const [confermaAperta, setConfermaAperta] = useState(false);

  const reset = trpc.commesse.resetPattuiti.useMutation({
    onSuccess: r => {
      setReport(r);
      if (r.refusedReason) {
        toast.error("Reset rifiutato");
        return;
      }
      if (!r.dryRun) {
        setConfermaAperta(false);
        toast.success(
          `Reset eseguito · ${r.pattuitiAzzerati} pattuiti, ${r.pagamentiManualiRimossi} pagamenti manuali`
        );
        utils.commesse.invalidate();
        utils.economia.invalidate();
      }
    },
    onError: e => toast.error(e.message),
  });

  if (!isDirezione(user)) return null;

  const lancia = (apply: boolean) =>
    reset.mutate({
      apply,
      includiArchiviate,
      soloSedeAttiva: !tutteLeSedi,
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          Reset pattuito e pagamenti manuali
          <Badge variant="destructive">Distruttivo</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Azzera <strong>importo pattuito</strong> e <strong>piano rate</strong> ed
          elimina i pagamenti inseriti a mano. I movimenti che arrivano da Fatture
          in Cloud restano intatti. Dopo il reset, <strong>Sincronizza ora</strong>{" "}
          ricostruisce il pattuito dalle fatture.
        </p>
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-xs">
          <AlertCircle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />
          <span>
            I pagamenti manuali vengono <strong>eliminati, non stornati</strong>.
            Quelli che Fatture in Cloud conosce tornano al prossimo sync; gli
            acconti mai fatturati no. Serve un backup Drive riuscito nelle ultime
            24 ore, altrimenti l&apos;esecuzione viene rifiutata.
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={includiArchiviate}
              onChange={e => setIncludiArchiviate(e.target.checked)}
            />
            <span>Includi anche le commesse archiviate</span>
          </label>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={tutteLeSedi}
              onChange={e => setTutteLeSedi(e.target.checked)}
            />
            <span>Tutte le sedi, non solo quella attiva</span>
          </label>
        </div>

        {report && (
          <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-1">
            <p className="font-medium">
              {report.refusedReason
                ? "Rifiutato"
                : report.dryRun
                  ? "Simulazione — nessuna scrittura"
                  : "Eseguito"}
            </p>
            {report.refusedReason ? (
              <p className="text-destructive">{report.refusedReason}</p>
            ) : (
              <ul className="space-y-0.5 tabular-nums">
                <li>Commesse esaminate: {report.commesseEsaminate}</li>
                <li>Pattuiti azzerati: {report.pattuitiAzzerati}</li>
                <li>Piani rate rimossi: {report.pianiRimossi}</li>
                <li className="text-destructive">
                  Pagamenti manuali eliminati: {report.pagamentiManualiRimossi}
                </li>
                <li>Pagamenti FiC conservati: {report.pagamentiFicConservati}</li>
                {report.commesseSaltate?.length > 0 && (
                  <li>Saltate (archiviate): {report.commesseSaltate.length}</li>
                )}
              </ul>
            )}
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            disabled={reset.isPending}
            onClick={() => lancia(false)}
          >
            Simula
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={reset.isPending || !report || report.dryRun === false}
            onClick={() => setConfermaAperta(true)}
          >
            Esegui il reset
          </Button>
        </div>
        {!report && (
          <p className="text-[11px] text-muted-foreground">
            Simula prima: i numeri della simulazione sono quelli che verranno
            applicati.
          </p>
        )}

        <ConfirmDialog
          open={confermaAperta}
          onOpenChange={setConfermaAperta}
          title="Eliminare i pagamenti inseriti a mano?"
          description={
            report
              ? `Verranno azzerati ${report.pattuitiAzzerati} pattuiti ed eliminati ${report.pagamentiManualiRimossi} pagamenti manuali su ${report.commesseEsaminate} commesse. I ${report.pagamentiFicConservati} movimenti di Fatture in Cloud restano. L'operazione non ha un annullamento: si torna indietro solo dal backup Drive.`
              : ""
          }
          confirmLabel="Elimina"
          onConfirm={() => lancia(true)}
        />
      </CardContent>
    </Card>
  );
}

function FattureInCloudCard() {
  const status = trpc.fattureInCloud.status.useQuery(undefined, {
    retry: false,
    refetchInterval: query => (query.state.data?.syncInCorso ? 1_500 : 15_000),
  });
  const utils = trpc.useUtils();
  const [token, setToken] = useState("");
  const [companies, setCompanies] = useState<Array<{
    id: number;
    name: string;
  }> | null>(null);

  const save = trpc.fattureInCloud.saveConfig.useMutation({
    onSuccess: () => {
      utils.fattureInCloud.invalidate();
      setToken("");
      toast.success("Configurazione salvata");
    },
    onError: e => toast.error(e.message),
  });
  const loadCompanies = trpc.fattureInCloud.companies.useMutation({
    onSuccess: list => {
      setCompanies(list);
      if (list.length === 1) save.mutate({ companyId: list[0].id });
    },
    onError: e => toast.error(e.message),
  });
  // Riallineamento locale: nessuna chiamata all'API, lavora sulle fatture
  // gia' scaricate. Serve dopo un reset del pattuito o dopo un cambio della
  // regola di match, quando il sync completo sarebbe minuti spesi per niente.
  const riallinea = trpc.ficFatture.riconciliaOra.useMutation({
    onSuccess: r => {
      toast.success(
        `Riallineato · ${r.collegate} fatture collegate · ${r.pattuitiAggiornati} pattuiti aggiornati`
      );
      utils.ficFatture.invalidate();
      utils.commesse.invalidate();
      utils.economia.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  const sync = trpc.fattureInCloud.syncNow.useMutation({
    onMutate: () => {
      window.setTimeout(() => void status.refetch(), 150);
    },
    onSuccess: ({ result }) => {
      utils.fattureInCloud.invalidate();
      utils.clienti.invalidate();
      utils.ficFatture.invalidate();
      utils.ficCosti.invalidate();
      utils.economia.invalidate();
      toast.success(result);
    },
    onError: e => {
      utils.fattureInCloud.invalidate();
      if (!/annullata dall'operatore/i.test(e.message)) toast.error(e.message);
    },
  });
  const annullaSync = trpc.fattureInCloud.annullaSync.useMutation({
    onSuccess: ({ annullata }) => {
      utils.fattureInCloud.invalidate();
      if (annullata) toast.success("Sincronizzazione fermata");
      else toast.info("Nessuna sincronizzazione attiva");
    },
    onError: e => toast.error(e.message),
  });
  const oauthStart = trpc.fattureInCloud.oauthStartUrl.useMutation({
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: e => toast.error(e.message),
  });
  const disconnect = trpc.fattureInCloud.disconnectOAuth.useMutation({
    onSuccess: () => {
      setCompanies(null);
      utils.fattureInCloud.invalidate();
      toast.success("Fatture in Cloud scollegato");
    },
    onError: e => toast.error(e.message),
  });

  if (status.error) return null;
  const st = status.data;
  if (!st) return null;
  const lastStats = st.lastStats ? presentFicSyncStats(st.lastStats) : [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-sky-100 flex items-center justify-center">
              <RefreshCw className="h-5 w-5 text-sky-700" />
            </div>
            <div>
              <CardTitle className="text-base">
                Fatture in Cloud · Contabilita
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Sincronizza vendite, note di credito, acquisti, pagamenti e
                clienti della sede
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {st.configured && (
              <Switch
                checked={st.enabled}
                onCheckedChange={v => save.mutate({ enabled: v })}
                disabled={st.syncInCorso}
              />
            )}
            {st.syncInCorso ? (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => annullaSync.mutate()}
                disabled={annullaSync.isPending}
              >
                <Square className="h-3.5 w-3.5 fill-current" />
                {annullaSync.isPending ? "Arresto…" : "Ferma sincronizzazione"}
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => sync.mutate()}
                disabled={!st.configured || sync.isPending}
              >
                <RefreshCw
                  className={
                    sync.isPending ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"
                  }
                />
                {sync.isPending ? "Avvio…" : "Sincronizza ora"}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              title="Ricollega le fatture già scaricate e ricostruisce pattuito e rate, senza contattare Fatture in Cloud"
              onClick={() => riallinea.mutate()}
              disabled={!st.configured || riallinea.isPending || sync.isPending}
            >
              <Link2
                className={
                  riallinea.isPending
                    ? "h-3.5 w-3.5 animate-pulse"
                    : "h-3.5 w-3.5"
                }
              />
              {riallinea.isPending ? "Riallineo…" : "Riallinea dalle fatture"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 border-t pt-4">
        <div className="flex items-center gap-2 flex-wrap text-sm">
          {st.connected ? (
            <>
              <Badge variant="success">
                {st.authMode === "oauth" ? "OAuth collegato" : "Token manuale"}
              </Badge>
              <span className="codice-mono text-[11px] text-text-3">
                {st.companyId
                  ? `azienda #${st.companyId}`
                  : "azienda da selezionare"}
              </span>
            </>
          ) : (
            <Badge variant="warning">Non configurato</Badge>
          )}
          {st.syncInCorso && (
            <Badge variant="warning">
              Sincronizzazione in corso
              {st.syncAvviataAt
                ? ` dalle ${new Date(st.syncAvviataAt).toLocaleTimeString(
                    "it-IT",
                    {
                      hour: "2-digit",
                      minute: "2-digit",
                    }
                  )}`
                : ""}
            </Badge>
          )}
          {st.lastResult && (
            <span
              className={`text-xs ${st.lastResult.startsWith("ERRORE") ? "text-danger" : "text-text-2"}`}
            >
              Ultimo: {st.lastResult}
            </span>
          )}
        </div>

        {lastStats.length > 0 && (
          <div className="flex flex-wrap gap-1.5" aria-label="Esito ultimo sync FiC">
            {lastStats.map(item => (
              <Badge key={item} variant="outline" className="text-[10px]">
                {item}
              </Badge>
            ))}
          </div>
        )}

        {st.permessiEconomiciDaAggiornare && (
          <div className="rounded-md border border-warning/40 bg-warning-soft px-3 py-3">
            <p className="text-sm font-semibold text-text-1">
              Aggiorna i permessi economici
            </p>
            <p className="mt-1 text-xs leading-relaxed text-text-2">
              Il collegamento attuale non ha ancora confermato la lettura di
              note di credito e documenti ricevuti. Ricollega FiC una volta, poi
              avvia una sincronizzazione completa.
            </p>
            {st.oauthClientReady && (
              <Button
                size="sm"
                className="mt-3 min-h-10"
                onClick={() => oauthStart.mutate()}
                disabled={oauthStart.isPending}
              >
                <Link2 className="mr-2 h-4 w-4" />
                Ricollega e aggiorna permessi
              </Button>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          {st.oauthClientReady ? (
            <Button
              size="sm"
              variant={st.authMode === "oauth" ? "outline" : "default"}
              onClick={() => oauthStart.mutate()}
              disabled={oauthStart.isPending}
            >
              <Link2 className="h-3.5 w-3.5 mr-1.5" />
              {st.authMode === "oauth"
                ? "Ricollega account"
                : "Collega con OAuth"}
            </Button>
          ) : (
            <Badge variant="outline" className="font-normal">
              OAuth server da configurare
            </Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={!st.connected || loadCompanies.isPending}
            onClick={() => loadCompanies.mutate()}
          >
            {loadCompanies.isPending ? "Cerco…" : "Seleziona azienda"}
          </Button>
          {st.authMode === "oauth" && (
            <Button
              variant="ghost"
              size="sm"
              className="text-danger"
              onClick={() => disconnect.mutate()}
              disabled={disconnect.isPending}
            >
              <Unlink2 className="h-3.5 w-3.5 mr-1.5" />
              Scollega
            </Button>
          )}
        </div>

        {companies && companies.length > 1 && (
          <div className="flex gap-1.5 flex-wrap">
            {companies.map(c => (
              <Button
                key={c.id}
                variant={st.companyId === c.id ? "default" : "outline"}
                size="sm"
                onClick={() => save.mutate({ companyId: c.id })}
              >
                {c.name}
              </Button>
            ))}
          </div>
        )}

        {!st.oauthClientReady && (
          <p className="text-xs text-muted-foreground">
            Imposta <code>FIC_OAUTH_CLIENT_ID</code>,{" "}
            <code>FIC_OAUTH_CLIENT_SECRET</code> e la callback{" "}
            <code>/api/oauth/fic/callback</code> per attivare il rinnovo
            automatico.
          </p>
        )}

        <details className="group rounded-lg border bg-muted/20 px-3 py-2">
          <summary className="cursor-pointer list-none text-xs font-medium flex items-center gap-2">
            <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
            Token manuale di emergenza
          </summary>
          <div className="flex gap-2 items-end flex-wrap pt-3">
            <div className="space-y-1 flex-1 min-w-[240px]">
              <Label className="text-xs">Access token</Label>
              <Input
                type="password"
                placeholder={
                  st.authMode === "manual" ? (st.tokenMasked ?? "a/…") : "a/…"
                }
                value={token}
                onChange={e => setToken(e.target.value)}
                className="h-9 font-mono text-xs"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={token.trim().length < 10 || save.isPending}
              onClick={() => save.mutate({ accessToken: token.trim() })}
            >
              Salva token
            </Button>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

// ── Nightly backup to Google Drive ───────────────────────────────────────────
// Direzione-only card: status of the scheduled 00:00 backup, manual run,
// destination folder config and service-account setup instructions.
function BackupDrive() {
  const status = trpc.backup.status.useQuery(undefined, {
    refetchInterval: 30000,
    retry: false,
  });
  const utils = trpc.useUtils();
  const [folderId, setFolderId] = useState<string | null>(null);

  const runNow = trpc.backup.runNow.useMutation({
    onSuccess: (log: any) => {
      utils.backup.invalidate();
      if (log.ok) {
        toast.success(
          log.target === "drive"
            ? `Backup su Google Drive completato — ${log.files} file`
            : `Drive non collegato: backup locale completato — ${log.files} file`
        );
      } else {
        toast.error(`Backup fallito: ${log.error}`);
      }
    },
    onError: e => toast.error(e.message ?? "Backup fallito"),
  });
  const updateCfg = trpc.backup.updateConfig.useMutation({
    onSuccess: () => {
      utils.backup.invalidate();
      setFolderId(null);
      toast.success("Impostazioni backup salvate");
    },
  });
  const oauthStart = trpc.backup.oauthStartUrl.useMutation({
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: e => toast.error(e.message ?? "Avvio collegamento fallito"),
  });
  const oauthDisconnect = trpc.backup.disconnectOAuth.useMutation({
    onSuccess: () => {
      utils.backup.invalidate();
      toast.success("Account Google scollegato");
    },
  });

  // Hidden for non-direzione (the procedures are admin-only).
  if (status.error) return null;
  const s = status.data;
  if (!s) return null;

  const last = s.ultimoBackup;
  const nextMin =
    s.prossimoTraMs != null ? Math.round(s.prossimoTraMs / 60000) : null;
  const folderValue = folderId ?? s.folderId;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-emerald-100 flex items-center justify-center">
              <Database className="h-5 w-5 text-emerald-700" />
            </div>
            <div>
              <CardTitle className="text-base">
                Backup notturno su Google Drive
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Ogni notte alle 00:00 salva clienti, commesse, preventivi,
                misure e tutti i file in cartelle ordinate per sede e cliente
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => runNow.mutate()}
            disabled={runNow.isPending || s.inCorso}
          >
            <Play className="h-3.5 w-3.5 mr-1" />
            {runNow.isPending || s.inCorso ? "In corso…" : "Esegui ora"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 border-t pt-4">
        <div className="flex items-center gap-2 flex-wrap text-sm">
          {s.mode === "oauth" ? (
            <>
              <Badge variant="success">Drive collegato</Badge>
              <span className="codice-mono text-[11px] text-text-3 truncate">
                {s.oauthEmail ?? "account Google"}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-danger"
                onClick={() => oauthDisconnect.mutate()}
                disabled={oauthDisconnect.isPending}
              >
                Scollega
              </Button>
            </>
          ) : s.mode === "service_account" ? (
            <>
              <Badge variant="success">Drive collegato (service account)</Badge>
              <span className="codice-mono text-[11px] text-text-3 truncate">
                {s.serviceAccountEmail}
              </span>
            </>
          ) : (
            <>
              <Badge variant="warning">
                Drive non collegato — backup salvato in locale
              </Badge>
              {s.oauthClientReady && (
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => oauthStart.mutate()}
                  disabled={oauthStart.isPending}
                >
                  Collega Google Drive
                </Button>
              )}
            </>
          )}
          {nextMin != null && (
            <span className="text-xs text-text-2">
              Prossimo backup automatico tra ~
              {nextMin >= 60
                ? `${Math.floor(nextMin / 60)}h ${nextMin % 60}m`
                : `${nextMin}m`}
            </span>
          )}
        </div>

        {s.mode === "oauth" && (
          <p className="text-xs text-text-2">
            I backup finiscono nella cartella{" "}
            <a
              className="font-medium text-primary hover:underline"
              href={
                s.rootFolderId
                  ? `https://drive.google.com/drive/folders/${s.rootFolderId}`
                  : "https://drive.google.com"
              }
              target="_blank"
              rel="noreferrer"
            >
              «Backup CRM Ruffino»
            </a>{" "}
            del tuo Drive: puoi spostarla o condividerla liberamente (anche
            dentro un'altra cartella condivisa) — il CRM continua a trovarla.
          </p>
        )}

        {last && (
          <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-xs space-y-0.5">
            <p>
              <span className="font-semibold">Ultimo backup:</span>{" "}
              {new Date(last.startedAt).toLocaleString("it-IT")} ·{" "}
              {last.ok == null ? (
                <Badge variant="secondary" className="text-[10px]">
                  in corso
                </Badge>
              ) : last.ok ? (
                <Badge variant="success" className="text-[10px]">
                  riuscito ({last.target === "drive" ? "Drive" : "locale"})
                </Badge>
              ) : (
                <Badge variant="danger" className="text-[10px]">
                  fallito
                </Badge>
              )}
            </p>
            <p className="text-text-2">
              {last.rootName} — {last.files} file,{" "}
              {(last.bytes / 1024 / 1024).toFixed(1)} MB
            </p>
            {last.error && <p className="text-danger">{last.error}</p>}
          </div>
        )}

        {s.mode === "service_account" && (
          <div className="flex gap-2 items-end flex-wrap">
            <div className="space-y-1 flex-1 min-w-[260px]">
              <Label className="text-xs">
                ID cartella Google Drive di destinazione
              </Label>
              <Input
                value={folderValue}
                onChange={e => setFolderId(e.target.value)}
                className="h-9 font-mono text-xs"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={
                folderId == null ||
                folderId.trim() === s.folderId ||
                updateCfg.isPending
              }
              onClick={() =>
                folderId && updateCfg.mutate({ folderId: folderId.trim() })
              }
            >
              Salva
            </Button>
          </div>
        )}

        {!s.driveConfigurato && !s.oauthClientReady && (
          <div className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2.5">
            <p className="text-xs font-semibold mb-1">
              Per collegare Google Drive (account Google normale, una sola
              volta):
            </p>
            <ol className="list-decimal pl-5 space-y-1 text-xs text-text-2">
              <li>
                Su{" "}
                <span className="font-medium text-text-1">
                  console.cloud.google.com
                </span>{" "}
                → «API e servizi» → «Schermata consenso OAuth»: configurala
                (tipo <span className="font-medium text-text-1">Esterno</span>),
                aggiungi la tua email e poi{" "}
                <span className="font-medium text-text-1">pubblica l'app</span>{" "}
                (stato «In produzione»).
              </li>
              <li>
                «Credenziali» → «Crea credenziali» →{" "}
                <span className="font-medium text-text-1">ID client OAuth</span>{" "}
                → tipo «Applicazione web» → aggiungi URI di reindirizzamento:{" "}
                <span className="codice-mono break-all">
                  {window.location.origin}/api/oauth/gdrive/callback
                </span>
              </li>
              <li>
                Sul server imposta{" "}
                <span className="codice-mono">GOOGLE_OAUTH_CLIENT_ID</span> e{" "}
                <span className="codice-mono">GOOGLE_OAUTH_CLIENT_SECRET</span>{" "}
                con i valori del client e riavvia: comparirà qui il bottone
                «Collega Google Drive».
              </li>
            </ol>
            <p className="text-[11px] text-text-3 mt-1.5">
              Finché Drive non è collegato il backup notturno viene comunque
              eseguito e salvato sul disco del server (cartella{" "}
              <span className="codice-mono">backups/</span>).
            </p>
          </div>
        )}

        {!s.driveConfigurato && s.oauthClientReady && (
          <p className="text-xs text-text-2">
            Client OAuth configurato: premi{" "}
            <span className="font-medium text-text-1">
              «Collega Google Drive»
            </span>{" "}
            qui sopra, scegli l'account e autorizza. Da quel momento il backup
            notturno finisce su Drive.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Import Google calendars INTO the CRM (read-only overlay) ─────────────────
// The operator pastes the "Secret address in iCal format" of each Google
// calendar. The server fetches + parses them; the Planning view overlays the
// events. Multiple calendars supported.
function GoogleCalendarImport() {
  const list = trpc.externalCalendars.list.useQuery();
  const utils = trpc.useUtils();
  const [nome, setNome] = useState("");
  const [url, setUrl] = useState("");

  const add = trpc.externalCalendars.add.useMutation({
    onSuccess: () => {
      utils.externalCalendars.invalidate();
      setNome("");
      setUrl("");
      toast.success("Calendario aggiunto — comparirà nel calendario CRM");
    },
    onError: e => toast.error(e.message ?? "Aggiunta non riuscita"),
  });
  const remove = trpc.externalCalendars.remove.useMutation({
    onSuccess: () => utils.externalCalendars.invalidate(),
  });
  const update = trpc.externalCalendars.update.useMutation({
    onSuccess: () => utils.externalCalendars.invalidate(),
  });
  const refresh = trpc.externalCalendars.refresh.useMutation({
    onSuccess: () => {
      utils.externalCalendars.invalidate();
      toast.success("Aggiornamento richiesto");
    },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
              <Download className="h-5 w-5 text-blue-700" />
            </div>
            <div>
              <CardTitle className="text-base">
                Mostra Google nel calendario CRM
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Importa uno o più calendari Google: i loro eventi compaiono nel
                Calendario del CRM (sola lettura)
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            Aggiorna
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 border-t pt-4">
        <ol className="list-decimal pl-5 space-y-1 text-xs text-text-2">
          <li>
            In Google Calendar apri{" "}
            <span className="font-medium text-text-1">
              Impostazioni del calendario → Integra calendario
            </span>
            .
          </li>
          <li>
            Copia l'
            <span className="font-medium text-text-1">
              «Indirizzo segreto in formato iCal»
            </span>{" "}
            (finisce in <span className="codice-mono">.ics</span>).
          </li>
          <li>Incollalo qui sotto con un nome. Ripeti per ogni calendario.</li>
        </ol>

        {/* Add form */}
        <div className="flex gap-2 flex-wrap items-end">
          <div className="space-y-1 flex-1 min-w-[140px]">
            <Label className="text-xs">Nome</Label>
            <Input
              placeholder="Es. Squadra posa"
              value={nome}
              onChange={e => setNome(e.target.value)}
              className="h-9"
            />
          </div>
          <div className="space-y-1 flex-[2] min-w-[220px]">
            <Label className="text-xs">Indirizzo iCal (segreto)</Label>
            <Input
              placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
              value={url}
              onChange={e => setUrl(e.target.value)}
              className="h-9"
            />
          </div>
          <Button
            onClick={() =>
              add.mutate({ nome: nome.trim(), icsUrl: url.trim() })
            }
            disabled={!nome.trim() || !url.trim() || add.isPending}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Aggiungi
          </Button>
        </div>

        {/* Sources */}
        <div className="space-y-1.5">
          {(list.data ?? []).map((s: any) => (
            <div
              key={s.id}
              className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2"
            >
              <span
                className="h-3 w-3 rounded-full shrink-0"
                style={{ backgroundColor: s.color }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium truncate">{s.nome}</p>
                  {s.status === "error" ? (
                    <Badge variant="danger" className="text-[10px]">
                      Errore
                    </Badge>
                  ) : s.status === "ok" ? (
                    <Badge variant="success" className="text-[10px]">
                      Sincronizzato
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px]">
                      In attesa
                    </Badge>
                  )}
                  {!s.attivo && (
                    <Badge variant="outline" className="text-[10px]">
                      Nascosto
                    </Badge>
                  )}
                </div>
                <p className="codice-mono text-[10px] text-text-3 truncate">
                  {s.icsUrl}
                </p>
                {s.error && (
                  <p className="text-[10px] text-danger truncate">{s.error}</p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                title={
                  s.attivo ? "Nascondi dal calendario" : "Mostra nel calendario"
                }
                onClick={() => update.mutate({ id: s.id, attivo: !s.attivo })}
              >
                <Power
                  className={`h-3.5 w-3.5 ${s.attivo ? "text-success" : "text-text-3"}`}
                />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-danger"
                title="Rimuovi"
                onClick={() => remove.mutate(s.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          {(list.data?.length ?? 0) === 0 && !list.isLoading && (
            <p className="text-xs text-text-2 text-center py-3">
              Nessun calendario Google importato. Aggiungine uno qui sopra.
            </p>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground">
          Sola lettura: gli eventi Google appaiono nel calendario CRM ma non si
          modificano da qui. L'aggiornamento avviene ogni ~10 minuti.
        </p>
      </CardContent>
    </Card>
  );
}

// ── Google Calendar — subscribable ICS feeds (export CRM → Google) ───────────
function GoogleCalendarSync() {
  const feeds = trpc.calendarSync.feeds.useQuery();
  const utils = trpc.useUtils();
  const rotate = trpc.calendarSync.rotateToken.useMutation({
    onSuccess: () => {
      utils.calendarSync.feeds.invalidate();
      toast.success("Token ruotato — i vecchi link non funzionano più");
    },
    onError: e => toast.error(e.message ?? "Rotazione non riuscita"),
  });

  const [copied, setCopied] = useState<string | null>(null);

  function copyUrl(key: string, path: string) {
    const url = `${window.location.origin}${path}`;
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(key);
        toast.success("Link copiato — incollalo in Google Calendar");
        setTimeout(() => setCopied(null), 2000);
      })
      .catch(() => toast.error("Copia non riuscita"));
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-green-100 flex items-center justify-center">
              <Calendar className="h-5 w-5 text-green-700" />
            </div>
            <div>
              <CardTitle className="text-base">Google Calendar</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Feed iCal per sede — un calendario per ogni tipo di appuntamento
              </p>
            </div>
          </div>
          <Badge variant="success" className="gap-1">
            <CheckCircle2 className="h-3 w-3" />
            Attiva
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 border-t pt-4">
        {/* Step-by-step istruzioni */}
        <ol className="list-decimal pl-5 space-y-1 text-xs text-text-2">
          <li>Copia il link del calendario che vuoi sincronizzare.</li>
          <li>
            Apri Google Calendar →{" "}
            <span className="font-medium text-text-1">
              Altri calendari → + → Da URL
            </span>
            .
          </li>
          <li>
            Incolla il link e conferma: gli appuntamenti compaiono e si
            aggiornano da soli.
          </li>
          <li>Ripeti per ogni calendario che ti serve (rilievi, pose, …).</li>
        </ol>

        {/* Feed list */}
        <div className="space-y-1.5">
          {(feeds.data?.feeds ?? []).map(f => (
            <div
              key={f.key}
              className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2"
            >
              <Calendar className="h-4 w-4 text-text-3 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{f.label}</p>
                <p className="codice-mono text-[11px] text-text-3 truncate">
                  {window.location.origin}
                  {f.path}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => copyUrl(f.key, f.path)}
              >
                {copied === f.key ? (
                  <>
                    <Check className="h-3.5 w-3.5 mr-1 text-success" /> Copiato
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5 mr-1" /> Copia link
                  </>
                )}
              </Button>
            </div>
          ))}
          {feeds.isLoading && (
            <p className="text-xs text-text-2">Caricamento feed…</p>
          )}
        </div>

        <Separator />
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[11px] text-text-2 max-w-md">
            I link contengono un token segreto della sede. Se un link finisce
            nelle mani sbagliate, rigeneralo: tutte le iscrizioni esistenti
            smettono di funzionare.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => rotate.mutate()}
            disabled={rotate.isPending}
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            Rigenera token
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Sincronizzazione in sola lettura (app → Google). Google aggiorna i
          feed iscritti periodicamente, in genere entro poche ore.
        </p>
      </CardContent>
    </Card>
  );
}
