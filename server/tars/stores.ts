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
import { DEFAULT_SEDE_ID } from "../routers/sedi";

// ── Proposte ────────────────────────────────────────────────────────────────

export const TIPI_PROPOSTA = [
  "collega_comunicazione",
  "collega_fattura",
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
// collega_fattura è qui perché la mutation sottostante è comunque riservata
// a quei ruoli: meglio bloccare all'approvazione che far fallire dopo.
export const TIPI_ALTO_RISCHIO: TipoProposta[] = [
  "pagamento",
  "avanzamento_stato",
  "bozza_risposta",
  "collega_fattura",
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
  trigger: string; // "on_demand" | "chat" | "seguito" | (futuri: "notturno")
  createdAt: Date;
  decisaAt: Date | null;
  decisaDa: number | null;
  decisaDaNome: string | null;
  // Seguito: una segnalazione approvata (o una domanda a cui è stata data
  // risposta) descrive una situazione, non la risolve. Alla decisione Tars
  // riparte una volta sola per proporre l'azione che la chiude. Questi
  // campi sono il segno che è già partito: senza, l'approvazione della
  // proposta di seguito ne genererebbe un'altra, all'infinito.
  seguitoAt: Date | null;
  seguitoEsecuzioneId: number | null;
  // La proposta da cui nasce, se nasce da un seguito.
  origineId: number | null;
};

let nextPropostaId = 1;
const _proposteStore = persistedStore<Proposta>("azioni_suggerite", (items) => {
  nextPropostaId = items.length
    ? Math.max(...items.map((p) => p.id)) + 1
    : 1;
  for (const p of items) {
    if (p.seguitoAt === undefined) p.seguitoAt = null;
    if (p.seguitoEsecuzioneId === undefined) p.seguitoEsecuzioneId = null;
    if (p.origineId === undefined) p.origineId = null;
  }
});
export const proposte = _proposteStore.items;
export const saveProposte = () => _proposteStore.save();
export const newPropostaId = () => nextPropostaId++;

// ── Impronta di una proposta ────────────────────────────────────────────────
// Due proposte sono "la stessa cosa" se hanno lo stesso tipo sulla stessa
// commessa e chiedono la stessa cosa. Serve a una regola sola: ciò che un
// operatore ha rifiutato non torna in coda. Il blocco di decisioni nel
// system prompt è un suggerimento al modello — questo è un muro.
//
// Due chiavi perché due modi di ripetersi: payload identico (la ripetizione
// letterale) e titolo identico (lo stesso intento riscritto con un payload
// leggermente diverso).

function jsonStabile(v: any): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(jsonStabile).join(",")}]`;
  const chiavi = Object.keys(v).sort();
  return `{${chiavi.map((k) => `${JSON.stringify(k)}:${jsonStabile(v[k])}`).join(",")}}`;
}

function normalizzaTitolo(t: string): string {
  return t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type ImprontaProposta = { payload: string; titolo: string };

export function improntaProposta(p: {
  tipo: string;
  commessaId: number | null;
  payload: any;
  titolo: string;
}): ImprontaProposta {
  const base = `${p.tipo}|${p.commessaId ?? "-"}`;
  return {
    payload: `${base}|${jsonStabile(p.payload ?? null)}`,
    titolo: `${base}|${normalizzaTitolo(p.titolo ?? "")}`,
  };
}

/**
 * La proposta già rifiutata che coincide con questa, se esiste. Il motivo
 * del rifiuto torna al modello: sapere PERCHÉ è stata bocciata gli evita di
 * girarci intorno riscrivendola.
 */
export function propostaGiaRifiutata(
  candidata: { tipo: string; commessaId: number | null; payload: any; titolo: string },
  sedeId: number
): Proposta | undefined {
  const imp = improntaProposta(candidata);
  return proposte.find((p) => {
    if (p.sedeId !== sedeId || p.stato !== "rifiutata") return false;
    const altra = improntaProposta(p);
    return altra.payload === imp.payload || altra.titolo === imp.titolo;
  });
}

/** Idem per una proposta ancora in attesa: non si mette in coda due volte. */
export function propostaGiaInCoda(
  candidata: { tipo: string; commessaId: number | null; payload: any; titolo: string },
  sedeId: number
): Proposta | undefined {
  const imp = improntaProposta(candidata);
  return proposte.find((p) => {
    if (p.sedeId !== sedeId || p.stato !== "pendente") return false;
    const altra = improntaProposta(p);
    return altra.payload === imp.payload || altra.titolo === imp.titolo;
  });
}

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

// ── Chat ────────────────────────────────────────────────────────────────────
// Una conversazione per utente per sede. La chat è un altro modo di
// azionare lo stesso agente: stessi strumenti, stessi budget, stesse
// proposte. Si salva il filo del discorso, non un log infinito.

export type MessaggioChat = {
  ruolo: "utente" | "tars";
  testo: string;
  proposteIds: number[];
  createdAt: Date;
};

export type ChatRecord = {
  id: number;
  sedeId: number;
  utenteId: number;
  messaggi: MessaggioChat[];
  updatedAt: Date;
};

// Oltre questo, i messaggi più vecchi scivolano fuori (restano le proposte
// nella coda, che ha vita propria).
export const MAX_MESSAGGI_CHAT = 60;

let nextChatId = 1;
const _chatStore = persistedStore<ChatRecord>("tars_chat", (items) => {
  nextChatId = items.length ? Math.max(...items.map((c) => c.id)) + 1 : 1;
});

export function getChat(sedeId: number, utenteId: number): ChatRecord {
  let rec = _chatStore.items.find(
    (c) => c.sedeId === sedeId && c.utenteId === utenteId
  );
  if (!rec) {
    rec = {
      id: nextChatId++,
      sedeId,
      utenteId,
      messaggi: [],
      updatedAt: new Date(),
    };
    _chatStore.items.push(rec);
  }
  return rec;
}
export const saveChat = () => _chatStore.save();

// ── Config ──────────────────────────────────────────────────────────────────

// I modelli fra cui la direzione può scegliere. Opus ragiona meglio sulle
// contraddizioni — che è tutto il lavoro di Tars; Sonnet costa meno per le
// analisi di massa; Haiku serve solo se i volumi esplodono.
export const MODELLI_TARS = [
  "claude-opus-5",
  "claude-sonnet-5",
  "claude-haiku-4-5-20251001",
] as const;
export type ModelloTars = (typeof MODELLI_TARS)[number];

export type TarsConfig = {
  id: number;
  // Una configurazione per sede: una sede può tenere Tars spento mentre
  // un'altra lo usa, e i modelli possono essere diversi (chi analizza poche
  // commesse difficili vuole Opus, chi ne smista molte può stare su Sonnet).
  sedeId: number;
  attivo: boolean;
  modello: string;
  // Budget per esecuzione (il piano prevede anche un budget mensile in €;
  // arriverà con i trigger schedulati, quando i volumi lo giustificano).
  maxToolCalls: number;
  maxProposte: number;
  timeoutMs: number;
  // Versione dei default applicata a questo record. Serve a far arrivare un
  // cambio di modello o di budget anche alle installazioni già avviate:
  // senza, il record salvato resterebbe su Sonnet per sempre.
  versioneDefault?: number;
  updatedAt: Date;
};

const VERSIONE_DEFAULT = 2;

const DEFAULT_CONFIG: Omit<TarsConfig, "id" | "sedeId"> = {
  attivo: false, // spento finché la direzione non lo accende
  modello: "claude-opus-5",
  // Con la lettura degli strumenti in parallelo un giro costa meno tempo:
  // il budget più alto serve a farlo arrivare in fondo all'indagine, non a
  // fargli fare più giri a vuoto.
  maxToolCalls: 25,
  maxProposte: 5,
  timeoutMs: 120_000,
  versioneDefault: VERSIONE_DEFAULT,
  updatedAt: new Date(),
};

let nextConfigId = 2;

const _configStore = persistedStore<TarsConfig>("agente_config", (items, meta) => {
  if (items.length === 0 && meta.firstBoot) {
    items.push({ ...DEFAULT_CONFIG, id: 1, sedeId: DEFAULT_SEDE_ID });
  }
  for (const c of items) {
    // Il record globale di prima diventa quello della sede principale.
    if (c.sedeId === undefined) c.sedeId = DEFAULT_SEDE_ID;
    if (c.maxToolCalls === undefined) c.maxToolCalls = DEFAULT_CONFIG.maxToolCalls;
    if (c.maxProposte === undefined) c.maxProposte = DEFAULT_CONFIG.maxProposte;
    if (c.timeoutMs === undefined) c.timeoutMs = DEFAULT_CONFIG.timeoutMs;
    if (c.modello === undefined) c.modello = DEFAULT_CONFIG.modello;
    // Aggiornamento dei default. Non tocca `attivo`: accendere Tars resta
    // una decisione umana, e una migrazione non la prende per nessuno.
    if ((c.versioneDefault ?? 1) < VERSIONE_DEFAULT) {
      c.modello = DEFAULT_CONFIG.modello;
      c.maxToolCalls = DEFAULT_CONFIG.maxToolCalls;
      c.timeoutMs = DEFAULT_CONFIG.timeoutMs;
      c.versioneDefault = VERSIONE_DEFAULT;
    }
  }
  nextConfigId = items.length ? Math.max(...items.map((c) => c.id)) + 1 : 1;
});

/**
 * La configurazione di Tars per una sede. Se la sede non ne ha ancora una,
 * nasce spenta: attivare un agente che legge i dati di una sede nuova deve
 * restare una decisione presa da qualcuno, non un effetto collaterale.
 */
export function getTarsConfig(sedeId: number | null): TarsConfig {
  const sede = sedeId ?? DEFAULT_SEDE_ID;
  let c = _configStore.items.find((x) => x.sedeId === sede);
  if (!c) {
    c = { ...DEFAULT_CONFIG, id: nextConfigId++, sedeId: sede, updatedAt: new Date() };
    _configStore.items.push(c);
    _configStore.save();
  }
  return c;
}
export const saveConfig = () => _configStore.save();
