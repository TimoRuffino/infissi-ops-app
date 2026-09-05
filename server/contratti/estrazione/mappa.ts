// Mappatura deterministica dell'esito del modello alla proposta di contratto
// (piano 3, Task 4). È il cuore della lettura: il modello dice tipo prodotto,
// materiale, ante, misure, importi e testo libero; QUI si decide la categoria
// del CRM, il codice DEI (dal catalogo, mai dal modello — D-B), gli accessori,
// l'abbinamento degli oscuranti (D-E), la posa (D-F), il pattuito e il
// cantiere (D-G), le rate e i controlli.
//
// Regole del mestiere:
//   - nessuna scelta senza catalogo: i codici escono da `prodottiPer` e
//     `accessoriPer`, e quando non esiste un candidato unico la riga resta
//     senza codice oppure prende il primo candidato DICHIARANDOLO in
//     un'avvertenza. Mai un codice indovinato in silenzio.
//   - ogni valore porta la sua evidenza verificata (`verificaEvidenza`) e
//     nasce «da verificare» quando l'evidenza manca o il valore è dedotto.
//   - importi in centesimi (`euroToCent`), misure in mm interi.
//
// Funzioni pure e deterministiche: nessuna I/O, nessun orologio, nessun
// import da server/tars/*.

import type { ControlloProposta, PropostaContratto, RigaProposta } from "@shared/contratti/estrazione";
import { euroToCent } from "@shared/euroCent";
import {
  gruppoPerCategoria,
  gruppoPerOscurante,
  type CategoriaRiga,
  type DetrazioneTipo,
  type GruppoProdotto,
  type OscuranteIntegrato,
  type PattuitoTipo,
  type RataContratto,
  type ZonaClimatica,
} from "@shared/limiti/tipi";
import { accessoriPer, prodottiPer, type Prodotto, type Tariffe } from "../../computo/tariffe";
import { zonaPerComune } from "../../computo/zone";
import { campo, normalizzaTesto, verificaEvidenza } from "./evidenze";
import type { EsitoModello, Materiale, TipoProdotto } from "./schema";

export type ContestoMappa = {
  tariffe: Tariffe;
  clienteCommessa: {
    nome: string | null;
    indirizzo: string | null;
    citta: string | null;
    codiceFiscale: string | null;
    tipoDetrazione: "ecobonus" | "ristrutturazione" | null;
  };
  pagine: readonly string[];
};

type RigaModello = EsitoModello["righe"][number];

/**
 * Quel che serve all'abbinamento degli oscuranti e che la riga proposta non
 * porta con sé (il vocabolario del CRM non conosce ante né lamelle): viaggia
 * accanto alle righe, allineato per indice.
 */
export type DatiRigaModello = {
  nAnte: number;
  portafinestra: boolean;
  materiale: Materiale;
  lamelleOrientabili: boolean;
};

const TIPI_SERRAMENTO: readonly TipoProdotto[] = ["finestra", "portafinestra", "scorrevole", "fisso"];
const MATERIALI_SERRAMENTO: readonly Materiale[] = ["pvc", "alluminio", "legno", "legno_alluminio"];
const CATEGORIE_OSCURANTE: readonly CategoriaRiga[] = ["persiana", "tapparella", "scuro"];
/** Scarto massimo fra misure per considerare due righe lo stesso foro (D-E). */
const TOLLERANZA_MM = 10;
/** Scarto oltre il quale la somma delle righe non torna con il pattuito (P3-R1). */
const SCARTO_MASSIMO_CENT = 100;

function unisci(...pezzi: Array<string | null>): string | null {
  const validi = pezzi.filter((p): p is string => p != null && p !== "");
  return validi.length > 0 ? validi.join("; ") : null;
}

function euroTesto(cent: number): string {
  return (cent / 100).toFixed(2).replace(".", ",");
}

function perCodice(a: Prodotto, b: Prodotto): number {
  return a.codice < b.codice ? -1 : a.codice > b.codice ? 1 : 0;
}

/** Materiale citato nel testo, con il composto legno-alluminio riconosciuto prima dei singoli. */
function materialeDelTesto(descrizione: string): Materiale | null {
  const testo = normalizzaTesto(descrizione);
  if (/legno\s*[-/ ]?\s*allumin|allumin\s*[-/ ]?\s*legno/.test(testo)) return "legno_alluminio";
  if (/konfortline|etrum|\bwnd\b|pvc/.test(testo)) return "pvc";
  if (/allumin/.test(testo)) return "alluminio";
  if (/acciaio/.test(testo)) return "acciaio";
  if (/legno/.test(testo)) return "legno";
  return null;
}

/** Tutti i materiali citati nel testo, senza precedenze: serve a capire se la riga ne cita più d'uno. */
function materialiCitati(testo: string): Materiale[] {
  const trovati = new Set<Materiale>();
  if (/legno\s*[-/ ]?\s*allumin|allumin\s*[-/ ]?\s*legno/.test(testo)) trovati.add("legno_alluminio");
  else {
    if (/allumin/.test(testo)) trovati.add("alluminio");
    if (/legno/.test(testo)) trovati.add("legno");
  }
  if (/konfortline|etrum|\bwnd\b|pvc/.test(testo)) trovati.add("pvc");
  if (/acciaio/.test(testo)) trovati.add("acciaio");
  return [...trovati];
}

/** Le parole con cui il documento nomina l'oscurante: da lì in poi si parla di lui. */
const PAROLA_OSCURANTE = /persian|tapparell|scur|avvolgibil|oscurant/;

/** Pattern dei materiali, nell'ordine in cui `materialeDelTesto` li preferirebbe a parità di posizione. */
const PATTERN_MATERIALE: ReadonlyArray<{ materiale: Materiale; regex: RegExp }> = [
  { materiale: "legno_alluminio", regex: /legno\s*[-/ ]?\s*allumin|allumin\s*[-/ ]?\s*legno/ },
  { materiale: "pvc", regex: /konfortline|etrum|\bwnd\b|pvc/ },
  { materiale: "alluminio", regex: /allumin/ },
  { materiale: "acciaio", regex: /acciaio/ },
  { materiale: "legno", regex: /legno/ },
];

/**
 * P3-R25: dentro il segmento dell'oscurante può comparire più di un
 * materiale — «persiana in alluminio e telaio in PVC» — e vince quello che
 * compare PRIMA per posizione (indice della prima occorrenza), non un
 * ordine di precedenza fisso: altrimenti il PVC vincerebbe sempre, anche
 * quando è l'ultima parola del segmento.
 */
function materialePerPosizione(testo: string): Materiale | null {
  let scelto: { materiale: Materiale; indice: number } | null = null;
  for (const { materiale, regex } of PATTERN_MATERIALE) {
    const trovato = regex.exec(testo);
    if (trovato && (scelto == null || trovato.index < scelto.indice)) {
      scelto = { materiale, indice: trovato.index };
    }
  }
  return scelto?.materiale ?? null;
}

/**
 * P3-R11: il materiale dell'oscurante si cerca nel testo che VIENE DOPO la
 * parola che lo nomina — «finestra in PVC con persiana in alluminio» è una
 * persiana di alluminio, non di PVC. Se lì non c'è e la riga cita un solo
 * materiale vale quello; altrimenti si propone il PVC dichiarandolo
 * (`indovinato`), mai in silenzio.
 */
function materialeOscuranteDelTesto(descrizione: string): { materiale: Materiale; indovinato: boolean } {
  const testo = normalizzaTesto(descrizione);
  const trovata = PAROLA_OSCURANTE.exec(testo);
  const dalSegmento = trovata ? materialePerPosizione(testo.slice(trovata.index)) : null;
  if (dalSegmento != null) return { materiale: dalSegmento, indovinato: false };
  const citati = materialiCitati(testo);
  if (citati.length === 1) return { materiale: citati[0], indovinato: false };
  return { materiale: "pvc", indovinato: true };
}

/** Come si scrive un materiale in un'avvertenza rivolta all'operatore. */
const ETICHETTA_MATERIALE: Record<Materiale, string> = {
  pvc: "PVC",
  alluminio: "alluminio",
  legno: "legno",
  legno_alluminio: "legno-alluminio",
  acciaio: "acciaio",
  altro: "altro",
  sconosciuto: "sconosciuto",
};

/**
 * Materiale della riga: quello dichiarato dal modello, oppure — se dice
 * «sconosciuto» — quello dedotto dalla descrizione (marchi di profili in PVC
 * compresi). Resta «sconosciuto» quando il testo non lo dice: la riga lo
 * dichiarerà con un'avvertenza, non lo inventa.
 *
 * P3-R34: quando la riga cita PIÙ materiali («… in legno di pino con maniglia
 * in alluminio anodizzato») la precedenza fissa di `materialeDelTesto`
 * sceglieva l'alluminio in silenzio, cioè il materiale di un accessorio. Con
 * più materiali citati vince la POSIZIONE — il primo nominato, come P3-R25
 * fa dentro il segmento dell'oscurante — e la deduzione si DICHIARA
 * (`piuMateriali`): la riga porta l'avvertenza e la categoria nasce da
 * verificare. Con un solo materiale citato non cambia nulla.
 */
export function materialeRiga(r: RigaModello): { materiale: Materiale; piuMateriali: boolean } {
  if (r.materiale !== "sconosciuto") return { materiale: r.materiale, piuMateriali: false };
  const testo = normalizzaTesto(r.descrizione);
  if (materialiCitati(testo).length > 1) {
    const posizionale = materialePerPosizione(testo);
    if (posizionale != null) return { materiale: posizionale, piuMateriali: true };
  }
  return { materiale: materialeDelTesto(r.descrizione) ?? "sconosciuto", piuMateriali: false };
}

export function materialeEffettivo(r: RigaModello): Materiale {
  return materialeRiga(r).materiale;
}

/** Categoria del CRM per il tipo del modello. `null` = servizio: non è una riga (D-F). */
export function categoriaPer(tipo: TipoProdotto, materiale: Materiale): CategoriaRiga | null {
  switch (tipo) {
    case "servizio":
      return null;
    case "finestra":
    case "portafinestra":
    case "scorrevole":
    case "fisso":
      return materiale === "alluminio"
        ? "serramento_alluminio"
        : materiale === "legno"
          ? "serramento_legno"
          : materiale === "legno_alluminio"
            ? "serramento_legno_alluminio"
            : "serramento_pvc";
    case "cassonetto":
      return "cassonetto";
    case "tapparella":
      return "tapparella";
    case "persiana":
      return "persiana";
    case "scuro":
      return "scuro";
    case "zanzariera":
      return "zanzariera";
    case "tenda":
      return "tenda";
    case "pergola":
      return "pergola";
    case "porta_blindata":
      return "porta_blindata";
    case "portoncino":
      return "portoncino";
    case "porta_interna":
      return "porta_interna";
    case "controtelaio":
      return "controtelaio";
    case "accessorio":
      return "accessorio";
    default:
      return "altro";
  }
}

/**
 * Famiglie del catalogo ammesse per la categoria. Serve per il legno-alluminio,
 * che in `gruppoPerCategoria` non ha famiglia unica ma nel seed vive su due
 * fogli («legno_alluminio» e «alluminio_legno»): senza questo filtro i
 * candidati sarebbero TUTTI i serramenti, PVC compreso.
 */
function famiglieSerramento(categoria: CategoriaRiga): string[] | null {
  switch (categoria) {
    case "serramento_pvc":
      return ["pvc"];
    case "serramento_alluminio":
      return ["alluminio"];
    case "serramento_legno":
      return ["legno"];
    case "serramento_legno_alluminio":
      return ["legno_alluminio", "alluminio_legno"];
    default:
      return null;
  }
}

function famiglieDelGruppo(t: Tariffe, gruppo: GruppoProdotto): string[] {
  return [...new Set(prodottiPer(t, gruppo).map(p => p.famiglia))];
}

/**
 * Famiglia del catalogo per una riga autonoma (persiana, tapparella,
 * cassonetto…): l'unica del gruppo se ce n'è una sola, altrimenti quella
 * citata dalla descrizione (anche quando il seed la scrive più lunga, come
 * «pvc_fino_110»). `null` quando il testo non basta: meglio nessun codice.
 */
function famigliaDedotta(t: Tariffe, gruppo: GruppoProdotto, descrizione: string): string | null {
  const famiglie = famiglieDelGruppo(t, gruppo);
  if (famiglie.length === 1) return famiglie[0];
  const chiave = materialeDelTesto(descrizione);
  if (chiave == null || chiave === "legno_alluminio") return null;
  if (famiglie.includes(chiave)) return chiave;
  const parziali = famiglie.filter(f => f.startsWith(`${chiave}_`));
  return parziali.length === 1 ? parziali[0] : null;
}

/**
 * Come si apre il serramento. Il catalogo lo dice nel nome della voce, il
 * documento nella descrizione: qui c'è un solo vocabolario per entrambi.
 * («scorrev» e non «scorrevole» perché il seed scrive anche «scorrevale».)
 */
type NaturaSerramento = "battente" | "complanare" | "alzante" | "telaio_fisso";

const ETICHETTA_NATURA: Record<NaturaSerramento, string> = {
  battente: "a battente",
  complanare: "scorrevole complanare",
  alzante: "scorrevole alzante",
  telaio_fisso: "a telaio fisso",
};

/** Natura dichiarata dal nome della voce DEI. */
function naturaDelNome(nome: string): NaturaSerramento {
  const n = normalizzaTesto(nome);
  if (n.includes("telaio fisso")) return "telaio_fisso";
  if (/scorrev/.test(n)) return n.includes("alzante") ? "alzante" : "complanare";
  return "battente";
}

/**
 * I sostantivi con cui il documento nomina il serramento stesso (P3-R27).
 * P3-R32: «scorrevole» NON è qui. È un qualificatore, e un qualificatore non
 * nomina niente: se facesse da àncora, uno «scorrevole» già assorbito da un
 * accessorio si porterebbe dietro il «complanare» che lo segue («…con
 * zanzariera scorrevole complanare»), e su una portafinestra — che con
 * «scorrevole» non è in contrasto (P3-R28) — il codice cambierebbe in
 * silenzio. Quando il testo apre con «Scorrevole …» il qualificatore resta
 * comunque al serramento: davanti non ha nessun sostantivo.
 *
 * P3-R35: «apertura», «anta/ante» e «battente» nominano il serramento — «…
 * con zanzariera a scomparsa e apertura scorrevole» parla di come si apre la
 * finestra, non della zanzariera. Tutte e tre con il confine di parola:
 * «pianta» non è un'anta e «abbattimento» non è un battente.
 */
const SOSTANTIVO_SERRAMENTO =
  /finestr|portafinestr|porta[ -]finestr|\bpf\b|serrament|infiss|\bapertur|\bant[ae]\b|\bbattent/gi;

/**
 * I sostantivi di accessorio o oscurante: quello che li segue parla di loro,
 * non del serramento (P3-R27).
 *
 * P3-R33: la lista è chiusa, quindi ogni parola che manca è un accessorio che
 * si prende il serramento in silenzio — «con inferriata scorrevole» faceva
 * scorrevole la portafinestra. Aggiunte le parole che i documenti usano
 * davvero per le protezioni e le schermature. `persianin*` è già coperto dal
 * prefisso `persian`, `avvolgibil` era già in lista: non si duplicano.
 * `grat[ae]` con il confine di parola per non intercettare «integrata».
 */
const SOSTANTIVO_ACCESSORIO =
  /\b(?:zanzarier|tend[ae]\b|persian|tapparell|cassonett|avvolgibil|manigli|coprifil|scur[oi]\b|inferriat|grat[ae]\b|frangisol|venezian|oscurant|scurett)/gi;

/**
 * Le parole con cui il documento dichiara un'apertura che scorrevole NON è
 * (P3-R33). Quando una di queste è attribuita al serramento, prevale su un
 * qualificatore di scorrimento attribuito allo stesso serramento: il testo si
 * contraddice e la voce a battente è la lettura prudente, MAI silenziosa.
 */
const APERTURA_ESPLICITA = /\bbattent|\bribalta|\boscillobattent|\bvasistas/gi;

/** Le parole che dicono «scorrevole» di un serramento: complanare e alzante comprese. */
const QUALIFICATORE_SCORRIMENTO = /scorrev|alzante|complanare/gi;

/**
 * «scuro/scuri» non è un oscurante quando lo precede entro due parole un
 * colore o una finitura: «colore scuro», «finitura noce scuro» (P3-R27).
 */
const PAROLA_DI_COLORE = /colore|tinta|finitur|tonalit|effetto|verniciat|laccat/;

function scuroDiColore(testo: string, indice: number): boolean {
  const parolePrima = testo.slice(0, indice).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return parolePrima.slice(-2).some(p => PAROLA_DI_COLORE.test(p));
}

/**
 * P3-R27: ogni «scorrevole/alzante/complanare» della descrizione vale per
 * il sostantivo più vicino che lo PRECEDE. Se quel sostantivo è un
 * accessorio o un oscurante, l'accessorio se lo tiene («…con zanzariera
 * scorrevole» non rende scorrevole la finestra); se è un serramento — o se
 * prima non c'è nessun sostantivo — il qualificatore descrive il
 * serramento («Persiana abbinata alla portafinestra scorrevole»). La
 * prossimità sostituisce il taglio al primo accessorio del giro 2, che era
 * cieco alla direzione e buttava via tutto quello che veniva dopo.
 *
 * Ritorna i qualificatori che restano al serramento, nell'ordine del testo.
 */
function qualificatoriDelSerramento(testo: string): string[] {
  return paroleDelSerramento(testo, QUALIFICATORE_SCORRIMENTO);
}

/**
 * La stessa prossimità, per qualunque famiglia di parole che qualifica un
 * serramento: ritorna quelle il cui sostantivo più vicino a sinistra è un
 * serramento (o che non ne hanno nessuno davanti). P3-R33 la riusa per le
 * parole di apertura esplicita: «Portafinestra scorrevole con persiana a
 * battente» è una portafinestra scorrevole, e quel «battente» è della
 * persiana.
 */
function paroleDelSerramento(testo: string, parole: RegExp): string[] {
  const sostantivi: Array<{ indice: number; accessorio: boolean }> = [];
  for (const m of testo.matchAll(SOSTANTIVO_SERRAMENTO)) {
    sostantivi.push({ indice: m.index, accessorio: false });
  }
  for (const m of testo.matchAll(SOSTANTIVO_ACCESSORIO)) {
    // «scuro» preceduto da un colore o da una finitura non è un sostantivo
    // («scuretto» è un oscurante anche dopo un colore: non è un aggettivo).
    if (/^scur[oi]$/.test(m[0]) && scuroDiColore(testo, m.index)) continue;
    sostantivi.push({ indice: m.index, accessorio: true });
  }

  const restano: string[] = [];
  for (const q of testo.matchAll(parole)) {
    let piuVicino: { indice: number; accessorio: boolean } | null = null;
    for (const s of sostantivi) {
      if (s.indice >= q.index) continue;
      if (piuVicino == null || s.indice > piuVicino.indice) piuVicino = s;
    }
    if (piuVicino == null || !piuVicino.accessorio) restano.push(q[0]);
  }
  return restano;
}

/**
 * P3-R10/P3-R27: la natura si decide dal tipo del modello E dalla
 * descrizione. Il modello marca «portafinestra» anche una portafinestra
 * scorrevole: senza leggere il testo l'intero foglio degli scorrevoli
 * resterebbe irraggiungibile. Ma per finestra e portafinestra contano solo
 * i qualificatori che la prossimità (P3-R27) lascia al serramento,
 * altrimenti «…con zanzariera scorrevole» renderebbe scorrevole una
 * finestra battente. Il tipo «scorrevole» del modello non ha bisogno del
 * testo: resta scorrevole.
 *
 * Quando il testo dice «scorrevole» del serramento ma il tipo del modello
 * è `finestra` (o `fisso`), i due si contraddicono: si segue la parola — è
 * più spesso giusta del tipo dichiarato dal modello — ma la
 * CONTRADDIZIONE si dichiara sempre (`contrasto: true`), mai una scelta
 * silenziosa. P3-R28: `portafinestra` NON è in contrasto con «scorrevole»
 * — una portafinestra scorrevole è una cosa sola — e non genera avviso.
 * (`fisso` oggi esce dal ramo `telaio_fisso` qui sopra: resta nell'elenco
 * perché è la regola dichiarata, non perché il ramo sia raggiungibile.)
 */
const TIPI_IN_CONTRASTO_CON_SCORREVOLE: ReadonlyArray<TipoProdotto> = ["finestra", "fisso"];

type NaturaDedotta = {
  natura: NaturaSerramento;
  /** Il testo dice scorrevole, il tipo del modello dice altro (P3-R28). */
  contrasto: boolean;
  /** Il testo dice a battente E scorrevole dello stesso serramento (P3-R33). */
  aperturaContraddetta: boolean;
};

function naturaRichiesta(tipo: TipoProdotto, descrizione: string): NaturaDedotta {
  if (tipo === "fisso") return { natura: "telaio_fisso", contrasto: false, aperturaContraddetta: false };
  const testo = normalizzaTesto(descrizione);
  if (testo.includes("telaio fisso")) return { natura: "telaio_fisso", contrasto: false, aperturaContraddetta: false };
  if (tipo === "scorrevole") {
    return {
      natura: /alzante/.test(testo) ? "alzante" : "complanare",
      contrasto: false,
      aperturaContraddetta: false,
    };
  }
  const qualificatori = qualificatoriDelSerramento(testo);
  if (qualificatori.length === 0) return { natura: "battente", contrasto: false, aperturaContraddetta: false };
  // P3-R33: lo stesso serramento è detto «a battente» (o a ribalta,
  // oscillobattente, vasistas) E scorrevole. La parola di apertura esplicita
  // è la più specifica delle due — quasi sempre è lo scorrimento a essere di
  // un accessorio che la lista dei sostantivi non conosce ancora — e vince,
  // ma la contraddizione va detta: qui non si sceglie mai in silenzio.
  if (paroleDelSerramento(testo, APERTURA_ESPLICITA).length > 0) {
    return { natura: "battente", contrasto: false, aperturaContraddetta: true };
  }
  return {
    natura: qualificatori.includes("alzante") ? "alzante" : "complanare",
    contrasto: TIPI_IN_CONTRASTO_CON_SCORREVOLE.includes(tipo),
    aperturaContraddetta: false,
  };
}

/** Il testo parla di una portafinestra (e non della finestra che le sta dentro come parola). */
function citaPortafinestra(testo: string): boolean {
  return /portafinestra|porta\s*-?\s*finestra|\bpf\b/.test(testo);
}

/**
 * P3-R10: finestra o portafinestra. Il tipo del modello decide quando lo
 * dice; per `scorrevole` (che non distingue le due forme) decide la
 * descrizione, e `null` significa «non indicato»: si considerano entrambe e
 * lo si dichiara, invece di scegliere la finestra in silenzio.
 */
function portafinestraRichiesta(tipo: TipoProdotto, descrizione: string): boolean | null {
  if (tipo === "portafinestra") return true;
  if (tipo !== "scorrevole") return false;
  const testo = normalizzaTesto(descrizione);
  if (citaPortafinestra(testo)) return true;
  if (/finestra/.test(testo)) return false;
  return null;
}

/** Il nome promette una trasmittanza peggiore («> 1,3 W/mqK»): stessa voce, prestazione inferiore. */
function trasmittanzaPeggiore(nome: string): boolean {
  return />\s*1,3/.test(normalizzaTesto(nome));
}

/**
 * P3-R15: a parità di filtri vince (1) la voce senza «> 1,3», (2) quella del
 * foglio del materiale dichiarato (legno-alluminio prima di alluminio-legno),
 * (3) il codice. Prima di questo ordine il tie-break per codice sceglieva
 * sistematicamente la trasmittanza peggiore e il foglio sbagliato.
 */
function perPreferenza(famigliaPreferita: string | null): (a: Prodotto, b: Prodotto) => number {
  return (a, b) => {
    const peggiore = Number(trasmittanzaPeggiore(a.nome)) - Number(trasmittanzaPeggiore(b.nome));
    if (peggiore !== 0) return peggiore;
    if (famigliaPreferita != null) {
      const foglio = Number(b.famiglia === famigliaPreferita) - Number(a.famiglia === famigliaPreferita);
      if (foglio !== 0) return foglio;
    }
    return perCodice(a, b);
  };
}

/** Restringe i candidati solo se qualcuno sopravvive: un filtro non svuota mai il catalogo. */
function restringi(candidati: Prodotto[], test: (p: Prodotto) => boolean): Prodotto[] {
  const filtrati = candidati.filter(test);
  return filtrati.length > 0 ? filtrati : candidati;
}

/**
 * Codice DEI del prodotto della riga (D-B). Serramenti: si filtra per
 * famiglia e zona climatica, poi si PREFERISCONO la forma (finestra o
 * portafinestra), la natura (battente, scorrevole complanare o alzante,
 * telaio fisso) e il numero di ante; ogni preferenza che non trova voci
 * lascia il catalogo dov'era e si dichiara in un'avvertenza, invece di
 * svuotare la scelta. Righe autonome (persiane, tapparelle, cassonetti…):
 * prima voce della famiglia dedotta. Un solo candidato → codice certo; più
 * candidati → il primo per preferenza, con avvertenza; nessuno → `null` con
 * avvertenza.
 */
export function tipologiaDei(
  t: Tariffe,
  categoria: CategoriaRiga,
  r: { tipoProdotto: TipoProdotto; nAnte: number; descrizione: string; lamelleOrientabili?: boolean },
  zona: ZonaClimatica | null
): { codice: string | null; avvertenza: string | null } {
  const { gruppo, famiglia } = gruppoPerCategoria(categoria);
  if (gruppo == null) return { codice: null, avvertenza: null };
  if (gruppo === "serramento") return tipologiaSerramento(t, categoria, famiglia, r, zona);

  const famigliaVoce = famiglia ?? famigliaDedotta(t, gruppo, r.descrizione);
  if (famigliaVoce == null) {
    return { codice: null, avvertenza: `nessuna voce DEI per ${categoria}: materiale non riconosciuto` };
  }
  // Persiane, tapparelle e scuri elencati come righe a sé: stessa scelta del
  // percorso abbinato (lamelle orientabili e forma), altrimenti una persiana
  // «senza lamelle» finirebbe sulla voce con le lamelle.
  if (CATEGORIE_OSCURANTE.includes(categoria)) {
    return sceltaOscurante(t, gruppo, famigliaVoce, {
      portafinestra: citaPortafinestra(normalizzaTesto(r.descrizione)),
      nAnte: r.nAnte,
      lamelleOrientabili: r.lamelleOrientabili ?? false,
    });
  }
  const candidati = prodottiPer(t, gruppo, famigliaVoce, zona);
  if (candidati.length === 0) {
    return { codice: null, avvertenza: `nessuna voce DEI per ${categoria} (${famigliaVoce})` };
  }
  // Righe autonome: il seed elenca le voci nell'ordine del foglio, la prima è
  // quella standard (cassonetto in PVC da 100 × 40…).
  const scelto = candidati[0];
  return {
    codice: scelto.codice,
    avvertenza: candidati.length > 1 ? `più voci DEI possibili: scelta ${scelto.codice}` : null,
  };
}

function tipologiaSerramento(
  t: Tariffe,
  categoria: CategoriaRiga,
  famiglia: string | null,
  r: { tipoProdotto: TipoProdotto; nAnte: number; descrizione: string },
  zona: ZonaClimatica | null
): { codice: string | null; avvertenza: string | null } {
  const ammesse = famiglieSerramento(categoria);
  const { natura, contrasto, aperturaContraddetta } = naturaRichiesta(r.tipoProdotto, r.descrizione);
  const portafinestra = portafinestraRichiesta(r.tipoProdotto, r.descrizione);
  const avvertenze: Array<string | null> = [];

  let candidati = prodottiPer(t, "serramento", famiglia, zona).filter(
    p => ammesse == null || ammesse.includes(p.famiglia)
  );
  if (candidati.length === 0) {
    const dettaglio = zona ? `${r.tipoProdotto}, zona ${zona}` : r.tipoProdotto;
    return { codice: null, avvertenza: `nessuna voce DEI per ${categoria} (${dettaglio})` };
  }

  // P3-R27/P3-R28: la descrizione dice «scorrevole» del serramento ma il
  // tipo del modello è `finestra` (o `fisso`) — si segue il testo, ma la
  // contraddizione fra i due si dichiara sempre.
  if (contrasto) {
    avvertenze.push(`descrizione scorrevole, tipo del modello ${r.tipoProdotto}: verifica`);
  }
  // P3-R33: «a battente» e «scorrevole» nella stessa descrizione, entrambi
  // del serramento. Si segue la parola di apertura esplicita, e lo si dice.
  if (aperturaContraddetta) {
    avvertenze.push("descrizione a battente e scorrevole: verifica");
  }

  if (portafinestra == null) avvertenze.push("scorrevole: finestra o portafinestra non indicato");
  else candidati = restringi(candidati, p => (p.portafinestra ?? false) === portafinestra);

  // Natura esatta; se il catalogo non ha quella variante (una portafinestra
  // alzante in PVC, per dire) si ripiega sull'altro scorrevole prima che sul
  // battente, e la differenza finisce in un'avvertenza.
  const perNatura = candidati.filter(p => naturaDelNome(p.nome) === natura);
  if (perNatura.length > 0) candidati = perNatura;
  else if (natura === "complanare" || natura === "alzante") {
    candidati = restringi(candidati, p => naturaDelNome(p.nome) === "complanare" || naturaDelNome(p.nome) === "alzante");
  }

  const ante = r.nAnte > 0 ? r.nAnte : 1;
  const conAnte = candidati.filter(p => (p.nAnte ?? 0) === ante);
  if (conAnte.length > 0) candidati = conAnte;
  else avvertenze.push(`nessuna voce DEI a ${ante} ante`);

  const ordinati = [...candidati].sort(perPreferenza(ammesse?.[0] ?? null));
  const scelto = ordinati[0];
  const naturaScelta = naturaDelNome(scelto.nome);
  if (naturaScelta !== natura) {
    avvertenze.push(
      `la descrizione dice ${ETICHETTA_NATURA[natura]}, la voce scelta è ${ETICHETTA_NATURA[naturaScelta]}`
    );
  }
  if (ordinati.length > 1) avvertenze.push(`più voci DEI possibili: scelta ${scelto.codice}`);
  return { codice: scelto.codice, avvertenza: unisci(...avvertenze) };
}

/** Il nome del prodotto promette lamelle/stecche orientabili (e non il contrario). */
function haOrientabili(nome: string): boolean {
  const n = normalizzaTesto(nome);
  return /orientabil/.test(n) && !/senza\s+lamelle\s+orientabil/.test(n);
}

/**
 * Forma dichiarata nel nome della voce: «per finestra a 1 anta», «per
 * portafinestra 2 ante», «finestra 1 o 2 ante». Le ante possono essere più
 * di una (le voci in legno coprono 1 e 2 con lo stesso prezzo).
 */
function formaDalNome(nome: string): { portafinestra: boolean; ante: number[] } | null {
  const trovato = /(?:per\s+)?(portafinestra|finestra)\s+(?:a\s+)?([\d\s eo]*?)ant/.exec(normalizzaTesto(nome));
  if (!trovato) return null;
  const ante = [...trovato[2].matchAll(/\d/g)].map(m => Number(m[0]));
  return { portafinestra: trovato[1] === "portafinestra", ante };
}

/**
 * La voce DEI dell'oscurante dentro una famiglia già scelta: persiane e
 * scuri per lamelle orientabili e per forma (finestra o portafinestra,
 * numero di ante); le tapparelle non hanno forma e vale la prima voce della
 * famiglia (PVC standard, alluminio 55 mm, acciaio 40 mm). Più voci valide →
 * la prima, DICHIARANDOLO (P3-R13).
 */
function sceltaOscurante(
  t: Tariffe,
  gruppo: GruppoProdotto,
  famiglia: string,
  forma: { portafinestra: boolean; nAnte: number; lamelleOrientabili: boolean }
): { codice: string | null; avvertenza: string | null } {
  let candidati = prodottiPer(t, gruppo, famiglia);
  if (candidati.length === 0) return { codice: null, avvertenza: `nessuna voce DEI per ${gruppo} (${famiglia})` };

  if (gruppo === "persiana" || gruppo === "scuro") {
    const perLamelle = candidati.filter(p => haOrientabili(p.nome) === forma.lamelleOrientabili);
    if (perLamelle.length > 0) candidati = perLamelle;
    const ante = forma.nAnte > 0 ? forma.nAnte : 1;
    const perForma = candidati.filter(p => {
      const dalNome = formaDalNome(p.nome);
      return (
        dalNome != null &&
        dalNome.portafinestra === forma.portafinestra &&
        (dalNome.ante.length === 0 || dalNome.ante.includes(ante))
      );
    });
    if (perForma.length > 0) candidati = perForma;
  }

  const scelto = candidati[0];
  return {
    codice: scelto.codice,
    avvertenza: candidati.length > 1 ? `più voci DEI possibili: scelta ${scelto.codice}` : null,
  };
}

/**
 * Codice DEI dell'oscurante abbinato al serramento. Famiglia = materiale
 * dell'oscurante (l'unica del gruppo quando ce n'è una sola); da lì decide
 * `sceltaOscurante`. Materiale che il gruppo non conosce → nessun codice,
 * con l'avvertenza che lo dice.
 */
export function oscuranteDei(
  t: Tariffe,
  oscurante: OscuranteIntegrato,
  materialeOscurante: Materiale,
  portafinestra: boolean,
  nAnte: number,
  lamelleOrientabili: boolean
): { codice: string | null; avvertenza: string | null } {
  const gruppo = gruppoPerOscurante(oscurante);
  const famiglie = famiglieDelGruppo(t, gruppo);
  const famiglia = famiglie.includes(materialeOscurante)
    ? materialeOscurante
    : famiglie.length === 1
      ? famiglie[0]
      : null;
  if (famiglia == null) {
    return { codice: null, avvertenza: `nessuna voce DEI per ${oscurante} in ${materialeOscurante}` };
  }
  return sceltaOscurante(t, gruppo, famiglia, { portafinestra, nAnte, lamelleOrientabili });
}

type RegolaEtichetta = {
  prova: RegExp;
  /** Famiglie della riga a cui la regola si applica; assente = tutte. */
  famiglie?: string[];
  /** Codici del catalogo, in ordine di preferenza: vale il primo presente. */
  codici: string[];
};

// Le etichette che il modello copia dal documento («anta a ribalta», «Real
// Wood», «coprifili da 100 mm») diventano accessori DEI solo attraverso
// questa tabella: il codice deve comunque esistere nel catalogo filtrato per
// gruppo, famiglia e portafinestra, altrimenti l'etichetta resta «da
// verificare» sulla riga.
const REGOLE_ETICHETTA: RegolaEtichetta[] = [
  {
    prova: /ribalta|oscillobattent/,
    codici: ["serramento.C25126", "serramento.C15142", "serramento.C25123", "serramento.C25124"],
  },
  {
    prova: /pellicol|real wood|effetto legno|rovere/,
    famiglie: ["pvc", "velux"],
    codici: ["serramento.C25088-a", "persiana.C25084-a"],
  },
  { prova: /incollaggio/, codici: ["serramento.C25088-b"] },
  { prova: /soglia\s+ribassata/, codici: ["serramento.C25088-c"] },
  // Il numero è un numero intero: «coprifilo 180 mm» non è un coprifilo da 80.
  { prova: /coprifil.*\b80\b/, codici: ["serramento.C25088-h"] },
  { prova: /coprifil.*\b100\b/, codici: ["serramento.C25088-i"] },
  // Motori degli avvolgibili: la classe di peso deve essere SCRITTA
  // nell'etichetta, altrimenti sceglierla sarebbe indovinare un prezzo.
  { prova: /motor.*\b25\b/, codici: ["avvolgibile.C25091-d"] },
  { prova: /motor.*\b60\b/, codici: ["avvolgibile.C25091-e"] },
  { prova: /motor.*\b80\b/, codici: ["avvolgibile.C25091-f"] },
  { prova: /motor.*\b100\b/, codici: ["avvolgibile.C25091-g"] },
  { prova: /anodizz|elettrocolore/, famiglie: ["alluminio"], codici: ["serramento.C15054-b", "persiana.C15154-b"] },
  { prova: /vernic.*special/, codici: ["serramento.C15054-c", "persiana.C15154-c"] },
  { prova: /effetto legno/, famiglie: ["alluminio"], codici: ["serramento.C15054-d", "persiana.C15154-d"] },
  { prova: /acustic/, codici: ["serramento.C15055", "serramento.C15075"] },
];

/**
 * Famiglia con cui interrogare il catalogo accessori. Il legno-alluminio ne
 * ha due e vale la prima; le categorie senza famiglia fissa (persiane,
 * tapparelle, cassonetti) la deducono dalla descrizione, altrimenti il loro
 * catalogo tornerebbe sempre vuoto e nessun accessorio sarebbe raggiungibile.
 */
function famigliaAccessori(
  t: Tariffe,
  categoria: CategoriaRiga,
  gruppo: GruppoProdotto,
  famiglia: string | null,
  descrizione: string
): string {
  if (famiglia != null) return famiglia;
  if (categoria === "serramento_legno_alluminio") return "legno_alluminio";
  return famigliaDedotta(t, gruppo, descrizione) ?? "";
}

function risolviAccessori(
  t: Tariffe,
  categoria: CategoriaRiga,
  etichette: readonly string[],
  portafinestra: boolean,
  descrizione: string
): { accessori: RigaProposta["accessori"]; nonRiconosciute: string[] } {
  const pulite = etichette.map(e => e.trim()).filter(e => e !== "");
  const { gruppo, famiglia } = gruppoPerCategoria(categoria);
  if (gruppo == null) return { accessori: [], nonRiconosciute: pulite };

  const famigliaRiga = famigliaAccessori(t, categoria, gruppo, famiglia, descrizione);
  const catalogo = accessoriPer(t, gruppo, famigliaRiga, portafinestra);
  const accessori: RigaProposta["accessori"] = [];
  const nonRiconosciute: string[] = [];
  const gia = new Set<string>();

  for (const etichetta of pulite) {
    const testo = normalizzaTesto(etichetta);
    const regola = REGOLE_ETICHETTA.find(
      r =>
        r.prova.test(testo) &&
        (r.famiglie == null || r.famiglie.includes(famigliaRiga)) &&
        r.codici.some(c => catalogo.some(a => a.codice === c))
    );
    if (!regola) {
      nonRiconosciute.push(etichetta);
      continue;
    }
    const codice = regola.codici.find(c => catalogo.some(a => a.codice === c));
    if (codice == null || gia.has(codice)) continue;
    gia.add(codice);
    accessori.push({ codice, quantita: 1, etichetta });
  }
  return { accessori, nonRiconosciute };
}

/**
 * Accessori DEI dalle etichette lette dal modello. Nessun duplicato per
 * codice; le etichette che nessuna regola riconosce non producono accessori
 * (finiscono nella nota della riga, v. `costruisciProposta`).
 */
export function accessoriDaEtichette(
  t: Tariffe,
  categoria: CategoriaRiga,
  etichette: string[],
  portafinestra: boolean,
  nAnte: number,
  descrizione = ""
): RigaProposta["accessori"] {
  void nAnte; // le voci DEI sono a pezzo: la quantità è 1 per riga, non per anta.
  return risolviAccessori(t, categoria, etichette, portafinestra, descrizione).accessori;
}

function clonaRiga(r: RigaProposta): RigaProposta {
  return {
    ...r,
    categoria: { ...r.categoria },
    tipologia: { ...r.tipologia },
    descrizione: { ...r.descrizione },
    quantita: { ...r.quantita },
    larghezzaMm: { ...r.larghezzaMm },
    altezzaMm: { ...r.altezzaMm },
    prezzoTotCent: { ...r.prezzoTotCent },
    oscuranteIntegrato: { ...r.oscuranteIntegrato },
    oscuranteTipologia: { ...r.oscuranteTipologia },
    accessori: r.accessori.map(a => ({ ...a })),
    avvertenze: [...r.avvertenze],
  };
}

/**
 * D-E: persiane, tapparelle e scuri elencati come righe a sé tornano sul
 * serramento con lo stesso foro (±10 mm) quando i PEZZI BASTANO per tutta la
 * riga serramento (P3-R14: il computo prezza l'oscurante su L × H × quantità,
 * quindi marcare 3 finestre con 1 sola persiana gonfierebbe il CHECK2),
 * portandosi la quota di prezzo; l'oscurante che non trova serramento resta
 * una riga sua. Le righe restano nell'ordine di lettura.
 *
 * `contesto` porta le tariffe e i dati del modello allineati per indice alle
 * righe ricevute: senza di esso l'abbinamento avviene lo stesso ma il codice
 * DEI dell'oscurante resta da scegliere a mano (RigaProposta non conosce ante
 * né lamelle).
 */
export function abbinaOscuranti(
  righe: RigaProposta[],
  contesto?: { tariffe: Tariffe; dati: readonly DatiRigaModello[] }
): RigaProposta[] {
  const lavorate = righe.map(clonaRiga);

  for (let i = 0; i < lavorate.length; i++) {
    const oscurante = lavorate[i];
    const categoria = oscurante.categoria.valore;
    if (!CATEGORIE_OSCURANTE.includes(categoria)) continue;
    const larghezza = oscurante.larghezzaMm.valore;
    const altezza = oscurante.altezzaMm.valore;
    if (larghezza == null || altezza == null) continue;

    const prezzoOscurante = oscurante.prezzoTotCent.valore;
    const pezzi = oscurante.quantita.valore;
    let residuo = pezzi;
    let quotaCeduta = 0;
    let quantitaDiversa = false;

    for (let j = 0; j < lavorate.length && residuo > 0; j++) {
      const serramento = lavorate[j];
      if (!serramento.categoria.valore.startsWith("serramento_")) continue;
      if (serramento.oscuranteIntegrato.valore != null) continue;
      const sl = serramento.larghezzaMm.valore;
      const sh = serramento.altezzaMm.valore;
      if (sl == null || sh == null) continue;
      if (Math.abs(sl - larghezza) > TOLLERANZA_MM || Math.abs(sh - altezza) > TOLLERANZA_MM) continue;
      // Lo stesso foro, ma non abbastanza oscuranti per tutti i pezzi della
      // riga: meglio due righe separate che un oscurante contato più volte.
      if (residuo < serramento.quantita.valore) {
        quantitaDiversa = true;
        continue;
      }

      const abbinata = serramento.quantita.valore;
      const quota = prezzoOscurante == null || pezzi === 0 ? 0 : Math.round((prezzoOscurante * abbinata) / pezzi);
      const evidenza = oscurante.descrizione.evidenza;
      const scelta = contesto
        ? oscuranteDei(
            contesto.tariffe,
            categoria as OscuranteIntegrato,
            contesto.dati[i]?.materiale ?? "pvc",
            contesto.dati[j]?.portafinestra ?? false,
            contesto.dati[j]?.nAnte ?? 1,
            contesto.dati[i]?.lamelleOrientabili ?? false
          )
        : null;

      serramento.oscuranteIntegrato = campo<OscuranteIntegrato | null>(categoria as OscuranteIntegrato, evidenza, {
        daVerificare: true,
        nota: "oscurante abbinato dalla riga a sé",
      });
      serramento.oscuranteTipologia = campo<string | null>(scelta?.codice ?? null, evidenza, {
        daVerificare: true,
        nota: scelta?.avvertenza ?? null,
      });
      if (prezzoOscurante != null) {
        serramento.prezzoTotCent = campo<number | null>(
          (serramento.prezzoTotCent.valore ?? 0) + quota,
          serramento.prezzoTotCent.evidenza,
          { daVerificare: true, nota: `comprende ${categoria} (€ ${euroTesto(quota)})` }
        );
        // P3-R36: la quota resta scritta sulla riga, non solo sommata. Chi
        // riscrive il prezzo dopo di qui (l'arricchimento dal layout WnD)
        // la ritrova e la somma di nuovo, invece di cancellarla lasciando
        // `oscuranteIntegrato` a promettere una persiana fuori dal prezzo.
        serramento.quotaOscuranteCent = (serramento.quotaOscuranteCent ?? 0) + quota;
      }
      serramento.note = unisci(serramento.note, `${categoria} abbinata (€ ${euroTesto(quota)})`);

      residuo -= abbinata;
      quotaCeduta += quota;
      oscurante.quantita = campo(residuo, oscurante.quantita.evidenza, { daVerificare: true });
      if (prezzoOscurante != null) {
        oscurante.prezzoTotCent = campo<number | null>(prezzoOscurante - quotaCeduta, oscurante.prezzoTotCent.evidenza, {
          daVerificare: true,
        });
      }
    }

    if (residuo > 0 && quantitaDiversa) {
      oscurante.avvertenze = [...oscurante.avvertenze, "non abbinata: quantità diversa dal serramento con le stesse misure"];
    }
  }

  return lavorate.filter(r => !(CATEGORIE_OSCURANTE.includes(r.categoria.valore) && r.quantita.valore <= 0));
}

function misuraValida(valore: number | null, nome: string, avvertenze: string[]): number | null {
  if (valore == null) return null;
  const intero = Math.round(valore);
  if (intero < 100 || intero > 6000) {
    avvertenze.push(`${nome} fuori intervallo (${valore} mm): da inserire a mano`);
    return null;
  }
  return intero;
}

const PAROLE_SERVIZIO = /\b(posa|installazione|trasporto|montaggio)/;

/** Una riga «altro»/«accessorio» che parla di posa, trasporto o montaggio. */
function citaLaPosa(r: RigaModello): boolean {
  if (r.tipoProdotto !== "accessorio" && r.tipoProdotto !== "altro") return false;
  return PAROLE_SERVIZIO.test(normalizzaTesto(r.descrizione));
}

/**
 * D-F: le righe di servizio non diventano righe di contratto. Oltre al tipo
 * dichiarato dal modello si accettano accessori e «altro» che parlano di posa,
 * trasporto o montaggio; NON i prodotti (un serramento «fornitura e posa in
 * opera» resta un serramento, altrimenti sparirebbe dal contratto).
 *
 * P3-R16: una riga CON misure non è mai una riga di servizio, per quanto citi
 * la posa — «fornitura e posa in opera di n. 3 finestre 1200 × 1400» è un
 * prodotto, e assorbirla nella posa farebbe sparire misure e prezzo.
 */
function rigaDiServizio(r: RigaModello): boolean {
  if (r.tipoProdotto === "servizio") return true;
  if (r.larghezzaMm != null || r.altezzaMm != null) return false;
  return citaLaPosa(r);
}

function costruisciRiga(
  r: RigaModello,
  ordine: number,
  tariffe: Tariffe,
  pagine: readonly string[],
  zona: ZonaClimatica | null
): { riga: RigaProposta; dati: DatiRigaModello } {
  const { materiale, piuMateriali } = materialeRiga(r);
  const categoria = categoriaPer(r.tipoProdotto, materiale) ?? "altro";
  const evidenza = verificaEvidenza(pagine, r.pagina, r.frammento);
  // P3-R10: la forma vale anche per gli accessori (soglia ribassata) e per
  // l'oscurante; uno scorrevole che il testo dice portafinestra è una
  // portafinestra.
  const portafinestra = portafinestraRichiesta(r.tipoProdotto, r.descrizione) ?? false;
  const avvertenze: string[] = [];

  const materialeIndovinato = TIPI_SERRAMENTO.includes(r.tipoProdotto) && !MATERIALI_SERRAMENTO.includes(materiale);
  if (materialeIndovinato) {
    avvertenze.push("materiale non riconosciuto: verificato come PVC");
  }
  // P3-R34: la riga cita più materiali e quello della riga è dedotto dal
  // primo citato: si dichiara quale, invece di lasciare all'operatore il
  // dubbio su quale delle due parole abbia deciso la categoria.
  if (piuMateriali) {
    avvertenze.push(`più materiali citati: dedotto ${ETICHETTA_MATERIALE[materiale]}`);
  }
  if (citaLaPosa(r)) {
    avvertenze.push("cita la posa: verifica se è un prodotto o un servizio");
  }

  const larghezza = misuraValida(r.larghezzaMm, "larghezza", avvertenze);
  const altezza = misuraValida(r.altezzaMm, "altezza", avvertenze);
  const prezzo = r.prezzoTotale == null ? null : euroToCent(r.prezzoTotale);

  const tipologia = tipologiaDei(tariffe, categoria, r, zona);
  if (tipologia.avvertenza) avvertenze.push(tipologia.avvertenza);

  const oscurante: OscuranteIntegrato | null = r.oscuranteAbbinato === "nessuno" ? null : r.oscuranteAbbinato;
  const materialeOscurante = oscurante ? materialeOscuranteDelTesto(r.descrizione) : null;
  const sceltaOscuranteRiga =
    oscurante && materialeOscurante
      ? oscuranteDei(tariffe, oscurante, materialeOscurante.materiale, portafinestra, r.nAnte, r.lamelleOrientabili)
      : null;
  if (materialeOscurante?.indovinato) {
    avvertenze.push("materiale dell'oscurante non indicato: verificato come PVC");
  }
  if (sceltaOscuranteRiga?.avvertenza) avvertenze.push(sceltaOscuranteRiga.avvertenza);
  if (oscurante != null && sceltaOscuranteRiga?.codice == null) {
    avvertenze.push(`nessuna voce DEI per l'oscurante (${oscurante})`);
  }
  const notaOscurante = unisci(
    materialeOscurante?.indovinato ? "materiale dell'oscurante verificato come PVC" : null,
    sceltaOscuranteRiga?.avvertenza ?? null
  );

  const { accessori, nonRiconosciute } = risolviAccessori(
    tariffe,
    categoria,
    r.accessori,
    portafinestra,
    r.descrizione
  );

  const riga: RigaProposta = {
    ordine,
    categoria: campo(categoria, evidenza, { daVerificare: materialeIndovinato || piuMateriali || evidenza == null }),
    tipologia: campo<string | null>(tipologia.codice, evidenza, {
      daVerificare: tipologia.codice == null || tipologia.avvertenza != null || evidenza == null,
      nota: tipologia.avvertenza,
    }),
    descrizione: campo(r.descrizione.slice(0, 300), evidenza),
    quantita: campo(r.quantita, evidenza),
    larghezzaMm: campo<number | null>(larghezza, evidenza, { daVerificare: larghezza == null || evidenza == null }),
    altezzaMm: campo<number | null>(altezza, evidenza, { daVerificare: altezza == null || evidenza == null }),
    prezzoTotCent: campo<number | null>(prezzo, evidenza, { daVerificare: prezzo == null || evidenza == null }),
    oscuranteIntegrato: campo<OscuranteIntegrato | null>(oscurante, evidenza),
    oscuranteTipologia: campo<string | null>(sceltaOscuranteRiga?.codice ?? null, evidenza, {
      daVerificare:
        (oscurante != null && (sceltaOscuranteRiga?.codice == null || notaOscurante != null)) || evidenza == null,
      nota: notaOscurante,
    }),
    // L'oscurante dichiarato dal modello sulla riga è già dentro al prezzo
    // della riga: nessuna quota da ricordare (la valorizza `abbinaOscuranti`
    // quando fonde una riga oscurante a sé).
    quotaOscuranteCent: null,
    accessori,
    beneSignificativo: tariffe.beneSignificativoDefault[categoria],
    note: nonRiconosciute.length > 0 ? `accessori da verificare: ${nonRiconosciute.join(", ")}` : null,
    avvertenze,
  };

  return {
    riga,
    dati: { nAnte: r.nAnte, portafinestra, materiale, lamelleOrientabili: r.lamelleOrientabili },
  };
}

function dataIso(testo: string | null): string | null {
  if (!testo) return null;
  const pulito = testo.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(pulito);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const italiana = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/.exec(pulito);
  if (!italiana) return null;
  const giorno = Number(italiana[1]);
  const mese = Number(italiana[2]);
  const anno = Number(italiana[3]) < 100 ? 2000 + Number(italiana[3]) : Number(italiana[3]);
  if (giorno < 1 || giorno > 31 || mese < 1 || mese > 12) return null;
  return `${anno}-${String(mese).padStart(2, "0")}-${String(giorno).padStart(2, "0")}`;
}

/** «Sarzana (SP)» → «Sarzana»; «Sarzana, SP» → «Sarzana». */
function comuneSenzaSigla(citta: string | null): string | null {
  if (!citta) return null;
  const pulito = citta
    .replace(/\s*\(\s*[A-Za-z]{2}\s*\)\s*$/, "")
    .replace(/\s*,\s*[A-Za-z]{2}\s*$/, "")
    .trim();
  return pulito || null;
}

function siglaProvincia(citta: string | null): string | null {
  if (!citta) return null;
  const trovata = /\(\s*([A-Za-z]{2})\s*\)\s*$/.exec(citta) ?? /,\s*([A-Za-z]{2})\s*$/.exec(citta);
  return trovata ? trovata[1].toUpperCase() : null;
}

/**
 * P3-R12: parole che compaiono in mezza rubrica («Condominio», «Via», «srl»)
 * o che sono solo numeri civici non identificano nessuno: due condomini di
 * vie diverse non sono lo stesso cliente.
 */
const PAROLE_NON_DISTINTIVE = new Set([
  "condominio",
  "via",
  "piazza",
  "corso",
  "viale",
  "srl",
  "srls",
  "snc",
  "spa",
  "sas",
  "ditta",
  "impresa",
  "sig",
  "sigra",
  "dott",
  "ing",
  "geom",
  "arch",
  "del",
  "della",
  "dei",
  "delle",
]);

/** Parole di un nome che valgono per il confronto: almeno 3 lettere, non numeri, non generiche. */
function paroleUtili(nome: string): string[] {
  return normalizzaTesto(nome)
    .split(/[^a-z0-9]+/)
    .filter(p => p.length >= 3 && !/^\d+$/.test(p) && !PAROLE_NON_DISTINTIVE.has(p));
}

/** Aliquote IVA possibili su questi lavori: 4 % prima casa, 10 % agevolata, 22 % ordinaria. */
const ALIQUOTE_IVA = new Set([4, 10, 22]);

/**
 * Aliquota unica citata dal documento, altrimenti `null` (IVA mista o non
 * detta). Contano solo le percentuali che POSSONO essere un'IVA o che sono
 * scritte accanto alla parola: «sconto 5% — IVA 10%» è un documento al 10 %,
 * non un documento a IVA mista.
 */
function aliquotaUnica(descrizione: string | null): number | null {
  if (!descrizione) return null;
  const testo = normalizzaTesto(descrizione);
  const candidate = new Set<number>();
  for (const trovata of testo.matchAll(/(\d{1,2})\s*%/g)) {
    const valore = Number(trovata[1]);
    if (ALIQUOTE_IVA.has(valore)) candidate.add(valore);
  }
  for (const trovata of testo.matchAll(/iva[^\d%]{0,20}?(\d{1,2})\s*%/g)) candidate.add(Number(trovata[1]));
  return candidate.size === 1 ? [...candidate][0] : null;
}

/**
 * I controlli che si RICAVANO dai numeri della proposta. Gli altri
 * (`cliente_citato`, `codice_fiscale`, `zona_cantiere`, `zona_da_cliente`,
 * `rate_somma`) confrontano il documento con il CRM: non si possono
 * ricalcolare da una proposta e vanno conservati.
 */
const CONTROLLI_DERIVATI: readonly string[] = [
  "pattuito",
  "righe_vs_pattuito",
  "righe_senza_misure",
  "righe_senza_prezzo",
  "nessuna_riga",
  "documento_troncato",
];

/**
 * P3-R9: i controlli derivabili, ricalcolati sui valori che la proposta ha
 * ADESSO. Serve a `costruisciProposta` e, dopo, a chiunque riscriva quei
 * valori (l'arricchimento dal layout WnD): senza questo passaggio la
 * proposta finirebbe per dire «pattuito non trovato» accanto a un pattuito
 * valorizzato. I controlli non derivabili già presenti restano com'erano.
 */
export function costruisciControlli(
  proposta: PropostaContratto,
  opzioni: { ivaDescrizione: string | null; troncato: boolean }
): ControlloProposta[] {
  const controlli = proposta.controlli.filter(c => !CONTROLLI_DERIVATI.includes(c.codice));
  const { righe } = proposta;

  if (proposta.pattuitoCent.valore == null) {
    controlli.push({ codice: "pattuito", esito: "errore", messaggio: "pattuito non trovato nel documento" });
  }
  if (righe.length === 0) {
    controlli.push({ codice: "nessuna_riga", esito: "errore", messaggio: "nessuna riga di prodotto riconosciuta" });
  }

  // P3-R1: somma righe + posa contro l'imponibile; dal lordo si scorpora solo
  // con una aliquota unica dichiarata, altrimenti il controllo si salta.
  const sommaRighe = righe.reduce((s, r) => s + (r.prezzoTotCent.valore ?? 0), 0) + (proposta.posaCent.valore ?? 0);
  if (proposta.pattuitoCent.valore != null) {
    const aliquota = proposta.pattuitoTipo.valore === "lordo" ? aliquotaUnica(opzioni.ivaDescrizione) : null;
    const imponibile =
      proposta.pattuitoTipo.valore === "imponibile"
        ? proposta.pattuitoCent.valore
        : aliquota != null
          ? Math.round(proposta.pattuitoCent.valore / (1 + aliquota / 100))
          : null;
    if (imponibile == null) {
      controlli.push({
        codice: "righe_vs_pattuito",
        esito: "avviso",
        messaggio: "IVA mista o non indicata: somma righe non verificabile",
      });
    } else {
      const scarto = Math.abs(sommaRighe - imponibile);
      controlli.push(
        scarto > SCARTO_MASSIMO_CENT
          ? {
              codice: "righe_vs_pattuito",
              esito: "avviso",
              messaggio: `somma righe € ${euroTesto(sommaRighe)} contro imponibile € ${euroTesto(imponibile)}`,
            }
          : {
              codice: "righe_vs_pattuito",
              esito: "ok",
              messaggio: `somma righe e posa in linea con il pattuito (€ ${euroTesto(imponibile)})`,
            }
      );
    }
  }

  const senzaMisure = righe.filter(
    r => r.categoria.valore.startsWith("serramento_") && (r.larghezzaMm.valore == null || r.altezzaMm.valore == null)
  ).length;
  if (senzaMisure > 0) {
    controlli.push({
      codice: "righe_senza_misure",
      esito: "avviso",
      messaggio: `${senzaMisure} serramenti senza misure: completale prima di applicare`,
    });
  }
  const senzaPrezzo = righe.filter(r => r.prezzoTotCent.valore == null).length;
  if (senzaPrezzo > 0) {
    controlli.push({
      codice: "righe_senza_prezzo",
      esito: "avviso",
      messaggio: `${senzaPrezzo} righe senza prezzo`,
    });
  }
  if (opzioni.troncato) {
    controlli.push({
      codice: "documento_troncato",
      esito: "avviso",
      messaggio: "documento troppo lungo: alcune pagine non sono state lette",
    });
  }
  return controlli;
}

/**
 * Esito del modello → proposta di contratto. Ogni campo con la sua evidenza
 * verificata, ogni scelta di catalogo dichiarata, ogni incoerenza in un
 * controllo: la proposta si mostra all'operatore, non si applica da sola.
 */
export function costruisciProposta(
  esito: EsitoModello,
  contesto: ContestoMappa,
  troncato: boolean
): PropostaContratto {
  const { tariffe, pagine, clienteCommessa } = contesto;
  const controlli: ControlloProposta[] = [];
  const avvertenze: string[] = [];

  // ── Cantiere e zona (D-G) ────────────────────────────────────────────────
  const evCantiere = verificaEvidenza(pagine, esito.cantiere.pagina, esito.cantiere.frammento);
  const comuneDocumento = esito.cantiere.comune?.trim() || null;
  const cittaCliente = comuneSenzaSigla(clienteCommessa.citta);
  const comuneCantiere = comuneDocumento
    ? campo<string | null>(comuneDocumento, evCantiere)
    : campo<string | null>(cittaCliente, null, {
        daVerificare: true,
        nota: cittaCliente ? "indirizzo del cliente, non del cantiere" : "nessun comune indicato nel documento",
      });
  const indirizzoDocumento = esito.cantiere.indirizzo?.trim() || null;
  const indirizzoCantiere = indirizzoDocumento
    ? campo<string | null>(indirizzoDocumento, evCantiere)
    : campo<string | null>(clienteCommessa.indirizzo, null, {
        daVerificare: true,
        nota: clienteCommessa.indirizzo ? "indirizzo del cliente, non del cantiere" : "nessun indirizzo nel documento",
      });
  const provinciaCantiere =
    esito.cantiere.provincia?.trim().toUpperCase() || (comuneDocumento ? null : siglaProvincia(clienteCommessa.citta));
  const zona = comuneCantiere.valore ? (zonaPerComune(comuneCantiere.valore, provinciaCantiere)?.zona ?? null) : null;
  if (zona == null) {
    controlli.push({
      codice: "zona_cantiere",
      esito: "avviso",
      messaggio: comuneCantiere.valore
        ? `comune non risolto: indica la zona a mano (${comuneCantiere.valore})`
        : "comune del cantiere assente: indica la zona a mano",
    });
  } else if (comuneDocumento == null) {
    // I codici DEI dipendono dalla zona climatica: se la zona viene dalla
    // città del cliente e non dal cantiere, va detto (i massimali cambiano).
    controlli.push({
      codice: "zona_da_cliente",
      esito: "avviso",
      messaggio: `zona ${zona} dedotta dalla città del cliente (${comuneCantiere.valore}): il documento non indica il cantiere`,
    });
  }

  // ── Righe e servizi (D-F) ────────────────────────────────────────────────
  const servizi = esito.righe.filter(rigaDiServizio);
  const costruite = esito.righe
    .filter(r => !rigaDiServizio(r))
    .map((r, i) => costruisciRiga(r, i + 1, tariffe, pagine, zona));
  const righeAbbinate = abbinaOscuranti(
    costruite.map(c => c.riga),
    { tariffe, dati: costruite.map(c => c.dati) }
  );
  const righe = righeAbbinate.map((r, i) => ({ ...r, ordine: i + 1 }));

  const senzaEvidenza = righe.filter(r => r.descrizione.evidenza == null).length;
  if (senzaEvidenza > 0) {
    avvertenze.push(`${senzaEvidenza} righe senza evidenza verificata nel testo: controlla le citazioni`);
  }

  // ── Posa (D-F) ───────────────────────────────────────────────────────────
  const evPosa = verificaEvidenza(pagine, esito.posa.pagina, esito.posa.frammento);
  const prezziServizi = servizi.map(s => s.prezzoTotale).filter((p): p is number => p != null);
  const posaEuro = prezziServizi.length > 0 ? prezziServizi.reduce((s, p) => s + p, 0) : esito.posa.prezzo;
  const posaCent = posaEuro == null ? null : euroToCent(posaEuro);
  const descrizioniPosa = [...servizi.map(s => s.descrizione), esito.posa.descrizione]
    .map(d => d?.trim())
    .filter((d): d is string => !!d);
  const notePosa = [...new Set(descrizioniPosa)].join("; ") || null;

  // ── Pattuito (D-G) ───────────────────────────────────────────────────────
  const evPattuito = verificaEvidenza(pagine, esito.pattuito.pagina, esito.pattuito.frammento);
  let pattuitoCent = campo<number | null>(null, evPattuito, { daVerificare: true });
  let pattuitoTipo = campo<PattuitoTipo | null>(null, evPattuito, { daVerificare: true });
  if (esito.pattuito.totaleLordo != null) {
    pattuitoCent = campo<number | null>(euroToCent(esito.pattuito.totaleLordo), evPattuito);
    pattuitoTipo = campo<PattuitoTipo | null>("lordo", evPattuito);
  } else if (esito.pattuito.totaleImponibile != null) {
    pattuitoCent = campo<number | null>(euroToCent(esito.pattuito.totaleImponibile), evPattuito);
    pattuitoTipo = campo<PattuitoTipo | null>("imponibile", evPattuito);
  }

  // ── Rate ─────────────────────────────────────────────────────────────────
  const rate: RataContratto[] = esito.rate.map((r, i) => ({
    numero: i + 1,
    quotaPct: r.quotaPct,
    giorni: null,
    data: dataIso(r.scadenza),
    descrizione: r.descrizione.trim() || null,
  }));
  const evRate = esito.rate.length > 0 ? verificaEvidenza(pagine, esito.rate[0].pagina, esito.rate[0].frammento) : null;
  const campoRate = campo(rate, evRate, { daVerificare: rate.length === 0 ? true : undefined });
  if (rate.length > 0) {
    const somma = rate.reduce((s, r) => s + r.quotaPct, 0);
    if (Math.abs(somma - 100) > 0.5) {
      controlli.push({
        codice: "rate_somma",
        esito: "avviso",
        messaggio: `le rate sommano ${somma.toFixed(1).replace(".", ",")} %`,
      });
    }
  }

  // ── Cliente citato e codice fiscale ──────────────────────────────────────
  const evCliente = verificaEvidenza(pagine, esito.cliente.pagina, esito.cliente.frammento);
  const nomeCitato = esito.cliente.nome?.trim() || null;
  const clienteCitato = campo<string | null>(nomeCitato, evCliente, { daVerificare: nomeCitato == null || evCliente == null });
  if (nomeCitato && clienteCommessa.nome) {
    const citate = paroleUtili(nomeCitato);
    const dellaCommessa = paroleUtili(clienteCommessa.nome);
    const comuni = citate.filter(p => dellaCommessa.includes(p));
    if (citate.length === 0 || dellaCommessa.length === 0) {
      controlli.push({
        codice: "cliente_citato",
        esito: "avviso",
        messaggio: `cliente non confrontabile: il documento cita ${nomeCitato}, la commessa è di ${clienteCommessa.nome}`,
      });
    } else {
      controlli.push(
        comuni.length > 0
          ? { codice: "cliente_citato", esito: "ok", messaggio: "cliente coerente con la commessa" }
          : {
              codice: "cliente_citato",
              esito: "avviso",
              messaggio: `il documento cita ${nomeCitato}, la commessa è di ${clienteCommessa.nome}`,
            }
      );
    }
  }
  const cfCitato = esito.cliente.codiceFiscale?.trim() ?? null;
  if (cfCitato && clienteCommessa.codiceFiscale) {
    const uguali = normalizzaTesto(cfCitato) === normalizzaTesto(clienteCommessa.codiceFiscale);
    if (!uguali) {
      controlli.push({
        codice: "codice_fiscale",
        esito: "avviso",
        messaggio: `il documento cita il codice fiscale ${cfCitato}, diverso da quello del cliente`,
      });
    }
  }

  // ── Detrazione ───────────────────────────────────────────────────────────
  const detrazioneTipo =
    esito.detrazione === "non_indicata"
      ? campo<DetrazioneTipo | null>(clienteCommessa.tipoDetrazione, null, {
          daVerificare: true,
          nota: "non indicata nel documento: presa dal cliente CRM",
        })
      : campo<DetrazioneTipo | null>(esito.detrazione, null);

  // ── Data firma e riferimento ─────────────────────────────────────────────
  const firmaTesto = esito.dataFirma ?? esito.dataDocumento;
  const dallaData = esito.dataFirma == null && esito.dataDocumento != null;
  const dataFirma = campo<string | null>(dataIso(firmaTesto), null, {
    daVerificare: true,
    nota: dallaData ? "data del documento, non della firma" : null,
  });
  const riferimento = campo<string | null>(esito.riferimento?.trim() || null, null, { daVerificare: true });

  const proposta: PropostaContratto = {
    righe,
    pattuitoCent,
    pattuitoTipo,
    posaInclusa: campo(servizi.length > 0 ? true : esito.posa.inclusa, evPosa),
    posaCent: campo<number | null>(posaCent, evPosa, { daVerificare: posaCent == null || evPosa == null }),
    notePosa,
    rate: campoRate,
    comuneCantiere,
    indirizzoCantiere,
    provinciaCantiere,
    piano: campo<number | null>(esito.cantiere.piano, evCantiere, {
      daVerificare: esito.cantiere.piano == null || evCantiere == null,
    }),
    dataFirma,
    riferimento,
    clienteCitato,
    detrazioneTipo,
    note: esito.note.trim() || null,
    controlli,
    avvertenze,
  };

  return {
    ...proposta,
    controlli: costruisciControlli(proposta, { ivaDescrizione: esito.pattuito.ivaDescrizione, troncato }),
  };
}
