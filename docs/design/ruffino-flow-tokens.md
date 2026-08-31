# Frame & Flow — Token

> **Direzione estetica superata (31/08/2026).** I valori e le firme visuali
> Frame & Flow sono sostituiti dal master prompt v3 “Modular Control /
> Borgogna Operativa”. Restano utili soltanto le note tecniche o storiche che
> non confliggono con il codice corrente. Fonte vincolante:
> master-prompt-ruffino-flow-ui-ux-v3.md.

> Architettura e valori dei token UI v2. Ogni coppia testo/sfondo qui sotto
> è passata dal calcolo WCAG (script ripetibile: relative luminance sRGB):
> **59/59 controlli ≥ soglia** — testo normale ≥4,5:1, confini di controllo
> e focus ≥3:1, entrambi i temi. Rifare il calcolo a ogni ritocco.

## 1. Architettura

Tre livelli, integrati con Tailwind 4 (`@theme` in `client/src/index.css`):

1. **Primitivi** `--rf-*`: scala colore, spaziatura, radius, durate, easing.
   Non si usano mai direttamente nei componenti.
2. **Semantici**: `canvas`, `surface`, `surface-2`, `surface-raised`,
   `text-1/2/3`, `border-soft`, `border-strong`, `brand`, `on-brand`,
   `brand-soft`, `structure` (petrolio), `success/warning/danger/info`
   (+`-soft`), `focus`, `selected`. Le utility Tailwind esistenti
   (`bg-surface`, `text-text-2`, `border-border-soft`…) **mantengono il
   nome**: sotto flag cambia il valore, non la classe — è ciò che rende il
   rollback un semplice spegnimento.
3. **Componente**: button, input, table, sidebar, dialog, rail, pannello
   Tars — introdotti insieme al componente che li consuma.

Meccanismo di attivazione: quattro quadranti espliciti in `index.css` —
`:root` (v1 light), `.dark` (v1 dark), `[data-ui-v2]` (v2 light),
`[data-ui-v2].dark` (v2 dark). I blocchi v2 ridefiniscono **ogni** token
che toccano in entrambi i temi: nessun token può «trapelare» dal quadrante
sbagliato. L'attributo lo mette il client leggendo
`platform.interruttori.uiV2`.

## 2. Palette v2 — light

| Token | Valore | Note di verifica |
|---|---|---|
| canvas | `#F5F3ED` | fondo pagina, osso caldo |
| surface | `#FDFCF8` | card e pannelli |
| surface-raised | `#FFFFFF` | popover, dialog |
| surface-2 (sunken) | `#EFECE3` | pozzetti, code, chat |
| text-1 (ink) | `#211E18` | 16,2:1 su surface |
| text-2 | `#544E42` | 8,0:1 su surface |
| text-3 | `#6E6758` | 5,5:1 su surface, 4,75:1 su surface-2 |
| border-soft | `#E2DCCE` | separatori decorativi |
| border-strong | `#8F8672` | confini di controllo: 3,5:1 su surface, 3,25:1 su canvas |
| brand (giallo Ruffino) | `#F2B705` | accento firmato |
| on-brand | `#231B00` | 9,4:1 sul giallo |
| brand-soft | `#FBECC3` | con testo `#5C4A05` (7,3:1) |
| structure (petrolio) | `#176B68` | 6,1:1 come testo su surface; on-structure `#FFFFFF` (6,3:1) |
| structure-soft | `#DDEEEC` | |
| focus | `#176B68` | 5,7:1 su canvas, 6,1:1 su surface |
| success / -soft | `#1B7350` / `#E1F2E9` | 5,7 / 5,0 |
| warning / -soft | `#8A5800` / `#FAEECF` | 5,9 / 5,2 — ambra, NON è il giallo brand |
| danger / -soft | `#B3373D` / `#F9E4E4` | 5,8 / 4,9 |
| info / -soft | `#31649F` / `#E4EDF8` | 5,9 / 5,1 |

## 3. Palette v2 — dark (progettata, non invertita)

| Token | Valore | Note |
|---|---|---|
| canvas | `#171511` | |
| surface | `#1E1C17` | |
| surface-raised | `#26231D` | |
| surface-2 | `#131109` | |
| text-1 | `#F5F1E6` | 15,1:1 |
| text-2 | `#C4BCAC` | 9,0:1 |
| text-3 | `#9A9282` | 5,5:1 su surface, 5,1:1 su raised |
| border-soft | `#3B382F` | |
| border-strong | `#6E6754` | 3,0:1 su surface |
| brand | `#F4C430` | on-brand `#231B00` (10,4:1) |
| brand-soft | `#3A3010` | testo `#F0D584` (9,0:1) |
| structure | `#4FB3AB` | 6,8:1 come testo; on-structure `#092422` (6,5:1) |
| focus | `#5FBCB4` | 7,6:1 su surface |
| success / -soft | `#63C797` / `#12291E` | 8,2 / 7,5 |
| warning / -soft | `#E3B455` / `#33280F` | 8,9 / 7,5 |
| danger / -soft | `#F09A93` / `#3A1F1D` | 7,9 / 7,0 |
| info / -soft | `#8FB6E8` / `#1A2737` | 8,1 / 7,2 |

Ombre dark: quasi assenti; la profondità la fanno surface e border.
I quattro `--gradient-*` v1 in v2 valgono `none`/tinta piatta.

## 4. Famiglie di stato (11 stati → 7 famiglie + archivio)

Le etichette reali non cambiano mai; cambia il raggruppamento cromatico.
Ogni stato ha testo, posizione nel rail e descrizione accessibile: il
colore è il segnale secondario.

| Famiglia | Stati | Pieno / soft (light) |
|---|---|---|
| Commerciale | `preventivo` | `#31649F` / `#E4EDF8` |
| Tecnico | `misure_esecutive` | `#6A4FA3` / `#EDE7F7` |
| Amministrativo | `aggiornamento_contratto`, `fatture_pagamento` | `#A03E64` / `#F8E6EE` |
| Approvvigionamento | `da_ordinare` | `#8A5800` / `#FAEECF` |
| Produzione/logistica | `produzione`, `ordini_ultimazione` | `#0F7568` / `#DDF0ED` |
| Posa | `attesa_posa`, `finiture_saldo` | `#1B7350` / `#E1F2E9` |
| Post-vendita | `interventi_regolazioni` | `#B3373D` / `#F9E4E4` |
| Chiuso | `archiviata` | `#5D5A50` / `#EBE8DF` |

Tutti verificati ≥4,5:1 su surface e sul proprio soft. Le varianti dark si
derivano con lo stesso criterio delle semantiche (chiarite, soft scuri).
I token calendario (`--color-cal-*`) seguono le stesse famiglie.

## 5. Tipografia

- `Plus Jakarta Sans Variable` confermato (già caricato); JetBrains Mono
  per codici. Nessun font nuovo.
- Scala: H1 `clamp(24px,2vw,30px)/1.15/700` · H2 22/1.25/650 · H3 17–18/600
  · body desktop 15/22 · body mobile 16/24 (input mobile mai <16px, evita
  lo zoom iOS) · label 13/18 · micro 12/16.
- `tabular-nums` obbligatorio per euro, date, misure, codici, tabelle, KPI
  (regola globale già presente su `th/td`, estesa ai KPI).
- La base body passa da 14px (v1) a 15px (v2 desktop) sotto flag.

## 6. Spaziatura, radius, elevazione

- Scala 4px: 2·4·6·8·12·16·20·24·32·40·48·64; gutter `clamp(16px,2vw,32px)`.
- Radius: controlli 8–10, card 12–14, dialog/sheet 16–18, pill solo chip.
  (La scala v1 8/10/12/14 è già conforme: si aggiunge `--radius-2xl: 18px`
  per i soli dialog.)
- Elevazione: 4 livelli (flat, raised, floating, dialog); ombre calde a
  bassa opacità, mai per gerarchia quotidiana — prima border e surface.

## 7. Densità

- `comfortable` default; `compact` per tabelle/code desktop con puntatore
  (riga 36→32px, padding ridotti); mobile sempre touch-safe (44px, azioni
  critiche 48px). Implementata come attributo di contenitore, mai riduce
  focus o target sotto soglia.

## 8. Icone

Lucide unica famiglia; taglie 16/18/20/24, stroke 1,75–2. Ammesso un
micro-set SVG proprietario (serramento, rilievo, posa, apertura, vetro,
conferma ordine) disegnato a mano, stesso stroke, revisionato come codice.
Niente emoji.
