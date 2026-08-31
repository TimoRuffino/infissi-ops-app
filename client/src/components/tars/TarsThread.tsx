import TarsAvatar, { type StatoTarsAvatar } from "@/components/tars/TarsAvatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import type { TurnoTarsVisualizzato } from "@/lib/tarsView";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  CircleCheck,
  Clock3,
  FileSearch,
  Loader2,
  PanelRight,
  RefreshCw,
  Undo2,
} from "lucide-react";
import { Fragment, type ReactNode } from "react";

export type StatoOperativoTars =
  | "Fatto"
  | "Preparato"
  | "Da confermare"
  | "Non eseguito"
  | "Bloccato";

export type RichiestaUndoTars = {
  procedura: "promemoria.cancel" | "commesse.undoTransizione";
  id: number;
};

export type RichiestaApprovazioneTars = {
  procedura: "proposte.approvaEApplica";
  propostaId: number;
};

type EvidenzaTarsView = { descrizione: string; riferimento: string };
type AzioneTarsView = {
  strumento: string;
  stato: string;
  descrizione: string;
  motivo: string | null;
  assunzioni: string[];
  undoDisponibile: boolean;
  undoVia: RichiestaUndoTars | null;
  conferma:
    | (RichiestaApprovazioneTars & {
        etichetta: string;
        effetto: string | null;
      })
    | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function stringhe(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function undoDaPayload(value: unknown): RichiestaUndoTars | null {
  if (!isRecord(value) || typeof value.id !== "number") return null;
  if (
    value.procedura !== "promemoria.cancel" &&
    value.procedura !== "commesse.undoTransizione"
  ) {
    return null;
  }
  return { procedura: value.procedura, id: value.id };
}

function confermaDaPayload(value: unknown): AzioneTarsView["conferma"] {
  if (
    !isRecord(value) ||
    value.via !== "proposte.approvaEApplica" ||
    typeof value.propostaId !== "number"
  ) {
    return null;
  }
  return {
    procedura: "proposte.approvaEApplica",
    propostaId: value.propostaId,
    etichetta:
      typeof value.etichetta === "string"
        ? value.etichetta
        : "Approva e applica",
    effetto: typeof value.effetto === "string" ? value.effetto : null,
  };
}

function azioniDaPayload(
  payload: Record<string, unknown> | null
): AzioneTarsView[] {
  if (!Array.isArray(payload?.azioni)) return [];
  return payload.azioni.flatMap(value => {
    if (!isRecord(value)) return [];
    return [
      {
        strumento:
          typeof value.strumento === "string" ? value.strumento : "azione",
        stato: typeof value.stato === "string" ? value.stato : "preparata",
        descrizione:
          typeof value.descrizione === "string"
            ? value.descrizione
            : "Azione operativa",
        motivo: typeof value.motivo === "string" ? value.motivo : null,
        assunzioni: stringhe(value.assunzioni),
        undoDisponibile: value.undoDisponibile === true,
        undoVia: undoDaPayload(value.undoVia),
        conferma: confermaDaPayload(value.conferma),
      },
    ];
  });
}

function evidenzeDaPayload(
  payload: Record<string, unknown> | null
): EvidenzaTarsView[] {
  if (!Array.isArray(payload?.evidenze)) return [];
  return payload.evidenze.flatMap(value => {
    if (
      !isRecord(value) ||
      typeof value.descrizione !== "string" ||
      typeof value.riferimento !== "string"
    ) {
      return [];
    }
    return [{ descrizione: value.descrizione, riferimento: value.riferimento }];
  });
}

const statiOperativi: readonly StatoOperativoTars[] = [
  "Fatto",
  "Preparato",
  "Da confermare",
  "Non eseguito",
  "Bloccato",
];

function statoDaPayload(
  payload: Record<string, unknown> | null
): StatoOperativoTars | null {
  const statoOperativo = payload?.statoOperativo;
  if (isRecord(statoOperativo) && typeof statoOperativo.stato === "string") {
    return statiOperativi.includes(statoOperativo.stato as StatoOperativoTars)
      ? (statoOperativo.stato as StatoOperativoTars)
      : null;
  }
  return payload?.degradato === true ? "Bloccato" : null;
}

const classeStato: Record<StatoOperativoTars, string> = {
  Fatto: "border-success/25 bg-success-soft text-success",
  Preparato: "border-primary/25 bg-primary-soft text-accent-text",
  "Da confermare": "border-warning/30 bg-warning-soft text-warning",
  "Non eseguito": "border-border-strong bg-surface-2 text-text-2",
  Bloccato: "border-danger/25 bg-danger-soft text-danger",
};

function dataTurno(value: Date | string): string {
  return new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function chiaveGiornoTurno(value: Date | string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function etichettaGiornoTurno(value: Date | string, ora = new Date()): string {
  const chiave = chiaveGiornoTurno(value);
  if (chiave === chiaveGiornoTurno(ora)) return "Oggi";
  const ieri = new Date(ora.getTime() - 86_400_000);
  if (chiave === chiaveGiornoTurno(ieri)) return "Ieri";
  return new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

const etichettaStatoAvatar: Record<StatoTarsAvatar, string> = {
  disponibile: "Disponibile",
  in_lavoro: "In lavorazione",
  degradato: "Operatività ridotta",
  spento: "Disattivato",
};

function EvidenzeTurno({
  evidenze,
  omissioni,
}: {
  evidenze: readonly EvidenzaTarsView[];
  omissioni: readonly string[];
}) {
  if (evidenze.length === 0 && omissioni.length === 0) return null;
  return (
    <Collapsible className="mt-2 border-t border-border-soft pt-1.5">
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="group min-h-11 px-2 text-xs"
        >
          <FileSearch aria-hidden="true" />
          Evidenze e limiti ({evidenze.length + omissioni.length})
          <ChevronDown
            aria-hidden="true"
            className="ml-auto transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 px-2 pb-2 pt-1 text-xs">
        {evidenze.map((evidenza, index) => (
          <div
            key={`${evidenza.riferimento}-${index}`}
            className="min-w-0 border-l-2 border-border-strong pl-2"
          >
            <p className="break-words text-text-2">{evidenza.descrizione}</p>
            <p className="break-all font-mono text-[11px] text-text-3">
              {evidenza.riferimento}
            </p>
          </div>
        ))}
        {omissioni.map((omissione, index) => (
          <p
            key={index}
            className="flex items-start gap-2 break-words text-warning"
          >
            <AlertTriangle
              className="mt-0.5 size-3.5 shrink-0"
              aria-hidden="true"
            />
            <span>Non incluso: {omissione}</span>
          </p>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

function AzioniTurno({
  azioni,
  annullati,
  applicate,
  undoInCorso,
  approvazioneInCorso,
  onUndo,
  onApprova,
}: {
  azioni: readonly AzioneTarsView[];
  annullati: readonly number[];
  applicate: readonly number[];
  undoInCorso: boolean;
  approvazioneInCorso: boolean;
  onUndo?: (richiesta: RichiestaUndoTars) => void;
  onApprova?: (richiesta: RichiestaApprovazioneTars) => void;
}) {
  if (azioni.length === 0) return null;
  return (
    <div className="mt-2 space-y-2">
      {azioni.map((azione, index) => {
        const nonEseguita =
          azione.stato === "non_eseguito" || azione.stato === "non_necessaria";
        const annullata =
          azione.undoVia != null && annullati.includes(azione.undoVia.id);
        const applicata =
          azione.conferma != null &&
          applicate.includes(azione.conferma.propostaId);
        return (
          <div
            key={`${azione.strumento}-${index}`}
            className="rounded-md bg-surface-2 px-3 py-2"
          >
            <div className="flex min-w-0 items-start gap-2">
              {nonEseguita ? (
                <AlertTriangle
                  className="mt-0.5 size-4 shrink-0 text-warning"
                  aria-hidden="true"
                />
              ) : azione.conferma ? (
                <Clock3
                  className="mt-0.5 size-4 shrink-0 text-warning"
                  aria-hidden="true"
                />
              ) : (
                <CircleCheck
                  className="mt-0.5 size-4 shrink-0 text-success"
                  aria-hidden="true"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="break-words text-xs font-medium text-text-1">
                  {azione.descrizione}
                </p>
                <p className="mt-0.5 text-[11px] text-text-3">
                  Stato: {azione.stato.replaceAll("_", " ")}
                </p>
                {azione.assunzioni.map((assunzione, assumptionIndex) => (
                  <p
                    key={assumptionIndex}
                    className="mt-1 break-words text-[11px] text-text-3"
                  >
                    Assunzione: {assunzione}
                  </p>
                ))}
                {azione.motivo && (
                  <p className="mt-1 break-words text-[11px] text-warning">
                    {azione.motivo}
                  </p>
                )}
                {azione.conferma?.effetto && (
                  <p className="mt-1 break-words text-[11px] text-text-2">
                    {azione.conferma.effetto}
                  </p>
                )}
              </div>
            </div>
            {(azione.conferma ||
              (azione.undoDisponibile && azione.undoVia)) && (
              <div className="mt-2 flex flex-wrap gap-2">
                {azione.conferma && onApprova && (
                  <Button
                    type="button"
                    size="sm"
                    className="min-h-11"
                    disabled={approvazioneInCorso || applicata}
                    onClick={() => onApprova(azione.conferma!)}
                  >
                    {applicata ? (
                      <Check aria-hidden="true" />
                    ) : (
                      <Clock3 aria-hidden="true" />
                    )}
                    {applicata ? "Applicata" : azione.conferma.etichetta}
                  </Button>
                )}
                {azione.undoDisponibile && azione.undoVia && onUndo && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="min-h-11"
                    disabled={undoInCorso || annullata}
                    onClick={() => onUndo(azione.undoVia!)}
                  >
                    <Undo2 aria-hidden="true" />
                    {annullata ? "Annullata" : "Annulla"}
                  </Button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export type TarsThreadProps = {
  titolo?: string;
  turni: readonly TurnoTarsVisualizzato[];
  statoAvatar: StatoTarsAvatar;
  archiviata?: boolean;
  loading?: boolean;
  error?: string | null;
  inLavoro?: boolean;
  mobile?: boolean;
  emptyState?: ReactNode;
  annullati?: readonly number[];
  applicate?: readonly number[];
  undoInCorso?: boolean;
  approvazioneInCorso?: boolean;
  onBack?: () => void;
  onOpenContext?: () => void;
  onRetry?: () => void;
  onUndo?: (richiesta: RichiestaUndoTars) => void;
  onApprova?: (richiesta: RichiestaApprovazioneTars) => void;
};

export default function TarsThread({
  titolo = "Tars",
  turni,
  statoAvatar,
  archiviata = false,
  loading = false,
  error = null,
  inLavoro = false,
  mobile = false,
  emptyState,
  annullati = [],
  applicate = [],
  undoInCorso = false,
  approvazioneInCorso = false,
  onBack,
  onOpenContext,
  onRetry,
  onUndo,
  onApprova,
}: TarsThreadProps) {
  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-card"
      aria-label="Conversazione con Tars"
    >
      <header className="flex min-h-16 shrink-0 items-center gap-2 border-b border-border-soft px-3 py-2 sm:px-4">
        {mobile && onBack && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-11"
            onClick={onBack}
            aria-label="Torna alle conversazioni"
            title="Conversazioni"
          >
            <ArrowLeft className="size-5" />
          </Button>
        )}
        <TarsAvatar stato={statoAvatar} size={40} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-bold text-text-1">{titolo}</h1>
          <p className="truncate text-xs text-text-3">
            {archiviata
              ? "Archiviata · sola lettura"
              : etichettaStatoAvatar[statoAvatar]}
          </p>
        </div>
        {onOpenContext && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-11 shrink-0 lg:hidden"
            onClick={onOpenContext}
            aria-label="Apri contesto operativo"
            title="Contesto operativo"
          >
            <PanelRight className="size-5" />
          </Button>
        )}
      </header>

      {loading ? (
        <div
          aria-label="Caricamento conversazione"
          className="min-h-0 flex-1 space-y-4 overflow-hidden p-4"
        >
          <Skeleton className="ml-auto h-20 w-3/4 max-w-xl motion-reduce:animate-none" />
          <Skeleton className="h-28 w-4/5 max-w-2xl motion-reduce:animate-none" />
          <Skeleton className="ml-auto h-16 w-2/3 max-w-lg motion-reduce:animate-none" />
        </div>
      ) : error ? (
        <div className="grid min-h-0 flex-1 place-items-center px-5 text-center">
          <div>
            <AlertCircle
              className="mx-auto size-6 text-danger"
              aria-hidden="true"
            />
            <p className="mt-3 text-sm font-semibold">
              Conversazione non disponibile
            </p>
            <p className="mt-1 text-xs leading-5 text-text-3">{error}</p>
            {onRetry && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-4 min-h-11"
                onClick={onRetry}
              >
                <RefreshCw aria-hidden="true" />
                Riprova
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          aria-label="Cronologia conversazione"
          className="min-h-0 min-w-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4"
        >
          {turni.length === 0 ? (
            <div className="mx-auto grid min-h-full max-w-xl place-items-center py-8 text-center">
              {emptyState ?? (
                <div>
                  <TarsAvatar
                    stato={statoAvatar}
                    size={48}
                    className="mx-auto"
                  />
                  <p className="mt-4 text-sm font-semibold">
                    Pronto per il prossimo lavoro
                  </p>
                  <p className="mt-1 text-sm leading-6 text-text-3">
                    Chiedi una verifica operativa o parti dal briefing di oggi.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {turni.map((turno, index) => {
                const payload = turno.payload;
                const utente = turno.ruolo === "utente";
                const ottimistico = "ottimistico" in turno;
                const stato = !utente ? statoDaPayload(payload) : null;
                const azioni = !utente ? azioniDaPayload(payload) : [];
                const evidenze = !utente ? evidenzeDaPayload(payload) : [];
                const omissioni = !utente ? stringhe(payload?.omissioni) : [];
                const mostraSeparatore =
                  index === 0 ||
                  chiaveGiornoTurno(turni[index - 1].createdAt) !==
                    chiaveGiornoTurno(turno.createdAt);
                return (
                  <Fragment key={turno.id}>
                    {mostraSeparatore && (
                      <div
                        role="separator"
                        className="flex items-center gap-3 py-1"
                        aria-label={etichettaGiornoTurno(turno.createdAt)}
                      >
                        <span className="h-px flex-1 bg-border-soft" />
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-text-3">
                          {etichettaGiornoTurno(turno.createdAt)}
                        </span>
                        <span className="h-px flex-1 bg-border-soft" />
                      </div>
                    )}
                    <article
                      className={cn(
                        "flex min-w-0",
                        utente ? "justify-end" : "justify-start"
                      )}
                    >
                      <div
                        className={cn(
                          "min-w-0 max-w-[88%] rounded-md border px-3 py-2.5 text-sm shadow-xs sm:max-w-[76%]",
                          utente
                            ? "border-primary/20 bg-primary-soft"
                            : "border-border-soft bg-surface"
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] font-semibold text-text-3">
                            {utente ? "Tu" : "Tars"}
                          </span>
                          {stato && (
                            <Badge
                              variant="outline"
                              className={cn("text-[10px]", classeStato[stato])}
                            >
                              {stato}
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 whitespace-pre-wrap break-words leading-6 text-text-1">
                          {turno.contenuto}
                        </p>
                        {!utente && (
                          <>
                            <AzioniTurno
                              azioni={azioni}
                              annullati={annullati}
                              applicate={applicate}
                              undoInCorso={undoInCorso}
                              approvazioneInCorso={approvazioneInCorso}
                              onUndo={onUndo}
                              onApprova={onApprova}
                            />
                            <EvidenzeTurno
                              evidenze={evidenze}
                              omissioni={omissioni}
                            />
                          </>
                        )}
                        <time className="mt-1.5 block text-right text-[10px] tabular-nums text-text-3">
                          {dataTurno(turno.createdAt)}
                          {ottimistico ? " · Invio…" : ""}
                        </time>
                      </div>
                    </article>
                  </Fragment>
                );
              })}
              {inLavoro && (
                <div
                  className="flex min-h-11 items-center gap-2 text-sm text-text-3"
                  role="status"
                >
                  <Loader2
                    className="size-4 motion-safe:animate-spin"
                    aria-hidden="true"
                  />
                  Tars sta lavorando…
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
