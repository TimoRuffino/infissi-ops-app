# Ruffino Flow SaaS multi-azienda — modello commerciale e architettura

**Data:** 6 settembre 2026

**Stato:** design approvato in conversazione; nessuna implementazione autorizzata

**Perimetro:** distribuzione di Ruffino Flow a più rivenditori di infissi

> Registrato nel repository il 06/09/2026 sul branch
> `claude/ruffino-flow-saas-multi-afaecf` (solo documentazione, nessun
> codice). Le sezioni 1–18 sono il testo approvato dalla direzione, riportato
> senza modifiche. L'Appendice A, aggiunta dall'agente lo stesso giorno,
> confronta le assunzioni del design con il codice del checkout: serve a chi
> scriverà la spec tecnica del primo workstream (§17), non cambia le
> decisioni. Riferimenti: PRD §60, `handoff.md` voce 21 del debito aperto.

## 1. Sintesi

Ruffino Flow diventa un SaaS multi-azienda con un solo prodotto completo. Ogni
cliente acquista un canone fisso per azienda, mensile o annuale, e riceve le
stesse funzionalità. Non esistono piani Base, Pro, Avanzato o Enterprise.

Il confine principale diventa l'**azienda** (`tenant`), sopra le sedi. Utenti,
sedi, dati, file, integrazioni, consumi e processi appartengono sempre a una
sola azienda. La sede resta il confine operativo interno all'azienda.

Email, WhatsApp e Tars sono inclusi per tutti. Utenti, sedi, caselle email e
numeri WhatsApp non hanno quote commerciali rigide; storage e consumo Tars
sono invece misurati, comunicati e ampliabili.

Il prodotto conserva il marchio Ruffino Flow. Ciascun rivenditore può
personalizzare logo, dati societari, documenti e firme destinati ai propri
clienti. Non è previsto il white-label completo nella prima versione.

## 2. Obiettivi e non-obiettivi

### 2.1 Obiettivi

- distribuire una sola installazione a più aziende indipendenti;
- impedire qualsiasi lettura o modifica tra aziende;
- conservare sedi, ruoli e flussi operativi già esistenti;
- offrire tutte le funzionalità con entrambe le periodicità di pagamento;
- gestire automaticamente attivazioni, rinnovi e insoluti;
- consentire abbonamenti omaggio a imprese selezionate;
- misurare storage e Tars senza bloccare improvvisamente il lavoro ordinario;
- migrare Ruffino Group senza perdita di dati e con possibilità di rollback;
- introdurre i cambiamenti per fasi, iniziando da un'azienda pilota.

### 2.2 Non-obiettivi

- piani funzionali differenti o moduli acquistabili separatamente;
- tariffazione per utente, sede, casella email o numero WhatsApp;
- ruoli personalizzati nella prima versione;
- dominio, nome e interfaccia white-label per ogni cliente;
- riscrittura immediata di tutti gli archivi JSONB in tabelle relazionali;
- determinazione del prezzo di listino nel codice o in questa specifica;
- modifica del comportamento deterministico e governato di Tars.

Il prezzo mensile, il prezzo annuale e il valore commerciale dei pacchetti
extra sono configurazioni della piattaforma di pagamento. Devono essere
definiti prima dell'apertura commerciale, ma non cambiano il contratto
funzionale descritto qui.

## 3. Modello commerciale

### 3.1 Un solo prodotto

Il catalogo contiene un solo prodotto, con due periodicità:

- **mensile**, pagato e rinnovato ogni mese;
- **annuale**, pagato anticipatamente e scontato rispetto a dodici mensilità.

Le due periodicità offrono gli stessi accessi, funzionalità e limiti d'uso.
Il cambio di periodicità decorre dal rinnovo successivo, senza conguagli nella
prima versione.

### 3.2 Canone fisso per azienda

Il canone non dipende dal numero di utenti o sedi. Il cliente tipico atteso ha
6–10 utenti, ma questo dato serve al dimensionamento e non costituisce una
quota contrattuale.

Sono soggetti a fair use, senza un limite commerciale rigido:

- utenti attivi;
- sedi;
- caselle email collegate;
- numeri WhatsApp collegati.

Restano possibili limiti tecnici di sicurezza contro abuso, loop o traffico
anomalo. Questi limiti non devono trasformarsi in piani funzionali nascosti.

### 3.3 Costi esterni

L'inclusione di Email, WhatsApp, Fatture in Cloud, Drive e calendari significa
che Ruffino Flow abilita e gestisce le integrazioni. Eventuali canoni o costi
del fornitore esterno — per esempio account Meta, casella email o Fatture in
Cloud — restano a carico dell'azienda cliente.

## 4. Soglie d'uso

### 4.1 Storage

Ogni azienda dispone inizialmente di **100 GB** di storage cumulativo. Sono
conteggiati i file effettivamente conservati per il tenant, non i metadati
duplicati o i file già eliminati.

Il proprietario e la direzione ricevono avvisi al 50%, 80% e 100%. Al
raggiungimento del limite:

- dati, documenti esistenti e download restano accessibili;
- il CRM ordinario continua a funzionare;
- i nuovi caricamenti costosi possono essere sospesi dopo il periodo di
  tolleranza comunicato nell'interfaccia;
- l'azienda può acquistare capacità aggiuntiva ricorrente.

La dimensione dei blocchi aggiuntivi e il loro prezzo sono configurazioni
commerciali. Non devono richiedere un rilascio software.

### 4.2 Tars

Tars dispone di un budget mensile per azienda, rinnovato ogni mese anche per
chi paga annualmente. Il consumo interno è calcolato sul costo reale del
provider, ma l'utente vede soltanto una percentuale comprensibile e non token,
modelli o costi tecnici.

Gli avvisi scattano al 50%, 80% e 100%. Al termine della tolleranza, possono
essere sospese solo le nuove operazioni Tars che generano costo esterno; il
CRM, i dati e le funzioni deterministiche restano disponibili. Un pacchetto
extra aumenta il budget fino alla fine del periodo mensile corrente.

L'importo assoluto del budget incluso viene fissato prima del lancio in base
al prezzo mensile equivalente e ai costi misurati durante il pilota. È una
configurazione amministrativa, non un valore codificato. Il go-live
commerciale è vietato finché prezzo, budget incluso, periodi di tolleranza per
storage e Tars e prezzo dei pacchetti extra non sono configurati e verificati
insieme.

## 5. Gerarchia e isolamento

```text
Piattaforma
└── Azienda / Tenant
    ├── Abbonamento e consumi
    ├── Utenti e ruoli
    ├── Sedi
    ├── Dati operativi
    ├── File e backup
    └── Integrazioni
```

### 5.1 Regole di appartenenza

- un utente operativo appartiene a una sola azienda nella prima versione;
- una sede appartiene a una sola azienda;
- ogni record business, configurazione, file, evento, audit e consumo porta
  `tenantId`;
- le entità operative continuano a portare anche `sedeId`;
- il Platform Admin è un'identità globale separata e non appartiene ai dati
  operativi di un tenant;
- `tenantId` deriva sempre dalla sessione autenticata e non è un input libero
  del client;
- il selettore della sede può scegliere soltanto sedi comprese nel tenant
  autenticato;
- un riferimento a un record di un'altra azienda restituisce `NOT_FOUND`, mai
  informazioni che consentano di confermarne l'esistenza.

### 5.2 Direzione e sedi

La direzione vede tutte le sedi della propria azienda, non tutte le sedi della
piattaforma. Gli altri ruoli vedono le sedi assegnate e, quando previsto dal
dominio, soltanto le commesse o attività di propria competenza.

## 6. Ruoli e permessi

Un utente può avere da uno a tre ruoli. Le capacità effettive sono l'unione
dei ruoli, con enforcement server-side. Non sono previsti ruoli personalizzati
nella prima versione.

### 6.1 Ruoli aziendali

- **Proprietario azienda:** abbonamento, pagamenti, esportazione, nomina degli
  amministratori e richiesta di chiusura dell'account.
- **Direzione:** tutte le sedi e i dati del tenant, utenti, configurazioni,
  integrazioni e dati economici.
- **Amministrazione:** pagamenti, fatture, contratti, contabilità e Fatture in
  Cloud.
- **Commerciale:** clienti, preventivi, commesse, contratti e comunicazioni,
  senza margini e costi riservati.
- **Tecnico rilievi:** appuntamenti, misure, documenti e commesse assegnate.
- **Ordini:** fornitori, ordini, conferme, arrivi e magazzino.
- **Squadra posa:** planning, cantieri assegnati, rapportini, foto e anomalie.
- **Post-vendita:** clienti, ticket, reclami, rifacimenti, garanzie e
  comunicazioni.

Ogni tenant deve avere sempre almeno un Proprietario e un utente Direzione
attivi. La rimozione o disattivazione dell'ultimo utente con uno dei due
presìdi deve essere rifiutata.

### 6.2 Platform Admin

Il Platform Admin gestisce aziende, abbonamenti, omaggi, consumi e salute del
servizio. Non può consultare normalmente clienti, commesse, messaggi o
documenti delle aziende. Un accesso di supporto richiede autorizzazione,
motivazione, scadenza e audit.

### 6.3 Tars e comunicazioni

Email, WhatsApp e Tars sono disponibili a tutti i ruoli che possiedono le
relative capacità operative. La configurazione delle integrazioni è riservata
alla direzione. Tars agisce sempre con i permessi dell'utente corrente e non
può aggirare capability, tenant, sede, servizi di dominio, state machine,
governor o conferme previste dalla policy.

## 7. Funzionalità incluse

Tutte le aziende, paganti o omaggio, ricevono lo stesso insieme funzionale:

- CRM clienti, storico e assegnazioni;
- preventivi, contratti e attività commerciali;
- fascicolo commessa, documenti, timeline e stati;
- rilievi, planning, squadre, posa e verbali;
- ordini, fornitori, conferme, arrivi e magazzino;
- pagamenti, costi, margini e analisi economica;
- fatturazione e integrazione Fatture in Cloud;
- ticket, reclami, rifacimenti e garanzie;
- email, WhatsApp, chat interna e notifiche;
- archivio documentale, OCR, lettura visiva e backup;
- Tars, memoria, proposte, promemoria, smistamento e analisi aziendale nei
  limiti delle policy esistenti;
- Drive, calendari, email, Meta e altre integrazioni supportate;
- utenti, ruoli, sedi, configurazione, audit e monitoraggio consumi.

La direzione può nascondere dal menu le aree che l'azienda non usa. Questo è
un adattamento dell'interfaccia e non modifica l'abbonamento. I feature flag
tecnici restano controllati dalla piattaforma e non diventano piani
commerciali.

## 8. Marchio e personalizzazione

Ruffino Flow conserva nome, dominio, pagina di accesso e design system unici.
Ogni tenant può configurare:

- logo e colore identificativo;
- ragione sociale, contatti e dati fiscali;
- intestazioni di preventivi, contratti e altri documenti;
- firme email e WhatsApp;
- dati delle singole sedi.

Il marchio del rivenditore prevale nei materiali inviati ai suoi clienti. Il
marchio Ruffino Flow rimane nell'applicazione. Nella prima versione non sono
previsti dominio personalizzato, nome prodotto diverso o rimozione completa
del marchio della piattaforma.

## 9. Onboarding

Il percorso guidato comprende:

1. scelta tra pagamento mensile e annuale;
2. inserimento dei dati societari;
3. checkout presso il provider di pagamento;
4. creazione del tenant dopo la conferma effettiva del pagamento;
5. creazione del primo Proprietario;
6. configurazione della prima sede;
7. invito degli utenti e assegnazione dei ruoli;
8. collegamento facoltativo di Email, WhatsApp, Fatture in Cloud e Drive;
9. eventuale importazione iniziale di clienti e commesse.

Per un tenant omaggio creato dal Platform Admin, i primi tre passaggi sono
sostituiti dalla concessione amministrativa dell'omaggio; non viene aperto un
checkout né creato alcun oggetto presso il provider di pagamento.

Lo stato dell'onboarding viene salvato progressivamente. Un errore di una
singola integrazione non annulla il tenant: il passaggio resta da completare e
può essere ritentato. Il CRM può essere utilizzato prima di aver collegato
tutte le integrazioni.

Il Platform Admin può creare un tenant assistito, assegnare un omaggio e
reinviare l'invito al Proprietario senza impersonare l'utente.

## 10. Abbonamenti e pagamenti

### 10.1 Dati normalizzati

L'abbonamento conserva almeno:

- tipo commerciale `paid` o `complimentary`;
- periodicità `monthly` o `yearly` per `paid`, assente per `complimentary`;
- stato `active`, `past_due`, `grace`, `suspended` o `cancelled`;
- inizio e fine del periodo corrente;
- prossima data di rinnovo;
- eventuale cancellazione a fine periodo;
- soglia storage inclusa;
- budget Tars incluso e pacchetti extra;
- riferimenti opachi del provider di pagamento.

La piattaforma usa un adattatore per non legare il dominio a un singolo
provider. Il primo provider può essere Stripe o un servizio equivalente.

### 10.2 Checkout e webhook

- il checkout è ospitato dal provider;
- il CRM non conserva i dati completi della carta;
- la pagina di ritorno dal checkout non prova il pagamento;
- soltanto un evento verificato del provider attiva o rinnova l'abbonamento;
- i webhook sono firmati, idempotenti e tollerano duplicati o arrivo fuori
  ordine;
- il Proprietario dispone di un portale self-service per metodo di pagamento,
  dati di fatturazione, documenti e disdetta.

### 10.3 Insoluti e disdetta

Al primo mancato pagamento lo stato passa a `past_due`. Il provider effettua i
tentativi previsti e Proprietario e Direzione ricevono gli avvisi. Dopo sette
giorni di tolleranza, l'azienda passa a `suspended`:

- accesso in sola lettura;
- nessuna nuova scrittura o elaborazione costosa;
- export dei dati ancora disponibile al Proprietario;
- ripristino automatico dell'accesso completo dopo un pagamento verificato.

La disdetta impedisce il rinnovo e lascia il servizio attivo fino alla fine
del periodo pagato. Nella prima versione nessun dato viene cancellato
automaticamente alla scadenza: l'eliminazione richiede una richiesta esplicita
del Proprietario, verifica amministrativa e rispetto degli obblighi legali di
conservazione.

### 10.4 Fatturazione del SaaS

Il pagamento del canone è distinto dalle fatture che il rivenditore emette ai
propri clienti. L'addebito è gestito dal provider; l'eventuale fattura
elettronica italiana del canone viene prodotta dal sistema contabile della
società proprietaria di Ruffino Flow, separato dalle integrazioni Fatture in
Cloud dei tenant.

## 11. Abbonamenti omaggio

Il Platform Admin può impostare il tipo commerciale `complimentary` senza
creare una sottoscrizione o uno sconto del 100% presso il provider.

L'omaggio:

- concede tutte le funzioni e le soglie ordinarie;
- può essere senza scadenza o avere una data di termine;
- mostra al Proprietario la dicitura “Abbonamento omaggio” e l'eventuale
  scadenza;
- registra motivazione, autore, data e successive modifiche;
- può essere convertito in abbonamento pagante senza perdere dati o
  configurazioni.

Prima della scadenza vengono inviati avvisi. La revoca o scadenza segue un
passaggio controllato verso il pagamento o la modalità in sola lettura, senza
addebiti involontari.

## 12. Architettura tecnica

### 12.1 Control plane relazionale

Le informazioni trasversali e sensibili alla concorrenza vivono in tabelle
PostgreSQL dedicate:

- tenant e identità aziendale;
- appartenenza degli utenti e inviti;
- abbonamenti ed eventi di pagamento elaborati;
- contatori e ledger di utilizzo;
- concessioni omaggio;
- audit amministrativo e accessi di supporto.

Il control plane non contiene i fascicoli business dei tenant e non offre al
Platform Admin un percorso implicito verso di essi.

### 12.2 Contesto della richiesta

Ogni richiesta autenticata risolve sul server:

- utente;
- `tenantId`;
- `sedeId` attiva;
- insieme delle sedi accessibili;
- ruoli e capability;
- stato operativo dell'abbonamento.

Cookie, parametri e payload del client possono proporre una sede, ma non
possono determinare o ampliare il tenant. Le procedure di scrittura applicano
prima tenant e stato dell'abbonamento, poi sede, capability e regole di
dominio.

### 12.3 Dati business JSONB

Per ridurre il rischio, la prima migrazione non converte ogni archivio in una
tabella relazionale. `persistedStore` viene reso tenant-aware e usa chiavi
separate, per esempio:

```text
tenant:1:clienti
tenant:1:commesse
tenant:2:clienti
tenant:2:commesse
```

Ogni record mantiene comunque `tenantId` e `sedeId`. L'accesso agli array
passa da repository o helper tenant-scoped, evitando filtri copiati a mano in
ogni handler. Le tabelle PostgreSQL già dedicate, come Comunicazioni, eventi,
notifiche e chat, ricevono `tenant_id` oltre a `sede_id` e indici coerenti con
le query.

### 12.4 File e backup

- ogni nuova chiave storage inizia con il prefisso del tenant;
- il record conserva checksum e `storageKey` secondo il contratto corrente;
- le letture mantengono il fallback `dataBase64` per i record legacy;
- il backup produce un insieme isolato e ripristinabile per tenant;
- il backup legge sempre i byte dallo storage quando esiste `storageKey`;
- quote e utilizzo conteggiano esclusivamente i byte del tenant;
- un Platform Admin vede stato, esito e dimensioni aggregate, non il contenuto
  dei file.

### 12.5 Integrazioni e processi in background

Credenziali, callback, configurazioni e cursori di sincronizzazione sono
tenant-scoped; quando necessario restano anche sede-scoped. OAuth `state`
lega in modo non modificabile tenant, sede e utente che ha iniziato il flusso.

Ogni job riceve `tenantId` esplicito. Retry, lease, deduplica e dead-letter
sono indipendenti per tenant, così il guasto di una casella, integrazione o
azienda non ferma le altre.

Tars mantiene l'architettura corrente: strumenti tipizzati, servizi di
dominio, catalogo fail-closed, policy server-side e provider dietro governor.
Il tenant diventa un ulteriore vincolo obbligatorio, non una nuova fonte di
autorità per il modello.

## 13. Gestione degli errori

- Record inesistente o appartenente ad altro tenant: `NOT_FOUND` generico.
- Tenant sospeso: letture ed export consentiti, scritture rifiutate con stato
  dell'abbonamento comprensibile.
- Webhook duplicato: risposta idempotente senza secondo effetto.
- Webhook non verificabile: rifiuto e audit privacy-safe.
- Integrazione onboarding fallita: tenant conservato, passaggio ritentabile.
- Job di un tenant fallito: retry limitato e dead-letter del solo tenant.
- Quota storage raggiunta: file esistenti leggibili; nuovi upload costosi
  sospendibili dopo avvisi e tolleranza.
- Budget Tars raggiunto: sole operazioni Tars a costo esterno sospendibili;
  nessun blocco del CRM.
- Migrazione incoerente: nessun cutover, dati legacy intatti e rapporto degli
  scostamenti.

## 14. Migrazione di Ruffino Group

La migrazione è idempotente, verificabile e distinta dal rilascio ordinario.
Non deve essere eseguita nell'ambito di questa specifica.

### 14.1 Preparazione

1. ottenere un backup Drive riuscito e verificato nelle 24 ore precedenti;
2. produrre inventario di store, tabelle, sedi, utenti, file, configurazioni e
   processi;
3. generare il tenant 1 “Ruffino Group”;
4. eseguire un dry-run senza scritture;
5. verificare che ogni record sia associabile a una sede esistente.

### 14.2 Backfill e copia

1. associare utenti e sedi esistenti al tenant 1;
2. aggiungere `tenantId = 1` a record, configurazioni e righe relazionali;
3. copiare ogni store legacy nella chiave `tenant:1:<store>`;
4. mantenere le chiavi legacy in sola lettura;
5. conservare i vecchi `storageKey` leggibili e applicare il prefisso tenant
   ai nuovi file;
6. migrare fisicamente i file legacy soltanto con procedura separata,
   checksum e fallback.

### 14.3 Verifica e cutover

- confrontare conteggi e checksum prima e dopo la copia;
- controllare riferimenti tra clienti, commesse, documenti, comunicazioni e
  utenti;
- rifiutare record orfani o duplicati dal rapporto, senza eliminarli;
- eseguire test negativi cross-tenant;
- attivare il nuovo contesto soltanto dopo tutte le verifiche;
- mantenere una finestra di rollback sulle chiavi legacy;
- non cancellare i dati legacy insieme al cutover.

## 15. Sicurezza e privacy

- autenticazione obbligatoria su ogni endpoint business;
- `tenantId` derivato dalla sessione e verificato a ogni confine;
- `NOT_FOUND` per evitare enumerazione cross-tenant;
- segreti delle integrazioni cifrati e mai presenti nei log;
- nessun token, password, corpo completo di messaggi o payload cliente nelle
  metriche;
- autenticazione a più fattori obbligatoria per Platform Admin;
- accesso di supporto esplicito, temporaneo, motivato e auditato;
- rate limiting per login, webhook, upload e operazioni costose;
- audit append-only per pagamenti, omaggi, ruoli, supporto ed export;
- esportazione aziendale autorizzata soltanto al Proprietario;
- contenuti di email, WhatsApp, file e documenti trattati sempre come dati non
  fidati, mai come istruzioni.

## 16. Verifica e criteri di accettazione

### 16.1 Isolamento

- ogni router business possiede test positivi nel tenant e negativi fuori
  tenant;
- ID uguali in tenant diversi non producono collisioni o fughe di dati;
- la direzione vede tutte e sole le sedi della propria azienda;
- file, backup, metriche, comunicazioni e job rispettano lo stesso confine;
- Tars non può leggere né proporre azioni su un tenant diverso.

### 16.2 Ruoli

- la matrice ruolo-capability è verificata server-side;
- un utente multi-ruolo riceve l'unione attesa e niente altro;
- l'ultimo Proprietario o Direzione non può essere rimosso;
- il Platform Admin non ottiene accesso ordinario ai dati business;
- l'accesso di supporto scade ed è ricostruibile dall'audit.

### 16.3 Abbonamenti e consumi

- mensile e annuale espongono le stesse funzioni;
- attivazione e rinnovo dipendono da eventi verificati;
- eventi duplicati o fuori ordine non duplicano effetti;
- `past_due`, tolleranza, sospensione e ripristino sono coperti;
- l'omaggio non crea addebiti ed è convertibile senza perdita di dati;
- gli avvisi scattano alle soglie previste;
- superare storage o Tars non rende indisponibili i dati esistenti.

### 16.4 Onboarding e integrazioni

- il percorso può essere interrotto e ripreso;
- il fallimento di un'integrazione non elimina il tenant;
- credenziali e callback non possono essere associate a un altro tenant;
- gli inviti sono monouso, scadono e rispettano il tenant destinatario;
- marchio e dati del rivenditore compaiono nei documenti e nelle firme, mentre
  l'app conserva il marchio Ruffino Flow.

### 16.5 Migrazione e qualità

- dry-run, conteggi, checksum e rapporto orfani sono verificati;
- il rollback non richiede la ricostruzione dei dati originali;
- viene provato il ripristino di un backup per tenant;
- `pnpm check`, `pnpm test` e `pnpm build` passano prima di ogni rilascio;
- le modifiche visuali future sono verificate almeno a 1440×900 e 390×844,
  senza scroll orizzontale globale né errori console;
- una prova locale senza `DATABASE_URL` non vale come verifica dei dati o
  delle query Railway.

## 17. Strategia di rilascio

L'architettura è troppo ampia per un'unica modifica. L'implementazione futura
deve essere scomposta in workstream ordinati, ciascuno con specifica tecnica,
piano, test e checkpoint autonomi:

1. **Fondazione tenant:** control plane, contesto, permessi e isolamento.
2. **Migrazione Ruffino Group:** backfill, store tenant-aware e rollback.
3. **File, comunicazioni e integrazioni:** prefissi, credenziali e job.
4. **Abbonamenti e consumi:** provider, webhook, stati, omaggi e quote.
5. **Onboarding e personalizzazione:** attivazione, inviti e marchio aziendale.
6. **Pannello Platform Admin:** tenant, servizio, supporto e audit.
7. **Pilota:** prima azienda selezionata con abbonamento omaggio.
8. **Rollout controllato:** piccolo gruppo di rivenditori, poi apertura
   commerciale.

Ogni fase deve poter essere disattivata o riportata allo stato precedente
senza perdere dati. Il self-service pubblico non viene aperto prima della
chiusura del pilota e della verifica delle soglie economiche Tars.

## 18. Decisioni consolidate

- un solo prodotto completo;
- canone fisso per azienda;
- pagamento mensile o annuale;
- nessuna tariffazione per utenti o sedi;
- Email, WhatsApp e Tars inclusi per tutti;
- storage e Tars come uniche risorse commercialmente misurate;
- 100 GB di storage incluso;
- avvisi d'uso al 50%, 80% e 100%;
- pacchetti extra acquistabili;
- ruolo Platform Admin separato;
- abbonamenti omaggio con scadenza facoltativa;
- marchio Ruffino Flow unico con personalizzazione del rivenditore;
- tenant sopra sede;
- Ruffino Group come tenant 1;
- migrazione progressiva con backup, dry-run e rollback;
- nessuna implementazione autorizzata da questa specifica.

---

## Appendice A — Riscontro sul codice al 06/09/2026

> Aggiunta dall'agente il 06/09/2026 sul checkout `ecb2042` (punta di `main`
> mergiata nel branch). Non fa parte del design approvato e non lo modifica:
> dice, sezione per sezione, che cosa il codice fa già, che cosa fa in forma
> diversa e che cosa non esiste, con file e riga, perché la spec tecnica del
> workstream 1 parta dai fatti. Quattro ricognizioni in sola lettura
> (identità e contesto; persistenza e schema; storage, integrazioni e job;
> Tars e costi). Legenda: **regge** = il codice già lo garantisce;
> **diverso** = esiste, ma in altra forma o con un buco; **manca** = va
> costruito.

### A.1 Ciò che regge (basi da riusare, non da rifare)

- **Contesto server-side (§12.2).** `server/_core/context.ts:9-18` risolve
  `{ user, sedeId, sediIds }` a ogni richiesta; il cookie `active_sede` vale
  solo se la sede è nell'insieme ammesso (`context.ts:42-61`), `sedi.switch`
  rivalida (`server/routers/sedi.ts:155-172`), `allowedSediForUser` dà alla
  direzione tutte le sedi attive e agli altri i loro `sediIds`
  (`sedi.ts:70-88`). Il client non imposta `sedeId` in nessuna mutation: le
  sole due occorrenze in uno schema di input sono `sedi.switch`
  (`sedi.ts:157`) e un cursore opaco di paginazione ricontrollato contro il
  contesto (`server/tars/strumenti/allegati.ts:52,143`); `ctx.sedeId` compare
  308 volte nel codice non di test.
- **`NOT_FOUND` fuori scope (§5.1, §13).** `assertSedeScope`
  (`server/_core/permissions.ts:62-73`) lancia `NOT_FOUND`, mai `FORBIDDEN`,
  in 91 punti; il motore di policy fa lo stesso (`server/authz/policy.ts:122-127`,
  `notFound("sede_mismatch")`). Test negativi già scritti:
  `server/routers/crossSede.test.ts`, `commesse.test.ts:532`,
  `contratti.test.ts:91-95`, `computo.test.ts:63-68`, `fatture.test.ts:339,352`,
  `authzEconomia.test.ts:320` e altri. Il tenant si aggiunge a questo schema,
  non lo sostituisce.
- **Ruoli a unione (§6).** Sette ruoli (`server/routers/utenti.ts:10-18`,
  specchio `client/src/lib/roles.ts:8-15`): `direzione`, `amministrazione`,
  `commerciale`, `tecnico_rilievi`, `squadra_posa`, `post_vendita`, `ordini`,
  gli stessi della spec. `ruoli: string[]` da 1 a 3 (`utenti.ts:21-23`);
  capability = unione dei ruoli (`server/authz/capabilities.ts:153-163`);
  override e deleghe individuali in tabelle per sede
  (`server/authz/repository.ts:316-370`).
- **Tars governato (§6.3, §12.5).** `ContestoRun`
  (`server/tars/strumenti/tipi.ts:42-99`) nasce solo dal ctx tRPC
  (`server/tars/contesto.ts:19-48`); il catalogo rifiuta ogni azione senza
  `sedeId` positivo prima ancora di guardare le capability
  (`server/tars/azioni/policy.ts:11-22`); ogni strumento ricontrolla la sede
  e chiama il dominio con un ctx inchiodato a una sede
  (`server/tars/strumenti/comune.ts:13-27`); nessuno `schemaInput` di
  strumento contiene `sedeId`. Il provider reale esiste solo dietro il
  governor (`server/tars/costi/providerGovernato.ts:80-101`, unico importatore
  di `creaProviderRealeGrezzo`; confine provato in
  `server/tars/costi/confine.test.ts`). Ledger R1 `tars_azioni_esecuzioni` +
  `_eventi` con `sedeId` e `utenteId`, solo INSERT
  (`server/tars/azioni/executions.ts:105-132`), lettura sede-scoped
  (`server/routers/tars.ts:1166,1191`).
- **Ledger dei costi LLM (§4.2).** `tars_costi`
  (`server/tars/costi/ledger.ts:240-259`) registra per chiamata `sede_id`,
  `utente_id`, `modello`, `classe`, costo prenotato e reale in nano-USD,
  token input/cached/output, `giorno_locale`, `mese_locale`; riconciliazione
  sull'`usage` del provider (`governor.ts:466-494`: un `usage` illeggibile dà
  `uncertain`, mai zero). È la base del budget mensile per azienda.
- **Coda durevole (§12.5).** `business_events` / `business_event_processing`
  (`server/events/repository.ts:225-345`): `FOR UPDATE SKIP LOCKED`,
  `locked_by/locked_at`, `attempts` fino a 5 poi `dead_letter`, backoff,
  recupero dei lease stantii (`server/events/worker.ts:21-24, 93-96`), dedupe
  `UNIQUE(sede_id, dedupe_key)`. È il modello di «retry, lease, dedup e
  dead-letter per tenant».
- **Storage e backup (§12.4).** `putFile`/`getFile` con SHA-256
  (`server/_core/fileStorage.ts:61-75, 461-479`); fallback `dataBase64` in
  lettura davvero usato (`server/routers/preventiviContratti.ts:1147-1178`,
  `ticketAllegati.ts:104,113`, `documenti/analisi.ts:137`); il backup rilegge
  i byte dal driver via `storageKey` e verifica il checksum
  (`server/_core/driveBackup.ts:811-830`).
- **Segreti e webhook (§15).** AES-256-GCM in `server/_core/secretBox.ts` con
  `MAIL_ENCRYPTION_KEY` per password delle caselle, token FiC, app secret
  Meta e sottoscrizioni push; webhook Meta verificato sul raw body con
  HMAC-SHA256 e `timingSafeEqual` prima di qualunque parsing
  (`server/_core/index.ts:168-231`, `server/comunicazioni/whatsapp.ts:292-309`).
- **Due pattern già pronti per il tenant.** Le tabelle relazionali nascono
  da un `ensureSchema()` per modulo con `CREATE TABLE IF NOT EXISTS` (drizzle
  copre solo `users`, `drizzle/schema.ts:11-27`): il control plane (§12.1)
  può nascere così. `persistedStore(key, onLoad)`
  (`server/_core/persistence.ts:183-186`) fa il backfill in `onLoad`
  (`utenti.ts:105-107` mette `sediIds = [1]`, `ticket.ts:28` `sedeId = 1`):
  la stessa via per `tenantId = 1`.

### A.2 Dove il codice diverge (per sezione della spec)

| Spec | Assunzione | Stato | Nel codice | Conseguenza per i workstream |
|---|---|---|---|---|
| §5.1, §12.2 | il contesto porta `tenantId` | **manca** | nessun concetto di tenant, azienda o organizzazione: zero riscontri strutturali (`tenant` appare solo in due commenti: `server/routers/sedi.ts:10` «Each sede is a fully isolated tenant» e `server/_core/permissions.ts:55`); `azienda` è un tipo di cliente (`server/routers/clienti.ts:105`), `company` è l'account FiC per sede | WS1: `tenantId` e stato dell'abbonamento in `context.ts`; `allowedSediForUser` filtrata per tenant; il fallback `DEFAULT_SEDE_ID = 1` (`sedi.ts:29`, `context.ts:42-61` e `server/tars/contesto.ts:23`, che non è fail-closed) va reso tenant-aware |
| §6.1 | ruolo Proprietario | **manca** | `direzione` = tutte le capability (corto circuito `capabilities.ts:154`) + tutte le sedi + `role: "admin"` derivato (`server/routers.ts:148`) su cui poggia `adminProcedure` (`server/_core/trpc.ts:61-76`); nessuna capability per gestire utenti e sedi (`utenti.create/update/delete` e `sedi.*` sono `adminProcedure`/`requireDirezione`) | WS1 decide la forma del Proprietario (ruolo in `ruoli[]` o attributo dell'appartenenza al tenant) e come si mappa il `role` legacy |
| §6.1 | ultimo Proprietario/Direzione non rimovibile | **diverso** | la guardia c'è ma è globale (`utenti.ts:31-38, 261-269, 280-284`); continuità per sede solo per `tars.manage_policy` (`server/authz/repository.ts:551-570`) | per tenant, per entrambi i presìdi |
| §6.2, §15 | Platform Admin con MFA | **manca** | nessuna identità globale (`server/routers/platform.ts` è `protectedProcedure`); nessun MFA/TOTP (`input-otp.tsx` è un primitivo shadcn non collegato) | WS6: identità fuori dallo store `utenti`, MFA e accesso di supporto con scadenza da costruire |
| §9, §16.4 | inviti monouso, ripresa dell'onboarding | **manca** | l'admin crea l'utente con la password nel payload (`utenti.ts:190-229`); niente invito, token, reset password | WS5 |
| §12.1 | control plane relazionale | **diverso** | `utenti` e `sedi` sono blob JSONB (`utenti.ts:79`, `sedi.ts:33-48`), non tabelle; la sede è `{ id, nome, citta, indirizzo, attiva, createdAt, updatedAt }` senza dati fiscali; drizzle copre solo `users` del percorso OAuth; una quarantina di tabelle business create da `ensureSchema()`, tutte con `sede_id` tranne `kv_store`, `users`, le figlie con FK e i ledger di migrazione; `fic_fatture` è uno store JSONB (`server/routers/ficFatture.ts:151`), non una tabella | WS1 decide se appartenenze, inviti e abbonamenti nascono come tabelle (coerente col repo) e se `utenti`/`sedi` restano JSONB con `tenantId`; i dati societari e fiscali del tenant (§8) sono nuovi |
| §12.3 | `persistedStore` tenant-aware, `tenant:<id>:<store>` | **diverso** | chiave = nome puro (`persistence.ts:411-418`), `kv_store(key, data, updated_at)` senza sede né versione (`:113-117`); 50 store in un registro statico, tutti caricati al boot (`bootstrapAll`, `:429-473`) e tenuti come array vivi; riscrittura intera con debounce 200 ms, lock per chiave in-process, nessun optimistic locking; store globali: `sedi`, `utenti`, `backup_config/oauth/log`, `notifiche_read` (per `userId`), `timeline_steps` (scope via commessa) | WS1/WS2: registro dinamico (un'istanza per tenant e store), scelta fra caricamento al boot e lazy (memoria × tenant), una decisione per ogni store globale |
| §12.3 | helper tenant-scoped per gli array | **manca** | il filtro di lista è scritto a mano 165 volte (`clienti.ts:291`, `interventi.ts:107`, `magazzino.ts:183`); l'unico helper è `assertSedeScope` sul singolo record; nessun repository | con una chiave per tenant il filtro tenant è implicito e resta quello di sede: la spec tecnica sceglie se costruire comunque l'helper |
| §12.3 | tabelle dedicate con `tenant_id` | **diverso** | `comunicazioni` (`server/comunicazioni/comunicazioni.ts:326`), `business_events` = eventi (`server/events/repository.ts:230`), `notifications` = notifiche (`server/notifications/repository.ts:354`), `chat_canali/messaggi/letture` (`server/chat/store.ts:101-153`) hanno `sede_id` e non `tenant_id` | WS1: colonna e indici in ogni `ensureSchema()`, backfill `tenant_id = 1` |
| §7 | flag di piattaforma; menu ridotto per azienda | **diverso** | due sistemi: `platform_feature_flags` per sede (`server/platform/featureFlags.ts:41`) senza endpoint di scrittura (`platform.flags` è sola lettura) e interruttori env `FLAG_*` globali per l'installazione (`server/platform/interruttori.ts:64-87`, fail-closed); nessuna impostazione di visibilità del menu | i flag restano di piattaforma (coerente con §7); la visibilità del menu per tenant è nuova (WS5) |
| §4.1, §12.4 | 100 GB misurati sui byte del tenant | **manca** | nessun conteggio dei byte (solo `backup_log.bytes` e `inlineBytes` ricalcolati al volo: `driveBackup.ts:1093`, `server/routers/fileStorageAdmin.ts:30-43`); chiavi `<collezione>/<parentId>/<recordId>-<rand8>` senza sede né tenant (`fileStorage.ts:61-71`; `anteprime` usa `sedeId` come parent, `comunicazioni` la casella); `deleteFileQuiet` è best-effort e chiamato solo da documenti e allegati ticket: allegati mail, `fatture_xml/pdf` e `anteprime` non si cancellano mai; media WhatsApp non salvati (`storageKey: null`, riscaricati da Meta, `whatsapp.ts:815-822`) | WS3: prefisso tenant, contatore dei byte come ledger (non ricalcolo), cascate di cancellazione complete prima di far pagare lo spazio |
| §12.4, §16.5 | backup e restore per tenant | **manca** | un solo archivio per tutte le sedi (`driveBackup.ts:835-1016, 1066`; le cartelle «Sede …» sono segmenti di percorso); OAuth Drive globale a riga singola con refresh token **in chiaro** (`driveBackup.ts:104-147`); nessun percorso di restore | WS3: backup per tenant, credenziali Drive per tenant e cifrate, restore provato |
| §12.5 | integrazioni tenant-scoped, `state` che lega tenant, sede e utente | **diverso** | FiC (`fic_config`), caselle (`caselle_email`), WhatsApp (`whatsapp_config`, `whatsapp_app`), calendari (`calendar_tokens`, `external_calendars`) sono già per sede; Drive è globale. `state` in `Map` in memoria con TTL 10 min (perso al riavvio, non condiviso fra repliche): FiC lega `{ sedeId, redirectUri, scrittura }` ma non l'utente (`fattureInCloud.ts:179-210`), Drive è solo un random senza legame (`driveBackup.ts:159-173`). Il webhook Meta prova il secret di ogni sede (`index.ts:168-231`); FiC non ha webhook | WS3: `state` persistito e legato a tenant, sede e utente; instradamento del webhook per numero/app del tenant |
| §12.5 | job con `tenantId`, retry/lease/dead-letter per tenant | **diverso** | solo gli eventi business hanno la coda durevole; gli altri 11 worker sono `setInterval` in-process con boolean o `Set` (`actionCenter/scheduler.ts`, `tars/smistamento/worker.ts`, `tars/analisi/worker.ts`, `tars/followup/worker.ts`, `tars/documenti/confermeAutoArchivio.ts`, `commesse/costoDaConfermaWorker.ts`, `fatture/sonda.ts`, `fattureInCloud.ts:1106-1129`, `comunicazioni/imap.ts:581`, `driveBackup.ts:1164`, `reminders/worker.ts`), giro «tutte le sedi» (`getSediStore()` / `allSedeIds()`); niente sopravvive a un riavvio o a una seconda replica | WS3: ogni worker itera per tenant e isola il guasto; decidere se estendere la coda durevole |
| §4.2 | budget Tars mensile per azienda, percentuale all'utente | **diverso** | i tetti vengono solo da env (`TARS_MAX_COST_PER_RUN_USD`, `TARS_DAILY_BUDGET_USD`, `TARS_MONTHLY_BUDGET_USD`, `TARS_BUDGET_<CLASSE>_USD`: `governor.ts:74-133`); gli aggregati del ledger ignorano `sede_id` (`ledger.ts:338-356, 461-484`), lock advisory globale (`:228, 325`), `tars.costi` dichiara «ambito: globale» (`server/routers/tars.ts:535,564`); provider solo OpenAI via `fetch` (`server/tars/openai/adapter.ts:33,131`), modelli da `TARS_MODEL_*`; chiamate a costo: chat, analisi azienda, smistamento, lettura visiva, estrazione contratto, eval; nessun embedding; trascrizione senza consumatori | WS4: budget dal record dell'abbonamento, aggregati per tenant, percentuale (mai token o modelli) nell'interfaccia |
| §15 | rate limiting su login, webhook, upload, operazioni costose | **diverso** | login 5 tentativi/15 min per email in memoria (`server/routers.ts:59-97`), `tars.invia` 20/5 min (`routers/tars.ts:145-200`); upload solo cap 250 MB e uno slot globale di concorrenza (`commessaFileRoutes.ts:91-104`); webhook e feed ICS anonimo (`index.ts:270-286`) senza limite; nessuna dipendenza `express-rate-limit`/`helmet` | WS1/WS6 |
| §15 | audit append-only | **diverso** | `policy_audit_diffs`, `policy_change_events`, `tars_azioni_esecuzioni_eventi`, `tars_costi` sono append-only per uso (solo INSERT nel codice), senza trigger né `REVOKE`; `platform_feature_flag_audit` è un blob JSONB riscrivibile (`featureFlags.ts:58`) | se «append-only» deve essere una garanzia e non una convenzione, serve enforcement nel database |
| §10.3, §15 | export aziendale al Proprietario | **manca** | nessun export (solo l'import CSV dei clienti FiC, `server/_core/importaClienti.ts`); il backup notturno è l'unica estrazione, globale e direzione-only | WS4/WS6 |
| §6.3 | Tars non aggira gate e conferme | **regge**, con una precisazione | `scavalcaGate` è un input del modello (`server/tars/strumenti/commesse.ts:375`) che salta un gate documentale bloccante (`:605`, registrato come `bypassGateDocumentale`, `:625`), tipizzato, avvisato e vietato alle proposte dell'analisi (`analisi/analisi.ts:131`, `analisi/esecuzione.ts:100`): è il «Procedi comunque» del CLAUDE.md, non un aggiramento; pagamenti, invii esterni e cancellazioni non sono gated perché assenti dal catalogo (`registry.ts:534-553`, il validatore li rifiuta); l'unico R3 è una proposta inerte | nessuna azione; §6.3 va letto così anche nella matrice azioni |
| §7 | archivio e ricerca inclusi | **regge** | nessun indice semantico né embedding: `FLAG_TARS_SEMANTIC_SEARCH` lancia `SEMANTIC_SEARCH_NOT_READY` (`featureFlags.ts:130-137`); la ricerca è deterministica e sede-scoped (`server/tars/strumenti/ricerca.ts`); la memoria di Tars è lo store JSONB `tars_memoria` per sede e utente (`server/tars/memoria.ts:41`); `tars.manage_policy` governa i permessi, non regole di Tars | niente indice da isolare nella v1; `tars_memoria` segue gli altri store |
| §4, §14 | vocabolario | — | nel repo «limiti» sono i massimali fiscali DM MITE del contratto (PRD §55, `computi`, `commessa_righe`, `FLAG_LIMITI`) | per le soglie commerciali dire sempre «soglie d'uso» |

### A.3 Numeri utili per dimensionare il workstream 1

| Cosa | Quanti | Dove |
|---|---|---|
| Store `persistedStore` | 50 | dichiarazioni `persistedStore("<nome>")` in `server/` |
| Tabelle relazionali create da `ensureSchema()` | una quarantina | un `ensureSchema()` per modulo |
| Usi di `ctx.sedeId` (non test) | 308 | `server/` |
| Filtri di lista `sedeId === ctx.sedeId` a mano | 165 | router e servizi |
| Chiamate ad `assertSedeScope` | 91 | `server/_core/permissions.ts:62-73` |
| Worker in-process senza coda durevole | 11 | tabella in A.2 |
| Schemi di input con `sedeId` esposto al client | 2, entrambi rivalidati | `sedi.ts:157`, `tars/strumenti/allegati.ts:52` |

### A.4 Decisioni che la spec tecnica del workstream 1 deve prendere

1. **Forma del control plane** (§12.1): tabelle via `ensureSchema()` per
   tenant, appartenenze utente↔tenant (ruoli e Proprietario), inviti,
   abbonamenti, eventi del provider, ledger dei consumi, omaggi, audit di
   piattaforma e accessi di supporto; e chi resta la fonte di verità degli
   utenti (oggi lo store `utenti` JSONB, con l'hash scrypt dentro il blob).
2. **Contesto** (§12.2): `tenantId` e stato dell'abbonamento in
   `server/_core/context.ts`; `allowedSediForUser` per tenant; via il
   fallback `DEFAULT_SEDE_ID` da `context.ts` e da `server/tars/contesto.ts:23`.
3. **Registro dinamico di `persistedStore`** (§12.3): un'istanza per tenant
   e store; boot completo o lazy; memoria per tenant; chiavi legacy in sola
   lettura; sorte degli store globali.
4. **Proprietario e `role` legacy** (§6): rappresentazione, capability
   esplicite per la gestione di utenti e sedi (oggi assenti), guardia
   dell'ultimo presidio per tenant.
5. **Test** (§16.1): estendere `crossSede.test.ts` e gli altri negativi al
   tenant (ID uguali in tenant diversi), più un test strutturale che nessuno
   schema di input accetti `tenantId`.
6. **Append-only** (§15): convenzione o vincolo nel database.
