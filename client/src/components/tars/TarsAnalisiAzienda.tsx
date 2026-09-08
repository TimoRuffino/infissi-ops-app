// Analisi azienda di Tars (02/09/2026): la sintesi giornaliera della
// direzione sulla pagina Tars. Il server è il confine (flag, direzione,
// sede); qui si legge e basta.
//
// Dall'08/09 (PRD §62) i consigli dell'analisi si decidono nella coda delle
// Proposte, insieme a tutto il resto, e da lì si rigenera l'analisi: qui
// restano la lettura (`useAnalisiAzienda`) e la sintesi che apre una
// conversazione nuova.
import { trpc } from "@/lib/trpc";
import { Brain } from "lucide-react";
import { toast } from "sonner";

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
    analisiId: record?.id ?? null,
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
