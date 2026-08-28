// Chat aziendale — messaggi fra le persone dell'ufficio.
//
// Come `comunicazioni`, è una tabella vera e non una riga JSONB: una chat
// cresce di continuo e riscrivere l'intero blob a ogni messaggio è la stessa
// malattia già curata per le email. Senza `DATABASE_URL` degrada a un array
// in memoria con la stessa API, così il dev server resta usabile.
//
// Tre canali possibili:
//   generale   uno per sede, non si lascia. Nato come registro delle azioni
//              dell'agente (rimosso il 28/08/2026); oggi è il canale comune
//              della sede, leggibile da tutti, non una notifica che sparisce.
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
  autoreId: number | null; // null = mittente di sistema (eventi CRM)
  autoreNome: string;
  testo: string;
  // Contesto opzionale: rende il messaggio cliccabile senza doverlo parsare.
  commessaId: number | null;
  propostaId: number | null;
  link: string | null;
  /** emoji → id di chi l'ha messa. Vuoto quasi sempre, quindi sta inline. */
  reazioni: Record<string, number[]>;
  createdAt: Date;
};

export const CHIAVE_GENERALE = "generale";

/**
 * Sede di una conversazione diretta.
 *
 * Zero, cioè nessuna: due persone che si scrivono non sono un record
 * aziendale, e legare la conversazione alla sede attiva la faceva sparire
 * appena una delle due cambiava showroom — o la rendeva impossibile fra chi
 * lavora in sedi diverse. Il generale resta invece per sede: quello è il
 * registro di un ufficio, non di una persona.
 */
export const SEDE_CONVERSAZIONE_DIRETTA = 0;

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
      // Le reazioni sono una mappa emoji → id di chi l'ha messa. Sta sul
      // messaggio perché si legge sempre insieme a lui e non si interroga mai
      // da sola: una tabella a parte sarebbe una join per niente.
      await kvSql!`
        ALTER TABLE chat_messaggi
          ADD COLUMN IF NOT EXISTS reazioni JSONB NOT NULL DEFAULT '{}'::jsonb`;
      // Riparazione una tantum dei membri scritti come stringa jsonb dalla
      // prima versione: senza, quelle conversazioni restano invisibili.
      await kvSql!`
        UPDATE chat_canali
           SET membri_ids = (membri_ids #>> '{}')::jsonb
         WHERE jsonb_typeof(membri_ids) = 'string'`;
      // Le conversazioni dirette escono dalla sede: erano legate a quella
      // attiva al momento della creazione e sparivano al cambio showroom.
      await kvSql!`
        UPDATE chat_canali SET sede_id = ${SEDE_CONVERSAZIONE_DIRETTA}
         WHERE tipo = 'diretto' AND sede_id <> ${SEDE_CONVERSAZIONE_DIRETTA}`;
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

/**
 * I membri di un canale, comunque siano finiti nella colonna.
 *
 * Le prime righe sono state scritte con `JSON.stringify(...)::jsonb`, che
 * produce una STRINGA jsonb (`"[8,3]"`) invece di un array. Letta con
 * `Array.isArray` diventava una lista vuota, e una conversazione diretta
 * senza membri non è visibile a nessuno dei due: la chat esisteva e non si
 * apriva. La scrittura ora usa `kvSql.json`, ma le righe vecchie restano e
 * vanno lette lo stesso.
 */
function membriDaColonna(valore: unknown): number[] {
  if (Array.isArray(valore)) return valore.map(Number).filter(Number.isFinite);
  if (typeof valore === "string") {
    try {
      const parsed = JSON.parse(valore);
      return Array.isArray(parsed)
        ? parsed.map(Number).filter(Number.isFinite)
        : [];
    } catch {
      return [];
    }
  }
  return [];
}

function rigaCanale(row: any): CanaleChat {
  return {
    id: Number(row.id),
    sedeId: Number(row.sede_id),
    tipo: row.tipo,
    chiave: row.chiave,
    nome: row.nome,
    commessaId: row.commessa_id == null ? null : Number(row.commessa_id),
    membriIds: membriDaColonna(row.membri_ids),
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
    reazioni: reazioniDaColonna(row.reazioni),
    createdAt: new Date(row.created_at),
  };
}

function reazioniDaColonna(valore: unknown): Record<string, number[]> {
  const grezzo =
    typeof valore === "string"
      ? (() => {
          try {
            return JSON.parse(valore);
          } catch {
            return {};
          }
        })()
      : valore;
  if (!grezzo || typeof grezzo !== "object" || Array.isArray(grezzo)) return {};
  const risultato: Record<string, number[]> = {};
  for (const [emoji, ids] of Object.entries(grezzo as Record<string, unknown>)) {
    if (!Array.isArray(ids)) continue;
    const puliti = ids.map(Number).filter(Number.isFinite);
    if (puliti.length > 0) risultato[emoji] = puliti;
  }
  return risultato;
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

/** Una conversazione diretta, indipendente dalla sede di chi la apre. */
export async function canaleDiretto(input: {
  a: number;
  b: number;
  nome: string;
}): Promise<CanaleChat> {
  return trovaOCreaCanale({
    sedeId: SEDE_CONVERSAZIONE_DIRETTA,
    tipo: "diretto",
    chiave: chiaveDiretta(input.a, input.b),
    nome: input.nome,
    membriIds: [input.a, input.b],
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

/** I canali che una persona può vedere da una certa sede attiva. */
async function canaliVisibili(input: {
  sedeId: number;
  utenteId: number;
}): Promise<CanaleChat[]> {
  await canaleGenerale(input.sedeId);
  // Il generale della sede attiva, più ogni conversazione diretta di cui si
  // fa parte — quelle non hanno sede, quindi seguono la persona e non lo
  // showroom in cui sta lavorando adesso.
  const canali = !kvSql
    ? canaliMemoria.filter(
        c =>
          c.sedeId === input.sedeId ||
          c.sedeId === SEDE_CONVERSAZIONE_DIRETTA
      )
    : (
        await kvSql`
          SELECT * FROM chat_canali
           WHERE sede_id = ${input.sedeId}
              OR sede_id = ${SEDE_CONVERSAZIONE_DIRETTA}
          ORDER BY CASE WHEN tipo = 'generale' THEN 0 ELSE 1 END, id`
      ).map(rigaCanale);

  // Il generale è di tutti; gli altri solo di chi ne fa parte.
  return canali.filter(
    c => c.tipo === "generale" || c.membriIds.includes(input.utenteId)
  );
}

export async function listaCanali(input: {
  sedeId: number;
  utenteId: number;
}): Promise<
  Array<CanaleChat & { nonLetti: number; ultimo: MessaggioChatAziendale | null }>
> {
  const visibili = await canaliVisibili(input);
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
      reazioni: {},
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
          (input.primaDiId == null || m.id < input.primaDiId)
      )
      .slice(-limite);
  }
  await ensureChatSchema();
  // Nessun filtro di sede: il canale e' gia' stato autorizzato dal chiamante,
  // e una conversazione diretta non appartiene a nessuna sede.
  const rows = input.primaDiId
    ? await kvSql`
        SELECT * FROM chat_messaggi
        WHERE canale_id = ${input.canaleId} AND id < ${input.primaDiId}
        ORDER BY id DESC LIMIT ${limite}`
    : await kvSql`
        SELECT * FROM chat_messaggi
        WHERE canale_id = ${input.canaleId}
        ORDER BY id DESC LIMIT ${limite}`;
  return rows.map(rigaMessaggio).reverse();
}

export async function trovaCanale(
  sedeId: number,
  canaleId: number
): Promise<CanaleChat | null> {
  if (!kvSql) {
    return (
      canaliMemoria.find(
        c =>
          c.id === canaleId &&
          (c.sedeId === sedeId || c.sedeId === SEDE_CONVERSAZIONE_DIRETTA)
      ) ?? null
    );
  }
  await ensureChatSchema();
  const rows = await kvSql`
    SELECT * FROM chat_canali
     WHERE id = ${canaleId}
       AND (sede_id = ${sedeId} OR sede_id = ${SEDE_CONVERSAZIONE_DIRETTA})`;
  return rows.length ? rigaCanale(rows[0]) : null;
}

/**
 * Aggiunge o toglie una reazione. Toggle: la stessa emoji dalla stessa
 * persona la rimuove, perche' un pollice messo per sbaglio deve costare un
 * click per tornare indietro, non una spiegazione.
 */
export async function commutaReazione(input: {
  messaggioId: number;
  utenteId: number;
  emoji: string;
}): Promise<Record<string, number[]>> {
  const applica = (attuali: Record<string, number[]>) => {
    const chi = attuali[input.emoji] ?? [];
    const gia = chi.includes(input.utenteId);
    const dopo = gia
      ? chi.filter(id => id !== input.utenteId)
      : [...chi, input.utenteId];
    const risultato = { ...attuali };
    if (dopo.length > 0) risultato[input.emoji] = dopo;
    else delete risultato[input.emoji];
    return risultato;
  };

  if (!kvSql) {
    const messaggio = messaggiMemoria.find(m => m.id === input.messaggioId);
    if (!messaggio) throw new Error("Messaggio non trovato");
    messaggio.reazioni = applica(messaggio.reazioni ?? {});
    return messaggio.reazioni;
  }
  await ensureChatSchema();
  return passo("commutaReazione", async () => {
    const [riga] = await kvSql!`
      SELECT reazioni FROM chat_messaggi WHERE id = ${input.messaggioId}`;
    if (!riga) throw new Error("Messaggio non trovato");
    const dopo = applica(reazioniDaColonna(riga.reazioni));
    await kvSql!`
      UPDATE chat_messaggi SET reazioni = ${kvSql!.json(dopo as any)}
       WHERE id = ${input.messaggioId}`;
    return dopo;
  });
}

/** Il canale di un messaggio, per autorizzare la reazione. */
export async function canaleDiMessaggio(
  messaggioId: number
): Promise<number | null> {
  if (!kvSql) {
    return messaggiMemoria.find(m => m.id === messaggioId)?.canaleId ?? null;
  }
  await ensureChatSchema();
  const [riga] = await kvSql`
    SELECT canale_id FROM chat_messaggi WHERE id = ${messaggioId}`;
  return riga ? Number(riga.canale_id) : null;
}

export type RiepilogoNonLetti = {
  totale: number;
  /** L'ultimo messaggio non letto: serve a scrivere una notifica vera. */
  ultimo: {
    canaleId: number;
    canaleNome: string;
    autore: string;
    anteprima: string;
    messaggioId: number;
  } | null;
};

/**
 * Non letti su tutti i canali visibili.
 *
 * Restituisce anche l'ultimo messaggio: una notifica che dice "hai un
 * messaggio" costringe ad aprire per sapere se valeva la pena. Dire chi ha
 * scritto e cosa lascia decidere senza muoversi.
 */
export async function totaleNonLetti(input: {
  sedeId: number;
  utenteId: number;
}): Promise<RiepilogoNonLetti> {
  const canali = await canaliVisibili(input);
  if (canali.length === 0) return { totale: 0, ultimo: null };
  const perId = new Map(canali.map(canale => [canale.id, canale]));

  if (!kvSql) {
    let totale = 0;
    let ultimo: RiepilogoNonLetti["ultimo"] = null;
    for (const canale of canali) {
      const soglia = await ultimaLettura(canale.id, input.utenteId);
      const nonLetti = messaggiMemoria.filter(
        m =>
          m.canaleId === canale.id &&
          m.id > soglia &&
          m.autoreId !== input.utenteId
      );
      totale += nonLetti.length;
      const recente = nonLetti[nonLetti.length - 1];
      if (recente && (ultimo == null || recente.id > ultimo.messaggioId)) {
        ultimo = {
          canaleId: canale.id,
          canaleNome: canale.nome,
          autore: recente.autoreNome,
          anteprima: recente.testo.slice(0, 120),
          messaggioId: recente.id,
        };
      }
    }
    return { totale, ultimo };
  }

  await ensureChatSchema();
  return passo("totaleNonLetti", async () => {
    // Una query invece di tre per canale: questa rotta viene interrogata da
    // ogni scheda aperta ogni quindici secondi, e il conto per canale non
    // vale un giro di andata e ritorno a testa.
    const ids = canali.map(canale => canale.id);
    const righe = await kvSql!`
      SELECT m.canale_id, COUNT(*)::int AS n, MAX(m.id) AS ultimo_id
        FROM chat_messaggi m
        LEFT JOIN chat_letture l
          ON l.canale_id = m.canale_id AND l.utente_id = ${input.utenteId}
       WHERE m.canale_id = ANY(${ids}::bigint[])
         AND (m.autore_id IS NULL OR m.autore_id <> ${input.utenteId})
         AND m.id > COALESCE(l.ultimo_messaggio_id, 0)
       GROUP BY m.canale_id`;

    const totale = righe.reduce(
      (somma: number, riga: any) => somma + Number(riga.n),
      0
    );
    if (totale === 0) return { totale: 0, ultimo: null };

    const piuRecente = righe.reduce((migliore: any, riga: any) =>
      migliore == null || Number(riga.ultimo_id) > Number(migliore.ultimo_id)
        ? riga
        : migliore
    );
    const [messaggio] = await kvSql!`
      SELECT * FROM chat_messaggi WHERE id = ${Number(piuRecente.ultimo_id)}`;
    if (!messaggio) return { totale, ultimo: null };
    const riga = rigaMessaggio(messaggio);
    return {
      totale,
      ultimo: {
        canaleId: riga.canaleId,
        canaleNome: perId.get(riga.canaleId)?.nome ?? "Chat",
        autore: riga.autoreNome,
        anteprima: riga.testo.slice(0, 120),
        messaggioId: riga.id,
      },
    };
  });
}

/** Solo per i test: azzera il fallback in memoria fra una suite e l'altra. */
export function _resetChatInMemoria(): void {
  canaliMemoria.length = 0;
  messaggiMemoria.length = 0;
  lettureMemoria.clear();
  prossimoCanaleId = 1;
  prossimoMessaggioId = 1;
}
