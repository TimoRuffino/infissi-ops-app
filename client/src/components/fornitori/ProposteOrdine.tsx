// Pannello «Proposte dall'analisi» nella scheda ordine (D7, slice 3).
//
// Mostra le proposte generate dai documenti con TUTTO il contesto prima
// della decisione: stato, evidenza (pagina e frammento), motivazione,
// effetto esatto. Approvare e applicare sono due passi umani distinti e
// il pulsante di applicazione ripete l'effetto e chiede conferma
// esplicita. Nessun automatismo: un conflitto con la posa diventa un caso
// del Centro Azioni, mai una ripianificazione silenziosa.

import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ClipboardCheck, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const STATO_BADGE: Record<string, { label: string; classe: string }> = {
  proposta: { label: "Da approvare", classe: "bg-warning-soft text-warning" },
  approvata: {
    label: "Approvata — da applicare",
    classe: "bg-warning-soft text-warning",
  },
  applicata: { label: "Applicata", classe: "bg-success-soft text-success" },
  rifiutata: { label: "Rifiutata", classe: "bg-surface-2 text-text-3" },
  annullata: { label: "Annullata", classe: "bg-surface-2 text-text-3" },
  fallita: { label: "Applicazione fallita", classe: "bg-danger-soft text-danger" },
  scaduta: { label: "Scaduta", classe: "bg-surface-2 text-text-3" },
  obsoleta: {
    label: "Obsoleta: dati cambiati",
    classe: "bg-danger-soft text-danger",
  },
};

export default function ProposteOrdine({ ordineId }: { ordineId: number }) {
  const [aperto, setAperto] = useState(false);
  const [confermaId, setConfermaId] = useState<number | null>(null);
  const [motivo, setMotivo] = useState("");
  const utils = trpc.useUtils();

  const vista = trpc.proposte.perOrdine.useQuery(
    { ordineId },
    { enabled: aperto, retry: false }
  );
  const ricarica = () => utils.proposte.perOrdine.invalidate({ ordineId });

  const approva = trpc.proposte.approva.useMutation({
    onSuccess: () => {
      ricarica();
      toast.success("Proposta approvata: ora puoi applicarla");
    },
    onError: e => toast.error(e.message ?? "Approvazione non riuscita"),
  });
  const applica = trpc.proposte.applica.useMutation({
    onSuccess: ({ avvisoPosa, riusata }) => {
      ricarica();
      // L'ordine è cambiato davvero: la scheda deve mostrarlo subito.
      utils.fornitori.ordini.list.invalidate();
      utils.fornitori.ordini.byId.invalidate();
      setConfermaId(null);
      if (avvisoPosa) toast.warning(avvisoPosa, { duration: 12000 });
      else
        toast.success(
          riusata ? "Era già stata applicata" : "Applicata: ordine aggiornato"
        );
    },
    onError: e => {
      ricarica();
      toast.error(e.message ?? "Applicazione non riuscita");
    },
  });
  const rifiuta = trpc.proposte.rifiuta.useMutation({
    onSuccess: () => {
      ricarica();
      setMotivo("");
      toast.success("Proposta rifiutata");
    },
    onError: e => toast.error(e.message ?? "Rifiuto non riuscito"),
  });
  const annulla = trpc.proposte.annulla.useMutation({
    onSuccess: () => {
      ricarica();
      setMotivo("");
      toast.success("Proposta annullata");
    },
    onError: e => toast.error(e.message ?? "Annullamento non riuscito"),
  });

  if (!aperto) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="mt-2"
        onClick={() => setAperto(true)}
      >
        <ClipboardCheck className="h-3.5 w-3.5 mr-1" />
        Proposte dall'analisi
      </Button>
    );
  }

  const dati = vista.data;
  const occupato =
    approva.isPending ||
    applica.isPending ||
    rifiuta.isPending ||
    annulla.isPending;

  return (
    <div className="mt-2 rounded-md border border-border p-3 space-y-2">
      <div className="flex items-center gap-2">
        <ClipboardCheck className="h-4 w-4 text-text-3 shrink-0" />
        <span className="text-xs font-semibold">Proposte dall'analisi</span>
        {vista.isLoading && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-text-3" />
        )}
      </div>

      {vista.error && (
        <p className="text-xs text-text-3">
          {vista.error.data?.code === "FORBIDDEN"
            ? "Le proposte documentali richiedono una capacità dedicata."
            : vista.error.message}
        </p>
      )}

      {dati && dati.proposte.length === 0 && (
        <p className="text-xs text-text-3">
          Nessuna proposta per questo ordine: si generano dall'analisi della
          conferma, quando la consegna dichiarata non coincide.
        </p>
      )}

      {dati?.proposte.map(proposta => {
        const badge = STATO_BADGE[proposta.stato] ?? {
          label: proposta.stato,
          classe: "bg-surface-2 text-text-3",
        };
        const decisioneAperta =
          proposta.stato === "proposta" || proposta.stato === "approvata";
        const ultimoEvento = proposta.eventi[proposta.eventi.length - 1];
        return (
          <div
            key={proposta.id}
            className="rounded-md border border-border p-2.5 space-y-1.5 text-xs"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${badge.classe}`}
              >
                {badge.label}
              </span>
              <span className="font-medium">{proposta.etichetta}</span>
              <span className="text-text-3 ml-auto">
                da {proposta.documentoNome}
              </span>
            </div>

            {proposta.effetto && (
              <p className="font-medium">{proposta.effetto}</p>
            )}
            <p className="text-text-3">{proposta.motivazione}</p>
            {proposta.evidenza && (
              <p className="text-[11px] text-text-3">
                pag. {proposta.evidenza.pagina} — «{proposta.evidenza.frammento}
                »
              </p>
            )}
            {!decisioneAperta && ultimoEvento?.motivo && (
              <p className="text-[11px] text-text-3">{ultimoEvento.motivo}</p>
            )}

            {proposta.stato === "proposta" && dati.puoApprovare && (
              <div className="flex gap-1.5 pt-0.5">
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  disabled={occupato}
                  onClick={() => approva.mutate({ id: proposta.id })}
                >
                  Approva
                </Button>
                <Input
                  value={motivo}
                  onChange={e => setMotivo(e.target.value)}
                  className="h-7 text-xs flex-1 min-w-[140px]"
                  placeholder="Motivo del rifiuto (facoltativo)"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={occupato}
                  onClick={() =>
                    rifiuta.mutate({
                      id: proposta.id,
                      motivo: motivo.trim() || undefined,
                    })
                  }
                >
                  Rifiuta
                </Button>
              </div>
            )}

            {proposta.stato === "approvata" && dati.puoApplicare && (
              <div className="space-y-1 pt-0.5">
                {confermaId === proposta.id ? (
                  <div className="rounded border border-warning/50 bg-warning-soft/30 p-2 space-y-1">
                    <p className="font-medium">{proposta.effetto}</p>
                    <div className="flex gap-1.5">
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        disabled={occupato}
                        onClick={() => applica.mutate({ id: proposta.id })}
                      >
                        Confermo: applica ora
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={occupato}
                        onClick={() => setConfermaId(null)}
                      >
                        Indietro
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      disabled={occupato}
                      onClick={() => setConfermaId(proposta.id)}
                    >
                      Applica…
                    </Button>
                    <Input
                      value={motivo}
                      onChange={e => setMotivo(e.target.value)}
                      className="h-7 text-xs flex-1 min-w-[140px]"
                      placeholder="Motivo dell'annullamento (facoltativo)"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={occupato}
                      onClick={() =>
                        annulla.mutate({
                          id: proposta.id,
                          motivo: motivo.trim() || undefined,
                        })
                      }
                    >
                      Annulla
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {dati && (
        <p className="text-[11px] text-text-3">
          Le proposte non applicano nulla da sole: servono approvazione e
          applicazione di una persona autorizzata, e la posa non viene mai
          spostata in automatico.
        </p>
      )}
    </div>
  );
}
