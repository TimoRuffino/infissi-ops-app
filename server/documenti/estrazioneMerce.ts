// Le righe di merce di una conferma d'ordine, lette dal testo del PDF senza
// conoscere l'ordine (direzione 03/09/2026 sera: «va aperto nel magazzino
// la sua commessa e compilare la merce in arrivo in base a quanto scritto
// nella conf. ordine»).
//
// Nessun fornitore scrive la tabella allo stesso modo, e il testo estratto
// da un PDF perde le colonne (gli spazi doppi diventano singoli). Qui si
// riconoscono i tre disegni più comuni — «N pz descrizione», «descrizione N
// pz [prezzi]» e «descrizione q.tà N» — e si scartano le righe che parlano
// di totali, indirizzi, pagamenti. Il risultato è dichiaratamente a bassa
// confidenza: alimenta il magazzino, dove ogni riga resta modificabile.

export type RigaMerce = {
  nome: string;
  quantita: number;
  /** La riga di testo da cui è stata letta, per chi vuole controllare. */
  evidenza: string;
  pagina: number; // 1-based
};

export const ESTRATTORE_MERCE_VERSIONE = "1.0.0";

const MASSIMO_RIGHE = 40;

/** Righe che non sono merce anche se contengono un numero. */
const NON_MERCE =
  /\b(totale|tot\.|imponibile|subtotale|sconto|acconto|saldo|pagamento|bonifico|banca|iban|bic|swift|consegna|spedizione|trasporto|imballo|porto|resa|riferimento|rif\.|vs\.?\s*rif|ns\.?\s*rif|ordine\s+n|data|telefono|tel\.|cell\.|fax|e-?mail|pec|www\.|http|p\.?\s*iva|partita\s+iva|c\.?\s*f\.|codice\s+fiscale|cap\b|via\b|viale|piazza|p\.zza|corso|loc\.|località|frazione|note|condizioni|validit|pagina|pag\.|firma|timbro|iva\s*\d|aliquota|peso|kg\b|colli|mq\b|m²)/i;

/** Prezzi e importi: si tolgono dalla descrizione, non sono il nome della merce. */
const IMPORTO = /(?:€|eur\.?)?\s*\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})\b(?:\s*(?:€|eur\.?))?/gi;

const UNITA = "(?:pz\\.?|pezzi|pcs|nr\\.?|n\\.|cad\\.?|stk|st\\.)";
const ETICHETTA_QUANTITA = "(?:q\\.?t[àa]\\.?|qty|quantit[àa])";

// Quantità poi descrizione: «2 pz Finestra 2 ante PVC 1200x1400».
const QUANTITA_DESCRIZIONE = new RegExp(
  `^\\s*(?:n\\.?|nr\\.?|${ETICHETTA_QUANTITA})?\\s*(\\d{1,4})\\s*(?:${UNITA}|x)\\s+(.{6,140})$`,
  "i"
);
// Descrizione, quantità e unità (con o senza posizione e prezzi):
// «10 Finestra 2 ante PVC 1200x1400 2 pz 350,00 700,00».
const DESCRIZIONE_QUANTITA_UNITA = new RegExp(
  `^\\s*(?:\\d{1,3}[.)]?\\s+)?(.{6,140}?)\\s+(\\d{1,4})(?:[.,]00?)?\\s*${UNITA}(?=[\\s,;]|$)`,
  "i"
);
// Descrizione poi etichetta e quantità: «Persiana alluminio 2 ante q.tà 2».
const DESCRIZIONE_ETICHETTA_QUANTITA = new RegExp(
  `^\\s*(?:\\d{1,3}[.)]?\\s+)?(.{6,140}?)\\s+${ETICHETTA_QUANTITA}\\s*[:.]?\\s*(\\d{1,4})(?:[.,]00?)?\\b`,
  "i"
);

function pulisciNome(grezzo: string): string {
  return grezzo
    .replace(IMPORTO, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/[\s|;:.,-]+$/g, "")
    .replace(/^[\s|;:.,-]+/g, "")
    .trim()
    .slice(0, 120);
}

function nomeValido(nome: string): boolean {
  const lettere = (nome.match(/[a-zà-ù]/gi) ?? []).length;
  if (lettere < 4) return false;
  if (NON_MERCE.test(nome.slice(0, 40))) return false;
  return true;
}

function candidato(
  nomeGrezzo: string,
  quantitaGrezza: string
): { nome: string; quantita: number } | null {
  const nome = pulisciNome(nomeGrezzo);
  const quantita = Number(quantitaGrezza);
  if (!nomeValido(nome) || !(quantita >= 1 && quantita <= 9999)) return null;
  return { nome, quantita };
}

function leggiRiga(riga: string): { nome: string; quantita: number } | null {
  const qtaPrima = QUANTITA_DESCRIZIONE.exec(riga);
  if (qtaPrima) {
    const letta = candidato(qtaPrima[2], qtaPrima[1]);
    if (letta) return letta;
  }
  if (NON_MERCE.test(riga.slice(0, 30))) return null;
  const conUnita = DESCRIZIONE_QUANTITA_UNITA.exec(riga);
  if (conUnita) {
    const letta = candidato(conUnita[1], conUnita[2]);
    if (letta) return letta;
  }
  const conEtichetta = DESCRIZIONE_ETICHETTA_QUANTITA.exec(riga);
  if (conEtichetta) {
    const letta = candidato(conEtichetta[1], conEtichetta[2]);
    if (letta) return letta;
  }
  return null;
}

/** Le righe di merce riconosciute nelle pagine, nell'ordine in cui compaiono. */
export function estraiRigheMerce(pagine: readonly string[]): RigaMerce[] {
  const righe: RigaMerce[] = [];
  const visti = new Set<string>();
  pagine.forEach((testo, indice) => {
    for (const grezza of testo.split(/\r?\n/)) {
      const riga = grezza.replace(/\t/g, "  ").trimEnd();
      if (riga.trim().length < 8) continue;
      const letta = leggiRiga(riga);
      if (!letta) continue;
      const chiave = letta.nome.toLowerCase();
      if (visti.has(chiave)) continue;
      visti.add(chiave);
      righe.push({
        nome: letta.nome,
        quantita: letta.quantita,
        evidenza: riga.trim().slice(0, 160),
        pagina: indice + 1,
      });
      if (righe.length >= MASSIMO_RIGHE) return;
    }
  });
  return righe;
}

/**
 * Il lunedì della settimana ISO indicata: una conferma che dice «settimana
 * 38» promette la merce da quel lunedì. L'anno è quello del documento (o
 * l'anno corrente); se la settimana è già passata da più di due mesi
 * rispetto al riferimento, si intende l'anno successivo.
 */
export function dataDaSettimanaIso(settimana: number, riferimento: Date): string | null {
  if (!Number.isInteger(settimana) || settimana < 1 || settimana > 53) return null;
  const lunedi = (anno: number): Date => {
    const quattroGennaio = new Date(Date.UTC(anno, 0, 4));
    const giornoIso = quattroGennaio.getUTCDay() || 7; // 1 = lunedì … 7 = domenica
    const primo = new Date(quattroGennaio.getTime() - (giornoIso - 1) * 86_400_000);
    return new Date(primo.getTime() + (settimana - 1) * 7 * 86_400_000);
  };
  let data = lunedi(riferimento.getUTCFullYear());
  if (data.getTime() < riferimento.getTime() - 60 * 86_400_000) {
    data = lunedi(riferimento.getUTCFullYear() + 1);
  }
  return data.toISOString().slice(0, 10);
}
