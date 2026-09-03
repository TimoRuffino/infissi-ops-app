// Tab «Limiti»: l'ultimo computo con esito, totali e voci raggruppate; ogni
// voce spiega il proprio numero. «Ricalcola» quando righe o parametri sono
// cambiati. Nessun calcolo qui: il server è l'unico confine.
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { badgeStato, formatCent, raggruppaVoci, spiegaVoce } from "@/lib/limitiView";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertTriangle, Calculator, Info } from "lucide-react";

const TONO: Record<"success" | "warning" | "muted", string> = {
  success: "text-success",
  warning: "text-warning",
  muted: "text-muted-foreground",
};

export default function LimitiTab({ commessaId }: { commessaId: number }) {
  const utils = trpc.useUtils();
  const q = trpc.computo.ultimo.useQuery({ commessaId }, { retry: false });
  const esegui = trpc.computo.esegui.useMutation({
    onSuccess: () => {
      utils.computo.ultimo.invalidate({ commessaId });
      toast.success("Limiti ricalcolati");
    },
    onError: e => toast.error(e.message),
  });

  if (q.error) return <p className="text-sm text-danger py-6">{q.error.message}</p>;
  if (!q.data) return <p className="text-sm text-muted-foreground py-6">Caricamento limiti…</p>;
  const stato = q.data;
  const badge = badgeStato(stato);
  const c = stato.computo;

  return (
    <div className="space-y-4 mt-4 min-w-0">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium">Computo dei limiti di spesa</span>
        <Badge variant="outline" className={TONO[badge.tono]}>
          {badge.testo}
        </Badge>
        {stato.motivo && <span className="text-xs text-muted-foreground">{stato.motivo}</span>}
        {stato.puoEseguire && (
          <Button
            size="sm"
            className="ml-auto h-7"
            disabled={esegui.isPending}
            onClick={() => esegui.mutate({ commessaId })}
          >
            <Calculator className="h-3.5 w-3.5 mr-1" />
            {c ? "Ricalcola" : "Calcola i limiti"}
          </Button>
        )}
      </div>

      {!c && (
        <p className="text-sm text-muted-foreground py-6 text-center">
          Nessun computo. Compila il contratto e premi «Calcola i limiti».
        </p>
      )}

      {c && (
        <>
          <dl className="grid grid-cols-2 md:grid-cols-6 gap-3 text-sm" aria-label="Riepilogo limiti">
            {(
              [
                ["CHECK 1 · Allegato A", formatCent(c.check1Cent)],
                ["CHECK 2 · DEI", formatCent(c.check2Cent)],
                ["CHECK 2 · prodotti DEI", formatCent(c.deiProdottiCent)],
                ["Limite (il minore)", formatCent(c.limiteCent)],
                ["Detraibile", formatCent(c.detraibileCent)],
                ["Detrazione stimata", formatCent(c.detrazioneStimataCent)],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded-lg border border-border p-2 min-w-0">
                <dt className="eyebrow">{k}</dt>
                <dd className="font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>

          {c.avvertenze.length > 0 && (
            <ul className="text-xs text-warning space-y-0.5" aria-label="Avvertenze del computo">
              {c.avvertenze.map(a => (
                <li key={a} className="flex gap-1">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {a}
                </li>
              ))}
            </ul>
          )}

          {raggruppaVoci(c.voci).map(g => (
            <section key={g.gruppo} aria-label={g.etichetta} className="min-w-0">
              <div className="flex items-baseline gap-2">
                <h3 className="text-sm font-medium">{g.etichetta}</h3>
                <span className="ml-auto text-sm tabular-nums font-semibold">
                  {formatCent(g.totaleCent)}
                </span>
              </div>
              <ul className="divide-y divide-border">
                {g.voci.map(v => (
                  // Una voce esclusa resta leggibile — dice perché un
                  // massimale ha vinto sull'altro — ma attenuata: il totale
                  // del gruppo non la conta.
                  <li
                    key={v.codice}
                    className={`grid grid-cols-[1fr_auto_auto] gap-2 py-1.5 text-sm items-center ${
                      v.inclusa ? "" : "text-muted-foreground"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <p className="truncate">{v.descrizione}</p>
                        {!v.inclusa && (
                          <Badge variant="outline" className="h-4 px-1 text-[10px] shrink-0">
                            non inclusa
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {v.codiceDei ? `${v.codiceDei} ` : ""}
                        {spiegaVoce(v)}
                      </p>
                    </div>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label={`Perché ${v.descrizione}`}
                        >
                          <Info className="h-3.5 w-3.5" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="text-xs space-y-1 w-64">
                        {Object.entries(v.dettaglio).map(([k, val]) => (
                          <p key={k}>
                            <span className="text-muted-foreground">{k}:</span> {String(val)}
                          </p>
                        ))}
                      </PopoverContent>
                    </Popover>
                    <span className="tabular-nums font-medium">{formatCent(v.limiteCent)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <p className="text-[11px] text-muted-foreground">
            Tariffe al {c.tariffeAl} · computo del {new Date(c.createdAt).toLocaleString("it-IT")}
          </p>
        </>
      )}
    </div>
  );
}
