// Listino Fivizzanese — persiane.
//
// Fonte: tabella prezzi fornita dalla direzione (aprile 2026). Ogni voce è
// divisa per colorazione (standard/speciali/legno) e `null` significa che la
// combinazione non è a listino (es. la maggior parte dei supplementi €/Cad
// sono venduti solo in colorazione Standard).
//
// Tenuto in TS (non JSON) per ottenere types + autocompletion al call site.
// Quando ci saranno più listini passeremo a uno schema condiviso.

export type Colorazione = "standard" | "speciali" | "legno";

export type PrezziColorazione = {
  standard: number | null;
  speciali: number | null;
  legno: number | null;
};

export type Modello = {
  key: string;
  nome: string;
  /** €/m² per colorazione */
  prezziMq: PrezziColorazione;
};

export type Supplemento = {
  key: string;
  nome: string;
  /** Unità di misura del prezzo: m² (moltiplicato per area) o cad (fisso per persiana) */
  unita: "mq" | "cad";
  prezzi: PrezziColorazione;
  /**
   * Colorazioni per cui il supplemento è effettivamente a listino. Derivato
   * da `prezzi` (chiavi con valore non-null) per comodità del renderer.
   */
  disponibileIn: Colorazione[];
};

export type Centinatura = {
  ante: 1 | 2 | 3 | 4;
  /** Prezzo per singola persiana (moltiplicato per numero persiane) */
  prezzo: number;
};

// ── Modelli ─────────────────────────────────────────────────────────────────
export const MODELLI: Modello[] = [
  {
    key: "classica_ovalina_50_plastica",
    nome: "CLASSICA OVALINA 50mm DIST IN PLASTICA",
    prezziMq: { standard: 294, speciali: 305, legno: 410 },
  },
  {
    key: "classica_lamelle_orientabili",
    nome: "CLASSICA A LAMELLE ORIENTABILI",
    prezziMq: { standard: 368, speciali: 378, legno: 515 },
  },
  {
    key: "classica_ovalina_90_storico_cornice",
    nome: "CLASSICA OVALINA 90mm CENTRO STORICO E CORNICE",
    prezziMq: { standard: 368, speciali: 378, legno: 515 },
  },
  {
    key: "genova_sportello_oval_65_storico",
    nome: "TIPO GENOVA CON SPORTELLO OVAL 65mm CENTRO STORICO",
    prezziMq: { standard: 397, speciali: 410, legno: 546 },
  },
  {
    key: "genova_sportello_oval_50_plastica",
    nome: "TIPO GENOVA CON SPORTELLO OVAL 50mm DIST IN PLASTICA",
    prezziMq: { standard: 324, speciali: 331, legno: 452 },
  },
  {
    key: "genova_sportello_oval_90_storico_cornice",
    nome: "TIPO GENOVA CON SPORTELLO OVAL 90mm CENTRO STORICO E CORNICE",
    prezziMq: { standard: 410, speciali: 420, legno: 578 },
  },
];

// ── Supplementi ─────────────────────────────────────────────────────────────
function sup(
  key: string,
  nome: string,
  unita: "mq" | "cad",
  prezzi: PrezziColorazione
): Supplemento {
  const disponibileIn = (["standard", "speciali", "legno"] as Colorazione[]).filter(
    (c) => prezzi[c] !== null
  );
  return { key, nome, unita, prezzi, disponibileIn };
}

export const SUPPLEMENTI: Supplemento[] = [
  sup("telaio", "SUPPLEMENTO TELAIO PER PERSIANA", "mq", {
    standard: 69, speciali: 74, legno: 95,
  }),
  sup(
    "francesina_ovalina_50",
    "FRANCESINA SU OVALINA 50mm CON DISTANZIALE IN PLASTICA",
    "mq",
    { standard: 37, speciali: 40, legno: 51 }
  ),
  sup(
    "traverso_intermedio_orientabile",
    "SUPPLEMENTO TRAVERSO INTERMEDIO SU ORIENTABILE",
    "cad",
    { standard: 19, speciali: 24, legno: 26 }
  ),
  sup(
    "traverso_centro_storico",
    "SUPPLEMENTO TRAVERSO CENTRO STORICO",
    "cad",
    { standard: 32, speciali: null, legno: null }
  ),
  sup(
    "kit_guida_veletta_carrelli",
    "KIT GUIDA SUPERIORE VELETTA CARRELLI PER ANTA",
    "cad",
    { standard: 170, speciali: 174, legno: 237 }
  ),
  sup("persiana_libro", "SUPPLEMENTO PERSIANA A LIBRO", "cad", {
    standard: 84, speciali: null, legno: null,
  }),
  sup(
    "serratura_doppia_maniglia_fascia",
    "SERRATURA CON DOPPIA MANIGLIA DA FASCIA",
    "cad",
    { standard: 137, speciali: null, legno: null }
  ),
  sup(
    "serratura_doppia_maniglia_montante",
    "SERRATURA CON DOPPIA MANIGLIA DA MONTANTE",
    "cad",
    { standard: 168, speciali: null, legno: null }
  ),
  sup(
    "paletto_semi_fissa_incasso",
    "PALETTO SU ANTA SEMI FISSA AD INCASSO",
    "cad",
    { standard: 26, speciali: null, legno: null }
  ),
  sup(
    "paletto_semi_fissa_appoggio",
    "PALETTO SU ANTA SEMI FISSA IN APPOGGIO",
    "cad",
    { standard: 15, speciali: null, legno: null }
  ),
  sup(
    "chiusure_tavellini_alluminio",
    "CHIUSURE SPORTELLI CON TAVELLINI IN ALLUMINIO IN TINTA",
    "cad",
    { standard: 21, speciali: null, legno: null }
  ),
  sup(
    "persiana_libro_3_ante",
    "SUPPLEMENTO PERSIANA A LIBRO 3 ANTE",
    "cad",
    { standard: 126, speciali: null, legno: null }
  ),
  sup(
    "persiana_libro_3_ante_orientabili",
    "SUPPLEMENTO PERSIANA A LIBRO A 3 ANTE CON LAMELLE ORIENTABILI",
    "cad",
    { standard: 189, speciali: null, legno: null }
  ),
  sup(
    "persiana_libro_4_ante",
    "SUPPLEMENTO PERSIANA A LIBRO A 4 ANTE",
    "cad",
    { standard: 252, speciali: null, legno: null }
  ),
  sup(
    "persiana_libro_4_ante_orientabili",
    "SUPPLEMENTO PERSIANA A LIBRO A 4 ANTE CON LAMELLE ORIENTABILI",
    "cad",
    { standard: 378, speciali: null, legno: null }
  ),
];

// ── Centinature ─────────────────────────────────────────────────────────────
export const CENTINATURE: Centinatura[] = [
  { ante: 1, prezzo: 788 },
  { ante: 2, prezzo: 966 },
  { ante: 3, prezzo: 1192 },
  { ante: 4, prezzo: 1419 },
];

// ── Helpers ─────────────────────────────────────────────────────────────────
export const COLORAZIONE_LABEL: Record<Colorazione, string> = {
  standard: "Standard",
  speciali: "Speciali",
  legno: "Legno",
};

export function getModello(key: string): Modello | undefined {
  return MODELLI.find((m) => m.key === key);
}

export function getSupplemento(key: string): Supplemento | undefined {
  return SUPPLEMENTI.find((s) => s.key === key);
}

export function getCentinatura(ante: number): Centinatura | undefined {
  return CENTINATURE.find((c) => c.ante === ante);
}
