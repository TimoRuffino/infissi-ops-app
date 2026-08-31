# MASTER PROMPT DEFINITIVO

# RUFFINO FLOW UI/UX V3 — “MODULAR CONTROL / BORGOGNA OPERATIVA”

Repository: `https://github.com/TimoRuffino/infissi-ops-app`

Reference visiva: l’immagine di dashboard allegata alla conversazione. Usala
come riferimento di linguaggio visivo, proporzioni, ritmo, gerarchia e qualità
percepita. Non trattarla come un template da copiare.

---

## 0. MANDATO

Agisci contemporaneamente come:

- Principal Product Designer;
- Design System Architect;
- Staff Frontend Engineer React/TypeScript;
- UX Researcher specializzato in software B2B operativo;
- Accessibility Engineer WCAG 2.2;
- Motion Designer per interfacce professionali;
- Frontend Performance Engineer;
- Product Architect esperto di CRM verticali;
- responsabile di una migrazione visuale sicura su software in produzione.

Devi riprogettare integralmente la UI e la UX di Ruffino Flow. Non devi
limitarti a cambiare colori, radius o card. Devi cambiare in modo coerente:

- sistema visivo;
- app shell e navigazione;
- gerarchia informativa;
- organizzazione delle pagine;
- densità e leggibilità;
- modalità di esplorazione dei record;
- tabelle, code, workbench e form;
- feedback, stati, motion e microinterazioni;
- esperienza desktop, tablet e mobile;
- rappresentazione di Tars;
- consistenza fra tutte le route.

Il risultato deve essere un CRM operativo contemporaneo, elegante, rapido,
distintivo e riconoscibile. Deve sembrare progettato da un team umano che
conosce il lavoro quotidiano di un’azienda di infissi. Non deve sembrare un
template SaaS, una landing page, una demo Dribbble o un assemblaggio casuale di
componenti shadcn.

Questo prompt autorizza:

- ricognizione del repository;
- progettazione;
- implementazione frontend;
- refactoring visuale strettamente necessario;
- test;
- screenshot e verifica nel browser;
- aggiornamento della documentazione UI;
- commit piccoli e leggibili su `feature/ui-v2-frame-flow`.

Questo prompt non autorizza:

- merge su `main`;
- deploy;
- push o apertura di PR, salvo autorizzazione separata;
- attivazione di flag in produzione;
- modifiche ai dati reali;
- modifiche alle regole di business;
- modifiche a contratti server, autorizzazioni, importi o state machine per
  comodità visuale;
- migrazioni storage o database;
- operazioni distruttive;
- utilizzo o esposizione di credenziali;
- chiamate OpenAI non necessarie alla funzione reale di Tars.

Lavora soltanto su `feature/ui-v2-frame-flow`. Non creare, cambiare, rebasare,
mergiare, eliminare o spostare branch/worktree senza autorizzazione esplicita
per quella specifica operazione. Considera ogni file preesistente, modificato o
untracked come proprietà dell’utente finché non ne hai stabilito la provenienza.

---

# 1. CLAUSOLA DI SOSTITUZIONE ESPLICITA

Questa direzione sostituisce integralmente, sul solo piano UI/UX:

- “Frame & Flow / Officina Digitale”;
- la palette giallo caldo + petrolio;
- le firme visuali Frame, Rail e Reveal intese come grammatica estetica;
- i token cromatici e le metafore visuali descritte nei precedenti dossier UI
  v2;
- i divieti estetici precedenti che impediscono l’uso controllato dei gradienti;
- ogni implementazione visuale già presente sul branch che dipenda dalla
  direzione rifiutata.

In particolare, considera superate come autorità estetica le decisioni in:

- `docs/design/ruffino-flow-ui-v2.md`;
- `docs/design/ruffino-flow-tokens.md`;
- `docs/design/ruffino-flow-motion.md`;
- `docs/design/ruffino-flow-anti-ai-slop.md`;
- le sezioni equivalenti di `handoff.md`.

Non cancellare alla cieca questi documenti: aggiornali, sostituiscili o marcali
come superseded in modo tracciabile. Mantieni le parti che descrivono fatti
tecnici, route, viewport, test, rollout e invarianti ancora validi.

Questa sostituzione non riguarda mai:

- comportamento del prodotto;
- dati e schema;
- route e deep link;
- redirect;
- query e mutation;
- permessi, ruoli e capability;
- feature flag fail-closed;
- contratti API/tRPC;
- terminologia di dominio;
- regole economiche;
- state machine delle commesse;
- sicurezza e isolamento per sede;
- governance, audit, budget e approvazioni di Tars.

Non creare un ibrido fra la vecchia direzione e la nuova. La UI v3 deve avere
una sola grammatica coerente. `FLAG_UI_V2` resta, se riusato, soltanto il nome
tecnico esterno del rollback globale: `OFF` = v1 stabile, `ON` = Modular Control
/ Borgogna Operativa. Nessuna regola CSS, label, commento, componente o
selector Frame & Flow è ammesso nella resa v3. Aggiorna la descrizione
dell’interruttore e migra o isola i selettori legacy, senza lasciare due skin v2
sovrapposte.

---

# 2. GERARCHIA DELLE FONTI

Prima di modificare qualsiasi file, distingui due gerarchie.

## 2.1 Verità funzionale

Per comportamento, sicurezza e contratti prevalgono, nell’ordine:

1. codice e test del branch corrente;
2. `AGENTS.md`;
3. `docs/source-of-truth-matrix.md`;
4. contratti server, schema, capability e procedure correnti;
5. `docs/tars/architettura-tars-v2.md` e runbook Tars aggiornati;
6. sezioni più recenti di `handoff.md`;
7. PRD e runbook correnti;
8. documenti storici solo come contesto.

Se trovi contraddizioni, registrale prima di procedere. Non ripristinare funzioni
rimosse e non rimuovere funzioni vive sulla base di un documento stantio.

Tars v2 esiste ed è attivo. Eventuali testi storici che dicono “Tars non
esiste” o “non c’è AI” sono stantii e non prevalgono sul codice, su `AGENTS.md`
o sull’architettura Tars v2.

Eccezione nota da verificare e registrare: per lo storage, il codice corrente,
gli script e le sezioni recenti di `handoff.md` prevalgono sul testo stantio del
runbook. `pnpm storage:check` è read-only; il probe di scrittura è separato e
richiede `pnpm storage:probe-write --scrivi`. Questo mandato UI non autorizza
né probe di scrittura né migrazioni storage.

## 2.2 Verità visuale

Per UI e UX prevalgono:

1. questo prompt;
2. la reference visiva allegata, interpretata secondo le regole di non-copia;
3. la palette “Borgogna Operativa” definita qui;
4. i nuovi dossier visuali prodotti e approvati durante il lavoro;
5. i pattern del codice corrente solo quando non contraddicono la nuova
   direzione.

La reference non autorizza a copiare layout, logo, avatar, contenuti, grafici,
icone, proporzioni esatte o trade dress.

---

# 3. CONTESTO DEL PRODOTTO

Ruffino Flow è il sistema operativo gestionale di Ruffino Group. È un prodotto
reale, con utenti, ruoli e dati di produzione. Gestisce:

- clienti e cantieri;
- opportunità, preventivi e contratti;
- rilievi e misure;
- commesse e relativo fascicolo;
- documenti e gate documentali;
- ordini ai fornitori e conferme PDF;
- Document Intelligence, OCR, evidenze e proposte;
- magazzino e ricezioni;
- planning e squadre;
- posa e verbali;
- pagamenti, economia, marginalità e Fatture in Cloud;
- email, WhatsApp read-only e chat aziendale;
- notifiche e Centro Azioni;
- ticket, reclami, garanzie e post-vendita;
- Tars v2, intelligenza operativa governata dell’azienda.

La UI deve servire persone che lavorano velocemente, spesso fra telefonate,
documenti, attività di cantiere e decisioni economiche. La bellezza deve
ridurre attrito e ambiguità, non aggiungere spazio vuoto o decorazione.

## 3.1 Stack da verificare, non assumere

La baseline attesa è:

- React 19;
- TypeScript;
- Vite;
- Wouter;
- tRPC 11 e React Query;
- Tailwind CSS 4;
- shadcn/Radix;
- Lucide;
- Framer Motion già presente;
- tema chiaro/scuro;
- route lazy-loaded.

Conferma tutto da `package.json`, configurazione e codice prima di decidere la
strategia. Non introdurre un nuovo framework visuale o una seconda libreria di
componenti soltanto per replicare la reference.

---

# 4. INVARIANTI NON NEGOZIABILI

Il redesign cambia come il CRM si vede e si usa. Non cambia cosa il CRM fa.

## 4.1 Stato delle commesse

Conferma nel codice la sequenza canonica, storicamente:

`preventivo → misure_esecutive → aggiornamento_contratto → fatture_pagamento
→ da_ordinare → produzione → ordini_ultimazione → attesa_posa →
finiture_saldo → interventi_regolazioni → archiviata`

Preserva:

- esattamente gli stati reali;
- transizioni soltanto secondo il contratto server;
- avanzamenti e rollback previsti;
- gate documentali;
- `force` limitato al gate documentale, mai alla sequenza;
- soft archive separato dallo stato operativo;
- sincronizzazione canonica fra Board e timeline;
- storico completato che non viene falsificato da un rollback.

La UI può rendere la sequenza più comprensibile, mai ricalcolarla o ampliarla.

## 4.2 Sedi, ruoli e autorizzazioni

Preserva:

- `sedeId` su ogni entità, query e mutation business;
- cross-sede indistinguibile da record inesistente: `NOT_FOUND`, mai
  informazioni enumerabili;
- capability effettive, policy, override, ownership e deleghe;
- omissione server-side dei dati non autorizzati;
- client-side hiding come sola difesa UX, mai come confine di sicurezza.

L’autorità capability lato server è distribuita fra
`server/authz/capabilities.ts`, `server/authz/enforcement.ts`, repository/policy
e router proprietario. `server/_core/permissions.ts` è un helper di
compatibilità, non il registro completo delle capability. La visibilità client
deve derivare dalle capability effettive di `permessi.mie` e dai flag; i ruoli
sono soltanto un fallback di caricamento, mai l’autorità finale.

Ruoli reali da verificare:

- direzione;
- amministrazione;
- commerciale;
- tecnico rilievi;
- squadra posa;
- post-vendita;
- ordini.

Un utente può avere più ruoli, override per sede e deleghe. Non costruire la UI
con un unico `if ruolo` mutuamente esclusivo. Ogni elemento visuale deve
riflettere la capability reale del principal corrente. Non mostrare CTA che
promettono operazioni che il server rifiuta.

Al cambio di sede attiva, login/logout o capability effettive:

- rimuovi, non limitarti a invalidare, i dati tenant/protetti dalla query cache
  prima di renderizzare il nuovo contesto;
- chiavi di cache e stato UI persistito che contengono label, ID, risultati di
  ricerca, draft o recenti devono includere almeno `userId + sedeId + contesto
autorizzativo`;
- rivalida lo stato persistito prima di mostrarlo;
- cancella lo stato quando il contesto cambia;
- non renderizzare nemmeno transitoriamente nomi, importi o link della sede
  precedente.

## 4.3 Economia e privacy degli importi

Preserva:

- `/pagamenti` protetta da `pagamento.read`;
- nessun importo non autorizzato nel DOM, nella cache, nei tooltip, nei grafici,
  negli export, nelle label accessibili o nelle risposte Tars;
- `daSaldare` come solo segnale binario dove previsto;
- nessun accesso del commerciale agli acconti salvo override esplicito e
  auditato;
- `importoIncassato` derivato da `pagamenti[]`, mai input liberamente
  aggiornabile;
- helper condivisi in `client/src/lib/euro.ts`;
- FiC come fonte autorevole nei casi stabiliti;
- distinzione fra competenza e cassa;
- nessun calcolo economico autorevole duplicato nel client.

Un grafico o un riepilogo non deve far trapelare indirettamente dati economici
tramite scale, proporzioni, tooltip o testi nascosti.

La modellazione dei payload economici resta server-side in ogni policy mode.
Invalidare una query non è sufficiente se i dati protetti restano leggibili
nella cache o nello stato persistito.

## 4.4 Integrazioni, file e comunicazioni

Preserva:

- Google Calendar read-only dove previsto;
- WhatsApp read-only dove previsto;
- nessun composer WhatsApp se l’invio non esiste;
- nessun invio email inventato;
- contenuti email, WhatsApp e PDF come dati non attendibili;
- originali documentali immutabili;
- checksum, evidenze, versione e tracciabilità;
- fallback `dataBase64` per record legacy;
- file nuovi dietro `storageKey`, senza nuovi blob base64 nel JSONB;
- nessuna variazione critica applicata automaticamente dalla Document
  Intelligence.

## 4.5 Tars v2

Preserva:

- kill switch fail-closed;
- Tars spento che non modifica il CRM;
- nessuna chiamata al modello aprendo Dashboard, command palette o `/tars`;
- nessuna chiamata mentre l’utente digita;
- nessuna chiave provider nel client;
- azioni dirette idempotenti, attribuite e reversibili;
- proposte materiali inerti fino all’approvazione umana;
- modello impossibilitato ad approvare se stesso;
- capability del principal corrente;
- fonti, freschezza, evidenze e omissioni dichiarate;
- cost governor, budget ledger, circuit breaker e audit intatti;
- degrado controllato quando provider, flag o budget non sono disponibili.

Non mostrare chain-of-thought. Mostra fatti usati, fonti, sintesi del motivo,
azioni eseguite, proposte, approvazioni e audit trail.

## 4.6 Route Produzione

La pagina UI “Produzione” è stata rimossa intenzionalmente.

- `/produzione` e `/produzione/*` restano redirect a `/kanban`;
- nessuna voce “Produzione” nel menu;
- nessuna nuova pagina o card che la reintroduca;
- dominio backend produzione e stato `produzione` restano intatti;
- conserva o aggiungi un test strutturale contro il ritorno accidentale.

---

# 5. OBIETTIVO DI ESPERIENZA

Ruffino Flow v3 deve comunicare:

- chiarezza;
- controllo;
- affidabilità;
- velocità;
- precisione;
- modernità;
- energia controllata;
- cura;
- intelligenza operativa.

Il “wow” deve derivare da:

- gerarchia immediata;
- modularità ben calibrata;
- grandi superfici pulite alternate a zone dense;
- qualità di tipografia, spaziatura e allineamenti;
- selezione cromatica intenzionale;
- gradienti focali eleganti;
- grafici leggibili;
- transizioni corte e coerenti;
- azioni sempre nel punto giusto;
- continuità fra desktop e mobile;
- comprensione del dominio.

Non deve derivare da:

- effetti gratuiti;
- animazioni continue;
- glassmorphism generalizzato;
- sfondi aurora;
- sfere, blob o orb;
- card annidate senza necessità;
- metriche decorative;
- spazio vuoto che riduce la produttività;
- elementi 3D della reference;
- estetica “AI” viola/ciano generica;
- gigantismo da landing page.

---

# 6. DIREZIONE CREATIVA: “MODULAR CONTROL”

## 6.1 Principi estratti dalla reference

Adotta, in forma originale:

- applicazione percepita come un unico ambiente coeso;
- canvas esterno freddo e calmo;
- grande workspace chiaro con radius generoso su desktop;
- navigazione compatta, ordinata e silenziosa;
- griglia modulare asimmetrica, non una sequenza di card identiche;
- gerarchia ottenuta con dimensione, contrasto e ritmo;
- superfici quasi bianche con bordi e ombre minime;
- un pannello scuro o in gradiente come ancora focale;
- controlli pill e pulsanti circolari solo dove semanticamente appropriati;
- numeri importanti grandi e tabulari;
- grafici minimali con serie neutre e una serie protagonista;
- tooltip scuri, compatti e molto leggibili;
- icone leggere e coerenti;
- alternanza fra respiro e densità.

## 6.2 Traduzione per un CRM operativo

La reference è più ariosa di quanto possa permettersi un CRM reale. Adattala:

- shell e dashboard possono respirare;
- tabelle, code, Board, planning, magazzino e documenti devono restare densi;
- usa gap standard di 16px e padding modulo di 20–24px;
- riserva 28–32px ai contenitori di pagina e alle aree focali;
- non trasformare ogni blocco in una card;
- usa superfici continue e separatori quando una card peggiorerebbe la lettura;
- sui workbench privilegia larghezza utile, sticky toolbar e scroll locale;
- su mobile elimina il canvas esterno e passa a un workspace full-bleed.

## 6.3 Divieto di copia

Non copiare dalla reference:

- logo;
- palette;
- avatar o personaggi 3D;
- testi o metriche;
- struttura esatta della sidebar;
- posizione esatta dei moduli;
- grafici identici;
- silhouette complessiva;
- icone proprietarie;
- proporzioni pixel-perfect;
- call to action o pattern da prodotto finanziario.

Il risultato deve avere la stessa qualità percepita, non la stessa identità.

## 6.4 Soglia minima di trasformazione

La migrazione non è completata da un cambio token o da nuovi wrapper. Prima di
scrivere le golden screen, crea una matrice con almeno otto trasformazioni
strutturali verificabili:

1. shell;
2. navigazione;
3. header e context bar;
4. dashboard;
5. lista/queue;
6. Record 360;
7. workbench;
8. inbox;
9. form mobile, se necessaria per raggiungere otto aree reali.

Per ogni trasformazione indica: componente legacy, componente v3, route
coinvolte, problema UX risolto, comportamento desktop/mobile e screenshot
prima/dopo. Un semplice token swap, override CSS pagina-per-pagina o wrapper
cosmetico non conta come trasformazione.

---

# 7. PALETTE “BORGOGNA OPERATIVA”

La palette seguente è vincolante come punto di partenza. Puoi derivare scale in
OKLCH per hover, pressed e disabled, ma non cambiarne la direzione senza
approvazione.

## 7.1 Light mode

| Ruolo            |    Valore | Uso                                       |
| ---------------- | --------: | ----------------------------------------- |
| chrome esterno   | `#D8D5DC` | backdrop freddo visibile su desktop largo |
| canvas           | `#F7F5F6` | sfondo interno applicazione               |
| surface          | `#FFFFFF` | workspace e moduli                        |
| surface sunken   | `#F2EEF0` | filtri, pozzi, aree secondarie            |
| surface raised   | `#FFFFFF` | popover, dialog, menu                     |
| ink              | `#20171B` | testo principale                          |
| testo secondario | `#71656A` | descrizioni e metadata                    |
| border subtle    | `#E6DDE0` | separatori decorativi                     |
| border control   | `#8A7A82` | confini di controllo, ≥3:1                |
| brand borgogna   | `#8B1E3F` | CTA, selezione, serie primaria            |
| on-brand         | `#FFFFFF` | testo su brand, contrasto 8,92:1          |
| brand soft       | `#F7E5EB` | selezioni e badge soft                    |
| brand soft ink   | `#6E1733` | testo su brand soft                       |
| mora secondaria  | `#5B468E` | seconda serie, focus speciali             |
| pannello scuro   | `#241821` | ancore focali e Tars                      |
| success          | `#237353` | esiti positivi reali                      |
| warning          | `#A84B32` | attenzione e scadenze                     |
| danger           | `#B4233D` | errore e distruttivo                      |
| info             | `#3B5FA6` | informazione e stato neutro attivo        |

## 7.2 Dark mode

| Ruolo            |    Valore | Uso                                  |
| ---------------- | --------: | ------------------------------------ |
| chrome esterno   | `#0F0D12` | backdrop desktop                     |
| canvas           | `#151216` | sfondo applicazione                  |
| surface          | `#201B20` | workspace e moduli                   |
| surface sunken   | `#171217` | aree incassate                       |
| surface raised   | `#2A2228` | popover e dialog                     |
| testo principale | `#FCF8F9` | contrasto 16,09:1 su surface         |
| testo secondario | `#BDAFB5` | contrasto 8,04:1 su surface          |
| border subtle    | `#473B42` | separatori                           |
| border control   | `#7B6B73` | confini ≥3:1 sulle surface operative |
| brand            | `#F09AB2` | selezione e azioni focali            |
| on-brand         | `#32101B` | contrasto 8,14:1                     |
| brand soft       | `#451A2A` | badge e selezioni soft               |
| brand soft ink   | `#FFB8CB` | contrasto 9,04:1                     |
| mora secondaria  | `#B6A6E8` | serie secondaria e focus             |
| on-secondary     | `#231A3A` | testo su mora                        |
| success          | `#70C9A5` | esiti positivi                       |
| warning          | `#F49A7A` | attenzione                           |
| danger           | `#FF9BAB` | errore                               |
| info             | `#AFC2FF` | informazione                         |

Il dark mode va progettato, non ottenuto invertendo il light. Ombre quasi
assenti; profondità affidata a surface, bordo e contrasto.

## 7.3 Gradienti

Gradiente principale light:

```css
linear-gradient(135deg, #3A1725 0%, #6C2448 56%, #884B79 100%)
```

Gradiente principale dark:

```css
linear-gradient(135deg, #2A1721 0%, #522039 56%, #6B4163 100%)
```

Tutti gli stop supportano testo bianco almeno AA. Regole:

- usa il gradiente come firma focalizzata, non come riempimento universale;
- una sola area dominante in gradiente per viewport;
- ammesso per hero operativo, pannello Tars, selezione di alto livello o KPI
  veramente centrale;
- ammesso in grafici solo come fill di una serie protagonista;
- vietato dietro testo lungo, tabelle e form;
- vietato per danger, warning, success o stato macchina;
- vietato sui pulsanti secondari;
- vietato animare continuamente gli stop;
- vietato applicarlo a ogni card;
- vietati gradient text e bordi arcobaleno;
- area complessiva in gradiente indicativamente inferiore al 12–15% della
  schermata desktop.

## 7.4 Colori e stati

Non usare mai il solo colore. Ogni stato deve avere almeno due fra:

- testo;
- icona;
- posizione;
- forma;
- descrizione accessibile;
- colore secondario.

Non creare undici chip arcobaleno. Raggruppa gli stati in famiglie cromatiche
senza rinominare gli stati reali. Verifica contrasto di testo, controllo e focus
con script ripetibile prima di consolidare i token.

---

# 8. DESIGN SYSTEM

## 8.1 Token

Adotta tre livelli:

1. primitive: colore, spaziatura, radius, ombre, durata, easing;
2. semantic: canvas, surface, text, border, brand, state, focus, selected;
3. component: shell, sidebar, context bar, button, input, table, panel, dialog,
   tooltip, status, chart, Tars.

Integra i token con Tailwind 4 nel meccanismo realmente presente. Nessun
componente applicativo deve dipendere da hex locali. Conserva nomi semantici
esistenti quando riduce il rischio, ma sostituisci i valori e le varianti della
direzione rifiutata.

## 8.2 Tipografia

Mantieni Plus Jakarta Sans come font di prodotto, salvo evidenza tecnica
approvata che imponga altro. Usa JetBrains Mono soltanto per codici e valori
tecnici.

Direzione:

- H1 desktop 28–34px, mobile 26–30px;
- H2 22–26px;
- H3 17–20px;
- body desktop 14–15px con line-height 20–22px;
- body mobile e input almeno 16px;
- label 13–14px;
- microcopy mai sotto 12px;
- KPI focali 40–64px solo quando meritano quella gerarchia;
- `tabular-nums` per euro, date, misure, codici, KPI e colonne numeriche.

Non usare titoli da landing page dentro il gestionale.

## 8.3 Spaziatura e griglia

- base grid: 4px;
- scala raccomandata: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64;
- gap standard moduli: 16px;
- padding modulo: 20–24px;
- padding pagina: 24–32px desktop, 16px mobile;
- toolbar dense: 8–12px;
- usa CSS Grid, flex e container query dove aiutano davvero;
- nessuna pagina introduce scroll orizzontale globale.

## 8.4 Radius

Costruisci una famiglia coerente:

- controlli: 10–12px;
- card e pannelli: 18–22px;
- dialog e sheet: 22–26px;
- shell desktop: 28–32px;
- pill soltanto per chip, segmenti, nav compatta e azioni appropriate;
- pulsanti circolari soltanto per icone note e con accessible name.

Non applicare lo stesso radius a tutto.

## 8.5 Ombre ed elevazione

La reference usa ombre quasi impercettibili. Definisci quattro livelli:

- flat;
- raised;
- floating;
- modal.

Prima usa differenza di surface e bordo; poi una shadow corta, morbida e a
bassa opacità. Vietate ombre profonde su ogni card.

## 8.6 Icone

- Lucide come famiglia primaria;
- stroke coerente 1,75–2;
- taglie 16, 18, 20 e 24;
- nessuna emoji come icona;
- icone convenzionali, non illustrazioni astratte;
- tooltip e `aria-label` sui pulsanti solo icona;
- stato non comunicato soltanto cambiando colore dell’icona.

---

# 9. GLOBAL APP SHELL

## 9.1 Desktop

La shell deve reinterpretare la reference senza copiarla:

- canvas esterno freddo;
- workspace bianco con margine 16–24px e radius 28–32px;
- fra 1200 e 1599px usa quasi tutta la larghezza disponibile;
- da 1600px valuta `max-width` 1600–1760px centrato, lasciando visibile il
  chrome esterno;
- sidebar calma, larga circa 224–248px, collassabile a modalità iconica;
- logo, sede e ruolo leggibili ma non dominanti;
- gruppi di navigazione legati al lavoro reale;
- top context bar con breadcrumb, titolo contestuale, ricerca/comando,
  notifiche, Centro Azioni e profilo;
- area contenuto `min-w-0`, con densità adattiva;
- shell senza card decorative aggiuntive.

La sidebar deve recedere visivamente rispetto al contenuto, ma non diventare
ambigua. Mantieni collapse, sede switcher, visibilità per ruolo, stato attivo e
deep link.

## 9.2 Navigazione

Organizza visivamente le destinazioni intorno ai lavori reali, senza cambiare
le route:

- Oggi e operatività;
- Clienti e commesse;
- Cantiere e pianificazione;
- Ordini, fornitori e magazzino;
- Economia, se autorizzata;
- Comunicazioni;
- Post-vendita;
- Tars, sotto flag;
- Amministrazione e impostazioni, sotto ruolo/capability.

Non nascondere una funzione soltanto perché non entra nel layout: usa gruppi,
collapse e progressive disclosure. Browser back/forward, deep link e stato
selezionato devono restare prevedibili.

## 9.3 Command palette

`⌘K` / `Ctrl+K` deve offrire:

- recenti;
- navigazione;
- crea;
- azioni pagina;
- ricerca clienti e commesse;
- passaggio esplicito “Chiedi a Tars”.

Filtra server-side o capability-aware. Non chiamare il modello durante la
digitazione. La ricerca normale e Tars devono essere due modalità chiaramente
distinte.

## 9.4 Regimi responsive della shell

Definisci tre regimi espliciti:

### 0–767px — mobile

- niente canvas esterno o shell flottante;
- contenuto full-bleed;
- top bar compatta con contesto e back prevedibile;
- bottom navigation capability-aware con massimo cinque destinazioni;
- resto della navigazione in drawer accessibile;
- azione primaria raggiungibile con una mano;
- safe area rispettata;
- nessun hover necessario;
- touch target 44×44px, 48px per azioni critiche.

### 768–1199px — tablet/compatto

- sidebar iconica oppure drawer, mai colonna compressa illeggibile;
- niente tri-pane;
- inspector in sheet;
- ricerca ridotta a trigger prima di sacrificare titolo o azioni;
- breadcrumb collassato progressivamente;
- action dock resta raggiungibile senza sovrapporsi al contenuto.

### ≥1200px — desktop

- sidebar estesa;
- workspace completo;
- master-detail e tri-pane soltanto quando la larghezza reale lo consente;
- inspector laterale senza comprimere la colonna principale sotto la soglia
  leggibile.

Ordine di collapse obbligatorio: metadata secondari → breadcrumb intermedi →
label di azioni già riconoscibili → ricerca come trigger → sidebar iconica.
Titolo, contesto attivo, back e azione primaria non devono scomparire.

---

# 10. ARCHETIPI DI PAGINA

Ogni route deve appartenere a un archetipo. Non applicare la dashboard modulare
indistintamente a tutto.

## 10.1 Dashboard operativa per ruolo

Obiettivo: mostrare cosa richiede attenzione oggi.

Struttura:

- saluto e contesto ridotti;
- modulo dominante “Oggi” o “Priorità”;
- coda di eccezioni e blocchi;
- agenda e attività imminenti;
- pochi KPI realmente azionabili;
- una sola ancora visiva scura o in gradiente;
- contenuti diversi per ruolo e capability;
- nessuna fuga di importi.

Non replicare quattro KPI identici. Ogni dato deve rispondere a una domanda
operativa e portare a un’azione o a un approfondimento.

## 10.2 Lista e queue data-dense

Per clienti, commesse, pagamenti, ticket, garanzie, notifiche:

- toolbar unica con ricerca, filtri e viste;
- densità desktop controllata;
- colonne stabili e numeri tabulari;
- selezione e bulk action soltanto dove sicure;
- azioni riga discrete;
- stato con testo e colore;
- empty, loading, error e permission state specifici;
- su mobile card-riassunto progettate, non tabella rimpicciolita;
- query state nell’URL quando il pattern esiste già.

## 10.3 Record 360

Per Commessa e Cliente:

- header identitario compatto;
- stato e CTA contestuale;
- riepilogo leggibile senza “card dentro card”;
- documenti, timeline, economia, comunicazioni, collegamenti ed evidenze;
- inspector o drawer contestuale per dettagli secondari;
- sticky action bar solo quando utile;
- ritorno e posizione preservati;
- su mobile priorità P0/P1/P2 e disclosure progressiva.

CommessaDetail è una superficie critica e molto grande: modularizzala solo dove
migliora comprensione, testabilità e prestazioni. Non cambiare i contratti per
rendere più semplice il layout.

## 10.4 Workbench operativo

Per Kanban, Planning, Magazzino, Fornitori e Document Intelligence:

- larghezza piena;
- toolbar sticky;
- pannelli ridimensionabili o inspector quando appropriato;
- scroll locale governato;
- drag con alternativa da tastiera/menu;
- informazioni essenziali visibili senza aprire dieci modali;
- niente contenitore-card intorno all’intero workbench;
- mobile con vista dedicata, agenda o lista per fase.

## 10.5 Queue / Inbox

Per Email, WhatsApp, Chat, Centro Azioni e Notifiche:

- master-detail desktop;
- tri-pane soltanto quando lo spazio lo consente;
- stato di selezione persistente;
- reader focalizzato su mobile;
- contesto cliente/commessa collegato;
- unread e priorità leggibili;
- azioni contestuali;
- WhatsApp senza composer se resta read-only.

## 10.6 Form / Guided flow

Per Rilievo, Verbale, Preventivatori e creazioni:

- larghezza controllata;
- sezioni progressive;
- label sempre visibili;
- validazione vicino al campo;
- error summary quando necessario;
- stato di salvataggio esplicito;
- protezione da perdita modifiche;
- riepilogo prima di azioni irreversibili;
- barra azioni sticky su mobile;
- campi numerici, misure ed euro formattati con helper condivisi.

---

# 11. PAGINE E FLUSSI DA RIPROGETTARE

Migra tutte le route reali, non soltanto le golden screens.

## 11.1 Dashboard

Costruisci una dashboard componibile che adatti priorità e moduli alle
capability effettive del principal. Considera almeno i bisogni di:

- direzione;
- amministrazione;
- commerciale;
- tecnico rilievi;
- ordini;
- squadra posa;
- post-vendita.

La struttura resta familiare, ma priorità, dati e CTA cambiano. Non creare sette
dashboard mutuamente esclusive basate su un singolo ruolo: gestisci principal
multi-ruolo, override e deleghe. Chi non ha capability economiche non deve
ricevere né inferire importi.

## 11.2 Clienti e commesse

- liste dense e filtrabili;
- ricerca immediata;
- azioni primarie chiare;
- ragione sociale rispettata per aziende, condomini ed enti;
- record 360 coerenti;
- timeline e stato leggibili;
- documenti e comunicazioni vicini al contesto decisionale;
- mobile con riepilogo prioritario e azioni raggiungibili.

## 11.3 Board e timeline

- preserva la state machine;
- mostra blocchi e gate reali;
- nessuna progress bar che inventi percentuali;
- drag con alternativa accessibile;
- rollback comprensibile;
- storico non riscritto visualmente;
- mobile come lista per fase con “Sposta in…” controllato.

## 11.4 Rilievi, planning, squadre e verbali

Questi flussi sono ad alta priorità mobile:

- touch target ampi;
- input da campo;
- sezioni chiare;
- salvataggio e sincronizzazione visibili;
- errori recuperabili;
- azione primaria sticky;
- agenda oggi/domani;
- nessuna interazione dipendente solo dal drag o dall’hover.

## 11.5 Fornitori, ordini, magazzino e DI

- workbench denso;
- originale PDF e dato estratto chiaramente distinti;
- evidenze e confidence leggibili;
- proposte sempre inerti fino alla conferma;
- differenze e anomalie più importanti della decorazione;
- timeline ordine/ricezione;
- stati di upload, analisi, errore, retry e integrazione spenta.

## 11.6 Economia, pagamenti e marginalità

- capability prima del layout;
- competenza e cassa distinte;
- provenienza FiC/manuale dichiarata;
- numeri tabulari;
- grafici soltanto se rispondono a una domanda reale;
- tooltip accessibili;
- nessun dato protetto montato o cachato per utenti non autorizzati;
- mobile con riepilogo prioritario, non tabelle illeggibili.

## 11.7 Comunicazioni

- Email master-detail a desktop largo;
- WhatsApp read-only senza invio inventato;
- chat aziendale distinta;
- threading, unread e contesto record;
- contenuto esterno trattato come non attendibile;
- azioni disponibili soltanto se esistono nel dominio.

## 11.8 Ticket, reclami, garanzie e archivio

- code per priorità e SLA reali;
- responsabilità e prossima azione;
- allegati e cronologia;
- stati vuoto/chiuso/scaduto distinti;
- archivio consultabile senza confonderlo con lo stato operativo.

## 11.9 Impostazioni e integrazioni

- hub chiaro;
- sezioni per ruolo;
- stato connessione, ultimo sync, errori e azioni;
- segreti mai mostrati;
- operazioni ad alto rischio con conferma e conseguenze esplicite;
- storage e migrazioni mai eseguiti dalla sola UI senza i gate operativi.

---

# 12. TARS — INTELLIGENZA OPERATIVA, NON CHATBOT

Tars deve essere riconoscibile come parte di Ruffino Flow, con una presenza
visiva leggermente più focalizzata:

- pannello scuro o gradiente Borgogna Operativa;
- testo chiaro ad alto contrasto;
- fonti, evidenze e freshness vicine alla risposta;
- nessun robot, avatar, orb o sparkles;
- nessuna bolla flottante;
- nessuna pagina dominata da un input chat vuoto.

Accessi coerenti:

1. command palette, tramite passaggio esplicito;
2. “Chiedi a Tars” nel contesto appropriato;
3. pannello contestuale su commessa, documento o caso;
4. pagina `/tars`.

La pagina `/tars` deve privilegiare:

- briefing;
- segnali;
- priorità;
- evidenze;
- proposte da revisionare;
- attività eseguite e Undo;
- limiti, omissioni e degradazione;
- cronologia e audit;
- chat come strumento secondario.

Vincola la UI alle procedure e ai campi realmente esposti. La cronologia è
quella delle `conversazioni`/`turni` del principal; l’audit visualizzabile è
l’evidenza e l’esito associati al turno o all’azione. I costi globali usano
`tars.costi` soltanto per la direzione. Mostra provider, budget o circuit
breaker come stati distinti solo se il payload tipizzato li distingue;
altrimenti usa la ragione degradata generica restituita dal server.

Questo mandato UI non autorizza a creare un audit feed globale, un monitoring
panel, streaming simulato o nuovi endpoint Tars.

Rendi distinti:

- risposta informativa;
- evidenza;
- omissione per permessi;
- azione reversibile eseguita;
- proposta in attesa;
- proposta approvata o rifiutata;
- provider spento;
- budget esaurito;
- circuit breaker;
- analisi fallita;
- dato non fresco.

Non promettere streaming se il server non lo offre. Non simulare attività o
progressi che non esistono.

---

# 13. GRAFICI E DATA VISUALIZATION

Riprendi la disciplina della reference:

- griglie pallide;
- baseline neutra;
- una serie protagonista borgogna;
- seconda serie mora soltanto quando serve un confronto;
- barre e linee con terminali arrotondati;
- tooltip scuro compatto;
- label essenziali;
- legenda vicina al dato;
- zero donut o gauge decorativi;
- niente arcobaleno;
- nessuna metrica inventata;
- nessun grafico senza una domanda operativa.

Ogni grafico deve:

- avere alternativa accessibile;
- non dipendere dal colore;
- rispettare capability e privacy;
- funzionare a 200% zoom;
- mantenere tooltip raggiungibili anche da tastiera/touch;
- ridurre tick e annotazioni su mobile;
- evitare animazioni che ritardano la lettura.

---

# 14. COMPONENTI

Definisci o consolida, senza duplicazioni casuali:

- AppShell;
- SidebarNav;
- ContextBar;
- PageHeader;
- PageContainer;
- CommandPalette;
- ActionDock;
- ModularPanel;
- FocalPanel;
- KPIBlock;
- FilterBar;
- DataTable;
- MobileRecordCard;
- StatusBadge;
- StateTimeline;
- EmptyState;
- ErrorState;
- Skeleton sagomato;
- RecordHeader;
- ContextInspector;
- StickyActionBar;
- TarsBriefing;
- EvidenceBlock;
- ProposalCard;
- UndoToast;
- NotificationPreview.

Per ogni componente specifica:

- scopo;
- varianti ammesse;
- stato hover/focus/active/disabled/loading;
- comportamento mobile;
- accessible name e tastiera;
- token consumati;
- cosa non deve contenere.

Rendi questi contratti un artefatto revisionabile del dossier. Documenta almeno
`AppShell`, `DataTable`, `StatusBadge`, `ContextInspector`, `TarsBriefing` e
`StickyActionBar` con varianti finite, token, stati, breakpoint, semantica da
tastiera ed esclusioni.

Riusa shadcn/Radix come primitive accessibili. Non usare la loro resa di
default come direzione estetica finale.

---

# 15. TABELLE, LISTE E FILTRI

Desktop:

- header sticky quando utile;
- righe 36–44px secondo densità;
- padding coerente;
- numeri tabulari;
- colonna azioni discreta;
- focus riga visibile;
- ordinamento e filtri leggibili;
- colonne opzionali solo se persistenti e comprensibili;
- niente hover come unico accesso all’azione.

Mobile:

- usa card sintetiche o viste a elenco progettate;
- mostra dati P0 subito, P1 in espansione, P2 nel dettaglio;
- nessuno scroll globale;
- scroll locale solo quando il contenuto non può essere trasformato senza
  perdita;
- azioni critiche sempre raggiungibili.

I filtri devono distinguere applicato, disponibile e resettato. Il reset non
deve cancellare selezioni o dati al di fuori del filtro.

---

# 16. FORM E FEEDBACK

- label persistenti, mai placeholder-only;
- helper text vicino al campo;
- errore vicino al campo e summary quando multiplo;
- focus sul primo errore senza perdere contesto;
- pending state che impedisce doppio submit;
- successo soltanto dopo conferma server;
- toast con azione quando serve;
- Undo per operazioni reversibili;
- confirm dialog per operazioni distruttive;
- testo della conferma specifico, non “Sei sicuro?” generico;
- protezione da uscita con modifiche non salvate;
- input mobile almeno 16px;
- autocomplete e tastiere semantiche quando pertinenti.

---

# 17. STATI DEL SISTEMA

Ogni pagina e componente dati deve progettare:

- primo caricamento;
- refetch discreto;
- empty reale;
- zero come valore valido;
- errore totale con retry;
- errore parziale;
- offline o rete instabile quando rilevabile;
- stale data con ultimo aggiornamento;
- permission denied;
- not found;
- omissione per capability;
- feature flag spento;
- integrazione scollegata;
- provider degradato;
- upload in corso;
- elaborazione in corso;
- successo;
- rollback o Undo;
- conflitto e dato aggiornato altrove.

Non riutilizzare lo stesso empty state per significati diversi. Non rianimare
la pagina come primo load durante un refetch.

---

# 18. MOTION SYSTEM

Il motion deve spiegare relazioni e stato.

Durate indicative:

- feedback immediato: 80–120ms;
- componente: 150–220ms;
- drawer/dialog: 200–280ms;
- route: 180–240ms;
- massimo ordinario: 320ms.

Usa:

- crossfade minimo fra route;
- origine spaziale per drawer e inspector;
- scale 0.98→1 per dialog;
- highlight breve dopo un aggiornamento;
- movimento ridotto per cambi di stato;
- skeleton senza shimmer aggressivo.

Non animare:

- width/height quando causa layout thrashing;
- numeri economici in modo spettacolare;
- gradienti in loop;
- tutte le card all’ingresso;
- hover lift su ogni contenitore;
- progressi non reali.

Con `prefers-reduced-motion`, mantieni soltanto feedback essenziali e mostra
direttamente lo stato finale.

---

# 19. RESPONSIVE DESIGN

Verifica almeno:

- 1440×900;
- 1280×800;
- 1024×768;
- 768×1024;
- 390×844;
- 360×800;
- zoom browser 200%.

Regole:

- mobile non è desktop rimpicciolito;
- nessuno scroll orizzontale globale;
- `min-w-0` su figli flex/grid;
- tabelle e workbench con strategia dedicata;
- no breakpoint basati soltanto sul device;
- container query per moduli riusabili quando migliorano la resa;
- azioni sticky non coprono contenuti o safe area;
- dialog complessi diventano sheet/full-screen su mobile;
- header e navigazione non consumano metà viewport;
- tastiera mobile non nasconde il campo attivo o il submit.

---

# 20. ACCESSIBILITÀ — WCAG 2.2 AA

Requisiti minimi:

- contrasto testo normale ≥4,5:1;
- testo grande ≥3:1;
- confini e focus essenziali ≥3:1;
- focus visibile e non oscurato;
- navigazione completa da tastiera;
- ordine focus coerente;
- nessun keyboard trap;
- skip link e landmark semantici;
- heading hierarchy corretta;
- accessible name per controlli;
- tooltip non indispensabili alla comprensione;
- errori identificati testualmente;
- stato non comunicato solo dal colore;
- target prodotto 44×44px, 48px per azioni critiche mobile;
- alternative al drag e ai gesture;
- reflow e zoom 200%;
- annunci `aria-live` soltanto per cambi significativi;
- `prefers-reduced-motion` rispettato;
- focus ripristinato dopo chiusura dialog/sheet;
- icone decorative nascoste agli screen reader.

Per ogni archetipo registra un protocollo ripetibile:

1. axe automatizzato sul viewport desktop e mobile;
2. walkthrough completo solo tastiera;
3. report contrasto dei token e delle coppie realmente usate;
4. zoom/reflow al 200%;
5. `prefers-reduced-motion`;
6. focus non oscurato da header, dock, sheet o tastiera mobile;
7. comportamento screen reader dei controlli critici.

Registra esiti e issue. Non dichiarare conformità WCAG dell’intero prodotto
oltre la superficie effettivamente verificata.

---

# 21. PERFORMANCE

- conserva lazy loading delle route;
- non aumentare il bundle per effetti sostituibili con CSS;
- riusa Framer Motion solo dove già giustificato;
- niente nuove librerie di animazione senza prova di necessità;
- virtualizza liste grandi quando i dati lo richiedono;
- evita rerender di tabelle e grafici;
- riserva spazio per evitare CLS;
- skeleton con silhouette reale;
- immagini e PDF preview caricati on demand;
- nessuna chiamata al modello o integrazione durante la digitazione;
- misurare build e chunk prima/dopo;
- non nascondere regressioni dietro loading artificiale.

---

# 22. MICROCOPY

Tutta la UI è in italiano.

Stile:

- diretto;
- concreto;
- professionale;
- umano;
- legato al dominio;
- privo di gergo SaaS e slogan.

Usa verbi specifici: “Apri commessa”, “Collega fattura”, “Conferma proposta”,
“Sposta in attesa posa”. Evita “Continua”, “Gestisci”, “Scopri”, “Sblocca la
potenza”, “AI-powered” e testi generici quando esiste un’azione precisa.

Errori e conferme devono spiegare:

- cosa è successo;
- cosa non è cambiato;
- cosa può fare l’utente;
- se l’azione è reversibile.

---

# 23. PROCESSO DI IMPLEMENTAZIONE

## Fase 0 — Sicurezza e verità

1. Leggi integralmente `AGENTS.md`, `handoff.md` e le sezioni PRD coinvolte.
2. Controlla `git status`, branch e modifiche non proprie.
3. Verifica stack, flag, route, ruoli e test.
4. Registra contraddizioni documentali.
5. Conferma che Tars v2 è vivo e usa le fonti corrette.
6. Non sovrascrivere modifiche dell’utente.

Baseline, mockup, screenshot e test visuali devono usare ambiente locale e
fixture sanitizzate. Nessun nome, contatto, importo, PDF, email, messaggio o dato
di produzione entra in documenti, screenshot o commit. Se una verifica
read-only sulla produzione fosse autorizzata separatamente, oscura i dati e non
persistere l’immagine.

## Fase 1 — Ricognizione UI

Mappa:

- route e archetipi;
- shell e navigazione;
- primitive ad alto impatto;
- colori hardcoded e token;
- varianti componenti;
- pagine molto grandi;
- loading/empty/error;
- responsive corrente;
- keyboard path;
- dati protetti;
- feature flag;
- test visuali e strutturali esistenti.

Genera e conserva due matrici:

1. route manifest derivato da `client/src/App.tsx`: path, pagina/redirect,
   lazy target, UX guard client, autorità server, flag, capability, trattamento
   mobile e presenza in navigazione;
2. route coverage: route, archetipo, stato `migrata` / `esclusa con motivazione`
   / `redirect`, test ed evidenza screenshot.

Produci screenshot baseline a 1440×900 e 390×844 delle golden screens.

## Fase 2 — Dossier e checkpoint visuale obbligatorio

Prima dell’implementazione estesa, produci:

- `reference-extraction.md`, che renda durevole la lettura della reference con
  6–8 principi ammessi e 6–8 elementi vietati, senza incorporare dati o asset
  proprietari;
- moodboard tradotto dalla reference;
- token light/dark;
- shell desktop/mobile;
- component inventory;
- wireframe ad alta fedeltà di Dashboard, Commessa, Board, Tars e Rilievo;
- mappa route→archetipo;
- piano di migrazione;
- esempi di loading, empty, error e permission state.

Mostra il risultato nel browser con dati fixture chiaramente non produttivi. Il
checkpoint è approvabile soltanto se include almeno:

1. Dashboard di un principal senza capability economiche;
2. Commessa 360;
3. Kanban;
4. Tars in stato degradato;
5. Rilievo a 390px.

Per ciascuna mostra light/dark dove applicabile, uno stato fra
loading/empty/error/permission e una nota sul delta strutturale rispetto alla
UI precedente. Fermati una sola volta e chiedi approvazione sulla direzione
visuale complessiva. Dopo l’approvazione, procedi fino al completamento senza
domande ripetitive, salvo una decisione che cambierebbe comportamento o
autorizzazioni.

## Fase 3 — Fondazioni

Implementa nell’ordine:

1. token;
2. theme light/dark;
3. primitive;
4. shell;
5. navigazione;
6. command palette;
7. responsive scaffolding;
8. stati condivisi;
9. chart theme;
10. motion tokens.

Mantieni il rollback tramite flag. Flag OFF deve lasciare il comportamento
funzionale invariato.

## Fase 4 — Golden screens

Implementa e verifica:

1. Dashboard per ruolo;
2. Commessa 360;
3. Kanban;
4. Tars;
5. Rilievo e Verbale mobile;
6. Fornitori/Document Intelligence.

Usa le golden screens per correggere il sistema, non per creare eccezioni
pagina-specifiche.

## Fase 5 — Migrazione completa

Migra per archetipi:

1. liste e record;
2. planning e workbench;
3. magazzino e fornitori;
4. economia e pagamenti;
5. comunicazioni;
6. post-vendita;
7. form e preventivatori;
8. amministrazione, integrazioni, archivio e fallback.

Non dichiarare completato il redesign se metà delle route conserva la vecchia
grammatica.

## Fase 6 — Hardening

- responsive;
- a11y;
- motion interruption;
- dark mode;
- performance;
- bundle;
- console;
- test per ruolo/capability;
- fixture stress;
- documentazione;
- verifica del rollback.

---

# 24. STRATEGIA TECNICA

## 24.1 Feature flag

`FLAG_UI_V2` è oggi un flag globale di processo. Se riusato, supporta soltanto
`OFF`/`ON` e rollback a livello di deployment. `ON` deve identificare
univocamente Modular Control, non Frame & Flow. Un pilot limitato per utente,
ruolo o sede richiede una progettazione server-enforced separata e una nuova
approvazione: non simularlo nel client.

Non creare differenze di business fra UI vecchia e nuova. Il flag governa
presentazione e shell, non query, mutation, importi, permessi o workflow.

## 24.2 Compatibilità

- nessuna riscrittura server motivata dal layout;
- nessuna duplicazione di query/mutation;
- nessuna nuova fonte di verità client;
- nessuna regressione di deep link;
- nessuna perdita di draft o stato selezionato;
- nessuna alterazione di cache key;
- fallback e redirect intatti.

## 24.3 Modularizzazione

Refactor soltanto dove serve alla nuova esperienza. Se una pagina enorme
impedisce test e coerenza, estrai unità con responsabilità chiara. Non fare
refactor backend o generalisti estranei al redesign.

## 24.4 Disciplina git

- preserva worktree sporchi;
- non usare comandi distruttivi;
- commit piccoli per fondazioni/archetipo/hardening;
- nessun merge, push, PR o deploy senza autorizzazione;
- documenta operazioni esterne non eseguite.

---

# 25. TEST OBBLIGATORI

## 25.1 Suite

Devono passare:

```bash
pnpm check
pnpm test
pnpm build
```

## 25.2 Test mirati

Mantieni o aggiungi test per:

- route e redirect `/produzione/* → /kanban`;
- redirect legacy `/comunicazioni → /messaggi/email`;
- deep link direzione-only e relativo comportamento non autorizzato;
- accesso diretto non autorizzato a `/pagamenti` senza fuga di dati;
- accesso diretto a `/tars` con flag spento, senza query Tars o chiamate
  provider;
- visibilità navigazione per capability effettiva;
- utente multi-ruolo;
- utente con solo override;
- delega negata o scaduta;
- capability economiche;
- assenza di importi nel DOM non autorizzato;
- `importoIncassato` non editabile;
- cambio sede senza render intermedio di nomi, importi o link della sede
  precedente;
- pulizia di query cache e stato persistito al cambio di sede/capability;
- flag UI on/off;
- Tars flag off e provider degradato;
- nessuna chiamata Tars durante digitazione;
- proposte Tars inerti;
- token discipline: zero hex applicativi fuori dalle primitive autorizzate;
- assenza di selettori o firme `rf-frame`, `rf-rail` e `rf-reveal` nella resa
  v3;
- keyboard path di dialog, palette, table action e form;
- riduzione motion;
- nessuno scroll globale ai viewport obbligatori.

Per ogni gate non coperto da uno script esistente, definisci prima
dell’implementazione l’evidenza eseguibile: nome del file/test Vitest per route
e token, procedura browser e percorso screenshot per visual/axe, prova esatta
flag-off per rollback. Una self-review va dichiarata come tale; non presentarla
come revisione indipendente.

## 25.3 Visual QA

Per ogni golden screen e poi per ogni archetipo:

- screenshot light desktop;
- screenshot dark desktop;
- screenshot mobile;
- confronto con baseline;
- nessun clipping;
- nessun testo troncato senza affordance;
- nessun controllo sovrapposto;
- nessun errore console;
- focus visibile;
- empty/loading/error coerenti;
- dati protetti assenti.

## 25.4 Fixture stress

Verifica:

- nomi lunghi;
- ragioni sociali;
- indirizzi lunghi;
- molti stati e badge;
- importi grandi e negativi dove ammessi;
- liste vuote e molto lunghe;
- allegati numerosi;
- contenuto email non attendibile;
- errori parziali;
- offline/refetch;
- testo ingrandito al 200%.

---

# 26. REVISIONE INDIPENDENTE

Prima di dichiarare completato, esegui revisioni separate su:

1. coerenza visuale e fedeltà alla nuova direzione;
2. UX operativa e densità;
3. responsive/mobile;
4. accessibilità;
5. ruoli, capability e privacy economica;
6. Tars e sue garanzie;
7. performance e bundle;
8. anti-copia e anti-template.

Ogni revisore deve cercare difetti concreti, con file, pagina, viewport e
gravità. Correggi Critical e High, riesegui i test e registra eventuali Medium
rinviati con motivazione.

Test umano finale:

- cambiando logo e nome, la UI sembra un prodotto generico?
- le pagine operative sono diventate troppo ariose?
- il gradiente ha una funzione o è decorazione?
- ogni card esiste per una ragione?
- le schermate esprimono il settore e i flussi reali?
- Tars sembra un’intelligenza governata o un chatbot generico?
- mobile consente davvero di completare il lavoro?
- la reference è stata reinterpretata o copiata?

---

# 27. ROLLOUT E ROLLBACK

Il rollout futuro non è autorizzato da questo prompt. Con il sistema corrente,
`FLAG_UI_V2` è globale e richiede configurazione/deploy: consente soltanto
attivazione o rollback a livello di processo. Un rollout per singolo utente,
ruolo o sede non è possibile senza un meccanismo server-enforced separato,
approvato e testato; non simularlo client-side.

Sequenza minima consentita dal meccanismo attuale:

1. flag spento in produzione;
2. verifica completa in ambiente locale/staging;
3. decisione esplicita di attivazione globale;
4. monitoraggio;
5. rollback globale immediato se necessario;
6. rimozione della UI precedente solo dopo stabilità verificata.

Rollback: spegnere il flag senza migrazioni dati e senza alterazioni di stato.
Non presentare come eseguito un rollout che non è stato realmente fatto.

---

# 28. DEFINITION OF DONE

Il lavoro è completato soltanto quando:

- il route manifest copre ogni path di `App.tsx`;
- ogni route è marcata `migrata`, `esclusa con motivazione` o `redirect`, mai
  lasciata in stato implicito;
- la matrice documenta almeno otto trasformazioni strutturali con evidenza
  prima/dopo;
- `reference-extraction.md` è presente e guida la revisione anti-copia;
- la vecchia direzione Frame & Flow non trapela nelle schermate v3;
- palette e gradienti rispettano questo documento;
- shell, navigazione e archetipi sono coerenti;
- Dashboard, Commessa, Board, Tars e mobile hanno qualità da golden screen;
- tabelle e workbench restano efficienti;
- light e dark sono progettati;
- desktop e mobile sono verificati;
- WCAG 2.2 AA è rispettata;
- ruoli, sede, economia e Tars non hanno regressioni;
- nessun importo protetto viene montato o inferito;
- nessuna pagina Produzione è stata reintrodotta;
- nessuna funzione inesistente è suggerita dalla UI;
- `pnpm check`, `pnpm test` e `pnpm build` passano;
- non ci sono nuovi errori console;
- documentazione e handoff sono aggiornati;
- il rollback è verificato;
- operazioni esterne non eseguite sono dichiarate;
- nessun merge, deploy, push o PR è stato eseguito senza autorizzazione.

---

# 29. FORMATO DEGLI AGGIORNAMENTI

Durante il lavoro comunica in modo breve e verificabile:

- cosa stai analizzando;
- cosa hai scoperto;
- quale decisione visuale stai applicando;
- quali file o pagine sono coinvolti;
- quali test hai eseguito;
- quali rischi restano.

Non dichiarare “completo”, “corretto” o “passa” senza evidenza recente.

Il report finale deve includere:

- risultato ottenuto;
- pagine migrate;
- sistema visuale realizzato;
- screenshot principali;
- test e comandi con esito;
- audit accessibilità;
- verifica desktop/mobile;
- impatto bundle;
- stato del flag;
- commit creati;
- esclusioni e rischi residui;
- operazioni esterne non eseguite.

---

# 30. PRIMO COMANDO OPERATIVO

Inizia così:

1. leggi `AGENTS.md`, `handoff.md`, `docs/source-of-truth-matrix.md`, la spec
   Tars v2 e le sezioni PRD coinvolte;
2. esegui `git status` e identifica branch, base e modifiche non proprie;
3. verifica `package.json`, route, shell, navigation model, token, flag,
   permessi e test;
4. produci un rapporto sintetico “fatti, contraddizioni, rischi e superficie
   della migrazione”;
5. acquisisci screenshot baseline delle golden screens;
6. crea il dossier “Modular Control / Borgogna Operativa” e i mockup
   desktop/mobile;
7. presenta l’unico checkpoint visuale richiesto;
8. dopo l’approvazione, implementa e verifica l’intero redesign fino alla
   Definition of Done.

Non iniziare cambiando colori a caso. Non fermarti a un audit o a un mockup.
Dopo il checkpoint approvato, porta il lavoro fino a una UI completa, coerente,
testata e documentata sul feature branch, salvo un blocco reale o una decisione
che cambierebbe il comportamento del prodotto.
