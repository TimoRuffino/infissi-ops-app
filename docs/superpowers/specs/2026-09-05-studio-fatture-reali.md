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
