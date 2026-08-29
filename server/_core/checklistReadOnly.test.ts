// Release hardening (29/08/2026): la checklist «read-only» deve restare
// tale. Questo test impedisce le regressioni scoperte dalla revisione:
// (1) `pnpm storage:check` non deve tornare a scrivere; (2) il runbook di
// sola lettura non può citare comandi fuori dall'allowlist né dichiarare
// scritture «ammesse»; (3) la sonda read-only, alla prova dei fatti, non
// chiama mai put/delete — e quella di scrittura resta esplicita.

import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { probeStorage, probeStorageReadOnly } from "./fileStorage";

const RADICE = process.cwd();

// Gli unici comandi pnpm che una checklist di sola lettura può citare.
const COMANDI_READONLY = new Set(["storage:check", "storage:dry-run"]);

describe("checklist read-only — guardie statiche", () => {
  it("scripts/check-storage.ts non contiene la sonda di scrittura", async () => {
    const sorgente = await fs.readFile(
      path.join(RADICE, "scripts/check-storage.ts"),
      "utf8"
    );
    expect(sorgente).toContain("probeStorageReadOnly");
    // Né import, né alias, né invocazione della variante che scrive.
    expect(sorgente).not.toMatch(/\bprobeStorage\b(?!ReadOnly)/);
    expect(sorgente).not.toMatch(/\.put\(/);
    // Nessun import di script/moduli fuori dal modulo storage dichiarato.
    const importi = [...sorgente.matchAll(/from\s+"([^"]+)"/g)].map(m => m[1]);
    for (const modulo of importi) {
      expect(
        ["dotenv/config", "../server/_core/fileStorage"].includes(modulo),
        `import inatteso in check-storage.ts: ${modulo}`
      ).toBe(true);
    }
  });

  it("il runbook di sola lettura cita solo comandi dell'allowlist e nessuna «scrittura ammessa»", async () => {
    const runbook = await fs.readFile(
      path.join(RADICE, "docs/runbooks/verifica-produzione-readonly.md"),
      "utf8"
    );
    const comandi = [...runbook.matchAll(/pnpm\s+([a-z0-9:_-]+)/gi)].map(
      m => m[1]
    );
    expect(comandi.length).toBeGreaterThan(0);
    for (const comando of comandi) {
      expect(
        COMANDI_READONLY.has(comando),
        `«pnpm ${comando}» citato nella checklist read-only non è nell'allowlist`
      ).toBe(true);
    }
    // Né inviti a eseguire script diretti, né "scritture ammesse/consentite"
    // comunque formulate: la sonda di scrittura può solo essere NOMINATA
    // come esclusa.
    expect(runbook).not.toMatch(/tsx\s+scripts\//i);
    expect(runbook).not.toMatch(/scrittur\w*\s+(ammess|consentit)/i);
  });

  it("lo script di sonda con scrittura pretende il flag esplicito --scrivi", async () => {
    const sorgente = await fs.readFile(
      path.join(RADICE, "scripts/probe-storage-write.ts"),
      "utf8"
    );
    expect(sorgente).toContain('--scrivi');
    expect(sorgente).toContain("probeStorage(");
  });
});

describe("checklist read-only — comportamento delle sonde", () => {
  function driverContatore() {
    const chiamate = { get: 0, put: 0, delete: 0 };
    return {
      chiamate,
      driver: {
        name: "s3" as const,
        async get(_chiave: string) {
          chiamate.get += 1;
          return null;
        },
        async put(_c: string, _b: Buffer, _m: string) {
          chiamate.put += 1;
        },
        async delete(_c: string) {
          chiamate.delete += 1;
        },
      } as any,
    };
  }

  it("probeStorageReadOnly legge soltanto: mai put, mai delete", async () => {
    const { driver, chiamate } = driverContatore();
    const esito = await probeStorageReadOnly(driver);
    expect(esito.ok).toBe(true);
    expect(chiamate.get).toBe(1);
    expect(chiamate.put).toBe(0);
    expect(chiamate.delete).toBe(0);
  });

  it("probeStorage resta la sonda che scrive (e ripulisce): il contrasto è il contratto", async () => {
    const scritti = new Map<string, Buffer>();
    const chiamate = { put: 0, delete: 0 };
    const driver: any = {
      name: "s3" as const,
      async get(chiave: string) {
        return scritti.get(chiave) ?? null;
      },
      async put(chiave: string, byte: Buffer) {
        chiamate.put += 1;
        scritti.set(chiave, Buffer.from(byte));
      },
      async delete(chiave: string) {
        chiamate.delete += 1;
        scritti.delete(chiave);
      },
    };
    const esito = await probeStorage(driver);
    expect(esito.ok).toBe(true);
    expect(chiamate.put).toBe(1);
    expect(chiamate.delete).toBe(1);
    expect(scritti.size).toBe(0); // niente oggetti lasciati indietro
  });
});
