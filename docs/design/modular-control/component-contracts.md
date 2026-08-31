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
| Varianti finite | `standard`, `record`, `workbench`, `compact`. Una sola `primaryAction` visiva.                                                            |
| Stati           | default, busy, action-disabled, contextual-warning. Errori di pagina vivono in StatePanel, non nel titolo.                                |
| Token           | canvas/surface, ink/muted, brand/on-brand, border-subtle, spacing header e type scale.                                                    |
| Tastiera        | Breadcrumb e azioni nell’ordine visivo; pulsanti icon-only con aria-label e tooltip; sticky header non nasconde il focus.                 |
| Breakpoint      | Desktop: titolo e azioni sulla stessa fascia se leggibili. Mobile: titolo prima, azioni principali in StickyActionBar quando persistenti. |
| Non-obiettivi   | Non contiene KPI decorativi, filtri complessi, permessi o mutation.                                                                       |

## DataSurface

| Dimensione      | Contratto                                                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Input           | `title`, `description`, `toolbar`, `children`, `footer`, `state`; `density`; `tone`; elemento semantico `as`.                      |
| Varianti finite | Tone `default`, `sunken`, `focal`; density `comfortable`, `compact`. `focal` è l’unico consumer condiviso del gradiente approvato. |
| Stati           | Il contenuto è ready oppure riceve uno `StatePanel` tipizzato; la surface non trasforma errori o permission in assenze.            |
| Token           | surface, sunken, raised, border-subtle, ink, muted, shadow-xs/sm; eventuale focal-gradient approvato.                              |
| Tastiera        | La surface non è focusabile di default; toolbar precede il contenuto; region label quando ha un titolo.                            |
| Breakpoint      | Padding e toolbar reflowano; nessun fixed width. In mobile filtri secondari entrano in disclosure/drawer.                          |
| Non-obiettivi   | Non crea card dentro card, non inventa metriche e non nasconde errori dietro placeholder vuoti.                                    |

Esempio minimo: `<DataSurface density="compact" tone="sunken">…</DataSurface>`.
La pagina sceglie la semantica dei dati; la surface non esegue fetch e non
accetta `className` come variante parallela.

## StatePanel

| Dimensione      | Contratto                                                                                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input           | Unione discriminata con `kind`, `title`, `description`, `compact`; azione opzionale per assenza/permission/unavailable e obbligatoria per error/stale.          |
| Varianti finite | `loading`, `empty`, `error`, `permission`, `unavailable`, `stale`. `permission` non è sinonimo di `empty`; `unavailable` non è sinonimo di errore recuperabile. |
| Stati           | Loading usa una silhouette coerente col contenuto; error e permission sono annunciati subito; stale mantiene dati e copy di aggiornamento esplicita.            |
| Token           | Coppie foreground/background neutral, danger, warning e info. Colore sempre accompagnato da icona e testo.                                                      |
| Tastiera        | Le azioni restano controlli nativi forniti dal consumer. Il pannello non cattura focus; error/permission usano alert, gli altri live status.                    |
| Breakpoint      | Testo e azione reflowano senza larghezze fisse; la silhouette ha al massimo sei righe e non genera scroll globale.                                              |
| Motion          | Spinner e pulsazione esistono solo con motion consentita; `prefers-reduced-motion` lascia una silhouette statica e comprensibile.                               |
| Non-obiettivi   | Non ritenta da solo, non deduce capability, non conserva l’ultimo risultato e non usa “nessun dato” per coprire un errore.                                      |

Esempio errore: `<StatePanel kind="error" title="…" description="…" action={<Button>Riprova</Button>} />`.

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

`StatoChip` mantiene l’API e i machine value storici: aggiunge il prefisso
accessibile “Stato”, un indicatore di forma e size finite `sm`/`md`, senza
rinominare o ritradurre i valori del dominio.

## ConfirmDialog

| Dimensione      | Contratto                                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Input           | `title`, `description` e `confirmLabel` obbligatori dal caller; `cancelLabel`; `destructive`; `busy`; callback esplicita.        |
| Varianti finite | Conferma standard o distruttiva. Il default distruttivo conserva la compatibilità, ma non fornisce mai copy implicita.           |
| Stati           | Ready e busy; busy disabilita entrambe le azioni e viene esposto con `aria-busy`.                                                |
| Tastiera        | Focus trap del dialog, Escape/Annulla senza effetti, Enter non sostituisce una scelta esplicita sul controllo corretto.          |
| Non-obiettivi   | Non costruisce frasi generiche, non esegue mutation, non rende reversibile un’azione e non sostituisce la conferma con un toast. |

## Skeleton

| Dimensione      | Contratto                                                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Varianti finite | `block`, `text`, `control`, `avatar`, `panel`, `row`; il consumer sceglie la silhouette del contenuto atteso.                                |
| Motion          | Pulsazione discreta soltanto con motion consentita; con `prefers-reduced-motion` resta una forma statica.                                    |
| Non-obiettivi   | Non usa shimmer aggressivi, non mescola silhouette incompatibili e non sostituisce error, permission o unavailable con caricamenti infiniti. |

## Chart

| Dimensione      | Contratto                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input           | Configurazione serie con label, icona, colore espresso esclusivamente come CSS token e emphasis `protagonist`/`supporting`.                       |
| Varianti finite | Una serie protagonista, eventuali serie di supporto; tooltip compatto scuro e legenda sobria.                                                     |
| Accessibilità   | Assi e griglia restano secondari ma leggibili; il colore non sostituisce label, legenda o tabella dati quando necessaria.                         |
| Non-obiettivi   | Nessun colore hex nel config, nessun gradiente, nessun effetto 3D, nessuna tavolozza arcobaleno e nessuna animazione indispensabile alla lettura. |

## ContextInspector

| Dimensione      | Contratto                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input           | title; sections tipizzate; selectedEntity; actions; availability; open; onOpenChange; width preset.                                                           |
| Varianti finite | Desktop mode `inline`, `overlay`; width `narrow`, `standard`, `wide`. Sotto desktop diventa sempre overlay; su mobile sale dal basso.                         |
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
| Input           | `primary`, `secondary`, `destructive`, `status`; `dirty`; `busy`; placement. I controlli e la loro autorizzazione arrivano dal consumer.                          |
| Varianti finite | `responsive` è sticky su mobile/tablet e torna nel flusso su desktop; `sticky` resta persistente. Massimo una primary action.                                     |
| Stati           | hidden, ready, dirty, validating, submitting, success-feedback, error; disabled con motivo accessibile.                                                           |
| Token           | surface-raised, border-subtle, shadow-sm, brand/on-brand, danger/on-danger, safe-area inset e focus.                                                              |
| Tastiera        | Compare nell’ordine DOM vicino al form; non intrappola focus; shortcut solo se documentato; error summary porta al primo campo invalido senza saltare l’annuncio. |
| Breakpoint      | Mobile/tablet bottom sticky con padding contenuto equivalente alla propria altezza e gestione tastiera; desktop può diventare action cluster non sticky.          |
| Non-obiettivi   | Non copre campi, non salva automaticamente, non aggira validazione, gate, idempotenza o approvazione umana.                                                       |

Esempio: `<StickyActionBar status="Modifiche non salvate" primary={<Button>Salva</Button>} />`.
La barra resta nel normale ordine DOM e include la safe area; va collocata dopo
i campi del form, così la sua posizione sticky non nasconde controlli o errori.

## Note d’uso dei pattern

- `PageHeader` ospita orientamento e azioni di pagina, non KPI o filtri
  complessi. Su mobile una azione persistente passa a `StickyActionBar`.
- `DataSurface` raggruppa una singola responsabilità informativa. Una pagina
  può avere più surface piatte ma al massimo una surface `focal` visibile.
- `ContextInspector` riceve contenuto già sede-scoped. Il passaggio
  inline/overlay non duplica query, selezione o mutation.
- Le azioni solo-icona, se introdotte, hanno sempre `aria-label` e tooltip. Le
  icone illustrative sono `aria-hidden` perché titolo e descrizione portano il
  significato.
- Transizioni e indicatori rispettano `prefers-reduced-motion`; nessun pattern
  dipende dal movimento per comunicare stato o gerarchia.

## Gate di modifica

Una nuova variante richiede prima un caso d’uso su almeno due consumer oppure
una necessità di dominio non rappresentabile. Prima di aggiungerla vanno
aggiornati questo documento, i test comportamentali del componente e le
evidenze responsive. Le eccezioni pagina-specifiche non entrano nelle
primitive condivise.
