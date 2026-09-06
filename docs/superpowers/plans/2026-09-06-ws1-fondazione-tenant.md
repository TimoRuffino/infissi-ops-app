# WS1 — Fondazione tenant: piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** il tenant (azienda) esiste come entità, è risolto a ogni richiesta, è imposto da guardie server-side, ha un control plane relazionale e un ruolo Proprietario; Ruffino Group è il tenant 1 e ogni altro tenant si ferma alla «porta chiusa» finché il WS2 non rende tenant-aware gli archivi.

**Architecture:** un modulo nuovo `server/tenants/` (costanti, tipi, regole pure, repository Postgres/memoria, servizio di dominio, contesto, router, boot, comandi) più ritocchi mirati a `context.ts`, `trpc.ts`, `permissions.ts`, `utenti.ts`, `sedi.ts`, `permessi.ts`, `capabilities.ts`, `interruttori.ts`, `tars/contesto.ts`. Tutto dietro `FLAG_MULTI_AZIENDA` (fail-closed). Il server è l'unico a scrivere tabelle e store: lo script CLI accoda comandi che il server esegue.

**Tech Stack:** TypeScript, Express + tRPC 11, `postgres` (postgres-js) con `ensureSchema()` a mano, `persistedStore` JSONB, zod, vitest (`server/_core/testSetup.ts` vieta la rete), tsx per gli script, React 19 solo per l'etichetta «Proprietario».

**Spec:** `docs/superpowers/specs/2026-09-06-ws1-fondazione-tenant-design.md` (spec madre: `docs/superpowers/specs/2026-09-06-saas-multi-azienda-design.md`).

## Global Constraints

- `FLAG_MULTI_AZIENDA` è letto a ogni chiamata, fail-closed: spento = il CRM di oggi, nessuna guardia nuova (spec §8.1). In test è acceso per default come ogni interruttore; un test che vuole il comportamento spento lo imposta con `process.env.FLAG_MULTI_AZIENDA = "off"` e lo ripristina in `afterEach`.
- Il server è l'unico a scrivere `tenants`, `tenant_eventi`, `tenant_comandi` e gli store JSONB; lo script scrive solo `tenant_comandi` tramite `repository.accodaComando` (spec §6.2). Mai script esterni contro gli store con l'istanza viva.
- Un record di utente o sede di un altro tenant risponde `NOT_FOUND` «Risorsa non trovata.», mai `FORBIDDEN` (spec §5.3).
- Nessuno schema di input tRPC o di strumento Tars accetta `tenantId` o `tenant`: il tenant viene solo dal contesto (spec §10.8).
- `tenantId` di utenti e sedi legacy = `1` (`TENANT_PREDEFINITO_ID`); tenant 1 = slug `ruffino-group`, nome «Ruffino Group».
- Messaggi degli errori (spec §5.4), copiati alla lettera: «L'azienda non è ancora attiva su questa installazione.», «Azienda sospesa: il gestionale è in sola lettura.», «L'azienda non ha una sede attiva.», «Solo un proprietario può nominare o revocare un proprietario.», «Il ruolo proprietario richiede FLAG_MULTI_AZIENDA.».
- Ruolo `proprietario`: ottavo valore in `RUOLI`, conta nel massimo di 3; capability `tenant.manage_proprietari` la dà solo il ruolo, mai la direzione per costruzione, mai override o delega (spec §4.4).
- Non toccare i 50 store business, i 165 filtri per sede, file, backup, integrazioni, worker, ledger Tars (spec §3.3).
- Definizione di completato del repo: `pnpm check`, `pnpm test`, `pnpm build` verdi; UI verificata a 1440×900 e 390×844 o dichiarata non verificata; PRD e handoff aggiornati.
- Commit in italiano, stile del repo (`feat(tenant): …`, `test(tenant): …`, `docs: …`), con la coda `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Un commit per task, sul branch di lavoro `feature/ws1-fondazione-tenant` creato da `claude/ruffino-flow-saas-multi-afaecf` (= `main` più spec e piano: `git checkout -b feature/ws1-fondazione-tenant claude/ruffino-flow-saas-multi-afaecf`), in un worktree dedicato. Mai push su `main` (= produzione).

## Mappa dei file

| File | Responsabilità | Task |
|---|---|---|
| `server/platform/interruttori.ts` | interruttore `multiAzienda` | 1 |
| `server/tenants/costanti.ts` | id/slug/nome del tenant 1, nomi di ruolo e capability, intervallo comandi, regex slug, messaggi | 2 |
| `server/tenants/tipi.ts` | `TenantRecord`, `Attore`, eventi, comandi, `attoreTesto` | 2 |
| `server/tenants/regole.ts` | funzioni pure: slug, porta chiusa, presidi, ruoli | 2 |
| `server/authz/capabilities.ts` | ruolo `proprietario`, capability `tenant.manage_proprietari`, eccezione della direzione | 3 |
| `server/routers/permessi.ts` | rifiuto di override e deleghe sulla capability; `findUserInSede` con tenant | 3, 8 |
| `server/tenants/repository.ts` | schema (tabelle, indici, trigger), variante Postgres e memoria, cache, eventi, comandi | 4 |
| `server/routers/sedi.ts` | `tenantId` sulle sedi, `sediDelTenant`, `sedePredefinita`, `creaSedeInterna`, router per tenant | 5, 8 |
| `server/routers/utenti.ts` | `tenantId` sugli utenti, `creaUtenteInterno`, ruolo proprietario, guardie, router per tenant | 5, 8 |
| `server/tenants/contesto.ts` | `risolviTenantPerUtente`, `sediAmmesse`, `tenantIdDellaSede` | 5 |
| `server/_core/context.ts` | `tenantId` e `tenant` nel `TrpcContext`, risoluzione | 6 |
| `server/_core/contestoDiProva.ts` | helper per i test | 6 |
| `server/_core/trpc.ts` | `sessionProcedure`, guardie tenant, `adminProcedure` | 7 |
| `server/_core/permissions.ts` | `assertTenantScope` | 7 |
| `server/routers.ts` | porta chiusa nel login, montaggio di `tenants` | 7 |
| `server/tenants/router.ts` | `tenants.mio` | 7 |
| `server/tenants/comandi.ts` | schemi zod dei payload, `richiestoDa` | 9 |
| `server/tenants/servizio.ts` | servizio di dominio e esecuzione dei comandi | 9 |
| `scripts/tenant.ts`, `package.json`, `.env.example` | CLI `pnpm tenant` | 10 |
| `server/tenants/boot.ts`, `server/_core/index.ts`, `docs/runbooks/piattaforma-recovery.md` | avvio | 11 |
| `server/tars/strumenti/tipi.ts`, `server/tars/contesto.ts`, `server/tars/azioni/policy.ts`, `server/tars/strumenti/comune.ts` | Tars con tenant | 12 |
| `server/tenants/confine.test.ts` | guardie strutturali | 13 |
| `client/src/lib/roles.ts`, `client/src/pages/UtentiList.tsx`, `client/src/components/users/UserPermissionsDialog.tsx`, `client/src/components/users/CapabilityMatrix.tsx` | etichetta e opzione «Proprietario» | 14 |
| PRD, `handoff.md`, `docs/runbooks/multi-azienda.md`, `docs/tars/architettura-tars-v2.md`, spec WS1 | documentazione | 15 |

Convenzioni dei test: vitest, file accanto al codice; per i router `appRouter.createCaller(ctx)`; id di prova alti e unici per file (es. 97xxx) perché gli store sono condivisi fra i test dello stesso processo; niente rete.

---

### Task 1: Interruttore `multiAzienda`

**Files:**
- Modify: `server/platform/interruttori.ts:20-62` (tipo `Interruttore`), `:64-87` (`VARIABILE`), `:89-114` (`ETICHETTA`), `:144-179` (le due liste `Exclude<…>` di `tarsAttivo` e `assicuraTars`)
- Modify: `.env.example:48-66`
- Test: `server/platform/interruttori.multiAzienda.test.ts`

**Interfaces:**
- Produces: `interruttoreAttivo("multiAzienda")`, `statoInterruttori().multiAzienda`, env `FLAG_MULTI_AZIENDA`.

- [ ] **Step 1: Scrivi il test che fallisce**

```ts
// server/platform/interruttori.multiAzienda.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { interruttoreAttivo, statoInterruttori } from "./interruttori";

const NODE_ENV = process.env.NODE_ENV;

afterEach(() => {
  delete process.env.FLAG_MULTI_AZIENDA;
  process.env.NODE_ENV = NODE_ENV;
});

describe("FLAG_MULTI_AZIENDA", () => {
  it("in test è acceso per default e compare nello stato", () => {
    expect(interruttoreAttivo("multiAzienda")).toBe(true);
    expect(statoInterruttori().multiAzienda).toBe(true);
  });

  it("in produzione è spento finché l'env non dice on", () => {
    process.env.NODE_ENV = "production";
    expect(interruttoreAttivo("multiAzienda")).toBe(false);
    process.env.FLAG_MULTI_AZIENDA = "on";
    expect(interruttoreAttivo("multiAzienda")).toBe(true);
  });

  it("off vince anche in test", () => {
    process.env.FLAG_MULTI_AZIENDA = "off";
    expect(interruttoreAttivo("multiAzienda")).toBe(false);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `pnpm vitest run server/platform/interruttori.multiAzienda.test.ts`
Expected: FAIL, errore di tipo/valore su `"multiAzienda"` (chiave assente in `VARIABILE`).

- [ ] **Step 3: Aggiungi l'interruttore**

In `server/platform/interruttori.ts`:

```ts
  // Multi-azienda, WS1 (06/09/2026): tenant sopra le sedi. Spento = il CRM
  // di oggi (tenant 1 implicito, nessuna guardia). Spec:
  // docs/superpowers/specs/2026-09-06-ws1-fondazione-tenant-design.md §8.
  | "multiAzienda";
```
(aggiungi la riga in coda al tipo `Interruttore`, dopo `"anteprimeEvidenze"`, con `|` davanti a `"anteprimeEvidenze"` come per le altre voci).

In `VARIABILE`: `multiAzienda: "FLAG_MULTI_AZIENDA",`.
In `ETICHETTA`: `multiAzienda: "Il multi-azienda (tenant sopra le sedi)",`.
Nelle due liste `Exclude<Interruttore, …>` di `tarsAttivo` e `assicuraTars` aggiungi `| "multiAzienda"` dopo `| "anteprimeEvidenze"` (non è una funzione di Tars).

In `.env.example`, dopo la riga `# FLAG_CONTRATTO_ESTRAZIONE=off`:

```text
# Multi-azienda, WS1 (06/09/2026): tenant sopra le sedi. Fail-closed: spento in
# produzione finché non è "on". Spento = tenant 1 implicito, nessuna guardia.
# FLAG_MULTI_AZIENDA=off
```

- [ ] **Step 4: Esegui i test dell'interruttore**

Run: `pnpm vitest run server/platform/interruttori.multiAzienda.test.ts server/platform/interruttori.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/platform/interruttori.ts server/platform/interruttori.multiAzienda.test.ts .env.example
git commit -m "feat(tenant): interruttore FLAG_MULTI_AZIENDA, fail-closed come gli altri

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Costanti, tipi e regole pure del modulo `tenants`

**Files:**
- Create: `server/tenants/costanti.ts`, `server/tenants/tipi.ts`, `server/tenants/regole.ts`
- Test: `server/tenants/regole.test.ts`

**Interfaces:**
- Produces: `TENANT_PREDEFINITO_ID = 1`, `TENANT_PREDEFINITO_SLUG`, `TENANT_PREDEFINITO_NOME`, `RUOLO_PROPRIETARIO = "proprietario"`, `CAPABILITY_PROPRIETARI = "tenant.manage_proprietari"`, `INTERVALLO_COMANDI_MS = 30_000`, `SLUG_RE`, `MESSAGGI`; tipi `TenantRecord`, `StatoTenant`, `Attore`, `TenantEvento`, `TipoEvento`, `TenantComando`, `TipoComando`, `StatoComando`, `attoreTesto(a)`; regole `slugValido`, `portaChiusaPerTenant`, `ruoliDi`, `contaPresidi`, `motivoRifiutoPresidio`, `proprietarioAggiunto`, `proprietarioTolto`, tipo `UtentePresidio`.

- [ ] **Step 1: Scrivi il test che fallisce**

```ts
// server/tenants/regole.test.ts
import { describe, expect, it } from "vitest";
import {
  contaPresidi,
  motivoRifiutoPresidio,
  portaChiusaPerTenant,
  proprietarioAggiunto,
  proprietarioTolto,
  ruoliDi,
  slugValido,
  type UtentePresidio,
} from "./regole";

const u = (
  id: number,
  ruoli: string[],
  tenantId = 1,
  attivo = true
): UtentePresidio => ({ id, ruoli, tenantId, attivo });

describe("slugValido", () => {
  it("accetta minuscole, cifre e trattini interni", () => {
    expect(slugValido("ruffino-group")).toBe(true);
    expect(slugValido("acme2")).toBe(true);
  });
  it("rifiuta maiuscole, trattini agli estremi, spazi e slug troppo lunghi", () => {
    expect(slugValido("Acme")).toBe(false);
    expect(slugValido("-acme")).toBe(false);
    expect(slugValido("acme-")).toBe(false);
    expect(slugValido("ac me")).toBe(false);
    expect(slugValido("a".repeat(41))).toBe(false);
  });
});

describe("portaChiusaPerTenant (WS1)", () => {
  it("apre solo il tenant 1", () => {
    expect(portaChiusaPerTenant(1)).toBe(false);
    expect(portaChiusaPerTenant(2)).toBe(true);
  });
});

describe("ruoliDi", () => {
  it("preferisce ruoli[] e ricade su ruolo", () => {
    expect(ruoliDi({ ruoli: ["ordini", "commerciale"] })).toEqual(["ordini", "commerciale"]);
    expect(ruoliDi({ ruoli: [], ruolo: "direzione" })).toEqual(["direzione"]);
    expect(ruoliDi(null)).toEqual([]);
  });
});

describe("presìdi per tenant", () => {
  const utenti = [
    u(1, ["direzione", "proprietario"], 1),
    u(2, ["commerciale"], 1),
    u(3, ["direzione"], 2),
    u(4, ["proprietario"], 2, false),
  ];

  it("conta solo attivi del tenant", () => {
    expect(contaPresidi(utenti, 1)).toEqual({ direzione: 1, proprietari: 1 });
    expect(contaPresidi(utenti, 2)).toEqual({ direzione: 1, proprietari: 0 });
  });

  it("rifiuta di togliere l'ultima direzione o l'ultimo proprietario del tenant", () => {
    expect(
      motivoRifiutoPresidio(utenti[0], { ...utenti[0], ruoli: ["proprietario"] }, utenti)
    ).toMatch(/ultimo utente direzione/);
    expect(
      motivoRifiutoPresidio(utenti[0], { ...utenti[0], ruoli: ["direzione"] }, utenti)
    ).toMatch(/ultimo proprietario/);
    expect(motivoRifiutoPresidio(utenti[0], null, utenti)).toMatch(/ultimo utente direzione/);
    expect(motivoRifiutoPresidio(utenti[0], { ...utenti[0], attivo: false }, utenti)).not.toBeNull();
  });

  it("non guarda oltre il tenant e lascia passare le modifiche innocue", () => {
    expect(motivoRifiutoPresidio(utenti[2], null, utenti)).toMatch(/ultimo utente direzione/);
    expect(motivoRifiutoPresidio(utenti[1], null, utenti)).toBeNull();
    const conDue = [...utenti, u(5, ["direzione", "proprietario"], 1)];
    expect(motivoRifiutoPresidio(conDue[0], null, conDue)).toBeNull();
  });

  it("riconosce quando il ruolo proprietario entra o esce", () => {
    expect(proprietarioAggiunto(["direzione"], ["direzione", "proprietario"])).toBe(true);
    expect(proprietarioAggiunto(["proprietario"], ["proprietario"])).toBe(false);
    expect(proprietarioTolto(["proprietario"], ["direzione"])).toBe(true);
    expect(proprietarioTolto(["direzione"], ["direzione"])).toBe(false);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `pnpm vitest run server/tenants/regole.test.ts`
Expected: FAIL, modulo `./regole` inesistente.

- [ ] **Step 3: Scrivi costanti, tipi e regole**

```ts
// server/tenants/costanti.ts
// Il tenant (azienda) sopra le sedi — WS1 (06/09/2026). Spec:
// docs/superpowers/specs/2026-09-06-ws1-fondazione-tenant-design.md

/** Ruffino Group. MUST stay 1: è il backfill di ogni utente e sede legacy. */
export const TENANT_PREDEFINITO_ID = 1;
export const TENANT_PREDEFINITO_SLUG = "ruffino-group";
export const TENANT_PREDEFINITO_NOME = "Ruffino Group";

export const RUOLO_PROPRIETARIO = "proprietario" as const;
export const CAPABILITY_PROPRIETARI = "tenant.manage_proprietari" as const;

export const INTERVALLO_COMANDI_MS = 30_000;

/** Minuscole, cifre, trattini interni; da 1 a 40 caratteri. */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export const MESSAGGI = {
  portaChiusa: "L'azienda non è ancora attiva su questa installazione.",
  solaLettura: "Azienda sospesa: il gestionale è in sola lettura.",
  senzaSede: "L'azienda non ha una sede attiva.",
  soloProprietari: "Solo un proprietario può nominare o revocare un proprietario.",
  proprietarioRichiedeFlag: "Il ruolo proprietario richiede FLAG_MULTI_AZIENDA.",
  nonTrovato: "Risorsa non trovata.",
} as const;
```

```ts
// server/tenants/tipi.ts
export type StatoTenant = "attivo" | "sospeso";

export type TenantRecord = {
  id: number;
  slug: string;
  nome: string;
  stato: StatoTenant;
  motivoStato: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type Attore =
  | { tipo: "utente"; id: number }
  | { tipo: "script"; nome: string }
  | { tipo: "boot" };

export function attoreTesto(attore: Attore): string {
  if (attore.tipo === "utente") return `utente:${attore.id}`;
  if (attore.tipo === "script") return attore.nome.startsWith("script:") ? attore.nome : `script:${attore.nome}`;
  return "boot";
}

export type TipoEvento =
  | "creato"
  | "sospeso"
  | "riattivato"
  | "proprietario_assegnato"
  | "proprietario_revocato"
  | "comando_fallito";

export type TenantEvento = {
  id: number;
  tenantId: number;
  tipo: TipoEvento;
  attore: string;
  motivo: string | null;
  dettagli: Record<string, unknown> | null;
  createdAt: Date;
};

export type TipoComando =
  | "crea"
  | "sospendi"
  | "riattiva"
  | "assegna_proprietario"
  | "revoca_proprietario";

export type StatoComando = "in_attesa" | "eseguito" | "errore";

export type TenantComando = {
  id: number;
  tipo: TipoComando;
  tenantId: number | null;
  payload: Record<string, unknown>;
  stato: StatoComando;
  esito: Record<string, unknown> | null;
  richiestoDa: string;
  createdAt: Date;
  eseguitoAt: Date | null;
};
```

```ts
// server/tenants/regole.ts
// Regole pure del tenant: niente store, niente database, niente tRPC.
import { RUOLO_PROPRIETARIO, SLUG_RE, TENANT_PREDEFINITO_ID } from "./costanti";

export type UtentePresidio = {
  id: number;
  attivo: boolean;
  ruoli: string[];
  tenantId: number;
};

export function slugValido(slug: string): boolean {
  return SLUG_RE.test(slug);
}

/**
 * WS1 soltanto: la «porta chiusa». Gli archivi business non sono ancora
 * tenant-aware, quindi ogni tenant diverso dal predefinito viene rifiutato.
 * Il WS2 toglie questa funzione insieme ai suoi due chiamanti (guardia e login).
 */
export function portaChiusaPerTenant(tenantId: number): boolean {
  return tenantId !== TENANT_PREDEFINITO_ID;
}

export function ruoliDi(
  utente: { ruoli?: unknown; ruolo?: unknown } | null | undefined
): string[] {
  if (!utente) return [];
  if (Array.isArray(utente.ruoli) && utente.ruoli.length > 0) {
    return utente.ruoli.filter((r): r is string => typeof r === "string");
  }
  return typeof utente.ruolo === "string" && utente.ruolo ? [utente.ruolo] : [];
}

export function contaPresidi(
  utenti: readonly UtentePresidio[],
  tenantId: number
): { direzione: number; proprietari: number } {
  let direzione = 0;
  let proprietari = 0;
  for (const u of utenti) {
    if (!u.attivo || u.tenantId !== tenantId) continue;
    if (u.ruoli.includes("direzione")) direzione++;
    if (u.ruoli.includes(RUOLO_PROPRIETARIO)) proprietari++;
  }
  return { direzione, proprietari };
}

/**
 * Messaggio di rifiuto se la modifica (`dopo`) o la cancellazione (`dopo = null`)
 * lascerebbe il tenant di `prima` senza direzione attiva o senza proprietario
 * attivo. Il conteggio non attraversa mai i tenant.
 */
export function motivoRifiutoPresidio(
  prima: UtentePresidio,
  dopo: UtentePresidio | null,
  utenti: readonly UtentePresidio[]
): string | null {
  const altri = utenti.filter(u => u.id !== prima.id);
  const futuro = dopo ? [...altri, dopo] : altri;
  const ora = contaPresidi(utenti, prima.tenantId);
  const poi = contaPresidi(futuro, prima.tenantId);
  if (ora.direzione > 0 && poi.direzione === 0) {
    return "Impossibile: questo è l'ultimo utente direzione attivo dell'azienda. Promuovi un altro utente prima di disattivarlo, eliminarlo o togliergli il ruolo.";
  }
  if (ora.proprietari > 0 && poi.proprietari === 0) {
    return "Impossibile: questo è l'ultimo proprietario attivo dell'azienda. Nomina un altro proprietario prima di disattivarlo, eliminarlo o togliergli il ruolo.";
  }
  return null;
}

export function proprietarioAggiunto(prima: readonly string[], dopo: readonly string[]): boolean {
  return !prima.includes(RUOLO_PROPRIETARIO) && dopo.includes(RUOLO_PROPRIETARIO);
}

export function proprietarioTolto(prima: readonly string[], dopo: readonly string[]): boolean {
  return prima.includes(RUOLO_PROPRIETARIO) && !dopo.includes(RUOLO_PROPRIETARIO);
}
```

- [ ] **Step 4: Esegui il test**

Run: `pnpm vitest run server/tenants/regole.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/tenants/costanti.ts server/tenants/tipi.ts server/tenants/regole.ts server/tenants/regole.test.ts
git commit -m "feat(tenant): costanti, tipi e regole pure del modulo tenants

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Ruolo `proprietario` e capability `tenant.manage_proprietari`

**Files:**
- Modify: `server/authz/capabilities.ts:1-53` (elenco), `:69-151` (`ROLE_CAPABILITIES`), `:153-163` (`capabilitiesForRoles`)
- Modify: `server/routers/permessi.ts:158-170` (`updateOverride`), `:232-245` (`createDelegation`)
- Test: `server/authz/capabilities.tenant.test.ts`, `server/routers/permessi.tenant.test.ts`

**Interfaces:**
- Produces: `"tenant.manage_proprietari"` in `CAPABILITIES`; `capabilitiesForRoles(["proprietario"])` = condivise + la capability; `capabilitiesForRoles(["direzione"])` = tutte tranne quella; `permessi.updateOverride` e `permessi.createDelegation` rifiutano la capability con `FORBIDDEN`.

- [ ] **Step 1: Scrivi i test che falliscono**

```ts
// server/authz/capabilities.tenant.test.ts
import { describe, expect, it } from "vitest";
import { ALL_CAPABILITIES, CAPABILITIES, capabilitiesForRoles } from "./capabilities";

describe("capability tenant.manage_proprietari (WS1)", () => {
  it("esiste nel catalogo", () => {
    expect(ALL_CAPABILITIES.has("tenant.manage_proprietari")).toBe(true);
  });

  it("la dà solo il ruolo proprietario, insieme alle condivise", () => {
    const caps = capabilitiesForRoles(["proprietario"]);
    expect(caps.has("tenant.manage_proprietari")).toBe(true);
    expect(caps.has("cliente.read")).toBe(true);
    expect(caps.has("commessa.read")).toBe(true);
    expect(caps.has("economia.read")).toBe(false);
  });

  it("la direzione ha tutto tranne quella", () => {
    const caps = capabilitiesForRoles(["direzione"]);
    expect(caps.has("tenant.manage_proprietari")).toBe(false);
    for (const c of CAPABILITIES) {
      if (c !== "tenant.manage_proprietari") expect(caps.has(c)).toBe(true);
    }
  });

  it("proprietario + direzione = tutto", () => {
    const caps = capabilitiesForRoles(["proprietario", "direzione"]);
    expect(caps.size).toBe(CAPABILITIES.length);
  });

  it("gli altri ruoli non la ricevono", () => {
    for (const r of ["amministrazione", "commerciale", "tecnico_rilievi", "squadra_posa", "post_vendita", "ordini"]) {
      expect(capabilitiesForRoles([r]).has("tenant.manage_proprietari")).toBe(false);
    }
  });
});
```

```ts
// server/routers/permessi.tenant.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";
import { getUtentiStore } from "./utenti";

const SEDE = 97101;
const DIREZIONE_ID = 97111;
const TARGET_ID = 97112;

function context(userId: number, ruoli: string[]): TrpcContext {
  return {
    user: {
      id: userId,
      role: ruoli.includes("direzione") ? "admin" : "user",
      ruolo: ruoli[0],
      ruoli,
      name: `Utente ${userId}`,
    } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId: SEDE,
    sediIds: [SEDE],
  } as TrpcContext;
}

const utenti = getUtentiStore();
let lunghezzaIniziale = 0;

beforeEach(() => {
  lunghezzaIniziale = utenti.length;
  const now = new Date();
  utenti.push(
    { id: DIREZIONE_ID, nome: "Dora", cognome: "Direzione", email: "dora@ws1.test", ruoli: ["direzione"], sediIds: [SEDE], attivo: true, tenantId: 1, createdAt: now, updatedAt: now },
    { id: TARGET_ID, nome: "Tino", cognome: "Target", email: "tino@ws1.test", ruoli: ["commerciale"], sediIds: [SEDE], attivo: true, tenantId: 1, createdAt: now, updatedAt: now }
  );
});

afterEach(() => {
  utenti.splice(lunghezzaIniziale);
});

describe("tenant.manage_proprietari non si concede per override né per delega", () => {
  it("updateOverride risponde FORBIDDEN", async () => {
    const caller = appRouter.createCaller(context(DIREZIONE_ID, ["direzione"]));
    await expect(
      caller.permessi.updateOverride({
        userId: TARGET_ID,
        capability: "tenant.manage_proprietari",
        effect: "allow",
        reason: "provo a concedermela da direzione",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("createDelegation risponde FORBIDDEN", async () => {
    const caller = appRouter.createCaller(context(DIREZIONE_ID, ["direzione"]));
    await expect(
      caller.permessi.createDelegation({
        delegatorUserId: DIREZIONE_ID,
        delegateUserId: TARGET_ID,
        capability: "tenant.manage_proprietari",
        startsAt: new Date("2026-09-07T00:00:00Z"),
        expiresAt: new Date("2026-09-14T00:00:00Z"),
        reason: "delega vietata dalla spec WS1",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `pnpm vitest run server/authz/capabilities.tenant.test.ts server/routers/permessi.tenant.test.ts`
Expected: FAIL (`ALL_CAPABILITIES.has(...)` false; le mutation di `permessi` non rifiutano, o falliscono sullo zod enum).

- [ ] **Step 3: Implementa capability e ruolo**

In `server/authz/capabilities.ts`, nell'elenco `CAPABILITIES`, prima di `"tars.use"`:

```ts
  // Tenant (WS1, 06/09/2026): nominare e revocare i proprietari dell'azienda.
  // La dà SOLO il ruolo `proprietario`: né la direzione per costruzione, né
  // override, né delega (spec WS1 §4.4).
  "tenant.manage_proprietari",
```

In `ROLE_CAPABILITIES`, dopo il blocco `ordini`:

```ts
  proprietario: [...SHARED_CAPABILITIES, "tenant.manage_proprietari"],
```

Sostituisci `capabilitiesForRoles` con:

```ts
export function capabilitiesForRoles(roles: readonly string[]): Set<Capability> {
  const capabilities = new Set<Capability>();
  if (roles.includes("direzione")) {
    for (const capability of CAPABILITIES) capabilities.add(capability);
    // L'unica eccezione al «direzione = tutto»: la nomina dei proprietari
    // spetta ai proprietari (spec WS1 §4.4). Chi è anche proprietario la
    // riprende dal proprio ruolo, qui sotto.
    capabilities.delete("tenant.manage_proprietari");
  }
  for (const role of roles) {
    for (const capability of ROLE_CAPABILITIES[role] ?? []) {
      capabilities.add(capability);
    }
  }
  return capabilities;
}
```

In `server/routers/permessi.ts`, subito dopo `const { sedeId, actorUserId } = directionContext(ctx);` in `updateOverride` (riga ~168) e in `createDelegation` (riga ~243):

```ts
      if (input.capability === "tenant.manage_proprietari") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "La nomina dei proprietari non si delega né si sovrascrive: spetta ai proprietari dell'azienda.",
        });
      }
```

- [ ] **Step 4: Esegui i test**

Run: `pnpm vitest run server/authz server/routers/permessi.test.ts server/routers/permessi.tenant.test.ts`
Expected: PASS (anche `capabilities.*.test.ts` esistenti: la direzione conserva ogni altra capability).

- [ ] **Step 5: Commit**

```bash
git add server/authz/capabilities.ts server/authz/capabilities.tenant.test.ts server/routers/permessi.ts server/routers/permessi.tenant.test.ts
git commit -m "feat(tenant): ruolo proprietario e capability tenant.manage_proprietari, mai per direzione, override o delega

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Repository del control plane (Postgres e memoria)

**Files:**
- Create: `server/tenants/repository.ts`
- Test: `server/tenants/repository.test.ts` (memoria), `server/tenants/repository.pg.test.ts` (Postgres vero, `describe.skipIf`)

**Interfaces:**
- Consumes: `kvSql` da `server/_core/persistence.ts`; costanti e tipi del Task 2.
- Produces:

```ts
export type EsitoComando = Record<string, unknown>;
export type TenantRepository = {
  ensureSchema(): Promise<void>;
  caricaCache(): Promise<void>;
  tutti(): TenantRecord[];
  perId(id: number): TenantRecord | null;
  perSlug(slug: string): TenantRecord | null;
  inserisci(input: { slug: string; nome: string; stato?: StatoTenant; id?: number }): Promise<TenantRecord>;
  aggiornaStato(id: number, stato: StatoTenant, motivo: string | null): Promise<TenantRecord>;
  registraEvento(evento: { tenantId: number; tipo: TipoEvento; attore: string; motivo?: string | null; dettagli?: Record<string, unknown> | null }): Promise<TenantEvento>;
  eventi(tenantId: number): Promise<TenantEvento[]>;
  accodaComando(input: { tipo: TipoComando; tenantId: number | null; payload: Record<string, unknown>; richiestoDa: string }): Promise<TenantComando>;
  comandiInAttesa(): Promise<TenantComando[]>;
  comando(id: number): Promise<TenantComando | null>;
  prendiEdEsegui(esegui: (comando: TenantComando) => Promise<EsitoComando>): Promise<"eseguito" | "errore" | "nessuno">;
  assicuraTenantPredefinito(): Promise<TenantRecord>;
};
export function getTenantRepository(): TenantRepository;
export function resetTenantRepositoryForTesting(): void;
```

- [ ] **Step 1: Scrivi il test in memoria che fallisce**

```ts
// server/tenants/repository.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { getTenantRepository, resetTenantRepositoryForTesting } from "./repository";

beforeEach(() => {
  resetTenantRepositoryForTesting();
});

describe("repository tenant in memoria", () => {
  it("semina il tenant 1 in modo idempotente e assegna gli id successivi", async () => {
    const repo = getTenantRepository();
    await repo.ensureSchema();
    const t1 = await repo.assicuraTenantPredefinito();
    const ancora = await repo.assicuraTenantPredefinito();
    expect(t1.id).toBe(1);
    expect(ancora.id).toBe(1);
    expect(t1.slug).toBe("ruffino-group");
    expect(t1.stato).toBe("attivo");
    const acme = await repo.inserisci({ slug: "acme", nome: "Acme Infissi" });
    expect(acme.id).toBe(2);
    expect(repo.perSlug("acme")?.id).toBe(2);
    expect(repo.perId(3)).toBeNull();
    expect(repo.tutti().map(t => t.id)).toEqual([1, 2]);
  });

  it("rifiuta slug duplicati", async () => {
    const repo = getTenantRepository();
    await repo.inserisci({ slug: "acme", nome: "Acme" });
    await expect(repo.inserisci({ slug: "acme", nome: "Acme bis" })).rejects.toThrow(/slug/);
  });

  it("aggiorna lo stato e registra eventi in ordine", async () => {
    const repo = getTenantRepository();
    const t = await repo.inserisci({ slug: "acme", nome: "Acme" });
    const sospeso = await repo.aggiornaStato(t.id, "sospeso", "insoluto");
    expect(sospeso.stato).toBe("sospeso");
    expect(repo.perId(t.id)?.motivoStato).toBe("insoluto");
    await repo.registraEvento({ tenantId: t.id, tipo: "creato", attore: "boot" });
    await repo.registraEvento({ tenantId: t.id, tipo: "sospeso", attore: "script:tenant@qui", motivo: "insoluto" });
    const eventi = await repo.eventi(t.id);
    expect(eventi.map(e => e.tipo)).toEqual(["creato", "sospeso"]);
    expect(eventi[1].motivo).toBe("insoluto");
  });

  it("i comandi passano da in_attesa a eseguito o errore, uno alla volta", async () => {
    const repo = getTenantRepository();
    const a = await repo.accodaComando({ tipo: "sospendi", tenantId: 1, payload: { slug: "ruffino-group", motivo: "prova" }, richiestoDa: "script:tenant@qui" });
    const b = await repo.accodaComando({ tipo: "riattiva", tenantId: 1, payload: { slug: "ruffino-group", motivo: "prova" }, richiestoDa: "script:tenant@qui" });
    expect((await repo.comandiInAttesa()).map(c => c.id)).toEqual([a.id, b.id]);

    const primo = await repo.prendiEdEsegui(async c => ({ visto: c.id }));
    expect(primo).toBe("eseguito");
    expect((await repo.comando(a.id))?.esito).toEqual({ visto: a.id });

    const secondo = await repo.prendiEdEsegui(async () => {
      throw new Error("payload rotto");
    });
    expect(secondo).toBe("errore");
    expect((await repo.comando(b.id))?.esito).toEqual({ errore: "payload rotto" });
    expect((await repo.comando(b.id))?.eseguitoAt).toBeInstanceOf(Date);

    expect(await repo.prendiEdEsegui(async () => ({}))).toBe("nessuno");
    expect(await repo.comandiInAttesa()).toEqual([]);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `pnpm vitest run server/tenants/repository.test.ts`
Expected: FAIL, modulo inesistente.

- [ ] **Step 3: Scrivi il repository**

```ts
// server/tenants/repository.ts
// Control plane del tenant: tabelle relazionali con `ensureSchema()` a mano
// (come authz/repository.ts), variante Postgres e in memoria. QUESTO è
// l'unico file che scrive `tenants`, `tenant_eventi`, `tenant_comandi`
// (guardia strutturale in confine.test.ts). La cache dei tenant vive qui:
// una replica sola, aggiornata da ogni scrittura.
import { kvSql } from "../_core/persistence";
import {
  TENANT_PREDEFINITO_ID,
  TENANT_PREDEFINITO_NOME,
  TENANT_PREDEFINITO_SLUG,
} from "./costanti";
import type {
  StatoTenant,
  TenantComando,
  TenantEvento,
  TenantRecord,
  TipoComando,
  TipoEvento,
} from "./tipi";

export type EsitoComando = Record<string, unknown>;

export type TenantRepository = {
  ensureSchema(): Promise<void>;
  caricaCache(): Promise<void>;
  tutti(): TenantRecord[];
  perId(id: number): TenantRecord | null;
  perSlug(slug: string): TenantRecord | null;
  inserisci(input: { slug: string; nome: string; stato?: StatoTenant; id?: number }): Promise<TenantRecord>;
  aggiornaStato(id: number, stato: StatoTenant, motivo: string | null): Promise<TenantRecord>;
  registraEvento(evento: {
    tenantId: number;
    tipo: TipoEvento;
    attore: string;
    motivo?: string | null;
    dettagli?: Record<string, unknown> | null;
  }): Promise<TenantEvento>;
  eventi(tenantId: number): Promise<TenantEvento[]>;
  accodaComando(input: {
    tipo: TipoComando;
    tenantId: number | null;
    payload: Record<string, unknown>;
    richiestoDa: string;
  }): Promise<TenantComando>;
  comandiInAttesa(): Promise<TenantComando[]>;
  comando(id: number): Promise<TenantComando | null>;
  prendiEdEsegui(
    esegui: (comando: TenantComando) => Promise<EsitoComando>
  ): Promise<"eseguito" | "errore" | "nessuno">;
  assicuraTenantPredefinito(): Promise<TenantRecord>;
};

const clone = <T>(v: T): T => structuredClone(v);

function messaggioErrore(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ── Memoria (sviluppo e test senza DATABASE_URL) ────────────────────────────

function createMemoryTenantRepository(): TenantRepository {
  const tenants: TenantRecord[] = [];
  const eventi: TenantEvento[] = [];
  const comandi: TenantComando[] = [];
  let prossimoTenant = 1;
  let prossimoEvento = 1;
  let prossimoComando = 1;

  const repo: TenantRepository = {
    async ensureSchema() {},
    async caricaCache() {},
    tutti: () => tenants.map(clone),
    perId: id => clone(tenants.find(t => t.id === id) ?? null),
    perSlug: slug => clone(tenants.find(t => t.slug === slug) ?? null),
    async inserisci(input) {
      if (tenants.some(t => t.slug === input.slug)) {
        throw new Error(`slug già usato: ${input.slug}`);
      }
      const id = input.id ?? prossimoTenant;
      if (tenants.some(t => t.id === id)) throw new Error(`id già usato: ${id}`);
      prossimoTenant = Math.max(prossimoTenant, id + 1);
      const now = new Date();
      const t: TenantRecord = {
        id,
        slug: input.slug,
        nome: input.nome,
        stato: input.stato ?? "attivo",
        motivoStato: null,
        createdAt: now,
        updatedAt: now,
      };
      tenants.push(t);
      return clone(t);
    },
    async aggiornaStato(id, stato, motivo) {
      const t = tenants.find(x => x.id === id);
      if (!t) throw new Error(`tenant ${id} inesistente`);
      t.stato = stato;
      t.motivoStato = motivo;
      t.updatedAt = new Date();
      return clone(t);
    },
    async registraEvento(e) {
      const ev: TenantEvento = {
        id: prossimoEvento++,
        tenantId: e.tenantId,
        tipo: e.tipo,
        attore: e.attore,
        motivo: e.motivo ?? null,
        dettagli: e.dettagli ? clone(e.dettagli) : null,
        createdAt: new Date(),
      };
      eventi.push(ev);
      return clone(ev);
    },
    async eventi(tenantId) {
      return eventi.filter(e => e.tenantId === tenantId).map(clone);
    },
    async accodaComando(input) {
      const c: TenantComando = {
        id: prossimoComando++,
        tipo: input.tipo,
        tenantId: input.tenantId,
        payload: clone(input.payload),
        stato: "in_attesa",
        esito: null,
        richiestoDa: input.richiestoDa,
        createdAt: new Date(),
        eseguitoAt: null,
      };
      comandi.push(c);
      return clone(c);
    },
    async comandiInAttesa() {
      return comandi.filter(c => c.stato === "in_attesa").map(clone);
    },
    async comando(id) {
      return clone(comandi.find(c => c.id === id) ?? null);
    },
    async prendiEdEsegui(esegui) {
      const c = comandi.find(x => x.stato === "in_attesa");
      if (!c) return "nessuno";
      try {
        c.esito = await esegui(clone(c));
        c.stato = "eseguito";
      } catch (e) {
        c.esito = { errore: messaggioErrore(e) };
        c.stato = "errore";
      }
      c.eseguitoAt = new Date();
      return c.stato;
    },
    async assicuraTenantPredefinito() {
      const esistente = tenants.find(t => t.id === TENANT_PREDEFINITO_ID);
      if (esistente) return clone(esistente);
      return repo.inserisci({
        id: TENANT_PREDEFINITO_ID,
        slug: TENANT_PREDEFINITO_SLUG,
        nome: TENANT_PREDEFINITO_NOME,
      });
    },
  };
  return repo;
}

// ── Postgres ────────────────────────────────────────────────────────────────

function createPostgresTenantRepository(
  sql: NonNullable<typeof kvSql>
): TenantRepository {
  const cache = new Map<number, TenantRecord>();
  let schemaPromise: Promise<void> | null = null;

  const rigaTenant = (r: any): TenantRecord => ({
    id: Number(r.id),
    slug: r.slug,
    nome: r.nome,
    stato: r.stato,
    motivoStato: r.motivo_stato ?? null,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  });
  const rigaEvento = (r: any): TenantEvento => ({
    id: Number(r.id),
    tenantId: Number(r.tenant_id),
    tipo: r.tipo,
    attore: r.attore,
    motivo: r.motivo ?? null,
    dettagli: r.dettagli ?? null,
    createdAt: new Date(r.created_at),
  });
  const rigaComando = (r: any): TenantComando => ({
    id: Number(r.id),
    tipo: r.tipo,
    tenantId: r.tenant_id == null ? null : Number(r.tenant_id),
    payload: r.payload ?? {},
    stato: r.stato,
    esito: r.esito ?? null,
    richiestoDa: r.richiesto_da,
    createdAt: new Date(r.created_at),
    eseguitoAt: r.eseguito_at ? new Date(r.eseguito_at) : null,
  });
  const memorizza = (t: TenantRecord): TenantRecord => {
    cache.set(t.id, t);
    return clone(t);
  };
  const allineaSequenza = () =>
    sql`SELECT setval(pg_get_serial_sequence('tenants', 'id'), GREATEST((SELECT MAX(id) FROM tenants), 1))`;

  const ensureSchema = (): Promise<void> => {
    schemaPromise ??= sql
      .begin(async tx => {
        await tx`CREATE TABLE IF NOT EXISTS tenants (
          id BIGSERIAL PRIMARY KEY,
          slug TEXT NOT NULL UNIQUE,
          nome TEXT NOT NULL,
          stato TEXT NOT NULL CHECK (stato IN ('attivo','sospeso')),
          motivo_stato TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
        await tx`CREATE TABLE IF NOT EXISTS tenant_eventi (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL REFERENCES tenants(id),
          tipo TEXT NOT NULL,
          attore TEXT NOT NULL,
          motivo TEXT,
          dettagli JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
        await tx`CREATE INDEX IF NOT EXISTS tenant_eventi_tenant_idx
          ON tenant_eventi (tenant_id, created_at DESC)`;
        // Append-only garantito dal database (spec WS1 §4.1): il primo caso nel repo.
        await tx`CREATE OR REPLACE FUNCTION tenant_eventi_solo_insert() RETURNS trigger AS $$
          BEGIN RAISE EXCEPTION 'tenant_eventi è append-only: UPDATE e DELETE non sono ammessi'; END;
          $$ LANGUAGE plpgsql`;
        await tx`DROP TRIGGER IF EXISTS tenant_eventi_solo_insert ON tenant_eventi`;
        await tx`CREATE TRIGGER tenant_eventi_solo_insert
          BEFORE UPDATE OR DELETE ON tenant_eventi
          FOR EACH ROW EXECUTE FUNCTION tenant_eventi_solo_insert()`;
        await tx`CREATE TABLE IF NOT EXISTS tenant_comandi (
          id BIGSERIAL PRIMARY KEY,
          tipo TEXT NOT NULL CHECK (tipo IN ('crea','sospendi','riattiva','assegna_proprietario','revoca_proprietario')),
          tenant_id BIGINT,
          payload JSONB NOT NULL,
          stato TEXT NOT NULL DEFAULT 'in_attesa' CHECK (stato IN ('in_attesa','eseguito','errore')),
          esito JSONB,
          richiesto_da TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          eseguito_at TIMESTAMPTZ
        )`;
        await tx`CREATE INDEX IF NOT EXISTS tenant_comandi_attesa_idx
          ON tenant_comandi (stato, id) WHERE stato = 'in_attesa'`;
      })
      .then(() => undefined)
      .catch(e => {
        schemaPromise = null;
        throw e;
      });
    return schemaPromise;
  };

  const repo: TenantRepository = {
    ensureSchema,
    async caricaCache() {
      await ensureSchema();
      const rows = await sql`SELECT * FROM tenants ORDER BY id`;
      cache.clear();
      for (const r of rows) cache.set(Number(r.id), rigaTenant(r));
    },
    tutti: () => [...cache.values()].sort((a, b) => a.id - b.id).map(clone),
    perId: id => {
      const t = cache.get(id);
      return t ? clone(t) : null;
    },
    perSlug: slug => {
      for (const t of cache.values()) if (t.slug === slug) return clone(t);
      return null;
    },
    async inserisci(input) {
      await ensureSchema();
      if (repo.perSlug(input.slug)) throw new Error(`slug già usato: ${input.slug}`);
      const stato = input.stato ?? "attivo";
      const rows =
        input.id != null
          ? await sql`INSERT INTO tenants (id, slug, nome, stato) VALUES (${input.id}, ${input.slug}, ${input.nome}, ${stato}) RETURNING *`
          : await sql`INSERT INTO tenants (slug, nome, stato) VALUES (${input.slug}, ${input.nome}, ${stato}) RETURNING *`;
      if (input.id != null) await allineaSequenza();
      return memorizza(rigaTenant(rows[0]));
    },
    async aggiornaStato(id, stato, motivo) {
      await ensureSchema();
      const rows = await sql`UPDATE tenants SET stato = ${stato}, motivo_stato = ${motivo}, updated_at = NOW()
        WHERE id = ${id} RETURNING *`;
      if (!rows.length) throw new Error(`tenant ${id} inesistente`);
      return memorizza(rigaTenant(rows[0]));
    },
    async registraEvento(e) {
      await ensureSchema();
      const dettagli = e.dettagli ? sql.json(e.dettagli as any) : null;
      const rows = await sql`INSERT INTO tenant_eventi (tenant_id, tipo, attore, motivo, dettagli)
        VALUES (${e.tenantId}, ${e.tipo}, ${e.attore}, ${e.motivo ?? null}, ${dettagli}) RETURNING *`;
      return rigaEvento(rows[0]);
    },
    async eventi(tenantId) {
      await ensureSchema();
      const rows = await sql`SELECT * FROM tenant_eventi WHERE tenant_id = ${tenantId} ORDER BY id`;
      return rows.map(rigaEvento);
    },
    async accodaComando(input) {
      await ensureSchema();
      const rows = await sql`INSERT INTO tenant_comandi (tipo, tenant_id, payload, richiesto_da)
        VALUES (${input.tipo}, ${input.tenantId}, ${sql.json(input.payload as any)}, ${input.richiestoDa}) RETURNING *`;
      return rigaComando(rows[0]);
    },
    async comandiInAttesa() {
      await ensureSchema();
      const rows = await sql`SELECT * FROM tenant_comandi WHERE stato = 'in_attesa' ORDER BY id`;
      return rows.map(rigaComando);
    },
    async comando(id) {
      await ensureSchema();
      const rows = await sql`SELECT * FROM tenant_comandi WHERE id = ${id}`;
      return rows.length ? rigaComando(rows[0]) : null;
    },
    async prendiEdEsegui(esegui) {
      await ensureSchema();
      return sql.begin(async tx => {
        const rows = await tx`SELECT * FROM tenant_comandi WHERE stato = 'in_attesa'
          ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`;
        if (!rows.length) return "nessuno" as const;
        const comando = rigaComando(rows[0]);
        let stato: "eseguito" | "errore";
        let esito: EsitoComando;
        try {
          esito = await esegui(comando);
          stato = "eseguito";
        } catch (e) {
          esito = { errore: messaggioErrore(e) };
          stato = "errore";
        }
        await tx`UPDATE tenant_comandi SET stato = ${stato}, esito = ${tx.json(esito as any)}, eseguito_at = NOW()
          WHERE id = ${comando.id}`;
        return stato;
      });
    },
    async assicuraTenantPredefinito() {
      await ensureSchema();
      await sql`INSERT INTO tenants (id, slug, nome, stato)
        VALUES (${TENANT_PREDEFINITO_ID}, ${TENANT_PREDEFINITO_SLUG}, ${TENANT_PREDEFINITO_NOME}, 'attivo')
        ON CONFLICT (id) DO NOTHING`;
      await allineaSequenza();
      const rows = await sql`SELECT * FROM tenants WHERE id = ${TENANT_PREDEFINITO_ID}`;
      return memorizza(rigaTenant(rows[0]));
    },
  };
  return repo;
}

// ── Singleton ───────────────────────────────────────────────────────────────

let repository: TenantRepository | null = null;

export function getTenantRepository(): TenantRepository {
  repository ??= kvSql
    ? createPostgresTenantRepository(kvSql)
    : createMemoryTenantRepository();
  return repository;
}

export function resetTenantRepositoryForTesting(): void {
  if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY_TENANT_REPOSITORY_RESET");
  repository = null;
}
```

- [ ] **Step 4: Esegui il test in memoria**

Run: `pnpm vitest run server/tenants/repository.test.ts`
Expected: PASS.

- [ ] **Step 5: Scrivi il test su Postgres vero**

```ts
// server/tenants/repository.pg.test.ts
// Su PostgreSQL vero, come server/_core/jsonbSnapshot.pg.test.ts:
//   docker run -d --name perf-pg-test -e POSTGRES_PASSWORD=test \
//     -e POSTGRES_DB=perf_test -p 55433:5432 postgres:16-alpine
//   DATABASE_URL=postgres://postgres:test@localhost:55433/perf_test \
//     pnpm vitest run server/tenants/repository.pg.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kvSql } from "../_core/persistence";
import { getTenantRepository, resetTenantRepositoryForTesting } from "./repository";

const conDatabase = Boolean(process.env.DATABASE_URL && kvSql);

describe.skipIf(!conDatabase)("repository tenant su Postgres", () => {
  const sql = kvSql!;

  beforeAll(async () => {
    await sql`DROP TABLE IF EXISTS tenant_comandi, tenant_eventi, tenants CASCADE`;
    resetTenantRepositoryForTesting();
  });

  afterAll(async () => {
    await sql`DROP TABLE IF EXISTS tenant_comandi, tenant_eventi, tenants CASCADE`;
  });

  it("lo schema è idempotente e il seed del tenant 1 pure", async () => {
    const repo = getTenantRepository();
    await repo.ensureSchema();
    resetTenantRepositoryForTesting();
    const repo2 = getTenantRepository();
    await repo2.ensureSchema();
    const t1 = await repo2.assicuraTenantPredefinito();
    const bis = await repo2.assicuraTenantPredefinito();
    expect(t1.id).toBe(1);
    expect(bis.id).toBe(1);
    const righe = await sql`SELECT COUNT(*)::int AS n FROM tenants`;
    expect(righe[0].n).toBe(1);
    const acme = await repo2.inserisci({ slug: "acme", nome: "Acme" });
    expect(acme.id).toBeGreaterThanOrEqual(2);
    await repo2.caricaCache();
    expect(repo2.perSlug("acme")?.id).toBe(acme.id);
  });

  it("tenant_eventi rifiuta UPDATE e DELETE", async () => {
    const repo = getTenantRepository();
    const ev = await repo.registraEvento({ tenantId: 1, tipo: "creato", attore: "boot" });
    await expect(sql`UPDATE tenant_eventi SET motivo = 'x' WHERE id = ${ev.id}`).rejects.toThrow(/append-only/);
    await expect(sql`DELETE FROM tenant_eventi WHERE id = ${ev.id}`).rejects.toThrow(/append-only/);
    expect((await repo.eventi(1)).length).toBe(1);
  });

  it("i comandi si prendono uno alla volta con FOR UPDATE SKIP LOCKED", async () => {
    const repo = getTenantRepository();
    const c = await repo.accodaComando({ tipo: "sospendi", tenantId: 1, payload: { slug: "ruffino-group", motivo: "prova" }, richiestoDa: "script:tenant@test" });
    expect(await repo.prendiEdEsegui(async x => ({ id: x.id }))).toBe("eseguito");
    expect((await repo.comando(c.id))?.stato).toBe("eseguito");
    expect(await repo.prendiEdEsegui(async () => ({}))).toBe("nessuno");
  });
});
```

- [ ] **Step 6: Esegui il test pg (salta senza database, gira col container)**

Run: `pnpm vitest run server/tenants/repository.pg.test.ts`
Expected: SKIP senza `DATABASE_URL`; PASS con il container di `jsonbSnapshot.pg.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add server/tenants/repository.ts server/tenants/repository.test.ts server/tenants/repository.pg.test.ts
git commit -m "feat(tenant): repository del control plane — tenants, tenant_eventi append-only, tenant_comandi; Postgres e memoria

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `tenantId` su utenti e sedi, funzioni interne, `sediAmmesse`

**Files:**
- Modify: `server/routers/sedi.ts:18-64` (tipo, seed, backfill, helper), `:111-133` (`create`)
- Modify: `server/routers/utenti.ts:77-118` (store, backfill, export), `:190-229` (`create`)
- Create: `server/tenants/contesto.ts`
- Test: `server/tenants/contesto.test.ts`

**Interfaces:**
- Produces (sedi.ts): campo `tenantId: number` su `Sede`; `getSediPersistedStore()`; `sediDelTenant(tenantId): Sede[]`; `sediAttiveDelTenant(tenantId): Sede[]`; `sedePredefinita(tenantId): number | null`; `creaSedeInterna({ tenantId, nome, citta?, indirizzo? }): Sede` (spinge nell'array, NON salva).
- Produces (utenti.ts): campo `tenantId` sugli utenti; `getUtentiPersistedStore()`; `creaUtenteInterno(input: NuovoUtenteInterno)` con `NuovoUtenteInterno = { tenantId; nome; cognome; email; telefono?; ruoli: string[]; sediIds: number[]; passwordHash: string; attivo? }` (spinge, NON salva, lancia `Error("Email già in uso")`).
- Produces (tenants/contesto.ts): `risolviTenantPerUtente(user): { utente; tenantId; tenant } | null`; `sediAmmesse(user, tenantId): number[]`; `tenantIdDellaSede(sedeId): number`.

- [ ] **Step 1: Scrivi il test che fallisce**

```ts
// server/tenants/contesto.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getSediStore } from "../routers/sedi";
import { getUtentiStore } from "../routers/utenti";
import { getTenantRepository, resetTenantRepositoryForTesting } from "./repository";
import { risolviTenantPerUtente, sediAmmesse, tenantIdDellaSede } from "./contesto";

const SEDE_T2 = 97201;
const SEDE_T2_SPENTA = 97202;
const SEDE_T1 = 97203;
const DIREZIONE_T2 = 97211;
const COMMERCIALE_T2 = 97212;
const SPENTO_T2 = 97213;
const SENZA_SEDI_T2 = 97214;

const sedi = getSediStore();
const utenti = getUtentiStore();
let nSedi = 0;
let nUtenti = 0;

beforeEach(async () => {
  resetTenantRepositoryForTesting();
  const repo = getTenantRepository();
  await repo.assicuraTenantPredefinito();
  await repo.inserisci({ slug: "acme", nome: "Acme" }); // id 2
  nSedi = sedi.length;
  nUtenti = utenti.length;
  const now = new Date();
  sedi.push(
    { id: SEDE_T2, tenantId: 2, nome: "Acme Sede", citta: null, indirizzo: null, attiva: true, createdAt: now, updatedAt: now },
    { id: SEDE_T2_SPENTA, tenantId: 2, nome: "Acme Vecchia", citta: null, indirizzo: null, attiva: false, createdAt: now, updatedAt: now },
    { id: SEDE_T1, tenantId: 1, nome: "Ruffino Bis", citta: null, indirizzo: null, attiva: true, createdAt: now, updatedAt: now }
  );
  const base = { nome: "N", cognome: "C", attivo: true, createdAt: now, updatedAt: now };
  utenti.push(
    { ...base, id: DIREZIONE_T2, email: "d@acme.test", ruoli: ["direzione"], sediIds: [SEDE_T2], tenantId: 2 },
    { ...base, id: COMMERCIALE_T2, email: "c@acme.test", ruoli: ["commerciale"], sediIds: [SEDE_T2, SEDE_T1], tenantId: 2 },
    { ...base, id: SPENTO_T2, email: "s@acme.test", ruoli: ["commerciale"], sediIds: [SEDE_T2], tenantId: 2, attivo: false },
    { ...base, id: SENZA_SEDI_T2, email: "z@acme.test", ruoli: ["ordini"], sediIds: [SEDE_T1], tenantId: 2 }
  );
});

afterEach(() => {
  sedi.splice(nSedi);
  utenti.splice(nUtenti);
});

describe("sediAmmesse", () => {
  it("direzione e proprietario vedono tutte le sedi attive del tenant", () => {
    expect(sediAmmesse({ id: DIREZIONE_T2 }, 2)).toEqual([SEDE_T2]);
  });
  it("gli altri vedono solo le proprie sedi, mai quelle di un altro tenant", () => {
    expect(sediAmmesse({ id: COMMERCIALE_T2 }, 2)).toEqual([SEDE_T2]);
  });
  it("senza sedi valide ricade sulla prima sede attiva del tenant", () => {
    expect(sediAmmesse({ id: SENZA_SEDI_T2 }, 2)).toEqual([SEDE_T2]);
  });
});

describe("risolviTenantPerUtente", () => {
  const locale = (id: number) => ({ id, loginMethod: "local" });
  it("restituisce tenant e record per un utente locale attivo", () => {
    const r = risolviTenantPerUtente(locale(COMMERCIALE_T2));
    expect(r?.tenantId).toBe(2);
    expect(r?.tenant.slug).toBe("acme");
    expect(r?.utente.id).toBe(COMMERCIALE_T2);
  });
  it("rifiuta utente disattivato, inesistente, non locale, o con tenant sconosciuto", () => {
    expect(risolviTenantPerUtente(locale(SPENTO_T2))).toBeNull();
    expect(risolviTenantPerUtente(locale(999_999))).toBeNull();
    expect(risolviTenantPerUtente({ id: COMMERCIALE_T2, loginMethod: "oauth" })).toBeNull();
    utenti.push({ id: 97299, nome: "X", cognome: "Y", email: "x@y.test", ruoli: ["ordini"], sediIds: [], attivo: true, tenantId: 42, createdAt: new Date(), updatedAt: new Date() });
    expect(risolviTenantPerUtente(locale(97299))).toBeNull();
  });
});

describe("tenantIdDellaSede", () => {
  it("legge il tenant dalla sede e ricade su 1", () => {
    expect(tenantIdDellaSede(SEDE_T2)).toBe(2);
    expect(tenantIdDellaSede(999_999)).toBe(1);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `pnpm vitest run server/tenants/contesto.test.ts`
Expected: FAIL, modulo `./contesto` inesistente (e `Sede` senza `tenantId` a `pnpm check`).

- [ ] **Step 3: Modifica `sedi.ts`**

Aggiungi l'import `import { TENANT_PREDEFINITO_ID } from "../tenants/costanti";`. Nel tipo `Sede` aggiungi `tenantId: number;` dopo `id`. Sostituisci lo store con:

```ts
const _store = persistedStore<Sede>("sedi", (items, { firstBoot }) => {
  if (firstBoot && items.length === 0) {
    const now = new Date();
    items.push({
      id: DEFAULT_SEDE_ID,
      tenantId: TENANT_PREDEFINITO_ID,
      nome: "La Spezia",
      citta: "La Spezia",
      indirizzo: null,
      attiva: true,
      createdAt: now,
      updatedAt: now,
    });
    setTimeout(() => _store.save(), 0);
  }
  // Backfill WS1: ogni sede legacy appartiene a Ruffino Group (tenant 1).
  let migrate = false;
  for (const s of items) {
    if (typeof (s as any).tenantId !== "number") {
      (s as any).tenantId = TENANT_PREDEFINITO_ID;
      migrate = true;
    }
  }
  if (migrate) setTimeout(() => _store.save(), 0);
  nextId = items.length ? Math.max(...items.map((x) => x.id)) + 1 : 2;
});
const sedi = _store.items;

export function getSediPersistedStore() {
  return _store;
}

export function sediDelTenant(tenantId: number): Sede[] {
  return sedi.filter((s) => s.tenantId === tenantId).sort((a, b) => a.id - b.id);
}

export function sediAttiveDelTenant(tenantId: number): Sede[] {
  return sediDelTenant(tenantId).filter((s) => s.attiva);
}

/** Prima sede attiva del tenant, per id crescente; null se non ne ha. */
export function sedePredefinita(tenantId: number): number | null {
  return sediAttiveDelTenant(tenantId)[0]?.id ?? null;
}

/** Spinge la sede nell'array e la restituisce. Chi chiama salva (o committa la transazione). */
export function creaSedeInterna(input: {
  tenantId: number;
  nome: string;
  citta?: string | null;
  indirizzo?: string | null;
}): Sede {
  const now = new Date();
  const sede: Sede = {
    id: nextId++,
    tenantId: input.tenantId,
    nome: input.nome,
    citta: input.citta ?? null,
    indirizzo: input.indirizzo ?? null,
    attiva: true,
    createdAt: now,
    updatedAt: now,
  };
  sedi.push(sede);
  return sede;
}
```

Nel router, `create` diventa:

```ts
  create: adminProcedure
    .input(
      z.object({
        nome: z.string().min(1),
        citta: z.string().optional(),
        indirizzo: z.string().optional(),
      })
    )
    .mutation(({ input }) => {
      const sede = creaSedeInterna({ tenantId: TENANT_PREDEFINITO_ID, ...input });
      _store.save();
      return sede;
    }),
```
(il Task 8 sostituirà `TENANT_PREDEFINITO_ID` con `ctx.tenantId`).

- [ ] **Step 4: Modifica `utenti.ts`**

Aggiungi l'import `import { TENANT_PREDEFINITO_ID } from "../tenants/costanti";`. Nel seed del bootstrap admin (`items.push({ ...bootstrapAdmin(), sediIds: [1], … })`) aggiungi `tenantId: TENANT_PREDEFINITO_ID,`. Nel ciclo `for (const u of items)` di `onLoad`, dopo il backfill di `sediIds`:

```ts
    // Backfill WS1: ogni utente legacy appartiene a Ruffino Group (tenant 1).
    if (typeof (u as any).tenantId !== "number") {
      (u as any).tenantId = TENANT_PREDEFINITO_ID;
      migrated = true;
    }
```

Dopo `getUtentiStore()` aggiungi:

```ts
export function getUtentiPersistedStore() {
  return _store;
}

export type NuovoUtenteInterno = {
  tenantId: number;
  nome: string;
  cognome: string;
  email: string;
  telefono?: string | null;
  ruoli: string[];
  sediIds: number[];
  passwordHash: string;
  attivo?: boolean;
};

/**
 * Crea l'utente nell'array e lo restituisce (con la password hashata dentro).
 * Chi chiama salva o committa. L'email è unica su tutta l'installazione: il
 * login è per sola email e non distingue i tenant.
 */
export function creaUtenteInterno(input: NuovoUtenteInterno) {
  if (utenti.some(u => u.email.toLowerCase() === input.email.toLowerCase())) {
    throw new Error("Email già in uso");
  }
  const now = new Date();
  const utente = {
    id: nextId++,
    tenantId: input.tenantId,
    nome: input.nome,
    cognome: input.cognome,
    email: input.email,
    telefono: input.telefono ?? null,
    ruoli: input.ruoli,
    sediIds: input.sediIds,
    attivo: input.attivo ?? true,
    password: input.passwordHash,
    createdAt: now,
    updatedAt: now,
  };
  utenti.push(utente);
  return utente;
}
```

E `create` del router usa la funzione interna (stessi input di oggi):

```ts
    .mutation(({ input }) => {
      const utente = creaUtenteInterno({
        tenantId: TENANT_PREDEFINITO_ID,
        nome: input.nome,
        cognome: input.cognome,
        email: input.email,
        telefono: input.telefono ?? null,
        ruoli: input.ruoli,
        sediIds: input.sediIds && input.sediIds.length > 0 ? input.sediIds : [1],
        passwordHash: hashPassword(input.password),
        attivo: input.attivo,
      });
      _store.save();
      return publicUtente(utente);
    }),
```
(`publicUtente` restituisce già `hasPassword`; il Task 8 riscrive questo handler con tenant e guardie.)

- [ ] **Step 5: Scrivi `server/tenants/contesto.ts`**

```ts
// server/tenants/contesto.ts
// Risoluzione del tenant per la richiesta: chi è l'utente (dallo store, non
// dal JWT), a quale azienda appartiene, quali sedi può vedere.
import { getSedeById, sediAttiveDelTenant, sedePredefinita } from "../routers/sedi";
import { getUtentiStore } from "../routers/utenti";
import { RUOLO_PROPRIETARIO, TENANT_PREDEFINITO_ID } from "./costanti";
import { ruoliDi } from "./regole";
import { getTenantRepository } from "./repository";
import type { TenantRecord } from "./tipi";

export type TenantRisolto = { utente: any; tenantId: number; tenant: TenantRecord };

/**
 * Solo utenti locali (`loginMethod: "local"`): un utente del percorso OAuth
 * legacy non viene cercato nello store (i suoi id vengono da un'altra tabella
 * e potrebbero collidere) e, con interruttore acceso, non ha tenant.
 * `null` = sessione da rifiutare: utente assente, disattivato, o tenant sconosciuto.
 */
export function risolviTenantPerUtente(
  user: { id?: number | null; loginMethod?: string | null } | null | undefined
): TenantRisolto | null {
  if (!user || user.id == null || user.loginMethod !== "local") return null;
  const utente = getUtentiStore().find((u: any) => u.id === user.id);
  if (!utente || utente.attivo === false) return null;
  const tenantId =
    typeof utente.tenantId === "number" ? utente.tenantId : TENANT_PREDEFINITO_ID;
  const tenant = getTenantRepository().perId(tenantId);
  if (!tenant) return null;
  return { utente, tenantId, tenant };
}

/**
 * Le sedi che l'utente può vedere nel tenant: direzione e proprietario tutte
 * quelle attive; gli altri le assegnate che appartengono al tenant; se nessuna,
 * la prima sede attiva del tenant. Mai una sede di un altro tenant.
 */
export function sediAmmesse(
  user: { id?: number | null; ruoli?: unknown; ruolo?: unknown; sediIds?: unknown } | null | undefined,
  tenantId: number
): number[] {
  const record = getUtentiStore().find((u: any) => u.id === user?.id) ?? user;
  const ruoli = ruoliDi(record);
  const delTenant = sediAttiveDelTenant(tenantId).map(s => s.id);
  if (ruoli.includes("direzione") || ruoli.includes(RUOLO_PROPRIETARIO)) return delTenant;
  const assegnate: number[] = Array.isArray((record as any)?.sediIds) ? (record as any).sediIds : [];
  const valide = assegnate.filter(id => delTenant.includes(id));
  if (valide.length) return valide;
  const ripiego = sedePredefinita(tenantId);
  return ripiego == null ? [] : [ripiego];
}

/** Per i worker che girano per sede: il tenant della sede, 1 se la sede non c'è. */
export function tenantIdDellaSede(sedeId: number): number {
  return getSedeById(sedeId)?.tenantId ?? TENANT_PREDEFINITO_ID;
}
```

- [ ] **Step 6: Esegui i test e il type-check**

Run: `pnpm vitest run server/tenants/contesto.test.ts server/routers/sedi.integrazioni.test.ts server/routers/permessi.test.ts && pnpm check`
Expected: PASS; `pnpm check` verde (i test che costruiscono `Sede` a mano, se ce ne sono, ricevono `tenantId: 1`: `pnpm check` li elenca).

- [ ] **Step 7: Commit**

```bash
git add server/routers/sedi.ts server/routers/utenti.ts server/tenants/contesto.ts server/tenants/contesto.test.ts
git commit -m "feat(tenant): tenantId su utenti e sedi con backfill a 1, funzioni interne di creazione, sedi ammesse per tenant

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `TrpcContext` con il tenant, `createContext`, codemod dei test, `contestoDiProva`

**Files:**
- Modify: `server/_core/context.ts` (intero file)
- Create: `server/_core/contestoDiProva.ts`
- Modify: gli 83 file `*.test.ts` che costruiscono un `TrpcContext` a mano (codemod, poi `pnpm check`)
- Test: `server/_core/context.tenant.test.ts`

**Interfaces:**
- Consumes: `risolviTenantPerUtente`, `sediAmmesse` (Task 5); `interruttoreAttivo("multiAzienda")` (Task 1); `TenantRecord` (Task 2).
- Produces: `TrpcContext.tenantId: number | null` (null solo se non autenticato; `1` a interruttore spento) e `TrpcContext.tenant: TenantRecord | null` (null se non autenticato o interruttore spento); `contestoDiProva(input): TrpcContext`.

- [ ] **Step 1: Scrivi il test che fallisce**

```ts
// server/_core/context.tenant.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COOKIE_NAME, SEDE_COOKIE } from "@shared/const";
import { createContext } from "./context";
import { createLocalToken, type LocalUser } from "../localAuth";
import { getSediStore } from "../routers/sedi";
import { getUtentiStore } from "../routers/utenti";
import { getTenantRepository, resetTenantRepositoryForTesting } from "../tenants/repository";

const SEDE_T2 = 97301;
const SEDE_T1 = 97302;
const COMMERCIALE_T2 = 97311;
const SPENTO_T2 = 97312;
const SENZA_SEDE_T3 = 97313;

const sedi = getSediStore();
const utenti = getUtentiStore();
let nS = 0;
let nU = 0;

function utenteLocale(id: number, ruoli: string[]): LocalUser {
  return {
    id,
    openId: `local-${id}`,
    name: `Utente ${id}`,
    email: `u${id}@prova.test`,
    loginMethod: "local",
    role: ruoli.includes("direzione") ? "admin" : "user",
    ruolo: ruoli[0],
    ruoli,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
}

async function contestoCon(id: number, ruoli: string[], sedeCookie?: number) {
  const token = await createLocalToken(utenteLocale(id, ruoli));
  const cookie =
    `${COOKIE_NAME}=${token}` + (sedeCookie ? `; ${SEDE_COOKIE}=${sedeCookie}` : "");
  return createContext({
    req: { headers: { cookie }, protocol: "http" } as any,
    res: {} as any,
  });
}

beforeEach(async () => {
  resetTenantRepositoryForTesting();
  const repo = getTenantRepository();
  await repo.assicuraTenantPredefinito();
  await repo.inserisci({ slug: "acme", nome: "Acme" }); // id 2
  await repo.inserisci({ slug: "vuota", nome: "Vuota" }); // id 3, senza sedi
  nS = sedi.length;
  nU = utenti.length;
  const now = new Date();
  sedi.push(
    { id: SEDE_T2, tenantId: 2, nome: "Acme", citta: null, indirizzo: null, attiva: true, createdAt: now, updatedAt: now },
    { id: SEDE_T1, tenantId: 1, nome: "Ruffino Bis", citta: null, indirizzo: null, attiva: true, createdAt: now, updatedAt: now }
  );
  const base = { nome: "N", cognome: "C", attivo: true, sediIds: [SEDE_T2], createdAt: now, updatedAt: now };
  utenti.push(
    { ...base, id: COMMERCIALE_T2, email: "c@acme.test", ruoli: ["commerciale"], tenantId: 2 },
    { ...base, id: SPENTO_T2, email: "s@acme.test", ruoli: ["commerciale"], tenantId: 2, attivo: false },
    { ...base, id: SENZA_SEDE_T3, email: "v@vuota.test", ruoli: ["direzione"], tenantId: 3, sediIds: [] }
  );
});

afterEach(() => {
  sedi.splice(nS);
  utenti.splice(nU);
  delete process.env.FLAG_MULTI_AZIENDA;
});

describe("createContext con FLAG_MULTI_AZIENDA acceso", () => {
  it("risolve tenant, record e sedi dallo store; il cookie di una sede altrui è ignorato", async () => {
    const ctx = await contestoCon(COMMERCIALE_T2, ["commerciale"], SEDE_T1);
    expect(ctx.user?.id).toBe(COMMERCIALE_T2);
    expect(ctx.tenantId).toBe(2);
    expect(ctx.tenant?.slug).toBe("acme");
    expect(ctx.sediIds).toEqual([SEDE_T2]);
    expect(ctx.sedeId).toBe(SEDE_T2);
  });

  it("un utente disattivato con JWT valido non è più autenticato", async () => {
    const ctx = await contestoCon(SPENTO_T2, ["commerciale"]);
    expect(ctx.user).toBeNull();
    expect(ctx.tenantId).toBeNull();
    expect(ctx.tenant).toBeNull();
    expect(ctx.sedeId).toBeNull();
  });

  it("un tenant senza sedi attive dà sedeId null e sediIds vuoto", async () => {
    const ctx = await contestoCon(SENZA_SEDE_T3, ["direzione"]);
    expect(ctx.tenantId).toBe(3);
    expect(ctx.sediIds).toEqual([]);
    expect(ctx.sedeId).toBeNull();
  });
});

describe("createContext con FLAG_MULTI_AZIENDA spento", () => {
  it("tenant 1 implicito, nessuna rilettura dello store, sedi come oggi", async () => {
    process.env.FLAG_MULTI_AZIENDA = "off";
    const ctx = await contestoCon(SPENTO_T2, ["commerciale"]);
    expect(ctx.user?.id).toBe(SPENTO_T2);
    expect(ctx.tenantId).toBe(1);
    expect(ctx.tenant).toBeNull();
    expect(ctx.sediIds).toEqual([SEDE_T2]);
    expect(ctx.sedeId).toBe(SEDE_T2);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `pnpm vitest run server/_core/context.tenant.test.ts`
Expected: FAIL (`ctx.tenantId` undefined; utente disattivato ancora autenticato).

- [ ] **Step 3: Riscrivi `server/_core/context.ts`**

```ts
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { parse as parseCookieHeader } from "cookie";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { verifyLocalSession, type LocalUser } from "../localAuth";
import { SEDE_COOKIE } from "@shared/const";
import { allowedSediForUser, DEFAULT_SEDE_ID } from "../routers/sedi";
import { interruttoreAttivo } from "../platform/interruttori";
import { TENANT_PREDEFINITO_ID } from "../tenants/costanti";
import { risolviTenantPerUtente, sediAmmesse } from "../tenants/contesto";
import type { TenantRecord } from "../tenants/tipi";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: (User | LocalUser) | null;
  // Azienda della sessione (WS1, spec §5.1). Null solo se non autenticato;
  // con FLAG_MULTI_AZIENDA spento vale sempre 1 (Ruffino Group).
  tenantId: number | null;
  // Il record del tenant: null se non autenticato o interruttore spento.
  tenant: TenantRecord | null;
  // Active sede for this request. Null only when unauthenticated (or, con il
  // multi-azienda acceso, quando il tenant non ha una sede attiva).
  sedeId: number | null;
  // Full set of sede ids the user may access (direzione = all del tenant).
  sediIds: number[];
};

export async function createContext(
  opts: Pick<CreateExpressContextOptions, "req" | "res"> &
    Partial<Pick<CreateExpressContextOptions, "info">>
): Promise<TrpcContext> {
  let user: (User | LocalUser) | null = null;

  // Try OAuth auth first
  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch {
    user = null;
  }

  // Fallback to local auth (dev/demo mode)
  if (!user) {
    try {
      user = await verifyLocalSession(opts.req);
    } catch {
      user = null;
    }
  }

  const multiAzienda = interruttoreAttivo("multiAzienda");
  let tenantId: number | null = null;
  let tenant: TenantRecord | null = null;
  let sedeId: number | null = null;
  let sediIds: number[] = [];

  if (user && multiAzienda) {
    // L'utente si rilegge dallo store: un JWT valido non basta più a chi è
    // stato cancellato o disattivato, e il tenant non è mai un claim del token.
    const risolto = risolviTenantPerUtente(user);
    if (!risolto) {
      user = null;
    } else {
      tenantId = risolto.tenantId;
      tenant = risolto.tenant;
      sediIds = sediAmmesse(risolto.utente, tenantId);
    }
  } else if (user) {
    tenantId = TENANT_PREDEFINITO_ID;
    sediIds = allowedSediForUser(user);
  }

  // Resolve the active sede. The requested sede comes from the `active_sede`
  // cookie but is ONLY honoured when the user is actually assigned to it —
  // otherwise we fall back to their first allowed sede. This makes the cookie
  // non-authoritative: tampering can never widen access.
  if (user) {
    let requested: number | null = null;
    const cookieHeader = opts.req.headers.cookie;
    if (cookieHeader) {
      const raw = parseCookieHeader(cookieHeader)[SEDE_COOKIE];
      const parsed = raw ? parseInt(raw, 10) : NaN;
      if (Number.isFinite(parsed)) requested = parsed;
    }
    sedeId =
      requested != null && sediIds.includes(requested)
        ? requested
        : sediIds[0] ?? (multiAzienda ? null : DEFAULT_SEDE_ID);
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    tenantId,
    tenant,
    sedeId,
    sediIds,
  };
}
```

- [ ] **Step 4: Scrivi l'helper dei test**

```ts
// server/_core/contestoDiProva.ts
// Un TrpcContext costruito a mano per i test dei router (WS1). Da usare nei
// test nuovi al posto delle funzioni `context()` locali.
import type { TenantRecord } from "../tenants/tipi";
import type { TrpcContext } from "./context";

export function contestoDiProva(input: {
  utenteId: number;
  ruoli?: string[];
  sedeId: number | null;
  sediIds?: number[];
  tenantId?: number | null;
  tenant?: TenantRecord | null;
  nome?: string;
  email?: string;
}): TrpcContext {
  const ruoli = input.ruoli ?? ["direzione"];
  const sediIds = input.sediIds ?? (input.sedeId == null ? [] : [input.sedeId]);
  return {
    user: {
      id: input.utenteId,
      openId: `local-${input.utenteId}`,
      name: input.nome ?? `Utente ${input.utenteId}`,
      email: input.email ?? `utente${input.utenteId}@prova.test`,
      loginMethod: "local",
      role: ruoli.includes("direzione") ? "admin" : "user",
      ruolo: ruoli[0],
      ruoli,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } as any,
    req: { protocol: "http", headers: {} } as any,
    // `sedi.switch` e il login scrivono cookie: due no-op bastano.
    res: { cookie() {}, clearCookie() {} } as any,
    tenantId: input.tenantId === undefined ? 1 : input.tenantId,
    tenant: input.tenant ?? null,
    sedeId: input.sedeId,
    sediIds,
  };
}
```

- [ ] **Step 5: Esegui il codemod sugli 83 test (una tantum, non si committa lo script)**

Salva questo file in `/tmp/codemod-contesto-tenant.py` ed eseguilo dalla radice del repo con `python3 /tmp/codemod-contesto-tenant.py`:

```python
# Aggiunge `tenantId: 1, tenant: null` a ogni TrpcContext costruito a mano nei
# test. Riconosce il literal dal campo `res:` vicino a `sediIds`; gli input di
# utenti.create (che hanno sediIds ma non res) restano intatti.
import pathlib, re

RADICI = ["server", "client/src", "shared"]
files = [p for r in RADICI for p in pathlib.Path(r).rglob("*.test.ts")]
RIGA_SEDI = re.compile(r"^(\s*)sediIds(?::\s*(.*?))?(,?)\s*$")

for p in files:
    righe = p.read_text(encoding="utf-8").split("\n")
    out, cambiato = [], False
    for i, riga in enumerate(righe):
        out.append(riga)
        m = RIGA_SEDI.match(riga)
        if not m or riga.rstrip().endswith(("[", "{", "(")):
            continue
        finestra = righe[max(0, i - 14):i] + righe[i + 1:i + 8]
        if not any(re.match(r"^\s*res:", r) for r in finestra):
            continue
        if any(re.match(r"^\s*tenantId:", r) for r in finestra):
            continue
        indent = m.group(1)
        if not m.group(3):
            out[-1] = riga.rstrip() + ","
        out.append(f"{indent}tenantId: 1,")
        out.append(f"{indent}tenant: null,")
        cambiato = True
    if cambiato:
        p.write_text("\n".join(out), encoding="utf-8")
        print("patch", p)
```

Poi:

Run: `pnpm check`
Expected: zero errori. Se `tsc` segnala ancora `Property 'tenantId' is missing in type … 'TrpcContext'`, il literal ha `sediIds` su più righe o `res:` lontano: aggiungi a mano `tenantId: 1,` e `tenant: null,` accanto a `sediIds` in quel literal e rilancia `pnpm check` finché è verde. Elenca i file corretti a mano nel messaggio di commit.

- [ ] **Step 6: Esegui la suite intera**

Run: `pnpm vitest run`
Expected: PASS (nessuna guardia è ancora installata: cambia solo il tipo del contesto). `pnpm vitest run server/_core/context.tenant.test.ts` PASS.

- [ ] **Step 7: Commit**

```bash
git add server/_core/context.ts server/_core/contestoDiProva.ts server/_core/context.tenant.test.ts server client shared
git commit -m "feat(tenant): tenantId e tenant nel contesto tRPC, utente riletto dallo store a ogni richiesta; contesti di prova aggiornati

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Procedure con le guardie, `assertTenantScope`, porta chiusa nel login, `tenants.mio`

**Files:**
- Modify: `server/_core/trpc.ts` (intero file)
- Modify: `server/_core/permissions.ts` (dopo `assertSedeScope`, riga 73)
- Modify: `server/routers.ts:1-57` (import), `:99-101` (montaggio), `:135-137` (login)
- Create: `server/tenants/router.ts`
- Test: `server/_core/guardieTenant.test.ts`

**Interfaces:**
- Consumes: `MESSAGGI`, `portaChiusaPerTenant`, `ruoliDi`, `getTenantRepository`, `contestoDiProva`.
- Produces: `sessionProcedure` (autenticato, senza guardie); `protectedProcedure` = `sessionProcedure` + guardie; `adminProcedure` = direzione + guardie; `assertTenantScope(record, tenantId)`; `tenantsRouter` con `tenants.mio → { id, slug, nome, stato, proprietario, multiAzienda }`.

- [ ] **Step 1: Scrivi il test che fallisce**

```ts
// server/_core/guardieTenant.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appRouter } from "../routers";
import { contestoDiProva } from "./contestoDiProva";
import { hashPassword } from "./password";
import { getSediStore } from "../routers/sedi";
import { getUtentiStore } from "../routers/utenti";
import { getTenantRepository, resetTenantRepositoryForTesting } from "../tenants/repository";
import type { TenantRecord } from "../tenants/tipi";

const SEDE = 97401; // sede reale del tenant 1, spinta nello store: serve a sedi.switch
let acme: TenantRecord;
const sedi = getSediStore();
let nSedi = 0;

beforeEach(async () => {
  resetTenantRepositoryForTesting();
  const repo = getTenantRepository();
  await repo.assicuraTenantPredefinito();
  acme = await repo.inserisci({ slug: "acme", nome: "Acme" });
  nSedi = sedi.length;
  const now = new Date();
  sedi.push({ id: SEDE, tenantId: 1, nome: "Guardie", citta: null, indirizzo: null, attiva: true, createdAt: now, updatedAt: now });
});

afterEach(() => {
  sedi.splice(nSedi);
  delete process.env.FLAG_MULTI_AZIENDA;
});

describe("porta chiusa (WS1)", () => {
  it("un tenant diverso da 1 non entra nelle procedure business, ma tenants.mio risponde", async () => {
    const caller = appRouter.createCaller(
      contestoDiProva({ utenteId: 97411, sedeId: SEDE, tenantId: acme.id, tenant: acme })
    );
    await expect(caller.clienti.list({})).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "L'azienda non è ancora attiva su questa installazione.",
    });
    await expect(caller.tenants.mio()).resolves.toMatchObject({
      id: acme.id,
      slug: "acme",
      stato: "attivo",
      proprietario: false,
      multiAzienda: true,
    });
  });

  it("con l'interruttore spento la porta non esiste e tenants.mio risponde col tenant 1", async () => {
    process.env.FLAG_MULTI_AZIENDA = "off";
    const caller = appRouter.createCaller(
      contestoDiProva({ utenteId: 97411, sedeId: SEDE, tenantId: acme.id, tenant: acme })
    );
    await expect(caller.clienti.list({})).resolves.toBeInstanceOf(Array);
    await expect(caller.tenants.mio()).resolves.toMatchObject({ multiAzienda: false });
  });
});

describe("sola lettura del tenant sospeso", () => {
  it("legge, non scrive; sedi.switch è esente; adminProcedure eredita", async () => {
    const sospeso = await getTenantRepository().aggiornaStato(1, "sospeso", "prova");
    const caller = appRouter.createCaller(
      contestoDiProva({ utenteId: 97412, sedeId: SEDE, sediIds: [SEDE], tenantId: 1, tenant: sospeso })
    );
    await expect(caller.clienti.list({})).resolves.toBeInstanceOf(Array);
    await expect(caller.clienti.create({ nome: "Mario", cognome: "Sospeso" })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "Azienda sospesa: il gestionale è in sola lettura.",
    });
    await expect(caller.sedi.create({ nome: "Nuova" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(caller.sedi.switch({ sedeId: SEDE })).resolves.toMatchObject({ id: SEDE });
  });
});

describe("sede attiva obbligatoria", () => {
  it("con un tenant reale e sedeId null la procedura protetta rifiuta", async () => {
    const t1 = getTenantRepository().perId(1)!;
    const caller = appRouter.createCaller(
      contestoDiProva({ utenteId: 97413, sedeId: null, sediIds: [], tenantId: 1, tenant: t1 })
    );
    await expect(caller.clienti.list({})).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "L'azienda non ha una sede attiva.",
    });
  });
});

describe("login", () => {
  it("rifiuta gli utenti di un tenant diverso da 1 prima di emettere il cookie", async () => {
    const utenti = getUtentiStore();
    const n = utenti.length;
    utenti.push({
      id: 97414, nome: "A", cognome: "B", email: "porta@acme.test", ruoli: ["direzione"],
      sediIds: [], attivo: true, tenantId: acme.id, password: hashPassword("Password-lunga-12"),
      createdAt: new Date(), updatedAt: new Date(),
    });
    try {
      const anonimo = { ...contestoDiProva({ utenteId: 0, sedeId: null, tenantId: null }), user: null };
      const caller = appRouter.createCaller(anonimo);
      await expect(
        caller.auth.login({ email: "porta@acme.test", password: "Password-lunga-12" })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    } finally {
      utenti.splice(n);
    }
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `pnpm vitest run server/_core/guardieTenant.test.ts`
Expected: FAIL (`tenants.mio` inesistente; nessun rifiuto).

- [ ] **Step 3: Riscrivi `server/_core/trpc.ts`**

```ts
import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import {
  assicuraInterruttore,
  interruttoreAttivo,
  type Interruttore,
} from "../platform/interruttori";
import { MESSAGGI } from "../tenants/costanti";
import { portaChiusaPerTenant } from "../tenants/regole";
import type { TrpcContext } from "./context";
import { rigaProceduraLenta, vaSegnalata } from "./osservabilita";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;

// Quanto ha atteso chi ha chiamato. Sta sulla procedura base, quindi copre
// anche quelle pubbliche: se il ritardo è nell'autenticazione o nel contesto,
// deve comparire lo stesso. Scrive solo sopra la soglia — v. osservabilita.ts.
const cronometro = t.middleware(async ({ path, next }) => {
  const inizio = Date.now();
  const esito = await next();
  const durata = Date.now() - inizio;
  if (vaSegnalata(durata)) {
    console.warn(rigaProceduraLenta(path, durata, esito.ok ? "ok" : "errore"));
  }
  return esito;
});

export const publicProcedure = t.procedure.use(cronometro);

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

// Guardie del tenant (WS1, spec §5.2). Solo con FLAG_MULTI_AZIENDA acceso:
//  - porta chiusa: finché il WS2 non rende tenant-aware gli archivi, ogni
//    tenant diverso dal predefinito viene rifiutato (`portaChiusaPerTenant`,
//    da togliere nel WS2 insieme al suo gemello nel login);
//  - sola lettura: le mutation di un tenant sospeso muoiono qui;
//    `sedi.switch` scrive solo un cookie ed è esente;
//  - sede attiva obbligatoria, quando il contesto viene da un tenant reale
//    (`ctx.tenant` non nullo: lo mette solo createContext).
const guardiaTenant = t.middleware(async ({ ctx, next, type, path }) => {
  if (interruttoreAttivo("multiAzienda")) {
    if (ctx.tenantId == null || portaChiusaPerTenant(ctx.tenantId)) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: MESSAGGI.portaChiusa });
    }
    if (ctx.tenant) {
      if (type === "mutation" && ctx.tenant.stato === "sospeso" && path !== "sedi.switch") {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: MESSAGGI.solaLettura });
      }
      if (ctx.sedeId == null) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: MESSAGGI.senzaSede });
      }
    }
  }
  return next();
});

/** Autenticato, SENZA guardie tenant: solo `tenants.mio` e, domani, l'onboarding. */
export const sessionProcedure = publicProcedure.use(requireUser);

export const protectedProcedure = sessionProcedure.use(guardiaTenant);

// Release hardening: procedura protetta che verifica ANCHE un kill switch
// prima di qualunque lavoro. I router della Document Intelligence si
// costruiscono da qui, così un endpoint nuovo nasce già dietro il flag
// invece di dover ricordare la guardia a mano (revisione).
export const procedureConInterruttore = (nome: Interruttore) =>
  protectedProcedure.use(
    t.middleware(({ next }) => {
      assicuraInterruttore(nome);
      return next();
    })
  );

// Direzione (legacy `role: "admin"`), come oggi: FORBIDDEN anche per gli
// anonimi. Le guardie del tenant valgono anche qui.
const requireAdmin = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user || ctx.user.role !== 'admin') {
    throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const adminProcedure = publicProcedure.use(requireAdmin).use(guardiaTenant);
```

- [ ] **Step 4: Aggiungi `assertTenantScope` in `server/_core/permissions.ts`** (dopo `assertSedeScope`)

```ts
type TenantScopedRecord = { tenantId?: number | null } | null | undefined;

/**
 * Gemello di `assertSedeScope` per il control plane (utenti, sedi; dal WS2
 * anche i record business): un record di un'altra azienda risponde
 * NOT_FOUND, mai FORBIDDEN, così la risposta non conferma che l'id esista.
 * Con `tenantId` nullo (non autenticato: non succede dietro una procedura
 * protetta) non fa nulla.
 */
export function assertTenantScope(
  record: TenantScopedRecord,
  tenantId: number | null
): void {
  if (!record) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Risorsa non trovata." });
  }
  if (tenantId == null) return;
  if ((record as any).tenantId !== tenantId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Risorsa non trovata." });
  }
}
```

- [ ] **Step 5: Scrivi `server/tenants/router.ts` e monta il router**

```ts
// server/tenants/router.ts
import { router, sessionProcedure } from "../_core/trpc";
import { interruttoreAttivo } from "../platform/interruttori";
import {
  RUOLO_PROPRIETARIO,
  TENANT_PREDEFINITO_ID,
  TENANT_PREDEFINITO_NOME,
  TENANT_PREDEFINITO_SLUG,
} from "./costanti";
import { ruoliDi } from "./regole";
import { getTenantRepository } from "./repository";
import type { TenantRecord } from "./tipi";

function tenantPredefinitoSintetico(): TenantRecord {
  const now = new Date();
  return {
    id: TENANT_PREDEFINITO_ID,
    slug: TENANT_PREDEFINITO_SLUG,
    nome: TENANT_PREDEFINITO_NOME,
    stato: "attivo",
    motivoStato: null,
    createdAt: now,
    updatedAt: now,
  };
}

export const tenantsRouter = router({
  /**
   * L'azienda della sessione. `sessionProcedure`: risponde anche dietro la
   * porta chiusa e in sola lettura, così il client sa sempre dove si trova.
   */
  mio: sessionProcedure.query(({ ctx }) => {
    const multiAzienda = interruttoreAttivo("multiAzienda");
    const tenant =
      ctx.tenant ??
      getTenantRepository().perId(ctx.tenantId ?? TENANT_PREDEFINITO_ID) ??
      tenantPredefinitoSintetico();
    return {
      id: tenant.id,
      slug: tenant.slug,
      nome: tenant.nome,
      stato: tenant.stato,
      proprietario: ruoliDi(ctx.user).includes(RUOLO_PROPRIETARIO),
      multiAzienda,
    };
  }),
});
```

In `server/routers.ts` aggiungi gli import:

```ts
import { tenantsRouter } from "./tenants/router";
import { interruttoreAttivo } from "./platform/interruttori";
import { MESSAGGI, TENANT_PREDEFINITO_ID } from "./tenants/costanti";
import { portaChiusaPerTenant } from "./tenants/regole";
```

Nel login, subito dopo `clearLoginAttempts(input.email);`:

```ts
        // Porta chiusa (WS1): niente sessione per un tenant che gli archivi
        // non sanno ancora servire. Stesso messaggio della guardia tRPC.
        const tenantUtente =
          typeof utente.tenantId === "number" ? utente.tenantId : TENANT_PREDEFINITO_ID;
        if (interruttoreAttivo("multiAzienda") && portaChiusaPerTenant(tenantUtente)) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: MESSAGGI.portaChiusa,
          });
        }
```

Nel router principale, dopo `platform: platformRouter,`: `tenants: tenantsRouter,`.

- [ ] **Step 6: Esegui i test**

Run: `pnpm vitest run server/_core/guardieTenant.test.ts && pnpm check && pnpm vitest run`
Expected: PASS. Se un test esistente si aspettava `UNAUTHORIZED` per un contesto con `sedeId: null` e `tenant` valorizzato, ora riceve `PRECONDITION_FAILED` «L'azienda non ha una sede attiva.»: aggiorna l'aspettativa citando la spec §5.2 nel commento. Un contesto con `tenant: null` (tutti quelli del codemod) non tocca quella guardia.

- [ ] **Step 7: Commit**

```bash
git add server/_core/trpc.ts server/_core/permissions.ts server/routers.ts server/tenants/router.ts server/_core/guardieTenant.test.ts
git commit -m "feat(tenant): sessionProcedure, porta chiusa, sola lettura e sede obbligatoria nelle procedure; assertTenantScope; tenants.mio; login dietro la porta

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Utenti, sedi e permessi per tenant; ruolo `proprietario` assegnabile

**Files:**
- Modify: `server/routers/utenti.ts` (`RUOLI`, `scopedUtenti`, `create`, `update`, `delete`)
- Modify: `server/routers/sedi.ts` (router: `list`, `listAll`, `active`, `create`, `update`, `switch`)
- Modify: `server/routers/permessi.ts:25-52` (`directionContext`, `findUserInSede`) e le sue chiamate
- Test: `server/routers/utenti.tenant.test.ts`, `server/routers/sedi.tenant.test.ts`

**Interfaces:**
- Consumes: `assertTenantScope`, `effectiveCapabilitySet(ctx, caps)` (`server/authz/enforcement.ts`), `getTenantRepository().registraEvento`, regole del Task 2, helper del Task 5.
- Produces: `RUOLI` con `proprietario`; `utenti.*` e `sedi.*` per tenant; `findUserInSede(userId, sedeId, tenantId)`.

- [ ] **Step 1: Scrivi i test che falliscono**

```ts
// server/routers/utenti.tenant.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appRouter } from "../routers";
import { contestoDiProva } from "../_core/contestoDiProva";
import { getSediStore, sedePredefinita } from "./sedi";
import { getUtentiStore } from "./utenti";
import { getTenantRepository, resetTenantRepositoryForTesting } from "../tenants/repository";
import type { TenantRecord } from "../tenants/tipi";

const SEDE_T1 = 97501;
const SEDE_T2 = 97502;
const PROPRIETARIO_T1 = 97511; // proprietario + direzione
const DIREZIONE_T1 = 97512;
const COMMERCIALE_T1 = 97513;
const PROPRIETARIO_T2 = 97514;

const sedi = getSediStore();
const utenti = getUtentiStore();
let nS = 0;
let nU = 0;
let t1: TenantRecord;
let t2: TenantRecord;

beforeEach(async () => {
  resetTenantRepositoryForTesting();
  const repo = getTenantRepository();
  t1 = await repo.assicuraTenantPredefinito();
  t2 = await repo.inserisci({ slug: "acme", nome: "Acme" });
  nS = sedi.length;
  nU = utenti.length;
  const now = new Date();
  sedi.push(
    { id: SEDE_T1, tenantId: 1, nome: "Ruffino Test", citta: null, indirizzo: null, attiva: true, createdAt: now, updatedAt: now },
    { id: SEDE_T2, tenantId: 2, nome: "Acme Test", citta: null, indirizzo: null, attiva: true, createdAt: now, updatedAt: now }
  );
  const base = { nome: "N", cognome: "C", attivo: true, password: "scrypt$x", createdAt: now, updatedAt: now };
  utenti.push(
    { ...base, id: PROPRIETARIO_T1, email: "p1@ws1.test", ruoli: ["proprietario", "direzione"], sediIds: [SEDE_T1], tenantId: 1 },
    { ...base, id: DIREZIONE_T1, email: "d1@ws1.test", ruoli: ["direzione"], sediIds: [SEDE_T1], tenantId: 1 },
    { ...base, id: COMMERCIALE_T1, email: "c1@ws1.test", ruoli: ["commerciale"], sediIds: [SEDE_T1], tenantId: 1 },
    { ...base, id: PROPRIETARIO_T2, email: "p2@ws1.test", ruoli: ["proprietario", "direzione"], sediIds: [SEDE_T2], tenantId: 2 }
  );
});

afterEach(() => {
  sedi.splice(nS);
  utenti.splice(nU);
  delete process.env.FLAG_MULTI_AZIENDA;
});

const come = (utenteId: number, ruoli: string[]) =>
  appRouter.createCaller(
    contestoDiProva({ utenteId, ruoli, sedeId: SEDE_T1, sediIds: [SEDE_T1], tenantId: 1, tenant: t1 })
  );

describe("ruolo proprietario", () => {
  it("lo assegna solo chi ha tenant.manage_proprietari; la direzione no", async () => {
    await expect(
      come(DIREZIONE_T1, ["direzione"]).utenti.update({ id: COMMERCIALE_T1, ruoli: ["commerciale", "proprietario"] })
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "Solo un proprietario può nominare o revocare un proprietario." });

    const aggiornato = await come(PROPRIETARIO_T1, ["proprietario", "direzione"]).utenti.update({
      id: COMMERCIALE_T1,
      ruoli: ["commerciale", "proprietario"],
    });
    expect(aggiornato.ruoli).toEqual(["commerciale", "proprietario"]);
    const eventi = await getTenantRepository().eventi(1);
    expect(eventi.at(-1)).toMatchObject({ tipo: "proprietario_assegnato", attore: `utente:${PROPRIETARIO_T1}` });
  });

  it("anche in create serve la capability, e con l'interruttore spento non si aggiunge", async () => {
    const input = { nome: "Nuovo", cognome: "Prop", email: "np@ws1.test", ruoli: ["proprietario" as const], sediIds: [SEDE_T1], password: "Password-lunga-12" };
    await expect(come(DIREZIONE_T1, ["direzione"]).utenti.create(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    process.env.FLAG_MULTI_AZIENDA = "off";
    await expect(come(PROPRIETARIO_T1, ["proprietario", "direzione"]).utenti.create(input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "Il ruolo proprietario richiede FLAG_MULTI_AZIENDA.",
    });
    // chi lo ha già lo conserva
    await expect(
      come(DIREZIONE_T1, ["direzione"]).utenti.update({ id: PROPRIETARIO_T1, telefono: "0187" })
    ).resolves.toMatchObject({ ruoli: ["proprietario", "direzione"] });
  });

  it("l'ultimo proprietario e l'ultima direzione del tenant non si tolgono", async () => {
    const io = come(PROPRIETARIO_T1, ["proprietario", "direzione"]);
    await expect(io.utenti.update({ id: PROPRIETARIO_T1, ruoli: ["direzione"] })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringMatching(/ultimo proprietario/),
    });
    await expect(io.utenti.delete(PROPRIETARIO_T1)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    // il tenant 2 non conta: il suo proprietario resta uno
    await expect(io.utenti.update({ id: DIREZIONE_T1, ruoli: ["commerciale"] })).resolves.toBeTruthy();
    await expect(io.utenti.update({ id: PROPRIETARIO_T1, ruoli: ["proprietario"] })).rejects.toMatchObject({
      message: expect.stringMatching(/ultimo utente direzione/),
    });
  });
});

describe("isolamento del control plane", () => {
  it("un utente di un altro tenant non esiste: byId null, update e delete NOT_FOUND, list non lo mostra", async () => {
    const io = come(DIREZIONE_T1, ["direzione"]);
    await expect(io.utenti.byId(PROPRIETARIO_T2)).resolves.toBeNull();
    await expect(io.utenti.update({ id: PROPRIETARIO_T2, telefono: "1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(io.utenti.delete(PROPRIETARIO_T2)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const tutti = await io.utenti.list({ adminScope: true });
    expect(tutti.some((u: any) => u.id === PROPRIETARIO_T2)).toBe(false);
    expect(tutti.some((u: any) => u.id === COMMERCIALE_T1)).toBe(true);
  });

  it("le sedi assegnate devono appartenere al tenant, e l'email resta unica ovunque", async () => {
    const io = come(DIREZIONE_T1, ["direzione"]);
    await expect(io.utenti.update({ id: COMMERCIALE_T1, sediIds: [SEDE_T2] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      io.utenti.create({ nome: "X", cognome: "Y", email: "P2@ws1.test", ruoli: ["ordini"], password: "Password-lunga-12" })
    ).rejects.toThrow(/Email già in uso/);
    const creato = await io.utenti.create({ nome: "X", cognome: "Y", email: "x@ws1.test", ruoli: ["ordini"], password: "Password-lunga-12" });
    // prima sede attiva del tenant 1: il seed «La Spezia» se il test l'ha caricato, altrimenti SEDE_T1
    expect(creato.sediIds).toEqual([sedePredefinita(1)]);
    expect((creato as any).tenantId).toBe(1);
  });
});
```

```ts
// server/routers/sedi.tenant.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appRouter } from "../routers";
import { contestoDiProva } from "../_core/contestoDiProva";
import { getSediStore } from "./sedi";
import { getUtentiStore } from "./utenti";
import { getTenantRepository, resetTenantRepositoryForTesting } from "../tenants/repository";
import type { TenantRecord } from "../tenants/tipi";

const SEDE_T1 = 97601;
const SEDE_T2 = 97602;
const DIREZIONE_T1 = 97611;
const COMMERCIALE_T1 = 97612;

const sedi = getSediStore();
const utenti = getUtentiStore();
let nS = 0;
let nU = 0;
let t1: TenantRecord;

beforeEach(async () => {
  resetTenantRepositoryForTesting();
  const repo = getTenantRepository();
  t1 = await repo.assicuraTenantPredefinito();
  await repo.inserisci({ slug: "acme", nome: "Acme" });
  nS = sedi.length;
  nU = utenti.length;
  const now = new Date();
  sedi.push(
    { id: SEDE_T1, tenantId: 1, nome: "Ruffino Test", citta: null, indirizzo: null, attiva: true, createdAt: now, updatedAt: now },
    { id: SEDE_T2, tenantId: 2, nome: "Acme Test", citta: null, indirizzo: null, attiva: true, createdAt: now, updatedAt: now }
  );
  const base = { nome: "N", cognome: "C", attivo: true, password: "scrypt$x", createdAt: now, updatedAt: now };
  utenti.push(
    { ...base, id: DIREZIONE_T1, email: "sd1@ws1.test", ruoli: ["direzione"], sediIds: [SEDE_T1], tenantId: 1 },
    { ...base, id: COMMERCIALE_T1, email: "sc1@ws1.test", ruoli: ["commerciale"], sediIds: [SEDE_T1], tenantId: 1 }
  );
});

afterEach(() => {
  sedi.splice(nS);
  utenti.splice(nU);
});

const come = (utenteId: number, ruoli: string[]) =>
  appRouter.createCaller(
    contestoDiProva({ utenteId, ruoli, sedeId: SEDE_T1, sediIds: [SEDE_T1], tenantId: 1, tenant: t1 })
  );

describe("sedi per tenant", () => {
  it("create stampa il tenant, listAll e list mostrano solo le sedi del tenant", async () => {
    const io = come(DIREZIONE_T1, ["direzione"]);
    const nuova = await io.sedi.create({ nome: "Sarzana" });
    expect(nuova.tenantId).toBe(1);
    const tutte = await io.sedi.listAll();
    expect(tutte.some(s => s.id === SEDE_T2)).toBe(false);
    expect(tutte.some(s => s.id === nuova.id)).toBe(true);
    const mie = await come(COMMERCIALE_T1, ["commerciale"]).sedi.list();
    expect(mie.map(s => s.id)).toEqual([SEDE_T1]);
  });

  it("update e switch verso una sede altrui vengono rifiutati", async () => {
    const io = come(DIREZIONE_T1, ["direzione"]);
    await expect(io.sedi.update({ id: SEDE_T2, nome: "Rubata" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(io.sedi.switch({ sedeId: SEDE_T2 })).rejects.toThrow(/Non sei assegnato/);
    await expect(come(COMMERCIALE_T1, ["commerciale"]).sedi.switch({ sedeId: SEDE_T1 })).resolves.toMatchObject({ id: SEDE_T1 });
  });
});
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `pnpm vitest run server/routers/utenti.tenant.test.ts server/routers/sedi.tenant.test.ts`
Expected: FAIL (`proprietario` non nello zod enum; nessun filtro per tenant).

- [ ] **Step 3: Modifica `server/routers/utenti.ts`**

Import in testa (aggiungi):

```ts
import type { TrpcContext } from "../_core/context";
import { assertTenantScope } from "../_core/permissions";
import { effectiveCapabilitySet } from "../authz/enforcement";
import { interruttoreAttivo } from "../platform/interruttori";
import { CAPABILITY_PROPRIETARI, MESSAGGI, RUOLO_PROPRIETARIO, TENANT_PREDEFINITO_ID } from "../tenants/costanti";
import {
  motivoRifiutoPresidio,
  proprietarioAggiunto,
  proprietarioTolto,
  ruoliDi,
  type UtentePresidio,
} from "../tenants/regole";
import { getTenantRepository } from "../tenants/repository";
import { attoreTesto } from "../tenants/tipi";
// Import ciclico innocuo: sedi.ts importa getUtentiStore, qui usiamo le sue
// funzioni solo dentro gli handler (come già fa sedi.ts con noi).
import { DEFAULT_SEDE_ID, sediDelTenant, sedePredefinita } from "./sedi";
```

`RUOLI` diventa otto valori: aggiungi `"proprietario",` in coda dopo `"ordini"`. Togli `isDirezioneAttivo` e `countDirezioneAttivi` (sostituiti dalle regole) e aggiungi gli helper:

```ts
function presidio(u: any): UtentePresidio {
  return {
    id: u.id,
    attivo: Boolean(u.attivo),
    ruoli: ruoliDi(u),
    tenantId: typeof u.tenantId === "number" ? u.tenantId : TENANT_PREDEFINITO_ID,
  };
}

function tenantDi(ctx: { tenantId: number | null }): number {
  return ctx.tenantId ?? TENANT_PREDEFINITO_ID;
}

/** Ogni sede assegnata deve appartenere al tenant: altrimenti NOT_FOUND, mai un indizio. */
function assertSediDelTenant(sediIds: number[], tenantId: number): void {
  const valide = new Set(sediDelTenant(tenantId).map(s => s.id));
  for (const id of sediIds) {
    if (!valide.has(id)) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Sede non trovata." });
    }
  }
}

/** Chi tocca il ruolo proprietario deve avere tenant.manage_proprietari; spento, il ruolo non si aggiunge. */
async function assertPuoNominareProprietari(ctx: TrpcContext, multi: boolean): Promise<void> {
  if (!multi) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: MESSAGGI.proprietarioRichiedeFlag });
  }
  const caps = await effectiveCapabilitySet(ctx, [CAPABILITY_PROPRIETARI]);
  if (!caps.has(CAPABILITY_PROPRIETARI)) {
    throw new TRPCError({ code: "FORBIDDEN", message: MESSAGGI.soloProprietari });
  }
}

function attoreDi(ctx: TrpcContext): string {
  return attoreTesto({ tipo: "utente", id: Number(ctx.user?.id) });
}
```

`scopedUtenti` diventa:

```ts
function scopedUtenti(
  ctx: { user: any; sedeId: number | null; tenantId: number | null },
  adminScope = false
) {
  const delTenant = interruttoreAttivo("multiAzienda")
    ? utenti.filter(u => presidio(u).tenantId === tenantDi(ctx))
    : utenti;
  if (adminScope) {
    if (!isDirezione(ctx.user)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Solo la direzione puo consultare tutte le sedi.",
      });
    }
    return [...delTenant];
  }
  if (ctx.sedeId == null) return [];
  return delTenant.filter(
    user => Array.isArray(user.sediIds) && user.sediIds.includes(ctx.sedeId)
  );
}
```

`create`, `update`, `delete` diventano:

```ts
  create: adminProcedure
    .input(
      z.object({
        nome: z.string().min(1),
        cognome: z.string().min(1),
        email: z.string().email(),
        telefono: z.string().optional(),
        ruoli: ruoliSchema,
        // Sedi (showroom) assigned to the user. Defaults to the tenant's first active sede.
        sediIds: z.array(z.number()).optional(),
        password: passwordSchema,
        attivo: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const multi = interruttoreAttivo("multiAzienda");
      const tenantId = tenantDi(ctx);
      const sediIds =
        input.sediIds && input.sediIds.length > 0
          ? input.sediIds
          : [sedePredefinita(tenantId) ?? DEFAULT_SEDE_ID];
      if (multi) assertSediDelTenant(sediIds, tenantId);
      if (input.ruoli.includes(RUOLO_PROPRIETARIO)) await assertPuoNominareProprietari(ctx, multi);
      const utente = creaUtenteInterno({
        tenantId,
        nome: input.nome,
        cognome: input.cognome,
        email: input.email,
        telefono: input.telefono ?? null,
        ruoli: input.ruoli,
        sediIds,
        passwordHash: hashPassword(input.password),
        attivo: input.attivo,
      });
      _store.save();
      if (multi && input.ruoli.includes(RUOLO_PROPRIETARIO)) {
        await getTenantRepository().registraEvento({
          tenantId,
          tipo: "proprietario_assegnato",
          attore: attoreDi(ctx),
          dettagli: { utenteId: utente.id },
        });
      }
      return publicUtente(utente);
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.number(),
        nome: z.string().min(1).optional(),
        cognome: z.string().min(1).optional(),
        email: z.string().email().optional(),
        telefono: z.string().optional(),
        ruoli: ruoliSchema.optional(),
        sediIds: z.array(z.number()).optional(),
        password: passwordSchema.optional(),
        attivo: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const multi = interruttoreAttivo("multiAzienda");
      const idx = utenti.findIndex(u => u.id === input.id);
      const before = idx === -1 ? null : utenti[idx];
      if (multi) assertTenantScope(before, ctx.tenantId);
      if (!before) throw new Error("Utente non trovato");
      const tenantId = presidio(before).tenantId;
      const { id, ...updates } = input;
      // Never persist an empty sedi list — fall back to the tenant's first sede.
      if (updates.sediIds && updates.sediIds.length === 0) {
        updates.sediIds = [sedePredefinita(tenantId) ?? DEFAULT_SEDE_ID];
      }
      if (multi && updates.sediIds) assertSediDelTenant(updates.sediIds, tenantId);
      // Only update password if provided (non-empty) — and hash it.
      if (!updates.password) delete updates.password;
      else updates.password = hashPassword(updates.password);

      const ruoliPrima = ruoliDi(before);
      const ruoliDopo = updates.ruoli ?? ruoliPrima;
      const aggiunto = proprietarioAggiunto(ruoliPrima, ruoliDopo);
      const tolto = proprietarioTolto(ruoliPrima, ruoliDopo);
      // Aggiungere il ruolo richiede la capability (e l'interruttore); toglierlo
      // richiede la capability solo con l'interruttore acceso: spento, chi lo
      // ha lo conserva e la direzione lavora come oggi.
      if (aggiunto || (tolto && multi)) await assertPuoNominareProprietari(ctx, multi);

      const after = { ...before, ...updates };
      const motivo = motivoRifiutoPresidio(presidio(before), presidio(after), utenti.map(presidio));
      if (motivo) throw new TRPCError({ code: "PRECONDITION_FAILED", message: motivo });

      utenti[idx] = { ...after, updatedAt: new Date() };
      _store.save();
      if (multi && (aggiunto || tolto)) {
        await getTenantRepository().registraEvento({
          tenantId,
          tipo: aggiunto ? "proprietario_assegnato" : "proprietario_revocato",
          attore: attoreDi(ctx),
          dettagli: { utenteId: before.id },
        });
      }
      return publicUtente(utenti[idx]);
    }),

  delete: adminProcedure.input(z.number()).mutation(({ input, ctx }) => {
    const multi = interruttoreAttivo("multiAzienda");
    const idx = utenti.findIndex(u => u.id === input);
    const before = idx === -1 ? null : utenti[idx];
    if (multi) assertTenantScope(before, ctx.tenantId);
    if (!before) throw new Error("Utente non trovato");
    const motivo = motivoRifiutoPresidio(presidio(before), null, utenti.map(presidio));
    if (motivo) throw new TRPCError({ code: "PRECONDITION_FAILED", message: motivo });
    utenti.splice(idx, 1);
    _store.save();
    return { success: true };
  }),
```

- [ ] **Step 4: Modifica il router di `server/routers/sedi.ts`**

Import: `import { interruttoreAttivo } from "../platform/interruttori";`, `import { assertTenantScope } from "../_core/permissions";`, `import { sediAmmesse } from "../tenants/contesto";` (import ciclico innocuo, usato solo negli handler).

```ts
function tenantDi(ctx: { tenantId: number | null }): number {
  return ctx.tenantId ?? TENANT_PREDEFINITO_ID;
}

function ammesse(ctx: { user: any; tenantId: number | null }): Set<number> {
  return new Set(
    interruttoreAttivo("multiAzienda")
      ? sediAmmesse(ctx.user, tenantDi(ctx))
      : allowedSediForUser(ctx.user)
  );
}

export const sediRouter = router({
  // Sedi the current user can switch between.
  list: protectedProcedure.query(({ ctx }) => {
    const allowed = ammesse(ctx);
    return sedi
      .filter((s) => allowed.has(s.id))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }),

  // Every sede of the tenant, for direzione management.
  listAll: adminProcedure.query(({ ctx }) => {
    const visibili = interruttoreAttivo("multiAzienda")
      ? sediDelTenant(tenantDi(ctx))
      : [...sedi];
    return visibili.sort((a, b) => a.nome.localeCompare(b.nome));
  }),

  // The active sede for this request (resolved in context).
  active: protectedProcedure.query(({ ctx }) => {
    const id = ctx.sedeId ?? (interruttoreAttivo("multiAzienda") ? null : DEFAULT_SEDE_ID);
    return id == null ? null : getSedeById(id);
  }),

  create: adminProcedure
    .input(
      z.object({
        nome: z.string().min(1),
        citta: z.string().optional(),
        indirizzo: z.string().optional(),
      })
    )
    .mutation(({ input, ctx }) => {
      const sede = creaSedeInterna({ tenantId: tenantDi(ctx), ...input });
      _store.save();
      return sede;
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.number(),
        nome: z.string().min(1).optional(),
        citta: z.string().nullable().optional(),
        indirizzo: z.string().nullable().optional(),
        attiva: z.boolean().optional(),
      })
    )
    .mutation(({ input, ctx }) => {
      const idx = sedi.findIndex((s) => s.id === input.id);
      if (interruttoreAttivo("multiAzienda")) assertTenantScope(sedi[idx] ?? null, ctx.tenantId);
      if (idx === -1) throw new Error("Sede non trovata");
      const { id, ...updates } = input;
      sedi[idx] = { ...sedi[idx], ...updates, updatedAt: new Date() };
      _store.save();
      return sedi[idx];
    }),

  // Switch the active sede. Validates that the user may see it, then writes
  // the `active_sede` cookie so subsequent requests are scoped to it.
  switch: protectedProcedure
    .input(z.object({ sedeId: z.number() }))
    .mutation(({ input, ctx }) => {
      const allowed = ammesse(ctx);
      if (!allowed.has(input.sedeId)) {
        throw new Error("Non sei assegnato a questa sede");
      }
      const sede = getSedeById(input.sedeId);
      if (!sede) throw new Error("Sede non trovata");
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(SEDE_COOKIE, String(input.sedeId), {
        ...cookieOptions,
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });
      return sede;
    }),
});
```

- [ ] **Step 5: Modifica `server/routers/permessi.ts`**

```ts
function directionContext(ctx: any) {
  requireDirezione(ctx.user);
  if (ctx.sedeId == null || ctx.user?.id == null) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Sessione non valida.",
    });
  }
  return {
    sedeId: ctx.sedeId as number,
    actorUserId: Number(ctx.user.id),
    tenantId: (ctx.tenantId ?? TENANT_PREDEFINITO_ID) as number,
  };
}

function findUserInSede(userId: number, sedeId: number, tenantId: number) {
  const user = getUtentiStore().find(
    candidate =>
      candidate.id === userId &&
      Array.isArray(candidate.sediIds) &&
      candidate.sediIds.includes(sedeId) &&
      (!interruttoreAttivo("multiAzienda") ||
        (typeof candidate.tenantId === "number" ? candidate.tenantId : TENANT_PREDEFINITO_ID) === tenantId)
  );
  if (!user) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Utente non trovato." });
  }
  return user;
}
```

Import `interruttoreAttivo` da `../platform/interruttori` e `TENANT_PREDEFINITO_ID` da `../tenants/costanti`. Poi `grep -n "findUserInSede(" server/routers/permessi.ts`: in ogni chiamata (in `preview`, `updateOverride`, `createDelegation`, `revokeDelegation`) destruttura anche `tenantId` da `directionContext(ctx)` e passa il terzo argomento, es. `findUserInSede(input.userId, sedeId, tenantId)`.

- [ ] **Step 6: Esegui i test**

Run: `pnpm vitest run server/routers/utenti.tenant.test.ts server/routers/sedi.tenant.test.ts server/routers/permessi.test.ts server/routers/permessi.tenant.test.ts && pnpm check && pnpm vitest run`
Expected: PASS. Se un test esistente crea utenti con `sediIds` di sedi che non esistono nello store (la validazione è nuova), fai creare la sede prima con `getSediStore().push({...})` nel `beforeEach` di quel test, con `tenantId: 1`; se un test si aspettava `Error` generico dall'ultima direzione, l'aspettativa `toThrow(/ultimo utente direzione/)` regge ancora (il messaggio è conservato).

- [ ] **Step 7: Commit**

```bash
git add server/routers/utenti.ts server/routers/sedi.ts server/routers/permessi.ts server/routers/utenti.tenant.test.ts server/routers/sedi.tenant.test.ts
git commit -m "feat(tenant): utenti, sedi e permessi per tenant — proprietario assegnabile solo dai proprietari, presìdi per tenant, sedi del tenant, NOT_FOUND cross-tenant

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Schemi dei comandi e servizio di dominio `tenants`

**Files:**
- Create: `server/tenants/comandi.ts`, `server/tenants/servizio.ts`
- Test: `server/tenants/comandi.test.ts`, `server/tenants/servizio.test.ts`

**Interfaces:**
- Consumes: repository (Task 4), `creaSedeInterna`/`getSediPersistedStore`/`sediDelTenant` e `creaUtenteInterno`/`getUtentiPersistedStore`/`getUtentiStore` (Task 5), `conTransazioneStoreAtomica` (`server/_core/persistence.ts`), regole (Task 2).
- Produces (comandi.ts): `schemaPayloadCrea`, `schemaPayloadStato`, `schemaPayloadProprietario`, `richiestoDa()`.
- Produces (servizio.ts): `assicuraTenantPredefinito()`, `crea(input, attore)`, `sospendi(id, motivo, attore)`, `riattiva(id, motivo, attore)`, `assegnaProprietario(id, utenteId, attore)`, `revocaProprietario(id, utenteId, attore)`, `eseguiComandiInAttesa()`; tipi `CreaTenantInput`, `EsitoCrea`.

- [ ] **Step 1: Scrivi i test che falliscono**

```ts
// server/tenants/comandi.test.ts
import { describe, expect, it } from "vitest";
import { hashPassword } from "../_core/password";
import { richiestoDa, schemaPayloadCrea, schemaPayloadProprietario, schemaPayloadStato } from "./comandi";

describe("schemi dei comandi", () => {
  it("crea: slug, nome, sede e proprietario con hash scrypt", () => {
    const ok = schemaPayloadCrea.parse({
      slug: "acme",
      nome: "Acme Infissi",
      sede: { nome: "Acme Infissi" },
      proprietario: { nome: "Mario", cognome: "Rossi", email: "m@acme.it", passwordHash: hashPassword("Password-lunga-12") },
    });
    expect(ok.sede.citta).toBeUndefined();
    expect(() => schemaPayloadCrea.parse({ ...ok, slug: "Acme" })).toThrow();
    expect(() => schemaPayloadCrea.parse({ ...ok, proprietario: { ...ok.proprietario, passwordHash: "in-chiaro" } })).toThrow();
  });
  it("stato e proprietario", () => {
    expect(schemaPayloadStato.parse({ slug: "acme", motivo: "insoluto" }).motivo).toBe("insoluto");
    expect(() => schemaPayloadStato.parse({ slug: "acme", motivo: "x" })).toThrow();
    expect(schemaPayloadProprietario.parse({ slug: "acme", email: "m@acme.it" }).email).toBe("m@acme.it");
  });
  it("richiestoDa nomina lo script e l'host", () => {
    expect(richiestoDa()).toMatch(/^script:tenant@.+/);
  });
});
```

```ts
// server/tenants/servizio.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../_core/password";
import { getSediStore } from "../routers/sedi";
import { getUtentiStore } from "../routers/utenti";
import { getTenantRepository, resetTenantRepositoryForTesting } from "./repository";
import {
  assegnaProprietario,
  assicuraTenantPredefinito,
  crea,
  eseguiComandiInAttesa,
  revocaProprietario,
  riattiva,
  sospendi,
} from "./servizio";

const sedi = getSediStore();
const utenti = getUtentiStore();
let nS = 0;
let nU = 0;
const script = { tipo: "script" as const, nome: "script:tenant@test" };

beforeEach(() => {
  resetTenantRepositoryForTesting();
  nS = sedi.length;
  nU = utenti.length;
});

afterEach(() => {
  sedi.splice(nS);
  utenti.splice(nU);
  delete process.env.FLAG_MULTI_AZIENDA;
});

const inputAcme = () => ({
  slug: "acme",
  nome: "Acme Infissi",
  sede: { nome: "Acme Infissi", citta: "Sarzana" },
  proprietario: { nome: "Mario", cognome: "Rossi", email: "mario@acme.test", passwordHash: hashPassword("Password-lunga-12") },
});

describe("crea", () => {
  it("crea tenant, prima sede e proprietario+direzione, con gli eventi", async () => {
    const esito = await crea(inputAcme(), script);
    expect(esito.creatoOra).toBe(true);
    expect(esito.tenant.slug).toBe("acme");
    const sede = sedi.find(s => s.id === esito.sedeId)!;
    expect(sede.tenantId).toBe(esito.tenant.id);
    const utente = utenti.find(u => u.id === esito.utenteId)!;
    expect(utente.ruoli).toEqual(["proprietario", "direzione"]);
    expect(utente.sediIds).toEqual([esito.sedeId]);
    expect(utente.tenantId).toBe(esito.tenant.id);
    const eventi = await getTenantRepository().eventi(esito.tenant.id);
    expect(eventi.map(e => e.tipo)).toEqual(["creato", "proprietario_assegnato"]);
    expect(eventi[0].attore).toBe("script:tenant@test");
  });

  it("è idempotente per slug e rifiuta slug non validi ed email di altre aziende", async () => {
    const primo = await crea(inputAcme(), script);
    const secondo = await crea(inputAcme(), script);
    expect(secondo.creatoOra).toBe(false);
    expect(secondo.tenant.id).toBe(primo.tenant.id);
    expect(secondo.sedeId).toBe(primo.sedeId);
    expect(secondo.utenteId).toBe(primo.utenteId);
    await expect(crea({ ...inputAcme(), slug: "Acme" }, script)).rejects.toThrow(/Slug/);
    await expect(crea({ ...inputAcme(), slug: "altra" }, script)).rejects.toThrow(/altra azienda/);
  });
});

describe("stato e proprietari", () => {
  it("sospende e riattiva con eventi e cache aggiornata", async () => {
    const { tenant } = await crea(inputAcme(), script);
    const sospeso = await sospendi(tenant.id, "insoluto", script);
    expect(sospeso.stato).toBe("sospeso");
    expect(getTenantRepository().perId(tenant.id)?.stato).toBe("sospeso");
    await riattiva(tenant.id, "pagato", script);
    expect(getTenantRepository().perId(tenant.id)?.stato).toBe("attivo");
    const tipi = (await getTenantRepository().eventi(tenant.id)).map(e => e.tipo);
    expect(tipi.slice(-2)).toEqual(["sospeso", "riattivato"]);
  });

  it("assegna e revoca il ruolo con la guardia dell'ultimo proprietario", async () => {
    const { tenant, sedeId, utenteId } = await crea(inputAcme(), script);
    const now = new Date();
    utenti.push({ id: 97701, nome: "S", cognome: "T", email: "s@acme.test", ruoli: ["direzione"], sediIds: [sedeId], attivo: true, tenantId: tenant.id, password: "scrypt$x", createdAt: now, updatedAt: now });
    await expect(revocaProprietario(tenant.id, utenteId, script)).rejects.toThrow(/ultimo proprietario/);
    await assegnaProprietario(tenant.id, 97701, script);
    expect(utenti.find(u => u.id === 97701)!.ruoli).toEqual(["direzione", "proprietario"]);
    await revocaProprietario(tenant.id, utenteId, script);
    expect(utenti.find(u => u.id === utenteId)!.ruoli).toEqual(["direzione"]);
    await expect(assegnaProprietario(tenant.id, 999_999, script)).rejects.toThrow(/inesistente/);
  });
});

describe("assicuraTenantPredefinito", () => {
  it("semina il tenant 1 e dà il ruolo alla prima direzione attiva senza proprietari", async () => {
    const now = new Date();
    utenti.push({ id: 97702, nome: "D", cognome: "Uno", email: "d1@t1.test", ruoli: ["direzione", "amministrazione", "commerciale"], sediIds: [1], attivo: true, tenantId: 1, password: "scrypt$x", createdAt: now, updatedAt: now });
    utenti.push({ id: 97703, nome: "D", cognome: "Due", email: "d2@t1.test", ruoli: ["direzione"], sediIds: [1], attivo: true, tenantId: 1, password: "scrypt$x", createdAt: now, updatedAt: now });
    const giaProprietari = utenti.filter(u => (u.ruoli ?? []).includes("proprietario") && u.tenantId === 1).map(u => u.id);
    await assicuraTenantPredefinito();
    expect(getTenantRepository().perId(1)?.slug).toBe("ruffino-group");
    const oraProprietari = utenti.filter(u => (u.ruoli ?? []).includes("proprietario") && u.tenantId === 1).map(u => u.id);
    // Se il tenant 1 non aveva proprietari, il primo candidato per id con meno di
    // 3 ruoli lo riceve (97702 ha già tre ruoli, quindi 97703 se l'utente 1 non c'è).
    expect(oraProprietari.length).toBeGreaterThanOrEqual(1);
    expect(oraProprietari.length).toBe(Math.max(giaProprietari.length, 1));
    await assicuraTenantPredefinito();
    expect(utenti.filter(u => (u.ruoli ?? []).includes("proprietario") && u.tenantId === 1).length).toBe(oraProprietari.length);
  });
});

describe("eseguiComandiInAttesa", () => {
  it("esegue i comandi in ordine e segna gli errori senza fermarsi", async () => {
    const repo = getTenantRepository();
    await repo.assicuraTenantPredefinito();
    const a = await repo.accodaComando({ tipo: "crea", tenantId: null, payload: inputAcme(), richiestoDa: "script:tenant@test" });
    const b = await repo.accodaComando({ tipo: "sospendi", tenantId: null, payload: { slug: "acme", motivo: "prova" }, richiestoDa: "script:tenant@test" });
    const c = await repo.accodaComando({ tipo: "riattiva", tenantId: null, payload: { slug: "non-esiste", motivo: "prova" }, richiestoDa: "script:tenant@test" });
    const esito = await eseguiComandiInAttesa();
    expect(esito).toEqual({ eseguiti: 2, falliti: 1 });
    expect((await repo.comando(a.id))?.stato).toBe("eseguito");
    expect((await repo.comando(b.id))?.stato).toBe("eseguito");
    expect((await repo.comando(c.id))?.esito).toMatchObject({ errore: expect.stringMatching(/non-esiste/) });
    expect(repo.perSlug("acme")?.stato).toBe("sospeso");
  });

  it("con l'interruttore spento non esegue nulla", async () => {
    process.env.FLAG_MULTI_AZIENDA = "off";
    const repo = getTenantRepository();
    await repo.accodaComando({ tipo: "crea", tenantId: null, payload: inputAcme(), richiestoDa: "script:tenant@test" });
    expect(await eseguiComandiInAttesa()).toEqual({ eseguiti: 0, falliti: 0 });
    expect((await repo.comandiInAttesa()).length).toBe(1);
  });
});
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `pnpm vitest run server/tenants/comandi.test.ts server/tenants/servizio.test.ts`
Expected: FAIL, moduli inesistenti.

- [ ] **Step 3: Scrivi `server/tenants/comandi.ts`**

```ts
// server/tenants/comandi.ts
// Schemi dei payload di `tenant_comandi`, condivisi da script (produttore) e
// server (esecutore). Nessun accesso a store o database qui.
import { hostname } from "node:os";
import { z } from "zod";
import { isHashed } from "../_core/password";
import { SLUG_RE } from "./costanti";

const slug = z.string().regex(SLUG_RE, "Slug non valido: minuscole, cifre e trattini interni, max 40");
const testo = (max: number) => z.string().trim().min(1).max(max);

export const schemaPayloadCrea = z.object({
  slug,
  nome: testo(120),
  sede: z.object({
    nome: testo(120),
    citta: z.string().trim().max(80).nullable().optional(),
  }),
  proprietario: z.object({
    nome: testo(80),
    cognome: testo(80),
    email: z.string().trim().email(),
    telefono: z.string().trim().max(40).nullable().optional(),
    // Mai in chiaro: lo script hasha prima di accodare.
    passwordHash: z.string().refine(isHashed, "passwordHash deve essere un hash scrypt"),
  }),
});
export type PayloadCrea = z.infer<typeof schemaPayloadCrea>;

export const schemaPayloadStato = z.object({
  slug,
  motivo: z.string().trim().min(3).max(500),
});

export const schemaPayloadProprietario = z.object({
  slug,
  email: z.string().trim().email(),
});

export function richiestoDa(): string {
  return `script:tenant@${hostname()}`;
}
```

- [ ] **Step 4: Scrivi `server/tenants/servizio.ts`**

```ts
// server/tenants/servizio.ts
// Servizio di dominio del tenant (WS1, spec §6). Unico punto che crea
// tenant, sedi e proprietari fuori dai router: lo usano il boot, il ciclo
// dei comandi e, dal WS6, il pannello del Platform Admin.
import { conTransazioneStoreAtomica } from "../_core/persistence";
import { interruttoreAttivo } from "../platform/interruttori";
import { creaSedeInterna, getSediPersistedStore, sediDelTenant } from "../routers/sedi";
import { creaUtenteInterno, getUtentiPersistedStore, getUtentiStore } from "../routers/utenti";
import { RUOLO_PROPRIETARIO, TENANT_PREDEFINITO_ID } from "./costanti";
import { schemaPayloadCrea, schemaPayloadProprietario, schemaPayloadStato } from "./comandi";
import { contaPresidi, motivoRifiutoPresidio, ruoliDi, slugValido, type UtentePresidio } from "./regole";
import { getTenantRepository } from "./repository";
import { attoreTesto, type Attore, type TenantComando, type TenantRecord } from "./tipi";

export type CreaTenantInput = {
  slug: string;
  nome: string;
  sede: { nome: string; citta?: string | null };
  proprietario: {
    nome: string;
    cognome: string;
    email: string;
    telefono?: string | null;
    passwordHash: string;
  };
};

export type EsitoCrea = {
  tenant: TenantRecord;
  sedeId: number;
  utenteId: number;
  creatoOra: boolean;
};

function presidio(u: any): UtentePresidio {
  return {
    id: u.id,
    attivo: Boolean(u.attivo),
    ruoli: ruoliDi(u),
    tenantId: typeof u.tenantId === "number" ? u.tenantId : TENANT_PREDEFINITO_ID,
  };
}

function utenteDelTenant(tenantId: number, utenteId: number): any {
  const utente = getUtentiStore().find(
    (u: any) => u.id === utenteId && presidio(u).tenantId === tenantId
  );
  if (!utente) throw new Error(`Utente ${utenteId} inesistente nel tenant ${tenantId}`);
  return utente;
}

function tenantEsistente(tenantId: number): TenantRecord {
  const tenant = getTenantRepository().perId(tenantId);
  if (!tenant) throw new Error(`Tenant ${tenantId} inesistente`);
  return tenant;
}

function tenantDaSlug(slug: string): TenantRecord {
  const tenant = getTenantRepository().perSlug(slug);
  if (!tenant) throw new Error(`Tenant ${slug} inesistente`);
  return tenant;
}

/** Idempotente per slug: completa ciò che manca (sede, proprietario) e non duplica. */
export async function crea(input: CreaTenantInput, attore: Attore): Promise<EsitoCrea> {
  if (!slugValido(input.slug)) throw new Error(`Slug non valido: ${input.slug}`);
  const repo = getTenantRepository();
  let tenant = repo.perSlug(input.slug);
  let creatoOra = false;
  if (!tenant) {
    tenant = await repo.inserisci({ slug: input.slug, nome: input.nome });
    creatoOra = true;
  }
  const tenantId = tenant.id;
  const utenti = getUtentiStore();
  const email = input.proprietario.email.toLowerCase();
  let utente: any = utenti.find((u: any) => u.email.toLowerCase() === email) ?? null;
  if (utente && presidio(utente).tenantId !== tenantId) {
    throw new Error("Email già in uso da un'altra azienda");
  }
  let sedeId: number | null = sediDelTenant(tenantId)[0]?.id ?? null;
  let utenteCreato = false;

  await conTransazioneStoreAtomica(
    [getSediPersistedStore(), getUtentiPersistedStore()],
    async commit => {
      if (sedeId == null) {
        sedeId = creaSedeInterna({
          tenantId,
          nome: input.sede.nome,
          citta: input.sede.citta ?? null,
        }).id;
      }
      if (!utente) {
        utente = creaUtenteInterno({
          tenantId,
          nome: input.proprietario.nome,
          cognome: input.proprietario.cognome,
          email: input.proprietario.email,
          telefono: input.proprietario.telefono ?? null,
          ruoli: [RUOLO_PROPRIETARIO, "direzione"],
          sediIds: [sedeId],
          passwordHash: input.proprietario.passwordHash,
        });
        utenteCreato = true;
      }
      await commit();
    }
  );

  if (creatoOra) {
    await repo.registraEvento({
      tenantId,
      tipo: "creato",
      attore: attoreTesto(attore),
      dettagli: { slug: input.slug, nome: input.nome, sedeId },
    });
  }
  if (utenteCreato) {
    await repo.registraEvento({
      tenantId,
      tipo: "proprietario_assegnato",
      attore: attoreTesto(attore),
      dettagli: { utenteId: utente.id, primo: true },
    });
  }
  return { tenant, sedeId: sedeId!, utenteId: utente.id, creatoOra };
}

export async function sospendi(tenantId: number, motivo: string, attore: Attore): Promise<TenantRecord> {
  tenantEsistente(tenantId);
  const repo = getTenantRepository();
  const tenant = await repo.aggiornaStato(tenantId, "sospeso", motivo);
  await repo.registraEvento({ tenantId, tipo: "sospeso", attore: attoreTesto(attore), motivo });
  return tenant;
}

export async function riattiva(tenantId: number, motivo: string, attore: Attore): Promise<TenantRecord> {
  tenantEsistente(tenantId);
  const repo = getTenantRepository();
  const tenant = await repo.aggiornaStato(tenantId, "attivo", motivo);
  await repo.registraEvento({ tenantId, tipo: "riattivato", attore: attoreTesto(attore), motivo });
  return tenant;
}

export async function assegnaProprietario(tenantId: number, utenteId: number, attore: Attore): Promise<void> {
  tenantEsistente(tenantId);
  const utente = utenteDelTenant(tenantId, utenteId);
  const ruoli = ruoliDi(utente);
  if (ruoli.includes(RUOLO_PROPRIETARIO)) return;
  if (ruoli.length >= 3) throw new Error(`L'utente ${utenteId} ha già tre ruoli: liberane uno prima`);
  utente.ruoli = [...ruoli, RUOLO_PROPRIETARIO];
  utente.updatedAt = new Date();
  getUtentiPersistedStore().save();
  await getTenantRepository().registraEvento({
    tenantId,
    tipo: "proprietario_assegnato",
    attore: attoreTesto(attore),
    dettagli: { utenteId },
  });
}

export async function revocaProprietario(tenantId: number, utenteId: number, attore: Attore): Promise<void> {
  tenantEsistente(tenantId);
  const utente = utenteDelTenant(tenantId, utenteId);
  const ruoli = ruoliDi(utente);
  if (!ruoli.includes(RUOLO_PROPRIETARIO)) return;
  const dopo = { ...presidio(utente), ruoli: ruoli.filter(r => r !== RUOLO_PROPRIETARIO) };
  const motivo = motivoRifiutoPresidio(presidio(utente), dopo, getUtentiStore().map(presidio));
  if (motivo) throw new Error(motivo);
  utente.ruoli = dopo.ruoli;
  utente.updatedAt = new Date();
  getUtentiPersistedStore().save();
  await getTenantRepository().registraEvento({
    tenantId,
    tipo: "proprietario_revocato",
    attore: attoreTesto(attore),
    dettagli: { utenteId },
  });
}

/**
 * Al boot con interruttore acceso (spec §4.3): tenant 1 seminato; ogni tenant
 * senza proprietari attivi dà il ruolo alla prima direzione attiva (id più
 * basso) con meno di 3 ruoli; altrimenti lo dice nel log.
 */
export async function assicuraTenantPredefinito(): Promise<void> {
  const repo = getTenantRepository();
  await repo.assicuraTenantPredefinito();
  const utenti = getUtentiStore();
  for (const tenant of repo.tutti()) {
    if (contaPresidi(utenti.map(presidio), tenant.id).proprietari > 0) continue;
    const candidato = utenti
      .filter((u: any) => {
        const p = presidio(u);
        return p.tenantId === tenant.id && p.attivo && p.ruoli.includes("direzione") && p.ruoli.length < 3;
      })
      .sort((a: any, b: any) => a.id - b.id)[0];
    if (!candidato) {
      console.warn(
        `[tenants] tenant ${tenant.id} (${tenant.slug}) senza proprietario: usa \`pnpm tenant proprietario --slug=${tenant.slug} --email=… --assegna --scrivi\``
      );
      continue;
    }
    candidato.ruoli = [...ruoliDi(candidato), RUOLO_PROPRIETARIO];
    candidato.updatedAt = new Date();
    getUtentiPersistedStore().save();
    await repo.registraEvento({
      tenantId: tenant.id,
      tipo: "proprietario_assegnato",
      attore: attoreTesto({ tipo: "boot" }),
      dettagli: { utenteId: candidato.id, ripiego: true },
    });
    console.log(`[tenants] tenant ${tenant.id}: proprietario di ripiego = utente ${candidato.id}`);
  }
  const t1 = repo.perId(TENANT_PREDEFINITO_ID);
  const utentiT1 = utenti.filter((u: any) => presidio(u).tenantId === TENANT_PREDEFINITO_ID).length;
  console.log(
    `[tenants] tenant ${TENANT_PREDEFINITO_ID} (${t1?.slug}) pronto: ${utentiT1} utenti, ${sediDelTenant(TENANT_PREDEFINITO_ID).length} sedi`
  );
}

async function eseguiComando(comando: TenantComando): Promise<Record<string, unknown>> {
  const attore: Attore = { tipo: "script", nome: comando.richiestoDa };
  try {
    switch (comando.tipo) {
      case "crea": {
        const p = schemaPayloadCrea.parse(comando.payload);
        const e = await crea(p, attore);
        return { tenantId: e.tenant.id, sedeId: e.sedeId, utenteId: e.utenteId, creatoOra: e.creatoOra };
      }
      case "sospendi":
      case "riattiva": {
        const p = schemaPayloadStato.parse(comando.payload);
        const id = comando.tenantId ?? tenantDaSlug(p.slug).id;
        const t = comando.tipo === "sospendi" ? await sospendi(id, p.motivo, attore) : await riattiva(id, p.motivo, attore);
        return { tenantId: t.id, stato: t.stato };
      }
      case "assegna_proprietario":
      case "revoca_proprietario": {
        const p = schemaPayloadProprietario.parse(comando.payload);
        const id = comando.tenantId ?? tenantDaSlug(p.slug).id;
        const utente = getUtentiStore().find(
          (u: any) => u.email.toLowerCase() === p.email.toLowerCase() && presidio(u).tenantId === id
        );
        if (!utente) throw new Error(`Nessun utente ${p.email} nel tenant ${id}`);
        if (comando.tipo === "assegna_proprietario") await assegnaProprietario(id, utente.id, attore);
        else await revocaProprietario(id, utente.id, attore);
        return { tenantId: id, utenteId: utente.id };
      }
    }
  } catch (e) {
    const tenantId = comando.tenantId ?? getTenantRepository().perSlug(String((comando.payload as any)?.slug ?? ""))?.id;
    if (tenantId != null) {
      await getTenantRepository().registraEvento({
        tenantId,
        tipo: "comando_fallito",
        attore: attoreTesto(attore),
        motivo: e instanceof Error ? e.message : String(e),
        dettagli: { comandoId: comando.id, tipo: comando.tipo },
      });
    }
    throw e;
  }
}

/** Solo con interruttore acceso; un comando alla volta, senza retry automatico. */
export async function eseguiComandiInAttesa(): Promise<{ eseguiti: number; falliti: number }> {
  let eseguiti = 0;
  let falliti = 0;
  if (!interruttoreAttivo("multiAzienda")) return { eseguiti, falliti };
  const repo = getTenantRepository();
  for (let giro = 0; giro < 50; giro++) {
    const esito = await repo.prendiEdEsegui(eseguiComando);
    if (esito === "nessuno") break;
    if (esito === "eseguito") eseguiti++;
    else falliti++;
  }
  return { eseguiti, falliti };
}
```

- [ ] **Step 5: Esegui i test**

Run: `pnpm vitest run server/tenants && pnpm check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/tenants/comandi.ts server/tenants/comandi.test.ts server/tenants/servizio.ts server/tenants/servizio.test.ts
git commit -m "feat(tenant): servizio di dominio — crea idempotente, sospendi/riattiva, proprietari, seed del tenant 1, esecuzione dei comandi

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Script CLI `pnpm tenant`

**Files:**
- Create: `server/tenants/cli.ts` (parsing puro), `scripts/tenant.ts`
- Modify: `package.json` (scripts), `.env.example`
- Test: `server/tenants/cli.test.ts`

**Interfaces:**
- Consumes: `getTenantRepository`, `schemaPayload*`, `richiestoDa`, `hashPassword`, `interruttoreAttivo`, `kvSql`.
- Produces: `opzioni(argv): { sotto: string | null; valori: Record<string, string>; flag: Set<string> }`; `anteprima(comando)` che maschera `passwordHash`; comando `pnpm tenant elenco|crea|stato|proprietario`.

- [ ] **Step 1: Scrivi il test che fallisce**

```ts
// server/tenants/cli.test.ts
import { describe, expect, it } from "vitest";
import { anteprima, opzioni } from "./cli";

describe("opzioni della CLI", () => {
  it("legge sottocomando, --chiave=valore e flag", () => {
    const o = opzioni(["node", "tenant.ts", "crea", "--slug=acme", "--nome=Acme Infissi", "--scrivi", "--attendi"]);
    expect(o.sotto).toBe("crea");
    expect(o.valori).toEqual({ slug: "acme", nome: "Acme Infissi" });
    expect(o.flag.has("scrivi")).toBe(true);
    expect(o.flag.has("attendi")).toBe(true);
    expect(opzioni(["node", "tenant.ts"]).sotto).toBeNull();
  });

  it("l'anteprima non mostra mai l'hash della password", () => {
    const testo = anteprima({
      tipo: "crea",
      tenantId: null,
      payload: { slug: "acme", proprietario: { email: "m@acme.it", passwordHash: "scrypt$32768$aa$bb" } },
    });
    expect(testo).toContain('"slug": "acme"');
    expect(testo).not.toContain("scrypt$");
    expect(testo).toContain("<hash>");
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `pnpm vitest run server/tenants/cli.test.ts`
Expected: FAIL, modulo inesistente.

- [ ] **Step 3: Scrivi `server/tenants/cli.ts`**

```ts
// server/tenants/cli.ts — parti pure dello script `pnpm tenant`.
import type { TipoComando } from "./tipi";

export type Opzioni = {
  sotto: string | null;
  valori: Record<string, string>;
  flag: Set<string>;
};

export function opzioni(argv: readonly string[]): Opzioni {
  const [, , sotto = null, ...resto] = argv;
  const valori: Record<string, string> = {};
  const flag = new Set<string>();
  for (const arg of resto) {
    if (!arg.startsWith("--")) continue;
    const corpo = arg.slice(2);
    const uguale = corpo.indexOf("=");
    if (uguale === -1) flag.add(corpo);
    else valori[corpo.slice(0, uguale)] = corpo.slice(uguale + 1);
  }
  return { sotto: sotto && !sotto.startsWith("--") ? sotto : null, valori, flag };
}

export function anteprima(comando: {
  tipo: TipoComando;
  tenantId: number | null;
  payload: Record<string, unknown>;
}): string {
  const payload: Record<string, unknown> = { ...comando.payload };
  const proprietario = payload.proprietario as Record<string, unknown> | undefined;
  if (proprietario && "passwordHash" in proprietario) {
    payload.proprietario = { ...proprietario, passwordHash: "<hash>" };
  }
  return JSON.stringify({ tipo: comando.tipo, tenantId: comando.tenantId, payload }, null, 2);
}
```

- [ ] **Step 4: Scrivi `scripts/tenant.ts`**

```ts
// Operatore → control plane del tenant (WS1). Lo script parla SOLO con il
// database: accoda un comando in `tenant_comandi` e il server vivo lo esegue
// (al boot e ogni 30 s, con FLAG_MULTI_AZIENDA acceso). Mai scritture sugli
// store JSONB da qui: il server riscrive i blob interi e le cancellerebbe.
//
//   pnpm tenant elenco
//   pnpm tenant crea --slug=acme --nome="Acme Infissi" --sede="Acme Infissi" \
//        --email=titolare@acme.it --nome-utente=Mario --cognome=Rossi [--citta=Sarzana] [--scrivi] [--attendi]
//   pnpm tenant stato --slug=acme --sospendi|--riattiva --motivo="…" [--anche-tenant-1] [--scrivi] [--attendi]
//   pnpm tenant proprietario --slug=acme --email=m.rossi@acme.it --assegna|--revoca [--scrivi] [--attendi]
//
// Password del proprietario: TENANT_PROPRIETARIO_PASSWORD nell'env o prompt
// nascosto; viene hashata qui e mai scritta in chiaro. Senza --scrivi mostra
// l'anteprima e non tocca nulla. Runbook: docs/runbooks/multi-azienda.md.

import "dotenv/config";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { hashPassword } from "../server/_core/password";
import { kvSql } from "../server/_core/persistence";
import { interruttoreAttivo } from "../server/platform/interruttori";
import { anteprima, opzioni } from "../server/tenants/cli";
import {
  richiestoDa,
  schemaPayloadCrea,
  schemaPayloadProprietario,
  schemaPayloadStato,
} from "../server/tenants/comandi";
import { TENANT_PREDEFINITO_ID } from "../server/tenants/costanti";
import { getTenantRepository } from "../server/tenants/repository";
import type { TipoComando } from "../server/tenants/tipi";

const USO =
  "Uso: pnpm tenant elenco | crea | stato | proprietario (vedi docs/runbooks/multi-azienda.md)";

function chiediNascosto(domanda: string): Promise<string> {
  return new Promise(resolve => {
    const muto = new Writable({ write(_chunk, _enc, cb) { cb(); } });
    const rl = createInterface({ input: process.stdin, output: muto, terminal: true });
    process.stdout.write(domanda);
    rl.question("", risposta => {
      rl.close();
      process.stdout.write("\n");
      resolve(risposta);
    });
  });
}

async function passwordProprietario(): Promise<string> {
  const env = process.env.TENANT_PROPRIETARIO_PASSWORD?.trim();
  if (env) return env;
  const digitata = (await chiediNascosto("Password del proprietario (almeno 12 caratteri): ")).trim();
  if (digitata.length < 12) throw new Error("La password deve avere almeno 12 caratteri");
  return digitata;
}

async function attendi(id: number): Promise<number> {
  const repo = getTenantRepository();
  const scadenza = Date.now() + 90_000;
  while (Date.now() < scadenza) {
    const c = await repo.comando(id);
    if (c && c.stato !== "in_attesa") {
      console.log(`Comando #${id}: ${c.stato} ${JSON.stringify(c.esito)}`);
      return c.stato === "eseguito" ? 0 : 1;
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  console.error(`Comando #${id} ancora in attesa dopo 90 s: il server è acceso con FLAG_MULTI_AZIENDA=on?`);
  return 1;
}

async function main(): Promise<number> {
  if (!kvSql) {
    console.error("DATABASE_URL mancante: lo script parla solo con il database.");
    return 2;
  }
  const { sotto, valori, flag } = opzioni(process.argv);
  const obbligatoria = (nome: string): string => {
    const v = valori[nome];
    if (!v) throw new Error(`Manca --${nome}=…\n${USO}`);
    return v;
  };
  const repo = getTenantRepository();
  await repo.ensureSchema();
  await repo.caricaCache();

  if (sotto === "elenco") {
    for (const t of repo.tutti()) console.log(`${t.id}\t${t.slug}\t${t.stato}\t${t.nome}`);
    const attesa = await repo.comandiInAttesa();
    console.log(`${attesa.length} comandi in attesa`);
    for (const c of attesa) {
      console.log(`  #${c.id} ${c.tipo} tenant=${c.tenantId ?? "-"} da ${c.richiestoDa} il ${c.createdAt.toISOString()}`);
    }
    return 0;
  }

  let tipo: TipoComando;
  let tenantId: number | null = null;
  let payload: Record<string, unknown>;

  if (sotto === "crea") {
    const password = await passwordProprietario();
    payload = schemaPayloadCrea.parse({
      slug: obbligatoria("slug"),
      nome: obbligatoria("nome"),
      sede: { nome: valori.sede ?? obbligatoria("nome"), citta: valori.citta ?? null },
      proprietario: {
        nome: obbligatoria("nome-utente"),
        cognome: obbligatoria("cognome"),
        email: obbligatoria("email"),
        telefono: valori.telefono ?? null,
        passwordHash: hashPassword(password),
      },
    });
    tipo = "crea";
  } else if (sotto === "stato") {
    const slug = obbligatoria("slug");
    const t = repo.perSlug(slug);
    if (!t) throw new Error(`Tenant ${slug} inesistente`);
    if (flag.has("sospendi") === flag.has("riattiva")) throw new Error("Indica --sospendi oppure --riattiva");
    tipo = flag.has("sospendi") ? "sospendi" : "riattiva";
    tenantId = t.id;
    payload = schemaPayloadStato.parse({ slug, motivo: obbligatoria("motivo") });
    if (tipo === "sospendi" && t.id === TENANT_PREDEFINITO_ID && !flag.has("anche-tenant-1")) {
      throw new Error("Sospendere il tenant 1 mette Ruffino Group in sola lettura: aggiungi --anche-tenant-1 per confermare.");
    }
  } else if (sotto === "proprietario") {
    const slug = obbligatoria("slug");
    const t = repo.perSlug(slug);
    if (!t) throw new Error(`Tenant ${slug} inesistente`);
    if (flag.has("assegna") === flag.has("revoca")) throw new Error("Indica --assegna oppure --revoca");
    tipo = flag.has("assegna") ? "assegna_proprietario" : "revoca_proprietario";
    tenantId = t.id;
    payload = schemaPayloadProprietario.parse({ slug, email: obbligatoria("email") });
  } else {
    console.error(USO);
    return 2;
  }

  console.log(anteprima({ tipo, tenantId, payload }));
  if (!flag.has("scrivi")) {
    console.log("Anteprima: rilancia con --scrivi per accodare il comando.");
    return 0;
  }
  if (!interruttoreAttivo("multiAzienda")) {
    console.warn("Attenzione: qui FLAG_MULTI_AZIENDA risulta spento; se lo è anche sul server, il comando resterà in attesa.");
  }
  const comando = await repo.accodaComando({ tipo, tenantId, payload, richiestoDa: richiestoDa() });
  console.log(`Comando #${comando.id} accodato (${tipo}).`);
  return flag.has("attendi") ? attendi(comando.id) : 0;
}

main().then(
  async codice => {
    await kvSql?.end({ timeout: 5 });
    process.exit(codice);
  },
  async errore => {
    console.error("tenant:", errore?.message ?? errore);
    await kvSql?.end({ timeout: 5 });
    process.exit(1);
  }
);
```

In `package.json`, dopo `"pattuiti:reset"`: `"tenant": "tsx scripts/tenant.ts",`.
In `.env.example`, dopo il blocco di `FLAG_MULTI_AZIENDA`:

```text
# Password del primo proprietario per `pnpm tenant crea` (in alternativa al prompt). Mai committarla.
# TENANT_PROPRIETARIO_PASSWORD=
```

- [ ] **Step 5: Esegui i test e prova lo script senza database**

Run: `pnpm vitest run server/tenants/cli.test.ts && pnpm check && DATABASE_URL= pnpm tenant elenco; echo "exit=$?"`
Expected: PASS; lo script stampa «DATABASE_URL mancante…» ed esce con 2.

- [ ] **Step 6: Commit**

```bash
git add server/tenants/cli.ts server/tenants/cli.test.ts scripts/tenant.ts package.json .env.example
git commit -m "feat(tenant): script pnpm tenant — accoda comandi crea/stato/proprietario, anteprima senza --scrivi, password hashata mai in chiaro

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Boot del modulo e ordine di avvio

**Files:**
- Create: `server/tenants/boot.ts`
- Modify: `server/_core/index.ts:38-41`
- Modify: `docs/runbooks/piattaforma-recovery.md` (sezione «Ordine di boot»)
- Test: `server/tenants/boot.test.ts`

**Interfaces:**
- Consumes: repository, `assicuraTenantPredefinito`, `eseguiComandiInAttesa`, `INTERVALLO_COMANDI_MS`.
- Produces: `avviaTenants(): Promise<void>`, `fermaTenants(): void`.

- [ ] **Step 1: Scrivi il test che fallisce**

```ts
// server/tenants/boot.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { avviaTenants, fermaTenants } from "./boot";
import { INTERVALLO_COMANDI_MS } from "./costanti";
import { getTenantRepository, resetTenantRepositoryForTesting } from "./repository";

beforeEach(() => {
  resetTenantRepositoryForTesting();
  vi.useFakeTimers();
});

afterEach(() => {
  fermaTenants();
  vi.useRealTimers();
  delete process.env.FLAG_MULTI_AZIENDA;
});

describe("avviaTenants", () => {
  it("acceso: semina il tenant 1 ed esegue i comandi al boot e ogni 30 s", async () => {
    const repo = getTenantRepository();
    await avviaTenants();
    expect(repo.perId(1)?.slug).toBe("ruffino-group");
    await repo.accodaComando({
      tipo: "sospendi",
      tenantId: 1,
      payload: { slug: "ruffino-group", motivo: "prova del boot" },
      richiestoDa: "script:tenant@test",
    });
    await vi.advanceTimersByTimeAsync(INTERVALLO_COMANDI_MS + 10);
    expect(repo.perId(1)?.stato).toBe("sospeso");
  });

  it("spento: schema e cache, nessun seed, comandi lasciati in attesa", async () => {
    process.env.FLAG_MULTI_AZIENDA = "off";
    const repo = getTenantRepository();
    await repo.accodaComando({
      tipo: "sospendi",
      tenantId: 1,
      payload: { slug: "ruffino-group", motivo: "resta in attesa" },
      richiestoDa: "script:tenant@test",
    });
    await avviaTenants();
    expect(repo.perId(1)).toBeNull();
    expect((await repo.comandiInAttesa()).length).toBe(1);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `pnpm vitest run server/tenants/boot.test.ts`
Expected: FAIL, modulo inesistente.

- [ ] **Step 3: Scrivi `server/tenants/boot.ts` e agganciane l'avvio**

```ts
// server/tenants/boot.ts
// Avvio del modulo tenant, subito dopo bootstrapAll(): schema del control
// plane, cache, e — con l'interruttore acceso — seed del tenant 1,
// proprietari di ripiego, comandi in attesa e il ciclo ogni 30 s. In
// produzione un fallimento dello schema ferma l'avvio (come policy ed eventi).
import { interruttoreAttivo } from "../platform/interruttori";
import { INTERVALLO_COMANDI_MS } from "./costanti";
import { getTenantRepository } from "./repository";
import { assicuraTenantPredefinito, eseguiComandiInAttesa } from "./servizio";

let intervallo: NodeJS.Timeout | null = null;

function riferisci(esito: { eseguiti: number; falliti: number }) {
  if (esito.eseguiti || esito.falliti) {
    console.log(`[tenants] comandi: ${esito.eseguiti} eseguiti, ${esito.falliti} falliti`);
  }
}

export async function avviaTenants(): Promise<void> {
  const repo = getTenantRepository();
  await repo.ensureSchema();
  await repo.caricaCache();
  if (!interruttoreAttivo("multiAzienda")) {
    const attesa = await repo.comandiInAttesa();
    console.log(
      `[tenants] FLAG_MULTI_AZIENDA spento: contesto mono-azienda` +
        (attesa.length ? `, ${attesa.length} comandi in attesa non eseguiti` : "")
    );
    return;
  }
  await assicuraTenantPredefinito();
  riferisci(await eseguiComandiInAttesa());
  fermaTenants();
  intervallo = setInterval(() => {
    eseguiComandiInAttesa()
      .then(riferisci)
      .catch(errore => console.error("[tenants] ciclo comandi:", errore));
  }, INTERVALLO_COMANDI_MS);
  intervallo.unref();
}

export function fermaTenants(): void {
  if (intervallo) {
    clearInterval(intervallo);
    intervallo = null;
  }
}
```

In `server/_core/index.ts`, subito dopo `await bootstrapAll();` (riga 40):

```ts
  // Tenant (WS1): schema del control plane, cache, seed del tenant 1 e ciclo
  // dei comandi. Prima di tutto il resto: il contesto di ogni richiesta lo usa.
  const { avviaTenants } = await import("../tenants/boot");
  await avviaTenants();
```

In `docs/runbooks/piattaforma-recovery.md`, nella lista «Ordine di boot», dopo il punto 1 inserisci:

```markdown
1-bis. `avviaTenants()` (WS1): `ensureSchema` di `tenants`, `tenant_eventi`,
   `tenant_comandi` e cache dei tenant; con `FLAG_MULTI_AZIENDA=on` anche il
   seed del tenant 1 «Ruffino Group», il proprietario di ripiego e i comandi
   in attesa (poi ogni 30 s). Log `[tenants] …`. Spento: solo schema e cache.
   Runbook: `docs/runbooks/multi-azienda.md`.
```

- [ ] **Step 4: Esegui i test e il boot locale**

Run: `pnpm vitest run server/tenants/boot.test.ts && pnpm check`
Expected: PASS. Poi avvia il server in locale (`pnpm dev` dall'anteprima del progetto, senza `DATABASE_URL` va in memoria) e verifica nel log le righe `[tenants] tenant 1 (ruffino-group) pronto: … utenti, … sedi`.

- [ ] **Step 5: Commit**

```bash
git add server/tenants/boot.ts server/tenants/boot.test.ts server/_core/index.ts docs/runbooks/piattaforma-recovery.md
git commit -m "feat(tenant): avvio del modulo tenants dopo bootstrapAll — schema, cache, seed, comandi ogni 30 s

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Tars con il tenant

**Files:**
- Modify: `server/tars/strumenti/tipi.ts:42-45` (`ContestoRun`)
- Modify: `server/tars/contesto.ts` (intero file)
- Modify: `server/tars/azioni/policy.ts:7-22` (`autorizzata`)
- Modify: `server/tars/strumenti/comune.ts:13-27` (`contestoServer`)
- Modify: i file che chiamano `costruisciContesto(` fuori dai test, e i 5 test con un `ContestoRun` letterale (`server/tars/azioni/registry.test.ts`, `server/tars/azioni/executions.test.ts`, `server/tars/conversazione/context.test.ts`, `server/tars/strumenti/archivioAllegati.test.ts`, `server/tars/strumenti/allegati.test.ts`)
- Test: `server/tars/contesto.tenant.test.ts`

**Interfaces:**
- Produces: `ContestoRun.tenantId: number`; `costruisciContesto(ctx: Pick<TrpcContext, "user" | "sedeId" | "sediIds" | "tenantId">)`; `contestoServer(contesto): Pick<TrpcContext, "user" | "sedeId" | "sediIds" | "tenantId" | "tenant">`.

- [ ] **Step 1: Scrivi il test che fallisce**

```ts
// server/tars/contesto.tenant.test.ts
import { describe, expect, it } from "vitest";
import { contestoDiProva } from "../_core/contestoDiProva";
import { catalogoAzioniPerContesto } from "./azioni/policy";
import { costruisciContesto } from "./contesto";
import { contestoServer } from "./strumenti/comune";

describe("ContestoRun con il tenant (WS1)", () => {
  it("porta tenantId e il fingerprint cambia col tenant", async () => {
    const a = await costruisciContesto(contestoDiProva({ utenteId: 97801, sedeId: 97811, tenantId: 1 }));
    const b = await costruisciContesto(contestoDiProva({ utenteId: 97801, sedeId: 97811, tenantId: 2 }));
    expect(a.tenantId).toBe(1);
    expect(b.tenantId).toBe(2);
    expect(a.capabilityFingerprint).not.toBe(b.capabilityFingerprint);
  });

  it("senza sede o senza azienda la sessione è rifiutata, niente fallback", async () => {
    await expect(
      costruisciContesto(contestoDiProva({ utenteId: 97801, sedeId: null, tenantId: 1 }))
    ).rejects.toThrow(/sessione senza sede/);
    await expect(
      costruisciContesto(contestoDiProva({ utenteId: 97801, sedeId: 97811, tenantId: null }))
    ).rejects.toThrow(/sessione senza azienda/);
  });

  it("il catalogo è vuoto senza un tenant valido e il ctx di dominio porta il tenant", async () => {
    const c = await costruisciContesto(contestoDiProva({ utenteId: 97801, sedeId: 97811, tenantId: 1 }));
    expect(catalogoAzioniPerContesto(c).length).toBeGreaterThan(0);
    expect(catalogoAzioniPerContesto({ ...c, tenantId: 0 })).toEqual([]);
    expect(contestoServer(c).tenantId).toBe(1);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `pnpm vitest run server/tars/contesto.tenant.test.ts`
Expected: FAIL (`tenantId` undefined, fallback sulla sede predefinita).

- [ ] **Step 3: Modifica Tars**

`server/tars/strumenti/tipi.ts`, in `ContestoRun` subito dopo `utenteId: number;`:

```ts
  /** Azienda della sessione (WS1): vincolo del catalogo, mai fonte di autorità del modello. */
  tenantId: number;
```

`server/tars/contesto.ts` diventa:

```ts
// Contesto del run (T1): principal, tenant, sede, capability effettive e il
// loro fingerprint (entra nelle chiavi di cache C0/C1/C2: due utenti con
// perimetri diversi non condividono MAI una riga di cache).

import { createHash } from "node:crypto";
import type { TrpcContext } from "../_core/context";
import { CAPABILITIES } from "../authz/capabilities";
import { effectiveCapabilitySet } from "../authz/enforcement";
import type { ContestoRun } from "./strumenti/tipi";

function ruoliDi(user: any): string[] {
  if (Array.isArray(user?.ruoli) && user.ruoli.length) return user.ruoli;
  if (user?.ruolo) return [user.ruolo];
  if (user?.role === "admin") return ["direzione"];
  return [];
}

export async function costruisciContesto(
  ctx: Pick<TrpcContext, "user" | "sedeId" | "sediIds" | "tenantId">
): Promise<ContestoRun> {
  const utenteId = ctx.user?.id;
  if (utenteId == null) {
    throw new Error("UNAUTHORIZED: sessione non valida.");
  }
  // Niente fallback (WS1): una sessione senza azienda o senza sede non
  // costruisce un contesto, non ripiega sulla sede 1.
  if (ctx.tenantId == null) {
    throw new Error("UNAUTHORIZED: sessione senza azienda.");
  }
  if (ctx.sedeId == null) {
    throw new Error("UNAUTHORIZED: sessione senza sede.");
  }
  const tenantId = ctx.tenantId;
  const sedeId = ctx.sedeId;
  const capability = await effectiveCapabilitySet(ctx, CAPABILITIES);
  const ruoli = ruoliDi(ctx.user);
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        tenant: tenantId,
        sede: sedeId,
        ruoli: [...ruoli].sort(),
        capability: [...capability].sort(),
      })
    )
    .digest("hex")
    .slice(0, 16);
  return {
    utenteId,
    tenantId,
    sedeId,
    ruoli,
    direzione: ruoli.includes("direzione"),
    capability,
    capabilityFingerprint: fingerprint,
    lingua: "it",
    fuso: "Europe/Rome",
  };
}
```

`server/tars/azioni/policy.ts`, in `autorizzata`, subito dopo il controllo su `sedeId`:

```ts
  if (!Number.isInteger(contesto.tenantId) || contesto.tenantId <= 0) return false;
```

`server/tars/strumenti/comune.ts`, `contestoServer` diventa:

```ts
import { getTenantRepository } from "../../tenants/repository";

export function contestoServer(
  contesto: ContestoRun
): Pick<TrpcContext, "user" | "sedeId" | "sediIds" | "tenantId" | "tenant"> {
  return {
    user: {
      id: contesto.utenteId,
      role: contesto.direzione ? "admin" : "user",
      ruolo: contesto.ruoli[0] ?? null,
      ruoli: [...contesto.ruoli],
      name: `Tars per l'utente ${contesto.utenteId}`,
    } as any,
    tenantId: contesto.tenantId,
    // Il record serve alla guardia di sola lettura anche quando la mutation
    // parte da Tars e non dal client.
    tenant: getTenantRepository().perId(contesto.tenantId),
    sedeId: contesto.sedeId,
    sediIds: [contesto.sedeId],
  };
}
```

Chiamanti: `grep -rn "costruisciContesto(" server --include='*.ts' | grep -v "\.test\.ts"`. Chi passa un vero `TrpcContext` non cambia. Chi costruisce un contesto parziale per sede (worker: smistamento, analisi, follow-up, conferme) aggiunge `tenantId: tenantIdDellaSede(sedeId)` importando `tenantIdDellaSede` da `../tenants/contesto` (percorso relativo al file). Nei 5 test con un `ContestoRun` letterale aggiungi `tenantId: 1,` accanto a `utenteId:`. Poi `pnpm check` deve essere verde.

- [ ] **Step 4: Esegui i test**

Run: `pnpm vitest run server/tars/contesto.tenant.test.ts server/tars && pnpm check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/tars server/tenants
git commit -m "feat(tars): tenantId obbligatorio nel ContestoRun, niente fallback di sede, catalogo fail-closed sul tenant, ctx di dominio con il record

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Guardie strutturali

**Files:**
- Test: `server/tenants/confine.test.ts`

- [ ] **Step 1: Scrivi il test (deve passare subito: se fallisce, ha trovato una violazione da correggere)**

```ts
// server/tenants/confine.test.ts
// Guardie STRUTTURALI del tenant (spec WS1 §10.8), sul modello di
// server/tars/costi/confine.test.ts: leggono il sorgente e falliscono se
// qualcuno reintroduce un percorso che la spec vieta.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RADICE = join(__dirname, "..", "..");

function fileSorgente(cartelle: string[]): string[] {
  const trovati: string[] = [];
  const visita = (percorso: string) => {
    for (const voce of readdirSync(percorso)) {
      if (voce === "node_modules" || voce === "dist" || voce.startsWith(".")) continue;
      const completo = join(percorso, voce);
      if (statSync(completo).isDirectory()) visita(completo);
      else if (/\.(ts|tsx)$/.test(voce)) trovati.push(completo);
    }
  };
  for (const cartella of cartelle) visita(join(RADICE, cartella));
  return trovati;
}

const PRODUZIONE = fileSorgente(["server", "shared", "scripts"]).filter(f => !/\.test\.ts$/.test(f));
const relativo = (percorso: string) => percorso.slice(RADICE.length + 1);
const testo = (f: string) => readFileSync(f, "utf8");

describe("confine del tenant", () => {
  it("nessuno schema di input tRPC o di strumento Tars accetta tenantId o tenant", () => {
    const colpevoli = PRODUZIONE.filter(f => /\b(tenantId|tenant)\s*:\s*z\./.test(testo(f))).map(relativo);
    expect(colpevoli).toEqual([]);
  });

  it("INSERT INTO tenant* compare solo nel repository", () => {
    const scrittori = PRODUZIONE.filter(f => /INSERT INTO tenant/.test(testo(f))).map(relativo);
    expect(scrittori).toEqual([join("server", "tenants", "repository.ts")]);
  });

  it("portaChiusaPerTenant ha esattamente due chiamanti: la guardia e il login", () => {
    const chiamanti = PRODUZIONE.filter(
      f => testo(f).includes("portaChiusaPerTenant(") && !f.endsWith(join("tenants", "regole.ts"))
    )
      .map(relativo)
      .sort();
    expect(chiamanti).toEqual([join("server", "_core", "trpc.ts"), join("server", "routers.ts")]);
  });

  it("lo script tenant non importa router né store", () => {
    const script = testo(join(RADICE, "scripts", "tenant.ts"));
    expect(script).not.toMatch(/from "\.\.\/server\/routers/);
    expect(script).not.toMatch(/bootstrapAll/);
  });
});
```

- [ ] **Step 2: Esegui il test**

Run: `pnpm vitest run server/tenants/confine.test.ts`
Expected: PASS. Se «due chiamanti» trova un terzo file, quel file usa la porta chiusa fuori posto: torna alla spec §5.2 e togli la chiamata.

- [ ] **Step 3: Commit**

```bash
git add server/tenants/confine.test.ts
git commit -m "test(tenant): guardie strutturali — niente tenantId negli input, scritture solo nel repository, porta chiusa con due chiamanti

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Client — etichetta e opzione «Proprietario»

**Files:**
- Modify: `client/src/lib/roles.ts:8-15`
- Modify: `client/src/pages/UtentiList.tsx:49-57` (`RUOLI`), `:129` (query), `:597` e `:703` (usi di `RuoliFields`), `:861-905` (`RuoliFields`)
- Modify: `client/src/components/users/UserPermissionsDialog.tsx:26-34` (`ROLE_LABELS`)
- Modify: `client/src/components/users/CapabilityMatrix.tsx:61` (etichetta della capability)

- [ ] **Step 1: Aggiorna il tipo dei ruoli**

In `client/src/lib/roles.ts` aggiungi `| "proprietario"` in coda al tipo `Ruolo` (dopo `| "ordini"`), con il commento `// WS1: titolare dell'account azienda; visibile nel modulo solo ai proprietari`.

- [ ] **Step 2: Aggiorna `UtentiList.tsx`**

In `RUOLI` aggiungi in coda `{ value: "proprietario", label: "Proprietario" },`.

Accanto a `const stats = trpc.utenti.stats.useQuery();` (riga 129) aggiungi:

```tsx
  // Il ruolo proprietario compare solo a chi è già proprietario, con il
  // multi-azienda acceso: il confine vero resta il server (utenti.create/update).
  const mio = trpc.tenants.mio.useQuery();
  const mostraProprietario = mio.data?.proprietario === true && mio.data?.multiAzienda === true;
```

Nei due usi passa la prop: `<RuoliFields form={form} onToggle={toggleRuolo} prefisso="nuovo" mostraProprietario={mostraProprietario} />` e lo stesso con `prefisso="edit"`.

In `RuoliFields` aggiungi la prop al tipo (`mostraProprietario: boolean;`) e sostituisci `{RUOLI.map(r => {` con:

```tsx
        {RUOLI.filter(
          r => r.value !== "proprietario" || mostraProprietario || form.ruoli.includes("proprietario")
        ).map(r => {
```

- [ ] **Step 3: Aggiorna le etichette**

`UserPermissionsDialog.tsx`, in `ROLE_LABELS`: `proprietario: "Proprietario",`.
`CapabilityMatrix.tsx`, nella mappa delle capability accanto a `"tars.manage_policy"`: `"tenant.manage_proprietari": { label: "Nominare i proprietari", group: "Azienda" },`.

- [ ] **Step 4: Verifica**

Run: `pnpm check && pnpm build`
Expected: verde. Poi apri l'anteprima del progetto (dev server), accedi come direzione demo e apri `/utenti`: a 1440×900 e 390×844 il modulo «Nuovo utente» mostra sette ruoli per una direzione senza `proprietario`, otto per un proprietario; nessuno scroll orizzontale; console senza errori. Se il login demo non è disponibile all'agente, scrivilo nel commit e nel handoff come «non verificato a schermo».

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/roles.ts client/src/pages/UtentiList.tsx client/src/components/users/UserPermissionsDialog.tsx client/src/components/users/CapabilityMatrix.tsx
git commit -m "feat(client): ruolo ed etichetta Proprietario, opzione visibile solo ai proprietari con il multi-azienda acceso

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: Documentazione e chiusura

**Files:**
- Create: `docs/runbooks/multi-azienda.md`
- Modify: `documento_requisiti_infissi_ops.md` (testata, §3.2, §4.1, §28.1, §34.1, §60.9), `handoff.md`, `docs/tars/architettura-tars-v2.md`, `docs/superpowers/specs/2026-09-06-ws1-fondazione-tenant-design.md` (§3.1: `portaChiusaPerTenant` vive in `regole.ts`, non in `servizio.ts`)

- [ ] **Step 1: Scrivi il runbook**

```markdown
# Runbook multi-azienda (WS1 — fondazione tenant)

Spec: `docs/superpowers/specs/2026-09-06-ws1-fondazione-tenant-design.md`.
Modulo: `server/tenants/`. Interruttore: `FLAG_MULTI_AZIENDA` (fail-closed).

## Cosa fa, in una riga
Il tenant (azienda) esiste, è nel contesto di ogni richiesta, ha guardie e un
ruolo Proprietario. Ruffino Group è il tenant 1. Ogni altro tenant si ferma
alla «porta chiusa» finché il WS2 non rende tenant-aware gli archivi.

## Interruttore
- `FLAG_MULTI_AZIENDA=off` (default in produzione): il CRM di oggi. Tabelle,
  campi `tenantId` e cache esistono ma non guardano nessuno; i comandi
  restano in attesa; il ruolo `proprietario` non si aggiunge.
- `FLAG_MULTI_AZIENDA=on`: contesto con tenant, porta chiusa, sola lettura
  per i tenant sospesi, sede attiva obbligatoria, proprietario assegnabile
  dai proprietari, comandi eseguiti al boot e ogni 30 s.
- Rollback: rimetti `off` e riavvia. Nessun dato da toccare.

## Boot (log `[tenants]`)
`avviaTenants()` gira subito dopo `bootstrapAll()`: schema di `tenants`,
`tenant_eventi` (append-only con trigger), `tenant_comandi`; cache; con
l'interruttore acceso seed del tenant 1, proprietario di ripiego (la prima
direzione attiva con meno di 3 ruoli) e comandi in attesa. Righe attese:
`[tenants] tenant 1 (ruffino-group) pronto: N utenti, M sedi`.

## Comandi dell'operatore (`pnpm tenant …`)
Lo script parla solo col database e accoda comandi; il server li esegue.
Mai scritture sugli store con l'istanza viva.

    pnpm tenant elenco
    pnpm tenant crea --slug=acme --nome="Acme Infissi" --email=titolare@acme.it \
         --nome-utente=Mario --cognome=Rossi --scrivi --attendi
    pnpm tenant stato --slug=acme --sospendi --motivo="insoluto" --scrivi --attendi
    pnpm tenant stato --slug=acme --riattiva --motivo="pagato" --scrivi
    pnpm tenant proprietario --slug=acme --email=m.rossi@acme.it --assegna --scrivi

- Senza `--scrivi`: anteprima, nessuna scrittura. `--attendi`: aspetta l'esito fino a 90 s.
- Password del proprietario: `TENANT_PROPRIETARIO_PASSWORD` nell'env o prompt nascosto; hashata prima di accodare.
- Un comando fallito resta `errore` con il motivo in `esito` e un evento `comando_fallito`: correggi e riaccoda. Nessun retry automatico.
- Su Railway: `railway run pnpm tenant …`. Sospendere il tenant 1 richiede `--anche-tenant-1`.

## Verifica in sola lettura (prima e dopo l'accensione)

    SELECT id, slug, stato FROM tenants ORDER BY id;
    SELECT tipo, attore, created_at FROM tenant_eventi ORDER BY id DESC LIMIT 20;
    SELECT id, tipo, stato, richiesto_da FROM tenant_comandi WHERE stato = 'in_attesa';
    SELECT COUNT(*) FROM jsonb_array_elements((SELECT data FROM kv_store WHERE key = 'utenti')) u WHERE (u->>'tenantId') IS NULL;

L'ultima deve dare 0 dopo il primo boot col nuovo codice (backfill).

## Produzione, in ordine
1. Deploy con interruttore spento; verifica in sola lettura; nessun errore `[tenants]`.
2. Backup Drive riuscito nelle 24 ore.
3. `FLAG_MULTI_AZIENDA=on`, riavvio; log `[tenants] tenant 1 … pronto`, evento
   `proprietario_assegnato` per l'utente 1; `tenants.mio` dal client.
4. Nessun tenant 2 in produzione finché il WS2 non apre la porta.

## Errori che l'utente può vedere
- «L'azienda non è ancora attiva su questa installazione.» — porta chiusa (tenant ≠ 1).
- «Azienda sospesa: il gestionale è in sola lettura.» — mutation con tenant sospeso.
- «L'azienda non ha una sede attiva.» — tenant senza sedi attive.
- «Solo un proprietario può nominare o revocare un proprietario.»
- «Il ruolo proprietario richiede FLAG_MULTI_AZIENDA.»
```

- [ ] **Step 2: Aggiorna PRD e handoff**

PRD: nella testata porta la versione a 5.50 con «WS1 fondazione tenant su branch: …» e il «Prima: 5.49 - …» in coda; in §60.9 sostituisci «Piano da scrivere; nessun codice finché il piano non è approvato» con lo stato reale (branch, commit, cosa è verificato e cosa no); §3.2: «Con `FLAG_MULTI_AZIENDA` acceso l'utente viene riletto dallo store a ogni richiesta: cancellato o disattivato = non autenticato»; §4.1: `proprietario` ottavo ruolo con il rimando a §60.9; §28.1: le tre tabelle nuove; §34.1: «la sede porta `tenantId`; il tenant sopra la sede è §60.9».
`handoff.md`: nuovo blocco «Novità» in testa (stato del WS1: branch, task chiusi, verifiche fatte e non fatte, interruttore spento in produzione), riga `server/tenants/` nella mappa del codice (§3), passo nella checklist di deploy (§10), voce 21 aggiornata.
`docs/tars/architettura-tars-v2.md`: una riga nella sezione del `ContestoRun`: «`tenantId` obbligatorio dal WS1; nessun fallback di sede».
Spec WS1 §3.1: `portaChiusaPerTenant` è in `regole.ts` (pura), non in `servizio.ts`.

- [ ] **Step 3: Chiusura**

Run: `pnpm check && pnpm test && pnpm build`
Expected: tutto verde. Poi `git log --oneline origin/main..HEAD` per l'elenco dei commit e `git push -u origin feature/ws1-fondazione-tenant`. Il merge su `main` (= produzione, con l'interruttore spento) è una decisione della direzione: non farlo da qui.

- [ ] **Step 4: Commit**

```bash
git add docs/runbooks/multi-azienda.md documento_requisiti_infissi_ops.md handoff.md docs/tars/architettura-tars-v2.md docs/superpowers/specs/2026-09-06-ws1-fondazione-tenant-design.md
git commit -m "docs(tenant): runbook multi-azienda, PRD 5.50 (§60.9 stato del WS1), handoff, architettura Tars

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Autorevisione del piano (fatta il 06/09/2026)

**Copertura della spec WS1:**

| Spec | Task |
|---|---|
| §4.1 tabelle, trigger append-only, seed e `setval` | 4 |
| §4.2 `tenantId` su utenti e sedi, email unica, `sedePredefinita`, id globali | 5, 8 |
| §4.3 seed e proprietario di ripiego al boot | 9, 11 |
| §4.4 ruolo e capability, eccezione della direzione, niente override/deleghe | 3, 8 |
| §4.5 presìdi per tenant | 2, 8, 9 |
| §5.1 risoluzione del contesto, rilettura dell'utente, utenti OAuth | 5, 6 |
| §5.2 procedure e guardie, login | 7 |
| §5.3 isolamento del control plane, `sediIds` validate, chi nomina | 7, 8 |
| §5.4 catalogo degli errori | 2 (messaggi), 7, 8 |
| §6.1 servizio di dominio | 9 |
| §6.2 comandi | 4, 9, 11 |
| §6.3 script | 10 |
| §6.4 `tenants.mio` | 7 |
| §7 Tars | 12 |
| §8 interruttore, boot, rollback, produzione | 1, 11, 15 |
| §9 client | 14 |
| §10 test (1–9) | 6, 7, 8, 8, 9, 4, 12, 13, 3 |
| §11 documentazione | 11, 15 |

**Deviazioni dichiarate:** `portaChiusaPerTenant` vive in `regole.ts` (pura, senza dipendenze) invece che in `servizio.ts` (Task 15 allinea la spec); `motivoRifiutoPresidio` unifica le due guardie dell'ultimo presidio in una funzione pura.

**Segnaposto:** nessuno; ogni passo di codice ha il codice.

**Coerenza dei nomi:** `getTenantRepository`/`resetTenantRepositoryForTesting` (4, usati in 5–12); `contestoDiProva` (6, usato in 7, 8, 12); `creaSedeInterna`/`creaUtenteInterno`/`getSediPersistedStore`/`getUtentiPersistedStore`/`sediDelTenant`/`sedePredefinita` (5, usati in 8, 9); `MESSAGGI` (2, usati in 7, 8); `sessionProcedure` (7, usato dal router in 7); `tenantIdDellaSede` (5, usato in 12); `schemaPayload*`/`richiestoDa` (9, usati in 10); `avviaTenants`/`fermaTenants` (11).
