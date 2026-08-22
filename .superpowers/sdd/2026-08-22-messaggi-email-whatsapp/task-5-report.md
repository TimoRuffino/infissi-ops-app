# Task 5 report - workspace conversazioni WhatsApp

## Modifiche

- Aggiunto store persistente `whatsapp_conversation_aliases`, con backfill e chiave `sedeId + casellaId + controparte normalizzata`.
- Esteso il read model WhatsApp con alias operatore, priorita nome `CRM -> alias -> Meta -> numero` e ricerca alias per fallback memoria e PostgreSQL.
- Aggiunta `mail.whatsapp.rinominaConversazione`, con `NOT_FOUND` per conversazioni fuori sede/account e rifiuto della rinomina per conversazioni gia collegate a un cliente CRM.
- Creati helper deep link e workspace master/detail: lista conversazioni, thread cronologico paginato, rinomina inline, contesto cliente/commessa/proposte e Sheet sotto `lg`.
- Incluso piano e spec aggiornati per l'emendamento su alias e raggruppamento conversazioni.

## Test eseguiti

- RED: test alias/router falliti per funzione e procedura mancanti.
- GREEN: `pnpm exec vitest run server/tars/mail.test.ts server/routers/mail.channels.test.ts` - 45 test passati.
- Helper client verificati con asserzioni isolate `tsx` dopo autorizzazione IPC sandbox.
- `pnpm check` - passato.
- `pnpm build` - passato.

## Note

- La rotta e la navigazione canonica `/messaggi/whatsapp` saranno cablate nella Task 6; per questo Task 5 il componente e pronto ma non ancora raggiungibile dalla sidebar.
- Il pannello contesto copre cliente, commessa e proposte Tars; appuntamenti e ticket restano fuori dal timebox corrente.
- Non e stato introdotto invio WhatsApp: l'interfaccia dichiara esplicitamente lo stato di sola lettura.
