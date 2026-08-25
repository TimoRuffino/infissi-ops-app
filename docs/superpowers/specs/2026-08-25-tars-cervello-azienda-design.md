# Tars come cervello operativo dell'azienda

**Data:** 25 agosto 2026
**Stato:** design approvato
**Ambito:** Tars, eventi aziendali, notifiche, permessi, memoria, pianificazione, workflow, ricerca, eval e autonomia progressiva

## 1. Visione

Tars deve diventare il livello di intelligenza trasversale di Ruffino Flow. Non
deve limitarsi a rispondere in chat o a generare singole proposte: deve mantenere
una comprensione aggiornata dell'azienda, riconoscere relazioni e contraddizioni,
seguire gli obiettivi fino all'esito e portare all'attenzione di ogni utente
soltanto le decisioni e le azioni che gli competono.

Il risultato atteso non e un agente onnipotente. E un sistema operativo
aziendale verificabile che:

- conosce lo stato corrente di clienti, commesse e processi;
- collega eventi provenienti da CRM, email, WhatsApp, Fatture in Cloud,
  documenti, calendario, produzione e post-vendita;
- distingue fatti, inferenze, regole, ipotesi e informazioni mancanti;
- prepara ed esegue piani multi-step senza perdere il filo;
- propone azioni fondate su prove;
- consegna il lavoro alla persona giusta;
- verifica l'effetto di un'azione dopo l'approvazione;
- migliora sulla base di esiti ed eval, non tramite modifiche speculative ai
  prompt;
- riduce rumore, token, latenza e lavoro ripetitivo.

## 2. Decisioni approvate

1. Tars mantiene il principio `propone, non esegue` come default.
2. L'autonomia viene concessa solo per singola capacita, dopo dati reali,
   esclusivamente per azioni reversibili e a basso rischio.
3. Pagamenti, invii, cancellazioni, economia, permessi e avanzamenti di stato
   richiedono sempre approvazione.
4. L'architettura consigliata e un motore cognitivo centrale con workflow
   specialistici. Non si introduce subito uno sciame multi-agente.
5. Email e WhatsApp rimangono workspace distinti; Tars e il livello
   trasversale che li correla con il dominio.
6. Ogni assegnazione o delega genera un evento persistente e una consegna
   personale al destinatario.
7. Le notifiche devono essere real-time nel CRM, persistenti nella campanella,
   disponibili come Web Push e, per sole urgenze non gestite, inoltrabili via
   email.
8. I permessi diventano capability-based, con ruoli come valori predefiniti,
   eccezioni individuali e deleghe tracciate.
9. Il contesto viene aggiornato dagli eventi e ricostruito solo per le entita
   cambiate.
10. Ogni conclusione importante deve essere sostenuta da fonti risolvibili.
11. Prima di aumentare autonomia, strumenti o costo si costruiscono eval
    rappresentativi e una baseline misurabile.
12. La specifica precedente
    `2026-08-22-messaggi-tars-context-design.md` resta valida per la separazione
    Email/WhatsApp gia implementata; le sue sezioni sul context engine sono
    assorbite e superate da questo documento.

## 3. Stato attuale e limiti

Tars dispone gia di fondamenta importanti:

- OpenAI Responses API con function calling;
- modelli distinti per richieste umane e trigger automatici;
- prompt caching esplicito e cache strumenti per run;
- profili strumenti per trigger;
- fascicolo commessa precaricato;
- strumenti read-only e strumenti `proponi_*`;
- approvazione tramite le mutation tRPC applicative;
- chiave d'azione canonica e blocco dei doppioni;
- conoscenza aziendale curata dalla direzione;
- cronologia chat limitata;
- registro di esecuzioni, token, cache, costo ed errori;
- Command Center e Centro Azioni persistente;
- classificazione e gestione di email e WhatsApp;
- letture trasversali di economia, produzione, qualita e organizzazione.

I limiti strutturali sono:

- il loop ragiona bene su un singolo run, ma non mantiene un piano persistente;
- la memoria e principalmente un prompt di regole e una cronologia testuale;
- non esiste un fascicolo sintetico persistente per cliente o commessa;
- manca un registro unico degli eventi business;
- le correlazioni vengono ricostruite ripetutamente dai tool;
- la chat completa espone molti strumenti senza un intent router formale;
- i tool schema sono ancora `strict: false`;
- non esiste un eval set operativo integrato nel processo di modifica;
- il feedback delle decisioni e iniettato come testo recente, non trasformato
  in conoscenza validata o metriche di calibrazione;
- le notifiche legacy sono calcolate on-demand e lette ogni 60 secondi;
- il Centro Azioni persiste situazioni, ma non consegne personali generalizzate;
- assegnare cliente o commessa non genera una notifica persistente;
- non esistono SSE, Web Push o un registro delivery;
- i controlli permessi sono sparsi e talvolta troppo aperti o troppo rigidi;
- il Centro Azioni osserva solo una parte dei domini;
- non esiste ricerca semantica su comunicazioni, documenti e note;
- una proposta approvata non produce sempre una verifica esplicita del risultato
  end-to-end.

## 4. Principi architetturali

### 4.1 Determinismo prima del modello

Identificatori, relazioni esatte, transizioni, permessi, deduplica, scadenze,
conteggi e calcoli economici devono restare codice applicativo. Il modello
interviene per interpretazione, disambiguazione, sintesi e pianificazione.

### 4.2 Evidenza prima della conclusione

Un fatto senza fonte non entra nel contesto come certezza. Un'inferenza deve
indicare le fonti da cui deriva e il proprio livello di confidenza.

### 4.3 Evento prima del polling

Le mutation e le integrazioni pubblicano eventi compatti. I consumer aggiornano
contesti, notifiche e situazioni. Il polling resta solo come recupero e
riconciliazione, non come meccanismo principale.

### 4.4 Sede e permessi nel codice

Il modello non sceglie sede, scope o privilegi. Ogni lettura, contesto, piano,
prova, evento e notifica e sede-scoped. Lo scope di visibilita deriva dal
contesto autenticato.

### 4.5 Attenzione come risorsa scarsa

Una notifica o proposta deve chiedere una decisione concreta. Aggiornamenti
informativi correlati vengono raggruppati nella situazione esistente.

### 4.6 Verifica dopo l'azione

Una mutation riuscita tecnicamente non basta. Il workflow verifica che il
risultato di dominio atteso sia realmente presente e coerente.

### 4.7 Rollout reversibile

Ogni nuovo livello e attivabile per sede in `off`, `shadow` o `active`. Spegnere
Tars non interrompe le funzioni normali del CRM.

## 5. Architettura generale

```text
Mutation e integrazioni
        |
        v
Registro eventi aziendali ------------------------------+
        |                                                |
        +--> consegna notifiche --> SSE / Push / Email   |
        |                                                |
        +--> context worker --> fascicoli intelligenti   |
        |                            |                   |
        +--> situation engine -------+                   |
                                     |                   |
Richiesta utente --> intent router --> planner ----------+
                                     |
                                     v
                               workflow specialistico
                                     |
                         letture / domande / proposte
                                     |
                              approvazione operatore
                                     |
                               mutation applicativa
                                     |
                              verifica del risultato
                                     |
                             eventi, memoria ed eval
```

I componenti condividono identificatori ed evidenze, ma restano separati nelle
responsabilita. Il sistema notifiche non dipende da una chiamata AI per gli
eventi certi. Tars non diventa un secondo database business.

## 6. Registro degli eventi aziendali

### 6.1 Contratto evento

Tabella proposta: `business_events`.

```text
id
sede_id
event_type
source_type
source_id
actor_user_id
subject_refs JSONB
recipient_hints JSONB
payload JSONB
dedupe_key
occurred_at
created_at
```

`payload` contiene metadati compatti e versionati, mai corpi completi, allegati,
base64, password, token o dati non necessari.

Esempi di `event_type`:

```text
cliente.created
cliente.updated
cliente.assigned
commessa.created
commessa.updated
commessa.assigned
commessa.state_changed
documento.added
documento.linked
fattura.synced
fattura.linked
pagamento.recorded
comunicazione.received
comunicazione.classified
comunicazione.linked
ticket.created
ticket.assigned
ticket.closed
intervento.created
intervento.assigned
intervento.rescheduled
proposta.created
proposta.approved
proposta.rejected
proposta.failed
tars.plan_waiting
tars.plan_completed
```

### 6.2 Pubblicazione e affidabilita

- Ogni evento possiede una `dedupe_key` univoca per sede.
- I producer pubblicano soltanto dopo la validazione business.
- Le mutation gia sostenute da tabelle PostgreSQL dedicate scrivono dato e
  outbox nella stessa transazione quando il confine del repository lo consente.
- Gli store `persistedStore` su JSONB non offrono oggi una transazione atomica
  tra entita business ed evento. In questi casi il service applicativo assegna
  prima una chiave operazione stabile, richiede il salvataggio, pubblica in modo
  idempotente e lascia al reconciler il recupero di eventuali eventi mancanti.
- Nessuna fase del rollout puo dichiarare garanzia exactly-once: il contratto e
  at-least-once con consumer idempotenti.
- Un errore nel consumer non annulla una mutation business gia riuscita.
- Gli eventi non elaborati restano visibili, ritentabili e non vengono persi.
- Gli aggiornamenti tecnici senza variazione materiale non pubblicano eventi.

### 6.3 Consumer

Consumer iniziali:

- notification projector;
- context invalidator e builder;
- situation reconciler;
- eval/outcome collector;
- audit stream;
- scheduler dei reminder.

Tabella di elaborazione proposta: `business_event_processing`.

```text
event_id, consumer_name
status, attempts, available_at
locked_by, locked_at
last_error_code, processed_at, updated_at
```

La chiave primaria e `(event_id, consumer_name)`. Ogni consumer reclama i record
con lock breve e `SKIP LOCKED`, rinnova o abbandona il lease e recupera i record
`processing` stale. Il fallimento di un consumer non blocca gli altri. Una
dead-letter resta visibile e ritentabile senza ripubblicare l'evento originale.

## 7. Sistema notifiche

### 7.1 Persistenza

Tabelle proposte:

```text
notifications
notification_deliveries
push_subscriptions
notification_preferences
```

Una notifica include:

```text
id, sede_id, recipient_user_id, actor_user_id
type, title, body, priority
entity_type, entity_id, link
action_kind, action_payload
canonical_key, group_key
status, read_at, seen_at, acted_at, resolved_at
expires_at, created_at, updated_at
```

Stati principali:

```text
unread -> seen -> acted | resolved
unread/seen -> expired
```

`read` non equivale a `risolta`. Aprire la campanella non deve far sparire una
responsabilita ancora aperta.

### 7.2 Consegna real-time

- SSE mantiene una connessione autenticata per utente e sede.
- L'endpoint deriva utente e sedi dalla sessione server; non accetta uno
  `userId` o `sedeId` arbitrario dal client.
- Il database e la sorgente di verita.
- PostgreSQL `LISTEN/NOTIFY` e un segnale di risveglio tra istanze, non la
  persistenza del messaggio.
- Il client invalida soltanto le query interessate.
- In assenza di SSE il polling di recupero resta disponibile.
- Il client mostra toast per eventi nuovi, non per l'intera lista ricaricata.
- `Last-Event-ID` e un cursore di consegna, non un'autorizzazione: ogni replay
  riapplica sessione, sede e destinatario.
- Le schede dello stesso browser eleggono una connessione primaria tramite
  `BroadcastChannel` quando supportato; le altre ricevono gli invalidamenti
  localmente per limitare connessioni duplicate.

### 7.3 Web Push

- Service worker dedicato.
- Chiavi VAPID in variabili ambiente.
- Consenso esplicito per dispositivo.
- Subscription associata a utente e revocabile.
- Payload esterno privacy-safe, senza importi o contenuti cliente.
- Deep link autenticato verso l'entita nel CRM.
- Retry limitato e disattivazione automatica delle subscription invalide.
- Il primo rollout supporta i browser desktop compatibili; dove il sistema
  operativo richiede installazione o non offre push affidabile restano SSE e
  campanella, senza promettere equivalenza inesistente.

### 7.4 Email di fallback

L'email non e il canale standard. Si usa soltanto quando una notifica critica:

- resta `unread` o non presa in carico oltre una soglia;
- non e in quiet hours o ferie, salvo emergenze configurate;
- non e gia stata consegnata con fallback equivalente;
- riguarda un utente con email verificata e preferenza attiva.

L'invio email richiede un provider outbound separato; l'IMAP esistente non e
considerato sufficiente. Il fallback resta dietro feature flag finche provider,
dominio mittente, bounce handling e disiscrizione amministrativa non sono
configurati.

### 7.5 Eventi personali

Notifica immediata:

- assegnazione o riassegnazione;
- revoca di responsabilita;
- menzione;
- domanda Tars destinata a un utente;
- proposta che richiede un ruolo o una capacita specifica;
- appuntamento modificato o annullato;
- blocco operativo;
- fallimento di un'azione approvata;
- scadenza critica;
- escalation di priorita.

Notifica raggruppata:

- messaggi ravvicinati nello stesso thread;
- anomalie della stessa commessa;
- reminder periodici;
- piu proposte sullo stesso obiettivo;
- aggiornamenti di avanzamento senza decisione immediata.

Nessuna notifica:

- sync riuscita;
- ricalcolo invariato;
- semplice lettura o refresh;
- evento gia rappresentato da una situazione aperta senza variazione
  materiale;
- messaggio puramente cortese senza azione.

### 7.6 Assegnazioni

Quando A assegna una risorsa a B:

1. si valida che B sia attivo, appartenga alla sede e possieda le capacita
   richieste;
2. si salva l'assegnazione;
3. si pubblica l'evento con A, B e precedente assegnatario;
4. la consegna precedente viene risolta o revocata;
5. B riceve notifica e coda personale;
6. il contesto Tars viene invalidato;
7. Tars puo suggerire la prima azione, ma non genera una notifica duplicata;
8. lo storico conserva autore, motivo e timestamp.

## 8. Modello dei permessi

### 8.1 Capability

I ruoli rimangono profili organizzativi, ma le autorizzazioni vengono espresse
come capacita:

```text
cliente.read
cliente.create
cliente.update_operational
cliente.assign
cliente.archive
cliente.delete
commessa.read
commessa.create
commessa.update_operational
commessa.assign
commessa.change_state
commessa.manage_documents
ticket.create
ticket.assign
ticket.manage
intervento.plan
intervento.assign
pagamento.read
pagamento.record
economia.read
tars.use
tars.approve_low_risk
tars.approve_high_risk
tars.manage_policy
```

### 8.2 Decisione autorizzativa

Contratto centrale:

```ts
can(user, capability, resource, context): PolicyDecision
```

La decisione considera:

- sede attiva e sedi assegnate;
- ruoli;
- override individuali;
- autore e assegnatario;
- deleghe temporanee;
- stato della risorsa;
- sensibilita del campo;
- tipo di operazione;
- eventuale separazione dei compiti.

Una negazione include un codice stabile e una spiegazione leggibile, senza
rivelare l'esistenza di record di altre sedi.

Prima dell'enforcement, ogni router produce in modalita audit la decisione
legacy e la decisione capability. Le differenze vengono aggregate per endpoint,
ruolo, sede e tipo di risorsa senza salvare payload sensibili. La matrice
desiderata viene approvata esplicitamente: "dare piu permessi" non puo tradursi
in accesso implicito a economia, cancellazioni, configurazioni o altre sedi.

### 8.3 Regole iniziali

- Ogni utente attivo puo creare clienti, commesse e ticket nella propria sede.
- Il creatore o assegnatario puo modificare i campi operativi consentiti.
- Il proprietario puo delegare a un utente compatibile della stessa sede.
- Un utente puo prendere in carico attivita libere coerenti col proprio ruolo.
- La direzione puo riassegnare qualsiasi attivita della sede.
- Dati economici, pagamenti, permessi e cancellazioni definitive restano
  protetti.
- Le modifiche di stato rispettano sempre state machine e doc gate.
- Nessuna capability consente accesso cross-sede.

### 8.4 Amministrazione

La pagina Utenti espone:

- ruoli;
- sedi;
- capacita ereditate;
- eccezioni con motivazione;
- deleghe temporanee;
- anteprima di cosa l'utente puo fare;
- storico modifiche;
- guard sull'ultimo utente direzione.

La lista dei candidati per assegnazioni, override e deleghe e sempre filtrata
per utenti attivi e sedi condivise. Anche gli endpoint amministrativi esistenti,
inclusi elenco utenti e dettaglio permessi, rientrano nell'audit cross-sede.

## 9. Memoria di Tars

### 9.1 Memoria operativa

Fascicoli sintetici per `cliente` e `commessa`, separati per scope:

```text
tars_entity_contexts
```

Campi principali:

```text
sede_id, entity_type, entity_id, visibility_scope
source_fingerprint
facts JSONB
summary
open_questions JSONB
commitments JSONB
contradictions JSONB
next_expected_actions JSONB
evidence_refs JSONB
model_version, prompt_version
last_event_at, rebuilt_at, updated_at
```

### 9.2 Memoria episodica

Conserva eventi e decisioni rilevanti, non ogni dettaglio tecnico:

- assegnazioni;
- promesse e scadenze;
- proposte e motivi di decisione;
- fallimenti e correzioni;
- cambi di stato;
- eccezioni approvate;
- risultati verificati.

### 9.3 Memoria procedurale

La conoscenza aziendale curata dalla direzione viene evoluta con:

- validita temporale;
- ambito di applicazione;
- priorita;
- fonte e autore;
- versione;
- conflitti espliciti;
- revisione periodica.

Tars puo proporre una nuova regola appresa, ma non pubblicarla autonomamente.

### 9.4 Memoria di lavoro

Il piano corrente vive in tabelle dedicate e sopravvive a:

- domanda di chiarimento;
- cambio pagina;
- nuovo login;
- riavvio applicativo;
- errore temporaneo del provider.

La chat resta una superficie, non la memoria primaria.

### 9.5 Fatti ed evidenze

Ogni fatto include:

```text
kind, value, source_ref, observed_at
confidence, derivation, valid_until
```

`derivation` distingue:

```text
explicit | deterministic | inferred | user_confirmed
```

Una deduzione `inferred` non puo essere trasformata silenziosamente in fatto
esplicito durante rebuild successivi.

## 10. Context engine

### 10.1 Event queue

`tars_context_events` conserva lo stato di elaborazione per entita, retry,
attempt, worker e ultimo errore. Due eventi ravvicinati sulla stessa entita
vengono accorpati.

### 10.2 Collector deterministico

Il collector legge soltanto dati consentiti e produce fatti canonici. I corpi
completi di messaggi e documenti non entrano nel fascicolo; restano richiamabili
come fonti.

### 10.3 Fingerprint

Il fingerprint SHA-256 include:

- fatti ordinati canonicamente;
- versioni delle fonti;
- schema;
- prompt;
- modello;
- visibility scope.

Fingerprint invariato significa zero chiamate al modello.

### 10.4 Rebuild

- Delta incrementale sugli eventi nuovi.
- Full rebuild settimanale per entita attive.
- Rebuild manuale della direzione.
- Invalidazione esplicita su cambio schema, prompt o modello.
- Un errore non distrugge l'ultimo contesto valido.
- Contesto stale dichiarato, mai presentato come aggiornato.

### 10.5 Correlazione

Prima fase deterministica:

- collegamenti esistenti;
- codice commessa;
- telefono ed email normalizzati;
- codice fiscale e partita IVA;
- numero fattura;
- identita FIC;
- importo e data;
- prossimita temporale;
- sede e assegnatario.

Seconda fase AI soltanto per un massimo di cinque candidati plausibili. Il
modello puo scegliere, dichiarare dubbio, chiedere o non collegare.

## 11. Intent router e planner

### 11.1 Intent router

Prima del loop completo, un passaggio economico e strutturato assegna:

```text
intent
workflow
entity_refs
risk_class
required_capabilities
confidence
needs_clarification
```

Intent iniziali:

```text
informational_query
cross_domain_search
create_customer_job
manage_communication
reconcile_invoice
manage_document
plan_intervention
manage_ticket
analyze_job
audit_process
```

Se l'intento e evidente dal bottone o dal contesto, il client/server lo passa
direttamente e salta il classificatore.

### 11.2 Piano persistente

Tabelle:

```text
tars_plans
tars_plan_steps
tars_plan_events
```

Stati piano:

```text
draft
running
waiting_user
waiting_approval
verifying
completed
failed
canceled
```

Ogni step ha:

- tipo;
- dipendenze;
- input verificato;
- output strutturato;
- stato;
- tentativi;
- evidenze;
- errore;
- data inizio e fine.

### 11.3 Ripresa

Una risposta a `chiedi_chiarimento` aggiorna lo step in attesa e riapre lo
stesso piano una sola volta. Non ricrea la richiesta originale e non duplica le
letture gia valide.

### 11.4 Proposta composta

Un obiettivo puo produrre una proposta composta con piu mutation ordinate, per
esempio cliente piu commessa. L'approvazione deve essere atomica dove possibile
o compensabile, e il risultato deve distinguere successo completo, parziale e
fallimento.

Poiche cliente e commessa vivono oggi in store JSONB distinti, il primo
workflow usa una saga applicativa persistente:

1. genera `operation_key` e idempotency key per ogni step;
2. verifica se cliente o commessa equivalenti esistono gia;
3. crea il cliente e registra immediatamente id e risultato;
4. crea la commessa usando l'id registrato;
5. verifica entrambe le post-condizioni;
6. in caso di errore non cancella automaticamente dati validi, ma espone il
   risultato parziale e una proposta di ripresa o compensazione approvabile.

Un retry riparte dallo step incompleto e non ricrea cio che e gia riuscito.

### 11.5 Verifica

Dopo l'esecuzione, un verifier deterministico controlla post-condizioni. Il
modello viene chiamato soltanto se le condizioni non sono esprimibili in modo
deterministico o se l'esito e ambiguo.

## 12. Workflow specialistici

Ogni workflow definisce:

- trigger ammessi;
- intent;
- dati obbligatori;
- strumenti di lettura;
- strumenti di proposta;
- permessi;
- rischio;
- post-condizioni;
- chiave canonica;
- criteri eval;
- fallback e rollback.

Ordine iniziale:

1. creazione cliente e prima commessa;
2. nuovo lead da email o WhatsApp;
3. assegnazione e presa in carico;
4. documento ricevuto, classificato e collegato;
5. fattura e pagamento;
6. intervento e calendario;
7. ticket e post-vendita;
8. commessa ferma;
9. audit dei processi.

Non si introduce un agente autonomo per ogni dominio. I workflow condividono
memoria, policy, evidenze, planner e registro. Specialisti separati saranno
valutati soltanto su compiti indipendenti che beneficiano realmente del
parallelismo.

## 13. Tool orchestration

### 13.1 Registry

Ogni tool dichiara:

```text
name, version, category
input_schema, output_schema
required_capability
risk
cache_policy
side_effect
idempotency
error_contract
```

Gli schemi migrano progressivamente a Structured Outputs strict-compatible.

### 13.2 Selezione

Il planner seleziona un profilo minimo per workflow. La chat non riceve piu
automaticamente l'intero catalogo quando l'intento e chiaro.

### 13.3 Chiamate programmatiche

Il programmatic tool calling puo essere usato per fasi delimitate come join,
filtri, ranking, deduplica e aggregazione. Restano chiamate dirette:

- giudizio semantico;
- decisione finale;
- richiesta di approvazione;
- azioni con effetti;
- output che deve preservare prove native.

### 13.4 Budget

Budget separati per:

- tool call;
- round-trip modello;
- token input;
- token output;
- durata;
- numero proposte;
- numero entita approfondite.

Il superamento produce uno stato esplicito e un piano riprendibile.

## 14. Caching ed efficienza

Livelli:

1. matching e regole deterministiche;
2. prompt caching OpenAI gia presente;
3. cache strumenti per run gia presente;
4. fascicolo persistente per entita;
5. cache query cross-run versionata;
6. cache ricerca semantica;
7. output dei passaggi completati nel piano;
8. batching e debounce degli eventi;
9. model routing per complessita;
10. zero model call su fingerprint invariato.

Le cache cross-run includono sempre sede, scope, versione entita e versione
policy. Un cambio rilevante invalida per evento, non soltanto per TTL. Gli
errori non vengono memorizzati come risultati validi.

Metriche obbligatorie:

- token per workflow riuscito;
- cache read e write;
- model call evitate;
- query riusate;
- contesti invariati;
- latenza per fase;
- costo per tipo di risultato.

## 15. Ricerca semantica

La ricerca vettoriale arriva dopo il context engine e usa PostgreSQL con
`pgvector` se disponibile nell'ambiente di produzione.

Fonti iniziali:

- corpi email;
- thread WhatsApp;
- testo estratto dai documenti;
- note operative;
- conoscenza aziendale;
- decisioni e motivi di rifiuto rilevanti.

Ogni chunk include sede, ACL, fonte, entita, data, checksum e versione. La
ricerca e ibrida: filtri strutturati e testuali prima, similarita vettoriale
dopo. Nessun embedding sostituisce query certe su importi, date, stato o
relazioni.

Il retriever restituisce pochi frammenti, con riferimenti, e applica nuovamente
i permessi al momento della lettura.

Archiviazione, eliminazione o rettifica della fonte genera un evento che
invalida chunk, embedding e cache derivate. Un indice semantico non puo
conservare testo che l'utente non e piu autorizzato a leggere o che e stato
eliminato dalla sorgente.

## 16. Situation engine e Centro Azioni

Il Centro Azioni attuale diventa la vista delle situazioni persistenti, non un
duplicato delle notifiche.

Una situazione aggrega:

- segnali;
- entita;
- responsabile;
- scadenza;
- contraddizioni;
- evidenze;
- piano Tars;
- prossima azione;
- notifiche consegnate;
- stato di risoluzione.

Le notifiche sono consegne personali generate da una situazione o da un evento
diretto. Una situazione puo avere piu destinatari nel tempo, ma una sola chiave
canonica.

Il motore deterministico resta proprietario di priorita minime e trigger certi.
Tars puo aumentare l'urgenza con prove, non abbassare silenziosamente una
criticita deterministica.

## 17. Esperienza utente Tars

### 17.1 Command Center

Sezioni:

- `Oggi`: situazioni e responsabilita personali;
- `Piani`: obiettivi in corso, attese, blocchi ed esiti;
- `Proposte`: decisioni richieste;
- `Analisi`: trend, anomalie e processi;
- `Chat`: interrogazione libera;
- `Registro`: run, eventi, costi, cache e fallimenti.

### 17.2 Presenza contestuale

Tars appare nelle pagine business con una fascia non invasiva:

- situazione sintetica;
- prossima azione;
- dati mancanti;
- evidenze;
- piano in corso;
- proposta o domanda pertinente.

Non apre automaticamente modali e non ripete notifiche gia presenti nella
campanella.

### 17.3 Chat

La chat mostra:

- intenzione riconosciuta;
- entita coinvolte;
- fase corrente;
- fonti consultate;
- domanda aperta;
- proposta prodotta;
- verifica finale.

Le fasi sono eventi reali del piano, non animazioni temporizzate inventate dal
client.

### 17.4 Notifiche

La campanella mostra al massimo tre elementi prioritari e apre il Centro Azioni
per la coda completa. Ogni riga consente l'azione minima appropriata: apri,
prendi in carico, rispondi, rinvia o valuta proposta.

## 18. Autonomia progressiva

Livelli:

```text
L0 lettura
L1 spiegazione o segnalazione
L2 proposta con approvazione
L3 esecuzione reversibile con annullamento
L4 operazione sensibile sempre approvata
```

Una capacita puo passare a L3 soltanto se:

- ha almeno 100 decisioni reali;
- supera il 98% di esiti corretti;
- mantiene la soglia per sei settimane;
- non ha incidenti di sicurezza o sede;
- e completamente reversibile;
- possiede verifica automatica;
- ha rollback testato;
- e abilitata esplicitamente dalla direzione per sede.

L'autonomia si revoca automaticamente se:

- l'accuratezza mobile scende sotto soglia;
- fallisce la verifica;
- cambia schema, prompt, modello o workflow in modo materiale;
- si verifica un incidente;
- aumenta il tasso di annullamento;
- l'eval di regressione fallisce.

## 19. Eval e apprendimento

### 19.1 Dataset

Famiglie iniziali:

- classificazione email;
- interpretazione WhatsApp inbound e outbound;
- correlazione cliente/commessa;
- creazione cliente e commessa;
- assegnazione;
- fatture e pagamenti;
- documenti;
- ticket;
- commesse ferme;
- domande che richiedono `nessuna_azione`;
- prompt injection;
- cross-sede e permessi.

Ogni caso contiene input minimizzato, ground truth, strumenti attesi, strumenti
vietati, evidenze richieste e risultato accettabile.

### 19.2 Grader

- exact match per classificazioni e identificatori;
- schema validation per output strutturati;
- confronto set per tool call;
- assertion deterministiche su proposte e mutation;
- verifica citazioni;
- grader modello solo per qualita linguistiche o semantiche non riducibili a
  regole;
- revisione umana dei casi ad alto rischio.

### 19.3 Feedback reale

Approvazioni, rifiuti, modifiche alla proposta, annullamenti e risultati
alimentano metriche e candidati per l'eval. Non diventano automaticamente
regole del prompt.

### 19.4 Gate di rilascio

Ogni modifica a modello, prompt, tool, planner, retrieval o autonomia deve:

- superare test unitari e integrazione;
- non peggiorare i casi critici;
- riportare differenze su qualita, token, latenza e costo;
- essere provata in shadow mode prima dell'attivazione automatica.

## 20. Metriche

Metriche prodotto:

- tempo assegnazione -> presa in carico;
- attivita scadute non gestite;
- tempo medio di chiusura situazione;
- percentuale di workflow completati;
- percentuale proposte approvate e modificate;
- domande necessarie per completare un obiettivo;
- notifiche ignorate, raggruppate e duplicate evitate.

Metriche intelligenza:

- accuratezza dei fatti;
- copertura delle evidenze;
- precisione delle correlazioni;
- calibrazione della confidenza;
- tool selection accuracy;
- successo della verifica post-azione;
- tasso di `nessuna_azione` corretto;
- regressioni per workflow.

Metriche tecniche:

- p50/p95 latenza;
- token e costo per workflow riuscito;
- prompt cache read/write;
- context cache hit;
- eventi pending, stale e failed;
- notifiche consegnate per canale;
- connessioni SSE;
- push invalide;
- errori policy;
- tentativi cross-sede bloccati.

Target iniziali:

- consegna real-time p95 sotto 3 secondi;
- zero proposte duplicate con stessa chiave;
- meno dell'1% di duplicati percepiti;
- almeno 95% delle conclusioni importanti con evidenze valide;
- almeno 85% di approvazione generale;
- almeno 95% dei workflow senza ricominciare da zero;
- riduzione del 60% dei token per azione completata rispetto alla baseline;
- zero esposizioni cross-sede.

Approvazione, accuratezza e costo vengono pubblicati anche per workflow,
classe di rischio, sede e versione di modello/prompt. La media generale non e
mai sufficiente per abilitare autonomia o nascondere un workflow debole.

## 21. Sicurezza e privacy

- Nessun tool di mutation diretta viene esposto al modello.
- Le proposte passano dalle mutation applicative e dalle capability.
- Contenuti esterni restano non fidati e delimitati.
- Le evidenze vengono risolte con autorizzazione al momento della lettura.
- I contesti non copiano blob o conversazioni integrali.
- Log e push non contengono segreti o payload cliente completi.
- Ogni piano conserva l'identita dell'operatore che lo ha avviato.
- Le esecuzioni automatiche usano un principal di sistema con capability
  minime e scope sede.
- Le azioni composte applicano idempotenza e compensazione.
- Esistono kill switch globali e per sede.
- La direzione puo esportare il registro delle decisioni senza esportare i
  contenuti sensibili delle fonti.

## 22. Errori e recupero

### 22.1 Provider AI non disponibile

Gli eventi e le notifiche certe continuano. I piani passano in attesa tecnica e
vengono ritentati. Nessuna comunicazione viene nascosta.

### 22.2 Worker in errore

Backoff, limite tentativi, dead-letter visibile e retry manuale. I record
`processing` stale tornano `pending`.

### 22.3 SSE disconnessa

Il client riconnette con `Last-Event-ID`, poi riallinea dal database. Il polling
di recupero impedisce perdita percepita.

### 22.4 Push fallita

La campanella resta valida. Subscription invalide vengono disattivate senza
cancellare la notifica.

### 22.5 Piano parziale

Lo stato distingue `failed` da `partially_completed`. Il sistema mostra cosa e
stato creato, cosa manca e quale compensazione e disponibile.

Il retry usa le idempotency key degli step e non ripete mutation gia confermate.
La compensazione e una nuova azione auditata e approvabile, non un rollback
silenzioso orchestrato dal modello.

### 22.6 Contesto stale

Tars dichiara l'eta del contesto e usa reader live per decisioni sensibili. Non
presenta un riepilogo stale come fonte definitiva.

## 23. Feature flag e rollout

Configurazione per sede:

```text
eventBusMode              off | shadow | active
notificationMode          legacy | shadow | active
realtimeNotifications     boolean
webPushEnabled            boolean
contextEngineMode         off | shadow | active
plannerMode               off | shadow | active
semanticSearchMode        off | shadow | active
autonomyCapabilities      capability[]
```

Sequenza:

1. baseline ed eval;
2. registro eventi in shadow;
3. notifiche persistenti e confronto legacy;
4. SSE;
5. Web Push;
6. policy engine in audit-only;
7. enforcement capability;
8. context engine e backfill controllato;
9. planner sul workflow cliente+commessa;
10. estensione ai workflow prioritari;
11. ricerca semantica;
12. autonomia L3 su singole capacita qualificate.

Ogni fase ha rollback tramite flag senza cancellazione delle tabelle. Le
scritture nuove sono additive finche la fase precedente non e stabilizzata.

## 24. Migrazione e backfill

- Le notifiche legacy restano leggibili durante shadow mode.
- I read id legacy non vengono tradotti in responsabilita risolte.
- Il Centro Azioni corrente viene mantenuto e migrato per estensione.
- Il context backfill considera soltanto clienti con commesse attive e commesse
  non archiviate.
- Il backfill pubblica eventi idempotenti, non chiama direttamente OpenAI.
- Ogni script supporta `--sede`, `--limit` e `--dry-run`.
- Nessun backfill reale viene eseguito senza verifica del dry-run.
- Le nuove capability partono dai ruoli attuali e producono un report diff
  prima dell'enforcement.

## 25. Test e criteri di accettazione

### 25.1 Eventi

- deduplica;
- ordine e versione;
- retry e stale recovery;
- piu istanze;
- isolamento consumer;
- claim concorrente e lease stale;
- dead-letter e retry per singolo consumer;
- sede;
- riconciliazione dopo pubblicazione mancata.

### 25.2 Notifiche

- assegnazione, riassegnazione e revoca;
- grouping;
- read contro resolved;
- SSE reconnect;
- replay SSE con autorizzazione riapplicata;
- coordinamento multi-tab con fallback senza `BroadcastChannel`;
- push privacy-safe;
- preferenze e quiet hours;
- email fallback una sola volta;
- nessun doppione tra legacy e active.

### 25.3 Permessi

- matrice ruolo/capability;
- override e delega;
- ownership;
- stato risorsa;
- campo economico;
- `NOT_FOUND` cross-sede;
- ultimo utente direzione;
- diff audit-only contro comportamento corrente.

### 25.4 Contesto

- fatti per scope;
- evidenze obbligatorie;
- fingerprint canonico;
- zero model call su invariato;
- rebuild e stale;
- correlazione deterministica;
- disambiguazione;
- nessuna promozione silenziosa inferenza -> fatto.

### 25.5 Planner

- intent routing;
- piano multi-step;
- ripresa dopo domanda;
- idempotenza;
- timeout e budget;
- proposta composta;
- successo parziale;
- retry della saga senza duplicare cliente o commessa;
- compensazione come nuova azione approvabile;
- verifica post-condizione;
- cancellazione.

### 25.6 Eval

- regressione classificazione;
- tool attesi e vietati;
- fonti;
- prompt injection;
- nessuna azione;
- costi e token;
- confronto modelli;
- gate autonomia.

### 25.7 Frontend

- stato loading, vuoto, errore e offline;
- aggiornamento real-time;
- focus e tastiera;
- Web Push opt-in;
- timeline e piano leggibili;
- nessuno scroll orizzontale globale;
- verifica 1440x900 e 390x844;
- nessun errore console.

## 26. Criteri di completamento del programma

Il programma puo dirsi riuscito quando:

- un'assegnazione viene consegnata immediatamente al destinatario;
- Tars riprende un obiettivo dopo una domanda senza perdere il contesto;
- ogni cliente e commessa attivi possiedono un fascicolo aggiornabile;
- Tars collega fonti diverse mostrando le prove;
- una proposta approvata viene verificata fino all'esito;
- il Command Center mostra responsabilita e piani, non rumore;
- le modifiche a prompt o modello passano da eval;
- il costo per azione riuscita scende rispetto alla baseline;
- le capability sostituiscono i controlli incoerenti senza regressioni;
- almeno un'azione reversibile raggiunge eventualmente L3 rispettando tutti i
  gate, senza forzare l'autonomia come obiettivo artificiale.

## 27. Fuori ambito iniziale

- invio autonomo di email o WhatsApp;
- modifica autonoma di fatture FIC;
- accesso di Tars a credenziali o segreti;
- sostituzione totale degli store business esistenti;
- multi-agent generalizzato;
- addestramento o fine-tuning prima di dataset ed eval sufficienti;
- autonomia globale concessa al modello;
- notifiche esterne contenenti dati cliente sensibili;
- applicazione mobile nativa.

## 28. Riferimenti tecnici

- `server/tars/loop.ts`: loop OpenAI corrente.
- `server/tars/tools.ts`: registry e profili strumenti correnti.
- `server/tars/stores.ts`: proposte, conoscenza, chat, config ed esecuzioni.
- `server/actionCenter/*`: situazioni persistenti e ranking deterministico.
- `server/routers/notifiche.ts`: notifiche legacy e API Centro Azioni.
- `server/_core/permissions.ts`: autorizzazioni correnti da consolidare.
- `docs/superpowers/specs/2026-08-22-messaggi-tars-context-design.md`:
  base storica del context engine.
- `docs/superpowers/specs/2026-08-24-centro-azioni-tars-design.md`:
  base del Centro Azioni corrente.
