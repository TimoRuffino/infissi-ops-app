// Disposizione dei blocchi su una griglia oraria.
//
// La vecchia settimana era una lista per giorno: un rilievo di mezz'ora e una
// posa di nove ore occupavano lo stesso spazio, quindi guardare il calendario
// non diceva se la giornata fosse piena. Qui l'altezza di un blocco È la sua
// durata, e due lavori che si accavallano stanno affiancati invece che uno
// sotto l'altro. Da quello si legge, senza contare niente, quanto resta libero.
//
// Tutto quello che serve per farlo è aritmetica su minuti, quindi vive qui e
// non dentro un componente: si prova senza montare React.

/** Minuti dalla mezzanotte, oppure null se l'ora non è utilizzabile. */
export function minutiDaOra(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const ore = Number(m[1]);
  const minuti = Number(m[2]);
  if (ore > 23 || minuti > 59) return null;
  return ore * 60 + minuti;
}

export function oraDaMinuti(minuti: number): string {
  const h = Math.floor(minuti / 60) % 24;
  const m = Math.round(minuti) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Durata di default quando manca l'ora di fine. Un appuntamento senza fine
 * esiste davvero (lo si segna al volo), e disegnarlo alto zero lo farebbe
 * sparire: un'ora è la lunghezza tipica di un rilievo.
 */
export const DURATA_PREDEFINITA_MIN = 60;

/** Sotto questa altezza il testo non ci sta: il blocco si disegna più alto. */
export const DURATA_MINIMA_VISIVA_MIN = 30;

export type EventoOrario = {
  id: string | number;
  inizio: string | null | undefined;
  fine?: string | null;
};

export type IntervalloMinuti = { inizioMin: number; fineMin: number };

/**
 * Inizio e fine in minuti, con i buchi riempiti e i dati storti raddrizzati.
 * Torna null solo quando manca l'ora di inizio: quello non è un blocco della
 * griglia, è un appuntamento senza orario e va altrove.
 */
export function intervalloDi(evento: EventoOrario): IntervalloMinuti | null {
  const inizioMin = minutiDaOra(evento.inizio);
  if (inizioMin == null) return null;
  const fineGrezza = minutiDaOra(evento.fine);
  // Una fine prima dell'inizio è un dato sbagliato, non un evento che torna
  // indietro nel tempo: si tratta come «fine mancante».
  const fineMin =
    fineGrezza != null && fineGrezza > inizioMin
      ? fineGrezza
      : inizioMin + DURATA_PREDEFINITA_MIN;
  return { inizioMin, fineMin };
}

export const ORA_APERTURA_MIN = 7 * 60;
export const ORA_CHIUSURA_MIN = 19 * 60;

export type FinestraOraria = { daMin: number; aMin: number };

/**
 * L'intervallo di ore da disegnare.
 *
 * Parte dalla giornata lavorativa (7-19) invece che dalla mezzanotte: dodici
 * ore di griglia vuota per far vedere un intervento alle 15 sono dodici ore in
 * cui il blocco è troppo piccolo per leggerlo. Se però qualcosa cade fuori —
 * una posa che finisce alle 20, un ritiro alle 6 — la finestra si allarga fino
 * a contenerlo, arrotondata all'ora.
 */
export function finestraOraria(
  eventi: readonly EventoOrario[]
): FinestraOraria {
  let daMin = ORA_APERTURA_MIN;
  let aMin = ORA_CHIUSURA_MIN;
  for (const evento of eventi) {
    const intervallo = intervalloDi(evento);
    if (!intervallo) continue;
    daMin = Math.min(daMin, Math.floor(intervallo.inizioMin / 60) * 60);
    aMin = Math.max(aMin, Math.ceil(intervallo.fineMin / 60) * 60);
  }
  return { daMin, aMin: Math.min(aMin, 24 * 60) };
}

/** Le ore intere da etichettare sull'asse. */
export function oreDellaFinestra(finestra: FinestraOraria): number[] {
  const ore: number[] = [];
  for (let m = finestra.daMin; m <= finestra.aMin; m += 60) ore.push(m);
  return ore;
}

export type BloccoDisposto<T> = {
  evento: T;
  inizioMin: number;
  fineMin: number;
  /** Colonna occupata dentro il proprio gruppo di sovrapposti, da 0. */
  colonna: number;
  /** Quante colonne ha il gruppo: la larghezza è 1/colonne. */
  colonne: number;
};

/**
 * Assegna una colonna a ogni blocco perché i sovrapposti stiano affiancati.
 *
 * Due lavori nella stessa fascia oraria non possono stare uno sopra l'altro
 * senza nascondersi. Si raggruppano quelli che si toccano (anche in catena: A
 * tocca B, B tocca C, quindi tutti e tre condividono la larghezza) e dentro
 * ogni gruppo ognuno prende la prima colonna libera.
 *
 * L'ordine dei blocchi in uscita è quello di inizio, poi durata decrescente:
 * il lavoro lungo sta a sinistra, i brevi gli si affiancano a destra.
 */
export function disponiSovrapposti<T extends EventoOrario>(
  eventi: readonly T[]
): BloccoDisposto<T>[] {
  const conIntervallo = eventi
    .map(evento => ({ evento, intervallo: intervalloDi(evento) }))
    .filter(
      (x): x is { evento: T; intervallo: IntervalloMinuti } =>
        x.intervallo != null
    )
    .sort((a, b) => {
      if (a.intervallo.inizioMin !== b.intervallo.inizioMin) {
        return a.intervallo.inizioMin - b.intervallo.inizioMin;
      }
      // A parità di inizio, prima il più lungo.
      return b.intervallo.fineMin - a.intervallo.fineMin;
    });

  const disposti: BloccoDisposto<T>[] = [];
  // Un gruppo resta aperto finché arriva qualcosa che comincia prima della
  // fine più lontana vista finora.
  let gruppo: BloccoDisposto<T>[] = [];
  let fineGruppo = -1;
  // Per ogni colonna del gruppo, quando si libera.
  let fineColonne: number[] = [];

  const chiudiGruppo = () => {
    const colonne = fineColonne.length;
    for (const blocco of gruppo) blocco.colonne = colonne;
    disposti.push(...gruppo);
    gruppo = [];
    fineColonne = [];
    fineGruppo = -1;
  };

  for (const { evento, intervallo } of conIntervallo) {
    if (gruppo.length > 0 && intervallo.inizioMin >= fineGruppo) chiudiGruppo();
    // La prima colonna che si è già liberata; altrimenti una nuova.
    let colonna = fineColonne.findIndex(fine => fine <= intervallo.inizioMin);
    if (colonna === -1) {
      colonna = fineColonne.length;
      fineColonne.push(intervallo.fineMin);
    } else {
      fineColonne[colonna] = intervallo.fineMin;
    }
    gruppo.push({
      evento,
      inizioMin: intervallo.inizioMin,
      fineMin: intervallo.fineMin,
      colonna,
      colonne: 1,
    });
    fineGruppo = Math.max(fineGruppo, intervallo.fineMin);
  }
  if (gruppo.length > 0) chiudiGruppo();
  return disposti;
}

export type PosizioneBlocco = {
  /** Percentuali sull'altezza della griglia, pronte per lo stile. */
  topPct: number;
  altezzaPct: number;
  sinistraPct: number;
  larghezzaPct: number;
};

/**
 * Dove sta un blocco dentro la griglia, in percentuale.
 *
 * L'altezza segue la durata vera, con un minimo: un intervento di dieci minuti
 * disegnato a dieci minuti sarebbe una riga di due pixel, illeggibile e
 * impossibile da cliccare. Chi ha bisogno della durata esatta la legge
 * nell'orario, che c'è sempre.
 */
export function posizioneBlocco<T>(
  blocco: BloccoDisposto<T>,
  finestra: FinestraOraria
): PosizioneBlocco {
  const totale = Math.max(1, finestra.aMin - finestra.daMin);
  const inizio = Math.max(blocco.inizioMin, finestra.daMin);
  const fine = Math.min(blocco.fineMin, finestra.aMin);
  const durataVisiva = Math.max(fine - inizio, DURATA_MINIMA_VISIVA_MIN);
  const topPct = ((inizio - finestra.daMin) / totale) * 100;
  // Un blocco non deve sporgere sotto la griglia per colpa del minimo visivo.
  const altezzaPct = Math.min((durataVisiva / totale) * 100, 100 - topPct);
  // Dividere in parti uguali funziona fino a due colonne. Da tre in su, in
  // una colonna della settimana da ~160px, un terzo sono 53px: il blocco
  // esiste ma non dice più niente — un righello colorato muto. Sotto il
  // mezzo, i blocchi si accavallano a cascata come su un calendario di
  // carta: ognuno resta largo abbastanza da leggersi, quello dopo copre in
  // parte quello prima, e chi sta sotto si riconosce comunque dal bordo.
  const larghezzaPct = Math.max((1 / blocco.colonne) * 100, LARGHEZZA_MINIMA_PCT);
  const passoPct =
    blocco.colonne > 1 ? (100 - larghezzaPct) / (blocco.colonne - 1) : 0;
  return {
    topPct,
    altezzaPct,
    sinistraPct: blocco.colonna * passoPct,
    larghezzaPct,
  };
}

/** Sotto questa larghezza un blocco è un righello muto: meglio accavallare. */
export const LARGHEZZA_MINIMA_PCT = 55;

/**
 * Quanto è carica una giornata, da 0 a 1, sulle ore lavorative.
 *
 * Serve alla barretta sotto il numero del giorno nella vista mese: dice se il
 * giorno è pieno senza costringere ad aprirlo. Le sovrapposizioni non contano
 * due volte — due squadre diverse in contemporanea riempiono la giornata una
 * volta sola, non due.
 */
export function caricoGiornata(eventi: readonly EventoOrario[]): number {
  const intervalli = eventi
    .map(intervalloDi)
    .filter((x): x is IntervalloMinuti => x != null)
    .sort((a, b) => a.inizioMin - b.inizioMin);
  if (intervalli.length === 0) return 0;
  let occupati = 0;
  let fineCorrente = -1;
  let inizioCorrente = -1;
  for (const { inizioMin, fineMin } of intervalli) {
    if (inizioMin > fineCorrente) {
      if (fineCorrente > inizioCorrente) occupati += fineCorrente - inizioCorrente;
      inizioCorrente = inizioMin;
      fineCorrente = fineMin;
    } else {
      fineCorrente = Math.max(fineCorrente, fineMin);
    }
  }
  if (fineCorrente > inizioCorrente) occupati += fineCorrente - inizioCorrente;
  const giornata = ORA_CHIUSURA_MIN - ORA_APERTURA_MIN;
  return Math.min(1, occupati / giornata);
}
