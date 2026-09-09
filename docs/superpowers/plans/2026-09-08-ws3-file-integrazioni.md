# WS3 «File, backup, credenziali e guasti per tenant» — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dopo il WS3 una seconda azienda può stare in produzione con `FLAG_MULTI_AZIENDA` acceso: file con chiave e conteggio per azienda, backup sul Drive dell'azienda con ripristino provato, `state` OAuth persistiti e legati all'azienda, webhook WhatsApp instradato per numero, un guasto di un'azienda che non ferma le altre; con l'interruttore spento tutto si comporta come oggi.

**Architecture:** `fileStorage.ts` mette il tenant nella chiave (`tenant/<id>/…`) e rifiuta in lettura le chiavi altrui; un contabile iniettato (come il resolver del WS2) tiene `tenant_storage` nel control plane con soglie che avvisano e non bloccano; gli store del backup diventano per tenant e ogni azienda ha il suo OAuth, la sua cartella e il suo albero; `oauth_state` in Postgres sostituisce le mappe in memoria di FiC e Drive; il ripristino è un comando del control plane che il server esegue leggendo i dump da Drive e sostituendo gli store con `sostituisciStore`; `perOgniTenantAttivo` porta un interruttore per (worker, azienda); `recordOppureNotFound` rimpiazza i 98 `throw new Error("… non trovato")` dei router.

**Tech Stack:** Node 20, TypeScript, postgres-js (`kvSql`), tRPC 11, Express 4, vitest; Postgres 16 in Docker per i test `*.pg.test.ts`; Google Drive v3 REST (già in `driveBackup.ts`); `secretBox` (AES con `MAIL_ENCRYPTION_KEY`).

**Spec:** `docs/superpowers/specs/2026-09-08-ws3-file-integrazioni-design.md` (citata come «spec §n»). Spec madre: `docs/superpowers/specs/2026-09-06-saas-multi-azienda-design.md`. WS2: `docs/superpowers/specs/2026-09-07-ws2-porta-aperta-design.md` (rulings R1–R22 in §2-bis).

## Global Constraints

- **Branch:** `feature/ws3-file-integrazioni` (da `main` @ `b77c9da`, spec al commit `a6de38a`). Mai commit su `main` (= produzione Railway). Mai `git stash` (stash condiviso fra worktree): per accantonare, commit WIP.
- **Commit:** messaggi in italiano, prefissi `feat|fix|test|docs|chore(storage|backup|tenant|oauth|whatsapp|routers|…)`; ogni commit termina con `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- **Interruttore:** `interruttoreAttivo("multiAzienda")` (`server/platform/interruttori.ts`): con la variabile assente è acceso in `development` e `test`, spento in produzione. Nei test è ON per default; spegnerlo con `process.env.FLAG_MULTI_AZIENDA = "off"` e ripristinare con `delete process.env.FLAG_MULTI_AZIENDA` in `afterEach`.
- **Contesto implicito (WS2):** il tenant corrente è `tenantCorrente()` di `server/tenants/contestoCorrente.ts` (foglia: importa SOLO `interruttori`, `costanti`, `_core/persistence`; guardia in `server/tenants/confine.test.ts`). `tenantCorrente()` ritorna 1 a interruttore spento; a interruttore acceso il tenant del contesto, `null` senza contesto (nei test ripiega su 1 salvo `modalitaTenantStretta(true)`). `persistence.ts` importa solo `postgres`; `fileStorage.ts` può importare `contestoCorrente` e `costanti` (nessun ciclo: `persistence` non importa `fileStorage`). Ogni entry point fuori richiesta dichiara il tenant con `conTenant`, `conTenantDellaSede`, `perOgniTenantAttivo` o `trovaNeiTenant` (`server/tenants/giri.ts`).
- **Control plane:** le tabelle `tenants`, `tenant_eventi`, `tenant_comandi`, `tenant_sedi` e le nuove `tenant_storage`, `oauth_state` sono scritte SOLO da `server/tenants/repository.ts` (guardia `confine.test.ts`: estenderla a `oauth_state`). `kv_store` è scritto solo da `persistence.ts`.
- **Store globali** (solo questi, `{ ambito: "globale" }`), dal Task 6 in poi: `sedi`, `utenti`, `platform_feature_flags`, `platform_feature_flag_audit` (`server/_core/storeGlobali.test.ts`); fino al Task 6 restano i sette del WS2.
- **`storeDi(tenantId, nome)`** solo in migrazioni, verifica, ripristino e ricalcolo (server/tenants), mai nei router né negli strumenti di Tars.
- **Fail-closed:** a interruttore acceso un `putFile`/`getFile`/`openFileReadStream` senza tenant nel contesto lancia `Error("[fileStorage] <operazione> senza tenant nel contesto")`; una chiave di un'altra azienda in lettura dà `null` (mai i byte, mai un messaggio con la chiave verso l'utente). Un record assente o di un'altra sede nei router dà `TRPCError NOT_FOUND` «Risorsa non trovata.» (`assertSedeScope`), mai un 500.
- **Quota:** conta e avvisa, non blocca (spec decisione 5): nessun rifiuto di upload per quota in nessun punto del codice.
- **Segreti:** il refresh token Drive vive SOLO cifrato (`encryptSecret`) in `backup_oauth`/`data/backup-oauth*.json`; mai token, chiavi storage complete di altre aziende o payload cliente nei log; `tenant_comandi.payload` passa da `payloadSenzaSegreti`.
- **Id:** `store.prossimoId()`/`riservaIdFinoA`; nessun contatore di modulo (guardia `idGlobali.test.ts`).
- **Test:** `pnpm check` (tsc, esclude i test), `pnpm vitest run <file>`, `pnpm test` (suite). Baseline: 3 test HEIC «sips» rossi sulla macchina di sviluppo (`server/documenti/{anteprime,heic,parserRegistry.heic}.test.ts`) non sono regressioni. I test `*.pg.test.ts` sono `describe.skipIf(!DATABASE_URL)` e si lanciano con `--no-file-parallelism` (Docker: `docker run -d --name perf-pg-test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=perf_test -p 55433:5432 postgres:16-alpine`, `DATABASE_URL=postgres://postgres:test@localhost:55433/perf_test`). `server/_core/testSetup.ts` blocca la rete: ogni `fetch` verso Drive/Google/Meta va sostituito con `vi.stubGlobal("fetch", …)` o iniettato.
- **Nomi in italiano** per funzioni, file e messaggi nuovi; commenti che spiegano il perché, come nel resto di `server/tenants/`.
- **Client:** nessun file `client/` cambia in questo piano (le procedure tRPC esistenti mantengono forma e nomi; `tenants.storage` è nuova e senza UI).

---

### Task 1: `fileStorage` per tenant — chiavi, cintura in lettura, `head`/`statFile`, `deleteFileQuiet` con byte, contabile iniettato

**Files:**
- Modify: `server/_core/fileStorage.ts` (tipo driver :34-48, chiavi :61-71, driver locale :91-140, `s3Fetch` :252-326, driver s3 :340-423, facciata :425-503)
- Modify: `server/routers/preventiviContratti.ts:347,603,685,790,817,1277,1279`, `server/routers/ticketAllegati.ts:75,200` (byte ai `deleteFileQuiet`)
- Test: `server/_core/fileStorage.tenant.test.ts` (nuovo)

**Interfaces:**
- Consumes: `tenantCorrente()` (`server/tenants/contestoCorrente.ts`), `TENANT_PREDEFINITO_ID` (`server/tenants/costanti.ts`), `buildStorageKey` esistente.
- Produces (usati dai task 3, 4, 6, 7, 12):
  ```ts
  export type StorageDriver = { name: "local" | "s3"; put; get; openRead; delete; head?(key: string): Promise<{ bytes: number } | null> };
  export type ContabileStorage = {
    aggiungi(tenantId: number, bytes: number, file: number): Promise<void>;
    togli(tenantId: number, bytes: number, file: number): Promise<void>;
  };
  export function impostaContabileStorage(c: ContabileStorage | null): void;
  export function chiaveStorage(tenantId: number, collezione: string, parentId: number, recordId: number, nome: string): string; // `tenant/${tenantId}/${buildStorageKey(...)}`
  export function tenantDellaChiave(storageKey: string): number; // `tenant/<n>/…` → n; chiave nuda → 1
  export async function statFile(storageKey: string): Promise<{ bytes: number } | null>; // null anche se il driver non ha `head`
  export function deleteFileQuiet(storageKey: string | null | undefined, bytes?: number | null): void;
  export function __impostaDriverPerTest(driver: StorageDriver | null): void; // solo NODE_ENV=test
  ```
  `putFile` mantiene la firma e ricava il tenant dal contesto.

- [ ] **Step 1: Scrivere il test che fallisce**

`server/_core/fileStorage.tenant.test.ts`:

```ts
// Chiavi con il prefisso dell'azienda, cintura in lettura e contabilità dei
// byte (spec WS3 §3.1–§3.2). Driver in memoria: nessun file su disco.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __impostaDriverPerTest,
  chiaveStorage,
  deleteFileQuiet,
  getFile,
  impostaContabileStorage,
  openFileReadStream,
  putFile,
  statFile,
  tenantDellaChiave,
  type ContabileStorage,
  type StorageDriver,
} from "./fileStorage";
import { conTenant, modalitaTenantStretta } from "../tenants/contestoCorrente";

function driverInMemoria(): StorageDriver & { file: Map<string, Buffer> } {
  const file = new Map<string, Buffer>();
  return {
    name: "local",
    file,
    async put(k, b) { file.set(k, b); },
    async get(k) { return file.get(k) ?? null; },
    async openRead() { return null; },
    async delete(k) { file.delete(k); },
    async head(k) { const b = file.get(k); return b ? { bytes: b.length } : null; },
  };
}

function contabileFinto() {
  const chiamate: Array<["aggiungi" | "togli", number, number, number]> = [];
  const c: ContabileStorage = {
    async aggiungi(t, b, f) { chiamate.push(["aggiungi", t, b, f]); },
    async togli(t, b, f) { chiamate.push(["togli", t, b, f]); },
  };
  return { c, chiamate };
}

describe("fileStorage per tenant", () => {
  let driver = driverInMemoria();
  beforeEach(() => {
    delete process.env.FLAG_MULTI_AZIENDA; // nei test = acceso
    driver = driverInMemoria();
    __impostaDriverPerTest(driver);
    modalitaTenantStretta(false);
    impostaContabileStorage(null);
  });
  afterEach(() => {
    delete process.env.FLAG_MULTI_AZIENDA;
    __impostaDriverPerTest(null);
    modalitaTenantStretta(false);
    impostaContabileStorage(null);
    vi.restoreAllMocks();
  });

  it("chiaveStorage mette il prefisso dell'azienda, tenant 1 compreso; tenantDellaChiave lo rilegge", () => {
    expect(chiaveStorage(1, "preventivi_documenti", 7, 9, "a.pdf")).toMatch(/^tenant\/1\/preventivi_documenti\/7\/9-[0-9a-f]{8}\.pdf$/);
    expect(chiaveStorage(2, "anteprime", 3, 4, "p1.jpg")).toMatch(/^tenant\/2\/anteprime\/3\/4-[0-9a-f]{8}\.jpg$/);
    expect(tenantDellaChiave("tenant/2/anteprime/3/4-abcd1234.jpg")).toBe(2);
    expect(tenantDellaChiave("preventivi_documenti/7/9-abcd1234.pdf")).toBe(1); // chiave legacy
    expect(tenantDellaChiave("tenant/x/…")).toBe(1);
  });

  it("putFile scrive sotto tenant/<id>/ e avvisa il contabile", async () => {
    const { c, chiamate } = contabileFinto();
    impostaContabileStorage(c);
    const esito = await conTenant(2, () => putFile("ticket_allegati", 5, 6, "foto.png", Buffer.from("abc"), "image/png"));
    expect(esito.storageKey.startsWith("tenant/2/ticket_allegati/5/6-")).toBe(true);
    expect(driver.file.has(esito.storageKey)).toBe(true);
    expect(chiamate).toEqual([["aggiungi", 2, 3, 1]]);
  });

  it("putFile senza tenant nel contesto lancia (interruttore acceso, modalità stretta)", async () => {
    modalitaTenantStretta(true);
    await expect(putFile("ticket_allegati", 5, 6, "foto.png", Buffer.from("abc"), "image/png")).rejects.toThrow(
      "[fileStorage] scrittura senza tenant nel contesto"
    );
  });

  it("a interruttore spento le chiavi nuove hanno comunque il prefisso del tenant 1", async () => {
    process.env.FLAG_MULTI_AZIENDA = "off";
    const esito = await putFile("ticket_allegati", 5, 6, "foto.png", Buffer.from("abc"), "image/png");
    expect(esito.storageKey.startsWith("tenant/1/")).toBe(true);
  });

  it("getFile/openFileReadStream: una chiave di un'altra azienda dà null; la chiave nuda è del tenant 1", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    driver.file.set("tenant/2/a/1/1-00000000.bin", Buffer.from("due"));
    driver.file.set("preventivi_documenti/1/1-00000000.pdf", Buffer.from("uno"));
    expect(await conTenant(1, () => getFile("tenant/2/a/1/1-00000000.bin"))).toBeNull();
    expect(await conTenant(1, () => openFileReadStream("tenant/2/a/1/1-00000000.bin"))).toBeNull();
    expect((await conTenant(2, () => getFile("tenant/2/a/1/1-00000000.bin")))?.toString()).toBe("due");
    expect((await conTenant(1, () => getFile("preventivi_documenti/1/1-00000000.pdf")))?.toString()).toBe("uno");
    expect(await conTenant(2, () => getFile("preventivi_documenti/1/1-00000000.pdf"))).toBeNull();
    expect(warn).toHaveBeenCalledWith("[fileStorage] lettura rifiutata: chiave di un'altra azienda");
    expect(warn.mock.calls.flat().join(" ")).not.toContain("00000000"); // mai la chiave nel log
  });

  it("deleteFileQuiet sconta i byte passati, oppure quelli letti con head; un file assente non si sconta", async () => {
    const { c, chiamate } = contabileFinto();
    impostaContabileStorage(c);
    driver.file.set("tenant/2/a/1/1-00000000.bin", Buffer.from("12345"));
    driver.file.set("tenant/2/a/1/2-00000000.bin", Buffer.from("1234567"));
    deleteFileQuiet("tenant/2/a/1/1-00000000.bin", 5);
    deleteFileQuiet("tenant/2/a/1/2-00000000.bin");
    deleteFileQuiet("tenant/2/a/1/3-00000000.bin");
    await vi.waitFor(() => expect(chiamate.length).toBe(2));
    expect(chiamate).toEqual([["togli", 2, 5, 1], ["togli", 2, 7, 1]]);
    expect(driver.file.size).toBe(0);
  });

  it("statFile passa da head e risponde null senza head", async () => {
    driver.file.set("tenant/1/a/1/1-00000000.bin", Buffer.from("abcd"));
    expect(await statFile("tenant/1/a/1/1-00000000.bin")).toEqual({ bytes: 4 });
    expect(await statFile("tenant/1/a/1/9-00000000.bin")).toBeNull();
    __impostaDriverPerTest({ ...driver, head: undefined });
    expect(await statFile("tenant/1/a/1/1-00000000.bin")).toBeNull();
  });
});
```

- [ ] **Step 2: Eseguirlo e vederlo fallire**

Run: `pnpm vitest run server/_core/fileStorage.tenant.test.ts`
Expected: FAIL (`__impostaDriverPerTest`, `chiaveStorage`, `tenantDellaChiave`, `impostaContabileStorage`, `statFile` non esportati).

- [ ] **Step 3: Implementare in `fileStorage.ts`**

In cima, dopo gli import di node:

```ts
import { tenantCorrente } from "../tenants/contestoCorrente";
import { TENANT_PREDEFINITO_ID } from "../tenants/costanti";
```

Tipo driver: aggiungere `head?(key: string): Promise<{ bytes: number } | null>;` a `StorageDriver`. Dopo `buildStorageKey`:

```ts
// ── Chiavi per azienda (WS3, spec §3.1) ─────────────────────────────────────
// Ogni file NUOVO nasce sotto `tenant/<id>/…`, tenant 1 compreso; le chiavi
// nude sono i file di Ruffino Group caricati prima del WS3 e restano
// leggibili dove sono (decisione 2). La cintura in lettura confronta il
// tenant della chiave con quello del contesto: i record sono già per
// tenant (WS2), qui si ferma il record corrotto o l'errore di programmazione.
const RE_CHIAVE_TENANT = /^tenant\/(\d+)\//;

export function chiaveStorage(
  tenantId: number,
  collezione: string,
  parentId: number,
  recordId: number,
  nome: string
): string {
  return `tenant/${tenantId}/${buildStorageKey(collezione, parentId, recordId, nome)}`;
}

export function tenantDellaChiave(storageKey: string): number {
  const m = RE_CHIAVE_TENANT.exec(storageKey);
  return m ? Number(m[1]) : TENANT_PREDEFINITO_ID;
}

function tenantPerStorage(operazione: string): number {
  const t = tenantCorrente();
  if (t == null) throw new Error(`[fileStorage] ${operazione} senza tenant nel contesto`);
  return t;
}

function chiaveDelTenantCorrente(storageKey: string, operazione: string): boolean {
  if (tenantDellaChiave(storageKey) === tenantPerStorage(operazione)) return true;
  // Mai la chiave nel log: dice l'id di un record di un'altra azienda.
  console.warn(`[fileStorage] ${operazione} rifiutata: chiave di un'altra azienda`);
  return false;
}

// ── Contabile dei byte (spec §3.2) ──────────────────────────────────────────
// Iniettato al boot da server/tenants (come il resolver del tenant in
// persistence.ts): questo modulo non importa il control plane. Best effort:
// un errore di contabilità è un log, mai un upload rifiutato.
export type ContabileStorage = {
  aggiungi(tenantId: number, bytes: number, file: number): Promise<void>;
  togli(tenantId: number, bytes: number, file: number): Promise<void>;
};
let contabile: ContabileStorage | null = null;
export function impostaContabileStorage(c: ContabileStorage | null): void {
  contabile = c;
}
```

Driver locale, metodo nuovo:

```ts
  async head(key) {
    try {
      const stat = await fs.promises.stat(localPathFor(key));
      return { bytes: stat.size };
    } catch (e: any) {
      if (e?.code === "ENOENT") return null;
      throw e;
    }
  },
```

`s3Fetch` e `s3Request`: il parametro `method` diventa `"PUT" | "GET" | "DELETE" | "HEAD"`. Driver s3, metodo nuovo:

```ts
    async head(key) {
      const res = await s3Fetch(cfg, "HEAD", key);
      if (res.status === 404) return null;
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`STORAGE S3: head fallito (${res.status})`);
      }
      return { bytes: Number(res.headers.get("content-length") ?? 0) };
    },
```

Facciata:

```ts
export function __impostaDriverPerTest(driver: StorageDriver | null): void {
  if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY_DRIVER_STORAGE");
  _driver = driver;
}

export async function putFile(collection, parentId, recordId, originalName, buffer, mimeType) {
  const tenantId = tenantPerStorage("scrittura");
  const driver = getStorageDriver();
  assertDurableDriver(driver);
  const storageKey = chiaveStorage(tenantId, collection, parentId, recordId, originalName);
  await driver.put(storageKey, buffer, mimeType);
  if (contabile) {
    void contabile
      .aggiungi(tenantId, buffer.length, 1)
      .catch(e => console.warn(`[fileStorage] contabilità non aggiornata (${tenantId}):`, e));
  }
  return { storageKey, checksum: sha256Hex(buffer) };
}

export async function getFile(storageKey: string): Promise<Buffer | null> {
  if (!chiaveDelTenantCorrente(storageKey, "lettura")) return null;
  return getStorageDriver().get(storageKey);
}

export async function openFileReadStream(storageKey, range?) {
  if (!chiaveDelTenantCorrente(storageKey, "lettura")) return null;
  const driver = getStorageDriver();
  if (!driver.openRead) return null;
  return driver.openRead(storageKey, range);
}

export async function statFile(storageKey: string): Promise<{ bytes: number } | null> {
  const driver = getStorageDriver();
  if (!driver.head) return null;
  return driver.head(storageKey);
}

/** Best-effort delete; `bytes` è la dimensione registrata sul record, se manca si legge con `head`. */
export function deleteFileQuiet(storageKey: string | null | undefined, bytes?: number | null): void {
  if (!storageKey) return;
  const driver = getStorageDriver();
  void (async () => {
    let n = bytes ?? null;
    if (n == null && driver.head) {
      const info = await driver.head(storageKey);
      if (!info) return; // già assente: niente da cancellare né da scontare
      n = info.bytes;
    }
    await driver.delete(storageKey);
    if (contabile) await contabile.togli(tenantDellaChiave(storageKey), n ?? 0, 1);
  })().catch(e => console.warn(`[fileStorage] delete fallito per ${storageKey}:`, e));
}
```

(`statFile` non passa dalla cintura: la usano il ricalcolo e il `delete`, sempre su chiavi dell'azienda del contesto.) `firma di putFile` invariata: `(collection: string, parentId: number, recordId: number, originalName: string, buffer: Buffer, mimeType: string)`.

Chiamanti di `deleteFileQuiet` (byte dal record, dove c'è):
- `preventiviContratti.ts:347` → `deleteFileQuiet(documenti[i].storageKey, documenti[i].size)`;
- `:603`, `:685`, `:790`: accanto a `const oldStorageKey = …` aggiungere `const oldSize = existing?.size ?? null` (stesso record da cui viene `oldStorageKey`; leggere le righe sopra per il nome della variabile) e passare `deleteFileQuiet(oldStorageKey, oldSize)`;
- `:817` → `deleteFileQuiet(doc.storageKey, doc.size)`; `:1277` → `deleteFileQuiet(doc.storageKey, doc.size)`; `:1279` (anteprime, nessuna dimensione registrata) invariato;
- `ticketAllegati.ts:75` → `deleteFileQuiet(allegati[i].storageKey, allegati[i].size)`; `:200` → `deleteFileQuiet(removed?.storageKey, removed?.size)`.

- [ ] **Step 4: Eseguire i test**

Run: `pnpm vitest run server/_core/fileStorage.tenant.test.ts server/_core/driveBackup.test.ts server/routers/preventiviContratti.test.ts server/routers/ticketAllegati.test.ts server/comunicazioni/imap.tenant.test.ts server/documenti/anteprime.test.ts` (i file di test che non esistono si tolgono dalla riga). `pnpm check`.
Expected: PASS (baseline HEIC esclusa). Se un test esistente asserisce chiavi SENZA prefisso (`toMatch(/^preventivi_documenti\//)` o simili), aggiornarlo a `tenant/1/…`: è il comportamento voluto (spec §3.1).

- [ ] **Step 5: Commit**

```bash
git add server/_core/fileStorage.ts server/_core/fileStorage.tenant.test.ts server/routers/preventiviContratti.ts server/routers/ticketAllegati.ts
git commit -m "feat(storage): chiavi con prefisso del tenant, cintura in lettura, head/statFile, deleteFileQuiet con byte e contabile iniettato"
```

---

### Task 2: Control plane — `tenant_storage`, `oauth_state`, `storage_quota_bytes`, tipi di comando ed evento

**Files:**
- Modify: `server/tenants/tipi.ts`, `server/tenants/costanti.ts`, `server/tenants/repository.ts` (tipo :24-78, memoria :102-221, Postgres :231-473)
- Modify: `server/tenants/confine.test.ts` (guardia: `oauth_state` e `tenant_storage` scritte solo dal repository)
- Test: `server/tenants/repository.test.ts` (memoria), `server/tenants/repository.pg.test.ts` (Postgres; aggiungere `tenant_storage, oauth_state` alla lista dei `DROP TABLE` in `beforeAll`/`afterAll`)

**Interfaces:**
- Produces (usati dai task 3–10):
  ```ts
  // tipi.ts
  export type TenantRecord = { …come oggi…; storageQuotaBytes: number };
  export type TipoEvento = …oggi… | "storage_soglia" | "storage_ricalcolato" | "worker_sospeso" | "worker_riarmato" | "archivi_ripristinati";
  export type TipoComando = …oggi… | "ricalcola_storage" | "ripristina_archivi";
  export type StatoStorage = { tenantId: number; bytes: number; file: number; quotaBytes: number; sogliaAvvisata: 0 | 50 | 80 | 100; ricalcolatoIl: Date | null; aggiornatoIl: Date };
  export type TipoStateOAuth = "fic" | "gdrive";
  export type StateOAuth = { state: string; tipo: TipoStateOAuth; tenantId: number; sedeId: number | null; utenteId: number; payload: Record<string, unknown>; scadeIl: Date };
  // costanti.ts
  export const QUOTA_STORAGE_PREDEFINITA_BYTES = 100 * 1024 ** 3; // 100 GiB
  export const TTL_STATE_OAUTH_MS = 10 * 60_000;
  // repository.ts (TenantRepository)
  storageDi(tenantId: number): Promise<StatoStorage | null>;
  aggiornaStorage(tenantId: number, deltaBytes: number, deltaFile: number): Promise<StatoStorage>; // upsert, incremento atomico, mai sotto zero
  impostaStorage(tenantId: number, valori: { bytes: number; file: number }): Promise<StatoStorage>; // ricalcolo: sostituisce e timbra ricalcolato_il
  impostaSogliaAvvisata(tenantId: number, soglia: 0 | 50 | 80 | 100): Promise<void>;
  impostaQuotaStorage(tenantId: number, quotaBytes: number): Promise<TenantRecord>;
  emettiStateOAuth(input: { tipo: TipoStateOAuth; tenantId: number; sedeId: number | null; utenteId: number; payload: Record<string, unknown> }): Promise<string>;
  consumaStateOAuth(state: string, tipo: TipoStateOAuth): Promise<StateOAuth | null>; // una volta sola, entro TTL
  pulisciStateScaduti(): Promise<number>;
  ```

- [ ] **Step 1: Test in memoria che falliscono** — aggiungere a `server/tenants/repository.test.ts` (dentro il `describe` esistente sul repository in memoria, riusando il suo `beforeEach`/`resetTenantRepositoryForTesting`):

```ts
  it("storage: la riga nasce al primo delta, incrementa, non scende sotto zero, porta la quota", async () => {
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "Ruffino Group" });
    expect(await repo.storageDi(1)).toBeNull();
    const a = await repo.aggiornaStorage(1, 1000, 1);
    expect(a).toMatchObject({ tenantId: 1, bytes: 1000, file: 1, quotaBytes: 100 * 1024 ** 3, sogliaAvvisata: 0, ricalcolatoIl: null });
    const b = await repo.aggiornaStorage(1, -5000, -3);
    expect(b).toMatchObject({ bytes: 0, file: 0 });
    const c = await repo.impostaStorage(1, { bytes: 42, file: 2 });
    expect(c.bytes).toBe(42);
    expect(c.ricalcolatoIl).toBeInstanceOf(Date);
    await repo.impostaSogliaAvvisata(1, 80);
    expect((await repo.storageDi(1))?.sogliaAvvisata).toBe(80);
    const t = await repo.impostaQuotaStorage(1, 10);
    expect(t.storageQuotaBytes).toBe(10);
    expect((await repo.storageDi(1))?.quotaBytes).toBe(10);
  });

  it("oauth_state: consumo unico, tipo giusto, scadenza", async () => {
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "Ruffino Group" });
    const state = await repo.emettiStateOAuth({ tipo: "fic", tenantId: 1, sedeId: 3, utenteId: 7, payload: { redirectUri: "https://x/cb", scrittura: true } });
    expect(state).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(await repo.consumaStateOAuth(state, "gdrive")).toBeNull();
    const riga = await repo.consumaStateOAuth(state, "fic");
    expect(riga).toMatchObject({ tipo: "fic", tenantId: 1, sedeId: 3, utenteId: 7, payload: { redirectUri: "https://x/cb", scrittura: true } });
    expect(await repo.consumaStateOAuth(state, "fic")).toBeNull(); // già consumato
    vi.useFakeTimers({ now: Date.now(), toFake: ["Date"] });
    const scaduto = await repo.emettiStateOAuth({ tipo: "gdrive", tenantId: 1, sedeId: null, utenteId: 7, payload: {} });
    vi.setSystemTime(Date.now() + 11 * 60_000);
    expect(await repo.consumaStateOAuth(scaduto, "gdrive")).toBeNull();
    expect(await repo.pulisciStateScaduti()).toBe(1);
    vi.useRealTimers();
  });
```

(Importare `vi` da vitest se manca.)

- [ ] **Step 2: Eseguirli e vederli fallire**

Run: `pnpm vitest run server/tenants/repository.test.ts`
Expected: FAIL (`storageDi` non è una funzione).

- [ ] **Step 3: Tipi e costanti**

`tipi.ts`: estendere `TenantRecord`, `TipoEvento`, `TipoComando` e aggiungere `StatoStorage`, `TipoStateOAuth`, `StateOAuth` come nelle Interfaces. `costanti.ts`: `QUOTA_STORAGE_PREDEFINITA_BYTES`, `TTL_STATE_OAUTH_MS`. In `router.ts` (`tenantPredefinitoSintetico`) aggiungere `storageQuotaBytes: QUOTA_STORAGE_PREDEFINITA_BYTES`.

- [ ] **Step 4: Repository in memoria** — dentro `createMemoryTenantRepository`:

```ts
  const storage = new Map<number, StatoStorage>();
  const states = new Map<string, StateOAuth & { consumatoIl: Date | null }>();
  const quotaDi = (tenantId: number) =>
    tenants.find(t => t.id === tenantId)?.storageQuotaBytes ?? QUOTA_STORAGE_PREDEFINITA_BYTES;
  const rigaStorage = (tenantId: number): StatoStorage => {
    let s = storage.get(tenantId);
    if (!s) {
      s = { tenantId, bytes: 0, file: 0, quotaBytes: quotaDi(tenantId), sogliaAvvisata: 0, ricalcolatoIl: null, aggiornatoIl: new Date() };
      storage.set(tenantId, s);
    }
    s.quotaBytes = quotaDi(tenantId);
    return s;
  };
  // …nel `repo`:
    async storageDi(tenantId) {
      const s = storage.get(tenantId);
      return s ? clone({ ...s, quotaBytes: quotaDi(tenantId) }) : null;
    },
    async aggiornaStorage(tenantId, deltaBytes, deltaFile) {
      const s = rigaStorage(tenantId);
      s.bytes = Math.max(0, s.bytes + deltaBytes);
      s.file = Math.max(0, s.file + deltaFile);
      s.aggiornatoIl = new Date();
      return clone(s);
    },
    async impostaStorage(tenantId, valori) {
      const s = rigaStorage(tenantId);
      s.bytes = Math.max(0, valori.bytes);
      s.file = Math.max(0, valori.file);
      s.ricalcolatoIl = new Date();
      s.aggiornatoIl = s.ricalcolatoIl;
      return clone(s);
    },
    async impostaSogliaAvvisata(tenantId, soglia) {
      rigaStorage(tenantId).sogliaAvvisata = soglia;
    },
    async impostaQuotaStorage(tenantId, quotaBytes) {
      const t = tenants.find(x => x.id === tenantId);
      if (!t) throw new Error(`tenant ${tenantId} inesistente`);
      t.storageQuotaBytes = quotaBytes;
      t.updatedAt = new Date();
      return clone(t);
    },
    async emettiStateOAuth(input) {
      const state = randomBytes(24).toString("base64url");
      states.set(state, { state, ...input, payload: clone(input.payload), scadeIl: new Date(Date.now() + TTL_STATE_OAUTH_MS), consumatoIl: null });
      return state;
    },
    async consumaStateOAuth(state, tipo) {
      const s = states.get(state);
      if (!s || s.tipo !== tipo || s.consumatoIl || s.scadeIl.getTime() <= Date.now()) return null;
      s.consumatoIl = new Date();
      const { consumatoIl: _c, ...riga } = s;
      return clone(riga);
    },
    async pulisciStateScaduti() {
      let n = 0;
      for (const [k, s] of states) if (s.scadeIl.getTime() <= Date.now()) { states.delete(k); n++; }
      return n;
    },
```

`inserisci` in memoria: `storageQuotaBytes: QUOTA_STORAGE_PREDEFINITA_BYTES` nel record. Import: `import { randomBytes } from "node:crypto";`.

- [ ] **Step 5: Repository Postgres**

`rigaTenant`: `storageQuotaBytes: Number(r.storage_quota_bytes ?? QUOTA_STORAGE_PREDEFINITA_BYTES)`. Nuove funzioni di mappatura:

```ts
  const rigaStorage = (r: any, quotaBytes: number): StatoStorage => ({
    tenantId: Number(r.tenant_id),
    bytes: Number(r.bytes),
    file: Number(r.file),
    quotaBytes,
    sogliaAvvisata: Number(r.soglia_avvisata) as StatoStorage["sogliaAvvisata"],
    ricalcolatoIl: r.ricalcolato_il ? new Date(r.ricalcolato_il) : null,
    aggiornatoIl: new Date(r.aggiornato_il),
  });
  const rigaState = (r: any): StateOAuth => ({
    state: r.state, tipo: r.tipo, tenantId: Number(r.tenant_id),
    sedeId: r.sede_id == null ? null : Number(r.sede_id), utenteId: Number(r.utente_id),
    payload: r.payload ?? {}, scadeIl: new Date(r.scade_il),
  });
  const quotaDi = (tenantId: number) => cache.get(tenantId)?.storageQuotaBytes ?? QUOTA_STORAGE_PREDEFINITA_BYTES;
```

`verificaSchema`: aggiungere `to_regclass('tenant_storage') AS storage, to_regclass('oauth_state') AS oauth` e controllarli. `creaSchema`, dopo `tenant_sedi`:

```ts
        // Contabilità dei byte per azienda (WS3, spec §3.2): la riga nasce al
        // primo upload o al ricalcolo; la quota sta su `tenants`.
        await tx`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS storage_quota_bytes BIGINT NOT NULL DEFAULT ${QUOTA_STORAGE_PREDEFINITA_BYTES}`;
        await tx`CREATE TABLE IF NOT EXISTS tenant_storage (
          tenant_id BIGINT PRIMARY KEY REFERENCES tenants(id),
          bytes BIGINT NOT NULL DEFAULT 0,
          file INTEGER NOT NULL DEFAULT 0,
          soglia_avvisata INTEGER NOT NULL DEFAULT 0,
          ricalcolato_il TIMESTAMPTZ,
          aggiornato_il TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
        // `state` OAuth persistiti (spec §5): una replica sola oggi, ma una
        // mappa in memoria muore a ogni deploy e non sa di quale azienda è.
        await tx`CREATE TABLE IF NOT EXISTS oauth_state (
          state TEXT PRIMARY KEY,
          tipo TEXT NOT NULL CHECK (tipo IN ('fic','gdrive')),
          tenant_id BIGINT NOT NULL REFERENCES tenants(id),
          sede_id BIGINT,
          utente_id BIGINT NOT NULL,
          payload JSONB NOT NULL,
          scade_il TIMESTAMPTZ NOT NULL,
          consumato_il TIMESTAMPTZ
        )`;
        await tx`CREATE INDEX IF NOT EXISTS oauth_state_scade_idx ON oauth_state (scade_il)`;
        // Tipi di comando nuovi: il CHECK di `tenant_comandi` è nato nel WS1 con
        // cinque valori e `CREATE TABLE IF NOT EXISTS` non lo tocca su una
        // tabella già a terra. Postgres chiama il vincolo <tabella>_<colonna>_check.
        await tx`ALTER TABLE tenant_comandi DROP CONSTRAINT IF EXISTS tenant_comandi_tipo_check`;
        await tx`ALTER TABLE tenant_comandi ADD CONSTRAINT tenant_comandi_tipo_check
          CHECK (tipo IN ('crea','sospendi','riattiva','assegna_proprietario','revoca_proprietario','ricalcola_storage','ripristina_archivi'))`;
```

Aggiornare anche la lista inline del `CREATE TABLE IF NOT EXISTS tenant_comandi` agli stessi sette valori. Metodi:

```ts
    async storageDi(tenantId) {
      await ensureSchema();
      const rows = await sql`SELECT * FROM tenant_storage WHERE tenant_id = ${tenantId}`;
      return rows.length ? rigaStorage(rows[0], quotaDi(tenantId)) : null;
    },
    async aggiornaStorage(tenantId, deltaBytes, deltaFile) {
      await ensureSchema();
      const rows = await sql`INSERT INTO tenant_storage (tenant_id, bytes, file)
        VALUES (${tenantId}, GREATEST(${deltaBytes}, 0), GREATEST(${deltaFile}, 0))
        ON CONFLICT (tenant_id) DO UPDATE SET
          bytes = GREATEST(tenant_storage.bytes + ${deltaBytes}, 0),
          file = GREATEST(tenant_storage.file + ${deltaFile}, 0),
          aggiornato_il = NOW()
        RETURNING *`;
      return rigaStorage(rows[0], quotaDi(tenantId));
    },
    async impostaStorage(tenantId, valori) {
      await ensureSchema();
      const rows = await sql`INSERT INTO tenant_storage (tenant_id, bytes, file, ricalcolato_il)
        VALUES (${tenantId}, GREATEST(${valori.bytes}, 0), GREATEST(${valori.file}, 0), NOW())
        ON CONFLICT (tenant_id) DO UPDATE SET
          bytes = EXCLUDED.bytes, file = EXCLUDED.file, ricalcolato_il = NOW(), aggiornato_il = NOW()
        RETURNING *`;
      return rigaStorage(rows[0], quotaDi(tenantId));
    },
    async impostaSogliaAvvisata(tenantId, soglia) {
      await ensureSchema();
      await sql`INSERT INTO tenant_storage (tenant_id, soglia_avvisata) VALUES (${tenantId}, ${soglia})
        ON CONFLICT (tenant_id) DO UPDATE SET soglia_avvisata = EXCLUDED.soglia_avvisata, aggiornato_il = NOW()`;
    },
    async impostaQuotaStorage(tenantId, quotaBytes) {
      await ensureSchema();
      const rows = await sql`UPDATE tenants SET storage_quota_bytes = ${quotaBytes}, updated_at = NOW() WHERE id = ${tenantId} RETURNING *`;
      if (!rows.length) throw new Error(`tenant ${tenantId} inesistente`);
      return memorizza(rigaTenant(rows[0]));
    },
    async emettiStateOAuth(input) {
      await ensureSchema();
      const state = randomBytes(24).toString("base64url");
      await sql`INSERT INTO oauth_state (state, tipo, tenant_id, sede_id, utente_id, payload, scade_il)
        VALUES (${state}, ${input.tipo}, ${input.tenantId}, ${input.sedeId}, ${input.utenteId}, ${sql.json(input.payload as any)}, NOW() + make_interval(secs => ${TTL_STATE_OAUTH_MS / 1000}))`;
      return state;
    },
    async consumaStateOAuth(state, tipo) {
      await ensureSchema();
      const rows = await sql`UPDATE oauth_state SET consumato_il = NOW()
        WHERE state = ${state} AND tipo = ${tipo} AND consumato_il IS NULL AND scade_il > NOW() RETURNING *`;
      return rows.length ? rigaState(rows[0]) : null;
    },
    async pulisciStateScaduti() {
      await ensureSchema();
      const rows = await sql`DELETE FROM oauth_state WHERE scade_il <= NOW() RETURNING state`;
      return rows.length;
    },
```

- [ ] **Step 6: Test Postgres** — in `repository.pg.test.ts` aggiungere `tenant_storage, oauth_state` ai due `DROP TABLE IF EXISTS` e i test:

```ts
  it("storage e oauth_state su Postgres: incremento atomico, soglia, quota, consumo unico, CHECK dei comandi nuovi", async () => {
    const repo = getTenantRepository();
    await repo.ensureSchema();
    await repo.caricaCache();
    await repo.assicuraTenantPredefinito();
    await Promise.all([repo.aggiornaStorage(1, 10, 1), repo.aggiornaStorage(1, 20, 1), repo.aggiornaStorage(1, -5, 0)]);
    expect(await repo.storageDi(1)).toMatchObject({ bytes: 25, file: 2, quotaBytes: 100 * 1024 ** 3 });
    await repo.impostaSogliaAvvisata(1, 50);
    expect((await repo.storageDi(1))?.sogliaAvvisata).toBe(50);
    expect((await repo.impostaQuotaStorage(1, 1234)).storageQuotaBytes).toBe(1234);
    expect((await repo.storageDi(1))?.quotaBytes).toBe(1234);
    const state = await repo.emettiStateOAuth({ tipo: "gdrive", tenantId: 1, sedeId: null, utenteId: 1, payload: { a: 1 } });
    expect((await repo.consumaStateOAuth(state, "gdrive"))?.payload).toEqual({ a: 1 });
    expect(await repo.consumaStateOAuth(state, "gdrive")).toBeNull();
    const c = await repo.accodaComando({ tipo: "ricalcola_storage", tenantId: 1, payload: { slug: "ruffino-group" }, richiestoDa: "test" });
    expect(c.tipo).toBe("ricalcola_storage");
  });

  it("lo schema del WS3 è idempotente anche sopra uno schema del WS2 (CHECK vecchio a terra)", async () => {
    await sql`DROP TABLE IF EXISTS tenant_storage, oauth_state, tenant_sedi, tenant_comandi, tenant_eventi, tenants CASCADE`;
    await sql`CREATE TABLE tenants (id BIGSERIAL PRIMARY KEY, slug TEXT NOT NULL UNIQUE, nome TEXT NOT NULL,
      stato TEXT NOT NULL CHECK (stato IN ('attivo','sospeso')), motivo_stato TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
    await sql`CREATE TABLE tenant_comandi (id BIGSERIAL PRIMARY KEY,
      tipo TEXT NOT NULL CHECK (tipo IN ('crea','sospendi','riattiva','assegna_proprietario','revoca_proprietario')),
      tenant_id BIGINT, payload JSONB NOT NULL, stato TEXT NOT NULL DEFAULT 'in_attesa', esito JSONB,
      richiesto_da TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), eseguito_at TIMESTAMPTZ)`;
    resetTenantRepositoryForTesting();
    const repo = getTenantRepository();
    await repo.ensureSchema();
    await repo.assicuraTenantPredefinito();
    const c = await repo.accodaComando({ tipo: "ripristina_archivi", tenantId: 1, payload: {}, richiestoDa: "test" });
    expect(c.tipo).toBe("ripristina_archivi");
    expect((await sql`SELECT storage_quota_bytes FROM tenants WHERE id = 1`)[0].storage_quota_bytes).toBe(String(100 * 1024 ** 3));
  });
```

(`postgres-js` restituisce i BIGINT come stringhe: da qui `String(...)`.) Aggiornare `confine.test.ts`: la guardia «solo repository.ts scrive le tabelle del control plane» deve coprire anche `oauth_state` e `tenant_storage` (leggere la regex esistente e aggiungere i due nomi).

- [ ] **Step 7: Eseguire**

Run: `pnpm vitest run server/tenants/repository.test.ts server/tenants/confine.test.ts server/tenants/router.test.ts server/tenants` e, con Docker attivo, `DATABASE_URL=postgres://postgres:test@localhost:55433/perf_test pnpm vitest run server/tenants/repository.pg.test.ts server/tenants/tabelle.pg.test.ts --no-file-parallelism`; `pnpm check`.
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/tenants/tipi.ts server/tenants/costanti.ts server/tenants/repository.ts server/tenants/router.ts server/tenants/repository.test.ts server/tenants/repository.pg.test.ts server/tenants/confine.test.ts
git commit -m "feat(tenant): tenant_storage, oauth_state, quota storage e tipi di comando/evento del WS3 nel control plane"
```

---

### Task 3: Contabile dello storage, soglie che avvisano, `tenants.storage`, registrazione al boot

**Files:**
- Create: `server/tenants/storage.ts`
- Modify: `server/tenants/boot.ts` (`preparaTenants`: registra il contabile), `server/tenants/router.ts` (`tenants.storage`)
- Test: `server/tenants/storage.test.ts` (nuovo), `server/tenants/router.test.ts` (se esiste: un caso per `storage`; altrimenti crearlo con il pattern di `server/tenants/express.test.ts`)

**Interfaces:**
- Consumes: `TenantRepository` del Task 2; `impostaContabileStorage`/`ContabileStorage` del Task 1; `tenantDelContesto` (`server/tenants/regole.ts:106`).
- Produces (usati dai task 4, 8):
  ```ts
  export const SOGLIE_STORAGE = [50, 80, 100] as const;
  export type SogliaStorage = 0 | 50 | 80 | 100;
  export function percentualeStorage(bytes: number, quotaBytes: number): number; // 0 se quota ≤ 0, una cifra decimale
  export function sogliaRaggiunta(bytes: number, quotaBytes: number): SogliaStorage; // la più alta ≤ percentuale
  export async function applicaSoglie(stato: StatoStorage, attore?: string): Promise<SogliaStorage | null>; // evento + soglia_avvisata; null se nulla da avvisare
  export function creaContabileStorage(): ContabileStorage;
  ```

- [ ] **Step 1: Test che fallisce** — `server/tenants/storage.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applicaSoglie, creaContabileStorage, percentualeStorage, sogliaRaggiunta } from "./storage";
import { getTenantRepository, resetTenantRepositoryForTesting } from "./repository";

describe("contabile dello storage", () => {
  beforeEach(async () => {
    resetTenantRepositoryForTesting();
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "Ruffino Group" });
    await repo.inserisci({ id: 2, slug: "acme", nome: "Acme" });
    await repo.impostaQuotaStorage(2, 1000);
  });
  afterEach(() => resetTenantRepositoryForTesting());

  it("percentuale e soglia", () => {
    expect(percentualeStorage(0, 1000)).toBe(0);
    expect(percentualeStorage(333, 1000)).toBe(33.3);
    expect(percentualeStorage(10, 0)).toBe(0);
    expect(sogliaRaggiunta(499, 1000)).toBe(0);
    expect(sogliaRaggiunta(500, 1000)).toBe(50);
    expect(sogliaRaggiunta(800, 1000)).toBe(80);
    expect(sogliaRaggiunta(1500, 1000)).toBe(100);
  });

  it("aggiungi e togli aggiornano il ledger; ogni soglia si avvisa una volta e si riarma sotto il 50 %", async () => {
    const repo = getTenantRepository();
    const c = creaContabileStorage();
    await c.aggiungi(2, 400, 1);
    expect(await repo.eventi(2)).toEqual([]);
    await c.aggiungi(2, 150, 1); // 55 %
    await c.aggiungi(2, 100, 1); // 65 %: nessun nuovo evento
    let eventi = await repo.eventi(2);
    expect(eventi.map(e => e.tipo)).toEqual(["storage_soglia"]);
    expect(eventi[0].dettagli).toEqual({ percentuale: 50, bytes: 550, quotaBytes: 1000 });
    await c.aggiungi(2, 600, 1); // 125 %: salta direttamente a 100
    eventi = await repo.eventi(2);
    expect(eventi.map(e => e.dettagli?.percentuale)).toEqual([50, 100]);
    expect((await repo.storageDi(2))?.sogliaAvvisata).toBe(100);
    await c.togli(2, 1000, 3); // 15 %: si riarma
    expect((await repo.storageDi(2))?.sogliaAvvisata).toBe(0);
    expect(await repo.storageDi(2)).toMatchObject({ bytes: 250, file: 1 });
    await c.aggiungi(2, 300, 1); // di nuovo 55 %: nuovo avviso
    expect((await repo.eventi(2)).length).toBe(3);
  });

  it("applicaSoglie non avvisa un'azienda senza quota superata e non scrive eventi doppi", async () => {
    const repo = getTenantRepository();
    const stato = await repo.aggiornaStorage(1, 10, 1);
    expect(await applicaSoglie(stato)).toBeNull();
    expect(await repo.eventi(1)).toEqual([]);
  });
});
```

- [ ] **Step 2: Vederlo fallire**

Run: `pnpm vitest run server/tenants/storage.test.ts` — Expected: FAIL (modulo assente).

- [ ] **Step 3: Implementare `server/tenants/storage.ts`**

```ts
// server/tenants/storage.ts
// Contabilità dei byte per azienda (WS3, spec §3.2): il ledger vive nel
// control plane (`tenant_storage`), lo aggiorna ogni put/delete di
// fileStorage.ts attraverso il contabile iniettato, e le soglie 50/80/100 %
// della quota diventano eventi di `tenant_eventi`. Nessun blocco: la quota
// conta e avvisa (decisione 5); chi blocca è il WS4.
import type { ContabileStorage } from "../_core/fileStorage";
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
```

`boot.ts`, in `preparaTenants()` subito dopo `await repo.assicuraTenantPredefinito();` (sempre, anche a interruttore spento: i byte di Ruffino Group si contano lo stesso):

```ts
  // Il contabile dei byte (WS3): fileStorage.ts non importa il control plane
  // e lo riceve da qui, come persistence.ts riceve il resolver del tenant.
  impostaContabileStorage(creaContabileStorage());
```

con `import { impostaContabileStorage } from "../_core/fileStorage";` e `import { creaContabileStorage } from "./storage";`.

`router.ts`, nuova procedura:

```ts
  /** Uso dello storage dell'azienda della sessione: conta e avvisa, non blocca (spec WS3 §3.2). */
  storage: protectedProcedure.query(async ({ ctx }) => {
    const tenantId = tenantDelContesto(ctx);
    const stato = await getTenantRepository().storageDi(tenantId);
    const quotaBytes = stato?.quotaBytes ?? getTenantRepository().perId(tenantId)?.storageQuotaBytes ?? QUOTA_STORAGE_PREDEFINITA_BYTES;
    const bytes = stato?.bytes ?? 0;
    return {
      bytes,
      file: stato?.file ?? 0,
      quotaBytes,
      percentuale: percentualeStorage(bytes, quotaBytes),
      sogliaAvvisata: stato?.sogliaAvvisata ?? 0,
      ricalcolatoIl: stato?.ricalcolatoIl ?? null,
    };
  }),
```

(`protectedProcedure` da `../_core/trpc`; `tenantDelContesto` da `./regole`; `percentualeStorage` da `./storage`.) Test del router: chiamare `tenantsRouter.createCaller(ctx)` con un `ctx` come negli altri test di router (`tenantId: 2`, `sedeId`, `user` con `ruolo: "direzione"`), dopo `repo.aggiornaStorage(2, 500, 1)` e quota 1000 → `{ bytes: 500, file: 1, quotaBytes: 1000, percentuale: 50, sogliaAvvisata: 0, ricalcolatoIl: null }`.

- [ ] **Step 4: Eseguire**

Run: `pnpm vitest run server/tenants/storage.test.ts server/tenants/router.test.ts server/tenants/boot.test.ts`; `pnpm check`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/tenants/storage.ts server/tenants/storage.test.ts server/tenants/boot.ts server/tenants/router.ts server/tenants/router.test.ts
git commit -m "feat(storage): contabile dei byte per azienda con soglie 50/80/100 % come eventi e query tenants.storage"
```

---

### Task 4: Ricalcolo dello storage — `ricalcolaStorage`, comando `ricalcola_storage`, `pnpm tenant storage`, primo boot

**Files:**
- Modify: `server/tenants/storage.ts`, `server/tenants/comandi.ts`, `server/tenants/servizio.ts` (`eseguiComando` :257-300), `scripts/tenant.ts` (`USO` :72-75, `main` :204-288), `server/tenants/boot.ts`, `server/_core/index.ts:433-439` (dopo il listen)
- Test: `server/tenants/storage.test.ts`, `server/tenants/servizio.test.ts`, `server/tenants/cli.test.ts` (se lo script ha parti pure da provare), `server/tenants/boot.test.ts`

**Interfaces:**
- Consumes: `storeDi`, `kvSql` (`server/_core/persistence.ts`), `statFile` (Task 1), `conTenant`, `applicaSoglie` (Task 3).
- Produces:
  ```ts
  export async function ricalcolaStorage(tenantId: number, attore?: string): Promise<StatoStorage>;
  export async function ricalcolaStorageSeManca(tenantIds: number[]): Promise<void>; // boot, dopo il listen
  // comandi.ts
  export const schemaPayloadStorage = z.object({ slug });
  ```

- [ ] **Step 1: Test che fallisce** — in `storage.test.ts`:

```ts
import { __registraTenantNotoPerTest, storeDi } from "../_core/persistence";
import { __impostaDriverPerTest, type StorageDriver } from "../_core/fileStorage";
import "../routers"; // registra gli store dei documenti e degli allegati
import { ricalcolaStorage } from "./storage";

  it("ricalcolaStorage somma size registrate e head delle anteprime, timbra e avvisa", async () => {
    // Mai `__resetPersistenzaPerTest()` in un file che importa i router: azzera
    // le famiglie registrate all'import. Si registra il tenant 2 e si puliscono gli array.
    __registraTenantNotoPerTest(2);
    storeDi<any>(2, "preventivi_documenti").length = 0;
    storeDi<any>(2, "ticket_allegati").length = 0;
    const file = new Map<string, Buffer>([["tenant/2/anteprime/1/1-aaaaaaaa.jpg", Buffer.alloc(7)]]);
    const driver: StorageDriver = {
      name: "local",
      async put() {}, async get() { return null; }, async openRead() { return null; }, async delete() {},
      async head(k) { const b = file.get(k); return b ? { bytes: b.length } : null; },
    };
    __impostaDriverPerTest(driver);
    try {
      storeDi<any>(2, "preventivi_documenti").push(
        { id: 1, tenantId: 2, sedeId: 20, commessaId: 1, nome: "a.pdf", size: 100, storageKey: "tenant/2/preventivi_documenti/1/1-aaaaaaaa.pdf", anteprime: { chiavi: ["tenant/2/anteprime/1/1-aaaaaaaa.jpg"] } },
        { id: 2, tenantId: 2, sedeId: 20, commessaId: 1, nome: "b.pdf", size: 999, dataBase64: "QUJD" } // legacy inline: non conta
      );
      storeDi<any>(2, "ticket_allegati").push({ id: 3, tenantId: 2, ticketId: 1, nome: "c.png", size: 50, storageKey: "tenant/2/ticket_allegati/1/3-aaaaaaaa.png" });
      const stato = await ricalcolaStorage(2, "test");
      expect(stato).toMatchObject({ tenantId: 2, bytes: 157, file: 3 });
      expect(stato.ricalcolatoIl).toBeInstanceOf(Date);
      const eventi = await getTenantRepository().eventi(2);
      expect(eventi.map(e => e.tipo)).toEqual(["storage_ricalcolato"]);
      expect(eventi[0].dettagli).toEqual({ bytes: 157, file: 3 });
    } finally {
      __impostaDriverPerTest(null);
      storeDi<any>(2, "preventivi_documenti").length = 0;
      storeDi<any>(2, "ticket_allegati").length = 0;
    }
  });
```

(Nel `beforeEach` del describe la quota del tenant 2 è 1000: 157 byte non superano soglie. Senza `bootstrapAll` gli store in memoria non sono `loaded`: il ricalcolo legge soltanto, quindi non serve.)

- [ ] **Step 2: Vederlo fallire** — `pnpm vitest run server/tenants/storage.test.ts`. Expected: FAIL (`ricalcolaStorage` non esportata).

- [ ] **Step 3: Implementare**

`storage.ts`:

```ts
import { kvSql, storeDi } from "../_core/persistence";
import { statFile } from "../_core/fileStorage";
import { conTenant } from "./contestoCorrente";

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
    const misura = async (chiave: string) => conta((await statFile(chiave))?.bytes ?? 0);

    for (const d of storeDi<any>(tenantId, "preventivi_documenti")) {
      if (d?.storageKey) conta(Number(d.size) || 0);
      for (const chiave of d?.anteprime?.chiavi ?? []) await misura(chiave);
    }
    for (const a of storeDi<any>(tenantId, "ticket_allegati")) {
      if (a?.storageKey) conta(Number(a.size) || 0);
    }
    if (kvSql) {
      const comunicazioni = await kvSql`SELECT allegati FROM comunicazioni WHERE COALESCE(tenant_id, 1) = ${tenantId}`;
      for (const r of comunicazioni) {
        for (const al of (r.allegati as any[]) ?? []) if (al?.storageKey) conta(Number(al.size) || 0);
      }
      const fatture = await kvSql`SELECT pdf_storage_key, xml_storage_key FROM fatture WHERE COALESCE(tenant_id, 1) = ${tenantId}`;
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

/** Primo boot del WS3: chi non ha ancora una riga nel ledger la riceve dal ricalcolo, in sottofondo. */
export async function ricalcolaStorageSeManca(tenantIds: number[]): Promise<void> {
  const repo = getTenantRepository();
  for (const tenantId of tenantIds) {
    try {
      if (await repo.storageDi(tenantId)) continue;
      const inizio = Date.now();
      const stato = await ricalcolaStorage(tenantId, "boot");
      console.log(`[storage] ricalcolo iniziale tenant ${tenantId}: ${stato.file} file, ${stato.bytes} byte in ${Date.now() - inizio} ms`);
    } catch (errore) {
      console.error(`[storage] ricalcolo iniziale tenant ${tenantId}:`, errore instanceof Error ? errore.message : errore);
    }
  }
}
```

Le tabelle `comunicazioni`/`fatture` possono mancare in un database appena creato: se la query fallisce con `42P01` (undefined_table) trattarla come zero righe (`try/catch` sul codice), non come errore del ricalcolo.

`comandi.ts`: `export const schemaPayloadStorage = z.object({ slug });`. `servizio.ts`, nuovo `case` in `eseguiComando`:

```ts
      case "ricalcola_storage": {
        const p = schemaPayloadStorage.parse(comando.payload);
        const id = comando.tenantId ?? tenantDaSlug(p.slug).id;
        const stato = await ricalcolaStorage(id, attoreTesto(attore));
        return { tenantId: id, bytes: stato.bytes, file: stato.file };
      }
```

`boot.ts`: esportare `avviaRicalcoloStorageIniziale(tenantIds: number[])` che chiama `ricalcolaStorageSeManca(tenantIds)` (log degli errori, mai un throw) — `tenantIds` sono quelli restituiti da `preparaTenants()` (a interruttore spento `[1]`). `index.ts`, nel callback di `server.listen`, dopo `void avviaBackfillTabelleTenant();`:

```ts
    // Il ledger dello storage (WS3) si popola in sottofondo, una volta per
    // azienda: dopo, lo tengono aggiornato put e delete.
    void avviaRicalcoloStorageIniziale(tenantIds);
```

(importare la funzione insieme a `applicaSchemaTabelleTenant`; `tenantIds` è già in scope, riga 68).

`scripts/tenant.ts`: sottocomando `storage`:

```ts
  if (sotto === "storage") {
    const slug = obbligatoria("slug");
    const t = repo.perSlug(slug);
    if (!t) throw new Error(`Tenant ${slug} inesistente`);
    if (!flag.has("ricalcola")) {
      const s = await repo.storageDi(t.id);
      if (!s) {
        console.log(`${slug}: nessun ledger ancora (il server lo calcola al primo boot del WS3, oppure --ricalcola --scrivi)`);
      } else {
        console.log(`${slug}: ${s.file} file, ${s.bytes} byte su ${s.quotaBytes} (${percentualeStorage(s.bytes, s.quotaBytes)} %), soglia avvisata ${s.sogliaAvvisata} %, ricalcolato ${s.ricalcolatoIl?.toISOString() ?? "mai"}`);
      }
      return 0;
    }
    tipo = "ricalcola_storage";
    tenantId = t.id;
    payload = schemaPayloadStorage.parse({ slug });
  } else if (sotto === "crea") {
```

(la riga di `USO` e il commento in testa allo script elencano `storage --slug=<slug> [--ricalcola] [--scrivi] [--attendi]`). `percentualeStorage` si importa da `../server/tenants/storage` — attenzione: lo script non deve importare i router; `storage.ts` importa `persistence` e `fileStorage` (leggeri), va bene.

- [ ] **Step 4: Test del comando** — in `servizio.test.ts` (pattern dei test esistenti su `eseguiComandiInAttesa`): accodare `{ tipo: "ricalcola_storage", tenantId: 2, payload: { slug: "acme" } }` con un tenant 2 istanziato e `__impostaDriverPerTest` come sopra → esito `{ tenantId: 2, bytes: …, file: … }` e comando `eseguito`. In `boot.test.ts`: `avviaRicalcoloStorageIniziale([1])` con repo in memoria → `storageDi(1)` non più null; una seconda chiamata non produce un secondo evento `storage_ricalcolato`.

- [ ] **Step 5: Eseguire**

Run: `pnpm vitest run server/tenants`; `pnpm check`; `pnpm --silent tenant storage --slug=ruffino-group` con `DATABASE_URL` del Docker (stampa «nessun ledger» o il ledger; nessun DDL: `creaSchema: false`).
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/tenants/storage.ts server/tenants/storage.test.ts server/tenants/comandi.ts server/tenants/servizio.ts server/tenants/servizio.test.ts server/tenants/boot.ts server/tenants/boot.test.ts server/_core/index.ts scripts/tenant.ts
git commit -m "feat(storage): ricalcolo del ledger per azienda come comando, pnpm tenant storage e ricalcolo iniziale dopo il listen"
```

---

### Task 5: `oauth_state` persistito per Fatture in Cloud

**Files:**
- Modify: `server/routers/fattureInCloud.ts` (`PendingFicState`/`pendingFicStates`/`issueFicOAuthState`/`consumeFicOAuthState` :177-208, `handleFicOAuthCallback` :320-362, chiamata a `issueFicOAuthState` :1233)
- Test: `server/routers/fattureInCloud.oauth.test.ts` (:109, :159 usano `issueFicOAuthState`)

**Interfaces:**
- Consumes: `emettiStateOAuth`/`consumaStateOAuth` (Task 2), `tenantIdDellaSede` (`server/tenants/contesto.ts`), `conTenant`.
- Produces:
  ```ts
  export async function issueFicOAuthState(sedeId: number, redirectUri: string, scrittura?: boolean, utenteId?: number): Promise<string>;
  export async function handleFicOAuthCallback(code: string, state: string): Promise<{ sedeId: number }>; // invariata
  ```

- [ ] **Step 1: Aggiornare i test** — in `fattureInCloud.oauth.test.ts` i due usi diventano `await issueFicOAuthState(1, redirectUri)` / `await issueFicOAuthState(…)`; aggiungere:

```ts
  it("lo state vive nel control plane, si consuma una volta e porta tenant, sede e utente", async () => {
    const state = await issueFicOAuthState(1, redirectUri, true, 7);
    const repo = getTenantRepository();
    expect(await repo.consumaStateOAuth(state, "fic")).toMatchObject({ tenantId: 1, sedeId: 1, utenteId: 7, payload: { redirectUri, scrittura: true } });
    await expect(handleFicOAuthCallback("codice", state)).rejects.toThrow("Stato OAuth non valido o scaduto");
  });
```

(con `getTenantRepository` importata da `../tenants/repository`; il `beforeEach` del file deve chiamare `resetTenantRepositoryForTesting()` e la sede 1 deve esistere in `getSediStore()` con `tenantId: 1`, come negli altri test del file). Se il file oggi manipola `pendingFicStates` direttamente, togliere quei riferimenti.

- [ ] **Step 2: Vederli fallire** — `pnpm vitest run server/routers/fattureInCloud.oauth.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implementare** — in `fattureInCloud.ts` sostituire il blocco :177-208 con:

```ts
type PendingFicState = {
  tenantId: number;
  sedeId: number;
  redirectUri: string;
  // true quando l'utente ha avviato il collegamento chiedendo esplicitamente
  // i permessi di scrittura (fatturazione dal contratto).
  scrittura: boolean;
};

// Lo `state` anti-CSRF vive in `oauth_state` (control plane, WS3 spec §5):
// sopravvive a un deploy fra l'avvio e il ritorno da FiC e dice da quale
// azienda, sede e utente è partito il collegamento.
export async function issueFicOAuthState(
  sedeId: number,
  redirectUri: string,
  scrittura = false,
  utenteId = 0
): Promise<string> {
  return getTenantRepository().emettiStateOAuth({
    tipo: "fic",
    tenantId: tenantIdDellaSede(sedeId),
    sedeId,
    utenteId,
    payload: { redirectUri, scrittura },
  });
}

async function consumeFicOAuthState(state: string): Promise<PendingFicState | null> {
  const riga = await getTenantRepository().consumaStateOAuth(state, "fic");
  if (!riga || riga.sedeId == null) return null;
  return {
    tenantId: riga.tenantId,
    sedeId: riga.sedeId,
    redirectUri: String(riga.payload.redirectUri ?? ""),
    scrittura: riga.payload.scrittura === true,
  };
}
```

`handleFicOAuthCallback`: `const pending = await consumeFicOAuthState(state);` e il corpo gira in `conTenant(pending.tenantId, async () => { … })` (il tenant lo dice lo state, non la sede: è l'azienda da cui è partito il click; `conTenantDellaSede` resta importato solo se lo usa altro codice del file). Alla riga :1233: `const state = await issueFicOAuthState(ctx.sedeId ?? DEFAULT_SEDE_ID, redirectUri, scrittura, Number((ctx.user as any)?.id ?? 0));`. Import: `getTenantRepository` da `../tenants/repository`, `tenantIdDellaSede` da `../tenants/contesto`, `conTenant` da `../tenants/contestoCorrente`.

- [ ] **Step 4: Eseguire** — `pnpm vitest run server/routers/fattureInCloud.oauth.test.ts server/routers/fattureInCloud.test.ts server/tenants/confine.test.ts`; `pnpm check`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routers/fattureInCloud.ts server/routers/fattureInCloud.oauth.test.ts
git commit -m "feat(oauth): state OAuth di Fatture in Cloud persistito in oauth_state, legato ad azienda, sede e utente"
```

---

### Task 6: Backup per azienda — store per tenant, token cifrato, OAuth via `oauth_state`, cartella per azienda, router e callback nel contesto

**Files:**
- Modify: `server/_core/driveBackup.ts` (store :57-118, specchio su file :120-147, state :159-173, `handleOAuthCallback` :193-246, `disconnectOAuth` :248-257, `getOAuthAccessToken` :259-292, `ensureOAuthRoot` :294-311, `checkBackupRoot` :316-345, `runBackup` :1079-1136 solo per `running`/ripieghi, `backupStatus` :1201-1222)
- Modify: `server/routers/backup.ts` (`oauthStartUrl`), `server/_core/index.ts:349-362` (callback Drive)
- Modify: `server/_core/storeGlobali.test.ts` (quattro store), `server/tenants/verifica.ts:64,96-102` e `server/tenants/verifica.confine.test.ts` (`backup_*` per tenant senza sede diretta)
- Test: `server/_core/driveBackup.test.ts` (aggiornare), `server/_core/driveBackup.oauth.test.ts` (nuovo)

**Interfaces:**
- Consumes: `emettiStateOAuth`/`consumaStateOAuth`, `getTenantRepository().perId`, `encryptSecret`/`decryptSecret`/`secretBoxConfigured` (`server/_core/secretBox.ts`), `tenantCorrente`, `conTenant`, `PRODOTTO` (`@shared/brand`).
- Produces (usati dai task 7, 8):
  ```ts
  export async function issueOAuthState(utenteId: number): Promise<string>;       // nel tenant del contesto
  export async function handleOAuthCallback(code: string, state: string, redirectUri: string): Promise<void>; // consuma lo state, salva nel tenant dello state
  export async function tokenERadiceDelTenant(): Promise<{ token: string; rootId: string }>; // OAuth dell'azienda del contesto (Task 8)
  export function nomeCartellaRadice(tenantId: number): string; // 1 → "Backup CRM Ruffino"; altri → `Backup ${PRODOTTO} — ${nome}`
  export function __alCaricamentoOAuthPerTest(rows: OAuthRow[], meta: LoadMeta): void; // solo NODE_ENV=test: l'onLoad di backup_oauth
  ```

- [ ] **Step 1: Test che falliscono** — `server/_core/driveBackup.oauth.test.ts`:

```ts
// Backup per azienda (spec WS3 §4.1–§4.2): store per tenant, refresh token
// cifrato, state nel control plane, cartella radice per azienda.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __registraTenantNotoPerTest, storeDi } from "./persistence";
import { conTenant, modalitaTenantStretta } from "../tenants/contestoCorrente";
import { getTenantRepository, resetTenantRepositoryForTesting } from "../tenants/repository";
import { decryptSecret, isEncrypted } from "./secretBox";
import { __alCaricamentoOAuthPerTest, backupStatus, handleOAuthCallback, issueOAuthState, nomeCartellaRadice } from "./driveBackup";

const realFetch = global.fetch;

describe("backup per azienda", () => {
  beforeEach(async () => {
    process.env.MAIL_ENCRYPTION_KEY = "chiave-di-prova";
    process.env.GOOGLE_OAUTH_CLIENT_ID = "id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "segreto";
    delete process.env.FLAG_MULTI_AZIENDA;
    resetTenantRepositoryForTesting();
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "Ruffino Group" });
    await repo.inserisci({ id: 2, slug: "acme", nome: "Acme Infissi" });
    // Mai `__resetPersistenzaPerTest()` qui: driveBackup importa i router (via
    // tenants/giri) e il reset azzererebbe le famiglie registrate all'import.
    __registraTenantNotoPerTest(2);
    for (const t of [1, 2]) for (const nome of ["backup_oauth", "backup_config", "backup_log"]) storeDi<any>(t, nome).length = 0;
  });
  afterEach(() => {
    global.fetch = realFetch;
    resetTenantRepositoryForTesting();
    modalitaTenantStretta(false);
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  });

  it("gli store del backup sono per tenant e il token si salva cifrato nell'azienda dello state", async () => {
    global.fetch = vi.fn(async (url: any) => {
      const u = String(url);
      if (u.startsWith("https://oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "acc", refresh_token: "REFRESH-2", expires_in: 3600 }), { status: 200 });
      }
      if (u.includes("/about")) return new Response(JSON.stringify({ user: { emailAddress: "acme@example.com" } }), { status: 200 });
      throw new Error(`fetch inatteso: ${u}`);
    }) as any;
    const state = await conTenant(2, () => issueOAuthState(7));
    await handleOAuthCallback("codice", state, "https://crm/cb"); // rotta anonima: nessun contesto
    const righe2 = storeDi<any>(2, "backup_oauth");
    expect(righe2).toHaveLength(1);
    expect(righe2[0].refreshToken).toBeUndefined();
    expect(isEncrypted(righe2[0].refreshTokenCifrato)).toBe(true);
    expect(decryptSecret(righe2[0].refreshTokenCifrato)).toBe("REFRESH-2");
    expect(righe2[0].email).toBe("acme@example.com");
    expect(storeDi<any>(1, "backup_oauth")).toHaveLength(0);
    expect(conTenant(2, () => backupStatus()).oauthEmail).toBe("acme@example.com");
    expect(conTenant(1, () => backupStatus()).oauthEmail).toBeNull();
    await expect(handleOAuthCallback("codice", state, "https://crm/cb")).rejects.toThrow("Stato OAuth non valido o scaduto");
  });

  it("una riga con refreshToken in chiaro viene cifrata al caricamento (senso unico)", () => {
    // La stessa funzione che persistence passa come onLoad, chiamata a mano con
    // il blob del WS2: così la migrazione si prova senza rifare il bootstrap.
    const righe: any[] = [{ id: 1, refreshToken: "IN-CHIARO", email: "x@y", rootFolderId: null, connectedAt: new Date() }];
    __alCaricamentoOAuthPerTest(righe, { firstBoot: false, tenantId: 2 });
    expect(righe[0].refreshToken).toBeUndefined();
    expect(decryptSecret(righe[0].refreshTokenCifrato)).toBe("IN-CHIARO");
    delete process.env.MAIL_ENCRYPTION_KEY;
    const senzaChiave: any[] = [{ id: 1, refreshToken: "RESTA", email: null, rootFolderId: null, connectedAt: new Date() }];
    __alCaricamentoOAuthPerTest(senzaChiave, { firstBoot: false, tenantId: 2 });
    expect(senzaChiave[0].refreshToken).toBe("RESTA");
    process.env.MAIL_ENCRYPTION_KEY = "chiave-di-prova";
  });

  it("la cartella radice è per azienda: Ruffino Group tiene la sua", () => {
    expect(nomeCartellaRadice(1)).toBe("Backup CRM Ruffino");
    expect(nomeCartellaRadice(2)).toBe("Backup Wyndor — Acme Infissi");
  });
});
```

`__alCaricamentoOAuthPerTest` (solo `NODE_ENV=test`) espone la funzione `alCaricamentoOAuth(rows, meta)` che il modulo passa come `onLoad` di `backup_oauth`: il test la chiama a mano con un blob del WS2.

- [ ] **Step 2: Vederli fallire** — `pnpm vitest run server/_core/driveBackup.oauth.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implementare in `driveBackup.ts`**

Import nuovi: `import { conTenant, tenantCorrente } from "../tenants/contestoCorrente";`, `import { getTenantRepository } from "../tenants/repository";`, `import { TENANT_PREDEFINITO_ID } from "../tenants/costanti";`, `import { decryptSecret, encryptSecret, secretBoxConfigured } from "./secretBox";`.

Store (togliere `{ ambito: "globale" }` dai tre; `onLoad` di `backup_oauth` fa la migrazione e legge lo specchio su file):

```ts
const _configStore = persistedStore<BackupConfig>("backup_config", (rows, meta) => {
  // Per azienda (WS3): il tenant 1 tiene la riga di sempre (alias della chiave
  // nuda); le altre partono senza cartella condivisa — il loro Drive è il loro.
  if (rows.length === 0 && meta.tenantId != null && meta.tenantId !== TENANT_PREDEFINITO_ID) {
    rows.push({ id: 1, folderId: "", enabled: true });
  }
});
…
const _logStore = persistedStore<BackupLog>("backup_log", () => {});
…
type OAuthRow = {
  id: number;
  /** Cifrato con MAIL_ENCRYPTION_KEY (WS3): il campo in chiaro `refreshToken` esiste solo nei blob del WS2 e sparisce al caricamento. */
  refreshTokenCifrato: string;
  refreshToken?: string;
  email: string | null;
  rootFolderId: string | null;
  connectedAt: Date;
};

function alCaricamentoOAuth(rows: OAuthRow[], meta: LoadMeta): void {
  const tenantId = meta.tenantId ?? TENANT_PREDEFINITO_ID;
  if (rows.length === 0) caricaOAuthDaFile(rows, tenantId);
  // Migrazione a senso unico (spec §4.2, §11): un rollback al codice precedente
  // non rilegge il token cifrato e il Drive va ricollegato — è scritto nel runbook.
  for (const r of rows) {
    if (r.refreshToken && !r.refreshTokenCifrato) {
      if (!secretBoxConfigured()) {
        console.warn(`[backup] tenant ${tenantId}: MAIL_ENCRYPTION_KEY assente, il refresh token resta in chiaro`);
        continue;
      }
      r.refreshTokenCifrato = encryptSecret(r.refreshToken);
      delete r.refreshToken;
      // `save()` del Proxy salva l'istanza del tenant NEL CONTESTO, e il
      // caricamento gira fuori da ogni contesto: si dichiara il tenant.
      conTenant(tenantId, () => _oauthStore.save());
      salvaOAuthSuFile(rows, tenantId);
    }
  }
}
const _oauthStore = persistedStore<OAuthRow>("backup_oauth", alCaricamentoOAuth);
export function __alCaricamentoOAuthPerTest(rows: OAuthRow[], meta: LoadMeta): void {
  if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY_CARICAMENTO_OAUTH");
  alCaricamentoOAuth(rows, meta);
}
```

(`LoadMeta` si importa da `./persistence`. `persistedStore` accetta la callback dichiarata prima: la costante `_oauthStore` è in TDZ dentro `alCaricamentoOAuth` solo finché il modulo non è valutato, e `onLoad` gira dopo, al bootstrap.)

Specchio su file per azienda (il tenant 1 conserva `data/backup-oauth.json`, che esiste già in produzione):

```ts
function fileOAuth(tenantId: number): string {
  return path.join(process.cwd(), "data", tenantId === TENANT_PREDEFINITO_ID ? "backup-oauth.json" : `backup-oauth-${tenantId}.json`);
}
function salvaOAuthSuFile(rows: OAuthRow[], tenantId: number): void { … come saveOAuthFile, su fileOAuth(tenantId), con rows[0] (già cifrata) … }
function caricaOAuthDaFile(rows: OAuthRow[], tenantId: number): void { … come loadOAuthFile: accetta sia `refreshTokenCifrato` sia il vecchio `refreshToken` (che la migrazione sopra cifrerà) … }
```

Il `setTimeout(loadOAuthFile, 0)` di modulo sparisce (l'`onLoad` copre tutti i tenant). `saveOAuthFile()`/`OAUTH_FILE` vengono sostituite ovunque da `salvaOAuthSuFile(oauthRows, tenantObbligatorio())` / `fileOAuth(tenantObbligatorio())`.

Tenant corrente e cache dei token per azienda:

```ts
function tenantObbligatorio(): number {
  const t = tenantCorrente();
  if (t == null) throw new Error("[backup] operazione senza tenant nel contesto");
  return t;
}
const oauthCachedToken = new Map<number, { token: string; expiresAt: number }>();
const running = new Set<number>();
```

(`getOAuthAccessToken` legge/scrive `oauthCachedToken.get/set(tenantObbligatorio())` e usa `decryptSecret(row.refreshTokenCifrato)` — se la riga ha ancora `refreshToken` in chiaro (chiave assente) usa quello; `disconnectOAuth` cancella la voce della mappa e il file dell'azienda; `runBackup` usa `running.has/add/delete(tenantObbligatorio())`, e `backupStatus().inCorso` idem.)

State e callback:

```ts
export async function issueOAuthState(utenteId: number): Promise<string> {
  return getTenantRepository().emettiStateOAuth({ tipo: "gdrive", tenantId: tenantObbligatorio(), sedeId: null, utenteId, payload: {} });
}

export async function handleOAuthCallback(code: string, state: string, redirectUri: string): Promise<void> {
  const riga = await getTenantRepository().consumaStateOAuth(state, "gdrive");
  if (!riga) throw new Error("Stato OAuth non valido o scaduto");
  const client = oauthClientFromEnv();
  if (!client) throw new Error("Client OAuth non configurato");
  … scambio del codice e lettura dell'email come oggi …
  // La rotta è anonima: il tenant lo dice lo state, e da qui in giù si scrive
  // nell'archivio di quell'azienda.
  conTenant(riga.tenantId, () => {
    oauthRows.length = 0;
    oauthRows.push({ id: 1, refreshTokenCifrato: encryptSecret(j.refresh_token), email, rootFolderId: null, connectedAt: new Date() });
    oauthCachedToken.delete(riga.tenantId);
    _oauthStore.save();
    salvaOAuthSuFile(oauthRows, riga.tenantId);
  });
}
```

Cartella radice:

```ts
export function nomeCartellaRadice(tenantId: number): string {
  if (tenantId === TENANT_PREDEFINITO_ID) return "Backup CRM Ruffino";
  const nome = getTenantRepository().perId(tenantId)?.nome ?? `azienda ${tenantId}`;
  return `Backup ${PRODOTTO} — ${nome}`;
}

async function ensureOAuthRoot(token: string): Promise<string> {
  const tenantId = tenantObbligatorio();
  const row = oauthRows[0];
  if (!row) throw new Error("Account Google non collegato");
  if (row.rootFolderId) { … verifica come oggi … }
  // Il nome della cartella del tenant 1 è la chiave con cui si ritrovano i
  // backup esistenti (driveBackup.brand.test.ts): non si rinomina.
  const id =
    tenantId === TENANT_PREDEFINITO_ID
      ? await driveCreateFolder(token, "Backup CRM Ruffino", "root")
      : await driveCreateFolder(token, nomeCartellaRadice(tenantId), "root");
  row.rootFolderId = id;
  _oauthStore.save();
  salvaOAuthSuFile(oauthRows, tenantId);
  return id;
}

export async function tokenERadiceDelTenant(): Promise<{ token: string; rootId: string }> {
  const token = await getOAuthAccessToken();
  return { token, rootId: await ensureOAuthRoot(token) };
}
```

`runBackup`: i ripieghi al service account e al disco locale valgono SOLO per il tenant 1 (per le altre aziende il Drive è il loro: senza OAuth il backup fallisce con `Account Google non collegato` nel log):

```ts
    const tenantId = tenantObbligatorio();
    const oauthReady = oauthClientFromEnv() && oauthRows.length > 0;
    const sa = tenantId === TENANT_PREDEFINITO_ID ? loadServiceAccount() : null;
    if (oauthReady) { … } else if (sa) { … } else if (tenantId === TENANT_PREDEFINITO_ID) { await writeLocal(rootName, files); log.target = "locale"; } else { throw new Error("Account Google non collegato: collega il Drive dell'azienda da Integrazioni → Backup"); }
```

`backupStatus()`: `serviceAccountEmail` e `mode: "service_account"` solo per il tenant 1.

`routers/backup.ts`: `oauthStartUrl: adminProcedure.mutation(async ({ ctx }) => { … const url = buildAuthUrl(redirectUri, await issueOAuthState(Number((ctx.user as any)?.id ?? 0))); … })`. Le altre procedure non cambiano: i Proxy risolvono l'azienda della sessione. `index.ts:349-362`: invariato nella forma (`handleOAuthCallback` ora consuma lo state e dichiara il tenant da sé); il messaggio di log resta senza `state`.

Store globali: `storeGlobali.test.ts` `ATTESI = ["platform_feature_flag_audit", "platform_feature_flags", "sedi", "utenti"]` e il titolo «esattamente quattro»; `verifica.ts`: `FAMIGLIE_GLOBALI = new Set(["sedi", "utenti"])`, `backup_config`/`backup_log`/`backup_oauth` in `FAMIGLIE_SENZA_SEDE_DIRETTA` (commento: per tenant dal WS3, nessun `sedeId`); `verifica.confine.test.ts`: la mappa dei campi sede resta `"nessuna"` per i tre, e le attese degli insiemi seguono i sorgenti. `driveBackup.test.ts`: dove usa `storeDi(1, "backup_*")` o assume store globali, adeguare al per-tenant (`conTenant(1, …)` intorno alle chiamate che leggono config/log).

- [ ] **Step 4: Eseguire** — `pnpm vitest run server/_core/driveBackup.oauth.test.ts server/_core/driveBackup.test.ts server/_core/driveBackup.brand.test.ts server/_core/storeGlobali.test.ts server/tenants/verifica.confine.test.ts server/tenants/verifica.test.ts server/_core/persistence.tenant.test.ts server/routers/backup.test.ts`; `pnpm check`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/_core/driveBackup.ts server/_core/driveBackup.oauth.test.ts server/_core/driveBackup.test.ts server/routers/backup.ts server/_core/index.ts server/_core/storeGlobali.test.ts server/tenants/verifica.ts server/tenants/verifica.confine.test.ts
git commit -m "feat(backup): store per azienda, refresh token Drive cifrato, state in oauth_state, cartella radice per azienda"
```

---

### Task 7: Backup per azienda — albero della sola azienda, scheduler per tenant, `Utenti.json` filtrato

**Files:**
- Modify: `server/_core/driveBackup.ts` (`snapshotByKey` :793-797, `buildBackupTree` :835-1027, `backupNotturnoConRitentativi`/`startBackupScheduler` :1160-1199)
- Test: `server/_core/driveBackup.test.ts`

**Interfaces:**
- Consumes: `getAllStoreSnapshots()` (`{ key, items, nome, tenantId }`), `sediDelTenant` (`server/routers/sedi.ts:91`), `presidioDi` (`server/tenants/regole.ts:96`), `perOgniTenantAttivo` (`server/tenants/giri.ts`).
- Produces: `buildBackupTree()` invariata nella firma, ma produce l'azienda del contesto; `startBackupScheduler()` invariata.

- [ ] **Step 1: Test che falliscono** — in `driveBackup.test.ts` (riusando `__registraTenantNotoPerTest`, `storeDi`, `getSediStore`, `modalitaTenantStretta` già importati lì):

```ts
  it("buildBackupTree produce solo l'azienda del contesto: database/, sedi e utenti filtrati, nomi degli store senza prefisso", async () => {
    // sedi 10 (tenant 1) e 20 (tenant 2); utenti 1 (tenant 1) e 2 (tenant 2).
    // Import in più per questo test: `getUtentiStore` da ../routers/utenti,
    // `conTenant` da ../tenants/contestoCorrente; tenant 2 registrato con
    // `__registraTenantNotoPerTest(2)` e `storeDi(2, "clienti").length = 0` prima del push.
    __registraTenantNotoPerTest(2);
    storeDi<any>(2, "clienti").length = 0;
    getSediStore().length = 0;
    getSediStore().push({ id: 10, tenantId: 1, nome: "Sarzana", attiva: true } as any, { id: 20, tenantId: 2, nome: "Acme HQ", attiva: true } as any);
    const utenti = getUtentiStore();
    utenti.length = 0;
    utenti.push({ id: 1, tenantId: 1, email: "a@1", passwordHash: "x", sediIds: [10] } as any, { id: 2, tenantId: 2, email: "b@2", passwordHash: "x", sediIds: [20] } as any);
    storeDi<any>(2, "clienti").push({ id: 5, tenantId: 2, sedeId: 20, nome: "Cliente", cognome: "Due" });
    const albero = await conTenant(2, () => buildBackupTree());
    const nomi = albero.files.map(f => [...f.segments, f.name].join("/"));
    expect(nomi).toContain("database/clienti.json");
    expect(nomi.some(n => n.startsWith("database/tenant:"))).toBe(false);
    expect(nomi).not.toContain("database/backup_log.json");
    expect(nomi.some(n => n.startsWith("Sede Sarzana/"))).toBe(false);
    const utentiJson = JSON.parse(albero.files.find(f => f.name === "Utenti.json" && f.segments[0] === "Sede Acme HQ")!.data.toString("utf8"));
    expect(utentiJson.map((u: any) => u.id)).toEqual([2]);
    expect(JSON.stringify(utentiJson)).not.toContain("passwordHash");
    const dbUtenti = JSON.parse(albero.files.find(f => f.segments[0] === "database" && f.name === "utenti.json")!.data.toString("utf8"));
    expect(dbUtenti.map((u: any) => u.id)).toEqual([2]);
    const dbSedi = JSON.parse(albero.files.find(f => f.segments[0] === "database" && f.name === "sedi.json")!.data.toString("utf8"));
    expect(dbSedi.map((s: any) => s.id)).toEqual([20]);
    const clientiDb = JSON.parse(albero.files.find(f => f.segments[0] === "database" && f.name === "clienti.json")!.data.toString("utf8"));
    expect(clientiDb.map((c: any) => c.id)).toEqual([5]);
  });

  it("il giro notturno passa da perOgniTenantAttivo: un'azienda che fallisce non ferma le altre", async () => {
    // registrare due tenant attivi nel repository, far fallire runBackup del tenant 2
    // (nessun OAuth, nessun service account → lancia) e verificare che il log del
    // tenant 1 riporti un backup `locale` riuscito e quello del tenant 2 un errore
    // «Account Google non collegato», con `__eseguiGiroNotturnoPerTest()` esportata
    // da driveBackup.ts (solo NODE_ENV=test) che chiama la stessa funzione del timer.
  });
```

(Scrivere per esteso il secondo test con `getTenantRepository().inserisci` per i tenant 1 e 2, `__eseguiGiroNotturnoPerTest()`, `conTenant(1, () => backupLog(1))` e `conTenant(2, () => backupLog(1))`; ridurre `ATTESA_RITENTATIVO_MS` a 0 nei test tramite `__impostaAttesaRitentativoPerTest(0)` o usare `vi.useFakeTimers` e `vi.runAllTimersAsync`.)

- [ ] **Step 2: Vederli fallire** — `pnpm vitest run server/_core/driveBackup.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implementare**

```ts
/** Gli store dell'azienda del contesto, per NOME (mai la chiave `tenant:n:…`), con le famiglie globali filtrate. */
function snapshotDelTenant(tenantId: number): Record<string, any[]> {
  const out: Record<string, any[]> = {};
  const sediMie = new Set(sediDelTenant(tenantId).map(s => s.id));
  for (const s of getAllStoreSnapshots()) {
    if (s.tenantId === tenantId) { out[s.nome] = s.items; continue; }
    if (s.tenantId != null) continue; // istanza di un'altra azienda
    switch (s.nome) {
      case "sedi": out.sedi = s.items.filter((x: any) => (x.tenantId ?? TENANT_PREDEFINITO_ID) === tenantId); break;
      case "utenti": out.utenti = s.items.filter((u: any) => presidioDi(u).tenantId === tenantId); break;
      case "platform_feature_flags":
      case "platform_feature_flag_audit": out[s.nome] = s.items.filter((x: any) => sediMie.has(x.sedeId)); break;
      default: break; // nessun'altra famiglia globale (storeGlobali.test.ts)
    }
  }
  return out;
}
```

`buildBackupTree()`: `const tenantId = tenantObbligatorio(); const stores = snapshotDelTenant(tenantId);`; il dump `database/` itera `stores` (`backup_log` escluso); `const sedi = stores.sedi ?? []`, `const utenti = (stores.utenti ?? []).map(sanitizeUtente)`; il ripiego `[{ id: 1, nome: "Principale" }]` solo se `tenantId === TENANT_PREDEFINITO_ID`; `di(sede, nome)` diventa `stores[nome] ?? []` (già dell'azienda). `tenantIdDellaSede` e `chiaveStore` non servono più qui (togliere gli import se restano inutilizzati). `conTenantDellaSede(sede.id, …)` intorno a ogni sede resta.

Scheduler:

```ts
async function giroNotturno(): Promise<void> {
  await perOgniTenantAttivo("backup", async () => {
    if (!getConfig().enabled) return;
    await backupNotturnoConRitentativi();
  });
}
export function __eseguiGiroNotturnoPerTest(): Promise<void> {
  if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY_GIRO_NOTTURNO");
  return giroNotturno();
}
```

e in `startBackupScheduler` il timer chiama `await giroNotturno()` (senza il `getConfig().enabled` fuori contesto). `perOgniTenantAttivo` importato da `../tenants/giri` (già importato `conTenantDellaSede` da lì).

- [ ] **Step 4: Eseguire** — `pnpm vitest run server/_core/driveBackup.test.ts server/_core/driveBackup.oauth.test.ts server/_core/driveBackup.brand.test.ts`; `pnpm check`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/_core/driveBackup.ts server/_core/driveBackup.test.ts
git commit -m "feat(backup): albero della sola azienda del contesto, Utenti.json per azienda, giro notturno per tenant"
```

---

### Task 8: Ripristino degli archivi — `sostituisciStore`, `ripristinaArchivi`, comando `ripristina_archivi`, `pnpm tenant ripristina`

**Files:**
- Modify: `server/_core/persistence.ts` (nuova `sostituisciStore`), `server/_core/driveBackup.ts` (nuove `driveElencaFigli`, `driveScaricaJson` esportate), `server/tenants/comandi.ts`, `server/tenants/servizio.ts`, `server/tenants/tipi.ts` (se serve), `scripts/tenant.ts`
- Create: `server/tenants/ripristino.ts`
- Test: `server/tenants/ripristino.test.ts` (memoria, Drive finto), `server/tenants/ripristino.pg.test.ts` (Postgres: `sostituisciStore` scrive davvero `kv_store`), `server/_core/persistence.tenant.test.ts` (`sostituisciStore`)

**Interfaces:**
- Consumes: `tokenERadiceDelTenant`, `driveFetch` (Task 6), `sospendi`/`riattiva` (`servizio.ts`), `storeDi`, `getAllStoreSnapshots`, `sediDelTenant`.
- Produces:
  ```ts
  // persistence.ts
  export async function sostituisciStore(tenantId: number, nome: string, items: unknown[]): Promise<void>;
  // driveBackup.ts
  export async function driveElencaFigli(token: string, parentId: string, filtro?: { nome?: string; soloCartelle?: boolean }): Promise<Array<{ id: string; name: string; mimeType: string }>>;
  export async function driveScaricaJson(token: string, fileId: string): Promise<unknown>;
  // ripristino.ts
  export type DriveRipristino = {
    cartellaBackup(riferimento: string): Promise<{ id: string; nome: string } | null>; // "AAAA-MM-GG" → `Backup CRM <data>` sotto la radice; altrimenti id
    dumpDisponibili(cartellaId: string): Promise<Array<{ nome: string; scarica: () => Promise<unknown> }>>; // i <nome>.json di database/
  };
  export function driveRipristinoReale(): DriveRipristino;
  export const STORE_ESCLUSI_DAL_RIPRISTINO = new Set(["backup_config", "backup_oauth", "backup_log"]);
  export type EsitoRipristino = { dryRun: boolean; backup: { id: string; nome: string }; store: Array<{ nome: string; prima: number; dopo: number; sostituito: boolean }>; anomalie: string[] };
  export function validaDump(nome: string, dati: unknown, tenantId: number, sediAmmesse: Set<number>): { items: any[]; anomalie: string[] };
  export async function ripristinaArchivi(opzioni: { tenantId: number; backup: string; solo: string[] | null; scrivi: boolean; attore: Attore }, drive?: DriveRipristino): Promise<EsitoRipristino>;
  // comandi.ts
  export const schemaPayloadRipristino = z.object({ slug, backup: testo(120), solo: z.array(z.string().trim().min(1)).nullable().optional(), scrivi: z.boolean(), ancheTenant1: z.boolean().optional() });
  ```

- [ ] **Step 1: Test di `sostituisciStore`** — in `persistence.tenant.test.ts`:

```ts
  it("sostituisciStore rimpiazza gli item dell'istanza, alza il contatore degli id e rifiuta globali e sconosciuti", async () => {
    const s = persistedStore<any>("da_ripristinare");
    await bootstrapAll({ tenantIds: [1, 2] });
    tenant = 2;
    s.items.push({ id: 3 });
    await sostituisciStore(2, "da_ripristinare", [{ id: 10 }, { id: 11 }]);
    expect(storeDi(2, "da_ripristinare")).toEqual([{ id: 10 }, { id: 11 }]);
    expect(s.prossimoId()).toBe(12);
    expect(storeDi(1, "da_ripristinare")).toEqual([]);
    await expect(sostituisciStore(2, "sedi", [])).rejects.toThrow(/globale/);
    await expect(sostituisciStore(2, "inesistente", [])).rejects.toThrow(/sconosciuto/);
  });
```

(`sedi` è registrato dal router; se il test non importa i router, registrare `persistedStore("globale_x", () => {}, { ambito: "globale" })` e usare quello.)

- [ ] **Step 2: Implementare `sostituisciStore`** in `persistence.ts` (accanto a `storeDi`):

```ts
/**
 * Ripristino (WS3 §4.4): rimpiazza gli item dell'istanza di un tenant con
 * quelli di un dump e scrive SUBITO il blob, fuori dal debounce. Non riesegue
 * `onLoad`. Solo famiglie per tenant già caricate: le globali (sedi, utenti)
 * non si ripristinano per azienda.
 */
export async function sostituisciStore(tenantId: number, nome: string, items: unknown[]): Promise<void> {
  const f = famiglie.get(nome);
  if (!f) throw new Error(`[persistence] store ${nome} sconosciuto`);
  if (f.ambito === "globale") throw new Error(`[persistence] store ${nome} è globale: non si ripristina per tenant`);
  const entry = f.istanze.get(tenantId);
  if (!entry) throw new Error(`[persistence] store ${nome} non istanziato per il tenant ${tenantId}`);
  if (!entry.loaded) throw new Error(`[persistence] store ${entry.key} non ancora caricato`);
  entry.items.length = 0;
  for (const r of items) entry.items.push(r);
  for (const r of entry.items) {
    const id = (r as any)?.id;
    if (typeof id === "number" && id > f.maxId) f.maxId = id;
  }
  const t = saveTimers.get(entry.key);
  if (t) { clearTimeout(t); saveTimers.delete(entry.key); }
  await flushSave(entry.key);
}
```

- [ ] **Step 3: Test del ripristino** — `server/tenants/ripristino.test.ts`:

```ts
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootstrapAll, persistedStore, storeDi } from "../_core/persistence";
import { getSediStore } from "../routers/sedi";
import { getTenantRepository, resetTenantRepositoryForTesting } from "./repository";
import { ripristinaArchivi, validaDump, type DriveRipristino } from "./ripristino";

// Registrate all'import, una volta sola; `bootstrapAll` (in memoria) le marca
// `loaded`, condizione di `sostituisciStore`. Mai `__resetPersistenzaPerTest()`
// qui: azzererebbe anche `sedi` (registrata da ../routers/sedi).
persistedStore<any>("rip_clienti");
persistedStore<any>("rip_commesse");

function driveFinto(dump: Record<string, unknown>): DriveRipristino {
  return {
    async cartellaBackup(rif) { return rif === "2026-09-07" || rif === "idcartella" ? { id: "idcartella", nome: "Backup CRM 2026-09-07" } : null; },
    async dumpDisponibili() { return Object.entries(dump).map(([nome, dati]) => ({ nome, scarica: async () => dati })); },
  };
}

describe("ripristino degli archivi", () => {
  beforeAll(() => bootstrapAll({ tenantIds: [1, 2] }));
  beforeEach(async () => {
    delete process.env.FLAG_MULTI_AZIENDA;
    resetTenantRepositoryForTesting();
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "Ruffino Group" });
    await repo.inserisci({ id: 2, slug: "acme", nome: "Acme" });
    getSediStore().length = 0;
    getSediStore().push({ id: 20, tenantId: 2, nome: "HQ", attiva: true } as any);
    storeDi<any>(2, "rip_clienti").length = 0;
    storeDi<any>(2, "rip_commesse").length = 0;
    storeDi<any>(2, "rip_clienti").push({ id: 1, tenantId: 2, sedeId: 20 }, { id: 2, tenantId: 2, sedeId: 20 });
  });
  afterEach(() => { resetTenantRepositoryForTesting(); getSediStore().length = 0; });

  it("validaDump: array di record con id unici, sede dell'azienda, tenant dell'azienda", () => {
    expect(validaDump("x", "no", 2, new Set([20])).anomalie).toEqual(["x: il dump non è un array"]);
    const v = validaDump("x", [{ id: 1, sedeId: 20 }, { id: 1, sedeId: 99 }, { id: "3" }, { id: 4, tenantId: 1 }], 2, new Set([20]));
    expect(v.anomalie).toEqual(["x: id duplicato 1", "x: record 1 con sedeId 99 non dell'azienda", "x: record senza id numerico (posizione 2)", "x: record 4 con tenantId 1 di un'altra azienda"]);
  });

  it("in prova confronta i conteggi e non tocca nulla; con scrivi sostituisce, sospende e riattiva, registra l'evento", async () => {
    const drive = driveFinto({ rip_clienti: [{ id: 7, tenantId: 2, sedeId: 20 }], backup_oauth: [{ id: 1 }], altro: [] });
    const prova = await ripristinaArchivi({ tenantId: 2, backup: "2026-09-07", solo: null, scrivi: false, attore: { tipo: "script", nome: "test" } }, drive);
    expect(prova.dryRun).toBe(true);
    expect(prova.store).toEqual([{ nome: "rip_clienti", prima: 2, dopo: 1, sostituito: false }]);
    expect(prova.anomalie).toEqual(["backup_oauth: escluso dal ripristino", "altro: non è uno store per azienda"]);
    expect(storeDi(2, "rip_clienti")).toHaveLength(2);
    const vero = await ripristinaArchivi({ tenantId: 2, backup: "idcartella", solo: ["rip_clienti"], scrivi: true, attore: { tipo: "script", nome: "test" } }, drive);
    expect(vero.store).toEqual([{ nome: "rip_clienti", prima: 2, dopo: 1, sostituito: true }]);
    expect(storeDi(2, "rip_clienti")).toEqual([{ id: 7, tenantId: 2, sedeId: 20 }]);
    const repo = getTenantRepository();
    expect(repo.perId(2)?.stato).toBe("attivo");
    expect((await repo.eventi(2)).map(e => e.tipo)).toEqual(["sospeso", "riattivato", "archivi_ripristinati"]);
  });

  it("backup inesistente, --solo sconosciuto, dump non valido: errore senza toccare gli archivi", async () => {
    const attore = { tipo: "script" as const, nome: "test" };
    await expect(ripristinaArchivi({ tenantId: 2, backup: "2020-01-01", solo: null, scrivi: true, attore }, driveFinto({}))).rejects.toThrow("Backup 2020-01-01 non trovato sul Drive dell'azienda");
    await expect(ripristinaArchivi({ tenantId: 2, backup: "2026-09-07", solo: ["boh"], scrivi: true, attore }, driveFinto({ rip_clienti: [] }))).rejects.toThrow("Store richiesti assenti dal backup: boh");
    await expect(ripristinaArchivi({ tenantId: 2, backup: "2026-09-07", solo: null, scrivi: true, attore }, driveFinto({ rip_clienti: [{ id: 1, sedeId: 99 }] }))).rejects.toThrow("Dump non valido");
    expect(storeDi(2, "rip_clienti")).toHaveLength(2);
    expect(getTenantRepository().perId(2)?.stato).toBe("attivo");
  });

  it("il tenant 1 richiede ancheTenant1", async () => {
    await expect(ripristinaArchivi({ tenantId: 1, backup: "2026-09-07", solo: null, scrivi: false, attore: { tipo: "script", nome: "test" } }, driveFinto({}))).rejects.toThrow("Il tenant 1 si ripristina solo con --anche-tenant-1");
  });
});
```

(`ancheTenant1` arriva nelle opzioni: `opzioni.ancheTenant1?: boolean`.)

- [ ] **Step 4: Implementare `server/tenants/ripristino.ts`**

```ts
// server/tenants/ripristino.ts
// Ripristino degli archivi di un'azienda dal SUO Drive (WS3, spec §4.4).
// Comando del control plane: lo esegue il server, unico scrittore. Gli
// archivi si sostituiscono interi (nessun merge); i file non si ricaricano.
import { getAllStoreSnapshots, sostituisciStore, storeDi } from "../_core/persistence";
import { driveElencaFigli, driveScaricaJson, tokenERadiceDelTenant } from "../_core/driveBackup";
import { sediDelTenant } from "../routers/sedi";
import { conTenant } from "./contestoCorrente";
import { TENANT_PREDEFINITO_ID } from "./costanti";
import { getTenantRepository } from "./repository";
import { riattiva, sospendi } from "./servizio";
import { attoreTesto, type Attore } from "./tipi";

export const STORE_ESCLUSI_DAL_RIPRISTINO = new Set(["backup_config", "backup_oauth", "backup_log"]);
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;

export type DriveRipristino = { … come nelle Interfaces … };
export type EsitoRipristino = { … };

export function driveRipristinoReale(): DriveRipristino {
  return {
    async cartellaBackup(riferimento) {
      const { token, rootId } = await tokenERadiceDelTenant();
      if (RE_DATA.test(riferimento)) {
        const [c] = await driveElencaFigli(token, rootId, { nome: `Backup CRM ${riferimento}`, soloCartelle: true });
        return c ? { id: c.id, nome: c.name } : null;
      }
      const figli = await driveElencaFigli(token, riferimento, { nome: "database", soloCartelle: true });
      return figli.length ? { id: riferimento, nome: riferimento } : null;
    },
    async dumpDisponibili(cartellaId) {
      const { token } = await tokenERadiceDelTenant();
      const [db] = await driveElencaFigli(token, cartellaId, { nome: "database", soloCartelle: true });
      if (!db) return [];
      const file = await driveElencaFigli(token, db.id);
      return file
        .filter(f => f.name.endsWith(".json"))
        .map(f => ({ nome: f.name.slice(0, -".json".length), scarica: () => driveScaricaJson(token, f.id) }));
    },
  };
}

export function validaDump(nome, dati, tenantId, sediAmmesse) { … produce esattamente le anomalie del test … }

export async function ripristinaArchivi(opzioni, drive = driveRipristinoReale()): Promise<EsitoRipristino> {
  const { tenantId } = opzioni;
  if (tenantId === TENANT_PREDEFINITO_ID && !opzioni.ancheTenant1) throw new Error("Il tenant 1 si ripristina solo con --anche-tenant-1");
  return conTenant(tenantId, async () => {
    const cartella = await drive.cartellaBackup(opzioni.backup);
    if (!cartella) throw new Error(`Backup ${opzioni.backup} non trovato sul Drive dell'azienda`);
    const perTenant = new Set(getAllStoreSnapshots().filter(s => s.tenantId === tenantId).map(s => s.nome));
    const disponibili = await drive.dumpDisponibili(cartella.id);
    const richiesti = opzioni.solo ?? disponibili.map(d => d.nome).filter(n => perTenant.has(n) && !STORE_ESCLUSI_DAL_RIPRISTINO.has(n));
    const assenti = richiesti.filter(n => !disponibili.some(d => d.nome === n));
    if (assenti.length) throw new Error(`Store richiesti assenti dal backup: ${assenti.join(", ")}`);
    const anomalie: string[] = [];
    const daSostituire: Array<{ nome: string; items: any[] }> = [];
    const sedi = new Set(sediDelTenant(tenantId).map(s => s.id));
    for (const d of disponibili) {
      const scelto = richiesti.includes(d.nome);
      if (STORE_ESCLUSI_DAL_RIPRISTINO.has(d.nome)) { if (!opzioni.solo || scelto) anomalie.push(`${d.nome}: escluso dal ripristino`); continue; }
      if (!perTenant.has(d.nome)) { if (!opzioni.solo || scelto) anomalie.push(`${d.nome}: non è uno store per azienda`); continue; }
      if (!scelto) continue;
      const v = validaDump(d.nome, await d.scarica(), tenantId, sedi);
      anomalie.push(...v.anomalie);
      daSostituire.push({ nome: d.nome, items: v.items });
    }
    const invalidi = anomalie.filter(a => !a.endsWith("escluso dal ripristino") && !a.endsWith("non è uno store per azienda"));
    const esito: EsitoRipristino = { dryRun: !opzioni.scrivi, backup: cartella, store: daSostituire.map(s => ({ nome: s.nome, prima: storeDi(tenantId, s.nome).length, dopo: s.items.length, sostituito: false })), anomalie };
    if (!opzioni.scrivi) return esito;
    if (invalidi.length) throw new Error(`Dump non valido: ${invalidi.join("; ")}`);
    const repo = getTenantRepository();
    const eraAttivo = repo.perId(tenantId)?.stato === "attivo";
    if (eraAttivo) await sospendi(tenantId, "ripristino archivi in corso", opzioni.attore);
    const sostituiti: string[] = [];
    try {
      for (const s of daSostituire) {
        await sostituisciStore(tenantId, s.nome, s.items);
        sostituiti.push(s.nome);
        esito.store.find(x => x.nome === s.nome)!.sostituito = true;
      }
    } catch (e) {
      throw new Error(`Ripristino interrotto dopo ${sostituiti.join(", ") || "nessuno store"}: ${e instanceof Error ? e.message : String(e)} (azienda lasciata sospesa)`);
    }
    if (eraAttivo) await riattiva(tenantId, "ripristino archivi completato", opzioni.attore);
    await repo.registraEvento({ tenantId, tipo: "archivi_ripristinati", attore: attoreTesto(opzioni.attore), dettagli: { backup: cartella, store: esito.store.map(({ nome, prima, dopo }) => ({ nome, prima, dopo })) } });
    return esito;
  });
}
```

`driveBackup.ts`:

```ts
export async function driveElencaFigli(token, parentId, filtro = {}) {
  const parti = [`'${parentId}' in parents`, "trashed = false"];
  if (filtro.nome) parti.push(`name = '${filtro.nome.replace(/'/g, "\\'")}'`);
  if (filtro.soloCartelle) parti.push("mimeType = 'application/vnd.google-apps.folder'");
  const q = encodeURIComponent(parti.join(" and "));
  const res = await driveFetch(`${DRIVE}/files?q=${q}&fields=files(id,name,mimeType)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`, { headers: { authorization: `Bearer ${token}` } }, "Elenco di una cartella su Drive");
  return (((await res.json()) as any).files ?? []) as Array<{ id: string; name: string; mimeType: string }>;
}
export async function driveScaricaJson(token, fileId) {
  const res = await driveFetch(`${DRIVE}/files/${fileId}?alt=media&supportsAllDrives=true`, { headers: { authorization: `Bearer ${token}` } }, "Scaricamento di un dump da Drive");
  return res.json();
}
```

`comandi.ts`: `schemaPayloadRipristino` (Interfaces). `servizio.ts`:

```ts
      case "ripristina_archivi": {
        const p = schemaPayloadRipristino.parse(comando.payload);
        const id = comando.tenantId ?? tenantDaSlug(p.slug).id;
        const esito = await ripristinaArchivi({ tenantId: id, backup: p.backup, solo: p.solo ?? null, scrivi: p.scrivi, ancheTenant1: p.ancheTenant1, attore });
        return { tenantId: id, ...esito };
      }
```

(`ripristino.ts` importa `servizio.ts` e viceversa: per evitare il ciclo, `servizio.ts` importa `ripristinaArchivi` con `await import("./ripristino")` dentro il `case`.)

`scripts/tenant.ts`, sottocomando `ripristina`:

```ts
  } else if (sotto === "ripristina") {
    const slug = obbligatoria("slug");
    const t = repo.perSlug(slug);
    if (!t) throw new Error(`Tenant ${slug} inesistente`);
    if (flag.has("prova") === flag.has("scrivi")) throw new Error("Indica --prova (solo lettura da Drive) oppure --scrivi (ripristino vero)");
    if (t.id === TENANT_PREDEFINITO_ID && !flag.has("anche-tenant-1")) {
      throw new Error("Ripristinare il tenant 1 sostituisce gli archivi di Ruffino Group: aggiungi --anche-tenant-1 per confermare.");
    }
    tipo = "ripristina_archivi";
    tenantId = t.id;
    payload = schemaPayloadRipristino.parse({
      slug, backup: obbligatoria("backup"),
      solo: valori.solo ? valori.solo.split(",").map(s => s.trim()).filter(Boolean) : null,
      scrivi: flag.has("scrivi"), ancheTenant1: flag.has("anche-tenant-1"),
    });
  }
```

Per questo sottocomando il comando si accoda anche con `--prova` (la prova la fa il server): dopo `console.log(anteprima(...))` il controllo `if (!flag.has("scrivi"))` diventa `if (!flag.has("scrivi") && !(sotto === "ripristina" && flag.has("prova")))`. `USO` e il commento in testa elencano `ripristina --slug=<slug> --backup=<AAAA-MM-GG|folderId> [--solo=a,b] --prova|--scrivi [--anche-tenant-1] [--attendi]`. `attendi()` stampa già l'esito JSON del comando.

- [ ] **Step 5: Test Postgres** — `server/tenants/ripristino.pg.test.ts` (pattern di `repository.pg.test.ts`, lock `20260908`): con `DATABASE_URL`, `persistedStore("rip_pg")`, `bootstrapAll({ tenantIds: [1, 2] })`, `sostituisciStore(2, "rip_pg", [{ id: 5 }])`, poi `leggiBlobDaDb("tenant:2:rip_pg")` → `[{ id: 5 }]`; pulire la riga in `afterAll` (`DELETE FROM kv_store WHERE key IN ('rip_pg','tenant:2:rip_pg')`).

- [ ] **Step 6: Eseguire** — `pnpm vitest run server/tenants server/_core/persistence.tenant.test.ts server/_core/driveBackup.test.ts`; con Docker `DATABASE_URL=… pnpm vitest run server/tenants/ripristino.pg.test.ts server/tenants/repository.pg.test.ts server/tenants/tabelle.pg.test.ts --no-file-parallelism`; `pnpm check`. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/_core/persistence.ts server/_core/persistence.tenant.test.ts server/_core/driveBackup.ts server/tenants/ripristino.ts server/tenants/ripristino.test.ts server/tenants/ripristino.pg.test.ts server/tenants/comandi.ts server/tenants/servizio.ts server/tenants/servizio.test.ts scripts/tenant.ts
git commit -m "feat(tenant): ripristino degli archivi dal Drive dell'azienda come comando, con prova, sospensione e sostituisciStore"
```

---

### Task 9: Webhook WhatsApp instradato per numero

**Files:**
- Modify: `server/_core/rotteAnonime.ts` (`ingestisciWebhookWhatsApp` :83-90 → `ingestisciWebhookPerNumero`), `server/_core/index.ts:283-291`
- Test: `server/_core/rotteAnonime.tenant.test.ts`

**Interfaces:**
- Consumes: `configPerPhoneNumberId`, `ingestisciWebhook` (`server/comunicazioni/whatsapp.ts:310,922`), `trovaNeiTenant`, `conTenantDellaSede`.
- Produces:
  ```ts
  export function numeriDelPayload(payload: unknown): string[]; // phone_number_id distinti, nell'ordine di apparizione
  export function payloadDelNumero(payload: any, phoneNumberId: string): any; // stesse entry/changes, solo quelle del numero
  export async function ingestisciWebhookPerNumero(payload: unknown): Promise<{ ricevuti: number; numeriSconosciuti: string[] }>;
  ```
  `mittenteWebhookWhatsApp` (la firma) resta com'è.

- [ ] **Step 1: Test che falliscono** — in `rotteAnonime.tenant.test.ts` (riusando il suo allestimento: due tenant, sedi, `configWhatsApp` per tenant, `ingestisciWebhook` osservabile):

```ts
  it("numeriDelPayload e payloadDelNumero", () => {
    const payload = { entry: [
      { id: "e1", changes: [{ field: "messages", value: { metadata: { phone_number_id: "111" }, messages: [{ id: "m1" }] } }] },
      { id: "e2", changes: [
        { field: "messages", value: { metadata: { phone_number_id: "222" }, messages: [{ id: "m2" }] } },
        { field: "messages", value: { metadata: { phone_number_id: "111" }, messages: [{ id: "m3" }] } },
      ] },
    ] };
    expect(numeriDelPayload(payload)).toEqual(["111", "222"]);
    const solo222 = payloadDelNumero(payload, "222");
    expect(solo222.entry).toHaveLength(1);
    expect(solo222.entry[0].changes).toHaveLength(1);
    expect(solo222.entry[0].changes[0].value.messages[0].id).toBe("m2");
    expect(numeriDelPayload({})).toEqual([]);
  });

  it("con lo stesso app secret due aziende ricevono ciascuna i messaggi del proprio numero; un numero sconosciuto si logga e basta", async () => {
    // configWhatsApp del tenant 1: { phoneNumberId: "111", sedeId: 10, attiva: true }
    // configWhatsApp del tenant 2: { phoneNumberId: "222", sedeId: 20, attiva: true }
    // payload con "111", "222" e "999"
    const esito = await ingestisciWebhookPerNumero(payload);
    expect(esito.ricevuti).toBe(2);
    expect(esito.numeriSconosciuti).toEqual(["999"]);
    // l'ingestione del numero 222 è avvenuta con tenantCorrente() === 2 e quella del 111 con 1
    // (spiare ingestisciWebhook via vi.spyOn sul modulo ../comunicazioni/whatsapp o verificare
    // il record nello store comunicazioni/whatsapp del tenant giusto, come fa già questo file)
  });
```

Scrivere il secondo test per esteso seguendo il modo in cui il file oggi prova `ingestisciWebhookWhatsApp` (stesso allestimento di config e stessa verifica sull'archivio di destinazione).

- [ ] **Step 2: Vederli fallire** — `pnpm vitest run server/_core/rotteAnonime.tenant.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implementare** in `rotteAnonime.ts` (al posto di `ingestisciWebhookWhatsApp`):

```ts
/** I `phone_number_id` distinti del payload, nell'ordine in cui compaiono. */
export function numeriDelPayload(payload: unknown): string[] {
  const numeri: string[] = [];
  for (const entry of (payload as any)?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const id = change?.value?.metadata?.phone_number_id;
      if (id != null && !numeri.includes(String(id))) numeri.push(String(id));
    }
  }
  return numeri;
}

/** Lo stesso payload ridotto alle entry/changes di un numero. */
export function payloadDelNumero(payload: any, phoneNumberId: string): any {
  const entry = (payload?.entry ?? [])
    .map((e: any) => ({ ...e, changes: (e?.changes ?? []).filter((c: any) => String(c?.value?.metadata?.phone_number_id ?? "") === phoneNumberId) }))
    .filter((e: any) => e.changes.length > 0);
  return { ...payload, entry };
}

/**
 * L'ingestione, DOPO la firma, azienda per azienda in base al numero (WS3
 * spec §6): con l'Embedded Signup il segreto dell'app è uno per tutte le
 * aziende, quindi la firma non dice di chi è il messaggio — lo dice il
 * `phone_number_id`, cercato in `configWhatsApp` di ogni azienda attiva.
 * Un numero che nessuna azienda segue si logga e basta: Meta non deve riprovare.
 */
export async function ingestisciWebhookPerNumero(payload: unknown): Promise<{ ricevuti: number; numeriSconosciuti: string[] }> {
  const { ingestisciWebhook, configPerPhoneNumberId } = await import("../comunicazioni/whatsapp");
  let ricevuti = 0;
  const numeriSconosciuti: string[] = [];
  for (const numero of numeriDelPayload(payload)) {
    const trovato = await trovaNeiTenant<number>("whatsapp-webhook", () => configPerPhoneNumberId(numero)?.sedeId ?? null);
    if (!trovato) {
      numeriSconosciuti.push(numero);
      console.warn(`[whatsapp-webhook] numero sconosciuto: ${numero}`);
      continue;
    }
    ricevuti += await conTenantDellaSede(trovato.valore, () => ingestisciWebhook(payloadDelNumero(payload, numero)));
  }
  return { ricevuti, numeriSconosciuti };
}
```

`MittenteWhatsApp` e `mittenteWebhookWhatsApp` restano (la firma). `index.ts`, dopo il `res.sendStatus(200)`:

```ts
          const payload = JSON.parse(raw.toString("utf8"));
          const { ricevuti } = await ingestisciWebhookPerNumero(payload);
          if (ricevuti > 0) console.log(`[whatsapp] ${ricevuti} messaggi ricevuti`);
```

(la variabile `mittente` serve ancora solo per il `403`; l'import dinamico prende `ingestisciWebhookPerNumero` al posto di `ingestisciWebhookWhatsApp`).

- [ ] **Step 4: Eseguire** — `pnpm vitest run server/_core/rotteAnonime.tenant.test.ts server/comunicazioni/whatsapp.test.ts`; `pnpm check`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/_core/rotteAnonime.ts server/_core/rotteAnonime.tenant.test.ts server/_core/index.ts
git commit -m "feat(whatsapp): webhook instradato per phone_number_id fra le aziende dopo la verifica della firma"
```

---

### Task 10: Interruttore per (worker, azienda) in `perOgniTenantAttivo`, eventi e `pnpm tenant elenco`

**Files:**
- Modify: `server/tenants/giri.ts` (`perOgniTenantAttivo` :55-66), `scripts/tenant.ts` (`elenco` :224-232)
- Test: `server/tenants/giri.test.ts`, `server/tenants/cli.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const ERRORI_PER_SOSPENDERE = 3;
  export const ATTESE_SOSPENSIONE_MIN = [15, 30, 60, 120] as const;
  export type StatoGiro = { erroriConsecutivi: number; sospesoFinoA: number; sospensioni: number }; // ms epoch
  export function statoGiro(etichetta: string, tenantId: number): StatoGiro; // {0,0,0} se mai visto
  export function __azzeraStatiGiriPerTest(): void;
  // cli.ts (puro, per `elenco`)
  export function workerSospesi(eventi: TenantEvento[], adesso?: Date): Array<{ etichetta: string; finoA: Date; errore: string }>;
  ```

- [ ] **Step 1: Test che falliscono** — in `giri.test.ts`:

```ts
  it("tre errori consecutivi sospendono l'azienda per 15, poi 30, 60, 120 minuti; il giro riuscito riarma; le altre aziende girano", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-08T10:00:00Z"), toFake: ["Date"] });
    __azzeraStatiGiriPerTest();
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "Ruffino Group" });
    await repo.inserisci({ id: 2, slug: "acme", nome: "Acme" });
    const visti: number[] = [];
    const giro = (fallisce: boolean) =>
      perOgniTenantAttivo("prova", async t => { visti.push(t); if (t === 2 && fallisce) throw new Error("boom"); });
    await giro(true); await giro(true); await giro(true);
    expect(statoGiro("prova", 2)).toMatchObject({ erroriConsecutivi: 0, sospensioni: 1 });
    expect(statoGiro("prova", 2).sospesoFinoA).toBe(Date.now() + 15 * 60_000);
    visti.length = 0;
    await giro(true);
    expect(visti).toEqual([1]); // il tenant 2 è saltato
    vi.setSystemTime(Date.now() + 16 * 60_000);
    await giro(true); await giro(true); await giro(true);
    expect(statoGiro("prova", 2).sospesoFinoA).toBe(Date.now() + 30 * 60_000);
    vi.setSystemTime(Date.now() + 31 * 60_000);
    await giro(false);
    expect(statoGiro("prova", 2)).toEqual({ erroriConsecutivi: 0, sospesoFinoA: 0, sospensioni: 0 });
    const eventi = await repo.eventi(2);
    expect(eventi.map(e => e.tipo)).toEqual(["worker_sospeso", "worker_sospeso", "worker_riarmato"]);
    expect(eventi[0].dettagli).toEqual({ etichetta: "prova", minuti: 15, errore: "boom" });
    expect(eventi[1].dettagli).toEqual({ etichetta: "prova", minuti: 30, errore: "boom" });
    expect(await repo.eventi(1)).toEqual([]);
    vi.useRealTimers();
  });
```

e in `cli.test.ts`:

```ts
  it("workerSospesi legge gli eventi: l'ultima sospensione non riarmata e non scaduta", () => {
    const ev = (id: number, tipo: string, dettagli: any, minutiFa: number) =>
      ({ id, tenantId: 2, tipo, attore: "boot", motivo: null, dettagli, createdAt: new Date(Date.now() - minutiFa * 60_000) }) as any;
    const eventi = [
      ev(1, "worker_sospeso", { etichetta: "backup", minuti: 15, errore: "x" }, 5),
      ev(2, "worker_sospeso", { etichetta: "posta", minuti: 15, errore: "y" }, 30), // scaduta
      ev(3, "worker_sospeso", { etichetta: "tars", minuti: 60, errore: "z" }, 10),
      ev(4, "worker_riarmato", { etichetta: "tars" }, 2),
    ];
    expect(workerSospesi(eventi).map(w => w.etichetta)).toEqual(["backup"]);
  });
```

- [ ] **Step 2: Vederli fallire** — `pnpm vitest run server/tenants/giri.test.ts server/tenants/cli.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implementare** in `giri.ts`:

```ts
export const ERRORI_PER_SOSPENDERE = 3;
export const ATTESE_SOSPENSIONE_MIN = [15, 30, 60, 120] as const;
export type StatoGiro = { erroriConsecutivi: number; sospesoFinoA: number; sospensioni: number };
const stati = new Map<string, StatoGiro>();
const chiave = (etichetta: string, tenantId: number) => `${etichetta}:${tenantId}`;

export function statoGiro(etichetta: string, tenantId: number): StatoGiro {
  return { ...(stati.get(chiave(etichetta, tenantId)) ?? { erroriConsecutivi: 0, sospesoFinoA: 0, sospensioni: 0 }) };
}
export function __azzeraStatiGiriPerTest(): void {
  if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY_STATI_GIRI");
  stati.clear();
}

async function registra(tenantId: number, tipo: "worker_sospeso" | "worker_riarmato", dettagli: Record<string, unknown>): Promise<void> {
  try {
    await getTenantRepository().registraEvento({ tenantId, tipo, attore: "boot", dettagli });
  } catch (errore) {
    console.error(`[tenant] evento ${tipo} non registrato:`, errore instanceof Error ? errore.message : errore);
  }
}

/**
 * Un giro per tenant, ognuno nel suo contesto; un errore di un tenant non
 * ferma gli altri. Interruttore per (worker, azienda) (WS3 spec §7): dopo
 * ERRORI_PER_SOSPENDERE errori consecutivi l'azienda viene saltata per 15,
 * 30, 60 e poi sempre 120 minuti; il primo giro riuscito riarma. Lo stato
 * vive in memoria (una replica): gli eventi in `tenant_eventi` sono la
 * traccia che `pnpm tenant elenco` legge.
 */
export async function perOgniTenantAttivo(etichetta: string, fn: (tenantId: number) => Promise<void>): Promise<void> {
  for (const tenantId of tenantsAttivi()) {
    const k = chiave(etichetta, tenantId);
    const s = stati.get(k) ?? { erroriConsecutivi: 0, sospesoFinoA: 0, sospensioni: 0 };
    if (s.sospesoFinoA > Date.now()) continue;
    try {
      await conTenant(tenantId, () => fn(tenantId));
      if (s.erroriConsecutivi > 0 || s.sospensioni > 0) {
        stati.delete(k);
        if (s.sospensioni > 0) await registra(tenantId, "worker_riarmato", { etichetta });
      }
    } catch (errore) {
      const messaggio = errore instanceof Error ? errore.message : String(errore);
      console.error(`[${etichetta}] tenant ${tenantId}:`, messaggio);
      s.erroriConsecutivi++;
      if (s.erroriConsecutivi >= ERRORI_PER_SOSPENDERE) {
        const minuti = ATTESE_SOSPENSIONE_MIN[Math.min(s.sospensioni, ATTESE_SOSPENSIONE_MIN.length - 1)];
        s.sospesoFinoA = Date.now() + minuti * 60_000;
        s.sospensioni++;
        s.erroriConsecutivi = 0;
        console.error(`[${etichetta}] tenant ${tenantId} sospeso per ${minuti} min: ${messaggio}`);
        await registra(tenantId, "worker_sospeso", { etichetta, minuti, errore: messaggio });
      }
      stati.set(k, s);
    }
  }
}
```

`cli.ts`:

```ts
/** I worker sospesi secondo gli eventi: l'ultima sospensione per etichetta, non seguita da un riarmo e non ancora scaduta. */
export function workerSospesi(eventi: TenantEvento[], adesso = new Date()): Array<{ etichetta: string; finoA: Date; errore: string }> {
  const ultimo = new Map<string, TenantEvento>();
  for (const e of eventi) {
    if (e.tipo !== "worker_sospeso" && e.tipo !== "worker_riarmato") continue;
    const etichetta = String(e.dettagli?.etichetta ?? "");
    if (etichetta) ultimo.set(etichetta, e);
  }
  const out: Array<{ etichetta: string; finoA: Date; errore: string }> = [];
  for (const [etichetta, e] of ultimo) {
    if (e.tipo !== "worker_sospeso") continue;
    const finoA = new Date(e.createdAt.getTime() + Number(e.dettagli?.minuti ?? 0) * 60_000);
    if (finoA > adesso) out.push({ etichetta, finoA, errore: String(e.dettagli?.errore ?? "") });
  }
  return out;
}
```

`scripts/tenant.ts`, in `elenco`, dopo la riga di ogni tenant: `for (const w of workerSospesi(await repo.eventi(t.id))) console.log(`  worker sospeso: ${w.etichetta} fino a ${w.finoA.toISOString()} (${w.errore})`);`.

- [ ] **Step 4: Eseguire** — `pnpm vitest run server/tenants/giri.test.ts server/tenants/cli.test.ts server/tenants`; `pnpm check`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/tenants/giri.ts server/tenants/giri.test.ts server/tenants/cli.ts server/tenants/cli.test.ts scripts/tenant.ts
git commit -m "feat(tenant): interruttore per (worker, azienda) in perOgniTenantAttivo con eventi e vista in pnpm tenant elenco"
```

---

### Task 11: `recordOppureNotFound` e i 98 `throw new Error("… non trovato")` dei router

**Files:**
- Modify: `server/_core/permissions.ts` (dopo `assertSedeScope` :62-73)
- Modify (98 siti): `server/routers/commesse.ts` (24), `preventiviContratti.ts` (13), `tars.ts` (9), `produzione.ts` (9), `fornitori.ts` (6), `ticket.ts` (5), `aperture.ts` (5), `reclamiRifacimenti.ts` (4), `ticketAllegati.ts` (3), `interventi.ts` (3), `anomalie.ts` (3), `utenti.ts` (2), `timeline.ts` (2), `squadre.ts` (2), `sedi.ts` (2), `garanzie.ts` (2), `externalCalendars.ts` (2), `verbali.ts` (1), `ficAllegati.ts` (1)
- Test: `server/_core/permissions.test.ts` (aggiungere o creare), `server/routers/nonTrovato.confine.test.ts` (nuovo, strutturale)

**Interfaces:**
- Produces:
  ```ts
  export function oppureNotFound<T>(record: T | null | undefined): T;                       // solo esistenza
  export function recordOppureNotFound<T extends SedeScopedRecord>(record: T, sedeId: number | null): NonNullable<T>; // esistenza + sede (assertSedeScope)
  ```

- [ ] **Step 1: Test che falliscono**

`server/routers/nonTrovato.confine.test.ts`:

```ts
// Guardia STRUTTURALE (WS3 spec §8): nei router un record assente o di
// un'altra sede dà NOT_FOUND, mai un `Error` generico (500). Le 98 coppie
// «throw new Error("… non trovato") + assertSedeScope» sono diventate
// `recordOppureNotFound`/`oppureNotFound`.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fileSorgente, relativo } from "../_core/sorgentiDiProva";

const RE = /throw new Error\((["'`])[^"'`]*non trovat/i;

describe("router senza Error generici di «non trovato»", () => {
  it("nessun router lancia Error('… non trovato')", () => {
    const colpevoli = fileSorgente(["server/routers"])
      .filter(f => !f.endsWith(".test.ts"))
      .filter(f => RE.test(readFileSync(f, "utf8")))
      .map(relativo);
    expect(colpevoli).toEqual([]);
  });
});
```

`permissions.test.ts`:

```ts
  it("oppureNotFound e recordOppureNotFound: NOT_FOUND generico, mai il motivo", () => {
    expect(oppureNotFound({ id: 1 })).toEqual({ id: 1 });
    expect(() => oppureNotFound(null)).toThrow(expect.objectContaining({ code: "NOT_FOUND", message: "Risorsa non trovata." }));
    expect(recordOppureNotFound({ id: 1, sedeId: 2 }, 2)).toEqual({ id: 1, sedeId: 2 });
    expect(recordOppureNotFound({ id: 1, sedeId: 2 }, null)).toEqual({ id: 1, sedeId: 2 });
    expect(() => recordOppureNotFound({ id: 1, sedeId: 2 }, 3)).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
    expect(() => recordOppureNotFound(undefined, 3)).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
  });
```

- [ ] **Step 2: Vederli fallire** — `pnpm vitest run server/routers/nonTrovato.confine.test.ts server/_core/permissions.test.ts`. Expected: FAIL (19 file colpevoli; helper assenti).

- [ ] **Step 3: Helper** in `permissions.ts`:

```ts
/** Il record, o NOT_FOUND generico: chi non deve sapere se esiste non lo sa. */
export function oppureNotFound<T>(record: T | null | undefined): T {
  if (record == null) throw new TRPCError({ code: "NOT_FOUND", message: "Risorsa non trovata." });
  return record;
}

/** Come `oppureNotFound`, più il confine di sede (`assertSedeScope`). */
export function recordOppureNotFound<T extends SedeScopedRecord>(record: T, sedeId: number | null): NonNullable<T> {
  assertSedeScope(record, sedeId);
  return record as NonNullable<T>;
}
```

- [ ] **Step 4: I 98 siti** — regole meccaniche, file per file (`grep -n 'throw new Error("[^"]*non trovat' server/routers/*.ts`):

1. `const x = arr.find(…); if (!x) throw new Error("… non trovato"); assertSedeScope(x, ctx.sedeId);` → `const x = recordOppureNotFound(arr.find(…), ctx.sedeId);` (l'`assertSedeScope` sparisce).
2. `const idx = arr.findIndex(…); if (idx === -1) throw new Error("…"); assertSedeScope(arr[idx], ctx.sedeId);` → `const idx = arr.findIndex(…); recordOppureNotFound(arr[idx], ctx.sedeId);` (`arr[-1]` è `undefined`, quindi lancia NOT_FOUND; `idx` resta usato dopo).
3. Nessun `assertSedeScope` dopo il throw (record annidati come `costo`, `riga`, o record senza `sedeId`) → `const x = oppureNotFound(arr.find(…));`.
4. Il throw è dentro una funzione che NON ha `ctx` (helper di modulo usati dai worker) → regola 3.
5. Mai cambiare la logica intorno; mai toccare i messaggi `TRPCError` già presenti; `tars.ts` segue le stesse regole (gli strumenti restituiscono l'errore al modello: «Risorsa non trovata.» basta).

Import di `oppureNotFound`/`recordOppureNotFound` da `../_core/permissions` in ogni file toccato; togliere `assertSedeScope` dall'import dove non è più usato.

- [ ] **Step 5: Eseguire** — `pnpm vitest run server/routers/nonTrovato.confine.test.ts server/_core/permissions.test.ts server/routers`; `pnpm check`. Expected: PASS. Se un test di router esistente asserisce il vecchio messaggio (`toThrow("Commessa non trovata")`), aggiornarlo a `NOT_FOUND`/«Risorsa non trovata.»: è il comportamento voluto (spec §8, §9).

- [ ] **Step 6: Commit**

```bash
git add server/_core/permissions.ts server/_core/permissions.test.ts server/routers
git commit -m "fix(routers): recordOppureNotFound al posto dei 98 Error generici di «non trovato», con guardia strutturale"
```

---

### Task 12: Pannello e migrazione dello storage per azienda, script `--tenant`

**Files:**
- Modify: `server/routers/fileStorageAdmin.ts` (`status` :17-46), `server/_core/fileStorageMigrate.ts` (`lastBackupOkWithin` :44-53), `scripts/migrate-documents-to-storage.ts`
- Test: `server/routers/fileStorageAdmin.test.ts` (creare se manca, pattern degli altri test di router), `server/_core/fileStorageMigrate.test.ts` (se esiste: adeguare)

**Interfaces:**
- Consumes: `getAllStoreSnapshots()` (`nome`, `tenantId`), `tenantDelContesto`, `conTenant`, `istanziaStoresPerTenant`.

- [ ] **Step 1: Test che fallisce** — `fileStorageAdmin.test.ts`: due tenant istanziati, `preventivi_documenti` del tenant 2 con un record `dataBase64` e uno `storageKey`; `fileStorageAdminRouter.createCaller(ctx)` con `ctx.tenantId = 2`, `ctx.user` direzione → `status().collections` riporta `{ key: "preventivi_documenti", total: 2, inline: 1, migrati: 1 }` del tenant 2; con `ctx.tenantId = 1` → `total: 0`.

- [ ] **Step 2: Vederlo fallire** — `pnpm vitest run server/routers/fileStorageAdmin.test.ts`. Expected: FAIL (oggi filtra per `s.key` nuda: mostra il tenant 1 a tutti).

- [ ] **Step 3: Implementare**

`fileStorageAdmin.ts` `status`: `const tenantId = tenantDelContesto(ctx); const snapshots = getAllStoreSnapshots().filter(s => keys.includes(s.nome) && s.tenantId === tenantId);` e `key: s.nome` nel risultato. `migrate` resta: `migrateFilesToStorage` legge i Proxy delle collezioni registrate (`registerMigratableCollection`), che nel contesto della richiesta sono già dell'azienda; `lastBackupOkWithin` in `fileStorageMigrate.ts` cerca oggi `s.key === "backup_log"` (solo il tenant 1): usare `s.nome === "backup_log" && s.tenantId === tenantCorrente()` (import di `tenantCorrente` da `../tenants/contestoCorrente`). `putFile` mette il prefisso dell'azienda ai file migrati (Task 1).

`scripts/migrate-documents-to-storage.ts`: `--tenant=<id>` come in `scripts/importa-clienti.ts:50-60` (`tenantScelto()`), poi:

```ts
  await bootstrapAll({ tenantIds: [tenantId] });
  const report = await conTenant(tenantId, () => migrateFilesToStorage({ apply, skipBackupCheck }));
```

e la riga di avvio stampa il tenant (`console.log(\`Tenant: ${tenantId}\`)`); il commento in testa elenca `--tenant=<id>` e ricorda che lo script non va usato contro un'istanza in esecuzione.

- [ ] **Step 4: Eseguire** — `pnpm vitest run server/routers/fileStorageAdmin.test.ts server/_core`; `pnpm check`; `npx tsx scripts/migrate-documents-to-storage.ts --tenant=1` senza `DATABASE_URL` (dry-run in memoria: stampa il report vuoto). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routers/fileStorageAdmin.ts server/routers/fileStorageAdmin.test.ts server/_core/fileStorageMigrate.ts scripts/migrate-documents-to-storage.ts
git commit -m "feat(storage): pannello e migrazione dello storage per azienda, script con --tenant"
```

---

### Task 13: Documentazione — runbook, storage-r2, PRD §60.11, handoff, CLAUDE.md, spec §2-bis

**Files:**
- Modify: `docs/runbooks/multi-azienda.md` (titolo :1; nuova sezione «## WS3 — file, backup, credenziali e guasti per tenant» prima di «## Verifica in sola lettura» :295), `docs/storage-r2.md`, `documento_requisiti_infissi_ops.md` (riga `**Versione:**` :4 → 5.62 con `Prima: 5.61 …`; titolo §60 :3779; nuova `### 60.11 Workstream 3 — …` dopo §60.10), `handoff.md` (blocco «Novità 08/09/2026 — WS3» in testa dopo «Aggiornato», voce 21), `CLAUDE.md` (invarianti multi-azienda :52-67), `docs/superpowers/specs/2026-09-08-ws3-file-integrazioni-design.md` (§2-bis «Decisioni in corso d'opera» con i ruling del registro d'esecuzione)
- Test: `shared/brand.test.ts` (guardia del marchio sui documenti vivi: dire Wyndor, mai il vecchio nome), `pnpm test`

- [ ] **Step 1: Runbook** — sezione WS3 con: cosa fa il boot (contabile, `tenant_storage`/`oauth_state`, ricalcolo iniziale dopo il listen, migrazione del token Drive a senso unico e come ricollegare il Drive in caso di rollback); `pnpm tenant storage --slug [--ricalcola --scrivi --attendi]`; `pnpm tenant ripristina --slug --backup=<data|folderId> [--solo=…] --prova|--scrivi [--anche-tenant-1] [--attendi]` con la procedura (prova, lettura dell'esito, scrittura, verifica, riattivazione manuale se interrotto); `pnpm tenant elenco` con i worker sospesi; backup per azienda (ogni azienda collega il proprio Drive da Integrazioni → Backup; cartella «Backup Wyndor — <azienda>»; Ruffino Group invariata); webhook per numero; «Produzione, in ordine (WS3)»: backup Drive riuscito → deploy a interruttore spento → `pnpm --silent tenant verifica --json` → `pnpm tenant storage --slug=ruffino-group` popolato → accensione → prima azienda 2 in staging (crea, collega Drive, backup, ripristino `--prova`) → produzione; «Errori che l'operatore può vedere (WS3)» dalla spec §9. Aggiornare il titolo del runbook a «WS1 + WS2 + WS3» e la frase che vietava una seconda azienda in produzione (ora ammessa dopo il WS3, con la procedura).
- [ ] **Step 2: `docs/storage-r2.md`** — chiavi `tenant/<id>/…` per i file nuovi, chiavi nude = Ruffino Group legacy, migrazione un'azienda alla volta (`--tenant`), ledger e `pnpm tenant storage`.
- [ ] **Step 3: PRD** — §60.11 (contratto del WS3 in 10–15 righe per la direzione: file contati per azienda, quota che avvisa, backup sul Drive dell'azienda, ripristino provato, `state` OAuth persistiti, webhook per numero, guasti isolati, NOT_FOUND uniforme; cosa resta al WS4), titolo §60 aggiornato («WS1–WS3 su main…» secondo lo stato reale al momento), riga `**Versione:**` 5.62 con la catena `Prima: 5.61 …` intatta.
- [ ] **Step 4: handoff e CLAUDE.md** — handoff: blocco Novità 08/09/2026 (WS3 su branch, cosa cambia per chi opera, comandi nuovi, rollback del token), «Aggiornato: 08/09/2026»; voce 21 aggiornata (WS3 fatto, WS4 prossimo). CLAUDE.md, negli invarianti multi-azienda: file nuovi sotto `tenant/<id>/` e `putFile` dal contesto; `deleteFileQuiet(chiave, byte)` sempre con i byte del record; store globali: i quattro; `oauth_state` per ogni flusso OAuth nuovo (mai mappe in memoria); ogni giro di fondo passa da `perOgniTenantAttivo` (interruttore per azienda); nei router `recordOppureNotFound`/`oppureNotFound`, mai `throw new Error("… non trovato")`.
- [ ] **Step 5: Spec §2-bis** — tabella dei ruling del registro (`.superpowers/sdd/2026-09-08-ws3-file-integrazioni/progress.md`): numero, decisione, perché, cosa costa se sbagliata.
- [ ] **Step 6: Eseguire** — `pnpm vitest run shared/brand.test.ts`; `pnpm check`; `pnpm test`; `pnpm build`. Expected: PASS (baseline HEIC esclusa).
- [ ] **Step 7: Commit**

```bash
git add docs/runbooks/multi-azienda.md docs/storage-r2.md documento_requisiti_infissi_ops.md handoff.md CLAUDE.md docs/superpowers/specs/2026-09-08-ws3-file-integrazioni-design.md
git commit -m "docs(ws3): runbook, storage-r2, PRD §60.11, handoff, CLAUDE.md e ruling della spec per file, backup, credenziali e guasti per tenant"
```

---

## Self-review del piano (fatto alla stesura)

- **Copertura della spec:** §3.1 → T1; §3.2 → T2, T3, T4; §3.3 → T12; §3.4 → T1 (byte ai delete) e nessuna cascata nuova; §4.1–§4.3 → T6, T7; §4.4 → T8; §5 → T2, T5, T6; §6 → T9; §7 → T10; §8 → T11 (+ T7 per `Utenti.json`, T12); §9 errori → coperti dai test dei task; §10 test → in ogni task; §11 rilascio e §12 rischi → T13.
- **Coerenza dei tipi:** `StatoStorage`, `StateOAuth`, `ContabileStorage`, `DriveRipristino`, `EsitoRipristino`, `StatoGiro` definiti una volta (T1, T2, T8, T10) e usati con gli stessi nomi; `putFile` firma invariata; `deleteFileQuiet(chiave, byte?)`; `issueOAuthState(utenteId)` e `issueFicOAuthState(sedeId, redirectUri, scrittura?, utenteId?)` asincrone.
- **Ordine:** T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10 → T11 → T12 → T13; T9, T10, T11 sono indipendenti fra loro ma restano in sequenza (un implementer alla volta).
