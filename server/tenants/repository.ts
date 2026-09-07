// Control plane del tenant: tabelle relazionali con `ensureSchema()` a mano
// (come authz/repository.ts), variante Postgres e in memoria. QUESTO è
// l'unico file che scrive `tenants`, `tenant_eventi`, `tenant_comandi`
// (guardia strutturale in confine.test.ts). La cache dei tenant vive qui:
// una replica sola, aggiornata da ogni scrittura.
import { kvSql } from "../_core/persistence";
import {
  MESSAGGI,
  TENANT_PREDEFINITO_ID,
  TENANT_PREDEFINITO_NOME,
  TENANT_PREDEFINITO_SLUG,
} from "./costanti";
import type {
  StatoTenant,
  TenantComando,
  TenantEvento,
  TenantRecord,
  TipoComando,
  TipoEvento,
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
  eventi(tenantId: number): Promise<TenantEvento[]>;
  accodaComando(input: {
    tipo: TipoComando;
    tenantId: number | null;
    payload: Record<string, unknown>;
    richiestoDa: string;
  }): Promise<TenantComando>;
  comandiInAttesa(): Promise<TenantComando[]>;
  comando(id: number): Promise<TenantComando | null>;
  prendiEdEsegui(
    esegui: (comando: TenantComando) => Promise<EsitoComando>
  ): Promise<"eseguito" | "errore" | "nessuno">;
  assicuraTenantPredefinito(): Promise<TenantRecord>;
  /**
   * Specchio sede → tenant (Task 12): lo legge il trigger `tenant_id` delle
   * tabelle per sede. Idempotente, una riga per sede; le sedi non elencate
   * restano come sono (nessuna cancellazione: una sede non sparisce).
   *
   * Una sede il cui tenant non esiste nel control plane viene SALTATA, non è
   * un errore: con l'interruttore spento `tenants` è vuota (il seed della
   * riga 1 è compito di `preparaTenants` a interruttore acceso) e lo specchio
   * resta vuoto invece di far fallire il boot sulla chiave esterna. Appena
   * l'interruttore si accende, il boot semina il tenant e il giro successivo
   * riempie lo specchio; il backfill delle tabelle chiude i `tenant_id` NULL.
   */
  sincronizzaTenantSedi(
    righe: ReadonlyArray<{ sedeId: number; tenantId: number }>
  ): Promise<void>;
  tenantSedi(): Promise<Array<{ sedeId: number; tenantId: number }>>;
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

// ── Memoria (sviluppo e test senza DATABASE_URL) ────────────────────────────

function createMemoryTenantRepository(): TenantRepository {
  const tenants: TenantRecord[] = [];
  const eventi: TenantEvento[] = [];
  const comandi: TenantComando[] = [];
  const sedi = new Map<number, number>(); // sedeId → tenantId
  let prossimoTenant = 1;
  let prossimoEvento = 1;
  let prossimoComando = 1;

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
    async eventi(tenantId) {
      return eventi.filter(e => e.tenantId === tenantId).map(clone);
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
    async prendiEdEsegui(esegui) {
      const c = comandi.find(x => x.stato === "in_attesa");
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
  let schemaPromise: Promise<void> | null = null;

  const rigaTenant = (r: any): TenantRecord => ({
    id: Number(r.id),
    slug: r.slug,
    nome: r.nome,
    stato: r.stato,
    motivoStato: r.motivo_stato ?? null,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
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
  const memorizza = (t: TenantRecord): TenantRecord => {
    cache.set(t.id, t);
    return clone(t);
  };
  const allineaSequenza = () =>
    sql`SELECT setval(pg_get_serial_sequence('tenants', 'id'), GREATEST((SELECT MAX(id) FROM tenants), 1))`;

  // Sonda in sola lettura (spec WS1 §6.3): `to_regclass` è NULL se la tabella manca.
  const verificaSchema = async (): Promise<void> => {
    const rows = await sql`SELECT to_regclass('tenants') AS tenants,
      to_regclass('tenant_eventi') AS eventi, to_regclass('tenant_comandi') AS comandi,
      to_regclass('tenant_sedi') AS sedi`;
    const r = rows[0];
    if (!r?.tenants || !r?.eventi || !r?.comandi || !r?.sedi) throw new Error(MESSAGGI.schemaAssente);
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
          tipo TEXT NOT NULL CHECK (tipo IN ('crea','sospendi','riattiva','assegna_proprietario','revoca_proprietario')),
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
    async eventi(tenantId) {
      await ensureSchema();
      const rows = await sql`SELECT * FROM tenant_eventi WHERE tenant_id = ${tenantId} ORDER BY id`;
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
    async prendiEdEsegui(esegui) {
      await ensureSchema();
      return sql.begin(async tx => {
        const rows = await tx`SELECT * FROM tenant_comandi WHERE stato = 'in_attesa'
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
