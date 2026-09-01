// Regole della mascotte di Tars: quale posa tenere e quando parte un
// siparietto.
//
// Stanno qui e non dentro il componente perché sono l'unica parte con delle
// scelte, e i test del progetto girano su ambiente node: in `lib` si possono
// verificare, dentro un .tsx no.

export type PosaMascotte = "idle" | "evento" | "cartello" | "indica";

/**
 * I siparietti: partono da soli ogni tanto mentre la mascotte sta ferma, si
 * giocano una volta e poi tornano a `idle`.
 *
 *   evento    inciampa, cade, si rialza e ride
 *   cartello  alza un cartello «FATTURARE» — è una battuta per ricordare di
 *             vendere, non un segnale collegato allo stato del CRM
 */
export const POSE_OCCASIONALI = ["evento", "cartello"] as const;

export type PosaOccasionale = (typeof POSE_OCCASIONALI)[number];

/**
 * Sceglie il siparietto da giocare. Prende il sorteggio da fuori (0 ≤ n < 1)
 * invece di chiamare Math.random da sé, così la scelta è verificabile.
 */
export function scegliSiparietto(sorteggio: number): PosaOccasionale {
  const i = Math.floor(sorteggio * POSE_OCCASIONALI.length);
  return POSE_OCCASIONALI[Math.min(Math.max(i, 0), POSE_OCCASIONALI.length - 1)];
}

/**
 * Un siparietto parte solo dalla posa neutra: a pannello aperto la mascotte
 * deve restare ferma a indicarlo, e con `prefers-reduced-motion` non parte
 * mai nulla.
 */
export function puoPartireSiparietto(
  posa: PosaMascotte,
  attiva: boolean,
  movimentoRidotto: boolean,
): boolean {
  return !attiva && !movimentoRidotto && posa === "idle";
}

/** Posa da tenere quando non è in corso un siparietto. */
export function posaARiposo(attiva: boolean): PosaMascotte {
  return attiva ? "indica" : "idle";
}

export function etichettaMascotte(aperto: boolean): string {
  return aperto ? "Chiudi la domanda rapida a Tars" : "Chiedi a Tars";
}

/**
 * Solo `indica` va specchiata: la clip nasce col braccio teso a destra, ma
 * con la mascotte in basso a destra il pannello si apre a sinistra.
 * Specchiare `cartello` scriverebbe FATTURARE al contrario.
 */
export function vaSpecchiata(posa: PosaMascotte): boolean {
  return posa === "indica";
}

/** Il poster fermo per `prefers-reduced-motion`: i siparietti non ne hanno uno. */
export function posterDi(posa: PosaMascotte): "idle" | "indica" {
  return posa === "indica" ? "indica" : "idle";
}
