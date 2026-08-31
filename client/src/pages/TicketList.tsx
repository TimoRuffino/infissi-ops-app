// /ticket — la coda Post-Vendita.
//
// Una coda, non una bacheca: si legge dall'alto, si capisce di chi è il
// problema e qual è il passo successivo. Gli stati sono quelli del router
// (`aperto → assegnato → in_lavorazione → chiuso`): la pagina li mostra e li
// avanza di uno alla volta, non ne inventa di nuovi e non salta passaggi.
//
// Il filtro vive in `client/src/lib/supportQueue.ts` come funzione pura, così
// la ricerca resta verificabile senza montare la pagina.

import { trpc } from "@/lib/trpc";
import { personName } from "@/lib/name";
import {
  SUPPORT_QUEUE_ALL,
  SUPPORT_QUEUE_STATES,
  nextQueueAdvance,
  ticketMatchesQueueFilter,
} from "@/lib/supportQueue";
import { supportQueuePermissions } from "@/lib/operationalRoutes";
import { useOperationalContext } from "@/contexts/OperationalContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import DataSurface from "@/components/patterns/DataSurface";
import PageHeader from "@/components/patterns/PageHeader";
import type { StatePanelProps } from "@/components/patterns/StatePanel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Clock,
  Pencil,
  Trash2,
  Undo2,
  Upload,
  Download,
  Eye,
  Paperclip,
  X,
  File as FileIcon,
  BellRing,
  CalendarPlus,
  Hammer,
  CheckCircle2,
  MoreHorizontal,
  Building2,
  Search,
  AlertTriangle,
  X as XIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import ConfirmDialog from "@/components/ConfirmDialog";
import SearchSelect from "@/components/SearchSelect";
import FilePreviewDialog, {
  type FilePreview,
} from "@/components/FilePreviewDialog";

type DeleteTarget = { id: number; label: string } | null;

// risolto ritirato: piegato su chiuso (il backfill server converte i vecchi)
const statoTicketLabel: Record<string, string> = {
  aperto: "Aperto",
  assegnato: "Assegnato",
  in_lavorazione: "In lavorazione",
  chiuso: "Chiuso",
};

// La chip porta la parola, non solo il colore: chi non distingue le tinte
// legge comunque lo stato.
const statoTicketTono: Record<string, string> = {
  aperto: "border-danger/25 bg-danger-soft text-danger",
  assegnato: "border-warning/25 bg-warning-soft text-warning",
  in_lavorazione: "border-info/25 bg-info-soft text-info",
  chiuso: "border-success/25 bg-success-soft text-success",
};

const statoInterventoLabel: Record<string, string> = {
  pianificato: "Pianificato",
  in_corso: "In corso",
  completato: "Completato",
  sospeso: "Sospeso",
};

const PRIORITA_LABEL: Record<string, string> = {
  bassa: "Bassa",
  media: "Media",
  alta: "Alta",
  urgente: "Urgente",
};

const CATEGORIA_LABEL: Record<string, string> = {
  difetto_prodotto: "Difetto prodotto",
  difetto_posa: "Difetto posa",
  regolazione: "Regolazione",
  sostituzione: "Sostituzione",
  garanzia: "Garanzia",
  altro: "Altro",
};

function codiceTicket(id: number): string {
  return `TK-${String(id).padStart(4, "0")}`;
}

function giorniAperto(createdAt: string | Date): number {
  const apertura = new Date(createdAt).getTime();
  if (Number.isNaN(apertura)) return 0;
  return Math.max(0, Math.floor((Date.now() - apertura) / 86_400_000));
}

// Staged files added before ticket is created — uploaded right after the ticket
// row lands so that ticketId exists.
type PendingFile = { file: File; note: string };

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const emptyForm = {
  commessaId: "",
  clienteId: "",
  contatto: "",
  oggetto: "",
  descrizione: "",
  categoria: "regolazione" as const,
  priorita: "media" as const,
};

export default function TicketList({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const [, setLocation] = useLocation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [filtroStato, setFiltroStato] = useState<string>(SUPPORT_QUEUE_ALL);
  const [search, setSearch] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [expandedTicket, setExpandedTicket] = useState<number | null>(null);
  const [preview, setPreview] = useState<
    (FilePreview & { allegatoId: number }) | null
  >(null);
  // Staged files to attach on creation. Uploaded after the ticket row lands.
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  // Per-ticket upload input (when attaching files to an existing ticket).
  const [uploadingFor, setUploadingFor] = useState<number | null>(null);
  // L'errore di validazione vive accanto al campo, non in un toast che
  // sparisce mentre si sta ancora compilando.
  const [erroreOggetto, setErroreOggetto] = useState<string | null>(null);

  // Il provider della slice 01 è l'unico owner di `permessi.mie`: finché il
  // contesto non è `ready` la matrice resta fail-closed.
  const { capabilities, status: operationalStatus } = useOperationalContext();
  const permissions = supportQueuePermissions(
    operationalStatus === "ready" ? capabilities : null
  );

  // Prendiamo tutti i ticket della sede e filtriamo qui: così i contatori
  // sui chip di stato sono reali e la ricerca attraversa anche gli stati non
  // selezionati (cercare un cliente e non trovarlo perché è "chiuso" sarebbe
  // solo confusione).
  const tickets = trpc.ticket.list.useQuery({});
  const commesse = trpc.commesse.list.useQuery({});
  const clienti = trpc.clienti.list.useQuery({});
  // Interventi di assistenza collegati ai ticket: una sola query, raggruppata
  // per ticketId — così ogni riga mostra il suo intervento programmato.
  const interventi = trpc.interventi.list.useQuery({});
  const squadre = trpc.squadre.list.useQuery();
  const utils = trpc.useUtils();

  // Dialog "Pianifica intervento" per un ticket.
  const [pianificaFor, setPianificaFor] = useState<any>(null);
  const [pianificaForm, setPianificaForm] = useState({
    data: new Date().toISOString().split("T")[0],
    oraInizio: "",
    oraFine: "",
    squadraId: "",
    note: "",
  });
  // Dialog sollecito.
  const [sollecitaFor, setSollecitaFor] = useState<any>(null);
  const [sollecitoNota, setSollecitoNota] = useState("");

  const [form, setForm] = useState(emptyForm);

  const uploadAllegato = trpc.ticketAllegati.upload.useMutation({
    onSuccess: () => utils.ticketAllegati.invalidate(),
  });

  const createTicket = trpc.ticket.create.useMutation({
    onSuccess: async created => {
      // Chain: upload any staged files against the new ticket.id, then reset
      // the form + close. Parallel uploads keep the UX snappy.
      let allegatiKo = false;
      if (pendingFiles.length > 0) {
        try {
          await Promise.all(
            pendingFiles.map(async pf => {
              const base64 = await fileToBase64(pf.file);
              return uploadAllegato.mutateAsync({
                ticketId: created.id,
                nome: pf.file.name,
                mimeType: pf.file.type || "application/octet-stream",
                size: pf.file.size,
                dataBase64: base64,
                note: pf.note || undefined,
              });
            })
          );
        } catch (errore: any) {
          // Il ticket esiste comunque: dirlo è meglio che chiudere il dialog
          // lasciando credere che gli allegati siano saliti.
          allegatiKo = true;
          toast.error(
            `Ticket creato, ma un allegato non è stato caricato: ${errore?.message ?? "errore di caricamento"}`
          );
        }
      }
      utils.ticket.invalidate();
      utils.ticketAllegati.invalidate();
      // Il form si svuota solo qui: se il server rifiuta, quello che era stato
      // scritto resta a schermo.
      setForm(emptyForm);
      setErroreOggetto(null);
      setDialogOpen(false);
      setPendingFiles([]);
      if (!allegatiKo) toast.success(`Ticket ${codiceTicket(created.id)} aperto`);
    },
    onError: e => toast.error(e.message ?? "Apertura ticket non riuscita"),
  });

  const updateTicket = trpc.ticket.update.useMutation({
    onSuccess: () => {
      utils.ticket.invalidate();
      setEditOpen(false);
      setEditId(null);
    },
    onError: e => toast.error(e.message ?? "Aggiornamento non riuscito"),
  });

  const updateStato = trpc.ticket.updateStato.useMutation({
    onSuccess: () => utils.ticket.invalidate(),
    onError: e => toast.error(e.message ?? "Cambio stato non riuscito"),
  });

  const rollbackStato = trpc.ticket.rollbackStato.useMutation({
    onSuccess: () => utils.ticket.invalidate(),
    onError: e => toast.error(e.message ?? "Rollback non riuscito"),
  });

  const deleteTicket = trpc.ticket.delete.useMutation({
    onSuccess: () => {
      utils.ticket.invalidate();
      utils.ticketAllegati.invalidate();
      setDeleteTarget(null);
      toast.success("Ticket eliminato");
    },
    // Senza questo un rifiuto del server (permessi, ticket già rimosso)
    // spariva in silenzio: si cliccava Elimina e non succedeva nulla.
    onError: e => {
      setDeleteTarget(null);
      toast.error(e.message ?? "Eliminazione non riuscita");
    },
  });

  const deleteAllegato = trpc.ticketAllegati.delete.useMutation({
    onSuccess: () => utils.ticketAllegati.invalidate(),
    onError: e => toast.error(e.message ?? "Allegato non eliminato"),
  });

  const sollecita = trpc.ticket.sollecita.useMutation({
    onSuccess: () => {
      utils.ticket.invalidate();
      setSollecitaFor(null);
      setSollecitoNota("");
      toast.success("Sollecito registrato");
    },
    onError: e => toast.error(e.message ?? "Sollecito non riuscito"),
  });

  const creaIntervento = trpc.interventi.create.useMutation({
    onSuccess: () => {
      utils.interventi.invalidate();
      setPianificaFor(null);
      toast.success("Intervento pianificato — lo trovi anche in Calendario");
    },
    onError: e => toast.error(e.message ?? "Pianificazione non riuscita"),
  });

  const [editForm, setEditForm] = useState({
    oggetto: "",
    descrizione: "",
    categoria: "regolazione" as string,
    priorita: "media" as string,
    commessaId: "",
    clienteId: "",
    contatto: "",
  });

  function openEdit(t: any) {
    setEditId(t.id);
    setEditForm({
      oggetto: t.oggetto,
      descrizione: t.descrizione ?? "",
      categoria: t.categoria,
      priorita: t.priorita,
      commessaId: t.commessaId ? String(t.commessaId) : "",
      clienteId: t.clienteId ? String(t.clienteId) : "",
      contatto: t.contatto ?? "",
    });
    setEditOpen(true);
  }

  function handleCreate() {
    // Solo l'oggetto è obbligatorio: la commessa spesso non esiste ancora
    // quando il cliente chiama.
    if (!form.oggetto.trim()) {
      setErroreOggetto("Scrivi almeno l'oggetto del ticket.");
      return;
    }
    setErroreOggetto(null);
    createTicket.mutate({
      commessaId: form.commessaId ? parseInt(form.commessaId) : null,
      clienteId: form.clienteId ? parseInt(form.clienteId) : null,
      contatto: form.contatto.trim() || null,
      oggetto: form.oggetto,
      descrizione: form.descrizione || undefined,
      categoria: form.categoria,
      priorita: form.priorita,
    });
  }

  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length === 0) return;
    setPendingFiles(prev => [...prev, ...picked.map(f => ({ file: f, note: "" }))]);
    // Clear the native input so the same file can be re-picked after removal.
    e.target.value = "";
  }

  async function handleAttachToExisting(ticketId: number, fileList: FileList) {
    const picked = Array.from(fileList);
    if (picked.length === 0) return;
    for (const f of picked) {
      const base64 = await fileToBase64(f);
      await uploadAllegato.mutateAsync({
        ticketId,
        nome: f.name,
        mimeType: f.type || "application/octet-stream",
        size: f.size,
        dataBase64: base64,
      });
    }
  }

  async function openAllegatoPreview(allegatoId: number) {
    const a: any = await utils.ticketAllegati.byId.fetch(allegatoId);
    if (!a?.dataBase64) return;
    const byteChars = atob(a.dataBase64);
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      bytes[i] = byteChars.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: a.mimeType });
    const url = URL.createObjectURL(blob);
    setPreview({
      allegatoId: a.id,
      nome: a.nome,
      mimeType: a.mimeType,
      url,
    });
  }

  async function downloadAllegato(allegatoId: number) {
    const a: any = await utils.ticketAllegati.byId.fetch(allegatoId);
    if (!a?.dataBase64) return;
    const byteChars = atob(a.dataBase64);
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      bytes[i] = byteChars.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: a.mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = a.nome;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function closePreview() {
    if (preview?.url) URL.revokeObjectURL(preview.url);
    setPreview(null);
  }

  // Indice commessa per id: serve sia alle righe sia alla ricerca (che deve
  // trovare per nome cliente e codice commessa, non solo per oggetto).
  const commessaById = useMemo(() => {
    const m = new Map<number, any>();
    for (const c of commesse.data ?? []) m.set(c.id, c);
    return m;
  }, [commesse.data]);

  const clienteById = useMemo(() => {
    const m = new Map<number, any>();
    for (const c of clienti.data ?? []) m.set(c.id, c);
    return m;
  }, [clienti.data]);

  // Chi è il ticket, in ordine di precisione: commessa → cliente collegato →
  // contatto scritto a mano → niente.
  const intestatario = (t: any): { nome: string; debole: boolean } => {
    const cm = t.commessaId ? commessaById.get(t.commessaId) : null;
    if (cm?.cliente) return { nome: cm.cliente, debole: false };
    const cl = t.clienteId ? clienteById.get(t.clienteId) : null;
    if (cl) {
      const n = personName(cl);
      if (n) return { nome: n, debole: false };
    }
    if (t.contatto) return { nome: t.contatto, debole: false };
    return { nome: "Senza cliente", debole: true };
  };

  // Riferimenti già letti dalla pagina: la ricerca li attraversa senza che
  // l'helper puro debba fare lookup per conto suo.
  const riferimentiDi = (t: any): Array<string | null | undefined> => {
    const commessa = t.commessaId ? commessaById.get(t.commessaId) : null;
    const cliente = t.clienteId ? clienteById.get(t.clienteId) : null;
    return [
      commessa?.cliente,
      commessa?.codice,
      commessa?.citta,
      commessa?.indirizzo,
      cliente ? personName(cliente) : null,
      cliente?.telefono,
      codiceTicket(t.id),
      CATEGORIA_LABEL[t.categoria] ?? t.categoria,
      t.esitoIntervento,
    ];
  };

  // Conteggi per chip: calcolati sull'elenco completo, indipendenti dalla
  // ricerca in corso — così si vede sempre quanti ticket ci sono per stato.
  const contaPerStato = useMemo(() => {
    const c: Record<string, number> = {
      [SUPPORT_QUEUE_ALL]: tickets.data?.length ?? 0,
    };
    for (const t of tickets.data ?? []) c[t.stato] = (c[t.stato] ?? 0) + 1;
    return c;
  }, [tickets.data]);

  const ticketFiltrati = useMemo(
    () =>
      (tickets.data ?? []).filter((t: any) =>
        ticketMatchesQueueFilter(
          {
            stato: t.stato,
            oggetto: t.oggetto,
            descrizione: t.descrizione,
            contatto: t.contatto,
            // anche le note dei solleciti: "chi ho già sollecitato per X?"
            solleciti: t.solleciti ?? [],
            riferimenti: riferimentiDi(t),
          },
          { stato: filtroStato, search }
        )
      ),
    [tickets.data, filtroStato, search, commessaById, clienteById]
  );

  const interventiPerTicket = useMemo(() => {
    const m = new Map<number, any[]>();
    for (const i of interventi.data ?? []) {
      if (i.ticketId == null) continue;
      m.set(i.ticketId, [...(m.get(i.ticketId) ?? []), i]);
    }
    return m;
  }, [interventi.data]);

  const clienteOptions = (clienti.data ?? []).map((c: any) => ({
    value: String(c.id),
    label: personName(c, `Cliente ${c.id}`),
    keywords: [c.cognome, c.nome, c.telefono, c.email, c.citta]
      .filter(Boolean)
      .join(" "),
    hint: c.citta ?? undefined,
  }));

  const commessaOptions = (commesse.data ?? []).map((c: any) => ({
    value: String(c.id),
    label: `${c.codice} — ${c.cliente}`,
    keywords: [c.codice, c.cliente, c.citta, c.indirizzo]
      .filter(Boolean)
      .join(" "),
  }));

  const filtriAttivi = search.trim() !== "" || filtroStato !== SUPPORT_QUEUE_ALL;
  const azzeraFiltri = () => {
    setSearch("");
    setFiltroStato(SUPPORT_QUEUE_ALL);
  };

  const nuovoTicketButton = (
    <Button
      type="button"
      className="min-h-11"
      onClick={() => setDialogOpen(true)}
    >
      <Plus className="h-4 w-4" aria-hidden="true" /> Nuovo ticket
    </Button>
  );

  // Quattro stati distinti: caricamento, errore con retry, sede senza ticket
  // e coda filtrata vuota. Una coda vuota non è mai "tutto a posto".
  const statoCoda: StatePanelProps | undefined = tickets.isPending
    ? {
        kind: "loading",
        title: "Carico la coda post-vendita",
        description: "Recupero i ticket della sede attiva.",
        rows: 5,
      }
    : tickets.isError
      ? {
          kind: "error",
          title: "Coda non caricata",
          description:
            "Non è stato possibile leggere i ticket della sede. Nessun ticket è stato modificato.",
          action: (
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => tickets.refetch()}
            >
              Riprova
            </Button>
          ),
        }
      : (tickets.data?.length ?? 0) === 0
        ? {
            kind: "empty",
            title: "Nessun ticket in questa sede",
            description: permissions.canCreateTicket
              ? "Quando un cliente segnala un problema, aprilo qui: resta agganciato alla commessa e al calendario."
              : "Quando qualcuno aprirà un ticket lo troverai in questa coda.",
            action: permissions.canCreateTicket ? nuovoTicketButton : undefined,
          }
        : ticketFiltrati.length === 0
          ? {
              kind: "empty",
              title: "Nessun ticket corrisponde ai filtri correnti",
              description:
                "Gli altri ticket della sede restano leggibili: cambia stato o ricerca per rivederli.",
              action: (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={azzeraFiltri}
                >
                  Azzera i filtri
                </Button>
              ),
            }
          : undefined;

  return (
    <div className="min-w-0 space-y-4 sm:space-y-5">
      {!embedded && (
        <PageHeader
          variant="workbench"
          eyebrow="Post-vendita"
          title="Coda ticket"
          description="Le segnalazioni dei clienti in ordine di lavorazione: chi ha il problema, qual è il passo successivo, chi lo sta seguendo."
          busy={tickets.isFetching}
          metadata={
            tickets.isPending ? (
              <span>Conteggio ticket in caricamento…</span>
            ) : tickets.isError ? (
              <span>Conteggio ticket non disponibile</span>
            ) : (
              <>
                <span>
                  <strong className="tabular-nums text-text-1">
                    {contaPerStato[SUPPORT_QUEUE_ALL] ?? 0}
                  </strong>{" "}
                  in coda
                </span>
                <span>
                  <strong className="tabular-nums text-text-1">
                    {(contaPerStato.aperto ?? 0) +
                      (contaPerStato.assegnato ?? 0) +
                      (contaPerStato.in_lavorazione ?? 0)}
                  </strong>{" "}
                  ancora da chiudere
                </span>
              </>
            )
          }
          primaryAction={
            permissions.canCreateTicket ? nuovoTicketButton : undefined
          }
        />
      )}

      {embedded && permissions.canCreateTicket && (
        <div className="flex justify-end">{nuovoTicketButton}</div>
      )}

      {/* Una sola toolbar: ricerca, stato e conteggi nello stesso posto. */}
      <DataSurface density="compact" tone="sunken">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="relative min-w-0 lg:max-w-md">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3"
              aria-hidden="true"
            />
            <Input
              aria-label="Cerca nella coda post-vendita"
              className="h-11 pl-9 pr-10"
              placeholder="Cerca cliente, commessa, oggetto, TK-0001…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Pulisci la ricerca"
                title="Pulisci la ricerca"
                className="absolute right-1 top-1/2 h-9 w-9 -translate-y-1/2"
                onClick={() => setSearch("")}
              >
                <XIcon className="h-4 w-4" />
              </Button>
            )}
          </div>
          <div
            role="group"
            aria-label="Filtra per stato"
            className="flex min-w-0 flex-wrap items-center gap-2"
          >
            {[SUPPORT_QUEUE_ALL, ...SUPPORT_QUEUE_STATES].map(st => {
              const attivo = filtroStato === st;
              return (
                <Button
                  key={st}
                  type="button"
                  variant={attivo ? "default" : "outline"}
                  aria-pressed={attivo}
                  className="min-h-11 text-xs"
                  onClick={() => setFiltroStato(st)}
                >
                  {st === SUPPORT_QUEUE_ALL
                    ? "Tutti"
                    : (statoTicketLabel[st] ?? st)}
                  {/* Un conteggio che non conosciamo non si mostra come zero. */}
                  {!tickets.isPending && !tickets.isError && (
                    <span
                      className={cn(
                        "ml-1.5 tabular-nums",
                        attivo ? "opacity-80" : "text-text-3"
                      )}
                    >
                      {contaPerStato[st] ?? 0}
                    </span>
                  )}
                </Button>
              );
            })}
            {filtriAttivi && !tickets.isPending && !tickets.isError && (
              <span className="text-xs text-text-2 lg:ml-auto">
                <strong className="tabular-nums text-text-1">
                  {ticketFiltrati.length}
                </strong>{" "}
                {ticketFiltrati.length === 1
                  ? "ticket in vista"
                  : "ticket in vista"}
              </span>
            )}
          </div>
        </div>
      </DataSurface>

      <DataSurface
        density="compact"
        tone="default"
        title="Ticket"
        description="Una riga per segnalazione: apri gli allegati solo quando servono."
        state={statoCoda}
      >
        <div className="-mx-3 -mb-3 min-w-0 border-t border-border-soft sm:-mx-4 sm:-mb-4">
          {ticketFiltrati.map((t: any) => {
            const commessa = t.commessaId ? commessaById.get(t.commessaId) : null;
            const chi = intestatario(t);
            const isExpanded = expandedTicket === t.id;
            const avanzamento = nextQueueAdvance(t.stato);
            const solleciti = t.solleciti ?? [];
            const ultimoSollecito = solleciti[solleciti.length - 1];
            const prioritaAlta =
              t.priorita === "urgente" || t.priorita === "alta";
            const giorni = giorniAperto(t.createdAt);
            const interventiTicket = interventiPerTicket.get(t.id) ?? [];

            return (
              <article
                key={t.id}
                aria-label={`Ticket ${codiceTicket(t.id)} — ${chi.nome}`}
                className="grid min-w-0 gap-3 border-b border-border-soft px-4 py-3 last:border-b-0 lg:grid-cols-[minmax(14rem,1fr)_minmax(0,1.4fr)_auto]"
              >
                {/* Chi, con che riferimenti e da quanto è aperto. */}
                <div className="min-w-0">
                  <h3
                    className={cn(
                      "truncate text-sm font-bold leading-tight",
                      chi.debole ? "text-text-3" : "text-text-1"
                    )}
                  >
                    {chi.nome}
                  </h3>
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-3">
                    {commessa ? (
                      <button
                        type="button"
                        onClick={() => setLocation(`/commesse/${commessa.id}`)}
                        className="codice-mono rounded-[var(--radius-control)] text-accent-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        title="Apri la commessa"
                      >
                        {commessa.codice}
                      </button>
                    ) : (
                      <span>Senza commessa</span>
                    )}
                    <span className="codice-mono">{codiceTicket(t.id)}</span>
                  </div>
                  <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-2">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" aria-hidden="true" />
                      {t.stato === "chiuso"
                        ? `Aperto il ${new Date(t.createdAt).toLocaleDateString("it-IT")}`
                        : giorni === 0
                          ? "Aperto oggi"
                          : `Aperto da ${giorni} ${giorni === 1 ? "giorno" : "giorni"}`}
                    </span>
                    {prioritaAlta && t.stato !== "chiuso" && (
                      <Badge
                        variant="outline"
                        className="gap-1 border-danger/25 bg-danger-soft text-[11px] font-semibold text-danger"
                      >
                        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                        Priorità {PRIORITA_LABEL[t.priorita] ?? t.priorita}
                      </Badge>
                    )}
                    {solleciti.length > 0 && (
                      <span className="inline-flex items-center gap-1 text-warning">
                        <BellRing className="h-3 w-3" aria-hidden="true" />
                        {solleciti.length}{" "}
                        {solleciti.length === 1 ? "sollecito" : "solleciti"}
                        {ultimoSollecito?.data
                          ? ` · ultimo ${new Date(ultimoSollecito.data).toLocaleDateString("it-IT")}`
                          : ""}
                      </span>
                    )}
                  </div>
                </div>

                {/* Cosa è successo e qual è il passo successivo. */}
                <div className="min-w-0">
                  <p className="text-sm leading-snug text-text-1">{t.oggetto}</p>
                  <p className="mt-1 text-xs text-text-2">
                    <span className="text-text-3">Prossima azione:</span>{" "}
                    {avanzamento
                      ? avanzamento.prossimaAzione
                      : "Chiuso: nessuna azione in coda"}
                  </p>
                  <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2 text-xs text-text-3">
                    <span>
                      {CATEGORIA_LABEL[t.categoria] ??
                        String(t.categoria).replace(/_/g, " ")}
                    </span>
                    {t.descrizione && (
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedTicket(isExpanded ? null : t.id)
                        }
                        aria-expanded={isExpanded}
                        className="inline-flex min-h-11 items-center gap-1 text-accent-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-0"
                      >
                        {isExpanded ? "Nascondi dettaglio" : "Mostra dettaglio"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setExpandedTicket(isExpanded ? null : t.id)}
                      aria-expanded={isExpanded}
                      className="inline-flex min-h-11 items-center gap-1 text-accent-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-0"
                    >
                      <Paperclip className="h-3 w-3" aria-hidden="true" />
                      <AllegatiCount ticketId={t.id} />
                    </button>
                  </div>

                  {isExpanded && t.descrizione && (
                    <p className="mt-2 whitespace-pre-line rounded-[var(--radius-control)] bg-surface-2 px-2.5 py-2 text-xs text-text-2">
                      {t.descrizione}
                    </p>
                  )}

                  {/* Interventi collegati */}
                  {interventiTicket.map((i: any) => (
                    <div
                      key={i.id}
                      className="mt-2 flex min-w-0 flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-info/25 bg-info-soft px-2.5 py-1.5 text-xs text-text-1"
                    >
                      <Hammer
                        className="h-3.5 w-3.5 shrink-0 text-info"
                        aria-hidden="true"
                      />
                      <span className="font-medium">
                        {new Date(
                          i.dataPianificata + "T12:00:00"
                        ).toLocaleDateString("it-IT")}
                        {i.oraInizio ? ` · ${i.oraInizio}` : ""}
                      </span>
                      <span
                        className={
                          i.squadraId ? "text-text-2" : "font-medium text-warning"
                        }
                      >
                        {i.squadraId
                          ? (squadre.data?.find((sq: any) => sq.id === i.squadraId)
                              ?.nome ?? "Squadra")
                          : "Senza squadra"}
                      </span>
                      <span className="text-text-2">
                        {statoInterventoLabel[i.stato] ??
                          String(i.stato).replace(/_/g, " ")}
                      </span>
                    </div>
                  ))}

                  {t.esitoIntervento && (
                    <p className="mt-2 border-l-2 border-success pl-2 text-xs text-text-2">
                      Esito: {t.esitoIntervento}
                    </p>
                  )}
                </div>

                {/* Stato e azioni: un solo primario per stato. */}
                <div className="flex min-w-0 flex-wrap items-center gap-2 lg:flex-col lg:items-end">
                  <span
                    className={cn(
                      "shrink-0 rounded-[var(--radius-control)] border px-2.5 py-1 text-[11px] font-semibold",
                      statoTicketTono[t.stato] ??
                        "border-border-soft bg-surface-2 text-text-2"
                    )}
                  >
                    {statoTicketLabel[t.stato] ??
                      String(t.stato).replace(/_/g, " ")}
                  </span>

                  <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
                    {avanzamento && (
                      <Button
                        type="button"
                        size="sm"
                        className="min-h-11 text-xs lg:min-h-9"
                        disabled={updateStato.isPending}
                        onClick={() =>
                          updateStato.mutate({
                            id: t.id,
                            stato: avanzamento.stato,
                          })
                        }
                      >
                        {avanzamento.stato === "chiuso" && (
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        {avanzamento.label}
                      </Button>
                    )}
                    {t.stato !== "chiuso" && (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="min-h-11 text-xs text-warning lg:min-h-9"
                          title="Registra un sollecito"
                          onClick={() => setSollecitaFor(t)}
                        >
                          <BellRing className="h-3.5 w-3.5" aria-hidden="true" />
                          Sollecita
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="min-h-11 text-xs text-info lg:min-h-9"
                          title="Pianifica un intervento di assistenza"
                          onClick={() => {
                            setPianificaFor(t);
                            setPianificaForm({
                              data: new Date().toISOString().split("T")[0],
                              oraInizio: "",
                              oraFine: "",
                              squadraId: "",
                              note: "",
                            });
                          }}
                        >
                          <CalendarPlus className="h-3.5 w-3.5" aria-hidden="true" />
                          Pianifica
                        </Button>
                      </>
                    )}
                    {/* Elimina resta a vista: nasconderlo nel menu lo rendeva
                        introvabile. Chi non è autorizzato riceve il rifiuto
                        del server, non un bottone che sparisce. */}
                    <Button
                      type="button"
                      variant="dangerGhost"
                      size="icon"
                      className="h-11 w-11 lg:h-9 lg:w-9"
                      aria-label={`Elimina il ticket ${codiceTicket(t.id)}`}
                      title="Elimina ticket"
                      onClick={() =>
                        setDeleteTarget({ id: t.id, label: t.oggetto })
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-11 w-11 lg:h-9 lg:w-9"
                          aria-label={`Altre azioni sul ticket ${codiceTicket(t.id)}`}
                          title="Altre azioni"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(t)}>
                          <Pencil className="h-3.5 w-3.5" />
                          Modifica
                        </DropdownMenuItem>
                        {commessa && (
                          <DropdownMenuItem
                            onClick={() =>
                              setLocation(`/commesse/${commessa.id}`)
                            }
                          >
                            <Building2 className="h-3.5 w-3.5" />
                            Apri commessa
                          </DropdownMenuItem>
                        )}
                        {t.stato !== "aperto" && (
                          <DropdownMenuItem
                            disabled={rollbackStato.isPending}
                            onClick={() => rollbackStato.mutate({ id: t.id })}
                          >
                            <Undo2 className="h-3.5 w-3.5" />
                            Torna indietro di uno stato
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                {isExpanded && (
                  <div className="min-w-0 lg:col-span-3">
                    <AllegatiPanel
                      ticketId={t.id}
                      uploading={uploadingFor === t.id}
                      onUpload={async fl => {
                        setUploadingFor(t.id);
                        try {
                          await handleAttachToExisting(t.id, fl);
                        } catch (errore: any) {
                          toast.error(
                            errore?.message ?? "Caricamento allegato non riuscito"
                          );
                        } finally {
                          setUploadingFor(null);
                        }
                      }}
                      onPreview={id => openAllegatoPreview(id)}
                      onDownload={id => downloadAllegato(id)}
                      onDelete={id => deleteAllegato.mutate(id)}
                    />
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </DataSurface>

      {/* Nuovo ticket — flusso guidato: label sempre visibili, errore accanto
          al campo, azione primaria persistente in fondo. Niente autosalvataggio:
          finché non si preme «Apri ticket» non esiste nulla. */}
      <Dialog
        open={dialogOpen}
        onOpenChange={o => {
          setDialogOpen(o);
          if (!o) {
            setPendingFiles([]);
            setErroreOggetto(null);
          }
        }}
      >
        <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="border-b border-border-soft px-5 py-4 pr-12">
            <DialogTitle>Apri ticket</DialogTitle>
            <DialogDescription>
              Solo l'oggetto è obbligatorio. Commessa e cliente si agganciano
              anche dopo, quando si scopre a chi appartiene il problema.
            </DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto px-5 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="ticket-oggetto">Oggetto *</Label>
              <Input
                id="ticket-oggetto"
                autoFocus
                aria-invalid={erroreOggetto ? true : undefined}
                aria-describedby={
                  erroreOggetto ? "ticket-oggetto-errore" : undefined
                }
                placeholder="Es. Persiana non chiude, vetro graffiato…"
                value={form.oggetto}
                onChange={e => {
                  setForm({ ...form, oggetto: e.target.value });
                  if (erroreOggetto) setErroreOggetto(null);
                }}
              />
              {erroreOggetto && (
                <p
                  id="ticket-oggetto-errore"
                  role="alert"
                  className="text-xs text-danger"
                >
                  {erroreOggetto}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Commessa</Label>
              <SearchSelect
                options={commessaOptions}
                value={form.commessaId}
                onChange={v =>
                  setForm({ ...form, commessaId: v === "__none__" ? "" : v })
                }
                placeholder="Nessuna — ticket senza commessa"
                searchPlaceholder="Cerca per codice, cliente..."
                allowClear
                clearLabel="— Nessuna —"
              />
            </div>
            {!form.commessaId && (
              <>
                <div className="space-y-1.5">
                  <Label>Cliente</Label>
                  <SearchSelect
                    options={clienteOptions}
                    value={form.clienteId}
                    onChange={v =>
                      setForm({ ...form, clienteId: v === "__none__" ? "" : v })
                    }
                    placeholder="Cliente già a sistema (facoltativo)"
                    searchPlaceholder="Cerca cliente..."
                    allowClear
                    clearLabel="— Nessuno —"
                  />
                </div>
                {!form.clienteId && (
                  <div className="space-y-1.5">
                    <Label htmlFor="ticket-contatto">Contatto</Label>
                    <Input
                      id="ticket-contatto"
                      placeholder="Nome e telefono di chi ha chiamato"
                      value={form.contatto}
                      onChange={e =>
                        setForm({ ...form, contatto: e.target.value })
                      }
                    />
                  </div>
                )}
              </>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ticket-categoria">Categoria</Label>
                <Select
                  value={form.categoria}
                  onValueChange={(v: any) => setForm({ ...form, categoria: v })}
                >
                  <SelectTrigger id="ticket-categoria">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="difetto_prodotto">
                      Difetto prodotto
                    </SelectItem>
                    <SelectItem value="difetto_posa">Difetto posa</SelectItem>
                    <SelectItem value="regolazione">Regolazione</SelectItem>
                    <SelectItem value="sostituzione">Sostituzione</SelectItem>
                    <SelectItem value="garanzia">Garanzia</SelectItem>
                    <SelectItem value="altro">Altro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ticket-priorita">Priorità</Label>
                <Select
                  value={form.priorita}
                  onValueChange={(v: any) => setForm({ ...form, priorita: v })}
                >
                  <SelectTrigger id="ticket-priorita">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bassa">Bassa</SelectItem>
                    <SelectItem value="media">Media</SelectItem>
                    <SelectItem value="alta">Alta</SelectItem>
                    <SelectItem value="urgente">Urgente</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ticket-descrizione">Descrizione</Label>
              <Textarea
                id="ticket-descrizione"
                rows={3}
                value={form.descrizione}
                onChange={e =>
                  setForm({ ...form, descrizione: e.target.value })
                }
              />
            </div>

            {/* Allegati in attesa: caricati subito dopo la creazione, quando
                il ticketId esiste. */}
            <div className="space-y-1.5">
              <Label>Allegati</Label>
              <div className="space-y-2">
                {pendingFiles.length > 0 && (
                  <ul className="space-y-1">
                    {pendingFiles.map((pf, i) => (
                      <li
                        key={i}
                        className="flex min-w-0 items-center gap-2 rounded-[var(--radius-control)] border border-border-soft bg-surface-2 px-2 py-1 text-xs"
                      >
                        <FileIcon
                          className="h-3.5 w-3.5 shrink-0 text-text-3"
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {pf.file.name}
                        </span>
                        <span className="shrink-0 tabular-nums text-text-3">
                          {(pf.file.size / 1024).toFixed(0)} KB
                        </span>
                        <Button
                          type="button"
                          variant="dangerGhost"
                          size="icon"
                          className="h-9 w-9 shrink-0"
                          aria-label={`Togli ${pf.file.name} dagli allegati`}
                          onClick={() =>
                            setPendingFiles(prev =>
                              prev.filter((_, j) => j !== i)
                            )
                          }
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-[var(--radius-control)] border border-dashed border-border-strong text-xs text-text-2 transition-colors hover:bg-surface-2">
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Aggiungi file</span>
                  <input
                    type="file"
                    multiple
                    className="sr-only"
                    onChange={handleFilePick}
                  />
                </label>
                {pendingFiles.length > 0 && (
                  <p className="text-xs text-text-3">
                    {pendingFiles.length}{" "}
                    {pendingFiles.length === 1
                      ? "file da caricare"
                      : "file da caricare"}{" "}
                    dopo l'apertura del ticket.
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="sticky bottom-0 border-t border-border-soft bg-surface-raised px-5 py-3">
            <Button
              type="button"
              className="min-h-12 w-full sm:min-h-11"
              onClick={handleCreate}
              disabled={createTicket.isPending}
            >
              {createTicket.isPending ? "Creazione…" : "Apri ticket"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog
        open={editOpen}
        onOpenChange={o => {
          setEditOpen(o);
          if (!o) setEditId(null);
        }}
      >
        <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="border-b border-border-soft px-5 py-4 pr-12">
            <DialogTitle>Modifica ticket</DialogTitle>
            <DialogDescription>
              Lo stato non si cambia da qui: resta la coda a farlo avanzare.
            </DialogDescription>
          </DialogHeader>
          <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto px-5 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="ticket-edit-oggetto">Oggetto</Label>
              <Input
                id="ticket-edit-oggetto"
                value={editForm.oggetto}
                onChange={e =>
                  setEditForm({ ...editForm, oggetto: e.target.value })
                }
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ticket-edit-categoria">Categoria</Label>
                <Select
                  value={editForm.categoria}
                  onValueChange={v =>
                    setEditForm({ ...editForm, categoria: v })
                  }
                >
                  <SelectTrigger id="ticket-edit-categoria">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="difetto_prodotto">
                      Difetto prodotto
                    </SelectItem>
                    <SelectItem value="difetto_posa">Difetto posa</SelectItem>
                    <SelectItem value="regolazione">Regolazione</SelectItem>
                    <SelectItem value="sostituzione">Sostituzione</SelectItem>
                    <SelectItem value="garanzia">Garanzia</SelectItem>
                    <SelectItem value="altro">Altro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ticket-edit-priorita">Priorità</Label>
                <Select
                  value={editForm.priorita}
                  onValueChange={v => setEditForm({ ...editForm, priorita: v })}
                >
                  <SelectTrigger id="ticket-edit-priorita">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bassa">Bassa</SelectItem>
                    <SelectItem value="media">Media</SelectItem>
                    <SelectItem value="alta">Alta</SelectItem>
                    <SelectItem value="urgente">Urgente</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ticket-edit-descrizione">Descrizione</Label>
              <Textarea
                id="ticket-edit-descrizione"
                rows={3}
                value={editForm.descrizione}
                onChange={e =>
                  setEditForm({ ...editForm, descrizione: e.target.value })
                }
              />
            </div>
            {/* Aggancio posticipato: un ticket aperto al volo si collega qui
                alla commessa (o al cliente) una volta scoperta. */}
            <div className="space-y-1.5">
              <Label>Commessa</Label>
              <SearchSelect
                options={commessaOptions}
                value={editForm.commessaId}
                onChange={v =>
                  setEditForm({
                    ...editForm,
                    commessaId: v === "__none__" ? "" : v,
                  })
                }
                placeholder="Nessuna — ticket senza commessa"
                searchPlaceholder="Cerca per codice, cliente..."
                allowClear
                clearLabel="— Nessuna —"
              />
            </div>
            {!editForm.commessaId && (
              <>
                <div className="space-y-1.5">
                  <Label>Cliente</Label>
                  <SearchSelect
                    options={clienteOptions}
                    value={editForm.clienteId}
                    onChange={v =>
                      setEditForm({
                        ...editForm,
                        clienteId: v === "__none__" ? "" : v,
                      })
                    }
                    placeholder="Cliente già a sistema (facoltativo)"
                    searchPlaceholder="Cerca cliente..."
                    allowClear
                    clearLabel="— Nessuno —"
                  />
                </div>
                {!editForm.clienteId && (
                  <div className="space-y-1.5">
                    <Label htmlFor="ticket-edit-contatto">Contatto</Label>
                    <Input
                      id="ticket-edit-contatto"
                      placeholder="Nome e telefono di chi ha chiamato"
                      value={editForm.contatto}
                      onChange={e =>
                        setEditForm({ ...editForm, contatto: e.target.value })
                      }
                    />
                  </div>
                )}
              </>
            )}
          </div>
          <div className="sticky bottom-0 border-t border-border-soft bg-surface-raised px-5 py-3">
            <Button
              type="button"
              className="min-h-12 w-full sm:min-h-11"
              onClick={() =>
                editId &&
                updateTicket.mutate({
                  id: editId,
                  oggetto: editForm.oggetto || undefined,
                  descrizione: editForm.descrizione || undefined,
                  categoria: editForm.categoria as any,
                  priorita: editForm.priorita as any,
                  commessaId: editForm.commessaId
                    ? parseInt(editForm.commessaId)
                    : null,
                  // Agganciando una commessa il cliente sciolto non serve più.
                  clienteId: editForm.commessaId
                    ? null
                    : editForm.clienteId
                      ? parseInt(editForm.clienteId)
                      : null,
                  contatto:
                    editForm.commessaId || editForm.clienteId
                      ? null
                      : editForm.contatto.trim() || null,
                })
              }
              disabled={updateTicket.isPending}
            >
              {updateTicket.isPending ? "Aggiornamento…" : "Aggiorna"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Preview dialog — reusable, large */}
      <FilePreviewDialog
        preview={preview}
        onClose={closePreview}
        onDownload={() => preview && downloadAllegato(preview.allegatoId)}
      />

      {/* Sollecito dialog */}
      <Dialog
        open={!!sollecitaFor}
        onOpenChange={o => {
          if (!o) {
            setSollecitaFor(null);
            setSollecitoNota("");
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5 text-sm">
              <BellRing className="h-4 w-4 text-warning" aria-hidden="true" />
              Sollecito · {sollecitaFor?.oggetto}
            </DialogTitle>
            <DialogDescription>
              Il sollecito resta nello storico del ticket: non manda nulla da
              solo.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            {(sollecitaFor?.solleciti?.length ?? 0) > 0 && (
              <div className="max-h-32 space-y-1 overflow-y-auto text-xs text-text-2">
                {sollecitaFor.solleciti.map((so: any, i: number) => (
                  <p key={i} className="border-l-2 border-warning/50 pl-2">
                    {new Date(so.data).toLocaleDateString("it-IT")}
                    {so.nota ? ` — ${so.nota}` : ""}
                  </p>
                ))}
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="ticket-sollecito-nota">Nota (a chi / per cosa)</Label>
              <Input
                id="ticket-sollecito-nota"
                autoFocus
                placeholder="Es. sollecitato fornitore Wnd per pezzo di ricambio"
                value={sollecitoNota}
                onChange={e => setSollecitoNota(e.target.value)}
              />
            </div>
            <Button
              type="button"
              className="min-h-12 sm:min-h-11"
              disabled={sollecita.isPending}
              onClick={() =>
                sollecita.mutate({
                  id: sollecitaFor.id,
                  nota: sollecitoNota || undefined,
                })
              }
            >
              {sollecita.isPending ? "Registrazione…" : "Registra sollecito"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Pianifica intervento dialog */}
      <Dialog
        open={!!pianificaFor}
        onOpenChange={o => !o && setPianificaFor(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5 text-sm">
              <CalendarPlus className="h-4 w-4 text-info" aria-hidden="true" />
              Pianifica intervento · {pianificaFor?.oggetto}
            </DialogTitle>
            <DialogDescription>
              L'intervento nasce di tipo assistenza e compare anche in
              Calendario.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ticket-piano-data">Data *</Label>
                <Input
                  id="ticket-piano-data"
                  type="date"
                  value={pianificaForm.data}
                  onChange={e =>
                    setPianificaForm({ ...pianificaForm, data: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ticket-piano-dalle">Dalle</Label>
                <Input
                  id="ticket-piano-dalle"
                  type="time"
                  value={pianificaForm.oraInizio}
                  onChange={e =>
                    setPianificaForm({
                      ...pianificaForm,
                      oraInizio: e.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ticket-piano-alle">Alle</Label>
                <Input
                  id="ticket-piano-alle"
                  type="time"
                  value={pianificaForm.oraFine}
                  onChange={e =>
                    setPianificaForm({
                      ...pianificaForm,
                      oraFine: e.target.value,
                    })
                  }
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ticket-piano-squadra">Squadra</Label>
              <Select
                value={pianificaForm.squadraId || "__none"}
                onValueChange={v =>
                  setPianificaForm({
                    ...pianificaForm,
                    squadraId: v === "__none" ? "" : v,
                  })
                }
              >
                <SelectTrigger id="ticket-piano-squadra">
                  <SelectValue placeholder="Da assegnare" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Da assegnare</SelectItem>
                  {(squadre.data ?? []).map((sq: any) => (
                    <SelectItem key={sq.id} value={String(sq.id)}>
                      {sq.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ticket-piano-note">Note</Label>
              <Textarea
                id="ticket-piano-note"
                rows={2}
                placeholder="Materiale da portare, dettagli..."
                value={pianificaForm.note}
                onChange={e =>
                  setPianificaForm({ ...pianificaForm, note: e.target.value })
                }
              />
            </div>
            <Button
              type="button"
              className="min-h-12 sm:min-h-11"
              disabled={!pianificaForm.data || creaIntervento.isPending}
              onClick={() => {
                const commessa = pianificaFor.commessaId
                  ? commessaById.get(pianificaFor.commessaId)
                  : null;
                creaIntervento.mutate({
                  commessaId: pianificaFor.commessaId ?? null,
                  ticketId: pianificaFor.id,
                  tipo: "assistenza",
                  dataPianificata: pianificaForm.data,
                  oraInizio: pianificaForm.oraInizio || null,
                  oraFine: pianificaForm.oraFine || null,
                  squadraId: pianificaForm.squadraId
                    ? parseInt(pianificaForm.squadraId)
                    : null,
                  indirizzo: commessa?.indirizzo ?? undefined,
                  note: pianificaForm.note
                    ? `[${pianificaFor.oggetto}] ${pianificaForm.note}`
                    : pianificaFor.oggetto,
                });
              }}
            >
              {creaIntervento.isPending
                ? "Pianificazione…"
                : "Pianifica intervento"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={o => !o && setDeleteTarget(null)}
        title="Elimina ticket"
        description={`Eliminare "${deleteTarget?.label}"? Spariscono anche i suoi allegati e i solleciti registrati. Questa azione non puo essere annullata.`}
        confirmLabel="Elimina ticket"
        onConfirm={() => deleteTarget && deleteTicket.mutate(deleteTarget.id)}
      />
    </div>
  );
}

// ── Helper components ──────────────────────────────────────────────────────

function AllegatiCount({ ticketId }: { ticketId: number }) {
  const list = trpc.ticketAllegati.byTicket.useQuery(ticketId);
  // Un conteggio non ancora arrivato non è zero.
  if (list.isPending) return <>allegati…</>;
  if (list.isError) return <>allegati non letti</>;
  const n = list.data?.length ?? 0;
  return (
    <>
      {n} {n === 1 ? "allegato" : "allegati"}
    </>
  );
}

function AllegatiPanel({
  ticketId,
  uploading,
  onUpload,
  onPreview,
  onDownload,
  onDelete,
}: {
  ticketId: number;
  uploading: boolean;
  onUpload: (fl: FileList) => void;
  onPreview: (allegatoId: number) => void;
  onDownload: (allegatoId: number) => void;
  onDelete: (allegatoId: number) => void;
}) {
  const list = trpc.ticketAllegati.byTicket.useQuery(ticketId);

  return (
    <div className="mt-1 space-y-2 rounded-[var(--radius-control)] border border-border-soft bg-surface-2 p-3">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-text-2">
          Allegati{" "}
          {list.isPending
            ? "in caricamento…"
            : list.isError
              ? "non disponibili"
              : `(${list.data?.length ?? 0})`}
        </p>
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-xs text-accent-text hover:underline">
          <Upload className="h-3.5 w-3.5" aria-hidden="true" />
          {uploading ? "Caricamento…" : "Carica file"}
          <input
            type="file"
            multiple
            className="sr-only"
            disabled={uploading}
            onChange={e => {
              if (e.target.files && e.target.files.length > 0) {
                onUpload(e.target.files);
                e.target.value = "";
              }
            }}
          />
        </label>
      </div>
      {list.isError ? (
        <p className="text-xs text-danger">
          Non è stato possibile leggere gli allegati: {list.error.message}
        </p>
      ) : list.data && list.data.length > 0 ? (
        <ul className="space-y-1">
          {list.data.map((a: any) => (
            <li
              key={a.id}
              className="flex min-w-0 items-center gap-2 rounded-[var(--radius-control)] border border-border-soft bg-surface px-2 py-1.5 text-xs"
            >
              <FileIcon
                className="h-3.5 w-3.5 shrink-0 text-text-3"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate font-medium">
                {a.nome}
              </span>
              <span className="shrink-0 tabular-nums text-text-3">
                {(a.size / 1024).toFixed(0)} KB
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => onPreview(a.id)}
                aria-label={`Anteprima di ${a.nome}`}
                title="Anteprima"
              >
                <Eye className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => onDownload(a.id)}
                aria-label={`Scarica ${a.nome}`}
                title="Scarica"
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="dangerGhost"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => onDelete(a.id)}
                aria-label={`Elimina ${a.nome}`}
                title="Elimina"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      ) : list.isPending ? null : (
        <p className="text-xs text-text-3">
          Nessun allegato. Usa «Carica file» per aggiungerne.
        </p>
      )}
    </div>
  );
}
