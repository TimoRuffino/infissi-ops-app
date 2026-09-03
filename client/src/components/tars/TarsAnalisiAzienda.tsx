// Analisi azienda di Tars (02/09/2026): la sintesi giornaliera della
// direzione sulla pagina Tars. Il server è il confine (flag, direzione,
// sede); qui si legge, si rigenera a mano e si passa una proposta alla
// chat con «Chiedi a Tars» — nessuna mutazione nasce da qui.
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Brain, Loader2, MessageSquarePlus, RefreshCw } from "lucide-react";
import { toast } from "sonner";

const ETICHETTA_TIPO: Record<string, string> = {
  rischio: "Rischio",
  anomalia: "Anomalia",
  andamento: "Andamento",
  opportunita: "Opportunità",
};

function classeTipo(tipo: string, priorita: string): string {
  if (tipo === "rischio" && priorita === "alta") return "bg-danger-soft text-danger";
  if (tipo === "rischio" || tipo === "anomalia") return "bg-warning-soft text-warning";
  if (tipo === "opportunita") return "bg-success-soft text-success";
  return "bg-surface-2 text-text-2";
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

export function useAnalisiAzienda(abilitato = true) {
  const utils = trpc.useUtils();
  const query = trpc.tars.analisiAzienda.useQuery(undefined, {
    enabled: abilitato,
    retry: false,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
  const rigenera = trpc.tars.analisiAziendaRigenera.useMutation({
    onSuccess: () => {
      void utils.tars.analisiAzienda.invalidate();
      toast.success("Analisi rigenerata");
    },
    onError: errore =>
      toast.error(errore.message || "Rigenerazione non riuscita."),
  });
  const record = query.data?.record ?? null;
  const codice = query.error?.data?.code;
  return {
    loading: query.isLoading,
    record,
    esito: record?.stato === "pronta" ? record.esito : null,
    oggi: query.data?.oggi ?? null,
    // Riservata alla direzione o flag spento: la sezione non esiste.
    nascosta: codice === "FORBIDDEN" || codice === "PRECONDITION_FAILED",
    errore:
      codice && codice !== "FORBIDDEN" && codice !== "PRECONDITION_FAILED"
        ? (query.error?.message ?? null)
        : null,
    proposte: record?.stato === "pronta" ? (record.esito?.proposte ?? []) : [],
    rigenera,
  };
}

export type AnalisiAzienda = ReturnType<typeof useAnalisiAzienda>;

/** Sezione completa: sintesi, punti, domande, Rigenera (pannello contesto). */
export function SezioneAnalisiAzienda({
  onApriLink,
  compatta = false,
}: {
  onApriLink?: (link: string) => void;
  compatta?: boolean;
}) {
  const analisi = useAnalisiAzienda();
  if (analisi.nascosta) return null;
  const record = analisi.record;
  const esito = analisi.esito;
  const inCorso = analisi.rigenera.isPending;
  const bottoneRigenera = (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="size-8 shrink-0"
      aria-label="Rigenera l'analisi di oggi"
      title="Rigenera"
      disabled={inCorso}
      onClick={() => analisi.rigenera.mutate()}
    >
      {inCorso ? (
        <Loader2 className="size-4 motion-safe:animate-spin" />
      ) : (
        <RefreshCw className="size-4" />
      )}
    </Button>
  );

  return (
    <section aria-labelledby="tars-analisi-oggi">
      <div className="flex items-center gap-2">
        <h3
          id="tars-analisi-oggi"
          className="flex min-w-0 flex-1 items-center gap-2 text-xs font-bold uppercase tracking-wide text-text-3"
        >
          <Brain className="size-4" aria-hidden="true" />
          Analisi di oggi
        </h3>
        {bottoneRigenera}
      </div>
      {analisi.loading ? (
        <p className="mt-2 flex items-center gap-2 text-xs text-text-3">
          <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
          Carico l'analisi…
        </p>
      ) : analisi.errore ? (
        <p className="mt-2 text-xs text-danger">{analisi.errore}</p>
      ) : !record ? (
        <p className="mt-2 rounded-md bg-surface-2 px-3 py-3 text-xs leading-5 text-text-3">
          Nessuna analisi ancora: Tars la prepara ogni mattina dalle 6, oppure
          rigenerala ora.
        </p>
      ) : record.stato === "errore" ? (
        <p className="mt-2 rounded-md bg-danger-soft px-3 py-3 text-xs leading-5 text-danger">
          Analisi di oggi non riuscita: {record.errore}. Rigenerala quando vuoi.
        </p>
      ) : esito ? (
        <div className="mt-2 space-y-3">
          <p className="text-[11px] text-text-3">
            {dataBreve(record.generataAt)}
            {record.giorno !== analisi.oggi ? " · di un giorno precedente" : ""}
            {esito.fonte === "deterministica" ? " · senza modello" : ""}
            {` · ${esito.fattiConsiderati} fatti`}
          </p>
          <p className="rounded-md border border-border-soft bg-surface px-3 py-3 text-xs leading-5 text-text-1 break-words [overflow-wrap:anywhere]">
            {esito.sintesi}
          </p>
          {esito.punti.length > 0 && (
            <ul className="space-y-1.5">
              {esito.punti.slice(0, compatta ? 4 : 8).map((punto, i) => (
                <li key={i} className="flex min-w-0 items-start gap-2 text-xs">
                  <span
                    className={cn(
                      "mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                      classeTipo(punto.tipo, punto.priorita)
                    )}
                  >
                    {ETICHETTA_TIPO[punto.tipo] ?? punto.tipo}
                  </span>
                  <span className="min-w-0">
                    {punto.link && onApriLink ? (
                      <button
                        type="button"
                        className="text-left text-text-1 hover:underline break-words [overflow-wrap:anywhere]"
                        onClick={() => onApriLink(punto.link!)}
                      >
                        {punto.testo}
                      </button>
                    ) : (
                      <span className="text-text-1 break-words [overflow-wrap:anywhere]">
                        {punto.testo}
                      </span>
                    )}
                    {/* I riferimenti col NOME, cliccabili: «commessa:133» non
                        dice niente a chi legge (direzione 03/09). */}
                    {punto.entita.length > 0 && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {punto.entita.slice(0, 4).map(e =>
                          e.link && onApriLink ? (
                            <button
                              key={e.riferimento}
                              type="button"
                              className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-[11px] text-text-2 hover:underline"
                              onClick={() => onApriLink(e.link!)}
                            >
                              {e.etichetta}
                            </button>
                          ) : (
                            <span
                              key={e.riferimento}
                              className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-[11px] text-text-3"
                            >
                              {e.etichetta}
                            </span>
                          )
                        )}
                        {punto.entita.length > 4 && (
                          <span className="text-[11px] text-text-3">
                            +{punto.entita.length - 4}
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {!compatta && esito.domande.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-text-2">Domande per la direzione</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-text-2">
                {esito.domande.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
          )}
          {esito.proposte.length > 0 && (
            <p className="text-[11px] text-text-3">
              {esito.proposte.length}{" "}
              {esito.proposte.length === 1 ? "proposta" : "proposte"} nella scheda
              Proposte.
            </p>
          )}
          {!compatta && esito.avvertenze.length > 0 && (
            <p className="text-[11px] text-text-3">{esito.avvertenze.join(" ")}</p>
          )}
        </div>
      ) : null}
    </section>
  );
}

/** Solo la sintesi, per lo stato vuoto della conversazione. */
export function SintesiAnalisiAzienda() {
  const analisi = useAnalisiAzienda();
  if (analisi.nascosta || analisi.loading || !analisi.esito) return null;
  return (
    <section
      aria-labelledby="tars-empty-analisi"
      className="rounded-md bg-surface-2 p-3 text-left"
    >
      <h3
        id="tars-empty-analisi"
        className="mb-2 flex items-center gap-2 text-xs font-bold"
      >
        <Brain className="size-4 text-text-3" aria-hidden="true" />
        Analisi di oggi
      </h3>
      <p className="text-xs leading-5 text-text-1 break-words [overflow-wrap:anywhere]">
        {analisi.esito.sintesi}
      </p>
    </section>
  );
}

/** Le proposte dell'analisi, con «Chiedi a Tars» che precompila la chat. */
export function ProposteDallAnalisi({
  proposte,
  onApriLink,
  onSuggerimento,
}: {
  proposte: Array<{ testo: string; richiestaPerTars: string; link: string | null }>;
  onApriLink: (link: string) => void;
  onSuggerimento: (testo: string) => void;
}) {
  return (
    <ul>
      {proposte.map((p, i) => (
        <li key={i} className="flex min-w-0 items-start gap-2 px-3 py-2 text-xs">
          <div className="min-w-0 flex-1">
            {p.link ? (
              <button
                type="button"
                className="block min-w-0 max-w-full text-left font-semibold text-text-1 hover:underline break-words [overflow-wrap:anywhere]"
                onClick={() => onApriLink(p.link!)}
              >
                {p.testo}
              </button>
            ) : (
              <p className="font-semibold text-text-1 break-words [overflow-wrap:anywhere]">
                {p.testo}
              </p>
            )}
            <p className="text-text-3 break-words [overflow-wrap:anywhere]">
              «{p.richiestaPerTars}»
            </p>
          </div>
          <Button
            size="icon"
            variant="outline"
            className="size-9 shrink-0"
            aria-label="Chiedi a Tars di farlo"
            title="Chiedi a Tars"
            onClick={() => onSuggerimento(p.richiestaPerTars)}
          >
            <MessageSquarePlus className="size-4" />
          </Button>
        </li>
      ))}
    </ul>
  );
}
