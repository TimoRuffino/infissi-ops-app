// /comunicazioni — la posta dentro il CRM, leggibile come in un client
// di posta: lista a sinistra, messaggio aperto a destra (su mobile una
// vista alla volta). Aprire una mail la segna come vista. Dove Tars ha
// una proposta pendente, il suo avatar è sulla riga e la proposta è nel
// pannello di lettura.

import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
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
  CheckCheck,
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
  onClick,
}: {
  c: any;
  selezionata: boolean;
  haPropostaTars: boolean;
  onClick: () => void;
}) {
  const nuova = c.stato === "nuova";
  return (
    <button
      onClick={onClick}
      aria-current={selezionata ? "true" : undefined}
      className={cn(
        "group relative flex min-h-[92px] w-full items-start gap-3 border-b border-border-soft px-3.5 py-3 text-left",
        "transition-colors duration-fast focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
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
              nuova ? "font-bold text-foreground" : "font-semibold text-text-2"
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
        <div className="mt-1 flex min-h-4 items-center gap-2 text-[11px] text-text-3">
          {c.allegati?.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <Paperclip className="h-3 w-3" />
              {c.allegati.length}
            </span>
          )}
          {c.commessaId != null && (
            <span className="inline-flex items-center gap-1 text-success">
              <Link2 className="h-3 w-3" />
              Commessa
            </span>
          )}
          {haPropostaTars && <TarsAvatar size="sm" className="h-4 w-4" />}
          {c.stato === "gestita" && (
            <span className="ml-auto inline-flex items-center gap-1 text-success">
              <CheckCheck className="h-3 w-3" />
              Gestita
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ── Pannello di lettura ─────────────────────────────────────────────────────

function Lettura({
  c,
  proposteTars,
  onChiudi,
  mobile,
}: {
  c: any;
  proposteTars: any[];
  onChiudi: () => void;
  mobile: boolean;
}) {
  const utils = trpc.useUtils();
  const [collegaAperto, setCollegaAperto] = useState(false);
  const [confermaElimina, setConfermaElimina] = useState(false);
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
      invalidate();
    },
    onError: e => toast.error(e.message),
  });
  const setStato = trpc.mail.comunicazioni.setStato.useMutation({
    onSuccess: invalidate,
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
            <div className="flex min-w-0 items-center gap-2">
              <IconaCanale canale={c.canale} className="h-4 w-4 shrink-0" />
              <span className="truncate text-sm font-bold text-foreground">
                {c.mittenteNome ?? c.mittente}
              </span>
              <Badge
                variant={c.stato === "gestita" ? "success" : "secondary"}
                className="hidden sm:inline-flex"
              >
                {c.stato === "nuova"
                  ? "Nuova"
                  : c.stato === "gestita"
                    ? "Gestita"
                    : "Vista"}
              </Badge>
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

      <div className="shrink-0 border-b border-border-soft bg-surface-2/65 px-4 py-2.5 sm:px-5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {c.commessaId != null ? (
            <>
              <Link
                href={`/commesse/${c.commessaId}`}
                className="inline-flex min-w-0 items-center gap-1.5 text-sm font-semibold text-accent-text hover:underline"
              >
                <Link2 className="h-3.5 w-3.5" />
                <span className="truncate">
                  {commessa.data?.codice ?? `Commessa #${c.commessaId}`}
                  {commessa.data?.cliente ? ` · ${commessa.data.cliente}` : ""}
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
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => setCollegaAperto(v => !v)}
            >
              <Link2 className="h-3 w-3 mr-1" />
              Collega a una commessa
            </Button>
          )}
          {c.matchMotivo && (
            <span className="min-w-0 text-xs text-text-3">{c.matchMotivo}</span>
          )}
        </div>

        {collegaAperto && (
          <div className="mt-2">
            <SearchSelect
              value={null}
              onChange={(v: string) =>
                collega.mutate({ id: c.id, commessaId: Number(v) })
              }
              options={(commesse.data ?? []).map((cm: any) => ({
                value: String(cm.id),
                label: `${cm.codice} — ${cm.cliente}`,
                keywords: cm.citta ?? "",
              }))}
              placeholder="Cerca la commessa…"
            />
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-5">
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

      <ConfirmDialog
        open={confermaElimina}
        onOpenChange={setConfermaElimina}
        title="Eliminare dal CRM?"
        description="La mail sparisce da qui ma resta nella casella di posta, che non viene mai toccata. Non verrà re-importata."
        confirmLabel="Elimina dal CRM"
        onConfirm={() => elimina.mutate({ id: c.id })}
      />
    </div>
  );
}

// ── Pagina ──────────────────────────────────────────────────────────────────

export default function Comunicazioni() {
  const { user } = useAuth();
  const mobile = useIsMobile();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [filtro, setFiltro] = useState<
    "tutte" | "nuove" | "da_smistare" | "gestite"
  >("tutte");
  const [canale, setCanale] = useState<"tutti" | "email" | "whatsapp">("tutti");
  const [casellaId, setCasellaId] = useState<number | null>(null);
  const [selezionataId, setSelezionataId] = useState<number | null>(null);
  const [caselleAperte, setCaselleAperte] = useState(false);
  const deferredSearch = useDeferredValue(search.trim());

  const stats = trpc.mail.comunicazioni.stats.useQuery();
  const opzioniCaselle = trpc.mail.caselle.opzioni.useQuery();
  const rows = trpc.mail.comunicazioni.list.useQuery({
    search: deferredSearch || undefined,
    casellaId: casellaId ?? undefined,
    canale: canale === "tutti" ? undefined : canale,
    stato:
      filtro === "nuove"
        ? "nuova"
        : filtro === "gestite"
          ? "gestita"
          : undefined,
    soloNonCollegate: filtro === "da_smistare" ? true : undefined,
    limit: 100,
  });
  // Proposte pendenti di collegamento: avatar sulla riga, card nel pannello.
  const pendenti = trpc.tars.proposte.list.useQuery(
    { stato: "pendente" },
    { retry: false }
  );
  const proposteMail = useMemo(() => {
    const map = new Map<number, any[]>();
    for (const p of pendenti.data ?? []) {
      if (p.tipo !== "collega_comunicazione") continue;
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

  const lista = rows.data ?? [];
  const selezionata = lista.find((c: any) => c.id === selezionataId) ?? null;

  const apri = (c: any) => {
    setSelezionataId(c.id);
    if (c.stato === "nuova") setStato.mutate({ id: c.id, stato: "vista" });
  };

  const mostraLista = !mobile || selezionata == null;
  const mostraLettura = selezionata != null;

  return (
    <div className="flex h-[calc(100dvh-8rem)] min-h-[520px] min-w-0 flex-col gap-3">
      <div className="flex shrink-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
            <Mail className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold leading-tight">Comunicazioni</h1>
            <p className="truncate text-sm text-text-2">
              Posta e messaggi della sede attiva
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {(stats.data?.nuove ?? 0) > 0 && (
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

      {mostraLista && (
        <div className="shrink-0 space-y-2">
          <Tabs value={filtro} onValueChange={v => setFiltro(v as any)}>
            <TabsList className="grid h-auto w-full grid-cols-2 gap-1 p-1 sm:w-auto sm:grid-cols-4">
              <TabsTrigger className="min-h-9 gap-2" value="tutte">
                Tutte
                <span className="tabular-nums text-[11px] opacity-70">
                  {stats.data?.totali ?? 0}
                </span>
              </TabsTrigger>
              <TabsTrigger className="min-h-9 gap-2" value="nuove">
                Nuove
                <span className="tabular-nums text-[11px] opacity-70">
                  {stats.data?.nuove ?? 0}
                </span>
              </TabsTrigger>
              <TabsTrigger className="min-h-9 gap-2" value="da_smistare">
                Da smistare
                <span className="tabular-nums text-[11px] opacity-70">
                  {stats.data?.nonCollegate ?? 0}
                </span>
              </TabsTrigger>
              <TabsTrigger className="min-h-9 gap-2" value="gestite">
                Gestite
                <span className="tabular-nums text-[11px] opacity-70">
                  {stats.data?.gestite ?? 0}
                </span>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
              <Input
                className="h-10 pl-9"
                placeholder="Cerca mittente, oggetto o testo"
                value={search}
                onChange={e => setSearch(e.target.value)}
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
                  onValueChange={v =>
                    setCasellaId(v === "tutte" ? null : Number(v))
                  }
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
          {(stats.data?.nuove ?? 0) > 0 && (
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

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-border bg-card shadow-xs">
        {mostraLista && (
          <div
            tabIndex={0}
            role="region"
            aria-label="Elenco comunicazioni"
            className={cn(
              "min-h-0 min-w-0 overflow-y-auto",
              mobile
                ? "w-full"
                : "w-[clamp(320px,32vw,420px)] shrink-0 border-r border-border-soft"
            )}
          >
            <div className="sticky top-0 z-10 flex h-10 items-center justify-between border-b border-border-soft bg-card/95 px-3.5 backdrop-blur-sm">
              <span className="text-xs font-bold uppercase text-text-3">
                Messaggi
              </span>
              <span className="text-xs tabular-nums text-text-3">
                {lista.length}
                {rows.isFetching && !rows.isLoading ? " · aggiornamento" : ""}
              </span>
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
                {filtro === "tutte" && !search
                  ? "Nessuna comunicazione"
                  : "Niente qui con questi filtri."}
              </div>
            )}
            {lista.map((c: any) => (
              <Riga
                key={c.id}
                c={c}
                selezionata={c.id === selezionataId}
                haPropostaTars={proposteMail.has(c.id)}
                onClick={() => apri(c)}
              />
            ))}
          </div>
        )}

        {mostraLettura ? (
          <div className={cn("min-h-0 min-w-0 flex-1", mobile && "w-full")}>
            <Lettura
              c={selezionata}
              proposteTars={proposteMail.get(selezionata.id) ?? []}
              onChiudi={() => setSelezionataId(null)}
              mobile={mobile}
            />
          </div>
        ) : (
          !mobile && (
            <div className="flex min-w-0 flex-1 items-center justify-center bg-surface-2/35 text-sm text-text-3">
              <div className="space-y-3 text-center">
                <div className="mx-auto grid size-12 place-items-center rounded-lg bg-accent/70 text-accent-text">
                  <Mail className="h-5 w-5" />
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
            <DialogTitle>Caselle collegate</DialogTitle>
          </DialogHeader>
          <CaselleEmailCard />
        </DialogContent>
      </Dialog>
    </div>
  );
}
