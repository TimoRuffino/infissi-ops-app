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
import {
  categoriaEsclusa,
  classificaComunicazione,
  type CategoriaComunicazione,
  type SegnaliFiltro,
} from "./filtroComunicazioni";

export type FonteClassificazione =
  | "regole"
  | "regola_mittente"
  | "utente"
  | "tars";

export type Allegato = {
  nome: string;
  mimeType: string;
  size: number;
  // Popolato solo quando lo storage documenti è durevole (R2/S3). Finché il
  // driver è `local` gli allegati vengono elencati ma non scaricati: in
  // base64 dentro la JSONB peggiorerebbero il problema già noto.
  storageKey?: string | null;
  // WhatsApp: id del media su Meta, per scaricarlo al bisogno via Graph
  // API. Come per gli allegati IMAP, la fonte resta il canale d'origine.
  mediaId?: string | null;
};

export type Comunicazione = {
  id: number;
  sedeId: number;
  // Origine del messaggio: id della casella email quando canale='email',
  // id della configurazione WhatsApp quando canale='whatsapp'. I due spazi
  // di id sono distinti dal canale, che entra nell'indice unico.
  casellaId: number;
  messageId: string;
  // UID IMAP nella cartella d'origine: serve a ripescare il messaggio (per
  // gli allegati) senza ricerca. Null sui record precedenti a questa
  // colonna, e sempre null su WhatsApp — lì il messaggio si ritrova per id.
  uid: number | null;
  canale: "email" | "whatsapp";
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
  categoria: CategoriaComunicazione;
  classificazioneScore: number;
  classificazioneMotivo: string | null;
  classificazioneFonte: FonteClassificazione;
  // Ultimo esito di un'analisi chiesta esplicitamente dall'operatore.
  // Resta sulla comunicazione così il lavoro di Tars non si perde al refresh.
  tarsRiepilogo: string | null;
  tarsIstruzione: string | null;
  tarsUltimaAnalisiAt: Date | null;
  receivedAt: Date;
  createdAt: Date;
};

export type NuovaComunicazione = Omit<
  Comunicazione,
  | "id"
  | "createdAt"
  | "deletedAt"
  | "tarsAnalizzata"
  | "uid"
  | "categoria"
  | "classificazioneScore"
  | "classificazioneMotivo"
  | "classificazioneFonte"
  | "tarsRiepilogo"
  | "tarsIstruzione"
  | "tarsUltimaAnalisiAt"
> & {
  uid?: number | null;
  // true per la posta storica importata a posteriori: il match la aggancia,
  // ma Tars non la mette in coda di analisi — la triage è per il flusso in
  // arrivo, non per l'archivio (che a 10 mail per esecuzione costerebbe
  // decine di run inutili).
  tarsAnalizzata?: boolean;
  categoria?: CategoriaComunicazione;
  classificazioneScore?: number;
  classificazioneMotivo?: string | null;
  classificazioneFonte?: FonteClassificazione;
  segnaliFiltro?: SegnaliFiltro;
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
          categoria TEXT NOT NULL DEFAULT 'da_classificare',
          classificazione_score INTEGER NOT NULL DEFAULT 0,
          classificazione_motivo TEXT,
          classificazione_fonte TEXT NOT NULL DEFAULT 'regole',
          tars_riepilogo TEXT,
          tars_istruzione TEXT,
          tars_ultima_analisi_at TIMESTAMPTZ,
          received_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
      // Idempotenza dell'ingestione: lo stesso messaggio riletto non si
      // duplica. Il canale entra nella chiave perché casella_id vive in
      // spazi di id separati (caselle email vs configurazioni WhatsApp):
      // senza, la casella 1 e il numero 1 si contenderebbero le righe.
      // L'indice nuovo è più permissivo del vecchio, quindi la creazione
      // non può fallire sui dati esistenti.
      await kvSql!`
        CREATE UNIQUE INDEX IF NOT EXISTS comunicazioni_canale_casella_message
          ON comunicazioni (canale, casella_id, message_id)`;
      await kvSql!`DROP INDEX IF EXISTS comunicazioni_casella_message`;
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
      await kvSql!`
        ALTER TABLE comunicazioni
          ADD COLUMN IF NOT EXISTS categoria TEXT NOT NULL DEFAULT 'da_classificare'`;
      await kvSql!`
        ALTER TABLE comunicazioni
          ADD COLUMN IF NOT EXISTS classificazione_score INTEGER NOT NULL DEFAULT 0`;
      await kvSql!`
        ALTER TABLE comunicazioni
          ADD COLUMN IF NOT EXISTS classificazione_motivo TEXT`;
      await kvSql!`
        ALTER TABLE comunicazioni
          ADD COLUMN IF NOT EXISTS classificazione_fonte TEXT NOT NULL DEFAULT 'regole'`;
      await kvSql!`
        ALTER TABLE comunicazioni
          ADD COLUMN IF NOT EXISTS tars_riepilogo TEXT`;
      await kvSql!`
        ALTER TABLE comunicazioni
          ADD COLUMN IF NOT EXISTS tars_istruzione TEXT`;
      await kvSql!`
        ALTER TABLE comunicazioni
          ADD COLUMN IF NOT EXISTS tars_ultima_analisi_at TIMESTAMPTZ`;
      await kvSql!`
        CREATE INDEX IF NOT EXISTS comunicazioni_sede_categoria
          ON comunicazioni (sede_id, categoria, received_at DESC)`;
      await backfillGestiteCollegate();
    })().catch(e => {
      console.error("[comunicazioni] ensureSchema failed:", e);
      schemaPromise = null;
      throw e;
    });
  }
  return schemaPromise;
}

/**
 * Recupero una tantum dello storico: prima di questa versione collegare una
 * mail a una commessa non la marcava gestita, quindi la coda operativa ha
 * accumulato messaggi già smistati.
 *
 * Tocca SOLO le righe `vista`: una `nuova` non è mai stata aperta da nessuno
 * e nasconderla sarebbe peggio del disordine. Il marker rende la migrazione
 * davvero una tantum — senza, ogni riavvio richiuderebbe le comunicazioni che
 * un operatore ha riaperto a mano.
 */
async function backfillGestiteCollegate(): Promise<void> {
  await kvSql!`
    CREATE TABLE IF NOT EXISTS comunicazioni_migrazioni (
      nome TEXT PRIMARY KEY,
      eseguita_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  const primaVolta = await kvSql!`
    INSERT INTO comunicazioni_migrazioni (nome)
    VALUES ('backfill_gestite_collegate_v1')
    ON CONFLICT (nome) DO NOTHING
    RETURNING nome`;
  if (primaVolta.length === 0) return;

  const aggiornate = await kvSql!`
    UPDATE comunicazioni SET stato = 'gestita'
    WHERE commessa_id IS NOT NULL
      AND stato = 'vista'
      AND deleted_at IS NULL
    RETURNING id`;
  console.log(
    `[comunicazioni] backfill gestite: ${aggiornate.length} comunicazioni collegate portate in Gestite`
  );
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
    categoria: r.categoria ?? "da_classificare",
    classificazioneScore: Number(r.classificazione_score ?? 0),
    classificazioneMotivo: r.classificazione_motivo ?? null,
    classificazioneFonte: r.classificazione_fonte ?? "regole",
    tarsRiepilogo: r.tars_riepilogo ?? null,
    tarsIstruzione: r.tars_istruzione ?? null,
    tarsUltimaAnalisiAt: r.tars_ultima_analisi_at
      ? new Date(r.tars_ultima_analisi_at)
      : null,
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
  const classificazione = c.categoria
    ? {
        categoria: c.categoria,
        score: c.classificazioneScore ?? 100,
        motivo:
          c.classificazioneMotivo ?? "Classificazione fornita dalla fonte.",
        fonte: c.classificazioneFonte ?? ("regole" as const),
      }
    : classificaComunicazione({
        sedeId: c.sedeId,
        mittente: c.mittente,
        oggetto: c.oggetto,
        testo,
        allegati: c.allegati,
        clienteId: c.clienteId,
        commessaId: c.commessaId,
        segnali: c.segnaliFiltro,
      });
  const richiedeClassificazioneTars =
    c.canale === "email" &&
    c.direzione === "in" &&
    c.tarsAnalizzata !== true &&
    c.categoria === undefined;
  const classificazioneIniziale = richiedeClassificazioneTars
    ? {
        categoria: "da_classificare" as const,
        score: classificazione.score,
        motivo: `Controllo preliminare: ${classificazione.motivo} In attesa della classificazione automatica di Tars.`,
        fonte: "regole" as const,
      }
    : classificazione;
  // Le email nuove passano sempre da Tars, comprese quelle che gli header
  // o le regole locali sospettano essere spam. Lo storico può continuare a
  // dichiararsi già analizzato esplicitamente in fase di importazione.
  const tarsAnalizzata = c.tarsAnalizzata ?? false;

  if (!kvSql) {
    const dup = memRows.some(
      r =>
        r.canale === c.canale &&
        r.casellaId === c.casellaId &&
        r.messageId === c.messageId
    );
    if (dup) return null;
    const { segnaliFiltro: _segnaliFiltro, ...dati } = c;
    const row: Comunicazione = {
      ...dati,
      uid: c.uid ?? null,
      testo,
      id: memNextId++,
      deletedAt: null,
      tarsAnalizzata,
      categoria: classificazioneIniziale.categoria,
      classificazioneScore: classificazioneIniziale.score,
      classificazioneMotivo: classificazioneIniziale.motivo,
      classificazioneFonte: classificazioneIniziale.fonte,
      tarsRiepilogo: null,
      tarsIstruzione: null,
      tarsUltimaAnalisiAt: null,
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
      tars_analizzata, categoria, classificazione_score,
      classificazione_motivo, classificazione_fonte, received_at
    ) VALUES (
      ${c.sedeId}, ${c.casellaId}, ${c.messageId}, ${c.uid ?? null}, ${c.canale}, ${c.direzione},
      ${c.mittente}, ${c.mittenteNome}, ${kvSql.json(c.destinatari as any)},
      ${c.oggetto}, ${testo}, ${kvSql.json(c.allegati as any)},
      ${c.clienteId}, ${c.commessaId}, ${c.matchConfidenza}, ${c.matchMotivo},
      ${c.stato}, ${tarsAnalizzata}, ${classificazioneIniziale.categoria},
      ${classificazioneIniziale.score}, ${classificazioneIniziale.motivo},
      ${classificazioneIniziale.fonte}, ${c.receivedAt}
    )
    ON CONFLICT (canale, casella_id, message_id) DO NOTHING
    RETURNING *`;
  return rows.length ? fromRow(rows[0]) : null;
}

export async function setStatoComunicazione(
  id: number,
  sedeId: number,
  stato: Comunicazione["stato"]
): Promise<boolean> {
  if (!kvSql) {
    const r = memRows.find(x => x.id === id && x.sedeId === sedeId);
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

export async function setClassificazioneComunicazione(
  id: number,
  sedeId: number,
  classificazione: {
    categoria: CategoriaComunicazione;
    motivo: string;
    fonte: FonteClassificazione;
    score?: number;
  }
): Promise<boolean> {
  const esclusa = categoriaEsclusa(classificazione.categoria);
  if (!kvSql) {
    const r = memRows.find(
      x => x.id === id && x.sedeId === sedeId && !x.deletedAt
    );
    if (!r) return false;
    r.categoria = classificazione.categoria;
    r.classificazioneScore = classificazione.score ?? 100;
    r.classificazioneMotivo = classificazione.motivo;
    r.classificazioneFonte = classificazione.fonte;
    if (esclusa) r.tarsAnalizzata = true;
    else if (classificazione.fonte === "utente") r.tarsAnalizzata = false;
    if (esclusa) r.stato = "gestita";
    return true;
  }
  await ensureComunicazioniSchema();
  const rows = await kvSql`
    UPDATE comunicazioni SET
      categoria = ${classificazione.categoria},
      classificazione_score = ${classificazione.score ?? 100},
      classificazione_motivo = ${classificazione.motivo},
      classificazione_fonte = ${classificazione.fonte},
      tars_analizzata = CASE
        WHEN ${esclusa} THEN TRUE
        WHEN ${classificazione.fonte === "utente"} THEN FALSE
        ELSE tars_analizzata
      END,
      stato = CASE WHEN ${esclusa} THEN 'gestita' ELSE stato END
    WHERE id = ${id} AND sede_id = ${sedeId} AND deleted_at IS NULL
    RETURNING id`;
  return rows.length > 0;
}

export async function salvaEsitoTarsComunicazione(
  id: number,
  sedeId: number,
  input: { riepilogo: string; istruzione: string }
): Promise<boolean> {
  if (!kvSql) {
    const r = memRows.find(
      x => x.id === id && x.sedeId === sedeId && !x.deletedAt
    );
    if (!r) return false;
    r.tarsRiepilogo = input.riepilogo;
    r.tarsIstruzione = input.istruzione;
    r.tarsUltimaAnalisiAt = new Date();
    r.tarsAnalizzata = true;
    return true;
  }
  await ensureComunicazioniSchema();
  const rows = await kvSql`
    UPDATE comunicazioni SET
      tars_riepilogo = ${input.riepilogo},
      tars_istruzione = ${input.istruzione},
      tars_ultima_analisi_at = NOW(),
      tars_analizzata = TRUE
    WHERE id = ${id} AND sede_id = ${sedeId} AND deleted_at IS NULL
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
  // Collegare a una commessa È gestire: ci arriva solo un atto umano
  // esplicito (collegamento manuale o approvazione di una proposta Tars),
  // mai il match automatico dell'ingestione, che passa da insertComunicazione.
  // Scollegare riapre la pratica, tranne per le categorie escluse: quelle
  // sono già fuori dalla coda per classificazione, non per collegamento.
  const collega = match.commessaId != null;
  if (!kvSql) {
    const r = memRows.find(x => x.id === id && x.sedeId === sedeId);
    if (!r) return false;
    r.clienteId = match.clienteId;
    r.commessaId = match.commessaId;
    r.matchConfidenza = match.confidenza;
    r.matchMotivo = match.motivo;
    if (collega) r.stato = "gestita";
    else if (r.stato === "gestita" && !categoriaEsclusa(r.categoria)) {
      r.stato = "vista";
    }
    return true;
  }
  await ensureComunicazioniSchema();
  const rows = await kvSql`
    UPDATE comunicazioni SET
      cliente_id = ${match.clienteId},
      commessa_id = ${match.commessaId},
      match_confidenza = ${match.confidenza},
      match_motivo = ${match.motivo},
      stato = CASE
        WHEN ${collega} THEN 'gestita'
        WHEN stato = 'gestita'
          AND categoria NOT IN ('offerta_marketing', 'spam') THEN 'vista'
        ELSE stato
      END
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
    const r = memRows.find(x => x.id === id && x.sedeId === sedeId);
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
      .filter(
        r =>
          r.sedeId === sedeId &&
          !r.deletedAt &&
          !r.tarsAnalizzata &&
          !categoriaEsclusa(r.categoria)
      )
      .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())
      .slice(0, limit);
  }
  await ensureComunicazioniSchema();
  const rows = await kvSql`
    SELECT * FROM comunicazioni
    WHERE sede_id = ${sedeId}
      AND deleted_at IS NULL
      AND tars_analizzata = FALSE
      AND categoria NOT IN ('offerta_marketing', 'spam')
    ORDER BY received_at ASC
    LIMIT ${limit}`;
  return rows.map(fromRow);
}

export type StatoCodaTars = {
  inAttesa: number;
  piuVecchiaAt: Date | null;
};

/** Stato compatto della coda AI, usato dal recupero e dalla UI operativa. */
export async function statoCodaTars(sedeId: number): Promise<StatoCodaTars> {
  if (!kvSql) {
    const inCoda = memRows
      .filter(
        r =>
          r.sedeId === sedeId &&
          !r.deletedAt &&
          !r.tarsAnalizzata &&
          !categoriaEsclusa(r.categoria)
      )
      .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
    return {
      inAttesa: inCoda.length,
      piuVecchiaAt: inCoda[0]?.receivedAt ?? null,
    };
  }
  await ensureComunicazioniSchema();
  const rows = await kvSql`
    SELECT COUNT(*) AS in_attesa, MIN(received_at) AS piu_vecchia_at
    FROM comunicazioni
    WHERE sede_id = ${sedeId}
      AND deleted_at IS NULL
      AND tars_analizzata = FALSE
      AND categoria NOT IN ('offerta_marketing', 'spam')`;
  const r = rows[0] ?? {};
  return {
    inAttesa: Number(r.in_attesa ?? 0),
    piuVecchiaAt: r.piu_vecchia_at ? new Date(r.piu_vecchia_at) : null,
  };
}

/** Sedi con lavoro AI pendente: permette il recupero anche dopo un riavvio. */
export async function sediConCodaTars(): Promise<number[]> {
  if (!kvSql) {
    return Array.from(
      new Set(
        memRows
          .filter(
            r =>
              !r.deletedAt &&
              !r.tarsAnalizzata &&
              !categoriaEsclusa(r.categoria)
          )
          .map(r => r.sedeId)
      )
    );
  }
  await ensureComunicazioniSchema();
  const rows = await kvSql`
    SELECT DISTINCT sede_id
    FROM comunicazioni
    WHERE deleted_at IS NULL
      AND tars_analizzata = FALSE
      AND categoria NOT IN ('offerta_marketing', 'spam')`;
  return rows.map(r => Number(r.sede_id)).filter(Number.isFinite);
}

/** Tutte le "nuova" di una sede → "vista". Il bottone del lunedì mattina. */
export async function segnaTutteViste(sedeId: number): Promise<number> {
  if (!kvSql) {
    let n = 0;
    for (const r of memRows) {
      if (
        r.sedeId === sedeId &&
        !r.deletedAt &&
        r.stato === "nuova" &&
        !categoriaEsclusa(r.categoria)
      ) {
        r.stato = "vista";
        n++;
      }
    }
    return n;
  }
  await ensureComunicazioniSchema();
  const rows = await kvSql`
    UPDATE comunicazioni SET stato = 'vista'
    WHERE sede_id = ${sedeId}
      AND deleted_at IS NULL
      AND stato = 'nuova'
      AND categoria NOT IN ('offerta_marketing', 'spam')
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

/**
 * Cancella le comunicazioni di una casella (alla sua rimozione). Il canale
 * è obbligatorio: casella_id vive in spazi separati per email e WhatsApp,
 * e senza filtro si cancellerebbero i messaggi dell'altro canale.
 */
export async function deleteComunicazioniByCasella(
  casellaId: number,
  canale: Comunicazione["canale"] = "email"
): Promise<number> {
  if (!kvSql) {
    const before = memRows.length;
    memRows = memRows.filter(
      r => !(r.casellaId === casellaId && r.canale === canale)
    );
    return before - memRows.length;
  }
  await ensureComunicazioniSchema();
  const rows = await kvSql`
    DELETE FROM comunicazioni
    WHERE casella_id = ${casellaId} AND canale = ${canale}
    RETURNING id`;
  return rows.length;
}

// ── Lettura ─────────────────────────────────────────────────────────────────

export type FiltroComunicazioni = {
  sedeId: number;
  commessaId?: number | null;
  clienteId?: number | null;
  casellaId?: number | null;
  canale?: Comunicazione["canale"];
  stato?: Comunicazione["stato"];
  search?: string;
  categoria?: CategoriaComunicazione;
  // Solo quelle senza commessa collegata — la coda "da smistare".
  soloNonCollegate?: boolean;
  // Coda principale: nuove o viste, mai quelle già chiuse.
  soloDaGestire?: boolean;
  // Per impostazione predefinita il rumore resta fuori dalla posta operativa.
  soloEscluse?: boolean;
  includiEscluse?: boolean;
  limit?: number;
  offset?: number;
};

export async function listComunicazioni(
  f: FiltroComunicazioni
): Promise<Comunicazione[]> {
  const limit = Math.min(f.limit ?? 50, 200);
  const offset = f.offset ?? 0;

  if (!kvSql) {
    let rows = memRows.filter(r => r.sedeId === f.sedeId && !r.deletedAt);
    if (f.commessaId != null)
      rows = rows.filter(r => r.commessaId === f.commessaId);
    if (f.clienteId != null)
      rows = rows.filter(r => r.clienteId === f.clienteId);
    if (f.casellaId != null)
      rows = rows.filter(r => r.casellaId === f.casellaId);
    if (f.canale) rows = rows.filter(r => r.canale === f.canale);
    if (f.stato) rows = rows.filter(r => r.stato === f.stato);
    if (f.categoria) rows = rows.filter(r => r.categoria === f.categoria);
    if (f.soloNonCollegate) rows = rows.filter(r => r.commessaId == null);
    if (f.soloDaGestire) rows = rows.filter(r => r.stato !== "gestita");
    if (f.soloEscluse) rows = rows.filter(r => categoriaEsclusa(r.categoria));
    else if (!f.includiEscluse)
      rows = rows.filter(r => !categoriaEsclusa(r.categoria));
    if (f.search) {
      const q = f.search.toLowerCase();
      rows = rows.filter(
        r =>
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
  if (f.canale) conds.push(sql`canale = ${f.canale}`);
  if (f.stato) conds.push(sql`stato = ${f.stato}`);
  if (f.categoria) conds.push(sql`categoria = ${f.categoria}`);
  if (f.soloNonCollegate) conds.push(sql`commessa_id IS NULL`);
  if (f.soloDaGestire) conds.push(sql`stato <> 'gestita'`);
  if (f.soloEscluse)
    conds.push(sql`categoria IN ('offerta_marketing', 'spam')`);
  else if (!f.includiEscluse)
    conds.push(sql`categoria NOT IN ('offerta_marketing', 'spam')`);
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
    return memRows.find(r => r.id === id && r.sedeId === sedeId) ?? null;
  }
  await ensureComunicazioniSchema();
  const rows = await kvSql`
    SELECT * FROM comunicazioni WHERE id = ${id} AND sede_id = ${sedeId} LIMIT 1`;
  return rows.length ? fromRow(rows[0]) : null;
}

export async function statsComunicazioni(sedeId: number): Promise<{
  nuove: number;
  totali: number;
  nonCollegate: number;
  gestite: number;
  email: number;
  whatsapp: number;
  escluse: number;
  daClassificare: number;
  nuoviLead: number;
}> {
  if (!kvSql) {
    const mie = memRows.filter(r => r.sedeId === sedeId && !r.deletedAt);
    const operative = mie.filter(r => !categoriaEsclusa(r.categoria));
    return {
      nuove: operative.filter(r => r.stato === "nuova").length,
      totali: operative.length,
      nonCollegate: operative.filter(r => r.commessaId == null).length,
      gestite: operative.filter(r => r.stato === "gestita").length,
      email: operative.filter(r => r.canale === "email").length,
      whatsapp: operative.filter(r => r.canale === "whatsapp").length,
      escluse: mie.length - operative.length,
      daClassificare: operative.filter(r => r.categoria === "da_classificare")
        .length,
      nuoviLead: operative.filter(r => r.categoria === "nuovo_lead").length,
    };
  }
  await ensureComunicazioniSchema();
  const rows = await kvSql`
    SELECT
      COUNT(*) FILTER (WHERE stato = 'nuova' AND categoria NOT IN ('offerta_marketing', 'spam')) AS nuove,
      COUNT(*) FILTER (WHERE categoria NOT IN ('offerta_marketing', 'spam')) AS totali,
      COUNT(*) FILTER (WHERE commessa_id IS NULL AND categoria NOT IN ('offerta_marketing', 'spam')) AS non_collegate,
      COUNT(*) FILTER (WHERE stato = 'gestita' AND categoria NOT IN ('offerta_marketing', 'spam')) AS gestite,
      COUNT(*) FILTER (WHERE canale = 'email' AND categoria NOT IN ('offerta_marketing', 'spam')) AS email,
      COUNT(*) FILTER (WHERE canale = 'whatsapp' AND categoria NOT IN ('offerta_marketing', 'spam')) AS whatsapp,
      COUNT(*) FILTER (WHERE categoria IN ('offerta_marketing', 'spam')) AS escluse,
      COUNT(*) FILTER (WHERE categoria = 'da_classificare') AS da_classificare,
      COUNT(*) FILTER (WHERE categoria = 'nuovo_lead') AS nuovi_lead
    FROM comunicazioni WHERE sede_id = ${sedeId} AND deleted_at IS NULL`;
  const r = rows[0] ?? {};
  return {
    nuove: Number(r.nuove ?? 0),
    totali: Number(r.totali ?? 0),
    nonCollegate: Number(r.non_collegate ?? 0),
    gestite: Number(r.gestite ?? 0),
    email: Number(r.email ?? 0),
    whatsapp: Number(r.whatsapp ?? 0),
    escluse: Number(r.escluse ?? 0),
    daClassificare: Number(r.da_classificare ?? 0),
    nuoviLead: Number(r.nuovi_lead ?? 0),
  };
}

/** Solo per i test: azzera lo stato in memoria. */
export function _resetComunicazioniInMemoria() {
  memRows = [];
  memNextId = 1;
}
