# Tars Workbench UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trasformare `/tars` in una workbench responsive con conversazioni gestibili e spostare tutta la diagnostica tecnica nella card Impostazioni → Agente.

**Architecture:** Il server estende additivamente l'archivio Tars con metadati e mutation owner-scoped. Il client resta confinato in componenti `client/src/components/tars/`, mentre `Tars.tsx` orchestra rail, thread e contesto; `Integrazioni.tsx` riceve soltanto la nuova card. Le funzioni di presentazione e raggruppamento sono pure e testabili senza un nuovo framework di test DOM.

**Tech Stack:** React 19, TypeScript 5.9, tRPC 11, React Query, Wouter, Tailwind 4, shadcn/Radix, Lucide, Framer Motion già installato, Vitest.

**Spec:** `docs/tars/tars-workbench-ui.md`

## Global Constraints

- Lavorare nel worktree `.worktrees/tars-main`, direttamente sul `main` locale autorizzato; nessun push, deploy, Railway, flag o chiamata OpenAI.
- Non modificare `client/src/index.css`, shell, navigazione, route contract, font, token o componenti UI condivisi.
- Usare solo token semantici esistenti e Plus Jakarta Sans; nessun colore hex/rgb locale e nessuna nuova dipendenza.
- Tutte le query/mutation business sono isolate per `sedeId + utenteId`; record estranei restituiscono `NOT_FOUND`.
- Conversazioni archiviate recuperabili e sola lettura; nessuna cancellazione definitiva.
- `platform.interruttori` precede ogni query `tars.*`; con flag spento non devono partire query Tars.
- Costi e budget restano Direzione-only anche lato server.
- Target touch minimo 44 px, focus visibile, `prefers-reduced-motion`, nessuno scroll orizzontale globale.
- TDD obbligatorio: ogni comportamento nuovo nasce da un test visto fallire per la ragione attesa.

---

### Task 1: Contratto di gestione conversazioni

**Files:**
- Modify: `server/tars/archivio.ts`
- Modify: `server/tars/orchestratore.ts`
- Modify: `server/routers/tars.ts`
- Create: `server/tars/conversazioni.test.ts`

**Interfaces:**
- Produces: `ConversazioneTars` con `fissata: boolean`, `archiviataAt: Date | null`, `anteprima: string | null` nelle liste.
- Produces: `listaConversazioni(sedeId, utenteId, { archiviate, ricerca, limite })` ordinata per `fissata DESC, updatedAt DESC`.
- Produces: `rinominaConversazione`, `impostaConversazioneFissata`, `impostaConversazioneArchiviata` con esito owner-scoped.
- Produces: `aggiungiTurno({ conversazioneId, sedeId, utenteId, ... })` con aggiornamento conversazione scoped a tutti e tre i campi.
- Produces tRPC: `tars.conversazioni({ archiviate?, ricerca?, limite? })`, `tars.rinominaConversazione`, `tars.fissaConversazione`, `tars.archiviaConversazione`.

- [ ] **Step 1: scrivere test RED sull'archivio**

  Coprire creazione con default, anteprima dall'ultimo turno, ricerca case-insensitive, ordine fissate/recenti, esclusione archiviate e ripristino. La modifica di un id di altra sede/utente deve restituire `non_trovato`.

- [ ] **Step 2: eseguire il test e verificare il fallimento atteso**

  Run: `pnpm test -- server/tars/conversazioni.test.ts`
  Expected: FAIL perché metadati e primitive non esistono.

- [ ] **Step 3: implementare schema e primitive minime**

  Aggiungere con `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`:

  ```sql
  fissata BOOLEAN NOT NULL DEFAULT false,
  archiviata_at TIMESTAMPTZ
  ```

  L'archiviazione imposta anche `fissata=false`; ogni update include `id`, `sede_id`, `utente_id`; SQL e fallback memoria hanno la stessa semantica. Estendere `aggiungiTurno` con `utenteId` e negare l'update quando la conversazione non appartiene al principal. La lista limita `1..100`, default 50, e deriva l'anteprima dall'ultimo turno senza salvare testo duplicato.

- [ ] **Step 4: aggiungere test RED del router**

  Verificare input massimi, `NOT_FOUND` cross-owner, costi non toccati, ripristino e invalidazione semantica. Per una conversazione archiviata, `invia` deve fallire **prima** di `aggiungiTurno`, provider e ledger costi: testare zero nuovi turni, `updatedAt` invariato e zero invocazioni provider.

- [ ] **Step 5: implementare endpoint tRPC additivi**

  Schemi esatti:

  ```ts
  { archiviate?: boolean; ricerca?: string /* max 100 */; limite?: number /* 1..100 */ }
  { conversazioneId: number; titolo: string /* trim 1..80 */ }
  { conversazioneId: number; fissata: boolean }
  { conversazioneId: number; archiviata: boolean }
  ```

- [ ] **Step 6: verificare e committare**

  Run: `pnpm test -- server/tars/conversazioni.test.ts server/tars/orchestratore.test.ts && pnpm check`

  Commit: `feat(tars): add recoverable conversation management`

### Task 2: Primitive visuali e presentazione del thread

**Files:**
- Create: `client/src/lib/tarsView.ts`
- Create: `client/src/lib/tarsView.test.ts`
- Create: `client/src/components/tars/TarsAvatar.tsx`
- Create: `client/src/components/tars/TarsThread.tsx`
- Create: `client/src/components/tars/TarsConversationList.tsx`
- Create: `client/src/components/tars/TarsContextPanel.tsx`

**Interfaces:**
- Produces: `filtraConversazioni`, `raggruppaConversazioni`, `unisciTurniConOttimistico`, `etichettaTempoConversazione` come funzioni pure.
- Produces: `deveInviareDaTastiera({ key, shiftKey, isComposing })` e primitive ottimistiche pure usate realmente da `Tars.tsx`.
- Produces: `TarsAvatar({ stato: "disponibile" | "in_lavoro" | "degradato" | "spento", size? })`.
- Produces componenti presentazionali senza query tRPC proprie; `TarsContextPanel` riceve briefing e contesto già gated dal parent.

- [ ] **Step 1: scrivere test RED delle funzioni pure**

  Coprire ricerca per titolo/anteprima senza mutare l'input, gruppi Fissate/Recenti/Archiviate, deduplica del turno ottimistico quando arriva il turno server, label temporali italiane stabili e matrice tastiera: Enter invia, Maiusc+Enter non invia, IME non invia.

- [ ] **Step 2: eseguire RED**

  Run: `pnpm test -- client/src/lib/tarsView.test.ts`
  Expected: FAIL perché `tarsView.ts` non esiste.

- [ ] **Step 3: implementare le funzioni minime e portare GREEN**

  Il turno ottimistico usa una chiave locale distinta e scompare quando il server restituisce lo stesso contenuto utente nella conversazione inviata; non deduplicare messaggi ripetuti in momenti diversi.

- [ ] **Step 4: creare l'avatar vettoriale originale**

  SVG inline con quattro profili/pannelli e nucleo centrale, `aria-hidden` quando accanto al nome Tars. Animare solo `transform`/`opacity`; nessuna correttezza dipende da `transitionend`; stato finale immediato in reduced motion.

- [ ] **Step 5: creare lista, thread e contesto**

  Lista: `nav`, ricerca con label, pulsante nuova chat, `aria-current`, menu Radix per rinomina/fissa/archivia/ripristina, empty/error/skeleton. Thread: `role="log"`, timestamp, stati operativi testuali, evidenze in `Collapsible`, azioni esistenti preservate. Contesto: entità attiva e briefing, mai provider/modello/costi.

- [ ] **Step 6: verificare e committare**

  Run: `pnpm test -- client/src/lib/tarsView.test.ts && pnpm check`

  Commit: `feat(tars): build workbench presentation primitives`

### Task 3: Card tecnica Impostazioni → Agente

**Files:**
- Create: `client/src/components/tars/TarsAgentCard.tsx`
- Create: `client/src/lib/tarsAgentView.ts`
- Create: `client/src/lib/tarsAgentView.test.ts`
- Modify: `client/src/pages/Integrazioni.tsx`

**Interfaces:**
- Consumes: `platform.interruttori`, `tars.stato`, `tars.costi`.
- Produces: `TarsAgentCard({ direzione: boolean })`, con query Tars abilitate soltanto dopo gate acceso.
- Produces: `derivaGateQueryAgente(interruttori, direzione)` per rendere testabile che `stato` e `costi` restino disabilitate fino al gate, con `costi` false per i non-Direzione.

- [ ] **Step 1: scrivere test RED di presentazione e gate**

  Testare derivazione `spento | disponibile | degradato`, formattazione USD e percentuali budget senza `NaN`, etichetta obbligatoria «globale · tutte le sedi», visibilità costi solo Direzione e configurazione query `enabled=false` finché il gate non è risolto/acceso.

- [ ] **Step 2: eseguire RED**

  Run: `pnpm test -- client/src/lib/tarsAgentView.test.ts`
  Expected: FAIL perché il modulo non esiste.

- [ ] **Step 3: implementare helper e card**

  Header leggibile con stato; provider/modello/run in riepilogo; diagnostica, tool e interruttori dentro `Collapsible`; costi con `Intl.NumberFormat("it-IT", { style: "currency", currency: "USD" })`, label visibile «Consumi globali · tutte le sedi» e progress bar testuale/visiva solo Direzione. Nessun segreto o contenuto.

- [ ] **Step 4: innestare la card nel blocco Agente**

  Sostituire il titolo vuoto con `<TarsAgentCard direzione={canManage} />`; non riordinare o riformattare altre integrazioni.

- [ ] **Step 5: verificare e committare**

  Run: `pnpm test -- client/src/lib/tarsAgentView.test.ts server/tars/costi/integrazione.test.ts && pnpm check`

  Commit: `feat(settings): centralize Tars technical status`

### Task 4: Composizione della workbench responsive

**Files:**
- Modify: `client/src/pages/Tars.tsx`
- Modify only if an existing focused test contract needs extension: `client/src/lib/navigation.test.ts`
- Modify: `docs/tars/architettura-tars-v2.md`
- Modify: `handoff.md`

**Interfaces:**
- Consumes: componenti Task 2, endpoint Task 1 e `tars.stato({ conversazioneId })`.
- Preserves: azioni Undo/approvazione, kill switch fail-closed, briefing, prefill query se già presente al momento dell'integrazione.

- [ ] **Step 1: scrivere test RED del contratto di composizione**

  Estendere `client/src/lib/tarsView.test.ts` per i comportamenti puri realmente consumati dalla pagina: selezione/ripristino, decisione Enter/Maiusc+Enter/IME, creazione e riconciliazione del turno ottimistico. Una guardia sorgente separata può vietare provider/modello/costi/tool-list in `Tars.tsx`, ma `role="log"`, focus e Sheet restano verifiche browser della Task 5, non successi dedotti dal testo sorgente.

- [ ] **Step 2: comporre mobile-first**

  Rail nascosta in `Sheet` sotto `md`, rail persistente da `md`, centro `min-w-0`, pannello contesto persistente solo da `xl` e `Sheet` sotto `xl`. Composer sticky dentro la colonna, target 44 px e padding per safe area.

- [ ] **Step 3: integrare gestione e invio ottimistico**

  Conservare la selezione mentre un invio è in volo; mostrare subito il turno locale; su errore mantenerne il testo nel composer e segnalarlo; invalidare lista/turni/stato della sola conversazione toccata. Enter invia solo con `!shiftKey && !nativeEvent.isComposing`.

- [ ] **Step 4: separare gli errori per pannello**

  Kill switch e indisponibilità globale restano sicuri; errori lista e thread mostrano retry locale senza nascondere composer o contesto. Empty state propone quattro comandi operativi supportati e il briefing, senza capability tecnica.

- [ ] **Step 5: aggiornare verità documentale**

  Registrare gestione recuperabile delle conversazioni, nuova collocazione della diagnostica e perimetro client. Non dichiarare streaming se non implementato.

- [ ] **Step 6: verifica automatica e commit**

  Run: `pnpm check && pnpm test && pnpm build`

  Commit: `feat(tars): deliver responsive operational workbench`

### Task 5: Verifica visuale, accessibilità e regressioni

**Files:**
- Modify only for defects proven by the verification: files introduced in Tasks 1–4.

**Interfaces:**
- Consumes: workbench completa.
- Produces: evidenza di verifica desktop/mobile e nessuna regressione Tars-off.

- [ ] **Step 1: avviare il CRM locale senza provider reale**

  Usare il provider fake e flag di sviluppo già previsti; non leggere o usare `OPENAI_API_KEY`.

- [ ] **Step 2: verificare 1440×900**

  Controllare conversazione nuova/esistente, ricerca, rinomina, fissa, archivia/ripristina, stato ottimistico, azioni, evidenze, pannello contesto e card Agente. Nessun overflow o errore console.

- [ ] **Step 3: verificare 390×844 e tastiera**

  Controllare sheet lista/contesto, focus restituito, Enter/Maiusc+Enter/IME, target touch, composer non coperto e assenza di scroll orizzontale.

- [ ] **Step 4: verificare accessibilità e reduced motion**

  Navigare senza mouse, ispezionare nomi accessibili e focus, eseguire axe se disponibile, attivare reduced motion e confermare che l'avatar non dipenda dall'animazione.

- [ ] **Step 5: correggere con RED mirato ogni difetto trovato**

  Ogni bug produce prima un test riproducibile, poi la correzione minima e una nuova verifica visuale.

- [ ] **Step 6: verifica finale e commit**

  Run: `pnpm check && pnpm test && pnpm build && git diff --check && git status --short`

  Commit solo se emergono fix: `fix(tars): harden workbench interactions`
