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

### T1 — Gli strumenti che mancano (sblocca i casi già segnalati)

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

### T4 — Follow-up commerciale sui preventivi

Il 71% del portafoglio è in preventivo. Tars segue: promemoria a chi ha in
carico, bozza del messaggio al cliente, e dopo N giorni senza risposta
propone di archiviare. È qui che si vede o non si vede il ritorno.

## 5. Domande alla direzione (cambiano il piano)

1. Gli ordini ai fornitori si fanno via mail/PEC e non entrano nel CRM:
   Tars deve **leggere le conferme d'ordine dalle mail** e tenere lui le
   date di consegna, oppure lasciamo perdere il modulo ordini?
2. La posa: il calendario vive fuori (3 interventi nel CRM). Tars deve
   **pianificare gli interventi nel CRM** o basta che ricordi le date?
3. Preventivo: dopo quanti giorni senza risposta un preventivo è da
   sollecitare, e dopo quanti è perso?
4. Chi deve ricevere cosa: le proposte sono per la direzione o vanno
   assegnate a chi ha in carico la commessa?
