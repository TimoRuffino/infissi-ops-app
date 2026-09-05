// Repository delle estrazioni del contratto (piano 3, Task 5): ogni lettura
// del PDF con l'LLM (Task 3: chiamata governata; Task 4: mappatura) produce
// una proposta persistita qui, idempotente per documento + checksum +
// versione del prompt — è `riusabile` che decide se una lettura precedente
// vale ancora, non un confronto rifatto ogni volta dal chiamante. Stesso
// pattern di server/contratti/repository.ts e server/fatture/repository.ts:
// memoria senza DATABASE_URL (test e sviluppo), Postgres altrimenti.
//
// `proposta` è un blob JSONB unico (il contenuto strutturato dell'esito del
// modello, Task 4): si scrive e si rilegge intero, senza scomporlo in
// colonne — come `cliente_snapshot` in server/fatture/repository.ts. Il
// servizio (task successivo) decide quando una proposta va applicata al
// contratto vero; qui si scrive e si rilegge solo quello che arriva.
import { kvSql } from "../../_core/persistence";
import type { EstrazioneContratto, PropostaContratto, StatoEstrazione } from "@shared/contratti/estrazione";

export type EstrazionePersist = Omit<EstrazioneContratto, "id" | "createdAt">;

export type EstrazioniRepository = {
  ensureSchema(): Promise<void>;
  crea(input: EstrazionePersist & { now: Date }): Promise<EstrazioneContratto>;
  perId(sedeId: number, id: number): Promise<EstrazioneContratto | null>;
  /** Più recente per il documento, qualsiasi stato. */
  ultimaPerDocumento(sedeId: number, documentoId: number): Promise<EstrazioneContratto | null>;
  /** Più recente con la stessa firma (documento, checksum, versione prompt) e stato ≠ scartata. */
  riusabile(
    sedeId: number,
    documentoId: number,
    checksum: string,
    promptVersione: string
  ): Promise<EstrazioneContratto | null>;
  /** Più recente prima. */
  perCommessa(sedeId: number, commessaId: number): Promise<EstrazioneContratto[]>;
  aggiornaStato(input: {
    sedeId: number;
    id: number;
    stato: StatoEstrazione;
    applicataBy?: number | null;
    scartataMotivo?: string | null;
    now: Date;
  }): Promise<EstrazioneContratto>;
};

export function createMemoryEstrazioniRepository(): EstrazioniRepository {
  const estrazioni = new Map<number, EstrazioneContratto>();
  let nextId = 1;
  const clona = <T>(x: T): T => structuredClone(x);
  const trova = (sedeId: number, id: number): EstrazioneContratto | null => {
    const e = estrazioni.get(id);
    return e && e.sedeId === sedeId ? e : null;
  };

  return {
    async ensureSchema() {},

    async crea({ now, ...resto }) {
      const id = nextId++;
      const creata: EstrazioneContratto = { ...clona(resto), id, createdAt: now };
      estrazioni.set(id, creata);
      return clona(creata);
    },

    async perId(sedeId, id) {
      const e = trova(sedeId, id);
      return e ? clona(e) : null;
    },

    async ultimaPerDocumento(sedeId, documentoId) {
      const trovate = [...estrazioni.values()]
        .filter(e => e.sedeId === sedeId && e.documentoId === documentoId)
        .sort((a, b) => b.id - a.id);
      return trovate[0] ? clona(trovate[0]) : null;
    },

    async riusabile(sedeId, documentoId, checksum, promptVersione) {
      const trovate = [...estrazioni.values()]
        .filter(
          e =>
            e.sedeId === sedeId &&
            e.documentoId === documentoId &&
            e.documentoChecksum === checksum &&
            e.promptVersione === promptVersione &&
            e.stato !== "scartata"
        )
        .sort((a, b) => b.id - a.id);
      return trovate[0] ? clona(trovate[0]) : null;
    },

    async perCommessa(sedeId, commessaId) {
      return [...estrazioni.values()]
        .filter(e => e.sedeId === sedeId && e.commessaId === commessaId)
        .sort((a, b) => b.id - a.id)
        .map(clona);
    },

    async aggiornaStato({ sedeId, id, stato, applicataBy, scartataMotivo, now }) {
      const e = trova(sedeId, id);
      if (!e) throw new Error("NOT_FOUND: Estrazione non trovata.");
      e.stato = stato;
      if (stato === "applicata") {
        e.applicataAt = now;
        e.applicataBy = applicataBy ?? null;
      }
      if (stato === "scartata") {
        e.scartataMotivo = scartataMotivo ?? null;
      }
      return clona(e);
    },
  };
}

function rowToEstrazione(row: any): EstrazioneContratto {
  return {
    id: Number(row.id),
    sedeId: Number(row.sede_id),
    commessaId: Number(row.commessa_id),
    documentoId: Number(row.documento_id),
    documentoChecksum: row.documento_checksum,
    stato: row.stato,
    promptVersione: row.prompt_versione,
    modello: row.modello ?? null,
    runId: row.run_id ?? null,
    pagine: row.pagine == null ? null : Number(row.pagine),
    ocr: Boolean(row.ocr),
    parser: row.parser ?? null,
    // JSONB: postgres-js lo consegna già come oggetto, nessun JSON.parse.
    proposta: row.proposta as PropostaContratto,
    createdBy: row.created_by == null ? null : Number(row.created_by),
    createdAt: new Date(row.created_at),
    applicataAt: row.applicata_at == null ? null : new Date(row.applicata_at),
    applicataBy: row.applicata_by == null ? null : Number(row.applicata_by),
    scartataMotivo: row.scartata_motivo ?? null,
  };
}

export function createPostgresEstrazioniRepository(sql: NonNullable<typeof kvSql>): EstrazioniRepository {
  let schemaPromise: Promise<void> | null = null;
  const ensureSchema = () => {
    schemaPromise ??= sql
      .begin(async tx => {
        await tx`CREATE TABLE IF NOT EXISTS contratto_estrazioni (
          id BIGSERIAL PRIMARY KEY, sede_id BIGINT NOT NULL, commessa_id BIGINT NOT NULL, documento_id BIGINT NOT NULL,
          documento_checksum TEXT NOT NULL,
          stato TEXT NOT NULL CHECK (stato IN ('proposta','applicata','scartata')),
          prompt_versione TEXT NOT NULL, modello TEXT, run_id TEXT, pagine INTEGER, ocr BOOLEAN NOT NULL DEFAULT FALSE, parser TEXT,
          proposta JSONB NOT NULL,
          created_by BIGINT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          applicata_at TIMESTAMPTZ, applicata_by BIGINT, scartata_motivo TEXT
        )`;
        await tx`CREATE INDEX IF NOT EXISTS contratto_estrazioni_doc_idx
          ON contratto_estrazioni (sede_id, documento_id, id DESC)`;
        await tx`CREATE INDEX IF NOT EXISTS contratto_estrazioni_commessa_idx
          ON contratto_estrazioni (sede_id, commessa_id, id DESC)`;
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

    async crea({ now, ...e }) {
      await ensureSchema();
      const rows = await sql`INSERT INTO contratto_estrazioni (
          sede_id, commessa_id, documento_id, documento_checksum, stato, prompt_versione, modello,
          run_id, pagine, ocr, parser, proposta, created_by, created_at,
          applicata_at, applicata_by, scartata_motivo
        ) VALUES (
          ${e.sedeId}, ${e.commessaId}, ${e.documentoId}, ${e.documentoChecksum}, ${e.stato}, ${e.promptVersione},
          ${e.modello}, ${e.runId}, ${e.pagine}, ${e.ocr}, ${e.parser}, ${sql.json(e.proposta as any)},
          ${e.createdBy}, ${now}, ${e.applicataAt}, ${e.applicataBy}, ${e.scartataMotivo}
        ) RETURNING *`;
      return rowToEstrazione(rows[0]);
    },

    async perId(sedeId, id) {
      await ensureSchema();
      const rows = await sql`SELECT * FROM contratto_estrazioni WHERE id = ${id} AND sede_id = ${sedeId}`;
      return rows[0] ? rowToEstrazione(rows[0]) : null;
    },

    async ultimaPerDocumento(sedeId, documentoId) {
      await ensureSchema();
      const rows = await sql`SELECT * FROM contratto_estrazioni
        WHERE sede_id = ${sedeId} AND documento_id = ${documentoId}
        ORDER BY id DESC LIMIT 1`;
      return rows[0] ? rowToEstrazione(rows[0]) : null;
    },

    async riusabile(sedeId, documentoId, checksum, promptVersione) {
      await ensureSchema();
      const rows = await sql`SELECT * FROM contratto_estrazioni
        WHERE sede_id = ${sedeId} AND documento_id = ${documentoId}
          AND documento_checksum = ${checksum} AND prompt_versione = ${promptVersione}
          AND stato <> ${"scartata"}
        ORDER BY id DESC LIMIT 1`;
      return rows[0] ? rowToEstrazione(rows[0]) : null;
    },

    async perCommessa(sedeId, commessaId) {
      await ensureSchema();
      const rows = await sql`SELECT * FROM contratto_estrazioni
        WHERE sede_id = ${sedeId} AND commessa_id = ${commessaId}
        ORDER BY id DESC`;
      return rows.map(rowToEstrazione);
    },

    async aggiornaStato({ sedeId, id, stato, applicataBy, scartataMotivo, now }) {
      await ensureSchema();
      // SET solo sulle colonne rilevanti per il nuovo stato: una scrittura
      // che scarta non deve azzerare in silenzio applicata_at/applicata_by
      // di una applicazione precedente, e viceversa (stesso principio del
      // SET dinamico di server/fatture/repository.ts).
      const colonne: Record<string, unknown> = { stato };
      if (stato === "applicata") {
        colonne.applicata_at = now;
        colonne.applicata_by = applicataBy ?? null;
      }
      if (stato === "scartata") {
        colonne.scartata_motivo = scartataMotivo ?? null;
      }
      const rows = await sql`UPDATE contratto_estrazioni SET ${sql(colonne, ...Object.keys(colonne))}
        WHERE id = ${id} AND sede_id = ${sedeId}
        RETURNING *`;
      if (!rows[0]) throw new Error("NOT_FOUND: Estrazione non trovata.");
      return rowToEstrazione(rows[0]);
    },
  };
}

let singleton: EstrazioniRepository | null = null;
export function getEstrazioniRepository(): EstrazioniRepository {
  singleton ??= kvSql ? createPostgresEstrazioniRepository(kvSql) : createMemoryEstrazioniRepository();
  return singleton;
}

/** Solo test: ripristina il repository in memoria tra una suite e l'altra. */
export function _resetEstrazioniRepositoryForTests(): void {
  singleton = null;
}
