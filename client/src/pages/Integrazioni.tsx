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
        <p className="text-xs text-muted-foreground mt-1">
          Caselle email, WhatsApp, Fatture in Cloud e Tars valgono{" "}
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
          <TarsCard />
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

// ── Tars — l'agente operativo ────────────────────────────────────────────────
// L'interruttore che spegne tutto in tre secondi. Off = il CRM funziona
// esattamente come prima; Tars legge dati e crea proposte solo quando è on.
// Sol gestisce le analisi profonde; Terra i lavori automatici; 5.4 mini resta
// disponibile quando il volume conta più della profondità.
const ETICHETTA_MODELLO: Record<string, string> = {
  "gpt-5.6-sol": "GPT-5.6 Sol — analisi profonde",
  "gpt-5.6-terra": "GPT-5.6 Terra — equilibrato",
  "gpt-5.4-mini": "GPT-5.4 mini — economico",
};

// Autonomia di Tars — la delega di firma della direzione.
//
// Tre decisioni, e sono tutte esplicite di proposito: se accendere, chi ne
// risponde, e su cosa. I tipi irreversibili non compaiono nell'elenco perché
// il server non li accetterebbe comunque: mostrarli disabilitati farebbe
// credere che siano una scelta.
const ETICHETTA_TIPO_PROPOSTA: Record<string, string> = {
  collega_comunicazione: "Collegare email e WhatsApp alle commesse",
  crea_lead: "Creare cliente e prima commessa da un contatto",
  collega_fattura: "Collegare le fatture FiC alle commesse",
  archivia_allegato: "Archiviare allegati nel fascicolo",
  rinomina_documento: "Rinominare e riclassificare documenti",
  nota_timeline: "Scrivere note sulla timeline",
  aggiornamento_magazzino: "Aggiornare consegne a magazzino",
  modifica_cliente: "Correggere l'anagrafica cliente",
  modifica_commessa: "Aggiornare i dati di una commessa",
  ticket: "Aprire ticket post-vendita",
  pagamento: "Registrare pagamenti",
  correzione_pagamento: "Correggere pagamenti discordanti",
  avanzamento_stato: "Avanzare lo stato di una commessa",
  bozza_risposta: "Preparare bozze di risposta",
  segnalazione: "Aprire segnalazioni",
  miglioramento_processo: "Avviare esperimenti di processo",
  promemoria: "Creare promemoria personali",
};

function AutonomiaTars({
  autonomia,
  inCorso,
  onChange,
}: {
  autonomia: any;
  inCorso: boolean;
  onChange: (patch: {
    attiva?: boolean;
    killSwitch?: boolean;
    tipiConsentiti?: string[];
    principalUserId?: number | null;
  }) => void;
}) {
  const consentiti: string[] = autonomia.tipiConsentiti ?? [];
  const ammessi: string[] = autonomia.tipiAmmessi ?? [];
  const responsabili: Array<{ id: number; nome: string }> =
    autonomia.responsabili ?? [];
  const pronta =
    autonomia.attiva &&
    !autonomia.killSwitch &&
    autonomia.principalUserId != null &&
    consentiti.length > 0;

  const commuta = (tipo: string) =>
    onChange({
      tipiConsentiti: consentiti.includes(tipo)
        ? consentiti.filter(t => t !== tipo)
        : [...consentiti, tipo],
    });

  return (
    <div className="rounded-md border p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-medium">Autonomia operativa</p>
          <p className="text-xs text-muted-foreground">
            {pronta
              ? `Tars esegue da solo ${consentiti.length} tipi di azione e li riepiloga in chat.`
              : "Ogni proposta attende l'approvazione di un operatore."}
          </p>
        </div>
        <Switch
          aria-label="Attiva l'autonomia operativa di Tars"
          checked={autonomia.attiva === true}
          disabled={inCorso}
          onCheckedChange={v => onChange({ attiva: v })}
        />
      </div>

      {autonomia.attiva && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground w-36">
              Ne risponde:
            </span>
            <select
              aria-label="Utente responsabile delle azioni autonome"
              className="h-8 rounded-md border bg-background px-2 text-xs"
              value={autonomia.principalUserId ?? ""}
              disabled={inCorso}
              onChange={e =>
                onChange({
                  principalUserId: e.target.value
                    ? Number(e.target.value)
                    : null,
                })
              }
            >
              <option value="">Nessuno (autonomia sospesa)</option>
              {responsabili.map(r => (
                <option key={r.id} value={r.id}>
                  {r.nome}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">
              le azioni usano i suoi permessi
            </span>
          </div>

          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">
              Blocco d&apos;emergenza: nega tutto senza perdere la
              configurazione
            </span>
            <Switch
              aria-label="Blocco d'emergenza dell'autonomia"
              checked={autonomia.killSwitch === true}
              disabled={inCorso}
              onCheckedChange={v => onChange({ killSwitch: v })}
            />
          </div>

          <fieldset className="space-y-1.5">
            <legend className="text-xs text-muted-foreground mb-1">
              Cosa può fare da solo
            </legend>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {ammessi.map(tipo => (
                <label
                  key={tipo}
                  className="flex items-start gap-2 text-xs cursor-pointer"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={consentiti.includes(tipo)}
                    disabled={inCorso}
                    onChange={() => commuta(tipo)}
                  />
                  <span>{ETICHETTA_TIPO_PROPOSTA[tipo] ?? tipo}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <p className="text-xs text-muted-foreground">
            Chiusura di una commessa ed eliminazioni restano sempre da
            approvare: non hanno un ritorno.
          </p>
        </>
      )}
    </div>
  );
}

function TarsCard() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const config = trpc.tars.config.get.useQuery(undefined, { retry: false });
  const setModello = trpc.tars.config.setModello.useMutation({
    onSuccess: () => {
      toast.success("Modello aggiornato");
      utils.tars.config.invalidate();
    },
    onError: e => toast.error(e.message),
  });
  const setBudget = trpc.tars.config.setBudget.useMutation({
    onSuccess: r => {
      toast.success(
        r.budgetMensileUsd > 0
          ? `Budget mensile: $${r.budgetMensileUsd}`
          : "Budget mensile: nessun tetto"
      );
      utils.tars.config.invalidate();
    },
    onError: e => toast.error(e.message),
  });
  const setAttivo = trpc.tars.config.setAttivo.useMutation({
    onSuccess: r => {
      toast.success(r.attivo ? "Tars attivato" : "Tars spento");
      utils.tars.config.invalidate();
    },
    onError: e => toast.error(e.message),
  });
  const setAutonomia = trpc.tars.config.setAutonomia.useMutation({
    onSuccess: () => {
      toast.success("Autonomia aggiornata");
      utils.tars.config.invalidate();
    },
    onError: e => toast.error(e.message),
  });
  const setAuditProcessi = trpc.tars.config.setAuditProcessi.useMutation({
    onSuccess: r => {
      toast.success(
        r.auditProcessiAttivo
          ? "Audit processi attivato"
          : "Audit processi disattivato"
      );
      utils.tars.config.invalidate();
    },
    onError: e => toast.error(e.message),
  });
  const [, setLocation] = useLocation();

  const attivo = config.data?.attivo ?? false;
  const spesa = config.data?.spesaMeseUsd ?? 0;
  const budget = config.data?.budgetMensileUsd ?? 0;
  const sopraBudget = budget > 0 && spesa >= budget;
  const chiaveOk = config.data?.chiaveConfigurata ?? false;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="flex items-center gap-2 text-base">
            Tars — agente operativo
            {attivo ? (
              <Badge className="bg-green-600 hover:bg-green-600">Attivo</Badge>
            ) : (
              <Badge variant="secondary">Spento</Badge>
            )}
          </CardTitle>
          {isDirezione(user) && (
            <Switch
              aria-label="Accendi o spegni Tars"
              checked={attivo}
              disabled={setAttivo.isPending || (!attivo && !chiaveOk)}
              onCheckedChange={v => setAttivo.mutate({ attivo: v })}
            />
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Analizza commesse e comunicazioni e propone azioni — registrazioni,
          note, collegamenti, avanzamenti. Ogni azione passa dagli stessi
          controlli di un'operazione manuale (doc gate, permessi, scope sede).
          Senza autonomia attiva ogni proposta attende un click;{" "}
          <strong>
            con l'autonomia attiva i tipi scelti vengono eseguiti subito e
            riepilogati nella chat aziendale.
          </strong>
        </p>
        {!chiaveOk && (
          <div className="flex items-center gap-2 text-amber-600 dark:text-amber-500 text-xs">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>
              <code>OPENAI_API_KEY</code> non configurata nelle variabili
              d'ambiente del server. Senza chiave Tars non può accendersi.
            </span>
          </div>
        )}
        <div className="flex gap-2 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setLocation("/tars")}
          >
            Coda proposte
            <ArrowRight className="h-3.5 w-3.5 ml-1" />
          </Button>
          {isDirezione(user) && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setLocation("/conoscenza")}
            >
              Conoscenza aziendale
              <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          )}
        </div>
        {/* Spesa del mese contro il budget: la barra è il colpo d'occhio,
            il numero è la verità. Stima dai token, non la fattura. */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              Spesa stimata del mese
            </span>
            <span className={sopraBudget ? "text-destructive font-medium" : ""}>
              ${spesa.toFixed(2)}
              {budget > 0 ? ` / $${budget}` : " (nessun tetto)"}
            </span>
          </div>
          {budget > 0 && (
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full ${sopraBudget ? "bg-destructive" : "bg-primary"}`}
                style={{ width: `${Math.min(100, (spesa / budget) * 100)}%` }}
              />
            </div>
          )}
          {sopraBudget && (
            <p className="text-xs text-destructive">
              Budget esaurito: i lavori automatici sono fermi e le analisi
              manuali vengono rifiutate finché il tetto non viene alzato o il
              mese non cambia.
            </p>
          )}
        </div>

        {isDirezione(user) && config.data?.autonomia && (
          <AutonomiaTars
            autonomia={config.data.autonomia}
            inCorso={setAutonomia.isPending}
            onChange={patch => setAutonomia.mutate(patch as any)}
          />
        )}

        {isDirezione(user) ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground w-36">
                Modello (analisi e chat):
              </span>
              <select
                aria-label="Modello per analisi e chat"
                className="h-8 rounded-md border bg-background px-2 text-xs"
                value={config.data?.modello ?? ""}
                disabled={setModello.isPending}
                onChange={e =>
                  setModello.mutate({ modello: e.target.value as any })
                }
              >
                {(config.data?.modelliDisponibili ?? []).map(m => (
                  <option key={m} value={m}>
                    {ETICHETTA_MODELLO[m] ?? m}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground w-36">
                Modello lavori automatici:
              </span>
              <select
                aria-label="Modello per i lavori automatici"
                className="h-8 rounded-md border bg-background px-2 text-xs"
                value={config.data?.modelloAutomatico ?? ""}
                disabled={setModello.isPending}
                onChange={e =>
                  setModello.mutate({
                    modello: e.target.value as any,
                    automatico: true,
                  })
                }
              >
                {(config.data?.modelliDisponibili ?? []).map(m => (
                  <option key={m} value={m}>
                    {ETICHETTA_MODELLO[m] ?? m}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground">
                smistamento, fatture e audit
              </span>
            </div>
            <div className="flex min-h-8 items-center gap-3">
              <span className="text-xs text-muted-foreground w-36">
                Audit processi:
              </span>
              <Switch
                aria-label="Audit giornaliero dei processi"
                checked={config.data?.auditProcessiAttivo ?? false}
                disabled={setAuditProcessi.isPending || !attivo}
                onCheckedChange={valore =>
                  setAuditProcessi.mutate({ attivo: valore })
                }
              />
              <span className="text-xs text-muted-foreground">
                {config.data?.ultimoAuditProcessiAt
                  ? `ultimo ${new Date(config.data.ultimoAuditProcessiAt).toLocaleString("it-IT")}`
                  : "non ancora eseguito"}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground w-36">
                Budget mensile ($):
              </span>
              <Input
                aria-label="Budget mensile di Tars in dollari"
                type="number"
                min={0}
                step={5}
                defaultValue={budget}
                key={budget}
                className="h-8 w-24 text-xs"
                disabled={setBudget.isPending}
                onBlur={e => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v >= 0 && v !== budget) {
                    setBudget.mutate({ budgetMensileUsd: v });
                  }
                }}
              />
              <span className="text-xs text-muted-foreground">
                0 = nessun tetto
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {config.data?.maxToolCalls ?? "—"} strumenti,{" "}
              {Math.round((config.data?.timeoutMs ?? 0) / 1000)}s,{" "}
              {config.data?.maxProposte ?? "—"} proposte per esecuzione
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Modello:{" "}
            {ETICHETTA_MODELLO[config.data?.modello ?? ""] ??
              config.data?.modello ??
              "—"}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Fatture in Cloud → clienti automatici ────────────────────────────────────
// Every 6h (or on demand) the CRM reads the year's issued invoices and
// creates any client that's still missing — keeps the anagrafica aligned
// with the fatturazione without manual imports.
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
