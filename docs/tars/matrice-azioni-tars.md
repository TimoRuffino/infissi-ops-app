# Tars — matrice verificata delle azioni (T0)

**Rilevata il 31/08/2026 sul checkout locale `main`.** Questa matrice descrive
il codice presente, non lo stato di un ambiente esterno. `Esistente` significa
che il percorso server è stato trovato; non significa che un flag sia acceso
né che una capacità futura sia già completa.

## Livelli correnti e classificazione target

I livelli **L** sono il contratto tecnico corrente (`L0`–`L5` della specifica)
e non vengono rinominati. La colonna **R target/gap** applica separatamente il
mandato: `R0` lettura/analisi/preparazione; `R1` azione interna limitata e
reversibile richiesta esplicitamente; `R2` effetto condiviso o esterno con
anteprima+una conferma; `R3` economico/legale/alto impatto con conferma forte;
`R4` vietato. Non esiste una conversione automatica di cinque classi R in sei
classi L: `da classificare` significa che l'action registry futuro deve
decidere il rischio in base all'effetto reale.

Nella colonna flag, `T` = `FLAG_TARS` (master obbligatorio per ogni tool),
`RT` = `FLAG_TARS_READ_TOOLS`, `RM` = `FLAG_TARS_REMINDERS`, `L2` =
`FLAG_TARS_L2_ACTIONS`, `TP` = `FLAG_TARS_PROPOSALS`, `TC` =
`FLAG_TARS_COMMUNICATIONS`, `TM` = `FLAG_TARS_MEMORY`, `DI` =
`FLAG_DOCUMENT_INTELLIGENCE`, `PG` = `FLAG_PROPOSTE`.

## Inventario integrale dei 23 tool correnti

| Tool e dominio | Servizio canonico / confine | Livello corrente L | R target/gap | Capability e altri vincoli | Flag richiesti | Test trovato / stato reale e gap |
| --- | --- | --- | --- | --- | --- | --- |
| `cerca_commesse` — commesse | `routers/commesse` (lettura sede-scoped) | L0 | R0 | `commessa.read` | T + RT | `orchestratore.test.ts`; esistente, senza importi non autorizzati. |
| `cerca_clienti` — clienti | `routers/clienti` (lettura sede-scoped) | L0 | R0 | `cliente.read` | T + RT | `strumenti/clienti.test.ts`; archiviati esclusi salvo richiesta esplicita, senza importi. |
| `leggi_cliente` — scheda cliente | `routers/clienti` + `routers/commesse` | L0 | R0 | `cliente.read`; economia aggregata sagomata da `pagamento.read`/`economia.read` | T + RT | `strumenti/clienti.test.ts`; commesse archiviate solo come conteggio, cross-sede NOT_FOUND. |
| `crea_ticket` — post-vendita | `routers/ticket.creaTicketRecord` (servizio di dominio, stesso del router) | L2 | R1 | `ticket.create`; commessa dal contesto VERIFICATO o esplicita, in sede e non archiviata; cliente ereditato | T + L2 | `strumenti/ticket.test.ts`, `chiarificazione.test.ts`; nasce «aperto» senza assegnazione, chiusura/eliminazione dalla pagina Post-vendita (undo non esposto). |
| `crea_cliente` / `aggiorna_cliente` | `clienti.create` / `clienti.update` eseguite col contesto server dell'utente (`strumenti/comune.callerPer`) | L2 | R1 | `cliente.create` / `cliente.update_operational`; sede; cascata contatti sulle commesse (dominio) | T + L2 | `strumenti/scrittura.test.ts`; nota «creato da Tars». Tars libero 02/09. |
| `crea_commessa` / `aggiorna_commessa` | `commesse.create` / `commesse.update` (campi operativi: indirizzo, contatti, priorità, note, consegne, cliente) | L2 | R1 | `commessa.create` / `commessa.update_operational`; sede; archiviata rifiutata; niente stato (transizione) né importi | T + L2 | `strumenti/scrittura.test.ts`; prima/dopo nell'esito. |
| `archivia_commessa` / `ripristina_commessa` | `commesse.archive` / `commesse.restore` | L2 | R1 | `commessa.update_operational`; sede | T + L2 | `strumenti/scrittura.test.ts`; reversibili l'una con l'altra. |
| `aggiorna_ticket` / `chiudi_ticket` | `ticket.update` / `ticket.updateStato` | L2 | R1 | `ticket.manage` (+ `ticket.assign` per l'assegnazione, verificata dal router) | T + L2 | `strumenti/scrittura.test.ts`; riapertura dal rollback di stato. |
| `pianifica_intervento` (1.2.0) | `interventi.create` | L2 | R1 | `intervento.plan` (+`intervento.assign` per la squadra, dal router); sede; data da «quando» (server) o YYYY-MM-DD; indirizzo ereditato; TIPI da `TIPI_INTERVENTO` (rilievo, posa, assistenza, consegna, appuntamento, riunione, ferie, altro — 03/09 sera: «i tipi sono troppo pochi») | T + L2 | `strumenti/scrittura.test.ts`, `strumenti/agenda.test.ts`. |
| `collega_comunicazione` / `classifica_comunicazione` / `segna_gestita_comunicazione` | `mail.comunicazioni.collega` / `setCategoria` / `setStato` | L2 | R1 | `commessa.read`; sede | T + L2 + TC | `strumenti/scrittura.test.ts`; il collegamento a commessa segna gestita e operativa (dominio). |
| `risolvi_caso` | `actionCenter/service.transitionActionCase` (`resolve` / `dismiss` con motivo) | L2 | R1 | `commessa.read`; casi propri o direzione (dominio) | T + L2 | `strumenti/scrittura.test.ts`. |
| `cerca_comunicazioni` — comunicazioni | `comunicazioni/listComunicazioni` (ricerca sede-scoped, anche per sole cifre del numero) | L0 | R0 | `commessa.read`; testo o numero obbligatorio, estratti e mai corpi interi | T + RT + TC | `strumenti/ricerca.test.ts`; contenuto trattato come dato, mai istruzione. |
| `cerca_fatture` — economia FiC | `routers/ficFatture` (store sincronizzato, lettura sede-scoped) | L0 | R0 | `economia.read`; numero/cliente/commessa o solo-non-collegate obbligatorio | T + RT | `strumenti/ricerca.test.ts`; righe e rate escluse. |
| `cerca_documenti` — fascicoli | `preventiviContratti.documentiDiSede` / `getDocumentiDiCommessa` | L0 | R0 | `commessa.read`; nome/tipo/commessa/cliente obbligatorio | T + RT | `strumenti/ricerca.test.ts`; solo anagrafica del documento. |
| `leggi_agenda` — calendario | `routers/interventi` + `externalCalendars.events` (Google in sola lettura, via caller) | L0 | R0 | `commessa.read`; sede; squadre elencate col nome; feed esterno assente = omissione dichiarata | T + RT | `strumenti/agenda.test.ts`. |
| `sposta_intervento` — calendario | `interventi.update` (stessa procedura del Planning) | L2 | R1 | `intervento.plan` (+`intervento.assign` per la squadra, dal router); sede; «quando» in parole risolto server-side | T + L2 | `strumenti/agenda.test.ts`; prima/dopo. |
| `segna_intervento_fatto` — calendario | `interventi.updateStato` («completato») | L2 | R1 | `intervento.plan`; sede; la commessa NON avanza: `transizioneConsigliata` nell'esito (posa→finiture_saldo, rilievo→misure_esecutive) e il modello usa `transizione_adiacente_commessa` | T + L2 | `strumenti/agenda.test.ts`. |
| `migra_calendario_google` — calendario | `externalCalendars.events` → `interventi.create` (per evento, con `origineEsterna` come chiave di dedupe) | L2 | R1 | `intervento.plan` + direzione; finestra 1° mese−2 → +180 gg; commessa solo su match univoco (codice o cognome cliente); `anteprima=true` non scrive; RILANCIABILE senza doppioni | T + L2 | `calendario/migrazione.test.ts`, `strumenti/agenda.test.ts`; mandato direzione 03/09 sera («importa gli ultimi 2 mesi e quello corrente»). |
| `cerca_conferme_ordine_mancanti` (1.1.0) — fascicoli | `documenti/confermeMancanti.ts` su `listComunicazioniConAllegatiCandidati` (query dedicata riga-per-allegato, 18 mesi, indice parziale; NON listComunicazioni, che tronca a 200) + `documenti/ricercaCommessaNelDocumento.ts` (il TESTO del file contro tutte le commesse vive: cognome, indirizzo, codice, ordine noto; lettore con memoria di 12 ore, tetto di 6 letture nuove per chiamata, scansioni trascritte dal modello con l'identità di chi chiede) | L0 | R0 | `commessa.read`; esito per commessa `archiviabile_subito` / `da_confermare` / `non_trovata`; ogni candidato porta `riscontroTesto` (cita / non_cita / ambiguo / non_leggibile / non_letto) e le prove; «certa» = mail collegata + nome conferma + testo che non smentisce, oppure testo che cita QUESTA commessa e nessun'altra (anche da mail di nessuno); stoplist nomi (conferma di lettura, ordine del cliente… ma «conferma ordine cliente» del fornitore resta) e allowlist mime | T + RT | `documenti/confermeMancanti.test.ts`, `documenti/ricercaCommessaNelDocumento.test.ts`, `documenti/confermeAutoArchivio.test.ts`, `comunicazioni/allegatiCandidati.test.ts`. |
| `leggi_conferma_ordine` (1.3.0) — documenti | `documenti/letturaConferma.ts` → `estraiTestoDocumento` (parser + OCR locale + lettura visiva con il modello quando l'OCR non basta: `documenti/letturaVisiva.ts`, dietro governor, classe `lettura_documenti`, `FLAG_LETTURA_VISIVA`) su allegato mail O documento del fascicolo | L0 | R0 | `commessa.read`; un file per volta, timeout 120 s, costo medio (più la trascrizione a pagamento delle scansioni, a carico dell'utente sul ledger); restituisce fornitore (anche dall'intestazione), riferimento, numero documento del fornitore, VOSTRO riferimento, date o settimana di approntamento, totale, IMPONIBILE e `riscontroCommessa` (codice, cliente anche troncato, indirizzo, ordine noto — `documenti/riscontroCommessa.ts`) | T + RT + TC | `documenti/letturaConferma.test.ts`, `documenti/estrazioneConferma.alias.test.ts`; nessun importo registrato da qui. |
| `registra_costo_fornitore` (1.1.0) — economia | `commesse.addCosto` (direzione o amministrazione, dal router) | L2 | R1 | `economia.read`; di norma il costo NASCE DA SOLO quando la conferma entra nel fascicolo (regola di dominio `commesse/costoDaConferma.ts`, 03/09 sera): lo strumento serve a rimettere un costo tolto a mano; rilegge il documento e scrive SOLO se `importoImponibile` coincide con l'imponibile estratto; senza imponibile → «registra a mano», mai scorporo IVA; anti-doppione strutturato (`costi[].documentoId`) | T + L2 | `strumenti/scrittura.test.ts`, `commesse/costoDaConferma.test.ts` (PDF veri generati nel test). |
| `collega_fattura_commessa` — economia FiC | `ficFatture.collega` (stessa procedura del router: pattuito, incassi, PDF nel fascicolo) | L2 | R1 | `economia.read`; direzione o amministrazione (router); sede; commessa non archiviata | T + L2 | `strumenti/scrittura.test.ts`; prima/dopo nel ledger, scollegamento solo manuale. |
| `archivia_allegato_comunicazione` (1.1.0) — fascicoli | `preventiviContratti.archiviaAllegatoComunicazione` (stesso servizio dello smistamento e del worker delle conferme certe) | L2 | R1 | `commessa.manage_documents`; sede; fingerprint della fonte; per una CONFERMA D'ORDINE il testo deve citare la commessa (`documenti/riscontroCommessa.ts`: codice, cliente, indirizzo, ordine noto) e non essere una copia (riferimento d'ordine già nel fascicolo): scavalco solo con `confermaSenzaRiscontro: true` detto dall'utente; l'archiviazione fa nascere costo e merce (`commesse/costoDaConferma.ts`) | T + L2 | `strumenti/archivioAllegati.test.ts`, `smistamento/applica.test.ts`, `documenti/confermeAutoArchivio.test.ts`; origine «tars» nel registro conferme. |
| `sposta_documento` — fascicoli | `preventiviContratti.spostaDocumentoDiCommessa` (servizio di dominio) | L2 | R1 | `commessa.manage_documents` (verificata dallo strumento); sede; destinazione non archiviata; rinomina se il nome è preso; `statoAtUpload` riallineato | T + L2 | `strumenti/scrittura.test.ts`; il gate segue il documento. |
| `leggi_commessa` — commesse/gate | `routers/commesse` + `preventiviContratti` | L0 | R0 | `commessa.read`; economia sagomata da `pagamento.read`/`economia.read` | T + RT | `orchestratore.test.ts`; esistente, sola lettura. |
| `verifica_gate_commessa` — gate | `preventiviContratti.statoHasRequiredDoc` | L0 | R0 | `commessa.read` | T + RT | `orchestratore.test.ts`; esistente, nessuna transizione. |
| `verifica_transizione_commessa` — preview stato | `commesse/transizioni.verificaTransizioneCommessa` | L0 | R0 | `commessa.read`; sede verificata | T + RT | `azioni/commesse.test.ts`; stato/versione, adiacenza e gate senza effetti. |
| `transizione_adiacente_commessa` — stato commessa | `commesse/transizioni.eseguiTransizioneCommessa` (stesso comando del router) | L2 | R1 | `commessa.update_operational` + `commessa.change_state`; stato di arrivo anche NON adiacente (un passaggio alla volta, ognuno registrato e annullabile); optimistic lock per passaggio; `scavalcaGate` = «Procedi comunque» del board, solo su richiesta esplicita dell'utente, registrato (`bypassGateDocumentale`) e dichiarato; l'Undo non forza mai (02/09 sera) | T + L2 | `commesse/transizioni.test.ts`, `azioni/commesse.test.ts`, `routers/commesse.test.ts`; audit, idempotenza ledger e Undo server-side sicuro. |
| `leggi_ordini_fornitore` — ordini | `routers/fornitori` | L0 | R0 | `commessa.read`; economia opzionale e sagomata | T + RT | `orchestratore.test.ts`; esistente. Non richiede capability/flag proposte. |
| `leggi_analisi_ordine` — Document Intelligence | `documenti/analisi` | L0 | R0 | `commessa.read` + direzione | T + RT + DI | `t6Documenti.test.ts`; esistente, legge run/evidenze senza agire. |
| `leggi_centro_azioni` — Centro Azioni | `actionCenter/service.listActionCases` | L0 | R0 | `commessa.read`; scope `site` solo direzione | T + RT | `orchestratore.test.ts`; esistente, sola lettura. |
| `leggi_comunicazioni` — email/WhatsApp | `comunicazioni/listComunicazioni` | L0 | R0 | `commessa.read`; commessa o cliente obbligatorio | T + RT + TC | `t6Documenti.test.ts`; esistente, soli metadati+estratti. Manca lettura allegato/classificazione/archivio per Maccari. |
| `leggi_fascicolo_commessa` — fascicolo C3 | `tars/fascicoli.fascicoloCommessa` | L0 | R0 | `commessa.read` | T + RT | `fascicoli.test.ts`; esistente, economia esclusa per costruzione. |
| `leggi_promemoria_in_scadenza` — promemoria | `reminders/service.listPopupDue` | L0 | R0 | ownership principal | T + RT | `orchestratore.test.ts`; esistente. È una lettura L0 e richiede read-tools, non `RM`. |
| `leggi_promemoria` — agenda | `reminders/service.listPersonal` | L0 | R0 | ownership principal | T + RT | `promemoria.test.ts`; esistente. È una lettura L0 e richiede read-tools, non `RM`. |
| `crea_promemoria` — promemoria | `reminders/service.createApproved` + worker | L1 | R1 | ownership principal; commessa/cliente verificati se forniti | T + RM | `promemoria.test.ts`; esistente, parser Europe/Rome, `canonicalKey`, audit e Undo. E2E Maccari con risoluzione implicita è gap. |
| `sposta_promemoria` — promemoria | `reminders/service` | L1 | R1 | ownership principal | T + RM | `promemoria.test.ts`; esistente, idempotenza/tempo deterministico. |
| `annulla_promemoria` — promemoria | `reminders/service` | L1 | R1 | ownership principal | T + RM | `promemoria.test.ts`; esistente, annullamento tracciato. |
| `completa_promemoria` — promemoria | `reminders/service` | L1 | R1 | ownership principal | T + RM | `promemoria.test.ts`; esistente, completamento tracciato. |
| `prendi_in_carico_caso` — Centro Azioni | `actionCenter/service.transitionActionCase` | L2 | R1 | `commessa.read`; authz mine/direzione, fingerprint anti-stale | T + L2 | `t5Azioni.test.ts`, `actionCenter/service.test.ts`; esistente, audit e compensazione dichiarata. |
| `rinvia_caso` — Centro Azioni | `actionCenter/service.transitionActionCase` | L2 | R1 | `commessa.read`; authz mine/direzione, fingerprint anti-stale | T + L2 | `t5Azioni.test.ts`, `actionCenter/service.test.ts`; esistente, rinvio interno reversibile. |
| `analizza_conferma_ordine` — Document Intelligence | `documenti/analisiOrdine.analizzaConfermaPerOrdine` | L2 | R0 (analisi derivata) | direzione; run append-only e idempotenza per firma | T + L2 + DI | `t6Documenti.test.ts`, `analisiConferma.test.ts`; esistente, non modifica ordine/commessa. Manca l'allegato email generico Maccari. |
| `proponi_data_consegna` — ordine fornitore | `proposte/generazione.generaDaOrdineEDocumento` + gateway | L3 | da classificare R2/R3 | `fornitore.manage_ordini` + direzione; proposta inerte, una conferma UI | T + TP + DI + PG | `t5Azioni.test.ts`; esistente come proposta, non come applicazione del modello. Il registro futuro decide R2 o R3 in base all'impatto. |
| `ricorda` — memoria | `tars/memoria` | L1 | R1 | ownership; perimetro sede solo direzione | T + TM | `t7Memoria.test.ts`; esistente, fonte esplicita e tipi chiusi. |
| `dimentica` — memoria | `tars/memoria` | L1 | R1 | ownership; memoria sede solo direzione | T + TM | `t7Memoria.test.ts`; esistente, invalida senza cancellare audit. |
| `leggi_memorie` — memoria | `tars/memoria.memorieValide` | L0 | R0 | solo memorie valide di utente+sede | T + TM | `t7Memoria.test.ts`; esistente, non richiede read-tools. |

**Inventario verificabile.** La fonte di verità del conteggio è
`server/tars/azioni/registry.ts` (`VERSIONE_REGISTRO_AZIONI = "1.21.0"`) e
il golden di `registry.test.ts`: **56 azioni**. La tabella sopra descrive i
tool citati dalle tranche; i nomi completi si ricavano con
`rg -o 'nome: "[^"]+"' server/tars/strumenti/*.ts | sort -u`.

## Percorsi CRM e proattività senza tool corrente

| Dominio / operazione trovata | Stato reale e gap |
| --- | --- |
| Note e associazione documento alla commessa | La transizione adiacente T3 è ora un tool R1 sul servizio canonico condiviso; lo scavalco del gate (`scavalcaGate`, 02/09 sera) segue la stessa regola del board: solo su richiesta esplicita, registrato. Restano gap della catena Maccari la lettura/classificazione/archiviazione certa dell'allegato e le eventuali note/associazioni tipizzate. |
| Allegato email, match, archivio e classificazione | Esistono `mail.email.archiviaAllegato`, `archiviaAllegatoComunicazione` e lettura raw, ma nessun tool Tars. Servono servizi tipizzati per match certo/ambiguo e la regressione Maccari. |
| Economia/FiC e comunicazioni esterne | Le scritture economiche e ogni invio restano fuori catalogo. Nessun tool generico è ammesso; per un invio servono integrazione, preview, una conferma, revalidation e audit. |
| Fatturazione dal contratto (piano 2, 04/09/2026) | Nessuno strumento Tars: bozza, riequilibrio beni, emissione su Fatture in Cloud e nota di credito restano un'azione umana dalla tab «Fattura» della commessa (spec §10, `docs/superpowers/specs/2026-09-03-limiti-e-fatturazione-design.md`) — l'emissione è un effetto esterno reale verso lo SdI, fuori catalogo per costruzione. `leggi_fascicolo_commessa` (tool esistente: nome, capability e schema invariati, `descrizione` aggiornata dal Task 17) espone comunque, col flag `fatturazione` acceso, una riga di testo per fattura/nota di credito — id, numero, data, stato leggibile, esito SdI — MAI un importo, e mai il testo di `eiErrore`, che porta i totali FiC: al suo posto la frase fissa « · avviso: esito SdI/FiC da verificare nella tab Fattura» (anti-leak, Ruling R31/R36 in `server/tars/fascicoli.ts`); la sezione sparisce da sola col flag spento e si invalida a ogni scrittura sulla fattura o al flip del flag stesso, senza restare in cache oltre un giro (chiavi `fatture-di-commessa:<id>` e `flag:fatturazione` in `server/tars/versioni.ts`, Ruling R32/R33). |
| Proattività L1 | `tars/briefing.ts` ha solo due detector shadow (ordine in ritardo; conflitto date), testati in `briefing.test.ts`. Mancano coda persistente, auto-risoluzione e i detector obbligatori. |
| Proattività L2 | Nessun detector trasversale Tars trovato: servono snapshot per sede, ranking/deduplica/cooldown, evidenze e test pattern reale/falso. |
| Proattività L3 | Nessun `SafeProductCatalog` o `TarsImprovementProposal`: servono catalogo autorizzato, telemetria privacy-safe e proposta strutturata senza repository/segreti/commit/deploy. |

## Guardrail non negoziabili

- Nessun `force` generico in un input Tars (lo scavalco del gate documentale è tipizzato, esplicito e registrato: `scavalcaGate`), anche dove un router legacy lo mantiene per
  retrocompatibilità.
- Il modello non invoca procedure tRPC: ogni tool chiama un servizio di dominio
  tipizzato e ne riceve un esito strutturato.
- Nessuna scrittura SQL generica, shell, HTTP/filesystem/env raw,
  `executeSql` o `updateRecord` nel catalogo.
- Nessun provider fuori dal governor; capability, sede, feature flag,
  freschezza/versione e audit restano verificati dal server.
- Destinatari (T6/D4, 03/09/2026): `server/tars/destinatari.ts` deriva il
  destinatario (assegnatario commessa, ticket in carico, tema/stato
  amministrativo → amministrazione, altrimenti direzione);
  `tars.smistamentoProposte` filtra server-side per chi guarda — la coda
  «di tutti» non esiste più. Notifiche con lo stesso criterio: tranche
  successiva.
- Follow-up preventivi (T5/D3, 03/09/2026): deterministico in
  `server/tars/followup/` — promemoria di sollecito a 7 giorni
  (canonicalKey `tars:sollecito-preventivo:<id>:<giorno ultima attività>`)
  e segnale `preventivo_followup` a 30 nel reconcile UNICO del Centro
  Azioni. L'età è l'attività reale, mai `updatedAt`; nessun modello.
- Proposta→azione (T3, 03/09/2026): una proposta dell'analisi può portare
  `azione {strumento, input JSON}` SOLO dalla whitelist
  `STRUMENTI_PROPOSTE_ESEGUIBILI` (`analisi/analisi.ts`); la verifica
  passa da `descrittoreAzione` + `schemaInput` alla generazione E
  dall'intero percorso catalogo+ledger R1 al click
  (`analisi/esecuzione.ts`, runId `analisi:<id>:proposta:<indice>`,
  doppio click = riuso). `scavalcaGate` da proposta è vietato in entrambi
  i punti.
- T0 è documentale: il delta non deve contenere `client/`.

## Accettazione che questa matrice vincola

La regressione Maccari e i tre livelli proattivi sono vincolanti nella
specifica (§29), ma non sono dichiarati realizzati da questa matrice. Una
tranche successiva non può chiudersi con una chat descrittiva: deve provare
nel runtime gli esiti, i blocchi, l'idempotenza e l'assenza di leak elencati
in `architettura-tars-v2.md`.
