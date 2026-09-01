import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  etichettaTempoConversazione,
  filtraConversazioni,
  raggruppaConversazioni,
  type ConversazioneTarsView,
} from "@/lib/tarsView";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  Inbox,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";

export type TarsConversationListProps = {
  conversazioni: readonly ConversazioneTarsView[];
  conversazioneAttivaId: number | null;
  ricerca: string;
  loading?: boolean;
  error?: string | null;
  conversazioneInCorsoId?: number | null;
  onRicercaChange: (value: string) => void;
  onNuovaConversazione: () => void;
  onApriConversazione: (conversazione: ConversazioneTarsView) => void;
  onRinomina: (conversazione: ConversazioneTarsView) => void;
  onFissa: (conversazione: ConversazioneTarsView, fissata: boolean) => void;
  onArchivia: (conversazione: ConversazioneTarsView) => void;
  onRipristina: (conversazione: ConversazioneTarsView) => void;
  onElimina: (conversazione: ConversazioneTarsView) => void;
  onRetry?: () => void;
};

function RigaConversazione({
  conversazione,
  attiva,
  inCorso,
  onApri,
  onRinomina,
  onFissa,
  onArchivia,
  onRipristina,
  onElimina,
}: {
  conversazione: ConversazioneTarsView;
  attiva: boolean;
  inCorso: boolean;
  onApri: () => void;
  onRinomina: () => void;
  onFissa: (fissata: boolean) => void;
  onArchivia: () => void;
  onRipristina: () => void;
  onElimina: () => void;
}) {
  const archiviata = conversazione.archiviataAt != null;
  return (
    <li
      className={cn(
        "group flex min-h-16 min-w-0 items-stretch border-b border-border-soft",
        attiva ? "bg-accent/70" : "bg-card hover:bg-muted/65"
      )}
    >
      <button
        type="button"
        onClick={onApri}
        aria-current={attiva ? "page" : undefined}
        className="min-w-0 flex-1 px-3 py-2.5 text-left outline-none transition-colors focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-1">
            {conversazione.titolo}
          </span>
          <time className="shrink-0 text-[11px] tabular-nums text-text-3">
            {etichettaTempoConversazione(conversazione.updatedAt)}
          </time>
        </span>
        <span className="mt-1 block truncate text-xs leading-5 text-text-3">
          {conversazione.anteprima ?? "Nessun messaggio"}
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="my-auto mr-1 size-11 shrink-0"
            disabled={inCorso}
            aria-label={`Azioni per ${conversazione.titolo}`}
            title="Azioni conversazione"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {archiviata ? (
            <DropdownMenuItem className="min-h-11" onSelect={onRipristina}>
              <ArchiveRestore aria-hidden="true" />
              Ripristina
            </DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem className="min-h-11" onSelect={onRinomina}>
                <Pencil aria-hidden="true" />
                Rinomina
              </DropdownMenuItem>
              <DropdownMenuItem
                className="min-h-11"
                onSelect={() => onFissa(!conversazione.fissata)}
              >
                {conversazione.fissata ? (
                  <PinOff aria-hidden="true" />
                ) : (
                  <Pin aria-hidden="true" />
                )}
                {conversazione.fissata ? "Rimuovi dai fissati" : "Fissa"}
              </DropdownMenuItem>
              <DropdownMenuItem className="min-h-11" onSelect={onArchivia}>
                <Archive aria-hidden="true" />
                Archivia
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="min-h-11 text-danger focus:text-danger"
            onSelect={onElimina}
          >
            <Trash2 aria-hidden="true" />
            Elimina
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

export default function TarsConversationList({
  conversazioni,
  conversazioneAttivaId,
  ricerca,
  loading = false,
  error = null,
  conversazioneInCorsoId = null,
  onRicercaChange,
  onNuovaConversazione,
  onApriConversazione,
  onRinomina,
  onFissa,
  onArchivia,
  onRipristina,
  onElimina,
  onRetry,
}: TarsConversationListProps) {
  const filtrate = filtraConversazioni(conversazioni, ricerca);
  const gruppi = raggruppaConversazioni(filtrate);
  const sezioni = [
    { titolo: "Fissate", elementi: gruppi.fissate },
    { titolo: "Recenti", elementi: gruppi.recenti },
    { titolo: "Archiviate", elementi: gruppi.archiviate },
  ];

  return (
    <nav
      aria-label="Conversazioni Tars"
      className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-card"
    >
      <div className="shrink-0 space-y-2 border-b border-border-soft p-3">
        <Button
          type="button"
          className="min-h-11 w-full"
          onClick={onNuovaConversazione}
        >
          <Plus aria-hidden="true" />
          Nuova conversazione
        </Button>
        <label className="relative block">
          <span className="sr-only">Cerca conversazioni Tars</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-3"
          />
          <Input
            type="search"
            value={ricerca}
            onChange={event => onRicercaChange(event.target.value)}
            placeholder="Cerca titolo o anteprima"
            className="h-11 pl-9"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div aria-label="Caricamento conversazioni" className="space-y-px">
            {Array.from({ length: 6 }, (_, index) => (
              <div
                key={index}
                className="min-h-16 space-y-2 border-b border-border-soft px-3 py-3"
              >
                <div className="flex justify-between gap-3">
                  <Skeleton className="h-4 w-3/5 motion-reduce:animate-none" />
                  <Skeleton className="h-3 w-10 motion-reduce:animate-none" />
                </div>
                <Skeleton className="h-3 w-4/5 motion-reduce:animate-none" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="grid min-h-64 place-items-center px-5 py-10 text-center">
            <div>
              <AlertCircle
                className="mx-auto size-6 text-danger"
                aria-hidden="true"
              />
              <p className="mt-3 text-sm font-semibold">
                Conversazioni non disponibili
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
        ) : filtrate.length === 0 ? (
          <div className="grid min-h-64 place-items-center px-5 py-10 text-center">
            <div>
              <span className="mx-auto grid size-11 place-items-center rounded-md bg-surface-2 text-text-3">
                <Inbox className="size-5" aria-hidden="true" />
              </span>
              <p className="mt-3 text-sm font-semibold">
                {ricerca.trim()
                  ? "Nessun risultato"
                  : "Ancora nessuna conversazione"}
              </p>
              <p className="mt-1 max-w-xs text-xs leading-5 text-text-3">
                {ricerca.trim()
                  ? "Prova con un titolo o una parola dell'ultimo messaggio."
                  : "Avvia una nuova conversazione per lavorare con Tars."}
              </p>
            </div>
          </div>
        ) : (
          sezioni.map(sezione =>
            sezione.elementi.length > 0 ? (
              <section
                key={sezione.titolo}
                aria-labelledby={`tars-${sezione.titolo.toLowerCase()}`}
              >
                <h2
                  id={`tars-${sezione.titolo.toLowerCase()}`}
                  className="sticky top-0 z-10 bg-surface-2 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-text-3"
                >
                  {sezione.titolo}
                </h2>
                <ul>
                  {sezione.elementi.map(conversazione => (
                    <RigaConversazione
                      key={conversazione.id}
                      conversazione={conversazione}
                      attiva={conversazione.id === conversazioneAttivaId}
                      inCorso={conversazione.id === conversazioneInCorsoId}
                      onApri={() => onApriConversazione(conversazione)}
                      onRinomina={() => onRinomina(conversazione)}
                      onFissa={fissata => onFissa(conversazione, fissata)}
                      onArchivia={() => onArchivia(conversazione)}
                      onRipristina={() => onRipristina(conversazione)}
                      onElimina={() => onElimina(conversazione)}
                    />
                  ))}
                </ul>
              </section>
            ) : null
          )
        )}
      </div>
    </nav>
  );
}
