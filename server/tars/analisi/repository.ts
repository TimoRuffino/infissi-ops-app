// Registro `tars_analisi_azienda`: una analisi per sede al giorno (jsonb con
// sql.json, mai JSON.stringify::jsonb). Senza PostgreSQL: memoria.

import { kvSql } from "../../_core/persistence";
import type { EsitoAnalisiAzienda, RecordAnalisiAzienda, StatoAnalisiAzienda } from "./types";

export type NuovaAnalisiAzienda = {
  sedeId: number;
  giorno: string;
  versione: string;
  stato: StatoAnalisiAzienda;
  esito: EsitoAnalisiAzienda | null;
  errore: string | null;
  richiestaDa: number | null;
  now: Date;
};

export type RepositoryAnalisiAzienda = {
  ensureSchema(): Promise<void>;
  /** Inserisce o sostituisce l'analisi del giorno per la sede. */
  salva(input: NuovaAnalisiAzienda): Promise<RecordAnalisiAzienda>;
  ultima(sedeId: number): Promise<RecordAnalisiAzienda | null>;
  perGiorno(sedeId: number, giorno: string): Promise<RecordAnalisiAzienda | null>;
};

function jsonbTollerante<T>(valore: unknown): T | null {
  if (valore == null) return null;
  if (typeof valore === "string") {
    try {
      return JSON.parse(valore) as T;
    } catch {
      return null;
    }
  }
  return valore as T;
}

function rigaDaDb(row: any): RecordAnalisiAzienda {
  return {
    id: Number(row.id),
    sedeId: Number(row.sede_id),
    giorno: String(row.giorno).slice(0, 10),
    versione: String(row.versione),
    stato: row.stato as StatoAnalisiAzienda,
    esito: jsonbTollerante<EsitoAnalisiAzienda>(row.esito),
    errore: row.errore ?? null,
    richiestaDa: row.richiesta_da == null ? null : Number(row.richiesta_da),
    tentativi: Number(row.tentativi ?? 1),
    generataAt: new Date(row.generata_at),
  };
}

export function creaRepositoryAnalisiMemoria(): RepositoryAnalisiAzienda {
  const righe: RecordAnalisiAzienda[] = [];
  let prossimoId = 1;
  return {
    async ensureSchema() {},
    async salva(input) {
      const esistente = righe.find(r => r.sedeId === input.sedeId && r.giorno === input.giorno);
      const record: RecordAnalisiAzienda = {
        id: esistente?.id ?? prossimoId++,
        sedeId: input.sedeId,
        giorno: input.giorno,
        versione: input.versione,
        stato: input.stato,
        esito: input.esito,
        errore: input.errore,
        richiestaDa: input.richiestaDa,
        tentativi: (esistente?.tentativi ?? 0) + 1,
        generataAt: input.now,
      };
      if (esistente) Object.assign(esistente, record);
      else righe.push(record);
      return { ...record };
    },
    async ultima(sedeId) {
      const mie = righe.filter(r => r.sedeId === sedeId).sort((a, b) => b.giorno.localeCompare(a.giorno));
      return mie[0] ? { ...mie[0] } : null;
    },
    async perGiorno(sedeId, giorno) {
      const r = righe.find(x => x.sedeId === sedeId && x.giorno === giorno);
      return r ? { ...r } : null;
    },
  };
}

function creaRepositoryAnalisiPostgres(): RepositoryAnalisiAzienda {
  const sql = kvSql!;
  let pronta = false;
  const assicura = async () => {
    if (pronta) return;
    await sql`CREATE TABLE IF NOT EXISTS tars_analisi_azienda (
      id BIGSERIAL PRIMARY KEY,
      sede_id INTEGER NOT NULL,
      giorno DATE NOT NULL,
      versione TEXT NOT NULL,
      stato TEXT NOT NULL,
      esito JSONB NULL,
      errore TEXT NULL,
      richiesta_da INTEGER NULL,
      generata_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (sede_id, giorno)
    )`;
    // Additiva (02/09 sera): conteggio dei tentativi del giorno per il ritento automatico.
    await sql`ALTER TABLE tars_analisi_azienda ADD COLUMN IF NOT EXISTS tentativi INTEGER NOT NULL DEFAULT 1`;
    pronta = true;
  };
  return {
    ensureSchema: assicura,
    async salva(input) {
      await assicura();
      const [riga] = await sql`INSERT INTO tars_analisi_azienda (
          sede_id, giorno, versione, stato, esito, errore, richiesta_da, tentativi, generata_at
        ) VALUES (
          ${input.sedeId}, ${input.giorno}, ${input.versione}, ${input.stato},
          ${input.esito == null ? null : sql.json(input.esito as any)},
          ${input.errore}, ${input.richiestaDa}, 1, ${input.now}
        )
        ON CONFLICT (sede_id, giorno) DO UPDATE SET
          versione = EXCLUDED.versione,
          stato = EXCLUDED.stato,
          esito = EXCLUDED.esito,
          errore = EXCLUDED.errore,
          richiesta_da = EXCLUDED.richiesta_da,
          tentativi = tars_analisi_azienda.tentativi + 1,
          generata_at = EXCLUDED.generata_at
        RETURNING *`;
      return rigaDaDb(riga);
    },
    async ultima(sedeId) {
      await assicura();
      const [riga] = await sql`SELECT * FROM tars_analisi_azienda
        WHERE sede_id = ${sedeId} ORDER BY giorno DESC LIMIT 1`;
      return riga ? rigaDaDb(riga) : null;
    },
    async perGiorno(sedeId, giorno) {
      await assicura();
      const [riga] = await sql`SELECT * FROM tars_analisi_azienda
        WHERE sede_id = ${sedeId} AND giorno = ${giorno}`;
      return riga ? rigaDaDb(riga) : null;
    },
  };
}

let singleton: RepositoryAnalisiAzienda | null = null;
let overrideTest: RepositoryAnalisiAzienda | null = null;

export function repositoryAnalisiAutorevoleDisponibile(): boolean {
  return Boolean(kvSql);
}

export function repositoryAnalisiCorrente(): RepositoryAnalisiAzienda {
  if (overrideTest) return overrideTest;
  if (singleton) return singleton;
  singleton = kvSql ? creaRepositoryAnalisiPostgres() : creaRepositoryAnalisiMemoria();
  return singleton;
}

export function impostaRepositoryAnalisiPerTest(repository: RepositoryAnalisiAzienda | null): void {
  if (process.env.NODE_ENV !== "test") throw new Error("ANALISI_TEST_ONLY");
  overrideTest = repository;
}
