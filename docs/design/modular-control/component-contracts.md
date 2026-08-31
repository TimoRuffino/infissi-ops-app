# Modular Control — contratti dei componenti condivisi

**Stato:** contratto di implementazione · **Fonte:** master prompt v3

Questi componenti normalizzano presentazione e interazione; non diventano mai
un confine di autorizzazione o una seconda fonte di verità. I dati e le azioni
continuano a provenire dai router tRPC sede-scoped e dalle capability effettive.

## Regole comuni

- Tutte le varianti sono finite e tipizzate; nessuna prop accetta classi o
  colori pagina-specifici come sostituto di una variante.
- Stati minimi quando pertinenti: loading, ready, empty, error, forbidden,
  unavailable e stale. Un’assenza autorizzativa non è un empty state.
- Colori, spaziatura, radius, ombre e motion usano soltanto token semantici di
  client/src/index.css.
- Focus visibile, target touch di almeno 44 px nei regimi touch e
  prefers-reduced-motion sono obbligatori.
- Regimi: mobile fino a 767 px; tablet 768–1199 px; desktop da 1200 px. Il
  componente può refloware, ma non può creare scroll orizzontale globale.

## AppShell

| Dimensione      | Contratto                                                                                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input           | children; generation legacy/modular-control; user; activeSede; capabilities; flags; currentRoute; notification summary; onNavigate; onSwitchSede; onLogout; onOpenCommand. |
| Varianti finite | legacy, modular-control; desktop, tablet, mobile derivate dal viewport e non impostate dalle pagine.                                                                       |
| Stati           | auth-loading, unauthenticated, context-loading, ready, sede-switching, context-error. Durante un cambio sede il contenuto precedente non può sembrare ancora attivo.       |
| Token           | chrome, canvas, surface, sunken, ink, muted, border-subtle, border-control, brand, focus, shell-width e safe-area.                                                         |
| Tastiera        | skip link al main; Tab in ordine rail → context bar → main; Escape chiude overlay; Ctrl/⌘K apre la command palette solo quando abilitata.                                  |
| Breakpoint      | Desktop: rail + frame + context bar. Tablet: rail compatto o drawer senza perdere sede. Mobile: header breve + primary nav inferiore + drawer Altro.                       |
| Non-obiettivi   | Non decide route, capability, ruoli o query; non altera il DOM legacy con flag OFF; non monta Tars quando il kill switch è spento.                                         |

## PageHeader

| Dimensione      | Contratto                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Input           | eyebrow opzionale; title; description opzionale; breadcrumbs; primaryAction opzionale; secondaryActions; metadata; sticky mode.           |
| Varianti finite | standard, record, workbench, compact. Una sola primaryAction visiva.                                                                      |
| Stati           | default, busy, action-disabled, contextual-warning. Errori di pagina vivono in StatePanel, non nel titolo.                                |
| Token           | canvas/surface, ink/muted, brand/on-brand, border-subtle, spacing header e type scale.                                                    |
| Tastiera        | Breadcrumb e azioni nell’ordine visivo; pulsanti icon-only con aria-label e tooltip; sticky header non nasconde il focus.                 |
| Breakpoint      | Desktop: titolo e azioni sulla stessa fascia se leggibili. Mobile: titolo prima, azioni principali in StickyActionBar quando persistenti. |
| Non-obiettivi   | Non contiene KPI decorativi, filtri complessi, permessi o mutation.                                                                       |

## DataSurface

| Dimensione      | Contratto                                                                                                              |
| --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Input           | title opzionale; description; toolbar; children; footer; density; emphasis; state; statePanelProps.                    |
| Varianti finite | default, sunken, raised, focal; density comfortable, compact. Focal è raro e non implica automaticamente un gradiente. |
| Stati           | loading, ready, empty, error, forbidden, unavailable, stale. Ogni stato ha copy e azione di recupero espliciti.        |
| Token           | surface, sunken, raised, border-subtle, ink, muted, shadow-xs/sm; eventuale focal-gradient approvato.                  |
| Tastiera        | La surface non è focusabile di default; toolbar precede il contenuto; region label quando ha un titolo.                |
| Breakpoint      | Padding e toolbar reflowano; nessun fixed width. In mobile filtri secondari entrano in disclosure/drawer.              |
| Non-obiettivi   | Non crea card dentro card, non inventa metriche e non nasconde errori dietro placeholder vuoti.                        |

## DataTable

| Dimensione      | Contratto                                                                                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input           | columns tipizzate; rows; rowId; density; selection; sort; actions; caption; emptyState; mobileProjection; onRowOpen.                                                             |
| Varianti finite | compact, standard; selection none, single, multiple; mobileProjection stacked-row, key-value, dedicated-list.                                                                    |
| Stati           | loading skeleton, ready, empty, partial/stale, error; selected e disabled per riga.                                                                                              |
| Token           | surface, ink, muted, border-subtle, border-control, selected, focus, status semantic tokens; numeri tabulari.                                                                    |
| Tastiera        | Header ordinabile è button con aria-sort; Space seleziona; Enter apre solo se la riga dichiara onRowOpen; menu azioni raggiungibile senza rendere tutta la riga un falso button. |
| Breakpoint      | Desktop può avere header sticky e contenitore locale overflow-x. Mobile usa mobileProjection; mai min-width che allarghi la pagina.                                              |
| Non-obiettivi   | Non filtra autorizzazioni, non virtualizza per default, non trasforma ogni tabella in card e non esegue mutation.                                                                |

## StatusBadge

| Dimensione      | Contratto                                                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input           | family; label; size; emphasis; icon opzionale; accessibleDescription opzionale.                                                                    |
| Varianti finite | family neutral, info, success, warning, danger, brand, mora e famiglie di stato commessa; size sm, md; emphasis soft, solid.                       |
| Stati           | static, interactive soltanto quando è reso da un controllo esterno; unknown usa neutral con label reale, mai un colore casuale.                    |
| Token           | status foreground/background accoppiati e on-status; border semantic; nessun hex locale.                                                           |
| Tastiera        | Di base non focusabile. Se cambia stato, il controllo contenitore espone nome, stato corrente e destinazione. Il colore non è mai l’unico segnale. |
| Breakpoint      | Testo non viene abbreviato automaticamente; può andare a capo in mobile dove il dominio lo consente.                                               |
| Non-obiettivi   | Non decide mapping di dominio, transizioni, permission gate o copy.                                                                                |

## ContextInspector

| Dimensione      | Contratto                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input           | title; sections tipizzate; selectedEntity; actions; availability; open; onOpenChange; width preset.                                                           |
| Varianti finite | inline, side-panel, drawer; width narrow, standard, wide. La variante deriva dal regime shell salvo override documentato del workbench.                       |
| Stati           | closed, loading, ready, empty-selection, error, forbidden, unavailable, stale.                                                                                |
| Token           | surface-raised, sunken, border-subtle/control, ink/muted, overlay e focus.                                                                                    |
| Tastiera        | Drawer/dialog intrappola il focus e Escape chiude; inline segue l’ordine documento; al cambio selezione il titolo aggiornato è annunciato senza rubare focus. |
| Breakpoint      | Desktop inline o side-panel; tablet side-panel sovrapposto; mobile drawer/sheet quasi full-height con safe area.                                              |
| Non-obiettivi   | Non duplica il record completo, non conserva dati cross-sede, non diventa un pannello sempre aperto su mobile.                                                |

## TarsBriefing

| Dimensione      | Contratto                                                                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input           | briefing autorizzato; signals; evidence; omissions; proposals; availability; costVisibility; onOpenTars; onProposalAction.                          |
| Varianti finite | compact, panel, focal; availability ready, degraded, disabled, unavailable.                                                                         |
| Stati           | loading, ready, empty, degraded con motivo tipizzato, disabled, error. Le omissioni sono sempre visibili quando restituite.                         |
| Token           | focal-gradient consentito, dark-anchor/on-dark, brand, mora, success/warning/danger/info accoppiati, border-control.                                |
| Tastiera        | Titolo/summary precedono azioni; proposte L3 hanno controllo esplicito e conferma; nessuna chiamata mentre si digita; stato degradato è annunciato. |
| Breakpoint      | Desktop può usare pannello focale asimmetrico; mobile diventa sequenza briefing → segnali/evidenze/omissioni → proposte → composer.                 |
| Non-obiettivi   | Non approva proposte, non simula dati, non mostra costi senza capability, non monta query con FLAG_TARS spento.                                     |

## StickyActionBar

| Dimensione      | Contratto                                                                                                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input           | primaryAction; secondaryActions; statusText opzionale; dirty; busy; validationSummary; placement; safeArea.                                                       |
| Varianti finite | bottom, top-contextual; emphasis standard, critical. Massimo una primaryAction.                                                                                   |
| Stati           | hidden, ready, dirty, validating, submitting, success-feedback, error; disabled con motivo accessibile.                                                           |
| Token           | surface-raised, border-subtle, shadow-sm, brand/on-brand, danger/on-danger, safe-area inset e focus.                                                              |
| Tastiera        | Compare nell’ordine DOM vicino al form; non intrappola focus; shortcut solo se documentato; error summary porta al primo campo invalido senza saltare l’annuncio. |
| Breakpoint      | Mobile/tablet bottom sticky con padding contenuto equivalente alla propria altezza e gestione tastiera; desktop può diventare action cluster non sticky.          |
| Non-obiettivi   | Non copre campi, non salva automaticamente, non aggira validazione, gate, idempotenza o approvazione umana.                                                       |

## Gate di modifica

Una nuova variante richiede prima un caso d’uso su almeno due consumer oppure
una necessità di dominio non rappresentabile. Prima di aggiungerla vanno
aggiornati questo documento, i test comportamentali del componente e le
evidenze responsive. Le eccezioni pagina-specifiche non entrano nelle
primitive condivise.
