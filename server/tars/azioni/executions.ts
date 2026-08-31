import { createHash } from "node:crypto";
import { kvSql } from "../../_core/persistence";
import type { ContestoRun, EsitoAzione } from "../strumenti/tipi";
import type { DescrittoreAzioneTars } from "./types";

export type StatoEsecuzioneR1 =
  | "reserved"
  | "settled"
  | "no_effect"
  | "uncertain";

export type RigaEsecuzioneR1 = {
  id: number;
  idempotencyKey: string;
  runId: string;
  sedeId: number;
  utenteId: number;
  strumento: string;
  versioneStrumento: string;
  stato: StatoEsecuzioneR1;
  versioneOggetto: string | null;
  esito: string | null;
  risultato: EsitoAzione | null;
  audit: { auditId: string | null; azioneId: string | null };
  compensazione: { disponibile: boolean; via: string | null };
  createdAt: Date;
  updatedAt: Date;
};

export type InputPrenotazioneR1 = {
  idempotencyKey: string;
  runId: string;
  sedeId: number;
  utenteId: number;
  strumento: string;
  versioneStrumento: string;
  createdAt: Date;
};

export type LedgerEsecuzioniR1 = {
  prenota(input: InputPrenotazioneR1): Promise<
    | { tipo: "prenotata"; riga: RigaEsecuzioneR1 }
    | { tipo: "esistente"; riga: RigaEsecuzioneR1 }
  >;
  concludi(input: {
    idempotencyKey: string;
    versioneOggetto: string;
    esito: EsitoAzione;
    audit: RigaEsecuzioneR1["audit"];
    compensazione: RigaEsecuzioneR1["compensazione"];
    createdAt: Date;
  }): Promise<RigaEsecuzioneR1>;
  concludiSenzaEffetto(input: {
    idempotencyKey: string;
    esito: EsitoAzione;
    createdAt: Date;
  }): Promise<RigaEsecuzioneR1>;
  segnaIncerta(input: {
    idempotencyKey: string;
    motivo: string;
    createdAt: Date;
  }): Promise<RigaEsecuzioneR1>;
  lista(input: { sedeId: number }): Promise<RigaEsecuzioneR1[]>;
  eventi(idempotencyKey: string): Promise<StatoEsecuzioneR1[]>;
};

const AUDIT_VUOTO = { auditId: null, azioneId: null };
const COMPENSAZIONE_VUOTA = { disponibile: false, via: null };

function rigaDaDb(row: any): RigaEsecuzioneR1 {
  const createdAt = new Date(row.created_at);
  return {
    id: Number(row.id),
    idempotencyKey: String(row.idempotency_key),
    runId: String(row.run_id),
    sedeId: Number(row.sede_id),
    utenteId: Number(row.utente_id),
    strumento: String(row.strumento),
    versioneStrumento: String(row.versione_strumento),
    stato: row.stato ?? "reserved",
    versioneOggetto: row.versione_oggetto_evento ?? null,
    esito: row.esito_evento ?? null,
    risultato: row.risultato ?? null,
    audit: row.audit_evento ?? AUDIT_VUOTO,
    compensazione: row.compensazione_evento ?? COMPENSAZIONE_VUOTA,
    createdAt,
    updatedAt: new Date(row.evento_created_at ?? row.created_at),
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
      await kvSql!`CREATE TABLE IF NOT EXISTS tars_azioni_esecuzioni_eventi (
        id BIGSERIAL PRIMARY KEY,
        esecuzione_id BIGINT NOT NULL REFERENCES tars_azioni_esecuzioni(id),
        stato TEXT NOT NULL CHECK (stato IN ('reserved','settled','no_effect','uncertain')),
        versione_oggetto TEXT,
        esito TEXT,
        risultato JSONB,
        audit JSONB NOT NULL DEFAULT '{}'::jsonb,
        compensazione JSONB NOT NULL DEFAULT '{}'::jsonb,
        motivo TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
      await kvSql!.unsafe(`DO $tars_r1_schema$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conrelid = 'tars_azioni_esecuzioni_eventi'::regclass
              AND conname = 'tars_azioni_esecuzioni_eventi_stato_check'
              AND pg_get_constraintdef(oid) LIKE '%no_effect%'
          ) THEN
            ALTER TABLE tars_azioni_esecuzioni_eventi
              DROP CONSTRAINT IF EXISTS tars_azioni_esecuzioni_eventi_stato_check;
            ALTER TABLE tars_azioni_esecuzioni_eventi
              ADD CONSTRAINT tars_azioni_esecuzioni_eventi_stato_check
              CHECK (stato IN ('reserved','settled','no_effect','uncertain'));
          END IF;
        END
        $tars_r1_schema$;`);
      await kvSql!`CREATE INDEX IF NOT EXISTS tars_azioni_esecuzioni_sede_idx
        ON tars_azioni_esecuzioni (sede_id, created_at DESC)`;
      await kvSql!`CREATE INDEX IF NOT EXISTS tars_azioni_esecuzioni_run_idx
        ON tars_azioni_esecuzioni (run_id, created_at)`;
      await kvSql!`CREATE INDEX IF NOT EXISTS tars_azioni_esecuzioni_eventi_idx
        ON tars_azioni_esecuzioni_eventi (esecuzione_id, id DESC)`;
    })
    .then(() => undefined)
    .catch(errore => {
      schemaPromise = null;
      throw errore;
    });
  return schemaPromise;
}

const PROIEZIONE = `
  SELECT e.*,
    ev.stato,
    ev.versione_oggetto AS versione_oggetto_evento,
    ev.esito AS esito_evento,
    ev.risultato,
    ev.audit AS audit_evento,
    ev.compensazione AS compensazione_evento,
    ev.created_at AS evento_created_at
  FROM tars_azioni_esecuzioni e
  LEFT JOIN LATERAL (
    SELECT * FROM tars_azioni_esecuzioni_eventi x
    WHERE x.esecuzione_id = e.id
    ORDER BY x.id DESC LIMIT 1
  ) ev ON true`;

function creaLedgerEsecuzioniPostgres(): LedgerEsecuzioniR1 {
  const sql = () => {
    if (!kvSql) {
      throw new Error(
        "LEDGER_ESECUZIONI_ASSENTE: le esecuzioni R1 richiedono PostgreSQL."
      );
    }
    return kvSql;
  };

  const leggi = async (db: any, idempotencyKey: string) => {
    const righe = await db.unsafe(
      `${PROIEZIONE} WHERE e.idempotency_key = $1 LIMIT 1`,
      [idempotencyKey]
    );
    return righe[0] ? rigaDaDb(righe[0]) : null;
  };

  return {
    async prenota(input) {
      const db = sql();
      await ensureEsecuzioniR1Schema();
      return db.begin(async tx => {
        const inserite = await tx`INSERT INTO tars_azioni_esecuzioni (
            idempotency_key, run_id, sede_id, utente_id, strumento,
            versione_strumento, versione_oggetto, esito, audit, compensazione
          ) VALUES (
            ${input.idempotencyKey}, ${input.runId}, ${input.sedeId},
            ${input.utenteId}, ${input.strumento}, ${input.versioneStrumento},
            ${"reserved"}, ${"reserved"}, ${tx.json(AUDIT_VUOTO)},
            ${tx.json(COMPENSAZIONE_VUOTA)}
          ) ON CONFLICT (idempotency_key) DO NOTHING
          RETURNING id`;
        if (inserite[0]) {
          await tx`INSERT INTO tars_azioni_esecuzioni_eventi (
              esecuzione_id, stato, audit, compensazione, created_at
            ) VALUES (
              ${inserite[0].id}, ${"reserved"}, ${tx.json(AUDIT_VUOTO)},
              ${tx.json(COMPENSAZIONE_VUOTA)}, ${input.createdAt}
            )`;
          const riga = await leggi(tx, input.idempotencyKey);
          if (!riga) throw new Error("LEDGER_ESECUZIONI_INCOERENTE: reservation non rileggibile.");
          return { tipo: "prenotata" as const, riga };
        }
        const riga = await leggi(tx, input.idempotencyKey);
        if (!riga) throw new Error("LEDGER_ESECUZIONI_INCOERENTE: reservation concorrente non rileggibile.");
        return { tipo: "esistente" as const, riga };
      });
    },

    async concludi(input) {
      const db = sql();
      await ensureEsecuzioniR1Schema();
      return db.begin(async tx => {
        const [base] = await tx`SELECT id FROM tars_azioni_esecuzioni
          WHERE idempotency_key = ${input.idempotencyKey} FOR UPDATE`;
        if (!base) throw new Error("LEDGER_ESECUZIONI_INCOERENTE: reservation assente al settle.");
        const corrente = await leggi(tx, input.idempotencyKey);
        if (corrente?.stato === "settled") return corrente;
        if (corrente?.stato === "no_effect") {
          throw new Error(
            "LEDGER_ESECUZIONE_SENZA_EFFETTO: non si può fare settle dopo una chiusura no-effect."
          );
        }
        if (corrente?.stato === "uncertain") {
          throw new Error("LEDGER_ESECUZIONE_INCERTA: non si può chiudere un'esecuzione incerta.");
        }
        await tx`INSERT INTO tars_azioni_esecuzioni_eventi (
            esecuzione_id, stato, versione_oggetto, esito, risultato,
            audit, compensazione, created_at
          ) VALUES (
            ${base.id}, ${"settled"}, ${input.versioneOggetto},
            ${input.esito.stato}, ${tx.json(input.esito as any)},
            ${tx.json(input.audit)}, ${tx.json(input.compensazione)},
            ${input.createdAt}
          )`;
        const riga = await leggi(tx, input.idempotencyKey);
        if (!riga) throw new Error("LEDGER_ESECUZIONI_INCOERENTE: settle non rileggibile.");
        return riga;
      });
    },

    async concludiSenzaEffetto(input) {
      const db = sql();
      await ensureEsecuzioniR1Schema();
      return db.begin(async tx => {
        const [base] = await tx`SELECT id FROM tars_azioni_esecuzioni
          WHERE idempotency_key = ${input.idempotencyKey} FOR UPDATE`;
        if (!base) {
          throw new Error(
            "LEDGER_ESECUZIONI_INCOERENTE: reservation assente alla chiusura no-effect."
          );
        }
        const corrente = await leggi(tx, input.idempotencyKey);
        if (corrente?.stato === "no_effect") return corrente;
        if (corrente?.stato === "settled" || corrente?.stato === "uncertain") {
          throw new Error(
            "LEDGER_ESECUZIONE_TERMINALE: non si può registrare no-effect dopo la chiusura."
          );
        }
        await tx`INSERT INTO tars_azioni_esecuzioni_eventi (
            esecuzione_id, stato, esito, risultato, audit, compensazione,
            motivo, created_at
          ) VALUES (
            ${base.id}, ${"no_effect"}, ${input.esito.stato},
            ${tx.json(input.esito as any)}, ${tx.json(AUDIT_VUOTO)},
            ${tx.json(COMPENSAZIONE_VUOTA)}, ${input.esito.motivo},
            ${input.createdAt}
          )`;
        const riga = await leggi(tx, input.idempotencyKey);
        if (!riga) {
          throw new Error(
            "LEDGER_ESECUZIONI_INCOERENTE: chiusura no-effect non rileggibile."
          );
        }
        return riga;
      });
    },

    async segnaIncerta(input) {
      const db = sql();
      await ensureEsecuzioniR1Schema();
      return db.begin(async tx => {
        const [base] = await tx`SELECT id FROM tars_azioni_esecuzioni
          WHERE idempotency_key = ${input.idempotencyKey} FOR UPDATE`;
        if (!base) throw new Error("LEDGER_ESECUZIONI_INCOERENTE: reservation assente per uncertain.");
        const corrente = await leggi(tx, input.idempotencyKey);
        if (
          corrente?.stato === "settled" ||
          corrente?.stato === "no_effect" ||
          corrente?.stato === "uncertain"
        ) {
          return corrente;
        }
        await tx`INSERT INTO tars_azioni_esecuzioni_eventi (
            esecuzione_id, stato, audit, compensazione, motivo, created_at
          ) VALUES (
            ${base.id}, ${"uncertain"}, ${tx.json(AUDIT_VUOTO)},
            ${tx.json(COMPENSAZIONE_VUOTA)}, ${input.motivo}, ${input.createdAt}
          )`;
        const riga = await leggi(tx, input.idempotencyKey);
        if (!riga) throw new Error("LEDGER_ESECUZIONI_INCOERENTE: uncertain non rileggibile.");
        return riga;
      });
    },

    async lista(input) {
      const db = sql();
      await ensureEsecuzioniR1Schema();
      const righe = await db.unsafe(
        `${PROIEZIONE} WHERE e.sede_id = $1 ORDER BY e.id ASC`,
        [input.sedeId]
      );
      return righe.map(rigaDaDb);
    },

    async eventi(idempotencyKey) {
      const db = sql();
      await ensureEsecuzioniR1Schema();
      const righe = await db`SELECT ev.stato
        FROM tars_azioni_esecuzioni_eventi ev
        JOIN tars_azioni_esecuzioni e ON e.id = ev.esecuzione_id
        WHERE e.idempotency_key = ${idempotencyKey}
        ORDER BY ev.id ASC`;
      return righe.map(r => r.stato as StatoEsecuzioneR1);
    },
  };
}

type EventoMemoria = {
  stato: StatoEsecuzioneR1;
  versioneOggetto: string | null;
  esito: EsitoAzione | null;
  audit: RigaEsecuzioneR1["audit"];
  compensazione: RigaEsecuzioneR1["compensazione"];
  createdAt: Date;
};

/** Implementazione volatile esportata esclusivamente per test. */
export function creaLedgerEsecuzioniMemoriaPerTest(): LedgerEsecuzioniR1 {
  const prenotazioni: Array<InputPrenotazioneR1 & { id: number }> = [];
  const eventiPerChiave = new Map<string, EventoMemoria[]>();

  const proietta = (prenotazione: InputPrenotazioneR1 & { id: number }) => {
    const eventi = eventiPerChiave.get(prenotazione.idempotencyKey) ?? [];
    const ultimo = eventi[eventi.length - 1]!;
    return {
      ...prenotazione,
      stato: ultimo.stato,
      versioneOggetto: ultimo.versioneOggetto,
      esito: ultimo.esito?.stato ?? null,
      risultato: ultimo.esito,
      audit: ultimo.audit,
      compensazione: ultimo.compensazione,
      updatedAt: ultimo.createdAt,
    } satisfies RigaEsecuzioneR1;
  };

  return {
    async prenota(input) {
      const esistente = prenotazioni.find(
        r => r.idempotencyKey === input.idempotencyKey
      );
      if (esistente) {
        return { tipo: "esistente", riga: proietta(esistente) };
      }
      const prenotazione = { ...input, id: prenotazioni.length + 1 };
      prenotazioni.push(prenotazione);
      eventiPerChiave.set(input.idempotencyKey, [
        {
          stato: "reserved",
          versioneOggetto: null,
          esito: null,
          audit: AUDIT_VUOTO,
          compensazione: COMPENSAZIONE_VUOTA,
          createdAt: input.createdAt,
        },
      ]);
      return { tipo: "prenotata", riga: proietta(prenotazione) };
    },

    async concludi(input) {
      const prenotazione = prenotazioni.find(
        r => r.idempotencyKey === input.idempotencyKey
      );
      if (!prenotazione) throw new Error("LEDGER_ESECUZIONI_INCOERENTE: reservation assente al settle.");
      const corrente = proietta(prenotazione);
      if (corrente.stato === "settled") return corrente;
      if (corrente.stato === "no_effect") {
        throw new Error("LEDGER_ESECUZIONE_SENZA_EFFETTO");
      }
      if (corrente.stato === "uncertain") throw new Error("LEDGER_ESECUZIONE_INCERTA");
      eventiPerChiave.get(input.idempotencyKey)!.push({
        stato: "settled",
        versioneOggetto: input.versioneOggetto,
        esito: input.esito,
        audit: input.audit,
        compensazione: input.compensazione,
        createdAt: input.createdAt,
      });
      return proietta(prenotazione);
    },

    async concludiSenzaEffetto(input) {
      const prenotazione = prenotazioni.find(
        r => r.idempotencyKey === input.idempotencyKey
      );
      if (!prenotazione) {
        throw new Error(
          "LEDGER_ESECUZIONI_INCOERENTE: reservation assente alla chiusura no-effect."
        );
      }
      const corrente = proietta(prenotazione);
      if (corrente.stato === "no_effect") return corrente;
      if (corrente.stato === "settled" || corrente.stato === "uncertain") {
        throw new Error("LEDGER_ESECUZIONE_TERMINALE");
      }
      eventiPerChiave.get(input.idempotencyKey)!.push({
        stato: "no_effect",
        versioneOggetto: null,
        esito: input.esito,
        audit: AUDIT_VUOTO,
        compensazione: COMPENSAZIONE_VUOTA,
        createdAt: input.createdAt,
      });
      return proietta(prenotazione);
    },

    async segnaIncerta(input) {
      const prenotazione = prenotazioni.find(
        r => r.idempotencyKey === input.idempotencyKey
      );
      if (!prenotazione) throw new Error("LEDGER_ESECUZIONI_INCOERENTE: reservation assente per uncertain.");
      const corrente = proietta(prenotazione);
      if (
        corrente.stato === "settled" ||
        corrente.stato === "no_effect" ||
        corrente.stato === "uncertain"
      ) return corrente;
      eventiPerChiave.get(input.idempotencyKey)!.push({
        stato: "uncertain",
        versioneOggetto: null,
        esito: null,
        audit: AUDIT_VUOTO,
        compensazione: COMPENSAZIONE_VUOTA,
        createdAt: input.createdAt,
      });
      return proietta(prenotazione);
    },

    async lista(input) {
      return prenotazioni
        .filter(r => r.sedeId === input.sedeId)
        .map(proietta);
    },

    async eventi(idempotencyKey) {
      return (eventiPerChiave.get(idempotencyKey) ?? []).map(e => e.stato);
    },
  };
}

let singleton: LedgerEsecuzioniR1 | null = null;
let overrideTest: LedgerEsecuzioniR1 | null = null;

export function ledgerEsecuzioniAutorevoleDisponibile(): boolean {
  return Boolean(kvSql);
}

export function ledgerEsecuzioniCorrente(): LedgerEsecuzioniR1 {
  if (overrideTest) return overrideTest;
  if (singleton) return singleton;
  if (kvSql) return (singleton = creaLedgerEsecuzioniPostgres());
  if (process.env.NODE_ENV === "test") {
    return (singleton = creaLedgerEsecuzioniMemoriaPerTest());
  }
  throw new Error(
    "LEDGER_ESECUZIONI_ASSENTE: senza DATABASE_URL le azioni R1 sono fail-closed."
  );
}

export function impostaLedgerEsecuzioniPerTest(
  ledger: LedgerEsecuzioniR1 | null
): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error(
      "LEDGER_ESECUZIONI_TEST_ONLY: l'override è riservato ai test."
    );
  }
  overrideTest = ledger;
}

export function azzeraLedgerEsecuzioniPerTest(): void {
  if (process.env.NODE_ENV !== "test") return;
  overrideTest = null;
  if (!kvSql) singleton = null;
}

function serializzaCanonico(valore: unknown): string {
  if (valore === null || typeof valore !== "object") {
    return JSON.stringify(valore);
  }
  if (valore instanceof Date) return JSON.stringify(valore.toISOString());
  if (Array.isArray(valore)) {
    return `[${valore.map(serializzaCanonico).join(",")}]`;
  }
  const oggetto = valore as Record<string, unknown>;
  return `{${Object.keys(oggetto)
    .filter(chiave => oggetto[chiave] !== undefined)
    .sort()
    .map(
      chiave => `${JSON.stringify(chiave)}:${serializzaCanonico(oggetto[chiave])}`
    )
    .join(",")}}`;
}

export function chiaveIdempotenzaR1(input: {
  descrittore: DescrittoreAzioneTars;
  contesto: ContestoRun;
  argomenti: unknown;
}): string {
  const canonico = serializzaCanonico({
    sedeId: input.contesto.sedeId,
    utenteId: input.contesto.utenteId,
    strumento: input.descrittore.nome,
    versioneStrumento: input.descrittore.versioneStrumento,
    versioneRegistro: input.descrittore.versioneRegistro,
    argomenti: input.argomenti,
  });
  return `r1:${createHash("sha256").update(canonico).digest("hex")}`;
}

export type PrenotazioneEsecuzioneR1 =
  | { tipo: "non_r1" }
  | { tipo: "esegui"; idempotencyKey: string }
  | { tipo: "riusa"; idempotencyKey: string; esito: EsitoAzione }
  | {
      tipo: "incerta";
      idempotencyKey: string;
      stato: "reserved" | "uncertain";
    };

export async function prenotaEsecuzioneR1(input: {
  descrittore: DescrittoreAzioneTars;
  contesto: ContestoRun;
  runId: string;
  argomenti: unknown;
}): Promise<PrenotazioneEsecuzioneR1> {
  if (input.descrittore.rischio !== "R1") return { tipo: "non_r1" };
  const chiaveBase = chiaveIdempotenzaR1(input);
  let idempotencyKey = chiaveBase;

  // Una compensazione conclusa rende legittima una nuova esecuzione dello
  // stesso comando. Ogni generazione resta distinta e append-only; è il
  // dominio, non il ledger, a decidere se l'effetto precedente è ancora vivo.
  for (let generazione = 0; generazione < 20; generazione++) {
    const prenotazione = await ledgerEsecuzioniCorrente().prenota({
      idempotencyKey,
      runId: input.runId,
      sedeId: input.contesto.sedeId,
      utenteId: input.contesto.utenteId,
      strumento: input.descrittore.nome,
      versioneStrumento: input.descrittore.versioneStrumento,
      createdAt: new Date(),
    });
    if (prenotazione.tipo === "prenotata") {
      return { tipo: "esegui", idempotencyKey };
    }
    if (prenotazione.riga.stato === "no_effect") {
      idempotencyKey = `r1:${createHash("sha256")
        .update(`${chiaveBase}:dopo:${prenotazione.riga.id}`)
        .digest("hex")}`;
      continue;
    }
    if (prenotazione.riga.stato === "settled" && prenotazione.riga.risultato) {
      if (prenotazione.riga.risultato.stato === "non_eseguito") {
        idempotencyKey = `r1:${createHash("sha256")
          .update(`${chiaveBase}:dopo:${prenotazione.riga.id}`)
          .digest("hex")}`;
        continue;
      }
      const verifica = input.descrittore.idempotenza.esitoAncoraValido;
      const ancoraValido = verifica
        ? await verifica(
            input.contesto,
            input.argomenti,
            prenotazione.riga.risultato
          )
        : true;
      if (ancoraValido) {
        return {
          tipo: "riusa",
          idempotencyKey,
          esito: prenotazione.riga.risultato,
        };
      }
      idempotencyKey = `r1:${createHash("sha256")
        .update(`${chiaveBase}:dopo:${prenotazione.riga.id}`)
        .digest("hex")}`;
      continue;
    }
    return {
      tipo: "incerta",
      idempotencyKey,
      stato:
        prenotazione.riga.stato === "uncertain" ? "uncertain" : "reserved",
    };
  }
  throw new Error(
    "LEDGER_ESECUZIONI_GENERAZIONI_ESAURITE: cambia i parametri dell'azione."
  );
}

function hashVersioneOggetto(esito: EsitoAzione): string {
  return `sha256:${createHash("sha256")
    .update(
      serializzaCanonico({ entita: esito.entitaToccate, dopo: esito.dopo })
    )
    .digest("hex")}`;
}

function viaCompensazione(esito: EsitoAzione): string | null {
  if (esito.undoVia) return `${esito.undoVia.procedura}:${esito.undoVia.id}`;
  return esito.undoDisponibile ? esito.undoEntro : null;
}

export async function concludiEsecuzioneR1(input: {
  idempotencyKey: string;
  esito: EsitoAzione;
}): Promise<RigaEsecuzioneR1> {
  return ledgerEsecuzioniCorrente().concludi({
    idempotencyKey: input.idempotencyKey,
    versioneOggetto: hashVersioneOggetto(input.esito),
    esito: input.esito,
    audit: {
      auditId: input.esito.auditId,
      azioneId: input.esito.azioneId,
    },
    compensazione: {
      disponibile: input.esito.undoDisponibile,
      via: viaCompensazione(input.esito),
    },
    createdAt: new Date(),
  });
}

export async function concludiEsecuzioneR1SenzaEffetto(input: {
  idempotencyKey: string;
  esito: EsitoAzione;
}): Promise<RigaEsecuzioneR1> {
  return ledgerEsecuzioniCorrente().concludiSenzaEffetto({
    ...input,
    createdAt: new Date(),
  });
}

export async function segnaEsecuzioneR1Incerta(input: {
  idempotencyKey: string;
  motivo: string;
}): Promise<RigaEsecuzioneR1> {
  return ledgerEsecuzioniCorrente().segnaIncerta({
    ...input,
    createdAt: new Date(),
  });
}
