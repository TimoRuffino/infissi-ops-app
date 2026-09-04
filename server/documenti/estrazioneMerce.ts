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

// 1.2.0 (04/09/2026): righe a CELLE (tre spazi fra le colonne, come le
// ricostruisce la geometria del PDF), unità a misura nel nome, righe uguali
// che si sommano invece di sparire.
export const ESTRATTORE_MERCE_VERSIONE = "1.2.0";

const MASSIMO_RIGHE = 40;

/** Righe che non sono merce anche se contengono un numero. */
const NON_MERCE =
  /\b(totale|tot\.|imponibile|subtotale|sconto|acconto|saldo|pagamento|bonifico|banca|iban|bic|swift|consegna|spedizione|trasporto|imballo|imballagg\w*|gabbia|bancale|pallet|porto|resa|riferimento|rif\.|vs\.?\s*rif|ns\.?\s*rif|ordine\s+n|data|telefono|tel\.|cell\.|fax|e-?mail|pec|www\.|http|p\.?\s*iva|partita\s+iva|c\.?\s*f\.|codice\s+fiscale|cap\b|via\b|viale|piazza|p\.zza|corso|loc\.|località|frazione|note|condizioni|validit|pagina|pag\.|firma|timbro|iva\s*\d|aliquota|peso|kg\b|colli|mq\b|m²|spese|oggetto|maggiorazion\w*|supplemento|sovrapprezzo|ai\s+sensi|artt?\.|documento|disegni|allegat\w*|descrizione|commessa\s+n\.?\s*\d)/i;

/** Una frase (condizioni di vendita, note) non è una riga di merce: tante parole minuscole, niente cifre. */
function sembraFrase(testo: string): boolean {
  const parole = testo.trim().split(/\s+/);
  if (parole.length < 8) return false;
  const minuscole = parole.filter(p => /^[a-zà-ù]/.test(p)).length;
  const cifre = (testo.match(/\d/g) ?? []).length;
  return minuscole >= parole.length * 0.6 && cifre <= 2;
}

// Unità «a pezzi» (la quantità è un intero di magazzino) e «a misura»
// (metri, chili: la quantità resta scritta nel nome, a magazzino conta 1).
const UNITA_PEZZI =
  /^(?:pz\.?|pezzi|pcs|nr\.?|n\.?|n°|cad\.?|stk|st\.?|vg\.?|cf\.?|conf\.?|set|kit|pa\.?|paia|cp\.?|coppi[ae])$/i;
const UNITA_MISURA = /^(?:ml|mq|m²|m|mt|mtl|kg|lt?|l\.|cm)$/i;
// La cella della quantità: un numero, al più seguito da altro testo della
// stessa colonna («2 SALA-CAMERA - BOTTI», Primed mette il subcliente accanto).
const QUANTITA_CELLA = /^(\d{1,4}(?:[.,]\d{1,3})?)(?:\s|$)/;
// Sotto una riga a misura (12,720 MQ) alcuni fornitori scrivono i pezzi:
// «1570x2700H -col A01 - pz 3» (Gianesin).
// Solo interi: «N. 1,0 x 469,5» (BT Glass) è una misura, non un conteggio.
const PEZZI_NELLA_RIGA_SOTTO =
  /\b(?:pz\.?|pezzi|nr\.?|n\.)\s*(\d{1,4})(?![.,]?\d)|\b(\d{1,4})\s*(?:pz\.?|pezzi)\b/i;

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
    // Il numero di posizione davanti a un codice o a un nome maiuscolo
    // («17 ADLIS», «12 PRLAVL14AM.RAL»); «2 ante» resta.
    .replace(/^\s*\d{1,3}\s+(?=[A-Z0-9][A-Za-z0-9.\-\/]*\s|[A-Z])/, "")
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
  if (sembraFrase(nome)) return false;
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
 * Riga di tabella a CELLE, tre spazi fra le colonne: «G71   SISTEMA
 * SCORREVOLE TUTTOVETRO   PZ   1,00   2.392,95 …» oppure «60-00406   LAMIERA
 * A DISEGNO   ML   4,70   30,00 …». Le celle prima dell'unità sono codice e
 * descrizione; la cella dopo è la quantità.
 */
function leggiRigaCelle(
  riga: string,
  rigaSotto: string | null
): { nome: string; quantita: number; usaRigaSotto: boolean } | null {
  let celle = riga.split(/\s{3,}/).map(c => c.trim()).filter(c => c.length > 0);
  // Il numero di posizione («3», «10», anche incollato al codice: «12 PRLAVL14AM.RAL»)
  // non fa parte della descrizione.
  if (celle.length > 3 && /^\d{1,3}$/.test(celle[0])) celle = celle.slice(1);
  else if (celle.length >= 3) celle[0] = celle[0].replace(/^\d{1,3}\s+(?=[A-Z0-9])/, "");
  if (celle.length < 3) return null;
  for (let u = 1; u < celle.length - 1; u += 1) {
    const unita = celle[u];
    const aPezzi = UNITA_PEZZI.test(unita);
    const aMisura = !aPezzi && UNITA_MISURA.test(unita);
    if (!aPezzi && !aMisura) continue;
    // La quantità sta prima dell'unità («2   pz   350,00») o dopo («PZ   1,00»).
    const prima = u >= 2 && /^\d{1,4}(?:[.,]\d{1,3})?$/.test(celle[u - 1]) ? celle[u - 1] : null;
    const q = prima ? [prima, prima] : QUANTITA_CELLA.exec(celle[u + 1]);
    if (!q) continue;
    const quantita = Number(q[1].replace(",", "."));
    if (!(quantita > 0 && quantita <= 9999)) continue;
    const descrizione = celle.slice(0, prima ? u - 1 : u).join(" ");
    if (lettere(descrizione) < 4 || NON_MERCE.test(descrizione.slice(0, 40))) return null;
    const nome = pulisciNome(descrizione);
    if (!nomeValido(nome)) return null;
    if (aMisura) {
      // «12,720 MQ» e sotto «1570x2700H -col A01 - pz 3»: tre pezzi di quella
      // misura, e la misura resta nel nome.
      const pezzi = rigaSotto ? PEZZI_NELLA_RIGA_SOTTO.exec(rigaSotto) : null;
      const quantitaPezzi = pezzi ? Number(pezzi[1] ?? pezzi[2]) : 0;
      const coda = pezzi
        ? " " + rigaSotto!.replace(PEZZI_NELLA_RIGA_SOTTO, "").replace(/[\s\-–,;]+$/, "").trim()
        : "";
      return {
        nome: `${nome} (${q[1]} ${unita.toUpperCase()})${coda}`.replace(/\s+/g, " ").slice(0, 120),
        quantita: quantitaPezzi >= 1 && quantitaPezzi <= 9999 ? quantitaPezzi : 1,
        usaRigaSotto: pezzi != null,
      };
    }
    return { nome, quantita: Math.max(1, Math.round(quantita)), usaRigaSotto: false };
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
  // una descrizione di merce in attesa della quantità; una che finisce con un
  // trattino o una virgola («FRIZIONATA-AMBRA,EV-») è la coda di una
  // descrizione spezzata, non un articolo.
  if (
    lettere(riga) < 4 ||
    /\d{1,3}(?:[.\s]\d{3})*,\d{2}(?:\s*[A-Z]+)?\s*$/.test(riga.trim()) ||
    /[-–,]$/.test(riga.trim())
  ) {
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

/**
 * Le righe di merce riconosciute nelle pagine, nell'ordine in cui compaiono.
 * Lo stesso articolo su più righe (tre «SISTEMA SCORREVOLE TUTTOVETRO» di
 * misure diverse) è una riga sola con le quantità sommate: a magazzino
 * arrivano tre sistemi, non uno.
 */
export function estraiRigheMerce(pagine: readonly string[]): RigaMerce[] {
  const righe: RigaMerce[] = [];
  const visti = new Map<string, RigaMerce>();
  pagine.forEach((testo, indicePagina) => {
    const linee = testo.split(/\r?\n/).map(r => r.replace(/\t/g, "  ").trim());
    for (let i = 0; i < linee.length; i += 1) {
      const riga = linee[i];
      if (riga.length < 8) continue;
      const aCelle = leggiRigaCelle(riga, linee[i + 1] ?? null);
      if (aCelle?.usaRigaSotto) i += 1;
      const letta = aCelle ?? leggiRiga(riga) ?? leggiConRigaSotto(linee, i);
      if (!letta) continue;
      const chiave = letta.nome.toLowerCase();
      const gia = visti.get(chiave);
      if (gia) {
        gia.quantita = Math.min(9999, gia.quantita + letta.quantita);
        continue;
      }
      const nuova: RigaMerce = {
        nome: letta.nome,
        quantita: letta.quantita,
        evidenza: riga.trim().slice(0, 160),
        pagina: indicePagina + 1,
      };
      visti.set(chiave, nuova);
      righe.push(nuova);
      if (righe.length >= MASSIMO_RIGHE) return;
    }
  });
  return righe;
}

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
