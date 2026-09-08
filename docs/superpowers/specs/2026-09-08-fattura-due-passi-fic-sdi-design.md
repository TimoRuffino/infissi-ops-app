# Fattura in due passi: «Invia a Fatture in Cloud» e «Invia allo SdI» (spec tecnica)

**Data:** 08/09/2026 · **Stato:** design approvato in chat dalla direzione
(quattro decisioni, §2); non implementato · **Spec madre:**
`docs/superpowers/specs/2026-09-03-limiti-e-fatturazione-design.md` (§7,
emissione) · **Precedente:**
`docs/superpowers/specs/2026-09-05-fatturazione-guidata-design.md` ·
**PRD:** §56 (fatturazione), da aggiornare · **Ruling nuovi:** R43–R49.

> Oggi «Emetti» fa tutto in un colpo: crea il documento su Fatture in Cloud
> e nello stesso giro lo spedisce allo SdI. Da qui in poi sono due gesti
> distinti, e in mezzo c'è la finestra di dodici giorni che la legge
> concede: si guarda la fattura, la si corregge — dal CRM o da Fatture in
> Cloud, indifferentemente — e solo dopo si spedisce. Il CRM conta i giorni
> e viene a cercarti quando stanno per finire.

## 1. Obiettivo, perimetro, non-obiettivi

**Obiettivo.** Spezzare la pipeline di emissione in due azioni con due
pulsanti, rendere correggibile la fattura finché non è partita, e non
lasciare che la finestra dei dodici giorni scada senza che nessuno se ne
accorga.

**Entra.**
- Due gesti distinti: «Invia a Fatture in Cloud» (bozza → `emessa`) e
  «Invia allo SdI» (`emessa` → `inviata`) — §4.
- Fattura correggibile mentre è su FiC e non è partita, con le correzioni
  che viaggiano nei due sensi da sole: dal CRM verso FiC al salvataggio,
  da FiC verso il CRM alla rilettura — §5.
- Contatore dei giorni residui, ancorato alla data del documento — §6.
- L'allarme che insegue: notifiche, colonna in Cassa, riga nel fascicolo
  Tars — §7.
- Blocco dell'invio quando i totali nostri e quelli di FiC divergono, con
  scavalco dichiarato — §8.
- `FATTURAZIONE_SDI_DRY_RUN` cambia mestiere: rende finto il secondo
  click, non più il primo — §9.

**Resta fuori.**
- Modifica della fattura dopo l'invio allo SdI: resta la nota di credito.
- Cancellazione del documento su FiC (`DELETE`): buca la numerazione
  progressiva, scelta esclusa in chat.
- Rimappatura delle righe lette da FiC sui nostri tipi (bene, servizio,
  markup, storno): §5.3 spiega perché non si fa.
- Fatturazione differita e il suo termine diverso (il 15 del mese
  successivo): questa spec copre la fattura immediata, che è quello che
  il CRM genera oggi.
- Invio massivo di più fatture allo SdI da una vista di lavoro: la
  decisione in chat è stata «A», un operatore per volta dalla commessa.

**Non-obiettivo esplicito.** Nessuna sincronizzazione simmetrica con
fusione automatica dei contenuti. Le due direzioni sono asimmetriche e
governate da un lock ottimistico (§5.2): al primo dubbio il CRM si ferma
e chiede di rileggere, non indovina.

## 2. Le decisioni prese in chat

1. **Chi preme il secondo pulsante: opzione A.** Lo stesso operatore, dal
   CRM, subito dopo il primo. Nessuna capability nuova: entrambi i gesti
   restano sotto `fattura.emit`. Nessuna vista di lavoro a lista per la
   commercialista.
2. **Correzioni: «sia A che B, automatico».** Si può correggere sia dal
   CRM sia da Fatture in Cloud, e il riallineamento non richiede un
   pulsante: al salvataggio nel CRM la modifica sale su FiC; una modifica
   fatta su FiC il CRM se la va a prendere.
3. **Scadenza: «allarme che ti insegue», senza blocco.** Il badge cambia
   colore, e la fattura in scadenza si fa vedere anche fuori dalla tab
   della commessa. Oltre i dodici giorni l'invio resta possibile: la legge
   non lo vieta, prevede una sanzione. Bloccarlo sarebbe un danno in più.
4. **Dry-run: opzione (2), assunta e non contraddetta.** Il flag resta e
   rende finto solo l'invio allo SdI. La colonna `inviata_dry_run` non si
   tocca (CLAUDE.md: i residui di compatibilità non si rimuovono senza
   decisione registrata e matrice campo→consumer).

**Rimasta senza risposta:** quante fatture ci siano in produzione ferme in
`emessa` con `inviata_dry_run = true`, e se siano prove o fatture vere. Il
piano parte da lì con un controllo in sola lettura (§11.1) e non accende
il pulsante nuovo su quelle finché la direzione non decide.

## 3. Come funziona oggi

Una sola mutation, `fatture.emetti`
([server/routers/fatture.ts:338](../../../server/routers/fatture.ts)), che
esegue `emettiFattura`
([server/fatture/emissione.ts:381](../../../server/fatture/emissione.ts)):
nove passi in fila, ciascuno idempotente per stato.

| # | passo | effetto |
|---|---|---|
| 1 | validazione + lease (compare-and-swap su stato e revisione) | `bozza` → `in_emissione` |
| 2 | cliente su FiC (cerca o crea) | scrive `ficEntityId` nello snapshot |
| 2b | anti-doppione: 120 giorni, stesso cliente, ±1 € | può fermare tutto |
| 3 | `POST /issued_documents` | `ficDocumentId`, `numero`, `data`; **FiC numera qui** |
| 4 | confronto totali nostri ↔ FiC, tolleranza 1 cent | → `emessa` |
| 5 | `xml_verify` | può fermare tutto |
| 6 | `e_invoice/send` con `dry_run` | → `inviata`, oppure `inviataDryRun` |
| 7-8 | scarica e archivia XML e PDF, documento nel fascicolo | — |
| 9 | allineamento della timeline del board | — |

Poi la sonda (`server/fatture/sonda.ts`), ogni quindici minuti in un solo
processo, legge `ei_status` da FiC e porta la fattura a `consegnata`,
`scartata`, `rifiutata` o `mancata_consegna`. Non ritenta mai l'invio.

**Tre cose che questo design sfrutta.**

- **L'API di FiC è già due chiamate.** `POST /issued_documents` e
  `POST /issued_documents/{id}/e_invoice/send` sono separate
  ([server/fic/emissione.ts:356](../../../server/fic/emissione.ts)): oggi
  è il CRM a incatenarle. Separarle non chiede niente di nuovo a FiC.
- **L'UI modella già i due momenti.** Il percorso della fattura ha un
  passo «Emissione» e un passo «SdI» distinti
  ([client/src/lib/fatturaView.ts:468](../../../client/src/lib/fatturaView.ts)),
  e il passo SdI su una fattura `emessa` non in prova dice già «In attesa
  dell'invio». Manca solo il gesto che lo compia.
- **`modifyIssuedDocument` esiste** (`PUT /c/{company}/issued_documents/{id}`)
  e il modello `IssuedDocument` porta `updated_at`. Senza il secondo, la
  sincronizzazione nei due sensi non sarebbe governabile.

**Due difetti che il design chiude per costruzione.**

- Se `xml_verify` o `e_invoice/send` falliscono, la pipeline esce
  lasciando la fattura in `emessa`, e la vista non offre più nulla:
  «Riprendi emissione» compare solo per `in_emissione`
  ([client/src/components/fattura/FatturaEmessaView.tsx:241](../../../client/src/components/fattura/FatturaEmessaView.tsx)).
  Vicolo cieco.
- Le fatture emesse in prova (dry-run) sono nello stesso vicolo: nessun
  gesto dell'interfaccia le manda allo SdI.

## 4. I due gesti

### 4.1 La macchina degli stati non cambia

Nessuno stato nuovo, nessuna modifica al `CHECK` di `fatture.stato`.
Cambia il **significato** di `emessa`, che oggi è di passaggio e diventa
un posto dove una fattura sta per giorni:

- `bozza` → `in_emissione` → **`emessa`** = sta su Fatture in Cloud, ha
  numero e data, non è partita.
- **`emessa`** → `inviata` → `consegnata` / `scartata` / `rifiutata` /
  `mancata_consegna`.

**R43.** `emessa` significa «su FiC, non spedita». È lo stato in cui la
fattura è correggibile e in cui corre il contatore dei dodici giorni.

### 4.2 Passo 1 — «Invia a Fatture in Cloud»

`creaSuFic()`: passi 1, 2, 2b, 3, 4, 5, 7 e 9 di §3. Stato d'arrivo
`emessa`. Il passo 6 non c'è. L'archivio (7) si fa qui — servono PDF e XML
per poterli guardare durante la finestra — ma il **documento nel fascicolo
(8) no**: si crea solo all'invio riuscito (§4.4, R45).

`xml_verify` resta in questo passo anche se non si spedisce: costa una GET
senza effetti e dice subito se l'XML è malformato, invece di scoprirlo
dodici giorni dopo.

Il pulsante nella `BozzaFatturaEditor` cambia etichetta da «Emetti» a
«Invia a Fatture in Cloud», e il dialogo di conferma perde il ramo
dry-run: dice che il documento sarà numerato da FiC e **non** spedito.

### 4.3 Passo 2 — «Invia allo SdI»

`inviaAlloSdi()`, nuova mutation `fatture.inviaSdi`, capability
`fattura.emit`, interruttore `limiti` come le altre. Parte solo da
`emessa` con `ficDocumentId` valorizzato. In ordine:

1. **rilettura** del documento da FiC (`leggiDocumento`): aggiorna
   `eiStatusFic` e `ficUpdatedAt`;
2. **confronto totali** contro i nostri — se divergono, si ferma (§8);
3. **`xml_verify`** — obbligatoria, perché il documento può essere
   cambiato dopo il passo 1;
4. **`e_invoice/send`** con `dry_run` secondo §9 → `inviata`;
5. **archivio** XML e PDF (riscaricati se invalidati, §5.4) e
   **documento nel fascicolo**;
6. allineamento della timeline.

Il lease di R35 vale anche qui: compare-and-swap su stato e revisione
prima di toccare FiC, così due click sovrapposti non spediscono due volte.

**R44.** `fatture.emetti` conserva il nome ma cambia significato: si ferma
a `emessa` e non spedisce più. Effetto collaterale desiderato: un bundle
vecchio rimasto nella cache di un browser non può più mandare niente allo
SdI per sbaglio.

### 4.4 Il documento nel fascicolo si crea all'invio

**R45.** Il passo 8 (documento della commessa) si sposta dal primo gesto
al secondo. Il fascicolo contiene la fattura definitiva, non una versione
che nei dodici giorni può ancora cambiare. Il PDF resta comunque
scaricabile dalla tab Fattura durante tutta la finestra.

### 4.5 Riprese e vicoli ciechi

`STATI_DI_PARTENZA` di `creaSuFic` resta `bozza`, `in_emissione`, `emessa`
(per riprendere un archivio mancante). `inviaAlloSdi` parte da `emessa` e
da `inviata` (ripresa di un archivio mancante dopo un invio riuscito).
«Riprendi emissione» in `FatturaEmessaView` si estende a `emessa`: il
vicolo cieco di §3 sparisce.

## 5. Correzioni nella finestra

### 5.1 Quando una fattura è correggibile

`fatturaModificabile` smette di essere una funzione del solo stato e
diventa una funzione del record:

```ts
const EI_NON_PARTITA = new Set(["", "not_sent", "missing"]);

export function fatturaModificabile(f: {
  stato: StatoFattura;
  eiStatusFic: string | null;
}): boolean {
  if (f.stato === "bozza") return true;
  if (f.stato !== "emessa") return false;
  return EI_NON_PARTITA.has(f.eiStatusFic ?? "");
}
```

Consumatori da adeguare: `bozzaModificabile`
([server/fatture/servizio.ts:143](../../../server/fatture/servizio.ts)) e i
quattro rami su `stato === "bozza"` di `FatturaTab`. `STATI_MODIFICABILI`
sparisce come insieme di stati: non basta più lo stato a decidere.

**R46.** L'invariante «immutabile da `in_emissione` in poi» del PRD §56
diventa «immutabile da `inviata` in poi». È un contratto del PRD che
cambia, non un dettaglio: va scritto lì prima di chiudere il lavoro.

### 5.2 CRM → FiC, al salvataggio, con lock ottimistico

Nuova colonna `fatture.fic_updated_at TIMESTAMPTZ` (`ficUpdatedAt` nel
tipo), scritta dalla creazione, da ogni nostro `PUT` e da ogni rilettura.
È l'orologio di FiC, non il nostro.

`aggiornaBozza` su una fattura `emessa` esegue, **in quest'ordine**:

1. calcola le righe nuove come fa oggi (nessun cambiamento);
2. rilegge il documento da FiC e confronta `updated_at` con
   `ficUpdatedAt`. Se differiscono → `CONFLITTO_FIC: la fattura è
   cambiata su Fatture in Cloud, rileggi prima di salvare`. Niente si
   scrive, né qui né là;
3. `PUT /issued_documents/{id}` con lo stesso corpo che costruirebbe
   `costruisciDocumentoFic`, stesso numero e stessa data;
4. **solo ora** committa nel CRM, con il `revisioneAttesa` di sempre, e
   scrive il nuovo `ficUpdatedAt`;
5. invalida `xmlStorageKey`, `xmlSha256`, `pdfStorageKey` (§5.4);
6. evento `aggiornata_fic`.

**R47.** Si scrive su FiC **prima** di committare nel CRM. Se il `PUT`
fallisce non cambia niente da nessuna parte. Se invece fallisce il commit
del CRM dopo un `PUT` riuscito (revisione bruciata da un'altra sessione),
la divergenza esiste per qualche minuto ed è **auto-riparante**: la
rilettura di §5.3 la vede come una modifica esterna e la porta a galla.

`aggiornaBozza` riceve il client FiC come dipendenza iniettata, nello
stile di `DipendenzeEmissione`; nei test si passa il finto e non parte
nessuna chiamata.

### 5.3 FiC → CRM, da sola, e perché non sovrascrive le righe

La sonda si estende alle fatture `emessa` con `ficDocumentId` valorizzato
e `ei_status` non finale — oggi `daSondare`
([server/fatture/repository.ts:302](../../../server/fatture/repository.ts))
prende solo `inviata` e le prove dry-run. Lo stesso controllo gira
all'apertura della tab, così non si aspetta il quarto d'ora.

Se `updated_at` di FiC è più recente di `ficUpdatedAt`:

- evento `modificata_fic` con la data e i totali nuovi;
- si rifà il **confronto totali** e l'esito finisce in `eiErrore`;
- si invalidano XML e PDF archiviati (§5.4);
- la tab mostra «Modificata su Fatture in Cloud il …» con i totali di là
  accanto ai nostri.

**R48.** La rilettura da FiC **non sovrascrive le nostre righe**.
`leggiRigheDocumento` restituisce le righe come le vede FiC, senza il
nostro `tipo` (`bene`, `servizio`, `markup`, `storno_bs`,
`riaddebito_bs`): rimapparle a occhio distruggerebbe l'informazione su cui
poggiano il computo dei limiti e il margine. Le nostre righe restano il
documento del *perché*; FiC resta il documento del *cosa esce*; lo
scostamento si mostra invece di essere assorbito.

Conseguenza da dire in chiaro all'operatore: una modifica fatta su Fatture
in Cloud **non aggiorna** la verifica dei limiti. Il pannello lo dichiara.

### 5.4 Archivio invalidato

Ogni modifica (nostra o esterna) azzera `xmlStorageKey`, `xmlSha256` e
`pdfStorageKey`. `archiviaFattura` già riscarica solo ciò che manca:
azzerare basta. I blob vecchi restano nello storage, orfani — debito
accettato, non un guasto: costano poco e conservano la traccia di cosa
c'era prima.

## 6. Il contatore dei dodici giorni

Funzione pura in `shared/fatturazione/scadenzaSdi.ts`, usata identica da
server e client:

```ts
export const GIORNI_INVIO_SDI = 12;

/** Giorni di calendario Europe/Rome che restano; 0 = ultimo giorno utile, negativo = in ritardo. */
export function giorniPerInvioSdi(dataDocumento: string, oggi: Date): number;
```

**Ancoraggio:** `fattura.data` + 12. È la data del documento, scritta con
la risposta di FiC alla creazione
([server/fatture/emissione.ts:636](../../../server/fatture/emissione.ts)),
ed è la data che finisce nell'XML. Il cronometro parte quindi al **primo**
gesto, non al secondo.

**Fuso:** giorni di calendario Europe/Rome, con la stessa aritmetica di
`giornoAssoluto` in `client/src/lib/tarsView.ts` e per lo stesso motivo per
cui `iso()` in emissione usa il fuso italiano: a mezzanotte e mezza l'UTC
è ancora il giorno prima e il conteggio sbaglierebbe di uno.

**Toni:** neutro sopra i 3 giorni, ambra da 3 a 1, rosso a 0, rosso con
«Scaduta da N giorni» sotto zero. Testo: «11 giorni per l'invio allo SdI».

Il contatore si mostra: nel passo «SdI» del percorso, accanto al pulsante
in `FatturaEmessaView`, nella colonna nuova della sezione Cassa (§7.2) e
nel corpo della notifica (§7.1).

## 7. L'allarme che ti insegue

### 7.1 Notifiche

Il sistema c'è già per intero — repository, projector, SSE, delivery
worker, push, campanella e pagina Notifiche (`server/notifications/`) — ma
il projector è guidato dagli eventi
([server/notifications/projector.ts:42](../../../server/notifications/projector.ts)),
e lo scadere di giorni non è un evento. Serve una cadenza: si innesta sul
giro della sonda, che gira già ogni quindici minuti per tenant e sede.

- **Destinatario:** `fattura.emessaDa`, chi ha premuto il primo pulsante.
  È il suo lavoro da finire, non quello di tutti quelli con
  `fattura.emit`.
- **Quando:** quando il contatore vale esattamente 7, 3 o 1, e poi **ogni
  giorno** da 0 in giù.
- **Deduplica:** `canonicalKey = fattura-sdi:<fatturaId>:<yyyy-mm-dd>`, in
  fuso italiano. Il giro ogni quindici minuti produce comunque **una**
  notifica al giorno per fattura.
- **Priorità:** `high` sopra lo zero, `critical` da zero in giù.
- **Titolo/corpo:** «Fattura 128/2026 da mandare allo SdI» · «Restano 3
  giorni. Aprila per controllarla e spedirla.»
- **Link:** la tab Fattura della commessa.

### 7.2 Cassa

Nella sezione «Fatture emesse dal CRM»
(`client/src/components/fattura/FattureEmesseSezione.tsx`): una voce
«Da inviare allo SdI» nel filtro di stato, e una colonna «Giorni SdI» con
lo stesso badge di §6. `fatture.lista` accetta già un filtro di stati; il
filtro nuovo è `emessa` + non partita, quindi va nel server e non nel
client, altrimenti il tetto di 50 conterebbe le righe sbagliate.

### 7.3 Fascicolo Tars

`server/tars/fascicoli.ts:89` accoda già «· prova SdI» alla riga della
fattura. Si aggiunge «· N giorni per lo SdI» con la stessa regola di
sempre: **mai un importo**, mai l'errore SdI parola per parola.

## 8. Scostamento e blocco all'invio

Al passo 2 di §4.3, se il confronto totali diverge oltre il cent di
tolleranza, `inviaAlloSdi` si ferma con
`SCOSTAMENTO_FIC: i totali su Fatture in Cloud non corrispondono
(nostro € X, FiC € Y)`. La vista offre **«Invia comunque»**, nello stile
del già esistente «Emetti comunque» dell'anti-doppione: richiede la
capability `fattura.emit` e un motivo, e scrive l'evento
`scavalco_scostamento` con i due totali.

**R49.** Lo scostamento blocca l'invio, non la creazione. È l'invio l'atto
irreversibile; fermare la creazione lascerebbe l'operatore senza il
documento da guardare, che è il motivo per cui la finestra esiste.

## 9. Dry-run

`sdiDryRun()` resta e vale **solo** per `inviaAlloSdi`: il primo gesto non
lo consulta più (non spedisce niente, non ha nulla da simulare). Con il
flag acceso il secondo click chiama `e_invoice/send` con `dry_run: true`,
scrive `inviataDryRun` e lascia lo stato a `emessa`, come oggi. Serve una
sede di collaudo dove provare il giro intero senza spedire.

I badge «Emessa (prova SdI)» e «Invio SdI in prova» restano dove sono. La
colonna `inviata_dry_run` non si tocca.

## 10. Dati

Una colonna sola, additiva, con il pattern già usato da `origine` e
`markup_forzato_cent` nel bootstrap del repository:

```sql
ALTER TABLE fatture ADD COLUMN IF NOT EXISTS fic_updated_at TIMESTAMPTZ;
```

`fattura_eventi.tipo` non ha vincolo `CHECK`: i tipi nuovi
(`aggiornata_fic`, `modificata_fic`, `scavalco_scostamento`) si aggiungono
a `TIPI_EVENTO` in `shared/fatturazione/tipi.ts` senza migrazione.

Le fatture già esistenti nascono con `fic_updated_at` a `NULL`: la prima
rilettura lo riempie, e finché è nullo il lock di §5.2 non blocca nulla —
si comporta come «non so, quindi rileggo».

## 11. Ordine dei lavori

1. **Prima di tutto, in sola lettura:** contare le fatture in produzione
   ferme in `emessa` con `inviata_dry_run = true`, e portarle alla
   direzione. Il pulsante «Invia allo SdI» non si accende su di loro
   finché non è deciso caso per caso se sono prove (da annullare o
   stornare) o fatture vere (da spedire).
2. Client FiC: `modificaDocumento` (`PUT`) e `updated_at` nel modello.
3. Colonna `fic_updated_at`, tipo, repository.
4. Scissione di `emettiFattura` in `creaSuFic` e `inviaAlloSdi`, con i
   passi condivisi estratti.
5. Mutation `fatture.inviaSdi`, e `fatture.emetti` che si ferma a `emessa`.
6. Modificabilità in finestra (§5.1, §5.2) e rilettura automatica (§5.3).
7. Contatore (§6) e sua comparsa nel percorso e nella vista emessa.
8. Notifiche (§7.1), Cassa (§7.2), fascicolo Tars (§7.3).
9. Scostamento e «Invia comunque» (§8).
10. PRD §56 e `handoff.md`: invariante di §5.1, R43–R49, runbook nuovo.

## 12. Test di accettazione

- Premere «Invia a Fatture in Cloud» crea il documento e **non** chiama
  mai `inviaEInvoice`: il registro del client finto non lo contiene.
- Da `emessa`, «Invia allo SdI» chiama `inviaEInvoice` una volta sola e
  porta a `inviata`.
- Due «Invia allo SdI» sovrapposti: il secondo prende `CONFLITTO` prima di
  toccare FiC.
- Salvare una modifica su una fattura `emessa` chiama il `PUT` **prima**
  di scrivere nel CRM; se il `PUT` fallisce, righe e totali nel CRM sono
  quelli di prima.
- `updated_at` di FiC diverso dal nostro al salvataggio → `CONFLITTO_FIC`,
  e nessuna scrittura da nessuna parte.
- Una modifica esterna su FiC produce l'evento `modificata_fic`, invalida
  XML e PDF, e **non** cambia le nostre righe.
- Totali divergenti → `inviaAlloSdi` si ferma; con «Invia comunque» e un
  motivo parte e scrive `scavalco_scostamento`.
- `giorniPerInvioSdi` con `data` a ieri e `oggi` alle 00:30 italiane
  restituisce 11, non 12 (fuso).
- La notifica è una sola al giorno per fattura anche facendo girare la
  sonda quattro volte nella stessa ora.
- Fattura `inviata`: non modificabile, `FATTURA_IMMUTABILE`.
- Sede diversa: `NOT_FOUND` su `fatture.inviaSdi`, senza rivelare l'id.

## 13. Rischi

- **Il PRD cambia un invariante** (§5.1, R46). Va scritto lì, non solo
  qui, o la prossima persona leggerà il contrario di quello che il codice
  fa.
- **Più chiamate a FiC.** La sonda copre anche le fatture non spedite: una
  `leggiDocumento` per fattura aperta ogni quindici minuti. Con l'ordine
  di grandezza attuale è irrilevante; con cento fatture aperte va messo un
  tetto.
- **La finestra invita a lasciare lì le fatture.** L'allarme è tutto ciò
  che lo impedisce, e non blocca niente: è una scelta (§2.3), non una
  dimenticanza.
- **La verifica dei limiti non segue le modifiche fatte su FiC** (R48).
  Dichiararlo nel pannello non lo risolve; risolverlo davvero vorrebbe
  dire rimappare le righe, che è espressamente fuori perimetro.
