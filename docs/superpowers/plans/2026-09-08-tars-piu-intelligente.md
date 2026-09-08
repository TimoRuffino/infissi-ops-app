# Tars più intelligente — 31 interventi, ordinati per costo e valore

> Direzione, 08/09/2026: «attualmente cosa viene proposto da Tars? come
> potrebbe migliorare? vai più a fondo, dammi altri consigli per renderlo
> ancora più intelligente». Questo documento è la risposta scritta: cosa
> manca, dove si vede nel codice, quanto costa, cosa vale. Non è ancora
> un piano di esecuzione: da qui la direzione sceglie il primo blocco, e
> quel blocco diventa un piano con i passi.

## 0. Dove siamo oggi

Tars propone in due posti.

**L'analisi del mattino** (`server/tars/analisi/`) gira una volta al
giorno per sede: un calcolo deterministico costruisce la *fotografia*
(quattordici sezioni di fatti), il modello la legge e restituisce JSON
strict con sintesi, punti, **fino a sei proposte** e domande. Ogni
proposta può portare un'azione eseguibile con un click, scelta fra
**dieci** strumenti su cinquantasei del registro. Alla pressione,
`catalogoAzioniPerContesto` ricontrolla capability, sede e interruttori
sull'utente che clicca: la proposta non porta autorità.

**Le azioni diritte**, senza proposta: lo smistamento legge gli allegati
di mail e WhatsApp, li archivia nella commessa col nome giusto, e dalla
conferma d'ordine nascono da soli il costo del margine e la merce a
magazzino.

Le sezioni della fotografia: commesse, preventivi fermi, gate documentali
mancanti, pronte per il passo successivo, conferme d'ordine (mancanti o
senza costo leggibile), fatture FiC, casi del Centro Azioni, commesse
dormienti, osservazioni, pattern del periodo, comunicazioni, ticket,
interventi dei prossimi sette giorni, perimetro.

Mai proposto, per regola: soldi e importi, cancellazioni, effetti
esterni, «rispondi al cliente».

---

## 1. I trentuno interventi

Ogni voce: **cosa manca**, dove si vede, perché conta. Costo in giornate
di lavoro piene, valore su tre livelli (alto / medio / utile).

### Copertura — Tars non vede pezzi di azienda

**1. Il magazzino non entra nella fotografia.**
Quattordici sezioni, nessuna sulla merce in ritardo, mentre
`inArrivoPerFornitore` (`server/fornitori/archivio.ts`) calcola già
`attese` e `inRitardo` per fornitore. È il dato che fa slittare le pose.
*Costo 0,5 · valore alto.*

**7. Non si accorge di quando è cieco.**
Le caselle registrano `ultimaSync` e `ultimoErrore`
(`server/comunicazioni/caselle.ts`) e nessuno li guarda. IMAP giù tre
giorni significa niente mail, niente conferme, niente smistamento — e la
fotografia scrive «tutto calmo». Vale anche per token FiC scaduto,
backup Drive vecchio, WhatsApp muto. Serve una sezione «occhi chiusi» in
cima, prima di tutto il resto.
*Costo 0,5 · valore alto — è l'unico difetto che mente in modo
rassicurante.*

**8. Non nomina mai il margine.**
Regola assoluta del prompt: «Mai importi in euro, mai cifre economiche».
Nata giusta (il modello non deve inventare cifre), costa la frase che
conta: «questa commessa è sotto margine». I numeri veri li ha il dominio.
Si dà al modello il **flag** (sotto soglia sì/no) e la cifra la scrive il
codice in fondo alla proposta.
*Costo 1,5 · valore alto · **richiede una decisione**: chi vede le cifre,
solo direzione o anche amministrazione.*

**9. Conta quello che c'è, non quello che manca.**
Posa fatta e verbale mai caricato da tre giorni. Contratto firmato e
acconto mai arrivato. Preventivo accettato senza contratto. Il gate
documentale copre un pezzo; il resto è silenzio, e il silenzio non entra
in una fotografia fatta di elenchi.
*Costo 1,5 · valore alto.*

**14. Le scadenze delle pratiche e delle garanzie.**
Dal 08/09 il fascicolo accetta pratica fiscale, asseverazione, ENEA;
`server/routers/garanzie.ts` tiene `durataMesi` e la data di fine.
Nessuna delle due scadenze entra nella fotografia. Sono soldi del
cliente.
*Costo 1 · valore medio.*

**15. Due sedi, due liste, nessun confronto.**
L'analisi gira per sede. Non esiste la riga «Sarzana è ferma da una
settimana, La Spezia no».
*Costo 0,5 · valore medio.*

**18. Agenda e magazzino non si parlano.**
«Giovedì hai due pose e la merce di una non è arrivata» è un join di due
tabelle che nessuno scrive. Dipende dal punto 1.
*Costo 1 · valore alto.*

### Distribuzione — la proposta giusta alla persona sbagliata

**3. Le proposte non hanno destinatario.**
`destinatarioPerTema` esiste dal 03/09 (T6) e lo usa la chat;
**l'analisi no**. Il mattino è una pila sola per la direzione:
l'amministrazione non vede le sue fatture, chi ha la commessa non vede il
suo gate.
*Costo 1 · valore alto.*

**5. Gira solo a orario.**
Una volta al mattino, si rifà dopo quattro ore o dopo mezz'ora se hai
gestito tutto. Nessun evento la sveglia: fattura incassata, ticket
urgente, consegna saltata — se ne parla domani.
*Costo 1 · valore medio.*

**6. Non chiude il cerchio.**
Mai un consuntivo: «ieri sei proposte, quattro fatte, ecco cosa è
cambiato».
*Costo 1 · valore medio.*

**11. Non prepara il messaggio.**
Il prompt vieta le proposte di risposta perché Tars non invia. Ma il
follow-up preventivi già scrive `bozzaSollecito`. Stessa mossa ovunque:
Tars scrive la bozza, la persona preme invia.
*Costo 1,5 · valore medio · **richiede una decisione**: quanto Tars può
scrivere al posto di una persona.*

### Potenza — vede e non può fare

**2. Dieci strumenti proponibili su cinquantasei.**
`STRUMENTI_PROPOSTE_ESEGUIBILI` (`analisi/analisi.ts`) è una lista corta
scritta a mano. Il freno vero è al click
(`catalogoAzioniPerContesto`, in `analisi/esecuzione.ts`), che ricontrolla
tutto sull'utente. La lista corta costa copertura, non sicurezza:
allargarla a ciò che non è soldi, cancellazione o effetto esterno dà
subito l'unione dei doppioni, il collegamento al cliente, note e priorità.
*Costo 0,5 · valore alto.*

**20. Tagli silenziosi.**
`slice(0, 8)`, `slice(0, 10)`, `slice(0, 12)` in tutta la fotografia.
L'undicesimo preventivo fermo non può ricevere una proposta, mai, e da
nessuna parte è scritto «e altri quattordici».
*Costo 0,2 · valore utile — sparisce da solo col punto 19.*

### Memoria — dimentica tutto ogni notte

**4. Memoria di un giorno solo.**
Ricorda solo le proposte «scartate **oggi**» (`analisi/worker.ts`).
Domani la stessa proposta torna identica. Dovrebbe restare scartata
finché il fatto sotto non cambia.
*Costo 1 · valore alto.*

**10. Non ricorda cosa gli hai detto.**
La memoria esiste (T7, `leggi_memorie`), ma la fotografia non ha una
sezione memoria e il prompt legge **solo** la fotografia. «Non propormi
più di archiviare le dormienti», detto in chat, non arriva al mattino
dopo.
*Costo 1 · valore alto.*

**25. Due cervelli scollegati.**
La chat (`orchestratore.ts`) ha memoria, cinquantasei strumenti e la
conversazione. Il mattino ha una fotografia e nient'altro. Quello che
gli spieghi alle 15:00 non esiste alle 07:00. Stesso guasto del 10, visto
dall'architettura.
*Costo 1,5 (insieme al 10) · valore alto.*

**24. Non impara dal correttivo.**
Quando la persona fa una cosa **diversa** da quella proposta — un altro
stato, un'altra data, un'altra persona — quella differenza è il segnale
più forte che esista, e non viene registrata da nessuna parte.
*Costo 1,5 · valore alto.*

### Tempo — la fotografia non è un film

**16. Nessuna derivata.**
Le analisi passate sono salvate una al giorno e nessuno le confronta.
«12 preventivi fermi» non dice niente; «12, ieri erano 8» dice tutto.
*Costo 0,5 · valore alto.*

**17. Nessun tempo di attraversamento.**
`server/commesse/transizioni.ts` registra ogni cambio di stato da
sempre: la mediana dei giorni per stato è già nei dati e nessuno la
calcola. Con quella, «in produzione da 40 giorni, la mediana è 18»
sostituisce le soglie inventate a mano — i 7 giorni del sollecito, i 30
del perso — con soglie che l'azienda ha prodotto da sola.
*Costo 2 · valore alto — smette di applicare regole e comincia a
conoscere il mestiere.*

**21. Nessuna causa.**
La timeline c'è. «È ferma» e «è ferma perché aspetta il vetro da venti
giorni» sono la differenza fra una segnalazione e un'azione.
*Costo 2 · valore medio.*

### Giudizio — tutto ha lo stesso peso

**22. Non pesa cosa costa ignorarla.**
Le proposte non sono ordinate per posta in gioco: il gate su un lavoro da
quarantamila sta accanto alla nota su una dormiente. L'ordine giusto è
soldi a rischio × giorni di ritardo, conto deterministico del dominio.
Dipende dal punto 8.
*Costo 1 · valore alto.*

**23. Nessuna confidenza.**
Una lettura OCR al 60 % ha lo stesso aspetto di una certa. L'evidenza è
già salvata («Dove l'ho letto»): portarla nella proposta dice quali
fidarsi e quali aprire.
*Costo 0,5 · valore medio.*

### Misura — nessuno sa se le proposte sono buone

**12. Nessun tasso di accettazione.**
Ogni proposta registra se è stata eseguita o scartata, ma **non da quale
sezione è nata**: il modello scrive testo libero. Aggiungendo `fonte`
allo schema si ottiene «gate 80 %, dormienti 5 %» — insieme la taratura
automatica dei posti e l'unica prova che una modifica al prompt ha
migliorato invece di peggiorato.
*Costo 1 · valore alto — rende misurabile tutto il resto.*

**13. Un giro solo, sei posti, nessuna verifica.**
Una chiamata al giorno per sede. Generarne dodici e farne scegliere sei a
un critico costa centesimi e alza la qualità senza toccare la fotografia.
*Costo 0,5 · valore medio.*

### Il salto

**19. Il modello non può chiedere niente.**
L'analisi è un colpo solo: fotografia dentro, JSON fuori, **zero
strumenti**. In chat Tars ne ha cinquantasei, al mattino nessuno. Dargli
i soli strumenti di lettura e tre o quattro giri — si fa un'idea, la
verifica, poi propone — è il salto più grande della lista, e è la policy
già scritta in `CLAUDE.md` («il modello decide e chiama gli strumenti»)
applicata all'unico posto dove non vale.
*Costo 4 · valore molto alto · **richiede una decisione**: l'analisi
diventa più cara per giro, e va misurata (punto 12) prima e dopo.*


### Documenti — il fascicolo non sa cosa contiene

**26. Il documento non ha versioni: l'ultima parola non esiste.**
`trovaDuplicatoNelFascicolo` confronta il checksum SHA-256 **dentro una
sola commessa**: byte identici, stesso file. Ma il cliente che rimanda
«misure.pdf» corretto produce byte diversi, quindi un secondo documento
scollegato dal primo. Il fascicolo ha due misure e nessuno sa quale vale;
il posatore apre quella sbagliata. Serve la catena: stesso tipo e stessa
commessa → il nuovo è **vigente**, il vecchio **superato** (conservato,
non cancellato), e quando i due differiscono su un campo leggibile
(misure, date, importi) Tars lo dice invece di lasciarli convivere.
*Costo 2 · valore alto.*

**29. Nessuno confronta il documento con il dato.**
Tars estrae già numero d'ordine, imponibile e settimana di consegna dalla
conferma, e li usa per far nascere il costo. Non li **confronta** mai con
quello che il CRM sa già: la consegna dichiarata dal fornitore contro la
data a magazzino, l'imponibile contro il pattuito, l'indirizzo di posa
contro quello in commessa. Ogni documento che entra è un'occasione di
riscontro, e oggi il riscontro serve solo a collegare il file. È la
classe di errori più cara — la merce arriva dopo la posa — ed è la più
facile da vedere: due numeri, un confronto.
*Costo 1,5 · valore alto — il rapporto migliore di tutta la lista.*

**31. Il gate non sa che lavoro è.**
`documentiRichiesti(stato)` dipende **solo dallo stato**: la stessa lista
per tutti. Ma un condominio vuole la delibera, una detrazione vuole
asseverazione ed ENEA, un lavoro con fornitore vuole la conferma
d'ordine. Dal 08/09 il fascicolo conosce dodici tipi nuovi e il gate non
li usa: i documenti richiesti dovrebbero nascere dalla natura del lavoro,
non dalla sola casella in cui si trova.
*Costo 2 · valore medio.*

### Comunicazioni — la posta non diventa memoria

**27. Il messaggio non è una conversazione.**
Non esiste `inReplyTo`, non esistono `references`, non esiste un thread.
Ogni messaggio è un'isola: Tars vede «tre comunicazioni non collegate» e
non «il cliente ha chiesto la stessa cosa tre volte in dieci giorni e
nessuno ha risposto». Per la mail i riferimenti arrivano già dentro
l'IMAP; per WhatsApp il filo si deriva da numero e vicinanza nel tempo.
Cosa apre: la ripetizione come segnale di frustrazione, la latenza vera
di risposta per interlocutore, e la domanda del cliente ancora senza
risposta.
*Costo 1,5 · valore alto.*

**28. Le promesse dette nei messaggi non esistono da nessuna parte.**
«Ti mando le misure lunedì». «Vi confermiamo la consegna entro il 20».
«Le passo il preventivo domani». Sono obbligazioni con una data, prese da
noi o dalla controparte, e il CRM non ne conserva nessuna: registra i
fatti (documenti, stati, date di sistema) e butta gli impegni presi a
parole, che sono il modo in cui il lavoro funziona davvero. Tars legge
già ogni messaggio in entrata: da lì estrae `{chi, cosa, entro quando}`,
ne fa un promemoria a scadenza e tiene la frase originale come prova.
Una promessa scaduta e non mantenuta è il rischio migliore che l'analisi
possa proporre — e nasce da testo che oggi si getta.
*Costo 2,5 · valore molto alto.*

**30. Il file che esce non è tracciato come quello che entra.**
Gli allegati in arrivo ora vivono nel fascicolo. Quelli in uscita no: il
preventivo mandato al cliente, il contratto spedito per firma, l'ordine
mandato al fornitore. Se parte dalla casella personale di qualcuno il CRM
non lo sa; se parte dal CRM non resta la copia esatta di ciò che il
cliente ha ricevuto. Conseguenze: «il preventivo è fermo da sette
giorni» resta una deduzione dall'attività invece che un fatto; non si sa
quale versione ha in mano il cliente (v. punto 26); in contestazione non
c'è la prova. Il fascicolo deve avere due lati.
*Costo 3 · valore alto · **richiede una decisione**: si invia dal CRM, o
ci si limita a catturare copia di quello che parte da fuori.*

---

## 2. Blocchi consigliati

### Blocco A — «il mattino smette di mentire» (2,2 giornate)

Punti **7, 1, 16, 2, 20**.

Sono i cinque più economici e tre di loro sono difetti, non mancanze:
Tars che dice «tutto calmo» mentre la posta è ferma; il magazzino che non
esiste; il numero senza il confronto di ieri. Il 2 e il 20 sono due mezze
ore che allargano cosa può fare e cosa può vedere.
Dopo questo blocco la lista del mattino è già un altro oggetto.

### Blocco B — «ricorda e si misura» (3,5 giornate)

Punti **12, 4, 3, 23**.

Il 12 per primo, perché senza `fonte` sulle proposte ogni modifica
successiva è a occhio. Poi la memoria che dura più di un giorno, il
destinatario giusto, e la confidenza in chiaro.
Dopo questo blocco si può dimostrare se un cambiamento migliora.

### Blocco C — «conosce il mestiere» (5,5 giornate)

Punti **17, 8, 22, 18**.

Le soglie nascono dai dati invece che a mano; il margine entra come
flag; le proposte si ordinano per quanto costa ignorarle; agenda e
magazzino si parlano.
Qui serve la decisione sul margine.

### Blocco D — «il salto» (7 giornate)

Punti **19, 24, 10 + 25**.

L'analisi diventa capace di indagare, e comincia a imparare da cosa fai
di diverso. Da fare dopo il blocco B, mai prima: senza misura non si
saprebbe se è migliorata.

### Blocco E — coperture (9 giornate, in qualsiasi ordine)

Punti **9, 11, 14, 15, 5, 6, 21, 13**.

### Blocco F — «i documenti dicono la verità» (5,5 giornate)

Punti **29, 26, 31**.

Il 29 per primo perché è il rapporto costo/valore migliore della lista:
due numeri e un confronto, e si scopre che la merce arriva dopo la posa.
Poi la catena delle versioni, poi il gate che dipende dal lavoro e non
dalla casella.

### Blocco G — «la posta diventa memoria» (7 giornate)

Punti **27, 28, 30**.

Il filo della conversazione, le promesse dette a parole, il lato in
uscita del fascicolo. Preso intero, questo blocco fa smettere alla posta
di essere un flusso da smaltire e la trasforma nella memoria di cosa è
stato detto a chi.

---

## 3. Decisioni che servono prima

1. **Margine (punto 8)**: chi vede le cifre — solo direzione, o anche
   amministrazione e chi ha la commessa?
2. **Bozze al cliente (punto 11)**: Tars può scrivere il testo che una
   persona invierà a suo nome?
3. **Larghezza della lista (punto 2)**: si allarga a tutto ciò che non è
   soldi, cancellazione o effetto esterno, o si sceglie voce per voce?
4. **Costo del salto (punto 19)**: l'analisi con strumenti costa di più
   per giro; si accetta, misurando prima e dopo?
5. **Lato in uscita (punto 30)**: si invia dal CRM — e allora la copia
   esatta resta sempre — oppure ci si limita a catturare copia di quello
   che parte dalle caselle personali?

## 4. Fuori perimetro

Non compaiono qui, e non sono dimenticanze: l'invio autonomo di mail e
WhatsApp, le proposte su pagamenti e importi, le cancellazioni definitive
senza conferma umana, lo scavalco dei gate documentali. Restano come
sono.
