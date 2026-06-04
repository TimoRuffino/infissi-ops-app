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
  ChevronRight,
  ChevronDown,
  Paperclip,
  Sparkles,
} from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import SearchSelect from "@/components/SearchSelect";

// The 19 PRD steps grouped under the 4 board phases (redesign §4.3).
// Ranges are by stepNumber (1-based, inclusive).
const FASI = [
  { id: "vendita", label: "Vendita", dot: "bg-st-preventivo", from: 1, to: 5 },
  { id: "ordine", label: "Ordine & Produzione", dot: "bg-st-ordine", from: 6, to: 10 },
  { id: "consegna", label: "Consegna & Posa", dot: "bg-st-produzione", from: 11, to: 15 },
  { id: "chiusura", label: "Chiusura", dot: "bg-st-pagamento", from: 16, to: 19 },
] as const;

function faseOf(stepNumber: number) {
  return FASI.find((f) => stepNumber >= f.from && stepNumber <= f.to) ?? FASI[3];
}

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
  const [openFasi, setOpenFasi] = useState<Record<string, boolean>>({});

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

  // Auto-open the phase that contains the current step (others collapsed).
  const currentFaseId = currentStep ? faseOf(currentStep.stepNumber).id : null;
  useEffect(() => {
    if (currentFaseId) setOpenFasi((m) => ({ ...m, [currentFaseId]: true }));
  }, [currentFaseId]);

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4 space-y-3">
        {/* Header: title + progress */}
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0 shrink-0">
            <h3 className="text-[15px] font-semibold leading-tight">Timeline ordine</h3>
            <p className="text-xs text-text-2 leading-tight tabular-nums">
              {done}/{total} step completati
            </p>
          </div>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Progress value={pct} className="h-1.5 flex-1" />
            <span className="text-xs font-bold tabular-nums text-primary shrink-0">
              {pct}%
            </span>
          </div>
        </div>

        {/* Phase sections — collapsible */}
        <div className="space-y-1.5">
          {FASI.map((fase) => {
            const fSteps = (steps.data ?? []).filter(
              (s: any) => s.stepNumber >= fase.from && s.stepNumber <= fase.to
            );
            if (fSteps.length === 0) return null;
            const fDone = fSteps.filter((s: any) => s.stato === "completato").length;
            const open = !!openFasi[fase.id];
            return (
              <div key={fase.id} className="rounded-md border border-border">
                <button
                  type="button"
                  onClick={() => setOpenFasi((m) => ({ ...m, [fase.id]: !m[fase.id] }))}
                  className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-surface-2 transition-colors rounded-md"
                >
                  <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${fase.dot}`} />
                  <span className="text-sm font-semibold flex-1 text-left">
                    {fase.label}
                  </span>
                  <span className="text-xs text-text-2 tabular-nums">
                    {fDone}/{fSteps.length}
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 text-text-3 transition-transform ${
                      open ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {open && (
                  <div className="relative px-3 pb-2.5 pt-1">
                    {fSteps.map((step: any) => {
                      const isCurrent = currentStep?.id === step.id;
                      const completed = step.stato === "completato";
                      const future = !completed && !isCurrent;
                      const hasAllegato = /allegato|foto/i.test(step.label ?? "");
                      return (
                        <div
                          key={step.id}
                          className="flex items-start gap-2.5 py-1.5"
                        >
                          {/* Dot: completed=check success, current=primary ring,
                              future=border-strong. */}
                          <span
                            className={`mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 flex items-center justify-center text-[10px] font-bold ${
                              completed
                                ? "bg-success border-success text-white"
                                : isCurrent
                                ? "border-primary text-primary ring-2 ring-primary/20"
                                : "border-border-strong text-text-3"
                            }`}
                          >
                            {completed ? (
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            ) : (
                              step.stepNumber
                            )}
                          </span>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`text-[13px] ${
                                  completed
                                    ? "text-text-2"
                                    : isCurrent
                                    ? "font-semibold text-text-1"
                                    : "text-text-2"
                                }`}
                              >
                                {step.label}
                              </span>
                              {hasAllegato && (
                                <Paperclip className="h-3 w-3 text-text-3 shrink-0" />
                              )}
                            </div>
                            {completed && (step.dataCompletamento || step.utente) && (
                              <div className="text-[11px] text-text-3 mt-0.5">
                                {step.dataCompletamento}
                                {step.utente ? ` · ${step.utente}` : ""}
                              </div>
                            )}
                          </div>

                          {/* Action: current → Avvia/Completa; future → disabled. */}
                          {!completed && (
                            <Button
                              variant={isCurrent ? "default" : "ghost"}
                              size="sm"
                              className="h-7 text-xs shrink-0"
                              disabled={future || updateStep.isPending}
                              onClick={() => handleQuickAdvance(step)}
                            >
                              {step.stato === "da_fare" && isCurrent
                                ? "Avvia"
                                : "Completa"}
                              {isCurrent && <ChevronRight className="h-3 w-3 ml-0.5" />}
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
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
