// Chat aziendale — messaggi fra le persone dell'ufficio.
//
// Come `comunicazioni`, è una tabella vera e non una riga JSONB: una chat
// cresce di continuo e riscrivere l'intero blob a ogni messaggio è la stessa
// malattia già curata per le email. Senza `DATABASE_URL` degrada a un array
// in memoria con la stessa API, così il dev server resta usabile.
//
// Tre canali possibili:
//   generale   uno per sede, non si lascia. È dove finiscono le azioni di
//              Tars e le approvazioni degli operatori: un registro leggibile
//              da tutti, non una notifica che sparisce.
//   diretto    fra due persone. La chiave è la coppia ordinata di id, così
//              A→B e B→A sono la stessa conversazione.
//   commessa   agganciato a una commessa, per chi ci lavora.
//
// I messaggi di sistema (`autore_id IS NULL`) non sono scrivibili dal client:
// li produce solo il server.

import { kvSql } from "../_core/persistence";

export type TipoCanale = "generale" | "diretto" | "commessa";

export type CanaleChat = {
  id: number;
  sedeId: number;
  tipo: TipoCanale;
  chiave: string;
  nome: string;
  commessaId: number | null;
  membriIds: number[];
  createdAt: Date;
};

export type MessaggioChatAziendale = {
  id: number;
  sedeId: number;
  canaleId: number;
  autoreId: number | null; // null = sistema (Tars, eventi CRM)
  autoreNome: string;
  testo: string;
  // Contesto opzionale: rende il messaggio cliccabile senza doverlo parsare.
  commessaId: number | null;
  propostaId: number | null;
  link: string | null;
  createdAt: Date;
};

export const CHIAVE_GENERALE = "generale";

/** Chiave stabile di una conversazione diretta: coppia ordinata di id. */
export function chiaveDiretta(a: number, b: number): string {
  const [primo, secondo] = [a, b].sort((x, y) => x - y);
  return `dm:${primo}:${secondo}`;
}

// ── Fallback in memoria ─────────────────────────────────────────────────────

const canaliMemoria: CanaleChat[] = [];
const messaggiMemoria: MessaggioChatAziendale[] = [];
let prossimoCanaleId = 1;
let prossimoMessaggioId = 1;

// ── Schema ──────────────────────────────────────────────────────────────────

/**
 * Esegue un passo della chat nominandolo nei log.
 *
 * Senza questo, un errore PostgreSQL arrivava al client come un 500 anonimo e
 * la pagina restava a girare: il nome del passo e' la differenza fra
 * "la chat non funziona" e "ensureSchema e' fallito".
 */
async function passo<T>(nome: string, azione: () => Promise<T>): Promise<T> {
  try {
    return await azione();
  } catch (errore: any) {
    console.error(`[chat] ${nome} fallito:`, errore?.message ?? errore);
    throw new Error(`chat/${nome}: ${errore?.message ?? "errore sconosciuto"}`);
  }
}

let schemaPromise: Promise<void> | null = null;

export function ensureChatSchema(): Promise<void> {
  if (!kvSql) return Promise.resolve();
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await kvSql!`
        CREATE TABLE IF NOT EXISTS chat_canali (
          id BIGSERIAL PRIMARY KEY,
          sede_id INTEGER NOT NULL,
          tipo TEXT NOT NULL,
          chiave TEXT NOT NULL,
          nome TEXT NOT NULL,
          commessa_id INTEGER,
          membri_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
      // Un canale per sede e chiave: due richieste concorrenti sulla stessa
      // conversazione diretta non possono creare due stanze.
      await kvSql!`
        CREATE UNIQUE INDEX IF NOT EXISTS chat_canali_sede_chiave
          ON chat_canali (sede_id, chiave)`;
      await kvSql!`
        CREATE TABLE IF NOT EXISTS chat_messaggi (
          id BIGSERIAL PRIMARY KEY,
          sede_id INTEGER NOT NULL,
          canale_id BIGINT NOT NULL,
          autore_id INTEGER,
          autore_nome TEXT NOT NULL,
          testo TEXT NOT NULL,
          commessa_id INTEGER,
          proposta_id INTEGER,
          link TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
      await kvSql!`
        CREATE INDEX IF NOT EXISTS chat_messaggi_canale
          ON chat_messaggi (canale_id, id DESC)`;
      await kvSql!`
        CREATE TABLE IF NOT EXISTS chat_letture (
          sede_id INTEGER NOT NULL,
          canale_id BIGINT NOT NULL,
          utente_id INTEGER NOT NULL,
          ultimo_messaggio_id BIGINT NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (canale_id, utente_id)
        )`;
    })().catch(e => {
      console.error("[chat] ensureSchema fallito:", e?.message ?? e);
      // Azzerare la promise permette un nuovo tentativo alla richiesta
      // successiva: un guasto transitorio non deve spegnere la chat fino al
      // prossimo deploy.
      schemaPromise = null;
      throw new Error(`chat/ensureSchema: ${e?.message ?? "errore sconosciuto"}`);
    });
  }
  return schemaPromise;
}

function rigaCanale(row: any): CanaleChat {
  return {
    id: Number(row.id),
    sedeId: Number(row.sede_id),
    tipo: row.tipo,
    chiave: row.chiave,
    nome: row.nome,
    commessaId: row.commessa_id == null ? null : Number(row.commessa_id),
    membriIds: Array.isArray(row.membri_ids) ? row.membri_ids.map(Number) : [],
    createdAt: new Date(row.created_at),
  };
}

function rigaMessaggio(row: any): MessaggioChatAziendale {
  return {
    id: Number(row.id),
    sedeId: Number(row.sede_id),
    canaleId: Number(row.canale_id),
    autoreId: row.autore_id == null ? null : Number(row.autore_id),
    autoreNome: row.autore_nome,
    testo: row.testo,
    commessaId: row.commessa_id == null ? null : Number(row.commessa_id),
    propostaId: row.proposta_id == null ? null : Number(row.proposta_id),
    link: row.link ?? null,
    createdAt: new Date(row.created_at),
  };
}

// ── Canali ──────────────────────────────────────────────────────────────────

export async function trovaOCreaCanale(input: {
  sedeId: number;
  tipo: TipoCanale;
  chiave: string;
  nome: string;
  commessaId?: number | null;
  membriIds?: number[];
}): Promise<CanaleChat> {
  const membriIds = input.membriIds ?? [];
  if (!kvSql) {
    const esistente = canaliMemoria.find(
      c => c.sedeId === input.sedeId && c.chiave === input.chiave
    );
    if (esistente) return esistente;
    const canale: CanaleChat = {
      id: prossimoCanaleId++,
      sedeId: input.sedeId,
      tipo: input.tipo,
      chiave: input.chiave,
      nome: input.nome,
      commessaId: input.commessaId ?? null,
      membriIds,
      createdAt: new Date(),
    };
    canaliMemoria.push(canale);
    return canale;
  }
  await ensureChatSchema();
  return passo("trovaOCreaCanale", async () => {
    // ON CONFLICT DO UPDATE invece di DO NOTHING: senza, una corsa fra due
    // richieste lascerebbe la seconda senza riga da leggere. `EXCLUDED` non
    // serve — il nome esistente resta quello buono.
    const rows = await kvSql!`
      INSERT INTO chat_canali (sede_id, tipo, chiave, nome, commessa_id, membri_ids)
      VALUES (${input.sedeId}, ${input.tipo}, ${input.chiave}, ${input.nome},
              ${input.commessaId ?? null}, ${kvSql!.json(membriIds as any)})
      ON CONFLICT (sede_id, chiave)
        DO UPDATE SET nome = EXCLUDED.nome
      RETURNING *`;
    return rigaCanale(rows[0]);
  });
}

export async function canaleGenerale(sedeId: number): Promise<CanaleChat> {
  return trovaOCreaCanale({
    sedeId,
    tipo: "generale",
    chiave: CHIAVE_GENERALE,
    nome: "Generale",
  });
}

export async function listaCanali(input: {
  sedeId: number;
  utenteId: number;
}): Promise<Array<CanaleChat & { nonLetti: number; ultimo: MessaggioChatAziendale | null }>> {
  await canaleGenerale(input.sedeId);
  const canali = !kvSql
    ? canaliMemoria.filter(c => c.sedeId === input.sedeId)
    : (
        await kvSql`
          SELECT * FROM chat_canali WHERE sede_id = ${input.sedeId}
          ORDER BY CASE WHEN tipo = 'generale' THEN 0 ELSE 1 END, id`
      ).map(rigaCanale);

  // Il generale è di tutti; gli altri solo di chi ne fa parte.
  const visibili = canali.filter(
    c => c.tipo === "generale" || c.membriIds.includes(input.utenteId)
  );

  const risultato = [];
  for (const canale of visibili) {
    risultato.push({
      ...canale,
      nonLetti: await contaNonLetti(canale, input.utenteId),
      ultimo: await ultimoMessaggio(canale),
    });
  }
  return risultato;
}

async function ultimoMessaggio(
  canale: CanaleChat
): Promise<MessaggioChatAziendale | null> {
  if (!kvSql) {
    const messaggi = messaggiMemoria.filter(m => m.canaleId === canale.id);
    return messaggi.length ? messaggi[messaggi.length - 1] : null;
  }
  const rows = await kvSql`
    SELECT * FROM chat_messaggi WHERE canale_id = ${canale.id}
    ORDER BY id DESC LIMIT 1`;
  return rows.length ? rigaMessaggio(rows[0]) : null;
}

async function contaNonLetti(
  canale: CanaleChat,
  utenteId: number
): Promise<number> {
  const soglia = await ultimaLettura(canale.id, utenteId);
  if (!kvSql) {
    return messaggiMemoria.filter(
      m => m.canaleId === canale.id && m.id > soglia && m.autoreId !== utenteId
    ).length;
  }
  const rows = await kvSql`
    SELECT COUNT(*)::int AS n FROM chat_messaggi
    WHERE canale_id = ${canale.id} AND id > ${soglia}
      AND (autore_id IS NULL OR autore_id <> ${utenteId})`;
  return Number(rows[0]?.n ?? 0);
}

// ── Letture ─────────────────────────────────────────────────────────────────

const lettureMemoria = new Map<string, number>();

async function ultimaLettura(
  canaleId: number,
  utenteId: number
): Promise<number> {
  if (!kvSql) return lettureMemoria.get(`${canaleId}:${utenteId}`) ?? 0;
  const rows = await kvSql`
    SELECT ultimo_messaggio_id FROM chat_letture
    WHERE canale_id = ${canaleId} AND utente_id = ${utenteId}`;
  return Number(rows[0]?.ultimo_messaggio_id ?? 0);
}

export async function segnaLetto(input: {
  sedeId: number;
  canaleId: number;
  utenteId: number;
  finoAId: number;
}): Promise<void> {
  if (!kvSql) {
    const chiave = `${input.canaleId}:${input.utenteId}`;
    const attuale = lettureMemoria.get(chiave) ?? 0;
    lettureMemoria.set(chiave, Math.max(attuale, input.finoAId));
    return;
  }
  await ensureChatSchema();
  // GREATEST: due schede aperte non devono far arretrare il segnalibro.
  await kvSql`
    INSERT INTO chat_letture (sede_id, canale_id, utente_id, ultimo_messaggio_id)
    VALUES (${input.sedeId}, ${input.canaleId}, ${input.utenteId}, ${input.finoAId})
    ON CONFLICT (canale_id, utente_id) DO UPDATE
      SET ultimo_messaggio_id = GREATEST(
            chat_letture.ultimo_messaggio_id, EXCLUDED.ultimo_messaggio_id),
          updated_at = NOW()`;
}

// ── Messaggi ────────────────────────────────────────────────────────────────

export async function scriviMessaggio(input: {
  sedeId: number;
  canaleId: number;
  autoreId: number | null;
  autoreNome: string;
  testo: string;
  commessaId?: number | null;
  propostaId?: number | null;
  link?: string | null;
}): Promise<MessaggioChatAziendale> {
  const testo = input.testo.trim();
  if (!testo) throw new Error("Messaggio vuoto");
  if (!kvSql) {
    const messaggio: MessaggioChatAziendale = {
      id: prossimoMessaggioId++,
      sedeId: input.sedeId,
      canaleId: input.canaleId,
      autoreId: input.autoreId,
      autoreNome: input.autoreNome,
      testo,
      commessaId: input.commessaId ?? null,
      propostaId: input.propostaId ?? null,
      link: input.link ?? null,
      createdAt: new Date(),
    };
    messaggiMemoria.push(messaggio);
    return messaggio;
  }
  await ensureChatSchema();
  const rows = await kvSql`
    INSERT INTO chat_messaggi
      (sede_id, canale_id, autore_id, autore_nome, testo, commessa_id, proposta_id, link)
    VALUES (${input.sedeId}, ${input.canaleId}, ${input.autoreId},
            ${input.autoreNome}, ${testo}, ${input.commessaId ?? null},
            ${input.propostaId ?? null}, ${input.link ?? null})
    RETURNING *`;
  return rigaMessaggio(rows[0]);
}

export async function leggiMessaggi(input: {
  sedeId: number;
  canaleId: number;
  limite?: number;
  primaDiId?: number | null;
}): Promise<MessaggioChatAziendale[]> {
  const limite = Math.min(Math.max(input.limite ?? 50, 1), 200);
  if (!kvSql) {
    return messaggiMemoria
      .filter(
        m =>
          m.canaleId === input.canaleId &&
          m.sedeId === input.sedeId &&
          (input.primaDiId == null || m.id < input.primaDiId)
      )
      .slice(-limite);
  }
  await ensureChatSchema();
  const rows = input.primaDiId
    ? await kvSql`
        SELECT * FROM chat_messaggi
        WHERE sede_id = ${input.sedeId} AND canale_id = ${input.canaleId}
          AND id < ${input.primaDiId}
        ORDER BY id DESC LIMIT ${limite}`
    : await kvSql`
        SELECT * FROM chat_messaggi
        WHERE sede_id = ${input.sedeId} AND canale_id = ${input.canaleId}
        ORDER BY id DESC LIMIT ${limite}`;
  return rows.map(rigaMessaggio).reverse();
}

export async function trovaCanale(
  sedeId: number,
  canaleId: number
): Promise<CanaleChat | null> {
  if (!kvSql) {
    return (
      canaliMemoria.find(c => c.id === canaleId && c.sedeId === sedeId) ?? null
    );
  }
  await ensureChatSchema();
  const rows = await kvSql`
    SELECT * FROM chat_canali WHERE id = ${canaleId} AND sede_id = ${sedeId}`;
  return rows.length ? rigaCanale(rows[0]) : null;
}

/** Solo per i test: azzera il fallback in memoria fra una suite e l'altra. */
export function _resetChatInMemoria(): void {
  canaliMemoria.length = 0;
  messaggiMemoria.length = 0;
  lettureMemoria.clear();
  prossimoCanaleId = 1;
  prossimoMessaggioId = 1;
}
