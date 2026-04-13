import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Camera,
  AlertTriangle,
  Play,
  Square,
} from "lucide-react";
import { useState } from "react";
import { useLocation, useParams } from "wouter";

// ── Checklist templates per tipo intervento ───────────────────────────────────

type ChecklistTemplate = {
  descrizione: string;
  obbligatorio: boolean;
  fotoObbligatoria: boolean;
  categoria: string;
};

const checklistPosa: ChecklistTemplate[] = [
  { descrizione: "Verifica dimensioni vano e confronto con ordine", obbligatorio: true, fotoObbligatoria: false, categoria: "Preparazione" },
  { descrizione: "Rimozione infisso esistente", obbligatorio: true, fotoObbligatoria: true, categoria: "Preparazione" },
  { descrizione: "Pulizia e preparazione vano", obbligatorio: true, fotoObbligatoria: false, categoria: "Preparazione" },
  { descrizione: "Verifica stato falsotelaio / controtelaio", obbligatorio: true, fotoObbligatoria: true, categoria: "Preparazione" },
  { descrizione: "Posizionamento e livellamento telaio", obbligatorio: true, fotoObbligatoria: true, categoria: "Installazione" },
  { descrizione: "Fissaggio meccanico telaio", obbligatorio: true, fotoObbligatoria: false, categoria: "Installazione" },
  { descrizione: "Applicazione schiuma poliuretanica / sigillatura", obbligatorio: true, fotoObbligatoria: true, categoria: "Installazione" },
  { descrizione: "Montaggio ante e vetri", obbligatorio: true, fotoObbligatoria: false, categoria: "Installazione" },
  { descrizione: "Regolazione ferramenta e cerniere", obbligatorio: true, fotoObbligatoria: false, categoria: "Regolazione" },
  { descrizione: "Verifica apertura/chiusura corretta", obbligatorio: true, fotoObbligatoria: false, categoria: "Regolazione" },
  { descrizione: "Verifica tenuta guarnizioni", obbligatorio: true, fotoObbligatoria: false, categoria: "Regolazione" },
  { descrizione: "Montaggio maniglie e accessori", obbligatorio: false, fotoObbligatoria: false, categoria: "Finitura" },
  { descrizione: "Montaggio coprifili / cornici", obbligatorio: false, fotoObbligatoria: true, categoria: "Finitura" },
  { descrizione: "Sigillatura esterna", obbligatorio: true, fotoObbligatoria: true, categoria: "Finitura" },
  { descrizione: "Pulizia finale e rimozione protezioni", obbligatorio: true, fotoObbligatoria: true, categoria: "Finitura" },
  { descrizione: "Foto finale apertura completata", obbligatorio: true, fotoObbligatoria: true, categoria: "Documentazione" },
];

const checklistScorrevole: ChecklistTemplate[] = [
  ...checklistPosa.slice(0, 3),
  { descrizione: "Verifica planarità pavimento per binario", obbligatorio: true, fotoObbligatoria: true, categoria: "Preparazione" },
  { descrizione: "Installazione binario inferiore", obbligatorio: true, fotoObbligatoria: true, categoria: "Installazione" },
  { descrizione: "Installazione binario superiore", obbligatorio: true, fotoObbligatoria: true, categoria: "Installazione" },
  ...checklistPosa.slice(4),
  { descrizione: "Verifica scorrimento fluido ante", obbligatorio: true, fotoObbligatoria: false, categoria: "Regolazione" },
];

function getChecklist(tipologia: string): ChecklistTemplate[] {
  if (tipologia === "scorrevole") return checklistScorrevole;
  return checklistPosa;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function PosaAssistita() {
  const params = useParams<{ interventoId: string }>();
  const [, setLocation] = useLocation();
  const interventoId = parseInt(params.interventoId ?? "0");

  const intervento = trpc.interventi.byId.useQuery(interventoId);
  const commessaId = intervento.data?.commessaId ?? 0;
  const commessa = trpc.commesse.byId.useQuery(commessaId, { enabled: commessaId > 0 });
  const aperture = trpc.aperture.byCommessa.useQuery(commessaId, { enabled: commessaId > 0 });
  const utils = trpc.useUtils();

  const updateStato = trpc.interventi.updateStato.useMutation({
    onSuccess: () => utils.interventi.invalidate(),
  });

  const createAnomalia = trpc.anomalie.create.useMutation({
    onSuccess: () => utils.anomalie.invalidate(),
  });

  // Checklist state: track completion per apertura
  const [completedItems, setCompletedItems] = useState<Record<string, Set<number>>>({});
  const [activeApertura, setActiveApertura] = useState<string | null>(null);
  const [anomaliaDialog, setAnomaliaDialog] = useState(false);
  const [anomaliaForm, setAnomaliaForm] = useState({
    aperturaId: "",
    categoria: "difetto_posa" as const,
    priorita: "media" as const,
    descrizione: "",
  });

  const i = intervento.data;
  const c = commessa.data;

  if (!i) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        {intervento.isLoading ? "Caricamento..." : "Intervento non trovato"}
      </div>
    );
  }

  const apertureList = aperture.data ?? [];
  const currentApertura = apertureList.find((a: any) => a.codice === activeApertura) ?? apertureList[0];
  const tipologia = currentApertura?.tipologia ?? "finestra";
  const checklist = getChecklist(tipologia);
  const completed = completedItems[activeApertura ?? currentApertura?.codice ?? ""] ?? new Set();

  const completedCount = completed.size;
  const totalRequired = checklist.filter((c) => c.obbligatorio).length;
  const completedRequired = checklist.filter(
    (c, idx) => c.obbligatorio && completed.has(idx)
  ).length;
  const progress = totalRequired > 0 ? Math.round((completedRequired / totalRequired) * 100) : 0;

  function toggleItem(idx: number) {
    const key = activeApertura ?? currentApertura?.codice ?? "";
    const current = new Set(completedItems[key] ?? []);
    if (current.has(idx)) current.delete(idx);
    else current.add(idx);
    setCompletedItems({ ...completedItems, [key]: current });
  }

  // Group checklist by categoria
  const categories = Array.from(new Set(checklist.map((c) => c.categoria)));

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocation(commessaId ? `/commesse/${commessaId}` : "/planning")}
          className="mb-2 -ml-2"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Torna
        </Button>

        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="outline" className="uppercase text-xs">
                {i.tipo}
              </Badge>
              <Badge
                variant={i.stato === "in_corso" ? "default" : "secondary"}
                className="text-xs"
              >
                {i.stato.replace(/_/g, " ")}
              </Badge>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">
              Posa assistita
            </h1>
            {c && (
              <p className="text-sm text-muted-foreground mt-1">
                {c.codice} — {c.cliente} — {i.indirizzo}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            {i.stato === "pianificato" && (
              <Button
                size="sm"
                disabled={updateStato.isPending}
                onClick={() =>
                  updateStato.mutate({ id: interventoId, stato: "in_corso" })
                }
              >
                <Play className="h-4 w-4 mr-1" />
                Avvia
              </Button>
            )}
            {i.stato === "in_corso" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  updateStato.mutate({ id: interventoId, stato: "completato" })
                }
                disabled={progress < 100 || updateStato.isPending}
              >
                <Square className="h-4 w-4 mr-1" />
                Completa
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Aperture selector */}
      {apertureList.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {apertureList.map((a: any) => {
            const key = a.codice;
            const done = completedItems[key] ?? new Set();
            const cl = getChecklist(a.tipologia);
            const req = cl.filter((c) => c.obbligatorio).length;
            const doneReq = cl.filter((c, idx) => c.obbligatorio && done.has(idx)).length;
            const isActive = (activeApertura ?? apertureList[0]?.codice) === key;

            return (
              <Button
                key={a.id}
                variant={isActive ? "default" : "outline"}
                size="sm"
                className="shrink-0 text-xs"
                onClick={() => setActiveApertura(key)}
              >
                {a.codice}
                {doneReq === req && req > 0 ? (
                  <CheckCircle2 className="h-3 w-3 ml-1 text-green-400" />
                ) : (
                  <span className="ml-1 opacity-60">
                    {doneReq}/{req}
                  </span>
                )}
              </Button>
            );
          })}
        </div>
      )}

      {/* Progress */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <Progress value={progress} className="h-2.5 flex-1" />
            <span className="text-sm font-mono font-bold w-12 text-right">
              {progress}%
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {completedRequired}/{totalRequired} passaggi obbligatori — {completedCount}/{checklist.length} totali
          </p>
        </CardContent>
      </Card>

      {/* Checklist by category */}
      {categories.map((cat) => (
        <div key={cat}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            {cat}
          </h3>
          <div className="space-y-1.5">
            {checklist
              .map((item, idx) => ({ item, idx }))
              .filter(({ item }) => item.categoria === cat)
              .map(({ item, idx }) => {
                const isDone = completed.has(idx);
                return (
                  <Card
                    key={idx}
                    className={`cursor-pointer transition-all ${isDone ? "bg-muted/40 border-green-200" : "hover:shadow-sm"}`}
                    onClick={() => toggleItem(idx)}
                  >
                    <CardContent className="p-3 flex items-start gap-3">
                      <div className="pt-0.5">
                        {isDone ? (
                          <CheckCircle2 className="h-5 w-5 text-green-600" />
                        ) : (
                          <Circle className="h-5 w-5 text-muted-foreground/40" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-sm ${isDone ? "line-through text-muted-foreground" : "font-medium"}`}
                        >
                          {item.descrizione}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          {item.obbligatorio && (
                            <Badge
                              variant="secondary"
                              className="text-[9px] px-1 py-0"
                            >
                              Obbligatorio
                            </Badge>
                          )}
                          {item.fotoObbligatoria && (
                            <Badge
                              variant="outline"
                              className="text-[9px] px-1 py-0 flex items-center gap-0.5"
                            >
                              <Camera className="h-2.5 w-2.5" />
                              Foto
                            </Badge>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
          </div>
        </div>
      ))}

      {/* Anomalia button */}
      <Separator />
      <Dialog open={anomaliaDialog} onOpenChange={setAnomaliaDialog}>
        <DialogTrigger asChild>
          <Button variant="outline" className="w-full border-dashed border-destructive text-destructive">
            <AlertTriangle className="h-4 w-4 mr-2" />
            Segnala anomalia
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Segnala anomalia</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Categoria</Label>
                <Select
                  value={anomaliaForm.categoria}
                  onValueChange={(v: any) =>
                    setAnomaliaForm({ ...anomaliaForm, categoria: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="materiale_difettoso">Materiale difettoso</SelectItem>
                    <SelectItem value="misura_errata">Misura errata</SelectItem>
                    <SelectItem value="danno_trasporto">Danno trasporto</SelectItem>
                    <SelectItem value="difetto_posa">Difetto posa</SelectItem>
                    <SelectItem value="problema_accessorio">Problema accessorio</SelectItem>
                    <SelectItem value="non_conformita">Non conformita</SelectItem>
                    <SelectItem value="altro">Altro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Priorita</Label>
                <Select
                  value={anomaliaForm.priorita}
                  onValueChange={(v: any) =>
                    setAnomaliaForm({ ...anomaliaForm, priorita: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bassa">Bassa</SelectItem>
                    <SelectItem value="media">Media</SelectItem>
                    <SelectItem value="alta">Alta</SelectItem>
                    <SelectItem value="critica">Critica</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Descrizione *</Label>
              <Textarea
                rows={3}
                value={anomaliaForm.descrizione}
                onChange={(e) =>
                  setAnomaliaForm({
                    ...anomaliaForm,
                    descrizione: e.target.value,
                  })
                }
              />
            </div>
            <Button
              onClick={() => {
                if (!anomaliaForm.descrizione) return;
                createAnomalia.mutate({
                  commessaId,
                  aperturaId: currentApertura?.id ?? undefined,
                  interventoId,
                  categoria: anomaliaForm.categoria,
                  priorita: anomaliaForm.priorita,
                  descrizione: anomaliaForm.descrizione,
                });
                setAnomaliaDialog(false);
                setAnomaliaForm({
                  aperturaId: "",
                  categoria: "difetto_posa",
                  priorita: "media",
                  descrizione: "",
                });
              }}
              disabled={createAnomalia.isPending}
            >
              Segnala
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
