// /comunicazioni — la posta dentro il CRM, leggibile come in un client
// di posta: lista a sinistra, messaggio aperto a destra (su mobile una
// vista alla volta). Aprire una mail la segna come vista. Dove Tars ha
// una proposta pendente, il suo avatar è sulla riga e la proposta è nel
// pannello di lettura.

import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import SearchSelect from "@/components/SearchSelect";
import ConfirmDialog from "@/components/ConfirmDialog";
import TarsAvatar from "@/components/TarsAvatar";
import TarsPropostaCard from "@/components/TarsPropostaCard";
import CaselleEmailCard from "@/components/CaselleEmailCard";
import { useAuth } from "@/_core/hooks/useAuth";
import { isDirezione } from "@/lib/roles";
import { useIsMobile } from "@/hooks/useMobile";
import {
  ArrowLeft,
  AlertTriangle,
  CheckCheck,
  Bot,
  BriefcaseBusiness,
  Inbox,
  Link2,
  Mail,
  MessageCircle,
  Paperclip,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  Loader2,
  Megaphone,
  Send,
  ShieldBan,
  Sparkles,
  Tags,
  UserPlus,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDeferredValue, useMemo, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const CATEGORIE = [
  "operativa",
  "nuovo_lead",
  "amministrativa",
  "fornitore",
  "da_classificare",
  "offerta_marketing",
  "spam",
] as const;
type Categoria = (typeof CATEGORIE)[number];
type Filtro = "da_gestire" | "non_collegate" | "lead" | "gestite" | "escluse";

const CATEGORIA_UI: Record<Categoria, { label: string; className: string }> = {
  operativa: {
    label: "Operativa",
    className: "border-success/25 bg-success/10 text-success",
  },
  nuovo_lead: {
    label: "Nuovo lead",
    className: "border-primary/25 bg-primary/10 text-primary",
  },
  amministrativa: {
    label: "Amministrativa",
    className: "border-info/25 bg-info/10 text-info",
  },
  fornitore: {
    label: "Fornitore",
    className: "border-warning/30 bg-warning/10 text-warning-foreground",
  },
  da_classificare: {
    label: "Da classificare",
    className: "border-border-strong bg-surface-2 text-text-2",
  },
  offerta_marketing: {
    label: "Newsletter inutile",
    className: "border-warning/30 bg-warning/10 text-warning-foreground",
  },
  spam: {
    label: "Spam",
    className: "border-destructive/25 bg-destructive/10 text-destructive",
  },
};

const FILTRO_LABEL: Record<Filtro, string> = {
  da_gestire: "Da gestire",
  non_collegate: "Non collegate",
  lead: "Nuovi lead",
  gestite: "Gestite",
  escluse: "Escluse",
};

// ── Utilità ─────────────────────────────────────────────────────────────────

function oraBreve(d: string | Date): string {
  const data = new Date(d);
  const oggi = new Date();
  const stessoGiorno =
    data.getDate() === oggi.getDate() &&
    data.getMonth() === oggi.getMonth() &&
    data.getFullYear() === oggi.getFullYear();
  if (stessoGiorno) {
    return data.toLocaleTimeString("it-IT", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return data.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
}

function iniziali(c: any): string {
  const nome = (c.mittenteNome ?? c.mittente ?? "?").trim();
  const parti = nome.split(/[\s@.]+/).filter(Boolean);
  return ((parti[0]?.[0] ?? "?") + (parti[1]?.[0] ?? "")).toUpperCase();
}

function anteprima(c: any): string {
  const testo = String(c.testo ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (testo) return testo;
  return c.canale === "whatsapp"
    ? "Messaggio senza testo"
    : "Nessuna anteprima";
}

function dimensioneFile(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function attesaBreve(d: string | Date | null | undefined): string | null {
  if (!d) return null;
  const minuti = Math.max(
    0,
    Math.floor((Date.now() - new Date(d).getTime()) / 60_000)
  );
  if (minuti < 1) return "meno di un minuto";
  if (minuti < 60) return `${minuti} min`;
  const ore = Math.floor(minuti / 60);
  if (ore < 24) return `${ore} ${ore === 1 ? "ora" : "ore"}`;
  const giorni = Math.floor(ore / 24);
  return `${giorni} ${giorni === 1 ? "giorno" : "giorni"}`;
}

function CategoriaBadge({
  categoria,
  fonte,
  analizzata,
}: {
  categoria: Categoria;
  fonte?: string | null;
  analizzata?: boolean;
}) {
  const meta = CATEGORIA_UI[categoria] ?? CATEGORIA_UI.da_classificare;
  const inAttesa = categoria === "da_classificare" && analizzata === false;
  const dubbioTars = categoria === "da_classificare" && fonte === "tars";
  return (
    <Badge
      variant="outline"
      className={cn("h-5 px-1.5 text-[10px]", meta.className)}
    >
      {inAttesa ? "In attesa di Tars" : dubbioTars ? "Dubbio Tars" : meta.label}
    </Badge>
  );
}

// Indicatore del canale: verde WhatsApp, neutro email. Su una lista mista
// serve capire a colpo d'occhio da dove arriva un messaggio.
function IconaCanale({
  canale,
  className,
}: {
  canale: string;
  className?: string;
}) {
  if (canale === "whatsapp") {
    return (
      <MessageCircle
        className={cn("h-3.5 w-3.5 text-success", className)}
        aria-label="WhatsApp"
      />
    );
  }
  return (
    <Mail
      className={cn("h-3.5 w-3.5 text-muted-foreground", className)}
      aria-label="Email"
    />
  );
}

// ── Riga in lista ───────────────────────────────────────────────────────────

function Riga({
  c,
  selezionata,
  haPropostaTars,
  scelta,
  onScelta,
  onClick,
}: {
  c: any;
  selezionata: boolean;
  haPropostaTars: boolean;
  scelta: boolean;
  onScelta: (checked: boolean) => void;
  onClick: () => void;
}) {
  const nuova = c.stato === "nuova";
  return (
    <div
      className={cn(
        "group relative flex min-h-[96px] w-full items-start border-b border-border-soft",
        selezionata
          ? "bg-accent/70"
          : nuova
            ? "bg-primary-soft/35 hover:bg-primary-soft/55"
            : "bg-card hover:bg-muted/65"
      )}
    >
      {nuova && (
        <span
          className="absolute inset-y-3 left-0 w-[3px] rounded-r-full bg-accent-brand"
          aria-hidden="true"
        />
      )}
      <div className="relative z-[1] flex w-9 shrink-0 justify-center pt-4">
        <Checkbox
          checked={scelta}
          onCheckedChange={v => onScelta(v === true)}
          aria-label={`Seleziona ${c.oggetto || c.mittente}`}
        />
      </div>
      <button
        onClick={onClick}
        aria-current={selezionata ? "true" : undefined}
        className="flex min-w-0 flex-1 items-start gap-3 py-3 pr-3.5 text-left transition-colors duration-fast focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <div
          className={cn(
            "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-xs font-bold",
            nuova
              ? "bg-primary text-primary-foreground shadow-xs"
              : "bg-surface-2 text-text-2"
          )}
        >
          {iniziali(c)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span
              className={cn(
                "flex min-w-0 items-center gap-1.5 truncate text-sm",
                nuova
                  ? "font-bold text-foreground"
                  : "font-semibold text-text-2"
              )}
            >
              <IconaCanale canale={c.canale} />
              <span className="truncate">{c.mittenteNome ?? c.mittente}</span>
            </span>
            <span
              className={cn(
                "shrink-0 text-[11px] tabular-nums",
                nuova ? "font-bold text-accent-text" : "text-text-3"
              )}
            >
              {oraBreve(c.receivedAt)}
            </span>
          </div>
          <div
            className={cn(
              "mt-0.5 truncate text-sm",
              nuova ? "font-semibold text-foreground" : "text-text-2"
            )}
          >
            {c.oggetto ||
              (c.canale === "whatsapp" ? c.testo : "") ||
              "(senza oggetto)"}
          </div>
          <p className="mt-0.5 line-clamp-1 text-xs leading-5 text-text-3">
            {anteprima(c)}
          </p>
          <div className="mt-1 flex min-h-5 flex-wrap items-center gap-1.5 text-[11px] text-text-3">
            <CategoriaBadge
              categoria={c.categoria ?? "da_classificare"}
              fonte={c.classificazioneFonte}
              analizzata={c.tarsAnalizzata}
            />
            {c.allegati?.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <Paperclip className="h-3 w-3" />
                {c.allegati.length}
              </span>
            )}
            {c.commessaId != null && (
              <span className="inline-flex items-center gap-1 text-success">
                <Link2 className="h-3 w-3" />
                Collegata
              </span>
            )}
            {haPropostaTars && <TarsAvatar size="sm" className="h-4 w-4" />}
            {c.stato === "gestita" && (
              <CheckCheck
                className="ml-auto h-3.5 w-3.5 text-success"
                aria-label="Gestita"
              />
            )}
          </div>
        </div>
      </button>
    </div>
  );
}

// ── Pannello di lettura ─────────────────────────────────────────────────────

function Lettura({
  c,
  proposteTars,
  onChiudi,
  mobile,
  puoGestireRegole,
}: {
  c: any;
  proposteTars: any[];
  onChiudi: () => void;
  mobile: boolean;
  puoGestireRegole: boolean;
}) {
  const utils = trpc.useUtils();
  const [collegaAperto, setCollegaAperto] = useState(false);
  const [commessaScelta, setCommessaScelta] = useState<string | null>(null);
  const [confermaElimina, setConfermaElimina] = useState(false);
  const [esclusione, setEsclusione] = useState<
    "spam" | "offerta_marketing" | null
  >(null);
  const [istruzione, setIstruzione] = useState("");
  const [ultimoRiepilogo, setUltimoRiepilogo] = useState<string | null>(null);
  const commesse = trpc.commesse.list.useQuery(undefined, {
    enabled: collegaAperto,
  });
  const commessa = trpc.commesse.byId.useQuery(c.commessaId ?? 0, {
    enabled: c.commessaId != null,
  });
  const opzioniCaselle = trpc.mail.caselle.opzioni.useQuery();
  const casella = (opzioniCaselle.data ?? []).find(
    (k: any) => k.id === c.casellaId
  );

  const invalidate = () => utils.mail.comunicazioni.invalidate();
  const collega = trpc.mail.comunicazioni.collega.useMutation({
    onSuccess: () => {
      toast.success("Collegata");
      setCollegaAperto(false);
      setCommessaScelta(null);
      invalidate();
    },
    onError: e => toast.error(e.message),
  });
  const setStato = trpc.mail.comunicazioni.setStato.useMutation({
    onSuccess: invalidate,
    onError: e => toast.error(e.message),
  });
  const setCategoria = trpc.mail.comunicazioni.setCategoria.useMutation({
    onSuccess: () => {
      toast.success("Classificazione aggiornata");
      setEsclusione(null);
      invalidate();
    },
    onError: e => toast.error(e.message),
  });
  const elimina = trpc.mail.comunicazioni.delete.useMutation({
    onSuccess: () => {
      toast.success("Eliminata dal CRM — resta nella casella di posta");
      setConfermaElimina(false);
      onChiudi();
      invalidate();
    },
    onError: e => toast.error(e.message),
  });
  const affidaATars = trpc.tars.analizzaComunicazione.useMutation({
    onSuccess: r => {
      setUltimoRiepilogo(r.riepilogo);
      setIstruzione("");
      toast.success(
        r.proposte.length > 0
          ? `${r.proposte.length} ${r.proposte.length === 1 ? "proposta pronta" : "proposte pronte"}`
          : "Analisi completata"
      );
      utils.tars.proposte.invalidate();
      invalidate();
    },
    onError: e => toast.error(e.message),
  });

  const scegliCategoria = (categoria: Categoria) => {
    if (categoria === "spam" || categoria === "offerta_marketing") {
      setEsclusione(categoria);
      return;
    }
    setCategoria.mutate({ id: c.id, categoria });
  };

  const preset =
    c.commessaId == null
      ? [
          {
            label: "Crea lead",
            icon: UserPlus,
            testo:
              "Verifica che non esistano già cliente e commessa. Se è una richiesta reale, mostrami gli assegnatari e chiedimi a chi affidarla; solo dopo prepara cliente, commessa in preventivo e collegamento della comunicazione.",
          },
          {
            label: "Apri ticket",
            icon: BriefcaseBusiness,
            testo:
              "Valuta il contenuto e prepara un ticket senza commessa se serve una presa in carico, indicando priorità e contatto.",
          },
          {
            label: "Prepara risposta",
            icon: Send,
            testo:
              "Verifica il contesto e prepara una risposta professionale. Non inventare date, prezzi o impegni.",
          },
        ]
      : [
          {
            label: "Aggiorna commessa",
            icon: BriefcaseBusiness,
            testo:
              "Leggi la commessa collegata e proponi gli aggiornamenti operativi necessari in base a questa comunicazione.",
          },
          {
            label: "Prepara risposta",
            icon: Send,
            testo:
              "Controlla il fascicolo della commessa e prepara una risposta coerente con lo stato reale.",
          },
          {
            label: "Analizza allegati",
            icon: Paperclip,
            testo:
              "Analizza gli allegati operativi, confrontali con la commessa e proponi soltanto le azioni supportate dai documenti.",
          },
        ];

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-card">
      <div className="shrink-0 border-b border-border-soft px-4 py-4 sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          {mobile && (
            <Button
              size="icon"
              variant="ghost"
              className="-ml-2 size-10"
              onClick={onChiudi}
              aria-label="Torna all'elenco"
              title="Torna all'elenco"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          )}
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground shadow-xs">
            {iniziali(c)}
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <IconaCanale canale={c.canale} className="h-4 w-4 shrink-0" />
              <span className="truncate text-sm font-bold text-foreground">
                {c.mittenteNome ?? c.mittente}
              </span>
              <CategoriaBadge
                categoria={c.categoria ?? "da_classificare"}
                fonte={c.classificazioneFonte}
                analizzata={c.tarsAnalizzata}
              />
            </div>
            {c.mittenteNome && (
              <div className="truncate text-xs text-text-3">{c.mittente}</div>
            )}
            <div className="text-xs leading-5 text-text-3">
              {new Date(c.receivedAt).toLocaleString("it-IT")}
              {c.canale === "email" && casella
                ? ` · ricevuta su ${casella.nome} (${casella.indirizzo})`
                : ""}
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="size-10 sm:size-9"
              aria-label={
                c.stato === "gestita"
                  ? "Riapri comunicazione"
                  : "Segna come gestita"
              }
              title={c.stato === "gestita" ? "Gestita" : "Segna come gestita"}
              onClick={() =>
                setStato.mutate({
                  id: c.id,
                  stato: c.stato === "gestita" ? "vista" : "gestita",
                })
              }
            >
              <CheckCheck
                className={cn(
                  "h-4 w-4",
                  c.stato === "gestita" && "text-success"
                )}
              />
            </Button>
            <Button
              size="icon"
              variant="dangerGhost"
              className="size-10 sm:size-9"
              aria-label="Elimina dal CRM"
              title="Elimina dal CRM"
              onClick={() => setConfermaElimina(true)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <h2 className="mt-4 break-words text-lg font-bold leading-snug text-foreground">
          {c.oggetto ||
            (c.canale === "whatsapp"
              ? "Messaggio WhatsApp"
              : "(senza oggetto)")}
        </h2>
      </div>

      <div className="shrink-0 border-b border-border-soft bg-surface-2/65 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            {c.commessaId != null ? (
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Link
                  href={`/commesse/${c.commessaId}`}
                  className="inline-flex min-w-0 items-center gap-1.5 text-sm font-semibold text-accent-text hover:underline"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  <span className="truncate">
                    {commessa.data?.codice ?? `Commessa #${c.commessaId}`}
                    {commessa.data?.cliente
                      ? ` · ${commessa.data.cliente}`
                      : ""}
                  </span>
                </Link>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs"
                  onClick={() => collega.mutate({ id: c.id, commessaId: null })}
                >
                  Scollega
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="h-9"
                onClick={() => setCollegaAperto(v => !v)}
              >
                <Link2 className="h-3.5 w-3.5" />
                Collega a una commessa
              </Button>
            )}
          </div>
          <Select
            value={c.categoria ?? "da_classificare"}
            onValueChange={v => scegliCategoria(v as Categoria)}
          >
            <SelectTrigger
              className="h-9 w-full sm:w-[180px]"
              aria-label="Classificazione"
            >
              <Tags className="h-3.5 w-3.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIE.map(cat => (
                <SelectItem key={cat} value={cat}>
                  {CATEGORIA_UI[cat].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {collegaAperto && (
          <div className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row">
            <div className="min-w-0 flex-1">
              <SearchSelect
                value={commessaScelta}
                onChange={(v: string) => setCommessaScelta(v)}
                options={(commesse.data ?? []).map((cm: any) => ({
                  value: String(cm.id),
                  label: `${cm.codice} — ${cm.cliente}`,
                  keywords: cm.citta ?? "",
                }))}
                placeholder="Cerca codice, cliente o città…"
              />
            </div>
            <Button
              className="shrink-0"
              disabled={!commessaScelta || collega.isPending}
              onClick={() =>
                collega.mutate({ id: c.id, commessaId: Number(commessaScelta) })
              }
            >
              {collega.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Link2 className="h-4 w-4" />
              )}
              Conferma collegamento
            </Button>
          </div>
        )}
        {c.classificazioneMotivo && (
          <div className="mt-2 flex items-start gap-2 rounded-md border border-border-soft bg-surface-2/60 px-3 py-2">
            <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <div className="min-w-0 text-xs leading-5 text-text-2">
              <span className="font-semibold text-foreground">
                {c.classificazioneFonte === "tars"
                  ? c.categoria === "da_classificare"
                    ? "Tars chiede una verifica"
                    : `Classificata da Tars · ${c.classificazioneScore}%`
                  : c.tarsAnalizzata
                    ? "Classificazione preliminare"
                    : "In attesa di Tars"}
              </span>{" "}
              {c.classificazioneMotivo}
            </div>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="border-b border-primary/15 bg-[image:var(--gradient-soft)] px-4 py-4 sm:px-5">
          <div className="mx-auto max-w-3xl">
            <div className="flex items-center gap-2">
              <TarsAvatar size="md" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-foreground">
                  Affida questa comunicazione a Tars
                </div>
                <div className="text-xs text-text-2">
                  Verifica i dati e prepara azioni da approvare
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {preset.map(item => (
                <Button
                  key={item.label}
                  size="sm"
                  variant="outline"
                  className="h-8 bg-card/75 text-xs"
                  onClick={() => setIstruzione(item.testo)}
                >
                  <item.icon className="h-3.5 w-3.5" />
                  {item.label}
                </Button>
              ))}
            </div>
            <div className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end">
              <Textarea
                value={istruzione}
                onChange={e => setIstruzione(e.target.value)}
                placeholder="Es. Non esiste ancora una commessa: verifica se è un nuovo lead e prepara ciò che serve."
                className="min-h-[74px] min-w-0 flex-1 resize-none bg-card"
              />
              <Button
                className="shrink-0"
                disabled={istruzione.trim().length < 2 || affidaATars.isPending}
                onClick={() =>
                  affidaATars.mutate({
                    comunicazioneId: c.id,
                    istruzione: istruzione.trim(),
                  })
                }
              >
                {affidaATars.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {affidaATars.isPending
                  ? "Tars sta verificando…"
                  : "Analizza e prepara"}
              </Button>
            </div>
            {(ultimoRiepilogo || c.tarsRiepilogo) && (
              <div className="mt-3 border-l-2 border-primary pl-3 text-sm leading-6 text-text-1">
                {ultimoRiepilogo ?? c.tarsRiepilogo}
              </div>
            )}
          </div>
        </section>

        <div className="px-4 py-5 sm:px-5">
          <div className="mx-auto max-w-3xl space-y-5">
            {proposteTars.map(p => (
              <TarsPropostaCard key={p.id} proposta={p} />
            ))}

            {c.allegati?.length > 0 && (
              <section aria-label="Allegati" className="space-y-2">
                <div className="text-xs font-bold uppercase text-text-3">
                  Allegati
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {c.allegati.map((a: any, i: number) => (
                    <div
                      key={`${a.nome}-${i}`}
                      className="flex min-w-0 items-center gap-2 rounded-md border border-border-soft bg-surface-2 px-3 py-2.5"
                    >
                      <Paperclip className="h-4 w-4 shrink-0 text-accent-text" />
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                        {a.nome}
                      </span>
                      <span className="shrink-0 text-xs text-text-3">
                        {dimensioneFile(a.size)}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <div className="whitespace-pre-wrap break-words text-[15px] leading-7 text-text-1">
              {c.testo || "(messaggio vuoto)"}
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confermaElimina}
        onOpenChange={setConfermaElimina}
        title="Eliminare dal CRM?"
        description="La mail sparisce da qui ma resta nella casella di posta, che non viene mai toccata. Non verrà re-importata."
        confirmLabel="Elimina dal CRM"
        onConfirm={() => elimina.mutate({ id: c.id })}
      />
      <Dialog
        open={esclusione != null}
        onOpenChange={open => !open && setEsclusione(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {esclusione === "spam"
                ? "Segnare come spam?"
                : "Escludere come newsletter inutile?"}
            </DialogTitle>
            <DialogDescription>
              Il messaggio uscirà dalla coda operativa e non consumerà analisi
              automatiche di Tars.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-between">
            {puoGestireRegole && (
              <Button
                variant="outline"
                disabled={setCategoria.isPending}
                onClick={() =>
                  setCategoria.mutate({
                    id: c.id,
                    categoria: esclusione!,
                    ricordaMittente: true,
                  })
                }
              >
                {esclusione === "spam" ? (
                  <ShieldBan className="h-4 w-4" />
                ) : (
                  <Megaphone className="h-4 w-4" />
                )}
                Escludi anche i futuri
              </Button>
            )}
            <Button
              disabled={setCategoria.isPending}
              onClick={() =>
                setCategoria.mutate({ id: c.id, categoria: esclusione! })
              }
            >
              Solo questo messaggio
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Pagina ──────────────────────────────────────────────────────────────────

export default function Comunicazioni() {
  const { user } = useAuth();
  const mobile = useIsMobile();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("da_gestire");
  const [canale, setCanale] = useState<"tutti" | "email" | "whatsapp">("tutti");
  const [casellaId, setCasellaId] = useState<number | null>(null);
  const [selezionataId, setSelezionataId] = useState<number | null>(null);
  const [selezionate, setSelezionate] = useState<Set<number>>(new Set());
  const [bulkEsclusione, setBulkEsclusione] = useState<
    "spam" | "offerta_marketing" | null
  >(null);
  const [caselleAperte, setCaselleAperte] = useState(false);
  const deferredSearch = useDeferredValue(search.trim());

  const stats = trpc.mail.comunicazioni.stats.useQuery();
  const statoTars = trpc.mail.comunicazioni.statoTars.useQuery(undefined, {
    refetchInterval: query =>
      (query.state.data?.inAttesa ?? 0) > 0 ? 15_000 : 60_000,
  });
  const opzioniCaselle = trpc.mail.caselle.opzioni.useQuery();
  const regoleFiltro = trpc.mail.comunicazioni.regoleFiltro.list.useQuery(
    undefined,
    { enabled: isDirezione(user) }
  );
  const rows = trpc.mail.comunicazioni.list.useQuery({
    search: deferredSearch || undefined,
    casellaId: casellaId ?? undefined,
    canale: canale === "tutti" ? undefined : canale,
    soloDaGestire: filtro === "da_gestire" ? true : undefined,
    soloNonCollegate: filtro === "non_collegate" ? true : undefined,
    categoria: filtro === "lead" ? "nuovo_lead" : undefined,
    stato: filtro === "gestite" ? "gestita" : undefined,
    soloEscluse: filtro === "escluse" ? true : undefined,
    limit: 100,
  });
  // Ogni proposta nata dall'analisi puntuale porta comunicazioneId.
  const pendenti = trpc.tars.proposte.list.useQuery(
    { stato: "pendente" },
    { retry: false }
  );
  const proposteMail = useMemo(() => {
    const map = new Map<number, any[]>();
    for (const p of pendenti.data ?? []) {
      const id = p.payload?.comunicazioneId;
      if (id == null) continue;
      map.set(id, [...(map.get(id) ?? []), p]);
    }
    return map;
  }, [pendenti.data]);

  const sync = trpc.mail.caselle.sync.useMutation({
    onSuccess: (esiti: any[]) => {
      const tot = esiti.reduce((s, e) => s + e.importate, 0);
      const err = esiti.find(e => e.errore);
      if (err) toast.error(err.errore);
      else toast.success(tot > 0 ? `${tot} nuove mail` : "Nessuna novità");
      utils.mail.comunicazioni.invalidate();
    },
    onError: e => toast.error(e.message),
  });
  const setStato = trpc.mail.comunicazioni.setStato.useMutation({
    onSuccess: () => utils.mail.comunicazioni.invalidate(),
  });
  const tutteViste = trpc.mail.comunicazioni.segnaTutteViste.useMutation({
    onSuccess: r => {
      if (r.aggiornate > 0) toast.success(`${r.aggiornate} segnate come viste`);
      utils.mail.comunicazioni.invalidate();
    },
  });
  const bulk = trpc.mail.comunicazioni.bulkAggiorna.useMutation({
    onSuccess: r => {
      toast.success(`${r.aggiornate} comunicazioni aggiornate`);
      setSelezionate(new Set());
      setBulkEsclusione(null);
      utils.mail.comunicazioni.invalidate();
    },
    onError: e => toast.error(e.message),
  });
  const eliminaRegola = trpc.mail.comunicazioni.regoleFiltro.delete.useMutation(
    {
      onSuccess: () => {
        toast.success("Regola rimossa");
        regoleFiltro.refetch();
      },
      onError: e => toast.error(e.message),
    }
  );

  const lista = rows.data ?? [];
  const selezionata = lista.find((c: any) => c.id === selezionataId) ?? null;
  const tuttiSelezionati =
    lista.length > 0 && lista.every((c: any) => selezionate.has(c.id));
  const alcuniSelezionati = lista.some((c: any) => selezionate.has(c.id));

  const toggleScelta = (id: number, checked: boolean) => {
    setSelezionate(prev => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const apri = (c: any) => {
    setSelezionataId(c.id);
    if (c.stato === "nuova") setStato.mutate({ id: c.id, stato: "vista" });
  };

  const mostraLista = !mobile || selezionata == null;
  const mostraLettura = selezionata != null;
  const daGestire = Math.max(
    0,
    (stats.data?.totali ?? 0) - (stats.data?.gestite ?? 0)
  );
  const filtri: Array<{ value: Filtro; label: string; count: number }> = [
    { value: "da_gestire", label: "Da gestire", count: daGestire },
    {
      value: "non_collegate",
      label: "Non collegate",
      count: stats.data?.nonCollegate ?? 0,
    },
    { value: "lead", label: "Nuovi lead", count: stats.data?.nuoviLead ?? 0 },
    { value: "gestite", label: "Gestite", count: stats.data?.gestite ?? 0 },
    { value: "escluse", label: "Escluse", count: stats.data?.escluse ?? 0 },
  ];
  const codaTars = statoTars.data;
  const tarsBloccato =
    codaTars?.stato === "disattivato" ||
    codaTars?.stato === "chiave_mancante" ||
    codaTars?.stato === "budget_esaurito" ||
    codaTars?.stato === "pausa_errore";
  const titoloCodaTars =
    codaTars?.stato === "in_elaborazione"
      ? "Tars sta analizzando la coda"
      : codaTars?.stato === "pausa_errore"
        ? "Tars riproverà automaticamente"
        : codaTars?.stato === "disattivato"
          ? "Tars è disattivato"
          : codaTars?.stato === "chiave_mancante"
            ? "Chiave AI non configurata"
            : codaTars?.stato === "budget_esaurito"
              ? "Budget Tars esaurito"
              : "Analisi Tars programmata";
  const attesaCodaTars = attesaBreve(codaTars?.piuVecchiaAt);

  return (
    <div className="flex h-[calc(100dvh-8rem)] min-h-[560px] min-w-0 flex-col gap-3 overflow-hidden">
      <div className="flex shrink-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary [background-image:var(--gradient-primary)] text-primary-foreground shadow-xs">
            <Mail className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold leading-tight sm:text-2xl">
              Comunicazioni
            </h1>
            <p className="truncate text-sm text-text-2">
              {daGestire} da gestire · {stats.data?.escluse ?? 0} escluse dal
              lavoro
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {(stats.data?.nuove ?? 0) > 0 && filtro !== "escluse" && (
            <Button
              size="sm"
              variant="ghost"
              className="hidden sm:inline-flex"
              disabled={tutteViste.isPending}
              onClick={() => tutteViste.mutate()}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Tutte viste
            </Button>
          )}
          <Button
            size="icon"
            variant="outline"
            className="size-10 sm:h-8 sm:w-auto sm:px-3"
            disabled={sync.isPending}
            onClick={() => sync.mutate({})}
            aria-label="Aggiorna comunicazioni"
            title="Aggiorna comunicazioni"
          >
            {sync.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">Aggiorna</span>
          </Button>
          {isDirezione(user) && (
            <Button
              size="icon"
              variant="outline"
              className="size-10 sm:h-8 sm:w-auto sm:px-3"
              onClick={() => setCaselleAperte(true)}
              aria-label="Gestisci caselle"
              title="Gestisci caselle"
            >
              <Settings2 className="h-4 w-4" />
              <span className="hidden sm:inline">Caselle</span>
            </Button>
          )}
        </div>
      </div>

      {(codaTars?.inAttesa ?? 0) > 0 && (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "flex shrink-0 items-center gap-3 rounded-lg border px-3 py-2.5",
            tarsBloccato
              ? "border-warning/35 bg-warning/10"
              : "border-primary/20 bg-primary-soft/45"
          )}
        >
          {tarsBloccato ? (
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-warning/15 text-warning-foreground">
              <AlertTriangle className="h-4 w-4" />
            </div>
          ) : (
            <TarsAvatar
              size="md"
              className={cn(
                codaTars?.stato === "in_elaborazione" &&
                  "motion-safe:animate-pulse"
              )}
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-foreground">
              {titoloCodaTars}
            </div>
            <p className="text-xs leading-5 text-text-2">
              {codaTars!.inAttesa}{" "}
              {codaTars!.inAttesa === 1
                ? "comunicazione in attesa"
                : "comunicazioni in attesa"}
              {attesaCodaTars ? ` · la più vecchia da ${attesaCodaTars}` : ""}
              {codaTars?.stato === "pausa_errore" && codaTars.ripresaAt
                ? ` · nuovo tentativo alle ${new Date(codaTars.ripresaAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`
                : ""}
            </p>
          </div>
          {tarsBloccato && isDirezione(user) && (
            <Button
              asChild
              size="sm"
              variant="outline"
              className="hidden sm:inline-flex"
            >
              <Link href="/integrazioni">Controlla Tars</Link>
            </Button>
          )}
        </div>
      )}

      {mostraLista && (
        <div className="shrink-0 space-y-2">
          {mobile ? (
            <Select
              value={filtro}
              onValueChange={v => {
                setFiltro(v as Filtro);
                setSelezionate(new Set());
              }}
            >
              <SelectTrigger
                className="h-10 w-full"
                aria-label="Coda comunicazioni"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {filtri.map(item => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label} · {item.count}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Tabs
              value={filtro}
              onValueChange={v => {
                setFiltro(v as Filtro);
                setSelezionate(new Set());
              }}
            >
              <TabsList className="grid h-auto w-full grid-cols-5 gap-1 p-1">
                {filtri.map(item => (
                  <TabsTrigger
                    key={item.value}
                    className="min-h-9 gap-2"
                    value={item.value}
                  >
                    {item.label}
                    <span className="tabular-nums text-[11px] opacity-70">
                      {item.count}
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}

          <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
              <Input
                className="h-10 pl-9"
                placeholder="Cerca mittente, oggetto o testo"
                value={search}
                onChange={e => {
                  setSearch(e.target.value);
                  setSelezionate(new Set());
                }}
              />
            </div>
            <div
              className={cn(
                "grid gap-2 sm:flex",
                (opzioniCaselle.data?.length ?? 0) > 0 && canale !== "whatsapp"
                  ? "grid-cols-2"
                  : "grid-cols-1"
              )}
            >
              <Select
                value={canale}
                onValueChange={v => {
                  setCanale(v as typeof canale);
                  setSelezionate(new Set());
                  if (v === "whatsapp") setCasellaId(null);
                }}
              >
                <SelectTrigger
                  className="h-10 w-full sm:w-[150px]"
                  aria-label="Canale"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tutti">Tutti i canali</SelectItem>
                  <SelectItem value="email">
                    Email ({stats.data?.email ?? 0})
                  </SelectItem>
                  <SelectItem value="whatsapp">
                    WhatsApp ({stats.data?.whatsapp ?? 0})
                  </SelectItem>
                </SelectContent>
              </Select>

              {(opzioniCaselle.data?.length ?? 0) > 0 &&
              canale !== "whatsapp" ? (
                <Select
                  value={casellaId != null ? String(casellaId) : "tutte"}
                  onValueChange={v => {
                    setCasellaId(v === "tutte" ? null : Number(v));
                    setSelezionate(new Set());
                  }}
                >
                  <SelectTrigger
                    className="h-10 w-full sm:w-[180px]"
                    aria-label="Casella email"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tutte">Tutte le caselle</SelectItem>
                    {(opzioniCaselle.data ?? []).map((c: any) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </div>
          </div>
          {(stats.data?.nuove ?? 0) > 0 && filtro !== "escluse" && (
            <Button
              size="sm"
              variant="ghost"
              className="w-full sm:hidden"
              disabled={tutteViste.isPending}
              onClick={() => tutteViste.mutate()}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Segna tutte come viste
            </Button>
          )}
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border border-border bg-card shadow-xs">
        {mostraLista && (
          <div
            tabIndex={0}
            role="region"
            aria-label="Elenco comunicazioni"
            className={cn(
              "min-h-0 min-w-0 overflow-y-auto",
              mobile
                ? "w-full"
                : "w-[clamp(330px,34vw,440px)] shrink-0 border-r border-border-soft"
            )}
          >
            <div className="sticky top-0 z-10 flex min-h-11 items-center gap-2 border-b border-border-soft bg-card/95 px-3 backdrop-blur-sm">
              <Checkbox
                checked={
                  tuttiSelezionati
                    ? true
                    : alcuniSelezionati
                      ? "indeterminate"
                      : false
                }
                onCheckedChange={v => {
                  const next = new Set(selezionate);
                  for (const c of lista) {
                    if (v === true) next.add(c.id);
                    else next.delete(c.id);
                  }
                  setSelezionate(next);
                }}
                aria-label="Seleziona tutte le comunicazioni visibili"
              />
              {selezionate.size > 0 ? (
                <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                  <span className="shrink-0 text-xs font-bold tabular-nums">
                    {selezionate.size}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2 text-xs"
                    disabled={bulk.isPending}
                    onClick={() =>
                      bulk.mutate({
                        ids: Array.from(selezionate),
                        stato: "gestita",
                      })
                    }
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                    Gestite
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8 shrink-0"
                    onClick={() => setBulkEsclusione("offerta_marketing")}
                    aria-label="Escludi come newsletter inutili"
                    title="Escludi come newsletter inutili"
                  >
                    <Megaphone className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="dangerGhost"
                    className="size-8 shrink-0"
                    onClick={() => setBulkEsclusione("spam")}
                    aria-label="Segna come spam"
                    title="Segna come spam"
                  >
                    <ShieldBan className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <>
                  <span className="flex-1 text-xs font-bold uppercase text-text-3">
                    {FILTRO_LABEL[filtro]}
                  </span>
                  <span className="text-xs tabular-nums text-text-3">
                    {lista.length}
                    {rows.isFetching && !rows.isLoading
                      ? " · aggiornamento"
                      : ""}
                  </span>
                </>
              )}
            </div>
            {rows.isLoading && (
              <div className="py-12 text-center">
                <Loader2 className="mx-auto h-5 w-5 animate-spin text-text-3" />
              </div>
            )}
            {!rows.isLoading && lista.length === 0 && (
              <div className="px-5 py-14 text-center text-sm text-text-3">
                <div className="mx-auto mb-3 grid size-11 place-items-center rounded-lg bg-surface-2">
                  <Inbox className="h-5 w-5" />
                </div>
                {filtro === "da_gestire" && !search
                  ? "Tutto gestito. La coda operativa è vuota."
                  : "Niente qui con questi filtri."}
              </div>
            )}
            {lista.map((c: any) => (
              <Riga
                key={c.id}
                c={c}
                selezionata={c.id === selezionataId}
                haPropostaTars={proposteMail.has(c.id)}
                scelta={selezionate.has(c.id)}
                onScelta={checked => toggleScelta(c.id, checked)}
                onClick={() => apri(c)}
              />
            ))}
          </div>
        )}

        {mostraLettura ? (
          <div className={cn("min-h-0 min-w-0 flex-1", mobile && "w-full")}>
            <Lettura
              key={selezionata.id}
              c={selezionata}
              proposteTars={proposteMail.get(selezionata.id) ?? []}
              onChiudi={() => setSelezionataId(null)}
              mobile={mobile}
              puoGestireRegole={isDirezione(user)}
            />
          </div>
        ) : (
          !mobile && (
            <div className="flex min-w-0 flex-1 items-center justify-center bg-surface-2/35 text-sm text-text-3">
              <div className="space-y-3 text-center">
                <div className="mx-auto grid size-12 place-items-center rounded-lg bg-accent/70 text-accent-text">
                  <Bot className="h-5 w-5" />
                </div>
                <p className="font-medium">Apri una comunicazione</p>
              </div>
            </div>
          )
        )}
      </div>

      {/* Gestione caselle (direzione) */}
      <Dialog open={caselleAperte} onOpenChange={setCaselleAperte}>
        <DialogContent className="max-w-2xl max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Caselle e filtri</DialogTitle>
          </DialogHeader>
          <CaselleEmailCard />
          <section className="border-t border-border-soft pt-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold">Mittenti esclusi</h3>
                <p className="mt-0.5 text-xs text-text-3">
                  Le regole si applicano ai prossimi messaggi in arrivo.
                </p>
              </div>
              <Badge variant="secondary">
                {regoleFiltro.data?.length ?? 0}
              </Badge>
            </div>
            <div className="mt-3 divide-y divide-border-soft rounded-md border border-border-soft">
              {(regoleFiltro.data ?? []).map(regola => (
                <div
                  key={regola.id}
                  className="flex min-w-0 items-center gap-3 px-3 py-2.5"
                >
                  {regola.categoria === "spam" ? (
                    <ShieldBan className="h-4 w-4 shrink-0 text-destructive" />
                  ) : (
                    <Megaphone className="h-4 w-4 shrink-0 text-warning-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">
                      {regola.mittente}
                    </div>
                    <div className="text-xs text-text-3">
                      {regola.categoria === "spam" ? "Spam" : "Offerte"}
                    </div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8 shrink-0"
                    disabled={eliminaRegola.isPending}
                    onClick={() => eliminaRegola.mutate({ id: regola.id })}
                    aria-label={`Rimuovi regola per ${regola.mittente}`}
                    title="Rimuovi regola"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              {!regoleFiltro.isLoading &&
                (regoleFiltro.data?.length ?? 0) === 0 && (
                  <div className="px-3 py-5 text-center text-sm text-text-3">
                    Nessun mittente escluso in modo permanente.
                  </div>
                )}
            </div>
          </section>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={bulkEsclusione != null}
        onOpenChange={open => !open && setBulkEsclusione(null)}
        title={
          bulkEsclusione === "spam"
            ? "Segnare la selezione come spam?"
            : "Escludere le newsletter inutili?"
        }
        description={`${selezionate.size} comunicazioni usciranno dalla coda operativa e non verranno analizzate automaticamente da Tars.`}
        confirmLabel={
          bulkEsclusione === "spam" ? "Segna come spam" : "Escludi newsletter"
        }
        onConfirm={() =>
          bulk.mutate({
            ids: Array.from(selezionate),
            categoria: bulkEsclusione!,
          })
        }
      />
    </div>
  );
}
