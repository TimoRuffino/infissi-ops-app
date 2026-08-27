// Acquisti — revisione delle classificazioni.
//
// Il lavoro qui è ripetitivo per natura: un costo alla volta, decine alla
// settimana. Prima erano tre interazioni per riga — scegli nel menu, spunta
// "ricorda", premi salva — cioè un centinaio di gesti per una revisione
// normale, e la spunta "ricorda" chiedeva una decisione sul futuro mentre
// stavi guardando il passato.
//
// Ora la classificazione è un click: i tre valori sono bottoni, e il click
// salva. La regola per il futuro non si chiede più in anticipo: dopo aver
// classificato, se lo stesso fornitore ha altri documenti in coda, compare
// l'azione che li chiude tutti insieme. È l'ordine giusto, perché "questo
// fornitore è sempre così" lo si capisce guardando il primo documento, non
// prima di averlo aperto.

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatEuroSimbolo } from "@/lib/euro";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Check, Layers, Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useMemo, useState } from "react";
import { toast } from "sonner";

const CLASSI = [
  ["fisso", "Fisso", "Torna ogni mese: affitto, canoni, assicurazioni"],
  ["variabile_commessa", "Commessa", "Materiale o servizio per un lavoro"],
  ["straordinario", "Straordinario", "Una tantum, non si ripeterà"],
] as const;

const ETICHETTA_CLASSE: Record<string, string> = {
  fisso: "Fisso",
  variabile_commessa: "Commessa",
  straordinario: "Straordinario",
  dubbio: "Da classificare",
};

function dataBreve(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

function RigaCosto({
  costo,
  altriDubbiStessoFornitore,
}: {
  costo: any;
  altriDubbiStessoFornitore: number;
}) {
  const utils = trpc.useUtils();
  const [appenaClassificato, setAppenaClassificato] = useState<string | null>(
    null
  );

  const invalida = () => {
    utils.ficCosti.invalidate();
    utils.economia.invalidate();
  };

  const riclassifica = trpc.ficCosti.riclassifica.useMutation({
    onSuccess: (_r, variabili) => {
      invalida();
      setAppenaClassificato(variabili.classificazione);
    },
    onError: e => toast.error(e.message),
  });
  const perFornitore = trpc.ficCosti.riclassificaFornitore.useMutation({
    onSuccess: r => {
      invalida();
      setAppenaClassificato(null);
      toast.success(`${r.aggiornati} documenti di ${r.fornitore} classificati`);
    },
    onError: e => toast.error(e.message),
  });

  const inCorso = riclassifica.isPending || perFornitore.isPending;
  const attuale = costo.classificazione;
  // L'offerta di estendere al fornitore compare solo dopo una scelta, e solo
  // se c'è davvero altro da chiudere: un'azione di massa su un elemento solo
  // è rumore.
  const proponiEstensione =
    appenaClassificato != null &&
    appenaClassificato !== "dubbio" &&
    altriDubbiStessoFornitore > 0;

  return (
    <li className="flex flex-col gap-2.5 px-3 py-3 sm:px-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{costo.fornitoreNome}</p>
          <p className="truncate text-xs text-text-3">
            {[costo.categoriaFic, costo.descrizione]
              .filter(Boolean)
              .join(" · ") || "Nessuna descrizione"}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-semibold tabular-nums">
            {formatEuroSimbolo(costo.importoNetto)}
          </p>
          <p className="text-xs tabular-nums text-text-3">
            {dataBreve(costo.data)}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {/* Un gruppo di bottoni, non un menu: i valori sono tre e vanno
            confrontati a colpo d'occhio, non aperti per essere letti. */}
        <div
          role="group"
          aria-label={`Classificazione di ${costo.fornitoreNome}`}
          className="flex flex-wrap gap-1.5"
        >
          {CLASSI.map(([valore, etichetta, aiuto]) => {
            const attivo = attuale === valore;
            return (
              <Button
                key={valore}
                type="button"
                size="sm"
                variant={attivo ? "default" : "outline"}
                title={aiuto}
                aria-pressed={attivo}
                className="h-10 sm:h-9"
                disabled={inCorso}
                onClick={() =>
                  riclassifica.mutate({
                    id: costo.id,
                    classificazione: valore,
                    ricorda: false,
                  })
                }
              >
                {inCorso && riclassifica.variables?.classificazione === valore ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : attivo ? (
                  <Check className="h-3.5 w-3.5" />
                ) : null}
                {etichetta}
              </Button>
            );
          })}
        </div>

        {costo.fonteClassificazione === "utente" && attuale !== "dubbio" && (
          <Badge variant="outline" className="text-[10px]">
            confermato
          </Badge>
        )}
      </div>

      {proponiEstensione && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2">
          <Layers className="h-4 w-4 shrink-0 text-text-3" aria-hidden="true" />
          <span className="min-w-0 flex-1 text-xs text-text-2">
            {costo.fornitoreNome} ha altri {altriDubbiStessoFornitore} documenti
            da classificare.
          </span>
          <div className="flex gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-9"
              onClick={() => setAppenaClassificato(null)}
            >
              No
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-9"
              disabled={inCorso}
              onClick={() =>
                perFornitore.mutate({
                  id: costo.id,
                  classificazione: appenaClassificato as any,
                })
              }
            >
              {perFornitore.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              Tutti «{ETICHETTA_CLASSE[appenaClassificato!]}»
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

export default function CostiFicReview({ anno }: { anno: number }) {
  const [soloDubbi, setSoloDubbi] = useState(true);
  const [cerca, setCerca] = useState("");

  // Sempre l'anno intero: il conteggio dei dubbi per fornitore deve valere
  // anche quando la vista è filtrata, altrimenti l'azione di massa
  // prometterebbe un numero che non corrisponde.
  const query = trpc.ficCosti.list.useQuery({ anno });
  const tutti = query.data ?? [];

  const dubbiPerFornitore = useMemo(() => {
    const mappa = new Map<string, number>();
    for (const costo of tutti) {
      if (costo.classificazione !== "dubbio") continue;
      const chiave = (costo.fornitoreNome ?? "").trim().toLowerCase();
      mappa.set(chiave, (mappa.get(chiave) ?? 0) + 1);
    }
    return mappa;
  }, [tutti]);

  const termine = cerca.trim().toLowerCase();
  const righe = tutti.filter(costo => {
    if (soloDubbi && costo.classificazione !== "dubbio") return false;
    if (!termine) return true;
    return [costo.fornitoreNome, costo.categoriaFic, costo.descrizione]
      .filter(Boolean)
      .some(campo => String(campo).toLowerCase().includes(termine));
  });

  const daRivedere = dubbiPerFornitore.size
    ? Array.from(dubbiPerFornitore.values()).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Acquisti</h2>
          <p className="text-xs text-text-3">
            {daRivedere > 0
              ? `${daRivedere} documenti aspettano una classificazione. I costi che tornano ogni mese sono già fissi da soli.`
              : "Tutto classificato. I costi ricorrenti si riconoscono da soli."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3"
              aria-hidden="true"
            />
            <Input
              value={cerca}
              onChange={e => setCerca(e.target.value)}
              placeholder="Cerca fornitore…"
              aria-label="Cerca fra gli acquisti"
              className="h-10 w-[10.5rem] pl-8 sm:h-9"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-10 sm:h-9"
            aria-pressed={soloDubbi}
            onClick={() => setSoloDubbi(v => !v)}
          >
            {soloDubbi ? "Solo da fare" : "Tutti"}
            <Badge variant="secondary" className="ml-1.5 text-[10px]">
              {soloDubbi ? daRivedere : tutti.length}
            </Badge>
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-md border border-border bg-surface">
        {query.isLoading ? (
          <div className="flex min-h-32 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-text-3" />
          </div>
        ) : righe.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-text-3">
            {termine
              ? `Nessun acquisto per «${cerca.trim()}».`
              : soloDubbi
                ? "Niente da classificare: il calcolo del pareggio è completo."
                : "Nessun documento ricevuto per questo anno."}
          </div>
        ) : (
          <ul className="divide-y divide-border/70">
            {righe.map(costo => (
              <RigaCosto
                key={costo.id}
                costo={costo}
                altriDubbiStessoFornitore={Math.max(
                  0,
                  (dubbiPerFornitore.get(
                    (costo.fornitoreNome ?? "").trim().toLowerCase()
                  ) ?? 0) - 1
                )}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
