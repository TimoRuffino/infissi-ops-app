// Un'integrazione che si rompe non ne annulla altre cinque (spec §5 e §9:
// «un errore di una singola integrazione non annulla il tenant»).
//
// `stato()` è sola lettura, ma legge store, configurazioni e chiavi: può
// lanciare. Con `Promise.all` bastava un adattatore per far sparire l'intero
// elenco — la pagina Impostazioni restava vuota e il cliente non poteva
// nemmeno vedere quali collegamenti fossero a posto. Qui il guasto diventa
// lo stato di quella riga, e le altre restano.

import type { Adattatore, Problema, Stato } from "./contratto";

/** Quanto di un errore può finire sotto gli occhi del cliente. */
const MAX = 120;

// Token, chiavi e firme sono lunghe sequenze senza spazi: qualunque cosa
// somigli a una credenziale esce dal messaggio prima di essere mostrata o
// registrata. Meglio una frase con un buco che un segreto in una schermata.
const SEMBRA_UN_SEGRETO = /[A-Za-z0-9_\-.]{24,}/g;

export function messaggioBreve(e: unknown): string {
  const grezzo =
    e instanceof Error ? e.message : typeof e === "string" ? e : "";
  const primaRiga = grezzo.split("\n")[0]?.trim() ?? "";
  const ripulito = primaRiga.replace(SEMBRA_UN_SEGRETO, "…").trim();
  if (!ripulito) return "guasto non descritto";
  return ripulito.length > MAX ? `${ripulito.slice(0, MAX - 1).trimEnd()}…` : ripulito;
}

/** Il guasto è nostro: al cliente non si chiede di rifare niente. */
export function problemaNonDisponibile(e: unknown): Problema {
  return {
    causa: `Stato non disponibile: ${messaggioBreve(e)}`,
    rimedio:
      "Le altre integrazioni funzionano. Riprova fra poco; se resta così, scrivi a chi gestisce Wyndoor.",
    azione: "assistenza",
  };
}

/**
 * Lo stato di ripiego di un adattatore che ha lanciato: dichiara di non
 * sapere, invece di dichiarare «non collegato» — che sarebbe una risposta,
 * e sbagliata.
 */
export function statoNonDisponibile(a: Adattatore, e: unknown): Stato {
  console.warn(
    `[integrazioni] stato di ${a.chiave} non disponibile: ${messaggioBreve(e)}`
  );
  return {
    chiave: a.chiave,
    ambito: a.ambito,
    collegato: false,
    soggetto: null,
    verificatoIl: null,
    problema: problemaNonDisponibile(e),
  };
}

/**
 * Gli stati di tutti gli adattatori, uno per uno: chi lancia diventa il suo
 * stato di ripiego, gli altri arrivano interi.
 */
export async function statiDiTutti(
  adattatori: Adattatore[],
  leggi: (a: Adattatore) => Promise<Stato>
): Promise<Stato[]> {
  const esiti = await Promise.allSettled(adattatori.map(a => leggi(a)));
  return esiti.map((e, i) =>
    e.status === "fulfilled"
      ? e.value
      : statoNonDisponibile(adattatori[i], e.reason)
  );
}
