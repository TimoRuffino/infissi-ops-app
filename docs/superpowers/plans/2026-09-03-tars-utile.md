# Tars utile: come lavora davvero l'azienda e cosa deve saper fare

Mandato della direzione (03/09/2026): «le proposte non portano a niente di
utile. Analizza Tars e quello che può fare e che fa, e studiamo un piano
per migliorarlo. Per capire come può diventare utile prima devi capire i
processi aziendali e come vengono gestite le commesse».

Tutto ciò che segue è misurato sui dati di produzione del 03/09/2026, non
dedotto dai documenti.

## 1. Che azienda è, nei dati

| Cosa | Quanto | Nota |
|---|---|---|
| Commesse | 392 (372 attive) | **263 in «preventivo»**: il 71% del portafoglio |
| Clienti | 956 | |
| Documenti nel fascicolo | 548 (137 MB) | ancora base64 dentro il blob JSONB |
| Step di timeline | 3.927 | la timeline è lo strumento di avanzamento più usato |
| Transizioni di stato registrate | 106 | il board si tocca poco: avanza la timeline |
| Fatture FiC | 340 (1 non collegata) | contabilità agganciata bene |
| Costi FiC | 2.074 | |
| Ticket post-vendita | 32 | |
| Comunicazioni | ~10.000, 3.300 smistate da Tars | |
| **Ordini fornitore** | **0** | modulo non usato: gli ordini viaggiano via mail |
| **Fornitori** | **0** | idem |
| **Reclami / rifacimenti** | **0** | il post-vendita passa dai ticket |
| **Interventi pianificati** | **3** | il calendario di posa vive fuori dal CRM |
| Squadre | 8 | anagrafica presente, planning no |

Attività reale delle commesse (ultimo fatto vero: documento, transizione,
step, comunicazione): 335 su 372 toccate negli ultimi 30 giorni, 31 fra 31
e 90 giorni, 6 oltre 90. Le più ferme sono preventivi di 3-4 mesi fa mai
più toccati (COM-2026-024 Soare, -025 Butticè, -026 Carotenuto, -029
Colline del Sole).

**Il lavoro vero, in ordine di volume**: preventivi da portare avanti o
chiudere, documenti da mettere nel fascicolo giusto, comunicazioni da
smistare e a cui rispondere, fatture e incassi. Posa, ordini a fornitore e
reclami esistono nel CRM ma non ci vivono dentro.

## 2. Come si muove una commessa

Stati (`STATI_COMMESSA`, un passo alla volta): preventivo → misure
esecutive → aggiornamento contratto → fatture e pagamento → da ordinare →
produzione → ordini/ultimazione → attesa posa → finiture e saldo →
interventi e regolazioni → archiviata.

Ogni stato ha un **gate documentale**: per uscire serve un documento del
tipo giusto, caricato mentre la commessa era in quello stato (preventivo o
contratto; misure; contratto; fattura; ordine o conferma d'ordine; —;
saldo o fattura; DDT di consegna; DDT di posa; DDT finale). Il board
permette «Procedi comunque», registrato. La timeline (3.927 step) fa
avanzare il board quando si completa una milestone.

Quindi il ciclo reale è: **documento → gate → stato → timeline**, con le
comunicazioni (mail e WhatsApp) come fonte della maggior parte dei
documenti e delle decisioni, e FiC come fonte della verità economica.

## 3. Perché oggi Tars sembra inutile

1. **Propone su moduli vuoti.** L'analisi cita «ritardi fornitore» e
   «ordini scoperti» quando ordini e fornitori sono a zero: sono pattern
   calcolati su dati che non esistono.
2. **Parlava per id.** «Aggiorna il ticket 11», «la commessa 133»: chi
   legge non ha modo di sapere di cosa si tratti (corretto il 03/09: nomi
   e link ovunque).
3. **Misurava il tempo sbagliato.** «Ferma da N giorni» usava
   `commesse.updatedAt`, riscritto in blocco dai lavori di fondo: nessuna
   commessa risultava mai ferma (corretto il 03/09: attività reale).
4. **Non sa toccare i documenti.** Non trova una fattura per numero, non
   la collega a una commessa, non sposta un documento nel fascicolo
   giusto: proprio il lavoro che si fa tutto il giorno.
5. **Non sa cercare una comunicazione** se non partendo da una commessa o
   da un cliente: «il messaggio del numero 337…» è fuori portata.
6. **Ignora il collo di bottiglia vero**: 263 preventivi, nessuna nozione
   di preventivo da seguire, scaduto o perso.

## 4. Piano

### T1 — Gli strumenti che mancano (sblocca i casi già segnalati) — FATTO il 03/09/2026 per ricerche+fatture+documenti; `leggi_timeline`, `completa_step_timeline` e `crea_cliente_da_messaggio` restano da fare (rimandati a T2/T3)

- `cerca_comunicazioni`: testo libero, numero di telefono, mittente,
  periodo, canale. Sede-scoped, estratti.
- `cerca_documenti` e `sposta_documento`: trovare un documento per nome,
  tipo, commessa o cliente; spostarlo nella commessa giusta (servizio di
  dominio nuovo, con gate ricalcolato e registrato).
- `cerca_fatture` e `collega_fattura_commessa`: la procedura
  `fic.fatture.collega` esiste già e fa tutto (pattuito, incassi, PDF nel
  fascicolo); serve solo esporla come strumento.
- `leggi_timeline` e `completa_step_timeline`: l'avanzamento vero passa
  di lì.
- `crea_cliente_da_messaggio`: da una comunicazione WhatsApp o mail,
  cliente e commessa in un colpo, con i dati estratti dal testo.

### T2 — La fotografia guarda dove si lavora

Fuori i segnali su moduli vuoti. Dentro:
- preventivi fermi da più di N giorni (attività reale) con il valore e il
  contatto;
- gate documentali mancanti sulle commesse attive (documento che blocca
  il passo successivo);
- fatture non collegate o non incassate;
- comunicazioni senza risposta oltre 24 h e proposte di collegamento;
- ticket aperti senza assegnatario.

### T3 — Proposte che si eseguono, non che si leggono

Oggi una proposta dell'analisi apre la chat con la frase già scritta. Deve
diventare un bottone che **fa la cosa**, con Undo dove il dominio lo
consente: «Collega la fattura n. 130 a COM-2026-168», «Sposta il DDT nella
commessa giusta», «Ricorda al commerciale il preventivo Soare».

### T4 — Il calendario dentro il CRM (D2)

`leggi_agenda` (giorno/settimana, per squadra o per commessa),
`pianifica_intervento` esteso (ora, squadra, spostamento), `sposta_intervento`
e `segna_intervento_fatto` che porta avanti la commessa. La vista Planning
diventa la fonte, i calendari Google importati restano solo come sfondo
finché non si spengono.

### T5 — Follow-up commerciale sui preventivi

Il 71% del portafoglio è in preventivo. Ritmo deciso (D3): **7 giorni** di
silenzio → sollecito a chi ha in carico, con la bozza del messaggio al
cliente; **30 giorni** → proposta di chiuderlo come perso. È qui che si
vede o non si vede il ritorno.

### T6 — Ogni proposta al suo destinatario (D4)

Le proposte e le notifiche nascono con un destinatario derivato da
assegnatario della commessa, ruolo, stato della commessa e natura del
tema (commerciale, amministrativo, post-vendita). La coda «di tutti»
sparisce: ognuno vede la sua, la direzione vede tutto e ciò che non ha
padrone.

## 5. Decisioni della direzione (03/09/2026)

- **D1 — Ordini dai messaggi, non dal modulo.** Il modulo Fornitori resta
  vuoto. Tars legge le conferme d'ordine che arrivano via mail/PEC
  (Antenore, Oknoplast, Primed…), ne ricava fornitore, riferimento e data
  di consegna, li tiene sulla commessa e segnala i ritardi.
- **D2 — Il calendario diventa quello del CRM, Google si spegne.** Oggi è
  il contrario: il CRM ha 3 interventi, espone un feed ICS che Google
  sottoscrive (`calendarSync.ts`) e importa in sola lettura i calendari
  Google nel Planning (`externalCalendars.ts`, 3 sorgenti). Gli
  appuntamenti veri vivono su Google. Tars deve: leggere gli appuntamenti
  (interventi CRM e, finché esistono, quelli importati) e capire a quale
  commessa e cliente appartengono; **inserirli e spostarli** nel CRM con
  data, ora, tipo e squadra; far seguire la commessa (posa fissata →
  attesa posa, posa fatta → finiture e saldo, rilievo fatto → misure) con
  lo stesso gate e lo stesso Undo delle altre transizioni. Fine corsa:
  Google spento, al massimo resta il feed in uscita per il telefono.
- **D3 — Ritmo commerciale.** Un preventivo senza risposta si sollecita
  dopo **7 giorni**; dopo **30** si propone di chiuderlo come perso.
- **D4 — Ogni proposta ha un destinatario.** Non esiste la coda «di
  tutti»:
  - commessa assegnata a un commerciale + tema commerciale (preventivo,
    sollecito, cliente) → solo a quell'utente;
  - tema amministrativo (fattura, pagamento, incasso) o commessa negli
    stati «fatture e pagamento» / «ordini e ultimazione» → amministrazione;
  - post-vendita → chi ha il ticket in carico, altrimenti chi ha la
    commessa;
  - direzione: vede tutto, più ciò che non ha un assegnatario.
  Le notifiche seguono lo stesso criterio: stessa proposta, stesso
  destinatario.

## 6. Domande residue

- Quale casella/PEC riceve le conferme d'ordine, e con quale mittente
  tipico? (serve a Tars per riconoscerle senza aprire tutto)
- Chi sono i commerciali da considerare assegnatari per D4, e come si
  assegna oggi una commessa?
