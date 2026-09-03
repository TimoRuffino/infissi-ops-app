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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import PlanningToolbar from "@/components/planning/PlanningToolbar";
import { useOperationalContext } from "@/contexts/OperationalContext";
import { planningPermissions } from "@/lib/operationalRoutes";
import {
  Plus,
  MapPin,
  Clock,
  X,
  Calendar as CalIcon,
  CloudOff,
  User as UserIcon,
  Phone,
  Mail,
  Briefcase,
  Users as UsersIcon,
  Lock,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import ConfirmDialog from "@/components/ConfirmDialog";
import WhatsAppButton from "@/components/WhatsAppButton";
import { FIRMA_WHATSAPP } from "@/lib/whatsapp";

// ── Helpers ──────────────────────────────────────────────────────────────────
// Le funzioni di periodo (toDateStr, addDays, startOfWeek, startOfMonth)
// vivono in lib/calendario: le condividono pagina, toolbar e agenda.

const dayNames = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

// Tinted card background per tipo — paired with a solid 4px left border and a
// solid type chip (CALENDAR_COLOR_MAP) so the type reads at a glance.
// Fondo tenue per tipo, abbinato al bordo sinistro e al chip pieno.
const tipoCardStyle = (tipo: string): React.CSSProperties => ({
  backgroundColor: CALENDAR_SOFT_MAP[tipo] ?? "var(--color-cal-altro-soft)",
});

const tipoLabels: Record<string, string> = Object.fromEntries(
  CALENDARI.map(c => [c.key, c.label])
);

type LinkKind = PlanningLinkKind;

type Form = PlanningInterventoDraft;

const emptyForm: Form = {
  linkKind: "commessa",
  linkId: "",
  squadraId: "",
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

  function getJoinedInfo(i: any) {
    const commessa = i.commessaId ? commessaById.get(i.commessaId) : null;
    const cliente = commessa?.clienteId
      ? clienteById.get(commessa.clienteId)
      : null;
    const squadra = i.squadraId ? squadraById.get(i.squadraId) : null;
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
    return { commessa, cliente, squadra, nomeCognome, indirizzo, citta };
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
            titolo: joined.nomeCognome || tipoLabels[i.tipo] || i.tipo,
            orario: i.oraInizio
              ? i.oraFine
                ? `${i.oraInizio} – ${i.oraFine}`
                : i.oraInizio
              : null,
            squadra: joined.squadra
              ? `${joined.squadra.nome}${
                  joined.squadra.caposquadra
                    ? ` — ${joined.squadra.caposquadra}`
                    : ""
                }`
              : null,
            indirizzo,
            stato: (i.stato ?? "pianificato").replace(/_/g, " "),
          };
        })
      );
    // getJoinedInfo legge solo le tre mappe di lookup, che sono nelle deps.
  }, [byDay, commessaById, clienteById, squadraById]);

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
      // Il server autorizza `intervento.assign` solo quando `squadraId` è
      // presente nell'input: senza quella capability il campo non parte,
      // così la pianificazione resta possibile e l'assegnazione no.
      ...(permissions.canAssign
        ? { squadraId: f.squadraId ? parseInt(f.squadraId) : null }
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
    const squadra = form.squadraId
      ? squadraById.get(parseInt(form.squadraId))
      : null;
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
        {squadra && (
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-text-2">
            <UsersIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 truncate">
              {squadra.nome}
              {squadra.caposquadra ? ` — ${squadra.caposquadra}` : ""}
            </span>
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
    view === "day" ? (
      <DayView
        date={cursor}
        interventi={byDay[toDateStr(cursor)] ?? []}
        externalItems={externalByDay[toDateStr(cursor)] ?? []}
        onOpenExternal={setExtDetail}
        getJoined={getJoinedInfo}
        onNew={() => openCreateFor(toDateStr(cursor))}
        onEdit={openEdit}
        onAnnulla={i =>
          setAnnullaTarget({
            id: i.id,
            label: `${tipoLabels[i.tipo]} ${i.oraInizio ?? ""}`.trim(),
          })
        }
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        draggingId={draggingId}
        canCreate={permissions.canPlan}
        canDelete={permissions.canDelete}
      />
    ) : view === "week" ? (
      <WeekView
        cursor={cursor}
        byDay={byDay}
        externalByDay={externalByDay}
        onOpenExternal={setExtDetail}
        getJoined={getJoinedInfo}
        onNew={openCreateFor}
        onEdit={openEdit}
        onAnnulla={i =>
          setAnnullaTarget({
            id: i.id,
            label: `${tipoLabels[i.tipo]} ${i.oraInizio ?? ""}`.trim(),
          })
        }
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        draggingId={draggingId}
        canCreate={permissions.canPlan}
        canDelete={permissions.canDelete}
      />
    ) : (
      <MonthView
        cursor={cursor}
        byDay={byDay}
        externalByDay={externalByDay}
        onOpenExternal={setExtDetail}
        getJoined={getJoinedInfo}
        onNew={openCreateFor}
        onEdit={openEdit}
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
        description="Appuntamenti della sede. Il drag sposta la data sul calendario desktop; agenda e scheda restano l'alternativa da tastiera."
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

      <div className="min-w-0 space-y-4">
        <div className="sticky top-0 z-20 border-b border-border-soft bg-surface px-4 py-3">
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

// ── DAY VIEW ─────────────────────────────────────────────────────────────────
function DayView(props: {
  date: Date;
  interventi: any[];
  externalItems: any[];
  onOpenExternal: (e: any) => void;
  getJoined: (i: any) => {
    nomeCognome: string;
    indirizzo: string;
    citta?: string;
  };
  onNew: () => void;
  onEdit: (i: any) => void;
  onAnnulla: (i: any) => void;
  onDragStart: (e: React.DragEvent, i: any) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, dateStr: string) => void;
  draggingId: number | null;
  canCreate: boolean;
  canDelete: boolean;
}) {
  const dateStr = toDateStr(props.date);
  const isToday = dateStr === toDateStr(new Date());
  return (
    <Card className={isToday ? "border-primary/40" : ""}>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-base capitalize">
          {props.date.toLocaleDateString("it-IT", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </CardTitle>
        {props.canCreate ? (
          <Button variant="ghost" size="sm" onClick={props.onNew}>
            <Plus className="h-3.5 w-3.5" /> Aggiungi
          </Button>
        ) : null}
      </CardHeader>
      <CardContent
        className="min-h-[400px] space-y-2"
        onDragOver={props.onDragOver}
        onDrop={e => props.onDrop(e, dateStr)}
      >
        {props.interventi.length === 0 && props.externalItems.length === 0 ? (
          <p className="text-sm text-text-2 text-center py-12">
            Nessun appuntamento in questa giornata.
          </p>
        ) : (
          <>
            {props.interventi.map((i: any) => (
              <InterventoBlock
                key={i.id}
                intervento={i}
                joined={props.getJoined(i)}
                onEdit={() => props.onEdit(i)}
                onAnnulla={() => props.onAnnulla(i)}
                onDragStart={e => props.onDragStart(e, i)}
                draggingId={props.draggingId}
                size="large"
                canDelete={props.canDelete}
              />
            ))}
            {props.externalItems.map((e: any) => (
              <ExternalBlock
                key={e.id}
                event={e}
                size="large"
                onOpen={() => props.onOpenExternal(e)}
              />
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── WEEK VIEW ────────────────────────────────────────────────────────────────
function WeekView(props: {
  cursor: Date;
  byDay: Record<string, any[]>;
  externalByDay: Record<string, any[]>;
  onOpenExternal: (e: any) => void;
  getJoined: (i: any) => {
    nomeCognome: string;
    indirizzo: string;
    citta?: string;
  };
  onNew: (dateStr: string) => void;
  onEdit: (i: any) => void;
  onAnnulla: (i: any) => void;
  onDragStart: (e: React.DragEvent, i: any) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, dateStr: string) => void;
  draggingId: number | null;
  canCreate: boolean;
  canDelete: boolean;
}) {
  const start = startOfWeek(props.cursor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const todayStr = toDateStr(new Date());
  return (
    <div className="grid min-w-0 grid-cols-1 md:grid-cols-7 gap-3">
      {days.map((day, idx) => {
        const dateStr = toDateStr(day);
        const isToday = dateStr === todayStr;
        const isWeekend = idx >= 5;
        const items = props.byDay[dateStr] ?? [];
        const extItems = props.externalByDay[dateStr] ?? [];
        return (
          <Card
            key={dateStr}
            className={`min-w-0 min-h-[200px] ${isToday ? "border-primary/40 bg-surface-2" : ""} ${isWeekend ? "opacity-70" : ""}`}
            onDragOver={props.onDragOver}
            onDrop={e => props.onDrop(e, dateStr)}
          >
            <CardHeader className="pb-2 pt-3 px-3">
              <CardTitle className="text-xs font-medium flex items-center justify-between">
                <span className={isToday ? "font-bold" : ""}>
                  {dayNames[idx]}
                </span>
                <div className="flex items-center gap-1">
                  <span
                    className={`text-lg font-bold ${isToday ? "bg-primary text-primary-foreground rounded-full w-7 h-7 flex items-center justify-center" : ""}`}
                  >
                    {day.getDate()}
                  </span>
                  {props.canCreate ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Nuovo appuntamento il ${dateStr}`}
                      title="Nuovo appuntamento"
                      onClick={() => props.onNew(dateStr)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-2 pb-2 space-y-1.5">
              {items.map((i: any) => (
                <InterventoBlock
                  key={i.id}
                  intervento={i}
                  joined={props.getJoined(i)}
                  onEdit={() => props.onEdit(i)}
                  onAnnulla={() => props.onAnnulla(i)}
                  onDragStart={e => props.onDragStart(e, i)}
                  draggingId={props.draggingId}
                  size="small"
                  canDelete={props.canDelete}
                />
              ))}
              {extItems.map((e: any) => (
                <ExternalBlock
                  key={e.id}
                  event={e}
                  size="small"
                  onOpen={() => props.onOpenExternal(e)}
                />
              ))}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ── MONTH VIEW ───────────────────────────────────────────────────────────────
function MonthView(props: {
  cursor: Date;
  byDay: Record<string, any[]>;
  externalByDay: Record<string, any[]>;
  onOpenExternal: (e: any) => void;
  getJoined: (i: any) => {
    nomeCognome: string;
    indirizzo: string;
    citta?: string;
  };
  onNew: (dateStr: string) => void;
  onEdit: (i: any) => void;
  onOpenDay: (dateStr: string) => void;
  onDragStart: (e: React.DragEvent, i: any) => void;
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
  // 6th row is only rendered when the month actually spills into it — avoids a
  // near-empty trailing week.
  const lastWeekUsed = days.slice(35).some(d => d.getMonth() === monthNum);
  const visibleDays = lastWeekUsed ? days : days.slice(0, 35);

  return (
    <div className="min-w-0 rounded-[var(--radius-panel)] border border-border-soft overflow-hidden bg-surface">
      <div className="grid grid-cols-7 bg-surface-2 border-b border-border-soft">
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
      <div className="grid grid-cols-7">
        {visibleDays.map(day => {
          const dateStr = toDateStr(day);
          const isToday = dateStr === todayStr;
          const isOutsideMonth = day.getMonth() !== monthNum;
          const isWeekend = day.getDay() === 0 || day.getDay() === 6;
          const items = props.byDay[dateStr] ?? [];
          const extItems = props.externalByDay[dateStr] ?? [];
          // Merge CRM + Google entries into one time-sorted list so the 3-slot
          // preview and the "+N" overflow count both kinds together.
          const merged = [
            ...items.map((x: any) => ({
              kind: "crm" as const,
              data: x,
              t: x.oraInizio ?? "99:99",
            })),
            ...extItems.map((x: any) => ({
              kind: "ext" as const,
              data: x,
              t: x.allDay ? "00:00" : (x.oraInizio ?? "99:99"),
            })),
          ].sort((a, b) => a.t.localeCompare(b.t));
          return (
            <div
              key={dateStr}
              className={`group min-w-0 min-h-[132px] p-1.5 border-b border-r border-border-soft last:border-r-0 transition-colors ${
                isOutsideMonth
                  ? "bg-surface-2/50"
                  : isWeekend
                    ? "bg-surface-2/30"
                    : ""
              } ${isToday ? "bg-primary/[0.06]" : ""}`}
              onDragOver={props.onDragOver}
              onDrop={e => props.onDrop(e, dateStr)}
            >
              <div className="flex items-center justify-between mb-1">
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
              <div className="space-y-1">
                {merged.slice(0, 3).map(m => {
                  if (m.kind === "ext") {
                    const e = m.data;
                    return (
                      <button
                        key={`ext-${e.id}`}
                        type="button"
                        onClick={ev => {
                          ev.stopPropagation();
                          props.onOpenExternal(e);
                        }}
                        title={`${e.sourceNome} — ${e.titolo}`}
                        className="w-full min-w-0 flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] leading-tight text-left font-medium shadow-sm outline-none transition hover:brightness-105 active:brightness-95 focus-visible:ring-[3px] focus-visible:ring-ring/55"
                        style={{
                          backgroundColor: `color-mix(in srgb, ${e.color} 16%, var(--color-surface))`,
                          color: `color-mix(in srgb, ${e.color} 75%, var(--color-text-1))`,
                        }}
                      >
                        <Lock className="h-2.5 w-2.5 shrink-0 opacity-80" />
                        {!e.allDay && e.oraInizio && (
                          <span className="tabular-nums opacity-90 shrink-0">
                            {e.oraInizio}
                          </span>
                        )}
                        <span className="truncate">{e.titolo}</span>
                      </button>
                    );
                  }
                  const i = m.data;
                  const j = props.getJoined(i);
                  const label = j.nomeCognome || tipoLabels[i.tipo] || i.tipo;
                  const color =
                    CALENDAR_COLOR_MAP[i.tipo] ?? "var(--color-cal-altro)";
                  const soft =
                    CALENDAR_SOFT_MAP[i.tipo] ?? "var(--color-cal-altro-soft)";
                  return (
                    <div
                      key={i.id}
                      draggable
                      onDragStart={e => props.onDragStart(e, i)}
                      className={`min-w-0 ${props.draggingId === i.id ? "opacity-40" : ""}`}
                    >
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          props.onEdit(i);
                        }}
                        title={`${tipoLabels[i.tipo] ?? i.tipo}${
                          j.nomeCognome ? ` — ${j.nomeCognome}` : ""
                        }${j.indirizzo ? ` (${j.indirizzo})` : ""}`}
                        className="w-full min-w-0 flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] leading-tight text-left font-medium shadow-sm outline-none transition hover:brightness-105 active:brightness-95 focus-visible:ring-[3px] focus-visible:ring-ring/55"
                        style={{ backgroundColor: soft, color }}
                      >
                        {i.oraInizio && (
                          <span className="tabular-nums opacity-90 shrink-0">
                            {i.oraInizio}
                          </span>
                        )}
                        <span className="truncate">{label}</span>
                      </button>
                    </div>
                  );
                })}
                {merged.length > 3 && (
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation();
                      props.onOpenDay(dateStr);
                    }}
                    className="w-full text-left text-[11px] font-medium text-accent-text px-1.5 hover:underline"
                  >
                    +{merged.length - 3} altri
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

// ── EXTERNAL (GOOGLE) EVENT BLOCK ────────────────────────────────────────────
// Read-only mirror of an imported Google event. No drag, no edit, no delete —
// it lives in Google. Source color on the left edge + lock icon make the
// read-only nature obvious; dashed border separates it from CRM appointments.
function ExternalBlock(props: {
  event: any;
  size: "small" | "large";
  onOpen: () => void;
}) {
  const e = props.event;
  const large = props.size === "large";
  return (
    <button
      type="button"
      onClick={props.onOpen}
      className="w-full min-w-0 text-left rounded-md border border-border-soft bg-surface p-2 cursor-pointer outline-none transition-all hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/55"
      style={{
        borderLeftColor: e.color,
        borderLeftWidth: 4,
        backgroundColor: `color-mix(in srgb, ${e.color} 8%, var(--color-surface))`,
      }}
      title={e.location || undefined}
    >
      <div
        className={`${
          large ? "text-xs" : "text-[10px]"
        } flex items-center gap-1.5 flex-wrap`}
      >
        <span
          className="inline-flex items-center gap-1 rounded px-1 py-px text-[9px] font-bold uppercase tracking-wide shrink-0"
          style={{
            backgroundColor: `color-mix(in srgb, ${e.color} 16%, var(--color-surface))`,
            color: `color-mix(in srgb, ${e.color} 75%, var(--color-text-1))`,
          }}
        >
          <Lock className="h-2 w-2" />
          Google
        </span>
        {e.allDay ? (
          <span className="font-semibold text-text-2">Tutto il giorno</span>
        ) : e.oraInizio ? (
          <span className="inline-flex items-center gap-0.5 font-mono font-bold text-text-1">
            <Clock className="h-2.5 w-2.5" />
            {e.oraInizio}
            {e.oraFine ? `–${e.oraFine}` : ""}
          </span>
        ) : null}
      </div>
      <p
        className={`mt-1 font-semibold text-text-1 ${
          large ? "text-sm" : "text-[11px]"
        }`}
        title={e.titolo}
      >
        <span className="line-clamp-2">{e.titolo}</span>
      </p>
      {e.location && (
        <p
          className={`mt-0.5 flex items-center gap-0.5 text-text-2 ${
            large ? "text-xs" : "text-[10px]"
          }`}
        >
          <MapPin className="h-2.5 w-2.5 shrink-0" />
          <span className="truncate">{e.location}</span>
        </p>
      )}
      <p
        className={`mt-0.5 text-text-3 ${large ? "text-[10px]" : "text-[9px]"}`}
      >
        {e.sourceNome}
      </p>
    </button>
  );
}

// ── INTERVENTO CARD BLOCK ────────────────────────────────────────────────────
// Joined info — nomeCognome and indirizzo are derived from the linked
// commessa/cliente at render time so the operator sees who/where directly
// on the calendar without opening the appointment.
function InterventoBlock(props: {
  intervento: any;
  joined: { nomeCognome: string; indirizzo: string; citta?: string };
  onEdit: () => void;
  onAnnulla: () => void;
  onDragStart: (e: React.DragEvent) => void;
  draggingId: number | null;
  size: "small" | "large";
  canDelete: boolean;
}) {
  const i = props.intervento;
  const isDragging = props.draggingId === i.id;
  const color = CALENDAR_COLOR_MAP[i.tipo] ?? "var(--color-cal-altro)";
  const soft = CALENDAR_SOFT_MAP[i.tipo] ?? "var(--color-cal-altro-soft)";
  const indirizzoFull = props.joined.indirizzo
    ? props.joined.citta
      ? `${props.joined.indirizzo}, ${props.joined.citta}`
      : props.joined.indirizzo
    : "";
  return (
    <div
      draggable
      onDragStart={props.onDragStart}
      className={`min-w-0 rounded-md border border-border-soft p-2 transition-all hover:shadow-md ${
        isDragging ? "opacity-30" : ""
      }`}
      style={{
        ...tipoCardStyle(i.tipo),
        borderLeftColor: color,
        borderLeftWidth: 4,
      }}
    >
      <div className="flex items-start justify-between gap-1">
        <button
          type="button"
          onClick={props.onEdit}
          className="min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/55"
        >
          <span
            className={`${props.size === "large" ? "text-xs" : "text-[10px]"} flex items-center gap-1.5 flex-wrap`}
          >
            <span
              className="rounded px-1 py-px text-[9px] font-bold uppercase tracking-wide shrink-0"
              style={{ backgroundColor: soft, color }}
            >
              {tipoLabels[i.tipo] ?? i.tipo}
            </span>
            {i.oraInizio && (
              <span className="inline-flex items-center gap-0.5 font-mono font-bold text-text-1">
                <Clock className="h-2.5 w-2.5" />
                {i.oraInizio}
                {i.oraFine ? `–${i.oraFine}` : ""}
              </span>
            )}
          </span>
          {props.joined.nomeCognome && (
            <span
              className={`mt-0.5 font-semibold flex items-center gap-0.5 ${
                props.size === "large" ? "text-sm" : "text-[11px]"
              }`}
              title={props.joined.nomeCognome}
            >
              <UserIcon className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{props.joined.nomeCognome}</span>
            </span>
          )}
          {indirizzoFull && (
            <span
              className={`mt-0.5 flex items-center gap-0.5 text-text-2 ${props.size === "large" ? "text-xs" : "text-[10px]"}`}
            >
              <MapPin className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{indirizzoFull}</span>
            </span>
          )}
          {i.note && (
            <span
              className={`mt-0.5 block text-text-2 ${props.size === "large" ? "text-xs" : "text-[10px]"} line-clamp-2`}
            >
              {i.note}
            </span>
          )}
          <Badge
            variant={i.stato === "in_corso" ? "default" : "secondary"}
            className={`${props.size === "large" ? "text-[10px]" : "text-[8px]"} mt-1 px-1 py-0`}
          >
            {(i.stato ?? "pianificato").replace(/_/g, " ")}
          </Badge>
        </button>
        {props.canDelete ? (
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              props.onAnnulla();
            }}
            className="shrink-0 rounded p-0.5 hover:bg-danger-soft hover:text-danger transition-colors"
            aria-label="Elimina appuntamento"
            title="Elimina appuntamento"
          >
            <X className={props.size === "large" ? "h-4 w-4" : "h-3 w-3"} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
