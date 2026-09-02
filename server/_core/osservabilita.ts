// Da dove passa il tempo, misurato dove il tempo si perde davvero: in
// produzione, con i dati veri.
//
// In locale ogni endpoint della dashboard sta sotto il millisecondo e la
// somma di una passata completa è meno di quattro. Se dall'altra parte si
// aspettano secondi, l'attesa non è nel calcolo della singola procedura: o è
// il database, o è il processo occupato a fare altro mentre la richiesta
// aspetta il suo turno. Node ha un thread solo: qualunque tratto di lavoro
// sincrono — analizzare un PDF, serializzare una collezione intera prima di
// scriverla — mette in coda tutte le richieste in arrivo, comprese quelle
// che da sole durerebbero un millesimo di secondo.
//
// Queste due misure distinguono i due casi:
//
//   [lento] procedura=X ms=…      la procedura ha lavorato a lungo
//   [coda] loop bloccato ms=…     il processo era fermo su altro
//
// Soglie alte di proposito: questi log devono restare rari e leggibili, non
// diventare un altro costo. Nessun dato del cliente ci finisce dentro: solo
// il nome della procedura, che è già pubblico nel contratto tRPC.

/** Sopra questa durata una procedura merita una riga di log. */
export const SOGLIA_PROCEDURA_MS = 500;
/** Sopra questo ritardo il ciclo di eventi era fermo su qualcos'altro. */
export const SOGLIA_LOOP_MS = 250;
/** Ogni quanto si campiona il ritardo del ciclo di eventi. */
const PASSO_CAMPIONE_MS = 500;

/**
 * Quanto è durata la procedura, e se vale la pena scriverlo.
 *
 * Separata dal middleware perché è l'unica parte con una decisione dentro,
 * e i test del progetto girano in node.
 */
export function vaSegnalata(durataMs: number): boolean {
  return durataMs >= SOGLIA_PROCEDURA_MS;
}

export function rigaProceduraLenta(
  percorso: string,
  durataMs: number,
  esito: "ok" | "errore"
): string {
  return `[lento] procedura=${percorso} ms=${Math.round(durataMs)} esito=${esito}`;
}

/** Sopra questa durata un passo dentro una procedura merita una riga. */
export const SOGLIA_PASSO_MS = 300;

export function rigaPassoLento(nome: string, durataMs: number): string {
  return `[passo] ${nome} ms=${Math.round(durataMs)}`;
}

/**
 * Cronometra un tratto dentro una procedura. Serve quando la procedura
 * risulta lenta ma è fatta di più pezzi indipendenti: senza, si sa che
 * `tars.briefing` costa dieci secondi e non quale dei suoi quattro passi se
 * li prende. Scrive solo sopra la soglia, come tutto il resto qui dentro.
 */
export async function misura<T>(
  nome: string,
  azione: () => Promise<T>,
  log: (riga: string) => void = console.warn
): Promise<T> {
  const inizio = Date.now();
  try {
    return await azione();
  } finally {
    const durata = Date.now() - inizio;
    if (durata >= SOGLIA_PASSO_MS) log(rigaPassoLento(nome, durata));
  }
}

/**
 * Il ritardo del ciclo di eventi: di quanto un timer da `atteso` ms è
 * arrivato in ritardo. È il tempo in cui il processo non poteva rispondere a
 * nessuno, quindi il tempo che ogni richiesta in arrivo ha passato in coda.
 */
export function ritardoLoop(attesoMs: number, effettivoMs: number): number {
  return Math.max(0, effettivoMs - attesoMs);
}

export function rigaLoopBloccato(ritardoMs: number): string {
  return `[coda] loop bloccato ms=${Math.round(ritardoMs)}`;
}

let sonda: NodeJS.Timeout | null = null;

/**
 * Avvia la sonda del ciclo di eventi. Idempotente: una seconda chiamata non
 * raddoppia i campioni.
 */
export function avviaSondaLoop(
  log: (riga: string) => void = console.warn
): () => void {
  if (sonda) return fermaSondaLoop;
  let ultimo = Date.now();
  sonda = setInterval(() => {
    const ora = Date.now();
    const ritardo = ritardoLoop(PASSO_CAMPIONE_MS, ora - ultimo);
    ultimo = ora;
    if (ritardo >= SOGLIA_LOOP_MS) log(rigaLoopBloccato(ritardo));
  }, PASSO_CAMPIONE_MS);
  // La sonda non deve tenere vivo il processo da sola.
  sonda.unref();
  return fermaSondaLoop;
}

export function fermaSondaLoop(): void {
  if (!sonda) return;
  clearInterval(sonda);
  sonda = null;
}
