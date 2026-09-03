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
// `archivia_allegato_comunicazione` (R1, già nel catalogo) quando la
// certezza è «certa»; sull'ambiguo il modello chiede.
//
// Deterministico e iniettabile: la certezza non è un'opinione del modello
// ma una regola leggibile qui.

import type { Comunicazione } from "../../comunicazioni/comunicazioni";
import { STATI_COMMESSA } from "../../commesse/transizioni";

/** Dallo stato in cui si ordina in poi la conferma deve esserci. */
const DA_ORDINARE = STATI_COMMESSA.indexOf("da_ordinare");

// Nome file che parla di una conferma d'ordine (o dell'ordine stesso).
// I separatori dei nomi reali sono `_` e `-`, che sono caratteri di parola
// per `\b`: «CO_4471.pdf» sfuggiva a un confine di parola classico. Qui il
// confine è esplicito (inizio, separatore o cifra), così «CO_4471» entra e
// «costo», «conto», «record» restano fuori.
const CONFINE = "(?:^|[\\W_])";
const NOME_CONFERMA = new RegExp(
  `conferma|${CONFINE}conf[\\W_]?ord|${CONFINE}c\\.?o\\.?(?=[\\W_]|\\d|$)|${CONFINE}o\\.?c\\.?(?=[\\W_]|\\d|$)|order[\\W_]?confirm|${CONFINE}acknowledg`,
  "i"
);
const NOME_ORDINE = new RegExp(
  `${CONFINE}ordin|${CONFINE}order(?=[\\W_]|\\d|$)|${CONFINE}oda(?=[\\W_]|\\d|$)|${CONFINE}o\\.d\\.a`,
  "i"
);

export type CandidatoConferma = {
  comunicazioneId: number;
  allegatoIndex: number;
  nomeFile: string;
  mimeType: string;
  mittente: string;
  ricevutaIl: string;
  /**
   * «certa» = la comunicazione è già collegata a QUESTA commessa e il file
   * si dichiara conferma d'ordine: archiviarlo è una correzione ovvia.
   * «probabile» = manca uno dei due (nome solo «ordine», oppure la mail non
   * è collegata): decide una persona.
   */
  certezza: "certa" | "probabile";
  motivo: string;
  /** Link alla comunicazione, per aprirla e vedere l'allegato. */
  link: string;
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
};

function commessaCitataNelTesto(c: Comunicazione, codice: string | null): boolean {
  if (!codice) return false;
  return `${c.oggetto ?? ""} ${c.testo ?? ""}`
    .toLowerCase()
    .includes(codice.toLowerCase());
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
  const attive = deps
    .commesse()
    .filter(
      (c: any) =>
        c.sedeId === sedeId &&
        !c.archivedAt &&
        c.stato !== "archiviata" &&
        STATI_COMMESSA.indexOf(c.stato) >= DA_ORDINARE
    );
  if (attive.length === 0) return [];

  const senzaConferma = attive.filter(
    (c: any) =>
      !deps
        .documentiDiCommessa(c.id)
        .some(d => d.tipo === "conferma_ordine" || d.tipo === "ordine")
  );
  if (senzaConferma.length === 0) return [];

  const comunicazioni = await deps.comunicazioniConAllegati(sedeId);
  const risultato: CommessaSenzaConferma[] = [];

  for (const commessa of senzaConferma) {
    const candidati: CandidatoConferma[] = [];
    for (const c of comunicazioni) {
      const collegataQui = c.commessaId === commessa.id;
      const citaIlCodice = commessaCitataNelTesto(c, commessa.codice ?? null);
      // Il cliente è l'aggancio più debole ammesso: i fornitori citano il
      // LORO riferimento, non il nostro codice commessa, quindi senza
      // questo ramo le conferme «senza codice» resterebbero invisibili.
      const stessoCliente =
        commessa.clienteId != null && c.clienteId === commessa.clienteId;
      // Una mail che non parla né di questa commessa né del suo cliente non
      // è un candidato: senza aggancio si proporrebbe rumore ovunque.
      if (!collegataQui && !citaIlCodice && !stessoCliente) continue;

      c.allegati.forEach((allegato, indice) => {
        if (deps.giaArchiviato(sedeId, c.id, indice)) return;
        const conferma = NOME_CONFERMA.test(allegato.nome);
        const ordine = NOME_ORDINE.test(allegato.nome);
        if (!conferma && !ordine) return;
        const certezza: CandidatoConferma["certezza"] =
          collegataQui && conferma ? "certa" : "probabile";
        candidati.push({
          comunicazioneId: c.id,
          allegatoIndex: indice,
          nomeFile: allegato.nome,
          mimeType: allegato.mimeType,
          mittente: c.mittenteNome?.trim() || c.mittente,
          ricevutaIl: c.receivedAt.toISOString(),
          certezza,
          motivo: collegataQui
            ? conferma
              ? "la mail è collegata a questa commessa e l'allegato si dichiara conferma d'ordine"
              : "la mail è collegata a questa commessa, ma il nome del file dice solo «ordine»"
            : citaIlCodice
              ? `la mail cita il codice ${commessa.codice} ma non è collegata alla commessa`
              : "la mail è dello stesso cliente ma non cita la commessa: leggi il documento (leggi_conferma_ordine) prima di archiviarlo",
          link: deps.link(c),
        });
      });
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
