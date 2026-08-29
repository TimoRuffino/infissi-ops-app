// Collegamento assistito documento → ordine fornitore (D7, slice 2).
//
// Il dialog mostra TUTTO prima della scelta: stato della candidatura,
// punteggio e segnali con evidenza (pagina e frammento), avvertenze,
// eventuale duplicato. Nessun collegamento parte da solo — nemmeno con
// stato «certa»: conferma, rifiuto e annullamento sono decisioni umane
// registrate, e non modificano documento, ordine o commessa.

import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link2, Loader2, Unlink } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const STATO_BADGE: Record<string, { label: string; classe: string }> = {
  certa: { label: "Corrispondenza certa", classe: "bg-success-soft text-success" },
  candidata: { label: "Candidato da confermare", classe: "bg-warning-soft text-warning" },
  ambigua: { label: "Più ordini possibili", classe: "bg-warning-soft text-warning" },
  assente: { label: "Nessuna corrispondenza", classe: "bg-surface-2 text-text-3" },
};

export default function CollegaOrdineDialog({
  documento,
  onClose,
}: {
  documento: { id: number; nome: string } | null;
  onClose: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const utils = trpc.useUtils();
  const aperto = documento != null;

  const candidati = trpc.analisiDocumenti.candidati.useQuery(
    { documentoId: documento?.id ?? 0 },
    { enabled: aperto }
  );
  // L'id arriva dalle variables della mutation: se l'operatore chiude il
  // dialog prima della risposta, l'invalidazione colpisce comunque il
  // documento giusto (rilievo della revisione).
  const ricarica = (documentoId: number) =>
    utils.analisiDocumenti.candidati.invalidate({ documentoId });

  const collega = trpc.analisiDocumenti.collega.useMutation({
    onSuccess: ({ riusato }, variabili) => {
      ricarica(variabili.documentoId);
      setMotivo("");
      toast.success(riusato ? "Era già collegato a questo ordine" : "Collegato");
    },
    onError: e => toast.error(e.message ?? "Collegamento non riuscito"),
  });
  const rifiuta = trpc.analisiDocumenti.rifiuta.useMutation({
    onSuccess: (_dati, variabili) => {
      ricarica(variabili.documentoId);
      toast.success("Candidato rifiutato: non verrà più proposto come certo");
    },
    onError: e => toast.error(e.message ?? "Rifiuto non registrato"),
  });
  const annulla = trpc.analisiDocumenti.annulla.useMutation({
    onSuccess: (_dati, variabili) => {
      ricarica(variabili.documentoId);
      setMotivo("");
      toast.success("Collegamento annullato");
    },
    onError: e => toast.error(e.message ?? "Annullamento non riuscito"),
  });

  const documentoId = documento?.id ?? null;
  const dati = candidati.data;
  const esito = dati?.esito ?? null;
  const badge = esito ? STATO_BADGE[esito.stato] : null;
  const occupato =
    collega.isPending || rifiuta.isPending || annulla.isPending;

  return (
    <Dialog
      open={aperto}
      onOpenChange={open => {
        if (!open) {
          setMotivo("");
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4" />
            Collega a un ordine fornitore
          </DialogTitle>
        </DialogHeader>

        <DialogDescription className="text-sm text-text-3 -mt-2">
          {documento?.nome}
        </DialogDescription>

        {candidati.isLoading && (
          <div className="py-6 grid place-items-center">
            <Loader2 className="h-5 w-5 animate-spin text-text-3" />
          </div>
        )}

        {dati && dati.statoDocumento !== "estratto" && (
          <p className="text-sm text-warning">
            {dati.motivoDocumento ??
              "Il contenuto del documento non è leggibile: impossibile proporre candidati."}
          </p>
        )}

        {dati?.collegamento && (
          <div className="rounded-md border border-success/40 bg-success-soft/40 p-3 text-sm space-y-2">
            <p>
              Collegato all'ordine{" "}
              <span className="font-semibold">
                #{dati.collegamento.ordineId}
              </span>{" "}
              — il collegamento non ha modificato documento né ordine.
            </p>
            <div className="flex items-end gap-2 flex-wrap">
              <div className="space-y-0.5 flex-1 min-w-[180px]">
                <Label className="text-[11px]">
                  Motivo dell'annullamento (facoltativo)
                </Label>
                <Input
                  value={motivo}
                  onChange={e => setMotivo(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="Es. collegato all'ordine sbagliato"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                disabled={occupato}
                onClick={() =>
                  documentoId != null &&
                  annulla.mutate({
                    documentoId,
                    motivo: motivo.trim() || undefined,
                  })
                }
              >
                <Unlink className="h-3.5 w-3.5 mr-1" />
                Annulla collegamento
              </Button>
            </div>
          </div>
        )}

        {dati?.duplicato && (
          <p className="text-xs text-warning">{dati.duplicato.avviso}</p>
        )}

        {esito && !dati?.collegamento && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              {badge && (
                <span
                  className={`px-2 py-0.5 rounded text-[11px] font-semibold ${badge.classe}`}
                >
                  {badge.label}
                </span>
              )}
              <span className="text-xs text-text-3">{esito.motivo}</span>
            </div>

            {esito.candidati.map(candidato => (
              <div
                key={candidato.ordineId}
                className={`rounded-md border p-3 space-y-1.5 ${candidato.rifiutato ? "opacity-60" : ""}`}
              >
                <div className="flex items-center gap-2 flex-wrap text-sm">
                  <span className="font-mono text-xs">{candidato.codiceOrdine}</span>
                  {candidato.fornitoreNome && (
                    <span className="font-medium">{candidato.fornitoreNome}</span>
                  )}
                  {candidato.commessaCodice && (
                    <span className="text-xs text-text-3">
                      {candidato.commessaCodice}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-text-3">
                    punteggio {candidato.punteggio}
                  </span>
                  {candidato.rifiutato && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-surface-2 text-text-3">
                      rifiutato
                    </span>
                  )}
                </div>

                <ul className="space-y-1">
                  {candidato.segnali.map((segnale, indice) => (
                    <li key={indice} className="text-xs">
                      <span className="text-text-3">+{segnale.punti}</span>{" "}
                      {segnale.dettaglio}
                      {segnale.evidenza && (
                        <span className="block text-[11px] text-text-3">
                          pag. {segnale.evidenza.pagina} — «
                          {segnale.evidenza.frammento}»
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                {candidato.avvertenze.map((avvertenza, indice) => (
                  <p key={indice} className="text-[11px] text-warning">
                    {avvertenza}
                  </p>
                ))}

                <div className="flex gap-1.5 pt-1">
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    disabled={occupato}
                    onClick={() =>
                      documentoId != null &&
                      collega.mutate({
                        documentoId,
                        ordineId: candidato.ordineId,
                      })
                    }
                  >
                    Collega a questo ordine
                  </Button>
                  {!candidato.rifiutato && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={occupato}
                      onClick={() =>
                        documentoId != null &&
                        rifiuta.mutate({
                          documentoId,
                          ordineId: candidato.ordineId,
                        })
                      }
                    >
                      Non è questo
                    </Button>
                  )}
                </div>
              </div>
            ))}

            {esito.candidati.length === 0 && (
              <p className="text-sm text-text-3">
                Nessun ordine della sede condivide riferimenti con questo
                documento: se serve, collega dall'ordine giusto dopo averlo
                creato.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
