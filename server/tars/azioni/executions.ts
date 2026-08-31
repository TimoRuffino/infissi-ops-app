import { createHash } from "node:crypto";
import { kvSql } from "../../_core/persistence";
import type { ContestoRun, EsitoAzione } from "../strumenti/tipi";
import type { DescrittoreAzioneTars } from "./types";

export type RigaEsecuzioneR1 = {
  id: number;
  idempotencyKey: string;
  runId: string;
  sedeId: number;
  utenteId: number;
  strumento: string;
  versioneStrumento: string;
  versioneOggetto: string;
  esito: string;
  audit: { auditId: string | null; azioneId: string | null };
  compensazione: { disponibile: boolean; via: string | null };
  createdAt: Date;
};

export type InputEsecuzioneR1 = Omit<RigaEsecuzioneR1, "id">;

export type LedgerEsecuzioniR1 = {
  append(
    input: InputEsecuzioneR1
  ): Promise<{ riga: RigaEsecuzioneR1; inserita: boolean }>;
  lista(input: { sedeId: number }): Promise<RigaEsecuzioneR1[]>;
};

function rigaDaDb(row: any): RigaEsecuzioneR1 {
  return {
    id: Number(row.id),
    idempotencyKey: String(row.idempotency_key),
    runId: String(row.run_id),
    sedeId: Number(row.sede_id),
    utenteId: Number(row.utente_id),
    strumento: String(row.strumento),
    versioneStrumento: String(row.versione_strumento),
    versioneOggetto: String(row.versione_oggetto),
    esito: String(row.esito),
    audit: row.audit,
    compensazione: row.compensazione,
    createdAt: new Date(row.created_at),
  };
}

let schemaPromise: Promise<void> | null = null;

export function ensureEsecuzioniR1Schema(): Promise<void> {
  if (!kvSql) return Promise.resolve();
  schemaPromise ??= kvSql`CREATE TABLE IF NOT EXISTS tars_azioni_esecuzioni (
      id BIGSERIAL PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      run_id TEXT NOT NULL,
      sede_id BIGINT NOT NULL,
      utente_id BIGINT NOT NULL,
      strumento TEXT NOT NULL,
      rischio TEXT NOT NULL DEFAULT 'R1' CHECK (rischio = 'R1'),
      versione_strumento TEXT NOT NULL,
      versione_oggetto TEXT NOT NULL,
      esito TEXT NOT NULL,
      audit JSONB NOT NULL,
      compensazione JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
    .then(async () => {
      await kvSql!`CREATE INDEX IF NOT EXISTS tars_azioni_esecuzioni_sede_idx
        ON tars_azioni_esecuzioni (sede_id, created_at DESC)`;
      await kvSql!`CREATE INDEX IF NOT EXISTS tars_azioni_esecuzioni_run_idx
        ON tars_azioni_esecuzioni (run_id, created_at)`;
    })
    .then(() => undefined)
    .catch(errore => {
      schemaPromise = null;
      throw errore;
    });
  return schemaPromise;
}

function creaLedgerEsecuzioniPostgres(): LedgerEsecuzioniR1 {
  const sql = () => {
    if (!kvSql) {
      throw new Error(
        "LEDGER_ESECUZIONI_ASSENTE: le esecuzioni R1 richiedono PostgreSQL."
      );
    }
    return kvSql;
  };
  return {
    async append(input) {
      const db = sql();
      await ensureEsecuzioniR1Schema();
      const inserite = await db`INSERT INTO tars_azioni_esecuzioni (
          idempotency_key, run_id, sede_id, utente_id, strumento,
          versione_strumento, versione_oggetto, esito, audit, compensazione
        ) VALUES (
          ${input.idempotencyKey}, ${input.runId}, ${input.sedeId},
          ${input.utenteId}, ${input.strumento}, ${input.versioneStrumento},
          ${input.versioneOggetto}, ${input.esito}, ${db.json(input.audit)},
          ${db.json(input.compensazione)}
        ) ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING *`;
      if (inserite[0]) {
        return { riga: rigaDaDb(inserite[0]), inserita: true };
      }
      const [esistente] = await db`SELECT * FROM tars_azioni_esecuzioni
        WHERE idempotency_key = ${input.idempotencyKey} LIMIT 1`;
      if (!esistente) {
        throw new Error("LEDGER_ESECUZIONI_INCOERENTE: riga non rileggibile.");
      }
      return { riga: rigaDaDb(esistente), inserita: false };
    },
    async lista(input) {
      const db = sql();
      await ensureEsecuzioniR1Schema();
      const righe = await db`SELECT * FROM tars_azioni_esecuzioni
        WHERE sede_id = ${input.sedeId} ORDER BY id ASC`;
      return righe.map(rigaDaDb);
    },
  };
}

/** Implementazione volatile esportata esclusivamente per test. */
export function creaLedgerEsecuzioniMemoriaPerTest(): LedgerEsecuzioniR1 {
  const righe: RigaEsecuzioneR1[] = [];
  return {
    async append(input) {
      const esistente = righe.find(
        r => r.idempotencyKey === input.idempotencyKey
      );
      if (esistente) return { riga: esistente, inserita: false };
      const riga: RigaEsecuzioneR1 = {
        ...input,
        id: righe.length + 1,
      };
      righe.push(riga);
      return { riga, inserita: true };
    },
    async lista(input) {
      return righe.filter(r => r.sedeId === input.sedeId).map(r => ({ ...r }));
    },
  };
}

let singleton: LedgerEsecuzioniR1 | null = null;

export function ledgerEsecuzioniAutorevoleDisponibile(): boolean {
  return Boolean(kvSql);
}

export function ledgerEsecuzioniCorrente(): LedgerEsecuzioniR1 {
  if (singleton) return singleton;
  if (kvSql) return (singleton = creaLedgerEsecuzioniPostgres());
  if (process.env.NODE_ENV === "test") {
    return (singleton = creaLedgerEsecuzioniMemoriaPerTest());
  }
  throw new Error(
    "LEDGER_ESECUZIONI_ASSENTE: senza DATABASE_URL le azioni R1 sono fail-closed."
  );
}

function hash(valore: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(valore))
    .digest("hex");
}

function viaCompensazione(esito: EsitoAzione): string | null {
  if (esito.undoVia) {
    return `${esito.undoVia.procedura}:${esito.undoVia.id}`;
  }
  return esito.undoDisponibile ? esito.undoEntro : null;
}

/**
 * Registra l'esito già prodotto dal servizio di dominio. Non riceve callback,
 * non esegue tool e non decide autorizzazioni: il ledger non è una seconda
 * fonte di verità né può duplicare l'effetto.
 */
export async function registraEsecuzioneR1(input: {
  ledger?: LedgerEsecuzioniR1;
  descrittore: DescrittoreAzioneTars;
  contesto: ContestoRun;
  runId: string;
  argomenti: unknown;
  esito: EsitoAzione;
}): Promise<RigaEsecuzioneR1 | null> {
  if (input.descrittore.rischio !== "R1") return null;
  if (input.ledger && process.env.NODE_ENV !== "test") {
    throw new Error(
      "LEDGER_ESECUZIONI_TEST_ONLY: l'iniezione del ledger è riservata ai test."
    );
  }
  const versioneOggetto = `sha256:${hash({
    entita: input.esito.entitaToccate,
    dopo: input.esito.dopo,
  })}`;
  const identitaEffetto =
    input.esito.azioneId ??
    `sha256:${hash({
      sedeId: input.contesto.sedeId,
      strumento: input.descrittore.nome,
      argomenti: input.argomenti,
      stato: input.esito.stato,
    })}`;
  const idempotencyKey = `${input.contesto.sedeId}:${input.descrittore.nome}:${identitaEffetto}`;
  const ledger = input.ledger ?? ledgerEsecuzioniCorrente();
  const registrata = await ledger.append({
    idempotencyKey,
    runId: input.runId,
    sedeId: input.contesto.sedeId,
    utenteId: input.contesto.utenteId,
    strumento: input.descrittore.nome,
    versioneStrumento: input.descrittore.versioneStrumento,
    versioneOggetto,
    esito: input.esito.stato,
    audit: {
      auditId: input.esito.auditId,
      azioneId: input.esito.azioneId,
    },
    compensazione: {
      disponibile: input.esito.undoDisponibile,
      via: viaCompensazione(input.esito),
    },
    createdAt: new Date(input.esito.freschezza),
  });
  return registrata.riga;
}
