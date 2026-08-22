# Task 6 report - navigazione Messaggi e Tars

## Modifiche

- Registrate le route lazy canoniche `/messaggi/email`, `/messaggi/whatsapp` e `/tars`.
- Convertite `/comunicazioni` e `/inbox` in redirect `replace` verso le route canoniche. Gli helper mantengono solo i parametri riconosciuti: `view` e `messaggio` validi per Email, `tab` valido per Tars.
- Separata la sidebar in gruppo Messaggi (Email e WhatsApp) e voce Tars indipendente; il matching dei percorsi ora richiede il confine del segmento per evitare due voci attive.
- Aggiornati i collegamenti delle impostazioni alle pagine Email e WhatsApp canoniche.

## Test e verifiche

- RED: `pnpm exec vitest run client/src/lib/messaggi.test.ts --config vite.config.ts` - 2 test falliti, helper di redirect mancanti.
- GREEN: stesso comando - 9 test passati.
- `pnpm check` - passato.
- `pnpm build` - passato; chunk lazy distinti per Email, WhatsApp e Tars generati.
- `git diff --check` - passato.

## QA visuale

- Tentati avvio applicazione e Vite locale per i viewport 1440x900 e 390x844. In questo ambiente il processo server viene terminato al termine del comando e il browser in-app riceve `ERR_CONNECTION_REFUSED`; la QA browser resta da ripetere in una sessione con server persistente.
