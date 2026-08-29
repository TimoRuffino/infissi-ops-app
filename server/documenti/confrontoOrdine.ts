// Confronto conferma d'ordine ↔ ordine fornitore (D7, slice 1 — PRD §54.6).
//
// Funzione pura: estrazione + ordine CRM → differenze tipizzate con gravità
// e impatto operativo. Non scrive niente e non decide niente: dice cosa non
// torna e lo prova con l'evidenza. L'ordine fornitore resta la nostra
// previsione; la conferma resta il documento del produttore (fonte tecnica
// autorevole, §54.3): il confronto ESPONE il disaccordo, non lo risolve.

import type {
  CampoEstratto,
  EstrazioneConferma,
  Evidenza,
} from "./estrazioneConferma";

export const CONFRONTO_ORDINE_VERSIONE = "1.0.0";

export type OrdinePerConfronto = {
  id: number;
  codiceOrdine: string;
  commessaCodice: string | null;
  dataConsegnaPrevista: string | null; // ISO
  importoTotale: number | null;
  righe: ReadonlyArray<{
    id: number;
    codiceArticolo?: string | null;
    descrizione: string;
    quantita: number;
  }>;
};

export type GravitaDifferenza = "bassa" | "media" | "alta";

export type Differenza = {
  tipo:
    | "riferimento_ordine_assente"
    | "commessa_incoerente"
    | "consegna_diversa"
    | "consegna_non_dichiarata"
    | "totale_diverso"
    | "riga_non_citata"
    | "quantita_diversa";
  gravita: GravitaDifferenza;
  dettaglio: string;
  evidenza: Evidenza | null;
};

/** Unica soglia per «totale coincide» (candidati) e «totale_diverso»
 * (confronto): due facce dello stesso numero, mai da divaricare. */
export const TOLLERANZA_TOTALE_EURO = 0.5;

export function dataItaliana(iso: string | null): string {
  if (!iso) return "nessuna data";
  const [anno, mese, giorno] = iso.split("-");
  return giorno && mese && anno ? `${giorno}/${mese}/${anno}` : iso;
}

function dettaglioData(iso: string): string {
  const [anno, mese, giorno] = iso.split("-");
  return `${giorno}/${mese}/${anno}`;
}

export function confrontaConfermaConOrdine(
  estrazione: EstrazioneConferma,
  ordine: OrdinePerConfronto
): Differenza[] {
  const differenze: Differenza[] = [];

  // Il documento cita il nostro ordine? Senza riferimento il collegamento è
  // una scelta dell'operatore, e va detto.
  if (!estrazione.riferimentoOrdine) {
    differenze.push({
      tipo: "riferimento_ordine_assente",
      gravita: "media",
      dettaglio: `Il documento non cita il codice del nostro ordine (${ordine.codiceOrdine}): verificare che la conferma sia proprio di questo ordine.`,
      evidenza: null,
    });
  }

  // Commessa citata diversa da quella dell'ordine → possibile documento
  // attaccato al fascicolo sbagliato: la peggiore delle sviste.
  if (ordine.commessaCodice) {
    const incoerente = estrazione.codiciCommessaCitati.find(
      citato => citato.valore !== ordine.commessaCodice
    );
    const coerente = estrazione.codiciCommessaCitati.some(
      citato => citato.valore === ordine.commessaCodice
    );
    if (incoerente && !coerente) {
      differenze.push({
        tipo: "commessa_incoerente",
        gravita: "alta",
        dettaglio: `Il documento cita ${incoerente.valore}, ma l'ordine appartiene a ${ordine.commessaCodice}.`,
        evidenza: incoerente.evidenza,
      });
    }
  }

  // Data di consegna: il cuore operativo del confronto.
  const consegnaDocumento: CampoEstratto<string> | null =
    estrazione.dateConsegna[0] ?? null;
  if (consegnaDocumento && ordine.dataConsegnaPrevista) {
    if (consegnaDocumento.valore !== ordine.dataConsegnaPrevista) {
      differenze.push({
        tipo: "consegna_diversa",
        gravita: "alta",
        dettaglio: `La conferma indica la consegna al ${dettaglioData(consegnaDocumento.valore)}, l'ordine prevede il ${dettaglioData(ordine.dataConsegnaPrevista)}.`,
        evidenza: consegnaDocumento.evidenza,
      });
    }
  } else if (consegnaDocumento && !ordine.dataConsegnaPrevista) {
    differenze.push({
      tipo: "consegna_diversa",
      gravita: "media",
      dettaglio: `La conferma indica la consegna al ${dettaglioData(consegnaDocumento.valore)}, ma l'ordine non ha una data prevista registrata.`,
      evidenza: consegnaDocumento.evidenza,
    });
  } else if (!consegnaDocumento && estrazione.settimaneConsegna.length === 0) {
    differenze.push({
      tipo: "consegna_non_dichiarata",
      gravita: "bassa",
      dettaglio:
        "Nel testo della conferma non è stata trovata una data o settimana di consegna.",
      evidenza: null,
    });
  }

  // Totale documento vs importo dell'ordine.
  if (
    estrazione.totaleDocumento &&
    ordine.importoTotale != null &&
    ordine.importoTotale > 0 &&
    Math.abs(estrazione.totaleDocumento.valore - ordine.importoTotale) >
      TOLLERANZA_TOTALE_EURO
  ) {
    differenze.push({
      tipo: "totale_diverso",
      gravita: "media",
      dettaglio: `Totale della conferma ${estrazione.totaleDocumento.valore.toFixed(2)} contro ${ordine.importoTotale.toFixed(2)} dell'ordine.`,
      evidenza: estrazione.totaleDocumento.evidenza,
    });
  }

  // Righe: codici articolo dell'ordine non citati, o quantità discordanti.
  for (const riga of estrazione.righe) {
    const rigaOrdine = ordine.righe.find(item => item.id === riga.rigaOrdineId);
    if (!rigaOrdine) continue;
    if (!riga.trovata) {
      differenze.push({
        tipo: "riga_non_citata",
        gravita: "media",
        dettaglio: `L'articolo ${riga.codiceArticolo} («${rigaOrdine.descrizione}») non compare nel testo della conferma.`,
        evidenza: null,
      });
      continue;
    }
    if (
      riga.quantitaDocumento &&
      riga.quantitaDocumento.valore !== rigaOrdine.quantita
    ) {
      differenze.push({
        tipo: "quantita_diversa",
        gravita: "media",
        dettaglio: `Quantità ${riga.quantitaDocumento.valore} in conferma contro ${rigaOrdine.quantita} in ordine per l'articolo ${riga.codiceArticolo} (lettura best-effort: verificare sul documento).`,
        evidenza: riga.quantitaDocumento.evidenza,
      });
    }
  }

  const rango: Record<GravitaDifferenza, number> = {
    alta: 0,
    media: 1,
    bassa: 2,
  };
  return differenze.sort((a, b) => rango[a.gravita] - rango[b.gravita]);
}
