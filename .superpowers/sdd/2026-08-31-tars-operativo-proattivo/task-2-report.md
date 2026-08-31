# Task 2 / T1 — rapporto di implementazione

Data: 31/08/2026

Worktree: `/Users/timmy/Ruffino Group/infissi-ops-app/.worktrees/tars-main`

Branch: `main`

Baseline verificata: `a283572`

Commit implementazione: `526d86f` (`feat(tars): add central action registry`)

## Esito

Implementato il registro centrale versionato delle 21 azioni Tars correnti,
con classificazione R separata dal campo storico L, policy contestuale,
validazione degli output e ledger append-only per gli esiti R1.

- Classificazione deterministica: 12 R0, 8 R1, 1 R3; nessuna R4.
- `livello` L0-L4 resta invariato e non viene derivato dal rischio R.
- Tutti i 21 tool sono importati nel registro una sola volta; un tool nuovo,
  duplicato o senza metadati rende invalido il registro.
- Ogni descrittore dichiara rischio, capability, scope, schema risultato,
  prerequisiti, idempotenza, audit, compensazione, flag, timeout e costo.
- Il catalogo viene filtrato per capability, sede valida, direzione, flag,
  entità attiva, superficie e intento. Senza selettori mantiene il catalogo
  storico; quando nessun profilo corrisponde espone soltanto il fallback R0
  `cerca_commesse`, sempre soggetto ad authz e flag.
- L'orchestratore include i selettori nelle chiavi C0/C2, valida lo schema
  risultato e registra gli esiti R1 soltanto dopo il servizio di dominio.
- Il ledger R1 non riceve callback di esecuzione e non autorizza azioni: salva
  idempotency key, versione oggetto, esito, audit e compensazione. In
  produzione richiede PostgreSQL; la memoria e l'iniezione sono ammesse solo
  con `NODE_ENV=test`.
- Le guardie strutturali negano R4, `executeSql`, `updateRecord`, `force`, tool
  di auto-approvazione, import provider grezzi e UPDATE/DELETE del ledger.

## TDD — RED osservati

### RED iniziale

Comando:

```bash
pnpm test -- server/tars/azioni/registry.test.ts server/tars/costi/confine.test.ts
```

Esito atteso: exit code 1. `registry.test.ts` non veniva caricato perché
`azioni/registry.ts` non esisteva; le tre nuove guardie in
`confine.test.ts` fallivano per assenza di `registry.ts`, `policy.ts` ed
`executions.ts`. Riepilogo: 2 file falliti, 83 passati, 1 saltato; 3 test
falliti, 769 passati, 5 saltati.

### RED di self-review

Dopo il primo GREEN è stato aggiunto un test contro la deriva fra descrittore
e tool storico. Lo stesso comando è uscito con code 1 perché
`validaRegistroAzioni` non rifiutava ancora una capability rimossa. Riepilogo:
1 test fallito, 791 passati, 5 saltati. La correzione minima confronta ora le
capability e richiede nel descrittore ogni flag dichiarato dal tool.

## GREEN e verifiche

### Test richiesti, esecuzione finale

```bash
pnpm test -- server/tars/azioni/registry.test.ts server/tars/costi/confine.test.ts
```

Exit code 0. Per la configurazione dello script `pnpm test`, Vitest ha eseguito
l'intera suite: 85 file passati, 1 file PostgreSQL condizionale saltato; 792
test passati, 5 saltati. I due file richiesti sono passati rispettivamente con
20 test (`registry.test.ts`) e 13 test (`confine.test.ts`).

### Typecheck

```bash
pnpm check
```

Exit code 0 (`tsc --noEmit`).

### Build

```bash
pnpm build
```

Exit code 0: Vite ha trasformato 3117 moduli ed esbuild ha prodotto
`dist/index.js`.

### Integrità del delta

```bash
git diff --check
git diff --cached --check
git diff --name-only -- client
```

Tutti exit code 0; l'ultimo comando non ha prodotto output. Nessun file
`client/` è stato modificato.

## File

Nuovi:

- `server/tars/azioni/types.ts`
- `server/tars/azioni/registry.ts`
- `server/tars/azioni/policy.ts`
- `server/tars/azioni/executions.ts`
- `server/tars/azioni/registry.test.ts`

Modificati:

- `server/tars/strumenti/tipi.ts`
- `server/tars/profili.ts`
- `server/tars/orchestratore.ts`
- `server/tars/costi/confine.test.ts`

## Self-review

- Compatibilità: nessun livello L o schema input dei tool è stato cambiato;
  i selettori di `ContestoRun` sono opzionali.
- Authz: il catalogo continua a richiedere tutte le capability del tool e ora
  applica anche master flag, sede positiva e prerequisiti contestuali.
- Idempotenza: il ledger usa l'identità di effetto restituita dal dominio (o
  un hash stabile quando assente) e `ON CONFLICT DO NOTHING`; non riesegue il
  tool.
- Audit: il ledger è append-only per costruzione e non espone update/delete.
- Cache: superficie, tipo entità e intento entrano nelle impronte del profilo,
  impedendo riuso fra cataloghi diversi.
- Sicurezza: nessun nuovo import provider/OpenAI, nessun SQL generico, nessun
  `force`, nessuna procedura di approvazione esposta al modello.
- Scope: nessuna modifica UI, budget, configurazione provider, flag, Railway,
  deploy o servizio esterno.

## Riserva esplicita

Non è stato configurato né contattato un PostgreSQL reale. La persistenza è
coperta dal DDL, dal percorso `kvSql`, dalle guardie strutturali e dalla
semantica testata sul ledger in memoria; i 5 test PostgreSQL condizionali del
repository sono rimasti saltati senza `DATABASE_URL`. Una prova di deploy o
di migrazione su Railway non è stata eseguita e non viene dichiarata conclusa.

---

## Fix round 1/5 — write-ahead R1 e rilievi review

Commit implementazione: `e53db51` (`fix(tars): reserve R1 effects before execution`)

Questa sezione sostituisce, per il protocollo R1, le descrizioni precedenti
basate sulla registrazione post-effetto.

### Esito

- Il ledger esegue una reservation autorevole e atomica prima del tool. La
  reservation e ogni transizione successiva sono righe immutabili; la
  proiezione corrente usa l'ultimo evento `reserved`, `settled` o `uncertain`.
- Un errore di reservation o DDL produce zero effetti. Dopo una reservation,
  un errore del tool/schema viene marcato `uncertain`; un errore di settle
  lascia comunque la reservation durabile e tenta di aggiungere `uncertain`.
  In entrambi i casi il retry non richiama il tool.
- Un retry settled riusa l'esito persistito. La chiave pre-effetto è un hash
  canonico di sede, principal, tool, versione tool, versione registro e input
  validato, quindi non dipende da C1 né dall'`azioneId` prodotto dopo l'effetto.
- Per un effetto compensato di `crea_promemoria`, lo stato autorevole del
  servizio promemoria può aprire una nuova generazione immutabile. Il ledger
  non decide lo stato business e non autorizza l'azione.
- In produzione senza PostgreSQL gli R1 non entrano nel catalogo. Lo store in
  memoria e l'override sono disponibili solo con `NODE_ENV=test`.
- La compensazione statica ora coincide con gli esiti reali: soltanto
  `crea_promemoria` espone l'undo R1; nessuna compensazione viene inventata per
  spostamenti, casi o memoria.
- Gli scope sono dichiarati tool per tool; non sono più derivati dalla
  lunghezza di `entita`. Gli schema azione richiedono il nome tool letterale,
  `undoEntro`, `undoVia` e `conferma` coerente.
- L'eval idempotenza conta i record reali nel repository: il riuso dello stesso
  esito `creato` non viene confuso con un secondo effetto.

### TDD — RED osservati

Test scritti prima dell'implementazione:

```bash
pnpm exec vitest run server/tars/azioni/registry.test.ts server/tars/orchestratore.test.ts server/tars/costi/confine.test.ts
```

Exit code 1 atteso: 38 test falliti, 30 passati. I fallimenti hanno coperto
scope derivati, compensazioni non coerenti, schema che accettava tool errato o
campi mancanti, R1 esposti senza PostgreSQL, assenza delle API `prenota` e
`concludi`, assenza della tabella eventi e chiamata tool precedente alla
reservation.

Prima verifica di regressione completa:

```bash
pnpm test
```

Exit code 1: 5 test falliti, 796 passati, 5 saltati. I fallimenti hanno reso
esplicito il nuovo contratto settled-reuse e il caso legittimo di ricreazione
dopo compensazione.

Dopo la correzione della generazione post-compensazione, una seconda suite ha
lasciato un solo RED: 1 test eval fallito, 800 passati, 5 saltati. La causa era
la metrica che inferiva un duplicato dalla parola `creato`, invece di contare
i record autorevoli.

### GREEN e verifiche finali

```bash
pnpm exec vitest run server/tars/promemoria.test.ts server/tars/t7Memoria.test.ts server/tars/azioni/registry.test.ts server/tars/orchestratore.test.ts server/tars/costi/confine.test.ts
```

Exit code 0: 5 file, 93 test passati. Copertura inclusa: reservation fallita
con contatore effetto zero; settle fallito con stato incerto e retry fermo a
un solo effetto; doppia call semanticamente identica con C1 miss e un solo
effetto; due input legittimi con due effetti, due chiavi e due audit;
compensazione, matrice scope, schema tool-specifico e campi completi.

```bash
pnpm exec vitest run server/tars/eval/eval.test.ts
pnpm test
pnpm check
pnpm build
git diff --check
git diff --name-only | rg '^client/'
```

Tutti i comandi applicabili sono verdi. Suite completa finale: 85 file
passati, 1 file PostgreSQL condizionale saltato; 801 test passati, 5 saltati.
`pnpm check` (`tsc --noEmit`) e `pnpm build` sono usciti con code 0; Vite ha
trasformato 3117 moduli ed esbuild ha prodotto `dist/index.js`.
`git diff --check` non ha segnalato errori e la guardia `client/` non ha
prodotto file.

### File del fix

- `server/tars/azioni/executions.ts`
- `server/tars/azioni/policy.ts`
- `server/tars/azioni/registry.ts`
- `server/tars/azioni/types.ts`
- `server/tars/orchestratore.ts`
- `server/tars/strumenti/promemoria.ts`
- `server/tars/eval/runEval.ts`
- `server/tars/azioni/registry.test.ts`
- `server/tars/orchestratore.test.ts`
- `server/tars/costi/confine.test.ts`
- `server/tars/promemoria.test.ts`
- `server/tars/t7Memoria.test.ts`

### Self-review del fix

- Sicurezza dell'effetto: non esiste più un percorso R1 che raggiunga
  `strumento.esegui` prima di una reservation riuscita. Il test strutturale
  verifica anche l'ordine nel sorgente.
- Append-only: le due tabelle ricevono solo `INSERT`; non esistono `UPDATE` o
  `DELETE`. La tabella base preserva la compatibilità col DDL già introdotto,
  mentre gli eventi forniscono la macchina a stati.
- Concorrenza: `ON CONFLICT DO NOTHING` rende atomico il preclaim; settle e
  uncertain serializzano sulla reservation con `FOR UPDATE`.
- Identità: audit e azioni distinte non collidono più sull'identità entità;
  la reservation usa l'identità canonica della richiesta, e le nuove
  generazioni usano l'id immutabile della reservation precedente.
- Compatibilità: `livello` L0-L4, gli input tool e i selettori opzionali di
  `ContestoRun` restano invariati. Gli esiti settled vengono restituiti
  integralmente, inclusi audit e dati originari.
- Confini rispettati: nessuna modifica in `client/`, budget, provider, flag,
  Railway o servizi esterni; nessuna chiamata OpenAI, deploy o push.

### Riserva del fix

Il percorso PostgreSQL reale non è stato eseguito perché il worktree non ha
una `DATABASE_URL` di test. La correttezza SQL è coperta da typecheck, test
strutturali e dallo stesso adapter `kvSql`; la semantica completa è coperta
dal ledger in memoria test-only. I 5 test PostgreSQL condizionali restano
saltati e non viene dichiarata una migrazione o verifica Railway.
