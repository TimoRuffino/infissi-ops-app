# Modular Control — Slice 03 Operational Routes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrare le route operative — Planning, Squadre, Magazzino, Clienti, Commesse, Pagamenti, Economia e Marginalità — alla grammatica Modular Control senza alterare contratti, autorizzazioni, dati o workflow.

**Architecture:** La slice mantiene i router tRPC esistenti come unica sorgente di letture e mutation. Estrae solo unità UI locali e pure per toolbar, viste responsive, stati azione e guardie UX; ogni CTA usa le capability effettive o il confine direzione già applicato dal server e non ricostruisce regole di dominio nel client. Planning resta un workbench con calendario desktop e agenda mobile; Squadre, Magazzino, Clienti e Commesse restano code/listati densi; Pagamenti ed Economia non montano dati economici prima dell'autorizzazione; Marginalità rimane direzione-only.

**Tech Stack:** React 19, TypeScript, Wouter, tRPC/React Query, Tailwind 4, shadcn/Radix, Lucide, Framer Motion già presente, Vitest.

**Spec:** `docs/design/master-prompt-ruffino-flow-ui-ux-v3.md`

## Global Constraints

- Lavorare solo sul branch `feature/ui-v2-frame-flow`; non creare/sostituire branch, non fare merge, push, PR o deploy.
- Questa slice dipende dalla slice 01: token semantici Modular Control in `client/src/index.css`, shell/flag fail-closed e primitive condivise devono essere già disponibili. Non introdurre hex, palette Tailwind numeriche, una seconda libreria UI o un secondo meccanismo di tema.
- Questa slice dipende dalla slice 02: `PageHeader`, `DataSurface`, `StatePanel`, `StickyActionBar` e `ContextInspector` consolidati nella slice 01 sono le sole primitive condivise da usare. Non importare componenti pagina-specifici delle golden screen e non cambiare i loro contratti.
- Il flag esistente `FLAG_UI_V2` è globale di processo e governa solo presentazione/shell. OFF deve lasciare invariati query, mutation, dati, route e workflow; un pilot per utente/ruolo/sede non si implementa qui.
- Non modificare router, schema, `persistedStore`, storage o API tRPC per motivi di layout. In particolare questa slice non cambia `server/routers/{clienti,commesse,interventi,squadre,magazzino,ficFatture,ficCosti}.ts` né la procedura direzione di `commesse.marginalita`.
- Ogni dato business resta sede-scoped lato server. Non serializzare record, label, filtri o draft di una sede in localStorage; il cambio sede deve attraversare il confine `OperationalContext` della slice 01, che blocca il render, rimuove la cache protetta e solo dopo commette il nuovo scope. Questa slice verifica quel contratto e non reimplementa la cache in una pagina o in `SedeSwitcher`.
- Planning: creare/aggiornare stato intervento richiede le capability server esistenti `intervento.plan`; assegnare una squadra richiede anche `intervento.assign`; eliminare richiede `intervento.delete`. Il client nasconde/disabilita le CTA non consentite ma il server resta il confine.
- Squadre: lista leggibile da utenti autenticati; create/update/delete sono direzione-only perché i router usano `adminProcedure`. Non sostituire questa regola con una capability inventata.
- Magazzino: mantenere l'eleggibilità server-side della commessa da `produzione` in poi, esclusa l'archiviata. Non modificare stato commessa, data consegna o quantità nel client fuori dalle mutation esistenti.
- Clienti: `clienti.list/byId` restano `protectedProcedure` sede-scoped come oggi; create/modifica/assegnazione/archiviazione/eliminazione usano rispettivamente `cliente.create`, `cliente.update_operational`, `cliente.assign`, `cliente.archive`, `cliente.delete`. Le CTA secondarie richiedono inoltre le capability dei rispettivi router (`commessa.create`, `intervento.plan`, `ticket.create`). Per aziende, condomini ed enti conservare la convenzione Ragione sociale in `cognome` e formattare con `nomeCompleto` da `client/src/lib/name.ts`.
- Commesse: la lista è il payload già sagomato da `commesse.list`; non ricostruire o dedurre costi, margini, incassi o residui. Senza `pagamento.read` non renderizzare, calcolare, mettere in tooltip né mantenere in cache `importoTotale`/`importoIncassato`; senza `economia.read` il form di creazione omette sia il campo sia l'input `importoTotale`.
- Commesse: `commesse.archive/restore` sono oggi procedure protette, sede-scoped e deliberatamente reversibili per ogni utente autenticato; non inventare `commessa.archive` né nascondere l'azione con una capability inesistente. L'eliminazione resta `commessa.delete`; il dialog “nuovo cliente” nella pagina resta `cliente.create`.
- Pagamenti: la lettura richiede `pagamento.read`, la registrazione `pagamento.record`; prima che `OperationalContext` sia `ready` non montare query o dati della pagina. Il provider resta l'unico owner della query `permessi.mie`. Ogni cifra usa `formatEuro`/`parseEuroPositivo` di `client/src/lib/euro.ts`; `importoIncassato` deriva esclusivamente da `pagamenti[]` e non diventa un input.
- Economia: la lettura di fatture/costi FiC richiede la capability effettiva `economia.read`, non un controllo locale `direzione || amministrazione`; non montare `ficFatture.*` o `ficCosti.*`, né conservare i loro risultati, per utenti non autorizzati. Conservare FiC come sorgente fiscale e le mutation di collegamento/riconciliazione già disponibili, senza calcoli economici client-side o nuove azioni.
- Marginalità: rimane strettamente direzione-only tramite `RequireDirezione` e `commesse.marginalita`/`requireDirezione`; `economia.read` non apre questa route. I valori restano stime CRM mostrate solo dal payload server, non contabilità e non base per mutation.
- Google Calendar resta un overlay read-only: nessuna CTA di modifica/cancellazione su eventi esterni e nessun sincronismo durante digitazione.
- Stato, gate, completamento, ritardi e conteggi devono essere testuali oltre che cromatici. Non inventare percentuali, SLA, progresso o disponibilità non restituiti dal server.
- UI in italiano; Plus Jakarta Sans; Lucide per icone; target 44×44 px e 48 px per azioni critiche mobile; `prefers-reduced-motion`, focus visibile, tastiera e alternativa al drag obbligatori.
- Verificare ogni route a 1440×900 e 390×844; questa slice aggiunge 1280×800, 1024×768, 768×1024, 360×800 e zoom 200% ai gate del workbench/form.

---

## Scope della slice e confini espliciti

| Route          | Archetipo           | Risultato della slice                                                                    | Fuori scope                                                    |
| -------------- | ------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `/planning`    | Workbench           | toolbar sticky, agenda mobile, calendario desktop, sheet dettaglio, CTA capability-aware | nuovi tipi intervento, modifiche Google Calendar, nuovi router |
| `/squadre`     | Lista operativa     | roster leggibile, carico corrente, gestione direzione chiaramente separata               | ruoli/capability o assegnazione automatica                     |
| `/magazzino`   | Workbench/queue     | code consegne dense, filtri, dettaglio e ricezione con stati server reali                | ordini fornitore, listini, costi o nuova logistica             |
| `/clienti`     | Lista anagrafica    | ricerca/filtri densi, CTA per capability e ragione sociale coerente                      | merge, import massivo, nuovi campi/router                      |
| `/clienti/:id` | Dettaglio operativo | contesto cliente e CTA figlie capability-aware, `NOT_FOUND` cross-sede                   | modifiche a commesse/interventi/ticket/garanzie server         |
| `/commesse`    | Lista operativa     | filtri, stati e creazione cap-aware senza leakage economico                              | dettaglio commessa, kanban, costi/margini o nuove API          |
| `/pagamenti`   | Registro riservato  | lettura/registrazione separate per capability, dati mascherati per default               | modifica diretta incassato, export, contabilità                |
| `/economia`    | Console riservata   | accesso `economia.read`, dati FiC e azioni esistenti solo dopo il gate                   | nuova riconciliazione, calcoli, sync o policy FiC              |
| `/marginalita` | Analisi direzione   | tabella/stati leggibili con disclaimer stima CRM                                         | apertura per capability economiche, audit o calcoli server     |

Le route golden `/commesse/:id`, `/kanban`, `/tars`, `/fornitori`, rilievo e verbale restano fuori scope, come `/produzione/*` che continua a redirigere a `/kanban`. Questa slice non cambia navigazione, redirect, shell, API o feature flag.

## File structure

- Modify: `client/src/pages/Planning.tsx` — compone query/mutation esistenti e le nuove unità Planning; conserva input, URL e behavior delle mutation.
- Create: `client/src/components/planning/PlanningToolbar.tsx` — cambio vista/data e apertura creazione, senza dati business.
- Create: `client/src/components/planning/PlanningAgenda.tsx` — alternativa mobile/lista alle griglie e accesso tastiera a dettaglio/azioni.
- Create: `client/src/components/planning/PlanningInterventoSheet.tsx` — dettaglio/creazione/modifica di un intervento CRM; non accetta eventi esterni come mutabili.
- Create: `client/src/lib/operationalRoutes.ts` — funzioni pure per esporre CTA Planning dalle capability già calcolate e descrivere stati consegna.
- Test: `client/src/lib/operationalRoutes.test.ts` — matrice capability/stato pura, senza rete.
- Modify: `client/src/pages/SquadreList.tsx` — struttura roster e CTA direzione-only senza cambiare router.
- Create: `client/src/components/squadre/SquadraRosterCard.tsx` — una squadra, lavori correnti e azioni già autorizzate dal caller.
- Modify: `client/src/pages/Magazzino.tsx` — workbench consegne e dettaglio usando solo `magazzino.*` esistenti.
- Create: `client/src/components/magazzino/ConsegneAgenda.tsx` — lista prioritaria mobile/desktop compatto con stato testuale e link commessa.
- Modify: `client/src/pages/ClientiList.tsx` — lista clienti con filtri e CTA condizionate alle capability effettive.
- Modify: `client/src/pages/ClienteDetail.tsx` — contesto e azioni figlie capability-aware, mantenendo il `NOT_FOUND` server.
- Modify: `client/src/pages/CommesseList.tsx` — lista e creazione senza leakage o input economici non autorizzati.
- Modify: `client/src/pages/Pagamenti.tsx` — gate query/CTA per lettura e registrazione separati.
- Modify: `client/src/pages/Economia.tsx` — gate `economia.read` prima delle query FiC, senza role shortcut.
- Modify: `client/src/pages/Marginalita.tsx` — densità/accessibilità della vista direzione senza ampliare accesso.
- Modify: `client/src/lib/tokenDiscipline.test.ts` — include le nuove cartelle e blocca deroghe colore non documentate.
- Create: `docs/design/modular-control/operational-routes-evidence.md` — matrice completa di viewport, tastiera, axe, zoom, reduced motion, flag OFF, privacy, console e link alle prove.
- Create directory through sanitized evidence files: `docs/design/modular-control/evidence/operational/` — screenshot locali sintetici, mai dati di produzione.
- Modify: `docs/design/modular-control/verification-log.md` — esiti ripetibili e comandi realmente eseguiti, senza dichiarare rollout.
- Modify: `docs/design/modular-control/route-manifest.md` — stato/evidenza soltanto delle route di questa slice, senza toccare le golden screen.

## Interfacce della slice

```ts
// client/src/lib/operationalRoutes.ts
export type PlanningPermissions = {
  canPlan: boolean;
  canAssign: boolean;
  canDelete: boolean;
};

export function planningPermissions(
  capabilities: ReadonlySet<string> | null
): PlanningPermissions;

export type DeliveryState =
  | "late"
  | "due"
  | "pending"
  | "received"
  | "unscheduled";

export function deliveryState(input: {
  arrivato: boolean;
  dataConsegna: string | null | undefined;
  today: string;
}): DeliveryState;

export function deliveryStateCopy(state: DeliveryState): string;

export type CustomerPermissions = {
  canCreateCustomer: boolean;
  canUpdateCustomer: boolean;
  canAssignCustomer: boolean;
  canArchiveCustomer: boolean;
  canDeleteCustomer: boolean;
  canCreateCommessa: boolean;
  canPlanIntervento: boolean;
  canCreateTicket: boolean;
};

export function customerPermissions(
  capabilities: ReadonlySet<string> | null
): CustomerPermissions;

export type CommesseListPermissions = {
  canCreate: boolean;
  canCreateWithAmount: boolean;
  canDelete: boolean;
};

export function commesseListPermissions(
  capabilities: ReadonlySet<string> | null
): CommesseListPermissions;

export type EconomicRoutePermissions = {
  canReadPayments: boolean;
  canRecordPayments: boolean;
  canReadEconomy: boolean;
};

export function economicRoutePermissions(
  capabilities: ReadonlySet<string> | null
): EconomicRoutePermissions;
```

```ts
// client/src/components/planning/PlanningInterventoSheet.tsx
export type PlanningInterventoDraft = {
  linkKind: "commessa" | "ticket" | "reclamo" | "rifacimento";
  linkId: string;
  squadraId: string;
  tipo: "rilievo" | "posa" | "assistenza" | "altro";
  dataPianificata: string;
  oraInizio: string;
  oraFine: string;
  indirizzo: string;
  note: string;
};

export type PlanningInterventoSheetProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
  permissions: PlanningPermissions;
  mode: "create" | "edit" | "read-external";
  draft: PlanningInterventoDraft;
  onDraftChange(next: PlanningInterventoDraft): void;
  onSubmit(): void;
  isPending: boolean;
  squadre: Array<{ id: number; nome: string }>;
  externalEvent?: {
    title: string;
    startsAt?: string;
    endsAt?: string;
    sourceName?: string;
  };
};
```

---

### Task 1: Stabilire la matrice operativa pura e i test TDD

**Files:**

- Create: `client/src/lib/operationalRoutes.ts`
- Create: `client/src/lib/operationalRoutes.test.ts`
- Modify: `client/src/lib/tokenDiscipline.test.ts`

**Interfaces:**

- Consumes: capability effettive come `ReadonlySet<string>` già risolte da `OperationalContext` tramite `permessi.mie`; le stringhe capability già presenti in `server/authz/capabilities.ts`.
- Produces: `planningPermissions`, `deliveryState`, `deliveryStateCopy`; tutte le route della slice usano queste funzioni senza duplicare la stessa matrice.

- [ ] **Step 1: Scrivere i test fallenti della matrice capability e consegne**

```ts
// client/src/lib/operationalRoutes.test.ts
import { describe, expect, it } from "vitest";
import {
  deliveryState,
  deliveryStateCopy,
  planningPermissions,
} from "./operationalRoutes";

describe("planningPermissions", () => {
  it("non espone CTA durante il caricamento delle capability", () => {
    expect(planningPermissions(null)).toEqual({
      canPlan: false,
      canAssign: false,
      canDelete: false,
    });
  });

  it("separa pianificazione, assegnazione e cancellazione", () => {
    expect(planningPermissions(new Set(["intervento.plan"]))).toEqual({
      canPlan: true,
      canAssign: false,
      canDelete: false,
    });
    expect(
      planningPermissions(
        new Set(["intervento.plan", "intervento.assign", "intervento.delete"])
      )
    ).toEqual({ canPlan: true, canAssign: true, canDelete: true });
  });
});

describe("deliveryState", () => {
  it("non tratta una consegna senza data come ritardo", () => {
    expect(
      deliveryState({
        arrivato: false,
        dataConsegna: null,
        today: "2026-08-31",
      })
    ).toBe("unscheduled");
    expect(deliveryStateCopy("unscheduled")).toBe("Data da definire");
  });

  it("distingue ricevuto, ritardo, oggi e futuro", () => {
    expect(
      deliveryState({
        arrivato: true,
        dataConsegna: "2026-08-20",
        today: "2026-08-31",
      })
    ).toBe("received");
    expect(
      deliveryState({
        arrivato: false,
        dataConsegna: "2026-08-30",
        today: "2026-08-31",
      })
    ).toBe("late");
    expect(
      deliveryState({
        arrivato: false,
        dataConsegna: "2026-08-31",
        today: "2026-08-31",
      })
    ).toBe("due");
    expect(
      deliveryState({
        arrivato: false,
        dataConsegna: "2026-09-01",
        today: "2026-08-31",
      })
    ).toBe("pending");
  });
});
```

- [ ] **Step 2: Eseguire i test per confermare il fallimento iniziale**

Run: `pnpm vitest run client/src/lib/operationalRoutes.test.ts`

Expected: FAIL perché il modulo `./operationalRoutes` non esiste.

- [ ] **Step 3: Implementare le funzioni pure senza policy o dati duplicati**

```ts
// client/src/lib/operationalRoutes.ts
export type PlanningPermissions = {
  canPlan: boolean;
  canAssign: boolean;
  canDelete: boolean;
};

export function planningPermissions(
  capabilities: ReadonlySet<string> | null
): PlanningPermissions {
  return {
    canPlan: capabilities?.has("intervento.plan") ?? false,
    canAssign: capabilities?.has("intervento.assign") ?? false,
    canDelete: capabilities?.has("intervento.delete") ?? false,
  };
}

export type DeliveryState =
  | "late"
  | "due"
  | "pending"
  | "received"
  | "unscheduled";

export function deliveryState({
  arrivato,
  dataConsegna,
  today,
}: {
  arrivato: boolean;
  dataConsegna: string | null | undefined;
  today: string;
}): DeliveryState {
  if (arrivato) return "received";
  if (!dataConsegna) return "unscheduled";
  if (dataConsegna < today) return "late";
  if (dataConsegna === today) return "due";
  return "pending";
}

export function deliveryStateCopy(state: DeliveryState): string {
  return {
    late: "In ritardo",
    due: "Prevista oggi",
    pending: "In arrivo",
    received: "Ricevuto",
    unscheduled: "Data da definire",
  }[state];
}
```

- [ ] **Step 4: Ampliare la guardia token alle cartelle create dalla slice**

Aggiungere `client/src/components/planning`, `client/src/components/squadre` e `client/src/components/magazzino` alla scansione già ricorsiva senza aggiungere deroghe. Il test deve continuare a rifiutare `text-white` sopra un pieno semantico e classi `bg-[#...]`.

```ts
it("non introduce deroghe hex per le route operative", () => {
  expect(DEROGHE_HEX).not.toContain(
    "client/src/components/planning/PlanningAgenda.tsx"
  );
  expect(DEROGHE_HEX).not.toContain(
    "client/src/components/squadre/SquadraRosterCard.tsx"
  );
  expect(DEROGHE_HEX).not.toContain(
    "client/src/components/magazzino/ConsegneAgenda.tsx"
  );
});
```

- [ ] **Step 5: Eseguire il test mirato e il typecheck**

Run: `pnpm vitest run client/src/lib/operationalRoutes.test.ts client/src/lib/tokenDiscipline.test.ts && pnpm check`

Expected: PASS; nessuna nuova deroga cromatica e tipi delle interfacce esportate risolti.

- [ ] **Step 6: Creare il commit atomico**

```bash
git add client/src/lib/operationalRoutes.ts client/src/lib/operationalRoutes.test.ts client/src/lib/tokenDiscipline.test.ts
git commit -m "test(ui): define operational route guards"
```

### Task 2: Migrare Planning a workbench capability-aware

**Files:**

- Modify: `client/src/pages/Planning.tsx`
- Create: `client/src/components/planning/PlanningToolbar.tsx`
- Create: `client/src/components/planning/PlanningAgenda.tsx`
- Create: `client/src/components/planning/PlanningInterventoSheet.tsx`
- Test: `client/src/lib/operationalRoutes.test.ts`

**Interfaces:**

- Consumes: `planningPermissions` del Task 1; `useOperationalContext().capabilities/status`; `trpc.interventi.list/create/update/delete`, `trpc.externalCalendars.events/list` e gli stessi payload cliente/commessa/squadra/ticket/reclamo/rifacimento già interrogati da `Planning.tsx`.
- Produces: un Planning che non offre modifica a eventi esterni, non offre mutation non autorizzate e mantiene tutte le mutation esistenti con input invariato.

- [ ] **Step 1: Estendere il test capability con il caso assegnazione**

```ts
it("non permette di assegnare una squadra senza intervento.assign", () => {
  const permissions = planningPermissions(new Set(["intervento.plan"]));
  expect(permissions.canPlan).toBe(true);
  expect(permissions.canAssign).toBe(false);
});
```

- [ ] **Step 2: Eseguire il test e verificare il fallimento se la matrice regredisce**

Run: `pnpm vitest run client/src/lib/operationalRoutes.test.ts -t "assegnare una squadra"`

Expected: PASS prima di modificare la UI; questo è il comportamento server da preservare, non una nuova policy.

- [ ] **Step 3: Estrarre toolbar, agenda e sheet con responsabilità separate**

`PlanningToolbar` riceve solo `view`, `cursor`, callback per precedente/successivo/oggi e `canCreate`; non legge tRPC. `PlanningAgenda` riceve interventi CRM già arricchiti e richiama `onOpenIntervento(id)`; ogni card è un `button` con titolo, tipo, ora, squadra/indirizzo e testo di stato. `PlanningInterventoSheet` riceve `mode="read-external"` per gli eventi Google e in quel mode non rende submit, delete, select squadra o campi editabili.

```tsx
// nel contenitore Planning.tsx; il provider della slice 01 è l'unico owner di permessi.mie
const { capabilities, status: operationalStatus } = useOperationalContext();
const permissions = planningPermissions(
  operationalStatus === "ready" ? capabilities : null
);

<PlanningToolbar
  view={view}
  cursor={cursor}
  canCreate={permissions.canPlan}
  onChangeView={setView}
  onPrevious={() =>
    setCursor(
      addDays(cursor, view === "month" ? -28 : view === "week" ? -7 : -1)
    )
  }
  onToday={() => setCursor(new Date())}
  onNext={() =>
    setCursor(addDays(cursor, view === "month" ? 28 : view === "week" ? 7 : 1))
  }
  onCreate={() => {
    setEditId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }}
/>;
```

- [ ] **Step 4: Applicare la matrice alle CTA senza cambiare gli input tRPC**

Nel form, rendere il selettore squadra non modificabile se `!permissions.canAssign`; se un intervento esistente ha già `squadraId`, visualizzarne nome e avviso testuale “Non puoi cambiare squadra”. Creazione/modifica devono richiedere `permissions.canPlan`; cancellazione deve richiedere `permissions.canDelete`. Conservare le mutation esistenti: `createIntervento.mutate`, `updateIntervento.mutate`, `deleteIntervento.mutate`.

```tsx
const submitEnabled = permissions.canPlan && !isPending;
const squadraReadOnly = !permissions.canAssign;

<Select
  value={draft.squadraId || "nessuna"}
  onValueChange={squadraId =>
    onDraftChange({
      ...draft,
      squadraId: squadraId === "nessuna" ? "" : squadraId,
    })
  }
  disabled={squadraReadOnly}
>
  <SelectTrigger aria-label="Squadra assegnata">
    <SelectValue />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="nessuna">Nessuna squadra</SelectItem>
    {squadre.map(squadra => (
      <SelectItem key={squadra.id} value={String(squadra.id)}>
        {squadra.nome}
      </SelectItem>
    ))}
  </SelectContent>
</Select>;
{
  squadraReadOnly && (
    <p className="text-xs text-text-3">
      L'assegnazione squadra richiede il permesso di assegnazione.
    </p>
  );
}
```

- [ ] **Step 5: Rendere il responsive workbench verificabile**

Applicare questi confini, senza scroll orizzontale di pagina:

```tsx
<main className="min-w-0 space-y-4">
  <div className="sticky top-0 z-20 border-b border-border-soft bg-surface/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-surface/85">
    <PlanningToolbar
      view={view}
      cursor={cursor}
      canCreate={permissions.canPlan}
      onChangeView={setView}
      onPrevious={goPrevious}
      onToday={() => setCursor(new Date())}
      onNext={goNext}
      onCreate={openCreate}
    />
  </div>
  <section className="min-w-0" aria-label="Agenda interventi">
    <div className="hidden min-w-0 lg:block">{desktopView}</div>
    <div className="lg:hidden">
      <PlanningAgenda items={agendaItems} onOpenIntervento={openIntervento} />
    </div>
  </section>
</main>
```

`desktopView` è la variabile `ReactNode` già composta nella pagina con una sola fra le chiamate esistenti `DayView`, `WeekView` e `MonthView`; `goPrevious`, `goNext`, `openCreate`, `agendaItems` e `openIntervento` restano callback locali che riusano lo stato `view`, `cursor`, `form`, `editId` e `dialogOpen` esistenti.

Mantenere il drag del calendario solo come acceleratore desktop; l'agenda e lo sheet devono offrire “Modifica data e ora” con tastiera. Non calcolare o scrivere stato commessa; la card può solo aprire il link esistente alla commessa.

- [ ] **Step 6: Gestire i quattro stati dati senza nascondere il contesto**

Implementare nella pagina stati distinti: skeleton sul primo load di `interventi`, errore con retry di `interventi.refetch`, empty “Nessun intervento in questo periodo”, e refetch discreto mantenendo l'agenda precedente. Per Google Calendar: fonte scollegata mostra “Nessun calendario esterno collegato” senza CTA di scrittura; evento esterno apre solo il sheet read-only con fonte e intervallo.

- [ ] **Step 7: Verificare test, typecheck e comportamento browser**

Run: `pnpm vitest run client/src/lib/operationalRoutes.test.ts client/src/lib/tokenDiscipline.test.ts && pnpm check`

Browser evidence: a 1440×900 verificare mese/settimana, drag e alternativa “Modifica data e ora”; a 390×844 verificare agenda singola, sheet, target 44 px e nessuno scroll orizzontale. Con un principal senza `intervento.assign`, verificare che il selettore squadra sia informativo e la mutation non parta.

- [ ] **Step 8: Creare il commit atomico**

```bash
git add client/src/pages/Planning.tsx client/src/components/planning/PlanningToolbar.tsx client/src/components/planning/PlanningAgenda.tsx client/src/components/planning/PlanningInterventoSheet.tsx
git commit -m "feat(ui): migrate planning workbench"
```

### Task 3: Migrare Squadre a roster operativo con gestione direzione separata

**Files:**

- Modify: `client/src/pages/SquadreList.tsx`
- Create: `client/src/components/squadre/SquadraRosterCard.tsx`
- Test: `client/src/lib/operationalRoutes.test.ts`

**Interfaces:**

- Consumes: `trpc.squadre.list`, `trpc.interventi.list`, `trpc.commesse.list`, `adminProcedure` esistente e `isDirezione(user)` come UX mirror del router.
- Produces: card roster che riceve `squadra`, `interventiAttivi`, `commesseAttive`, `canManage`, callback esplicite; non esegue query né mutation internamente.

- [ ] **Step 1: Aggiungere un test di regressione per il copy di permission-state**

```ts
it("mantiene la lettura Planning disponibile senza capability di gestione", () => {
  expect(planningPermissions(new Set())).toEqual({
    canPlan: false,
    canAssign: false,
    canDelete: false,
  });
});
```

Questo test fissa il principio UX della route Squadre: assenza di gestione non equivale a nascondere il roster, che il router `squadre.list` permette a ogni utente autenticato.

- [ ] **Step 2: Eseguire il test mirato**

Run: `pnpm vitest run client/src/lib/operationalRoutes.test.ts -t "lettura Planning"`

Expected: PASS; la modifica è esclusivamente visuale.

- [ ] **Step 3: Estrarre la card roster priva di logica autorizzativa**

```tsx
export function SquadraRosterCard({
  squadra,
  interventiAttivi,
  commesseAttive,
  canManage,
  onEdit,
  onDelete,
}: {
  squadra: {
    id: number;
    nome: string;
    caposquadra?: string | null;
    telefono?: string | null;
    note?: string | null;
  };
  interventiAttivi: Array<{
    id: number;
    tipo: string;
    dataPianificata?: string | null;
    stato: string;
  }>;
  commesseAttive: Array<{
    id: number;
    codice?: string | null;
    cliente?: string | null;
    stato: string;
  }>;
  canManage: boolean;
  onEdit(id: number): void;
  onDelete(id: number): void;
}) {
  return (
    <article
      aria-labelledby={`squadra-${squadra.id}`}
      className="rounded-xl border border-border-soft bg-surface-raised p-4"
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id={`squadra-${squadra.id}`}
            className="truncate text-base font-semibold text-text-1"
          >
            {squadra.nome}
          </h2>
          <p className="mt-1 text-sm text-text-3">
            {squadra.caposquadra || "Caposquadra non indicato"}
          </p>
        </div>
        {canManage && (
          <div className="flex shrink-0 gap-2">
            <Button onClick={() => onEdit(squadra.id)}>Modifica</Button>
            <Button variant="outline" onClick={() => onDelete(squadra.id)}>
              Elimina
            </Button>
          </div>
        )}
      </div>
      <p className="mt-4 text-sm text-text-2">
        {interventiAttivi.length} interventi attivi · {commesseAttive.length}{" "}
        commesse attive
      </p>
    </article>
  );
}
```

La card deve esporre: nome/caposquadra, contatto solo come testo/link sicuro, numero e lista breve di interventi attivi, commesse attive con stato testuale, empty “Nessun intervento pianificato”, e azioni Modifica/Elimina solo quando `canManage` è true. Non mostrare costi, margini o elementi economici.

- [ ] **Step 4: Ricomporre `SquadreList` senza mutare il contratto direzione-only**

La pagina continua a usare `isDirezione(user)` per mostrare trigger e azioni di gestione, poiché i router `squadre.create/update/delete` usano `adminProcedure`. Conservare input e invalidazioni correnti; per l'utente non-direzione non montare dialog di create/edit/delete e mostrare il roster con la frase “Gestione squadre riservata alla direzione.”

```tsx
{
  puoModificare ? (
    <Button
      onClick={() => {
        setEditId(null);
        resetForm();
        setDialogOpen(true);
      }}
    >
      <Plus className="h-4 w-4" aria-hidden="true" /> Nuova squadra
    </Button>
  ) : (
    <p className="text-sm text-text-3">
      Gestione squadre riservata alla direzione.
    </p>
  );
}
```

- [ ] **Step 5: Verificare accessibilità e responsive**

Run: `pnpm check && pnpm vitest run client/src/lib/tokenDiscipline.test.ts`

Browser evidence: 1440×900 con roster da almeno tre squadre e commesse con ragione sociale lunga; 390×844 con una card alla volta, azioni direzione ≥44 px, focus visibile e nessun bottone solo-hover. Testare una sessione non-direzione: lista sì, nessun trigger amministrativo; il server deve restare il confine anche su deep link/DOM manipolato.

- [ ] **Step 6: Creare il commit atomico**

```bash
git add client/src/pages/SquadreList.tsx client/src/components/squadre/SquadraRosterCard.tsx client/src/lib/operationalRoutes.test.ts
git commit -m "feat(ui): migrate squadre roster"
```

### Task 4: Migrare Magazzino a queue di consegne senza nuova logistica

**Files:**

- Modify: `client/src/pages/Magazzino.tsx`
- Create: `client/src/components/magazzino/ConsegneAgenda.tsx`
- Test: `client/src/lib/operationalRoutes.test.ts`

**Interfaces:**

- Consumes: `deliveryState`/`deliveryStateCopy` del Task 1; `trpc.magazzino.list/create/update/remove` e `trpc.commesse.list` già esistenti.
- Produces: agenda consegne che riceve righe già sede-scoped e callback `onOpenCommessa`, `onToggleArrivato`, senza accesso diretto a tRPC.

- [ ] **Step 1: Aggiungere il caso limite “archiviata/non eleggibile non è una coda vuota”**

```ts
it("non usa il conteggio prodotti per affermare che una commessa è eleggibile", () => {
  expect(
    deliveryState({ arrivato: false, dataConsegna: null, today: "2026-08-31" })
  ).toBe("unscheduled");
});
```

Il test impedisce che la UI trasformi “nessuna data” in una consegna negativa; l'eleggibilità resta esclusivamente `magazzino.create` lato server.

- [ ] **Step 2: Eseguire il test mirato**

Run: `pnpm vitest run client/src/lib/operationalRoutes.test.ts -t "eleggibile"`

Expected: PASS.

- [ ] **Step 3: Estrarre l'agenda consegne e rendere ogni stato leggibile**

```tsx
export function ConsegneAgenda({
  items,
  onOpenCommessa,
  onToggleArrivato,
}: {
  items: Array<{
    id: number;
    nome: string;
    quantita: number;
    dataConsegna?: string | null;
    arrivato: boolean;
    commessa: {
      id: number;
      codice?: string | null;
      cliente?: string | null;
    } | null;
  }>;
  onOpenCommessa(id: number): void;
  onToggleArrivato(id: number, arrivato: boolean): void;
}) {
  return (
    <ol aria-label="Prossime consegne" className="space-y-2">
      {items.map(item => (
        <li
          key={item.id}
          className="rounded-lg border border-border-soft bg-surface-raised p-3"
        >
          <p className="font-medium text-text-1">
            {item.nome} · {item.quantita}
          </p>
          <p className="mt-1 text-sm text-text-3">
            {item.dataConsegna ?? "Data da definire"}
          </p>
          {item.commessa && (
            <Button
              variant="link"
              onClick={() => onOpenCommessa(item.commessa!.id)}
            >
              {item.commessa.codice ?? "Apri commessa"}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => onToggleArrivato(item.id, !item.arrivato)}
          >
            {item.arrivato ? "Riapri consegna" : "Segna ricevuto"}
          </Button>
        </li>
      ))}
    </ol>
  );
}
```

Ogni riga usa `deliveryState` e `deliveryStateCopy`, include quantità, fornitore se già disponibile, commessa e data, e rende “Ricevuto”, “In ritardo”, “Prevista oggi”, “In arrivo” o “Data da definire” come testo. Non creare KPI economici né cambiare l'ordinamento server; l'ordinamento visuale può usare solo date e stato già ricevuti.

- [ ] **Step 4: Ricostruire Magazzino come workbench denso e mobile-first**

Mantenere i filtri esistenti `tutte`, `arrivo`, `ritardo`, `arrivati`, ricerca e fornitore. Sostituire le card annidate con toolbar sticky + tabella/lista desktop e `ConsegneAgenda` sotto `lg`. Il dettaglio commessa resta un dialog/sheet che modifica solo attraverso `magazzino.update`; l'azione “Segna ricevuto” deve inviare esattamente `{ id, arrivato: true }` e mostrare successo solo in `onSuccess`.

```tsx
const segnaArrivato = (id: number, arrivato: boolean) => {
  update.mutate(
    { id, arrivato },
    {
      onSuccess: () =>
        toast.success(
          arrivato ? "Consegna segnata come ricevuta." : "Consegna riaperta."
        ),
    }
  );
};
```

Non aggiungere mutation per `commesse.update`, non cambiare il filtro `isEligible` in una regola autorevole e non offrire inserimento su commessa archiviata/non in produzione: se una response server è `PRECONDITION_FAILED`, mostrare il messaggio server e mantenere il form aperto.

- [ ] **Step 5: Coprire gli stati dati reali**

Rendere distinto: caricamento prodotti, nessun prodotto nella sede, nessuna commessa che corrisponde ai filtri, errore della lista prodotti con retry, errore mutation con il messaggio tRPC e refetch discreto. Non mostrare “tutto a posto” quando la lista è vuota: usare “Nessuna consegna corrisponde ai filtri correnti”.

- [ ] **Step 6: Verificare**

Run: `pnpm vitest run client/src/lib/operationalRoutes.test.ts client/src/lib/tokenDiscipline.test.ts && pnpm check`

Browser evidence: 1440×900 con righe ritardo/oggi/futuro/ricevuto/senza data; 1024×768 senza tri-pane forzato; 390×844 con agenda e sheet senza scroll orizzontale. Verificare che una commessa in stato precedente a `produzione` riceva soltanto l'errore server esistente, non una nuova regola client mascherata da verità.

- [ ] **Step 7: Creare il commit atomico**

```bash
git add client/src/pages/Magazzino.tsx client/src/components/magazzino/ConsegneAgenda.tsx client/src/lib/operationalRoutes.test.ts
git commit -m "feat(ui): migrate magazzino deliveries"
```

### Task 5: Rendere Clienti lista e dettaglio capability-aware senza mutare l'anagrafica

**Files:**

- Modify: `client/src/pages/ClientiList.tsx`
- Modify: `client/src/pages/ClienteDetail.tsx`
- Modify: `client/src/lib/operationalRoutes.ts`
- Modify: `client/src/lib/operationalRoutes.test.ts`

**Interfaces:**

- Consumes: `useOperationalContext().capabilities`, `trpc.clienti.list/byId/create/update/archive/restore/delete`, le query figlie già presenti e `nomeCompleto` da `client/src/lib/name.ts`.
- Produces: `customerPermissions`; soltanto CTA UX, mai una seconda policy. Un `byId` `null` cross-sede resta la schermata Not Found esistente, senza errore, label o id rivelatore.

- [ ] **Step 1: Scrivere i test TDD fallenti della matrice clienti**

```ts
import { customerPermissions } from "./operationalRoutes";

describe("customerPermissions", () => {
  it("nasconde ogni CTA durante il caricamento", () => {
    expect(customerPermissions(null)).toEqual({
      canCreateCustomer: false,
      canUpdateCustomer: false,
      canAssignCustomer: false,
      canArchiveCustomer: false,
      canDeleteCustomer: false,
      canCreateCommessa: false,
      canPlanIntervento: false,
      canCreateTicket: false,
    });
  });

  it("non concede azioni figlie dalla sola lettura cliente", () => {
    expect(
      customerPermissions(
        new Set([
          "cliente.read",
          "cliente.update_operational",
          "commessa.create",
        ])
      )
    ).toMatchObject({
      canUpdateCustomer: true,
      canAssignCustomer: false,
      canCreateCommessa: true,
      canPlanIntervento: false,
      canCreateTicket: false,
    });
  });
});
```

- [ ] **Step 2: Confermare il RED**

Run: `pnpm vitest run client/src/lib/operationalRoutes.test.ts -t customerPermissions`

Expected: FAIL perché `customerPermissions` non è ancora esportata.

- [ ] **Step 3: Implementare la sola matrice UX e migrare `/clienti`**

In `operationalRoutes.ts`, rendere true ogni campo esclusivamente con la capability omonima: `cliente.create`, `cliente.update_operational`, `cliente.assign`, `cliente.archive`, `cliente.delete`, `commessa.create`, `intervento.plan`, `ticket.create`. In `ClientiList.tsx`, attendere `useOperationalContext().status === "ready"` prima di esporre nuovo cliente, archiviazione/eliminazione o batch CTA; non aggiungere una seconda query `permessi.mie`. L'assegnatario resta selezionabile/inviabile solo con `canAssignCustomer`, anche se l'utente può modificare altri campi. Il router mantiene la verifica reale. Conservare input e payload `clienti.create` esistenti: aziende/condomini/enti salvano la ragione sociale in `cognome`, il nome resta il valore convenzionale esistente, e tutte le label/righe usano `nomeCompleto`, non una nuova concatenazione.

- [ ] **Step 4: Migrare `/clienti/:id` senza allargare i contratti**

Conservare le query attuali `clienti.byId`, `commesse.list`, `interventi.list`, `ticket.list`, `garanzie.list`, e le mutation esistenti. Disabilitare/nascondere modifica, assegnazione, archive, delete e create figlie con `customerPermissions`; non inviare payload parziale “di comodo” con un `assegnatoA` non autorizzato. Non cambiare il fallback quando `byId` è `null`, non prefetcharlo da una lista di altra sede, non scrivere dettaglio/draft in localStorage e invalidare solo le chiavi tRPC già usate nella pagina dopo successo server.

- [ ] **Step 5: Verificare e creare il commit atomico**

Run: `pnpm vitest run client/src/lib/operationalRoutes.test.ts && pnpm check`

Browser evidence: a 1440×900 lista con ricerca/filtri e focus; a 390×844 dettaglio con sezioni senza scroll orizzontale. Con fixture capability limitata, verificare assenza di CTA non autorizzate; con fixture sede diversa, deep link mostra solo il Not Found esistente. Verificare console senza dati cliente in error/log.

```bash
git add client/src/pages/ClientiList.tsx client/src/pages/ClienteDetail.tsx client/src/lib/operationalRoutes.ts client/src/lib/operationalRoutes.test.ts
git commit -m "feat(ui): migrate customer operations"
```

### Task 6: Migrare `/commesse` senza esporre importi a chi non ha la lettura pagamenti

**Files:**

- Modify: `client/src/pages/CommesseList.tsx`
- Modify: `client/src/lib/operationalRoutes.ts`
- Modify: `client/src/lib/operationalRoutes.test.ts`

**Interfaces:**

- Consumes: `trpc.commesse.list/create/archive/delete`, `trpc.clienti.list`, `trpc.utenti.list`, `useOperationalContext().capabilities` e il payload sagomato di `commesse.list`.
- Produces: `commesseListPermissions`; il dettaglio `/commesse/:id` non è importato, modificato o duplicato.

- [ ] **Step 1: Scrivere test RED per create e privacy economica**

```ts
import { commesseListPermissions } from "./operationalRoutes";

describe("commesseListPermissions", () => {
  it("non offre input importo senza economia.read", () => {
    expect(commesseListPermissions(new Set(["commessa.create"]))).toEqual({
      canCreate: true,
      canCreateWithAmount: false,
      canDelete: false,
    });
  });

  it("separa gestione e importo", () => {
    expect(
      commesseListPermissions(
        new Set(["commessa.create", "commessa.delete", "economia.read"])
      )
    ).toEqual({
      canCreate: true,
      canCreateWithAmount: true,
      canDelete: true,
    });
  });
});
```

- [ ] **Step 2: Confermare il RED e implementare la matrice**

Run: `pnpm vitest run client/src/lib/operationalRoutes.test.ts -t commesseListPermissions`

Expected: FAIL prima dell'export. Implementare `canCreate` con `commessa.create`, `canCreateWithAmount` solo con `commessa.create && economia.read`, e `canDelete` con `commessa.delete`. Non introdurre `commessa.archive`: archivio/ripristino restano la mutation protetta e reversibile già disponibile a ogni utente della sede.

- [ ] **Step 3: Rendere lista e form coerenti con il payload server**

In `CommesseList.tsx`, mostrare crea/elimina solo dalle flag; mantenere archive/restore visibili come percorso reversibile protetto già previsto dal router. Il dialog “nuovo cliente” usa `customerPermissions(capabilities).canCreateCustomer`, non la capability commessa. Conservare l'attuale controllo server `requireAssignableUser` sull'eventuale `assegnatoA`: non sostituirlo con `commessa.assign`, che `commesse.create` non richiede. Per un utente senza `pagamento.read`, non renderizzare né derivare `importoTotale` o `importoIncassato` — compresi sommari, tooltip, filtri, export, badge e cache persistente — perché il router li omette già. Per un utente senza `economia.read`, non renderizzare il campo `importoTotale` nel dialog e ometterlo dal payload `commesse.create`; non inviare `0` come sostituto. Riutilizzare i valori di stato/prodotti/count già restituiti, `formatEuro*` solo quando il server ha fornito una cifra e il viewer è autorizzato, e i nomi da `nomeCompleto`.

- [ ] **Step 4: Evidenza e commit**

Run: `pnpm vitest run client/src/lib/operationalRoutes.test.ts && pnpm check`

Browser evidence: 1440×900 con ricerca/filtro/stati e 390×844 con lista reflow; fixture autenticata senza `pagamento.read` non contiene numeri economici nel DOM né nella cache React Query; fixture con `commessa.create` ma senza `economia.read` crea solo col payload ammesso. Deep link `/commesse/:id` non viene testato/modificato perché golden screen.

```bash
git add client/src/pages/CommesseList.tsx client/src/lib/operationalRoutes.ts client/src/lib/operationalRoutes.test.ts
git commit -m "feat(ui): migrate commesse list"
```

### Task 7: Chiudere i gate di Pagamenti, Economia e Marginalità prima di ogni query riservata

**Files:**

- Modify: `client/src/pages/Pagamenti.tsx`
- Modify: `client/src/pages/Economia.tsx`
- Modify: `client/src/pages/Marginalita.tsx`
- Modify: `client/src/lib/operationalRoutes.ts`
- Modify: `client/src/lib/operationalRoutes.test.ts`
- Reference: `client/src/contexts/OperationalContext.tsx`
- Reference: `client/src/lib/operationalContext.test.ts`

**Interfaces:**

- Consumes: `useOperationalContext().capabilities`, `trpc.commesse.list/pagamentiRecenti/addPagamento`, `trpc.ficFatture.*`, `trpc.ficCosti.*`, `trpc.commesse.marginalita`, `RequireDirezione`, `formatEuro`, `formatEuroSimbolo`, `parseEuroPositivo`.
- Produces: `economicRoutePermissions` e route che rispettano il confine cache sede-safe già fornito da `OperationalContext`; nessuna nuova policy server, export, mutation o calcolo economico client-side.

- [ ] **Step 1: Scrivere test RED della separazione lettura/registrazione/economia**

```ts
import { economicRoutePermissions } from "./operationalRoutes";

describe("economicRoutePermissions", () => {
  it("fail-closed mentre le capability non sono disponibili", () => {
    expect(economicRoutePermissions(null)).toEqual({
      canReadPayments: false,
      canRecordPayments: false,
      canReadEconomy: false,
    });
  });

  it("non eleva pagamento.record a lettura o economia", () => {
    expect(economicRoutePermissions(new Set(["pagamento.record"]))).toEqual({
      canReadPayments: false,
      canRecordPayments: true,
      canReadEconomy: false,
    });
  });
});
```

- [ ] **Step 2: Confermare il RED e implementare la funzione pura**

Run: `pnpm vitest run client/src/lib/operationalRoutes.test.ts -t economicRoutePermissions`

Expected: FAIL prima dell'export. Implementare i tre booleani esattamente per `pagamento.read`, `pagamento.record`, `economia.read`; non inserire ruoli, fallback permissivi o `isDirezione` nella funzione.

- [ ] **Step 3: Correggere `/pagamenti` con query e CTA separate**

Consumare il capability set già committed da `OperationalContext`; mentre il provider è `loading`/`switching`, i figli della route non sono montati. Se `canReadPayments` è false, non montare `commesse.list`/`commesse.pagamentiRecenti`, non mantenere risultati precedenti nel DOM/cache della route e mostrare accesso non disponibile senza dettaglio finanziario. Se true, mantenere query, ordine, invalidazioni e mutation esistenti. Il form/modal e `commesse.addPagamento` sono visibili/abilitati solo con `canRecordPayments`; l'importo passa da `parseEuroPositivo`, i valori da `formatEuro`, e non compare mai un input `importoIncassato`.

- [ ] **Step 4: Correggere `/economia` e preservare `/marginalita` direzione-only**

Sostituire in `Economia.tsx` il controllo locale `isDirezione(...) || hasRuolo(..., "amministrazione")` con `economicRoutePermissions(capabilities).canReadEconomy`. Tutte le query `ficFatture.list`, `ficCosti.list` e `ficCosti.arretrati` usano `enabled: operationalStatus === "ready" && canReadEconomy`; quando false non rendere tabelle, totali, schede, tooltip o dati in cache. Le mutation FiC esistenti rimangono disponibili solo nel ramo autorizzato e mantengono errori/refetch attuali; niente auto-sync mentre si digita.

In `Marginalita.tsx`, non sostituire `RequireDirezione`, non usare `economia.read` come bypass e non toccare il router. Rendere solo la presentazione densa/accessibile: stato testuale accanto al badge, `formatEuro` per ciascun valore già ricevuto e disclaimer visibile “stima CRM, non contabilità”. La query può esistere soltanto dopo la guardia route direzione; una visita diretta non direzione non mostra dati né triggera mutation.

- [ ] **Step 5: Verificare il confine cache atomico della slice 01**

Non modificare `SedeSwitcher` né aggiungere un secondo `useQueryClient` alle pagine. Aprire una route economica con fixture sintetica, rallentare la rete, cambiare sede tramite `OperationalContext` e verificare che `ContextTransitionScreen` sostituisca i figli prima che lo scope cambi; nessuna riga/cifra/label precedente deve rimanere nel DOM o nella query cache protetta.

Questo step è evidence/read-only per la Slice 03. Se fallisce, fermare la Task 7 e riaprire formalmente la Task 3 della Slice 01: aggiungere prima un caso RED in `client/src/lib/operationalContext.test.ts`, correggere insieme `client/src/contexts/OperationalContext.tsx`, rieseguire tutti i gate della Slice 01 e creare un commit atomico `fix(ui): restore operational scope isolation` che includa provider e test. Solo dopo riprendere questa task; vietato un workaround o un commit parziale nella pagina economica.

- [ ] **Step 6: Verificare sicurezza, browser e commit**

Run: `pnpm vitest run client/src/lib/operationalRoutes.test.ts && pnpm check`

Browser evidence: `/pagamenti` a 1440×900 e 390×844 con `pagamento.read` ma senza `pagamento.record` (registro leggibile, nessuna CTA); utente senza `pagamento.read` non genera query/dati. `/economia` con amministratore accordato dalla capability e con direzione priva della capability, dimostrando che conta l'effective capability; in entrambi i negati nessuna query FiC. `/marginalita` con non-direzione su deep link è bloccata da `RequireDirezione`, con direzione verifica 1440×900/390×844, zoom 200%, testo stima e nessun calcolo/azione nuova. Da una route economica autorizzata, cambiare sede e verificare che la vecchia cifra sparisca prima del nuovo fetch (Network/React Query devtools o risposta throttled), poi che appaia soltanto il payload della nuova sede. Console priva di errori e di valori economici nei log.

```bash
git add client/src/pages/Pagamenti.tsx client/src/pages/Economia.tsx client/src/pages/Marginalita.tsx client/src/lib/operationalRoutes.ts client/src/lib/operationalRoutes.test.ts
git commit -m "feat(ui): protect operational economy routes"
```

### Task 8: Eseguire il gate integrato, rollback e documentare evidenze sanitizzate

**Files:**

- Create: `docs/design/modular-control/operational-routes-evidence.md`
- Create directory through sanitized evidence files: `docs/design/modular-control/evidence/operational/`
- Modify: `docs/design/modular-control/verification-log.md`
- Modify: `docs/design/modular-control/route-manifest.md`

**Interfaces:**

- Consumes: completamento dei Task 1–7 e il flag globale `FLAG_UI_V2`/attributo client esistente.
- Produces: evidenza ripetibile delle nove route e manifest/log aggiornati, con screenshot di sole fixture sintetiche e senza dati o affermazioni di rollout reali.

- [ ] **Step 1: Scrivere il validation log con criteri eseguibili prima delle prove**

Creare `operational-routes-evidence.md` con una riga per ognuna delle nove route e colonne `Fixture`, `State`, `1440×900`, `1280×800`, `1024×768`, `768×1024`, `390×844`, `360×800`, `zoom 200%`, `tastiera`, `axe`, `console`, `privacy`, `Screenshot`. Non commettere celle vuote o `pending`: registrare `pass`, un issue ID concreto o `not applicable` con motivazione soltanto dopo la prova.

Per ciascuno slug `planning`, `squadre`, `magazzino`, `clienti-lista`, `cliente-dettaglio`, `commesse-lista`, `pagamenti`, `economia`, `marginalita`, salvare almeno:

- `docs/design/modular-control/evidence/operational/<slug>-1440x900-light.png`
- `docs/design/modular-control/evidence/operational/<slug>-1440x900-dark.png`
- `docs/design/modular-control/evidence/operational/<slug>-390x844-light.png`

Controllare ogni immagine prima del salvataggio: nomi, contatti, indirizzi e importi devono essere fixture palesemente sintetiche; nessun PDF, email o messaggio di produzione entra nel repository.

- [ ] **Step 2: Verificare flag OFF e confini funzione**

Con `FLAG_UI_V2` OFF, verificare tutte le nove route: path e deep link identici, query/mutation tRPC identiche, nessuna persistenza aggiuntiva, nessun cambiamento allo stato server e, per le route riservate, nessun dato economico non autorizzato. Registrare nell'evidence file e nel verification log “rollback locale verificato” solo se l'attributo UI è assente e la console è pulita; non dichiarare produzione/staging attivati.

- [ ] **Step 3: Eseguire la suite completa e build**

Run: `pnpm check && pnpm test && pnpm build`

Expected: tutti e tre con exit code 0. Registrare in `verification-log.md` data, commit verificato e output sintetico; se uno fallisce, non creare il commit finale e correggere nella task proprietaria prima di ripetere.

- [ ] **Step 4: Aggiornare manifest e log senza sovrascrivere fatti tecnici**

In `docs/design/modular-control/route-manifest.md`, aggiornare solo le nove route con archetipo confermato, trattamento mobile provato, slice “03” e link a `operational-routes-evidence.md`. In `verification-log.md`, aggiungere un record per l'esecuzione con comandi/esiti e commit. Lasciare invariati route, accesso, redirect e le righe delle golden screen; non marcare la slice completa se una delle nove route non ha tutte le evidenze browser.

- [ ] **Step 5: Eseguire self-review documentata**

Controllare esplicitamente:

1. ogni CTA Planning rispetta `intervento.plan`/`assign`/`delete` e il server resta il confine;
2. Squadre mantiene lettura per tutti e gestione direzione-only;
3. Magazzino non sostituisce l'eleggibilità server e non mostra economia;
4. Clienti mantiene ragione sociale/nome e il `NOT_FOUND` cross-sede; le CTA figlie hanno la capability propria;
5. Commesse non espone né invia importi senza le capability previste;
6. Pagamenti separa `pagamento.read` da `pagamento.record` e non espone input `importoIncassato`;
7. Economia usa `economia.read` effettiva, non ruoli, e non monta query FiC negata; Marginalità resta direzione-only;
8. eventi Google restano read-only e nessuna route modifica sede, redirect `/produzione`, tars, storage o contratti;
9. nessun hex, palette numerica, scroll orizzontale, CTA solo-hover o animazione non ridotta è entrato nella slice.

Registrare esito e limiti reali nel verification log; il report operativo conserva soltanto fixture e screenshot sanitizzati, nessun export o valore economico di produzione.

- [ ] **Step 6: Creare il commit atomico finale**

```bash
git add docs/design/modular-control/operational-routes-evidence.md docs/design/modular-control/evidence/operational docs/design/modular-control/verification-log.md docs/design/modular-control/route-manifest.md
git commit -m "docs(ui): validate operational routes"
```

## Self-review del piano

### Copertura della spec

- §10.4/§11.4: Task 2 e 3 coprono workbench Planning e Squadre con agenda mobile, azioni sticky, alternative al drag e target touch; le golden screen Rilievo/Verbale restano fuori scope.
- §10.4/§11.5: Task 4 copre Magazzino come workbench denso, stati consegna, dettaglio e mobile senza cambiare logistica/ordini/DI.
- §11.2/§11.6: Task 5–7 coprono anagrafiche, lista commesse e privacy economica: capability effettive, assenza di leakage, FiC gate e Marginalità direzione-only.
- §4.2–§4.4: Global Constraints e Task 2–7 fissano sede server-side, consumo del confine cache centralizzato della slice 01, capability/ruolo, economia, storage/base64 e Google Calendar read-only.
- §8/§19/§20/§25: Task 1 blocca regressioni token; Task 2–7 definiscono responsive/a11y; Task 8 contiene matrix browser, axe, tastiera, zoom, console, flag OFF, suite e build.
- §24/§27: Global Constraints e Task 8 limitano il flag a rollback globale, senza rollout o modifiche di business.

### Placeholder scan

Il piano non contiene sezioni rinviate, riferimenti circolari o API non assegnate a un file/contratto. Ogni task identifica file, interfacce, test, comandi, comportamento atteso e commit.

### Coerenza tipi e contratti

- `PlanningPermissions`, `DeliveryState`, `deliveryState`, `deliveryStateCopy` sono definiti nel Task 1 e consumati con gli stessi nomi nei Task 2 e 4.
- `CustomerPermissions`, `CommesseListPermissions` ed `EconomicRoutePermissions` sono definiti nel Task 5–7 e derivano solo dalle capability già registrate in `server/authz/capabilities.ts`.
- `PlanningInterventoDraft` replica i valori già accettati da `interventi.create/update`; il piano non aggiunge campi tRPC.
- Task 3 usa `isDirezione` soltanto come mirror UX di `adminProcedure`; Task 2 usa capability effettive per i router capability-aware.
- Task 5 mantiene il formato anagrafico esistente; Task 6 non inventa campi economici e Task 7 non allarga `RequireDirezione` o le procedure FiC, verificando il blocco/render atomico già fornito da `OperationalContext` dopo `sedi.switch`.
