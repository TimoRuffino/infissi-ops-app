// server/tenants/storage.ts
// Contabilità dei byte per azienda (WS3, spec §3.2): il ledger vive nel
// control plane (`tenant_storage`), lo aggiorna ogni put/delete di
// fileStorage.ts attraverso il contabile iniettato, e le soglie 50/80/100 %
// della quota diventano eventi di `tenant_eventi`. Nessun blocco: la quota
// conta e avvisa (decisione 5); chi blocca è il WS4.
import { statFile, type ContabileStorage } from "../_core/fileStorage";
import { kvSql, storeDi } from "../_core/persistence";
import { conTenant } from "./contestoCorrente";
import { getTenantRepository } from "./repository";
import type { StatoStorage } from "./tipi";

export const SOGLIE_STORAGE = [50, 80, 100] as const;
export type SogliaStorage = 0 | 50 | 80 | 100;

export function percentualeStorage(bytes: number, quotaBytes: number): number {
  if (quotaBytes <= 0) return 0;
  return Math.round((bytes / quotaBytes) * 1000) / 10;
}

export function sogliaRaggiunta(bytes: number, quotaBytes: number): SogliaStorage {
  const p = quotaBytes > 0 ? (bytes / quotaBytes) * 100 : 0;
  let raggiunta: SogliaStorage = 0;
  for (const s of SOGLIE_STORAGE) if (p >= s) raggiunta = s;
  return raggiunta;
}

/**
 * Avvisa la soglia più alta raggiunta se è superiore all'ultima avvisata
 * (un evento per attraversamento, mai uno per upload); sotto il 50 % si
 * riarma, così un'azienda che libera spazio e lo riempie di nuovo riceve
 * un nuovo avviso.
 */
export async function applicaSoglie(stato: StatoStorage, attore = "sistema"): Promise<SogliaStorage | null> {
  const repo = getTenantRepository();
  const raggiunta = sogliaRaggiunta(stato.bytes, stato.quotaBytes);
  // WS4 (quota che blocca, spec §6): la tolleranza dopo il 100 % si conta da
  // `soglia100Dal`, impostata al primo attraversamento e mai spostata ai
  // giri successivi; scendendo sotto il 100 % si azzera. L'evento
  // `storage_sbloccato` lo registra `quota.ts` quando rileva il cambio (solo
  // se l'azienda era davvero bloccata), non qui.
  if (raggiunta === 100 && !stato.soglia100Dal) {
    await repo.impostaSoglia100Storage(stato.tenantId, new Date());
  }
  if (raggiunta < 100 && stato.soglia100Dal) {
    await repo.impostaSoglia100Storage(stato.tenantId, null);
  }
  if (raggiunta > stato.sogliaAvvisata) {
    await repo.registraEvento({
      tenantId: stato.tenantId,
      tipo: "storage_soglia",
      attore,
      dettagli: { percentuale: raggiunta, bytes: stato.bytes, quotaBytes: stato.quotaBytes },
    });
    await repo.impostaSogliaAvvisata(stato.tenantId, raggiunta);
    return raggiunta;
  }
  if (raggiunta === 0 && stato.sogliaAvvisata > 0) {
    await repo.impostaSogliaAvvisata(stato.tenantId, 0);
  }
  return null;
}

export function creaContabileStorage(): ContabileStorage {
  return {
    async aggiungi(tenantId, bytes, file) {
      await applicaSoglie(await getTenantRepository().aggiornaStorage(tenantId, bytes, file));
    },
    async togli(tenantId, bytes, file) {
      await applicaSoglie(await getTenantRepository().aggiornaStorage(tenantId, -bytes, -file));
    },
  };
}

/**
 * `comunicazioni`/`fatture` possono non esistere ancora su un database
 * appena creato (il WS3 le legge soltanto, non le crea): un `undefined_table`
 * (42P01) vale zero righe, non un ricalcolo fallito. Stessa cosa per un
 * `undefined_column` (42703, fix wave finale, R19): una tabella creata pigramente
 * dal suo modulo DOPO `applicaTenantIdAlleTabelle` non ha ancora la colonna
 * `tenant_id` — la aggiunge il boot successivo, e nel frattempo un ricalcolo
 * non deve morire per questo. Qualunque altro errore risale come sempre.
 */
const CODICI_TABELLA_INCOMPLETA = new Set(["42P01", "42703"]);

async function righeOVuoto(query: Promise<any>): Promise<any[]> {
  try {
    return await query;
  } catch (errore) {
    const codice = (errore as { code?: string } | null | undefined)?.code;
    if (codice && CODICI_TABELLA_INCOMPLETA.has(codice)) return [];
    throw errore;
  }
}

/**
 * La fonte di verità del ledger: rilegge i record con `storageKey` dell'azienda.
 * Le dimensioni registrate sui record valgono per documenti, allegati ticket
 * e allegati mail; anteprime e fatture non le hanno e si chiedono allo
 * storage (`head`). Gira dentro `conTenant`: i Proxy e le tabelle per sede
 * rispondono per quell'azienda. `COALESCE(tenant_id, 1)`: le righe di
 * Ruffino Group precedenti al backfill del WS2 hanno ancora NULL.
 */
export async function ricalcolaStorage(tenantId: number, attore = "sistema"): Promise<StatoStorage> {
  return conTenant(tenantId, async () => {
    let bytes = 0;
    let file = 0;
    const conta = (n: number) => { bytes += Math.max(0, n); file++; };
    // Un `head` a vuoto significa che il file non c'è più nello storage (o
    // che il driver non sa rispondere): non si conta né fra i byte né fra i
    // file (fix wave finale). Prima entrava come «file da 0 byte» e gonfiava
    // il conteggio con anteprime cancellate. Nessun log: un'anteprima assente
    // non è un guasto, ed è la cosa più comune che ci sia qui dentro.
    const misura = async (chiave: string) => {
      const info = await statFile(chiave);
      if (info) conta(info.bytes);
    };

    for (const d of storeDi<any>(tenantId, "preventivi_documenti")) {
      if (d?.storageKey) conta(Number(d.size) || 0);
      for (const chiave of d?.anteprime?.chiavi ?? []) await misura(chiave);
    }
    for (const a of storeDi<any>(tenantId, "ticket_allegati")) {
      if (a?.storageKey) conta(Number(a.size) || 0);
    }
    if (kvSql) {
      const comunicazioni = await righeOVuoto(
        kvSql`SELECT allegati FROM comunicazioni WHERE COALESCE(tenant_id, 1) = ${tenantId}`
      );
      for (const r of comunicazioni) {
        for (const al of (r.allegati as any[]) ?? []) if (al?.storageKey) conta(Number(al.size) || 0);
      }
      const fatture = await righeOVuoto(
        kvSql`SELECT pdf_storage_key, xml_storage_key FROM fatture WHERE COALESCE(tenant_id, 1) = ${tenantId}`
      );
      for (const r of fatture) {
        if (r.pdf_storage_key) await misura(r.pdf_storage_key);
        if (r.xml_storage_key) await misura(r.xml_storage_key);
      }
    }
    const repo = getTenantRepository();
    const stato = await repo.impostaStorage(tenantId, { bytes, file });
    await repo.registraEvento({ tenantId, tipo: "storage_ricalcolato", attore, dettagli: { bytes, file } });
    await applicaSoglie(stato, attore);
    return stato;
  });
}

/**
 * Primo boot del WS3: chi non ha ancora un ricalcolo lo riceve qui, in
 * sottofondo.
 *
 * Si guarda il TIMBRO (`ricalcolatoIl`), non l'esistenza della riga (fix
 * wave finale, R17). La riga nasce anche dal primo delta del ledger: fra
 * `preparaTenants()` e questo giro — che parte dopo il `listen` — basta un
 * `putFile` di un utente già collegato perché `aggiornaStorage` crei la
 * riga con un solo file dentro. Con la vecchia guardia quell'azienda
 * sarebbe rimasta senza ricalcolo iniziale PER SEMPRE, con un ledger che
 * conta un file su diecimila. Una riga non è un ricalcolo.
 */
export async function ricalcolaStorageSeManca(tenantIds: number[]): Promise<void> {
  const repo = getTenantRepository();
  for (const tenantId of tenantIds) {
    try {
      if ((await repo.storageDi(tenantId))?.ricalcolatoIl) continue;
      const inizio = Date.now();
      const stato = await ricalcolaStorage(tenantId, "boot");
      console.log(`[storage] ricalcolo iniziale tenant ${tenantId}: ${stato.file} file, ${stato.bytes} byte in ${Date.now() - inizio} ms`);
    } catch (errore) {
      console.error(`[storage] ricalcolo iniziale tenant ${tenantId}:`, errore instanceof Error ? errore.message : errore);
    }
  }
}
