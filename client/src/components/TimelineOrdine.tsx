import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
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
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import SearchSelect from "@/components/SearchSelect";

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
  const utenti = trpc.utenti.list.useQuery(undefined);
  const utils = trpc.useUtils();

  const updateStep = trpc.timeline.updateStep.useMutation({
    onSuccess: () => {
      utils.timeline.invalidate();
    },
  });

  const [editOpen, setEditOpen] = useState(false);
  const [editStep, setEditStep] = useState<any>(null);
  const [editForm, setEditForm] = useState({ utente: "", note: "" });
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

  // Map utenti → SearchSelect options. value is stored as the full display
  // name (server field `utente` is a plain string) so we don't have to touch
  // the schema. Keywords expose email/role for richer search.
  const utenteOptions = useMemo(
    () =>
      (utenti.data ?? []).map((u: any) => {
        const fullName = [u.nome, u.cognome].filter(Boolean).join(" ") || u.email;
        return {
          value: fullName,
          label: fullName,
          keywords: [u.email, u.ruolo, u.ruoli?.join(" ")]
            .filter(Boolean)
            .join(" "),
          hint: u.ruolo ?? u.ruoli?.[0],
        };
      }),
    [utenti.data]
  );

  function openEdit(step: any) {
    setEditStep(step);
    setEditForm({
      utente: step.utente ?? "",
      note: step.note ?? "",
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
      <CardContent className="p-3 space-y-3">
        {/* Compact header: title + progress inline */}
        <div className="flex items-center gap-3">
          <div className="h-7 w-7 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 shrink-0">
            <h3 className="text-sm font-semibold leading-tight">
              Timeline ordine
            </h3>
            <p className="text-[11px] text-muted-foreground leading-tight">
              {done}/{total} step
            </p>
          </div>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Progress value={pct} className="h-1.5 flex-1" />
            <span className="text-xs font-bold tabular-nums text-primary shrink-0">
              {pct}%
            </span>
          </div>
        </div>

        {/* Current step callout — compact row */}
        {currentStep && (
          <div className="flex items-center gap-2.5 rounded-md border border-blue-200 bg-blue-50/70 px-2.5 py-1.5">
            <div
              className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                statoDotBg[currentStep.stato]
              }`}
            >
              {currentStep.stepNumber}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-wide text-blue-700 font-semibold leading-tight">
                {currentStep.stato === "in_corso" ? "In corso" : "Prossimo"}
              </p>
              <p className="text-[13px] font-medium truncate leading-tight">
                {currentStep.label}
              </p>
            </div>
            <Button
              size="sm"
              className="h-7 text-xs shrink-0"
              onClick={() => handleQuickAdvance(currentStep)}
              disabled={updateStep.isPending}
            >
              {currentStep.stato === "da_fare" ? "Avvia" : "Completa"}
              <ChevronRight className="h-3 w-3 ml-0.5" />
            </Button>
          </div>
        )}

        {/* Horizontal mini-stepper — compact dots */}
        <div className="overflow-x-auto -mx-3 px-3">
          <div className="flex items-center gap-0.5 min-w-max pb-0.5">
            {steps.data?.map((step: any, i: number) => {
              const isCurrent = currentStep?.id === step.id;
              return (
                <div key={step.id} className="flex items-center">
                  <button
                    type="button"
                    onClick={() => openEdit(step)}
                    title={`${step.stepNumber}. ${step.label}`}
                    className={`h-6 w-6 rounded-full border-2 flex items-center justify-center text-[9px] font-bold transition-all hover:scale-110 ${
                      statoDotBg[step.stato]
                    } ${isCurrent ? "ring-2 ring-offset-1 ring-blue-400" : ""}`}
                  >
                    {step.stato === "completato" ? (
                      <CheckCircle2 className="h-3 w-3" />
                    ) : (
                      step.stepNumber
                    )}
                  </button>
                  {i < (steps.data?.length ?? 0) - 1 && (
                    <div
                      className={`h-0.5 w-3 ${
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
            className="w-full justify-center text-muted-foreground h-6 text-xs"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3 w-3 mr-1" />
                Nascondi dettagli
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3 mr-1" />
                Tutti gli step
              </>
            )}
          </Button>

          {expanded && (
            <div className="relative pl-5 mt-2">
              <div className="absolute left-[9px] top-1.5 bottom-1.5 w-0.5 bg-border" />

              {steps.data?.map((step: any) => {
                const Icon = statoIcons[step.stato] ?? Circle;
                const color = statoColors[step.stato] ?? "";

                return (
                  <div
                    key={step.id}
                    className="relative flex items-start gap-2 pb-2.5 last:pb-0"
                  >
                    <div className="absolute -left-5 mt-0">
                      <Icon
                        className={`h-[18px] w-[18px] ${color} bg-background rounded-full`}
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] font-mono text-muted-foreground">
                          {step.stepNumber}.
                        </span>
                        <span
                          className={`text-xs font-medium ${
                            step.stato === "completato"
                              ? "line-through text-muted-foreground"
                              : ""
                          }`}
                        >
                          {step.label}
                        </span>
                      </div>
                      {step.stato === "completato" && (
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
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
                        className="text-[11px] h-6 px-2 shrink-0"
                        onClick={() => handleQuickAdvance(step)}
                      >
                        {step.stato === "da_fare" ? "Avvia" : "Completa"}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>

      {/* Edit/Complete dialog — no allegato input, utente picked from users */}
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
              <SearchSelect
                options={utenteOptions}
                value={editForm.utente}
                onChange={(v) => setEditForm({ ...editForm, utente: v })}
                placeholder="Seleziona utente"
                searchPlaceholder="Cerca utente..."
                allowClear
                clearLabel="— Nessuno —"
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
