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
//   agente_config        interruttori, modelli e audit processi per sede.

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
  "miglioramento_processo",
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
  // Identita semantica dell'azione, indipendente da titolo e motivazione.
  // Serve a impedire che lo stesso effetto torni con parole diverse.
  chiaveAzione?: string;
};

let nextPropostaId = 1;
const _proposteStore = persistedStore<Proposta>("azioni_suggerite", items => {
  nextPropostaId = items.length ? Math.max(...items.map(p => p.id)) + 1 : 1;
  for (const p of items) {
    if (p.seguitoAt === undefined) p.seguitoAt = null;
    if (p.seguitoEsecuzioneId === undefined) p.seguitoEsecuzioneId = null;
    if (p.origineId === undefined) p.origineId = null;
    if (!p.chiaveAzione) p.chiaveAzione = chiaveAzioneProposta(p);
  }
});
export const proposte = _proposteStore.items;
export const saveProposte = () => _proposteStore.save();
export const newPropostaId = () => nextPropostaId++;

// ── Impronta di una proposta ────────────────────────────────────────────────
// Due proposte sono "la stessa cosa" se hanno lo stesso effetto sullo stesso
// target. Le decisioni sono definitive: un'azione pendente, approvata,
// rifiutata o già gestita non torna in coda con una formulazione diversa.
// Il prompt orienta il modello; questa identità canonica è il vincolo reale.

function jsonStabile(v: any): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(jsonStabile).join(",")}]`;
  const chiavi = Object.keys(v).sort();
  return `{${chiavi.map(k => `${JSON.stringify(k)}:${jsonStabile(v[k])}`).join(",")}}`;
}

function normalizzaTitolo(t: string): string {
  return t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizzaTesto(t: unknown): string {
  return normalizzaTitolo(String(t ?? ""));
}

/**
 * Chiave dell'effetto richiesto, non della formulazione del modello.
 * Motivazione e confidenza sono volutamente escluse: cambiare spiegazione
 * non rende nuova un'azione gia proposta.
 */
export function chiaveAzioneProposta(p: {
  tipo: string;
  commessaId?: number | null;
  clienteId?: number | null;
  payload?: any;
  titolo?: string;
}): string {
  const pay = p.payload ?? {};
  const target = `c:${p.commessaId ?? pay.commessaId ?? "-"}|cl:${p.clienteId ?? pay.clienteId ?? "-"}`;
  let effetto: unknown;

  switch (p.tipo) {
    case "collega_comunicazione":
      effetto = { comunicazioneId: pay.comunicazioneId };
      break;
    case "collega_fattura":
      effetto = { ficId: pay.ficId };
      break;
    case "rinomina_documento":
      effetto = {
        documentoId: pay.documentoId,
        nome: normalizzaTesto(pay.nome),
        tipo: pay.tipo ?? null,
      };
      break;
    case "nota_timeline":
      effetto = { stepId: pay.stepId, note: normalizzaTesto(pay.note) };
      break;
    case "aggiornamento_magazzino":
      effetto = { prodottoId: pay.prodottoId, campi: pay.campi ?? {} };
      break;
    case "modifica_cliente":
    case "modifica_commessa":
      effetto = pay.campi ?? {};
      break;
    case "ticket":
      effetto = {
        categoria: pay.categoria ?? null,
        contatto: normalizzaTesto(pay.contatto),
        oggetto: normalizzaTesto(pay.oggetto),
      };
      break;
    case "pagamento":
      effetto = {
        importo: Number.isFinite(Number(pay.importo))
          ? Number(pay.importo).toFixed(2)
          : pay.importo,
        data: pay.data ?? null,
        tipo: pay.tipo ?? null,
        riferimento: normalizzaTesto(pay.note),
      };
      break;
    case "avanzamento_stato":
      effetto = { nuovoStato: pay.nuovoStato };
      break;
    case "bozza_risposta":
      effetto = {
        destinatario: normalizzaTesto(pay.destinatario),
        canale: pay.canale ?? null,
        testo: normalizzaTesto(pay.testo),
      };
      break;
    case "segnalazione":
      effetto = {
        severita: pay.severita ?? null,
        descrizione: normalizzaTesto(pay.descrizione),
      };
      break;
    case "miglioramento_processo":
      effetto = {
        area: normalizzaTesto(pay.area),
        problema: normalizzaTesto(pay.problema),
        proposta: normalizzaTesto(pay.proposta),
      };
      break;
    case "domanda":
      effetto = { domanda: normalizzaTesto(pay.domanda ?? p.titolo) };
      break;
    default:
      effetto = pay;
  }

  return `${p.tipo}|${target}|${jsonStabile(effetto)}`;
}

function titoliSimili(a: string, b: string): boolean {
  const na = normalizzaTitolo(a);
  const nb = normalizzaTitolo(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const aa = new Set(na.split(" ").filter(x => x.length > 2));
  const bb = new Set(nb.split(" ").filter(x => x.length > 2));
  if (aa.size < 3 || bb.size < 3) return false;
  let comuni = 0;
  for (const token of Array.from(aa)) if (bb.has(token)) comuni++;
  const unione = new Set(Array.from(aa).concat(Array.from(bb))).size;
  return unione > 0 && comuni / unione >= 0.72;
}

function stessaProposta(
  candidata: {
    tipo: string;
    commessaId: number | null;
    clienteId?: number | null;
    payload: any;
    titolo: string;
  },
  esistente: Proposta
): boolean {
  if (candidata.tipo !== esistente.tipo) return false;
  const chiave = chiaveAzioneProposta(candidata);
  const altraChiave =
    esistente.chiaveAzione ?? chiaveAzioneProposta(esistente);
  if (chiave === altraChiave) return true;

  const stessoTarget =
    (candidata.commessaId ?? null) === esistente.commessaId &&
    (candidata.clienteId ?? null) === esistente.clienteId;
  return stessoTarget && titoliSimili(candidata.titolo, esistente.titolo);
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
  candidata: {
    tipo: string;
    commessaId: number | null;
    clienteId?: number | null;
    payload: any;
    titolo: string;
  },
  sedeId: number
): Proposta | undefined {
  return proposte.find(p => {
    if (p.sedeId !== sedeId || p.stato !== "rifiutata") return false;
    return stessaProposta(candidata, p);
  });
}

/** Idem per una proposta ancora in attesa: non si mette in coda due volte. */
export function propostaGiaInCoda(
  candidata: {
    tipo: string;
    commessaId: number | null;
    clienteId?: number | null;
    payload: any;
    titolo: string;
  },
  sedeId: number
): Proposta | undefined {
  return proposte.find(p => {
    if (p.sedeId !== sedeId || p.stato !== "pendente") return false;
    return stessaProposta(candidata, p);
  });
}

/** Una proposta gia decisa non deve rinascere con parole diverse. */
export function propostaGiaGestita(
  candidata: {
    tipo: string;
    commessaId: number | null;
    clienteId?: number | null;
    payload: any;
    titolo: string;
  },
  sedeId: number
): Proposta | undefined {
  return proposte.find(p => {
    if (p.sedeId !== sedeId || p.stato === "pendente" || p.stato === "rifiutata") {
      return false;
    }
    return stessaProposta(candidata, p);
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
  items => {
    nextVoceId = items.length ? Math.max(...items.map(v => v.id)) + 1 : 1;
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
  // Il modello che ha davvero girato: senza, la spesa non si può calcolare
  // a posteriori (il config può essere cambiato nel frattempo).
  modello: string | null;
  commessaId: number | null;
  richiesta: string; // il messaggio utente passato al modello
  profiloStrumenti: string;
  strumentiDisponibili: number;
  toolCacheHits: number;
  proposteDuplicateBloccate: number;
  fascicoloPrecaricato: boolean;
  strumenti: StrumentoChiamato[];
  proposteIds: number[];
  riepilogo: string | null; // il testo finale del modello
  tokensIn: number;
  tokensOut: number;
  // La cache cambia il prezzo di un fattore 10: contarla insieme all'input
  // pieno gonfierebbe la spesa stimata e farebbe scattare il budget a vuoto.
  tokensCacheRead: number;
  // Scrivere in cache costa 1.25× a 5 minuti e 2× a un'ora. Sommarle in un
  // campo solo sbaglierebbe la stima del 60% sul prefisso stabile, che è
  // proprio la parte grossa.
  tokensCacheWrite5m: number;
  tokensCacheWrite1h: number;
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
  items => {
    nextEsecuzioneId = items.length ? Math.max(...items.map(e => e.id)) + 1 : 1;
    for (const e of items) {
      if (e.modello === undefined) e.modello = null;
      if (e.profiloStrumenti === undefined) e.profiloStrumenti = "completo";
      if (e.strumentiDisponibili === undefined) e.strumentiDisponibili = 0;
      if (e.toolCacheHits === undefined) e.toolCacheHits = 0;
      if (e.proposteDuplicateBloccate === undefined) {
        e.proposteDuplicateBloccate = 0;
      }
      if (e.fascicoloPrecaricato === undefined) e.fascicoloPrecaricato = false;
      if (e.tokensCacheRead === undefined) e.tokensCacheRead = 0;
      // Prima esisteva un solo campo, ed era sempre a 5 minuti.
      const vecchio = (e as any).tokensCacheWrite;
      if (e.tokensCacheWrite5m === undefined)
        e.tokensCacheWrite5m = vecchio ?? 0;
      if (e.tokensCacheWrite1h === undefined) e.tokensCacheWrite1h = 0;
      delete (e as any).tokensCacheWrite;
    }
  }
);
export const esecuzioni = _esecuzioniStore.items;
export const saveEsecuzioni = () => _esecuzioniStore.save();
export const newEsecuzioneId = () => nextEsecuzioneId++;

// ── Spesa ───────────────────────────────────────────────────────────────────
// Prezzi Anthropic per milione di token (USD). Cache read ~0.1× dell'input,
// cache write ~1.25×. Il numero che ne esce è una STIMA da cruscotto — la
// fattura vera la fa Anthropic — ma basta per un budget.

type Prezzi = { in: number; out: number };
const PREZZI_MTOK: Record<string, Prezzi> = {
  "claude-opus-5": { in: 5, out: 25 },
  "claude-sonnet-5": { in: 3, out: 15 },
  "claude-haiku-4-5-20251001": { in: 1, out: 5 },
};
// Un modello sconosciuto (record vecchi senza modello, id futuri) si conta
// al prezzo più alto: un budget che sbaglia deve sbagliare per eccesso.
const PREZZI_FALLBACK: Prezzi = { in: 5, out: 25 };

export function costoEsecuzioneUsd(e: {
  modello: string | null;
  tokensIn: number;
  tokensOut: number;
  tokensCacheRead: number;
  tokensCacheWrite5m: number;
  tokensCacheWrite1h: number;
}): number {
  const p = (e.modello && PREZZI_MTOK[e.modello]) || PREZZI_FALLBACK;
  return (
    (e.tokensIn * p.in +
      e.tokensOut * p.out +
      e.tokensCacheRead * p.in * 0.1 +
      e.tokensCacheWrite5m * p.in * 1.25 +
      e.tokensCacheWrite1h * p.in * 2) /
    1_000_000
  );
}

/** Spesa stimata del mese corrente per una sede. */
export function spesaMeseUsd(sedeId: number): number {
  const ora = new Date();
  const anno = ora.getFullYear();
  const mese = ora.getMonth();
  let totale = 0;
  for (const e of esecuzioni) {
    if (e.sedeId !== sedeId) continue;
    const d = new Date(e.createdAt);
    if (d.getFullYear() !== anno || d.getMonth() !== mese) continue;
    totale += costoEsecuzioneUsd(e);
  }
  return totale;
}

/**
 * Il budget mensile è finito? I trigger automatici si fermano qui; quelli
 * umani ricevono un errore che dice quanto è stato speso e dove alzarlo.
 */
export function budgetMensileSuperato(sedeId: number): boolean {
  const config = getTarsConfig(sedeId);
  if (!config.budgetMensileUsd || config.budgetMensileUsd <= 0) return false;
  return spesaMeseUsd(sedeId) >= config.budgetMensileUsd;
}

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
const _chatStore = persistedStore<ChatRecord>("tars_chat", items => {
  nextChatId = items.length ? Math.max(...items.map(c => c.id)) + 1 : 1;
});

export function getChat(sedeId: number, utenteId: number): ChatRecord {
  let rec = _chatStore.items.find(
    c => c.sedeId === sedeId && c.utenteId === utenteId
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
  // I lavori di massa (smistamento mail, riconciliazione fatture) girano su
  // un modello più economico: sono compiti di aggancio, non di ragionamento
  // profondo, e sono anche i più frequenti — è lì che si brucia il budget.
  modelloAutomatico: string;
  // Tetto mensile stimato in USD (i prezzi Anthropic sono in dollari).
  // Superato il tetto: i trigger automatici si fermano, quelli umani
  // ricevono un errore chiaro. 0 = nessun limite.
  budgetMensileUsd: number;
  // Budget per esecuzione (il piano prevede anche un budget mensile in €;
  // arriverà con i trigger schedulati, quando i volumi lo giustificano).
  maxToolCalls: number;
  maxProposte: number;
  timeoutMs: number;
  // Analisi trasversale giornaliera: legge indicatori aggregati e propone
  // miglioramenti di processo. Non modifica mai regole o dati da sola.
  auditProcessiAttivo: boolean;
  ultimoAuditProcessiAt: Date | null;
  // Versione dei default applicata a questo record. Serve a far arrivare un
  // cambio di modello o di budget anche alle installazioni già avviate:
  // senza, il record salvato resterebbe su Sonnet per sempre.
  versioneDefault?: number;
  updatedAt: Date;
};

const VERSIONE_DEFAULT = 3;

const DEFAULT_CONFIG: Omit<TarsConfig, "id" | "sedeId"> = {
  attivo: false, // spento finché la direzione non lo accende
  modello: "claude-opus-5",
  modelloAutomatico: "claude-sonnet-5",
  budgetMensileUsd: 25,
  // Con la lettura degli strumenti in parallelo un giro costa meno tempo:
  // il budget più alto serve a farlo arrivare in fondo all'indagine, non a
  // fargli fare più giri a vuoto.
  maxToolCalls: 25,
  maxProposte: 5,
  timeoutMs: 120_000,
  auditProcessiAttivo: true,
  ultimoAuditProcessiAt: null,
  versioneDefault: VERSIONE_DEFAULT,
  updatedAt: new Date(),
};

let nextConfigId = 2;

const _configStore = persistedStore<TarsConfig>(
  "agente_config",
  (items, meta) => {
    if (items.length === 0 && meta.firstBoot) {
      items.push({ ...DEFAULT_CONFIG, id: 1, sedeId: DEFAULT_SEDE_ID });
    }
    for (const c of items) {
      // Il record globale di prima diventa quello della sede principale.
      if (c.sedeId === undefined) c.sedeId = DEFAULT_SEDE_ID;
      if (c.maxToolCalls === undefined)
        c.maxToolCalls = DEFAULT_CONFIG.maxToolCalls;
      if (c.maxProposte === undefined)
        c.maxProposte = DEFAULT_CONFIG.maxProposte;
      if (c.timeoutMs === undefined) c.timeoutMs = DEFAULT_CONFIG.timeoutMs;
      if (c.auditProcessiAttivo === undefined) {
        c.auditProcessiAttivo = DEFAULT_CONFIG.auditProcessiAttivo;
      }
      if (c.ultimoAuditProcessiAt === undefined) c.ultimoAuditProcessiAt = null;
      if (c.modello === undefined) c.modello = DEFAULT_CONFIG.modello;
      if (c.modelloAutomatico === undefined) {
        c.modelloAutomatico = DEFAULT_CONFIG.modelloAutomatico;
      }
      if (c.budgetMensileUsd === undefined) {
        c.budgetMensileUsd = DEFAULT_CONFIG.budgetMensileUsd;
      }
      // Aggiornamento dei default. Non tocca `attivo`: accendere Tars resta
      // una decisione umana, e una migrazione non la prende per nessuno.
      if ((c.versioneDefault ?? 1) < VERSIONE_DEFAULT) {
        c.modello = DEFAULT_CONFIG.modello;
        c.maxToolCalls = DEFAULT_CONFIG.maxToolCalls;
        c.timeoutMs = DEFAULT_CONFIG.timeoutMs;
        c.versioneDefault = VERSIONE_DEFAULT;
      }
    }
    nextConfigId = items.length ? Math.max(...items.map(c => c.id)) + 1 : 1;
  }
);

/**
 * La configurazione di Tars per una sede. Se la sede non ne ha ancora una,
 * nasce spenta: attivare un agente che legge i dati di una sede nuova deve
 * restare una decisione presa da qualcuno, non un effetto collaterale.
 */
export function getTarsConfig(sedeId: number | null): TarsConfig {
  const sede = sedeId ?? DEFAULT_SEDE_ID;
  let c = _configStore.items.find(x => x.sedeId === sede);
  if (!c) {
    c = {
      ...DEFAULT_CONFIG,
      id: nextConfigId++,
      sedeId: sede,
      updatedAt: new Date(),
    };
    _configStore.items.push(c);
    _configStore.save();
  }
  return c;
}
export const saveConfig = () => _configStore.save();
