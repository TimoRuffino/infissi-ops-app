# Rollout e rollback — Document Intelligence (D7)

> Runbook per l'attivazione progressiva e lo spegnimento della Document
> Intelligence (analisi conferme, collegamento assistito, approval
> gateway, OCR locale) su Railway. Vale la regola di sempre: il deploy
> segue `main`; le variabili si cambiano dal pannello Railway del servizio
> e ogni modifica riavvia il processo.

## 1. Gli interruttori

Tre variabili d'ambiente indipendenti, lette a ogni chiamata
(`server/platform/interruttori.ts`). **In produzione (`NODE_ENV=production`)
il default è SPENTO**; in sviluppo e test è acceso. Valori: `on`/`off`
(accettati anche `true/false`, `1/0`); un valore diverso ricade sul
default d'ambiente.

| Variabile | Governa | A interruttore spento |
|---|---|---|
| `FLAG_DOCUMENT_INTELLIGENCE` | analisi conferme (`analisiDocumenti.*`) e collegamento assistito | endpoint → `PRECONDITION_FAILED`; pannello «Conferma d'ordine» e azione «Collega a un ordine» nascosti |
| `FLAG_PROPOSTE` | approval gateway (`proposte.*`) | endpoint → `PRECONDITION_FAILED`; pannello «Proposte dall'analisi» nascosto |
| `FLAG_OCR` | fallback OCR nel registro parser | le scansioni restano `scansione_senza_testo` con motivo «OCR disattivato dalla configurazione (FLAG_OCR)»; firma OCR = `assente` (i run restano rianalizzabili) |
| `FLAG_ANTEPRIME_EVIDENZE` | anteprime delle evidenze: pagine rese in JPEG, tasto «Dove l'ho letto» (06/09/2026) | rotta `/api/documenti/:id/pagina/:n` → `404`; nessun rendering nei worker; il client nasconde il tasto |

Il confine è il **server**: la UI nasconde soltanto. I test
(`server/platform/interruttori.test.ts`) dimostrano che nemmeno la
direzione aggira un interruttore spento chiamando direttamente l'API.

Interazioni da sapere:

- con `FLAG_PROPOSTE=on` e `FLAG_DOCUMENT_INTELLIGENCE=off`, la
  generazione lavora solo sui run di analisi GIÀ esistenti (niente analisi
  nuove). L'ordine di attivazione sotto evita l'ambiguità;
- spegnere un flag non tocca i dati: run, collegamenti e proposte
  restano negli store e riappaiono alla riaccensione. Le proposte hanno
  comunque scadenza (30 giorni) e verifica di freschezza;
- il caso «consegna fornitore ↔ posa» del Centro Azioni deriva da
  proposte già APPLICATE (dati reali): può restare visibile anche a flag
  spenti, ed è corretto così.

## 2. Prerequisiti del rollout

1. La PR del branch `slice-3-document-intelligence` è stata revisionata e
   il merge su `main` è stato deciso dalla direzione (il push su `main` È
   il deploy).
2. Il primo deploy ricostruisce l'immagine con i pacchetti OCR
   (`nixpacks.toml`, aptPkgs: `tesseract-ocr`, `tesseract-ocr-ita/eng/deu`,
   `poppler-utils`, ~60-80 MB): attendersi una build più lunga del solito.
3. Backup Drive riuscito nelle ultime 24 ore (regola generale del repo).

## 3. Rollout progressivo

Dopo il deploy la Document Intelligence è **tutta spenta** (default di
produzione): il CRM si comporta come prima. Attivare una fase alla volta,
lasciandola respirare almeno un giorno lavorativo.

**Fase 0 — verifica neutra (nessun flag).**
- La UI non mostra pannelli DI; `/api/trpc/auth.me` risponde; log puliti.

**Fase 1 — analisi e collegamento** (`FLAG_DOCUMENT_INTELLIGENCE=on`).
- Scheda ordine → «Conferma d'ordine (PDF)» su un PDF nativo reale:
  stato `analizzata`, campi con evidenza, differenze sensate.
- Una scansione deve fermarsi con lo stato esplicito (l'OCR è ancora
  spento) e il motivo `FLAG_OCR`.
- Collegamento assistito da «File e documenti»: candidati spiegati,
  conferma umana, audit.

**Fase 2 — proposte** (`FLAG_PROPOSTE=on`).
- Da un'analisi con `consegna_diversa`: genera → approva → applica con
  doppia capability; verifica che SOLO `dataConsegnaPrevista` cambi.
- Con una posa pianificata prima della nuova consegna: caso
  `consegna_fornitore` nel Centro Azioni entro un minuto (scheduler).

**Fase 3 — OCR** (`FLAG_OCR=on`).
- Rianalizzare la scansione della fase 1 (`forza` non serve: la firma OCR
  cambia da `assente` e il run si rigenera): «Analizzata con OCR» con
  confidenza; sotto soglia compare «DA VERIFICARE».
- Controllare tempi (~0,5-2 s/pagina attesi) e che in `/tmp` del
  container non restino directory `ruffino-ocr-*`.

**Fase 4 — anteprime delle evidenze** (`FLAG_ANTEPRIME_EVIDENZE=on`, 06/09/2026).
- Aprire una commessa con una conferma letta: il tasto «Dove l'ho letto» accanto
  al costo apre la vignetta con il ritaglio della pagina; «Apri PDF» porta alla
  pagina giusta.
- Il worker dei costi scalda le pagine dopo ogni lettura: controllare nei log
  `[anteprime]` tempi per pagina (attesi 0,1–0,3 s) e che in `/tmp` non restino
  cartelle `ruffino-pagine-*`.
- Le pagine rese vivono nello storage sotto `anteprime/`: derivate e
  rigenerabili, escluse dal backup Drive.

## 4. Rollback

- **Mirato**: riportare a `off` (o rimuovere) il flag della fase che dà
  problemi — dall'ultimo attivato al primo. Il riavvio applica; i dati
  restano, le superfici spariscono, gli endpoint rifiutano.
- **Totale DI**: tutti e tre i flag a `off` → il CRM torna al
  comportamento pre-D7 senza toccare `main` né i dati.
- **Estremo** (solo per un difetto fuori dai flag): revert del merge su
  `main` — decisione della direzione, con le cautele di sempre sul deploy
  automatico.

## 5. Checklist post-deploy (prima di attivare qualsiasi flag)

- [ ] Deploy verde su Railway, healthcheck `auth.me` OK.
- [ ] Nell'immagine: `tesseract --version` (5.x), `tesseract --list-langs`
      con `ita`, `eng`, `deu`, `pdftoppm -v` (smoke già eseguito in locale
      sull'immagine Nixpacks; ripetibile via shell del container).
- [ ] Log di avvio senza errori nuovi; memoria/CPU nella norma.
- [ ] Ri-notifica saldo una tantum attesa e comunicata (v. §6).
- [ ] Solo dopo: fase 1 del rollout.

## 6. Nota: ri-notifica saldo una tantum

La slice 2 authz ha cambiato la chiave dei casi/notifiche di saldo
(`versioneRegistroPagamenti` al posto dei valori economici): al primo
avvio dopo il merge, i casi saldo aperti possono **ri-notificarsi una
volta** (fingerprint diverso → «riaperta nuove evidenze»). È atteso, non è
un doppio incasso: avvisare amministrazione che la mattina del deploy
qualche notifica di saldo già nota può ricomparire.
