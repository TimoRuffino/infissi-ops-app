# Tars Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trasformare `/tars` da pagina chat/inbox a cabina operativa: brief di oggi, priorita spiegabili, prove, proposte, analisi, chat e registro tecnico, senza contenere le inbox Email o WhatsApp.

**Architecture:** Un aggregatore server-side combina contesti incrementali, proposte, esecuzioni e health della coda in un contratto compatto. Il client rende viste operative e apre le prove con deep link sede-scoped verso entita o canali. Le mutation di approvazione/rifiuto/chat esistenti restano la sola via di azione.

**Tech Stack:** React 19, Wouter, tRPC/React Query, Tailwind 4, shadcn/Radix, Lucide, Framer Motion con reduced-motion, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-22-messaggi-tars-context-design.md`, sezioni 3.1, 6, 9-15.

**Depends On:** `2026-08-22-tars-context-engine.md` almeno fino alle API `tars.context` e `tars.events.health`; `2026-08-22-messaggi-email-whatsapp.md` per i deep link canonici.

## Global Constraints

- La vista predefinita e `Oggi`; la chat e disponibile ma non dominante.
- Nessun elenco Email/WhatsApp dentro Tars.
- Ogni segnale mostra conclusione, motivo, confidenza, fonti ed entita.
- Nessuna mutation autonoma; approvazione esplicita invariata.
- Snapshot, prove e query sono sempre `sedeId`-scoped; fuori sede restituisce `NOT_FOUND`.
- Dati economici visibili solo a ruoli autorizzati.
- Stati loading, empty, degraded, error e retry sono obbligatori.
- Nessuno scroll orizzontale globale su desktop o mobile.

---

## Task 1: Definire ranking e contratto del command center

**Files:**
- Create: `server/tars/commandCenter.ts`
- Create: `server/tars/commandCenter.test.ts`

- [ ] **Step 1: Scrivere test fallenti del ranking**

Testare ordine stabile, urgenza, impatto, confidenza, scadenza e dedupe:

```ts
const ranked = rankTarsPriorities([
  fixture({ id: "ticket:9", urgency: 80, impact: 70, confidence: 0.9 }),
  fixture({ id: "fattura:7", urgency: 60, impact: 95, confidence: 1 }),
]);
expect(ranked.map(x => x.id)).toEqual(["ticket:9", "fattura:7"]);
expect(new Set(ranked.map(x => x.canonicalKey)).size).toBe(ranked.length);
```

Verificare che un segnale senza prove venga escluso dal brief e registrato come incompleto, non mostrato come certezza.

- [ ] **Step 2: Definire il contratto tipizzato**

```ts
export type TarsEvidence = {
  type: "email" | "whatsapp" | "fattura_fic" | "documento" |
    "cliente" | "commessa" | "appuntamento" | "ticket" | "pagamento" |
    "produzione" | "reclamo";
  id: string;
  label: string;
  occurredAt: Date | null;
};

export type TarsPriority = {
  id: string;
  canonicalKey: string;
  title: string;
  conclusion: string;
  reason: string;
  confidence: "alta" | "media" | "bassa";
  urgency: number;
  impact: number;
  dueAt: Date | null;
  clienteId: number | null;
  commessaId: number | null;
  proposalId: number | null;
  evidence: TarsEvidence[];
};

export type TarsCommandCenterSnapshot = {
  generatedAt: Date;
  status: "ready" | "building" | "degraded" | "disabled";
  brief: { title: string; summary: string; highlights: string[] };
  priorities: TarsPriority[];
  metrics: TarsCommandCenterMetrics;
  contextHealth: TarsContextHealth;
};
```

- [ ] **Step 3: Implementare ranking deterministico**

Formula iniziale testata:

```ts
score = urgency * 0.45 + impact * 0.4 + confidenceWeight * 0.15;
```

`confidenceWeight`: alta 100, media 65, bassa 30. A parita: `dueAt` ascendente, poi canonical key. Non usare AI per ordinare.

- [ ] **Step 4: Implementare `buildCommandCenterSnapshot`**

```ts
export async function buildCommandCenterSnapshot(input: {
  ctx: TrpcContext;
  limit?: number;
}): Promise<TarsCommandCenterSnapshot>;
```

Combinare proposte pendenti, contesti recenti, eventi falliti e indicatori gia disponibili. Derivare scope dal ruolo. Limitare a 12 priorita e massimo 3 prove per priorita nella risposta iniziale. Non generare un nuovo brief con OpenAI a ogni apertura: usare contesti e facts persistenti; il testo del brief e deterministico.

- [ ] **Step 5: Verificare test**

Run: `pnpm test -- server/tars/commandCenter.test.ts`

Expected: PASS per ranking, scope, evidence e stati degraded/disabled.

- [ ] **Step 6: Commit**

```bash
git add server/tars/commandCenter.ts server/tars/commandCenter.test.ts
git commit -m "feat: aggrega priorita operative Tars"
```

## Task 2: Esporre API del command center e risoluzione prove

**Files:**
- Modify: `server/routers/tars.ts`
- Create: `server/tars/commandCenterApi.test.ts`

- [ ] **Step 1: Scrivere test router fallenti**

Verificare:

```ts
const snapshot = await caller.tars.commandCenter.get({ limit: 8 });
expect(snapshot.priorities.length).toBeLessThanOrEqual(8);
const evidence = await caller.tars.commandCenter.evidence({
  type: "email",
  id: "42",
});
```

Casi obbligatori: prova altra sede -> `NOT_FOUND`; fatto economico a ruolo operativo -> `NOT_FOUND`; command center disattivato -> payload `disabled`, non 500.

- [ ] **Step 2: Aggiungere router nidificato**

```ts
commandCenter: router({
  get: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(20).default(12) }))
    .query(({ input, ctx }) => buildCommandCenterSnapshot({ ctx, limit: input.limit })),
  evidence: protectedProcedure
    .input(evidenceInput)
    .query(({ input, ctx }) => resolveTarsEvidence({ ctx, ...input })),
}),
```

Il resolver restituisce metadati minimi e una destinazione semantica, non un URL arbitrario dal DB:

```ts
type EvidenceDestination =
  | { kind: "email"; messageId: number }
  | { kind: "whatsapp"; conversationKey: string; messageId?: number }
  | { kind: "commessa"; commessaId: number }
  | { kind: "cliente"; clienteId: number }
  | { kind: "tars_register"; executionId: number };
```

- [ ] **Step 3: Riutilizzare procedure esistenti**

Non duplicare `proposte.approva/rifiuta/rispondi`, `chat.*`, `auditProcessi.esegui` ed `esecuzioni.list`. Il nuovo router e read-only eccetto eventuale `refresh`, che deve soltanto invalidare/accodare un rebuild autorizzato, mai mutare business data.

- [ ] **Step 4: Verificare API**

Run: `pnpm test -- server/tars/commandCenterApi.test.ts server/tars/contextApi.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routers/tars.ts server/tars/commandCenterApi.test.ts
git commit -m "feat: esponi command center Tars"
```

## Task 3: Creare helper client per tab, prove e stato URL

**Files:**
- Create: `client/src/lib/tarsCommandCenter.ts`
- Create: `client/src/lib/tarsCommandCenter.test.ts`
- Modify: `client/src/lib/messaggi.ts`

- [ ] **Step 1: Scrivere test fallenti**

```ts
expect(parseTarsTab("?tab=proposte")).toBe("proposte");
expect(parseTarsTab("?tab=ignoto")).toBe("oggi");
expect(tarsTabHref("registro")).toBe("/tars?tab=registro");
expect(evidenceHref({ kind: "email", messageId: 42 })).toBe(
  "/messaggi/email?messaggio=42"
);
expect(evidenceHref({
  kind: "whatsapp",
  conversationKey: "wa:8:+393331112222",
})).toContain("/messaggi/whatsapp?");
```

- [ ] **Step 2: Implementare allowlist e mapping exhaustivo**

Definire:

```ts
export const TARS_TABS = ["oggi", "proposte", "analisi", "chat", "registro"] as const;
export type TarsTab = (typeof TARS_TABS)[number];
```

Usare uno `switch` exhaustivo su `EvidenceDestination`; nessun href ricevuto direttamente dal server.

- [ ] **Step 3: Verificare test**

Run: `pnpm test -- client/src/lib/tarsCommandCenter.test.ts client/src/lib/messaggi.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add client/src/lib/tarsCommandCenter.ts client/src/lib/tarsCommandCenter.test.ts client/src/lib/messaggi.ts
git commit -m "feat: aggiungi navigazione tipizzata Tars"
```

## Task 4: Creare shell e navigazione della cabina operativa

**Files:**
- Create: `client/src/pages/TarsCommandCenter.tsx`
- Create: `client/src/components/tars/TarsCommandHeader.tsx`
- Create: `client/src/components/tars/TarsCommandNav.tsx`
- Modify: `client/src/App.tsx`
- Modify: `client/src/pages/TarsInbox.tsx`

- [ ] **Step 1: Registrare la pagina canonica**

`/tars` carica `TarsCommandCenter`; `/inbox` resta redirect preserving `tab`. `TarsInbox.tsx` puo diventare un re-export temporaneo o essere rimosso solo dopo aver verificato tutti gli import.

- [ ] **Step 2: Implementare header compatto**

Mostrare avatar, stato Tars, ultimo aggiornamento, coda e pulsante aggiorna/analizza processi solo quando autorizzato. Niente hero, card marketing o testo descrittivo prolisso.

- [ ] **Step 3: Implementare tab URL-driven**

Le tab sono `Oggi`, `Proposte`, `Analisi`, `Chat`, `Registro`. `Registro` e visibile solo a direzione; un deep link non autorizzato viene normalizzato a `oggi`. Usare icone Lucide e target touch >= 40px.

- [ ] **Step 4: Implementare stati pagina**

- loading: skeleton con dimensioni stabili;
- disabled: callout con link a Impostazioni per direzione, testo neutro per altri ruoli;
- building: mostra dati disponibili e stato preparazione;
- degraded: mostra priorita valide e warning della coda;
- error: retry locale senza pagina bianca.

- [ ] **Step 5: Verificare typecheck**

Run: `pnpm check`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/TarsCommandCenter.tsx client/src/components/tars/TarsCommandHeader.tsx client/src/components/tars/TarsCommandNav.tsx client/src/App.tsx client/src/pages/TarsInbox.tsx
git commit -m "feat: crea shell cabina operativa Tars"
```

## Task 5: Costruire vista Oggi con brief, priorita e prove

**Files:**
- Create: `client/src/components/tars/TarsToday.tsx`
- Create: `client/src/components/tars/TarsPriorityList.tsx`
- Create: `client/src/components/tars/TarsPriorityItem.tsx`
- Create: `client/src/components/tars/TarsEvidenceList.tsx`
- Modify: `client/src/pages/TarsCommandCenter.tsx`

- [ ] **Step 1: Implementare brief operativo**

Usare `trpc.tars.commandCenter.get`. Il brief deve occupare una banda compatta: titolo, sintesi, massimo tre highlight. Mostrare quattro metriche operative solo se informative: decisioni, coda, cache/fingerprint invariati, errori.

- [ ] **Step 2: Implementare lista priorita**

Ogni item mostra titolo, conclusione, motivo, livello confidenza, scadenza, cliente/commessa e azione. La confidenza usa testo + icona, non solo colore. La lista e ordinata dal server e non riordinata dal client.

- [ ] **Step 3: Implementare prove navigabili**

Ogni prova usa `evidenceHref` e mostra tipo, label e data. Per dettagli protetti opzionali, risolvere `commandCenter.evidence` al click; se `NOT_FOUND`, toast generico e invalidazione snapshot, senza rivelare la sede.

- [ ] **Step 4: Collegare proposte esistenti**

Se `proposalId` esiste, aprire il dettaglio proposta e riusare `TarsPropostaCard`; approva/rifiuta devono invalidare `tars.commandCenter`, `tars.proposte` e gli eventuali dati business toccati usando gli helper esistenti.

- [ ] **Step 5: Verificare typecheck e test helper**

Run: `pnpm check && pnpm test -- client/src/lib/tarsCommandCenter.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/tars/TarsToday.tsx client/src/components/tars/TarsPriorityList.tsx client/src/components/tars/TarsPriorityItem.tsx client/src/components/tars/TarsEvidenceList.tsx client/src/pages/TarsCommandCenter.tsx
git commit -m "feat: mostra brief e priorita Tars"
```

## Task 6: Migrare Proposte e storico decisioni

**Files:**
- Create: `client/src/components/tars/TarsProposalsView.tsx`
- Modify: `client/src/pages/TarsInbox.tsx`
- Modify: `client/src/pages/TarsCommandCenter.tsx`
- Modify: `client/src/components/TarsPropostaCard.tsx`

- [ ] **Step 1: Estrarre `ElencoProposte` dalla vecchia pagina**

Spostare logica e query senza duplicarla. La vista nuova contiene segmenti `Da decidere` e `Storico`, filtri per tipo/confidenza/entita e ricerca. Non caricare contemporaneamente tutto lo storico: pagina da 50 o aggiungere limit/offset al router se ancora assenti.

- [ ] **Step 2: Rendere visibili motivo e prove**

Estendere la card solo con dati gia presenti o provenienti dal command center. Una proposta senza fonte mostra `Fonte non disponibile` e non un link rotto.

- [ ] **Step 3: Preservare flussi di decisione**

Conservare dialog motivazione rifiuto, domanda/risposta, badge alto rischio, loading per singola proposta e messaggi d'errore. Nessun bottone globale esegue piu proposte in blocco.

- [ ] **Step 4: Verificare typecheck**

Run: `pnpm check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/tars/TarsProposalsView.tsx client/src/pages/TarsInbox.tsx client/src/pages/TarsCommandCenter.tsx client/src/components/TarsPropostaCard.tsx
git commit -m "refactor: porta proposte nella cabina Tars"
```

## Task 7: Costruire Analisi e Registro osservabile

**Files:**
- Create: `client/src/components/tars/TarsAnalysisView.tsx`
- Create: `client/src/components/tars/TarsRegisterView.tsx`
- Create: `client/src/components/tars/TarsContextHealth.tsx`
- Modify: `client/src/pages/TarsCommandCenter.tsx`
- Modify: `server/routers/tars.ts`
- Modify: `server/tars/commandCenterApi.test.ts`

- [ ] **Step 1: Estendere test API per paginazione registro**

La lista esecuzioni ed eventi falliti deve accettare `limit`, `offset`, `trigger`, `esito`; testare max 100 e role guard. Aggiungere una mutation retry evento solo direzione gia definita nel context engine.

- [ ] **Step 2: Implementare vista Analisi**

Mostrare ultimo audit, trend di approvazione, miglioramenti pendenti e pattern misurabili. Il pulsante `Analizza processi` riusa `auditProcessi.esegui`. Non rappresentare un caso isolato come trend.

- [ ] **Step 3: Implementare vista Registro**

Riutilizzare `RegistroEsecuzioni` estratto dalla vecchia pagina e aggiungere health context engine: pending, oldest, failed, retry, model calls, fingerprint unchanged, cache tokens e duplicate bloccate. Dettagli tecnici in disclosure; dati cliente non nei log UI.

- [ ] **Step 4: Implementare retry controllato**

Solo direzione vede `Riprova`; chiedere conferma, disabilitare durante mutation, invalidare health/list e mostrare esito. Il retry reimposta evento, non esegue subito mutation business.

- [ ] **Step 5: Verificare test e typecheck**

Run: `pnpm test -- server/tars/commandCenterApi.test.ts && pnpm check`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/tars/TarsAnalysisView.tsx client/src/components/tars/TarsRegisterView.tsx client/src/components/tars/TarsContextHealth.tsx client/src/pages/TarsCommandCenter.tsx server/routers/tars.ts server/tars/commandCenterApi.test.ts
git commit -m "feat: aggiungi analisi e registro Tars"
```

## Task 8: Integrare Chat senza renderla la home

**Files:**
- Modify: `client/src/pages/TarsCommandCenter.tsx`
- Modify: `client/src/components/TarsChat.tsx`
- Modify: `server/routers/tars.ts`
- Modify: `server/tars/tars.test.ts`

- [ ] **Step 1: Scrivere test fallente sul contesto chat**

Verificare che la chat usi `leggi_contesto_entita` quando il testo contiene un riferimento univoco a cliente/commessa e che rispetti lo scope ruolo. Verificare che gli ultimi 12 turni restino il massimo e che il contesto persistente non venga copiato nella cronologia salvata.

- [ ] **Step 2: Montare la chat come tab**

Riutilizzare `TarsChatPanel` con altezza stabile e stato vuoto essenziale. Il floating chat globale resta disponibile, ma quando la route e `/tars?tab=chat` non deve sovrapporsi al composer; nasconderlo o ridurlo tramite contesto layout.

- [ ] **Step 3: Aggiungere chip di contesto espliciti**

Permettere all'utente di aprire la chat da cliente/commessa/email/WhatsApp con query validate (`cliente`, `commessa`, `comunicazione`). Il server verifica ogni id e pre-carica il fascicolo permesso; non fidarsi dei label client.

- [ ] **Step 4: Verificare test**

Run: `pnpm test -- server/tars/tars.test.ts && pnpm check`

Expected: PASS; nessuna crescita della cronologia oltre il limite.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/TarsCommandCenter.tsx client/src/components/TarsChat.tsx server/routers/tars.ts server/tars/tars.test.ts
git commit -m "feat: integra chat contestuale in Tars"
```

## Task 9: QA visuale, accessibilita e documentazione

**Files:**
- Modify: `handoff.md`
- Modify: `documento_requisiti_infissi_ops.md`

- [ ] **Step 1: Avviare il server**

Run: `pnpm dev`

Expected: URL locale disponibile e console server senza errori.

- [ ] **Step 2: QA desktop 1440x900**

Verificare `/tars` in tutti i tab: la priorita principale e visibile senza scroll eccessivo, testi non troncati in modo ambiguo, prove raggiungibili, nessun layout card-nella-card, registro leggibile senza overflow globale.

- [ ] **Step 3: QA mobile 390x844**

Verificare nav tab scrollabile internamente o menu compatto, card priorita a colonna singola, prove su piu righe, dialog decisione, chat/composer e registro. Eseguire `axe-core`; controllare focus, nomi accessibili e `prefers-reduced-motion`.

- [ ] **Step 4: Testare stati degradati**

Simulare Tars spento, contesto in costruzione, coda fallita, API errore, nessuna priorita e proposta gia decisa. Nessun caso deve produrre schermata bianca.

- [ ] **Step 5: Aggiornare handoff e PRD**

Documentare in `handoff.md` e `documento_requisiti_infissi_ops.md` `/tars`, tab, contratto command center, deep link, scope, health/retry e principio propone/non esegue.

- [ ] **Step 6: Verifica completa**

Run: `pnpm check && pnpm test && pnpm build`

Expected: tre comandi PASS. Dichiarare separatamente test Railway/produzione non eseguiti.

- [ ] **Step 7: Commit**

```bash
git add handoff.md documento_requisiti_infissi_ops.md
git commit -m "docs: aggiorna cabina operativa Tars"
```
