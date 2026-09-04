// Tipi condivisi del ciclo fatturazione (server e client): righe, scadenze,
// eventi, cliente-snapshot, fattura e configurazione di sede. Nessuna
// logica: solo forme. Le regole (stati ammessi, ricalcolo, limiti,
// scavalco) vivono nei servizi di server/fatture/.

export const STATI_FATTURA = [
  "bozza",
  "in_emissione",
  "emessa",
  "inviata",
  "consegnata",
  "scartata",
  "rifiutata",
  "mancata_consegna",
  "annullata",
] as const;
export type StatoFattura = (typeof STATI_FATTURA)[number];

export const TIPI_FATTURA = ["fattura", "nota_credito"] as const;
export type TipoFattura = (typeof TIPI_FATTURA)[number];

export const TIPI_RIGA = [
  "intestazione",
  "bene",
  "servizio",
  "markup",
  "storno_bs",
  "riaddebito_bs",
  "nota",
] as const;
export type TipoRiga = (typeof TIPI_RIGA)[number];

export const ALIQUOTE = [22, 10] as const;
export type Aliquota = (typeof ALIQUOTE)[number];

export const TIPI_EVENTO = [
  "creata",
  "modificata",
  "emissione_avviata",
  "cliente_fic",
  "creata_fic",
  "errore_totali",
  "xml_ok",
  "xml_errore",
  "inviata",
  "stato_sdi",
  "scarto",
  "annullata",
  "nota_credito",
  "pdf_archiviato",
  "xml_archiviato",
  "scavalco_limiti",
] as const;
export type TipoEvento = (typeof TIPI_EVENTO)[number];

export type RigaFattura = {
  id: number;
  fatturaId: number;
  ordine: number;
  tipo: TipoRiga;
  descrizione: string;
  quantita: number;
  prezzoUnitCent: number;
  importoCent: number;
  /** Null per intestazione e nota. */
  aliquota: Aliquota | null;
  /** Servizi: codice della voce del computo. */
  voceComputoCodice: string | null;
  /** Beni: riga del contratto. */
  rigaCommessaId: number | null;
  /** Servizi: limite del computo. */
  limiteCent: number | null;
  /** Beni: entra in B (true) o in N (false). */
  beneSignificativo: boolean;
  /** Markup/storno/riaddebito/riepilogo: rigenerata dal ricalcolo. */
  derivata: boolean;
};
export type RigaFatturaInput = Omit<RigaFattura, "id" | "fatturaId">;

export type RiepilogoIva = {
  aliquota: Aliquota;
  imponibileCent: number;
  impostaCent: number;
};

export type ScadenzaFattura = {
  id: number;
  fatturaId: number;
  numero: number;
  quotaPct: number;
  /** YYYY-MM-DD. */
  data: string;
  importoCent: number;
  descrizione: string | null;
  ficPaymentId: number | null;
  stato: "attesa" | "pagata" | "stornata";
};
export type ScadenzaFatturaInput = Omit<
  ScadenzaFattura,
  "id" | "fatturaId" | "ficPaymentId" | "stato"
>;

export type EventoFattura = {
  id: number;
  fatturaId: number;
  sedeId: number;
  tipo: TipoEvento;
  payload: Record<string, unknown>;
  actorUserId: number | null;
  createdAt: Date;
};

export type ClienteSnapshot = {
  clienteId: number | null;
  nome: string;
  tipo: "privato" | "azienda" | "condominio" | "ente_pubblico";
  codiceFiscale: string | null;
  partitaIva: string | null;
  indirizzo: string;
  cap: string;
  citta: string;
  provincia: string;
  email: string | null;
  pec: string | null;
  /** "0000000" per privati senza PEC. */
  codiceDestinatario: string;
  ficEntityId: number | null;
};

export type Fattura = {
  id: number;
  sedeId: number;
  commessaId: number;
  computoId: number | null;
  hashRighe: string | null;
  tipo: TipoFattura;
  notaCreditoDi: number | null;
  stato: StatoFattura;
  ficDocumentId: number | null;
  numero: string | null;
  /** YYYY-MM-DD. */
  data: string | null;
  clienteSnapshot: ClienteSnapshot | null;
  pattuitoTipo: "lordo" | "imponibile";
  pattuitoCent: number;
  imponibileCent: number;
  ivaCent: number;
  totaleCent: number;
  deltaPattuitoCent: number;
  markupCent: number;
  stornoCent: number;
  diciture: string[];
  note: string | null;
  intestazioneCantiere: string | null;
  detrazioneTipo: "nessuna" | "ecobonus" | "ristrutturazione";
  pdfStorageKey: string | null;
  xmlStorageKey: string | null;
  xmlSha256: string | null;
  documentoId: number | null;
  eiStatusFic: string | null;
  eiErrore: string | null;
  inviataDryRun: boolean;
  scavalcoLimiti: boolean;
  scavalcoMotivo: string | null;
  createdBy: number | null;
  emessaDa: number | null;
  emessaAt: Date | null;
  revisione: number;
  createdAt: Date;
  updatedAt: Date;
  righe: RigaFattura[];
  riepilogo: RiepilogoIva[];
  scadenze: ScadenzaFattura[];
};

export type FatturazioneConfig = {
  sedeId: number;
  iban: string | null;
  banca: string | null;
  intestatario: string | null;
  /** "MP05". */
  metodoPagamento: string;
  numerazioneFic: string | null;
  paymentAccountIdFic: number | null;
  vatIdsFic: { 22: number | null; 10: number | null };
  dicituraFooter: string | null;
  scopeScritturaOk: boolean;
  scopeVerificatoAt: Date | null;
  updatedAt: Date;
};

export const FATTURAZIONE_CONFIG_DEFAULT = {
  iban: null,
  banca: null,
  intestatario: null,
  metodoPagamento: "MP05",
  numerazioneFic: null,
  paymentAccountIdFic: null,
  vatIdsFic: { 22: null, 10: null },
  dicituraFooter: null,
  scopeScritturaOk: false,
  scopeVerificatoAt: null,
} satisfies Omit<FatturazioneConfig, "sedeId" | "updatedAt">;

/** Solo la bozza si modifica liberamente: dall'emissione in poi la fattura è tracciata verso SdI. */
export const STATI_MODIFICABILI: ReadonlySet<StatoFattura> = new Set(["bozza"]);

export function fatturaModificabile(stato: StatoFattura): boolean {
  return stato === "bozza";
}
