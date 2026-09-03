// Le righe di merce di una conferma d'ordine, lette dal testo del PDF senza
// conoscere l'ordine (direzione 03/09/2026 sera: «va aperto nel magazzino
// la sua commessa e compilare la merce in arrivo in base a quanto scritto
// nella conf. ordine»).
//
// Nessun fornitore scrive la tabella allo stesso modo, e il testo estratto
// da un PDF perde le colonne: gli spazi doppi diventano singoli e, nei
// layout a colonne (Alias, 04/09/2026), unità e quantità si incollano alla
// descrizione anche a rovescio («NR 1,00PORST-C013 PORTA BLIND.STEEL»,
// «1,00NR253003 POMOLO … 0130,00») o finiscono nella riga sotto. Qui si
// riconoscono questi disegni e si scartano le righe che parlano di totali,
// indirizzi, pagamenti, trasporto. Il risultato è dichiaratamente a bassa
// confidenza: alimenta il magazzino, dove ogni riga resta modificabile.

export type RigaMerce = {
  nome: string;
  quantita: number;
  /** La riga di testo da cui è stata letta, per chi vuole controllare. */
  evidenza: string;
  pagina: number; // 1-based
};

export const ESTRATTORE_MERCE_VERSIONE = "1.1.0";

const MASSIMO_RIGHE = 40;

/** Righe che non sono merce anche se contengono un numero. */
const NON_MERCE =
  /\b(totale|tot\.|imponibile|subtotale|sconto|acconto|saldo|pagamento|bonifico|banca|iban|bic|swift|consegna|spedizione|trasporto|imballo|porto|resa|riferimento|rif\.|vs\.?\s*rif|ns\.?\s*rif|ordine\s+n|data|telefono|tel\.|cell\.|fax|e-?mail|pec|www\.|http|p\.?\s*iva|partita\s+iva|c\.?\s*f\.|codice\s+fiscale|cap\b|via\b|viale|piazza|p\.zza|corso|loc\.|località|frazione|note|condizioni|validit|pagina|pag\.|firma|timbro|iva\s*\d|aliquota|peso|kg\b|colli|mq\b|m²|spese)/i;

/** Prezzi e importi: si tolgono dalla descrizione, non sono il nome della merce. */
const IMPORTO = /(?:€|eur\.?)?\s*\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})\b(?:\s*(?:€|eur\.?))?/gi;

const UNITA = "(?:pz\\.?|pezzi|pcs|nr\\.?|n\\.|cad\\.?|stk|st\\.)";
const ETICHETTA_QUANTITA = "(?:q\\.?t[àa]\\.?|qty|quantit[àa])";
// Una quantità non è mai seguita da altre cifre: in «NR253003 POMOLO» il
// 253003 è un codice articolo, non 2530 pezzi.
const QUANTITA = "(\\d{1,4})(?:[.,]00?)?(?![0-9])";

// Quantità poi descrizione: «2 pz Finestra 2 ante PVC 1200x1400».
const QUANTITA_DESCRIZIONE = new RegExp(
  `^\\s*(?:n\\.?|nr\\.?|${ETICHETTA_QUANTITA})?\\s*${QUANTITA}\\s*(?:${UNITA}|x)\\s+(.{6,140})$`,
  "i"
);
// Unità e quantità incollate davanti alla descrizione (colonne a rovescio):
// «NR 1,00PORST-C013 PORTA BLIND.STEEL/C < 1900».
const UNITA_QUANTITA_DESCRIZIONE = new RegExp(
  `^\\s*(?:\\d{1,4},\\d{2})*${UNITA}\\s*${QUANTITA}\\s*([A-Za-z0-9][^\\s]*\\s+.{4,140}?)\\s*$`,
  "i"
);
// Quantità e unità incollate davanti: «1,00NR253003 POMOLO C.PORTA 0130,00».
const QUANTITA_UNITA_DESCRIZIONE = new RegExp(
  `^\\s*(?:\\d{1,4},\\d{2})*${QUANTITA}\\s*${UNITA}\\s*([A-Za-z0-9][^\\s]*\\s+.{4,140}?)\\s*$`,
  "i"
);
// Descrizione, quantità e unità (con o senza posizione e prezzi):
// «10 Finestra 2 ante PVC 1200x1400 2 pz 350,00 700,00».
const DESCRIZIONE_QUANTITA_UNITA = new RegExp(
  `^\\s*(?:\\d{1,3}[.)]?\\s+)?(.{6,140}?)\\s+${QUANTITA}\\s*${UNITA}(?=[\\s,;]|$)`,
  "i"
);
// Descrizione, unità e poi quantità: «PORTA BLIND.STEEL/C < 1900 NR 1,00».
const DESCRIZIONE_UNITA_QUANTITA = new RegExp(
  `^\\s*(?:\\d{1,3}[.)]?\\s+)?(.{6,140}?)\\s+${UNITA}\\s*${QUANTITA}(?=[\\s,;]|$)`,
  "i"
);
// Descrizione poi etichetta e quantità: «Persiana alluminio 2 ante q.tà 2».
const DESCRIZIONE_ETICHETTA_QUANTITA = new RegExp(
  `^\\s*(?:\\d{1,3}[.)]?\\s+)?(.{6,140}?)\\s+${ETICHETTA_QUANTITA}\\s*[:.]?\\s*${QUANTITA}\\b`,
  "i"
);
// La riga sotto una descrizione: «NR 1,00 22 99819,47» — unità, quantità e
// poi SOLO numeri (prezzi, aliquote), mai lettere.
const SOLO_UNITA_QUANTITA = new RegExp(
  `^\\s*${UNITA}\\s*${QUANTITA}(?:[\\s,;.%\\d]*)$`,
  "i"
);

function pulisciNome(grezzo: string): string {
  return grezzo
    .replace(IMPORTO, " ")
    // Coda di listino/sconto incollata («0130,00» → «01», «50,00 15,00»):
    // via i decimali e i numeri di 1-2 cifre in coda; le misure («< 1900»,
    // «750») restano, sono parte della descrizione.
    .replace(/(?:\s+(?:\d{1,4}[.,]\d{2}|\d{1,2}))+\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/[\s|;:.,-]+$/g, "")
    .replace(/^[\s|;:.,-]+/g, "")
    .trim()
    .slice(0, 120);
}

function lettere(testo: string): number {
  return (testo.match(/[a-zà-ù]/gi) ?? []).length;
}

function nomeValido(nome: string): boolean {
  if (lettere(nome) < 4) return false;
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
  const tentativi: Array<[RegExp, number, number]> = [
    [QUANTITA_DESCRIZIONE, 2, 1],
    [UNITA_QUANTITA_DESCRIZIONE, 2, 1],
    [QUANTITA_UNITA_DESCRIZIONE, 2, 1],
  ];
  for (const [re, nomeIdx, qtaIdx] of tentativi) {
    const m = re.exec(riga);
    if (!m) continue;
    const letta = candidato(m[nomeIdx], m[qtaIdx]);
    if (letta) return letta;
  }
  if (NON_MERCE.test(riga.slice(0, 30))) return null;
  for (const re of [DESCRIZIONE_QUANTITA_UNITA, DESCRIZIONE_UNITA_QUANTITA, DESCRIZIONE_ETICHETTA_QUANTITA]) {
    const m = re.exec(riga);
    if (!m) continue;
    const letta = candidato(m[1], m[2]);
    if (letta) return letta;
  }
  return null;
}

/**
 * Una descrizione da sola («KPO44 KIT PORTA») con unità e quantità nella
 * riga sotto, saltando al più due righe di soli codici («26C0374604 -
 * 003460 - .»).
 */
function leggiConRigaSotto(
  righe: readonly string[],
  indice: number
): { nome: string; quantita: number } | null {
  const riga = righe[indice];
  // Una riga di configurazione con il prezzo in coda («… 445,00 NETTO») non è
  // una descrizione di merce in attesa della quantità.
  if (lettere(riga) < 4 || /\d{1,3}(?:[.\s]\d{3})*,\d{2}(?:\s*[A-Z]+)?\s*$/.test(riga.trim())) {
    return null;
  }
  if (NON_MERCE.test(riga.slice(0, 30))) return null;
  for (let salto = 1; salto <= 3 && indice + salto < righe.length; salto += 1) {
    const sotto = righe[indice + salto];
    const m = SOLO_UNITA_QUANTITA.exec(sotto);
    if (m) return candidato(riga, m[1]);
    // Una riga di soli codici/numeri si salta; una con parole chiude.
    if (lettere(sotto) >= 4) return null;
  }
  return null;
}

/** Le righe di merce riconosciute nelle pagine, nell'ordine in cui compaiono. */
export function estraiRigheMerce(pagine: readonly string[]): RigaMerce[] {
  const righe: RigaMerce[] = [];
  const visti = new Set<string>();
  pagine.forEach((testo, indicePagina) => {
    const linee = testo.split(/\r?\n/).map(r => r.replace(/\t/g, "  ").trimEnd());
    for (let i = 0; i < linee.length; i += 1) {
      const riga = linee[i];
      if (riga.trim().length < 8) continue;
      const letta = leggiRiga(riga) ?? leggiConRigaSotto(linee, i);
      if (!letta) continue;
      const chiave = letta.nome.toLowerCase();
      if (visti.has(chiave)) continue;
      visti.add(chiave);
      righe.push({
        nome: letta.nome,
        quantita: letta.quantita,
        evidenza: riga.trim().slice(0, 160),
        pagina: indicePagina + 1,
      });
      if (righe.length >= MASSIMO_RIGHE) return;
    }
  });
  return righe;
}

/**
 * Il lunedì della settimana ISO indicata: una conferma che dice «settimana
 * 38» promette la merce da quel lunedì. L'anno è quello dichiarato accanto
 * («2026 Settimana 21»), altrimenti quello del riferimento; se la settimana
 * è già passata da più di due mesi rispetto al riferimento, si intende
 * l'anno successivo.
 */
export function dataDaSettimanaIso(
  settimana: number,
  riferimento: Date,
  anno?: number | null
): string | null {
  if (!Number.isInteger(settimana) || settimana < 1 || settimana > 53) return null;
  const lunedi = (a: number): Date => {
    const quattroGennaio = new Date(Date.UTC(a, 0, 4));
    const giornoIso = quattroGennaio.getUTCDay() || 7; // 1 = lunedì … 7 = domenica
    const primo = new Date(quattroGennaio.getTime() - (giornoIso - 1) * 86_400_000);
    return new Date(primo.getTime() + (settimana - 1) * 7 * 86_400_000);
  };
  if (anno != null && anno >= 2000 && anno <= 2100) {
    return lunedi(anno).toISOString().slice(0, 10);
  }
  let data = lunedi(riferimento.getUTCFullYear());
  if (data.getTime() < riferimento.getTime() - 60 * 86_400_000) {
    data = lunedi(riferimento.getUTCFullYear() + 1);
  }
  return data.toISOString().slice(0, 10);
}
