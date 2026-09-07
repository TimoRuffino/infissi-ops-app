# Rebranding Wyndor — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Il gestionale smette di chiamarsi «Ruffino Flow» e diventa Wyndor, con un marchio proprio che segue il tema chiaro e scuro senza filtri CSS.

**Architecture:** Il marchio diventa due componenti React (`WyndorMark`, `WyndorLockup`) che colorano con `currentColor` e col token `--brand-accent`, al posto di un `<img>` schiacciato da `filter: brightness(0)`. Il nome del prodotto vive in `shared/brand.ts` per le sole stringhe costruite a runtime; altrove si scrive in chiaro. Tre guardie di regressione impediscono i danni tipici di un rebranding: rinominare la cartella dei backup su Drive, riscrivere i prompt storici di Tars, lasciare occorrenze del vecchio nome.

**Tech Stack:** React 19, Tailwind 4, Vitest (ambiente `node`), tsx, sharp (solo sviluppo), pnpm.

**Spec:** `docs/superpowers/specs/2026-09-07-rebranding-wyndor-design.md`

## Global Constraints

- **Nome del prodotto:** `Wyndor`. Payoff: `Gestionale commesse infissi`.
- **Colori del marchio:** anta fissa `#d92f55` (chiaro) / `#ff6b79` (scuro); anta in apertura `#e8a33d` (chiaro) / `#f0b657` (scuro), token `--brand-accent`.
- **Tracciato canonico dell'anta in apertura** (spec, Appendice A), da riprodurre carattere per carattere:
  `M53.321 9.862 L85.321 21.062 A4 4 0 0 1 88 24.838 L88 75.162 A4 4 0 0 1 85.321 78.938 L53.321 90.138 A4 4 0 0 1 48 86.362 L48 13.638 A4 4 0 0 1 53.321 9.862 Z`
- **Anta fissa:** `<rect x="12" y="16" width="27" height="68" rx="4"/>`. **viewBox del segno:** `9 5 82 90`.
- **Non esiste ambiente DOM nei test.** `vitest.config.ts` gira in `environment: "node"`, senza jsdom né testing-library, e raccoglie solo `server/**/*.test.ts`, `shared/**/*.test.ts` e `client/src/lib/**/*.test.ts`. Nessun file `.test.tsx`: verrebbe scritto e non girerebbe mai. I test del client sono contratti letti dal sorgente e dal CSS, come in `client/src/lib/tokenDiscipline.test.ts`.
- **Vietato rinominare** la cartella Drive `"Backup CRM Ruffino"` in `server/_core/driveBackup.ts`: è la chiave con cui il codice ritrova i backup, non un marchio.
- **Vietato modificare** `server/tars/prompt/v1.ts`–`v8.ts`, `docs/superpowers/specs/` (a parte i due file di questo lavoro), `docs/superpowers/plans/` (idem), `docs/design/`, `docs/tars/`.
- **Vietato toccare** `FIRMA_WHATSAPP`, l'intestatario delle fatture, i messaggi «la contattiamo da Ruffino Group» e il copyright «Ruffino Immobiliare S.R.L.»: sono l'azienda, non il prodotto.
- **Niente hex nelle classi Tailwind:** `client/src/lib/tokenDiscipline.test.ts` fallisce su `fill-[#...]` e simili. I componenti del marchio usano attributi SVG (`fill="currentColor"`), non classi.
- Comandi: `pnpm check`, `pnpm test`, `pnpm build`. Un singolo file: `pnpm vitest run <percorso>`.

---

### Task 1: Il token del marchio e il segno

**Files:**
- Create: `client/src/components/brand/WyndorMark.tsx`
- Create: `client/src/lib/marchio.test.ts`
- Modify: `client/src/index.css` (blocco `@theme inline` che finisce a riga ~52; `:root` a riga 161; `.dark` a riga 227)

**Interfaces:**
- Consumes: niente.
- Produces: `WyndorMark({ size?: number; className?: string; title?: string }): JSX.Element` da `@/components/brand/WyndorMark`. Il token CSS `--brand-accent` e l'utility Tailwind `brand-accent`.

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `client/src/lib/marchio.test.ts`:

```ts
// Contratto del marchio Wyndor.
//
// Non esiste ambiente DOM nei test di questo progetto (vitest gira in
// `node`), quindi il marchio si verifica come si verificano i token in
// tokenDiscipline.test.ts: leggendo sorgente e CSS. È meno di un test di
// rendering, ma coglie esattamente i modi in cui un marchio si rompe qui —
// un hex al posto del token, un filtro che lo appiattisce, un tracciato
// ridisegnato a occhio.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CSS = readFileSync(join("client", "src", "index.css"), "utf8");
const MARK = readFileSync(
  join("client", "src", "components", "brand", "WyndorMark.tsx"),
  "utf8"
);

/** Anta in apertura, spec 07/09/2026 Appendice A. Normativo. */
const ANTA_IN_APERTURA =
  "M53.321 9.862 L85.321 21.062 A4 4 0 0 1 88 24.838 " +
  "L88 75.162 A4 4 0 0 1 85.321 78.938 L53.321 90.138 " +
  "A4 4 0 0 1 48 86.362 L48 13.638 A4 4 0 0 1 53.321 9.862 Z";

/** Corpo di un blocco CSS, dal selettore alla prima graffa di chiusura. */
function blocco(selettore: string): string {
  const inizio = CSS.indexOf(`\n${selettore} {`);
  if (inizio < 0) return "";
  return CSS.slice(inizio, CSS.indexOf("\n}", inizio));
}

describe("marchio Wyndor", () => {
  it("dichiara l'accento del marchio nel tema chiaro e in quello scuro", () => {
    expect(blocco(":root")).toMatch(/--brand-accent:\s*#e8a33d/i);
    expect(blocco(".dark")).toMatch(/--brand-accent:\s*#f0b657/i);
  });

  it("espone l'accento come utility Tailwind", () => {
    expect(CSS).toMatch(/--color-brand-accent:\s*var\(--brand-accent\)/);
  });

  it("colora il segno col tema, mai con un hex", () => {
    expect(MARK).toContain('fill="currentColor"');
    expect(MARK).toContain('fill="var(--brand-accent)"');
    expect(MARK).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("riproduce il tracciato canonico dell'anta in apertura", () => {
    expect(MARK.replace(/\s+/g, " ")).toContain(ANTA_IN_APERTURA);
  });

  it("usa il viewBox stretto sull'ingombro", () => {
    expect(MARK).toContain('viewBox="9 5 82 90"');
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `pnpm vitest run client/src/lib/marchio.test.ts`
Expected: FAIL con `ENOENT` su `WyndorMark.tsx`.

- [ ] **Step 3: Dichiara il token in `client/src/index.css`**

Nel blocco `@theme inline`, subito dopo la riga `--color-mora: var(--mora);` e la sua coppia `--color-on-mora`, aggiungi:

```css
  /* Accento del solo marchio: non è un colore semantico e non indica stati. */
  --color-brand-accent: var(--brand-accent);
```

Nel blocco `:root` (riga 161), subito dopo `--primary-foreground: #ffffff;`:

```css
  --brand-accent: #e8a33d;
```

Nel blocco `.dark` (riga 227), subito dopo `--primary-foreground: #2d1419;`:

```css
  --brand-accent: #f0b657;
```

I due blocchi `[data-ui-system="modular-control"]` non dichiarano il token: hanno specificità pari o superiore ma non lo ridefiniscono, quindi ereditano il valore di `:root` e `.dark`. È voluto — il marchio non cambia fra i sistemi visivi.

- [ ] **Step 4: Crea il componente**

Crea `client/src/components/brand/WyndorMark.tsx`:

```tsx
type WyndorMarkProps = {
  /** Lato in pixel. Sotto i 16 il segno non è più leggibile. */
  size?: number;
  className?: string;
  /**
   * Nome accessibile. Ometterlo rende il segno decorativo, che è giusto
   * quando accanto c'è già la parola «Wyndor» come testo.
   */
  title?: string;
};

/**
 * Il segno Wyndor: l'anta fissa e l'anta in apertura, viste in prospettiva.
 * Geometria canonica nella spec del 07/09/2026, Appendice A.
 *
 * L'anta fissa prende `currentColor`, così il colore lo decide chi lo ospita;
 * quella in apertura prende `--brand-accent`, che cambia da sé fra chiaro e
 * scuro. Nessun filtro CSS deve toccare questo elemento: il vecchio
 * `.sidebar-logo` faceva `filter: brightness(0)` e appiattiva il marchio a
 * silhouette, cancellando il colore.
 *
 * La variante a una tinta sola — timbri, stampa in bianco e nero, fondi
 * pieni — non ha bisogno di una prop: basta ridefinire il token
 * sull'elemento che lo ospita, e le due ante restano separate dal solo varco.
 *
 *     <span style={{ "--brand-accent": "currentColor" } as CSSProperties}>
 *       <WyndorMark size={32} />
 *     </span>
 */
export function WyndorMark({ size = 24, className, title }: WyndorMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="9 5 82 90"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <rect x="12" y="16" width="27" height="68" rx="4" fill="currentColor" />
      <path
        fill="var(--brand-accent)"
        d="M53.321 9.862 L85.321 21.062 A4 4 0 0 1 88 24.838 L88 75.162 A4 4 0 0 1 85.321 78.938 L53.321 90.138 A4 4 0 0 1 48 86.362 L48 13.638 A4 4 0 0 1 53.321 9.862 Z"
      />
    </svg>
  );
}
```

- [ ] **Step 5: Esegui il test e verifica che passi**

Run: `pnpm vitest run client/src/lib/marchio.test.ts`
Expected: PASS, 5 test.

Se il quarto test fallisce, il colpevole quasi certo è Prettier che ha spezzato l'attributo `d` su più righe: il confronto normalizza gli spazi, quindi controlla di non aver alterato una cifra.

- [ ] **Step 6: Controlla i tipi**

Run: `pnpm check`
Expected: nessun errore.

- [ ] **Step 7: Commit**

```bash
git add client/src/index.css client/src/components/brand/WyndorMark.tsx client/src/lib/marchio.test.ts
git commit -m "feat(marchio): il segno Wyndor e il token --brand-accent

Il segno prende currentColor e --brand-accent invece di colori fissi:
segue il tema senza il filtro che oggi appiattisce il logo a silhouette.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Il lockup sostituisce l'immagine, e il filtro sparisce

**Files:**
- Create: `client/src/components/brand/WyndorLockup.tsx`
- Modify: `client/src/components/layout/NavigationSidebar.tsx:137-155`
- Modify: `client/src/components/layout/LegacyDashboardLayout.tsx:233-238`
- Modify: `client/src/pages/LoginPage.tsx:61-71`
- Modify: `client/src/index.css` (rimozione delle due regole `.sidebar-logo`, da cercare per contenuto)
- Modify: `client/src/lib/marchio.test.ts`

**Interfaces:**
- Consumes: `WyndorMark` dal Task 1.
- Produces: `WyndorLockup({ className?: string; markSize?: number; title?: string }): JSX.Element` da `@/components/brand/WyndorLockup`.

- [ ] **Step 1: Aggiungi i test che falliscono**

In `client/src/lib/marchio.test.ts`, dopo le costanti già presenti, aggiungi le letture:

```ts
const LOCKUP = readFileSync(
  join("client", "src", "components", "brand", "WyndorLockup.tsx"),
  "utf8"
);
const SIDEBAR = readFileSync(
  join("client", "src", "components", "layout", "NavigationSidebar.tsx"),
  "utf8"
);
const LEGACY = readFileSync(
  join("client", "src", "components", "layout", "LegacyDashboardLayout.tsx"),
  "utf8"
);
const LOGIN = readFileSync(join("client", "src", "pages", "LoginPage.tsx"), "utf8");
```

e in fondo al file un nuovo blocco:

```ts
describe("il marchio nella chrome", () => {
  it("non lascia in vita il filtro che appiattiva il logo", () => {
    expect(CSS).not.toContain("sidebar-logo");
    expect(CSS).not.toMatch(/filter:\s*brightness\(0\)/);
  });

  it("monta il marchio come componente, non come immagine fissa", () => {
    for (const [nome, sorgente] of [
      ["NavigationSidebar", SIDEBAR],
      ["LegacyDashboardLayout", LEGACY],
      ["LoginPage", LOGIN],
    ] as const) {
      expect(sorgente, nome).not.toContain('src="/logo.svg"');
    }
    expect(SIDEBAR).toContain("<WyndorLockup");
    expect(LEGACY).toContain("<WyndorLockup");
    expect(LOGIN).toContain("<WyndorMark");
  });

  it("mostra il segno anche a barra compressa, non un'iniziale", () => {
    expect(SIDEBAR).toContain("<WyndorMark");
  });

  it("scrive la parola come testo, non come tracciato", () => {
    // Un lockup con la parola in curve non è selezionabile, non scala con le
    // preferenze dell'utente e non arriva agli screen reader.
    // Il confronto tollera a capo e indentazione: in JSX la parola sta su una
    // riga sua fra i due tag.
    expect(LOCKUP).toMatch(/>\s*Wyndor\s*</);
  });
});
```

- [ ] **Step 2: Esegui e verifica il fallimento**

Run: `pnpm vitest run client/src/lib/marchio.test.ts`
Expected: FAIL con `ENOENT` su `WyndorLockup.tsx`.

- [ ] **Step 3: Crea il lockup**

Crea `client/src/components/brand/WyndorLockup.tsx`:

```tsx
import { cn } from "@/lib/utils";
import { WyndorMark } from "./WyndorMark";

type WyndorLockupProps = {
  className?: string;
  /** Lato del segno in pixel. */
  markSize?: number;
  /** Nome accessibile dell'insieme. */
  title?: string;
};

/**
 * Segno più parola, orizzontale. La parola resta testo: selezionabile, che
 * scala con le preferenze dell'utente e leggibile dagli screen reader senza
 * dipendere dal caricamento del font.
 */
export function WyndorLockup({
  className,
  markSize = 20,
  title,
}: WyndorLockupProps) {
  return (
    <span
      className={cn("inline-flex min-w-0 items-center gap-2", className)}
      title={title}
    >
      <WyndorMark size={markSize} className="shrink-0 text-primary" />
      <span className="font-display truncate text-[15px] font-semibold tracking-[-0.03em]">
        Wyndor
      </span>
    </span>
  );
}
```

Il colore del segno lo decide il lockup, non chi lo monta: se lo passasse chi lo ospita, un `text-primary` sul contenitore tingerebbe di borgogna anche la parola. Così la parola eredita il colore del testo attorno — nella barra laterale `text-sidebar-foreground` — e il segno resta borgogna.

- [ ] **Step 4: Sostituisci nella barra laterale**

In `client/src/components/layout/NavigationSidebar.tsx`, aggiungi in cima agli import:

```tsx
import { WyndorLockup } from "@/components/brand/WyndorLockup";
import { WyndorMark } from "@/components/brand/WyndorMark";
```

Sostituisci il blocco alle righe 140-153 (dal `{collapsed ? (` alla sua chiusura):

```tsx
          {collapsed ? (
            <WyndorMark
              size={22}
              title="Wyndor"
              className="shrink-0 text-primary"
            />
          ) : (
            <WyndorLockup className="max-w-[148px]" />
          )}
```

- [ ] **Step 5: Sostituisci nel layout legacy**

In `client/src/components/layout/LegacyDashboardLayout.tsx`, aggiungi l'import:

```tsx
import { WyndorLockup } from "@/components/brand/WyndorLockup";
```

e sostituisci l'elemento `<img>` alle righe 234-238 con:

```tsx
                  <WyndorLockup className="max-w-[132px] shrink-0" />
```

- [ ] **Step 6: Sostituisci nella pagina di accesso**

In `client/src/pages/LoginPage.tsx`, aggiungi l'import:

```tsx
import { WyndorMark } from "@/components/brand/WyndorMark";
```

e sostituisci le righe 61-70 (l'`<img>` più l'`<h1>`) con:

```tsx
            <WyndorMark size={44} className="mx-auto text-primary" />
            <div className="space-y-1">
              <h1 className="font-display text-[30px] font-extrabold leading-tight">
                Wyndor
              </h1>
              <p className="eyebrow !text-text-2">Gestionale commesse infissi</p>
            </div>
```

Il segno resta decorativo (senza `title`) perché l'`<h1>` accanto dice già il nome: annunciarlo due volte è rumore per chi usa uno screen reader.

- [ ] **Step 7: Elimina il filtro da `client/src/index.css`**

Cancella per contenuto, non per numero di riga: il Task 1 ha inserito righe più in alto nello stesso file, quindi le regole si sono spostate di tre o quattro righe rispetto alla 925 di partenza. Cercale con `sidebar-logo` e cancellale per intero, entrambe:

```css
.sidebar-logo {
  filter: brightness(0) invert(1);
}

[data-ui-system="modular-control"]:not(.dark) .sidebar-logo {
  filter: brightness(0) opacity(0.86);
}
```

- [ ] **Step 8: Esegui i test**

Run: `pnpm vitest run client/src/lib/marchio.test.ts client/src/lib/tokenDiscipline.test.ts`
Expected: PASS. `tokenDiscipline` gira insieme perché il Task tocca `index.css`.

- [ ] **Step 9: Controlla i tipi e la build**

Run: `pnpm check && pnpm build`
Expected: nessun errore.

- [ ] **Step 10: Commit**

```bash
git add client/src/components/brand/WyndorLockup.tsx client/src/components/layout/NavigationSidebar.tsx client/src/components/layout/LegacyDashboardLayout.tsx client/src/pages/LoginPage.tsx client/src/index.css client/src/lib/marchio.test.ts
git commit -m "feat(marchio): il lockup Wyndor sostituisce il logo immagine

Via .sidebar-logo e il suo filter: brightness(0), che appiattiva il
marchio a silhouette in ogni tema. A barra compressa compare il segno
invece dell'iniziale «R».

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Le stringhe dell'interfaccia

**Files:**
- Modify: `client/index.html:11`
- Modify: `client/src/components/layout/NavigationSidebar.tsx:133`
- Modify: `client/src/components/layout/CompactNavigation.tsx:32`
- Modify: `client/src/components/layout/MobileTopBar.tsx:49`
- Modify: `client/src/components/layout/ContextBar.tsx:46`
- Modify: `client/src/lib/shellPresentation.ts:60`
- Modify: `client/src/lib/shellPresentation.test.ts:21`
- Modify: `client/src/lib/preventivatori.ts:6,46`
- Modify: `client/src/pages/Preventivatori.tsx:44,118,134`
- Modify: `client/src/lib/modularRoutePresentation.test.ts:437`
- Modify: `client/src/pages/ClienteDetail.tsx:403`
- Modify: `client/public/notification-sw.js:10,15`

**Interfaces:**
- Consumes: niente dai task precedenti.
- Produces: niente per i task successivi.

- [ ] **Step 1: Aggiorna i due test prima del codice**

In `client/src/lib/modularRoutePresentation.test.ts` riga 437:

```ts
    expect(source).toMatch(/Non disponibile in Wyndor/);
```

In `client/src/lib/shellPresentation.test.ts` riga 21, il commento:

```ts
  // fallback generico ("Wyndor" sia in sezione sia in titolo).
```

- [ ] **Step 2: Esegui e verifica il fallimento**

Run: `pnpm vitest run client/src/lib/modularRoutePresentation.test.ts`
Expected: FAIL — la pagina dice ancora «Non disponibile in Ruffino Flow».

- [ ] **Step 3: Sostituisci le stringhe**

Ogni occorrenza di `Ruffino Flow` diventa `Wyndor` nei file elencati sopra. Punto per punto:

- `client/index.html:11` → `<title>Wyndor — Gestionale commesse infissi</title>`
- `NavigationSidebar.tsx:133` → `aria-label="Navigazione Wyndor"`
- `CompactNavigation.tsx:32` → `<SheetTitle>Navigazione Wyndor</SheetTitle>`
- `MobileTopBar.tsx:49` → `Wyndor`
- `ContextBar.tsx:46` → `<span>Wyndor</span>`
- `shellPresentation.ts:60` → `section: "Wyndor",`
- `preventivatori.ts:6` → `` in `PREVENTIVATORE_ROUTES` non ha un calcolatore in Wyndor, e ``
- `preventivatori.ts:46` → `descrizione: "Listino non ancora modellato in Wyndor.",`
- `Preventivatori.tsx:44` → `…riepilogo e PDF restano dentro Wyndor."`
- `Preventivatori.tsx:118` → `title="Non disponibili in Wyndor"`
- `Preventivatori.tsx:134` → `Non disponibile in Wyndor`
- `ClienteDetail.tsx:403` → l'argomento di `doc.text(...)` diventa:

```ts
      `Generata il ${new Date().toLocaleDateString("it-IT")} alle ${new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })} — Wyndor`,
```

In `client/public/notification-sw.js` cambia due righe:

```js
    self.registration.showNotification(payload.title || "Wyndor", {
```

```js
      tag: `wyndor-notification-${payload.notificationId}`,
```

Il `tag` non è visibile all'utente: serve solo a far collassare due notifiche con lo stesso identificativo nello stesso browser. Cambiarlo non perde nulla, perché è già unico per notifica.

- [ ] **Step 4: Esegui i test del client**

Run: `pnpm vitest run client/src/lib`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/index.html client/src/components/layout client/src/lib client/src/pages/Preventivatori.tsx client/src/pages/ClienteDetail.tsx client/public/notification-sw.js
git commit -m "feat(marchio): l'interfaccia dice Wyndor

Titolo, barra, navigazione compatta, preventivatori, piè di pagina del
PDF cliente e notifica di ripiego del service worker.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `shared/brand.ts` e le superfici che escono

**Files:**
- Create: `shared/brand.ts`
- Create: `server/_core/driveBackup.brand.test.ts`
- Modify: `server/routers/calendarSync.ts:173,176`
- Modify: `server/notifications/deliveryWorker.ts:28`
- Modify: `server/notifications/deliveryWorker.test.ts:35`
- Modify: `server/_core/driveBackup.ts:634`

**Interfaces:**
- Consumes: niente dai task precedenti.
- Produces: `PRODOTTO: string` (`"Wyndor"`) e `PRODOTTO_PAYOFF: string` da `@shared/brand`.

- [ ] **Step 1: Scrivi la guardia che fallisce**

Crea `server/_core/driveBackup.brand.test.ts`:

```ts
// Guardia del rebranding sul backup Drive.
//
// Il nome della cartella non è un marchio: è la chiave con cui
// driveCreateFolder ritrova la cartella già creata. Rinominarlo per coerenza
// di brand ne creerebbe una nuova e lascerebbe i backup esistenti orfani in
// quella vecchia, invisibili al codice. Questo test esiste perché la
// tentazione, durante un rebranding, è esattamente quella.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SORGENTE = readFileSync(join("server", "_core", "driveBackup.ts"), "utf8");

// Composto da pezzi come in tokenDiscipline.test.ts: un test che scrive il
// vecchio nome per intero dovrebbe poi essere esentato dalla spazzata di
// shared/brand.test.ts, e ogni esenzione è un buco.
const VECCHIO_NOME = ["Ruffino", "Flow"].join(" ");
const CARTELLA_BACKUP = ["Backup", "CRM", "Ruffino"].join(" ");

describe("marchio e backup su Drive", () => {
  it("non rinomina la cartella dei backup insieme al prodotto", () => {
    // Ancora l'asserzione alla chiamata funzionale, non solo alla stringa nei
    // commenti: la cartella è nominata anche in un commento poco sopra, e
    // cercare la sola stringa lascerebbe passare chi rinomina la chiamata e
    // dimentica il commento — cioè esattamente lo scenario da intercettare.
    expect(SORGENTE).toContain(`driveCreateFolder(token, "${CARTELLA_BACKUP}"`);
  });

  it("firma i PDF col nome nuovo del prodotto", () => {
    expect(SORGENTE).toContain("${PRODOTTO}");
    expect(SORGENTE).not.toContain(VECCHIO_NOME);
  });
});
```

- [ ] **Step 2: Esegui e verifica il fallimento**

Run: `pnpm vitest run server/_core/driveBackup.brand.test.ts`
Expected: FAIL sul secondo test — la sorgente contiene ancora «Ruffino Flow» e non usa `PRODOTTO`.

- [ ] **Step 3: Crea `shared/brand.ts`**

```ts
/**
 * Identità del prodotto.
 *
 * Serve alle sole stringhe costruite a runtime — intestazioni ICS, titolo
 * delle notifiche push, firma dei PDF di backup, fonti citate da Tars — dove
 * il nome viene concatenato e dimenticarne una è facile.
 *
 * Nel JSX e nei documenti si scrive «Wyndor» in chiaro: una costante infilata
 * dentro una frase di interfaccia peggiora la leggibilità senza aggiungere
 * sicurezza.
 */
export const PRODOTTO = "Wyndor";

export const PRODOTTO_PAYOFF = "Gestionale commesse infissi";
```

- [ ] **Step 4: Usalo nelle tre superfici**

In `server/routers/calendarSync.ts`, aggiungi l'import accanto agli altri `@shared/`:

```ts
import { PRODOTTO } from "@shared/brand";
```

e cambia le due righe dell'intestazione:

```ts
    `PRODID:-//${PRODOTTO}//Calendario//IT`,
```

```ts
    `X-WR-CALNAME:${PRODOTTO} — ${feed.label}`,
```

Attenzione: la riga `PRODID` era una stringa fra virgolette doppie e diventa un template literal. Chi è già iscritto al calendario vedrà cambiare il nome del feed nel proprio client: è atteso e va dichiarato nella nota di rilascio.

In `server/notifications/deliveryWorker.ts`, aggiungi l'import e cambia riga 28:

```ts
import { PRODOTTO } from "@shared/brand";
```

```ts
    title: PRODOTTO,
```

In `server/_core/driveBackup.ts`, aggiungi l'import e cambia riga 634:

```ts
import { PRODOTTO } from "@shared/brand";
```

```ts
    `Backup del ${new Date().toLocaleDateString("it-IT")} — ${PRODOTTO}`,
```

Non toccare la riga 307, `driveCreateFolder(token, "Backup CRM Ruffino", "root")`.

- [ ] **Step 5: Allinea il test delle notifiche**

In `server/notifications/deliveryWorker.test.ts` riga 35:

```ts
      title: "Wyndor",
```

- [ ] **Step 6: Esegui i test**

Run: `pnpm vitest run server/_core/driveBackup.brand.test.ts server/notifications server/routers/calendarSync`
Expected: PASS.

- [ ] **Step 7: Controlla i tipi**

Run: `pnpm check`
Expected: nessun errore.

- [ ] **Step 8: Commit**

```bash
git add shared/brand.ts server/_core/driveBackup.ts server/_core/driveBackup.brand.test.ts server/routers/calendarSync.ts server/notifications/deliveryWorker.ts server/notifications/deliveryWorker.test.ts
git commit -m "feat(marchio): un solo posto per il nome nelle stringhe a runtime

ICS, notifiche push e firma dei backup passano da PRODOTTO. La cartella
Drive «Backup CRM Ruffino» resta com'è, con una guardia che lo impone:
è la chiave con cui il codice ritrova i backup, non un marchio.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Tars dice Wyndor, l'archivio resta com'era

**Files:**
- Create: `server/tars/prompt/archivio.test.ts`
- Modify: `server/tars/prompt/v9.ts:14`
- Modify: `server/tars/strumenti/agenda.ts:36`
- Modify: `server/tars/strumenti/clienti.ts:19`
- Modify: `server/tars/strumenti/commesse.ts:34`
- Modify: `server/tars/strumenti/letture.ts:35`
- Modify: `server/tars/strumenti/ricerca.ts:44`
- Modify: `server/tars/conversazione/context.test.ts:176`

**Interfaces:**
- Consumes: `PRODOTTO` da `@shared/brand` (Task 4).
- Produces: niente per i task successivi.

- [ ] **Step 1: Scrivi la guardia che fallisce**

Crea `server/tars/prompt/archivio.test.ts`:

```ts
// I prompt passati sono un registro, non codice vivo.
//
// Solo v9 è importato dall'orchestratore; da v1 a v8 nessuno li carica.
// Riscriverli durante un rebranding falsificherebbe un archivio: portano il
// nome che il prodotto aveva quando furono scritti, ed è giusto così.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CARTELLA = join("server", "tars", "prompt");
const STORICI_COL_VECCHIO_NOME = ["v1", "v2", "v3", "v4"] as const;

// Composto da pezzi: così questo file non è esso stesso un residuo per la
// spazzata di shared/brand.test.ts.
const VECCHIO_NOME = ["Ruffino", "Flow"].join(" ");

describe("archivio dei prompt di Tars", () => {
  it("non riscrive i prompt storici", () => {
    for (const versione of STORICI_COL_VECCHIO_NOME) {
      const sorgente = readFileSync(
        join(CARTELLA, `${versione}.ts`),
        "utf8"
      );
      expect(sorgente, versione).toContain(VECCHIO_NOME);
    }
  });

  it("tiene in vita una sola versione del prompt", () => {
    const orchestratore = readFileSync(
      join("server", "tars", "orchestratore.ts"),
      "utf8"
    );
    expect(orchestratore).toContain('from "./prompt/v9"');
  });

  it("fa dire a Tars il nome nuovo", () => {
    const v9 = readFileSync(join(CARTELLA, "v9.ts"), "utf8");
    expect(v9).toContain("il cervello operativo di Wyndor");
    expect(v9).not.toContain(VECCHIO_NOME);
  });
});
```

- [ ] **Step 2: Esegui e verifica il fallimento**

Run: `pnpm vitest run server/tars/prompt/archivio.test.ts`
Expected: FAIL sul terzo test — v9 dice ancora «Ruffino Flow».

- [ ] **Step 3: Aggiorna il prompt attivo**

In `server/tars/prompt/v9.ts` riga 14, la prima frase diventa:

```ts
export const PROMPT_SISTEMA = `Sei Tars, il cervello operativo di Wyndor (CRM per serramenti e infissi, sedi multiple). Sei un collega esperto con pieni poteri entro i permessi dell'utente con cui parli: leggi tutto ciò che serve, capisci la situazione, e FAI. Parli italiano: diretto, calmo, concreto, mai teatrale né servile.
```

Non toccare `PROMPT_VERSIONE`: il rebranding non cambia il comportamento del modello, e far scattare la versione mentirebbe sul perché.

- [ ] **Step 4: Aggiorna le cinque fonti**

Le costanti diventano template literal che usano `PRODOTTO`. In ciascun file aggiungi in cima:

```ts
import { PRODOTTO } from "@shared/brand";
```

`server/tars/strumenti/agenda.ts:36`:

```ts
const FONTE_CRM = `CRM ${PRODOTTO}`;
```

`server/tars/strumenti/ricerca.ts:44`:

```ts
const FONTE_CRM = `CRM ${PRODOTTO}`;
```

`server/tars/strumenti/clienti.ts:19` (la costante è su due righe, sostituisci il valore):

```ts
  `CRM ${PRODOTTO} (memoria viva; senza DATABASE_URL i dati locali sono volatili)`;
```

`server/tars/strumenti/letture.ts:35`:

```ts
const FONTE_CRM = `CRM ${PRODOTTO} (memoria viva; senza DATABASE_URL i dati locali sono volatili)`;
```

`server/tars/strumenti/commesse.ts:34`:

```ts
const FONTE = `Servizio canonico transizioni commessa di ${PRODOTTO}`;
```

- [ ] **Step 5: Allinea il test del contesto**

In `server/tars/conversazione/context.test.ts` riga 176:

```ts
    fonteAutorevole: "CRM Wyndor",
```

- [ ] **Step 6: Esegui i test di Tars**

Run: `pnpm vitest run server/tars`
Expected: PASS.

- [ ] **Step 7: Controlla i tipi**

Run: `pnpm check`
Expected: nessun errore.

- [ ] **Step 8: Commit**

```bash
git add server/tars
git commit -m "feat(marchio): Tars cita Wyndor, l'archivio dei prompt resta

Cambiano il prompt attivo v9 e le cinque fonti degli strumenti. Da v1 a
v8 nessuno li importa: sono il registro delle versioni passate e una
guardia impedisce di riscriverli.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: I file statici del marchio e le icone mancanti

**Files:**
- Modify: `client/public/favicon.svg` (riscrittura completa)
- Modify: `client/public/logo.svg` (riscrittura completa)
- Create: `scripts/genera-icone.ts`
- Create: `client/public/apple-touch-icon.png` (generato)
- Create: `client/public/icon-192.png` (generato)
- Modify: `client/index.html:10`
- Modify: `package.json` (script `icone`, devDependency `sharp`)
- Modify: `client/src/lib/marchio.test.ts`

**Interfaces:**
- Consumes: la geometria canonica dei vincoli globali.
- Produces: `/favicon.svg`, `/logo.svg`, `/apple-touch-icon.png`, `/icon-192.png` sotto `client/public`.

Nota: `client/public/notification-sw.js` punta già a `/icon-192.png` per `icon` e `badge`, e **quel file oggi non esiste**. Le notifiche push mostrano l'icona di ripiego del browser. Questo task chiude anche quel difetto.

- [ ] **Step 1: Aggiungi i test che falliscono**

In `client/src/lib/marchio.test.ts` aggiungi in cima la lettura dei file statici:

```ts
const FAVICON = readFileSync(join("client", "public", "favicon.svg"), "utf8");
```

e in fondo:

```ts
/** Larghezza e altezza lette dall'header IHDR, senza dipendenze. */
function dimensioniPng(percorso: string): { larghezza: number; altezza: number } {
  const b = readFileSync(percorso);
  const firma = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(b.subarray(0, 8).equals(firma), `${percorso} non è un PNG`).toBe(true);
  return { larghezza: b.readUInt32BE(16), altezza: b.readUInt32BE(20) };
}

describe("file statici del marchio", () => {
  it("la favicon porta il tracciato canonico e i colori del tema chiaro", () => {
    expect(FAVICON.replace(/\s+/g, " ")).toContain(ANTA_IN_APERTURA);
    expect(FAVICON).toContain("#d92f55");
    expect(FAVICON).toContain("#e8a33d");
  });

  it("esiste l'icona che iOS sa leggere", () => {
    expect(dimensioniPng(join("client", "public", "apple-touch-icon.png"))).toEqual(
      { larghezza: 180, altezza: 180 }
    );
  });

  it("esiste l'icona che il service worker cerca da sempre", () => {
    // notification-sw.js punta a /icon-192.png per icon e badge.
    expect(dimensioniPng(join("client", "public", "icon-192.png"))).toEqual({
      larghezza: 192,
      altezza: 192,
    });
  });

  it("index.html non offre più un SVG a iOS, che lo ignora", () => {
    const html = readFileSync(join("client", "index.html"), "utf8");
    expect(html).toContain('rel="apple-touch-icon" href="/apple-touch-icon.png"');
  });
});
```

- [ ] **Step 2: Esegui e verifica il fallimento**

Run: `pnpm vitest run client/src/lib/marchio.test.ts`
Expected: FAIL — la favicon è ancora il monogramma Ruffino e i PNG non esistono.

- [ ] **Step 3: Riscrivi `client/public/favicon.svg`**

Sostituisci l'intero contenuto con:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="9 5 82 90" width="82" height="90">
  <title>Wyndor</title>
  <rect x="12" y="16" width="27" height="68" rx="4" fill="#d92f55"/>
  <path fill="#e8a33d" d="M53.321 9.862 L85.321 21.062 A4 4 0 0 1 88 24.838 L88 75.162 A4 4 0 0 1 85.321 78.938 L53.321 90.138 A4 4 0 0 1 48 86.362 L48 13.638 A4 4 0 0 1 53.321 9.862 Z"/>
</svg>
```

- [ ] **Step 4: Riscrivi `client/public/logo.svg`**

Lo stesso segno con un po' di respiro attorno. Dopo il Task 2 nessun componente consuma questo file; resta perché `server/_core/cacheStatica.test.ts` ne verifica il percorso.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <title>Wyndor</title>
  <rect x="12" y="16" width="27" height="68" rx="4" fill="#d92f55"/>
  <path fill="#e8a33d" d="M53.321 9.862 L85.321 21.062 A4 4 0 0 1 88 24.838 L88 75.162 A4 4 0 0 1 85.321 78.938 L53.321 90.138 A4 4 0 0 1 48 86.362 L48 13.638 A4 4 0 0 1 53.321 9.862 Z"/>
</svg>
```

- [ ] **Step 5: Installa `sharp` come dipendenza di sviluppo**

```bash
pnpm add -D sharp
```

Il PNG generato viene committato, quindi `sharp` non serve né alla build di produzione né a Railway: è uno strumento da banco.

- [ ] **Step 5-bis: Crea `shared/marchio.ts` con la geometria dell'inquadratura**

La matematica non può vivere dentro `scripts/`: `vitest.config.ts` raccoglie solo `server/**`, `shared/**` e `client/src/lib/**`, quindi lì non sarebbe coperta da nulla. Vive in `shared/marchio.ts` come funzione pura, con `shared/marchio.test.ts` che la verifica su più lati d'icona.

```ts
export const RIQUADRO_SEGNO = { x: 9, y: 5, larghezza: 82, altezza: 90 };
export const RESPIRO_ICONA = 0.12;

export function inquadraturaIcona(lato: number) {
  const { x, y, larghezza, altezza } = RIQUADRO_SEGNO;
  const contenuto = lato * (1 - RESPIRO_ICONA * 2);
  const scala = contenuto / Math.max(larghezza, altezza);
  const offsetX = (lato - larghezza * scala) / 2 - x * scala;
  const offsetY = (lato - altezza * scala) / 2 - y * scala;
  return { scala, offsetX, offsetY };
}
```

La scala nasce dal lato **più lungo** del riquadro, mai dalla sola larghezza: il segno è 82×90, e scalare su 82 farebbe traboccare l'altezza di circa il 10%: con l'offset ancorato all'angolo, tutto l'eccesso si scarica sul margine inferiore e il marchio scende. Conseguenza voluta della formula corretta: il margine è esattamente `RESPIRO_ICONA` sull'asse verticale e maggiore su quello orizzontale, perché il segno è più alto che largo. Forzare lo stesso respiro su entrambi gli assi lo deformerebbe.

Il test deve dimostrare che il segno è centrato su entrambi gli assi, che il lato lungo rispetta esattamente il respiro e che il segno non esce mai dall'icona. Scrivilo prima e guardalo fallire con la formula sbagliata.

- [ ] **Step 6: Crea `scripts/genera-icone.ts`**

```ts
// Genera le icone raster del marchio dai tracciati canonici.
//
// iOS non accetta SVG per apple-touch-icon e ignora la trasparenza, quindi
// l'icona nasce su fondo pieno. Il service worker cerca /icon-192.png da
// prima di questo rebranding, e finora quel file non esisteva.
//
// Rieseguibile: se il marchio cambia, i PNG si rigenerano invece di restare
// indietro. Uso: pnpm icone
//
// La geometria vive in shared/marchio.ts, dove è testata: qui non si
// ricalcola, si importa. Lo script resta responsabile della sola I/O.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { inquadraturaIcona } from "../shared/marchio";

const FONDO = "#fffdfd";
const ANTA_FISSA = "#d92f55";
const ANTA_APERTA = "#e8a33d";
const TRACCIATO =
  "M53.321 9.862 L85.321 21.062 A4 4 0 0 1 88 24.838 L88 75.162 " +
  "A4 4 0 0 1 85.321 78.938 L53.321 90.138 A4 4 0 0 1 48 86.362 " +
  "L48 13.638 A4 4 0 0 1 53.321 9.862 Z";

function sorgente(lato: number): Buffer {
  const { scala, offsetX, offsetY } = inquadraturaIcona(lato);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${lato}" height="${lato}">` +
      `<rect width="${lato}" height="${lato}" fill="${FONDO}"/>` +
      `<g transform="translate(${offsetX} ${offsetY}) scale(${scala})">` +
      `<rect x="12" y="16" width="27" height="68" rx="4" fill="${ANTA_FISSA}"/>` +
      `<path fill="${ANTA_APERTA}" d="${TRACCIATO}"/>` +
      `</g></svg>`
  );
}

const ICONE = [
  { nome: "apple-touch-icon.png", lato: 180 },
  { nome: "icon-192.png", lato: 192 },
];

for (const { nome, lato } of ICONE) {
  const percorso = join("client", "public", nome);
  const png = await sharp(sorgente(lato)).png({ compressionLevel: 9 }).toBuffer();
  writeFileSync(percorso, png);
  console.log(`${percorso} — ${lato}×${lato}, ${png.length} byte`);
}
```

- [ ] **Step 7: Aggiungi lo script a `package.json`**

Nella sezione `scripts`, dopo `"ui:contrast"`:

```json
    "icone": "tsx scripts/genera-icone.ts",
```

- [ ] **Step 8: Genera i PNG**

Run: `pnpm icone`
Expected: due righe di output, `apple-touch-icon.png — 180×180` e `icon-192.png — 192×192`.

- [ ] **Step 9: Punta `index.html` al PNG**

In `client/index.html` riga 10:

```html
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
```

La riga 9, `rel="icon" type="image/svg+xml" href="/favicon.svg"`, resta: sul desktop l'SVG è la scelta giusta.

- [ ] **Step 10: Esegui i test e la build**

Run: `pnpm vitest run client/src/lib/marchio.test.ts server/_core/cacheStatica.test.ts && pnpm build`
Expected: PASS e build pulita.

- [ ] **Step 11: Commit**

```bash
git add client/public/favicon.svg client/public/logo.svg client/public/apple-touch-icon.png client/public/icon-192.png client/index.html scripts/genera-icone.ts package.json pnpm-lock.yaml client/src/lib/marchio.test.ts
git commit -m "feat(marchio): favicon Wyndor e le due icone raster mancanti

apple-touch-icon puntava a un SVG, che iOS ignora: l'icona sulla home
dell'iPhone non c'era. icon-192.png, cercato dal service worker per le
notifiche push, non è mai esistito. Entrambe ora si generano da script
rieseguibile.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: La documentazione viva e la spazzata finale

**Files:**
- Create: `shared/brand.test.ts`
- Modify: `documento_requisiti_infissi_ops.md`
- Modify: `handoff.md`
- Modify: `CLAUDE.md`
- Modify: `AGENTS.md`
- Modify: `.github/workflows/ci.yml:1`
- Modify: `scripts/build-prd-pdf.sh:46`

**Interfaces:**
- Consumes: `PRODOTTO` da `@shared/brand` (Task 4).
- Produces: niente.

- [ ] **Step 1: Scrivi la spazzata che fallisce**

Crea `shared/brand.test.ts`:

```ts
// Spazzata finale del rebranding.
//
// Il nome precedente sopravvive legittimamente solo nell'archivio: verbali
// datati, documenti di design e i prompt passati di Tars, che portano il nome
// che il prodotto aveva quando furono scritti. Ovunque altro è un residuo.
//
// Il nome vecchio non compare mai per esteso in questo file: viene composto
// da pezzi, così la spazzata non inciampa in sé stessa.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, sep } from "node:path";

import { PRODOTTO, PRODOTTO_PAYOFF } from "./brand";

const VECCHIO_NOME = ["Ruffino", "Flow"].join(" ");

/**
 * Cartelle che non contengono sorgenti del progetto. `.github` NON è qui:
 * `ci.yml` va controllato come ogni altro documento vivo.
 */
const IGNORATE = new Set([
  ".git",
  ".claude",
  ".superpowers",
  ".manus-logs",
  "node_modules",
  "dist",
  "output",
  "tmp",
  "backups",
  "data",
  "attached_assets",
]);

/**
 * L'archivio: qui il vecchio nome è memoria, non residuo. La lista è corta
 * di proposito. Le guardie (`driveBackup.brand.test.ts`,
 * `archivio.test.ts`) non compaiono perché compongono il vecchio nome da
 * pezzi invece di scriverlo: un'esenzione in meno è un controllo in più.
 */
const ARCHIVIO = [
  join("docs", "design"),
  join("docs", "tars"),
  join("docs", "superpowers", "plans"),
  join("docs", "superpowers", "specs"),
  join("server", "tars", "prompt", "v1.ts"),
  join("server", "tars", "prompt", "v2.ts"),
  join("server", "tars", "prompt", "v3.ts"),
  join("server", "tars", "prompt", "v4.ts"),
];

/**
 * Occorrenze legittime fuori dall'archivio: identificatori esterni che
 * portano ancora il vecchio nome. Riscriverli nel documento non li
 * rinominerebbe davvero — farebbe solo mentire il documento.
 */
const DEROGHE = [
  {
    file: "handoff.md",
    // Nome reale del servizio su Railway. La rinomina è fuori perimetro
    // (spec §12) e va fatta sulla piattaforma, non nel testo.
    frammento: "servizio `" + VECCHIO_NOME + "`",
  },
];

const ESTENSIONI = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".css",
  ".html",
  ".md",
  ".sh",
  ".yml",
  ".yaml",
  ".json",
]);

function archiviato(percorso: string): boolean {
  return ARCHIVIO.some(
    voce => percorso === voce || percorso.startsWith(voce + sep)
  );
}

/** Il contenuto senza le occorrenze esplicitamente derogate. */
function senzaDeroghe(percorso: string, contenuto: string): string {
  return DEROGHE.filter(d => d.file === percorso).reduce(
    (testo, d) => testo.split(d.frammento).join(""),
    contenuto
  );
}

function percorsi(dir: string): string[] {
  const out: string[] = [];
  for (const nome of readdirSync(dir)) {
    if (IGNORATE.has(nome)) continue;
    const percorso = dir === "." ? nome : join(dir, nome);
    if (statSync(percorso).isDirectory()) {
      out.push(...percorsi(percorso));
      continue;
    }
    if (ESTENSIONI.has(extname(nome))) out.push(percorso);
  }
  return out;
}

describe("identità del prodotto", () => {
  it("espone nome e payoff", () => {
    expect(PRODOTTO).toBe("Wyndor");
    expect(PRODOTTO_PAYOFF).toBe("Gestionale commesse infissi");
  });

  it("non lascia residui del vecchio nome fuori dall'archivio", () => {
    const residui = percorsi(".")
      .filter(percorso => !archiviato(percorso))
      .filter(percorso =>
        senzaDeroghe(percorso, readFileSync(percorso, "utf8")).includes(
          VECCHIO_NOME
        )
      );
    expect(
      residui,
      `Il vecchio nome sopravvive qui:\n${residui.join("\n")}`
    ).toEqual([]);
  });

  it("tiene ogni deroga ancorata a un'occorrenza che esiste davvero", () => {
    // Una deroga che non corrisponde più a nulla è una regola morta che
    // continuerebbe a coprire testo nuovo.
    for (const d of DEROGHE) {
      expect(readFileSync(d.file, "utf8"), d.file).toContain(d.frammento);
    }
  });
});
```

- [ ] **Step 2: Esegui e verifica il fallimento**

Run: `pnpm vitest run shared/brand.test.ts`
Expected: FAIL, con l'elenco dei documenti vivi ancora da aggiornare.

- [ ] **Step 3: Aggiorna la documentazione viva, occorrenza per occorrenza**

`documento_requisiti_infissi_ops.md`:
- riga 1 → `# Documento Requisiti — Wyndor (PRD)`
- riga 30 → `**Wyndor** è lo strumento operativo centrale di **Ruffino Immobiliare S.R.L.** …` (il resto della riga invariato; «Ruffino Immobiliare S.R.L.» è l'azienda e non si tocca)
- riga 2448 → `Principio fissato dalla direzione: Wyndor governa il lavoro del`

`handoff.md`:
- riga 1 → ``# Handoff - Wyndor (`infissi-ops-app`)``
- riga 211 → `Wyndor è il gestionale operativo di Ruffino Group per clienti, commesse,`
- **riga 1854 → non si tocca.** Dice `` servizio `Ruffino Flow` `` ed è il nome reale del servizio su Railway. Cambiarlo nel documento non rinominerebbe niente: renderebbe il documento falso proprio dove serve per operare. Aggiungi però, subito dopo, la ragione:

```markdown
(il servizio su Railway porta ancora il vecchio nome: la rinomina è
un'operazione di piattaforma, fuori dal perimetro del rebranding —
spec §12)
```

`CLAUDE.md`:
- riga 1 → `# CLAUDE.md - Wyndor`

`AGENTS.md`:
- l'unica occorrenza → `Wyndor`

`.github/workflows/ci.yml`:
- riga 1 → `# CI di Wyndor (release hardening 29/08/2026).`

`scripts/build-prd-pdf.sh`:
- riga 46 → `<title>PRD - Wyndor v4.31</title>`

- [ ] **Step 4: Registra il cambio di nome nel PRD**

Nella sezione introduttiva del PRD, dopo il paragrafo di riga 30, aggiungi:

```markdown
Il 07/09/2026 il gestionale ha cambiato nome da «Ruffino Flow» a **Wyndor**,
con marchio proprio, come primo passo della distribuzione ad altre aziende.
Il vecchio nome resta leggibile nei documenti datati anteriori a quella data,
che sono verbali e non vengono riscritti, e nel nome del servizio Railway,
che va rinominato sulla piattaforma. Marchio e perimetro:
`docs/superpowers/specs/2026-09-07-rebranding-wyndor-design.md`.
```

Poi aggiorna l'intestazione `**Versione:**` del PRD.

**Attenzione al numero.** Su questo ramo il PRD è alla 5.49, ma altri rami in volo l'hanno già portata più avanti: `feature/ws1-fondazione-tenant` alla 5.51 e `feature/ws2-porta-aperta` alla 5.53. Usare 5.50 garantirebbe una collisione da risolvere a mano al merge, come già successo il 05/09. Usa **5.54** e apri la voce così:

```markdown
**Versione:** 5.54 - Rebranding Wyndor: il gestionale cambia nome e marchio, l'accento del marchio entra nei token, le icone raster mancanti vengono generate (spec `2026-09-07-rebranding-wyndor-design.md`). Numero scelto sopra la 5.53 di `feature/ws2-porta-aperta` per non collidere al merge. Prima: 5.49 - …
```

Il resto della catena «Prima: …» resta invariato.

- [ ] **Step 4-bis: Aggiungi la voce in `handoff.md`**

In testa al documento, sopra la voce «Novità 06/09/2026», con lo stesso formato a citazione:

```markdown
> **Novità 07/09/2026 — il CRM si chiama Wyndor** (spec
> `docs/superpowers/specs/2026-09-07-rebranding-wyndor-design.md`, piano
> `docs/superpowers/plans/2026-09-07-rebranding-wyndor.md`). Nome e marchio
> nuovi: due ante in prospettiva, borgogna e ambra, montate come componente
> React invece che come immagine — via il filtro che appiattiva il logo a
> silhouette. Ruffino Group resta il tenant 1: firma WhatsApp, intestatario
> fatture e messaggi ai clienti restano suoi. Non toccati: la cartella Drive
> `Backup CRM Ruffino` (è la chiave dei backup, non un marchio), i prompt
> Tars da v1 a v8 e i verbali datati. Fuori perimetro e ancora da fare:
> nome del repository, `package.json`, dominio, servizio Railway, callback
> OAuth.
```

Aggiorna anche `**Aggiornato:**` a `07/09/2026`.

- [ ] **Step 5: Esegui la spazzata**

Run: `pnpm vitest run shared/brand.test.ts`
Expected: PASS. Se restano residui, il test li elenca per percorso: valutane ognuno — o si aggiorna, o entra nell'archivio con una ragione scritta.

- [ ] **Step 6: Esegui tutto**

Run: `pnpm check && pnpm test && pnpm build`
Expected: tutto verde.

- [ ] **Step 7: Commit**

```bash
git add documento_requisiti_infissi_ops.md handoff.md CLAUDE.md AGENTS.md .github/workflows/ci.yml scripts/build-prd-pdf.sh shared/brand.test.ts
git commit -m "docs(marchio): la documentazione viva dice Wyndor

PRD, handoff, guide per gli agenti, commento CI e titolo del PDF. Una
spazzata automatica impedisce residui del vecchio nome fuori
dall'archivio dei verbali datati.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Verifica finale

Dopo il Task 7, prima di dichiarare finito:

- [ ] `pnpm check`, `pnpm test`, `pnpm build` verdi.
- [ ] Pagina di accesso nel browser a 1440×900 e 390×844: il segno prende la borgogna in chiaro e la sua variante in scuro, l'ambra si vede in entrambi, nessun errore in console.
- [ ] **Da dichiarare, non da fingere:** barra laterale, ContextBar e MobileTopBar richiedono una sessione autenticata. L'agente non digita credenziali, quindi quel controllo resta a una persona. Va scritto come non eseguito.
- [ ] **Da dichiarare come non fatto:** lockup vettoriale con la parola in tracciati (serve strumentazione tipografica); rinomina della cartella Drive dei backup; nome del repository, `package.json`, dominio, variabili Railway, callback OAuth.
