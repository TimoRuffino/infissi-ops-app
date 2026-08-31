# Modular Control — Slice 04 Support/Admin Routes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrare con Borgogna Operativa tutte le superfici Comunicazioni, post-vendita/supporto, preventivatori, amministrazione/impostazioni, autenticazione e fallback senza cambiare contratti, dati o autorizzazioni.

**Architecture:** Questa slice conserva le pagine e le query tRPC esistenti, ma ricompone ogni route nel proprio archetipo: inbox per comunicazioni, queue per post-vendita, guided flow per preventivatori, hub a rischio graduato per impostazioni e superfici sobrie per login/fallback. I componenti già estratti per Email, WhatsApp e Notifiche restano i confini di responsabilità; i refactor estraggono solo sezioni visuali locali e non introducono una seconda fonte di verità client.

**Tech Stack:** React 19, TypeScript, Wouter, tRPC 11/React Query, Tailwind CSS 4, shadcn/Radix, Lucide, Framer Motion già installato, Vitest, axe-core.

**Spec:** `docs/design/master-prompt-ruffino-flow-ui-ux-v3.md` §§1–4, 6–10, 11.7–11.9, 14–25, 27–30; `docs/source-of-truth-matrix.md`; `AGENTS.md`.

## Global Constraints

- `FLAG_UI_V2` resta unicamente il rollback globale: OFF = v1 stabile; ON = Modular Control / Borgogna Operativa. Non lasciare label, commenti, selettori o componenti Frame & Flow nella resa ON.
- Usare soltanto token semantici Borgogna Operativa; nessun hex, palette Tailwind numerica o `text-white` fisso su una surface semantica fuori dalle primitive autorizzate.
- Non modificare router, schema, query/mutation, cache key, flag, ruoli, capability, `sedeId`, dati reali, policy o flussi di business per motivi visuali.
- Ogni route conserva deep link, browser back/forward, stato selezionato e redirect. `/comunicazioni` resta redirect a `/messaggi/email`; `/produzione/*` resta redirect a `/kanban` e non deve ricevere una voce o card nuova.
- Email e WhatsApp sono dati non attendibili; WhatsApp resta read-only: nessun composer, mutation di invio o microcopy che prometta invio.
- Le query server già scope per sede restano l'autorità. La UI non rende, prefetch-a o mette in cache importi/proprietà non presenti nel payload autorizzato; i controlli client sono solo affordance.
- Non visualizzare segreti, token OAuth, password, payload completi dei clienti o screenshot di produzione. Le prove visuali usano fixture locali sanitizzate.
- Per mobile: 44×44px minimo, 48px per azioni critiche, nessun hover indispensabile, nessuno scroll orizzontale globale; verificare 1440×900, 1280×800, 1024×768, 768×1024, 390×844, 360×800 e zoom 200%.
- Loading, refetch, empty, errore, permission/omissione, integrazione scollegata e azione pending devono essere distinti; non rimontare uno skeleton durante un refetch.
- Nessuna nuova libreria. Riutilizzare `Button`, `Dialog`, `Sheet`, `Tabs`, `Select`, `Table`, `Skeleton`, `Tooltip` e `ConfirmDialog` esistenti; Framer Motion solo dove già importato e con `useReducedMotion`.
- Ogni task parte dal test rosso, chiude con test verde e un commit isolato. Non eseguire merge, push, PR, deploy, probe storage in scrittura o migrazioni.

## Prerequisites and File Map

Verificare prima di iniziare che la slice fondazioni abbia pubblicato i token e le utility Borgogna Operativa sotto `data-ui-system="modular-control"`; questa slice non ricrea token globali, shell, navigation model o feature flag. Se il flag ON non identifica ancora univocamente Borgogna Operativa, fermarsi: questo è un prerequisito della slice, non un workaround di pagina.

| Area                    | Files da modificare                                                                                                                                                                                                                                                                                    | Responsabilità invariata                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Email                   | `client/src/pages/messaggi/EmailPage.tsx`, `client/src/components/messaggi/EmailMessageList.tsx`, `client/src/components/messaggi/EmailMessageReader.tsx`, `client/src/lib/emailLayout.ts`, `client/src/lib/emailLayout.test.ts`, `client/src/lib/messaggi.test.ts`                                    | master-detail, query URL, bulk action, collegamenti e allegati                                 |
| WhatsApp                | `client/src/pages/messaggi/WhatsAppPage.tsx`, `client/src/components/messaggi/WhatsAppConversationList.tsx`, `client/src/components/messaggi/WhatsAppThread.tsx`, `client/src/components/messaggi/WhatsAppContextPanel.tsx`, `client/src/lib/messaggi.test.ts`                                         | thread read-only, collegamento record, URL conversazione e sede                                |
| Chat/notifiche          | `client/src/pages/ChatAziendale.tsx`, `client/src/pages/Notifiche.tsx`, `client/src/components/notifications/NotificationGroup.tsx`, `client/src/components/notifications/NotificationItem.tsx`, `client/src/components/notifications/PushPreference.tsx`, `client/src/lib/notificationStream.test.ts` | chat interna, feed/push/resolve e deep link                                                    |
| Post-vendita            | `client/src/pages/TicketList.tsx`, `client/src/pages/ReclamiRifacimenti.tsx`, `client/src/pages/GaranzieList.tsx`, `client/src/pages/Archivio.tsx`                                                                                                                                                     | ticket, reclami/rifacimenti, garanzie direzione e restore soft-archive                         |
| Preventivatori          | `client/src/pages/Preventivatori.tsx`, `client/src/pages/PreventivatoreFivizzanese.tsx`, `client/src/pages/PreventivatorePuntoDelSerramento.tsx`                                                                                                                                                       | calcolo locale esistente, selezione commessa e upload preventivo                               |
| Admin/settings          | `client/src/pages/UtentiList.tsx`, `client/src/pages/SediList.tsx`, `client/src/pages/Conoscenza.tsx`, `client/src/pages/Integrazioni.tsx`, `client/src/components/CaselleEmailCard.tsx`, `client/src/components/WhatsAppCard.tsx`, `client/src/components/RequireDirezione.tsx`                       | procedure admin, switch sede, integrazioni per sede e backup installazione                     |
| Auth/fallback           | `client/src/pages/LoginPage.tsx`, `client/src/pages/NotFound.tsx`, `client/src/App.tsx`, `client/src/lib/navigation.test.ts`, `server/routers/produzionePagina.test.ts`                                                                                                                                | login legacy escluso con motivazione, fallback autenticato, guard direzione e redirect storici |
| Documentazione/evidenza | `docs/design/modular-control/route-manifest.md`, `docs/design/modular-control/verification-log.md`, `docs/design/modular-control/evidence/support-admin/`, `docs/design/ruffino-flow-page-matrix.md`                                                                                                   | mappa route, stati, screenshot sanitizzati e prove della slice                                 |

Le procedure server sono **consumate ma non modificate**: `server/routers/mail.ts`, `chat.ts`, `notifiche.ts`, `ticket.ts`, `reclamiRifacimenti.ts`, `garanzie.ts`, `utenti.ts`, `sedi.ts`, `conoscenza.ts`, `fattureInCloud.ts`, `backup.ts`, `externalCalendars.ts`, `calendarSync.ts`, `preventiviContratti.ts` e `platform.ts`. I relativi test sono evidenza di contratti/sede/capability e vanno eseguiti senza essere riscritti per adattare la UI.

---

### Task 1: Ricomporre l'inbox Email come queue operativa densa

**Files:**

- Modify: `client/src/pages/messaggi/EmailPage.tsx:123-726`
- Modify: `client/src/components/messaggi/EmailMessageList.tsx:113-497`
- Modify: `client/src/components/messaggi/EmailMessageReader.tsx:62-722`
- Modify: `client/src/lib/emailLayout.ts:1-18`
- Test: `client/src/lib/emailLayout.test.ts`
- Test: `client/src/lib/messaggi.test.ts`

**Interfaces:**

- Consumes: `emailPaneVisibility({ compact, selectedId, focus })`, `parseEmailView`, `parseEmailMessageId`, `emailMessageHref`, `trpc.mail.email.*`, `trpc.mail.comunicazioni.*`.
- Produces: un inbox desktop a tre zone solo quando ≥1280px (vista/filtro, lista, reader), due zone quando 1024–1279px (lista + reader) e single-pane sul telefono; il query state canonico resta `?view=<EmailView>&messaggio=<positive integer>`.

- [ ] **Step 1: Scrivere i test fallenti della soglia e del ritorno alla lista**

  Estendere `client/src/lib/emailLayout.test.ts` con il contratto che il layout usa, senza interrogare il DOM:

  ```ts
  it("mantiene lista e lettore a tablet, ma sul telefono mostra un solo pane", () => {
    expect(
      emailPaneVisibility({ compact: false, selectedId: 42, focus: false })
    ).toEqual({
      showList: true,
      showReader: true,
      canFocus: true,
    });
    expect(
      emailPaneVisibility({ compact: true, selectedId: 42, focus: false })
    ).toEqual({
      showList: false,
      showReader: true,
      canFocus: false,
    });
  });
  ```

  Aggiungere in `client/src/lib/messaggi.test.ts` la preservazione del link quando cambia solo la vista:

  ```ts
  expect(emailMessageHref(42, "lead")).toBe(
    "/messaggi/email?view=lead&messaggio=42"
  );
  ```

- [ ] **Step 2: Eseguire i test e confermare il rosso**

  Run: `pnpm vitest run client/src/lib/emailLayout.test.ts client/src/lib/messaggi.test.ts`

  Expected: FAIL perché `emailMessageHref` non accetta ancora la vista oppure il test rende esplicita una firma non allineata.

- [ ] **Step 3: Implementare la minima evoluzione del contratto URL e del layout**

  Aggiornare `emailMessageHref` e il suo uso per produrre `URLSearchParams` in quest'ordine: `view`, poi `messaggio`; mantenere gli URL senza view validi e compatibili. Conservare `replaceEmailQuery`, `popstate`, `selectedIds`, paginazione 50 e tutte le mutation esistenti.

  Rendere la struttura della pagina una superficie inbox continua, non tre card: header compatto con titolo, stato coda e azioni reali; rail filtri; lista; reader. Usare una sola area Borgogna scura/gradiente al massimo nel reader selezionato, mai dietro corpo email, allegati o form di collegamento. La griglia deve restare localmente scrollabile:

  ```tsx
  <section
    aria-label="Workspace Email"
    className="grid min-h-0 min-w-0 flex-1 overflow-hidden border border-border-soft bg-surface
      xl:grid-cols-[15rem_minmax(19rem,0.9fr)_minmax(0,1.65fr)]"
  >
    {/* rail, lista e reader; ogni figlio ha min-w-0 e overflow locale */}
  </section>
  ```

  Sostituire la griglia di metriche con conteggi di coda compatti e cliccabili soltanto se cambiano una vista già supportata; non presentare metriche decorative. Il reader conserva classificazione, collegamento, archiviazione allegato, delete e stato; ogni pulsante solo icona mantiene `aria-label` e tooltip.

- [ ] **Step 4: Implementare stati espliciti senza cambiare query**

  In `EmailMessageList` mantenere skeleton sagomato per primo load, retry per errore e empty copy diversa per ciascuna `EmailView`. In `EmailMessageReader` distinguere ID non valido, messaggio rimosso dalla lista, errore del dettaglio e lettore non selezionato. Durante `rows.isFetching` conservare le righe presenti con indicatore discreto; non tornare al skeleton completo.

  La CTA di gestione caselle resta visibile solo a `isDirezione(user)` e monta `CaselleEmailCard` nel dialog già esistente; le regole filtro restano richieste solo con `enabled: isDirezione(user)`.

- [ ] **Step 5: Verificare il verde e i confini server**

  Run: `pnpm vitest run client/src/lib/emailLayout.test.ts client/src/lib/messaggi.test.ts server/routers/mail.channels.test.ts && pnpm check`

  Expected: PASS; gli URL email, le conversation helper e i contratti email channel-scoped sono invariati.

- [ ] **Step 6: Commit**

  ```bash
  git add client/src/pages/messaggi/EmailPage.tsx client/src/components/messaggi/EmailMessageList.tsx client/src/components/messaggi/EmailMessageReader.tsx client/src/lib/emailLayout.ts client/src/lib/emailLayout.test.ts client/src/lib/messaggi.test.ts
  git commit -m "feat(ui): ricompone inbox email operativa"
  ```

### Task 2: Migrare WhatsApp read-only con contesto progressivo

**Files:**

- Modify: `client/src/pages/messaggi/WhatsAppPage.tsx:1-219`
- Modify: `client/src/components/messaggi/WhatsAppConversationList.tsx:33-182`
- Modify: `client/src/components/messaggi/WhatsAppThread.tsx:42-253`
- Modify: `client/src/components/messaggi/WhatsAppContextPanel.tsx:39-344`
- Test: `client/src/lib/messaggi.test.ts`

**Interfaces:**

- Consumes: `parseWhatsAppConversationSelection`, `parseConversationKey`, `whatsappConversationHref`, `communicationIdsForConversation`, `trpc.mail.whatsapp.conversazioni/thread/segnaVista/rinominaConversazione/collegaConversazione/scollegaConversazione`.
- Produces: desktop tri-pane solo a ≥1280px, inspector-sheet sotto la soglia, lista/reader single-pane sul telefono e nessuna superficie di composizione/invio.

- [ ] **Step 1: Scrivere i test fallenti di deep link e isolamento della selezione**

  Aggiungere a `client/src/lib/messaggi.test.ts`:

  ```ts
  it("mantiene il deep link di una conversazione quando si apre il contesto", () => {
    expect(whatsappConversationHref("wa:8:+393331112222")).toBe(
      "/messaggi/whatsapp?conversazione=wa%3A8%3A%2B393331112222"
    );
    expect(
      communicationIdsForConversation("wa:8:+393331112222", {
        key: "wa:8:+393331112222",
        ids: [11, 12],
      })
    ).toEqual([11, 12]);
  });
  ```

  Aggiungere un caso per `key: null` che deve restituire `[]`, in modo che il context panel non riusi ID del thread precedente.

- [ ] **Step 2: Eseguire il test e confermare il rosso**

  Run: `pnpm vitest run client/src/lib/messaggi.test.ts`

  Expected: FAIL se il nuovo caso `null` espone una firma non protetta; correggere il test solo se il contratto esistente è già rispettato e il failure non è riproducibile.

- [ ] **Step 3: Ricomporre la superficie e gli stati**

  Conservare `selectedKey`, `popstate`, mark-as-viewed una volta per conversazione e pagination. Sostituire radius/card ripetuti con un workbench inbox: lista a sinistra, thread al centro, inspector a destra; divisori sottili e surface continua. Esporre il badge “Sola lettura” vicino al titolo e nel reader quando compresso; non creare input, `Textarea`, bottone “Invia” o copy ambigua.

  L'inspector continua a collegare/scollegare record solo con le mutation già esistenti. L'assenza, il loading o l'errore di cliente/commessa devono apparire come dati non disponibili, non come promessa di record cross-sede. I link a cliente/commessa si mostrano soltanto quando il payload già restituisce gli ID autorizzati.

- [ ] **Step 4: Rendere il mobile realmente single-pane**

  Sotto 1024px il reader occupa l'intero workspace dopo la selezione; back ritorna alla stessa pagina/lista e conserva `search`, `page` e query string. Il context panel apre `Sheet` con focus gestito da Radix e chiude al back. I controlli Pagina precedente/successiva, ritorno, rinomina e inspector restano 44px o più e non dipendono da hover.

- [ ] **Step 5: Verificare il verde e il contratto sede**

  Run: `pnpm vitest run client/src/lib/messaggi.test.ts server/routers/mail.channels.test.ts server/routers/crossSede.test.ts && pnpm check`

  Expected: PASS; nessun test o componente introduce invio WhatsApp né rimuove lo scope `sedeId` del router.

- [ ] **Step 6: Commit**

  ```bash
  git add client/src/pages/messaggi/WhatsAppPage.tsx client/src/components/messaggi/WhatsAppConversationList.tsx client/src/components/messaggi/WhatsAppThread.tsx client/src/components/messaggi/WhatsAppContextPanel.tsx client/src/lib/messaggi.test.ts
  git commit -m "feat(ui): migra workspace whatsapp read-only"
  ```

### Task 3: Rendere chat aziendale e notifiche due queue distinte

**Files:**

- Modify: `client/src/pages/ChatAziendale.tsx:38-661`
- Modify: `client/src/pages/Notifiche.tsx:1-112`
- Modify: `client/src/components/notifications/NotificationGroup.tsx:1-36`
- Modify: `client/src/components/notifications/NotificationItem.tsx:1-99`
- Modify: `client/src/components/notifications/PushPreference.tsx:1-131`
- Create: `client/src/lib/notificationView.ts`
- Create: `client/src/lib/notificationView.test.ts`
- Test: `client/src/lib/notificationStream.test.ts`
- Test: `server/routers/notifiche.test.ts`

**Interfaces:**

- Consumes: `trpc.chat.*`, `trpc.notifiche.feed/unreadCount/markRead/resolve/push/preferences`, `parseNotificationEvent`, `reconnectDelayMs`, `selectLeaderTab`, `parseNotificationView`.
- Produces: chat interna con canale/lista/thread e composer reale; notifiche come feed personale con filtri URL-safe, azioni reali e preferenze in disclosure separata.

- [ ] **Step 1: Scrivere i test fallenti per il filtro notifiche e gli eventi invalidi**

  Estendere `client/src/lib/notificationStream.test.ts`:

  ```ts
  it("rifiuta un evento senza riferimenti entita completi", () => {
    expect(
      parseNotificationEvent(
        JSON.stringify({ notificationId: 7, entityRefs: [{ type: "ticket" }] })
      )
    ).toBeNull();
  });

  it("limita il backoff SSE a 30 secondi", () => {
    expect(reconnectDelayMs(9)).toBe(30_000);
  });
  ```

  Creare `client/src/lib/notificationView.ts` con `parseNotificationView(search: string): "mine" | "critical" | "resolved" | "impostazioni"` e il test in `client/src/lib/notificationView.test.ts`:

  ```ts
  expect(parseNotificationView("?view=critical")).toBe("critical");
  expect(parseNotificationView("?view=impostazioni")).toBe("impostazioni");
  expect(parseNotificationView("?view=non-valida")).toBe("mine");
  ```

- [ ] **Step 2: Eseguire il test e confermare il rosso**

  Run: `pnpm vitest run client/src/lib/notificationStream.test.ts client/src/lib/notificationView.test.ts`

  Expected: FAIL perché `parseNotificationView` non esiste.

- [ ] **Step 3: Implementare URL state e ricomposizione notifiche**

  Leggere/scrivere `?view=mine|critical|resolved|impostazioni` con `URLSearchParams` e `parseNotificationView`, reagire a `popstate` e non usare più un tab state che si perde al refresh. Il feed può restare quello esistente: se l'API non filtra, filtrare solo gli item già autorizzati nel payload, senza aggiungere query. Le preferenze `?view=impostazioni` restano raggiungibili, ma diventano una section/disclosure separata e non un overlay opaco sull'intera coda.

  `NotificationItem` deve comunicare priorità con label, icona e testo, oltre al colore. `resolve` resta disponibile solo per gli item non legacy già accettati dal router; `markRead` conserva `readId(item)`. Empty, errore con retry, refetch discreto e push non supportato sono messaggi distinti.

- [ ] **Step 4: Ricomporre chat senza alterare polling, canali o invio**

  Conservare polling 5 s, `canali`, `interlocutori`, `messaggi`, `invia`, `segnaLetto`, `apriDiretta`, `reagisci` e gli invalidamenti. Per desktop creare una superficie master-detail con rail canali, thread e dettagli contestuali solo se già presenti; sul telefono lista→thread con back prevedibile. Il composer resta perché chat aziendale supporta davvero `chat.invia`; mostra pending state e non doppio-submit. Sostituire le tinte avatar hardcoded con coppie token semantiche o una mappa di classi tokenizzata, eliminando la deroga `ChatAziendale.tsx` dal test di disciplina token se non serve più.

- [ ] **Step 5: Verificare il verde, notifiche per sede e preferenze personali**

  Run: `pnpm vitest run client/src/lib/notificationStream.test.ts client/src/lib/notificationView.test.ts server/routers/notifiche.test.ts server/routers/permessi.test.ts client/src/lib/tokenDiscipline.test.ts && pnpm check`

  Expected: PASS; il feed continua a essere per utente/sede, le preferenze non passano ad altri utenti e l'UI non nasconde una mutation non autorizzata dietro un bottone.

- [ ] **Step 6: Commit**

  ```bash
  git add client/src/pages/ChatAziendale.tsx client/src/pages/Notifiche.tsx client/src/components/notifications/NotificationGroup.tsx client/src/components/notifications/NotificationItem.tsx client/src/components/notifications/PushPreference.tsx client/src/lib/notificationStream.test.ts client/src/lib/notificationView.ts client/src/lib/notificationView.test.ts client/src/lib/tokenDiscipline.test.ts
  git commit -m "feat(ui): distingue chat e coda notifiche"
  ```

### Task 4: Migrare la queue post-vendita e i reclami senza cambiare gli stati

**Files:**

- Modify: `client/src/pages/TicketList.tsx:62-1352`
- Modify: `client/src/pages/ReclamiRifacimenti.tsx:1-399`
- Test: `server/routers/crossSede.test.ts`
- Test: `server/routers/produzionePagina.test.ts`

**Interfaces:**

- Consumes: `trpc.ticket.*`, `trpc.ticketAllegati.*`, `trpc.interventi.*`, `trpc.reclamiRifacimenti.reclami.*`, `trpc.reclamiRifacimenti.rifacimenti.*`, `trpc.commesse.list`, `trpc.clienti.list`, `trpc.squadre.list`.
- Produces: una queue Post-Vendita per priorità/stato, un tab reclami-rifacimenti separato e dialog guidati che usano le stesse mutation e invalidazioni attuali.

- [ ] **Step 1: Scrivere test fallenti per il modello di filtro ticket**

  Estrarre da `TicketList.tsx` in `client/src/lib/supportQueue.ts` una funzione pura e testarla in `client/src/lib/supportQueue.test.ts`:

  ```ts
  expect(
    ticketMatchesQueueFilter(
      { stato: "aperto", oggetto: "Vetro" },
      {
        stato: "aperto",
        search: "vetro",
      }
    )
  ).toBe(true);
  expect(
    ticketMatchesQueueFilter(
      { stato: "chiuso", oggetto: "Vetro" },
      {
        stato: "aperto",
        search: "",
      }
    )
  ).toBe(false);
  ```

  La firma da implementare è:

  ```ts
  export function ticketMatchesQueueFilter(
    ticket: {
      stato: string;
      oggetto?: string | null;
      descrizione?: string | null;
      contatto?: string | null;
      solleciti?: Array<{ nota?: string | null }>;
    },
    filter: { stato: string; search: string }
  ): boolean;
  ```

- [ ] **Step 2: Eseguire il test e confermare il rosso**

  Run: `pnpm vitest run client/src/lib/supportQueue.test.ts`

  Expected: FAIL perché `supportQueue.ts` non esiste.

- [ ] **Step 3: Implementare helper e queue Ticket**

  Implementare l'helper con normalizzazione `trim().toLocaleLowerCase("it-IT")`, cercando solo nei campi già letti dalla pagina. Sostituire lo stack di card annidate con header compatto, toolbar unica (ricerca, stato, conteggi), righe dense desktop e record card P0/P1 sul telefono:

  ```tsx
  <article className="grid min-w-0 gap-3 border-b border-border-soft px-4 py-3 lg:grid-cols-[minmax(14rem,1fr)_minmax(0,1.4fr)_auto]">
    {/* cliente/codice e SLA; oggetto/prossima azione; stato e azioni */}
  </article>
  ```

  Conservare gli stati server `aperto`, `assegnato`, `in_lavorazione`, `chiuso`, i rollback, solleciti, allegati, interventi, delete confirmation e upload esistenti. Il dialog Nuovo ticket resta guided flow: label persistenti, errori vicino al campo, upload pending, action primaria sticky su mobile e zero autosalvataggio promesso.

- [ ] **Step 4: Ricomporre Reclami/Rifacimenti come due queue reali**

  Conservare i tab, i dati stats e le mutation; rendere i tab un selettore accessibile con contatori, non due dashboard KPI. Ogni riga espone cliente/commessa, fase reale, prossima azione e data; lo stato non dipende soltanto dalla chip colorata. Delete resta `ConfirmDialog` con oggetto del record e conseguenza esplicita. Non aggiungere progress percentuali: i flussi non le espongono.

- [ ] **Step 5: Verificare verde e scope business**

  Run: `pnpm vitest run client/src/lib/supportQueue.test.ts server/routers/crossSede.test.ts server/routers/produzionePagina.test.ts && pnpm check`

  Expected: PASS; la UI non modifica transizioni ticket/reclami, `sedeId` resta applicato dal server e Produzione resta assente dal menu/hub.

- [ ] **Step 6: Commit**

  ```bash
  git add client/src/pages/TicketList.tsx client/src/pages/ReclamiRifacimenti.tsx client/src/lib/supportQueue.ts client/src/lib/supportQueue.test.ts
  git commit -m "feat(ui): migra code post-vendita"
  ```

### Task 5: Migrare garanzie e archivio come liste a rischio controllato

**Files:**

- Modify: `client/src/pages/GaranzieList.tsx:37-487`
- Modify: `client/src/pages/Archivio.tsx:1-276`
- Modify: `client/src/lib/supportQueue.ts`
- Test: `client/src/lib/supportQueue.test.ts`
- Test: `server/routers/permessi.test.ts`

**Interfaces:**

- Consumes: `trpc.garanzie.list/stats/create/update/delete`, `trpc.commesse.list({ archived: "only" })`, `trpc.clienti.list({ archived: "only" })`, `trpc.commesse.restore`, `trpc.clienti.restore`.
- Produces: registro garanzie filtrabile con scadenze esplicite e archivio soft-delete consultabile/ripristinabile, senza mutare accesso direzione o semantica archive.

- [ ] **Step 1: Scrivere test fallenti per classificare una scadenza**

  Aggiungere in `client/src/lib/supportQueue.ts` e testare:

  ```ts
  export function warrantyExpiryTone(
    days: number
  ): "expired" | "due" | "current";

  expect(warrantyExpiryTone(-1)).toBe("expired");
  expect(warrantyExpiryTone(30)).toBe("due");
  expect(warrantyExpiryTone(31)).toBe("current");
  ```

  Il valore `30` è il solo threshold UI: non calcola o modifica scadenze server.

- [ ] **Step 2: Eseguire il test e confermare il rosso**

  Run: `pnpm vitest run client/src/lib/supportQueue.test.ts`

  Expected: FAIL perché `warrantyExpiryTone` non esiste.

- [ ] **Step 3: Implementare il registro Garanzie**

  Riutilizzare `daysUntil` per ottenere il dato, delegare tono/label al nuovo helper e rendere la scadenza leggibile con testo (“Scaduta”, “In scadenza entro 30 giorni”, “Attiva”), data e icona. Usare lista/table desktop con header sticky e cards P0/P1 mobile; mantenere il filtro `tipo`, statistiche, dialog create/edit e confirm delete. Non montare i controlli mutation a un non-direzione: `App.tsx`/`RequireDirezione` resta la guardia UX e `adminProcedure` resta il confine.

- [ ] **Step 4: Implementare Archivio come restore queue non distruttiva**

  Separare commesse e clienti archiviate con tabs accessibili e messaggi empty specifici. Ogni riga mostra tipo, identità, data archiviazione se nel payload e pulsante “Ripristina”; la conferma deve dichiarare “riporta il record tra quelli attivi senza cambiare stato operativo”. Conservare `restore`/`restoreCliente` e le invalidazioni correnti; non reintrodurre Produzione o modificare `archivedAt` localmente.

- [ ] **Step 5: Verificare verde e autorizzazioni**

  Run: `pnpm vitest run client/src/lib/supportQueue.test.ts server/routers/permessi.test.ts && pnpm check`

  Expected: PASS; le garanzie mutate solo dalle procedure admin e l'archivio resta soft restore.

- [ ] **Step 6: Commit**

  ```bash
  git add client/src/pages/GaranzieList.tsx client/src/pages/Archivio.tsx client/src/lib/supportQueue.ts client/src/lib/supportQueue.test.ts
  git commit -m "feat(ui): migra registri garanzie e archivio"
  ```

### Task 6: Trasformare l'hub Preventivatori in un ingresso guided-flow

**Files:**

- Modify: `client/src/pages/Preventivatori.tsx:45-467`
- Create: `client/src/lib/preventivatori.ts`
- Create: `client/src/lib/preventivatori.test.ts`
- Modify: `client/src/lib/navigation.test.ts`

**Interfaces:**

- Consumes: `PREVENTIVATORE_ROUTES` e cataloghi statici azienda/prodotto.
- Produces: catalogo orientato a “azienda → prodotto → calcola”, con route figlie immutate `/preventivatori/fivizzanese/persiane` e `/preventivatori/punto-del-serramento/persiane`.

- [ ] **Step 1: Scrivere il test fallente delle route preventivatore**

  Esportare `preventivatoreRouteFor(aziendaId: string, prodottoKey: string): string | null` da `Preventivatori.tsx` in `client/src/lib/preventivatori.ts` e creare `client/src/lib/preventivatori.test.ts`:

  ```ts
  expect(preventivatoreRouteFor("fivizzanese", "persiane")).toBe(
    "/preventivatori/fivizzanese/persiane"
  );
  expect(preventivatoreRouteFor("punto-del-serramento", "persiane")).toBe(
    "/preventivatori/punto-del-serramento/persiane"
  );
  expect(preventivatoreRouteFor("fivizzanese", "zanzariere")).toBeNull();
  ```

- [ ] **Step 2: Eseguire il test e confermare il rosso**

  Run: `pnpm vitest run client/src/lib/preventivatori.test.ts client/src/lib/navigation.test.ts`

  Expected: FAIL perché il resolver non è esportato dal modulo puro.

- [ ] **Step 3: Implementare resolver e hub**

  Spostare la mappa route nel modulo puro e farla consumare alla pagina. Ricomporre l'hub come header con contesto, filtro/ricerca se usa dati già disponibili e moduli azienda/prodotto asimmetrici: un'area focale per il preventivatore pronto, un elenco chiaro per quelli non disponibili. Un prodotto non implementato resta informazione passiva “Non disponibile in Ruffino Flow”, senza bottone, route inventata o falsa configurazione.

  Mantenere la voce sidebar esistente e la sua route; non spostare il preventivatore nella navigation model.

- [ ] **Step 4: Verificare verde e deep link**

  Run: `pnpm vitest run client/src/lib/preventivatori.test.ts && pnpm check`

  Expected: PASS; tutte e due le route esistenti rimangono raggiungibili senza nuova API.

- [ ] **Step 5: Commit**

  ```bash
  git add client/src/pages/Preventivatori.tsx client/src/lib/preventivatori.ts client/src/lib/preventivatori.test.ts
  git commit -m "feat(ui): ricompone hub preventivatori"
  ```

### Task 7: Migrare i due preventivatori senza alterare calcoli o upload

**Files:**

- Modify: `client/src/pages/PreventivatoreFivizzanese.tsx:65-1425`
- Modify: `client/src/pages/PreventivatorePuntoDelSerramento.tsx:66-1285`
- Modify: `client/src/lib/preventivatori.ts`
- Test: `client/src/lib/preventivatori.test.ts`
- Test: `server/routers/preventiviContratti.test.ts`

**Interfaces:**

- Consumes: `toMm`, `areaMq`, cataloghi/modelli/colori locali, `trpc.commesse.list`, `trpc.preventiviContratti.upload`.
- Produces: form guidati a sezioni, summary persistente, azione export/upload visibile e layout mobile a una colonna; gli stessi payload upload e calcoli restano invariati.

- [ ] **Step 1: Scrivere test fallenti dei confini numerici comuni**

  Estrarre in `client/src/lib/preventivatori.ts`:

  ```ts
  export function millimetriValidi(value: string): number | null;
  export function areaMetriQuadri(
    larghezzaMm: number,
    altezzaMm: number
  ): number;
  ```

  Aggiungere test:

  ```ts
  expect(millimetriValidi("1200")).toBe(1200);
  expect(millimetriValidi("0")).toBeNull();
  expect(millimetriValidi("12,5")).toBeNull();
  expect(areaMetriQuadri(1000, 2000)).toBe(2);
  ```

- [ ] **Step 2: Eseguire il test e confermare il rosso**

  Run: `pnpm vitest run client/src/lib/preventivatori.test.ts`

  Expected: FAIL perché le funzioni vivono duplicate nelle pagine.

- [ ] **Step 3: Estrarre solo calcoli puri e ricomporre Fivizzanese**

  Far delegare le funzioni locali ai helper puri senza cambiare precisione, formattazione `it-IT`, righe, supplementi, PDF o payload upload. Organizzare Fivizzanese in sezioni “Commessa e destinatario”, “Misure”, “Configurazione”, “Riepilogo”; una sola summary focale mostra il totale già calcolato, senza introdurre una seconda formula client. La scelta commessa resta `trpc.commesse.list` e non prefetch-a campi economici estranei.

- [ ] **Step 4: Ricomporre Punto del Serramento con lo stesso contratto di flusso**

  Conservare grouping modelli/colori, selezione posa e file export. Usare la stessa sequenza visuale ma non forzare componenti prodotto diversi dentro campi artificialmente comuni. Su telefono, summary e CTA “Genera/archivia preventivo” diventano sticky sopra safe area senza coprire l'ultimo campo; i controlli per misura hanno `inputMode="numeric"` e 16px minimo.

- [ ] **Step 5: Verificare verde e contratto upload**

  Run: `pnpm vitest run client/src/lib/preventivatori.test.ts server/routers/preventiviContratti.test.ts && pnpm check`

  Expected: PASS; validazione/upload server restano invariati e nessun preventivatore deriva importi da endpoint economici.

- [ ] **Step 6: Commit**

  ```bash
  git add client/src/pages/PreventivatoreFivizzanese.tsx client/src/pages/PreventivatorePuntoDelSerramento.tsx client/src/lib/preventivatori.ts client/src/lib/preventivatori.test.ts
  git commit -m "feat(ui): migra flussi preventivatori"
  ```

### Task 8: Migrare utenti, sedi e conoscenza rispettando ruoli e audit

**Files:**

- Modify: `client/src/pages/UtentiList.tsx:34-626`
- Modify: `client/src/pages/SediList.tsx:1-221`
- Modify: `client/src/pages/Conoscenza.tsx:1-245`
- Modify: `client/src/components/RequireDirezione.tsx:1-52`
- Modify: `client/src/lib/roles.ts`
- Create: `client/src/lib/roles.test.ts`
- Test: `server/routers/permessi.test.ts`
- Test: `server/routers/sedi.integrazioni.test.ts`

**Interfaces:**

- Consumes: `trpc.utenti.list/stats/create/update/delete`, `trpc.sedi.listAll/create/update`, `trpc.conoscenza.list/create/update/delete`, `isDirezione`, `RequireDirezione`.
- Produces: liste/admin form dense, esclusivamente direzione lato UI, che rispecchiano le mutation server admin e non espongono password, capability o sedi non autorizzate.

- [ ] **Step 1: Scrivere test fallenti per una guardia visuale non ambigua**

  Estrarre da `RequireDirezione.tsx` un helper puro in `client/src/lib/roles.ts`:

  ```ts
  export function direzioneGateLabel(input: {
    user: unknown;
    loading: boolean;
  }): "allowed" | "blocked" | "loading";
  ```

  Creare `client/src/lib/roles.test.ts`:

  ```ts
  expect(
    direzioneGateLabel({ user: { ruoli: ["direzione"] }, loading: false })
  ).toBe("allowed");
  expect(
    direzioneGateLabel({ user: { ruoli: ["commerciale"] }, loading: false })
  ).toBe("blocked");
  expect(direzioneGateLabel({ user: null, loading: true })).toBe("loading");
  ```

- [ ] **Step 2: Eseguire il test e confermare il rosso**

  Run: `pnpm vitest run client/src/lib/roles.test.ts`

  Expected: FAIL perché `direzioneGateLabel` non esiste.

- [ ] **Step 3: Implementare guardia e Gestione utenti**

  Implementare l'helper come adapter di `isDirezione`; `RequireDirezione` mantiene il blocked state, ma lo rende un errore di autorizzazione compatto con un solo “Torna alla dashboard”, focus visibile e testo italiano. Non cambiare `App.tsx` routes guardate.

  In Utenti sostituire cards ripetute con toolbar, lista/tabella desktop e record card mobile. Mantenere massimo tre ruoli, sedi assegnate, attivo/inattivo, dialog di editing, `CapabilityMatrix`, `UserPermissionsDialog`, `DelegationDialog` e tutte le mutation. Non mostrare `password`, hash o token; `hasPassword` resta solo l'indicatore già autorizzato dal server.

- [ ] **Step 4: Implementare Sedi e Conoscenza come registri con azioni esplicite**

  Sedi: mantenere `listAll`/create/update solo direzione, evidenziare sede attiva senza lasciare intendere uno switch non autorizzato; la selezione operativa resta `SedeSwitcher` e `sedi.switch` nella shell. Conoscenza: sostituire il testo storico “quando il nuovo agente sarà attivo” con copy strettamente fattuale: “Registro curato dalla direzione; non alimenta automaticamente Tars né altri workflow”. Non suggerire alcun consumer Tars, perché il contratto corrente non lo prevede. Toggle attiva, edit e delete conservano audit/mutation esistenti e delete usa conferma specifica.

- [ ] **Step 5: Verificare verde, sede e privacy**

  Run: `pnpm vitest run client/src/lib/roles.test.ts server/routers/permessi.test.ts server/routers/sedi.integrazioni.test.ts && pnpm check`

  Expected: PASS; la direzione vede solo ciò che le procedure consentono, utenti non direzione ricevono UX blocked ma il server resta il confine, integrazioni per sede non si mescolano.

- [ ] **Step 6: Commit**

  ```bash
  git add client/src/pages/UtentiList.tsx client/src/pages/SediList.tsx client/src/pages/Conoscenza.tsx client/src/components/RequireDirezione.tsx client/src/lib/roles.ts client/src/lib/roles.test.ts
  git commit -m "feat(ui): migra registri amministrazione"
  ```

### Task 9: Ricostruire Impostazioni come hub di stato reale e rischio graduato

**Files:**

- Modify: `client/src/pages/Integrazioni.tsx:1-1596`
- Modify: `client/src/components/CaselleEmailCard.tsx:35-354`
- Modify: `client/src/components/WhatsAppCard.tsx`
- Modify: `client/src/lib/navigation.test.ts`
- Test: `server/routers/sedi.integrazioni.test.ts`
- Test: `server/routers/fattureInCloud.oauth.test.ts`

**Interfaces:**

- Consumes: `isDirezione`, `GESTIONE_LINKS`, `CaselleEmailCard`, `WhatsAppCard`, `trpc.fattureInCloud.*`, `trpc.backup.*`, `trpc.externalCalendars.*`, `trpc.calendarSync.*`, `trpc.clienti.importaDaCsv`, `trpc.commesse.resetPattuiti`.
- Produces: hub settings che presenta soltanto integrazioni e operazioni davvero supportate, separando stato/azione/avvertenza e chiarendo sede versus installazione.

- [ ] **Step 1: Scrivere il test fallente contro integrazioni simulate**

  Aggiungere un test strutturale a `client/src/lib/navigation.test.ts` che legge `client/src/pages/Integrazioni.tsx` e verifica:

  ```ts
  expect(source).not.toContain("Microsoft To Do");
  expect(source).not.toContain("Sincronizzazione task operativi bidirezionale");
  expect(source).not.toContain("todoEnabled");
  ```

  Il test usa `readFileSync(resolve(process.cwd(), "client/src/pages/Integrazioni.tsx"), "utf8")`; è appropriato perché impedisce che una UI locale simuli un contratto server inesistente.

- [ ] **Step 2: Eseguire il test e confermare il rosso**

  Run: `pnpm vitest run client/src/lib/navigation.test.ts`

  Expected: FAIL perché la card Microsoft To Do usa stato locale senza router, OAuth o sync server.

- [ ] **Step 3: Eliminare la falsa integrazione e ricomporre il catalogo reale**

  Rimuovere integralmente stato `todoEnabled`, `todoConfig`, card Microsoft To Do, copy sui task e import non più usati. Rimuovere anche l'heading “Agente” vuota. Non sostituirli con toggle disabilitato o “prossimamente”.

  Organizzare il resto in: “Canali” (Email, WhatsApp), “Contabilità” (FiC e le operazioni che il router espone davvero), “Calendari”, “Backup e storage”, “Gestione direzione”. Ogni card usa status dal query payload, ultimo sync/errore quando disponibile, CTA precisa e avvertenza prima delle operazioni destructive. `GESTIONE_LINKS` resta una lista di sole route registrate; aggiungere Utenti, Sedi e Conoscenza soltanto se l'entry è direzione-only e la route `App.tsx` è già protetta, altrimenti non creare link.

- [ ] **Step 4: Conservare scope, segreti e gate operativi**

  Conservare la nota “per sede” solo sulle integrazioni che lo sono; Backup Drive resta l'eccezione installazione. Non rendere segreti, refresh token, token manuali o webhook nel DOM. Per import CSV, reset pattuiti, sync/annulla sync e backup manuale, mantenere le mutation e i confirm dialog esistenti; rendere il copy esplicito su conseguenza, ma non creare pulsanti che eseguano storage migration/probe in scrittura. Caselle e WhatsApp mantengono error/retry/stato disconnesso senza inventare che il canale sia operativo.

- [ ] **Step 5: Verificare verde e contratti OAuth/sede**

  Run: `pnpm vitest run client/src/lib/navigation.test.ts server/routers/sedi.integrazioni.test.ts server/routers/fattureInCloud.oauth.test.ts && pnpm check`

  Expected: PASS; nessuna integrazione fake, OAuth/FiC resta per sede, backup resta installazione e nessun segreto compare nel markup.

- [ ] **Step 6: Commit**

  ```bash
  git add client/src/pages/Integrazioni.tsx client/src/components/CaselleEmailCard.tsx client/src/components/WhatsAppCard.tsx client/src/lib/navigation.test.ts
  git commit -m "feat(ui): ricostruisce hub integrazioni reale"
  ```

### Task 10: Preservare il login e migrare fallback, guardie e redirect senza perdita di accesso

**Files:**

- Reference unchanged: `client/src/pages/LoginPage.tsx:1-190`
- Modify: `client/src/pages/NotFound.tsx:1-52`
- Modify: `client/src/App.tsx:1-204`
- Modify: `client/src/lib/navigation.test.ts`
- Modify: `client/src/lib/messaggi.test.ts`
- Test: `server/routers/produzionePagina.test.ts`

**Interfaces:**

- Consumes: `trpc.auth.login`, `ThemeProvider`, `LegacyRedirect`, `legacyMessageRedirect`, `produzioneRedirect`, `RequireDirezione`.
- Produces: login legacy invariato e classificato `esclusa con motivazione`, 404 autenticato Borgogna Operativa con recovery, route lazy invarianti e redirect legacy immutati. `platform.interruttori` è una procedura protetta: prima del login il client non può conoscere `FLAG_UI_V2`; questa slice non rende pubblico il flag e non applica v3 sempre, perché entrambe le scelte romperebbero il confine o il rollback.

- [ ] **Step 1: Scrivere test fallenti dei redirect e del copy fallback**

  Estendere `client/src/lib/navigation.test.ts` e `client/src/lib/messaggi.test.ts`:

  ```ts
  expect(produzioneRedirect("/produzione/stato?tab=bom")).toBe("/kanban");
  expect(legacyMessageRedirect("/comunicazioni?view=lead&messaggio=42")).toBe(
    "/messaggi/email?view=lead&messaggio=42"
  );
  ```

  Aggiungere nello stesso test strutturale una lettura di `NotFound.tsx` che richiede “Pagina non trovata” e “Torna alla dashboard” e rifiuta “Page Not Found”, “Sorry” e “Go Home”.

- [ ] **Step 2: Eseguire i test e confermare il rosso**

  Run: `pnpm vitest run client/src/lib/navigation.test.ts client/src/lib/messaggi.test.ts`

  Expected: FAIL sul copy inglese del fallback; i redirect devono già restare verdi.

- [ ] **Step 3: Congelare il login legacy e implementare il 404 nel sistema v3**

  Login: non modificarne markup, query, form o resa in questa migrazione. Aggiungere un test strutturale che impedisca a `LoginPage` di leggere direttamente env, chiamare una procedura pubblica inesistente o applicare incondizionatamente il marker v3. Registrare `/login`/boundary autenticazione come esclusione motivata nel route manifest: il flag è leggibile solo dopo autenticazione e il mandato vieta una modifica del contratto server.

  NotFound: tradurre integralmente microcopy, rimuovere `gradient-page`, backdrop blur e card marketing; mostrare codice 404, motivo, URL richiesto soltanto se non contiene dati sensibili (non è necessario aggiungerlo), e una CTA “Torna alla dashboard”. Usare landmark `main`, heading gerarchici e focus visibile.

- [ ] **Step 4: Conservare router e flag senza una terza skin**

  In `App.tsx` aggiornare solo commenti/nomi visivi riferiti a Frame & Flow affinché descrivano Modular Control; non alterare i `lazy` import, `Route`, `RequireDirezione`, `LegacyRedirect`, `ThemeProvider`, posizione `Toaster` o l'ordine dei fallback. Confermare che la resa autenticata ON non possieda commenti/selector visivi Frame & Flow, che OFF rimanga v1 e che il login non simuli la conoscenza del flag protetto.

- [ ] **Step 5: Verificare verde e hardening Produzione**

  Run: `pnpm vitest run client/src/lib/navigation.test.ts client/src/lib/messaggi.test.ts server/routers/produzionePagina.test.ts && pnpm check`

  Expected: PASS; redirect e deep link restano intatti, il fallback è in italiano, nessuna voce Produzione rientra nel codice client.

- [ ] **Step 6: Commit**

  ```bash
  git add client/src/pages/NotFound.tsx client/src/App.tsx client/src/lib/navigation.test.ts client/src/lib/messaggi.test.ts docs/design/modular-control/route-manifest.md
  git commit -m "feat(ui): migra accesso e fallback"
  ```

### Task 11: Eseguire la verifica trasversale, visuale e di rollback della slice

**Files:**

- Modify: `docs/design/modular-control/route-manifest.md`
- Modify: `docs/design/modular-control/verification-log.md`
- Create directory through sanitized evidence files: `docs/design/modular-control/evidence/support-admin/`
- Modify: `docs/design/ruffino-flow-page-matrix.md`
- Test: `client/src/lib/tokenDiscipline.test.ts`
- Test: `server/routers/mail.channels.test.ts`
- Test: `server/routers/notifiche.test.ts`
- Test: `server/routers/permessi.test.ts`
- Test: `server/routers/sedi.integrazioni.test.ts`
- Test: `server/routers/produzionePagina.test.ts`

**Interfaces:**

- Consumes: tutte le route e i test delle task 1–10, `FLAG_UI_V2`, `platform.interruttori`, i contratti tRPC invariati.
- Produces: evidenza ripetibile che la slice è coerente in light/dark, desktop/mobile, capability/sede/privacy e rollback; matrice/handoff aggiornati solo con fatti verificati.

- [ ] **Step 1: Scrivere il test fallente di disciplina token per i nuovi file**

  Prima della scansione, aggiungere alle deroghe `DEROGHE_HEX` di `client/src/lib/tokenDiscipline.test.ts` soltanto le eccezioni ancora indispensabili, ciascuna con motivo e file. L'obiettivo di questo task è portare a zero le eccezioni slice-04; non aggiungere `EmailPage`, WhatsApp, chat, post-vendita, preventivatori, admin, login o fallback alla lista.

  Eseguire:

  ```bash
  pnpm vitest run client/src/lib/tokenDiscipline.test.ts
  ```

  Expected: FAIL se un file migrato contiene palette numerica, hex arbitrario o testo bianco fisso su token che in dark sono chiari.

- [ ] **Step 2: Correggere le violazioni e rieseguire test mirati**

  Sostituire ogni violazione con il token semantico appropriato (`surface`, `surface-sunken`, `text-*`, `border-*`, `brand`, `on-brand`, stato + on-state). Non attenuare il test e non registrare deroghe per abbreviare la chiusura.

  Run:

  ```bash
  pnpm vitest run client/src/lib/tokenDiscipline.test.ts client/src/lib/emailLayout.test.ts client/src/lib/messaggi.test.ts client/src/lib/notificationStream.test.ts client/src/lib/notificationView.test.ts client/src/lib/supportQueue.test.ts client/src/lib/preventivatori.test.ts client/src/lib/roles.test.ts client/src/lib/navigation.test.ts
  ```

  Expected: PASS.

- [ ] **Step 3: Eseguire le prove contrattuali server senza modificare server**

  Run:

  ```bash
  pnpm vitest run server/routers/mail.channels.test.ts server/routers/notifiche.test.ts server/routers/permessi.test.ts server/routers/sedi.integrazioni.test.ts server/routers/fattureInCloud.oauth.test.ts server/routers/preventiviContratti.test.ts server/routers/crossSede.test.ts server/routers/produzionePagina.test.ts
  ```

  Expected: PASS. Se fallisce un test server, non adattare il router alla UI: identificare la surface client che ha assunto un contratto inesistente oppure fermarsi per una decisione di prodotto.

- [ ] **Step 4: Eseguire browser QA con fixture sanitizzate**

  Avviare `pnpm dev` con dati locali non produttivi e, con `FLAG_UI_V2` ON, acquisire screenshot light/dark a 1440×900 e 390×844 delle route:

  ```text
  /messaggi/email?view=da_gestire
  /messaggi/whatsapp
  /chat
  /notifiche?view=mine
  /ticket
  /reclami
  /garanzie
  /archivio
  /preventivatori
  /preventivatori/fivizzanese/persiane
  /preventivatori/punto-del-serramento/persiane
  /utenti
  /sedi
  /conoscenza
  /integrazioni
  /404
  ```

  Per ogni route controllare: nessun overflow orizzontale (`document.documentElement.scrollWidth === document.documentElement.clientWidth`), focus visibile, tastiera in dialog/sheet, target touch, refetch senza skeleton totale, empty/errore specifici, console pulita e assenza di dati protetti. Verificare Email tri-pane a 1440, due-pane a 1024 e single-pane a 390; WhatsApp senza composer; Chat con composer; preventivatori con keyboard mobile aperta; Impostazioni senza falsa Microsoft To Do.

  Salvare ogni prova sotto `docs/design/modular-control/evidence/support-admin/` con schema `<route-slug>-1440x900-light.png`, `<route-slug>-1440x900-dark.png` e `<route-slug>-390x844-light.png`; usare, per esempio, `messaggi-email-1440x900-light.png` e `integrazioni-390x844-light.png`. Non incorporare screenshot nel file di verifica se non sono stati prima controllati per dati reali.

- [ ] **Step 5: Verificare flag OFF e comandi completi**

  Impostare il flag OFF solo nell'ambiente locale e ripetere `/messaggi/email`, `/ticket`, `/integrazioni`, `/404`, `/comunicazioni?view=lead&messaggio=42` e `/produzione/qualcosa`; verificare v1, redirect e contratti invariati. Ripristinare il flag locale al valore iniziale dopo la prova.

  Run:

  ```bash
  pnpm check
  pnpm test
  pnpm build
  git diff --check
  ```

  Expected: tutti i comandi terminano con exit code 0. Registrare dimensione/chunk build prima e dopo; una regressione deve essere motivata da codice necessario, non da una libreria nuova.

- [ ] **Step 6: Aggiornare documentazione e commit finale**

  In `docs/design/modular-control/route-manifest.md` e `docs/design/ruffino-flow-page-matrix.md`, registrare archetipo, stato di migrazione, gate, viewport e stati testati per ogni route della slice. Salvare gli screenshot sanitizzati in `docs/design/modular-control/evidence/support-admin/` e registrare comandi/esiti, comportamento flag ON/OFF e rischi reali in `docs/design/modular-control/verification-log.md`. Il riepilogo definitivo in `handoff.md` è responsabilità della slice 05, dopo le revisioni indipendenti; non anticipare né dichiarare rollout di produzione.

  ```bash
  git add docs/design/modular-control/route-manifest.md docs/design/modular-control/verification-log.md docs/design/modular-control/evidence/support-admin docs/design/ruffino-flow-page-matrix.md client/src/lib/tokenDiscipline.test.ts
  git commit -m "docs: registra hardening slice support admin"
  ```

## Self-Review Record

- Copertura spec: Comunicazioni = Task 1–3; post-vendita/supporto = Task 4–5; preventivatori = Task 6–7; admin/settings = Task 8–9; auth/fallback/redirect = Task 10; a11y, responsive, flag, sede, privacy, test e documentazione = Task 11.
- Anti-placeholder: ogni route della slice è nominata con percorso concreto; ogni task elenca file, contratti, test rosso/verde, implementazione, comando e commit.
- Coerenza tipi: `ticketMatchesQueueFilter`, `warrantyExpiryTone`, `preventivatoreRouteFor`, `millimetriValidi`, `areaMetriQuadri` e `direzioneGateLabel` sono definiti con le stesse firme che usano i test successivi.
- Decisione esplicita: la card Microsoft To Do locale viene rimossa, non mascherata, perché non esiste un contratto server/OAuth/sync verificato e la UI non può simulare funzionalità.
