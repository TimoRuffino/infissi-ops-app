# Frame & Flow — Responsive

> Il responsive non è «desktop ristretto». Tre contesti progettati:
> scrivania (ufficio), tablet (showroom/furgone), telefono (cantiere, sole,
> guanti, una mano).

## 1. Viewport di verifica

320 · 360 · 375 · 390 · 430 · 640 landscape · 768 · 834 · 1024 · 1280 ·
1440 · 1728. Più: tastiera mobile aperta, safe-area (notch/gesture bar),
zoom 200%, reflow 400%/320px, light/dark, reduced motion. I gate minimi da
CLAUDE.md restano: **1440×900 e 390×844 nel browser prima di chiudere ogni
modifica visuale**.

## 2. Griglie e container query

Desktop 12 col · tablet 8 · mobile 4; gutter `clamp(16px,2vw,32px)`.
Componenti riusati dentro sidebar/pannelli/dialog/split usano container
query (`@container`), non solo breakpoint viewport — un `MobileRecordCard`
dentro un inspector stretto su desktop si comporta come su telefono.

## 3. Desktop

- Sidebar espansa 252–268px (oggi 280 ridimensionabile: il resize resta),
  collassata 72–80px; la navigazione recede rispetto al contenuto.
- Context bar compatta: identità pagina, ricerca/comandi (⌘K), sede,
  notifiche, azione primaria, accesso a Tars.
- Pagine dati a larghezza piena; form e testo lungo con max-width; **mai**
  max-width artificiale su Kanban e tabelle operative (oggi `.container`
  impone 1320px sopra i 1024: in v2 i workbench ne escono).

## 4. Tablet

Rail + drawer; split view solo se entrambi i pannelli restano leggibili
(la soglia email 1280px esistente è già giusta); inspector richiudibile;
toolbar che rifluisce. Mai un desktop compresso.

## 5. Mobile

**Bottom navigation role-aware, max 5 voci** (novità v2, sotto flag):
Home · Board o Agenda (secondo ruolo) · Azioni · Tars (se flag acceso) ·
Altro. Posizioni stabili, `env(safe-area-inset-bottom)` rispettato.

- Target 44×44 minimo, azioni critiche 48px; uso a una mano; azioni
  principali sticky in basso.
- Nessun hover indispensabile; niente informazioni solo nei tooltip.
- `inputMode` corretto (misure numeriche, telefoni), niente input <16px.
- Upload con progresso, cancel, retry; errori recuperabili; cambio
  orientamento senza perdita dati.
- **Niente finto offline**: connessione assente e invii falliti si
  dichiarano con retry; una bozza locale si promette solo se implementata
  e testata.

## 6. Priorità P0/P1/P2 per entità (mobile)

| Entità | P0 (decidere) | P1 (operare) | P2 (espandibile) |
|---|---|---|---|
| Commessa | codice, cliente, stato+prossimo passo, alert gate | responsabile, date chiave, cantiere | prodotti, documenti, attività |
| Cliente | nome/ragione sociale, telefono (tap-to-call) | indirizzo, commesse aperte | storico, documenti |
| Rilievo/apertura | apertura corrente, misure mancanti | foto, note, criticità | dettagli serramento |
| Ordine fornitore | fornitore, stato rail, ritardo | qtà ordinata/ricevuta, consegna prevista | righe, documenti, DI |
| Intervento posa | oggi/prossimo cantiere, indirizzo, contatto | checklist, materiali mancanti | verbale, foto, anomalie |
| Ticket | urgenza/SLA, cliente | prossimo passo, assegnatario | storia, evidenze |
| Comunicazione | mittente, oggetto, stato coda | collegamenti, allegati | corpo completo |
| Pagamento (autorizzati) | residuo, ultima operazione | righe registro | dettaglio riconciliazione |

Nessuna tabella diventa card «automaticamente»: ogni lista mobile sceglie
le sue P0/P1 da questa matrice.

## 7. Scroll

Lo scroll orizzontale vive solo dentro contenitori semanticamente
bidimensionali (Kanban, calendario, tabelle tecniche, viewer PDF), mai a
livello pagina. Regola esistente confermata: niente wrapper `overflow-x-auto`
attorno alle tabelle con header sticky (regressione storica documentata nel
PRD §29.3 — gli sticky si rompono); le colonne secondarie si nascondono
progressivamente.
