# Task 2 Report: Conversazioni e thread WhatsApp

## Risultato

Implementato il read model WhatsApp sulla tabella condivisa `comunicazioni`.

- Esporta `ConversazioneWhatsApp`, `ThreadWhatsApp`,
  `normalizzaControparteWhatsApp`, `listConversazioniWhatsApp` e
  `getThreadWhatsApp`.
- La chiave pubblica e stabile e `wa:<casellaId>:<numero normalizzato>`;
  `sedeId` resta sempre un vincolo della query server.
- L'identita della conversazione usa `casellaId` e `mittente` normalizzato,
  anche per gli invii in uscita.
- Il nome mostrato privilegia il cliente CRM della stessa sede, poi il profilo
  WhatsApp non vuoto piu recente, infine il numero normalizzato.
- Tombstone e categorie escluse restano fuori da elenco e thread. I messaggi
  in uscita non incrementano `nonLetti` anche quando lo stato legacy e
  `nuova`.
- Il thread legge `limit + 1`, restituisce gli ultimi `limit` in ordine
  crescente e usa il messaggio piu vecchio restituito per `nextBefore`.

## TDD

RED reale prima delle modifiche di produzione:

```text
pnpm test -- server/tars/mail.test.ts
FAIL server/tars/mail.test.ts
- normalizzaControparteWhatsApp is not a function
- getThreadWhatsApp is not a function
```

GREEN dopo l'implementazione:

```text
pnpm test -- server/tars/mail.test.ts
12 file, 152 test passati
```

Le fixture coprono raggruppamento, due numeri aziendali con la stessa
controparte, grafie diverse dello stesso telefono, ordine in/out, conteggio
non letti, precedenza del nome CRM, fallback del profilo, tombstone, categorie
escluse, isolamento sede e paginazione del thread.

## PostgreSQL e fallback

Il ramo PostgreSQL usa CTE e window functions per normalizzare e aggregare per
`casella_id` e controparte; il fallback in memoria usa la stessa
normalizzazione e le stesse regole di filtro. I parametri opzionali non sono
passati a PostgreSQL come `NULL` non tipizzati: il predicato `ILIKE` viene
costruito solo con una ricerca presente e il predicato `before` solo con una
data presente. Il confronto `received_at < $before` eredita il tipo
`TIMESTAMPTZ` dalla colonna.

## Verifiche finali

```text
pnpm test  # 12 file, 152 test passati
pnpm check # passato
pnpm build # passato
git diff --check # passato
```

## Limite noto

Il worktree non ha `DATABASE_URL`, quindi le CTE PostgreSQL non sono state
eseguite contro un database reale in locale. Sono state controllate tramite
typecheck/build e progettate con gli stessi filtri del fallback; resta
opportuna una smoke test su PostgreSQL prima del deploy Railway.
