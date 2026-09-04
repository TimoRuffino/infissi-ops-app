# Costo fornitore dalla conferma d'ordine — piano

> Mandato direzione 03/09/2026 sera: «il costo non deve nascere se lo chiedo
> in chat, il costo deve nascere nel momento in cui la conf. ordine viene
> allegata alla commessa». Caso guida: commessa Tesconi Giorgio, conferma già
> nel fascicolo, card economia con costi fornitore a zero.

**Obiettivo:** ogni conferma d'ordine che entra nel fascicolo di una commessa
registra da sola il costo fornitore (IMPONIBILE) sul registro `costi[]`, e il
margine si calcola senza chiederlo a nessuno.

**Architettura:** regola di dominio deterministica, non un'azione Tars. Vive
in `server/commesse/costoDaConferma.ts` e si aggancia ai punti in cui un
documento di tipo `conferma_ordine` entra, esce o cambia fascicolo:

| Evento | Punto di aggancio | Effetto |
|---|---|---|
| Upload dalla scheda (tRPC o rotta HTTP 250 MB) | `caricaDocumentoCommessaDaBuffer` | legge il PDF (testo nativo) e registra il costo |
| Archiviazione da mail (pagina Messaggi, Tars `archivia_allegato_comunicazione`, smistamento) | `archiviaAllegatoComunicazione` | idem |
| Riclassificazione `altro` → `conferma_ordine` | `preventiviContratti.update` | registra; nel verso opposto rimuove il costo nato dal documento |
| Spostamento fra commesse | `spostaDocumentoDiCommessa` | il costo segue il documento |
| Cancellazione del documento | `preventiviContratti.delete` | il costo nato dal documento sparisce |
| Conferme già nei fascicoli (Tesconi) e scansioni | worker `costoDaConfermaWorker` (boot +30 s, ogni 60 s, 10 per giro, OCR locale ammesso) | backfill e ritentativi |

**Perché è deterministico e non chiede conferma:** l'importo non è deciso dal
modello, è scritto nel documento che un umano (o Tars su clic Esegui) ha
appena messo nel fascicolo. Come il pattuito nasce dalla fattura FiC, il costo
nasce dalla conferma. Se l'imponibile non c'è, non si scorpora l'IVA per stima:
il documento viene marcato `senza_imponibile` e la scheda lo dice.

## Regole

1. Solo documenti `tipo === "conferma_ordine"`.
2. L'importo è `imponibileDocumento` dell'estrattore (`estraiConfermaOrdine`):
   etichetta esplicita, o totale − IVA quando entrambi sono dichiarati.
3. Il legame costo→documento è il campo `costi[].documentoId` (backfill dalle
   note `documento:<id>` scritte da Tars prima del campo).
4. Anti-doppione: se la commessa ha già un costo manuale con lo stesso numero
   d'ordine o lo stesso importo, quel costo viene COLLEGATO al documento, non
   duplicato.
5. Il documento ricorda l'esito in `letturaCosto` (versione, checksum, esito,
   tentativi): il worker non rilegge ciò che è già deciso; un cambio di
   `VERSIONE_LETTURA_COSTO` rilegge tutto.
6. Un costo tolto a mano dalla scheda NON rinasce dal worker (la lettura resta
   «registrato»); rinasce solo su richiesta esplicita (`registra_costo_fornitore`).
7. OCR: mai nel percorso della richiesta (upload/archiviazione), solo nel
   worker; l'esito «da OCR» si dichiara nella nota del costo.

## Seconda tranche (stessa sera): merce, conferme certe, registro

Tre mandati arrivati subito dopo:

1. **Magazzino** — «va aperto nel magazzino la sua commessa e compilare la
   merce in arrivo in base a quanto scritto nella conf. ordine; una commessa
   può avere più di 1 conf. ordine». Stessa lettura del documento: le righe
   di merce (`server/documenti/estrazioneMerce.ts`, tre disegni di tabella,
   bassa confidenza dichiarata) diventano righe di `magazzino_prodotti` con
   `documentoId`, fornitore, numero d'ordine, data ordine e data di consegna
   (data esplicita o lunedì della settimana ISO citata). Senza righe
   riconosciute entra una riga sola «da completare a mano», così la commessa
   compare comunque con la data. Più conferme = più gruppi di righe. Il
   magazzino parte da «Da ordinare» (prima era «Produzione»). Merce e costo
   seguono il documento (spostamento) e spariscono con lui (cancellazione,
   riclassificazione). `VERSIONE_LETTURA_COSTO` 1.1.0 fa rileggere al worker
   le conferme già elaborate per scrivere la merce.
2. **Conferme certe archiviate da sole** — «vale per tutte le commesse da
   Da ordinare in poi, quindi vanno cercate e collegate anche se in stati
   successivi». La ricerca copriva già quegli stati; mancava il
   collegamento: worker `server/tars/documenti/confermeAutoArchivio.ts`
   (boot +45 s, ogni 10 min, 10 per giro, `CONFERME_AUTO_ARCHIVIO=off`)
   archivia i candidati «certi» (mail GIÀ collegata alla commessa + nome
   file di conferma) con `origine: "automatico"`; i «probabili» restano
   proposte nella Situazione di Tars. L'archiviazione fa nascere costo e
   merce.
3. **Registro** — «crea un registro delle conf. ordine archiviate
   automaticamente». Campo `Documento.origine` (upload, mail, tars,
   smistamento, automatico, fic; backfill dalle note), procedura
   `preventiviContratti.registroConferme` e pagina `/conferme-ordine`
   («Conferme d'ordine», sotto Cantiere): data, file (si apre), commessa,
   origine, costo imponibile o perché manca, merce a magazzino.

## Terza tranche (notte del 04/09): il caso Giacomazzi

In produzione la commessa 96 (Giacomazzi Giulia) aveva sette «conferme»
archiviate dallo smistamento perché il cognome era nell'OGGETTO della mail,
tre delle quali copie dello stesso ordine Alias 1602923, diventate tre costi.
Mandati: «Tars oltre all'oggetto deve controllare sempre anche il
riferimento all'interno della conf. ordine; alcune aziende potrebbero
inviare più conf. ordine nella stessa mail con lo stesso oggetto»; «vanno
ricontrollate tutte le conf. ordine collegate automaticamente»; «va
ricontrollato anche il magazzino»; «alcune aziende usano la settimana di
approntamento»; «spesso Tars mette dei duplicati»; «migliora notevolmente
l'OCR».

1. **Riscontro nel testo** (`server/documenti/riscontroCommessa.ts`): una
   conferma entra in un fascicolo DA SOLA solo se il suo testo cita la
   commessa — codice, cliente (anche troncato: «VS.RIFERIMENTO GIACOMAZZI
   GIUL»), indirizzo del cantiere o un ordine già noto. Vale per lo
   smistamento (`applica.ts`), per il worker delle conferme certe e per lo
   strumento `archivia_allegato_comunicazione` 1.1.0 (che scavalca solo con
   `confermaSenzaRiscontro: true` detto dall'utente). Le archiviazioni manuali
   (scheda, Messaggi) restano fidate.
2. **Ricontrollo retroattivo**: `VERSIONE_LETTURA_COSTO` 1.2.0 fa rileggere
   ogni conferma; quelle con origine smistamento/automatico senza riscontro
   perdono costo e merce (`senza_riscontro`) e compaiono nel registro e nella
   scheda con «È di questa commessa» (`preventiviContratti.confermaRiscontroConferma`,
   direzione o amministrazione).
3. **Duplicati**: stesso riferimento d'ordine nel nome del file o nel testo
   (`Ordini_di_Vendi_1602923(1)`, `(1) (2)`, `(1) (3)`) = stessa conferma:
   niente secondo costo né seconda merce (`duplicato`), e un file rimandato
   con il progressivo nel nome e la stessa dimensione (±2 %) non entra due
   volte nel fascicolo.
4. **Numeri di commessa** (`conversazione/resolver.ts`, prompt v11): «la
   commessa 393» è il progressivo del codice COM-2026-393, mai l'id del
   database (Tars aveva mosso COM-2026-385 e scavalcato cinque gate).
5. **Settimana di approntamento** (`estrazioneConferma.ts`): «Approntamento
   [1] … 2026 Settimana 21» non è una consegna: la merce a magazzino resta
   senza data, la nota dice «merce pronta dal fornitore dal 18/05/2026: la
   consegna va concordata».
6. **Righe merce** (`estrazioneMerce.ts` 1.1.0) tarate sul testo reale di
   Alias: unità e quantità incollate anche a rovescio («NR 1,00PORST-C013»,
   «1,00NR253003 POMOLO»), quantità nella riga sotto, codici articolo non
   scambiati per quantità. Le righe lette da un estrattore vecchio si
   rigenerano se nessuno le ha toccate a mano.
7. **OCR**: in produzione era spento (i binari tesseract/poppler erano già
   nell'immagine via `nixpacks.toml`, il flag no): `FLAG_OCR=on` impostato
   in Railway il 04/09 (gli interruttori restano fail-closed nel codice);
   tesseract in `--psm 6` con `preserve_interword_spaces=1`, così le righe di
   tabella restano righe. Lettura con il modello dei PDF scansionati:
   tranche successiva, da decidere.

## Quarta tranche (00:30 del 04/09): la chat e le proposte

- `leggi_conferma_ordine` 1.2.0: «cita la commessa» vale anche per
  cliente, indirizzo e ordine noto (`riscontroCommessa` con le prove), e
  restituisce il VOSTRO RIFERIMENTO («VS.RIFERIMENTO GIACOMAZZI GIUL»), il
  fornitore dall'intestazione («ALIAS Srl Porte blindate»), il numero del
  documento del fornitore («CV 003746»), la settimana di approntamento. La
  chat diceva «il file non cita il codice commessa e non riporta fornitore o
  riferimento ordine» su un documento che li aveva tutti.
- Stato operativo del run: è quello dell'ULTIMA azione decisiva (un rifiuto
  seguito da un'azione riuscita è «Fatto»; un rifiuto dopo le riuscite resta
  «Non eseguito»). Prompt: su `non_eseguito` la risposta comincia con «Non
  fatto:», mai con «Fatto».
- Proposte dell'analisi: le gestite (eseguite o scartate) stanno dietro un
  toggle; l'analisi di oggi si rifà da sola dopo quattro ore, o dopo mezz'ora
  se ogni proposta è stata gestita; le proposte scartate oggi entrano nella
  fotografia come «non riproporre».
- Lettura 1.3.0: il worker rilegge ancora tutte le conferme per prendere
  fornitore e numero documento dall'intestazione.

## Quinta tranche (mattina del 04/09): «è ancora troppo stupido»

Caso guida: conferma BT Glass per De Petris (COM-2026-052), archiviata da
Tars in chat alle 08:45 e letta «senza imponibile né totale, fornitore
Ruffino Group». Il documento aveva tutto: pdf.js consegnava il testo
nell'ordine del flusso, con il riquadro totali spezzato (importi dieci righe
prima delle etichette) e l'agente al posto del fornitore. Poi la direzione
ha mandato quindici conferme di fornitori diversi: dieci sono SCANSIONI.

1. **Righe dalla geometria** (`server/documenti/testoPdf.ts`, parser
   `pdf-testo-nativo` 2.0.0): ogni frammento pdf.js torna alla sua riga
   (stessa quota) e alla sua colonna (x / larghezza media di un carattere),
   come `pdftotext -layout`. Etichette e valori restano affiancati, le celle
   di una tabella sono separate da almeno tre spazi, un valore resta sotto la
   sua etichetta anche nella riga dopo.
2. **Estrattore 1.1.0** (`estrazioneConferma.ts`): imponibile per
   **aritmetica dell'IVA** (imponibile + IVA = totale con un'aliquota
   italiana; Gianesin, riquadri OCR); `Imposta` come etichetta dell'IVA;
   importi solo con decimali (una partita IVA o «Consegna 3» non sono
   totali); «+ IVA / IVA esclusa / a vostro carico IVA» → il totale letto È
   l'imponibile; «Totale (iva esclusa)» idem; numero non è una data («N.
   000183 del 12/03/2026», «nostro riferimento n. OV-2025-…», cella sotto
   «N.DOCUMENTO»); fornitore dall'intestazione senza scambiarlo con agente,
   banca o destinatario (righe di etichette, marcatore a destra), poi la
   firma in calce, poi il dominio del sito; «vs. riferimento» = valore
   accanto o nella cella sotto, mai un'altra etichetta né una frase; «del
   23/02/2026» è la data del documento anche con «Settimana 21» accanto; la
   colonna «Consegna» di una tabella dà le date di consegna.
3. **Merce 1.2.0** (`estrazioneMerce.ts`): righe a celle (codice |
   descrizione | um | quantità), quantità prima o dopo l'unità, unità a
   misura nel nome («LAMIERA A DISEGNO (4,70 ML)») con i pezzi dalla riga
   sotto, articoli uguali sommati (tre sistemi scorrevoli = 1 riga × 3),
   frasi delle condizioni e opzioni (maggiorazioni, imballi) scartate.
4. **Riscontro** (`riscontroCommessa.ts`): il cognome anche con un carattere
   sbagliato («Rif. POCCJ» per Pocci): le scansioni passano dall'OCR.
5. **Lettura 1.4.0**: il worker rilegge tutte le conferme; la merce letta con
   l'estrattore vecchio si rigenera se nessuno l'ha toccata.
6. **`fic_pagamenti_links` mai salvato** (scoperto nei log della stessa
   mattina): il modulo `routers/ficPagamenti.ts` era importato solo in modo
   dinamico, il suo persistedStore si registrava DOPO `bootstrapAll` e ogni
   salvataggio veniva rinviato per sempre («save deferred … bootstrap not
   complete yet» una volta al secondo, per ore; i link delle riconciliazioni
   FiC vivevano solo in memoria). Import statico in `_core/index.ts` e, in
   `persistence.ts`, uno store registrato tardi si carica da solo.

7. **Rilettura 1.5.0, dopo la sonda sul database di produzione** (39
   conferme rilette): una rilettura migliore CORREGGE l'importo di un costo
   nato dalla regola e mai toccato da una persona (tre conferme Pail erano a
   registro a «22,00», l'aliquota IVA letta come imponibile da un estrattore
   vecchio); un costo scritto o modificato a mano non si tocca, la lettura lo
   dice. La conferma AGGIORNATA dello stesso ordine (stesso riferimento,
   importo diverso, entrata dopo: le «(2).pdf» Oskura) sostituisce la vecchia
   — costo e merce seguono la versione più recente, la vecchia diventa
   `duplicato` con il motivo; una copia identica resta una copia. Il CAP
   («19124») letto come numero di conferma non è più un riferimento
   d'ordine (due ordini Brianzatende erano diventati un duplicato).
   Rilettura 1.6.0: il costo «nato dalla regola» si riconosce dalla sua
   impronta (descrizione `Conferma d'ordine …`, nota `Letto dalla conferma
   d'ordine …`, nessuna modifica dalla scheda: `costi[].modificatoAMano`,
   che `commesse.updateCosto` marca quando una persona cambia l'importo),
   non dal confronto con la lettura precedente — la 1.4.0 aveva già letto
   giusto le tre Pail senza correggerle, e il confronto le faceva sembrare
   modificate a mano.

Sul corpus dei quindici file (non nel repo: dati di clienti), dopo la
tranche: i cinque PDF con testo nativo escono giusti (fornitore, numero,
riferimento, consegna, imponibile, merce); delle dieci scansioni con
l'OCR locale (solo `eng` sul Mac; in Railway c'è anche `ita`) otto danno
fornitore e imponibile plausibili, una è una pagina ruotata (testo
illeggibile: l'OCR non raddrizza), una ha i totali in una tabella che
tesseract sbriciola. Un PDF «Conferme» conteneva più conferme: i totali si
mescolano, va spezzato per documento (prossima tranche). La lettura con il
modello (vision) delle scansioni resta la strada per il resto.

## Task

- [x] `server/_core/margine.ts`: `CostoCommessa.documentoId`.
- [x] `server/routers/commesse.ts`: backfill `documentoId`; `addCosto` accetta
      `documentoId`; `margine` espone `confermeSenzaCosto`.
- [x] `server/commesse/letturaCostoTipi.ts`, `costiRegistro.ts`,
      `costoDaConferma.ts`, `costoDaConfermaWorker.ts` + test.
- [x] `server/routers/preventiviContratti.ts`: campo `letturaCosto`, hook sui
      cinque eventi, helper per il worker.
- [x] `server/_core/index.ts`: avvio worker.
- [x] Tars: `registra_costo_fornitore` 1.1.0 (anti-doppione strutturato,
      lettura salvata), registro 1.17.0, matrice; fotografia e prompt dicono le
      conferme senza costo leggibile.
- [x] Client `CommessaDetail`: riga costo «da conferma d'ordine» con anteprima
      del file, avvisi per le conferme non lette, invalidazione del margine
      quando il fascicolo cambia.
