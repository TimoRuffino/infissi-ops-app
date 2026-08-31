# Task 1 — T0: verità, contratti e guardrail

## Ricognizione

- Letti il brief vincolante, il mandato completo, `AGENTS.md`, `handoff.md`,
  PRD e specifica Tars prima delle modifiche.
- Verificato `main` allineato a `origin/main` su `de0ce77`; era presente il
  piano corrente non tracciato `docs/superpowers/plans/2026-08-31-tars-operativo-proattivo.md`, poi incluso nel fix per mantenere versionati mandato e baseline.
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

## Fix round 1/5

- Corretto `CLAUDE.md`: Tars v2 è ora descritto come runtime corrente, mentre
  la rimozione del 28/08 resta un registro storico esplicitamente preservato.
- Riscritta la matrice in 21 righe, una per ogni tool trovato in
  `server/tars/strumenti/*.ts`; ogni riga distingue servizio, livello L,
  classificazione R target/gap, capability, flag e test. Sono inclusi
  `leggi_analisi_ordine` e `leggi_promemoria_in_scadenza`; le letture
  promemoria/Centro Azioni e `leggi_ordini_fornitore` riportano ora i flag e
  requisiti effettivi.
- Eliminata l'equivalenza impropria R0-R4/L0-L5: la matrice dichiara le due
  tassonomie separate e registra la classificazione futura non ancora decisa.
- Il piano `docs/superpowers/plans/2026-08-31-tars-operativo-proattivo.md`
  è riconosciuto come piano corrente e viene versionato con questo fix.

| Comando di verifica | Output/esito |
| --- | --- |
| `git diff --check` | Passa, nessun errore di whitespace. |
| Inventario sorgente→matrice | `tool_count=21 matrix_count=21 names_match=0`. |
| Guardia `git diff --name-only` e staged `! git diff --cached --name-only | rg '^client/'` | Passa: nessun percorso `client/` nel delta del fix. |

Comando esatto dell'inventario (confrontato con gli identificativi della prima
colonna della matrice):

```sh
for file in server/tars/strumenti/*.ts; do
  rg -o 'nome: "[^"]+"' "$file"
done | sed -E 's/.*nome: "([^"]+)"/\1/' | sort -u
```

Output del confronto: `tool_count=21 matrix_count=21 names_match=0`.

- Commit atomico Conventional Commit del fix: `docs(tars): completa matrice T0`.
