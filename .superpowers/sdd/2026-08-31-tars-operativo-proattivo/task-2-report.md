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
