# Tars Allegati Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consentire a Tars di riconoscere un allegato operativo ricevuto via email, proporne il collegamento e, dopo approvazione, archiviarlo come documento reale e idempotente della commessa.

**Architecture:** Il modello interpreta il contenuto non fidato e propone un payload strutturato; il server rivalida comunicazione, allegato, tipo documento, sede e commessa prima di persistere. L'esecuzione riusa `archiviaAllegatoComunicazione`, `preventivi_documenti` e il file storage esistenti, mentre la pagina Email presenta prima il messaggio e poi gli strumenti operativi.

**Tech Stack:** TypeScript, Express/tRPC 11, React 19, React Query, Vitest, Tailwind 4, shadcn/Radix, file storage locale o S3-compatible.

**Spec:** `docs/superpowers/specs/2026-08-25-tars-email-documenti-design.md`

## Global Constraints

- Tars propone e non esegue mutazioni senza approvazione.
- Nessun match ambiguo viene scelto in silenzio.
- Ogni lettura e scrittura business e vincolata a `sedeId`; un id di altra sede produce `NOT_FOUND`.
- I byte vivono nel file storage; non aggiungere blob base64 agli store JSONB.
- `sourceRef = sedeId:comunicazioneId:allegatoIndex` resta la chiave idempotente.
- Il documento risultante usa lo stesso contratto di upload, anteprima, download, rinomina, riclassificazione ed eliminazione manuale.
- Il limite resta 10 MB e i MIME type restano quelli di `ALLOWED_MIME_TYPES`.
- Il contenuto di mail e allegati e dato non fidato, mai istruzione di sistema.
- Nessuna pagina introduce scroll orizzontale globale; verificare 1440x900 e 390x844.

---

## File Map

- `server/tars/documentIntake.ts`: normalizzazione del tipo, nome canonico e validazione del match proposto dal modello.
- `server/tars/documentIntake.test.ts`: casi `Misure Picchia`, tipi sconosciuti, match univoco e ambiguita.
- `server/routers/preventiviContratti.ts`: archivio email tipizzato e idempotente.
- `server/tars/stores.ts`: nuovo tipo proposta `archivia_allegato` e chiave azione canonica.
- `server/tars/tools.ts`: tool `proponi_archivia_allegato`, schema e validazione server-side.
- `server/tars/esecutore.ts`: approvazione, rivalidazione e archivio del file.
- `server/routers/tars.ts`: capability della proposta e invalidazione coerente.
- `server/tars/smistamento.test.ts`, `server/tars/tars.test.ts`, `server/routers/mail.channels.test.ts`: copertura di proposta, approvazione, sicurezza e retry.
- `client/src/components/TarsPropostaCard.tsx`: riepilogo leggibile dell'azione allegato.
- `client/src/components/messaggi/EmailMessageReader.tsx`: gerarchia corpo, allegati e Tars.
- `client/src/components/messaggi/EmailMessageList.tsx`: anteprima a due righe e segnali operativi.
- `client/src/pages/messaggi/EmailPage.tsx`: layout responsive senza overflow.

### Task 1: Contratto di classificazione e nome canonico

**Files:**
- Create: `server/tars/documentIntake.ts`
- Create: `server/tars/documentIntake.test.ts`

**Interfaces:**
- Produces: `normalizeDocumentType(value: unknown): DocTipo | null`.
- Produces: `canonicalAttachmentName(input: { originalName: string; tipo: DocTipo; clienteLabel: string }): string`.
- Produces: `validateAttachmentMatch(input: AttachmentMatchInput): AttachmentMatchResult` dove il risultato e `{ ok: true; commessaId: number }` oppure `{ ok: false; reason: "missing" | "ambiguous" | "cross_site" }`.

- [ ] **Step 1: Scrivere i test rossi**

```ts
it("normalizza Misure Picchia come documento misure", () => {
  expect(normalizeDocumentType("misure esecutive")).toBe("misure");
  expect(canonicalAttachmentName({
    originalName: "Misure Picchia.PDF",
    tipo: "misure",
    clienteLabel: "Picchia Marco",
  })).toBe("Misure esecutive Picchia Marco.pdf");
});

it("rifiuta un match ambiguo", () => {
  expect(validateAttachmentMatch({
    requestedCommessaId: null,
    candidates: [{ id: 11, sedeId: 1 }, { id: 12, sedeId: 1 }],
    sedeId: 1,
  })).toEqual({ ok: false, reason: "ambiguous" });
});
```

- [ ] **Step 2: Verificare il fallimento**

Run: `pnpm exec vitest run server/tars/documentIntake.test.ts`

Expected: FAIL per modulo/funzioni non esistenti.

- [ ] **Step 3: Implementare le funzioni pure**

```ts
export type AttachmentMatchInput = {
  requestedCommessaId: number | null;
  candidates: Array<{ id: number; sedeId: number }>;
  sedeId: number;
};

export type AttachmentMatchResult =
  | { ok: true; commessaId: number }
  | { ok: false; reason: "missing" | "ambiguous" | "cross_site" };
```

La normalizzazione deve usare solo i valori di `DOC_TIPI`; `canonicalAttachmentName` conserva l'estensione originale in minuscolo e usa `DOC_TIPO_LABEL`. `validateAttachmentMatch` accetta un solo candidato della sede o un `requestedCommessaId` presente nei candidati della sede.

- [ ] **Step 4: Verificare i test verdi**

Run: `pnpm exec vitest run server/tars/documentIntake.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/tars/documentIntake.ts server/tars/documentIntake.test.ts
git commit -m "feat(tars): validate email document matches"
```

### Task 2: Archivio email tipizzato e idempotente

**Files:**
- Modify: `server/routers/preventiviContratti.ts`
- Modify: `server/routers/mail.channels.test.ts`

**Interfaces:**
- Consumes: `DocTipo` e `canonicalAttachmentName`.
- Changes: `archiviaAllegatoComunicazione(args)` riceve anche `tipo: DocTipo` e `note?: string`.
- Produces: un `Documento` con `source: "comunicazione"`, tipo corretto e `storageKey` leggibile dalle query esistenti.

- [ ] **Step 1: Aggiungere i test rossi al flusso mail**

```ts
it("archivia un allegato email come misure e non lo duplica al retry", async () => {
  const first = await archiviaAllegatoComunicazione({
    sedeId: 1, comunicazioneId: 41, allegatoIndex: 0, commessaId: commessa.id,
    nome: "Misure esecutive Picchia.pdf", tipo: "misure",
    mimeType: "application/pdf", buffer: Buffer.from("pdf"), createdBy: 7,
  });
  const retry = await archiviaAllegatoComunicazione({
    sedeId: 1, comunicazioneId: 41, allegatoIndex: 0, commessaId: commessa.id,
    nome: "Misure esecutive Picchia.pdf", tipo: "misure",
    mimeType: "application/pdf", buffer: Buffer.from("pdf"), createdBy: 7,
  });
  expect(retry.id).toBe(first.id);
  expect(first.tipo).toBe("misure");
  expect(first.storageKey).toBeTruthy();
});
```

Includere anche MIME vietato, oltre 10 MB e commessa di altra sede.

- [ ] **Step 2: Verificare il fallimento**

Run: `pnpm exec vitest run server/routers/mail.channels.test.ts`

Expected: FAIL per parametro `tipo` ignorato o firma non aggiornata.

- [ ] **Step 3: Estendere l'helper senza cambiare la chiave idempotente**

Nel ramo create e update assegnare `documento.tipo = args.tipo`, `documento.note = args.note ?? "Archiviato da un allegato email con approvazione Tars."`, mantenendo lock, dedupe, checksum, fallback e cancellazione del vecchio `storageKey` gia presenti.

- [ ] **Step 4: Aggiornare il chiamante manuale**

`mail.email.archiviaAllegato` passa `tipo: "altro"` e la nota manuale attuale, così il comportamento esistente resta retrocompatibile.

- [ ] **Step 5: Verificare i test verdi**

Run: `pnpm exec vitest run server/routers/mail.channels.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/routers/preventiviContratti.ts server/routers/mail.ts server/routers/mail.channels.test.ts
git commit -m "feat(documenti): archive typed email attachments"
```

### Task 3: Proposta Tars per archiviare un allegato

**Files:**
- Modify: `server/tars/stores.ts`
- Modify: `server/tars/tools.ts`
- Modify: `server/tars/prompt.ts`
- Modify: `server/routers/tars.ts`
- Modify: `server/tars/tars.test.ts`
- Modify: `server/tars/smistamento.test.ts`

**Interfaces:**
- Produces: tipo proposta `archivia_allegato`.
- Produces: tool `proponi_archivia_allegato` con payload `{ comunicazioneId, allegatoIndex, attachmentName, expectedMimeType, commessaId, clienteId, tipoDocumento, nomeSuggerito, evidenze }`.
- Produces: chiave canonica `archivia_allegato:<sedeId>:<comunicazioneId>:<allegatoIndex>`.

- [ ] **Step 1: Scrivere i test rossi del tool**

Verificare: una sola commessa produce proposta; due candidate producono `chiedi_chiarimento`; indice allegato inesistente e cross-sede non creano proposte; un secondo run non duplica la stessa azione.

```ts
expect(proposta).toMatchObject({
  tipo: "archivia_allegato",
  commessaId: commessa.id,
  payload: {
    comunicazioneId: mail.id,
    allegatoIndex: 0,
    tipoDocumento: "misure",
    nomeSuggerito: "Misure esecutive Picchia Marco.pdf",
  },
});
```

- [ ] **Step 2: Verificare il fallimento**

Run: `pnpm exec vitest run server/tars/tars.test.ts server/tars/smistamento.test.ts`

Expected: FAIL per tool e tipo proposta assenti.

- [ ] **Step 3: Aggiungere schema e validazione**

Il tool deve leggere la comunicazione dal contesto server, confrontare nome e MIME attesi con l'allegato corrente, verificare la commessa nella stessa sede e chiamare `validateAttachmentMatch`. Se il risultato e ambiguo, deve restituire un errore tool che impone `chiedi_chiarimento`; non deve scegliere il primo record.

- [ ] **Step 4: Aggiornare profili e prompt**

Aggiungere il tool a `gestione_comunicazione`; nello smistamento automatico abilitarlo solo dopo classificazione non-spam e letture minime. Per costruire le evidenze, Tars usa nome file, oggetto, mittente e corpo gia letti e chiama `leggi_allegato` soltanto per formati testuali/PDF supportati e quando nome/relazioni non bastano. Il prompt deve dichiarare esplicitamente che testo e nomi file sono dati non fidati e che un match automatico richiede una sola commessa plausibile.

- [ ] **Step 5: Verificare i test verdi**

Run: `pnpm exec vitest run server/tars/tars.test.ts server/tars/smistamento.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/tars/stores.ts server/tars/tools.ts server/tars/prompt.ts server/routers/tars.ts server/tars/tars.test.ts server/tars/smistamento.test.ts
git commit -m "feat(tars): propose email attachment filing"
```

### Task 4: Esecuzione approvata e postcondizione di dominio

**Files:**
- Modify: `server/tars/esecutore.ts`
- Modify: `server/tars/tars.test.ts`
- Modify: `server/routers/mail.channels.test.ts`

**Interfaces:**
- Consumes: payload `archivia_allegato` della Task 3.
- Produces: esito contenente `documentoId`, `commessaId`, nome e tipo; retry restituisce lo stesso documento.

- [ ] **Step 1: Scrivere il test end-to-end rosso**

Scenario: email non collegata, proposta approvata, collegamento creato, allegato riletto dal canale, documento `misure` presente in `byCommessa`, `byId` restituisce gli stessi byte, seconda approvazione/retry non crea una seconda riga.

- [ ] **Step 2: Verificare il fallimento**

Run: `pnpm exec vitest run server/tars/tars.test.ts server/routers/mail.channels.test.ts`

Expected: FAIL perché l'esecutore non gestisce `archivia_allegato`.

- [ ] **Step 3: Implementare il case dell'esecutore**

L'ordine obbligatorio e: ricaricare proposta e comunicazione; verificare sede/commessa; verificare indice, nome e MIME; collegare la comunicazione se necessario; rileggere i byte con l'helper raw del canale; chiamare `archiviaAllegatoComunicazione`; rileggere il documento e verificarne `commessaId`, `tipo`, `storageKey` o fallback legacy. Un fallimento non deve creare righe documento parziali.

- [ ] **Step 4: Verificare i test verdi**

Run: `pnpm exec vitest run server/tars/tars.test.ts server/routers/mail.channels.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/tars/esecutore.ts server/tars/tars.test.ts server/routers/mail.channels.test.ts
git commit -m "feat(tars): file approved email documents"
```

### Task 5: Card proposta e gerarchia della pagina Email

**Files:**
- Modify: `client/src/components/TarsPropostaCard.tsx`
- Modify: `client/src/components/messaggi/EmailMessageReader.tsx`
- Modify: `client/src/components/messaggi/EmailMessageList.tsx`
- Modify: `client/src/pages/messaggi/EmailPage.tsx`
- Modify: `client/src/lib/messaggi.ts`

**Interfaces:**
- Consumes: proposta `archivia_allegato` e documento restituito dall'approvazione.
- Produces: card con file, tipo, commessa, evidenze, Approva/Rifiuta e stato esecuzione.

- [ ] **Step 1: Aggiornare i tipi client e il rendering della card**

Mostrare `Archivia nelle misure esecutive`, nome file, commessa scelta e confidenza. Dopo successo mostrare `Apri commessa` usando `/commesse/<id>`; non aggiungere un secondo flusso di download dalla proposta.

- [ ] **Step 2: Riordinare il lettore**

Ordine DOM: intestazione mittente/destinatario/data e collegamento; oggetto; corpo completo; allegati; proposte Tars; campo istruzione Tars. Il corpo deve essere visibile senza attraversare il pannello Tars.

- [ ] **Step 3: Migliorare la lista**

Portare l'anteprima del corpo a due righe con `line-clamp-2`; mantenere altezza stabile; distinguere non letta, selezionata e gestita usando token semantici; mostrare badge testuali `Allegati N`, `Collegata`, `Tars`.

- [ ] **Step 4: Rendere responsive il master-detail**

Desktop conserva due colonne con `minmax(18rem,0.9fr) minmax(0,1.6fr)`. A 390x844 mostra una sola vista per volta con comando indietro da 40 px minimo. Aggiungere `min-w-0`, `overflow-wrap:anywhere` al corpo e allegati senza introdurre larghezze minime globali.

- [ ] **Step 5: Verificare il client**

Run: `pnpm check && pnpm build`

Expected: entrambi con exit code 0.

- [ ] **Step 6: QA browser**

Avviare `pnpm dev`, aprire `/messaggi/email` a 1440x900 e 390x844, selezionare una mail lunga con allegato e verificare: corpo subito visibile, nessun overflow orizzontale, card approvabile, allegato archiviato apribile e scaricabile dalla commessa, console senza errori.

- [ ] **Step 7: Commit**

```bash
git add client/src/components/TarsPropostaCard.tsx client/src/components/messaggi/EmailMessageReader.tsx client/src/components/messaggi/EmailMessageList.tsx client/src/pages/messaggi/EmailPage.tsx client/src/lib/messaggi.ts
git commit -m "feat(email): surface Tars document actions"
```

### Task 6: Documentazione e verifica completa

**Files:**
- Modify: `PRD.md`
- Modify: `handoff.md`
- Modify: `docs/superpowers/specs/2026-08-25-tars-email-documenti-design.md`

**Interfaces:**
- Produces: contratto operativo e runbook aggiornati al codice distribuito.

- [ ] **Step 1: Aggiornare PRD e handoff**

Documentare proposta `archivia_allegato`, approvazione obbligatoria, chiave idempotente, tipi documento, match ambiguo, ordine della pagina Email e procedure di verifica produzione.

- [ ] **Step 2: Eseguire la suite completa**

Run: `pnpm check && pnpm test && pnpm build`

Expected: tre exit code 0 e nessun test saltato per il nuovo flusso.

- [ ] **Step 3: Controllare il diff**

Run: `git diff --check && git status --short`

Expected: nessun errore whitespace; solo file previsti.

- [ ] **Step 4: Commit**

```bash
git add PRD.md handoff.md docs/superpowers/specs/2026-08-25-tars-email-documenti-design.md
git commit -m "docs: document Tars email filing"
```
