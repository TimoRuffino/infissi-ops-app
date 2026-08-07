// Comunicazioni — l'unica raccolta che NON vive in kv_store.
//
// Motivo: persistedStore riscrive l'intero blob JSONB a ogni save. A ~1.800
// email al mese quel blob supera le decine di migliaia di righe entro un
// anno, e ogni singola mail in arrivo lo riscriverebbe per intero. È la
// stessa malattia dei documenti in base64, in versione peggiore perché
// cresce da sola.
//
// Qui c'è una tabella vera, con indici e insert idempotente su
// (casella_id, message_id): rileggere la stessa casella due volte non
// duplica nulla.
//
// Senza DATABASE_URL (sviluppo locale) si degrada a un array in memoria con
// la stessa API — il dev server resta usabile senza Postgres.

import { kvSql } from "../_core/persistence";

export type Allegato = {
  nome: string;
  mimeType: string;
  size: number;
  // Popolato solo quando lo storage documenti è durevole (R2/S3). Finché il
  // driver è `local` gli allegati vengono elencati ma non scaricati: in
  // base64 dentro la JSONB peggiorerebbero il problema già noto.
  storageKey?: string | null;
};

export type Comunicazione = {
  id: number;
  sedeId: number;
  casellaId: number;
  messageId: string;
  // UID IMAP nella cartella d'origine: serve a ripescare il messaggio (per
  // gli allegati) senza ricerca. Null sui record precedenti a questa
  // colonna — lì si ricade sulla ricerca per Message-ID.
  uid: number | null;
  canale: "email";
  direzione: "in" | "out";
  mittente: string;
  mittenteNome: string | null;
  destinatari: string[];
  oggetto: string;
  testo: string;
  allegati: Allegato[];
  clienteId: number | null;
  commessaId: number | null;
  matchConfidenza: "alta" | "media" | "bassa" | "nessuna";
  matchMotivo: string | null;
  stato: "nuova" | "vista" | "gestita";
  // Tombstone: eliminata dal CRM, mai dalla casella (IMAP è sola lettura).
  // La riga resta perché l'insert idempotente la veda e NON la re-importi
  // alla prossima sincronizzazione — un DELETE secco la farebbe risorgere
  // al primo cambio di uidValidity.
  deletedAt: Date | null;
  // True quando Tars l'ha già esaminata per lo smistamento: evita di
  // pagare due volte l'analisi della stessa mail.
  tarsAnalizzata: boolean;
  receivedAt: Date;
  createdAt: Date;
};

export type NuovaComunicazione = Omit<
  Comunicazione,
  "id" | "createdAt" | "deletedAt" | "tarsAnalizzata" | "uid"
> & {
  uid?: number | null;
  // true per la posta storica importata a posteriori: il match la aggancia,
  // ma Tars non la mette in coda di analisi — la triage è per il flusso in
  // arrivo, non per l'archivio (che a 10 mail per esecuzione costerebbe
  // decine di run inutili).
  tarsAnalizzata?: boolean;
};

// Il corpo viene troncato: serve a classificare e a dare contesto, non ad
// archiviare la posta. La casella resta la fonte di verità.
export const MAX_TESTO = 20_000;

// ── Fallback in memoria (nessun DATABASE_URL) ───────────────────────────────

let memRows: Comunicazione[] = [];
let memNextId = 1;

// ── Schema ──────────────────────────────────────────────────────────────────

let schemaPromise: Promise<void> | null = null;

export function ensureComunicazioniSchema(): Promise<void> {
  if (!kvSql) return Promise.resolve();
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await kvSql!`
        CREATE TABLE IF NOT EXISTS comunicazioni (
          id BIGSERIAL PRIMARY KEY,
          sede_id INTEGER NOT NULL,
          casella_id INTEGER NOT NULL,
          message_id TEXT NOT NULL,
          canale TEXT NOT NULL DEFAULT 'email',
          direzione TEXT NOT NULL DEFAULT 'in',
          mittente TEXT NOT NULL,
          mittente_nome TEXT,
          destinatari JSONB NOT NULL DEFAULT '[]'::jsonb,
          oggetto TEXT NOT NULL DEFAULT '',
          testo TEXT NOT NULL DEFAULT '',
          allegati JSONB NOT NULL DEFAULT '[]'::jsonb,
          cliente_id INTEGER,
          commessa_id INTEGER,
          match_confidenza TEXT NOT NULL DEFAULT 'nessuna',
          match_motivo TEXT,
          stato TEXT NOT NULL DEFAULT 'nuova',
          received_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
      // Idempotenza dell'ingestione: la stessa mail riletta non si duplica.
      await kvSql!`
        CREATE UNIQUE INDEX IF NOT EXISTS comunicazioni_casella_message
          ON comunicazioni (casella_id, message_id)`;
      // La query calda: elenco per sede in ordine cronologico inverso.
      await kvSql!`
        CREATE INDEX IF NOT EXISTS comunicazioni_sede_received
          ON comunicazioni (sede_id, received_at DESC)`;
      await kvSql!`
        CREATE INDEX IF NOT EXISTS comunicazioni_commessa
          ON comunicazioni (commessa_id)`;
      // Migrazioni additive per le installazioni che hanno già la tabella.
      await kvSql!`
        ALTER TABLE comunicazioni
          ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`;
      await kvSql!`
        ALTER TABLE comunicazioni
          ADD COLUMN IF NOT EXISTS tars_analizzata BOOLEAN NOT NULL DEFAULT FALSE`;
      await kvSql!`
        ALTER TABLE comunicazioni
          ADD COLUMN IF NOT EXISTS uid INTEGER`;
    })().catch((e) => {
      console.error("[comunicazioni] ensureSchema failed:", e);
      schemaPromise = null;
      throw e;
    });
  }
  return schemaPromise;
}

// ── Mapping riga ⇄ oggetto ──────────────────────────────────────────────────

function fromRow(r: any): Comunicazione {
  return {
    id: Number(r.id),
    sedeId: r.sede_id,
    casellaId: r.casella_id,
    messageId: r.message_id,
    canale: r.canale,
    direzione: r.direzione,
    mittente: r.mittente,
    mittenteNome: r.mittente_nome,
    destinatari: r.destinatari ?? [],
    oggetto: r.oggetto,
    testo: r.testo,
    allegati: r.allegati ?? [],
    clienteId: r.cliente_id,
    commessaId: r.commessa_id,
    matchConfidenza: r.match_confidenza,
    matchMotivo: r.match_motivo,
    stato: r.stato,
    uid: r.uid ?? null,
    deletedAt: r.deleted_at ? new Date(r.deleted_at) : null,
    tarsAnalizzata: !!r.tars_analizzata,
    receivedAt: new Date(r.received_at),
    createdAt: new Date(r.created_at),
  };
}

// ── Scrittura ───────────────────────────────────────────────────────────────

/**
 * Inserisce una comunicazione. Ritorna null quando esisteva già
 * (stesso message_id sulla stessa casella) — l'ingestione può ripassare
 * sugli stessi messaggi senza effetti collaterali.
 */
export async function insertComunicazione(
  c: NuovaComunicazione
): Promise<Comunicazione | null> {
  const testo = c.testo.slice(0, MAX_TESTO);

  if (!kvSql) {
    const dup = memRows.some(
      (r) => r.casellaId === c.casellaId && r.messageId === c.messageId
    );
    if (dup) return null;
    const row: Comunicazione = {
      ...c,
      uid: c.uid ?? null,
      testo,
      id: memNextId++,
      deletedAt: null,
      tarsAnalizzata: c.tarsAnalizzata ?? false,
      createdAt: new Date(),
    };
    memRows.push(row);
    return row;
  }

  await ensureComunicazioniSchema();
  const rows = await kvSql`
    INSERT INTO comunicazioni (
      sede_id, casella_id, message_id, uid, canale, direzione,
      mittente, mittente_nome, destinatari, oggetto, testo, allegati,
      cliente_id, commessa_id, match_confidenza, match_motivo, stato,
      tars_analizzata, received_at
    ) VALUES (
      ${c.sedeId}, ${c.casellaId}, ${c.messageId}, ${c.uid ?? null}, ${c.canale}, ${c.direzione},
      ${c.mittente}, ${c.mittenteNome}, ${kvSql.json(c.destinatari as any)},
      ${c.oggetto}, ${testo}, ${kvSql.json(c.allegati as any)},
      ${c.clienteId}, ${c.commessaId}, ${c.matchConfidenza}, ${c.matchMotivo},
      ${c.stato}, ${c.tarsAnalizzata ?? false}, ${c.receivedAt}
    )
    ON CONFLICT (casella_id, message_id) DO NOTHING
    RETURNING *`;
  return rows.length ? fromRow(rows[0]) : null;
}

export async function setStatoComunicazione(
  id: number,
  sedeId: number,
  stato: Comunicazione["stato"]
): Promise<boolean> {
  if (!kvSql) {
    const r = memRows.find((x) => x.id === id && x.sedeId === sedeId);
    if (!r) return false;
    r.stato = stato;
    return true;
  }
  await ensureComunicazioniSchema();
  const rows = await kvSql`
    UPDATE comunicazioni SET stato = ${stato}
    WHERE id = ${id} AND sede_id = ${sedeId}
    RETURNING id`;
  return rows.length > 0;
}

/** Collega (o scollega) una comunicazione a cliente/commessa. */
export async function setMatchComunicazione(
  id: number,
  sedeId: number,
  match: {
    clienteId: number | null;
    commessaId: number | null;
    confidenza: Comunicazione["matchConfidenza"];
    motivo: string | null;
  }
): Promise<boolean> {
  if (!kvSql) {
    const r = memRows.find((x) => x.id === id && x.sedeId === sedeId);
    if (!r) return false;
    r.clienteId = match.clienteId;
    r.commessaId = match.commessaId;
    r.matchConfidenza = match.confidenza;
    r.matchMotivo = match.motivo;
    return true;
  }
  await ensureComunicazioniSchema();
  const rows = await kvSql`
    UPDATE comunicazioni SET
      cliente_id = ${match.clienteId},
      commessa_id = ${match.commessaId},
      match_confidenza = ${match.confidenza},
      match_motivo = ${match.motivo}
    WHERE id = ${id} AND sede_id = ${sedeId}
    RETURNING id`;
  return rows.length > 0;
}

/**
 * Elimina una comunicazione DAL CRM. La casella non viene toccata (IMAP è
 * sola lettura): il messaggio resta visibile nel client di posta. La riga
 * diventa un tombstone così la risincronizzazione non la re-importa.
 */
export async function deleteComunicazione(
  id: number,
  sedeId: number
): Promise<boolean> {
  if (!kvSql) {
    const r = memRows.find((x) => x.id === id && x.sedeId === sedeId);
    if (!r || r.deletedAt) return false;
    r.deletedAt = new Date();
    return true;
  }
  await ensureComunicazioniSchema();
  const rows = await kvSql`
    UPDATE comunicazioni SET deleted_at = NOW()
    WHERE id = ${id} AND sede_id = ${sedeId} AND deleted_at IS NULL
    RETURNING id`;
  return rows.length > 0;
}

/**
 * Mail non eliminate e mai esaminate da Tars: la coda di analisi.
 * Anche quelle GIÀ collegate: su una mail agganciata Tars non deve più
 * proporre il collegamento, ma può proporre la gestione (un ticket, una
 * data di consegna aggiornata, una rata da registrare).
 */
export async function listDaAnalizzare(
  sedeId: number,
  limit: number
): Promise<Comunicazione[]> {
  if (!kvSql) {
    return memRows
      .filter((r) => r.sedeId === sedeId && !r.deletedAt && !r.tarsAnalizzata)
      .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())
      .slice(0, limit);
  }
  await ensureComunicazioniSchema();
  const rows = await kvSql`
    SELECT * FROM comunicazioni
    WHERE sede_id = ${sedeId}
      AND deleted_at IS NULL
      AND tars_analizzata = FALSE
    ORDER BY received_at ASC
    LIMIT ${limit}`;
  return rows.map(fromRow);
}

/** Tutte le "nuova" di una sede → "vista". Il bottone del lunedì mattina. */
export async function segnaTutteViste(sedeId: number): Promise<number> {
  if (!kvSql) {
    let n = 0;
    for (const r of memRows) {
      if (r.sedeId === sedeId && !r.deletedAt && r.stato === "nuova") {
        r.stato = "vista";
        n++;
      }
    }
    return n;
  }
  await ensureComunicazioniSchema();
  const rows = await kvSql`
    UPDATE comunicazioni SET stato = 'vista'
    WHERE sede_id = ${sedeId} AND deleted_at IS NULL AND stato = 'nuova'
    RETURNING id`;
  return rows.length;
}

/** Marca un lotto come esaminato da Tars (non verrà rianalizzato). */
export async function markAnalizzate(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  if (!kvSql) {
    for (const r of memRows) {
      if (ids.includes(r.id)) r.tarsAnalizzata = true;
    }
    return;
  }
  await ensureComunicazioniSchema();
  await kvSql`
    UPDATE comunicazioni SET tars_analizzata = TRUE
    WHERE id = ANY(${ids as any})`;
}

/** Cancella tutte le comunicazioni di una casella (alla sua rimozione). */
export async function deleteComunicazioniByCasella(
  casellaId: number
): Promise<number> {
  if (!kvSql) {
    const before = memRows.length;
    memRows = memRows.filter((r) => r.casellaId !== casellaId);
    return before - memRows.length;
  }
  await ensureComunicazioniSchema();
  const rows = await kvSql`
    DELETE FROM comunicazioni WHERE casella_id = ${casellaId} RETURNING id`;
  return rows.length;
}

// ── Lettura ─────────────────────────────────────────────────────────────────

export type FiltroComunicazioni = {
  sedeId: number;
  commessaId?: number | null;
  clienteId?: number | null;
  casellaId?: number | null;
  stato?: Comunicazione["stato"];
  search?: string;
  // Solo quelle senza commessa collegata — la coda "da smistare".
  soloNonCollegate?: boolean;
  limit?: number;
  offset?: number;
};

export async function listComunicazioni(
  f: FiltroComunicazioni
): Promise<Comunicazione[]> {
  const limit = Math.min(f.limit ?? 50, 200);
  const offset = f.offset ?? 0;

  if (!kvSql) {
    let rows = memRows.filter((r) => r.sedeId === f.sedeId && !r.deletedAt);
    if (f.commessaId != null) rows = rows.filter((r) => r.commessaId === f.commessaId);
    if (f.clienteId != null) rows = rows.filter((r) => r.clienteId === f.clienteId);
    if (f.casellaId != null) rows = rows.filter((r) => r.casellaId === f.casellaId);
    if (f.stato) rows = rows.filter((r) => r.stato === f.stato);
    if (f.soloNonCollegate) rows = rows.filter((r) => r.commessaId == null);
    if (f.search) {
      const q = f.search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.oggetto.toLowerCase().includes(q) ||
          r.mittente.toLowerCase().includes(q) ||
          r.testo.toLowerCase().includes(q)
      );
    }
    return [...rows]
      .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())
      .slice(offset, offset + limit);
  }

  await ensureComunicazioniSchema();
  // Alias locale: il narrowing di `kvSql` non sopravvive dentro le closure
  // (il reduce qui sotto), un const sì.
  const sql = kvSql;
  // Filtri composti come frammenti: niente SQL costruito per concatenazione
  // di stringhe, ogni valore resta parametrizzato.
  const conds: any[] = [sql`sede_id = ${f.sedeId}`, sql`deleted_at IS NULL`];
  if (f.commessaId != null) conds.push(sql`commessa_id = ${f.commessaId}`);
  if (f.clienteId != null) conds.push(sql`cliente_id = ${f.clienteId}`);
  if (f.casellaId != null) conds.push(sql`casella_id = ${f.casellaId}`);
  if (f.stato) conds.push(sql`stato = ${f.stato}`);
  if (f.soloNonCollegate) conds.push(sql`commessa_id IS NULL`);
  if (f.search) {
    const like = `%${f.search}%`;
    conds.push(
      sql`(oggetto ILIKE ${like} OR mittente ILIKE ${like} OR testo ILIKE ${like})`
    );
  }
  const where = conds.reduce((a, b) => sql`${a} AND ${b}`);

  const rows = await sql`
    SELECT * FROM comunicazioni
    WHERE ${where}
    ORDER BY received_at DESC
    LIMIT ${limit} OFFSET ${offset}`;
  return rows.map(fromRow);
}

export async function getComunicazione(
  id: number,
  sedeId: number
): Promise<Comunicazione | null> {
  if (!kvSql) {
    return memRows.find((r) => r.id === id && r.sedeId === sedeId) ?? null;
  }
  await ensureComunicazioniSchema();
  const rows = await kvSql`
    SELECT * FROM comunicazioni WHERE id = ${id} AND sede_id = ${sedeId} LIMIT 1`;
  return rows.length ? fromRow(rows[0]) : null;
}

export async function statsComunicazioni(
  sedeId: number
): Promise<{ nuove: number; totali: number; nonCollegate: number }> {
  if (!kvSql) {
    const mie = memRows.filter((r) => r.sedeId === sedeId && !r.deletedAt);
    return {
      nuove: mie.filter((r) => r.stato === "nuova").length,
      totali: mie.length,
      nonCollegate: mie.filter((r) => r.commessaId == null).length,
    };
  }
  await ensureComunicazioniSchema();
  const rows = await kvSql`
    SELECT
      COUNT(*) FILTER (WHERE stato = 'nuova') AS nuove,
      COUNT(*) AS totali,
      COUNT(*) FILTER (WHERE commessa_id IS NULL) AS non_collegate
    FROM comunicazioni WHERE sede_id = ${sedeId} AND deleted_at IS NULL`;
  const r = rows[0] ?? {};
  return {
    nuove: Number(r.nuove ?? 0),
    totali: Number(r.totali ?? 0),
    nonCollegate: Number(r.non_collegate ?? 0),
  };
}

/** Solo per i test: azzera lo stato in memoria. */
export function _resetComunicazioniInMemoria() {
  memRows = [];
  memNextId = 1;
}
