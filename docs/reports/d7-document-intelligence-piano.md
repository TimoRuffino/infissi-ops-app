# D7 Document Intelligence — ricognizione, gap e piano (28/08/2026)

> Fase 2 della roadmap (dossier §11). Requisiti canonici: PRD §54.6.
> Questo documento registra cosa esiste già, cosa manca e come si arriva
> alla capacità completa per vertical slice. La prima slice è implementata
> (v. fondo); il resto è pianificato, NON implementato.

## 1. Ricognizione — cosa esiste già (VERIFICATO)

| Bisogno §54.6 | Già nel prodotto | Dove |
|---|---|---|
| Originale conservato immutato | Sì: documenti con `storageKey` + byte immutabili, `dataBase64` legacy | `preventiviContratti`, `fileStorage` |
| Impronta univoca | Sì: `checksum` SHA-256 su ogni documento migrato | upload/`putFile` |
| Provenienza e metadati | Sì: `createdBy`, `createdAt`, `statoAtUpload`, tipo, MIME, size | store `preventivi_documenti` |
| Verifica tipo/dimensione/sicurezza | Sì: allowlist MIME (niente html/svg), size sul payload reale, cap 10 MB | upload §8.3 |
| PDF → testo | Sì: `unpdf` già in produzione | `comunicazioni/allegati.ts` (`estraiTestoAllegato`) |
| Scansione riconosciuta | Sì (concetto): «PDF senza testo estraibile — servirebbe l'OCR» | idem |
| OCR / visione | **No** | — |
| Riferimenti deterministici commessa | Sì: `estraiCodiceCommessa` (`COM-AAAA-NNN`) | `ficMatch.ts` |
| Ordini fornitore da confrontare | Sì: `fornitori_ordini` con codice, data consegna prevista, righe (codici, quantità, prezzi), stato, commessa | `fornitori.ts` |
| Tipo documento «conferma_ordine» | Sì: in `DOC_TIPI`, alimenta il doc gate di `da_ordinare` | §8.1 |
| Byte allegati email/WhatsApp | Sì: rilettura da IMAP/Meta o storage | `allegati.ts` |
| Approval gateway | Principio attivo: nessuna scrittura autorevole automatica (slice: **zero scritture** di dominio) | §54.4 |

## 2. Gap contro §54.6

- Nessuna pipeline documentale con stati osservabili né registro di parser.
- Nessun estrattore di campi con evidenze (pagina, frammento, metodo,
  confidenza).
- Nessun confronto conferma↔ordine né classificazione delle differenze.
- Nessuna idempotenza di elaborazione (impronta+versioni) né storico dei run.
- Nessun OCR, visione, DOCX/XLSX/XML/ZIP; nessun dataset di valutazione.

## 3. Progettazione (senza seconda fonte di verità)

- **I documenti restano dove sono** (`preventivi_documenti`, allegati
  comunicazioni): l'analisi legge i byte dalle fonti esistenti e non copia
  né modifica nulla. L'unico dato nuovo è il **run di analisi**, che è
  derivato e rigenerabile.
- **Registro parser** (`server/documenti/parserRegistry.ts`): ogni parser
  dichiara nome, versione, formati supportati e restituisce testo per
  pagina + avvertenze. Un formato non supportato/illeggibile produce uno
  stato esplicito, mai un fallimento silenzioso. v1: `pdf-testo-nativo`
  (unpdf, per pagina). Slot futuri: `pdf-ocr`, `immagine`, `xlsx/csv`,
  `xml`, `zip`, parser proprietari per fornitore.
- **Estrattore conferme** (`estrazioneConferma.ts`, puro): campi tipizzati,
  ciascuno `CampoEstratto` con evidenza `{pagina, frammento, metodo,
  confidenza}` e possibili alternative. Deterministico in v1 (pattern +
  riferimenti certi: codice ordine, codice commessa, date, totali, codici
  articolo delle righe d'ordine). Un eventuale estrattore AI futuro entra
  come metodo aggiuntivo nello stesso contratto di evidenza, mai come fonte
  primaria.
- **Confronto** (`confrontoOrdine.ts`, puro): conferma vs ordine → elenco
  `Differenza {tipo, gravita, dettaglio, evidenza}`.
- **Run persistiti** (`documenti_analisi`, kv `persistedStore` — volume
  basso, niente DDL): sede, documento, checksum, versioni parser/estrattore,
  passi della pipeline con esito, campi, differenze, esito finale.
  Idempotenza: stessa (documento, checksum, versioni) → stesso run;
  `forza` crea un run nuovo conservando i precedenti.
- **Stati della pipeline** (sottoinsieme §54.6 in v1):
  `ricevuto → validato → estratto → confrontato` con esiti terminali
  `analizzata | scansione_senza_testo | illeggibile | non_supportato |
  errore`. `classificato/collegato/revisionato/applicato` arrivano con le
  slice successive (classificatore tipo documento, collegamento proposto,
  gateway di applicazione).
- **Sicurezza**: i byte passano solo da unpdf; il testo è dato inerte
  (nessun modello, niente esecuzione); limiti di dimensione ereditati;
  cifrato/corrotto → `illeggibile` con motivo. Un prompt injection nel PDF
  resta un frammento di evidenza.
- **Azioni**: la v1 **non scrive nulla** su commesse/ordini/date: produce
  campi, differenze ed evidenze che l'operatore legge dall'ordine. Le
  «azioni proposte» (aggiorna data consegna, apri anomalia, ripianifica)
  arrivano in una slice successiva attraverso l'approval gateway.

## 4. Piano per vertical slice

1. **[QUESTA SLICE] Conferma d'ordine PDF → estrazione con evidenze →
   confronto con l'ordine** — parser nativo, estrattore deterministico,
   differenze classificate, run idempotenti, UI nella scheda ordine
   (direzione), test con PDF digitali/scansionati/corrotti/duplicati/
   ambigui/con variazioni/con injection.
2. **[FATTA il 28/08/2026]** Collegamento assistito: candidati
   deterministici dal documento senza ordine scelto (codice ordine >
   commessa > fornitore > articoli > date > totali), punteggio spiegabile
   con evidenze, stati certa/candidata/ambigua/assente, conferma umana
   obbligatoria, rifiuti/annullamenti auditati, idempotenza + duplicati per
   impronta, capability `commessa.manage_documents`. Dettagli: PRD §19.4.
3. **[FATTA il 29/08/2026]** Azioni proposte con approval gateway
   (`server/proposte/`): fondazione generale e tipizzata separata dai
   router business, registro chiuso (unica azione:
   `ordine_fornitore.aggiorna_data_consegna`), stati
   proposta→approvata→applicata/fallita + rifiutata/annullata/scaduta/
   obsoleta, doppia capability (`documento.approve_proposals` +
   `fornitore.manage_ordini`), freschezza ricontrollata prima di ogni
   decisione, conferma esplicita in due passi. Il conflitto con la posa è
   un caso del Centro Azioni (`consegna_fornitore`) — su decisione della
   direzione NIENTE nuova entità anomalia né ciclo di contestazione al
   fornitore. Nessuna applicazione automatica. Dettagli: PRD §19.4.
4. **[OCR FATTO il 29/08/2026]** OCR locale Tesseract 5 come fallback
   esplicito del testo nativo (`server/documenti/ocr.ts`): rendering
   pdftoppm pagina per pagina, TSV con confidenze, lingue configurabili
   (`OCR_LINGUE`, default ita+eng, deu predisposto), limiti e timeout,
   esiti espliciti, «da verificare» sotto soglia, firma OCR
   nell'idempotenza. Deploy: aptPkgs in nixpacks.toml. Nessun servizio
   cloud (decisione direzione 29/08). Restano futuri: XLSX/CSV listini e
   conferme, EML/allegati diretti, ZIP, estrattore AI opzionale dietro
   evidenza.
5. **[FATTA il 29/08/2026]** Framework di valutazione
   (`server/documenti/eval/`, `pnpm eval:documenti`): 16 fixture
   sintetiche (incluse scansioni vere, storte e a bassa risoluzione,
   tabella spezzata, ambiguità, codici simili, injection, duplicato,
   corrotto, timeout), metriche separate per campo / collegamento /
   differenze / OCR / tempi / % da rivedere, report baseline in
   `docs/reports/d7-eval-2026-08-29.md`. Nessuna soglia dichiarata sui
   sintetici; `casi-reali/` (gitignored) pronto per le conferme reali
   anonimizzate con `atteso.json`. Primo dividendo: scoperto e corretto
   il match dei riferimenti senza confini (ORD-10 in ORD-100).

## 5. Esito della slice 1 (28/08/2026)

Implementata come da §4.1: moduli `server/documenti/*`, router
`analisiDocumenti` (direzione), pannello «Conferma d'ordine» nella scheda
ordine di FornitoriList, suite `server/documenti/analisiConferma.test.ts`
con PDF generati in-test (jsPDF). Nessuna scrittura su dati autorevoli;
nessuna migrazione.

**Limite dichiarato della slice 1 (superato il 29/08/2026 dalla slice 4):**

- i PDF con testo nativo vengono analizzati;
- i PDF scansionati passano ora dal fallback OCR locale (slice 4): se il
  testo viene riconosciuto il run è `analizzata` con parser `pdf-ocr` e
  confidenze dichiarate («da verificare» sotto soglia);
- se l'OCR è assente, fallisce o non riconosce nulla, il contenuto NON
  viene compreso e lo stato resta `scansione_senza_testo` col motivo;
- un documento senza contenuto riconosciuto non viene MAI presentato come
  «analizzato con successo»: campi e confronto compaiono solo per lo stato
  `analizzata`.
