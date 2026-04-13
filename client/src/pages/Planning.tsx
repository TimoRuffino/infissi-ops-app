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
} from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";

function getWeekDates(offset: number) {
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - today.getDay() + 1 + offset * 7);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push(d);
  }
  return days;
}

function formatDate(d: Date) {
  return d.toISOString().split("T")[0];
}

const dayNames = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
const tipoColors: Record<string, string> = {
  rilievo: "bg-blue-100 text-blue-800 border-blue-200",
  posa: "bg-orange-100 text-orange-800 border-orange-200",
  assistenza: "bg-purple-100 text-purple-800 border-purple-200",
  sopralluogo: "bg-amber-100 text-amber-800 border-amber-200",
  altro: "bg-gray-100 text-gray-800 border-gray-200",
};

export default function Planning() {
  const [, setLocation] = useLocation();
  const [weekOffset, setWeekOffset] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const days = getWeekDates(weekOffset);
  const from = formatDate(days[0]);
  const to = formatDate(days[6]);
  const todayStr = formatDate(new Date());

  const interventi = trpc.interventi.list.useQuery({ from, to });
  const commesse = trpc.commesse.list.useQuery({});
  const squadre = trpc.squadre.list.useQuery();

  const utils = trpc.useUtils();
  const createIntervento = trpc.interventi.create.useMutation({
    onSuccess: () => {
      utils.interventi.invalidate();
      setDialogOpen(false);
    },
  });

  const [form, setForm] = useState({
    commessaId: "",
    squadraId: "",
    tipo: "posa" as const,
    dataPianificata: "",
    indirizzo: "",
    note: "",
  });

  function handleCreate() {
    if (!form.commessaId || !form.dataPianificata) return;
    createIntervento.mutate({
      commessaId: parseInt(form.commessaId),
      squadraId: form.squadraId ? parseInt(form.squadraId) : null,
      tipo: form.tipo,
      dataPianificata: form.dataPianificata,
      indirizzo: form.indirizzo || undefined,
      note: form.note || undefined,
    });
  }

  const monthYear = days[3].toLocaleDateString("it-IT", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pianificazione</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Calendario interventi settimanale
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Nuovo intervento
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Pianifica intervento</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="space-y-1.5">
                <Label>Commessa *</Label>
                <Select
                  value={form.commessaId}
                  onValueChange={(v) => setForm({ ...form, commessaId: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleziona commessa" />
                  </SelectTrigger>
                  <SelectContent>
                    {commesse.data?.map((c: any) => (
                      <SelectItem key={c.id} value={c.id.toString()}>
                        {c.codice} — {c.cliente}
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
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rilievo">Rilievo</SelectItem>
                      <SelectItem value="posa">Posa</SelectItem>
                      <SelectItem value="assistenza">Assistenza</SelectItem>
                      <SelectItem value="sopralluogo">Sopralluogo</SelectItem>
                      <SelectItem value="altro">Altro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Data *</Label>
                  <Input
                    type="date"
                    value={form.dataPianificata}
                    onChange={(e) =>
                      setForm({ ...form, dataPianificata: e.target.value })
                    }
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
                      <SelectItem key={s.id} value={s.id.toString()}>
                        {s.nome} — {s.caposquadra}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Indirizzo</Label>
                <Input
                  value={form.indirizzo}
                  onChange={(e) =>
                    setForm({ ...form, indirizzo: e.target.value })
                  }
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
                onClick={handleCreate}
                disabled={createIntervento.isPending}
              >
                Pianifica
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Week navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="icon"
          onClick={() => setWeekOffset(weekOffset - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="text-center">
          <span className="font-semibold capitalize">{monthYear}</span>
          {weekOffset !== 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-2 text-xs"
              onClick={() => setWeekOffset(0)}
            >
              Oggi
            </Button>
          )}
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setWeekOffset(weekOffset + 1)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Week grid */}
      <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
        {days.map((day, idx) => {
          const dateStr = formatDate(day);
          const isToday = dateStr === todayStr;
          const dayInterventi =
            interventi.data?.filter((i: any) => i.dataPianificata === dateStr) ??
            [];
          const isWeekend = idx >= 5;

          return (
            <Card
              key={dateStr}
              className={`min-h-[140px] ${isToday ? "border-foreground/40 bg-muted/30" : ""} ${isWeekend ? "opacity-60" : ""}`}
            >
              <CardHeader className="pb-2 pt-3 px-3">
                <CardTitle className="text-xs font-medium flex items-center justify-between">
                  <span className={isToday ? "font-bold" : ""}>
                    {dayNames[idx]}
                  </span>
                  <span
                    className={`text-lg font-bold ${isToday ? "bg-foreground text-background rounded-full w-7 h-7 flex items-center justify-center" : ""}`}
                  >
                    {day.getDate()}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-2 pb-2 space-y-1.5">
                {dayInterventi.map((i: any) => (
                  <div
                    key={i.id}
                    className={`text-xs p-2 rounded border cursor-pointer hover:opacity-80 ${tipoColors[i.tipo] ?? "bg-gray-50"}`}
                    onClick={() =>
                      i.tipo === "posa" || i.tipo === "assistenza"
                        ? setLocation(`/posa/${i.id}`)
                        : setLocation(`/commesse/${i.commessaId}`)
                    }
                  >
                    <div className="font-semibold uppercase tracking-wide text-[10px]">
                      {i.tipo}
                    </div>
                    {i.note && (
                      <p className="mt-0.5 line-clamp-2">{i.note}</p>
                    )}
                    {i.indirizzo && (
                      <p className="mt-0.5 flex items-center gap-0.5 opacity-70">
                        <MapPin className="h-2.5 w-2.5" />
                        {i.indirizzo}
                      </p>
                    )}
                    <Badge
                      variant={
                        i.stato === "in_corso" ? "default" : "secondary"
                      }
                      className="text-[9px] mt-1 px-1 py-0"
                    >
                      {i.stato.replace(/_/g, " ")}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
