// `verifica()` è una prova viva: chiama il fornitore. Un doppio click non
// deve diventare due chiamate, e la pagina non deve poter trasformare
// un'attesa in una raffica.
//
// In memoria e per processo: è un ammortizzatore, non una fonte di verità.
// Un errore non entra in cache — un guasto va riprovato subito, non fra
// un minuto.

import type { Chiave, Problema } from "./contratto";

const TTL_MS = 60_000;

const voci = new Map<string, { al: number; esito: Problema | null }>();

export async function verificaConCache(
  chiave: Chiave,
  sedeId: number | null,
  sonda: () => Promise<Problema | null>
): Promise<Problema | null> {
  const k = `${chiave}:${sedeId ?? "azienda"}`;
  const v = voci.get(k);
  if (v && Date.now() - v.al < TTL_MS) return v.esito;
  const esito = await sonda();
  voci.set(k, { al: Date.now(), esito });
  return esito;
}

export function __svuotaCachePerTest(): void {
  voci.clear();
}
