# Staging con dati demo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un ambiente Railway «staging» con dati demo seminati da soli, un link d'accesso permanente senza password e zero effetti su servizi esterni, così ogni PR si verifica a schermo prima di fondere su main.

**Architecture:** Una variabile nuova `AMBIENTE=staging` letta da un solo modulo (`server/_core/ambiente.ts`) governa tre comportamenti: i quattro giri di fondo che parlano con servizi esterni non partono, un seme demo popola gli store vuoti al boot, e una rotta anonima con token apre la sessione dell'utente demo. Il client mostra un banner d'ambiente servito da una procedura pubblica nuova. Tutto il resto (creazione ambiente Railway, variabili, PR environments) è configurazione manuale documentata nel runbook.

**Tech Stack:** Express + tRPC 11, persistedStore su `kv_store`, React 19 + Tailwind 4, vitest, Railway (nixpacks).

**Spec:** `docs/superpowers/specs/2026-09-10-staging-demo-design.md` (decisioni D1–D8, tabella variabili, rischi R1–R4).

## Global Constraints

- Branch di lavoro: `claude/wyndoor-saas-infrastructure-e98028` (questa worktree); PR verso `main`; CI verde prima del merge.
- `pnpm check`, `pnpm test`, `pnpm build` verdi alla fine di OGNI task.
- **Nessun segreto nel repo**: niente token, password o chiavi; i valori delle variabili staging si generano su Railway e vivono solo lì.
- `process.env.AMBIENTE` si legge **solo** in `server/_core/ambiente.ts`; ogni altro file passa da `ambienteStaging()`.
- `NODE_ENV` resta `production` in staging: l'identità dell'ambiente NON passa da `NODE_ENV` (spec, «Fatti che vincolano il design»).
- Date nei test e nel seme demo **sempre relative** a `new Date()`, mai fisse (bombe a orologeria).
- Guardie da non rompere: `server/_core/storeGlobali.test.ts` (nessun nuovo store globale — questo piano non ne crea), `server/tenants/confine.test.ts`, `server/routers/nonTrovato.confine.test.ts`, `server/_core/testSetup.ts` (nessun test raggiunge la rete), CI passo «working tree pulito» (nessun test scrive file versionati).
- Rotte Express anonime: handler `async` sempre con `try/catch` (Express 4 non cattura la promise rifiutata; `server/_core/rotteAnonime.ts`).
- UI: stringhe in italiano, token semantici di `client/src/index.css`, niente `scrollIntoView`, target touch ≥ 44 px, verifica browser a 1440×900 e 390×844.
- `.claude/launch.json` è tracciato: una voce temporanea per la verifica va tolta prima del commit (`git checkout -- .claude/launch.json`).

---

### Task 1: Il modulo d'ambiente

**Files:**
- Create: `server/_core/ambiente.ts`
- Test: `server/_core/ambiente.test.ts`

**Interfaces:**
- Produces: `ambienteStaging(): boolean` — vero solo se `process.env.AMBIENTE`, ripulita di spazi e minuscole, vale esattamente `"staging"`. Riletta a ogni chiamata (come `interruttoreAttivo`, `server/platform/interruttori.ts:126`), nessuna cache.

- [ ] **Step 1: Write the failing test**

```ts
// server/_core/ambiente.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { ambienteStaging } from "./ambiente";

const originale = process.env.AMBIENTE;
afterEach(() => {
  if (originale === undefined) delete process.env.AMBIENTE;
  else process.env.AMBIENTE = originale;
});

describe("ambienteStaging", () => {
  it("è falso senza AMBIENTE (fail-closed: assente = produzione)", () => {
    delete process.env.AMBIENTE;
    expect(ambienteStaging()).toBe(false);
  });
  it("è vero solo per il valore staging, tollerando maiuscole e spazi", () => {
    process.env.AMBIENTE = "staging";
    expect(ambienteStaging()).toBe(true);
    process.env.AMBIENTE = " Staging ";
    expect(ambienteStaging()).toBe(true);
  });
  it("qualunque altro valore vale produzione", () => {
    for (const v of ["produzione", "true", "1", "stagin", "staging2"]) {
      process.env.AMBIENTE = v;
      expect(ambienteStaging()).toBe(false);
    }
  });
  it("rilegge la variabile a ogni chiamata (nessuna cache)", () => {
    process.env.AMBIENTE = "staging";
    expect(ambienteStaging()).toBe(true);
    delete process.env.AMBIENTE;
    expect(ambienteStaging()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run server/_core/ambiente.test.ts`
Expected: FAIL — modulo `./ambiente` inesistente.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/_core/ambiente.ts
/**
 * Identità dell'ambiente di deploy. NON è NODE_ENV: anche staging gira con
 * NODE_ENV=production, così i gate di sicurezza (JWT_SECRET obbligatoria,
 * BOOTSTRAP_ADMIN_PASSWORD obbligatoria) e i flag fail-closed restano attivi.
 * Fail-closed: qualunque valore diverso da "staging" — o l'assenza — vale
 * produzione. Nessun altro modulo legge process.env.AMBIENTE.
 */
export function ambienteStaging(): boolean {
  return (process.env.AMBIENTE ?? "").trim().toLowerCase() === "staging";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run server/_core/ambiente.test.ts`
Expected: PASS (4 test).

- [ ] **Step 5: `pnpm check` e commit**

```bash
git add server/_core/ambiente.ts server/_core/ambiente.test.ts
git commit -m "feat(staging): modulo ambiente con ambienteStaging() fail-closed — Task 1 di «Staging con dati demo»"
```

---

### Task 2: In staging i giri esterni non partono

**Files:**
- Create: `server/_core/giriEsterni.ts`
- Modify: `server/_core/index.ts:186-201` (le quattro partenze), `server/_core/index.ts:214-227` (blocco header di sicurezza: aggiunta `X-Robots-Tag`)
- Test: `server/_core/giriEsterni.test.ts`

**Interfaces:**
- Consumes: `ambienteStaging()` (Task 1).
- Produces: `avviaGiriEsterni(): Promise<boolean>` — `false` in staging (niente avviato), `true` altrove dopo aver avviato backup Drive, sync FiC, sonda SdI, poller IMAP.

- [ ] **Step 1: Write the failing test**

```ts
// server/_core/giriEsterni.test.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { avviaGiriEsterni } from "./giriEsterni";

const qui = path.dirname(fileURLToPath(import.meta.url));
const sorgente = (p: string) => readFileSync(path.join(qui, p), "utf8");

const originale = process.env.AMBIENTE;
afterEach(() => {
  if (originale === undefined) delete process.env.AMBIENTE;
  else process.env.AMBIENTE = originale;
});

describe("giri esterni", () => {
  it("in staging non parte nulla", async () => {
    process.env.AMBIENTE = "staging";
    await expect(avviaGiriEsterni()).resolves.toBe(false);
  });

  // Guardia strutturale: index.ts non deve più avviare i quattro giri
  // direttamente — chi ne aggiungesse un quinto fuori dal gate riaprirebbe
  // il buco (un DB di produzione ripristinato in staging leggerebbe caselle
  // vere entro 60 secondi).
  it("index.ts passa solo da avviaGiriEsterni", () => {
    const index = sorgente("index.ts");
    expect(index).toContain("avviaGiriEsterni");
    for (const diretto of [
      "startBackupScheduler",
      "startFicScheduler",
      "startSondaFattureWorker",
      "avviaPollerMail",
    ]) {
      expect(index).not.toContain(diretto);
    }
  });

  it("giriEsterni.ts contiene tutte e quattro le partenze dietro il gate", () => {
    const src = sorgente("giriEsterni.ts");
    expect(src).toContain("ambienteStaging()");
    for (const nome of [
      "startBackupScheduler",
      "startFicScheduler",
      "startSondaFattureWorker",
      "avviaPollerMail",
    ]) {
      expect(src).toContain(nome);
    }
  });

  it("in staging le risposte portano X-Robots-Tag", () => {
    expect(sorgente("index.ts")).toContain("X-Robots-Tag");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run server/_core/giriEsterni.test.ts`
Expected: FAIL — modulo inesistente.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/_core/giriEsterni.ts
import { ambienteStaging } from "./ambiente";

/**
 * Le quattro partenze che parlano con servizi esterni veri: backup Google
 * Drive, sync Fatture in Cloud, sonda SdI, poller IMAP. In staging NON
 * partono — un database ripristinato dalla produzione resterebbe altrimenti
 * a leggere caselle vere e a scrivere sul Drive vero entro 60 secondi dal
 * boot. I worker interni (promemoria, eventi, Centro Azioni, comandi
 * tenant) restano fuori da qui e partono ovunque: servono a provare il
 * prodotto.
 */
export async function avviaGiriEsterni(): Promise<boolean> {
  if (ambienteStaging()) {
    console.log(
      "[ambiente] staging: giri esterni spenti (backup Drive, sync FiC, sonda SdI, poller IMAP)"
    );
    return false;
  }
  const { startBackupScheduler } = await import("./driveBackup");
  startBackupScheduler();
  const { startFicScheduler } = await import("../routers/fattureInCloud");
  startFicScheduler();
  const { startSondaFattureWorker } = await import("../fatture/sonda");
  startSondaFattureWorker();
  const { avviaPollerMail } = await import("../comunicazioni/imap");
  avviaPollerMail();
  return true;
}
```

In `server/_core/index.ts` sostituire le quattro partenze (righe 186-201, i quattro blocchi commento+import+chiamata da `startBackupScheduler` ad `avviaPollerMail`) con:

```ts
  // Giri che parlano con servizi esterni (Drive, FiC/SdI, IMAP): in staging
  // non partono. Vedi server/_core/giriEsterni.ts.
  const { avviaGiriEsterni } = await import("./giriEsterni");
  await avviaGiriEsterni();
```

Nel blocco degli header di sicurezza (`index.ts:214-227`, il middleware che imposta gli header su ogni risposta) aggiungere, dopo gli header esistenti:

```ts
    // Staging non va indicizzato: il contenuto è dimostrativo.
    if (ambienteStaging()) res.setHeader("X-Robots-Tag", "noindex, nofollow");
```

con `import { ambienteStaging } from "./ambiente";` fra gli import statici in testa al file.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run server/_core/giriEsterni.test.ts`
Expected: PASS (4 test).

- [ ] **Step 5: `pnpm check`, `pnpm test` (il boot non è coperto da altri test, ma i test di fattureInCloud.scheduler e imap non devono accorgersi di nulla) e commit**

```bash
git add server/_core/giriEsterni.ts server/_core/giriEsterni.test.ts server/_core/index.ts
git commit -m "feat(staging): i quattro giri esterni passano da avviaGiriEsterni, spenti in staging + X-Robots-Tag — Task 2 di «Staging con dati demo»"
```

---

### Task 3: Porta fissa in produzione e nixpacks allineato

`railway.json:8` dice `pnpm start` (che imposta `NODE_ENV=production`), `nixpacks.toml:15` dice `node dist/index.js` (che non lo imposta): un ambiente nuovo che partisse dal solo nixpacks avrebbe `NODE_ENV` assente = flag spenti MA gate di sicurezza disattivati. E `findAvailablePort` (`index.ts:434-439`) sposta il server su `PORT+1…+20` se la porta è occupata, tradendo l'healthcheck Railway.

**Files:**
- Modify: `nixpacks.toml:14-15`, `server/_core/index.ts:434-439`
- Test: `server/_core/giriEsterni.test.ts` (si estende la guardia strutturale del Task 2)

**Interfaces:**
- Consumes: nulla di nuovo.
- Produces: comportamento di boot, nessuna API.

- [ ] **Step 1: Write the failing test** — aggiungere a `server/_core/giriEsterni.test.ts`:

```ts
  it("nixpacks e railway.json avviano allo stesso modo (NODE_ENV=production garantito)", () => {
    const radice = path.join(qui, "..", "..");
    const nixpacks = readFileSync(path.join(radice, "nixpacks.toml"), "utf8");
    expect(nixpacks).toContain('cmd = "pnpm start"');
  });

  it("in produzione la porta non scansiona: o PORT o crash", () => {
    const index = sorgente("index.ts");
    expect(index).toMatch(/inProduzione\s*\?\s*preferredPort\s*:\s*await findAvailablePort/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run server/_core/giriEsterni.test.ts`
Expected: FAIL sui due test nuovi.

- [ ] **Step 3: Write minimal implementation**

`nixpacks.toml`, sezione `[start]`:

```toml
[start]
cmd = "pnpm start"
```

`server/_core/index.ts`, al posto della scelta porta attuale (`:434-439`):

```ts
  const preferredPort = parseInt(process.env.PORT || "3000");
  // Su Railway la porta è un contratto con l'healthcheck: se è occupata il
  // processo esce e il restart policy riprova. La scansione resta solo in
  // sviluppo locale, dove più server convivono sulla stessa macchina.
  const inProduzione =
    process.env.NODE_ENV === "production" || !!process.env.RAILWAY_ENVIRONMENT;
  const port = inProduzione ? preferredPort : await findAvailablePort(preferredPort);
```

Mantenere il log esistente se la porta scelta differisce da quella preferita.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run server/_core/giriEsterni.test.ts`
Expected: PASS.

- [ ] **Step 5: `pnpm check`, `pnpm build` e commit**

```bash
git add nixpacks.toml server/_core/index.ts server/_core/giriEsterni.test.ts
git commit -m "fix(deploy): nixpacks avvia con pnpm start; in produzione la porta non scansiona — Task 3 di «Staging con dati demo»"
```

---

### Task 4: `system.ambiente` per il client

**Files:**
- Modify: `server/_core/systemRouter.ts` (router a `:5`, si aggiunge una procedura)
- Test: `server/_core/systemRouter.ambiente.test.ts`

**Interfaces:**
- Consumes: `ambienteStaging()` (Task 1).
- Produces: procedura tRPC pubblica `system.ambiente` → `{ staging: boolean }`. La consuma il banner del Task 7.

- [ ] **Step 1: Write the failing test**

```ts
// server/_core/systemRouter.ambiente.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { systemRouter } from "./systemRouter";

const originale = process.env.AMBIENTE;
afterEach(() => {
  if (originale === undefined) delete process.env.AMBIENTE;
  else process.env.AMBIENTE = originale;
});

describe("system.ambiente", () => {
  it("risponde staging:false fuori da staging", async () => {
    delete process.env.AMBIENTE;
    const caller = systemRouter.createCaller({} as any);
    await expect(caller.ambiente()).resolves.toEqual({ staging: false });
  });
  it("risponde staging:true in staging", async () => {
    process.env.AMBIENTE = "staging";
    const caller = systemRouter.createCaller({} as any);
    await expect(caller.ambiente()).resolves.toEqual({ staging: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run server/_core/systemRouter.ambiente.test.ts`
Expected: FAIL — `ambiente` non esiste sul router.

- [ ] **Step 3: Write minimal implementation** — in `server/_core/systemRouter.ts`, dentro `router({ … })`, dopo `health`:

```ts
  // Il client mostra il banner «Ambiente di prova» solo se il server lo
  // dichiara: nessuna variabile VITE_* (sarebbe cotta nel bundle al build).
  ambiente: publicProcedure.query(() => ({ staging: ambienteStaging() })),
```

con `import { ambienteStaging } from "./ambiente";` in testa.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run server/_core/systemRouter.ambiente.test.ts`
Expected: PASS (2 test).

- [ ] **Step 5: `pnpm check` e commit**

```bash
git add server/_core/systemRouter.ts server/_core/systemRouter.ambiente.test.ts
git commit -m "feat(staging): system.ambiente espone al client se l'ambiente è di prova — Task 4 di «Staging con dati demo»"
```

---

### Task 5: Il seme demo

**Files:**
- Create: `server/staging/semeDemo.ts`
- Modify: `server/_core/index.ts` — una chiamata dopo il riallineamento timeline (`index.ts:81-90`), prima dei worker
- Test: `server/staging/semeDemo.test.ts`

**Interfaces:**
- Consumes: `ambienteStaging()`; `conTenant` (`server/tenants/contestoCorrente.ts:25`); `TENANT_PREDEFINITO_ID` (`server/tenants/costanti.ts:5`); `getClientiStore`/`createClienteFromSync` (`server/routers/clienti.ts:92,96`); `getCommesseStore`/`creaCommessa`/`CreaCommessaInput` (`server/routers/commesse.ts:222,695,687`); `getUtentiStore` (`server/routers/utenti.ts:158`).
- Produces: `eseguiSemeDemo(): Promise<{ seminato: boolean; motivo?: string }>` — idempotente; semina SOLO se `ambienteStaging()` e store `clienti` E `commesse` vuoti.

Regole non negoziabili del task:
- Si passa SOLO dai percorsi di dominio (`createClienteFromSync`, `creaCommessa`): niente push a mano di record inventati, niente id calcolati (`prossimoId` lo usano già gli helper; la guardia `server/_core/idGlobali.test.ts:35` vieta i contatori locali).
- Date relative a `new Date()`.
- Per i clienti non privati vale la convenzione Ragione sociale: verificare come `clienti.crea` la applica (`server/routers/clienti.ts:159-171` e dintorni di `:285`) e replicarla (campo `ragioneSociale` assegnato dopo `createClienteFromSync`, come fa `importaDaCsv` a `:468-490` con i campi extra).
- Il `ctx` passato a `creaCommessa` deve superare `authorizeCoreOperation`: usare l'utente direzione dello store globale `utenti` (l'admin di bootstrap) — leggere quali campi di `ctx.user` consuma `authorizeCoreOperation` e costruire l'oggetto con quelli (almeno `id` e `ruoli`).

- [ ] **Step 1: Write the failing test**

```ts
// server/staging/semeDemo.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { conTenant } from "../tenants/contestoCorrente";
import { TENANT_PREDEFINITO_ID } from "../tenants/costanti";
import { getClientiStore } from "../routers/clienti";
import { getCommesseStore } from "../routers/commesse";
import { getUtentiStore } from "../routers/utenti";
import { eseguiSemeDemo } from "./semeDemo";

const originale = process.env.AMBIENTE;
beforeEach(() => {
  process.env.AMBIENTE = "staging";
  // L'admin di bootstrap esiste già negli store in memoria dei test; se un
  // altro test lo ha disattivato, se ne assicura uno attivo con direzione.
  const utenti = getUtentiStore() as any[];
  if (!utenti.some(u => u.attivo && (u.ruoli ?? []).includes("direzione"))) {
    utenti.push({
      id: 999,
      email: "direzione@test.local",
      attivo: true,
      ruoli: ["direzione"],
      sediIds: [1],
      tenantId: TENANT_PREDEFINITO_ID,
      nome: "Test",
      cognome: "Direzione",
    });
  }
});
afterEach(() => {
  if (originale === undefined) delete process.env.AMBIENTE;
  else process.env.AMBIENTE = originale;
});

describe("eseguiSemeDemo", () => {
  it("fuori da staging non fa nulla", async () => {
    delete process.env.AMBIENTE;
    await expect(eseguiSemeDemo()).resolves.toEqual({
      seminato: false,
      motivo: "non-staging",
    });
  });

  it("semina 6 clienti e 6 commesse su store vuoti, e la seconda volta non duplica", async () => {
    await conTenant(TENANT_PREDEFINITO_ID, async () => {
      const clientiPrima = getClientiStore().length;
      const commessePrima = getCommesseStore().length;

      const primo = await eseguiSemeDemo();
      if (clientiPrima === 0 && commessePrima === 0) {
        expect(primo.seminato).toBe(true);
        expect(getClientiStore().length).toBe(6);
        expect(getCommesseStore().length).toBe(6);
        // Ogni commessa è collegata a un cliente e ha un importo.
        for (const c of getCommesseStore() as any[]) {
          expect(c.clienteId).toBeGreaterThan(0);
          expect(c.importoTotale).toBeGreaterThan(0);
        }
      }

      const dopoPrimo = {
        clienti: getClientiStore().length,
        commesse: getCommesseStore().length,
      };
      const secondo = await eseguiSemeDemo();
      expect(secondo.seminato).toBe(false);
      expect(secondo.motivo).toBe("store-non-vuoti");
      expect(getClientiStore().length).toBe(dopoPrimo.clienti);
      expect(getCommesseStore().length).toBe(dopoPrimo.commesse);
    });
  });
});
```

Nota: se l'isolamento dei test del repo fa arrivare store già popolati da altri file (i test girano per file, gli store sono per processo), il ramo `if (clientiPrima === 0 …)` mantiene comunque valida la prova di idempotenza; verificare col primo run e, se serve, azzerare gli array all'inizio del test (`store.length = 0` è il pattern usato nei test esistenti degli store — cercarne uno in `server/routers/commesse.test.ts` e copiarlo).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run server/staging/semeDemo.test.ts`
Expected: FAIL — modulo inesistente.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/staging/semeDemo.ts
import { ambienteStaging } from "../_core/ambiente";
import { conTenant } from "../tenants/contestoCorrente";
import { TENANT_PREDEFINITO_ID } from "../tenants/costanti";

/**
 * Dati dimostrativi per l'ambiente staging. Gira al boot, SOLO se
 * AMBIENTE=staging e gli store clienti+commesse sono entrambi vuoti (stessa
 * filosofia del seed dell'admin, server/routers/utenti.ts:121: mai
 * riscrivere sopra dati veri). Passa esclusivamente dai percorsi di
 * dominio: niente record costruiti a mano.
 */
export async function eseguiSemeDemo(): Promise<{ seminato: boolean; motivo?: string }> {
  if (!ambienteStaging()) return { seminato: false, motivo: "non-staging" };
  return conTenant(TENANT_PREDEFINITO_ID, async () => {
    const { getClientiStore, createClienteFromSync } = await import("../routers/clienti");
    const { getCommesseStore, creaCommessa } = await import("../routers/commesse");
    const { getUtentiStore } = await import("../routers/utenti");

    if (getClientiStore().length > 0 || getCommesseStore().length > 0) {
      return { seminato: false, motivo: "store-non-vuoti" };
    }
    const admin = (getUtentiStore() as any[]).find(
      u => u.attivo && (u.ruoli ?? []).includes("direzione")
    );
    if (!admin) return { seminato: false, motivo: "nessun-utente-direzione" };

    const ctx = {
      user: { ...admin },
      sedeId: 1,
      sediIds: [1],
    } as any;

    // ── Clienti ─────────────────────────────────────────────────────────
    const porta = (dati: {
      tipo: "privato" | "azienda" | "condominio" | "ente_pubblico";
      nome: string;
      cognome: string;
      ragioneSociale?: string;
      citta: string;
      telefono?: string;
      email?: string;
      partitaIva?: string;
    }) => {
      const record: any = createClienteFromSync({
        sedeId: 1,
        nome: dati.nome,
        cognome: dati.cognome,
        tipo: dati.tipo,
        partitaIva: dati.partitaIva,
        citta: dati.citta,
        telefono: dati.telefono ?? null,
        email: dati.email ?? null,
      });
      if (dati.ragioneSociale) record.ragioneSociale = dati.ragioneSociale;
      return record;
    };

    const condominio = porta({
      tipo: "condominio", nome: "", cognome: "Condominio Via Roma 12",
      ragioneSociale: "Condominio Via Roma 12", citta: "Sarzana",
      email: "amministratore@viaroma12.demo", telefono: "0187 000001",
    });
    const bianchi = porta({
      tipo: "azienda", nome: "", cognome: "Bianchi Serramenti Srl",
      ragioneSociale: "Bianchi Serramenti Srl", citta: "La Spezia",
      partitaIva: "01234567890", email: "info@bianchiserramenti.demo",
    });
    const moretti = porta({ tipo: "privato", nome: "Luca", cognome: "Moretti", citta: "La Spezia", telefono: "333 0000001" });
    const fontana = porta({ tipo: "privato", nome: "Giulia", cognome: "Fontana", citta: "Lerici", telefono: "333 0000002" });
    const vanni = porta({ tipo: "privato", nome: "Paolo", cognome: "Vanni", citta: "Massa", telefono: "333 0000003" });
    const grassi = porta({ tipo: "privato", nome: "Elena", cognome: "Grassi", citta: "Carrara", telefono: "333 0000004" });

    // ── Commesse (percorso di dominio: policy, sede, collegamento cliente) ─
    const commesse: Array<Parameters<typeof creaCommessa>[1]> = [
      { clienteId: condominio.id, importoTotale: 28_500, priorita: "alta", consegnaIndicativa: "90",
        prodotti: [{ nome: "Finestra PVC bianco 120x140", quantita: 24 }],
        note: "Sostituzione serramenti parti comuni e alloggi, ponteggio condiviso." },
      { clienteId: moretti.id, importoTotale: 9_800, priorita: "media", consegnaIndicativa: "60",
        prodotti: [{ nome: "Portoncino d'ingresso alluminio", quantita: 1 }, { nome: "Finestra alluminio taglio termico", quantita: 6 }] },
      { clienteId: fontana.id, importoTotale: 4_800, priorita: "media", consegnaIndicativa: "30",
        prodotti: [{ nome: "Finestra PVC 100x120", quantita: 4 }, { nome: "Zanzariera a rullo", quantita: 2 }] },
      { clienteId: vanni.id, importoTotale: 6_400, priorita: "bassa", consegnaIndicativa: "60",
        prodotti: [{ nome: "Persiana alluminio effetto legno", quantita: 8 }] },
      { clienteId: grassi.id, importoTotale: 5_900, priorita: "urgente", consegnaIndicativa: "30",
        prodotti: [{ nome: "Porta blindata classe 3", quantita: 1 }, { nome: "Finestra bagno vasistas", quantita: 1 }],
        note: "Cliente in ristrutturazione: coordinarsi con l'impresa." },
      { clienteId: bianchi.id, importoTotale: 14_200, priorita: "media", consegnaIndicativa: "90",
        prodotti: [{ nome: "Telaio PVC grezzo per rivendita", quantita: 12 }] },
    ];
    for (const input of commesse) await creaCommessa(ctx, input);

    console.log("[staging] seme demo: 6 clienti e 6 commesse creati");
    return { seminato: true };
  });
}
```

Se `createClienteFromSync` non accetta `email`/`telefono`/`citta` con la firma attuale, assegnarli con `Object.assign(record, { … })` dopo la creazione, come fa `importaDaCsv` (`clienti.ts:468-490`) — mai inventare campi nuovi. Se `creaCommessa` rifiuta il `ctx` costruito, leggere `authorizeCoreOperation` e completare `ctx.user` con i soli campi che consuma.

In `server/_core/index.ts`, subito dopo il riallineamento timeline (`:81-90`) e prima dei worker:

```ts
  // Dati dimostrativi: solo in staging, solo su store vuoti.
  const { eseguiSemeDemo } = await import("../staging/semeDemo");
  await eseguiSemeDemo();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run server/staging/semeDemo.test.ts`
Expected: PASS (2 test).

- [ ] **Step 5: `pnpm check`, `pnpm test` interi (le guardie `verifica.confine` e `idGlobali` non devono muoversi: nessuno store nuovo, nessun contatore) e commit**

```bash
git add server/staging/semeDemo.ts server/staging/semeDemo.test.ts server/_core/index.ts
git commit -m "feat(staging): seme demo al boot — 6 clienti e 6 commesse via percorsi di dominio, idempotente — Task 5 di «Staging con dati demo»"
```

---

### Task 6: L'accesso di prova — `GET /api/staging/entra`

**Files:**
- Create: `server/staging/rotta.ts`
- Modify: `server/_core/index.ts` — montaggio dopo la creazione di `app`, vicino alle altre rotte anonime (prima del blocco tRPC)
- Test: `server/staging/rotta.test.ts`

**Interfaces:**
- Consumes: `ambienteStaging()`; `apriSessioneLocale({ req, res }, utente)` (`server/localAuth.ts:176`); `getUtentiStore` (store globale).
- Produces: `montaRottaStaging(app: Express): boolean` — monta la rotta e torna `true` SOLO se `ambienteStaging()` e `STAGING_ACCESSO_TOKEN` ha almeno 32 caratteri; altrimenti non monta nulla e torna `false`.

Proprietà di sicurezza (spec R1): doppio gate, confronto in tempo costante, 404 opaco su qualunque fallimento, il token non compare mai in log o messaggi. Il token viaggia in query string: è un token d'ambiente demo, non un dato personale — accettato nella spec (D3) perché il contenuto di staging è dimostrativo per costruzione.

- [ ] **Step 1: Write the failing test**

```ts
// server/staging/rotta.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getUtentiStore } from "../routers/utenti";
import { montaRottaStaging } from "./rotta";

const TOKEN = "token-di-prova-lungo-almeno-32-caratteri!";
const salvate = {
  AMBIENTE: process.env.AMBIENTE,
  STAGING_ACCESSO_TOKEN: process.env.STAGING_ACCESSO_TOKEN,
  BOOTSTRAP_ADMIN_EMAIL: process.env.BOOTSTRAP_ADMIN_EMAIL,
};
afterEach(() => {
  for (const [k, v] of Object.entries(salvate)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function appFinta() {
  const rotte: Record<string, Function> = {};
  return {
    app: { get: (p: string, h: Function) => { rotte[p] = h; } } as any,
    rotte,
  };
}

function resFinta() {
  const res: any = {
    statusCode: 0, redirectUrl: null as string | null, cookies: [] as any[],
    headersSent: false,
    status(c: number) { this.statusCode = c; return this; },
    end() { this.headersSent = true; },
    redirect(c: number, u: string) { this.statusCode = c; this.redirectUrl = u; this.headersSent = true; },
    cookie(nome: string, valore: string, opz: any) { this.cookies.push({ nome, valore, opz }); },
  };
  return res;
}

const reqFinta = (token?: string) =>
  ({ query: token === undefined ? {} : { token }, protocol: "https", headers: {}, get: () => undefined }) as any;

describe("montaRottaStaging", () => {
  beforeEach(() => {
    process.env.AMBIENTE = "staging";
    process.env.STAGING_ACCESSO_TOKEN = TOKEN;
    process.env.BOOTSTRAP_ADMIN_EMAIL = "demo-rotta@test.local";
    const utenti = getUtentiStore() as any[];
    if (!utenti.some((u: any) => u.email === "demo-rotta@test.local")) {
      utenti.push({
        id: 998, email: "demo-rotta@test.local", attivo: true,
        ruoli: ["direzione"], sediIds: [1], tenantId: 1,
        nome: "Demo", cognome: "Rotta",
        createdAt: new Date(), updatedAt: new Date(),
      });
    }
  });

  it("non monta nulla fuori da staging", () => {
    delete process.env.AMBIENTE;
    const { app, rotte } = appFinta();
    expect(montaRottaStaging(app)).toBe(false);
    expect(Object.keys(rotte)).toHaveLength(0);
  });

  it("non monta nulla con token assente o corto", () => {
    process.env.STAGING_ACCESSO_TOKEN = "corto";
    const { app, rotte } = appFinta();
    expect(montaRottaStaging(app)).toBe(false);
    expect(Object.keys(rotte)).toHaveLength(0);
  });

  it("token sbagliato: 404 opaco, nessun cookie", async () => {
    const { app, rotte } = appFinta();
    expect(montaRottaStaging(app)).toBe(true);
    const res = resFinta();
    await rotte["/api/staging/entra"](reqFinta("sbagliato-ma-della-stessa-lunghezza!!!!!!"), res);
    expect(res.statusCode).toBe(404);
    expect(res.cookies).toHaveLength(0);
  });

  it("token giusto: cookie di sessione e redirect a /", async () => {
    const { app, rotte } = appFinta();
    montaRottaStaging(app);
    const res = resFinta();
    await rotte["/api/staging/entra"](reqFinta(TOKEN), res);
    expect(res.redirectUrl).toBe("/");
    expect(res.cookies.some((c: any) => c.nome === "app_session_id")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run server/staging/rotta.test.ts`
Expected: FAIL — modulo inesistente.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/staging/rotta.ts
import { timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import { ambienteStaging } from "../_core/ambiente";

/**
 * Accesso di prova per staging: un link con token apre la sessione
 * dell'utente demo (l'admin di bootstrap) senza digitare una password —
 * gli agenti non possono digitarne, e il link si può incollare nel pannello
 * Browser. Doppio gate: la rotta ESISTE solo se AMBIENTE=staging e il
 * token d'ambiente è impostato (≥32 caratteri). Qualunque fallimento è un
 * 404 senza dettagli; il token non finisce mai nei log.
 */
export function montaRottaStaging(app: Express): boolean {
  const atteso = process.env.STAGING_ACCESSO_TOKEN ?? "";
  if (!ambienteStaging() || atteso.length < 32) return false;

  app.get("/api/staging/entra", async (req: Request, res: Response) => {
    try {
      const fornito = String((req.query as any).token ?? "");
      const a = Buffer.from(fornito);
      const b = Buffer.from(atteso);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        res.status(404).end();
        return;
      }
      const { getUtentiStore } = await import("../routers/utenti");
      const email = (process.env.BOOTSTRAP_ADMIN_EMAIL ?? "admin@ruffinogroup.it").toLowerCase();
      const utente = (getUtentiStore() as any[]).find(
        u => u.attivo && String(u.email).toLowerCase() === email
      );
      if (!utente) {
        res.status(404).end();
        return;
      }
      const { apriSessioneLocale } = await import("../localAuth");
      await apriSessioneLocale({ req, res }, utente);
      res.redirect(302, "/");
    } catch {
      // Express 4 non cattura la promise rifiutata: senza questo catch il
      // processo cadrebbe (v. server/_core/rotteAnonime.ts).
      if (!res.headersSent) res.status(404).end();
    }
  });
  return true;
}
```

In `server/_core/index.ts`, dopo la creazione di `app` e degli header di sicurezza, vicino alle altre rotte anonime:

```ts
  // Accesso di prova: esiste solo in staging con token impostato.
  const { montaRottaStaging } = await import("../staging/rotta");
  montaRottaStaging(app);
```

Se `getSessionCookieOptions` dentro `apriSessioneLocale` consuma metodi di `req` non presenti nel mock (`req.get`, `req.secure`…), completare `reqFinta` nel test — non cambiare la rotta.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run server/staging/rotta.test.ts`
Expected: PASS (4 test).

- [ ] **Step 5: `pnpm check`, `pnpm test` e commit**

```bash
git add server/staging/rotta.ts server/staging/rotta.test.ts server/_core/index.ts
git commit -m "feat(staging): rotta /api/staging/entra — accesso demo con token, 404 opaco, doppio gate — Task 6 di «Staging con dati demo»"
```

---

### Task 7: Banner «Ambiente di prova» nel client

**Files:**
- Create: `client/src/components/layout/BannerAmbiente.tsx`
- Modify: `client/src/components/layout/ModularControlLayout.tsx:233` (accanto ad `<AvvisoAzienda />`), `client/src/components/layout/LegacyDashboardLayout.tsx:457` (idem)

**Interfaces:**
- Consumes: `system.ambiente` (Task 4) via il client tRPC del repo (stesso hook usato da `AvvisoAzienda.tsx:60-75`).
- Produces: componente `BannerAmbiente` che non rende nulla quando `staging` è falso o la query non ha risposto.

Modello da imitare riga per riga: `client/src/components/abbonamento/AvvisoAzienda.tsx` (hook tutti sopra il primo `return`, `role="status"`, token semantici, `staleTime`, `retry: false`). Differenze volute: nessuna chiusura (il banner d'ambiente resta visibile), variante `warning`, testo fisso.

- [ ] **Step 1: Write the implementation** (il repo non ha test di componenti — punto 17 della lista direzione; la verifica è nel browser, Step 3)

```tsx
// client/src/components/layout/BannerAmbiente.tsx
// Fascia d'ambiente: compare SOLO quando il server dichiara staging
// (system.ambiente). Non è chiudibile: chi guarda staging deve saperlo
// sempre. Modello: AvvisoAzienda (stessa posizione, stessi token).
import { trpc } from "@/lib/trpc";

export function BannerAmbiente() {
  const ambiente = trpc.system.ambiente.useQuery(undefined, {
    staleTime: Infinity,
    retry: false,
  });
  if (!ambiente.data?.staging) return null;
  return (
    <div
      role="status"
      className="mb-3 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm"
    >
      Ambiente di prova — i dati sono dimostrativi e possono essere azzerati
      in ogni momento.
    </div>
  );
}
```

Adattare import del client tRPC e classi ai valori ESATTI usati da `AvvisoAzienda.tsx` (import a inizio file, classi a `:106-112`): i token `warning` del repo vincono su quelli scritti qui. Montare in `ModularControlLayout.tsx` immediatamente sopra `<AvvisoAzienda />` (`:233`, DENTRO l'area di lavoro, FUORI da `AnimatePresence` — stesso commento di `:229-232`) e in `LegacyDashboardLayout.tsx` accanto all'`<AvvisoAzienda />` di `:457`.

- [ ] **Step 2: `pnpm check` e `pnpm build`**

Expected: verdi. Il banner non può rompere la guardia del landmark unico (`client/src/lib/modularRoutePresentation.test.ts:533`): è un `div role="status"`, non un `main`.

- [ ] **Step 3: Verifica browser (obbligatoria, CLAUDE.md «UI e UX»)**

1. Aggiungere a `.claude/launch.json` una voce TEMPORANEA su porta libera (es. 5196) uguale a «Dev Server (Express + Vite)» più `"AMBIENTE": "staging"` e `"STAGING_ACCESSO_TOKEN": "token-locale-di-prova-di-32-caratteri!!"`.
2. `preview_start` su quella voce; senza `DATABASE_URL` gli store sono in memoria: il seme demo gira e il log mostra `[staging] seme demo` e `[ambiente] staging: giri esterni spenti`.
3. Aprire `http://localhost:5196/api/staging/entra?token=token-locale-di-prova-di-32-caratteri!!` → redirect a `/` con sessione attiva, banner visibile sopra il contenuto.
4. Controllare 1440×900 e 390×844 (`document.documentElement.scrollWidth === clientWidth`), console senza errori (leggere SEMPRE la console: un errore React in dev è solo un log, in produzione spegne la pagina).
5. Ripristinare il file: `git checkout -- .claude/launch.json`.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/layout/BannerAmbiente.tsx client/src/components/layout/ModularControlLayout.tsx client/src/components/layout/LegacyDashboardLayout.tsx
git commit -m "feat(staging): banner «Ambiente di prova» nelle due shell — Task 7 di «Staging con dati demo»"
```

---

### Task 8: Runbook e documenti

**Files:**
- Create: `docs/runbooks/staging.md`
- Modify: `handoff.md` (nuova voce in testa alle novità), `documento_requisiti_infissi_ops.md` (nuova sottosezione nel capitolo piattaforma/SaaS, numerata dopo l'ultima esistente), `CLAUDE.md` (una riga negli «Invarianti»)

**Interfaces:**
- Consumes: la spec (`docs/superpowers/specs/2026-09-10-staging-demo-design.md`) — la tabella variabili si RIMANDA, non si duplica.
- Produces: il runbook che un operatore segue per creare l'ambiente su Railway.

- [ ] **Step 1: Scrivere `docs/runbooks/staging.md`** con questa struttura (contenuti dalla spec, qui il sommario vincolante):
  1. **Scopo e principi** — staging non parla mai con servizi esterni (D2); mai dati di produzione con credenziali vere dentro (R2); una sola replica anche qui.
  2. **Creazione dell'ambiente su Railway** (manuale, progetto `successful-playfulness`): nuovo environment `staging`; servizio app duplicato dallo stesso repo/branch `main`; **nuovo** servizio Postgres dedicato; dominio (`staging.wyndoor.com` o quello generato).
  3. **Variabili** — rimando alla tabella della spec; istruzione esplicita: generare `JWT_SECRET`, `MAIL_ENCRYPTION_KEY`, `BOOTSTRAP_ADMIN_PASSWORD`, `STAGING_ACCESSO_TOKEN` con `openssl rand -base64 32`; elencare le variabili che NON vanno MAI impostate (dalla spec).
  4. **Primo avvio — verifica** (checklist): healthcheck verde; log con `[ambiente] staging: giri esterni spenti` e `[staging] seme demo: 6 clienti e 6 commesse creati`; `GET /api/staging/entra?token=…` → sessione demo; banner visibile; pannello piattaforma raggiungibile con `demo@wyndoor.com`; creazione di un'azienda di prova dal pannello (il link d'invito compare nel pannello perché Resend non c'è).
  5. **Ambienti per PR** — levetta Railway «PR environments» che forka `staging`; ogni PR riceve servizio+Postgres nuovi, il seme gira da solo; verificare sul primo PR che il Postgres forcato sia VUOTO e separato.
  6. **Manutenzione** — quando si aggiunge una variabile in produzione va aggiunta anche a staging (R4); come azzerare i dati demo (cancellare le righe di `kv_store` del Postgres STAGING o ricreare il servizio Postgres; MAI toccare quello di produzione — controllare `DATABASE_URL` due volte prima di qualunque `DELETE`).
- [ ] **Step 2: `handoff.md`** — nuova voce datata in testa: cosa esiste (i tre meccanismi + banner), cosa resta MANUALE e non fatto (ambiente Railway, variabili, levetta PR), link a spec/runbook/piano. Dichiarare esplicitamente: «l'ambiente Railway non è stato creato da questo lavoro».
- [ ] **Step 3: `documento_requisiti_infissi_ops.md`** — sottosezione breve: requisito (verifica a schermo prima del merge), i tre meccanismi, il vincolo «staging non parla con l'esterno», rimando al runbook.
- [ ] **Step 4: `CLAUDE.md`** — negli «Invarianti», una riga:

```markdown
- `AMBIENTE=staging` è l'unica identità d'ambiente (`server/_core/ambiente.ts`,
  mai `NODE_ENV`): in staging i giri esterni non partono (`giriEsterni.ts`),
  il seme demo gira solo su store vuoti e la rotta `/api/staging/entra`
  esiste solo lì. Nessun altro file legge `process.env.AMBIENTE`.
```

- [ ] **Step 5: `pnpm check && pnpm test && pnpm build` interi e commit**

```bash
git add docs/runbooks/staging.md handoff.md documento_requisiti_infissi_ops.md CLAUDE.md
git commit -m "docs(staging): runbook ambiente staging, handoff, PRD e invariante AMBIENTE — Task 8 di «Staging con dati demo»"
```

---

## Operazioni fuori dal codice (dichiarate, NON eseguite da questo piano)

Su Railway, a merge avvenuto, un operatore umano: crea l'environment `staging` + Postgres dedicato, imposta le variabili della spec, verifica la checklist del runbook, accende la levetta PR environments. Finché non succede, esiste il codice ma non l'ambiente — nessun documento deve presentarlo come attivo.

## Self-review (fatta)

- **Copertura spec**: D1→Task 1, D2→Task 2, D3→Task 6, D4→Task 5, D5→solo runbook (nessun codice, coerente), D6→Task 4+7, D7→Task 3, D8→Task 8. R1 coperto dai test del Task 6; R3 dai test del Task 5.
- **Tipi e nomi coerenti fra task**: `ambienteStaging` (1→2,3,4,5,6), `avviaGiriEsterni` (2→3), `system.ambiente` (4→7), `eseguiSemeDemo` (5), `montaRottaStaging` (6).
- **Punti di adattamento dichiarati** (non segnaposto: la fonte esatta è citata): campi extra di `createClienteFromSync` → pattern `importaDaCsv` (`clienti.ts:468-490`); forma di `ctx.user` → `authorizeCoreOperation`; classi `warning` → `AvvisoAzienda.tsx:106-112`; mock `req` → `getSessionCookieOptions`.
