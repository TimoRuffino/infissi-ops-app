# Modular Control Hardening and Release Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that the complete Modular Control / Borgogna Operativa migration covers every registered route, preserves authorization and tenant/privacy guarantees, works across the required viewport/theme/input matrix, meets the tested WCAG 2.2 AA criteria, respects Tars governance, remains performant, and can be rolled back globally through the existing UI flag.

**Architecture:** Treat hardening as an evidence-producing gate, not a cosmetic cleanup. Reconcile executable route/token/access contracts against the final code, run focused security and Tars regressions, then audit one representative of every page archetype at each required responsive regime. Store sanitized screenshots and concise audit records under `docs/design/modular-control/`. Compare final Vite chunks with the pre-migration baseline, verify both flag states without changing production, obtain independent reviews by concern, fix all Critical/High findings, and only then run the full project suite and write the handoff.

**Tech Stack:** React 19, TypeScript 5.9, Wouter, tRPC 11, TanStack React Query 5, Tailwind CSS 4, Radix/shadcn, Framer Motion, Recharts, Vitest, axe-core, Vite, in-app browser developer tools.

**Spec:** `docs/design/master-prompt-ruffino-flow-ui-ux-v3.md`

## Global Constraints

- Begin only after slices 01–04 are implemented and their focused suites pass.
- This slice may fix presentation, interaction, accessibility, performance, and client-isolation defects. It must not weaken a server guard, reshape protected payloads client-side, add a server contract for visual convenience, or change a business workflow.
- Do not use production data for QA. All screenshots, console captures, accessibility output, and stress fixtures must be synthetic and free of customer identifiers, contacts, messages, documents, and real amounts.
- Do not install a new visual-test framework merely for this gate. Use existing Vitest/axe-core plus the in-app browser unless a concrete blocker is documented and separately approved.
- A clean axe result is not by itself a whole-product WCAG claim. Record the exact routes, states, viewports, themes, and manual interactions tested.
- `FLAG_UI_V2` is global. Verify local `OFF` and `ON`; do not change Railway/staging/production configuration or claim rollout.
- Independent review findings must name route/file, viewport/state, severity, and remediation. Fix every Critical and High before completion; document deferred Medium findings with a concrete reason.
- Do not merge, push, deploy, open a PR, or remove the legacy fallback.

---

### Task 1: Reconcile route coverage and eradicate rejected runtime markers

**Files:**

- Modify: `client/src/lib/routeContract.test.ts`
- Modify: `client/src/lib/tokenDiscipline.test.ts`
- Create: `client/src/lib/uiMigrationCoverage.test.ts`
- Modify: `docs/design/modular-control/route-manifest.md`
- Modify: `docs/design/modular-control/transformation-matrix.md`
- Modify: `docs/design/modular-control/reference-extraction.md`
- Reference: `client/src/App.tsx`
- Reference: every file under `client/src/pages/`

**Test contract:**

- Every explicit and fallback route in `App.tsx` appears exactly once in the typed contract and human manifest.
- Every entry has status `migrata`, `redirect`, or `esclusa con motivazione`; `planned`, blank, and implicit states fail.
- Every `migrata` route names desktop/mobile evidence and a tested state.
- No runtime source contains `Frame & Flow`, `rf-frame`, `rf-rail`, `rf-reveal`, `rf-latch`, `data-ui-v2`, old yellow/petrol signature tokens, a Produzione page import, or a visible Produzione navigation label.
- Historical design documents may contain the old name only beside an explicit `Superseded` notice.

- [ ] **Step 1: Write the final migration-coverage tests and verify RED**

  Run: `pnpm vitest run client/src/lib/routeContract.test.ts client/src/lib/tokenDiscipline.test.ts client/src/lib/uiMigrationCoverage.test.ts`

  Expected: any unclassified route, missing evidence field, rejected selector, or stale runtime comment fails with its path.

- [ ] **Step 2: Reconcile `App.tsx`, contract, and manifest line by line**

  Preserve the exact redirect and deep-link semantics. Mark only genuinely migrated pages as `migrata`; use `redirect` for `/produzione/*?` and `/comunicazioni`; use `esclusa con motivazione` only for a deliberate, user-visible exclusion already authorized by the master prompt.

- [ ] **Step 3: Close the transformation matrix**

  Provide baseline and final evidence for at least shell, navigation, context bar, dashboard, list/queue, Record 360, workbench, inbox, and mobile form. Explain the UX delta; token swaps and wrapper-only changes do not count.

- [ ] **Step 4: Remove or rename remaining rejected runtime artifacts**

  Rename presentation-only legacy components such as `StatusRail` if still imported, while preserving functional state data. Delete dead selectors/comments and update imports. Do not remove historical compatibility fields or server domain terminology.

- [ ] **Step 5: Run focused tests and type-check**

  Run: `pnpm vitest run client/src/lib/routeContract.test.ts client/src/lib/tokenDiscipline.test.ts client/src/lib/uiMigrationCoverage.test.ts client/src/lib/navigation.test.ts client/src/lib/messaggi.test.ts && pnpm check`

- [ ] **Step 6: Commit**

  Commit: `test(ui): close route and migration coverage`

---

### Task 2: Prove authorization, tenant isolation, and economic privacy

**Files:**

- Modify: `client/src/lib/operationalContext.test.ts`
- Modify: `client/src/lib/navigation.test.ts`
- Modify: `client/src/lib/commandPalette.test.ts`
- Modify: `client/src/lib/paymentView.test.ts`
- Modify: `client/src/lib/economiaView.test.ts`
- Modify: `docs/design/modular-control/verification-log.md`
- Reference: `server/routers/authzEconomia.test.ts`
- Reference: `server/routers/permessi.test.ts`
- Reference: `server/routers/proposte.test.ts`
- Reference: `server/routers/commesse.test.ts`
- Reference: `server/routers/crossSede.test.ts`
- Reference: all changed economic/record route components

- [ ] **Step 1: Add missing client regression cases first**

  Cover a multi-role principal, override-only grant, explicit denial, expired/delegated absence in the effective set, active-sede switch, user A logout/user B login, capability change while a protected route is open, command-palette recents after context change, and unauthorized economic DTOs producing no renderable amount rows.

- [ ] **Step 2: Run focused tests and verify RED where coverage is missing**

  Run: `pnpm vitest run client/src/lib/operationalContext.test.ts client/src/lib/navigation.test.ts client/src/lib/commandPalette.test.ts client/src/lib/paymentView.test.ts client/src/lib/economiaView.test.ts`

- [ ] **Step 3: Fix presentation or isolation defects without weakening authority**

  Remove stale query/persisted state before committing a new scope, keep permission states explicit, and ensure protected fields never mount for unauthorized users. Do not fetch then hide an amount with CSS. Do not infer permission from a role when `permessi.mie` has resolved.

- [ ] **Step 4: Run server authorization regressions**

  Run: `pnpm vitest run server/routers/authzEconomia.test.ts server/routers/permessi.test.ts server/routers/proposte.test.ts server/routers/commesse.test.ts server/routers/crossSede.test.ts`

- [ ] **Step 5: Perform the browser privacy walkthrough**

  With sanitized fixtures, test direct unauthorized `/pagamenti`, `/economia`, `/marginalita`, `/fornitori`, `/utenti`, `/sedi`, and `/conoscenza`; inspect DOM/search/network response shape as appropriate. Switch sede while a customer, commessa, economy screen, and palette result are visible. Confirm no prior-context label, amount, actionable link, or cached row appears at any intermediate frame.

- [ ] **Step 6: Record evidence and commit**

  Record scenario, synthetic principals, expected/actual result, and test path in `verification-log.md` without including credentials or fixture payloads.

  Commit: `test(ui): verify access and context isolation`

---

### Task 3: Prove Tars and feature-flag safety

**Files:**

- Modify: `client/src/pages/Tars.tsx`
- Modify: `client/src/components/TarsBriefing.tsx`
- Modify: `client/src/components/TarsFascicoloCard.tsx`
- Modify: `client/src/lib/navigation.test.ts`
- Modify: `server/platform/interruttori.test.ts`
- Modify: `docs/design/modular-control/verification-log.md`
- Reference: `server/routers/tars.ts`
- Reference: `server/tars/orchestratore.test.ts`
- Reference: `server/tars/costi/confine.test.ts`
- Reference: `server/tars/costi/costi.test.ts`
- Reference: `server/tars/costi/integrazione.test.ts`
- Reference: `server/tars/t5Azioni.test.ts`
- Reference: `docs/tars/architettura-tars-v2.md`

**Safety contract:**

- Flag-off removes Tars navigation and renders a truthful unavailable/direct-link state without invoking Tars queries or provider code.
- Provider/budget/circuit distinctions are shown only when the typed response distinguishes them; otherwise show the returned generic degraded reason.
- Conversation history means only the principal's returned `conversazioni`/`turni`; audit means returned per-turn evidence/action outcome; direction cost data uses only `tars.costi`.
- Typing, command palette search, dashboard load, and opening `/tars` do not send a model request. Material proposals remain inert until a separately authorized human approval mutation.

- [ ] **Step 1: Add missing structural and flag tests**

  Assert Tars navigation needs both effective `tars.use` and the master flag, `/tars` direct-link flag-off does not mount query-enabled children, the composer has no mutation on `onChange`, and no UI label claims execution before returned audit state.

- [ ] **Step 2: Run Tars-focused tests and verify RED where needed**

  Run: `pnpm vitest run client/src/lib/navigation.test.ts server/platform/interruttori.test.ts server/tars/orchestratore.test.ts server/tars/costi/confine.test.ts server/tars/costi/costi.test.ts server/tars/costi/integrazione.test.ts server/tars/t5Azioni.test.ts`

- [ ] **Step 3: Correct only UI contract violations**

  Keep current router fields and procedure names. Remove fabricated monitoring/history/streaming states, autonomous wording, and provider-specific detail not supplied by the response. Preserve evidence links and approval affordances exactly as governed.

- [ ] **Step 4: Perform browser safety scenarios**

  Test master flag off, feature subflag off, generic provider degradation, budget/circuit state when actually typed, no conversation, pending response, returned error, proposal awaiting approval, rejected proposal, and principal without direction-only cost access. Inspect network activity while typing and opening the palette.

- [ ] **Step 5: Record evidence and commit**

  Commit: `test(ui): verify governed Tars states`

---

### Task 4: Complete the responsive and visual evidence matrix

**Files:**

- Create: `docs/design/modular-control/responsive-audit.md`
- Create directory through evidence files: `docs/design/modular-control/evidence/final/`
- Modify: `docs/design/modular-control/route-manifest.md`
- Modify: `docs/design/modular-control/transformation-matrix.md`
- Modify: route/component files only when a defect is observed

**Viewport matrix:**

- Desktop: 1440×900 and 1280×800.
- Tablet/compact: 1024×768 and 768×1024.
- Mobile: 390×844 and 360×800.
- Reflow: browser zoom 200% at 1280×800 and 390×844-equivalent CSS layout.

**Archetype routes:**

- Dashboard `/`.
- Data list `/clienti` and `/commesse`.
- Record 360 `/commesse/:id` and `/clienti/:id`.
- Workbench `/kanban`, `/planning`, and `/magazzino`.
- Inbox `/messaggi/email` and `/messaggi/whatsapp`.
- Governed intelligence `/tars` and `/fornitori` Document Intelligence state.
- Mobile form `/commesse/:commessaId/aperture/:aperturaId/rilievo` and `/verbale/:interventoId`.
- Administration `/integrazioni` and `/utenti`.
- Error/guard `/404` and one unauthorized direzione route.

- [ ] **Step 1: Define the audit table before browsing**

  For every archetype/viewport/theme combination, include columns for route/state, fixture, shell regime, global overflow, local overflow strategy, clipping, truncation affordance, sticky overlap, safe area, focus, console, screenshot, and issue ID.

- [ ] **Step 2: Capture required final screenshots**

  At minimum save light desktop, dark desktop, and mobile for each archetype using deterministic filenames such as `dashboard-1440x900-light.png`, `dashboard-1440x900-dark.png`, and `dashboard-390x844-light.png`. Add state suffixes (`-empty`, `-error`, `-permission`, `-degraded`) where the evidence depends on state.

- [ ] **Step 3: Run overflow and density checks at every viewport**

  In the browser evaluate `document.documentElement.scrollWidth === document.documentElement.clientWidth`, inspect every local table/workbench scroller, and complete the primary task without relying on hover. Verify long names, company names, addresses, many badges, large/negative allowed amounts, long lists, many attachments, partial errors, offline/refetch, and text zoom.

- [ ] **Step 4: Compare against baseline and reference rules**

  Update the transformation matrix with exact before/after files. Confirm the result preserves only the allowed abstract traits, not the source layout, palette, avatar, finance dashboard, chart silhouette, or module arrangement.

- [ ] **Step 5: Fix and re-capture defects**

  Fix clipping, overlap, hidden actions, illegible density, global overflow, or generic-card regressions in the owning shared pattern first. Keep superseded screenshots out of the final evidence directory.

- [ ] **Step 6: Commit**

  Commit: `test(ui): record responsive visual evidence`

---

### Task 5: Complete the accessibility protocol by archetype

**Files:**

- Modify: `scripts/audit-a11y.md`
- Create: `docs/design/modular-control/accessibility-audit.md`
- Modify: affected components/pages only when a defect is observed
- Reference: `docs/design/modular-control/contrast-report.md`

- [ ] **Step 1: Update the axe procedure to the final route set**

  Include one route for every archetype plus both themes and desktop/mobile viewport instructions. Use the existing temporary `axe-core` browser injection, exclude no rule without a written justification, and ensure the temporary public asset is absent before build/commit.

- [ ] **Step 2: Run axe in both themes and target viewports**

  Record route, state, viewport, theme, violation ID, impact, affected control, owning file, resolution, and rerun result. Treat serious/critical findings as release blockers.

- [ ] **Step 3: Complete keyboard-only workflows**

  Test skip link, sidebar/drawer, context bar, command palette, filters, sortable/table row actions, dialogs/sheets, commessa tabs/inspector, Kanban alternative to drag, inbox selection, Tars composer/proposal action, rilievo validation/save, and destructive confirmation. Verify focus restoration and no trap.

- [ ] **Step 4: Complete manual WCAG checks**

  Verify heading/landmark order, accessible names and descriptions, status not color-only, error identification, target size, focus visibility/non-obscuration, 200% reflow, screen-reader announcements for meaningful changes only, mobile keyboard not covering active input/submit, and decorative icons hidden.

- [ ] **Step 5: Verify reduced motion**

  Emulate `prefers-reduced-motion: reduce`; route/page transitions must resolve directly, drawers/dialogs remain understandable, skeletons do not shimmer aggressively, and no information depends on animation.

- [ ] **Step 6: Fix, rerun, and state the scope honestly**

  The audit conclusion must say “no detected WCAG A/AA violations on the recorded surfaces” only if true; it must not claim certification of untested product states.

- [ ] **Step 7: Commit**

  Commit: `fix(ui): close accessibility audit findings`

---

### Task 6: Verify state continuity, motion interruption, and console cleanliness

**Files:**

- Create: `docs/design/modular-control/interaction-audit.md`
- Modify: affected pages/components only when a defect is observed
- Reference: `client/src/components/PageContainer.tsx`
- Reference: `client/src/components/patterns/StatePanel.tsx`
- Reference: communication selection helpers and form state code

- [ ] **Step 1: Audit shared state semantics**

  For each archetype, verify first load, background refetch, empty, unavailable, permission, partial error, retry, mutation pending, stale/conflict, success, and destructive confirmation. A refetch must not revert to a first-load skeleton or discard selected rows/drafts.

- [ ] **Step 2: Interrupt real interactions**

  Rapidly change route, close/reopen drawers/dialogs, switch tabs, start then cancel filters, navigate back/forward, change viewport, and trigger refetch during motion. Confirm focus and state settle deterministically with no ghost overlay or stuck scroll lock.

- [ ] **Step 3: Verify form and selection continuity**

  Exercise unsaved rilievo/verbale/preventivatore data, inbox selection/deep links, Kanban filter state, planning date, and commessa active section. Preserve established URL/query state and warn only where an existing unsaved-change contract exists.

- [ ] **Step 4: Audit browser console and network failures**

  Visit every route contract entry in both an allowed and relevant denied/flag-off state. Record zero new uncaught errors, React key/hydration warnings, failed asset requests, repeated query loops, or provider calls caused by presentation.

- [ ] **Step 5: Fix and commit**

  Commit: `fix(ui): harden interaction state continuity`

---

### Task 7: Compare performance and bundle output

**Files:**

- Create: `docs/design/modular-control/performance-report.md`
- Modify: `vite.config.ts` only if a measured regression requires a justified chunk correction
- Modify: affected frontend modules only when measurement identifies a regression
- Reference: `docs/design/modular-control/performance-baseline.md`

- [ ] **Step 1: Produce a fresh production build**

  Run: `pnpm build`

  Record total built JS/CSS bytes and each `dist/public/assets` chunk using `find dist/public/assets -maxdepth 1 -type f -exec wc -c {} + | sort -n`.

- [ ] **Step 2: Compare with the pre-migration baseline**

  Use `docs/design/modular-control/performance-baseline.md`, recorded before Slice 01. Explain deltas by chunk and feature; do not compare only gzip labels or hide a large shared-chunk increase behind lazy routes.

- [ ] **Step 3: Inspect runtime loading**

  In a clean browser session, verify route lazy loading remains intact, no new animation library exists, no PDF/image preview preloads unnecessarily, shell queries are deduplicated, no Tars/provider call occurs during typing, and layout shifts are bounded by real skeleton silhouettes.

- [ ] **Step 4: Correct unjustified regressions**

  Prefer code splitting, removing dead imports, memoizing expensive derived tables/charts, and CSS over adding libraries. Any accepted increase must name its user-visible value and measured size.

- [ ] **Step 5: Rebuild and commit**

  Run: `pnpm build && pnpm check`

  Commit: `perf(ui): verify Modular Control delivery cost`

---

### Task 8: Obtain independent reviews and close findings

**Files:**

- Create: `docs/design/modular-control/independent-review.md`
- Modify: affected implementation/evidence files for fixes
- Modify: `docs/design/modular-control/verification-log.md`

**Review streams:**

- Visual coherence, anti-copy, and anti-template.
- Operational UX, density, and domain fit.
- Responsive/mobile and accessibility.
- Roles, effective capabilities, tenant isolation, and economic privacy.
- Tars governance and feature-off behavior.
- Performance, bundle, and unnecessary rerender/loading behavior.

- [ ] **Step 1: Assign independent reviewers with bounded scopes**

  Give each reviewer the master prompt, route/evidence matrix, relevant code diff, and exact routes/viewports. Require concrete findings with severity (`Critical`, `High`, `Medium`, `Low`), evidence, file/route, and recommended correction.

- [ ] **Step 2: Consolidate without softening severity**

  Deduplicate only identical findings. Record reviewer identity as an agent/person role and whether the review was independent or self-review.

- [ ] **Step 3: Fix all Critical and High findings**

  Add focused regression tests before each behavioral/accessibility fix. Re-run the owning route/browser scenario and update its evidence. Do not defer a High because the full suite is otherwise green.

- [ ] **Step 4: Resolve Medium/Low disposition**

  Fix safe in-scope issues. For every deferred Medium, record impact, reason, owner/future trigger, and why it does not violate the master prompt Definition of Done.

- [ ] **Step 5: Rerun affected suites and commit**

  Commit: `fix(ui): resolve independent review findings`

---

### Task 9: Verify rollback and complete current documentation

**Files:**

- Modify: `docs/design/ruffino-flow-ui-v2.md`
- Modify: `docs/design/ruffino-flow-tokens.md`
- Modify: `docs/design/ruffino-flow-motion.md`
- Modify: `docs/design/ruffino-flow-responsive.md`
- Modify: `docs/design/ruffino-flow-page-matrix.md`
- Modify: `handoff.md`
- Modify: `docs/design/modular-control/verification-log.md`
- Create: `docs/design/modular-control/final-handoff.md`

- [ ] **Step 1: Replace stale current-state documentation**

  Make the master prompt and `docs/design/modular-control/*` the active visual authority. Retain historical Frame & Flow content only with unambiguous superseded notices. Update route/page/responsive matrices to the actual final implementation.

- [ ] **Step 2: Verify local flag OFF**

  Start locally with an explicit production-like `FLAG_UI_V2=off` configuration that does not touch external services. Confirm legacy shell, authentication boundary, routes, deep links, reads, and mutations remain usable; the Modular Control root marker/components are absent; no migration or state rewrite occurs.

- [ ] **Step 3: Verify local flag ON**

  Start with `FLAG_UI_V2=on`; confirm the one enabled identity is Modular Control, not a mixed skin. Recheck at least Dashboard, Commessa, Kanban, Tars flag state, and Rilievo mobile.

- [ ] **Step 4: Document the real rollout boundary**

  State that the flag is global and process-scoped; per-user/role/sede rollout was not implemented; Railway/staging/production flags were not changed; deploy, monitoring, rollback in production, merge, push, and PR were not performed.

- [ ] **Step 5: Write the final handoff**

  Include migrated routes, visual system, evidence index, accessibility scope/results, tests, bundle delta, flag behavior, commit list, residual Medium issues, and external operations not executed.

- [ ] **Step 6: Commit**

  Commit: `docs(ui): hand off Modular Control redesign`

---

### Task 10: Run the final release-quality verification

**Files:**

- Modify: `docs/design/modular-control/verification-log.md`
- Modify: `docs/design/modular-control/final-handoff.md`

- [ ] **Step 1: Confirm the worktree contains only intended changes**

  Run: `git status --short --branch`

  Run: `git diff --check`

  Run: `git diff --stat 9406bcd..HEAD`

  Inspect every unexpected path before continuing; do not delete or overwrite user-owned changes.

- [ ] **Step 2: Run every focused structural/security gate**

  Run: `pnpm vitest run client/src/lib/tokenDiscipline.test.ts client/src/lib/uiMigrationCoverage.test.ts client/src/lib/routeContract.test.ts client/src/lib/operationalContext.test.ts client/src/lib/navigation.test.ts client/src/lib/commandPalette.test.ts client/src/lib/goldenScreenContracts.test.ts client/src/lib/goldenScreenPresentation.test.ts client/src/lib/paymentView.test.ts client/src/lib/economiaView.test.ts client/src/lib/messaggi.test.ts server/platform/interruttori.test.ts server/routers/authzEconomia.test.ts server/routers/permessi.test.ts server/routers/proposte.test.ts`

- [ ] **Step 3: Run the complete project gates from fresh output**

  Run: `pnpm ui:contrast`

  Run: `pnpm check`

  Run: `pnpm test`

  Run: `pnpm build`

  Record current pass/fail output, exact Vitest counts, skipped tests, and build chunk summary. A prior green run is not evidence for this step.

- [ ] **Step 4: Recheck final browser evidence after the last code change**

  Repeat one smoke path per archetype at 1440×900 and 390×844, both themes where applicable, inspect console, keyboard focus, overflow, and reduced motion. Replace stale screenshots only if the final code changed their surface.

- [ ] **Step 5: Scan for forbidden residue and sensitive artifacts**

  Run: `! rg -n "Frame & Flow|rf-frame|rf-rail|rf-reveal|rf-latch|data-ui-v2" client/src server/platform/interruttori.ts`

  Run: `rg -n "@|\+39|https?://|data:application/pdf;base64" docs/design/modular-control/evidence docs/design/modular-control/*.md`

  The first command must exit 0 with no matches. For the second command, exit 1 is acceptable when no candidate exists; otherwise review every match manually. Documentation links and synthetic labels may be legitimate, but no production contact/blob may remain.

- [ ] **Step 6: Record completion accurately**

  Mark the program complete only if every Critical/High is closed and every master-prompt gate has fresh evidence. Otherwise leave the relevant task unchecked and report the exact blocker.

- [ ] **Step 7: Final commit if verification documents changed**

  Commit: `test(ui): record final Modular Control verification`

- [ ] **Step 8: Stop at the authorized boundary**

  Report the result and commit range. Do not merge, push, deploy, open a PR, or change any external flag.
