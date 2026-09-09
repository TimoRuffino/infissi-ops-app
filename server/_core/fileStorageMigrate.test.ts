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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// Side effect: registra la famiglia di store "backup_log" (persistedStore
// in driveBackup.ts). Nessun altro export di questo modulo serve qui.
import "./driveBackup";
import { __registraTenantNotoPerTest, storeDi } from "./persistence";
import { conTenant } from "../tenants/contestoCorrente";
import { impostaVerificaQuota } from "./fileStorage";
import { migrateFilesToStorage, registerMigratableCollection } from "./fileStorageMigrate";

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

// R17 (fix wave finale del WS4): la migrazione dei record legacy sposta ogni
// file con `putFile`, quindi il gancio della quota può rifiutarla. Contare N
// `falliti` silenziosi sarebbe il modo peggiore di fallire: la run
// sembrerebbe «quasi riuscita» e ripartirebbe uguale la volta dopo. Si ferma
// subito, una volta sola, col messaggio della quota — e nessun record perde
// il suo `dataBase64`, che è l'unica copia dei byte finché lo storage non li
// ha presi.
//
// Nota: `registerMigratableCollection` non ha un contrario. La registrazione
// avviene DENTRO il test (mai a livello di modulo) e questo `describe` è
// l'ultimo del file, così i casi sopra continuano a girare con `collections`
// vuoto, come dice il commento in testa.
describe("migrateFilesToStorage: la quota che blocca ferma la run (R17)", () => {
  const MESSAGGIO = "Spazio esaurito: l'azienda ha superato i 2 GB inclusi. Libera spazio o chiedi capacità aggiuntiva.";

  beforeEach(() => {
    delete process.env.FLAG_MULTI_AZIENDA;
    delete process.env.RAILWAY_ENVIRONMENT;
    __registraTenantNotoPerTest(2);
    storeDi<any>(2, "backup_log").length = 0;
  });

  afterEach(() => {
    impostaVerificaQuota(null);
  });

  it("si ferma al primo rifiuto, registra il messaggio una volta e non tocca il base64", async () => {
    storeDi<any>(2, "backup_log").push({ id: 1, ok: true, finishedAt: new Date() });
    const items = [
      { id: 1, nome: "uno.pdf", mimeType: "application/pdf", dataBase64: Buffer.from("uno").toString("base64") },
      { id: 2, nome: "due.pdf", mimeType: "application/pdf", dataBase64: Buffer.from("due").toString("base64") },
    ];
    registerMigratableCollection({
      key: "r17_documenti",
      parentIdOf: () => 1,
      store: { save: () => {} } as any,
      items,
    });
    impostaVerificaQuota(async () => ({ messaggio: MESSAGGIO }));

    const report = await conTenant(2, () => migrateFilesToStorage({ apply: true }));

    expect(report.refusedReason).toBeUndefined();
    expect(report.interrotta).toBe("quota");
    const stat = report.collections.find(c => c.key === "r17_documenti")!;
    expect(stat.migrati).toBe(0);
    // Non è il fallimento di un record: è l'azienda che non può più scrivere.
    expect(stat.falliti).toBe(0);
    expect(stat.errori).toHaveLength(1);
    expect(stat.errori[0]).toContain("Spazio esaurito");
    // I byte restano dove sono: il base64 si cancella SOLO dopo una scrittura
    // verificata, e qui non ce n'è stata nessuna.
    expect(items.every(r => r.dataBase64)).toBe(true);
    expect(items.every(r => !(r as any).storageKey)).toBe(true);
  });
});
