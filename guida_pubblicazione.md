# Guida alla Pubblicazione di Infissi Ops App

**Autore:** Manus AI  
**Data:** 10 Aprile 2026  

Questa guida spiega passo dopo passo come pubblicare online la web app "Infissi Ops App". Basandomi sull'analisi del codice sorgente, l'applicazione è costruita con uno stack full-stack moderno: **Vite + React** per il frontend, **Express + Node.js** per il backend (servito tramite tRPC), e **MySQL** come database gestito tramite Drizzle ORM.

## 1. Analisi dello Stack Tecnico

Per pubblicare l'applicazione, è fondamentale comprendere di quali servizi ha bisogno per funzionare correttamente in produzione:

| Componente | Tecnologia | Requisito di Hosting |
|---|---|---|
| **Frontend & Backend** | React + Express (Node.js) | Un ambiente di esecuzione Node.js in grado di eseguire il comando `npm run start` (che lancia `node dist/index.js`). L'app serve sia le API che i file statici del frontend dallo stesso server. |
| **Database** | MySQL | Un database MySQL accessibile pubblicamente o all'interno della stessa rete virtuale del server Node.js. |
| **Storage (Opzionale)** | AWS S3 (o compatibile) | Uno storage a oggetti per salvare immagini, audio e documenti PDF generati dall'app. L'app usa `@aws-sdk/client-s3`. |

## 2. Scelta della Piattaforma di Hosting

Data l'architettura monolitica (frontend e backend serviti dallo stesso processo Node.js) e la necessità di un database relazionale, le piattaforme PaaS (Platform as a Service) moderne sono la scelta migliore rispetto ai tradizionali VPS (Virtual Private Server), poiché riducono drasticamente la complessità di configurazione.

Le tre opzioni principali sono:
1. **Railway** (Consigliata)
2. **Render**
3. **Fly.io**

### Perché consigliamo Railway?
Railway è attualmente la piattaforma più indicata per questo specifico stack [1]. Permette di creare sia il servizio Node.js che il database MySQL all'interno dello stesso "Progetto", garantendo una connessione sicura e veloce tra i due. Inoltre, riconosce automaticamente i progetti basati su `package.json` e li compila senza necessità di configurare file Docker.

## 3. Guida Passo-Passo per la Pubblicazione su Railway

### Fase 1: Preparazione del Codice

Prima di pubblicare, assicurati che il codice sia pronto e caricato su GitHub.

1. **Verifica gli script nel `package.json`**:
   Assicurati che lo script di build sia configurato per compilare sia il frontend che il backend. Nel tuo progetto attuale, lo script `"build": "vite build && esbuild server/_core/index.ts ..."` è già impostato correttamente.

2. **Carica il codice su GitHub**:
   Se non l'hai già fatto, inizializza un repository Git e fai il push del codice su GitHub. Railway si collegherà direttamente a questo repository.

### Fase 2: Configurazione su Railway

1. **Crea un account**: Vai su [Railway.app](https://railway.app/) e accedi con il tuo account GitHub.
2. **Nuovo Progetto**: Clicca su "New Project".
3. **Aggiungi il Database**: 
   - Seleziona "Provision MySQL".
   - Attendi qualche secondo affinché il database venga creato.
4. **Aggiungi l'Applicazione**:
   - Nello stesso progetto, clicca su "New" o sul tasto "+".
   - Seleziona "GitHub Repo" e scegli il repository della tua app.
   - Railway inizierà automaticamente ad analizzare e compilare il codice.

### Fase 3: Configurazione delle Variabili d'Ambiente

Affinché l'applicazione funzioni, devi configurare le variabili d'ambiente lette dal server Node.js.

1. Vai nelle impostazioni del servizio dell'applicazione (non del database) su Railway.
2. Clicca sulla tab **"Variables"**.
3. Aggiungi le seguenti variabili:

| Variabile | Valore da inserire |
|---|---|
| `DATABASE_URL` | Usa la variabile magica `${{MySQL.DATABASE_URL}}` fornita da Railway per connettersi automaticamente al DB. |
| `NODE_ENV` | `production` |
| `JWT_SECRET` | Una stringa lunga e casuale (es. generata con un password manager) per firmare i token. |
| `PORT` | `3000` (Railway sovrascriverà questa variabile se necessario, ma è buona norma impostarla). |

Se l'app utilizza funzionalità esterne (come l'upload su S3 o l'autenticazione OAuth), dovrai aggiungere anche:
- `OAUTH_SERVER_URL`
- Variabili relative ad AWS S3 (es. `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_BUCKET_NAME`).

### Fase 4: Migrazione del Database

Prima che l'app possa salvare i dati, devi creare le tabelle nel database MySQL appena provisionato.

1. Dato che il tuo `package.json` include lo script `"db:push": "drizzle-kit generate && drizzle-kit migrate"`, devi eseguirlo.
2. Puoi farlo in due modi:
   - **Localmente**: Copia il `DATABASE_URL` di Railway (lo trovi nella tab "Connect" del servizio MySQL), incollalo nel tuo file `.env` locale ed esegui `npm run db:push`.
   - **Da Railway**: Aggiungi un comando di "Pre-deploy" nelle impostazioni del servizio app su Railway, inserendo `npm run db:push`.

### Fase 5: Dominio Pubblico

1. Vai nelle impostazioni del servizio dell'applicazione.
2. Nella sezione **"Networking"**, clicca su **"Generate Domain"**.
3. Railway ti fornirà un URL pubblico (es. `infissi-ops-app-production.up.railway.app`) accessibile da qualsiasi browser.

## 4. Gestione dei File Multimediali (Storage)

Un punto di attenzione critico: **non salvare le foto dei rilievi o i PDF direttamente sul file system del server Railway**. I server PaaS hanno un file system effimero; ogni volta che l'app viene riavviata o aggiornata, i file salvati localmente andranno persi.

Devi utilizzare un servizio di Object Storage. Il tuo codice include già le librerie `@aws-sdk/client-s3`. Ti consiglio di creare un bucket su **AWS S3** o **Cloudflare R2** (che offre una generosa quota gratuita e API compatibili con S3), e configurare le relative variabili d'ambiente in Railway.

## Riferimenti

[1] "Deploying a Node.js Project with MySQL on Railway", Dev.to, Apr 19, 2025. https://dev.to/sharanappa_m/deploying-a-nodejs-project-with-mysql-on-railway-2k7n
