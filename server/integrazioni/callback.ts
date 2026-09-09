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

import type { Problema } from "./contratto";

export function callbackCanonico(nome: string): string {
  const url = process.env[nome]?.trim();
  if (!url) {
    throw new Error(
      `Callback di piattaforma assente: imposta ${nome} sul server prima di collegare.`
    );
  }
  return url;
}

export function callbackConfigurato(nome: string): boolean {
  return !!process.env[nome]?.trim();
}

// `stato()` gira sei volte a ogni caricamento della pagina: un `console.warn`
// per chiamata riempirebbe i log di righe identiche. Il guasto è di
// configurazione — non cambia da solo — quindi si dice una volta per
// processo, che è quello che serve a chi guarda il boot.
const giaDetto = new Set<string>();

/**
 * Il guasto è nostro, non del cliente: non c'è nessun gesto che possa fare.
 * Nome della variabile nel log, mai nella risposta; e il valore di un
 * segreto non entra né nell'uno né nell'altra (spec §6, §9).
 */
export function problemaDiPiattaforma(
  fornitore: string,
  cosaManca: string
): Problema {
  if (!giaDetto.has(cosaManca)) {
    giaDetto.add(cosaManca);
    console.warn(
      `[integrazioni] collegamento a ${fornitore} non offerto: manca ${cosaManca} sul server.`
    );
  }
  return {
    causa: `Il collegamento a ${fornitore} non è ancora configurato sulla piattaforma.`,
    rimedio:
      "Non serve nessuna azione da parte tua: scrivi a chi gestisce Wyndoor e verrà attivato.",
    azione: "assistenza",
  };
}

export function __svuotaAvvisiPerTest(): void {
  giaDetto.clear();
}
