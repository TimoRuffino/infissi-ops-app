// Arricchimento facoltativo dal layout del configuratore WnD (piano 3,
// Task 4, D-A). NON è un parser di contratto: la lettura resta quella del
// modello. Quando però il testo porta le etichette esatte del configuratore
// — blocchi «N. Rif. Stanza … Prodotto … Larghezza X mm Altezza Y mm …
// Riepilogo …», tabella «Riepilogo Costi», «Totale IVA Incl./Esc.»,
// «Termini di pagamento» — quei numeri sono più affidabili di qualunque
// lettura: sovrascrivono misure, quantità, prezzi, pattuito e rate con
// un'evidenza certa (la riga esatta del documento) e `daVerificare = false`.
//
// Su qualunque altro contratto (Word, scansione, altro configuratore) la
// funzione riconosce di non essere in casa e restituisce la proposta intatta.
//
// Funzione pura: nessuna I/O, nessuna mutazione della proposta ricevuta.

import type { EvidenzaEstratta, PropostaContratto, RigaProposta } from "@shared/contratti/estrazione";
import { euroToCent } from "@shared/euroCent";
import type { PattuitoTipo, RataContratto } from "@shared/limiti/tipi";
import { campo, normalizzaTesto } from "./evidenze";
import { costruisciControlli } from "./mappa";

/** Le due etichette che identificano il layout: la tabella e la sua intestazione. */
const ETICHETTA_RIEPILOGO = "riepilogo costi";
const ETICHETTA_COLONNE = /prezzo\s*unit\.?\s*installazione\s*quantita\s*sconto\s*totale/;

const INIZIO_BLOCCO = /^[ \t]*(\d+)\.\s*Rif\./gim;
const NOME_PRODOTTO = /^[ \t]*Prodotto\s*:?[ \t]*(.+)$/im;
const LARGHEZZA = /Larghezza\s*:?\s*([\d.]+)\s*mm/i;
const ALTEZZA = /Altezza\s*:?\s*([\d.]+)\s*mm/i;
/** «<nome> <unit> € <installazione> € <qta> <sconto> € (p%) <totale> €» */
const RIGA_COSTI =
  /^(.+?)\s+([\d.,]+)\s*€\s+([\d.,]+)\s*€\s+(\d+)\s+([\d.,]+)\s*€\s*\(\s*[\d.,]+\s*%\s*\)\s+([\d.,]+)\s*€$/;
const TOTALE_INCLUSA = /Totale\s+IVA\s+Incl[a-zA-Z.]*\s+([\d.,]+)/i;
const TOTALE_ESCLUSA = /Totale\s+IVA\s+Esc[a-zA-Z.]*\s+([\d.,]+)/i;
const TERMINI_PAGAMENTO = /Termini\s+di\s+pagamento\s*:?\s*(.+)$/i;
/**
 * La riga che dichiara l'aliquota («IVA 10%», «Totale IVA 10%»): l'IVA deve
 * seguire subito, non un'altra parola come in «Totale IVA Incl./Esc.», che
 * sono i totali e non l'aliquota.
 */
const RIGA_ALIQUOTA_IVA = /(?:Totale\s+)?IVA\s*(\d{1,2}(?:[.,]\d+)?)\s*%/i;

/** Punteggio minimo di somiglianza fra la descrizione della riga e il nome del blocco. */
const PUNTEGGIO_MINIMO = 2;
/** Stesso limite di `descrizione` nelle rate del contratto. */
const LUNGHEZZA_DESCRIZIONE_RATA = 120;
const LUNGHEZZA_FRAMMENTO = 300;

type BloccoWnd = {
  pagina: number;
  nome: string;
  larghezzaMm: number | null;
  altezzaMm: number | null;
  quantita: number;
  prezzoTotCent: number;
  evidenza: EvidenzaEstratta;
};

/** «Riepilogo Costi» + l'intestazione delle colonne: le due firme del layout. */
export function riconosceLayoutWnd(pagine: readonly string[]): boolean {
  if (pagine.length === 0) return false;
  const testo = normalizzaTesto(pagine.join("\n"));
  return testo.includes(ETICHETTA_RIEPILOGO) && ETICHETTA_COLONNE.test(testo);
}

/** Importo italiano («5.200,00», «1.100») in numero; `null` se non è un numero. */
function numeroItaliano(testo: string): number | null {
  const virgola = testo.lastIndexOf(",");
  const punto = testo.lastIndexOf(".");
  let normalizzato: string;
  if (virgola >= 0 && punto >= 0) {
    normalizzato = virgola > punto ? testo.replace(/\./g, "").replace(",", ".") : testo.replace(/,/g, "");
  } else if (virgola >= 0) {
    normalizzato = testo.replace(/\./g, "").replace(",", ".");
  } else {
    // Senza decimali il punto è separatore di migliaia solo se raggruppa a tre.
    normalizzato = /^\d{1,3}(\.\d{3})+$/.test(testo) ? testo.replace(/\./g, "") : testo;
  }
  const valore = Number(normalizzato);
  return Number.isFinite(valore) ? valore : null;
}

function misuraMm(blocco: string, regex: RegExp): number | null {
  const trovata = regex.exec(blocco);
  if (!trovata) return null;
  const valore = numeroItaliano(trovata[1]);
  if (valore == null) return null;
  const intero = Math.round(valore);
  return intero >= 100 && intero <= 6000 ? intero : null;
}

function frammento(riga: string): string {
  return riga.replace(/\s+/g, " ").trim().slice(0, LUNGHEZZA_FRAMMENTO);
}

/** Prima riga di una pagina che soddisfa la regex, con la sua pagina (1-based). */
function cercaRiga(
  pagine: readonly string[],
  regex: RegExp
): { pagina: number; riga: string; gruppi: RegExpExecArray } | null {
  for (let i = 0; i < pagine.length; i++) {
    for (const riga of pagine[i].split(/\r?\n/)) {
      const gruppi = regex.exec(riga);
      if (gruppi) return { pagina: i + 1, riga, gruppi };
    }
  }
  return null;
}

function bloccoDaTesto(testo: string, pagina: number): BloccoWnd | null {
  const righe = testo.split(/\r?\n/);
  const inizioRiepilogo = righe.findIndex(r => /^\s*Riepilogo\s*$/i.test(r));
  const candidate = inizioRiepilogo >= 0 ? righe.slice(inizioRiepilogo + 1) : righe;
  let costi: RegExpExecArray | null = null;
  let rigaCosti = "";
  for (const riga of candidate) {
    const trovata = RIGA_COSTI.exec(riga.trim());
    if (trovata) {
      costi = trovata;
      rigaCosti = riga;
      break;
    }
  }
  if (!costi) return null;

  const totale = numeroItaliano(costi[6]);
  const quantita = Number(costi[4]);
  if (totale == null || !Number.isFinite(quantita) || quantita < 1) return null;

  const nome = NOME_PRODOTTO.exec(testo)?.[1]?.trim() || costi[1].trim();
  return {
    pagina,
    nome,
    larghezzaMm: misuraMm(testo, LARGHEZZA),
    altezzaMm: misuraMm(testo, ALTEZZA),
    quantita,
    prezzoTotCent: euroToCent(totale),
    evidenza: { pagina, frammento: frammento(rigaCosti) },
  };
}

/** I blocchi prodotto del layout, nell'ordine in cui compaiono nel documento. */
function blocchiWnd(pagine: readonly string[]): BloccoWnd[] {
  const blocchi: BloccoWnd[] = [];
  pagine.forEach((testo, indice) => {
    const inizi = [...testo.matchAll(INIZIO_BLOCCO)].map(m => m.index ?? 0);
    for (let k = 0; k < inizi.length; k++) {
      const fine = k + 1 < inizi.length ? inizi[k + 1] : testo.length;
      const blocco = bloccoDaTesto(testo.slice(inizi[k], fine), indice + 1);
      if (blocco) blocchi.push(blocco);
    }
  });
  return blocchi;
}

function paroleUtili(testo: string): string[] {
  return normalizzaTesto(testo)
    .split(/[^a-z0-9]+/)
    .filter(p => p.length >= 4);
}

/** Quanto la descrizione della riga somiglia al nome del blocco (0 = niente). */
function punteggio(descrizione: string, nome: string): number {
  const a = normalizzaTesto(descrizione);
  const b = normalizzaTesto(nome);
  if (a === b && a !== "") return 100;
  const insieme = new Set(paroleUtili(a));
  const comuni = paroleUtili(b).filter(p => insieme.has(p)).length;
  const contenuto = a !== "" && b !== "" && (a.includes(b) || b.includes(a)) ? 3 : 0;
  return comuni + contenuto;
}

/**
 * P3-R36: il blocco del layout prezza il SOLO serramento. Se la riga si è
 * già presa la quota di un oscurante elencato a parte (D-E,
 * `abbinaOscuranti`), quella quota va risommata: riscrivere il prezzo e
 * basta lascerebbe `oscuranteIntegrato` a promettere una persiana che nel
 * prezzo non c'è più, e la somma delle righe non tornerebbe col pattuito.
 * Il prezzo composto resta «da verificare» con la sua nota: certo è il
 * numero del documento, non la somma che questo codice ne ricava.
 */
function prezzoArricchito(riga: RigaProposta, blocco: BloccoWnd) {
  const quota = riga.quotaOscuranteCent ?? 0;
  if (quota === 0) return campo<number | null>(blocco.prezzoTotCent, blocco.evidenza, { daVerificare: false });
  return campo<number | null>(blocco.prezzoTotCent + quota, blocco.evidenza, {
    daVerificare: true,
    nota: riga.prezzoTotCent.nota,
  });
}

function rigaArricchita(riga: RigaProposta, blocco: BloccoWnd): RigaProposta {
  const certo = { daVerificare: false };
  return {
    ...riga,
    larghezzaMm:
      blocco.larghezzaMm != null ? campo<number | null>(blocco.larghezzaMm, blocco.evidenza, certo) : riga.larghezzaMm,
    altezzaMm: blocco.altezzaMm != null ? campo<number | null>(blocco.altezzaMm, blocco.evidenza, certo) : riga.altezzaMm,
    quantita: campo(blocco.quantita, blocco.evidenza, certo),
    prezzoTotCent: prezzoArricchito(riga, blocco),
  };
}

function rateDaTermini(pagine: readonly string[]): { rate: RataContratto[]; evidenza: EvidenzaEstratta } | null {
  const trovata = cercaRiga(pagine, TERMINI_PAGAMENTO);
  if (!trovata) return null;
  const rate: RataContratto[] = [];
  for (const parte of trovata.gruppi[1].split(/[;,]/)) {
    const pulita = parte.trim();
    const quota = /(\d{1,3}(?:[.,]\d+)?)\s*%/.exec(pulita);
    if (!quota) continue;
    const quotaPct = numeroItaliano(quota[1]);
    if (quotaPct == null) continue;
    rate.push({
      numero: rate.length + 1,
      quotaPct,
      giorni: null,
      data: null,
      descrizione: pulita.slice(0, LUNGHEZZA_DESCRIZIONE_RATA),
    });
  }
  if (rate.length === 0) return null;
  return { rate, evidenza: { pagina: trovata.pagina, frammento: frammento(trovata.riga) } };
}

/**
 * P3-R22: aliquota IVA quando il layout la dichiara in un'UNICA riga
 * («IVA 10%» o «Totale IVA 10%»). Con più aliquote diverse o senza nessuna,
 * resta `null`: non è compito di questa funzione indovinare un'IVA mista.
 */
function ivaDescrizioneDalLayout(pagine: readonly string[]): string | null {
  const aliquote = new Set<string>();
  for (const testo of pagine) {
    for (const riga of testo.split(/\r?\n/)) {
      const trovata = RIGA_ALIQUOTA_IVA.exec(riga);
      if (trovata) aliquote.add(trovata[1]);
    }
  }
  return aliquote.size === 1 ? `IVA ${[...aliquote][0]}%` : null;
}

function pattuitoDaTotali(
  pagine: readonly string[]
): { cent: number; tipo: PattuitoTipo; evidenza: EvidenzaEstratta } | null {
  // D-G: il totale IVA inclusa è il pattuito; l'imponibile vale solo quando
  // il documento non mostra il lordo.
  for (const [regex, tipo] of [
    [TOTALE_INCLUSA, "lordo"],
    [TOTALE_ESCLUSA, "imponibile"],
  ] as Array<[RegExp, PattuitoTipo]>) {
    const trovata = cercaRiga(pagine, regex);
    if (!trovata) continue;
    const valore = numeroItaliano(trovata.gruppi[1]);
    if (valore == null) continue;
    return { cent: euroToCent(valore), tipo, evidenza: { pagina: trovata.pagina, frammento: frammento(trovata.riga) } };
  }
  return null;
}

/**
 * Corregge la proposta con i numeri esatti del layout WnD. Ogni blocco cerca
 * la riga della proposta con la stessa pagina e la descrizione più simile
 * (una riga sola per blocco: due «Finestra 2 ante» identiche restano
 * distinte perché i blocchi si consumano in ordine). Se il layout non è
 * quello, la proposta torna indietro identica.
 *
 * P3-R9: riscritti misure, prezzi, pattuito e rate, i controlli derivabili si
 * RICALCOLANO (`costruisciControlli`), altrimenti resterebbero quelli della
 * lettura precedente — «pattuito non trovato» sopra un pattuito valorizzato.
 * `ivaDescrizione` arriva dall'esito del modello: senza di essa lo scorporo
 * dal lordo non si fa e il controllo lo dichiara.
 */
export function arricchisciDaLayoutWnd(
  pagine: readonly string[],
  proposta: PropostaContratto,
  opzioni?: { ivaDescrizione?: string | null; troncato?: boolean }
): PropostaContratto {
  if (!riconosceLayoutWnd(pagine)) return proposta;

  const righe = [...proposta.righe];
  const usate = new Set<number>();
  for (const blocco of blocchiWnd(pagine)) {
    let scelta = -1;
    let migliore = PUNTEGGIO_MINIMO - 1;
    for (let i = 0; i < righe.length; i++) {
      if (usate.has(i)) continue;
      const paginaRiga = righe[i].descrizione.evidenza?.pagina;
      if (paginaRiga != null && paginaRiga !== blocco.pagina) continue;
      const valore = punteggio(righe[i].descrizione.valore, blocco.nome);
      if (valore > migliore) {
        migliore = valore;
        scelta = i;
      }
    }
    if (scelta < 0) continue;
    usate.add(scelta);
    righe[scelta] = rigaArricchita(righe[scelta], blocco);
  }

  const pattuito = pattuitoDaTotali(pagine);
  const rate = rateDaTermini(pagine);

  const arricchita: PropostaContratto = {
    ...proposta,
    righe,
    pattuitoCent: pattuito
      ? campo<number | null>(pattuito.cent, pattuito.evidenza, { daVerificare: false })
      : proposta.pattuitoCent,
    pattuitoTipo: pattuito
      ? campo<PattuitoTipo | null>(pattuito.tipo, pattuito.evidenza, { daVerificare: false })
      : proposta.pattuitoTipo,
    rate: rate ? campo(rate.rate, rate.evidenza, { daVerificare: false }) : proposta.rate,
  };

  return {
    ...arricchita,
    controlli: costruisciControlli(arricchita, {
      // P3-R22: senza una descrizione dell'IVA dal modello, l'unica riga IVA
      // del layout (se c'è, ed è una sola) vale quanto una descrizione letta.
      ivaDescrizione: opzioni?.ivaDescrizione ?? ivaDescrizioneDalLayout(pagine),
      troncato: opzioni?.troncato ?? false,
    }),
  };
}
