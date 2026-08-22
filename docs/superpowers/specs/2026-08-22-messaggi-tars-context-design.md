# Messaggi separati e Tars a contesto incrementale

**Data:** 22 agosto 2026
**Stato:** design approvato
**Ambito:** navigazione, pagine Email e WhatsApp, contesto trasversale e cabina operativa Tars

## 1. Obiettivo

Ruffino Flow deve separare Email e WhatsApp in esperienze operative diverse e
rendere Tars un livello di intelligenza trasversale, indipendente dai canali.

Tars deve correlare clienti, commesse, fatture, allegati, messaggi WhatsApp,
email, appuntamenti, pagamenti, produzione e post-vendita. Deve farlo in modo
incrementale, verificabile e parsimonioso nell'uso dei token. Resta invariato il
principio di sicurezza: Tars propone azioni, ma non esegue mutation business
senza approvazione esplicita.

## 2. Decisioni approvate

1. La sidebar contiene una nuova area **Messaggi**, separata da **Tars**.
2. **Email** e **WhatsApp** sono pagine sorelle, non filtri della stessa inbox.
3. Email lavora per singolo messaggio, richiesta e allegato.
4. WhatsApp lavora per conversazione, contatto e cronologia.
5. Tars apre su una cabina operativa con priorità, prove e proposte; la chat è
   disponibile ma non domina la pagina.
6. Il contesto viene aggiornato dagli eventi e ricostruito solo per le entità
   cambiate.
7. Un audit notturno cerca pattern trasversali; una ricostruzione periodica
   completa evita la deriva dei riepiloghi incrementali.

## 3. Architettura dell'informazione

### 3.1 Navigazione

La sidebar diventa:

```text
Dashboard
Clienti
Commesse
Cantiere
Economia
Post-Vendita
Messaggi
  Email
  WhatsApp
Tars
Utenti
Sedi
Impostazioni
```

Le nuove rotte canoniche sono:

- `/messaggi/email`
- `/messaggi/whatsapp`
- `/tars`

Per non rompere notifiche, preferiti e deep link esistenti:

- `/comunicazioni` reindirizza a `/messaggi/email` conservando i parametri di
  query riconosciuti;
- `/inbox` reindirizza a `/tars` conservando il tab richiesto;
- i link dalle impostazioni Email e WhatsApp puntano alla rispettiva pagina;
- i riferimenti Tars a una fonte aprono il messaggio o la conversazione nel
  canale corretto.

### 3.2 Persistenza delle comunicazioni

La tabella PostgreSQL `comunicazioni` resta la sorgente condivisa. Separare le
pagine non richiede duplicare o migrare i messaggi. Ingestione, idempotenza,
soft delete, classificazione e collegamenti esistenti rimangono compatibili.

I servizi backend espongono query specifiche per canale sopra lo stesso store:

- Email restituisce messaggi e relativi stati operativi;
- WhatsApp restituisce conversazioni aggregate e messaggi ordinati nel thread;
- Tars legge fonti mediante strumenti sede-scoped, mai direttamente dal client.

## 4. Pagina Email

La pagina Email conserva la densità di una inbox operativa, ma rimuove ogni
concetto specifico di WhatsApp.

### 4.1 Struttura

- intestazione con stato sincronizzazione e azione aggiorna;
- metriche compatte: da gestire, nuovi lead, con allegati, dubbie;
- viste: Da gestire, Nuovi lead, Allegati, Collegate, Gestite, Escluse;
- ricerca su mittente, oggetto, corpo, cliente e commessa;
- filtro casella, assegnatario e categoria;
- elenco per messaggio con mittente, oggetto, anteprima, allegati e stato;
- lettore con corpo, allegati, collegamenti e azioni contestuali.

### 4.2 Azioni

L'operatore può collegare il messaggio a cliente o commessa, archiviare gli
allegati nel fascicolo, gestire la classificazione, creare un lead tramite una
proposta Tars, segnare il messaggio come gestito o escluderlo.

Le richieste di preventivo e le opportunità restano sempre visibili. Soltanto
spam, newsletter e comunicazioni inutili possono essere escluse, mantenendo il
comportamento intelligente già definito nel PRD.

## 5. Pagina WhatsApp

WhatsApp è una vista per conversazioni, non una lista piatta di messaggi.

### 5.1 Identità della conversazione

La chiave logica è composta da `sedeId`, configurazione/numero aziendale e
numero normalizzato della controparte. Questo evita di unire conversazioni di
sedi o numeri aziendali diversi.

Il nome visualizzato segue questa priorità:

1. cliente CRM collegato;
2. profilo WhatsApp ricevuto da Meta;
3. numero normalizzato.

### 5.2 Struttura

- elenco conversazioni ordinato per ultimo messaggio;
- badge nuovi messaggi e indicatori di collegamento;
- ricerca per contatto, numero, cliente e commessa;
- thread cronologico con distinzione entrata/uscita e allegati;
- pannello contestuale con cliente, commessa, appuntamenti, ticket e proposte;
- stato della sincronizzazione dello storico Meta;
- indicazione esplicita che il CRM è in sola lettura e la risposta avviene
  dall'app WhatsApp Business.

I thread lunghi devono essere paginati o virtualizzati. Il client non carica
l'intera cronologia di tutti i contatti.

## 6. Cabina operativa Tars

La rotta `/tars` apre sulla vista **Oggi**. Le sezioni sono:

- **Oggi:** brief operativo e priorità ordinate per impatto e urgenza;
- **Proposte:** decisioni pendenti e storico delle decisioni;
- **Analisi:** audit, trend, anomalie e miglioramenti dei processi;
- **Chat:** interrogazione trasversale dell'azienda;
- **Registro:** esecuzioni, costi, cache, errori e retry.

Ogni segnale deve mostrare:

- conclusione leggibile;
- motivazione;
- livello di confidenza;
- fonti che sostengono la conclusione;
- entità coinvolte;
- azione proposta o richiesta di chiarimento.

Tars non contiene più l'elenco Email/WhatsApp. Le prove sono deep link verso le
pagine dei canali o verso i fascicoli business.

## 7. Contesto incrementale

### 7.1 Coda persistente degli eventi

Una tabella dedicata `tars_context_events` conserva riferimenti agli eventi che
possono cambiare il contesto. Non contiene corpi completi di email, file o altri
blob. Campi minimi:

```text
id
sede_id
event_type
source_type
source_id
entity_refs JSONB
dedupe_key
status            pending | processing | completed | failed
attempts
available_at
last_error
created_at
updated_at
```

`dedupe_key` rende idempotente la pubblicazione dello stesso evento. Il worker
acquisisce i record con lock PostgreSQL e li elabora in sicurezza anche con più
istanze applicative.

Produttori iniziali:

- inserimento Email o messaggio WhatsApp;
- aggiunta, rinomina o collegamento di un allegato/documento;
- sincronizzazione, collegamento o variazione di una fattura FIC;
- creazione/modifica di appuntamento o intervento;
- creazione/modifica di ticket, reclamo, anomalia o rifacimento;
- modifica rilevante di cliente, commessa, timeline, pagamento o produzione.

Eventi ravvicinati sulle stesse entità vengono accorpati con debounce. Il worker
elabora il delta, non una copia integrale del CRM.

### 7.2 Fascicoli intelligenti

Una tabella `tars_entity_contexts` conserva il contesto sintetico per cliente e
commessa:

```text
id
sede_id
entity_type       cliente | commessa
entity_id
visibility_scope operativo | amministrazione | direzione
source_fingerprint
facts JSONB
summary
evidence_refs JSONB
model_version
prompt_version
last_event_at
rebuilt_at
updated_at
```

La chiave unica include sede, tipo, id e `visibility_scope`. Un riepilogo creato
con dati economici non viene mai riutilizzato per un ruolo operativo.

`facts` contiene fatti strutturati e compatti, non copie dei documenti. Ogni
fatto derivato mantiene uno o più riferimenti in `evidence_refs`. Il resolver
della fonte riapplica sempre sede e permessi prima di restituirne il contenuto.

### 7.3 Fingerprint e invalidazione

Il fingerprint combina versioni o `updatedAt` delle entità coinvolte, checksum
dei file immutabili, id/versione delle comunicazioni e versione di prompt e
modello. Se il fingerprint non cambia, non parte alcuna chiamata al modello.

Il contesto incrementale usa il riepilogo corrente più gli eventi nuovi. Per
evitare accumulo di errori:

- il controllo notturno verifica relazioni e anomalie globali;
- i fascicoli attivi vengono ricostruiti integralmente almeno ogni sette giorni;
- un cambio di prompt, schema o modello invalida il livello interessato;
- l'operatore di direzione può richiedere una ricostruzione manuale.

## 8. Pipeline di correlazione

La correlazione usa due fasi.

### 8.1 Candidati deterministici

Il server genera candidati tramite segnali verificabili:

- collegamenti espliciti già presenti;
- telefono normalizzato;
- email;
- codice fiscale o partita IVA;
- codice commessa, numero fattura o riferimento documento;
- identità cliente FIC;
- importo e data compatibili con rata o pagamento;
- prossimità temporale con appuntamenti e ticket;
- assegnatario e sede.

I segnali producono un punteggio spiegabile. Un match esatto e univoco non
richiede AI.

### 8.2 Disambiguazione AI

Il modello riceve soltanto i candidati plausibili, i fatti compatti e le fonti
necessarie. Può:

- scegliere il candidato con motivazione;
- dichiarare il dubbio;
- chiedere una decisione all'operatore;
- non proporre alcuna azione.

Il modello non può creare collegamenti o modifiche direttamente. Le mutation
restano dietro il sistema di proposte e approvazione esistente.

## 9. Strategia token e cache

La riduzione dei token avviene a livelli:

1. matching deterministico prima del modello;
2. nessuna esecuzione se il fingerprint non cambia;
3. fascicoli sintetici persistenti per cliente e commessa;
4. elaborazione dei soli delta;
5. profili strumenti piccoli e stabili per trigger;
6. preload del fascicolo quando `commessaId` è noto;
7. cache letture per singolo run;
8. prompt caching del provider tramite ordine stabile di prompt e strumenti;
9. accorpamento degli eventi ravvicinati;
10. modello automatico economico per classificazione e correlazioni semplici.

I metadati di esecuzione registrano token input/output, cache hit, fingerprint,
strumenti usati, entità aggiornate e motivo di eventuale salto del modello.

## 10. Deduplica delle proposte

La chiave canonica esistente viene estesa alle fonti e all'intento. Esempi:

```text
collega_comunicazione:<comunicazioneId>:<commessaId>
collega_fattura:<ficId>:<commessaId>
crea_appuntamento:<commessaId>:<tipo>:<dataOra>
registra_pagamento:<commessaId>:<importo>:<data>:<fonteId>
crea_ticket:<clienteId>:<commessaId|none>:<sourceId>
```

Una proposta non viene ricreata se la stessa chiave è pendente, approvata,
rifiutata, risposta o già gestita. Un nuovo fatto materialmente diverso produce
una nuova chiave o una revisione esplicita della proposta precedente.

## 11. Sicurezza e privacy

- Ogni evento e contesto include `sedeId`.
- Un riferimento di un'altra sede produce `NOT_FOUND`.
- Gli scope economici sono separati e verificati al recupero.
- Le prove conservano identificatori, non segreti o payload completi.
- Token, password, contenuti cliente completi e allegati non entrano nei log.
- Email, WhatsApp e allegati sono contenuto esterno non fidato e non possono
  impartire istruzioni a Tars.
- Nessuna mutation autonoma viene aggiunta.

## 12. Errori, retry e osservabilità

Il worker usa retry con backoff. Dopo cinque errori l'evento resta in stato
`failed`, visibile nel Registro Tars e riprovabile dalla direzione. Il record non
viene cancellato e la pagina del canale continua a mostrare il messaggio o il
documento originale.

In caso di riavvio, gli eventi rimasti `processing` oltre una soglia tornano
`pending`. Le scritture di contesto e il completamento dell'evento avvengono in
transazione o con controlli idempotenti equivalenti.

La pagina Tars mostra almeno:

- profondità e anzianità della coda;
- ultimo evento completato;
- errori e retry;
- percentuale di fingerprint invariati;
- cache hit e token risparmiati;
- numero di proposte duplicate evitate.

## 13. API applicative

I nomi definitivi seguiranno i pattern tRPC del repository. Il contratto logico
richiede:

- query Email per lista, dettaglio, conteggi e filtri;
- query WhatsApp per conversazioni, thread e contesto;
- `tars.commandCenter` per brief e priorità;
- `tars.context.get` e rebuild autorizzato;
- `tars.events.health`, lista errori e retry autorizzato;
- riuso di proposte, chat ed esecuzioni esistenti.

Le query di lista sono paginabili. Nessuna pagina scarica in un'unica risposta
tutte le comunicazioni o tutti i contesti.

## 14. Rollout

### Fase 1 - Separazione UX

Creare rotte, navigazione e pagine Email/WhatsApp sopra i dati esistenti.
Mantenere redirect e azioni attuali. Questa fase non cambia l'ingestione.

### Fase 2 - Eventi e contesti

Introdurre tabelle, producer, worker, fingerprint e osservabilità dietro una
feature flag per sede. Eseguire backfill dei soli clienti e commesse attivi.

### Fase 3 - Cabina Tars

Costruire la vista Oggi e integrare prove, proposte, chat, analisi e registro.
Il brief usa i contesti nuovi; in assenza di contesto mostra uno stato di
preparazione, non dati inventati.

### Fase 4 - Proattività completa

Attivare trigger incrementali, audit notturno e ricostruzione settimanale.
Misurare costi, precisione e rumore prima di estendere la feature flag a tutte le
sedi.

## 15. Test e criteri di accettazione

### Backend

- test di idempotenza e ripresa della coda;
- test sede/ruolo per eventi, contesti e prove;
- test fingerprint invariato: zero chiamate modello;
- test invalidazione per ogni tipo di fonte;
- test matching deterministico e disambiguazione;
- test deduplica per ogni azione canonica;
- test retry, evento fallito e recupero dopo riavvio;
- test metadati token e cache.

### Frontend

- redirect delle vecchie rotte;
- Email e WhatsApp con stati loading, vuoto, errore e paginazione;
- deep link alle fonti;
- pagina Tars con brief, prove, proposte, chat e registro;
- tastiera, focus visibile e target touch;
- verifica a 1440x900 e 390x844;
- nessuno scroll orizzontale globale.

### Risultati misurabili

- nessuna chiamata AI per fascicoli con fingerprint invariato;
- contesto aggiornato entro due minuti dal nuovo evento in condizioni normali;
- ogni deduzione mostra almeno una fonte; le correlazioni tra sistemi ne mostrano
  almeno due;
- zero proposte duplicate con la stessa chiave canonica;
- coda e fallimenti osservabili senza accedere ai log Railway;
- riduzione misurabile dei token input rispetto alla ricostruzione completa,
  registrata per trigger e non stimata soltanto dalla UI.

## 16. Fuori ambito

- invio di email o messaggi WhatsApp dal CRM;
- mutation autonome di Tars;
- embeddings o ricerca vettoriale nella prima iterazione;
- copia dei file o dei corpi completi nei contesti;
- sostituzione degli store business esistenti;
- unificazione visiva futura con PEC, SMS o telefonia, che potranno comunque
  entrare nell'area Messaggi senza cambiare questa architettura.
