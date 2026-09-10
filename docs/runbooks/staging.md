# Runbook ambiente staging (dati demo e accesso di prova)

Spec: `docs/superpowers/specs/2026-09-10-staging-demo-design.md` (decisioni
D1–D8, tabella variabili, rischi R1–R4). Piano:
`docs/superpowers/plans/2026-09-10-staging-demo.md`. Moduli:
`server/_core/ambiente.ts`, `server/_core/giriEsterni.ts`, `server/staging/`.

> **Stato al 10/09/2026:** il codice dei tre meccanismi (identità
> d'ambiente, giri esterni spenti, seme demo, accesso di prova, banner) è su
> questo branch, verificato con `pnpm check`/`test`/`build` e a schermo.
> **L'ambiente Railway non è stato creato da questo lavoro**: nessuna delle
> operazioni di questo runbook è stata eseguita. Finché un operatore non le
> esegue, «staging» esiste come codice, non come ambiente raggiungibile.

## 1. Scopo e principi

Un ambiente Railway separato dalla produzione dove una modifica UI si vede
in un browser contro un server vero, prima del merge — non solo nei test.
Tre principi non negoziabili:

- **Staging non parla mai con servizi esterni** (D2): niente IMAP, Fatture
  in Cloud/SdI, Google Drive, Meta, Resend, OpenAI. Anche se qualcuno vi
  ripristinasse un backup di produzione con credenziali vere, i quattro giri
  esterni (backup Drive, sync FiC, sonda SdI, poller IMAP) restano spenti.
- **Mai dati di produzione con credenziali vere dentro** (R2): non si
  ripristina un backup di produzione in staging senza prima azzerare
  `caselle_email` e le integrazioni. Questa regola resta organizzativa — il
  codice la rende inerte, non la rimpiazza.
- **Una sola replica anche qui** (come in produzione,
  `docs/runbooks/verifica-produzione-readonly.md:13`): nessuna scalata
  orizzontale su staging.

**Nota di sicurezza sul token d'accesso.** Il token di
`GET /api/staging/entra?token=…` viaggia nella query string: può quindi
comparire nei log edge/HTTP di Railway, anche se l'applicazione stessa non
logga mai URL né token (verificato nel codice). Accettabile per un ambiente
solo-demo (spec D3), ma: ruotare `STAGING_ACCESSO_TOKEN` se quei log
vengono mai condivisi con terzi, e ruotarlo comunque a intervalli.

## 2. Creazione dell'ambiente su Railway (manuale)

Progetto Railway: `successful-playfulness`. Operazioni da eseguire a mano,
una sola volta:

1. Nuovo environment `staging` nel progetto.
2. Servizio app duplicato dallo stesso repo, sullo stesso branch `main` che
   segue la produzione (stesso `railway.json`, stesso build Nixpacks —
   niente branch parallelo per staging).
3. **Nuovo** servizio Postgres dedicato, separato da quello di produzione
   (mai condiviso: un `DELETE` per azzerare i dati demo non deve poter
   toccare righe vere).
4. Dominio: `staging.wyndoor.com` se il DNS è pronto, altrimenti quello
   generato da Railway (`*.up.railway.app`) va bene per iniziare.

## 3. Variabili

La tabella completa è nella spec, sezione «Variabili dell'ambiente staging»
(`docs/superpowers/specs/2026-09-10-staging-demo-design.md`): non si
duplica qui, si aggiorna lì se cambia.

Da generare apposta per staging, mai riusati dalla produzione:

```bash
openssl rand -base64 32   # JWT_SECRET
openssl rand -base64 32   # MAIL_ENCRYPTION_KEY
openssl rand -base64 32   # BOOTSTRAP_ADMIN_PASSWORD
openssl rand -base64 32   # STAGING_ACCESSO_TOKEN
```

Variabili che non vanno **mai** impostate su staging (dalla tabella della
spec): `RESEND_API_KEY`, `OPENAI_API_KEY`, `TARS_PROVIDER`,
`FIC_OAUTH_*`, `GOOGLE_OAUTH_*`, `GOOGLE_SERVICE_ACCOUNT_*`, `WHATSAPP_*`,
`VAPID_*`, `S3_*` (finché non nasce un bucket R2 `wyndoor-staging`
dedicato). `FATTURAZIONE_SDI_DRY_RUN` resta acceso di default: non va
spento su staging.

## 4. Primo avvio — verifica

Checklist da eseguire subito dopo il primo deploy dell'environment:

- [ ] Healthcheck verde (`/api/trpc/auth.me`, come in produzione).
- [ ] Nei log del boot compaiono
      `[ambiente] staging: giri esterni spenti (backup Drive, sync FiC, sonda SdI, poller IMAP)`
      e `[staging] seme demo: 6 clienti e 6 commesse creati`.
- [ ] `GET /api/staging/entra?token=<STAGING_ACCESSO_TOKEN>` apre una
      sessione demo e reindirizza a `/`.
- [ ] Il banner «Ambiente di prova» è visibile in entrambe le shell.
- [ ] Il pannello piattaforma (`/piattaforma`) è raggiungibile con
      `demo@wyndoor.com` (o l'email scelta in `BOOTSTRAP_ADMIN_EMAIL`).
- [ ] Dal pannello, creare un'azienda di prova: il link d'invito compare
      **nel pannello** invece di essere spedito via email, perché
      `RESEND_API_KEY` non è impostata — comportamento atteso, non un
      guasto.
- Il log del primo avvio NON contiene «is busy» sulla porta: in produzione e staging la porta non scansiona più — se compare, il gate `inProduzione` non ha funzionato.

## 5. Ambienti per PR

Con l'environment `staging` stabile, accendere la levetta Railway «PR
environments» che lo forka: ogni pull request riceve un servizio app e un
Postgres nuovi, entrambi vuoti, e il seme demo gira da solo al primo boot —
nessun codice in più (D8).

Sul primo PR aperto dopo l'accensione, verificare che il Postgres forcato
sia **vuoto e separato** da quello di `staging` (non lo stesso database, non
righe ereditate) prima di fidarsi del meccanismo per i PR successivi.

## 6. Manutenzione

- **Scostamento da produzione (R4).** Ogni variabile aggiunta in produzione
  va aggiunta anche a staging nella stessa sessione di lavoro: stesso
  branch, stesso `railway.json`, stessi flag — le uniche differenze ammesse
  sono quelle della tabella nella spec.
- **Azzerare i dati demo.** Due strade: cancellare le righe di `kv_store`
  sul Postgres di **staging**, oppure ricreare da zero il servizio Postgres
  di staging (il seme demo ripopola al boot successivo su store vuoti).
  **Mai** toccare il Postgres di produzione: controllare `DATABASE_URL` due
  volte prima di qualunque `DELETE`, per esteso, non solo l'host.
