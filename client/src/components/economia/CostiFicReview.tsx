// Acquisti — classificazione dei costi.
//
// Il lavoro qui è ripetitivo per natura, e lo era due volte più del
// necessario. Nel 2025 restavano 265 documenti da classificare distribuiti su
// 140 fornitori: farlo riga per riga significa prendere 265 decisioni per
// rispondere a 140 domande, perché un fornitore ha quasi sempre una natura
// sola — l'affitto è affitto ogni mese, la trattoria è un pranzo di lavoro
// tutte le volte.
//
// Da qui le due viste:
//   Fornitori   una riga per fornitore, tre bottoni, chiude tutto il gruppo
//   Documenti   selezione multipla per i casi sparsi (82 fornitori con un
//               documento solo: come gruppi non esistono, come selezione sì)

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatEuroSimbolo } from "@/lib/euro";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  Check,
  ChevronRight,
  Layers,
  Loader2,
  Search,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

const CLASSI = [
  ["fisso", "Fisso", "Torna ogni mese: affitto, canoni, assicurazioni"],
  ["variabile_commessa", "Variabile", "Materiale o servizio operativo"],
  ["straordinario", "Straordinario", "Una tantum, non si ripeterà"],
] as const;

function dataBreve(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

function periodo(dal: string, al: string): string {
  return dal === al ? dataBreve(dal) : `${dataBreve(dal)} – ${dataBreve(al)}`;
}

/** I tre bottoni. Un click classifica: niente menu da aprire per leggere. */
function BottoniClasse({
  attuale,
  inCorso,
  inCorsoSu,
  onScegli,
  suffisso,
  etichetta,
}: {
  attuale?: string;
  inCorso: boolean;
  inCorsoSu?: string | null;
  onScegli: (valore: (typeof CLASSI)[number][0]) => void;
  suffisso?: string;
  etichetta: string;
}) {
  return (
    <div role="group" aria-label={etichetta} className="flex flex-wrap gap-1.5">
      {CLASSI.map(([valore, testo, aiuto]) => {
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
            onClick={() => onScegli(valore)}
          >
            {inCorso && inCorsoSu === valore ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : attivo ? (
              <Check className="h-3.5 w-3.5" />
            ) : null}
            {testo}
            {suffisso}
          </Button>
        );
      })}
    </div>
  );
}

function RigaCosto({
  costo,
  selezionato,
  onSeleziona,
}: {
  costo: any;
  selezionato: boolean;
  onSeleziona: (id: number, valore: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const riclassifica = trpc.ficCosti.riclassifica.useMutation({
    onSuccess: () => {
      utils.ficCosti.invalidate();
      utils.economia.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  return (
    <li className="flex flex-col gap-2.5 px-3 py-3 sm:px-4">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
          checked={selezionato}
          aria-label={`Seleziona ${costo.fornitoreNome}`}
          onChange={e => onSeleziona(costo.id, e.target.checked)}
        />
        <div className="min-w-0 flex-1">
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

      <div className="flex flex-wrap items-center gap-1.5 sm:pl-7">
        <BottoniClasse
          etichetta={`Classificazione di ${costo.fornitoreNome}`}
          attuale={costo.classificazione}
          inCorso={riclassifica.isPending}
          inCorsoSu={riclassifica.variables?.classificazione}
          onScegli={valore =>
            riclassifica.mutate({
              id: costo.id,
              classificazione: valore,
              ricorda: false,
            })
          }
        />
        {costo.fonteClassificazione === "utente" &&
          costo.classificazione !== "dubbio" && (
            <Badge variant="outline" className="text-[10px]">
              confermato
            </Badge>
          )}
      </div>

    </li>
  );
}

function GruppoFornitore({ gruppo }: { gruppo: any }) {
  const utils = trpc.useUtils();
  const [aperto, setAperto] = useState(false);
  const classifica = trpc.ficCosti.riclassificaFornitore.useMutation({
    onSuccess: r => {
      utils.ficCosti.invalidate();
      utils.economia.invalidate();
      toast.success(`${r.aggiornati} documenti di ${r.fornitore} classificati`);
    },
    onError: e => toast.error(e.message),
  });

  return (
    <li className="flex flex-col gap-2.5 px-3 py-3 sm:px-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{gruppo.fornitore}</p>
          <p className="truncate text-xs text-text-3">
            {gruppo.documenti} document{gruppo.documenti === 1 ? "o" : "i"} ·{" "}
            {periodo(gruppo.dal, gruppo.al)}
            {gruppo.esempi.length > 0 ? ` · ${gruppo.esempi.join(" · ")}` : ""}
          </p>
        </div>
        <p className="shrink-0 font-semibold tabular-nums">
          {formatEuroSimbolo(gruppo.totale)}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <BottoniClasse
          etichetta={`Classificazione di ${gruppo.fornitore}`}
          inCorso={classifica.isPending}
          inCorsoSu={classifica.variables?.classificazione}
          onScegli={valore =>
            classifica.mutate({ id: gruppo.ids[0], classificazione: valore })
          }
          suffisso={gruppo.documenti > 1 ? ` ×${gruppo.documenti}` : undefined}
        />
        {gruppo.documenti > 1 && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-9 text-xs"
            aria-expanded={aperto}
            onClick={() => setAperto(v => !v)}
          >
            <ChevronRight
              className={cn("mr-1 h-3 w-3 transition-transform", aperto && "rotate-90")}
              aria-hidden="true"
            />
            {aperto ? "Nascondi" : "Vedi i documenti"}
          </Button>
        )}
      </div>

      {/* Vale la pena aprire solo se qualcosa non torna: la decisione si
          prende sul fornitore, non su ogni riga. */}
      {aperto && (
        <ul className="divide-y divide-border/60 rounded-md border border-border bg-surface-2">
          {gruppo.dettaglio.map((costo: any) => (
            <li
              key={costo.id}
              className="flex items-center justify-between gap-3 px-2.5 py-1.5 text-xs"
            >
              <span className="min-w-0 truncate text-text-2">
                {costo.descrizione ?? costo.categoriaFic ?? "Senza descrizione"}
              </span>
              <span className="shrink-0 tabular-nums text-text-3">
                {dataBreve(costo.data)} · {formatEuroSimbolo(costo.importoNetto)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

type Vista = "fornitori" | "documenti";

export default function CostiFicReview({
  anno,
  onCambiaAnno,
}: {
  anno: number;
  onCambiaAnno?: (anno: number) => void;
}) {
  const [vista, setVista] = useState<Vista>("fornitori");
  const [cerca, setCerca] = useState("");
  const [selezione, setSelezione] = useState<Set<number>>(new Set());

  const utils = trpc.useUtils();
  const query = trpc.ficCosti.list.useQuery({ anno });
  const gruppiQuery = trpc.ficCosti.daClassificarePerFornitore.useQuery({ anno });
  const arretratiQuery = trpc.ficCosti.arretrati.useQuery();
  const tutti = query.data ?? [];
  const gruppi = gruppiQuery.data ?? [];
  const arretrati = arretratiQuery.data ?? [];

  const inBlocco = trpc.ficCosti.riclassificaMolti.useMutation({
    onSuccess: r => {
      utils.ficCosti.invalidate();
      utils.economia.invalidate();
      setSelezione(new Set());
      toast.success(`${r.aggiornati} documenti classificati`);
    },
    onError: e => toast.error(e.message),
  });

  const termine = cerca.trim().toLowerCase();
  const daClassificare = tutti.filter(
    (c: any) => c.classificazione === "dubbio"
  );

  // Il dettaglio dei gruppi viene dalla lista già in pagina: il server manda
  // gli id, non serve una seconda query per mostrare tre righe.
  const gruppiConDettaglio = useMemo(() => {
    const perId = new Map(tutti.map((c: any) => [c.id, c]));
    return gruppi
      .filter((g: any) =>
        !termine ? true : String(g.fornitore).toLowerCase().includes(termine)
      )
      .map((g: any) => ({
        ...g,
        dettaglio: g.ids.map((id: number) => perId.get(id)).filter(Boolean),
      }));
  }, [gruppi, tutti, termine]);

  const righeDocumenti = daClassificare.filter((costo: any) => {
    if (!termine) return true;
    return [costo.fornitoreNome, costo.categoriaFic, costo.descrizione]
      .filter(Boolean)
      .some(campo => String(campo).toLowerCase().includes(termine));
  });

  const altriAnni = arretrati.filter(
    (a: any) => a.anno !== anno && a.daClassificare > 0
  );

  const seleziona = (id: number, valore: boolean) =>
    setSelezione(prima => {
      const dopo = new Set(prima);
      if (valore) dopo.add(id);
      else dopo.delete(id);
      return dopo;
    });

  const VISTE: Array<[Vista, string, number]> = [
    ["fornitori", "Per fornitore", gruppi.length],
    ["documenti", "Documento per documento", daClassificare.length],
  ];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Acquisti</h2>
          <p className="text-xs text-text-3">
            {daClassificare.length > 0
              ? `${daClassificare.length} document${daClassificare.length === 1 ? "o" : "i"} da classificare nel ${anno}, su ${gruppi.length} fornitor${gruppi.length === 1 ? "e" : "i"}. I costi che tornano ogni mese sono già fissi da soli.`
              : "Tutto classificato."}
          </p>
        </div>
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
            className="h-10 w-[11rem] pl-8 sm:h-9"
          />
        </div>
      </div>

      {/* L'arretrato di un altro anno non si vede da qui, e un arretrato che
          non si vede non viene smaltito. */}
      {altriAnni.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2">
          <Layers className="h-4 w-4 shrink-0 text-text-3" aria-hidden="true" />
          <span className="min-w-0 flex-1 text-xs text-text-2">
            Anche altri anni hanno lavoro in sospeso.
          </span>
          <div className="flex flex-wrap gap-1.5">
            {altriAnni.map((a: any) => (
              <Button
                key={a.anno}
                type="button"
                size="sm"
                variant="outline"
                className="h-9 text-xs"
                disabled={!onCambiaAnno}
                onClick={() => onCambiaAnno?.(a.anno)}
              >
                {a.anno}
                <Badge variant="warning" className="ml-1.5 text-[10px]">
                  {a.daClassificare}
                </Badge>
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {VISTE.map(([id, etichetta, conteggio]) => (
          <Button
            key={id}
            type="button"
            size="sm"
            variant={vista === id ? "default" : "outline"}
            className="h-9 text-xs"
            aria-pressed={vista === id}
            onClick={() => {
              setVista(id);
              setSelezione(new Set());
            }}
          >
            {etichetta}
            <Badge variant="secondary" className="ml-1.5 text-[10px]">
              {conteggio}
            </Badge>
          </Button>
        ))}
      </div>

      {/* Barra della selezione: serve per i fornitori con un documento solo,
          che come gruppo non esistono ma insieme si chiudono in un gesto. */}
      {vista === "documenti" && selezione.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/40 bg-surface-2 px-3 py-2">
          <span className="text-xs font-medium">
            {selezione.size} selezionat{selezione.size === 1 ? "o" : "i"}
          </span>
          <div className="ml-auto flex flex-wrap gap-1.5">
            {CLASSI.map(([valore, testo]) => (
              <Button
                key={valore}
                type="button"
                size="sm"
                variant="outline"
                className="h-9 text-xs"
                disabled={inBlocco.isPending}
                onClick={() =>
                  inBlocco.mutate({
                    ids: Array.from(selezione),
                    classificazione: valore,
                  })
                }
              >
                {inBlocco.isPending &&
                inBlocco.variables?.classificazione === valore ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : null}
                {testo}
              </Button>
            ))}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-9 text-xs"
              onClick={() => setSelezione(new Set())}
            >
              Annulla
            </Button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-border bg-surface">
        {query.isLoading || gruppiQuery.isLoading ? (
          <div className="flex min-h-32 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-text-3" />
          </div>
        ) : vista === "fornitori" ? (
          gruppiConDettaglio.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-text-3">
              {termine
                ? `Nessun fornitore per «${cerca.trim()}».`
                : `Niente da classificare nel ${anno}.`}
            </div>
          ) : (
            <ul className="divide-y divide-border/70">
              {gruppiConDettaglio.map((gruppo: any) => (
                <GruppoFornitore key={gruppo.fornitore} gruppo={gruppo} />
              ))}
            </ul>
          )
        ) : righeDocumenti.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-text-3">
            {termine
              ? `Nessun acquisto per «${cerca.trim()}».`
              : `Niente da classificare nel ${anno}.`}
          </div>
        ) : (
          <ul className="divide-y divide-border/70">
            {righeDocumenti.map((costo: any) => (
              <RigaCosto
                key={costo.id}
                costo={costo}
                selezionato={selezione.has(costo.id)}
                onSeleziona={seleziona}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
