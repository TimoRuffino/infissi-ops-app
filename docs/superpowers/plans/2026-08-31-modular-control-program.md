# Modular Control / Borgogna Operativa Implementation Program

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the rejected Frame & Flow visual direction with the approved Modular Control / Borgogna Operativa UI and UX across every Ruffino Flow route, while preserving all live CRM behavior, permissions, tenant isolation, financial privacy, deep links, and Tars governance.

**Architecture:** Deliver the redesign as five ordered slices. Slice 01 establishes evidence, tokens, context isolation, capability-aware navigation, primitives, and the responsive shell. Slice 02 validates the system on the golden screens. Slices 03 and 04 migrate the remaining operational and support/admin route families. Slice 05 proves route coverage, accessibility, responsive behavior, rollback, performance, and release readiness. `FLAG_UI_V2` remains the existing global rollback switch; its enabled presentation is renamed to Modular Control without changing server behavior.

**Tech Stack:** React 19, TypeScript 5.9, Wouter, tRPC 11, TanStack React Query 5, Tailwind CSS 4, shadcn/Radix, Lucide, Framer Motion, Recharts, Vitest, axe-core, Vite.

**Spec:** `docs/design/master-prompt-ruffino-flow-ui-ux-v3.md`

## Global Constraints

- Work only on `feature/ui-v2-frame-flow`; do not switch, create, rebase, merge, push, deploy, or open a PR without separate authorization.
- Treat this as a presentation and interaction migration. Do not change server contracts, database/storage schemas, business rules, canonical commessa states, payment derivations, or Tars governance.
- Preserve `sedeId` scoping and cross-sede `NOT_FOUND` behavior. Never render stale entity names, identifiers, links, messages, or protected amounts while user, sede, or effective capabilities are changing.
- Use `permessi.mie` effective capabilities for client visibility once loaded. Roles are a loading fallback or an explicit route rule, never a substitute for the server authorization engine.
- Keep `/produzione/* -> /kanban`, `/comunicazioni -> /messaggi/email`, every deep link, and every existing Wouter history behavior intact.
- `FLAG_UI_V2=OFF` must remain a safe global rollback with no data migration and no business-state difference. `ON` means only Modular Control / Borgogna Operativa.
- Tars remains fail-closed and human-governed. Do not add endpoints, model calls while typing, autonomous mutations, simulated activity, or UI states not represented by the typed server response.
- Use semantic tokens from `client/src/index.css`; no page-local palette, decorative gradient proliferation, global horizontal scrolling, or reintroduction of Frame/Rail/Reveal signatures.
- All browser evidence uses local sanitized fixtures. Do not persist production names, contacts, messages, PDFs, addresses, or amounts in screenshots, documents, logs, or commits.
- Run focused tests after each task and `pnpm check`, `pnpm test`, and `pnpm build` at every slice boundary.

---

## Execution map

### Slice 01 — Foundations and shell

Plan: `docs/superpowers/plans/2026-08-31-modular-control-01-foundations-shell.md`

- [ ] Establish the durable reference extraction, route contract, transformation matrix, baseline evidence, and component contracts.
- [ ] Replace Frame & Flow token and flag semantics with the approved four-quadrant Borgogna Operativa system.
- [ ] Add user+sede+authorization context isolation for query data and persisted UI state.
- [ ] Build effective-capability navigation, the three responsive shell regimes, the command palette, and high-impact primitives.
- [ ] Pass the Slice 01 test, build, browser, privacy, and rollback gates.

**Exit gate:** The enabled flag renders the new shell and tokens without any Frame/Rail/Reveal marker; the disabled flag remains a usable legacy shell; context switching cannot reveal stale protected data; all registered routes remain reachable or intentionally guarded.

### Slice 02 — Golden screens

Plan: `docs/superpowers/plans/2026-08-31-modular-control-02-golden-screens.md`

- [ ] Implement the capability-composable Dashboard, Commessa 360, Kanban, Tars and mobile Rilievo/Verbale. Fornitori/Document Intelligence is excluded by explicit user decision dated 31/08/2026.
- [ ] Exercise shared list, dossier, workbench, governed-intelligence, and mobile-form patterns before wider migration.
- [ ] Produce the single high-fidelity visual checkpoint required by the spec with sanitized fixtures and explicit state coverage.
- [ ] Correct the design system itself when a golden screen exposes a structural inconsistency; do not add page-local exceptions.

**Entry gate:** Slice 01 is green and its shell/context contracts are stable.

**Exit gate:** All golden screens work at their required viewports and access states, no protected economic data mounts for unauthorized users, and the approved visual language is visibly distinct from Frame & Flow and from the reference image.

### Slice 03 — Operational routes

Plan: `docs/superpowers/plans/2026-08-31-modular-control-03-operational-routes.md`

- [ ] Migrate customer/job indexes and customer detail.
- [ ] Migrate planning, squads, warehouse, payments, economy, and margin views; do not touch Fornitori/Document Intelligence, which is excluded from the redesign by explicit user decision.
- [ ] Reuse the proven archetypes and preserve URL/query state, mutation semantics, mobile task completion, capability shaping, and `sedeId` isolation.

**Entry gate:** The Slice 02 checkpoint is accepted and its Critical/High findings are resolved.

**Exit gate:** Every operational route in this slice is marked `migrata`, `redirect`, or `esclusa con motivazione` in the route coverage matrix and has focused functional plus browser evidence.

### Slice 04 — Support, communications, and administration

Plan: `docs/superpowers/plans/2026-08-31-modular-control-04-support-admin-routes.md`

- [ ] Migrate Email, WhatsApp, company chat, notifications, tickets, claims, warranties, archive, and knowledge surfaces.
- [ ] Migrate both configurators, users, sites, integrations/settings, authentication, blocked states, not-found, and legacy redirects.
- [ ] Preserve hostile-content handling, selection/deep-link continuity, role/capability boundaries, feature-off states, drafts, and responsive alternatives to desktop multi-pane layouts.

**Entry gate:** Slices 01–03 are green; shared patterns are frozen except for proven defects.

**Exit gate:** Every remaining registered route has implementation and evidence status, no old visual grammar remains in enabled UI, and all guarded/flag-off paths fail safely.

### Slice 05 — Hardening and release gate

Plan: `docs/superpowers/plans/2026-08-31-modular-control-05-hardening-release-gate.md`

- [ ] Close route, token, legacy-marker, authorization, Tars, and context-isolation structural gates.
- [ ] Complete the viewport matrix, light/dark checks, keyboard walkthroughs, axe runs, contrast report, zoom/reflow, reduced-motion, console, and stress-fixture evidence.
- [ ] Compare bundle/chunks and runtime behavior, verify flag rollback locally, update current UI documentation and `handoff.md`, and obtain independent reviews.
- [ ] Fix every Critical/High finding and rerun the entire verification suite.

**Entry gate:** All route migration slices are functionally complete.

**Exit gate:** The master prompt Definition of Done is evidenced, not inferred. External rollout, deployment, production flag changes, merge, push, and PR creation remain explicitly unperformed.

---

## Program checkpoints

- [ ] **Checkpoint A — Foundations:** Record the Slice 01 commit range and test evidence in `docs/design/modular-control/verification-log.md`.
- [ ] **Checkpoint B — Visual direction:** Record the accepted golden-screen checkpoint, reviewer, date, and any conditions in `docs/design/modular-control/verification-log.md`.
- [ ] **Checkpoint C — Route completion:** Reconcile `client/src/App.tsx`, the typed route contract, and `docs/design/modular-control/route-manifest.md`; every path must have an explicit status.
- [ ] **Checkpoint D — Independent review:** Record separate visual/UX, responsive/a11y, authorization/privacy, Tars, and performance findings with severity and disposition.
- [ ] **Checkpoint E — Final verification:** Record fresh `pnpm check`, `pnpm test`, and `pnpm build` output summaries, browser evidence paths, bundle comparison, and local flag-off proof.

## Commit discipline

- [ ] Use the exact task-level commit boundaries specified by each slice plan; do not combine unrelated route families.
- [ ] Before each commit, inspect `git diff --check`, `git diff --stat`, and `git status --short`; preserve unrelated user changes.
- [ ] Do not amend or rewrite existing commits. If a task needs correction, add a focused follow-up commit.
- [ ] Keep generated screenshots sanitized and limited to the evidence explicitly required by the plans.

## Program completion

- [ ] All five slice plans are fully checked off.
- [ ] `docs/design/modular-control/route-manifest.md` covers every `App.tsx` path and fallback.
- [ ] `docs/design/modular-control/transformation-matrix.md` contains at least eight evidenced structural transformations.
- [ ] No enabled route retains Frame & Flow names, selectors, comments, or visual signatures.
- [ ] All capability, sede, financial, redirect, feature-flag, and Tars invariants pass focused tests.
- [ ] All required viewport, theme, accessibility, motion, console, privacy, and performance evidence is recorded.
- [ ] `pnpm check`, `pnpm test`, and `pnpm build` pass from a clean verification run.
- [ ] The final handoff lists commits, migrated routes, evidence, residual Medium issues, flag state, and every external operation not performed.
