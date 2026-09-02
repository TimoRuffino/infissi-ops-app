// Sezione «Registro» della pagina Tars (Tars libero, 02/09/2026): ogni
// effetto di Tars in sede, con chi lo ha chiesto e su cosa. La fonte è il
// ledger R1 del server: qui si legge soltanto.
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { History, Loader2, Undo2 } from "lucide-react";

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
  if (tipo === "comunicazione") return `/comunicazioni?comunicazione=${id}`;
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
    { limite: 80 },
    { retry: false, staleTime: 15_000, refetchInterval: 60_000 }
  );

  if (registro.isLoading) {
    return (
      <p className="flex items-center gap-2 px-3 py-4 text-xs text-text-3">
        <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
        Carico il registro…
      </p>
    );
  }
  if (registro.error) {
    return (
      <p className="px-3 py-4 text-xs text-danger">{registro.error.message}</p>
    );
  }
  const righe = registro.data ?? [];
  if (righe.length === 0) {
    return (
      <div className="px-3 py-4 text-xs leading-5 text-text-2">
        <p className="font-semibold text-text-1">
          Nessuna azione registrata in questa sede.
        </p>
        <p>
          Qui compare tutto ciò che Tars fa, con chi gliel'ha chiesto: se l'ha
          fatto Tars, si vede.
        </p>
      </div>
    );
  }

  return (
    <ul className="min-w-0" aria-label="Registro delle azioni di Tars">
      {righe.map(riga => (
        <li
          key={riga.id}
          className="border-b border-border-soft px-3 py-2 text-xs last:border-b-0"
        >
          <div className="flex min-w-0 items-center gap-2">
            <History className="size-3.5 shrink-0 text-text-3" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate font-semibold text-text-1">
              {etichettaStrumento(riga.strumento)}
            </span>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                classeStato(riga.stato, riga.esito)
              )}
            >
              {testoStato(riga.stato, riga.esito)}
            </span>
          </div>
          <p className="mt-0.5 text-text-3">
            Tars per {riga.utente} · {dataBreve(riga.quando)}
            {riga.undoDisponibile && (
              <span className="ml-1 inline-flex items-center gap-0.5">
                <Undo2 className="size-3" aria-hidden="true" />
                annullabile
              </span>
            )}
          </p>
          {riga.motivo && (
            <p className="mt-0.5 text-text-2 break-words [overflow-wrap:anywhere]">
              {riga.motivo}
            </p>
          )}
          {riga.entitaToccate.length > 0 && (
            <p className="mt-1 flex flex-wrap gap-1">
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
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
