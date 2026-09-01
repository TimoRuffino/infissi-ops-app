// Riconoscimento e risoluzione dei riferimenti citati nelle risposte di Tars.
//
// Il testo della risposta è dato non fidato: può citare un codice inesistente,
// di un'altra sede o inventato di sana pianta. Qui si separano nettamente due
// passi, e solo il secondo autorizza un link:
//
//  1. RICONOSCIMENTO (`spezzaRiferimenti`) — puro, sintattico, senza dati:
//     spezza una stringa nei suoi frammenti, marcando i candidati. Un
//     candidato non è ancora niente: è solo una forma che assomiglia a un
//     riferimento.
//  2. RISOLUZIONE (`creaRisolutoreRiferimenti`) — confronta la chiave
//     normalizzata del candidato con un indice costruito ESCLUSIVAMENTE dai
//     record che la pagina ha già ricevuto dalle query sede-scoped. Se la
//     chiave non è nell'indice, la funzione restituisce `null` e il chiamante
//     lascia il testo com'è: nessun link, nessuna segnalazione, nessun
//     tooltip d'errore.
//
// Isolamento sede: l'indice non fa e non può fare lookup per conto suo, non
// accetta un id numerico e non costruisce un href da un codice non risolto.
// Le liste che lo alimentano sono filtrate dal server su `ctx.sedeId`
// (`server/routers/commesse.ts`, `server/routers/ticket.ts`): un record di
// un'altra sede non entra nel payload, quindi non entra nell'indice, quindi
// non diventa mai un link. La proprietà è strutturale, non una convenzione.
//
// Il modulo resta puro: nessuna query, nessun hook, nessun import di React.

/** Un candidato può riferirsi solo a ciò che il CRM sa aprire. */
export type GenereRiferimento = "commessa" | "ticket";

export type FrammentoTesto = {
  tipo: "testo";
  testo: string;
};

export type FrammentoRiferimento = {
  tipo: "riferimento";
  /** Il testo così come Tars l'ha scritto: a schermo resta identico. */
  testo: string;
  genere: GenereRiferimento;
  /** Forma canonica con cui si interroga l'indice (`COM-2026-184`, `TK-0037`). */
  chiave: string;
};

export type FrammentoInline = FrammentoTesto | FrammentoRiferimento;

export type DestinazioneRiferimento = {
  /** Rotta interna già esistente in `App.tsx`. */
  href: string;
  /** Nome del link, comprensibile letto fuori dal suo contesto. */
  nomeAccessibile: string;
};

export type RisolutoreRiferimenti = (
  frammento: FrammentoRiferimento
) => DestinazioneRiferimento | null;

export type CommessaRiferibile = { id: number; codice?: string | null };
export type TicketRiferibile = { id: number };

// Le tre forme riconosciute, in un'unica scansione da sinistra a destra:
//
//  - `COM-2026-184` — il formato che il server genera in
//    `server/routers/commesse.ts` (`COM-ANNO-NNN`, progressivo a 3 cifre) e
//    che `CommesseList.tsx` mostra tale e quale. La tolleranza sui separatori
//    replica gli estrattori server già in produzione
//    (`server/comunicazioni/match.ts`, `server/routers/ficMatch.ts`), così una
//    citazione un po' sciatta del modello viene normalizzata allo stesso modo.
//  - `TK-0037` — il codice ticket che `TicketList.tsx` mostra e su cui la coda
//    fa già ricerca.
//  - `#37` — la forma abbreviata (`ticket #37` o il solo `#37`).
//
// La forma `#NN` è la più ambigua delle tre: da sola non prova che si parli di
// un ticket. Non la si stringe qui con euristiche sul contesto — è la
// risoluzione a decidere, e un `#37` che non corrisponde a un ticket della
// sede resta testo.
const SCANSIONE =
  /COM[\s\-–_]?(\d{4})[\s\-–_]?(\d{1,4})|TK[\s\-–_]?(\d{1,6})|#(\d{1,6})/gi;

/** Un riferimento non inizia né finisce dentro una parola. */
function eCarattereDiParola(carattere: string | undefined): boolean {
  return carattere !== undefined && /[\p{L}\p{N}_]/u.test(carattere);
}

/**
 * `#12,5` e `#12.5` sono numeri, non ticket: il separatore decimale seguito
 * da una cifra squalifica il candidato invece di troncarlo a `#12`.
 */
function eSeparatoreDecimale(testo: string, fine: number): boolean {
  const successivo = testo[fine];
  if (successivo !== "." && successivo !== ",") return false;
  return /\d/.test(testo[fine + 1] ?? "");
}

/** Forma canonica del codice commessa: progressivo a tre cifre, come il server. */
export function chiaveCommessa(anno: string, progressivo: string): string {
  return `COM-${anno}-${progressivo.padStart(3, "0")}`;
}

/** Forma canonica del codice ticket, identica a quella mostrata dalla coda. */
export function chiaveTicket(id: number): string {
  return `TK-${String(id).padStart(4, "0")}`;
}

/** Estrae la chiave canonica da un `codice` già memorizzato su una commessa. */
export function chiaveDaCodiceCommessa(codice: unknown): string | null {
  if (typeof codice !== "string") return null;
  const trovato = /^\s*COM[\s\-–_]?(\d{4})[\s\-–_]?(\d{1,4})\s*$/i.exec(codice);
  if (!trovato) return null;
  return chiaveCommessa(trovato[1], trovato[2]);
}

/**
 * Spezza una stringa nei frammenti da rendere. Invariante verificata dai test:
 * concatenando `testo` di tutti i frammenti si riottiene la stringa di
 * partenza, carattere per carattere. Il riconoscimento non può far sparire,
 * riscrivere o riordinare testo.
 */
export function spezzaRiferimenti(testo: string): FrammentoInline[] {
  if (typeof testo !== "string" || testo.length === 0) return [];

  const frammenti: FrammentoInline[] = [];
  let consumato = 0;

  const aggiungiTesto = (fino: number): void => {
    if (fino <= consumato) return;
    frammenti.push({ tipo: "testo", testo: testo.slice(consumato, fino) });
  };

  // Copia locale: `SCANSIONE` è globale e porta `lastIndex` con sé, e nessuna
  // chiamata deve poter alterare lo stato di un'altra.
  const scansione = new RegExp(SCANSIONE.source, SCANSIONE.flags);
  let trovato = scansione.exec(testo);
  while (trovato !== null) {
    const inizio = trovato.index;
    const fine = inizio + trovato[0].length;
    const riferimento = interpreta(trovato, testo, inizio, fine);

    if (riferimento) {
      aggiungiTesto(inizio);
      frammenti.push(riferimento);
      consumato = fine;
    }

    // Un candidato scartato non blocca la scansione: si riparte dal carattere
    // successivo al suo inizio, così `xCOM-2026-184 e COM-2026-171` trova
    // comunque il secondo codice.
    scansione.lastIndex = riferimento ? fine : inizio + 1;
    trovato = scansione.exec(testo);
  }

  aggiungiTesto(testo.length);
  return frammenti;
}

function interpreta(
  trovato: RegExpExecArray,
  testo: string,
  inizio: number,
  fine: number
): FrammentoRiferimento | null {
  const precedente = testo[inizio - 1];
  if (eCarattereDiParola(precedente)) return null;
  if (eCarattereDiParola(testo[fine])) return null;

  const grezzo = trovato[0];
  const [, annoCommessa, progressivoCommessa, numeroTk, numeroCancelletto] =
    trovato;

  if (annoCommessa !== undefined && progressivoCommessa !== undefined) {
    return {
      tipo: "riferimento",
      testo: grezzo,
      genere: "commessa",
      chiave: chiaveCommessa(annoCommessa, progressivoCommessa),
    };
  }

  const numero = numeroTk ?? numeroCancelletto;
  if (numero === undefined) return null;

  // `#` incollato a un altro `#` non è una citazione: è punteggiatura o un
  // residuo di sintassi.
  if (numeroCancelletto !== undefined) {
    if (precedente === "#") return null;
    if (eSeparatoreDecimale(testo, fine)) return null;
  }

  const id = Number.parseInt(numero, 10);
  if (!Number.isSafeInteger(id) || id <= 0) return null;

  return {
    tipo: "riferimento",
    testo: grezzo,
    genere: "ticket",
    chiave: chiaveTicket(id),
  };
}

/** Vero se la stringa contiene almeno un candidato: gate delle query di supporto. */
export function contieneRiferimenti(testo: string): boolean {
  return spezzaRiferimenti(testo).some(
    frammento => frammento.tipo === "riferimento"
  );
}

/**
 * Indice chiave → id. Una chiave che compare due volte diventa ambigua
 * (`null`) e non risolve più: meglio lasciare testo che aprire uno dei due
 * record a caso.
 */
function indicizza<T>(
  record: readonly T[] | null | undefined,
  chiaveDi: (elemento: T) => string | null,
  idDi: (elemento: T) => number
): Map<string, number | null> {
  const indice = new Map<string, number | null>();
  for (const elemento of record ?? []) {
    const chiave = chiaveDi(elemento);
    if (chiave === null) continue;
    const id = idDi(elemento);
    if (!Number.isSafeInteger(id)) continue;
    if (indice.has(chiave) && indice.get(chiave) !== id) {
      indice.set(chiave, null);
      continue;
    }
    indice.set(chiave, id);
  }
  return indice;
}

export function indicizzaCommesse(
  commesse: readonly CommessaRiferibile[] | null | undefined
): Map<string, number | null> {
  return indicizza(
    commesse,
    commessa => chiaveDaCodiceCommessa(commessa.codice),
    commessa => Number(commessa.id)
  );
}

export function indicizzaTicket(
  ticket: readonly TicketRiferibile[] | null | undefined
): Map<string, number | null> {
  return indicizza(
    ticket,
    elemento =>
      Number.isSafeInteger(Number(elemento.id)) && Number(elemento.id) > 0
        ? chiaveTicket(Number(elemento.id))
        : null,
    elemento => Number(elemento.id)
  );
}

/**
 * Costruisce il risolutore a partire dai soli dati già in mano alla pagina.
 *
 * La destinazione della commessa è la sua scheda (`/commesse/:id`). Il ticket
 * non ha una rotta di dettaglio in `App.tsx`: la destinazione è la coda
 * Post-Vendita `/ticket`, la stessa che usano già il motore notifiche
 * (`server/routers/notifiche.ts`) e l'Action Center
 * (`server/actionCenter/signals.ts`). Il nome accessibile lo dichiara, così
 * l'operatore sa dove sta andando prima di cliccare.
 */
export function creaRisolutoreRiferimenti(dati: {
  commesse?: readonly CommessaRiferibile[] | null;
  ticket?: readonly TicketRiferibile[] | null;
}): RisolutoreRiferimenti {
  const perCommessa = indicizzaCommesse(dati.commesse);
  const perTicket = indicizzaTicket(dati.ticket);

  return frammento => {
    if (frammento.genere === "commessa") {
      const id = perCommessa.get(frammento.chiave);
      if (id == null) return null;
      return {
        href: `/commesse/${id}`,
        nomeAccessibile: `Apri la commessa ${frammento.chiave}`,
      };
    }

    const id = perTicket.get(frammento.chiave);
    if (id == null) return null;
    return {
      href: "/ticket",
      nomeAccessibile: `Apri il ticket ${frammento.chiave} nella coda Post-Vendita`,
    };
  };
}
