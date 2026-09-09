// `verifica()` è una prova viva: chiama il fornitore. Un doppio click non
// deve diventare due chiamate, e la pagina non deve poter trasformare
// un'attesa in una raffica.
//
// In memoria e per processo: è un ammortizzatore, non una fonte di verità.
// Un errore non entra in cache — un guasto va riprovato subito, non fra
// un minuto.
//
// La chiave porta SEMPRE l'azienda, prima ancora della sede. Gli adattatori
// ad ambito azienda (backup, agente) non hanno una sede che li distingua:
// senza il tenant, `backup:azienda` sarebbe una voce sola per tutta
// l'installazione e l'esito di un cliente finirebbe nella pagina di un
// altro. Il processo è uno per tutte le aziende: qui il confine va scritto
// a mano, perché non c'è nessuno store per tenant a farlo.

import type { Chiave, Problema } from "./contratto";

const TTL_MS = 60_000;

const voci = new Map<string, { al: number; esito: Problema | null }>();

function chiaveCache(
  tenantId: number | null,
  chiave: Chiave,
  sedeId: number | null
): string {
  return `${tenantId ?? "senza-azienda"}:${chiave}:${sedeId ?? "azienda"}`;
}

export async function verificaConCache(
  tenantId: number | null,
  chiave: Chiave,
  sedeId: number | null,
  sonda: () => Promise<Problema | null>
): Promise<Problema | null> {
  const k = chiaveCache(tenantId, chiave, sedeId);
  const v = voci.get(k);
  if (v && Date.now() - v.al < TTL_MS) return v.esito;
  const esito = await sonda();
  voci.set(k, { al: Date.now(), esito });
  return esito;
}

/**
 * Collegare, completare o scollegare cambia la verità: l'esito di un minuto
 * fa direbbe «ancora rotto» a chi ha appena rimediato. Si butta via la voce
 * di quella chiave, per quell'azienda: le altre non c'entrano.
 */
export function invalidaVerifica(
  tenantId: number | null,
  chiave: Chiave,
  sedeId: number | null
): void {
  voci.delete(chiaveCache(tenantId, chiave, sedeId));
}

export function __svuotaCachePerTest(): void {
  voci.clear();
}
