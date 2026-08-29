// Collegamento assistito documento → ordine fornitore (D7, slice 2).
//
// Generazione DETERMINISTICA dei candidati: per ogni ordine della sede si
// cercano nel testo del documento i suoi riferimenti, in ordine di forza —
// numero d'ordine, codice commessa, fornitore, codici articolo, data di
// consegna, totale. Ogni segnale porta peso, dettaglio ed evidenza (pagina
// e frammento): il punteggio è una somma spiegabile, mai un giudizio opaco.
//
// Quattro esiti espliciti: `certa` (un solo ordine citato per codice),
// `ambigua` (più ordini si equivalgono: MAI un collegamento automatico),
// `candidata` (un candidato plausibile senza citazione certa), `assente`.
// In ogni caso decide un umano: qui non si scrive niente.

import type { EstrazioneConferma, Evidenza } from "./estrazioneConferma";
import { trovaRiferimentoTesto } from "./estrazioneConferma";
import { TOLLERANZA_TOTALE_EURO } from "./confrontoOrdine";

export type TipoSegnaleCandidato =
  | "codice_ordine"
  | "codice_commessa"
  | "fornitore"
  | "codice_articolo"
  | "data_consegna"
  | "totale";

const PESO: Record<TipoSegnaleCandidato, number> = {
  codice_ordine: 100,
  codice_commessa: 60,
  fornitore: 40,
  codice_articolo: 15,
  data_consegna: 15,
  totale: 15,
};

// Sotto questa soglia un candidato non regge da solo: segnali deboli come
// una data o un totale coincidente capitano per caso.
export const PUNTEGGIO_MINIMO_CANDIDATO = 40;
const MAX_PUNTI_ARTICOLI = 45;

export type SegnaleCandidato = {
  tipo: TipoSegnaleCandidato;
  punti: number;
  dettaglio: string;
  evidenza: Evidenza | null;
};

export type OrdinePerCandidatura = {
  id: number;
  sedeId: number;
  codiceOrdine: string;
  commessaId: number;
  commessaCodice: string | null;
  fornitoreNome: string | null;
  dataConsegnaPrevista: string | null;
  importoTotale: number | null;
  codiciArticolo: readonly string[];
};

export type CandidatoOrdine = {
  ordineId: number;
  codiceOrdine: string;
  commessaId: number;
  commessaCodice: string | null;
  fornitoreNome: string | null;
  punteggio: number;
  segnali: SegnaleCandidato[];
  avvertenze: string[];
  rifiutato: boolean;
};

export type StatoCandidatura = "certa" | "candidata" | "ambigua" | "assente";

export type EsitoCandidatura = {
  stato: StatoCandidatura;
  motivo: string;
  candidati: CandidatoOrdine[];
};

export function generaCandidatiOrdine(input: {
  pagine: readonly string[];
  estrazione: EstrazioneConferma;
  ordini: readonly OrdinePerCandidatura[];
  documentoCommessaId: number;
  ordiniRifiutati: ReadonlySet<number>;
  /**
   * Il segnale «totale coincidente» confronta importi CRM: la sua stessa
   * presenza è un oracolo di uguaglianza (±0,50 €) su cifre che chi non ha
   * `economia.read` non può leggere altrove (revisione slice 2). Si
   * calcola quindi solo quando il chiamante ha la capability.
   */
  segnaliEconomici: boolean;
}): EsitoCandidatura {
  const candidati: CandidatoOrdine[] = [];

  for (const ordine of input.ordini) {
    const segnali: SegnaleCandidato[] = [];
    const avvertenze: string[] = [];

    const codiceEv = trovaRiferimentoTesto(input.pagine, ordine.codiceOrdine);
    if (codiceEv) {
      segnali.push({
        tipo: "codice_ordine",
        punti: PESO.codice_ordine,
        dettaglio: `Il documento cita il codice d'ordine ${ordine.codiceOrdine}.`,
        evidenza: codiceEv,
      });
    }

    if (ordine.commessaCodice) {
      const citata = input.estrazione.codiciCommessaCitati.find(
        c => c.valore === ordine.commessaCodice
      );
      if (citata) {
        segnali.push({
          tipo: "codice_commessa",
          punti: PESO.codice_commessa,
          dettaglio: `Il documento cita la commessa ${ordine.commessaCodice} dell'ordine.`,
          evidenza: citata.evidenza,
        });
      }
    }

    if (ordine.fornitoreNome && ordine.fornitoreNome.trim().length >= 3) {
      const fornitoreEv = trovaRiferimentoTesto(
        input.pagine,
        ordine.fornitoreNome
      );
      if (fornitoreEv) {
        segnali.push({
          tipo: "fornitore",
          punti: PESO.fornitore,
          dettaglio: `Il documento cita il fornitore ${ordine.fornitoreNome}.`,
          evidenza: fornitoreEv,
        });
      }
    }

    let puntiArticoli = 0;
    for (const codice of ordine.codiciArticolo) {
      if (puntiArticoli >= MAX_PUNTI_ARTICOLI) break;
      const articoloEv = trovaRiferimentoTesto(input.pagine, codice, "media");
      if (!articoloEv) continue;
      puntiArticoli += PESO.codice_articolo;
      segnali.push({
        tipo: "codice_articolo",
        punti: PESO.codice_articolo,
        dettaglio: `Il documento cita il codice articolo ${codice} dell'ordine.`,
        evidenza: articoloEv,
      });
    }

    if (
      ordine.dataConsegnaPrevista &&
      input.estrazione.dateConsegna.some(
        d => d.valore === ordine.dataConsegnaPrevista
      )
    ) {
      const data = input.estrazione.dateConsegna.find(
        d => d.valore === ordine.dataConsegnaPrevista
      )!;
      segnali.push({
        tipo: "data_consegna",
        punti: PESO.data_consegna,
        dettaglio:
          "La data di consegna nel documento coincide con quella prevista dall'ordine.",
        evidenza: data.evidenza,
      });
    }

    if (
      input.segnaliEconomici &&
      ordine.importoTotale != null &&
      ordine.importoTotale > 0 &&
      input.estrazione.totaleDocumento &&
      Math.abs(input.estrazione.totaleDocumento.valore - ordine.importoTotale) <=
        TOLLERANZA_TOTALE_EURO
    ) {
      // Niente cifre nel dettaglio: il candidato può essere letto da ruoli
      // senza capability economiche (slice 2 authz). L'evidenza cita il
      // documento, che chi guarda il fascicolo può già aprire.
      segnali.push({
        tipo: "totale",
        punti: PESO.totale,
        dettaglio: "Il totale del documento coincide con quello dell'ordine.",
        evidenza: input.estrazione.totaleDocumento.evidenza,
      });
    }

    if (segnali.length === 0) continue;

    if (ordine.commessaId !== input.documentoCommessaId) {
      avvertenze.push(
        "Il documento è archiviato nel fascicolo di un'altra commessa: collegandolo, verifica che non sia stato caricato nel posto sbagliato."
      );
    }

    candidati.push({
      ordineId: ordine.id,
      codiceOrdine: ordine.codiceOrdine,
      commessaId: ordine.commessaId,
      commessaCodice: ordine.commessaCodice,
      fornitoreNome: ordine.fornitoreNome,
      punteggio: segnali.reduce((somma, s) => somma + s.punti, 0),
      segnali,
      avvertenze,
      rifiutato: input.ordiniRifiutati.has(ordine.id),
    });
  }

  candidati.sort(
    (a, b) => b.punteggio - a.punteggio || a.ordineId - b.ordineId
  );

  // Lo stato si calcola sui candidati NON rifiutati: un rifiuto è una
  // decisione umana registrata, e non deve continuare a produrre «certa».
  const attivi = candidati.filter(c => !c.rifiutato);
  const conCodice = attivi.filter(c =>
    c.segnali.some(s => s.tipo === "codice_ordine")
  );

  if (attivi.length === 0) {
    return {
      stato: "assente",
      motivo:
        candidati.length > 0
          ? "Tutti i candidati trovati sono stati rifiutati."
          : "Nessun ordine della sede condivide riferimenti con questo documento.",
      candidati,
    };
  }
  if (conCodice.length === 1) {
    return {
      stato: "certa",
      motivo: `Il documento cita il codice d'ordine ${conCodice[0].codiceOrdine}: un solo ordine corrisponde. Serve comunque la tua conferma.`,
      candidati,
    };
  }
  if (conCodice.length > 1) {
    return {
      stato: "ambigua",
      motivo: `Il documento cita più codici d'ordine (${conCodice
        .map(c => c.codiceOrdine)
        .join(", ")}): scegli tu quello giusto.`,
      candidati,
    };
  }
  const migliore = attivi[0];
  if (migliore.punteggio < PUNTEGGIO_MINIMO_CANDIDATO) {
    return {
      stato: "assente",
      motivo:
        "I riferimenti trovati sono troppo deboli per proporre un ordine: date o totali coincidenti capitano anche per caso.",
      candidati,
    };
  }
  const pari = attivi.filter(c => c.punteggio === migliore.punteggio);
  if (pari.length > 1) {
    return {
      stato: "ambigua",
      motivo: `Più ordini combaciano con la stessa forza (${pari
        .map(c => c.codiceOrdine)
        .join(", ")}): nessun collegamento automatico, scegli tu.`,
      candidati,
    };
  }
  return {
    stato: "candidata",
    motivo: `${migliore.codiceOrdine} è il candidato più plausibile, ma il documento non ne cita il codice: conferma prima di collegare.`,
    candidati,
  };
}
