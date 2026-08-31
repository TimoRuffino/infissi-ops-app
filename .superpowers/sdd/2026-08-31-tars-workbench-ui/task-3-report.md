# Task 3 — Card tecnica Impostazioni → Agente

## Implementazione

- `client/src/components/tars/TarsAgentCard.tsx`: card tecnica con stato, provider, modello, ultimo run, run totali/degradati, diagnostica richiudibile, strumenti e interruttori attivi; consumi e budget globali sono mostrati solo a Direzione.
- `client/src/lib/tarsAgentView.ts`: derivazione pura del gate query, stato `spento/disponibile/degradato`, formattazione USD, percentuali clamped e label obbligatoria `Consumi globali · tutte le sedi`.
- `client/src/lib/tarsAgentView.test.ts`: test puri per RED/GREEN del contratto di presentazione e gating.
- `client/src/pages/Integrazioni.tsx`: inserimento focalizzato di `<TarsAgentCard direzione={canManage} />` nella sezione Agente.

La card interroga prima `platform.interruttori`; `tars.stato` parte solo quando `tars` è esplicitamente acceso, mentre `tars.costi` è abilitata soltanto con gate acceso e ruolo Direzione. Non vengono mostrati segreti, prompt o contenuti operativi.

## Evidenza TDD

### RED

Comando: `pnpm test -- client/src/lib/tarsAgentView.test.ts`

Risultato: fallimento atteso perché `./tarsAgentView` non esisteva (`Failed to load url ./tarsAgentView`). La suite includeva anche failure temporanee nei test di presentazione Task 2 concorrente.

### GREEN

Comando focalizzato: `pnpm exec vitest run client/src/lib/tarsAgentView.test.ts`

Risultato: `1 passed`, `4 tests passed`.

Comando di integrazione richiesto: `pnpm test -- client/src/lib/tarsAgentView.test.ts server/tars/costi/integrazione.test.ts`

Risultato: suite repository verde: `93 passed`, `2 skipped`, `893 tests passed`, `8 skipped`.

## Verifiche finali

- `pnpm check` — pass, `tsc --noEmit` senza errori.
- `pnpm build` — pass, Vite ed esbuild completati.
- `git diff --check` — pass.

## Note / concerns

- La card usa i contratti server esistenti: con Tars spento i dettagli restano placeholder e nessuna query `tars.*` parte.
- I costi rispettano il confine server-side e sono esplicitamente etichettati come globali a tutte le sedi.
- Non è stata eseguita verifica visuale browser in questo ambiente; resta da controllare il layout a 1440×900 e 390×844 nel passaggio di verifica visuale.
