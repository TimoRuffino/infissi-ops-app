// server/tenants/tabelle.ts
// `tenant_id` sulle tabelle relazionali per sede (Task 12, spec WS2 §6.2).
//
// La verità del confine resta `sede_id`: le query di dominio non cambiano di
// una riga. `tenant_id` è materiale di servizio — export, diagnostica,
// cancellazione per tenant, controlli incrociati — e per questo la migrazione
// è deliberatamente additiva:
//   - colonna NULLABLE (mai NOT NULL): una scrittura che non la valorizza non
//     deve fallire, e il codice esistente non la valorizza;
//   - un trigger BEFORE INSERT la riempie SOLO se arriva NULL, leggendo lo
//     specchio `tenant_sedi` (che il boot e la creazione di una sede tengono
//     allineato): una sede sconosciuta lascia NULL, non blocca l'INSERT, e lo
//     specchio ancora inesistente nemmeno (il trigger cattura `undefined_table`);
//   - il backfill dei NULL rimasti è una funzione SEPARATA, a lotti.
// Una tabella assente al boot viene saltata e segnalata nel log: la creerà il
// suo modulo alla prima richiesta e il boot successivo la troverà.
//
// Le due funzioni stanno da parti opposte del `listen` (Ruling R14):
//   - `applicaTenantIdAlleTabelle` è DDL e basta, con `lock_timeout` per
//     tabella: se non ottiene il lock ACCESS EXCLUSIVE entro il timeout la
//     tabella finisce fra le «rinviate» e ci riprova il boot successivo,
//     invece di tenere in ostaggio le scritture del CRM;
//   - `backfillTenantIdSulleTabelle` è l'UPDATE di massa, a lotti, e gira
//     DOPO il `listen`: il primo deploy a interruttore spento non deve tenere
//     il server fuori dalla porta per il tempo di riscrivere ogni riga.
import type { kvSql } from "../_core/persistence";

/**
 * Le tabelle relazionali con `sede_id` (07/09/2026). Chi ne aggiunge una
 * aggiorna QUESTA costante: la guardia strutturale in `tabelle.test.ts` la
 * confronta con i `CREATE TABLE IF NOT EXISTS … sede_id …` dei sorgenti e
 * fallisce se le due liste divergono.
 */
export const TABELLE_PER_SEDE = [
  "azioni_operative",
  "azioni_operative_eventi",
  "business_events",
  "capability_delegations",
  "capability_overrides",
  "chat_canali",
  "chat_letture",
  "chat_messaggi",
  "commessa_contratti",
  "commessa_righe",
  "computi",
  "comunicazioni",
  "contratto_estrazioni",
  "fattura_eventi",
  "fatturazione_config",
  "fatture",
  "notification_preferences",
  "notifications",
  "policy_audit_diffs",
  "policy_change_events",
  "promemoria",
  "promemoria_eventi",
  "push_subscriptions",
  "tars_analisi_azienda",
  "tars_azioni_esecuzioni",
  "tars_cache_entries",
  "tars_conversazioni",
  "tars_costi",
  "tars_miglioramenti",
  "tars_osservazioni",
  "tars_run",
  "tars_smistamento",
  "tars_turni",
] as const;

export type EsitoTabelle = {
  applicate: string[];
  assenti: string[];
  /** Lock non ottenuto entro `lockTimeout`: ci riprova il boot successivo. */
  rinviate: string[];
  /** Righe in `tenant_sedi` (0 se lo specchio non esiste ancora). */
  specchio: number;
};

export type EsitoBackfill = {
  righe: Record<string, number>;
  ms: Record<string, number>;
  totale: number;
};

export type OpzioniTabelle = {
  /** Sottoinsieme dell'inventario: lo usano i test pg per non toccare le tabelle degli altri. */
  soloTabelle?: readonly string[];
  /** Intervallo Postgres (`'5s'`, `'250ms'`): oltre, la tabella si rinvia. */
  lockTimeout?: string;
};

export type OpzioniBackfill = {
  soloTabelle?: readonly string[];
  dimensioneLotto?: number;
};

const LOCK_TIMEOUT_PREDEFINITO = "5s";
const DIMENSIONE_LOTTO_PREDEFINITA = 5000;

/**
 * `55P03` lock_not_available (è scattato `lock_timeout`) e `57014`
 * query_canceled (la stessa attesa annullata da fuori): la tabella è occupata
 * ADESSO, non è rotta. Tutto il resto è un errore di schema vero e propaga,
 * come per gli altri `ensureSchema()` del boot.
 */
const CODICI_RINVIO = new Set(["55P03", "57014"]);

export function errorePerLock(errore: unknown): boolean {
  const codice = (errore as { code?: unknown } | null | undefined)?.code;
  return typeof codice === "string" && CODICI_RINVIO.has(codice);
}

/** L'inventario, eventualmente ristretto: l'ordine resta quello della costante. */
function tabelleScelte(soloTabelle?: readonly string[]): string[] {
  if (!soloTabelle) return [...TABELLE_PER_SEDE];
  const scelte = new Set(soloTabelle);
  return TABELLE_PER_SEDE.filter(t => scelte.has(t));
}

/**
 * UNA query per sapere quali di questi nomi sono tabelle vere nello schema
 * corrente. Prima era un `to_regclass` per nome: 33 round trip da ~147 ms
 * l'uno su questo database, a ogni boot (Ruling R14).
 */
async function tabellePresenti(
  sql: NonNullable<typeof kvSql>,
  nomi: readonly string[]
): Promise<Set<string>> {
  if (nomi.length === 0) return new Set();
  const righe = await sql<{ relname: string }[]>`SELECT c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema() AND c.relkind = 'r'
      AND c.relname::text = ANY(${[...nomi]})`;
  return new Set(righe.map(r => String(r.relname)));
}

/**
 * Solo DDL, idempotente: `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT
 * EXISTS`, `DROP`+`CREATE TRIGGER`. Nessun UPDATE: le righe già scritte le
 * chiude `backfillTenantIdSulleTabelle`, dopo il `listen`.
 *
 * Ogni tabella ha la sua transazione con `SET LOCAL lock_timeout`:
 * l'`ALTER TABLE` prende un lock ACCESS EXCLUSIVE, e senza timeout una
 * singola query lunga in corso bloccherebbe a catena ogni scrittura su quella
 * tabella per tutto il tempo dell'attesa. Se il lock non arriva, la tabella
 * finisce in `rinviate` e ci riprova il boot successivo.
 *
 * I nomi di tabella interpolati in `unsafe` vengono SOLO da
 * `TABELLE_PER_SEDE`, una costante letterale di questo file (`soloTabelle` la
 * restringe, non la allarga): non arrivano mai da input, da una query o dal
 * catalogo del database (Postgres non accetta parametri al posto di un
 * identificatore in un DDL). `lockTimeout` è l'unico altro pezzo interpolato
 * ed è validato qui sotto.
 */
export async function applicaTenantIdAlleTabelle(
  sql: NonNullable<typeof kvSql>,
  opzioni: OpzioniTabelle = {}
): Promise<EsitoTabelle> {
  const nomi = tabelleScelte(opzioni.soloTabelle);
  const lockTimeout = opzioni.lockTimeout ?? LOCK_TIMEOUT_PREDEFINITO;
  if (!/^\d+(ms|s|min)?$/.test(lockTimeout)) {
    throw new Error(`lockTimeout non valido: ${lockTimeout}`);
  }
  const esito: EsitoTabelle = { applicate: [], assenti: [], rinviate: [], specchio: 0 };

  // `tenant_sedi` viaggia nella stessa query solo per sapere se lo specchio
  // esiste: non prende né colonna né trigger (è control plane).
  const presenti = await tabellePresenti(sql, [...nomi, "tenant_sedi"]);
  const specchioPresente = presenti.has("tenant_sedi");
  presenti.delete("tenant_sedi");
  if (specchioPresente) {
    const conteggio = await sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM tenant_sedi`;
    esito.specchio = Number(conteggio[0]?.n ?? 0);
  } else {
    // Non è più un motivo per fermarsi (Ruling R14): il trigger qui sotto
    // tollera lo specchio mancante e lascia `tenant_id` NULL, che è
    // esattamente ciò che succederebbe con una sede sconosciuta.
    console.warn(
      "[tenants] tenant_sedi assente: colonne e trigger si installano lo stesso, tenant_id resterà NULL finché lo specchio non esiste"
    );
  }

  // Una sola funzione condivisa da tutti i trigger: se cambia la regola,
  // cambia in un posto solo. Il blocco EXCEPTION è la differenza fra «una
  // riga senza tenant» e «ogni INSERT del CRM fallisce»: se `tenant_sedi`
  // non c'è (control plane non ancora creato, o droppato da un test che
  // condivide il database) il trigger lascia NULL invece di propagare
  // `relation "tenant_sedi" does not exist`.
  await sql`CREATE OR REPLACE FUNCTION tenant_id_dalla_sede() RETURNS trigger AS $$
    BEGIN
      IF NEW.tenant_id IS NULL THEN
        BEGIN
          SELECT tenant_id INTO NEW.tenant_id FROM tenant_sedi WHERE sede_id = NEW.sede_id;
        EXCEPTION WHEN undefined_table THEN
          NEW.tenant_id := NULL;
        END;
      END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql`;

  for (const t of nomi) {
    if (!presenti.has(t)) {
      esito.assenti.push(t);
      continue;
    }
    try {
      await sql.begin(async tx => {
        await tx.unsafe(`SET LOCAL lock_timeout = '${lockTimeout}'`);
        await tx.unsafe(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS tenant_id BIGINT`);
        await tx.unsafe(`CREATE INDEX IF NOT EXISTS ${t}_tenant_id_idx ON ${t} (tenant_id)`);
        await tx.unsafe(`DROP TRIGGER IF EXISTS ${t}_tenant_id ON ${t}`);
        await tx.unsafe(
          `CREATE TRIGGER ${t}_tenant_id BEFORE INSERT ON ${t}
           FOR EACH ROW EXECUTE FUNCTION tenant_id_dalla_sede()`
        );
      });
      esito.applicate.push(t);
    } catch (errore) {
      if (!errorePerLock(errore)) throw errore;
      esito.rinviate.push(t);
      console.warn(
        `[tenants] ${t}: lock non ottenuto entro ${lockTimeout}, rinviata al prossimo boot`
      );
    }
  }
  return esito;
}

/**
 * Chiude i `tenant_id` NULL già a terra, a lotti (`dimensioneLotto` righe per
 * `UPDATE`, ognuno nella propria transazione implicita): un `UPDATE` unico su
 * `business_events` o `comunicazioni` terrebbe una transazione aperta e una
 * riga di lock per tutta la durata. Gira DOPO il `listen`, in sottofondo.
 *
 * `tenant_id` si timbra UNA VOLTA — trigger sull'INSERT, backfill sui NULL —
 * e non si aggiorna mai più: se un giorno una sede cambiasse tenant, le righe
 * già timbrate resterebbero al tenant vecchio. Oggi non succede (una sede non
 * si sposta e non si cancella, si disattiva); chi introducesse lo spostamento
 * deve aggiungere una riscrittura mirata, non basta rilanciare questo.
 *
 * Le tabelle senza la colonna (DDL rinviato per lock, o tabella nata dopo)
 * vengono saltate: non è un errore, le prende il boot successivo.
 */
export async function backfillTenantIdSulleTabelle(
  sql: NonNullable<typeof kvSql>,
  opzioni: OpzioniBackfill = {}
): Promise<EsitoBackfill> {
  const nomi = tabelleScelte(opzioni.soloTabelle);
  const dimensioneLotto = opzioni.dimensioneLotto ?? DIMENSIONE_LOTTO_PREDEFINITA;
  if (!Number.isInteger(dimensioneLotto) || dimensioneLotto < 1) {
    throw new Error(`dimensioneLotto non valida: ${dimensioneLotto}`);
  }
  const esito: EsitoBackfill = { righe: {}, ms: {}, totale: 0 };

  const specchio = (await sql`SELECT to_regclass('tenant_sedi') AS r`)[0]?.r;
  if (!specchio) {
    console.warn("[tenants] backfill tenant_id saltato: tenant_sedi non esiste ancora");
    return esito;
  }
  // UNA query per sapere dove la colonna c'è davvero.
  const colonne = await sql<{ table_name: string }[]>`SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND column_name = 'tenant_id'
      AND table_name::text = ANY(${[...nomi]})`;
  const conColonna = new Set(colonne.map(r => String(r.table_name)));

  for (const t of nomi) {
    if (!conColonna.has(t)) continue;
    const inizio = Date.now();
    let righe = 0;
    for (;;) {
      // `ctid IN (… LIMIT n)` sceglie il lotto una volta sola e lo aggiorna
      // per posizione fisica: nessun OFFSET che rilegge da capo. Il filtro
      // `sede_id IN (SELECT sede_id FROM tenant_sedi)` tiene fuori le sedi
      // sconosciute, che resterebbero NULL e farebbero girare a vuoto il
      // lotto successivo. Nomi di tabella: v. il commento su `unsafe` sopra.
      const risultato = await sql.unsafe(
        `UPDATE ${t} t SET tenant_id = s.tenant_id
           FROM tenant_sedi s
          WHERE t.ctid IN (SELECT ctid FROM ${t}
                           WHERE tenant_id IS NULL
                             AND sede_id IN (SELECT sede_id FROM tenant_sedi)
                           LIMIT ${dimensioneLotto})
            AND t.sede_id = s.sede_id`
      );
      const quante = risultato.count ?? 0;
      righe += quante;
      if (quante === 0) break;
    }
    esito.righe[t] = righe;
    esito.ms[t] = Date.now() - inizio;
    esito.totale += righe;
  }
  return esito;
}
