import { useEffect, useRef, useState } from "react";
import { BellRing, BriefcaseBusiness, Check, Clock3, Loader2, X } from "lucide-react";
import { useLocation } from "wouter";

import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  formatReminderAt,
  nextDueReminder,
  remainingReminderLabel,
} from "@/lib/reminders";
import { trpc } from "@/lib/trpc";

const POLL_INTERVAL_MS = 15_000;

export function PromemoriaPopupHost() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const doneButtonRef = useRef<HTMLButtonElement>(null);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [customDateTime, setCustomDateTime] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const due = trpc.promemoria.due.useQuery(undefined, {
    enabled: Boolean(user),
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const items = due.data?.items ?? [];
  const current = nextDueReminder(items);

  const refresh = async () => {
    await Promise.all([
      utils.promemoria.due.invalidate(),
      utils.notifiche.feed.invalidate(),
      utils.notifiche.unreadCount.invalidate(),
      utils.notifiche.list.invalidate(),
      utils.notifiche.count.invalidate(),
    ]);
  };

  const dismiss = trpc.promemoria.dismissPopup.useMutation({
    onSuccess: refresh,
  });
  const complete = trpc.promemoria.complete.useMutation({
    onSuccess: refresh,
  });
  const snooze = trpc.promemoria.snooze.useMutation({
    onSuccess: refresh,
  });
  const busy = dismiss.isPending || complete.isPending || snooze.isPending;
  const mutationError = dismiss.error ?? complete.error ?? snooze.error;

  useEffect(() => {
    setSnoozeOpen(false);
    setCustomDateTime("");
    setLocalError(null);
    dismiss.reset();
    complete.reset();
    snooze.reset();
  }, [current?.id]);

  const run = async (operation: () => Promise<unknown>) => {
    setLocalError(null);
    try {
      await operation();
    } catch {
      // L'errore tRPC resta visibile nel dialogo: non chiudere e non perdere
      // il promemoria finché l'operatore non ha potuto riprovare.
    }
  };

  const dismissCurrent = () => {
    if (!current || busy) return;
    void run(() => dismiss.mutateAsync({ id: current.id }));
  };

  const completeCurrent = () => {
    if (!current || busy) return;
    void run(() => complete.mutateAsync({ id: current.id }));
  };

  const snoozePreset = (preset: "15m" | "1h" | "tomorrow_9") => {
    if (!current || busy) return;
    void run(() =>
      snooze.mutateAsync({ id: current.id, kind: "preset", preset })
    );
  };

  const snoozeCustom = () => {
    if (!current || busy) return;
    if (!customDateTime) {
      setLocalError("Scegli una data e un'ora.");
      return;
    }
    void run(() =>
      snooze.mutateAsync({
        id: current.id,
        kind: "custom",
        localDateTime: customDateTime,
      })
    );
  };

  const openCommessa = () => {
    if (!current?.commessaId || busy) return;
    void run(async () => {
      await dismiss.mutateAsync({ id: current.id });
      setLocation(`/commesse/${current.commessaId}`);
    });
  };

  return (
    <Dialog
      open={Boolean(current)}
      onOpenChange={(open) => {
        if (!open) dismissCurrent();
      }}
    >
      {current ? (
        <DialogContent
          showCloseButton={false}
          className="max-h-[calc(100dvh-1.5rem)] w-[calc(100%-1.5rem)] gap-0 overflow-y-auto p-0 sm:max-w-xl"
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (busy) event.preventDefault();
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            doneButtonRef.current?.focus();
          }}
        >
          <div className="flex items-start gap-3 border-b border-border px-5 py-4 sm:px-6">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
              <BellRing className="size-5" aria-hidden="true" />
            </span>
            <DialogHeader className="min-w-0 flex-1 pr-1 text-left">
              <DialogTitle className="text-base leading-6 sm:text-lg">
                Promemoria
              </DialogTitle>
              <DialogDescription className="leading-5">
                {formatReminderAt(current.remindAt)} · ora italiana
              </DialogDescription>
            </DialogHeader>
            <DialogClose asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Chiudi promemoria"
                disabled={busy}
                className="-mr-2 shrink-0"
              >
                <X aria-hidden="true" />
              </Button>
            </DialogClose>
          </div>

          <div className="space-y-5 px-5 py-5 sm:px-6">
            <p className="break-words text-base font-medium leading-7 text-foreground">
              {current.text}
            </p>

            {items.length > 1 ? (
              <p className="text-sm text-muted-foreground">
                {remainingReminderLabel(items.length)}
              </p>
            ) : null}

            {snoozeOpen ? (
              <section
                className="space-y-3 rounded-lg border border-border bg-muted/35 p-3"
                aria-label="Scegli quando posticipare"
              >
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    disabled={busy}
                    onClick={() => snoozePreset("15m")}
                  >
                    Tra 15 minuti
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    disabled={busy}
                    onClick={() => snoozePreset("1h")}
                  >
                    Tra un'ora
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    disabled={busy}
                    onClick={() => snoozePreset("tomorrow_9")}
                  >
                    Domani alle 9
                  </Button>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`promemoria-data-${current.id}`}>
                    Oppure scegli data e ora
                  </Label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      id={`promemoria-data-${current.id}`}
                      type="datetime-local"
                      value={customDateTime}
                      disabled={busy}
                      onChange={(event) => setCustomDateTime(event.target.value)}
                      className="min-h-11 min-w-0 flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11"
                      disabled={busy}
                      onClick={snoozeCustom}
                    >
                      Conferma
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Data e ora vengono interpretate nel fuso Europe/Rome.
                  </p>
                </div>
              </section>
            ) : null}

            {localError || mutationError ? (
              <div
                role="alert"
                className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
              >
                {localError ?? mutationError?.message}
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button
                ref={doneButtonRef}
                type="button"
                size="lg"
                disabled={busy}
                onClick={completeCurrent}
                className="min-h-11"
              >
                {complete.isPending ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <Check aria-hidden="true" />
                )}
                Fatto
              </Button>
              <Button
                type="button"
                size="lg"
                variant="outline"
                disabled={busy}
                aria-expanded={snoozeOpen}
                onClick={() => setSnoozeOpen((open) => !open)}
                className="min-h-11"
              >
                <Clock3 aria-hidden="true" />
                Posticipa
              </Button>
              {current.commessaId ? (
                <Button
                  type="button"
                  size="lg"
                  variant="ghost"
                  disabled={busy}
                  onClick={openCommessa}
                  className="min-h-11 sm:col-span-2"
                >
                  <BriefcaseBusiness aria-hidden="true" />
                  Apri commessa
                </Button>
              ) : null}
            </div>

            {busy ? (
              <p aria-live="polite" className="text-center text-sm text-muted-foreground">
                Aggiornamento del promemoria…
              </p>
            ) : null}
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
