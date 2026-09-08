// Task 12 (WS3): `lastBackupOkWithin` cercava `s.key === "backup_log"`, che
// con gli store per tenant è l'alias del solo tenant 1 — un'altra azienda
// con un backup Drive riuscito veniva comunque rifiutata, e (peggio) un
// backup del tenant 1 avrebbe sbloccato la migrazione di chiunque altro.
// Qui si verifica che il controllo guardi il `backup_log` del tenant nel
// contesto (`tenantCorrente()`), non quello nudo.
//
// Niente router importati: `collections` (in fileStorageMigrate.ts) resta
// vuoto in questo file, quindi `migrateFilesToStorage({ apply: true })` non
// ha nulla da spostare — il driver reale non scrive mai un byte.
import { beforeEach, describe, expect, it } from "vitest";
// Side effect: registra la famiglia di store "backup_log" (persistedStore
// in driveBackup.ts). Nessun altro export di questo modulo serve qui.
import "./driveBackup";
import { __registraTenantNotoPerTest, storeDi } from "./persistence";
import { conTenant } from "../tenants/contestoCorrente";
import { migrateFilesToStorage } from "./fileStorageMigrate";

describe("migrateFilesToStorage: il controllo del backup è per tenant (Task 12)", () => {
  beforeEach(() => {
    delete process.env.FLAG_MULTI_AZIENDA; // nei test = acceso
    delete process.env.RAILWAY_ENVIRONMENT; // niente rifiuto per driver effimero
    __registraTenantNotoPerTest(2);
    storeDi<any>(1, "backup_log").length = 0;
    storeDi<any>(2, "backup_log").length = 0;
  });

  it("un backup riuscito nel tenant 2 sblocca la migrazione del tenant 2", async () => {
    storeDi<any>(2, "backup_log").push({ id: 1, ok: true, finishedAt: new Date() });

    const report = await conTenant(2, () => migrateFilesToStorage({ apply: true }));

    // Potrebbe restare rifiutata per un altro motivo (nessuno atteso qui,
    // dato che RAILWAY_ENVIRONMENT non è impostato, quindi qui è proprio
    // undefined) ma MAI per il backup — da cui il ripiego a stringa vuota,
    // che non fa scattare il match invece di rompere l'assert su undefined.
    expect(report.refusedReason ?? "").not.toMatch(/nessun backup Drive riuscito/);
  });

  it("nessun backup nel tenant 1 rifiuta la migrazione, anche col backup del tenant 2 riuscito", async () => {
    storeDi<any>(2, "backup_log").push({ id: 1, ok: true, finishedAt: new Date() });

    const report = await conTenant(1, () => migrateFilesToStorage({ apply: true }));

    expect(report.refusedReason).toMatch(/nessun backup Drive riuscito/);
  });
});
