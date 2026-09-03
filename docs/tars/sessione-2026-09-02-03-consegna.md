# Consegna di sessione — Tars, 02–03 settembre 2026

Documento di passaggio: cosa è stato fatto, com'è la produzione adesso,
cosa è deciso, cosa resta da implementare e dove si è fermato il lavoro in
corso. Chi riprende parte da qui e non ha bisogno della chat.

Worktree: `.worktrees/tars-main` su `main`. Push su main = deploy Railway
(`crm-ruffinogroup.up.railway.app`).

---

## 1. Cronologia dei mandati e cosa è stato consegnato

Ogni riga: richiesta della direzione → risposta tecnica → commit → esito.

### 1.1 «Tars deve leggere tutto, capire tutto e poter fare tutto» (Tars libero)

- **Taglio A — nucleo libero** (`6a78cce`, prod 02/09 16:48). Il catalogo
  delle azioni è tutto ciò che l'utente può fare (fail-closed per
  capability, sede, flag), senza potatura per superficie o intento
  (`azioni/policy.ts`). Via i classificatori deterministici che
  rispondevano al posto del modello: le ambiguità entrano come hint nel
  contesto. Nessuna autorità derivata dal testo: gli strumenti verificano
  da soli sede, archiviazione, state machine, gate, versione. Prompt v9
  standalone (`prompt/v9.ts`).
- **Taglio B — 13 strumenti di scrittura** (`1ed6f0b`): crea/aggiorna
  cliente, crea/aggiorna/archivia/ripristina commessa, aggiorna/chiudi
  ticket, pianifica intervento, collega/classifica/segna gestita
  comunicazione, risolvi caso (`strumenti/scrittura.ts` +
  `strumenti/comune.ts`). Ogni tool esegue **la stessa procedura tRPC del
  router** con il contesto server dell'utente (`callerPer`): stesse
  capability, stessa sede, stessa `authorizeCoreOperation`. Registro
  azioni 1.10.0 = 44 azioni.
- **Taglio C — visibilità** (`1ed6f0b`, poi ridisegnato): endpoint
  `tars.proposte` e `tars.registroAzioni`; pagina `/tars` con selettore
  **Chat / Proposte / Registro**.

### 1.2 «Le proposte sono inutili» (smistamento troppo timido, poi troppo rumoroso)

- `60df098` — smistamento 1.3.0: forme giuridiche per esteso, enti e
  località fuori dai candidati (l'azienda stessa veniva proposta come
  cliente); un candidato **solo cliente** si propone solo a confidenza
  alta.
- `ff66911` — niente proposte su lavoro morto: nessuna proposta su
  comunicazioni oltre `TARS_SMISTAMENTO_GIORNI_PROPOSTE` (30) o già
  gestite; a ogni giro le proposte aperte su mail invecchiate, gestite o
  collegate a mano passano a `scaduta`. In produzione ha chiuso 32
  proposte vecchie al primo giro.

### 1.3 «Tars non fa quello che gli dico» (Da Pozzo → finita)

- `ff66911` — transizioni libere: lo strumento
  `transizione_adiacente_commessa` (1.1.0) accetta lo **stato di arrivo**
  anche non adiacente e fa i passaggi **uno alla volta**, ognuno
  registrato e annullabile (Undo dall'ultimo). Un gate documentale ferma e
  dice cosa manca (`transizione_parziale`); con `scavalcaGate: true` —
  solo quando l'utente ha chiesto esplicitamente lo stato o «procedi
  comunque» — scavalca come il «Procedi comunque» del board, con la stessa
  capability, registrato in `bypassGateDocumentale` e dichiarato nella
  risposta. Il dominio vieta il bypass **solo all'Undo**. Prompt v10 con i
  sinonimi: finita → `finiture_saldo`, interventi →
  `interventi_regolazioni`, chiusa → `archiviata`.

### 1.4 «Tars consuma troppi crediti»

Misura del 02/09: 2.912 chiamate, **28,33 USD**, di cui 27,23 dello
smistamento dell'arretrato (2.894 chiamate) a tariffa doppia perché
`TARS_SERVICE_TIER=priority` valeva per tutte le classi.

- `3c66c58` — profilo per classe (`governor.profiloEsecuzione` + campo
  `esecuzione` di `RichiestaProvider`): solo `interactive` usa il tier
  dell'ambiente e `TARS_REASONING_INTERACTIVE`; tutto il background va su
  tier normale con `TARS_REASONING_BACKGROUND` (default `low`).
  `tariffaDi(modello, tier)` scala per classe. Smistamento: modello solo
  entro `TARS_SMISTAMENTO_GIORNI_MODELLO` (14, era 90), spam/marketing
  evidenti senza modello, prompt più corti (3.500 caratteri, 1 allegato da
  1.500).
- **Incidente collaterale**: la direzione aveva impostato
  `TARS_MODEL_INTERACTIVE=gpt-5.5`, **fuori dal catalogo tariffe chiuso**
  (`gpt-5.6-terra`, `gpt-5.6-sol`): il governor rifiuta e la chat scivola
  sul provider finto. Riportato a `gpt-5.6-terra`. Un modello nuovo entra
  solo aggiungendo la sua tariffa in `server/tars/costi/tariffe.ts`.

### 1.5 Analisi azienda giornaliera

- `952152b` — modulo `server/tars/analisi/`: fotografia deterministica
  della sede → sintesi del modello (JSON strict) → punti, proposte con la
  frase da dire a Tars, domande. Una al giorno per sede dalle 06:00 Roma
  (`tars_analisi_azienda`), rigenerabile a mano. Flag
  `FLAG_TARS_ANALISI_AZIENDA` (acceso in prod), classe di costo
  `analisi_azienda`, `TARS_MODEL_ANALISI` (default `gpt-5.6-sol`).
- `42ab213` — `maxOutputToken` 8.000 (a 2.500 il JSON si troncava) e
  ritento automatico dopo 30 minuti, max 3 al giorno (colonna
  `tentativi`).

### 1.6 UI della pagina Tars

- `954938f` — prima stesura: schede Chat/Proposte/Registro.
- `41104b3` — seconda stesura su richiesta («non va bene»): **coda di
  decisioni a righe, a tutta larghezza** (le colonne laterali spariscono
  in Proposte e Registro). Per riga: tipo e mittente, titolo, «Collega a
  <commessa>» in evidenza, chip sicuro/probabile/urgente, bottone grande
  Approva + Rifiuta, «Perché e cosa succede» a richiesta, filtri
  Tutte/Comunicazioni/Analisi/Documenti. In sviluppo
  `/tars?demoProposte` mostra dati finti per vederla piena.

### 1.7 «Devono esserci i nomi» e «il link deve portarmi a quella comunicazione»

- `832626a` — `server/tars/entita.ts`: un riferimento canonico
  (`commessa:133`, `ticket:11`, `comunicazione:2683`) diventa **nome +
  link**, sede-scoped (comunicazioni lette in blocco, casi in una lista
  sola). `tars.registroAzioni` e `tars.analisiAzienda` restituiscono le
  entità già risolte; Registro, Proposte e «Analisi di oggi» mostrano chip
  col nome e ci si clicca sopra. `linkComunicazione` apre la
  **conversazione WhatsApp** (`?conversazione=wa:<casella>:<numero>`), non
  più la pagina generale. Il thread WhatsApp mostra lo smistamento di Tars
  (lettura dell'ultimo messaggio + proposte aperte sugli altri messaggi
  del filo, con Collega/No). Prompt analisi-v3: nel testo sempre i nomi,
  mai «la commessa 133».

### 1.8 «Proposte su commesse vecchie mesi»

- `b26e559` — `server/commesse/attivita.ts`: l'ultima attività di una
  commessa è il più recente fra creazione, documento, transizione, step di
  timeline, intervento e comunicazione collegata.
  `ultimaComunicazionePerCommessa` aggrega in una query sola. **Causa
  vera**: `commesse.updatedAt` è riscritto in blocco dai lavori di fondo —
  in produzione nessuna commessa risultava ferma da più di 7 giorni mentre
  alcune non vedevano un fatto reale da 111. Dormienti oltre
  `TARS_GIORNI_DORMIENTE` (default **60**, era 120).
- `b69bc34` — timeout esplicito (20 s) sul test WhatsApp che importa a
  freddo tutto l'albero dei router: falliva per timeout a suite piena, mai
  per un'asserzione.

### 1.9 Studio dei processi

- `64d628b` — `docs/superpowers/plans/2026-09-03-tars-utile.md`: misure di
  produzione, come si muove una commessa, perché le proposte non servono,
  piano T1–T6, decisioni D1–D4.

---

## 2. Com'è la produzione adesso (03/09/2026, sera)

**Dati** (letti dal database, non stimati):

| Cosa | Quanto |
|---|---|
| Commesse | 392, di cui 372 attive; **263 in «preventivo»** |
| Altri stati | produzione 29, finiture_saldo 22, attesa_posa 16, da_ordinare 15, interventi_regolazioni 9, fatture_pagamento 6, ordini_ultimazione 4, aggiornamento_contratto 4, misure_esecutive 4 |
| Clienti | 956 |
| Documenti fascicolo | 548 (137 MB: ancora base64 dentro il JSONB) |
| Step timeline | 3.927 · Transizioni registrate | 106 |
| Fatture FiC | 340 (1 non collegata) · Costi FiC 2.074 · Pagamenti link 722 |
| Ticket | 32 · Interventi **3** · Squadre 8 · Magazzino 56 |
| **Fornitori / ordini / reclami / rifacimenti** | **0** (moduli non usati) |
| Comunicazioni | ~10.000, 3.300 smistate da Tars |
| Attività reale commesse | 335 toccate < 30 gg, 31 fra 31–90, 6 oltre 90 |

**Flag Railway accesi**: FLAG_TARS, READ_TOOLS, REMINDERS, L2_ACTIONS,
PROPOSALS, PROACTIVE, PATTERNS, IMPROVEMENTS, COMMUNICATIONS, MEMORY,
SMISTAMENTO, ANALISI_AZIENDA. `TARS_PROVIDER=openai`,
`TARS_MODEL_INTERACTIVE=gpt-5.6-terra`, `TARS_REASONING_INTERACTIVE=medium`,
`TARS_SERVICE_TIER=priority` (vale **solo** per la chat),
`TARS_OBSERVER_MODE=active`.

**Costi attesi a regime**: smistamento ~0,3 USD/giorno, analisi ~0,3
USD/giorno, chat a consumo (~0,018 USD a messaggio con priority; metà
senza).

---

## 3. Decisioni della direzione (03/09/2026)

- **D1 — Ordini dai messaggi, non dal modulo.** Fornitori/ordini restano
  vuoti. Tars legge le conferme d'ordine dalle mail/PEC (Antenore,
  Oknoplast, Primed…), ne ricava fornitore, riferimento e data di
  consegna, li tiene sulla commessa e segnala i ritardi.
- **D2 — Il calendario diventa quello del CRM; Google si spegne.** Oggi il
  CRM espone un feed ICS che Google sottoscrive (`calendarSync.ts`) e
  importa calendari Google in sola lettura nel Planning
  (`externalCalendars.ts`): gli appuntamenti veri stanno su Google (3
  interventi nel CRM). Tars deve leggerli e capirli, **inserirli e
  spostarli** nel CRM (data, ora, tipo, squadra) e far seguire la commessa
  (posa fissata → attesa posa; posa fatta → finiture e saldo; rilievo
  fatto → misure) con gate e Undo delle transizioni normali.
- **D3 — Ritmo commerciale.** Preventivo senza risposta: **7 giorni** →
  sollecito; **30 giorni** → proposta di chiuderlo come perso.
- **D4 — Ogni proposta e ogni notifica hanno un destinatario.** Commessa
  assegnata a un commerciale + tema commerciale → solo a lui; tema
  amministrativo (fattura, pagamento, incasso) o commessa in «fatture e
  pagamento» / «ordini e ultimazione» → amministrazione; post-vendita →
  chi ha il ticket, altrimenti chi ha la commessa; direzione vede tutto
  più ciò che non ha assegnatario. Le notifiche seguono lo stesso criterio.

---

## 4. Piano da implementare (T1–T6)

### T1 — Gli strumenti che mancano — **IN CORSO**

Sblocca i casi già segnalati dalla direzione: «collega la fattura n. 130
alla commessa 168», «sposta il documento», «dal numero 3337… crea cliente
e commessa».

Fatto e **non ancora committato** (vedi §5):
- `server/tars/strumenti/ricerca.ts` (nuovo): `cerca_comunicazioni`
  (testo, telefono per sole cifre, canale, non collegate),
  `cerca_fatture` (numero, cliente, commessa, non collegate; capability
  `economia.read`), `cerca_documenti` (nome, tipo, commessa, cliente).
- `server/routers/preventiviContratti.ts`: `documentiDiSede(sedeId)` e
  `spostaDocumentoDiCommessa({documentoId, commessaId, sedeId, note})` —
  sposta il documento nel fascicolo giusto, rifiuta destinazioni
  archiviate o fuori sede, rinomina se il nome è già preso e riallinea
  `statoAtUpload` allo stato della commessa di destinazione (il gate segue
  il documento).

Da fare per chiudere T1:
1. Due strumenti di scrittura in `strumenti/scrittura.ts`:
   `collega_fattura_commessa` → `caller.ficFatture.collega({ficId,
   commessaId})` (la procedura fa già pattuito, incassi e PDF nel
   fascicolo; richiede direzione o amministrazione);
   `sposta_documento` → `spostaDocumentoDiCommessa`, esito con prima/dopo.
2. Registrarli tutti in `server/tars/azioni/registry.ts` (import,
   `STRUMENTI_CORRENTI`, METADATI: R0 per le ricerche, R1 per le due
   scritture, capability e interruttori) e bumpare
   `VERSIONE_REGISTRO_AZIONI` (→ 1.11.0, goldens del test da aggiornare:
   44 → 49).
3. Test: `strumenti/ricerca.test.ts` (ricerca per numero WhatsApp,
   fattura per numero, documento per nome, sede altrui invisibile) e casi
   nuovi in `strumenti/scrittura.test.ts` (collegamento fattura, spostamento
   documento con gate ricalcolato, destinazione archiviata rifiutata).
4. `docs/tars/matrice-azioni-tars.md`: una riga per strumento.
5. Suite, build, commit, push, verifica del deploy.

### T2 — La fotografia guarda dove si lavora

Togliere dalla fotografia i segnali su moduli vuoti (ordini fornitore,
reclami: oggi il modello cita «ritardi fornitore» su dati inesistenti) e
mettere: preventivi fermi con età reale, gate documentali mancanti,
fatture non collegate o non incassate, comunicazioni senza risposta oltre
24 h, ticket senza assegnatario.

### T3 — Proposte che si eseguono

Oggi «Chiedi a Tars» apre la chat con la frase già scritta. Deve diventare
un bottone che **fa la cosa** (con Undo dove il dominio lo consente):
«Collega la fattura n. 130 a COM-2026-168», «Sposta il DDT», «Ricorda il
preventivo Soare». Serve un contratto proposta→azione: `azione:
{strumento, input}` verificata server-side prima dell'esecuzione.

### T4 — Il calendario dentro il CRM (D2)

`leggi_agenda` (giorno/settimana, per squadra o commessa),
`pianifica_intervento` esteso (ora, squadra, spostamento),
`sposta_intervento`, `segna_intervento_fatto` che porta avanti la
commessa. Poi la migrazione: gli appuntamenti Google diventano interventi
del CRM, il Planning diventa la fonte, Google resta solo come feed in
uscita finché non si spegne.

### T5 — Follow-up commerciale (D3)

Preventivo fermo 7 giorni → promemoria all'assegnatario con bozza di
messaggio al cliente; 30 giorni → proposta di chiuderlo come perso.

### T6 — Ogni proposta al suo destinatario (D4)

Le proposte (smistamento, analisi, gateway) e le notifiche nascono con un
destinatario derivato da assegnatario della commessa, ruolo, stato della
commessa e natura del tema. La coda «di tutti» sparisce.

---

## 5. Lavoro in corso: dove si è fermato

Nel worktree, **non committato**:

- `server/tars/strumenti/ricerca.ts` — nuovo, completo, compila; **non
  ancora registrato** nel registry, quindi Tars non lo vede.
- `server/routers/preventiviContratti.ts` — aggiunte `documentiDiSede` e
  `spostaDocumentoDiCommessa` (compilano, senza test).
- `docs/superpowers/plans/2026-09-03-tars-utile.md` — aggiornato con D2
  rivisto (calendario) e i tagli T4–T6.
- `.claude/launch.json` — modifica locale dell'anteprima, da non
  committare.

`pnpm check` è verde. La suite completa era verde a `b69bc34`
(154 file, 1476 test).

---

## 6. Regole e trappole imparate (non ripeterle)

1. **`commesse.updatedAt` non misura niente**: lo riscrivono i lavori di
   fondo. Per «da quanto è ferma» usare `server/commesse/attivita.ts`.
2. **Catalogo tariffe chiuso**: `gpt-5.6-terra` e `gpt-5.6-sol`. Un
   modello fuori catalogo manda la chat sul provider finto senza errori
   visibili.
3. **`TARS_SERVICE_TIER=priority` raddoppia la tariffa**: vale solo per la
   chat, mai per il background (`profiloEsecuzione`).
4. **postgres-js**: mai `JSON.stringify(x)::jsonb`, sempre `sql.json(x)`.
5. **Test**: gli store in memoria sono condivisi fra i test dello stesso
   file (usare id/cognomi unici); con `jsx: preserve` i render statici
   vogliono `globalThis.React = React`; i file che importano a freddo
   `../routers` possono superare i 5 s di default.
6. **Verifica in produzione solo in sola lettura**: `railway ssh` +
   script node in base64 (`NODE_PATH=/app/node_modules`). Mai scritture a
   mano sul database: le migrazioni additive stanno in `ensureSchema`.
7. **Chrome dell'utente non è collegato** al tool del browser: la UI si
   verifica in anteprima locale (`Promo Capture (tars-main)`, porta 5198)
   più sonde read-only sul server.
8. La UI di Tars non deve introdurre scroll orizzontale: verificare 1440 e
   390 px.

---

## 7. Come si verifica

```bash
pnpm check && pnpm test && pnpm build
```

Anteprima locale con dati finti nelle proposte: avviare «Promo Capture
(tars-main)» e aprire `/tars?demoProposte`.

Produzione (sola lettura): `railway deployment list`, `railway logs`,
e sonde node via `railway ssh` (esempi in
`/private/tmp/.../scratchpad/probe-*.js` di questa sessione, ricostruibili
in due righe: `postgres(process.env.DATABASE_URL)` + query).

Tabelle utili: `tars_costi` (spesa per classe/modello/giorno),
`tars_smistamento` (stati e proposte), `tars_analisi_azienda` (analisi del
giorno), `tars_azioni_esecuzioni` (registro R1), `kv_store` (commesse,
documenti, fatture: colonna `data`).

---

## 8. Domande ancora aperte

1. Quale casella/PEC riceve le conferme d'ordine e con quali mittenti
   tipici (serve a Tars per riconoscerle senza aprire tutto)?
2. Chi sono i commerciali assegnatari per D4 e come si assegna oggi una
   commessa?
3. Migrazione calendario: si importano gli appuntamenti Google esistenti
   nel CRM (una tantum) o si parte da oggi in avanti?
