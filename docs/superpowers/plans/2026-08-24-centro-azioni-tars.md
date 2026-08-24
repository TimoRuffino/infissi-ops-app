# Centro Azioni Tars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the noisy read/unread notification list with a persistent, deduplicated action workflow assisted by Tars.

**Architecture:** Pure domain signal generators feed a PostgreSQL-backed action-case repository with an in-memory development adapter. A reconciler groups signals, maintains lifecycle and auto-resolution, while a separate queued Tars enrichment layer adds explanations and approvable proposals without entering read paths. The rollout keeps the legacy engine available until shadow comparison and browser verification pass.

**Tech Stack:** TypeScript, Express, tRPC 11, PostgreSQL/postgres-js, React 19, React Query, Radix/shadcn, Tailwind 4, Vitest, OpenAI Responses API.

**Spec:** `docs/superpowers/specs/2026-08-24-centro-azioni-tars-design.md`

## Global Constraints

- Tars proposes; it never executes business mutations without approval.
- Every case, query, mutation and evidence link is scoped by `sedeId`.
- A cross-site id must return `NOT_FOUND`, not information about the record.
- OpenAI is never called by bell, count, list or page-open read paths.
- Deterministic critical cases cannot be hidden or downgraded by AI output.
- No email bodies, file blobs, access tokens or complete customer payloads are stored in cases or logs.
- The legacy notification engine remains available until shadow comparison passes.
- The frontend must use semantic tokens and remain free of global horizontal scrolling.
- Verify the UI at `1440x900` and `390x844` with `prefers-reduced-motion` respected.

---

### Task 1: Pure signal engine

**Files:**
- Create: `server/actionCenter/types.ts`
- Create: `server/actionCenter/signals.ts`
- Create: `server/actionCenter/signals.test.ts`
- Read patterns from: `server/routers/notifiche.ts`

**Interfaces:**
- Produces: `ActionSignal`, `ActionCaseDraft`, `ActionPriority`, `ActionStatus`, `ActionTargetType`.
- Produces: `collectActionSignals(input: ActionSignalInput): ActionSignal[]`.
- Produces: `groupSignals(signals: ActionSignal[], now: Date): ActionCaseDraft[]`.
- Consumes plain snapshots only; this module must not import routers, persistence or OpenAI.

- [ ] **Step 1: Write failing tests for the production noise pattern**

  Cover aging + daily + role routing on the same commessa and assert one grouped case, with all evidence preserved and one deterministic next action.

- [ ] **Step 2: Run the focused test and verify RED**

  Run: `pnpm vitest run server/actionCenter/signals.test.ts`

- [ ] **Step 3: Define the domain types**

  Include stable source keys, canonical case key, target references, deterministic priority, assignee candidates, due/review dates, link, compact evidence and fingerprint inputs.

- [ ] **Step 4: Port existing notification rules as pure generators**

  Cover priority aging, state routing, bottleneck reminders, missing delivery date, residual balance, warranties, tickets and unassigned interventions. Replace generic `updatedAt` aging where a specific resolving fact exists.

- [ ] **Step 5: Implement grouping and next-action selection**

  Group duplicate symptoms for the same situation; keep secondary signals as evidence. Use stable sorting and never discard a critical signal.

- [ ] **Step 6: Add boundary tests**

  Cover archived records, role routing, unlinked tickets, stable fingerprints, deterministic order, date boundaries and no signals for resolved conditions.

- [ ] **Step 7: Run focused tests and type-check**

  Run: `pnpm vitest run server/actionCenter/signals.test.ts && pnpm check`

- [ ] **Step 8: Commit**

  Commit: `feat(actions): add deterministic signal engine`

---

### Task 2: Persistent action-case repository

**Files:**
- Create: `server/actionCenter/repository.ts`
- Create: `server/actionCenter/repository.test.ts`
- Modify: `server/_core/index.ts`
- Reference: `server/tars/comunicazioni.ts`
- Reference: `server/_core/persistence.ts`

**Interfaces:**
- Produces: `ActionCaseRepository` with `ensureSchema`, `upsertDraft`, `findById`, `findByCanonicalKey`, `list`, `transition`, `appendEvent`, `listPendingAnalysis` and `markAnalysis`.
- Produces: `getActionCaseRepository(): ActionCaseRepository`.
- Produces an in-memory adapter with the same behavior when `DATABASE_URL` is absent.
- Consumes `ActionCaseDraft` from Task 1.

- [ ] **Step 1: Write failing repository contract tests**

  Assert unique `(sedeId, canonicalKey)`, fingerprint-preserving upsert, status retention, event append, cursor listing and `NOT_FOUND` behavior.

- [ ] **Step 2: Run the focused test and verify RED**

  Run: `pnpm vitest run server/actionCenter/repository.test.ts`

- [ ] **Step 3: Implement idempotent schema creation**

  Create `azioni_operative` and `azioni_operative_eventi` using `kvSql`, additive schema operations and indexed hot paths defined in the spec.

- [ ] **Step 4: Implement row mapping and JSON validation**

  Rehydrate dates, default additive fields and reject malformed status/priority values without exposing raw rows.

- [ ] **Step 5: Implement memory and PostgreSQL adapters**

  Keep semantics identical. Use compare-and-set inputs for state/fingerprint-sensitive transitions.

- [ ] **Step 6: Wire schema bootstrap**

  Initialize the repository after `bootstrapAll()` and before schedulers start. A schema failure must be visible and retryable, not silently replaced by memory in production.

- [ ] **Step 7: Run focused tests and type-check**

  Run: `pnpm vitest run server/actionCenter/repository.test.ts && pnpm check`

- [ ] **Step 8: Commit**

  Commit: `feat(actions): persist operational cases`

---

### Task 3: Reconciliation, lifecycle and shadow mode

**Files:**
- Create: `server/actionCenter/sources.ts`
- Create: `server/actionCenter/reconcile.ts`
- Create: `server/actionCenter/reconcile.test.ts`
- Create: `server/actionCenter/scheduler.ts`
- Modify: `server/_core/index.ts`
- Modify: `server/routers/notifiche.ts`

**Interfaces:**
- Produces: `collectCurrentSignals(ctx: ActionSystemContext): Promise<ActionSignal[]>`.
- Produces: `reconcileActionCases(input): Promise<ReconcileResult>`.
- Produces: `scheduleActionReconcile(sedeId, target?)` and `startActionCenterScheduler()`.
- Produces: `ACTION_CENTER_MODE` parser for `legacy | shadow | active`, defaulting to `shadow` in production.
- Consumes domain stores and repository from Tasks 1-2.

- [ ] **Step 1: Write failing reconciliation tests**

  Cover create, unchanged no-op, material update, automatic resolution, meaningful reopen, snoozed-case wake-up and no duplicate event on repeated runs.

- [ ] **Step 2: Run the focused test and verify RED**

  Run: `pnpm vitest run server/actionCenter/reconcile.test.ts`

- [ ] **Step 3: Build source adapters**

  Snapshot current commesse, ticket, warranties, interventions and pending Tars proposals. Keep communication queues in their domain pages; only actionable Tars decisions enter the Center.

- [ ] **Step 4: Implement reconciliation**

  Preserve explicit operator state when the fingerprint is unchanged, auto-resolve absent signals, wake changed snoozed cases, and queue analysis only for new/materially changed high-priority cases.

- [ ] **Step 5: Implement shadow metrics**

  Compare legacy visible count, new cases, grouped signals, missing critical keys and duplicate suppression. Log only aggregate counts by site.

- [ ] **Step 6: Add scheduler and debounce**

  Reconcile after boot, every minute as catch-up, and through target-scoped debounce hooks. Prevent overlapping runs per site.

- [ ] **Step 7: Keep legacy router behavior intact in shadow mode**

  Existing `list`, `count`, `markRead` and `markAllRead` remain untouched until Task 7 switches the client.

- [ ] **Step 8: Run focused and regression tests**

  Run: `pnpm vitest run server/actionCenter/reconcile.test.ts server/tars/commandCenter.test.ts && pnpm check`

- [ ] **Step 9: Commit**

  Commit: `feat(actions): reconcile cases in shadow mode`

---

### Task 4: Action Center API and permissions

**Files:**
- Create: `server/actionCenter/service.ts`
- Create: `server/actionCenter/service.test.ts`
- Modify: `server/routers/notifiche.ts`
- Create: `server/routers/notifiche.test.ts`
- Reference: `server/_core/permissions.ts`

**Interfaces:**
- Produces router procedures: `summary`, `cases.list`, `cases.detail`, `cases.take`, `cases.assign`, `cases.snooze`, `cases.waitFor`, `cases.resolve`, `cases.dismiss`, `brief`.
- Produces: `ActionCenterSummary`, `ActionCaseListItem`, `ActionCaseDetail`.
- Consumes repository and reconciler from Tasks 2-3.

- [ ] **Step 1: Write failing API tests**

  Cover personal versus site view, role gates, cross-site `NOT_FOUND`, active-user assignment, stale fingerprint rejection and each lifecycle transition.

- [ ] **Step 2: Run the focused test and verify RED**

  Run: `pnpm vitest run server/routers/notifiche.test.ts server/actionCenter/service.test.ts`

- [ ] **Step 3: Implement summary and paginated list**

  Badge counts only personal critical/high cases due now. Site view is role-gated. Return compact DTOs and cursor pagination.

- [ ] **Step 4: Implement detail and evidence resolution**

  Return compact evidence descriptors and safe deep links. Re-check source permissions when resolving details.

- [ ] **Step 5: Implement lifecycle mutations**

  Require valid date/reason combinations, append audit events, invalidate affected queries and reject stale state transitions.

- [ ] **Step 6: Implement brief**

  Aggregate non-actionable signals and repeated snoozes deterministically without OpenAI.

- [ ] **Step 7: Run focused tests and type-check**

  Run: `pnpm vitest run server/routers/notifiche.test.ts server/actionCenter/service.test.ts && pnpm check`

- [ ] **Step 8: Commit**

  Commit: `feat(actions): expose scoped action workflow`

---

### Task 5: Tars enrichment and proposals

**Files:**
- Create: `server/actionCenter/tars.ts`
- Create: `server/actionCenter/tars.test.ts`
- Modify: `server/tars/tools.ts`
- Modify: `server/tars/prompt.ts`
- Modify: `server/tars/loop.ts`
- Modify: `server/tars/tars.test.ts`
- Modify: `server/routers/notifiche.ts`

**Interfaces:**
- Produces: `scheduleCaseAnalysis(caseId)` and `runQueuedCaseAnalysis(sedeId)`.
- Produces tool profile `centro_azioni` and trigger `centro_azioni`.
- Produces procedure `cases.requestTarsAnalysis` with rate limiting.
- Consumes `runTars`, existing read tools and `azioni_suggerite` proposal workflow.

- [ ] **Step 1: Write failing Tars contract tests**

  Assert no analysis for unchanged fingerprints, batch limits, compact prompt, tool profile size, fallback on provider error and linked proposal ids.

- [ ] **Step 2: Run focused tests and verify RED**

  Run: `pnpm vitest run server/actionCenter/tars.test.ts server/tars/tars.test.ts`

- [ ] **Step 3: Add the minimal tool profile and prompt**

  Include only cross-domain reads and proposal tools needed for the case. Require evidence, one recommended next action, at most two alternatives and a question when confidence is insufficient.

- [ ] **Step 4: Use the automatic model and existing caching**

  Add `centro_azioni` to economical triggers, preserve prompt cache segmentation and preload the commessa dossier when available.

- [ ] **Step 5: Implement queued analysis**

  Claim only new/materially changed cases, mark status transitions, persist sanitized summary/evidence/proposal references and retry without blocking deterministic reads.

- [ ] **Step 6: Add duplicate-decision protections**

  Reuse canonical proposal keys and do not recreate rejected or decided actions unless evidence fingerprint changed materially.

- [ ] **Step 7: Add manual analysis endpoint**

  Permission-check, rate-limit per case/user and return current analysis immediately when the fingerprint is still valid.

- [ ] **Step 8: Run Tars tests and type-check**

  Run: `pnpm vitest run server/actionCenter/tars.test.ts server/tars/tars.test.ts server/tars/commandCenterApi.test.ts && pnpm check`

- [ ] **Step 9: Commit**

  Commit: `feat(tars): analyze and propose from action cases`

---

### Task 6: Command Center backend integration

**Files:**
- Modify: `server/tars/commandCenter.ts`
- Modify: `server/tars/commandCenter.test.ts`
- Modify: `server/tars/commandCenterApi.test.ts`
- Modify: `server/routers/tars.ts`

**Interfaces:**
- Extends: `TarsCommandCenterSnapshot` with `actionSummary`, `cases` and deterministic `brief` counts.
- Preserves: proposal, execution, cache and error metrics currently exposed.
- Consumes Action Center service from Task 4.

- [ ] **Step 1: Write failing snapshot tests**

  Assert that zero pending proposals no longer means zero priorities when action cases exist, and that brief/badge counts agree.

- [ ] **Step 2: Run focused tests and verify RED**

  Run: `pnpm vitest run server/tars/commandCenter.test.ts server/tars/commandCenterApi.test.ts`

- [ ] **Step 3: Merge action cases into the snapshot**

  Use case priority as the primary Oggi list. Keep proposals as linked decisions and in the Proposte tab rather than duplicate rows.

- [ ] **Step 4: Preserve degraded/disabled semantics**

  Tars disabled or OpenAI unavailable affects enrichment status, not availability of deterministic action cases.

- [ ] **Step 5: Run focused tests and type-check**

  Run: `pnpm vitest run server/tars/commandCenter.test.ts server/tars/commandCenterApi.test.ts && pnpm check`

- [ ] **Step 6: Commit**

  Commit: `feat(tars): make action cases the daily brief`

---

### Task 7: Replace the bell experience

**Files:**
- Modify: `client/src/components/NotificheDropdown.tsx`
- Modify: `client/src/components/DashboardLayout.tsx`
- Create: `client/src/components/action-center/ActionBellItem.tsx`
- Create: `client/src/lib/actionCenter.ts`

**Interfaces:**
- Consumes: `trpc.notifiche.summary` and `trpc.notifiche.cases.list` with personal/due-now filters.
- Produces compact navigation to `/tars?tab=oggi&caso=<id>`.

- [ ] **Step 1: Add pure display helpers and tests where practical**

  Cover badge formatting (`0`, `1..9`, `9+`), overdue labels, severity color selection and reduced-motion-safe navigation behavior.

- [ ] **Step 2: Implement the new badge**

  Count only due personal cases, use red only for critical/overdue and expose a precise accessible label.

- [ ] **Step 3: Implement the three-item preview**

  Show next action, target, assignee and due date. Remove `Segna tutte lette`; add `Apri Centro Azioni`.

- [ ] **Step 4: Add loading, empty and failure states**

  A failed count must not show a false zero. Keep layout dimensions stable during refresh.

- [ ] **Step 5: Run check and build**

  Run: `pnpm check && pnpm build`

- [ ] **Step 6: Commit**

  Commit: `feat(ui): turn notification bell into action preview`

---

### Task 8: Build the full Tars Action Center UI

**Files:**
- Create: `client/src/components/action-center/ActionCenterList.tsx`
- Create: `client/src/components/action-center/ActionCenterFilters.tsx`
- Create: `client/src/components/action-center/ActionCaseDetail.tsx`
- Create: `client/src/components/action-center/ActionCaseActions.tsx`
- Modify: `client/src/pages/TarsCommandCenter.tsx`
- Modify: `client/src/lib/navigation.ts`

**Interfaces:**
- Consumes: Action Center summary/list/detail/mutations and existing Tars proposal components.
- Produces: filters `mie | sede | scadute | in_attesa` and query parameter `caso`.

- [ ] **Step 1: Implement stable route/query parsing**

  Preserve existing `tab` behavior and add a validated positive integer `caso` parameter.

- [ ] **Step 2: Replace TodayView with action summary and list**

  Show due now, waiting, resolved today and brief counts. Default to `Mie`; gate `Sede` by role.

- [ ] **Step 3: Build dense action rows**

  Show priority, target, next action, assignee, deadline and Tars confidence without nested cards.

- [ ] **Step 4: Build the detail panel**

  Use a side sheet on desktop and full-screen sheet on mobile. Include evidence deep links, history, analysis status and linked proposal actions.

- [ ] **Step 5: Build lifecycle dialogs**

  Add assignment, snooze and waiting controls with required dates/reasons. Use icons for familiar commands and clear text for consequential actions.

- [ ] **Step 6: Add optimistic updates with rollback**

  Invalidate summary, list, detail and Tars snapshot together. Explain stale-state conflicts and refresh the case.

- [ ] **Step 7: Run check, tests and build**

  Run: `pnpm check && pnpm test && pnpm build`

- [ ] **Step 8: Commit**

  Commit: `feat(ui): add Tars Action Center workflow`

---

### Task 9: Shadow comparison, activation and browser verification

**Files:**
- Modify: `server/actionCenter/reconcile.ts`
- Modify: `server/actionCenter/scheduler.ts`
- Modify: `server/routers/notifiche.ts`
- Modify: `client/src/components/NotificheDropdown.tsx`
- Modify tests from Tasks 3-8 as findings require.

**Interfaces:**
- Consumes: `ACTION_CENTER_MODE`.
- Produces aggregate comparison logs and a reversible switch from `shadow` to `active`.

- [ ] **Step 1: Run a local seeded comparison**

  Record legacy count, new case count, grouped signal count and missing critical keys. Do not use local in-memory counts as production evidence.

- [ ] **Step 2: Deploy shadow mode**

  Push the shadow-safe build, wait for Railway health, and inspect aggregate reconciliation logs without exposing customer payloads.

- [ ] **Step 3: Verify no critical legacy signal is missing**

  Investigate each missing canonical key and add a regression test before changing a rule.

- [ ] **Step 4: Activate the new reader**

  Set the production mode to `active` only after the comparison passes. Preserve the legacy endpoint and rollback switch.

- [ ] **Step 5: Verify desktop at `1440x900`**

  Check bell, badge, three-item preview, filters, detail panel, all lifecycle actions, Tars evidence links, console errors and layout stability.

- [ ] **Step 6: Verify mobile at `390x844`**

  Check touch targets, full-screen detail, wrapped text, no overlap, no global horizontal scroll and reduced motion.

- [ ] **Step 7: Verify production behavior**

  Confirm typical actionable count, automatic resolution, no daily respawn, assignment routing, OpenAI fallback and consistent Tars brief.

- [ ] **Step 8: Commit fixes from verification**

  Commit: `fix(actions): harden production rollout`

---

### Task 10: Documentation, full verification and handoff

**Files:**
- Modify: `documento_requisiti_infissi_ops.md`
- Modify: `handoff.md`
- Modify: `docs/superpowers/specs/2026-08-24-centro-azioni-tars-design.md` only if implementation decisions changed.

**Interfaces:**
- Documents exact production mode, rollback steps, schema, scheduler, Tars profile and verified metrics.

- [ ] **Step 1: Update PRD**

  Replace the v2 read/unread notification contract with Action Center lifecycle, Tars behavior and UI acceptance criteria. Add a changelog entry.

- [ ] **Step 2: Update handoff**

  Record schema bootstrap, environment mode, rollback, production verification, known limits and commands.

- [ ] **Step 3: Run full verification from a clean command start**

  Run: `pnpm check && pnpm test && pnpm build`

- [ ] **Step 4: Review final diff and secret scan**

  Run: `git diff --check`, inspect `git diff --stat`, and scan changed files for credentials or customer payloads.

- [ ] **Step 5: Commit documentation**

  Commit: `docs: document Tars Action Center rollout`

- [ ] **Step 6: Push and confirm remote state**

  Push `main`, verify local and remote hashes match, and report any external Railway configuration still required.

