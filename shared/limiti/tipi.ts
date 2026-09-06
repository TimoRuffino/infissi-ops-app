// Tipi del contratto strutturato e del computo limiti, condivisi tra
// server e client. Nessuna logica: solo forme. Le regole vivono nei servizi.

import type { PosizioneEvidenza } from "../documenti/evidenze";

export const CATEGORIE_RIGA = [
  "serramento_pvc",
  "serramento_alluminio",
  "serramento_legno",
  "serramento_legno_alluminio",
  "cassonetto",
  "tapparella",
  "persiana",
  "scuro",
  "schermatura",
  "zanzariera",
  "tenda",
  "pergola",
  "porta_blindata",
  "portoncino",
  "porta_interna",
  "controtelaio",
  "accessorio",
  "altro",
] as const;
export type CategoriaRiga = (typeof CATEGORIE_RIGA)[number];

/** Oscurante venduto insieme al serramento (foglio: SerrTapp/SerrPers/SerrScuri). */
export const OSCURANTI_INTEGRATI = ["tapparella", "persiana", "scuro"] as const;
export type OscuranteIntegrato = (typeof OSCURANTI_INTEGRATI)[number];

export type AccessorioRiga = { codice: string; quantita: number };

export type RigaContratto = {
  id: number;
  sedeId: number;
  commessaId: number;
  ordine: number;
  categoria: CategoriaRiga;
  /** Codice del prodotto DEI del seed (es. "C25077-c"); per i controtelai il codice variante DEI (es. "C15145-a"). */
  tipologia: string | null;
  oscuranteIntegrato: OscuranteIntegrato | null;
  /** Codice DEI dell'oscurante abbinato (es. "C15078-a"). */
  oscuranteTipologia: string | null;
  descrizione: string;
  quantita: number;
  larghezzaMm: number | null;
  altezzaMm: number | null;
  /** mq totali della riga: L×H×quantità/10⁶, esatto (6 decimali, nessun arrotondamento a 3). */
  mq: number;
  /** Solo controtelai: misura DEI dichiarata (mq, m o pezzi secondo la variante). */
  misuraDei: number | null;
  prezzoUnitCent: number | null;
  prezzoTotCent: number | null;
  beneSignificativo: boolean;
  accessori: AccessorioRiga[];
  note: string | null;
  origine: "estrazione" | "manuale" | "prodotto_legacy";
  /**
   * Da dove la riga è stata letta: pagina e frammento del PDF, e dal
   * 06/09/2026 (anteprime delle evidenze) anche la posizione nel testo e
   * l'area sulla pagina, quando la proposta le aveva.
   */
  evidenza: {
    pagina: number;
    frammento: string;
    posizione?: { inizio: number; fine: number } | null;
    area?: PosizioneEvidenza | null;
  } | null;
  createdAt: Date;
  updatedAt: Date;
};

export type RigaContrattoInput = Omit<
  RigaContratto,
  "id" | "sedeId" | "commessaId" | "mq" | "createdAt" | "updatedAt" | "ordine"
> & { id?: number | null };

export const PATTUITO_TIPI = ["lordo", "imponibile"] as const;
export type PattuitoTipo = (typeof PATTUITO_TIPI)[number];
export const DETRAZIONE_TIPI = ["nessuna", "ecobonus", "ristrutturazione"] as const;
export type DetrazioneTipo = (typeof DETRAZIONE_TIPI)[number];
export const DETRAZIONE_IMMOBILI = ["prima_casa", "altro"] as const;
export type DetrazioneImmobile = (typeof DETRAZIONE_IMMOBILI)[number];
export const ZONE_CLIMATICHE = ["A", "B", "C", "D", "E", "F"] as const;
export type ZonaClimatica = (typeof ZONE_CLIMATICHE)[number];

export type RataContratto = {
  numero: number;
  quotaPct: number;
  /** Giorni dalla data fattura oppure data assoluta ISO; uno dei due. */
  giorni: number | null;
  data: string | null;
  descrizione: string | null;
};

export const CODICI_OPERA = [
  "rilievo_pezzo", "rilievo_foro", "progettazione", "sviluppo_ordine", "protezione",
  "rimozione_serramenti", "rimozione_tapparelle", "smaltimento", "trasporto", "tiro_piano",
  "assistenza_muraria", "posa", "pulizia", "spese_professionali", "altri_servizi",
  "assistenze_murarie_eventuali", "dime", "piattaforma", "permessi_suolo",
] as const;
export type CodiceOpera = (typeof CODICI_OPERA)[number];

/** Scelte che cambiano quali opere entrano nei totali del computo (analisi §3.2). */
export type OpzioniComputo = { rilievo: "foro" | "pezzo"; speseProfessionali: boolean; eventuali: CodiceOpera[] };
export const OPZIONI_COMPUTO_DEFAULT: OpzioniComputo = { rilievo: "foro", speseProfessionali: false, eventuali: [] };

export type Contratto = {
  commessaId: number;
  sedeId: number;
  pattuitoCent: number;
  pattuitoTipo: PattuitoTipo;
  posaInclusa: boolean;
  /** Prezzo della posa quando il contratto la dichiara separatamente (piano 3); non sempre presente. */
  posaCent: number | null;
  notePosa: string | null;
  comuneCantiere: string | null;
  codiceIstat: string | null;
  zonaClimatica: ZonaClimatica | null;
  zonaManuale: boolean;
  piano: number | null;
  distanzaKm: number | null;
  detrazioneTipo: DetrazioneTipo;
  detrazioneImmobile: DetrazioneImmobile | null;
  detrazionePct: number | null;
  dataFirma: string | null;
  rate: RataContratto[];
  opzioniComputo: OpzioniComputo;
  hashRighe: string;
  hashParametri: string;
  origine: "estrazione" | "manuale";
  documentoId: number | null;
  /** Estrazione IA (piano 3) che ha proposto questo contratto; null se scritto a mano. */
  estrazioneId: number | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ContrattoInput = Omit<
  Contratto,
  | "commessaId" | "sedeId" | "hashRighe" | "hashParametri" | "zonaClimatica"
  | "codiceIstat" | "createdBy" | "updatedBy" | "createdAt" | "updatedAt"
  | "posaCent" | "estrazioneId"
> & {
  zonaClimatica?: ZonaClimatica | null;
  // Opzionali con default lato servizio (null): un contratto scritto a mano
  // non dichiara quasi mai una posa a sé o un'estrazione di origine.
  posaCent?: number | null;
  estrazioneId?: number | null;
};

export type GruppoVoce = "prodotti" | "controtelai" | "opere" | "eventuali";

export type VoceComputo = {
  gruppo: GruppoVoce;
  codice: string;
  descrizione: string;
  codiceDei: string | null;
  unita: string;
  prezzoUnitCent: number;
  quantita: number;
  limiteCent: number;
  /** Input della formula, per spiegare il numero in UI. */
  dettaglio: Record<string, number | string | boolean>;
  ordine: number;
  /** Se la voce entra nei totali (massimali: 1 sì/2 no; dei_riga_n: 1 no/2 sì; controtelai/eventuali: entrambi; opere: 1 sì, 2 salvo esclusaDaCheck2). */
  inclusa: boolean;
  inCheck1: boolean;
  inCheck2: boolean;
};

export type EsitoComputo = "ok" | "incompleto";

export const GRUPPI_PRODOTTO = [
  "serramento", "cassonetto", "avvolgibile", "persiana", "scuro", "portoncino", "porta_blindata", "schermatura",
] as const;
export type GruppoProdotto = (typeof GRUPPI_PRODOTTO)[number];

/** Categoria della riga → gruppo (e famiglia, se univoca) del catalogo DEI. null = la riga non ha voce DEI. */
export function gruppoPerCategoria(
  categoria: CategoriaRiga
): { gruppo: GruppoProdotto | null; famiglia: string | null } {
  switch (categoria) {
    case "serramento_pvc": return { gruppo: "serramento", famiglia: "pvc" };
    case "serramento_alluminio": return { gruppo: "serramento", famiglia: "alluminio" };
    case "serramento_legno": return { gruppo: "serramento", famiglia: "legno" };
    case "serramento_legno_alluminio": return { gruppo: "serramento", famiglia: null };
    case "cassonetto": return { gruppo: "cassonetto", famiglia: null };
    case "tapparella": return { gruppo: "avvolgibile", famiglia: null };
    case "persiana": return { gruppo: "persiana", famiglia: null };
    case "scuro": return { gruppo: "scuro", famiglia: null };
    case "schermatura": return { gruppo: "schermatura", famiglia: null };
    case "zanzariera": return { gruppo: "schermatura", famiglia: "zanzariera" };
    case "tenda": return { gruppo: "schermatura", famiglia: "tenda" };
    case "pergola": return { gruppo: "schermatura", famiglia: "pergola" };
    case "porta_blindata": return { gruppo: "porta_blindata", famiglia: null };
    case "portoncino": return { gruppo: "portoncino", famiglia: null };
    default: return { gruppo: null, famiglia: null };
  }
}

export function gruppoPerOscurante(o: OscuranteIntegrato): GruppoProdotto {
  return o === "tapparella" ? "avvolgibile" : o === "persiana" ? "persiana" : "scuro";
}

export type Computo = {
  id: number;
  sedeId: number;
  commessaId: number;
  hashRighe: string;
  hashParametri: string;
  tariffeAl: string;
  zona: ZonaClimatica | null;
  esito: EsitoComputo;
  check1Cent: number;
  check2Cent: number | null;
  /** Totale prodotti DEI (T6 del foglio). */
  deiProdottiCent: number | null;
  limiteCent: number;
  detraibileCent: number | null;
  detrazioneStimataCent: number | null;
  avvertenze: string[];
  voci: VoceComputo[];
  createdBy: number | null;
  createdAt: Date;
};
