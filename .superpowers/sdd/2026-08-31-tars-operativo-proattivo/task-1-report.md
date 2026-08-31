# Task 1 — T0: verità, contratti e guardrail

## Ricognizione

- Letti il brief vincolante, il mandato completo, `AGENTS.md`, `handoff.md`,
  PRD e specifica Tars prima delle modifiche.
- Verificato `main` allineato a `origin/main` su `de0ce77`; era presente solo
  un piano non tracciato di un altro flusso, lasciato intatto.
- Verificati nel codice runtime/profili/tool Tars, confine del governor,
  servizi reminders/Centro Azioni/DI/gateway e router commesse/mail. La
  ricognizione ha rilevato che il runtime esiste ma non espone ancora la
  catena completa Maccari, L2 proattivo o L3 miglioramenti.

## Modifiche

- Aggiunta `docs/tars/matrice-azioni-tars.md`: dominio → servizio canonico →
  tool → rischio → capability → flag → test → gap, con stato reale e limiti.
- Aggiornata `docs/tars/architettura-tars-v2.md` con riallineamento T0,
  divieti `force`/tRPC/SQL/provider fuori governor, accettazione Maccari e tre
  livelli proattivi.
- Corretto il presente in `documento_requisiti_infissi_ops.md`, `handoff.md`
  e `AGENTS.md`, senza cancellare il registro storico della rimozione del
  28/08/2026.
- Confermato il perimetro T0 documentale: nessun file `client/` modificato.

## Verifiche

| Comando | Esito |
| --- | --- |
| `git diff --check` | Passa, nessun errore di whitespace. |
| Guardia delta `git diff --name-only` + controllo staged | Nessun percorso `client/`. |
| Ricerca mirata `rg` su tool, flag, router e servizi | Coerente con la matrice; nessuna capacità dichiarata senza percorso trovato. |

Non sono necessari typecheck, test o build: il task modifica solo documentazione.

## Commit e self-review

- Commit atomico Conventional Commit: `docs(tars): riallinea contratti e matrice T0`.
- Controllati i riferimenti a Tars rimosso: restano solo come registro storico,
  etichettato esplicitamente, e non come stato corrente.
- Controllati i guardrail: la documentazione non autorizza flag, Railway,
  OpenAI, deploy, modifiche UI/client o bypass dei servizi di dominio.
- Limite dichiarato: lo stato di ambienti esterni non è stato letto né
  modificato; il report descrive esclusivamente codice e documentazione locali.
