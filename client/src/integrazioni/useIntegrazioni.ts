import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

/** Quel che il server risponde a `avvia`: un URL, un popup o un modulo. */
export type Avvio =
  | { tipo: "url"; url: string }
  | { tipo: "popup"; configId: string }
  | { tipo: "modulo" };

/**
 * L'elenco costa poco: `stato()` lato server non chiama nessun fornitore.
 * La prova viva è una mutation, perché è un'azione della persona — e
 * perché non deve partire da sola a ogni montaggio della pagina.
 */
export function useIntegrazioni() {
  const elenco = trpc.integrazioni.elenco.useQuery(undefined, {
    staleTime: 30_000,
  });
  // Un avvio che fallisce lo dice: senza `onError` la promessa restava non
  // gestita e il cliente premeva «Collega» guardando una pagina che non si
  // muoveva.
  const avvia = trpc.integrazioni.avvia.useMutation({
    onError: e => toast.error(e.message || "Collegamento non avviato."),
  });
  const verifica = trpc.integrazioni.verifica.useMutation({
    onError: e => toast.error(e.message || "Prova non riuscita."),
  });

  /**
   * Avvia il collegamento e riporta l'esito. L'URL porta via dalla pagina;
   * popup e modulo li gestisce chi chiama, perché sa dove vive il modulo.
   * `null` significa «è già stato detto all'utente»: non c'è niente da fare.
   */
  const collega = async (chiave: string): Promise<Avvio | null> => {
    try {
      const esito = (await avvia.mutateAsync({
        chiave: chiave as never,
      })) as Avvio;
      if (esito.tipo === "url") {
        window.location.href = esito.url;
        return null;
      }
      return esito;
    } catch {
      // Il messaggio l'ha già mostrato `onError`: qui si evita solo che la
      // promessa risalga non gestita.
      return null;
    }
  };

  return {
    stati: elenco.data ?? [],
    inCaricamento: elenco.isLoading,
    ricarica: () => elenco.refetch(),
    verifica,
    avvia,
    collega,
  };
}
