// Tariffe del computo limiti: massimali Allegato A, catalogo prodotti DEI
// (prezzi dei fogli «Calcolo Automatici A…F»), accessori con regola di
// applicazione, controtelai, opere, coefficienti e detrazioni. Sono DATI con
// una validità, letti dal seed generato dal foglio con
// scripts/estrai-tariffe-limiti.py; il motore non contiene mai un prezzo.
// Specifica: docs/superpowers/specs/2026-09-03-limiti-analisi-fogli-reali.md.
import seed from "@shared/limiti/tariffe-seed.json";
import seed2023 from "@shared/limiti/tariffe-seed-2023-i.json";
import seed2022v27 from "@shared/limiti/tariffe-seed-2022-ver27.json";
import {
  CODICI_OPERA,
  type CategoriaRiga,
  type CodiceOpera,
  type DetrazioneImmobile,
  type DetrazioneTipo,
  type GruppoProdotto,
  type ZonaClimatica,
} from "@shared/limiti/tipi";

export { CODICI_OPERA };

export type Massimale = { gruppo: "A" | "B" | "C"; zona: ZonaClimatica; euroMq: number };

export type Prodotto = {
  codice: string;
  gruppo: GruppoProdotto;
  famiglia: string;
  nome: string;
  prezzo: number;
  unita: "mq" | "cad" | "m";
  foglio: string;
  /** Serramenti in alluminio/legno: zone climatiche per cui vale la voce; null = tutte. */
  zone?: string[] | null;
  nAnte?: number;
  portafinestra?: boolean;
  /** Minimo di fatturazione sul totale della riga (1 mq PVC/alluminio, 1,8 mq avvolgibili). */
  minimoMq?: number | null;
  /** Cassonetti a pezzo: classe di mq per pezzo [min, max). */
  mqPezzoMin?: number;
  mqPezzoMax?: number | null;
  intervalloL?: string | null;
  intervalloH?: string | null;
};

export type RegolaAccessorio = "pct_mq" | "pct_pezzo" | "cad_pezzo" | "cad_anta" | "cad_fisso" | "m_perimetro";

export type Accessorio = {
  codice: string;
  codiceDei: string | null;
  nome: string;
  gruppo: GruppoProdotto;
  famiglie: string[];
  regola: RegolaAccessorio;
  valore: number;
  moltiplicatore: number;
  soloPortafinestra: boolean;
  foglio: string;
};

export type VoceControtelaio = {
  codice: string;
  famiglia: string;
  variante: string;
  unita: "mq" | "m" | "cad";
  prezzo: number;
  minimoMq: number | null;
};

export type VoceOpera = {
  codice: CodiceOpera;
  gruppo: "opere" | "eventuali";
  descrizione: string;
  codiceDei: string | null;
  unita: string;
  prezzo: number;
  /** Già compresa nel prezzo DEI «opere compiute»: non entra nel CHECK2 (T46). */
  esclusaDaCheck2: boolean;
  /** Inclusa nei totali senza scelta esplicita (opere ordinarie, rilievo a foro). */
  inclusaDefault: boolean;
};

export type Coefficienti = {
  oreTiro: Record<string, number>;
  orePosa: Record<string, number>;
  oreGiornata: number;
  euroKm: number;
  installatori: number;
  maggiorazionePianoOltre: number;
  maggiorazionePiano: number;
  puliziaFissoEuro: number;
  smaltimentoBaseEuro: number;
  smaltimentoEuroMc: number;
  smaltimentoEuroOnere: number;
  smaltimentoMcSerramento: number;
  smaltimentoMcCassonetto: number;
  smaltimentoMcOscurante: number;
  smaltimentoOnereSerramento: number;
  smaltimentoOnereCassonetto: number;
  smaltimentoOnereOscurante: number;
  speseProfessionaliPct: number;
  speseProfessionaliMinEuro: number;
  altriServiziPct: number;
  /** Minimo storico del foglio: il motore legge il minimo dalla voce (`controtelai[].minimoMq`), qui resta informativo. */
  controtelaiMinMq: number;
  /** Aliquota IVA agevolata del preventivo (0,10): stima l'imponibile da un pattuito lordo. */
  ivaAgevolata: number;
  /**
   * Maggiorazione del telo dell'avvolgibile (CHECK2 BS), una volta per riga:
   * `extraLarghezza × (L + offsetLarghezza) + extraAltezza × (H + offsetAltezza)`,
   * L e H in metri. Il cassonetto aggiunge 25 cm di telo su tutta la larghezza,
   * le guide 5 cm su tutta l'altezza: i due coefficienti non sono intercambiabili.
   */
  avvolgibileExtraLarghezza: number;
  avvolgibileExtraLarghezzaOffset: number;
  avvolgibileExtraAltezza: number;
  avvolgibileExtraAltezzaOffset: number;
};

export type RegolaDetrazione = {
  tipo: DetrazioneTipo;
  immobile: DetrazioneImmobile;
  anno: number;
  pct: number;
};

export type Tariffe = {
  /** «corrente» (il foglio in uso), «2023-i» (DEI 1° sem 2023, Ver.31/32), «2022-ver27» (Ver.27 del 13/10/2022). */
  edizione: string;
  versione: string;
  validoDal: string;
  massimali: Massimale[];
  prodotti: Prodotto[];
  accessori: Accessorio[];
  controtelai: VoceControtelaio[];
  opere: VoceOpera[];
  coefficienti: Coefficienti;
  detrazioni: RegolaDetrazione[];
  beneSignificativoDefault: Record<CategoriaRiga, boolean>;
};

const SEED = seed as unknown as Tariffe;
/**
 * Le edizioni storiche del foglio servono a riprodurre i computi passati
 * (fixture dai fogli 2022-2025): il CRM calcola sempre con «corrente». Le
 * edizioni non sono in ordine di data: il foglio in uso nel 2026 ha i
 * prezzi del prezzario II 2022 (rilievo 60,17 €/h), quello del 2023-2024
 * il DEI 1° semestre 2023 (61,22 €/h).
 */
const EDIZIONI: Record<string, Tariffe> = {
  corrente: SEED,
  "2023-i": seed2023 as unknown as Tariffe,
  "2022-ver27": seed2022v27 as unknown as Tariffe,
};

export function tariffeEdizione(edizione: string | null | undefined): Tariffe {
  const t = EDIZIONI[edizione ?? "corrente"];
  if (!t) throw new Error(`TARIFFE_EDIZIONE_SCONOSCIUTA: ${edizione}`);
  return t;
}
const PRODOTTI = new Map(SEED.prodotti.map(p => [p.codice, p]));
const ACCESSORI = new Map(SEED.accessori.map(a => [a.codice, a]));

/** Tariffe valide alla data indicata. Un solo seed oggi: la data serve al contratto della funzione. */
export function tariffeAttive(alla: Date = new Date()): Tariffe {
  if (alla.toISOString().slice(0, 10) < SEED.validoDal) {
    // Prima del DM 14/02/2022 non esiste un massimale: lo diciamo, non inventiamo un listino precedente.
    throw new Error(`TARIFFE_NON_DISPONIBILI: nessuna tariffa prima del ${SEED.validoDal}`);
  }
  return SEED;
}

export function massimaleEuroMq(t: Tariffe, gruppo: "A" | "B" | "C", zona: ZonaClimatica): number {
  const trovato = t.massimali.find(m => m.gruppo === gruppo && m.zona === zona);
  if (!trovato) throw new Error(`MASSIMALE_MANCANTE: ${gruppo}/${zona}`);
  return trovato.euroMq;
}

export function prodotto(t: Tariffe, codice: string): Prodotto | null {
  return (t === SEED ? PRODOTTI.get(codice) : t.prodotti.find(p => p.codice === codice)) ?? null;
}

export function prodottiPer(
  t: Tariffe,
  gruppo: GruppoProdotto,
  famiglia?: string | null,
  zona?: ZonaClimatica | null
): Prodotto[] {
  return t.prodotti.filter(
    p =>
      p.gruppo === gruppo &&
      (!famiglia || p.famiglia === famiglia) &&
      (!zona || !p.zone || p.zone.includes(zona))
  );
}

export function accessorio(t: Tariffe, codice: string): Accessorio | null {
  return (t === SEED ? ACCESSORI.get(codice) : t.accessori.find(a => a.codice === codice)) ?? null;
}

export function accessoriPer(
  t: Tariffe,
  gruppo: GruppoProdotto,
  famiglia: string,
  portafinestra: boolean
): Accessorio[] {
  return t.accessori.filter(
    a =>
      a.gruppo === gruppo &&
      (a.famiglie.length === 0 || a.famiglie.includes(famiglia)) &&
      (!a.soloPortafinestra || portafinestra)
  );
}

export function voceControtelaio(t: Tariffe, codice: string): VoceControtelaio | null {
  return t.controtelai.find(c => c.codice === codice) ?? null;
}

export function voceOpera(t: Tariffe, codice: CodiceOpera): VoceOpera {
  const trovata = t.opere.find(o => o.codice === codice);
  if (!trovata) throw new Error(`OPERA_SCONOSCIUTA: ${codice}`);
  return trovata;
}

export function percentualeDetrazione(
  t: Tariffe,
  tipo: DetrazioneTipo,
  immobile: DetrazioneImmobile | null,
  anno: number
): number | null {
  if (tipo === "nessuna") return null;
  const candidati = t.detrazioni.filter(
    d => d.tipo === tipo && d.immobile === (immobile ?? "altro") && d.anno <= anno
  );
  if (candidati.length === 0) return null;
  return candidati.sort((a, b) => b.anno - a.anno)[0].pct;
}
