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
  const grezzo = valore && typeof valore === "object" ? valore as any : {};
  return {
    ...base,
    commessaId: Number.isInteger(grezzo.commessaId) && grezzo.commessaId > 0
      ? grezzo.commessaId
      : null,
    clienteId: Number.isInteger(grezzo.clienteId) && grezzo.clienteId > 0
      ? grezzo.clienteId
      : null,
    comunicazioneId:
      Number.isInteger(grezzo.comunicazioneId) && grezzo.comunicazioneId > 0
        ? grezzo.comunicazioneId
        : null,
    allegatoIndex:
      Number.isInteger(grezzo.allegatoIndex) && grezzo.allegatoIndex >= 0
        ? grezzo.allegatoIndex
        : null,
    superficie: typeof grezzo.superficie === "string" ? grezzo.superficie : null,
    versioniEntita:
      grezzo.versioniEntita && typeof grezzo.versioniEntita === "object"
        ? Object.fromEntries(
            Object.entries(grezzo.versioniEntita)
              .filter(([, v]) => typeof v === "string")
          ) as Record<string, string>
        : {},
    chiarificazionePendente:
      grezzo.chiarificazionePendente &&
      grezzo.chiarificazionePendente.tipo === "commessa" &&
      typeof grezzo.chiarificazionePendente.domanda === "string"
        ? grezzo.chiarificazionePendente
        : null,
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

export async function listaConversazioni(
  sedeId: number,
  utenteId: number,
  limite = 20
): Promise<ConversazioneTars[]> {
  if (kvSql) {
    await ensureTarsSchema();
    const righe = await kvSql`
      SELECT * FROM tars_conversazioni
      WHERE sede_id = ${sedeId} AND utente_id = ${utenteId}
      ORDER BY updated_at DESC LIMIT ${limite}`;
    return righe.map(rigaConversazione);
  }
  return memConversazioni
    .filter(c => c.sedeId === sedeId && c.utenteId === utenteId)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, limite);
}

export async function aggiungiTurno(input: {
  conversazioneId: number;
  sedeId: number;
  ruolo: TurnoTars["ruolo"];
  contenuto: string;
  payload?: Record<string, unknown> | null;
}): Promise<TurnoTars> {
  if (kvSql) {
    await ensureTarsSchema();
    const [r] = await kvSql`
      INSERT INTO tars_turni (conversazione_id, sede_id, ruolo, contenuto, payload)
      VALUES (${input.conversazioneId}, ${input.sedeId}, ${input.ruolo},
              ${input.contenuto}, ${JSON.stringify(input.payload ?? null)}::jsonb)
      RETURNING *`;
    await kvSql`
      UPDATE tars_conversazioni SET updated_at = now()
      WHERE id = ${input.conversazioneId}`;
    return rigaTurno(r);
  }
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
  const conversazione = memConversazioni.find(
    c => c.id === input.conversazioneId
  );
  if (conversazione) conversazione.updatedAt = new Date();
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
}> {
  if (kvSql) {
    await ensureTarsSchema();
    const [r] = await kvSql`
      SELECT COUNT(*)::int AS totale,
             COUNT(*) FILTER (WHERE stato <> 'ok')::int AS degradati,
             MAX(created_at) AS ultimo
      FROM tars_run WHERE sede_id = ${sedeId}`;
    return {
      totale: Number(r?.totale ?? 0),
      degradati: Number(r?.degradati ?? 0),
      ultimo: r?.ultimo ? new Date(r.ultimo) : null,
    };
  }
  const righe = memRun.filter(r => r.sedeId === sedeId);
  return {
    totale: righe.length,
    degradati: righe.filter(r => r.stato !== "ok").length,
    ultimo: righe.length ? righe[righe.length - 1].createdAt : null,
  };
}

/** Solo per i test: azzera il fallback in memoria. */
export function azzeraArchivioPerTest(): void {
  memConversazioni.length = 0;
  memTurni.length = 0;
  memRun.length = 0;
  memConvId = memTurnoId = memRunId = 1;
}
