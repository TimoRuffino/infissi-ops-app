// Fotografie del computo limiti: ogni esecuzione è una riga nuova con le sue
// voci; «l'ultimo» per commessa è quello che la UI mostra e il gate
// confronta con gli hash del contratto. Nessun aggiornamento in place: un
// computo è un fatto datato, non uno stato.
import { kvSql } from "../_core/persistence";
import type { Computo, VoceComputo } from "@shared/limiti/tipi";

export type ComputoPersist = Omit<Computo, "id" | "createdAt">;

export type ComputiRepository = {
  ensureSchema(): Promise<void>;
  salva(input: { computo: ComputoPersist; now: Date }): Promise<Computo>;
  ultimo(sedeId: number, commessaId: number): Promise<Computo | null>;
};

export function createMemoryComputiRepository(): ComputiRepository {
  const computi: Computo[] = [];
  let nextId = 1;
  return {
    async ensureSchema() {},
    async salva({ computo, now }) {
      const salvato: Computo = { ...structuredClone(computo), id: nextId++, createdAt: now };
      computi.push(salvato);
      return structuredClone(salvato);
    },
    async ultimo(sedeId, commessaId) {
      const trovati = computi.filter(c => c.sedeId === sedeId && c.commessaId === commessaId);
      const u = trovati[trovati.length - 1];
      return u ? structuredClone(u) : null;
    },
  };
}

function rowToComputo(row: any, voci: VoceComputo[]): Computo {
  return {
    id: Number(row.id),
    sedeId: Number(row.sede_id),
    commessaId: Number(row.commessa_id),
    hashRighe: row.hash_righe,
    hashParametri: row.hash_parametri,
    tariffeAl: String(row.tariffe_al).slice(0, 10),
    zona: row.zona ?? null,
    esito: row.esito,
    check1Cent: Number(row.check1_cent),
    check2Cent: row.check2_cent == null ? null : Number(row.check2_cent),
    deiProdottiCent: row.dei_prodotti_cent == null ? null : Number(row.dei_prodotti_cent),
    limiteCent: Number(row.limite_cent),
    detraibileCent: row.detraibile_cent == null ? null : Number(row.detraibile_cent),
    detrazioneStimataCent: row.detrazione_stimata_cent == null ? null : Number(row.detrazione_stimata_cent),
    avvertenze: Array.isArray(row.avvertenze) ? row.avvertenze : [],
    voci,
    createdBy: row.created_by == null ? null : Number(row.created_by),
    createdAt: new Date(row.created_at),
  };
}

function rowToVoce(row: any): VoceComputo {
  return {
    gruppo: row.gruppo,
    codice: row.codice,
    descrizione: row.descrizione,
    codiceDei: row.codice_dei ?? null,
    unita: row.unita,
    prezzoUnitCent: Number(row.prezzo_unit_cent),
    quantita: Number(row.quantita),
    limiteCent: Number(row.limite_cent),
    dettaglio: row.dettaglio ?? {},
    ordine: Number(row.ordine),
    inclusa: Boolean(row.inclusa),
    inCheck1: Boolean(row.in_check1),
    inCheck2: Boolean(row.in_check2),
  };
}

export function createPostgresComputiRepository(
  sql: NonNullable<typeof kvSql>
): ComputiRepository {
  let schemaPromise: Promise<void> | null = null;
  const ensureSchema = () => {
    schemaPromise ??= sql
      .begin(async tx => {
        await tx`CREATE TABLE IF NOT EXISTS computi (
          id BIGSERIAL PRIMARY KEY,
          sede_id BIGINT NOT NULL,
          commessa_id BIGINT NOT NULL,
          hash_righe TEXT NOT NULL,
          hash_parametri TEXT NOT NULL,
          tariffe_al DATE NOT NULL,
          zona TEXT CHECK (zona IN ('A','B','C','D','E','F')),
          esito TEXT NOT NULL CHECK (esito IN ('ok','incompleto')),
          check1_cent BIGINT NOT NULL,
          check2_cent BIGINT,
          dei_prodotti_cent BIGINT,
          limite_cent BIGINT NOT NULL,
          detraibile_cent BIGINT,
          detrazione_stimata_cent BIGINT,
          avvertenze JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_by BIGINT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
        await tx`CREATE INDEX IF NOT EXISTS computi_commessa_idx
          ON computi (sede_id, commessa_id, id DESC)`;
        await tx`CREATE TABLE IF NOT EXISTS computo_voci (
          id BIGSERIAL PRIMARY KEY,
          computo_id BIGINT NOT NULL REFERENCES computi(id) ON DELETE CASCADE,
          ordine INTEGER NOT NULL,
          gruppo TEXT NOT NULL CHECK (gruppo IN ('prodotti','controtelai','opere','eventuali')),
          codice TEXT NOT NULL,
          descrizione TEXT NOT NULL,
          codice_dei TEXT,
          unita TEXT NOT NULL,
          prezzo_unit_cent BIGINT NOT NULL,
          quantita NUMERIC(12,3) NOT NULL,
          limite_cent BIGINT NOT NULL,
          dettaglio JSONB NOT NULL DEFAULT '{}'::jsonb,
          inclusa BOOLEAN NOT NULL DEFAULT TRUE,
          in_check1 BOOLEAN NOT NULL DEFAULT TRUE,
          in_check2 BOOLEAN NOT NULL DEFAULT TRUE
        )`;
        await tx`CREATE INDEX IF NOT EXISTS computo_voci_computo_idx
          ON computo_voci (computo_id, ordine)`;
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
    async salva({ computo: c, now }) {
      await ensureSchema();
      return sql.begin(async tx => {
        const rows = await tx`INSERT INTO computi (
          sede_id, commessa_id, hash_righe, hash_parametri, tariffe_al, zona, esito,
          check1_cent, check2_cent, dei_prodotti_cent, limite_cent, detraibile_cent, detrazione_stimata_cent,
          avvertenze, created_by, created_at
        ) VALUES (
          ${c.sedeId}, ${c.commessaId}, ${c.hashRighe}, ${c.hashParametri}, ${c.tariffeAl},
          ${c.zona}, ${c.esito}, ${c.check1Cent}, ${c.check2Cent}, ${c.deiProdottiCent}, ${c.limiteCent},
          ${c.detraibileCent}, ${c.detrazioneStimataCent}, ${tx.json(c.avvertenze as any)},
          ${c.createdBy}, ${now}
        ) RETURNING *`;
        const id = Number(rows[0].id);
        const voci: VoceComputo[] = [];
        for (const v of c.voci) {
          const ins = await tx`INSERT INTO computo_voci (
            computo_id, ordine, gruppo, codice, descrizione, codice_dei, unita,
            prezzo_unit_cent, quantita, limite_cent, dettaglio, inclusa, in_check1, in_check2
          ) VALUES (
            ${id}, ${v.ordine}, ${v.gruppo}, ${v.codice}, ${v.descrizione}, ${v.codiceDei},
            ${v.unita}, ${v.prezzoUnitCent}, ${v.quantita}, ${v.limiteCent}, ${tx.json(v.dettaglio as any)},
            ${v.inclusa}, ${v.inCheck1}, ${v.inCheck2}
          ) RETURNING *`;
          voci.push(rowToVoce(ins[0]));
        }
        return rowToComputo(rows[0], voci);
      });
    },
    async ultimo(sedeId, commessaId) {
      await ensureSchema();
      const rows = await sql`SELECT * FROM computi
        WHERE sede_id = ${sedeId} AND commessa_id = ${commessaId}
        ORDER BY id DESC LIMIT 1`;
      if (!rows[0]) return null;
      const voci = await sql`SELECT * FROM computo_voci
        WHERE computo_id = ${rows[0].id} ORDER BY ordine`;
      return rowToComputo(rows[0], voci.map(rowToVoce));
    },
  };
}

let singleton: ComputiRepository | null = null;
export function getComputiRepository(): ComputiRepository {
  singleton ??= kvSql
    ? createPostgresComputiRepository(kvSql)
    : createMemoryComputiRepository();
  return singleton;
}
export function _resetComputiRepositoryForTests(): void {
  singleton = null;
}
