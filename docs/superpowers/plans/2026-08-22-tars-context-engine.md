# Tars Context Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dare a Tars un contesto persistente, incrementale, sede/ruolo-scoped e verificabile che correli comunicazioni, fatture, allegati, clienti, commesse, appuntamenti, produzione e post-vendita riducendo drasticamente le chiamate e i token ripetuti.

**Architecture:** I producer pubblicano riferimenti compatti in `tars_context_events`. Un worker persistente, idempotente e recuperabile accorpa gli eventi per entita, costruisce fatti deterministici, calcola un fingerprint e chiama OpenAI solo quando il contenuto e cambiato. I fascicoli sintetici vivono in `tars_entity_contexts`, separati per sede e visibility scope; ogni conclusione conserva riferimenti a fonti risolvibili con nuovi controlli di permesso.

**Tech Stack:** TypeScript, Express, tRPC 11, PostgreSQL/postgres.js via `kvSql`, persistedStore per feature flag, OpenAI Responses API, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-22-messaggi-tars-context-design.md`, sezioni 7-15.

## Global Constraints

- Tars propone e non esegue mutation business senza approvazione.
- Ogni evento, contesto, query e prova e sempre `sedeId`-scoped.
- Separare `operativo`, `amministrazione` e `direzione`; mai riusare un riepilogo piu privilegiato.
- Non salvare corpi completi, base64, token o segreti nelle nuove tabelle.
- Il matching deterministico precede sempre il modello.
- Nessuna chiamata OpenAI quando il fingerprint e invariato.
- I producer non devono rendere indisponibile una mutation business se il context engine e disattivato.
- La prima attivazione e dietro feature flag per sede, default `false`.

---

## Task 1: Definire contratti e coda eventi persistente

**Files:**
- Create: `server/tars/contextTypes.ts`
- Create: `server/tars/contextStore.ts`
- Create: `server/tars/contextStore.test.ts`

- [ ] **Step 1: Scrivere test fallenti per idempotenza, scope e claim**

I test devono usare il fallback in memoria e coprire dedupe, ordine, debounce, claim esclusivo e sede:

```ts
const input = {
  sedeId: 1,
  eventType: "comunicazione.inserita" as const,
  source: { type: "comunicazione" as const, id: "42" },
  entityRefs: [{ type: "commessa" as const, id: 10 }],
  dedupeKey: "comunicazione:42:inserted",
  occurredAt: new Date("2026-08-22T10:00:00Z"),
};
expect((await publishContextEvent(input)).inserted).toBe(true);
expect((await publishContextEvent(input)).inserted).toBe(false);
expect(await claimContextEvents({ workerId: "a", limit: 10 })).toHaveLength(1);
expect(await claimContextEvents({ workerId: "b", limit: 10 })).toHaveLength(0);
```

- [ ] **Step 2: Eseguire e verificare il fallimento per moduli mancanti**

Run: `pnpm test -- server/tars/contextStore.test.ts`

Expected: FAIL per import mancanti.

- [ ] **Step 3: Definire tipi chiusi e serializzabili**

In `contextTypes.ts`:

```ts
export const ENTITY_TYPES = ["cliente", "commessa"] as const;
export type ContextEntityType = (typeof ENTITY_TYPES)[number];
export const VISIBILITY_SCOPES = [
  "operativo",
  "amministrazione",
  "direzione",
] as const;
export type VisibilityScope = (typeof VISIBILITY_SCOPES)[number];

export type ContextSourceRef = {
  type: "comunicazione" | "fattura_fic" | "documento" | "cliente" |
    "commessa" | "timeline" | "intervento" | "ticket" | "produzione" |
    "pagamento" | "reclamo";
  id: string;
  version?: string;
};

export type ContextEntityRef = { type: ContextEntityType; id: number };
export type ContextEventStatus = "pending" | "processing" | "completed" | "failed";
```

Definire `TarsContextEvent`, `TarsEntityContext`, `ContextFact`, `EvidenceRef` senza `any` nei contratti pubblici.

- [ ] **Step 4: Creare schema SQL e fallback memoria**

`ensureContextSchema()` crea:

```sql
CREATE TABLE IF NOT EXISTS tars_context_events (
  id BIGSERIAL PRIMARY KEY,
  sede_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  entity_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  dedupe_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processing_started_at TIMESTAMPTZ,
  worker_id TEXT,
  last_error TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sede_id, dedupe_key)
);
```

Aggiungere indici su `(status, available_at)`, `(sede_id, status)` e GIN su `entity_refs` solo se giustificato dal piano query. Creare anche `tars_entity_contexts` con unique `(sede_id, entity_type, entity_id, visibility_scope)` e campi della spec.

- [ ] **Step 5: Implementare API store**

```ts
export async function publishContextEvent(input: PublishContextEventInput):
  Promise<{ id: number; inserted: boolean }>;
export async function claimContextEvents(input: {
  workerId: string; limit: number; now?: Date;
}): Promise<TarsContextEvent[]>;
export async function completeContextEvent(id: number, workerId: string): Promise<boolean>;
export async function failContextEvent(input: {
  id: number; workerId: string; error: string; retryAt: Date | null;
}): Promise<boolean>;
export async function recoverStaleContextEvents(cutoff: Date): Promise<number>;
```

Il claim PostgreSQL deve usare `kvSql.begin` e `FOR UPDATE SKIP LOCKED`; aggiornare status/worker/attempts prima di restituire. Troncare `last_error` a 500 caratteri e non includere payload esterni.

- [ ] **Step 6: Verificare test**

Run: `pnpm test -- server/tars/contextStore.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/tars/contextTypes.ts server/tars/contextStore.ts server/tars/contextStore.test.ts
git commit -m "feat: aggiungi coda persistente contesti Tars"
```

## Task 2: Costruire fatti, prove e fingerprint deterministici

**Files:**
- Create: `server/tars/contextFacts.ts`
- Create: `server/tars/contextFingerprint.ts`
- Create: `server/tars/contextFacts.test.ts`
- Create: `server/tars/contextFingerprint.test.ts`

- [ ] **Step 1: Scrivere test fallenti sui fatti sede/scope**

Creare fixture minime e verificare che:

- `operativo` includa stato commessa, appuntamenti, ticket e riferimenti comunicazioni;
- `operativo` non includa importi/margini/fatture;
- `amministrazione` includa pagamenti e fatture ma non dati direzionali aggregati;
- `direzione` includa tutti i fatti consentiti;
- ogni fatto abbia almeno una `EvidenceRef`;
- una commessa di altra sede produca `null`, non metadati.

- [ ] **Step 2: Scrivere test fallenti sul fingerprint**

```ts
expect(fingerprintContext(factsA, versions)).toBe(fingerprintContext(factsA, versions));
expect(fingerprintContext([...factsA].reverse(), versions)).toBe(
  fingerprintContext(factsA, versions)
);
expect(fingerprintContext(factsA, { ...versions, prompt: "v3" })).not.toBe(
  fingerprintContext(factsA, versions)
);
```

- [ ] **Step 3: Implementare collector per cliente e commessa**

Definire:

```ts
export async function collectEntityFacts(input: {
  sedeId: number;
  entityType: ContextEntityType;
  entityId: number;
  scope: VisibilityScope;
}): Promise<{ facts: ContextFact[]; evidenceRefs: EvidenceRef[] } | null>;
```

Usare getter/store gia esistenti da clienti, commesse, timeline, interventi, ticket, produzione/post-vendita, FIC e comunicazioni. I testi email/WhatsApp non entrano nei facts; usare id, data, canale, categoria, oggetto/anteprima corta e link business. Per documenti usare nome, mime, checksum/storageKey e relazione, mai bytes.

- [ ] **Step 4: Implementare serializzazione canonica e SHA-256**

Ordinare fatti per `kind`, `source.type`, `source.id`; ordinare chiavi oggetto ricorsivamente e normalizzare date ISO. Il fingerprint include:

```ts
{
  schemaVersion: CONTEXT_SCHEMA_VERSION,
  promptVersion: CONTEXT_PROMPT_VERSION,
  modelVersion,
  facts,
}
```

Usare `node:crypto`, non hash non crittografici.

- [ ] **Step 5: Verificare test**

Run: `pnpm test -- server/tars/contextFacts.test.ts server/tars/contextFingerprint.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/tars/contextFacts.ts server/tars/contextFingerprint.ts server/tars/contextFacts.test.ts server/tars/contextFingerprint.test.ts
git commit -m "feat: costruisci fatti e fingerprint Tars"
```

## Task 3: Generare e salvare fascicoli sintetici solo quando cambiano

**Files:**
- Create: `server/tars/contextBuilder.ts`
- Create: `server/tars/contextBuilder.test.ts`
- Modify: `server/tars/contextStore.ts`
- Modify: `server/tars/openai.test.ts`

- [ ] **Step 1: Scrivere test fallenti per cache hit e chiamata modello**

Mockare `callOpenAI` e verificare:

```ts
const first = await rebuildEntityContext(input);
expect(first.status).toBe("rebuilt");
expect(callOpenAI).toHaveBeenCalledTimes(1);

const second = await rebuildEntityContext(input);
expect(second).toMatchObject({ status: "unchanged", modelCalled: false });
expect(callOpenAI).toHaveBeenCalledTimes(1);
```

Verificare inoltre che un modello in errore non distrugga il contesto precedente e che un'entita fuori sede ritorni `not_found`.

- [ ] **Step 2: Implementare lettura/upsert contesto**

In `contextStore.ts` aggiungere:

```ts
export async function getEntityContext(key: EntityContextKey): Promise<TarsEntityContext | null>;
export async function upsertEntityContext(input: UpsertEntityContextInput): Promise<TarsEntityContext>;
export async function listEntityContextsForRebuild(input: {
  sedeId: number; olderThan: Date; limit: number;
}): Promise<EntityContextKey[]>;
```

- [ ] **Step 3: Implementare il builder**

```ts
export type RebuildResult = {
  status: "rebuilt" | "unchanged" | "not_found" | "disabled";
  modelCalled: boolean;
  context: TarsEntityContext | null;
  usage: OpenAIUsage | null;
};

export async function rebuildEntityContext(input: {
  sedeId: number;
  entityType: ContextEntityType;
  entityId: number;
  scope: VisibilityScope;
  force?: boolean;
  lastEventAt?: Date;
}): Promise<RebuildResult>;
```

Flusso: collect facts -> fingerprint -> confronto -> chiamata `callOpenAI` solo se diverso/force -> upsert. Usare `getTarsConfig(sedeId).modelloAutomatico`, `reasoningEffort: "low"`, nessun tool, `maxTokens: 700` e `promptCacheKey` stabile `tars:v1:context:<scope>:<model>`.

Il prompt ordina di sintetizzare esclusivamente i fatti, dichiarare dubbi e citare gli id prova nel formato `[tipo:id]`. Prima del salvataggio convalidare che ogni citazione esista; in caso contrario rimuovere la citazione non valida e registrare una warning interna senza inventare fonti.

- [ ] **Step 4: Registrare metriche di utilizzo**

Persistenza minima per build: `tokens_in`, `tokens_out`, `tokens_cache_read`, `model_called`, `skip_reason`, `duration_ms`. Riutilizzare `OpenAIUsage`; non stimare token risparmiati dal numero di caratteri. Il risparmio UI deriva da chiamate saltate e token reali delle chiamate eseguite.

- [ ] **Step 5: Eseguire test**

Run: `pnpm test -- server/tars/contextBuilder.test.ts server/tars/openai.test.ts`

Expected: PASS; il secondo rebuild non chiama OpenAI.

- [ ] **Step 6: Commit**

```bash
git add server/tars/contextBuilder.ts server/tars/contextBuilder.test.ts server/tars/contextStore.ts server/tars/openai.test.ts
git commit -m "feat: genera fascicoli Tars incrementali"
```

## Task 4: Implementare worker, retry, recupero e accorpamento

**Files:**
- Create: `server/tars/contextWorker.ts`
- Create: `server/tars/contextWorker.test.ts`
- Modify: `server/_core/index.ts`

- [ ] **Step 1: Scrivere test fallenti del worker**

Coprire:

- due eventi della stessa entita causano un solo rebuild per scope;
- successo completa entrambi;
- errore usa backoff 1m, 5m, 15m, 1h e al quinto tentativo `failed`;
- `processing` vecchio oltre 10 minuti torna `pending`;
- worker disattivato non claim-a eventi;
- piu sedi non condividono batch o contesti.

- [ ] **Step 2: Implementare elaborazione batch**

```ts
export async function processContextBatch(options?: {
  workerId?: string;
  limit?: number;
  now?: Date;
}): Promise<ContextBatchResult>;

export function startContextWorker(): void;
export function stopContextWorkerForTest(): void;
```

Raggruppare i claim per `(sedeId, entityType, entityId)`. Ricostruire `operativo`; ricostruire `amministrazione` e `direzione` solo quando i facts del relativo scope differiscono oppure un evento riguarda economia/fatture/pagamenti. Segnare tutti gli eventi del gruppo solo dopo gli upsert riusciti.

- [ ] **Step 3: Implementare scheduler recuperabile**

Primo giro 5 secondi dopo startup, poi ogni 30 secondi; timer con `unref`. Prima del claim recuperare record stale. Il worker legge `contestoIncrementaleAttivo` della sede e ignora in modo osservabile le sedi disattivate senza consumare tentativi.

- [ ] **Step 4: Avviare il worker nel bootstrap**

In `server/_core/index.ts`, dopo `bootstrapAll()` e prima di servire traffico:

```ts
const { startContextWorker } = await import("../tars/contextWorker");
startContextWorker();
```

Non bloccare l'ascolto sul primo batch.

- [ ] **Step 5: Verificare test**

Run: `pnpm test -- server/tars/contextWorker.test.ts`

Expected: PASS senza timer aperti al termine.

- [ ] **Step 6: Commit**

```bash
git add server/tars/contextWorker.ts server/tars/contextWorker.test.ts server/_core/index.ts
git commit -m "feat: elabora eventi contesto Tars in background"
```

## Task 5: Pubblicare eventi da Email, WhatsApp e FIC

**Files:**
- Modify: `server/tars/comunicazioni.ts`
- Modify: `server/tars/imap.ts`
- Modify: `server/tars/whatsapp.ts`
- Modify: `server/routers/ficFatture.ts`
- Modify: `server/tars/mail.test.ts`
- Modify: `server/tars/whatsapp.test.ts`
- Modify: `server/routers/ficFatture.test.ts`

- [ ] **Step 1: Scrivere test fallenti sui producer**

Mockare `publishContextEvent` e verificare un evento solo dopo insert/upsert riuscito, nessuno sul duplicato. Dedupe richieste:

```text
comunicazione:<id>:inserted
comunicazione:<id>:match:<commessaId|none>
fattura_fic:<id>:<updatedAt ISO>
fattura_fic:<id>:link:<commessaId|none>
```

- [ ] **Step 2: Pubblicare dall'insert comunicazione**

Il producer deve usare i link gia determinati (`clienteId`, `commessaId`). Se non esistono, includere solo la fonte: il matching della Task 7 puo aggiungere refs successivamente. Email e WhatsApp usano lo stesso evento ma mantengono `source.type = comunicazione` e il canale nei metadati compatti.

- [ ] **Step 3: Pubblicare su collegamento/classificazione rilevante**

`setMatchComunicazione` pubblica un evento quando cambia cliente/commessa. Una mera transizione `nuova -> vista` non invalida il fascicolo; `gestita`, categoria operativa/esclusa e nuovi allegati si.

- [ ] **Step 4: Pubblicare da sync/collegamento FIC**

Dopo un upsert materiale o una modifica di riconciliazione, pubblicare evento con cliente/commessa noti. Batch FIC: accodare una promise per fattura modificata e attendere `Promise.allSettled`; loggare solo conteggio errori, mai payload fattura.

- [ ] **Step 5: Verificare test**

Run: `pnpm test -- server/tars/mail.test.ts server/tars/whatsapp.test.ts server/routers/ficFatture.test.ts`

Expected: PASS; duplicati non producono eventi doppi.

- [ ] **Step 6: Commit**

```bash
git add server/tars/comunicazioni.ts server/tars/imap.ts server/tars/whatsapp.ts server/routers/ficFatture.ts server/tars/mail.test.ts server/tars/whatsapp.test.ts server/routers/ficFatture.test.ts
git commit -m "feat: collega comunicazioni e fatture al contesto Tars"
```

## Task 6: Pubblicare eventi dai moduli business prioritari

**Files:**
- Modify: `server/routers/clienti.ts`
- Modify: `server/routers/commesse.ts`
- Modify: `server/routers/timeline.ts`
- Modify: `server/routers/interventi.ts`
- Modify: `server/routers/ticket.ts`
- Modify: `server/routers/ticketAllegati.ts`
- Modify: `server/routers/reclamiRifacimenti.ts`
- Modify: `server/routers/produzione.ts`
- Modify: `server/routers/preventiviContratti.ts`
- Create: `server/tars/contextProducers.test.ts`

- [ ] **Step 1: Scrivere test tabellari fallenti per le mutation**

Per ogni famiglia verificare `source`, refs e dedupe, includendo almeno: cliente update, commessa update/stato/pagamento, timeline, intervento/appuntamento, ticket, allegato ticket, reclamo, produzione e documento commessa aggiunto/rinominato/collegato.

- [ ] **Step 2: Creare helper producer non bloccante quando disattivato**

```ts
export async function publishBusinessContextEvent(input: {
  sedeId: number;
  eventType: string;
  source: ContextSourceRef;
  clienteId?: number | null;
  commessaId?: number | null;
  occurredAt?: Date;
}): Promise<void>;
```

L'helper controlla la feature flag prima di toccare il DB. Se la pubblicazione fallisce, registra tipo/sede/dedupe troncata e non dati cliente; la mutation business gia riuscita non viene annullata.

- [ ] **Step 3: Integrare solo nei punti di mutation riuscita**

Convertire a `async` le mutation necessarie. Chiamare il producer dopo validazione scope e salvataggio. Evitare hook generici su `persistedStore`: produrrebbero eventi durante seed/backfill e perderebbero l'identita della mutation.

- [ ] **Step 4: Verificare test e typecheck**

Run: `pnpm test -- server/tars/contextProducers.test.ts && pnpm check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routers/clienti.ts server/routers/commesse.ts server/routers/timeline.ts server/routers/interventi.ts server/routers/ticket.ts server/routers/ticketAllegati.ts server/routers/reclamiRifacimenti.ts server/routers/produzione.ts server/routers/preventiviContratti.ts server/tars/contextProducers.test.ts
git commit -m "feat: pubblica eventi business per Tars"
```

## Task 7: Aggiungere correlazione deterministica e disambiguazione limitata

**Files:**
- Create: `server/tars/contextMatch.ts`
- Create: `server/tars/contextMatch.test.ts`
- Modify: `server/tars/contextWorker.ts`
- Modify: `server/tars/tools.ts`
- Modify: `server/tars/tars.test.ts`

- [ ] **Step 1: Scrivere test fallenti sul punteggio candidati**

Coprire exact code commessa, telefono/email, P.IVA/C.F., numero fattura, importo/data, piu candidati e archiviate escluse. Il risultato deve essere spiegabile:

```ts
expect(result.candidates[0]).toMatchObject({
  entityType: "commessa",
  entityId: 10,
  score: 100,
  reasons: ["codice_commessa_esatto"],
});
expect(result.resolution).toBe("deterministic");
```

- [ ] **Step 2: Implementare motore puro candidati**

```ts
export function rankContextCandidates(input: CandidateInput): CandidateResult;
```

Soglie iniziali: exact unique >= 95 risolve senza AI; 70-94 genera candidati per disambiguazione; sotto 70 resta non collegato. Le soglie sono costanti testate, non configurazione UI nella prima iterazione.

- [ ] **Step 3: Integrare nel worker**

Per eventi senza entity refs, estrarre segnali compatti dalla fonte, calcolare candidati e:

- exact unique: aggiungere refs e ricostruire contesto, senza proposta se il collegamento business non esiste;
- ambiguo: passare solo massimo cinque candidati al profilo Tars `correlazione_contesto`;
- nessun candidato: completare evento con esito osservabile `unmatched`.

Anche un match deterministico non scrive il collegamento business: genera una proposta canonica quando serve conferma.

- [ ] **Step 4: Aggiungere profilo strumenti minimo**

In `tools.ts` aggiungere `correlazione_contesto` con sole letture candidato e strumenti proposta pertinenti. Verificare ordine stabile e dimensione inferiore a un terzo del catalogo completo.

- [ ] **Step 5: Estendere chiavi canoniche**

Assicurare dedupe per comunicazione/fattura/documento e target. I test devono coprire pendente, approvata, rifiutata, risposta e gia gestita.

- [ ] **Step 6: Verificare test**

Run: `pnpm test -- server/tars/contextMatch.test.ts server/tars/tars.test.ts`

Expected: PASS; i casi esatti mockano zero chiamate OpenAI.

- [ ] **Step 7: Commit**

```bash
git add server/tars/contextMatch.ts server/tars/contextMatch.test.ts server/tars/contextWorker.ts server/tars/tools.ts server/tars/tars.test.ts
git commit -m "feat: correla fonti e fascicoli Tars"
```

## Task 8: Rendere i contesti disponibili al loop Tars

**Files:**
- Modify: `server/tars/tools.ts`
- Modify: `server/tars/loop.ts`
- Modify: `server/tars/prompt.ts`
- Modify: `server/tars/tars.test.ts`

- [ ] **Step 1: Scrivere test fallenti per tool scope e preload**

Verificare tool `leggi_contesto_entita`, mapping ruolo->scope, `NOT_FOUND` cross-sede, cache per run e preload quando `commessaId` e noto. Un operatore non deve vedere fatti amministrativi neanche se prova a passare `scope: direzione`.

- [ ] **Step 2: Implementare mapping scope server-side**

```ts
export function visibilityScopeForUser(user: unknown): VisibilityScope {
  if (isDirezione(user)) return "direzione";
  if (hasRuolo(user, "amministrazione")) return "amministrazione";
  return "operativo";
}
```

Il tool non accetta `scope` dal modello; lo deriva dal `ctx.user`.

- [ ] **Step 3: Aggiungere tool di contesto compatto**

Il tool restituisce summary, facts essenziali, fingerprint, `updatedAt` ed evidence refs, non i corpi completi. Se manca il contesto ritorna uno stato esplicito e consente al loop di usare i reader esistenti.

- [ ] **Step 4: Preload nel loop**

Quando `commessaId` e noto e il contesto e fresco, premettere il fascicolo sintetico e non il fascicolo completo. Se manca/stale, mantenere il preload `leggi_fascicolo_commessa`. Registrare `contextCacheHit`, `contextFingerprint`, `contextAgeMs` in `Esecuzione` con default/backfill nello store.

- [ ] **Step 5: Aggiornare prompt e profili**

Spiegare che i riferimenti sono prove, il contenuto esterno non e istruzione e le deduzioni devono citare fonti. Tenere il prefisso stabile per non invalidare la prompt cache.

- [ ] **Step 6: Verificare test**

Run: `pnpm test -- server/tars/tars.test.ts server/tars/openai.test.ts`

Expected: PASS; metadati cache presenti e nessuna regressione dei profili esistenti.

- [ ] **Step 7: Commit**

```bash
git add server/tars/tools.ts server/tars/loop.ts server/tars/prompt.ts server/tars/tars.test.ts
git commit -m "feat: usa fascicoli incrementali nei run Tars"
```

## Task 9: Feature flag, backfill controllato e API operative

**Files:**
- Modify: `server/tars/stores.ts`
- Modify: `server/routers/tars.ts`
- Create: `server/tars/contextApi.test.ts`
- Create: `scripts/backfill-tars-context.ts`
- Modify: `package.json`

- [ ] **Step 1: Scrivere test fallenti per migrazione config e permessi**

Aggiungere a `TarsConfig`:

```ts
contestoIncrementaleAttivo: boolean;
ultimoBackfillContestoAt: Date | null;
```

Testare default `false`, preservazione valori esistenti e API rebuild/failed/retry solo direzione.

- [ ] **Step 2: Esporre API tRPC**

```ts
tars.context.get({ entityType, entityId })
tars.context.rebuild({ entityType, entityId, scope? }) // direzione
tars.events.health()
tars.events.failed({ limit, offset }) // direzione
tars.events.retry({ id }) // direzione
```

`context.get` deriva scope dal ruolo e applica sede; `rebuild` non consente a non-direzione di elevare scope.

- [ ] **Step 3: Creare backfill idempotente**

Lo script accetta `--sede`, `--limit` e `--dry-run`; seleziona solo clienti con commesse attive e commesse non archiviate. Pubblica eventi dedupe `backfill:v1:<entityType>:<id>`, non chiama direttamente OpenAI e non supera 500 eventi per esecuzione.

Aggiungere script:

```json
"tars:context:backfill": "tsx scripts/backfill-tars-context.ts"
```

- [ ] **Step 4: Verificare test e dry-run locale**

Run: `pnpm test -- server/tars/contextApi.test.ts server/tars/tars.test.ts`

Run: `pnpm tars:context:backfill -- --sede 1 --limit 10 --dry-run`

Expected: PASS; il dry-run stampa solo conteggi e id, non dati cliente.

- [ ] **Step 5: Commit**

```bash
git add server/tars/stores.ts server/routers/tars.ts server/tars/contextApi.test.ts scripts/backfill-tars-context.ts package.json
git commit -m "feat: controlla rollout contesto Tars"
```

## Task 10: Ricostruzione periodica, osservabilita e documentazione

**Files:**
- Modify: `server/tars/contextWorker.ts`
- Modify: `server/tars/auditProcessi.ts`
- Modify: `server/tars/contextWorker.test.ts`
- Modify: `handoff.md`
- Modify: `documento_requisiti_infissi_ops.md`
- Create: `docs/tars-context-engine.md`

- [ ] **Step 1: Scrivere test fallenti per rebuild settimanale**

Verificare che il controllo notturno accodi al massimo un batch limitato di contesti attivi piu vecchi di sette giorni e che dedupe impedisca doppioni nello stesso giorno.

- [ ] **Step 2: Integrare manutenzione con audit**

Non eseguire full rebuild dentro `auditProcessi`. Il scheduler pubblica eventi `maintenance:weekly:<date>:<entity>` a bassa priorita; il worker normale li consuma rispettando budget e feature flag.

- [ ] **Step 3: Completare health metrics**

`events.health` deve restituire: pending, processing, failed, oldestPendingAt, lastCompletedAt, unchangedFingerprints, rebuiltContexts, modelCalls, cacheReadTokens, inputTokens e duplicateProposalsBlocked. Calcolare dati reali dal periodo corrente, non stime.

- [ ] **Step 4: Documentare runbook**

`docs/tars-context-engine.md` deve spiegare schema, feature flag, backfill dry-run, metriche, retry manuale, recupero stale, rollback (disattivare flag, non cancellare tabelle) e query diagnostiche senza payload cliente.

- [ ] **Step 5: Verifica completa**

Run: `pnpm check && pnpm test && pnpm build`

Expected: tre comandi PASS. Non attivare la feature su Railway e non lanciare backfill reale senza richiesta esplicita.

- [ ] **Step 6: Commit**

```bash
git add server/tars/contextWorker.ts server/tars/auditProcessi.ts server/tars/contextWorker.test.ts handoff.md documento_requisiti_infissi_ops.md docs/tars-context-engine.md
git commit -m "docs: aggiungi runbook contesto Tars"
```
