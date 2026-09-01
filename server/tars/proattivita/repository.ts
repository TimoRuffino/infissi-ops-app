// Persistenza delle osservazioni dell'osservatore (T6).
//
// Tabelle ADDITIVE, chiave unica (sede, caso, detector, versione detector),
// storico append-only dentro la riga. PostgreSQL quando disponibile; il
// fallback in memoria vive solo nei test — l'osservatore in produzione
// senza database autorevole semplicemente non scrive (fail-closed), perché
// osservazioni volatili darebbero deduplica e cooldown falsi.

import { kvSql } from "../../_core/persistence";
import {
  COOLDOWN_AUTO_RISOLUZIONE_MS,
  type EventoOsservazione,
  type NuovaOsservazione,
  type OsservazioneTars,
  type StatoOsservazione,
} from "./types";

export type EsitoUpsertOsservazione = {
  record: OsservazioneTars;
  esito: "aperta" | "aggiornata" | "invariata" | "riaperta" | "in_cooldown";
};

export type RepositoryOsservazioni = {
  ensureSchema(): Promise<void>;
  upsert(nuova: NuovaOsservazione, now: Date): Promise<EsitoUpsertOsservazione>;
  /**
   * Auto-risolve le osservazioni aperte i cui casi non esistono più, o il
   * cui detector non è più quello corrente del caso. Un caso ancora vivo
   * ma sceso sotto materialità NON risolve (resta nel Centro Azioni).
   */
  risolviAssenti(input: {
    sedeId: number;
    /** casoKey → detector corrente, per TUTTI i casi vivi della sede. */
    casiVivi: ReadonlyMap<string, string>;
    now: Date;
  }): Promise<number>;
  lista(input: {
    sedeId: number;
    stato?: StatoOsservazione;
    limite?: number;
  }): Promise<OsservazioneTars[]>;
};

function chiaveDi(o: {
  sedeId: number;
  casoKey: string;
  detector: string;
  detectorVersione: string;
}): string {
  return `${o.sedeId}|${o.casoKey}|${o.detector}|${o.detectorVersione}`;
}

function applicaUpsert(
  esistente: OsservazioneTars | null,
  nuova: NuovaOsservazione,
  now: Date
): { record: OsservazioneTars; esito: EsitoUpsertOsservazione["esito"] } {
  if (!esistente) {
    const evento: EventoOsservazione = {
      tipo: "aperta",
      fingerprint: nuova.fingerprint,
      at: now,
    };
    return {
      esito: "aperta",
      record: {
        ...nuova,
        id: 0,
        stato: "aperta",
        cooldownFinoA: null,
        storico: [evento],
        apertaAt: now,
        aggiornataAt: now,
        risoltaAt: null,
      },
    };
  }
  if (esistente.stato === "aperta") {
    if (esistente.fingerprint === nuova.fingerprint) {
      return { esito: "invariata", record: esistente };
    }
    return {
      esito: "aggiornata",
      record: {
        ...esistente,
        ...nuova,
        id: esistente.id,
        stato: "aperta",
        cooldownFinoA: esistente.cooldownFinoA,
        storico: [
          ...esistente.storico,
          { tipo: "aggiornata", fingerprint: nuova.fingerprint, at: now },
        ],
        apertaAt: esistente.apertaAt,
        aggiornataAt: now,
        risoltaAt: null,
      },
    };
  }
  // Auto-risolta: riapre solo con evidenze nuove, oppure con la stessa
  // evidenza ricomparsa DOPO il cooldown (la condizione è davvero tornata).
  const stessaEvidenza = esistente.fingerprint === nuova.fingerprint;
  const inCooldown =
    esistente.cooldownFinoA != null &&
    esistente.cooldownFinoA.getTime() > now.getTime();
  if (stessaEvidenza && inCooldown) {
    return { esito: "in_cooldown", record: esistente };
  }
  return {
    esito: "riaperta",
    record: {
      ...esistente,
      ...nuova,
      id: esistente.id,
      stato: "aperta",
      cooldownFinoA: null,
      storico: [
        ...esistente.storico,
        { tipo: "riaperta", fingerprint: nuova.fingerprint, at: now },
      ],
      apertaAt: esistente.apertaAt,
      aggiornataAt: now,
      risoltaAt: null,
    },
  };
}

export function creaRepositoryOsservazioniMemoriaPerTest(): RepositoryOsservazioni {
  const records = new Map<string, OsservazioneTars>();
  let nextId = 1;
  return {
    async ensureSchema() {},
    async upsert(nuova, now) {
      const chiave = chiaveDi(nuova);
      const applicato = applicaUpsert(
        records.get(chiave) ?? null,
        nuova,
        now
      );
      if (applicato.esito === "invariata" || applicato.esito === "in_cooldown") {
        return {
          record: structuredClone(applicato.record),
          esito: applicato.esito,
        };
      }
      const record =
        applicato.record.id === 0
          ? { ...applicato.record, id: nextId++ }
          : applicato.record;
      records.set(chiave, record);
      return { record: structuredClone(record), esito: applicato.esito };
    },
    async risolviAssenti({ sedeId, casiVivi, now }) {
      let risolte = 0;
      for (const record of records.values()) {
        if (record.sedeId !== sedeId || record.stato !== "aperta") continue;
        if (casiVivi.get(record.casoKey) === record.detector) continue;
        record.stato = "auto_risolta";
        record.risoltaAt = now;
        record.aggiornataAt = now;
        record.cooldownFinoA = new Date(
          now.getTime() + COOLDOWN_AUTO_RISOLUZIONE_MS
        );
        record.storico = [
          ...record.storico,
          { tipo: "auto_risolta", fingerprint: record.fingerprint, at: now },
        ];
        risolte += 1;
      }
      return risolte;
    },
    async lista({ sedeId, stato, limite = 100 }) {
      return [...records.values()]
        .filter(
          record =>
            record.sedeId === sedeId && (stato == null || record.stato === stato)
        )
        .sort((a, b) => b.aggiornataAt.getTime() - a.aggiornataAt.getTime())
        .slice(0, limite)
        .map(record => structuredClone(record));
    },
  };
}

function rigaDaDb(row: any): OsservazioneTars {
  return {
    id: Number(row.id),
    sedeId: Number(row.sede_id),
    casoKey: String(row.caso_key),
    detector: String(row.detector),
    detectorVersione: String(row.detector_versione),
    fingerprint: String(row.fingerprint),
    commessaId: row.commessa_id == null ? null : Number(row.commessa_id),
    targetType: row.target_type,
    targetId: Number(row.target_id),
    titolo: String(row.titolo),
    sintesi: String(row.sintesi),
    priorita: row.priorita,
    materialita: row.materialita,
    confidenza: row.confidenza,
    stato: row.stato,
    cooldownFinoA: row.cooldown_fino_a ? new Date(row.cooldown_fino_a) : null,
    storico: (Array.isArray(row.storico) ? row.storico : []).map(
      (evento: any) => ({
        tipo: evento.tipo,
        fingerprint: String(evento.fingerprint ?? ""),
        at: new Date(evento.at),
      })
    ),
    apertaAt: new Date(row.aperta_at),
    aggiornataAt: new Date(row.aggiornata_at),
    risoltaAt: row.risolta_at ? new Date(row.risolta_at) : null,
  };
}

function creaRepositoryOsservazioniPostgres(): RepositoryOsservazioni {
  const sql = kvSql!;
  let pronta = false;
  const assicura = async () => {
    if (pronta) return;
    await sql`CREATE TABLE IF NOT EXISTS tars_osservazioni (
      id SERIAL PRIMARY KEY,
      sede_id INTEGER NOT NULL,
      caso_key TEXT NOT NULL,
      detector TEXT NOT NULL,
      detector_versione TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      commessa_id INTEGER NULL,
      target_type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      titolo TEXT NOT NULL,
      sintesi TEXT NOT NULL,
      priorita TEXT NOT NULL,
      materialita TEXT NOT NULL,
      confidenza TEXT NOT NULL,
      stato TEXT NOT NULL,
      cooldown_fino_a TIMESTAMPTZ NULL,
      storico JSONB NOT NULL DEFAULT '[]'::jsonb,
      aperta_at TIMESTAMPTZ NOT NULL,
      aggiornata_at TIMESTAMPTZ NOT NULL,
      risolta_at TIMESTAMPTZ NULL,
      UNIQUE (sede_id, caso_key, detector, detector_versione)
    )`;
    await sql`CREATE INDEX IF NOT EXISTS tars_osservazioni_sede_stato
      ON tars_osservazioni (sede_id, stato, aggiornata_at DESC)`;
    pronta = true;
  };

  const leggi = async (
    nuova: NuovaOsservazione
  ): Promise<OsservazioneTars | null> => {
    const righe = await sql`SELECT * FROM tars_osservazioni
      WHERE sede_id = ${nuova.sedeId} AND caso_key = ${nuova.casoKey}
        AND detector = ${nuova.detector}
        AND detector_versione = ${nuova.detectorVersione}
      LIMIT 1`;
    return righe.length ? rigaDaDb(righe[0]) : null;
  };

  return {
    ensureSchema: assicura,
    async upsert(nuova, now) {
      await assicura();
      const esistente = await leggi(nuova);
      const applicato = applicaUpsert(esistente, nuova, now);
      if (applicato.esito === "invariata" || applicato.esito === "in_cooldown") {
        return { record: applicato.record, esito: applicato.esito };
      }
      const record = applicato.record;
      const storicoJson = JSON.stringify(
        record.storico.map(evento => ({
          tipo: evento.tipo,
          fingerprint: evento.fingerprint,
          at: evento.at.toISOString(),
        }))
      );
      if (record.id === 0) {
        const [riga] = await sql`INSERT INTO tars_osservazioni (
            sede_id, caso_key, detector, detector_versione, fingerprint,
            commessa_id, target_type, target_id, titolo, sintesi, priorita,
            materialita, confidenza, stato, cooldown_fino_a, storico,
            aperta_at, aggiornata_at, risolta_at
          ) VALUES (
            ${record.sedeId}, ${record.casoKey}, ${record.detector},
            ${record.detectorVersione}, ${record.fingerprint},
            ${record.commessaId}, ${record.targetType}, ${record.targetId},
            ${record.titolo}, ${record.sintesi}, ${record.priorita},
            ${record.materialita}, ${record.confidenza}, ${record.stato},
            ${record.cooldownFinoA}, ${storicoJson}::jsonb,
            ${record.apertaAt}, ${record.aggiornataAt}, ${record.risoltaAt}
          )
          ON CONFLICT (sede_id, caso_key, detector, detector_versione)
          DO NOTHING
          RETURNING *`;
        if (riga) return { record: rigaDaDb(riga), esito: applicato.esito };
        // Corsa persa: un altro processo ha inserito prima. Rileggi e
        // riapplica sull'esistente.
        const vinto = await leggi(nuova);
        if (!vinto) throw new Error("tars_osservazioni: inserimento in corsa non rileggibile");
        const riapplicato = applicaUpsert(vinto, nuova, now);
        if (
          riapplicato.esito === "invariata" ||
          riapplicato.esito === "in_cooldown"
        ) {
          return { record: vinto, esito: riapplicato.esito };
        }
        return this.upsert(nuova, now);
      }
      // Guardia ottimistica (revisione I3): l'aggiornamento vale solo se
      // la riga è ancora quella letta; un risolviAssenti interlacciato non
      // viene sovrascritto — si rilegge e si riapplica.
      const [riga] = await sql`UPDATE tars_osservazioni SET
          fingerprint = ${record.fingerprint},
          commessa_id = ${record.commessaId},
          target_type = ${record.targetType},
          target_id = ${record.targetId},
          titolo = ${record.titolo},
          sintesi = ${record.sintesi},
          priorita = ${record.priorita},
          materialita = ${record.materialita},
          confidenza = ${record.confidenza},
          stato = ${record.stato},
          cooldown_fino_a = ${record.cooldownFinoA},
          storico = ${storicoJson}::jsonb,
          aggiornata_at = ${record.aggiornataAt},
          risolta_at = ${record.risoltaAt}
        WHERE id = ${record.id}
          AND stato = ${esistente!.stato}
          AND aggiornata_at = ${esistente!.aggiornataAt}
        RETURNING *`;
      if (!riga) {
        const riletta = await leggi(nuova);
        if (!riletta) throw new Error("tars_osservazioni: riga sparita durante l'aggiornamento");
        const riapplicato = applicaUpsert(riletta, nuova, now);
        if (
          riapplicato.esito === "invariata" ||
          riapplicato.esito === "in_cooldown"
        ) {
          return { record: riletta, esito: riapplicato.esito };
        }
        return this.upsert(nuova, now);
      }
      return { record: rigaDaDb(riga), esito: applicato.esito };
    },
    async risolviAssenti({ sedeId, casiVivi, now }) {
      await assicura();
      const aperte = await sql`SELECT * FROM tars_osservazioni
        WHERE sede_id = ${sedeId} AND stato = 'aperta'`;
      let risolte = 0;
      for (const riga of aperte) {
        const record = rigaDaDb(riga);
        if (casiVivi.get(record.casoKey) === record.detector) continue;
        // Evento appeso lato SQL e stato guardato: un upsert concorrente
        // non può cancellare l'auto-risoluzione né perdere lo storico.
        const evento = JSON.stringify([{
          tipo: "auto_risolta",
          fingerprint: record.fingerprint,
          at: now.toISOString(),
        }]);
        const aggiornate = await sql`UPDATE tars_osservazioni SET
            stato = 'auto_risolta',
            risolta_at = ${now},
            aggiornata_at = ${now},
            cooldown_fino_a = ${new Date(now.getTime() + COOLDOWN_AUTO_RISOLUZIONE_MS)},
            storico = storico || ${evento}::jsonb
          WHERE id = ${record.id} AND stato = 'aperta'
          RETURNING id`;
        risolte += aggiornate.length;
      }
      return risolte;
    },
    async lista({ sedeId, stato, limite = 100 }) {
      await assicura();
      const righe = stato
        ? await sql`SELECT * FROM tars_osservazioni
            WHERE sede_id = ${sedeId} AND stato = ${stato}
            ORDER BY aggiornata_at DESC LIMIT ${limite}`
        : await sql`SELECT * FROM tars_osservazioni
            WHERE sede_id = ${sedeId}
            ORDER BY aggiornata_at DESC LIMIT ${limite}`;
      return righe.map(rigaDaDb);
    },
  };
}

let singleton: RepositoryOsservazioni | null = null;
let overrideTest: RepositoryOsservazioni | null = null;

/** Repository autorevole disponibile: senza PostgreSQL non si osserva. */
export function repositoryOsservazioniAutorevoleDisponibile(): boolean {
  return Boolean(kvSql) || process.env.NODE_ENV === "test";
}

export function repositoryOsservazioniCorrente(): RepositoryOsservazioni {
  if (overrideTest) return overrideTest;
  if (singleton) return singleton;
  if (kvSql) return (singleton = creaRepositoryOsservazioniPostgres());
  if (process.env.NODE_ENV === "test") {
    return (singleton = creaRepositoryOsservazioniMemoriaPerTest());
  }
  throw new Error(
    "OSSERVAZIONI_ASSENTI: senza DATABASE_URL l'osservatore è fail-closed."
  );
}

export function impostaRepositoryOsservazioniPerTest(
  repository: RepositoryOsservazioni | null
): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("OSSERVAZIONI_TEST_ONLY: l'override è riservato ai test.");
  }
  overrideTest = repository;
  if (!kvSql) singleton = null;
}
