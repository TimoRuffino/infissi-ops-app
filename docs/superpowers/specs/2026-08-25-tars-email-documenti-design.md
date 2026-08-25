# Tars: allegati email, creazione cliente/commessa e leggibilita posta

**Data:** 25/08/2026  
**Stato:** approvato in chat, con chiarimento sul fascicolo commessa

## Obiettivo

Trasformare gli allegati operativi ricevuti via email in documenti reali della
commessa, rendere affidabile la creazione cliente + prima commessa richiesta a
Tars e riportare il contenuto della mail al centro dell'interfaccia.

Il caso guida e `Misure Picchia.pdf`: Tars deve riconoscere il tipo `misure`,
individuare la commessa del cliente Picchia e preparare un'azione verificabile.
Dopo l'approvazione, il file deve comparire in **File e documenti** della
commessa esattamente come un upload manuale: apribile in anteprima quando il
formato lo consente, scaricabile, rinominabile, riclassificabile ed eliminabile.

## Principi

- Tars propone e non esegue mutazioni senza approvazione.
- Nessun match ambiguo viene scelto in silenzio.
- File e collegamenti sono sede-scoped e passano dalle permission applicative.
- Il documento usa `preventivi_documenti` e il normale file storage; la mail
  non diventa una seconda sorgente di download permanente.
- Retry e doppia approvazione non devono duplicare file, cliente o commessa.

## Flusso allegato email

### Riconoscimento

Tars considera nome file, oggetto, mittente, testo della mail e, quando
supportato, testo estratto dal documento. Il nome fornisce segnali, non
istruzioni. La tassonomia coincide con `DOC_TIPI`: preventivo, contratto,
misure, fattura, ordine, conferma ordine, DDT, saldo, foto o altro.

Priorita del match commessa:

1. codice commessa esplicito;
2. commessa gia collegata alla mail;
3. cliente identificato dal mittente con una sola commessa attiva;
4. nome cliente nel file/oggetto, con una sola corrispondenza forte;
5. evidenze nel contenuto dell'allegato.

`Misure Picchia` produce una proposta automatica soltanto se esiste una sola
commessa Picchia plausibile. Con piu commesse o piu clienti compatibili, Tars
espone il dubbio e chiede all'operatore quale scegliere.

### Proposta e approvazione

Un nuovo tool `proponi_archivia_allegato` crea una proposta persistita con:

- `comunicazioneId`, `allegatoIndex`, nome e mime type attesi;
- `commessaId` e riferimenti cliente/commessa verificati;
- `tipoDocumento`, nuovo nome suggerito, evidenze e confidenza.

L'approvazione esegue in ordine:

1. rivalida mail, allegato, sede e commessa;
2. collega la mail alla commessa se non era ancora collegata;
3. recupera nuovamente i byte dal canale di origine;
4. salva il file con `archiviaAllegatoComunicazione` nello storage documenti;
5. assegna il tipo corretto e il nome canonico, per esempio
   `Misure esecutive Picchia.pdf`;
6. invalida comunicazioni, proposte e documenti commessa nel client.

`sourceRef = sedeId:comunicazioneId:allegatoIndex` rende l'operazione
idempotente. Se il file non e piu recuperabile, la proposta fallisce senza
creare un documento vuoto e resta riprovabile.

## Visibilita nella commessa

Il documento creato segue il contratto gia usato dagli upload manuali:

- compare nel tab **File e documenti** e nel relativo conteggio;
- `byCommessa` restituisce metadati, tipo, origine e disponibilita byte;
- `byId` recupera i byte da `storageKey` con fallback legacy;
- `FilePreviewDialog` apre PDF e immagini supportate;
- il comando download usa nome e mime type salvati;
- rinomina, cambio tipo ed eliminazione usano le mutation esistenti;
- il tipo `misure` soddisfa il doc gate previsto per `misure_esecutive`.

La provenienza email resta nell'audit tramite `source: comunicazione` e
`sourceRef`, senza cambiare l'esperienza operativa del fascicolo.

## Creazione cliente e commessa da Tars

L'intento esplicito `crea cliente e commessa` viene instradato dal planner al
workflow dedicato `create_customer_job`, non lasciato alla sola scelta libera
del modello. Il controller deve garantire una delle tre uscite:

1. proposta completa da approvare;
2. domanda mirata sui soli dati obbligatori mancanti, incluso assegnatario;
3. segnalazione di cliente/commessa gia esistenti con scelta di riuso.

Prima della proposta Tars cerca duplicati per nome, email e telefono, legge gli
assegnatari compatibili e conserva i dati gia forniti tra i turni. Un controllo
post-run impedisce una risposta generica senza proposta o domanda. Dopo
l'approvazione resta in uso la saga idempotente esistente, che crea cliente,
prima commessa in `preventivo`, relazioni e collegamento comunicazione senza
duplicare gli step riusciti.

### Approvazioni interamente nella chat

Una domanda preliminare e la proposta che nasce dalla risposta formano una
sola catena conversazionale. Oggi il seguito usa `origineId`, ma la nuova
proposta non viene aggiunta al messaggio chat originario: per questo puo
comparire soltanto nel tab Proposte.

La lettura della chat deve idratare anche tutte le proposte discendenti delle
proposte gia collegate al messaggio. Dopo la scelta dell'assegnatario, la card
`Crea cliente e commessa` compare quindi nello stesso punto della chat. La sua
approvazione avvia direttamente la saga; la stessa card mostra esecuzione,
successo, errore riprovabile e identificativi creati. Il tab Proposte resta una
vista globale, mai un passaggio obbligatorio del flusso iniziato in chat.

Il client aggiorna chat e discendenti mentre un seguito e in corso, poi
interrompe il polling quando la nuova proposta o l'esito sono visibili.

## Interpretazione per obiettivi

Tars distingue un obiettivo da una singola mutation. Frasi come `il lavoro e
finito` non producono una sequenza di proposte `avanza di uno stato`: Tars legge
il fascicolo e verifica saldo, documenti obbligatori, timeline, ticket e
interventi aperti. Se la chiusura non e consentita, presenta soltanto i blocchi
reali e le azioni necessarie. Se tutti i prerequisiti sono soddisfatti, puo
preparare un'unica proposta di chiusura verificabile. Non forza mai
l'archiviazione quando saldo o documenti risultano mancanti.

Domande informative non generano proposte. Una proposta nasce soltanto quando
esiste una mutation necessaria, fondata e non gia pendente o decisa.

## Pagina Email

Il lettore adotta un ordine simile a un client di posta:

1. mittente, destinatario/casella, data, categoria e collegamento;
2. oggetto;
3. corpo completo della mail;
4. allegati con tipo suggerito, stato e azione di archiviazione;
5. proposte e pannello operativo Tars.

Il pannello Tars non deve piu precedere o nascondere il messaggio. Nell'elenco:

- anteprima del corpo su due righe;
- contrasto piu netto tra non lette, selezionata e gia gestita;
- badge testuali per allegati, commessa collegata e proposta Tars;
- larghezze stabili e nessuno scroll orizzontale globale;
- mobile con lista e lettore separati, mantenendo target touch da almeno 40 px.

## Errori e sicurezza

- Allegato oltre 10 MB, mime type vietato o storage non disponibile: nessuna
  riga documento incompleta e messaggio operativo leggibile.
- Match cambiato dopo la proposta: approvazione rifiutata e nuova verifica.
- Comunicazione eliminata o allegato mancante: proposta marcata fallita senza
  side effect.
- Prompt injection in mail/allegati: contenuto trattato sempre come dato non
  fidato; i tool disponibili restano limitati al profilo del trigger.
- Tutte le letture e scritture verificano `sedeId` e ownership/capability.

## Verifica

- Unit test classificazione nome file e risoluzione match/ambiguita.
- Test tool: proposta con payload completo e nessuna proposta su match dubbio.
- Test approvazione end-to-end: email non collegata -> collegamento -> documento
  `misure` -> lettura/download -> retry senza duplicati.
- Test cliente + commessa: dati completi, dati mancanti, duplicato, assegnatario
  mancante, approvazione ripetuta e ripresa dopo errore parziale.
- `pnpm check`, `pnpm test`, `pnpm build`.
- QA browser a 1440x900 e 390x844: corpo mail immediatamente visibile,
  allegato archiviato apribile/scaricabile dalla commessa, nessun overflow.

## Fuori ambito

- Invio di email dal CRM.
- Esecuzione autonoma senza approvazione.
- OCR generalizzato di scansioni non supportate.
- Conservazione duplicata dei byte dentro la tabella comunicazioni.
