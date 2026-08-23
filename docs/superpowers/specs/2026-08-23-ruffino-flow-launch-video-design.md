# Ruffino Flow Launch Video - Design Specification

Data: 23 agosto 2026

## Obiettivo

Creare un Reel sponsorizzato verticale da 30 secondi per il lancio di Ruffino
Flow. Il video deve presentare il prodotto come piattaforma operativa multisede
per aziende di serramenti e mostrare Tars come il cervello che collega i dati e
propone le priorita. Deve parlare sia ai titolari sia ai team operativi.

Messaggio principale:

> Ruffino Flow. Il CRM con un cervello.

Il video non usa persone, voce narrante, immagini generate dall'AI o pannelli
software immaginari. Il racconto usa tipografia, schermate autentiche del CRM,
motion design e sound design originale.

## Formato e consegne

- Master: MP4 H.264, 1080x1920, 30 fps, durata 30 secondi.
- Audio: AAC stereo, 48 kHz, picco massimo -1 dBFS.
- Cover: JPG 1080x1920 ricavata dal frame finale.
- Sorgente: composizione Remotion versionata nel repository.
- Output locale: `marketing/ruffino-flow-launch/output/` escluso da Git.
- Il master deve essere compatibile con Instagram Reel, Facebook Reel e TikTok.

## Direzione creativa

Nome: **Editorial Intelligence**.

La base e editoriale, precisa e concreta, circa 85% della direzione Precision AI.
Da Neural Flow arriva solo il 15%: profondita controllata, luce e un sottile filo
cromatico che collega le informazioni. Il video non deve sembrare creato da un
generatore AI.

Regole visive:

- fondo chiaro minerale, nero grafite e giallo segnale come base;
- gradiente corallo, arancio e giallo usato solo come filo narrativo o accento;
- Plus Jakarta Sans, coerente con il prodotto;
- schermate squadrate con raggi contenuti, bordi netti e ombre corte;
- transizioni basate su maschere, crop, pan, zoom e continuita spaziale;
- niente glitch, particelle, orbite, circuiti, blob, glassmorphism dominante o
  interfacce sospese senza funzione;
- niente cursore finto: le azioni vengono evidenziate con focus, selezioni e
  cambi di stato dell'interfaccia;
- il testo rimane nella safe area centrale e leggibile su schermi piccoli.

## Struttura narrativa

Il ritmo parte misurato, accelera mentre le fonti si collegano e raggiunge il
picco nella scena Tars. Ogni scena introduce un fatto concreto e confluisce
nella successiva; non deve sembrare una lista di funzionalita.

| Tempo | Scena | Testo principale | Prova visiva |
|---|---|---|---|
| 0-3 s | Hook | `Non ti serve un altro gestionale.` | Dashboard Ruffino Flow che entra con un crop verticale deciso. |
| 3-6 s | Multisede | `Una regia. Tutte le sedi.` | Selettore sede e tre sedi operative nello stesso sistema. |
| 6-11 s | Comunicazioni | `Ogni conversazione trova il suo contesto.` | Chat WhatsApp ed email raggruppate, poi collegate a cliente e commessa. |
| 11-16 s | Flusso operativo | `Dal primo contatto al post-vendita.` | Cliente, commessa, cantiere, planning e post-vendita come tappe continue. |
| 16-19 s | Amministrazione | `Fatture e dati sempre allineati.` | Fattura FiC collegata alla commessa, pagamenti e documento nel fascicolo. |
| 19-21 s | Continuita | `Il lavoro resta protetto.` | Stato backup completato e storage verificato. |
| 21-27 s | Tars | `Tars incrocia tutto. E ti dice dove agire.` | Command Center con priorita motivata e fonti WhatsApp, email, FiC, calendario, cliente, commessa e post-vendita. |
| 27-30 s | Lancio | `Ruffino Flow. Il CRM con un cervello.` | Logo, payoff e CTA `Richiedi una demo`. |

I testi secondari devono essere brevi e comparire solo quando aggiungono una
prova. Nessun frame deve contenere piu di un titolo, una riga di supporto e un
focus UI principale.

## Superfici di prodotto

La composizione usa componenti e token reali del CRM con dati promozionali
sintetici. Le superfici da rappresentare sono:

1. Dashboard e selettore multisede.
2. Conversazioni WhatsApp raggruppate per cliente.
3. Email con collegamento a cliente o commessa.
4. Dettaglio commessa con fattura, pagamenti e documenti.
5. Planning/calendario, cantiere e post-vendita.
6. Stato backup e integrazioni.
7. Tars Command Center con priorita, motivazione e fonti.

Non si catturano schermate della produzione con clienti reali. Le UI del video
sono ricomposte da componenti, stili e pattern del prodotto con nomi, importi,
numeri e messaggi fittizi. Nessun dato derivato dal database Railway entra negli
asset o nei frame renderizzati.

## Architettura di produzione

La produzione vive in `marketing/ruffino-flow-launch/` ed e isolata dal bundle
del CRM. Remotion viene aggiunto come dipendenza di sviluppo del workspace.

Struttura prevista:

```text
marketing/ruffino-flow-launch/
  assets/             logo, texture e audio originali
  src/
    Root.tsx          registrazione composizioni
    LaunchVideo.tsx   timeline principale
    scenes/           una scena per beat narrativo
    ui/               superfici CRM promozionali con dati sintetici
    motion/           transizioni, easing e safe-area condivisi
    theme.ts          token del video derivati dal prodotto
  scripts/            generazione audio e controlli del render
  output/             master e cover, non versionati
```

Le scene ricevono solo dati statici e non eseguono richieste tRPC, accessi al
database o letture di segreti. Il render e deterministico: stesso commit, stessi
asset, stesso output visivo.

Script workspace previsti:

- `pnpm promo:studio`: anteprima Remotion del video.
- `pnpm promo:render`: render MP4 e cover.
- `pnpm promo:check`: verifica durata, dimensioni, frame e assenza di dati vietati.

## Motion design

- 30 fps con easing condivisi, senza animazioni dipendenti dal tempo reale.
- Entrate testuali da 8-12 frame, hold sufficiente alla lettura e uscite brevi.
- Pan e zoom delle UI limitati per mantenere testo e contenuti leggibili.
- Il filo cromatico attraversa le scene Comunicazioni, Amministrazione e Tars,
  mostrando che le fonti diventano contesto.
- La scena Tars non usa metafore di cervelli o reti neurali: mostra una priorita,
  la motivazione e le fonti verificabili.
- Il frame finale resta stabile almeno 2 secondi per logo, payoff e CTA.

## Audio

Nessuna voce narrante. La colonna sonora e originale e minimale, con impulso
elettronico caldo, percussione asciutta e crescita progressiva. Il sound design
usa click UI discreti, due transizioni, un impatto sulla comparsa di Tars e una
chiusura pulita sul logo.

Gli asset audio sono generati o composti per il progetto e non richiedono
licenze esterne. Il mix non deve coprire la lettura: il ritmo sostiene i tagli,
non li detta in modo frenetico.

## Gestione errori e fallback

- Il render fallisce se mancano logo, font o audio richiesti.
- Ogni scena ha dimensioni e durata esplicite; nessuna dipende dal viewport.
- Se un componente del CRM non e importabile senza runtime applicativo, viene
  ricostruito nel modulo promozionale usando gli stessi token e pattern, senza
  copiare dati di produzione.
- Il video resta comprensibile senza audio.
- Il frame finale non contiene URL non confermati: la CTA e testuale.

## Verifica

Prima della consegna:

1. render completo 1080x1920 a 30 fps;
2. durata tra 29,8 e 30,2 secondi;
3. controllo di almeno un frame per ogni scena e dei frame di transizione;
4. verifica leggibilita su anteprima larga 390 px;
5. scansione testuale degli asset per nomi, telefoni, email e importi reali;
6. controllo che nessun testo esca dalla safe area o si sovrapponga alla UI;
7. verifica audio per clipping e presenza di tutte le cue;
8. riproduzione completa del master MP4;
9. `pnpm check`, `pnpm test` e `pnpm build` del CRM invariati dopo l'aggiunta;
10. revisione visiva finale del master e della cover.

## Fuori perimetro

- versioni 16:9 o 1:1;
- speaker, attori o riprese reali;
- invio automatico delle campagne social;
- landing page di lancio;
- modifica delle funzionalita del CRM;
- utilizzo di dati o credenziali di produzione.
