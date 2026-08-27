# Task 3 — UI costi fissi certificati

## Implementazione

- `CostiFissi` ora espone tre blocchi operativi: `Totale certo`, `Registro confermato` e `Da confermare da FiC`.
- Le ricorrenze usano `ficCosti.ricorrenti`; la conferma apre un Dialog precompilato e modificabile per descrizione, importo, cadenza, categoria e validità.
- `Variabile` e `Straordinario` usano `ficCosti.spostaFornitore`, rimuovendo il candidato dalla lista delle ricorrenze.
- Il registro usa Table e mantiene modifica/eliminazione delle voci esistenti.
- Acquisti presenta `variabile_commessa` come `Variabile` e non espone UI commessa.
- Break-even presenta come valore primario il totale mensile fisso confermato; il margine resta uno scenario separato.

## Verifica

- `pnpm check` — pass
- `pnpm build` — pass
- Test completi, controllo visuale e modifiche backend — non eseguiti, come richiesto.

## Concerns

- Il backend continua a fornire anche `obiettivoMensile` e la relativa progressione: la UI li conserva come scenario operativo secondario, mentre il copy/formula principale usa `daCoprireMensile`.
