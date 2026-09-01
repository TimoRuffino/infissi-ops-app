// Identità visiva di Tars: la mascotte, ferma e tonda, dove serve riconoscere
// chi parla. È la stessa figura che si muove nella shell (mascotteTars.ts):
// due volti diversi per lo stesso agente sulla stessa schermata sarebbero un
// errore di identità, non una scelta di stile.
//
// Gli asset sono statici sotto `client/public/mascotte`: nessun campo server,
// nessuna query aggiuntiva, stessa convenzione di `lib/avatars.ts` per il team.
//
// Qui stanno solo le parti con una scelta — quale sorgente, come si dice a
// parole lo stato, con che token si colora l'anello — perché i test del
// progetto girano su node: in `lib` si verificano, dentro un .tsx no.

export type StatoTarsAvatar =
  | "disponibile"
  | "in_lavoro"
  | "degradato"
  | "spento";

/**
 * Ritaglio quadrato e trasparente della mascotte a figura intera. Il margine
 * è già nell'immagine perché la maschera tonda non tagli antenne né piedi:
 * non va ritagliata di nuovo lato CSS.
 */
export const AVATAR_TARS_SRC = "/mascotte/avatar-256.png";

/** Il 512 serve solo ai display ad alta densità, come per gli avatar del team. */
export const AVATAR_TARS_SRCSET =
  "/mascotte/avatar-256.png 1x, /mascotte/avatar-512.png 2x";

const ETICHETTA_STATO: Record<StatoTarsAvatar, string> = {
  disponibile: "Disponibile",
  in_lavoro: "In lavorazione",
  degradato: "Operatività ridotta",
  spento: "Disattivato",
};

/** Lo stato detto a parole: il colore non è mai l'unico portatore. */
export function etichettaStatoTars(stato: StatoTarsAvatar): string {
  return ETICHETTA_STATO[stato];
}

/**
 * Anello di stato attorno all'avatar. Un anello e non un pallino sovrapposto:
 * il pallino andrebbe stuccato con la tinta della superficie sottostante, che
 * qui cambia (card della conversazione, workspace delle pagine di stato).
 *
 * Nessuna animazione: quando Tars lavora il thread mostra già «Tars sta
 * lavorando…» con il suo indicatore, e un avatar che pulsa tutto il giorno in
 * uno strumento operativo è decorazione.
 */
export function classeAnelloTars(stato: StatoTarsAvatar | null): string {
  switch (stato) {
    case "disponibile":
      return "ring-2 ring-success";
    case "in_lavoro":
      return "ring-2 ring-primary";
    case "degradato":
      return "ring-2 ring-warning";
    case "spento":
      return "ring-2 ring-border-strong opacity-60";
    default:
      // Senza stato l'avatar è solo identità: è il caso dei turni, dove lo
      // stato corrente dell'agente non descrive un messaggio già scritto.
      return "ring-1 ring-border-soft";
  }
}
