# Runbook eventi e notifiche

> Era `tars-eventi-notifiche.md`: il nome citava l'agente, ma questa
> infrastruttura non era l'agente ed è viva. Rinominato il 28/08/2026.

## Scopo

Procedura per attivare e controllare registro eventi, proiezione notifiche,
realtime SSE e Web Push senza perdere eventi o duplicare avvisi. Eseguire una
sede alla volta. La diagnostica è disponibile alla direzione tramite
`diagnostica.snapshot` e non contiene payload cliente.

## Come si cambiano i flag (limite attuale)

Dal 28/08/2026 **non esiste più un'API per modificare i flag di piattaforma**:
l'unico endpoint era `tars.config.setPlatformFlags`, rimosso con l'agente, e
`platform.flags` è di sola lettura. I flag restano quindi congelati ai valori
salvati per sede. Fino alla reintroduzione di un endpoint direzione con audit
(lavoro tracciato nel dossier), un cambio richiede un intervento pianificato a
servizio fermo — mai una scrittura sul database con l'istanza viva — e va
registrato qui con data, autore e motivo.

## Ordine di attivazione

1. `eventBusMode=shadow`: pubblicare eventi, mantenendo i flussi legacy.
2. Dopo almeno 7 giorni senza eventi persi, `notificationMode=shadow`.
3. Confrontare conteggi e destinatari con il legacy; spiegare ogni dead-letter.
4. `notificationMode=active`, lasciando `realtimeNotifications=false`.
5. Attivare `realtimeNotifications=true`; il client mantiene polling di
   recupero e usa `Last-Event-ID`, quindi una disconnessione non perde dati.
6. Attivare `webPushEnabled=true` solo dopo consenso browser e test su un
   destinatario interno.

## Controlli

- `diagnostica.snapshot.events.consumers`: `pending` deve tornare verso zero.
- `deadLetter` deve restare zero o avere causa e ticket associato.
- `notifications.pending` deve essere coerente con il Centro Notifiche.
- `sseConnections` cresce all'apertura e torna a zero alla chiusura.
- Una riassegnazione produce una sola notifica canonica al nuovo assegnatario.
- Presa in carico o completamento risolve il gruppo, non crea un duplicato.

## Recovery

- Worker riavviato: i lease stale tornano `pending`; il consumer è idempotente.
- Evento duplicato: `dedupe_key` restituisce il record esistente.
- SSE disconnessa: non cancellare notifiche; il reconnect esegue replay dal
  cursore e il polling resta fallback.
- Dead-letter: correggere la causa, verificare sede e consumer, poi rimettere
  solo il record interessato in `pending`. Non modificare il payload.

## Rollback

Disattivare in ordine inverso: Web Push, SSE, notifiche active verso shadow,
eventi active verso shadow. Non cancellare eventi, processing o notifiche:
servono per audit e replay. Il flusso legacy resta disponibile finché il gate
di rollout non è firmato.
