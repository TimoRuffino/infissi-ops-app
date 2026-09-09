import { trpc } from "@/lib/trpc";
import { vistaEssenziale } from "@/lib/piattaforma";

/**
 * «Lascia l'indispensabile» (direzione, 09/09/2026): un'azienda cliente vede
 * di ogni integrazione solo il collegamento, il suo stato e le azioni per
 * collegare e provare. Tutto quel che è dell'installazione — variabili del
 * server, token, percorsi a mano, contatori tecnici, diagnostica — lo vede
 * soltanto la piattaforma, cioè l'azienda che gestisce le app Meta, FiC e
 * Google. Decide l'AZIENDA della sessione, non la persona: la direzione di
 * un cliente resta direzione, ma della sua azienda.
 *
 * `tenants.mio` è una `sessionProcedure` (risponde anche a porta chiusa) e
 * finché non ha risposto la vista è quella essenziale: si scopre, non si
 * copre.
 */
export function useVistaEssenziale(): boolean {
  const mio = trpc.tenants.mio.useQuery(undefined, { staleTime: 300_000 });
  return vistaEssenziale(mio.data);
}
