# Promemoria personali Tars con popup nel CRM

**Data:** 26 agosto 2026  
**Stato:** design approvato  
**Ambito:** chat Tars, proposte approvabili, persistenza promemoria, notifiche e popup globale

## 1. Obiettivo

Ruffino Flow deve permettere a ogni utente autenticato di chiedere a Tars un
promemoria personale in linguaggio naturale. Tars identifica il richiedente dal
contesto autenticato, chiede sempre quando ricordare l'attività e, dopo una
conferma temporale e l'approvazione della proposta, programma il promemoria.

Alla scadenza il CRM mostra un popup all'utente destinatario e conserva lo
stesso elemento nel centro notifiche. Se il CRM era chiuso, il popup compare al
primo accesso successivo. Non sono richieste notifiche del browser o del sistema
operativo quando il CRM è chiuso.

Il promemoria non deve essere simulato con una nota timeline, un appuntamento di
calendario o un caso del Centro Azioni: sono entità con significato e ciclo di
vita diversi.

## 2. Decisioni approvate

1. Il destinatario iniziale è sempre l'utente che sta parlando con Tars.
2. L'identità arriva dal principal autenticato che avvia la richiesta Tars e
   non è un argomento controllabile dal modello o dal client.
3. Ogni nuovo intento di promemoria attraversa una domanda temporale esplicita.
4. Tars interpreta date naturali, ma il server valida e salva un istante
   assoluto in UTC insieme al fuso `Europe/Rome`.
5. Tars crea una proposta `promemoria`; il record operativo nasce soltanto dopo
   approvazione umana.
6. Il popup funziona con il CRM aperto e al primo accesso dopo una scadenza
   avvenuta a CRM chiuso.
7. Il promemoria resta anche nel centro notifiche finché non viene letto,
   completato o posticipato.
8. Completamento, posticipo e annullamento sono persistenti, idempotenti e
   verificati dal server.
9. Lo scope `sedeId` è obbligatorio in ogni query, mutation e lookup.
10. La funzionalità non dipende da `notificationMode`,
    `realtimeNotifications` o `webPushEnabled`.

## 3. Esperienza Tars

### 3.1 Riconoscimento dell'intento

Richieste come le seguenti devono essere riconosciute come promemoria:

- "Ricordami di mandare il preventivo a Marco";
- "Fammi ricordare di chiamare Rossi";
- "Non farmi dimenticare il saldo della commessa Bianchi";
- "Ricordami domani alle 9 di controllare la posa".

La presenza di un cliente o di una commessa non trasforma il promemoria in una
nota timeline. Tars può cercare e collegare il contesto CRM, ma il testo del
promemoria resta personale.

### 3.2 Domanda temporale obbligatoria

Ogni intento nuovo deve produrre prima `chiedi_chiarimento`:

- se data e ora mancano, Tars chiede "Quando devo ricordartelo?";
- se la frase contiene già data e ora, Tars chiede conferma dell'interpretazione
  canonica, per esempio "Confermi domani, 27 agosto, alle 09:00?";
- se la risposta è vaga, come "domani mattina", Tars chiede l'orario esatto;
- se la data è nel passato, Tars spiega il problema e richiede un nuovo orario;
- le opzioni rapide possono includere oggi alle 17:00, domani alle 09:00 e
  scelta personalizzata, purché siano future nel momento della domanda.

La risposta riapre una sola volta il seguito Tars conservando l'intento
originale. Dopo aver ottenuto un istante non ambiguo, Tars crea una sola
proposta `promemoria`.

### 3.3 Proposta approvabile

La card mostra almeno:

- testo completo del promemoria;
- data, giorno della settimana e ora in formato italiano;
- indicazione "Per te" con il nome dell'utente autenticato;
- cliente o commessa collegati, quando verificati;
- motivazione sintetica e fonti, se esistono riferimenti CRM.

Il payload proposto contiene soltanto:

```text
testo
remindAtIso
timezone = Europe/Rome
commessaId?
clienteId?
```

Non contiene `recipientUserId`, `createdByUserId` o `sedeId`: il runtime Tars
salva sulla proposta un `requestedByUserId` server-owned, ricavato dal principal
che ha avviato la richiesta. L'esecutore usa quel valore anche se la proposta
viene riletta in un secondo momento. Solo il richiedente può approvare o
rifiutare il proprio promemoria; la direzione conserva la normale visibilità di
audit ma non può deciderlo al suo posto. Non esiste una scorciatoia di creazione
diretta.

`requestedByUserId` è un nuovo campo opzionale del record proposta: il backfill
in `onLoad` assegna `null` alle proposte storiche. Per il tipo `promemoria` il
campo è invece obbligatorio e validato lato server.

### 3.4 Deduplica Tars

La chiave d'azione include sede, autore della richiesta, testo normalizzato,
istante canonico e target CRM eventuale. Una domanda già risposta o una
proposta pendente, approvata, rifiutata, in errore o già gestita non viene
ricreata con parole diverse.

## 4. Modello persistente

I promemoria vivono in PostgreSQL. Uno store JSONB non è adatto a scansioni
temporali frequenti, claim concorrenti e aggiornamenti puntuali.

### 4.1 Tabella `promemoria`

```text
id                    BIGSERIAL PRIMARY KEY
sede_id               BIGINT NOT NULL
recipient_user_id     BIGINT NOT NULL
created_by_user_id    BIGINT NOT NULL
source_proposal_id    BIGINT
canonical_key         TEXT NOT NULL
text                  TEXT NOT NULL
remind_at              TIMESTAMPTZ NOT NULL
timezone               TEXT NOT NULL DEFAULT 'Europe/Rome'
status                 TEXT NOT NULL
revision               INTEGER NOT NULL DEFAULT 1
cliente_id             BIGINT
commessa_id            BIGINT
popup_dismissed_at     TIMESTAMPTZ
fired_at               TIMESTAMPTZ
notification_revision  INTEGER NOT NULL DEFAULT 0
completed_at           TIMESTAMPTZ
cancelled_at           TIMESTAMPTZ
created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

Stati ammessi:

- `scheduled`: futuro e in attesa;
- `due`: scaduto, consegnabile al popup e ancora da gestire;
- `completed`: dichiarato fatto;
- `cancelled`: annullato.

Vincoli e indici:

- unique `(sede_id, canonical_key)`;
- unique parziale `(sede_id, source_proposal_id)` quando valorizzato;
- indice `(status, remind_at, id)` per il worker;
- indice `(sede_id, recipient_user_id, status, remind_at)` per popup e lista;
- check su testo non vuoto, `revision >= 1`,
  `0 <= notification_revision <= revision` e stati ammessi.

`cliente_id` e `commessa_id` sono riferimenti opzionali. Prima della scrittura
l'esecutore verifica che esistano nella sede attiva e restituisce `NOT_FOUND`
su mismatch, senza rivelare il record esterno.

### 4.2 Tabella `promemoria_eventi`

Il registro append-only conserva:

```text
id
promemoria_id
sede_id
actor_user_id
event_type
metadata JSONB
created_at
```

Eventi minimi: `created`, `fired`, `popup_dismissed`, `completed`, `snoozed` e
`cancelled`. I metadati contengono soltanto date, revisione e motivazioni
operative compatte; non duplicano testi cliente o corpi di comunicazioni.

## 5. Servizio server e API

Il nuovo dominio vive in `server/reminders/` con tipi, repository, service e
worker separati. Il router tRPC espone procedure autenticate e personali:

```text
promemoria.due
promemoria.dismissPopup
promemoria.complete
promemoria.snooze
promemoria.cancel
```

Contratti:

- `due` restituisce soltanto promemoria `due` dell'utente autenticato nella
  sede attiva con `popup_dismissed_at IS NULL`, ordinati per `remind_at`, poi
  `id`;
- `dismissPopup` accetta un solo id scoped e registra che l'utente ha chiuso
  esplicitamente il dialog senza completare il promemoria;
- `complete` porta `scheduled` o `due` a `completed` e risolve il gruppo di
  notifiche canonico;
- `snooze` accetta una nuova data futura, incrementa `revision`, torna a
  `scheduled`, azzera i campi di consegna del popup e della notifica e risolve
  la revisione precedente;
- `cancel` chiude un promemoria non completato e risolve le notifiche attive;
- ripetere la stessa mutation produce lo stesso risultato senza duplicare
  eventi o notifiche.

L'API non accetta destinatari arbitrari nella prima versione. Ogni id di altro
utente o altra sede restituisce `NOT_FOUND`.

## 6. Scadenza e proiezione nelle notifiche

### 6.1 Worker

Un worker leggero parte dopo il bootstrap del server, esegue subito un giro e
poi controlla ogni 15 secondi. Recupera piccoli lotti di record `scheduled` con
`remind_at <= NOW()` e record `due` la cui notifica non è ancora stata
proiettata per la revisione corrente.

Per ogni record:

1. reclama atomicamente i record scaduti con lock non bloccante e porta ogni
   `scheduled` a `due`, registrando una sola volta `fired`;
2. crea o aggiorna la notifica canonica della revisione corrente;
3. dopo il successo imposta `notification_revision = revision` e pubblica il
   segnale SSE quando disponibile;
4. se la proiezione fallisce, il popup resta comunque consegnabile e il giro
   successivo ritenta la notifica senza duplicarla.

La chiave notifica è `reminder:<promemoriaId>:<revision>` e il gruppo è
`reminder:<promemoriaId>`. La unique key e il claim atomico rendono innocui
crash e worker concorrenti. Il link punta alla commessa quando presente;
altrimenti apre la chat Tars.

Non vengono accodate consegne `push` o `email`.

### 6.2 Compatibilità con il rollout notifiche

I promemoria sono un contratto funzionale personale, non un esperimento della
piattaforma notifiche:

- in `active` compaiono nel feed persistente normale;
- in `legacy` o `shadow` le API della campanella includono anche le notifiche
  promemoria dovute, senza duplicarle;
- il popup interroga `promemoria.due` direttamente e non dipende dalla modalità
  della campanella;
- SSE accelera l'aggiornamento, ma il polling resta sempre il fallback.

## 7. Popup globale

Un componente `PromemoriaPopupHost` viene montato una sola volta in
`DashboardLayout`, quindi funziona in ogni pagina autenticata.

### 7.1 Consegna

- query immediata all'apertura del layout;
- polling ogni 15 secondi mentre la finestra è visibile;
- invalidazione anticipata tramite lo stream notifiche, quando disponibile;
- nessun polling aggressivo quando `document.visibilityState` è `hidden`;
- al ritorno visibile viene eseguito subito un controllo.

Il client mostra un promemoria alla volta. Gli altri restano in coda ordinata e
il dialog indica quanti ne rimangono. Il semplice caricamento non modifica il
record: se la pagina viene aggiornata mentre il popup è aperto, lo stesso
promemoria ricompare. `dismissPopup` parte soltanto quando l'utente chiude il
dialog senza scegliere **Fatto** o **Posticipa**.

### 7.2 Comportamento visuale

Su desktop il popup è un `Dialog` controllato e centrato, con larghezza leggibile
e senza card annidate. Su mobile occupa quasi tutta la larghezza e rifluisce in
verticale; non introduce scroll orizzontale globale.

Mostra:

- etichetta "Promemoria";
- testo completo senza troncamento;
- data e ora;
- eventuale cliente/commessa con link;
- conteggio degli altri promemoria scaduti.

Azioni:

- **Fatto**, primaria;
- **Posticipa**, con 15 minuti, 1 ora, domani alle 09:00 e data/ora
  personalizzata;
- **Apri commessa**, solo quando disponibile;
- chiusura tramite pulsante, `Esc` o backdrop.

Chiudere il dialog registra `popup_dismissed`, lascia la notifica non letta e
non fa riapparire automaticamente la stessa revisione. Posticipare crea invece
una nuova occorrenza tramite incremento di `revision`.

### 7.3 Accessibilità

- `DialogTitle` e descrizione sono sempre presenti;
- il focus iniziale va all'azione primaria e torna al controllo precedente alla
  chiusura;
- ordine Tab uguale all'ordine visuale, focus ring visibile e nessun controllo
  raggiungibile solo tramite hover;
- pulsanti con target minimo 44 x 44 px su mobile;
- stato di salvataggio e errori vengono annunciati e mostrati vicino alle
  azioni;
- `prefers-reduced-motion` elimina transizioni non necessarie.

## 8. Modifiche Tars

### 8.1 Tipi e strumenti

- aggiungere `promemoria` a `TIPI_PROPOSTA`;
- aggiungere `proponi_promemoria` al catalogo chat/seguito;
- non esporlo ai profili automatici di smistamento comunicazioni o audit;
- mantenere `chiedi_chiarimento` come unico primo passo consentito per un nuovo
  intento di promemoria;
- mostrare il nuovo tipo in `TarsPropostaCard` e nei riepiloghi del Command
  Center.

Lo schema del tool valida testo, ISO timestamp, timezone fissa e riferimenti CRM
opzionali. Il destinatario non è presente nello schema.

### 8.2 Prompt e vincoli server

Il prompt istruisce Tars a distinguere esplicitamente:

- "ricordami" -> promemoria personale;
- "annota sulla commessa" -> nota timeline;
- "fissa un appuntamento" -> calendario/intervento;
- "crea un'attività operativa" -> caso o proposta di dominio pertinente.

Il server non si affida al solo prompt. `proponi_promemoria` rifiuta la prima
proposta se l'esecuzione non discende da una `domanda` temporale risposta. La
proposta deve conservare `origineId`, risposta e istante interpretato per audit.

### 8.3 Esecuzione approvata

L'esecutore `promemoria`:

1. rilegge proposta, richiedente originale, utente approvatore e sede;
2. valida data futura rispetto all'orologio server;
3. rivalida cliente e commessa nella sede;
4. verifica che l'approvatore coincida con `requestedByUserId` e ricava
   destinatario e autore dal principal originale persistito;
5. inserisce il record con unique key e registra `created`;
6. restituisce data/ora formattate e id del promemoria.

Un doppio click, retry o riavvio dopo la scrittura restituisce il record già
creato grazie a `source_proposal_id` e alla chiave canonica.

## 9. Errori e casi limite

- OpenAI indisponibile prima della proposta: nessun promemoria viene creato.
- Approvazione dopo che l'orario è trascorso: la proposta fallisce con richiesta
  di scegliere una nuova data; non nasce un promemoria già scaduto per errore.
- Cliente o commessa eliminati prima dell'approvazione: il promemoria può essere
  creato senza collegamento soltanto dopo una nuova conferma; non si degrada in
  silenzio.
- Worker temporaneamente indisponibile: il record resta `scheduled` e viene
  recuperato al giro successivo. Notifica temporaneamente indisponibile: il
  record `due` resta consegnabile al popup e la proiezione nella campanella
  viene ritentata.
- Popup chiuso durante una mutation: i pulsanti restano disabilitati fino
  all'esito; un errore lascia aperto il dialog con possibilità di retry.
- Cambio sede: query cache e coda popup vengono azzerate prima del nuovo fetch.
- Utente disattivato: il worker non consegna nuovi popup; i record restano
  auditabili e possono essere annullati dalla manutenzione amministrativa.
- Ora legale: `remind_at` è UTC; parsing e visualizzazione usano
  `Europe/Rome`. Orari locali inesistenti o duplici richiedono conferma.

## 10. Sicurezza e privacy

- tutte le route sono autenticate;
- ogni repository method richiede `sedeId` e `recipientUserId`;
- nessuna API personale permette di enumerare promemoria altrui;
- il testo non entra in log, metriche o label diagnostiche;
- SSE trasporta soltanto un segnale di invalidazione scoped, non il testo;
- i riferimenti CRM vengono verificati con gli stessi permessi del ruolo
  corrente;
- il popup non espone dati prima che sessione e sede siano risolte.

## 11. Compatibilità e rollout

La modifica è additiva:

- nessuna semantica esistente di nota timeline, calendario o Centro Azioni
  cambia;
- le proposte storiche continuano a deserializzare;
- le modalità notifiche legacy/shadow/active restano valide;
- in assenza di `DATABASE_URL`, il repository in memoria supporta sviluppo e
  test ma non dimostra persistenza Railway;
- `ensureSchema` crea tabelle e indici in modo idempotente all'avvio, seguendo i
  repository PostgreSQL già presenti.

Non serve un feature flag utente: il nuovo tipo compare soltanto quando Tars
riconosce l'intento e viene approvato. Il worker può essere disabilitato con un
kill switch operativo soltanto per incident response; i record restano
`scheduled` e vengono recuperati alla riattivazione.

## 12. Verifiche richieste

### 12.1 Test server

- riconoscimento del contratto prompt/tool per "ricordami";
- domanda obbligatoria con e senza data già presente;
- proposta rifiutata senza domanda temporale precedente;
- destinatario ricavato dal principal e impossibile da falsificare;
- lookup `sedeId` con `NOT_FOUND` cross-sede;
- data passata, risposta ambigua e gestione `Europe/Rome`/ora legale;
- approvazione idempotente e deduplica per proposta;
- worker: claim, retry, doppia istanza e notifica unica;
- complete, snooze, cancel e risoluzione del gruppo notifiche;
- lista due solo personale;
- compatibilità campanella in legacy, shadow e active.

Le modifiche a prompt, tool e metadati devono estendere
`server/tars/tars.test.ts`. Repository e worker hanno test dedicati con
implementazione in memoria e casi PostgreSQL simulati secondo i pattern
esistenti.

### 12.2 Test client

- popup al caricamento e al polling;
- coda di più promemoria;
- chiusura senza nuova apertura della stessa revisione;
- completamento, posticipo e link commessa;
- loading/error e retry;
- cambio sede e logout;
- tastiera, focus trap, ritorno focus e annunci accessibili.

### 12.3 Verifica visuale

- desktop 1440 x 900;
- mobile 390 x 844;
- testo lungo, commessa assente/presente e almeno tre promemoria in coda;
- nessun taglio, sovrapposizione o scroll orizzontale;
- nessun errore console.

### 12.4 Gate finali

```bash
pnpm check
pnpm test
pnpm build
```

## 13. Criteri di accettazione

La funzionalità è completa quando:

1. "Ricordami di inviare il preventivo" fa chiedere quando, senza creare note
   sulla commessa.
2. Una frase con "domani alle 9" riceve una conferma temporale esplicita.
3. Dopo risposta e approvazione nasce esattamente un promemoria personale.
4. Alla scadenza, con CRM aperto, il popup compare entro 15 secondi.
5. Se il CRM era chiuso, il popup compare al primo accesso successivo.
6. Il promemoria compare anche nel centro notifiche in ogni modalità di rollout.
7. **Fatto** lo completa e rimuove la notifica attiva.
8. **Posticipa** lo riprogramma senza duplicati e genera un nuovo popup soltanto
   alla nuova scadenza.
9. Chiudere il popup non lo segna come completato e non lo fa riaprire in loop.
10. Un utente non può leggere o modificare promemoria di altra sede o altro
    utente.

## 14. Fuori ambito

- notifiche browser, native o di sistema a CRM chiuso;
- email o WhatsApp automatici di promemoria;
- promemoria ricorrenti;
- assegnazione di un promemoria a un collega;
- sincronizzazione con Google Calendar;
- creazione autonoma senza approvazione Tars;
- una nuova pagina completa di gestione promemoria: nella prima versione il
  popup e il centro notifiche sono le superfici operative.
