# Documento Requisiti — Ruffino Flow (PRD)

**Stato:** Documento vivente, riallineato allo stato corrente dell'applicazione (26/08/2026).
**Versione:** 4.31 - Autorità FiC su rate e storni, correzioni Tars e PDF idempotenti.
**Riferimento implementativo:** repository `infissi-ops-app`. Il presente PRD descrive il comportamento atteso del software così come è implementato; ogni divergenza riscontrata nel codice va trattata come bug.

---

## 0. Convenzioni del documento
- **MUST / DEVE** — requisito obbligatorio.
- **SHOULD / DOVREBBE** — requisito fortemente consigliato.
- **MAY / PUÒ** — opzione facoltativa.
- Gli identificatori `in_questo_stile` sono valori interni (enum, chiavi di database). Le etichette UI in italiano sono indicate fra virgolette.
- I numeri di sezione sono stabili; le sotto‑sezioni possono crescere.

---

## 1. Visione del prodotto
**Ruffino Flow** è lo strumento operativo centrale di **Ruffino Immobiliare S.R.L.** Collega ufficio, laboratorio di produzione e cantiere, accompagnando ogni cliente dalla prima richiesta fino alla garanzia post‑vendita. Non è un semplice database: è un assistente proattivo che ricorda le scadenze, blocca i passaggi di stato senza i documenti richiesti, unifica le comunicazioni e affianca gli operatori con proposte Tars sempre verificabili.

Pilastri:
1. **Una commessa = un percorso tracciato.** Stato, documenti, interventi, anomalie e firme convivono in un unico fascicolo.
2. **Niente dato perso.** Le commesse rifiutate dal cliente vengono **archiviate**, non cancellate; in qualsiasi momento si possono ripristinare con stato e file invariati.
3. **Sicurezza by default.** Autenticazione obbligatoria su ogni endpoint; password hashate; gate documentale lato server.
4. **Operatività prima dell'eleganza.** Pagine come Calendario e Board mostrano in faccia all'utente le informazioni che gli servono (nome, cognome, indirizzo lavoro, telefono cliccabile).

---

## 2. Architettura tecnica (sintesi)
- **Frontend.** React 19 + Vite 7 + Wouter (routing) + tRPC 11 (client) + React Query (caching) + Tailwind 4 + shadcn/ui + lucide-react + sonner (toast) + jsPDF/jspdf‑autotable. Le pagine sono caricate per rotta con `React.lazy`; i vendor sono separati per React, UI, dati e grafici.
- **Backend.** Node + Express + tRPC 11. Persistenza prevalente in `kv_store` (Postgres JSONB) tramite `persistedStore`, con save debounciato, retry su errori transienti e recovery in background. Le Comunicazioni usano una tabella PostgreSQL dedicata.
- **Autenticazione.** Locale via email/password con JWT firmato (jose, HS256, TTL 7 giorni) + cookie httpOnly. Sessione server‑side cacheata in memoria con eviction periodica.
- **Sicurezza.** Tutti gli endpoint business sono `protectedProcedure` (utente loggato obbligatorio); le mutazioni su `utenti` e l'intero router `backup`/`fattureInCloud` sono `adminProcedure` (ruolo direzione). Header `X‑Content‑Type‑Options`, `X‑Frame‑Options=SAMEORIGIN`, `Referrer‑Policy`, HSTS in produzione. Upload con allowlist mimeType + validazione reale del payload base64. CSRF same‑origin check su `/api/trpc`. `trust proxy` abilitato (deploy dietro Railway).
- **Worker e scheduler interni.** Backup notturno Google Drive (00:00 Europe/Rome, `setTimeout` ri-armato), sync Fatture in Cloud (ogni 6 h quando abilitato), audit processi Tars (controllo ogni 6 h, massimo un run per sede ogni circa 24 h), verifica esperimenti Tars (ogni 60 min, primo giro dopo circa 2 min), promemoria personali (giro immediato e poi ogni 15 s), watcher IMAP (ogni 60 s), recupero code Tars (ogni 60 s, primo controllo circa 5 s dopo il bootstrap) e riconciliazione Centro Azioni (ogni 60 s, debounce 750 ms, primo giro circa 5 s dopo il bootstrap).
- **PDF.** jsPDF + jspdf‑autotable sia client‑side (preventivatori, scheda cliente) sia server‑side (scheda cliente nel backup).
- **Storage file.** Driver `local` o S3‑compatible/R2. I record conservano `storageKey` + checksum SHA‑256; `dataBase64` resta supportato per i record legacy e come fallback in scrittura. Cap per‑file 10 MB.
- **Agente AI.** Tars usa OpenAI Responses API con function calling, strumenti read-only e proposte persistite. Ogni modifica richiede approvazione umana e passa dalle mutation applicative (§50).

---

## 3. Autenticazione e sicurezza

### 3.1 Login
- Schermata `LoginPage` con email + password.
- Login solo per utenti `attivo === true`.
- Confronto password tramite `verifyPassword` (scrypt) — accetta anche password legacy in chiaro durante una migrazione trasparente.
- **Rate limit per email**: dopo 5 tentativi falliti in 15 minuti l'account è bloccato fino allo scadere della finestra. Login riuscito → reset del contatore.
- Messaggio di errore generico ("Email o password non validi") per non rivelare se l'utente esiste.

### 3.2 Sessione
- JWT firmato HS256, claim: `sub` (id utente), `email`, `name`, `role`, `ruolo`, `ruoli`. Esp. 7 giorni.
- Cookie `httpOnly`, `secure` su HTTPS, `sameSite` `none` su https / `lax` su http locale.
- Cache server‑side `Map<token, { user, expMs }>` con eviction lazy e sweep orario (`setInterval(...).unref()`).
- **Logout** cancella sia il cookie sia l'entry della cache server.

### 3.3 Hashing password
- Algoritmo: **scrypt** (modulo `crypto` di Node, nessuna dipendenza esterna).
- Formato di archiviazione: `scrypt$<saltHex>$<hashHex>` (salt 16 byte, key 64 byte).
- `verifyPassword` è constant‑time tramite `timingSafeEqual`.
- Le password create/aggiornate dalla UI sono sempre hashate.
- Le password nuove devono avere almeno 12 caratteri.
- Le password legacy in chiaro residue nel DB vengono **automaticamente upgradate a hash al primo boot successivo** all'aggiornamento (vedi `utenti.onLoad`).
- Su store utenti vuoto viene creato un solo amministratore da `BOOTSTRAP_ADMIN_*`; in produzione `BOOTSTRAP_ADMIN_PASSWORD` è obbligatoria. Non esistono più password seed fisse nel codice corrente.

### 3.4 Segreto JWT
- In **produzione** la variabile d'ambiente `JWT_SECRET` è OBBLIGATORIA: in sua assenza il server fa throw all'avvio.
- In dev/test, in mancanza di `JWT_SECRET`, viene usato un fallback hard‑coded; **non valido per produzione**.

### 3.5 Header di sicurezza
Su ogni risposta HTTP:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-DNS-Prefetch-Control: off`
- `X-Permitted-Cross-Domain-Policies: none`
- In produzione: `Strict-Transport-Security: max-age=15552000; includeSubDomains`
- CSP **non** impostata di default (richiede tuning con Vite + Maps proxy + blob preview) — tracciata come follow‑up.

### 3.6 Esposizione API
- Endpoint tRPC montati su `/api/trpc`.
- Tutti i router business utilizzano `protectedProcedure`. Le sole eccezioni pubbliche sono: `auth.me`, `auth.login`, `auth.logout`, `system.health`.
- `utenti.create`, `utenti.update`, `utenti.delete` richiedono `adminProcedure` (= ruolo `direzione`).

### 3.7 Protezioni aggiuntive (v4)
- **Hash versionato.** Formato `scrypt$<N>$<saltHex>$<hashHex>` con `N=32768`; verifica retro‑compatibile con il legacy `scrypt$salt$hash` (N=16384) e con password in chiaro (upgrade automatico al boot).
- **CSRF.** Su `/api/trpc` le richieste con header `Origin` diverso dall'`Host` vengono rifiutate (403). Richieste server‑to‑server senza Origin ammesse.
- **SSRF guard (calendari esterni).** Gli URL iCal inseriti dagli operatori sono validati (solo https; vietati localhost/`.local`/`.internal`/IP privati RFC1918/link‑local/IPv6 raw) sia all'inserimento sia a ogni fetch.
- **Segreti mascherati in UI.** Gli indirizzi iCal privati (bearer secret) e i token Fatture in Cloud sono ritornati mascherati dalle list/status API.
- **Isolamento sede.** Ogni query/mutation è vincolata alla sede attiva (`ctx.sedeId`); guardie `assertSedeScope` su tutte le entità (vedi §34).

### 3.8 Operatività residua a carico del titolare (non risolvibile via codice)
- Rotazione manuale delle vecchie password seed eventualmente ancora attive e revoca dei token GitHub non riconosciuti.
- Decisione e finestra coordinata per pulire lo storico Git (BFG / `git filter-repo` + force‑push). Il codice corrente non contiene più password seed fisse, ma la cronologia resta immutata.

---

## 4. Ruoli, permessi e gating

### 4.1 Set di ruoli
- `direzione` — ammessi accesso completo + gestione utenti + sezioni gated (Squadre, Garanzie, Fornitori, Produzione, Utenti, Integrazioni avanzate).
- `amministrazione` — focus su fatturazione, finiture, saldo.
- `commerciale` — gestione clienti e commesse commerciali.
- `tecnico_rilievi` — rilievi e misure.
- `squadra_posa` — esecuzione in cantiere.
- `post_vendita` — ticket, reclami, rifacimenti.
- `ordini` — ordini fornitori.

Ogni utente ha `ruoli: string[]` (1–3 valori). Il campo legacy `ruolo` continua a contenere il ruolo primario per retro‑compatibilità.

### 4.2 Mapping `role` legacy
- `role = "admin"` quando in `ruoli` è presente `direzione`. Altrimenti `user`.

### 4.3 Gating
- **Lato server.** `protectedProcedure` su tutto il business; `adminProcedure` su mutazioni `utenti` e `system.notifyOwner`.
- **Lato client.** Componente `RequireDirezione` su rotte `Garanzie`, `Squadre`, `Fornitori`, `Produzione`, `Utenti`. Le voci di sidebar corrispondenti sono filtrate con il flag `direzioneOnly`.

---

## 5. Anagrafica Cliente

### 5.1 Tipi cliente
`privato | azienda | condominio | ente_pubblico`. Icone in UI: `User`, `Building2`, `Home`, `Landmark`.

### 5.2 Campi del Cliente
Anagrafica:
- **Tipo** (vedi 5.1; default `privato`) — è il **primo campo del form**: la sua scelta cambia i campi successivi.
- Se `tipo === "privato"`: **Cognome** e **Nome** (entrambi obbligatori).
- Se `tipo ∈ {azienda, condominio, ente_pubblico}`: un solo campo **Ragione sociale** (obbligatorio), archiviato nel campo `cognome`; `nome` viene valorizzato a spazio singolo. Stessa convenzione usata dalla sincronizzazione Fatture in Cloud (§40) e dalla migrazione 2026 (§43), così le denominazioni restano indivise.
- **Codice fiscale**, **partita IVA**.

Doppio indirizzo:
- **Indirizzo di residenza** (`indirizzo`, `citta`, `cap`) — usato dall'amministrazione per la fatturazione. Per i clienti non privati l'etichetta diventa **«Sede legale (fatturazione)»** ovunque: form di creazione/modifica, badge nella scheda cliente e scheda PDF (§42).
- **Indirizzo dei lavori** (`indirizzoLavoro`, `cittaLavoro`, `capLavoro`) — usato dalle commesse per cantiere, calendario, mappe.
- In fase di creazione/modifica il form propone uno **switch "stesso della residenza"** che copia automaticamente i campi residenza → lavoro al salvataggio.
- La scheda cliente espone entrambi gli indirizzi con badge distintivo "Residenza" / "Lavoro".

Contatti: **telefono**, **email**.

Dati fiscali e amministrativi:
- **Detrazione** (switch). Quando attivata RICHIEDE `tipoDetrazione`.
- **Tipo detrazione**: `ecobonus | ristrutturazione` (obbligatorio se `detrazione === true`).
- **Finanziamento** (switch).
- **Pratica edilizia**: `nessuna | cil | cila | scia`.

Referenti (lista multipla):
- Campi per referente: nome, ruolo (`cliente_finale | architetto | direttore_lavori | amministratore | altro`), telefono, email.

Operativi:
- **Note** libere.
- **Assegnato a** (utente). Default: utente corrente; eredita su nuove commesse linkate al cliente.

### 5.3 Comportamenti del Cliente
- Lista clienti con ricerca testuale, filtro per tipo, filtro "solo le mie".
- Scheda cliente con tabs: **Commesse**, **Interventi**, **Ticket**, **Garanzie** — ognuno ha un pulsante **+** per creare l'entità collegata.
- **Cascade su update.** Modificando nome/cognome o un campo di contatto/indirizzo del cliente, il server propaga il valore a tutte le commesse linkate (solo dove il valore della commessa coincideva con il valore precedente del cliente, così le override manuali non vengono sovrascritte).
- Eliminazione cliente disponibile (con conferma) ma SCONSIGLIATA in presenza di commesse linkate.
- **Scheda PDF** stampabile dall'header (vedi §42) e bottone **WhatsApp** accanto al telefono (vedi §41).
- Ogni cliente appartiene a una sede (`sedeId`, vedi §34).

---

## 6. Commesse

### 6.1 Identificazione
- **Codice automatico** `COM-{ANNO}-{N}` con N progressivo a 3 cifre (es. `COM-2026-001`).
- Lo ZeroPadding è coerente per anno; al cambio anno il contatore può ripartire da 1.

### 6.2 Campi
- **clienteId** (FK), **cliente** (display name denormalizzato, sincronizzato da cliente.update).
- **indirizzo**, **citta**, **telefono**, **email** — inizialmente derivati dall'`indirizzoLavoro` del cliente; sovrascrivibili a livello di commessa.
- **stato** — vedi 7.1.
- **priorita**: `bassa | media | alta | urgente`.
- **squadraId** (FK opzionale).
- **dataApertura** (auto).
- **consegnaIndicativa**: enum `"30" | "60" | "90"` (giorni dal preventivo).
- **dataConsegnaIndicativa**: data libera ISO. **Mutuamente esclusiva** con `consegnaIndicativa`: salvando una delle due l'altra viene azzerata.
- **dataConsegnaConfermata**: data definitiva impostata al passaggio in `produzione`.
- **dataChiusura**: impostata automaticamente al passaggio in `archiviata` (chiusura del flusso).
- **note** libere.
- **importoTotale**: totale pattuito (€, opzionale). **importoIncassato**: derivato — somma del registro `pagamenti` (vedi §37); non modificabile direttamente dalla UI.
- **pagamenti**: registro acconti embedded (vedi §37). Escluso da `commesse.list` come `prodotti`.
- **sedeId**: sede proprietaria (vedi §34).
- **prodotti**: array di prodotti della commessa (nome, tipologia/materiale, quantità, dimensioni, note) — *di cosa si tratta*, vedi §44. NON viene incluso nella risposta di `commesse.list` per alleggerire i payload; viene ritornato da `commesse.byId`. La lista riceve invece la sintesi `prodottiSintesi: [{nome, quantita}]`.
- **costi**: registro dei costi fornitore embedded, base del calcolo del margine (vedi §45).
- **costoPosaStimato**: stima manuale del costo di posa (€, opzionale). Scrivibile solo da direzione o amministrazione.
- **squadraId**: squadra di posa assegnata alla commessa (vedi §46).
- **dataApertura**: data di creazione in formato `YYYY-MM-DD`, mostrata come "Creata il" nella scheda e in colonna nella lista.
- **assegnatoA** (FK utente). Modificabile dalla scheda commessa.
- **createdBy** (FK utente).
- **createdAt**, **updatedAt**.
- **archivedAt**: timestamp ISO; `null` finché la commessa non è in soft‑archive (vedi §22).

### 6.3 Consegna indicativa — selezione
La UI offre quattro opzioni nel select **Consegna indicativa**:
1. `+30 giorni`
2. `+60 giorni` *(default)*
3. `+90 giorni`
4. **Data da calendario…** → mostra un date picker, popola `dataConsegnaIndicativa` e svuota `consegnaIndicativa`.

L'header della commessa mostra in ordine di priorità:
1. `dataConsegnaConfermata` (etichetta "Data consegna prevista").
2. `dataConsegnaIndicativa` (etichetta "Consegna indicativa", formato `gg/mm/aaaa`).
3. `consegnaIndicativa` (etichetta "Consegna indicativa: +N giorni").

### 6.4 Trigger Produzione
Quando una commessa entra nello stato `produzione`:
1. Sulla scheda compare un banner ambra "Commessa in produzione" con il pulsante "Aggiorna data consegna".
2. Al click si apre un dialog con date picker per la **Data di Consegna Prevista** definitiva.
3. Il salvataggio popola `dataConsegnaConfermata` (visibile in header, card Kanban, lista in Dashboard).
4. Finché `dataConsegnaConfermata` è vuota, la card del Kanban resta evidenziata con anello ambra e contatore "Consegne da confermare" nel KPI bar.

### 6.5 Modifica
- Dialog **"Modifica commessa"** consente di modificare contemporaneamente:
  - Anagrafica cliente collegata (nome, cognome, CF, P.IVA, CAP, telefono, email, indirizzo, città) — sincronizzata via `clienti.update` con cascade.
  - Priorità.
  - **Utente assegnato** (SearchSelect sugli utenti, opzione "Non assegnata").
  - Consegna indicativa (preset o data libera).
  - Note.
- Nell'header sono visibili pill: indirizzo, telefono, email, **Assegnata a: Nome** (lookup utente).

### 6.6 Eliminazione vs Archiviazione
- **Archivia** — operazione consigliata se il cliente non procede. Non distrugge nulla (vedi §22).
- **Elimina** — operazione distruttiva. Conferma esplicita. Dovrebbe essere usata solo per errori di inserimento.

### 6.7 Lista commesse
- Filtri: search testuale (codice, cliente, città), stato, clienteId, assegnatoA, scope `archived = exclude | only | all` (default `exclude`).
- Ordinata per `createdAt` desc.
- Risposta **non include** `prodotti` né `pagamenti` (ottimizzazione bandwidth/render). Include però `prodottiSintesi` (nome + quantità per riga) e `nPagamenti` (conteggio degli acconti), che alimentano rispettivamente la colonna Prodotti e la proposta della rata successiva nella pagina Pagamenti.

---

## 7. State machine delle commesse

### 7.1 Stati
Ordine canonico (`STATI_COMMESSA`):
1. `preventivo`
2. `misure_esecutive`
3. `aggiornamento_contratto`
4. `fatture_pagamento`
5. `da_ordinare`
6. `produzione`
7. `ordini_ultimazione` *(richiesta secondo acconto)*
8. `attesa_posa`
9. `finiture_saldo`
10. `interventi_regolazioni`
11. `archiviata` *(chiusura del flusso — distinta dal soft‑archive di §24)*

### 7.2 Transizioni valide
- Transizioni **in avanti** consentite di **una posizione** (es. `da_ordinare → produzione`).
- Transizioni **all'indietro** consentite di **una posizione**.
- Salti multipli **vietati** lato server (`validateTransizione`).
- Stato `archiviata` raggiungibile solo dal predecessore `interventi_regolazioni`.

### 7.3 Soft‑archive (orthogonal)
- `archivedAt` è ortogonale a `stato`. Una commessa può essere soft‑archiviata in qualsiasi stato (vedi §22).
- Il soft‑archive **non** modifica lo stato corrente.

### 7.4 Avanzamento via UI
- **Scheda commessa**: pulsante "Avanza" che propone lo stato successivo. Disabilitato se manca un documento richiesto (vedi §9), eccetto bypass con "Procedi comunque".
- **Board Kanban**: ogni card ha frecce **Indietro** / **Avanza**. Le frecce attraversano sempre la stessa state machine (controlli server identici).
- **Timeline ordine**: completare una milestone operativa avanza automaticamente la commessa nella relativa colonna del Board (§35.2). Salvataggio di data/note e riapertura di uno step non cambiano lo stato della commessa.

### 7.5 Stati e gate documentale (vedi anche §9)
- `preventivo` → necessita `preventivo` o `contratto`.
- `misure_esecutive` → `misure`.
- `aggiornamento_contratto` → `contratto`.
- `fatture_pagamento` → `fattura`.
- `da_ordinare` → `ordine` o `conferma_ordine`.
- `produzione` → nessun documento richiesto (gated da `dataConsegnaConfermata`).
- `ordini_ultimazione` → `saldo` o `fattura`.
- `attesa_posa` → `ddt_consegna`.
- `finiture_saldo` → `ddt_posa`.
- `interventi_regolazioni` → `ddt_finale`.
- `archiviata` → nessun documento richiesto.

---

## 8. Documenti commessa (Preventivi/Contratti)

### 8.1 Tipi documento
`preventivo, contratto, misure, fattura, ordine, conferma_ordine, ddt_consegna, ddt_posa, ddt_finale, saldo, foto, documento_identita, visura, planimetria, certificazione, altro`.

I primi dieci hanno un ruolo nel doc gate (§9). Gli ultimi quattro sono stati
aggiunti il 26/08/2026 perché una commessa raccoglie anche documenti che non
fanno avanzare niente — un documento d'identità, una visura, una planimetria —
e classificarli tutti come `altro` li rendeva indistinguibili al momento di
ritrovarli. L'elenco è unico: `DOC_TIPI` alimenta schema server, dropdown UI e
schema degli strumenti di Tars.

### 8.2 Storage e schema
- Persistito in `preventivi_documenti` (kv_store JSONB).
- Per ogni documento: `id, sedeId, commessaId, nome, tipo, mimeType, size, storageKey?, checksum?, dataBase64?, note, statoAtUpload, createdBy, createdAt`.
- `storageKey` è la fonte canonica dopo la migrazione; `dataBase64` resta per record legacy/fallback. La lista `byCommessa` non restituisce i byte e usa `hasData`; `byId` rilegge dallo storage e ricostruisce il payload atteso dal client.

### 8.3 Upload — controlli
- **MimeType allowlist** (stored XSS hardening):
  - `application/pdf`
  - `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `image/heic`, `image/heif`
  - `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
  - `application/vnd.ms-excel`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
  - **Esclusi esplicitamente** `text/html` e `image/svg+xml`.
- **Dimensione**: validata sul payload reale (lunghezza base64 decodificata, NON il campo `size` lato client). Cap 10 MB.
- Il `size` archiviato è quello calcolato dal server.

### 8.4 Auto‑rename e rinomina
- Se `keepNome === false`, il file in upload viene rinominato in `{Tipo} {cliente}.{ext}` (es. "Misure esecutive Mario Rossi.pdf").
- Se `keepNome === true` (usato dai preventivatori), il nome viene preservato e solo dedupato.
- Dal 26/08/2026 l'auto‑rename **non si applica** ai tipi `documento_identita`, `visura`, `planimetria`, `certificazione`, `foto` e `altro`: di quei documenti una commessa ne contiene più d'uno (intestatario, coniuge, delegato) e schiacciarli sullo stesso nome produceva `(2)` e `(3)` indistinguibili. Conservano il nome originale.
- Disambiguazione automatica: se il nome esiste già per la stessa commessa, viene appeso `(2)`, `(3)`, ecc.
- La scheda commessa espone **Rinomina**: cambia nome libero e tipo di un documento già caricato (`preventiviContratti.update`). Il tipo conta per il doc gate, quindi correggere una classificazione sbagliata non richiede più di ricaricare il file.

### 8.5 Anteprima e download
- Anteprima inline in `<iframe>` per PDF (URL `blob:` derivato dal base64) o in `<img>` con zoom/rotate per immagini.
- Download via `<a download>`.
- Invio email via `mailto:` con corpo precompilato (no upload server‑side dell'allegato).

### 8.6 Eliminazione
- Soft delete NON previsto. La cancellazione è definitiva.

### 8.7 Allegati ticket
- Pattern identico (router `ticketAllegati`), con `storageKey`/checksum e fallback base64, stessa allowlist mime, stesso size check, cap 10 MB.
- Cancellando un ticket si cancellano in cascata i suoi allegati (`deleteAllegatiByTicket`).

---

## 9. Doc gate (gate documentale)

### 9.1 Regola
- Una transizione **in avanti** verifica che esista almeno un documento con uno dei tipi richiesti dallo stato CORRENTE (`REQUIRED_DOC_TIPI_PER_STATO`).
- Conta solo se il documento è stato caricato **mentre la commessa era in quello stato** (campo `statoAtUpload`), così un preventivo non può soddisfare un gate diverso.
- Per i documenti legacy senza `statoAtUpload`, fallback permissivo: il tipo è sufficiente.

### 9.2 Stati daily reminder
Per gli stati `aggiornamento_contratto`, `fatture_pagamento`, `da_ordinare` viene generata anche una notifica giornaliera (vedi §25.2) anche oltre la soglia di priorità.

### 9.3 Bypass "Procedi comunque"
- **Server.** `commesse.update` accetta un flag `force: boolean`. Se assente, il gate è bloccante; in caso di mancanza documenti il server lancia un errore con prefisso `DOC_GATE_BLOCKED:` e messaggio human-readable ("Non è stato caricato il file …. Procedere comunque?").
- **Client (scheda commessa).** Il pulsante "Avanza" non è più disabilitato dal gate. Al click, se il gate è violato, mostra un `ConfirmDialog` non‑destructive con label "Procedi comunque". In conferma chiama `update({ stato, force: true })`.
- **Client (Kanban).** Onerror della mutation: se `err.message` inizia per `DOC_GATE_BLOCKED:`, lo stesso ConfirmDialog viene aperto e su conferma rilancia con `force: true`. Errori non‑gate restano nel banner inline.
- **La state machine resta invariata.** `force` bypassa SOLO il gate documentale, non la shape delle transizioni.

### 9.4 Indicatore UI
Sotto l'header della commessa è presente una card con stato del gate:
- Verde se tutti i documenti richiesti sono presenti.
- Ambra se mancano: lista di tipi richiesti con badge "Caricato"/"Mancante" + bottone "Carica file" che preimposta il tipo nel dialog upload.

---

## 10. Aperture (Rilievo)
- Una **apertura** è un singolo serramento all'interno di una commessa.
- Campi: `commessaId, codice, descrizione, piano, locale, tipologia (finestra | portafinestra | porta | scorrevole | fisso | altro), larghezza, altezza, profondita, materiale, colore, vetro, noteRilievo, criticitaAccesso, stato`.
- Stati apertura: `da_rilevare → rilevata → ordinata → consegnata → in_posa → posata → verificata`.
- Le aperture sono visibili nella scheda commessa e nella vista **RilievoDetail** dedicata.
- Una commessa **può** avere zero aperture (es. preventivo iniziale generico).

---

## 11. Board Kanban (`/kanban`)

### 11.1 Layout
Quattro **fasi**, ognuna con N colonne:

| Fase | Colonne |
|---|---|
| Vendita | Preventivo, Misure Esecutive, Aggiornamento Contratto |
| Ordine & Produzione | Fatture / Pagamento, Da Ordinare, Produzione |
| Consegna & Posa | Richiesta Secondo Acconto, Attesa Posa |
| Chiusura | Finiture / Saldo, Interventi / Regolaz. |

Lo stato `archiviata` non compare.

### 11.2 Card commessa
Mostra: codice, badge priorità, cliente, città, indicatore di consegna (data confermata o indicativa), pulsanti **Indietro** / **Avanza** con etichetta dello stato target. In più (v4):
- **Bordo sinistro 3 px** colorato per priorità (urgente rosso, alta ambra, media blu, bassa grigio).
- **Chip "fermo N gg"** quando la commessa non riceve update da ≥5 giorni (ambra) o ≥10 (rossa).
- **Blocco prodotti magazzino**: primi 2 prodotti con data consegna corta (✓ verde arrivato, rosso in ritardo) + "+N altri prodotti" (vedi §36).
- **Chip "Da saldare € N"** (rossa) nelle fasi `attesa_posa`/`finiture_saldo`/`interventi_regolazioni` quando il residuo pagamenti è > 0 (vedi §37).

### 11.2‑bis Colonne con overflow
Ogni colonna mostra al massimo **5 card**; oltre compare il toggle tratteggiato "Mostra altre N" / "Mostra meno" per non forzare scroll infiniti.

### 11.3 Filtri
- Search per codice/cliente/città.
- Filtro priorità (Tutte/Urgente/Alta/Media/Bassa).
- Toggle "Nascondi vuote" / "Mostra vuote".
- Chip per fase (Tutte le fasi / per singola fase).
- Tutte le fasi possono essere collassate.

### 11.4 KPI bar
Quattro cards: **Attive**, **Urgenti**, **Alte**, **Consegne da confermare** (commesse in `produzione` senza `dataConsegnaConfermata`).

### 11.5 Doc gate sul Kanban
Le frecce **Avanza** seguono lo stesso doc gate. Errore `DOC_GATE_BLOCKED:` → ConfirmDialog "Procedi comunque". Errori non‑gate → banner inline rosso.

### 11.6 Esclusioni
- Le commesse soft‑archiviate non appaiono.

---

## 12. Calendario / Planning (`/planning`)

### 12.1 Viste
- **Mese** *(default)* — griglia 6×7 (la sesta settimana è renderizzata solo se il mese vi sconfina); oggi evidenziato con pill primary; giorni fuori mese e weekend attenuati; chip evento pieni (colore per tipo, testo bianco) con ora + nome cliente; overflow "+N altri" apre la vista giorno.
- **Settimana** — 7 colonne lun–dom; weekend leggermente attenuati.
- **Giorno** — singola colonna.
Ordine switcher: Mese · Settimana · Giorno.

### 12.2 Tipi di intervento
`rilievo, posa, assistenza, altro`. Colori dedicati per tipo.

### 12.3 Card intervento (joined info)
Ogni card mostra:
- Ora inizio – ora fine.
- Tipo intervento.
- **Nome + cognome** del cliente (lookup commessa → cliente).
- **Indirizzo** (fallback `intervento.indirizzo → commessa.indirizzo → cliente.indirizzoLavoro → cliente.indirizzo`).
- Note brevi.
- Stato (`pianificato` di default).

### 12.4 Dialog dettagli appuntamento
In modalità modifica, sopra al form, viene mostrato un blocco di sintesi joined:
- Codice commessa, stato, badge priorità.
- Nome cliente.
- Indirizzo cantiere.
- Telefono (link `tel:`).
- Email (link `mailto:`).
- Squadra assegnata.
- Pulsante "Apri commessa" → naviga alla scheda commessa.

### 12.5 Auto‑fill
Quando si seleziona una commessa in dialog di creazione, l'indirizzo viene auto‑popolato dalla commessa (solo se il campo è vuoto, per non sovrascrivere override manuali).

### 12.6 Drag & drop
- Un intervento può essere trascinato fra giorni nelle viste settimana e mese.
- L'update della data avviene via `interventi.update({ dataPianificata })`.

### 12.7 Stati intervento
`pianificato, in_corso, completato, sospeso, annullato`. L'avvio imposta `dataInizio`; la chiusura imposta `dataFine`. Le entry `annullato` legacy sono **purgate** automaticamente al boot (cleanup nel `persistedStore.onLoad`).

### 12.8 Link entità
Un intervento può essere collegato a una delle entità: `commessa`, `ticket`, `reclamo`, `rifacimento`. Solo `commessa` è obbligatoria quando il `linkKind === "commessa"`.

### 12.9 Eventi Google (overlay read‑only)
Gli eventi importati dai calendari Google (vedi §38.2) compaiono in tutte e tre le viste, ordinati per ora insieme agli appuntamenti CRM ma **in sola lettura**: stile distinto (badge GOOGLE + lucchetto, bordo sinistro nel colore della sorgente), nessun drag/edit/delete. Il click apre un dialog dettagli (data, orario/tutto il giorno, luogo, calendario di origine). Una legenda sopra la griglia elenca le sorgenti attive.

### 12.10 Card intervento (restyle v4)
Chip tipo pieno (POSA/RILIEVO/ASSISTENZA/ALTRO) su sfondo tinta + bordo sinistro 4 px nel colore del tipo; ora in mono grassetto. Nel dialog di modifica, accanto al telefono, è presente il bottone **WhatsApp** con messaggio di conferma appuntamento precompilato (vedi §41).

---

## 13. Ticket post‑vendita (`/ticket` e contenuti di `/reclami`)

### 13.1 Modello
- Campi: `commessaId?, clienteId?, contatto?, aperturaId?, oggetto, descrizione, categoria, priorita, stato, solleciti[], assegnatoA?, dataRisoluzione?, esitoIntervento?, apertoBy?`.
- Categorie: `difetto_prodotto, difetto_posa, regolazione, sostituzione, garanzia, altro`.
- Priorità: come per le commesse.
- `apertoBy` registra l'utente che apre il ticket (usato dai permessi di eliminazione, §13.6).

### 13.2 Ticket senza commessa
Una chiamata di assistenza arriva spesso **prima** che esista una commessa, e a volte prima ancora che il cliente sia a sistema. Perciò **solo l'oggetto è obbligatorio**; l'intestazione del ticket può essere data, in ordine di precisione, da:
1. **commessa** collegata (`commessaId`) — caso classico;
2. **cliente** già in anagrafica (`clienteId`), senza commessa;
3. **contatto** in testo libero (`contatto`), es. "Sig. Verdi 3401234567".

La UI mostra il primo disponibile, con badge "Senza commessa" quando manca, e un grigio "Senza cliente" se non c'è nulla. Il collegamento **può essere fatto in seguito**: il dialog di modifica espone commessa/cliente/contatto, e agganciando una commessa i campi più deboli vengono azzerati per non lasciare tre risposte in conflitto.

### 13.3 State machine ticket
`aperto → assegnato → in_lavorazione → chiuso`. Disponibile **rollback** di una posizione (clear `dataRisoluzione` se si esce da `chiuso`). Da `aperto` il rollback è rifiutato.

Lo stato **`risolto` è stato ritirato** (§13.7): fra risolto e chiuso non cambiava nulla nella pratica. Il backfill al boot converte i record esistenti; `updateStato` accetta ancora il valore legacy dai client vecchi e lo piega su `chiuso`. Stesso collasso applicato ai **reclami** (§14.1).

### 13.4 Solleciti
Registro `solleciti[]` sul ticket: `{ data, nota?, utenteId }`. La procedure `ticket.sollecita` aggiunge una voce; è rifiutata sui ticket chiusi ("riaprilo prima di sollecitare"). In lista compare un badge ambra **"N solleciti · ultimo gg/mm"**, così si vede a colpo d'occhio da quanto un ticket è fermo nonostante i solleciti. Il dialog mostra lo storico completo.

### 13.5 Interventi pianificati dal ticket
Bottone **Pianifica** sul ticket: data, ora inizio/fine, squadra, note. Crea un intervento di tipo `assistenza` già collegato (`ticketId`, `commessaId`, indirizzo ereditato dalla commessa) che appare nel Calendario e sotto il ticket con data, ora, squadra e stato — con **"Senza squadra"** evidenziato in colore warning quando manca.

### 13.6 Eliminazione
Possono eliminare: la **direzione**, **chi ha aperto** il ticket (`apertoBy`), o il **proprietario della commessa** collegata. Se la commessa è stata cancellata si ricade sul solo controllo direzione — diversamente il ticket sarebbe indistruttibile. Cancellando un ticket si cancellano in cascata i suoi allegati.

### 13.7 Ricerca e presentazione
- **Ricerca** su: nome cliente (da commessa o da `clienteId`), codice e città della commessa, oggetto, descrizione, id `TK-000N`, categoria, esito intervento e **note dei solleciti**.
- Il filtro per stato è **lato client** su tutta la lista di sede: i chip riportano i conteggi reali e la ricerca attraversa anche gli stati non selezionati (cercare un cliente non deve fallire perché il suo ticket è chiuso).
- **Card**: nome cliente in grassetto in testa, poi codice commessa (cliccabile) e `TK-000N`, quindi l'oggetto, le etichette, la descrizione in blocco espandibile (spesso è la nota importata da To Do), gli interventi collegati e infine il footer con meta e azioni. Barra colorata a sinistra: rossa se aperto ad alta priorità, verde se chiuso, neutra altrimenti.
- Empty state distinti fra "nessun ticket" e "nessun risultato per «…»", il secondo con azione **Azzera i filtri**.

### 13.8 Allegati ticket
Vedi §8.7.

---

## 14. Reclami e Rifacimenti (`/reclami`)
Pagina unificata che gestisce due entità correlate ma distinte.

### 14.1 Reclamo
- Campi: `commessaId, clienteNome, descrizione, responsabile?, stato, dataApertura, dataRisoluzione?, soluzione?`.
- Stati: `aperto, in_gestione, chiuso` (lo stato `risolto` è ritirato come per i ticket, §13.3; i record esistenti sono convertiti al boot).

### 14.2 Rifacimento
- Campi: `commessaId, clienteNome, descrizione, elemento, fornitoreCoinvolto?, ordineRifacimentoId?, costoStimato?, responsabilita (interna|esterna), responsabile?, stato, dataApertura, dataChiusura?`.
- Stati: `aperto, in_gestione, in_produzione, completato, chiuso`.

---

## 15. Verbali (`/verbale/:interventoId` + `VerbaleChiusura`)
- Tipo: `chiusura_lavori | sopralluogo | consegna` (default `chiusura_lavori`).
- Campi: `interventoId, commessaId, tipo, data, noteCliente?, noteTecnico?, firmaClienteData?, firmaTecnicoData?, firmaCliente, firmaTecnico, apertureCompletate, apertureTotali, anomalieRiscontrate, stato (bozza|firmato)`.
- Lo stato passa a `firmato` quando entrambe le firme sono presenti.

---

## 16. Anomalie
- Campi: `commessaId, aperturaId?, interventoId?, categoria, priorita, descrizione, risoluzione?, stato, segnalataBy?, risoltaBy?, risoltaAt?`.
- Categorie: `materiale_difettoso, misura_errata, danno_trasporto, difetto_posa, problema_accessorio, non_conformita, altro`.
- Priorità: `bassa, media, alta, critica`.
- Stati: `aperta, in_gestione, risolta, chiusa`. Endpoint dedicato `resolve` imposta `stato=risolta`, `risoluzione`, `risoltaAt`.

---

## 17. Garanzie (`/garanzie`, direzione‑only)
- Tipi: `prodotto, posa, accessorio, vetro, altro`.
- Campi: `commessaId, aperturaId?, tipo, descrizione, fornitore?, dataInizio, durataMesi, dataScadenza, stato, documentoRif?, note?`.
- `dataScadenza` calcolata server‑side da `dataInizio + durataMesi`.
- Stati: `attiva, scaduta, sospesa, revocata`.
- Statistiche: totale, attive, in scadenza (entro 90 giorni), scadute.

---

## 18. Squadre (`/squadre`, direzione‑only)
- Campi: `nome, caposquadra?, telefono?, note?, attiva`.
- Le squadre attive appaiono nei dropdown della scheda commessa, dialog intervento, calendario.
- L'inattivazione (toggle `attiva`) preserva storico ma rimuove la squadra dai picker.

---

## 19. Fornitori (`/fornitori`, direzione‑only)

### 19.1 Anagrafica fornitore
- Campi: `ragioneSociale, partitaIva, indirizzo?, citta?, telefono?, email?, categoria, referenteCommerciale?, scontistica?, note?, attivo`.
- Categorie: `pvc, alluminio, vetro, ferramenta, persiane, blindati, accessori, guarnizioni, altro`.

### 19.2 Ordini fornitore
- Campi: `fornitoreId, commessaId, codiceOrdine, stato, dataOrdine, dataConsegnaPrevista?, dataConsegnaEffettiva?, righe[], noteOrdine?, noteRicevimento?, importoTotale`.
- Stati: `bozza, inviato, confermato, in_transito, ricevuto_parziale, ricevuto, contestato`.
- Riga ordine: `descrizione, codiceArticolo?, quantita, quantitaRicevuta, unitaMisura, prezzoUnitario?, lotto?, conforme?, noteDifetto?`.
- L'update di stato accetta `righeAggiornate` per registrare la ricezione parziale.

### 19.3 Listini fornitore
- Campi: `fornitoreId, nome, versione, dataValidita, nomeFile, tipo (pdf|excel|altro), note?`.
- I listini sono solo metadati: il file effettivo viene gestito altrove (cartella condivisa o sezione documenti separata).

---

## 20. Produzione (`/produzione`, direzione‑only)
Tre sotto‑router: `bom` (distinte base), `fasi`, `nc` (non conformità).

### 20.1 Distinte base (BOM)
- Campi: `commessaId, aperturaId, stato, componenti[], noteValidazione?, validataDa?, dataValidazione?`.
- Componenti: `tipo (profilo|vetro|ferramenta|guarnizione|accessorio), descrizione, codiceArticolo?, fornitoreId?, quantita, unitaMisura, lotto?, note?`.
- Stati BOM: `bozza, validata, in_produzione, completata`.
- Validazione consentita solo da `bozza → validata`.

### 20.2 Fasi produzione
- Campi: `commessaId, aperturaId?, distinaBaseId, fase, ordine, stato, operatore?, dataInizio?, dataFine?, checklistItems[], note?`.
- Stati fase: `da_fare, in_corso, completata, non_conforme`.
- Checklist item: `descrizione, obbligatorio, completato, esito? (ok|non_conforme), note?`. Toggle dedicato `toggleChecklist`.
- `dataInizio` impostata su `in_corso`; `dataFine` su `completata`.

### 20.3 Non conformità (NC)
- Campi: `commessaId, aperturaId?, faseProduzioneId?, tipo, gravita, descrizione, azioneCorrettiva?, stato, segnalataDa, dataApertura, dataChiusura?`.
- Tipi: `materiale_difettoso, errore_taglio, errore_assemblaggio, vetro_rotto, ferramenta_errata, altro`.
- Gravità: `lieve, media, grave, bloccante`.
- Stati: `aperta, in_gestione, risolta, chiusa`. La chiusura imposta `dataChiusura`.

---

## 21. Preventivatori (`/preventivatori`)
Pagina hub con cards per azienda. L'accesso è aperto a tutti gli utenti autenticati.

### 21.1 Fivizzanese — Persiane (`/preventivatori/fivizzanese/persiane`)
Calcolo step‑by‑step:
1. **Selezione modello** (catalogo `shared/listini/fivizzanese.ts`).
2. **Dimensioni di ogni persiana** in millimetri (`larghezza × altezza`), convertite in `areaMq`.
3. **Prezzo base** calcolato in €/m² sul totale delle aree.
4. **Supplementi** configurati dal listino: moltiplicati per m² quando `unita = "mq"`, oppure per pezzo quando `unita = "cad"`.
5. **Posa e smontaggio** opzionali secondo i preset del listino.
6. **Promo** quando applicabile:
   - **Promo "RAL 6005 Opaco"**: prezzo aggiornato a **210 €** (precedentemente 200 €).
   - Quando la promo è attiva, viene aggiunto un **ricarico del 50%** sul totale persiane.
7. **IVA** (10% o 22%) — selettore.
8. Output:
   - Riepilogo a video con righe: totale persiane, supplementi, centinatura, ricarico promo, smontaggio, imponibile, IVA, totale lordo.
   - Esportazione **PDF** con jspdf‑autotable; salvataggio automatico come documento `preventivo` sulla commessa (keepNome=true; nome file "Preventivo {cliente} - Fivizzanese.pdf").

### 21.2 Punto del Serramento — Persiane (`/preventivatori/punto-del-serramento/persiane`)
Stesso schema più:
- **Sconto** percentuale modificabile, **max 30%** (clamp server‑side e client‑side).
- **IVA** (10% o 22%) — selettore.
- Output PDF analogo con righe `lordo, sconto, imponibile, IVA, totale`.

---

## 22. Archivio (`/archivio`)

### 22.1 Soft‑archive
- Endpoint `commesse.archive(id)`: imposta `archivedAt = ISO now`.
- Endpoint `commesse.restore(id)`: imposta `archivedAt = null`.
- Lo stato (`stato`) e i collegamenti (file, aperture, interventi, prodotti) **non vengono toccati**. Restore = la commessa torna esattamente com'era.

### 22.2 Visibilità
- Le commesse soft‑archiviate sono escluse da:
  - `commesse.list` (scope default `exclude`).
  - `commesse.stats` e `commesse.byPriorita`.
  - Board Kanban.
  - Dashboard.
  - Notifiche proattive (vedi §27).
- Restano accessibili a `/archivio` (scope `only`) e tramite link diretto `/commesse/:id`.

### 22.3 Pagina Archivio
- Lista con search per codice/cliente/città/indirizzo.
- Per ogni riga: codice, stato originale (badge), priorità, cliente, indirizzo, data apertura, data archiviazione, pulsanti **Ripristina** e **Apri scheda**.
- Conferma esplicita prima del ripristino.

### 22.4 Pulsanti nella scheda commessa
- **Archivia** (se non archiviata) — conferma non‑destructive.
- **Ripristina** (se archiviata).
- Banner di stato "Commessa archiviata" in alto quando applicabile.

---

## 23. Classifica venditori — RIMOSSA (16/07/2026)
La pagina `/classifica`, l'endpoint `commesse.classificaVenditori` e la voce di sidebar sono stati rimossi su richiesta della direzione. La sezione resta come riferimento storico (v3); il ranking commerciali non fa più parte del prodotto.

---

## 24. Utenti (`/utenti`, direzione‑only)

### 24.1 Funzionalità
- Lista utenti con filtro per ruolo + search testuale.
- Creazione, modifica, eliminazione (tutte `adminProcedure`).
- Multi‑ruolo (1–3 ruoli per utente).
- Toggle `attivo/inattivo`.
- Password gestita solo lato server (hashing scrypt, vedi §3.3). Il campo `hasPassword` (bool) è restituito al client al posto del contenuto.

### 24.2 Gating
- Rotta `/utenti` protetta da `<RequireDirezione>`.
- Sidebar mostra la voce **Utenti** solo a utenti `direzione`.

### 24.3 Email
- Univocità email enforced lato server (`utenti.create` rifiuta duplicati case‑insensitive).

---

## 25. Centro Azioni e notifiche — v3

### 25.1 Principio
La campanella non misura tutto ciò che il CRM conosce. In modalità `active`
mostra soltanto eccezioni personali critiche o alte già esigibili; massimo tre
righe nel dropdown e badge visuale `9+`. La coda completa vive in
`/tars?tab=oggi`. Leggere non equivale a gestire: ogni caso possiede stato,
responsabile, scadenza o revisione, evidenze e una sola prossima azione.

### 25.2 Segnali e deduplica
Il motore puro raccoglie aging per priorità, passaggi bottleneck, routing per
ruolo, consegna mancante, saldo residuo, garanzia, ticket e intervento senza
squadra. Segnali della stessa commessa confluiscono in un solo caso canonico;
ticket, garanzie e interventi senza commessa mantengono un caso autonomo. La
priorità più alta non viene mai scartata e le altre cause restano come evidenze.

Le condizioni specifiche usano fingerprint dei fatti che le risolvono: data di
consegna, residuo, stato/priorità ticket, scadenza garanzia, data e squadra
dell'intervento. Un semplice aggiornamento generico non chiude il caso. Commesse
archiviate o soft-archiviate e record di altre sedi sono escluse.

### 25.3 Persistenza e ciclo di vita
PostgreSQL usa `azioni_operative` con chiave unica `(sede_id, canonical_key)` e
`azioni_operative_eventi` append-only. Gli stati sono `da_valutare`,
`in_carico`, `rinviata`, `in_attesa`, `risolta`. Sono disponibili presa in
carico, assegnazione direzione, rinvio, attesa con controparte/motivo/revisione,
chiusura e non rilevante. Un caso scomparso dai segnali viene chiuso
automaticamente; un fingerprint nuovo riapre un risolto o sveglia un rinviato.

### 25.4 Scope e API
La vista personale include casi assegnati all'utente e casi non assegnati
destinati a uno dei suoi ruoli. La vista `Tutta la sede` è riservata alla
direzione. Ogni lookup applica `sedeId`; un id di altra sede restituisce
`NOT_FOUND`. Le API sono `notifiche.summary`, `notifiche.cases.*` e
`notifiche.brief`. Liste e apertura pagina non chiamano OpenAI.

### 25.5 Rollout e fallback
`ACTION_CENTER_MODE` accetta `legacy`, `shadow`, `active` e vale `shadow` se
assente o non valido. In `shadow` il nuovo motore persiste casi e logga soltanto
conteggi aggregati, mentre la campanella conserva `notifiche.list/count` e lo
store `notifiche_read`. In `active` la campanella usa il nuovo summary. Il
fallback legacy resta disponibile finché il confronto produzione non è chiuso.

### 25.6 Promemoria personali Tars
I promemoria sono personali, sede-scoped e visibili soltanto al richiedente.
Alla scadenza il worker crea una notifica persistente di tipo `reminder` e il
CRM aperto mostra un dialog globale, una scadenza per volta. La consegna usa SSE
quando disponibile e polling ogni 15 secondi come fallback; il polling si
sospende in background e riparte al focus.

Il dialog mostra testo e data nel fuso `Europe/Rome` senza troncamenti. Le
azioni sono **Fatto**, **Posticipa** (15 minuti, un'ora, domani alle 09:00 o
data/ora personalizzata), **Apri commessa** quando collegata e chiusura. Chiudere
nasconde il popup ma conserva la notifica; completare, posticipare o annullare
risolve il gruppo notifica. Un errore mantiene il dialog aperto e permette il
retry. Cambio sede e logout azzerano la cache prima di cambiare principal.

---

## 26. Dashboard (`/`)

### 26.1 Header personale
"Ciao {nome} — ecco la tua giornata" + data lunga it‑IT.

### 26.2 "Da fare oggi" — feed azioni personalizzato
- **Scope**: direzione vede tutta la sede (etichetta "Tutta la sede"); gli altri solo le proprie commesse (`assegnatoA`, fallback `createdBy`) — etichetta "Le tue attività".
- Fonti, ordinate per urgenza e cap a 8 voci:
  1. Interventi di **oggi senza squadra** (CTA "Apri calendario").
  2. Commesse **urgenti** / ticket urgenti / garanzie scadute.
  3. **Da incassare € N** — residuo pagamenti nelle fasi finali.
  4. **Consegne da confermare** (CTA "Conferma consegna").
  5. Ticket aperti sulle proprie commesse.
  6. Garanzie in scadenza 30 gg (direzione/amministrazione).
- Stato vuoto esplicito: "Niente da fare per ora …" con icona verde (la card non sparisce).

### 26.3 KPI principali
Cards Commesse attive, Urgenze, Consegne da confermare, Ticket aperti (+ Interventi settimana). Zero = card "spenta" non cliccabile; >0 = accent bar + navigazione alla lista filtrata. Polling live.

### 26.4 Calendario settimanale
Slot 7 giorni con eventi per tipo (filtri per calendario) + navigazione settimana.

---

## 27. Integrazioni esterne (`/integrazioni` = Impostazioni)

La pagina Impostazioni ospita l'hub **Gestione** (direzione‑only: Fornitori, Produzione, Squadre, Garanzie, Preventivatori) e le card integrazioni:

### 27.1 Backup notturno su Google Drive
Vedi §39. Card con stato collegamento, ultimo backup, prossima esecuzione, "Esegui ora", collega/scollega account.

### 27.2 Fatture in Cloud → Clienti
Vedi §40. Card OAuth con stato collegamento, scadenza credenziali, selettore azienda, switch abilitazione, "Sincronizza ora" e disconnessione. Il token manuale mascherato resta dentro un pannello secondario come fallback di emergenza.

### 27.3 Mostra Google nel calendario CRM (import)
Vedi §38.2. Gestione sorgenti: nome + indirizzo iCal segreto (mascherato in lista), colore auto‑assegnato, toggle mostra/nascondi, stato sync, "Aggiorna", istruzioni passo‑passo.

### 27.4 Pubblica il calendario CRM su Google (export)
Vedi §38.1. Elenco feed copiabili (Tutti/Rilievi/Pose/Assistenza/Altro) + "Rigenera token" con avviso di revoca.

### 27.5 Microsoft To Do
Card presente ma **mock** (non ancora collegata a Graph API). Storicamente il flusso operativo viveva su liste To Do; la migrazione del 15/07/2026 (vedi §43) le ha importate nel CRM.

### 27.6 Notifiche owner / Google Maps
Invariati da v3: `system.notifyOwner` (Manus Notification Service, admin‑only) e componente `<Map/>` via proxy interno.

### 27.7 Roadmap: Antenore (Wnd/Oknoplast)
Integrazione richiesta al fornitore (import automatico clienti/preventivi/commesse/ordini creati sul loro CRM). In attesa di risposta tecnica sugli endpoint disponibili; prevista sync unidirezionale Antenore → Ruffino Ops con dedup su id.

---

## 28. Persistenza

### 28.1 KV store
- Tabella `kv_store(key text primary key, data jsonb, updated_at timestamptz)`.
- Ogni router business possiede una o più raccolte persistite, tra cui `clienti`, `commesse`, `tickets`, `ticket_allegati`, `preventivi_documenti`, `utenti`, `sedi`, `backup_*`, `fic_config`, `fic_fatture`, `caselle_email`, `whatsapp_*`, `azioni_suggerite`, `conoscenza_aziendale`, `agente_esecuzioni`, `agente_config` e `tars_chat`.

La tabella `comunicazioni` è separata dal KV store: insert idempotente per `(casella_id, canale, message_id)`, indici per lista e tombstone per le eliminazioni dal CRM (§51).

Le tabelle PostgreSQL `promemoria` e `promemoria_eventi` conservano scadenze
personali e audit append-only. Ogni query e mutation applica `sede_id` e
`recipient_user_id`; un record fuori scope restituisce `NOT_FOUND`. Il claim
delle scadenze usa locking concorrente e la proiezione notifica è idempotente
per id e revisione.

Il refresh token Google del backup è inoltre **specchiato su file** (`data/backup-oauth.json`, mode 600, gitignored) così i riavvii senza DATABASE_URL non scollegano Drive; la riga DB, quando presente, ha precedenza.

### 28.2 Lifecycle
- **Bootstrap.** All'avvio `bootstrapAll()` legge ogni raccolta. Tre stati possibili per la singola key:
  - `firstBoot = true`: nessuna row presente → callback `onLoad` può popolare seed.
  - `firstBoot = false, loaded = true`: row presente, dati ripristinati con reviver Date.
  - `firstBoot = false, loaded = false`: errore transiente; **i save sono bloccati** finché la background recovery non riesce a leggere lo stato dal DB.
- **Save.** Debounciato 200 ms; usa `sql.json()` per evitare doppia encoding. Retry exponential backoff su errori transienti (EAI_AGAIN, ENOTFOUND, ECONNREFUSED, ECONNRESET, ETIMEDOUT, ENETUNREACH, EHOSTUNREACH, EPIPE).
- **Shutdown.** Handler `SIGTERM`/`SIGINT` chiamano `flushAll()` per non perdere mutazioni in flight, poi chiudono la pool.

### 28.3 Recovery
- Se ensureSchema o load falliscono dopo i retry → `backgroundRecover` (max 30 tentativi a intervalli di 5 s) finché ogni raccolta non risulta `loaded = true`. Nessun seed viene applicato in caso di fallimento (per non sovrascrivere dati reali con un seed accidentale).

### 28.4 Legacy double‑encoded payload
- Riconosciuto a load: se `data` è stringa JSON, viene parsata e schedulata una riscrittura corretta.

### 28.5 Vincoli su Postgres
- Connessione Postgres‑js: max 5 connessioni, `idle_timeout=20s`, `connect_timeout=30s` (Railway internal DNS warmup).
- SSL automatico quando l'URL contiene `sslmode=require` o l'host Railway.

---

## 29. UI/UX e componenti

### 29.1 Sistema
- Tailwind + shadcn/ui (Button, Card, Badge, Dialog, AlertDialog, Avatar, Input, Label, Select, Switch, Tabs, Tooltip, DropdownMenu).
- Icone lucide‑react.
- Toast: sonner.
- Font Plus Jakarta Sans; palette chiara calda con superfici bianche, inchiostro scuro e giallo come accento. I colori di stato usano token semantici (`success`, `warning`, `danger`, `info`), non hex locali.
- Raggi tra 8 e 14 px, bordi visibili e ombre contenute. Le superfici operative non devono apparire fredde, eccessivamente opache o spigolose.
- Componente `<SearchSelect>` riutilizzato per dropdown ricercabili (utenti, squadre, fornitori, ecc.).
- Componente `<ConfirmDialog>` riutilizzato per: cancellazioni, archiviazioni, "Procedi comunque" del doc gate, ripristino archivio.
- Componente `<FilePreviewDialog>` per preview PDF/immagini.

### 29.2 Sidebar
- Voci dinamiche; quelle con `direzioneOnly` filtrate per ruolo.
- Resizable (larghezza personalizzabile da utente).
- Avatar utente in basso con menù: nome, email, Esci.

### 29.3 Mobile
- Layout responsivo. Sidebar collassata in modalità mobile; nasconde scritte tenendo solo icone.
- **Header delle schede** (commessa, cliente): su viewport < `sm` il titolo e la riga di azioni si impilano (`flex-col` → `sm:flex-row`) e i bottoni vanno a capo (`flex-wrap`) invece di uscire dallo schermo.
- **Tabelle di lista** (Commesse, Clienti): le colonne secondarie sono nascoste progressivamente con `hidden {sm|md|lg|xl}:table-cell`, così su telefono restano solo le essenziali — Codice/Cliente/Stato per le commesse, Nome/Telefono per i clienti — con padding ridotto (`px-3`) sulle colonne mantenute. **Non** viene usato un wrapper `overflow-x-auto`: creerebbe un contenitore di scroll che romperebbe gli header `sticky` (regressione già occorsa e corretta in passato).
- Board, Calendario, Dashboard, Pagamenti e Magazzino riflowano nativamente (griglie responsive + `flex-wrap`); nessuno scroll orizzontale di pagina.
- Le tabelle delle sezioni direzione‑only a bassa frequenza (Fornitori, Produzione) restano larghe: sono pensate per l'uso da desktop.

### 29.4 Empty states
- Tutte le pagine principali hanno empty state esplicito con istruzioni sul prossimo passo.

---

## 30. Errori e telemetria

### 30.1 Convenzioni errori
- Gli errori non‑tRPC sono ritornati come `Error` con messaggio human‑readable in italiano.
- Errori "marker" usano un **prefisso** come `DOC_GATE_BLOCKED:` che il client identifica per offrire UI dedicata.

### 30.2 Logging
- Tutto il logging della persistenza passa da `console.log/warn/error` con prefisso `[persistence]`.
- I save e i load mostrano sempre il conteggio degli elementi per raccolta.

---

## 31. Roadmap aperta (lavori noti)

### 31.1 Sicurezza
- **Operatività:** ruotare le vecchie credenziali seed eventualmente ancora usate, rifare il login locale `gh` e revocare token GitHub non riconosciuti.
- **Decisione separata:** purge delle password seed dalla cronologia (BFG/`git filter-repo`). Richiede riscrittura SHA, force-push concordato e riallineamento di ogni clone.
- CSP (Content Security Policy) tarata su Vite, blob preview, Maps proxy.

### 31.2 Ottimizzazione
- **Attivazione object storage:** il layer per-file è completo; restano configurazione R2 su Railway, probe, backup Drive, dry-run sui dati reali e apply (§47). Il dry-run locale senza `DATABASE_URL` non è una verifica della produzione.
- Aggregato dashboard in un unico endpoint per ridurre il fan‑out lato client.
- Monitoraggio del rapporto `cache_read_input_tokens`/input token e del costo per trigger Tars dopo il deploy (§50).

### 31.3 UX
- Drag&drop diretto sulle colonne del Kanban (oggi solo bottoni avanza/indietro).
- Confetti hardware‑accelerati (opzionale).

### 31.4 Integrazioni
- **Fatture in Cloud OAuth:** codice completato. Restano configurazione delle variabili Railway, registrazione del redirect e collegamento di ogni sede (§40.3).
- **Antenore (Wnd/Oknoplast)**: connettore import clienti/preventivi/ordini — in attesa di specifiche dal fornitore.
- Esportazione CSV/Excel commesse, clienti, anomalie.
- Web Push e avvisi email per i promemoria a CRM chiuso (fuori ambito v4.30).
- UI di restore dal backup Drive.

---

## 32. Glossario

- **Commessa.** Progetto specifico di vendita+installazione per un cliente.
- **Apertura.** Singolo serramento (finestra, porta, ...) all'interno di una commessa.
- **Stato.** Posizione corrente della commessa nella state machine.
- **Soft‑archive.** Stato secondario, ortogonale allo stato del workflow: la commessa è nascosta dalle viste operative ma tutto è preservato.
- **Doc gate.** Vincolo per cui un avanzamento di stato richiede l'upload di documenti previsti per lo stato corrente.
- **Bypass.** Conferma esplicita dell'operatore tramite `force: true` per superare il doc gate.
- **Indirizzo di residenza.** Indirizzo fiscale del cliente (uso amministrativo).
- **Indirizzo di lavoro.** Indirizzo del cantiere (uso operativo per commesse, calendario, mappe).
- **Tipo detrazione.** Modalità fiscale richiesta dal cliente: `ecobonus` o `ristrutturazione`.

---

## 33. Cronologia significativa
- **v4.33 (26/08/2026)** - Un promemoria con data e ora complete genera direttamente una sola proposta approvabile; Tars chiede soltanto i dati temporali mancanti e non aggiunge una conferma preliminare (§50.11).
- **v4.32 (26/08/2026)** - Le proposte Tars pendenti o fallite possono essere eliminate dalla vista personale con conferma; restano nello store per audit e deduplicazione e continuano a essere visibili agli altri utenti autorizzati (§50.1).
- **v4.31 (26/08/2026)** - FiC diventa fonte autorevole per rate, date e storni; il pattuito resta nel CRM, i movimenti FiC sono idempotenti e auditabili, Tars propone soltanto correzioni dei manuali e i PDF fattura vengono collegati con retry sicuro (§37, §40.4, §50).
- **v4.30 (26/08/2026)** - Tars riconosce le richieste di promemoria personali, chiede sempre data e ora, attende l'approvazione del richiedente e consegna popup e notifica nel CRM aperto con completamento e posticipo (§25.6, §50.11).
- **v4.29 (26/08/2026)** - Il workspace Email amplia il lettore, elimina i troncamenti delle informazioni operative nel dettaglio e attiva automaticamente il focus quando si usa Tars o sono presenti proposte pendenti (§51.6).
- **v4.28 (25/08/2026)** - Gli allegati WhatsApp in ingresso partecipano allo smistamento Tars e possono essere proposti per l'archiviazione nel fascicolo con gli stessi controlli, storage e deduplica degli allegati Email; dalla chat la sorgente può essere indicata per numero o indirizzo Email e la destinazione per cliente/commessa (§50.2, §51.2-51.7).
- **v4.27 (25/08/2026)** - La sincronizzazione FiC espone stato e orario di avvio per sede, può essere fermata dalla pagina Integrazioni e applica timeout alle richieste e al giro completo (§40.3).
- **v4.26 (25/08/2026)** - La sincronizzazione FiC recupera in modo idempotente i PDF mancanti delle fatture già collegate; il workspace Email guadagna un lettore più ampio, modalità focus e vista singola sotto 1280 px (§40.4, §51.6).
- **v4.25 (25/08/2026)** - Gli esperimenti Tars accettano feedback umano tracciato e correzioni prima dell'approvazione (§50.6, §53.4).
- **v4.24 (25/08/2026)** - Gli allegati Email operativi possono essere proposti da Tars e archiviati nel fascicolo commessa con storage, checksum e deduplica canonici (§51.3, §51.5).
- **v4.23 (25/08/2026)** - Il bootstrap riallinea automaticamente le commesse storiche rimaste indietro rispetto alla Timeline, con riconciliazione idempotente e solo in avanti (§35.2).
- **v4.22 (25/08/2026)** - Le milestone della Timeline ordine avanzano automaticamente la commessa nel Board usando la state machine e il doc gate canonici; date/note e riaperture non spostano la commessa (§7.4, §35.2).
- **v4.21 (25/08/2026)** - Il rollout Tars fallisce chiuso: shadow senza notifiche/push, active bloccato per contesto/planner/semantica incompleti, ACL proposte per ownership, deleghe rivalidate e stream SSE senza finestra replay/live (§53).
- **v4.20 (25/08/2026)** - Introdotte le fondamenta di eventi, notifiche realtime, capability, contesto incrementale, planner persistente, indice ACL-aware, outcome e diagnostica; attivazione subordinata ai gate produzione (§53).
- **v4.19 (25/08/2026)** - La chat Tars può proporre cliente e prima commessa anche senza una comunicazione sorgente; la creazione resta unica, deduplicata e subordinata all'approvazione (§50.2, §50.9).
- **v4.18 (24/08/2026)** - Centro Azioni persistente con deduplica dei segnali, workflow personale, audit, modalità legacy/shadow/active, campanella compatta e analisi Tars asincrona/cachata senza OpenAI sui percorsi di lettura (§25, §50.9).
- **v4.17 (23/08/2026)** - Ricollegamento WhatsApp coexistence verificato in produzione con storico completato, echo live e outbound precedenti preservati; documentata la reinstallazione sicura di WhatsApp Business soltanto dopo backup verificato (§51.9).
- **v4.16 (23/08/2026)** - Il tool `cerca_comunicazioni` espone direzione, autore, controparte, mittente e destinatario; il prompt obbliga Tars a distinguere cliente e ufficio anche nello storico WhatsApp outbound (§50.3, §51.8).
- **v4.15 (23/08/2026)** - Embedded Signup riconosce la casella WhatsApp storica dal numero aziendale salvato nei destinatari e ne riusa l'id interno dopo uno scollegamento, preservando conversazioni, alias e collegamenti (§51.7-51.8).
- **v4.14 (23/08/2026)** - Corretto lo storico WhatsApp outbound usando `history[].threads[].id`; richiesta, progresso e completamento della sincronizzazione sono stati separati e resi visibili in UI. I record outbound legacy senza controparte vengono eliminati una tantum per consentire una reimportazione corretta. I gate dello smistamento Tars producono log solo sulle transizioni di blocco/ripresa (§50.7, §51.7-51.9).
- **v4.13 (22/08/2026)** - `/tars` diventa Command Center con vista Oggi, ranking deterministico, prove, proposte, analisi, chat e registro; il brief non chiama OpenAI e non consuma token all'apertura. La configurazione WhatsApp espone diagnostica privacy-safe per `smb_message_echoes` e duplicati (§50.9, §51.4-51.7).
- **v4.12 (19/08/2026)** - L'analisi commessa non chiude più in silenzio: proposta, domanda con opzioni oppure `nessuna_azione` motivata che nomina i fatti verificati. Il server rifiuta la chiusura muta su `on_demand`; i trigger automatici restano liberi (§50.8).
- **v4.11 (19/08/2026)** - Collegare una comunicazione a una commessa la porta in Gestite (collegamento manuale e proposte Tars approvate); lo scollegamento la riapre; il match automatico dell'arrivo resta nella coda operativa. Backfill una tantum delle collegate già viste (§51.1).
- **v4.10 (19/08/2026)** - Smistamento Tars ridotto a prompt specializzato e 7 strumenti (-78% token fissi), cache per sede/profilo/modello, `gpt-5.6-luna` opzionale, errori OpenAI sanitizzati e diagnostica token/cache/costi corretta (§50-51).
- **v4.9 (19/08/2026)** - Tars migrato a OpenAI Responses API con `gpt-5.6-sol` per le richieste umane, `gpt-5.6-terra` per gli automatismi, prompt caching per profilo/modello e chiusura forzata dopo il budget strumenti (§50-51).
- **v4.8 (19/08/2026)** - Coda Comunicazioni Tars resa lossless: continuazione automatica oltre 10 mail, trigger concorrenti preservati, retry API non annullabile, recupero periodico e dopo bootstrap, riattivazione da config/budget e stato d'attesa spiegato nella UI (§50-51).
- **v4.7 (19/08/2026)** - Ogni nuova email passa dalla classificazione strutturata di Tars; il filtro locale fornisce solo segnali, le esclusioni richiedono confidenza alta, i dubbi restano visibili e le mail saltate vengono ritentate (§50-51).
- **v4.6 (18/08/2026)** — Richieste di preventivo e opportunità protette da header spam e regole mittente; newsletter inutili ricondotte allo spam; Tars chiede l'assegnatario prima di proporre cliente e commessa e conserva il contesto nel seguito (§50-51).
- **v4.5 (18/08/2026)** — Comunicazioni con triage multilivello, filtro anti-spam/offerte prima dell'AI, regole mittente, azioni multiple e gestione Tars della singola mail con creazione lead approvata (§50-51).
- **v4.4 (18/08/2026)** — Tars con quadro aziendale, lettura controllata di organizzazione/produzione/qualità/documenti, audit periodico dei processi, proposta di miglioramenti misurabili, deduplica per chiave d'azione e Inbox operativa (§50).
- **v4.3 (14/08/2026)** — Inbox Comunicazioni email/WhatsApp (§51); Tars con fascicolo commessa, profili tool, prompt caching e cache per run (§50); OAuth FiC Authorization Code con refresh (§40.3); backup Drive compatibile con `storageKey`; probe e runbook R2 (§47); bootstrap utenti senza password fisse; sistema visuale caldo e code splitting (§52).
- **v4.2 (06/08/2026)** — Storage documenti su object storage con migrazione verificata (§47); marginalità e registro costi fornitore dentro la commessa (§45); post‑vendita v2: solleciti, interventi pianificabili dal ticket, ticket senza commessa, ricerca, stato `risolto` ritirato (§13); squadre di posa visibili e assegnabili alla commessa (§46); prodotti dichiarati in creazione e modificabili dopo (§44); data di apertura in scheda e in lista (§9); formato e parsing unici degli importi (§48); correzioni notevoli (§49).
- **v4.1 (23/07/2026)** — Pagina Pagamenti (§37.4) con registrazione rapida degli acconti; acconti modificabili in place (§37.1‑37.2); date programmabili sugli step della timeline, pensate per l'Appuntamento Posa (§35.2‑bis); Magazzino a 2 tile per riga con 4 prodotti visibili, badge fornitore e filtro fornitore a tendina (§36.3); form cliente con Ragione sociale e Sede legale per i non privati (§5.2); responsive mobile su header schede e tabelle di lista (§29.3).
- **v4.0 (16/07/2026)** — Rimossa la Classifica venditori (§23). Multi‑sede con isolamento completo; redesign UI (board v2, calendario mese‑default con chip pieni, timeline note post‑it, dashboard personalizzata); Magazzino (tile+popup, ordini, lead time, dropdown fornitori); registro acconti; notifiche v2 con stato lettura; sincronizzazione Google Calendar export+import; backup notturno Google Drive (OAuth drive.file); Fatture in Cloud sync clienti; WhatsApp deep link; scheda cliente PDF; hardening (scrypt versionato, CSRF, SSRF guard, trust proxy, mascheramento segreti); migrazione dati 2026 (§43).
- v3.0 — Riallineamento completo del PRD al codice corrente: dual address, tipoDetrazione, dataConsegnaIndicativa, soft‑archive, Archivio, Classifica venditori, doc‑gate con bypass, hardening sicurezza (scrypt, JWT fail‑hard, mimeType allowlist, rate‑limit login, security headers, session eviction, logout server‑side), assegnazione utente modificabile, preventivatori Fivizzanese e Punto del Serramento, Planning con joined info.
- v2.x — Versione precedente (PDF allegato in repo come riferimento storico).
- v1 — Documento originale.


---

# Parte II — Moduli introdotti dopo la v3

## 34. Multi‑sede

### 34.1 Modello
- Store `sedi`: `{ id, nome, indirizzo?, citta?, attiva }` (seed prima sede "La Spezia").
- Ogni entità business porta `sedeId` (backfill = 1 per i record pre‑esistenti).
- Gli utenti hanno `sediIds: number[]` (accesso multi‑sede).

### 34.2 Risoluzione della sede attiva
- Cookie/claim `active_sede` → `ctx.sedeId` su ogni richiesta tRPC.
- **SedeSwitcher** nella sidebar (in alto): cambia la sede attiva; tutte le query si rifanno sul nuovo scope.

### 34.3 Isolamento
- Ogni `list` filtra per `sedeId`; ogni mutation su entità esistente passa da `assertSedeScope` (404 anche in caso di id valido di altra sede — nessun information leak).
- Entità figlie (documenti, allegati, timeline, magazzino) ereditano lo scope dalla commessa/ticket padre.
- Pagina `/sedi` (direzione‑only) per creare/gestire sedi; assegnazione `sediIds` dalla pagina Utenti.

## 35. Timeline ordine (scheda commessa)

### 35.1 Struttura
18 step fissi per commessa (store `timeline_steps`, creati lazy alla prima lettura), raggruppati nelle 4 fasi del board: Rilievo Misure, Firma Contratto, Fatturazione, Invio Fattura, 1° Acconto, Ordine Merce, Conferma Ordine, Acconto Fornitore, Data Spedizione Prevista, Pagamento Merce Pronta, 2° Acconto, Data Consegna Merce, Appuntamento Posa, Lista Merce Posata, DDT Posa, Finiture, Saldo, Recensione.

### 35.2 Interazione
- Barra avanzamento (N/18 + %). Fasi collassabili; **la fase con lo step corrente e quelle contenenti note si aprono da sole**.
- Step corrente evidenziato (sfondo primary tenue) con bottone **Completa** one‑click. Dialog di modifica per data, utente esecutore (SearchSelect) e note; step completato riapribile.
- Campi step: `stato (da_fare|in_corso|completato), dataCompletamento, utente, note, allegato?`.
- Il primo completamento delle milestone sincronizza lo stato della commessa: **1 Rilievo Misure** → `misure_esecutive`; **2 Firma Contratto** → `aggiornamento_contratto`; **3 Fatturazione** → `fatture_pagamento`; **5 Primo Acconto** → `da_ordinare`; **6 Ordine Merce** → `produzione`; **10 Merce pronta** → `ordini_ultimazione`; **11 Secondo Acconto** → `attesa_posa`; **15 DDT Posa** → `finiture_saldo`; **17 Saldo** → `interventi_regolazioni`; **18 Recensione** → `archiviata`.
- La sincronizzazione usa la mutation canonica `commesse.update`: permessi, transizioni singole e doc gate sono identici al Board. Se manca un file, lo step resta incompleto e la UI offre **Procedi comunque**; confermando ripete entrambe le operazioni con `force: true`.
- Uno step intermedio non sposta il Board. Completare di nuovo una milestone già registrata o riaprirla non arretra la commessa; una timeline rimasta indietro rispetto al Board può quindi essere riallineata senza regressioni.
- Dopo il bootstrap, una riconciliazione idempotente esamina anche lo storico: per ogni commessa ricava la milestone completata più avanzata e porta il Board almeno allo stato corrispondente. Il recupero è soltanto in avanti, non riapre stati, non arretra commesse più avanzate e salva unicamente quando trova disallineamenti.

### 35.2‑bis Date programmate (appuntamenti futuri)
Il dialog dello step espone un campo **«Data (appuntamento o completamento)»** e due azioni distinte:
- **«Salva data»** — memorizza data/utente/note **senza** completare lo step. Serve a programmare in anticipo, tipicamente l'**Appuntamento Posa**, ma vale per qualsiasi step futuro.
- **«Segna come completato»** — completa lo step usando la data scelta (non più forzata a oggi).

Uno step non completato con data valorizzata mostra in riga una scritta blu **«📅 gg/mm/aaaa · utente»**, visivamente distinta dai metadati grigi degli step già completati.

### 35.3 Note come cittadino di prima classe
- Le note renderizzano come **post‑it ambra** (icona + 12 px, `whitespace-pre-line`: le note multiriga migrate dai To Do conservano a‑capo e separatori "— — —").
- L'header di ogni fase mostra un badge ambra "📝 N" con il conteggio note.
- Le date di completamento sono formattate it‑IT.

### 35.4 Collegamento con il Board (bidirezionale)
Completare una milestone della timeline avanza la commessa sul Board tramite la
stessa mutation, quindi con gli stessi permessi, la stessa state machine a
passo singolo e lo stesso doc gate. Dal 26/08/2026 vale anche il verso opposto:
avanzare la commessa sul Board completa ogni milestone il cui stato di
riferimento è stato raggiunto o superato.

L'allineamento è **solo in avanti** e idempotente. Arretrare la commessa non
riapre gli step: quel lavoro è stato fatto, e riaprirlo cancellerebbe data e
autore del completamento. Un errore nell'allineamento non annulla
l'avanzamento già salvato.

## 36. Magazzino (`/magazzino`)

### 36.1 Scope
Prodotti fisici in arrivo/da magazzino **per commessa**. Eleggibili solo commesse **da `produzione` in poi** (incluso; escluse archiviate) — gate applicato sia lato server (create) sia nel filtro pagina.

### 36.2 Modello (`magazzino_prodotti`)
`{ id, sedeId, commessaId, nome, quantita, fornitore?, numeroOrdine?, dataOrdine?, dataConsegna?, arrivato, note?, createdAt, updatedAt }`.
- **Fornitore** da dropdown fisso aziendale: Wnd, Oknoplast, Alias, Pail, Primed, HenryGlass, Palmieri, Errecci, Fivizzanese, Oskura, Korus, Punto del Serramento, Kopern, Citea, Cerrato, Brianzatende, Seraplastic, St Scale, Sharknet (valori legacy liberi restano selezionabili).
- **Lead time** = giorni `dataOrdine → dataConsegna`, mostrato per prodotto (⏱ N gg) e come **KPI medio** sugli arrivati.
- Cascade: eliminando una commessa si eliminano i suoi prodotti.

### 36.3 UI
- **KPI**: Prodotti, In arrivo, Arrivati, Lead time medio.
- **Strip "Prossime consegne"**: le 5 consegne pendenti più vicine cross‑commessa (rosse se scadute); il click apre il popup della commessa.
- **Ricerca + filtri**: chip di stato (Tutte / In arrivo / In ritardo / Arrivati) affiancati da un **menu a tendina dei fornitori** («Tutti i fornitori» + i 19 dell'elenco) che filtra le commesse contenenti almeno un prodotto di quel fornitore. Il vecchio chip «Con prodotti» è stato sostituito da questo dropdown.
- **Griglia di tile** (**2 per riga** su desktop, 1 su mobile): codice, StatoChip, cliente (17 px bold), città, **primi 4 prodotti** colorati per stato (✓ verde arrivato, rosso in ritardo con data corta, grigio in arrivo) ciascuno con **mini‑badge fornitore** accanto alla data, "+N altri prodotti", badge "N/M arrivati". Bordo rosso (ritardi) / verde (tutto arrivato). Ordinamento per urgenza (ritardi → consegna più vicina).
- **Popup dettaglio** (click sul tile, `max-w-6xl`): header con codice/cliente/stato/città + "Apri commessa" + badge; righe prodotto **tutte editabili inline** (quantità, fornitore, n° ordine, date, switch arrivato, nota ghost click‑to‑edit con blur‑save); form "Aggiungi prodotto" su due righe.

### 36.4 Board
Le card del Kanban mostrano il blocco prodotti (vedi §11.2).

## 37. Pagamenti — registro acconti

### 37.1 Modello
Su ogni commessa: `importoTotale` (pattuito) + `pagamenti[]` embedded. Ogni
movimento include almeno `{ id, importo, data?, metodo?, note?, origine, stato,
createdAt, updatedAt }`; i movimenti FiC conservano inoltre documento, rata,
chiave sorgente, stato remoto e date di sync/storno.
- `importoTotale` è un dato contrattuale CRM: nessuna fattura lo propone o lo sovrascrive.
- `importoIncassato` è **sempre ricalcolato dal server** come somma dei soli pagamenti `attivo`; gli `stornato` restano in audit ma valgono zero. Board, dashboard e notifiche usano lo stesso derivato.
- Gli acconti `origine = manuale` sono modificabili e rimovibili; i movimenti `origine = fic` sono immutabili dalle mutation manuali.
- Backfill: record legacy con incassato secco → unico acconto "Importo importato".

### 37.2 Card "Pagamenti" (scheda commessa)
- Totale pattuito editabile inline (blur‑save), barra "% incassato · € N", **Residuo** grande (ambra finché > 0, verde a saldo).
- Registro acconti ordinato per data: data, importo bold, badge metodo, origine `Manuale`/`FiC`, eventuale `Stornato`, riferimento fattura e nota. Matita e cestino compaiono soltanto sui manuali; gli storni restano visibili con enfasi ridotta. Al salvataggio di un manuale residuo, barra, chip del board, dashboard e notifiche si aggiornano dal derivato server.
- **Chips rapide 50% / 40% / 10%** del totale (il piano di pagamento tipico), cappate al residuo: un click precompila l'importo nel form di registrazione (data default oggi).
- Accent warning sulla card finché c'è residuo.

### 37.3 Propagazione
- Board: chip "Da saldare € N" nelle fasi finali (§11.2).
- Dashboard: voce "Da incassare € N" nel feed personalizzato (§26.2).
- Notifiche: fonte 4b (§25.2) — l'id embedde il residuo, un incasso parziale ri‑notifica il nuovo valore.

### 37.4 Pagina Pagamenti (`/pagamenti`)
Vista cassa di sede, in sidebar dopo Magazzino. Mostra solo commesse attive (no archiviate).
- **KPI**: Pattuito · Incassato · **Da incassare** · numero commesse senza importo pattuito.
- **Strip «Ultimi incassi»**: gli acconti più recenti della sede (endpoint `commesse.pagamentiRecenti`, che appiattisce i registri ordinandoli per data di registrazione e resta sede‑scoped); il click apre la commessa.
- **Righe ordinate per residuo decrescente** (i soldi più grossi in cima): codice, cliente, StatoChip, pattuito, barra percentuale con incassato (nascosta sotto `md`), **Residuo** in ambra oppure «Saldata» in verde.
- **Bottone «Acconto»** su ogni riga con residuo: apre un dialog rapido con chips **50/40/10%** + **«Salda tutto»**, data (default oggi), metodo e nota — registra senza dover aprire la commessa (riusa `addPagamento`).
- **Filtri**: Con residuo *(default)* / Saldate / Senza importo / Tutte, più ricerca per codice o cliente.
- **Copertura costi fissi**: pannello full-width sopra gli ultimi incassi, alimentato
  esclusivamente dai documenti FiC. Mostra obiettivo di fatturato netto del mese,
  netto già emesso, importo ancora da fatturare, costi fissi medi, margine di
  contribuzione, avanzamento e affidabilità. La formula usa i 12 mesi precedenti;
  tra 3 e 11 mesi usa il periodo disponibile e segnala affidabilità media, sotto
  i 3 mesi non inventa un risultato. I costi `dubbio` restano esclusi e la CTA
  apre direttamente la revisione Acquisti in Contabilità.

## 38. Sincronizzazione Google Calendar

### 38.1 Export (CRM → Google) — feed iCal per sede
- Ogni sede ha un **token segreto** (store `calendar_tokens`, rigenerabile: la rigenerazione revoca tutte le iscrizioni).
- Endpoint anonimo `GET /api/ics/:token/:feed.ics` (il token è il bearer) con cache 5 min. Feed: `tutti`, `rilievo`, `posa`, `assistenza`, `altro`.
- ICS RFC 5545 con VTIMEZONE Europe/Rome; titolo = tipo + cliente; location = indirizzo lavoro.
- L'operatore aggiunge il feed in Google Calendar via "Altri calendari → Da URL"; Google lo aggiorna periodicamente (sola lettura lato Google).

### 38.2 Import (Google → CRM) — overlay in Planning
- Sorgenti per sede (store `external_calendars`): nome, **indirizzo iCal segreto** di Google ("Impostazioni → Integra calendario"), colore da palette, attivo.
- Fetch **server‑side** (evita CORS) con cache 10 min, follow redirect, mantiene lo stale su errore; `webcal://` normalizzato a https; **SSRF guard** (§3.7).
- Parser ICS interno: unfolding, unescape, DATE/DATE‑TIME/UTC, TZID→Europe/Rome; **espansore RRULE** limitato alla finestra richiesta (DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL, COUNT, UNTIL, BYDAY, EXDATE, cap iterazioni).
- Gli eventi appaiono read‑only nel Planning (§12.9).

## 39. Backup notturno su Google Drive

### 39.1 Contenuto e struttura
Ogni notte alle **00:00 Europe/Rome** (o manualmente) viene generato uno snapshot datato:

- Per documenti e allegati il backup risolve prima `storageKey`, rilegge i byte dal driver attivo e verifica il checksum SHA‑256. Se l'oggetto manca o è corrotto il run fallisce in modo visibile: non viene prodotto un backup silenziosamente incompleto.
- I record legacy con `dataBase64` restano supportati. Gli allegati ticket sono inclusi anche quando la commessa o il cliente collegato non sono più presenti.

```
Backup CRM YYYY-MM-DD/
  database/<store>.json            ← dump integrale di ogni raccolta (utenti SENZA password)
  Sede <nome>/
    Utenti.json                    ← utenti della sede (sanificati)
    Clienti/<Cognome Nome (CL-id)>/
      Scheda cliente.pdf           ← generata server-side (gemella della scheda in app)
      cliente.json
      Commesse/<CODICE>/
        commessa.json
        Preventivi e contratti/…   ← file caricati, raggruppati per tipo
        Misure/… · Fatture e pagamenti/… · Ordini/… · DDT/… · Foto e altro/…
        Ticket <id>/…              ← allegati ticket
    Commesse senza cliente/<CODICE>/…
```

### 39.2 Collegamento Google (account personale)
- I service account NON possono scrivere su My Drive personale (Google One) → modalità primaria **OAuth utente**: la direzione collega l'account aziendale (una volta) con scope **`drive.file`** (l'app vede solo i file che crea).
- Flusso: `backup.oauthStartUrl` (adminProcedure, state monouso anti‑CSRF) → authorize Google → callback anonima `/api/oauth/gdrive/callback` → refresh token salvato (store + specchio su file, §28.1).
- Al primo backup l'app crea la cartella **"Backup CRM Ruffino"** nel My Drive collegato; l'operatore può spostarla/condividerla ovunque (tracciata per id — attualmente dentro la cartella condivisa aziendale).
- Fallback: senza credenziali il backup viene comunque scritto su disco server (`backups/`, gitignored). Modalità service account mantenuta nel codice per un eventuale passaggio a Workspace/Shared Drive.

### 39.3 API & UI
- Drive v3 via REST puro (JWT/token con crypto nativo — zero dipendenze npm); find‑or‑create cartelle con cache per run; upload multipart; `supportsAllDrives`.
- Router `backup` (direzione): `status`, `log` (ultimi 60 run), `runNow`, `updateConfig`, `oauthStartUrl`, `disconnectOAuth`, `checkRoot`.
- Card in Impostazioni: stato ("Drive collegato" + email account), ultimo backup (esito/file/MB), countdown prossimo run, "Esegui ora", collega/scollega, istruzioni una‑tantum.
- Single‑flight guard (un backup alla volta); log persistito.

## 40. Fatture in Cloud → Registro economico e clienti

### 40.1 Funzione
Ogni ora (se abilitato) o su "Sincronizza ora", il CRM legge anno corrente
e precedente di **fatture emesse, note di credito emesse, spese e note di
credito passive**. Le sole fatture creano i clienti mancanti; i clienti
esistenti non vengono modificati.

### 40.2 Logica di creazione
- Dedup su denominazione normalizzata contro i clienti esistenti.
- Persone: split cognome/nome **validato col codice fiscale** (consonanti del cognome vs primi 3 caratteri del CF; supporta cognomi composti e denominazioni invertite). CF valido salvato sul cliente.
- Aziende (P.IVA presente o ragione sociale riconosciuta): denominazione completa in `cognome`, tipo `azienda` (o `condominio`).
- I clienti creati vanno sulla sede primaria.

### 40.3 Config & stato
Store `fic_config`: modalità `oauth` o `manual`, access token e refresh token cifrati, scadenza, `companyId`, abilitazione, data collegamento, ultimo esito e contatori privacy-safe dell'ultimo sync. Lo status non restituisce mai segreti in chiaro.

- OAuth Authorization Code: `oauthStartUrl` crea uno state monouso valido 10 minuti; callback `/api/oauth/fic/callback`; scopes read-only `entity.clients:r issued_documents.invoices:r issued_documents.credit_notes:r received_documents:r`.
- L'access token viene rinnovato prima della scadenza con refresh deduplicato per sede. Il refresh token aggiornato viene persistito cifrato.
- Se l'account espone una sola azienda, questa viene selezionata automaticamente; altrimenti resta il picker `/user/companies`.
- La disconnessione rimuove i token OAuth. Il token manuale resta disponibile soltanto come fallback di emergenza.
- Router direzione: `status`, `oauthStartUrl`, `disconnectOAuth`, `saveConfig`, `companies`, `syncNow`, `annullaSync`.
- `status` espone `syncInCorso` e `syncAvviataAt` per la sede corrente. La UI aggiorna lo stato mentre il lavoro è attivo e consente di fermarlo anche dopo un refresh della pagina.
- Ogni richiesta HTTP verso FiC ha un timeout di 30 secondi; un giro completo ha un limite di 10 minuti. Cancellazione, timeout ed errori liberano sempre il lock per sede senza consentire due sync concorrenti.

Il requisito OAuth è code-complete. L'attivazione in produzione richiede `FIC_OAUTH_CLIENT_ID`, `FIC_OAUTH_CLIENT_SECRET`, `FIC_OAUTH_REDIRECT_URI` e un `MAIL_ENCRYPTION_KEY` stabile su Railway.

### 40.4 Fatture e riconciliazione (`/economia`)
Le fatture sincronizzate sono persistite nello store `fic_fatture`, sede-scoped.
La pagina `/economia`, visibile a direzione e amministrazione, separa
`Andamento`, `Da riconciliare`, `Costi fissi` e `Acquisti`. `Andamento` si apre
con la sintesi dell'anno — fatturato, costi, differenza e cassa attesa — e
dichiara quante fatture restano da riconciliare e quanti costi da classificare
prima di presentare i totali come definitivi. La panoramica divide Contratti CRM,
Vendite FiC e Acquisti FiC: imponibile, IVA e lordo non vengono confusi e
l'andamento mensile confronta grandezze dello stesso periodo.

Una fattura può essere collegata manualmente a una commessa soltanto dopo una
conferma esplicita. Dal 26/08/2026 il match automatico non è più limitato
all'identificativo fiscale: vale un solo segnale in comune fra telefono, email,
nome e cognome, indirizzo o identità fiscale del cliente, e il codice commessa
citato nell'oggetto della fattura prevale su tutto. La parità fra due commesse
non viene sciolta: la fattura resta da riconciliare con i candidati esposti.
Dalla stessa data **il pattuito è fonte FiC** quando esiste almeno una fattura
collegata (vedi §40.6); resta CRM e modificabile a mano solo in assenza di
fatture. Le rate
FiC pagate sincronizzano in modo deterministico e idempotente soltanto movimenti
`origine = fic`; importo, data, stato e storni seguono FiC. Un movimento
stornato resta auditabile e non alimenta `importoIncassato`. Una risposta
incompleta non può stornare rate mancanti.

Il sync non modifica mai i pagamenti manuali. Se un manuale compatibile è
discordante, Tars crea una proposta `correzione_pagamento` approvabile; se i
candidati sono più di uno, l'operatore seleziona la riga prima
dell'approvazione. Le proposte soddisfatte o sostituite passano a `superata` e
le guardie su fingerprint rendono no-op sicuri i dati già corretti o cambiati.
La riconciliazione è uno-a-uno in entrambe le direzioni: una rata FiC ha un solo
link attivo e lo stesso pagamento manuale non può rappresentare due rate, anche
tra fatture diverse. Il risanamento sceglie il link più compatibile con importo
e data indipendentemente dall'ordine delle rate; un pagamento FiC già persistito
ma rimasto senza link viene recuperato senza crearne un secondo. I movimenti FiC
associati ai link storici perdenti vengono stornati prima di superare il link;
per un manuale perdente Tars propone invece una neutralizzazione separata senza
spostare il collegamento canonico.

Su una fattura multirata, una nota FiC esplicita ma incompatibile con tutte le
rate blocca l'import automatico delle altre rate: Tars propone il riallineamento
del manuale e il registro resta invariato finché l'operatore non decide. In
questo modo l'incassato non contiene contemporaneamente il manuale discordante
e nuovi movimenti FiC della stessa fattura. Il blocco riguarda soltanto nuove
righe: aggiornamenti, storni e risanamento dei link già presenti continuano.

Prima di ogni approvazione vengono riletti la rata FiC corrente, il pagamento
CRM e il link attivo. Se importo, data, stato, sorgente o destinazione sono
cambiati, la proposta passa a `superata` senza modificare il registro né
generare un errore ripetibile. La card confronta `Nel CRM ora` con `FiC propone`,
mostra l'effetto esatto su `importoIncassato` e non espone il comando se i dati
di confronto non sono leggibili.

Il documento PDF ufficiale, quando disponibile, viene archiviato nel fascicolo
della commessa come file `fattura` dopo aver persistito il collegamento.
Le fatture non abbinate entrano nel trigger `riconciliazione_fatture`: Tars può
proporre un collegamento verificato oppure lasciarle non abbinate/ignorarle;
non può applicare la scelta senza approvazione.

Ogni sincronizzazione FiC ripara inoltre le fatture già collegate che non hanno
ancora il PDF nel fascicolo. Il recupero considera soltanto collegamenti
espliciti (`commessaId`), deduplica per sorgente e id FiC e isola gli errori per
singola fattura: un download fallito non interrompe il lotto e viene ritentato
alla sincronizzazione successiva. Le sole corrispondenze ipotetiche non generano
documenti. Un errore storage non crea nuovi blob base64 e non annulla il
collegamento o la riconciliazione economica già completati.

### 40.5 Snapshot, costi e classificazione Tars
`fic_fatture` mantiene documenti emessi, tipo, imponibile, IVA, lordo e stato
di presenza. `fic_costi` mantiene documenti ricevuti e classificazione
`fisso | variabile_commessa | straordinario | dubbio`. Ogni flusso ha uno
snapshot indipendente: soltanto una paginazione completa può marcare
`presenteInFic = false`; il record non viene cancellato e conserva audit e
collegamenti. Questo impedisce che documenti rimossi da FiC continuino a
gonfiare i KPI.

Tars classifica in lotto soltanto costi nuovi o variati, con output JSON
strutturato e cache key stabile per sede/modello. Le regole confermate da un
operatore prevalgono sul modello. Confidenza sotto soglia, risposta mancante o
errore provider lasciano il costo `dubbio`, escluso dal pareggio e visibile
nella revisione. La checkbox `Ricorda regola` è sempre una scelta esplicita.

Il fatturato canonico è imponibile fatture meno imponibile note di credito. I
costi canonici sono imponibile spese meno imponibile note passive. Solo rate
`paid` alimentano incassi/uscite e solo `not_paid` alimentano aperti; altri
stati sono esclusi finché non mappati esplicitamente.

Lo strumento Tars `leggi_economia` riceve lo stesso contratto in forma compatta:
fonte, periodo, contratti CRM separati, vendite/acquisti FiC, andamento mensile
e affidabilità della copertura costi fissi, senza dump dei singoli documenti.


### 40.6 Pattuito e piano rate — fonte FiC (26/08/2026)
Il pattuito (`importoTotale`) e il piano rate (`pianoRate[]`) di una commessa
hanno due regimi, distinti da `pattuitoFonte`:

- `fic` — esiste almeno una fattura FiC collegata. Importo e rate sono derivati
  da quelle fatture, in modo deterministico e idempotente. Le note di credito
  abbattono il pattuito e non generano rate in attesa. Ogni scrittura manuale
  su `importoTotale` o sulle rate risponde `PRECONDITION_FAILED`, direzione
  inclusa: correggere significa correggere la fattura in FiC o scollegarla.
- `manuale` — nessuna fattura collegata. Pattuito e rate li inserisce
  l'operatore. È il regime normale finché la fattura non viene emessa.

Il passaggio a `fic` avviene al primo collegamento; il ritorno a `manuale` solo
quando l'ultima fattura viene scollegata, senza azzerare la cifra già mostrata.
Le rate FiC portano `ficDocumentoId`, `ficRataId` e `ficSourceKey`, la stessa
chiave stabile del registro pagamenti.

Il piano rate NON è il registro incassi: descrive le scadenze concordate,
mentre `pagamenti[]` registra il denaro effettivamente ricevuto. La scheda
commessa li mostra separati e dichiara lo scostamento quando la somma delle
rate non copre il pattuito.

### 40.7 Costi fissi per ricorrenza (26/08/2026)
Un costo è **fisso** quando compare per almeno tre mesi consecutivi con lo
stesso importo, dallo stesso fornitore. La tolleranza sull'importo è di 50
centesimi e la forma societaria viene normalizzata, così un canone indicizzato
o una ragione sociale scritta in due modi non spezzano la serie. Le note di
credito passive restano fuori.

La regola è deterministica e non chiama modelli: gira in `upsertCostiFic`,
prevale su una classificazione di Tars e mai su una decisione presa da una
persona. I costi che riclassifica escono dalla coda di classificazione, quindi
non consumano token. `/economia` → `Costi fissi` mostra l'elenco con fornitore,
importo mensile e periodo coperto.

### 40.8 Reset del pattuito (operazione una tantum)
`scripts/reset-pattuiti.ts` azzera `importoTotale`, `pattuitoFonte`,
`pianoRate[]` ed elimina i pagamenti con `origine="manuale"`, conservando i
movimenti `origine="fic"`. È distruttivo e senza undo applicativo: si rifiuta
di partire in `--apply` senza un backup Drive riuscito nelle ultime 24 ore.
Le commesse archiviate restano escluse salvo `--includi-archiviate`.

## 41. WhatsApp (deep link)

- Helper `lib/whatsapp.ts`: normalizzazione numeri italiani → `wa.me/39…` con messaggio precompilato; firma aziendale "Ruffino Group — tel. 0187 872687".
- Bottone verde accanto al telefono in: **scheda cliente** (messaggio generico pratica), **scheda commessa** (messaggio con codice commessa), **dialog appuntamento del Planning** (conferma appuntamento con tipo, data e ora).
- Nessun invio automatico: si apre WhatsApp con il testo pronto, l'operatore preme invia.

## 42. Scheda cliente PDF

- Bottone "Scheda PDF" nella scheda cliente → A4 via jsPDF/autotable: anagrafica completa (tipo, contatti, CF/P.IVA, doppio indirizzo, detrazione, pratica edilizia, assegnatario), note, e tabelle Commesse / Appuntamenti / Ticket / Garanzie con section header e page‑break safe.
- La stessa scheda è generata **server‑side** per ogni cliente nel backup notturno (§39.1).

## 43. Migrazione dati 2026 (eseguita il 15/07/2026)

Operazione una‑tantum documentata per riferimento storico:
1. **Clienti**: 101 clienti unici estratti dal riepilogo fatture 2026 di Fatture in Cloud (113 righe); 73 creati, 28 già presenti. Split cognome/nome validato via CF; aziende riconosciute da P.IVA.
2. **Arricchimento**: incrocio con l'export anagrafico completo (846 record) → 72 clienti completati con indirizzo/città/CAP/telefono/email/CF/P.IVA; 1 inversione nome corretta via CF.
3. **Commesse + stati + note**: dalle 7 liste Microsoft To Do di reparto (Misure Esecutive, Aggiornamento Contratto, Ordini, Produzione, Attesa Posa, Finiture a saldo, Interventi/Regolazioni) → 43 commesse create, 23 riusate, 62 stati portati alla fase corretta, 71 note operative scritte negli step timeline corrispondenti (Firma Contratto / Ordine Merce / Data Spedizione / Appuntamento Posa / Finiture).
4. **Dedup**: merge di 5 doppioni (typo, nomi invertiti, coniugi cointestatari) con fusione di note timeline e stati; 3 coppie legittime (persona + propria azienda, conviventi) lasciate distinte.
5. Le righe To Do di clienti non‑2026 (fatture 2023‑25) sono state escluse deliberatamente.


---

## 44. Prodotti della commessa

### 44.1 Scopo
Una commessa deve dire **di cosa si tratta**. Il campo `prodotti[]` esisteva già sul modello ma era riempibile solo dopo, un elemento alla volta, dall'interno della scheda: in lista non compariva nulla.

### 44.2 Tipologie
Elenco chiuso, per poter raggruppare e filtrare, con "Altro" come valvola di sfogo:

> Infissi · Porte interne · Portoncino / Blindato · Zanzariere · Persiane · Avvolgibili / Tapparelle · Cassonetti · Controtelai · Tende da sole · Veneziane · Grate · Vetri · Scale · Altro

`TIPOLOGIE_PRODOTTO` è definito in `server/routers/commesse.ts` e replicato in `client/src/lib/prodotti.ts`: i due elenchi **DEVONO** restare allineati.

### 44.3 Dichiarazione in creazione
Il dialog **Nuova commessa** — sia nella pagina Commesse sia nella **scheda cliente** — espone un blocco **Prodotti**: righe di tipologia + quantità, aggiungibili e rimuovibili in linea. Le righe finiscono in `prodotti[]` alla creazione. Le righe senza tipologia vengono scartate; la quantità minima è 1.

### 44.4 Modifica su commesse esistenti
Il tab **Prodotti** della scheda commessa consente aggiunta, modifica ed eliminazione. Il nome del prodotto è la stessa tendina di tipologie; i prodotti già registrati con **nome libero** (precedenti a questa versione) conservano il proprio valore, che viene proposto in cima alla tendina come opzione a sé — correggere una quantità non deve riscrivere in silenzio cos'è il prodotto. Il campo `tipologia` è etichettato **"Materiale"** (PVC / Alluminio / Legno).

Le mutation `addProdotto` / `updateProdotto` / `removeProdotto` **DEVONO** invalidare sia `commesse.byId` sia `commesse.list`, altrimenti la colonna in lista resta indietro.

### 44.5 Presentazione
- **Pagina Commesse**: colonna **Prodotti** con badge `7× Infissi`, `3× Zanzariere`; oltre due voci compare `+N` con il dettaglio in tooltip.
- **Scheda cliente**: le card delle commesse mostrano gli stessi badge.

---

## 45. Marginalità stimata CRM

### 45.1 Formula della stima legacy
```
margine lordo = importoTotale − Σ costi[] − costoPosaStimato
margine %     = margine lordo / importoTotale
```
Il calcolo vive in `server/_core/margine.ts` come funzione pura
(`calcolaMargine`) ed è esplicitamente una **stima CRM**, non il totale
effettivo aziendale. I totali effettivi e il punto di pareggio usano solo FiC.

Il flag `datiIncompleti` è vero quando manca il pattuito **oppure** non è registrato alcun costo: senza costi il margine risulterebbe un finto 100 %.

### 45.2 Registro costi (`costi[]`)
I costi si registrano **dentro la commessa**, non dagli ordini fornitore: `{ id, importo, fornitore, descrizione, data, numeroOrdine, note }`. Le mutation `addCosto` / `updateCosto` / `removeCosto` sono riservate a **direzione o amministrazione**.

Scelta deliberata: un solo posto dove scrivere un costo, nessun doppio conteggio. Il modulo Fornitori conserva i propri ordini per la parte logistica (righe, ricevimento merce) ma **non alimenta più il margine** — evitando anche la trappola dell'ordine lasciato in "bozza" che silenziosamente non contava.

`importaCostiDaOrdini` esegue un import **una tantum** degli ordini già a sistema (esclusi `bozza` e `contestato`); è idempotente su `numeroOrdine` e il bottone compare solo finché il registro è vuoto.

### 45.3 Card "Economia" (scheda commessa)
Visibile **solo** a direzione e amministrazione (la query stessa è gated lato server). Mostra pattuito, costi fornitore con conteggio, costo posa modificabile in linea con blur‑save, e margine in € e %.

Colori per fascia: **≥ 30 %** verde, **15–30 %** ambra, **< 15 %** rosso, grigio quando i dati sono incompleti. Sotto, il registro dei costi con modifica in riga ed eliminazione.

### 45.4 Pagina `/marginalita`
Riservata alla **direzione** (voce di sidebar con flag `direzioneOnly`). Esclude le commesse archiviate.
- **KPI**: margine totale, margine medio %, commesse con dati, dati incompleti.
- **Tabella** ordinabile per % (peggiori prima), margine € o pattuito; ricerca e filtro per stato; le righe con dati incompleti sempre in fondo.
- **Aggregati**: costi per fornitore, margine per venditore, margine per mese di apertura — calcolati solo sulle righe complete.

---

## 46. Squadre di posa

### 46.1 Visibilità
La pagina **Squadre di posa** è in sidebar ed è **leggibile da tutti i ruoli** (`squadre.list` è `protectedProcedure`): serve a chiunque debba sapere chi è in cantiere. Creazione, modifica ed eliminazione restano `adminProcedure`, e la pagina nasconde i comandi a chi non è direzione invece di lasciarlo sbattere contro un FORBIDDEN.

Ogni card squadra elenca le **commesse attive assegnate**, quelle già in fase di posa per prime, ciascuna con link alla commessa.

### 46.2 Assegnazione alla commessa
Il campo `squadraId` esisteva sul modello ma non era né mostrato né impostabile: le squadre si assegnavano solo al singolo intervento, quindi guardando una commessa non si sapeva chi la stesse posando.

La card **Squadra di posa** nella scheda commessa assegna la squadra con una tendina cercabile. Diventa **ambra con "Da assegnare"** quando la commessa raggiunge `attesa_posa` senza squadra; altrimenti mostra caposquadra e telefono.

Creando un intervento dalla commessa, la squadra della commessa è **pre‑selezionata**.

### 46.3 Board
Le card nelle fasi di posa (`attesa_posa`, `finiture_saldo`, `interventi_regolazioni`) portano un chip con il nome della squadra, oppure **"Squadra da assegnare"** in colore warning quando manca.

---

## 47. Storage dei documenti

### 47.1 Problema
Prima di questa versione ogni documento viveva in base64 dentro la JSONB della propria raccolta (`preventivi_documenti`, `ticket_allegati`). Poiché `persistedStore` riscrive l'intero blob a ogni `save()`, **ogni upload riscriveva tutti i byte di tutti i file**.

### 47.2 Layer
`server/_core/fileStorage.ts` espone `putFile` / `getFile` / `deleteFileQuiet` con due driver, selezionati da `STORAGE_DRIVER`:
- **`local`** — file sotto `./data/files/<key>`; adatto allo sviluppo o a un deploy con volume montato;
- **`s3`** — qualunque endpoint S3‑compatibile (Cloudflare R2, AWS S3, MinIO) via REST + **SigV4 firmato con `node:crypto`**, senza dipendenze npm aggiuntive.

Variabili: `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`.

### 47.3 Modello del documento
Il record conserva i soli metadati più `storageKey` e `checksum` (sha256). La lettura è **retro‑compatibile**: i record che portano ancora `dataBase64` funzionano immutati, e `byId` ricostruisce il base64 dallo storage così che il client resti identico.

Se il driver fallisce in scrittura, l'upload **ricade sul base64 inline**: un caricamento non deve mai fallire per ragioni infrastrutturali.

### 47.4 Guardia sul filesystem effimero
Su Railway senza volume il filesystem è effimero: un record otterrebbe `storageKey` e i byte morirebbero al deploy successivo. `putFile` **rifiuta** quando il driver è `local`, l'ambiente è Railway e `STORAGE_ALLOW_EPHEMERAL` non è `1` — e l'upload ricade sull'inline, cioè sul comportamento precedente.

### 47.5 Migrazione
`scripts/migrate-documents-to-storage.ts` (e le procedure direzione `fileStorage.status` / `fileStorage.migrate`):
- **dry‑run di default**, `--apply` per eseguire;
- per ogni documento: scrive → **rilegge** → confronta lo sha256 → **solo allora** rimuove il `dataBase64`;
- **idempotente e riprendibile**: salta chi ha già `storageKey`;
- **rifiuta di partire** senza un backup Drive riuscito nelle ultime 24 h (controlla `backup_log`);
- **rifiuta** il driver `local` su Railway senza opt‑in esplicito.

`pnpm storage:check` e la procedura direzione `fileStorage.probe` verificano la configurazione con un ciclo reale put → get → checksum → delete senza esporre access key o secret. Il runbook Cloudflare R2 è in `docs/storage-r2.md`.

### 47.6 Cascate
L'eliminazione di un documento, di un allegato, di un ticket e — nuova — di una **commessa** rimuove anche i byte dallo storage. Prima l'eliminazione di una commessa lasciava i documenti orfani nella raccolta.

### 47.7 Backup dopo la migrazione
Il backup Drive non legge più soltanto `dataBase64`: usa `storageKey` come fonte canonica, verifica `checksum` e conserva il fallback legacy. Questo requisito è coperto da test per lettura inline, oggetto presente, oggetto mancante e checksum non valido.

---

## 48. Formato e parsing degli importi

### 48.1 Formato
`formatEuro` in `client/src/lib/euro.ts` è l'**unico** formatter: separatore di migliaia col punto, decimali con la virgola, **sempre due cifre decimali** anche quando sono `,00` → `1.234,56`.

`useGrouping: true` è obbligatorio: la regola italiana di `Intl` raggruppa solo da cinque cifre (`minimumGroupingDigits: 2`), per cui `5000` usciva "5000" accanto a "10.000" nella stessa colonna.

Ogni superficie che mostra denaro **DEVE** usare `formatEuro` / `formatEuroSimbolo`: Pagamenti, card acconti, card Economia, Marginalità, feed Dashboard, chip del board, Fornitori, rifacimenti. I preventivatori mantengono il proprio `Intl.NumberFormat` (stampano nei PDF col simbolo in coda) ma con lo stesso flag di raggruppamento.

### 48.2 Parsing
`parseEuro` interpreta il separatore dal contesto:
- punto **e** virgola → l'ultimo dei due è il decimale (`1.500,50` = 1500.5);
- solo virgola → decimale (`1500,50`);
- solo punto → **decimale** se seguito da 1–2 cifre (`1500.50`), **migliaia** se seguito da esattamente 3 cifre o se ce n'è più d'uno (`1.500`, `1.234.567`).

Varianti: `parseEuroPositivo` (incassi, > 0) e `parseEuroNonNegativo` (costi, ≥ 0).

Il parser precedente faceva `replace(/\./g, "").replace(",", ".")`: corretto per la notazione italiana, **catastrofico** per chi digita il punto decimale — `1500.50` veniva registrato come **150050**, cento volte tanto, senza alcun avviso. Il punto è ciò che quasi tutti digitano sul tastierino numerico. **Nessun `parseFloat` a mano sugli importi.**

---

## 49. Correzioni notevoli (v4.2)

Registrate perché ognuna nasconde una regola da non violare di nuovo.

| Difetto | Regola che ne deriva |
|---|---|
| `1500.50` salvato come `150050` | il parsing degli importi passa **solo** da `parseEuro*` (§48.2) |
| "Da incassare" calcolato come `max(0, Σpattuito − Σincassato)`: una commessa incassata in eccesso cancellava il debito di un'altra (4.000 invece di 5.000) | i residui si sommano **per commessa**, non sugli aggregati; l'eccedenza ha un proprio KPI, un filtro e la dicitura "+€ X in più" sulla riga (prima leggevano "Saldata") |
| `importoIncassato` scrivibile via `commesse.update` | i campi **derivati** non stanno negli schemi di input |
| Ticket con commessa cancellata impossibile da eliminare | `requireOwnershipOrDirezione(null)` lancia NOT_FOUND **prima** di valutare il ruolo: prevedere sempre il ramo "genitore mancante" |
| `apertoBy` sempre `null` alla creazione | un campo di autorizzazione che non viene mai popolato non autorizza nessuno |
| Notifiche mute sui ticket senza commessa | ogni sorgente di notifica deve prevedere il caso in cui l'entità collegata manchi |
| Costo posa che tornava indietro al blur | una scrittura deve invalidare **tutte** le query che mostrano quel dato, non solo la più ovvia |
| Colonna Prodotti ferma dopo una modifica dal tab | idem: `byId` **e** `list` |
| Rata suggerita sempre "1° acconto" | se una `list` filtra dei campi, ciò che serve alla UI va esposto in forma sintetica (`nPagamenti`) |

---

## 50. Tars — agente operativo con approvazione umana

### 50.0 Autonomia operativa (26/08/2026)
Il principio "propone, non esegue" è configurabile per sede dalla direzione.
`agente_config.autonomia` porta `attiva`, `killSwitch`, `tipiConsentiti[]` e
`principalUserId`. Con l'autonomia attiva, al termine di ogni esecuzione le
proposte dei tipi consentiti vengono approvate dal server passando dallo stesso
percorso di un click umano: stesse guardie, stesso doc gate, stessi permessi.

Tre confini non sono negoziabili da configurazione:

1. i **tipi irreversibili** (`chiudi_commessa`, `domanda`) non entrano mai in
   whitelist. Il criterio non è il rischio ma l'esistenza di un ritorno: un
   pagamento si storna, un avanzamento si arretra, una chiusura no;
2. l'esecuzione è attribuita a un **utente reale** della sede, con i suoi
   permessi. Senza responsabile configurato l'autonomia non parte;
3. ogni esecuzione autonoma viene **annunciata** nella chat aziendale, con
   azione ed esito. È la condizione che tiene l'autonomia reversibile: nessuno
   può annullare quello che non ha visto.

`killSwitch` nega tutto senza perdere la configurazione. Il Registro Tars
distingue le esecuzioni che hanno agito da quelle che hanno solo proposto.

### 50.0-bis Intake dei file in arrivo (26/08/2026)
Nome file e oggetto vengono letti da una pre-analisi deterministica prima del
modello: tipo probabile del documento, nomi candidati, codice commessa citato e
un segnale esplicito quando il nome non porta informazione. Un nome parlante
("misure Rossi.pdf") permette a Tars di verificare la corrispondenza e proporre
subito l'archiviazione; un nome muto ("IMG_4821.jpg", "scan0003.pdf") impone la
lettura del contenuto invece di un'ipotesi. Da un nome muto il tipo non viene
mai dedotto: le sue stesse parole sono rumore.

Nome e contenuto restano dati esterni non fidati. In presenza di più clienti o
commesse plausibili la scelta resta a un operatore.

Quando da una comunicazione emerge una data di consegna di un prodotto già a
magazzino, Tars può proporne l'aggiornamento direttamente dallo smistamento:
la data scritta dal fornitore è il dato più aggiornato disponibile.

### 50.1 Principio di sicurezza
Tars **propone, non esegue**. Il modello non possiede strumenti di scrittura diretta sui dati business: crea record in `azioni_suggerite`; un operatore approva o rifiuta; l'esecutore applica la proposta tramite la stessa mutation tRPC usata dall'interfaccia. Pagamenti, avanzamenti di stato, bozze di risposta e collegamenti fattura richiedono ruoli elevati.

Ogni proposta possiede una chiave d'azione canonica derivata da tipo, target e campi significativi del payload. La stessa azione non deve tornare in coda riscritta con parole diverse quando è pendente, approvata, rifiutata, risposta, fallita o già gestita. La similarità del titolo funge da controllo aggiuntivo e il motivo del rifiuto viene restituito al modello.

Una proposta in stato `pendente` o `errore` può essere eliminata dalla vista
personale dopo conferma. L'operazione registra l'utente in `hiddenForUserIds` e la esclude da
chat, Centro Azioni, scheda commessa e statistiche soltanto per quell'utente;
non cancella il record, non altera la chiave d'azione e conserva audit,
deduplicazione e visibilità per gli altri operatori autorizzati. Proposte
già decise o appartenenti a un'altra sede non sono eliminabili.

Per FiC, `correzione_pagamento` è l'unica proposta che può modificare un
pagamento manuale: payload, candidato scelto e fingerprint vengono rivalidati
all'approvazione insieme alla rata FiC viva e al collegamento uno-a-uno. Se la
correzione non è più necessaria o la fonte è cambiata, l'esecutore non duplica
né forza la scrittura; la proposta passa a `superata` quando l'azione è già
soddisfatta, sostituita o non più valida. `proponi_pagamento` e `proponi_modifica_commessa`
rifiutano inoltre i no-op e non possono ricreare importi già presenti o derivare
il pattuito da FiC.

### 50.2 Trigger e profili strumenti
Il catalogo tool inviato alla OpenAI Responses API dipende dal trigger:

- `riconciliazione_fatture`: solo FiC, commesse, clienti e pagamenti necessari;
- `smistamento`: classificazione di ogni comunicazione, ricerca, collegamento verificato e proposta di archiviazione degli allegati operativi; 9 strumenti, senza scritture automatiche;
- `gestione_comunicazione`: analisi puntuale di un messaggio con contesto minimo, allegati, collegamento, nuovo lead, ticket e bozza risposta;
- `on_demand`: profilo operativo mirato;
- `audit_processi`: quadro aziendale e strumenti di proposta per miglioramenti misurabili;
- `chat` e `seguito`: catalogo completo quando l'operatore richiede esplorazione.

Su richiesta esplicita dell'operatore, `chat` e il relativo `seguito` possono
usare `proponi_nuovo_lead` senza `comunicazioneId`: Tars cerca prima clienti e
commesse, legge gli assegnatari e prepara una sola proposta che crea cliente e
prima commessa in `preventivo`. Nei trigger automatici l'assenza della
comunicazione resta bloccante.

L'ordine dei tool è stabile per rendere riutilizzabile la cache del provider. Ogni run registra `profiloStrumenti` e `strumentiDisponibili`. Il default è `gpt-5.6-sol` per chat e richieste umane e `gpt-5.6-terra` per i trigger automatici; entrambi sono configurabili per sede. `gpt-5.6-luna` è disponibile per volumi elevati dopo validazione su un campione reale.

### 50.3 Quadro aziendale e confini di accesso
Tars DEVE poter incrociare anagrafiche, commesse, cantiere, economia, comunicazioni, inventario, produzione, qualità e storico delle proprie decisioni. `leggi_quadro_azienda` restituisce una sintesi compatta della sede con KPI, pratiche ferme, scadenze, anomalie e qualità decisionale dell'agente. Gli strumenti verticali permettono di approfondire contenuto documentale, produzione e qualità.

L'accesso ampio non costituisce un bypass: ogni lettura usa il `ctx` applicativo, rimane sede-scoped e rispetta il ruolo. `leggi_organizzazione` e i dati economici richiedono la direzione; credenziali, token e segreti non sono mai restituiti. Il contenuto dei documenti è marcato come fonte esterna non fidata.

`cerca_comunicazioni` restituisce per ogni email o messaggio WhatsApp la
`direzione` (`in`/`out`), l'`autore` (`cliente`/`ufficio`), la controparte e i
campi leggibili `da`/`a`. Tars DEVE usare questi attributi quando ricostruisce
uno scambio e non può attribuire al cliente un testo scritto dall'ufficio. Lo
stesso contratto vale per gli outbound storici importati dalla coexistence.

### 50.4 Fascicolo commessa
`leggi_fascicolo_commessa` raccoglie in parallelo dati commessa, timeline, documenti e doc gate, ordini fornitori, magazzino, ticket, interventi e garanzie, restituendo soltanto i campi utili al ragionamento.

Quando `commessaId` è noto all'avvio, il loop precarica il fascicolo nel primo messaggio (`fascicoloPrecaricato=true`), evitando il primo round-trip modello → tool. Una lettura identica successiva è assorbita dalla cache del run.

### 50.5 Riduzione token e cache
La riduzione token DEVE avvenire senza riusare dati tra utenti o tra esecuzioni:

1. **Prompt caching OpenAI:** prefisso stabile composto da istruzioni, profilo strumenti e cronologia; `prompt_cache_key` versionato e deterministico per sede, profilo e modello. Su GPT-5.6 il messaggio developer termina con un breakpoint esplicito e usa modalità `explicit` con TTL 30 minuti; `gpt-5.4-mini` usa il caching implicito. `store=false` evita la conservazione della risposta applicativa; verbosity bassa e contesto reasoning `all_turns` riducono output e ricostruzioni, mentre gli item `reasoning.encrypted_content` vengono ripassati nei turni di function calling stateless.
2. **Cache strumenti per run:** ogni `leggi_*` e `cerca_*` usa una chiave JSON stabile; due richieste identiche, anche contemporanee, condividono la stessa Promise. Gli errori non restano in cache.
3. **Profilo minimo:** i trigger automatici non pagano lo schema di strumenti irrilevanti.
4. **Fascicolo compatto:** una lettura aggregata sostituisce numerose chiamate frammentate e output ripetuti.

Lo smistamento usa un prompt dedicato e 9 tool: il prefisso fisso resta molto più compatto del catalogo completo. Le decisioni recenti non vengono inviate a questo trigger perché non informano la classificazione. Nel lotto automatico Tars può soltanto classificare, cercare il contesto, proporre il collegamento e proporre l'archiviazione di un allegato con commessa e tipo verificati; lead, ticket, pagamenti e risposte restano nel profilo puntuale `gestione_comunicazione`.

L'audit salva input, output, cache read, cache write, cache hit strumenti, costo stimato ed esito. Il consumo restituito dal provider viene contabilizzato anche per risposte incomplete o fallite. I campi storici `cache write 5m/1h` restano compatibili con le esecuzioni precedenti; le scritture OpenAI sono contabilizzate nel bucket a moltiplicatore 1,25. La Inbox Tars espone modello, token totali, percentuale cache, scritture, costo, profilo e preload; errori della query non vengono presentati come registro vuoto. Le risposte HTTP del provider sono sanitizzate prima del log e non possono esporre frammenti della chiave API.

### 50.6 Audit continuo dei processi
Quando Tars e l'audit sono abilitati, lo scheduler può eseguire una revisione per sede ogni circa 24 ore. Il run automatico usa il profilo minimo `audit_processi`, legge prima il quadro aziendale e DEVE:

- proporre al massimo un esperimento, scegliendo il pattern piu forte;
- basarsi su pattern ricorrenti o indicatori misurabili, non su un singolo caso;
- usare una metrica server con baseline e denominatore non modificabili dal modello;
- descrivere una singola azione, un target migliorativo, un responsabile valido
  della sede e una data di verifica tra 7 e 90 giorni;
- evitare azioni già proposte o decise.

`leggi_quadro_azienda` salva al massimo una fotografia giornaliera per sede in
`tars_process_snapshots`, con retention 90 giorni e soli indicatori compatti e
riferimenti numerici ai casi. Il tool `proponi_miglioramento_processo` rifiuta
baseline inventate, campioni sotto due, target non migliorativi, responsabili
fuori sede e date non valide. La chiave `processo:<sedeId>:<metricKey>` impedisce
due esperimenti aperti sulla stessa metrica.

La direzione può avviare l'audit manualmente e abilitarlo per sede nelle
Integrazioni. L'approvazione non cambia il processo: crea un record in
`tars_process_experiments` e un caso `process_experiment` assegnato nel Centro
Azioni. Alla scadenza un worker rilegge gli indicatori senza chiamare OpenAI,
classifica l'esito come `migliorato`, `invariato` o `peggiorato` e risolve il
presidio conservando baseline, target e valore misurato nel registro eventi.

Finché la proposta è pendente, l'operatore può correggere direttamente nella
card azione, target, responsabile e data di verifica, indicando obbligatoriamente
cosa Tars ha valutato male. Metrica e baseline non sono modificabili. La mutation
server rivalida baseline corrente, direzione migliorativa del target, utente
attivo della sede e scadenza tra 7 e 90 giorni; conserva prima/dopo, autore, data
e feedback in `azioni_suggerite`. L'approvazione successiva usa esclusivamente i
valori corretti e assegna il caso al nuovo responsabile. Le correzioni recenti
sono mostrate a Tars nel blocco decisionale dinamico, escluso dallo smistamento e
dal prefisso cache stabile, senza trasformarle automaticamente in regole
aziendali.

### 50.7 Store e budget
Gli store principali sono `azioni_suggerite`, `conoscenza_aziendale`, `agente_esecuzioni`, `agente_config`, `tars_chat`, `tars_process_snapshots` e `tars_process_experiments`. Il budget mensile e i limiti di esecuzione vengono controllati lato server; l'assenza o il superamento del budget non può degradare in scritture non tracciate.

La configurazione richiede `OPENAI_API_KEY`; `ANTHROPIC_API_KEY` non è più letta. Al raggiungimento di `maxToolCalls`, il loop concede esattamente un turno conclusivo senza strumenti e termina anche se il provider restituisce una risposta anomala: nessun trigger può restare in esecuzione indefinitamente.

Se uno smistamento automatico non parte perché Tars è disattivato, manca la
chiave OpenAI o il budget mensile è esaurito, la coda resta integra. Il server
registra soltanto le transizioni di blocco e di ripresa, senza ripetere lo
stesso warning a ogni controllo periodico.

### 50.8 Analisi di una commessa
Il trigger `on_demand`, avviato dall'operatore con «Analizza» sul banner della commessa, parte dal fascicolo e DEVE chiudersi in uno di tre modi, mai in silenzio:

- una o più proposte, quando i fatti le reggono;
- `chiedi_chiarimento` con le opzioni possibili, quando manca un dato per decidere;
- `nessuna_azione` motivata, dichiarando cosa è stato verificato e perché non serve nulla.

La domanda è la via d'uscita quando non ci sono basi per proporre: è preferibile sia a una proposta debole sia a una chiusura muta. La regola anti-rumore «meglio zero che tre mediocri» resta valida, ma vincola le proposte e non autorizza a non dire niente.

Il motivo di `nessuna_azione` diventa il riepilogo mostrato sulla commessa, quindi DEVE nominare i fatti controllati — stato, saldo, documenti, consegne, ticket — e non limitarsi a dichiarare che è tutto a posto. Il server rifiuta una chiusura senza motivazione sostanziale su questo trigger e restituisce l'errore al modello, che deve motivare o chiedere. Il vincolo vale solo per `on_demand`: i trigger automatici, come lo smistamento che chiude un lotto, restano liberi di terminare senza motivo.

Quando l'operatore dichiara che il lavoro e finito, Tars non DEVE proporre un
avanzamento alla fase successiva. `verifica_chiusura_commessa` controlla insieme
saldo residuo, gruppi documentali richiesti fino all'archivio, step timeline in
corso, ticket e interventi aperti. Se il fascicolo e pronto, una sola proposta
`chiudi_commessa` porta la commessa ad `archiviata` dopo approvazione e nuova
verifica del fingerprint; in presenza di blocchi Tars li espone e non crea una
chiusura falsa.

### 50.9 Command Center
La route `/tars` DEVE aprire sulla vista `Oggi`; le altre viste sono
`Proposte`, `Analisi`, `Chat` e `Registro`. `Registro` resta visibile solo alla
direzione. La chat è uno strumento della cabina operativa e non la vista
iniziale. Email e WhatsApp mantengono workspace separati e non vengono
incorporati come inbox dentro Tars.

Una richiesta diretta di creazione anagrafica non autorizza una scrittura
immediata. Se i dati obbligatori non bastano, Tars usa `chiedi_chiarimento`; se
la proposta è completa, la card mostra cliente, assegnatario e dati della prima
commessa. Solo l'approvazione chiama `clienti.create` e `commesse.create` con il
contesto sede e ruolo dell'operatore.

`tars.commandCenter.get` DEVE applicare `sedeId`, considerare soltanto proposte
pendenti della sede e produrre un massimo configurabile di priorità. Il ranking
è deterministico e combina urgenza, impatto e confidenza; a parità usa scadenza
e chiave canonica. La stessa `chiaveAzione` compare una volta sola. Una priorità
senza almeno una prova verificabile non viene mostrata come certezza.

Ogni priorità mostra conclusione, motivazione, confidenza e fino a tre prove
verso comunicazione, cliente, commessa, fattura o esecuzione. Il brief e le
metriche derivano da proposte ed esecuzioni persistite e NON effettuano una
chiamata OpenAI all'apertura o all'aggiornamento della pagina. Questa scelta
riduce latenza e token senza alterare le proposte. Le azioni continuano a
richiedere approvazione esplicita tramite le mutation esistenti.

Le proposte generate come seguito di una domanda o approvazione nata in chat
DEVONO comparire nello stesso thread. Il server idrata ricorsivamente i
discendenti tramite `origineId`, con protezione dai cicli e scope sede; il client
aggiorna la conversazione a intervalli brevi finche il seguito ha prodotto una
domanda, una proposta o un esito. La tab Proposte resta una vista globale, non
un passaggio obbligatorio per completare il lavoro iniziato in chat.

La vista `Oggi` include il Centro Azioni persistente (§25), con casi
deterministici, ciclo di vita ed evidenze trasversali. I casi nuovi o cambiati
di priorità alta/critica accodano il trigger economico `centro_azioni`: massimo
tre per lotto, profilo strumenti ridotto, fascicolo precaricato quando esiste
`commessaId`, prompt cache separata per sede/profilo/modello. Il risultato salva
riepilogo, esecuzione e id delle proposte. Errori OpenAI non nascondono né
declassano il caso; le modifiche restano proposte da approvare.

### 50.10 Conoscenza aziendale (`/conoscenza`)
La pagina `/conoscenza`, riservata alla direzione, gestisce le regole persistite
che Tars deve conoscere: fornitori, processo, clienti, terminologia,
convenzioni e preferenze di comunicazione. Ogni voce ha titolo, contenuto,
categoria e stato attivo; può essere creata, modificata, disattivata o rimossa.
Solo le voci attive entrano nel prompt. La conoscenza è scritta e governata
dall'azienda: non viene dedotta automaticamente da un singolo caso o da una
proposta rifiutata.

### 50.11 Promemoria personali
Quando l'operatore dice “ricordami” o esprime una richiesta equivalente, Tars
DEVE trattarla come promemoria personale e non come nota timeline, evento di
calendario o attività generica. Se la richiesta contiene già data e ora
complete, Tars usa direttamente `proponi_promemoria`: la card approvabile è
l'unica conferma e non deve essere preceduta da una domanda. Se manca la data o
l'ora, `chiedi_chiarimento(intent=promemoria)` domanda soltanto il dato mancante
e conserva il testo richiesto; una risposta ancora insufficiente può produrre
un ulteriore chiarimento temporale senza aprire catene automatiche generiche.

Tars usa `proponi_promemoria` soltanto con un istante futuro esplicito e timezone
`Europe/Rome`, ricavato dalla richiesta completa o dalla risposta temporale.
`requestedByUserId` deriva dal contesto autenticato e non è controllabile dal
modello. La proposta è visibile e decidibile dallo stesso richiedente; per altri
utenti rispondere, approvare o rifiutare restituisce `NOT_FOUND`.
L'approvazione rivalida utente attivo, sede, cliente e commessa e crea il record
in modo idempotente.

Le API `promemoria.due`, `dismissPopup`, `complete`, `snooze` e `cancel` sono
personali e sede-scoped. Il parsing rifiuta istanti passati, orari locali
inesistenti o ambigui nei cambi di ora legale. La v4.30 non invia Web Push o
email: popup e notifica sono disponibili con CRM aperto o al successivo focus.

---

## 51. Comunicazioni (Email e WhatsApp)

### 51.1 Modello e ingestione
Email e WhatsApp confluiscono nella tabella `comunicazioni`. La chiave `(casella_id, canale, message_id)` rende idempotente la sincronizzazione. Oltre a canale, mittente, contenuto, allegati, cliente/commessa, stato e data, ogni riga persiste categoria, score, motivazione e fonte della classificazione, più l'ultimo riepilogo Tars richiesto dall'operatore.

Gli stati sono `nuova`, `vista`, `gestita`. L'eliminazione dal CRM usa `deleted_at`: il messaggio resta nella casella sorgente e il tombstone impedisce che venga importato di nuovo.

Il collegamento esplicito a una commessa DEVE portare la comunicazione in `gestita`: vale per il collegamento manuale dell'operatore e per l'approvazione di `collega_comunicazione` e `crea_lead`. Il match automatico dell'ingestione NON marca gestita — una richiesta nuova su una commessa aperta resta lavoro da leggere. Scollegare riapre la pratica riportandola a `vista`, tranne per le categorie escluse, che sono fuori dalla coda per classificazione e non per collegamento. Una comunicazione già `gestita` non regredisce.

### 51.2 Classificazione e filtro anti-rumore
Le categorie sono `operativa`, `nuovo_lead`, `amministrativa`, `fornitore`, `da_classificare`, `offerta_marketing` e `spam`. `spam` e `offerta_marketing` sono escluse dalla coda e dai conteggi operativi dopo la classificazione, ma restano consultabili nella vista Escluse.

Ogni nuova Email e ogni WhatsApp in ingresso non triviale DEVE passare dalla classificazione automatica di Tars. Per Email il filtro locale usa anche gli header del server mail (`X-Spam-*`, `List-Unsubscribe`, `Precedence`); per entrambi i canali considera mittente, linguaggio, allegati, regole persistenti e match CRM. Il suo esito e soltanto una pre-analisi non vincolante. Prima della decisione AI la comunicazione resta `da_classificare` e visibile. L'unica eccezione WhatsApp è un testo breve di cortesia, già collegato con certezza a una commessa e senza allegati: può nascere già analizzato per non consumare un run inutile. La presenza di qualunque allegato disattiva sempre questa eccezione.

Tars DEVE chiamare `classifica_comunicazione` una volta per ogni elemento del lotto, registrando categoria, confidenza, presenza di dubbi e motivazione concreta. `spam` e `offerta_marketing` possono essere applicate automaticamente soltanto con confidenza alta e `dubbio=false`; altrimenti il server forza `da_classificare`. Una classificazione manuale dell'operatore non puo essere sovrascritta dall'automazione. Se Tars salta un id, la comunicazione resta visibile e viene ritentata dopo un minuto; dopo un errore API il retry avviene al termine della pausa di sicurezza di 15 minuti. In assenza di configurazione o budget la comunicazione non viene nascosta.

Lo scheduler DEVE preservare il risveglio della coda quando un messaggio arriva durante un run o durante una pausa API. Ogni run elabora al massimo 10 messaggi; se il lotto è completo e restano elementi, il successivo parte dopo circa 500 ms. Il primo trigger è debounciato per circa 5 secondi. Un controllo di recupero ogni minuto cerca code residue di tutte le sedi e il bootstrap esegue il primo controllo dopo circa 5 secondi, quindi un deploy o un timer perso non richiedono l'arrivo di una nuova email. Riattivare Tars o modificare il budget risveglia subito la coda.

Una richiesta esplicita di preventivo, sopralluogo, appuntamento o contatto commerciale concreto DEVE essere valutata prima di header spam, segnali newsletter e regole mittente. Se può portare lavoro resta `nuovo_lead`, oppure `operativa` quando il cliente è già riconosciuto, anche se arriva da un indirizzo aziendale o da un portale usato anche per invii massivi. La direzione può memorizzare una regola esatta per mittente; ogni regola è sede-scoped e revocabile, ma non può nascondere una successiva opportunità esplicita.

### 51.3 Matching e gestione Tars
Il matching deterministico prova riferimenti a commessa/cliente e registra confidenza e motivazione. Tutte le nuove Email e i WhatsApp in ingresso non triviali entrano nello smistamento per essere prima classificati da Tars; dopo la classificazione, solo quelli operativi proseguono con proposte di collegamento, archiviazione allegato o gestione.

Il run automatico si limita a classificare e, su corrispondenza certa, proporre il collegamento a una commessa e l'eventuale archiviazione degli allegati operativi. Dal lettore l'operatore può impartire a Tars un'istruzione sulla singola comunicazione. Il corpo è delimitato come contenuto esterno non fidato e il profilo `gestione_comunicazione` espone soltanto gli strumenti necessari. Se non esiste una commessa, Tars può proporre un ticket senza commessa, una bozza o `proponi_nuovo_lead`.

Per un nuovo lead Tars DEVE prima cercare clienti e commesse esistenti e leggere `leggi_assegnatari`, che restituisce soltanto utenti attivi della sede. Se l'istruzione non indica già una persona in modo inequivocabile, Tars usa `chiedi_chiarimento` e mostra i nomi come opzioni. La risposta riapre una sola volta l'analisi mantenendo il contenuto originale della comunicazione. `proponi_nuovo_lead` rifiuta un assegnatario mancante o non valido.

L'approvazione crea cliente e commessa in stato `preventivo`, imposta lo stesso `assegnatoA` su entrambi e collega la comunicazione tramite le mutation applicative. La card mostra il nome scelto prima dell'approvazione. La chiave canonica usa `comunicazioneId`, quindi lo stesso lead non può essere proposto due volte.

Un allegato operativo puo generare `archivia_allegato` soltanto dopo aver
verificato comunicazione, indice, nome/MIME atteso, tipo documento e una sola
commessa plausibile nella stessa sede. Nomi file e contenuti restano fonti
esterne non fidate. Dopo approvazione il server rivalida tutto, collega la
comunicazione alla commessa, legge i byte da IMAP o Meta e crea un documento normale del
fascicolo con storage e checksum standard. La chiave
`sedeId:comunicazioneId:allegatoIndex` rende l'operazione idempotente; il file
risultante DEVE essere apribile e scaricabile come un upload manuale.
Per WhatsApp il download avviene usando il `mediaId` ricevuto dal webhook. Se
Meta non rende più disponibile il media, l'approvazione fallisce in modo
esplicito e non crea documenti parziali o record duplicati.

In chat l'operatore PUÒ indicare la sorgente e la destinazione in linguaggio
naturale, per esempio “allega il file inviato dal numero +39 … alla commessa
Mario Rossi” oppure la stessa richiesta con un indirizzo Email. Tars DEVE
cercare la comunicazione per identificativo esatto, restituire gli indici reali
degli allegati e la categoria corrente, cercare la commessa per cliente e
preparare una sola proposta. Se un WhatsApp è ancora `da_classificare`, Tars
DEVE classificarlo prima della proposta.
Se più messaggi, file o commesse sono plausibili, DEVE usare
`chiedi_chiarimento` senza scegliere il primo risultato.

### 51.4 Route e compatibilita
Le route canoniche sono `/messaggi/email`, `/messaggi/whatsapp` e `/tars`.
`/comunicazioni` e `/inbox` DEVONO restare redirect legacy con `replace`: il
primo va a `/messaggi/email` e conserva solo `view` consentito e `messaggio`
numerico positivo; il secondo va a `/tars` e conserva solo `tab` tra `oggi`,
`proposte`, `analisi`, `chat`, `registro` e i valori legacy `pendenti`/`decise`,
normalizzati a `proposte` dalla pagina. Parametri non riconosciuti non devono
essere propagati.

### 51.5 API per canale e scope
`mail.email.list`, `mail.email.byId`, `mail.email.stats` e
`mail.email.segnaTutteViste` DEVONO forzare il canale Email e la sede attiva.
`mail.email.archiviaAllegato` e ammessa solo per un'email della stessa sede,
gia collegata alla commessa indicata: legge l'allegato dalla casella sorgente e
lo archivia nel fascicolo della commessa. Il router storico
`mail.comunicazioni.*` resta compatibile per azioni condivise e consumatori
esistenti.

Il tool Tars `proponi_archivia_allegato` e il relativo esecutore approvato
accettano comunicazioni Email e WhatsApp della sede attiva. WhatsApp non espone
una mutation manuale equivalente: il percorso passa dalla proposta Tars e
dall'approvazione umana. Per WhatsApp sono ammessi soltanto messaggi in ingresso
già classificati in una categoria di lavoro; echo, storico, spam e casi ancora
`da_classificare` vengono rifiutati. MIME e limite reale di 10 MB sono validati
prima di collegare la comunicazione; un errore di storage ripristina il
collegamento precedente.

`mail.whatsapp.conversazioni` e `mail.whatsapp.thread` sono API di sola lettura
e applicano sempre `sedeId`; una conversazione o un thread fuori sede deve
rispondere `NOT_FOUND`. `mail.whatsapp.rinominaConversazione` persiste soltanto
l'alias locale di una chat non collegata a un cliente CRM. Non esistono API di
invio WhatsApp o Email in questa fase.

### 51.6 Workspace Email
Email offre code Da gestire, Nuovi lead, Gestite ed Escluse, ricerca e lettore
operativo con stato Tars, classificazione, collegamento, proposte, allegati e
corpo. Nel dettaglio il corpo completo precede allegati, proposte e campo
istruzioni Tars; in lista l'anteprima usa due righe e badge testuali per
allegati, collegamento e stato. L'operatore puo richiedere a Tars istruzioni su una singola email; le
azioni che modificano il CRM mantengono il normale flusso di proposta e
approvazione. Eliminare dal CRM non tocca la casella IMAP: la riga diventa un
tombstone per evitare una re-importazione.

Su desktop da 1280 px la lista ha una larghezza stabile e il lettore occupa
tutto lo spazio residuo. Il comando `Espandi email` nasconde temporaneamente la
lista senza cambiare messaggio, filtri o URL; `Mostra elenco email` ripristina
la vista affiancata. Quando l'operatore avvia un'analisi Tars o la mail contiene
proposte pendenti, il lettore entra automaticamente in modalità estesa; il
ritorno alla vista affiancata resta sempre disponibile. Sotto 1280 px elenco e
lettore non vengono compressi in due
colonne: si mostra una vista alla volta con ritorno esplicito all'elenco. Corpo,
allegati e azioni Tars usano contenitori distinti: il testo resta entro una
misura leggibile, mentre gli strumenti operativi possono sfruttare il pannello
più ampio. Mittente, indirizzi, collegamenti CRM, nomi degli allegati, riepiloghi
e contenuti delle proposte sono sempre accessibili nel dettaglio tramite testo
a capo, senza ellissi distruttive. Nessuna delle tre modalità introduce scroll
orizzontale globale.

### 51.7 Workspace WhatsApp
WhatsApp raggruppa i messaggi in una sola conversazione per account e numero
normalizzato, identificata nel client da
`wa:<casellaId>:<numero-normalizzato>`. La chiave non espone `sedeId`, che resta
un vincolo obbligatorio lato server. Il nome visualizzato ha ordine vincolante:
cliente CRM collegato, alias scelto dall'operatore, profilo Meta, numero
normalizzato. L'alias e persistito per sede, account e numero e non puo
sovrascrivere il cliente CRM.

Il thread e cronologico e paginato; media e allegati sono metadati
ispezionabili. Il workspace e esplicitamente di sola lettura: nessun invio di
messaggi o media, nessuna modifica alla fonte WhatsApp. Questa limitazione non
impedisce a Tars di proporre l'archiviazione di un allegato in ingresso nel
fascicolo CRM; il download da Meta e la scrittura nello storage avvengono solo
dopo approvazione. Su desktop la lista e
il dettaglio usano colonne con `min-width: 0`; su mobile si mostra una vista
alla volta. Nessun testo, numero o allegato deve introdurre scroll orizzontale
di pagina.

Scollegare il numero dal CRM non elimina le comunicazioni gia importate. Un
nuovo Embedded Signup dello stesso numero aziendale DEVE recuperare la casella
storica tramite i destinatari dei messaggi e riutilizzarne l'id interno, cosi
che messaggi nuovi, storico, alias e collegamenti continuino nella stessa
conversazione invece di creare una seconda chat.

La configurazione WhatsApp DEVE mostrare una diagnostica webhook priva di dati
cliente: ultimo evento/campo, ultimo `smb_message_echoes`, quantità di eventi
echo e rapporto tra messaggi echo ricevuti e registrati. Testi, numeri, nomi e
message id non entrano nella diagnostica. Un echo consegnato ma già presente
deve risultare `duplicato`; l'assenza di `ultimoEchoAt` indica invece che Meta
non ha ancora consegnato quel campo al CRM. Il payload previsto usa
`changes[].field = smb_message_echoes` e `value.message_echoes[]`.

### 51.8 Sincronizzazione storico coexistence
Dopo l'onboarding il server richiede automaticamente contatti e storico entro
la finestra Meta di 24 ore. L'accettazione delle chiamate `smb_app_data` imposta
`storicoRichiestoAt`, ma NON equivale al completamento. I webhook `history`
aggiornano `storicoUltimoEventoAt` e `storicoProgresso`; soltanto un blocco con
progresso 100 imposta `storicoCompletatoAt` e il campo legacy
`storicoSincronizzato`.

Per ogni `history[].threads[]`, `thread.id` è la controparte canonica della
conversazione sia per i messaggi in ingresso sia per quelli in uscita. Gli echo
live continuano a usare `to`/`recipient_id`. Un messaggio senza controparte
normalizzabile viene rifiutato con log privacy-safe e non crea conversazioni
vuote. Una migrazione PostgreSQL una tantum elimina esclusivamente gli outbound
WhatsApp legacy con `mittente` vuoto, liberando i `message_id` per una nuova
importazione dopo il re-onboarding.

La UI mostra stati distinti `non richiesto`, `richiesto/in attesa`, progresso e
`completato`, aggiornandosi automaticamente durante la consegna. Non deve
presentare una richiesta accettata come storico già sincronizzato.

### 51.9 Verifica esterna
Senza `DATABASE_URL` lo sviluppo locale usa il fallback in memoria: test,
typecheck e build non dimostrano query PostgreSQL, dati o integrazioni Railway.
Prima di pubblicare devono essere verificate su Railway le route e i redirect,
lo scope tra sedi, la casella Email e i suoi allegati, la configurazione
WhatsApp e l'assenza di controlli di invio.

La verifica WhatsApp è completa soltanto quando la configurazione risulta
attiva, il webhook riceve `history`, lo storico raggiunge il completamento, un
echo live viene registrato e almeno un outbound precedente al collegamento è
visibile nel thread corretto. Il 23/08/2026 questi criteri sono stati verificati
in produzione: `1/1` configurazioni attive, storico completato, `195` messaggi
totali, echo live `1/1` e outbound del 18/08 correttamente etichettato `Tu:`.

Se il percorso coexistence corretto genera un QR o codice nuovo ma WhatsApp
Business lo rifiuta sul telefono, aggiornare e riavviare prima l'app. Come
ultima misura è consentita la reinstallazione soltanto dopo aver verificato
dall'app un backup chat riuscito e ripristinabile. Dopo il ripristino si ripete
Embedded Signup scegliendo `Collega l'app WhatsApp Business` e condividendo lo
storico. Non eliminare il numero/WABA su Meta e non cancellare le comunicazioni
CRM come tentativo di risoluzione.

---

## 51-bis. Chat aziendale (`/chat`)

### 51-bis.1 Scopo
Comunicazione interna fra le persone dell'ufficio, distinta da Email e WhatsApp
che parlano con i clienti. Persistita in tabelle PostgreSQL dedicate
(`chat_canali`, `chat_messaggi`, `chat_letture`), con fallback in memoria senza
`DATABASE_URL`.

### 51-bis.2 Canali
- `generale`: uno per sede, non si lascia. Riceve le azioni che Tars esegue in
  autonomia e tutte le decisioni degli operatori sulle proposte, con nome di
  chi ha deciso. È un registro, non una notifica.
- `diretto`: fra due persone. La chiave è la coppia ordinata di id, quindi la
  conversazione è la stessa nei due versi. L'id 0 è riservato a Tars.
- `commessa`: previsto nel modello, non ancora esposto.

### 51-bis.3 Notifiche di assegnazione
Assegnare una commessa, un cliente, un ticket o un intervento a un'altra
persona produce un messaggio nella sua conversazione diretta con Tars. Il
consumer è separato dal proiettore delle notifiche: la campanella dipende da
`notificationMode`, il messaggio in chat arriva comunque. Assegnarsi qualcosa
da soli non produce messaggio.

### 51-bis.4 Vincoli
Scope sede su ogni lettura e scrittura; un canale di un'altra sede risponde
`NOT_FOUND`. I messaggi di sistema hanno autore nullo e non sono scrivibili dal
client. Il segnalibro di lettura non arretra. Limiti attuali: refresh a polling
di 5 secondi, nessun allegato, nessuna modifica o cancellazione dei messaggi,
nessun push a CRM chiuso.

## 52. Design system, caricamento e analytics

### 52.1 Identità visuale
Il tema usa Plus Jakarta Sans, fondo grigio caldo, card bianche, testo inchiostro e giallo saturo come accento. Successo, warning, errore e informazione restano cromaticamente distinti. I componenti operativi usano bordi visibili, raggio moderato e ombre leggere; sono vietati colori locali che ricreano una palette fredda o opaca.

### 52.2 Responsive e tabelle
Clienti, Commesse e Comunicazioni non devono richiedere scroll orizzontale globale. Gli header sticky devono occupare spazio nel flusso e non coprire la prima riga. Le colonne secondarie si nascondono progressivamente; controlli e titoli rifluiscono senza sovrapporsi.

### 52.3 Code splitting
Ogni pagina è importata con `React.lazy` e caricata dentro un `Suspense` stabile. Il build separa i vendor React, UI, dati e grafici per caching indipendente. Il runtime Manus, JSX location e il debug collector sono ammessi soltanto sul dev server e non devono gonfiare `index.html` di produzione.

### 52.4 Umami
Lo script Umami viene installato soltanto in produzione, con endpoint HTTP(S) valido e website id presenti. Ha un id univoco per evitare duplicati, usa `async`/`defer` e si rimuove in caso di errore di caricamento. In sviluppo non deve generare richieste o warning console.

---

## 53. Piattaforma operativa Tars

### 53.1 Eventi e notifiche
Le modifiche business rilevanti producono eventi sede-scoped con chiave di
deduplica. Ogni consumer mantiene stato indipendente, retry limitato,
dead-letter e recupero dei lease stale. Le assegnazioni devono notificare il
nuovo responsabile con link all'entita; presa in carico o completamento
risolvono il gruppo canonico invece di generare nuovi avvisi.

Le notifiche realtime usano SSE con replay da `Last-Event-ID`; il polling resta
fallback. L'attivazione avviene per sede nell'ordine eventi shadow,
notifiche shadow, notifiche active, SSE e infine Web Push.

### 53.2 Contesto, planner e workflow
Tars usa fascicoli materializzati separati per sede, entita e visibility scope.
I piani sono persistenti, versionati, riprendibili dopo domanda o approvazione
e idempotenti dopo riavvio. Il workflow cliente + prima commessa conserva ogni
operazione riuscita e riparte dal primo passo incompleto senza duplicare dati.
Le mutation restano quelle applicative e richiedono approvazione dell'utente.

Stato rollout: il contesto e il planner restano in `off`/`shadow`. Il server
rifiuta `contextEngineMode=active` finché email, WhatsApp, documenti, fatture,
pagamenti e appuntamenti non pubblicano tutti gli eventi necessari; rifiuta
`plannerMode=active` finché non sono registrati gli executor di produzione.
Un valore `active` salvato da versioni precedenti viene degradato a `shadow` al
bootstrap. Il workflow cliente + commessa approvato continua a funzionare
attraverso la saga applicativa esistente, indipendente dal worker planner.

### 53.3 Ricerca ibrida
`ricerca_ibrida` indicizza fonti versionate da email, WhatsApp, clienti,
commesse, note, documenti estratti e conoscenza. Ogni chunk conserva sede,
scope, checksum, versione e riferimenti entita. Il ranking privilegia
identificatori e riferimenti strutturati, poi testo e vettori; la policy della
fonte viene ricontrollata dopo il ranking. Sono restituiti al massimo otto
frammenti con evidence ref. Se `pgvector` non e presente, nessuna estensione
viene installata e la ricerca testuale continua con la parte semantica `off`.

Stato rollout: chunking, ACL, versioni, delete e fallback lessicale sono
implementati; producer completi ed embedding reali di indice/query non lo sono.
Per questo `semanticSearchMode=active` e rifiutato e Tars usa i reader CRM
strutturati. La denominazione semantica non deve essere presentata come attiva
prima della chiusura di entrambi i requisiti.

### 53.4 Apprendimento e autonomia
Approvazioni, modifiche, rifiuti, undo, verifiche e incidenti generano esiti
strutturati per capability e versione. Il testo libero non viene promosso a
regola aziendale. Fa eccezione il feedback esplicito con cui un operatore
corregge una proposta di esperimento: entra, con limite e audit, nel solo blocco
dinamico delle decisioni recenti per evitare che Tars ripeta lo stesso errore;
non modifica prompt di sistema, conoscenza aziendale o gate di autonomia. Non
esiste una media generale abilitante.

Autonomia e negata per default e la whitelist iniziale e vuota. La singola
capability richiede almeno sei settimane, cento esiti, accuratezza >=98%, zero
incidenti, eval allegato, decisione della direzione, feature flag, undo e
principal minimo. Rischio alto, irreversibilita, kill switch o cambio di
modello, prompt o workflow negano o revocano immediatamente la qualifica.

### 53.5 Diagnostica
`diagnostica.snapshot` e accessibile solo alla direzione. Mostra code eventi
per consumer, dead-letter, notifiche pendenti, connessioni SSE, piani per stato,
cache e token per workflow. Non espone prompt, corpi di comunicazioni, numeri,
email, token, user id o entity id come label metrica.
