# Economia FiC e obiettivo di pareggio mensile

**Data:** 25/08/2026  
**Stato:** approvato dall'utente  
**Ambito:** Contabilita, Pagamenti, Marginalita, sincronizzazione FiC e classificazione Tars

## 1. Obiettivo

Rendere coerenti e verificabili fatturato, pattuito, incassato, costi e margine,
eliminando il confronto attuale tra grandezze con perimetri temporali e basi
contabili differenti. Aggiungere nella pagina Pagamenti un obiettivo mensile che
indichi quanto fatturare, al netto IVA, per coprire i costi fissi aziendali.

Il disegno deve inoltre permettere una futura integrazione dei tre conti bancari
BPM, MPS e Intesa Sanpaolo senza cambiare nuovamente le formule economiche.

## 2. Problemi verificati

1. `economia.overview` confronta il fatturato FiC dell'anno selezionato con una
   fotografia all-time delle sole commesse attive.
2. I KPI CRM usano incassi e costi all-time, mentre l'andamento mensile usa i
   movimenti datati dell'anno, incluse commesse archiviate o senza pattuito.
3. Il fatturato FiC usa `amount_gross`, IVA inclusa, pur essendo etichettato
   genericamente come fatturato.
4. Le note di credito emesse non vengono sincronizzate e quindi non rettificano
   il fatturato.
5. I documenti non piu restituiti dall'API restano nello store. In produzione
   l'ultimo sync ha restituito 52 fatture, mentre il riepilogo ne contava 54.
6. I costi aggregati provengono dal registro manuale delle commesse e dalla posa
   stimata, non dai documenti ricevuti presenti in FiC.
7. Il blocco sulle commesse archiviate in `economia.overview` non modifica il
   flusso ed e quindi inefficace.

## 3. Decisioni contabili

### 3.1 Grandezze separate

- **Fatturato netto:** imponibile delle fatture emesse meno imponibile delle
  note di credito emesse, per data documento e periodo selezionato.
- **Fatturato lordo:** lordo delle fatture meno lordo delle note di credito,
  mostrato separatamente e mai usato come sinonimo di fatturato netto.
- **Incassato FiC:** somma delle rate `paid` delle fatture emesse; le rate delle
  note di credito riducono il valore con segno opposto. Nel confronto annuale
  e nell'andamento di cassa conta `dataPagamento`, non la data del documento.
  Le rate `paid` senza data restano fuori dal periodo e sono esposte come dato
  da completare. Stati diversi da `paid` non sono incassati.
- **Da incassare FiC:** somma delle rate effettivamente esigibili e non pagate;
  entrano soltanto gli stati che FiC documenta come non pagati. Stati diversi
  da `paid` e `not_paid` restano esclusi finche non sono mappati esplicitamente.
- **Costi effettivi netti:** imponibile dei documenti ricevuti `expense` meno
  imponibile dei documenti `passive_credit_note`.
- **Uscite pagate:** somma delle rate `paid` dei documenti ricevuti, distinta
  dai costi per competenza.
- **Pattuito:** importo contrattuale lordo memorizzato sulla commessa. Rimane un
  indicatore CRM delle commesse attive e non viene confrontato direttamente con
  il fatturato netto annuale.
- **Incassato CRM annuale:** somma dei pagamenti CRM datati nell'anno selezionato,
  comprese le commesse poi archiviate. I pagamenti senza data sono separati e
  non vengono assegnati artificialmente a un mese.
- **Fatture ignorate:** l'azione `Ignora` esclude soltanto dalla coda di
  riconciliazione. Un documento ancora presente in FiC continua ad alimentare i
  totali contabili e il punto di pareggio.
- **Costi commessa stimati legacy:** restano consultabili per continuita, ma non
  alimentano totali aziendali, punto di pareggio o margine effettivo. Sono
  sempre etichettati come stime e confrontati separatamente con i costi FiC.

### 3.2 Punto di pareggio

Il periodo base e una finestra mobile che termina nell'ultimo giorno del mese
precedente a quello osservato.

```text
fatturatoNetto12m = fattureNetto12m - noteCreditoNetto12m
costiVariabili12m = costi FiC classificati variabile_commessa
margineContribuzione =
  (fatturatoNetto12m - costiVariabili12m) / fatturatoNetto12m

costiFissiMensili = costi fissi netti degli ultimi 12 mesi / 12
obiettivoMensile = costiFissiMensili / margineContribuzione
fatturatoMese = fatture nette del mese - note di credito nette del mese
ancoraDaFatturare = max(0, obiettivoMensile - fatturatoMese)
```

Se `fatturatoNetto12m <= 0`, il margine e nullo/non valido o meno di tre mesi
contengono dati economici, l'obiettivo non viene inventato: la UI mostra
`Dati insufficienti` e indica quali dati mancano. Tra tre e undici mesi il
calcolo usa i mesi disponibili, espone affidabilita ridotta e non divide i
costi per dodici, ma per il numero di mesi coperti. Con dodici mesi completi
l'affidabilita puo essere alta.

I documenti classificati `dubbio` non entrano nel calcolo. La UI mostra il loro
numero e l'importo netto potenzialmente escluso.

## 4. Registro economico FiC

### 4.1 Store emessi

Lo store esistente `fic_fatture` diventa un mirror normalizzato dei documenti
emessi e mantiene la retrocompatibilita con i record correnti.

Campi nuovi o resi espliciti:

```ts
type DocumentoEmessoFic = {
  id: number;
  sedeId: number;
  tipo: "invoice" | "credit_note";
  data: string;
  importoNetto: number;
  importoIva: number;
  importoLordo: number;
  rate: RataFic[];
  presenteInFic: boolean;
  ultimoSyncId: string | null;
  ultimoVistoAt: Date | null;
  // campi di riconciliazione esistenti invariati
};
```

Il backfill assegna `tipo = "invoice"`, `presenteInFic = true`, lascia nulli i
metadati dell'ultimo sync fino alla prima sincronizzazione completa e conserva
tutti i collegamenti a cliente, commessa e documento PDF.

### 4.2 Store ricevuti

Nuovo store `fic_costi`:

```ts
type CostoFic = {
  id: number;
  sedeId: number;
  tipo: "expense" | "passive_credit_note";
  data: string;
  fornitoreId: number | null;
  fornitoreNome: string;
  categoriaFic: string | null;
  descrizione: string | null;
  centro: string | null;
  numeroDocumento: string | null;
  importoNetto: number;
  importoIva: number;
  importoLordo: number;
  rate: RataFic[];
  classificazione: ClassificazioneCosto;
  fonteClassificazione: "regola" | "tars" | "utente" | null;
  confidenza: number | null;
  motivazione: string | null;
  commessaId: number | null;
  presenteInFic: boolean;
  ultimoSyncId: string | null;
  ultimoVistoAt: Date | null;
};

type ClassificazioneCosto =
  | "fisso"
  | "variabile_commessa"
  | "straordinario"
  | "dubbio";
```

La chiave logica e `(sedeId, id)`. Nessun documento di un'altra sede puo
influenzare il calcolo o rivelare la propria esistenza.

### 4.3 Regole apprese

Nuovo store `fic_regole_costi`, sede-scoped:

```ts
type RegolaCostoFic = {
  id: number;
  sedeId: number;
  fornitoreNormalizzato: string | null;
  categoriaNormalizzata: string | null;
  classificazione: Exclude<ClassificazioneCosto, "dubbio">;
  createdBy: number;
  createdAt: Date;
  attiva: boolean;
};
```

Le regole esatte prevalgono su Tars. La correzione di una classificazione puo
salvare una regola solo dopo una scelta esplicita dell'operatore; una risposta
AI libera non diventa conoscenza aziendale da sola.

## 5. Sincronizzazione FiC

### 5.1 Scope OAuth

La nuova autorizzazione richiede almeno:

```text
entity.clients:r
issued_documents.invoices:r
issued_documents.credit_notes:r
received_documents:r
```

I token gia emessi non acquistano nuovi scope. Dopo il deploy ogni sede deve
ricollegare FiC una volta. La UI Integrazioni deve mostrare `Permessi economici
da aggiornare` finche il server non verifica i nuovi scope.

### 5.2 Finestra e paginazione

Ogni sync importa anno corrente e precedente. Questo copre la finestra mobile
di dodici mesi per il mese corrente e per ogni mese selezionabile dell'anno
corrente. Il primo rilascio non promette il break-even di anni precedenti. Le
chiamate usano filtri data lato FiC, paginazione completa e un limite difensivo;
se la paginazione non e completa il sync fallisce visibilmente e non marca
record come rimossi.

I flussi indipendenti sono:

1. fatture emesse;
2. note di credito emesse;
3. documenti ricevuti (`expense` e `passive_credit_note`).

### 5.3 Snapshot e record scomparsi

Ogni flusso riceve un `syncId`. Dopo una paginazione completa, i record del
periodo che non hanno quel `syncId` diventano `presenteInFic = false`. Non
vengono cancellati: collegamenti, PDF e audit restano disponibili. I record non
presenti sono esclusi da KPI, andamento, punto di pareggio e riconciliazioni
future.

Questo meccanismo elimina lo scostamento 52/54 senza distruggere documenti gia
collegati alle commesse.

### 5.4 Idempotenza ed errori

- Upsert per `(sedeId, id)` e tipo di collezione.
- Nessuna classificazione utente viene sovrascritta dal sync.
- Un errore nella classificazione Tars non invalida il mirror contabile.
- Un errore in uno dei tre flussi rende il sync economico incompleto e conserva
  lo snapshot precedente per quel flusso.
- L'esito espone conteggi letti, aggiornati, rimossi, dubbi e data coperta.

## 6. Classificazione Tars

### 6.1 Ordine decisionale

1. Regola esatta confermata per fornitore e/o categoria.
2. Classificazione Tars in lotto sui soli record nuovi o variati.
3. `dubbio` quando confidenza, ricorrenza o contesto non sono sufficienti.

Il prompt riceve soltanto metadati minimi: fornitore, categoria, descrizione,
centro, importi e ricorrenza aggregata. Non riceve PDF o payload completi se non
necessari. Il profilo ha un catalogo strumenti dedicato e un cache key stabile
per sede, versione del classificatore e insieme di categorie.

### 6.2 Significato delle classi

- `fisso`: costo operativo ricorrente non attribuibile a una singola commessa.
- `variabile_commessa`: costo che cresce con il lavoro venduto o e riferibile a
  una commessa.
- `straordinario`: investimento o costo non ricorrente da escludere dal normale
  punto di pareggio.
- `dubbio`: costo escluso dal calcolo finche non e revisionato.

La classificazione automatica e metadato analitico, sempre auditabile e
correggibile. Collegare un costo a una commessa resta una proposta approvabile,
coerente con il principio `Tars propone, non esegue`.

### 6.3 Collegamento alle commesse

Per `variabile_commessa`, Tars puo proporre il collegamento usando codice
commessa, cliente, centro FiC, descrizione, fornitore, periodo e importo. Una
proposta approvata valorizza `commessaId`. La marginalita della commessa usa:

1. costi FiC collegati e presenti;
2. posa stimata e costi manuali legacy in un confronto separato denominato
   `Stime CRM`, senza sommarli al margine effettivo.

Il margine effettivo non usa fallback manuali: se mancano costi FiC collegati,
viene segnalato come incompleto. La deduplica impedisce che ordine fornitore,
costo manuale e documento FiC siano presentati come tre costi effettivi. La
fonte viene mostrata accanto a ogni costo.

## 7. API applicative

Il router Economia espone almeno:

- `economia.overview({ anno })`: fatturato netto/lordo, note di credito,
  incassi, costi netti, uscite e copertura dati con perimetri omogenei;
- `economia.breakEven({ anno, mese })`: input limitato all'anno corrente,
  formula, affidabilita, documenti dubbi e risultato mensile;
- `economia.costiFic.list(...)`: elenco filtrabile dei documenti ricevuti;
- `economia.costiFic.riclassifica(...)`: correzione auditata e opzione per
  creare una regola;
- `economia.costiFic.regole.*`: CRUD riservato a direzione/amministrazione.

Tutte le route economiche richiedono direzione o amministrazione e applicano
`sedeId`. Gli altri ruoli ricevono `FORBIDDEN`; un id fuori sede produce
`NOT_FOUND`.

## 8. UI e UX

### 8.1 Contabilita

La Panoramica separa quattro bande senza card annidate:

1. **Controllo incassi:** incassato FiC e CRM dell'anno selezionato, scostamento
   `CRM - FiC` e importi senza data che riducono l'affidabilita del confronto.
2. **Vendite FiC:** fatturato netto, IVA, lordo, note di credito, incassato e
   scaduto del periodo selezionato.
3. **Acquisti FiC:** costi netti, IVA, lordo, uscite pagate e documenti dubbi.
4. **Portafoglio CRM attivo:** pattuito lordo, incassato, residuo e stime CRM
   all-time, visivamente separati e dichiarati non confrontabili con l'anno FiC.

Ogni KPI mostra base (`netto` o `lordo`), periodo e fonte. Il dettaglio mensile
usa esclusivamente grandezze dello stesso anno ed e separato in `Competenza`
(documenti per data documento) e `Cassa` (movimenti per data di pagamento).
Se il mirror FiC non contiene documenti emessi, il controllo mostra dati non
disponibili invece di dichiarare `0 = 0`; una differenza e allineata solo entro
50 centesimi. L'incompletezza dipende dai conteggi dei movimenti senza data,
non dalla loro somma netta. Anche i pagamenti degli acquisti senza data sono
mostrati e marcano la vista Cassa come incompleta.

### 8.2 Pagamenti

Sopra `Ultimi incassi` compare il pannello operativo **Copertura costi fissi**:

- mese osservato;
- obiettivo di fatturato netto;
- fatturato netto gia emesso;
- ancora da fatturare;
- costi fissi medi mensili;
- margine di contribuzione usato;
- barra di avanzamento stabile;
- badge di affidabilita alta, media o insufficiente;
- comando `Rivedi costi FiC` con contatore dei dubbi;
- espansione `Come viene calcolato` con finestra, formule e importi inclusi.

Il pannello non suggerisce che fatturare equivalga a incassare. Su viewport
sotto `md` i valori diventano righe verticali; la barra e i comandi mantengono
target touch di almeno 44 px e non introducono scroll orizzontale.

### 8.3 Revisione costi

La revisione usa una tabella desktop e righe compatte mobile. Mostra fornitore,
categoria FiC, descrizione, netto, data, classificazione, fonte e confidenza.
La correzione avviene con menu a scelta chiusa e checkbox separata `Ricorda per
questo fornitore/categoria`; nessuna regola viene creata implicitamente.

## 9. Preparazione integrazione bancaria

Il registro economico non incorpora movimenti bancari. Una futura integrazione
introduce un registro di cassa separato:

```ts
type MovimentoBancario = {
  id: string;
  sedeId: number;
  contoId: string;
  bookedAt: string;
  valueAt: string | null;
  importo: number;
  valuta: string;
  descrizione: string;
  saldoDopo: number | null;
  sourceRef: string;
};
```

Gli adapter BPM, MPS e Intesa Sanpaolo alimenteranno saldi e movimenti tramite
un provider Open Banking autorizzato. Tars potra proporre collegamenti tra
movimento, rata FiC, costo e commessa. Il movimento conferma il flusso di cassa
ma non modifica fatturato o costo di competenza.

L'integrazione bancaria non fa parte dell'implementazione corrente.

## 10. Migrazione e rollout

1. Aggiungere schema, backfill e funzioni pure senza cambiare la UI.
2. Ampliare OAuth e mostrare lo stato permessi.
3. Sincronizzare in shadow anno corrente e precedente.
4. Confrontare per almeno un sync completo conteggi e totali con FiC.
5. Attivare i nuovi KPI e il pannello Pagamenti.
6. Attivare classificazione Tars; i dubbi restano esclusi e visibili.
7. Attivare il margine effettivo da soli costi FiC dopo il controllo deduplica;
   mantenere le stime CRM in una vista separata.

Il vecchio registro costi non viene eliminato. Il rollback della UI puo tornare
ai calcoli precedenti senza perdere il mirror FiC o le classificazioni.

## 11. Test e criteri di accettazione

### 11.1 Test automatici

- Fattura e nota di credito rettificano netto e lordo con segno corretto.
- `expense` e `passive_credit_note` rettificano i costi con segno corretto.
- Solo le rate `paid` alimentano incassi/uscite e solo le `not_paid` alimentano
  crediti/debiti; ogni altro stato resta escluso.
- Le rate `paid` sono aggregate per `dataPagamento`; quelle senza data sono
  conteggiate a parte e non attribuite al mese del documento.
- I pagamenti CRM sono aggregati per data anche per commesse archiviate; quelli
  senza data restano separati.
- Una fattura ignorata resta nei totali FiC ma non nella riconciliazione.
- Snapshot completo marca come non presente un record scomparso; snapshot
  incompleto non lo fa.
- La produzione 52/54 viene riprodotta con fixture e corretta.
- Il break-even usa dodici mesi, mesi disponibili e casi insufficienti.
- Costi dubbi esclusi, importo potenziale riportato.
- Regola utente prevale su Tars e non attraversa le sedi.
- Costo FiC collegato non duplica costo manuale/ordine.
- Ruoli e `NOT_FOUND` fuori sede verificati.

### 11.2 Verifica UI

- Contabilita e Pagamenti a 1440x900, 1279x800 e 390x844.
- Nessuno scroll orizzontale globale.
- Formula e periodo raggiungibili da tastiera.
- Stati caricamento, FiC non autorizzato, sync incompleto, dati insufficienti e
  nessun dubbio hanno testi espliciti.
- Il numero mostrato in `Ancora da fatturare` coincide con la funzione pura
  verificata dai test.

### 11.3 Verifica produzione

- Ricollegare FiC con i nuovi scope per ogni sede.
- Eseguire `Sincronizza ora` e confrontare conteggio fatture, note di credito e
  documenti ricevuti con FiC.
- Confrontare fatturato netto, lordo, costi netti e rate pagate su almeno due
  mesi chiusi e sul mese corrente.
- Revisionare tutti i costi `dubbio` prima di considerare affidabile il primo
  obiettivo mensile.

## 12. Fuori ambito

- Scritture contabili verso FiC.
- Registrazione automatica di pagamenti o costi sulle commesse.
- Accesso diretto alle credenziali di home banking.
- Integrazione BPM, MPS e Intesa Sanpaolo in questa fase.
- Previsioni fiscali, IVA da versare o consulenza contabile.
