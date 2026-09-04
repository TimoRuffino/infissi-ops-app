// Tab «Fattura» della commessa: la bozza nasce dai limiti, si corregge qui e
// da qui si emette; dopo l'emissione la stessa tab mostra il documento in
// sola lettura. Questo componente sceglie solo quale fattura guardare — la
// modifica sta in `BozzaFatturaEditor`, la lettura in `FatturaEmessaView`.
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FileText, Plus } from "lucide-react";

import { trpc } from "@/lib/trpc";
import { badgeStatoFattura, VARIANTE_BADGE } from "@/lib/fatturaView";
import { formatCent } from "@/lib/limitiView";
import BozzaFatturaEditor from "@/components/fattura/BozzaFatturaEditor";
import FatturaEmessaView from "@/components/fattura/FatturaEmessaView";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function FatturaTab({ commessaId }: { commessaId: number }) {
  const utils = trpc.useUtils();
  const q = trpc.fatture.perCommessa.useQuery({ commessaId }, { retry: false });
  const [selezionata, setSelezionata] = useState<number | null>(null);

  const elenco = q.data?.fatture ?? [];

  // Quale fattura si apre per prima: la bozza (il lavoro in corso), poi la
  // più recente ancora viva, infine l'ultima creata comunque sia finita.
  const predefinita = useMemo(() => {
    if (elenco.length === 0) return null;
    const bozza = elenco.find(f => f.stato === "bozza");
    if (bozza) return bozza.id;
    const viva = [...elenco].reverse().find(f => f.stato !== "annullata");
    return (viva ?? elenco[elenco.length - 1]).id;
  }, [elenco]);

  useEffect(() => {
    if (predefinita == null) {
      if (selezionata != null) setSelezionata(null);
      return;
    }
    if (selezionata == null || !elenco.some(f => f.id === selezionata)) {
      setSelezionata(predefinita);
    }
  }, [predefinita, selezionata, elenco]);

  const crea = trpc.fatture.creaBozza.useMutation({
    onSuccess: esito => {
      void utils.fatture.perCommessa.invalidate({ commessaId });
      setSelezionata(esito.fattura.id);
      toast.success("Bozza generata dai limiti");
      esito.avvertenze.forEach(a => toast.warning(a));
    },
    onError: e => toast.error(e.message),
  });

  if (q.isLoading) {
    return (
      <p className="text-sm text-muted-foreground py-6">Caricamento fatture…</p>
    );
  }
  if (q.error)
    return <p className="text-sm text-danger py-6">{q.error.message}</p>;
  if (!q.data) return null;

  // Il server rifiuta una seconda fattura sulla commessa: finché ce n'è una
  // viva si passa dalla nota di credito, non da una bozza nuova.
  const puoGenerare = elenco.every(
    f => f.tipo !== "fattura" || f.stato === "annullata"
  );
  const fattura = elenco.find(f => f.id === selezionata) ?? null;

  return (
    <div className="space-y-4 mt-4 min-w-0">
      {puoGenerare && (
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <Button
            size="sm"
            className="h-9"
            disabled={!q.data.puoDraft || crea.isPending}
            onClick={() => crea.mutate({ commessaId })}
          >
            <Plus className="h-4 w-4 mr-1" />
            {crea.isPending ? "Generazione…" : "Genera bozza dai limiti"}
          </Button>
          <span className="text-xs text-text-3 min-w-0">
            {q.data.puoDraft
              ? "La bozza propone beni dal contratto e servizi dai limiti del computo: resta modificabile."
              : "Serve il permesso di preparare le fatture (amministrazione o direzione)."}
          </span>
        </div>
      )}

      {elenco.length === 0 && (
        <p className="text-sm text-muted-foreground py-6 text-center">
          Nessuna fattura su questa commessa.
        </p>
      )}

      {elenco.length > 1 && (
        <ul
          aria-label="Fatture della commessa"
          className="grid gap-2 min-w-0 sm:grid-cols-2"
        >
          {elenco.map(f => {
            const badge = badgeStatoFattura(f.stato, f.inviataDryRun);
            const scelta = f.id === selezionata;
            return (
              <li key={f.id} className="min-w-0">
                <button
                  type="button"
                  aria-current={scelta ? "true" : undefined}
                  onClick={() => setSelezionata(f.id)}
                  className={`flex w-full min-h-11 min-w-0 items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm ${
                    scelta
                      ? "border-border-strong bg-surface-2"
                      : "border-border hover:bg-surface-2"
                  }`}
                >
                  <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 truncate">
                    {f.tipo === "nota_credito"
                      ? "Nota di credito "
                      : "Fattura "}
                    {f.numero ?? "in bozza"}
                    {f.data ? ` · ${f.data}` : ""}
                  </span>
                  <Badge
                    variant={VARIANTE_BADGE[badge.tono]}
                    className="shrink-0"
                  >
                    {badge.testo}
                  </Badge>
                  <span className="ml-auto shrink-0 tabular-nums">
                    {formatCent(f.totaleCent)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {fattura?.stato === "bozza" ? (
        <BozzaFatturaEditor
          key={fattura.id}
          commessaId={commessaId}
          fatturaId={fattura.id}
          puoModificare={q.data.puoDraft}
          puoEmettere={q.data.puoEmettere}
          dryRun={q.data.dryRun}
          onAnnullata={() => setSelezionata(null)}
        />
      ) : fattura ? (
        <FatturaEmessaView
          key={fattura.id}
          commessaId={commessaId}
          fatturaId={fattura.id}
          puoNotaCredito={q.data.puoNotaCredito}
          onApriFattura={setSelezionata}
        />
      ) : null}
    </div>
  );
}
