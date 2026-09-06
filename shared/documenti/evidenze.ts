// Forme condivise delle evidenze localizzate (06/09/2026): dove, nella
// pagina, sta il frammento da cui un valore è stato letto. Solo tipi, come
// shared/contratti/estrazione.ts: la logica vive nel server
// (documenti/localizzatore.ts) e il ritaglio nel client (lib/anteprime.ts).
//
// Le coordinate sono FRAZIONI (0..1) della pagina resa, con y verso il
// basso e la rotazione già applicata: indipendenti dai dpi con cui la
// pagina viene disegnata. Spec:
// docs/superpowers/specs/2026-09-06-anteprime-evidenze-design.md §3.

/** Rettangolo in frazioni (0..1) della pagina resa; y cresce verso il basso. */
export type Area = { x: number; y: number; w: number; h: number };

/**
 * Quanto è precisa la posizione: `riquadro` = il frammento letto, `zona` =
 * una fascia della pagina, `pagina` = non trovata, si mostra la pagina
 * intera e lo si dice. Mai un ritaglio indovinato spacciato per prova.
 */
export type GradoPosizione = "riquadro" | "zona" | "pagina";

export type PosizioneEvidenza = {
  grado: GradoPosizione;
  /** Il frammento letto (riquadro o zona). */
  frammento?: Area;
  /** La riga intera che lo contiene. */
  riga?: Area;
  /** Due righe sopra e due sotto: il contesto della vignetta. */
  contesto?: Area;
};

/** Un'evidenza pronta per il client: pagina, frammento, area (null = pagina intera). */
export type EvidenzaLetta = {
  pagina: number;
  frammento: string;
  area: PosizioneEvidenza | null;
};

export type TrattoGeometria = {
  testo: string;
  /** Scarti di carattere DENTRO la riga di testo. */
  inizio: number;
  fine: number;
  x0: number;
  x1: number;
};

export type RigaGeometria = {
  /** Scarto del primo carattere della riga nel testo della pagina (geometria allineata). */
  inizio: number;
  y0: number;
  y1: number;
  tratti: TrattoGeometria[];
};

/** Geometria di una pagina, nelle unità della fonte (punti PDF o pixel dell'immagine). */
export type GeometriaPagina = {
  larghezza: number;
  altezza: number;
  /** true quando la riga i del testo della pagina è `righe[i]` (nativo, OCR). */
  allineata: boolean;
  righe: RigaGeometria[];
};

export type FonteTesto = "testo_pdf" | "ocr" | "visione";

/** Le evidenze salvate accanto alla lettura del costo (Documento.letturaCosto.evidenze). */
export type EvidenzeLetturaCosto = {
  imponibile?: EvidenzaLetta | null;
  totale?: EvidenzaLetta | null;
  fornitore?: EvidenzaLetta | null;
  numeroConferma?: EvidenzaLetta | null;
  dataDocumento?: EvidenzaLetta | null;
  riferimentoOrdine?: EvidenzaLetta | null;
  riferimentoCliente?: EvidenzaLetta | null;
  consegna?: EvidenzaLetta | null;
  approntamento?: EvidenzaLetta | null;
  riscontro?: EvidenzaLetta[];
};

/** I campi di `EvidenzeLetturaCosto` che il client può chiedere per nome. */
export type CampoEvidenzaCosto = keyof EvidenzeLetturaCosto;
