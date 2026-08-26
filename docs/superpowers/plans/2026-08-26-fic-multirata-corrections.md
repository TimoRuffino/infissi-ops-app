# Correzioni pagamento FiC multirata - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Impedire che uno stesso pagamento manuale venga riutilizzato per piu rate FiC e mostrare con chiarezza l'effetto economico di ogni correzione proposta da Tars.

**Architecture:** La riconciliazione mantiene una relazione uno-a-uno tra pagamento manuale e rata FiC attiva. Il sync esclude i pagamenti gia occupati, ripara i vecchi collegamenti duplicati scegliendo il link compatibile con i dati CRM e lascia alla rata restante un movimento FiC separato. L'approvazione rivalida i link vivi prima di modificare il registro; il client deriva dal fingerprint un confronto corrente/proposto e il delta sull'incassato.

**Tech Stack:** TypeScript, tRPC 11, React 19, Vitest, Tailwind 4, shadcn/Radix.

**Spec:** `docs/superpowers/specs/2026-08-26-fic-pagamenti-allegati-design.md`

## Global Constraints

- Lavorare direttamente su `main`, come autorizzato esplicitamente dall'utente.
- FiC fa fede per rate, importi, date e storni; il pattuito resta CRM.
- `importoIncassato` deriva solo dai pagamenti attivi e non e un input.
- Un pagamento manuale non viene mai mutato dal sync.
- Tars propone e non esegue senza approvazione.
- Ogni lookup e mutation resta `sedeId` scoped.
- Usare gli helper euro esistenti e token semantici, senza hex locali.
- Verificare desktop 1440x900 e mobile 390x844.

---

### Task 1: Vincolo uno-a-uno tra pagamento manuale e rata FiC

**Files:**
- Modify: `server/routers/ficPagamenti.test.ts`
- Modify: `server/routers/ficPagamenti.ts`

**Interfaces:**
- Consumes: `ficPaymentLinks`, `pagamentoCompatibile`, `patchForManual`.
- Produces: `trovaConflittoRiconciliazioneManuale(input): RiconciliazioneRataFic | undefined` e riconciliazione convergente dei link duplicati.

- [x] **Step 1: Scrivere il test fallente del caso reale multirata**

  Creare una fattura con due rate pagate (`1.762,67` il `2026-01-26` e `1.410,14` il `2026-02-10`) e un solo pagamento manuale con nota `Fattura FIC <numero>`. Verificare che la prima rata usi il manuale, la seconda crei un pagamento FiC, che non esista una correzione contro il primo pagamento e che l'incassato sia il letterale `3_172.81`.

- [x] **Step 2: Eseguire il test e verificare il RED**

  Run: `pnpm vitest run server/routers/ficPagamenti.test.ts`

  Expected: FAIL perche oggi entrambe le rate selezionano lo stesso pagamento manuale e la seconda genera `correggi_manuale`.

- [x] **Step 3: Implementare il filtro minimo**

  Escludere da `manualCandidates` i pagamenti manuali gia collegati a una diversa source key attiva nella stessa sede e commessa.

- [x] **Step 4: Aggiungere il test fallente per i link storici duplicati**

  Preparare due link manuali attivi verso lo stesso pagamento, uno per ogni rata. Verificare che il sync conservi il link compatibile con importo/data del pagamento, superi quello errato e riconcili la seconda rata con un movimento FiC separato.

- [x] **Step 5: Riparare i link duplicati in modo convergente**

  Prima di usare un link manuale esistente, confrontare tutti i link concorrenti sullo stesso pagamento. Conservare quello con compatibilita esatta; a parita usare il link piu vecchio/id minore. Marcare gli altri `superata`, poi riconciliare normalmente le relative rate.

- [x] **Step 6: Verificare il GREEN**

  Run: `pnpm vitest run server/routers/ficPagamenti.test.ts`

  Expected: PASS con un solo link manuale attivo per pagamento.

### Task 2: Blocco delle approvazioni obsolete

**Files:**
- Modify: `server/tars/ficPaymentProposals.test.ts`
- Modify: `server/tars/ficPaymentProposals.ts`
- Modify: `server/routers/commesse.ts`

**Interfaces:**
- Consumes: `trovaConflittoRiconciliazioneManuale`, payload `correzione_pagamento`.
- Produces: proposta `superata` quando la source FiC punta gia altrove; errore `PRECONDITION_FAILED` senza mutazioni quando un'approvazione e stale.

- [x] **Step 1: Scrivere i test fallenti**

  Verificare separatamente che `superaProposteFicObsolete` superi una correzione quando la stessa source FiC e gia collegata a un altro pagamento e che l'approvazione diretta non modifichi importo, stato o `importoIncassato`.

- [x] **Step 2: Eseguire il test e verificare il RED**

  Run: `pnpm vitest run server/tars/ficPaymentProposals.test.ts`

  Expected: FAIL perche il link verso un pagamento differente non rende oggi obsoleta la proposta.

- [x] **Step 3: Implementare le guardie vive**

  Aggiornare `correzioneObsoleta` affinche qualsiasi link attivo della source verso un pagamento diverso renda la proposta superata. In `commesse.correggiPagamento`, controllare il conflitto prima di applicare la patch e restituire `PRECONDITION_FAILED` con invito a risincronizzare.

- [x] **Step 4: Verificare il GREEN**

  Run: `pnpm vitest run server/tars/ficPaymentProposals.test.ts server/routers/ficPagamenti.test.ts`

  Expected: PASS; nessuna correzione stale cambia il registro.

### Task 3: Confronto CRM/FiC ed effetto sull'incassato

**Files:**
- Modify: `client/src/lib/paymentView.test.ts`
- Modify: `client/src/lib/paymentView.ts`
- Modify: `client/src/components/TarsPropostaCard.tsx`

**Interfaces:**
- Consumes: `expectedFingerprint` nel formato `importo|data|stato` e `patch` della proposta.
- Produces: `presentPaymentCorrection(payload)` con valori correnti/proposti e delta di incassato.

- [x] **Step 1: Scrivere il test fallente del presenter**

  Usare il fingerprint letterale `1762.67|2026-01-26|attivo` e la patch `{ importo: 1410.14, data: "2026-02-10" }`. Verificare valori correnti, valori FiC e delta letterale `-352.53`; aggiungere i casi `stornato` e fingerprint non leggibile.

- [x] **Step 2: Eseguire il test e verificare il RED**

  Run: `pnpm vitest run client/src/lib/paymentView.test.ts`

  Expected: FAIL perche `presentPaymentCorrection` non esiste.

- [x] **Step 3: Implementare il presenter puro**

  Parsare il fingerprint senza dipendere dal server, applicare la patch e calcolare `contributoProposto - contributoCorrente`, considerando soltanto lo stato `attivo`.

- [x] **Step 4: Rendere esplicita la card**

  Sostituire le righe generiche della correzione con due colonne responsive `Nel CRM ora` e `FiC propone`, mostrando importo, data e stato. Aggiungere `Effetto sull'incassato: invariato`, `aumenta di ...` o `diminuisce di ...`; rinominare il bottone in `Applica correzione`. Per i candidati ambigui mostrare il confronto corrente/proposto nella scelta.

- [x] **Step 5: Verificare il GREEN**

  Run: `pnpm vitest run client/src/lib/paymentView.test.ts`

  Expected: PASS.

### Task 4: Documentazione, QA e consegna su main

**Files:**
- Modify: `docs/superpowers/specs/2026-08-26-fic-pagamenti-allegati-design.md`
- Modify: `handoff.md`

**Interfaces:**
- Consumes: comportamento verificato dei Task 1-3.
- Produces: contratto operativo aggiornato e commit su `main`.

- [x] **Step 1: Aggiornare il contratto**

  Esplicitare che un pagamento manuale puo appartenere a una sola riconciliazione FiC attiva e che ogni card mostra sempre effetto sull'incassato prima dell'approvazione.

- [x] **Step 2: Verificare l'interfaccia**

  Avviare il CRM locale e controllare la card a `1440x900` e `390x844`, senza scroll orizzontale o errori console.

- [x] **Step 3: Eseguire tutte le verifiche**

  Run: `pnpm check && pnpm test && pnpm build`

  Expected: tre comandi con exit code `0`.

- [ ] **Step 4: Controllare il diff e fare commit**

  Verificare `git diff --check`, `git status --short` e il diff limitato ai file del piano. Commit: `fix(fic): prevent duplicate installment payments`.
