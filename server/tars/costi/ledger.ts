// Ledger delle prenotazioni di spesa (cost hardening) — spec §27,
// decisioni 44-46.
//
// Il ledger AUTOREVOLE vive su PostgreSQL: le prenotazioni si fanno in
// una transazione serializzata da un advisory lock GLOBALE (il tetto
// globale attraversa le sedi, quindi il confine è globale per
// definizione; i volumi previsti rendono il lock innocuo). Senza
// `DATABASE_URL` non esiste ledger autorevole e il provider reale NON
// nasce: `ledgerAutorevoleDisponibile()` è la guardia, e NON è
// influenzabile dall'override di test (che serve solo a provare la
// logica del governor con un provider finto sotto).
//
// Consumo contato (decisione 45):
//   settled                        → costo REALE
//   reserved | expired | uncertain → costo PRENOTATO (conservativo)
//   released                       → 0
// Una prenotazione mai riconciliata (crash fra prenotazione e risposta)
// resta contata: si sovrastima, mai si sottostima.

import { kvSql } from "../../_core/persistence";
import { istanteComeLocale } from "../tempo";

export type StatoPrenotazione =
  | "reserved"
  | "settled"
  | "released"
  | "expired"
  | "uncertain";

export type RigaCosto = {
  chiamataId: string;
  runId: string;
  sedeId: number;
  utenteId: number;
  conversazioneId: number | null;
  modello: string;
  stato: StatoPrenotazione;
  costoPrenotatoNano: number;
  costoRealeNano: number | null;
  tokenInput: number | null;
  tokenCached: number | null;
  tokenOutput: number | null;
  giornoLocale: string; // YYYY-MM-DD Europe/Rome
  meseLocale: string; // YYYY-MM Europe/Rome
  motivo: string | null;
  creataIl: Date;
};

export type ConsumoCorrente = {
  runNano: number;
  giornoNano: number;
  meseNano: number;
};

export type LimitiNano = {
  runNano: number;
  giornoNano: number;
  meseNano: number;
};

export type EsitoPrenotazione =
  | { esito: "prenotata"; riga: RigaCosto }
  | { esito: "gia_presente"; riga: RigaCosto }
  | {
      esito: "rifiutata";
      limite: "run" | "giorno" | "mese";
      consumo: ConsumoCorrente;
      richiestoNano: number;
    };

export type RiepilogoCosti = {
  giorno: string;
  mese: string;
  spesaGiornoNano: number;
  spesaMeseNano: number;
  chiamateGiorno: number;
  runGiorno: number;
  costoMedioRunNano: number;
  costoMassimoRunNano: number;
  tokenGiorno: { input: number; cached: number; output: number };
  perStato: Record<string, number>;
};

export type LedgerCosti = {
  prenota(input: {
    chiamataId: string;
    runId: string;
    sedeId: number;
    utenteId: number;
    conversazioneId: number | null;
    modello: string;
    costoPrenotatoNano: number;
    limiti: LimitiNano;
    adesso: Date;
  }): Promise<EsitoPrenotazione>;
  riconcilia(input: {
    chiamataId: string;
    costoRealeNano: number;
    tokenInput: number;
    tokenCached: number;
    tokenOutput: number;
  }): Promise<void>;
  chiudi(input: {
    chiamataId: string;
    stato: "released" | "uncertain";
    motivo: string;
  }): Promise<void>;
  scadiPrenotazioniVecchie(scadenzaMs: number, adesso: Date): Promise<number>;
  consumoCorrente(input: { runId: string; adesso: Date }): Promise<ConsumoCorrente>;
  riepilogo(adesso: Date): Promise<RiepilogoCosti>;
};

/**
 * Il ledger AUTOREVOLE esiste solo con PostgreSQL. Non guarda
 * l'override di test: nessuna configurazione di test può far nascere il
 * provider reale su un ledger volatile.
 */
export function ledgerAutorevoleDisponibile(): boolean {
  return Boolean(kvSql);
}

/** Giorno e mese nel fuso del dominio (mai UTC: DST e cambio mese). */
export function periodiLocali(istante: Date): { giorno: string; mese: string } {
  const locale = istanteComeLocale(istante).slice(0, 10); // YYYY-MM-DD
  return { giorno: locale, mese: locale.slice(0, 7) };
}

/** Costo contato per una riga, secondo la politica conservativa. */
export function costoContato(riga: {
  stato: StatoPrenotazione;
  costoPrenotatoNano: number;
  costoRealeNano: number | null;
}): number {
  if (riga.stato === "released") return 0;
  // `settled` senza costo reale sarebbe l'unica sottostima possibile
  // dell'intera contabilità: si ricade sul prenotato (revisione).
  if (riga.stato === "settled") {
    return riga.costoRealeNano ?? riga.costoPrenotatoNano;
  }
  return riga.costoPrenotatoNano;
}

function verificaTetti(
  consumo: ConsumoCorrente,
  richiesto: number,
  limiti: LimitiNano
): "run" | "giorno" | "mese" | null {
  if (consumo.runNano + richiesto > limiti.runNano) return "run";
  if (consumo.giornoNano + richiesto > limiti.giornoNano) return "giorno";
  if (consumo.meseNano + richiesto > limiti.meseNano) return "mese";
  return null;
}

function riepilogoDa(
  righe: RigaCosto[],
  adesso: Date
): RiepilogoCosti {
  const { giorno, mese } = periodiLocali(adesso);
  const diOggi = righe.filter(r => r.giornoLocale === giorno);
  const perRun = new Map<string, number>();
  for (const r of diOggi) {
    perRun.set(r.runId, (perRun.get(r.runId) ?? 0) + costoContato(r));
  }
  const costi = [...perRun.values()];
  const perStato: Record<string, number> = {};
  for (const r of diOggi) perStato[r.stato] = (perStato[r.stato] ?? 0) + 1;
  return {
    giorno,
    mese,
    spesaGiornoNano: diOggi.reduce((s, r) => s + costoContato(r), 0),
    spesaMeseNano: righe
      .filter(r => r.meseLocale === mese)
      .reduce((s, r) => s + costoContato(r), 0),
    chiamateGiorno: diOggi.length,
    runGiorno: perRun.size,
    costoMedioRunNano: costi.length
      ? Math.round(costi.reduce((s, c) => s + c, 0) / costi.length)
      : 0,
    costoMassimoRunNano: costi.length ? Math.max(...costi) : 0,
    tokenGiorno: {
      input: diOggi.reduce((s, r) => s + (r.tokenInput ?? 0), 0),
      cached: diOggi.reduce((s, r) => s + (r.tokenCached ?? 0), 0),
      output: diOggi.reduce((s, r) => s + (r.tokenOutput ?? 0), 0),
    },
    perStato,
  };
}

// ── Implementazione autorevole: PostgreSQL ──────────────────────────────

const LOCK_BUDGET = 918_273_645; // chiave costante dell'advisory lock

// NB: le somme sono scritte per esteso nelle query, non interpolate:
// `sql.unsafe()` dentro un template NON produce un frammento (produce
// una Query), e il risultato era un `syntax error at or near "FILTER"`
// scoperto dai test su PostgreSQL reale. Qui tutto ciò che varia è
// parametrizzato; nessun pezzo di SQL è costruito da input.

let schemaPromise: Promise<void> | null = null;

export function ensureCostiSchema(): Promise<void> {
  if (!kvSql) return Promise.resolve();
  schemaPromise ??= kvSql`CREATE TABLE IF NOT EXISTS tars_costi (
      chiamata_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      sede_id BIGINT NOT NULL,
      utente_id BIGINT NOT NULL,
      conversazione_id BIGINT,
      modello TEXT NOT NULL,
      stato TEXT NOT NULL CHECK (stato IN ('reserved','settled','released','expired','uncertain')),
      costo_prenotato_nano BIGINT NOT NULL CHECK (costo_prenotato_nano >= 0),
      costo_reale_nano BIGINT CHECK (costo_reale_nano >= 0),
      token_input BIGINT,
      token_cached BIGINT,
      token_output BIGINT,
      giorno_locale TEXT NOT NULL,
      mese_locale TEXT NOT NULL,
      motivo TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
    .then(async () => {
      await kvSql!`CREATE INDEX IF NOT EXISTS tars_costi_giorno_idx
        ON tars_costi (giorno_locale)`;
      // La scadenza delle prenotazioni appese gira a ogni chiamata
      // governata: senza indice sarebbe una scansione completa.
      await kvSql!`CREATE INDEX IF NOT EXISTS tars_costi_appese_idx
        ON tars_costi (stato, created_at)`;
      await kvSql!`CREATE INDEX IF NOT EXISTS tars_costi_mese_idx
        ON tars_costi (mese_locale)`;
      await kvSql!`CREATE INDEX IF NOT EXISTS tars_costi_run_idx
        ON tars_costi (run_id)`;
    })
    .then(() => undefined)
    .catch(errore => {
      schemaPromise = null;
      throw errore;
    });
  return schemaPromise;
}

function rigaDa(row: any): RigaCosto {
  return {
    chiamataId: row.chiamata_id,
    runId: row.run_id,
    sedeId: Number(row.sede_id),
    utenteId: Number(row.utente_id),
    conversazioneId:
      row.conversazione_id == null ? null : Number(row.conversazione_id),
    modello: row.modello,
    stato: row.stato,
    costoPrenotatoNano: Number(row.costo_prenotato_nano),
    costoRealeNano:
      row.costo_reale_nano == null ? null : Number(row.costo_reale_nano),
    tokenInput: row.token_input == null ? null : Number(row.token_input),
    tokenCached: row.token_cached == null ? null : Number(row.token_cached),
    tokenOutput: row.token_output == null ? null : Number(row.token_output),
    giornoLocale: row.giorno_locale,
    meseLocale: row.mese_locale,
    motivo: row.motivo ?? null,
    creataIl: new Date(row.created_at),
  };
}

export function creaLedgerPostgres(): LedgerCosti {
  const sql = () => {
    if (!kvSql) {
      throw new Error(
        "LEDGER_ASSENTE: il ledger dei costi richiede PostgreSQL (DATABASE_URL)."
      );
    }
    return kvSql;
  };

  return {
    async prenota(input) {
      const db = sql();
      await ensureCostiSchema();
      const { giorno, mese } = periodiLocali(input.adesso);
      return db.begin(async tx => {
        // Serializzazione globale: due prenotazioni concorrenti non
        // possono entrambe vedere il budget libero.
        await tx`SELECT pg_advisory_xact_lock(${LOCK_BUDGET})`;

        const [esistente] = await tx`SELECT * FROM tars_costi
          WHERE chiamata_id = ${input.chiamataId} LIMIT 1`;
        if (esistente) {
          return { esito: "gia_presente", riga: rigaDa(esistente) };
        }

        const [somme] = await tx`SELECT
            COALESCE(SUM(CASE stato
              WHEN 'released' THEN 0
              WHEN 'settled' THEN COALESCE(costo_reale_nano, costo_prenotato_nano)
              ELSE costo_prenotato_nano END)
              FILTER (WHERE run_id = ${input.runId}), 0) AS run,
            COALESCE(SUM(CASE stato
              WHEN 'released' THEN 0
              WHEN 'settled' THEN COALESCE(costo_reale_nano, costo_prenotato_nano)
              ELSE costo_prenotato_nano END)
              FILTER (WHERE giorno_locale = ${giorno}), 0) AS giorno,
            COALESCE(SUM(CASE stato
              WHEN 'released' THEN 0
              WHEN 'settled' THEN COALESCE(costo_reale_nano, costo_prenotato_nano)
              ELSE costo_prenotato_nano END)
              FILTER (WHERE mese_locale = ${mese}), 0) AS mese
          FROM tars_costi`;
        const consumo: ConsumoCorrente = {
          runNano: Number(somme?.run ?? 0),
          giornoNano: Number(somme?.giorno ?? 0),
          meseNano: Number(somme?.mese ?? 0),
        };
        const sforato = verificaTetti(
          consumo,
          input.costoPrenotatoNano,
          input.limiti
        );
        if (sforato) {
          return {
            esito: "rifiutata",
            limite: sforato,
            consumo,
            richiestoNano: input.costoPrenotatoNano,
          };
        }

        const [inserita] = await tx`INSERT INTO tars_costi (
            chiamata_id, run_id, sede_id, utente_id, conversazione_id, modello,
            stato, costo_prenotato_nano, giorno_locale, mese_locale
          ) VALUES (
            ${input.chiamataId}, ${input.runId}, ${input.sedeId}, ${input.utenteId},
            ${input.conversazioneId}, ${input.modello}, 'reserved',
            ${input.costoPrenotatoNano}, ${giorno}, ${mese}
          )
          ON CONFLICT (chiamata_id) DO NOTHING
          RETURNING *`;
        if (!inserita) {
          const [riletta] = await tx`SELECT * FROM tars_costi
            WHERE chiamata_id = ${input.chiamataId} LIMIT 1`;
          return { esito: "gia_presente", riga: rigaDa(riletta) };
        }
        return { esito: "prenotata", riga: rigaDa(inserita) };
      }) as Promise<EsitoPrenotazione>;
    },

    async riconcilia(input) {
      const db = sql();
      await ensureCostiSchema();
      await db`UPDATE tars_costi SET
          stato = 'settled',
          costo_reale_nano = ${input.costoRealeNano},
          token_input = ${input.tokenInput},
          token_cached = ${input.tokenCached},
          token_output = ${input.tokenOutput},
          updated_at = NOW()
        WHERE chiamata_id = ${input.chiamataId} AND stato = 'reserved'`;
    },

    async chiudi(input) {
      const db = sql();
      await ensureCostiSchema();
      // `released` azzera il costo, `uncertain` LO MANTIENE contato.
      if (input.stato === "released") {
        await db`UPDATE tars_costi SET
            stato = 'released', costo_reale_nano = 0, motivo = ${input.motivo},
            updated_at = NOW()
          WHERE chiamata_id = ${input.chiamataId} AND stato = 'reserved'`;
        return;
      }
      await db`UPDATE tars_costi SET
          stato = 'uncertain', motivo = ${input.motivo}, updated_at = NOW()
        WHERE chiamata_id = ${input.chiamataId} AND stato = 'reserved'`;
    },

    async scadiPrenotazioniVecchie(scadenzaMs, adesso) {
      const db = sql();
      await ensureCostiSchema();
      // Si usa l'orologio PASSATO (come l'implementazione in memoria):
      // così i test a orologio finto provano la stessa semantica
      // dell'implementazione autorevole (revisione).
      const soglia = new Date(adesso.getTime() - Math.max(1000, scadenzaMs));
      const righe = await db`UPDATE tars_costi SET
          stato = 'expired', motivo = 'prenotazione mai riconciliata',
          updated_at = NOW()
        WHERE stato = 'reserved' AND created_at < ${soglia}
        RETURNING chiamata_id`;
      return righe.length;
    },

    async consumoCorrente(input) {
      const db = sql();
      await ensureCostiSchema();
      const { giorno, mese } = periodiLocali(input.adesso);
      const [somme] = await db`SELECT
          COALESCE(SUM(CASE stato
            WHEN 'released' THEN 0
            WHEN 'settled' THEN COALESCE(costo_reale_nano, costo_prenotato_nano)
            ELSE costo_prenotato_nano END)
            FILTER (WHERE run_id = ${input.runId}), 0) AS run,
          COALESCE(SUM(CASE stato
            WHEN 'released' THEN 0
            WHEN 'settled' THEN COALESCE(costo_reale_nano, costo_prenotato_nano)
            ELSE costo_prenotato_nano END)
            FILTER (WHERE giorno_locale = ${giorno}), 0) AS giorno,
          COALESCE(SUM(CASE stato
            WHEN 'released' THEN 0
            WHEN 'settled' THEN COALESCE(costo_reale_nano, costo_prenotato_nano)
            ELSE costo_prenotato_nano END)
            FILTER (WHERE mese_locale = ${mese}), 0) AS mese
        FROM tars_costi`;
      return {
        runNano: Number(somme?.run ?? 0),
        giornoNano: Number(somme?.giorno ?? 0),
        meseNano: Number(somme?.mese ?? 0),
      };
    },

    async riepilogo(adesso) {
      const db = sql();
      await ensureCostiSchema();
      const righe = await db`SELECT * FROM tars_costi
        WHERE mese_locale = ${periodiLocali(adesso).mese}`;
      return riepilogoDa(righe.map(rigaDa), adesso);
    },
  };
}

// ── Implementazione per i TEST (mai autorevole) ─────────────────────────

/**
 * Stessa semantica dell'autorevole, con una catena di promise al posto
 * dell'advisory lock: serve a provare la logica del governor senza
 * PostgreSQL. NON abilita mai il provider reale
 * (`ledgerAutorevoleDisponibile` non la considera).
 */
export function creaLedgerMemoriaPerTest(): LedgerCosti & {
  righe(): RigaCosto[];
} {
  const righe: RigaCosto[] = [];
  let coda: Promise<unknown> = Promise.resolve();
  const inSequenza = <T>(operazione: () => Promise<T> | T): Promise<T> => {
    const prossima = coda.then(operazione, operazione);
    coda = prossima.catch(() => undefined);
    return prossima as Promise<T>;
  };
  const trova = (chiamataId: string) =>
    righe.find(r => r.chiamataId === chiamataId);

  return {
    righe: () => righe.map(r => ({ ...r })),

    prenota(input) {
      return inSequenza(() => {
        const esistente = trova(input.chiamataId);
        if (esistente) {
          return { esito: "gia_presente", riga: { ...esistente } } as const;
        }
        const { giorno, mese } = periodiLocali(input.adesso);
        const consumo: ConsumoCorrente = {
          runNano: righe
            .filter(r => r.runId === input.runId)
            .reduce((s, r) => s + costoContato(r), 0),
          giornoNano: righe
            .filter(r => r.giornoLocale === giorno)
            .reduce((s, r) => s + costoContato(r), 0),
          meseNano: righe
            .filter(r => r.meseLocale === mese)
            .reduce((s, r) => s + costoContato(r), 0),
        };
        const sforato = verificaTetti(
          consumo,
          input.costoPrenotatoNano,
          input.limiti
        );
        if (sforato) {
          return {
            esito: "rifiutata",
            limite: sforato,
            consumo,
            richiestoNano: input.costoPrenotatoNano,
          } as const;
        }
        const riga: RigaCosto = {
          chiamataId: input.chiamataId,
          runId: input.runId,
          sedeId: input.sedeId,
          utenteId: input.utenteId,
          conversazioneId: input.conversazioneId,
          modello: input.modello,
          stato: "reserved",
          costoPrenotatoNano: input.costoPrenotatoNano,
          costoRealeNano: null,
          tokenInput: null,
          tokenCached: null,
          tokenOutput: null,
          giornoLocale: giorno,
          meseLocale: mese,
          motivo: null,
          creataIl: new Date(input.adesso),
        };
        righe.push(riga);
        return { esito: "prenotata", riga: { ...riga } } as const;
      });
    },

    riconcilia(input) {
      return inSequenza(() => {
        const riga = trova(input.chiamataId);
        if (!riga || riga.stato !== "reserved") return;
        riga.stato = "settled";
        riga.costoRealeNano = input.costoRealeNano;
        riga.tokenInput = input.tokenInput;
        riga.tokenCached = input.tokenCached;
        riga.tokenOutput = input.tokenOutput;
      });
    },

    chiudi(input) {
      return inSequenza(() => {
        const riga = trova(input.chiamataId);
        if (!riga || riga.stato !== "reserved") return;
        riga.stato = input.stato;
        riga.motivo = input.motivo;
        if (input.stato === "released") riga.costoRealeNano = 0;
      });
    },

    scadiPrenotazioniVecchie(scadenzaMs, adesso) {
      return inSequenza(() => {
        let n = 0;
        for (const riga of righe) {
          if (
            riga.stato === "reserved" &&
            adesso.getTime() - riga.creataIl.getTime() > scadenzaMs
          ) {
            riga.stato = "expired";
            riga.motivo = "prenotazione mai riconciliata";
            n += 1;
          }
        }
        return n;
      });
    },

    consumoCorrente(input) {
      return inSequenza(() => {
        const { giorno, mese } = periodiLocali(input.adesso);
        return {
          runNano: righe
            .filter(r => r.runId === input.runId)
            .reduce((s, r) => s + costoContato(r), 0),
          giornoNano: righe
            .filter(r => r.giornoLocale === giorno)
            .reduce((s, r) => s + costoContato(r), 0),
          meseNano: righe
            .filter(r => r.meseLocale === mese)
            .reduce((s, r) => s + costoContato(r), 0),
        };
      });
    },

    riepilogo(adesso) {
      return inSequenza(() => riepilogoDa(righe, adesso));
    },
  };
}

let ledgerSingleton: LedgerCosti | null = null;
let ledgerOverride: LedgerCosti | null = null;

export function ledgerCorrente(): LedgerCosti {
  if (ledgerOverride) return ledgerOverride;
  ledgerSingleton ??= creaLedgerPostgres();
  return ledgerSingleton;
}

/** Solo per i test. */
export function impostaLedgerPerTest(ledger: LedgerCosti | null): void {
  ledgerOverride = ledger;
}
