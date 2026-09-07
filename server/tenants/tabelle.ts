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
//     allineato): una sede sconosciuta lascia NULL, non blocca l'INSERT;
//   - un backfill una tantum a ogni boot chiude i NULL rimasti.
// Una tabella assente al boot viene saltata e segnalata nel log: la creerà il
// suo modulo alla prima richiesta e il boot successivo la troverà.
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
  backfill: Record<string, number>;
};

/**
 * Idempotente: `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`,
 * `DROP`+`CREATE TRIGGER` e un `UPDATE` che tocca solo le righe con
 * `tenant_id` NULL. Rieseguibile a ogni boot; al secondo giro il backfill
 * conta 0.
 *
 * I nomi di tabella interpolati in `unsafe` vengono SOLO da
 * `TABELLE_PER_SEDE`, una costante letterale di questo file: non arrivano mai
 * da input, da una query o dal catalogo del database (Postgres non accetta
 * parametri al posto di un identificatore in un DDL).
 */
export async function applicaTenantIdAlleTabelle(
  sql: NonNullable<typeof kvSql>
): Promise<EsitoTabelle> {
  const esito: EsitoTabelle = { applicate: [], assenti: [], backfill: {} };
  // Fail fast: il trigger legge `tenant_sedi` a ogni INSERT. Installarlo
  // senza quella tabella romperebbe OGNI scrittura del CRM («relation
  // tenant_sedi does not exist») invece di lasciare tutto com'è. Al boot la
  // crea `preparaTenants` molto prima di qui.
  const specchio = (await sql`SELECT to_regclass('tenant_sedi') AS r`)[0]?.r;
  if (!specchio) {
    throw new Error(
      "tenant_sedi assente: lo specchio sede → tenant deve esistere prima dei trigger tenant_id"
    );
  }
  // Una sola funzione condivisa da tutti i trigger: se cambia la regola,
  // cambia in un posto solo.
  await sql`CREATE OR REPLACE FUNCTION tenant_id_dalla_sede() RETURNS trigger AS $$
    BEGIN
      IF NEW.tenant_id IS NULL THEN
        SELECT tenant_id INTO NEW.tenant_id FROM tenant_sedi WHERE sede_id = NEW.sede_id;
      END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql`;
  for (const t of TABELLE_PER_SEDE) {
    const presente = (await sql`SELECT to_regclass(${t}) AS r`)[0]?.r;
    if (!presente) {
      esito.assenti.push(t);
      continue;
    }
    const aggiornate = await sql.begin(async tx => {
      await tx.unsafe(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS tenant_id BIGINT`);
      await tx.unsafe(`CREATE INDEX IF NOT EXISTS ${t}_tenant_id_idx ON ${t} (tenant_id)`);
      await tx.unsafe(`DROP TRIGGER IF EXISTS ${t}_tenant_id ON ${t}`);
      await tx.unsafe(
        `CREATE TRIGGER ${t}_tenant_id BEFORE INSERT ON ${t}
         FOR EACH ROW EXECUTE FUNCTION tenant_id_dalla_sede()`
      );
      const r = await tx.unsafe(
        `UPDATE ${t} t SET tenant_id = s.tenant_id FROM tenant_sedi s
         WHERE t.tenant_id IS NULL AND t.sede_id = s.sede_id`
      );
      return r.count ?? 0;
    });
    esito.applicate.push(t);
    esito.backfill[t] = aggiornate;
  }
  return esito;
}
