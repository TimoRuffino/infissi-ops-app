# WS6 «Pannello Piattaforma» — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** chi possiede la piattaforma gestisce tutte le aziende dall'app (`/piattaforma`): elenco, scheda, creazione con invito via email al proprietario, sospensione, abbonamento, spazio, Tars, proprietari, ripristino; ogni azione è un comando di `tenant_comandi` eseguito subito, con l'autore in `tenant_eventi`.

**Architecture:** un router tRPC `piattaforma` (cartella `server/piattaforma/`) dietro `piattaformaProcedure` (utente attivo del tenant 1 con email in `PLATFORM_ADMIN_EMAILS`), che legge il control plane in poche query e scrive solo accodando i comandi esistenti ed eseguendoli con la stessa funzione del giro dei 30 secondi (`prendiEdEsegui` con `soloId`). Gli inviti vivono nella tabella nuova `tenant_inviti` (token a terra solo come `sha256`), la pagina pubblica `/invito/:token` imposta la password e apre la sessione, la posta parte da Resend via `fetch` con ripiego «copia il link». Il client aggiunge `RequirePiattaforma`, due pagine, un dialogo di creazione, un dialogo di conferma password e la pagina d'invito fuori dalla shell.

**Tech Stack:** TypeScript strict, Express 4 + tRPC 11 + zod, postgres-js (`kvSql`), `persistedStore` JSONB, React 19 + Wouter + tRPC React Query + Tailwind 4 + shadcn, vitest (rete vietata da `server/_core/testSetup.ts`), Postgres Docker per i `*.pg.test.ts`.

**Spec:** `docs/superpowers/specs/2026-09-09-ws6-pannello-piattaforma-design.md` (letta per intera dal controller; ogni task cita le sezioni che implementa). Design madre: `docs/superpowers/specs/2026-09-06-saas-multi-azienda-design.md` §6.2, §9, §11, §15.

## Global Constraints

- **Branch:** `feature/ws6-pannello-piattaforma` (da `main` 37c1889). Un commit per task, messaggio in italiano come i precedenti, ultima riga `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Mai `git merge`, `rebase`, `checkout`/`switch` di altri branch, `pull`, `reset`, `stash` nel worktree condiviso.
- **Control plane:** `tenant_inviti` la scrive SOLO `server/tenants/repository.ts` (guardia `server/tenants/confine.test.ts:29-33`, regex `INSERT INTO|UPDATE|DELETE FROM … tenant`). Nessuno schema zod con un campo `tenantId` o `tenant` (`confine.test.ts:15-18`): gli input individuano l'azienda per `slug`.
- **Contesto:** il router `piattaforma` NON passa da `guardiaTenant`; ogni lettura di uno store per tenant sta dentro `conTenant(tenantId, …)` esplicito (`server/tenants/contestoCorrente.ts:25`). Niente `storeDi` in `server/piattaforma/` e in `server/routers/`.
- **Dati business:** `server/piattaforma/*` non importa `server/routers/*` (eccetto `utenti` e `sedi`, già usati da `tenants/servizio.ts`), né `server/comunicazioni`, `server/fatture`, `server/documenti`, `server/tars/strumenti` (guardia nuova, Task 6).
- **Segreti:** il token dell'invito esce solo nel `link` restituito a chi lo crea; mai in log, eventi, `tenant_comandi` o titoli. La password del proprietario nuovo è inutilizzabile finché l'invito non è accettato. Niente email intere nei log (`[posta] invio a <dominio>`).
- **Interruttore:** con `FLAG_MULTI_AZIENDA` spento le query del pannello rispondono, le mutation rifiutano con `PRECONDITION_FAILED` `MESSAGGI_PIATTAFORMA.solaLetturaFlagSpento`. Nessun interruttore nuovo.
- **Costo:** l'elenco delle aziende fa al più cinque query al database in tutto (~147 ms l'una in produzione), mai una per azienda.
- **Messaggi utente:** in italiano, dalla costante `MESSAGGI_PIATTAFORMA` (`server/piattaforma/costanti.ts`); errori del dominio mostrati così come arrivano; azienda sconosciuta → `oppureNotFound` («Risorsa non trovata.»). Grafia «Wyndoor» (guardia `shared/brand.test.ts`).
- **Tempo:** ogni funzione che decide sul tempo riceve `adesso: Date`; nei test orologio finto (`vi.useFakeTimers({ now: T0, toFake: ["Date"] })`) quando un `adesso` congelato incontra un `createdAt` del repository.
- **Test:** `pnpm check`, `pnpm test`, `pnpm build` verdi alla fine di ogni task; i `*.pg.test.ts` con `DATABASE_URL=postgres://postgres:test@localhost:55433/perf_test npx vitest run <file> --no-file-parallelism` (container `perf-pg-test`). I test che importano router non chiamano `__resetPersistenzaPerTest()`.
- **Client:** token semantici, `DataSurface`/`PageHeader`/`StatePanel`, `min-w-0`, niente card annidate, niente scroll orizzontale; verifica a 1440×900 e 390×844 con il login demo e console pulita.
- **Nomi in italiano** per file, funzioni e campi nuovi.

---

### Task 1: Control plane — `tenant_inviti`, attore «piattaforma», letture in blocco, `prendiEdEsegui({ soloId })`

Spec §4.1, §4.2, §4.3.

**Files:**
- Modify: `server/tenants/tipi.ts`, `server/tenants/costanti.ts`, `server/tenants/repository.ts`, `server/tenants/servizio.ts` (solo l'attore in `eseguiComando`), `server/tenants/boot.ts` (pulizia inviti)
- Test: `server/tenants/repository.test.ts`, `server/tenants/repository.pg.test.ts`, `server/tenants/servizio.test.ts`

**Interfaces:**
- Consumes: `TenantRepository`, `TenantComando`, `Attore`, `attoreTesto` (`tipi.ts`), `TTL_STATE_OAUTH_MS` (`costanti.ts`), `payloadSenzaSegreti`, `rigaComando`, `sql.begin` (`repository.ts`).
- Produces: `TipoInvito`, `TenantInvito`, `TTL_INVITO_MS`, i tre `TipoEvento` `invito_inviato|invito_accettato|invito_annullato`, `Attore` con `{ tipo: "piattaforma"; email }`, i metodi `emettiInvito`, `invitoPerToken`, `consumaInvito`, `invitiDi`, `annullaInvito`, `pulisciInvitiScaduti`, `comandiDi`, `storageTutti`, `eventiRecenti`, `prendiEdEsegui(esegui, { soloId? })`.

- [ ] **Step 1: Tipi e costanti**

In `server/tenants/tipi.ts`:

```ts
export type Attore =
  | { tipo: "utente"; id: number }
  | { tipo: "script"; nome: string }
  | { tipo: "piattaforma"; email: string } // WS6: chi agisce dal pannello
  | { tipo: "boot" };

export function attoreTesto(attore: Attore): string {
  if (attore.tipo === "utente") return `utente:${attore.id}`;
  if (attore.tipo === "script") return attore.nome.startsWith("script:") ? attore.nome : `script:${attore.nome}`;
  if (attore.tipo === "piattaforma") return `piattaforma:${attore.email.trim().toLowerCase()}`;
  return "boot";
}

// … in TipoEvento, dopo "tars_sbloccato":
  | "invito_inviato"     // WS6: dettagli { invitoId, utenteId, email, scadeIl, inviato, motivo? }
  | "invito_accettato"   // WS6: dettagli { invitoId, utenteId }
  | "invito_annullato";  // WS6: dettagli { invitoId }

export type TipoInvito = "proprietario";
export type TenantInvito = {
  id: number;
  tenantId: number;
  utenteId: number;
  email: string;
  tipo: TipoInvito;
  scadeIl: Date;
  creatoDa: string;
  createdAt: Date;
  usatoIl: Date | null;
  annullatoIl: Date | null;
};
```

In `server/tenants/costanti.ts`: `export const TTL_INVITO_MS = 7 * 24 * 60 * 60 * 1000;` e `MESSAGGI.schemaAssente` diventa «Tabelle del control plane del tenant assenti (tenants, tenant_eventi, tenant_comandi, tenant_sedi, tenant_storage, oauth_state, abbonamenti, tenant_inviti): le crea il server al primo avvio con questa versione; lo script non tocca lo schema.»

- [ ] **Step 2: Test rossi del repository in memoria** (`server/tenants/repository.test.ts`, describe nuovo `inviti e letture in blocco (WS6)`)

```ts
import { createHash } from "node:crypto";
// …
describe("inviti e letture in blocco (WS6)", () => {
  const T0 = new Date("2026-09-09T10:00:00Z");
  beforeEach(() => { vi.useFakeTimers({ now: T0, toFake: ["Date"] }); });
  afterEach(() => vi.useRealTimers());

  it("emette un invito con token monouso e ne annulla i precedenti dello stesso utente", async () => {
    const repo = getTenantRepository();
    const t = await repo.inserisci({ slug: "acme", nome: "Acme" });
    const primo = await repo.emettiInvito({ tenantId: t.id, utenteId: 7, email: "m@acme.test", tipo: "proprietario", creatoDa: "piattaforma:t@r.it" });
    const secondo = await repo.emettiInvito({ tenantId: t.id, utenteId: 7, email: "m@acme.test", tipo: "proprietario", creatoDa: "piattaforma:t@r.it" });
    expect(primo.token).not.toBe(secondo.token);
    expect(primo.token.length).toBeGreaterThanOrEqual(40);
    expect(await repo.invitoPerToken(primo.token)).toBeNull();          // annullato dal secondo
    expect((await repo.invitoPerToken(secondo.token))?.id).toBe(secondo.invito.id);
    expect((await repo.invitiDi(t.id)).map(i => [i.id, i.annullatoIl !== null])).toEqual([[secondo.invito.id, false], [primo.invito.id, true]]);
    expect(secondo.invito.scadeIl.getTime()).toBe(T0.getTime() + TTL_INVITO_MS);
  });

  it("consuma una volta sola, mai scaduto o annullato", async () => {
    const repo = getTenantRepository();
    const t = await repo.inserisci({ slug: "acme", nome: "Acme" });
    const { token, invito } = await repo.emettiInvito({ tenantId: t.id, utenteId: 7, email: "m@acme.test", tipo: "proprietario", creatoDa: "piattaforma:t@r.it" });
    expect((await repo.consumaInvito(token))?.id).toBe(invito.id);
    expect(await repo.consumaInvito(token)).toBeNull();
    const { token: t2 } = await repo.emettiInvito({ tenantId: t.id, utenteId: 8, email: "g@acme.test", tipo: "proprietario", creatoDa: "piattaforma:t@r.it" });
    vi.setSystemTime(new Date(T0.getTime() + TTL_INVITO_MS + 1));
    expect(await repo.invitoPerToken(t2)).toBeNull();
    expect(await repo.consumaInvito(t2)).toBeNull();
    const { token: t3, invito: i3 } = await repo.emettiInvito({ tenantId: t.id, utenteId: 9, email: "z@acme.test", tipo: "proprietario", creatoDa: "piattaforma:t@r.it" });
    expect((await repo.annullaInvito(i3.id))?.annullatoIl).not.toBeNull();
    expect(await repo.consumaInvito(t3)).toBeNull();
    expect(await repo.pulisciInvitiScaduti()).toBe(0); // scaduti da meno di 30 giorni: restano
    vi.setSystemTime(new Date(T0.getTime() + TTL_INVITO_MS + 31 * 24 * 3600 * 1000));
    expect(await repo.pulisciInvitiScaduti()).toBeGreaterThanOrEqual(1);
  });

  it("comandiDi, storageTutti ed eventiRecenti leggono in blocco", async () => {
    const repo = getTenantRepository();
    const a = await repo.inserisci({ slug: "acme", nome: "Acme" });
    const b = await repo.inserisci({ slug: "beta", nome: "Beta" });
    await repo.aggiornaStorage(a.id, 10, 1);
    await repo.aggiornaStorage(b.id, 20, 2);
    await repo.accodaComando({ tipo: "ricalcola_storage", tenantId: a.id, payload: { slug: "acme" }, richiestoDa: "piattaforma:t@r.it" });
    await repo.registraEvento({ tenantId: b.id, tipo: "worker_sospeso", attore: "boot", dettagli: { etichetta: "imap", minuti: 15 } });
    expect((await repo.storageTutti()).map(s => [s.tenantId, s.bytes])).toEqual([[a.id, 10], [b.id, 20]]);
    expect((await repo.comandiDi(a.id, { ultimi: 20 })).map(c => c.tipo)).toEqual(["ricalcola_storage"]);
    expect(await repo.comandiDi(b.id)).toEqual([]);
    const recenti = await repo.eventiRecenti({ tipi: ["worker_sospeso", "worker_riarmato"], da: new Date(T0.getTime() - 3600_000) });
    expect(recenti.map(e => [e.tenantId, e.tipo])).toEqual([[b.id, "worker_sospeso"]]);
  });

  it("prendiEdEsegui con soloId prende solo quel comando", async () => {
    const repo = getTenantRepository();
    const a = await repo.inserisci({ slug: "acme", nome: "Acme" });
    const c1 = await repo.accodaComando({ tipo: "ricalcola_storage", tenantId: a.id, payload: { slug: "acme" }, richiestoDa: "x" });
    const c2 = await repo.accodaComando({ tipo: "ricalcola_storage", tenantId: a.id, payload: { slug: "acme" }, richiestoDa: "x" });
    const visti: number[] = [];
    expect(await repo.prendiEdEsegui(async c => { visti.push(c.id); return { ok: true }; }, { soloId: c2.id })).toBe("eseguito");
    expect(visti).toEqual([c2.id]);
    expect((await repo.comando(c1.id))?.stato).toBe("in_attesa");
    expect(await repo.prendiEdEsegui(async () => ({}), { soloId: c2.id })).toBe("nessuno");
  });
});
```

- [ ] **Step 3: Run → FAIL** — `npx vitest run server/tenants/repository.test.ts` (metodi assenti).

- [ ] **Step 4: Implementazione in memoria** (`createMemoryTenantRepository`)

```ts
const inviti: Array<TenantInvito & { tokenHash: string }> = [];
let prossimoInvito = 1;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const invitoValido = (i: { usatoIl: Date | null; annullatoIl: Date | null; scadeIl: Date }, adesso: Date) =>
  !i.usatoIl && !i.annullatoIl && i.scadeIl.getTime() > adesso.getTime();
const senzaHash = ({ tokenHash: _h, ...resto }: TenantInvito & { tokenHash: string }): TenantInvito => clone(resto);

// … nel repo:
async emettiInvito(input) {
  const adesso = input.adesso ?? new Date();
  for (const i of inviti) if (i.tenantId === input.tenantId && i.utenteId === input.utenteId && invitoValido(i, adesso)) i.annullatoIl = adesso;
  const token = randomBytes(32).toString("base64url");
  const invito = { id: prossimoInvito++, tenantId: input.tenantId, utenteId: input.utenteId, email: input.email.trim().toLowerCase(), tipo: input.tipo,
    scadeIl: new Date(adesso.getTime() + TTL_INVITO_MS), creatoDa: input.creatoDa, createdAt: adesso, usatoIl: null, annullatoIl: null, tokenHash: hashToken(token) };
  inviti.push(invito);
  return { invito: senzaHash(invito), token };
},
async invitoPerToken(token, adesso = new Date()) {
  const i = inviti.find(x => x.tokenHash === hashToken(token));
  return i && invitoValido(i, adesso) ? senzaHash(i) : null;
},
async consumaInvito(token, adesso = new Date()) {
  const i = inviti.find(x => x.tokenHash === hashToken(token));
  if (!i || !invitoValido(i, adesso)) return null;
  i.usatoIl = adesso;
  return senzaHash(i);
},
async invitiDi(tenantId) { return inviti.filter(i => i.tenantId === tenantId).sort((a, b) => b.id - a.id).map(senzaHash); },
async annullaInvito(id) {
  const i = inviti.find(x => x.id === id);
  if (!i || i.usatoIl) return null;
  i.annullatoIl ??= new Date();
  return senzaHash(i);
},
async pulisciInvitiScaduti() {
  const limite = Date.now() - 30 * 24 * 3600 * 1000;
  const prima = inviti.length;
  for (let k = inviti.length - 1; k >= 0; k--) if (inviti[k].scadeIl.getTime() <= limite) inviti.splice(k, 1);
  return prima - inviti.length;
},
async comandiDi(tenantId, opzioni) {
  const suoi = comandi.filter(c => c.tenantId === tenantId).sort((a, b) => b.id - a.id);
  const ultimi = opzioni?.ultimi;
  return (ultimi != null && ultimi > 0 ? suoi.slice(0, ultimi) : suoi).map(clone);
},
async storageTutti() { return [...storageMem.keys()].sort((a, b) => a - b).map(id => rigaStorage(id)); }, // adattare al nome reale della mappa dello storage in memoria
async eventiRecenti(input) {
  const tipi = new Set(input.tipi);
  return eventi.filter(e => tipi.has(e.tipo) && e.createdAt.getTime() >= input.da.getTime()).map(clone);
},
async prendiEdEsegui(esegui, opzioni) {
  const c = comandi.find(x => x.stato === "in_attesa" && (opzioni?.soloId == null || x.id === opzioni.soloId));
  // … il resto invariato
},
```

(`storageTutti` in memoria: usare la struttura già esistente per `storageDi` — leggerla alla riga 286 e restituire tutte le righe ordinate per `tenantId`.)

- [ ] **Step 5: Implementazione Postgres** — DDL in `creaSchema`, dopo `abbonamenti`:

```ts
await tx`CREATE TABLE IF NOT EXISTS tenant_inviti (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id),
  utente_id BIGINT NOT NULL,
  email TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'proprietario' CHECK (tipo IN ('proprietario')),
  token_hash TEXT NOT NULL UNIQUE,
  scade_il TIMESTAMPTZ NOT NULL,
  creato_da TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  usato_il TIMESTAMPTZ,
  annullato_il TIMESTAMPTZ
)`;
await tx`CREATE INDEX IF NOT EXISTS tenant_inviti_tenant_idx ON tenant_inviti (tenant_id, created_at DESC)`;
```

`verificaSchema` aggiunge `to_regclass('tenant_inviti') AS inviti` e lo controlla. Metodi:

```ts
const rigaInvito = (r: any): TenantInvito => ({
  id: Number(r.id), tenantId: Number(r.tenant_id), utenteId: Number(r.utente_id), email: r.email, tipo: r.tipo,
  scadeIl: new Date(r.scade_il), creatoDa: r.creato_da, createdAt: new Date(r.created_at),
  usatoIl: r.usato_il ? new Date(r.usato_il) : null, annullatoIl: r.annullato_il ? new Date(r.annullato_il) : null,
});
// nel repo Postgres:
async emettiInvito(input) {
  await ensureSchema();
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  const rows = await sql.begin(async tx => {
    await tx`UPDATE tenant_inviti SET annullato_il = NOW() WHERE tenant_id = ${input.tenantId} AND utente_id = ${input.utenteId} AND usato_il IS NULL AND annullato_il IS NULL AND scade_il > NOW()`;
    return tx`INSERT INTO tenant_inviti (tenant_id, utente_id, email, tipo, token_hash, scade_il, creato_da)
      VALUES (${input.tenantId}, ${input.utenteId}, ${input.email.trim().toLowerCase()}, ${input.tipo}, ${hash}, NOW() + make_interval(secs => ${TTL_INVITO_MS / 1000}), ${input.creatoDa}) RETURNING *`;
  });
  return { invito: rigaInvito(rows[0]), token };
},
async invitoPerToken(token) {
  await ensureSchema();
  const rows = await sql`SELECT * FROM tenant_inviti WHERE token_hash = ${createHash("sha256").update(token).digest("hex")} AND usato_il IS NULL AND annullato_il IS NULL AND scade_il > NOW()`;
  return rows.length ? rigaInvito(rows[0]) : null;
},
async consumaInvito(token) {
  await ensureSchema();
  const rows = await sql`UPDATE tenant_inviti SET usato_il = NOW() WHERE token_hash = ${createHash("sha256").update(token).digest("hex")} AND usato_il IS NULL AND annullato_il IS NULL AND scade_il > NOW() RETURNING *`;
  return rows.length ? rigaInvito(rows[0]) : null;
},
async invitiDi(tenantId) { await ensureSchema(); return (await sql`SELECT * FROM tenant_inviti WHERE tenant_id = ${tenantId} ORDER BY id DESC`).map(rigaInvito); },
async annullaInvito(id) { await ensureSchema(); const rows = await sql`UPDATE tenant_inviti SET annullato_il = COALESCE(annullato_il, NOW()) WHERE id = ${id} AND usato_il IS NULL RETURNING *`; return rows.length ? rigaInvito(rows[0]) : null; },
async pulisciInvitiScaduti() { await ensureSchema(); const rows = await sql`DELETE FROM tenant_inviti WHERE scade_il <= NOW() - interval '30 days' RETURNING id`; return rows.length; },
async comandiDi(tenantId, opzioni) {
  await ensureSchema();
  const ultimi = opzioni?.ultimi;
  const rows = ultimi != null && ultimi > 0
    ? await sql`SELECT * FROM tenant_comandi WHERE tenant_id = ${tenantId} ORDER BY id DESC LIMIT ${ultimi}`
    : await sql`SELECT * FROM tenant_comandi WHERE tenant_id = ${tenantId} ORDER BY id DESC`;
  return rows.map(rigaComando);
},
async storageTutti() { /* SELECT s.*, t.storage_quota_bytes FROM tenant_storage s JOIN tenants t ON t.id = s.tenant_id ORDER BY s.tenant_id → rigaStorage(r, quota) */ },
async eventiRecenti(input) {
  await ensureSchema();
  const rows = await sql`SELECT * FROM tenant_eventi WHERE tipo = ANY(${input.tipi}) AND created_at >= ${input.da} ORDER BY id`;
  return rows.map(rigaEvento);
},
async prendiEdEsegui(esegui, opzioni) {
  await ensureSchema();
  return sql.begin(async tx => {
    const rows = opzioni?.soloId != null
      ? await tx`SELECT * FROM tenant_comandi WHERE stato = 'in_attesa' AND id = ${opzioni.soloId} FOR UPDATE SKIP LOCKED`
      : await tx`SELECT * FROM tenant_comandi WHERE stato = 'in_attesa' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`;
    // … invariato
  });
},
```

(`storageTutti` Postgres: guardare come `storageDi` a riga 748 compone `rigaStorage(r, quotaBytes)` e replicarlo con un `JOIN`.)

- [ ] **Step 6: Attore piattaforma nell'esecutore** — in `server/tenants/servizio.ts`, `eseguiComando`:

```ts
const attore: Attore = comando.richiestoDa.startsWith("piattaforma:")
  ? { tipo: "piattaforma", email: comando.richiestoDa.slice("piattaforma:".length) }
  : { tipo: "script", nome: comando.richiestoDa };
```

Test in `servizio.test.ts`: un comando `sospendi` accodato con `richiestoDa: "piattaforma:t@r.it"` ed eseguito da `eseguiComandiInAttesa()` (flag acceso) produce l'evento `sospeso` con `attore === "piattaforma:t@r.it"`; con `richiestoDa: "script:tenant@x"` resta `script:tenant@x`.

- [ ] **Step 7: Pulizia al boot** — in `server/tenants/boot.ts`, accanto a `pulisciStateScaduti` (riga ~78): `const inviti = await repo.pulisciInvitiScaduti(); if (inviti) console.log(`[tenants] inviti scaduti rimossi: ${inviti}`);` nello stesso `try/catch` («[tenants] pulizia inviti:»).

- [ ] **Step 8: Test Postgres** — in `repository.pg.test.ts` aggiungere `tenant_inviti` alle due liste `DROP TABLE` e un test che ripete i due casi degli inviti su Postgres, più uno di concorrenza: due `consumaInvito(token)` lanciati con `Promise.all` → esattamente uno non nullo; `prendiEdEsegui({ soloId })` con due comandi. Eseguire con `--no-file-parallelism`.

- [ ] **Step 9: Run → PASS, check, commit**

```bash
npx vitest run server/tenants && pnpm check
git add server/tenants && git commit -m "feat(tenants): control plane del WS6 — tenant_inviti con token a senso unico, attore «piattaforma», letture in blocco e prendiEdEsegui per id"
```

---

### Task 2: `eseguiComandoSubito` e `consumoAziendeMese`

Spec §5.2, §4.4.

**Files:**
- Modify: `server/tenants/servizio.ts`, `server/tars/costi/ledger.ts`
- Test: `server/tenants/servizio.test.ts`, `server/tars/costi/ledger.test.ts`, `server/tars/costi/ledger.pg.test.ts`

**Interfaces:**
- Consumes: `prendiEdEsegui(esegui, { soloId })` (Task 1), `periodiLocali`, `costoContato`, `inSequenza` (ledger).
- Produces: `eseguiComandoSubito(id: number, opzioni?: { attesaMs?: number; passoMs?: number }): Promise<TenantComando>`; `LedgerCosti.consumoAziendeMese(input: { adesso: Date }): Promise<Map<number, number>>`.

- [ ] **Step 1: Test rossi** (`servizio.test.ts`, describe `eseguiComandoSubito`)

```ts
it("esegue subito il comando accodato e ne restituisce l'esito", async () => {
  process.env.FLAG_MULTI_AZIENDA = "on";
  const repo = getTenantRepository();
  await crea(inputAcme(), script);
  const c = await repo.accodaComando({ tipo: "sospendi", tenantId: repo.perSlug("acme")!.id, payload: { slug: "acme", motivo: "prova pannello" }, richiestoDa: "piattaforma:t@r.it" });
  const esito = await eseguiComandoSubito(c.id);
  expect(esito.stato).toBe("eseguito");
  expect(repo.perSlug("acme")?.stato).toBe("sospeso");
});
it("se il giro lo ha già preso, aspetta e restituisce la riga chiusa", async () => {
  process.env.FLAG_MULTI_AZIENDA = "on";
  const repo = getTenantRepository();
  await crea(inputAcme(), script);
  const c = await repo.accodaComando({ tipo: "riattiva", tenantId: repo.perSlug("acme")!.id, payload: { slug: "acme", motivo: "già attiva" }, richiestoDa: "piattaforma:t@r.it" });
  await eseguiComandiInAttesa(); // il giro lo consuma prima
  const esito = await eseguiComandoSubito(c.id, { attesaMs: 100, passoMs: 10 });
  expect(esito.id).toBe(c.id);
  expect(["eseguito", "errore"]).toContain(esito.stato);
});
it("a interruttore spento non esegue e lo dice", async () => {
  const repo = getTenantRepository();
  const c = await repo.accodaComando({ tipo: "ricalcola_storage", tenantId: 1, payload: { slug: "ruffino-group" }, richiestoDa: "piattaforma:t@r.it" });
  await expect(eseguiComandoSubito(c.id)).rejects.toThrow(/FLAG_MULTI_AZIENDA/);
});
```

- [ ] **Step 2: Implementazione** (in `servizio.ts`, sotto `eseguiComandiInAttesa`)

```ts
/**
 * WS6: il pannello accoda e vuole l'esito subito. Stessa funzione del giro,
 * preso in carico per id (FOR UPDATE SKIP LOCKED): se il giro lo ha già
 * preso, si aspetta che chiuda invece di rieseguire.
 */
export async function eseguiComandoSubito(id: number, opzioni: { attesaMs?: number; passoMs?: number } = {}): Promise<TenantComando> {
  if (!interruttoreAttivo("multiAzienda")) throw new Error(MESSAGGI.comandiSpenti); // costante nuova: «Con FLAG_MULTI_AZIENDA spento i comandi non vengono eseguiti.»
  const repo = getTenantRepository();
  await repo.prendiEdEsegui(eseguiComando, { soloId: id });
  const scadenza = Date.now() + (opzioni.attesaMs ?? 10_000);
  const passo = opzioni.passoMs ?? 500;
  for (;;) {
    const c = await repo.comando(id);
    if (!c) throw new Error(`Comando #${id} inesistente`);
    if (c.stato !== "in_attesa" || Date.now() >= scadenza) return c;
    await new Promise(r => setTimeout(r, passo));
  }
}
```

- [ ] **Step 3: Ledger** — interfaccia + due implementazioni:

```ts
/** WS6: la stessa somma di `consumoAziendaMese`, per tutte le aziende in una query (l'elenco del pannello). */
consumoAziendeMese(input: { adesso: Date }): Promise<Map<number, number>>;
// Postgres:
async consumoAziendeMese(input) {
  const db = sql(); await ensureCostiSchema();
  const righe = await db`SELECT COALESCE(tenant_id, 1) AS tenant_id,
      COALESCE(SUM(CASE stato WHEN 'released' THEN 0 WHEN 'settled' THEN COALESCE(costo_reale_nano, costo_prenotato_nano) ELSE costo_prenotato_nano END), 0) AS azienda
    FROM tars_costi WHERE mese_locale = ${periodiLocali(input.adesso).mese} GROUP BY COALESCE(tenant_id, 1)`;
  return new Map(righe.map((r: any) => [Number(r.tenant_id), Number(r.azienda)]));
},
// memoria:
consumoAziendeMese(input) {
  return inSequenza(() => {
    const { mese } = periodiLocali(input.adesso);
    const somme = new Map<number, number>();
    for (const r of righe) if (r.meseLocale === mese) somme.set(r.tenantId, (somme.get(r.tenantId) ?? 0) + costoContato(r));
    return somme;
  });
},
```

Test in `ledger.test.ts` (memoria: due aziende, righe released/settled/prenotate) e in `ledger.pg.test.ts` (una riga con `tenant_id NULL` conta per 1); `consumoAziendeMese(...).get(id) === consumoAziendaMese({tenantId: id})` per ogni azienda.

- [ ] **Step 4: Run → PASS, pg, check, commit**

```bash
npx vitest run server/tenants/servizio.test.ts server/tars/costi/ledger.test.ts && DATABASE_URL=postgres://postgres:test@localhost:55433/perf_test npx vitest run server/tars/costi/ledger.pg.test.ts --no-file-parallelism && pnpm check
git add server/tenants server/tars/costi && git commit -m "feat(tenants,tars): eseguiComandoSubito per il pannello e consumo Tars di tutte le aziende in una query"
```

---

### Task 3: Accesso — `PLATFORM_ADMIN_EMAILS`, `piattaformaProcedure`, conferma password, limitatore condiviso, sessione riusabile

Spec §3.

**Files:**
- Create: `server/piattaforma/accesso.ts`, `server/piattaforma/costanti.ts`, `server/_core/limiteTentativi.ts`
- Modify: `server/_core/trpc.ts`, `server/routers.ts` (login sul limitatore condiviso e su `apriSessioneLocale`), `server/localAuth.ts`, `server/tenants/router.ts` (`mio.piattaforma`)
- Test: `server/piattaforma/accesso.test.ts`, `server/_core/limiteTentativi.test.ts`, `server/tenants/router.test.ts`

**Interfaces:**
- Consumes: `verifyPassword` (`server/_core/password.ts:52`), `getUtentiStore` (`server/routers/utenti.ts`), `conTenant`, `createLocalToken`, `getSessionCookieOptions`, `COOKIE_NAME`.
- Produces: `emailAmministratori()`, `amministraPiattaforma(user)`, `confermaPassword(ctx, password)`, `piattaformaProcedure`, `creaLimiteTentativi`, `apriSessioneLocale(ctx, utente)`, `MESSAGGI_PIATTAFORMA`, `tenants.mio.piattaforma`.

- [ ] **Step 1: `server/piattaforma/costanti.ts`**

```ts
export const MESSAGGI_PIATTAFORMA = {
  nonAmministratore: "Questa sezione è riservata all'amministrazione della piattaforma.",
  passwordNonCorretta: "Password non corretta.",
  solaLetturaFlagSpento: "Con FLAG_MULTI_AZIENDA spento il pannello è in sola lettura.",
  invitoNonValido: "Questo invito non è valido o è scaduto: chiedi un nuovo invito.",
  postaNonConfigurata: "Posta della piattaforma non configurata: copia il link e consegnalo a mano.",
  proprietarioAmbiguo: "L'azienda ha più proprietari: indica l'email di chi invitare.",
  tenantGiaEsistente: "L'azienda esiste già: nessun invito inviato.",
  troppiTentativi: "Troppi tentativi di accesso. Riprova tra qualche minuto.",
} as const;
export const VARIABILE_AMMINISTRATORI = "PLATFORM_ADMIN_EMAILS";
export const VARIABILE_BASE_URL = "APP_BASE_URL";
```

- [ ] **Step 2: Test rossi del limitatore** (`server/_core/limiteTentativi.test.ts`)

```ts
import { describe, expect, it, vi } from "vitest";
import { creaLimiteTentativi } from "./limiteTentativi";
describe("creaLimiteTentativi", () => {
  it("blocca al massimo dentro la finestra, riapre dopo, azzera su successo", () => {
    vi.useFakeTimers({ now: new Date("2026-09-09T10:00:00Z") });
    const l = creaLimiteTentativi({ finestraMs: 1000, massimo: 2, messaggio: "troppi" });
    expect(() => l.verifica("A@x.it")).not.toThrow();
    l.fallito("a@x.it"); l.fallito("a@x.it");
    expect(() => l.verifica("a@x.it")).toThrow(/troppi/);
    vi.advanceTimersByTime(1001);
    expect(() => l.verifica("a@x.it")).not.toThrow();
    l.fallito("a@x.it"); l.fallito("a@x.it"); l.azzera("a@x.it");
    expect(() => l.verifica("a@x.it")).not.toThrow();
    vi.useRealTimers();
  });
});
```

Implementazione `server/_core/limiteTentativi.ts`: stessa logica di `routers.ts:60-96` (mappa in memoria, chiave minuscola, `TOO_MANY_REQUESTS`), parametrizzata; `routers.ts` la usa con `{ finestraMs: 15 * 60 * 1000, massimo: 5, messaggio: "Troppi tentativi di accesso. Riprova tra qualche minuto." }` e le tre funzioni locali spariscono (i test esistenti del login restano verdi).

- [ ] **Step 3: `apriSessioneLocale`** — in `server/localAuth.ts`:

```ts
export function localUserDa(utente: any): LocalUser { /* il blocco «ruoli/primaryRuolo/localUser» di routers.ts:130-146, identico */ }
export async function apriSessioneLocale(ctx: { req: Request; res: Response }, utente: any): Promise<LocalUser> {
  const localUser = localUserDa(utente);
  const token = await createLocalToken(localUser);
  ctx.res.cookie(COOKIE_NAME, token, { ...getSessionCookieOptions(ctx.req), maxAge: 7 * 24 * 60 * 60 * 1000 });
  return localUser;
}
```

`auth.login` chiama `apriSessioneLocale(ctx, utente)` al posto del blocco inline. (Attenzione al ciclo di import: `cookies.ts` è già importato da `routers.ts`; `localAuth.ts` può importarlo senza ciclo.)

- [ ] **Step 4: Test rossi dell'accesso** (`server/piattaforma/accesso.test.ts`)

```ts
import { afterEach, describe, expect, it } from "vitest";
import { amministraPiattaforma, emailAmministratori } from "./accesso";
afterEach(() => { delete process.env.PLATFORM_ADMIN_EMAILS; });
describe("amministraPiattaforma", () => {
  it("vero solo per utente attivo del tenant 1 con email in elenco (senza maiuscole né spazi)", () => {
    process.env.PLATFORM_ADMIN_EMAILS = " T.Ruffino@ruffinogroup.it , altro@x.it";
    expect([...emailAmministratori()]).toEqual(["t.ruffino@ruffinogroup.it", "altro@x.it"]);
    expect(amministraPiattaforma({ email: "t.ruffino@RUFFINOGROUP.it", tenantId: 1, attivo: true })).toBe(true);
    expect(amministraPiattaforma({ email: "t.ruffino@ruffinogroup.it", tenantId: 2, attivo: true })).toBe(false);
    expect(amministraPiattaforma({ email: "t.ruffino@ruffinogroup.it", tenantId: 1, attivo: false })).toBe(false);
    expect(amministraPiattaforma({ email: "nessuno@x.it", tenantId: 1, attivo: true })).toBe(false);
    expect(amministraPiattaforma(null)).toBe(false);
  });
  it("con la variabile vuota nessuno amministra", () => {
    expect(amministraPiattaforma({ email: "t.ruffino@ruffinogroup.it", tenantId: 1, attivo: true })).toBe(false);
  });
});
```

- [ ] **Step 5: `server/piattaforma/accesso.ts`**

```ts
import { TRPCError } from "@trpc/server";
import { creaLimiteTentativi } from "../_core/limiteTentativi";
import { verifyPassword } from "../_core/password";
import { getUtentiStore } from "../routers/utenti";
import { TENANT_PREDEFINITO_ID } from "../tenants/costanti";
import { conTenant } from "../tenants/contestoCorrente";
import { MESSAGGI_PIATTAFORMA, VARIABILE_AMMINISTRATORI } from "./costanti";

export function emailAmministratori(): Set<string> {
  return new Set((process.env[VARIABILE_AMMINISTRATORI] ?? "").split(",").map(e => e.trim().toLowerCase()).filter(Boolean));
}
export function amministraPiattaforma(user: { email?: string | null; tenantId?: number | null; attivo?: boolean } | null | undefined): boolean {
  if (!user?.email || user.attivo === false) return false;
  if ((user.tenantId ?? null) !== TENANT_PREDEFINITO_ID) return false;
  return emailAmministratori().has(user.email.trim().toLowerCase());
}
/** Il record vivo dell'utente della sessione, riletto dallo store del tenant 1 (ruoli e `attivo` non vengono dal JWT). */
export function utenteAmministratore(user: { id: number } | null): any | null {
  if (!user) return null;
  const record = conTenant(TENANT_PREDEFINITO_ID, () => getUtentiStore().find((u: any) => u.id === user.id) ?? null);
  return record && amministraPiattaforma({ email: record.email, tenantId: record.tenantId, attivo: record.attivo }) ? record : null;
}
const limiteConferme = creaLimiteTentativi({ finestraMs: 15 * 60 * 1000, massimo: 5, messaggio: MESSAGGI_PIATTAFORMA.troppiTentativi });
export function confermaPassword(user: { id: number; email?: string | null }, password: string): void {
  const chiave = `conferma:${(user.email ?? String(user.id)).toLowerCase()}`;
  limiteConferme.verifica(chiave);
  const record = utenteAmministratore(user);
  if (!record || !verifyPassword(password, record.password)) {
    limiteConferme.fallito(chiave);
    console.warn(`[piattaforma] conferma password rifiutata per ${(user.email ?? "").split("@")[1] ?? "?"}`);
    throw new TRPCError({ code: "UNAUTHORIZED", message: MESSAGGI_PIATTAFORMA.passwordNonCorretta });
  }
  limiteConferme.azzera(chiave);
}
export function __azzeraLimiteConfermePerTest(): void { if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY"); limiteConferme.__azzeraTutto(); }
```

(`creaLimiteTentativi` espone anche `__azzeraTutto()` per i test.)

- [ ] **Step 6: `piattaformaProcedure`** in `server/_core/trpc.ts` (import dinamico NON necessario: `accesso.ts` importa `routers/utenti` come fa `tenants/servizio.ts`; se `tsc` segnala un ciclo `trpc.ts → accesso.ts → utenti.ts → trpc.ts`, spostare `utenteAmministratore` dietro `await import("../piattaforma/accesso")` dentro il middleware):

```ts
/** WS6: chi amministra la piattaforma. Autenticato, SENZA guardia tenant: agisce SU altre aziende. */
const requirePiattaforma = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  const { utenteAmministratore } = await import("../piattaforma/accesso");
  const record = utenteAmministratore(ctx.user as any);
  if (!record) throw new TRPCError({ code: "FORBIDDEN", message: MESSAGGI_PIATTAFORMA.nonAmministratore });
  return next({ ctx: { ...ctx, user: ctx.user, amministratore: { id: Number(record.id), email: String(record.email).toLowerCase() } } });
});
export const piattaformaProcedure = publicProcedure.use(requirePiattaforma);
```

Test (in `accesso.test.ts`, con un router di prova `router({ p: piattaformaProcedure.query(({ ctx }) => ctx.amministratore) })` e un contesto come `router.test.ts:29-45` con `user.id` di un utente seminato in `getUtentiStore()` dentro `conTenant(1, …)`): anonimo → `UNAUTHORIZED`; utente non in elenco → `FORBIDDEN`; in elenco → `{ id, email }`. `confermaPassword`: giusta → nessun errore; sbagliata ×5 → la sesta è `TOO_MANY_REQUESTS`.

- [ ] **Step 7: `tenants.mio.piattaforma`** — in `server/tenants/router.ts` aggiungere al risultato di `mio`: `piattaforma: amministraPiattaforma(utenteDellaSessione)` dove il record viene riletto con `conTenant(TENANT_PREDEFINITO_ID, () => getUtentiStore().find(u => u.id === ctx.user.id))` (il ramo OAuth senza `id` numerico → `false`). Test in `router.test.ts`: con `PLATFORM_ADMIN_EMAILS` che contiene l'email dell'utente seminato → `true`; senza → `false`.

- [ ] **Step 8: Run → PASS, check, commit**

```bash
npx vitest run server/piattaforma server/_core/limiteTentativi.test.ts server/tenants/router.test.ts server/routers.test.ts 2>/dev/null; npx vitest run server && pnpm check
git add server && git commit -m "feat(piattaforma): accesso al pannello — PLATFORM_ADMIN_EMAILS, piattaformaProcedure, conferma della password col limitatore del login condiviso, sessione locale riusabile"
```

---

### Task 4: Posta della piattaforma (Resend via `fetch`) e testo dell'invito

Spec §7.

**Files:**
- Create: `server/_core/postaPiattaforma.ts`, `server/piattaforma/testi.ts`
- Test: `server/_core/postaPiattaforma.test.ts`, `server/piattaforma/testi.test.ts`

**Interfaces:**
- Produces: `inviaPosta(m: MessaggioPosta): Promise<EsitoPosta>`, `postaConfigurata(): boolean`, `__impostaPostaPerTest(finta | null)`, `testoInvito(input: { nome: string; azienda: string; link: string; giorni: number }): { oggetto: string; testo: string; html: string }`.

- [ ] **Step 1: Test rossi** (`postaPiattaforma.test.ts`)

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { __impostaPostaPerTest, inviaPosta, postaConfigurata } from "./postaPiattaforma";
const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; delete process.env.RESEND_API_KEY; delete process.env.POSTA_PIATTAFORMA_MITTENTE; __impostaPostaPerTest(null); vi.restoreAllMocks(); });
const m = { a: "mario@acme.test", oggetto: "Prova", testo: "ciao" };
describe("inviaPosta", () => {
  it("senza chiave: non configurata, non lancia", async () => {
    expect(postaConfigurata()).toBe(false);
    expect(await inviaPosta(m)).toEqual({ inviato: false, motivo: expect.stringContaining("non configurata") });
  });
  it("con chiave: POST a Resend con mittente, destinatario e testo", async () => {
    process.env.RESEND_API_KEY = "re_test";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "em_1" }), { status: 200 }));
    global.fetch = fetchMock as any;
    expect(await inviaPosta(m)).toEqual({ inviato: true, id: "em_1" });
    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer re_test");
    expect(JSON.parse(init.body)).toMatchObject({ from: "Wyndoor <noreply@wyndoor.com>", to: ["mario@acme.test"], subject: "Prova", text: "ciao" });
  });
  it("4xx e rete rotta: inviato false con motivo, senza corpo nel log", async () => {
    process.env.RESEND_API_KEY = "re_test";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    global.fetch = vi.fn(async () => new Response("{\"message\":\"segreto\"}", { status: 422 })) as any;
    expect(await inviaPosta(m)).toEqual({ inviato: false, motivo: "Resend ha risposto 422" });
    global.fetch = vi.fn(async () => { throw new Error("ECONNRESET"); }) as any;
    expect((await inviaPosta(m)).inviato).toBe(false);
    expect(warn.mock.calls.flat().join(" ")).not.toContain("segreto");
    expect(warn.mock.calls.flat().join(" ")).not.toContain("mario@acme.test");
    expect(warn.mock.calls.flat().join(" ")).toContain("acme.test");
  });
});
```

- [ ] **Step 2: Implementazione** (`server/_core/postaPiattaforma.ts`)

```ts
export type MessaggioPosta = { a: string; oggetto: string; testo: string; html?: string };
export type EsitoPosta = { inviato: true; id: string } | { inviato: false; motivo: string };
type Mittente = (m: MessaggioPosta) => Promise<EsitoPosta>;
const MITTENTE_PREDEFINITO = "Wyndoor <noreply@wyndoor.com>";
const URL_RESEND = "https://api.resend.com/emails";
let finta: Mittente | null = null;
export function postaConfigurata(): boolean { return Boolean(process.env.RESEND_API_KEY?.trim()); }
const dominio = (a: string) => a.split("@")[1] ?? "?";
async function inviaConResend(m: MessaggioPosta): Promise<EsitoPosta> {
  const chiave = process.env.RESEND_API_KEY?.trim();
  if (!chiave) return { inviato: false, motivo: "Posta della piattaforma non configurata (RESEND_API_KEY)" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const r = await fetch(URL_RESEND, { method: "POST", signal: controller.signal,
      headers: { Authorization: `Bearer ${chiave}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.POSTA_PIATTAFORMA_MITTENTE?.trim() || MITTENTE_PREDEFINITO, to: [m.a], subject: m.oggetto, text: m.testo, html: m.html }) });
    if (!r.ok) return { inviato: false, motivo: `Resend ha risposto ${r.status}` };
    const corpo = (await r.json().catch(() => ({}))) as { id?: string };
    return { inviato: true, id: String(corpo.id ?? "") };
  } catch (e) {
    return { inviato: false, motivo: e instanceof Error && e.name === "AbortError" ? "Resend non ha risposto entro 10 s" : `Rete: ${e instanceof Error ? e.message : String(e)}` };
  } finally { clearTimeout(timer); }
}
export async function inviaPosta(m: MessaggioPosta): Promise<EsitoPosta> {
  const esito = await (finta ?? inviaConResend)(m);
  if (esito.inviato) console.log(`[posta] invio a ${dominio(m.a)}: ok`);
  else console.warn(`[posta] invio a ${dominio(m.a)}: fallito (${esito.motivo})`);
  return esito;
}
export function __impostaPostaPerTest(f: Mittente | null): void { if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY_POSTA"); finta = f; }
```

- [ ] **Step 3: Testo dell'invito** (`server/piattaforma/testi.ts` + test che verifica oggetto, presenza del link, «7 giorni», «una volta sola», grafia «Wyndoor», e che l'HTML contenga `href="<link>"` con il testo escapato):

```ts
export function testoInvito(input: { nome: string; azienda: string; link: string; giorni: number }): { oggetto: string; testo: string; html: string } {
  const oggetto = `Il tuo accesso a Wyndoor per ${input.azienda}`;
  const testo = [`Ciao ${input.nome},`, ``, `la piattaforma Wyndoor ha creato per te l'accesso all'azienda ${input.azienda}.`, `Scegli la tua password da qui:`, input.link, ``,
    `Il link vale ${input.giorni} giorni e si usa una volta sola. Se non aspettavi questo messaggio, ignoralo.`, ``, `Wyndoor`].join("\n");
  const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const html = `<p>Ciao ${esc(input.nome)},</p><p>la piattaforma Wyndoor ha creato per te l'accesso all'azienda <strong>${esc(input.azienda)}</strong>. Scegli la tua password da qui:</p><p><a href="${esc(input.link)}">${esc(input.link)}</a></p><p>Il link vale ${input.giorni} giorni e si usa una volta sola. Se non aspettavi questo messaggio, ignoralo.</p><p>Wyndoor</p>`;
  return { oggetto, testo, html };
}
```

- [ ] **Step 4: Run → PASS, check, commit**

```bash
npx vitest run server/_core/postaPiattaforma.test.ts server/piattaforma/testi.test.ts && pnpm check
git add server/_core/postaPiattaforma.ts server/_core/postaPiattaforma.test.ts server/piattaforma/testi.ts server/piattaforma/testi.test.ts && git commit -m "feat(posta): mittente transazionale della piattaforma (Resend via fetch, mai lancia, log senza indirizzi) e testo dell'invito"
```

---

### Task 5: Inviti — servizio, router pubblico `inviti`, sessione all'accettazione

Spec §6.

**Files:**
- Create: `server/piattaforma/inviti.ts`, `server/piattaforma/invitiRouter.ts`
- Modify: `server/routers.ts` (monta `inviti: invitiRouter`; esporta `passwordSchema` da `utenti.ts` o duplica in `inviti.ts` con lo stesso testo)
- Test: `server/piattaforma/inviti.test.ts`, `server/piattaforma/invitiRouter.test.ts`

**Interfaces:**
- Consumes: `emettiInvito`/`consumaInvito`/`invitoPerToken` (Task 1), `inviaPosta` + `testoInvito` (Task 4), `apriSessioneLocale` e `creaLimiteTentativi` (Task 3), `hashPassword`, `getUtentiStore`, `getUtentiPersistedStore`, `conTenant`, `RUOLO_PROPRIETARIO`.
- Produces: `invitaProprietario`, `accettaInvito`, `anteprimaInvito`, `baseUrlDa(req)`, router `inviti` con `anteprima` e `accetta`.

- [ ] **Step 1: Test rossi del servizio** (`inviti.test.ts`; setup come `servizio.test.ts`: `resetTenantRepositoryForTesting`, `crea(inputAcme(), script)` per avere tenant, sede e proprietario; `__impostaPostaPerTest`)

```ts
const piattaforma = { tipo: "piattaforma" as const, email: "t@r.it" };
it("invita l'unico proprietario, manda la posta e registra l'evento senza token", async () => {
  const inviati: any[] = []; __impostaPostaPerTest(async m => { inviati.push(m); return { inviato: true, id: "em_1" }; });
  const { tenant } = await crea(inputAcme(), script);
  const esito = await invitaProprietario({ tenantId: tenant.id, attore: piattaforma, adesso: T0, baseUrl: "https://crm.test" });
  expect(esito.inviato).toBe(true);
  expect(esito.link).toMatch(/^https:\/\/crm\.test\/invito\/[A-Za-z0-9_-]{40,}$/);
  expect(inviati[0].a).toBe("mario@acme.test");
  expect(inviati[0].testo).toContain(esito.link);
  const eventi = await getTenantRepository().eventi(tenant.id);
  const ev = eventi.find(e => e.tipo === "invito_inviato")!;
  expect(ev.attore).toBe("piattaforma:t@r.it");
  expect(JSON.stringify(ev.dettagli)).not.toContain(esito.link.split("/invito/")[1]);
  expect(ev.dettagli).toMatchObject({ email: "mario@acme.test", inviato: true });
});
it("senza posta: il link torna comunque e l'evento dice perché", async () => {
  __impostaPostaPerTest(async () => ({ inviato: false, motivo: "non configurata" }));
  const { tenant } = await crea(inputAcme(), script);
  const esito = await invitaProprietario({ tenantId: tenant.id, attore: piattaforma, adesso: T0, baseUrl: "https://crm.test" });
  expect(esito).toMatchObject({ inviato: false, motivo: "non configurata" });
  expect(esito.link).toContain("/invito/");
});
it("accetta: imposta la password, attiva l'utente, brucia il token, registra l'evento", async () => {
  __impostaPostaPerTest(async () => ({ inviato: true, id: "x" }));
  const { tenant, utenteId } = await crea(inputAcme(), script);
  const { link } = await invitaProprietario({ tenantId: tenant.id, attore: piattaforma, adesso: T0, baseUrl: "https://crm.test" });
  const token = link.split("/invito/")[1];
  expect(await anteprimaInvito({ token, adesso: T0 })).toMatchObject({ azienda: "Acme Infissi", email: "mario@acme.test", nome: "Mario" });
  const esito = await accettaInvito({ token, password: "Password-nuova-12", adesso: T0 });
  expect(esito).toEqual({ tenantId: tenant.id, utenteId, email: "mario@acme.test" });
  const utente = conTenant(tenant.id, () => getUtentiStore().find((u: any) => u.id === utenteId));
  expect(verifyPassword("Password-nuova-12", utente.password)).toBe(true);
  expect(utente.attivo).toBe(true);
  await expect(accettaInvito({ token, password: "Password-nuova-12", adesso: T0 })).rejects.toThrow(MESSAGGI_PIATTAFORMA.invitoNonValido);
  expect(await anteprimaInvito({ token, adesso: T0 })).toBeNull();
});
it("con più proprietari senza email rifiuta; con email invita quello", async () => { /* aggiungere un secondo proprietario con creaUtenteInterno dentro conTenant; attendersi MESSAGGI_PIATTAFORMA.proprietarioAmbiguo; poi email esplicita → ok */ });
```

- [ ] **Step 2: Implementazione** (`server/piattaforma/inviti.ts`)

```ts
import { hashPassword } from "../_core/password";
import { inviaPosta } from "../_core/postaPiattaforma";
import { getUtentiPersistedStore, getUtentiStore } from "../routers/utenti";
import { RUOLO_PROPRIETARIO, TTL_INVITO_MS } from "../tenants/costanti";
import { conTenant } from "../tenants/contestoCorrente";
import { getTenantRepository } from "../tenants/repository";
import { attoreTesto, type Attore } from "../tenants/tipi";
import { MESSAGGI_PIATTAFORMA, VARIABILE_BASE_URL } from "./costanti";
import { testoInvito } from "./testi";

export function baseUrlDa(req: { protocol: string; get(n: string): string | undefined }): string {
  const cfg = process.env[VARIABILE_BASE_URL]?.trim().replace(/\/+$/, "");
  return cfg || `${req.protocol}://${req.get("host")}`;
}
function proprietarioDa(tenantId: number, scelta: { utenteId?: number; email?: string }): any {
  return conTenant(tenantId, () => {
    const utenti = getUtentiStore().filter((u: any) => u.tenantId === tenantId);
    if (scelta.utenteId != null) return utenti.find((u: any) => u.id === scelta.utenteId) ?? null;
    if (scelta.email) return utenti.find((u: any) => u.email.toLowerCase() === scelta.email!.trim().toLowerCase()) ?? null;
    const proprietari = utenti.filter((u: any) => (u.ruoli ?? []).includes(RUOLO_PROPRIETARIO));
    if (proprietari.length > 1) throw new Error(MESSAGGI_PIATTAFORMA.proprietarioAmbiguo);
    return proprietari[0] ?? null;
  });
}
export async function invitaProprietario(input: { tenantId: number; utenteId?: number; email?: string; attore: Attore; adesso: Date; baseUrl: string }) {
  const repo = getTenantRepository();
  const tenant = repo.perId(input.tenantId);
  if (!tenant) throw new Error("Azienda inesistente");
  const utente = proprietarioDa(input.tenantId, input);
  if (!utente) throw new Error("Proprietario non trovato");
  const { invito, token } = await repo.emettiInvito({ tenantId: tenant.id, utenteId: utente.id, email: utente.email, tipo: "proprietario", creatoDa: attoreTesto(input.attore), adesso: input.adesso });
  const link = `${input.baseUrl}/invito/${token}`;
  const posta = await inviaPosta({ a: utente.email, ...testoInvito({ nome: utente.nome, azienda: tenant.nome, link, giorni: Math.round(TTL_INVITO_MS / 86_400_000) }) });
  await repo.registraEvento({ tenantId: tenant.id, tipo: "invito_inviato", attore: attoreTesto(input.attore),
    dettagli: { invitoId: invito.id, utenteId: utente.id, email: utente.email, scadeIl: invito.scadeIl.toISOString(), inviato: posta.inviato, ...(posta.inviato ? {} : { motivo: posta.motivo }) } });
  return { invito, link, inviato: posta.inviato, ...(posta.inviato ? {} : { motivo: posta.motivo }) };
}
export async function anteprimaInvito(input: { token: string; adesso: Date }) {
  const repo = getTenantRepository();
  const invito = await repo.invitoPerToken(input.token, input.adesso);
  if (!invito) return null;
  const tenant = repo.perId(invito.tenantId);
  const utente = conTenant(invito.tenantId, () => getUtentiStore().find((u: any) => u.id === invito.utenteId));
  if (!tenant || !utente) return null;
  return { azienda: tenant.nome, email: invito.email, nome: utente.nome, scadeIl: invito.scadeIl };
}
export async function accettaInvito(input: { token: string; password: string; adesso: Date }) {
  const repo = getTenantRepository();
  const invito = await repo.consumaInvito(input.token, input.adesso);
  if (!invito) throw new Error(MESSAGGI_PIATTAFORMA.invitoNonValido);
  const email = conTenant(invito.tenantId, () => {
    const utente = getUtentiStore().find((u: any) => u.id === invito.utenteId);
    if (!utente) throw new Error(MESSAGGI_PIATTAFORMA.invitoNonValido);
    utente.password = hashPassword(input.password);
    utente.attivo = true;
    utente.updatedAt = input.adesso;
    getUtentiPersistedStore().save();
    return utente.email as string;
  });
  await repo.registraEvento({ tenantId: invito.tenantId, tipo: "invito_accettato", attore: `utente:${invito.utenteId}`, dettagli: { invitoId: invito.id, utenteId: invito.utenteId } });
  return { tenantId: invito.tenantId, utenteId: invito.utenteId, email };
}
```

- [ ] **Step 3: Router pubblico** (`server/piattaforma/invitiRouter.ts`)

```ts
const limiteInviti = creaLimiteTentativi({ finestraMs: 15 * 60 * 1000, massimo: 5, messaggio: MESSAGGI_PIATTAFORMA.troppiTentativi });
const chiaveToken = (t: string) => `invito:${createHash("sha256").update(t).digest("hex").slice(0, 32)}`;
export const invitiRouter = router({
  anteprima: publicProcedure.input(z.object({ token: z.string().min(20).max(200) })).query(async ({ input }) => {
    const a = await anteprimaInvito({ token: input.token, adesso: new Date() });
    if (!a) throw new TRPCError({ code: "NOT_FOUND", message: MESSAGGI_PIATTAFORMA.invitoNonValido });
    return a;
  }),
  accetta: publicProcedure.input(z.object({ token: z.string().min(20).max(200), password: passwordSchema })).mutation(async ({ input, ctx }) => {
    const chiave = chiaveToken(input.token);
    limiteInviti.verifica(chiave);
    let esito;
    try { esito = await accettaInvito({ token: input.token, password: input.password, adesso: new Date() }); }
    catch (e) { limiteInviti.fallito(chiave); throw new TRPCError({ code: "NOT_FOUND", message: MESSAGGI_PIATTAFORMA.invitoNonValido }); }
    limiteInviti.azzera(chiave);
    const utente = conTenant(esito.tenantId, () => getUtentiStore().find((u: any) => u.id === esito.utenteId));
    return apriSessioneLocale(ctx, utente);
  }),
});
```

Montaggio in `server/routers.ts`: `inviti: invitiRouter`. Test `invitiRouter.test.ts`: anteprima valida/non valida; `accetta` imposta il cookie (`ctx.res.cookie` finto chiamato con `COOKIE_NAME`) e ritorna `LocalUser` con `email`; token sbagliato ×5 → sesta `TOO_MANY_REQUESTS`.

- [ ] **Step 4: Run → PASS, check, commit**

```bash
npx vitest run server/piattaforma && pnpm check
git add server && git commit -m "feat(piattaforma): inviti al proprietario — servizio con posta e ripiego sul link, pagina pubblica lato server, accettazione che imposta la password e apre la sessione"
```

---

### Task 6: Router `piattaforma` — letture (`aziende`, `azienda`, `comando`) e guardia strutturale

Spec §5.1, §5.3.

**Files:**
- Create: `server/piattaforma/letture.ts`, `server/piattaforma/router.ts`, `server/piattaforma/confine.test.ts`
- Modify: `server/routers.ts` (monta `piattaforma: piattaformaRouter`)
- Test: `server/piattaforma/router.test.ts`, `server/piattaforma/letture.test.ts`

**Interfaces:**
- Consumes: Task 1–3 (repo, `piattaformaProcedure`), `workerSospesi` (`server/tenants/cli.ts:38`), `backupLog` (`server/_core/driveBackup.ts:1516`), `consumoAziendeMese`, `bloccoStorage` e `sogliaTars` (`server/abbonamenti/quota.ts`), `nanoInEur`, `meseLocale`, `giorniAllaScadenza`, `oppureNotFound`.
- Produces: `AziendaRiga`, `SchedaAzienda`, `elencoAziende(adesso)`, `schedaAzienda(slug, adesso)`; procedure `piattaforma.aziende`, `piattaforma.azienda`, `piattaforma.comando`.

- [ ] **Step 1: Test rossi** (`router.test.ts`; setup: `resetTenantRepositoryForTesting`, `impostaLedgerPerTest(creaLedgerMemoriaPerTest())`, `PLATFORM_ADMIN_EMAILS` con l'email dell'utente amministratore seminato in `conTenant(1, …)` via `creaUtenteInterno`, due aziende con `crea(...)` a flag acceso, `vi.useFakeTimers({ now: T0, toFake: ["Date"] })`)

```ts
it("aziende: una riga per azienda con abbonamento, spazio, Tars, worker, backup e proprietari, in poche query", async () => {
  const repo = getTenantRepository();
  const spia = { storageTutti: vi.spyOn(repo, "storageTutti"), storageDi: vi.spyOn(repo, "storageDi"), eventi: vi.spyOn(repo, "eventi"), comandiInAttesa: vi.spyOn(repo, "comandiInAttesa") };
  const righe = await caller.aziende();
  expect(righe.map(r => r.slug)).toEqual(["ruffino-group", "acme", "beta"]);
  expect(righe[1]).toMatchObject({ stato: "attivo", abbonamento: { tipo: "paid", stato: "trialing" }, proprietari: [{ email: "mario@acme.test" }] });
  expect(righe[1].tars).toMatchObject({ budgetEur: 25, consumoEur: 0, percentuale: 0 });
  expect(spia.storageTutti).toHaveBeenCalledTimes(1);
  expect(spia.storageDi).not.toHaveBeenCalled();
  expect(spia.eventi).not.toHaveBeenCalled(); // i worker sospesi vengono da eventiRecenti, una query
  expect(spia.comandiInAttesa).toHaveBeenCalledTimes(1);
});
it("azienda: scheda completa; slug sconosciuto → NOT_FOUND «Risorsa non trovata.»", async () => {
  const scheda = await caller.azienda({ slug: "acme" });
  expect(scheda.sedi).toHaveLength(1);
  expect(scheda.abbonamento?.budgetTarsEur).toBe(25);
  expect(scheda.eventi.map(e => e.tipo)).toContain("creato");
  expect(scheda.comandi).toEqual([]);
  await expect(caller.azienda({ slug: "nessuna" })).rejects.toMatchObject({ code: "NOT_FOUND", message: "Risorsa non trovata." });
});
it("non amministratore → FORBIDDEN; nessuna procedura accetta tenantId", async () => {
  await expect(piattaformaRouter.createCaller(context(1, SEDE, ["direzione"], utenteNonInElenco)).aziende()).rejects.toMatchObject({ code: "FORBIDDEN" });
});
```

- [ ] **Step 2: `letture.ts`** — struttura (dati letti in blocco, poi composti per azienda):

```ts
export async function elencoAziende(adesso: Date): Promise<AziendaRiga[]> {
  const repo = getTenantRepository();
  const tenants = repo.tutti();
  const [storage, eventiWorker, inAttesa, consumi] = await Promise.all([
    repo.storageTutti(),
    repo.eventiRecenti({ tipi: ["worker_sospeso", "worker_riarmato"], da: new Date(adesso.getTime() - 24 * 3600_000) }),
    repo.comandiInAttesa(),
    consumiTars(adesso), // ledgerAutorevoleDisponibile() ? ledgerCorrente().consumoAziendeMese({ adesso }) : null (null = «non lo so», mai zero)
  ]);
  const storagePer = new Map(storage.map(s => [s.tenantId, s]));
  return tenants.map(t => rigaAzienda(t, { storage: storagePer.get(t.id) ?? null, abbonamento: repo.abbonamentoDi(t.id),
    workerSospesi: workerSospesi(eventiWorker.filter(e => e.tenantId === t.id), adesso), comandiInAttesa: inAttesa.filter(c => c.tenantId === t.id).length,
    consumoNano: consumi?.get(t.id) ?? (consumi ? 0 : null), adesso }));
}
function rigaAzienda(t: TenantRecord, d: …): AziendaRiga {
  // proprietari e ultimo backup: letture IN MEMORIA dentro il contesto dell'azienda (control plane: chi la possiede e l'esito dell'ultimo backup, non i suoi dati business)
  const proprietari = conTenant(t.id, () => getUtentiStore().filter((u: any) => u.tenantId === t.id && (u.ruoli ?? []).includes(RUOLO_PROPRIETARIO)).map(u => ({ id: u.id, nome: u.nome, cognome: u.cognome, email: u.email, attivo: u.attivo !== false })));
  const ultimoBackup = conTenant(t.id, () => backupLog(1)[0] ?? null);
  const blocco = d.storage && d.abbonamento ? bloccoStorage(d.storage, d.abbonamento, d.adesso) : { bloccato: false, bloccoDal: null };
  // … abbonamento in unità umane (nanoInEur, giorniAllaScadenza), tars: { mese: meseLocale(adesso), consumoEur, budgetEur, extraEur, percentuale, bloccoDal }
}
export async function schedaAzienda(slug: string, adesso: Date): Promise<SchedaAzienda | null> { /* elenco filtrato a una riga + repo.eventi(id, { ultimi: 50 }) + repo.comandiDi(id, { ultimi: 20 }) + repo.invitiDi(id) + conTenant(id, () => backupLog(5)) + sedi via repo.tenantSedi() e getSediStore() dentro conTenant */ }
```

- [ ] **Step 3: `router.ts`** (letture)

```ts
export const piattaformaRouter = router({
  aziende: piattaformaProcedure.query(() => elencoAziende(new Date())),
  azienda: piattaformaProcedure.input(z.object({ slug: z.string().regex(SLUG_RE) })).query(async ({ input }) => oppureNotFound(await schedaAzienda(input.slug, new Date()))),
  comando: piattaformaProcedure.input(z.object({ id: z.number().int().positive() })).query(({ input }) => getTenantRepository().comando(input.id)),
});
```

- [ ] **Step 4: Guardia strutturale** (`server/piattaforma/confine.test.ts`, stesso stile di `server/tenants/confine.test.ts`): i sorgenti di `server/piattaforma/` non contengono `storeDi(`; non importano `../routers/` salvo `../routers/utenti` e `../routers/sedi`; non importano `comunicazioni/`, `fatture/`, `documenti/`, `tars/strumenti/`; nessun `console.log|warn|error` con la parola `token`; e nessuno schema con `tenantId:` (già coperto dalla guardia globale — ripeterlo qui costa una riga).

- [ ] **Step 5: Run → PASS, check, commit**

```bash
npx vitest run server/piattaforma server/tenants/confine.test.ts && pnpm check
git add server && git commit -m "feat(piattaforma): il router del pannello legge il control plane — elenco delle aziende in cinque query, scheda per slug, comando per id, guardia strutturale"
```

---

### Task 7: Router `piattaforma` — mutation (accoda ed esegui subito)

Spec §5.2, §3.2, §3.3.

**Files:**
- Modify: `server/piattaforma/router.ts`, `server/piattaforma/costanti.ts` (se servono testi)
- Test: `server/piattaforma/router.test.ts`

**Interfaces:**
- Consumes: `accodaComando`, `eseguiComandoSubito` (Task 2), `confermaPassword` (Task 3), `invitaProprietario`/`baseUrlDa`/`annullaInvito` (Task 5), gli schemi di `server/tenants/comandi.ts`, `hashPassword`.
- Produces: `crea`, `sospendi`, `riattiva`, `proprietario`, `abbonamento`, `ricalcolaStorage`, `ripristina`, `invita`, `annullaInvito`.

- [ ] **Step 1: Test rossi** (estendere `router.test.ts`; `PASSWORD_ADMIN` è la password dell'amministratore seminato)

```ts
it("crea: comando eseguito subito, proprietario con password inutilizzabile, omaggio e invito", async () => {
  __impostaPostaPerTest(async () => ({ inviato: true, id: "em" }));
  const esito = await caller.crea({ slug: "gamma", nome: "Gamma Srl", sede: { nome: "Gamma", citta: "Carrara" }, proprietario: { nome: "Gina", cognome: "Verdi", email: "gina@gamma.test" }, omaggio: { motivo: "pilota", scadenza: null }, passwordConferma: PASSWORD_ADMIN });
  expect(esito.comando.stato).toBe("eseguito");
  expect(esito.comando.richiestoDa).toBe("piattaforma:admin@ruffinogroup.it");
  expect(esito.comando.payload).not.toHaveProperty(["proprietario", "passwordHash"]); // tolto alla chiusura
  expect(esito.invito).toMatchObject({ inviato: true });
  const repo = getTenantRepository();
  expect(repo.abbonamentoDi(repo.perSlug("gamma")!.id)).toMatchObject({ tipo: "complimentary", stato: "active" });
  const gina = conTenant(repo.perSlug("gamma")!.id, () => getUtentiStore().find((u: any) => u.email === "gina@gamma.test"));
  expect(verifyPassword("", gina.password)).toBe(false);
  expect(isHashed(gina.password)).toBe(true);
});
it("password di conferma sbagliata → UNAUTHORIZED e nessun comando accodato", async () => {
  await expect(caller.sospendi({ slug: "acme", motivo: "prova", passwordConferma: "sbagliata-ma-lunga" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  expect(await getTenantRepository().comandiInAttesa()).toEqual([]);
});
it("sospendi/riattiva/abbonamento/proprietario: comando eseguito con l'attore piattaforma negli eventi", async () => {
  const s = await caller.sospendi({ slug: "acme", motivo: "insoluto di prova", passwordConferma: PASSWORD_ADMIN });
  expect(s.comando.stato).toBe("eseguito");
  const eventi = await getTenantRepository().eventi(repo.perSlug("acme")!.id);
  expect(eventi.at(-1)).toMatchObject({ tipo: "sospeso", attore: "piattaforma:admin@ruffinogroup.it" });
  const a = await caller.abbonamento({ azione: "quota", slug: "acme", quotaGb: 200, passwordConferma: PASSWORD_ADMIN });
  expect(a.comando.stato).toBe("eseguito");
  expect(getTenantRepository().perSlug("acme")?.storageQuotaBytes).toBe(200 * 1024 ** 3);
});
it("tenant 1: sospendere senza ancheTenant1 rifiuta; omaggio rifiutato dal dominio arriva come esito.errore", async () => {
  await expect(caller.sospendi({ slug: "ruffino-group", motivo: "prova prova", passwordConferma: PASSWORD_ADMIN })).rejects.toThrow(/anche-tenant-1|ancheTenant1/);
  const o = await caller.abbonamento({ azione: "omaggio", slug: "ruffino-group", motivo: "prova prova", scadenza: null, passwordConferma: PASSWORD_ADMIN });
  expect(o.comando.stato).toBe("errore");
  expect(String(o.comando.esito?.errore)).toContain("tenant 1");
});
it("ricalcolaStorage e ripristina in prova restano in coda e non chiedono la password", async () => {
  const r = await caller.ricalcolaStorage({ slug: "acme" });
  expect(r.comando.stato).toBe("in_attesa");
});
it("a interruttore spento le mutation rifiutano con PRECONDITION_FAILED", async () => {
  delete process.env.FLAG_MULTI_AZIENDA;
  await expect(caller.ricalcolaStorage({ slug: "acme" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: MESSAGGI_PIATTAFORMA.solaLetturaFlagSpento });
});
it("invita e annullaInvito", async () => {
  __impostaPostaPerTest(async () => ({ inviato: false, motivo: "non configurata" }));
  const i = await caller.invita({ slug: "acme" });
  expect(i.inviato).toBe(false);
  expect(i.link).toContain("/invito/");
  expect((await caller.annullaInvito({ id: i.invito.id }))?.annullatoIl).not.toBeNull();
});
```

- [ ] **Step 2: Implementazione** — helper e mutation nel router:

```ts
const slugInput = z.string().regex(SLUG_RE);
const conPassword = <T extends z.ZodRawShape>(shape: T) => z.object({ ...shape, passwordConferma: z.string().min(1) });
function assicuraScrivibile() { if (!interruttoreAttivo("multiAzienda")) throw new TRPCError({ code: "PRECONDITION_FAILED", message: MESSAGGI_PIATTAFORMA.solaLetturaFlagSpento }); }
function tenantDaSlug(slug: string) { return oppureNotFound(getTenantRepository().perSlug(slug)); }
async function accodaEdEsegui(ctx, tipo: TipoComando, tenantId: number | null, payload: Record<string, unknown>, subito: boolean) {
  const repo = getTenantRepository();
  const c = await repo.accodaComando({ tipo, tenantId, payload, richiestoDa: `piattaforma:${ctx.amministratore.email}` });
  return subito ? eseguiComandoSubito(c.id) : c;
}
const passwordInutilizzabile = () => hashPassword(randomBytes(32).toString("base64url"));
// crea
crea: piattaformaProcedure.input(conPassword({ slug: slugInput, nome: z.string().trim().min(1).max(120), sede: z.object({ nome: z.string().trim().min(1).max(120), citta: z.string().trim().max(80).nullable().optional() }),
  proprietario: z.object({ nome: z.string().trim().min(1).max(80), cognome: z.string().trim().min(1).max(80), email: z.string().trim().email(), telefono: z.string().trim().max(40).nullable().optional() }),
  omaggio: z.object({ motivo: z.string().trim().min(1).max(500), scadenza: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() }).optional() }))
  .mutation(async ({ input, ctx }) => {
    assicuraScrivibile(); confermaPassword(ctx.user as any, input.passwordConferma);
    const payload = schemaPayloadCrea.parse({ slug: input.slug, nome: input.nome, sede: input.sede, proprietario: { ...input.proprietario, passwordHash: passwordInutilizzabile() } });
    const comando = await accodaEdEsegui(ctx, "crea", null, payload, true);
    if (comando.stato !== "eseguito") return { comando, invito: null, omaggio: null };
    const esito = comando.esito as { tenantId: number; creatoOra: boolean };
    if (!esito.creatoOra) return { comando, invito: null, omaggio: null, nota: MESSAGGI_PIATTAFORMA.tenantGiaEsistente };
    const omaggio = input.omaggio ? await accodaEdEsegui(ctx, "imposta_abbonamento", esito.tenantId, schemaPayloadAbbonamento.parse({ azione: "omaggio", slug: input.slug, ...input.omaggio }), true) : null;
    const invito = await invitaProprietario({ tenantId: esito.tenantId, email: input.proprietario.email, attore: { tipo: "piattaforma", email: ctx.amministratore.email }, adesso: new Date(), baseUrl: baseUrlDa(ctx.req) });
    return { comando, omaggio, invito };
  }),
// sospendi / riattiva
sospendi: piattaformaProcedure.input(conPassword({ slug: slugInput, motivo: z.string().trim().min(3).max(500), ancheTenant1: z.boolean().optional() })).mutation(async ({ input, ctx }) => {
  assicuraScrivibile(); confermaPassword(ctx.user as any, input.passwordConferma);
  const t = tenantDaSlug(input.slug);
  if (t.id === TENANT_PREDEFINITO_ID && !input.ancheTenant1) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Sospendere il tenant 1 mette Ruffino Group in sola lettura: conferma con «anche Ruffino Group» (ancheTenant1)." });
  return { comando: await accodaEdEsegui(ctx, "sospendi", t.id, schemaPayloadStato.parse({ slug: input.slug, motivo: input.motivo }), true) };
}),
riattiva: … (schemaPayloadStato, "riattiva"),
proprietario: piattaformaProcedure.input(conPassword({ slug: slugInput, email: z.string().trim().email(), azione: z.enum(["assegna", "revoca"]) })).mutation(… tipo = input.azione === "assegna" ? "assegna_proprietario" : "revoca_proprietario" …),
abbonamento: piattaformaProcedure.input(z.intersection(schemaPayloadAbbonamento, z.object({ passwordConferma: z.string().min(1) }))).mutation(async ({ input, ctx }) => {
  assicuraScrivibile(); confermaPassword(ctx.user as any, input.passwordConferma);
  const { passwordConferma: _p, ...payload } = input;
  const t = tenantDaSlug(payload.slug);
  return { comando: await accodaEdEsegui(ctx, "imposta_abbonamento", t.id, schemaPayloadAbbonamento.parse(payload), true) };
}),
ricalcolaStorage: piattaformaProcedure.input(z.object({ slug: slugInput })).mutation(async ({ input, ctx }) => { assicuraScrivibile(); const t = tenantDaSlug(input.slug); return { comando: await accodaEdEsegui(ctx, "ricalcola_storage", t.id, schemaPayloadStorage.parse({ slug: input.slug }), false) }; }),
ripristina: piattaformaProcedure.input(z.object({ slug: slugInput, backup: z.string().trim().min(1).max(120), solo: z.array(z.string().trim().min(1)).nullable().optional(), scrivi: z.boolean(), ancheTenant1: z.boolean().optional(), passwordConferma: z.string().optional() })).mutation(async ({ input, ctx }) => {
  assicuraScrivibile();
  if (input.scrivi) confermaPassword(ctx.user as any, input.passwordConferma ?? "");
  const t = tenantDaSlug(input.slug);
  const { passwordConferma: _p, ...payload } = input;
  return { comando: await accodaEdEsegui(ctx, "ripristina_archivi", t.id, schemaPayloadRipristino.parse(payload), false) };
}),
invita: piattaformaProcedure.input(z.object({ slug: slugInput, email: z.string().trim().email().optional() })).mutation(async ({ input, ctx }) => {
  assicuraScrivibile();
  const t = tenantDaSlug(input.slug);
  try { return await invitaProprietario({ tenantId: t.id, email: input.email, attore: { tipo: "piattaforma", email: ctx.amministratore.email }, adesso: new Date(), baseUrl: baseUrlDa(ctx.req) }); }
  catch (e) { throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : String(e) }); }
}),
annullaInvito: piattaformaProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input, ctx }) => {
  assicuraScrivibile();
  const repo = getTenantRepository();
  const invito = await repo.annullaInvito(input.id);
  if (invito) await repo.registraEvento({ tenantId: invito.tenantId, tipo: "invito_annullato", attore: `piattaforma:${ctx.amministratore.email}`, dettagli: { invitoId: invito.id } });
  return invito;
}),
```

- [ ] **Step 3: Run → PASS, check, commit**

```bash
npx vitest run server/piattaforma server/tenants && pnpm check
git add server && git commit -m "feat(piattaforma): le azioni del pannello — comandi accodati ed eseguiti subito con conferma della password, creazione con password inutilizzabile, omaggio e invito, sola lettura a interruttore spento"
```

---

### Task 8: Client — accesso, elenco aziende, «Nuova azienda», conferma password, pagina d'invito

Spec §8, §6.3.

**Files:**
- Create: `client/src/lib/piattaforma.ts` (+`.test.ts`), `client/src/components/RequirePiattaforma.tsx`, `client/src/pages/piattaforma/AziendeList.tsx`, `client/src/pages/piattaforma/NuovaAziendaDialog.tsx`, `client/src/pages/piattaforma/ConfermaPassword.tsx`, `client/src/pages/piattaforma/testi.ts` (+`.test.ts`), `client/src/pages/InvitoPage.tsx`
- Modify: `client/src/App.tsx`, `client/src/components/layout/UserMenu.tsx`, `client/src/lib/routeContract.ts` (se elenca le rotte: aggiungere le tre nuove sul modello di `/integrazioni`)

**Interfaces:**
- Consumes: `trpc.tenants.mio` (`piattaforma`), `trpc.piattaforma.aziende|crea`, `trpc.inviti.anteprima|accetta`, `testi.ts` di `components/abbonamento`, `DataSurface`, `PageHeader`, `StatePanel`, `Dialog`/`Input`/`Label`/`Button`/`Badge`.
- Produces: `piattaformaGateLabel({ mio, loading })`, `RequirePiattaforma`, rotte `/piattaforma`, `/piattaforma/:slug` (Task 9), `/invito/:token`; `ConfermaPassword` riusato dal Task 9.

- [ ] **Step 1: Test rossi** (`client/src/lib/piattaforma.test.ts`: `piattaformaGateLabel({ mio: undefined, loading: true }) === "loading"`, `{ mio: { piattaforma: true }, loading: false } === "allowed"`, `{ mio: { piattaforma: false } } === "blocked"`; `client/src/pages/piattaforma/testi.test.ts`: `etichettaBlocco`, `riassuntoTars({ consumoEur: null }) === "—"`, `riassuntoSpazio`, `testoEsitoInvito({ inviato: false, link })` contiene «copia»).

- [ ] **Step 2: `RequirePiattaforma`** — copia di `RequireDirezione.tsx` con `const mio = trpc.tenants.mio.useQuery(undefined, { enabled: Boolean(user) })`, `gate = piattaformaGateLabel({ mio: mio.data, loading: loading || mio.isLoading })`, titolo «Sezione riservata alla piattaforma», `data-authorization-guard="piattaforma"`. In `UserMenu.tsx`: `const mio = trpc.tenants.mio.useQuery(undefined, { enabled: Boolean(user) });` e, dopo «Impostazioni», `{mio.data?.piattaforma ? <DropdownMenuItem onClick={() => setLocation("/piattaforma")}><Building2 … />Piattaforma</DropdownMenuItem> : null}`. In `App.tsx`: `const AziendeList = lazy(() => import("./pages/piattaforma/AziendeList"))`, `const InvitoPage = lazy(() => import("./pages/InvitoPage"))`; rotta `/invito/:token` FUORI dalla shell accanto alle stampe; rotte `/piattaforma` e `/piattaforma/:slug` dentro la shell con `<RequirePiattaforma>` come `/utenti` usa `RequireDirezione`.

- [ ] **Step 3: `AziendeList.tsx`** — `trpc.piattaforma.aziende.useQuery(undefined, { refetchInterval: 30_000 })`; `PageHeader` (`variant="workbench"`, title «Piattaforma», description «Tutte le aziende di Wyndoor: stato, abbonamento, spazio e Tars», `primaryAction` = pulsante «Nuova azienda», `warning` = testo se `tenants.mio.multiAzienda === false` → «Con FLAG_MULTI_AZIENDA spento il pannello è in sola lettura»); campo di ricerca (nome o slug); `DataSurface density="compact" tone="default"` con una `<table>` (colonne: Azienda, Stato, Abbonamento, Spazio, Tars, Worker, Backup, Comandi) su `md:` e una lista di blocchi sotto; ogni riga `onClick={() => setLocation(`/piattaforma/${r.slug}`)}` e un link accessibile; `state` di `StatePanel` per loading/empty/error. Badge di stato con `tonoStato`; `byteScritti`, `percentualeScritta`, `dataItaliana`. Per Ruffino Group una `Badge` «piattaforma».

- [ ] **Step 4: `ConfermaPassword.tsx`** — `Dialog` con titolo passato dal chiamante, `children` (i campi dell'azione), campo `password` (`type="password"`, `autoComplete="current-password"`), pulsanti «Annulla»/«Conferma»; espone `onConferma(password)`; mostra l'errore ricevuto (`err.message`) sotto il campo; disabilita durante `pending`.

- [ ] **Step 5: `NuovaAziendaDialog.tsx`** — modulo controllato: slug (suggerito da `nome` con `nome.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)`, modificabile), ragione sociale, sede (nome precompilato con la ragione sociale, città), proprietario (nome, cognome, email, telefono), «Omaggio subito» (`Switch` → motivo + scadenza `type="date"` facoltativa), poi la password di conferma (campo nel dialogo stesso, non un secondo dialogo). `trpc.piattaforma.crea.useMutation` → all'esito: pannello di riepilogo con `testoEsitoInvito` (se `inviato` «Invito inviato a …», altrimenti il link in un `Input readOnly` con «Copia» via `navigator.clipboard.writeText`), pulsante «Apri la scheda» → `/piattaforma/<slug>`; `utils.piattaforma.aziende.invalidate()`. Errori: `err.message` in cima al modulo.

- [ ] **Step 6: `InvitoPage.tsx`** — pagina senza shell (stesso involucro visivo di `LoginPage.tsx`: leggerne il markup alle righe 60-182 e riusarne classi e struttura): `const { token } = useParams()`; `trpc.inviti.anteprima.useQuery({ token })`; stati: caricamento, non valido (titolo «Invito non valido» + testo `MESSAGGI` uguale al server + «Chiedi un nuovo invito a chi ti ha registrato»), valido (intestazione «Benvenuto in Wyndoor», «Stai attivando l'accesso a <azienda> per <email>», campi password e conferma, regola 12 caratteri, pulsante «Imposta la password ed entra»). `trpc.inviti.accetta.useMutation({ onSuccess: () => { utils.auth.me.invalidate(); setLocation("/"); } })`. Password diverse → errore locale senza chiamare il server.

- [ ] **Step 7: Verifica visiva** — con il login demo e un harness `.mts` che semina due aziende (memoria: «Verifica UI in anteprima demo», `launch.json` tracciato da ripristinare) e `PLATFORM_ADMIN_EMAILS` con l'email dell'utente demo: `/piattaforma` a 1440×900 e 390×844, apertura di «Nuova azienda», e `/invito/<token>` (token stampato dal harness dopo `invitaProprietario` con posta finta) a 390×844; console senza errori; nessuno scroll orizzontale. Screenshot nel report.

- [ ] **Step 8: Run → PASS, check, build, commit**

```bash
npx vitest run client/src && pnpm check && pnpm build
git add client && git commit -m "feat(client): la sezione Piattaforma — guardia, voce nel menu, elenco delle aziende, «Nuova azienda» con invito, conferma della password e pagina pubblica dell'invito"
```

---

### Task 9: Client — scheda dell'azienda con tutte le azioni

Spec §8 (scheda).

**Files:**
- Create: `client/src/pages/piattaforma/AziendaDetail.tsx`, `client/src/pages/piattaforma/AzioniAbbonamento.tsx` (i dialoghi delle azioni: omaggio, proroga, disdetta, quota, tolleranze, budget, extra), `client/src/pages/piattaforma/SezioneProprietari.tsx`, `client/src/pages/piattaforma/SezioneRipristino.tsx`
- Modify: `client/src/App.tsx` (rotta `/piattaforma/:slug`), `client/src/pages/piattaforma/testi.ts` (+test: etichette degli eventi e dei comandi)

**Interfaces:**
- Consumes: `trpc.piattaforma.azienda|comando|sospendi|riattiva|proprietario|abbonamento|ricalcolaStorage|ripristina|invita|annullaInvito`, `ConfermaPassword` (Task 8).

- [ ] **Step 1: Test rossi** (`testi.test.ts`): `etichettaEvento("invito_inviato") === "Invito inviato"`, `etichettaEvento("abbonamento_stato")`, `attoreLeggibile("piattaforma:t@r.it") === "piattaforma (t@r.it)"`, `attoreLeggibile("script:tenant@host") === "riga di comando (tenant@host)"`, `attoreLeggibile("boot") === "avvio del server"`, `etichettaComando("imposta_abbonamento") === "Abbonamento"`.

- [ ] **Step 2: `AziendaDetail.tsx`** — `useParams().slug`; `trpc.piattaforma.azienda.useQuery({ slug }, { refetchInterval: 15_000 })`; `PageHeader variant="record"` (eyebrow «Piattaforma», title = nome, metadata = slug + stato + «piattaforma» per il tenant 1, `secondaryActions` = «Sospendi»/«Riattiva»); sezioni come `<section className="min-w-0 space-y-3">` con `<h2 className="text-xs font-bold uppercase tracking-[0.12em] text-text-3">` (stesso `SezioneHub` locale di `Integrazioni.tsx:105-125`, riscritto qui) e dentro `DataSurface density="compact"`: **Abbonamento** (tipo, stato, inizio/fine, omaggio con motivo e scadenza, insoluto, disdetta; azioni → `AzioniAbbonamento`), **Spazio** (usato/quota, percentuale, tolleranza, «fermo dal…»; azioni Quota, Tolleranza, Ricalcola), **Tars** (consumo/budget del mese, extra, tolleranza, blocco; azioni Budget, Extra, Tolleranza), **Sedi** (elenco), **Proprietari e inviti** (`SezioneProprietari`), **Backup e ripristino** (`SezioneRipristino`), **Eventi** (tabella: quando, tipo con `etichettaEvento`, chi con `attoreLeggibile`, motivo, dettagli compatti), **Comandi** (quando, tipo, stato con badge, chi, esito o errore). Ogni azione: dialogo `ConfermaPassword` con i campi, mutation, poi `utils.piattaforma.azienda.invalidate({ slug })` e un `toast` con l'esito (`comando.stato === "errore"` → `toast.error(esito.errore)`).

- [ ] **Step 3: Comandi lunghi** — dopo `ricalcolaStorage`/`ripristina` la sezione mostra «In corso…» e interroga `trpc.piattaforma.comando.useQuery({ id }, { refetchInterval: 2_000, enabled: stato === "in_attesa" })` fino alla chiusura; l'esito del ripristino in prova (differenze per store) viene mostrato in una lista.

- [ ] **Step 4: Tenant 1** — nel dialogo di sospensione compare la casella «Anche Ruffino Group (mette la piattaforma in sola lettura)» che valorizza `ancheTenant1`; le azioni omaggio/proroga/disdetta per il tenant 1 restano nel menu ma l'esito d'errore del dominio viene mostrato così com'è.

- [ ] **Step 5: Verifica visiva** — scheda a 1440×900 e 390×844 con il harness del Task 8 (un'azienda in prova con un invito pendente, un evento worker_sospeso e un comando in errore seminati); ogni sezione leggibile senza scroll orizzontale; dialoghi su mobile; console pulita.

- [ ] **Step 6: Run → PASS, check, build, commit**

```bash
npx vitest run client/src && pnpm check && pnpm build
git add client && git commit -m "feat(client): la scheda dell'azienda nel pannello — abbonamento, spazio, Tars, proprietari e inviti, backup e ripristino, eventi e comandi con le azioni"
```

---

### Task 10: Documentazione e chiusura

Spec §9, §12, §14; runbook, PRD, handoff, `CLAUDE.md`.

**Files:**
- Modify: `docs/runbooks/multi-azienda.md` (nuova `## WS6 — pannello piattaforma` in coda con: «Accesso», «Cosa fa il boot (aggiunte del WS6)», «Il percorso di un invito», «Variabili d'ambiente (WS6)», «Produzione, in ordine (WS6)», «Errori che l'operatore può vedere (WS6)»), `documento_requisiti_infissi_ops.md` (intestazione 5.87 «Prima: 5.86 …», `**Stato:**` con «pannello piattaforma sul branch», `### 60.13 Workstream 6 — pannello piattaforma (implementato su branch, 09/09/2026; non in produzione)` con le decisioni di §2 e le deviazioni dal design madre, voce in `## 33`), `handoff.md` (Novità 09/09: WS3+WS4 su main e flag acceso alle 09:54, WS6 sul branch; voce nell'elenco dei punti aperti), `CLAUDE.md` (tre invarianti: il router `piattaforma` legge solo il control plane e scrive solo comandi; `tenant_inviti` scritta solo dal repository e token mai a terra in chiaro; la posta della piattaforma non lancia e non logga indirizzi), spec §2-bis (i ruling del registro).

- [ ] **Step 1: Runbook** — testo con i comandi reali: variabili (`PLATFORM_ADMIN_EMAILS`, `RESEND_API_KEY`, `POSTA_PIATTAFORMA_MITTENTE`, `APP_BASE_URL`), i record DNS che Resend chiede, il ripiego «copia il link», come rinviare o annullare un invito, cosa fa `sospendi` sul tenant 1, come leggere eventi e comandi, rollback.
- [ ] **Step 2: PRD, handoff, CLAUDE.md, spec §2-bis** — come sopra; «Verificato: pnpm check, pnpm test e pnpm build» solo dopo averli eseguiti davvero, con i numeri.
- [ ] **Step 3: Guardie e suite intera**

```bash
npx vitest run shared/brand.test.ts && pnpm check && pnpm test && pnpm build
git add docs documento_requisiti_infissi_ops.md handoff.md CLAUDE.md && git commit -m "docs(ws6): pannello piattaforma — runbook, PRD 5.87 §60.13, handoff, invarianti in CLAUDE.md, decisioni in corso d'opera nella spec"
```

---

## Verifica finale (controller)

- Revisione dell'intero branch (opus), fix wave unica, re-review; fusione di `origin/main`; push; PR verso `main` con il corpo nello stile delle precedenti (cosa cambia, cosa si vede a interruttore acceso, ordine in produzione, come è stato verificato, cosa NON è verificato: Resend reale e DNS, nulla su Railway).
- Dopo il merge: variabili su Railway, login, «Piattaforma» nel menu, azienda pilota, invito.
