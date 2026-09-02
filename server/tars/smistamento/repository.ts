// Registro dello smistamento (02/09/2026): un record per comunicazione
// smistata, con l'esito, la proposta e il suo stato. Tabella ADDITIVA su
// PostgreSQL (jsonb scritto con sql.json: mai `JSON.stringify(...)::jsonb`,
// v. server/_core/persistence.ts); in memoria solo nei test. Senza
// storage autorevole lo smistamento non gira (fail-closed): proposte
// volatili produrrebbero doppioni a ogni riavvio.

import { kvSql } from "../../_core/persistence";
import {
  comunicazioneDaRiga,
  listInIngresso,
  type Comunicazione,
} from "../../comunicazioni/comunicazioni";
import type {
  EsitoSmistamento,
  RecordSmistamento,
  StatoProposta,
  StatoSmistamento,
} from "./types";

export type RepositorySmistamento = {
  ensureSchema(): Promise<void>;
  /** Comunicazioni in ingresso non ancora nel registro, recenti prima. */
  prossime(input: {
    sedeId: number;
    daRicevutaAl: Date;
    limite: number;
  }): Promise<Comunicazione[]>;
  registra(record: {
    comunicazioneId: number;
    sedeId: number;
    versione: string;
    stato: StatoSmistamento;
    esito: EsitoSmistamento | null;
    propostaStato: StatoProposta;
    ultimoErrore: string | null;
    now: Date;
  }): Promise<RecordSmistamento>;
  perComunicazione(
    sedeId: number,
    comunicazioneId: number
  ): Promise<RecordSmistamento | null>;
  /** Record con proposta aperta, i più recenti prima. */
  proposteAperte(sedeId: number, limite: number): Promise<RecordSmistamento[]>;
  /** Record analizzati di recente (per briefing e liste), i più recenti prima. */
  recenti(input: {
    sedeId: number;
    daAggiornataAl: Date;
    limite: number;
  }): Promise<RecordSmistamento[]>;
  /** Guardato sullo stato corrente: vince chi decide per primo. */
  decidiProposta(input: {
    sedeId: number;
    comunicazioneId: number;
    stato: Exclude<StatoProposta, "nessuna" | "aperta">;
    utenteId: number | null;
    now: Date;
  }): Promise<RecordSmistamento | null>;
  statistiche(sedeId: number): Promise<{
    analizzate: number;
    errori: number;
    proposteAperte: number;
    ultimoSmistamentoAt: Date | null;
  }>;
};

function esitoTollerante(valore: unknown): EsitoSmistamento | null {
  if (valore == null) return null;
  if (typeof valore === "string") {
    try {
      return JSON.parse(valore) as EsitoSmistamento;
    } catch {
      return null;
    }
  }
  return valore as EsitoSmistamento;
}

function rigaDaDb(row: any): RecordSmistamento {
  return {
    comunicazioneId: Number(row.comunicazione_id),
    sedeId: Number(row.sede_id),
    versione: String(row.versione),
    stato: row.stato,
    esito: esitoTollerante(row.esito),
    propostaStato: row.proposta_stato,
    tentativi: Number(row.tentativi ?? 0),
    ultimoErrore: row.ultimo_errore ?? null,
    decisaDa: row.decisa_da == null ? null : Number(row.decisa_da),
    decisaAt: row.decisa_at ? new Date(row.decisa_at) : null,
    createdAt: new Date(row.created_at),
    aggiornataAt: new Date(row.aggiornata_at),
  };
}

export function creaRepositorySmistamentoMemoriaPerTest(): RepositorySmistamento {
  const records = new Map<string, RecordSmistamento>();
  const chiave = (sedeId: number, id: number) => `${sedeId}|${id}`;
  return {
    async ensureSchema() {},
    async prossime({ sedeId, daRicevutaAl, limite }) {
      const escludi = new Set(
        [...records.values()]
          .filter(r => r.sedeId === sedeId)
          .map(r => r.comunicazioneId)
      );
      return listInIngresso({ sedeId, daRicevutaAl, limite, escludi });
    },
    async registra(input) {
      const esistente = records.get(chiave(input.sedeId, input.comunicazioneId));
      const record: RecordSmistamento = {
        comunicazioneId: input.comunicazioneId,
        sedeId: input.sedeId,
        versione: input.versione,
        stato: input.stato,
        esito: input.esito,
        propostaStato: input.propostaStato,
        tentativi: (esistente?.tentativi ?? 0) + 1,
        ultimoErrore: input.ultimoErrore,
        decisaDa: esistente?.decisaDa ?? null,
        decisaAt: esistente?.decisaAt ?? null,
        createdAt: esistente?.createdAt ?? input.now,
        aggiornataAt: input.now,
      };
      records.set(chiave(input.sedeId, input.comunicazioneId), record);
      return structuredClone(record);
    },
    async perComunicazione(sedeId, comunicazioneId) {
      const record = records.get(chiave(sedeId, comunicazioneId));
      return record ? structuredClone(record) : null;
    },
    async proposteAperte(sedeId, limite) {
      return [...records.values()]
        .filter(r => r.sedeId === sedeId && r.propostaStato === "aperta")
        .sort((a, b) => b.aggiornataAt.getTime() - a.aggiornataAt.getTime())
        .slice(0, limite)
        .map(r => structuredClone(r));
    },
    async recenti({ sedeId, daAggiornataAl, limite }) {
      return [...records.values()]
        .filter(
          r =>
            r.sedeId === sedeId &&
            r.stato === "analizzata" &&
            r.aggiornataAt.getTime() >= daAggiornataAl.getTime()
        )
        .sort((a, b) => b.aggiornataAt.getTime() - a.aggiornataAt.getTime())
        .slice(0, limite)
        .map(r => structuredClone(r));
    },
    async decidiProposta({ sedeId, comunicazioneId, stato, utenteId, now }) {
      const record = records.get(chiave(sedeId, comunicazioneId));
      if (!record || record.propostaStato !== "aperta") return null;
      record.propostaStato = stato;
      record.decisaDa = utenteId;
      record.decisaAt = now;
      record.aggiornataAt = now;
      return structuredClone(record);
    },
    async statistiche(sedeId) {
      const miei = [...records.values()].filter(r => r.sedeId === sedeId);
      return {
        analizzate: miei.filter(r => r.stato === "analizzata").length,
        errori: miei.filter(r => r.stato === "errore").length,
        proposteAperte: miei.filter(r => r.propostaStato === "aperta").length,
        ultimoSmistamentoAt:
          miei.length === 0
            ? null
            : new Date(Math.max(...miei.map(r => r.aggiornataAt.getTime()))),
      };
    },
  };
}

function creaRepositorySmistamentoPostgres(): RepositorySmistamento {
  const sql = kvSql!;
  let pronta = false;
  const assicura = async () => {
    if (pronta) return;
    await sql`CREATE TABLE IF NOT EXISTS tars_smistamento (
      comunicazione_id BIGINT PRIMARY KEY,
      sede_id INTEGER NOT NULL,
      versione TEXT NOT NULL,
      stato TEXT NOT NULL,
      esito JSONB NULL,
      proposta_stato TEXT NOT NULL DEFAULT 'nessuna',
      tentativi INTEGER NOT NULL DEFAULT 0,
      ultimo_errore TEXT NULL,
      decisa_da INTEGER NULL,
      decisa_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      aggiornata_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS tars_smistamento_sede_proposta
      ON tars_smistamento (sede_id, proposta_stato, aggiornata_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS tars_smistamento_sede_aggiornata
      ON tars_smistamento (sede_id, aggiornata_at DESC)`;
    pronta = true;
  };

  return {
    ensureSchema: assicura,
    async prossime({ sedeId, daRicevutaAl, limite }) {
      await assicura();
      const righe = await sql`
        SELECT c.* FROM comunicazioni c
        LEFT JOIN tars_smistamento s ON s.comunicazione_id = c.id
        WHERE c.sede_id = ${sedeId}
          AND c.direzione = 'in'
          AND c.deleted_at IS NULL
          AND c.received_at >= ${daRicevutaAl}
          AND s.comunicazione_id IS NULL
        ORDER BY c.received_at DESC
        LIMIT ${limite}`;
      return righe.map(comunicazioneDaRiga);
    },
    async registra(input) {
      await assicura();
      const [riga] = await sql`INSERT INTO tars_smistamento (
          comunicazione_id, sede_id, versione, stato, esito, proposta_stato,
          tentativi, ultimo_errore, created_at, aggiornata_at
        ) VALUES (
          ${input.comunicazioneId}, ${input.sedeId}, ${input.versione},
          ${input.stato}, ${input.esito == null ? null : sql.json(input.esito as any)},
          ${input.propostaStato}, 1, ${input.ultimoErrore}, ${input.now}, ${input.now}
        )
        ON CONFLICT (comunicazione_id) DO UPDATE SET
          versione = EXCLUDED.versione,
          stato = EXCLUDED.stato,
          esito = EXCLUDED.esito,
          proposta_stato = EXCLUDED.proposta_stato,
          tentativi = tars_smistamento.tentativi + 1,
          ultimo_errore = EXCLUDED.ultimo_errore,
          aggiornata_at = EXCLUDED.aggiornata_at
        RETURNING *`;
      return rigaDaDb(riga);
    },
    async perComunicazione(sedeId, comunicazioneId) {
      await assicura();
      const [riga] = await sql`SELECT * FROM tars_smistamento
        WHERE sede_id = ${sedeId} AND comunicazione_id = ${comunicazioneId}`;
      return riga ? rigaDaDb(riga) : null;
    },
    async proposteAperte(sedeId, limite) {
      await assicura();
      const righe = await sql`SELECT * FROM tars_smistamento
        WHERE sede_id = ${sedeId} AND proposta_stato = 'aperta'
        ORDER BY aggiornata_at DESC LIMIT ${limite}`;
      return righe.map(rigaDaDb);
    },
    async recenti({ sedeId, daAggiornataAl, limite }) {
      await assicura();
      const righe = await sql`SELECT * FROM tars_smistamento
        WHERE sede_id = ${sedeId} AND stato = 'analizzata'
          AND aggiornata_at >= ${daAggiornataAl}
        ORDER BY aggiornata_at DESC LIMIT ${limite}`;
      return righe.map(rigaDaDb);
    },
    async decidiProposta({ sedeId, comunicazioneId, stato, utenteId, now }) {
      await assicura();
      const [riga] = await sql`UPDATE tars_smistamento SET
          proposta_stato = ${stato},
          decisa_da = ${utenteId},
          decisa_at = ${now},
          aggiornata_at = ${now}
        WHERE sede_id = ${sedeId} AND comunicazione_id = ${comunicazioneId}
          AND proposta_stato = 'aperta'
        RETURNING *`;
      return riga ? rigaDaDb(riga) : null;
    },
    async statistiche(sedeId) {
      await assicura();
      const [riga] = await sql`SELECT
          count(*) FILTER (WHERE stato = 'analizzata') AS analizzate,
          count(*) FILTER (WHERE stato = 'errore') AS errori,
          count(*) FILTER (WHERE proposta_stato = 'aperta') AS proposte_aperte,
          max(aggiornata_at) AS ultimo
        FROM tars_smistamento WHERE sede_id = ${sedeId}`;
      return {
        analizzate: Number(riga?.analizzate ?? 0),
        errori: Number(riga?.errori ?? 0),
        proposteAperte: Number(riga?.proposte_aperte ?? 0),
        ultimoSmistamentoAt: riga?.ultimo ? new Date(riga.ultimo) : null,
      };
    },
  };
}

let singleton: RepositorySmistamento | null = null;
let overrideTest: RepositorySmistamento | null = null;

export function repositorySmistamentoAutorevoleDisponibile(): boolean {
  return Boolean(kvSql) || overrideTest != null;
}

export function repositorySmistamentoCorrente(): RepositorySmistamento {
  if (overrideTest) return overrideTest;
  if (!singleton) {
    singleton = kvSql
      ? creaRepositorySmistamentoPostgres()
      : creaRepositorySmistamentoMemoriaPerTest();
  }
  return singleton;
}

export function impostaRepositorySmistamentoPerTest(
  repository: RepositorySmistamento | null
): void {
  overrideTest = repository;
}
