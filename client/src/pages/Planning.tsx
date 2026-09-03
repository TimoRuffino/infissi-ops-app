import { trpc } from "@/lib/trpc";
import {
  CALENDAR_COLOR_MAP,
  CALENDAR_SOFT_MAP,
  CALENDARI,
  addDays,
  startOfMonth,
  startOfWeek,
  toDateStr,
} from "@/lib/calendario";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import DataSurface from "@/components/patterns/DataSurface";
import PageHeader from "@/components/patterns/PageHeader";
import type { StatePanelProps } from "@/components/patterns/StatePanel";
import PlanningAgenda, {
  type PlanningAgendaExternalItem,
  type PlanningAgendaItem,
} from "@/components/planning/PlanningAgenda";
import PlanningInterventoSheet, {
  type PlanningInterventoDraft,
  type PlanningLinkKind,
} from "@/components/planning/PlanningInterventoSheet";
import PlanningGrigliaOraria, {
  type VoceGriglia,
} from "@/components/planning/PlanningGrigliaOraria";
import PlanningToolbar from "@/components/planning/PlanningToolbar";
import { caricoGiornata } from "@/lib/grigliaOraria";
import { useOperationalContext } from "@/contexts/OperationalContext";
import { planningPermissions } from "@/lib/operationalRoutes";
import {
  Plus,
  MapPin,
  Calendar as CalIcon,
  CloudOff,
  User as UserIcon,
  Phone,
  Mail,
  Briefcase,
  Users as UsersIcon,
  Lock,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "wouter";
import ConfirmDialog from "@/components/ConfirmDialog";
import WhatsAppButton from "@/components/WhatsAppButton";
import { FIRMA_WHATSAPP } from "@/lib/whatsapp";

// ── Helpers ──────────────────────────────────────────────────────────────────
// Le funzioni di periodo (toDateStr, addDays, startOfWeek, startOfMonth)
// vivono in lib/calendario: le condividono pagina, toolbar e agenda.

const dayNames = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

// Le etichette vengono dal catalogo dei tipi: sono otto da quando la
// migrazione Google porta anche consegne, riunioni e ferie, e riscriverle qui
// vorrebbe dire dimenticarne una al prossimo giro.
const tipoLabels: Record<string, string> = Object.fromEntries(
  CALENDARI.map(c => [c.key, c.label])
);

type LinkKind = PlanningLinkKind;

type Form = PlanningInterventoDraft;

const emptyForm: Form = {
  linkKind: "commessa",
  linkId: "",
  squadraId: "",
  tecnicoId: "",
  tipo: "posa",
  dataPianificata: "",
  oraInizio: "",
  oraFine: "",
  indirizzo: "",
  note: "",
};

export default function Planning() {
  const [, setLocation] = useLocation();
  // Il provider della slice 01 è l'unico owner di permessi.mie: finché il
  // contesto non è `ready` la matrice resta fail-closed.
  const { capabilities, status: operationalStatus } = useOperationalContext();
  const permissions = planningPermissions(
    operationalStatus === "ready" ? capabilities : null
  );
  // Default view: month — the operator's preferred at-a-glance horizon.
  const [view, setView] = useState<"day" | "week" | "month">("month");
  const [cursor, setCursor] = useState<Date>(new Date());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<Form>(emptyForm);
  const [editId, setEditId] = useState<number | null>(null);
  const [annullaTarget, setAnnullaTarget] = useState<{
    id: number;
    label: string;
  } | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  // External (Google) event tapped → read-only detail sheet.
  const [extDetail, setExtDetail] = useState<any>(null);

  // Query range based on view
  const { from, to } = useMemo(() => {
    if (view === "day") {
      const s = toDateStr(cursor);
      return { from: s, to: s };
    }
    if (view === "week") {
      const s = startOfWeek(cursor);
      return { from: toDateStr(s), to: toDateStr(addDays(s, 6)) };
    }
    // month: pad to whole weeks
    const mStart = startOfMonth(cursor);
    const gridStart = startOfWeek(mStart);
    const daysNeeded = 42; // 6 weeks
    const gridEnd = addDays(gridStart, daysNeeded - 1);
    return { from: toDateStr(gridStart), to: toDateStr(gridEnd) };
  }, [view, cursor]);

  const interventi = trpc.interventi.list.useQuery({ from, to });
  // Read-only overlay: events imported from the operator's Google calendars.
  const externalEvents = trpc.externalCalendars.events.useQuery({ from, to });
  const externalSources = trpc.externalCalendars.list.useQuery();
  const commesse = trpc.commesse.list.useQuery({});
  const clienti = trpc.clienti.list.useQuery({});
  const squadre = trpc.squadre.list.useQuery();
  // Chi può eseguire un rilievo: sono persone con un ruolo, non squadre.
  const tecnici = trpc.utenti.list.useQuery({ ruolo: "tecnico_rilievi" });
  const ticketList = trpc.ticket.list.useQuery({});
  const reclami = trpc.reclamiRifacimenti.reclami.list.useQuery({});
  const rifacimenti = trpc.reclamiRifacimenti.rifacimenti.list.useQuery({});

  // ── Lookup maps — joined info shown on cards + edit sheet ────────────────
  // Pairing intervento → commessa → cliente gives us nome/cognome/indirizzo
  // without per-card queries. Indirizzo comes from the commessa (which copies
  // it from cliente.indirizzoLavoro at create time and tracks per-job
  // overrides afterwards).
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
  const squadraById = useMemo(() => {
    const m = new Map<number, any>();
    for (const s of squadre.data ?? []) m.set(s.id, s);
    return m;
  }, [squadre.data]);

  const tecnicoById = useMemo(() => {
    const m = new Map<number, any>();
    for (const u of tecnici.data ?? []) m.set(u.id, u);
    return m;
  }, [tecnici.data]);

  function getJoinedInfo(i: any) {
    const commessa = i.commessaId ? commessaById.get(i.commessaId) : null;
    const cliente = commessa?.clienteId
      ? clienteById.get(commessa.clienteId)
      : null;
    const squadra = i.squadraId ? squadraById.get(i.squadraId) : null;
    // Chi esegue: per un rilievo è un tecnico, per il resto una squadra. Il
    // calendario mostra una riga sola, quindi qui si sceglie quale.
    const tecnico = i.tecnicoId ? tecnicoById.get(i.tecnicoId) : null;
    const esecutore = tecnico
      ? `${tecnico.cognome ?? ""} ${tecnico.nome ?? ""}`.trim()
      : squadra
        ? `${squadra.nome}${squadra.caposquadra ? ` — ${squadra.caposquadra}` : ""}`
        : null;
    const nomeCognome = cliente
      ? `${cliente.cognome ?? ""} ${cliente.nome ?? ""}`.trim()
      : (commessa?.cliente ?? "");
    const indirizzo =
      i.indirizzo ||
      commessa?.indirizzo ||
      cliente?.indirizzoLavoro ||
      cliente?.indirizzo ||
      "";
    const citta =
      commessa?.citta || cliente?.cittaLavoro || cliente?.citta || "";
    return {
      commessa,
      cliente,
      squadra,
      tecnico,
      esecutore,
      nomeCognome,
      indirizzo,
      citta,
    };
  }

  const utils = trpc.useUtils();
  const createIntervento = trpc.interventi.create.useMutation({
    onSuccess: () => {
      utils.interventi.invalidate();
      setDialogOpen(false);
      setEditId(null);
      setForm(emptyForm);
    },
  });
  const updateIntervento = trpc.interventi.update.useMutation({
    onSuccess: () => {
      utils.interventi.invalidate();
      setDialogOpen(false);
      setEditId(null);
      setDraggingId(null);
    },
  });
  const deleteIntervento = trpc.interventi.delete.useMutation({
    onSuccess: () => {
      utils.interventi.invalidate();
      setAnnullaTarget(null);
    },
  });

  // Index interventi by day — hide annullati (legacy) since they should not appear
  const byDay = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const i of interventi.data ?? []) {
      const key = i.dataPianificata;
      if (!key) continue;
      if (i.stato === "annullato") continue;
      (map[key] ||= []).push(i);
    }
    // Sort each day by oraInizio then tipo
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => {
        const ta = a.oraInizio ?? "99:99";
        const tb = b.oraInizio ?? "99:99";
        if (ta !== tb) return ta.localeCompare(tb);
        return (a.tipo ?? "").localeCompare(b.tipo ?? "");
      });
    }
    return map;
  }, [interventi.data]);

  // Index external (Google) events by day, all-day first then by start time.
  const externalByDay = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const e of externalEvents.data ?? []) {
      const key = e.dataPianificata;
      if (!key) continue;
      (map[key] ||= []).push(e);
    }
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => {
        const ta = a.allDay ? "00:00" : (a.oraInizio ?? "99:99");
        const tb = b.allDay ? "00:00" : (b.oraInizio ?? "99:99");
        return ta.localeCompare(tb);
      });
    }
    return map;
  }, [externalEvents.data]);

  const activeExternalSources = useMemo(
    () => (externalSources.data ?? []).filter((s: any) => s.attivo),
    [externalSources.data]
  );

  // ── Voci del calendario desktop ─────────────────────────────────────────
  // Una forma sola per mese, settimana e giorno. Prima ogni vista rileggeva
  // l'intervento grezzo a modo suo e mostrava campi diversi: lo stesso
  // appuntamento diceva il tipo nella settimana e lo taceva nel mese. Qui il
  // contenuto si decide una volta, e le tre viste scelgono solo quanto
  // spazio hanno per mostrarlo.
  const vociPerGiorno = useMemo<Record<string, VoceGriglia[]>>(() => {
    const mappa: Record<string, VoceGriglia[]> = {};
    for (const [data, lista] of Object.entries(byDay)) {
      for (const i of lista) {
        const j = getJoinedInfo(i);
        const indirizzo = j.indirizzo
          ? j.citta
            ? `${j.indirizzo}, ${j.citta}`
            : j.indirizzo
          : null;
        // Senza cliente collegato il titolo cadeva sul tipo, e il blocco
        // diceva «ALTRO Altro»: il tipo due volte e il contenuto mai. Nei
        // dati veri metà appuntamenti sono così — inseriti al volo con la
        // sola nota — quindi la nota È il titolo, quando c'è.
        const nota = String(i.note ?? "").trim().split("\n")[0];
        (mappa[data] ||= []).push({
          id: i.id,
          fonte: "crm",
          tipo: i.tipo,
          tipoLabel: tipoLabels[i.tipo] ?? i.tipo,
          titolo: j.nomeCognome || nota || tipoLabels[i.tipo] || i.tipo,
          oraInizio: i.oraInizio ?? null,
          oraFine: i.oraFine ?? null,
          indirizzo,
          squadra: j.esecutore,
          // «pianificato» è lo stato di quasi tutto: ripeterlo su ogni riga è
          // rumore. Si dice solo quando è una notizia.
          statoNotevole:
            i.stato && i.stato !== "pianificato"
              ? String(i.stato).replace(/_/g, " ")
              : null,
          originale: i,
        });
      }
    }
    for (const [data, lista] of Object.entries(externalByDay)) {
      for (const e of lista) {
        (mappa[data] ||= []).push({
          id: e.id,
          fonte: "ext",
          tipo: "altro",
          tipoLabel: e.sourceNome ?? "Google",
          titolo: e.titolo,
          oraInizio: e.allDay ? null : (e.oraInizio ?? null),
          oraFine: e.allDay ? null : (e.oraFine ?? null),
          indirizzo: e.location ?? null,
          squadra: null,
          colore: e.color,
          statoNotevole: e.allDay ? "tutto il giorno" : null,
          originale: e,
        });
      }
    }
    // Nella cella del mese si vedono le prime quattro: devono essere le prime
    // della giornata, non le prime arrivate dal server.
    for (const lista of Object.values(mappa)) {
      lista.sort((a, b) =>
        (a.oraInizio ?? "99:99").localeCompare(b.oraInizio ?? "99:99")
      );
    }
    return mappa;
    // getJoinedInfo legge solo le mappe di lookup, che sono nelle deps.
  }, [byDay, externalByDay, commessaById, clienteById, squadraById, tecnicoById]);

  // Le intestazioni del calendario si agganciano sotto la barra del periodo,
  // che è sticky a sua volta. La sua altezza cambia con la larghezza (a
  // schermo stretto i controlli vanno a capo), quindi si misura invece di
  // scriverla a mano: un numero fisso qui vorrebbe dire intestazioni che
  // scompaiono sotto la barra su metà degli schermi.
  const barra = useRef<HTMLDivElement>(null);
  // `offsetHeight` letto dopo il layout e a ogni ridimensionamento: la barra
  // cambia altezza solo quando cambia la larghezza della finestra, e questo
  // è l'unico evento che serve. Niente ResizeObserver — misurato in
  // anteprima, in una pagina non dipinta non consegna mai, e un aggancio che
  // dipende da una callback che può non arrivare è un aggancio rotto.
  const [barraH, setBarraH] = useState(0);
  useLayoutEffect(() => {
    const misura = () => setBarraH(barra.current?.offsetHeight ?? 0);
    misura();
    window.addEventListener("resize", misura);
    return () => window.removeEventListener("resize", misura);
    // La vista cambia i controlli mostrati, quindi anche l'altezza possibile.
  }, [view]);

  function apriVoce(voce: VoceGriglia) {
    if (voce.fonte === "ext") setExtDetail(voce.originale);
    else openEdit(voce.originale);
  }

  // ── Agenda (< lg): stessa lista di interventi, una card per riga ─────────
  const agendaItems = useMemo<PlanningAgendaItem[]>(() => {
    return Object.keys(byDay)
      .sort()
      .flatMap(data =>
        byDay[data].map((i: any) => {
          const joined = getJoinedInfo(i);
          const indirizzo = joined.indirizzo
            ? joined.citta
              ? `${joined.indirizzo}, ${joined.citta}`
              : joined.indirizzo
            : null;
          return {
            id: i.id,
            data,
            tipo: i.tipo,
            tipoLabel: tipoLabels[i.tipo] ?? i.tipo,
            titolo:
              joined.nomeCognome ||
              String(i.note ?? "").trim().split("\n")[0] ||
              tipoLabels[i.tipo] ||
              i.tipo,
            orario: i.oraInizio
              ? i.oraFine
                ? `${i.oraInizio} – ${i.oraFine}`
                : i.oraInizio
              : null,
            squadra: joined.esecutore,
            indirizzo,
            // Come sul desktop: «pianificato» è lo stato di quasi tutto e
            // ripeterlo su ogni card è una riga sprecata su uno schermo che
            // di righe ne ha poche.
            stato:
              i.stato && i.stato !== "pianificato"
                ? String(i.stato).replace(/_/g, " ")
                : null,
          };
        })
      );
    // getJoinedInfo legge solo le tre mappe di lookup, che sono nelle deps.
  }, [byDay, commessaById, clienteById, squadraById, tecnicoById]);

  const agendaExternalItems = useMemo<PlanningAgendaExternalItem[]>(
    () =>
      Object.keys(externalByDay)
        .sort()
        .flatMap(data =>
          externalByDay[data].map((e: any) => ({
            id: e.id,
            data,
            titolo: e.titolo,
            orario: e.allDay
              ? "Tutto il giorno"
              : `${e.oraInizio ?? ""}${e.oraFine ? ` – ${e.oraFine}` : ""}`,
            fonte: e.sourceNome,
            colore: e.color,
            indirizzo: e.location ?? null,
          }))
        ),
    [externalByDay]
  );

  function navigate(delta: number) {
    if (view === "day") setCursor(addDays(cursor, delta));
    else if (view === "week") setCursor(addDays(cursor, 7 * delta));
    else
      setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1));
  }

  const goPrevious = () => navigate(-1);
  const goNext = () => navigate(1);

  // Data proposta quando si crea senza partire da una cella: oggi se cade nel
  // periodo mostrato, altrimenti l'inizio del periodo. Pianificare in un mese
  // vuoto non deve costringere a riscrivere la data.
  const dataCreazioneDefault = useMemo(() => {
    const oggi = toDateStr(new Date());
    if (oggi >= from && oggi <= to) return oggi;
    if (view === "month") return toDateStr(startOfMonth(cursor));
    return from;
  }, [from, to, view, cursor]);

  function openCreateFor(dateStr?: string) {
    if (!permissions.canPlan) return;
    setEditId(null);
    setForm({ ...emptyForm, dataPianificata: dateStr ?? dataCreazioneDefault });
    setDialogOpen(true);
  }

  const openCreate = () => openCreateFor(dataCreazioneDefault);

  // When the operator picks a commessa in the sheet, auto-fill the
  // address from the commessa (which is the lavoro address). Only fills
  // when the field is empty so manual overrides are preserved.
  function handleLinkChange(linkKind: LinkKind, linkId: string) {
    let nextIndirizzo = form.indirizzo;
    if (linkKind === "commessa" && linkId && !form.indirizzo) {
      const cm = commessaById.get(parseInt(linkId));
      if (cm?.indirizzo) {
        nextIndirizzo = cm.citta
          ? `${cm.indirizzo}, ${cm.citta}`
          : cm.indirizzo;
      }
    }
    if (linkKind === "cliente" && linkId && !form.indirizzo) {
      const cl = clienteById.get(parseInt(linkId));
      if (cl?.indirizzo) {
        nextIndirizzo = cl.citta
          ? `${cl.indirizzo}, ${cl.citta}`
          : cl.indirizzo;
      }
    }
    setForm({ ...form, linkKind, linkId, indirizzo: nextIndirizzo });
  }

  function openEdit(i: any) {
    setEditId(i.id);
    const linkKind: LinkKind = i.rifacimentoId
      ? "rifacimento"
      : i.reclamoId
        ? "reclamo"
        : i.ticketId
          ? "ticket"
          : i.commessaId
            ? "commessa"
            : i.clienteId
              ? "cliente"
              : "nessuno";
    const linkId =
      linkKind === "nessuno"
        ? ""
        : String(
            linkKind === "commessa"
              ? (i.commessaId ?? "")
              : linkKind === "cliente"
                ? (i.clienteId ?? "")
                : linkKind === "ticket"
                  ? (i.ticketId ?? "")
                  : linkKind === "reclamo"
                    ? (i.reclamoId ?? "")
                    : (i.rifacimentoId ?? "")
          );
    setForm({
      linkKind,
      linkId,
      squadraId: i.squadraId ? String(i.squadraId) : "",
      tecnicoId: i.tecnicoId ? String(i.tecnicoId) : "",
      tipo: i.tipo === "sopralluogo" ? "rilievo" : i.tipo,
      dataPianificata: i.dataPianificata ?? "",
      oraInizio: i.oraInizio ?? "",
      oraFine: i.oraFine ?? "",
      indirizzo: i.indirizzo ?? "",
      note: i.note ?? "",
    });
    setDialogOpen(true);
  }

  function openIntervento(id: number) {
    const intervento = (interventi.data ?? []).find((i: any) => i.id === id);
    if (intervento) openEdit(intervento);
  }

  function openExternal(id: string) {
    setExtDetail(
      (externalEvents.data ?? []).find((e: any) => e.id === id) ?? null
    );
  }

  function buildPayload(f: Form) {
    const linkIds = {
      commessaId:
        f.linkKind === "commessa" && f.linkId ? parseInt(f.linkId) : null,
      clienteId:
        f.linkKind === "cliente" && f.linkId ? parseInt(f.linkId) : null,
      ticketId: f.linkKind === "ticket" && f.linkId ? parseInt(f.linkId) : null,
      reclamoId:
        f.linkKind === "reclamo" && f.linkId ? parseInt(f.linkId) : null,
      rifacimentoId:
        f.linkKind === "rifacimento" && f.linkId ? parseInt(f.linkId) : null,
    };
    return {
      ...linkIds,
      // Il server autorizza `intervento.assign` solo quando il campo di
      // assegnazione è presente nell'input: senza quella capability non parte,
      // così la pianificazione resta possibile e l'assegnazione no.
      //
      // Si mandano entrambi: il dominio (`esecutorePerTipo`) tiene quello che
      // compete al tipo e azzera l'altro. Mandarne uno solo lascerebbe in
      // piedi il vecchio quando un intervento cambia tipo.
      ...(permissions.canAssign
        ? {
            squadraId: f.squadraId ? parseInt(f.squadraId) : null,
            tecnicoId: f.tecnicoId ? parseInt(f.tecnicoId) : null,
          }
        : {}),
      tipo: f.tipo,
      dataPianificata: f.dataPianificata,
      oraInizio: f.oraInizio || null,
      oraFine: f.oraFine || null,
      indirizzo: f.indirizzo || undefined,
      note: f.note || undefined,
    };
  }

  function handleSave() {
    if (!permissions.canPlan) return;
    if (!form.dataPianificata) return;
    if ((form.linkKind === "commessa" || form.linkKind === "cliente") && !form.linkId) return; // target required when selected
    const payload = buildPayload(form);
    if (editId) {
      updateIntervento.mutate({ id: editId, ...payload });
    } else {
      createIntervento.mutate(payload as any);
    }
  }

  // Drag&drop handlers — acceleratore desktop, mai l'unico modo per spostare
  // un appuntamento (agenda e sheet offrono "Modifica data e ora").
  function handleDragStart(e: React.DragEvent, i: any) {
    if (!permissions.canPlan) {
      e.preventDefault();
      return;
    }
    setDraggingId(i.id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(i.id));
  }
  function handleDragOver(e: React.DragEvent) {
    if (!permissions.canPlan) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }
  function handleDrop(e: React.DragEvent, dateStr: string) {
    e.preventDefault();
    if (!permissions.canPlan) return;
    const id = parseInt(e.dataTransfer.getData("text/plain"));
    if (!id) return;
    const i = interventi.data?.find((x: any) => x.id === id);
    if (!i || i.dataPianificata === dateStr) {
      setDraggingId(null);
      return;
    }
    updateIntervento.mutate({ id, dataPianificata: dateStr });
  }

  const linkOptions = useMemo(() => {
    if (form.linkKind === "commessa") {
      return (commesse.data ?? []).map((c: any) => ({
        value: String(c.id),
        label: `${c.codice} — ${c.cliente}`,
        keywords: [c.codice, c.cliente, c.citta, c.indirizzo]
          .filter(Boolean)
          .join(" "),
      }));
    }
    if (form.linkKind === "cliente") {
      return (clienti.data ?? []).map((c: any) => ({
        value: String(c.id),
        label: `${c.cognome ?? ""} ${c.nome ?? ""}`.trim() || `Cliente ${c.id}`,
        keywords: [c.cognome, c.nome, c.citta, c.telefono, c.email]
          .filter(Boolean)
          .join(" "),
      }));
    }
    if (form.linkKind === "nessuno") {
      return [];
    }
    if (form.linkKind === "ticket") {
      return (ticketList.data ?? []).map((t: any) => ({
        value: String(t.id),
        label: `#${t.id} — ${t.oggetto ?? t.titolo ?? "Ticket"}`,
        keywords: [t.oggetto, t.titolo, t.descrizione]
          .filter(Boolean)
          .join(" "),
      }));
    }
    if (form.linkKind === "reclamo") {
      return (reclami.data ?? []).map((r: any) => ({
        value: String(r.id),
        label: `#${r.id} — ${r.oggetto ?? r.descrizione ?? "Reclamo"}`,
        keywords: [r.oggetto, r.descrizione].filter(Boolean).join(" "),
      }));
    }
    return (rifacimenti.data ?? []).map((r: any) => ({
      value: String(r.id),
      label: `#${r.id} — ${r.descrizione ?? "Rifacimento"}`,
      keywords: r.descrizione ?? "",
    }));
  }, [
    form.linkKind,
    commesse.data,
    clienti.data,
    ticketList.data,
    reclami.data,
    rifacimenti.data,
  ]);

  // Riepilogo commessa/cliente in testa allo sheet: dati già letti, nessun
  // calcolo di stato commessa, solo il link esistente alla commessa.
  const contestoCommessa: ReactNode = (() => {
    if (!editId || form.linkKind !== "commessa" || !form.linkId) return null;
    const commessa = commessaById.get(parseInt(form.linkId));
    if (!commessa) return null;
    const cliente = commessa.clienteId
      ? clienteById.get(commessa.clienteId)
      : null;
    const nomeCognome = cliente
      ? `${cliente.cognome ?? ""} ${cliente.nome ?? ""}`.trim()
      : (commessa.cliente ?? "");
    // Il riepilogo segue il tipo scelto nel form, come il campo qui sopra:
    // per un rilievo si nomina il tecnico, per il resto la squadra.
    const esecutore =
      form.tipo === "rilievo"
        ? (() => {
            const tecnico = form.tecnicoId
              ? tecnicoById.get(parseInt(form.tecnicoId))
              : null;
            return tecnico
              ? `${tecnico.cognome ?? ""} ${tecnico.nome ?? ""}`.trim()
              : null;
          })()
        : (() => {
            const squadra = form.squadraId
              ? squadraById.get(parseInt(form.squadraId))
              : null;
            return squadra
              ? `${squadra.nome}${squadra.caposquadra ? ` — ${squadra.caposquadra}` : ""}`
              : null;
          })();
    return (
      <div className="min-w-0 space-y-2 rounded-[var(--radius-control)] border border-border-soft bg-surface-2 p-3 text-sm">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-mono text-[10px]">
            {commessa.codice}
          </Badge>
          <Badge variant="secondary" className="text-[10px] uppercase">
            {(commessa.stato ?? "").replace(/_/g, " ")}
          </Badge>
          {commessa.priorita === "urgente" && (
            <Badge variant="destructive" className="text-[10px]">
              URGENTE
            </Badge>
          )}
        </div>
        {nomeCognome && (
          <div className="flex min-w-0 items-center gap-1.5">
            <UserIcon className="h-3.5 w-3.5 text-text-3" />
            <span className="min-w-0 truncate font-semibold">
              {nomeCognome}
            </span>
          </div>
        )}
        {(commessa.indirizzo ||
          cliente?.indirizzoLavoro ||
          cliente?.indirizzo) && (
          <div className="flex min-w-0 items-start gap-1.5 text-xs text-text-2">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 break-words">
              {commessa.indirizzo ||
                cliente?.indirizzoLavoro ||
                cliente?.indirizzo}
              {commessa.citta || cliente?.cittaLavoro || cliente?.citta
                ? `, ${commessa.citta || cliente?.cittaLavoro || cliente?.citta}`
                : ""}
            </span>
          </div>
        )}
        {(commessa.telefono || cliente?.telefono) && (
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-text-2">
            <Phone className="h-3.5 w-3.5 shrink-0" />
            <a
              href={`tel:${commessa.telefono || cliente?.telefono}`}
              className="min-w-0 truncate hover:underline"
            >
              {commessa.telefono || cliente?.telefono}
            </a>
            <WhatsAppButton
              phone={commessa.telefono || cliente?.telefono}
              message={`Buongiorno${nomeCognome ? ` ${nomeCognome}` : ""}, le confermiamo l'appuntamento di ${tipoLabels[form.tipo]?.toLowerCase() ?? form.tipo}${form.dataPianificata ? ` il ${new Date(form.dataPianificata + "T12:00:00").toLocaleDateString("it-IT")}` : ""}${form.oraInizio ? ` alle ${form.oraInizio}` : ""}.\n${FIRMA_WHATSAPP}`}
            />
          </div>
        )}
        {(commessa.email || cliente?.email) && (
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-text-2">
            <Mail className="h-3.5 w-3.5 shrink-0" />
            <a
              href={`mailto:${commessa.email || cliente?.email}`}
              className="min-w-0 truncate hover:underline"
            >
              {commessa.email || cliente?.email}
            </a>
          </div>
        )}
        {esecutore && (
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-text-2">
            <UsersIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 truncate">{esecutore}</span>
          </div>
        )}
        <div className="flex justify-end pt-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-9 text-xs"
            onClick={() => setLocation(`/commesse/${commessa.id}`)}
          >
            <Briefcase className="h-3 w-3" />
            Apri commessa
          </Button>
        </div>
      </div>
    );
  })();

  const desktopView: ReactNode =
    view === "month" ? (
      <MonthView
        cursor={cursor}
        byDay={byDay}
        externalByDay={externalByDay}
        vociPerGiorno={vociPerGiorno}
        onApri={apriVoce}
        onNew={openCreateFor}
        onOpenDay={dateStr => {
          setCursor(new Date(dateStr + "T12:00:00"));
          setView("day");
        }}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        draggingId={draggingId}
        canCreate={permissions.canPlan}
      />
    ) : (
      <PlanningGrigliaOraria
        giorni={
          view === "day"
            ? [cursor]
            : Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(cursor), i))
        }
        perGiorno={vociPerGiorno}
        onApri={apriVoce}
        onNuovo={openCreateFor}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        draggingId={draggingId}
        canCreate={permissions.canPlan}
      />
    );

  // Quattro stati dati, mai mascherati l'uno con l'altro. Il refetch di un
  // periodo già caricato non svuota la superficie: `isPending` è vero solo al
  // primo caricamento.
  const statoSuperficie: StatePanelProps | undefined = interventi.isPending
    ? {
        kind: "loading",
        title: "Carico il calendario",
        description:
          "Recupero gli appuntamenti della sede per il periodo selezionato.",
        rows: 4,
      }
    : interventi.error
      ? {
          kind: "error",
          title: "Calendario non caricato",
          description:
            "Non è stato possibile leggere gli appuntamenti del periodo. Nessun dato è stato modificato.",
          action: (
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => interventi.refetch()}
            >
              Riprova
            </Button>
          ),
        }
      : agendaItems.length === 0 && agendaExternalItems.length === 0
        ? {
            kind: "empty",
            title: "Nessun intervento in questo periodo",
            description: permissions.canPlan
              ? "Cambia periodo dalla barra qui sopra oppure pianifica un nuovo appuntamento."
              : "Cambia periodo dalla barra qui sopra per vedere altri appuntamenti.",
            action: permissions.canPlan ? (
              <Button type="button" className="min-h-11" onClick={openCreate}>
                <Plus className="h-4 w-4" />
                Nuovo appuntamento
              </Button>
            ) : undefined,
          }
        : undefined;

  // Un overlay che non si è potuto leggere non è un overlay assente: "nessun
  // calendario collegato" si dice solo quando il server ha davvero risposto
  // che non ce ne sono.
  const overlayNonDisponibile = Boolean(
    externalSources.error || externalEvents.error
  );

  const legendaCalendari: ReactNode =
    externalSources.isPending ? null : overlayNonDisponibile ? (
      <p
        role="status"
        className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-2"
      >
        <CloudOff className="h-3.5 w-3.5 shrink-0 text-warning" />
        Calendari esterni non raggiungibili: gli eventi Google non sono
        mostrati.
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-11"
          onClick={() => {
            externalSources.refetch();
            externalEvents.refetch();
          }}
        >
          Riprova
        </Button>
      </p>
    ) : activeExternalSources.length > 0 ? (
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-2">
        <span className="inline-flex items-center gap-1 text-text-3">
          <Lock className="h-3 w-3" /> Google (sola lettura):
        </span>
        {activeExternalSources.map((s: any) => (
          <span key={s.id} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            {s.nome}
          </span>
        ))}
      </div>
    ) : (
      <p className="inline-flex min-w-0 items-center gap-1.5 text-xs text-text-3">
        <CloudOff className="h-3.5 w-3.5 shrink-0" />
        Nessun calendario esterno collegato
      </p>
    );

  return (
    <div className="min-w-0 space-y-4 sm:space-y-5">
      <PageHeader
        variant="workbench"
        eyebrow="Operatività"
        title={
          <span className="inline-flex items-center gap-2">
            <CalIcon className="h-6 w-6 text-primary" />
            Calendario
          </span>
        }
        description="Appuntamenti della sede: l'altezza di un blocco è la sua durata, e i buchi sono le ore libere. Sul desktop il drag sposta la data; la scheda resta l'alternativa da tastiera."
        busy={interventi.isFetching}
        metadata={
          <>
            {/* Un conteggio che non conosciamo non si mostra come zero. */}
            {interventi.isPending ? (
              <span>Conteggio appuntamenti in caricamento…</span>
            ) : interventi.error ? (
              <span>Conteggio appuntamenti non disponibile</span>
            ) : (
              <span>
                <strong className="tabular-nums text-text-1">
                  {agendaItems.length}
                </strong>{" "}
                appuntamenti nel periodo
              </span>
            )}
            {agendaExternalItems.length > 0 ? (
              <span className="inline-flex items-center gap-1">
                <Lock className="h-3 w-3" />
                <strong className="tabular-nums text-text-1">
                  {agendaExternalItems.length}
                </strong>{" "}
                eventi Google in sola lettura
              </span>
            ) : null}
            {interventi.isFetching && !interventi.isPending ? (
              <span role="status">Aggiornamento in corso…</span>
            ) : null}
          </>
        }
      />

      <div
        className="min-w-0 space-y-4"
        style={{ ["--planning-barra-h" as any]: `${barraH}px` }}
      >
        <div
          ref={barra}
          // Agganciata solo da desktop in su. Sotto `lg` i controlli vanno a
          // capo e la barra diventa alta 195px: bloccarne un quarto di
          // schermo mentre si scorre l'agenda vuol dire vedere due
          // appuntamenti invece di quattro, per tenere fermi dei pulsanti che
          // si toccano una volta ogni tanto.
          className="z-20 border-b border-border-soft bg-surface px-4 py-3 lg:sticky lg:top-0"
        >
          <PlanningToolbar
            view={view}
            cursor={cursor}
            canCreate={permissions.canPlan}
            onChangeView={setView}
            onPrevious={goPrevious}
            onToday={() => setCursor(new Date())}
            onNext={goNext}
            onCreate={openCreate}
          />
        </div>

        <section className="min-w-0" aria-label="Agenda interventi">
          <DataSurface
            density="compact"
            tone="sunken"
            toolbar={legendaCalendari}
            state={statoSuperficie}
            // Le intestazioni del calendario si agganciano allo scroll della
            // pagina: dentro un riquadro che ritaglia non potrebbero.
            clip={false}
          >
            <div className="hidden min-w-0 lg:block">{desktopView}</div>
            <div className="lg:hidden">
              <PlanningAgenda
                items={agendaItems}
                externalItems={agendaExternalItems}
                canReschedule={permissions.canPlan}
                onOpenIntervento={openIntervento}
                onOpenExternal={openExternal}
              />
            </div>
          </DataSurface>
        </section>
      </div>

      {/* Create / Edit sheet */}
      <PlanningInterventoSheet
        mode={editId ? "edit" : "create"}
        open={dialogOpen}
        onOpenChange={open => {
          if (!open) {
            setDialogOpen(false);
            setEditId(null);
          }
        }}
        draft={form}
        onDraftChange={setForm}
        onLinkKindChange={kind => handleLinkChange(kind, "")}
        onLinkIdChange={linkId => handleLinkChange(form.linkKind, linkId)}
        linkOptions={linkOptions}
        squadre={squadre.data ?? []}
        tecnici={tecnici.data ?? []}
        contesto={contestoCommessa}
        canPlan={permissions.canPlan}
        canAssign={permissions.canAssign}
        canDelete={permissions.canDelete}
        isPending={createIntervento.isPending || updateIntervento.isPending}
        onSubmit={handleSave}
        onDelete={
          editId
            ? () => {
                const intervento = (interventi.data ?? []).find(
                  (i: any) => i.id === editId
                );
                if (!intervento) return;
                setDialogOpen(false);
                setAnnullaTarget({
                  id: intervento.id,
                  label:
                    `${tipoLabels[intervento.tipo] ?? intervento.tipo} ${intervento.oraInizio ?? ""}`.trim(),
                });
              }
            : undefined
        }
      />

      {/* External (Google) event — read-only */}
      <PlanningInterventoSheet
        mode="read-external"
        open={!!extDetail}
        onOpenChange={open => !open && setExtDetail(null)}
        event={extDetail}
      />

      {/* Annulla confirm */}
      <ConfirmDialog
        open={!!annullaTarget}
        onOpenChange={(open: boolean) => !open && setAnnullaTarget(null)}
        title="Elimina appuntamento"
        description={`Confermi l'eliminazione dell'appuntamento "${annullaTarget?.label}"? L'appuntamento verrà rimosso definitivamente dal calendario.`}
        confirmLabel="Elimina appuntamento"
        onConfirm={() =>
          annullaTarget && deleteIntervento.mutate(annullaTarget.id)
        }
      />
    </div>
  );
}

// ── VISTA MESE ───────────────────────────────────────────────────────────────
// Il mese risponde a una domanda sola: dove c'è spazio. Prima non lo diceva —
// i quattro tipi avevano fondi tenui a distanza RGB 10-24 e tutti alla stessa
// luminosità, quindi il colore non si leggeva; l'orario e il nome stavano su
// una riga sola e uguale, quindi una posa di nove ore sembrava un rilievo di
// mezz'ora; e «+2 altri» nascondeva proprio i giorni pieni, che sono quelli
// che contano.
//
// Adesso: barra piena del tipo a sinistra (satura, riconoscibile di sfuggita),
// barretta di carico sotto il numero del giorno, e i sabati/domeniche stretti
// perché non ci si lavora e non meritano due settimi della larghezza.
function MonthView(props: {
  cursor: Date;
  byDay: Record<string, any[]>;
  externalByDay: Record<string, any[]>;
  vociPerGiorno: Record<string, VoceGriglia[]>;
  onApri: (voce: VoceGriglia) => void;
  onNew: (dateStr: string) => void;
  onOpenDay: (dateStr: string) => void;
  onDragStart: (e: React.DragEvent, voce: VoceGriglia) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, dateStr: string) => void;
  draggingId: number | null;
  canCreate: boolean;
}) {
  const mStart = startOfMonth(props.cursor);
  const gridStart = startOfWeek(mStart);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const todayStr = toDateStr(new Date());
  const monthNum = props.cursor.getMonth();
  // La sesta riga si disegna solo se il mese ci arriva davvero.
  const lastWeekUsed = days.slice(35).some(d => d.getMonth() === monthNum);
  const visibleDays = lastWeekUsed ? days : days.slice(0, 35);
  // Sab e Dom stretti: quasi sempre vuoti, e lo spazio serve ai feriali.
  const colonne = "repeat(5, minmax(0, 1fr)) repeat(2, minmax(0, 0.62fr))";
  const MAX_VOCI = 4;

  return (
    <div className="min-w-0 rounded-[var(--radius-panel)] border border-border-soft bg-surface [&>*:first-child]:rounded-t-[var(--radius-panel)] [&>*:last-child]:overflow-hidden [&>*:last-child]:rounded-b-[var(--radius-panel)]">
      {/* Sei righe di mese non stanno in una schermata: senza l'aggancio, a
          metà scroll le colonne perdono il nome e non si sa più se quella è
          una domenica. */}
      <div
        className="sticky z-10 grid bg-surface-2 border-b border-border-soft"
        style={{ gridTemplateColumns: colonne, top: "var(--planning-barra-h, 0px)" }}
      >
        {dayNames.map((d, i) => (
          <div
            key={d}
            className={`eyebrow !text-text-3 px-2 py-2 text-center ${
              i >= 5 ? "text-text-3/70" : ""
            }`}
          >
            {d}
          </div>
        ))}
      </div>
      <div className="grid" style={{ gridTemplateColumns: colonne }}>
        {visibleDays.map(day => {
          const dateStr = toDateStr(day);
          const isToday = dateStr === todayStr;
          const isOutsideMonth = day.getMonth() !== monthNum;
          const isWeekend = day.getDay() === 0 || day.getDay() === 6;
          const voci = props.vociPerGiorno[dateStr] ?? [];
          const carico = caricoGiornata(
            voci.map(v => ({ id: v.id, inizio: v.oraInizio, fine: v.oraFine }))
          );
          const visibili = voci.slice(0, MAX_VOCI);
          const nascoste = voci.length - visibili.length;
          return (
            <div
              key={dateStr}
              className={`group min-w-0 min-h-[126px] p-1 border-b border-r border-border-soft last:border-r-0 transition-colors ${
                isOutsideMonth
                  ? "bg-surface-2/50"
                  : isWeekend
                    ? "bg-surface-2/30"
                    : ""
              } ${isToday ? "bg-primary/[0.06]" : ""}`}
              onDragOver={props.onDragOver}
              onDrop={e => props.onDrop(e, dateStr)}
            >
              <div className="flex items-center justify-between gap-1 px-0.5">
                <span
                  className={`text-xs font-semibold tabular-nums grid place-items-center h-6 w-6 rounded-full ${
                    isToday
                      ? "bg-primary text-primary-foreground"
                      : isOutsideMonth
                        ? "text-text-3"
                        : "text-text-1"
                  }`}
                >
                  {day.getDate()}
                </span>
                {!isOutsideMonth && props.canCreate && (
                  <button
                    type="button"
                    onClick={() => props.onNew(dateStr)}
                    aria-label={`Nuovo appuntamento il ${dateStr}`}
                    title="Nuovo appuntamento"
                    className="h-6 w-6 grid place-items-center rounded text-text-3 opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100 hover:bg-surface-2"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {/* Quanto è piena la giornata, senza doverla aprire. */}
              {carico > 0 && (
                <div
                  className="mx-0.5 mb-1 mt-0.5 h-[3px] overflow-hidden rounded-full bg-border-soft"
                  title={`Giornata occupata al ${Math.round(carico * 100)}%`}
                >
                  <div
                    className="h-full rounded-full bg-primary/55"
                    style={{ width: `${Math.max(6, carico * 100)}%` }}
                  />
                </div>
              )}
              <div className="space-y-[3px]">
                {visibili.map(voce => (
                  <PillaMese
                    key={`${voce.fonte}-${voce.id}`}
                    voce={voce}
                    onApri={props.onApri}
                    onDragStart={props.onDragStart}
                    draggingId={props.draggingId}
                  />
                ))}
                {nascoste > 0 && (
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation();
                      props.onOpenDay(dateStr);
                    }}
                    className="w-full rounded px-1.5 py-0.5 text-left text-[11px] font-medium text-accent-text hover:bg-surface-2 hover:underline"
                  >
                    +{nascoste} {nascoste === 1 ? "altro" : "altri"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Un appuntamento nella cella del mese.
 *
 * Lo spazio è quello che è, quindi si scelgono due informazioni: l'ora e chi.
 * Il tipo non è una terza riga di testo — è la barra piena a sinistra, che si
 * riconosce senza leggere ed è l'unica cosa che prima non funzionava.
 */
function PillaMese(props: {
  voce: VoceGriglia;
  onApri: (voce: VoceGriglia) => void;
  onDragStart: (e: React.DragEvent, voce: VoceGriglia) => void;
  draggingId: number | null;
}) {
  const { voce } = props;
  const esterno = voce.fonte === "ext";
  const colore = esterno
    ? (voce.colore ?? "var(--color-cal-altro)")
    : (CALENDAR_COLOR_MAP[voce.tipo] ?? "var(--color-cal-altro)");
  const fondo = esterno
    ? `color-mix(in srgb, ${voce.colore ?? "var(--color-cal-altro)"} 12%, var(--color-surface))`
    : (CALENDAR_SOFT_MAP[voce.tipo] ?? "var(--color-cal-altro-soft)");
  const orario = voce.oraInizio
    ? voce.oraFine
      ? `${voce.oraInizio}–${voce.oraFine}`
      : voce.oraInizio
    : null;
  const descrizione = [voce.tipoLabel, voce.titolo, orario, voce.indirizzo]
    .filter(Boolean)
    .join(" · ");
  return (
    <button
      type="button"
      draggable={!esterno}
      onDragStart={esterno ? undefined : e => props.onDragStart(e, voce)}
      onClick={e => {
        e.stopPropagation();
        props.onApri(voce);
      }}
      title={descrizione}
      aria-label={descrizione}
      className={`flex w-full min-w-0 items-center gap-1 rounded-[5px] py-[3px] pl-1.5 pr-1 text-left text-[11px] leading-tight outline-none transition hover:brightness-[0.97] focus-visible:ring-[3px] focus-visible:ring-ring/55 ${
        props.draggingId === voce.id ? "opacity-40" : ""
      } ${esterno ? "" : "cursor-grab active:cursor-grabbing"}`}
      style={{ backgroundColor: fondo, boxShadow: `inset 3px 0 0 0 ${colore}` }}
    >
      {esterno && (
        <Lock className="h-2.5 w-2.5 shrink-0 opacity-70" style={{ color: colore }} />
      )}
      {voce.oraInizio && (
        <span
          className="shrink-0 font-semibold tabular-nums"
          style={{ color: colore }}
        >
          {voce.oraInizio}
        </span>
      )}
      <span className="min-w-0 truncate font-medium text-text-1">
        {voce.titolo}
      </span>
    </button>
  );
}
