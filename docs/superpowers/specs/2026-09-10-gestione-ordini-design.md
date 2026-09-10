# Gestione ordini fornitore — la partita d'ordine (spec tecnica)

Nasce il 10/09/2026 dal mandato della direzione: «al momento vengono gestiti
male gli ordini, chi fa gli ordini spesso non sa cosa ordinare e se ha
ordinato tutto». È la ridiscussione di **D1**, sospesa il 03/09/2026 sera
(`docs/superpowers/plans/2026-09-03-tars-utile.md` §5) con la frase «per
quanto riguarda gli ordini non è così, dobbiamo riparlarne». Questa spec
sostituisce quella proposta e ne registra l'esito.

Base: `main` a `1d0663f`. Branch `claude/analisi-gestione-ordini-b0892f`.

## 1. Obiettivo, perimetro, non-obiettivi

**Obiettivo.** Rendere rispondibili nel CRM due domande che oggi non hanno
risposta: *che cosa devo ordinare per questo lavoro* e *ho ordinato tutto*.
La risposta dev'essere una frase leggibile — «3 partite su 4 ordinate, manca
Oskura (7 persiane)» — e dev'essere vera senza che nessuno tenga un secondo
registro a mano.

**Perimetro.**
- Una **partita d'ordine** per coppia commessa × fornitore, con il suo stato,
  che riusa lo store `fornitori_ordini` (oggi vuoto in produzione).
- Le partite **nascono da sole** da tre sorgenti: le righe del contratto
  strutturato, la posta in uscita della casella `ordini@`, la conferma
  d'ordine che rientra. Restano scrivibili a mano, sempre.
- Un **gate** su `da_ordinare → produzione` che conta le partite invece di
  contare un documento, con lo stesso «Procedi comunque» degli altri gate.
- Una **lista di lavoro** per chi ordina (ruolo `ordini`), come terza scheda
  di `/fornitori`, e una scheda «Ordini» nella commessa.
- La **bonifica dell'archivio conferme**, prerequisito dichiarato (§8).

**Non-obiettivi (dichiarati, non dimenticati).**
- **Generare e mandare l'ordine dal CRM.** Decisione della direzione: il CRM
  *registra e riconcilia*, l'ordine continua a partire come parte oggi
  (§3, D-D). Niente modelli d'ordine per fornitore, niente codici articolo
  del fornitore, niente prezzi d'acquisto in fase d'ordine.
- **Le misure esecutive come dato.** Restano un PDF (§3, D-B). `aperture`
  resta il codice morto che è (zero record in produzione): questa spec non lo
  risuscita e non lo rimuove.
- **L'anagrafica fornitori.** Resta vuota e fuori taglio, come già dichiarato
  in PRD §36-bis.5. Il fornitore di una partita è un **nome normalizzato**
  (`shared/fornitori.ts`), la stessa chiave che già usano magazzino, archivio
  e costo da conferma.
- **La pagina `/fornitori` di una volta** (anagrafiche, listini, ordini a
  mano): rimossa il 04/09 per zero uso, non torna. Le partite vivono dove si
  lavora.
- **Riscontro articolo per articolo** fra righe di contratto e righe della
  conferma: escluso per prova, non per pigrizia (§4.1).
- Ordini non legati a una commessa (materiale di magazzino, consumabili):
  fuori. Ogni partita ha una commessa.

## 2. Che cosa c'è oggi, misurato (produzione, 10/09/2026)

Sonde in sola lettura su Postgres di produzione.

| Fatto | Numero |
|---|---|
| Commesse | 402 (256 preventivo, 130 vive, 16 archiviate) |
| Commesse da `da_ordinare` in poi (non archiviate) | 117 |
| ...di cui **senza nessuna conferma d'ordine nel fascicolo** | **90 (77%)** |
| Ordini fornitore (`fornitori_ordini`) | **0** |
| Anagrafiche fornitore, listini | **0, 0** |
| Righe di contratto strutturato (`commessa_righe`) | **47 su 7 commesse** (1,7%) |
| `commessa.prodotti[]` legacy | 45 commesse su 402 |
| `aperture` (rilievo per foro) | **la chiave non esiste in `kv_store`** |
| Archivio conferme | 352 voci: **230 da collegare (65%)**, 121 collegate, 1 scartata |
| Conferme per commessa (dove ce n'è) | 1→12, 2→7, 3→3, 4→4, 5→1, 6→2, 7→1, 8→1, **13→1** |
| Consegne a magazzino | 106 su 60 commesse (70 a mano, 36 da conferma) |
| Email in uscita registrate (`out/email`) | **0** — `cartellaInviati` è `null` su tutte le 11 caselle |

Il fatto strutturale: **l'ordine come oggetto non esiste nel lavoro vero.**
Il tipo `OrdineFornitore` c'è ([`server/routers/fornitori.ts`](../../../server/routers/fornitori.ts)),
il passo di timeline «Ordine Merce al Fornitore» è stato ritirato e fuso nella
conferma il 03/09 ([`server/routers/timeline.ts`](../../../server/routers/timeline.ts)),
e il gate di `da_ordinare` chiede **un** documento `conferma_ordine`
([`server/routers/preventiviContratti.ts`](../../../server/routers/preventiviContratti.ts)).
Quindi il CRM registra la carta che torna, mai il gesto che parte: senza
conferma non sa distinguere «non ordinato» da «ordinato, conferma non
arrivata». E il gate passa alla prima conferma mentre restano tre fornitori
da chiamare — in 20 commesse su 32 le conferme sono almeno due, in una sono
tredici. **Il gate oggi rassicura a torto.**

## 3. Decisioni della direzione (10/09/2026)

- **D-A — L'unità è la partita, non la riga.** Lo stato «ho ordinato?» si
  tiene per coppia **commessa × fornitore**. Motivazione nei dati, §4.1.
- **D-B — Le misure esecutive restano un PDF.** Il fabbisogno si ricava dal
  contratto; le correzioni di misura si scrivono nella nota della partita.
- **D-C — Il gate blocca, con «Procedi comunque».** Stessa forma degli altri
  gate: si ferma, dice che cosa manca, chi ha la capability scavalca e resta
  scritto nel registro delle transizioni.
- **D-D — Registrare e riconciliare, non generare.** Il CRM non produce e non
  spedisce l'ordine.
- **D-E — Due canali, dichiarati per fornitore.** A **portale**:
  Wnd/Oknoplast (il loro portale è **Antenore**), Primed, Oskura, Pail. A
  **mail**: tutto il resto, Alias compresa — che è la voce più grossa
  dell'archivio (179 conferme).
- **D-F — Chi ordina è una persona sola dedicata.** Nel CRM è il ruolo
  `ordini`, che esiste già con `fornitore.manage_ordini` e che in produzione
  hanno quattro utenti. La lista di lavoro è **una sola, condivisa**, non una
  coda per persona.

## 4. Il modello

### 4.1 Perché la partita e non la riga (la prova)

I due lati non parlano la stessa lingua, e non impareranno.

**Lato contratto** — la riga di contratto **è già il foro**, con stanza,
misura, marchio e categoria. Commessa 157, 12 righe:

```
c157#1  [serramento_pvc] Portabalcone a 2 ante DX con ribalta, WnD Etrum, sala      q=1  1100x2425
c157#3  [serramento_pvc] Finestra a 2 ante DX con ribalta, WnD Etrum, sala          q=1  1160x1605
c157#8  [serramento_pvc] Finestra a 1 anta SX con ribalta, WnD Etrum, bagno         q=1   590x1550
c157#11 [accessorio]     Coprifilo piatto 2,5x50 - 120.258, barra da 6 metri        q=11
```

**Lato conferma** — tornano i codici interni del fornitore. Una **sola** porta
Alias (commessa 98) torna così:

```
KPO50 KIT PORTA | PORST-C085 PORTA BLIND.STEEL/C da 2101 a 2150 |
FCO085 FALSO COMMESSA H 2101/2150 | COI5 SET COPRIFILI INTERNO |
IME5 SET IMBOTTE ESTERNO | COE5 SET COPRIFILI ESTERNO
```

`PORST-C085` non somiglierà mai a «Porta di Ingresso a 1 anta apertura
esterna». Un riscontro articolo-per-articolo costruisce una macchina che
sbaglia e di cui nessuno si fida: **escluso**.

Ma il riscontro **commessa × fornitore** è banale e robusto: la conferma
dichiara il fornitore, la riga di contratto dichiara la categoria, e la
categoria dice da chi si compra. Un lavoro tipico sono 2–4 partite. La 185:
*Wnd* (5 serramenti + coprifili) e *Oskura* (7 persiane). La 181: *Wnd*,
*Oskura* (tapparella + 2 cassonetti), coprifili con i serramenti.

La riga di contratto continua a rispondere a **«cosa ordinare»** (c'è già,
con stanza e misura, e si mostra dentro la partita). La partita risponde a
**«ho ordinato?»**.

### 4.2 Forma del dato

Riuso di `OrdineFornitore` in `fornitori_ordini` (store per tenant, oggi a
zero righe: nessuna migrazione di dati, ma il backfill in `onLoad` va scritto
lo stesso — CLAUDE.md). Campi **nuovi** in coda, tutti con default:

| Campo | Tipo | Significato |
|---|---|---|
| `fornitore` | `string` | Nome normalizzato (`normalizzaFornitore`). **È il campo autorevole.** |
| `fornitoreId` | `number \| null` | Era obbligatorio: diventa nullable e resta inutilizzato finché l'anagrafica è vuota. `getOrdiniPerMargine` risolve il nome preferendo `fornitore` e cade sull'anagrafica solo se `fornitore` è vuoto. |
| `codiceOrdine` | `string \| null` | Era obbligatorio: una partita nasce prima di avere un riferimento. |
| `canale` | `"mail" \| "portale" \| "altro"` | Da D-E, proposto dal fornitore, correggibile. |
| `origine` | `"contratto" \| "posta" \| "conferma" \| "manuale"` | Chi l'ha fatta nascere. |
| `righeContratto` | `number[]` | Gli id di `commessa_righe` che questa partita copre. Vuoto = partita senza contratto strutturato. |
| `descrizione` | `string \| null` | Che cosa contiene, a parole, quando le righe non ci sono («7 persiane alluminio»). |
| `documentoConfermaId` | `number \| null` | La conferma che l'ha chiusa. |
| `comunicazioneOrdineId` | `number \| null` | La mail in uscita che l'ha fatta partire. |

Gli **stati esistenti bastano**, con questa lettura (nessun enum nuovo):

| Stato in `fornitori_ordini` | Che cosa vuol dire per chi ordina |
|---|---|
| `bozza` | **da ordinare** — è il buco che il gate conta |
| `inviato` | **ordinato** — la mail è partita, o una persona l'ha detto |
| `confermato` | il fornitore ha confermato (conferma nel fascicolo) |
| `in_transito` | merce pronta / in viaggio (allineato a `prontaDal` del magazzino) |
| `ricevuto_parziale`, `ricevuto` | arrivata |
| `contestato` | contestata |

`righe[]`, `quantitaRicevuta`, `lotto`, `conforme` restano come sono: non li
usa questo taglio, non si tolgono (matrice campo→consumer, CLAUDE.md).

### 4.3 Regole d'acquisto

Store nuovo per tenant `ordini_regole_acquisto`: `{ categoria: CategoriaRiga,
fornitore: string, canale }`. Otto-dieci righe, si compila una volta, si
modifica in Impostazioni con `contratto.manage`. Default seminato da una
costante in `shared/` con quello che si vede nei dati veri: `serramento_pvc →
Wnd (portale)`, `persiana → Oskura (portale)`, `tapparella`/`cassonetto →
Oskura`, `porta_blindata`/`portoncino → Alias (mail)`, `tenda → Brianzatende
(mail)`, `zanzariera → Primed (portale)`.

**`accessorio` non ha una regola propria**: è l'unica categoria con un
comportamento a sé, e va scritto come tale invece che come riga della
tabella. I coprifili delle 47 righe vere portano codici del produttore dei
serramenti (`120.258`, `120.294`, `109.046 Veka`) e viaggiano in quell'ordine.
Regola: una riga `accessorio` finisce nella partita del fornitore che ha più
righe non-accessorio nella stessa commessa; se non ce n'è nessuna, resta senza
fornitore.

La regola **propone**, non decide: la partita proposta è modificabile prima e
dopo. Una categoria senza regola produce una partita **senza fornitore**, che
la lista mostra come «da assegnare» invece di nasconderla.

## 5. Come nasce una partita

Tre sorgenti, tutte idempotenti, che convergono sulla stessa chiave
(commessa, fornitore normalizzato).

1. **Dal contratto** — quando il contratto strutturato esiste, all'ingresso in
   `da_ordinare` le righe si raggruppano per fornitore secondo §4.3 e
   producono le partite in `bozza`, con `righeContratto` popolato. Copre 7
   commesse su 402 **oggi**; cresce con la lettura del contratto.
2. **Dalla posta in uscita** — §6.1. Crea o avanza a `inviato`.
3. **Dalla conferma che rientra** — §6.2. Crea o avanza a `confermato`.

E **a mano**, sempre: fornitore da elenco, descrizione libera, canale. È il
percorso che copre il 98% dei lavori finché il contratto non è strutturato, e
sono trenta secondi per lavoro.

Chiave di idempotenza: `(sedeId, commessaId, fornitore normalizzato)`. Due
sorgenti che parlano dello stesso fornitore sulla stessa commessa **non fanno
due partite**; la seconda avanza la prima e ne registra l'origine aggiuntiva.
Un fornitore con due ordini distinti sulla stessa commessa (raro ma reale) si
separa a mano: la seconda partita nasce con un `codiceOrdine` diverso e la
chiave diventa `(sede, commessa, fornitore, codiceOrdine)`.

## 6. Come si chiude: i tre canali

### 6.1 Mail — la cartella Inviati di `ordini@ruffinogroup.it`

L'IMAP sa già leggere la cartella degli inviati quando la casella la dichiara
([`server/comunicazioni/imap.ts`](../../../server/comunicazioni/imap.ts), riga
382), e registra i messaggi con `direzione: "out"`. In produzione
`cartellaInviati` è `null` su tutte le 11 caselle: **`out/email` è zero**.

Azione operativa (non codice): impostare la cartella inviati sulla casella
`ordini@ruffinogroup.it`, che esiste ed è attiva.

Regola deterministica nuova, nel worker della posta: un messaggio in uscita
il cui destinatario appartiene al dominio di un fornitore noto **e** il cui
testo cita una commessa viva (`riscontroCommessaNelTesto`, già esistente e già
usato dalle conferme) porta la partita `(commessa, fornitore)` a `inviato`,
con la data del messaggio e `comunicazioneOrdineId`. Se la partita non c'è,
**la crea** già in `inviato`: la mail è la prova, e questo è esattamente il
caso «ordinato senza averlo mai pianificato». Nessun modello decide: se il
testo non cita una commessa sola, non succede niente e il messaggio resta
consultabile.

### 6.2 Portale — la conferma vale come prova d'ordine

Per Wnd/Oknoplast, Primed, Oskura e Pail non esiste una mail in uscita da
intercettare. Ma per un portale **confermato implica ordinato**: quando una
conferma viene collegata a una commessa — dal worker dell'archivio o a mano
([`server/fornitori/archivio.ts`](../../../server/fornitori/archivio.ts)) —
la partita `(commessa, fornitore)` passa a `confermato` con
`documentoConfermaId`, e se non esiste viene creata direttamente lì.

Si aggancia **dove costo e merce già nascono**, cioè alla regola di dominio di
[`server/commesse/costoDaConferma.ts`](../../../server/commesse/costoDaConferma.ts),
non a un percorso parallelo: la conferma che entra nel fascicolo fa nascere
costo, consegna **e** chiusura della partita, e la rilettura che ritira costo
e merce ritira anche la chiusura.

### 6.3 A mano

Resta il buco vero, ed è l'unico click del giro: **portale ordinato, conferma
non ancora tornata**. Un bottone «Ordinato» sulla partita, con data e
riferimento facoltativo. Chi ordina lo preme mentre chiude la scheda del
portale.

## 7. Il gate

`da_ordinare → produzione` smette di chiedere un documento e chiede le
partite. Il gate `ordini` è **soddisfatto** quando:

- esiste **almeno una** partita per la commessa, **e**
- **nessuna** è in `bozza`.

Zero partite **non** soddisfa il gate, con il messaggio «nessun ordine
registrato per questo lavoro»: è la differenza fra sapere e non sapere, e
tacerla riprodurrebbe il difetto di oggi.

Forma tecnica: si estende `valutaTransizione`
([`server/commesse/transizioni.ts`](../../../server/commesse/transizioni.ts))
con `gate.ordini: { richiesto, soddisfatto, mancanti }` accanto a
`gate.computo`, e `gateScavalcato` accetta il terzo valore `"ordini"`. Lo
scavalco è lo stesso «Procedi comunque» degli altri due — capability di chi
clicca, motivo registrato, e **l'Undo non forza mai** (CLAUDE.md).

Con `FLAG_ORDINI` acceso, `REQUIRED_DOC_TIPI_PER_STATO.da_ordinare` diventa
`[]`: il gate documentale sulla conferma sparisce perché il gate delle partite
lo assorbe, ed è anche più giusto — oggi un lavoro le cui quattro conferme
sono arrivate *prima* di entrare in `da_ordinare` resta bloccato per niente.
A flag spento **niente cambia**: nessuna partita nasce, nessun gate nuovo,
`REQUIRED_DOC_TIPI_PER_STATO` resta quello di oggi.

Tars vede lo stesso gate, lo rivaluta a ogni tappa e senza scavalco si ferma
dicendo che mancano **gli ordini**, non un file.

## 8. Bonifica dell'archivio conferme (prerequisito)

Vale da sola e va prima: sono le 230 conferme ferme in coda, e senza questo il
canale «portale» di §6.2 resta cieco proprio sui fornitori che contano.

1. **Primed è invisibile.** 312 mail in ingresso, **zero voci in archivio**.
   Il filtro guarda il *nome del file*
   ([`server/tars/documenti/confermeMancanti.ts`](../../../server/tars/documenti/confermeMancanti.ts))
   e Primed allega `R237_2026WU367846_20052026165105.pdf`. Correzione: quando
   il **mittente è un fornitore noto**, il nome del file smette di essere un
   filtro e decide il testo del documento. Copre anche i **59 allegati Alias
   che si chiamano letteralmente `allegato`** e gli `Commessa-N-…pdf` di
   Oskura.
2. **Antenore non è un fornitore, è un portale.** 94 mail da `antenore.biz`
   che oggi finiscono in «Da riconoscere». Serve una mappa `PORTALI` in
   `shared/fornitori.ts`: `antenore.biz → Wnd`. Un portale non diventa un
   fornitore: riconduce al fornitore che rappresenta.
3. **Il nome Alias arriva mangiato.** In archivio ci sono `LIAS Srl Porte
   blindate 19100`, `IAS Srl Porte blindate rip fee`, `IAS Srl Porte
   blindate`. `normalizzaFornitore` non toglie lettere: il testo arriva già
   così dall'estrazione. **Da diagnosticare sul PDF vero** prima di correggere
   — non si scrive una regola su una causa supposta.
4. **I solleciti passano per conferme.** `Sollecito_Ordin_1685983(1).pdf`
   matcha `ordin` ed entra in coda. Aggiungere `sollecito` a `NOME_ESCLUSO`.

## 9. UI

Nessuna rotta nuova, nessuna voce di menu nuova.

- **`/fornitori`, terza scheda «Da ordinare»** — accanto a «Conferme
  d'ordine» e «In arrivo», stessa pagina e stessa persona. È la lista di
  lavoro: le commesse da `da_ordinare` in poi con le loro partite, ordinate
  per urgenza (chi ha `bozza` in cima, poi chi aspetta conferma da più
  giorni). Ogni riga: commessa, cliente, fornitore, che cosa contiene, stato,
  canale, e le azioni al posto giusto — «Ordinato», «Apri la conferma»,
  «Aggiungi partita», «Assegna fornitore».
- **Scheda «Ordini» nella commessa** — visibile da `da_ordinare` in poi, come
  già fa il blocco delle consegne. Le partite con dentro le righe di contratto
  che coprono (stanza e misura, che è ciò che serve a chi ordina) quando ci
  sono, la descrizione a parole quando non ci sono.
- **Card del Kanban**: una riga sola, «3/4 ordinate» oppure «nessun ordine
  registrato», con il colore mai come unico segnale.
- Token semantici, Plus Jakarta Sans, `min-w-0` sulle tabelle, nessuno scroll
  orizzontale di pagina, verifica a 1440×900 e 390×844, `portaInCima` e mai
  `scrollIntoView` (CLAUDE.md).

## 10. Permessi

- Leggere le partite: `commessa.read` (le vede chi vede la commessa).
- Creare, modificare, segnare «Ordinato», assegnare il fornitore:
  **`fornitore.manage_ordini`** — che è già la capability del ruolo `ordini`
  e che la direzione ha per costruzione. Nessuna capability nuova.
- Modificare le regole d'acquisto: `contratto.manage`.
- Scavalcare il gate: la stessa `commessa.change_state` degli altri gate.
- Sede: una partita di un'altra sede dà `NOT_FOUND` via
  `recordOppureNotFound`, mai un errore che ne riveli l'id.

## 11. Interruttore e messa in esercizio

`FLAG_ORDINI`, fail-closed, spento in partenza — come `FLAG_LIMITI` e gli
altri. A flag spento: nessuna partita nasce, il gate resta quello di oggi, la
scheda e la lista non compaiono, il worker della posta non scrive.

Ordine di accensione: prima la bonifica di §8 (indipendente dal flag), poi la
cartella inviati su `ordini@`, poi il flag. Le 19 commesse oggi in
`da_ordinare` e le 98 più avanti **non vengono toccate retroattivamente**:
nessun backfill inventa partite dal nulla. Si popolano da sole man mano che
arrivano conferme e mail, e chi ordina scrive a mano quelle dei lavori vivi.

## 12. Invarianti e guardie

- `sedeId` su ogni partita, query e mutation; record d'altra sede →
  `NOT_FOUND` (guardia `nonTrovato.confine.test.ts`).
- Il worker della posta in uscita è un punto d'ingresso fuori richiesta: passa
  da **`perOgniTenantAttivo`** (`server/tenants/giri.ts`), con l'interruttore
  per (worker, azienda).
- **Un solo servizio scrive `fornitori_ordini`**: `server/ordini/servizio.ts`.
  Router, worker della posta, regola della conferma e strumenti di Tars
  passano tutti di lì. Guardia strutturale `server/ordini/confine.test.ts`,
  sul modello di `server/tenants/confine.test.ts`.
- Idempotenza sulla chiave `(sedeId, commessaId, fornitore[, codiceOrdine])`:
  la stessa mail letta due volte, la stessa conferma riletta, il doppio click
  non creano due partite.
- Nessun importo d'acquisto entra qui: il costo fornitore resta quello che
  nasce dalla conferma (§54.7 del PRD), un percorso solo.
- `putFile` non c'entra: questa spec non carica file.

## 13. Test di accettazione

1. Partite dal contratto: la commessa 185 (5 serramenti WnD + 7 persiane + 1
   accessorio) produce **due** partite, Wnd e Oskura, non tredici.
2. Gate: zero partite → bloccante con «nessun ordine registrato»; una in
   `bozza` → bloccante con il fornitore che manca; nessuna in `bozza` → passa.
3. Scavalco: «Procedi comunque» registra `gateScavalcato: "ordini"`; l'Undo
   della transizione **non** scavalca.
4. Posta in uscita: una mail ad `@aliasblindate.com` che cita la commessa 98
   porta la partita Alias a `inviato`; la stessa mail riletta non ne crea una
   seconda; una mail che non cita nessuna commessa non fa niente.
5. Conferma: collegare una conferma Oskura alla commessa 418 crea la partita
   Oskura in `confermato`; la rilettura che ritira costo e merce ritira anche
   la chiusura.
6. Sede: la partita di un'altra sede risponde `NOT_FOUND`.
7. Flag spento: nessuna scrittura su `fornitori_ordini`, gate identico a oggi,
   `REQUIRED_DOC_TIPI_PER_STATO.da_ordinare` invariato.
8. Bonifica: un allegato Primed `R237_…pdf` da mittente `@primed.it` entra in
   archivio; un `Sollecito_Ordin_….pdf` no.

## 14. Ordine dei lavori

1. **Bonifica archivio** (§8) — indipendente, va da sola, vale da sola.
2. **Servizio e store** — `server/ordini/servizio.ts`, campi nuovi con
   backfill in `onLoad`, guardia di confine.
3. **Regole d'acquisto** e nascita dal contratto (§4.3, §5.1).
4. **Gate** (§7) dietro `FLAG_ORDINI`.
5. **UI** — scheda commessa, terza scheda di `/fornitori`, riga sul Kanban.
6. **Posta in uscita** (§6.1) — la parte con più superficie operativa, per
   ultima: prima si guarda che cosa arriva davvero nella cartella inviati.
7. Documenti: PRD (nuova sezione, e §19/§35/§36-bis aggiornate), `handoff.md`,
   `CLAUDE.md` se cambiano invarianti.

## 15. Domande aperte

- **Quanti lavori hanno davvero più di un fornitore.** Dal magazzino: 42
  commesse con 1 fornitore, 17 con 2+. Ma il magazzino è alimentato dalle
  conferme, e le conferme sono cieche su Primed: il numero vero è quasi
  certamente più alto. Si saprà dopo la bonifica di §8, e vale la pena
  rimisurarlo prima di accendere il flag.
- **Il nome Alias mangiato** (§8.3): causa da trovare sul PDF vero.
- **`ermado.it`** (37 mail) e **`gallirappresentanze.com`** (33): fornitori,
  rappresentanti o altro? Dai nomi degli allegati sembrano manuali tecnici e
  accordi commerciali, non conferme. Da confermare prima di aggiungerli a
  `FORNITORI_NOTI`.
- **La seconda partita dello stesso fornitore** sulla stessa commessa (§5):
  la chiave allargata al `codiceOrdine` regge, ma non si è visto un caso vero.
  Se non capita, resta una possibilità inutilizzata e va bene così.
