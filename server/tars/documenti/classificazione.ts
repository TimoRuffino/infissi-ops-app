// Classificazione deterministica degli allegati di comunicazione (T4).
//
// Nessun modello: soltanto segnali lessicali chiusi su nome file, oggetto e
// testo estratto. L'esito è un DATO (tipo candidato + confidenza + segnali),
// mai un'autorizzazione: chi archivia decide con capability e policy proprie.
// Il contenuto resta non fidato: un'istruzione dentro il documento è testo.

import type { DocTipo } from "../../routers/preventiviContratti";

export type ConfidenzaClassificazione = "alta" | "media" | "bassa";

export type ClassificazioneAllegato = {
  tipo: DocTipo;
  confidenza: ConfidenzaClassificazione;
  /** Segnali lessicali che hanno determinato il tipo, per le evidenze. */
  segnali: string[];
};

type Regola = {
  tipo: DocTipo;
  /** Segnali sul nome file (peso 2: il nome è scelto da chi invia il file). */
  nome?: RegExp;
  /** Segnali sull'oggetto della comunicazione (peso 2). */
  oggetto?: RegExp;
  /** Segnali sul testo estratto (peso 1: contenuto non fidato). */
  testo?: RegExp;
  etichetta: string;
};

// Ordine = priorità a parità di punteggio: i tipi più specifici precedono
// i generici (conferma_ordine prima di ordine, ddt_posa prima di ddt_consegna).
const REGOLE: readonly Regola[] = [
  {
    tipo: "conferma_ordine",
    nome: /conferma[\s_-]*(?:d.)?ordine|order[\s_-]*confirmation|\bab\b|auftragsbest/i,
    oggetto: /conferma[\s_-]*(?:d.)?ordine/i,
    testo: /conferma\s+(?:d.)?ordine|order\s+confirmation|auftragsbest/i,
    etichetta: "conferma d'ordine",
  },
  {
    tipo: "ddt_posa",
    nome: /ddt[\s_-]*posa/i,
    oggetto: /ddt[\s_-]*posa/i,
    testo: /documento\s+di\s+trasporto[\s\S]{0,120}?posa|ddt[\s_-]*posa/i,
    etichetta: "DDT di posa",
  },
  {
    tipo: "ddt_finale",
    nome: /ddt[\s_-]*finale/i,
    oggetto: /ddt[\s_-]*finale/i,
    testo: /ddt[\s_-]*finale/i,
    etichetta: "DDT finale",
  },
  {
    tipo: "ddt_consegna",
    nome: /\bddt\b|documento[\s_-]*di[\s_-]*trasporto|bolla[\s_-]*(?:di[\s_-]*)?consegna/i,
    oggetto: /\bddt\b|bolla[\s_-]*(?:di[\s_-]*)?consegna|consegna\s+materiale/i,
    testo: /documento\s+di\s+trasporto|\bddt\b/i,
    etichetta: "DDT di consegna",
  },
  {
    tipo: "preventivo",
    nome: /preventivo|quotazione|\boffert[ae]\b/i,
    oggetto: /preventivo|quotazione/i,
    testo: /\bpreventivo\b(?:\s+n\.?\s*[\w/-]+)?/i,
    etichetta: "preventivo",
  },
  {
    tipo: "contratto",
    nome: /contratto/i,
    oggetto: /contratto/i,
    testo: /contratto\s+di\s+(?:fornitura|appalto|vendita|posa)/i,
    etichetta: "contratto",
  },
  {
    tipo: "misure",
    nome: /\bmisur[ae]\b|rilievo/i,
    oggetto: /\bmisur[ae]\b|rilievo/i,
    testo: /rilievo\s+(?:misure|finestre|serramenti)|misure\s+esecutive/i,
    etichetta: "misure/rilievo",
  },
  {
    tipo: "fattura",
    nome: /fattura|\bft[\s_-]?\d|invoice/i,
    oggetto: /fattura|invoice/i,
    testo: /\bfattura\b\s+n\.?\s*[\w/-]+|imponibile/i,
    etichetta: "fattura",
  },
  {
    tipo: "ordine",
    nome: /\bordine\b|purchase[\s_-]*order|\bpo[\s_-]?\d/i,
    oggetto: /\bordine\b/i,
    testo: /ordine\s+(?:d.acquisto|fornitore)\s*n\.?/i,
    etichetta: "ordine fornitore",
  },
  {
    tipo: "saldo",
    nome: /\bsaldo\b|ricevuta[\s_-]*saldo/i,
    oggetto: /ricevuta\s+saldo/i,
    testo: /ricevuta\s+(?:di\s+)?saldo/i,
    etichetta: "ricevuta saldo",
  },
  {
    tipo: "documento_identita",
    nome: /carta[\s_-]*(?:d.)?identit|documento[\s_-]*(?:d.)?identit|passaporto/i,
    oggetto: /documento\s+(?:d.)?identit/i,
    testo: /carta\s+d.identit|repubblica\s+italiana[\s\S]{0,80}identit/i,
    etichetta: "documento d'identità",
  },
  {
    tipo: "visura",
    nome: /visura/i,
    oggetto: /visura/i,
    testo: /visura\s+(?:camerale|catastale)/i,
    etichetta: "visura",
  },
  {
    tipo: "planimetria",
    nome: /planimetri|piantina/i,
    oggetto: /planimetri/i,
    testo: /planimetri/i,
    etichetta: "planimetria",
  },
  {
    tipo: "certificazione",
    nome: /certificaz|dichiarazione[\s_-]*di[\s_-]*conformit/i,
    oggetto: /certificaz/i,
    testo: /certificazione|dichiarazione\s+di\s+conformit/i,
    etichetta: "certificazione",
  },
];

function normalizza(valore: string | null | undefined): string {
  return String(valore ?? "").slice(0, 20_000);
}

/**
 * Classifica un allegato con regole chiuse. Il pareggio premia la regola più
 * specifica (ordine di dichiarazione). Nessun segnale ⇒ `altro`/bassa.
 */
export function classificaAllegatoComunicazione(input: {
  nome: string;
  mimeType: string;
  oggetto: string | null;
  testo: string | null;
}): ClassificazioneAllegato {
  const nome = normalizza(input.nome);
  const oggetto = normalizza(input.oggetto);
  const testo = normalizza(input.testo);

  let migliore: {
    regola: Regola;
    punteggio: number;
    segnali: string[];
  } | null = null;

  for (const regola of REGOLE) {
    let punteggio = 0;
    const segnali: string[] = [];
    if (regola.nome && regola.nome.test(nome)) {
      punteggio += 2;
      segnali.push(`nome file compatibile con ${regola.etichetta}`);
    }
    if (regola.oggetto && oggetto && regola.oggetto.test(oggetto)) {
      punteggio += 2;
      segnali.push(`oggetto della comunicazione compatibile con ${regola.etichetta}`);
    }
    if (regola.testo && testo && regola.testo.test(testo)) {
      punteggio += 1;
      segnali.push(
        `testo estratto (non fidato) compatibile con ${regola.etichetta}`
      );
    }
    if (punteggio > 0 && (!migliore || punteggio > migliore.punteggio)) {
      migliore = { regola, punteggio, segnali };
    }
  }

  if (migliore) {
    return {
      tipo: migliore.regola.tipo,
      confidenza:
        migliore.punteggio >= 3
          ? "alta"
          : migliore.punteggio === 2
            ? "media"
            : "bassa",
      segnali: migliore.segnali,
    };
  }

  if (/^image\//i.test(input.mimeType)) {
    return {
      tipo: "foto",
      confidenza: "media",
      segnali: ["immagine senza segnali documentali: classificata come foto"],
    };
  }

  return {
    tipo: "altro",
    confidenza: "bassa",
    segnali: [],
  };
}
