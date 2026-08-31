import { useMemo, useState, type ReactNode } from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Building2,
  Calendar,
  Home,
  Landmark,
  Mail,
  MapPin,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  Printer,
  Trash2,
  User,
} from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { toast } from "sonner";
import { useLocation, useParams } from "wouter";

import ConfirmDialog from "@/components/ConfirmDialog";
import DataSurface from "@/components/patterns/DataSurface";
import PageHeader from "@/components/patterns/PageHeader";
import StatePanel, {
  type StatePanelProps,
} from "@/components/patterns/StatePanel";
import SearchSelect from "@/components/SearchSelect";
import StatoChip from "@/components/StatoChip";
import WhatsAppButton from "@/components/WhatsAppButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useOperationalContext } from "@/contexts/OperationalContext";
import { personName } from "@/lib/name";
import { customerPermissions } from "@/lib/operationalRoutes";
import { TIPOLOGIE_PRODOTTO } from "@/lib/prodotti";
import { isDirezione } from "@/lib/roles";
import { statoLabel, PRIORITA_LABEL } from "@/lib/stato";
import { trpc } from "@/lib/trpc";
import { FIRMA_WHATSAPP } from "@/lib/whatsapp";

const tipoIcons: Record<string, any> = {
  privato: User,
  azienda: Building2,
  condominio: Home,
  ente_pubblico: Landmark,
};

const tipoLabels: Record<string, string> = {
  privato: "Privato",
  azienda: "Azienda",
  condominio: "Condominio",
  ente_pubblico: "Ente pubblico",
};

const ruoloLabels: Record<string, string> = {
  cliente_finale: "Cliente finale",
  architetto: "Architetto",
  direttore_lavori: "Dir. lavori",
  amministratore: "Amministratore",
  altro: "Altro",
};

const praticaEdiliziaLabels: Record<string, string> = {
  nessuna: "Nessuna pratica edilizia",
  cil: "CIL",
  cila: "CILA",
  scia: "SCIA",
};

type SezioneQuery = {
  isPending: boolean;
  isError: boolean;
  refetch: () => unknown;
};

// Stato di una sezione figlia: caricamento, errore con retry, elenco vuoto.
// Un elenco vuoto per errore non si mostra mai come "nessun record".
function statoSezione(
  query: SezioneQuery,
  copy: {
    erroreTitolo: string;
    erroreDescrizione: string;
    vuotoTitolo: string;
    vuotoDescrizione: string;
  },
  vuoto: boolean,
  azione?: ReactNode
): StatePanelProps | undefined {
  if (query.isPending) {
    return {
      kind: "loading",
      title: "Carico i dati",
      description: "Recupero i record collegati a questo cliente.",
      rows: 3,
    };
  }
  if (query.isError) {
    return {
      kind: "error",
      title: copy.erroreTitolo,
      description: copy.erroreDescrizione,
      action: (
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={() => query.refetch()}
        >
          Riprova
        </Button>
      ),
    };
  }
  if (vuoto) {
    return {
      kind: "empty",
      title: copy.vuotoTitolo,
      description: copy.vuotoDescrizione,
      action: azione,
    };
  }
  return undefined;
}

export default function ClienteDetail() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const clienteId = parseInt(params.id ?? "0");

  // Le capability effettive arrivano dal contesto operativo (unico owner di
  // `permessi.mie`): finché non è `ready` la matrice resta fail-closed.
  const { capabilities, status: operationalStatus } = useOperationalContext();
  const permissions = customerPermissions(
    operationalStatus === "ready" ? capabilities : null
  );
  const currentUser = trpc.auth.me.useQuery();
  // `garanzie.create` è `adminProcedure`, non una capability: qui rispecchiamo
  // il server, non introduciamo una policy client.
  const puoCreareGaranzia = isDirezione(currentUser.data);

  const cliente = trpc.clienti.byId.useQuery(clienteId);
  const commesse = trpc.commesse.list.useQuery({});
  const interventi = trpc.interventi.list.useQuery({});
  const ticketList = trpc.ticket.list.useQuery({});
  const garanzieList = trpc.garanzie.list.useQuery({});
  const utentiList = trpc.utenti.list.useQuery(undefined);

  const utenteOptions = useMemo(
    () =>
      (utentiList.data ?? []).map((u: any) => ({
        value: String(u.id),
        label: personName(u, u.email ?? `Utente ${u.id}`),
        keywords: [u.email, (u.ruoli ?? []).join(" ")]
          .filter(Boolean)
          .join(" "),
        hint: (u.ruoli ?? [])[0],
      })),
    [utentiList.data]
  );

  const utils = trpc.useUtils();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editForm, setEditForm] = useState<any>(null);

  // Add dialogs
  const [addCommessaOpen, setAddCommessaOpen] = useState(false);
  const [addInterventoOpen, setAddInterventoOpen] = useState(false);
  const [addTicketOpen, setAddTicketOpen] = useState(false);
  const [addGaranziaOpen, setAddGaranziaOpen] = useState(false);

  const [commessaForm, setCommessaForm] = useState({
    priorita: "media" as "bassa" | "media" | "alta" | "urgente",
    // "preset" → offset days, "data" → calendar date
    consegnaMode: "preset" as "preset" | "data",
    consegnaIndicativa: "60" as "30" | "60" | "90",
    dataConsegnaIndicativa: "",
    note: "",
    // Di cosa si tratta, dichiarato già qui come nella pagina Commesse.
    prodotti: [] as Array<{ nome: string; quantita: string }>,
  });
  const [interventoForm, setInterventoForm] = useState({
    commessaId: 0,
    tipo: "rilievo",
    dataPianificata: "",
    note: "",
  });
  const [ticketForm, setTicketForm] = useState({
    commessaId: 0,
    oggetto: "",
    descrizione: "",
    categoria: "regolazione",
    priorita: "media" as "bassa" | "media" | "alta" | "urgente",
  });
  const [garanziaForm, setGaranziaForm] = useState({
    commessaId: 0,
    tipo: "prodotto" as "prodotto" | "posa" | "accessorio",
    descrizione: "",
    fornitore: "",
    dataInizio: "",
    dataScadenza: "",
    durataMesi: 120,
  });

  const updateCliente = trpc.clienti.update.useMutation({
    onSuccess: () => {
      utils.clienti.byId.invalidate(clienteId);
      utils.clienti.invalidate();
      setEditOpen(false);
    },
    onError: e => toast.error(e.message ?? "Salvataggio non riuscito"),
  });
  const deleteCliente = trpc.clienti.delete.useMutation({
    onSuccess: () => {
      utils.clienti.invalidate();
      setDeleteOpen(false);
      setLocation("/clienti");
    },
    onError: e => {
      setDeleteOpen(false);
      toast.error(e.message ?? "Eliminazione non riuscita");
    },
  });

  const archiveCliente = trpc.clienti.archive.useMutation({
    onSuccess: () => {
      utils.clienti.invalidate();
      utils.commesse.invalidate();
      toast.success("Cliente archiviato (con le sue commesse)");
    },
    onError: e => toast.error(e.message ?? "Archiviazione non riuscita"),
  });
  const restoreCliente = trpc.clienti.restore.useMutation({
    onSuccess: () => {
      utils.clienti.invalidate();
      utils.commesse.invalidate();
      toast.success("Cliente ripristinato");
    },
    onError: e => toast.error(e.message ?? "Ripristino non riuscito"),
  });

  const createCommessa = trpc.commesse.create.useMutation({
    onSuccess: () => {
      utils.commesse.invalidate();
      utils.clienti.byId.invalidate(clienteId);
      setAddCommessaOpen(false);
      // Azzera i prodotti: restavano nel form e finivano sulla commessa dopo.
      setCommessaForm(f => ({ ...f, prodotti: [], note: "" }));
    },
    onError: e => toast.error(e.message ?? "Creazione non riuscita"),
  });
  const createIntervento = trpc.interventi.create.useMutation({
    onSuccess: () => {
      utils.interventi.invalidate();
      setAddInterventoOpen(false);
    },
    onError: e => toast.error(e.message ?? "Creazione non riuscita"),
  });
  const createTicket = trpc.ticket.create.useMutation({
    onSuccess: () => {
      utils.ticket.invalidate();
      setAddTicketOpen(false);
    },
    onError: e => toast.error(e.message ?? "Creazione non riuscita"),
  });
  const createGaranzia = trpc.garanzie.create.useMutation({
    onSuccess: () => {
      utils.garanzie.invalidate();
      setAddGaranziaOpen(false);
    },
    onError: e => toast.error(e.message ?? "Creazione non riuscita"),
  });

  const c = cliente.data;

  // `byId` risponde `null` sia per un id inesistente sia per un record di
  // un'altra sede: la schermata è la stessa e non rivela nulla dell'id.
  if (!c) {
    const stato: StatePanelProps = cliente.isPending
      ? {
          kind: "loading",
          title: "Carico la scheda",
          description: "Recupero i dati del cliente nella sede attiva.",
          rows: 4,
        }
      : cliente.isError
        ? {
            kind: "error",
            title: "Scheda non caricata",
            description:
              "Non è stato possibile leggere la scheda. Nessun dato è stato modificato.",
            action: (
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => cliente.refetch()}
              >
                Riprova
              </Button>
            ),
          }
        : {
            kind: "empty",
            title: "Cliente non trovato",
            description:
              "Nessun cliente corrisponde a questa scheda nella sede attiva.",
            action: (
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => setLocation("/clienti")}
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Torna ai
                clienti
              </Button>
            ),
          };

    return (
      <div className="min-w-0 space-y-4">
        <StatePanel {...stato} />
      </div>
    );
  }

  const TipoIcon = tipoIcons[c.tipo] ?? User;
  const displayName = personName(c);

  const clienteCommesse =
    commesse.data?.filter((cm: any) => c.commesseIds?.includes(cm.id)) ?? [];

  const commessaIds = clienteCommesse.map((cm: any) => cm.id);

  const clienteInterventi =
    interventi.data?.filter((i: any) => commessaIds.includes(i.commessaId)) ??
    [];
  const clienteTicket =
    ticketList.data?.filter((t: any) => commessaIds.includes(t.commessaId)) ??
    [];
  const clienteGaranzie =
    garanzieList.data?.filter((g: any) => commessaIds.includes(g.commessaId)) ??
    [];

  // ── Scheda cliente PDF ─────────────────────────────────────────────────────
  // One printable A4 with everything the operator needs on site or at the
  // phone: anagrafica, indirizzi, fisco, commesse, appuntamenti, ticket,
  // garanzie e note. jsPDF+autotable (same stack as the preventivatori).
  function exportSchedaPdf() {
    const fmtDate = (iso?: string | null) =>
      iso
        ? new Date(
            iso + (iso.length === 10 ? "T12:00:00" : "")
          ).toLocaleDateString("it-IT")
        : "—";
    const assegnatario = (utentiList.data ?? []).find(
      (u: any) => u.id === c!.assegnatoA
    );
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const marginX = 14;
    const accent: [number, number, number] = [37, 99, 235];
    let y = 16;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(`Scheda cliente — ${displayName}`, marginX, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(110);
    doc.text(
      `Generata il ${new Date().toLocaleDateString("it-IT")} alle ${new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })} — Ruffino Flow`,
      marginX,
      y
    );
    doc.setTextColor(0);
    y += 4;

    const section = (title: string) => {
      if (y > 262) {
        doc.addPage();
        y = 16;
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(title, marginX, y + 4);
      doc.setFont("helvetica", "normal");
      y += 7;
    };

    const resRow = c!.indirizzo
      ? `${c!.indirizzo}${c!.cap ? `, ${c!.cap}` : ""}${c!.citta ? ` ${c!.citta}` : ""}`
      : "—";
    const lavRow =
      c!.indirizzoLavoro || c!.cittaLavoro
        ? `${c!.indirizzoLavoro || c!.indirizzo || ""}${c!.capLavoro ? `, ${c!.capLavoro}` : ""}${
            c!.cittaLavoro || c!.citta ? ` ${c!.cittaLavoro || c!.citta}` : ""
          }`.trim()
        : "Come residenza";

    autoTable(doc, {
      startY: y,
      head: [["Anagrafica", ""]],
      body: [
        ["Tipo", tipoLabels[c!.tipo ?? "privato"] ?? c!.tipo ?? "—"],
        ["Telefono", c!.telefono || "—"],
        ["Email", c!.email || "—"],
        ["Codice fiscale", c!.codiceFiscale || "—"],
        ["Partita IVA", c!.partitaIva || "—"],
        [
          c!.tipo === "privato"
            ? "Residenza (fatturazione)"
            : "Sede legale (fatturazione)",
          resRow,
        ],
        ["Indirizzo lavori", lavRow],
        [
          "Detrazione fiscale",
          c!.detrazione ? c!.tipoDetrazione || "Sì" : "No",
        ],
        [
          "Pratica edilizia",
          praticaEdiliziaLabels[c!.praticaEdilizia ?? "nessuna"] ??
            c!.praticaEdilizia ??
            "Nessuna",
        ],
        ["Finanziamento", c!.interesseFinanziamento ? "Interessato" : "No"],
        ["Assegnato a", personName(assegnatario, "—")],
      ],
      theme: "grid",
      styles: { fontSize: 9, cellPadding: 1.8 },
      headStyles: { fillColor: accent, fontSize: 10 },
      columnStyles: { 0: { fontStyle: "bold", cellWidth: 52 } },
      margin: { left: marginX, right: marginX },
    });
    y = (doc as any).lastAutoTable.finalY + 5;

    if (c!.note) {
      autoTable(doc, {
        startY: y,
        head: [["Note"]],
        body: [[c!.note]],
        theme: "grid",
        styles: { fontSize: 9, cellPadding: 1.8 },
        headStyles: { fillColor: accent, fontSize: 10 },
        margin: { left: marginX, right: marginX },
      });
      y = (doc as any).lastAutoTable.finalY + 5;
    }

    if (clienteCommesse.length > 0) {
      section(`Commesse (${clienteCommesse.length})`);
      autoTable(doc, {
        startY: y,
        head: [["Codice", "Stato", "Priorità", "Città", "Consegna"]],
        body: clienteCommesse.map((cm: any) => [
          cm.codice ?? `#${cm.id}`,
          statoLabel(cm.stato ?? ""),
          PRIORITA_LABEL[cm.priorita] ?? cm.priorita ?? "—",
          cm.citta || "—",
          cm.dataConsegnaConfermata
            ? fmtDate(cm.dataConsegnaConfermata)
            : cm.dataConsegnaIndicativa
              ? `${fmtDate(cm.dataConsegnaIndicativa)} (indicativa)`
              : cm.consegnaIndicativa
                ? `~${cm.consegnaIndicativa} gg`
                : "—",
        ]),
        theme: "striped",
        styles: { fontSize: 8.5, cellPadding: 1.6 },
        headStyles: { fillColor: accent, fontSize: 9 },
        margin: { left: marginX, right: marginX },
      });
      y = (doc as any).lastAutoTable.finalY + 5;
    }

    const appuntamenti = [...clienteInterventi].sort((a: any, b: any) =>
      (a.dataPianificata ?? "").localeCompare(b.dataPianificata ?? "")
    );
    if (appuntamenti.length > 0) {
      section(`Appuntamenti (${appuntamenti.length})`);
      autoTable(doc, {
        startY: y,
        head: [["Data", "Ora", "Tipo", "Stato", "Note"]],
        body: appuntamenti.map((i: any) => [
          fmtDate(i.dataPianificata),
          i.oraInizio
            ? `${i.oraInizio}${i.oraFine ? `–${i.oraFine}` : ""}`
            : "—",
          (i.tipo ?? "").replace(/_/g, " "),
          (i.stato ?? "pianificato").replace(/_/g, " "),
          i.note || "",
        ]),
        theme: "striped",
        styles: { fontSize: 8.5, cellPadding: 1.6 },
        headStyles: { fillColor: accent, fontSize: 9 },
        margin: { left: marginX, right: marginX },
      });
      y = (doc as any).lastAutoTable.finalY + 5;
    }

    if (clienteTicket.length > 0) {
      section(`Ticket assistenza (${clienteTicket.length})`);
      autoTable(doc, {
        startY: y,
        head: [["#", "Oggetto", "Categoria", "Priorità", "Stato"]],
        body: clienteTicket.map((t: any) => [
          `#${t.id}`,
          t.oggetto ?? "—",
          (t.categoria ?? "").replace(/_/g, " "),
          PRIORITA_LABEL[t.priorita] ?? t.priorita ?? "—",
          (t.stato ?? "").replace(/_/g, " "),
        ]),
        theme: "striped",
        styles: { fontSize: 8.5, cellPadding: 1.6 },
        headStyles: { fillColor: accent, fontSize: 9 },
        margin: { left: marginX, right: marginX },
      });
      y = (doc as any).lastAutoTable.finalY + 5;
    }

    if (clienteGaranzie.length > 0) {
      section(`Garanzie (${clienteGaranzie.length})`);
      autoTable(doc, {
        startY: y,
        head: [["Tipo", "Descrizione", "Fornitore", "Scadenza"]],
        body: clienteGaranzie.map((g: any) => [
          g.tipo ?? "—",
          g.descrizione ?? "—",
          g.fornitore || "—",
          fmtDate(g.dataScadenza),
        ]),
        theme: "striped",
        styles: { fontSize: 8.5, cellPadding: 1.6 },
        headStyles: { fillColor: accent, fontSize: 9 },
        margin: { left: marginX, right: marginX },
      });
    }

    const slug =
      displayName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || `cliente-${c!.id}`;
    doc.save(`scheda-cliente-${slug}.pdf`);
  }

  function apriModifica() {
    setEditForm({
      nome: c!.nome ?? "",
      cognome: c!.cognome ?? "",
      tipo: c!.tipo ?? "privato",
      indirizzo: c!.indirizzo ?? "",
      citta: c!.citta ?? "",
      cap: c!.cap ?? "",
      indirizzoLavoro: c!.indirizzoLavoro ?? "",
      cittaLavoro: c!.cittaLavoro ?? "",
      capLavoro: c!.capLavoro ?? "",
      // If no lavoro fields persisted yet → assume same as residenza.
      lavoroStessoResidenza:
        !c!.indirizzoLavoro && !c!.cittaLavoro && !c!.capLavoro,
      telefono: c!.telefono ?? "",
      email: c!.email ?? "",
      codiceFiscale: c!.codiceFiscale ?? "",
      partitaIva: c!.partitaIva ?? "",
      detrazione: !!c!.detrazione,
      tipoDetrazione: c!.tipoDetrazione ?? "",
      interesseFinanziamento: !!c!.interesseFinanziamento,
      praticaEdilizia: c!.praticaEdilizia ?? "nessuna",
      assegnatoA: c!.assegnatoA != null ? String(c!.assegnatoA) : "",
      note: c!.note ?? "",
    });
    setEditOpen(true);
  }

  const statoCommesse = statoSezione(
    commesse,
    {
      erroreTitolo: "Commesse non caricate",
      erroreDescrizione:
        "Non è stato possibile leggere le commesse. Nessun dato è stato modificato.",
      vuotoTitolo: "Nessuna commessa collegata",
      vuotoDescrizione: permissions.canCreateCommessa
        ? "Apri la prima commessa per questo cliente: indirizzo e contatti vengono precompilati dalla scheda."
        : "Quando verrà aperta una commessa per questo cliente la troverai qui.",
    },
    clienteCommesse.length === 0,
    permissions.canCreateCommessa ? (
      <Button
        type="button"
        className="min-h-11"
        onClick={() => setAddCommessaOpen(true)}
      >
        <Plus className="h-4 w-4" aria-hidden="true" /> Nuova commessa
      </Button>
    ) : undefined
  );

  // Interventi, ticket e garanzie si collegano al cliente attraverso le sue
  // commesse: senza quell'elenco un risultato vuoto non significa "nessuno".
  // Vale anche mentre le commesse stanno arrivando: le query figlie possono
  // risolvere prima e dichiarerebbero "nessun record" su un cliente che ne ha.
  const collegamentoIgnoto: StatePanelProps | undefined = commesse.isPending
    ? {
        kind: "loading",
        title: "Carico i dati",
        description: "Recupero le commesse che collegano i record al cliente.",
        rows: 3,
      }
    : commesse.isError
      ? {
          kind: "unavailable",
          title: "Collegamento alle commesse non disponibile",
          description:
            "Senza l'elenco delle commesse non è possibile sapere quali record appartengono a questo cliente.",
          action: (
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => commesse.refetch()}
            >
              Riprova
            </Button>
          ),
        }
      : undefined;

  const statoInterventi = statoSezione(
    interventi,
    {
      erroreTitolo: "Interventi non caricati",
      erroreDescrizione:
        "Non è stato possibile leggere gli interventi. Nessun dato è stato modificato.",
      vuotoTitolo: "Nessun intervento pianificato",
      vuotoDescrizione:
        clienteCommesse.length === 0
          ? "Gli interventi si pianificano su una commessa: apri prima una commessa per questo cliente."
          : "Pianifica rilievi, pose e assistenze sulle commesse di questo cliente.",
    },
    clienteInterventi.length === 0
  );

  const statoTicket = statoSezione(
    ticketList,
    {
      erroreTitolo: "Ticket non caricati",
      erroreDescrizione:
        "Non è stato possibile leggere i ticket. Nessun dato è stato modificato.",
      vuotoTitolo: "Nessun ticket aperto",
      vuotoDescrizione:
        clienteCommesse.length === 0
          ? "I ticket si aprono su una commessa: apri prima una commessa per questo cliente."
          : "Le richieste di assistenza aperte su questo cliente compariranno qui.",
    },
    clienteTicket.length === 0
  );

  const statoGaranzie = statoSezione(
    garanzieList,
    {
      erroreTitolo: "Garanzie non caricate",
      erroreDescrizione:
        "Non è stato possibile leggere le garanzie. Nessun dato è stato modificato.",
      vuotoTitolo: "Nessuna garanzia registrata",
      vuotoDescrizione:
        "Le garanzie su prodotto, posa e accessori si registrano sulle commesse del cliente.",
    },
    clienteGaranzie.length === 0
  );

  const indirizzoLavoro = c.indirizzoLavoro || c.cittaLavoro;

  return (
    <div className="min-w-0 space-y-4 sm:space-y-5">
      <PageHeader
        variant="record"
        breadcrumbs={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-2 min-h-11"
            onClick={() => setLocation("/clienti")}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Clienti
          </Button>
        }
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <TipoIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {tipoLabels[c.tipo] ?? c.tipo}
          </span>
        }
        title={displayName || `Cliente ${c.id}`}
        busy={cliente.isFetching}
        warning={
          c.archivedAt ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              <Archive className="h-4 w-4 shrink-0" aria-hidden="true" />
              Cliente archiviato il{" "}
              {new Date(c.archivedAt).toLocaleDateString("it-IT")} — anche le
              sue commesse sono archiviate.
              {permissions.canArchiveCustomer
                ? " Ripristina per renderlo di nuovo attivo."
                : ""}
            </span>
          ) : null
        }
        metadata={
          <>
            {c.detrazione ? (
              <Badge variant="info" className="capitalize">
                Detrazione{c.tipoDetrazione ? `: ${c.tipoDetrazione}` : ""}
              </Badge>
            ) : null}
            {c.interesseFinanziamento ? (
              <Badge variant="secondary">Finanziamento</Badge>
            ) : null}
            {c.praticaEdilizia && c.praticaEdilizia !== "nessuna" ? (
              <Badge variant="secondary">
                {praticaEdiliziaLabels[c.praticaEdilizia] ?? c.praticaEdilizia}
              </Badge>
            ) : null}
            {c.indirizzo ? (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="eyebrow text-text-3">
                  {c.tipo === "privato" ? "Residenza" : "Sede legale"}
                </span>
                <span className="min-w-0 truncate">
                  {c.indirizzo}
                  {c.cap ? `, ${c.cap}` : ""} {c.citta ?? ""}
                </span>
              </span>
            ) : null}
            {indirizzoLavoro ? (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="eyebrow text-text-3">Lavoro</span>
                <span className="min-w-0 truncate">
                  {c.indirizzoLavoro || c.indirizzo}
                  {c.capLavoro ? `, ${c.capLavoro}` : ""}
                  {c.cittaLavoro || c.citta
                    ? ` ${c.cittaLavoro || c.citta}`
                    : ""}
                </span>
              </span>
            ) : null}
            {c.telefono ? (
              <span className="inline-flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="tabular-nums">{c.telefono}</span>
                <WhatsAppButton
                  phone={c.telefono}
                  message={`Buongiorno${displayName ? ` ${displayName}` : ""}, la contattiamo da Ruffino Group in merito alla sua pratica.\n${FIRMA_WHATSAPP}`}
                />
              </span>
            ) : null}
            {c.email ? (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 truncate">{c.email}</span>
              </span>
            ) : null}
            {c.codiceFiscale ? (
              <span className="tabular-nums">CF {c.codiceFiscale}</span>
            ) : null}
            {c.partitaIva ? (
              <span className="tabular-nums">P.IVA {c.partitaIva}</span>
            ) : null}
          </>
        }
        primaryAction={
          permissions.canUpdateCustomer ? (
            <Button type="button" className="min-h-11" onClick={apriModifica}>
              <Pencil className="h-4 w-4" aria-hidden="true" /> Modifica
            </Button>
          ) : undefined
        }
        secondaryActions={
          <>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={exportSchedaPdf}
            >
              <Printer className="h-4 w-4" aria-hidden="true" /> Scheda PDF
            </Button>
            {c.archivedAt ? (
              permissions.canArchiveCustomer ? (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => restoreCliente.mutate(clienteId)}
                  disabled={restoreCliente.isPending}
                >
                  <ArchiveRestore className="h-4 w-4" aria-hidden="true" />{" "}
                  Ripristina
                </Button>
              ) : null
            ) : permissions.canArchiveCustomer ||
              permissions.canDeleteCustomer ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="min-h-11 min-w-11 text-text-3"
                    aria-label="Altre azioni sul cliente"
                    title="Altre azioni sul cliente"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {permissions.canArchiveCustomer ? (
                    <DropdownMenuItem
                      onClick={() => archiveCliente.mutate(clienteId)}
                    >
                      <Archive className="h-4 w-4" /> Archivia
                    </DropdownMenuItem>
                  ) : null}
                  {permissions.canDeleteCustomer ? (
                    <>
                      {permissions.canArchiveCustomer ? (
                        <DropdownMenuSeparator />
                      ) : null}
                      <DropdownMenuItem
                        className="text-danger focus:text-danger"
                        onClick={() => setDeleteOpen(true)}
                      >
                        <Trash2 className="h-4 w-4" /> Elimina
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </>
        }
      />

      {c.note ? (
        <DataSurface density="compact" tone="sunken" title="Note">
          <p className="min-w-0 whitespace-pre-line text-sm text-text-2">
            {c.note}
          </p>
        </DataSurface>
      ) : null}

      {c.referenti?.length > 0 ? (
        <DataSurface
          density="compact"
          tone="default"
          title={`Referenti (${c.referenti.length})`}
          description="Chi risponde per questo cliente durante la commessa."
        >
          <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {c.referenti.map((r: any, idx: number) => (
              <div
                key={idx}
                className="min-w-0 space-y-1 rounded-[var(--radius-control)] border border-border-soft p-3"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="min-w-0 truncate text-sm font-semibold text-text-1">
                    {r.nome}
                  </span>
                  <Badge variant="secondary" className="text-[10px]">
                    {ruoloLabels[r.ruolo] ?? r.ruolo}
                  </Badge>
                </div>
                {r.telefono ? (
                  <p className="flex min-w-0 items-center gap-1.5 text-xs tabular-nums text-text-2">
                    <Phone className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 truncate">{r.telefono}</span>
                  </p>
                ) : null}
                {r.email ? (
                  <p className="flex min-w-0 items-center gap-1.5 text-xs text-text-2">
                    <Mail className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 truncate">{r.email}</span>
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </DataSurface>
      ) : null}

      <Tabs defaultValue="commesse" className="min-w-0">
        <TabsList className="h-auto w-full flex-wrap justify-start">
          <TabsTrigger value="commesse" className="min-h-11 flex-1 basis-32">
            Commesse ({clienteCommesse.length})
          </TabsTrigger>
          <TabsTrigger value="interventi" className="min-h-11 flex-1 basis-32">
            Interventi ({clienteInterventi.length})
          </TabsTrigger>
          <TabsTrigger value="ticket" className="min-h-11 flex-1 basis-32">
            Ticket ({clienteTicket.length})
          </TabsTrigger>
          <TabsTrigger value="garanzie" className="min-h-11 flex-1 basis-32">
            Garanzie ({clienteGaranzie.length})
          </TabsTrigger>
        </TabsList>

        {/* Commesse */}
        <TabsContent value="commesse" className="mt-3 min-w-0">
          <DataSurface
            density="compact"
            tone="sunken"
            title="Commesse del cliente"
            state={statoCommesse}
            toolbar={
              permissions.canCreateCommessa ? (
                <Button
                  type="button"
                  className="min-h-11"
                  onClick={() => setAddCommessaOpen(true)}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" /> Nuova commessa
                </Button>
              ) : null
            }
          >
            <ul className="grid min-w-0 gap-2">
              {clienteCommesse.map((cm: any) => (
                <li key={cm.id} className="min-w-0">
                  <button
                    type="button"
                    className="flex min-h-12 w-full min-w-0 items-start justify-between gap-3 rounded-[var(--radius-control)] border border-border-soft bg-surface p-3 text-left"
                    onClick={() => setLocation(`/commesse/${cm.id}`)}
                  >
                    <span className="min-w-0 space-y-1">
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="codice-mono text-xs text-text-3">
                          {cm.codice}
                        </span>
                        <StatoChip stato={cm.stato} />
                        {cm.priorita === "urgente" ? (
                          <Badge variant="destructive">Urgente</Badge>
                        ) : null}
                      </span>
                      {(cm.prodottiSintesi?.length ?? 0) > 0 ? (
                        <span className="flex min-w-0 flex-wrap items-center gap-1">
                          {cm.prodottiSintesi.map((pr: any, i: number) => (
                            <Badge
                              key={i}
                              variant="outline"
                              className="text-[10px] font-normal"
                            >
                              {pr.quantita > 1 ? (
                                <span className="mr-1 font-semibold tabular-nums">
                                  {pr.quantita}×
                                </span>
                              ) : null}
                              {pr.nome}
                            </Badge>
                          ))}
                        </span>
                      ) : null}
                      {cm.indirizzo ? (
                        <span className="flex min-w-0 items-center gap-1.5 text-xs text-text-2">
                          <MapPin
                            className="h-3 w-3 shrink-0"
                            aria-hidden="true"
                          />
                          <span className="min-w-0 truncate">
                            {cm.indirizzo}
                            {cm.citta ? `, ${cm.citta}` : ""}
                          </span>
                        </span>
                      ) : null}
                    </span>
                    {cm.dataConsegnaConfermata ||
                    cm.dataConsegnaIndicativa ||
                    cm.consegnaIndicativa ? (
                      <span className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-text-2">
                        <Calendar className="h-3 w-3" aria-hidden="true" />
                        {cm.dataConsegnaConfermata
                          ? cm.dataConsegnaConfermata
                          : cm.dataConsegnaIndicativa
                            ? new Date(
                                cm.dataConsegnaIndicativa
                              ).toLocaleDateString("it-IT")
                            : `+${cm.consegnaIndicativa}gg`}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </DataSurface>
        </TabsContent>

        {/* Interventi */}
        <TabsContent value="interventi" className="mt-3 min-w-0">
          <DataSurface
            density="compact"
            tone="sunken"
            title="Interventi pianificati"
            state={collegamentoIgnoto ?? statoInterventi}
            toolbar={
              permissions.canPlanIntervento ? (
                <Button
                  type="button"
                  className="min-h-11"
                  disabled={clienteCommesse.length === 0}
                  title={
                    clienteCommesse.length === 0
                      ? "Serve almeno una commessa per pianificare un intervento"
                      : undefined
                  }
                  onClick={() => {
                    setInterventoForm({
                      ...interventoForm,
                      commessaId: clienteCommesse[0]?.id ?? 0,
                    });
                    setAddInterventoOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" /> Nuovo
                  intervento
                </Button>
              ) : null
            }
          >
            <ul className="grid min-w-0 gap-2">
              {clienteInterventi.map((i: any) => (
                <li
                  key={i.id}
                  className="min-w-0 space-y-1 rounded-[var(--radius-control)] border border-border-soft bg-surface p-3"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Badge variant="outline">{i.tipo}</Badge>
                    <Badge
                      variant={
                        i.stato === "completato" ? "secondary" : "default"
                      }
                    >
                      {(i.stato ?? "").replace(/_/g, " ")}
                    </Badge>
                    {i.dataPianificata ? (
                      <span className="inline-flex items-center gap-1 text-xs tabular-nums text-text-2">
                        <Calendar className="h-3 w-3" aria-hidden="true" />
                        {i.dataPianificata}
                      </span>
                    ) : null}
                  </div>
                  {i.note ? (
                    <p className="min-w-0 text-sm text-text-2">{i.note}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </DataSurface>
        </TabsContent>

        {/* Ticket */}
        <TabsContent value="ticket" className="mt-3 min-w-0">
          <DataSurface
            density="compact"
            tone="sunken"
            title="Ticket di assistenza"
            state={collegamentoIgnoto ?? statoTicket}
            toolbar={
              permissions.canCreateTicket ? (
                <Button
                  type="button"
                  className="min-h-11"
                  disabled={clienteCommesse.length === 0}
                  title={
                    clienteCommesse.length === 0
                      ? "Serve almeno una commessa per aprire un ticket"
                      : undefined
                  }
                  onClick={() => {
                    setTicketForm({
                      ...ticketForm,
                      commessaId: clienteCommesse[0]?.id ?? 0,
                    });
                    setAddTicketOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" /> Nuovo ticket
                </Button>
              ) : null
            }
          >
            <ul className="grid min-w-0 gap-2">
              {clienteTicket.map((t: any) => (
                <li
                  key={t.id}
                  className="min-w-0 space-y-1 rounded-[var(--radius-control)] border border-border-soft bg-surface p-3"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Badge variant="outline">
                      {(t.categoria ?? "").replace(/_/g, " ")}
                    </Badge>
                    <Badge
                      variant={
                        t.priorita === "alta" || t.priorita === "urgente"
                          ? "destructive"
                          : "secondary"
                      }
                    >
                      {PRIORITA_LABEL[t.priorita] ?? t.priorita}
                    </Badge>
                    <Badge variant="secondary">
                      {(t.stato ?? "").replace(/_/g, " ")}
                    </Badge>
                  </div>
                  <p className="min-w-0 text-sm font-semibold text-text-1">
                    {t.oggetto}
                  </p>
                  {t.descrizione ? (
                    <p className="min-w-0 text-xs text-text-2">
                      {t.descrizione}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </DataSurface>
        </TabsContent>

        {/* Garanzie */}
        <TabsContent value="garanzie" className="mt-3 min-w-0">
          <DataSurface
            density="compact"
            tone="sunken"
            title="Garanzie attive"
            state={collegamentoIgnoto ?? statoGaranzie}
            toolbar={
              // `garanzie.create` resta direzione: specchio UX di adminProcedure.
              puoCreareGaranzia ? (
                <Button
                  type="button"
                  className="min-h-11"
                  disabled={clienteCommesse.length === 0}
                  title={
                    clienteCommesse.length === 0
                      ? "Serve almeno una commessa per registrare una garanzia"
                      : undefined
                  }
                  onClick={() => {
                    setGaranziaForm({
                      ...garanziaForm,
                      commessaId: clienteCommesse[0]?.id ?? 0,
                    });
                    setAddGaranziaOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" /> Nuova garanzia
                </Button>
              ) : null
            }
          >
            <ul className="grid min-w-0 gap-2">
              {clienteGaranzie.map((g: any) => (
                <li
                  key={g.id}
                  className="flex min-w-0 flex-wrap items-start justify-between gap-3 rounded-[var(--radius-control)] border border-border-soft bg-surface p-3"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="min-w-0 text-sm font-semibold text-text-1">
                      {g.descrizione}
                    </p>
                    <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-text-2">
                      <Badge variant="outline" className="text-[10px]">
                        {g.tipo}
                      </Badge>
                      <span className="tabular-nums">
                        {g.dataInizio} — {g.dataScadenza}
                      </span>
                      {g.fornitore ? <span>{g.fornitore}</span> : null}
                    </div>
                  </div>
                  <Badge
                    variant={g.stato === "attiva" ? "default" : "secondary"}
                  >
                    {g.stato}
                  </Badge>
                </li>
              ))}
            </ul>
          </DataSurface>
        </TabsContent>
      </Tabs>

      {/* Modifica: montata solo con `cliente.update_operational`. */}
      {permissions.canUpdateCustomer ? (
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Modifica cliente</DialogTitle>
            </DialogHeader>
            {editForm && (
              <div className="grid gap-3 py-2">
                {editForm.tipo === "privato" ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Cognome</Label>
                      <Input
                        value={editForm.cognome}
                        onChange={e =>
                          setEditForm({ ...editForm, cognome: e.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Nome</Label>
                      <Input
                        value={editForm.nome}
                        onChange={e =>
                          setEditForm({ ...editForm, nome: e.target.value })
                        }
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label>Ragione sociale</Label>
                    <Input
                      value={editForm.cognome}
                      onChange={e =>
                        setEditForm({
                          ...editForm,
                          cognome: e.target.value,
                          nome: " ",
                        })
                      }
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label>Tipo</Label>
                  <Select
                    value={editForm.tipo}
                    onValueChange={v => setEditForm({ ...editForm, tipo: v })}
                  >
                    <SelectTrigger aria-label="Tipo di cliente">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="privato">Privato</SelectItem>
                      <SelectItem value="azienda">Azienda</SelectItem>
                      <SelectItem value="condominio">Condominio</SelectItem>
                      <SelectItem value="ente_pubblico">
                        Ente pubblico
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {/* Residenza */}
                <div className="space-y-3 rounded-[var(--radius-control)] border border-border-soft p-3">
                  <div className="eyebrow text-text-3">
                    {editForm.tipo === "privato"
                      ? "Indirizzo di residenza (fatturazione)"
                      : "Sede legale (fatturazione)"}
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label>Indirizzo</Label>
                      <Input
                        value={editForm.indirizzo}
                        onChange={e =>
                          setEditForm({
                            ...editForm,
                            indirizzo: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>CAP</Label>
                      <Input
                        value={editForm.cap}
                        onChange={e =>
                          setEditForm({ ...editForm, cap: e.target.value })
                        }
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Città</Label>
                    <Input
                      value={editForm.citta}
                      onChange={e =>
                        setEditForm({ ...editForm, citta: e.target.value })
                      }
                    />
                  </div>
                </div>
                {/* Lavoro */}
                <div className="space-y-3 rounded-[var(--radius-control)] border border-border-soft p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="eyebrow text-text-3">
                      Indirizzo dove va effettuato il lavoro
                    </div>
                    <label className="flex shrink-0 items-center gap-2 text-xs">
                      <Switch
                        checked={editForm.lavoroStessoResidenza}
                        onCheckedChange={v =>
                          setEditForm({
                            ...editForm,
                            lavoroStessoResidenza: v,
                          })
                        }
                      />
                      <span className="text-text-2">
                        {editForm.tipo === "privato"
                          ? "Stesso della residenza"
                          : "Stessa della sede legale"}
                      </span>
                    </label>
                  </div>
                  {!editForm.lavoroStessoResidenza && (
                    <>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label>Indirizzo lavoro</Label>
                          <Input
                            value={editForm.indirizzoLavoro}
                            onChange={e =>
                              setEditForm({
                                ...editForm,
                                indirizzoLavoro: e.target.value,
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>CAP</Label>
                          <Input
                            value={editForm.capLavoro}
                            onChange={e =>
                              setEditForm({
                                ...editForm,
                                capLavoro: e.target.value,
                              })
                            }
                          />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Città lavoro</Label>
                        <Input
                          value={editForm.cittaLavoro}
                          onChange={e =>
                            setEditForm({
                              ...editForm,
                              cittaLavoro: e.target.value,
                            })
                          }
                        />
                      </div>
                    </>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Telefono</Label>
                    <Input
                      value={editForm.telefono}
                      onChange={e =>
                        setEditForm({ ...editForm, telefono: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Email</Label>
                    <Input
                      value={editForm.email}
                      onChange={e =>
                        setEditForm({ ...editForm, email: e.target.value })
                      }
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Codice fiscale</Label>
                    <Input
                      value={editForm.codiceFiscale}
                      onChange={e =>
                        setEditForm({
                          ...editForm,
                          codiceFiscale: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Partita IVA</Label>
                    <Input
                      value={editForm.partitaIva}
                      onChange={e =>
                        setEditForm({ ...editForm, partitaIva: e.target.value })
                      }
                    />
                  </div>
                </div>
                <div className="space-y-3 rounded-[var(--radius-control)] border border-border-soft p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">
                        Detrazione fiscale
                      </div>
                      <div className="text-xs text-text-2">
                        Il cliente vuole usufruirne?
                      </div>
                    </div>
                    <Switch
                      checked={editForm.detrazione}
                      onCheckedChange={v =>
                        setEditForm({
                          ...editForm,
                          detrazione: v,
                          tipoDetrazione: v ? editForm.tipoDetrazione : "",
                        })
                      }
                    />
                  </div>
                  {editForm.detrazione && (
                    <div className="space-y-1.5">
                      <Label>Quale detrazione</Label>
                      <Select
                        value={editForm.tipoDetrazione}
                        onValueChange={(v: any) =>
                          setEditForm({ ...editForm, tipoDetrazione: v })
                        }
                      >
                        <SelectTrigger aria-label="Tipo di detrazione">
                          <SelectValue placeholder="Seleziona detrazione..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ecobonus">Ecobonus</SelectItem>
                          <SelectItem value="ristrutturazione">
                            Ristrutturazione
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between rounded-[var(--radius-control)] border border-border-soft p-3">
                  <div className="text-sm font-medium">Finanziamento</div>
                  <Switch
                    checked={editForm.interesseFinanziamento}
                    onCheckedChange={v =>
                      setEditForm({ ...editForm, interesseFinanziamento: v })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Pratica edilizia</Label>
                  <Select
                    value={editForm.praticaEdilizia}
                    onValueChange={v =>
                      setEditForm({ ...editForm, praticaEdilizia: v })
                    }
                  >
                    <SelectTrigger aria-label="Pratica edilizia">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="nessuna">
                        Nessuna pratica edilizia
                      </SelectItem>
                      <SelectItem value="cil">CIL</SelectItem>
                      <SelectItem value="cila">CILA</SelectItem>
                      <SelectItem value="scia">SCIA</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {/* L'assegnatario richiede `cliente.assign`: senza capability
                    il campo non compare e non entra nel payload. */}
                {permissions.canAssignCustomer ? (
                  <div className="space-y-1.5">
                    <Label>Assegnato a</Label>
                    <SearchSelect
                      options={utenteOptions}
                      value={editForm.assegnatoA ?? ""}
                      onChange={v =>
                        setEditForm({ ...editForm, assegnatoA: v })
                      }
                      placeholder="Nessuno"
                      searchPlaceholder="Cerca utente…"
                      allowClear
                      clearLabel="— Non assegnato —"
                    />
                  </div>
                ) : null}
                <div className="space-y-1.5">
                  <Label>Note</Label>
                  <Textarea
                    rows={2}
                    value={editForm.note}
                    onChange={e =>
                      setEditForm({ ...editForm, note: e.target.value })
                    }
                  />
                </div>
                {updateCliente.error ? (
                  <p
                    role="alert"
                    className="rounded-[var(--radius-control)] border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
                  >
                    {updateCliente.error.message}
                  </p>
                ) : null}
                <Button
                  type="button"
                  className="min-h-11"
                  onClick={() => {
                    const lavoroSame = editForm.lavoroStessoResidenza;
                    updateCliente.mutate({
                      id: clienteId,
                      nome: editForm.nome,
                      cognome: editForm.cognome,
                      tipo: editForm.tipo as any,
                      indirizzo: editForm.indirizzo || undefined,
                      citta: editForm.citta || undefined,
                      cap: editForm.cap || undefined,
                      indirizzoLavoro:
                        (lavoroSame
                          ? editForm.indirizzo
                          : editForm.indirizzoLavoro) || undefined,
                      cittaLavoro:
                        (lavoroSame ? editForm.citta : editForm.cittaLavoro) ||
                        undefined,
                      capLavoro:
                        (lavoroSame ? editForm.cap : editForm.capLavoro) ||
                        undefined,
                      telefono: editForm.telefono || undefined,
                      email: editForm.email || undefined,
                      codiceFiscale: editForm.codiceFiscale || undefined,
                      partitaIva: editForm.partitaIva || undefined,
                      detrazione: editForm.detrazione,
                      tipoDetrazione:
                        editForm.detrazione && editForm.tipoDetrazione
                          ? (editForm.tipoDetrazione as
                              | "ecobonus"
                              | "ristrutturazione")
                          : null,
                      interesseFinanziamento: editForm.interesseFinanziamento,
                      praticaEdilizia: editForm.praticaEdilizia,
                      note: editForm.note || undefined,
                      // Un `assegnatoA` non autorizzato non viaggia mai: il
                      // router richiede `cliente.assign` appena il campo esiste.
                      ...(permissions.canAssignCustomer
                        ? {
                            assegnatoA: editForm.assegnatoA
                              ? parseInt(editForm.assegnatoA, 10)
                              : null,
                          }
                        : {}),
                    });
                  }}
                  disabled={updateCliente.isPending}
                >
                  Salva modifiche
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      ) : null}

      {/* Add Commessa dialog */}
      {permissions.canCreateCommessa ? (
        <Dialog open={addCommessaOpen} onOpenChange={setAddCommessaOpen}>
          <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-md overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Nuova commessa per {displayName}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="text-xs text-text-2">
                Codice commessa assegnato automaticamente
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Priorità</Label>
                  <Select
                    value={commessaForm.priorita}
                    onValueChange={(v: any) =>
                      setCommessaForm({ ...commessaForm, priorita: v })
                    }
                  >
                    <SelectTrigger aria-label="Priorità">
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
                <div className="space-y-1.5">
                  <Label>Consegna indicativa</Label>
                  <Select
                    value={
                      commessaForm.consegnaMode === "data"
                        ? "data"
                        : commessaForm.consegnaIndicativa
                    }
                    onValueChange={(v: any) => {
                      if (v === "data") {
                        setCommessaForm({
                          ...commessaForm,
                          consegnaMode: "data",
                        });
                      } else {
                        setCommessaForm({
                          ...commessaForm,
                          consegnaMode: "preset",
                          consegnaIndicativa: v,
                        });
                      }
                    }}
                  >
                    <SelectTrigger aria-label="Consegna indicativa">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="30">+30 giorni</SelectItem>
                      <SelectItem value="60">+60 giorni</SelectItem>
                      <SelectItem value="90">+90 giorni</SelectItem>
                      <SelectItem value="data">Data da calendario…</SelectItem>
                    </SelectContent>
                  </Select>
                  {commessaForm.consegnaMode === "data" && (
                    <Input
                      type="date"
                      aria-label="Data di consegna indicativa"
                      value={commessaForm.dataConsegnaIndicativa}
                      onChange={e =>
                        setCommessaForm({
                          ...commessaForm,
                          dataConsegnaIndicativa: e.target.value,
                        })
                      }
                    />
                  )}
                </div>
              </div>
              {/* Prodotti: stesso elenco del dialog in pagina Commesse, così la
                  commessa nasce già sapendo di cosa si tratta. */}
              <div className="space-y-2">
                <Label>Prodotti</Label>
                {commessaForm.prodotti.length > 0 && (
                  <div className="space-y-2">
                    {commessaForm.prodotti.map((riga, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Select
                          value={riga.nome}
                          onValueChange={v =>
                            setCommessaForm({
                              ...commessaForm,
                              prodotti: commessaForm.prodotti.map((r, j) =>
                                j === i ? { ...r, nome: v } : r
                              ),
                            })
                          }
                        >
                          <SelectTrigger
                            aria-label="Tipologia prodotto"
                            className="flex-1"
                          >
                            <SelectValue placeholder="Tipologia" />
                          </SelectTrigger>
                          <SelectContent>
                            {TIPOLOGIE_PRODOTTO.map(t => (
                              <SelectItem key={t} value={t}>
                                {t}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          type="number"
                          min={1}
                          aria-label="Quantità"
                          className="w-20 tabular-nums"
                          value={riga.quantita}
                          onChange={e =>
                            setCommessaForm({
                              ...commessaForm,
                              prodotti: commessaForm.prodotti.map((r, j) =>
                                j === i ? { ...r, quantita: e.target.value } : r
                              ),
                            })
                          }
                        />
                        <Button
                          type="button"
                          variant="dangerGhost"
                          size="icon"
                          className="min-h-11 min-w-11 shrink-0"
                          aria-label="Rimuovi prodotto"
                          title="Rimuovi prodotto"
                          onClick={() =>
                            setCommessaForm({
                              ...commessaForm,
                              prodotti: commessaForm.prodotti.filter(
                                (_, j) => j !== i
                              ),
                            })
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-11"
                  onClick={() =>
                    setCommessaForm({
                      ...commessaForm,
                      prodotti: [
                        ...commessaForm.prodotti,
                        { nome: "", quantita: "1" },
                      ],
                    })
                  }
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Aggiungi prodotto
                </Button>
              </div>
              <div className="space-y-1.5">
                <Label>Note</Label>
                <Textarea
                  rows={2}
                  value={commessaForm.note}
                  onChange={e =>
                    setCommessaForm({ ...commessaForm, note: e.target.value })
                  }
                />
              </div>
              <Button
                type="button"
                className="min-h-11"
                onClick={() =>
                  createCommessa.mutate({
                    clienteId,
                    cliente: displayName,
                    // Commessa indirizzo = indirizzo LAVORO (falls back to
                    // residenza for legacy clients without lavoro set).
                    indirizzo: c.indirizzoLavoro || c.indirizzo || undefined,
                    citta: c.cittaLavoro || c.citta || undefined,
                    telefono: c.telefono || undefined,
                    email: c.email || undefined,
                    priorita: commessaForm.priorita,
                    consegnaIndicativa:
                      commessaForm.consegnaMode === "preset"
                        ? commessaForm.consegnaIndicativa
                        : undefined,
                    dataConsegnaIndicativa:
                      commessaForm.consegnaMode === "data"
                        ? commessaForm.dataConsegnaIndicativa || undefined
                        : undefined,
                    note: commessaForm.note || undefined,
                    prodotti: commessaForm.prodotti
                      .filter(pr => pr.nome.trim())
                      .map(pr => ({
                        nome: pr.nome.trim(),
                        quantita: Math.max(1, parseInt(pr.quantita, 10) || 1),
                      })),
                  })
                }
                disabled={
                  createCommessa.isPending ||
                  (commessaForm.consegnaMode === "data" &&
                    !commessaForm.dataConsegnaIndicativa)
                }
              >
                Crea commessa
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}

      {/* Add Intervento dialog */}
      {permissions.canPlanIntervento ? (
        <Dialog open={addInterventoOpen} onOpenChange={setAddInterventoOpen}>
          <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-md overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Nuovo intervento</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="space-y-1.5">
                <Label>Commessa</Label>
                <Select
                  value={String(interventoForm.commessaId)}
                  onValueChange={v =>
                    setInterventoForm({
                      ...interventoForm,
                      commessaId: Number(v),
                    })
                  }
                >
                  <SelectTrigger aria-label="Commessa">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {clienteCommesse.map((cm: any) => (
                      <SelectItem key={cm.id} value={String(cm.id)}>
                        {cm.codice}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Tipo</Label>
                  <Select
                    value={interventoForm.tipo}
                    onValueChange={(v: any) =>
                      setInterventoForm({ ...interventoForm, tipo: v })
                    }
                  >
                    <SelectTrigger aria-label="Tipo di intervento">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rilievo">Rilievo</SelectItem>
                      <SelectItem value="posa">Posa</SelectItem>
                      <SelectItem value="assistenza">Assistenza</SelectItem>
                      <SelectItem value="altro">Altro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Data pianificata</Label>
                  <Input
                    type="date"
                    value={interventoForm.dataPianificata}
                    onChange={e =>
                      setInterventoForm({
                        ...interventoForm,
                        dataPianificata: e.target.value,
                      })
                    }
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Note</Label>
                <Textarea
                  rows={2}
                  value={interventoForm.note}
                  onChange={e =>
                    setInterventoForm({
                      ...interventoForm,
                      note: e.target.value,
                    })
                  }
                />
              </div>
              <Button
                type="button"
                className="min-h-11"
                onClick={() =>
                  createIntervento.mutate({
                    commessaId: interventoForm.commessaId,
                    tipo: interventoForm.tipo as any,
                    dataPianificata:
                      interventoForm.dataPianificata || undefined,
                    note: interventoForm.note || undefined,
                  })
                }
                disabled={
                  !interventoForm.commessaId ||
                  !interventoForm.dataPianificata ||
                  createIntervento.isPending
                }
              >
                Crea intervento
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}

      {/* Add Ticket dialog */}
      {permissions.canCreateTicket ? (
        <Dialog open={addTicketOpen} onOpenChange={setAddTicketOpen}>
          <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-md overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Nuovo ticket</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="space-y-1.5">
                <Label>Commessa</Label>
                <Select
                  value={String(ticketForm.commessaId)}
                  onValueChange={v =>
                    setTicketForm({ ...ticketForm, commessaId: Number(v) })
                  }
                >
                  <SelectTrigger aria-label="Commessa">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {clienteCommesse.map((cm: any) => (
                      <SelectItem key={cm.id} value={String(cm.id)}>
                        {cm.codice}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Oggetto</Label>
                <Input
                  value={ticketForm.oggetto}
                  onChange={e =>
                    setTicketForm({ ...ticketForm, oggetto: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Descrizione</Label>
                <Textarea
                  rows={2}
                  value={ticketForm.descrizione}
                  onChange={e =>
                    setTicketForm({
                      ...ticketForm,
                      descrizione: e.target.value,
                    })
                  }
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Categoria</Label>
                  <Select
                    value={ticketForm.categoria}
                    onValueChange={v =>
                      setTicketForm({ ...ticketForm, categoria: v })
                    }
                  >
                    <SelectTrigger aria-label="Categoria">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="regolazione">Regolazione</SelectItem>
                      <SelectItem value="difetto_posa">Difetto posa</SelectItem>
                      <SelectItem value="difetto_prodotto">
                        Difetto prodotto
                      </SelectItem>
                      <SelectItem value="altro">Altro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Priorità</Label>
                  <Select
                    value={ticketForm.priorita}
                    onValueChange={(v: any) =>
                      setTicketForm({ ...ticketForm, priorita: v })
                    }
                  >
                    <SelectTrigger aria-label="Priorità">
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
              <Button
                type="button"
                className="min-h-11"
                onClick={() =>
                  createTicket.mutate({
                    commessaId: ticketForm.commessaId,
                    oggetto: ticketForm.oggetto,
                    descrizione: ticketForm.descrizione || undefined,
                    categoria: ticketForm.categoria as any,
                    priorita: ticketForm.priorita,
                  })
                }
                disabled={
                  !ticketForm.commessaId ||
                  !ticketForm.oggetto ||
                  createTicket.isPending
                }
              >
                Crea ticket
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}

      {/* Add Garanzia dialog */}
      {puoCreareGaranzia ? (
        <Dialog open={addGaranziaOpen} onOpenChange={setAddGaranziaOpen}>
          <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-md overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Nuova garanzia</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="space-y-1.5">
                <Label>Commessa</Label>
                <Select
                  value={String(garanziaForm.commessaId)}
                  onValueChange={v =>
                    setGaranziaForm({ ...garanziaForm, commessaId: Number(v) })
                  }
                >
                  <SelectTrigger aria-label="Commessa">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {clienteCommesse.map((cm: any) => (
                      <SelectItem key={cm.id} value={String(cm.id)}>
                        {cm.codice}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Tipo</Label>
                  <Select
                    value={garanziaForm.tipo}
                    onValueChange={(v: any) =>
                      setGaranziaForm({ ...garanziaForm, tipo: v })
                    }
                  >
                    <SelectTrigger aria-label="Tipo di garanzia">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="prodotto">Prodotto</SelectItem>
                      <SelectItem value="posa">Posa</SelectItem>
                      <SelectItem value="accessorio">Accessorio</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Durata (mesi)</Label>
                  <Input
                    type="number"
                    value={garanziaForm.durataMesi}
                    onChange={e =>
                      setGaranziaForm({
                        ...garanziaForm,
                        durataMesi: Number(e.target.value),
                      })
                    }
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Descrizione</Label>
                <Input
                  value={garanziaForm.descrizione}
                  onChange={e =>
                    setGaranziaForm({
                      ...garanziaForm,
                      descrizione: e.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Fornitore</Label>
                <Input
                  value={garanziaForm.fornitore}
                  onChange={e =>
                    setGaranziaForm({
                      ...garanziaForm,
                      fornitore: e.target.value,
                    })
                  }
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Data inizio</Label>
                  <Input
                    type="date"
                    value={garanziaForm.dataInizio}
                    onChange={e =>
                      setGaranziaForm({
                        ...garanziaForm,
                        dataInizio: e.target.value,
                      })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Data scadenza</Label>
                  <Input
                    type="date"
                    value={garanziaForm.dataScadenza}
                    onChange={e =>
                      setGaranziaForm({
                        ...garanziaForm,
                        dataScadenza: e.target.value,
                      })
                    }
                  />
                </div>
              </div>
              <Button
                type="button"
                className="min-h-11"
                onClick={() =>
                  createGaranzia.mutate({
                    commessaId: garanziaForm.commessaId,
                    tipo: garanziaForm.tipo,
                    descrizione: garanziaForm.descrizione,
                    fornitore: garanziaForm.fornitore || undefined,
                    dataInizio: garanziaForm.dataInizio,
                    durataMesi: garanziaForm.durataMesi,
                  })
                }
                disabled={
                  !garanziaForm.commessaId ||
                  !garanziaForm.descrizione ||
                  !garanziaForm.dataInizio ||
                  !garanziaForm.dataScadenza ||
                  createGaranzia.isPending
                }
              >
                Crea garanzia
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Eliminare il cliente?"
        description={`Stai per eliminare "${displayName}". L'operazione è definitiva e non può essere annullata.`}
        confirmLabel="Elimina cliente"
        busy={deleteCliente.isPending}
        onConfirm={() => deleteCliente.mutate(clienteId)}
      />
    </div>
  );
}
