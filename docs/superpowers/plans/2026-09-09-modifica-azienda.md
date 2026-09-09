# «Modifica azienda» dal pannello piattaforma — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dal pannello piattaforma (WS6) si correggono i dati di un'azienda dopo la creazione: ragione sociale, slug, note; dati di fatturazione (P.IVA, codice fiscale, sede legale, email amministrativa, PEC, codice SDI); prima sede (nome, città); proprietario (nome, cognome, email, telefono) con reinvio dell'invito se l'email cambia prima dell'accettazione.

**Architecture:** due comandi nuovi di `tenant_comandi` (`modifica_tenant`, `modifica_proprietario`) eseguiti dallo stesso `eseguiComando` e accodati+eseguiti subito dal router `piattaforma` (pattern del WS6, `eseguiComandoSubito`); colonne additive su `tenants` per i dati di fatturazione e le note; il reinvio dell'invito resta nel router (servizio `invitaProprietario`, come `crea`). Client: dialogo «Modifica» nella scheda con quattro sezioni e la conferma della password.

**Tech Stack:** TypeScript strict, tRPC 11 + zod, postgres-js, `persistedStore`, React 19 + shadcn, vitest.

**Spec:** decisione della direzione in chat il 09/09/2026 (sera): «devo poter modificare le aziende una volta create» → perimetro «Tutto: dati, fatturazione, sede, proprietario». Registrare la decisione come §15 della spec WS6 `docs/superpowers/specs/2026-09-09-ws6-pannello-piattaforma-design.md` nel Task 5. Vincoli ereditati: spec WS6 §3 (accesso e conferma password), §5.2 (accoda ed esegui subito), §9 (audit), `CLAUDE.md` (control plane scritto solo dal repository; comandi solo dal servizio; token mai a terra).

## Global Constraints

- Branch `feature/modifica-azienda` da `main`; un commit per task, messaggi in italiano, ultima riga `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; mai merge/rebase/checkout/switch/pull/reset/stash nel worktree condiviso.
- `tenants`/`tenant_*` scritte SOLO da `server/tenants/repository.ts` (guardia `confine.test.ts`); nessun campo zod `tenantId`/`tenant` (si usa `slug`); ogni cambio passa da `server/tenants/servizio.ts`; ogni store per tenant letto/scritto dentro `conTenant(tenantId, …)`.
- Le mutation del pannello: `assicuraScrivibile()` → `confermaPassword` → payload validato con gli schemi di `server/tenants/comandi.ts` → `accodaComando(richiestoDa: piattaforma:<email>)` → `eseguiComandoSubito` → `{ comando }` (stessi helper del WS6, `server/piattaforma/router.ts`).
- Slug: `SLUG_RE`, unico; il tenant 1 non cambia slug (`ruffino-group` è nel codice: `TENANT_PREDEFINITO_SLUG`); cambiando lo slug il client naviga alla nuova scheda.
- Email del proprietario unica su tutta l'installazione (`creaUtenteInterno` lo pretende già: stessa regola nell'aggiornamento).
- Dati di fatturazione: campi facoltativi, nessuna validazione fiscale oltre forma e lunghezza (P.IVA 11 cifre o vuota; codice SDI 7 caratteri o vuoto; email valida o vuota); mai nei log.
- Eventi: `tenant_modificato` (`dettagli: { campi: [{ campo, prima, dopo }] }`, senza dati sensibili oltre ai valori stessi — non ci sono segreti), `proprietario_modificato` (`{ utenteId, campi }`), `slug_cambiato` (`{ da, a }`).
- `pnpm check`, `pnpm test`, `pnpm build` verdi a ogni task; pg con `--no-file-parallelism`.

---

### Task 1: Control plane — colonne di fatturazione e `aggiornaTenant`

**Files:** `server/tenants/tipi.ts`, `server/tenants/repository.ts`, `server/tenants/repository.test.ts`, `server/tenants/repository.pg.test.ts`.

- `tipi.ts`: `export type DatiFatturazione = { partitaIva: string | null; codiceFiscale: string | null; indirizzoLegale: string | null; emailAmministrativa: string | null; pec: string | null; codiceSdi: string | null }`; `TenantRecord` gains `fatturazione: DatiFatturazione` (tutti null di default) e `note: string | null`; `TipoEvento` += `"tenant_modificato" | "proprietario_modificato" | "slug_cambiato"`; `TipoComando` += `"modifica_tenant" | "modifica_proprietario"`.
- `repository.ts`: DDL additiva in `creaSchema` (`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS partita_iva TEXT, codice_fiscale TEXT, indirizzo_legale TEXT, email_amministrativa TEXT, pec TEXT, codice_sdi TEXT, note TEXT`); `rigaTenant` legge le colonne; CHECK di `tenant_comandi.tipo` allargato con la guardia `pg_constraint` (stesso blocco che oggi cerca `imposta_abbonamento`: cercare `modifica_proprietario`); metodo nuovo `aggiornaTenant(id: number, campi: { nome?: string; slug?: string; note?: string | null; fatturazione?: Partial<DatiFatturazione> }): Promise<TenantRecord>` (pg: UPDATE con `updated_at = NOW()`, slug unico → errore «Slug già usato»; memoria idem; cache aggiornata; `perSlug` risponde col nuovo slug).
- Test (memoria + pg): aggiorna nome/note/fatturazione; slug cambiato → `perSlug(vecchio)` null e `perSlug(nuovo)` ok; slug duplicato rifiutato; colonne assenti su una tabella vecchia → aggiunte al boot (pg).

### Task 2: Comandi e servizio — `modifica_tenant`, `modifica_proprietario`

**Files:** `server/tenants/comandi.ts`, `server/tenants/servizio.ts`, `server/tenants/servizio.test.ts`, `server/tenants/costanti.ts` (messaggi), `scripts/tenant.ts` (sottocomando `modifica`, parità).

- `comandi.ts`: `schemaPayloadModificaTenant = z.object({ slug, nome?: testo(120), nuovoSlug?: slug, note?: z.string().trim().max(2000).nullable(), fatturazione?: z.object({ partitaIva: z.string().regex(/^\d{11}$/).nullable(), codiceFiscale: z.string().trim().min(11).max(16).nullable(), indirizzoLegale: z.string().trim().max(200).nullable(), emailAmministrativa: z.string().trim().email().nullable(), pec: z.string().trim().email().nullable(), codiceSdi: z.string().trim().length(7).nullable() }).partial(), sede?: z.object({ id: z.number().int().positive(), nome: testo(120), citta: z.string().trim().max(80).nullable() }) })` e `schemaPayloadModificaProprietario = z.object({ slug, utenteId?: number, nome: testo(80), cognome: testo(80), email: email, telefono?: nullable })`.
- `servizio.ts`: `modificaTenant(tenantId, input, attore)` → `repo.aggiornaTenant` + evento `tenant_modificato` (solo i campi davvero cambiati) + `slug_cambiato` se lo slug cambia (tenant 1: rifiuta il cambio slug con `MESSAGGI.tenant1SlugIntoccabile`); `sede` → dentro `conTenant`, la sede deve appartenere al tenant (altrimenti `NOT_FOUND`), aggiorna `nome`/`citta`/`updatedAt` e salva lo store `sedi`; `modificaProprietario(tenantId, input, attore)` → dentro `conTenant`, l'utente deve essere del tenant e avere il ruolo `proprietario` (se `utenteId` manca e c'è un solo proprietario, quello), email unica sull'installazione (case-insensitive), aggiorna `nome/cognome/email/telefono/updatedAt`, salva `utenti`, evento `proprietario_modificato`; ritorna `{ utenteId, emailCambiata: boolean }`.
- `eseguiComando`: due `case` nuovi. `scripts/tenant.ts`: `pnpm tenant modifica --slug=… [--nome=…] [--nuovo-slug=…] [--piva=…] [--cf=…] [--sede-legale=…] [--email-amministrativa=…] [--pec=…] [--sdi=…] [--note=…] [--scrivi] [--attendi]` (una riga nell'uso in testa al file).
- Test: ogni ramo (campi cambiati, slug duplicato, tenant 1, sede di un altro tenant → NOT_FOUND, email già usata, proprietario ambiguo, evento con i campi).

### Task 3: Router `piattaforma` — `modifica` e `modificaProprietario`

**Files:** `server/piattaforma/router.ts`, `server/piattaforma/letture.ts`, `server/piattaforma/router.test.ts`.

- `letture.ts`: `SchedaAzienda` espone `fatturazione`, `note` e per la sede predefinita `{ id, nome, citta }`; per i proprietari anche `telefono` e `invitoInSospeso`.
- `router.ts`: `modifica: piattaformaProcedure.input(conPassword({ …campi di schemaPayloadModificaTenant senza slug… , slug }))` → `modifica_tenant` accodato ed eseguito subito; risposta `{ comando, slug: <slug finale> }`; `modificaProprietario: conPassword({ slug, utenteId?, nome, cognome, email, telefono? })` → `modifica_proprietario`; se `esito.emailCambiata` e l'azienda ha un invito valido (`repo.invitiDi`), annulla e reinvia con `invitaProprietario` (attore piattaforma, `baseUrlDa(ctx.req)`) e risponde `{ comando, invito }` (link solo se la posta non è partita, come in `crea`).
- Test: password sbagliata → niente comando; slug cambiato → `azienda({ slug: nuovo })` risponde e il vecchio dà NOT_FOUND; fatturazione salvata; proprietario con email nuova e invito pendente → vecchio invito annullato, nuovo emesso, evento; tenant 1 slug intoccabile.

### Task 4: Client — dialogo «Modifica azienda»

**Files:** `client/src/pages/piattaforma/AziendaDetail.tsx`, `client/src/pages/piattaforma/ModificaAziendaDialog.tsx` (nuovo), `client/src/pages/piattaforma/testi.ts` (+test).

- `PageHeader` della scheda: `secondaryActions` += «Modifica». Dialogo con quattro sezioni (tab o `<details>` aperti): **Azienda** (ragione sociale, slug con avviso «cambia l'indirizzo della scheda e il riferimento della riga di comando», note), **Fatturazione** (i sei campi), **Sede** (nome, città), **Proprietario** (nome, cognome, email, telefono; se l'invito è ancora in sospeso: «cambiando l'email l'invito riparte al nuovo indirizzo»); un solo pulsante «Salva» con la password (`ConfermaPassword`): manda `modifica` e, se i campi del proprietario sono cambiati, `modificaProprietario`; esiti con toast; se lo slug cambia → `setLocation(`/piattaforma/${slug}`)`; invalidazione di `azienda` e `aziende`.
- La scheda mostra fatturazione (sezione «Dati di fatturazione», valori o «—») e note.
- Verifica a 1440×900 e 390×844 con il montaggio a link finto dei task 8/9 del WS6 (screenshot).
- Testi puri in `testi.ts` (etichette dei campi di fatturazione, avviso slug) con test.

### Task 5: Documenti

**Files:** `docs/superpowers/specs/2026-09-09-ws6-pannello-piattaforma-design.md` (§15 «Modifica azienda», decisione 09/09 e cosa fa), `docs/runbooks/multi-azienda.md` (sezione WS6: «Modificare un'azienda» con i comandi e gli eventi; il sottocomando `modifica`), `documento_requisiti_infissi_ops.md` (§60.13 addendum + voce in `## 33` con numero nuovo), `handoff.md` (una riga nelle Novità), `CLAUDE.md` (nessun invariante nuovo: i due comandi rientrano in quelli esistenti).
- Numeri di verifica reali dopo `pnpm check`, `pnpm test`, `pnpm build`, pg.
