# Frame & Flow — Motion

> Il movimento è parte dell'identità: vivo e reattivo, mai teatrale. Ogni
> animazione ha uno scopo (origine, cambiamento, conferma, progresso);
> quello che non ne ha uno, non esiste.

## 1. Due categorie

- **Produttivo** (interazioni frequenti: hover, press, menu, tab, righe,
  filtri, pannelli): rapido, quasi istintivo.
- **Espressivo** (momenti rari: primo ingresso dopo login, apertura dossier
  commessa, avanzamento reale di stato, proposta Tars approvata, cambio
  tema): riconoscibile, mai spettacolarizzato.

## 2. Token temporali

Estendono i `--duration-*`/`--ease-*` già in `index.css` (che restano per
compatibilità v1):

| Token | Valore | Uso |
|---|---|---|
| `--duration-instant` | 90ms | feedback immediato (latch, toggle) |
| `--duration-fast` | 150ms | microinterazioni, hover, menu |
| `--duration-base` | 220ms | componenti: dialog, drawer, tab |
| `--duration-slow` | 320ms | transizioni spaziali, reveal |
| `--duration-expressive` | 450ms | momenti rari; tetto ordinario 500ms |
| `--ease-standard` | `cubic-bezier(.2,.8,.2,1)` | default |
| `--ease-enter` | `cubic-bezier(.16,1,.3,1)` | ingressi |
| `--ease-exit` | `cubic-bezier(.5,0,.75,.2)` | uscite (durata ≈70% dell'ingresso) |

Regole di gerarchia per schermata: max 1–2 animazioni ad alta salienza
simultanee; nessun loop permanente; il feedback essenziale è immediato e
non aspetta la fine dell'animazione; nessuna logica su `animationend`;
tutto interrompibile (10 toggle rapidi non rompono il componente).

## 3. Firme

- **Frame reveal** — opacità + translate 6–10px + comparsa di uno/due bordi
  strutturali. Solo su record, dashboard e momenti di contesto. CSS-only
  (`@keyframes rf-frame-reveal`), niente su liste lunghe.
- **Rail progress** — l'avanzamento reale anima `transform: scaleX` lungo il
  rail; il mount NON anima (si anima solo il cambiamento di valore).
- **Latch feedback** — press: `scale(0.98)` + variazione surface/border,
  ritorno rapido. Mai spostare il layout.

## 4. Proprietà ammesse

Percorsi frequenti: solo `transform` e `opacity`. Con cautela: `color`,
`box-shadow`, `clip-path` su superfici piccole. Vietati nei percorsi
frequenti: `width/height/top/left`, blur ampi, `will-change` permanente.

## 5. Cosa NON si anima

React Query refetch, tabelle intere ad aggiornamento, KPI da zero a ogni
mount, elementi già presenti, background, scroll/parallax, shimmer
aggressivo, typing dots senza informazione. Stagger: solo 6–8 elementi al
primo ingresso di una dashboard, ritardo minimo, mai su liste operative.

## 6. Reduced motion

`prefers-reduced-motion` già azzera tutto globalmente in `index.css` (kill
switch a 0.001ms) e `PageContainer` usa `useReducedMotion`: la v2 conserva
entrambi. In modalità ridotta: crossfade brevissimo o cambio secco, nessuna
informazione o azione persa, stati intermedi importanti sempre visibili.
Se si aggiungerà la preferenza in-app «Animazioni: Sistema/Ridotte», non
potrà mai forzare il movimento contro la preferenza OS.

## 7. Implementazione

Ordine di preferenza: CSS transitions → CSS animations → Web Animations
API → View Transition API come progressive enhancement (cambio tema).
**Framer Motion è già in bundle** (PageContainer, DashboardLayout,
LoginPage, Dashboard): si continua a usarlo dov'è già pagato
(AnimatePresence delle route, Kanban FLIP se serve), senza importarlo in
nuovi chunk di pagina. Niente nuove librerie motion: qualsiasi eccezione
richiede ADR con peso gzip, impatto chunk e confronto con CSS.

Transizioni specifiche progettate (implementazione nelle rispettive slice):
route crossfade minimo (esiste, si tara sui nuovi token), command palette
che nasce dal trigger, drawer direzionale, dialog scale .98→1, tab
indicator continuo, toast rapido con Undo sempre immediato, Kanban con
optimistic move e **ritorno visibile al rollback**, avanzamento rail su
transizione reale, upload con progresso vero, skeleton sagomato solo al
primo caricamento, Tars con fasi reali dichiarate dal server (mai progress
finto), tema chiaro/scuro con fallback immediato.
