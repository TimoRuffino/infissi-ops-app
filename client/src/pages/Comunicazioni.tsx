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
import { useMemo, useState } from "react";
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
    return data.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  }
  return data.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
}

function iniziali(c: any): string {
  const nome = (c.mittenteNome ?? c.mittente ?? "?").trim();
  const parti = nome.split(/[\s@.]+/).filter(Boolean);
  return ((parti[0]?.[0] ?? "?") + (parti[1]?.[0] ?? "")).toUpperCase();
}

// Pastiglia del canale: verde WhatsApp, neutro email. Su una lista mista
// serve capire a colpo d'occhio da dove arriva un messaggio.
function IconaCanale({ canale, className }: { canale: string; className?: string }) {
  if (canale === "whatsapp") {
    return (
      <MessageCircle
        className={cn("h-3.5 w-3.5 text-[#25D366]", className)}
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
      className={cn(
        "w-full text-left px-3 py-2.5 border-b flex gap-2.5 items-start transition-colors",
        selezionata ? "bg-accent" : "hover:bg-muted/60",
        nuova && !selezionata && "bg-blue-50/50 dark:bg-blue-950/20"
      )}
    >
      <div
        className={cn(
          "h-9 w-9 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 mt-0.5",
          nuova
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground"
        )}
      >
        {iniziali(c)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              "text-sm truncate flex items-center gap-1.5",
              nuova ? "font-semibold" : "font-medium text-muted-foreground"
            )}
          >
            <IconaCanale canale={c.canale} />
            <span className="truncate">{c.mittenteNome ?? c.mittente}</span>
          </span>
          <span className="text-[11px] text-muted-foreground shrink-0">
            {oraBreve(c.receivedAt)}
          </span>
        </div>
        <div
          className={cn(
            "text-sm truncate",
            nuova ? "text-foreground" : "text-muted-foreground"
          )}
        >
          {/* Su WhatsApp non esiste l'oggetto: si mostra il testo. */}
          {c.oggetto || (c.canale === "whatsapp" ? c.testo : "") || "(senza oggetto)"}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 min-h-4">
          {c.allegati?.length > 0 && (
            <Paperclip className="h-3 w-3 text-muted-foreground" />
          )}
          {c.commessaId != null && (
            <Link2 className="h-3 w-3 text-green-600 dark:text-green-500" />
          )}
          {haPropostaTars && <TarsAvatar size="sm" className="h-4 w-4" />}
          {nuova && <span className="h-2 w-2 rounded-full bg-primary ml-auto" />}
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
    onError: (e) => toast.error(e.message),
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
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="flex flex-col min-h-0 h-full">
      {/* Intestazione */}
      <div className="px-4 py-3 border-b space-y-2 shrink-0">
        <div className="flex items-start gap-2">
          {mobile && (
            <Button size="icon" variant="ghost" className="-ml-2" onClick={onChiudi}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold leading-snug break-words flex items-center gap-2">
              <IconaCanale canale={c.canale} className="h-4 w-4 shrink-0" />
              {c.oggetto ||
                (c.canale === "whatsapp"
                  ? "Messaggio WhatsApp"
                  : "(senza oggetto)")}
            </h2>
            <div className="text-sm text-muted-foreground mt-0.5">
              {c.mittenteNome ? `${c.mittenteNome} · ` : ""}
              <span className="break-all">{c.mittente}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {new Date(c.receivedAt).toLocaleString("it-IT")}
              {c.canale === "email" && casella
                ? ` · ricevuta su ${casella.nome} (${casella.indirizzo})`
                : ""}
            </div>
          </div>
          <div className="flex gap-1 shrink-0">
            <Button
              size="icon"
              variant="ghost"
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
                  c.stato === "gestita" && "text-green-600 dark:text-green-500"
                )}
              />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              title="Elimina dal CRM"
              onClick={() => setConfermaElimina(true)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Aggancio commessa */}
        <div className="flex items-center gap-2 flex-wrap">
          {c.commessaId != null ? (
            <>
              <Link
                href={`/commesse/${c.commessaId}`}
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                <Link2 className="h-3.5 w-3.5" />
                {commessa.data?.codice ?? `Commessa #${c.commessaId}`}
                {commessa.data?.cliente ? ` — ${commessa.data.cliente}` : ""}
              </Link>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => collega.mutate({ id: c.id, commessaId: null })}
              >
                Scollega
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => setCollegaAperto((v) => !v)}
            >
              <Link2 className="h-3 w-3 mr-1" />
              Collega a una commessa
            </Button>
          )}
          {c.matchMotivo && (
            <span className="text-xs text-muted-foreground italic">
              {c.matchMotivo}
            </span>
          )}
        </div>

        {collegaAperto && (
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
        )}
      </div>

      {/* Corpo */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        {proposteTars.map((p) => (
          <TarsPropostaCard key={p.id} proposta={p} />
        ))}

        {c.allegati?.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {c.allegati.map((a: any, i: number) => (
              <Badge key={i} variant="secondary" className="font-normal">
                <Paperclip className="h-3 w-3 mr-1" />
                {a.nome}
                <span className="text-muted-foreground ml-1">
                  {a.size ? `(${Math.round(a.size / 1024)} KB)` : ""}
                </span>
              </Badge>
            ))}
          </div>
        )}

        <div className="text-sm whitespace-pre-wrap break-words leading-relaxed">
          {c.testo || "(messaggio vuoto)"}
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
  const [casellaId, setCasellaId] = useState<number | null>(null);
  const [selezionataId, setSelezionataId] = useState<number | null>(null);
  const [caselleAperte, setCaselleAperte] = useState(false);

  const stats = trpc.mail.comunicazioni.stats.useQuery();
  const opzioniCaselle = trpc.mail.caselle.opzioni.useQuery();
  const rows = trpc.mail.comunicazioni.list.useQuery({
    search: search.trim() || undefined,
    casellaId: casellaId ?? undefined,
    stato:
      filtro === "nuove" ? "nuova" : filtro === "gestite" ? "gestita" : undefined,
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
      const err = esiti.find((e) => e.errore);
      if (err) toast.error(err.errore);
      else toast.success(tot > 0 ? `${tot} nuove mail` : "Nessuna novità");
      utils.mail.comunicazioni.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const setStato = trpc.mail.comunicazioni.setStato.useMutation({
    onSuccess: () => utils.mail.comunicazioni.invalidate(),
  });
  const tutteViste = trpc.mail.comunicazioni.segnaTutteViste.useMutation({
    onSuccess: (r) => {
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
    <div className="flex flex-col h-[calc(100dvh-8rem)] min-h-[420px] space-y-3">
      {/* Testata */}
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        <Mail className="h-5 w-5" />
        <h1 className="text-xl font-semibold">Comunicazioni</h1>
        {(stats.data?.nuove ?? 0) > 0 && (
          <>
            <Badge>{stats.data!.nuove} nuove</Badge>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              disabled={tutteViste.isPending}
              onClick={() => tutteViste.mutate()}
            >
              <CheckCheck className="h-3.5 w-3.5 mr-1" />
              Tutte viste
            </Button>
          </>
        )}
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={sync.isPending}
            onClick={() => sync.mutate({})}
          >
            {sync.isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
            )}
            Aggiorna
          </Button>
          {isDirezione(user) && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCaselleAperte(true)}
            >
              <Settings2 className="h-3.5 w-3.5 mr-1" />
              Caselle
            </Button>
          )}
        </div>
      </div>

      {/* Filtri */}
      {mostraLista && (
        <div className="flex gap-2 flex-wrap items-center shrink-0">
          <Tabs value={filtro} onValueChange={(v) => setFiltro(v as any)}>
            <TabsList>
              <TabsTrigger value="tutte">Tutte</TabsTrigger>
              <TabsTrigger value="nuove">Nuove</TabsTrigger>
              <TabsTrigger value="da_smistare">Da smistare</TabsTrigger>
              <TabsTrigger value="gestite">Gestite</TabsTrigger>
            </TabsList>
          </Tabs>
          {(opzioniCaselle.data?.length ?? 0) > 1 && (
            <Select
              value={casellaId != null ? String(casellaId) : "tutte"}
              onValueChange={(v) =>
                setCasellaId(v === "tutte" ? null : Number(v))
              }
            >
              <SelectTrigger className="h-9 w-[170px]">
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
          )}
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8 h-9"
              placeholder="Cerca…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Corpo: lista + lettura */}
      <div className="flex-1 min-h-0 border rounded-lg overflow-hidden bg-card flex">
        {mostraLista && (
          <div
            className={cn(
              "overflow-y-auto min-h-0",
              mobile ? "w-full" : "w-[340px] xl:w-[380px] border-r shrink-0"
            )}
          >
            {rows.isLoading && (
              <div className="py-12 text-center">
                <Loader2 className="h-5 w-5 mx-auto animate-spin text-muted-foreground" />
              </div>
            )}
            {!rows.isLoading && lista.length === 0 && (
              <div className="py-12 px-4 text-center text-sm text-muted-foreground">
                <Inbox className="h-8 w-8 mx-auto mb-2 opacity-50" />
                {filtro === "tutte" && !search
                  ? "Nessuna mail. Configura una casella da «Caselle» qui sopra e premi «Aggiorna»."
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
          <div className={cn("min-h-0 flex-1", mobile && "w-full")}>
            <Lettura
              c={selezionata}
              proposteTars={proposteMail.get(selezionata.id) ?? []}
              onChiudi={() => setSelezionataId(null)}
              mobile={mobile}
            />
          </div>
        ) : (
          !mobile && (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              <div className="text-center space-y-2">
                <Mail className="h-10 w-10 mx-auto opacity-30" />
                <p>Seleziona una mail per leggerla</p>
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
