# Ruffino Flow UI v2 — «Frame & Flow / Officina Digitale»

> **Direzione estetica superata (31/08/2026).** Il linguaggio visivo Frame &
> Flow è sostituito dal master prompt v3 “Modular Control / Borgogna
> Operativa”. Le sezioni tecniche e storiche ancora coerenti con il codice
> restano materiale di riferimento, ma questo documento non autorizza nuove
> scelte estetiche. Fonte vincolante: master-prompt-ruffino-flow-ui-ux-v3.md.

> Dossier di direzione del redesign. Mandato della direzione del 31/08/2026,
> eseguito sul branch `feature/ui-v2-frame-flow`. Base: `main` @ `de0ce77`
> (Tars v2 completo, cost hardening, potenziamento, provider reale acceso).
> Il redesign cambia come il CRM si vede e si usa, mai cosa il CRM fa:
> nessuna regola di business, autorizzazione, importo o transizione cambia.

**Aggiornato:** 31/08/2026

## 1. Verità di partenza (Fase 0, verificata)

| Voce | Esito |
|---|---|
| Base | `main` = `origin/main` = `de0ce77`, albero pulito |
| Tars v2 | VIVO: mergiato (PR #2, `2096a43`), attivato, potenziato (`a347c8a`), provider reale acceso il 31/08 (§11-octodecies handoff) |
| Baseline `pnpm check` | ✅ (1,6 s) |
| Baseline `pnpm test` | ✅ 84 file / 769 test passati, 5 saltati (9,6 s) |
| Baseline `pnpm build` | ✅ — chunk principali: vendor-runtime 567 KB (167 gzip), Dashboard 421 KB (114 gzip), index 184 KB (59 gzip), CommessaDetail 86 KB (21 gzip) |
| Flag | Pattern `server/platform/interruttori.ts`: env fail-closed, on in dev/test, off in produzione |

**Documenti stantii rilevati in Fase 0** (corretti su questo branch, §8):
`CLAUDE.md` e `AGENTS.md` §«Agente AI» dicevano «Tars non esiste» (testo
dell'era-rimozione 28/08, mai aggiornato dopo la ricostruzione T1–T9);
l'header di `handoff.md` diceva «senza agente»; la matrice delle fonti
diceva «AI: nessuna». Il codice e le sezioni §11-* del handoff dicono il
contrario e prevalgono (regola di conflitto n.1 della matrice).

## 2. La decisione sul brand

Il PRD (§29.1, §52.1) documenta da sempre l'identità ufficiale: «palette
chiara calda, superfici bianche, inchiostro scuro e **giallo saturo come
accento**». Il codice però usa un cremisi `#d92f55` con sidebar verde
petrolio a gradiente: è la deriva dell'origine Manus, mai riconciliata.

**Decisione:** UI v2 implementa finalmente l'identità documentata — canvas
caldo, inchiostro, **giallo Ruffino `#F2B705`** come accento firmato, verde
petrolio `#176B68` come colore strutturale secondario (già presente oggi
nella sidebar: continuità, non rottura). Il cremisi esce di scena con la v1.

Regole non negoziabili sul giallo:

- mai testo bianco sul giallo: sempre `on-brand` scuro (contrasto 9,4:1);
- il giallo **non è il warning**: il warning è ambra bruciata `#8A5800`;
- una sola area brand dominante per schermata;
- gli stati non comunicano mai col solo colore.

Tutti i valori sono verificati con calcolo WCAG (59/59 controlli ≥ soglia,
light e dark): dettaglio in `ruffino-flow-tokens.md`.

## 3. Le tre firme

La grammatica proprietaria è limitata a tre firme, ispirate in astratto a
telai, guide e scorrimenti del serramento. La metafora vive nella struttura
e nel movimento, mai nella decorazione (niente finestre disegnate, niente
texture).

- **Frame** — angoli aperti e bordi parziali su header di record, selezioni,
  focus e stati attivi. Non su ogni card: solo dove c'è identità.
- **Rail** — componente semantico di avanzamento: state machine (11 stati),
  timeline, ordini (ordinato→ricevuto), SLA, pipeline DI, progresso Tars.
  Porta con sé stato precedente, gate, autore ed esito. Mai una progress bar
  decorativa.
- **Reveal** — apertura che conserva l'origine spaziale: drawer, inspector,
  espansione evidenze, apertura commessa, passaggio risposta→proposta Tars.

## 4. Cinque archetipi di pagina

Nessuna route diventa «la solita griglia di card». Ogni route appartiene a
un archetipo con silhouette riconoscibile:

1. **Dashboard per ruolo** — «Oggi» dominante (≈8 col), colonna laterale
   briefing/agenda (≈4 col), pulse operativo, niente KPI decorativi.
2. **Record 360** — Commessa, Cliente: header identitario con Frame, rail di
   stato, una CTA contestuale, sezioni, inspector.
3. **Workbench** — Board, Planning, DI, Magazzino, Fornitori: larghezza
   piena, pannelli operativi, scroll locale governato.
4. **Queue/Inbox** — Email, WhatsApp, Centro Azioni, Ticket, Notifiche:
   master-detail, triage, azioni contestuali.
5. **Form/Guided flow** — Rilievo, Verbale, Preventivatori, creazioni:
   larghezza controllata, progressive disclosure, riepilogo, azioni stabili.

La mappa route→archetipo→ruoli→viewport è in
`ruffino-flow-page-matrix.md`.

## 5. Tars nella UI

Tars v2 esiste, è in produzione col provider reale. La UI lo rappresenta
come **cervello operativo, non chatbot**: stesso design system del CRM,
firma ink+giallo segnale, etichetta «Tars», provenienza sempre dichiarata.

- Accessi: command palette (passaggio esplicito, mai chiamate mentre si
  digita), azione «Chiedi a Tars», invocazione contestuale (fascicolo
  commessa già esistente da T3), pagina `/tars`. Nessuna bolla flottante.
- Stati distinti visivamente: risposta, evidenza, omissione per permessi,
  azione L2 eseguita (con Undo), proposta L3 inerte, applicata, degradato,
  provider spento, budget esaurito. La pagina attuale (504 righe) già
  espone briefing, azioni, evidenze, omissioni e degradazione: la v2 la
  ristruttura senza inventare capacità (niente streaming se il server non
  lo offre; il gating su `platform.interruttori` resta identico).
- Il pannello contestuale ridimensiona il workspace su desktop, sheet
  full-screen sotto; `TarsFascicoloCard` è la base esistente.

## 6. Strategia tecnica

### 6.1 Flag `FLAG_UI_V2` (fail-closed)

Riusa il sistema `interruttori.ts` (stesso pattern di FLAG_TARS/DI): env
letta a ogni chiamata, on solo in development/test, off in produzione
finché la direzione non la imposta su Railway. Il client legge
`platform.interruttori` e applica `data-ui-v2` sull'elemento radice.

- Flag OFF ⇒ attributo assente ⇒ resa **identica alla v1** (i token v2 sono
  CSS inerte). Rollback = togliere la variabile e ridistribuire.
- Il flag governa **skin (token) e shell (navigazione, palette comandi,
  bottom nav)**. Le rifiniture di layout interne alle pagine che usano solo
  token semantici valgono in entrambe le skin: sono migliorie, non
  comportamento. Nessuna doppia mutation, nessuna doppia query, nessuna
  differenza backend.
- Due UI non convivono a lungo: a rollout stabile la v1 si rimuove
  (roadmap §9).

### 6.2 Token a tre livelli

`--rf-*` primitivi → semantici → componente, integrati in Tailwind 4 via
`@theme`. I nomi utility esistenti (`bg-surface`, `text-text-2`,
`border-border-soft`…) restano stabili: cambia il valore sotto il flag, non
la classe. Dettaglio completo in `ruffino-flow-tokens.md`.

### 6.3 Contratti intatti

Nessuna modifica ai contratti tRPC per comodità visuale. Capability, sede,
omissioni server-side, helper euro, state machine: intoccati. La UI resta
seconda difesa, mai confine.

### 6.4 Motion

CSS transitions/animations + Web Animations API. Framer Motion è **già** in
bundle (PageContainer, DashboardLayout, LoginPage, Dashboard): si riusa
dov'è, senza estenderne l'impronta a nuovi chunk; niente GSAP/Lottie.
Sistema completo in `ruffino-flow-motion.md`.

## 7. Invarianti che questo redesign giura di non toccare

- State machine 11 stati, transizioni adiacenti, `force` solo sul doc gate.
- Timeline↔Board solo in avanti; lo storico completato non si falsifica.
- `sedeId` ovunque; cross-sede = `NOT_FOUND`.
- `/pagamenti` dietro `pagamento.read`; importi mai nel DOM/cache/tooltip/
  grafici/export per chi non è autorizzato; `daSaldare` solo bit.
- `importoIncassato` derivato; helper euro condivisi.
- FiC fonte fiscale; competenza vs cassa distinte.
- `/produzione` e `/produzione/*` restano redirect a `/kanban`; nessuna
  voce menu, nessuna pagina nuova (test strutturale in §23).
- Tars: proposte inerti fino all'approvazione umana; il modello non approva
  se stesso; niente chiavi nel client; niente chiamate mentre si digita;
  kill switch, governor e budget intatti.
- Calendario Google e WhatsApp read-only dove lo sono oggi; nessun composer
  inventato.

## 8. Debiti documentali corretti su questo branch

- `CLAUDE.md` + `AGENTS.md`: sezione «Agente AI» riscritta sullo stato
  reale (Tars v2 vivo, spec vincolante in `docs/tars/architettura-tars-v2.md`).
- `handoff.md`: header allineato (base descritta, agente presente) e nuova
  sezione UI v2 quando le fondazioni atterrano.
- `docs/source-of-truth-matrix.md`: riga «AI» aggiornata (orchestratore
  governato, mai fonte primaria di un fatto business).

Nota: `main` conserva i testi stantii finché questo branch non viene
mergiato — dichiarato, non nascosto.

## 9. Roadmap del branch

1. ✅ Fase 0–1: base, baseline, ricognizione (questo dossier).
2. Fondazioni: interruttore, token v2 light/dark, motion, primitive.
3. Golden screens: Dashboard direzione, Commessa 360, Board, Tars, flusso
   mobile rilievi/posa, DI fornitori — con autocritica anti-slop.
4. Migrazione per archetipi (ordine §21.6 del mandato).
5. Hardening: reduced motion, a11y, visual check 1440/390, bundle.
6. Quattro revisioni indipendenti + revisione anti-slop.
7. Aggiornamento PRD/handoff, rapporto finale.

Rollout (post-merge, decisioni della direzione): flag spento in produzione
→ verifica interna → un utente → un ruolo → una sede → allargamento →
rimozione v1. Rollback: togliere `FLAG_UI_V2`, nessuna migrazione dati.

## 10. Gate anti-slop (sintesi operativa)

Vietati senza deroga scritta: gradienti decorativi (inclusi i quattro
`--gradient-*` della v1, che la v2 spegne), glow, blob, orb, glassmorphism
diffuso, bento universale, card-in-card, KPI fotocopia, donut decorativi,
emoji come icone, microcopy inglese, robot/sparkles per Tars, stagger
infinito, hover-lift indiscriminato. Checklist completa e test umano in
`ruffino-flow-anti-ai-slop.md`.
