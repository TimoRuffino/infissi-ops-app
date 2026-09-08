// One-shot migration: move legacy base64 bytes out of the JSONB collections
// (preventivi_documenti, ticket_allegati) into the fileStorage driver.
//
// Safety posture:
//   - dry-run by default; `apply: true` to actually write
//   - refuses to apply without a successful Drive backup in the last 24h
//   - refuses to apply on Railway with the local driver and no explicit
//     opt-in (the container filesystem is ephemeral — bytes would die on
//     the next deploy)
//   - per record: put → read back → sha256 verify → ONLY then drop the
//     inline dataBase64. A failed verify leaves the record untouched.
//   - idempotent: records that already have storageKey are skipped, so the
//     run can be interrupted and resumed freely.
//   - R17 (WS4): la migrazione passa da `putFile`, quindi rispetta il blocco
//     della quota. Un `ErroreQuotaStorage` non è il fallimento di un record:
//     è l'azienda che non può più scrivere, e ogni record successivo
//     fallirebbe uguale. La run si ferma subito e mette il messaggio della
//     quota UNA volta in `errori`, con `interrotta: "quota"` nel risultato,
//     invece di contare N `falliti` silenziosi. `dataBase64` non si tocca
//     mai: si cancella solo dopo una scrittura verificata.

import {
  getAllStoreSnapshots,
  type PersistedStore,
} from "./persistence";
import {
  ErroreQuotaStorage,
  getFile,
  getStorageDriver,
  putFile,
  sha256Hex,
} from "./fileStorage";
import { tenantCorrente } from "../tenants/contestoCorrente";

type LegacyFileRecord = {
  id: number;
  nome: string;
  mimeType: string;
  dataBase64?: string;
  storageKey?: string | null;
  checksum?: string | null;
};

export type MigrateReport = {
  dryRun: boolean;
  driver: string;
  collections: Array<{
    key: string;
    total: number;
    giaMigrati: number;
    daMigrare: number;
    migrati: number;
    falliti: number;
    bytes: number;
    errori: string[];
  }>;
  refusedReason?: string;
  /** R17: la run si è fermata a metà — oggi solo per la quota dell'azienda. */
  interrotta?: "quota";
};

function lastBackupOkWithin(hours: number): boolean {
  // `backup_log` è per tenant: `s.key` è la chiave fisica (nuda per il
  // tenant 1, alias), non il filtro giusto — un backup di un'altra azienda
  // non deve sbloccare (né bloccare) questa. Il tenant è quello del
  // contesto della richiesta/comando in corso, mai un parametro.
  const snap = getAllStoreSnapshots().find(
    (s) => s.nome === "backup_log" && s.tenantId === tenantCorrente()
  );
  if (!snap) return false;
  const cutoff = Date.now() - hours * 3600 * 1000;
  return snap.items.some((r: any) => {
    if (r?.ok !== true || !r?.finishedAt) return false;
    const t = new Date(r.finishedAt).getTime();
    return !isNaN(t) && t >= cutoff;
  });
}

type MigratableCollection = {
  key: string;
  parentIdOf: (record: any) => number;
  store: PersistedStore<any>;
  items: LegacyFileRecord[];
};

// Registered lazily by the routers that own the stores — avoids circular
// imports and keeps this module ignorant of router internals.
const collections: MigratableCollection[] = [];

export function registerMigratableCollection(c: MigratableCollection) {
  collections.push(c);
}

export async function migrateFilesToStorage(opts: {
  apply: boolean;
  skipBackupCheck?: boolean;
}): Promise<MigrateReport> {
  const driver = getStorageDriver();
  const report: MigrateReport = {
    dryRun: !opts.apply,
    driver: driver.name,
    collections: [],
  };

  if (opts.apply) {
    if (!opts.skipBackupCheck && !lastBackupOkWithin(24)) {
      report.refusedReason =
        "MIGRAZIONE RIFIUTATA: nessun backup Drive riuscito nelle ultime 24 ore. Esegui un backup manuale prima (Integrazioni → Backup) oppure passa skipBackupCheck.";
      return report;
    }
    if (
      driver.name === "local" &&
      process.env.RAILWAY_ENVIRONMENT &&
      process.env.STORAGE_ALLOW_EPHEMERAL !== "1"
    ) {
      report.refusedReason =
        "MIGRAZIONE RIFIUTATA: driver 'local' su Railway senza volume = filesystem effimero, i file morirebbero al prossimo deploy. Configura STORAGE_DRIVER=s3 (R2) o monta un volume e imposta STORAGE_ALLOW_EPHEMERAL=1.";
      return report;
    }
  }

  let fermataDallaQuota = false;
  for (const coll of collections) {
    const stat = {
      key: coll.key,
      total: coll.items.length,
      giaMigrati: 0,
      daMigrare: 0,
      migrati: 0,
      falliti: 0,
      bytes: 0,
      errori: [] as string[],
    };
    let processed = 0;
    for (const rec of coll.items) {
      if (rec.storageKey) {
        stat.giaMigrati++;
        continue;
      }
      if (!rec.dataBase64) continue; // nothing to move (empty legacy record)
      stat.daMigrare++;
      if (!opts.apply) continue;
      try {
        const buffer = Buffer.from(rec.dataBase64, "base64");
        const stored = await putFile(
          coll.key,
          coll.parentIdOf(rec),
          rec.id,
          rec.nome,
          buffer,
          rec.mimeType
        );
        // Verify: read back and compare checksums before dropping the
        // inline copy. This is the only moment data could be lost.
        const readBack = await getFile(stored.storageKey);
        if (!readBack || sha256Hex(readBack) !== stored.checksum) {
          throw new Error("verifica checksum fallita dopo la scrittura");
        }
        rec.storageKey = stored.storageKey;
        rec.checksum = stored.checksum;
        delete rec.dataBase64;
        stat.migrati++;
        stat.bytes += buffer.length;
        processed++;
        if (processed % 50 === 0) {
          coll.store.save();
          console.log(
            `[fileStorageMigrate] ${coll.key}: ${stat.migrati}/${stat.daMigrare} migrati...`
          );
        }
      } catch (e: any) {
        // R17: oltre la quota (e la tolleranza) l'azienda non può più
        // scrivere: insistere sui record successivi produrrebbe solo altri
        // rifiuti. Si ferma qui, con il messaggio della quota una volta
        // sola; i byte restano nel `dataBase64`, dove sono sempre stati.
        if (e instanceof ErroreQuotaStorage) {
          fermataDallaQuota = true;
          stat.errori.push(`migrazione interrotta: ${e.message}`);
          console.error(
            `[fileStorageMigrate] ${coll.key}: migrazione interrotta dalla quota dell'azienda: ${e.message}`
          );
          break;
        }
        stat.falliti++;
        stat.errori.push(`#${rec.id} ${rec.nome}: ${e?.message ?? e}`);
        console.error(
          `[fileStorageMigrate] ${coll.key} #${rec.id} fallito:`,
          e
        );
      }
    }
    if (opts.apply && stat.migrati > 0) coll.store.save();
    report.collections.push(stat);
    if (fermataDallaQuota) {
      report.interrotta = "quota";
      break;
    }
  }
  return report;
}
