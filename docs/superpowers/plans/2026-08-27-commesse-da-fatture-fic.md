# Commesse da fatture FiC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Creare esattamente una commessa per ogni fattura emessa FiC non collegata, riusando il cliente corretto senza duplicati.

**Architecture:** Un servizio sede-scoped risolve il cliente con identità fiscale o intestazione esatta, poi crea la commessa tramite un helper di dominio condiviso. Ogni commessa automatica conserva `ficSourceRef`, chiave univoca logica che rende sync e riallineamenti idempotenti. Casi ambigui restano in coda e generano proposta, mai collegamenti inventati.

**Tech Stack:** TypeScript, tRPC 11, Vitest, persistedStore JSONB, flusso FiC OAuth esistente.

**Spec:** `docs/superpowers/specs/2026-08-27-costi-fissi-certificati-commesse-fic-design.md`

## Global Constraints

- Una fattura `invoice` produce una commessa; una `credit_note` no.
- Stesso cliente con tre fatture produce tre commesse.
- Fatture ignorate, già collegate o con codice commessa esplicito non creano commesse nuove.
- Nessuna creazione in presenza di identità fiscale contraddittoria o match multiplo.
- Idempotenza per `fic:<sedeId>:<fatturaId>`.
- Tutte le entità restano sede-scoped.

---

### Task 1: Provenienza FiC sulle commesse

**Files:**
- Modify: `server/routers/commesse.ts`
- Test: `server/routers/commesse.test.ts`

**Interfaces:**
- Produces: `ficSourceRef: string | null` sulla commessa, con backfill `null`.
- Produces: `creaCommessaInterna(input): Promise<Commessa>` riusato da router e sync.
- Produces: `trovaCommessaPerFonteFic(sedeId, fatturaId)`.

- [ ] **Step 1: Scrivere test fallente su helper idempotente**

```ts
const first = await creaCommessaDaFonteFic({ sedeId, fatturaId: 123, clienteId });
const second = await creaCommessaDaFonteFic({ sedeId, fatturaId: 123, clienteId });
expect(second.id).toBe(first.id);
expect(first.ficSourceRef).toBe(`fic:${sedeId}:123`);
```

- [ ] **Step 2: Eseguire RED**

Run: `pnpm vitest run server/routers/commesse.test.ts`

Expected: FAIL perché fonte/helper non esistono.

- [ ] **Step 3: Estrarre creazione di dominio**

Estrarre dalla mutation il blocco che costruisce, salva, collega al cliente e pubblica assegnazione. La mutation conserva autorizzazioni e chiama helper. Il nuovo campo è incluso in tipo, schema/backfill e oggetto creato.

- [ ] **Step 4: Implementare guardia idempotente**

Prima di creare, cercare nella stessa sede `ficSourceRef`. Fare secondo controllo immediatamente prima del push nello store. Restituire l'esistente quando trovato.

- [ ] **Step 5: Eseguire GREEN**

Run: `pnpm vitest run server/routers/commesse.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/routers/commesse.ts server/routers/commesse.test.ts
git commit -m "feat(commesse): track FiC invoice source"
```

### Task 2: Risoluzione cliente senza duplicati

**Files:**
- Create: `server/_core/ficCommessaCreation.ts`
- Create: `server/_core/ficCommessaCreation.test.ts`
- Modify: `server/routers/clienti.ts`

**Interfaces:**
- Produces: `risolviClienteFattura(input): { stato: "esistente" | "da_creare" | "ambiguo" | "invalido"; clienteId?: number; motivo: string }`.
- Consumes: cliente FiC con intestazione, P.IVA, CF, email, telefono e indirizzo.
- Produces: helper interno cliente per creazione sede-scoped.

- [ ] **Step 1: Scrivere test fallenti**

Copertura minima:

```ts
expect(risolviClienteFattura(fatturaConPiva, clienti).clienteId).toBe(10);
expect(risolviClienteFattura(fatturaNomeEsatto, clienti).clienteId).toBe(11);
expect(risolviClienteFattura(fatturaTreOmonimi, clienti).stato).toBe("ambiguo");
expect(risolviClienteFattura(fatturaPivaContraria, clienti).stato).toBe("ambiguo");
```

- [ ] **Step 2: Eseguire RED**

Run: `pnpm vitest run server/_core/ficCommessaCreation.test.ts`

Expected: FAIL perché modulo non esiste.

- [ ] **Step 3: Implementare resolver puro**

Normalizzare P.IVA/CF rimuovendo prefisso IT e simboli. Intestazione: minuscole, accenti e punteggiatura rimossi, token ordinati. Identità fiscale univoca prevale; intestazione vale solo con singolo match e nessuna contraddizione fiscale.

- [ ] **Step 4: Estrarre helper creazione cliente**

Riutilizzare convenzione ragione sociale esistente. Compilare soltanto dati FiC disponibili; non sovrascrivere clienti esistenti. Collegare sempre `sedeId`.

- [ ] **Step 5: Eseguire GREEN**

Run: `pnpm vitest run server/_core/ficCommessaCreation.test.ts server/routers/clienti.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/_core/ficCommessaCreation.ts server/_core/ficCommessaCreation.test.ts server/routers/clienti.ts server/routers/clienti.test.ts
git commit -m "feat(fic): resolve invoice customers safely"
```

### Task 3: Creazione automatica dopo sync

**Files:**
- Modify: `server/_core/ficCommessaCreation.ts`
- Modify: `server/_core/ficCommessaCreation.test.ts`
- Modify: `server/routers/fattureInCloud.ts`
- Modify: `server/routers/ficFatture.ts`
- Modify: `server/routers/ficFatture.test.ts`

**Interfaces:**
- Produces: `creaCommesseDaFattureFic(sedeId): Promise<{ create: number; existing: number; ambiguous: number; skipped: number }>`.
- Consumes: `ficFatture`, clienti, commesse e helper Tasks 1-2.

- [ ] **Step 1: Scrivere test fallenti di flusso**

Verificare:

```ts
expect(esito.create).toBe(3);
expect(commesse.filter(c => c.clienteId === cliente.id)).toHaveLength(3);
expect(new Set(commesse.map(c => c.ficSourceRef)).size).toBe(3);
expect((await creaCommesseDaFattureFic(sedeId)).create).toBe(0);
```

Aggiungere test separati per nota di credito, ignorata, già collegata, codice commessa esplicito, ambiguità e altra sede.

- [ ] **Step 2: Eseguire RED**

Run: `pnpm vitest run server/_core/ficCommessaCreation.test.ts server/routers/ficFatture.test.ts`

Expected: FAIL perché orchestratore non esiste.

- [ ] **Step 3: Implementare orchestratore**

Per ogni fattura eleggibile: controllare fonte esistente; risolvere/creare cliente; creare commessa; impostare `fattura.clienteId`, `fattura.commessaId`, `fattura.commessaMatch = "automatico_fattura"`; salvare store; chiamare flusso pattuito/PDF esistente dopo il batch.

- [ ] **Step 4: Collegare allo sync**

In `syncEconomico`, eseguire orchestratore dopo upsert clienti/fatture e collegamenti con codice esplicito, prima di `sincronizzaPattuitoDaFic`, riconciliazione pagamenti e archiviazione PDF. Esporre statistiche nel risultato.

- [ ] **Step 5: Collegare a `riconciliaOra`**

Il riallineamento manuale esegue stesso orchestratore. Nessun accesso DB esterno al processo.

- [ ] **Step 6: Eseguire GREEN**

Run: `pnpm vitest run server/_core/ficCommessaCreation.test.ts server/routers/ficFatture.test.ts server/routers/ficPagamenti.test.ts server/routers/ficAllegati.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/_core/ficCommessaCreation.ts server/_core/ficCommessaCreation.test.ts server/routers/fattureInCloud.ts server/routers/ficFatture.ts server/routers/ficFatture.test.ts
git commit -m "feat(fic): create one job per invoice"
```

### Task 4: Stato UI, audit e verifica

**Files:**
- Modify: `client/src/pages/Economia.tsx`
- Modify: `handoff.md`
- Test: `server/routers/ficFatture.test.ts`

**Interfaces:**
- Consumes: `commessaMatch = "automatico_fattura"`.
- Produces: stato visibile `Commessa creata automaticamente` con link.

- [ ] **Step 1: Aggiornare lista Fatture**

Mostrare badge specifico quando la commessa deriva dalla fattura. Conservare avvisi e azioni manuali per casi ambigui.

- [ ] **Step 2: Aggiungere audit test**

Verificare conteggi restituiti, link fattura-commessa e assenza di creazioni nei casi esclusi.

- [ ] **Step 3: Aggiornare handoff**

Documentare ordine sync, idempotenza, chiave sorgente, gestione ambiguità e rollback logico.

- [ ] **Step 4: Verificare tutto**

Run: `pnpm check && pnpm test && pnpm build`

Expected: tutti i comandi escono `0`.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/Economia.tsx server/routers/ficFatture.test.ts handoff.md
git commit -m "docs(fic): expose automatic job creation"
```
