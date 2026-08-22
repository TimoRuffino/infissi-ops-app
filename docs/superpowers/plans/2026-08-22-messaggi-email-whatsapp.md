# Messaggi Email e WhatsApp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separare Email e WhatsApp in due pagine operative, mantenendo una sola sorgente dati e la compatibilita dei deep link esistenti.

**Architecture:** `comunicazioni` resta la tabella condivisa. Email continua a leggere record singoli filtrati per canale; WhatsApp aggiunge un read model aggregato per conversazione e un endpoint paginato per il thread. Le route canoniche diventano `/messaggi/email` e `/messaggi/whatsapp`; le vecchie route restano redirect compatibili.

**Tech Stack:** React 19, Wouter, tRPC 11, React Query, Tailwind 4, shadcn/Radix, Vitest, PostgreSQL tramite `kvSql` con fallback in memoria.

**Spec:** `docs/superpowers/specs/2026-08-22-messaggi-tars-context-design.md`, sezioni 3-5, 11-16.

## Global Constraints

- Conservare ingestione, classificazione AI, tombstone e collegamenti esistenti.
- Applicare sempre `sedeId`; una fonte di un'altra sede deve risultare assente.
- Nessun invio WhatsApp o email in questa fase.
- Nessuno scroll orizzontale globale a 1440x900 e 390x844.
- Usare token semantici, Plus Jakarta Sans e componenti gia presenti.
- Tars propone azioni; non aggiungere mutation autonome.
- Ogni commit deve includere solo i file della relativa task.

---

## Task 1: Estendere il read model delle comunicazioni per canale

**Files:**
- Modify: `server/tars/comunicazioni.ts`
- Test: `server/tars/mail.test.ts`

- [ ] **Step 1: Scrivere i test fallenti per statistiche e bulk view channel-scoped**

Aggiungere casi che creano almeno una email e un messaggio WhatsApp nella stessa sede e verificano:

```ts
expect((await statsComunicazioni(1, "email")).whatsapp).toBe(0);
expect((await statsComunicazioni(1, "whatsapp")).email).toBe(0);
expect(await segnaTutteViste(1, "email")).toBe(1);
expect((await getComunicazione(whatsapp.id, 1))?.stato).toBe("nuova");
```

- [ ] **Step 2: Eseguire il test e confermare il fallimento di firma**

Run: `pnpm test -- server/tars/mail.test.ts`

Expected: TypeScript/Vitest segnala che `statsComunicazioni` e `segnaTutteViste` non accettano il secondo argomento.

- [ ] **Step 3: Estendere le firme in modo retrocompatibile**

Implementare:

```ts
export async function segnaTutteViste(
  sedeId: number,
  canale?: Comunicazione["canale"]
): Promise<number>;

export async function statsComunicazioni(
  sedeId: number,
  canale?: Comunicazione["canale"]
): Promise<StatsComunicazioni>;
```

Nel fallback filtrare `!canale || r.canale === canale`; in PostgreSQL usare una condizione nullable parametrizzata. I contatori `email` e `whatsapp` devono riflettere il dataset filtrato, senza cambiare il comportamento delle chiamate senza `canale`.

- [ ] **Step 4: Verificare i test mirati**

Run: `pnpm test -- server/tars/mail.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/tars/comunicazioni.ts server/tars/mail.test.ts
git commit -m "feat: separa statistiche comunicazioni per canale"
```

## Task 2: Aggiungere conversazioni e thread WhatsApp

**Files:**
- Modify: `server/tars/comunicazioni.ts`
- Test: `server/tars/mail.test.ts`

- [ ] **Step 1: Scrivere i test fallenti del raggruppamento**

I test devono coprire due numeri aziendali, stessa controparte, messaggi in/out, ordinamento, non letti, scope sede e paginazione del thread.

```ts
const conversazioni = await listConversazioniWhatsApp({
  sedeId: 1,
  limit: 20,
  offset: 0,
});
expect(conversazioni).toHaveLength(2);
expect(conversazioni[0]).toMatchObject({
  casellaId: 8,
  controparte: "+393331112222",
  nonLetti: 2,
});

const thread = await getThreadWhatsApp({
  sedeId: 1,
  casellaId: 8,
  controparte: "+393331112222",
  limit: 2,
});
expect(thread.messaggi.map(m => m.receivedAt.getTime())).toEqual(
  [...thread.messaggi].map(m => m.receivedAt.getTime()).sort((a, b) => a - b)
);
```

- [ ] **Step 2: Eseguire e vedere il fallimento per export mancanti**

Run: `pnpm test -- server/tars/mail.test.ts`

Expected: FAIL su `listConversazioniWhatsApp` e `getThreadWhatsApp` non esportati.

- [ ] **Step 3: Definire i tipi pubblici**

```ts
export type ConversazioneWhatsApp = {
  key: string;
  casellaId: number;
  controparte: string;
  nomeProfilo: string | null;
  ultimoMessaggio: string;
  ultimoMessaggioAt: Date;
  direzioneUltimoMessaggio: Comunicazione["direzione"];
  nonLetti: number;
  totaleMessaggi: number;
  clienteId: number | null;
  commessaId: number | null;
  matchConfidenza: Comunicazione["matchConfidenza"];
};

export type ThreadWhatsApp = {
  conversazione: ConversazioneWhatsApp;
  messaggi: Comunicazione[];
  hasMore: boolean;
  nextBefore: Date | null;
};
```

La chiave deve essere stabile e non contenere `sedeId` nel payload client: `wa:<casellaId>:<numero normalizzato>`. La query server applica comunque sempre `sedeId`.

- [ ] **Step 4: Implementare aggregazione SQL e fallback**

Implementare:

```ts
export async function listConversazioniWhatsApp(input: {
  sedeId: number;
  search?: string;
  soloDaGestire?: boolean;
  limit?: number;
  offset?: number;
}): Promise<ConversazioneWhatsApp[]>;

export async function getThreadWhatsApp(input: {
  sedeId: number;
  casellaId: number;
  controparte: string;
  before?: Date;
  limit?: number;
}): Promise<ThreadWhatsApp | null>;
```

Normalizzare la controparte con una funzione pura esportata. Nei record esistenti `mittente` rappresenta gia la controparte anche per i messaggi in uscita; non dedurla dai destinatari. Escludere tombstone e categorie escluse di default. Per il thread leggere `limit + 1`, ritornare gli ultimi `limit` in ordine crescente e produrre `nextBefore` dal messaggio piu vecchio restituito.

- [ ] **Step 5: Verificare scope e paginazione**

Run: `pnpm test -- server/tars/mail.test.ts`

Expected: PASS per raggruppamento, sede e thread.

- [ ] **Step 6: Commit**

```bash
git add server/tars/comunicazioni.ts server/tars/mail.test.ts
git commit -m "feat: aggiungi read model conversazioni WhatsApp"
```

## Task 3: Esporre API tRPC specifiche Email e WhatsApp

**Files:**
- Modify: `server/routers/mail.ts`
- Create: `server/routers/mail.channels.test.ts`

- [ ] **Step 1: Scrivere test router fallenti**

Creare un caller autenticato sede 1 e verificare:

```ts
await caller.mail.email.list({ limit: 20 });
await caller.mail.email.stats();
await caller.mail.email.segnaTutteViste();
await caller.mail.whatsapp.conversazioni({ limit: 20 });
await caller.mail.whatsapp.thread({
  casellaId: 8,
  controparte: "+393331112222",
  limit: 50,
});
```

Verificare anche che una conversazione della sede 2 non appaia e che un thread fuori sede ritorni `NOT_FOUND`.

- [ ] **Step 2: Eseguire il test e confermare procedure mancanti**

Run: `pnpm test -- server/routers/mail.channels.test.ts`

Expected: FAIL per router `email` e procedure WhatsApp mancanti.

- [ ] **Step 3: Aggiungere il router Email come facciata compatibile**

Nel `mailRouter` aggiungere:

```ts
email: router({
  list: protectedProcedure.input(emailListInput).query(({ input, ctx }) =>
    listComunicazioni({ ...input, sedeId: ctx.sedeId ?? 1, canale: "email" })
  ),
  stats: protectedProcedure.query(({ ctx }) =>
    statsComunicazioni(ctx.sedeId ?? 1, "email")
  ),
  segnaTutteViste: protectedProcedure.mutation(async ({ ctx }) => ({
    aggiornate: await segnaTutteViste(ctx.sedeId ?? 1, "email"),
  })),
});
```

Estrarre e riusare lo schema Zod della lista per evitare drift. Mantenere `mail.comunicazioni.*` per compatibilita e per le pagine di fascicolo gia esistenti.

- [ ] **Step 4: Estendere il router WhatsApp esistente**

Nel router `whatsapp` gia presente aggiungere procedure di lettura, senza alterare onboarding/configurazione:

```ts
conversazioni: protectedProcedure.input(whatsappListInput).query(...),
thread: protectedProcedure.input(whatsappThreadInput).query(async (...) => {
  const result = await getThreadWhatsApp(...);
  if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Conversazione non trovata." });
  return result;
}),
```

- [ ] **Step 5: Verificare API e tipi**

Run: `pnpm test -- server/routers/mail.channels.test.ts server/tars/mail.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/routers/mail.ts server/routers/mail.channels.test.ts
git commit -m "feat: esponi api Email e conversazioni WhatsApp"
```

## Task 4: Estrarre componenti condivisi e costruire la pagina Email

**Files:**
- Create: `client/src/pages/messaggi/EmailPage.tsx`
- Create: `client/src/components/messaggi/EmailMessageList.tsx`
- Create: `client/src/components/messaggi/EmailMessageReader.tsx`
- Create: `client/src/lib/messaggi.ts`
- Create: `client/src/lib/messaggi.test.ts`
- Modify: `client/src/pages/Comunicazioni.tsx`

- [ ] **Step 1: Scrivere test fallenti per URL e viste Email**

In `messaggi.test.ts` testare funzioni pure:

```ts
expect(parseEmailView("?view=lead")).toBe("lead");
expect(parseEmailView("?view=ignota")).toBe("da_gestire");
expect(emailMessageHref(42)).toBe("/messaggi/email?messaggio=42");
expect(sourceHref({ tipo: "email", id: 42 })).toBe("/messaggi/email?messaggio=42");
```

- [ ] **Step 2: Eseguire il test e vedere il fallimento**

Run: `pnpm test -- client/src/lib/messaggi.test.ts`

Expected: FAIL per modulo mancante.

- [ ] **Step 3: Implementare helper di navigazione tipizzati**

Definire `EmailView`, parser con allowlist e generatori href. Non manipolare query string con concatenazioni non validate: usare `URLSearchParams`.

- [ ] **Step 4: Estrarre il lettore Email dalla pagina esistente**

Spostare in `EmailMessageReader` il flusso attuale: dettaglio, allegati, collega/scollega, categoria, elimina, stato e `tars.analizzaComunicazione`. Rimuovere rami visuali WhatsApp. Conservare le mutation e le invalidazioni esistenti.

- [ ] **Step 5: Costruire lista e pagina Email**

La pagina deve usare `trpc.mail.email.list/stats`, paginazione da 50 record e le viste approvate. Layout desktop: griglia `minmax(18rem, 0.9fr) minmax(0, 1.6fr)`. Mobile: lista e lettore sono due stati della stessa pagina, con pulsante indietro. La lista non deve usare una tabella larga.

Stati obbligatori: loading skeleton, vuoto contestuale, errore con retry, selezione rimossa, aggiornamento in corso.

- [ ] **Step 6: Ridurre `Comunicazioni.tsx` a redirect temporaneo o wrapper legacy**

La pagina non deve piu essere una superficie mista. In questa task puo diventare un re-export di `EmailPage`; il redirect canonico viene aggiunto nella task routing.

- [ ] **Step 7: Verificare test e typecheck**

Run: `pnpm test -- client/src/lib/messaggi.test.ts && pnpm check`

Expected: PASS e nessun errore TypeScript.

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/messaggi/EmailPage.tsx client/src/components/messaggi client/src/lib/messaggi.ts client/src/lib/messaggi.test.ts client/src/pages/Comunicazioni.tsx
git commit -m "feat: crea inbox operativa Email"
```

## Task 5: Costruire la pagina WhatsApp per conversazioni

**Files:**
- Create: `client/src/pages/messaggi/WhatsAppPage.tsx`
- Create: `client/src/components/messaggi/WhatsAppConversationList.tsx`
- Create: `client/src/components/messaggi/WhatsAppThread.tsx`
- Create: `client/src/components/messaggi/WhatsAppContextPanel.tsx`
- Modify: `client/src/lib/messaggi.ts`
- Modify: `client/src/lib/messaggi.test.ts`

- [ ] **Step 1: Aggiungere test fallenti per deep link WhatsApp**

```ts
expect(whatsappConversationHref("wa:8:+393331112222")).toBe(
  "/messaggi/whatsapp?conversazione=wa%3A8%3A%2B393331112222"
);
expect(parseConversationKey("wa:8:+393331112222")).toEqual({
  casellaId: 8,
  controparte: "+393331112222",
});
expect(parseConversationKey("email:8:x")).toBeNull();
```

- [ ] **Step 2: Implementare helper e verificare il test**

Run: `pnpm test -- client/src/lib/messaggi.test.ts`

Expected: PASS.

- [ ] **Step 3: Implementare elenco conversazioni**

Usare `trpc.mail.whatsapp.conversazioni` con ricerca debounced e paginazione. Mostrare nome CRM/profilo/numero, anteprima, ora, non letti e collegamento. Non mescolare badge di classificazione email.

- [ ] **Step 4: Implementare thread e caricamento progressivo**

Usare `trpc.mail.whatsapp.thread`; `Carica precedenti` aggiunge messaggi in testa senza perdere scroll. Distinguere entrata/uscita con allineamento e token semantici, non con grandi bolle decorative. Allegati/media restano azioni ispezionabili.

- [ ] **Step 5: Implementare pannello contesto**

Mostrare cliente e commessa collegati, appuntamenti/ticket quando disponibili tramite query gia esistenti, proposte Tars legate ai messaggi e azione `Gestisci con Tars`. Su viewport sotto `lg` il pannello diventa sheet/tab, senza terza colonna compressa.

- [ ] **Step 6: Verificare typecheck**

Run: `pnpm check`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/messaggi/WhatsAppPage.tsx client/src/components/messaggi/WhatsAppConversationList.tsx client/src/components/messaggi/WhatsAppThread.tsx client/src/components/messaggi/WhatsAppContextPanel.tsx client/src/lib/messaggi.ts client/src/lib/messaggi.test.ts
git commit -m "feat: crea workspace conversazioni WhatsApp"
```

## Task 6: Aggiornare navigazione, route e link impostazioni

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/components/DashboardLayout.tsx`
- Modify: `client/src/components/CaselleEmailCard.tsx`
- Modify: `client/src/components/WhatsAppCard.tsx`
- Modify: `client/src/lib/messaggi.test.ts`

- [ ] **Step 1: Aggiungere test dei redirect legacy agli helper**

```ts
expect(legacyMessageRedirect("/comunicazioni?view=lead")).toBe(
  "/messaggi/email?view=lead"
);
expect(legacyTarsRedirect("/inbox?tab=registro")).toBe(
  "/tars?tab=registro"
);
```

- [ ] **Step 2: Registrare le route lazy canoniche**

In `App.tsx` aggiungere `EmailPage`, `WhatsAppPage` e la futura route `/tars`; per ora `/tars` puo puntare a `TarsInbox`. Implementare un piccolo componente `LegacyRedirect` basato su `useLocation`/`replaceState` che conserva solo query riconosciute e usa replace, non push.

- [ ] **Step 3: Separare la sidebar**

Sostituire il gruppo Tars corrente con:

```ts
{
  icon: MessagesSquare,
  label: "Messaggi",
  path: "/messaggi/email",
  children: [
    { icon: Mail, label: "Email", path: "/messaggi/email" },
    { icon: MessageCircle, label: "WhatsApp", path: "/messaggi/whatsapp" },
  ],
},
{ icon: Bot, label: "Tars", path: "/tars" },
```

Verificare che la logica active non selezioni due voci e che il gruppo si apra sulle due route figlie.

- [ ] **Step 4: Correggere link dalle impostazioni**

`CaselleEmailCard` punta a `/messaggi/email`; `WhatsAppCard` espone `Vai a WhatsApp` quando esiste almeno una configurazione, puntando a `/messaggi/whatsapp`.

- [ ] **Step 5: Verificare test e build**

Run: `pnpm test -- client/src/lib/messaggi.test.ts && pnpm check && pnpm build`

Expected: tutti PASS; nessuna route lazy mancante.

- [ ] **Step 6: Commit**

```bash
git add client/src/App.tsx client/src/components/DashboardLayout.tsx client/src/components/CaselleEmailCard.tsx client/src/components/WhatsAppCard.tsx client/src/lib/messaggi.test.ts
git commit -m "feat: separa navigazione Email WhatsApp e Tars"
```

## Task 7: QA visuale, accessibilita e documentazione

**Files:**
- Modify: `handoff.md`
- Modify: `documento_requisiti_infissi_ops.md`

- [ ] **Step 1: Avviare il server locale**

Run: `pnpm dev`

Expected: URL locale disponibile senza errori di startup.

- [ ] **Step 2: Verificare desktop 1440x900**

Con browser/Playwright controllare `/messaggi/email` e `/messaggi/whatsapp`: nessun overflow globale, prima riga visibile, pannelli con `min-w-0`, focus evidente, azioni principali raggiungibili.

- [ ] **Step 3: Verificare mobile 390x844**

Controllare lista -> dettaglio -> indietro, testo lungo, numero lungo, allegati, empty/error/loading e menu sidebar. Eseguire una scansione `axe-core` sulle due pagine.

- [ ] **Step 4: Aggiornare handoff e PRD**

Documentare in `handoff.md` e `documento_requisiti_infissi_ops.md` route canoniche, redirect legacy, API channel-specific, chiave conversazione e limite sola lettura WhatsApp.

- [ ] **Step 5: Eseguire verifica completa**

Run: `pnpm check && pnpm test && pnpm build`

Expected: tre comandi PASS. Annotare separatamente eventuali verifiche Railway non eseguite.

- [ ] **Step 6: Commit**

```bash
git add handoff.md documento_requisiti_infissi_ops.md
git commit -m "docs: aggiorna flussi Email e WhatsApp"
```
