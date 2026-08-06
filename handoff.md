# Handoff — Ruffino Ops (`infissi-ops-app`)

> Documento di passaggio di consegne. Scritto per essere letto **a freddo**:
> chi lo apre non ha visto le sessioni precedenti.

**Aggiornato:** 06/08/2026 · **Ultimo commit:** `a37de9e`
**Produzione:** https://crm-ruffinogroup.up.railway.app
**Repo:** `main` → Railway effettua il deploy automatico a ogni push.

---

## 0. Che cos'è

Gestionale per **Ruffino Group**, azienda di infissi e serramenti di Sarzana
(La Spezia). Copre il ciclo completo di una commessa: dal preventivo alla
posa, al saldo, al post-vendita. È in uso reale su dati veri — non è un
prototipo. Ogni modifica tocca il lavoro quotidiano dell'ufficio.

**Utente principale:** Timothy Ruffino (direzione). Parla italiano, si aspetta
risposte in italiano.

---

## 1. Stack e architettura

### Stack

| Livello | Tecnologie |
|---|---|
| Frontend | React 19, Vite, **Wouter** (routing), tRPC v10 + React Query, Tailwind v4, shadcn/ui, lucide-react, sonner (toast) |
| Backend | Node + Express + tRPC v10, zod per la validazione |
| Persistenza | Postgres (Railway) — tabella unica `kv_store`, una riga JSONB per raccolta |
| PDF | jsPDF + jspdf-autotable (client **e** server) |

### Persistenza — il punto meno ovvio

Non c'è un ORM con tabelle per entità. C'è `server/_core/persistence.ts` che
espone `persistedStore<T>(key, onLoad)`:

- ogni raccolta è **un array in memoria** + **una riga JSONB** in `kv_store`
- `save()` è debounciato a 200 ms, con retry e backoff
- `bootstrapAll()` carica tutto all'avvio; `onLoad` è il posto dove si fanno
  i **backfill** dei campi nuovi sui record esistenti
- `getAllStoreSnapshots()` serve al backup notturno

**Conseguenza pratica:** aggiungere un campo significa (a) aggiungerlo allo
schema zod, (b) fare il backfill in `onLoad`, (c) non serve migrazione SQL.

**Conseguenza sgradevole:** ogni `save()` riscrive l'intero blob della
raccolta. È il motivo per cui i documenti in base64 sono un problema (§4.1).

Chiavi esistenti:

```
anomalie · aperture · backup_config · backup_log · backup_oauth
calendar_tokens · clienti · commesse · external_calendars · fic_config
fornitori · fornitori_listini · fornitori_ordini · garanzie · interventi
magazzino_prodotti · notifiche_read · preventivi_documenti
produzione_distinte · produzione_fasi · produzione_nc · reclami
rifacimenti · sedi · squadre · ticket_allegati · tickets · timeline_steps
utenti · verbali
```

### Multi-sede (invariante di sicurezza)

Ogni entità porta `sedeId`. Ogni `list` filtra su `ctx.sedeId`; ogni mutation
su un record esistente passa da `assertSedeScope(record, ctx.sedeId)`, che
lancia **NOT_FOUND** (mai FORBIDDEN) su mismatch — altrimenti la risposta
diventerebbe un oracolo per scoprire id di altre sedi.

### Ruoli

`direzione`, `amministrazione`, `commerciale`, `tecnico_rilievi`,
`squadra_posa`, `post_vendita`, `ordini`. Un utente ne ha 1–3 in `ruoli[]`.

- `protectedProcedure` — autenticato
- `adminProcedure` — `role === "admin"`
- `requireDirezione`, `requireDirezioneOAmministrazione`,
  `requireOwnershipOrDirezione` in `server/_core/permissions.ts`
- lato client: `isDirezione()` / `hasRuolo()` in `client/src/lib/roles.ts`,
  e il wrapper `<RequireDirezione>` per le rotte

---

## 2. Mappa del codice

### Server (`server/`)

```
_core/
  index.ts             Express + montaggio tRPC + rotte non-tRPC
                       (/api/ics/:token/:feed, /api/oauth/gdrive/callback)
  persistence.ts       persistedStore, bootstrapAll, kv_store
  permissions.ts       assertSedeScope, requireDirezione, …
  trpc.ts              protectedProcedure, adminProcedure
  driveBackup.ts       backup notturno su Google Drive (OAuth utente)
  fileStorage.ts       driver local | s3 (SigV4 a mano, zero dipendenze)
  fileStorageMigrate.ts  migrazione base64 → storage, con guardie
  margine.ts           calcolaMargine (funzione pura)
  notification.ts      motore notifiche
routers/
  commesse.ts          il file centrale (~1000 righe)
  clienti.ts  ticket.ts  interventi.ts  magazzino.ts  timeline.ts
  preventiviContratti.ts (documenti)  ticketAllegati.ts
  fornitori.ts  squadre.ts  garanzie.ts  produzione.ts  verbali.ts
  anomalie.ts  aperture.ts  reclamiRifacimenti.ts  utenti.ts  sedi.ts
  notifiche.ts  calendarSync.ts  externalCalendars.ts  backup.ts
  fattureInCloud.ts  fileStorageAdmin.ts
```

### Client (`client/src/`)

```
pages/     Dashboard  ClientiList  ClienteDetail  CommesseList  CommessaDetail
           KanbanBoard  Planning  Magazzino  Pagamenti  Marginalita
           ReclamiRifacimenti (contiene TicketList)  TicketList
           SquadreList  FornitoriList  Produzione  GaranzieList  Archivio
           UtentiList  SediList  Integrazioni  Preventivatori(+2)
components/ DashboardLayout (sidebar)  TimelineOrdine  StatoChip
            SearchSelect  ConfirmDialog  FilePreviewDialog
            NotificheDropdown  SedeSwitcher  WhatsAppButton
            RequireDirezione  ui/ (shadcn)
lib/       euro.ts (parse+format importi)  prodotti.ts (tipologie)
           stato.ts  roles.ts  name.ts  whatsapp.ts  trpc.ts
```

### File più importanti da conoscere

| File | Perché |
|---|---|
| `server/routers/commesse.ts` | macchina a stati, pagamenti, costi, prodotti, margine |
| `client/src/pages/CommessaDetail.tsx` | ~2900 righe: header, doc-gate, PagamentiCard, EconomiaCard, SquadraPosaCard, timeline, tab |
| `client/src/lib/euro.ts` | **tutti** gli importi passano da qui |
| `server/_core/persistence.ts` | come vivono i dati |

---

## 3. Modello dati — i concetti che servono

### Commessa

Campi salienti (`server/routers/commesse.ts`):

```ts
{
  id, sedeId, codice,              // "COM-2026-149", progressivo per anno
  clienteId, cliente,              // cliente = nome denormalizzato "Cognome Nome"
  indirizzo, citta, telefono, email,
  stato,                           // vedi macchina a stati
  priorita,                        // bassa | media | alta | urgente
  dataApertura,                    // "YYYY-MM-DD", mostrata come "Creata il"
  consegnaIndicativa,              // "30" | "60" | "90"
  dataConsegnaIndicativa, dataConsegnaConfermata, dataChiusura,
  importoTotale,                   // pattuito
  importoIncassato,                // DERIVATO: somma di pagamenti[]
  pagamenti: [                     // registro acconti
    { id, importo, data, metodo, tipo, note, createdAt }
  ],                               // tipo: acconto_1..5 | saldo
  costi: [                         // registro costi fornitore (per il margine)
    { id, importo, fornitore, descrizione, data, numeroOrdine, note }
  ],
  costoPosaStimato,                // manuale, direzione/amministrazione
  prodotti: [                      // di cosa si tratta
    { id, nome, tipologia, quantita, dimensioni, note }
  ],                               // nome = tipologia da lib/prodotti.ts
  squadraId,                       // squadra di posa
  assegnatoA, createdBy,
  archivedAt,                      // soft-archive, ortogonale a stato
}
```

**`commesse.list` non restituisce `prodotti` né `pagamenti`** (payload
pesante). Restituisce invece `prodottiSintesi: [{nome, quantita}]` e
`nPagamenti: number`. Se serve altro in lista, va aggiunto lì.

### Macchina a stati (11 stati)

```
preventivo → misure_esecutive → aggiornamento_contratto → fatture_pagamento
→ da_ordinare → produzione → ordini_ultimazione → attesa_posa
→ finiture_saldo → interventi_regolazioni → archiviata
```

Solo transizioni **adiacenti** (avanti e indietro). Ogni stato ha un
**doc-gate**: per avanzare serve un documento del tipo giusto caricato
*mentre* la commessa era in quello stato (`REQUIRED_DOC_TIPI_PER_STATO` in
`preventiviContratti.ts`). `force: true` salta il doc-gate ma **mai** la
macchina a stati.

### Timeline ordine — 18 step

Separata dallo stato. `timeline_steps`, uno per commessa per step:

```
1 Rilievo Misure · 2 Firma Contratto · 3 Fatturazione
4 Invio Fattura al Cliente · 5 Pagamento 1° Acconto Cliente
6 Ordine Merce al Fornitore · 7 Conferma Ordine Fornitore
8 Pagamento Acconto Fornitore · 9 Data Spedizione Prevista Fornitore
10 Pagamento Merce Pronta Fornitore · 11 Pagamento Secondo Acconto Cliente
12 Data Consegna Merce · 13 Appuntamento Posa · 14 Lista Merce Posata
15 DDT Posa · 16 Finiture · 17 Pagamento Ultimo Cliente (Saldo)
18 Recensione del Cliente
```

Ogni step: `stato (da_fare|in_corso|completato)`, `dataCompletamento`,
`utente`, `note`, `allegato`. Le **note** sono post-it ambra ed è lì che è
finita la migrazione da Microsoft To Do. Un passo può avere una **data
programmata senza essere completato** (bottone "Salva data") — nato per
l'Appuntamento Posa.

### Ticket post-vendita

```ts
{ id, sedeId,
  commessaId,        // NULLABLE — un ticket può non avere commessa
  clienteId,         // alternativa: cliente senza commessa
  contatto,          // alternativa: testo libero "Sig. Verdi 340…"
  oggetto, descrizione, categoria, priorita,
  stato,             // aperto → assegnato → in_lavorazione → chiuso
  solleciti: [{ data, nota, utenteId }],
  esitoIntervento, dataRisoluzione, apertoBy }
```

Lo stato **`risolto` è stato ritirato** (tra risolto e chiuso non cambiava
niente): il backfill converte i vecchi, e `updateStato` accetta ancora il
valore legacy piegandolo su `chiuso`.

---

## 4. Prossimi passi, in ordine di urgenza

### 4.1 — Attivare lo storage documenti ⚠️ **il più urgente**

**Stato oggi:** 81 documenti per **~103 MB** vivono in base64 dentro la
JSONB di `preventivi_documenti`. Il driver in produzione è ancora `local`, e
su Railway senza volume il filesystem è effimero: `putFile` **rifiuta**
apposta e i nuovi upload ricadono sul base64 inline. Nulla si perde, ma ogni
upload riscrive ~103 MB.

Il layer è scritto, testato e in produzione dal commit `0c02958`. Manca solo
la configurazione.

**Procedura:**

1. Cloudflare → R2 → bucket `ruffino-crm-files` + API token (Object Read & Write).
   Costo ~€0,015/GB/mese.
2. Railway → variabili d'ambiente:
   ```
   STORAGE_DRIVER=s3
   S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
   S3_BUCKET=ruffino-crm-files
   S3_ACCESS_KEY_ID=…
   S3_SECRET_ACCESS_KEY=…
   S3_REGION=auto
   ```
3. Backup Drive manuale — la migrazione **si rifiuta di partire** senza un
   backup riuscito nelle ultime 24 h (controlla `backup_log`).
4. Dry-run, poi apply:
   ```bash
   npx tsx scripts/migrate-documents-to-storage.ts
   npx tsx scripts/migrate-documents-to-storage.ts --apply
   ```
   In alternativa dalla UI: procedure `fileStorage.status` e
   `fileStorage.migrate` (direzione).

**Come funziona la migrazione:** per ogni documento scrive su storage,
**rilegge**, confronta lo sha256, e **solo allora** rimuove il base64.
Idempotente e riprendibile: chi ha già `storageKey` viene saltato.

### 4.2 — Riempire i dati sullo storico

Funzioni pronte ma quasi vuote. Non è lavoro da codice: è una decisione.

| Campo | Copertura | Cosa resta muto |
|---|---|---|
| `importoTotale` | 39/147 | Pagamenti e Marginalità coprono un quarto del lavoro |
| `prodotti` | 22/147 | colonna Prodotti vuota |
| `squadraId` | 2/147 | chip squadra sul board |
| `costi[]` | pochissime | il margine resta "dati incompleti" |

Da decidere: riempimento a mano, import da Fatture in Cloud, o solo sulle
commesse nuove.

### 4.3 — Fatture in Cloud: completare OAuth

La sincronizzazione clienti gira in *token mode* (`fattureInCloud.ts`,
poller ogni 6 h). Manca il flusso OAuth: authorize → refresh token → card v2
in Impostazioni.

Credenziali già emesse dal cliente: **App ID 21541**, Client ID
`46YmsOEc2PqxzQaluXRbvV9kShqkTl8E`. Il secret è stato comunicato in chat: va
messo nelle variabili Railway, **mai** nel repo.

### 4.4 — Fase 0.3 del piano AI: scadenzario passivo + vista cassa

Speculare al registro acconti. Su `fornitori_ordini` aggiungere:

```ts
scadenze: [{ id, tipo: 'acconto'|'merce_pronta'|'saldo'|'altro',
             importo, dataPrevista, note }]
pagamenti: [{ id, importo, data, metodo, note, createdAt }]
```

`importoPagato` ricalcolato server-side, mai scritto dal client — stessa
regola di `importoIncassato`.

Poi la pagina `/cassa`: griglia a 12 settimane, entrate attese (residui
clienti) vs uscite dovute (scadenze fornitore), saldo cumulato, settimane
negative in rosso.

Con il Concordato Preventivo Biennale in corso è la vista che manca di più
alla direzione. Riferimento: `Piano_AI_Ruffino_Ops_v1.md` §0.3, prompt
**P0.3**.

### 4.5 — Antenore (Wnd / Oknoplast)

I due fornitori principali usano un CRM di terze parti (**Antenore**). È
stata inviata una mail agli sviluppatori per capire se espone API.
**In attesa di risposta.** Al riscontro si valuta il connettore.

### 4.6 — Fasi 1–4 del piano AI

Non iniziate. Prerequisiti: §4.1 completata (lo storage deve reggere gli
allegati delle email in arrivo) e `pgvector` installato.

- **Fase 1** — ingestione email Gmail (sola lettura), classificazione con
  Haiku, raccolta `comunicazioni`, coda `azioni_suggerite`, pagina `/inbox`
- **Fase 2** — WhatsApp Cloud API (coexistence), template approvati Meta
- **Fase 3** — brief giornaliero alle 06:30 con Sonnet, notifiche v3
- **Fase 4** — ricerca semantica (pgvector + Voyage embeddings), "Chiedi a Ops"

Principio non negoziabile del piano: **l'AI propone, non esegue**. Ogni
azione passa dalle stesse mutation tRPC che userebbe un umano, dopo
approvazione.

Documenti: `Piano_AI_Ruffino_Ops_v1.md` e `Prompt_Library_Ruffino_Ops_v1.md`
(in `~/Downloads/files/`, **non nel repo** — vanno copiati dentro se si
procede).

---

## 5. Come si lavora su questo repo

### Ciclo standard

```bash
npx tsc --noEmit && npx vite build
```

Poi **verifica in preview** prima di committare:

1. `preview_start` con `{name: "Dev Server (Express + Vite)"}`
2. login via API: `auth.login` con `admin@ruffinogroup.it`
3. seed dei dati di prova via chiamate tRPC
4. screenshot / ispezione DOM
5. **cancella i dati di prova**
6. `preview_stop`, commit, push

Il dev server **non** va avviato con Bash: si usa `preview_start`.

### Chiamate tRPC dal browser (per i test)

```js
const post = (path, input) => fetch('/api/trpc/' + path + '?batch=1', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ "0": { json: input } }),
}).then(r => r.json()).then(j => j?.[0]?.result?.data?.json ?? j?.[0]?.error?.json?.message);

const get = (p, i) => fetch('/api/trpc/' + p + '?batch=1&input=' +
  encodeURIComponent(JSON.stringify({ "0": { json: i } })))
  .then(x => x.json()).then(j => j?.[0]?.result?.data?.json);
```

### Operazioni sui dati di produzione

Script Python con cookie jar contro `/api/trpc/<proc>?batch=1`. **Sempre**
una scansione read-only prima di ogni scrittura, e un riepilogo dopo.

```python
import json, urllib.request, urllib.parse, http.cookiejar
BASE = "https://crm-ruffinogroup.up.railway.app"
cj = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
# auth.login → poi le altre chiamate riusano il cookie
```

Login: `admin@ruffinogroup.it`. La password è stata comunicata in chat, non
è nel repo.

### Trappole note (ognuna è costata tempo)

| Trappola | Cosa succede | Cosa fare |
|---|---|---|
| **`overflow-x-auto` sulle tabelle** | rompe gli header `sticky top-[52px]` | su mobile **nascondere le colonne** (`hidden md:table-cell`), mai avvolgere |
| **Pannello di anteprima nascosto** | `document.hidden = true`: animazioni CSS ferme, eventi sintetici su Radix (Select/Tabs/Dropdown) non si committano, i dialog restano montati e `body{pointer-events:none}` sembra "appiccicato" | **non è un bug dell'app**: pilota `onValueChange` dal fiber React per verificare la logica |
| **`tsx watch` riavvia** | senza `DATABASE_URL` locale i dati in memoria spariscono | riseminare dopo ogni modifica al server |
| **`commesse.list` è filtrata** | niente `prodotti`/`pagamenti` | usare `prodottiSintesi` / `nPagamenti`, o aggiungere quel che serve |
| **Invalidazione delle query** | modificare i prodotti invalidava solo `byId` → la lista restava vecchia | invalidare **tutte** le query che mostrano il dato (`byId` + `list` + `margine` + `marginalita`) |
| **ESM/CJS di jspdf-autotable** | `autoTable is not a function` lato server | `(autoTableImport as any)?.default ?? autoTableImport` |
| **Iterazione di `Set`** | TS2802 | `Array.from(...)` |

### Convenzioni da non rompere

- **`importoIncassato` è derivato** dalla somma di `pagamenti[]`. Non è nello
  schema di `commesse.update` e non deve tornarci.
- **Importi**: solo `formatEuro` / `formatEuroSimbolo`; input solo con
  `parseEuro*`. Mai `parseFloat` a mano — è così che nacque l'errore ×100.
- **Nome cliente**: "Cognome Nome". Per i non privati si usa la sola
  **Ragione sociale**, salvata in `cognome` con `nome = " "`.
- **Tipologie prodotto**: `client/src/lib/prodotti.ts` deve restare allineato
  a `TIPOLOGIE_PRODOTTO` in `server/routers/commesse.ts`.
- **Firma WhatsApp**: `Ruffino Group — tel. 0187 872687` (`lib/whatsapp.ts`).
- **Errori** in italiano, leggibili. Gli errori "marker" usano un prefisso
  maiuscolo con due punti (es. `DOC_GATE_BLOCKED:`) che il client intercetta.

---

## 6. Integrazioni e configurazione

Nel repo **non ci sono segreti**: stanno nelle variabili Railway e in `.env`
locale (gitignored, come `data/` e `backups/`).

| Integrazione | Stato | Note |
|---|---|---|
| **Backup Drive** | ✅ attivo | ogni notte 00:00 Europe/Rome, cartella "Backup CRM Ruffino" (id `1SiZT-p2ADXn_QH6nTyrB-eRqyDlWsoFU`), account `archivioruffinogroup@gmail.com`. Struttura ad albero per cliente/commessa + scheda PDF generata server-side |
| **Google OAuth** | ✅ | `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET`. Callback: `/api/oauth/gdrive/callback`. Il refresh token è specchiato in `data/backup-oauth.json` (mode 600) perché senza `DATABASE_URL` locale andrebbe perso a ogni riavvio |
| **Service account Google** | ❌ inutilizzabile | un account **Google One personale** non accetta upload da service account (403 "Service Accounts do not have storage quota"). Da qui la scelta OAuth utente |
| **Google Calendar** | ✅ | import degli eventi nel calendario del CRM |
| **Storage documenti** | ⚠️ `local` | **da portare a `s3`** — §4.1 |
| **Fatture in Cloud** | ⚠️ token mode | OAuth da completare — §4.3 |
| **WhatsApp** | ✅ deep link `wa.me` | l'API Cloud è Fase 2 del piano AI |
| **Railway** | — | `app.set("trust proxy", 1)` è necessario, altrimenti i redirect OAuth in https si rompono |

---

## 7. Cronologia recente

Ultimi commit, dal più recente:

```
a37de9e docs: handoff …
f617f93 style(importi): one euro format everywhere — 1.234,56
151f6fd feat(commesse): show the opening date
1742fbf feat(clienti): declare products when opening a commessa from the client
269bdff refactor(commesse): call them Prodotti, editable on existing commesse too
5eb6a3b feat(commesse): declare the work at creation, show it in the list
51bc170 fix(pagamenti): amount parsing, residuo aggregation, derived incassato
d3a05b6 feat(post-vendita): open a ticket without a commessa
b694a94 feat(squadre): surface the posa teams and assign one per commessa
4339e66 feat(post-vendita): search the ticket queue
599a41d fix(post-vendita): make tickets deletable again
2506c0c feat(post-vendita): rebuild the ticket card around the client
1f05a34 feat(post-vendita): solleciti, interventi dal ticket, stati snelliti
00a6b89 fix(margine): costo posa reverted on blur — stale margine cache
e11fc50 feat(margine): register supplier costs directly on the commessa
4b11204 fix(storage): refuse ephemeral local puts on Railway
0c02958 feat(p0): file storage layer + margine per commessa
9d63096 docs(prd): v4.1
23c4a58 feat(mobile): responsive headers + list tables
```

### Bug corretti che vale la pena ricordare

| Bug | Dove | Perché contava |
|---|---|---|
| `1500.50` → **150050** | parser importi | errore ×100 salvato in silenzio. Il punto decimale è ciò che quasi tutti digitano sul tastierino |
| "Da incassare" mascherava i sovrapagamenti | KPI Pagamenti | `max(0, Σtot − Σinc)` sugli aggregati: una commessa incassata in eccesso cancellava il debito di un'altra (4.000 invece di 5.000) |
| `importoIncassato` scrivibile | `commesse.update` | 99.999 con registro vuoto |
| Ticket con commessa cancellata indistruttibile | `ticket.delete` | `requireOwnershipOrDirezione(null)` lancia NOT_FOUND prima di verificare il ruolo |
| Costo posa che tornava indietro al blur | card Economia | invalidava `byId` ma non `margine` |
| Notifiche mute sui ticket senza commessa | `notifiche.ts` | `if (!cm) continue` scartava i ticket volanti |

### Migrazioni dati già eseguite in produzione

- **Clienti 2026** da export Fatture in Cloud (con validazione del codice
  fiscale per separare nome e cognome)
- **Microsoft To Do** → commesse, stati e note in timeline (7 liste PDF)
- **Note "Finiture"** → 22 ticket post-vendita
- **Unione doppioni** clienti e ticket

---

## 8. Documenti collegati

| File | Contenuto |
|---|---|
| `documento_requisiti_infissi_ops.md` | **PRD** — la specifica funzionale completa. Aggiornato alla v4.2 |
| `PRD_infissi_ops_v4.pdf` | stessa cosa in PDF, rigenerabile con `bash scripts/build-prd-pdf.sh` |
| `CLAUDE.md` | istruzioni per l'agente |
| `guida_pubblicazione.md` | deploy |
| `todo.md` | note sparse |
| `Piano_AI_Ruffino_Ops_v1.md` | piano in 5 fasi per lo strato AI (fuori repo) |
| `Prompt_Library_Ruffino_Ops_v1.md` | prompt di implementazione + runtime (fuori repo) |

---

## 9. Se riprendi da qui

Ordine consigliato:

1. Leggi questo file e il **PRD** (§ Parte II per le funzioni recenti).
2. `git log --oneline -25` per il contesto degli ultimi lavori.
3. Se devi toccare le commesse: apri `server/routers/commesse.ts` e
   `client/src/pages/CommessaDetail.tsx`.
4. Prima di qualunque modifica: `npx tsc --noEmit && npx vite build`.
5. Chiedi a Timothy quale delle voci di §4 ha la precedenza — la §4.1 è
   tecnica e bloccante, la §4.2 è una sua decisione, la §4.4 è quella che gli
   serve di più come strumento.
