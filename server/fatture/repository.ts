// Fatture: testata, righe, riepilogo IVA, scadenze, eventi e configurazione
// per sede. Stesso pattern di server/computo/repository.ts e
// server/contratti/repository.ts: memoria senza DATABASE_URL (test e
// sviluppo), Postgres altrimenti.
//
// `aggiornaBozza` sostituisce interamente righe/riepilogo/scadenze con un
// blocco ottimistico sulla `revisione` (letta e confrontata, mai un
// UPDATE "cieco"); le scadenze già collegate a un pagamento FiC
// conservano `ficPaymentId`/`stato` per numero attraverso la sostituzione.
// Le altre scritture (`aggiornaStato`, `aggiornaScadenza`) toccano solo la
// testata o una singola scadenza, senza mai ricreare le righe.
//
// L'immutabilità dagli stati diversi da bozza è responsabilità del
// servizio (Task 6), non di questo repository: qui si scrive quello che
// arriva.
import { kvSql } from "../_core/persistence";
import {
  FATTURAZIONE_CONFIG_DEFAULT,
  type Aliquota,
  type ClienteSnapshot,
  type EventoFattura,
  type Fattura,
  type FatturazioneConfig,
  type RiepilogoIva,
  type RigaFattura,
  type RigaFatturaInput,
  type ScadenzaFattura,
  type ScadenzaFatturaInput,
  type StatoFattura,
  type TipoFattura,
} from "@shared/fatturazione/tipi";
import { normalizzaSnapshot } from "./cliente";
import { toccaFattureCommessa } from "./versioni";

export type FatturaPersist = Omit<
  Fattura,
  "id" | "createdAt" | "updatedAt" | "righe" | "riepilogo" | "scadenze" | "revisione"
>;

export type PatchBozza = Partial<
  Pick<
    Fattura,
    | "diciture"
    | "note"
    | "intestazioneCantiere"
    | "imponibileCent"
    | "ivaCent"
    | "totaleCent"
    | "deltaPattuitoCent"
    | "markupCent"
    | "stornoCent"
    | "computoId"
    | "hashRighe"
    | "scavalcoLimiti"
    | "scavalcoMotivo"
    | "pattuitoCent"
    | "pattuitoTipo"
    | "detrazioneTipo"
    | "clienteSnapshot"
  >
>;

export type PatchStato = Partial<
  Pick<
    Fattura,
    | "stato"
    | "ficDocumentId"
    | "numero"
    | "data"
    | "clienteSnapshot"
    | "pdfStorageKey"
    | "xmlStorageKey"
    | "xmlSha256"
    | "documentoId"
    | "eiStatusFic"
    | "eiErrore"
    | "inviataDryRun"
    | "emessaDa"
    | "emessaAt"
    | "imponibileCent"
    | "ivaCent"
    | "totaleCent"
    // Resta per compatibilità (Ruling R1): un chiamante può ancora
    // scrivere la revisione a mano. Nel percorso di emissione non serve
    // più — la incrementa il compare-and-swap di `atteso` (Ruling R35),
    // che quando è presente ha la precedenza su questa chiave.
    | "revisione"
  >
>;

/**
 * Compare-and-swap di `aggiornaStato` (Ruling R35): la scrittura avviene
 * SOLO se la riga è ancora in quello stato e a quella revisione,
 * altrimenti `CONFLITTO`. È il lease dell'emissione: due chiamate
 * sovrapposte sulla stessa fattura non possono entrambe arrivare a
 * creare un documento su Fatture in Cloud. Chi vince trova la revisione
 * incrementata di uno dal CAS stesso.
 */
export type StatoAtteso = { stato: StatoFattura; revisione: number };

export type FiltroFatture = {
  sedeId: number;
  stati?: StatoFattura[];
  tipo?: TipoFattura;
  limite?: number;
};

export type FattureRepository = {
  ensureSchema(): Promise<void>;
  // configurazione per sede
  config(sedeId: number): Promise<FatturazioneConfig>; // default se assente
  salvaConfig(config: FatturazioneConfig): Promise<FatturazioneConfig>;
  // fatture
  crea(input: {
    fattura: FatturaPersist;
    righe: RigaFatturaInput[];
    riepilogo: RiepilogoIva[];
    scadenze: ScadenzaFatturaInput[];
    now: Date;
  }): Promise<Fattura>;
  perId(sedeId: number, id: number): Promise<Fattura | null>;
  perCommessa(sedeId: number, commessaId: number): Promise<Fattura[]>; // più recente prima
  perFicDocumentId(sedeId: number, ficDocumentId: number): Promise<Fattura | null>;
  lista(filtro: FiltroFatture): Promise<Fattura[]>; // senza righe (voci vuote) per le liste
  daSondare(): Promise<
    Array<Pick<Fattura, "id" | "sedeId" | "ficDocumentId" | "stato" | "inviataDryRun">>
  >; // stati inviata, o emessa con dry-run, su tutte le sedi
  /** Sostituisce righe/riepilogo/scadenze e aggiorna i totali. Blocco ottimistico: `revisioneAttesa` ≠ corrente → CONFLITTO. */
  aggiornaBozza(input: {
    sedeId: number;
    id: number;
    revisioneAttesa: number;
    patch: PatchBozza;
    righe: RigaFatturaInput[];
    riepilogo: RiepilogoIva[];
    scadenze: ScadenzaFatturaInput[];
    now: Date;
  }): Promise<Fattura>;
  /** Cambia stato/campi di emissione senza toccare le righe. Con `atteso` è un compare-and-swap: scrive solo se stato e revisione sono ancora quelli, incrementa la revisione e altrimenti solleva `CONFLITTO` (Ruling R35). */
  aggiornaStato(input: {
    sedeId: number;
    id: number;
    patch: PatchStato;
    atteso?: StatoAtteso;
    now: Date;
  }): Promise<Fattura>;
  aggiornaScadenza(input: {
    sedeId: number;
    fatturaId: number;
    numero: number;
    patch: Partial<Pick<ScadenzaFattura, "ficPaymentId" | "stato">>;
  }): Promise<void>;
  appendEvento(evento: Omit<EventoFattura, "id" | "createdAt"> & { createdAt?: Date }): Promise<EventoFattura>;
  eventi(sedeId: number, fatturaId: number): Promise<EventoFattura[]>; // cronologici
};

export function createMemoryFattureRepository(): FattureRepository {
  const fatture = new Map<number, Fattura>();
  const eventi: EventoFattura[] = [];
  const config = new Map<number, FatturazioneConfig>();
  let prossimoId = 1;
  let prossimoRigaId = 1;
  let prossimoScadenzaId = 1;
  let prossimoEventoId = 1;
  const clona = <T>(x: T): T => structuredClone(x);
  const trova = (sedeId: number, id: number): Fattura | null => {
    const f = fatture.get(id);
    return f && f.sedeId === sedeId ? f : null;
  };
  // Lo snapshot che arriva dal chiamante (o da un fascicolo vecchio
  // rimesso in circolo) può non avere i campi aggiunti dopo: si completa
  // in scrittura, così in memoria non esiste mai una fattura con uno
  // snapshot a metà. Postgres fa lo stesso in lettura (rowToFatturaParziale).
  const conSnapshot = <T extends { clienteSnapshot?: ClienteSnapshot | null }>(patch: T): T =>
    "clienteSnapshot" in patch ? { ...patch, clienteSnapshot: normalizzaSnapshot(patch.clienteSnapshot) } : patch;
  // Un patch parziale con una chiave presente ma `undefined` deve valere
  // come "non toccare questo campo", non come "azzeralo": Object.assign
  // copierebbe comunque quella chiave (copia per presenza, non per
  // valore). Filtrarla qui allinea la memoria al backend Postgres, dove
  // una colonna assente dal SET non viene proprio nominata nella query.
  const senzaUndefined = <T extends object>(patch: T): Partial<T> => {
    const risultato: Partial<T> = {};
    for (const chiave of Object.keys(patch) as (keyof T)[]) {
      if (patch[chiave] !== undefined) risultato[chiave] = patch[chiave];
    }
    return risultato;
  };
  const righeDa = (fatturaId: number, righe: RigaFatturaInput[]): RigaFattura[] =>
    [...righe]
      .sort((a, b) => a.ordine - b.ordine)
      .map(r => ({ ...r, id: prossimoRigaId++, fatturaId }));
  const scadenzeDa = (
    fatturaId: number,
    scadenze: ScadenzaFatturaInput[],
    precedenti: ScadenzaFattura[]
  ): ScadenzaFattura[] =>
    [...scadenze]
      .sort((a, b) => a.numero - b.numero)
      .map(s => {
        const prima = precedenti.find(p => p.numero === s.numero);
        return {
          ...s,
          id: prossimoScadenzaId++,
          fatturaId,
          ficPaymentId: prima?.ficPaymentId ?? null,
          stato: prima?.stato ?? "attesa",
        };
      });

  return {
    async ensureSchema() {},

    async config(sedeId) {
      return clona(
        config.get(sedeId) ?? { ...FATTURAZIONE_CONFIG_DEFAULT, sedeId, updatedAt: new Date(0) }
      );
    },
    async salvaConfig(c) {
      const salvata = { ...clona(c), updatedAt: new Date() };
      config.set(c.sedeId, salvata);
      return clona(salvata);
    },

    async crea({ fattura, righe, riepilogo, scadenze, now }) {
      const id = prossimoId++;
      const f: Fattura = {
        ...conSnapshot(clona(fattura)),
        id,
        revisione: 1,
        createdAt: now,
        updatedAt: now,
        righe: righeDa(id, righe),
        riepilogo: ordinaRiepilogo(clona(riepilogo)),
        scadenze: scadenzeDa(id, scadenze, []),
      };
      fatture.set(id, f);
      // Task 17: ogni scrittura tocca la versione osservata dal fascicolo
      // Tars della commessa (server/fatture/versioni.ts), qui e nelle
      // altre quattro scritture sotto.
      toccaFattureCommessa(f.sedeId, f.commessaId);
      return clona(f);
    },
    async perId(sedeId, id) {
      const f = trova(sedeId, id);
      return f ? clona(f) : null;
    },
    async perCommessa(sedeId, commessaId) {
      return [...fatture.values()]
        .filter(f => f.sedeId === sedeId && f.commessaId === commessaId)
        .sort((a, b) => b.id - a.id)
        .map(clona);
    },
    async perFicDocumentId(sedeId, ficDocumentId) {
      return clona(
        [...fatture.values()].find(f => f.sedeId === sedeId && f.ficDocumentId === ficDocumentId) ?? null
      );
    },
    async lista({ sedeId, stati, tipo, limite }) {
      return [...fatture.values()]
        .filter(
          f =>
            f.sedeId === sedeId &&
            (!stati || stati.includes(f.stato)) &&
            (!tipo || f.tipo === tipo)
        )
        .sort((a, b) => b.id - a.id)
        .slice(0, limite ?? 200)
        .map(f => ({ ...clona(f), righe: [], riepilogo: [], scadenze: [] }));
    },
    async daSondare() {
      return [...fatture.values()]
        .filter(
          f =>
            f.ficDocumentId != null &&
            (f.stato === "inviata" || (f.stato === "emessa" && f.inviataDryRun))
        )
        .map(f => ({
          id: f.id,
          sedeId: f.sedeId,
          ficDocumentId: f.ficDocumentId,
          stato: f.stato,
          inviataDryRun: f.inviataDryRun,
        }));
    },
    async aggiornaBozza({ sedeId, id, revisioneAttesa, patch, righe, riepilogo, scadenze, now }) {
      const f = trova(sedeId, id);
      if (!f) throw new Error("NOT_FOUND: Fattura non trovata.");
      if (f.revisione !== revisioneAttesa) {
        throw new Error("CONFLITTO: la fattura è stata modificata da un'altra sessione, ricarica.");
      }
      Object.assign(f, conSnapshot(clona(senzaUndefined(patch))), {
        revisione: f.revisione + 1,
        updatedAt: now,
        righe: righeDa(id, righe),
        riepilogo: ordinaRiepilogo(clona(riepilogo)),
        scadenze: scadenzeDa(id, scadenze, f.scadenze),
      });
      toccaFattureCommessa(f.sedeId, f.commessaId);
      return clona(f);
    },
    async aggiornaStato({ sedeId, id, patch, atteso, now }) {
      const f = trova(sedeId, id);
      if (!f) throw new Error("NOT_FOUND: Fattura non trovata.");
      // Compare-and-swap (Ruling R35): il confronto e la scrittura stanno
      // nella stessa istruzione sincrona, come l'UPDATE … WHERE del
      // backend Postgres — nessun await in mezzo, nessuna finestra per
      // una seconda chiamata sovrapposta.
      if (atteso && (f.stato !== atteso.stato || f.revisione !== atteso.revisione)) {
        throw new Error("CONFLITTO: la fattura è cambiata nel frattempo: ricarica.");
      }
      Object.assign(f, conSnapshot(clona(senzaUndefined(patch))), { updatedAt: now });
      // La revisione la decide il CAS, non il patch: `atteso` vince su
      // un'eventuale `patch.revisione` scritta a mano.
      if (atteso) f.revisione = atteso.revisione + 1;
      toccaFattureCommessa(f.sedeId, f.commessaId);
      return clona(f);
    },
    async aggiornaScadenza({ sedeId, fatturaId, numero, patch }) {
      const f = trova(sedeId, fatturaId);
      if (!f) throw new Error("NOT_FOUND: Fattura non trovata.");
      const s = f.scadenze.find(x => x.numero === numero);
      if (!s) return;
      // Fix round 1 (parità col backend Postgres, che salta anche
      // l'UPDATE quando non c'è nessuna colonna da scrivere): un patch
      // senza chiavi definite non è una scrittura, quindi niente bump.
      const patchDefinito = senzaUndefined(patch);
      if (Object.keys(patchDefinito).length === 0) return;
      Object.assign(s, patchDefinito);
      toccaFattureCommessa(f.sedeId, f.commessaId);
    },
    // Non verifica che `fatturaId` appartenga davvero a `sedeId`: chi
    // chiama (il servizio, Task 6) ha già in mano la fattura corretta.
    // Un evento con sede/fattura scollegate non è isolato da `eventi()`,
    // che filtra su entrambe, ma un chiamante malformato può comunque
    // scrivere un evento "orfano": la garanzia non è qui.
    async appendEvento(e) {
      const evento: EventoFattura = { ...clona(e), id: prossimoEventoId++, createdAt: e.createdAt ?? new Date() };
      eventi.push(evento);
      // Stesso limite del commento sopra `eventi()`: un evento orfano (sede
      // o fatturaId sbagliati) non tocca nessuna versione, semplicemente
      // perché non si sa quale — non è la garanzia di questo metodo.
      const f = trova(e.sedeId, e.fatturaId);
      if (f) toccaFattureCommessa(f.sedeId, f.commessaId);
      return clona(evento);
    },
    async eventi(sedeId, fatturaId) {
      return eventi.filter(e => e.sedeId === sedeId && e.fatturaId === fatturaId).map(clona);
    },
  };
}

// --- Mapper riga → tipo di dominio (Postgres) --------------------------
//
// DATE letta come `Date` dal driver → stringa YYYY-MM-DD (lezione del
// piano 1: un formato locale tipo "Thu Sep 03" avrebbe rotto ogni
// confronto a valle). NUMERIC/BIGINT → Number(...): i BIGINT tornano come
// stringa dal driver, e nessun importo di fattura si avvicina a
// Number.MAX_SAFE_INTEGER.
function dataIso(v: unknown): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

function rowToFatturaParziale(row: any): Omit<Fattura, "righe" | "riepilogo" | "scadenze"> {
  return {
    id: Number(row.id),
    sedeId: Number(row.sede_id),
    commessaId: Number(row.commessa_id),
    computoId: row.computo_id == null ? null : Number(row.computo_id),
    hashRighe: row.hash_righe ?? null,
    tipo: row.tipo,
    notaCreditoDi: row.nota_credito_di == null ? null : Number(row.nota_credito_di),
    stato: row.stato,
    ficDocumentId: row.fic_document_id == null ? null : Number(row.fic_document_id),
    numero: row.numero ?? null,
    data: row.data == null ? null : dataIso(row.data),
    // Le fatture scritte prima di un campo nuovo dello snapshot (es.
    // `praticaEdilizia`) tornano dal JSONB senza quel campo: `normalizzaSnapshot`
    // lo riempie col default invece di lasciare un `undefined` che il tipo
    // dichiara obbligatorio.
    clienteSnapshot: normalizzaSnapshot(row.cliente_snapshot),
    pattuitoTipo: row.pattuito_tipo,
    pattuitoCent: Number(row.pattuito_cent),
    imponibileCent: Number(row.imponibile_cent),
    ivaCent: Number(row.iva_cent),
    totaleCent: Number(row.totale_cent),
    deltaPattuitoCent: Number(row.delta_pattuito_cent),
    markupCent: Number(row.markup_cent),
    stornoCent: Number(row.storno_cent),
    diciture: Array.isArray(row.diciture) ? row.diciture : [],
    note: row.note ?? null,
    intestazioneCantiere: row.intestazione_cantiere ?? null,
    detrazioneTipo: row.detrazione_tipo,
    pdfStorageKey: row.pdf_storage_key ?? null,
    xmlStorageKey: row.xml_storage_key ?? null,
    xmlSha256: row.xml_sha256 ?? null,
    documentoId: row.documento_id == null ? null : Number(row.documento_id),
    eiStatusFic: row.ei_status_fic ?? null,
    eiErrore: row.ei_errore ?? null,
    inviataDryRun: Boolean(row.inviata_dry_run),
    scavalcoLimiti: Boolean(row.scavalco_limiti),
    scavalcoMotivo: row.scavalco_motivo ?? null,
    createdBy: row.created_by == null ? null : Number(row.created_by),
    emessaDa: row.emessa_da == null ? null : Number(row.emessa_da),
    emessaAt: row.emessa_at == null ? null : new Date(row.emessa_at),
    revisione: Number(row.revisione),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function rowToFattura(
  row: any,
  righe: RigaFattura[],
  riepilogo: RiepilogoIva[],
  scadenze: ScadenzaFattura[]
): Fattura {
  return { ...rowToFatturaParziale(row), righe, riepilogo, scadenze };
}

function rowToRiga(row: any): RigaFattura {
  return {
    id: Number(row.id),
    fatturaId: Number(row.fattura_id),
    ordine: Number(row.ordine),
    tipo: row.tipo,
    descrizione: row.descrizione,
    quantita: Number(row.quantita),
    prezzoUnitCent: Number(row.prezzo_unit_cent),
    importoCent: Number(row.importo_cent),
    // Il CHECK (aliquota IN (22,10)) del DDL garantisce il letterale: il
    // cast serve solo perché Number(...) torna `number`, non l'unione.
    aliquota: row.aliquota == null ? null : (Number(row.aliquota) as Aliquota),
    voceComputoCodice: row.voce_computo_codice ?? null,
    rigaCommessaId: row.riga_commessa_id == null ? null : Number(row.riga_commessa_id),
    limiteCent: row.limite_cent == null ? null : Number(row.limite_cent),
    beneSignificativo: Boolean(row.bene_significativo),
    derivata: Boolean(row.derivata),
  };
}

function rowToRiepilogo(row: any): RiepilogoIva {
  return {
    aliquota: Number(row.aliquota) as Aliquota,
    imponibileCent: Number(row.imponibile_cent),
    impostaCent: Number(row.imposta_cent),
  };
}

function rowToScadenza(row: any): ScadenzaFattura {
  return {
    id: Number(row.id),
    fatturaId: Number(row.fattura_id),
    numero: Number(row.numero),
    quotaPct: Number(row.quota_pct),
    data: dataIso(row.data),
    importoCent: Number(row.importo_cent),
    descrizione: row.descrizione ?? null,
    ficPaymentId: row.fic_payment_id == null ? null : Number(row.fic_payment_id),
    stato: row.stato,
  };
}

function rowToEvento(row: any): EventoFattura {
  return {
    id: Number(row.id),
    fatturaId: Number(row.fattura_id),
    sedeId: Number(row.sede_id),
    tipo: row.tipo,
    payload: row.payload ?? {},
    actorUserId: row.actor_user_id == null ? null : Number(row.actor_user_id),
    createdAt: new Date(row.created_at),
  };
}

function rowToConfig(row: any): FatturazioneConfig {
  return {
    sedeId: Number(row.sede_id),
    iban: row.iban ?? null,
    banca: row.banca ?? null,
    intestatario: row.intestatario ?? null,
    metodoPagamento: row.metodo_pagamento,
    numerazioneFic: row.numerazione_fic ?? null,
    paymentAccountIdFic: row.payment_account_id_fic == null ? null : Number(row.payment_account_id_fic),
    vatIdsFic: row.vat_ids_fic ?? { 22: null, 10: null },
    dicituraFooter: row.dicitura_footer ?? null,
    speseDocumentazioneCent:
      row.spese_documentazione_cent == null
        ? FATTURAZIONE_CONFIG_DEFAULT.speseDocumentazioneCent
        : Number(row.spese_documentazione_cent),
    scopeScritturaOk: Boolean(row.scope_scrittura_ok),
    scopeVerificatoAt: row.scope_verificato_at == null ? null : new Date(row.scope_verificato_at),
    updatedAt: new Date(row.updated_at),
  };
}

/** Ordina come le liste in memoria: chiave primaria di dominio, poi `id` a spareggio (l'ordine del RETURNING non è garantito dal protocollo). Usata da entrambi i backend, memoria compresa, così `crea`/`aggiornaBozza` tornano lo stesso ordine su entrambi. */
function ordinaRighe(righe: RigaFattura[]): RigaFattura[] {
  return [...righe].sort((a, b) => a.ordine - b.ordine || a.id - b.id);
}
/** Aliquota decrescente (22 poi 10): stesso ordine di `caricaFigli`/`perCommessa` su Postgres, dove nasce da un `ORDER BY aliquota DESC` — qui replicato per RETURNING e memoria, che non hanno un ORDER BY a cui appoggiarsi. */
function ordinaRiepilogo(riepilogo: RiepilogoIva[]): RiepilogoIva[] {
  return [...riepilogo].sort((a, b) => b.aliquota - a.aliquota);
}
function ordinaScadenze(scadenze: ScadenzaFattura[]): ScadenzaFattura[] {
  return [...scadenze].sort((a, b) => a.numero - b.numero || a.id - b.id);
}

/** Raggruppa righe grezze (con colonna `fattura_id`) per fattura: usato da perCommessa per appaiare i tre `WHERE fattura_id = ANY(...)` alla fattura di riga senza una query per fattura. */
function raggruppaPer<T>(righe: any[], mappa: (row: any) => T): Map<number, T[]> {
  const risultato = new Map<number, T[]>();
  for (const row of righe) {
    const fatturaId = Number(row.fattura_id);
    const valore = mappa(row);
    const arr = risultato.get(fatturaId);
    if (arr) arr.push(valore);
    else risultato.set(fatturaId, [valore]);
  }
  return risultato;
}

/**
 * Bulk insert di righe/riepilogo/scadenze per UNA fattura, condiviso da
 * `crea` (dove `precedenti` è sempre `[]`: niente scadenze da conservare
 * su una fattura nuova) e `aggiornaBozza` (dove `precedenti` sono le
 * scadenze lette prima del DELETE, per riappaiare `ficPaymentId`/`stato`
 * per `numero`). Deve girare dentro la stessa transazione del DELETE e
 * dell'UPDATE della testata, quindi prende `tx`, non `sql`.
 *
 * `tx` è tipizzato `any`: `TransactionSql` di postgres-js non condivide
 * un alias comodo con `Sql` (sono due interfacce sorelle sotto `ISql`,
 * non l'una sottotipo dell'altra), e `Parameters<>` su `begin` — che è
 * overloaded — risolverebbe l'overload sbagliato. Stesso compromesso già
 * accettato per i mapper di riga (`row: any`) qui sopra: la correttezza
 * la garantiscono le due suite di test, non il tipo.
 */
async function inserisciFigli(
  tx: any,
  fatturaId: number,
  righe: RigaFatturaInput[],
  riepilogo: RiepilogoIva[],
  scadenze: ScadenzaFatturaInput[],
  precedenti: ScadenzaFattura[]
): Promise<{ righe: RigaFattura[]; riepilogo: RiepilogoIva[]; scadenze: ScadenzaFattura[] }> {
  const righeInserite = righe.length === 0 ? [] : await tx`INSERT INTO fattura_righe ${tx(
    righe.map(r => ({
      fattura_id: fatturaId, ordine: r.ordine, tipo: r.tipo, descrizione: r.descrizione, quantita: r.quantita,
      prezzo_unit_cent: r.prezzoUnitCent, importo_cent: r.importoCent, aliquota: r.aliquota,
      voce_computo_codice: r.voceComputoCodice, riga_commessa_id: r.rigaCommessaId, limite_cent: r.limiteCent,
      bene_significativo: r.beneSignificativo, derivata: r.derivata,
    })),
    "fattura_id", "ordine", "tipo", "descrizione", "quantita", "prezzo_unit_cent", "importo_cent",
    "aliquota", "voce_computo_codice", "riga_commessa_id", "limite_cent", "bene_significativo", "derivata"
  )} RETURNING *`;

  const riepilogoInserito = riepilogo.length === 0 ? [] : await tx`INSERT INTO fattura_riepilogo_iva ${tx(
    riepilogo.map(v => ({
      fattura_id: fatturaId, aliquota: v.aliquota, imponibile_cent: v.imponibileCent, imposta_cent: v.impostaCent,
    })),
    "fattura_id", "aliquota", "imponibile_cent", "imposta_cent"
  )} RETURNING *`;

  const scadenzeInserite = scadenze.length === 0 ? [] : await tx`INSERT INTO fattura_scadenze ${tx(
    scadenze.map(s => {
      const prima = precedenti.find(p => p.numero === s.numero);
      return {
        fattura_id: fatturaId, numero: s.numero, quota_pct: s.quotaPct, data: s.data, importo_cent: s.importoCent,
        descrizione: s.descrizione, fic_payment_id: prima?.ficPaymentId ?? null, stato: prima?.stato ?? "attesa",
      };
    }),
    "fattura_id", "numero", "quota_pct", "data", "importo_cent", "descrizione", "fic_payment_id", "stato"
  )} RETURNING *`;

  // L'ordine del RETURNING non è garantito dal protocollo: lo stesso
  // ordine della rilettura (caricaFigli), applicato qui in memoria.
  return {
    righe: ordinaRighe(righeInserite.map(rowToRiga)),
    riepilogo: ordinaRiepilogo(riepilogoInserito.map(rowToRiepilogo)),
    scadenze: ordinaScadenze(scadenzeInserite.map(rowToScadenza)),
  };
}

export function createPostgresFattureRepository(sql: NonNullable<typeof kvSql>): FattureRepository {
  let schemaPromise: Promise<void> | null = null;
  const ensureSchema = () => {
    schemaPromise ??= sql
      .begin(async tx => {
        await tx`CREATE TABLE IF NOT EXISTS fatturazione_config (
          sede_id BIGINT PRIMARY KEY,
          iban TEXT, banca TEXT, intestatario TEXT,
          metodo_pagamento TEXT NOT NULL DEFAULT 'MP05',
          numerazione_fic TEXT, payment_account_id_fic BIGINT,
          vat_ids_fic JSONB NOT NULL DEFAULT '{"22":null,"10":null}'::jsonb,
          dicitura_footer TEXT,
          spese_documentazione_cent BIGINT NOT NULL DEFAULT 15000,
          scope_scrittura_ok BOOLEAN NOT NULL DEFAULT FALSE, scope_verificato_at TIMESTAMPTZ,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
        // Additiva per le configurazioni già in produzione (R17): la
        // colonna nasce con il default di 150,00 €, nessun backfill da fare.
        await tx`ALTER TABLE fatturazione_config
          ADD COLUMN IF NOT EXISTS spese_documentazione_cent BIGINT NOT NULL DEFAULT 15000`;
        await tx`CREATE TABLE IF NOT EXISTS fatture (
          id BIGSERIAL PRIMARY KEY, sede_id BIGINT NOT NULL, commessa_id BIGINT NOT NULL,
          computo_id BIGINT, hash_righe TEXT,
          tipo TEXT NOT NULL CHECK (tipo IN ('fattura','nota_credito')), nota_credito_di BIGINT,
          stato TEXT NOT NULL CHECK (stato IN ('bozza','in_emissione','emessa','inviata','consegnata','scartata','rifiutata','mancata_consegna','annullata')),
          fic_document_id BIGINT, numero TEXT, data DATE,
          cliente_snapshot JSONB,
          pattuito_tipo TEXT NOT NULL CHECK (pattuito_tipo IN ('lordo','imponibile')), pattuito_cent BIGINT NOT NULL,
          imponibile_cent BIGINT NOT NULL DEFAULT 0, iva_cent BIGINT NOT NULL DEFAULT 0, totale_cent BIGINT NOT NULL DEFAULT 0,
          delta_pattuito_cent BIGINT NOT NULL DEFAULT 0, markup_cent BIGINT NOT NULL DEFAULT 0, storno_cent BIGINT NOT NULL DEFAULT 0,
          diciture JSONB NOT NULL DEFAULT '[]'::jsonb, note TEXT, intestazione_cantiere TEXT,
          detrazione_tipo TEXT NOT NULL DEFAULT 'nessuna' CHECK (detrazione_tipo IN ('nessuna','ecobonus','ristrutturazione')),
          pdf_storage_key TEXT, xml_storage_key TEXT, xml_sha256 TEXT, documento_id BIGINT,
          ei_status_fic TEXT, ei_errore TEXT, inviata_dry_run BOOLEAN NOT NULL DEFAULT FALSE,
          scavalco_limiti BOOLEAN NOT NULL DEFAULT FALSE, scavalco_motivo TEXT,
          created_by BIGINT, emessa_da BIGINT, emessa_at TIMESTAMPTZ, revisione INTEGER NOT NULL DEFAULT 1,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
        await tx`CREATE INDEX IF NOT EXISTS fatture_sede_commessa_idx ON fatture (sede_id, commessa_id, id DESC)`;
        await tx`CREATE UNIQUE INDEX IF NOT EXISTS fatture_fic_document_idx ON fatture (sede_id, fic_document_id) WHERE fic_document_id IS NOT NULL`;
        await tx`CREATE TABLE IF NOT EXISTS fattura_righe (
          id BIGSERIAL PRIMARY KEY, fattura_id BIGINT NOT NULL REFERENCES fatture(id) ON DELETE CASCADE, ordine INTEGER NOT NULL,
          tipo TEXT NOT NULL CHECK (tipo IN ('intestazione','bene','servizio','markup','storno_bs','riaddebito_bs','nota')),
          descrizione TEXT NOT NULL, quantita NUMERIC(10,3) NOT NULL DEFAULT 1, prezzo_unit_cent BIGINT NOT NULL DEFAULT 0, importo_cent BIGINT NOT NULL DEFAULT 0,
          aliquota INTEGER CHECK (aliquota IN (22,10)), voce_computo_codice TEXT, riga_commessa_id BIGINT, limite_cent BIGINT,
          bene_significativo BOOLEAN NOT NULL DEFAULT FALSE, derivata BOOLEAN NOT NULL DEFAULT FALSE
        )`;
        await tx`CREATE INDEX IF NOT EXISTS fattura_righe_fattura_idx ON fattura_righe (fattura_id, ordine)`;
        await tx`CREATE TABLE IF NOT EXISTS fattura_riepilogo_iva (
          fattura_id BIGINT NOT NULL REFERENCES fatture(id) ON DELETE CASCADE, aliquota INTEGER NOT NULL CHECK (aliquota IN (22,10)),
          imponibile_cent BIGINT NOT NULL, imposta_cent BIGINT NOT NULL, PRIMARY KEY (fattura_id, aliquota)
        )`;
        await tx`CREATE TABLE IF NOT EXISTS fattura_scadenze (
          id BIGSERIAL PRIMARY KEY, fattura_id BIGINT NOT NULL REFERENCES fatture(id) ON DELETE CASCADE, numero INTEGER NOT NULL,
          quota_pct NUMERIC(6,2) NOT NULL, data DATE NOT NULL, importo_cent BIGINT NOT NULL, descrizione TEXT,
          fic_payment_id BIGINT, stato TEXT NOT NULL DEFAULT 'attesa' CHECK (stato IN ('attesa','pagata','stornata')),
          UNIQUE (fattura_id, numero)
        )`;
        await tx`CREATE TABLE IF NOT EXISTS fattura_eventi (
          id BIGSERIAL PRIMARY KEY, fattura_id BIGINT NOT NULL REFERENCES fatture(id) ON DELETE CASCADE, sede_id BIGINT NOT NULL,
          tipo TEXT NOT NULL, payload JSONB NOT NULL DEFAULT '{}'::jsonb, actor_user_id BIGINT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
        await tx`CREATE INDEX IF NOT EXISTS fattura_eventi_fattura_idx ON fattura_eventi (fattura_id, id)`;
      })
      .then(() => undefined)
      .catch(error => {
        schemaPromise = null;
        throw error;
      });
    return schemaPromise;
  };

  // Lettura dei figli di UNA fattura: usata da perId/perFicDocumentId, mai
  // dentro un ciclo — la lista è responsabilità di perCommessa/lista.
  const caricaFigli = async (fatturaId: number) => {
    const [righe, riepilogo, scadenze] = await Promise.all([
      sql`SELECT * FROM fattura_righe WHERE fattura_id = ${fatturaId} ORDER BY ordine, id`,
      sql`SELECT * FROM fattura_riepilogo_iva WHERE fattura_id = ${fatturaId} ORDER BY aliquota DESC`,
      sql`SELECT * FROM fattura_scadenze WHERE fattura_id = ${fatturaId} ORDER BY numero, id`,
    ]);
    return {
      righe: righe.map(rowToRiga),
      riepilogo: riepilogo.map(rowToRiepilogo),
      scadenze: scadenze.map(rowToScadenza),
    };
  };

  return {
    ensureSchema,

    async config(sedeId) {
      await ensureSchema();
      const rows = await sql`SELECT * FROM fatturazione_config WHERE sede_id = ${sedeId}`;
      return rows[0]
        ? rowToConfig(rows[0])
        : { ...structuredClone(FATTURAZIONE_CONFIG_DEFAULT), sedeId, updatedAt: new Date(0) };
    },
    async salvaConfig(c) {
      await ensureSchema();
      const now = new Date();
      const rows = await sql`INSERT INTO fatturazione_config (
          sede_id, iban, banca, intestatario, metodo_pagamento, numerazione_fic,
          payment_account_id_fic, vat_ids_fic, dicitura_footer, spese_documentazione_cent,
          scope_scrittura_ok, scope_verificato_at, updated_at
        ) VALUES (
          ${c.sedeId}, ${c.iban}, ${c.banca}, ${c.intestatario}, ${c.metodoPagamento},
          ${c.numerazioneFic}, ${c.paymentAccountIdFic}, ${sql.json(c.vatIdsFic as any)},
          ${c.dicituraFooter}, ${c.speseDocumentazioneCent}, ${c.scopeScritturaOk},
          ${c.scopeVerificatoAt}, ${now}
        )
        ON CONFLICT (sede_id) DO UPDATE SET
          iban = EXCLUDED.iban, banca = EXCLUDED.banca, intestatario = EXCLUDED.intestatario,
          metodo_pagamento = EXCLUDED.metodo_pagamento, numerazione_fic = EXCLUDED.numerazione_fic,
          payment_account_id_fic = EXCLUDED.payment_account_id_fic, vat_ids_fic = EXCLUDED.vat_ids_fic,
          dicitura_footer = EXCLUDED.dicitura_footer,
          spese_documentazione_cent = EXCLUDED.spese_documentazione_cent,
          scope_scrittura_ok = EXCLUDED.scope_scrittura_ok,
          scope_verificato_at = EXCLUDED.scope_verificato_at, updated_at = EXCLUDED.updated_at
        RETURNING *`;
      return rowToConfig(rows[0]);
    },

    async crea({ fattura: f, righe, riepilogo, scadenze, now }) {
      await ensureSchema();
      return sql.begin(async tx => {
        const rows = await tx`INSERT INTO fatture (
            sede_id, commessa_id, computo_id, hash_righe, tipo, nota_credito_di, stato,
            fic_document_id, numero, data, cliente_snapshot, pattuito_tipo, pattuito_cent,
            imponibile_cent, iva_cent, totale_cent, delta_pattuito_cent, markup_cent, storno_cent,
            diciture, note, intestazione_cantiere, detrazione_tipo,
            pdf_storage_key, xml_storage_key, xml_sha256, documento_id,
            ei_status_fic, ei_errore, inviata_dry_run, scavalco_limiti, scavalco_motivo,
            created_by, emessa_da, emessa_at, revisione, created_at, updated_at
          ) VALUES (
            ${f.sedeId}, ${f.commessaId}, ${f.computoId}, ${f.hashRighe}, ${f.tipo}, ${f.notaCreditoDi}, ${f.stato},
            ${f.ficDocumentId}, ${f.numero}, ${f.data},
            ${f.clienteSnapshot == null ? null : tx.json(f.clienteSnapshot as any)},
            ${f.pattuitoTipo}, ${f.pattuitoCent},
            ${f.imponibileCent}, ${f.ivaCent}, ${f.totaleCent}, ${f.deltaPattuitoCent}, ${f.markupCent}, ${f.stornoCent},
            ${tx.json(f.diciture as any)}, ${f.note}, ${f.intestazioneCantiere}, ${f.detrazioneTipo},
            ${f.pdfStorageKey}, ${f.xmlStorageKey}, ${f.xmlSha256}, ${f.documentoId},
            ${f.eiStatusFic}, ${f.eiErrore}, ${f.inviataDryRun}, ${f.scavalcoLimiti}, ${f.scavalcoMotivo},
            ${f.createdBy}, ${f.emessaDa}, ${f.emessaAt}, 1, ${now}, ${now}
          ) RETURNING *`;
        const id = Number(rows[0].id);
        // Una fattura nuova non ha scadenze precedenti da conservare.
        const figli = await inserisciFigli(tx, id, righe, riepilogo, scadenze, []);
        // Task 17: nessuna query in più, `f` è l'input già in mano.
        toccaFattureCommessa(f.sedeId, f.commessaId);
        return rowToFattura(rows[0], figli.righe, figli.riepilogo, figli.scadenze);
      });
    },

    async perId(sedeId, id) {
      await ensureSchema();
      const rows = await sql`SELECT * FROM fatture WHERE id = ${id} AND sede_id = ${sedeId}`;
      if (!rows[0]) return null;
      const figli = await caricaFigli(id);
      return rowToFattura(rows[0], figli.righe, figli.riepilogo, figli.scadenze);
    },
    async perCommessa(sedeId, commessaId) {
      await ensureSchema();
      const rows = await sql`SELECT * FROM fatture
        WHERE sede_id = ${sedeId} AND commessa_id = ${commessaId}
        ORDER BY id DESC`;
      if (rows.length === 0) return [];
      const ids = rows.map(r => Number(r.id));
      // Tre query in blocco (WHERE fattura_id = ANY(...)), non una per
      // fattura: una commessa con anni di fatture non deve pagare N round
      // trip per rileggere la sua storia.
      const [righe, riepilogo, scadenze] = await Promise.all([
        sql`SELECT * FROM fattura_righe WHERE fattura_id = ANY(${ids}::bigint[]) ORDER BY ordine, id`,
        sql`SELECT * FROM fattura_riepilogo_iva WHERE fattura_id = ANY(${ids}::bigint[]) ORDER BY aliquota DESC`,
        sql`SELECT * FROM fattura_scadenze WHERE fattura_id = ANY(${ids}::bigint[]) ORDER BY numero, id`,
      ]);
      const righePer = raggruppaPer(righe, rowToRiga);
      const riepilogoPer = raggruppaPer(riepilogo, rowToRiepilogo);
      const scadenzePer = raggruppaPer(scadenze, rowToScadenza);
      return rows.map(row => {
        const id = Number(row.id);
        return rowToFattura(row, righePer.get(id) ?? [], riepilogoPer.get(id) ?? [], scadenzePer.get(id) ?? []);
      });
    },
    async perFicDocumentId(sedeId, ficDocumentId) {
      await ensureSchema();
      const rows = await sql`SELECT * FROM fatture
        WHERE sede_id = ${sedeId} AND fic_document_id = ${ficDocumentId} LIMIT 1`;
      if (!rows[0]) return null;
      const figli = await caricaFigli(Number(rows[0].id));
      return rowToFattura(rows[0], figli.righe, figli.riepilogo, figli.scadenze);
    },
    async lista({ sedeId, stati, tipo, limite }) {
      await ensureSchema();
      const statiFiltro = stati ?? [];
      // Una sola query su `fatture`, nessun join alle righe: le liste non
      // le mostrano, e leggerle per ogni riga sarebbe uno spreco puro.
      const rows = await sql`SELECT * FROM fatture
        WHERE sede_id = ${sedeId}
          AND (${statiFiltro.length === 0} OR stato IN ${sql(statiFiltro)})
          AND (${tipo === undefined} OR tipo = ${tipo ?? null})
        ORDER BY id DESC
        LIMIT ${limite ?? 200}`;
      return rows.map(row => rowToFattura(row, [], [], []));
    },
    async daSondare() {
      await ensureSchema();
      const rows = await sql`SELECT id, sede_id, fic_document_id, stato, inviata_dry_run FROM fatture
        WHERE fic_document_id IS NOT NULL
          AND (stato = 'inviata' OR (stato = 'emessa' AND inviata_dry_run))`;
      return rows.map(row => ({
        id: Number(row.id),
        sedeId: Number(row.sede_id),
        ficDocumentId: row.fic_document_id == null ? null : Number(row.fic_document_id),
        stato: row.stato as StatoFattura,
        inviataDryRun: Boolean(row.inviata_dry_run),
      }));
    },

    async aggiornaBozza({ sedeId, id, revisioneAttesa, patch, righe, riepilogo, scadenze, now }) {
      await ensureSchema();
      return sql.begin(async tx => {
        // FOR UPDATE dall'inizio della transazione (Ruling R7): il merge
        // campo per campo qui sotto legge lo stato corrente e lo riscrive,
        // e `aggiornaStato` non tocca `revisione` — senza il lock di riga
        // una modifica di stato concorrente verrebbe persa fra la lettura
        // e l'UPDATE, che il confronto ottimistico non intercetterebbe.
        const correnti = await tx`SELECT * FROM fatture WHERE id = ${id} AND sede_id = ${sedeId} FOR UPDATE`;
        if (!correnti[0]) throw new Error("NOT_FOUND: Fattura non trovata.");
        const corrente = rowToFatturaParziale(correnti[0]);

        // Merge esplicito campo per campo (non uno spread): `patch` è
        // Partial, e uno spread `{...corrente, ...patch}` farebbe perdere
        // a TypeScript la certezza che il risultato non è mai `undefined`
        // (che postgres-js non accetta come parametro). Una chiave assente
        // da `patch` lascia il valore corrente; una chiave presente (anche
        // con valore `null`) lo sovrascrive.
        const diciture = patch.diciture === undefined ? corrente.diciture : patch.diciture;
        const note = patch.note === undefined ? corrente.note : patch.note;
        const intestazioneCantiere =
          patch.intestazioneCantiere === undefined ? corrente.intestazioneCantiere : patch.intestazioneCantiere;
        const imponibileCent = patch.imponibileCent === undefined ? corrente.imponibileCent : patch.imponibileCent;
        const ivaCent = patch.ivaCent === undefined ? corrente.ivaCent : patch.ivaCent;
        const totaleCent = patch.totaleCent === undefined ? corrente.totaleCent : patch.totaleCent;
        const deltaPattuitoCent =
          patch.deltaPattuitoCent === undefined ? corrente.deltaPattuitoCent : patch.deltaPattuitoCent;
        const markupCent = patch.markupCent === undefined ? corrente.markupCent : patch.markupCent;
        const stornoCent = patch.stornoCent === undefined ? corrente.stornoCent : patch.stornoCent;
        const computoId = patch.computoId === undefined ? corrente.computoId : patch.computoId;
        const hashRighe = patch.hashRighe === undefined ? corrente.hashRighe : patch.hashRighe;
        const scavalcoLimiti = patch.scavalcoLimiti === undefined ? corrente.scavalcoLimiti : patch.scavalcoLimiti;
        const scavalcoMotivo = patch.scavalcoMotivo === undefined ? corrente.scavalcoMotivo : patch.scavalcoMotivo;
        const pattuitoCent = patch.pattuitoCent === undefined ? corrente.pattuitoCent : patch.pattuitoCent;
        const pattuitoTipo = patch.pattuitoTipo === undefined ? corrente.pattuitoTipo : patch.pattuitoTipo;
        const detrazioneTipo = patch.detrazioneTipo === undefined ? corrente.detrazioneTipo : patch.detrazioneTipo;
        const clienteSnapshot =
          patch.clienteSnapshot === undefined ? corrente.clienteSnapshot : patch.clienteSnapshot;

        const rows = await tx`UPDATE fatture SET
            diciture = ${tx.json(diciture as any)}, note = ${note}, intestazione_cantiere = ${intestazioneCantiere},
            imponibile_cent = ${imponibileCent}, iva_cent = ${ivaCent}, totale_cent = ${totaleCent},
            delta_pattuito_cent = ${deltaPattuitoCent}, markup_cent = ${markupCent}, storno_cent = ${stornoCent},
            computo_id = ${computoId}, hash_righe = ${hashRighe}, scavalco_limiti = ${scavalcoLimiti},
            scavalco_motivo = ${scavalcoMotivo}, pattuito_cent = ${pattuitoCent}, pattuito_tipo = ${pattuitoTipo},
            detrazione_tipo = ${detrazioneTipo},
            cliente_snapshot = ${clienteSnapshot == null ? null : tx.json(clienteSnapshot as any)},
            revisione = revisione + 1, updated_at = ${now}
          WHERE id = ${id} AND sede_id = ${sedeId} AND revisione = ${revisioneAttesa}
          RETURNING *`;
        if (!rows[0]) {
          throw new Error("CONFLITTO: la fattura è stata modificata da un'altra sessione, ricarica.");
        }

        // Le scadenze già collegate a un pagamento FiC (o già segnate
        // pagata/stornata) conservano quello stato attraverso la
        // sostituzione: si legge PRIMA di cancellare, si riapplica DOPO
        // aver inserito le nuove righe, appaiate per `numero`.
        const precedentiRows = await tx`SELECT * FROM fattura_scadenze WHERE fattura_id = ${id}`;
        const precedenti = precedentiRows.map(rowToScadenza);

        await tx`DELETE FROM fattura_righe WHERE fattura_id = ${id}`;
        await tx`DELETE FROM fattura_riepilogo_iva WHERE fattura_id = ${id}`;
        await tx`DELETE FROM fattura_scadenze WHERE fattura_id = ${id}`;

        const figli = await inserisciFigli(tx, id, righe, riepilogo, scadenze, precedenti);
        // Task 17: `commessa_id` è già nella riga tornata dalla UPDATE
        // sopra, nessuna query in più.
        toccaFattureCommessa(sedeId, Number(rows[0].commessa_id));
        return rowToFattura(rows[0], figli.righe, figli.riepilogo, figli.scadenze);
      });
    },

    async aggiornaStato({ sedeId, id, patch, atteso, now }) {
      await ensureSchema();
      return sql.begin(async tx => {
        // FOR UPDATE blocca la riga per la durata della transazione: un
        // aggiornaStato/aggiornaScadenza concorrente sulla stessa fattura
        // (tipicamente il poller SdI e un'azione utente, R6) aspetta
        // invece di leggere uno stato che questa scrittura sta per
        // superare.
        const correnti = await tx`SELECT id FROM fatture WHERE id = ${id} AND sede_id = ${sedeId} FOR UPDATE`;
        if (!correnti[0]) throw new Error("NOT_FOUND: Fattura non trovata.");

        // SET solo sulle colonne presenti in patch (chiave con valore
        // diverso da `undefined`): un patch vuoto tocca solo updated_at.
        // Il FOR UPDATE da solo non basterebbe: un merge "leggi la riga,
        // riscrivi ogni colonna" — anche dentro la stessa transazione —
        // farebbe comunque perdere la scrittura di un'altra transazione
        // già committata su una colonna che QUESTO patch non nomina,
        // perché la riscriverebbe con un valore ormai superato. Con il
        // SET dinamico, una colonna assente da patch non viene proprio
        // nominata nella query: non può sovrascrivere niente.
        const colonne: Record<string, any> = { updated_at: now };
        if (patch.stato !== undefined) colonne.stato = patch.stato;
        if (patch.ficDocumentId !== undefined) colonne.fic_document_id = patch.ficDocumentId;
        if (patch.numero !== undefined) colonne.numero = patch.numero;
        if (patch.data !== undefined) colonne.data = patch.data;
        if (patch.clienteSnapshot !== undefined) {
          colonne.cliente_snapshot = patch.clienteSnapshot == null ? null : tx.json(patch.clienteSnapshot as any);
        }
        if (patch.pdfStorageKey !== undefined) colonne.pdf_storage_key = patch.pdfStorageKey;
        if (patch.xmlStorageKey !== undefined) colonne.xml_storage_key = patch.xmlStorageKey;
        if (patch.xmlSha256 !== undefined) colonne.xml_sha256 = patch.xmlSha256;
        if (patch.documentoId !== undefined) colonne.documento_id = patch.documentoId;
        if (patch.eiStatusFic !== undefined) colonne.ei_status_fic = patch.eiStatusFic;
        if (patch.eiErrore !== undefined) colonne.ei_errore = patch.eiErrore;
        if (patch.inviataDryRun !== undefined) colonne.inviata_dry_run = patch.inviataDryRun;
        if (patch.emessaDa !== undefined) colonne.emessa_da = patch.emessaDa;
        if (patch.emessaAt !== undefined) colonne.emessa_at = patch.emessaAt;
        if (patch.imponibileCent !== undefined) colonne.imponibile_cent = patch.imponibileCent;
        if (patch.ivaCent !== undefined) colonne.iva_cent = patch.ivaCent;
        if (patch.totaleCent !== undefined) colonne.totale_cent = patch.totaleCent;
        // Con il CAS la revisione la scrive la clausola dedicata qui
        // sotto (`revisione = revisione + 1`): nominarla due volte nello
        // stesso SET sarebbe un errore SQL, e comunque il lease vince.
        if (patch.revisione !== undefined && !atteso) colonne.revisione = patch.revisione;

        // Compare-and-swap (Ruling R35): stato e revisione entrano nella
        // WHERE. Zero righe aggiornate significa che qualcun altro ha
        // già preso la fattura — la riga esiste (il FOR UPDATE sopra l'ha
        // trovata), quindi è un CONFLITTO, non un NOT_FOUND.
        const rows = atteso
          ? await tx`UPDATE fatture SET ${tx(colonne, ...Object.keys(colonne))}, revisione = revisione + 1
              WHERE id = ${id} AND sede_id = ${sedeId}
                AND stato = ${atteso.stato} AND revisione = ${atteso.revisione}
              RETURNING *`
          : await tx`UPDATE fatture SET ${tx(colonne, ...Object.keys(colonne))}
              WHERE id = ${id} AND sede_id = ${sedeId}
              RETURNING *`;
        if (!rows[0]) {
          throw new Error("CONFLITTO: la fattura è cambiata nel frattempo: ricarica.");
        }
        // Letture dentro la stessa transazione (tx, non sql): aggiornaStato
        // non tocca i figli, ma restano coerenti con lo snapshot della
        // riga appena scritta invece di aprire una connessione a parte.
        const [righeRows, riepilogoRows, scadenzeRows] = await Promise.all([
          tx`SELECT * FROM fattura_righe WHERE fattura_id = ${id} ORDER BY ordine, id`,
          tx`SELECT * FROM fattura_riepilogo_iva WHERE fattura_id = ${id} ORDER BY aliquota DESC`,
          tx`SELECT * FROM fattura_scadenze WHERE fattura_id = ${id} ORDER BY numero, id`,
        ]);
        // Task 17 (fix round 1: spostato qui, ultima istruzione prima del
        // return come nelle altre scritture): `commessa_id` è già nella
        // riga RETURNING, nessuna query in più — ma se una delle SELECT
        // sopra fallisse, meglio niente bump per una lettura mai arrivata
        // in fondo.
        toccaFattureCommessa(sedeId, Number(rows[0].commessa_id));
        return rowToFattura(
          rows[0],
          righeRows.map(rowToRiga),
          riepilogoRows.map(rowToRiepilogo),
          scadenzeRows.map(rowToScadenza)
        );
      });
    },
    async aggiornaScadenza({ sedeId, fatturaId, numero, patch }) {
      await ensureSchema();
      return sql.begin(async tx => {
        // `commessa_id` in più nella stessa SELECT (Task 17): nessuna
        // query aggiunta, serve solo per toccare la versione a fine
        // metodo se la scrittura sotto avviene davvero.
        const fatturaRows = await tx`SELECT id, commessa_id FROM fatture WHERE id = ${fatturaId} AND sede_id = ${sedeId}`;
        if (!fatturaRows[0]) throw new Error("NOT_FOUND: Fattura non trovata.");
        // FOR UPDATE sulla riga che stiamo per patchare (non su `fatture`,
        // qui solo un controllo di appartenenza): un webhook di pagamento
        // FiC e un'altra scrittura sulla stessa scadenza si serializzano
        // invece di correre, stesso R6 di aggiornaStato.
        const scadenzaRows = await tx`SELECT id FROM fattura_scadenze
          WHERE fattura_id = ${fatturaId} AND numero = ${numero} FOR UPDATE`;
        if (!scadenzaRows[0]) return;

        const colonne: Record<string, any> = {};
        if (patch.ficPaymentId !== undefined) colonne.fic_payment_id = patch.ficPaymentId;
        if (patch.stato !== undefined) colonne.stato = patch.stato;
        if (Object.keys(colonne).length === 0) return;

        await tx`UPDATE fattura_scadenze SET ${tx(colonne, ...Object.keys(colonne))}
          WHERE fattura_id = ${fatturaId} AND numero = ${numero}`;
        toccaFattureCommessa(sedeId, Number(fatturaRows[0].commessa_id));
      });
    },
    // Non verifica che `fatturaId` appartenga davvero a `sedeId` (nessun
    // JOIN/EXISTS su `fatture`): chi chiama (il servizio, Task 6) ha già
    // in mano la fattura corretta. `eventi()` filtra su entrambe le
    // colonne in lettura, ma un chiamante malformato può comunque
    // scrivere un evento "orfano" qui — la garanzia non è di questo
    // metodo.
    async appendEvento(e) {
      await ensureSchema();
      const createdAt = e.createdAt ?? new Date();
      // Task 17: un solo giro (CTE + LEFT JOIN), non un INSERT più una
      // SELECT — l'evento è la scrittura più frequente della pipeline di
      // emissione e raddoppiarne i round trip si sentirebbe. `fattura_id`
      // esiste SEMPRE in `fatture` (FK NOT NULL: l'INSERT fallirebbe
      // altrimenti), quindi il LEFT JOIN (non un JOIN secco) non serve a
      // quel caso, ma a quello — fix round 1 — di un `sedeId` che non è
      // davvero quello della fattura (il "chiamante malformato" del
      // commento sopra `eventi()`): il join in più su `f.sede_id =
      // ins.sede_id` non trova riga, l'evento viene comunque inserito e
      // restituito, solo senza `evento_commessa_id` (niente bump: non si
      // sa quale commessa toccare).
      const rows = await sql`
        WITH ins AS (
          INSERT INTO fattura_eventi (fattura_id, sede_id, tipo, payload, actor_user_id, created_at)
          VALUES (${e.fatturaId}, ${e.sedeId}, ${e.tipo}, ${sql.json(e.payload as any)}, ${e.actorUserId}, ${createdAt})
          RETURNING *
        )
        SELECT ins.*, f.commessa_id AS evento_commessa_id
        FROM ins LEFT JOIN fatture f ON f.id = ins.fattura_id AND f.sede_id = ins.sede_id`;
      const row = rows[0];
      if (row.evento_commessa_id != null) {
        toccaFattureCommessa(e.sedeId, Number(row.evento_commessa_id));
      }
      return rowToEvento(row);
    },
    async eventi(sedeId, fatturaId) {
      await ensureSchema();
      const rows = await sql`SELECT * FROM fattura_eventi
        WHERE sede_id = ${sedeId} AND fattura_id = ${fatturaId}
        ORDER BY id`;
      return rows.map(rowToEvento);
    },
  };
}

let singleton: FattureRepository | null = null;
export function getFattureRepository(): FattureRepository {
  singleton ??= kvSql ? createPostgresFattureRepository(kvSql) : createMemoryFattureRepository();
  return singleton;
}

/** Solo test: ripristina il repository (memoria o singleton) tra una suite e l'altra. */
export function _resetFattureRepositoryForTests(): void {
  singleton = null;
}
