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

/**
 * Materiale della riga: quello dichiarato dal modello, oppure — se dice
 * «sconosciuto» — quello dedotto dalla descrizione (marchi di profili in PVC
 * compresi). Resta «sconosciuto» quando il testo non lo dice: la riga lo
 * dichiarerà con un'avvertenza, non lo inventa.
 */
export function materialeEffettivo(r: RigaModello): Materiale {
  if (r.materiale !== "sconosciuto") return r.materiale;
  return materialeDelTesto(r.descrizione) ?? "sconosciuto";
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

function parolaChiaveCompatibile(nome: string, tipo: TipoProdotto, descrizione: string): boolean {
  const n = normalizzaTesto(nome);
  const scorrevole = n.includes("scorrevole");
  const telaioFisso = n.includes("telaio fisso");
  if (tipo === "scorrevole") {
    if (!scorrevole) return false;
    return normalizzaTesto(descrizione).includes("alzante") ? n.includes("alzante") : n.includes("complanare");
  }
  if (tipo === "fisso") return telaioFisso;
  return !scorrevole && !telaioFisso;
}

/**
 * Codice DEI del prodotto della riga (D-B). Serramenti: si filtra per
 * famiglia, portafinestra, parola chiave (scorrevole/alzante/complanare,
 * telaio fisso) e zona climatica, poi si PREFERISCE il numero di ante letto
 * dal modello; se nessuna voce ha quelle ante si resta sulle altre e lo si
 * dichiara. Righe autonome (persiane, tapparelle, cassonetti…): prima voce
 * della famiglia dedotta. Un solo candidato → codice certo; più candidati →
 * il primo, con avvertenza; nessuno → `null` con avvertenza.
 */
export function tipologiaDei(
  t: Tariffe,
  categoria: CategoriaRiga,
  r: { tipoProdotto: TipoProdotto; nAnte: number; descrizione: string },
  zona: ZonaClimatica | null
): { codice: string | null; avvertenza: string | null } {
  const { gruppo, famiglia } = gruppoPerCategoria(categoria);
  if (gruppo == null) return { codice: null, avvertenza: null };
  if (gruppo === "serramento") return tipologiaSerramento(t, categoria, famiglia, r, zona);

  const famigliaVoce = famiglia ?? famigliaDedotta(t, gruppo, r.descrizione);
  if (famigliaVoce == null) {
    return { codice: null, avvertenza: `nessuna voce DEI per ${categoria}: materiale non riconosciuto` };
  }
  const candidati = prodottiPer(t, gruppo, famigliaVoce, zona);
  if (candidati.length === 0) {
    return { codice: null, avvertenza: `nessuna voce DEI per ${categoria} (${famigliaVoce})` };
  }
  // Righe autonome: il seed elenca le voci nell'ordine del foglio, la prima è
  // quella standard (avvolgibile PVC standard, alluminio da 55 mm…).
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
  const portafinestra = r.tipoProdotto === "portafinestra";
  let candidati = prodottiPer(t, "serramento", famiglia, zona)
    .filter(p => ammesse == null || ammesse.includes(p.famiglia))
    .filter(p => (p.portafinestra ?? false) === portafinestra)
    .filter(p => parolaChiaveCompatibile(p.nome, r.tipoProdotto, r.descrizione));

  if (candidati.length === 0) {
    const dettaglio = zona ? `${r.tipoProdotto}, zona ${zona}` : r.tipoProdotto;
    return { codice: null, avvertenza: `nessuna voce DEI per ${categoria} (${dettaglio})` };
  }

  const ante = r.nAnte > 0 ? r.nAnte : 1;
  const conAnte = candidati.filter(p => (p.nAnte ?? 0) === ante);
  let avvertenzaAnte: string | null = null;
  if (conAnte.length > 0) candidati = conAnte;
  else avvertenzaAnte = `nessuna voce DEI a ${ante} ante`;

  const ordinati = [...candidati].sort(perCodice);
  const scelto = ordinati[0];
  const avvertenzaScelta = ordinati.length > 1 ? `più voci DEI possibili: scelta ${scelto.codice}` : null;
  return { codice: scelto.codice, avvertenza: unisci(avvertenzaAnte, avvertenzaScelta) };
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
 * Codice DEI dell'oscurante abbinato al serramento. Famiglia = materiale
 * dell'oscurante (l'unica del gruppo quando ce n'è una sola); persiane e
 * scuri si scelgono per lamelle orientabili e per forma (finestra o
 * portafinestra, numero di ante); le tapparelle non hanno forma: vale la
 * prima voce della famiglia (PVC standard, alluminio 55 mm, acciaio 40 mm).
 */
export function oscuranteDei(
  t: Tariffe,
  oscurante: OscuranteIntegrato,
  materialeOscurante: Materiale,
  portafinestra: boolean,
  nAnte: number,
  lamelleOrientabili: boolean
): string | null {
  const gruppo = gruppoPerOscurante(oscurante);
  const famiglie = famiglieDelGruppo(t, gruppo);
  const famiglia = famiglie.includes(materialeOscurante)
    ? materialeOscurante
    : famiglie.length === 1
      ? famiglie[0]
      : null;
  if (famiglia == null) return null;

  let candidati = prodottiPer(t, gruppo, famiglia);
  if (candidati.length === 0) return null;

  if (gruppo === "persiana" || gruppo === "scuro") {
    const perLamelle = candidati.filter(p => haOrientabili(p.nome) === lamelleOrientabili);
    if (perLamelle.length > 0) candidati = perLamelle;
    const ante = nAnte > 0 ? nAnte : 1;
    const perForma = candidati.filter(p => {
      const forma = formaDalNome(p.nome);
      return forma != null && forma.portafinestra === portafinestra && (forma.ante.length === 0 || forma.ante.includes(ante));
    });
    if (perForma.length > 0) candidati = perForma;
  }

  return candidati[0].codice;
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
  { prova: /pellicol|real wood|effetto legno|rovere/, famiglie: ["pvc", "velux"], codici: ["serramento.C25088-a"] },
  { prova: /incollaggio/, codici: ["serramento.C25088-b"] },
  { prova: /soglia\s+ribassata/, codici: ["serramento.C25088-c"] },
  { prova: /coprifil.*80/, codici: ["serramento.C25088-h"] },
  { prova: /coprifil.*100/, codici: ["serramento.C25088-i"] },
  { prova: /anodizz|elettrocolore/, famiglie: ["alluminio"], codici: ["serramento.C15054-b"] },
  { prova: /vernic.*special/, codici: ["serramento.C15054-c"] },
  { prova: /effetto legno/, famiglie: ["alluminio"], codici: ["serramento.C15054-d"] },
  { prova: /acustic/, codici: ["serramento.C15055", "serramento.C15075"] },
];

/** Famiglia con cui interrogare il catalogo accessori (il legno-alluminio ne ha due, vale la prima). */
function famigliaAccessori(categoria: CategoriaRiga, famiglia: string | null): string {
  if (famiglia != null) return famiglia;
  return categoria === "serramento_legno_alluminio" ? "legno_alluminio" : "";
}

function risolviAccessori(
  t: Tariffe,
  categoria: CategoriaRiga,
  etichette: readonly string[],
  portafinestra: boolean
): { accessori: RigaProposta["accessori"]; nonRiconosciute: string[] } {
  const pulite = etichette.map(e => e.trim()).filter(e => e !== "");
  const { gruppo, famiglia } = gruppoPerCategoria(categoria);
  if (gruppo == null) return { accessori: [], nonRiconosciute: pulite };

  const famigliaRiga = famigliaAccessori(categoria, famiglia);
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
  nAnte: number
): RigaProposta["accessori"] {
  void nAnte; // le voci DEI sono a pezzo: la quantità è 1 per riga, non per anta.
  return risolviAccessori(t, categoria, etichette, portafinestra).accessori;
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
 * serramento con lo stesso foro (±10 mm) e quantità capiente, portandosi la
 * quota di prezzo; l'oscurante che non trova serramento resta una riga sua.
 * Le righe restano nell'ordine di lettura.
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

    for (let j = 0; j < lavorate.length && residuo > 0; j++) {
      const serramento = lavorate[j];
      if (!serramento.categoria.valore.startsWith("serramento_")) continue;
      if (serramento.oscuranteIntegrato.valore != null) continue;
      const sl = serramento.larghezzaMm.valore;
      const sh = serramento.altezzaMm.valore;
      if (sl == null || sh == null) continue;
      if (Math.abs(sl - larghezza) > TOLLERANZA_MM || Math.abs(sh - altezza) > TOLLERANZA_MM) continue;
      if (serramento.quantita.valore < residuo) continue;

      const abbinata = Math.min(serramento.quantita.valore, residuo);
      const quota = prezzoOscurante == null || pezzi === 0 ? 0 : Math.round((prezzoOscurante * abbinata) / pezzi);
      const evidenza = oscurante.descrizione.evidenza;
      const codice = contesto
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
      serramento.oscuranteTipologia = campo<string | null>(codice, evidenza, { daVerificare: true });
      if (prezzoOscurante != null) {
        serramento.prezzoTotCent = campo<number | null>(
          (serramento.prezzoTotCent.valore ?? 0) + quota,
          serramento.prezzoTotCent.evidenza,
          { daVerificare: true, nota: `comprende ${categoria} (€ ${euroTesto(quota)})` }
        );
      }
      serramento.note = unisci(serramento.note, `${categoria} abbinata (€ ${euroTesto(quota)})`);

      residuo -= abbinata;
      oscurante.quantita = campo(residuo, oscurante.quantita.evidenza, { daVerificare: true });
      if (prezzoOscurante != null) {
        oscurante.prezzoTotCent = campo<number | null>(prezzoOscurante - quota, oscurante.prezzoTotCent.evidenza, {
          daVerificare: true,
        });
      }
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

/**
 * D-F: le righe di servizio non diventano righe di contratto. Oltre al tipo
 * dichiarato dal modello si accettano accessori e «altro» che parlano di posa,
 * trasporto o montaggio; NON i prodotti (un serramento «fornitura e posa in
 * opera» resta un serramento, altrimenti sparirebbe dal contratto).
 */
function rigaDiServizio(r: RigaModello): boolean {
  if (r.tipoProdotto === "servizio") return true;
  if (r.tipoProdotto !== "accessorio" && r.tipoProdotto !== "altro") return false;
  return PAROLE_SERVIZIO.test(normalizzaTesto(r.descrizione));
}

function costruisciRiga(
  r: RigaModello,
  ordine: number,
  tariffe: Tariffe,
  pagine: readonly string[],
  zona: ZonaClimatica | null
): { riga: RigaProposta; dati: DatiRigaModello } {
  const materiale = materialeEffettivo(r);
  const categoria = categoriaPer(r.tipoProdotto, materiale) ?? "altro";
  const evidenza = verificaEvidenza(pagine, r.pagina, r.frammento);
  const portafinestra = r.tipoProdotto === "portafinestra";
  const avvertenze: string[] = [];

  if (TIPI_SERRAMENTO.includes(r.tipoProdotto) && !MATERIALI_SERRAMENTO.includes(materiale)) {
    avvertenze.push("materiale non riconosciuto: verificato come PVC");
  }

  const larghezza = misuraValida(r.larghezzaMm, "larghezza", avvertenze);
  const altezza = misuraValida(r.altezzaMm, "altezza", avvertenze);
  const prezzo = r.prezzoTotale == null ? null : euroToCent(r.prezzoTotale);

  const tipologia = tipologiaDei(tariffe, categoria, r, zona);
  if (tipologia.avvertenza) avvertenze.push(tipologia.avvertenza);

  const oscurante: OscuranteIntegrato | null = r.oscuranteAbbinato === "nessuno" ? null : r.oscuranteAbbinato;
  const materialeOscurante = materialeDelTesto(r.descrizione) ?? "pvc";
  const oscuranteTipologia = oscurante
    ? oscuranteDei(tariffe, oscurante, materialeOscurante, portafinestra, r.nAnte, r.lamelleOrientabili)
    : null;
  if (oscurante != null && oscuranteTipologia == null) {
    avvertenze.push(`nessuna voce DEI per l'oscurante (${oscurante})`);
  }

  const { accessori, nonRiconosciute } = risolviAccessori(tariffe, categoria, r.accessori, portafinestra);

  const riga: RigaProposta = {
    ordine,
    categoria: campo(categoria, evidenza),
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
    oscuranteTipologia: campo<string | null>(oscuranteTipologia, evidenza, {
      daVerificare: (oscurante != null && oscuranteTipologia == null) || evidenza == null,
    }),
    accessori,
    // D-F: coprifili, maniglie e simili non sono beni significativi, anche se
    // il seed marca `accessorio` come significativo per prudenza.
    beneSignificativo: categoria === "accessorio" ? false : tariffe.beneSignificativoDefault[categoria],
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

function parole(nome: string): string[] {
  return normalizzaTesto(nome)
    .split(/[^a-z0-9]+/)
    .filter(p => p.length >= 3);
}

/** Aliquota unica citata dal documento: 10 o 22, altrimenti `null` (IVA mista o non detta). */
function aliquotaUnica(descrizione: string | null): number | null {
  if (!descrizione) return null;
  const trovate = new Set([...descrizione.matchAll(/(\d{1,2})\s*%/g)].map(m => Number(m[1])));
  if (trovate.size !== 1) return null;
  const [aliquota] = [...trovate];
  return aliquota === 10 || aliquota === 22 ? aliquota : null;
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
  } else {
    controlli.push({ codice: "pattuito", esito: "errore", messaggio: "pattuito non trovato nel documento" });
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
    const comuni = parole(nomeCitato).filter(p => parole(clienteCommessa.nome ?? "").includes(p));
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

  // ── Controlli (P3-R1) ────────────────────────────────────────────────────
  if (righe.length === 0) {
    controlli.push({ codice: "nessuna_riga", esito: "errore", messaggio: "nessuna riga di prodotto riconosciuta" });
  }
  const sommaRighe = righe.reduce((s, r) => s + (r.prezzoTotCent.valore ?? 0), 0) + (posaCent ?? 0);
  if (pattuitoCent.valore != null) {
    const aliquota = pattuitoTipo.valore === "lordo" ? aliquotaUnica(esito.pattuito.ivaDescrizione) : null;
    const imponibile =
      pattuitoTipo.valore === "imponibile"
        ? pattuitoCent.valore
        : aliquota != null
          ? Math.round(pattuitoCent.valore / (1 + aliquota / 100))
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
  if (troncato) {
    controlli.push({
      codice: "documento_troncato",
      esito: "avviso",
      messaggio: "documento troppo lungo: alcune pagine non sono state lette",
    });
  }

  return {
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
}
