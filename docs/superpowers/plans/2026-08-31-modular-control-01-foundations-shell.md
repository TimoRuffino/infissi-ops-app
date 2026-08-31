# Modular Control Foundations and Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the approved Borgogna Operativa design system, safe UI-generation boundary, user/sede/capability context isolation, route contract, capability-aware navigation, responsive app shell, command palette, and shared interface primitives before any route-wide visual migration.

**Architecture:** Keep `FLAG_UI_V2` as the global server-provided rollback bit, but map its enabled state to a named `modular-control` UI generation. Preserve the current disabled shell as a legacy renderer and mount the new shell only when the flag is enabled. Centralize active-sede, effective-capability, and feature-flag state in an operational context that blocks child rendering while the authorization scope changes and removes protected query/persisted state before committing the new scope. Drive sidebar, mobile dock, and command palette from one typed navigation model. Express the visual system through three-layer CSS tokens and finite component variants, not page-local styling.

**Tech Stack:** React 19, TypeScript 5.9, Wouter, tRPC 11, TanStack React Query 5, Tailwind CSS 4, shadcn/Radix, Lucide, Framer Motion, Recharts, Vitest, axe-core, Vite.

**Spec:** `docs/design/master-prompt-ruffino-flow-ui-ux-v3.md`

## Global Constraints

- This slice may refactor frontend presentation and client-only context handling; it must not alter routers, persistence, database/storage, business state, economic derivations, or Tars provider behavior.
- Read `AGENTS.md`, `handoff.md`, `docs/source-of-truth-matrix.md`, `docs/tars/architettura-tars-v2.md`, and all touched files before editing. Record contradictions instead of resolving them by assumption.
- Preserve `FLAG_UI_V2` as a global process flag. Do not add client-only targeting by user, role, or sede.
- The enabled root marker is `data-ui-system="modular-control"`. Do not reuse a Frame & Flow selector or leave `rf-frame`, `rf-rail`, `rf-reveal`, `rf-latch`, `data-ui-v2`, or their comments in the enabled implementation.
- Do not persist entity names, IDs, search results, drafts, recents, or protected amounts outside a `userId + sedeId + authorization fingerprint` scope.
- On logout, active-sede change, or effective-capability change, never render children against a mismatched committed scope. Cancel, remove, refetch, then commit the new scope.
- `permessi.mie` is the client source for effective capabilities. Role checks remain only where the product contract is explicitly role-only or while the capability query is unresolved.
- The shell must support `0–767px`, `768–1199px`, and `>=1200px` regimes, with no global horizontal scroll and no control below the required touch target.
- Do not create fake shell counters, recent entities, commands, quick-create actions, or notifications.
- All evidence uses sanitized local fixture data. No production screenshot or payload may enter the repository.

---

### Task 1: Freeze the reference, current facts, and baseline evidence

**Files:**

- Create: `docs/design/modular-control/reference-extraction.md`
- Create: `docs/design/modular-control/transformation-matrix.md`
- Create: `docs/design/modular-control/component-contracts.md`
- Create: `docs/design/modular-control/verification-log.md`
- Create: `docs/design/modular-control/performance-baseline.md`
- Create directory through committed evidence files: `docs/design/modular-control/evidence/baseline/`
- Modify: `docs/design/ruffino-flow-ui-v2.md`
- Modify: `docs/design/ruffino-flow-tokens.md`
- Modify: `docs/design/ruffino-flow-motion.md`
- Modify: `docs/design/ruffino-flow-anti-ai-slop.md`
- Reference: `docs/design/master-prompt-ruffino-flow-ui-ux-v3.md`
- Reference: `handoff.md`

**Document contracts:**

- `reference-extraction.md` contains exactly eight allowed abstract traits and eight forbidden copied traits, plus the approved palette and the rule that the conversation attachment is not required for future review.
- `transformation-matrix.md` has columns `Area`, `Legacy component`, `Modular Control component`, `Routes`, `UX reason`, `Desktop`, `Mobile`, `Baseline evidence`, `V3 evidence`, and `Status`; it includes shell, navigation, context bar, dashboard, list/queue, Record 360, workbench, inbox, and mobile form.
- `component-contracts.md` defines inputs, finite variants, states, tokens, keyboard semantics, breakpoint behavior, and non-goals for `AppShell`, `PageHeader`, `DataSurface`, `DataTable`, `StatusBadge`, `ContextInspector`, `TarsBriefing`, and `StickyActionBar`.
- `verification-log.md` is append-only by slice and records command, date, outcome, evidence path, reviewer type, and unresolved issue. It never claims an independent review when only self-review occurred.

- [ ] **Step 1: Reconfirm repository safety and source precedence**

  Run: `git status --short --branch && git log -5 --oneline && sed -n '1,240p' AGENTS.md && sed -n '1,220p' docs/source-of-truth-matrix.md`

  Expected: branch `feature/ui-v2-frame-flow`; only changes created by this plan are present; current code/tests outrank stale visual documents.

- [ ] **Step 2: Write the durable reference extraction**

  Record the eight permitted traits: cold outer chrome, centered framed workspace, quiet compact navigation, asymmetric modular grid, restrained near-white surfaces, one focal dark/gradient anchor, data-first hierarchy, and alternating breathing/dense zones. Record the eight prohibited traits: source logo, source palette, 3D avatar, personal-finance copy/metrics, exact sidebar, exact module placement, identical chart silhouettes, and pixel-matched overall composition.

- [ ] **Step 3: Create the transformation and component-contract matrices**

  Populate legacy file/component names from the current branch. Set `V3 evidence` to the exact destination path that later tasks will produce; set status to `planned`, not an empty placeholder.

- [ ] **Step 4: Capture sanitized baseline screens in a local development session**

  Capture these exact files with fixture-only records:
  - `docs/design/modular-control/evidence/baseline/dashboard-1440x900-light.png`
  - `docs/design/modular-control/evidence/baseline/dashboard-390x844-light.png`
  - `docs/design/modular-control/evidence/baseline/commessa-1440x900-light.png`
  - `docs/design/modular-control/evidence/baseline/kanban-1440x900-light.png`
  - `docs/design/modular-control/evidence/baseline/tars-1440x900-degraded.png`
  - `docs/design/modular-control/evidence/baseline/rilievo-390x844-light.png`

  Before saving each image, visually confirm that names, contacts, addresses, messages, PDFs, and amounts are unmistakably synthetic.

- [ ] **Step 5: Record the pre-migration build baseline**

  Run: `pnpm build && find dist/public/assets -maxdepth 1 -type f -exec wc -c {} + | sort -n`

  Record the current commit, total JS/CSS bytes, every emitted asset/chunk size, and the build warning state in `performance-baseline.md`. This must happen before token, shell, or route implementation so Slice 05 compares against a real baseline rather than memory.

- [ ] **Step 6: Mark superseded visual documents without erasing useful history**

  Add a leading notice to each old visual document: its aesthetic direction is superseded by the v3 master prompt, while still-valid technical/history sections remain reference material. Do not rewrite functional facts.

- [ ] **Step 7: Validate document completeness**

  Run: `rg -n "planned|shell|navigation|context bar|dashboard|Record 360|workbench|inbox|mobile form" docs/design/modular-control/transformation-matrix.md && rg -n "AppShell|PageHeader|DataSurface|DataTable|StatusBadge|ContextInspector|TarsBriefing|StickyActionBar" docs/design/modular-control/component-contracts.md`

  Expected: all required structural areas and component contracts are present with explicit file/evidence destinations.

- [ ] **Step 8: Commit**

  Commit: `docs(ui): establish Modular Control evidence contract`

---

### Task 2: Make the route surface typed and auditable

**Files:**

- Create: `client/src/lib/routeContract.ts`
- Create: `client/src/lib/routeContract.test.ts`
- Create: `docs/design/modular-control/route-manifest.md`
- Modify: `client/src/App.tsx`
- Modify: `client/src/lib/navigation.test.ts`
- Reference: `client/src/lib/messaggi.ts`
- Reference: `client/src/lib/navigation.ts`
- Reference: owning server router for each route family

**Interfaces:**

- Produces `RouteKind = "page" | "guarded" | "redirect" | "fallback"`.
- Produces `RouteContractEntry` with `path`, `kind`, `target`, `uxGuard`, `serverAuthority`, `requiredCapabilities`, `roleRule`, `featureFlag`, `navigation`, `mobileTreatment`, and `migrationStatus`.
- Produces `APP_ROUTE_CONTRACT: readonly RouteContractEntry[]` containing every explicit `<Route path>` plus the fallback.
- Produces `registeredRoutePaths(source: string): string[]` as a test-only extractor that compares `App.tsx` with the contract and documentation.
- `App.tsx` continues to own lazy imports and route elements; the metadata contract does not become an authorization boundary.

- [ ] **Step 1: Write the failing route coverage tests**

  Assert that the contract and `App.tsx` contain the same explicit path set:

  `/`, `/clienti`, `/clienti/:id`, `/kanban`, `/magazzino`, `/pagamenti`, `/economia`, `/marginalita`, `/commesse`, `/commesse/:id`, `/commesse/:commessaId/aperture/:aperturaId/rilievo`, `/verbale/:interventoId`, `/planning`, `/ticket`, `/garanzie`, `/squadre`, `/fornitori`, `/preventivatori`, `/preventivatori/fivizzanese/persiane`, `/preventivatori/punto-del-serramento/persiane`, `/produzione/*?`, `/reclami`, `/archivio`, `/utenti`, `/sedi`, `/messaggi/email`, `/messaggi/whatsapp`, `/chat`, `/notifiche`, `/comunicazioni`, `/conoscenza`, `/integrazioni`, `/tars`, `/404`, and the fallback.

  Also assert the redirect targets, the six `RequireDirezione` paths (`/marginalita`, `/garanzie`, `/fornitori`, `/utenti`, `/sedi`, `/conoscenza`), direct `/pagamenti` capability shaping, and `/tars` flag metadata.

- [ ] **Step 2: Run the focused tests and verify RED**

  Run: `pnpm vitest run client/src/lib/routeContract.test.ts client/src/lib/navigation.test.ts client/src/lib/messaggi.test.ts`

  Expected: failure because the typed contract and route manifest do not exist.

- [ ] **Step 3: Implement the route contract without duplicating route behavior**

  Encode metadata only. Keep redirects delegated to `produzioneRedirect` and `legacyMessageRedirect`, guards delegated to `RequireDirezione`, and all data authority on the server.

- [ ] **Step 4: Add stable route identifiers to `App.tsx`**

  Add `data-route-id` only where needed by shell/a11y evidence or use a small wrapper that consumes the matching contract entry. Do not replace Wouter with a new router and do not change lazy-loading boundaries.

- [ ] **Step 5: Generate the human route manifest**

  Give each entry one explicit status: `planned` for pages in later slices, `redirect` for `/produzione/*?` and `/comunicazioni`, and `migrata` only after real implementation/evidence. Include the server router/capability source, not merely a role label.

- [ ] **Step 6: Make contract/document drift fail**

  Test that each contract path appears exactly once in `route-manifest.md` and each manifest route exists in the contract. Keep `/produzione/*?` as redirect-only; assert no `Produzione` page/lazy import exists.

- [ ] **Step 7: Run focused tests and type-check**

  Run: `pnpm vitest run client/src/lib/routeContract.test.ts client/src/lib/navigation.test.ts client/src/lib/messaggi.test.ts && pnpm check`

  Expected: all route, redirect, and structural checks pass.

- [ ] **Step 8: Commit**

  Commit: `test(ui): make route migration coverage explicit`

---

### Task 3: Replace Frame & Flow token and flag semantics

**Files:**

- Modify: `client/src/index.css`
- Modify: `client/src/lib/tokenDiscipline.test.ts`
- Create: `scripts/check-ui-contrast.ts`
- Modify: `package.json`
- Create: `docs/design/modular-control/contrast-report.md`
- Modify: `server/platform/interruttori.ts`
- Modify: `server/platform/interruttori.test.ts`
- Modify: `client/src/components/ui/button.tsx`
- Modify: `client/src/components/ui/badge.tsx`
- Modify: `client/src/components/ui/card.tsx`
- Modify: `client/src/components/ui/input.tsx`
- Modify: `client/src/components/ui/table.tsx`
- Modify: `client/src/components/ui/dialog.tsx`
- Modify: `client/src/components/ui/sheet.tsx`
- Modify: `client/src/components/ui/tooltip.tsx`

**Token contract:**

- Keep the existing `:root` and `.dark` quadrants as the disabled legacy fallback.
- Replace `[data-ui-v2]` with `[data-ui-system="modular-control"]` and replace `[data-ui-v2].dark` with `[data-ui-system="modular-control"].dark`.
- Define primitive -> semantic -> component tokens for outer chrome, canvas, workspace, surface/sunken/raised, text, border/control, brand/soft/on-brand, secondary mora, focal panel, semantic states, charts, shell, context bar, table, inspector, radius, shadow, motion, and focus.
- Use the approved light/dark values and gradients from master-prompt sections 7–8. A gradient is opt-in through a focal variant; default buttons remain solid.
- Export the script command `pnpm ui:contrast`, which checks all documented foreground/background and focus/border pairs against their WCAG thresholds and exits non-zero on failure.

- [ ] **Step 1: Strengthen token discipline tests first**

  Add failing assertions for the required root marker and approved token values, absence of `data-ui-v2`, `rf-frame`, `rf-rail`, `rf-reveal`, `rf-latch`, and `Frame & Flow` under `client/src` plus the UI flag label. Extend arbitrary-color scanning to all application TS/TSX files while retaining only documented third-party brand exceptions.

- [ ] **Step 2: Add failing flag-semantic tests**

  Assert `uiV2` still maps to `FLAG_UI_V2`, remains fail-closed in production, has no effect on Tars/business flags, and its user-facing error label names `Modular Control / Borgogna Operativa` rather than Frame & Flow.

- [ ] **Step 3: Run focused tests and verify RED**

  Run: `pnpm vitest run client/src/lib/tokenDiscipline.test.ts server/platform/interruttori.test.ts`

  Expected: failures identify the old selector, old signatures, old palette, and old label.

- [ ] **Step 4: Implement the four token quadrants**

  Preserve legacy values in `:root`/`.dark`; implement the complete light/dark Modular Control override under the new attribute. Add a cold outer `--chrome`, separate `--canvas`, `--workspace`, focal gradient, restrained elevation, component tokens, 4px spacing scale, 10–32px radius family, and 80–320ms motion tokens. Ensure body chrome and inner workspace are separate surfaces at desktop widths and full-bleed on mobile.

- [ ] **Step 5: Remove the rejected signatures**

  Delete the `rf-frame` pseudo-corners, reveal keyframes/class, latch class, and all Frame & Flow comments. Rename any functional `StatusRail` presentation in a later golden-screen task; no rejected selector may survive this task.

- [ ] **Step 6: Normalize high-impact primitive variants**

  Keep existing public variant names where changing them would churn routes. Add finite `focal`, `quiet`, and `toolbar` variants only when their semantics are documented. Remove gradient from the default button; only `focal` may consume `--gradient-focal`. Give inputs, dialogs, sheets, tables, and tooltips consistent control borders, focus states, radii, density, and dark-mode surfaces.

- [ ] **Step 7: Implement and run the contrast script**

  The script must compute relative sRGB luminance, verify normal text at 4.5:1, large text and essential boundaries/focus at 3:1, print every named pair, and exit 1 on any failure.

  Run: `pnpm ui:contrast`

  Expected: every documented pair passes; write the dated output summary to `contrast-report.md`.

- [ ] **Step 8: Run focused tests and type-check**

  Run: `pnpm vitest run client/src/lib/tokenDiscipline.test.ts server/platform/interruttori.test.ts && pnpm check`

- [ ] **Step 9: Commit**

  Commit: `feat(ui): establish Borgogna Operativa tokens`

---

### Task 4: Add a safe UI-generation and operational-context boundary

**Files:**

- Create: `client/src/contexts/UiGenerationContext.tsx`
- Create: `client/src/contexts/OperationalContext.tsx`
- Create: `client/src/lib/operationalContext.ts`
- Create: `client/src/lib/operationalContext.test.ts`
- Modify: `client/src/components/DashboardLayout.tsx`
- Modify: `client/src/components/SedeSwitcher.tsx`
- Modify: `client/src/_core/hooks/useAuth.ts`
- Modify: `client/src/main.tsx`
- Modify: `client/src/components/DashboardLayoutSkeleton.tsx`

**Interfaces:**

- Produces `UiGeneration = "legacy" | "modular-control"`, `UiGenerationProvider`, `useUiGeneration()`, and `useModularControl()`.
- Produces `OperationalScopeInput { userId; sedeId; capabilities }`, `authorizationFingerprint(capabilities)`, `operationalScopeKey(input)`, `scopedStorageKey(base, scope)`, `isProtectedQueryKey(queryKey)`, and `clearScopedUiState(storage, previousScope)` as pure functions.
- Produces `OperationalContextValue` with `activeSede`, `sedi`, `capabilities`, `flags`, `scopeKey`, `status: "loading" | "ready" | "switching"`, and `switchSede(sedeId): Promise<void>`.
- The provider renders `ContextTransitionScreen` instead of route children whenever the fetched scope differs from the committed scope; children mount only after protected cache removal and required context refetch.

- [ ] **Step 1: Write failing pure isolation tests**

  Cover deterministic capability ordering, distinct keys for different user/sede/capability sets, identical keys for reordered capabilities, scoped storage keys, protected-vs-global query classification, and removal of only the previous protected UI namespace.

- [ ] **Step 2: Add structural tests for transition ordering**

  Assert the provider source cancels protected queries before the switch, removes protected queries after the server confirms the new sede, refetches `sedi.active` and `permessi.mie`, and only then commits the scope. Assert logout clears query cache and scoped UI state before another user can render.

- [ ] **Step 3: Run the focused test and verify RED**

  Run: `pnpm vitest run client/src/lib/operationalContext.test.ts`

- [ ] **Step 4: Implement pure scope and storage helpers**

  Build the authorization fingerprint from a sorted capability list and a deterministic non-cryptographic hash. Never put labels, entity IDs, or data values into the key. Limit persisted scoped values to layout preferences and revalidated navigation recents.

- [ ] **Step 5: Implement the operational provider**

  Centralize `sedi.list`, `sedi.active`, `permessi.mie`, and `platform.interruttori`. Maintain a committed scope separate from fetched scope. On a mismatch, block child rendering, cancel/remove all tenant/protected queries except the explicit global allowlist (`auth.me`, process-wide flags, assigned-sedi list), clear the previous scoped UI namespace, fetch the new active sede/capabilities, then render.

- [ ] **Step 6: Move sede switching into the provider**

  Convert `SedeSwitcher` to a presentation consumer. Preserve toast copy, management deep link, disabled state, and error recovery. Do not merely invalidate queries; prove old records cannot appear during the transition.

- [ ] **Step 7: Harden logout**

  Cancel active protected queries, clear scoped UI state and query data, then set `auth.me` to null and invalidate only what is required for the login boundary. Keep an unavailable cache from breaking logout.

- [ ] **Step 8: Wire the UI-generation root marker**

  Set/remove `data-ui-system="modular-control"` from `document.documentElement` only from the server flag result. Always clean the attribute on flag-off/unmount. Provide the generation through context so shell and route patterns do not read DOM attributes as business state.

- [ ] **Step 9: Run focused tests and type-check**

  Run: `pnpm vitest run client/src/lib/operationalContext.test.ts server/platform/interruttori.test.ts && pnpm check`

- [ ] **Step 10: Commit**

  Commit: `fix(ui): isolate user sede and capability context`

---

### Task 5: Make navigation effective-capability aware

**Files:**

- Modify: `client/src/lib/navigation.ts`
- Modify: `client/src/lib/navigation.test.ts`
- Modify: `client/src/components/RequireDirezione.tsx`
- Modify: `docs/design/modular-control/route-manifest.md`
- Reference: `server/authz/capabilities.ts`
- Reference: `server/authz/enforcement.ts`
- Reference: `server/routers/permessi.ts`

**Interfaces:**

- Replace boolean `*Only` fields with `requiredCapabilities?: readonly CapabilityName[]`, `roleRule?: "direzione"`, `featureFlag?: "tars"`, `loadingFallbackRoles?: readonly Ruolo[]`, and `children?: readonly MenuItem[]`.
- Produce `NavigationAccess { user; capabilities; flags; capabilityStatus }` and `isNavigationItemVisible(item, access): boolean`.
- Produce `navigationDestinations(access)`, `navigationGroups(access)`, and existing `isPathActive`/`navigationItemState` behavior.
- An item requiring multiple capabilities uses `every`; route visibility never grants server access.

- [ ] **Step 1: Write the authorization matrix tests**

  Cover a multi-role user, an override-only `pagamento.read` user, an override-only Document Intelligence approver requiring both capabilities, a denied capability despite a normally allowed role, a delegated/expired denial represented by the effective set, Tars flag off, and role-only direzione routes. Assert no economic item appears while `permessi.mie` is resolved without its capability.

- [ ] **Step 2: Run focused tests and verify RED**

  Run: `pnpm vitest run client/src/lib/navigation.test.ts`

- [ ] **Step 3: Implement the typed access model**

  Map Clients to `cliente.read`, Commesse/Board/Archive to `commessa.read`, Payments to `pagamento.read`, Economy to `economia.read`, Tars to `tars.use + FLAG_TARS`, and Document Intelligence decisions to both `documento.approve_proposals` and `fornitore.manage_ordini`. Keep explicit direzione-only pages role-gated where no capability contract exists.

- [ ] **Step 4: Preserve loading behavior without leaking**

  While capabilities load, show only destinations that are public to every authenticated role plus explicit role fallbacks. Never optimistically display economy or Tars controls. Replace the fallback once `permessi.mie` resolves.

- [ ] **Step 5: Keep direct links honest**

  `RequireDirezione` remains a clear UX guard; server procedures remain authority. Update the route manifest with the precise client guard and server owner for each guarded path.

- [ ] **Step 6: Run focused and server authorization regressions**

  Run: `pnpm vitest run client/src/lib/navigation.test.ts server/routers/authzEconomia.test.ts server/routers/permessi.test.ts && pnpm check`

- [ ] **Step 7: Commit**

  Commit: `refactor(ui): drive navigation from effective access`

---

### Task 6: Split the legacy and Modular Control desktop shells

**Files:**

- Create: `client/src/components/layout/LegacyDashboardLayout.tsx`
- Create: `client/src/components/layout/ModularControlLayout.tsx`
- Create: `client/src/components/layout/NavigationSidebar.tsx`
- Create: `client/src/components/layout/ContextBar.tsx`
- Create: `client/src/components/layout/UserMenu.tsx`
- Create: `client/src/components/layout/ShellWorkspace.tsx`
- Modify: `client/src/components/DashboardLayout.tsx`
- Modify: `client/src/components/DashboardLayoutSkeleton.tsx`
- Modify: `client/src/components/NotificheDropdown.tsx`
- Modify: `client/src/components/PageContainer.tsx`
- Modify: `client/src/App.tsx`

**Interfaces:**

- `DashboardLayout` owns authentication, flag resolution, and providers, then renders exactly one of `LegacyDashboardLayout` or `ModularControlLayout`.
- `ModularControlLayoutProps { children: ReactNode }` consumes operational context; it does not re-query flags/capabilities.
- `NavigationSidebarProps { currentPath; collapsed; onNavigate; onCollapsedChange }` derives groups from the navigation access model.
- `ContextBarProps { currentRoute: RouteContractEntry; onOpenCommand; onOpenNavigation }` renders breadcrumb/title, command trigger, notifications/action access, and user controls without inventing page actions.
- `ShellWorkspace` provides outer chrome, centered workspace, `min-w-0`, route landmark, and responsive padding.

- [ ] **Step 1: Extract the disabled shell without behavior changes**

  Move the current shell JSX and resize behavior into `LegacyDashboardLayout.tsx`. Preserve its navigation, notifications, theme behavior, active route, chat polling, and sidebar width key. Verify the flag-off DOM does not mount a Modular Control shell marker.

- [ ] **Step 2: Add a failing structural shell test**

  Extend `operationalContext.test.ts` or add a source-level assertion that `DashboardLayout` has mutually exclusive legacy/modular branches and that `ModularControlLayout` consumes the centralized context rather than calling `permessi.mie` or `platform.interruttori` again.

- [ ] **Step 3: Implement the desktop shell frame**

  At `>=1200px`, render cold outer chrome, a 16–24px inset workspace with 28–32px radius, a 224–248px collapsible navigation column, context bar, and `min-w-0` content. At `>=1600px`, center within a 1600–1760px maximum while retaining visible chrome. Preserve sidebar collapse and resize only if the resize affordance remains keyboard-accessible; otherwise use finite expanded/iconic widths.

- [ ] **Step 4: Implement grouped navigation and identity**

  Use job-oriented groups, active state with text+shape+color, accessible icon-only collapsed controls, active sede, role summary, unread chat badge, and user menu. Do not add a Production destination.

- [ ] **Step 5: Implement the context bar**

  Derive title/breadcrumb from the route contract; progressively collapse breadcrumbs before actions. Include command trigger, notifications, current context, and profile. Expose a slot for real page actions but render nothing when no action is supplied.

- [ ] **Step 6: Retune route transition and skeleton**

  Keep crossfade/position feedback within 180–240ms, avoid animating all cards, and disable spatial movement with reduced motion. Make the shell skeleton match the new geometry and committed context; it must not resemble fabricated data.

- [ ] **Step 7: Verify desktop behavior in the browser**

  At 1440×900 and 1280×800, exercise sidebar collapse, group expansion, deep links, back/forward, command trigger, notifications, theme toggle, and long title/sede fixtures. Confirm no console error and `document.documentElement.scrollWidth === document.documentElement.clientWidth`.

- [ ] **Step 8: Run checks and commit**

  Run: `pnpm vitest run client/src/lib/navigation.test.ts client/src/lib/routeContract.test.ts client/src/lib/operationalContext.test.ts && pnpm check`

  Commit: `feat(ui): build Modular Control desktop shell`

---

### Task 7: Implement tablet and mobile shell regimes

**Files:**

- Create: `client/src/components/layout/CompactNavigation.tsx`
- Create: `client/src/components/layout/MobileTopBar.tsx`
- Modify: `client/src/components/BottomNav.tsx`
- Modify: `client/src/components/layout/ModularControlLayout.tsx`
- Modify: `client/src/components/layout/ContextBar.tsx`
- Modify: `client/src/components/ui/sidebar.tsx`
- Modify: `client/src/index.css`

**Interfaces:**

- `CompactNavigation` is an accessible Radix Sheet/drawer with the same groups and access filtering as desktop.
- `MobileTopBar` accepts route title, predictable back target when available, navigation trigger, and notification trigger.
- `BottomNav` accepts `NavigationAccess`, current path, and drawer action; it returns at most five stable capability-aware destinations and never uses role alone after capabilities resolve.

- [ ] **Step 1: Add pure mobile-destination tests**

  Extract and test `mobileDestinations(access)` for office multi-role, field roles, override-only users, Tars flag off, and fewer-than-five available destinations. Assert stable order, no unauthorized links, and an `Altro` drawer action.

- [ ] **Step 2: Run the focused test and verify RED**

  Run: `pnpm vitest run client/src/lib/navigation.test.ts`

- [ ] **Step 3: Implement the 768–1199px regime**

  Use an iconic rail or drawer, never a squeezed expanded sidebar. Collapse command search to a trigger, shorten breadcrumbs, move inspectors into sheets, and keep content/actions clear of the viewport edge.

- [ ] **Step 4: Implement the 0–767px regime**

  Remove outer chrome and workspace radius, render a compact sticky top bar, full-bleed content, safe-area-aware bottom dock, and full navigation drawer. Maintain 44×44px targets and 48px critical actions; ensure the dock does not cover the last form control.

- [ ] **Step 5: Verify responsive shell behavior**

  Check 1024×768, 768×1024, 390×844, and 360×800. Exercise orientation change, drawer focus trap/restore, keyboard at 200% zoom, long labels, five-item dock, and page scroll. Confirm no global horizontal overflow.

- [ ] **Step 6: Run checks and commit**

  Run: `pnpm vitest run client/src/lib/navigation.test.ts client/src/lib/routeContract.test.ts && pnpm check`

  Commit: `feat(ui): add compact and mobile app shell`

---

### Task 8: Scope and redesign the command palette

**Files:**

- Create: `client/src/lib/commandPalette.ts`
- Create: `client/src/lib/commandPalette.test.ts`
- Modify: `client/src/components/CommandPalette.tsx`
- Modify: `client/src/components/layout/ContextBar.tsx`
- Modify: `client/src/components/layout/MobileTopBar.tsx`
- Reference: `client/src/lib/navigation.ts`

**Interfaces:**

- Produces `PaletteRecent { label; path; kind: "route" | "cliente" | "commessa" }`.
- Produces `paletteRecentsKey(scopeKey)`, `sanitizeRecent(candidate)`, `readPaletteRecents(storage, scopeKey)`, `rememberPaletteRecent(storage, scopeKey, recent)`, and `revalidateRecent(recent, access): boolean`.
- `CommandPalette` consumes operational scope/access rather than a raw user object and does not retain results across a scope mismatch.

- [ ] **Step 1: Write failing scope and validation tests**

  Cover distinct user/sede/capability keys, malformed JSON, unknown recent kinds, unauthorized navigation recents, removed entity paths, deduplication, six-item cap, and Tars query behavior that compiles text without sending.

- [ ] **Step 2: Run focused tests and verify RED**

  Run: `pnpm vitest run client/src/lib/commandPalette.test.ts`

- [ ] **Step 3: Move persistence into pure helpers**

  Delete the user-only `rf-palette-recenti-<user>` scheme. On opening, read only the committed operational scope, revalidate route entries against effective access, and drop invalid entries before display.

- [ ] **Step 4: Preserve deterministic search behavior**

  Continue using existing sede-scoped `clienti.list` and `commesse.list` procedures with a short debounce and no new endpoint. Cancel/remove their results on scope transition. Never call Tars or any provider while typing.

- [ ] **Step 5: Implement the new visual hierarchy and keyboard path**

  Separate `Recenti`, `Naviga`, `Clienti`, `Commesse`, and explicit `Chiedi a Tars`; add honest loading/empty/error states, visible selection, `Esc` close, arrow navigation, focus restoration, and compact mobile presentation.

- [ ] **Step 6: Run focused tests and browser keyboard check**

  Run: `pnpm vitest run client/src/lib/commandPalette.test.ts client/src/lib/navigation.test.ts && pnpm check`

  Browser evidence: open with `Cmd/Ctrl+K`, navigate all groups by keyboard, switch sede while open, verify it closes/clears and no old label remains, then verify Tars text is only prefilled.

- [ ] **Step 7: Commit**

  Commit: `fix(ui): scope command palette to operational context`

---

### Task 9: Establish shared page and state patterns

**Files:**

- Create: `client/src/components/patterns/PageHeader.tsx`
- Create: `client/src/components/patterns/DataSurface.tsx`
- Create: `client/src/components/patterns/StatePanel.tsx`
- Create: `client/src/components/patterns/StickyActionBar.tsx`
- Create: `client/src/components/patterns/ContextInspector.tsx`
- Modify: `client/src/components/StatoChip.tsx`
- Modify: `client/src/components/ConfirmDialog.tsx`
- Modify: `client/src/components/ui/skeleton.tsx`
- Modify: `client/src/components/ui/chart.tsx`
- Modify: `docs/design/modular-control/component-contracts.md`

**Interfaces:**

- `PageHeaderProps { eyebrow?; title; description?; breadcrumbs?; metadata?; primaryAction?; secondaryActions? }` with a compact mobile action strategy.
- `DataSurfaceProps { density: "comfortable" | "compact"; tone: "default" | "sunken" | "focal"; as?: ElementType }`; `focal` is the only shared gradient consumer.
- `StatePanelProps` is a discriminated union for `loading`, `empty`, `error`, `permission`, `unavailable`, and `stale`; each state requires state-specific copy/actions.
- `StickyActionBarProps { status?; primary; secondary?; destructive? }` respects mobile safe areas and never changes save semantics.
- `ContextInspectorProps { title; open; onOpenChange; desktopMode: "inline" | "overlay" }` becomes a sheet below desktop.

- [ ] **Step 1: Add source-contract tests**

  Extend token discipline tests to require finite documented variants, forbid arbitrary gradient classes outside `DataSurface`, and require an accessible label/tooltip for icon-only actions in the new pattern files.

- [ ] **Step 2: Run the focused test and verify RED**

  Run: `pnpm vitest run client/src/lib/tokenDiscipline.test.ts`

- [ ] **Step 3: Implement the finite patterns**

  Use semantic tokens, native landmarks/headings, `min-w-0`, documented spacing, and compositional slots. Do not fetch data inside presentation patterns and do not invent a generic card for every section.

- [ ] **Step 4: Normalize status, confirmation, skeleton, and chart presentation**

  Keep every real status label and machine value unchanged. Pair color with text/icon/position. Use silhouette-matched skeletons without aggressive shimmer, restrained chart series with one protagonist, compact dark tooltips, and explicit confirmation copy supplied by callers.

- [ ] **Step 5: Document the final contracts**

  Replace planned contracts with the implemented prop/variant tables and examples. Record keyboard, responsive, motion, and non-goal behavior for each component.

- [ ] **Step 6: Run checks and commit**

  Run: `pnpm vitest run client/src/lib/tokenDiscipline.test.ts && pnpm check`

  Commit: `feat(ui): add Modular Control page patterns`

---

### Task 10: Prove the foundations slice and record its boundary

**Files:**

- Modify: `docs/design/modular-control/verification-log.md`
- Modify: `docs/design/modular-control/transformation-matrix.md`
- Modify: `docs/design/modular-control/route-manifest.md`
- Create directory through evidence files: `docs/design/modular-control/evidence/foundations/`
- Modify: `scripts/audit-a11y.md`

- [ ] **Step 1: Run the complete focused foundation suite**

  Run: `pnpm vitest run client/src/lib/tokenDiscipline.test.ts client/src/lib/routeContract.test.ts client/src/lib/operationalContext.test.ts client/src/lib/navigation.test.ts client/src/lib/commandPalette.test.ts server/platform/interruttori.test.ts server/routers/authzEconomia.test.ts server/routers/permessi.test.ts`

  Expected: all tests pass with no skipped new gate.

- [ ] **Step 2: Run project verification**

  Run: `pnpm ui:contrast && pnpm check && pnpm test && pnpm build`

  Record exact test counts and emitted chunk sizes in `verification-log.md`; do not reuse counts from the pre-implementation baseline.

- [ ] **Step 3: Verify both flag states locally**

  With `FLAG_UI_V2=off`, confirm the legacy shell renders, no `data-ui-system` attribute exists, no Modular Control-only component mounts, routes and mutations behave normally, and no data migration occurs. With `FLAG_UI_V2=on`, confirm the new marker/shell/tokens render. Save sanitized evidence:
  - `docs/design/modular-control/evidence/foundations/flag-off-1440x900.png`
  - `docs/design/modular-control/evidence/foundations/shell-1440x900-light.png`
  - `docs/design/modular-control/evidence/foundations/shell-1440x900-dark.png`
  - `docs/design/modular-control/evidence/foundations/shell-768x1024-light.png`
  - `docs/design/modular-control/evidence/foundations/shell-390x844-light.png`

- [ ] **Step 4: Run shell accessibility checks**

  Update `scripts/audit-a11y.md` to current routes and the new root marker. Run axe on shell/dashboard in both themes at 1440×900 and 390×844. Complete keyboard-only navigation, drawer, palette, user menu, sede switch, theme toggle, 200% zoom, and reduced-motion checks. Record only the tested surface; do not claim whole-product conformance.

- [ ] **Step 5: Exercise context isolation with visible synthetic markers**

  Use two sanitized sedi with unmistakably different fixture labels and capabilities. Switch while Dashboard, command palette, and a protected economy deep link are open. Capture or record a frame-by-frame observation proving the previous label/amount/link never renders after the transition begins.

- [ ] **Step 6: Update evidence matrices**

  Mark shell, navigation, and context bar transformations `implemented`; attach exact baseline/foundation paths. Keep route migrations `planned` until their slices complete.

- [ ] **Step 7: Inspect diff hygiene**

  Run: `git diff --check`

  Run: `git status --short`

  Run: `! rg -n "Frame & Flow|rf-frame|rf-rail|rf-reveal|rf-latch|data-ui-v2" client/src server/platform/interruttori.ts`

  Expected: no whitespace errors and no rejected marker in the enabled implementation. Any historical reference outside the searched runtime paths must be explicitly marked superseded.

- [ ] **Step 8: Commit**

  Commit: `test(ui): verify Modular Control foundations`
