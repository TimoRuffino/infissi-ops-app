import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
  ChevronLeft,
  ChevronRight,
  Plus,
  MapPin,
  Clock,
  X,
  CalendarDays,
  CalendarRange,
  Calendar as CalIcon,
  Link2,
  User as UserIcon,
  Phone,
  Mail,
  Briefcase,
  StickyNote,
  Users as UsersIcon,
  Lock,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import ConfirmDialog from "@/components/ConfirmDialog";
import SearchSelect from "@/components/SearchSelect";

// ── Helpers ──────────────────────────────────────────────────────────────────
function toDateStr(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function startOfWeek(d: Date) {
  const x = new Date(d);
  const dow = x.getDay(); // 0=Sun
  const diff = (dow === 0 ? -6 : 1) - dow; // Monday start
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

const dayNames = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
const dayNamesLong = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"];

const tipoColors: Record<string, string> = {
  rilievo:    "bg-blue-100 text-blue-800 border-blue-300",
  posa:       "bg-orange-100 text-orange-800 border-orange-300",
  assistenza: "bg-purple-100 text-purple-800 border-purple-300",
  altro:      "bg-gray-100 text-gray-800 border-gray-300",
};

// Solid hex per tipo — used for the colored dot on calendar entries.
const CALENDAR_COLOR_MAP: Record<string, string> = {
  rilievo: "#2563eb",
  posa: "#d97706",
  assistenza: "#7c3aed",
  altro: "#6b7280",
};

const tipoLabels: Record<string, string> = {
  rilievo: "Rilievo",
  posa: "Posa",
  assistenza: "Assistenza",
  altro: "Altro",
};

type LinkKind = "commessa" | "ticket" | "reclamo" | "rifacimento";

type Form = {
  linkKind: LinkKind;
  linkId: string;
  squadraId: string;
  tipo: "rilievo" | "posa" | "assistenza" | "altro";
  dataPianificata: string;
  oraInizio: string;
  oraFine: string;
  indirizzo: string;
  note: string;
};

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
  // Default view: month — the operator's preferred at-a-glance horizon.
  const [view, setView] = useState<"day" | "week" | "month">("month");
  const [cursor, setCursor] = useState<Date>(new Date());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<Form>(emptyForm);
  const [editId, setEditId] = useState<number | null>(null);
  const [annullaTarget, setAnnullaTarget] = useState<{ id: number; label: string } | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);

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
    const mEnd = endOfMonth(cursor);
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

  // ── Lookup maps — joined info shown on cards + edit dialog ───────────────
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
      : commessa?.cliente ?? "";
    const indirizzo =
      i.indirizzo ||
      commessa?.indirizzo ||
      cliente?.indirizzoLavoro ||
      cliente?.indirizzo ||
      "";
    const citta = commessa?.citta || cliente?.cittaLavoro || cliente?.citta || "";
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
        const ta = a.allDay ? "00:00" : a.oraInizio ?? "99:99";
        const tb = b.allDay ? "00:00" : b.oraInizio ?? "99:99";
        return ta.localeCompare(tb);
      });
    }
    return map;
  }, [externalEvents.data]);

  const activeExternalSources = useMemo(
    () => (externalSources.data ?? []).filter((s: any) => s.attivo),
    [externalSources.data]
  );

  function navigate(delta: number) {
    if (view === "day") setCursor(addDays(cursor, delta));
    else if (view === "week") setCursor(addDays(cursor, 7 * delta));
    else setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1));
  }

  function goToday() {
    setCursor(new Date());
  }

  function openCreateFor(dateStr?: string) {
    setEditId(null);
    setForm({ ...emptyForm, dataPianificata: dateStr ?? toDateStr(new Date()) });
    setDialogOpen(true);
  }

  // When the operator picks a commessa in the dialog, auto-fill the
  // address from the commessa (which is the lavoro address). Only fills
  // when the field is empty so manual overrides are preserved.
  function handleLinkChange(linkKind: LinkKind, linkId: string) {
    let nextIndirizzo = form.indirizzo;
    if (linkKind === "commessa" && linkId && !form.indirizzo) {
      const cm = commessaById.get(parseInt(linkId));
      if (cm?.indirizzo) {
        nextIndirizzo = cm.citta ? `${cm.indirizzo}, ${cm.citta}` : cm.indirizzo;
      }
    }
    setForm({ ...form, linkKind, linkId, indirizzo: nextIndirizzo });
  }

  function openEdit(i: any) {
    setEditId(i.id);
    const linkKind: LinkKind = i.rifacimentoId ? "rifacimento"
      : i.reclamoId ? "reclamo"
      : i.ticketId ? "ticket"
      : "commessa";
    const linkId = String(
      linkKind === "commessa" ? (i.commessaId ?? "")
      : linkKind === "ticket" ? (i.ticketId ?? "")
      : linkKind === "reclamo" ? (i.reclamoId ?? "")
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

  function buildPayload(f: Form) {
    const linkIds = {
      commessaId: f.linkKind === "commessa" && f.linkId ? parseInt(f.linkId) : null,
      ticketId: f.linkKind === "ticket" && f.linkId ? parseInt(f.linkId) : null,
      reclamoId: f.linkKind === "reclamo" && f.linkId ? parseInt(f.linkId) : null,
      rifacimentoId: f.linkKind === "rifacimento" && f.linkId ? parseInt(f.linkId) : null,
    };
    return {
      ...linkIds,
      squadraId: f.squadraId ? parseInt(f.squadraId) : null,
      tipo: f.tipo,
      dataPianificata: f.dataPianificata,
      oraInizio: f.oraInizio || null,
      oraFine: f.oraFine || null,
      indirizzo: f.indirizzo || undefined,
      note: f.note || undefined,
    };
  }

  function handleSave() {
    if (!form.dataPianificata) return;
    if (form.linkKind === "commessa" && !form.linkId) return; // commessa required when selected
    const payload = buildPayload(form);
    if (editId) {
      updateIntervento.mutate({ id: editId, ...payload });
    } else {
      createIntervento.mutate(payload as any);
    }
  }

  // Drag&drop handlers
  function handleDragStart(e: React.DragEvent, i: any) {
    setDraggingId(i.id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(i.id));
  }
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }
  function handleDrop(e: React.DragEvent, dateStr: string) {
    e.preventDefault();
    const id = parseInt(e.dataTransfer.getData("text/plain"));
    if (!id) return;
    const i = interventi.data?.find((x: any) => x.id === id);
    if (!i || i.dataPianificata === dateStr) {
      setDraggingId(null);
      return;
    }
    updateIntervento.mutate({ id, dataPianificata: dateStr });
  }

  // Header title
  const headerTitle = useMemo(() => {
    if (view === "day") {
      return cursor.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    }
    if (view === "week") {
      const s = startOfWeek(cursor);
      const e = addDays(s, 6);
      const sameMonth = s.getMonth() === e.getMonth();
      if (sameMonth) {
        return `${s.getDate()} – ${e.getDate()} ${s.toLocaleDateString("it-IT", { month: "long", year: "numeric" })}`;
      }
      return `${s.toLocaleDateString("it-IT", { day: "numeric", month: "short" })} – ${e.toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" })}`;
    }
    return cursor.toLocaleDateString("it-IT", { month: "long", year: "numeric" });
  }, [view, cursor]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-[28px] leading-[34px] font-bold tracking-[-0.02em] flex items-center gap-2">
            <CalIcon className="h-6 w-6 text-primary" />
            Calendario
          </h1>
          <p className="text-text-2 text-sm mt-1">
            Appuntamenti per sede — trascina per spostarli, sincronizza con Google
          </p>
        </div>
        <Button size="sm" onClick={() => openCreateFor()}>
          <Plus className="h-4 w-4 mr-1" />
          Nuovo appuntamento
        </Button>
      </div>

      {/* Controls: view switcher + navigation */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1 border border-border rounded-lg p-0.5 bg-surface-2">
          <Button
            variant={view === "month" ? "default" : "ghost"}
            size="sm"
            className="h-7 px-3"
            onClick={() => setView("month")}
          >
            <CalendarRange className="h-3.5 w-3.5 mr-1.5" /> Mese
          </Button>
          <Button
            variant={view === "week" ? "default" : "ghost"}
            size="sm"
            className="h-7 px-3"
            onClick={() => setView("week")}
          >
            <CalendarDays className="h-3.5 w-3.5 mr-1.5" /> Settimana
          </Button>
          <Button
            variant={view === "day" ? "default" : "ghost"}
            size="sm"
            className="h-7 px-3"
            onClick={() => setView("day")}
          >
            <CalIcon className="h-3.5 w-3.5 mr-1.5" /> Giorno
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => navigate(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="font-semibold capitalize min-w-[200px] text-center">
            {headerTitle}
          </div>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => navigate(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className="h-8" onClick={goToday}>
            Oggi
          </Button>
        </div>
      </div>

      {/* Legend — Google calendars overlaid read-only */}
      {activeExternalSources.length > 0 && (
        <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-xs text-text-2">
          <span className="inline-flex items-center gap-1 text-text-3">
            <Lock className="h-3 w-3" /> Google (sola lettura):
          </span>
          {activeExternalSources.map((s: any) => (
            <span key={s.id} className="inline-flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              {s.nome}
            </span>
          ))}
        </div>
      )}

      {/* View renderers */}
      {view === "day" && (
        <DayView
          date={cursor}
          interventi={byDay[toDateStr(cursor)] ?? []}
          externalItems={externalByDay[toDateStr(cursor)] ?? []}
          getJoined={getJoinedInfo}
          onNew={() => openCreateFor(toDateStr(cursor))}
          onEdit={openEdit}
          onAnnulla={(i) => setAnnullaTarget({ id: i.id, label: `${tipoLabels[i.tipo]} ${i.oraInizio ?? ""}`.trim() })}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          draggingId={draggingId}
        />
      )}

      {view === "week" && (
        <WeekView
          cursor={cursor}
          byDay={byDay}
          externalByDay={externalByDay}
          getJoined={getJoinedInfo}
          onNew={openCreateFor}
          onEdit={openEdit}
          onAnnulla={(i) => setAnnullaTarget({ id: i.id, label: `${tipoLabels[i.tipo]} ${i.oraInizio ?? ""}`.trim() })}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          draggingId={draggingId}
        />
      )}

      {view === "month" && (
        <MonthView
          cursor={cursor}
          byDay={byDay}
          externalByDay={externalByDay}
          getJoined={getJoinedInfo}
          onNew={openCreateFor}
          onEdit={openEdit}
          onOpenDay={(dateStr) => {
            setCursor(new Date(dateStr + "T12:00:00"));
            setView("day");
          }}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          draggingId={draggingId}
        />
      )}

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setEditId(null); } }}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? "Dettagli appuntamento" : "Nuovo appuntamento"}</DialogTitle>
          </DialogHeader>
          {(() => {
            // When the dialog is in edit mode AND the linked entity is a
            // commessa, surface the full joined info (cliente, indirizzo,
            // telefono, email, squadra, stato) in a read-only summary block
            // above the form so the operator doesn't have to open another
            // page to know who/where the appointment is for.
            if (!editId || form.linkKind !== "commessa" || !form.linkId) return null;
            const commessa = commessaById.get(parseInt(form.linkId));
            if (!commessa) return null;
            const cliente = commessa.clienteId
              ? clienteById.get(commessa.clienteId)
              : null;
            const nomeCognome = cliente
              ? `${cliente.cognome ?? ""} ${cliente.nome ?? ""}`.trim()
              : commessa.cliente ?? "";
            const squadra = form.squadraId
              ? squadraById.get(parseInt(form.squadraId))
              : null;
            return (
              <div className="rounded-md border bg-muted/30 p-3 space-y-2 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
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
                  <div className="flex items-center gap-1.5">
                    <UserIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-semibold">{nomeCognome}</span>
                  </div>
                )}
                {(commessa.indirizzo ||
                  cliente?.indirizzoLavoro ||
                  cliente?.indirizzo) && (
                  <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>
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
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Phone className="h-3.5 w-3.5" />
                    <a
                      href={`tel:${commessa.telefono || cliente?.telefono}`}
                      className="hover:underline"
                    >
                      {commessa.telefono || cliente?.telefono}
                    </a>
                  </div>
                )}
                {(commessa.email || cliente?.email) && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Mail className="h-3.5 w-3.5" />
                    <a
                      href={`mailto:${commessa.email || cliente?.email}`}
                      className="hover:underline"
                    >
                      {commessa.email || cliente?.email}
                    </a>
                  </div>
                )}
                {squadra && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <UsersIcon className="h-3.5 w-3.5" />
                    <span>
                      {squadra.nome}
                      {squadra.caposquadra ? ` — ${squadra.caposquadra}` : ""}
                    </span>
                  </div>
                )}
                <div className="flex justify-end pt-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setLocation(`/commesse/${commessa.id}`)}
                  >
                    <Briefcase className="h-3 w-3 mr-1" />
                    Apri commessa
                  </Button>
                </div>
              </div>
            );
          })()}
          <div className="grid gap-3 py-2">
            {/* Link target */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5"><Link2 className="h-3.5 w-3.5" /> Collega a</Label>
              <Select
                value={form.linkKind}
                onValueChange={(v: LinkKind) => handleLinkChange(v, "")}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="commessa">Commessa</SelectItem>
                  <SelectItem value="ticket">Ticket</SelectItem>
                  <SelectItem value="reclamo">Reclamo</SelectItem>
                  <SelectItem value="rifacimento">Rifacimento</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>
                {form.linkKind === "commessa" ? "Commessa *" :
                 form.linkKind === "ticket" ? "Ticket" :
                 form.linkKind === "reclamo" ? "Reclamo" : "Rifacimento"}
              </Label>
              <SearchSelect
                options={
                  form.linkKind === "commessa"
                    ? (commesse.data ?? []).map((c: any) => ({
                        value: String(c.id),
                        label: `${c.codice} — ${c.cliente}`,
                        keywords: [c.codice, c.cliente, c.citta, c.indirizzo]
                          .filter(Boolean)
                          .join(" "),
                      }))
                    : form.linkKind === "ticket"
                    ? (ticketList.data ?? []).map((t: any) => ({
                        value: String(t.id),
                        label: `#${t.id} — ${t.oggetto ?? t.titolo ?? "Ticket"}`,
                        keywords: [t.oggetto, t.titolo, t.descrizione]
                          .filter(Boolean)
                          .join(" "),
                      }))
                    : form.linkKind === "reclamo"
                    ? (reclami.data ?? []).map((r: any) => ({
                        value: String(r.id),
                        label: `#${r.id} — ${r.oggetto ?? r.descrizione ?? "Reclamo"}`,
                        keywords: [r.oggetto, r.descrizione].filter(Boolean).join(" "),
                      }))
                    : (rifacimenti.data ?? []).map((r: any) => ({
                        value: String(r.id),
                        label: `#${r.id} — ${r.descrizione ?? "Rifacimento"}`,
                        keywords: r.descrizione ?? "",
                      }))
                }
                value={form.linkId}
                onChange={(v) => handleLinkChange(form.linkKind, v)}
                placeholder="Seleziona..."
                searchPlaceholder="Cerca per codice, cliente..."
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <Select
                  value={form.tipo}
                  onValueChange={(v: any) => setForm({ ...form, tipo: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rilievo">Rilievo</SelectItem>
                    <SelectItem value="posa">Posa</SelectItem>
                    <SelectItem value="assistenza">Assistenza</SelectItem>
                    <SelectItem value="altro">Altro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Data *</Label>
                <Input
                  type="date"
                  value={form.dataPianificata}
                  onChange={(e) => setForm({ ...form, dataPianificata: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Ora inizio</Label>
                <Input
                  type="time"
                  value={form.oraInizio}
                  onChange={(e) => setForm({ ...form, oraInizio: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Ora fine</Label>
                <Input
                  type="time"
                  value={form.oraFine}
                  onChange={(e) => setForm({ ...form, oraFine: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Squadra</Label>
              <SearchSelect
                options={(squadre.data ?? []).map((s: any) => ({
                  value: String(s.id),
                  label: `${s.nome}${s.caposquadra ? ` — ${s.caposquadra}` : ""}`,
                  keywords: [s.nome, s.caposquadra].filter(Boolean).join(" "),
                }))}
                value={form.squadraId}
                onChange={(v) => setForm({ ...form, squadraId: v })}
                placeholder="Non assegnata"
                searchPlaceholder="Cerca squadra..."
                allowClear
                clearLabel="— Non assegnata —"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Indirizzo</Label>
              <Input
                value={form.indirizzo}
                onChange={(e) => setForm({ ...form, indirizzo: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Note</Label>
              <Textarea
                rows={2}
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </div>
            <Button
              onClick={handleSave}
              disabled={createIntervento.isPending || updateIntervento.isPending}
            >
              {editId ? "Salva modifiche" : "Pianifica"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Annulla confirm */}
      <ConfirmDialog
        open={!!annullaTarget}
        onOpenChange={(open: boolean) => !open && setAnnullaTarget(null)}
        title="Elimina appuntamento"
        description={`Confermi l'eliminazione dell'appuntamento "${annullaTarget?.label}"? L'appuntamento verrà rimosso definitivamente dal calendario.`}
        onConfirm={() => annullaTarget && deleteIntervento.mutate(annullaTarget.id)}
      />
    </div>
  );
}

// ── DAY VIEW ─────────────────────────────────────────────────────────────────
function DayView(props: {
  date: Date;
  interventi: any[];
  externalItems: any[];
  getJoined: (i: any) => { nomeCognome: string; indirizzo: string; citta?: string };
  onNew: () => void;
  onEdit: (i: any) => void;
  onAnnulla: (i: any) => void;
  onDragStart: (e: React.DragEvent, i: any) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, dateStr: string) => void;
  draggingId: number | null;
}) {
  const dateStr = toDateStr(props.date);
  const isToday = dateStr === toDateStr(new Date());
  return (
    <Card className={isToday ? "border-foreground/40" : ""}>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-base capitalize">
          {props.date.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" })}
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={props.onNew}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Aggiungi
        </Button>
      </CardHeader>
      <CardContent
        className="min-h-[400px] space-y-2"
        onDragOver={props.onDragOver}
        onDrop={(e) => props.onDrop(e, dateStr)}
      >
        {props.interventi.length === 0 && props.externalItems.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12 italic">
            Nessun appuntamento. Trascina qui o clicca "Aggiungi".
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
                onDragStart={(e) => props.onDragStart(e, i)}
                draggingId={props.draggingId}
                size="large"
              />
            ))}
            {props.externalItems.map((e: any) => (
              <ExternalBlock key={e.id} event={e} size="large" />
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
  getJoined: (i: any) => { nomeCognome: string; indirizzo: string; citta?: string };
  onNew: (dateStr: string) => void;
  onEdit: (i: any) => void;
  onAnnulla: (i: any) => void;
  onDragStart: (e: React.DragEvent, i: any) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, dateStr: string) => void;
  draggingId: number | null;
}) {
  const start = startOfWeek(props.cursor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const todayStr = toDateStr(new Date());
  return (
    <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
      {days.map((day, idx) => {
        const dateStr = toDateStr(day);
        const isToday = dateStr === todayStr;
        const isWeekend = idx >= 5;
        const items = props.byDay[dateStr] ?? [];
        const extItems = props.externalByDay[dateStr] ?? [];
        return (
          <Card
            key={dateStr}
            className={`min-h-[200px] ${isToday ? "border-foreground/40 bg-muted/30" : ""} ${isWeekend ? "opacity-70" : ""}`}
            onDragOver={props.onDragOver}
            onDrop={(e) => props.onDrop(e, dateStr)}
          >
            <CardHeader className="pb-2 pt-3 px-3">
              <CardTitle className="text-xs font-medium flex items-center justify-between">
                <span className={isToday ? "font-bold" : ""}>{dayNames[idx]}</span>
                <div className="flex items-center gap-1">
                  <span className={`text-lg font-bold ${isToday ? "bg-foreground text-background rounded-full w-7 h-7 flex items-center justify-center" : ""}`}>
                    {day.getDate()}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={() => props.onNew(dateStr)}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
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
                  onDragStart={(e) => props.onDragStart(e, i)}
                  draggingId={props.draggingId}
                  size="small"
                />
              ))}
              {extItems.map((e: any) => (
                <ExternalBlock key={e.id} event={e} size="small" />
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
  getJoined: (i: any) => { nomeCognome: string; indirizzo: string; citta?: string };
  onNew: (dateStr: string) => void;
  onEdit: (i: any) => void;
  onOpenDay: (dateStr: string) => void;
  onDragStart: (e: React.DragEvent, i: any) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, dateStr: string) => void;
  draggingId: number | null;
}) {
  const mStart = startOfMonth(props.cursor);
  const gridStart = startOfWeek(mStart);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const todayStr = toDateStr(new Date());
  const monthNum = props.cursor.getMonth();
  // 6th row is only rendered when the month actually spills into it — avoids a
  // near-empty trailing week.
  const weeks = days.length / 7;
  const lastWeekUsed = days
    .slice(35)
    .some((d) => d.getMonth() === monthNum);
  const visibleDays = lastWeekUsed ? days : days.slice(0, 35);

  return (
    <div className="rounded-lg border border-border overflow-hidden bg-surface">
      <div className="grid grid-cols-7 bg-surface-2 border-b border-border">
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
      <div className={`grid grid-cols-7 ${weeks ? "" : ""}`}>
        {visibleDays.map((day) => {
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
              t: x.allDay ? "00:00" : x.oraInizio ?? "99:99",
            })),
          ].sort((a, b) => a.t.localeCompare(b.t));
          return (
            <div
              key={dateStr}
              className={`group min-h-[116px] p-1.5 border-b border-r border-border last:border-r-0 transition-colors ${
                isOutsideMonth ? "bg-surface-2/50" : isWeekend ? "bg-surface-2/30" : ""
              } ${isToday ? "bg-primary/[0.06]" : ""}`}
              onDragOver={props.onDragOver}
              onDrop={(e) => props.onDrop(e, dateStr)}
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
                {!isOutsideMonth && (
                  <button
                    onClick={() => props.onNew(dateStr)}
                    title="Nuovo appuntamento"
                    className="h-5 w-5 grid place-items-center rounded text-text-3 opacity-0 group-hover:opacity-100 hover:bg-surface-2 transition"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="space-y-1">
                {merged.slice(0, 3).map((m) => {
                  if (m.kind === "ext") {
                    const e = m.data;
                    return (
                      <div
                        key={`ext-${e.id}`}
                        title={`${e.sourceNome} — ${e.titolo}${
                          e.allDay
                            ? " (tutto il giorno)"
                            : e.oraInizio
                            ? ` (${e.oraInizio}${e.oraFine ? `–${e.oraFine}` : ""})`
                            : ""
                        }${e.location ? `\n${e.location}` : ""}`}
                        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] leading-tight bg-surface-2/50 border border-dashed border-border/70 text-text-2"
                      >
                        <span
                          className="h-1.5 w-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: e.color }}
                        />
                        {!e.allDay && e.oraInizio && (
                          <span className="font-medium tabular-nums text-text-3 shrink-0">
                            {e.oraInizio}
                          </span>
                        )}
                        <Lock className="h-2 w-2 shrink-0 text-text-3" />
                        <span className="truncate">{e.titolo}</span>
                      </div>
                    );
                  }
                  const i = m.data;
                  const j = props.getJoined(i);
                  const label = j.nomeCognome || tipoLabels[i.tipo] || i.tipo;
                  const color = CALENDAR_COLOR_MAP[i.tipo] ?? "#6b7280";
                  return (
                    <div
                      key={i.id}
                      draggable
                      onDragStart={(e) => props.onDragStart(e, i)}
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onEdit(i);
                      }}
                      title={`${tipoLabels[i.tipo] ?? i.tipo}${
                        j.nomeCognome ? ` — ${j.nomeCognome}` : ""
                      }${j.indirizzo ? ` (${j.indirizzo})` : ""}`}
                      className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] leading-tight cursor-pointer bg-surface-2 hover:bg-surface border border-border/60 ${
                        props.draggingId === i.id ? "opacity-40" : ""
                      }`}
                    >
                      <span
                        className="h-1.5 w-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      {i.oraInizio && (
                        <span className="font-medium tabular-nums text-text-2 shrink-0">
                          {i.oraInizio}
                        </span>
                      )}
                      <span className="truncate">{label}</span>
                    </div>
                  );
                })}
                {merged.length > 3 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onOpenDay(dateStr);
                    }}
                    className="w-full text-left text-[11px] font-medium text-primary px-1.5 hover:underline"
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
function ExternalBlock(props: { event: any; size: "small" | "large" }) {
  const e = props.event;
  const large = props.size === "large";
  return (
    <div
      className="rounded border border-dashed border-border bg-surface-2/40 p-2"
      style={{ borderLeftColor: e.color, borderLeftWidth: 3 }}
      title={e.location || undefined}
    >
      <div
        className={`font-semibold ${
          large ? "text-xs" : "text-[10px]"
        } uppercase tracking-wide flex items-center gap-1 flex-wrap text-text-2`}
      >
        <Lock className="h-2.5 w-2.5 shrink-0 text-text-3" />
        {e.allDay ? (
          <span>Tutto il giorno</span>
        ) : e.oraInizio ? (
          <span className="inline-flex items-center gap-0.5 font-mono">
            <Clock className="h-2.5 w-2.5" />
            {e.oraInizio}
            {e.oraFine ? `–${e.oraFine}` : ""}
          </span>
        ) : null}
      </div>
      <p
        className={`mt-0.5 font-semibold text-text-1 ${
          large ? "text-sm" : "text-[10px]"
        }`}
        title={e.titolo}
      >
        <span className="line-clamp-2">{e.titolo}</span>
      </p>
      {e.location && (
        <p
          className={`mt-0.5 flex items-center gap-0.5 text-text-3 ${
            large ? "text-xs" : "text-[9px]"
          }`}
        >
          <MapPin className="h-2.5 w-2.5 shrink-0" />
          <span className="truncate">{e.location}</span>
        </p>
      )}
      <p
        className={`mt-0.5 text-text-3 ${large ? "text-[10px]" : "text-[8px]"}`}
      >
        {e.sourceNome}
      </p>
    </div>
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
}) {
  const i = props.intervento;
  const isDragging = props.draggingId === i.id;
  const indirizzoFull = props.joined.indirizzo
    ? props.joined.citta
      ? `${props.joined.indirizzo}, ${props.joined.citta}`
      : props.joined.indirizzo
    : "";
  return (
    <div
      draggable
      onDragStart={props.onDragStart}
      className={`rounded border p-2 cursor-pointer hover:shadow-sm transition-all ${
        tipoColors[i.tipo] ?? "bg-gray-50"
      } ${isDragging ? "opacity-30" : ""}`}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0 flex-1" onClick={props.onEdit}>
          <div className={`font-semibold text-${props.size === "large" ? "xs" : "[10px]"} uppercase tracking-wide flex items-center gap-1 flex-wrap`}>
            {i.oraInizio && (
              <span className="inline-flex items-center gap-0.5 font-mono">
                <Clock className="h-2.5 w-2.5" />
                {i.oraInizio}
                {i.oraFine ? `–${i.oraFine}` : ""}
              </span>
            )}
            <span>{tipoLabels[i.tipo] ?? i.tipo}</span>
          </div>
          {props.joined.nomeCognome && (
            <p
              className={`mt-0.5 font-semibold flex items-center gap-0.5 ${
                props.size === "large" ? "text-sm" : "text-[10px]"
              }`}
              title={props.joined.nomeCognome}
            >
              <UserIcon className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{props.joined.nomeCognome}</span>
            </p>
          )}
          {indirizzoFull && (
            <p className={`mt-0.5 flex items-center gap-0.5 opacity-80 ${props.size === "large" ? "text-xs" : "text-[9px]"}`}>
              <MapPin className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{indirizzoFull}</span>
            </p>
          )}
          {i.note && (
            <p className={`mt-0.5 ${props.size === "large" ? "text-xs" : "text-[9px]"} line-clamp-2`}>{i.note}</p>
          )}
          <Badge
            variant={i.stato === "in_corso" ? "default" : "secondary"}
            className={`${props.size === "large" ? "text-[10px]" : "text-[8px]"} mt-1 px-1 py-0`}
          >
            {(i.stato ?? "pianificato").replace(/_/g, " ")}
          </Badge>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); props.onAnnulla(); }}
          className="shrink-0 rounded p-0.5 hover:bg-red-100 hover:text-red-700 transition-colors"
          title="Elimina appuntamento"
        >
          <X className={props.size === "large" ? "h-4 w-4" : "h-3 w-3"} />
        </button>
      </div>
    </div>
  );
}
