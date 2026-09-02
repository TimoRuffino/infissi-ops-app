// Vista «Registro» della pagina Tars (Tars libero, 02/09/2026): ogni
// effetto di Tars in sede, con chi lo ha chiesto e su cosa. La fonte è il
// ledger R1 del server: qui si legge soltanto.
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { History, Loader2, RefreshCw, Undo2 } from "lucide-react";

const ETICHETTA_ENTITA: Record<string, string> = {
  commessa: "Commessa",
  cliente: "Cliente",
  ticket: "Ticket",
  intervento: "Intervento",
  comunicazione: "Comunicazione",
  caso: "Caso",
  documento: "Documento",
  promemoria: "Promemoria",
  proposta: "Proposta",
};

function linkEntita(riferimento: string): string | null {
  const [tipo, id] = riferimento.split(":");
  if (!id) return null;
  if (tipo === "commessa") return `/commesse/${id}`;
  if (tipo === "cliente") return `/clienti/${id}`;
  if (tipo === "comunicazione") return `/messaggi/email?messaggio=${id}`;
  return null;
}

function etichettaEntita(riferimento: string): string {
  const [tipo, id] = riferimento.split(":");
  return `${ETICHETTA_ENTITA[tipo] ?? tipo} ${id ?? ""}`.trim();
}

function etichettaStrumento(strumento: string): string {
  const testo = strumento.replace(/_/g, " ");
  return testo.charAt(0).toUpperCase() + testo.slice(1);
}

function dataBreve(valore: string | Date): string {
  const d = new Date(valore);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function classeStato(stato: string, esito: string | null): string {
  if (stato === "uncertain") return "bg-warning-soft text-warning";
  if (stato === "no_effect" || esito === "non_eseguito")
    return "bg-surface-2 text-text-2";
  return "bg-success-soft text-success";
}

function testoStato(stato: string, esito: string | null): string {
  if (stato === "uncertain") return "incerto";
  if (stato === "no_effect") return "nessun effetto";
  return (esito ?? "fatto").replace(/_/g, " ");
}

export function TarsRegistro({
  onApriLink,
}: {
  onApriLink: (link: string) => void;
}) {
  const registro = trpc.tars.registroAzioni.useQuery(
    { limite: 100 },
    { retry: false, staleTime: 15_000, refetchInterval: 60_000 }
  );
  const righe = registro.data ?? [];

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border-soft px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-text-1">Registro</h2>
          <p className="text-xs leading-5 text-text-3">
            Tutto ciò che Tars ha fatto in questa sede, con chi gliel'ha
            chiesto: se l'ha fatto Tars, si vede.
          </p>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-9 shrink-0"
          aria-label="Aggiorna il registro"
          title="Aggiorna"
          onClick={() => void registro.refetch()}
        >
          <RefreshCw aria-hidden="true" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {registro.isLoading ? (
          <p className="flex items-center gap-2 px-4 py-4 text-xs text-text-3">
            <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
            Carico il registro…
          </p>
        ) : registro.error ? (
          <p className="px-4 py-4 text-xs text-danger">{registro.error.message}</p>
        ) : righe.length === 0 ? (
          <div className="mx-auto max-w-md py-10 text-center">
            <History className="mx-auto size-8 text-text-3" aria-hidden="true" />
            <p className="mt-3 text-sm font-semibold text-text-1">
              Nessuna azione registrata in questa sede
            </p>
            <p className="mt-1 text-xs leading-5 text-text-3">
              Appena Tars crea, collega, archivia o aggiorna qualcosa, compare
              qui con data, esito e la persona per cui l'ha fatto.
            </p>
          </div>
        ) : (
          <ul aria-label="Registro delle azioni di Tars">
            <li
              aria-hidden="true"
              className="hidden gap-x-3 border-b border-border-soft px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-3 md:grid md:grid-cols-[6.5rem_minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1.2fr)]"
            >
              <span>Quando</span>
              <span>Azione</span>
              <span>Per chi</span>
              <span>Su cosa</span>
            </li>
            {righe.map(riga => (
              <li
                key={riga.id}
                className="grid gap-x-3 gap-y-1 border-b border-border-soft px-4 py-2.5 text-xs last:border-b-0 md:grid-cols-[6.5rem_minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1.2fr)] md:items-start"
              >
                <span className="text-text-3">{dataBreve(riga.quando)}</span>
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-semibold text-text-1">
                      {etichettaStrumento(riga.strumento)}
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-medium",
                        classeStato(riga.stato, riga.esito)
                      )}
                    >
                      {testoStato(riga.stato, riga.esito)}
                    </span>
                    {riga.undoDisponibile && (
                      <span className="inline-flex items-center gap-0.5 text-[11px] text-text-3">
                        <Undo2 className="size-3" aria-hidden="true" />
                        annullabile
                      </span>
                    )}
                  </div>
                  {riga.motivo && (
                    <p className="mt-0.5 text-text-2 break-words [overflow-wrap:anywhere]">
                      {riga.motivo}
                    </p>
                  )}
                </div>
                <span className="text-text-2">Tars per {riga.utente}</span>
                <div className="flex flex-wrap gap-1">
                  {riga.entitaToccate.length === 0 && (
                    <span className="text-text-3">—</span>
                  )}
                  {riga.entitaToccate.map(rif => {
                    const link = linkEntita(rif);
                    const classe =
                      "rounded-sm bg-surface-2 px-1.5 py-0.5 text-[11px] text-text-2";
                    return link ? (
                      <button
                        key={rif}
                        type="button"
                        className={cn(classe, "hover:underline")}
                        onClick={() => onApriLink(link)}
                      >
                        {etichettaEntita(rif)}
                      </button>
                    ) : (
                      <span key={rif} className={classe}>
                        {etichettaEntita(rif)}
                      </span>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
