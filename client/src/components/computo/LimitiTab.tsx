// Tab «Limiti»: l'ultimo computo con esito, totali e voci raggruppate; ogni
// voce spiega il proprio numero. «Ricalcola» quando righe o parametri sono
// cambiati. Nessun calcolo qui: il server è l'unico confine.
import { toast } from "sonner";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import {
  badgeStato,
  formatCent,
  motivoSintetico,
  raggruppaVoci,
  spiegaVoce,
} from "@/lib/limitiView";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertTriangle, Calculator, Info, ReceiptText } from "lucide-react";

const TONO: Record<"success" | "warning" | "muted", string> = {
  success: "text-success",
  warning: "text-warning",
  muted: "text-muted-foreground",
};

export default function LimitiTab({
  commessaId,
  modalita,
  onCambiato,
}: {
  commessaId: number;
  /**
   * Cornice in cui la tab è montata (piano 4). Assente = la tab della scheda
   * commessa, com'è sempre stata. `"guidata"` è il passo 3 del percorso
   * `/fatturazione/:id`: l'intestazione e l'avanzamento sono della pagina,
   * qui resta il computo. `"lettura"` (Task 6) è il riassunto in sola
   * lettura: limite, CHECK1/CHECK2, esito, nessun calcolo, solo «Apri
   * fatturazione».
   */
  modalita?: "guidata" | "lettura";
  /** Il computo è cambiato: chi monta rilegga lo stato dei passi. */
  onCambiato?: () => void;
}) {
  const guidata = modalita === "guidata";
  const lettura = modalita === "lettura";
  const utils = trpc.useUtils();
  const q = trpc.computo.ultimo.useQuery({ commessaId }, { retry: false });
  const esegui = trpc.computo.esegui.useMutation({
    onSuccess: () => {
      utils.computo.ultimo.invalidate({ commessaId });
      toast.success("Limiti ricalcolati");
      // Un computo valido con esito «ok» chiude il passo: la pagina guidata
      // rilegge e apre «Avanti».
      onCambiato?.();
    },
    onError: e => toast.error(e.message),
  });

  if (q.error) return <p className="text-sm text-danger py-6">{q.error.message}</p>;
  if (!q.data) return <p className="text-sm text-muted-foreground py-6">Caricamento limiti…</p>;
  const stato = q.data;
  const badge = badgeStato(stato);
  const c = stato.computo;
  const motivo = motivoSintetico(stato.motivo, c?.avvertenze.length ?? 0);

  if (lettura) {
    return (
      <div className="space-y-3 min-w-0">
        {c ? (
          <dl role="group" aria-label="Riepilogo limiti" className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div className="min-w-0">
              <dt className="eyebrow">Limite vincolante</dt>
              <dd className="font-semibold tabular-nums">{formatCent(c.limiteCent)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="eyebrow">CHECK 1</dt>
              <dd className="tabular-nums">{formatCent(c.check1Cent)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="eyebrow">CHECK 2</dt>
              <dd className="tabular-nums">{formatCent(c.check2Cent)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="eyebrow">Esito</dt>
              <dd>{c.esito === "ok" ? "ok" : "incompleto"}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">Nessun computo.</p>
        )}
        {c && !stato.valido && <Badge variant="warning">da ricalcolare</Badge>}
        <Button asChild className="min-h-11">
          <Link href={`/fatturazione/${commessaId}?passo=limiti`}>
            <ReceiptText className="h-4 w-4" aria-hidden="true" />
            Apri fatturazione
          </Link>
        </Button>
      </div>
    );
  }

  return (
    // `mt-4` è lo stacco dalla linguetta della tab: nel percorso guidato la
    // spaziatura la porta la pagina.
    <div className={guidata ? "space-y-4 min-w-0" : "space-y-4 mt-4 min-w-0"}>
      <div className="flex items-center gap-2 flex-wrap">
        {/* Nel percorso guidato il titolo del passo è già in testa alla
            pagina («3 · Limiti»): ripeterlo qui sarebbe una seconda
            intestazione per la stessa cosa. */}
        {!guidata && (
          <span className="text-sm font-medium">
            Computo dei limiti di spesa
          </span>
        )}
        <Badge variant="outline" className={TONO[badge.tono]}>
          {badge.testo}
        </Badge>
        {motivo && <span className="text-xs text-muted-foreground">{motivo}</span>}
        {stato.puoEseguire && (
          <Button
            size="sm"
            // Nel percorso guidato è il gesto principale del passo: target
            // touch pieno, non il pulsantino di una barra di tab.
            className={guidata ? "ml-auto min-h-11" : "ml-auto h-7"}
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
          <dl
            role="group"
            aria-label="Riepilogo limiti"
            className="grid grid-cols-2 md:grid-cols-6 gap-3 text-sm"
          >
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
              {/* Due righe possono generare la stessa avvertenza: la chiave
                  è la posizione, non il testo. */}
              {c.avvertenze.map((a, i) => (
                <li key={`${i}-${a}`} className="flex gap-1">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {a}
                </li>
              ))}
            </ul>
          )}

          {raggruppaVoci(c.voci, c.deiProdottiCent).map(g => (
            <section key={g.gruppo} aria-label={g.etichetta} className="min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <h3 className="text-sm font-medium">{g.etichetta}</h3>
                {g.incompleto && (
                  <span className="text-xs text-muted-foreground">
                    incompleto: manca una voce DEI
                  </span>
                )}
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
