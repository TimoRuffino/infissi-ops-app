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
} from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import ConfirmDialog from "@/components/ConfirmDialog";

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
  const [view, setView] = useState<"day" | "week" | "month">("week");
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
  const commesse = trpc.commesse.list.useQuery({});
  const squadre = trpc.squadre.list.useQuery();
  const ticketList = trpc.ticket.list.useQuery({});
  const reclami = trpc.reclamiRifacimenti.reclami.list.useQuery({});
  const rifacimenti = trpc.reclamiRifacimenti.rifacimenti.list.useQuery({});

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
  const updateStato = trpc.interventi.updateStato.useMutation({
    onSuccess: () => {
      utils.interventi.invalidate();
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
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <CalIcon className="h-6 w-6" />
            Pianificazione
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Calendario interventi — trascina per spostare gli appuntamenti
          </p>
        </div>
        <Button size="sm" onClick={() => openCreateFor()}>
          <Plus className="h-4 w-4 mr-1" />
          Nuovo appuntamento
        </Button>
      </div>

      {/* Controls: view switcher + navigation */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1 border rounded-md p-0.5 bg-muted/30">
          <Button
            variant={view === "day" ? "default" : "ghost"}
            size="sm"
            className="h-7 px-3"
            onClick={() => setView("day")}
          >
            <CalIcon className="h-3.5 w-3.5 mr-1.5" /> Giorno
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
            variant={view === "month" ? "default" : "ghost"}
            size="sm"
            className="h-7 px-3"
            onClick={() => setView("month")}
          >
            <CalendarRange className="h-3.5 w-3.5 mr-1.5" /> Mese
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

      {/* View renderers */}
      {view === "day" && (
        <DayView
          date={cursor}
          interventi={byDay[toDateStr(cursor)] ?? []}
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
          onNew={openCreateFor}
          onEdit={openEdit}
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
            <DialogTitle>{editId ? "Modifica appuntamento" : "Nuovo appuntamento"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            {/* Link target */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5"><Link2 className="h-3.5 w-3.5" /> Collega a</Label>
              <Select
                value={form.linkKind}
                onValueChange={(v: LinkKind) => setForm({ ...form, linkKind: v, linkId: "" })}
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
              <Select
                value={form.linkId}
                onValueChange={(v) => setForm({ ...form, linkId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleziona..." />
                </SelectTrigger>
                <SelectContent>
                  {form.linkKind === "commessa" && commesse.data?.map((c: any) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.codice} — {c.cliente}
                    </SelectItem>
                  ))}
                  {form.linkKind === "ticket" && ticketList.data?.map((t: any) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      #{t.id} — {t.oggetto ?? t.titolo ?? "Ticket"}
                    </SelectItem>
                  ))}
                  {form.linkKind === "reclamo" && reclami.data?.map((r: any) => (
                    <SelectItem key={r.id} value={String(r.id)}>
                      #{r.id} — {r.oggetto ?? r.descrizione ?? "Reclamo"}
                    </SelectItem>
                  ))}
                  {form.linkKind === "rifacimento" && rifacimenti.data?.map((r: any) => (
                    <SelectItem key={r.id} value={String(r.id)}>
                      #{r.id} — {r.descrizione ?? "Rifacimento"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              <Select
                value={form.squadraId}
                onValueChange={(v) => setForm({ ...form, squadraId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Non assegnata" />
                </SelectTrigger>
                <SelectContent>
                  {squadre.data?.map((s: any) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.nome} {s.caposquadra ? `— ${s.caposquadra}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
        {props.interventi.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12 italic">
            Nessun appuntamento. Trascina qui o clicca "Aggiungi".
          </p>
        ) : (
          props.interventi.map((i: any) => (
            <InterventoBlock
              key={i.id}
              intervento={i}
              onEdit={() => props.onEdit(i)}
              onAnnulla={() => props.onAnnulla(i)}
              onDragStart={(e) => props.onDragStart(e, i)}
              draggingId={props.draggingId}
              size="large"
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

// ── WEEK VIEW ────────────────────────────────────────────────────────────────
function WeekView(props: {
  cursor: Date;
  byDay: Record<string, any[]>;
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
                  onEdit={() => props.onEdit(i)}
                  onAnnulla={() => props.onAnnulla(i)}
                  onDragStart={(e) => props.onDragStart(e, i)}
                  draggingId={props.draggingId}
                  size="small"
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
  onNew: (dateStr: string) => void;
  onEdit: (i: any) => void;
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

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="grid grid-cols-7 bg-muted/40 border-b">
        {dayNamesLong.map((d) => (
          <div key={d} className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-center">
            {d.slice(0, 3)}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day, idx) => {
          const dateStr = toDateStr(day);
          const isToday = dateStr === todayStr;
          const isOutsideMonth = day.getMonth() !== monthNum;
          const items = props.byDay[dateStr] ?? [];
          return (
            <div
              key={dateStr}
              className={`min-h-[110px] p-1.5 border-b border-r last:border-r-0 ${
                isOutsideMonth ? "bg-muted/20 text-muted-foreground" : ""
              } ${isToday ? "bg-amber-50" : ""}`}
              onDragOver={props.onDragOver}
              onDrop={(e) => props.onDrop(e, dateStr)}
            >
              <div className="flex items-center justify-between mb-1">
                <span className={`text-xs font-semibold ${isToday ? "bg-foreground text-background rounded-full w-5 h-5 flex items-center justify-center" : ""}`}>
                  {day.getDate()}
                </span>
                {!isOutsideMonth && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-4 w-4 opacity-0 hover:opacity-100"
                    onClick={() => props.onNew(dateStr)}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                )}
              </div>
              <div className="space-y-0.5">
                {items.slice(0, 3).map((i: any) => (
                  <div
                    key={i.id}
                    draggable
                    onDragStart={(e) => props.onDragStart(e, i)}
                    onClick={() => props.onEdit(i)}
                    className={`text-[9px] px-1 py-0.5 rounded border truncate cursor-pointer hover:opacity-80 ${tipoColors[i.tipo] ?? "bg-gray-100"} ${
                      i.stato === "annullato" ? "line-through opacity-50" : ""
                    } ${props.draggingId === i.id ? "opacity-40" : ""}`}
                  >
                    {i.oraInizio ? `${i.oraInizio} ` : ""}{tipoLabels[i.tipo] ?? i.tipo}
                  </div>
                ))}
                {items.length > 3 && (
                  <div className="text-[9px] text-muted-foreground px-1">+{items.length - 3} altro</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── INTERVENTO CARD BLOCK ────────────────────────────────────────────────────
function InterventoBlock(props: {
  intervento: any;
  onEdit: () => void;
  onAnnulla: () => void;
  onDragStart: (e: React.DragEvent) => void;
  draggingId: number | null;
  size: "small" | "large";
}) {
  const i = props.intervento;
  const isAnnullato = i.stato === "annullato";
  const isDragging = props.draggingId === i.id;
  return (
    <div
      draggable
      onDragStart={props.onDragStart}
      className={`rounded border p-2 cursor-pointer hover:shadow-sm transition-all ${
        tipoColors[i.tipo] ?? "bg-gray-50"
      } ${isAnnullato ? "opacity-50" : ""} ${isDragging ? "opacity-30" : ""}`}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0 flex-1" onClick={props.onEdit}>
          <div className={`font-semibold text-${props.size === "large" ? "xs" : "[10px]"} uppercase tracking-wide flex items-center gap-1 ${isAnnullato ? "line-through" : ""}`}>
            {i.oraInizio && (
              <span className="inline-flex items-center gap-0.5 font-mono">
                <Clock className="h-2.5 w-2.5" />
                {i.oraInizio}
                {i.oraFine ? `–${i.oraFine}` : ""}
              </span>
            )}
            <span>{tipoLabels[i.tipo] ?? i.tipo}</span>
          </div>
          {i.indirizzo && (
            <p className={`mt-0.5 flex items-center gap-0.5 opacity-80 ${props.size === "large" ? "text-xs" : "text-[9px]"}`}>
              <MapPin className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{i.indirizzo}</span>
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
        {!isAnnullato && (
          <button
            onClick={(e) => { e.stopPropagation(); props.onAnnulla(); }}
            className="shrink-0 rounded p-0.5 hover:bg-red-100 hover:text-red-700 transition-colors"
            title="Annulla appuntamento"
          >
            <X className={props.size === "large" ? "h-4 w-4" : "h-3 w-3"} />
          </button>
        )}
      </div>
    </div>
  );
}
