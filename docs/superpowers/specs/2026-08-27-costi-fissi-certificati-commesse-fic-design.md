# Costi fissi certificati e commesse automatiche da FiC

**Data:** 27/08/2026  
**Stato:** approvato dall'utente  
**Ambito:** Economia, documenti ricevuti FiC, fatture emesse FiC, commesse

## 1. Obiettivi

1. Eliminare l'associazione fra fatture d'acquisto FiC e commesse.
2. Rendere il totale dei costi fissi aziendali certo, spiegabile e controllato
   da una persona.
3. Usare le ricorrenze FiC come proposte, mai come decisioni automatiche.
4. Creare una commessa distinta per ogni fattura emessa FiC non ancora
   collegata, usando l'intestazione per trovare o creare il cliente.
5. Rendere entrambi i flussi idempotenti e sede-scoped.

## 2. Fonte di verità dei costi fissi

Il registro `costi_fissi_manuali` diventa l'unica fonte di verità del costo
fisso mensile e del fatturato necessario a coprirlo.

Ogni voce contiene:

- descrizione;
- fornitore facoltativo;
- importo per scadenza;
- cadenza;
- validità iniziale e finale;
- categoria;
- origine: manuale oppure confermata da una proposta FiC;
- riferimento alla proposta/documentazione FiC, quando presente.

Una voce entra nel totale soltanto se è attiva nel periodo osservato. Le
cadenze vengono normalizzate mensilmente: mensile `1`, bimestrale `1/2`,
trimestrale `1/3`, quadrimestrale `1/4`, semestrale `1/6`, annuale `1/12`.
Il totale non deriva dalla media indiscriminata delle fatture classificate.

## 3. Proposte FiC

La ricorrenza conserva la regola deterministica attuale: stesso fornitore,
stesso importo entro 0,50 euro, almeno tre mesi consecutivi. Cambia il suo
effetto:

- produce un candidato con importo, mesi, documenti e motivazione;
- non modifica più `classificazione` in `fisso`;
- non entra nel break-even;
- Tars può spiegare e ordinare la proposta, ma non confermarla.

L'operatore può:

- **Confermare fisso:** apre una voce precompilata nel registro; importo,
  cadenza e validità restano modificabili prima del salvataggio;
- **Variabile:** il fornitore resta costo operativo aziendale, senza commessa;
- **Straordinario:** viene escluso dai costi fissi;
- **Ignorare proposta:** la ricorrenza non viene riproposta finché non cambia
  la serie documentale.

Una conferma registra autore e data. Una correzione umana prevale sempre su
ricorrenza e Tars.

## 4. Acquisti senza commesse

`CostoFic.commessaId` resta leggibile soltanto per retrocompatibilità del dato,
ma non viene più scritto né usato nei calcoli. Vengono rimossi:

- assegnazione e ricerca commessa dalla pagina Acquisti;
- coda "Senza commessa";
- costi FiC dal margine della commessa;
- endpoint e helper dedicati all'assegnazione costo-commessa.

Le classi visibili diventano:

- `Fisso confermato` — rappresentato dal registro, non dalla sola etichetta;
- `Variabile` — costo operativo che cresce o cambia con l'attività;
- `Straordinario` — costo una tantum;
- `Da verificare` — classificazione non ancora decisa.

I vecchi valori `variabile_commessa` restano compatibili nello storage, ma la
UI li presenta come `Variabile` e non chiede alcuna commessa.

## 5. Break-even

Il valore principale richiesto è:

```text
fatturato da fare per coprire i costi fissi = costi fissi mensili confermati
```

Non viene applicato un margine arbitrario. Un eventuale secondo scenario con
margine di contribuzione può restare separato, chiaramente opzionale, e non
sostituisce il valore principale.

La UI espone sempre:

- totale mensile confermato;
- numero di voci attive;
- candidati FiC esclusi dal totale;
- formula e periodo;
- dettaglio completo che riconcilia esattamente col totale.

## 6. Una commessa per ogni fattura emessa

Dopo ogni sincronizzazione completa delle fatture emesse, il sistema elabora
ogni fattura `invoice` presente in FiC che non è ignorata e non ha una commessa.
Le note di credito non creano commesse.

Per ciascuna fattura:

1. cerca il cliente nella stessa sede, prima per partita IVA/codice fiscale e
   poi per intestazione normalizzata esatta;
2. se esiste un solo cliente compatibile, lo riusa;
3. se non esiste, crea il cliente usando intestazione e dati di contatto FiC;
4. se più clienti sono incompatibili o ambigui, non sceglie: crea una proposta
   Tars visibile con il dubbio;
5. crea una nuova commessa dedicata alla fattura;
6. collega fattura, pattuito, rate e PDF alla nuova commessa tramite i flussi
   FiC esistenti.

La commessa conserva un riferimento sorgente stabile
`fic:<sedeId>:<fatturaId>`. Tale riferimento è univoco: ripetere sync o
riallineamento restituisce la commessa già creata e non produce duplicati.

L'intestazione serve a identificare il cliente, non ad accorpare fatture:
tre fatture dello stesso cliente producono tre commesse distinte.

## 7. Sicurezza e casi esclusi

- Tutte le ricerche e creazioni sono sede-scoped.
- Una fattura già collegata manualmente non viene spostata.
- Una fattura ignorata non crea commesse.
- Una nota di credito non crea commesse e segue il collegamento già noto.
- Una fattura senza intestazione utilizzabile resta in coda con motivo.
- Il codice commessa scritto esplicitamente in fattura continua a prevalere:
  quella fattura viene collegata alla commessa indicata e non ne crea una nuova.
- Nessuna commessa viene creata se l'identità fiscale contraddice un cliente
  esistente con la stessa intestazione; il caso diventa proposta.
- Operazione idempotente per fattura e transazionalmente ordinata: il link
  sorgente viene controllato prima e dopo la creazione.

## 8. UI

### Costi fissi

Tre blocchi, nello stesso schermo:

1. `Totale certo`: importo mensile e numero voci;
2. `Registro confermato`: modifica, validità e provenienza di ogni voce;
3. `Da confermare da FiC`: candidati con documenti e azioni rapide.

### Acquisti

Classificazione per fornitore o selezione multipla. Nessuna commessa, nessun
secondo passaggio obbligatorio. Le azioni del 2025 restano disponibili con
filtri per anno, fornitore e stato.

### Fatture

Ogni fattura mostra stato `Commessa creata automaticamente`, link alla
commessa e cliente usato/creato. I casi ambigui mostrano il motivo e la
proposta Tars, senza collegamenti inventati.

## 9. Migrazione

- Non cancellare costi o documenti FiC.
- Azzerare l'effetto automatico delle vecchie ricorrenze sul break-even.
- Conservare le voci manuali già presenti nel registro.
- Trasformare in candidati le classificazioni `fisso` con fonte `regola` o
  `tars` che non hanno una conferma umana nel registro.
- Non importare automaticamente nel registro i vecchi `fisso`: richiedono
  conferma per raggiungere la certezza richiesta.
- Lasciare i vecchi `commessaId` nei costi come dati legacy non operativi.

## 10. Verifica

Test mirati devono provare:

- una ricorrenza non entra nel totale prima della conferma;
- conferma, cadenza e validità producono il totale mensile corretto;
- Tars e sync non sovrascrivono una decisione umana;
- nessun costo FiC alimenta più il margine commessa;
- ogni fattura genera una sola commessa anche dopo più sync;
- tre fatture dello stesso cliente generano tre commesse;
- cliente esistente viene riusato senza duplicarlo;
- identità ambigua non crea né cliente né commessa;
- note di credito e fatture ignorate non creano commesse;
- isolamento completo fra sedi.

Prima del rilascio devono passare `pnpm check`, `pnpm test` e `pnpm build`.
