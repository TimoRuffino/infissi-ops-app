# Tars Chat E Obiettivi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendere la chat di Tars un flusso operativo completo e orientato al risultato, in cui domande, proposte figlie, approvazioni ed esiti restano nello stesso punto e richieste come `crea cliente e commessa` o `il lavoro e finito` ricevono una risposta di dominio affidabile.

**Architecture:** Il server espone l'intero albero delle proposte collegate a ogni messaggio tramite `origineId`; il client aggiorna la catena finche il seguito produce una card o un esito. Gli intenti critici usano controller e postcondizioni deterministiche: la saga cliente/commessa resta quella esistente, mentre la chiusura commessa usa un nuovo servizio di readiness e una sola proposta ad alto rischio.

**Tech Stack:** TypeScript, tRPC 11, React 19, React Query, Vitest, persistedStore, servizi e router esistenti di clienti, commesse, timeline, documenti, ticket e interventi.

**Spec:** `docs/superpowers/specs/2026-08-25-tars-email-documenti-design.md`

## Global Constraints

- Tars propone e non esegue mutazioni senza approvazione.
- Il tab Proposte e una vista globale, mai un passaggio obbligatorio per un flusso nato in chat.
- Una domanda preliminare e tutte le proposte discendenti formano una sola catena conversazionale.
- `crea cliente e commessa` termina con proposta completa, domanda mirata o segnalazione di duplicato; mai con una risposta generica.
- Retry e doppia approvazione non duplicano cliente o commessa.
- `il lavoro e finito` non genera avanzamenti di uno step: verifica l'obiettivo di chiusura.
- Una commessa non viene archiviata con saldo residuo, documenti obbligatori mancanti, ticket o interventi aperti.
- Le domande informative non producono proposte.
- Ogni proposta conserva sede, capability, evidenze e chiave azione canonica.

---

## File Map

- `server/tars/proposalTree.ts`: espansione deterministica e cycle-safe dei discendenti `origineId`.
- `server/routers/tars.ts`: idratazione chat e postcondizione del planner.
- `client/src/lib/tarsChat.ts`: predicato puro che limita il polling ai seguiti realmente in corso.
- `client/src/lib/tarsChat.test.ts`: stati domanda, proposta figlia ed esito.
- `client/src/components/TarsChat.tsx`: polling della catena e aggiornamento inline.
- `client/src/components/TarsPropostaCard.tsx`: stato del seguito, esecuzione e risultato nello stesso componente.
- `server/tars/planner/router.ts`: riconoscimento dell'intento esplicito cliente + commessa.
- `server/tars/workflows/createCustomerJob.ts`: saga esistente, invariata come unico writer composto.
- `server/tars/closureReadiness.ts`: valutazione pura/servizio dei prerequisiti di chiusura.
- `server/tars/tools.ts`: tool di verifica e proposta `chiudi_commessa`.
- `server/tars/esecutore.ts`: rivalidazione e chiusura approvata.
- `server/tars/stores.ts`: tipo e rischio della proposta.
- `server/tars/evals/cases/core.json`: casi conversazionali e goal-oriented.

### Task 1: Idratare l'albero completo delle proposte in chat

**Files:**
- Create: `server/tars/proposalTree.ts`
- Create: `server/tars/proposalTree.test.ts`
- Modify: `server/routers/tars.ts`
- Modify: `server/routers/mail.channels.test.ts`

**Interfaces:**
- Produces: `collectProposalTree(rootIds: number[], all: Proposta[], sedeId: number): Proposta[]`.
- Changes: `idrataMessaggio` restituisce radici e discendenti ordinati per `createdAt`, poi `id`, senza duplicati.

- [ ] **Step 1: Scrivere i test rossi dell'albero**

```ts
it("include domanda, proposta figlia ed esito nello stesso messaggio", () => {
  const makeProposal = (id: number, origineId: number | null) => ({
    id, origineId, sedeId: 1, createdAt: new Date(`2026-08-25T10:00:${id}Z`),
  }) as Proposta;
  const items = [makeProposal(10, null), makeProposal(11, 10), makeProposal(12, 11)];
  expect(collectProposalTree([10], items, 1).map(item => item.id))
    .toEqual([10, 11, 12]);
});
```

Includere ciclo corrotto, figlio di altra sede, due radici che convergono e ordine stabile.

- [ ] **Step 2: Verificare il fallimento**

Run: `pnpm exec vitest run server/tars/proposalTree.test.ts server/routers/mail.channels.test.ts`

Expected: FAIL per funzione assente e figlio non idratato.

- [ ] **Step 3: Implementare traversal breadth-first cycle-safe**

Usare `Set<number>` per visitati, indicizzare `all` per `origineId`, filtrare sempre `sedeId`, ordinare ogni livello per `createdAt.getTime()` e `id`. Non mutare `proposte`.

- [ ] **Step 4: Usare l'helper in `idrataMessaggio`**

Sostituire il solo `m.proposteIds.map(...)` con `collectProposalTree(...)` e continuare a passare ogni elemento a `idrataProposta`.

- [ ] **Step 5: Verificare i test verdi**

Run: `pnpm exec vitest run server/tars/proposalTree.test.ts server/routers/mail.channels.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/tars/proposalTree.ts server/tars/proposalTree.test.ts server/routers/tars.ts server/routers/mail.channels.test.ts
git commit -m "fix(tars): keep follow-up proposals in chat"
```

### Task 2: Aggiornamento live e approvazione inline

**Files:**
- Create: `client/src/lib/tarsChat.ts`
- Create: `client/src/lib/tarsChat.test.ts`
- Modify: `client/src/components/TarsChat.tsx`
- Modify: `client/src/components/TarsPropostaCard.tsx`

**Interfaces:**
- Consumes: `messaggio.proposte` completo della Task 1.
- Produces: polling attivo solo se una domanda ha `seguitoAt` ma non e ancora visibile un discendente o se una proposta approvata e ancora senza `esito`.

- [ ] **Step 1: Estrarre il predicato di polling**

```ts
export function chatNeedsRefresh(proposte: TarsProposal[]): boolean {
  return proposte.some(p =>
    (p.tipo === "domanda" && p.stato === "risposta" && p.seguitoAt &&
      !proposte.some(child => child.origineId === p.id)) ||
    (p.stato === "approvata" && !p.esito)
  );
}
```

Il tipo minimo consumato dall'helper e `Pick<TarsProposal, "id" | "origineId" | "tipo" | "stato" | "seguitoAt" | "esito">`, così il test non richiede DOM.

- [ ] **Step 2: Verificare il test rosso**

Run: `pnpm exec vitest run client/src/lib/tarsChat.test.ts`

Expected: FAIL per helper assente.

- [ ] **Step 3: Implementare polling limitato**

Invalidare `tars.chat.get` e `tars.proposte.list` dopo 1, 2, 4, 8 e 15 secondi, interrompendo appena `chatNeedsRefresh` torna falso. Smontaggio e cambio conversazione devono cancellare i timer.

- [ ] **Step 4: Rendere la card autosufficiente**

La card domanda mostra `Risposta inviata, Tars sta preparando l'azione`; la card figlia mostra Approva/Rifiuta; durante approvazione mostra spinner; su successo mostra `esito` e link agli id creati; su errore mostra Riprova. Rimuovere qualsiasi copy che inviti ad aprire il tab Proposte.

- [ ] **Step 5: Verificare test e build**

Run: `pnpm exec vitest run client/src/lib/tarsChat.test.ts && pnpm check && pnpm build`

Expected: PASS e due exit code 0.

- [ ] **Step 6: Commit**

```bash
git add client/src/lib/tarsChat.ts client/src/lib/tarsChat.test.ts client/src/components/TarsChat.tsx client/src/components/TarsPropostaCard.tsx
git commit -m "feat(tars): complete approvals inside chat"
```

### Task 3: Postcondizione per `crea cliente e commessa`

**Files:**
- Modify: `server/tars/planner/router.ts`
- Modify: `server/tars/planner/router.test.ts`
- Modify: `server/routers/tars.ts`
- Modify: `server/tars/tars.test.ts`
- Modify: `server/tars/evals/cases/core.json`

**Interfaces:**
- Produces: `isCreateCustomerJobIntent(text: string): boolean` nel planner.
- Produces: `validateCreateCustomerJobOutcome(input: { proposalIds: number[]; assistantText: string }): "proposal" | "question" | "duplicate"` oppure errore controllato.
- Consumes: saga `executeCreateCustomerJobSaga` esistente, senza creare un secondo writer.

- [ ] **Step 1: Scrivere i test rossi del planner**

Casi positivi: `crea il cliente Mario Rossi e apri la commessa`, `inserisci cliente e lavoro`; negativi: `come si crea una commessa?`, `quante commesse ha Mario?`. Casi outcome: `crea_lead`, `domanda`, duplicato esplicito; risposta generica deve fallire.

- [ ] **Step 2: Verificare il fallimento**

Run: `pnpm exec vitest run server/tars/planner/router.test.ts server/tars/tars.test.ts`

Expected: FAIL per postcondizione assente.

- [ ] **Step 3: Implementare routing e postcondizione**

Il planner instrada l'intento a `create_customer_job`. Al termine del run chat, se l'intento era esplicito, accettare soltanto una proposta `crea_lead`, una `domanda`, oppure una risposta strutturata di duplicato basata su evidenze lette. In caso contrario registrare esecuzione incompleta e rilanciare un unico seguito vincolato: `Raccogli solo i dati obbligatori mancanti oppure crea proponi_nuovo_lead; non rispondere genericamente.`

- [ ] **Step 4: Verificare invarianti della saga**

Eseguire anche `server/tars/workflows/createCustomerJob.test.ts` e verificare dati completi, assegnatario mancante, cliente esistente, commessa duplicata, errore parziale e doppia approvazione.

- [ ] **Step 5: Aggiornare eval**

Aggiungere un caso frase naturale senza JSON strutturato e un caso domanda informativa; il primo deve terminare `waiting_approval` o `waiting_user`, il secondo `informational` senza proposte.

- [ ] **Step 6: Verificare i test verdi**

Run: `pnpm exec vitest run server/tars/planner/router.test.ts server/tars/tars.test.ts server/tars/workflows/createCustomerJob.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/tars/planner/router.ts server/tars/planner/router.test.ts server/routers/tars.ts server/tars/tars.test.ts server/tars/evals/cases/core.json
git commit -m "feat(tars): guarantee customer job outcomes"
```

### Task 4: Valutazione dei prerequisiti di chiusura

**Files:**
- Create: `server/tars/closureReadiness.ts`
- Create: `server/tars/closureReadiness.test.ts`
- Modify: `server/tars/tools.ts`
- Modify: `server/tars/tars.test.ts`

**Interfaces:**
- Produces: `ClosureBlockerCode = "saldo" | "documenti" | "timeline" | "ticket" | "interventi"`.
- Produces: `evaluateClosureReadiness(ctx: TrpcContext, commessaId: number): Promise<ClosureReadiness>`.
- Produces: tool read-only `verifica_chiusura_commessa`.

```ts
export type ClosureReadiness = {
  ready: boolean;
  commessaId: number;
  currentState: string;
  saldoResiduo: number;
  missingDocumentTypes: DocTipo[];
  incompleteTimelineSteps: Array<{ id: number; ordine: number; titolo: string }>;
  openTicketIds: number[];
  openInterventionIds: number[];
  blockers: Array<{ code: ClosureBlockerCode; label: string; action: string }>;
};
```

- [ ] **Step 1: Scrivere i test rossi del readiness service**

Coprire separatamente saldo residuo maggiore di `0.01`, tipo documento obbligatorio mancante, step timeline ancora `in_corso`, ticket non chiuso, intervento non completato e caso completamente pronto. Gli step `da_fare` restano evidenza ma non bloccano da soli, perché alcuni passaggi non si applicano a tutte le commesse. Includere commessa cross-sede come `NOT_FOUND`.

- [ ] **Step 2: Verificare il fallimento**

Run: `pnpm exec vitest run server/tars/closureReadiness.test.ts`

Expected: FAIL per servizio assente.

- [ ] **Step 3: Implementare letture aggregate**

Usare caller tRPC con il `ctx` corrente. Calcolare `saldoResiduo = max(0, importoTotale - importoIncassato)`. Per i documenti richiedere almeno un documento per ogni tipo obbligatorio previsto dagli stati dal corrente ad `archiviata`; il documento puo essere storico della commessa, senza richiedere `statoAtUpload`, perché la chiusura rivalida il fascicolo completo. La timeline entra nei blocker soltanto per step ancora `in_corso`; gli step `da_fare` vengono restituiti come contesto. Considerare aperti i ticket non `chiuso`/`completato` e gli interventi non `completato`.

- [ ] **Step 4: Esporre il tool read-only**

Il tool restituisce tutti i blocker in un'unica lettura, evitando chiamate frammentate. Inserirlo nei profili chat/on-demand e nel prompt: se `ready=false`, Tars descrive solo blocker reali e propone esclusivamente azioni supportate; non propone avanzamenti intermedi.

- [ ] **Step 5: Verificare i test verdi**

Run: `pnpm exec vitest run server/tars/closureReadiness.test.ts server/tars/tars.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/tars/closureReadiness.ts server/tars/closureReadiness.test.ts server/tars/tools.ts server/tars/tars.test.ts
git commit -m "feat(tars): evaluate job closure readiness"
```

### Task 5: Proposta unica di chiusura verificabile

**Files:**
- Modify: `server/tars/stores.ts`
- Modify: `server/tars/tools.ts`
- Modify: `server/tars/esecutore.ts`
- Modify: `server/routers/tars.ts`
- Modify: `server/tars/tars.test.ts`
- Modify: `client/src/components/TarsPropostaCard.tsx`
- Modify: `server/tars/evals/cases/core.json`

**Interfaces:**
- Produces: proposta `chiudi_commessa`, inclusa in `TIPI_ALTO_RISCHIO`.
- Produces: tool `proponi_chiusura_commessa({ commessaId, readinessFingerprint, titolo, motivazione, confidenza })`.
- Produces: chiave azione `chiudi_commessa:<sedeId>:<commessaId>`.

- [ ] **Step 1: Scrivere test rossi**

Verificare: readiness falsa impedisce la proposta; readiness vera crea una sola proposta; cambio di saldo/documenti dopo la proposta fa fallire l'approvazione; utente senza capability high-risk non approva; approvazione valida porta a `archiviata`; retry non duplica eventi o regressioni.

- [ ] **Step 2: Verificare il fallimento**

Run: `pnpm exec vitest run server/tars/tars.test.ts`

Expected: FAIL per tipo/tool/esecutore assenti.

- [ ] **Step 3: Implementare proposta e fingerprint**

Il fingerprint usa stato corrente, importi, id/tipo documenti, id/stato timeline, ticket e interventi. Il tool ricalcola readiness e accetta soltanto `ready=true`; salva il fingerprint nel payload.

- [ ] **Step 4: Implementare l'esecutore**

Prima della mutation ricalcolare readiness e confrontare il fingerprint. Se differisce o esistono blocker, restituire errore leggibile e nessun side effect. Se valido, chiamare `caller.commesse.update({ id: commessaId, stato: "archiviata", force: true })`: `force` e consentito soltanto qui perché tutti i gate finali sono gia stati rivalidati dal servizio. Verificare la postcondizione rileggendo la commessa.

- [ ] **Step 5: Aggiornare prompt, card ed eval**

`Il lavoro e finito` deve prima chiamare `verifica_chiusura_commessa`. Con blocker: nessuna `chiudi_commessa`; mostra elenco concreto. Senza blocker: una sola card di chiusura. La card elenca saldo, documenti, timeline e pratiche aperte tutte verificate.

- [ ] **Step 6: Verificare i test verdi**

Run: `pnpm exec vitest run server/tars/tars.test.ts server/tars/closureReadiness.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/tars/stores.ts server/tars/tools.ts server/tars/esecutore.ts server/routers/tars.ts server/tars/tars.test.ts client/src/components/TarsPropostaCard.tsx server/tars/evals/cases/core.json
git commit -m "feat(tars): close jobs by verified outcome"
```

### Task 6: Ridurre proposte inutili e verificare la conversazione

**Files:**
- Modify: `server/tars/prompt.ts`
- Modify: `server/tars/tars.test.ts`
- Modify: `server/tars/evals/cases/core.json`
- Modify: `PRD.md`
- Modify: `handoff.md`

**Interfaces:**
- Produces: regola verificata `informazione -> risposta`, `obiettivo bloccato -> blocker`, `mutation necessaria -> proposta`, `obiettivo pronto -> una proposta composta`.

- [ ] **Step 1: Aggiungere test/eval rossi**

Casi: `quali documenti mancano?` senza proposta; `il lavoro e finito` con saldo mancante senza avanzamento; stessa frase pronta con una `chiudi_commessa`; `crea cliente e commessa` con domanda assegnatario e proposta figlia visibile.

- [ ] **Step 2: Verificare il fallimento**

Run: `pnpm exec vitest run server/tars/tars.test.ts`

Expected: almeno un caso non rispetta ancora la policy.

- [ ] **Step 3: Aggiornare il prompt con ordine decisionale**

Prima identifica se la richiesta e informativa, mutation singola o obiettivo. Vietare proposte decorative, passaggi intermedi gia impliciti nell'obiettivo e duplicati. Richiedere una motivazione basata su evidence refs per ogni proposta.

- [ ] **Step 4: Aggiornare PRD e handoff**

Documentare albero conversazionale, polling finito, postcondizione cliente/commessa, closure readiness, proposta high-risk e regola di non-proposta.

- [ ] **Step 5: Verifica completa**

Run: `pnpm check && pnpm test && pnpm build && git diff --check`

Expected: quattro exit code 0.

- [ ] **Step 6: QA browser**

A 1440x900 e 390x844: chiedere la creazione cliente/commessa con assegnatario mancante, rispondere, approvare la card figlia nello stesso messaggio e verificare successo; chiedere chiusura di una commessa bloccata e verificare elenco blocker senza proposta di avanzamento.

- [ ] **Step 7: Commit**

```bash
git add server/tars/prompt.ts server/tars/tars.test.ts server/tars/evals/cases/core.json PRD.md handoff.md
git commit -m "docs(tars): define goal-oriented chat behavior"
```
