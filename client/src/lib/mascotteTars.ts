// Regole della mascotte di Tars: quale posa tenere e quando parte un
// siparietto.
//
// Stanno qui e non dentro il componente perché sono l'unica parte con delle
// scelte, e i test del progetto girano su ambiente node: in `lib` si possono
// verificare, dentro un .tsx no.

export type PosaMascotte =
  | "idle"
  | "indica"
  | "evento"
  | "cartello"
  | "saluta"
  | "pensa"
  | "dorme"
  | "esulta"
  | "curioso"
  | "boxa"
  | "calcio";

/**
 * I siparietti: partono da soli ogni tanto mentre la mascotte sta ferma, si
 * giocano una volta e poi tornano a `idle`.
 *
 *   evento    inciampa, cade, si rialza e ride
 *   cartello  alza un cartello «FATTURARE» — è una battuta per ricordare di
 *             vendere, non un segnale collegato allo stato del CRM
 *   saluta    alza il braccio e saluta
 *   pensa     inclina la testa e riflette, poi annuisce
 *   dorme     si appisola e si sveglia di soprassalto
 *   esulta    saltello con le braccia in alto
 *   curioso   si sporge in avanti a sbirciare
 *   boxa      finge due pugni a vuoto
 *   calcio    tira un calcio a vuoto
 *
 * Tutti nascono dallo stesso render in piedi e ci tornano in coda: è questo
 * che permette di incatenarli senza salti.
 */
export const POSE_OCCASIONALI = [
  "evento",
  "cartello",
  "saluta",
  "pensa",
  "dorme",
  "esulta",
  "curioso",
  "boxa",
  "calcio",
] as const;

/**
 * Tutte le pose, nell'ordine in cui vanno montate. Stanno insieme nel DOM e
 * si scambia solo quale è in vista: montarne una alla volta costringeva il
 * browser a caricare la clip nuova a ogni cambio, con un buco visibile.
 */
export const POSE_TUTTE = [
  "idle",
  "indica",
  ...POSE_OCCASIONALI,
] as const satisfies readonly PosaMascotte[];

/**
 * Cosa scaricare subito. Le clip pesano 3,3 MB in tutto: precaricarle tutte
 * all'apertura sarebbe uno spreco in uno strumento che resta aperto tutto il
 * giorno. Servono solo le due pose a riposo — il siparietto in arrivo viene
 * scaldato a parte, con largo anticipo sul timer.
 */
export function vaPrecaricata(
  posa: PosaMascotte,
  prossimoSiparietto: PosaMascotte | null,
): boolean {
  return vaInLoop(posa) || posa === prossimoSiparietto;
}

/**
 * Le pose a riposo girano in loop; i siparietti si giocano una volta sola.
 * idle e indica sono montate ad andirivieni, quindi il loop non ha cucitura.
 */
export function vaInLoop(posa: PosaMascotte): boolean {
  return posa === "idle" || posa === "indica";
}

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
