# Modular Control 02 — Golden Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ridisegnare Dashboard, Commessa, Kanban, Tars e Rilievo/Verbale mobile come golden screens Modular Control / Borgogna Operativa, senza cambiare flussi, dati o contratti di produzione. La pagina Fornitori e la sua UI Document Intelligence sono escluse per decisione esplicita dell'utente del 31/08/2026.

**Architecture:** Le route mantengono ownership di query tRPC, mutation, invalidazioni, URL e autorizzazioni. La slice estrae mapping puri e componenti presentational. La slice 01 deve già fornire token v3, shell, primitive, dark mode, stati e FLAG_UI_V2; questa slice non li duplica.

**Tech Stack:** React 19, TypeScript, Wouter, tRPC/React Query, Tailwind 4, shadcn/Radix, Lucide, Framer Motion, Vitest, axe-core.

**Spec:** docs/design/master-prompt-ruffino-flow-ui-ux-v3.md §§2.1, 4–8, 10–12, 14–21, 23–28.

## Global Constraints

- Solo branch feature/ui-v2-frame-flow; mai merge, push, PR, deploy, attivazione flag o dati produttivi.
- FLAG_UI_V2 OFF conserva v1; ON identifica solo Modular Control. Vietati rf-frame, rf-rail, rf-reveal, Frame & Flow e Officina Digitale nella superficie v3.
- Nessuna modifica a server/schema/router, sedeId, capability, query/mutation, state machine, calcoli, cache key, route/deep link o nuove librerie.
- Capability effettive, non solo ruolo. Importi solo da payload server-autorizzati e formatEuroSimbolo.
- Tars fail-closed: flag off nessuna query; nessun modello su mount/digitazione; proposte inerti fino al gateway esistente; nessun audit/progresso fittizio.
- Token semantici, Plus Jakarta Sans, Lucide e copy italiano concreto; niente hex/palette Tailwind numerica, clone reference, robot/orb/sparkles o metriche inventate.
- WCAG 2.2 AA: tastiera, focus non oscurato, contrasto, target 44px/48px CTA mobile, stati non solo cromatici, alternativa al drag e reduced motion.
- Evidence locale e sanitizzata a 1440×900, 1280×800, 1024×768, 768×1024, 390×844, 360×800 e zoom 200%. Ogni task: test, browser evidence, pnpm check se TypeScript, commit piccolo.

---

## File structure

| File                                                                            | Responsibility                                                           |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| client/src/lib/goldenScreenContracts.ts                                         | Mapping puri Dashboard, Kanban, Tars e priorità mobile; nessun JSX/tRPC. |
| client/src/lib/goldenScreenContracts.test.ts                                    | Vitest mapping e guardie golden-screen.                                  |
| client/src/lib/goldenScreenPresentation.test.ts                                 | Guardie sorgente incrementali sui boundary presentational delle route.   |
| client/src/components/dashboard/CapabilityDashboard.tsx                         | Composizione Dashboard da dati già caricati.                             |
| client/src/components/commesse/Commessa360Header.tsx e Commessa360Workspace.tsx | Header e layout Record 360 senza query/mutation.                         |
| client/src/components/kanban/KanbanDesktopBoard.tsx e KanbanMobilePhaseList.tsx | Workbench desktop e lista-per-fase mobile.                               |
| client/src/components/tars/TarsOperationalPanels.tsx                            | Pannelli typed per briefing, prove, proposte e degradazione.             |
| client/src/components/operativita/MobileFieldHeader.tsx e SignaturePad.tsx      | Campo mobile e firma pointer-event compatibile col data URL legacy.      |
| docs/design/modular-control/golden-screens-evidence.md                          | Matrice browser/axe/tastiera/zoom e screenshot sanitizzati.              |
| docs/design/modular-control/evidence/golden/                                    | Screenshot light/dark/mobile sanitizzati con nomi deterministici.        |

### Task 1: Contratti puri e guardie anti-regressione

**Files:**

- Create: client/src/lib/goldenScreenContracts.ts
- Create: client/src/lib/goldenScreenContracts.test.ts
- Modify: client/src/lib/tokenDiscipline.test.ts

**Interfaces:**

- Produces: selectDashboardModules, kanbanPresentation, classifyTarsAvailability, mobilePrioritySections.
- Consumes: capability effettive già risolte da `OperationalContext` (la cui sorgente è `permessi.mie`) e campi già letti dal client Tars.

- [ ] **Step 1: Write failing tests**

  import { classifyTarsAvailability, kanbanPresentation, mobilePrioritySections, selectDashboardModules } from "./goldenScreenContracts";

  it("compone il principal multi-ruolo senza economia non autorizzata", () => {
  expect(selectDashboardModules(new Set(["commessa.read"]))).toEqual([
  "priorita", "agenda", "commesse", "ticket",
  ]);
  expect(selectDashboardModules(new Set(["commessa.read", "economia.read"]))).toContain("economia");
  });
  it("sceglie una lista per fase sotto desktop", () => {
  expect(kanbanPresentation(390)).toBe("mobile-phase-list");
  expect(kanbanPresentation(1200)).toBe("desktop-board");
  });
  it("non inventa dettagli nella degradazione Tars", () => {
  expect(classifyTarsAvailability({ enabled: false, pending: false, provider: null, unavailableReason: null })).toEqual({ kind: "disabled" });
  expect(classifyTarsAvailability({ enabled: true, pending: false, provider: null, unavailableReason: null })).toEqual({ kind: "unavailable", reason: null });
  expect(classifyTarsAvailability({ enabled: true, pending: false, provider: "openai", unavailableReason: null })).toEqual({ kind: "available", provider: "openai" });
  expect(classifyTarsAvailability({ enabled: true, pending: false, provider: "openai", unavailableReason: "Provider non disponibile." })).toEqual({ kind: "unavailable", reason: "Provider non disponibile." });
  });
  it("prioritizza identita e stato su mobile", () => {
  expect(mobilePrioritySections(["documenti", "stato", "identita", "timeline"])).toEqual(["identita", "stato", "timeline", "documenti"]);
  });

Estendere tokenDiscipline.test.ts con scansione fuori da components/ui che fallisce su rf-frame|rf-rail|rf-reveal|Frame & Flow|Officina Digitale.

- [ ] **Step 2: Verify failure**

Run: pnpm test -- client/src/lib/goldenScreenContracts.test.ts client/src/lib/tokenDiscipline.test.ts

Expected: FAIL perché modulo e guardia non esistono.

- [ ] **Step 3: Implement the minimal contract**

  export type DashboardModule = "priorita" | "agenda" | "commesse" | "ticket" | "economia" | "tars";
  export type KanbanPresentation = "desktop-board" | "mobile-phase-list";
  export type TarsAvailability =
  | { kind: "disabled" }
  | { kind: "loading" }
  | { kind: "available"; provider: string }
  | { kind: "unavailable"; reason: string | null };
  export type TarsAvailabilityInput = {
  enabled: boolean;
  pending: boolean;
  provider: string | null;
  unavailableReason: string | null;
  };

  export function selectDashboardModules(capabilities: ReadonlySet<string>): DashboardModule[] {
  const modules: DashboardModule[] = ["priorita", "agenda"];
  if (capabilities.has("commessa.read")) modules.push("commesse");
  modules.push("ticket"); // ticket.list/stats sono protectedProcedure: non inventare ticket.read
  if (capabilities.has("economia.read")) modules.push("economia");
  if (capabilities.has("tars.use")) modules.push("tars");
  return modules;
  }
  export function kanbanPresentation(width: number): KanbanPresentation {
  return width >= 1200 ? "desktop-board" : "mobile-phase-list";
  }

`classifyTarsAvailability(input: TarsAvailabilityInput): TarsAvailability` restituisce `disabled` quando il flag è spento, `loading` mentre `tars.stato` è pending, `unavailable` quando il campo typed `providerDettaglio.motivoIndisponibilita` è valorizzato oppure quando manca un provider dopo il caricamento (con `reason: null`), altrimenti `available` con il provider restituito. Non inventa enum budget/provider/circuit che il router non restituisce. mobilePrioritySections è stable sort P0/P1/P2 e conserva sconosciuti in coda. Nessun React/API/ruoli.

- [ ] **Step 4: Verify pass**

Run: pnpm test -- client/src/lib/goldenScreenContracts.test.ts client/src/lib/tokenDiscipline.test.ts && pnpm check

Expected: PASS.

- [ ] **Step 5: Commit**

  git add client/src/lib/goldenScreenContracts.ts client/src/lib/goldenScreenContracts.test.ts client/src/lib/tokenDiscipline.test.ts
  git commit -m "test: definisci contratti golden screens v3"

### Task 2: Dashboard capability-composable

**Files:**

- Create: client/src/components/dashboard/CapabilityDashboard.tsx
- Modify: client/src/pages/Dashboard.tsx:56-1095
- Test: client/src/lib/goldenScreenContracts.test.ts
- Create: client/src/lib/goldenScreenPresentation.test.ts

**Interfaces:**

- Consumes: Task 1 plus attivabile, StatCard, PipelineCommesse, CalendarioSettimana, DashboardApprofondimenti e TarsBriefing.
- Produces: CapabilityDashboard({ modules, sections, onOpen }), presentational, without query/mutation/model.

- [ ] **Step 1: Add a failing page-specific presentation-boundary test**

  Creare `goldenScreenPresentation.test.ts` con una utility `readPresentation(path)` basata su `readFileSync(new URL(path, import.meta.url), "utf8")` e questa guardia, che è rossa finché il componente non esiste:

  ```ts
  it("mantiene CapabilityDashboard presentational", () => {
    const source = readPresentation(
      "../components/dashboard/CapabilityDashboard.tsx"
    );
    expect(source).not.toMatch(/trpc|useQuery|useMutation/);
    expect(source).toMatch(/CapabilityDashboardProps/);
  });
  ```

  Conservare nel test puro l'asserzione capability già introdotta dal Task 1; questo nuovo test prova il boundary specifico della Task 2.

- [ ] **Step 2: Verify failure**

Run: pnpm test -- client/src/lib/goldenScreenPresentation.test.ts

Expected: FAIL con `ENOENT` perché `CapabilityDashboard.tsx` non esiste ancora.

- [ ] **Step 3: Extract visual composition**

Keep all current queries/mutations/navigation in Dashboard.tsx and derive from `useOperationalContext().capabilities`, not a secondo `permessi.mie` page query or a mutually-exclusive role branch.

    const modules = selectDashboardModules(capacita ?? new Set<string>())
      .filter(module => module !== "tars" || tarsAcceso);
    return <CapabilityDashboard modules={modules} sections={{ priorita, calendario, commesse, ticket, economia, tarsBriefing }} onOpen={onOpen} />;

Compose compact header, focal Priorità di oggi, asymmetric agenda/commesse/ticket and one optional dark/gradient Tars focal panel. Use slice-01 panels/states; never mount economy then hide it, create seven role dashboards or replace real states with decorative KPI cards.

- [ ] **Step 4: Verify**

Run: pnpm test -- client/src/lib/goldenScreenContracts.test.ts client/src/lib/goldenScreenPresentation.test.ts client/src/lib/tokenDiscipline.test.ts && pnpm check

Browser fixture multi-role without `economia.read` at 1440×900 and 390×844 light/dark: no amount DOM/tooltip, Tars unmounted flag-off, keyboard rows, distinct loading/empty/error, no global x-overflow or console error.

- [ ] **Step 5: Commit**

  git add client/src/pages/Dashboard.tsx client/src/components/dashboard/CapabilityDashboard.tsx client/src/lib/goldenScreenContracts.test.ts client/src/lib/goldenScreenPresentation.test.ts
  git commit -m "feat: componi dashboard per capability"

### Task 3: CommessaDetail as Record 360

**Files:**

- Create: client/src/components/commesse/Commessa360Header.tsx
- Create: client/src/components/commesse/Commessa360Workspace.tsx
- Modify: client/src/pages/CommessaDetail.tsx:137-3564
- Test: client/src/lib/goldenScreenContracts.test.ts
- Modify: client/src/lib/goldenScreenPresentation.test.ts

**Interfaces:**

- Consumes: existing record/query/mutation/tabs/upload, TarsFascicoloCard, PianoRateSezione, PagamentiCard, EconomiaCard, SquadraPosaCard.
- Produces: presentation-only header/workspace; no tRPC imports.

- [ ] **Step 1: Write a failing Commessa presentation-boundary test**

  Estendere `goldenScreenPresentation.test.ts` per leggere entrambi i nuovi file, vietare `trpc`, `useQuery` e `useMutation`, e richiedere `Commessa360HeaderProps`/`Commessa360WorkspaceProps`. Il test deve fallire con `ENOENT` prima della creazione. Conservare separatamente il test puro dell'ordine mobile del Task 1.

- [ ] **Step 2: Verify failure**

Run: pnpm test -- client/src/lib/goldenScreenPresentation.test.ts

Expected: FAIL perché i due componenti Record 360 non esistono ancora.

- [ ] **Step 3: Extract header and workspace**

  export type Commessa360HeaderProps = {
  codice: string; cliente: string; stato: string; priorita?: string;
  meta: Array<{ icon: React.ElementType; label: string }>;
  primaryAction: React.ReactNode | null; onBack: () => void;
  };

Use semantic header, nav aria-label Percorso commessa and h1; real status plus only an already-authorized CTA. Workspace receives overview, timeline, documents, operations, economy, communications, tars, details slots; desktop inspector for secondary content and mobile P0/P1/P2 disclosure. Preserve current tabs with aria-label Sezioni della commessa, dialogs, upload, invalidations, gates and euro helpers in page owner; never move business code/mount protected economy.

- [ ] **Step 4: Verify**

Run: pnpm test -- client/src/lib/goldenScreenContracts.test.ts client/src/lib/goldenScreenPresentation.test.ts client/src/lib/tokenDiscipline.test.ts && pnpm check

Browser: long company, document gate, many documents, payment-authorized and unauthorized; check deep link/back, tabs/dialog keyboard, Tars absent flag-off, no amount leak, 200% zoom, sticky action, 1440×900/390×844 light/dark.

- [ ] **Step 5: Commit**

  git add client/src/pages/CommessaDetail.tsx client/src/components/commesse/Commessa360Header.tsx client/src/components/commesse/Commessa360Workspace.tsx client/src/lib/goldenScreenContracts.test.ts client/src/lib/goldenScreenPresentation.test.ts
  git commit -m "feat: riorganizza commessa come record 360"

### Task 4: Kanban desktop workbench and mobile phase list

**Files:**

- Create: client/src/components/kanban/KanbanDesktopBoard.tsx
- Create: client/src/components/kanban/KanbanMobilePhaseList.tsx
- Modify: client/src/pages/KanbanBoard.tsx:49-658
- Test: client/src/lib/goldenScreenContracts.test.ts
- Modify: client/src/lib/goldenScreenPresentation.test.ts

**Interfaces:** Consumes FASI, COLONNE_FLAT, byStato, filters, DOC_GATE_BLOCKED, confirm dialog and page mutation. Produces components with onOpen(commessaId) and onMove(commessaId, nuovoStato); no tRPC.

- [ ] **Step 1: Write a failing Kanban presentation-boundary test**

  Estendere `goldenScreenPresentation.test.ts` per leggere i due nuovi file, vietare tRPC/query/mutation e richiedere sia `onOpen` sia `onMove` nei rispettivi contratti props. Il test è rosso finché i file non esistono. Nel test puro già creato, mantenere il breakpoint 1199/1200 e asserire che `FASI.flatMap(f => f.colonne).map(c => c.id)` resti canonico e non aggiunga mai `archiviata` come colonna.

- [ ] **Step 2: Verify failure**

Run: pnpm test -- client/src/lib/goldenScreenPresentation.test.ts

Expected: FAIL perché le due presentazioni Kanban non esistono ancora.

- [ ] **Step 3: Extract both presentations**

Desktop: sticky toolbar, dense local-scroll columns and semantic card controls. Mobile: one phase/count/P0 card and keyboard reachable menu/select Sposta in…, using same onMove; client never validates transition. Keep queries, filters, delivery mutation, magazzino/squadre, invalidations and ConfirmDialog in page. Do not add DnD library/progress percentage or Produzione route/menu.

- [ ] **Step 4: Verify**

Run: pnpm test -- client/src/lib/goldenScreenContracts.test.ts client/src/lib/goldenScreenPresentation.test.ts client/src/lib/navigation.test.ts client/src/lib/tokenDiscipline.test.ts && pnpm check

Browser: full desktop columns and 390px phase list; keyboard card/menu/dialog, gate then explicit existing force confirm/cancel, filters/deep link; verify /produzione, /produzione?tab=bom and /produzione/x redirect /kanban; capture light/dark/mobile no global x-scroll.

- [ ] **Step 5: Commit**

  git add client/src/pages/KanbanBoard.tsx client/src/components/kanban/KanbanDesktopBoard.tsx client/src/components/kanban/KanbanMobilePhaseList.tsx client/src/lib/goldenScreenContracts.test.ts client/src/lib/goldenScreenPresentation.test.ts
  git commit -m "feat: adatta kanban a desktop e mobile"

### Task 5: Tars typed/degraded operational intelligence

**Files:**

- Create: client/src/components/tars/TarsOperationalPanels.tsx
- Modify: client/src/pages/Tars.tsx:36-544
- Test: client/src/lib/goldenScreenContracts.test.ts
- Modify: client/src/lib/goldenScreenPresentation.test.ts

**Interfaces:** Consumes current platform.interruttori, tars.\*, TarsBriefing, AzioniTurno, EvidenzeTurno. Produces TarsOperationalPanels({ availability, briefing, status, turns, actions }), presentation-only.

- [ ] **Step 1: Write a failing Tars presentation-boundary test**

  Estendere `goldenScreenPresentation.test.ts` per leggere `TarsOperationalPanels.tsx`, vietare tRPC/query/mutation e richiedere una prop `availability: TarsAvailability`; il test deve fallire prima che il file esista. Conservare nel test puro del Task 1 i casi kill switch e motivo indisponibilità tipizzato.

- [ ] **Step 2: Verify failure**

Run: pnpm test -- client/src/lib/goldenScreenPresentation.test.ts

Expected: FAIL perché il pannello presentational Tars non esiste ancora.

- [ ] **Step 3: Recompose without changing execution**

Keep enabled gating, mutation/invalidation/idempotence and no request while typing. Order: briefing, signals/evidence/omissions, proposals/actions/undo, typed availability, history; composer secondary. Use dark/gradient only focal Tars panel. Show provider and `providerDettaglio.motivoIndisponibilita` exactly at their existing authorization level; do not label budget or circuit as a distinct UI state because `tars.stato` does not return those enums. A degraded turn uses only the returned turn payload/text. Costs stay direzione-only. Flag off mounts no Tars query.

- [ ] **Step 4: Verify**

Run: pnpm test -- client/src/lib/goldenScreenContracts.test.ts client/src/lib/goldenScreenPresentation.test.ts server/tars/orchestratore.test.ts server/tars/briefing.test.ts client/src/lib/tokenDiscipline.test.ts && pnpm check

Browser fixtures flag-off, typed provider unavailable, generic degraded turn, turn evidence+omission+pending proposal: zero tars request flag-off, zero send/model typing, keyboard composer/undo/approve, costs hidden non-direzione, no streaming simulation, 1440×900/390×844 light/dark.

- [ ] **Step 5: Commit**

  git add client/src/pages/Tars.tsx client/src/components/tars/TarsOperationalPanels.tsx client/src/lib/goldenScreenContracts.test.ts client/src/lib/goldenScreenPresentation.test.ts
  git commit -m "feat: porta tars a cabina operativa typed"

### Task 6: Rilievo and Verbale mobile 390px

**Files:**

- Create: client/src/components/operativita/MobileFieldHeader.tsx
- Create: client/src/components/operativita/SignaturePad.tsx
- Modify: client/src/pages/RilievoDetail.tsx:43-675
- Modify: client/src/pages/VerbaleChiusura.tsx:21-456
- Test: client/src/lib/goldenScreenContracts.test.ts
- Modify: client/src/lib/goldenScreenPresentation.test.ts

**Interfaces:** Produces MobileFieldHeader({ title, subtitle, status, onBack, primaryAction }) and SignaturePad({ label, value, onChange, disabled? }); consumes current forms/mutations and same signature data URL.

- [ ] **Step 1: Write a failing field-component boundary test**

  Estendere `goldenScreenPresentation.test.ts` per leggere `MobileFieldHeader.tsx` e `SignaturePad.tsx`, vietare tRPC/query/mutation e richiedere nel pad `onPointerDown`, `onPointerMove`, `onPointerUp`, `onPointerCancel` e pointer capture. Il test è rosso prima della creazione dei file. Conservare il test puro di priorità mobile del Task 1.

- [ ] **Step 2: Verify failure**

Run: pnpm test -- client/src/lib/goldenScreenPresentation.test.ts

Expected: FAIL perché i due componenti campo non esistono ancora.

- [ ] **Step 3: Implement field-first layouts**

Header gives semantic title/back/status. Rilievo at 390px: one column, persistent labels, text-base inputs, unit aria-describedby, nearby error, disclosures for groups, attachments P2; preserve keys and aperture.update. Replace local canvas with Pointer Events onPointerDown/Move/Up/Cancel plus pointer capture, 44px Cancella firma, conferma testuale `aria-live` dell'avvenuta acquisizione and same legacy data URL. Both pages use slice-01 StickyActionBar, safe-area padding and pending disabled CTA; success only after onSuccess.

La firma resta un input essenzialmente path-based e il contratto persistito accetta il data URL esistente: non inventare una firma testuale equivalente né cambiare payload. Dichiarare nell'evidence che il tratto sul canvas è pointer-only; rendere invece raggiungibili da tastiera Cancella, Salva, errori e ogni altro controllo, senza attestare il gesto di firma come keyboard-complete.

- [ ] **Step 4: Verify**

Run: pnpm test -- client/src/lib/goldenScreenContracts.test.ts client/src/lib/goldenScreenPresentation.test.ts client/src/lib/tokenDiscipline.test.ts && pnpm check

Browser 390×844/360×800: measure, disclosure, conditions, attachment remove, pointer sign, keyboard clear/save; iOS no input zoom, bottom bar/tastiera, error retry, reduced motion, 200% zoom, light/dark screenshots. Registrare esplicitamente l'eccezione path-based del canvas.

- [ ] **Step 5: Commit**

  git add client/src/pages/RilievoDetail.tsx client/src/pages/VerbaleChiusura.tsx client/src/components/operativita/MobileFieldHeader.tsx client/src/components/operativita/SignaturePad.tsx client/src/lib/goldenScreenContracts.test.ts client/src/lib/goldenScreenPresentation.test.ts
  git commit -m "feat: ottimizza rilievo e verbale per campo"

### Task 7: Fornitori/DI esclusa

Decisione esplicita dell'utente del 31/08/2026: non modificare
`client/src/pages/FornitoriList.tsx`, `client/src/components/fornitori/` o le
relative superfici Document Intelligence in questa slice o nelle successive.
La route resta funzionalmente invariata e sarà registrata come
`esclusa con motivazione` nel manifest; nessuna evidenza visuale v3 viene
prodotta per questa pagina.

### Task 8: Hardening and evidence

**Files:**

- Create: docs/design/modular-control/golden-screens-evidence.md
- Create directory through sanitized evidence files: docs/design/modular-control/evidence/golden/
- Modify: docs/design/modular-control/route-manifest.md
- Modify: docs/design/modular-control/transformation-matrix.md
- Modify: docs/design/modular-control/verification-log.md
- Modify: client/src/lib/tokenDiscipline.test.ts only for necessary guard
- Modify: docs/source-of-truth-matrix.md only if a documented contract truly changed

- [ ] **Step 1: Create and complete the browser evidence matrix**

Create `golden-screens-evidence.md` with columns `Screen`, `Fixture`, `Viewport/theme`, `State`, `axe`, `Keyboard`, `Zoom`, `Motion`, `Console`, and `Screenshot`. Do not commit `pending` cells: execute the check first, then record `pass`, a concrete issue ID, or `not applicable` with reason. Per la firma, separare “controlli tastiera: pass” da “tratto canvas: not applicable — gesto essenzialmente path-based con payload data URL legacy”.

Save at least these sanitized files:

- `docs/design/modular-control/evidence/golden/dashboard-principal-no-economia-1440x900-light.png`
- `docs/design/modular-control/evidence/golden/dashboard-principal-no-economia-1440x900-dark.png`
- `docs/design/modular-control/evidence/golden/dashboard-principal-no-economia-390x844-light.png`
- `docs/design/modular-control/evidence/golden/commessa-360-1440x900-light.png`
- `docs/design/modular-control/evidence/golden/commessa-360-1440x900-dark.png`
- `docs/design/modular-control/evidence/golden/commessa-360-390x844-light.png`
- `docs/design/modular-control/evidence/golden/kanban-gate-1440x900-light.png`
- `docs/design/modular-control/evidence/golden/kanban-gate-1440x900-dark.png`
- `docs/design/modular-control/evidence/golden/kanban-gate-390x844-light.png`
- `docs/design/modular-control/evidence/golden/tars-degraded-1440x900-light.png`
- `docs/design/modular-control/evidence/golden/tars-degraded-1440x900-dark.png`
- `docs/design/modular-control/evidence/golden/tars-degraded-390x844-light.png`
- `docs/design/modular-control/evidence/golden/rilievo-390x844-light.png`
- `docs/design/modular-control/evidence/golden/rilievo-390x844-dark.png`
- `docs/design/modular-control/evidence/golden/verbale-390x844-light.png`

- [ ] **Step 2: Run full automatic suite**

Run: pnpm check && pnpm test && pnpm build

Expected: PASS; failure returns to task owner, never snapshot/deroga workaround.

- [ ] **Step 3: Execute browser QA**

Run pnpm dev with sanitized fixtures. Per row: axe desktop/mobile, keyboard (con l'eccezione firma path-based dichiarata sopra), 200% zoom/reflow, reduced motion, focus not hidden, document.documentElement.scrollWidth === document.documentElement.clientWidth, clean console and screenshots. Record observed result and repository-relative PNG paths; never commit production data. Also verify rollback flag-off, produzione redirect, Tars zero query flag-off, protected amounts absent and DI/proposals no automatic mutation.

- [ ] **Step 4: Present the single high-fidelity checkpoint**

Present Dashboard principal without economy, Commessa 360, Kanban, Tars degraded and Rilievo 390px using the evidence above, with light/dark where applicable, one non-happy state per surface, and the documented structural delta from the old UI. Pause once for approval of the complete visual direction. Do not begin slices 03–04 until approval; after approval, do not request repeated aesthetic checkpoints unless a new decision changes behavior or authorization.

- [ ] **Step 5: Re-run final guards**

Run: pnpm test -- client/src/lib/tokenDiscipline.test.ts client/src/lib/navigation.test.ts client/src/lib/goldenScreenContracts.test.ts client/src/lib/goldenScreenPresentation.test.ts && pnpm check && git diff --check && git status --short

Expected: PASS, no whitespace error/untracked sensitive asset. Update truth matrix only for true contract change.

- [ ] **Step 6: Commit evidence**

  git add docs/design/modular-control/golden-screens-evidence.md docs/design/modular-control/evidence/golden docs/design/modular-control/route-manifest.md docs/design/modular-control/transformation-matrix.md docs/design/modular-control/verification-log.md client/src/lib/tokenDiscipline.test.ts
  git commit -m "docs: registra verifica golden screens modular control"

If truth matrix changed, stage it; otherwise do not add noise. Final report states no deploy/push/merge/production verification/flag activation.

## Dependencies and acceptance

Order: slice 01 → Task 1 → Tasks 2–6 in listed order → Task 7 excluded → Task 8. Tasks 2–6 are intentionally sequential because each extends the same presentation-boundary guard; do not parallelize edits to that file. Acceptance: Dashboard uses capability union/no financial leakage; Commessa preserves deep links/mutations; Kanban preserves canonical states/accessibile move; Tars typed/honest/non-chat-first; Rilievo/Verbale complete at 390px. Fornitori/DI remains untouched and is documented as excluded. Final gates: all package commands pass, no console/global overflow, observed browser matrix and rollback OFF verified.

## Plan self-review

- **Coverage:** Tasks 2–6 cover the five approved screen families; Task 7 records the explicit Fornitori/DI exclusion; constraints and Task 8 cover responsive, accessibility, motion, anti-copy, rollback and verification.
- **No placeholders:** each task has exact files, boundaries, failing test, commands, implementation scope, browser proof and commit.
- **Type consistency:** Task 1 declares all four pure helpers; each Task 2–6 adds its own initially-red source-boundary test before creating the relevant presentational component. Pages retain query/mutation ownership and extracts remain presentational.
