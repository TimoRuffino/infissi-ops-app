// Il callback OAuth appartiene alla PIATTAFORMA, non all'host da cui il
// cliente naviga (WS5, spec §6).
//
// `fattureInCloud.ts` lo ricava da `req.get("host")` quando la variabile
// manca. Con un'installazione e un host solo funziona; il giorno in cui
// un'azienda arriva da un host diverso il redirect cambia, il provider lo
// rifiuta perché non è pre-registrato, e il messaggio che il cliente legge
// è del provider, non nostro.
//
// Qui il ripiego non esiste: senza variabile non si offre il collegamento.

export function callbackCanonico(nome: string): string {
  const url = process.env[nome]?.trim();
  if (!url) {
    throw new Error(
      `Callback di piattaforma assente: imposta ${nome} sul server prima di collegare.`
    );
  }
  return url;
}
