// Listino Punto del Serramento — persiane + porte.
//
// Il listino originale (aziendale) è persistito come JSON in
// `./punto-del-serramento.json`. Lo importiamo qui e ne ricaviamo una forma
// tipizzata con helper per:
//   • elencare i modelli
//   • arrotondare per eccesso le misure utente alla misura standard più vicina
//   • applicare il minimo preventivabile di 1 m²
//   • applicare le maggiorazioni colore

import rawListino from "./punto-del-serramento.json";

// ── Listino model ───────────────────────────────────────────────────────────

/**
 * Struttura del JSON:
 * {
 *   "Configurazione": { "Altezza_Larghezza": null },
 *   "<Modello>": {
 *     "<dim1>_<dim2>": <prezzo €>,
 *     ...
 *   }
 * }
 *
 * Le chiavi `<dim1>_<dim2>` sono in mm. Dal range delle dimensioni (dim1
 * 400-2000 per persiane, 1700-2800 per porte; dim2 molto più stretto)
 * `dim1 = altezza`, `dim2 = larghezza`.
 */
type Raw = Record<string, Record<string, number> | { Altezza_Larghezza: null }>;
const raw = rawListino as Raw;

export type Modello = {
  key: string; // nome listino, es. "Persiana 1 Anta Lamelle Fisse"
  label: string; // alias human-readable (== key, ma futuro-proof)
  altezzeStandard: number[]; // mm, crescenti
  larghezzeStandard: number[]; // mm, crescenti
  /** tabella prezzi indicizzata per chiave "{altezza}_{larghezza}" */
  prezzi: Record<string, number>;
};

function buildModello(nome: string, data: Record<string, number>): Modello {
  const altezze = new Set<number>();
  const larghezze = new Set<number>();
  for (const k of Object.keys(data)) {
    const [a, l] = k.split("_").map((s) => parseInt(s, 10));
    if (Number.isFinite(a) && Number.isFinite(l)) {
      altezze.add(a);
      larghezze.add(l);
    }
  }
  return {
    key: nome,
    label: nome,
    altezzeStandard: Array.from(altezze).sort((a, b) => a - b),
    larghezzeStandard: Array.from(larghezze).sort((a, b) => a - b),
    prezzi: data,
  };
}

export const MODELLI: Modello[] = Object.entries(raw)
  .filter(([k]) => k !== "Configurazione")
  .map(([nome, data]) => buildModello(nome, data as Record<string, number>));

export function getModello(key: string): Modello | undefined {
  return MODELLI.find((m) => m.key === key);
}

// ── Round-up + prezzo base ──────────────────────────────────────────────────

export type PrezzoLookup =
  | {
      ok: true;
      /** misura utente (mm) */
      altezzaUtente: number;
      larghezzaUtente: number;
      /** misura standard utilizzata (mm) */
      altezzaStandard: number;
      larghezzaStandard: number;
      /** area in m² della misura standard applicata */
      areaMq: number;
      /** true se la misura utente è stata arrotondata per eccesso */
      arrotondata: boolean;
      /** true se è stato applicato il minimo 1 m² */
      minimoApplicato: boolean;
      /** prezzo base (senza maggiorazione colore) */
      prezzo: number;
    }
  | {
      ok: false;
      reason: "fuori_listino" | "misure_mancanti";
    };

function ceilToStandard(value: number, standards: number[]): number | null {
  for (const s of standards) {
    if (value <= s) return s;
  }
  return null;
}

/**
 * Dato un modello e la misura utente (mm), restituisce:
 *  • la misura standard da usare (arrotondata per eccesso in entrambi gli
 *    assi),
 *  • il relativo prezzo base,
 *  • l'applicazione del minimo 1 m² se l'area arrotondata è inferiore.
 *
 * Il minimo 1 m² si applica bumpando altezza / larghezza alla misura standard
 * successiva finché l'area risulta ≥ 1 m² (o finché una delle due dimensioni
 * esce dal listino — in quel caso `fuori_listino`).
 */
export function lookupPrezzo(
  modello: Modello,
  larghezzaMm: number,
  altezzaMm: number
): PrezzoLookup {
  if (!larghezzaMm || !altezzaMm) return { ok: false, reason: "misure_mancanti" };

  const altStd = ceilToStandard(altezzaMm, modello.altezzeStandard);
  const larStd = ceilToStandard(larghezzaMm, modello.larghezzeStandard);
  if (altStd == null || larStd == null) {
    return { ok: false, reason: "fuori_listino" };
  }

  let alt = altStd;
  let lar = larStd;
  let minimoApplicato = false;

  // Minimo 1 m²: (alt × lar) / 1_000_000 ≥ 1. Se il prodotto è inferiore,
  // avanziamo al prossimo step standard — prima l'asse più piccolo — finché
  // l'area è ≥ 1 m² o finché si esce dal listino.
  const altezze = modello.altezzeStandard;
  const larghezze = modello.larghezzeStandard;
  let altIdx = altezze.indexOf(alt);
  let larIdx = larghezze.indexOf(lar);

  while ((alt * lar) / 1_000_000 < 1) {
    minimoApplicato = true;
    // Scegli di bumpare l'asse che cresce di meno (step minore) per arrivare a
    // 1 m² con il prezzo più basso possibile. In pratica, confronta il delta
    // area ottenuto bumpando alt vs lar.
    const nextAlt = altIdx + 1 < altezze.length ? altezze[altIdx + 1] : null;
    const nextLar = larIdx + 1 < larghezze.length ? larghezze[larIdx + 1] : null;
    if (nextAlt == null && nextLar == null) {
      return { ok: false, reason: "fuori_listino" };
    }
    const deltaAlt = nextAlt != null ? nextAlt * lar - alt * lar : Infinity;
    const deltaLar = nextLar != null ? alt * nextLar - alt * lar : Infinity;
    if (deltaAlt <= deltaLar && nextAlt != null) {
      alt = nextAlt;
      altIdx++;
    } else if (nextLar != null) {
      lar = nextLar;
      larIdx++;
    } else if (nextAlt != null) {
      alt = nextAlt;
      altIdx++;
    } else {
      return { ok: false, reason: "fuori_listino" };
    }
  }

  const key = `${alt}_${lar}`;
  const prezzo = modello.prezzi[key];
  if (typeof prezzo !== "number") {
    // Combinazione (alt, lar) non presente: alcuni modelli hanno griglie non
    // rettangolari complete. Trova il più piccolo prezzo presente con alt ≥
    // alt scelto e lar ≥ lar scelto.
    const fallback = findSmallestValid(modello, alt, lar);
    if (!fallback) return { ok: false, reason: "fuori_listino" };
    return {
      ok: true,
      altezzaUtente: altezzaMm,
      larghezzaUtente: larghezzaMm,
      altezzaStandard: fallback.alt,
      larghezzaStandard: fallback.lar,
      areaMq: (fallback.alt * fallback.lar) / 1_000_000,
      arrotondata: true,
      minimoApplicato,
      prezzo: fallback.prezzo,
    };
  }

  return {
    ok: true,
    altezzaUtente: altezzaMm,
    larghezzaUtente: larghezzaMm,
    altezzaStandard: alt,
    larghezzaStandard: lar,
    areaMq: (alt * lar) / 1_000_000,
    arrotondata: alt !== altezzaMm || lar !== larghezzaMm,
    minimoApplicato,
    prezzo,
  };
}

function findSmallestValid(
  modello: Modello,
  minAlt: number,
  minLar: number
): { alt: number; lar: number; prezzo: number } | null {
  let best: { alt: number; lar: number; prezzo: number } | null = null;
  for (const [k, p] of Object.entries(modello.prezzi)) {
    const [a, l] = k.split("_").map((s) => parseInt(s, 10));
    if (a < minAlt || l < minLar) continue;
    if (!best || a * l < best.alt * best.lar) {
      best = { alt: a, lar: l, prezzo: p };
    }
  }
  return best;
}

// ── Colori e maggiorazioni ──────────────────────────────────────────────────

export type MaggiorazioneTipo = "diSerie" | "percento" | "aPreventivo";

export type Colore = {
  key: string;
  nome: string;
  tipo: MaggiorazioneTipo;
  /** Percentuale di maggiorazione sul prezzo base (es. 10 = +10%). Solo per tipo "percento". */
  percentuale?: number;
  /** Famiglia/categoria a fini di raggruppamento nell'UI. */
  famiglia:
    | "ossidato"
    | "ral_di_serie"
    | "ral_opaco"
    | "ral_grinz"
    | "grinz"
    | "effetti"
    | "michelangelo"
    | "effecta"
    | "sublimato_viv"
    | "sublimato_geal"
    | "a_preventivo";
};

// Helper shorthand
const aPrev = (k: string, nome: string, famiglia: Colore["famiglia"]): Colore => ({
  key: k,
  nome,
  tipo: "aPreventivo",
  famiglia,
});
const diSerie = (k: string, nome: string, famiglia: Colore["famiglia"]): Colore => ({
  key: k,
  nome,
  tipo: "diSerie",
  famiglia,
});
const pct = (
  k: string,
  nome: string,
  percentuale: number,
  famiglia: Colore["famiglia"]
): Colore => ({
  key: k,
  nome,
  tipo: "percento",
  percentuale,
  famiglia,
});

export const COLORI: Colore[] = [
  // Ossidati / speciali — a preventivo
  aPrev("ossidato_argento", "Ossidato Argento", "ossidato"),
  aPrev("ossidato_bronzo", "Ossidato Bronzo", "ossidato"),
  aPrev("elox_nero", "Elox Nero", "ossidato"),

  // RAL di serie
  diSerie("ral_9010_bianco", "Bianco RAL 9010", "ral_di_serie"),
  diSerie("ral_1013_avorio", "Avorio RAL 1013", "ral_di_serie"),
  diSerie("ral_6005_verde", "Verde RAL 6005", "ral_di_serie"),
  diSerie("ral_8017_marrone", "Marrone RAL 8017", "ral_di_serie"),

  // RAL Opaco
  pct("ral_9001_crema_opaco", "Crema RAL 9001 Opaco", 10, "ral_opaco"),
  pct("ral_7001_grigio_argento_opaco", "Grigio Argento RAL 7001 Opaco", 5, "ral_opaco"),
  pct("ral_7035_grigio_luce_opaco", "Grigio Luce RAL 7035 Opaco", 5, "ral_opaco"),

  // RAL Grinz
  pct("ral_6011_verde_reseda_grinz", "Verde Reseda RAL 6011 Grinz", 5, "ral_grinz"),
  pct("ral_6021_verde_pallido_grinz", "Verde Pallido RAL 6021 Grinz", 5, "ral_grinz"),

  // Grinz di serie / maggiorati
  diSerie("verde_grinz", "Verde Grinz", "grinz"),
  diSerie("marrone_grinz", "Marrone Grinz", "grinz"),
  pct("bianco_grinz", "Bianco Grinz", 10, "grinz"),
  pct("avorio_grinz", "Avorio Grinz", 10, "grinz"),

  // Effetti metallo/ruggine
  pct("ferro_micaceo", "Ferro Micaceo", 10, "effetti"),
  pct("ruggine", "Ruggine", 15, "effetti"),
  pct("quartz_1", "Quartz 1", 25, "effetti"),

  // Michelangelo
  pct("verde_michelangelo", "Verde Michelangelo", 5, "michelangelo"),
  pct("marrone_michelangelo", "Marrone Michelangelo", 5, "michelangelo"),
  pct("bianco_michelangelo", "Bianco Michelangelo", 5, "michelangelo"),
  pct("grigio_michelangelo", "Grigio Michelangelo", 5, "michelangelo"),

  // Effecta DFV
  pct("effecta_noce_scuro", "Noce Scuro (Effecta DFV)", 25, "effecta"),
  pct("effecta_noce_chiaro", "Noce Chiaro (Effecta DFV)", 25, "effecta"),
  pct("effecta_ciliegio", "Ciliegio (Effecta DFV)", 25, "effecta"),
  pct("effecta_white", "White (Effecta DFV)", 25, "effecta"),
  pct("effecta_green", "Green (Effecta DFV)", 25, "effecta"),

  // Sublimato VIV Decoral
  pct(
    "viv_renolit_386_73r",
    "Renolit 386-73R (Sublimato VIV Decoral)",
    30,
    "sublimato_viv"
  ),
  pct(
    "viv_noce_plast_391_123r",
    "Noce Plast 391-123R (Sublimato VIV Decoral)",
    30,
    "sublimato_viv"
  ),
  pct(
    "viv_castagno_europeo_goffrato",
    "Castagno Europeo Goffrato (Sublimato VIV Decoral)",
    30,
    "sublimato_viv"
  ),

  // Sublimato GEAL
  pct(
    "geal_noce_nazionale_09_7_grinz",
    "Noce Nazionale 09-7 Grinz (Sublimato GEAL)",
    40,
    "sublimato_geal"
  ),
  pct(
    "geal_pero_chiaro_01_7a_golden_grinz",
    "Pero Chiaro 01/7A Golden Grinz (Sublimato GEAL)",
    40,
    "sublimato_geal"
  ),
  pct("geal_ciliegio_grinz", "Ciliegio Grinz (Sublimato GEAL)", 40, "sublimato_geal"),
  pct(
    "geal_rovere_sbiancato_subg05f24",
    "Rovere Sbiancato SUBG05F24 (Sublimato GEAL)",
    40,
    "sublimato_geal"
  ),
  pct(
    "geal_pino_con_nodi_grinz",
    "Pino con Nodi Grinz (Sublimato GEAL)",
    40,
    "sublimato_geal"
  ),

  // A preventivo generici
  aPrev("effetti_ossidazione", "Effetti Ossidazione", "a_preventivo"),
  aPrev("altri_ral_grinz_michelangelo", "Altri RAL / Grinz / Michelangelo", "a_preventivo"),
  aPrev("altri_effetti_legno", "Altri effetti Legno", "a_preventivo"),
];

export const FAMIGLIA_LABEL: Record<Colore["famiglia"], string> = {
  ossidato: "Ossidato / Elox (a preventivo)",
  ral_di_serie: "RAL di serie",
  ral_opaco: "RAL Opaco",
  ral_grinz: "RAL Grinz",
  grinz: "Grinz",
  effetti: "Effetti (Ferro / Ruggine / Quartz)",
  michelangelo: "Michelangelo",
  effecta: "Effecta DFV",
  sublimato_viv: "Sublimato VIV Decoral",
  sublimato_geal: "Sublimato GEAL",
  a_preventivo: "Altri (a preventivo)",
};

export function getColore(key: string): Colore | undefined {
  return COLORI.find((c) => c.key === key);
}

/**
 * Prezzo finale di una persiana tenuto conto del colore.
 *   • diSerie   → prezzoBase
 *   • percento  → prezzoBase × (1 + p/100)
 *   • aPreventivo → prezzoBase (ma flag `aPreventivo` a true, l'UI deve
 *                                mostrare l'avviso "da confermare")
 */
export function applyColore(
  prezzoBase: number,
  colore: Colore
): { prezzo: number; maggiorazione: number; aPreventivo: boolean } {
  if (colore.tipo === "diSerie") {
    return { prezzo: prezzoBase, maggiorazione: 0, aPreventivo: false };
  }
  if (colore.tipo === "aPreventivo") {
    return { prezzo: prezzoBase, maggiorazione: 0, aPreventivo: true };
  }
  const p = (colore.percentuale ?? 0) / 100;
  const maggiorazione = prezzoBase * p;
  return { prezzo: prezzoBase + maggiorazione, maggiorazione, aPreventivo: false };
}
