# Limiti di spesa e fatturazione dal contratto — design

**Data:** 03/09/2026 · **Stato:** approvato in conversazione, in revisione scritta ·
**Branch:** `feature/limiti-fatturazione` (mai su `main` senza decisione) ·
**Ambito v1:** computo limiti DM MITE 14/02/2022 (Allegato A + listino DEI) e
fatturazione da commessa con nota di credito, emissione tramite Fatture in Cloud.

## 1. Perché

Oggi, firmato il contratto, qualcuno ricompila a mano il foglio «CALCOLO NUOVI
LIMITI.xlsx» (misure, quantità, accessori, comune, piano, km), legge i limiti
voce per voce, e compone la fattura a mano su Fatture in Cloud tenendo i
servizi dentro quei limiti. Il pattuito della commessa nasce **dopo**, dal
totale della fattura letto via sync.

Domani il contratto è la fonte: righe, misure, pattuito, posa, rate, detrazione
entrano nel CRM (letti dal PDF e confermati), il computo è automatico, la
fattura nasce già dentro i limiti, il CRM la emette tramite FiC e ne segue lo
stato SdI. FiC resta canale e registro fiscale; **nessuna fattura nasce più
su FiC**.

## 2. Decisioni prese (direzione, 03/09/2026)

| # | Decisione |
|---|---|
| D1 | Il computo limiti si fa **sempre**, per ogni contratto: è un gate prima dello stato «Fatture pagamento». |
| D2 | Il pattuito del contratto è **lordo IVA inclusa o imponibile**, dichiarato per contratto. La fattura tende al totale identico; se l'IVA non permette il centesimo esatto, la differenza è mostrata e accettata dall'operatore. |
| D3 | **Una fattura unica** per l'intero importo all'ordine, con scadenze (tipico 50/40/10). Niente fatture d'acconto in v1. |
| D4 | Le righe strutturate vivono **sul contratto della commessa** (approccio A): computo e fattura salvano l'hash delle righe da cui nascono; righe cambiate → computo e bozza «da rifare». |
| D5 | **Il CRM è l'unica origine delle fatture.** Bozza solo nel CRM; FiC riceve il documento a «Emetti» e **assegna il numero**; nessuna bozza specchiata su FiC (FiC non ha bozze: un documento creato è già numerato). |
| D6 | v1 = fatture da commessa + **nota di credito** (totale o parziale). Fatture libere senza commessa: fase successiva. |
| D7 | Il contratto nasce da un **modello Word/PDF compilato a mano**: il CRM lo **legge** (estrazione con modello, evidenze, conferma dell'operatore). Inserimento manuale sempre possibile. |
| D8 | Detrazioni 50% / 36% (ecobonus o ristrutturazione, prima casa o altro immobile): **informativa e in fattura** — importo detraibile e detrazione stimata; diciture obbligatorie per tipo di bonus; blocco dell'emissione se mancano CF o dati per il bonifico parlante. Niente sconto in fattura. |
| D9 | Tutto relazionale (tabelle vere, `ensureSchema` additivo), **importi in centesimi**; nessun nuovo store `kv_store`. |
| D10 | Tariffe (massimali, DEI, coefficienti ore, percentuali bonus, diciture) sono **dati con validità**, modificabili da direzione, non codice. |

Vincoli ereditati da `CLAUDE.md`: `sedeId` su ogni entità e query, `NOT_FOUND`
cross-sede, capability fail-closed, ogni effetto esterno tracciato, Tars solo
tramite servizi di dominio tipizzati, nessun base64 nuovo in JSONB.

## 3. Flusso

| Passo | Chi | Cosa |
|---|---|---|
| 1 Contratto firmato | operatore | Carica il PDF come documento `contratto` (già richiesto dal gate di «Aggiornamento contratto»). |
| 2 Lettura | automatico | Estrazione: righe prodotti con L×H, pattuito e tipo, posa, rate, detrazione, comune cantiere. Ogni valore con pagina e frammento. |
| 3 Conferma | operatore | Rivede, corregge, applica. Nascono `commessa_contratto` + `commessa_righe`. Pattuito e piano rate della commessa si allineano. |
| 4 Computo | automatico | Zona dal comune, aggregati per categoria, CHECK1 (Allegato A), CHECK2 (DEI opere compiute), limite = minore, detraibile e detrazione stimata. |
| 5 Bozza fattura | automatico | Beni dalle righe, servizi = limiti arrotondati, markup dal risolutore, coppia storno/riaddebito beni significativi, diciture bonus, scadenze dal contratto. |
| 6 Revisione | operatore | Ritocca importi (indicatore limite per voce), scadenze, note. Eccedenza = blocco con «Procedi comunque» registrato. |
| 7 Emissione | CRM → FiC → SdI | Cliente su FiC, documento creato (FiC numera), XML verificato, invio (dry-run finché il flag non viene spento). Stati fino a consegna. PDF e XML archiviati; il PDF entra nel fascicolo come documento `fattura`. |
| 8 Dopo | automatico | Il sync FiC esistente rilegge la fattura già collegata: pattuito confermato, rate, incassi come oggi. Correzioni solo con nota di credito + nuova fattura. |

Gate nuovo: transizione `aggiornamento_contratto → fatture_pagamento` richiede
un computo valido (hash righe e parametri = correnti). Scavalco con lo stesso
`ConfirmDialog` «Procedi comunque» dei gate documentali: lo stesso
`bypassGateDocumentale` del dialog, con `gateScavalcato: "documentale" |
"computo"` nel registro. Vale anche per Tars, con la stessa regola del gate
documentale: l'anteprima
(`verifica_transizione_commessa`, `gate.computo`) mostra il gate prima di
muovere qualcosa, e lo scavalco arriva solo da una richiesta esplicita
dell'utente (`scavalcaGate: true`).

## 4. Modello dati

Tutte le tabelle: `id`, `sede_id`, `created_at`, `updated_at`; importi
`*_cent BIGINT`; repository con `ensureSchema()` additivo e fallback in memoria
(pattern `server/reminders/repository.ts`). Nessuna scrittura diretta dal
client: solo servizi di dominio in `server/contratti/`, `server/computo/`,
`server/fatture/`.

### 4.1 Contratto

`commessa_contratti` (1:1 con la commessa)

| colonna | note |
|---|---|
| `commessa_id` PK, `sede_id` | |
| `pattuito_cent`, `pattuito_tipo` `lordo\|imponibile` | D2 |
| `posa_inclusa` bool, `note_posa` | |
| `comune_cantiere`, `codice_istat`, `zona_climatica` A–F | zona derivata da `comuni_zona_climatica`; override manuale registrato |
| `piano` int, `distanza_km` numeric(6,1) | parametri del computo |
| `detrazione_tipo` `nessuna\|ecobonus\|ristrutturazione`, `detrazione_immobile` `prima_casa\|altro`, `detrazione_pct` numeric(5,2) | pct fotografata dalle tariffe alla data firma; default dal cliente (`tipoDetrazione`) |
| `data_firma` date | |
| `rate` jsonb `[{numero, quota_pct, giorni\|data, descrizione}]` | specchiate in `commessa.pianoRate` (origine `manuale`) finché non c'è fattura |
| `hash_righe`, `hash_parametri` | sha256 canonico, aggiornati a ogni salvataggio |
| `origine` `estrazione\|manuale`, `documento_id`, `estrazione_id` | tracciabilità |
| `created_by`, `updated_by` | |

`commessa_righe`

| colonna | note |
|---|---|
| `id`, `sede_id`, `commessa_id`, `ordine` | |
| `categoria` enum: `serramento_pvc`, `serramento_alluminio`, `serramento_legno`, `serramento_legno_alluminio`, `cassonetto`, `tapparella`, `persiana`, `scuro`, `schermatura`, `zanzariera`, `tenda`, `pergola`, `porta_blindata`, `portoncino`, `porta_interna`, `accessorio`, `altro` | dal foglio (`Prodotto`) |
| `tipologia` text | voce DEI: finestra 1/2 ante, portafinestra 1/2 ante, scorrevole complanare, alzante, fisso… |
| `descrizione`, `quantita` int | |
| `larghezza_mm`, `altezza_mm` int null, `mq` numeric(8,3) | mq = L×H/10⁶ × quantità, calcolato dal dominio e salvato |
| `prezzo_unit_cent`, `prezzo_tot_cent` null | prezzo di vendita imponibile della riga (i «beni» in fattura) |
| `bene_significativo` bool | default per categoria (tabella tariffe), modificabile |
| `accessori` jsonb `[{codice, quantita}]` | catalogo accessori del foglio (ribalta, coprifili 80/100, pellicolatura, incollaggio, soglie, anodizzazioni, verniciature, oscillobattenti…) |
| `origine` `estrazione\|manuale\|prodotto_legacy`, `evidenza` jsonb null | |

I `prodotti[]` legacy della commessa (`{nome, tipologia, quantita, dimensioni,
note}`) restano; la tab li mostra come righe «senza misure» finché non vengono
completate. Nessuna migrazione distruttiva.

### 4.2 Computo

`computi`: `commessa_id`, `hash_righe`, `hash_parametri`, `tariffe_al` date,
`zona`, `esito` `ok|eccedenza|incompleto`, `check1_cent`, `check2_cent`,
`limite_cent`, `detraibile_cent`, `detrazione_stimata_cent`, `avvertenze`
jsonb (misure mancanti, zona da confermare, minimo di fatturazione applicato),
`created_by`. Il computo valido è l'ultimo con hash coincidenti; lo stato
«superato» è derivato, non scritto.

`computo_voci`: `computo_id`, `gruppo` `prodotti|controtelai|opere|eventuali|porte`,
`codice` (es. `rilievo`, `posa`, `trasporto`, `massimale_A`), `descrizione`,
`codice_dei`, `unita`, `prezzo_unit_cent`, `quantita` numeric, `limite_cent`,
`dettaglio` jsonb (input della formula: ore, mq, km, giorni), `ordine`.

### 4.3 Tariffe e comuni

`tariffe`: `tipo` `massimale|dei|coefficiente|detrazione|dicitura|default_categoria`,
`chiave`, `valore` numeric, `unita`, `descrizione`, `extra` jsonb,
`valido_dal`, `valido_al` null, `sede_id` null = globale. Seed da
`shared/limiti/tariffe-seed.json` generato una volta da
`scripts/estrai-tariffe-limiti.ts` (legge il foglio, non le formule). Contenuto:

- massimali Allegato A: 6 categorie × 6 zone (660/780, 780/900, 276, …);
- 85 voci DEI serramenti + tabelle controtelai (acciaio, misto, alluminio per
  altezza, falso telaio per spalla) + voci opere (M01018, M01022, M01023,
  M01024, M01004, A25114, A25115, A25130…, A25023-a, A15031-a, N04143-a);
- coefficienti: ore tiro per categoria (0,5 h serramento, 0,25 tapparella…),
  ore posa (3 h serramento, 1 cassonetto, 1,5 oscurante, 4 tenda, 16 pergola…),
  quote rilievo/progettazione/sviluppo (1/8, 1/2, 1/6 h), +30 % oltre il 4°
  piano, 0,70 €/km, giornata 8 h, spese professionali 4 % min 600 €, altri
  servizi 2 %, minimo 1,2 mq controtelai, minimo 1 mq DEI zone E–F;
- detrazioni: `{tipo, immobile, anno} → pct` (50 % / 36 %), aggiornabili;
- diciture per tipo bonus e template note fattura;
- default `bene_significativo` per categoria.

`comuni_zona_climatica`: `codice_istat`, `nome`, `provincia`, `regione`, `zona`,
`gradi_giorno`, `altitudine`. Seed dalla Tabella A DPR 412/93 aggiornata
(fonte ENEA); ~8.100 righe.

### 4.4 Fatturazione

`fatturazione_config` (per sede): `iban`, `banca`, `intestatario`,
`metodo_default` (MP05), `numerazione_fic` text null, `payment_account_id_fic`,
`vat_ids_fic` jsonb `{22: id, 10: id}` (letti da `/issued_documents/info`),
`dicitura_footer`, `scope_scrittura_ok` bool (esito dell'ultima verifica).

`fatture`

| colonna | note |
|---|---|
| `id`, `sede_id`, `commessa_id`, `computo_id` null, `hash_righe` | |
| `tipo` `fattura\|nota_credito`, `nota_credito_di` null | |
| `stato` `bozza\|in_emissione\|emessa\|inviata\|consegnata\|scartata\|rifiutata\|mancata_consegna\|annullata` | mappa di `ei_status` FiC in §7 |
| `fic_document_id`, `numero`, `data` | assegnati da FiC |
| `cliente_snapshot` jsonb | nome, CF/P.IVA, indirizzo, `ei_code`/PEC, congelati all'emissione |
| `pattuito_tipo`, `imponibile_cent`, `iva_cent`, `totale_cent`, `delta_pattuito_cent` | |
| `diciture` jsonb, `note` | |
| `pdf_storage_key`, `xml_storage_key`, `xml_sha256` | storage con checksum, come i documenti |
| `ei_status_fic`, `ei_errore` | ultimo valore letto e motivo di scarto |
| `scavalco_limiti` bool, `scavalco_motivo` | |
| `created_by`, `emessa_da`, `emessa_at`, `revisione` int | |

`fattura_righe`: `fattura_id`, `ordine`, `tipo`
`intestazione|bene|servizio|markup|storno_bs|riaddebito_bs|nota`, `descrizione`,
`quantita`, `prezzo_unit_cent`, `importo_cent`, `aliquota` 22|10|null,
`voce_computo_codice` null, `riga_commessa_id` null, `limite_cent` null.

`fattura_riepilogo_iva`: `fattura_id`, `aliquota`, `imponibile_cent`, `imposta_cent`.

`fattura_scadenze`: `fattura_id`, `numero`, `quota_pct`, `data`, `importo_cent`,
`fic_payment_id` null, `stato` `attesa|pagata|stornata`.

`fattura_eventi` (append-only): `fattura_id`, `sede_id`, `tipo`
(`creata`, `modificata`, `emissione_avviata`, `cliente_fic`, `creata_fic`,
`xml_ok`, `xml_errore`, `inviata`, `stato_sdi`, `scarto`, `annullata`,
`nota_credito`, `pdf_archiviato`), `payload` jsonb, `actor_user_id`,
`created_at`.

**Immutabilità.** Dallo stato `in_emissione` in poi il servizio di dominio
rifiuta ogni modifica a righe, riepilogo e scadenze (`FATTURA_IMMUTABILE`); la
UI non mostra comandi di modifica. Correzione = nota di credito.

## 5. Motore computo

`server/computo/motore.ts` — `calcolaLimiti(righe, parametri, tariffe) → Computo`
funzione pura, nessun I/O, testata a tavolino.

1. **Aggregati per categoria**: quantità, mq, larghezza totale (m), per i
   gruppi del foglio («Calcolo Automatici»): serramenti (PVC/alluminio),
   serramenti+tapparelle, serramenti+persiane, serramenti+scuri, cassonetti,
   oscuranti soli, schermature, tende, pergole, porte blindate, portoncini,
   legno e legno-alluminio.
2. **Ore**: tiro al piano e posa per categoria dai coefficienti (`Tempi`);
   +1/3 h materiali; giornate posa = ⌈ore posa / 8⌉.
3. **CHECK1 — Allegato A**: per ciascun gruppo `massimale(zona) × mq`;
   controtelai: prezzo DEI × quantità (mq minimo 1,2 per acciaio/misto);
   opere complementari (13) ed eventuali (5) con le formule del foglio, ad
   esempio `rilievo = 60,17 × (n_serr/8 + n_legno/8 + n_cass/4 + …)`,
   `trasporto = 2 × km × 0,70 × giornate`, `tiro = 2 × 36,50 × ore_tiro × (piano>4 ? 1,3 : 1)`,
   `assistenza_muraria = 44,13 × larghezza_tot_m`, `posa = ore_posa × 2 × 36,50`,
   `pulizia = 50 + ore_tiro × 36,50`, `spese_professionali = max(600; 4 % × beni+opere)`,
   `altri_servizi = 2 % × beni`. Le formule sono codice; **prezzi e
   coefficienti sono tariffe**.
4. **CHECK2 — DEI opere compiute**: per riga, voce DEI per tipologia × mq
   (minimo 1 mq nelle zone E–F dove la voce lo prevede) + sovrapprezzi
   accessori (C25088-*, C25126, C15054-*).
5. **Limite** = min(CHECK1, CHECK2). **Detraibile** = min(imponibile fattura
   prevista, limite); **detrazione stimata** = detraibile × pct.
6. Porte interne (foglio «PORTE - RISTRUTTURAZIONE»): categoria e voci
   previste nei dati, motore in fase 2.

Ogni voce riporta gli input della formula (`dettaglio`) per spiegare il
numero in UI. Avvertenze esplicite: misure mancanti, zona non derivabile,
categoria senza massimale, listino DEI più vecchio di 12 mesi.

**Test d'oro**: 2–3 fogli compilati di commesse reali (forniti dalla
direzione) → fixture JSON; il motore deve coincidere al centesimo. Finché non
arrivano, fixture derivata dalla fattura 127/2026 (3 portefinestre 1900×2400,
2 finestre 1660×1540, 1 finestra 1150×1540, zona del cantiere) con i limiti
ricalcolati a mano dal foglio.

## 6. Lettura del contratto

`server/contratti/estrazione.ts`

1. Byte del documento → `parserRegistry` (testo per pagina; OCR locale se
   scansione, con le soglie già in `documenti/ocr.ts`). Nessuna lettura
   visiva a pagamento da questo percorso: solo testo nativo e OCR locale.
2. Prompt di estrazione con **schema JSON strict** (`formatoJson` del
   provider governato di Tars, `creaProviderPerRun`, classe di costo
   `document_intelligence`):
   `{righe[]: {categoria, tipologia, descrizione, quantita, larghezza_mm, altezza_mm, accessori[], prezzo, oscurante_abbinato}, pattuito, pattuito_tipo, posa_inclusa, posa (prezzo in euro: i centesimi nascono nella mappatura), rate[], detrazione, comune_cantiere, piano, note}`.
   Il contenuto del PDF è input non fidato: nessuna istruzione dentro il
   documento ha effetto; l'esito è una **proposta**. Un arricchimento
   deterministico **facoltativo** (non un parser per configuratore, un solo
   caso riconosciuto dalle sue etichette esatte) corregge misure, prezzi,
   pattuito e rate quando il documento è un preventivo del configuratore
   WnD; su ogni altro contratto la proposta del modello resta intatta.
3. Validazione deterministica: numeri, intervalli (L/H 100–6000 mm), somma
   righe vs pattuito (solo con un'aliquota IVA unica dichiarata; IVA mista o
   non indicata → avviso, mai un numero inventato), rate che sommano a
   100 %, comune risolto su `comuni_zona_climatica`, CF del cliente se
   citato.
4. Evidenze: ogni campo cerca il proprio testo nelle pagine
   (`verificaEvidenza`) → `CampoProposto<T>` con `{valore, evidenza,
   daVerificare, nota}`; campo senza evidenza verificata = «da verificare».
5. `contratto_estrazioni`: `documento_id`, `commessa_id`, `stato`
   `proposta|applicata|scartata`, `payload` jsonb, `prompt_versione`,
   `run_id`, `created_by`. Idempotente per documento + versione prompt — il
   riuso si controlla PRIMA di estrarre il testo (OCR e lettura visiva
   costano); il costo del run si legge dal ledger Tars per `run_id`, non da
   un campo sulla riga.
6. Applicazione: crea/aggiorna `commessa_contratti` + `commessa_righe` con
   `origine=estrazione`, evidenze salvate sulle righe; allinea la timeline
   allo stato corrente della commessa, stessa funzione del salvataggio
   manuale del contratto.

Flag `FLAG_CONTRATTO_ESTRAZIONE` (fail-closed) **e** `FLAG_LIMITI` (la
lettura automatica non ha senso senza il contratto strutturato). Provider
assente o un flag spento → la UI offre solo l'inserimento manuale. Eval:
`server/contratti/eval/` — fixture sintetiche (`casoWnd`/`casoWord`/`casoScansione`,
nessuna rete) più contratti reali anonimizzati in `casi-reali/` (fuori dal
repository, da fornire) per la misura vera dell'accuratezza.

## 7. Generatore fattura, risolutore, emissione

### 7.1 Bozza

Dalla commessa con computo valido:

- riga `intestazione`: «Fattura per la prossima fornitura e posa di:» +
  categoria/finitura dal contratto;
- righe `bene`: una per riga contratto («N.3 Portafinestra 2 ante a battente.
  L1900 × H2400»), importo = prezzo riga, aliquota 22 %;
- righe `servizio`: una per voce computo con limite > 0, importo proposto =
  limite arrotondato all'euro (mai sopra), aliquota 10 %, `limite_cent`;
- riga `markup` «MarkUp servizi di vendita», aliquota 10 %, importo dal
  risolutore;
- coppia `storno_bs` (−Q, 22 %) e `riaddebito_bs` (+Q, 10 %) con
  Q = min(B, P);
- righe `nota`: dicitura intervento (DPR 380/2001…), indirizzo cantiere,
  note pagamento e bonifico parlante secondo `detrazione_tipo`;
- scadenze dal contratto (`rate`), default 50/40/10.

### 7.2 Risolutore

Simboli: G pattuito, B = Σ righe `bene_significativo`, N = Σ beni non
significativi, S = Σ servizi, M markup, P = N + S + M (prestazione).
Regola beni significativi: se B > P → 10 % su 2P, 22 % su B − P; se B ≤ P →
tutto al 10 %.

- `pattuito_tipo = imponibile`: M = G − B − N − S.
- `pattuito_tipo = lordo`: ipotesi B > P → P = (G − 1,22·B) / 0,98; se
  P ≥ B l'ipotesi cade → P = G / 1,10 − B. Poi M = P − N − S.
- M < 0 → avviso bloccante «i servizi superano il pattuito»: la prassi è
  **abbassare i beni** («Riequilibra i beni», v. la nota D-A qui sotto),
  che è quello che fa la commercialista; ridurre i servizi resta
  possibile (mai sopra i limiti, ma può scendere) e non è la strada
  normale.
- Tutto in centesimi. Riepilogo per aliquota: imposta = arrotondamento
  half-up al centesimo dell'imponibile × aliquota. Se il totale non coincide
  con G, si cercano P ± 1…3 centesimi; se nessuno coincide, si mostra
  `delta_pattuito_cent` e l'operatore lo accetta (D2).
- Verifica: `fattura 127/2026` → G 15.395,00, B 8.847,46, S 2.545,00 →
  P 4.695,00, M 2.150,00, 22 % su 4.152,46, 10 % su 9.390,00, IVA 1.852,54.

**Nota (Ruling D-A, piano 2 —
`docs/superpowers/plans/2026-09-04-fatturazione-dal-contratto.md`).** Con B
ai prezzi di riga del contratto, M risulta negativo su tutte e tre le
fatture reali: in pratica la commercialista **abbassa i beni** per fare
posto a servizi e markup al 10 %, non riduce i servizi. Modello adottato in
bozza: G resta fisso; B (beni significativi) e N (altri beni) nascono dai
prezzi di riga ma sono **modificabili**; S nasce dai limiti (arrotondato
all'euro, mai per eccesso) ed è modificabile; **M resta sempre derivato**,
mai un input diretto. Con M < 0 la bozza resta salvabile ma non emettibile
(`markup_negativo`, errore bloccante); il pulsante «Riequilibra i beni»
scala le righe di beni significativi in proporzione fino al markup
desiderato (default 0) con `riequilibraBeni`: arrotondamento cumulativo,
somma sempre esatta al target, righe mai negative, scarto ≤ 1 centesimo a
riga.

### 7.3 Verifica limiti sulla bozza

Per singola voce collegata al computo (servizi e, da Ruling R17, la riga
«Spese per documentazione detrazione») l'eccedenza resta un indicatore
(avviso `limite_riga`): la fattura resta ammessa, cambia solo la
detrazione stimata del cliente. Tre confronti sono invece un vincolo vero
— verificati **separatamente**, mai come un totale unico (Ruling R25: un
caso reale mostra il foglio che confronta beni+markup coi soli massimali
dell'Allegato A, mai markup e servizi insieme contro le opere):
`limite_prodotti` = beni senza voce di computo (righe di contratto e righe
manuali) più il markup, contro la Σ dei `massimale_*`; `limite_servizi` =
Σ dei servizi (manuali compresi, spese di documentazione escluse) contro
la Σ delle opere/eventuali che il generatore ha proposto; `limite_totale`
= imponibile contro il minore fra CHECK1/CHECK2. Le righe derivate
(markup, storno, riaddebito) non entrano mai in queste somme. Ogni blocco
oltre il proprio limite → emissione bloccata; «Procedi comunque» solo con
capability `fattura.emit`, registrato (`scavalco_limiti`, motivo) e
dichiarato nel fascicolo (controllo lato server, Ruling R34: seconda
autorizzazione dentro `fatture.aggiornaBozza` — endpoint
`fatture.scavalcoLimiti` — quando `scavalcoLimiti.attivo`, e motivo
obbligatorio nel servizio, così vale anche per una chiamata diretta;
spegnere lo scavalco resta un'operazione da `fattura.draft`). Ruling R26: se la somma di riferimento di un
blocco è 0 (nessuna voce del gruppo, o limite complessivo assente) quel
blocco non è «entro il limite» né un errore — sarebbe un «ok» falso — ma
un avviso `limiti_non_verificati`; senza computo lo stesso avviso copre
tutti e tre i blocchi, mai un «ok» di comodo. Detraibile e detrazione
stimata restano ricalcolati sulla bozza.

### 7.4 Validazioni prima dell'emissione

- cliente: nome, indirizzo completo con provincia, CF valido (checksum) per
  privati, P.IVA per aziende, `ei_code` (`0000000` per privati senza PEC) o
  PEC;
- detrazione ≠ nessuna → CF obbligatorio, indirizzo cantiere, tipo intervento
  scelto, dicitura presente;
- computo valido (hash) oppure scavalco registrato;
- scadenze che sommano al totale; date non nel passato salvo conferma;
- configurazione sede: IBAN, `vat_ids_fic`, conto FiC, scope di scrittura.

### 7.5 Emissione (servizio idempotente `emettiFattura`)

Prerequisito una tantum per sede: scope OAuth FiC
`entity.clients:r entity.clients:a issued_documents.invoices:r issued_documents.invoices:a issued_documents.credit_notes:r issued_documents.credit_notes:a received_documents:r settings:r`
→ ri-autorizzazione da Impostazioni; `fatturazione_config.scope_scrittura_ok`
verificato con una chiamata di lettura a `/issued_documents/info`.

1. `stato = in_emissione`, evento `emissione_avviata` (lease:
   compare-and-swap su stato e `revisione`, v. le precisazioni in fondo).
2. Cliente su FiC: cerca per CF/P.IVA (`GET /entities/clients?q=`), altrimenti
   `POST /entities/clients` con `e_invoice: true`, `ei_code`, indirizzo; salva
   `fic_entity_id` sul cliente. Evento `cliente_fic`.
3. `GET /c/{company}/issued_documents/info?type=invoice` (id IVA 22/10, conti,
   numerazioni) — cache in `fatturazione_config`, rinfrescata se manca un id.
4. `POST /issued_documents` con `type: invoice`, `entity`, `date`,
   `numeration` (se configurata), `items_list` (nome, descrizione, qty,
   `net_price`, `vat.id`; storno con prezzo negativo), `payments_list`
   (`due_date`, `amount`, `payment_terms`), `e_invoice: true`,
   `ei_data.payment_method: MP05` + IBAN/banca, `visible_subject` con codice
   commessa, `notes` con le diciture, `options.fix_payments: true`. FiC
   restituisce `id`, `number`, `date`, `amount_net/vat/gross`. Confronto con i
   nostri totali: se differiscono → evento `errore_totali`, stato resta
   `in_emissione` con `fic_document_id`, si ferma prima dell'invio.
   Salvataggio `fic_document_id`, `numero`, `data` → `stato = emessa`.
5. `GET …/e_invoice/xml_verify` → `xml_ok` o `xml_errore` (stato `emessa`,
   errore mostrato; niente invio).
6. `POST …/e_invoice/send` con `options.dry_run` = flag
   `FATTURAZIONE_SDI_DRY_RUN` (acceso di default finché la direzione non lo
   spegne) → `stato = inviata` (o `emessa` con nota «dry-run» se dry-run).
7. Archivio: `GET …/e_invoice/xml` → storage con sha256; PDF da `url` FiC →
   storage; il PDF viene registrato come documento `fattura` della commessa
   (soddisfa il gate documentale esistente). Eventi.
8. Sonda stati: job ogni 15 minuti sulle fatture `inviata` (e `emessa` con
   dry-run) legge `ei_status` e mappa:
   `attempt|pending|sent|processing → inviata`, `delivered|accepted|manual_accepted → consegnata`,
   `discarded → scartata` (+`error_reason`), `rejected|manual_rejected → rifiutata`,
   `not_delivered|no_response → mancata_consegna`, `error → inviata` con
   avviso. Ogni cambio = evento. Pulsante «Aggiorna stato» a richiesta.

Ripetizione sicura: se `fic_document_id` esiste, non si ricrea; ogni passo
riparte da dove si è fermato. **Mai** cancellazione automatica su FiC.

**Precisazioni dall'implementazione (piano 2, 04/09/2026).** La revisione
chiesta dall'utente si confronta **solo alla partenza**
(`fattura.stato === "bozza"`), prima di toccare il contesto FiC: dal
passaggio a `in_emissione` in poi ogni ripresa è idempotente per stato e
non la richiede di nuovo (Ruling R1). A impedire due documenti FiC non è
quel confronto ma il **lease** (Ruling R35): ogni giro — partenza o
ripresa — apre con un compare-and-swap nel repository
(`aggiornaStato` con `atteso: { stato, revisione }` → `UPDATE … WHERE
stato = … AND revisione = …`, zero righe → `CONFLITTO`), che incrementa
la revisione. Due «Emetti» sovrapposti sulla stessa bozza (doppio click
da due schede, ricarica, secondo amministratore): il secondo riceve
`CONFLITTO` **prima** di toccare Fatture in Cloud: mai due numeri quando
le due run hanno letto la stessa revisione (una run avviata dopo il lease e
prima della scrittura di `ficDocumentId`, possibile solo via API diretta,
resta la finestra rinviata alla ricerca su FiC, R11/R40)
fiscali; da `emessa`/`inviata` il lease non riporta indietro lo stato, si
limita a serializzare i giri. `eiErrore` è sempre riscritto in fondo a ogni
passaggio, sia in `emettiFattura` sia nella sonda, mai lasciato appiccicato
da un giro precedente risolto; l'XML si riverifica a ogni ripresa finché
la fattura non è `inviata`; un privato registrato con un nome di una sola
parola nasce su FiC come `company`, non `person` (FiC rifiuta una `person`
senza nome proprio) (Ruling R11). Il riappaiamento `ficPaymentId` ↔
scadenza si ritenta a **ogni giro** (emissione o sonda) finché ne resta
una scollegata, non solo mentre la fattura è `in_emissione` — altrimenti
un'interruzione fra la creazione del documento e la scrittura degli id la
lascerebbe orfana per sempre (Ruling R12). Con dry-run acceso lo stato
resta `emessa` (mai `inviata`) con `inviataDryRun = true`; l'etichetta
mostrata è «Emessa (prova SdI)», non «inviata (prova)». Con `FLAG_LIMITI`
spento ogni mutation del router risponde `PRECONDITION_FAILED`, come tutti
i router del repository, non `NOT_FOUND` come ipotizzato in una prima
stesura di questo stesso documento (Ruling R24).

Integrazione col sync esistente (`ficFatture.upsertDocumentiEmessi`): un
documento FiC il cui id corrisponde a `fatture.fic_document_id` nasce già
collegato (`commessaMatch: "crm"`, nuovo valore), non passa dal match
automatico, non rigenera il PDF (il sync degli allegati lo salta: il PDF è
già entrato nel fascicolo da `registraDocumentoFatturaCrm` all'emissione),
alimenta pattuito/rate/incassi come oggi. Un avviso compare se `|totale
fattura − pattuito contratto| > 1 €`. La mutation manuale di collegamento
del sync rifiuta di ricollegare una riga `commessaMatch: "crm"` a
un'altra commessa (stesso messaggio della guardia sullo scollegamento): si
corregge solo con una nota di credito, mai spostando il collegamento a
mano (Ruling R23).

### 7.6 Nota di credito

Da una fattura `emessa`+ (stati stornabili: `emessa`, `inviata`,
`consegnata`, `rifiutata`, `mancata_consegna`) → `tipo = nota_credito`,
`notaCreditoDi`; per il totale le righe sono uno **specchio esatto**
dell'origine, segno compreso — lo storno dei beni significativi resta
negativo com'era, niente si inverte (non uno «specchio negativo»: l'unica
cosa che cambia davvero è l'intestazione) — per il parziale solo le righe
bene/servizio/markup scelte, con storno/riaddebito ricalcolato sul
sottoinsieme; niente risolutore, gli importi sono già decisi dalla fattura
di origine. Stessa pipeline di emissione con `type: credit_note` e scope
`issued_documents.credit_notes:a`; la fattura originale riceve evento
`nota_credito` e il fascicolo mostra il legame.

Prima riga della nota: un'`intestazione` «Accredito su ns. fattura n. X
del Y», col motivo quando c'è (Ruling R20). La nota salta i controlli di
computo/limiti e quelli di forma della detrazione (cantiere, dicitura del
bonifico) — storna una fattura già emessa, non propone prestazioni nuove —
ma mantiene i controlli su cliente, configurazione FiC e scadenze (Ruling
R14/R15); `creaNotaCredito` copia comunque l'indirizzo del cantiere
dall'origine, solo informativo. `rigeneraBozza` rifiuta una nota di
credito (rilegge contratto e computo, che la nota non ha); una nota di
credito non si storna con un'altra nota di credito (Ruling R16). **Aperto**:
il segno con cui Fatture in Cloud stampa il totale della nota va
verificato alla prima nota reale — le righe che il CRM manda sono positive
e speculari all'origine, le note reali del 2026 stampano il totale in
negativo; se FiC inverte da solo il segno in output va bene così, altrimenti
il generatore va corretto prima della seconda nota (v. handoff, runbook
della prima fattura reale).

## 8. Gate e transizioni

- `verificaTransizioneCommessa` riceve una nuova dipendenza
  `computoValido(commessaId)`; per `aggiornamento_contratto → fatture_pagamento`
  il gate è bloccante se falso; scavalco con lo stesso `bypassGateDocumentale`
  del dialog, registrato come `gateScavalcato: "documentale" | "computo"` nel
  `RegistroTransizione`, stesso `ConfirmDialog` («Il computo dei limiti non è
  aggiornato per lo stato "Aggiornamento contratto". Procedere comunque?»).
- Timeline: «Firma Contratto (allegato)» completata all'applicazione del
  contratto; «Fatturazione» completata all'emissione
  (`allineaTimelineAlBoard`, stesso meccanismo).
- Tars usa lo stesso gate: `verifica_transizione_commessa` chiede
  `computoValido` sul passo governato e restituisce `gate.computo`
  (`richiesto`/`valido`) insieme a `consentita`; `transizione_adiacente_commessa`
  lo rivaluta a ogni tappa, e senza scavalco si ferma dicendo che manca il
  computo — non un file. Con `scavalcaGate: true` (solo su richiesta esplicita
  dell'utente) passa con lo stesso `bypassGateDocumentale`, l'avvertenza nomina
  il gate del computo e il registro segna `gateScavalcato: "computo"`.
- L'Undo di Tars non forza mai un gate (regola esistente).

## 9. UI/UX sulla pagina reale

Verificato sulla `Commessa 360` reale (demo locale, 03/09/2026): ordine della
pagina = header con stato e «Avanza a», barra avanzamento con documenti
mancanti, banner gate «Manca 1 documento · Carica file», card **Pagamenti**
(Totale pattuito €, Piano rate, Registra acconto), **Timeline ordine**,
tab «Sezioni della commessa» (File e documenti · Prodotti · Interventi ·
Anomalie · Ticket), Squadra di posa, Stima economia CRM, Tars — fascicolo.
Nessuna pagina nuova: si estendono queste superfici.

| Superficie | Modifica |
|---|---|
| Banner gate | In `aggiornamento_contratto` con contratto caricato ma non letto: «Contratto caricato, non ancora letto» + `Leggi il contratto`. Con contratto applicato: «Contratto: 6 righe · pattuito € 15.395 lordo · limiti OK». |
| Tab **File e documenti** | Sui documenti `contratto`: azione «Leggi il contratto» (icona `ScanText`, `aria-label`), accanto a «Collega a un ordine fornitore». Apre `LeggiContrattoDialog` (pattern `CollegaOrdineDialog`): campi del contratto e tabella righe, ogni valore con «pag. N — "frammento"», modificabili inline, avvertenze in testa, `Applica al contratto` / `Annulla`. Su mobile dialog a schermo intero, righe come card. |
| Tab **Prodotti** → **Contratto (n)** | Testata: pattuito + tipo, posa inclusa, comune → zona (badge), piano, km, detrazione (da cliente, modificabile), rate. Tabella righe (`DataTable`): #, categoria, tipologia, descrizione, q.tà, L×H, mq, prezzo, bene sig. (toggle), accessori (chip), azioni. Riga legacy = badge «misure mancanti». Vuoto: «Nessuna riga — leggi il contratto caricato o aggiungi a mano». Salvataggio esplicito, `Undo` di riga. |
| Tab **Limiti (esito)** | Striscia riepilogo: CHECK1 · CHECK2 · Limite · Detraibile · Detrazione stimata. Tabella voci per gruppo: voce, codice DEI, quantità (con unità), prezzo unit., limite, «perché» (popover con gli input). Badge «Righe cambiate — ricalcola» quando l'hash non coincide. `Ricalcola`. Direzione: link «Tariffe». |
| Tab **Fattura (stato)** | Senza bozza: `Genera bozza dai limiti` (disabilitato senza computo valido, con motivo). Bozza: tabella righe (tipo, descrizione, importo editabile per servizi/markup, aliquota, indicatore limite ✓/!), riepilogo vivo (22 % · 10 % · IVA · Totale · Δ pattuito), scadenze (quota %, data, importo), diciture, elenco validazioni; `StickyActionBar` con `Salva bozza` e `Emetti` (solo `fatture.emetti`). Dopo l'emissione: documento in sola lettura, numero e data FiC, cronologia eventi/stati SdI, PDF e XML, `Aggiorna stato`, `Nota di credito`. |
| Card **Pagamenti** | Pattuito in sola lettura con badge «da contratto» (stesso pattern del badge «da FiC»), tipo lordo/imponibile; piano rate dal contratto finché non c'è fattura FiC. |
| **Avanza a: Fatture / Pagamento** | Gate computo nello stesso `ConfirmDialog`. |
| **Tars — fascicolo** | Riga «Contratto letto · limiti OK · fattura 127/2026 consegnata» con avvisi (eccedenza, scarto SdI). |
| **Impostazioni** (`/integrazioni`) | Sezione FiC: stato scope («scrittura fatture: non autorizzata») + `Ri-autorizza con permessi di scrittura`; pannello **Fatturazione** per sede (IBAN, banca, numerazione, conto, metodo, diciture, interruttore dry-run con avviso); pannello **Tariffe limiti** (direzione): schede Massimali · DEI · Coefficienti · Detrazioni · Diciture, validità, «Reimporta dal seed». |
| **/pagamenti** | Sezione «Fatture emesse dal CRM»: numero, cliente, commessa, totale, stato SdI, data; filtro sede/stato. |

Regole: token semantici, Plus Jakarta Sans, layout denso, `min-w-0` e vista
mobile per ogni tabella (390×844 verificato), focus visibile, `aria-label` sui
pulsanti icona, `prefers-reduced-motion`. Nessuno scroll orizzontale globale.

## 10. Permessi, sede, audit, Tars

Capability nuove in `server/authz/capabilities.ts` e `client/src/lib/roles.ts`:
`contratto.read` (tutti), `contratto.manage` (commerciale, amministrazione,
direzione), `computo.run` (come `contratto.manage`), `fattura.read`
(amministrazione, direzione, commerciale in sola lettura), `fattura.draft`
(amministrazione, direzione), `fattura.emit` e `fattura.credit_note`
(amministrazione, direzione), `tariffe.manage` (direzione). Record di altra
sede → `NOT_FOUND`. Ogni scrittura registra `actor` ed evento.

Nomi confermati a fine implementazione (piano 2, 04/09/2026): identici a
questa stesura in `server/authz/capabilities.ts` — l'unico refuso rimasto
nel documento era `fatture.emetti` in §7.3, corretto in `fattura.emit`; la
tabella UI di §9 (riga «Tab Fattura (stato)») cita ancora la forma vecchia
e non è stata toccata da questo allineamento.

Tars: i servizi di dominio sono tipizzati e riusabili come strumenti in una
fase successiva (`leggiContratto`, `calcolaLimiti`, `generaBozza`/`creaBozza`;
`emettiFattura` = effetto esterno → proposta con anteprima e conferma umana).
`preparaBozzaFattura`, citato in una stesura precedente di questo paragrafo,
non esiste nel codice: il nome reale della funzione pura è `generaBozza`
(`server/fatture/generatore.ts`), quello del servizio che la persiste è
`creaBozza` (`server/fatture/servizio.ts`). Nessuno strumento Tars in v1
(§10 resta vincolante: v. `docs/tars/matrice-azioni-tars.md`).

## 11. Flag, rollout, test

Interruttori (fail-closed, come `platform/interruttori.ts`; per
deployment/ambiente, non un campo per sede nel database): `FLAG_LIMITI`
(contratto, computo, gate — piano 1, **necessario anche alla
fatturazione**: ogni handler dei router `fatture`/`fatturazioneConfig`
chiama `assicuraInterruttore("limiti")` oltre al proprio interruttore),
`FLAG_FATTURAZIONE` (tab Limiti/Fattura, emissione — piano 2, in
middleware su tutto il router), `FLAG_CONTRATTO_ESTRAZIONE` (piano 3, non
ancora nel codice).

`FATTURAZIONE_SDI_DRY_RUN` **non è un interruttore** di
`platform/interruttori.ts`: è una variabile letta direttamente da
`server/fatture/dryRun.ts` (`sdiDryRun()`), fail-**open** per costruzione —
attiva a meno che non valga esplicitamente `off`/`false`/`0`/`spento`/`no`
— l'opposto dei kill switch fail-closed qui sopra, perché la prima
fattura reale deve passare dal commercialista prima di uscire davvero: il
default è sempre «in prova», mai «spento».

Test:

- motore computo: fixture d'oro dai fogli reali; unità per ogni formula;
- risolutore: property test (totale esatto quando possibile, casi B>P, B≤P,
  lordo/imponibile, M<0), caso 127/2026 esatto;
- estrazione: schema, validazioni, evidenze su un PDF sintetico + il modello
  reale anonimizzato;
- FiC: client con fake (pattern `tars/openai/fake.ts`), idempotenza per passo,
  mappa stati, confronto totali;
- repository: test su PostgreSQL vero (servizio già in CI) per immutabilità e
  scope sede;
- transizioni: gate computo e scavalco registrato;
- UI: funzioni di presentazione pure in `client/src/lib/*View.ts`; verifica
  1440×900 e 390×844 senza errori console.

Rollout: branch `feature/limiti-fatturazione`; flag spenti in produzione;
prima fattura reale con dry-run → XML confrontato con il commercialista →
dry-run spento per sede. Company FiC di prova (licenza trial dal supporto)
consigliata per la sede di test.

## 12. Fuori ambito v1

Fatture libere senza commessa; fatture d'acconto; sconto in fattura; porte
interne nel motore (dati previsti); generazione del contratto dal CRM;
strumenti Tars per contratto/fattura; migrazione di `commesse`/`clienti` fuori
da `kv_store`.

## 13. Rischi

| Rischio | Mitigazione |
|---|---|
| Formule del foglio trascritte male | fixture d'oro reali prima di attivare il gate; ogni voce mostra i suoi input |
| Arrotondamenti FiC ≠ nostri | confronto `amount_gross` dopo la creazione, stop prima dell'invio |
| Scope OAuth non ri-autorizzati | stato visibile in Impostazioni; emissione bloccata con messaggio |
| Estrazione sbagliata | proposta con evidenze, mai applicazione automatica; inserimento manuale sempre disponibile |
| Buchi di numerazione | FiC numera solo a «Emetti»; nessuna bozza su FiC; mai cancellazioni |
| Doppia emissione | idempotenza su `fic_document_id`, blocco ottimistico su `revisione` |
| Pattuito legacy (float) vs contratto (cent) | conversione dichiarata nel servizio; avviso se divergono oltre 1 € |

## 14. Da fornire

- 2–3 fogli «CALCOLO NUOVI LIMITI» compilati di commesse reali (test d'oro);
- un contratto PDF reale (modello aziendale), anche anonimizzato;
- conferma commercialista sulla struttura fattura (markup al 10 %, diciture)
  prima di spegnere il dry-run;
- ri-autorizzazione OAuth FiC per sede con gli scope di scrittura.
