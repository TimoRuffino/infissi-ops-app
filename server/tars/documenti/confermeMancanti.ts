// Le conferme d'ordine che mancano nei fascicoli, e dove sono finite
// (mandato direzione 03/09/2026: «è essenziale che Tars vada alla ricerca
// delle conf. ordine dove mancano nelle commesse; se è sicuro può
// collegarle in automatico, se ha dubbi deve chiedere conferma»).
//
// Le conferme arrivano via mail dai fornitori e restano allegate alla
// comunicazione: il fascicolo della commessa resta vuoto, il gate di
// «da ordinare» non passa e — dal 03/09 — manca anche il costo imponibile
// che alimenta il margine.
//
// Qui si guarda soltanto: nessuna scrittura. Il collegamento lo esegue
// `archivia_allegato_comunicazione` (R1, già nel catalogo) o il worker
// delle conferme certe quando la certezza è «certa»; sull'ambiguo decide
// una persona.
//
// Deterministico e iniettabile: la certezza non è un'opinione del modello
// ma una regola leggibile qui. Dal 04/09 (pomeriggio: «le conferme ordine
// sono ferme») la regola legge anche DENTRO il file: il fornitore non cita
// il nostro codice nella mail, ma nel PDF riporta il cliente o il cantiere,
// e quel riscontro vale per le mail che non sono collegate a niente.

import type { Comunicazione } from "../../comunicazioni/comunicazioni";
import { STATI_COMMESSA } from "../../commesse/transizioni";
import type {
  CommessaRicercabile,
  EsitoRicercaCommessa,
  FonteTesto,
} from "./ricercaCommessaNelDocumento";

/** Dallo stato in cui si ordina in poi la conferma deve esserci. */
const DA_ORDINARE = STATI_COMMESSA.indexOf("da_ordinare");

// Nome file che parla di una conferma d'ordine (o dell'ordine stesso).
// I separatori dei nomi reali sono `_` e `-`, che sono caratteri di parola
// per `\b`: «CO_4471.pdf» sfuggiva a un confine di parola classico. Qui il
// confine è esplicito (inizio, separatore o cifra).
const CONFINE = "(?:^|[\\W_])";
const NOME_CONFERMA = new RegExp(
  `${CONFINE}conferma|${CONFINE}conf[\\W_]?ord|${CONFINE}c\\.?o\\.?(?=[\\W_]|\\d|$)|${CONFINE}o\\.?c\\.?(?=[\\W_]|\\d|$)|order[\\W_]?confirm|${CONFINE}acknowledg`,
  "i"
);
const NOME_ORDINE = new RegExp(
  `${CONFINE}ordin|${CONFINE}order(?=[\\W_]|\\d|$)|${CONFINE}oda(?=[\\W_]|\\d|$)|${CONFINE}o\\.d\\.a`,
  "i"
);

/**
 * «Conferma» e «ordine» da soli non bastano: in una casella aziendale
 * girano conferme di iscrizione, di appuntamento, di lettura, e ordini del
 * CLIENTE verso di noi — che non sono affatto conferme del fornitore.
 * Questi nomi si scartano prima di diventare un candidato. «Conferma
 * ordine cliente» però è la conferma che il FORNITORE manda al suo cliente
 * (noi): resta un candidato (04/09/2026, Ferramenta Fivizzanese).
 */
const NOME_ESCLUSO = new RegExp(
  [
    "conferma(?:[\\W_]+\\w{1,5}){0,2}[\\W_]*(iscrizione|appuntamento|lettura|ricezione|ricevuta|registrazione|prenotazione|pagamento|bonifico|spedizione)",
    "(?<!conferm\\w*[\\W_]*)ordine[\\W_]*cliente",
    "ordine[\\W_]*(di[\\W_]*servizio|del[\\W_]*giorno)",
    "(fattura|ddt|preventivo|contratto|listino|catalogo|newsletter|privacy|firmato)",
  ].join("|"),
  "i"
);

/** Solo documenti veri: una conferma non è un'immagine di firma o un .ics. */
const MIME_AMMESSI = /^application\/(pdf|vnd\.openxmlformats|msword|octet-stream)|^text\/plain/i;

/**
 * Il nome del file dice «conferma», dice solo «ordine», o non è un
 * candidato (nome escluso, formato non ammesso). Condiviso con lo
 * smistamento, che legge dentro il file appena la mail arriva.
 */
export function nomeDaConferma(
  nome: string,
  mimeType: string | null | undefined
): "conferma" | "ordine" | null {
  if (NOME_ESCLUSO.test(nome)) return null;
  if (mimeType && !MIME_AMMESSI.test(mimeType)) return null;
  if (NOME_CONFERMA.test(nome)) return "conferma";
  if (NOME_ORDINE.test(nome)) return "ordine";
  return null;
}

export type RiscontroTestoCandidato =
  /** Il testo cita questa commessa e nessun'altra. */
  | "cita"
  /** Il testo non cita questa commessa (o ne cita un'altra). */
  | "non_cita"
  /** Il testo cita più commesse, o solo indizi deboli. */
  | "ambiguo"
  | "non_leggibile"
  /** Lettura non disponibile o rinviata: vale solo il nome del file. */
  | "non_letto";

export type CandidatoConferma = {
  comunicazioneId: number;
  allegatoIndex: number;
  nomeFile: string;
  mimeType: string;
  mittente: string;
  ricevutaIl: string;
  /**
   * «certa» = archiviarlo è una correzione ovvia: la comunicazione è già
   * collegata a QUESTA commessa e il file si dichiara conferma d'ordine
   * (e, se letto, il testo non la smentisce), oppure il TESTO del file
   * cita questa commessa e nessun'altra.
   * «probabile» = manca qualcosa (nome solo «ordine», mail non collegata,
   * testo che non cita la commessa o ne cita più d'una): decide una persona.
   */
  certezza: "certa" | "probabile";
  motivo: string;
  /** Link alla comunicazione, per aprirla e vedere l'allegato. */
  link: string;
  /** Cosa dice il testo del file, quando è stato letto. */
  riscontroTesto: RiscontroTestoCandidato;
  prove: string[];
  fonteTesto: FonteTesto | null;
};

export type CommessaSenzaConferma = {
  commessaId: number;
  codice: string | null;
  cliente: string | null;
  stato: string;
  /**
   * L'esito della ricerca, detto a parole: «non_trovata» è un risultato,
   * non un silenzio (direzione 03/09/2026: «se non l'ha trovata deve
   * dirmelo»).
   */
  esito: "archiviabile_subito" | "da_confermare" | "non_trovata";
  candidati: CandidatoConferma[];
};

export type DipendenzeConfermeMancanti = {
  commesse: () => any[];
  /** I documenti già nel fascicolo della commessa. */
  documentiDiCommessa: (commessaId: number) => Array<{ tipo: string }>;
  /** Le comunicazioni della sede con allegati (collegate e non). */
  comunicazioniConAllegati: (sedeId: number) => Promise<Comunicazione[]>;
  /** Un allegato già archiviato non si ripropone. */
  giaArchiviato: (
    sedeId: number,
    comunicazioneId: number,
    allegatoIndex: number
  ) => boolean;
  link: (c: Comunicazione) => string;
  /**
   * Legge il testo del file e cerca la commessa fra quelle passate
   * (`ricercaCommessaNelDocumento`). Opzionale: senza, vale solo il nome
   * del file, come prima del 04/09.
   */
  leggiCommessaNelDocumento?: (
    comunicazione: Comunicazione,
    allegatoIndex: number,
    commesse: readonly CommessaRicercabile[]
  ) => Promise<EsitoRicercaCommessa>;
};

function commessaCitataNelTesto(c: Comunicazione, codice: string | null): boolean {
  if (!codice) return false;
  return `${c.oggetto ?? ""} ${c.testo ?? ""}`
    .toLowerCase()
    .includes(codice.toLowerCase());
}

/** Il riscontro del testo, visto dalla commessa per cui si sta cercando. */
function riscontroPer(
  ricerca: EsitoRicercaCommessa | null,
  commessaId: number
): { riscontro: RiscontroTestoCandidato; prove: string[]; fonteTesto: FonteTesto | null; altre: number[] } {
  if (!ricerca) return { riscontro: "non_letto", prove: [], fonteTesto: null, altre: [] };
  if (ricerca.esito === "non_letto") return { riscontro: "non_letto", prove: [], fonteTesto: null, altre: [] };
  if (ricerca.esito === "non_leggibile") {
    return { riscontro: "non_leggibile", prove: [], fonteTesto: ricerca.fonteTesto, altre: [] };
  }
  const mio = ricerca.candidati.find(c => c.commessaId === commessaId) ?? null;
  const altre = ricerca.candidati.filter(c => c.commessaId !== commessaId).map(c => c.commessaId);
  if (ricerca.esito === "unica" && ricerca.commessaId === commessaId) {
    return { riscontro: "cita", prove: mio?.prove ?? [], fonteTesto: ricerca.fonteTesto, altre };
  }
  if (mio) return { riscontro: "ambiguo", prove: mio.prove, fonteTesto: ricerca.fonteTesto, altre };
  return { riscontro: "non_cita", prove: [], fonteTesto: ricerca.fonteTesto, altre };
}

/**
 * Le commesse che dovrebbero avere una conferma d'ordine nel fascicolo e
 * non ce l'hanno, con i file candidati trovati fra gli allegati.
 */
export async function confermeOrdineMancanti(input: {
  sedeId: number;
  deps: DipendenzeConfermeMancanti;
  limite?: number;
}): Promise<CommessaSenzaConferma[]> {
  const { sedeId, deps } = input;
  const vive = deps
    .commesse()
    .filter((c: any) => c.sedeId === sedeId && !c.archivedAt && c.stato !== "archiviata");
  const attive = vive.filter((c: any) => STATI_COMMESSA.indexOf(c.stato) >= DA_ORDINARE);
  if (attive.length === 0) return [];

  const senzaConferma = attive.filter(
    (c: any) =>
      !deps
        .documentiDiCommessa(c.id)
        .some(d => d.tipo === "conferma_ordine")
  );
  if (senzaConferma.length === 0) return [];

  const comunicazioni = await deps.comunicazioniConAllegati(sedeId);
  const risultato: CommessaSenzaConferma[] = [];

  // Il testo di un allegato si legge UNA volta per tutte le commesse: il
  // riscontro dice quali commesse cita, e ognuna se lo prende.
  const letture = new Map<string, Promise<EsitoRicercaCommessa | null>>();
  const leggi = (c: Comunicazione, indice: number): Promise<EsitoRicercaCommessa | null> => {
    if (!deps.leggiCommessaNelDocumento) return Promise.resolve(null);
    const chiave = `${c.id}:${indice}`;
    let promessa = letture.get(chiave);
    if (!promessa) {
      promessa = deps
        .leggiCommessaNelDocumento(c, indice, vive)
        .catch(() => null);
      letture.set(chiave, promessa);
    }
    return promessa;
  };

  for (const commessa of senzaConferma) {
    const candidati: CandidatoConferma[] = [];
    for (const c of comunicazioni) {
      const collegataQui = c.commessaId === commessa.id;
      // Una mail collegata a un'ALTRA commessa non è un candidato qui.
      if (c.commessaId != null && !collegataQui) continue;
      const citaIlCodice = commessaCitataNelTesto(c, commessa.codice ?? null);
      // Il cliente è l'aggancio più debole ammesso: i fornitori citano il
      // LORO riferimento, non il nostro codice commessa, quindi senza
      // questo ramo le conferme «senza codice» resterebbero invisibili.
      const stessoCliente =
        commessa.clienteId != null && c.clienteId === commessa.clienteId;
      const aggancioMail = collegataQui || citaIlCodice || stessoCliente;
      // Senza aggancio nella mail resta il TESTO del file: se lo si può
      // leggere, una conferma «di nessuno» può citare proprio questa commessa.
      if (!aggancioMail && !deps.leggiCommessaNelDocumento) continue;

      for (const [indice, allegato] of c.allegati.entries()) {
        if (deps.giaArchiviato(sedeId, c.id, indice)) continue;
        const nome = nomeDaConferma(allegato.nome, allegato.mimeType);
        if (!nome) continue;
        const conferma = nome === "conferma";
        const testo = riscontroPer(await leggi(c, indice), commessa.id);
        if (!aggancioMail && testo.riscontro !== "cita" && testo.riscontro !== "ambiguo") continue;

        let certezza: CandidatoConferma["certezza"];
        let motivo: string;
        const citazione = testo.prove.length > 0 ? testo.prove.join(", ") : "la commessa";
        if (testo.riscontro === "cita") {
          certezza = "certa";
          motivo = collegataQui
            ? `la mail è collegata a questa commessa e il testo del file cita ${citazione}`
            : `il testo del file cita ${citazione} e nessun'altra commessa viva`;
        } else if (testo.riscontro === "ambiguo") {
          certezza = "probabile";
          motivo = `il testo del file cita ${citazione} ma anche ${testo.altre.length === 1 ? "un'altra commessa" : `altre ${testo.altre.length} commesse`} (${testo.altre.join(", ")}): decidi tu`;
        } else if (testo.riscontro === "non_cita") {
          certezza = "probabile";
          motivo = collegataQui
            ? "la mail è collegata a questa commessa ma il testo del file non la cita: conferma tu che è sua («È di questa commessa»)"
            : "il testo del file non cita questa commessa: leggilo (leggi_conferma_ordine) prima di archiviarlo";
        } else if (testo.riscontro === "non_leggibile") {
          certezza = "probabile";
          motivo = collegataQui
            ? "la mail è collegata a questa commessa ma il file non si legge (scansione o formato): conferma tu che è sua"
            : "il file non si legge (scansione o formato): apri l'allegato e decidi tu";
        } else {
          // Nome del file soltanto, come prima del 04/09.
          certezza = collegataQui && conferma ? "certa" : "probabile";
          motivo = collegataQui
            ? conferma
              ? "la mail è collegata a questa commessa e l'allegato si dichiara conferma d'ordine"
              : "la mail è collegata a questa commessa, ma il nome del file dice solo «ordine»"
            : citaIlCodice
              ? `la mail cita il codice ${commessa.codice} ma non è collegata alla commessa`
              : "la mail è dello stesso cliente ma non cita la commessa: leggi il documento (leggi_conferma_ordine) prima di archiviarlo";
        }
        candidati.push({
          comunicazioneId: c.id,
          allegatoIndex: indice,
          nomeFile: allegato.nome,
          mimeType: allegato.mimeType,
          mittente: c.mittenteNome?.trim() || c.mittente,
          ricevutaIl: c.receivedAt.toISOString(),
          certezza,
          motivo,
          link: deps.link(c),
          riscontroTesto: testo.riscontro,
          prove: testo.prove,
          fonteTesto: testo.fonteTesto,
        });
      }
    }
    // Prima le certe, poi le più recenti: chi legge decide dall'alto.
    candidati.sort(
      (a, b) =>
        (a.certezza === b.certezza ? 0 : a.certezza === "certa" ? -1 : 1) ||
        b.ricevutaIl.localeCompare(a.ricevutaIl)
    );
    risultato.push({
      commessaId: commessa.id,
      codice: commessa.codice ?? null,
      cliente: commessa.cliente ?? null,
      stato: commessa.stato,
      esito:
        candidati.length === 0
          ? "non_trovata"
          : candidati.some(c => c.certezza === "certa")
            ? "archiviabile_subito"
            : "da_confermare",
      candidati,
    });
  }

  // Le commesse con un file già in casa vengono prima: lì il lavoro è di un
  // clic. Le altre restano in coda come «manca proprio».
  risultato.sort(
    (a, b) =>
      Number(b.candidati.some(x => x.certezza === "certa")) -
        Number(a.candidati.some(x => x.certezza === "certa")) ||
      b.candidati.length - a.candidati.length
  );
  return risultato.slice(0, input.limite ?? 25);
}
