# Riconciliazione FiC di pagamenti e allegati fattura

**Data:** 26/08/2026  
**Stato:** approvato dall'utente  
**Ambito:** pattuito, registro pagamenti, riconciliazione Tars, fatture emesse e PDF nelle commesse

## 1. Obiettivo

Eliminare i doppi pagamenti e le proposte Tars ripetute facendo di Fatture in
Cloud la fonte autorevole per fatture emesse, rate, importi incassati, date di
pagamento e storni. Il CRM continua a essere la fonte del pattuito contrattuale.

La sincronizzazione FiC aggiorna automaticamente soltanto i movimenti di origine
FiC. I pagamenti inseriti manualmente restano sotto controllo umano: quando non
coincidono con FiC, Tars propone una correzione approvabile e non modifica nulla
autonomamente.

Ogni fattura collegata a una commessa deve avere il proprio PDF archiviato nello
storage documentale della commessa, senza dipendere dall'URL temporaneo FiC e
senza creare duplicati ai sync successivi.

## 2. Fonti autorevoli e invarianti

- `commessa.importoTotale` e il pattuito contrattuale lordo del CRM. La
  sincronizzazione FiC non lo valorizza e non lo corregge automaticamente.
- FiC fa fede per esistenza della fattura, importi del documento, rate, stato
  della rata, importo pagato e data di pagamento.
- `commessa.importoIncassato` resta un valore derivato dal registro
  `pagamenti[]`; non e mai accettato come input.
- Il calcolo dell'incassato somma soltanto pagamenti con stato `attivo`.
- Un pagamento FiC e identificato in modo idempotente da
  `(sedeId, ficDocumentoId, ficRataId)`. L'OpenAPI FiC espone l'`id` della rata
  in `IssuedDocumentPaymentsListItem`.
- Se FiC non restituisce eccezionalmente l'id di una rata, il server usa una
  chiave legacy composta da fattura, scadenza, importo e posizione tra rate
  identiche. Tale chiave puo essere promossa all'id FiC soltanto con una
  corrispondenza univoca; una corrispondenza ambigua non produce scritture
  economiche automatiche.
- Tutti gli store, lookup, chiavi e mutation sono `sedeId` scoped. Un id di
  un'altra sede restituisce `NOT_FOUND` e non rivela l'esistenza del record.
- Tars continua a proporre senza eseguire. Le scritture automatiche descritte
  qui appartengono al sincronizzatore deterministico FiC, non a Tars.
- Nessun nuovo PDF o blob base64 viene salvato negli store JSONB. I byte passano
  da `server/_core/fileStorage.ts`; le letture mantengono il fallback legacy
  `dataBase64`.

Riferimento API: [OpenAPI ufficiale Fatture in Cloud](https://github.com/fattureincloud/openapi-fattureincloud/blob/master/openapi-enriched.yaml).

## 3. Modello del registro pagamenti

### 3.1 Pagamento della commessa

Ogni elemento di `commessa.pagamenti` riceve metadati espliciti:

```ts
type OriginePagamento = "manuale" | "fic";
type StatoPagamento = "attivo" | "stornato";

type PagamentoCommessa = {
  id: number;
  importo: number;
  data: string | null;
  metodo: MetodoPagamento | null;
  tipo: TipoRata | null;
  note: string | null;
  origine: OriginePagamento;
  stato: StatoPagamento;
  ficDocumentoId: number | null;
  ficRataId: number | null;
  ficSourceKey: string | null;
  ficStato: string | null;
  ficUltimoSyncAt: Date | null;
  stornatoAt: Date | null;
  createdAt: Date;
  updatedAt: Date | null;
};
```

Il backfill imposta `origine = "manuale"`, `stato = "attivo"` e campi FiC null
per tutti i record esistenti. Un pagamento con `origine = "fic"` e di sola
lettura nella UI e puo essere aggiornato soltanto dal sincronizzatore.

Un unico helper server calcola `importoIncassato` e viene usato da backfill,
add, update, remove, correzioni approvate e sync. Questo elimina le riduzioni
duplicate oggi presenti nel router commesse.

### 3.2 Rate FiC normalizzate

`RataFic` conserva l'identita restituita dall'API:

```ts
type RataFic = {
  id: number | null;
  sourceKey: string;
  importo: number;
  scadenza: string | null;
  stato: "paid" | "not_paid" | "reversed" | string;
  dataPagamento: string | null;
};
```

Il parser non considera incassato uno stato sconosciuto. Solo `paid` genera o
mantiene un pagamento attivo; `not_paid`, `reversed` o la scomparsa confermata
da uno snapshot completo neutralizzano un pagamento FiC gia importato.

### 3.3 Collegamenti con pagamenti manuali

Un registro separato conserva la corrispondenza senza trasformare o modificare
automaticamente il pagamento manuale:

```ts
type RiconciliazioneRataFic = {
  id: number;
  sedeId: number;
  ficDocumentoId: number;
  ficRataId: number | null;
  ficSourceKey: string;
  commessaId: number;
  pagamentoId: number;
  target: "manuale" | "fic";
  stato: "confermata" | "da_verificare" | "superata";
  createdAt: Date;
  updatedAt: Date;
};
```

La chiave logica e `(sedeId, ficDocumentoId, ficSourceKey)`. Una rata puo
puntare a un solo pagamento e un pagamento manuale puo appartenere a una sola
riconciliazione FiC attiva. Se dati storici violano questo vincolo, il sync
conserva il collegamento compatibile con importo e data del pagamento, supera
gli altri e riconcilia separatamente le rate rimaste. Il registro non ha valore
economico proprio: serve soltanto a evitare che la stessa rata o lo stesso
pagamento vengano conteggiati o proposti due volte.

## 4. Collegamento fattura-commessa

Il vecchio match inferito, mostrato in UI ma non persistito, viene eliminato.
Ogni consumer usa soltanto `fattura.commessaId` realmente salvato.

Il sync puo salvare automaticamente il collegamento soltanto quando:

1. il cliente FiC coincide con un solo cliente CRM tramite partita IVA o codice
   fiscale normalizzati;
2. quel cliente ha una sola commessa attiva e non archiviata nella stessa sede.

Il nome normalizzato e l'uguaglianza tra fattura e pattuito sono indizi per una
proposta Tars, non autorizzano una scrittura automatica. Con piu commesse, dati
fiscali mancanti o qualsiasi ambiguita, la fattura resta non collegata e Tars
propone `collega_fattura` con prove strutturate.

Un collegamento manuale prevale sempre. Se l'operatore sposta la fattura:

- il PDF viene riassociato alla nuova commessa;
- i pagamenti di origine FiC vengono neutralizzati nella vecchia commessa e
  ricreati o aggiornati idempotentemente nella nuova;
- i pagamenti manuali non vengono spostati; la relativa riconciliazione passa a
  `da_verificare` e Tars propone la correzione necessaria;
- l'incassato di entrambe le commesse viene ricalcolato.

Le operazioni sono convergenti: se un salvataggio intermedio fallisce, il sync
successivo riprende dalle chiavi FiC senza creare un secondo pagamento o PDF.

## 5. Algoritmo di riconciliazione pagamenti

La riconciliazione parte soltanto per fatture `invoice`, presenti in FiC e con
`commessaId` persistito.

Per ogni rata viene applicato questo ordine:

1. **Collegamento gia esistente.** Se la rata punta a un pagamento FiC, importo,
   data e stato vengono aggiornati dai dati FiC. Se punta a un manuale, il sync
   confronta i campi ma non modifica il record.
2. **Riferimento FiC esplicito legacy.** Una nota contenente il numero fattura e
   una sola rata compatibile crea la riconciliazione senza aggiungere pagamenti.
3. **Corrispondenza esatta.** Un solo pagamento manuale attivo con stesso
   importo e stessa data viene collegato senza proposta.
4. **Corrispondenza manuale correggibile.** Un solo pagamento manuale attivo con
   lo stesso importo e data nulla viene collegato `da_verificare`; Tars propone
   di completare la data da FiC. Un riferimento fattura esplicito ma con
   importo o data differenti produce una proposta di correzione.
5. **Nessun candidato.** Una rata `paid` crea automaticamente un pagamento di
   origine FiC. Una rata mai pagata non crea movimenti.
6. **Ambiguita.** Piu candidati compatibili o una rata senza identita stabile e
   non riconciliabile non creano movimenti; Tars propone una scelta esplicita.

Una rata FiC gia riconciliata con un pagamento manuale non crea mai una seconda
riga di origine FiC. Se l'operatore rifiuta una correzione, il collegamento e il
disallineamento restano auditabili e la stessa proposta non viene rigenerata
finche i fatti FiC non cambiano.

### 5.1 Storni e rimozioni

- Se una rata importata passa da `paid` a `reversed` o `not_paid`, il pagamento
  FiC resta nello storico con `stato = "stornato"`, conserva l'ultimo importo e
  non concorre a `importoIncassato`.
- Se torna `paid`, lo stesso record viene riattivato e aggiornato.
- Se una rata scompare, viene stornata soltanto dopo uno snapshot completo della
  fattura. Una pagina incompleta o una chiamata fallita non produce storni.
- Se la rata e collegata a un pagamento manuale, Tars propone lo storno; il sync
  non modifica il manuale.
- Nessun pagamento viene eliminato fisicamente dal sincronizzatore.

## 6. Proposte Tars e deduplica

Viene aggiunto il tipo ad alto rischio `correzione_pagamento`, approvabile da
direzione o amministrazione. Il payload identifica sede implicita dal contesto,
commessa, pagamento, rata FiC, valori correnti attesi e patch proposta. Puo:

- correggere importo, data, metodo, tipo o note di un pagamento manuale;
- impostare `stato = "stornato"` per neutralizzare uno storno o un doppione;
- confermare quale pagamento manuale corrisponde a una rata FiC.

L'esecutore verifica nuovamente versione, valori correnti, link attivo e rata
FiC viva prima della mutation. Una proposta diventata obsoleta non sovrascrive
modifiche successive: passa a `superata` senza entrare in `errore`, così un
nuovo click non ripete una mutation ormai invalida.

`StatoProposta` aggiunge `superata`. Una proposta passa a `superata`, mantenendo
payload, prove ed esito nell'audit, quando:

- l'effetto richiesto e gia presente nei dati correnti;
- un'altra proposta con la stessa chiave canonica rappresenta lo stesso effetto;
- la fonte FiC e cambiata e rende il payload non piu applicabile.

Per duplicati pendenti si conserva attiva la proposta piu vecchia e si marcano
`superata` le successive. Se l'effetto e gia soddisfatto, vengono superate tutte.

Quando due link storici condividono la stessa source, il risanamento e
target-aware: storna automaticamente soltanto il movimento `origine = fic`
perdente; per un manuale genera una proposta di neutralizzazione che non
riassegna il link canonico. Se una nota fattura esplicita riguarda una fattura
multirata ma non coincide con nessuna rata, nessuna rata viene importata finche
la proposta di riallineamento non viene decisa; manutenzione, storni e
risanamento dei movimenti già esistenti continuano comunque.

Le chiavi FiC hanno questa struttura logica:

```text
fic:<sedeId>:fattura:<documentoId>:rata:<sourceKey>:<azione>:<fingerprint>
```

Il `fingerprint` contiene soltanto i valori di destinazione. Lo stesso fatto non
torna dopo approvazione, rifiuto, errore gestito o superamento; una modifica
reale della fonte produce una nuova azione distinguibile.

I tool generici applicano guardie sui dati vivi:

- `proponi_pagamento` rifiuta un'aggiunta se trova la stessa source key, la
  stessa rata riconciliata o un pagamento compatibile; se serve, indirizza a
  `correzione_pagamento`;
- `proponi_modifica_commessa` elimina i campi gia uguali e rifiuta una patch
  vuota, incluso un pattuito gia presente;
- le proposte deterministiche FiC passano dalla stessa deduplica comune dei tool
  Tars e non controllano soltanto lo stato `pendente`.

Il primo sync dopo il rilascio riesamina le proposte FiC pendenti storiche. Non
cancella record: marca `superata` quelli duplicati o gia soddisfatti. I doppi
pagamenti storici restano invariati e generano una proposta esplicita di
neutralizzazione.

## 7. Archiviazione PDF

Il flusso usa un unico servizio `ensureFicInvoiceAttachment` richiamato:

1. dopo il collegamento automatico nel sync;
2. dopo l'approvazione o la mutation manuale `collega_fattura`;
3. durante i sync successivi per gli allegati mancanti o falliti.

Il servizio:

- cerca il documento per `(sedeId, ficDocumentoId)`;
- richiede a FiC un URL PDF aggiornato, senza persistere l'URL temporaneo;
- scarica al massimo 10 MB, verifica firma `%PDF-` e checksum SHA-256;
- salva i byte nello storage configurato e usa `upsertDocumentoFic`;
- riassocia il documento esistente se la fattura e stata spostata;
- non crea un secondo documento quando viene ripetuto.

`FatturaFic` conserva stato e tentativi, non i byte:

```ts
type StatoPdfFic = "non_collegata" | "in_attesa" | "archiviata" | "errore";

type PdfSyncFic = {
  stato: StatoPdfFic;
  ultimoTentativoAt: Date | null;
  ultimoErrore: string | null; // messaggio sanitizzato, nessun payload cliente
};
```

Un errore PDF non annulla fatture o pagamenti gia sincronizzati. Viene contato
nel risultato, mostrato all'operatore e ritentato. Il successo successivo
azzera l'errore.

## 8. API e interfaccia

### 8.1 Contratti server

Il risultato del sync include almeno:

```ts
type FicPaymentSyncStats = {
  pagamentiCreati: number;
  pagamentiAggiornati: number;
  pagamentiStornati: number;
  pagamentiRiattivati: number;
  manualiRiconciliati: number;
  correzioniProposte: number;
  ambiguita: number;
  proposteSuperate: number;
  pdfArchiviati: number;
  pdfFalliti: number;
};
```

Le mutation manuali di pagamento rifiutano modifiche a record FiC. La mutation
di collegamento fattura salva prima `commessaId`, poi avvia riconciliazione e
archiviazione PDF. Errori successivi sono restituiti come stato parziale
ritentabile, senza fingere un rollback del collegamento gia persistito.

### 8.2 UI

Nella scheda commessa il registro mostra:

- badge `Manuale` o `FiC`;
- stato `Stornato` e motivo, mantenendo la riga visibile;
- riferimento alla fattura FiC;
- azioni modifica/rimozione soltanto per record manuali.

La pagina Economia usa esclusivamente il `commessaId` persistito e mostra:

- collegamento `Automatico` o `Manuale`;
- stato PDF `Da archiviare`, `Archiviato` o `Errore`;
- riepilogo del sync con tutti i contatori economici e documentali;
- comando di nuovo tentativo tramite il normale sync.

La vista resta densa, senza card annidate o scroll orizzontale globale, e usa
token semantici e helper euro gia presenti.

Ogni proposta `correzione_pagamento` mostra prima dell'approvazione un confronto
esplicito tra `Nel CRM ora` e `FiC propone`, con importo, data, stato ed effetto
sull'incassato (`invariato`, aumento o diminuzione). L'azione e denominata
`Applica correzione`; il server la blocca se la rata o il pagamento risultano
nel frattempo riconciliati altrove.

## 9. Errori, concorrenza e sicurezza

- Le chiavi FiC rendono ogni operazione idempotente anche dopo timeout o deploy.
- La finalizzazione delle rate scomparse avviene soltanto su fetch completo.
- Prima di salvare una correzione approvata, il server ricontrolla pagamento,
  commessa, sede e fingerprint dei valori di partenza.
- Un sync concorrente per la stessa sede resta vietato dal lock esistente.
- Nessun log contiene token, URL PDF firmati, payload cliente completi o byte dei
  documenti. Gli errori persistiti sono sanitizzati.
- Un errore su una fattura non blocca le altre; il risultato dichiara il parziale
  e il sync successivo converge.
- I record di origine FiC non possono essere modificati o cancellati dalle
  mutation manuali e non possono essere enumerati da un'altra sede.

## 10. Migrazione dei dati esistenti

1. Backfill dei metadati pagamento con default manuale/attivo.
2. Backfill di `RataFic.id`, `sourceKey` e stato PDF senza inventare id remoti.
3. Ricostruzione dei collegamenti legacy solo per corrispondenze univoche: nota
   FiC esplicita, oppure stesso importo/data, oppure stesso importo con data
   manuale nulla.
4. Nessuna rimozione automatica di pagamenti manuali o allegati.
5. Proposte pendenti duplicate o gia soddisfatte marcate `superata` con esito.
6. Casi ambigui lasciati visibili e trasformati in una singola proposta di
   correzione o collegamento.

Il backfill vive negli `onLoad` degli store coinvolti ed e idempotente. Dopo il
primo salvataggio non deve modificare nuovamente record gia migrati.

## 11. Verifica e criteri di accettazione

Test automatici mirati devono provare almeno:

1. due sync identici creano un solo pagamento e un solo allegato;
2. una rata con ID stabile aggiorna importo e data dello stesso record FiC;
3. un manuale con stesso importo e data nulla non viene duplicato e genera una
   sola proposta di correzione;
4. due manuali compatibili non vengono modificati e generano una sola ambiguita;
5. una rata `reversed`, `not_paid` o rimossa dopo snapshot completo resta in
   audit ma non alimenta l'incassato;
6. uno snapshot incompleto non storna rate scomparse;
7. un pagamento manuale non viene mai aggiornato dal sync;
8. una proposta Tars gia soddisfatta o duplicata diventa `superata`;
9. una proposta di correzione stale non sovrascrive dati nuovi;
10. il collegamento automatico richiede identita fiscale e commessa univoca;
11. il collegamento ambiguo non importa pagamenti e non allega il PDF;
12. collegamento manuale, spostamento e retry PDF convergono senza duplicati;
13. errori PDF lasciano valida la sincronizzazione economica;
14. ogni accesso fuori sede restituisce `NOT_FOUND`;
15. i record legacy ricevono default senza perdere importi o documenti.
16. una fattura con piu rate non riusa lo stesso pagamento manuale e il totale
    incassato coincide con la somma delle rate attive una sola volta;
17. una correzione stale non puo spostare una rata gia riconciliata ne riusare
    un pagamento collegato a un'altra rata.

Prima della consegna devono passare:

```bash
pnpm check
pnpm test
pnpm build
```

Le modifiche visuali vengono controllate a 1440x900 e 390x844, senza errori
console e senza scroll orizzontale globale. `handoff.md`, il PRD testuale e la
documentazione operativa di Tars vengono aggiornati preservando le modifiche
gia presenti nel worktree.

## 12. Fuori ambito

- Sincronizzazione dal CRM verso FiC.
- Modifica automatica del pattuito in base alle fatture.
- Importazione o riconciliazione dei movimenti bancari.
- Cancellazione fisica dei pagamenti storici.
- Allegati diversi dal PDF ufficiale della fattura emessa.
- Esecuzione autonoma di proposte Tars.
