# Centro Azioni e notifiche assistite da Tars

**Data:** 24 agosto 2026
**Stato:** design approvato
**Ambito:** notifiche, priorita operative, Command Center Tars, deduplica e presa in carico

## 1. Obiettivo

Ruffino Flow deve sostituire l'attuale elenco di notifiche con un sistema di
lavoro assistito. La campanella non misura piu tutto cio che il CRM sa, ma
soltanto le eccezioni personali che richiedono un'azione o una decisione nel
breve periodo.

Tars aiuta l'operatore a smaltire i casi: incrocia i dati disponibili, spiega
il problema, identifica la prossima azione e crea proposte approvabili. Rimane
invariato il principio di sicurezza: Tars propone, ma non esegue mutation
business senza approvazione esplicita.

## 2. Diagnosi verificata

Il 24/08/2026 la produzione mostrava una campanella satura a 100 elementi,
mentre Tars dichiarava zero decisioni urgenti. Nei 100 elementi visibili:

- erano coinvolte 74 commesse;
- 20 commesse comparivano piu di una volta;
- una stessa commessa compariva fino a tre volte;
- 34 elementi erano semplici avvisi di inattivita;
- 26 erano ticket aperti;
- 19 erano saldi residui;
- 9 erano routing generici per stato;
- 7 erano consegne senza data;
- 5 erano promemoria giornalieri.

L'elenco client e limitato a 100 record, quindi il badge puo rappresentare una
coda gia troncata. Il problema non e soltanto quantitativo:

- uno stesso fatto produce piu notifiche indipendenti;
- il promemoria giornaliero rinasce anche senza variazioni del caso;
- `read` indica soltanto apertura, non presa in carico o risoluzione;
- mancano responsabile, scadenza, rinvio e prossima azione;
- qualunque modifica a `commessa.updatedAt` puo azzerare l'anzianita, anche se
  non risolve il blocco operativo;
- la direzione riceve molti elementi di sede che non richiedono un suo
  intervento diretto;
- notifiche deterministiche e priorita Tars vivono in due code incoerenti.

## 3. Principi approvati

1. La campanella contiene soltanto eccezioni azionabili personali.
2. Leggere non equivale a gestire.
3. Una situazione produce un solo caso operativo, anche quando ha piu segnali.
4. Ogni caso ha una prossima azione, un responsabile e una scadenza o data di
   revisione.
5. Gli elementi informativi confluiscono nel Brief di Tars e nelle pagine di
   dominio, senza alimentare il badge.
6. Tars analizza, correla e propone; l'operatore approva le modifiche.
7. Le regole certe non dipendono dalla disponibilita di OpenAI.
8. L'AI non puo nascondere scadenze, rischi economici o eventi critici
   prodotti dalle regole deterministiche.
9. Il sistema deve ridurre il rumore senza imporre un limite che nasconda casi
   realmente critici.

## 4. Modello concettuale

### 4.1 Segnale

Un segnale e un fatto verificabile prodotto da un dominio, per esempio:

- commessa ferma oltre la soglia;
- stato che richiede un passaggio operativo;
- consegna non confermata;
- saldo residuo;
- ticket aperto o assegnato;
- intervento imminente senza squadra;
- garanzia in scadenza;
- comunicazione operativa da gestire;
- proposta Tars in attesa di decisione;
- documento obbligatorio mancante;
- fattura non collegata o incoerente.

Il segnale contiene una chiave stabile, la fonte, le entita coinvolte, un
fingerprint dei dati e una classificazione deterministica. Non possiede uno
stato letto/non letto.

### 4.2 Caso operativo

Il caso operativo raggruppa i segnali che descrivono la stessa situazione. La
chiave canonica include sempre `sedeId` e il target principale. Il primo
livello di raggruppamento e per commessa, ticket, intervento, garanzia,
comunicazione o proposta Tars.

Per evitare una nuova frammentazione, un caso espone una sola prossima azione
alla volta. Gli altri segnali rimangono visibili come evidenze e possono
diventare la prossima azione dopo la chiusura della precedente. Esempio: una
commessa ferma con ticket urgente e saldo aperto rimane una sola riga; Tars puo
indicare prima il ticket e conservare il saldo tra le evidenze da affrontare.

### 4.3 Prossima azione

La prossima azione descrive:

- cosa deve essere deciso o fatto;
- chi ne e responsabile;
- entro quando;
- quale risultato la chiude;
- quali evidenze la giustificano;
- l'eventuale proposta Tars collegata.

Una prossima azione non viene creata se il caso e soltanto informativo. In tal
caso il segnale alimenta il Brief o una metrica di dominio.

## 5. Persistenza

I casi diventano record persistenti in PostgreSQL. Il solo store
`notifiche_read` non e adatto perche conserva esclusivamente id letti e non
supporta workflow, assegnazioni o audit.

### 5.1 Tabella `azioni_operative`

Campi minimi:

```text
id
sede_id
canonical_key
target_type
target_id
cliente_id
commessa_id
title
status                 da_valutare | in_carico | rinviata | in_attesa | risolta
priority               critica | alta | normale
priority_score
assignee_user_id
due_at
review_at
snoozed_until
signal_fingerprint
signals JSONB
next_action JSONB
tars_analysis JSONB
tars_analysis_fingerprint
tars_analysis_status   non_richiesta | in_coda | in_corso | completata | errore
created_at
updated_at
resolved_at
```

Vincoli e indici:

- chiave unica `(sede_id, canonical_key)`;
- indice su `(sede_id, status, assignee_user_id, due_at)`;
- indice sui casi che richiedono analisi Tars;
- `signals`, `next_action` e `tars_analysis` contengono riferimenti e fatti
  compatti, mai file, corpi email completi o altri blob.

### 5.2 Tabella `azioni_operative_eventi`

Registro append-only delle transizioni:

```text
id
azione_operativa_id
sede_id
actor_user_id
event_type
from_status
to_status
metadata JSONB
created_at
```

Registra creazione, aggiornamento dei segnali, presa in carico, assegnazione,
rinvio, attesa, riapertura, proposta Tars, approvazione e risoluzione. I
metadati non duplicano payload cliente completi.

## 6. Raccolta e riconciliazione

Il motore e diviso in generatori puri per dominio. Ogni generatore restituisce
segnali senza scrivere dati. Un reconciler li raggruppa e aggiorna i casi.

La riconciliazione avviene:

- dopo le mutation business rilevanti, con debounce per target;
- all'avvio del server;
- tramite recupero periodico ogni minuto, per riparare eventi persi;
- prima delle query del Centro Azioni soltanto come controllo economico, senza
  chiamare OpenAI nel percorso di lettura.

Se il fingerprint non cambia, il record e l'analisi Tars non vengono
riscritti. Se tutti i segnali del caso scompaiono, il caso si chiude
automaticamente con evento `auto_risolta`.

L'anzianita non si basa sul solo `commessa.updatedAt`. Ogni regola usa il fatto
che dovrebbe risolverla: cambio stato, data confermata, saldo, stato ticket,
documento presente o altro campo specifico.

## 7. Priorita e destinatari

### 7.1 Priorita deterministica

Il punteggio combina:

- urgenza temporale e superamento della scadenza;
- impatto economico;
- blocco del processo;
- priorita esplicita di commessa o ticket;
- rischio cliente/post-vendita;
- affidabilita delle evidenze.

Le classi sono:

- `critica`: scaduta, rischio sicurezza/cliente grave, perdita economica
  imminente o decisione bloccante;
- `alta`: richiede azione entro breve e ha impatto operativo concreto;
- `normale`: azionabile ma non urgente; non alimenta il badge finche non entra
  nella propria finestra temporale.

Tars puo motivare e ordinare all'interno della classe, ma non puo ridurre una
priorita critica prodotta da una regola certa.

### 7.2 Routing

L'assegnazione segue questo ordine:

1. responsabile scelto esplicitamente sul caso;
2. assegnatario dell'entita o della commessa;
3. ruolo operativo richiesto dalla prossima azione;
4. direzione soltanto quando nessun responsabile valido e determinabile.

La direzione puo vedere la coda della sede nel Centro Azioni, ma la propria
campanella non riceve automaticamente ogni caso della sede. Lo scope resta
sempre vincolato alla sede attiva; un id di altra sede produce `NOT_FOUND`.

## 8. Ciclo di vita

- `da_valutare`: richiede una decisione o presa in carico;
- `in_carico`: un responsabile ha dichiarato che lo sta gestendo;
- `rinviata`: sospesa fino a una data precisa;
- `in_attesa`: dipende da cliente, fornitore o altro evento esterno e possiede
  una data di revisione;
- `risolta`: condizione chiusa manualmente o automaticamente.

Azioni disponibili:

- **Prendi in carico** assegna il caso all'utente corrente;
- **Assegna** richiede un utente attivo della sede;
- **Rinvia** richiede una data e, oltre i preset brevi, una motivazione;
- **In attesa** richiede motivo, controparte e data di revisione;
- **Non rilevante** chiude il caso e registra feedback sulla regola;
- **Risolvi** e disponibile soltanto quando la chiusura non e gia deducibile
  dai dati.

Un caso rinviato torna attivo alla scadenza o immediatamente se il fingerprint
cambia in modo rilevante. Due rinvii consecutivi senza avanzamento aumentano
la visibilita del caso e vengono segnalati nel Brief.

## 9. Tars

### 9.1 Quando viene chiamato

Tars analizza in batch soltanto:

- casi nuovi di priorita critica o alta;
- casi il cui fingerprint e cambiato materialmente;
- casi tornati attivi dopo rinvio o attesa;
- casi richiesti esplicitamente dall'operatore;
- un numero limitato di casi normali selezionati per il Brief giornaliero.

La campanella, il conteggio e l'apertura della pagina non chiamano OpenAI.
L'analisi usa `prompt_cache_key` per sede, profilo e modello, preload compatto
e cache strumenti per run. Il fascicolo completo viene letto solo quando i
fatti iniziali non bastano.

### 9.2 Contesto e risposta

Il profilo `centro_azioni` puo leggere, nel rispetto dei permessi, clienti,
commesse, comunicazioni, fatture, pagamenti, documenti, calendario,
produzione, ticket, post-vendita e decisioni Tars precedenti.

L'output strutturato contiene:

- sintesi del problema;
- motivo per cui conta adesso;
- evidenze con deep link;
- prossima azione raccomandata;
- massimo due alternative utili;
- responsabile e scadenza suggeriti;
- livello di confidenza;
- eventuale domanda di chiarimento.

Tars deve preferire una domanda a una proposta debole. Non puo chiudere un
caso critico con una risposta vuota o `nessuna_azione` non motivata.

### 9.3 Proposte e deduplica

Le azioni che modificano il CRM riusano `azioni_suggerite` e l'esecutore
esistente. Il caso conserva gli id delle proposte collegate. La chiave d'azione
canonica impedisce di proporre due volte lo stesso effetto.

Una proposta rifiutata non viene ricreata cambiando testo. Puo tornare soltanto
se cambiano fatti rilevanti e la nuova motivazione indica esplicitamente cosa
e cambiato.

### 9.4 Fallback

Se Tars e disattivato, il budget e esaurito o OpenAI non risponde:

- il caso resta visibile;
- priorita, responsabile e scadenza deterministici restano disponibili;
- la UI segnala che l'approfondimento AI non e aggiornato;
- la coda riprova senza bloccare le letture o duplicare il caso.

## 10. Interfaccia

### 10.1 Campanella

La campanella e un'anteprima, non l'archivio completo.

- badge = casi personali `critica` o `alta` che richiedono attenzione adesso;
- visualizzazione `9+` oltre nove;
- rosso soltanto quando esiste almeno un caso critico o scaduto;
- massimo tre casi nel pannello;
- ogni caso mostra titolo, target, responsabile, scadenza e azione principale;
- collegamento finale **Apri Centro Azioni**;
- nessun comando **Segna tutte lette**.

Il badge non include casi `in_carico`, `rinviata`, `in_attesa`, normali fuori
finestra o informazioni del Brief.

### 10.2 Tars - Oggi

La vista Oggi del Command Center diventa il Centro Azioni. L'intestazione
mostra quattro numeri compatti:

- da affrontare adesso;
- in attesa;
- risolte oggi;
- nuovi segnali nel Brief.

La lista e ordinata per prossima azione e offre filtri `Mie`, `Sede`,
`Scadute`, `In attesa`. La vista predefinita e `Mie`; `Sede` e disponibile
soltanto ai ruoli autorizzati.

Ogni riga mostra priorita, titolo, cliente/commessa, consiglio sintetico,
responsabile e scadenza. L'apertura usa un pannello laterale con analisi Tars,
evidenze, cronologia e azioni `Approva`, `Modifica`, `Assegna`, `Rinvia`,
`In attesa` e `Non rilevante`.

Gli elementi risolti rimangono nel Registro. Il Brief raccoglie informazioni,
trend e anomalie che non richiedono una decisione immediata.

### 10.3 Responsive e accessibilita

Su mobile la lista resta a colonna singola e il dettaglio occupa lo schermo.
Non vengono introdotte tabelle o scroll orizzontale. Icone note per azioni
brevi, tooltip sui comandi non familiari, target touch comodi, focus visibile e
`prefers-reduced-motion` rispettato.

## 11. API

Il router `notifiche` evolve mantenendo temporaneamente gli endpoint legacy
durante il confronto. Il nuovo contratto espone almeno:

- `summary`: conteggi della campanella e del Centro Azioni;
- `list`: filtri, cursore e ordinamento dei casi;
- `detail`: caso, segnali, analisi, evidenze ed eventi;
- `take`: presa in carico;
- `assign`: assegnazione sede-scoped;
- `snooze`: rinvio;
- `waitFor`: attesa con revisione;
- `resolve`: chiusura manuale consentita;
- `dismiss`: non rilevante con motivazione;
- `requestTarsAnalysis`: analisi esplicita con rate limit;
- `brief`: riepilogo informativo senza gonfiare il badge.

Le mutation verificano che il caso sia ancora nello stato e fingerprint attesi
per evitare decisioni su dati diventati obsoleti.

## 12. Migrazione e rilascio

### Fase 1 - Motore in ombra

- creare tabelle e generatori;
- riconciliare i dati reali senza cambiare campanella;
- confrontare per tipo, destinatario, priorita e duplicati;
- correggere falsi negativi prima dell'attivazione.

### Fase 2 - Centro Azioni

- attivare la nuova vista Tars per direzione e un gruppo pilota;
- mantenere il vecchio dropdown disponibile come rollback tecnico;
- verificare auto-risoluzione, routing e analisi Tars in produzione.

### Fase 3 - Nuova campanella

- sostituire il badge e il pannello;
- non migrare `readIds`: i casi vengono rigenerati dai fatti ancora validi;
- conservare lo store legacy senza scritture per una finestra di rollback;
- rimuoverlo soltanto dopo almeno 30 giorni senza regressioni.

L'attivazione non cancella commesse, ticket, garanzie, comunicazioni o proposte
Tars. Il rollback cambia il lettore, non i dati business.

## 13. Osservabilita

Metriche minime per sede e senza contenuti cliente nei log:

- casi aperti per stato e priorita;
- segnali raggruppati e duplicati evitati;
- tempo alla prima presa in carico;
- tempo alla risoluzione;
- casi scaduti;
- rinvii ripetuti;
- auto-risoluzioni;
- casi marcati non rilevanti;
- analisi Tars riuscite/fallite;
- proposte approvate, modificate e rifiutate;
- token, cache e costo del profilo `centro_azioni`.

Il Command Center deve distinguere chiaramente problemi del motore, coda Tars
in ritardo e indisponibilita del provider.

## 14. Sicurezza e permessi

- ogni query, evento, caso e proposta porta `sedeId`;
- gli utenti vedono i casi assegnati o consentiti dai propri ruoli;
- la vista di sede richiede il ruolo previsto;
- i deep link riapplicano i permessi dell'entita sorgente;
- Tars non riceve dati economici o direzionali quando il ruolo non li consente;
- log ed eventi non contengono token, password, corpi completi o allegati;
- le mutation Tars continuano a passare dall'approvazione e dalle permission
  applicative esistenti.

## 15. Test

### Motore

- una situazione con piu segnali produce un solo caso;
- un fingerprint invariato non crea record o analisi nuove;
- un cambio rilevante aggiorna e, quando necessario, riapre il caso;
- la scomparsa dei segnali risolve automaticamente;
- la semplice modifica di `updatedAt` non risolve un blocco;
- rinvio e attesa tornano attivi alla data corretta;
- priorita critiche non possono essere soppresse dall'AI;
- casi e assegnatari di un'altra sede restituiscono `NOT_FOUND`.

### Tars

- analisi soltanto su fingerprint nuovi o richiesta esplicita;
- batch, cache e preload rispettano i limiti configurati;
- fallback completo senza OpenAI;
- proposta duplicata o gia decisa non viene ricreata;
- evidenze e suggerimenti rispettano ruolo e sede.

### UI

- badge coerente con i soli casi personali azionabili;
- anteprima limitata a tre e conteggio `9+`;
- transizioni ottimistiche con rollback su errore;
- navigazione da evidenza al record corretto;
- desktop `1440x900` e mobile `390x844` senza sovrapposizioni o scroll
  orizzontale;
- tastiera, focus, nomi accessibili e reduced motion verificati;
- nessun errore console nei flussi principali.

## 16. Criteri di accettazione

Il rilascio e accettabile quando:

1. nessun caso critico del motore legacy viene perso nel confronto;
2. le duplicazioni osservate sulla stessa situazione sono eliminate;
3. la campanella tipica mostra da 3 a 10 casi attuali, senza un cap che nasconda
   criticita reali;
4. ogni elemento visibile ha responsabile, scadenza/revisione e prossima
   azione;
5. presa in carico, rinvio, attesa e auto-risoluzione funzionano end-to-end;
6. Tars propone azioni fondate su evidenze incrociate e non le duplica;
7. il Centro Azioni resta operativo con Tars disabilitato o provider in errore;
8. il badge e il brief non si contraddicono;
9. `pnpm check`, `pnpm test` e `pnpm build` passano;
10. PRD e handoff descrivono il nuovo contratto e il runbook di rollback.

## 17. Fuori ambito iniziale

- notifiche push native, email o SMS;
- esecuzione autonoma di mutation da parte di Tars;
- preferenze estremamente granulari per singola regola;
- machine learning addestrato sui dati aziendali;
- sostituzione delle code operative di Email, WhatsApp, Ticket o Pagamenti.

Queste estensioni possono essere valutate dopo aver misurato almeno 30 giorni
di utilizzo del Centro Azioni.
