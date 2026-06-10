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

      {/* Google Calendar — subscribable ICS feeds */}
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

// ── Google Calendar — subscribable ICS feeds ─────────────────────────────────
// Real, working one-way sync (app → Google) with no Google Cloud setup: each
// sede exposes tokenized iCal URLs, one per appointment type plus "tutti".
// The operator subscribes in Google Calendar via "Altri calendari → Da URL";
// Google then polls the feed and keeps events updated.
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
