// La selezione delle consegne da segnare ricevute (pagina Fornitori,
// vista «In arrivo»).
//
// Sta qui, fuori dal componente, per una ragione precisa: la prima versione
// teneva la selezione allineata con un `useEffect` che riscriveva lo stato a
// ogni render («Maximum update depth exceeded», React #185, in produzione il
// 07/09/2026). Una selezione non si sincronizza: si DERIVA dall'elenco che
// si ha davanti, e le spunte che non esistono più cadono da sole.

export type ConsegnaSelezionabile = { prodottoId: number; arrivato: boolean };

/**
 * Gli id spuntati che hanno ancora una consegna aperta nell'elenco: quello
 * che si segna ricevuto è sempre e solo ciò che si sta guardando.
 */
export function selezioneValida(
  segnate: readonly number[],
  consegne: readonly ConsegnaSelezionabile[]
): number[] {
  if (segnate.length === 0) return [];
  const aperte = new Set(consegne.filter(c => !c.arrivato).map(c => c.prodottoId));
  return segnate.filter(id => aperte.has(id));
}
