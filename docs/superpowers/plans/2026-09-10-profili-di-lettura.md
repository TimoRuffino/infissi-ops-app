# Profili di lettura delle conferme — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Da un esempio di conferma corretto a mano nasce il profilo di lettura di quel modulo, e le conferme successive dello stesso modulo si leggono meglio — senza allenare nessun modello.

**Architecture:** Tre funzioni pure e uno store. L'**impronta** del layout (etichette stampate + geometria delle colonne, nessun valore) identifica il modulo e fa da chiave: risolve la circolarità «per sapere il profilo devo sapere il fornitore, che è quello che il profilo mi dice». La **derivazione** guarda dove sta il valore che la persona ha corretto e registra l'**etichetta che lo precede**, mai il valore. L'**applicazione** gira dopo l'estrattore generico e sovrascrive solo i campi che l'ancora trova: un profilo non può svuotare un campo che il generico riempiva. Il profilo entra da `ContestoEstrazione`, quindi i percorsi che non ne hanno uno si comportano esattamente come oggi.

**Tech Stack:** TypeScript, Vitest, tRPC 11, React 19, store JSONB per tenant, `putFile` per gli esempi, SHA-256 (`node:crypto`) per l'impronta.

**Spec:** `docs/superpowers/specs/2026-09-10-fornitori-per-azienda-e-profili-design.md`, §5 (più §6.1 per l'impronta, che serve già qui come chiave).

**Perimetro di QUESTO piano: il motore.** I tipi, l'impronta, la derivazione, l'applicazione, lo store e l'aggancio ai due percorsi che leggono davvero. Alla fine un profilo salvato **si applica alle conferme vere** — con `FLAG_PROFILI_LETTURA` acceso — e il costo fornitore nasce da lì.

**Fuori, in due piani loro:** la **superficie** (caricare un esempio dalla scheda fornitore e correggerlo dalla pagina) e il **catalogo comune delle forme** (§6). Il motivo non è la lunghezza: la superficie va disegnata sapendo come si comporta il motore su PDF veri, e quel dato non ce l'ho ancora. Finché la superficie non c'è, un profilo si scrive solo dai test — ed è abbastanza per provare che il motore funziona, non per darlo in mano a qualcuno.

**Dipende da:** il piano 1 (`2026-09-10-fornitori-per-azienda.md`), branch `claude/fornitori-per-azienda` / PR #20. Senza l'anagrafica per azienda non c'è niente a cui attaccare un profilo.

## Global Constraints

- **Nessun modello estrae campi.** `estrazioneConferma.ts` è e resta deterministico, con evidenza obbligatoria per ogni valore. Questo piano non ne introduce uno.
- **A interruttore `profiliLettura` spento non cambia niente**: nessun profilo nasce, nessuno si applica, l'estrattore si comporta come oggi.
- **Un profilo non cancella mai un valore.** Se l'ancora non trova niente, resta quello del generico. Un campo vuoto per colpa di un profilo sarebbe un costo fornitore mancante.
- **Nell'ancora entra l'ETICHETTA, mai il VALORE.** È la regola che rende la forma promuovibile al piano 3 e che la guardia del catalogo verificherà.
- **Un file illeggibile non produce un profilo**: non averlo capito non è una forma.
- `sedeId` su esempi e profili; record d'altra sede → `NOT_FOUND`.
- Lo store degli esempi nasce qui, ma **nessuno ci carica ancora niente**: il caricamento è della superficie, e quando arriverà `ErroreQuotaStorage` di `putFile` andrà **rilanciato sempre**, prima di qualunque ripiego (CLAUDE.md).
- Campo nuovo su uno store JSONB = tipo, default e **backfill in `onLoad`**.
- Comandi: `pnpm check`, `pnpm test`, `pnpm build`. Un file solo: `pnpm test <percorso>`.

## Struttura dei file

| File | Responsabilità |
|---|---|
| `shared/documenti/profilo.ts` **(nuovo)** | I tipi: `AncoraCampo`, `BloccoRighe`, `ProfiloLettura`, `CampoAncorabile`. Solo forme, nessuna logica. |
| `server/documenti/impronta.ts` **(nuovo)** | `improntaLayout(pagine)`: l'hash della struttura, senza valori. Puro. |
| `server/documenti/profiloDaCorrezione.ts` **(nuovo)** | `derivaAncore(pagine, correzioni)`: da «questo è il numero» all'etichetta che lo precede. Puro. |
| `server/documenti/profiloLettura.ts` **(nuovo)** | `applicaAncore(estrazione, pagine, ancore)`: la sovrascrittura. Puro. |
| `server/documenti/estrazioneConferma.ts` | `ContestoEstrazione` guadagna `profilo`; l'applicazione gira in coda a `estraiConfermaOrdine`. |
| `server/fornitori/profili.ts` **(nuovo)** | Lo store dei profili e degli esempi, `profiloPerPagine`, `contestoProfilo`, `moduloSconosciuto`. Modulo foglia. |
| `server/commesse/costoDaConferma.ts`, `server/fornitori/archivio.ts` | I due percorsi che risolvono il profilo dalle pagine. |

---

### Task 1: I tipi del profilo

**Files:**
- Create: `shared/documenti/profilo.ts`
- Test: nessuno (solo forme; li provano i task che li usano)

**Interfaces:**
- Produces:
  ```ts
  export const CAMPI_ANCORABILI = [
    "numeroConferma", "riferimentoOrdine", "riferimentoCliente",
    "imponibileDocumento", "totaleDocumento", "dataDocumento",
  ] as const;
  export type CampoAncorabile = (typeof CAMPI_ANCORABILI)[number];
  export type FormaValore = "numero" | "importo" | "data" | "testo";
  export type PosizioneAncora = "dopo_etichetta" | "riga_successiva" | "cella_a_destra";
  export type AncoraCampo = {
    campo: CampoAncorabile;
    etichetta: string;
    posizione: PosizioneAncora;
    forma: FormaValore;
    pagina: number | null;
  };
  export type RuoloColonna = "codice" | "descrizione" | "quantita" | "unita" | "prezzo" | "ignora";
  export type BloccoRighe = {
    apertura: string;
    chiusura: string;
    colonne: Array<{ ruolo: RuoloColonna; inizio: number; fine: number | null }>;
  };
  export type ProfiloLettura = {
    id: number;
    sedeId: number;
    fornitoreId: number;
    versione: number;
    impronta: string;
    ancore: AncoraCampo[];
    blocco: BloccoRighe | null;
    origine: "correzione" | "catalogo";
    esempioId: number | null;
    lettureSenzaCorrezione: number;
    createdBy: number | null;
    createdAt: Date;
    updatedAt: Date;
  };
  ```
  I nomi dei campi ancorabili sono **gli stessi** di `EstrazioneConferma`: è ciò che permette a `applicaAncore` di scrivere senza una mappa di traduzione.

- [ ] **Step 1: Scrivi il file**

Crea `shared/documenti/profilo.ts` con i tipi qui sopra, ognuno col suo commento sul perché. In testa al file:

```ts
// Il profilo di lettura di un MODULO di conferma d'ordine (spec
// `2026-09-10-fornitori-per-azienda-e-profili-design.md` §5).
//
// Non è un modello allenato: è un elenco di appigli. «Il numero d'ordine
// segue l'etichetta CV», «l'imponibile è la cifra dopo Totale imponibile».
// Nasce dalla CORREZIONE di un esempio — la persona dice qual è il valore
// giusto, il codice guarda dove sta e registra che cosa lo precede — e per
// questo dentro un'ancora c'è sempre un'ETICHETTA, mai un VALORE.
//
// Quella regola non è cosmesi: è ciò che permetterà (piano 3) di promuovere
// la FORMA di un profilo a patrimonio del prodotto senza portarsi dietro il
// cliente, il prezzo o il cantiere di nessuno.
```

- [ ] **Step 2: Verifica che compili**

Run: `pnpm check`
Expected: nessun errore.

- [ ] **Step 3: Commit**

```bash
git add shared/documenti/profilo.ts
git commit -m "feat(profili): i tipi del profilo di lettura

Nell'ancora entra l'etichetta, mai il valore: è la regola che permetterà
di promuovere la forma senza portarsi dietro i dati di nessuno.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: L'impronta del layout

Identifica il MODULO, non il fornitore. Risolve la circolarità: per sapere quale profilo applicare servirebbe sapere il fornitore, che è una delle cose che il profilo aiuta a leggere.

**Files:**
- Create: `server/documenti/impronta.ts`
- Test: `server/documenti/impronta.test.ts`

**Interfaces:**
- Produces: `export function improntaLayout(pagine: readonly string[]): string` — SHA-256 esadecimale, 16 caratteri.

- [ ] **Step 1: Write the failing test**

```ts
// L'impronta identifica il MODULO: due conferme dello stesso fornitore con
// clienti, prezzi e date diverse devono avere la stessa impronta, e due
// moduli diversi impronte diverse.
import { describe, expect, it } from "vitest";
import { improntaLayout } from "./impronta";

const alias = (cliente: string, numero: string, importo: string) => [
  [
    "ALIAS Srl Porte blindate",
    "Conferma Ordine",
    `2026 - CV ${numero} 23/02/2026`,
    "VS.RIFERIMENTO",
    cliente,
    "Codice        Descrizione                 UM    Quantita",
    "PORST-C013    PORTA BLIND.STEEL/C         NR    1,00",
    `Totale imponibile: EUR ${importo}`,
  ].join("\n"),
];

describe("improntaLayout", () => {
  it("due conferme dello stesso modulo hanno la stessa impronta", () => {
    expect(improntaLayout(alias("ROSSI MARIO", "1602923", "948,73"))).toBe(
      improntaLayout(alias("GIACOMAZZI GIULIO", "1684077", "12.340,00"))
    );
  });

  it("due moduli diversi hanno impronte diverse", () => {
    const pail = [
      [
        "PAIL SERRAMENTI",
        "conf. 26_29488",
        "Rif. cliente: ROSSI MARIO",
        "Art.     Descrizione        Q.tà",
        "PT100    PORTA INTERNA      2",
        "Imponibile 1.200,00",
      ].join("\n"),
    ];
    expect(improntaLayout(alias("ROSSI MARIO", "1602923", "948,73"))).not.toBe(
      improntaLayout(pail)
    );
  });

  it("l'impronta non contiene valori: cambiare solo le cifre non la muove", () => {
    const a = improntaLayout(alias("ROSSI MARIO", "1", "1,00"));
    const b = improntaLayout(alias("ROSSI MARIO", "999999999", "99.999,99"));
    expect(a).toBe(b);
  });

  it("un testo vuoto ha un'impronta stabile e non esplode", () => {
    expect(improntaLayout([])).toBe(improntaLayout([]));
    expect(improntaLayout([""])).toHaveLength(16);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test server/documenti/impronta.test.ts`
Expected: FAIL — il modulo `./impronta` non esiste.

- [ ] **Step 3: Write minimal implementation**

```ts
// L'impronta di un MODULO di conferma: che cosa c'è STAMPATO sul foglio,
// senza niente di quello che ci viene scritto sopra.
//
// Serve come chiave del profilo (§5) e, al piano 3, del catalogo comune.
// Identifica il modulo e non il fornitore, e questo risolve la circolarità:
// per scegliere il profilo servirebbe sapere di chi è la conferma, che è una
// delle cose che il profilo aiuta a leggere.
//
// Dentro entrano SOLO le parole stampate — le celle che non contengono
// cifre, importi o date — normalizzate e ordinate. Fuori restano i numeri
// d'ordine, i clienti, i prezzi e le date: è quello che rende l'impronta
// uguale su due conferme dello stesso modulo, e che al piano 3 la renderà
// promuovibile senza portarsi dietro i dati di nessuno.

import { createHash } from "node:crypto";

/** Una cella che contiene cifre non è un'etichetta: è un valore. */
const CON_CIFRE = /\d/;

function etichetteDi(testo: string): string[] {
  const trovate = new Set<string>();
  for (const riga of testo.split(/\r?\n/)) {
    // Le celle: separate da almeno due spazi, come le rende un PDF a colonne.
    for (const cella of riga.split(/\s{2,}/)) {
      const pulita = cella
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z ]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (CON_CIFRE.test(cella) && pulita.length < 4) continue;
      if (pulita.length < 3 || pulita.length > 40) continue;
      trovate.add(pulita);
    }
  }
  return [...trovate].sort();
}

export function improntaLayout(pagine: readonly string[]): string {
  const etichette = etichetteDi(pagine.join("\n"));
  const canonica = etichette.join("|");
  return createHash("sha256").update(canonica, "utf8").digest("hex").slice(0, 16);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test server/documenti/impronta.test.ts`
Expected: PASS. Se «due conferme dello stesso modulo» fallisce, una cella con cifre sta entrando fra le etichette: guarda quali stringhe differiscono stampando `etichetteDi` sui due testi, e stringi il filtro invece di allentare il test.

- [ ] **Step 5: Commit**

```bash
git add server/documenti/impronta.ts server/documenti/impronta.test.ts
git commit -m "feat(profili): l'impronta del layout, che identifica il modulo

Dentro entrano solo le parole stampate; numeri, clienti, prezzi e date
restano fuori. È ciò che la rende uguale su due conferme dello stesso
modulo e promuovibile senza dati di nessuno.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Dalla correzione all'ancora

**Files:**
- Create: `server/documenti/profiloDaCorrezione.ts`
- Test: `server/documenti/profiloDaCorrezione.test.ts`

**Interfaces:**
- Consumes: `AncoraCampo`, `CampoAncorabile`, `FormaValore` (Task 1)
- Produces:
  ```ts
  export type Correzione = { campo: CampoAncorabile; valore: string };
  export function derivaAncore(
    pagine: readonly string[],
    correzioni: readonly Correzione[]
  ): AncoraCampo[];
  ```
  Una correzione il cui valore non compare nel testo **non produce ancora**: non si inventa un appiglio su un valore che il foglio non porta.

- [ ] **Step 1: Write the failing test**

```ts
// Dalla correzione all'ancora: la persona dice qual è il valore giusto, il
// codice guarda dove sta e registra l'ETICHETTA che lo precede. Nel profilo
// non finisce mai il valore.
import { describe, expect, it } from "vitest";
import { derivaAncore } from "./profiloDaCorrezione";

const PAGINA = [
  "ALIAS Srl Porte blindate",
  "Conferma Ordine",
  "2026 - CV 1602923 23/02/2026",
  "VS.RIFERIMENTO   GIACOMAZZI GIULIO",
  "Totale imponibile: EUR 948,73",
].join("\n");

describe("derivaAncore", () => {
  it("registra l'etichetta che precede il valore, non il valore", () => {
    const ancore = derivaAncore([PAGINA], [
      { campo: "numeroConferma", valore: "1602923" },
    ]);
    expect(ancore).toHaveLength(1);
    expect(ancore[0]).toMatchObject({
      campo: "numeroConferma",
      posizione: "dopo_etichetta",
      forma: "numero",
      pagina: 1,
    });
    expect(ancore[0].etichetta.toLowerCase()).toContain("cv");
    // La regola che rende la forma promuovibile: nel profilo non c'è il valore.
    expect(JSON.stringify(ancore)).not.toContain("1602923");
  });

  it("riconosce la forma di un importo e la sua etichetta", () => {
    const ancore = derivaAncore([PAGINA], [
      { campo: "imponibileDocumento", valore: "948,73" },
    ]);
    expect(ancore[0].forma).toBe("importo");
    expect(ancore[0].etichetta.toLowerCase()).toContain("imponibile");
    expect(JSON.stringify(ancore)).not.toContain("948,73");
  });

  it("un valore in una cella a destra dell'etichetta si registra come tale", () => {
    const ancore = derivaAncore([PAGINA], [
      { campo: "riferimentoCliente", valore: "GIACOMAZZI GIULIO" },
    ]);
    expect(ancore[0].posizione).toBe("cella_a_destra");
    expect(ancore[0].etichetta.toLowerCase()).toContain("riferimento");
  });

  it("un valore che il foglio non porta non produce nessuna ancora", () => {
    expect(
      derivaAncore([PAGINA], [{ campo: "numeroConferma", valore: "NON C'È" }])
    ).toEqual([]);
  });

  it("un valore senza niente prima non produce ancora: non c'è appiglio", () => {
    expect(
      derivaAncore(["1602923"], [{ campo: "numeroConferma", valore: "1602923" }])
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test server/documenti/profiloDaCorrezione.test.ts`
Expected: FAIL — il modulo non esiste.

- [ ] **Step 3: Write minimal implementation**

```ts
// Dalla correzione all'ancora.
//
// La persona non annota il PDF: corregge un valore sbagliato. Il codice
// guarda dove quel valore sta nel testo e registra che cosa lo PRECEDE —
// l'etichetta stampata — insieme alla forma attesa. Nel profilo il valore
// non entra mai: entra il modo di ritrovarlo.

import type { AncoraCampo, CampoAncorabile, FormaValore, PosizioneAncora } from "@shared/documenti/profilo";

export type Correzione = { campo: CampoAncorabile; valore: string };

const IMPORTO = /^\d{1,3}(?:[.\s]\d{3})*,\d{2}$|^\d+,\d{2}$/;
const DATA = /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/;
const NUMERO = /^[A-Z]{0,4}[-_/]?\d{3,}$/i;

function formaDi(valore: string): FormaValore {
  if (IMPORTO.test(valore)) return "importo";
  if (DATA.test(valore)) return "data";
  if (NUMERO.test(valore)) return "numero";
  return "testo";
}

/** L'ultima parola stampata prima del valore: è l'appiglio. */
function etichettaPrima(prima: string): { etichetta: string; posizione: PosizioneAncora } | null {
  // Due o più spazi = una colonna: il valore sta nella cella a destra.
  const celle = prima.split(/\s{2,}/);
  const ultimaCella = celle[celle.length - 1]?.trim() ?? "";
  const posizione: PosizioneAncora =
    celle.length > 1 && ultimaCella === "" ? "cella_a_destra" : "dopo_etichetta";
  const testo = (posizione === "cella_a_destra" ? celle[celle.length - 2] : ultimaCella) ?? "";
  // L'etichetta è fatta di parole, non di cifre: «2026 - CV » → «CV».
  const parole = testo
    .split(/[\s:.\-–|]+/)
    .map(p => p.trim())
    .filter(p => p.length >= 2 && !/\d/.test(p));
  if (parole.length === 0) return null;
  return { etichetta: parole.slice(-2).join(" ").slice(0, 40), posizione };
}

export function derivaAncore(
  pagine: readonly string[],
  correzioni: readonly Correzione[]
): AncoraCampo[] {
  const ancore: AncoraCampo[] = [];
  for (const c of correzioni) {
    const valore = c.valore.trim();
    if (!valore) continue;
    for (let p = 0; p < pagine.length; p += 1) {
      const idx = pagine[p].indexOf(valore);
      if (idx < 0) continue;
      const inizioRiga = pagine[p].lastIndexOf("\n", idx) + 1;
      const prima = pagine[p].slice(inizioRiga, idx);
      const appiglio = etichettaPrima(prima);
      if (!appiglio) break; // il valore c'è ma non ha niente prima: nessun appiglio
      ancore.push({
        campo: c.campo,
        etichetta: appiglio.etichetta,
        posizione: appiglio.posizione,
        forma: formaDi(valore),
        pagina: p + 1,
      });
      break;
    }
  }
  return ancore;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test server/documenti/profiloDaCorrezione.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/documenti/profiloDaCorrezione.ts server/documenti/profiloDaCorrezione.test.ts
git commit -m "feat(profili): dalla correzione all'ancora

La persona corregge un valore; il codice guarda dove sta e registra
l'etichetta che lo precede. Un test verifica che nel profilo il valore
non compaia: è la regola che rende la forma promuovibile.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: L'applicazione delle ancore, e il profilo dentro l'estrattore

**Files:**
- Create: `server/documenti/profiloLettura.ts`
- Modify: `server/documenti/estrazioneConferma.ts` (`ContestoEstrazione`, coda di `estraiConfermaOrdine`)
- Test: `server/documenti/profiloLettura.test.ts`

**Interfaces:**
- Consumes: `AncoraCampo` (Task 1), `EstrazioneConferma` / `CampoEstratto` (esistenti)
- Produces:
  ```ts
  export function applicaAncore(
    estrazione: EstrazioneConferma,
    pagine: readonly string[],
    ancore: readonly AncoraCampo[]
  ): EstrazioneConferma;
  ```
  E `ContestoEstrazione` guadagna `profilo?: { ancore: readonly AncoraCampo[] } | null`.

- [ ] **Step 1: Write the failing test**

```ts
// L'ancora vince sul generico quando trova; quando non trova, il generico
// resta. Un profilo che svuota un campo sarebbe un costo fornitore mancante.
import { describe, expect, it } from "vitest";
import type { AncoraCampo } from "@shared/documenti/profilo";
import { estraiConfermaOrdine } from "./estrazioneConferma";
import { applicaAncore } from "./profiloLettura";

const PAGINE = [
  [
    "ALIAS Srl Porte blindate",
    "Nostro rif. 777888 del 01/03/2026",
    "2026 - CV 1602923 23/02/2026",
    "Totale imponibile: EUR 948,73",
  ].join("\n"),
];

const contesto = { codiceOrdine: null, fornitoreNome: null, righeOrdine: [] };

describe("applicaAncore", () => {
  it("l'ancora sovrascrive il campo che il generico aveva letto altrove", () => {
    const generico = estraiConfermaOrdine(PAGINE, contesto);
    const ancore: AncoraCampo[] = [
      { campo: "numeroConferma", etichetta: "CV", posizione: "dopo_etichetta", forma: "numero", pagina: 1 },
    ];
    const conProfilo = applicaAncore(generico, PAGINE, ancore);
    expect(conProfilo.numeroConferma?.valore).toBe("1602923");
    // E porta la sua evidenza, come ogni altro valore.
    expect(conProfilo.numeroConferma?.evidenza.pagina).toBe(1);
    expect(conProfilo.numeroConferma?.evidenza.frammento).toContain("1602923");
  });

  it("un'ancora che non trova niente non svuota il campo del generico", () => {
    const generico = estraiConfermaOrdine(PAGINE, contesto);
    const prima = generico.imponibileDocumento?.valore ?? null;
    const ancore: AncoraCampo[] = [
      { campo: "imponibileDocumento", etichetta: "NON ESISTE", posizione: "dopo_etichetta", forma: "importo", pagina: 1 },
    ];
    const dopo = applicaAncore(generico, PAGINE, ancore);
    expect(dopo.imponibileDocumento?.valore ?? null).toBe(prima);
  });

  it("la forma attesa impedisce di prendere il numero sbagliato", () => {
    const generico = estraiConfermaOrdine(PAGINE, contesto);
    // Dopo «Totale imponibile:» c'è «EUR», poi la cifra: la forma «importo»
    // salta la parola e prende il numero.
    const ancore: AncoraCampo[] = [
      { campo: "imponibileDocumento", etichetta: "imponibile", posizione: "dopo_etichetta", forma: "importo", pagina: 1 },
    ];
    expect(applicaAncore(generico, PAGINE, ancore).imponibileDocumento?.valore).toBe(948.73);
  });

  it("nessuna ancora: l'estrazione torna identica", () => {
    const generico = estraiConfermaOrdine(PAGINE, contesto);
    expect(applicaAncore(generico, PAGINE, [])).toEqual(generico);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test server/documenti/profiloLettura.test.ts`
Expected: FAIL — il modulo non esiste.

- [ ] **Step 3: Write minimal implementation**

Crea `server/documenti/profiloLettura.ts`:

```ts
// L'applicazione del profilo: le ancore girano DOPO l'estrattore generico e
// sovrascrivono solo i campi che trovano.
//
// L'ordine non è un dettaglio. Un profilo che girasse PRIMA e vincesse
// comunque potrebbe svuotare un campo che il generico avrebbe letto, e un
// imponibile mancante è un costo fornitore mancante. Qui il peggio che può
// fare un'ancora sbagliata è non trovare niente.

import type { AncoraCampo, FormaValore } from "@shared/documenti/profilo";
import type { CampoEstratto, EstrazioneConferma } from "./estrazioneConferma";

const PER_FORMA: Record<FormaValore, RegExp> = {
  importo: /\d{1,3}(?:[.\s]\d{3})*,\d{2}|\d+,\d{2}/,
  data: /\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/,
  numero: /[A-Z]{0,4}[-_/]?\d{3,}/i,
  testo: /\S.*?(?=\s{2,}|$)/,
};

function numeroDa(testo: string): number {
  return Number(testo.replace(/[.\s]/g, "").replace(",", "."));
}

/** La riga (e la sua pagina) dove compare l'etichetta. */
function cerca(
  pagine: readonly string[],
  ancora: AncoraCampo
): { valore: string; pagina: number; frammento: string; posizione: { inizio: number; fine: number } } | null {
  const etichetta = ancora.etichetta.toLowerCase();
  for (let p = 0; p < pagine.length; p += 1) {
    if (ancora.pagina != null && ancora.pagina !== p + 1) continue;
    const testo = pagine[p];
    const righe = testo.split(/\r?\n/);
    let scarto = 0;
    for (let i = 0; i < righe.length; i += 1) {
      const riga = righe[i];
      const dove = riga.toLowerCase().indexOf(etichetta);
      if (dove >= 0) {
        const coda =
          ancora.posizione === "riga_successiva"
            ? (righe[i + 1] ?? "")
            : riga.slice(dove + etichetta.length);
        const m = PER_FORMA[ancora.forma].exec(coda);
        if (m && m[0].trim()) {
          const base = ancora.posizione === "riga_successiva" ? scarto + riga.length + 1 : scarto + dove + etichetta.length;
          return {
            valore: m[0].trim(),
            pagina: p + 1,
            frammento: riga.trim().slice(0, 160),
            posizione: { inizio: base + m.index, fine: base + m.index + m[0].length },
          };
        }
      }
      scarto += riga.length + 1;
    }
  }
  return null;
}

function campo<T>(trovato: NonNullable<ReturnType<typeof cerca>>, valore: T): CampoEstratto<T> {
  return {
    valore,
    evidenza: {
      pagina: trovato.pagina,
      frammento: trovato.frammento,
      metodo: "pattern_testo",
      confidenza: "alta",
      posizione: trovato.posizione,
    },
  };
}

export function applicaAncore(
  estrazione: EstrazioneConferma,
  pagine: readonly string[],
  ancore: readonly AncoraCampo[]
): EstrazioneConferma {
  if (ancore.length === 0) return estrazione;
  const esito: EstrazioneConferma = { ...estrazione };
  for (const ancora of ancore) {
    const trovato = cerca(pagine, ancora);
    if (!trovato) continue; // MAI svuotare: resta quello del generico
    if (ancora.forma === "importo") {
      const n = numeroDa(trovato.valore);
      if (!Number.isFinite(n)) continue;
      (esito as any)[ancora.campo] = campo(trovato, n);
    } else {
      (esito as any)[ancora.campo] = campo(trovato, trovato.valore);
    }
  }
  return esito;
}
```

In `server/documenti/estrazioneConferma.ts`, aggiungi a `ContestoEstrazione`:

```ts
  /**
   * Il profilo del modulo, quando se ne conosce uno (spec §5). Le sue ancore
   * girano DOPO tutto il resto e sovrascrivono solo ciò che trovano.
   */
  profilo?: { ancore: readonly AncoraCampo[] } | null;
```

e come **ultima** istruzione di `estraiConfermaOrdine`, prima del `return risultato`:

```ts
  if (contesto.profilo?.ancore?.length) {
    return applicaAncore(risultato, pagine, contesto.profilo.ancore);
  }
```

con gli import di `AncoraCampo` da `@shared/documenti/profilo` e `applicaAncore` da `./profiloLettura`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test server/documenti/profiloLettura.test.ts && pnpm check`
Expected: PASS e tsc pulito. Se `CampoEstratto` non è esportato da `estrazioneConferma.ts`, esportalo: è già un tipo pubblico del modulo.

- [ ] **Step 5: Verifica che i percorsi senza profilo non cambino**

Run: `pnpm test server/documenti server/commesse server/fornitori`
Expected: PASS. Nessuno di questi passa un profilo: se qualcosa cambia, l'applicazione sta girando quando non dovrebbe.

- [ ] **Step 6: Commit**

```bash
git add server/documenti/profiloLettura.ts server/documenti/profiloLettura.test.ts server/documenti/estrazioneConferma.ts
git commit -m "feat(profili): le ancore si applicano dopo il generico, e non svuotano

L'ordine non è un dettaglio: un profilo che vincesse comunque potrebbe
svuotare un campo che il generico leggeva, e un imponibile mancante è un
costo fornitore mancante. Il peggio che può fare un'ancora sbagliata è
non trovare niente.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Lo store dei profili e degli esempi

**Files:**
- Create: `server/fornitori/profili.ts`
- Test: `server/fornitori/profili.test.ts`

**Interfaces:**
- Consumes: `ProfiloLettura` (Task 1), `improntaLayout` (Task 2)
- Produces:
  ```ts
  export type EsempioConferma = {
    id: number; sedeId: number; fornitoreId: number;
    nomeFile: string; mimeType: string; storageKey: string; checksum: string; size: number;
    impronta: string | null;
    createdBy: number | null; createdAt: Date;
  };
  export const storeProfili: PersistedStore<ProfiloLettura>;
  export const storeEsempi: PersistedStore<EsempioConferma>;
  export function profiloPerPagine(sedeId: number, pagine: readonly string[]): ProfiloLettura | null;
  export function profiliDiFornitore(sedeId: number, fornitoreId: number): ProfiloLettura[];
  export function salvaProfilo(input: {
    sedeId: number; fornitoreId: number; impronta: string;
    ancore: ProfiloLettura["ancore"]; blocco: ProfiloLettura["blocco"];
    esempioId: number | null; createdBy: number | null;
  }): ProfiloLettura;
  export function segnaLetturaPulita(profiloId: number, sedeId: number): void;
  export function azzeraLetturePulite(profiloId: number, sedeId: number): void;
  ```
  **Modulo foglia**: importa `persistence`, `sedi` e i due moduli puri. Niente router, niente archivio — come `anagrafica.ts` del piano 1, e per lo stesso motivo.

- [ ] **Step 1: Write the failing test**

```ts
// Lo store dei profili: la chiave è (sede, fornitore, impronta), perché un
// fornitore può avere più moduli — Alias manda sia «Ordini_di_Vendi» sia
// «Esportazione».
import { describe, expect, it } from "vitest";
import { improntaLayout } from "../documenti/impronta";
import {
  azzeraLetturePulite,
  profiliDiFornitore,
  profiloPerPagine,
  salvaProfilo,
  segnaLetturaPulita,
  storeProfili,
} from "./profili";

const SEDE = 95_301;
const ALTRA = 95_302;
const PAGINE = ["ALIAS Srl\nConferma Ordine\nCV 100 del 01/01/2026"];

const ancore = [
  { campo: "numeroConferma" as const, etichetta: "CV", posizione: "dopo_etichetta" as const, forma: "numero" as const, pagina: 1 },
];

describe("store dei profili", () => {
  it("un profilo si ritrova dalle pagine che hanno la sua impronta", () => {
    const p = salvaProfilo({
      sedeId: SEDE, fornitoreId: 7, impronta: improntaLayout(PAGINE),
      ancore, blocco: null, esempioId: null, createdBy: 1,
    });
    expect(profiloPerPagine(SEDE, PAGINE)?.id).toBe(p.id);
    // Pagine di un altro modulo: nessun profilo.
    expect(profiloPerPagine(SEDE, ["PAIL\nconf. 1\nRif. cliente"])).toBeNull();
  });

  it("il profilo di un'altra sede non si vede", () => {
    salvaProfilo({
      sedeId: SEDE, fornitoreId: 7, impronta: improntaLayout(PAGINE),
      ancore, blocco: null, esempioId: null, createdBy: 1,
    });
    expect(profiloPerPagine(ALTRA, PAGINE)).toBeNull();
  });

  it("risalvare la stessa impronta aggiorna il profilo e alza la versione", () => {
    const impronta = improntaLayout(["MODULO UNICO\nEtichetta stampata"]);
    const primo = salvaProfilo({
      sedeId: SEDE, fornitoreId: 9, impronta, ancore, blocco: null, esempioId: null, createdBy: 1,
    });
    const secondo = salvaProfilo({
      sedeId: SEDE, fornitoreId: 9, impronta, ancore: [], blocco: null, esempioId: null, createdBy: 1,
    });
    expect(secondo.id).toBe(primo.id);
    expect(secondo.versione).toBe(primo.versione + 1);
    expect(profiliDiFornitore(SEDE, 9)).toHaveLength(1);
  });

  it("le letture pulite si contano e una correzione le azzera", () => {
    const p = salvaProfilo({
      sedeId: SEDE, fornitoreId: 11, impronta: "impronta-conteggio",
      ancore, blocco: null, esempioId: null, createdBy: 1,
    });
    segnaLetturaPulita(p.id, SEDE);
    segnaLetturaPulita(p.id, SEDE);
    expect(storeProfili.items.find(x => x.id === p.id)?.lettureSenzaCorrezione).toBe(2);
    azzeraLetturePulite(p.id, SEDE);
    expect(storeProfili.items.find(x => x.id === p.id)?.lettureSenzaCorrezione).toBe(0);
    // Una sede che non è la sua non conta e non azzera.
    segnaLetturaPulita(p.id, ALTRA);
    expect(storeProfili.items.find(x => x.id === p.id)?.lettureSenzaCorrezione).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test server/fornitori/profili.test.ts`
Expected: FAIL — il modulo non esiste.

- [ ] **Step 3: Write minimal implementation**

Crea `server/fornitori/profili.ts`:

```ts
// I profili di lettura e gli esempi da cui nascono.
//
// Modulo FOGLIA come `anagrafica.ts`, e per lo stesso motivo: lo leggono
// `costoDaConferma` e `archivio`, e passare da un router che importa
// l'archivio sarebbe un ciclo.
//
// La chiave di un profilo è `(sedeId, fornitoreId, impronta)`: un fornitore
// ha più moduli — Alias manda sia «Ordini_di_Vendi» sia «Esportazione» — e
// sono profili diversi, non uno che si sovrascrive.

import type { ProfiloLettura } from "@shared/documenti/profilo";
import { persistedStore } from "../_core/persistence";
import { DEFAULT_SEDE_ID } from "../routers/sedi";
import { improntaLayout } from "../documenti/impronta";

export type EsempioConferma = {
  id: number;
  sedeId: number;
  fornitoreId: number;
  nomeFile: string;
  mimeType: string;
  storageKey: string;
  checksum: string;
  size: number;
  /** Null quando il file non si è potuto leggere: un illeggibile non è una forma. */
  impronta: string | null;
  createdBy: number | null;
  createdAt: Date;
};

export const storeProfili = persistedStore<ProfiloLettura>("fornitori_profili", righe => {
  for (const r of righe as any[]) {
    if (r.sedeId === undefined) r.sedeId = DEFAULT_SEDE_ID;
    if (!Array.isArray(r.ancore)) r.ancore = [];
    if (r.blocco === undefined) r.blocco = null;
    if (typeof r.lettureSenzaCorrezione !== "number") r.lettureSenzaCorrezione = 0;
    if (typeof r.versione !== "number") r.versione = 1;
    if (r.origine !== "correzione" && r.origine !== "catalogo") r.origine = "correzione";
  }
});

export const storeEsempi = persistedStore<EsempioConferma>("fornitori_esempi", righe => {
  for (const r of righe as any[]) {
    if (r.sedeId === undefined) r.sedeId = DEFAULT_SEDE_ID;
    if (r.impronta === undefined) r.impronta = null;
  }
});

const profili = storeProfili.items;

function diSede(p: ProfiloLettura, sedeId: number): boolean {
  return (p.sedeId ?? DEFAULT_SEDE_ID) === sedeId;
}

/**
 * Il profilo del MODULO che queste pagine sono, se ne conosciamo uno. Si
 * cerca per impronta e non per fornitore: è ciò che permette di scegliere il
 * profilo PRIMA di sapere di chi è la conferma.
 */
export function profiloPerPagine(
  sedeId: number,
  pagine: readonly string[]
): ProfiloLettura | null {
  if (pagine.length === 0) return null;
  const impronta = improntaLayout(pagine);
  return profili.find(p => diSede(p, sedeId) && p.impronta === impronta) ?? null;
}

export function profiliDiFornitore(sedeId: number, fornitoreId: number): ProfiloLettura[] {
  return profili.filter(p => diSede(p, sedeId) && p.fornitoreId === fornitoreId);
}

export function salvaProfilo(input: {
  sedeId: number;
  fornitoreId: number;
  impronta: string;
  ancore: ProfiloLettura["ancore"];
  blocco: ProfiloLettura["blocco"];
  esempioId: number | null;
  createdBy: number | null;
}): ProfiloLettura {
  const now = new Date();
  const esistente = profili.find(
    p =>
      diSede(p, input.sedeId) &&
      p.fornitoreId === input.fornitoreId &&
      p.impronta === input.impronta
  );
  if (esistente) {
    esistente.ancore = [...input.ancore];
    esistente.blocco = input.blocco;
    esistente.esempioId = input.esempioId ?? esistente.esempioId;
    esistente.versione += 1;
    // Un profilo riscritto è un profilo in prova: le letture pulite di prima
    // valevano per le ancore di prima.
    esistente.lettureSenzaCorrezione = 0;
    esistente.updatedAt = now;
    storeProfili.save();
    return esistente;
  }
  const nuovo: ProfiloLettura = {
    id: storeProfili.prossimoId(),
    sedeId: input.sedeId,
    fornitoreId: input.fornitoreId,
    versione: 1,
    impronta: input.impronta,
    ancore: [...input.ancore],
    blocco: input.blocco,
    origine: "correzione",
    esempioId: input.esempioId,
    lettureSenzaCorrezione: 0,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };
  profili.push(nuovo);
  storeProfili.save();
  return nuovo;
}

/** Una conferma letta con questo profilo che nessuno ha corretto. */
export function segnaLetturaPulita(profiloId: number, sedeId: number): void {
  const p = profili.find(x => x.id === profiloId && diSede(x, sedeId));
  if (!p) return;
  p.lettureSenzaCorrezione += 1;
  p.updatedAt = new Date();
  storeProfili.save();
}

/** Una smentita sola rimette il profilo in prova: è il comportamento voluto. */
export function azzeraLetturePulite(profiloId: number, sedeId: number): void {
  const p = profili.find(x => x.id === profiloId && diSede(x, sedeId));
  if (!p || p.lettureSenzaCorrezione === 0) return;
  p.lettureSenzaCorrezione = 0;
  p.updatedAt = new Date();
  storeProfili.save();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test server/fornitori/profili.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/fornitori/profili.ts server/fornitori/profili.test.ts
git commit -m "feat(profili): lo store dei profili e degli esempi

La chiave è (sede, fornitore, impronta): un fornitore ha più moduli —
Alias manda sia Ordini_di_Vendi sia Esportazione.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Il profilo entra dove la lettura conta, e dice quando il modulo è cambiato

Due call site contano: quello che fa nascere il **costo** e quello dell'**archivio**. Gli altri tre (`costoDaConferma:442`, `letturaConferma`, `ricercaCommessaNelDocumento`) restano com'erano: leggono per capire di che commessa è un file, non per scrivere un importo.

E la §5.4 della spec: se un fornitore **ha** profili ma nessuno combacia con queste pagine, il suo modulo è cambiato — e va **detto**, non subito in silenzio.

**Files:**
- Modify: `server/fornitori/profili.ts` (due funzioni nuove)
- Modify: `server/commesse/costoDaConferma.ts:653`
- Modify: `server/fornitori/archivio.ts:328`
- Modify: `server/platform/interruttori.ts`
- Test: `server/fornitori/profili.aggancio.test.ts` (nuovo)

**Interfaces:**
- Consumes: `profiloPerPagine`, `profiliDiFornitore` (Task 5), `ContestoEstrazione.profilo` (Task 4)
- Produces:
  ```ts
  export function contestoProfilo(
    sedeId: number,
    pagine: readonly string[]
  ): { profilo: { ancore: readonly AncoraCampo[] } | null; profiloId: number | null };

  export function moduloSconosciuto(
    sedeId: number,
    fornitoreId: number | null,
    pagine: readonly string[]
  ): boolean;
  ```
  `contestoProfilo` è l'unico punto che guarda l'interruttore: a spento torna `{ profilo: null, profiloId: null }`.

- [ ] **Step 1: Write the failing test**

Crea `server/fornitori/profili.aggancio.test.ts`:

```ts
// L'aggancio: il profilo si risolve dalle pagine, l'interruttore lo spegne, e
// un fornitore che ha profili ma nessuno che combacia ha cambiato modulo.
import { afterEach, describe, expect, it } from "vitest";
import { improntaLayout } from "../documenti/impronta";
import { contestoProfilo, moduloSconosciuto, salvaProfilo } from "./profili";

const SEDE = 95_401;
const PAGINE = ["ALIAS Srl\nConferma Ordine\nCV 100 del 01/01/2026"];
const ALTRO_MODULO = ["PAIL SERRAMENTI\nconf uno\nRif cliente"];

const ancore = [
  { campo: "numeroConferma" as const, etichetta: "CV", posizione: "dopo_etichetta" as const, forma: "numero" as const, pagina: 1 },
];

function interruttore(stato: "on" | "off"): void {
  process.env.FLAG_PROFILI_LETTURA = stato;
}
afterEach(() => {
  delete process.env.FLAG_PROFILI_LETTURA;
});

describe("contestoProfilo", () => {
  it("a interruttore acceso risolve il profilo dalle pagine", () => {
    interruttore("on");
    const vero = salvaProfilo({
      sedeId: SEDE, fornitoreId: 21, impronta: improntaLayout(PAGINE),
      ancore, blocco: null, esempioId: null, createdBy: 1,
    });
    const c = contestoProfilo(SEDE, PAGINE);
    expect(c.profiloId).toBe(vero.id);
    expect(c.profilo?.ancore).toHaveLength(1);
  });

  it("a interruttore spento non risolve niente, qualunque profilo esista", () => {
    interruttore("off");
    salvaProfilo({
      sedeId: SEDE, fornitoreId: 22,
      impronta: improntaLayout(PAGINE),
      ancore, blocco: null, esempioId: null, createdBy: 1,
    });
    expect(contestoProfilo(SEDE, PAGINE)).toEqual({ profilo: null, profiloId: null });
  });
});

describe("moduloSconosciuto", () => {
  it("un fornitore con profili ma nessuno che combacia ha cambiato modulo", () => {
    interruttore("on");
    salvaProfilo({
      sedeId: SEDE, fornitoreId: 33,
      impronta: improntaLayout(PAGINE),
      ancore, blocco: null, esempioId: null, createdBy: 1,
    });
    expect(moduloSconosciuto(SEDE, 33, ALTRO_MODULO)).toBe(true);
    expect(moduloSconosciuto(SEDE, 33, PAGINE)).toBe(false);
  });

  it("un fornitore senza profili non ha cambiato niente: non ne ha mai avuti", () => {
    interruttore("on");
    expect(moduloSconosciuto(SEDE, 999, PAGINE)).toBe(false);
    expect(moduloSconosciuto(SEDE, null, PAGINE)).toBe(false);
  });

  it("a interruttore spento non si dice niente", () => {
    interruttore("off");
    salvaProfilo({
      sedeId: SEDE, fornitoreId: 44,
      impronta: improntaLayout(PAGINE),
      ancore, blocco: null, esempioId: null, createdBy: 1,
    });
    expect(moduloSconosciuto(SEDE, 44, ALTRO_MODULO)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test server/fornitori/profili.aggancio.test.ts`
Expected: FAIL — `contestoProfilo` e `moduloSconosciuto` non esistono.

- [ ] **Step 3: Write minimal implementation**

In `server/platform/interruttori.ts` aggiungi alla union, alla mappa `VARIABILE` e a `ETICHETTA`:

```ts
  // Profili di lettura delle conferme (10/09/2026): da un esempio corretto a
  // mano nascono le ancore di quel modulo. Spento = l'estrattore generico e
  // basta, come prima.
  | "profiliLettura"
```
```ts
  profiliLettura: "FLAG_PROFILI_LETTURA",
```
```ts
  profiliLettura: "I profili di lettura delle conferme",
```

In `server/fornitori/profili.ts`, in coda:

```ts
import type { AncoraCampo } from "@shared/documenti/profilo";
import { interruttoreAttivo } from "../platform/interruttori";

/**
 * Il profilo da passare all'estrattore per queste pagine. È l'UNICO punto che
 * guarda l'interruttore: i chiamanti non lo sanno e non devono saperlo.
 */
export function contestoProfilo(
  sedeId: number,
  pagine: readonly string[]
): { profilo: { ancore: readonly AncoraCampo[] } | null; profiloId: number | null } {
  if (!interruttoreAttivo("profiliLettura")) return { profilo: null, profiloId: null };
  const p = profiloPerPagine(sedeId, pagine);
  if (!p) return { profilo: null, profiloId: null };
  return { profilo: { ancore: p.ancore }, profiloId: p.id };
}

/**
 * Il fornitore HA profili, ma nessuno combacia con queste pagine: ha cambiato
 * modulo (spec §5.4). Va detto — un profilo che smette di combaciare in
 * silenzio è peggio di nessun profilo, perché il costo nasce da lì.
 */
export function moduloSconosciuto(
  sedeId: number,
  fornitoreId: number | null,
  pagine: readonly string[]
): boolean {
  if (!interruttoreAttivo("profiliLettura")) return false;
  if (fornitoreId == null) return false;
  const suoi = profiliDiFornitore(sedeId, fornitoreId);
  if (suoi.length === 0) return false;
  return profiloPerPagine(sedeId, pagine) == null;
}
```

In `server/commesse/costoDaConferma.ts`, prima della chiamata di riga 653:

```ts
  const { profilo } = contestoProfilo(Number(commessa.sedeId ?? 1), parser.pagine);
```

e nel contesto passato a `estraiConfermeNelDocumento` aggiungi `profilo,`.

In `server/fornitori/archivio.ts` la chiamata di riga 328 sta dentro
`contenutoDellaConferma(pagine)`, che la sede **non ce l'ha**. Gliela si dà:

```ts
function contenutoDellaConferma(
  sedeId: number,
  pagine: readonly string[] | null
): {
```

e dentro, prima della chiamata:

```ts
    const { profilo } = contestoProfilo(sedeId, pagine);
    const { estrazione } = estraiConfermeNelDocumento(pagine, {
      codiceOrdine: null,
      fornitoreNome: null,
      righeOrdine: [],
      profilo,
    });
```

I chiamanti sono nel giro e in `confermeDiSede`, che hanno entrambi
`input.sedeId`: passalo come primo argomento. `pnpm check` li elenca tutti se
ne sfugge uno.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test server/fornitori server/commesse && pnpm check`
Expected: PASS e tsc pulito.

- [ ] **Step 5: Verifica che i percorsi di prima non cambino**

Run: `pnpm test server/documenti server/tars`
Expected: PASS. Nessuno di questi ha profili in gioco.

- [ ] **Step 6: Commit**

```bash
git add server/fornitori/profili.ts server/fornitori/profili.aggancio.test.ts server/commesse/costoDaConferma.ts server/fornitori/archivio.ts server/platform/interruttori.ts
git commit -m "feat(profili): il profilo entra dove la lettura conta, e dice se il modulo è cambiato

contestoProfilo è l'unico punto che guarda l'interruttore. E un fornitore
che ha profili ma nessuno che combacia ha cambiato modulo: va detto, non
subito in silenzio, perché il costo nasce da quella lettura.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Documenti e verifica finale

**Files:**
- Modify: `documento_requisiti_infissi_ops.md` (§19.4), `CLAUDE.md`, `handoff.md`

- [ ] **Step 1: PRD**

In §19.4, dopo la riga «Chi entra (10/09/2026)», aggiungi:

```markdown
- **Profili di lettura (10/09/2026, `FLAG_PROFILI_LETTURA`)**: da un esempio
  di conferma corretto a mano nascono le **ancore** di quel modulo — «il
  numero segue l'etichetta CV», «l'imponibile è la cifra dopo Totale
  imponibile». Nell'ancora entra l'ETICHETTA, mai il valore. Le ancore girano
  **dopo** l'estrattore generico e sovrascrivono solo ciò che trovano: un
  profilo non svuota mai un campo, perché un imponibile mancante è un costo
  fornitore mancante. La chiave è l'**impronta del layout** (le parole
  stampate, nessun valore), non il fornitore: è ciò che permette di scegliere
  il profilo prima di sapere di chi è la conferma. Se un fornitore ha profili
  e nessuno combacia, il modulo è cambiato e la lettura lo dichiara. Spec
  `docs/superpowers/specs/2026-09-10-fornitori-per-azienda-e-profili-design.md`
  §5.
```

- [ ] **Step 2: CLAUDE.md**

Nella sezione «Invarianti», dopo la riga sui fornitori per azienda:

```markdown
- Un **profilo di lettura** non svuota mai un campo: le ancore girano dopo
  l'estrattore generico e sovrascrivono solo ciò che trovano. Nell'ancora
  entra l'**etichetta**, mai il valore — è ciò che permetterà di promuovere la
  forma senza portarsi dietro i dati di nessuno. La chiave è l'impronta del
  layout, non il fornitore.
```

- [ ] **Step 3: handoff.md**

Blocco «Novità» in cima: che cosa fa il motore, che `FLAG_PROFILI_LETTURA` nasce spento, che **non c'è ancora una superficie** — un profilo si scrive solo dai test — e che la UI e il catalogo comune sono due piani loro.

- [ ] **Step 4: Verifica completa**

```bash
pnpm check
```
Expected: nessun errore.

```bash
pnpm test
```
Expected: tutti i file passati, nessuna regressione.

```bash
pnpm build
```
Expected: build riuscita.

- [ ] **Step 5: Commit**

```bash
git add documento_requisiti_infissi_ops.md CLAUDE.md handoff.md
git commit -m "docs(profili): PRD, invariante e handoff del motore dei profili

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Fuori da questo piano, dichiarato

- **La superficie** — caricare un esempio dalla scheda fornitore, vedere che cosa ha capito con «Dove l'ho letto», correggerlo. Senza, un profilo si scrive solo dai test: il motore è provato, non è ancora in mano a nessuno. Va disegnata sapendo come si comporta il motore su PDF veri, e quel dato arriva solo dopo aver eseguito questo piano.
- **Il blocco delle righe con la geometria** (spec §5.2, `BloccoRighe`). Il tipo nasce qui e viene persistito, ma **nessuno lo compila e nessuno lo applica**: `estraiRigheMerce` resta com'è. È il pezzo più rischioso — tocca la lettura che alimenta il magazzino — e merita il suo piano, con i PDF veri sotto mano. Le ancore sui campi valgono già da sole: numero, data e imponibile sono ciò che fa nascere il costo.
- **Il catalogo comune delle forme, la promozione automatica e la guardia di confine** (spec §6). `lettureSenzaCorrezione` si conta già qui, così quando quel piano arriva il dato c'è.
