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

/** Un siparietto, o una delle due pose a riposo? */
export function eSiparietto(posa: PosaMascotte): posa is PosaOccasionale {
  return !vaInLoop(posa);
}

/**
 * Il mazzo dei siparietti: i nove escono a giro, in ordine mescolato, e
 * prima che uno si ripeta devono essersi visti tutti gli altri.
 *
 * Serve perché il sorteggio libero rimetteva in gioco subito la clip appena
 * vista. Con nove pose due estrazioni di fila coincidono una volta su nove,
 * e dopo cinque un doppione è più probabile che no: chi teneva aperto il
 * CRM vedeva la stessa caduta due volte in pochi minuti e la mascotte
 * sembrava avere un numero solo.
 */
export type MazzoSiparietti = {
  /** Il giro in corso, in ordine di uscita. */
  readonly daGiocare: readonly PosaOccasionale[];
  /** L'ultimo uscito: il giro nuovo non può ricominciare da lui. */
  readonly ultimo: PosaOccasionale | null;
};

/** Mazzo da mescolare al primo giro. */
export const MAZZO_NUOVO: MazzoSiparietti = { daGiocare: [], ultimo: null };

export type EstrazioneSiparietto = {
  readonly posa: PosaOccasionale;
  readonly mazzo: MazzoSiparietti;
};

/**
 * Estrae il prossimo siparietto e rende il mazzo che resta. Il sorteggio
 * arriva da fuori (una funzione che dà 0 ≤ n < 1) invece di chiamare
 * Math.random da sé, così l'ordine è verificabile.
 */
export function pescaSiparietto(
  mazzo: MazzoSiparietti,
  sorteggio: () => number,
): EstrazioneSiparietto {
  const giro =
    mazzo.daGiocare.length > 0
      ? mazzo.daGiocare
      : giroNuovo(mazzo.ultimo, sorteggio);
  const [posa, ...restanti] = giro;
  return { posa, mazzo: { daGiocare: restanti, ultimo: posa } };
}

function giroNuovo(
  ultimo: PosaOccasionale | null,
  sorteggio: () => number,
): PosaOccasionale[] {
  const carte = mescola(POSE_OCCASIONALI, sorteggio);
  // La cucitura fra un giro e l'altro è l'unico punto dove un doppione
  // ravvicinato può ancora nascere: se il giro nuovo ricomincia da chi ha
  // chiuso il precedente, lo si scambia con quello dopo.
  if (carte.length > 1 && carte[0] === ultimo) {
    [carte[0], carte[1]] = [carte[1], carte[0]];
  }
  return carte;
}

/** Fisher-Yates: ogni ordine ha la stessa probabilità di uscire. */
function mescola(
  carte: readonly PosaOccasionale[],
  sorteggio: () => number,
): PosaOccasionale[] {
  const m = [...carte];
  for (let i = m.length - 1; i > 0; i--) {
    // Il limite regge un sorteggio che dia esattamente 1: Math.random non
    // ci arriva, ma uno scambio fuori indice lascerebbe un `undefined` che
    // il componente passerebbe come src del video.
    const j = Math.min(Math.floor(sorteggio() * (i + 1)), i);
    [m[i], m[j]] = [m[j], m[i]];
  }
  return m;
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
