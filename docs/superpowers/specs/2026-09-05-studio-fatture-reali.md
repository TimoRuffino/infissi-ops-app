# Studio: come la commercialista fa limiti e fatture, e cosa cambia nel CRM

Data: 05/09/2026 sera. Mandato della direzione: «analizza almeno 10 fatture e
10 contratti di clienti diversi, rifai limiti e fattura con il CRM, studia le
differenze». Nessun nome di cliente in questo documento: i dati grezzi
(fatture con righe, fogli, contratti) stanno fuori dal repository.

## 1. Materiale

| Fonte | Cosa | Quanti |
|---|---|---|
| Fatture in Cloud (API, sola lettura) | fatture emesse 2026 con tutte le righe | 131, di cui 74 con lo schema beni/servizi |
| PDF sul Desktop e in Downloads | fatture stampate | 23 (12 con lo schema completo) |
| Fogli «Limiti …» (xlsm) | contratto (righe, misure, prezzi), limiti per voce, colonna «Da fattura» = importi davvero fatturati | 18 lavori |
| CRM produzione (DB, sola lettura) | 3 contratti strutturati, 15 computi, 5 bozze, 340 intestazioni FiC | — |
| Fixture `server/computo/__fixtures__/casi-reali.json` | gli stessi 18 fogli + 2 contratti, anonimizzati | 20 casi |

Metodo: per 19 lavori con contratto e fattura (18 fogli + un contratto letto
dal CRM) si è fatto girare `calcolaLimiti` e il risolutore del CRM sul
contratto e si è confrontato con la fattura reale, riga per riga
(`confronto.json` nello scratchpad di sessione).

## 2. Cosa fa davvero la commercialista

1. **Pattuito fisso.** Il totale della fattura è il prezzo del contratto
   (lordo nei contratti, imponibile nei fogli). Tutto il resto si adatta.
2. **Servizi = limiti arrotondati all'euro per difetto**, quando il pattuito
   basta (129, 37, 59, 49: coincidenza al centesimo con la colonna «Da
   fattura» del foglio). Il CRM fa già così.
3. **Quando beni a contratto + servizi ai limiti superano il pattuito**, non
   lascia mai un markup negativo: scende. In 6 lavori su 15 taglia solo i
   servizi tenendo i beni a contratto (markup 0); negli altri abbassa
   anche i beni significativi e tiene un markup positivo «tondo» (300,
   408, 459, 574, 600, 650, 1.082, 2.153…). Nei lavori piccoli i servizi
   scendono anche sotto il limite della singola voce (una finestra: rilievo
   40, progettazione 30, sviluppo 30, posa 250).
4. **Markup** = residuo, mai un importo scelto a priori: con il pattuito
   capiente resta positivo con i beni a contratto (49, 129).
5. **Voci di servizio**: una sola riga di rilievo; spese professionali solo
   con visto (600) oppure 100-150 «BC/Bonus Casa/Enea» al 22 % fra i beni;
   assistenza muraria e pulizia spesso a zero; eventuali solo se servono.
6. **Beni non significativi al 10 %.** Persiane, tapparelle/avvolgibili,
   zanzariere, grate, tende stanno nella prestazione («beni dotati di
   autonomia funzionale»), sempre al 10 %, mai nel blocco al 22 % con lo
   storno (129, 37, 32, 59, 118, 64, 80, 83, 91). Maniglie e coprifili del
   serramento restano nel blocco al 22 % (127).
7. **Storno = min(B, P)** confermato su tutte le fatture; B comprende le
   spese professionali al 22 % (118, 128). Ecobonus con B ≤ P: tutto al 10 %.
8. **Presentazione**: una riga per famiglia di beni con l'elenco dei
   serramenti nella descrizione; il CRM una riga per riga di contratto.
   Non è un errore, Fatture in Cloud accetta entrambe.
9. **Rate** 50/40/10 dalla data fattura, come il default del CRM.

## 3. Differenze trovate nel CRM e cosa è cambiato (05/09 sera)

| # | Differenza | Cambiamento |
|---|---|---|
| A | La bozza nasceva con markup negativo appena beni + servizi superavano il pattuito (tutte le prove della direzione) | `bilancia` nel generatore: servizi in proporzione fino a `FATTORE_MINIMO_SERVIZI` (40 %) dei limiti, poi beni significativi in proporzione (`riequilibraBeni`), markup mai negativo; con il pattuito capiente nulla cambia. Avvertenze esplicite. `creaBozza`/`rigeneraBozza` la usano; i test legacy tengono la proposta grezza con `bilanciaBozza: false` |
| B | Beni non significativi al 22 % sulla riga (il risolutore li contava già in P al 10 %: righe e riepilogo non coincidevano) | riga `bene` non significativa al 10 % |
| C | `beneSignificativoDefault` metteva persiane, tapparelle, cassonetti, scuri, schermature, zanzariere, tende, pergole fra i significativi | seed e client allineati: solo serramenti, blindati, portoncini e porte interne sono significativi; le righe già salvate restano come sono (checkbox nella riga del contratto) |
| D | Ricerca del cliente su Fatture in Cloud con `q=<codice fiscale>` nudo → HTTP 422 «Invalid query syntax»: la prima emissione reale si è fermata in «in emissione» | query `tax_code = '…'` (o `vat_number = '…'` per 11 cifre), apici raddoppiati |
| E | Una fattura «in emissione» senza documento FiC non aveva alcuna azione in UI | pulsante «Riprendi emissione» (capability `fattura.emit`): i passi sono idempotenti |
| F | Stampa: condizioni di pagamento ripetute (dicitura + piè di pagina di sede) | il piè di pagina non si stampa se ripete il corpo |
| G | Numerazione FiC: nella configurazione c'era «2026», che Fatture in Cloud rifiuta (HTTP 422 «data.numeration format is invalid»); tutte le 131 fatture 2026 usano la numerazione predefinita (vuota) | `numerazioneFicValida`: si manda solo una numerazione nella forma «/A»; la configurazione accetta vuoto o «/…»; nota nel pannello. Il valore «2026» va svuotato a mano in Impostazioni → Fatturazione |
| H | Un'emissione ferma prima del documento FiC non si poteva annullare | «Annulla emissione» (capability `fattura.draft`) quando manca `ficDocumentId`; con il documento creato restano «Riprendi» e la nota di credito |

## 4. Aperto

- Cassonetto: trattato come non significativo (segue la tapparella nel
  massimale B); da confermare con la commercialista alla prima fattura con
  cassonetti.
- Listino dei servizi per i lavori piccoli: la commercialista usa importi
  propri sopra il limite di riga; il CRM propone il 40 % dei limiti come
  pavimento. Se serve, un listino di sede per taglia del lavoro.
- Le righe dei contratti già salvati in produzione con persiane/zanzariere
  significative vanno corrette a mano (checkbox) prima della bozza.
- La bozza in «in emissione» sulla commessa reale di settembre va ripresa
  dopo il deploy con «Riprendi emissione» (o annullata e rifatta).

## 5. Seconda tornata (05/09 notte): anti-doppione, confronto, banco di prova

| # | Cosa | Esito |
|---|---|---|
| I | **Anti-doppione all'emissione**: prima di creare il documento su FiC si leggono le fatture degli ultimi 120 giorni; stesso cliente (id FiC o nome) e stesso lordo a 1 € vicino → la fattura resta «in emissione» con `DOPPIONE_FIC`; «Emetti comunque» (fattura.emit) scavalca; se FiC non risponde il controllo si salta dichiarandolo. In bozza lo stesso sospetto è l'avviso `doppione_fic_sospetto` dalle fatture già sincronizzate | fatto, con test |
| L | **Confronto bozza ↔ fattura vera** (`fatture.confrontaConFic`, pannello «Fattura vera a confronto» nell'editor): la fattura FiC collegata alla commessa (o dello stesso cliente con lordo vicino) letta con le righe e messa a confronto voce per voce con le regole dello studio (`server/fatture/confronto.ts`) | fatto, con test |
| M | **Banco di prova della lettura del contratto dal vivo**: tre contratti WnD veri (127, 129, 130) in `server/contratti/eval/casi-reali/` (gitignored) con la verità scritta a mano dai PDF; runner `scripts/eval-contratti-reali.ts` con il modello vero (serve un PostgreSQL per il ledger dei costi) | fatto; risultati sotto |

**Risultati del banco di prova (modello reale, 3 contratti, 111 campi giudicati):**

| Contratto | Campi corretti | Cosa manca |
|---|---|---|
| 127 (3 serramenti, coprifili, accessorio) | 24/25 | comune del cantiere non proposto (il contratto non lo dice: il giudizio è severo) |
| 130 (4 serramenti, 2 coprifili, posa a parte) | 29/29 | — |
| 129 (5 serramenti, 7 persiane dentro una riga generica, coprifili) | 42/57 | il blocco delle persiane, scritto in prosa nella descrizione, esce con ordine e numero di righe diversi da una lettura all'altra (12 o 13 righe); i cinque serramenti in tabella sono tutti giusti |

Totale: 95 su 111 campi (86 %); sui blocchi tabellari del layout WnD 100 %, l'incertezza è tutta nel testo libero.

**Due difetti trovati solo dal vivo, mai dai test:**
- lo schema strict rifiutava `pagina: 0`, che il modello usa per «nessuna fonte» (cantiere assente): la lettura intera andava persa (`ESTRAZIONE_RISPOSTA_INVALIDA`). Ora lo 0 vale «nessuna evidenza» e il campo resta da verificare;
- con l'IVA al 22 % nel preventivo la commercialista tiene a volte il lordo (129) e a volte l'imponibile (130): non si indovina dal documento. Il layout propone il lordo (D-G) e segna pattuito e tipo come **da confermare** quando «IVA Beni / Totale IVA Esc.» supera il 15 %.

## 6. Confronto dal vivo 129 (05/09 notte) e ordine del bilanciamento

Il pannello «Fattura vera a confronto» in produzione, stessa commessa,
bozza CRM (bilanciata «servizi prima») contro la fattura vera:

| Voce | Bozza CRM | Fattura vera | Perché |
|---|---|---|---|
| Beni significativi 22 % | 8.770,67 | 3.562,00 | il CRM aveva ancora le persiane fra i significativi (righe salvate prima del nuovo default) e i beni a contratto |
| Beni autonomi 10 % | 340,20 | 3.020,91 | le persiane stanno qui, al 10 %, ridotte del 29 % |
| Servizi | 2.929,00 | 5.058,00 | lei li tiene ai limiti (5.076 arrotondati), il CRM li aveva tagliati per far posto ai beni |
| Markup | 5,79 | 1.170,00 | residuo in entrambi; lei arrotonda i beni a cifra tonda e il residuo cresce |
| Imponibile | 12.195,66 | 12.810,91 | stesso lordo (14.092,71 contro 14.092,00): più valore al 10 % = meno IVA = più imponibile |

Lezione: a parità di lordo ogni euro spostato dai beni significativi
(22 % oltre la prestazione) ai servizi o ai beni autonomi (10 %) alza
l'imponibile, cioè il ricavo dell'azienda e la spesa detraibile del cliente.
Quindi il bilanciamento ora **abbassa prima i beni significativi** (fino al
60 % del contratto) e solo dopo i servizi (fino al 40 % dei limiti). Sulla
129, con le persiane al 10 %, il CRM arriva a imponibile 12.811,55 contro i
12.810,91 della fattura vera: differenza 0,64 €, split interno diverso
(finestre 3.127 senza markup, contro 3.562 + 1.170 di markup), IVA uguale.
Restano a mano: la spunta «significativo» sulle righe vecchie e le spese di
documentazione (150 di default) che lei su questa fattura non ha messo.

## 7. Fase 1 (06/09/2026): motore limiti su tutti i fogli del backup

Materiale: 94 fogli «CALCOLO NUOVI LIMITI» dal backup del NAS (cartella
«dati x claude» sulla scrivania, mai nel repository): 2026, 2025, 23-24,
CALCOLI LIMITI 2022, Check-Limiti. Edizioni riconosciute dai prezzi unitari
di CHECK1: **corrente** (rilievo 60,17 €/h: 31 fogli, compresi i 2026),
**2023-i** (Ver.31/32, DEI 1° sem 2023, rilievo 61,22: 47 fogli),
**2022-ver27** (13/10/2022, rilievo 59,63: 4 fogli), più 6 fogli Ver.9 del
2022 con un altro layout (13 fogli invece di 16) lasciati fuori.

Cosa è cambiato per farli tornare:
- **tariffe a edizioni** (`tariffeEdizione`, seed `tariffe-seed-2023-i.json`
  e `tariffe-seed-2022-ver27.json` estratti dai fogli maestri con lo script
  esistente; €/mc dello smaltimento per edizione: 104,69 / 112,64 / 102,27);
  il CRM calcola sempre con «corrente», le edizioni servono a riprodurre i
  computi passati;
- **prezzi del singolo foglio** (`tariffeFoglio` nel caso: colonna E di
  CHECK1 e €/mc dalla formula di H29): le copie compilate hanno prezzi
  ritoccati a mano (sviluppo ordine 31,22 invece di 61,22, spese minime 185
  invece di 600) e senza registrarli nessuna edizione li riproduce;
- **finestre da tetto (velux)** accettate nel blocco PVC, senza minimo di
  1 mq e senza accessori (così le prezza il foglio);
- **piano «T»** in INIZIO E19: per Excel un testo è > 4, il foglio applica il
  +30 % del tiro al piano; il raccoglitore lo riproduce con piano 5 e lo
  dichiara;
- spese professionali del foglio = max(minimo, 4 % della colonna «Da
  fattura»): il motore usa il pattuito come base, che coincide con la
  colonna G quando il foglio è compilato fino in fondo.

Risultato: **77 casi d'oro** (da 20), **67 riprodotti al centesimo**
(corrente 28/31, 2023-i 35/42, 2022-ver27 4/4), 10 saltati con motivo
scritto: 5 fogli 2023 con tapparelle (ogni avvolgibile vale 60-67 € in più
nel foglio: formula o accessorio del blocco B di quell'edizione, da
indagare), 2 fogli con schermature o veneziane prezzate a pezzo (H3), 1 riga
alluminio con persiana a +653,80 € (da indagare), 1 «serramento + persiana»
senza persiana, 1 tapparella con doppio prezzo (H6); i massimali di 3 fogli
2023 differiscono di 1-2 € su ~10.000 (tolleranza allargata, non salto).

## 8. Fase 2 (06/09/2026): le regole di fattura su 29 lavori con foglio e fattura vera

Materiale: i 10 fogli «Limiti fatture 2025» e i 19 del 2026 (colonna G
«Da fattura» di CHECK1, riga per riga), abbinati alla fattura FiC dal numero
nel nome della cartella («147_25» = 147/2025) o dal cognome; le 201 fatture
2025 lette via API con le righe, come le 131 del 2026. Su 29 fogli, 22
hanno la fattura con lo stesso imponibile del foglio (G46); 7 esclusi
(foglio non riprodotto dal motore, fattura non ancora emessa, foglio di un
altro lavoro dello stesso cliente).

**Identità trovata, al centesimo su 21 lavori su 22** (l'unico fuori ha i
beni sopra il prezzo del foglio e i servizi tagliati a cifre tonde):

- il prezzo di contratto dei beni resta intero, ma diviso in due righe:
  la riga bene al 22 % (una cifra tonda fra il 62 % e il 98 % del prezzo,
  mediana 85 %) e il **markup / servizi di vendita al 10 %**, che è il resto;
- i beni autonomi (persiane, tende, zanzariere) al 10 % restano a contratto;
- **i servizi prendono il residuo**: pattuito − beni a contratto − beni
  autonomi − spese. Se il residuo copre i limiti, i servizi stanno ai limiti
  e il markup cresce; se no, la commercialista tiene ai limiti sviluppo
  ordine (98 % in media), posa (93 %), progettazione (89 %), rilievo e tiro
  al piano (78 %), protezione (73 %), e azzera assistenza muraria (14 fatture
  su 18), smaltimento e rimozione (6-7 su 18), pulizia (a volte); qualche
  voce sale sopra il limite per far tornare il totale.

Il bilanciamento «beni prima» del §6 era quindi una lettura sbagliata della
129: i beni non erano scesi del 28 %, erano stati divisi in riga bene +
markup (3.562 + 1.170 = 4.732, il prezzo delle finestre) e i servizi erano
il residuo (5.058 = 12.810,91 − 7.752,91), che quel giorno coincideva con i
limiti (5.076).

**Cosa fa ora il CRM** (`bilancia` nel generatore): quota beni
`QUOTA_BENI_SIGNIFICATIVI` = 85 % ai 10 € in proporzione fra le righe (il
resto finisce nel markup, che è già il residuo del risolutore); servizi al
residuo tenuti nell'`ORDINE_SERVIZI_DA_TENERE` (sviluppo ordine,
progettazione, rilievo, protezione, posa, tiro al piano, trasporto, pulizia,
rimozione tapparelle, rimozione serramenti, smaltimento, assistenza muraria,
eventuali): la voce che non ci sta per intero prende quel che resta, le
successive non compaiono in bozza (avvertenza con l'elenco); solo se il
pattuito non copre i beni a contratto scendono i beni. Senza detrazione
nessuna quota. Replay sui 22 lavori: imponibile uguale alla fattura vera in
18 (gli altri 4 differiscono per le spese professionali che il foglio mette
sopra il pattuito), totale servizi uguale in 13 e a pochi euro negli altri,
scostamento medio per voce 30 % del totale servizi (le cifre tonde sono
sue), IVA che differisce in media di 94 € per la quota beni diversa dall'85
% (fino a 466 € dove lei ha usato il 62 %). Il classificatore del confronto
riconosce ora le righe bene dalla prima riga del testo («N.2 …», «Persiana
…»): le persiane con «Posa su cardini» nelle righe sotto finivano fra i
servizi (118, 59, 88 del 2026).

Non verificabile: se la riga bene sia il costo fornitore più un ricarico
(le commesse del CRM con costi a registro sono 2 su 8); l'avvertenza dice
di alzare le righe bene se il costo è più alto.

## 9. Fase 3 (06/09/2026): la lettura del contratto su 21 scansioni vere

Materiale: 277 PDF di contratti 2025-2026 sulla scrivania della direzione
(238 scansioni, 39 con testo); 21 abbinati ai fogli limiti della fase 2
diventano casi del banco di prova (`server/contratti/eval/casi-reali/`,
fuori dal repository) con la verità presa dal foglio: misure e quantità
per riga, il prezzo solo quando ogni riga del foglio ne ha uno; pattuito,
rate e numero righe non noti e non giudicati. In 6 casi la verità del
foglio non sta nel documento (altro lavoro dello stesso cliente, o
persiane con la misura del foro nel contratto e dell'anta nel foglio):
restano nel banco per OCR e lettura, senza righe giudicate.

Banco di prova cambiato: un campo assente in `atteso.json` non si
giudica; le righe si abbinano per misure (±5 mm) e quantità, non per
posizione; `EVAL_CONTRATTI_DUMP` lascia testo, esito del modello e proposta
per caso; `EVAL_CONTRATTI_SOLO` riprova un caso; `EVAL_CONTRATTI_LETTURA=
visione` legge le scansioni col modello. In locale servono `FLAG_OCR=on`
e un Postgres per il ledger; tesseract locale ha solo `eng` (in produzione
`ita+eng+deu`).

**Risultati sul testo OCR** (18 casi giudicabili, 66 righe con misure):
misure abbinate 63 (95 %; i 3 scarti sono del foglio: «1090» per «1098»,
una altezza battuta male, una porta con sopraluce sommata); prezzi di riga
uguali al documento 31 su 47 (66 %); pattuito uguale in 4 documenti su 12;
layout WnD mai riconosciuto sulle scansioni (il preventivo 2025 ha un altro
layout); un documento con uno sconto negativo fermava l'intera lettura.

**Cosa è cambiato:**
- `sanificaEsitoGrezzo` prima dello schema: righe con importo negativo o
  quantità zero escono con un'avvertenza, misure fuori intervallo diventano
  nulle, totali negativi si scartano; la struttura resta allo schema strict.
- `layoutPreventivo.ts`, il secondo layout deterministico: «<nome> …
  Prez. Tot. X» e «Larghezza: L - Altezza: H» (sulla stessa riga per
  l'OCR, su due righe per la visione), quantità «Q.tà N» sopra, «Totale
  Complessivo IVA Compresa» / «Totale Imponibile Complessivo» in fondo.
  Misure, quantità e prezzi delle righe con le stesse misure e il pattuito
  diventano evidenza certa. Offline sui dump: prezzi giusti 66 % → 96 %
  sull'OCR (45 su 47), 70 % → 100 % sulla visione (33 su 33); pattuito
  5/5 e 9/9.
- **Lettura visiva prima dell'OCR** sui contratti (richiesta della
  direzione: «forse sarebbe meglio usare un vlm invece che un ocr»): sui
  14 casi letti nei due modi, misure 27/30 contro 29/31, prezzi 66 % contro
  70 % (prima del layout), pattuito 3/5 contro 7/9; l'OCR legge «L 1000»
  come «4000», la visione no. Il parser accetta `maxPagine` e `troncaOltre`
  (un contratto va fino a 20 pagine: oltre, le prime 20 con avvertenza) e
  `preferisciVisione`; le conferme d'ordine restano come prima (OCR, poi
  visione, 8 pagine).

Restano fuori: i 6 casi con verità non nel documento (servirebbe il PDF
giusto o una verità scritta a mano), i 253 PDF senza foglio (fase 4: si
possono leggere e misurare per coerenza interna — somma righe contro
totale — senza verità), la lingua `ita` di tesseract in locale.

## 10. Fase 4 (06/09/2026): 30 contratti a campione senza verità, e il Drive del NAS

Campione: 30 PDF «contratto esecutivo» presi a caso da CONTRATTI 2025,
2026 e Contratti AF (27 scansioni, 3 con testo), letti con la lettura
visiva, senza verità: si misura la coerenza interna della proposta.
Esito: 29 pattuiti su 30 trovati, 101 righe (66 con misure), 6 valori
sanificati (sconti negativi e quantità zero che prima fermavano tutto),
2 documenti in errore; layout del preventivo 2025 riconosciuto in 8; i
preventivi delle porte interne (layout «PREVENTIVO N° … TOTALE DOCUMENTO»)
letti dal modello senza layout deterministico. La somma delle righe non
è confrontabile col pattuito (i servizi non sono righe): metrica scartata.

Due difetti trovati e corretti:
- **PDF misto** (prime pagine scansionate con i prodotti, ultime con le
  condizioni in testo nativo): il parser lo trattava come testo nativo e
  il modello leggeva solo le condizioni, zero righe. Con `preferisciVisione`
  le pagine vuote (sotto 30 caratteri) si fanno trascrivere e tornano al
  loro posto.
- **Evidenze sul testo trascritto**: 57 prezzi su 101 restavano «da
  verificare» perché la citazione non era letterale — «...» per saltare un
  tratto (41), la riga ricomposta con « - » fra le colonne (16). Ora con i
  puntini ogni pezzo deve esserci nell'ordine; con i separatori basta il
  70 % dei pezzi, vicini. Offline: prezzi con evidenza dal 44 % all'83 %.

**Drive «BACKUP NAS»** (reso pubblico dalla direzione il 06/09): 2.500
cartelle elencate in sola lettura, 23.370 PDF e 821 fogli limiti; 311
cartelle contengono foglio limiti, contratto e fattura insieme (103 del
2023-24 in «Pratiche per Xbonus», 208 del 2022 in «Documenti per EnelX»).
Scaricate sulla scrivania della direzione (`dati x claude/Drive-NAS`), mai
nel repository. Uso deciso: fogli → motore (fase 1 allargata), contratti →
lettore (nuovi casi con verità dal foglio), fatture 2022-24 non per le
regole (decisione: regole solo 2025-26).

## 11. Fase 5 (06/09/2026): il corpus del Drive — fogli nel motore, contratti nel lettore

Dal Drive «BACKUP NAS» 311 cartelle con foglio limiti, contratto e fattura
insieme (2022-24, Ver.32 del foglio, quindi edizione `2023-i`): 231 fogli
scaricati, 229 raccolti, tutti con il motore che li legge.

**Motore.** 134 fogli riprodotti al centesimo: 63 erano copie dei fogli già
in fixture (Check-Limiti è la copia amministrativa di «Pratiche per
Xbonus»), 71 nuovi → la fixture d'oro passa da 77 a **148 casi**. Dei 95
non riprodotti, 62 hanno **misure con i decimali** nel foglio (foro +
alette: 1095,49 × 1705,49 mm): il CRM lavora in mm interi e i massimali
differiscono di pochi euro — non è un errore del motore, il raccoglitore
ora lo dichiara (`salta` H9) invece di troncare in silenzio; 19 hanno gli
stessi decimali in un altro blocco; 14 (7 lavori, ognuno in due copie)
hanno una sola voce DEI di riga diversa (una classe di prodotto o un
accessorio prezzato in un'altra voce) e restano da indagare; 2 fogli sono
illeggibili.

**Lettore.** 57 contratti 2023-24 con la verità dal foglio (misure e
quantità) diventano casi `drv-*` del banco di prova, letti con la lettura
visiva: risultati nel paragrafo che segue quando la corsa è finita.

**Lettore, esito (corsa fermata dalla direzione a 34 casi su 57).** 32
pattuiti su 34 trovati, 281 righe, 8 sanificazioni, 2 documenti con
controlli in errore, nessun crash. Sulle righe la verità del foglio 2023-24
vale poco: in 23 casi il foglio ha misure decimali e negli altri usa
spesso le **misure del foro** (+90 / +45 mm rispetto a quelle scritte nel
contratto): su 20 casi giudicabili 81 righe su 127 abbinate al mm, ma
delle 46 mancanti 22 sono oscuranti (foro contro anta), 17 serramenti con
misure diverse fra foglio e contratto, e solo **7 sono righe che il testo
contiene e il modello non ha estratto**. Conclusione: per giudicare il
lettore servono verità scritte dal contratto stesso (come i 3 casi WnD e i
fogli 2025-26), non i fogli dei limiti del 2023-24. I 34 dump restano
nello scratchpad; i casi `drv-*` nel banco (gitignored), 23 senza righe
giudicate.

**Chiusura (06/09/2026 sera, «chiudi qui»).** Fatto e verificato: regole di
fattura (21 lavori su 22), motore (148 fogli), lettore (95 % sulle misure
dove la verità è il contratto, prezzi 96-100 % con i layout, visione al
posto dell'OCR, 6 difetti corretti). Non capito fino in fondo: la quota
beni/markup che la commercialista sceglie caso per caso (85 % è una
mediana, non una regola), 7 fogli con una voce DEI di riga diversa, i
preventivi delle porte interne (layout PAIL) senza parser deterministico,
il totale nei fascicoli con più preventivi.
