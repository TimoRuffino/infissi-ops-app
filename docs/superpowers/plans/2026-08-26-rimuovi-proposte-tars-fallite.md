# Rimozione Proposte Tars Fallite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettere all'utente di eliminare dalla propria vista una proposta Tars fallita, conservandola nel registro audit.

**Architecture:** La proposta resta nello store persistito e riceve una lista di utenti che l'hanno rimossa. Le query Tars e l'idratazione della chat escludono tali proposte per l'utente corrente; una mutation sede-scoped consente l'operazione solo su proposte in stato `errore`. La card usa il dialogo di conferma condiviso e invalida tutte le viste Tars.

**Tech Stack:** TypeScript, tRPC 11, React 19, React Query, shadcn/Radix, Vitest.

**Spec:** Approvazione dell'utente nella conversazione del 26 agosto 2026.

## Global Constraints

- Conservare audit e deduplicazione: nessuna cancellazione fisica della proposta.
- Applicare `sedeId` e visibilità utente a ogni mutation e query.
- Mostrare l'azione soltanto per proposte in stato `errore`.
- Usare token semantici, icone Lucide e dialogo di conferma accessibile.

---

### Task 1: Contratto server e regressione

**Files:**
- Modify: `server/tars/stores.ts`
- Modify: `server/routers/tars.ts`
- Test: `server/tars/tars.test.ts`

**Interfaces:**
- Produces: `tars.proposte.rimuovi({ id: number }) -> { success: true }`
- Produces: `Proposta.hiddenForUserIds: number[]`

- [x] Scrivere test che provano rimozione personale, conservazione audit, isolamento tra utenti e rifiuto per proposte non fallite.
- [x] Eseguire il test mirato e verificare il fallimento RED.
- [x] Aggiungere backfill, filtro di visibilità, filtro chat e mutation sede-scoped.
- [x] Rieseguire il test mirato e verificare il passaggio GREEN.

### Task 2: Azione accessibile nella card

**Files:**
- Modify: `client/src/components/TarsPropostaCard.tsx`

**Interfaces:**
- Consumes: `tars.proposte.rimuovi({ id })`
- Produces: pulsante `Elimina` per stato `errore` con `ConfirmDialog`.

- [x] Collegare mutation, stato dialogo, feedback di successo/errore e invalidazione cache.
- [x] Mantenere il recupero “Riprendi dal punto interrotto” come azione primaria e l'eliminazione come azione distruttiva secondaria.

### Task 3: Verifica e documentazione

**Files:**
- Modify: `handoff.md`
- Modify: `documento_requisiti_infissi_ops.md`

**Interfaces:**
- Produces: contratto operativo documentato.

- [x] Aggiornare PRD e handoff con la semantica di rimozione personale.
- [x] Eseguire `pnpm check`, `pnpm test` e `pnpm build`.
- [x] Controllare il diff e lo stato Git prima della consegna.
