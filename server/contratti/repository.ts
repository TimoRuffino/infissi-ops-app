// Contratto strutturato della commessa: tabelle vere, centesimi, sede su
// ogni riga. Stesso pattern di server/reminders/repository.ts: memoria
// senza DATABASE_URL (test e sviluppo), Postgres altrimenti. Il salvataggio
// è atomico e sostituisce le righe: una lista è più semplice da tenere
// coerente che un diff riga per riga, e la UI ricarica comunque.
import { kvSql } from "../_core/persistence";
import { OPZIONI_COMPUTO_DEFAULT, type Contratto, type RigaContratto } from "@shared/limiti/tipi";

export type ContrattoPersist = Omit<Contratto, "createdAt" | "updatedAt">;
export type RigaPersist = Omit<RigaContratto, "id" | "createdAt" | "updatedAt">;

export type ContrattiRepository = {
  ensureSchema(): Promise<void>;
  getContratto(sedeId: number, commessaId: number): Promise<Contratto | null>;
  listRighe(sedeId: number, commessaId: number): Promise<RigaContratto[]>;
  salva(input: {
    contratto: ContrattoPersist;
    righe: RigaPersist[];
    now: Date;
  }): Promise<{ contratto: Contratto; righe: RigaContratto[] }>;
};

function ordina(righe: RigaContratto[]): RigaContratto[] {
  return [...righe].sort((a, b) => a.ordine - b.ordine || a.id - b.id);
}

export function createMemoryContrattiRepository(): ContrattiRepository {
  const contratti = new Map<number, Contratto>();
  const righe: RigaContratto[] = [];
  let nextId = 1;
  return {
    async ensureSchema() {},
    async getContratto(sedeId, commessaId) {
      const c = contratti.get(commessaId);
      return c && c.sedeId === sedeId ? structuredClone(c) : null;
    },
    async listRighe(sedeId, commessaId) {
      return ordina(
        righe.filter(r => r.sedeId === sedeId && r.commessaId === commessaId)
      ).map(r => structuredClone(r));
    },
    async salva({ contratto, righe: nuove, now }) {
      // Una commessa appartiene a una sola sede per sempre: un salvataggio da
      // un'altra sede sulla stessa commessa è NOT_FOUND, come su Postgres
      // (la guardia WHERE sede_id = EXCLUDED.sede_id sull'UPSERT), non una
      // sostituzione silenziosa che sposterebbe la commessa di sede.
      const precedente = contratti.get(contratto.commessaId);
      if (precedente && precedente.sedeId !== contratto.sedeId) {
        throw new Error("NOT_FOUND: Commessa non trovata.");
      }
      const salvato: Contratto = {
        ...structuredClone(contratto),
        createdAt: precedente?.createdAt ?? now,
        updatedAt: now,
      };
      contratti.set(contratto.commessaId, salvato);
      for (let i = righe.length - 1; i >= 0; i--) {
        if (righe[i].sedeId === contratto.sedeId && righe[i].commessaId === contratto.commessaId) {
          righe.splice(i, 1);
        }
      }
      // Sede e commessa della riga sono quelle del contratto padre: mai
      // quelle (eventualmente sbagliate) passate dal chiamante.
      const inserite = nuove.map(r => ({
        ...structuredClone(r),
        sedeId: contratto.sedeId,
        commessaId: contratto.commessaId,
        id: nextId++,
        createdAt: now,
        updatedAt: now,
      }));
      righe.push(...inserite);
      return { contratto: structuredClone(salvato), righe: ordina(inserite) };
    },
  };
}

function rowToContratto(row: any): Contratto {
  return {
    commessaId: Number(row.commessa_id),
    sedeId: Number(row.sede_id),
    pattuitoCent: Number(row.pattuito_cent),
    pattuitoTipo: row.pattuito_tipo,
    posaInclusa: Boolean(row.posa_inclusa),
    notePosa: row.note_posa ?? null,
    comuneCantiere: row.comune_cantiere ?? null,
    codiceIstat: row.codice_istat ?? null,
    zonaClimatica: row.zona_climatica ?? null,
    zonaManuale: Boolean(row.zona_manuale),
    piano: row.piano == null ? null : Number(row.piano),
    distanzaKm: row.distanza_km == null ? null : Number(row.distanza_km),
    detrazioneTipo: row.detrazione_tipo,
    detrazioneImmobile: row.detrazione_immobile ?? null,
    detrazionePct: row.detrazione_pct == null ? null : Number(row.detrazione_pct),
    dataFirma: row.data_firma == null
      ? null
      : row.data_firma instanceof Date
        ? row.data_firma.toISOString().slice(0, 10)
        : String(row.data_firma).slice(0, 10),
    rate: Array.isArray(row.rate) ? row.rate : [],
    // Clone: una riga legacy senza `opzioni_computo` non deve condividere
    // (e far mutare a distanza) l'oggetto default esportato da shared.
    opzioniComputo: row.opzioni_computo ?? structuredClone(OPZIONI_COMPUTO_DEFAULT),
    hashRighe: row.hash_righe,
    hashParametri: row.hash_parametri,
    origine: row.origine,
    documentoId: row.documento_id == null ? null : Number(row.documento_id),
    createdBy: row.created_by == null ? null : Number(row.created_by),
    updatedBy: row.updated_by == null ? null : Number(row.updated_by),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function rowToRiga(row: any): RigaContratto {
  return {
    id: Number(row.id),
    sedeId: Number(row.sede_id),
    commessaId: Number(row.commessa_id),
    ordine: Number(row.ordine),
    categoria: row.categoria,
    tipologia: row.tipologia ?? null,
    oscuranteIntegrato: row.oscurante_integrato ?? null,
    oscuranteTipologia: row.oscurante_tipologia ?? null,
    descrizione: row.descrizione,
    quantita: Number(row.quantita),
    larghezzaMm: row.larghezza_mm == null ? null : Number(row.larghezza_mm),
    altezzaMm: row.altezza_mm == null ? null : Number(row.altezza_mm),
    mq: Number(row.mq),
    misuraDei: row.misura_dei == null ? null : Number(row.misura_dei),
    prezzoUnitCent: row.prezzo_unit_cent == null ? null : Number(row.prezzo_unit_cent),
    prezzoTotCent: row.prezzo_tot_cent == null ? null : Number(row.prezzo_tot_cent),
    beneSignificativo: Boolean(row.bene_significativo),
    accessori: Array.isArray(row.accessori) ? row.accessori : [],
    note: row.note ?? null,
    origine: row.origine,
    evidenza: row.evidenza ?? null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export function createPostgresContrattiRepository(
  sql: NonNullable<typeof kvSql>
): ContrattiRepository {
  let schemaPromise: Promise<void> | null = null;
  const ensureSchema = () => {
    schemaPromise ??= sql
      .begin(async tx => {
        await tx`CREATE TABLE IF NOT EXISTS commessa_contratti (
          commessa_id BIGINT PRIMARY KEY,
          sede_id BIGINT NOT NULL,
          pattuito_cent BIGINT NOT NULL CHECK (pattuito_cent >= 0),
          pattuito_tipo TEXT NOT NULL CHECK (pattuito_tipo IN ('lordo','imponibile')),
          posa_inclusa BOOLEAN NOT NULL DEFAULT TRUE,
          note_posa TEXT,
          comune_cantiere TEXT,
          codice_istat TEXT,
          zona_climatica TEXT CHECK (zona_climatica IN ('A','B','C','D','E','F')),
          zona_manuale BOOLEAN NOT NULL DEFAULT FALSE,
          piano INTEGER,
          distanza_km NUMERIC(6,1),
          detrazione_tipo TEXT NOT NULL DEFAULT 'nessuna' CHECK (detrazione_tipo IN ('nessuna','ecobonus','ristrutturazione')),
          detrazione_immobile TEXT CHECK (detrazione_immobile IN ('prima_casa','altro')),
          detrazione_pct NUMERIC(5,2),
          data_firma DATE,
          rate JSONB NOT NULL DEFAULT '[]'::jsonb,
          opzioni_computo JSONB NOT NULL DEFAULT '{"rilievo":"foro","speseProfessionali":false,"eventuali":[]}'::jsonb,
          hash_righe TEXT NOT NULL,
          hash_parametri TEXT NOT NULL,
          origine TEXT NOT NULL CHECK (origine IN ('estrazione','manuale')),
          documento_id BIGINT,
          created_by BIGINT,
          updated_by BIGINT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
        await tx`CREATE INDEX IF NOT EXISTS commessa_contratti_sede_idx
          ON commessa_contratti (sede_id, commessa_id)`;
        await tx`CREATE TABLE IF NOT EXISTS commessa_righe (
          id BIGSERIAL PRIMARY KEY,
          sede_id BIGINT NOT NULL,
          commessa_id BIGINT NOT NULL,
          ordine INTEGER NOT NULL,
          categoria TEXT NOT NULL,
          tipologia TEXT,
          oscurante_integrato TEXT CHECK (oscurante_integrato IN ('tapparella','persiana','scuro')),
          oscurante_tipologia TEXT,
          descrizione TEXT NOT NULL,
          quantita INTEGER NOT NULL CHECK (quantita > 0),
          larghezza_mm INTEGER,
          altezza_mm INTEGER,
          mq NUMERIC(12,6) NOT NULL DEFAULT 0,
          misura_dei NUMERIC(10,3),
          prezzo_unit_cent BIGINT,
          prezzo_tot_cent BIGINT,
          bene_significativo BOOLEAN NOT NULL DEFAULT TRUE,
          accessori JSONB NOT NULL DEFAULT '[]'::jsonb,
          note TEXT,
          origine TEXT NOT NULL CHECK (origine IN ('estrazione','manuale','prodotto_legacy')),
          evidenza JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
        await tx`CREATE INDEX IF NOT EXISTS commessa_righe_commessa_idx
          ON commessa_righe (sede_id, commessa_id, ordine)`;
      })
      .then(() => undefined)
      .catch(error => {
        schemaPromise = null;
        throw error;
      });
    return schemaPromise;
  };

  return {
    ensureSchema,
    async getContratto(sedeId, commessaId) {
      await ensureSchema();
      const rows = await sql`SELECT * FROM commessa_contratti
        WHERE sede_id = ${sedeId} AND commessa_id = ${commessaId}`;
      return rows[0] ? rowToContratto(rows[0]) : null;
    },
    async listRighe(sedeId, commessaId) {
      await ensureSchema();
      const rows = await sql`SELECT * FROM commessa_righe
        WHERE sede_id = ${sedeId} AND commessa_id = ${commessaId}
        ORDER BY ordine, id`;
      return rows.map(rowToRiga);
    },
    async salva({ contratto: c, righe, now }) {
      await ensureSchema();
      return sql.begin(async tx => {
        const rows = await tx`INSERT INTO commessa_contratti (
          commessa_id, sede_id, pattuito_cent, pattuito_tipo, posa_inclusa, note_posa,
          comune_cantiere, codice_istat, zona_climatica, zona_manuale, piano, distanza_km,
          detrazione_tipo, detrazione_immobile, detrazione_pct, data_firma, rate, opzioni_computo,
          hash_righe, hash_parametri, origine, documento_id, created_by, updated_by,
          created_at, updated_at
        ) VALUES (
          ${c.commessaId}, ${c.sedeId}, ${c.pattuitoCent}, ${c.pattuitoTipo}, ${c.posaInclusa},
          ${c.notePosa}, ${c.comuneCantiere}, ${c.codiceIstat}, ${c.zonaClimatica},
          ${c.zonaManuale}, ${c.piano}, ${c.distanzaKm}, ${c.detrazioneTipo},
          ${c.detrazioneImmobile}, ${c.detrazionePct}, ${c.dataFirma},
          ${tx.json(c.rate as any)}, ${tx.json(c.opzioniComputo as any)}, ${c.hashRighe}, ${c.hashParametri}, ${c.origine},
          ${c.documentoId}, ${c.createdBy}, ${c.updatedBy}, ${now}, ${now}
        ) ON CONFLICT (commessa_id) DO UPDATE SET
          pattuito_cent = EXCLUDED.pattuito_cent, pattuito_tipo = EXCLUDED.pattuito_tipo,
          posa_inclusa = EXCLUDED.posa_inclusa, note_posa = EXCLUDED.note_posa,
          comune_cantiere = EXCLUDED.comune_cantiere, codice_istat = EXCLUDED.codice_istat,
          zona_climatica = EXCLUDED.zona_climatica, zona_manuale = EXCLUDED.zona_manuale,
          piano = EXCLUDED.piano, distanza_km = EXCLUDED.distanza_km,
          detrazione_tipo = EXCLUDED.detrazione_tipo, detrazione_immobile = EXCLUDED.detrazione_immobile,
          detrazione_pct = EXCLUDED.detrazione_pct, data_firma = EXCLUDED.data_firma,
          rate = EXCLUDED.rate, opzioni_computo = EXCLUDED.opzioni_computo, hash_righe = EXCLUDED.hash_righe,
          hash_parametri = EXCLUDED.hash_parametri, origine = EXCLUDED.origine,
          documento_id = EXCLUDED.documento_id, updated_by = EXCLUDED.updated_by,
          updated_at = EXCLUDED.updated_at
        WHERE commessa_contratti.sede_id = EXCLUDED.sede_id
        RETURNING *`;
        if (!rows[0]) throw new Error("NOT_FOUND: Commessa non trovata.");
        await tx`DELETE FROM commessa_righe
          WHERE sede_id = ${c.sedeId} AND commessa_id = ${c.commessaId}`;
        // Un contratto reale ha decine di righe: una round trip per riga
        // (~147 ms sul database di produzione) rendeva il salvataggio lungo
        // quanto il numero di righe. Un solo INSERT multi-riga con l'helper
        // di postgres-js; `tx.json` resta valido dentro l'helper.
        const inserite = righe.length === 0 ? [] : await tx`INSERT INTO commessa_righe ${tx(
          righe.map(r => ({
            // Sede e commessa restano quelle del contratto padre, mai quelle
            // (eventualmente sbagliate) passate dal chiamante.
            sede_id: c.sedeId,
            commessa_id: c.commessaId,
            ordine: r.ordine,
            categoria: r.categoria,
            tipologia: r.tipologia,
            oscurante_integrato: r.oscuranteIntegrato,
            oscurante_tipologia: r.oscuranteTipologia,
            descrizione: r.descrizione,
            quantita: r.quantita,
            larghezza_mm: r.larghezzaMm,
            altezza_mm: r.altezzaMm,
            mq: r.mq,
            misura_dei: r.misuraDei,
            prezzo_unit_cent: r.prezzoUnitCent,
            prezzo_tot_cent: r.prezzoTotCent,
            bene_significativo: r.beneSignificativo,
            accessori: tx.json(r.accessori as any),
            note: r.note,
            origine: r.origine,
            evidenza: r.evidenza == null ? null : tx.json(r.evidenza as any),
            created_at: now,
            updated_at: now,
          })),
          "sede_id", "commessa_id", "ordine", "categoria", "tipologia", "oscurante_integrato",
          "oscurante_tipologia", "descrizione", "quantita", "larghezza_mm", "altezza_mm", "mq",
          "misura_dei", "prezzo_unit_cent", "prezzo_tot_cent", "bene_significativo", "accessori",
          "note", "origine", "evidenza", "created_at", "updated_at"
        )} RETURNING *`;
        // L'ordine del RETURNING non è garantito dal protocollo: `ordina`
        // riporta le righe nell'ordine di lettura (ordine, poi id).
        return { contratto: rowToContratto(rows[0]), righe: ordina(inserite.map(rowToRiga)) };
      });
    },
  };
}

let singleton: ContrattiRepository | null = null;
export function getContrattiRepository(): ContrattiRepository {
  singleton ??= kvSql
    ? createPostgresContrattiRepository(kvSql)
    : createMemoryContrattiRepository();
  return singleton;
}

/** Solo test: ripristina il repository in memoria tra una suite e l'altra. */
export function _resetContrattiRepositoryForTests(): void {
  singleton = null;
}
