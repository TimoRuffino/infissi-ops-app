import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  ChevronDown,
  ChevronUp,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";

const statoIcons: Record<string, any> = {
  da_fare: Circle,
  in_corso: PlayCircle,
  completato: CheckCircle2,
};

const statoColors: Record<string, string> = {
  da_fare: "text-slate-300",
  in_corso: "text-blue-500",
  completato: "text-emerald-600",
};

const statoDotBg: Record<string, string> = {
  da_fare: "bg-slate-200 text-slate-500 border-slate-300",
  in_corso: "bg-blue-500 text-white border-blue-600",
  completato: "bg-emerald-500 text-white border-emerald-600",
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
  const [expanded, setExpanded] = useState(false);

  // Current step: first non-completed; highlighted in hero row.
  const currentStep = useMemo(() => {
    if (!steps.data) return null;
    return (
      steps.data.find((s: any) => s.stato === "in_corso") ??
      steps.data.find((s: any) => s.stato === "da_fare") ??
      null
    );
  }, [steps.data]);

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

  const pct = stats.data?.percentuale ?? 0;
  const done = stats.data?.completati ?? 0;
  const total = stats.data?.totale ?? steps.data?.length ?? 19;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">Timeline ordine</h3>
              <p className="text-xs text-muted-foreground truncate">
                {done} di {total} step completati
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-1 min-w-[180px]">
            <Progress value={pct} className="h-2 flex-1" />
            <span className="text-sm font-bold tabular-nums text-primary shrink-0">
              {pct}%
            </span>
          </div>
        </div>

        {/* Current step callout */}
        {currentStep && (
          <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50/70 p-3">
            <div
              className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                statoDotBg[currentStep.stato]
              }`}
            >
              {currentStep.stepNumber}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] uppercase tracking-wide text-blue-700 font-semibold">
                {currentStep.stato === "in_corso" ? "In corso" : "Prossimo step"}
              </p>
              <p className="text-sm font-medium truncate">{currentStep.label}</p>
            </div>
            <Button
              size="sm"
              onClick={() => handleQuickAdvance(currentStep)}
              disabled={updateStep.isPending}
            >
              {currentStep.stato === "da_fare" ? "Avvia" : "Completa"}
              <ChevronRight className="h-3 w-3 ml-1" />
            </Button>
          </div>
        )}

        {/* Horizontal mini-stepper */}
        <div className="overflow-x-auto -mx-4 px-4">
          <div className="flex items-center gap-1 min-w-max pb-1">
            {steps.data?.map((step: any, i: number) => {
              const isCurrent = currentStep?.id === step.id;
              return (
                <div key={step.id} className="flex items-center">
                  <button
                    type="button"
                    onClick={() => openEdit(step)}
                    title={`${step.stepNumber}. ${step.label}`}
                    className={`h-7 w-7 rounded-full border-2 flex items-center justify-center text-[10px] font-bold transition-all hover:scale-110 ${
                      statoDotBg[step.stato]
                    } ${isCurrent ? "ring-2 ring-offset-1 ring-blue-400" : ""}`}
                  >
                    {step.stato === "completato" ? (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    ) : (
                      step.stepNumber
                    )}
                  </button>
                  {i < (steps.data?.length ?? 0) - 1 && (
                    <div
                      className={`h-0.5 w-5 ${
                        step.stato === "completato"
                          ? "bg-emerald-400"
                          : "bg-slate-200"
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Expandable full list */}
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-center text-muted-foreground"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3.5 w-3.5 mr-1" />
                Nascondi dettagli
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5 mr-1" />
                Mostra tutti gli step
              </>
            )}
          </Button>

          {expanded && (
            <div className="relative pl-6 mt-3">
              {/* Vertical line */}
              <div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-border" />

              {steps.data?.map((step: any) => {
                const Icon = statoIcons[step.stato] ?? Circle;
                const color = statoColors[step.stato] ?? "";

                return (
                  <div
                    key={step.id}
                    className="relative flex items-start gap-3 pb-4 last:pb-0"
                  >
                    <div className="absolute -left-6 mt-0.5">
                      <Icon
                        className={`h-[22px] w-[22px] ${color} bg-background rounded-full`}
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono text-muted-foreground">
                          {step.stepNumber}.
                        </span>
                        <span
                          className={`text-sm font-medium ${
                            step.stato === "completato"
                              ? "line-through text-muted-foreground"
                              : ""
                          }`}
                        >
                          {step.label}
                        </span>
                        {step.allegato && (
                          <Paperclip className="h-3 w-3 text-muted-foreground" />
                        )}
                      </div>
                      {step.stato === "completato" && (
                        <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-0.5">
                          {step.dataCompletamento && (
                            <span>{step.dataCompletamento}</span>
                          )}
                          {step.utente && <span>— {step.utente}</span>}
                          {step.note && (
                            <span className="italic truncate max-w-[200px]">
                              {step.note}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

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
          )}
        </div>
      </CardContent>

      {/* Edit/Complete dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {editStep?.stato === "completato" ? "Step: " : "Completa: "}
              {editStep?.label}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label>Eseguito da</Label>
              <Input
                value={editForm.utente}
                onChange={(e) =>
                  setEditForm({ ...editForm, utente: e.target.value })
                }
                placeholder="Nome operatore"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Note</Label>
              <Textarea
                rows={2}
                value={editForm.note}
                onChange={(e) =>
                  setEditForm({ ...editForm, note: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Allegato (nome file)</Label>
              <Input
                value={editForm.allegato}
                onChange={(e) =>
                  setEditForm({ ...editForm, allegato: e.target.value })
                }
                placeholder="contratto.pdf"
              />
            </div>
            <Button onClick={handleComplete} disabled={updateStep.isPending}>
              {editStep?.stato === "completato"
                ? "Aggiorna"
                : "Segna come completato"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
