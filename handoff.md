# Handoff — Ruffino Ops (infissi-ops-app)

**Aggiornato:** 06/08/2026
**Ultimo commit:** `f617f93` — *style(importi): one euro format everywhere*
**Produzione:** https://crm-ruffinogroup.up.railway.app (Railway, deploy automatico da `main`)

---

## 1. Stato attuale

### Dati in produzione (rilevati il 06/08/2026)

| Cosa | Quantità | Nota |
|---|---:|---|
| Clienti | 185 | migrati da Fatture in Cloud 2026 + inserimenti manuali |
| Commesse attive | 147 | |
| — con totale pattuito | 39 / 147 | il resto non alimenta Pagamenti né Marginalità |
| — con prodotti dichiarati | 22 / 147 | campo nuovo, va riempito sullo storico |
| — con squadra di posa | 2 | campo nuovo |
| Ticket post-vendita | 24 | 22 dalla migrazione To Do + aperti a mano |
| Squadre di posa | 7 | |
| Documenti caricati | 81 (~103 MB) | **tutti ancora inline in JSONB** — vedi §3.1 |

### Cosa è stato fatto nell'ultimo ciclo

Dal commit `73aa2d8` in poi, in ordine:

- **Pagamenti**: pagina cassa di sede, registro acconti con date e metodi,
  modifica in riga, tipo rata (1°–5° acconto / saldo).
- **Marginalità** (Fase 0.2 del piano AI): `margine = pattuito − costi
  fornitore − costo posa`. I costi si registrano **dentro la commessa**
  (card Economia), non più dagli ordini fornitore.
- **Storage documenti** (Fase 0.1): layer con driver `local` e `s3`
  (R2-compatibile, SigV4 senza dipendenze). Scritto e testato, **non ancora
  attivato in produzione**.
- **Post-vendita** rifatto: card centrata sul cliente, ricerca, solleciti,
  interventi pianificabili dal ticket, stati snelliti (`risolto` ritirato),
  ticket apribili **senza commessa**.
- **Squadre di posa**: visibili in sidebar, assegnabili alla commessa.
- **Commesse**: prodotti dichiarabili alla creazione (anche dalla scheda
  cliente) e modificabili dopo, colonna in lista, data di apertura visibile.
- **Mobile**: header che impilano, colonne nascoste progressivamente.
- **Formato importi**: `formatEuro` unico — `1.234,56` sempre con due
  decimali e separatore di migliaia.

### Bug corretti che vale la pena ricordare

| Bug | Dove | Perché contava |
|---|---|---|
| `1500.50` → **150050** | parser importi | errore ×100 salvato senza avviso |
| "Da incassare" mascherava i sovrapagamenti | KPI Pagamenti | mostrava 4.000 invece di 5.000 |
| `importoIncassato` scrivibile a mano | `commesse.update` | scollegava il totale dal registro |
| Ticket con commessa cancellata non eliminabile | `ticket.delete` | `requireOwnershipOrDirezione(null)` lanciava NOT_FOUND |
| Costo posa che tornava indietro al blur | card Economia | invalidava `byId` ma non `margine` |

---

## 2. Come si lavora su questo repo

```bash
npx tsc --noEmit && npx vite build
```

- **Verifica sempre in preview** prima di committare: seed dei dati via API
  tRPC, screenshot, poi **cancella i dati di prova**.
- Il pannello di anteprima gira con `document.hidden = true`: le animazioni
  CSS non partono e gli eventi sintetici su Radix (Select, Tabs, Dropdown)
  spesso non si committano. Non scambiarlo per un bug dell'app — pilota
  `onValueChange` dal fiber React per verificare la logica.
- **Mai** avvolgere una tabella in `overflow-x-auto`: rompe gli header
  `sticky` (regressione già occorsa). Su mobile si nascondono le colonne.
- Operazioni su dati di produzione: script Python con cookie jar contro
  `/api/trpc/<proc>?batch=1`, login `admin@ruffinogroup.it`. Scansione
  read-only **prima** di ogni scrittura.

---

## 3. Prossimi passi

### 3.1 — Attivare lo storage documenti (bloccante, il più urgente)

**Il problema oggi:** 81 documenti per ~103 MB vivono in base64 dentro la
JSONB di `preventivi_documenti`. Ogni upload riscrive l'intero blob. Il
driver in produzione è ancora `local`, e su Railway senza volume il
filesystem è effimero — per questo `putFile` rifiuta e i nuovi upload
ricadono sul base64 inline (comportamento pre-esistente, nulla si perde,
ma il problema non si risolve da solo).

**Serve un bucket R2** (~€0,015/GB/mese):

1. Cloudflare → R2 → bucket `ruffino-crm-files` + API token (Object Read & Write)
2. Railway → variabili:
   ```
   STORAGE_DRIVER=s3
   S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
   S3_BUCKET=ruffino-crm-files
   S3_ACCESS_KEY_ID=…
   S3_SECRET_ACCESS_KEY=…
   ```
3. Backup manuale su Drive (la migrazione **rifiuta** di partire senza un
   backup riuscito nelle ultime 24h)
4. Dry-run, poi apply:
   ```bash
   npx tsx scripts/migrate-documents-to-storage.ts
   npx tsx scripts/migrate-documents-to-storage.ts --apply
   ```
   Oppure da UI: procedure `fileStorage.status` / `fileStorage.migrate`
   (direzione). Il ciclo è: scrivi → rileggi → verifica checksum → **solo
   allora** rimuovi l'inline. Idempotente e riprendibile.

### 3.2 — Fatture in Cloud: OAuth

La sincronizzazione clienti gira in *token mode*. Manca il flusso OAuth
completo (authorize + refresh token + card v2 in Impostazioni). Credenziali
già emesse dal cliente: App ID **21541**, Client ID
`46YmsOEc2PqxzQaluXRbvV9kShqkTl8E` (il secret è nelle note della sessione,
va messo tra le variabili Railway, non nel repo).

### 3.3 — Fase 0.3 del piano AI: scadenzario passivo e vista cassa

Speculare al registro acconti: su `fornitori_ordini` aggiungere `scadenze[]`
e `pagamenti[]`, poi la pagina `/cassa` con griglia a 12 settimane (entrate
attese vs uscite dovute, saldo cumulato, settimane negative in rosso).
Con il Concordato Preventivo Biennale in corso è la vista che manca di più
alla direzione.

Riferimento: `Piano_AI_Ruffino_Ops_v1.md` §0.3 e prompt **P0.3**.

### 3.4 — Completare i dati sullo storico

Funzioni pronte ma poco popolate:

- **108 commesse su 147 senza totale pattuito** → Pagamenti e Marginalità
  raccontano solo un quarto del lavoro.
- **125 senza prodotti dichiarati** → la colonna Prodotti resta vuota.
- **145 senza squadra di posa**.

Non è lavoro da codice: va deciso se riempirlo a mano, con un import, o solo
sulle commesse aperte da qui in avanti.

### 3.5 — Antenore (Wnd / Oknoplast)

Mail inviata agli sviluppatori per capire se il loro CRM espone API.
**In attesa di risposta.** Al riscontro si valuta il connettore.

### 3.6 — PRD da riallineare

`documento_requisiti_infissi_ops.md` è fermo alla **v4.1** (commit
`9d63096`). Da allora non sono documentati: storage documenti, marginalità e
registro costi, post-vendita v2 (solleciti, ticket senza commessa, ricerca),
squadre di posa sulla commessa, prodotti, data di apertura, formato importi.

Rigenerare il PDF dopo l'aggiornamento:
```bash
bash scripts/build-prd-pdf.sh
```

### 3.7 — Fasi 1–4 del piano AI

Non iniziate. Prerequisito: §3.1 completata (lo storage regge gli allegati
delle email) e `pgvector` installato. Vedi `Piano_AI_Ruffino_Ops_v1.md`.

---

## 4. Configurazione e segreti

Nel repo **non ci sono segreti**: stanno nelle variabili Railway e in `.env`
locale (gitignored).

| Cosa | Dove | Stato |
|---|---|---|
| Backup notturno Drive | 00:00 Europe/Rome, cartella "Backup CRM Ruffino" | attivo, OAuth su `archivioruffinogroup@gmail.com` |
| Google OAuth (Drive) | `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` | configurato |
| Service account Google | — | **inutilizzabile**: un account Google One personale non accetta upload da service account (403 quota). Si usa OAuth utente |
| Storage documenti | `STORAGE_DRIVER` | `local` → **da portare a `s3`**, §3.1 |
| Fatture in Cloud | token mode | OAuth da fare, §3.2 |
| WhatsApp | deep link `wa.me` | firma: `Ruffino Group — tel. 0187 872687` |

---

## 5. Convenzioni da non rompere

- **Multi-sede**: ogni entità porta `sedeId`; ogni `list` filtra su
  `ctx.sedeId`, ogni mutation passa da `assertSedeScope` (404, mai leak).
- **`importoIncassato` è derivato** dalla somma di `pagamenti[]`. Non
  scriverlo mai direttamente.
- **Nome cliente**: convenzione "Cognome Nome". Per i non privati si usa la
  sola **Ragione sociale**, salvata in `cognome` con `nome = " "`.
- **Importi**: solo `formatEuro` / `formatEuroSimbolo` da `lib/euro.ts`.
  Il parsing degli input passa da `parseEuro*` — mai `parseFloat` a mano.
- **Tipologie prodotto**: `lib/prodotti.ts` lato client deve restare
  allineato a `TIPOLOGIE_PRODOTTO` in `server/routers/commesse.ts`.
