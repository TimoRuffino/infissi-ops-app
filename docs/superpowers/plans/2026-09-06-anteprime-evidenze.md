# Anteprime delle evidenze («Dove l'ho letto») — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ogni valore che il CRM compila da un documento letto porta un tasto che apre, come vignetta sopra il tasto, il ritaglio della pagina da cui è stato letto, con contesto, fonte del testo e grado della posizione.

**Architecture:** i parser (nativo e OCR) restituiscono una geometria per pagina accanto al testo; gli estrattori scrivono la posizione del match nell'evidenza; un localizzatore puro trasforma posizione o frammento in aree normalizzate; le aree si salvano accanto ai dati (letturaCosto, righe magazzino, proposta e righe del contratto); le pagine si rendono in JPEG con pdftoppm quando i byte sono già in mano, si salvano nello storage e si servono da una rotta sorella di quella del file; un solo componente client fa il ritaglio in CSS.

**Tech Stack:** TypeScript, Node, Express, tRPC 11, zod, unpdf/pdf.js, tesseract 5 (TSV), poppler `pdftoppm`, React 19, Radix Popover, Tailwind 4, vitest.

**Spec:** `docs/superpowers/specs/2026-09-06-anteprime-evidenze-design.md`

## Global Constraints

- `sedeId` su ogni rotta e query; documento di un'altra sede → `NOT_FOUND`/`404` (CLAUDE.md, spec §1).
- Nessun blob base64 nuovo in JSONB: le immagini di pagina vanno nello storage via `putFile` (spec §4).
- Interruttore nuovo fail-closed `FLAG_ANTEPRIME_EVIDENZE` (nome interno `anteprimeEvidenze`): acceso solo con `NODE_ENV` `development`/`test` (spec §6).
- Il modello non produce coordinate; la vignetta mostra solo ciò che l'estrattore ha letto; posizione non trovata = grado `pagina` (spec §1, §3.2).
- Coordinate normalizzate in frazioni 0..1 della pagina resa, `y` verso il basso, rotazione già applicata (spec §3.1).
- Limiti: 15 MB e 20 pagine; rendering 150 dpi JPEG qualità 75; timeout 60 s (spec §4).
- Versioni: parser nativo `2.1.0`, estrattore conferme `1.2.0`, merce `1.3.0`, lettura costo `1.9.0`; OCR invariato (spec §3.5).
- UI: token semantici di `client/src/index.css`, icone lucide con `aria-label`, area di tocco 40 px, niente scroll orizzontale (CLAUDE.md, spec §2).
- Test: `pnpm vitest run <file>` per il singolo file; alla fine `pnpm check`, `pnpm test`, `pnpm build`.
- Commit su questo branch (`claude/ocr-crm-overview-1adbb2`), mai `main`, mai push.

---

## Struttura dei file

| File | Responsabilità |
|---|---|
| `shared/documenti/evidenze.ts` (nuovo) | forme condivise: `Area`, `PosizioneEvidenza`, `EvidenzaLetta`, `GeometriaPagina`, `EvidenzeLetturaCosto` |
| `server/documenti/testoPdf.ts` | righe **e** geometria dai frammenti pdf.js (`righeConGeometriaDaElementi`, `pagineConGeometriaDaDocumento`) |
| `server/documenti/ocr.ts` | `parseTsv` conserva i riquadri delle parole → `PaginaOcr.geometria`; `renderizzaPagine` con formato JPEG |
| `server/documenti/parserRegistry.ts` | `EsitoParser.geometria`; parser nativo 2.1.0; geometria OCR allegata alla visione con `allineata:false` |
| `server/documenti/localizzatore.ts` (nuovo) | funzioni pure: offset → area, frammento → area (fuzzy), riga → area, fascia di contesto |
| `server/documenti/estrazioneConferma.ts` | `Evidenza.posizione`/`area`; versione 1.2.0; `annotaAreeEstrazione` |
| `server/documenti/estrazioneMerce.ts` | `RigaMerce.posizione`/`area`; versione 1.3.0; `annotaAreeMerce` |
| `server/documenti/riscontroCommessa.ts` | `evidenzeDelRiscontro(pagine, riscontro)` |
| `server/contratti/estrazione/evidenze.ts` | `verificaEvidenza` restituisce anche `posizione` |
| `server/contratti/estrazione/aree.ts` (nuovo) | `annotaAreeProposta(proposta, geometria)` |
| `shared/contratti/estrazione.ts`, `shared/limiti/tipi.ts`, `server/contratti/servizio.ts` | `area` nell'evidenza di proposta e righe applicate (tipo + zod) |
| `server/commesse/letturaCostoTipi.ts`, `server/commesse/costoDaConferma.ts` | `letturaCosto.evidenze`, versione 1.9.0, merce con evidenza, scaldata anteprime |
| `server/routers/magazzino.ts` | `Prodotto.evidenza` |
| `server/documenti/anteprime.ts` (nuovo) | rendering, storage, lettura, scaldata, in-flight dedupe |
| `server/routers/preventiviContratti.ts` | `Documento.anteprime`, `salvaAnteprimeDocumento`, cancellazione, query `evidenzeDocumento` |
| `server/_core/anteprimaRoutes.ts` (nuovo), `server/_core/index.ts` | rotta `GET /api/documenti/:id/pagina/:n` |
| `server/platform/interruttori.ts` | interruttore `anteprimeEvidenze` |
| `server/documenti/analisi.ts`, `server/contratti/estrazione/servizio.ts` | aree nelle evidenze, scaldata anteprime |
| `server/documenti/eval/runEval.ts` | metrica «evidenze localizzate» |
| `client/src/lib/anteprime.ts` (nuovo) | URL e calcolo del ritaglio (puro, testato) |
| `client/src/components/documenti/DoveLetto.tsx` (nuovo) | tasto + vignetta |
| `client/src/components/ui/popover.tsx` | esporta `PopoverArrow` |
| superfici client | montaggio del tasto |
| `.env.example`, `docs/runbooks/rollout-document-intelligence.md`, PRD, `handoff.md` | documentazione |

---

### Task 1: interruttore `anteprimeEvidenze` e forme condivise

**Files:**
- Modify: `server/platform/interruttori.ts`
- Create: `shared/documenti/evidenze.ts`
- Test: `server/platform/interruttori.test.ts`
- Modify: `.env.example`, `docs/runbooks/rollout-document-intelligence.md`

**Interfaces:**
- Produces: `interruttoreAttivo("anteprimeEvidenze")`; tipi in `@shared/documenti/evidenze`.

- [ ] **Step 1: test dell'interruttore**

Aggiungere in `server/platform/interruttori.test.ts`, nel `describe("interruttori — default e override")`:

```ts
  it("le anteprime delle evidenze nascono spente in produzione e si accendono con FLAG_ANTEPRIME_EVIDENZE", () => {
    process.env.NODE_ENV = "production";
    delete process.env.FLAG_ANTEPRIME_EVIDENZE;
    expect(interruttoreAttivo("anteprimeEvidenze")).toBe(false);
    process.env.FLAG_ANTEPRIME_EVIDENZE = "on";
    expect(interruttoreAttivo("anteprimeEvidenze")).toBe(true);
    expect(statoInterruttori().anteprimeEvidenze).toBe(true);
  });
```

(Il file ripristina già `NODE_ENV` e le variabili nel suo `afterEach`: verificarlo e, se manca `FLAG_ANTEPRIME_EVIDENZE` nella lista pulita, aggiungerlo.)

- [ ] **Step 2: eseguire, deve fallire** — `pnpm vitest run server/platform/interruttori.test.ts` → errore di tipo/valore su `anteprimeEvidenze`.

- [ ] **Step 3: implementare**

In `server/platform/interruttori.ts`: aggiungere `| "anteprimeEvidenze"` all'unione `Interruttore` (con commento: «Anteprime delle evidenze (06/09/2026): rotta delle pagine rese, rendering nei worker e tasto «Dove l'ho letto». Nessun modello.»), `anteprimeEvidenze: "FLAG_ANTEPRIME_EVIDENZE"` in `VARIABILE`, `anteprimeEvidenze: "Le anteprime delle evidenze (dove l'ho letto)"` in `ETICHETTA`, e `| "anteprimeEvidenze"` nelle due `Exclude<…>` di `tarsAttivo`/`assicuraTars`.

Creare `shared/documenti/evidenze.ts`:

```ts
// Forme condivise delle evidenze localizzate (06/09/2026): dove, nella
// pagina, sta il frammento da cui un valore è stato letto. Solo tipi.

/** Rettangolo in frazioni (0..1) della pagina resa; y cresce verso il basso. */
export type Area = { x: number; y: number; w: number; h: number };

export type GradoPosizione = "riquadro" | "zona" | "pagina";

export type PosizioneEvidenza = {
  grado: GradoPosizione;
  /** Il frammento letto (riquadro o zona). */
  frammento?: Area;
  /** La riga intera che lo contiene. */
  riga?: Area;
  /** Due righe sopra e due sotto: il contesto della vignetta. */
  contesto?: Area;
};

/** Un'evidenza pronta per il client: pagina, frammento, area (null = pagina intera). */
export type EvidenzaLetta = {
  pagina: number;
  frammento: string;
  area: PosizioneEvidenza | null;
};

export type TrattoGeometria = {
  testo: string;
  /** Scarti di carattere DENTRO la riga di testo. */
  inizio: number;
  fine: number;
  x0: number;
  x1: number;
};

export type RigaGeometria = {
  /** Scarto del primo carattere della riga nel testo della pagina (geometria allineata). */
  inizio: number;
  y0: number;
  y1: number;
  tratti: TrattoGeometria[];
};

/** Geometria di una pagina, nelle unità della fonte (punti PDF o pixel). */
export type GeometriaPagina = {
  larghezza: number;
  altezza: number;
  /** true quando la riga i del testo della pagina è `righe[i]`. */
  allineata: boolean;
  righe: RigaGeometria[];
};

export type FonteTesto = "testo_pdf" | "ocr" | "visione";

/** Le evidenze salvate accanto alla lettura del costo. */
export type EvidenzeLetturaCosto = {
  imponibile?: EvidenzaLetta | null;
  totale?: EvidenzaLetta | null;
  fornitore?: EvidenzaLetta | null;
  numeroConferma?: EvidenzaLetta | null;
  dataDocumento?: EvidenzaLetta | null;
  riferimentoOrdine?: EvidenzaLetta | null;
  riferimentoCliente?: EvidenzaLetta | null;
  consegna?: EvidenzaLetta | null;
  approntamento?: EvidenzaLetta | null;
  riscontro?: EvidenzaLetta[];
};
```

In `.env.example`, sotto `# FLAG_OCR=on`:

```
# Anteprime delle evidenze «Dove l'ho letto» (06/09/2026): rotta delle pagine
# rese, rendering nei worker e tasto nel client. Fail-closed.
# FLAG_ANTEPRIME_EVIDENZE=on
```

Nel runbook, tabella §1, riga nuova: `| \`FLAG_ANTEPRIME_EVIDENZE\` | anteprime delle evidenze (pagine rese, tasto «Dove l'ho letto») | rotta \`/api/documenti/:id/pagina/:n\` → \`404\`; nessun rendering nei worker; tasto nascosto |`.

- [ ] **Step 4: eseguire, deve passare** — `pnpm vitest run server/platform/interruttori.test.ts`.
- [ ] **Step 5: commit** — `git add -A && git commit -m "feat(platform): interruttore FLAG_ANTEPRIME_EVIDENZE e forme condivise delle evidenze localizzate"`.

---

### Task 2: geometria dal testo nativo

**Files:**
- Modify: `server/documenti/testoPdf.ts`
- Test: `server/documenti/testoPdf.test.ts`

**Interfaces:**
- Produces: `righeConGeometriaDaElementi(elementi, pagina?: { larghezza, altezza, aVista?(x,y): [number, number] }) → { testo: string; righe: RigaGeometria[] }`; `pagineConGeometriaDaDocumento(pdf) → { pagine: string[]; geometria: Array<GeometriaPagina | null> }`; `DocumentoPdf.getPage` può avere `getViewport?(p: { scale: number }) → { width, height, convertToViewportPoint(x, y): [number, number] }`.
- `righeDaElementi(elementi)` resta e vale `righeConGeometriaDaElementi(elementi).testo`.

- [ ] **Step 1: test**

In `server/documenti/testoPdf.test.ts` aggiungere un `describe("righeConGeometriaDaElementi — geometria allineata alle righe")`:

```ts
import { righeConGeometriaDaElementi, pagineConGeometriaDaDocumento } from "./testoPdf";

const pagina = {
  larghezza: 600,
  altezza: 800,
  // y-up dei PDF → y-down della vista, come farebbe il viewport di pdf.js.
  aVista: (x: number, y: number): [number, number] => [x, 800 - y],
};

it("ogni riga di testo ha la sua riga di geometria, e ogni tratto sa dove comincia nella riga", () => {
  const { testo, righe } = righeConGeometriaDaElementi(
    [el("Totale imponibile", 40, 700), el("7.762,25", 400, 700), el("IVA 22%", 40, 680)],
    pagina
  );
  const linee = testo.split("\n");
  expect(linee).toHaveLength(2);
  expect(righe).toHaveLength(2);
  expect(righe[0].inizio).toBe(0);
  expect(righe[1].inizio).toBe(linee[0].length + 1);
  const valore = righe[0].tratti.find(t => t.testo === "7.762,25")!;
  expect(linee[0].slice(valore.inizio, valore.fine)).toBe("7.762,25");
  expect(valore.x0).toBe(400);
  // y-down: la prima riga sta sopra la seconda.
  expect(righe[0].y0).toBeLessThan(righe[1].y0);
  expect(righe[0].y1).toBeGreaterThan(righe[0].y0);
});

it("senza le misure della pagina la geometria resta vuota ma il testo è quello di sempre", () => {
  const { testo, righe } = righeConGeometriaDaElementi([el("Solo testo", 10, 10)]);
  expect(testo.trim()).toBe("Solo testo");
  expect(righe).toEqual([]);
});

it("pagineConGeometriaDaDocumento usa il viewport della pagina e resta allineata", async () => {
  const pdf = {
    numPages: 1,
    getPage: async () => ({
      getTextContent: async () => ({ items: [el("Riga uno", 10, 100), el("Riga due", 10, 80)] }),
      getViewport: () => ({
        width: 600,
        height: 800,
        convertToViewportPoint: (x: number, y: number): [number, number] => [x, 800 - y],
      }),
    }),
  };
  const { pagine, geometria } = await pagineConGeometriaDaDocumento(pdf);
  expect(pagine[0].split("\n").map(r => r.trim())).toEqual(["Riga uno", "Riga due"]);
  expect(geometria[0]).toMatchObject({ larghezza: 600, altezza: 800, allineata: true });
  expect(geometria[0]!.righe).toHaveLength(2);
  expect(geometria[0]!.righe[1].inizio).toBe(pagine[0].indexOf("Riga due"));
});
```

(`el(str, x, y)` è l'helper già presente nel file: `{ str, transform: [8,0,0,8,x,y], width: str.length*4, height: 8 }`; se ha un'altra firma, adattare le chiamate.)

- [ ] **Step 2: eseguire, deve fallire** — `pnpm vitest run server/documenti/testoPdf.test.ts`.

- [ ] **Step 3: implementare**

In `server/documenti/testoPdf.ts`:

```ts
import type { GeometriaPagina, RigaGeometria, TrattoGeometria } from "@shared/documenti/evidenze";

export type MisurePagina = {
  larghezza: number;
  altezza: number;
  /** Da spazio utente del PDF (y verso l'alto) a spazio della vista (y verso il basso, rotazione applicata). */
  aVista?: (x: number, y: number) => [number, number];
};

function riquadroVista(f: Frammento, misure: MisurePagina): { x0: number; x1: number; y0: number; y1: number } {
  // Baseline in f.y: il glifo sale di ~0,8 altezze e scende di ~0,25.
  const angoli: Array<[number, number]> = [
    [f.x, f.y - 0.25 * f.altezza],
    [f.fine, f.y - 0.25 * f.altezza],
    [f.x, f.y + 0.8 * f.altezza],
    [f.fine, f.y + 0.8 * f.altezza],
  ].map(([x, y]) => (misure.aVista ? misure.aVista(x, y) : [x, misure.altezza - y]));
  const xs = angoli.map(a => a[0]);
  const ys = angoli.map(a => a[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}
```

Rifattorizzare `unisciRiga` perché restituisca anche i tratti: `unisciRiga(riga, carattere): { testo: string; tratti: Array<{ f: Frammento; inizio: number; fine: number }> }` — ogni volta che un pezzo viene aggiunto al testo, registrare `inizio = testo.length` prima dell'aggiunta e `fine = testo.length` dopo (per i pezzi incollati senza spazio, un tratto a sé con i suoi scarti). `righeDaElementi` diventa:

```ts
export function righeConGeometriaDaElementi(
  elementi: ReadonlyArray<ElementoTesto>,
  misure?: MisurePagina
): { testo: string; righe: RigaGeometria[] } {
  // …stesso raggruppamento per quota di oggi…
  const righeTesto: string[] = [];
  const geometria: RigaGeometria[] = [];
  let scarto = 0;
  for (const riga of righe) {
    const unita = unisciRiga(riga, carattere);
    if (unita.testo.trim().length === 0) continue;
    righeTesto.push(unita.testo);
    if (misure) {
      const riquadri = unita.tratti.map(t => ({ t, r: riquadroVista(t.f, misure) }));
      geometria.push({
        inizio: scarto,
        y0: Math.min(...riquadri.map(q => q.r.y0)),
        y1: Math.max(...riquadri.map(q => q.r.y1)),
        tratti: riquadri.map(({ t, r }) => ({ testo: t.f.testo.trim(), inizio: t.inizio, fine: t.fine, x0: r.x0, x1: r.x1 })),
      });
    }
    scarto += unita.testo.length + 1;
  }
  return { testo: righeTesto.join("\n"), righe: geometria };
}

export function righeDaElementi(elementi: ReadonlyArray<ElementoTesto>): string {
  return righeConGeometriaDaElementi(elementi).testo;
}
```

Estendere `DocumentoPdf.getPage` con `getViewport?: (p: { scale: number }) => { width: number; height: number; convertToViewportPoint: (x: number, y: number) => [number, number] }` e aggiungere:

```ts
export async function pagineConGeometriaDaDocumento(
  pdf: DocumentoPdf
): Promise<{ pagine: string[]; geometria: Array<GeometriaPagina | null> }> {
  const pagine: string[] = [];
  const geometria: Array<GeometriaPagina | null> = [];
  for (let numero = 1; numero <= pdf.numPages; numero += 1) {
    const pagina = await pdf.getPage(numero);
    const contenuto = await pagina.getTextContent();
    const elementi = contenuto.items.filter(
      (item): item is ElementoTesto =>
        typeof (item as any)?.str === "string" && Array.isArray((item as any)?.transform)
    );
    const viewport = pagina.getViewport?.({ scale: 1 }) ?? null;
    const misure: MisurePagina | undefined = viewport
      ? {
          larghezza: viewport.width,
          altezza: viewport.height,
          aVista: (x, y) => viewport.convertToViewportPoint(x, y),
        }
      : undefined;
    const { testo, righe } = righeConGeometriaDaElementi(elementi, misure);
    pagine.push(testo);
    geometria.push(misure ? { larghezza: misure.larghezza, altezza: misure.altezza, allineata: true, righe } : null);
    pagina.cleanup?.();
  }
  return { pagine, geometria };
}
```

`pagineDaDocumento` resta e restituisce `(await pagineConGeometriaDaDocumento(pdf)).pagine`.

- [ ] **Step 4: eseguire, deve passare** — tutto `testoPdf.test.ts` (i test vecchi compresi: il testo non cambia).
- [ ] **Step 5: commit** — `git commit -am "feat(documenti): il testo nativo porta la geometria delle righe accanto alle righe"`.

---

### Task 3: geometria dall'OCR e rendering JPEG

**Files:**
- Modify: `server/documenti/ocr.ts`
- Test: `server/documenti/ocr.test.ts`

**Interfaces:**
- Produces: `PaginaOcr.geometria: GeometriaPagina | null`; `parseTsv` esportata per i test; `renderizzaPagine(bytes, { dpi, maxPagine, timeoutMs, numeroPagine?, binari?, formato?: "png" | "jpeg", qualita?: number }) → EsitoRendering`; `renderizzaPaginePng` resta come alias con `formato: "png"`.

- [ ] **Step 1: test di `parseTsv` (senza binari)**

```ts
import { parseTsv } from "./ocr";

describe("parseTsv — testo e riquadri delle parole", () => {
  it("tiene i riquadri, le righe e gli scarti dentro la riga", () => {
    const tsv = [
      "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
      "1\t1\t0\t0\t0\t0\t0\t0\t1240\t1754\t-1\t",
      "5\t1\t1\t1\t1\t1\t100\t200\t120\t30\t95\tTotale",
      "5\t1\t1\t1\t1\t2\t230\t200\t160\t30\t93\timponibile",
      "5\t1\t1\t1\t1\t3\t900\t200\t140\t30\t91\t7.762,25",
      "5\t1\t1\t1\t2\t1\t100\t250\t60\t30\t90\tIVA",
    ].join("\n");
    const pagina = parseTsv(tsv);
    expect(pagina.testo).toBe("Totale imponibile 7.762,25\nIVA");
    expect(pagina.confidenza).toBe(92);
    expect(pagina.geometria).toMatchObject({ larghezza: 1240, altezza: 1754, allineata: true });
    const [riga1, riga2] = pagina.geometria!.righe;
    expect(riga1.inizio).toBe(0);
    expect(riga2.inizio).toBe("Totale imponibile 7.762,25".length + 1);
    const valore = riga1.tratti[2];
    expect(pagina.testo.slice(valore.inizio, valore.fine)).toBe("7.762,25");
    expect(valore).toMatchObject({ x0: 900, x1: 1040 });
    expect(riga1).toMatchObject({ y0: 200, y1: 230 });
  });
});
```

- [ ] **Step 2: eseguire, deve fallire** — `parseTsv` non è esportata / `geometria` assente.

- [ ] **Step 3: implementare**

In `ocr.ts`: `PaginaOcr` guadagna `geometria: GeometriaPagina | null`. Riscrivere `parseTsv` (esportata) così: raccogliere le parole per chiave `blocco|par|riga` in ordine, con `{ testo, conf, left, top, width, height }`; leggere la riga di livello `1` per `larghezza`/`altezza` (colonne 8 e 9); costruire per ogni riga il testo con le parole unite da uno spazio, calcolando `inizio`/`fine` di ogni parola nella riga e `inizio` della riga nel testo della pagina (somma delle lunghezze + 1); `y0 = min(top)`, `y1 = max(top + height)`, `x0 = left`, `x1 = left + width`. Testo finale = righe unite da `\n` (identico a oggi: nessuna riga vuota, nessuno spazio in coda). Se manca la riga di livello 1, `geometria = null`.

Rendering: rinominare `renderizzaPaginePng` in `renderizzaPagine` con le opzioni `formato` (default `"png"`) e `qualita` (default 75): con `"jpeg"` gli argomenti diventano `["-r", dpi, "-jpeg", "-jpegopt", `quality=${qualita}`, "-f", "1", "-l", n, ingresso, prefisso]` e i file da leggere finiscono in `.jpg`. Aggiungere `export const renderizzaPaginePng = (bytes, opzioni) => renderizzaPagine(bytes, { ...opzioni, formato: "png" })` così i chiamanti non cambiano.

- [ ] **Step 4: eseguire** — `pnpm vitest run server/documenti/ocr.test.ts` (con i binari il test della scansione vera deve ancora passare; aggiungere in quel test `expect(conOcr.geometria?.[0]?.righe.length).toBeGreaterThan(0)` dopo il Task 4).
- [ ] **Step 5: commit** — `git commit -am "feat(ocr): parseTsv conserva i riquadri delle parole; rendering delle pagine anche in JPEG"`.

---

### Task 4: `EsitoParser.geometria` e localizzatore

**Files:**
- Modify: `server/documenti/parserRegistry.ts`
- Create: `server/documenti/localizzatore.ts`
- Test: `server/documenti/localizzatore.test.ts`, `server/documenti/parserRegistry.visione.test.ts`

**Interfaces:**
- Produces in `parserRegistry.ts`: `EsitoParser` (`estratto`) `+ geometria?: Array<GeometriaPagina | null>`; parser nativo versione `"2.1.0"`.
- Produces in `localizzatore.ts`:

```ts
export function areaDiRiga(geo: GeometriaPagina, indiceRiga: number): Area;
export function fasciaDiContesto(geo: GeometriaPagina, indiceRiga: number, righeIntorno?: number): Area; // default 2
export function localizzaOffset(geo: GeometriaPagina, inizio: number, fine: number): PosizioneEvidenza | null; // richiede geo.allineata
export function localizzaFrammento(geo: GeometriaPagina, frammento: string): PosizioneEvidenza | null; // fuzzy sui tratti
export function annotaEvidenza(
  geometria: ReadonlyArray<GeometriaPagina | null> | undefined,
  evidenza: { pagina: number; frammento: string; posizione?: { inizio: number; fine: number } | null }
): PosizioneEvidenza; // mai null: grado "pagina" quando non trova
export function tokenNormalizzati(testo: string): string[];
```

- [ ] **Step 1: test del localizzatore**

`server/documenti/localizzatore.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { GeometriaPagina } from "@shared/documenti/evidenze";
import { annotaEvidenza, localizzaFrammento, localizzaOffset } from "./localizzatore";

const riga = (inizio: number, y0: number, parole: Array<[string, number, number]>): GeometriaPagina["righe"][number] => {
  let scarto = 0;
  const tratti = parole.map(([testo, x0, x1]) => {
    const t = { testo, inizio: scarto, fine: scarto + testo.length, x0, x1 };
    scarto += testo.length + 1;
    return t;
  });
  return { inizio, y0, y1: y0 + 20, tratti };
};

const testo = ["Sconto 5% -388,11", "Totale merce 7.762,25", "Totale imponibile 7.762,25", "IVA 22% 1.707,70", "Totale documento 9.469,95"];
const inizi = testo.reduce<number[]>((acc, r, i) => [...acc, i === 0 ? 0 : acc[i - 1] + testo[i - 1].length + 1], []);
const geo: GeometriaPagina = {
  larghezza: 1000,
  altezza: 1000,
  allineata: true,
  righe: [
    riga(inizi[0], 100, [["Sconto", 50, 110], ["5%", 120, 150], ["-388,11", 800, 900]]),
    riga(inizi[1], 130, [["Totale", 50, 110], ["merce", 120, 180], ["7.762,25", 800, 900]]),
    riga(inizi[2], 160, [["Totale", 50, 110], ["imponibile", 120, 220], ["7.762,25", 800, 900]]),
    riga(inizi[3], 190, [["IVA", 50, 90], ["22%", 100, 140], ["1.707,70", 800, 900]]),
    riga(inizi[4], 220, [["Totale", 50, 110], ["documento", 120, 220], ["9.469,95", 800, 900]]),
  ],
};

describe("localizzaOffset — geometria allineata", () => {
  it("lo stesso «7.762,25» su due righe: gli scarti scelgono la riga letta", () => {
    const pagina = testo.join("\n");
    const inizio = pagina.indexOf("7.762,25", pagina.indexOf("imponibile"));
    const pos = localizzaOffset(geo, inizio, inizio + "7.762,25".length)!;
    expect(pos.grado).toBe("riquadro");
    expect(pos.frammento).toEqual({ x: 0.8, y: 0.16, w: 0.1, h: 0.02 });
    expect(pos.riga).toMatchObject({ y: 0.16, h: 0.02, x: 0.05 });
    // Due righe sopra e due sotto: dalla riga «Sconto» alla riga «Totale documento».
    expect(pos.contesto).toMatchObject({ y: 0.1, h: 0.14 });
  });
  it("fuori dal testo → null", () => {
    expect(localizzaOffset(geo, 10_000, 10_010)).toBeNull();
  });
});

describe("localizzaFrammento — geometria non allineata (trascrizione del modello)", () => {
  const nonAllineata = { ...geo, allineata: false };
  it("trova le parole con cifre esatte e una lettera di scarto", () => {
    const pos = localizzaFrammento(nonAllineata, "Totale imponibbile 7.762,25")!;
    expect(pos.grado).toBe("riquadro");
    expect(pos.frammento).toEqual({ x: 0.05, y: 0.16, w: 0.85, h: 0.02 });
  });
  it("una cifra diversa non è la stessa cosa", () => {
    expect(localizzaFrammento(nonAllineata, "Totale imponibile 7.762,26")).toBeNull();
  });
});

describe("annotaEvidenza", () => {
  it("senza geometria è la pagina intera; con posizione è il riquadro; con frammento sintetico è la pagina", () => {
    expect(annotaEvidenza(undefined, { pagina: 1, frammento: "x" })).toEqual({ grado: "pagina" });
    const pagina = testo.join("\n");
    const inizio = pagina.indexOf("1.707,70");
    expect(annotaEvidenza([geo], { pagina: 1, frammento: "IVA 22% 1.707,70", posizione: { inizio, fine: inizio + 8 } }).grado).toBe("riquadro");
    expect(annotaEvidenza([geo], { pagina: 1, frammento: "somma di 3 conferme nel file: 1 + 2 + 3" }).grado).toBe("pagina");
  });
});
```

- [ ] **Step 2: eseguire, deve fallire** — modulo assente.

- [ ] **Step 3: implementare `localizzatore.ts`**

```ts
// Localizzatore puro (06/09/2026): da «dove nel testo» a «dove nella pagina».
import type { Area, GeometriaPagina, PosizioneEvidenza, RigaGeometria } from "@shared/documenti/evidenze";

const RIGHE_INTORNO = 2;

function normalizza(geo: GeometriaPagina, x0: number, y0: number, x1: number, y1: number): Area {
  const arrotonda = (v: number) => Math.round(v * 10_000) / 10_000;
  return {
    x: arrotonda(Math.max(0, x0 / geo.larghezza)),
    y: arrotonda(Math.max(0, y0 / geo.altezza)),
    w: arrotonda(Math.min(1, (x1 - x0) / geo.larghezza)),
    h: arrotonda(Math.min(1, (y1 - y0) / geo.altezza)),
  };
}

export function areaDiRiga(geo: GeometriaPagina, indice: number): Area {
  const r = geo.righe[indice];
  const x0 = Math.min(...r.tratti.map(t => t.x0));
  const x1 = Math.max(...r.tratti.map(t => t.x1));
  return normalizza(geo, x0, r.y0, x1, r.y1);
}

export function fasciaDiContesto(geo: GeometriaPagina, indice: number, righeIntorno = RIGHE_INTORNO): Area {
  const da = geo.righe[Math.max(0, indice - righeIntorno)];
  const a = geo.righe[Math.min(geo.righe.length - 1, indice + righeIntorno)];
  return normalizza(geo, 0, da.y0, geo.larghezza, a.y1);
}

function posizioneDaTratti(geo: GeometriaPagina, indiceRiga: number, x0: number, x1: number): PosizioneEvidenza {
  const r = geo.righe[indiceRiga];
  return {
    grado: "riquadro",
    frammento: normalizza(geo, x0, r.y0, x1, r.y1),
    riga: areaDiRiga(geo, indiceRiga),
    contesto: fasciaDiContesto(geo, indiceRiga),
  };
}

function rigaPerOffset(geo: GeometriaPagina, offset: number): number {
  let trovata = -1;
  geo.righe.forEach((r, i) => { if (r.inizio <= offset) trovata = i; });
  return trovata;
}

export function localizzaOffset(geo: GeometriaPagina, inizio: number, fine: number): PosizioneEvidenza | null {
  if (!geo.allineata || geo.righe.length === 0) return null;
  const i = rigaPerOffset(geo, inizio);
  if (i < 0) return null;
  const r = geo.righe[i];
  const lunghezzaRiga = r.tratti.length ? Math.max(...r.tratti.map(t => t.fine)) : 0;
  if (inizio - r.inizio > lunghezzaRiga) return null;
  const daRiga = inizio - r.inizio;
  const aRiga = Math.max(daRiga + 1, fine - r.inizio);
  const toccati = r.tratti.filter(t => t.fine > daRiga && t.inizio < aRiga);
  if (toccati.length === 0) return null;
  return posizioneDaTratti(geo, i, Math.min(...toccati.map(t => t.x0)), Math.max(...toccati.map(t => t.x1)));
}

export function tokenNormalizzati(testo: string): string[] {
  return testo
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9.,%'-]+/)
    .map(t => t.replace(/^[.,'-]+|[.,'-]+$/g, ""))
    .filter(t => t.length > 0);
}

function quasiUguali(a: string, b: string): boolean {
  if (a === b) return true;
  if (/\d/.test(a) || /\d/.test(b)) return false; // cifre esatte
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++diff > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return diff + (a.length - i) + (b.length - j) <= 1;
}

export function localizzaFrammento(geo: GeometriaPagina, frammento: string): PosizioneEvidenza | null {
  const cercati = tokenNormalizzati(frammento);
  if (cercati.length === 0) return null;
  for (const [i, r] of geo.righe.entries()) {
    const parole = r.tratti.flatMap(t => tokenNormalizzati(t.testo).map(tok => ({ tok, t })));
    for (let da = 0; da + cercati.length <= parole.length; da++) {
      let ok = true;
      for (let k = 0; k < cercati.length; k++) {
        if (!quasiUguali(parole[da + k].tok, cercati[k])) { ok = false; break; }
      }
      if (ok) {
        const usati = parole.slice(da, da + cercati.length).map(p => p.t);
        return posizioneDaTratti(geo, i, Math.min(...usati.map(t => t.x0)), Math.max(...usati.map(t => t.x1)));
      }
    }
  }
  return null;
}

export function annotaEvidenza(
  geometria: ReadonlyArray<GeometriaPagina | null> | undefined,
  evidenza: { pagina: number; frammento: string; posizione?: { inizio: number; fine: number } | null }
): PosizioneEvidenza {
  const geo = geometria?.[evidenza.pagina - 1] ?? null;
  if (!geo) return { grado: "pagina" };
  const daOffset = geo.allineata && evidenza.posizione ? localizzaOffset(geo, evidenza.posizione.inizio, evidenza.posizione.fine) : null;
  return daOffset ?? localizzaFrammento(geo, evidenza.frammento) ?? { grado: "pagina" };
}
```

Nota per il test del contesto: `fasciaDiContesto` con `righeIntorno = 2` sulla riga 2 di 5 copre le righe 0–4: `y0 = 100/1000 = 0.1`, `y1 = 240/1000` → `h = 0.14`.

- [ ] **Step 4: `parserRegistry.ts`** — aggiungere `geometria?: Array<GeometriaPagina | null>` a `EsitoParser` (`estratto`); nel parser nativo (versione `"2.1.0"`) usare `pagineConGeometriaDaDocumento(pdf)` e restituire `geometria` (nel `catch` di `pagineNative` il fallback resta senza geometria); in `tentaOcr` restituire `geometria: esitoOcr.pagine.map(p => p.geometria)`; in `tentaVisione`, quando `precedente.esito === "estratto" && precedente.geometria`, allegare all'esito `visione` `geometria: precedente.geometria.map(g => (g ? { ...g, allineata: false } : null))`.

Test in `parserRegistry.visione.test.ts` (caso «con l'identità la foto viene trascritta»): `expect(esito.geometria === undefined || Array.isArray(esito.geometria)).toBe(true)`; e un caso nuovo che passa un `precedente` OCR finto non serve: si copre nel Task 7 con la fixture reale.

- [ ] **Step 5: eseguire** — `pnpm vitest run server/documenti/localizzatore.test.ts server/documenti/parserRegistry.visione.test.ts server/documenti/ocr.test.ts server/documenti/testoPdf.test.ts`.
- [ ] **Step 6: commit** — `git commit -am "feat(documenti): geometria nel registro parser e localizzatore puro delle evidenze"`.

---

### Task 5: posizioni negli estrattori delle conferme

**Files:**
- Modify: `server/documenti/estrazioneConferma.ts`, `server/documenti/estrazioneMerce.ts`, `server/documenti/riscontroCommessa.ts`
- Test: `server/documenti/estrazioneConferma.aree.test.ts` (nuovo), `server/documenti/riscontroCommessa.test.ts`

**Interfaces:**
- `Evidenza` += `posizione?: { inizio: number; fine: number } | null; area?: PosizioneEvidenza | null`; `ESTRATTORE_CONFERMA_VERSIONE = "1.2.0"`; `export function annotaAreeEstrazione(e: EstrazioneConferma, geometria?: ReadonlyArray<GeometriaPagina | null>): EstrazioneConferma`.
- `RigaMerce` += `posizione: { inizio: number; fine: number }; area?: PosizioneEvidenza | null`; `ESTRATTORE_MERCE_VERSIONE = "1.3.0"`; `export function annotaAreeMerce(righe: RigaMerce[], geometria?): RigaMerce[]`.
- `export function evidenzeDelRiscontro(pagine: readonly string[], riscontro: RiscontroCommessa): Array<{ pagina: number; frammento: string; posizione: { inizio: number; fine: number } }>`.

- [ ] **Step 1: test**

`server/documenti/estrazioneConferma.aree.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { annotaAreeEstrazione, estraiConfermaOrdine } from "./estrazioneConferma";
import { annotaAreeMerce, estraiRigheMerce } from "./estrazioneMerce";
import { evidenzeDelRiscontro, riscontroCommessaNelTesto } from "./riscontroCommessa";
import { righeConGeometriaDaElementi } from "./testoPdf";

const el = (str: string, x: number, y: number) => ({ str, transform: [8, 0, 0, 8, x, y], width: str.length * 4.5, height: 8 });
const misure = { larghezza: 600, altezza: 800, aVista: (x: number, y: number): [number, number] => [x, 800 - y] };
const { testo, righe } = righeConGeometriaDaElementi(
  [
    el("CONFERMA D'ORDINE n. CO-556 del 19/02/2026", 40, 760),
    el("Vs. riferimento: GIACOMAZZI GIULIA", 40, 740),
    el("1   G71 SISTEMA SCORREVOLE   2 pz   1.292,19", 40, 700),
    el("Totale merce", 40, 660), el("7.762,25", 400, 660),
    el("Totale imponibile", 40, 640), el("7.762,25", 400, 640),
    el("IVA 22%", 40, 620), el("1.707,70", 400, 620),
  ],
  misure
);
const geometria = [{ larghezza: 600, altezza: 800, allineata: true, righe }];

describe("le evidenze delle conferme portano la posizione e l'area", () => {
  it("l'imponibile punta alla riga «Totale imponibile», non a «Totale merce»", () => {
    const estrazione = annotaAreeEstrazione(
      estraiConfermaOrdine([testo], { codiceOrdine: null, fornitoreNome: null, righeOrdine: [] }),
      geometria
    );
    const ev = estrazione.imponibileDocumento!.evidenza;
    expect(ev.posizione).toBeTruthy();
    expect(ev.area?.grado).toBe("riquadro");
    const rigaImponibile = righe.findIndex(r => r.tratti.some(t => t.testo === "imponibile"));
    expect(ev.area?.riga?.y).toBeCloseTo(righe[rigaImponibile].y0 / 800, 3);
    expect(estrazione.numeroConferma?.evidenza.area?.grado).toBe("riquadro");
  });
  it("le righe di merce e le prove del riscontro si localizzano", () => {
    const merce = annotaAreeMerce(estraiRigheMerce([testo]), geometria);
    expect(merce[0].area?.grado).toBe("riquadro");
    const riscontro = riscontroCommessaNelTesto([testo], { codice: "COM-2026-393", cliente: "Giacomazzi Giulia", cognome: "Giacomazzi", indirizzo: null, citta: null });
    expect(riscontro.ok).toBe(true);
    const evidenze = evidenzeDelRiscontro([testo], riscontro);
    expect(evidenze.length).toBeGreaterThan(0);
    expect(testo.slice(evidenze[0].posizione.inizio, evidenze[0].posizione.fine).toLowerCase()).toContain("giacomazzi");
  });
});
```

(Adattare i nomi dei campi di `RiferimentiCommessa` a quelli reali del tipo se differiscono: leggere le righe 15–30 di `riscontroCommessa.ts`.)

- [ ] **Step 2: eseguire, deve fallire**.

- [ ] **Step 3: implementare**

`estrazioneConferma.ts`: nel tipo `Evidenza` aggiungere `posizione?: { inizio: number; fine: number } | null; area?: PosizioneEvidenza | null;`. Nell'helper `evidenza(...)` aggiungere `posizione: { inizio: indice, fine: indice + lunghezzaMatch }`. Nel sito della riga articolo (≈ r. 900) calcolare `const inizioRiga = Math.max(0, testoPagina.lastIndexOf("\n", primo.match.index) + 1)` e aggiungere `posizione: { inizio: inizioRiga, fine: fineRiga === -1 ? testoPagina.length : fineRiga }`. Versione `"1.2.0"` con nota nel commento di versione. Aggiungere:

```ts
export function annotaAreeEstrazione(
  e: EstrazioneConferma,
  geometria?: ReadonlyArray<GeometriaPagina | null>
): EstrazioneConferma {
  const conArea = <T>(c: CampoEstratto<T> | null | undefined): CampoEstratto<T> | null =>
    c ? { ...c, evidenza: { ...c.evidenza, area: annotaEvidenza(geometria, c.evidenza) } } : null;
  const lista = <T>(l: Array<CampoEstratto<T>> | undefined) => (l ?? []).map(c => conArea(c)!);
  return {
    ...e,
    riferimentoOrdine: conArea(e.riferimentoOrdine),
    codiciCommessaCitati: lista(e.codiciCommessaCitati),
    fornitoreCitato: conArea(e.fornitoreCitato),
    numeroConferma: conArea(e.numeroConferma),
    riferimentoCliente: conArea(e.riferimentoCliente),
    dataDocumento: conArea(e.dataDocumento),
    dateConsegna: lista(e.dateConsegna),
    settimaneConsegna: lista(e.settimaneConsegna),
    settimaneApprontamento: e.settimaneApprontamento?.map(c => ({ ...c, evidenza: { ...c.evidenza, area: annotaEvidenza(geometria, c.evidenza) } })),
    totaleDocumento: conArea(e.totaleDocumento),
    imponibileDocumento: conArea(e.imponibileDocumento),
    righe: e.righe.map(r => ({ ...r, quantitaDocumento: conArea(r.quantitaDocumento) })),
  };
}
```

`estrazioneMerce.ts`: in `estraiRigheMerce` calcolare `const linee = testo.split(/\r?\n/)` (grezze) e `const inizi` cumulativi; la riga nuova porta `posizione: { inizio: inizi[i], fine: inizi[i] + linee[i].length }` (con `usaRigaSotto` la `fine` è quella della riga sotto). Versione `"1.3.0"`. Aggiungere `annotaAreeMerce(righe, geometria)` che mappa `area: annotaEvidenza(geometria, { pagina: r.pagina, frammento: r.evidenza, posizione: r.posizione })`.

`riscontroCommessa.ts`: aggiungere una normalizzazione con mappa (stesse regole di `normalizza`: senza accenti, minuscolo, ogni sequenza non alfanumerica → uno spazio) che restituisce `{ testo, mappa: number[] }`; poi

```ts
export function evidenzeDelRiscontro(
  pagine: readonly string[],
  riscontro: RiscontroCommessa
): Array<{ pagina: number; frammento: string; posizione: { inizio: number; fine: number } }> {
  const esiti: Array<{ pagina: number; frammento: string; posizione: { inizio: number; fine: number } }> = [];
  for (const prova of riscontro.prove) {
    const [tipo, ...resto] = prova.split(" ");
    const cercato = normalizza(resto.join(" ").replace(/^~/, ""));
    const tokens = cercato.split(" ").filter(Boolean);
    if (tokens.length === 0) continue;
    for (const [i, pagina] of pagine.entries()) {
      const { testo, mappa } = normalizzaConMappa(pagina);
      const trovato = tipo === "ordine"
        ? cercaSenzaSpazi(testo, mappa, cercato.replace(/ /g, ""))
        : cercaParole(testo, mappa, tokens, prova.includes(" ~"));
      if (!trovato) continue;
      const frammento = pagina.slice(Math.max(0, trovato.inizio - 40), Math.min(pagina.length, trovato.fine + 40)).replace(/\s+/g, " ").trim();
      esiti.push({ pagina: i + 1, frammento, posizione: trovato });
      break;
    }
  }
  return esiti;
}
```

dove `cercaParole` trova la prima finestra di token consecutivi (o vicini entro 3, sulla stessa riga) uguali ai tokens (con `quasiUguali` se `fuzzy`), e `cercaSenzaSpazi` cerca la stringa compatta nel testo normalizzato senza spazi mantenendo la mappa; entrambe ritornano `{ inizio, fine }` sul testo ORIGINALE tramite `mappa`.

- [ ] **Step 4: eseguire** — `pnpm vitest run server/documenti/estrazioneConferma.aree.test.ts server/documenti/estrazioneConferma.test.ts server/documenti/estrazioneConferma.layout.test.ts server/documenti/estrazioneMerce.test.ts server/documenti/riscontroCommessa.test.ts server/documenti/analisiConferma.test.ts` (i test esistenti che confrontano `Evidenza` con `toEqual` vanno aggiornati con `posizione` o convertiti a `toMatchObject`).
- [ ] **Step 5: commit** — `git commit -am "feat(documenti): gli estrattori scrivono la posizione del match e le evidenze hanno un'area"`.

---

### Task 6: evidenze e merce persistite con il costo (lettura 1.9.0)

**Files:**
- Modify: `server/commesse/letturaCostoTipi.ts`, `server/commesse/costoDaConferma.ts`, `server/routers/magazzino.ts`
- Test: `server/commesse/costoDaConferma.test.ts`, `server/commesse/costoDaConferma.rilettura.test.ts`

**Interfaces:**
- `LetturaCostoDocumento.evidenze?: EvidenzeLetturaCosto | null`; `VERSIONE_LETTURA_COSTO = "1.9.0"`.
- `Prodotto.evidenza?: EvidenzaLetta | null`; `creaProdottiDaConferma.righe[i].evidenza?: EvidenzaLetta | null`.

- [ ] **Step 1: test**

In `costoDaConferma.test.ts` (accanto al test «registra il costo una volta all'upload», con la stessa fixture `pdfConTesto`):

```ts
it("la lettura ricorda dove ha letto imponibile e fornitore, e le righe di magazzino la loro riga", async () => {
  const { commessa, documento } = await scenarioConConferma(/* stessa fixture del test sopra */);
  const lettura = documentoDaId(documento.id).letturaCosto!;
  expect(lettura.versione).toBe("1.9.0");
  expect(lettura.evidenze?.imponibile?.pagina).toBe(1);
  expect(lettura.evidenze?.imponibile?.frammento).toContain("imponibile");
  expect(lettura.evidenze?.imponibile?.area?.grado).toBe("riquadro");
  const righe = prodottiDelDocumento(documento.id);
  expect(righe[0].evidenza?.area?.grado).toBe("riquadro");
});
```

In `costoDaConferma.rilettura.test.ts`: dopo un costo registrato con una lettura salvata a mano con `versione: "1.8.0"` e senza `evidenze`, il giro del worker deve lasciare `importo` identico e aggiungere `evidenze` (`expect(costo.importo).toBe(primaImporto); expect(lettura.evidenze?.imponibile).toBeTruthy()`).

- [ ] **Step 2: eseguire, deve fallire**.

- [ ] **Step 3: implementare**

`letturaCostoTipi.ts`: `VERSIONE_LETTURA_COSTO = "1.9.0"` (commento: «1.9.0 (06/09/2026): evidenze localizzate per campo, merce con evidenza»); campo `evidenze?: EvidenzeLetturaCosto | null` con import da `@shared/documenti/evidenze`.

`costoDaConferma.ts`, dopo `documentoLetto`:

```ts
const geometria = parser.geometria ?? [];
const estrazioneAnnotata = annotaAreeEstrazione(estrazione, geometria);
const letta = (c: { evidenza: Evidenza } | null | undefined): EvidenzaLetta | null =>
  c ? { pagina: c.evidenza.pagina, frammento: c.evidenza.frammento, area: c.evidenza.area ?? null } : null;
const evidenze: EvidenzeLetturaCosto = {
  imponibile: letta(estrazioneAnnotata.imponibileDocumento),
  totale: letta(estrazioneAnnotata.totaleDocumento),
  fornitore: letta(estrazioneAnnotata.fornitoreCitato),
  numeroConferma: letta(estrazioneAnnotata.numeroConferma),
  dataDocumento: letta(estrazioneAnnotata.dataDocumento),
  riferimentoOrdine: letta(estrazioneAnnotata.riferimentoOrdine),
  riferimentoCliente: letta(estrazioneAnnotata.riferimentoCliente),
  consegna: letta(estrazioneAnnotata.dateConsegna[0] ?? estrazioneAnnotata.settimaneConsegna[0]),
  approntamento: letta(estrazioneAnnotata.settimaneApprontamento?.[0]),
  riscontro: [],
};
```

`evidenze` entra in `memoriaBase`. Dopo il riscontro (quando calcolato): `evidenze.riscontro = evidenzeDelRiscontro(parser.pagine, riscontro).map(e => ({ pagina: e.pagina, frammento: e.frammento, area: annotaEvidenza(geometria, e) }))`. In `applicaMerceDaConferma` le righe passano `evidenza: { pagina: r.pagina, frammento: r.evidenza, area: r.area ?? null }` con `righe = annotaAreeMerce(estraiRigheMerce(input.pagine), input.geometria)` (aggiungere `geometria` all'input della funzione).

`magazzino.ts`: `Prodotto.evidenza?: EvidenzaLetta | null`, backfill `if ((p as any).evidenza === undefined) (p as any).evidenza = null;`, `creaProdottiDaConferma` copia `evidenza: r.evidenza ?? null`. Verificare che la query di lettura del magazzino (`magazzino.list` o simile) restituisca i record interi (così `evidenza` arriva al client senza altro).

- [ ] **Step 4: eseguire** — `pnpm vitest run server/commesse/`.
- [ ] **Step 5: commit** — `git commit -am "feat(commesse): lettura costo 1.9.0, evidenze localizzate per campo e sulle righe di magazzino"`.

---

### Task 7: aree nella lettura del contratto

**Files:**
- Modify: `shared/contratti/estrazione.ts`, `shared/limiti/tipi.ts`, `server/contratti/servizio.ts`, `server/contratti/estrazione/evidenze.ts`, `server/contratti/estrazione/servizio.ts`
- Create: `server/contratti/estrazione/aree.ts`
- Test: `server/contratti/estrazione/evidenze.test.ts`, `server/contratti/estrazione/servizio.test.ts`

**Interfaces:**
- `EvidenzaEstratta = { pagina; frammento; posizione?: { inizio; fine } | null; area?: PosizioneEvidenza | null }`.
- `RigaContratto.evidenza: { pagina; frammento; area?: PosizioneEvidenza | null } | null`.
- `annotaAreeProposta(p: PropostaContratto, geometria?: ReadonlyArray<GeometriaPagina | null>): PropostaContratto`.

- [ ] **Step 1: test** — in `evidenze.test.ts`: `verificaEvidenza(["Totale IVA Incl. 12.000,00"], 1, "totale iva incl 12.000,00")` restituisce `posizione` con `pagine[0].slice(inizio, fine)` che contiene `12.000,00`. In `servizio.test.ts` (caso «(h) il testo da OCR resta segnato» o un caso a testo nativo): dopo `eseguiEstrazioneContratto` con `estraiTesto` finto che restituisce anche `geometria` costruita con `righeConGeometriaDaElementi`, `estrazione.proposta.pattuitoCent.evidenza?.area?.grado === "riquadro"`.

- [ ] **Step 2: eseguire, deve fallire**.

- [ ] **Step 3: implementare** — `verificaEvidenza` restituisce `{ pagina, frammento, posizione: { inizio, fine } }`. `aree.ts`:

```ts
import type { GeometriaPagina } from "@shared/documenti/evidenze";
import type { CampoProposto, PropostaContratto, RigaProposta } from "@shared/contratti/estrazione";
import { annotaEvidenza } from "../../documenti/localizzatore";

export function annotaAreeProposta(p: PropostaContratto, geometria?: ReadonlyArray<GeometriaPagina | null>): PropostaContratto {
  const campo = <T>(c: CampoProposto<T>): CampoProposto<T> =>
    c.evidenza ? { ...c, evidenza: { ...c.evidenza, area: annotaEvidenza(geometria, c.evidenza) } } : c;
  const riga = (r: RigaProposta): RigaProposta => ({
    ...r,
    categoria: campo(r.categoria), tipologia: campo(r.tipologia), descrizione: campo(r.descrizione),
    quantita: campo(r.quantita), larghezzaMm: campo(r.larghezzaMm), altezzaMm: campo(r.altezzaMm),
    prezzoTotCent: campo(r.prezzoTotCent), oscuranteIntegrato: campo(r.oscuranteIntegrato), oscuranteTipologia: campo(r.oscuranteTipologia),
  });
  return {
    ...p,
    righe: p.righe.map(riga),
    pattuitoCent: campo(p.pattuitoCent), pattuitoTipo: campo(p.pattuitoTipo), posaInclusa: campo(p.posaInclusa), posaCent: campo(p.posaCent),
    rate: campo(p.rate), comuneCantiere: campo(p.comuneCantiere), indirizzoCantiere: campo(p.indirizzoCantiere), piano: campo(p.piano),
    dataFirma: campo(p.dataFirma), riferimento: campo(p.riferimento), clienteCitato: campo(p.clienteCitato), detrazioneTipo: campo(p.detrazioneTipo),
  };
}
```

In `estrazione/servizio.ts`, dopo l'arricchimento WnD: `proposta = annotaAreeProposta(proposta, esitoParser.geometria)`. In `contratti/servizio.ts` lo zod di `evidenza` accetta `area: z.object({ grado: z.enum(["riquadro","zona","pagina"]), frammento: areaSchema.optional(), riga: areaSchema.optional(), contesto: areaSchema.optional() }).nullable().optional()` con `areaSchema = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })`. `shared/limiti/tipi.ts` aggiorna il tipo di `RigaContratto.evidenza`. `contrattoView.rigaDaProposta` copia `r.descrizione.evidenza` intero (già così: l'`area` viaggia da sola).

- [ ] **Step 4: eseguire** — `pnpm vitest run server/contratti/`.
- [ ] **Step 5: commit** — `git commit -am "feat(contratti): le evidenze della proposta e delle righe applicate portano l'area"`.

---

### Task 8: rendering, storage e rotta delle pagine

**Files:**
- Create: `server/documenti/anteprime.ts`, `server/_core/anteprimaRoutes.ts`
- Modify: `server/routers/preventiviContratti.ts`, `server/_core/index.ts`
- Test: `server/documenti/anteprime.test.ts`, `server/_core/anteprimaRoutes.test.ts`

**Interfaces:**

```ts
// server/documenti/anteprime.ts
export const ANTEPRIME_VERSIONE = 1;
export const ANTEPRIME_DPI = 150;
export const ANTEPRIME_QUALITA = 75;
export const ANTEPRIME_MAX_PAGINE = 20;
export const ANTEPRIME_MAX_BYTE = 15 * 1024 * 1024;
export type AnteprimeDocumento = { versione: number; checksum: string | null; formato: "jpeg" | "originale"; dpi: number; pagine: number; chiavi: string[] };
export function anteprimeAttive(): boolean;
export async function rendiAnteprime(input: { documento: Documento; sedeId: number; bytes: Buffer }): Promise<AnteprimeDocumento | null>;
export async function scaldaAnteprime(documento: Documento, sedeId: number, bytes: Buffer): Promise<void>; // best-effort, mai lancia
export type EsitoAnteprima = { esito: "ok"; buffer: Buffer; mimeType: string } | { esito: "fuori_intervallo" } | { esito: "non_disponibile"; motivo: string };
export async function leggiAnteprima(documentoId: number, sedeId: number, pagina: number): Promise<EsitoAnteprima>;
// server/routers/preventiviContratti.ts
export function salvaAnteprimeDocumento(documentoId: number, anteprime: AnteprimeDocumento | null): void;
// Documento.anteprime?: AnteprimeDocumento | null (backfill null)
```

- [ ] **Step 1: test del servizio** (`anteprime.test.ts`, storage mock come in `analisiConferma.test.ts`, `describe.skipIf(!binariPresenti)` per il rendering vero):

```ts
it("rende le pagine in JPEG una volta sola e le ricorda sul documento", async () => {
  const bytes = pdfConTesto(["Conferma", "Totale imponibile 100,00"]);
  const documento = documentoFinto({ id: 7, mimeType: "application/pdf", checksum: sha256Hex(bytes) });
  const prima = await rendiAnteprime({ documento, sedeId: 1, bytes });
  expect(prima).toMatchObject({ versione: 1, formato: "jpeg", pagine: 1 });
  expect(memoriaStorage.get(prima!.chiavi[0])!.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  const letta = await leggiAnteprima(7, 1, 1);
  expect(letta.esito).toBe("ok");
  expect(await leggiAnteprima(7, 1, 2)).toEqual({ esito: "fuori_intervallo" });
  expect((await leggiAnteprima(7, 2, 1)).esito).toBe("non_disponibile"); // altra sede
});
it("una foto non si rende: la pagina è il file stesso", async () => {
  const documento = documentoFinto({ id: 8, mimeType: "image/jpeg" });
  expect(await rendiAnteprime({ documento, sedeId: 1, bytes: Buffer.from([0xff, 0xd8, 0xff, 0]) })).toMatchObject({ formato: "originale", pagine: 1, chiavi: [] });
});
it("con l'interruttore spento non rende e non legge", async () => {
  process.env.FLAG_ANTEPRIME_EVIDENZE = "off";
  expect(await rendiAnteprime({ documento: documentoFinto({ id: 9 }), sedeId: 1, bytes: pdfConTesto(["x"]) })).toBeNull();
});
```

`documentoFinto` inserisce il documento nello store dei documenti attraverso l'helper già usato dai test di `costoDaConferma` (cercare `caricaDocumentoCommessaDaBuffer` o l'inserimento diretto nello store nei test esistenti e riusarlo).

- [ ] **Step 2: test della rotta** (`anteprimaRoutes.test.ts`, Express in-process con `supertest` se presente, altrimenti `http.request` su `localhost` come fanno i test esistenti delle rotte — cercare `commessaFileRoutes.test.ts` e copiarne l'impianto): senza sessione `401`; documento di altra sede `404`; pagina `0` o oltre `404`; pagina valida `200` con `content-type: image/jpeg`, `cache-control: private, max-age=86400`, `etag` presente e `304` con `if-none-match`; flag spento `404`.

- [ ] **Step 3: eseguire, deve fallire**.

- [ ] **Step 4: implementare**

`anteprime.ts`: `rendiAnteprime` → se `!anteprimeAttive()` `null`; se `bytes.length > ANTEPRIME_MAX_BYTE` `null`; immagine (`/^image\//`) → `{ versione, checksum, formato: "originale", dpi: 0, pagine: 1, chiavi: [] }`; PDF → `renderizzaPagine(bytes, { dpi: ANTEPRIME_DPI, maxPagine: ANTEPRIME_MAX_PAGINE, timeoutMs: 60_000, formato: "jpeg", qualita: ANTEPRIME_QUALITA })`; errore → log `[anteprime] rendering fallito` e `null`; per ogni immagine `putFile("anteprime", sedeId, documento.id, `${checksum ?? "senza-impronta"}-p${n}.jpg`, buffer, "image/jpeg")` raccogliendo `storageKey`; poi `salvaAnteprimeDocumento(documento.id, meta)`; `finally` libera nulla (le immagini sono in memoria). Una `Map<number, Promise<…>>` `inCorso` per documento evita doppi rendering. `scaldaAnteprime` = `rendiAnteprime` dentro `try/catch` con `console.warn`, saltando se `documento.anteprime` è valido (stessa `versione` e `checksum`). `leggiAnteprima`: `getDocumentoCommessaById(documentoId, sedeId)` → `non_disponibile` se manca; se `anteprime` non valido → `leggiDocumentoCommessaDaStorage` + `rendiAnteprime`; `pagina < 1 || pagina > pagine` → `fuori_intervallo`; `formato === "originale"` → byte del documento con il suo mime; altrimenti `getFile(chiavi[pagina - 1])` → `ok` / `non_disponibile`.

`preventiviContratti.ts`: campo `anteprime?: AnteprimeDocumento | null` sul tipo `Documento` (import di tipo da `../documenti/anteprime`), backfill `if ((d as any).anteprime === undefined) (d as any).anteprime = null;`, funzione `salvaAnteprimeDocumento`, e in `delete` (dopo `deleteFileQuiet(doc.storageKey)`): `for (const chiave of doc.anteprime?.chiavi ?? []) deleteFileQuiet(chiave);`.

`anteprimaRoutes.ts`:

```ts
export function registerAnteprimaRoutes(app: Express): void {
  app.get("/api/documenti/:documentoId/pagina/:pagina", async (req, res, next) => {
    try {
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      if (!sameOrigin(req)) { res.status(403).json({ error: "Cross-origin request blocked" }); return; }
      if (!interruttoreAttivo("anteprimeEvidenze")) { res.status(404).end(); return; }
      const context = await createContext({ req, res });
      if (!context.user || context.sedeId == null) { res.status(401).json({ error: "Autenticazione richiesta" }); return; }
      const documentoId = Number(req.params.documentoId);
      const pagina = Number(req.params.pagina);
      if (!Number.isSafeInteger(documentoId) || !Number.isSafeInteger(pagina) || pagina < 1) { res.status(404).end(); return; }
      const documento = getDocumentoCommessaById(documentoId, context.sedeId);
      if (!documento) { res.status(404).end(); return; }
      const etag = `"anteprima:${documento.checksum ?? documentoId}:${pagina}:${ANTEPRIME_VERSIONE}"`;
      if (req.headers["if-none-match"] === etag) { res.status(304).end(); return; }
      const letta = await leggiAnteprima(documentoId, context.sedeId, pagina);
      if (letta.esito === "fuori_intervallo") { res.status(404).end(); return; }
      if (letta.esito === "non_disponibile") { res.status(503).json({ error: letta.motivo }); return; }
      res.setHeader("Content-Type", letta.mimeType);
      res.setHeader("Cache-Control", "private, max-age=86400");
      res.setHeader("ETag", etag);
      res.setHeader("Content-Length", letta.buffer.length);
      res.end(letta.buffer);
    } catch (error) { next(error); }
  });
}
```

(`sameOrigin` copiata da `commessaFileRoutes.ts`; se lì esiste anche `isCrossSiteRequest`, esportarla e usarla al posto della copia.) In `index.ts`, dopo `registerAllegatoMailRoutes(app)`: `const { registerAnteprimaRoutes } = await import("./anteprimaRoutes"); registerAnteprimaRoutes(app);`.

- [ ] **Step 5: eseguire** — `pnpm vitest run server/documenti/anteprime.test.ts server/_core/anteprimaRoutes.test.ts`.
- [ ] **Step 6: commit** — `git commit -am "feat(documenti): pagine rese in JPEG nello storage e rotta /api/documenti/:id/pagina/:n dietro flag"`.

---

### Task 9: scaldata nei worker e query `evidenzeDocumento`

**Files:**
- Modify: `server/commesse/costoDaConferma.ts`, `server/documenti/analisi.ts`, `server/contratti/estrazione/servizio.ts`, `server/routers/preventiviContratti.ts`
- Test: `server/commesse/costoDaConferma.test.ts`, `server/routers/preventiviContratti.evidenze.test.ts` (nuovo)

**Interfaces:**
- `DipendenzeCostoDaConferma.scaldaAnteprime?: (documento: Documento, buffer: Buffer) => Promise<void>` (default reale).
- tRPC `preventiviContratti.evidenzeDocumento({ documentoId }) → { documentoId, nome, mimeType, fonteTesto, confidenzaOcr: null, evidenze: EvidenzeLetturaCosto | null, valori: { imponibile, fornitore, numeroOrdine, dataDocumento }, anteprime: { pagine: number; formato: "jpeg" | "originale" } | null }`.

- [ ] **Step 1: test** — in `costoDaConferma.test.ts` il worker (`ocr: true`) chiama `scaldaAnteprime` una volta per documento letto (dependency spy). In `preventiviContratti.evidenze.test.ts`: documento con `letturaCosto.evidenze` → la query le restituisce; documento di altra sede → `NOT_FOUND`.

- [ ] **Step 2: eseguire, deve fallire**.

- [ ] **Step 3: implementare** — in `costoDaConferma.ts` dopo il parser riuscito e solo con `input.ocr === true` (percorso worker/esplicito): `await deps.scaldaAnteprime(documento, raw.buffer)`; default `dipendenzeCostoDaConfermaReali().scaldaAnteprime = (documento, buffer) => scaldaAnteprime(documento, Number(commessaSede(documento)), buffer)` — la sede si legge dalla commessa del documento (`getCommessaById(documento.commessaId)?.sedeId ?? 1`). In `analisi.ts` dopo `estraiTestoDocumento`: `estrazione = annotaAreeEstrazione(estrazione, esitoParser.geometria)` e `void scaldaAnteprime(documentoStore, input.sedeId, bytes)` quando il documento del fascicolo è reperibile (l'analisi riceve `DocumentoDaAnalizzare`: aggiungere una dipendenza opzionale `scalda?: (bytes: Buffer) => Promise<void>` che il router collega al documento vero). In `estrazione/servizio.ts` dopo `estrai(...)` riuscito: `await scaldaAnteprime(documento, sedeId, buffer)` in `try/catch` (mai fallire l'estrazione). Query in `preventiviContratti.ts`:

```ts
evidenzeDocumento: protectedProcedure
  .input(z.object({ documentoId: z.number().int().positive() }))
  .query(({ input, ctx }) => {
    const sedeId = ctx.sedeId ?? DEFAULT_SEDE_ID;
    const documento = documenti.find(d => d.id === input.documentoId);
    if (!documento || !commessaInSede(documento.commessaId, sedeId)) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Documento non trovato" });
    }
    const lettura = documento.letturaCosto ?? null;
    return {
      documentoId: documento.id,
      nome: documento.nome,
      mimeType: documento.mimeType,
      fonteTesto: lettura?.fonteTesto ?? null,
      confidenzaOcr: null as number | null,
      evidenze: lettura?.evidenze ?? null,
      valori: {
        imponibile: lettura?.imponibile ?? null,
        fornitore: lettura?.fornitore ?? null,
        numeroOrdine: lettura?.numeroOrdine ?? null,
        dataDocumento: lettura?.dataDocumento ?? null,
      },
      anteprime: documento.anteprime ? { pagine: documento.anteprime.pagine, formato: documento.anteprime.formato } : null,
    };
  }),
```

- [ ] **Step 4: eseguire** — `pnpm vitest run server/commesse server/routers/preventiviContratti.evidenze.test.ts server/documenti/analisiConferma.test.ts`.
- [ ] **Step 5: commit** — `git commit -am "feat(documenti): anteprime scaldate dopo ogni lettura e query evidenzeDocumento"`.

---

### Task 10: `client/src/lib/anteprime.ts` e componente `DoveLetto`

**Files:**
- Create: `client/src/lib/anteprime.ts`, `client/src/lib/anteprime.test.ts`, `client/src/components/documenti/DoveLetto.tsx`
- Modify: `client/src/components/ui/popover.tsx` (esporta `PopoverArrow`)

**Interfaces:**

```ts
// client/src/lib/anteprime.ts
export function urlPaginaDocumento(documentoId: number, pagina: number): string; // `/api/documenti/${id}/pagina/${pagina}`
export function urlPdfAllaPagina(documentoId: number, pagina: number): string; // `/api/documenti/${id}/file#page=${pagina}`
export type Ritaglio = { scala: number; larghezza: number; altezza: number; offsetX: number; offsetY: number; rettangolo: { left: number; top: number; width: number; height: number } | null };
export function calcolaRitaglio(input: { posizione: PosizioneEvidenza | null; paginaIntera: boolean; larghezzaImmagine: number; altezzaImmagine: number; larghezzaVista: number; altezzaMassima: number; altezzaRigaMinima: number; scalaMassima?: number }): Ritaglio;
export function etichettaFonte(fonte: FonteTesto | null | undefined, confidenzaOcr?: number | null): string; // "testo nativo" | "OCR 91%" | "trascrizione del modello" | "fonte sconosciuta"
export function etichettaGrado(grado: GradoPosizione | null): string; // "riquadro" | "zona" | "pagina intera"
```

Regole di `calcolaRitaglio`: pagina intera o `posizione` nulla/`grado: "pagina"` → `scala = larghezzaVista / larghezzaImmagine`, `altezza = min(altezzaMassima, altezzaImmagine * scala)`, offset 0; altrimenti fascia = `contesto ?? riga ?? frammento`; `scala = min(scalaMassima ?? 1.25, larghezzaVista / (fascia.w * larghezzaImmagine))`; se `riga` c'è e `riga.h * altezzaImmagine * scala < altezzaRigaMinima` allora `scala = altezzaRigaMinima / (riga.h * altezzaImmagine)`; `offsetX = fascia.x * W * scala`, ma se `fascia.w * W * scala > larghezzaVista` la finestra si centra sul frammento: `offsetX = clamp((frammento.x + frammento.w / 2) * W * scala - larghezzaVista / 2, 0, W * scala - larghezzaVista)`; `offsetY = fascia.y * H * scala`; `altezza = min(altezzaMassima, fascia.h * H * scala)`; `rettangolo` = frammento in coordinate della vista (`left = frammento.x * W * scala - offsetX`, ecc.), `null` senza frammento.

- [ ] **Step 1: test** (`client/src/lib/anteprime.test.ts`, gira con vitest perché `client/src/lib/**/*.test.ts` è incluso):

```ts
import { describe, expect, it } from "vitest";
import { calcolaRitaglio, urlPdfAllaPagina } from "./anteprime";

const posizione = { grado: "riquadro" as const, frammento: { x: 0.8, y: 0.16, w: 0.1, h: 0.02 }, riga: { x: 0.05, y: 0.16, w: 0.85, h: 0.02 }, contesto: { x: 0, y: 0.1, w: 1, h: 0.14 } };

describe("calcolaRitaglio", () => {
  it("la fascia di contesto entra tutta nella vista quando ci sta", () => {
    const r = calcolaRitaglio({ posizione, paginaIntera: false, larghezzaImmagine: 1240, altezzaImmagine: 1754, larghezzaVista: 480, altezzaMassima: 400, altezzaRigaMinima: 12 });
    expect(r.scala).toBeCloseTo(480 / 1240, 4);
    expect(r.offsetY).toBeCloseTo(0.1 * 1754 * r.scala, 3);
    expect(r.rettangolo!.left).toBeCloseTo(0.8 * 1240 * r.scala, 3);
  });
  it("se la riga resterebbe illeggibile la scala sale e la finestra si centra sul frammento", () => {
    const r = calcolaRitaglio({ posizione, paginaIntera: false, larghezzaImmagine: 1240, altezzaImmagine: 1754, larghezzaVista: 320, altezzaMassima: 400, altezzaRigaMinima: 14 });
    expect(0.02 * 1754 * r.scala).toBeGreaterThanOrEqual(14);
    expect(r.offsetX).toBeGreaterThan(0);
  });
  it("pagina intera: tutta la larghezza, altezza limitata", () => {
    const r = calcolaRitaglio({ posizione: null, paginaIntera: true, larghezzaImmagine: 1240, altezzaImmagine: 1754, larghezzaVista: 480, altezzaMassima: 400, altezzaRigaMinima: 12 });
    expect(r.offsetX).toBe(0);
    expect(r.altezza).toBe(400);
  });
  it("il link al PDF apre la pagina giusta", () => {
    expect(urlPdfAllaPagina(12, 3)).toBe("/api/documenti/12/file#page=3");
  });
});
```

- [ ] **Step 2: eseguire, deve fallire**.
- [ ] **Step 3: implementare `anteprime.ts`** secondo le regole sopra; `popover.tsx` esporta `PopoverArrow` (`PopoverPrimitive.Arrow` con `className="fill-popover"`).
- [ ] **Step 4: implementare `DoveLetto.tsx`**

```tsx
// Il tasto «Dove l'ho letto» e la vignetta con il ritaglio della pagina.
// Spec: docs/superpowers/specs/2026-09-06-anteprime-evidenze-design.md §2, §5.
import { useEffect, useRef, useState } from "react";
import { ScanSearch } from "lucide-react";
import type { EvidenzaLetta, FonteTesto } from "@shared/documenti/evidenze";
import { trpc } from "@/lib/trpc";
import { calcolaRitaglio, etichettaFonte, etichettaGrado, urlPaginaDocumento, urlPdfAllaPagina } from "@/lib/anteprime";
import { Button } from "@/components/ui/button";
import { Popover, PopoverArrow, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Props = {
  documentoId: number;
  /** Evidenza inline; se assente e `campo` è dato, si legge da `preventiviContratti.evidenzeDocumento`. */
  evidenza?: EvidenzaLetta | null;
  campo?: "imponibile" | "totale" | "fornitore" | "numeroConferma" | "dataDocumento" | "riferimentoOrdine" | "riferimentoCliente" | "consegna" | "approntamento" | "riscontro";
  fonte?: FonteTesto | null;
  confidenzaOcr?: number | null;
  valoreLetto?: string | null;
  valoreAttuale?: string | null;
  etichetta?: string;
};
```

Comportamento: il tasto è un `<Button variant="ghost" size="icon" className="h-7 w-7 min-h-10 min-w-10 sm:min-h-7 sm:min-w-7" aria-label="Dove l'ho letto" title="Dove l'ho letto">` con `ScanSearch`; nascosto quando `interruttori.data?.anteprimeEvidenze` è falso o quando `evidenza === null` in modalità inline; in modalità `campo` la query parte solo all'apertura (`enabled: aperto`). `PopoverContent side="top" align="center" collisionPadding={12} className="w-[min(92vw,480px)] p-2"` con `PopoverArrow`. Dentro: riga didascalia (`pag. N · {etichettaFonte} · {etichettaGrado}`), scatola `overflow-hidden relative` con altezza dal ritaglio; `<img src={urlPaginaDocumento(...)} onLoad={e => setMisure({w: e.currentTarget.naturalWidth, h: …})} style={{ transform: `translate(${-offsetX}px, ${-offsetY}px) scale(${scala})`, transformOrigin: "0 0" }} className="max-w-none">`; rettangolo `<div className="absolute border-2 border-accent pointer-events-none" style={{ left, top, width, height }}>`; scheletro `animate-pulse bg-surface-2` finché non c'è `misure`; su errore immagine testo «anteprima non disponibile, apri il PDF». Sotto: `«{frammento}»`, riga «letto X, oggi Y» se entrambi e diversi, due `Button size="sm" variant="outline"`: «Pagina intera» (toggle `paginaIntera`) e «Apri PDF» (`window.open(urlPdfAllaPagina(documentoId, pagina), "_blank", "noopener,noreferrer")`). Prefetch: `onMouseEnter` → `new Image().src = url`. Caso `campo` senza evidenza dopo il caricamento: mostra pagina 1 intera con «nessuna evidenza registrata per questo valore: rileggi la conferma». La larghezza della vista si misura con un `ref` sulla scatola (`getBoundingClientRect().width`) al mount della vignetta.

- [ ] **Step 5: eseguire** — `pnpm vitest run client/src/lib/anteprime.test.ts` e `pnpm check`.
- [ ] **Step 6: commit** — `git commit -am "feat(client): componente DoveLetto con la vignetta del ritaglio di pagina"`.

---

### Task 11: montaggio nelle superfici

**Files:**
- Modify: `client/src/components/contratto/LeggiContrattoDialog.tsx`, `client/src/components/contratto/RigaContrattoEditor.tsx`, `client/src/components/contratto/ContrattoTab.tsx`, `client/src/components/documenti/CollegaOrdineDialog.tsx`, `client/src/pages/CommessaDetail.tsx`, `client/src/pages/ConfermeOrdine.tsx`, `client/src/pages/Magazzino.tsx`

- [ ] **Step 1: dialog contratto** — in `EvidenzaCampo` aggiungere la prop `documentoId` e rendere, accanto a `pag. N — «frammento»`, `<DoveLetto documentoId={documentoId} evidenza={{ pagina: evidenza.pagina, frammento: evidenza.frammento, area: evidenza.area ?? null }} />`; `CampoLetto` la riceve e la passa; tutte le occorrenze di `<CampoLetto` nel dialog passano `documentoId={documento.id}`; per le rate, accanto al badge, un `DoveLetto` con `proposta.rate.evidenza`. Ogni `pag. N` diventa anche un link `href={urlPdfAllaPagina(documento.id, evidenza.pagina)} target="_blank" rel="noopener noreferrer"` (passo 0 della spec).
- [ ] **Step 2: righe del contratto** — `RigaContrattoEditor` guadagna `documentoId?: number | null`; dopo l'`Input` della descrizione: `{documentoId != null && riga.evidenza && <DoveLetto documentoId={documentoId} evidenza={{ pagina: riga.evidenza.pagina, frammento: riga.evidenza.frammento, area: riga.evidenza.area ?? null }} />}`. `LeggiContrattoDialog` passa `documentoId={documento.id}`; `ContrattoTab` passa `documentoId={contratto?.documentoId ?? null}` (verificare che `contratto` esponga `documentoId`; altrimenti aggiungerlo alla risposta di `contratti.leggi`).
- [ ] **Step 3: collegamento a ordine** — in `CollegaOrdineDialog`, accanto a `pag. N — «frammento»` di ogni segnale: `<DoveLetto documentoId={documento.id} evidenza={{ pagina: segnale.evidenza.pagina, frammento: segnale.evidenza.frammento, area: segnale.evidenza.area ?? null }} />` (i candidati arrivano da `analisiDocumenti.candidati`: assicurarsi che `candidatiPerDocumento` in `server/routers/analisiDocumenti.ts` usi `annotaAreeEstrazione(estrazione, esitoParser.geometria)` prima di `generaCandidatiOrdine`).
- [ ] **Step 4: scheda commessa** — nella riga di costo con `c.documentoId != null`, dopo il pulsante «da conferma d'ordine»: `<DoveLetto documentoId={c.documentoId} campo="imponibile" valoreAttuale={formatEuro(c.importo)} />`; nel blocco «conferme senza costo», dopo il testo del motivo: `<DoveLetto documentoId={r.documentoId} campo={r.esito === "senza_riscontro" ? "riscontro" : "imponibile"} />`. La modalità `campo` legge `valoreLetto` dai `valori` della query (imponibile formattato con `formatEuro`) e, per `riscontro`, usa la prima evidenza di `evidenze.riscontro`.
- [ ] **Step 5: registro conferme** — nella cella del costo (tabella) e nella `dd` «Costo imponibile» (mobile), dopo `costoTesto(r.costo)`: `{r.costo.stato === "registrato" && <DoveLetto documentoId={r.documentoId} campo="imponibile" valoreAttuale={r.costo.importo != null ? formatEuroSimbolo(r.costo.importo) : null} />}`; nella cella del file, dopo il nome: `<DoveLetto documentoId={r.documentoId} campo="fornitore" />` solo se `r.fonteTesto` non è null.
- [ ] **Step 6: magazzino** — in `ProdottoRow`, dopo il nome del prodotto: `{p.documentoId != null && p.evidenza && <DoveLetto documentoId={p.documentoId} evidenza={p.evidenza} />}`.
- [ ] **Step 7: verifiche** — `pnpm check`; anteprima nel browser (launch config «Promo Capture», login demo) a 1440×900 e 390×844: aprire una commessa con conferma letta, il dialog contratto, il registro; console pulita; nessuno scroll orizzontale.
- [ ] **Step 8: commit** — `git commit -am "feat(client): tasto «Dove l'ho letto» su costi, conferme, magazzino, contratto e collegamento ordini"`.

---

### Task 12: metrica «evidenze localizzate» nell'eval

**Files:**
- Modify: `server/documenti/eval/runEval.ts`
- Test: `server/documenti/eval/eval.test.ts`

- [ ] **Step 1: test** — in `eval.test.ts`: `expect(risultato.metriche.evidenze.totali).toBeGreaterThan(0); expect(risultato.metriche.evidenze.localizzate).toBeLessThanOrEqual(risultato.metriche.evidenze.totali);` e il report contiene la riga `- Evidenze localizzate:`.
- [ ] **Step 2: eseguire, deve fallire**.
- [ ] **Step 3: implementare** — in `eseguiCaso`, dopo l'estrazione: `const annotata = annotaAreeEstrazione(estrazione, parser.geometria)`; contare le evidenze presenti (`riferimentoOrdine`, `fornitoreCitato`, `numeroConferma`, `dataDocumento`, `dateConsegna[]`, `totaleDocumento`, `imponibileDocumento`) e quelle con `area.grado === "riquadro"`, per fonte (`nativo` se `parser.parser === "pdf-testo-nativo"`, altrimenti `ocr`); `MetricheEval.evidenze = { totali, localizzate, perFonte: { nativo: { totali, localizzate }, ocr: { totali, localizzate } } }`; riga del report: `` `- Evidenze localizzate: ${m.evidenze.localizzate}/${m.evidenze.totali} (nativo ${…}, OCR ${…}) — senza soglia.` ``.
- [ ] **Step 4: eseguire** — `pnpm vitest run server/documenti/eval/eval.test.ts` e `pnpm eval:documenti` (il report va in `docs/reports/`: non committarlo se cambia solo la data).
- [ ] **Step 5: commit** — `git commit -am "feat(eval): metrica delle evidenze localizzate per fonte"`.

---

### Task 13: documentazione e verifica finale

**Files:**
- Modify: `documento_requisiti_infissi_ops.md` (§19.4 e riga di versione v5.43), `handoff.md` (novità in testa + sezione), `docs/runbooks/rollout-document-intelligence.md` (già toccato al Task 1: verificare la fase di rollout «Fase 4 — anteprime»)

- [ ] **Step 1: PRD** — in §19.4, dopo il blocco «OCR locale per le scansioni», un blocco «**Anteprime delle evidenze (06/09/2026).**» con: tasto su ogni valore letto, vignetta, coordinate dal parser (nativo e OCR), localizzatore, `FLAG_ANTEPRIME_EVIDENZE`, rotta, limiti, versioni. Riga di versione: `- **v5.43 (06/09/2026)** - …`.
- [ ] **Step 2: handoff** — blocco «Novità 06/09/2026» in testa, e nel «Debito aperto» le voci: HEIC, posizione grossolana dal modello, coda «Da verificare», Tars.
- [ ] **Step 3: verifica** — `pnpm check`, `pnpm test`, `pnpm build`; riportare i numeri.
- [ ] **Step 4: commit** — `git commit -am "docs: anteprime delle evidenze nel PRD (v5.43), handoff e runbook"`.
