# Task 3 — report backend

## Stato

Implementato il totale certo del break-even. Il registro `costiFissiManualiPerSede(sedeId)` è ora l'unica fonte dei costi fissi; le righe FiC classificate `fisso`, incluse quelle legacy/autopromosse, restano disponibili per la revisione ma non alimentano più `daCoprireMensile`.

Il contratto del calcolo supporta anche il periodo esplicito (`periodoDa`, `periodoA`, `documentiRicevuti`) mantenendo compatibilità con il contratto storico `anno`/`mese` e `costi`. `daCoprireMensile` e `costiFissiMensili` riconciliano sullo stesso totale mensile certo, anche quando gli altri dati economici sono insufficienti.

La mutation `costiFissi.confermaDaFic` accetta importo e validità modificabili dal form di conferma, mantenendo l'idempotenza per sede e chiave di ricorrenza.

## Evidenza TDD

### RED

Test aggiunto in `server/_core/economiaFic.test.ts`:

```ts
const result = calcolaBreakEven({
  periodoDa: "2025-09-01",
  periodoA: "2026-08-31",
  documentiEmessi: [],
  documentiRicevuti: [{ classificazione: "fisso", importoNetto: 99_000 }],
  costiFissiDichiarati: [{ mensile: 2_500, mesiNelPeriodo: 12 }],
} as any);
expect(result.costiFissiMensili).toBe(2_500);
expect(result.daCoprireMensile).toBe(2_500);
```

Comando:

```text
pnpm vitest run server/_core/economiaFic.test.ts
```

Risultato RED: 1 test fallito con `Invalid time value`, perché il calcolo non supportava il periodo esplicito.

### GREEN

Comando:

```text
pnpm vitest run server/_core/economiaFic.test.ts
```

Risultato: `17 tests passed`.

## Verifica richiesta

```text
pnpm vitest run server/_core/economiaFic.test.ts && pnpm check
```

Risultato: test focalizzato `17/17` e TypeScript `tsc --noEmit` concluso con exit code `0`.

## File modificati

- `server/_core/economiaFic.ts`
- `server/_core/economiaFic.test.ts`
- `server/routers/economia.ts`
- `server/routers/costiFissi.ts`

## Note / concern

- La UI non è stata modificata, come richiesto nell'ultimo scope: resta da eseguire separatamente sui tre componenti client.
- Non sono stati eseguiti `pnpm test`, `pnpm build` o controlli browser.
