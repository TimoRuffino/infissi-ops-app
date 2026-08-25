# Runbook recovery Tars

## Boot e dipendenze

1. PostgreSQL e `bootstrapAll()` devono essere pronti.
2. Verificare `OPENAI_API_KEY`, budget sede e configurazione Tars.
3. Avviare registro eventi e consumer.
4. Avviare riconciliazione assegnazioni, notifiche e Centro Azioni.
5. Avviare context builder, planner e ricerca solo nel modo indicato dai flag.
6. Avviare smistamento email, audit e trigger automatici per ultimi.

L'assenza di `pgvector` non autorizza installazioni: la ricerca testuale resta
operativa, quella semantica resta `off`. Nessuna migrazione storage reale si
esegue senza backup Drive riuscito nelle 24 ore precedenti.

## OpenAI non disponibile

- I flussi deterministici, notifiche, ricerca testuale e letture CRM restano
  attivi.
- Il run fallisce con codice sanitizzato; chiavi e payload non entrano nei log.
- Le email restano in coda e vengono riprese dal recovery, senza riclassifica
  doppia. Non aumentare retry o budget prima di verificare il codice HTTP.
- Mettere planner e semantic search in `shadow` o `off` se la coda cresce.

## Planner e contesto

- Piani `running` con lease stale vengono recuperati dal worker.
- Una risposta utente usa compare-and-set: una seconda risposta e rifiutata.
- Per rebuild contesto, invalidare la chiave sede/entita/scope e ripubblicare
  l'evento o eseguire il builder; non copiare snapshot tra utenti o sedi.
- Un passo parzialmente riuscito riparte dalla prima operazione incompleta; le
  chiavi idempotenti impediscono duplicati cliente/commessa.

## Revoca autonomia

Autonomia e negata per default. In emergenza svuotare
`autonomyCapabilities`, attivare il kill switch operativo e lasciare le azioni
come proposte. Cambio modello, prompt o workflow, incidente, assenza undo,
rischio alto o azione irreversibile revocano la qualifica. Non trasformare
testo libero degli operatori in regole o prompt.

## Verifica finale

Eseguire `pnpm check`, `pnpm test`, `pnpm build`, `pnpm tars:eval`; poi
controllare `diagnostica.snapshot`. Su Railway verificare anche log worker,
conteggi reali PostgreSQL e almeno un flusso completo con approvazione.
