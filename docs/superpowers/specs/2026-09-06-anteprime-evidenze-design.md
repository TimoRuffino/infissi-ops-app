# Anteprime delle evidenze — «Dove l'ho letto» (design, 06/09/2026)

> Mandato della direzione (06/09/2026): ogni dato che il CRM compila da un
> documento letto — costi fornitore, campi e righe del contratto, merce a
> magazzino, segnali di collegamento — anche quando è certo, porta un piccolo
> tasto che apre, come vignetta sopra il tasto, lo screenshot della porzione
> di pagina da cui il dato è stato preso. Deve essere leggibile, non coprire
> la pagina, e far capire un minimo il contesto. Controllare deve essere più
> veloce che aprire il file.

Stato: approvato a sezioni in chat (sezioni 1–5), implementazione in corso
sul branch `claude/ocr-crm-overview-1adbb2`. Piano:
`docs/superpowers/plans/2026-09-06-anteprime-evidenze.md`.

## 1. Contesto

La lettura dei documenti ha un solo punto d'ingresso, `estraiTestoDocumento`
(`server/documenti/parserRegistry.ts`): testo nativo ricostruito dalla
geometria (`testoPdf.ts`), poi OCR locale (`ocr.ts`), poi trascrizione del
modello (`letturaVisiva.ts`). Ogni valore estratto porta già un'evidenza
`{pagina, frammento}` (`estrazioneConferma.ts`, `shared/contratti/estrazione.ts`),
ma nessuna coordinata: le posizioni dei frammenti di pdf.js e i riquadri delle
parole del TSV di tesseract vengono calcolati e scartati.

Vincoli ereditati dal repo (CLAUDE.md): `sedeId` su ogni rotta e query e
`NOT_FOUND` fuori sede; nessun blob base64 nuovo in JSONB; interruttori
fail-closed; il modello non decide e non produce coordinate; token semantici
di `client/src/index.css`; niente scroll orizzontale; verifica a 1440×900 e
390×844.

Regola d'onestà di questa funzione: **la vignetta mostra ciò che l'estrattore
ha davvero letto**. Se la posizione non si trova, si mostra la pagina intera
e lo si dice. Mai un ritaglio indovinato spacciato per prova.

## 2. Il tasto e la vignetta

- **Tasto** `DoveLetto`: icona sola, lucide `ScanSearch`, tooltip e
  `aria-label` «Dove l'ho letto». Area di tocco 40 px, icona piccola. Sta
  subito dopo il valore, sempre nella stessa posizione. C'è quando il valore
  ha un'evidenza con la pagina; se manca l'area apre la pagina intera con la
  scritta «posizione non trovata su questa pagina». Non c'è sui valori
  scritti a mano senza documento.
- **Vignetta**: popover ancorato sopra il tasto, con il beccuccio; sotto se
  sopra non c'è spazio. Nessuno sfondo scuro, la pagina dietro resta
  visibile. Si apre al click, si chiude con click fuori o Esc. Larga 480 px
  su desktop (fino a 640 se serve per leggere), tutta la larghezza meno i
  margini su telefono; alta quanto il ritaglio, tetto 45 % dello schermo.
- **Contesto**: il ritaglio è la riga letta più due righe sopra e due sotto,
  a scala naturale o poco sotto, mai ingrandito oltre 1,25×; se la riga
  intera non ci sta leggibile la finestra si centra sul frammento con i
  bordi sfumati. Il frammento ha un rettangolo in colore d'accento.
- **Didascalia**: sopra, pagina, fonte del testo (nativo / OCR con
  confidenza / trascrizione del modello) e grado della posizione (riquadro,
  zona, pagina intera); sotto, il frammento fra virgolette, «letto X, oggi
  Y» se il valore è stato corretto a mano, e i tasti «Pagina intera» e
  «Apri PDF» (visore esistente, `#page=N`).
- **Attesa**: scheletro alla prima apertura se la pagina va resa; poi
  immediata. Prefetch al passaggio del mouse su desktop.
- **Accessibilità**: raggiungibile da tastiera, Esc chiude,
  `prefers-reduced-motion` rispettato dal popover.

## 3. Dati e coordinate

### 3.1 Forme

```ts
/** Rettangolo in frazioni (0..1) della pagina resa, già ruotata come la vede il visore. */
type Area = { x: number; y: number; w: number; h: number };

type PosizioneEvidenza = {
  grado: "riquadro" | "zona" | "pagina";
  /** Il frammento letto (grado riquadro/zona). */
  frammento?: Area;
  /** La riga intera che lo contiene. */
  riga?: Area;
  /** La fascia di contesto: due righe sopra e due sotto. */
  contesto?: Area;
};

/** Geometria di una pagina, prodotta dal parser accanto al testo. */
type GeometriaPagina = {
  larghezza: number; // in unità della fonte (punti PDF o pixel dell'immagine)
  altezza: number;
  /** true quando la riga i del testo della pagina è righe[i] (nativo, OCR). */
  allineata: boolean;
  righe: Array<{
    y0: number; y1: number;
    tratti: Array<{ testo: string; inizio: number; fine: number; x0: number; x1: number }>;
  }>;
};
```

`Evidenza` delle conferme guadagna `posizione?: { inizio: number; fine: number }`
(scarti nel testo della pagina, scritti dall'estrattore nel momento del match)
e `area?: PosizioneEvidenza`. `EvidenzaEstratta` dei contratti guadagna
`area?`. `RigaMerce` guadagna `area?`. `RiscontroCommessa` guadagna
`evidenze?: Array<{ prova: string; pagina: number; frammento: string; area?: PosizioneEvidenza }>`.
`EsitoParser` in stato `estratto` guadagna `geometria?: GeometriaPagina[]`.
Tutto facoltativo: i record vecchi restano validi e cadono su «pagina intera».

### 3.2 Chi produce le coordinate

Il parser, non l'estrattore.

- **Nativo** (`testoPdf.ts`): le righe sono già costruite dai frammenti di
  pdf.js con `transform`, `width`, `height`; la geometria esce dalla stessa
  funzione che costruisce le righe, quindi è allineata per costruzione. Le
  coordinate passano dal viewport della pagina (scala 1) così la rotazione
  dichiarata dal PDF combacia con ciò che pdftoppm disegna.
- **OCR** (`ocr.ts`, `parseTsv`): il TSV di tesseract porta `left, top,
  width, height` di ogni parola e, nella riga di livello 1, le dimensioni
  della pagina resa; le righe di testo escono dalle stesse parole. Vale
  anche per le foto, sull'immagine originale.
- **Trascrizione del modello**: nessuna coordinata dal modello. Le scansioni
  passano prima da tesseract: la sua geometria viene allegata all'esito
  della visione con `allineata: false`, e il frammento si cerca lì con
  tolleranza (cifre esatte, una lettera di scarto sulle parole). Trovato,
  grado riquadro; non trovato, grado pagina.

### 3.3 Chi aggancia l'evidenza alla riga

L'estrattore, nel momento in cui trova il valore. In `estrazioneConferma.ts`
l'helper `evidenza(pagine, pagina, indice, lunghezza, …)` conosce già
l'indice di carattere del match nella pagina: scrive `posizione`. Le righe
di merce (`estrazioneMerce.ts`) conoscono l'indice della riga. Il riscontro
(`riscontroCommessa.ts`) localizza la parola o la riga che ha provato la
commessa. Un localizzatore puro (`server/documenti/localizzatore.ts`)
trasforma posizione o frammento in `PosizioneEvidenza` usando la geometria:
`localizzaOffset` per la geometria allineata, `localizzaFrammento` per
quella non allineata. Nessuna ricerca a posteriori del frammento sul testo
quando la posizione è nota: lo stesso «7.762,25» può comparire due volte
nella stessa pagina.

Per il contratto la verifica dell'evidenza (`contratti/estrazione/evidenze.ts`)
è già una ricerca del frammento citato dal modello nel testo: restituisce
anche gli scarti, e il servizio li trasforma in area con la geometria.

### 3.4 Dove si salva

| Valore letto | Dove sta | Cosa si aggiunge |
|---|---|---|
| Imponibile, totale, fornitore, numero, data, riferimento, consegna/approntamento, prove del riscontro | `Documento.letturaCosto` (`preventivi_documenti`) | `evidenze` per campo, con area |
| Costo in `costi[]` | commessa, `documentoId` | niente: il tasto legge dal documento |
| Righe merce | `magazzino_prodotti`, `documentoId` | `evidenza` sulla riga (pagina, frammento, area), default `null` |
| Campi e righe del contratto | `contratto_estrazioni.proposta` (JSONB) e righe applicate (`contratto_righe.evidenza` JSONB) | `area` dentro l'evidenza già presente |
| Segnali del collegamento a ordine | `documenti_collegamenti_ordini.motivazioni` + candidati calcolati | area nelle evidenze dei segnali |
| Analisi D7 | `documenti_analisi.estrazione` | area nelle evidenze, senza UI |

### 3.5 Versioni

Parser nativo 2.0.0 → 2.1.0 (testo identico, geometria a fianco). OCR
invariato (testo identico). Estrattore conferme 1.1.0 → 1.2.0, merce 1.2.0
→ 1.3.0, lettura costo 1.8.0 → 1.9.0: il worker rilegge tutte le conferme
in fascicolo e riempie le evidenze; i costi non cambiano (uno modificato a
mano non si tocca, uno nato dalla regola resta uguale). Il contratto non
cambia prompt: l'area nasce dalla geometria; le proposte vecchie mostrano la
pagina intera finché non si preme «Rileggi».

## 4. Immagini di pagina e rotta

- **Quando**: quando i byte sono già in mano — dopo la lettura del worker
  costi, della lettura contratto e dell'analisi D7 — e a richiesta per i
  documenti letti prima (prima apertura: si scarica il file, si rendono
  tutte le pagine, al massimo venti, in un colpo; chiamate concorrenti
  condividono lo stesso rendering).
- **Come**: pdftoppm a 150 dpi in JPEG qualità 75 (150–250 KB a pagina),
  estendendo `renderizzaPaginePng` con formato e qualità: argomenti fissi,
  mai shell, cartella temporanea sempre rimossa, timeout 60 s, una coda
  piccola separata dall'OCR. Le foto non si rendono: l'immagine è il
  documento. HEIC fuori ambito.
- **Dove**: object storage via `putFile`, chiave
  `anteprime/<sede>/<documento>/<checksum>/p<N>.jpg`; sul documento solo un
  metadato `anteprime: { versione, dpi, pagine }` con default `null`. Le
  anteprime sono derivate e rigenerabili: cancellate col documento
  (best-effort), escluse dal backup.
- **Rotta** `GET /api/documenti/:id/pagina/:n`, sorella di quella del file
  in `server/_core/commessaFileRoutes.ts`: stessa origine, cross-site
  bloccato, autenticazione, documento nella sede attiva o `404`, pagina
  fuori intervallo `404`, `503` con motivo breve se il rendering fallisce.
  `ETag` = impronta e numero, `Cache-Control: private, max-age=86400`.
- **Ritaglio lato client**: `<img>` della pagina in una scatola con
  overflow nascosto, spostata con `transform` dall'area normalizzata;
  rettangolo del frammento come `div` assoluto. Nessuna libreria immagini.
- **Limiti**: 15 MB e 20 pagine (gli stessi dell'analisi); oltre, il tasto
  apre solo il PDF.

## 5. Superfici

Un componente solo, `client/src/components/documenti/DoveLetto.tsx`: riceve
documento, evidenza, fonte del testo e, se serve, valore letto e valore
attuale. Prende l'evidenza inline quando la pagina ce l'ha (proposta e righe
del contratto, segnali del collegamento, righe di magazzino) oppure a
richiesta con la query `preventiviContratti.evidenzeDocumento(documentoId)`,
che restituisce le evidenze di `letturaCosto`, con la guardia del file:
utente della sede e commessa leggibile.

| Superficie | Dato |
|---|---|
| Scheda commessa, margine, righe di costo «da conferma d'ordine» | imponibile |
| Stesso pannello, «conferme senza costo» | prova del riscontro, motivo |
| Registro conferme (`/conferme-ordine`), tabella e schede mobile | imponibile, fornitore, riferimento, prove |
| Magazzino e card consegne della commessa | ogni riga di merce nata da una conferma |
| Dialog «Leggi il contratto», ogni campo e rata | tutti i campi proposti |
| Contratto applicato (tab e editor di riga) | righe con origine estrazione |
| Dialog «Collega a un ordine» | ogni segnale |
| Tars, thread e proposte | seconda tornata |

Telefono: vignetta a tutta larghezza meno i margini, tetto 45 % dell'altezza,
tasto con area di tocco 40 px, nessuno scroll orizzontale nuovo.

## 6. Flag, rollout, test

- Interruttore nuovo fail-closed `FLAG_ANTEPRIME_EVIDENZE` (`anteprimeEvidenze`):
  governa rotta, rendering nei worker e visibilità del tasto via
  `platform.interruttori`. Riga nel runbook e in `.env.example`.
- Passi: (0) `#page=N` sui link esistenti; (1) geometria, posizioni,
  localizzatore, metrica «evidenze localizzate» nell'eval; (2) rendering,
  storage, rotta dietro flag; (3) lettura costo 1.9.0, zero costi cambiati
  nei log; (4) UI dal dialog contratto in poi; (5) browser 1440×900 e
  390×844, console pulita.
- Test: geometria allineata riga per riga sulle fixture di `testoPdf.test.ts`
  e pagina ruotata; `parseTsv` con riquadri; localizzatore su nativo, OCR,
  frammento doppio e fuzzy; estrattori con posizione sui layout reali;
  `letturaCosto.evidenze` sulle fixture `pdfConTesto`; rilettura 1.9.0 che
  non tocca un costo; proposta contratto con aree; rotta e rendering con
  salto se i binari mancano; eval con la metrica nuova senza soglia.

## 7. Fuori ambito

Conversione HEIC; posizione grossolana chiesta al modello; coda unica «Da
verificare»; link dalla chat di Tars; UI per le analisi D7 (non esiste);
il modello che estrae i campi (discorso separato, questa spec vale con gli
estrattori deterministici di oggi).
