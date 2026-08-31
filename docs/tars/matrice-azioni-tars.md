# Tars — matrice verificata delle azioni (T0)

**Rilevata il 31/08/2026 sul checkout locale `main`.** Questa matrice descrive
il codice presente, non lo stato di un ambiente esterno. `Esistente` significa
che il percorso server è stato trovato; non significa che un flag sia acceso
né che una capacità possa essere dichiarata completa. I riferimenti a R0-R4
del mandato corrispondono ai livelli tecnici L0-L5 già registrati nella
specifica: R1/R2/R3 richiedono sempre policy, sede, capability, rilettura
server-side, idempotenza e audit.

| Dominio / operazioni CRM trovate | Servizio canonico o confine attuale | Tool Tars / rischio | Capability e flag | Stato reale e test trovati | Gap verificato |
| --- | --- | --- | --- | --- | --- |
| Commesse: cerca, leggere stato/gate/ordini, aggiornare e cambiare stato | Letture: `routers/commesse` + `preventiviContratti`; `commesse.update` contiene ancora la logica di transizione e gate, quindi non è un servizio riusabile | `cerca_commesse`, `leggi_commessa`, `verifica_gate_commessa`, `leggi_fascicolo_commessa` / L0 | `commessa.read`; `FLAG_TARS` + `FLAG_TARS_READ_TOOLS` | Letture sede-scoped, shaping economia e `NOT_FOUND`; `server/tars/orchestratore.test.ts`, `fascicoli.test.ts`, `routers/commesse.test.ts` | Nessun tool di transizione o nota operativa. Estrarre un servizio canonico che non accetti `force`, con versione, audit e Undo/compensazione: necessario per Maccari. Il `force` legacy del router non è utilizzabile da Tars. |
| Email/WhatsApp: leggere thread, allegati, collegamento e archiviazione | Archivio `comunicazioni`; `mail.email.archiviaAllegato` e `archiviaAllegatoComunicazione`; lettura raw in `comunicazioni/allegati` | `leggi_comunicazioni` / L0, soli metadati+estratti | `commessa.read`; `FLAG_TARS_COMMUNICATIONS` oltre a master/read | Tool limita il corpo a 240 caratteri e tratta il contenuto come dato; `server/tars/t6Documenti.test.ts`, `comunicazioni/mail.test.ts` | Nessun tool per trovare l'ultima email, leggere l'allegato, collegarla/classificarla o archiviarla nel fascicolo. Servono servizi tipizzati e una catena Maccari con match certo/ambiguo. Nessun invio è implementato. |
| Document Intelligence: analisi conferma d'ordine e confronto con ordine | `documenti/analisiOrdine.analizzaConfermaPerOrdine`, idempotenza per firma | `analizza_conferma_ordine` / L2, derivazione append-only | Direzione; `FLAG_TARS_L2_ACTIONS` + `FLAG_DOCUMENT_INTELLIGENCE` | Riusa la stessa fonte del router, non modifica commesse/ordini; `server/tars/t6Documenti.test.ts`, `documenti/analisiConferma.test.ts` | Copre una conferma già nel fascicolo, non un allegato email generico né classificazione/collegamento Maccari. Nessun OCR/analisi non supportata va inventata. |
| Ordini fornitore: leggere e proporre data consegna da conferma | `fornitori` + `proposte/generazione.generaDaOrdineEDocumento` + gateway | `leggi_ordini_fornitore` L0; `proponi_data_consegna` L3 (proposta inerte) | `fornitore.manage_ordini`, direzione; `FLAG_DOCUMENT_INTELLIGENCE` + `FLAG_PROPOSTE` + `FLAG_TARS_PROPOSALS` | Una sola conferma umana mediante `proposte.approvaEApplica`; modello senza tool di approvazione; `server/tars/t5Azioni.test.ts` | Registro azioni limitato alla data consegna: nessuna trasmissione ordine, planning o effetto esterno. |
| Promemoria personali: creare, spostare, annullare, completare, agenda | `reminders/service` e worker esistenti | `crea/sposta/annulla/completa_promemoria`, `leggi_promemoria` / L1 e L0 | Ownership principal; `FLAG_TARS_REMINDERS` | Parsing Europe/Rome, idempotenza `canonicalKey`, link commessa/cliente, audit e Undo create; `server/tars/promemoria.test.ts`, `reminders` test | Il tool esiste e può collegare una commessa già risolta. Manca il test E2E che risolva «Maccari» e provi un solo risultato sul retry. |
| Centro Azioni: leggere, prendere in carico e rinviare casi | `actionCenter/service.transitionActionCase` + repository/eventi | `leggi_centro_azioni` L0; `prendi_in_carico_caso`, `rinvia_caso` / L2 | `commessa.read`; `FLAG_TARS_L2_ACTIONS` | Anti-stale `expectedFingerprint`, authz mine/direzione, audit; `server/tars/t5Azioni.test.ts`, `actionCenter/service.test.ts` | Solo due azioni L2; nessuna azione ticket, checklist, note condivise o associazione documentale. |
| Memoria operativa | `tars/memoria.ts` su `tars_memoria` | `ricorda`, `dimentica`, `leggi_memorie` / L1/L0 | Direzione per sede, altrimenti utente; `FLAG_TARS_MEMORY` | Tipi chiusi, invalidazione invece di delete, memoria non autorevole; `server/tars/t7Memoria.test.ts` | Nessuna ricerca semantica: flag e codice restano spenti/differiti; serve policy retention esplicita. |
| Economia/FiC: fatture, incassi, residui | `ficFatture` e registro pagamenti sono fonti/servizi autonomi; Tars legge dati sagomati dalla commessa | Nessun tool economico di scrittura / L0 lettura condizionata | `pagamento.read` o `economia.read`; read tools | Importi omessi senza capability; `orchestratore.test.ts`, test authz economica | Nessuna mutation economica Tars, né tool generico: incassi, note di credito e fonti fiscali restano fuori catalogo. |
| Comunicazioni esterne | Non esiste un adapter SMTP/WhatsApp send nel perimetro Tars | Nessuno / futuro R2-R3 o L4 | N/A | La spec e `t6Documenti.test.ts` provano l'assenza di strumenti di invio | Prima di qualsiasi invio: integrazione esterna, preview immutabile, una conferma, revalidation, audit e action registry tipizzato. |
| Proattività L1: singola commessa | `tars/briefing.ts`, detector deterministici a richiesta | Nessun tool di mutazione; shadow | `commessa.read`; `FLAG_TARS_PROACTIVE` | Due segnali: ordine in ritardo e conflitto data prevista/confermata; no emissioni; `server/tars/briefing.test.ts` | Mancano molti detector obbligatori, coda persistente, fingerprint/stato esposto completo, auto-risoluzione e azione operativa. |
| Proattività L2: pattern aziendali | Nessun servizio/detector trasversale Tars trovato | Nessuno | Nessuno | Non implementata; nessun test dedicato | Costruire snapshot per sede, ranking/deduplica/cooldown, evidenze e linguaggio di correlazione non causale; test per pattern reale e falso positivo. |
| Proattività L3: miglioramento CRM/processi | Nessun `SafeProductCatalog` o `TarsImprovementProposal` trovato | Nessuno | Nessuno | Non implementata; nessun test dedicato | Catalogo di soli metadati autorizzati, telemetria privacy-safe e proposta strutturata; Tars non riceve repository/segreti e non può modificare codice, commit, push o deploy. |
| Provider, budget e policy | `tars/costi/providerGovernato.ts` è il confine; adapter grezzo è ristretto | Nessun tool provider; L5 vietato | Master `FLAG_TARS`, configurazione provider e governor | Guardie strutturali/rete e test costi; `server/tars/costi/*test*`, `server/_core/testSetup.ts` | Conservare il confine unico: nessun provider fuori governor, nessuna chiave reale nei test; i limiti del governor non sono autorizzazioni di dominio. |

## Guardrail non negoziabili

- Nessun `force` in un input Tars, anche dove un router legacy lo mantiene per
  retrocompatibilità.
- Il modello non invoca procedure tRPC: ogni tool chiama un servizio di dominio
  tipizzato e ne riceve un esito strutturato.
- Nessuna scrittura SQL generica, shell, HTTP/filesystem/env raw,
  `executeSql` o `updateRecord` nel catalogo.
- Nessun provider fuori dal governor; capability, sede, feature flag,
  freschezza/versione e audit restano verificati dal server.
- T0 è documentale: il delta non deve contenere `client/`.

## Accettazione che questa matrice vincola

La regressione Maccari e i tre livelli proattivi sono vincolanti nella
specifica (§29), ma non sono dichiarati realizzati da questa matrice. Una
tranche successiva non può chiudersi con una chat descrittiva: deve provare
nel runtime gli esiti, i blocchi, l'idempotenza e l'assenza di leak elencati
in `architettura-tars-v2.md`.
