// Tars — store persistiti dell'agente operativo.
//
// Quattro raccolte, stesse regole del resto dell'app (persistedStore →
// una riga JSONB in kv_store, save debounciato, backfill in onLoad):
//
//   azioni_suggerite     la coda proposte. OGNI scrittura dell'agente passa
//                        da qui: Tars non ha altri modi di toccare i dati.
//   conoscenza_aziendale regole e convenzioni scritte dalla direzione,
//                        iniettate nel system prompt. Mai dedotte dal modello.
//   agente_esecuzioni    registro completo di ogni run: strumenti chiamati,
//                        proposte, token, esito. Per debug e rendicontabilità.
//   agente_config        interruttore e modello. Un solo record.

import { persistedStore } from "../_core/persistence";

// ── Proposte ────────────────────────────────────────────────────────────────

export const TIPI_PROPOSTA = [
  "rinomina_documento",
  "nota_timeline",
  "aggiornamento_magazzino",
  "modifica_cliente",
  "modifica_commessa",
  "ticket",
  "pagamento",
  "avanzamento_stato",
  "bozza_risposta",
  "segnalazione",
  "domanda", // chiedi_chiarimento
] as const;
export type TipoProposta = (typeof TIPI_PROPOSTA)[number];

// Tipi ad alto rischio: l'approvazione richiede direzione o amministrazione.
export const TIPI_ALTO_RISCHIO: TipoProposta[] = [
  "pagamento",
  "avanzamento_stato",
  "bozza_risposta",
];

export type StatoProposta =
  | "pendente"
  | "approvata"
  | "rifiutata"
  | "errore" // approvata ma la mutation è fallita (es. doc gate)
  | "risposta"; // solo tipo "domanda": l'operatore ha risposto

export type Proposta = {
  id: number;
  sedeId: number;
  tipo: TipoProposta;
  titolo: string;
  motivazione: string;
  confidenza: "alta" | "media" | "bassa";
  // Payload tipizzato per tipo — è ciò che l'esecutore passa alla mutation.
  payload: any;
  commessaId: number | null;
  clienteId: number | null;
  // Solo per tipo "domanda": opzioni cliccabili e risposta dell'operatore.
  opzioni: string[] | null;
  risposta: string | null;
  stato: StatoProposta;
  // Esito dell'esecuzione (o messaggio d'errore della mutation).
  esito: string | null;
  motivoRifiuto: string | null;
  esecuzioneId: number | null;
  trigger: string; // "on_demand" | (futuri: "evento", "notturno")
  createdAt: Date;
  decisaAt: Date | null;
  decisaDa: number | null;
  decisaDaNome: string | null;
};

let nextPropostaId = 1;
const _proposteStore = persistedStore<Proposta>("azioni_suggerite", (items) => {
  nextPropostaId = items.length
    ? Math.max(...items.map((p) => p.id)) + 1
    : 1;
});
export const proposte = _proposteStore.items;
export const saveProposte = () => _proposteStore.save();
export const newPropostaId = () => nextPropostaId++;

// ── Conoscenza aziendale ────────────────────────────────────────────────────

export const CATEGORIE_CONOSCENZA = [
  "fornitori",
  "processo",
  "clienti",
  "terminologia",
  "convenzioni",
  "preferenze_comunicazione",
] as const;
export type CategoriaConoscenza = (typeof CATEGORIE_CONOSCENZA)[number];

export type VoceConoscenza = {
  id: number;
  sedeId: number;
  categoria: CategoriaConoscenza;
  titolo: string;
  contenuto: string;
  attiva: boolean;
  aggiornatoDa: string | null;
  aggiornatoAt: Date;
  createdAt: Date;
};

let nextVoceId = 1;
const _conoscenzaStore = persistedStore<VoceConoscenza>(
  "conoscenza_aziendale",
  (items) => {
    nextVoceId = items.length ? Math.max(...items.map((v) => v.id)) + 1 : 1;
  }
);
export const conoscenza = _conoscenzaStore.items;
export const saveConoscenza = () => _conoscenzaStore.save();
export const newVoceId = () => nextVoceId++;

// ── Registro esecuzioni ─────────────────────────────────────────────────────

export type StrumentoChiamato = {
  nome: string;
  input: any;
  // Sintesi del risultato (mai il payload intero: il registro deve restare
  // leggibile e leggero — ogni save riscrive l'intera raccolta).
  esito: string;
};

export type Esecuzione = {
  id: number;
  sedeId: number;
  trigger: string;
  commessaId: number | null;
  richiesta: string; // il messaggio utente passato al modello
  strumenti: StrumentoChiamato[];
  proposteIds: number[];
  riepilogo: string | null; // il testo finale del modello
  tokensIn: number;
  tokensOut: number;
  durataMs: number;
  esito: "ok" | "errore" | "budget_esaurito";
  errore: string | null;
  utenteId: number | null;
  utenteNome: string | null;
  createdAt: Date;
};

let nextEsecuzioneId = 1;
const _esecuzioniStore = persistedStore<Esecuzione>(
  "agente_esecuzioni",
  (items) => {
    nextEsecuzioneId = items.length
      ? Math.max(...items.map((e) => e.id)) + 1
      : 1;
  }
);
export const esecuzioni = _esecuzioniStore.items;
export const saveEsecuzioni = () => _esecuzioniStore.save();
export const newEsecuzioneId = () => nextEsecuzioneId++;

// ── Config ──────────────────────────────────────────────────────────────────

export type TarsConfig = {
  id: 1;
  attivo: boolean;
  modello: string;
  // Budget per esecuzione (il piano prevede anche un budget mensile in €;
  // arriverà con i trigger schedulati, quando i volumi lo giustificano).
  maxToolCalls: number;
  maxProposte: number;
  timeoutMs: number;
  updatedAt: Date;
};

const DEFAULT_CONFIG: TarsConfig = {
  id: 1,
  attivo: false, // spento finché la direzione non lo accende
  modello: "claude-sonnet-5",
  maxToolCalls: 15,
  maxProposte: 5,
  timeoutMs: 60_000,
  updatedAt: new Date(),
};

const _configStore = persistedStore<TarsConfig>("agente_config", (items, meta) => {
  if (items.length === 0 && meta.firstBoot) {
    items.push({ ...DEFAULT_CONFIG });
  }
  // Backfill di campi nuovi su record esistenti.
  for (const c of items) {
    if (c.maxToolCalls === undefined) c.maxToolCalls = 15;
    if (c.maxProposte === undefined) c.maxProposte = 5;
    if (c.timeoutMs === undefined) c.timeoutMs = 60_000;
    if (c.modello === undefined) c.modello = DEFAULT_CONFIG.modello;
  }
});

export function getTarsConfig(): TarsConfig {
  if (_configStore.items.length === 0) {
    _configStore.items.push({ ...DEFAULT_CONFIG });
  }
  return _configStore.items[0];
}
export const saveConfig = () => _configStore.save();
