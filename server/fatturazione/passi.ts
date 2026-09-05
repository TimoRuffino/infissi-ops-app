// server/fatturazione/passi.ts
// Lo stato dei quattro passi della fatturazione guidata (piano 4) come
// funzione pura: nessuno store, nessun I/O. Il router `fatturazioneGuidata`
// (task successivo) legge commesse, documenti, contratto, computo e
// fatture una sola volta e passa qui solo i campi che servono.
//
// Specifica: docs/superpowers/specs/2026-09-05-fatturazione-guidata-design.md
// §4.1 (stato dei passi) e §4.3 (importi).
import {
  ORDINE_PASSI,
  type EsitoPasso,
  type PassoFatturazione,
} from "@shared/fatturazione/passi";

/** Ciò che il router ha già letto per una commessa, ridotto all'essenziale. */
export type IngressoPassi = {
  documenti: { tipo: string; mimeType: string }[];
  contratto: {
    righe: number;
    pattuitoCent: number;
    pattuitoTipo: "lordo" | "imponibile";
  } | null;
  computo: { valido: boolean; esito: "ok" | "incompleto" } | null;
  /** Fatture CRM della commessa (nessuna FiC qui: quelle escludono a monte, §4.2). */
  fatture: { stato: string; totaleCent: number; tipo: string }[];
  flag: { limiti: boolean; fatturazione: boolean };
};

/**
 * Gli stati oltre i quali una fattura di tipo `fattura` conta come emessa:
 * il passo Fattura è «fatto» da qui in poi. `scartata`/`rifiutata` restano
 * fuori apposta — vanno corrette, non sono un traguardo.
 */
export const STATI_FATTURA_EMESSA = new Set([
  "emessa",
  "inviata",
  "consegnata",
  "mancata_consegna",
]);

export type RisultatoPassi = {
  passi: Record<PassoFatturazione, EsitoPasso>;
  prossimoPasso: PassoFatturazione | null;
  fatturaStato: string | null;
  fatturaPrevistaCent: number | null;
  fatturaPrevistaStima: boolean;
};

/**
 * Documenti: fatto se esiste un contratto strutturato o almeno un
 * documento di tipo `contratto` nel fascicolo — non è un passo che si può
 * lasciare a metà, quindi non ha uno stato `in_corso`.
 */
function esitoDocumenti(i: IngressoPassi): EsitoPasso {
  const bastaUnDocumento = i.documenti.some((d) => d.tipo === "contratto");
  return i.contratto != null || bastaUnDocumento ? "fatto" : "da_fare";
}

/** Contratto: fatto con almeno una riga, in corso se esiste ma è ancora vuoto. */
function esitoContratto(i: IngressoPassi): EsitoPasso {
  if (i.contratto == null) return "da_fare";
  return i.contratto.righe >= 1 ? "fatto" : "in_corso";
}

/**
 * Limiti: non disponibile a flag spento (prima di ogni altro controllo:
 * senza il flag il computo non si fa, punto). Fatto solo se il computo è
 * valido con esito `ok`; se il computo esiste ma non è così, è in corso.
 */
function esitoLimiti(i: IngressoPassi): EsitoPasso {
  if (!i.flag.limiti) return "non_disponibile";
  if (i.computo == null) return "da_fare";
  return i.computo.valido && i.computo.esito === "ok" ? "fatto" : "in_corso";
}

/**
 * Fattura: non disponibile a flag spento. Fatto solo da una fattura vera
 * (tipo `fattura`, non una nota di credito) arrivata a uno stato di
 * `STATI_FATTURA_EMESSA`. In corso se esiste una fattura (di qualunque
 * tipo) non annullata: una nota di credito o una bozza in lavorazione sono
 * comunque un segno che il passo non è più «da fare».
 */
function esitoFattura(i: IngressoPassi): EsitoPasso {
  if (!i.flag.fatturazione) return "non_disponibile";
  const emessa = i.fatture.some(
    (f) => f.tipo === "fattura" && STATI_FATTURA_EMESSA.has(f.stato)
  );
  if (emessa) return "fatto";
  const attiva = i.fatture.some((f) => f.stato !== "annullata");
  return attiva ? "in_corso" : "da_fare";
}

/**
 * Lo stato della fattura più recente non annullata, per la card
 * (`fatturaStato`). Le annullate sono escluse a monte: una fattura
 * annullata non deve mai comparire come «lo stato attuale» della
 * commessa, altrimenti sembra che manchi ancora tutto mentre invece si sta
 * rifatturando. Il chiamante passa `fatture` in ordine cronologico
 * (dalla più vecchia): l'ultima non annullata è la più recente.
 *
 * Ruling P4-R2: solo `tipo === "fattura"` conta. Una nota di credito può
 * convivere con la fattura vera già emessa (è nata per correggerla) e non
 * deve mai mascherarne lo stato — la bozza della nota di credito non è la
 * bozza della fattura della commessa.
 */
function ultimoStatoNonAnnullato(
  fatture: IngressoPassi["fatture"]
): string | null {
  const attive = fatture.filter(
    (f) => f.tipo === "fattura" && f.stato !== "annullata"
  );
  return attive.length > 0 ? attive[attive.length - 1].stato : null;
}

/**
 * L'importo di fattura previsto (§4.3): quello di una bozza/in-emissione se
 * esiste già — è un importo vero, non una stima — altrimenti il pattuito,
 * lordo com'è o, se il pattuito è imponibile, maggiorato del 10% e
 * dichiarato come stima. Senza contratto non c'è base per prevedere nulla.
 *
 * Ruling P4-R2: stesso confine di `ultimoStatoNonAnnullato` — la bozza di
 * una nota di credito non è l'importo di fattura atteso della commessa.
 */
function prevediFattura(
  i: IngressoPassi
): Pick<RisultatoPassi, "fatturaPrevistaCent" | "fatturaPrevistaStima"> {
  const bozza = i.fatture.find(
    (f) =>
      f.tipo === "fattura" && (f.stato === "bozza" || f.stato === "in_emissione")
  );
  if (bozza) {
    return { fatturaPrevistaCent: bozza.totaleCent, fatturaPrevistaStima: false };
  }
  if (i.contratto == null) {
    return { fatturaPrevistaCent: null, fatturaPrevistaStima: false };
  }
  if (i.contratto.pattuitoTipo === "lordo") {
    return {
      fatturaPrevistaCent: i.contratto.pattuitoCent,
      fatturaPrevistaStima: false,
    };
  }
  return {
    fatturaPrevistaCent: Math.round(i.contratto.pattuitoCent * 1.1),
    fatturaPrevistaStima: true,
  };
}

export function calcolaPassi(i: IngressoPassi): RisultatoPassi {
  const passi: Record<PassoFatturazione, EsitoPasso> = {
    documenti: esitoDocumenti(i),
    contratto: esitoContratto(i),
    limiti: esitoLimiti(i),
    fattura: esitoFattura(i),
  };

  const prossimoPasso =
    ORDINE_PASSI.find(
      (passo) => passi[passo] !== "fatto" && passi[passo] !== "non_disponibile"
    ) ?? null;

  return {
    passi,
    prossimoPasso,
    fatturaStato: ultimoStatoNonAnnullato(i.fatture),
    ...prevediFattura(i),
  };
}
