# Fornitori per azienda e profili di lettura delle conferme (spec tecnica)

Nasce il 10/09/2026 dal mandato della direzione: «ogni azienda potrebbe avere
fornitori diversi, implementa uno spazio nel gestionale in cui modificare i
propri fornitori e caricare degli esempi di conf ordine così che il modello
possa allenarsi su ogni azienda diversamente e Tars diventi sempre più
intelligente e allenato a livello globale».

Segue la spec `2026-09-10-gestione-ordini-design.md` e ne rimuove un debito:
quella spec (e la PR #17 che la implementa in parte) poggia su una lista di
fornitori **cablata nel prodotto**.

Base: `main` a `5908750`. Branch `claude/analisi-gestione-ordini-b0892f`.

## 1. Obiettivo, perimetro, non-obiettivi

**Obiettivo.** Tre cose, in quest'ordine: ogni azienda ha i **suoi** fornitori
e li gestisce da sola; da un **esempio corretto a mano** nasce il profilo di
lettura di quel fornitore, che rende migliori tutte le conferme successive; e
la **forma** di quel profilo — priva di ogni valore — diventa patrimonio del
prodotto, così la decima azienda che riceve un modulo già visto non riparte da
zero.

**Perimetro.**
- L'anagrafica `fornitori` (già per azienda, oggi **vuota**) diventa la fonte
  di verità, con le chiavi di riconoscimento, il canale e i portali.
- Una pagina per gestirli.
- Il caricamento di esempi di conferma su un fornitore, la correzione di
  quello che la lettura ha sbagliato, e il **profilo** che ne nasce.
- Il **catalogo comune delle forme**, indicizzato sull'impronta del layout, con
  promozione automatica e una guardia che impedisce a un valore di viaggiare.

**Non-obiettivi (dichiarati, non dimenticati).**
- **Allenare un modello.** Non c'è nessun modello che estrae i campi:
  `server/documenti/estrazioneConferma.ts` è deterministico, con evidenza
  obbligatoria per ogni valore. Questa spec non ne introduce uno e non fa
  fine-tuning. Il modello resta dov'è: a **trascrivere** le scansioni
  (`letturaVisiva`), da pixel a testo, senza decidere che cosa sia un numero
  d'ordine.
- **Gli esempi come contesto al modello a ogni lettura** (l'approccio «C»
  discusso in chat): scartato. Rimetterebbe il modello a decidere i campi
  proprio nel punto che genera il costo fornitore del margine, e perderebbe la
  spiegabilità che oggi c'è.
- **Condividere documenti fra aziende.** Mai. Viaggia la forma, non il foglio
  (§6.3).
- **Toccare il comportamento attuale dell'estrattore quando nessun profilo
  combacia.** A profilo assente si legge esattamente come oggi.
- **La partita d'ordine** (spec ordini §4–§7): resta il suo piano, indipendente.
- **La riga nei termini** (§6.4): il testo legale non vive in questo
  repository. È un'azione esterna, dichiarata, non eseguita qui.

## 2. Il difetto misurato

`shared/fornitori.ts` è una **costante compilata** con i 25 fornitori della
Ruffino Group — Alias, Pail, Oskura, Primed, Fivizzanese… — e la leggono dieci
moduli:

| Modulo | Che cosa ne fa |
|---|---|
| `server/fornitori/archivio.ts` | riconosce il fornitore di una mail, indicizza l'archivio |
| `server/commesse/costoDaConferma.ts` | normalizza il fornitore che finisce sul costo |
| `server/_core/costiRicorrenti.ts` | riconosce i costi che tornano |
| `server/comunicazioni/comunicazioni.ts` | il pre-filtro della posta (PR #17) |
| `server/tars/documenti/confermeMancanti.ts` | «il mittente è un fornitore noto» (PR #17) |
| `client/src/pages/Magazzino.tsx` | il menu dei fornitori nei filtri |
| + `proposte.ts`, `commesse.ts`, `analisiDocumenti.ts` | lettura del nome |

Conseguenza in produzione **oggi**: l'azienda 2 («hvuv», creata il 09/09 e
viva) eredita i fornitori della Ruffino e non può avere i suoi. E l'anagrafica
`fornitori`, che **esiste già come store per azienda** (`tenant:<id>:fornitori`),
ha **zero righe**: il posto giusto c'è e non ci abita nessuno.

La PR #17 peggiora il debito: `PORTALI` e `SORGENTE_MITTENTE_FORNITORE` sono
costruiti sopra la stessa costante. È giusto per il tenant 1 e sbagliato per il
prodotto — v. §11 per la sequenza.

## 3. Decisioni della direzione (10/09/2026)

- **D1 — Il profilo nasce dalla correzione, non dall'annotazione.** Si carica
  l'esempio, il CRM mostra che cosa ha capito, la persona corregge solo ciò che
  è sbagliato. Il profilo è il sottoprodotto di quella correzione.
- **D2 — La forma viaggia, il documento no.** Il profilo resta dell'azienda; la
  sua forma, priva di valori, entra nel catalogo del prodotto.
- **D3 — La promozione è automatica.** Nessuna curatela a mano: un profilo che
  si dimostra buono viene promosso da solo.
- **D4 — Dichiarata, con una riga nei termini.** «Wyndoor migliora la lettura
  dei documenti imparando la forma dei moduli dei fornitori; i vostri documenti
  e i vostri dati non escono dalla vostra azienda.» Nessun consenso da
  raccogliere, nessun interruttore per azienda, nessuna schermata in più.
  Sostituisce la richiesta iniziale di non dirlo: la frase che si voleva
  evitare («usiamo le vostre conferme per allenare il modello») non è vera
  sotto questo disegno, e quella vera è difendibile.
- **D5 — I 25 cablati restano della Ruffino.** Diventano il seed una tantum
  dell'anagrafica del tenant 1, non un catalogo comune di fornitori. Il
  catalogo comune contiene **forme**, non fornitori.
- **D6 — Ancore per i campi, geometria per le righe.** Le ancore testuali
  risolvono numero, data e imponibile e non si rompono; i guasti veri
  (le colonne Alias incollate al contrario, «giovedì 25 giugno 2026» letto come
  quantità 808, otto pezzi di una porta sola diventati otto consegne) sono
  tutti nel blocco delle righe, e lì serve la geometria.

## 4. Piano 1 — i fornitori sono dell'azienda

### 4.1 Il modello

`fornitori` resta lo store per azienda che è già. Campi **nuovi**, tutti con
backfill in `onLoad`:

| Campo | Tipo | Significato |
|---|---|---|
| `chiavi` | `string[]` | Le parole e i domini che lo identificano — è la parte che oggi vive in `FORNITORI_NOTI`. |
| `canale` | `"mail" \| "portale" \| "altro"` | Come gli si ordina (spec ordini §3, D-E). |
| `portaleDomini` | `string[]` | I domini del portale con cui si ordina da lui: `antenore.biz` per Wnd. Un portale non è un fornitore, è un canale. |

E una modifica: **`partitaIva` diventa facoltativa.** Per riconoscere il
mittente di una conferma la partita IVA non serve, e obbligarla oggi impedisce
di censire un fornitore in trenta secondi.

### 4.2 Le funzioni pure smettono di leggere una costante

`fornitoreNoto` e `normalizzaFornitore` sono già pure: leggono `FORNITORI_NOTI`
da modulo. Diventano funzioni di un **riconoscitore costruito dall'elenco**:

```ts
export type FornitoreRiconoscibile = {
  nome: string;
  chiavi: readonly string[];
  /** Quando questa voce è un portale: il fornitore a cui riconduce. */
  portaleDi?: string | null;
};

export type Riconoscitore = {
  /** Il nome aziendale che il testo (o il dominio della mail) nomina. */
  nome(testo: string | null | undefined, email?: string | null): string | null;
  /** Il nome con cui registrare un fornitore letto da un documento. */
  normalizza(testo: string | null | undefined, email?: string | null): string | null;
  /** La sorgente del pattern per i pre-filtri (memoria e SQL). */
  sorgenteMittenti(): string;
};

export function riconoscitoreFornitori(
  elenco: readonly FornitoreRiconoscibile[]
): Riconoscitore;
```

Chi chiama costruisce il riconoscitore **una volta per giro o per richiesta**
dai fornitori della sede, e lo passa in giro. Il punto delicato è il pre-filtro
di `listComunicazioniConAllegatiCandidati`: la query è già per sede
(`c.sede_id = ${input.sedeId}`), quindi il pattern dei mittenti si costruisce
dai fornitori **di quella sede** e si interpola come oggi — resta una sorgente
sola per il ramo in memoria e per quello in SQL. Nessuna lettura di modulo,
nessuna cache globale: una cache globale in un CRM multi-azienda è il modo
classico di far vedere a un'azienda i dati di un'altra.

`shared/fornitori.ts` conserva le regole di riconoscimento (`contieneChiave`,
il rifiuto dei referenti, la ripulitura del nome grezzo): sono conoscenza di
dominio, non dati di nessuno.

### 4.3 Il seed del tenant 1

`FORNITORI_NOTI` e `PORTALI` restano nel file, rinominati
`SEED_FORNITORI_TENANT_1`, con un commento che dice che cosa sono: i fornitori
della Ruffino Group, applicati **una volta sola** all'anagrafica del tenant 1
al primo boot dopo il rilascio, e mai più letti da nessun percorso di dominio.
Idempotente per nome: un fornitore già presente non si duplica e non si
sovrascrive.

Il seed **non** parte da uno script (CLAUDE.md: gli script chiamano
`bootstrapAll()` senza `backfill`): è un backfill dichiarato nello store, come
gli altri.

Per ogni altra azienda l'anagrafica nasce **vuota**, ed è corretto: l'archivio
conferme non riconoscerà nessun mittente finché non ci sono fornitori. È anche
il momento in cui la pagina di §4.4 serve, e il percorso di §5 comincia.

### 4.4 UI

Una sezione **Fornitori** dentro Impostazioni (non una rotta nuova di primo
livello: è configurazione, non lavoro quotidiano). Elenco con nome, categoria,
canale, numero di conferme arrivate; aggiungi, modifica, disattiva. Le chiavi
di riconoscimento si mostrano come «da quali indirizzi arriva», con i domini
già visti dall'archivio proposti come suggerimento invece di farli battere a
mano.

Il menu dei fornitori del Magazzino smette di leggere la costante e legge la
lista della sede.

## 5. Piano 2 — l'esempio e il profilo di lettura

### 5.1 Il gesto

Sulla scheda di un fornitore: **«Carica un esempio di conferma»**. Il file entra
in `tenant/<id>/…` con `putFile` — e se la quota rifiuta
(`ErroreQuotaStorage`), **l'errore si rilancia sempre**, prima di qualunque
ripiego (CLAUDE.md).

Il CRM legge subito con l'estrattore che c'è già e mostra la proposta con
`DoveLetto` accanto a ogni valore: numero, data, imponibile, totale, articoli,
date di consegna. È lo stesso modello **proposta → correggi → applica** che
esiste per i contratti ([`server/routers/estrazioniContratto.ts`](../../../server/routers/estrazioniContratto.ts),
[`LeggiContrattoDialog.tsx`](../../../client/src/components/contratto/LeggiContrattoDialog.tsx)):
cambia il motore sotto, non il gesto.

La persona corregge i campi sbagliati e **indica dove comincia e dove finisce
il blocco delle righe**. Sono i due gesti che il profilo richiede; tutto il
resto è già giusto o non serve.

### 5.2 Che cos'è un profilo

```ts
export type AncoraCampo = {
  campo:
    | "numeroConferma" | "riferimentoOrdine" | "imponibile" | "totale"
    | "dataDocumento" | "dataConsegna" | "settimanaApprontamento";
  /** L'etichetta STAMPATA che precede il valore, normalizzata. */
  etichetta: string;
  /** Dove sta il valore rispetto all'etichetta. */
  posizione: "dopo_etichetta" | "riga_successiva" | "cella_a_destra";
  /** La forma attesa: impedisce di prendere il numero sbagliato. */
  forma: "numero" | "importo" | "data" | "settimana" | "testo";
  /** Pagina fissa quando il modulo la fissa; null = qualunque. */
  pagina: number | null;
};

export type BloccoRighe = {
  /** La riga d'intestazione che apre la tabella. */
  apertura: string;
  /** Che cosa la chiude: un'etichetta di totale, un piede, la pagina nuova. */
  chiusura: string;
  /** Le colonne per posizione di partenza sulla riga resa (`celleDiRiga`). */
  colonne: Array<{
    ruolo: "codice" | "descrizione" | "quantita" | "unita" | "prezzo" | "ignora";
    inizio: number;
    fine: number | null;
  }>;
};

export type ProfiloLettura = {
  id: number;
  sedeId: number;
  fornitoreId: number;
  versione: number;
  /** L'impronta del layout su cui questo profilo si applica (§6.1). */
  impronta: string;
  ancore: AncoraCampo[];
  blocco: BloccoRighe | null;
  origine: "correzione" | "catalogo";
  documentoEsempioId: number | null;
  /** Quante conferme ha letto senza che nessuno correggesse niente. */
  lettureSenzaCorrezione: number;
  createdBy: number | null;
  createdAt: Date;
  updatedAt: Date;
};
```

Le ancore nascono dalla correzione: quando la persona dice «il numero è
1602923», il codice cerca quella stringa nel testo della pagina, guarda che
cosa la precede e registra **l'etichetta**, non il valore. La geometria del
blocco nasce dai confini indicati, letti con `celleDiRiga` e la
`GeometriaPagina` che il parser produce già.

Un fornitore può avere **più profili**, uno per impronta: Alias manda sia
`Ordini_di_Vendi_…` sia `Esportazione.pdf`, e sono due moduli diversi. La
chiave è `(fornitoreId, impronta)`, non il solo fornitore.

### 5.3 Come si applica

Il profilo del fornitore, se la sua impronta combacia con quella del documento,
**vince sui campi che copre**; l'estrattore generico riempie tutto il resto.
Ogni valore continua a portare la sua evidenza — pagina, frammento, area —
quindi «Dove l'ho letto» funziona identico e si vede *da quale ancora* è
arrivato il numero.

Ordine di precedenza, dichiarato: `profilo dell'azienda` → `forma dal catalogo`
→ `estrattore generico`. Un profilo non può **cancellare** un valore che il
generico troverebbe: se l'ancora non trova niente, si scende al generico invece
di lasciare il campo vuoto.

### 5.4 Quando il fornitore cambia modulo

L'impronta smette di combaciare. Il profilo **non si applica e lo dice**: la
conferma si legge col generico e la voce d'archivio porta la nota «il modulo di
questo fornitore è cambiato: carica un esempio nuovo». Un profilo che sbaglia
in silenzio è peggio di nessun profilo, perché il costo del margine nasce da lì.

## 6. Piano 3 — il catalogo comune delle forme

### 6.1 L'impronta del layout

Un hash SHA-256 su una stringa canonica costruita **solo** da ciò che è
struttura:

- le **etichette stampate** ricorrenti — le celle che non contengono cifre
  lunghe né importi né date — normalizzate e ordinate;
- il numero di colonne del blocco righe e le loro posizioni di partenza;
- il numero di blocchi e il loro ordine.

Nessun valore entra nell'impronta. Due conferme dello stesso modulo hanno la
stessa impronta anche se parlano di clienti, prezzi e date diverse — ed è
esattamente ciò che la rende utilizzabile fra aziende senza portarsi dietro
niente di nessuno.

**È l'impronta la chiave del catalogo, non il nome del fornitore.** Un'azienda
che chiama «Oknoplast» quello che un'altra chiama «Wnd» riceve lo stesso
profilo, perché a combaciare è il foglio.

### 6.2 La promozione

`lettureSenzaCorrezione` cresce di uno quando una conferma è stata letta **con
quel profilo applicato** e la sua voce d'archivio arriva a `collegata` senza
che nessuno abbia toccato i valori letti. Si azzera alla prima correzione: una
sola smentita rimette il profilo in prova, che è il comportamento voluto.

Automatica (D3). Quando un profilo raggiunge **tre letture senza correzioni**,
la sua forma — impronta, ancore, blocco, **spogliati di ogni valore** — viene
proposta al catalogo. Se il catalogo ha già una forma per quell'impronta:
vince quella con più letture confermate; a parità, non si tocca niente.

Il catalogo è una **tabella del control plane**, non uno store kv globale: gli
store globali sono quattro e una guardia (`server/_core/storeGlobali.test.ts`)
fallisce se qualcuno ne aggiunge un quinto. **Ma non appartiene nemmeno a
`server/tenants/repository.ts`**, che è il ciclo di vita delle aziende: è una
categoria nuova — conoscenza di prodotto fra le aziende — e va dichiarata
come tale, con un repository suo (`server/forme/repository.ts`), la sua
tabella `forme_conferma`, e la sua guardia di confine. Questa è una decisione
da registrare, non un dettaglio: la si prende qui.

### 6.3 Il confine: che cosa NON può viaggiare

Una guardia, non una promessa: `server/forme/confine.test.ts` rifiuta la
promozione di una forma che contenga

- sequenze di **quattro o più cifre** (numeri d'ordine, importi, P.IVA, CAP);
- un simbolo di valuta o un pattern d'importo;
- frammenti di testo oltre **40 caratteri**;
- una qualunque stringa che compaia fra i **clienti, le commesse o gli
  indirizzi dell'azienda d'origine** — verifica incrociata eseguita **al
  momento della promozione**, quando quei dati sono ancora raggiungibili.

L'ultima è la più importante: rende il confine una proprietà verificata sui
dati veri, non un'euristica sui caratteri.

Il nome del **fornitore emittente** può restare: è la carta intestata di
un'azienda terza su un documento commerciale, non un dato dei clienti di
nessuno. È una scelta, e va scritta perché qualcuno un giorno la rimetterà in
discussione.

### 6.4 La riga nei termini

D4. Il testo non vive in questo repository (i termini stanno sulla landing, in
Framer): è **un'azione esterna**, da fare prima di accendere l'interruttore del
catalogo. La spec la dichiara e non la esegue.

## 7. Permessi

- Anagrafica fornitori: `adminProcedure` come oggi (direzione). Leggere l'elenco:
  `commessa.read`, perché serve ai filtri del magazzino.
- Caricare esempi, correggere, generare il profilo: **`fornitore.manage_ordini`**
  — la capability che il ruolo `ordini` ha già. Nessuna capability nuova.
- Il catalogo comune non ha una UI e non ha permessi d'utente: ci scrive solo il
  giro di promozione.
- Sede: un profilo di un'altra sede dà `NOT_FOUND` via `recordOppureNotFound`.

## 8. Interruttori

Tre, tutti fail-closed e spenti in partenza, in `server/platform/interruttori.ts`:

- `fornitoriAzienda` — piano 1. A spento il riconoscitore si costruisce dal
  seed invece che dall'anagrafica, e il comportamento è identico a oggi. Quel
  ripiego vive in **un solo posto**, `riconoscitoreDiRipiego()` in
  `server/fornitori/riconoscimento.ts`: è l'unico punto del server autorizzato
  a importare `SEED_FORNITORI_TENANT_1`, e la guardia di §9 lo nomina come
  eccezione unica invece di vietarlo ovunque e poi tradirsi.
- `profiliLettura` — piano 2. A spento: nessun profilo nasce, nessuno si applica.
- `catalogoForme` — piano 3. A spento: nessuna promozione, nessuna forma letta
  dal catalogo. **È l'interruttore che va acceso per ultimo, e solo dopo la riga
  nei termini.**

## 9. Invarianti e guardie

- `sedeId` su fornitori, esempi e profili; record d'altra sede → `NOT_FOUND`.
- **Nessuna cache globale del riconoscitore.** Si costruisce per sede, a ogni
  giro o richiesta: una cache di modulo in un CRM multi-azienda è il modo
  classico di far vedere a un'azienda i dati di un'altra.
- Guardia strutturale: `SEED_FORNITORI_TENANT_1` lo importano **solo due
  file** — il backfill dell'anagrafica (§4.3) e `riconoscitoreDiRipiego()`
  (§8). Ogni altro import fa fallire la guardia.
- Il seed tocca **solo** il tenant 1, una volta, in modo idempotente.
- Gli esempi nascono sotto `tenant/<id>/…`; `putFile` ricava l'azienda dal
  contesto e la quota si rilancia sempre.
- Il giro di promozione è un punto d'ingresso fuori richiesta: passa da
  `perOgniTenantAttivo`.
- `forme_conferma` la scrive **solo** `server/forme/repository.ts`
  (guardia `server/forme/confine.test.ts`), che non importa nulla di dominio.
- L'estrattore generico non cambia comportamento quando nessun profilo combacia.

## 10. Test di accettazione

1. Due aziende, due elenchi: una conferma Alias arrivata all'azienda 2, che non
   ha Alias in anagrafica, non entra in archivio; la stessa arrivata al tenant 1
   entra.
2. Seed: al primo boot il tenant 1 si ritrova 25 fornitori con le chiavi giuste
   e Antenore come portale di Wnd; un secondo boot non ne crea 50.
3. Correzione → profilo: corretto il numero d'ordine su un esempio Pail
   (`conf.26_29488 aggiornata.pdf`, che dal nome non si riconosce), il profilo
   nasce con l'ancora sull'etichetta, non col valore `29488` dentro.
4. Applicazione: la conferma Alias successiva legge le sei righe della porta
   come un articolo principale più i suoi accessori, non come otto consegne.
5. Modulo cambiato: alterata l'intestazione dell'esempio, il profilo non si
   applica e la voce lo dichiara; il generico legge lo stesso.
6. Impronta: due conferme dello stesso modulo con clienti, prezzi e date diversi
   producono la **stessa** impronta.
7. Confine: una forma che contiene `1602923`, `€ 948,73`, «Via Roma 12» o il
   cognome di un cliente dell'azienda d'origine **non viene promossa**.
8. Precedenza: con l'ancora che non trova niente, il valore arriva comunque dal
   generico e non resta vuoto.
9. Flag spenti: nessuna scrittura su profili né su `forme_conferma`, e il
   riconoscimento dei fornitori identico a oggi.

## 11. Ordine dei lavori e dipendenze

1. **PR #17 atterra per prima.** È verificata e sistema un problema vero oggi
   per la Ruffino. Cabla i 25 più a fondo, ma il piano 1 la generalizza subito
   dopo: tenerla ferma in attesa costerebbe più di quello che salva.
2. **Piano 1** — fornitori per azienda. Sta in piedi da solo ed è il
   prerequisito di tutto il resto.
3. **Piano 2** — esempi e profili. Dipende da 1.
4. **Piano 3** — catalogo comune. Dipende da 2, e dalla riga nei termini.

Il piano della **partita d'ordine** (spec ordini §4–§7) è indipendente da
questi tre e può correre in parallelo dopo il piano 1.

## 12. Domande aperte

- **Tre letture senza correzioni** è la soglia di promozione proposta, non
  misurata. Dopo il piano 2 si vedrà quante conferme passano davvero senza
  correzioni e la si taglierà sul vero.
- **Quanti fornitori ha un'azienda tipo** oltre alla Ruffino: non lo sappiamo,
  e decide se la pagina di §4.4 basta com'è o vuole ricerca e paginazione.
- **Il nome del fornitore emittente nel catalogo** (§6.3): tenuto, dichiarato.
  Se un giorno si decidesse di toglierlo, il catalogo resta usabile — l'impronta
  è già la chiave.
- **Il nome Alias mangiato** (`LIAS Srl`, `IAS Srl`), aperto dalla spec ordini
  §8.3: un profilo di lettura è probabilmente il rimedio giusto, ma la causa va
  vista su un PDF vero prima di dirlo.
