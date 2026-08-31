# Frame & Flow — Matrice delle pagine

> Route reali @ `de0ce77` (26 pagine + redirect). Archetipi: D=Dashboard,
> R=Record 360, W=Workbench, Q=Queue/Inbox, F=Form/Flow. Accesso: chi vede
> la voce/route (il server resta l'autorità; qui si evita il link morto).
> «Slice» = ordine di migrazione v2 (G=golden screen).

| Route | Pagina (righe) | Archetipo | Accesso | Mobile | Slice |
|---|---|---|---|---|---|
| `/` | Dashboard (1036) | D | tutti (contenuto per ruolo) | riflow nativo | **G1** |
| `/tars` | Tars (504) | D/Q | flag `tars` acceso | single-pane | **G4** |
| `/clienti` | ClientiList | Q/lista | tutti | record card P0/P1 | 4 |
| `/clienti/:id` | ClienteDetail | R | tutti | sezioni progressive | 4 |
| `/commesse` | CommesseList | lista | tutti | record card | 4 |
| `/commesse/:id` | CommessaDetail (**3537**) | R | tutti (economia per capability) | header compatto + rail + sticky bar | **G2** |
| `/commesse/:cid/aperture/:aid/rilievo` | RilievoDetail | F | tutti | **mobile-first** | **G5** |
| `/kanban` | KanbanBoard (724) | W | tutti | lista per fase + «Sposta in…» | **G3** |
| `/planning` | Planning | W | tutti | agenda oggi/domani | 6 |
| `/magazzino` | Magazzino | W | tutti | card ricezioni | 8 |
| `/fornitori` | FornitoriList | W (master-detail + DI) | direzione | consultazione | **G6** |
| `/pagamenti` | Pagamenti | Q/lista | capability `pagamento.read` | P0 residuo | 9 |
| `/economia` | Economia | D economica | direzione+amministrazione | riflow | 9 |
| `/marginalita` | Marginalita | D economica | direzione | riflow | 9 |
| `/verbale/:interventoId` | VerbaleChiusura | F | tutti | **full-screen mobile** | **G5** |
| `/ticket` | TicketList | Q | tutti | queue per priorità | 11 |
| `/reclami` | ReclamiRifacimenti | Q | tutti | queue | 11 |
| `/garanzie` | GaranzieList | lista | direzione | consultazione | 11 |
| `/squadre` | SquadreList | lista | lettura tutti, gestione direzione | card | 6 |
| `/messaggi/email` | EmailPage | Q master-detail (≥1280) | tutti | single-pane | 10 |
| `/messaggi/whatsapp` | WhatsAppPage | Q | tutti | single-pane, **read-only: nessun composer** | 10 |
| `/chat` | ChatAziendale | Q | tutti | single-pane | 10 |
| `/notifiche` | Notifiche | Q | tutti | lista | 10 |
| `/preventivatori` (+2 figli) | Preventivatori/Fivizzanese/PuntoDelSerramento | F | tutti | larghezza controllata | 12 |
| `/archivio` | Archivio | lista | tutti | card | 12 |
| `/conoscenza` | Conoscenza | F | direzione | — | 13 |
| `/utenti` | UtentiList | lista+form | direzione | — | 13 |
| `/sedi` | SediList | lista+form | direzione | — | 13 |
| `/integrazioni` | Integrazioni (hub Impostazioni) | F/hub | tutti (sezioni per ruolo) | sezioni | 13 |
| `/produzione/*` | **redirect** → `/kanban` | — | — | — | intoccabile (test) |
| `/comunicazioni` | redirect legacy → messaggi | — | — | — | intoccabile |
| `/404`, fallback | NotFound | — | — | — | 13 |

## Stati dati (matrice trasversale)

Ogni pagina migrata deve dimostrare: primo caricamento (skeleton sagomato),
refetch discreto (mai ri-animare), empty specifico vs zero reale, errore
con retry, errore parziale, permesso negato ≠ not found ≠ omissione per
capability, integrazione/flag spenti (Tars, DI, provider, budget), upload/
elaborazione, successo/rollback. Freschezza dichiarata dove il dato invecchia
(«Ultimo aggiornamento N minuti fa» — pattern già presente in Economia/FiC).

## Shell (trasversale, prima slice)

Sidebar chiara «recessiva» (canvas) con gruppi attuali, sede, ruolo; voce
Tars sotto flag come oggi. Context bar con ⌘K/Ctrl+K («Cerca clienti,
commesse o azioni…», gruppi Recenti/Naviga/Crea/Azioni pagina/Ricerca/
«Chiedi a Tars» esplicito, capability-filtered, zero chiamate al provider
durante la digitazione). Bottom nav mobile role-aware (max 5). Campanella =
anteprima; Centro Azioni resta la coda completa.
