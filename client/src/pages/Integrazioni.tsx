import { Badge } from "@/components/ui/badge";
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
  ExternalLink,
  Calendar,
  ListTodo,
  RefreshCw,
  Truck,
  Users,
  Shield,
  Factory,
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
} from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { isDirezione } from "@/lib/roles";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

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
    icon: Factory,
    label: "Produzione",
    path: "/produzione",
    description: "Distinte base, fasi, non conformità",
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
            {GESTIONE_LINKS.map((link) => (
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
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <ListTodo className="h-5 w-5 text-blue-700" />
              </div>
              <div>
                <CardTitle className="text-base">Microsoft To Do</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Sincronizzazione task operativi bidirezionale
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
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
              <Switch checked={todoEnabled} onCheckedChange={setTodoEnabled} />
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
                  onChange={(e) =>
                    setTodoConfig({ ...todoConfig, clientId: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Tenant ID</Label>
                <Input
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  value={todoConfig.tenantId}
                  onChange={(e) =>
                    setTodoConfig({ ...todoConfig, tenantId: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Lista predefinita</Label>
              <Input
                value={todoConfig.defaultList}
                onChange={(e) =>
                  setTodoConfig({ ...todoConfig, defaultList: e.target.value })
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
                  <p className="text-sm font-medium">Creazione automatica task</p>
                  <p className="text-xs text-muted-foreground">
                    Crea task su To Do alla creazione di interventi, anomalie e ticket
                  </p>
                </div>
                <Switch
                  checked={todoConfig.autoCreateTasks}
                  onCheckedChange={(v) =>
                    setTodoConfig({ ...todoConfig, autoCreateTasks: v })
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Sincronizzazione bidirezionale</p>
                  <p className="text-xs text-muted-foreground">
                    Completando il task su To Do, lo stato si aggiorna nell'app
                  </p>
                </div>
                <Switch
                  checked={todoConfig.syncBidirectional}
                  onCheckedChange={(v) =>
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
              <Button variant="outline" size="sm" disabled={!todoConfig.clientId}>
                <RefreshCw className="h-3.5 w-3.5 mr-1" />
                Test connessione
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Richiede un'app registrata su Azure Active Directory con permessi Tasks.ReadWrite.
              Il token verrà gestito in modo sicuro dal server con refresh automatico.
            </p>
          </CardContent>
        )}
      </Card>

      {/* Backup notturno su Google Drive */}
      <BackupDrive />

      {/* Mostra i calendari Google dentro al CRM (import) */}
      <GoogleCalendarImport />

      {/* Pubblica il calendario del CRM su Google (export feeds) */}
      <GoogleCalendarSync />

      {/* Info */}
      <Card className="bg-muted/30">
        <CardContent className="p-4">
          <h4 className="text-sm font-semibold mb-2">Come funzionano le integrazioni</h4>
          <div className="space-y-2 text-xs text-muted-foreground">
            <p>
              <strong>Microsoft To Do:</strong> Alla creazione di un intervento, anomalia o ticket,
              viene generato un task con deep link alla risorsa. Le checklist di posa vengono
              mappate come sotto-task. Lo stato si sincronizza in entrambe le direzioni.
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
    onError: (e) => toast.error(e.message ?? "Backup fallito"),
  });
  const updateCfg = trpc.backup.updateConfig.useMutation({
    onSuccess: () => {
      utils.backup.invalidate();
      setFolderId(null);
      toast.success("Impostazioni backup salvate");
    },
  });

  // Hidden for non-direzione (the procedures are admin-only).
  if (status.error) return null;
  const s = status.data;
  if (!s) return null;

  const last = s.ultimoBackup;
  const nextMin = s.prossimoTraMs != null ? Math.round(s.prossimoTraMs / 60000) : null;
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
          {s.driveConfigurato ? (
            <>
              <Badge variant="success">Drive collegato</Badge>
              <span className="codice-mono text-[11px] text-text-3 truncate">
                {s.serviceAccountEmail}
              </span>
            </>
          ) : (
            <Badge variant="warning">
              Drive non collegato — backup salvato in locale
            </Badge>
          )}
          {nextMin != null && (
            <span className="text-xs text-text-2">
              Prossimo backup automatico tra ~
              {nextMin >= 60 ? `${Math.floor(nextMin / 60)}h ${nextMin % 60}m` : `${nextMin}m`}
            </span>
          )}
        </div>

        {last && (
          <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-xs space-y-0.5">
            <p>
              <span className="font-semibold">Ultimo backup:</span>{" "}
              {new Date(last.startedAt).toLocaleString("it-IT")} ·{" "}
              {last.ok == null ? (
                <Badge variant="secondary" className="text-[10px]">in corso</Badge>
              ) : last.ok ? (
                <Badge variant="success" className="text-[10px]">
                  riuscito ({last.target === "drive" ? "Drive" : "locale"})
                </Badge>
              ) : (
                <Badge variant="danger" className="text-[10px]">fallito</Badge>
              )}
            </p>
            <p className="text-text-2">
              {last.rootName} — {last.files} file,{" "}
              {(last.bytes / 1024 / 1024).toFixed(1)} MB
            </p>
            {last.error && <p className="text-danger">{last.error}</p>}
          </div>
        )}

        <div className="flex gap-2 items-end flex-wrap">
          <div className="space-y-1 flex-1 min-w-[260px]">
            <Label className="text-xs">ID cartella Google Drive di destinazione</Label>
            <Input
              value={folderValue}
              onChange={(e) => setFolderId(e.target.value)}
              className="h-9 font-mono text-xs"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={folderId == null || folderId.trim() === s.folderId || updateCfg.isPending}
            onClick={() => folderId && updateCfg.mutate({ folderId: folderId.trim() })}
          >
            Salva
          </Button>
        </div>

        {!s.driveConfigurato && (
          <div className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2.5">
            <p className="text-xs font-semibold mb-1">
              Per collegare Google Drive (una sola volta):
            </p>
            <ol className="list-decimal pl-5 space-y-1 text-xs text-text-2">
              <li>
                Su <span className="font-medium text-text-1">console.cloud.google.com</span>{" "}
                crea un progetto, abilita l'API «Google Drive» e crea un{" "}
                <span className="font-medium text-text-1">Service Account</span> con chiave JSON.
              </li>
              <li>
                Condividi la cartella Drive di destinazione con l'email del
                service account (ruolo <span className="font-medium text-text-1">Editor</span>).
              </li>
              <li>
                Sul server imposta la variabile{" "}
                <span className="codice-mono">GOOGLE_SERVICE_ACCOUNT_JSON</span>{" "}
                (contenuto del file JSON) oppure{" "}
                <span className="codice-mono">GOOGLE_SERVICE_ACCOUNT_FILE</span>{" "}
                (percorso del file) e riavvia.
              </li>
            </ol>
            <p className="text-[11px] text-text-3 mt-1.5">
              Finché Drive non è collegato il backup notturno viene comunque
              eseguito e salvato sul disco del server (cartella{" "}
              <span className="codice-mono">backups/</span>).
            </p>
          </div>
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
    onError: (e) => toast.error(e.message ?? "Aggiunta non riuscita"),
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
              onChange={(e) => setNome(e.target.value)}
              className="h-9"
            />
          </div>
          <div className="space-y-1 flex-[2] min-w-[220px]">
            <Label className="text-xs">Indirizzo iCal (segreto)</Label>
            <Input
              placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="h-9"
            />
          </div>
          <Button
            onClick={() => add.mutate({ nome: nome.trim(), icsUrl: url.trim() })}
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
                title={s.attivo ? "Nascondi dal calendario" : "Mostra nel calendario"}
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
    onError: (e) => toast.error(e.message ?? "Rotazione non riuscita"),
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
          <li>Incolla il link e conferma: gli appuntamenti compaiono e si aggiornano da soli.</li>
          <li>Ripeti per ogni calendario che ti serve (rilievi, pose, …).</li>
        </ol>

        {/* Feed list */}
        <div className="space-y-1.5">
          {(feeds.data?.feeds ?? []).map((f) => (
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
