# Verifica produzione — checklist di sola lettura

> Preparata il 28/08/2026 (decisione D4 del Discovery Dossier). Serve a
> fotografare lo stato reale di Railway **senza cambiare nulla**: niente
> variabili, niente flag, niente sync forzati, niente scritture. Ogni riga ha
> dove guardare e cosa annotare. Compilarla una sede alla volta e conservare
> l'esito datato in `docs/reports/`.

## 1. Infrastruttura Railway

| Cosa | Dove guardare (read-only) | Annotare |
|---|---|---|
| Numero di repliche del servizio | Railway → servizio app → Settings/Scaling | **Deve risultare 1**: `persistedStore` e il rate-limit login assumono un'istanza sola. Se >1, fermarsi e segnalarlo prima di qualsiasi altro lavoro |
| Deploy trigger | Railway → Settings → Source | Conferma che segue `main` (ogni merge è un deploy) |
| Variabili presenti (solo NOMI) | Railway → Variables | Elenco dei nomi: `DATABASE_URL`, `JWT_SECRET`, `MAIL_ENCRYPTION_KEY`, `BOOTSTRAP_ADMIN_*`, `GOOGLE_OAUTH_*`, `FIC_OAUTH_*`, `STORAGE_DRIVER`, `S3_*`, `ACTION_CENTER_MODE`, `OPENAI_API_KEY` (residuo: oggi nessun consumatore). **Non copiare i valori da nessuna parte** |
| Volume montato | Railway → servizio → Volumes | Se assente e `STORAGE_DRIVER=local`, i file caricati nuovi vivono solo come base64 inline (guardia effimero attiva) |

## 2. Flag di piattaforma per sede

`platform.flags` è di sola lettura e i flag sono congelati ai valori salvati
(l'endpoint di scrittura è stato rimosso con l'agente — handoff §13).
Da un utente direzione, per ogni sede attiva:

- Aprire il CRM e leggere `platform.flags` (dev tools → risposta tRPC, oppure
  chiedere uno snapshot alla prossima sessione di sviluppo).
- Annotare: `eventBusMode`, `notificationMode`, `realtimeNotifications`,
  `webPushEnabled`, `policyMode`, e i tre modi legacy
  (`contextEngineMode`/`plannerMode`/`semanticSearchMode`, attesi `off`/`shadow`).
- `ACTION_CENTER_MODE` è una variabile d'ambiente, non un flag: annotare il
  valore dalla lista nomi (il default nel codice è `shadow`).
- Conseguenza da verificare a valle: con `eventBusMode=off` le assegnazioni
  non producono né notifiche né messaggi in chat (PRD §51-bis.3).

## 3. Storage e backup

| Cosa | Dove guardare | Annotare |
|---|---|---|
| Driver storage attivo | Integrazioni → card storage (`fileStorage.status`) | `local` o `s3`; presenza guardia effimero |
| Probe R2 (sola lettura) | **Solo se già configurato**: `pnpm storage:check` — configurazione + GET su chiave inesistente; **zero scritture** (hardening 29/08/2026). La sonda completa put/get/delete è lo script npm separato `storage:probe-write` (flag `--scrivi` obbligatorio): NON fa parte di questa checklist e va autorizzata come qualsiasi scrittura | esito |
| Documenti ancora inline | `pnpm storage:dry-run` (non applica nulla) | conteggio `da migrare` |
| Ultimo backup Drive | Integrazioni → card Backup (`backup.status`/`log`) | data, esito, dimensione dell'ultimo run riuscito; il vincolo delle 24 h per le migrazioni dipende da questo |
| Restore mai provato? | `docs/storage-r2.md` + memoria operativa | Se non esiste un restore drill documentato, annotarlo come debito |

## 4. Fatture in Cloud

- Integrazioni → card FiC per ogni sede: modalità (`oauth`/`manual`),
  scadenza credenziali, azienda selezionata, sync abilitato, ultimo esito e
  contatori (`fattureInCloud.status`).
- Annotare quali sedi hanno completato «Ricollega e aggiorna permessi» dopo
  l'ampliamento scope del 25/08 (handoff §5).
- Non lanciare `Sincronizza ora` durante la fotografia.

## 5. Segreti e credenziali

- Età di `JWT_SECRET`, `MAIL_ENCRYPTION_KEY`, credenziali OAuth (Google,
  FiC), token R2: quando sono stati generati/ruotati l'ultima volta?
- Utenti seed storici ancora attivi in `/utenti`? (handoff §8: da ruotare.)
- Token GitHub dell'operatore: `gh auth status` sul computer dell'operatore e
  revoca dal portale di quelli non riconosciuti.

## 6. Cronologia Git

- La history contiene ancora vecchie password seed (handoff §8). Decisione
  pendente e SEPARATA: purge con `git filter-repo` = riscrittura SHA +
  force-push coordinato + riallineamento di ogni clone. Da qui: solo annotare
  che la decisione resta aperta, non eseguire nulla.

## 7. Conteggi di riscontro (facoltativi, sola lettura)

Da una sessione direzione nel CRM, annotare per sede: numero clienti,
commesse attive, fatture FiC collegate/da riconciliare, costi `dubbio`,
comunicazioni in coda. Servono da baseline per confrontare gli effetti delle
prossime slice.

---

**Regola finale:** questa checklist non autorizza alcuna modifica. Qualsiasi
correzione emersa (flag sbagliato, credenziale da ruotare, replica >1) torna
come proposta scritta e si esegue solo con autorizzazione esplicita della
direzione, mai contro l'istanza viva (handoff §12.8).
