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
  ChevronDown,
  Paperclip,
  Sparkles,
  StickyNote,
  CalendarDays,
} from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import SearchSelect from "@/components/SearchSelect";
import ConfirmDialog from "@/components/ConfirmDialog";
import { titoloGateBloccato } from "@/lib/limitiView";

// The 17 PRD steps grouped under the 4 board phases (redesign §4.3).
// Ranges are by stepNumber (1-based, inclusive). Gli estremi sono scalati di
// uno dopo la rimozione di «Invio Fattura al Cliente», che stava in Vendita.
const FASI = [
  { id: "vendita", label: "Vendita", dot: "bg-st-preventivo", from: 1, to: 4 },
  { id: "ordine", label: "Ordine & Produzione", dot: "bg-st-ordine", from: 5, to: 9 },
  { id: "consegna", label: "Consegna & Posa", dot: "bg-st-produzione", from: 10, to: 14 },
  { id: "chiusura", label: "Chiusura", dot: "bg-st-pagamento", from: 15, to: 17 },
] as const;

function faseOf(stepNumber: number) {
  return FASI.find((f) => stepNumber >= f.from && stepNumber <= f.to) ?? FASI[3];
}

export default function TimelineOrdine({ commessaId }: { commessaId: number }) {
  const steps = trpc.timeline.byCommessa.useQuery(commessaId);
  const stats = trpc.timeline.stats.useQuery(commessaId);
  const utenti = trpc.utenti.list.useQuery(undefined);
  const utils = trpc.useUtils();
  const [forceStepTarget, setForceStepTarget] = useState<{
    variables: {
      id: number;
      stato?: "da_fare" | "in_corso" | "completato";
      dataCompletamento?: string | null;
      utente?: string | null;
      note?: string | null;
      allegato?: string | null;
    };
    message: string;
  } | null>(null);

  const updateStep = trpc.timeline.updateStep.useMutation({
    onSuccess: () => {
      utils.timeline.invalidate();
      utils.commesse.invalidate();
      setForceStepTarget(null);
    },
    onError: (error, variables) => {
      const prefix = "DOC_GATE_BLOCKED:";
      if (error.message.startsWith(prefix) && variables.stato === "completato") {
        setForceStepTarget({
          variables,
          message: error.message.slice(prefix.length).trim(),
        });
      }
    },
  });

  const [editOpen, setEditOpen] = useState(false);
  const [editStep, setEditStep] = useState<any>(null);
  const [editForm, setEditForm] = useState({ utente: "", note: "", data: "" });
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
        const fullName = [u.cognome, u.nome].filter(Boolean).join(" ") || u.email;
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
      data: step.dataCompletamento ?? "",
    });
    setEditOpen(true);
  }

  // Save from the dialog. When the step isn't completed yet, saving also marks
  // it done (stamping today's date). For an already-completed step we keep the
  // stato + completion date and only update utente/note (edit after complete).
  // null is sent so cleared fields actually persist as empty.
  function saveStep() {
    if (!editStep) return;
    const completing = editStep.stato !== "completato";
    updateStep.mutate({
      id: editStep.id,
      ...(completing ? { stato: "completato" as const } : {}),
      dataCompletamento:
        editForm.data || new Date().toISOString().split("T")[0],
      utente: editForm.utente || null,
      note: editForm.note || null,
    });
    setEditOpen(false);
  }

  // Save date/utente/note WITHOUT completing — used to schedule future
  // steps (e.g. the posa appointment date) before the work happens.
  function saveWithoutComplete() {
    if (!editStep) return;
    updateStep.mutate({
      id: editStep.id,
      dataCompletamento: editForm.data || null,
      utente: editForm.utente || null,
      note: editForm.note || null,
    });
    setEditOpen(false);
  }

  // One click = task done. No "Avvia" intermediate step.
  function quickComplete(step: any) {
    updateStep.mutate({
      id: step.id,
      stato: "completato",
      dataCompletamento: new Date().toISOString().split("T")[0],
    });
  }

  // Reopen a completed step → back to da_fare (clears completion metadata).
  function reopenStep(step: any) {
    updateStep.mutate({
      id: step.id,
      stato: "da_fare",
      dataCompletamento: null,
    });
    setEditOpen(false);
  }

  const pct = stats.data?.percentuale ?? 0;
  const done = stats.data?.completati ?? 0;
  const total = stats.data?.totale ?? steps.data?.length ?? 18;

  // Auto-open the phase that contains the current step (others collapsed).
  const currentFaseId = currentStep ? faseOf(currentStep.stepNumber).id : null;
  useEffect(() => {
    if (currentFaseId) setOpenFasi((m) => ({ ...m, [currentFaseId]: true }));
  }, [currentFaseId]);

  // Phases holding notes start open — the notes ARE the operational memory
  // (migrated To Do items live there), hiding them behind a fold buries them.
  const notedFasi = useMemo(
    () =>
      FASI.filter((f) =>
        (steps.data ?? []).some(
          (s: any) => s.note && s.stepNumber >= f.from && s.stepNumber <= f.to
        )
      )
        .map((f) => f.id)
        .join(","),
    [steps.data]
  );
  useEffect(() => {
    if (!notedFasi) return;
    setOpenFasi((m) => {
      const next = { ...m };
      for (const id of notedFasi.split(",")) next[id] = next[id] ?? true;
      return next;
    });
  }, [notedFasi]);

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
                  {(() => {
                    const fNotes = fSteps.filter((x: any) => x.note).length;
                    return fNotes > 0 ? (
                      <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-warning bg-warning-soft rounded px-1.5 py-px shrink-0">
                        <StickyNote className="h-3 w-3" />
                        {fNotes}
                      </span>
                    ) : null;
                  })()}
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
                      const hasAllegato = /allegato|foto/i.test(step.label ?? "");
                      return (
                        <div
                          key={step.id}
                          className={`flex items-start gap-2.5 py-1.5 ${
                            isCurrent ? "bg-primary/5 rounded-md -mx-1.5 px-1.5" : ""
                          }`}
                        >
                          {/* Dot: completed=check success, current=primary ring,
                              future=border-strong. */}
                          <span
                            className={`mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 flex items-center justify-center text-[10px] font-bold ${
                              completed
                                ? "bg-success border-success text-on-success"
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

                          {/* Click anywhere on the text → edit dialog (works
                              for completed steps too: add/change note + chi). */}
                          <button
                            type="button"
                            onClick={() => openEdit(step)}
                            className="flex-1 min-w-0 text-left rounded hover:bg-surface-2 -mx-1 px-1 py-0.5 transition-colors"
                          >
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
                            {!completed && step.dataCompletamento && (
                              <div className="flex items-center gap-1 text-[11px] font-semibold text-primary mt-0.5">
                                <CalendarDays className="h-3 w-3 shrink-0" />
                                {new Date(step.dataCompletamento + "T12:00:00").toLocaleDateString("it-IT")}
                                {step.utente ? ` · ${step.utente}` : ""}
                              </div>
                            )}
                            {completed && (step.dataCompletamento || step.utente) && (
                              <div className="text-[11px] text-text-3 mt-0.5">
                                {step.dataCompletamento
                                  ? new Date(step.dataCompletamento + "T12:00:00").toLocaleDateString("it-IT")
                                  : ""}
                                {step.utente ? `${step.dataCompletamento ? " · " : ""}${step.utente}` : ""}
                              </div>
                            )}
                            {/* Note — post-it block, multiline preserved
                                (migrated To Do notes carry line breaks). */}
                            {step.note && (
                              <div className="mt-1 flex gap-1.5 rounded-md border border-warning/30 bg-warning-soft px-2 py-1.5">
                                <StickyNote className="h-3.5 w-3.5 shrink-0 text-warning mt-px" />
                                <span className="min-w-0 text-xs leading-snug text-text-1 whitespace-pre-line break-words">
                                  {step.note}
                                </span>
                              </div>
                            )}
                          </button>

                          {/* One-click complete on the current step. Future
                              steps have no action. */}
                          {isCurrent && !completed && (
                            <Button
                              size="sm"
                              className="h-7 text-xs shrink-0"
                              disabled={updateStep.isPending}
                              onClick={() => quickComplete(step)}
                            >
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Completa
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
              {editStep?.stato === "completato" ? "Modifica step" : "Completa step"}
              {editStep?.label ? ` · ${editStep.label}` : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label>Data (appuntamento o completamento)</Label>
              <input
                type="date"
                value={editForm.data}
                onChange={(e) =>
                  setEditForm({ ...editForm, data: e.target.value })
                }
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
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
                rows={5}
                value={editForm.note}
                onChange={(e) =>
                  setEditForm({ ...editForm, note: e.target.value })
                }
              />
            </div>
            <div className="flex gap-2">
              {editStep?.stato !== "completato" && (
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={saveWithoutComplete}
                  disabled={updateStep.isPending}
                >
                  Salva data
                </Button>
              )}
              {editStep?.stato === "completato" && (
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => reopenStep(editStep)}
                  disabled={updateStep.isPending}
                >
                  Riapri
                </Button>
              )}
              <Button
                className="flex-1"
                onClick={saveStep}
                disabled={updateStep.isPending}
              >
                {editStep?.stato === "completato" ? "Salva note" : "Segna come completato"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!forceStepTarget}
        onOpenChange={(open) => !open && setForceStepTarget(null)}
        title={titoloGateBloccato(forceStepTarget?.message)}
        description={forceStepTarget?.message ?? ""}
        destructive={false}
        confirmLabel="Procedi comunque"
        onConfirm={() => {
          if (!forceStepTarget) return;
          updateStep.mutate({ ...forceStepTarget.variables, force: true });
        }}
      />
    </Card>
  );
}
