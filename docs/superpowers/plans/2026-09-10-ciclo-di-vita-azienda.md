# Ciclo di vita dell'azienda — nascita, vita, uscita (10/09/2026)

Mandato: punti 1–4 della nota della direzione del 10/09 («Aziende: nascita,
vita, uscita»). Il punto 5 (inventario delle asimmetrie del tenant 1) resta
fuori da questo piano.

## Decisioni di progetto

- **D1 — Stati del tenant.** `StatoTenant` diventa
  `in_attesa | attivo | sospeso | archiviato | cancellato`. Niente
  `in_prova` né `scaduto` sul tenant: vivono già sull'abbonamento
  (`trialing`, `suspended` oltre tolleranza) e duplicarli creerebbe due
  fonti di verità. Il tenant resta il **cancello operativo**, l'abbonamento
  la **verità di fatturazione** (com'è dal WS4).
- **D2 — Semantica degli stati.**
  - `in_attesa`: nata (dal modulo pubblico) ma invito mai accettato. Nessun
    login, nessun worker (`tenantsAttivi` già filtra su `attivo`), nessuna
    rotta anonima. All'accettazione dell'invito → `attivo` + evento
    `attivato`.
  - `sospeso`: invariato (sola lettura, login permesso).
  - `archiviato`: uscita ordinata reversibile. Login rifiutato, sessioni
    esistenti rifiutate da `motivoRifiutoTenant` (query e mutation), worker
    esclusi. Dati intatti.
  - `cancellato`: come archiviato + `cancellato_il`. Dopo 30 giorni di
    ritenzione il giro del ciclo di vita accoda `svuota_tenant`
    (cancellazione differita). `riattiva` funziona finché `svuotato_il` è
    NULL; dopo lo svuotamento mai più.
- **D3 — Transizioni valide** (un passaggio alla volta, comandi con eventi):
  - `archivia`: da `attivo`/`sospeso`. Mai il tenant 1.
  - `cancella`: da qualunque stato tranne `cancellato`. Mai il tenant 1.
  - `riattiva`: da `sospeso`/`archiviato`/`cancellato` (se non svuotato).
    Da `in_attesa` NO: lì l'attivazione passa solo dall'invito.
  - `sospendi`: solo da `attivo` (comportamento di fatto già così: gli
    abbonamenti chiamano `sospendi` solo su tenant attivo).
- **D4 — Colonne additive su `tenants`**: `cancellato_il TIMESTAMPTZ`,
  `svuotato_il TIMESTAMPTZ`. Il CHECK di `tenants.stato` e quello di
  `tenant_comandi.tipo` si rifanno col pattern già in uso (si guarda
  `pg_get_constraintdef` e si ricrea solo se manca l'ultimo valore).
- **D5 — Svuotamento (`svuota_tenant`)**: comando, mai una scrittura
  sparsa. Guardie: mai tenant 1, solo `cancellato`, solo se
  `svuotato_il IS NULL`, solo oltre la ritenzione (30 giorni) salvo flag
  esplicito da CLI. Passi: file dello storage (stessa camminata di
  `ricalcolaStorage`, estratta in un helper condiviso), righe delle tabelle
  per sede (`tenant_id = X`, nomi SOLO da `TABELLE_PER_SEDE`), righe
  `kv_store` `tenant:<id>:%` + scarico degli store in memoria, utenti e
  sedi del tenant dagli store globali, specchio `tenant_sedi`,
  `oauth_state`, `tenant_inviti`, `tenant_storage`. La riga `tenants` resta
  come lapide: `svuotato_il = NOW()`, slug liberato → `cancellata-<id>`,
  fatturazione e note azzerate (PII), evento `svuotato` con i conteggi.
  La riga `abbonamenti` resta (storia, tabella guardiata). Al boot i tenant
  svuotati non istanziano più store.
- **D6 — Giro del ciclo di vita** (dopo il `listen`, ogni 6 ore, come il
  worker abbonamenti): `in_attesa` più vecchie di 14 giorni → comando
  `cancella` (motivo «prova mai attivata»); `cancellato` oltre ritenzione e
  non svuotate → comando `svuota_tenant`. Tutto passa dalla coda: tracciato
  e ritentabile.
- **D7 — Iscrizione pubblica** («Prova gratuita»): router tRPC pubblico
  `iscrizione` (stesso stile di `invitiRouter`), dietro un **interruttore di
  piattaforma nuovo `iscrizionePubblica`, spento di default** e dietro
  `postaConfigurata()` (senza Resend il modulo non si offre: il link
  d'invito non esce MAI verso il browser anonimo — arriva solo per email,
  che è anche la verifica dell'indirizzo). `registra`: rate limit per IP,
  honeypot, slug derivato dal nome (con suffisso se occupato), accoda lo
  stesso comando `crea` con `statoIniziale: "in_attesa"` (campo nuovo del
  payload, default `attivo`: pannello e CLI invariati) e poi
  `invitaProprietario`. Risposta sempre generica («controlla la casella»):
  un'email già in uso non si distingue da fuori. Pagina client `/prova`
  fuori dalla shell, come `/invito/:token`.
- **D8 — Inviti, i tre buchi.**
  - Disattivare (`utenti.update` con `attivo: false`) o eliminare
    (`utenti.delete`) un utente annulla i suoi inviti ancora validi +
    evento `invito_annullato`. Solo a interruttore acceso.
  - Reinvio: `invitaProprietario` rifiuta se per quell'utente esiste un
    invito valido emesso da meno di 10 minuti. Il flusso «email cambiata»
    non lo sente: annulla prima, quindi non c'è più un invito valido.
  - Seconda autenticazione dopo la password: **fuori scope** — nel prodotto
    non esiste alcuna infrastruttura MFA; costruirla qui sarebbe un
    workstream a sé. Registrato come debito, decisione alla direzione.
- **D9 — Percorso di attivazione come eventi.** Tre pietre miliari nuove in
  `tenant_eventi`: `prima_commessa`, `prima_fattura`,
  `primo_utente_aggiunto` (un utente creato dal router `utenti.create`,
  cioè oltre il proprietario). Emissione via helper
  `segnaPietraMiliare(tenantId, tipo)`: cache in memoria per
  (tenant, tipo), una sola query di esistenza per boot, mai un errore che
  propaga nel flusso di dominio, inerte a interruttore spento.
  `invito_accettato` esiste già ed è la quarta tappa. La scheda del
  pannello mostra il percorso; l'elenco lo riassume con UNA query in più
  (dentro la regola di costo di `letture.ts`).
- **D10 — Login.** `auth.login`, a interruttore acceso, rifiuta gli utenti
  di tenant `in_attesa`/`archiviato`/`cancellato` con un messaggio unico
  generico (dopo la verifica della password, come il rifiuto R10).
  `motivoRifiutoTenant` rifiuta anche le letture per quegli stati (il
  sospeso resta sola-lettura come oggi).

## Task

1. **Stati e transizioni (server)** — tipi, CHECK, colonne, servizio
   (`archivia`, `cancella`, guardia transizioni su
   sospendi/riattiva/archivia/cancella), eventi nuovi, comandi
   `archivia`/`cancella` (schema payload, esecutore, CHECK), regole +
   login, repo memoria e Postgres, router piattaforma
   (`archivia`/`cancella`; `riattiva` esteso), CLI `stato` con
   `--archivia`/`--cancella`. Test mirati (memoria) + pg.
2. **Inviti** — annullamento automatico su disattiva/elimina; limite
   reinvio 10 minuti. Test.
3. **Svuotamento** — helper camminata file, `svuotamento.ts`, comando
   `svuota_tenant`, rimozione store in memoria (persistence), esclusione
   svuotati al boot, lapide. Test (pg dove serve, memoria per le guardie).
4. **Giro del ciclo di vita** — 14 giorni / 30 giorni, avvio dopo il
   `listen`, test con date RELATIVE (mai fisse: v. memoria «bombe a
   orologeria»).
5. **Iscrizione pubblica** — interruttore, router `iscrizione`,
   `statoIniziale` nel payload `crea`, attivazione all'accettazione
   dell'invito, pagina `/prova`. Test server; pagina verificata nel
   browser.
6. **Percorso di attivazione** — helper pietre miliari, emissione in
   commesse/fatture/utenti, letture, pannello. Test.
7. **Pannello** — badge stati nuovi, azioni con conferma password,
   countdown svuotamento, percorso attivazione. Verifica 1440×900 e
   390×844 con l'harness.
8. **Documenti** — handoff.md, runbook multi-azienda, PRD (sezione WS6 /
   nuova §), CLAUDE.md se cambia un invariante.

## Fuori scope, dichiarato

- Punto 5 della nota (asimmetrie tenant 1), punti 6–22.
- MFA all'accettazione dell'invito (D8).
- Stripe / pagamento: quando arriva, cambia solo chi innesca `crea`
  (per questo l'iscrizione pubblica passa dalla stessa coda).
