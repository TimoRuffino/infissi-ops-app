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

## Inventario integrale dei 21 tool correnti

| Tool e dominio | Servizio canonico / confine | Livello corrente L | R target/gap | Capability e altri vincoli | Flag richiesti | Test trovato / stato reale e gap |
| --- | --- | --- | --- | --- | --- | --- |
| `cerca_commesse` — commesse | `routers/commesse` (lettura sede-scoped) | L0 | R0 | `commessa.read` | T + RT | `orchestratore.test.ts`; esistente, senza importi non autorizzati. |
| `leggi_commessa` — commesse/gate | `routers/commesse` + `preventiviContratti` | L0 | R0 | `commessa.read`; economia sagomata da `pagamento.read`/`economia.read` | T + RT | `orchestratore.test.ts`; esistente, sola lettura. |
| `verifica_gate_commessa` — gate | `preventiviContratti.statoHasRequiredDoc` | L0 | R0 | `commessa.read` | T + RT | `orchestratore.test.ts`; esistente, nessuna transizione. |
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

**Inventario verificabile.** Il comando seguente ricava questi 21 nomi dalla
sorgente: `for file in server/tars/strumenti/*.ts; do rg -o 'nome: "[^"]+"'
"$file"; done | sed -E 's/.*nome: "([^"]+)"/\\1/' | sort -u`. Il numero
atteso e documentato è **21**; ogni nome compare una volta nella tabella.

## Percorsi CRM e proattività senza tool corrente

| Dominio / operazione trovata | Stato reale e gap |
| --- | --- |
| Transizione commessa, note e associazione documento | `commesse.update` contiene ancora transizione/gate e il suo `force` legacy. Tars non lo invoca. Estrarre un servizio canonico senza `force`, con versione/audit/Undo, è necessario per Maccari. |
| Allegato email, match, archivio e classificazione | Esistono `mail.email.archiviaAllegato`, `archiviaAllegatoComunicazione` e lettura raw, ma nessun tool Tars. Servono servizi tipizzati per match certo/ambiguo e la regressione Maccari. |
| Economia/FiC e comunicazioni esterne | Le scritture economiche e ogni invio restano fuori catalogo. Nessun tool generico è ammesso; per un invio servono integrazione, preview, una conferma, revalidation e audit. |
| Proattività L1 | `tars/briefing.ts` ha solo due detector shadow (ordine in ritardo; conflitto date), testati in `briefing.test.ts`. Mancano coda persistente, auto-risoluzione e i detector obbligatori. |
| Proattività L2 | Nessun detector trasversale Tars trovato: servono snapshot per sede, ranking/deduplica/cooldown, evidenze e test pattern reale/falso. |
| Proattività L3 | Nessun `SafeProductCatalog` o `TarsImprovementProposal`: servono catalogo autorizzato, telemetria privacy-safe e proposta strutturata senza repository/segreti/commit/deploy. |

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
