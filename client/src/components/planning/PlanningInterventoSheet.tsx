import type { ReactNode } from "react";
import {
  Calendar as CalIcon,
  Clock,
  Link2,
  Lock,
  MapPin,
  Trash2,
} from "lucide-react";

import SearchSelect, {
  type SearchSelectOption,
} from "@/components/SearchSelect";
import StatePanel from "@/components/patterns/StatePanel";
import { Button } from "@/components/ui/button";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

export type PlanningLinkKind =
  | "commessa"
  | "ticket"
  | "reclamo"
  | "rifacimento";

export type PlanningInterventoDraft = {
  linkKind: PlanningLinkKind;
  linkId: string;
  squadraId: string;
  tipo: "rilievo" | "posa" | "assistenza" | "altro";
  dataPianificata: string;
  oraInizio: string;
  oraFine: string;
  indirizzo: string;
  note: string;
};

export type PlanningSquadraOption = {
  id: number;
  nome: string;
  caposquadra?: string | null;
};

/** Evento Google normalizzato dal contenitore. */
export type PlanningExternalEvent = {
  id: string;
  titolo: string;
  dataPianificata: string;
  oraInizio: string | null;
  oraFine: string | null;
  allDay: boolean;
  location: string | null;
  sourceNome: string;
  color: string;
};

type SheetBase = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export type PlanningInterventoSheetProps = SheetBase &
  (
    | {
        /** Evento di un calendario esterno: nessuna scrittura, mai. */
        mode: "read-external";
        event: PlanningExternalEvent | null;
      }
    | {
        mode: "create" | "edit";
        draft: PlanningInterventoDraft;
        onDraftChange: (draft: PlanningInterventoDraft) => void;
        onLinkKindChange: (kind: PlanningLinkKind) => void;
        onLinkIdChange: (linkId: string) => void;
        linkOptions: SearchSelectOption[];
        squadre: ReadonlyArray<PlanningSquadraOption>;
        /** Riepilogo commessa/cliente già composto dal contenitore. */
        contesto?: ReactNode;
        canPlan: boolean;
        canAssign: boolean;
        canDelete: boolean;
        isPending: boolean;
        onSubmit: () => void;
        onDelete?: () => void;
      }
  );

const LINK_LABEL: Record<PlanningLinkKind, string> = {
  commessa: "Commessa *",
  ticket: "Ticket",
  reclamo: "Reclamo",
  rifacimento: "Rifacimento",
};

function dataEstesa(data: string): string {
  return new Date(`${data}T12:00:00`).toLocaleDateString("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Pannello unico dell'appuntamento. In `read-external` mostra solo la lettura
 * dell'evento Google: nessun submit, nessuna cancellazione, nessun selettore
 * squadra, nessun campo editabile.
 */
export default function PlanningInterventoSheet(
  props: PlanningInterventoSheetProps
) {
  if (props.mode === "read-external") {
    const evento = props.event;
    return (
      <Sheet open={props.open} onOpenChange={props.onOpenChange}>
        <SheetContent side="right" className="gap-0 p-0">
          <SheetHeader className="border-b border-border-soft">
            <SheetTitle className="flex min-w-0 items-start gap-2 pr-10">
              <span
                aria-hidden="true"
                className="mt-1.5 size-3 shrink-0 rounded-full"
                style={{ backgroundColor: evento?.color }}
              />
              <span className="min-w-0 break-words">{evento?.titolo}</span>
            </SheetTitle>
            <SheetDescription>
              Evento di un calendario esterno, in sola lettura.
            </SheetDescription>
          </SheetHeader>

          {evento ? (
            <div className="min-w-0 flex-1 space-y-3 overflow-y-auto p-4 text-sm">
              <p className="flex min-w-0 items-center gap-2">
                <CalIcon className="h-4 w-4 shrink-0 text-text-3" />
                <span className="capitalize">
                  {dataEstesa(evento.dataPianificata)}
                </span>
              </p>
              <p className="flex min-w-0 items-center gap-2">
                <Clock className="h-4 w-4 shrink-0 text-text-3" />
                <span className="font-mono">
                  {evento.allDay
                    ? "Tutto il giorno"
                    : `${evento.oraInizio ?? ""}${
                        evento.oraFine ? ` – ${evento.oraFine}` : ""
                      }`}
                </span>
              </p>
              {evento.location ? (
                <p className="flex min-w-0 items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-text-3" />
                  <span className="min-w-0 break-words">{evento.location}</span>
                </p>
              ) : null}
              <p className="flex min-w-0 items-center gap-2 text-text-2">
                <span
                  aria-hidden="true"
                  className="ml-0.5 size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: evento.color }}
                />
                {evento.sourceNome}
              </p>
              <p className="flex min-w-0 items-center gap-1.5 rounded-[var(--radius-control)] border border-border-soft bg-surface-2 px-2.5 py-2 text-xs text-text-2">
                <Lock className="h-3.5 w-3.5 shrink-0" />
                Evento di Google Calendar — si modifica da Google, qui è in sola
                lettura.
              </p>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    );
  }

  const {
    mode,
    draft,
    onDraftChange,
    onLinkKindChange,
    onLinkIdChange,
    linkOptions,
    squadre,
    contesto,
    canPlan,
    canAssign,
    canDelete,
    isPending,
    onSubmit,
    onDelete,
  } = props;

  const submitEnabled = canPlan && !isPending;
  const squadraReadOnly = !canAssign;
  const campiBloccati = !canPlan;

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent side="right" className="gap-0 p-0">
        <SheetHeader className="border-b border-border-soft">
          <SheetTitle className="pr-10">
            {mode === "edit" ? "Dettagli appuntamento" : "Nuovo appuntamento"}
          </SheetTitle>
          <SheetDescription>
            {mode === "edit"
              ? "Aggiorna collegamento, data, ora e note dell'appuntamento."
              : "Collega l'appuntamento a una commessa e definisci data e ora."}
          </SheetDescription>
        </SheetHeader>

        <div className="min-w-0 flex-1 space-y-4 overflow-y-auto p-4">
          {campiBloccati ? (
            <StatePanel
              kind="permission"
              compact
              title="Appuntamento in sola lettura"
              description="Il tuo profilo non può creare o modificare appuntamenti: serve la capability intervento.plan."
            />
          ) : null}

          {contesto}

          <div className="space-y-1.5">
            <Label
              htmlFor="planning-link-kind"
              className="flex items-center gap-1.5"
            >
              <Link2 className="h-3.5 w-3.5" /> Collega a
            </Label>
            <Select
              value={draft.linkKind}
              onValueChange={(value: PlanningLinkKind) =>
                onLinkKindChange(value)
              }
              disabled={campiBloccati}
            >
              <SelectTrigger id="planning-link-kind" className="min-h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="commessa">Commessa</SelectItem>
                <SelectItem value="ticket">Ticket</SelectItem>
                <SelectItem value="reclamo">Reclamo</SelectItem>
                <SelectItem value="rifacimento">Rifacimento</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>{LINK_LABEL[draft.linkKind]}</Label>
            <SearchSelect
              options={linkOptions}
              value={draft.linkId}
              onChange={onLinkIdChange}
              disabled={campiBloccati}
              className="min-h-11"
              placeholder="Seleziona..."
              searchPlaceholder="Cerca per codice, cliente..."
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="planning-tipo">Tipo</Label>
            <Select
              value={draft.tipo}
              onValueChange={(value: PlanningInterventoDraft["tipo"]) =>
                onDraftChange({ ...draft, tipo: value })
              }
              disabled={campiBloccati}
            >
              <SelectTrigger id="planning-tipo" className="min-h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="rilievo">Rilievo</SelectItem>
                <SelectItem value="posa">Posa</SelectItem>
                <SelectItem value="assistenza">Assistenza</SelectItem>
                <SelectItem value="altro">Altro</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Alternativa da tastiera al drag del calendario desktop. */}
          <fieldset
            disabled={campiBloccati}
            className="min-w-0 space-y-3 rounded-[var(--radius-control)] border border-border-soft p-3"
          >
            <legend className="px-1 text-xs font-bold uppercase tracking-[0.12em] text-text-3">
              {mode === "edit" ? "Modifica data e ora" : "Data e ora"}
            </legend>
            <div className="space-y-1.5">
              <Label htmlFor="planning-data">Data *</Label>
              <Input
                id="planning-data"
                type="date"
                className="min-h-11"
                value={draft.dataPianificata}
                onChange={event =>
                  onDraftChange({
                    ...draft,
                    dataPianificata: event.target.value,
                  })
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="planning-ora-inizio">Ora inizio</Label>
                <Input
                  id="planning-ora-inizio"
                  type="time"
                  className="min-h-11"
                  value={draft.oraInizio}
                  onChange={event =>
                    onDraftChange({ ...draft, oraInizio: event.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="planning-ora-fine">Ora fine</Label>
                <Input
                  id="planning-ora-fine"
                  type="time"
                  className="min-h-11"
                  value={draft.oraFine}
                  onChange={event =>
                    onDraftChange({ ...draft, oraFine: event.target.value })
                  }
                />
              </div>
            </div>
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="planning-squadra">Squadra</Label>
            <Select
              value={draft.squadraId || "nessuna"}
              onValueChange={squadraId =>
                onDraftChange({
                  ...draft,
                  squadraId: squadraId === "nessuna" ? "" : squadraId,
                })
              }
              disabled={squadraReadOnly || campiBloccati}
            >
              <SelectTrigger
                id="planning-squadra"
                aria-label="Squadra assegnata"
                className="min-h-11"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="nessuna">Nessuna squadra</SelectItem>
                {squadre.map(squadra => (
                  <SelectItem key={squadra.id} value={String(squadra.id)}>
                    {squadra.nome}
                    {squadra.caposquadra ? ` — ${squadra.caposquadra}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {squadraReadOnly ? (
              <p className="text-xs text-text-3">
                {draft.squadraId ? "Non puoi cambiare squadra. " : ""}
                L'assegnazione squadra richiede il permesso di assegnazione.
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="planning-indirizzo">Indirizzo</Label>
            <Input
              id="planning-indirizzo"
              className="min-h-11"
              disabled={campiBloccati}
              value={draft.indirizzo}
              onChange={event =>
                onDraftChange({ ...draft, indirizzo: event.target.value })
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="planning-note">Note</Label>
            <Textarea
              id="planning-note"
              rows={2}
              disabled={campiBloccati}
              value={draft.note}
              onChange={event =>
                onDraftChange({ ...draft, note: event.target.value })
              }
            />
          </div>
        </div>

        {canPlan || (mode === "edit" && canDelete && onDelete) ? (
          <div className="flex min-w-0 flex-col gap-2 border-t border-border-soft p-4">
            {canPlan ? (
              <Button
                type="button"
                className="min-h-12 w-full"
                onClick={onSubmit}
                disabled={!submitEnabled}
              >
                {mode === "edit" ? "Salva modifiche" : "Pianifica"}
              </Button>
            ) : null}
            {mode === "edit" && canDelete && onDelete ? (
              <Button
                type="button"
                variant="dangerGhost"
                className="min-h-11 w-full"
                onClick={onDelete}
              >
                <Trash2 className="h-4 w-4" />
                Elimina appuntamento
              </Button>
            ) : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
