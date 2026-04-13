# Documento requisiti — Web app operativa per commesse infissi, produzione e post-vendita

**Autore:** Manus AI  
**Stato:** Documento dei Requisiti Aggiornato e Ottimizzato (Inclusione Ramo Produzione)  
**Obiettivo del documento:** Definire in modo condivisibile e dettagliato il perimetro funzionale, operativo e di esperienza utente della web app, integrando i nuovi requisiti di gestione avanzata (Microsoft To Do, Google Calendar), l'evoluzione del modulo di rilievo multimediale, l'ottimizzazione della logica complessiva centrata sul cliente, e l'introduzione del **nuovo modulo per la gestione della produzione e assemblaggio interno degli infissi**.

## 1. Visione del prodotto

L'applicazione proposta è una **web app professionale per la gestione operativa di commesse edili e serramentistiche**, progettata per accompagnare l'intero ciclo di vita della commessa: dal primo contatto al rilievo iniziale, passando per la **produzione e assemblaggio interno**, fino alla posa e al post-vendita. Il valore del prodotto non è commerciale o orientato alla generazione di nuovi clienti, ma strettamente **operativo, documentale e organizzativo**.

L'obiettivo centrale è creare un unico ambiente digitale in cui ufficio, tecnici di rilievo, **addetti al laboratorio di produzione**, squadre di posa e assistenza possano lavorare su informazioni coerenti, aggiornate e tracciabili. La web app deve quindi ridurre errori di passaggio tra le varie fasi, garantendo che ciò che viene rilevato sia esattamente ciò che viene prodotto, ordinato e installato.

L'applicazione funge da hub centralizzato, comunicando fluidamente con strumenti esterni consolidati. Si integra con **Microsoft To Do** per la gestione capillare dei task operativi e con **Google Calendar** per la pianificazione degli appuntamenti (rilievi, pose, consegne).

Dal punto di vista d'uso, il prodotto deve funzionare in modo naturale in tre contesti complementari: in cantiere (mobile-first per rilievi e posa), in laboratorio (interfaccia chiara per l'assemblaggio e controllo qualità) e in ufficio (lettura estesa, pianificazione, gestione ordini fornitori e anagrafica cliente a 360 gradi).

## 2. Obiettivi di business e operativi

Il prodotto dovrà consentire all'azienda di standardizzare il lavoro operativo, gestire la nuova linea di produzione interna come una business unit autonoma e costruire uno storico affidabile.

| Ambito | Obiettivo |
|---|---|
| Rilievo | Rendere il rilievo completo, tecnico ma intuitivo, con supporto multimediale avanzato (foto e video) |
| **Produzione & Laboratorio** | **Gestire il flusso di assemblaggio interno, tracciare componenti (PVC, alluminio, ferramenta) e generare la documentazione obbligatoria (DoP e marcatura CE)** |
| Gestione Fornitori | Tracciare ordini di materiali, ricevimento merci e controllo qualità in ingresso |
| Posa | Guidare l'esecuzione con checklist e raccolta evidenze obbligatorie |
| Chiusura lavori | Formalizzare la consegna con verbale, firma e dossier automatico |
| Post-vendita | Organizzare ticket, difetti, garanzie e storico interventi (gestione resi/assistenze) |
| Coordinamento | Pianificare appuntamenti e task integrandosi bidirezionalmente con To Do e Calendar |
| Controllo manageriale | Evidenziare anomalie ricorrenti, tempi medi, costi reali per commessa e marginalità |
| Gestione Cliente | Centralizzare tutte le commesse, gli interventi e i documenti sotto un'unica anagrafica cliente |

## 3. Nuova Logica Applicativa: Centralità del Cliente e Flusso di Commessa

L'architettura del sistema si basa sull'entità **Cliente** come fulcro informativo, attorno a cui ruotano i progetti (Commesse). 

Questa logica strutturale permette di:
- Avere una **Dashboard Cliente** unificata che mostri lo storico completo di tutte le commesse, gli interventi e i ticket.
- Gestire referenti multipli in modo strutturato.
- Tracciare l'evoluzione del rapporto con il cliente nel tempo.

Ogni commessa segue un **flusso di lavoro standardizzato e rigoroso**, essenziale per il funzionamento del nuovo ramo produttivo:
1. **Primo contatto e preventivo** (Area commerciale)
2. **Rilievo definitivo** (Tecnico rilievi)
3. **Validazione tecnica e Distinta Base** (Responsabile commessa/produzione)
4. **Ordini ai fornitori** (Ufficio tecnico-acquisti)
5. **Ricevimento e controllo materiali** (Magazzino/laboratorio)
6. **Assemblaggio, preparazione e controllo qualità** (Laboratorio)
7. **Posa e chiusura** (Squadra posa)
8. **Assistenza finale** (Responsabile post-vendita)

## 4. Utenti e ruoli operativi

La web app deve essere concepita per più figure aziendali, con l'introduzione di nuovi ruoli legati alla produzione.

| Ruolo | Contesto principale | Responsabilità principali | Bisogni di interfaccia |
|---|---|---|---|
| Direzione / Titolare | Ufficio | Strategia, listini, fornitori, marginalità, KPI | Dashboard direzionale, costi, tempi medi |
| Responsabile commessa-produzione | Ufficio / Laboratorio | Coordina rilievo, ordine, laboratorio e posa (Punto di controllo unico) | Vista globale flusso commessa, validazione tecnica |
| Tecnico rilevatore | Cantiere | Compilazione rilievi, foto, video, dettagli di cantiere | Flusso guidato mobile, campi rapidi, upload media |
| Ufficio ordini / Acquisti | Ufficio | Emette ordini ai fornitori, controlla conferme e tempistiche | Gestione distinte base, tracciamento forniture |
| **Addetto Laboratorio** | **Laboratorio** | **Ricevimento merci, assemblaggio, controllo qualità, imballo** | **Checklist di produzione, etichettatura, segnalazione non conformità** |
| Squadra di posa | Cantiere | Esecuzione checklist, anomalie, verbale chiusura | Navigazione mobile-first, step sequenziali, firma |
| Tecnico post-vendita | Cantiere / Laboratorio | Ticket, difetti, foto prima/dopo, riparazioni in laboratorio | Agenda, apertura ticket, gestione resi |

## 5. Moduli funzionali del prodotto

### 5.1 Rilievo tecnico multimediale avanzato

Il modulo di rilievo è l'input primario per la produzione. Deve essere estremamente preciso.

| Requisito | Descrizione |
|---|---|
| Misure tecniche guidate | Inserimento strutturato di quote con controlli di coerenza per tipologia di apertura |
| Acquisizione Multimediale | Possibilità di scattare foto e registrare video associandoli alla singola apertura |
| Annotazioni su immagini | Strumento integrato per disegnare quote, frecce e note testuali sulle foto |
| Note vocali | Registrazione audio con trascrizione automatica in testo (speech-to-text) |
| Esportazione tecnica | Generazione automatica di un documento di rilievo strutturato per l'ufficio acquisti e la produzione |

### 5.2 Modulo Produzione e Laboratorio (NUOVO)

Questo modulo gestisce la trasformazione dei materiali in prodotto finito, garantendo il controllo industriale richiesto per operare come fabbricante.

| Requisito | Descrizione |
|---|---|
| Distinta Base (BOM) | Generazione della distinta base a partire dal rilievo validato, con elenco profili, ferramenta, vetri e accessori necessari |
| Gestione Forniture | Tracciamento degli ordini ai fornitori e registrazione del ricevimento materiali (controllo quantità, codici e danni in ingresso) |
| Fasi di Assemblaggio | Checklist digitali per le lavorazioni al banco, garantendo ripetibilità e controllo qualità interno |
| Tracciabilità Componenti | Associazione dei lotti di profili e vetri alla specifica commessa per la tracciabilità normativa |
| Fascicolo Tecnico e DoP | Generazione automatica della documentazione obbligatoria: Declaration of Performance (DoP), etichettatura per marcatura CE (UNI EN 14351-1) e documenti di consegna |
| Gestione Resi Interni | Area dedicata per gestire le non conformità rilevate in laboratorio senza bloccare il resto della produzione |

### 5.3 Integrazione Task Management (Microsoft To Do)

| Requisito | Descrizione |
|---|---|
| Creazione automatica task | Generazione automatica di task per attività operative (es. "Verificare ordine fornitore", "Controllare materiali in ingresso") |
| Linked Resources | Link diretto dal task To Do alla specifica commessa, ordine o apertura nell'app |
| Sincronizzazione stato | Completando il task in To Do, lo stato si aggiorna nell'app (e viceversa) |
| Liste dedicate | Liste To Do specifiche: "Task Rilievo", "Task Acquisti", "Task Laboratorio" |

### 5.4 Integrazione Pianificazione (Google Calendar)

| Requisito | Descrizione |
|---|---|
| Sincronizzazione Eventi | Creazione eventi su Google Calendar per rilievi, pose e consegne materiali |
| Dettagli completi | L'evento includerà descrizione, contatti e indirizzo esatto del cantiere |
| Assegnazione Squadre | Aggiunta automatica ai calendari dei membri della squadra o degli addetti al laboratorio |
| Codifica a colori | Colori distinti per rilievi, pose, lavoro in laboratorio e assistenza |

### 5.5 Posa assistita e Verbale di chiusura

| Requisito | Descrizione |
|---|---|
| Checklist dinamiche | Sequenze operative guidate per l'installazione |
| Foto obbligatorie | Raccolta fotografica step-by-step come evidenza di esecuzione |
| Verbale e Firma | Compilazione del verbale in cantiere con firma digitale del cliente |
| Dossier automatico | Generazione PDF finale archiviabile con foto, note e documenti normativi (DoP) |

### 5.6 Gestione post-vendita e Garanzie

| Requisito | Descrizione |
|---|---|
| Apertura ticket | Creazione di richieste collegate a cliente, commessa e specifica apertura |
| Categorizzazione difetti | Classificazione standardizzata del problema per analisi ricorrenti |
| Gestione Garanzie | Tracciamento scadenze garanzia per prodotto (fabbricante) e per posa |

## 6. Struttura informativa aggiornata

Il modello dati deve supportare la logica centrata sul cliente, la produzione interna e le integrazioni.

| Entità logica | Descrizione funzionale |
|---|---|
| Cliente | Anagrafica centrale (referenti, contatti, storico completo) |
| Commessa | Contenitore del progetto specifico. Ha un proprio stato di avanzamento (Preventivo, Rilievo, Produzione, Posa, Chiusa) |
| Apertura | Unità tecnica (finestra, porta). Contiene misure, media e configurazione prodotto |
| **Distinta Base / Ordine** | **Elenco dei materiali necessari (profili, vetri, ferramenta) collegati ai rispettivi fornitori** |
| **Lavorazione Laboratorio** | **Fase produttiva interna con checklist di controllo qualità ed etichettatura** |
| Intervento | Attività pianificata (sincronizzata con Google Calendar) |
| Task Operativo | Azione da svolgere (sincronizzata con Microsoft To Do) |
| Documento / Media | File binari (Foto, Video, PDF, DoP). Supporto per annotazioni su immagini |
| Anomalia / Ticket | Problemi segnalati in corso d'opera, in laboratorio o in post-vendita |

## 7. Principi di esperienza utente e Linee guida visuali

L'esperienza mantiene un approccio **mobile-first** per il cantiere (rilievo e posa) e un layout ottimizzato per tablet/desktop per il **laboratorio** (dove gli addetti necessitano di schede prodotto chiare, distinte base leggibili e pulsanti per confermare le fasi di assemblaggio). In ufficio, il layout esteso permetterà la gestione di dashboard e pianificazione.

Lo stile visivo rimane fedele all'**International Typographic Style**: layout pulito, griglia rigorosa, tipografia sans-serif tecnica. Deve trasmettere precisione, controllo industriale e affidabilità.

## 8. Requisiti di Storage e Sicurezza

La gestione dei media (foto, video) e dei documenti normativi generati (DoP, manuali d'uso, marcature CE) richiede uno storage cloud robusto (es. AWS S3 o Cloudflare R2). I documenti normativi devono essere immutabili e sempre accessibili per garantire la conformità legale del fabbricante.

## 9. Punti di attenzione per lo Sviluppo (Claude Code)

1. **Refactoring DB per Produzione**: Oltre all'entità `Cliente`, è necessario implementare tabelle per `Fornitori`, `Distinte_Base` (materiali), e `Fasi_Produzione` per tracciare lo stato di assemblaggio in laboratorio.
2. **Generazione Documentale (DoP)**: Implementare un sistema di templating (es. PDF generation) per produrre automaticamente la Declaration of Performance e le etichette CE basate sui dati dell'apertura e dei materiali utilizzati.
3. **Flussi di Stato Rigidi**: Implementare una macchina a stati finiti (State Machine) per la commessa, impedendo di passare alla produzione se il rilievo non è validato, o alla posa se la produzione non ha superato il controllo qualità.
4. **Upload Media**: Componente robusto per upload multipart di immagini/video.
5. **Integrazioni API**: Predisporre OAuth2 per Microsoft Graph (To Do) e Google APIs (Calendar), con webhook per sincronizzazione real-time.
6. **Kanban Board Commesse**: Implementare una board drag-and-drop per lo stato avanzamento cliente (sezione 10), con aggiornamento stato via drag-and-drop e persistenza in DB.
7. **Multi-Calendario**: Implementare 6 calendari distinti con filtri per ruolo utente (sezione 11.2). Valutare Google Calendar multi-calendar API o soluzione self-hosted (FullCalendar.js).
8. **Timeline Ordine con Allegati**: I 19 step della timeline (sezione 12) richiedono una tabella `order_steps` con campi per file allegati (S3/R2), utente, timestamp e note per ogni step.
9. **Gestione Ticket Biforcata**: Implementare due entità separate `Reclami` e `Rifacimenti` con flussi di stato indipendenti e dashboard contatori distinti (sezione 13).
10. **RBAC (Role-Based Access Control)**: Sistema di permessi granulare per i 6 profili utente definiti in sezione 14. Ogni entità (cliente, intervento, ticket) ha un campo `assigned_user_id`.
11. **Modulo Fornitori V2**: Refactoring completo della tabella fornitori con supporto per: versioning listini, scontistica per categoria, upload documenti multipli e struttura modulare per preventivatori futuri (sezione 15).

---

## 10. Stato Avanzamento Cliente — Board To Do

La vista principale della gestione clienti deve presentarsi come una **kanban board** con le seguenti colonne, che rappresentano i macro-stati di avanzamento della commessa:

| Colonna | Significato operativo |
|---|---|
| **Preventivo** | Commessa in fase di offerta commerciale, non ancora confermata |
| **Misure Esecutive** | Sopralluogo/rilievo tecnico da effettuare o in corso |
| **Aggiornamento a Contratto** | Preventivo accettato, contratto in fase di formalizzazione |
| **Fatture e Pagamento** | Fatturazione emessa, in attesa di saldo o acconto |
| **Da Ordinare** | Materiali da ordinare ai fornitori |
| **Produzione** | Merce ordinata, in fase di produzione o assemblaggio |
| **Ordini per Ultimazione Lavori** | Ordini aggiuntivi/complementari per chiudere la commessa |
| **Attesa Posa** | Merce disponibile, in attesa di programmazione posa |
| **Finiture a Saldo** | Lavori di posa completati, finiture residue e saldo da incassare |
| **Interventi/Regolazioni** | Interventi post-posa, regolazioni, assistenze |

Ogni card cliente sulla board deve mostrare: nome cliente, commerciale assegnato, data prevista step successivo e indicatore di urgenza.

---

## 11. Dashboard — Miglioramenti Calendario e Visibilità

### 11.1 Calendario più visibile in Dashboard

La dashboard principale deve avere il **calendario come elemento primario e immediatamente visibile**, non nascosto o ridotto. Requisiti:

- Visualizzazione default a settimana corrente con possibilità di passare a mese
- Tutti gli eventi del giorno visibili senza scroll orizzontale
- Click su evento apre direttamente la commessa/intervento collegato
- Widget "Oggi" con riepilogo rapido degli appuntamenti del giorno

### 11.2 Suddivisione in Calendari Dedicati

Il sistema di calendario deve essere suddiviso in **calendari separati e filtrabili**, ciascuno con colore distinto:

| Calendario | Contenuto | Visibile a |
|---|---|---|
| **Misure Esecutive** | Appuntamenti di rilievo/sopralluogo tecnico, con disponibilità dei tecnici | Tecnici, Responsabile commessa, Direzione |
| **Showroom Commerciali** | Appuntamenti con clienti in showroom dei commerciali | Commerciali, Direzione |
| **Posa** | Pianificazione interventi di installazione con squadre | Squadre posa, Responsabile commessa, Direzione |
| **Interventi/Regolazioni** | Post-vendita: sopralluoghi, regolazioni, assistenze | Tecnico post-vendita, Direzione |
| **Presenza Stefano in Showroom** | Indica se Stefano è presente in showroom mattina o pomeriggio | Tutto il team |
| **Commerciale di Turno Sabato** | Indica quale commerciale sarà in showroom il sabato mattina | Tutto il team |

Ogni calendario deve essere attivabile/disattivabile singolarmente dalla dashboard. I calendari "Presenza Stefano" e "Commerciale Sabato" funzionano come **turni ricorrenti** modificabili settimana per settimana.

---

## 12. Controllo Stato Avanzamento Ordine — Step Dettagliati

Ogni commessa deve avere una **timeline di avanzamento ordine** con i seguenti step tracciabili singolarmente. Ogni step ha: stato (completato / in corso / da fare), data di completamento, utente che ha eseguito l'azione e possibilità di allegare file dove indicato.

| # | Step | Note / Allegati |
|---|---|---|
| 1 | **Rilievo Misure** | Data sopralluogo, tecnico assegnato |
| 2 | **Firma Contratto** | Allegabile: contratto firmato (PDF/immagine) |
| 3 | **Fatturazione** | Numero fattura, importo |
| 4 | **Invio Fattura al Cliente** | Data invio, metodo (email/cartaceo) |
| 5 | **Pagamento 1° Acconto Cliente** | Importo, data, metodo di pagamento |
| 6 | **Ordine Merce al Fornitore** | Fornitore, numero ordine |
| 7 | **Conferma Ordine Fornitore** | **Possibilità di allegare file** (conferma d'ordine PDF) |
| 8 | **Pagamento Acconto Fornitore** | Importo, data |
| 9 | **Data Spedizione Prevista Fornitore** | Data stimata, note logistica |
| 10 | **Pagamento Merce Pronta Fornitore** | Importo saldo, data |
| 11 | **Pagamento Secondo Acconto Cliente** | Importo, data, metodo |
| 12 | **Data Consegna Merce** | Data effettiva arrivo merce in magazzino |
| 13 | **Appuntamento Posa** | Data, ora, squadra assegnata (collegato al Calendario Posa) |
| 14 | **Lista Merce Posata** | Elenco degli elementi installati, spunta per ciascuno |
| 15 | **DDT Posa** | **Possibilità di allegare file** (documento di trasporto) |
| 16 | **Finiture** | Note sulle lavorazioni di finitura residue |
| 17 | **Pagamento Ultimo Cliente (Saldo)** | Importo, data, metodo |
| 18 | **Fine Lavori — DDT Finale** | **Possibilità di allegare file e foto** (verbale consegna, foto cantiere) |
| 19 | **Recensione del Cliente** | Link recensione Google/altro, testo libero, valutazione stelline |

La timeline deve essere visibile in formato verticale sulla scheda commessa, con indicatore percentuale di completamento in cima.

---

## 13. Gestione Ticket — Reclami e Rifacimenti

I ticket post-vendita devono essere **obbligatoriamente categorizzati** in due tipologie distinte con flussi separati:

### 13.1 Reclami
Segnalazioni di difetti, malfunzionamenti o insoddisfazione del cliente su lavori già completati. Campi:

- Cliente e commessa collegata
- Descrizione del problema
- Foto allegate (prima)
- Responsabile assegnato
- Stato: Aperto → In gestione → Risolto → Chiuso
- Data apertura / data risoluzione
- Soluzione adottata + foto dopo

### 13.2 Rifacimenti
Lavori che richiedono una nuova produzione o reinstallazione a seguito di errori tecnici, difetti di produzione o non conformità. Campi aggiuntivi rispetto al reclamo:

- Identificazione del pezzo/elemento da rifare
- Fornitore coinvolto (se difetto di fornitura)
- Ordine di rifacimento collegato
- Costo stimato del rifacimento (per analisi marginalità)
- Responsabilità interna / esterna

La **dashboard ticket** deve mostrare separatamente: contatore reclami aperti e contatore rifacimenti aperti, con filtri per commerciale assegnato, periodo e stato.

---

## 14. Gestione Utenti e Permessi

### 14.1 Creazione e Ruoli Utenti

Il sistema deve consentire la creazione di utenti con i seguenti **profili di accesso**:

| Profilo | Accesso |
|---|---|
| **Direzione** | Accesso completo a tutto il sistema, incluse statistiche, marginalità e configurazioni |
| **Amministrazione** | Fatture, pagamenti, scadenziario, step finanziari della timeline ordine |
| **Commerciale** | Clienti assegnati, preventivi, board kanban, calendari showroom |
| **Tecnico Rilievi** | Propri appuntamenti, modulo rilievo, calendario misure |
| **Squadra Posa** | Calendario posa, checklist posa, DDT |
| **Post-vendita / Assistenza** | Ticket, interventi, calendario regolazioni |

### 14.2 Assegnazione Utenti alle Entità

Un utente può essere assegnato (e quindi responsabile o co-responsabile) delle seguenti entità:

- **Clienti** — un commerciale "possiede" i propri clienti e vede solo quelli assegnati (salvo Direzione)
- **Interventi** — tecnico o squadra responsabile dell'intervento
- **Ticket** — responsabile della risoluzione del reclamo/rifacimento
- **Rifacimenti** — responsabile del follow-up del rifacimento
- **Reclami** — responsabile della gestione del reclamo

L'assegnazione è visibile sulla card e filtrabile nella board/lista. Le notifiche (email o push) vengono inviate all'utente assegnato al cambio di stato.

---

## 15. Sezione Fornitori — Revisione Completa

La sezione Fornitori viene **completamente ridisegnata** come un modulo autonomo e completo. Ogni fornitore avrà una scheda dedicata con le seguenti aree:

### 15.1 Anagrafica Fornitore

- Ragione sociale, P.IVA, indirizzo, contatti (telefono, email, referente commerciale)
- Categoria merceologica (es. PVC, Alluminio, Vetro, Ferramenta, Persiane, Blindati, Accessori)
- Note interne

### 15.2 Listini e Documentazione

- **Caricamento listini** in formato PDF o Excel, con versioning (ogni listino ha data di validità)
- **Scontistica personalizzata**: percentuale di sconto o listino netto per categoria di prodotto
- Possibilità di allegare qualsiasi documento commerciale (accordi quadro, condizioni di pagamento, certificazioni)
- Storico revisioni listino con data di aggiornamento

### 15.3 Storico Ordini

- Lista di tutti gli ordini effettuati a quel fornitore, con importi, date e stato
- Collegamento diretto alla commessa di riferimento

### 15.4 Preventivatori Integrabili (Sviluppo Futuro)

La struttura del modulo Fornitori deve essere **predisposta per ospitare preventivatori verticali** che verranno sviluppati in futuro. I primi due preventivatori previsti sono:

| Preventivatore | Descrizione |
|---|---|
| **Persiane** | Configuratore per il calcolo del prezzo di persiane (tipologia, dimensioni, materiale, colore, motorizzazione) con output di preventivo automatico e ordine fornitore |
| **Porte Blindate** | Configuratore per blindati (classe di sicurezza, dimensioni, finitura, accessori) con output preventivo e ordine |

Ogni preventivatore sarà associato a uno specifico fornitore e utilizzerà il listino/scontistica già caricata nella scheda fornitore per il calcolo automatico del prezzo di acquisto e vendita.
