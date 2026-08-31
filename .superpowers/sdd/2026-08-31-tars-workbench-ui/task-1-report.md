# Task 1 — Contratto gestione conversazioni Tars

## Stato

Implementato nel worktree `tars-main` a partire da `ba979c6`.

## Contratti introdotti

- `ConversazioneTars` espone `fissata`, `archiviataAt` e `anteprima`; l'anteprima è calcolata dall'ultimo turno, senza colonna duplicata.
- Lo schema PostgreSQL aggiunge in modo additivo `fissata BOOLEAN NOT NULL DEFAULT false` e `archiviata_at TIMESTAMPTZ`.
- `listaConversazioni(sedeId, utenteId, { archiviate, ricerca, limite })` cerca senza distinzione tra maiuscole/minuscole in titolo e anteprima, esclude le archiviate di default, limita tra 1 e 100 (default 50), e ordina fissate poi aggiornamento decrescente.
- Le primitive rinomina/fissa/archivia-ripristina e ogni aggiornamento turno applicano `id + sedeId + utenteId`; un record estraneo produce `non_trovato`/`NOT_FOUND` e non viene modificato.
- L'archiviazione rimuove sempre il fissaggio, non elimina cronologia; il ripristino annulla soltanto `archiviataAt`.
- `aggiungiTurno` richiede `utenteId`, è atomica nel percorso SQL e verifica la proprietà prima di scrivere anche nel fallback memoria.
- Il router offre `tars.conversazioni({ archiviate?, ricerca?, limite? })`, `tars.rinominaConversazione`, `tars.fissaConversazione` e `tars.archiviaConversazione`; il precedente endpoint senza input resta compatibile.
- Router e orchestratore rifiutano una conversazione archiviata prima di turni, provider e costi. Il router restituisce `PRECONDITION_FAILED`; lo scope estraneo rimane `NOT_FOUND`.

## TDD

1. RED archivio: `pnpm test -- server/tars/conversazioni.test.ts` ha fallito per metadati `undefined` e primitive di gestione assenti.
2. GREEN archivio: gli stessi test hanno passato dopo l'implementazione minima.
3. RED router/orchestratore: `pnpm test -- server/tars/conversazioni.test.ts server/tars/orchestratore.test.ts` ha fallito per input non validati, endpoint inesistenti e assenza del blocco archived read-only.
4. GREEN router/orchestratore: test passati dopo gli endpoint additive e il controllo anticipato.
5. RED regressione fallback: il test cross-owner ha mostrato un turno inserito prima della verifica nel fallback memoria.
6. GREEN regressione fallback: la verifica avviene ora prima di allocare/inserire il turno.

## Copertura aggiunta

- Default e anteprima ultimo turno.
- Ricerca, limite e ordine fissate/recenti.
- Archiviazione recuperabile e ripristino.
- Isolamento cross-sede/cross-owner, incluso nessun turno parziale nel fallback.
- Validazione router, `NOT_FOUND` cross-owner, fissa/archivia/ripristina.
- Archiviate in sola lettura: zero turni, `updatedAt` invariato e zero invocazioni provider.

## Verifica finale

- `pnpm test -- server/tars/conversazioni.test.ts server/tars/orchestratore.test.ts`: superato (il runner di progetto ha eseguito 90 file: 874 test superati, 5 skip già previsti).
- `pnpm check`: superato (`tsc --noEmit`).
- `git diff --check`: superato.

## Fuori perimetro

Nessuna modifica a UI/client, provider/cost governor, flag, prompt, catalogo strumenti, dati Railway o servizi esterni.
