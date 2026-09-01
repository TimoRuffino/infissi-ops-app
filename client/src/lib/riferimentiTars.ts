// Riconoscimento e risoluzione dei codici commessa citati nelle risposte di Tars.
//
// Il testo della risposta è dato non fidato: può citare un codice inesistente,
// di un'altra sede o inventato di sana pianta. Qui si separano nettamente due
// passi, e solo il secondo autorizza un link:
//
//  1. RICONOSCIMENTO (`spezzaRiferimenti`) — puro, sintattico, senza dati:
//     spezza una stringa nei suoi frammenti, marcando i candidati. Un
//     candidato non è ancora niente: è solo una forma che assomiglia a un
//     codice commessa.
//  2. RISOLUZIONE (`creaRisolutoreRiferimenti`) — confronta la chiave
//     normalizzata del candidato con un indice costruito ESCLUSIVAMENTE dai
//     record che la pagina ha già ricevuto dalla query sede-scoped. Se la
//     chiave non è nell'indice, la funzione restituisce `null` e il chiamante
//     lascia il testo com'è: nessun link, nessuna segnalazione, nessun
//     tooltip d'errore.
//
// Isolamento sede: l'indice non fa e non può fare lookup per conto suo, non
// accetta un id numerico e non costruisce un href da un codice non risolto.
// La lista che lo alimenta è filtrata dal server su `ctx.sedeId`
// (`server/routers/commesse.ts`): un record di un'altra sede non entra nel
// payload, quindi non entra nell'indice, quindi non diventa mai un link. La
// proprietà è strutturale, non una convenzione.
//
// SOLO COMMESSE, per ora. I ticket sono citati come `ticket #37`, `#37` o
// `TK-0037` ma NON diventano link: `App.tsx` non ha una rotta di dettaglio del
// ticket, esiste solo la coda `/ticket`. Un link che non porta al record che
// nomina promette una cosa e ne mantiene un'altra — l'operatore clicca
// «ticket #37» e si ritrova in una lista da cercare a mano, cioè peggio del
// testo semplice, che almeno non promette niente. Il giorno in cui esiste
// `/ticket/:id` si riaprono insieme: un'alternativa `TK[\s\-–_]?(\d{1,6})|#(\d{1,6})`
// nella scansione (con lo scarto dei decimali `#12,5` e dei `##37`), un indice
// ticket alimentato da `ticket.list` e la destinazione `/ticket/:id`.
//
// Il modulo resta puro: nessuna query, nessun hook, nessun import di React.

export type FrammentoTesto = {
  tipo: "testo";
  testo: string;
};

export type FrammentoRiferimento = {
  tipo: "riferimento";
  /** Il testo così come Tars l'ha scritto: a schermo resta identico. */
  testo: string;
  /** Forma canonica con cui si interroga l'indice (`COM-2026-184`). */
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

// `COM-2026-184` — il formato che il server genera in
// `server/routers/commesse.ts` (`COM-ANNO-NNN`, progressivo a 3 cifre) e che
// `CommesseList.tsx` mostra tale e quale. La tolleranza sui separatori replica
// gli estrattori server già in produzione (`server/comunicazioni/match.ts`,
// `server/routers/ficMatch.ts`), così una citazione un po' sciatta del modello
// viene normalizzata allo stesso modo del record.
const SCANSIONE = /COM[\s\-–_]?(\d{4})[\s\-–_]?(\d{1,4})/gi;

/** Un riferimento non inizia né finisce dentro una parola. */
function eCarattereDiParola(carattere: string | undefined): boolean {
  return carattere !== undefined && /[\p{L}\p{N}_]/u.test(carattere);
}

/** Forma canonica del codice commessa: progressivo a tre cifre, come il server. */
export function chiaveCommessa(anno: string, progressivo: string): string {
  return `COM-${anno}-${progressivo.padStart(3, "0")}`;
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
  if (eCarattereDiParola(testo[inizio - 1])) return null;
  if (eCarattereDiParola(testo[fine])) return null;

  return {
    tipo: "riferimento",
    testo: trovato[0],
    chiave: chiaveCommessa(trovato[1], trovato[2]),
  };
}

/** Vero se la stringa contiene almeno un candidato: gate della query di supporto. */
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
export function indicizzaCommesse(
  commesse: readonly CommessaRiferibile[] | null | undefined
): Map<string, number | null> {
  const indice = new Map<string, number | null>();
  for (const commessa of commesse ?? []) {
    const chiave = chiaveDaCodiceCommessa(commessa.codice);
    if (chiave === null) continue;
    const id = Number(commessa.id);
    if (!Number.isSafeInteger(id)) continue;
    if (indice.has(chiave) && indice.get(chiave) !== id) {
      indice.set(chiave, null);
      continue;
    }
    indice.set(chiave, id);
  }
  return indice;
}

/**
 * Costruisce il risolutore a partire dai soli dati già in mano alla pagina.
 * La destinazione è la scheda della commessa (`/commesse/:id`), cioè proprio
 * il record che il codice nomina.
 */
export function creaRisolutoreRiferimenti(dati: {
  commesse?: readonly CommessaRiferibile[] | null;
}): RisolutoreRiferimenti {
  const perCommessa = indicizzaCommesse(dati.commesse);

  return frammento => {
    const id = perCommessa.get(frammento.chiave);
    if (id == null) return null;
    return {
      href: `/commesse/${id}`,
      nomeAccessibile: `Apri la commessa ${frammento.chiave}`,
    };
  };
}
