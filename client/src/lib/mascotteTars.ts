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
 *             vendere, non un segnale collegato allo stato del CRM. Esce più
 *             spesso delle altre: v. COPIE_CARTELLO
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
 * Cosa scaricare subito. Le clip pesano 4,2 MB in tutto: precaricarle tutte
 * all'apertura sarebbe uno spreco in uno strumento che resta aperto tutto il
 * giorno. Servono le due pose a riposo e i siparietti già estratti — quelli
 * vengono scaldati a parte, prima che il timer li chiami.
 *
 * In arrivo se ne tengono due e non uno: con pause da pochi secondi una
 * clip sola non fa in tempo a scaricarsi, e una clip non pronta lascia Tars
 * fermo sul primo fotogramma finché non scatta la rete di sicurezza.
 */
export function vaPrecaricata(
  posa: PosaMascotte,
  inArrivo: readonly PosaMascotte[],
): boolean {
  return vaInLoop(posa) || inArrivo.includes(posa);
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
 * Quante carte ha il cartello «FATTURARE» in un giro. Tre invece di una: è
 * la battuta che si vuole rivedere, e con una carta sola usciva quanto le
 * altre otto. Mai due di fila, però — v. `giroNuovo`.
 */
export const COPIE_CARTELLO = 3;

/** Le clip di un giro completo: otto siparietti più le copie del cartello. */
export const LUNGHEZZA_GIRO = POSE_OCCASIONALI.length - 1 + COPIE_CARTELLO;

/**
 * Il mazzo dei siparietti: escono a giro, in ordine mescolato, e prima che
 * uno si ripeta devono essersi viste tutte le altre clip.
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
  const altre = mescola(
    POSE_OCCASIONALI.filter(p => p !== "cartello"),
    sorteggio,
  );
  // Il cartello entra in spazi distinti fra le altre pose. Spazi distinti
  // vuol dire che fra due cartelli c'è sempre almeno un'altra clip, senza
  // bisogno di ricucire l'ordine dopo averlo mescolato. Se il giro prima si
  // è chiuso su un cartello, lo spazio in testa non è disponibile.
  const spazi = scegliSpazi(
    altre.length + 1,
    COPIE_CARTELLO,
    ultimo === "cartello",
    sorteggio,
  );
  const carte: PosaOccasionale[] = [];
  for (let i = 0; i <= altre.length; i++) {
    if (spazi.has(i)) carte.push("cartello");
    if (i < altre.length) carte.push(altre[i]);
  }
  // La cucitura fra un giro e l'altro è l'unico punto dove un doppione
  // ravvicinato può ancora nascere: se il giro nuovo ricomincia da chi ha
  // chiuso il precedente, lo si scambia con quello dopo. Lo scambio è
  // sicuro anche coi cartelli: quello che sale in testa si lascia dietro
  // una posa diversa prima della copia successiva.
  if (carte.length > 1 && carte[0] === ultimo) {
    [carte[0], carte[1]] = [carte[1], carte[0]];
  }
  return carte;
}

/**
 * Sceglie `quante` posizioni distinte fra gli spazi disponibili: è la
 * distinzione a tenere separate le copie del cartello.
 */
function scegliSpazi(
  quantiSpazi: number,
  quante: number,
  senzaIlPrimo: boolean,
  sorteggio: () => number,
): Set<number> {
  const spazi: number[] = [];
  for (let i = senzaIlPrimo ? 1 : 0; i < quantiSpazi; i++) spazi.push(i);
  return new Set(mescola(spazi, sorteggio).slice(0, quante));
}

/** Fisher-Yates: ogni ordine ha la stessa probabilità di uscire. */
function mescola<T>(carte: readonly T[], sorteggio: () => number): T[] {
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
