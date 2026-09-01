// Archivio di Tars (T1): conversazioni, turni e telemetria dei run.
//
// Volume a ritmo macchina → tabelle PostgreSQL dedicate (pattern chat:
// CREATE TABLE IF NOT EXISTS additivo, `kvSql` da persistence). Senza
// DATABASE_URL degrada ad array in memoria CON LA STESSA API — utile in
// sviluppo e nei test, dichiarato non persistente. Non si salva mai
// chain-of-thought: solo output visibili, tool call strutturate, uso
// token, errori sanificati.

import { kvSql } from "../_core/persistence";
import {
  contestoConversazioneVuoto,
  analizzaContestoConversazionePersistito,
  type ContestoConversazione,
} from "./conversazione/types";

export type TurnoTars = {
  id: number;
  conversazioneId: number;
  sedeId: number;
  ruolo: "utente" | "tars";
  contenuto: string;
  /** Strutturato: evidenze, strumenti usati, uso token, stato del run. */
  payload: Record<string, unknown> | null;
  createdAt: Date;
};

export type ConversazioneTars = {
  id: number;
  sedeId: number;
  utenteId: number;
  titolo: string;
  createdAt: Date;
  updatedAt: Date;
  /** Metadati di gestione, additivi e recuperabili. */
  fissata: boolean;
  archiviataAt: Date | null;
  /** Derivata dall'ultimo turno nella lista, mai duplicata in tabella. */
  anteprima: string | null;
  /** Additivo: i consumer legacy possono ignorarlo. */
  contesto?: ContestoConversazione;
};

export type RunTars = {
  id: number;
  sedeId: number;
  utenteId: number;
  conversazioneId: number | null;
  stato: "ok" | "degradato" | "rifiutato" | "errore";
  provider: string;
  modello: string;
  versioni: Record<string, string>;
  contatori: Record<string, number>;
  errore: string | null;
  createdAt: Date;
};

let schemaPromise: Promise<void> | null = null;

export function ensureTarsSchema(): Promise<void> {
  if (!kvSql) return Promise.resolve();
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await kvSql!`
        CREATE TABLE IF NOT EXISTS tars_conversazioni (
          id BIGSERIAL PRIMARY KEY,
          sede_id INTEGER NOT NULL,
          utente_id INTEGER NOT NULL,
          titolo TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await kvSql!`
        CREATE INDEX IF NOT EXISTS tars_conv_sede_utente
          ON tars_conversazioni (sede_id, utente_id, updated_at DESC)`;
      await kvSql!`
        ALTER TABLE tars_conversazioni
          ADD COLUMN IF NOT EXISTS contesto JSONB NOT NULL DEFAULT '{}'::jsonb`;
      await kvSql!`
        ALTER TABLE tars_conversazioni
          ADD COLUMN IF NOT EXISTS contesto_versione BIGINT NOT NULL DEFAULT 0`;
      await kvSql`
        ALTER TABLE tars_conversazioni
          ADD COLUMN IF NOT EXISTS fissata BOOLEAN NOT NULL DEFAULT false`;
      await kvSql`
        ALTER TABLE tars_conversazioni
          ADD COLUMN IF NOT EXISTS archiviata_at TIMESTAMPTZ`;
      await kvSql!`
        CREATE TABLE IF NOT EXISTS tars_turni (
          id BIGSERIAL PRIMARY KEY,
          conversazione_id BIGINT NOT NULL,
          sede_id INTEGER NOT NULL,
          ruolo TEXT NOT NULL,
          contenuto TEXT NOT NULL,
          payload JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await kvSql!`
        CREATE INDEX IF NOT EXISTS tars_turni_conv
          ON tars_turni (conversazione_id, id)`;
      await kvSql!`
        CREATE TABLE IF NOT EXISTS tars_run (
          id BIGSERIAL PRIMARY KEY,
          sede_id INTEGER NOT NULL,
          utente_id INTEGER NOT NULL,
          conversazione_id BIGINT,
          stato TEXT NOT NULL,
          provider TEXT NOT NULL,
          modello TEXT NOT NULL,
          versioni JSONB NOT NULL DEFAULT '{}'::jsonb,
          contatori JSONB NOT NULL DEFAULT '{}'::jsonb,
          errore TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await kvSql!`
        CREATE INDEX IF NOT EXISTS tars_run_sede
          ON tars_run (sede_id, created_at DESC)`;
    })();
  }
  return schemaPromise;
}

// ── Fallback in memoria (stessa API) ─────────────────────────────────────

const memConversazioni: ConversazioneTars[] = [];
const memTurni: TurnoTars[] = [];
const memRun: RunTars[] = [];
let memConvId = 1;
let memTurnoId = 1;
let memRunId = 1;

function rigaConversazione(r: any): ConversazioneTars {
  return {
    id: Number(r.id),
    sedeId: Number(r.sede_id),
    utenteId: Number(r.utente_id),
    titolo: String(r.titolo),
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
    fissata: Boolean(r.fissata),
    archiviataAt: r.archiviata_at ? new Date(r.archiviata_at) : null,
    anteprima: r.anteprima == null ? null : String(r.anteprima),
    contesto: normalizzaContestoConversazione(
      r.contesto,
      Number(r.contesto_versione ?? 0)
    ),
  };
}

function normalizzaContestoConversazione(
  valore: unknown,
  versione: number
): ContestoConversazione {
  const base = contestoConversazioneVuoto();
  const analizzato = analizzaContestoConversazionePersistito(valore);
  if (!analizzato.success) {
    return {
      ...base,
      versione: Number.isInteger(versione) && versione >= 0 ? versione : 0,
    };
  }
  const grezzo = analizzato.data;
  return {
    ...grezzo,
    versione: Number.isInteger(versione) && versione >= 0 ? versione : 0,
  };
}

function rigaTurno(r: any): TurnoTars {
  return {
    id: Number(r.id),
    conversazioneId: Number(r.conversazione_id),
    sedeId: Number(r.sede_id),
    ruolo: r.ruolo,
    contenuto: String(r.contenuto),
    payload: r.payload ?? null,
    createdAt: new Date(r.created_at),
  };
}

export async function creaConversazione(input: {
  sedeId: number;
  utenteId: number;
  titolo: string;
}): Promise<ConversazioneTars> {
  if (kvSql) {
    await ensureTarsSchema();
    const [r] = await kvSql`
      INSERT INTO tars_conversazioni (sede_id, utente_id, titolo)
      VALUES (${input.sedeId}, ${input.utenteId}, ${input.titolo})
      RETURNING *`;
    return rigaConversazione(r);
  }
  const conversazione: ConversazioneTars = {
    id: memConvId++,
    sedeId: input.sedeId,
    utenteId: input.utenteId,
    titolo: input.titolo,
    createdAt: new Date(),
    updatedAt: new Date(),
    fissata: false,
    archiviataAt: null,
    anteprima: null,
    contesto: contestoConversazioneVuoto(),
  };
  memConversazioni.push(conversazione);
  return conversazione;
}

export type EsitoSalvataggioContestoArchivio =
  | { stato: "aggiornato"; contesto: ContestoConversazione }
  | { stato: "versione_obsoleta" }
  | { stato: "non_trovato" };

/** Primitive atomica; il layer conversazione applica semantica e verifiche. */
export async function salvaContestoConversazioneInArchivio(input: {
  conversazioneId: number;
  sedeId: number;
  utenteId: number;
  versioneAttesa: number;
  contesto: Omit<ContestoConversazione, "versione">;
}): Promise<EsitoSalvataggioContestoArchivio> {
  if (kvSql) {
    await ensureTarsSchema();
    const righe = await kvSql`
      UPDATE tars_conversazioni
      SET contesto = ${JSON.stringify(input.contesto)}::jsonb,
          contesto_versione = contesto_versione + 1,
          updated_at = now()
      WHERE id = ${input.conversazioneId}
        AND sede_id = ${input.sedeId}
        AND utente_id = ${input.utenteId}
        AND contesto_versione = ${input.versioneAttesa}
      RETURNING contesto, contesto_versione`;
    if (righe.length) {
      return {
        stato: "aggiornato",
        contesto: normalizzaContestoConversazione(
          righe[0].contesto,
          Number(righe[0].contesto_versione)
        ),
      };
    }
    const visibili = await kvSql`
      SELECT contesto_versione FROM tars_conversazioni
      WHERE id = ${input.conversazioneId}
        AND sede_id = ${input.sedeId}
        AND utente_id = ${input.utenteId}`;
    return visibili.length
      ? { stato: "versione_obsoleta" }
      : { stato: "non_trovato" };
  }

  const conversazione = memConversazioni.find(
    c => c.id === input.conversazioneId &&
      c.sedeId === input.sedeId &&
      c.utenteId === input.utenteId
  );
  if (!conversazione) return { stato: "non_trovato" };
  const corrente = conversazione.contesto ?? contestoConversazioneVuoto();
  if (corrente.versione !== input.versioneAttesa) {
    return { stato: "versione_obsoleta" };
  }
  conversazione.contesto = {
    ...input.contesto,
    versione: corrente.versione + 1,
  };
  conversazione.updatedAt = new Date();
  return { stato: "aggiornato", contesto: conversazione.contesto };
}

export async function conversazioneDiUtente(
  id: number,
  sedeId: number,
  utenteId: number
): Promise<ConversazioneTars | null> {
  if (kvSql) {
    await ensureTarsSchema();
    const [r] = await kvSql`
      SELECT * FROM tars_conversazioni
      WHERE id = ${id} AND sede_id = ${sedeId} AND utente_id = ${utenteId}`;
    return r ? rigaConversazione(r) : null;
  }
  return (
    memConversazioni.find(
      c => c.id === id && c.sedeId === sedeId && c.utenteId === utenteId
    ) ?? null
  );
}

export type OpzioniListaConversazioni = {
  archiviate?: boolean;
  ricerca?: string;
  limite?: number;
};

function limiteConversazioni(limite: number | undefined): number {
  if (!Number.isInteger(limite)) return 50;
  return Math.max(1, Math.min(100, limite!));
}

function conAnteprima(
  conversazione: ConversazioneTars,
  anteprima: string | null
): ConversazioneTars {
  return { ...conversazione, anteprima };
}

export async function listaConversazioni(
  sedeId: number,
  utenteId: number,
  opzioni: OpzioniListaConversazioni = {}
): Promise<ConversazioneTars[]> {
  const archiviate = opzioni.archiviate === true;
  const ricerca = opzioni.ricerca?.trim() ?? "";
  const limite = limiteConversazioni(opzioni.limite);
  if (kvSql) {
    await ensureTarsSchema();
    const righe = await kvSql`
      SELECT c.*, ultimo.contenuto AS anteprima
      FROM tars_conversazioni c
      LEFT JOIN LATERAL (
        SELECT contenuto FROM tars_turni
        WHERE conversazione_id = c.id AND sede_id = c.sede_id
        ORDER BY id DESC LIMIT 1
      ) ultimo ON true
      WHERE c.sede_id = ${sedeId}
        AND c.utente_id = ${utenteId}
        AND (c.archiviata_at IS NOT NULL) = ${archiviate}
        AND (
          ${ricerca} = ''
          OR strpos(lower(c.titolo), lower(${ricerca})) > 0
          OR strpos(lower(COALESCE(ultimo.contenuto, '')), lower(${ricerca})) > 0
        )
      ORDER BY c.fissata DESC, c.updated_at DESC
      LIMIT ${limite}`;
    return righe.map(rigaConversazione);
  }
  return memConversazioni
    .filter(c =>
      c.sedeId === sedeId &&
      c.utenteId === utenteId &&
      (c.archiviataAt != null) === archiviate
    )
    .map(c => {
      const ultimo = memTurni
        .filter(t => t.conversazioneId === c.id && t.sedeId === sedeId)
        .sort((a, b) => b.id - a.id)[0];
      return conAnteprima(c, ultimo?.contenuto ?? null);
    })
    .filter(c => {
      const needle = ricerca.toLocaleLowerCase();
      return !needle ||
        c.titolo.toLocaleLowerCase().includes(needle) ||
        c.anteprima?.toLocaleLowerCase().includes(needle);
    })
    .sort((a, b) =>
      Number(b.fissata) - Number(a.fissata) ||
      b.updatedAt.getTime() - a.updatedAt.getTime()
    )
    .slice(0, limite);
}

export type EsitoGestioneConversazione =
  | { stato: "aggiornata"; conversazione: ConversazioneTars }
  | { stato: "archiviata" }
  | { stato: "non_trovato" };

async function aggiornaConversazioneGestione(input: {
  conversazioneId: number;
  sedeId: number;
  utenteId: number;
  titolo?: string;
  fissata?: boolean;
  archiviata?: boolean;
}): Promise<EsitoGestioneConversazione> {
  if (kvSql) {
    await ensureTarsSchema();
    const [r] = await kvSql`
      UPDATE tars_conversazioni
      SET titolo = COALESCE(${input.titolo ?? null}, titolo),
          fissata = CASE
            WHEN ${input.archiviata === true} THEN false
            -- Cast esplicito: un parametro null in «$n IS NULL» non ha tipo
            -- inferibile e Postgres rifiuta con 42P18 (visto in produzione:
            -- rinomina/fissa/archivia conversazione fallivano sempre su PG).
            WHEN ${input.fissata ?? null}::boolean IS NULL THEN fissata
            ELSE ${input.fissata ?? null}::boolean
          END,
          archiviata_at = CASE
            WHEN ${input.archiviata === true} THEN now()
            WHEN ${input.archiviata === false} THEN NULL
            ELSE archiviata_at
          END,
          updated_at = now()
      WHERE id = ${input.conversazioneId}
        AND sede_id = ${input.sedeId}
        AND utente_id = ${input.utenteId}
        AND (archiviata_at IS NULL OR ${input.archiviata === false})
      RETURNING *`;
    if (r) return { stato: "aggiornata", conversazione: rigaConversazione(r) };
    const [visibile] = await kvSql`
      SELECT archiviata_at FROM tars_conversazioni
      WHERE id = ${input.conversazioneId}
        AND sede_id = ${input.sedeId}
        AND utente_id = ${input.utenteId}`;
    return visibile?.archiviata_at
      ? { stato: "archiviata" }
      : { stato: "non_trovato" };
  }

  const conversazione = memConversazioni.find(
    c => c.id === input.conversazioneId &&
      c.sedeId === input.sedeId &&
      c.utenteId === input.utenteId
  );
  if (!conversazione) return { stato: "non_trovato" };
  if (conversazione.archiviataAt != null && input.archiviata !== false) {
    return { stato: "archiviata" };
  }
  if (input.titolo != null) conversazione.titolo = input.titolo;
  if (input.archiviata === true) {
    conversazione.archiviataAt = new Date();
    conversazione.fissata = false;
  } else if (input.archiviata === false) {
    conversazione.archiviataAt = null;
  } else if (input.fissata != null) {
    conversazione.fissata = input.fissata;
  }
  conversazione.updatedAt = new Date();
  return { stato: "aggiornata", conversazione };
}

export function rinominaConversazione(input: {
  conversazioneId: number;
  sedeId: number;
  utenteId: number;
  titolo: string;
}): Promise<EsitoGestioneConversazione> {
  return aggiornaConversazioneGestione(input);
}

export function impostaConversazioneFissata(input: {
  conversazioneId: number;
  sedeId: number;
  utenteId: number;
  fissata: boolean;
}): Promise<EsitoGestioneConversazione> {
  return aggiornaConversazioneGestione(input);
}

export function impostaConversazioneArchiviata(input: {
  conversazioneId: number;
  sedeId: number;
  utenteId: number;
  archiviata: boolean;
}): Promise<EsitoGestioneConversazione> {
  return aggiornaConversazioneGestione(input);
}

export async function aggiungiTurno(input: {
  conversazioneId: number;
  sedeId: number;
  utenteId: number;
  ruolo: TurnoTars["ruolo"];
  contenuto: string;
  payload?: Record<string, unknown> | null;
}): Promise<TurnoTars> {
  if (kvSql) {
    await ensureTarsSchema();
    const righe = await kvSql`
      WITH proprietaria AS (
        UPDATE tars_conversazioni
        SET updated_at = now()
        WHERE id = ${input.conversazioneId}
          AND sede_id = ${input.sedeId}
          AND utente_id = ${input.utenteId}
          AND archiviata_at IS NULL
        RETURNING id
      )
      INSERT INTO tars_turni (conversazione_id, sede_id, ruolo, contenuto, payload)
      SELECT id, ${input.sedeId}, ${input.ruolo}, ${input.contenuto},
             ${JSON.stringify(input.payload ?? null)}::jsonb
      FROM proprietaria
      RETURNING *`;
    const r = righe[0];
    if (!r) throw new Error("NOT_FOUND: conversazione non trovata.");
    return rigaTurno(r);
  }
  const conversazione = memConversazioni.find(
    c => c.id === input.conversazioneId &&
      c.sedeId === input.sedeId &&
      c.utenteId === input.utenteId &&
      c.archiviataAt == null
  );
  if (!conversazione) throw new Error("NOT_FOUND: conversazione non trovata.");
  const turno: TurnoTars = {
    id: memTurnoId++,
    conversazioneId: input.conversazioneId,
    sedeId: input.sedeId,
    ruolo: input.ruolo,
    contenuto: input.contenuto,
    payload: input.payload ?? null,
    createdAt: new Date(),
  };
  memTurni.push(turno);
  conversazione.updatedAt = new Date();
  return turno;
}

export async function turniDiConversazione(
  conversazioneId: number,
  sedeId: number,
  limite = 60
): Promise<TurnoTars[]> {
  // Gli ULTIMI n turni in ordine cronologico: una finestra che tenesse i
  // più vecchi perderebbe la domanda corrente nelle conversazioni lunghe
  // (revisione T-fine: il provider risponderebbe a una domanda vecchia).
  if (kvSql) {
    await ensureTarsSchema();
    const righe = await kvSql`
      SELECT * FROM tars_turni
      WHERE conversazione_id = ${conversazioneId} AND sede_id = ${sedeId}
      ORDER BY id DESC LIMIT ${limite}`;
    return righe.map(rigaTurno).reverse();
  }
  return memTurni
    .filter(t => t.conversazioneId === conversazioneId && t.sedeId === sedeId)
    .sort((a, b) => a.id - b.id)
    .slice(-limite);
}

export async function registraRun(
  input: Omit<RunTars, "id" | "createdAt">
): Promise<void> {
  if (kvSql) {
    await ensureTarsSchema();
    await kvSql`
      INSERT INTO tars_run (sede_id, utente_id, conversazione_id, stato,
                            provider, modello, versioni, contatori, errore)
      VALUES (${input.sedeId}, ${input.utenteId}, ${input.conversazioneId},
              ${input.stato}, ${input.provider}, ${input.modello},
              ${JSON.stringify(input.versioni)}::jsonb,
              ${JSON.stringify(input.contatori)}::jsonb, ${input.errore})`;
    return;
  }
  memRun.push({ ...input, id: memRunId++, createdAt: new Date() });
}

/** Aggregato per la pagina /tars e la diagnostica: mai PII. */
export async function statisticheRun(sedeId: number): Promise<{
  totale: number;
  degradati: number;
  ultimo: Date | null;
  /** Ultimo run degradato con il motivo sanificato: diagnosi, non colpa. */
  ultimoDegradato: { errore: string | null; at: Date } | null;
}> {
  if (kvSql) {
    await ensureTarsSchema();
    const [r] = await kvSql`
      SELECT COUNT(*)::int AS totale,
             COUNT(*) FILTER (WHERE stato <> 'ok')::int AS degradati,
             MAX(created_at) AS ultimo
      FROM tars_run WHERE sede_id = ${sedeId}`;
    const [deg] = await kvSql`
      SELECT errore, created_at FROM tars_run
      WHERE sede_id = ${sedeId} AND stato <> 'ok'
      ORDER BY created_at DESC LIMIT 1`;
    return {
      totale: Number(r?.totale ?? 0),
      degradati: Number(r?.degradati ?? 0),
      ultimo: r?.ultimo ? new Date(r.ultimo) : null,
      ultimoDegradato: deg
        ? {
            errore: deg.errore == null ? null : String(deg.errore),
            at: new Date(deg.created_at),
          }
        : null,
    };
  }
  const righe = memRun.filter(r => r.sedeId === sedeId);
  const degradati = righe.filter(r => r.stato !== "ok");
  const ultimoDeg = degradati.length ? degradati[degradati.length - 1] : null;
  return {
    totale: righe.length,
    degradati: degradati.length,
    ultimo: righe.length ? righe[righe.length - 1].createdAt : null,
    ultimoDegradato: ultimoDeg
      ? { errore: ultimoDeg.errore ?? null, at: ultimoDeg.createdAt }
      : null,
  };
}

/** Solo per i test: azzera il fallback in memoria. */
export function azzeraArchivioPerTest(): void {
  memConversazioni.length = 0;
  memTurni.length = 0;
  memRun.length = 0;
  memConvId = memTurnoId = memRunId = 1;
}
