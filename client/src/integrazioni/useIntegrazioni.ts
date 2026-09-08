import { trpc } from "@/lib/trpc";

/**
 * L'elenco costa poco: `stato()` lato server non chiama nessun fornitore.
 * La prova viva è una mutation, perché è un'azione della persona — e
 * perché non deve partire da sola a ogni montaggio della pagina.
 */
export function useIntegrazioni() {
  const elenco = trpc.integrazioni.elenco.useQuery(undefined, {
    staleTime: 30_000,
  });
  const verifica = trpc.integrazioni.verifica.useMutation();
  const avvia = trpc.integrazioni.avvia.useMutation();

  return {
    stati: elenco.data ?? [],
    inCaricamento: elenco.isLoading,
    ricarica: () => elenco.refetch(),
    verifica,
    avvia,
  };
}
