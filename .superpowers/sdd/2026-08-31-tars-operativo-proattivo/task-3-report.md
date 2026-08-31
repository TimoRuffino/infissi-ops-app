# Task 3 / T2 — contesto conversazionale persistente e resolver

Data: 31/08/2026

Worktree: `/Users/timmy/Ruffino Group/infissi-ops-app/.worktrees/tars-main`

Branch: `main`

Baseline del task: `d2d801d`

Commit implementazione: `8be1a03` (`feat(tars): persist conversation context`)

## Esito

Implementato un contesto conversazionale persistente, sede/utente-scoped e
versionato, usato esclusivamente come hint verificato. Il contesto non aggiunge
capability e non autorizza effetti; ogni scrittura che ne eredita un riferimento
rilegge l'oggetto autorevole e ne verifica la versione.

- Persistiti `commessaId`, `clienteId`, `comunicazioneId`, `allegatoIndex`,
  superficie, versioni entità e chiarificazione pendente. La scrittura usa
  optimistic concurrency e segnala esplicitamente una versione obsoleta.
- DDL PostgreSQL additivo/idempotente con colonne JSONB/versione; il fallback in
  memoria conserva lo stesso contratto per test e sviluppo senza database.
- Resolver commessa deterministico e sede-scoped con i soli esiti
  `unico | ambiguo | non_trovato`, ranking/evidenze esplicabili e una sola
  domanda concreta in caso ambiguo.
- Il contesto viene aggiornato da esiti tool strutturati con evidenze di entità
  realmente rilette, mai da ID contenuti nel testo del modello. Quando cambia
  la commessa vengono invalidati comunicazione e allegato dipendenti.
- L'orchestratore carica il contesto prima di costruire il profilo dinamico,
  inietta il riepilogo verificato in coda al contesto provider e include il
  fingerprint in C0 e C2.
- Con una commessa attiva il catalogo è contestuale e non ripete l'inventario
  generico; `cerca_commesse` non viene esposto nel profilo già risolto.
- La risposta backend espone in modo additivo `statoOperativo`, derivato dagli
  esiti reali: `Fatto | Preparato | Da confermare | Non eseguito | Bloccato`.
  Il prompt v4 è rimasto immutato; il contratto successivo è in prompt v5.
- `crea_promemoria` eredita `commessaId`/cliente soltanto dal contesto persistente
  già verificato quando l'input li omette, poi rilegge commessa e versione prima
  dell'effetto. In caso stale restituisce `Non eseguito` e non crea record.
- Il router `stato` mantiene la chiamata legacy senza input e accetta
  opzionalmente `conversazioneId`, restituendo catalogo e contesto attivo.

## TDD — RED osservati

### RED iniziale

```bash
pnpm exec vitest run server/tars/conversazione/context.test.ts
```

Exit code 1 atteso: la suite non veniva caricata perché `./context` non
esisteva. Dopo l'introduzione dei moduli minimi, la stessa suite ha lasciato
cinque RED integrativi: provider non escluso nell'ambiguità, profilo ancora
generico, C0 riusato fra contesti diversi, `statoOperativo` assente e reminder
senza collegamento ereditato.

### RED di regressione

La prima suite completa dopo il GREEN mirato è uscita con code 1: 9 test
falliti, 805 passati e 5 saltati (sei T5, due T6, uno eval). La diagnosi ha
mostrato che il resolver interpretava termini operativi generici come nomi di
cliente sintetici. È stato aggiunto prima il test mirato
`non interpreta parole operative generiche come riferimento a una commessa`,
osservato RED con zero chiamate provider anziché una. La correzione al confine
del resolver usa stopword operative e attiva i riferimenti impliciti solo per
clienti CRM realmente collegati; codice, parola `commessa` e chiarificazione
pendente restano sempre deterministici.

## GREEN e verifiche

```bash
pnpm exec vitest run server/tars/conversazione/context.test.ts \
  server/tars/t5UseCase.test.ts server/tars/t6ScenariVivi.test.ts \
  server/tars/eval/eval.test.ts
```

Exit code 0: 4 file, 31 test passati. Il set mirato più ampio su contesto,
registro, reminder e orchestratore è passato con 84 test su 84.

```bash
pnpm test -- server/tars/conversazione/context.test.ts \
  server/tars/orchestratore.test.ts
```

Exit code 0. Per la configurazione dello script `pnpm test`, Vitest ha eseguito
l'intera suite: 86 file passati, 1 file PostgreSQL condizionale saltato; 815
test passati, 5 saltati.

```bash
pnpm check
pnpm test
pnpm build
```

Tutti exit code 0. La suite completa conta 815 test passati e 5 saltati;
`pnpm check` completa `tsc --noEmit`; il build Vite/esbuild produce gli
artefatti server/client senza errori.

```bash
git diff --check
git diff --name-only d2d801d..HEAD | rg '^client/'
```

Nessun errore di whitespace; la guardia `client/` non produce output. Nessun
file UI è stato modificato.

## Copertura dei casi ad alto rischio

- isolamento cross-sede e cross-utente senza enumerazione;
- sostituzione entità con invalidazione dei riferimenti dipendenti;
- ambiguità persistita con una sola chiarificazione e provider non invocato;
- optimistic concurrency e versione stale;
- apprendimento esclusivo da output tool/evidenze, non dal testo modello;
- catalogo contestuale e risposta “cosa puoi fare?” legata alla commessa;
- fingerprint del contesto distinto in C0 e C2;
- tutti i cinque stati operativi backend;
- reminder collegato al contesto verificato e nessun effetto su versione stale;
- regressione T5/T6/eval per termini operativi generici.

## File

Nuovi:

- `server/tars/conversazione/types.ts`
- `server/tars/conversazione/context.ts`
- `server/tars/conversazione/resolver.ts`
- `server/tars/conversazione/context.test.ts`
- `server/tars/prompt/v5.ts`

Modificati:

- `server/tars/archivio.ts`
- `server/tars/orchestratore.ts`
- `server/tars/azioni/policy.ts`
- `server/tars/azioni/registry.ts`
- `server/tars/strumenti/letture.ts`
- `server/tars/strumenti/promemoria.ts`
- `server/tars/strumenti/tipi.ts`
- `server/routers/tars.ts`

## Self-review e riserva esplicita

- Compatibilità: campi di risposta e contesto run sono opzionali; il router
  `stato` continua ad accettare la chiamata senza input.
- Authz: sede, utente e capability provengono sempre dal contesto autenticato;
  il persistito non può estenderli. Record di altra sede risultano non trovati.
- Effetti: nessuna mutation autonoma o auto-approvazione; il reminder resta un
  tool R1 e passa dal servizio di dominio/ledger esistente.
- Scope: nessun file `client/`, flag, budget, provider/OpenAI, Railway, deploy,
  migrazione reale o segreto è stato letto o modificato.

Non è stato configurato né contattato un PostgreSQL reale. Il DDL additivo e il
percorso `kvSql` sono typechecked, mentre persistenza, isolamento, versioning e
fallback sono coperti in memoria. I 5 test PostgreSQL condizionali restano
saltati senza `DATABASE_URL`; nessuna migrazione/deploy Railway viene dichiarata
eseguita.
