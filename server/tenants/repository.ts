// Control plane del tenant: tabelle relazionali con `ensureSchema()` a mano
// (come authz/repository.ts), variante Postgres e in memoria. QUESTO è
// l'unico file che scrive `tenants`, `tenant_eventi`, `tenant_comandi`
// (guardia strutturale in confine.test.ts). La cache dei tenant vive qui:
// una replica sola, aggiornata da ogni scrittura.
import { createHash, randomBytes } from "node:crypto";
import { kvSql } from "../_core/persistence";
import {
  MESSAGGI,
  QUOTA_STORAGE_PREDEFINITA_BYTES,
  TENANT_PREDEFINITO_ID,
  TENANT_PREDEFINITO_NOME,
  TENANT_PREDEFINITO_SLUG,
  TTL_INVITO_MS,
  TTL_STATE_OAUTH_MS,
} from "./costanti";
import type {
  Abbonamento,
  StateOAuth,
  StatoStorage,
  StatoTenant,
  TenantComando,
  TenantEvento,
  TenantInvito,
  TenantRecord,
  TipoComando,
  TipoEvento,
  TipoInvito,
  TipoStateOAuth,
} from "./tipi";

export type EsitoComando = Record<string, unknown>;

export type TenantRepository = {
  ensureSchema(): Promise<void>;
  caricaCache(): Promise<void>;
  tutti(): TenantRecord[];
  perId(id: number): TenantRecord | null;
  perSlug(slug: string): TenantRecord | null;
  inserisci(input: { slug: string; nome: string; stato?: StatoTenant; id?: number }): Promise<TenantRecord>;
  aggiornaStato(id: number, stato: StatoTenant, motivo: string | null): Promise<TenantRecord>;
  registraEvento(evento: {
    tenantId: number;
    tipo: TipoEvento;
    attore: string;
    motivo?: string | null;
    dettagli?: Record<string, unknown> | null;
  }): Promise<TenantEvento>;
  /**
   * Gli eventi dell'azienda, dal più vecchio al più recente. `ultimi`
   * riporta SOLO gli ultimi n, sempre in ordine crescente: `pnpm tenant
   * elenco` deve vedere i worker sospesi di adesso, non scaricare la
   * cronologia intera di un'azienda con anni di soglie ed eventi alle
   * spalle. Senza `ultimi` il comportamento è quello di sempre (tutti).
   */
  eventi(tenantId: number, opzioni?: { ultimi?: number }): Promise<TenantEvento[]>;
  /**
   * Tutte le aziende in una query sola, filtrati per tipo e finestra di
   * tempo: il pannello piattaforma (WS6) legge così i worker sospesi di
   * adesso, senza un giro per tenant.
   */
  eventiRecenti(input: { tipi: TipoEvento[]; da: Date }): Promise<TenantEvento[]>;
  accodaComando(input: {
    tipo: TipoComando;
    tenantId: number | null;
    payload: Record<string, unknown>;
    richiestoDa: string;
  }): Promise<TenantComando>;
  comandiInAttesa(): Promise<TenantComando[]>;
  comando(id: number): Promise<TenantComando | null>;
  /** Gli ultimi comandi dell'azienda, più recenti prima (scheda del pannello piattaforma, WS6). */
  comandiDi(tenantId: number, opzioni?: { ultimi?: number }): Promise<TenantComando[]>;
  /**
   * Prende il comando in attesa più vecchio e lo esegue dentro lo stesso
   * lock atomico (`FOR UPDATE SKIP LOCKED` su Postgres). Con `soloId`
   * (pannello piattaforma, WS6: esecuzione immediata dopo l'accodo) prende
   * SOLO quel comando — se il giro dei 30 s lo ha già preso, dà `"nessuno"`
   * invece di aspettare o di prenderne un altro al suo posto.
   */
  prendiEdEsegui(
    esegui: (comando: TenantComando) => Promise<EsitoComando>,
    opzioni?: { soloId?: number }
  ): Promise<"eseguito" | "errore" | "nessuno">;
  /**
   * `INSERT … ON CONFLICT (id) DO NOTHING` sulla riga `tenants` del tenant 1
   * (+ allineamento sequenza): additiva e idempotente. `preparaTenants()` la
   * chiama SEMPRE, anche a interruttore spento (Task 12 fix round 1, Ruling
   * R13): la riga è control plane e inerte finché il flag resta spento
   * (nessuna lettura di dominio la consulta), ma senza di essa lo specchio
   * `tenant_sedi` e il backfill di `tenant_id` non potrebbero avvenire nel
   * deploy spento (spec §7.1, §8).
   */
  assicuraTenantPredefinito(): Promise<TenantRecord>;
  /**
   * Specchio sede → tenant (Task 12): lo legge il trigger `tenant_id` delle
   * tabelle per sede. Idempotente, una riga per sede; le sedi non elencate
   * restano come sono (nessuna cancellazione: una sede non sparisce).
   *
   * Una sede il cui tenant non esiste nel control plane viene SALTATA, non è
   * un errore: la riga del tenant 1 è sempre seminata da `preparaTenants`
   * (Ruling R13), ma un tenant ≥ 2 non lo è finché l'interruttore non si
   * accende e qualcuno lo crea. Fino ad allora una sua sede resta fuori dallo
   * specchio invece di far fallire il boot sulla chiave esterna. Appena
   * l'interruttore si accende, il boot semina il tenant e il giro successivo
   * riempie lo specchio; il backfill delle tabelle chiude i `tenant_id` NULL.
   */
  sincronizzaTenantSedi(
    righe: ReadonlyArray<{ sedeId: number; tenantId: number }>
  ): Promise<void>;
  tenantSedi(): Promise<Array<{ sedeId: number; tenantId: number }>>;

  // ── Contabilità storage (WS3 §3.2) ─────────────────────────────────────
  storageDi(tenantId: number): Promise<StatoStorage | null>;
  /** Tutte le aziende in una query sola (elenco del pannello piattaforma, WS6). */
  storageTutti(): Promise<StatoStorage[]>;
  /** Upsert, incremento atomico; `bytes`/`file` non scendono mai sotto zero. */
  aggiornaStorage(tenantId: number, deltaBytes: number, deltaFile: number): Promise<StatoStorage>;
  /** Ricalcolo da zero (sostituisce, non somma) e timbra `ricalcolatoIl`. */
  impostaStorage(tenantId: number, valori: { bytes: number; file: number }): Promise<StatoStorage>;
  impostaSogliaAvvisata(tenantId: number, soglia: 0 | 50 | 80 | 100): Promise<void>;
  impostaQuotaStorage(tenantId: number, quotaBytes: number): Promise<TenantRecord>;
  /**
   * Da quando la quota storage è al 100 % ininterrottamente (WS4, spec §6:
   * quota che blocca dopo la tolleranza). `null` la riarma (sotto il 100 %,
   * o appena il blocco viene tolto a mano).
   */
  impostaSoglia100Storage(tenantId: number, dal: Date | null): Promise<void>;

  // ── Abbonamenti (WS4 §3) ────────────────────────────────────────────────
  /** Dalla cache in memoria, caricata da `caricaCache` (come `perId`). */
  abbonamentoDi(tenantId: number): Abbonamento | null;
  abbonamenti(): Abbonamento[];
  /** Upsert intero sulla riga: `updated_at = NOW()`, `created_at` invariato. */
  salvaAbbonamento(abbonamento: Abbonamento): Promise<Abbonamento>;

  // ── `state` OAuth (WS3 §5) ──────────────────────────────────────────────
  emettiStateOAuth(input: {
    tipo: TipoStateOAuth;
    tenantId: number;
    sedeId: number | null;
    utenteId: number;
    payload: Record<string, unknown>;
  }): Promise<string>;
  /** Consumo una tantum entro il TTL: la seconda chiamata restituisce `null`. */
  consumaStateOAuth(state: string, tipo: TipoStateOAuth): Promise<StateOAuth | null>;
  pulisciStateScaduti(): Promise<number>;

  // ── Inviti (WS6 §4) ──────────────────────────────────────────────────────
  /**
   * Emette un token monouso per completare la creazione di un'azienda:
   * annulla prima ogni invito ancora valido dello stesso utente sullo stesso
   * tenant (`annullatoIl = adesso`), poi ne inserisce uno nuovo. Il token in
   * chiaro esce SOLO da qui: a terra resta l'hash sha256.
   */
  emettiInvito(input: {
    tenantId: number;
    utenteId: number;
    email: string;
    tipo: TipoInvito;
    creatoDa: string;
    adesso?: Date;
  }): Promise<{ invito: TenantInvito; token: string }>;
  /** Valido: non usato, non annullato, non scaduto. Non lo consuma. */
  invitoPerToken(token: string, adesso?: Date): Promise<TenantInvito | null>;
  /** Consumo una tantum: la seconda chiamata (o un invito scaduto/annullato) dà `null`. */
  consumaInvito(token: string, adesso?: Date): Promise<TenantInvito | null>;
  /** Gli inviti dell'azienda, più recenti prima. */
  invitiDi(tenantId: number): Promise<TenantInvito[]>;
  /** Solo se non ancora usato; idempotente (un invito già annullato lo resta). */
  annullaInvito(id: number): Promise<TenantInvito | null>;
  /** Cancella gli inviti scaduti da più di 30 giorni; al boot, come `pulisciStateScaduti`. */
  pulisciInvitiScaduti(): Promise<number>;
};

const clone = <T>(v: T): T => structuredClone(v);

function messaggioErrore(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Il payload di un comando `crea` porta `proprietario.passwordHash` (un hash
 * scrypt, non la password in chiaro, ma pur sempre un segreto): lo togliamo
 * alla chiusura del comando — eseguito o in errore — così `tenant_comandi`
 * non lo conserva a tempo indeterminato dopo che è servito.
 */
function payloadSenzaSegreti(p: Record<string, unknown>): Record<string, unknown> {
  const copia = structuredClone(p);
  if (copia.proprietario && typeof copia.proprietario === "object") {
    delete (copia.proprietario as any).passwordHash;
  }
  return copia;
}

/**
 * Inviti (WS6 §4.1): il token in chiaro non tocca mai terra, solo il suo
 * hash sha256 esadecimale — stesso algoritmo in memoria e su Postgres, così
 * un token emesso da un repository è verificabile dall'altro (utile solo in
 * teoria, ma tiene le due implementazioni onestamente equivalenti).
 */
const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

/** Valido: non usato, non annullato, non scaduto rispetto ad `adesso`. */
const invitoValido = (
  i: { usatoIl: Date | null; annullatoIl: Date | null; scadeIl: Date },
  adesso: Date
): boolean => !i.usatoIl && !i.annullatoIl && i.scadeIl.getTime() > adesso.getTime();

// ── Memoria (sviluppo e test senza DATABASE_URL) ────────────────────────────

function createMemoryTenantRepository(): TenantRepository {
  const tenants: TenantRecord[] = [];
  const eventi: TenantEvento[] = [];
  const comandi: TenantComando[] = [];
  const sedi = new Map<number, number>(); // sedeId → tenantId
  const storage = new Map<number, StatoStorage>();
  const states = new Map<string, StateOAuth & { consumatoIl: Date | null }>();
  let prossimoTenant = 1;
  let prossimoEvento = 1;
  let prossimoComando = 1;

  // La quota vive su `tenants`, non sulla riga di `storage`: rileggerla ad
  // ogni accesso evita che `impostaQuotaStorage` e la riga storage divergano.
  const quotaDi = (tenantId: number) =>
    tenants.find(t => t.id === tenantId)?.storageQuotaBytes ?? QUOTA_STORAGE_PREDEFINITA_BYTES;
  const rigaStorage = (tenantId: number): StatoStorage => {
    let s = storage.get(tenantId);
    if (!s) {
      s = { tenantId, bytes: 0, file: 0, quotaBytes: quotaDi(tenantId), sogliaAvvisata: 0, ricalcolatoIl: null, aggiornatoIl: new Date(), soglia100Dal: null };
      storage.set(tenantId, s);
    }
    s.quotaBytes = quotaDi(tenantId);
    return s;
  };
  const abbonamentiMem = new Map<number, Abbonamento>();
  const inviti: Array<TenantInvito & { tokenHash: string }> = [];
  let prossimoInvito = 1;
  /** Non lascia mai uscire `tokenHash`: stessa forma di lettura di Postgres. */
  const senzaHash = (i: TenantInvito & { tokenHash: string }): TenantInvito => {
    const { tokenHash: _tokenHash, ...resto } = i;
    return clone(resto);
  };

  const repo: TenantRepository = {
    async ensureSchema() {},
    async caricaCache() {},
    tutti: () => tenants.map(clone),
    perId: id => clone(tenants.find(t => t.id === id) ?? null),
    perSlug: slug => clone(tenants.find(t => t.slug === slug) ?? null),
    async inserisci(input) {
      if (tenants.some(t => t.slug === input.slug)) {
        throw new Error(`slug già usato: ${input.slug}`);
      }
      const id = input.id ?? prossimoTenant;
      if (tenants.some(t => t.id === id)) throw new Error(`id già usato: ${id}`);
      prossimoTenant = Math.max(prossimoTenant, id + 1);
      const now = new Date();
      const t: TenantRecord = {
        id,
        slug: input.slug,
        nome: input.nome,
        stato: input.stato ?? "attivo",
        motivoStato: null,
        createdAt: now,
        updatedAt: now,
        storageQuotaBytes: QUOTA_STORAGE_PREDEFINITA_BYTES,
      };
      tenants.push(t);
      return clone(t);
    },
    async aggiornaStato(id, stato, motivo) {
      const t = tenants.find(x => x.id === id);
      if (!t) throw new Error(`tenant ${id} inesistente`);
      t.stato = stato;
      t.motivoStato = motivo;
      t.updatedAt = new Date();
      return clone(t);
    },
    async registraEvento(e) {
      const ev: TenantEvento = {
        id: prossimoEvento++,
        tenantId: e.tenantId,
        tipo: e.tipo,
        attore: e.attore,
        motivo: e.motivo ?? null,
        dettagli: e.dettagli ? clone(e.dettagli) : null,
        createdAt: new Date(),
      };
      eventi.push(ev);
      return clone(ev);
    },
    async eventi(tenantId, opzioni) {
      const suoi = eventi.filter(e => e.tenantId === tenantId);
      const ultimi = opzioni?.ultimi;
      // `ultimi` ≤ 0 vale «tutti», come su Postgres (dove LIMIT 0 darebbe zero righe).
      return (ultimi != null && ultimi > 0 && ultimi < suoi.length ? suoi.slice(-ultimi) : suoi).map(clone);
    },
    async eventiRecenti(input) {
      const tipi = new Set(input.tipi);
      return eventi.filter(e => tipi.has(e.tipo) && e.createdAt.getTime() >= input.da.getTime()).map(clone);
    },
    async accodaComando(input) {
      const c: TenantComando = {
        id: prossimoComando++,
        tipo: input.tipo,
        tenantId: input.tenantId,
        payload: clone(input.payload),
        stato: "in_attesa",
        esito: null,
        richiestoDa: input.richiestoDa,
        createdAt: new Date(),
        eseguitoAt: null,
      };
      comandi.push(c);
      return clone(c);
    },
    async comandiInAttesa() {
      return comandi.filter(c => c.stato === "in_attesa").map(clone);
    },
    async comando(id) {
      return clone(comandi.find(c => c.id === id) ?? null);
    },
    async comandiDi(tenantId, opzioni) {
      const suoi = comandi.filter(c => c.tenantId === tenantId).sort((a, b) => b.id - a.id);
      const ultimi = opzioni?.ultimi;
      return (ultimi != null && ultimi > 0 ? suoi.slice(0, ultimi) : suoi).map(clone);
    },
    async prendiEdEsegui(esegui, opzioni) {
      const c = comandi.find(x => x.stato === "in_attesa" && (opzioni?.soloId == null || x.id === opzioni.soloId));
      if (!c) return "nessuno";
      try {
        c.esito = await esegui(clone(c));
        c.stato = "eseguito";
      } catch (e) {
        c.esito = { errore: messaggioErrore(e) };
        c.stato = "errore";
      }
      c.eseguitoAt = new Date();
      c.payload = payloadSenzaSegreti(c.payload);
      return c.stato;
    },
    async assicuraTenantPredefinito() {
      const esistente = tenants.find(t => t.id === TENANT_PREDEFINITO_ID);
      if (esistente) return clone(esistente);
      return repo.inserisci({
        id: TENANT_PREDEFINITO_ID,
        slug: TENANT_PREDEFINITO_SLUG,
        nome: TENANT_PREDEFINITO_NOME,
      });
    },
    async sincronizzaTenantSedi(righe) {
      // Stessa regola della chiave esterna su Postgres: un tenant che non
      // esiste non entra nello specchio.
      for (const r of righe) {
        if (tenants.some(t => t.id === r.tenantId)) sedi.set(r.sedeId, r.tenantId);
      }
    },
    async tenantSedi() {
      return [...sedi.entries()]
        .map(([sedeId, tenantId]) => ({ sedeId, tenantId }))
        .sort((a, b) => a.sedeId - b.sedeId);
    },
    async storageDi(tenantId) {
      const s = storage.get(tenantId);
      return s ? clone({ ...s, quotaBytes: quotaDi(tenantId) }) : null;
    },
    async storageTutti() {
      return [...storage.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([tenantId, s]) => clone({ ...s, quotaBytes: quotaDi(tenantId) }));
    },
    async aggiornaStorage(tenantId, deltaBytes, deltaFile) {
      const s = rigaStorage(tenantId);
      s.bytes = Math.max(0, s.bytes + deltaBytes);
      s.file = Math.max(0, s.file + deltaFile);
      s.aggiornatoIl = new Date();
      return clone(s);
    },
    async impostaStorage(tenantId, valori) {
      const s = rigaStorage(tenantId);
      s.bytes = Math.max(0, valori.bytes);
      s.file = Math.max(0, valori.file);
      s.ricalcolatoIl = new Date();
      s.aggiornatoIl = s.ricalcolatoIl;
      return clone(s);
    },
    async impostaSogliaAvvisata(tenantId, soglia) {
      rigaStorage(tenantId).sogliaAvvisata = soglia;
    },
    async impostaQuotaStorage(tenantId, quotaBytes) {
      const t = tenants.find(x => x.id === tenantId);
      if (!t) throw new Error(`tenant ${tenantId} inesistente`);
      t.storageQuotaBytes = quotaBytes;
      t.updatedAt = new Date();
      return clone(t);
    },
    async impostaSoglia100Storage(tenantId, dal) {
      rigaStorage(tenantId).soglia100Dal = dal;
    },
    abbonamentoDi: id => clone(abbonamentiMem.get(id) ?? null),
    abbonamenti: () => [...abbonamentiMem.values()].sort((a, b) => a.tenantId - b.tenantId).map(clone),
    async salvaAbbonamento(a) {
      if (!tenants.some(t => t.id === a.tenantId)) throw new Error(`tenant ${a.tenantId} inesistente`);
      const salvato: Abbonamento = {
        ...clone(a),
        createdAt: abbonamentiMem.get(a.tenantId)?.createdAt ?? a.createdAt,
        updatedAt: new Date(),
      };
      abbonamentiMem.set(a.tenantId, salvato);
      return clone(salvato);
    },
    async emettiStateOAuth(input) {
      const state = randomBytes(24).toString("base64url");
      states.set(state, { state, ...input, payload: clone(input.payload), scadeIl: new Date(Date.now() + TTL_STATE_OAUTH_MS), consumatoIl: null });
      return state;
    },
    async consumaStateOAuth(state, tipo) {
      const s = states.get(state);
      if (!s || s.tipo !== tipo || s.consumatoIl || s.scadeIl.getTime() <= Date.now()) return null;
      s.consumatoIl = new Date();
      const { consumatoIl: _c, ...riga } = s;
      return clone(riga);
    },
    async pulisciStateScaduti() {
      let n = 0;
      for (const [k, s] of states) if (s.scadeIl.getTime() <= Date.now()) { states.delete(k); n++; }
      return n;
    },
    async emettiInvito(input) {
      const adesso = input.adesso ?? new Date();
      // Annulla prima ogni invito ancora valido dello stesso utente sullo
      // stesso tenant: un secondo invito rimpiazza il primo, non lo affianca.
      for (const i of inviti) {
        if (i.tenantId === input.tenantId && i.utenteId === input.utenteId && invitoValido(i, adesso)) {
          i.annullatoIl = adesso;
        }
      }
      const token = randomBytes(32).toString("base64url");
      const invito: TenantInvito & { tokenHash: string } = {
        id: prossimoInvito++,
        tenantId: input.tenantId,
        utenteId: input.utenteId,
        email: input.email.trim().toLowerCase(),
        tipo: input.tipo,
        scadeIl: new Date(adesso.getTime() + TTL_INVITO_MS),
        creatoDa: input.creatoDa,
        createdAt: adesso,
        usatoIl: null,
        annullatoIl: null,
        tokenHash: hashToken(token),
      };
      inviti.push(invito);
      return { invito: senzaHash(invito), token };
    },
    async invitoPerToken(token, adesso = new Date()) {
      const hash = hashToken(token);
      const i = inviti.find(x => x.tokenHash === hash);
      return i && invitoValido(i, adesso) ? senzaHash(i) : null;
    },
    async consumaInvito(token, adesso = new Date()) {
      const hash = hashToken(token);
      const i = inviti.find(x => x.tokenHash === hash);
      if (!i || !invitoValido(i, adesso)) return null;
      i.usatoIl = adesso;
      return senzaHash(i);
    },
    async invitiDi(tenantId) {
      return inviti
        .filter(i => i.tenantId === tenantId)
        .sort((a, b) => b.id - a.id)
        .map(senzaHash);
    },
    async annullaInvito(id) {
      const i = inviti.find(x => x.id === id);
      if (!i || i.usatoIl) return null;
      i.annullatoIl ??= new Date();
      return senzaHash(i);
    },
    async pulisciInvitiScaduti() {
      const limite = Date.now() - 30 * 24 * 3600 * 1000;
      const prima = inviti.length;
      for (let k = inviti.length - 1; k >= 0; k--) {
        if (inviti[k].scadeIl.getTime() <= limite) inviti.splice(k, 1);
      }
      return prima - inviti.length;
    },
  };
  return repo;
}

// ── Postgres ────────────────────────────────────────────────────────────────

export type OpzioniRepositoryPostgres = {
  /**
   * `false` per lo script `pnpm tenant`: nessun DDL, solo una sonda in sola
   * lettura che si ferma se le tabelle mancano (le crea il server al boot).
   */
  creaSchema?: boolean;
};

export function createPostgresTenantRepository(
  sql: NonNullable<typeof kvSql>,
  opzioni: OpzioniRepositoryPostgres = {}
): TenantRepository {
  const cache = new Map<number, TenantRecord>();
  const cacheAbbonamenti = new Map<number, Abbonamento>();
  let schemaPromise: Promise<void> | null = null;

  const rigaTenant = (r: any): TenantRecord => ({
    id: Number(r.id),
    slug: r.slug,
    nome: r.nome,
    stato: r.stato,
    motivoStato: r.motivo_stato ?? null,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
    // `storage_quota_bytes` è BIGINT: postgres-js lo restituisce come stringa.
    storageQuotaBytes: Number(r.storage_quota_bytes ?? QUOTA_STORAGE_PREDEFINITA_BYTES),
  });
  const rigaEvento = (r: any): TenantEvento => ({
    id: Number(r.id),
    tenantId: Number(r.tenant_id),
    tipo: r.tipo,
    attore: r.attore,
    motivo: r.motivo ?? null,
    dettagli: r.dettagli ?? null,
    createdAt: new Date(r.created_at),
  });
  const rigaComando = (r: any): TenantComando => ({
    id: Number(r.id),
    tipo: r.tipo,
    tenantId: r.tenant_id == null ? null : Number(r.tenant_id),
    payload: r.payload ?? {},
    stato: r.stato,
    esito: r.esito ?? null,
    richiestoDa: r.richiesto_da,
    createdAt: new Date(r.created_at),
    eseguitoAt: r.eseguito_at ? new Date(r.eseguito_at) : null,
  });
  const rigaStorage = (r: any, quotaBytes: number): StatoStorage => ({
    tenantId: Number(r.tenant_id),
    bytes: Number(r.bytes),
    file: Number(r.file),
    quotaBytes,
    sogliaAvvisata: Number(r.soglia_avvisata) as StatoStorage["sogliaAvvisata"],
    ricalcolatoIl: r.ricalcolato_il ? new Date(r.ricalcolato_il) : null,
    aggiornatoIl: new Date(r.aggiornato_il),
    soglia100Dal: r.soglia_100_dal ? new Date(r.soglia_100_dal) : null,
  });
  const rigaAbbonamento = (r: any): Abbonamento => ({
    tenantId: Number(r.tenant_id),
    tipo: r.tipo,
    periodicita: r.periodicita ?? null,
    stato: r.stato,
    inizioPeriodo: new Date(r.inizio_periodo),
    finePeriodo: r.fine_periodo ? new Date(r.fine_periodo) : null,
    prossimoRinnovo: r.prossimo_rinnovo ? new Date(r.prossimo_rinnovo) : null,
    disdettaAFinePeriodo: Boolean(r.disdetta_a_fine_periodo),
    budgetTarsNanoMese: r.budget_tars_nano_mese == null ? null : Number(r.budget_tars_nano_mese),
    extraTarsNano: Number(r.extra_tars_nano ?? 0),
    extraTarsMese: r.extra_tars_mese ?? null,
    tolleranzaStorageGiorni: Number(r.tolleranza_storage_giorni),
    tolleranzaTarsGiorni: Number(r.tolleranza_tars_giorni),
    tarsSogliaAvvisata: Number(r.tars_soglia_avvisata) as Abbonamento["tarsSogliaAvvisata"],
    tarsSogliaMese: r.tars_soglia_mese ?? null,
    tarsSoglia100Dal: r.tars_soglia_100_dal ? new Date(r.tars_soglia_100_dal) : null,
    insolutoDal: r.insoluto_dal ? new Date(r.insoluto_dal) : null,
    provider: r.provider ?? "nessuno",
    providerRef: r.provider_ref ?? null,
    omaggio: r.omaggio ?? null,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  });
  const rigaState = (r: any): StateOAuth => ({
    state: r.state,
    tipo: r.tipo,
    tenantId: Number(r.tenant_id),
    sedeId: r.sede_id == null ? null : Number(r.sede_id),
    utenteId: Number(r.utente_id),
    payload: r.payload ?? {},
    scadeIl: new Date(r.scade_il),
  });
  const rigaInvito = (r: any): TenantInvito => ({
    id: Number(r.id),
    tenantId: Number(r.tenant_id),
    utenteId: Number(r.utente_id),
    email: r.email,
    tipo: r.tipo,
    scadeIl: new Date(r.scade_il),
    creatoDa: r.creato_da,
    createdAt: new Date(r.created_at),
    usatoIl: r.usato_il ? new Date(r.usato_il) : null,
    annullatoIl: r.annullato_il ? new Date(r.annullato_il) : null,
  });
  const memorizza = (t: TenantRecord): TenantRecord => {
    cache.set(t.id, t);
    return clone(t);
  };
  const allineaSequenza = () =>
    sql`SELECT setval(pg_get_serial_sequence('tenants', 'id'), GREATEST((SELECT MAX(id) FROM tenants), 1))`;
  // La quota vive sulla cache dei tenant (già caricata da caricaCache/inserisci
  // /impostaQuotaStorage): niente una SELECT su `tenants` in più per ogni riga di storage.
  const quotaDi = (tenantId: number) => cache.get(tenantId)?.storageQuotaBytes ?? QUOTA_STORAGE_PREDEFINITA_BYTES;

  // Sonda in sola lettura (spec WS1 §6.3): `to_regclass` è NULL se la tabella manca.
  const verificaSchema = async (): Promise<void> => {
    const rows = await sql`SELECT to_regclass('tenants') AS tenants,
      to_regclass('tenant_eventi') AS eventi, to_regclass('tenant_comandi') AS comandi,
      to_regclass('tenant_sedi') AS sedi, to_regclass('tenant_storage') AS storage,
      to_regclass('oauth_state') AS oauth, to_regclass('abbonamenti') AS abbonamenti,
      to_regclass('tenant_inviti') AS inviti`;
    const r = rows[0];
    if (!r?.tenants || !r?.eventi || !r?.comandi || !r?.sedi || !r?.storage || !r?.oauth || !r?.abbonamenti || !r?.inviti) {
      throw new Error(MESSAGGI.schemaAssente);
    }
  };

  const creaSchema = (): Promise<void> =>
    sql
      .begin(async tx => {
        await tx`CREATE TABLE IF NOT EXISTS tenants (
          id BIGSERIAL PRIMARY KEY,
          slug TEXT NOT NULL UNIQUE,
          nome TEXT NOT NULL,
          stato TEXT NOT NULL CHECK (stato IN ('attivo','sospeso')),
          motivo_stato TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
        await tx`CREATE TABLE IF NOT EXISTS tenant_eventi (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL REFERENCES tenants(id),
          tipo TEXT NOT NULL,
          attore TEXT NOT NULL,
          motivo TEXT,
          dettagli JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
        await tx`CREATE INDEX IF NOT EXISTS tenant_eventi_tenant_idx
          ON tenant_eventi (tenant_id, created_at DESC)`;
        // Append-only garantito dal database (spec WS1 §4.1): il primo caso nel repo.
        await tx`CREATE OR REPLACE FUNCTION tenant_eventi_solo_insert() RETURNS trigger AS $$
          BEGIN RAISE EXCEPTION 'tenant_eventi è append-only: UPDATE e DELETE non sono ammessi'; END;
          $$ LANGUAGE plpgsql`;
        await tx`DROP TRIGGER IF EXISTS tenant_eventi_solo_insert ON tenant_eventi`;
        await tx`CREATE TRIGGER tenant_eventi_solo_insert
          BEFORE UPDATE OR DELETE ON tenant_eventi
          FOR EACH ROW EXECUTE FUNCTION tenant_eventi_solo_insert()`;
        await tx`CREATE TABLE IF NOT EXISTS tenant_comandi (
          id BIGSERIAL PRIMARY KEY,
          tipo TEXT NOT NULL CHECK (tipo IN ('crea','sospendi','riattiva','assegna_proprietario','revoca_proprietario','ricalcola_storage','ripristina_archivi','imposta_abbonamento')),
          tenant_id BIGINT,
          payload JSONB NOT NULL,
          stato TEXT NOT NULL DEFAULT 'in_attesa' CHECK (stato IN ('in_attesa','eseguito','errore')),
          esito JSONB,
          richiesto_da TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          eseguito_at TIMESTAMPTZ
        )`;
        await tx`CREATE INDEX IF NOT EXISTS tenant_comandi_attesa_idx
          ON tenant_comandi (stato, id) WHERE stato = 'in_attesa'`;
        // Specchio sede → tenant (Task 12, spec WS2 §6.1): lo legge il trigger
        // `tenant_id` delle tabelle per sede, che gira dentro l'INSERT di chiunque. Vive
        // qui, nel control plane, e non nello store JSONB `sedi`: un trigger
        // non può leggere una riga di `kv_store`.
        await tx`CREATE TABLE IF NOT EXISTS tenant_sedi (
          sede_id BIGINT PRIMARY KEY,
          tenant_id BIGINT NOT NULL REFERENCES tenants(id),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
        // Contabilità dei byte per azienda (WS3, spec §3.2): la riga nasce al
        // primo upload o al ricalcolo; la quota sta su `tenants`. `tx.unsafe`
        // (come in tabelle.ts): Postgres non riesce a dedurre il tipo di un
        // parametro bindato dentro un DEFAULT di ALTER TABLE ("could not
        // determine data type of parameter $1"); qui il valore è una costante
        // interna, mai input utente, quindi inserirlo nel testo è sicuro.
        await tx.unsafe(
          `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS storage_quota_bytes BIGINT NOT NULL DEFAULT ${QUOTA_STORAGE_PREDEFINITA_BYTES}`
        );
        await tx`CREATE TABLE IF NOT EXISTS tenant_storage (
          tenant_id BIGINT PRIMARY KEY REFERENCES tenants(id),
          bytes BIGINT NOT NULL DEFAULT 0,
          file INTEGER NOT NULL DEFAULT 0,
          soglia_avvisata INTEGER NOT NULL DEFAULT 0,
          ricalcolato_il TIMESTAMPTZ,
          aggiornato_il TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
        // Quota che blocca (WS4, spec §6): da quando la quota è al 100 %
        // ininterrottamente, per contare la tolleranza prima del blocco.
        // Colonna additiva su una tabella già a terra dal WS3.
        await tx`ALTER TABLE tenant_storage ADD COLUMN IF NOT EXISTS soglia_100_dal TIMESTAMPTZ`;
        // `state` OAuth persistiti (spec §5): una replica sola oggi, ma una
        // mappa in memoria muore a ogni deploy e non sa di quale azienda è.
        await tx`CREATE TABLE IF NOT EXISTS oauth_state (
          state TEXT PRIMARY KEY,
          tipo TEXT NOT NULL CHECK (tipo IN ('fic','gdrive')),
          tenant_id BIGINT NOT NULL REFERENCES tenants(id),
          sede_id BIGINT,
          utente_id BIGINT NOT NULL,
          payload JSONB NOT NULL,
          scade_il TIMESTAMPTZ NOT NULL,
          consumato_il TIMESTAMPTZ
        )`;
        await tx`CREATE INDEX IF NOT EXISTS oauth_state_scade_idx ON oauth_state (scade_il)`;
        // Abbonamento dell'azienda (WS4, spec §3): una riga per tenant. La
        // quota storage resta su `tenants.storage_quota_bytes` (WS3):
        // l'abbonamento non la duplica.
        await tx`CREATE TABLE IF NOT EXISTS abbonamenti (
          tenant_id BIGINT PRIMARY KEY REFERENCES tenants(id),
          tipo TEXT NOT NULL CHECK (tipo IN ('paid','complimentary')),
          periodicita TEXT CHECK (periodicita IN ('monthly','yearly')),
          stato TEXT NOT NULL CHECK (stato IN ('trialing','active','past_due','grace','suspended','cancelled')),
          inizio_periodo TIMESTAMPTZ NOT NULL,
          fine_periodo TIMESTAMPTZ,
          prossimo_rinnovo TIMESTAMPTZ,
          disdetta_a_fine_periodo BOOLEAN NOT NULL DEFAULT FALSE,
          budget_tars_nano_mese BIGINT,
          extra_tars_nano BIGINT NOT NULL DEFAULT 0,
          extra_tars_mese TEXT,
          tolleranza_storage_giorni INTEGER NOT NULL DEFAULT 7,
          tolleranza_tars_giorni INTEGER NOT NULL DEFAULT 7,
          tars_soglia_avvisata INTEGER NOT NULL DEFAULT 0,
          tars_soglia_mese TEXT,
          tars_soglia_100_dal TIMESTAMPTZ,
          insoluto_dal TIMESTAMPTZ,
          provider TEXT NOT NULL DEFAULT 'nessuno',
          provider_ref JSONB,
          omaggio JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
        // Inviti del pannello piattaforma (WS6, spec §4.1): token monouso,
        // mai in chiaro a terra — solo l'hash sha256, con lo stesso vincolo
        // UNIQUE che rende `consumaInvito` atomico anche in concorrenza.
        await tx`CREATE TABLE IF NOT EXISTS tenant_inviti (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL REFERENCES tenants(id),
          utente_id BIGINT NOT NULL,
          email TEXT NOT NULL,
          tipo TEXT NOT NULL DEFAULT 'proprietario' CHECK (tipo IN ('proprietario')),
          token_hash TEXT NOT NULL UNIQUE,
          scade_il TIMESTAMPTZ NOT NULL,
          creato_da TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          usato_il TIMESTAMPTZ,
          annullato_il TIMESTAMPTZ
        )`;
        await tx`CREATE INDEX IF NOT EXISTS tenant_inviti_tenant_idx ON tenant_inviti (tenant_id, created_at DESC)`;
        // Tipi di comando nuovi: il CHECK di `tenant_comandi` è nato nel WS1 con
        // cinque valori e `CREATE TABLE IF NOT EXISTS` non lo tocca su una
        // tabella già a terra. Postgres chiama il vincolo <tabella>_<colonna>_check.
        //
        // Si rifà SOLO se serve (fix wave finale, esteso dal WS4): `DROP` +
        // `ADD CONSTRAINT` prende un lock ACCESS EXCLUSIVE su `tenant_comandi`
        // e rivalida tutte le righe — a ogni boot, anche quando il vincolo è
        // già quello giusto. Si guarda prima com'è fatto: se nomina già
        // `imposta_abbonamento` (l'ultimo degli otto tipi) non si tocca niente.
        const [vincoloTipo] = await tx<{ definizione: string }[]>`
          SELECT pg_get_constraintdef(oid) AS definizione FROM pg_constraint
           WHERE conname = 'tenant_comandi_tipo_check'
             AND conrelid = 'tenant_comandi'::regclass`;
        if (!vincoloTipo?.definizione?.includes("imposta_abbonamento")) {
          await tx`ALTER TABLE tenant_comandi DROP CONSTRAINT IF EXISTS tenant_comandi_tipo_check`;
          await tx`ALTER TABLE tenant_comandi ADD CONSTRAINT tenant_comandi_tipo_check
            CHECK (tipo IN ('crea','sospendi','riattiva','assegna_proprietario','revoca_proprietario','ricalcola_storage','ripristina_archivi','imposta_abbonamento'))`;
        }
      })
      .then(() => undefined);

  const ensureSchema = (): Promise<void> => {
    schemaPromise ??= (opzioni.creaSchema === false ? verificaSchema() : creaSchema()).catch(e => {
      schemaPromise = null;
      throw e;
    });
    return schemaPromise;
  };

  const repo: TenantRepository = {
    ensureSchema,
    async caricaCache() {
      await ensureSchema();
      const rows = await sql`SELECT * FROM tenants ORDER BY id`;
      cache.clear();
      for (const r of rows) cache.set(Number(r.id), rigaTenant(r));
      const righeAbbonamenti = await sql`SELECT * FROM abbonamenti ORDER BY tenant_id`;
      cacheAbbonamenti.clear();
      for (const r of righeAbbonamenti) cacheAbbonamenti.set(Number(r.tenant_id), rigaAbbonamento(r));
    },
    tutti: () => [...cache.values()].sort((a, b) => a.id - b.id).map(clone),
    perId: id => {
      const t = cache.get(id);
      return t ? clone(t) : null;
    },
    perSlug: slug => {
      for (const t of cache.values()) if (t.slug === slug) return clone(t);
      return null;
    },
    abbonamentoDi: tenantId => {
      const a = cacheAbbonamenti.get(tenantId);
      return a ? clone(a) : null;
    },
    abbonamenti: () => [...cacheAbbonamenti.values()].sort((a, b) => a.tenantId - b.tenantId).map(clone),
    async inserisci(input) {
      await ensureSchema();
      if (repo.perSlug(input.slug)) throw new Error(`slug già usato: ${input.slug}`);
      const stato = input.stato ?? "attivo";
      let rows;
      try {
        rows =
          input.id != null
            ? await sql`INSERT INTO tenants (id, slug, nome, stato) VALUES (${input.id}, ${input.slug}, ${input.nome}, ${stato}) RETURNING *`
            : await sql`INSERT INTO tenants (slug, nome, stato) VALUES (${input.slug}, ${input.nome}, ${stato}) RETURNING *`;
      } catch (e) {
        if ((e as { code?: string } | undefined)?.code === "23505") {
          throw new Error(`slug già usato: ${input.slug}`);
        }
        throw e;
      }
      if (input.id != null) await allineaSequenza();
      return memorizza(rigaTenant(rows[0]));
    },
    async aggiornaStato(id, stato, motivo) {
      await ensureSchema();
      const rows = await sql`UPDATE tenants SET stato = ${stato}, motivo_stato = ${motivo}, updated_at = NOW()
        WHERE id = ${id} RETURNING *`;
      if (!rows.length) throw new Error(`tenant ${id} inesistente`);
      return memorizza(rigaTenant(rows[0]));
    },
    async registraEvento(e) {
      await ensureSchema();
      const dettagli = e.dettagli ? sql.json(e.dettagli as any) : null;
      const rows = await sql`INSERT INTO tenant_eventi (tenant_id, tipo, attore, motivo, dettagli)
        VALUES (${e.tenantId}, ${e.tipo}, ${e.attore}, ${e.motivo ?? null}, ${dettagli}) RETURNING *`;
      return rigaEvento(rows[0]);
    },
    async eventi(tenantId, opzioni) {
      await ensureSchema();
      const ultimi = opzioni?.ultimi;
      // Con `ultimi` si prendono le ultime n righe (`ORDER BY id DESC LIMIT
      // n`, che usa l'indice) e si rovescia il risultato: il chiamante
      // riceve sempre l'ordine crescente, come senza opzione.
      // `ultimi` ≤ 0 vale «tutti», come in memoria: LIMIT 0 darebbe zero righe.
      if (ultimi != null && ultimi > 0) {
        const rows = await sql`SELECT * FROM tenant_eventi WHERE tenant_id = ${tenantId}
          ORDER BY id DESC LIMIT ${ultimi}`;
        return rows.map(rigaEvento).reverse();
      }
      const rows = await sql`SELECT * FROM tenant_eventi WHERE tenant_id = ${tenantId} ORDER BY id`;
      return rows.map(rigaEvento);
    },
    async eventiRecenti(input) {
      await ensureSchema();
      const rows = await sql`SELECT * FROM tenant_eventi WHERE tipo = ANY(${input.tipi}) AND created_at >= ${input.da} ORDER BY id`;
      return rows.map(rigaEvento);
    },
    async accodaComando(input) {
      await ensureSchema();
      const rows = await sql`INSERT INTO tenant_comandi (tipo, tenant_id, payload, richiesto_da)
        VALUES (${input.tipo}, ${input.tenantId}, ${sql.json(input.payload as any)}, ${input.richiestoDa}) RETURNING *`;
      return rigaComando(rows[0]);
    },
    async comandiInAttesa() {
      await ensureSchema();
      const rows = await sql`SELECT * FROM tenant_comandi WHERE stato = 'in_attesa' ORDER BY id`;
      return rows.map(rigaComando);
    },
    async comando(id) {
      await ensureSchema();
      const rows = await sql`SELECT * FROM tenant_comandi WHERE id = ${id}`;
      return rows.length ? rigaComando(rows[0]) : null;
    },
    async comandiDi(tenantId, opzioni) {
      await ensureSchema();
      const ultimi = opzioni?.ultimi;
      const rows =
        ultimi != null && ultimi > 0
          ? await sql`SELECT * FROM tenant_comandi WHERE tenant_id = ${tenantId} ORDER BY id DESC LIMIT ${ultimi}`
          : await sql`SELECT * FROM tenant_comandi WHERE tenant_id = ${tenantId} ORDER BY id DESC`;
      return rows.map(rigaComando);
    },
    async prendiEdEsegui(esegui, opzioni) {
      await ensureSchema();
      return sql.begin(async tx => {
        const rows =
          opzioni?.soloId != null
            ? await tx`SELECT * FROM tenant_comandi WHERE stato = 'in_attesa' AND id = ${opzioni.soloId} FOR UPDATE SKIP LOCKED`
            : await tx`SELECT * FROM tenant_comandi WHERE stato = 'in_attesa'
          ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`;
        if (!rows.length) return "nessuno" as const;
        const comando = rigaComando(rows[0]);
        let stato: "eseguito" | "errore";
        let esito: EsitoComando;
        try {
          esito = await esegui(comando);
          stato = "eseguito";
        } catch (e) {
          esito = { errore: messaggioErrore(e) };
          stato = "errore";
        }
        await tx`UPDATE tenant_comandi SET stato = ${stato}, esito = ${tx.json(esito as any)}, eseguito_at = NOW(),
          payload = ${tx.json(payloadSenzaSegreti(comando.payload) as any)}
          WHERE id = ${comando.id}`;
        return stato;
      });
    },
    async assicuraTenantPredefinito() {
      await ensureSchema();
      await sql`INSERT INTO tenants (id, slug, nome, stato)
        VALUES (${TENANT_PREDEFINITO_ID}, ${TENANT_PREDEFINITO_SLUG}, ${TENANT_PREDEFINITO_NOME}, 'attivo')
        ON CONFLICT (id) DO NOTHING`;
      await allineaSequenza();
      const rows = await sql`SELECT * FROM tenants WHERE id = ${TENANT_PREDEFINITO_ID}`;
      return memorizza(rigaTenant(rows[0]));
    },
    async sincronizzaTenantSedi(righe) {
      await ensureSchema();
      if (righe.length === 0) return;
      await sql.begin(async tx => {
        for (const r of righe) {
          // `SELECT … WHERE EXISTS` invece di `VALUES`: una sede il cui tenant
          // non è (ancora) nel control plane viene saltata, non fa esplodere
          // la chiave esterna e con essa il boot.
          await tx`INSERT INTO tenant_sedi (sede_id, tenant_id)
            SELECT ${r.sedeId}, ${r.tenantId}
            WHERE EXISTS (SELECT 1 FROM tenants WHERE id = ${r.tenantId})
            ON CONFLICT (sede_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, updated_at = NOW()`;
        }
      });
    },
    async tenantSedi() {
      await ensureSchema();
      const rows = await sql`SELECT sede_id, tenant_id FROM tenant_sedi ORDER BY sede_id`;
      return rows.map(r => ({ sedeId: Number(r.sede_id), tenantId: Number(r.tenant_id) }));
    },
    async storageDi(tenantId) {
      await ensureSchema();
      const rows = await sql`SELECT * FROM tenant_storage WHERE tenant_id = ${tenantId}`;
      return rows.length ? rigaStorage(rows[0], quotaDi(tenantId)) : null;
    },
    async storageTutti() {
      await ensureSchema();
      // La quota vive sulla cache dei tenant (già caricata), come in
      // `storageDi`: niente JOIN, una SELECT sola su `tenant_storage`.
      const rows = await sql`SELECT * FROM tenant_storage ORDER BY tenant_id`;
      return rows.map(r => rigaStorage(r, quotaDi(Number(r.tenant_id))));
    },
    async aggiornaStorage(tenantId, deltaBytes, deltaFile) {
      await ensureSchema();
      const rows = await sql`INSERT INTO tenant_storage (tenant_id, bytes, file)
        VALUES (${tenantId}, GREATEST(${deltaBytes}, 0), GREATEST(${deltaFile}, 0))
        ON CONFLICT (tenant_id) DO UPDATE SET
          bytes = GREATEST(tenant_storage.bytes + ${deltaBytes}, 0),
          file = GREATEST(tenant_storage.file + ${deltaFile}, 0),
          aggiornato_il = NOW()
        RETURNING *`;
      return rigaStorage(rows[0], quotaDi(tenantId));
    },
    async impostaStorage(tenantId, valori) {
      await ensureSchema();
      const rows = await sql`INSERT INTO tenant_storage (tenant_id, bytes, file, ricalcolato_il)
        VALUES (${tenantId}, GREATEST(${valori.bytes}, 0), GREATEST(${valori.file}, 0), NOW())
        ON CONFLICT (tenant_id) DO UPDATE SET
          bytes = EXCLUDED.bytes, file = EXCLUDED.file, ricalcolato_il = NOW(), aggiornato_il = NOW()
        RETURNING *`;
      return rigaStorage(rows[0], quotaDi(tenantId));
    },
    async impostaSogliaAvvisata(tenantId, soglia) {
      await ensureSchema();
      // ON CONFLICT: la soglia può arrivare prima che un delta abbia mai
      // creato la riga (es. ricalcolo a freddo su un tenant appena nato).
      await sql`INSERT INTO tenant_storage (tenant_id, soglia_avvisata) VALUES (${tenantId}, ${soglia})
        ON CONFLICT (tenant_id) DO UPDATE SET soglia_avvisata = EXCLUDED.soglia_avvisata, aggiornato_il = NOW()`;
    },
    async impostaQuotaStorage(tenantId, quotaBytes) {
      await ensureSchema();
      const rows = await sql`UPDATE tenants SET storage_quota_bytes = ${quotaBytes}, updated_at = NOW() WHERE id = ${tenantId} RETURNING *`;
      if (!rows.length) throw new Error(`tenant ${tenantId} inesistente`);
      return memorizza(rigaTenant(rows[0]));
    },
    async impostaSoglia100Storage(tenantId, dal) {
      await ensureSchema();
      // ON CONFLICT: come `impostaSogliaAvvisata`, la riga può non esistere ancora.
      await sql`INSERT INTO tenant_storage (tenant_id, soglia_100_dal) VALUES (${tenantId}, ${dal})
        ON CONFLICT (tenant_id) DO UPDATE SET soglia_100_dal = EXCLUDED.soglia_100_dal, aggiornato_il = NOW()`;
    },
    async salvaAbbonamento(a) {
      await ensureSchema();
      const providerRef = a.providerRef ? sql.json(a.providerRef as any) : null;
      const omaggio = a.omaggio ? sql.json(a.omaggio as any) : null;
      let rows;
      try {
        // `created_at` non compare nel DO UPDATE SET: un conflitto conserva la
        // riga esistente (come la cache in memoria), solo `updated_at` cambia
        // sempre, con NOW() sia all'inserimento sia all'aggiornamento.
        rows = await sql`INSERT INTO abbonamenti (
            tenant_id, tipo, periodicita, stato, inizio_periodo, fine_periodo, prossimo_rinnovo,
            disdetta_a_fine_periodo, budget_tars_nano_mese, extra_tars_nano, extra_tars_mese,
            tolleranza_storage_giorni, tolleranza_tars_giorni, tars_soglia_avvisata, tars_soglia_mese,
            tars_soglia_100_dal, insoluto_dal, provider, provider_ref, omaggio, created_at, updated_at
          ) VALUES (
            ${a.tenantId}, ${a.tipo}, ${a.periodicita}, ${a.stato}, ${a.inizioPeriodo}, ${a.finePeriodo}, ${a.prossimoRinnovo},
            ${a.disdettaAFinePeriodo}, ${a.budgetTarsNanoMese}, ${a.extraTarsNano}, ${a.extraTarsMese},
            ${a.tolleranzaStorageGiorni}, ${a.tolleranzaTarsGiorni}, ${a.tarsSogliaAvvisata}, ${a.tarsSogliaMese},
            ${a.tarsSoglia100Dal}, ${a.insolutoDal}, ${a.provider}, ${providerRef}, ${omaggio}, ${a.createdAt}, NOW()
          )
          ON CONFLICT (tenant_id) DO UPDATE SET
            tipo = EXCLUDED.tipo, periodicita = EXCLUDED.periodicita, stato = EXCLUDED.stato,
            inizio_periodo = EXCLUDED.inizio_periodo, fine_periodo = EXCLUDED.fine_periodo,
            prossimo_rinnovo = EXCLUDED.prossimo_rinnovo, disdetta_a_fine_periodo = EXCLUDED.disdetta_a_fine_periodo,
            budget_tars_nano_mese = EXCLUDED.budget_tars_nano_mese, extra_tars_nano = EXCLUDED.extra_tars_nano,
            extra_tars_mese = EXCLUDED.extra_tars_mese, tolleranza_storage_giorni = EXCLUDED.tolleranza_storage_giorni,
            tolleranza_tars_giorni = EXCLUDED.tolleranza_tars_giorni, tars_soglia_avvisata = EXCLUDED.tars_soglia_avvisata,
            tars_soglia_mese = EXCLUDED.tars_soglia_mese, tars_soglia_100_dal = EXCLUDED.tars_soglia_100_dal,
            insoluto_dal = EXCLUDED.insoluto_dal, provider = EXCLUDED.provider, provider_ref = EXCLUDED.provider_ref,
            omaggio = EXCLUDED.omaggio, updated_at = NOW()
          RETURNING *`;
      } catch (e) {
        // FK verso `tenants`: stesso messaggio della guardia esistente in memoria.
        if ((e as { code?: string } | undefined)?.code === "23503") {
          throw new Error(`tenant ${a.tenantId} inesistente`);
        }
        throw e;
      }
      const salvato = rigaAbbonamento(rows[0]);
      cacheAbbonamenti.set(salvato.tenantId, salvato);
      return clone(salvato);
    },
    async emettiStateOAuth(input) {
      await ensureSchema();
      const state = randomBytes(24).toString("base64url");
      await sql`INSERT INTO oauth_state (state, tipo, tenant_id, sede_id, utente_id, payload, scade_il)
        VALUES (${state}, ${input.tipo}, ${input.tenantId}, ${input.sedeId}, ${input.utenteId}, ${sql.json(input.payload as any)}, NOW() + make_interval(secs => ${TTL_STATE_OAUTH_MS / 1000}))`;
      return state;
    },
    async consumaStateOAuth(state, tipo) {
      await ensureSchema();
      const rows = await sql`UPDATE oauth_state SET consumato_il = NOW()
        WHERE state = ${state} AND tipo = ${tipo} AND consumato_il IS NULL AND scade_il > NOW() RETURNING *`;
      return rows.length ? rigaState(rows[0]) : null;
    },
    async pulisciStateScaduti() {
      await ensureSchema();
      const rows = await sql`DELETE FROM oauth_state WHERE scade_il <= NOW() RETURNING state`;
      return rows.length;
    },
    async emettiInvito(input) {
      await ensureSchema();
      const token = randomBytes(32).toString("base64url");
      const hash = hashToken(token);
      const rows = await sql.begin(async tx => {
        // Annulla prima ogni invito ancora valido dello stesso utente sullo
        // stesso tenant: un secondo invito rimpiazza il primo, non lo affianca.
        await tx`UPDATE tenant_inviti SET annullato_il = NOW()
          WHERE tenant_id = ${input.tenantId} AND utente_id = ${input.utenteId}
            AND usato_il IS NULL AND annullato_il IS NULL AND scade_il > NOW()`;
        return tx`INSERT INTO tenant_inviti (tenant_id, utente_id, email, tipo, token_hash, scade_il, creato_da)
          VALUES (${input.tenantId}, ${input.utenteId}, ${input.email.trim().toLowerCase()}, ${input.tipo}, ${hash},
            NOW() + make_interval(secs => ${TTL_INVITO_MS / 1000}), ${input.creatoDa})
          RETURNING *`;
      });
      return { invito: rigaInvito(rows[0]), token };
    },
    async invitoPerToken(token) {
      await ensureSchema();
      const rows = await sql`SELECT * FROM tenant_inviti
        WHERE token_hash = ${hashToken(token)} AND usato_il IS NULL AND annullato_il IS NULL AND scade_il > NOW()`;
      return rows.length ? rigaInvito(rows[0]) : null;
    },
    async consumaInvito(token) {
      await ensureSchema();
      // UPDATE … RETURNING atomico: con due chiamate concorrenti sullo
      // stesso token, il WHERE della seconda non trova più righe (la prima
      // ha già messo `usato_il`) — esattamente un vincitore, senza lock a mano.
      const rows = await sql`UPDATE tenant_inviti SET usato_il = NOW()
        WHERE token_hash = ${hashToken(token)} AND usato_il IS NULL AND annullato_il IS NULL AND scade_il > NOW()
        RETURNING *`;
      return rows.length ? rigaInvito(rows[0]) : null;
    },
    async invitiDi(tenantId) {
      await ensureSchema();
      const rows = await sql`SELECT * FROM tenant_inviti WHERE tenant_id = ${tenantId} ORDER BY id DESC`;
      return rows.map(rigaInvito);
    },
    async annullaInvito(id) {
      await ensureSchema();
      const rows = await sql`UPDATE tenant_inviti SET annullato_il = COALESCE(annullato_il, NOW())
        WHERE id = ${id} AND usato_il IS NULL RETURNING *`;
      return rows.length ? rigaInvito(rows[0]) : null;
    },
    async pulisciInvitiScaduti() {
      await ensureSchema();
      const rows = await sql`DELETE FROM tenant_inviti WHERE scade_il <= NOW() - interval '30 days' RETURNING id`;
      return rows.length;
    },
  };
  return repo;
}

// ── Singleton ───────────────────────────────────────────────────────────────

let repository: TenantRepository | null = null;

export function getTenantRepository(): TenantRepository {
  repository ??= kvSql
    ? createPostgresTenantRepository(kvSql)
    : createMemoryTenantRepository();
  return repository;
}

export function resetTenantRepositoryForTesting(): void {
  if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY_TENANT_REPOSITORY_RESET");
  repository = null;
}
