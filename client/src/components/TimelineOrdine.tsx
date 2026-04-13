import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  CheckCircle2,
  Circle,
  PlayCircle,
  Paperclip,
  ChevronRight,
} from "lucide-react";
import { useState } from "react";

const statoIcons: Record<string, any> = {
  da_fare: Circle,
  in_corso: PlayCircle,
  completato: CheckCircle2,
};

const statoColors: Record<string, string> = {
  da_fare: "text-gray-300",
  in_corso: "text-blue-500",
  completato: "text-green-600",
};

export default function TimelineOrdine({ commessaId }: { commessaId: number }) {
  const steps = trpc.timeline.byCommessa.useQuery(commessaId);
  const stats = trpc.timeline.stats.useQuery(commessaId);
  const utils = trpc.useUtils();

  const updateStep = trpc.timeline.updateStep.useMutation({
    onSuccess: () => {
      utils.timeline.invalidate();
    },
  });

  const [editOpen, setEditOpen] = useState(false);
  const [editStep, setEditStep] = useState<any>(null);
  const [editForm, setEditForm] = useState({ utente: "", note: "", allegato: "" });

  function openEdit(step: any) {
    setEditStep(step);
    setEditForm({
      utente: step.utente ?? "",
      note: step.note ?? "",
      allegato: step.allegato ?? "",
    });
    setEditOpen(true);
  }

  function handleComplete() {
    if (!editStep) return;
    updateStep.mutate({
      id: editStep.id,
      stato: "completato",
      dataCompletamento: new Date().toISOString().split("T")[0],
      utente: editForm.utente || undefined,
      note: editForm.note || undefined,
      allegato: editForm.allegato || undefined,
    });
    setEditOpen(false);
  }

  function handleQuickAdvance(step: any) {
    if (step.stato === "da_fare") {
      updateStep.mutate({ id: step.id, stato: "in_corso" });
    } else if (step.stato === "in_corso") {
      openEdit(step);
    }
  }

  return (
    <div className="space-y-4">
      {/* Progress header */}
      <div className="flex items-center gap-3">
        <Progress value={stats.data?.percentuale ?? 0} className="h-2 flex-1" />
        <span className="text-sm font-semibold text-muted-foreground shrink-0">
          {stats.data?.completati ?? 0}/{stats.data?.totale ?? 19}
        </span>
      </div>

      {/* Timeline */}
      <div className="relative pl-6">
        {/* Vertical line */}
        <div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-border" />

        {steps.data?.map((step: any) => {
          const Icon = statoIcons[step.stato] ?? Circle;
          const color = statoColors[step.stato] ?? "";

          return (
            <div key={step.id} className="relative flex items-start gap-3 pb-4 last:pb-0">
              {/* Icon on the line */}
              <div className="absolute -left-6 mt-0.5">
                <Icon className={`h-[22px] w-[22px] ${color} bg-background rounded-full`} />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-mono text-muted-foreground">
                    {step.stepNumber}.
                  </span>
                  <span className={`text-sm font-medium ${step.stato === "completato" ? "line-through text-muted-foreground" : ""}`}>
                    {step.label}
                  </span>
                  {step.allegato && (
                    <Paperclip className="h-3 w-3 text-muted-foreground" />
                  )}
                </div>
                {step.stato === "completato" && (
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-0.5">
                    {step.dataCompletamento && <span>{step.dataCompletamento}</span>}
                    {step.utente && <span>— {step.utente}</span>}
                    {step.note && <span className="italic truncate max-w-[200px]">{step.note}</span>}
                  </div>
                )}
              </div>

              {/* Action */}
              {step.stato !== "completato" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-7 shrink-0"
                  onClick={() => handleQuickAdvance(step)}
                >
                  {step.stato === "da_fare" ? "Avvia" : "Completa"}
                  <ChevronRight className="h-3 w-3 ml-0.5" />
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {/* Edit/Complete dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">
              Completa: {editStep?.label}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label>Eseguito da</Label>
              <Input
                value={editForm.utente}
                onChange={(e) => setEditForm({ ...editForm, utente: e.target.value })}
                placeholder="Nome operatore"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Note</Label>
              <Textarea
                rows={2}
                value={editForm.note}
                onChange={(e) => setEditForm({ ...editForm, note: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Allegato (nome file)</Label>
              <Input
                value={editForm.allegato}
                onChange={(e) => setEditForm({ ...editForm, allegato: e.target.value })}
                placeholder="contratto.pdf"
              />
            </div>
            <Button onClick={handleComplete} disabled={updateStep.isPending}>
              Segna come completato
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
