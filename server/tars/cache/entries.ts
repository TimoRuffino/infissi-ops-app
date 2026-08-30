// Store persistente delle voci di cache C3/C4 (T3) — spec §12 e §21.
//
// Tabella `tars_cache_entries` (ritmo macchina → PostgreSQL, pattern
// ensureSchema additivo come chat/actionCenter), fallback in memoria
// DICHIARATO senza DATABASE_URL (stessa API; i dati locali sono
// volatili). Le voci portano le versioni osservate: l'invalidazione la
// decide chi legge, confrontandole con le correnti (versioni.ts). Mai
// errori come payload; la marcatura stale è esplicita.

import { kvSql } from "../../_core/persistence";

export type VoceCache = {
  chiave: string;
  sedeId: number;
  tipo: string; // "fascicolo" oggi; altri consumatori C4 domani
  payload: unknown;
  versioni: Record<string, string>;
  stale: boolean;
  aggiornataIl: Date;
};

let schemaPromise: Promise<void> | null = null;

function ensureSchema(): Promise<void> {
  if (!kvSql) return Promise.resolve();
  schemaPromise ??= kvSql`CREATE TABLE IF NOT EXISTS tars_cache_entries (
      chiave TEXT PRIMARY KEY,
      sede_id BIGINT NOT NULL,
      tipo TEXT NOT NULL,
      payload JSONB NOT NULL,
      versioni JSONB NOT NULL DEFAULT '{}'::jsonb,
      stale BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
    .then(() => undefined)
    .catch(errore => {
      schemaPromise = null;
      throw errore;
    });
  return schemaPromise;
}

const memoria = new Map<string, VoceCache>();

export async function leggiVoceCache(
  chiave: string,
  sedeId: number
): Promise<VoceCache | null> {
  if (kvSql) {
    await ensureSchema();
    const rows = await kvSql`SELECT * FROM tars_cache_entries
      WHERE chiave = ${chiave} AND sede_id = ${sedeId} LIMIT 1`;
    if (!rows[0]) return null;
    return {
      chiave: rows[0].chiave,
      sedeId: Number(rows[0].sede_id),
      tipo: rows[0].tipo,
      payload: rows[0].payload,
      versioni: rows[0].versioni ?? {},
      stale: Boolean(rows[0].stale),
      aggiornataIl: new Date(rows[0].updated_at),
    };
  }
  const voce = memoria.get(chiave);
  return voce && voce.sedeId === sedeId ? structuredClone(voce) : null;
}

export async function scriviVoceCache(
  voce: Omit<VoceCache, "aggiornataIl">
): Promise<void> {
  const adesso = new Date();
  if (kvSql) {
    await ensureSchema();
    await kvSql`INSERT INTO tars_cache_entries
        (chiave, sede_id, tipo, payload, versioni, stale, updated_at)
      VALUES (${voce.chiave}, ${voce.sedeId}, ${voce.tipo},
        ${kvSql.json(voce.payload as any)}, ${kvSql.json(voce.versioni)},
        ${voce.stale}, ${adesso})
      ON CONFLICT (chiave) DO UPDATE SET
        payload = EXCLUDED.payload,
        versioni = EXCLUDED.versioni,
        stale = EXCLUDED.stale,
        sede_id = EXCLUDED.sede_id,
        tipo = EXCLUDED.tipo,
        updated_at = EXCLUDED.updated_at`;
    return;
  }
  memoria.set(voce.chiave, {
    ...structuredClone(voce),
    aggiornataIl: adesso,
  } as VoceCache);
}

/** Solo per i test: azzera il fallback in memoria. */
export function azzeraCachePersistentePerTest(): void {
  memoria.clear();
}
