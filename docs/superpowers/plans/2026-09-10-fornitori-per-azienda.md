# Fornitori per azienda — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ogni azienda ha i suoi fornitori e li gestisce da sola, invece di ereditare i venticinque della Ruffino Group cablati in una costante del prodotto.

**Architecture:** `shared/fornitori.ts` smette di essere la verità e diventa (a) le **regole** di riconoscimento, pure e senza dati, e (b) il **seed** dei venticinque, importabile una volta sola dal tenant 1. Le regole si applicano attraverso un **riconoscitore costruito dall'elenco di una sede** (`riconoscitoreDiSede`), che i cinque consumatori ricevono invece di leggere una costante. L'anagrafica `fornitori` — store per azienda che esiste già ed è vuoto — diventa la fonte, e la colonna sinistra di `/fornitori` diventa il posto dove si gestisce.

**Tech Stack:** TypeScript, Vitest, tRPC 11, React 19, store JSONB per tenant (`persistedStore`), Postgres (query in SQL grezzo per il pre-filtro della posta).

**Spec:** `docs/superpowers/specs/2026-09-10-fornitori-per-azienda-e-profili-design.md`, §4 (più §8 per l'interruttore e §9 per le guardie). Questo piano copre **solo** il piano 1. I profili di lettura (§5) e il catalogo comune delle forme (§6) sono i piani 2 e 3, e dipendono da questo.

## Global Constraints

- **A interruttore `fornitoriAzienda` spento non cambia niente.** Il riconoscimento passa dal ripiego sul seed e si comporta esattamente come oggi. È la condizione che rende questo piano rilasciabile senza rischio.
- **Nessuna cache di modulo del riconoscitore.** Si costruisce per sede a ogni giro o richiesta: una cache globale in un CRM multi-azienda è il modo classico di far vedere a un'azienda i dati di un'altra.
- `SEED_FORNITORI_TENANT_1` lo importano **solo due file**: il router che lo importa su richiesta (Task 8) e `riconoscitoreDiRipiego()` (Task 3). Ogni altro import fa fallire la guardia di Task 3.
- **Il seed non parte mai da solo.** La riga `fornitori` in produzione esiste già (array vuoto), quindi `firstBoot` è falso; e togliere quella guardia calpesterebbe lo stato vuoto voluto da chi cancella. È un bottone, non un backfill.
- `sedeId` su ogni lettura e scrittura; record d'altra sede → `NOT_FOUND` via `recordOppureNotFound`.
- Quando si aggiunge un campo a uno store JSONB servono tipo, default e **backfill in `onLoad`** (CLAUDE.md).
- UI: token semantici di `client/src/index.css`, Plus Jakarta Sans, `min-w-0` sulle tabelle, nessuno scroll orizzontale di pagina, verifica a 1440×900 e 390×844, mai `scrollIntoView`.
- Comandi: `pnpm check` (tsc), `pnpm test` (vitest run), `pnpm build`. Un file solo: `pnpm test <percorso>`.

## Struttura dei file

| File | Responsabilità |
|---|---|
| `server/fornitori/anagrafica.ts` **(nuovo)** | Lo store `fornitori` e le sue letture. **Modulo foglia**: importa solo `persistence` e `sedi`. Esiste perché `comunicazioni.ts` deve leggere i fornitori di una sede, e passare da `server/routers/fornitori.ts` — che importa `fornitori/archivio.ts`, che importa `comunicazioni` — sarebbe un ciclo. |
| `server/fornitori/riconoscimento.ts` **(nuovo)** | `riconoscitoreDiSede(sedeId)` e `riconoscitoreDiRipiego()`. L'unico posto del server che sa dell'interruttore e del seed. |
| `server/fornitori/riconoscimento.confine.test.ts` **(nuovo)** | La guardia strutturale: chi può importare il seed. |
| `shared/fornitori.ts` | Le regole pure (`riconoscitoreFornitori`) e il seed. Nessuna lettura di stato. |
| `server/routers/fornitori.ts` | CRUD dell'anagrafica esteso, candidati, importazione del seed. Perde la dichiarazione dello store (va in `anagrafica.ts`). |
| I cinque consumatori | Ricevono il riconoscitore invece di leggere la costante. |

---

### Task 1: L'anagrafica esce dal router e diventa un modulo foglia

Serve a rompere il ciclo prima di crearlo: `comunicazioni.ts` (Task 7) deve leggere i fornitori di una sede, e `server/routers/fornitori.ts` importa `fornitori/archivio.ts`, che importa `comunicazioni`.

**Files:**
- Create: `server/fornitori/anagrafica.ts`
- Modify: `server/routers/fornitori.ts` (righe 27–46 il tipo, ~91 la dichiarazione dello store)
- Test: `server/fornitori/anagrafica.test.ts` (nuovo)

**Interfaces:**
- Produces:
  ```ts
  export type Fornitore = { /* come oggi, più i campi di Task 2 */ };
  export const storeFornitori: PersistedStore<Fornitore>;
  export function fornitoriDiSede(sedeId: number): Fornitore[];
  export function fornitoreDiSedeById(id: number, sedeId: number): Fornitore | null;
  ```
  `server/routers/fornitori.ts` importa da qui e non dichiara più lo store.

- [ ] **Step 1: Write the failing test**

Crea `server/fornitori/anagrafica.test.ts`:

```ts
// L'anagrafica dei fornitori è un modulo foglia: la leggono il router, il
// riconoscitore e il pre-filtro della posta senza passare da nessun ciclo.
import { describe, expect, it } from "vitest";
import { fornitoriDiSede, fornitoreDiSedeById, storeFornitori } from "./anagrafica";

const SEDE = 96_401;

function seminaPerTest(): number {
  const id = storeFornitori.prossimoId();
  const now = new Date();
  storeFornitori.items.push({
    id,
    sedeId: SEDE,
    ragioneSociale: "Vetreria Bianchi",
    categoria: "vetro",
    attivo: true,
    createdAt: now,
    updatedAt: now,
  } as any);
  return id;
}

describe("anagrafica fornitori", () => {
  it("legge i fornitori di una sede e non quelli delle altre", () => {
    const id = seminaPerTest();
    expect(fornitoriDiSede(SEDE).map(f => f.id)).toContain(id);
    expect(fornitoriDiSede(SEDE + 1).map(f => f.id)).not.toContain(id);
  });

  it("un fornitore di un'altra sede non si risolve", () => {
    const id = seminaPerTest();
    expect(fornitoreDiSedeById(id, SEDE)?.ragioneSociale).toBe("Vetreria Bianchi");
    expect(fornitoreDiSedeById(id, SEDE + 1)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test server/fornitori/anagrafica.test.ts`
Expected: FAIL — il modulo `./anagrafica` non esiste.

- [ ] **Step 3: Write minimal implementation**

Crea `server/fornitori/anagrafica.ts`. Sposta qui il tipo `Fornitore` e la dichiarazione dello store che oggi stanno in `server/routers/fornitori.ts`:

```ts
// L'anagrafica dei fornitori dell'azienda.
//
// Sta qui e non nel router perché la leggono anche il riconoscitore
// (`riconoscimento.ts`) e il pre-filtro della posta
// (`comunicazioni/comunicazioni.ts`): passare dal router — che importa
// `fornitori/archivio.ts`, che importa `comunicazioni` — sarebbe un ciclo.
// Modulo foglia: da qui non si importa niente di dominio.

import { persistedStore } from "../_core/persistence";
import { DEFAULT_SEDE_ID } from "../routers/sedi";

export type CategoriaFornitore =
  | "pvc" | "alluminio" | "vetro" | "ferramenta" | "persiane"
  | "blindati" | "accessori" | "guarnizioni" | "altro";

export type Fornitore = {
  id: number;
  sedeId?: number;
  ragioneSociale: string;
  /** Facoltativa: per riconoscere il mittente di una conferma non serve. */
  partitaIva?: string;
  indirizzo?: string;
  citta?: string;
  telefono?: string;
  email?: string;
  categoria: CategoriaFornitore;
  referenteCommerciale?: string;
  scontistica?: number;
  note?: string;
  attivo: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export const storeFornitori = persistedStore<Fornitore>("fornitori", loaded => {
  for (const f of loaded) {
    if ((f as any).sedeId === undefined) (f as any).sedeId = 1;
  }
});

const fornitori = storeFornitori.items;

/** I fornitori di una sede, in ordine alfabetico. */
export function fornitoriDiSede(sedeId: number): Fornitore[] {
  return fornitori
    .filter(f => (f.sedeId ?? DEFAULT_SEDE_ID) === sedeId)
    .sort((a, b) => a.ragioneSociale.localeCompare(b.ragioneSociale));
}

/** Fail-closed: un fornitore di un'altra sede non esiste. */
export function fornitoreDiSedeById(id: number, sedeId: number): Fornitore | null {
  const f = fornitori.find(x => x.id === id);
  if (!f) return null;
  return (f.sedeId ?? DEFAULT_SEDE_ID) === sedeId ? f : null;
}
```

In `server/routers/fornitori.ts`: **cancella** il tipo `Fornitore` (righe 27–46) e la dichiarazione `const _fornitoriStore = persistedStore<Fornitore>("fornitori", …)` con il suo `const fornitori = _fornitoriStore.items;`, e sostituiscili con:

```ts
import {
  fornitoriDiSede,
  storeFornitori as _fornitoriStore,
  type Fornitore,
} from "../fornitori/anagrafica";

const fornitori = _fornitoriStore.items;
```

Il resto del router non cambia: usa già `_fornitoriStore` e `fornitori` con questi nomi.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test server/fornitori/anagrafica.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify nothing else broke**

Run: `pnpm check && pnpm test server/routers/fornitori server/fornitori`
Expected: tsc pulito, test verdi. Un `duplicate store key: fornitori` significa che la vecchia dichiarazione è rimasta: toglila.

- [ ] **Step 6: Commit**

```bash
git add server/fornitori/anagrafica.ts server/fornitori/anagrafica.test.ts server/routers/fornitori.ts
git commit -m "refactor(fornitori): l'anagrafica esce dal router e diventa un modulo foglia

Serve a rompere un ciclo prima di crearlo: il pre-filtro della posta deve
leggere i fornitori di una sede, e routers/fornitori.ts importa
fornitori/archivio.ts, che importa comunicazioni.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: I campi che servono a riconoscere un fornitore

**Files:**
- Modify: `server/fornitori/anagrafica.ts` (tipo `Fornitore` e `onLoad`)
- Test: `server/fornitori/anagrafica.test.ts`

**Interfaces:**
- Consumes: `Fornitore`, `storeFornitori` (Task 1)
- Produces: `Fornitore` con `chiavi: string[]`, `canale: CanaleFornitore`, `portaleDomini: string[]`; `export type CanaleFornitore = "mail" | "portale" | "altro"`.

- [ ] **Step 1: Write the failing test**

Aggiungi in `server/fornitori/anagrafica.test.ts`:

```ts
  it("i record salvati prima dei campi nuovi li ricevono col default", () => {
    // Il backfill di onLoad, simulato sulla forma di un record legacy.
    const legacy: any = { id: 1, sedeId: SEDE, ragioneSociale: "Vecchio", categoria: "altro", attivo: true };
    applicaBackfillFornitori([legacy]);
    expect(legacy.chiavi).toEqual([]);
    expect(legacy.canale).toBe("mail");
    expect(legacy.portaleDomini).toEqual([]);
  });

  it("il backfill non sovrascrive quello che c'è già", () => {
    const pieno: any = {
      id: 2, sedeId: SEDE, ragioneSociale: "Wnd", categoria: "pvc", attivo: true,
      chiavi: ["wnd"], canale: "portale", portaleDomini: ["antenore.biz"],
    };
    applicaBackfillFornitori([pieno]);
    expect(pieno.chiavi).toEqual(["wnd"]);
    expect(pieno.canale).toBe("portale");
    expect(pieno.portaleDomini).toEqual(["antenore.biz"]);
  });
```

Estendi l'import del file di test con `applicaBackfillFornitori`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test server/fornitori/anagrafica.test.ts`
Expected: FAIL — `applicaBackfillFornitori` non esiste.

- [ ] **Step 3: Write minimal implementation**

In `server/fornitori/anagrafica.ts`, aggiungi al tipo:

```ts
export type CanaleFornitore = "mail" | "portale" | "altro";
```

e dentro `Fornitore`, dopo `categoria`:

```ts
  /**
   * Le parole e i domini con cui si riconosce questo fornitore nel testo di un
   * documento o nel dominio di una mail. È la parte che fino al 10/09/2026
   * viveva nella costante `FORNITORI_NOTI` di `shared/fornitori.ts`.
   */
  chiavi: string[];
  /** Come gli si ordina (spec ordini §3, D-E). */
  canale: CanaleFornitore;
  /**
   * I domini del PORTALE con cui si ordina da lui: `antenore.biz` per Wnd. Un
   * portale non è un fornitore, è un canale: riconduce al produttore.
   */
  portaleDomini: string[];
```

Estrai il backfill in una funzione esportata (serve al test e rende leggibile `onLoad`):

```ts
/** I default dei campi aggiunti il 10/09/2026, applicati ai record salvati prima. */
export function applicaBackfillFornitori(righe: readonly unknown[]): void {
  for (const riga of righe as any[]) {
    if (riga.sedeId === undefined) riga.sedeId = 1;
    if (!Array.isArray(riga.chiavi)) riga.chiavi = [];
    if (riga.canale !== "mail" && riga.canale !== "portale" && riga.canale !== "altro") {
      riga.canale = "mail";
    }
    if (!Array.isArray(riga.portaleDomini)) riga.portaleDomini = [];
  }
}

export const storeFornitori = persistedStore<Fornitore>("fornitori", loaded => {
  applicaBackfillFornitori(loaded);
});
```

E rendi `partitaIva` facoltativa (`partitaIva?: string`) se Task 1 non l'ha già fatto.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test server/fornitori/anagrafica.test.ts && pnpm check`
Expected: PASS e tsc pulito. Se il router si lamenta di `partitaIva` obbligatoria in `create`, quello si sistema al Task 8: qui basta che il **tipo** sia facoltativo.

- [ ] **Step 5: Commit**

```bash
git add server/fornitori/anagrafica.ts server/fornitori/anagrafica.test.ts
git commit -m "feat(fornitori): chiavi, canale e portali sull'anagrafica

È la parte di FORNITORI_NOTI che deve diventare un dato dell'azienda:
con quali parole e domini si riconosce un fornitore, come gli si ordina,
e da quale portale (antenore.biz per Wnd).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Le regole di riconoscimento smettono di leggere una costante

**Files:**
- Modify: `shared/fornitori.ts`
- Test: `shared/fornitori.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type FornitoreRiconoscibile = {
    nome: string;
    chiavi: readonly string[];
    /** Quando la voce è un portale: il fornitore a cui riconduce. */
    portaleDi?: string | null;
  };
  export type Riconoscitore = {
    nome(testo: string | null | undefined, email?: string | null): string | null;
    normalizza(testo: string | null | undefined, email?: string | null): string | null;
    sorgenteMittenti(): string;
  };
  export function riconoscitoreFornitori(
    elenco: readonly FornitoreRiconoscibile[]
  ): Riconoscitore;
  export const SEED_FORNITORI_TENANT_1: readonly FornitoreRiconoscibile[];
  ```
  `fornitoreNoto`, `normalizzaFornitore`, `FORNITORI_NOTI`, `FORNITORI`, `PORTALI` e `SORGENTE_MITTENTE_FORNITORE` **spariscono**: i Task 4–9 spostano ogni chiamante.

- [ ] **Step 1: Write the failing test**

Sostituisci in `shared/fornitori.test.ts` gli import con:

```ts
import {
  SEED_FORNITORI_TENANT_1,
  riconoscitoreFornitori,
  type FornitoreRiconoscibile,
} from "./fornitori";
```

e aggiungi in cima al file, dopo gli import:

```ts
/** Il riconoscitore costruito sul seed: è il comportamento di sempre. */
const r = () => riconoscitoreFornitori(SEED_FORNITORI_TENANT_1);
```

Poi, in ogni test già presente, sostituisci `fornitoreNoto(` con `r().nome(` e `normalizzaFornitore(` con `r().normalizza(`, e `SORGENTE_MITTENTE_FORNITORE` con `r().sorgenteMittenti()`. Il test «la lista dei nomi è quella dei filtri, senza doppioni» diventa:

```ts
  it("il seed non ha doppioni e contiene i fornitori veri", () => {
    const nomi = SEED_FORNITORI_TENANT_1.map(f => f.nome);
    expect(new Set(nomi).size).toBe(nomi.length);
    expect(nomi).toContain("Alias");
    expect(nomi).toContain("Pail");
  });
```

E aggiungi il test che dimostra il punto di tutto il piano:

```ts
  it("due elenchi diversi riconoscono cose diverse: è il punto di tutto", () => {
    const mio: FornitoreRiconoscibile[] = [
      { nome: "Vetreria Bianchi", chiavi: ["vetreriabianchi", "bianchi"] },
    ];
    const altro = riconoscitoreFornitori(mio);
    expect(altro.nome(null, "ordini@vetreriabianchi.it")).toBe("Vetreria Bianchi");
    // Alias è dei venticinque della Ruffino: qui non esiste.
    expect(altro.nome(null, "v.gregori@aliasblindate.com")).toBeNull();
    // E viceversa.
    expect(r().nome(null, "ordini@vetreriabianchi.it")).toBeNull();
  });

  it("un elenco vuoto non riconosce niente e non esplode", () => {
    const vuoto = riconoscitoreFornitori([]);
    expect(vuoto.nome("Alias", "v.gregori@aliasblindate.com")).toBeNull();
    expect(vuoto.normalizza("ALIAS Srl Porte blindate")).toBe("ALIAS Srl Porte blindate");
    // Un pattern che non può combaciare con niente, mai con tutto.
    expect(new RegExp(vuoto.sorgenteMittenti(), "i").test("chiunque@ovunque.it")).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test shared/fornitori.test.ts`
Expected: FAIL — `riconoscitoreFornitori` e `SEED_FORNITORI_TENANT_1` non esistono.

- [ ] **Step 3: Write minimal implementation**

In `shared/fornitori.ts`: rinomina `FornitoreNoto` in `FornitoreRiconoscibile` aggiungendovi `portaleDi?: string | null`; rinomina `FORNITORI_NOTI` in `SEED_FORNITORI_TENANT_1`, aggiornandone il commento in testa al file:

```ts
// Le REGOLE con cui si riconosce un fornitore da un testo o dal dominio di una
// mail, e il SEED dei venticinque della Ruffino Group.
//
// Le regole sono conoscenza di dominio e restano qui. L'elenco no: dal
// 10/09/2026 ogni azienda ha i suoi fornitori (spec
// `2026-09-10-fornitori-per-azienda-e-profili-design.md`), e questo file non
// sa più chi siano. `riconoscitoreFornitori(elenco)` costruisce il
// riconoscitore da un elenco qualunque; chi glielo passa è
// `server/fornitori/riconoscimento.ts`.
//
// `SEED_FORNITORI_TENANT_1` sono i fornitori della Ruffino Group: si importano
// UNA VOLTA nell'anagrafica del tenant 1 (bottone in `/fornitori`) e servono
// da ripiego a interruttore spento. Nessun altro percorso li legge.
```

Le voci di `PORTALI` confluiscono nel seed come voci con `portaleDi`:

```ts
  // Antenore è il portale con cui si ordina da Wnd/Oknoplast, non un
  // fornitore: riconduce al produttore.
  { nome: "Wnd", chiavi: ["antenore"], portaleDi: "Wnd" },
```

Cancella `FORNITORI`, `PORTALI` e `SORGENTE_MITTENTE_FORNITORE`, e sostituisci `fornitoreNoto` / `normalizzaFornitore` con la fabbrica. `contieneChiave`, `normalizza` e `NON_FORNITORE` restano private e invariate:

```ts
export function riconoscitoreFornitori(
  elenco: readonly FornitoreRiconoscibile[]
): Riconoscitore {
  // I portali si guardano DOPO i fornitori veri: il dominio del produttore è
  // più preciso di quello del canale con cui gli si ordina.
  const diretti = elenco.filter(f => !f.portaleDi);
  const portali = elenco.filter(f => f.portaleDi);

  const cerca = (
    voci: readonly FornitoreRiconoscibile[],
    testo: string | null | undefined,
    dominio: string | null
  ): string | null => {
    for (const f of voci) {
      for (const chiave of f.chiavi) {
        if (testo && contieneChiave(testo, chiave)) return f.portaleDi ?? f.nome;
        if (dominio && contieneChiave(dominio, chiave)) return f.portaleDi ?? f.nome;
      }
    }
    return null;
  };

  const nome: Riconoscitore["nome"] = (testo, email) => {
    const dominio = email?.includes("@") ? email.split("@")[1] : null;
    return cerca(diretti, testo, dominio) ?? cerca(portali, testo, dominio);
  };

  return {
    nome,
    normalizza(testo, email) {
      const noto = nome(testo, email);
      if (noto) return noto;
      const grezzo = String(testo ?? "").replace(/\s+/g, " ").trim();
      if (!grezzo) return null;
      const segmenti = grezzo.split(/\s+[-–|]\s+/).map(s => s.trim());
      const prima = segmenti.find(s => (s.match(/[a-zà-ú]/gi) ?? []).length >= 3) ?? "";
      if (!prima || NON_FORNITORE.test(prima)) return null;
      return prima.slice(0, 60);
    },
    sorgenteMittenti() {
      const chiavi = elenco.flatMap(f => f.chiavi);
      // Un elenco vuoto deve produrre un pattern che non combacia con NIENTE.
      // `new RegExp("")` combacia con tutto: sarebbe il difetto peggiore
      // possibile qui, perché aprirebbe il pre-filtro a ogni mittente.
      if (chiavi.length === 0) return "(?!)";
      return chiavi
        .map(chiave => chiave.replace(/[^a-z0-9]+/g, "[^a-z0-9]*"))
        .sort((a, b) => b.length - a.length)
        .join("|");
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test shared/fornitori.test.ts`
Expected: PASS. `pnpm check` fallirà nei cinque consumatori: è previsto, li sistemano i Task 4–7 e 9.

- [ ] **Step 5: Commit**

```bash
git add shared/fornitori.ts shared/fornitori.test.ts
git commit -m "feat(fornitori): le regole si applicano a un elenco, non a una costante

riconoscitoreFornitori(elenco) sostituisce fornitoreNoto/normalizzaFornitore
e SORGENTE_MITTENTE_FORNITORE. FORNITORI_NOTI diventa SEED_FORNITORI_TENANT_1
e PORTALI vi confluisce come voci con portaleDi.

Un elenco vuoto produce '(?!)', non la stringa vuota: new RegExp('') combacia
con tutto, e qui aprirebbe il pre-filtro della posta a ogni mittente.

I consumatori non compilano ancora: li spostano i task seguenti.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Il riconoscitore di una sede, e la guardia su chi legge il seed

**Files:**
- Create: `server/fornitori/riconoscimento.ts`
- Create: `server/fornitori/riconoscimento.confine.test.ts`
- Modify: `server/platform/interruttori.ts` (union `Interruttore`)
- Test: `server/fornitori/riconoscimento.test.ts` (nuovo)

**Interfaces:**
- Consumes: `fornitoriDiSede` (Task 1), `riconoscitoreFornitori` / `SEED_FORNITORI_TENANT_1` (Task 3)
- Produces:
  ```ts
  export function riconoscitoreDiSede(sedeId: number): Riconoscitore;
  export function riconoscitoreDiRipiego(): Riconoscitore;
  ```
  I Task 5–7 chiamano `riconoscitoreDiSede`. Nessun altro modulo importa il seed.

- [ ] **Step 1: Write the failing test**

Crea `server/fornitori/riconoscimento.test.ts`:

```ts
// Il riconoscitore di una sede: dall'anagrafica quando l'interruttore è
// acceso, dal seed della Ruffino quando è spento — e a spento il
// comportamento deve essere identico a quello di prima del 10/09/2026.
import { describe, expect, it } from "vitest";
import { riconoscitoreDiRipiego, riconoscitoreDiSede } from "./riconoscimento";
import { storeFornitori } from "./anagrafica";

const SEDE = 96_501;

describe("riconoscitoreDiSede", () => {
  it("a interruttore spento vale il seed della Ruffino, com'era", () => {
    // L'interruttore nasce spento: nessuna configurazione nei test.
    expect(riconoscitoreDiSede(SEDE).nome(null, "v.gregori@aliasblindate.com")).toBe("Alias");
    expect(riconoscitoreDiSede(SEDE).nome(null, "noreply@antenore.biz")).toBe("Wnd");
  });

  it("il ripiego è il seed, sempre e comunque", () => {
    expect(riconoscitoreDiRipiego().nome(null, "ordini@pailporte.com")).toBe("Pail");
  });

  it("non tiene una cache: un fornitore aggiunto adesso si riconosce subito", () => {
    const prima = riconoscitoreDiSede(SEDE);
    storeFornitori.items.push({
      id: storeFornitori.prossimoId(),
      sedeId: SEDE,
      ragioneSociale: "Vetreria Bianchi",
      categoria: "vetro",
      attivo: true,
      chiavi: ["vetreriabianchi"],
      canale: "mail",
      portaleDomini: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);
    // Con l'interruttore spento non cambia niente, ed è il punto: il ripiego
    // non guarda l'anagrafica. Ma nemmeno si porta dietro un risultato vecchio.
    expect(prima.nome(null, "ordini@vetreriabianchi.it")).toBeNull();
    expect(riconoscitoreDiSede(SEDE).nome(null, "ordini@vetreriabianchi.it")).toBeNull();
  });
});
```

Crea `server/fornitori/riconoscimento.confine.test.ts`:

```ts
// Chi può importare il seed dei venticinque. Sul modello di
// server/tenants/confine.test.ts: legge i sorgenti e fallisce se qualcuno
// aggiunge un import senza aggiornare questa lista.
//
// Il motivo: il seed sono i fornitori della Ruffino Group. Ogni modulo di
// dominio che lo legge fa vedere quei fornitori a TUTTE le aziende, che è
// esattamente il difetto che questo piano toglie.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const AMMESSI = [
  // Il ripiego a interruttore spento.
  "server/fornitori/riconoscimento.ts",
  // L'importazione una tantum chiesta da una persona.
  "server/routers/fornitori.ts",
];

function sorgenti(dir: string, acc: string[] = []): string[] {
  for (const voce of readdirSync(dir)) {
    const percorso = join(dir, voce);
    if (voce === "node_modules" || voce === "dist") continue;
    if (statSync(percorso).isDirectory()) sorgenti(percorso, acc);
    else if (/\.tsx?$/.test(voce) && !/\.test\.tsx?$/.test(voce)) acc.push(percorso);
  }
  return acc;
}

describe("confine del seed dei fornitori", () => {
  it("solo due file importano SEED_FORNITORI_TENANT_1", () => {
    const colpevoli = sorgenti("server")
      .concat(sorgenti("client/src"))
      .filter(f => /SEED_FORNITORI_TENANT_1/.test(readFileSync(f, "utf8")))
      .map(f => f.replace(/\\/g, "/"))
      .sort();
    expect(colpevoli).toEqual(AMMESSI.slice().sort());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test server/fornitori/riconoscimento`
Expected: FAIL — il modulo `./riconoscimento` non esiste.

- [ ] **Step 3: Write minimal implementation**

In `server/platform/interruttori.ts`, aggiungi alla union `Interruttore`:

```ts
  // Fornitori per azienda (10/09/2026): a spento il riconoscimento passa dal
  // seed della Ruffino e si comporta esattamente come prima.
  | "fornitoriAzienda"
```

Crea `server/fornitori/riconoscimento.ts`:

```ts
// Il riconoscitore dei fornitori di UNA sede.
//
// È l'unico posto del server che sa dell'interruttore `fornitoriAzienda` e
// del seed della Ruffino Group: i consumatori chiedono qui e non sanno da
// dove esca l'elenco.
//
// Nessuna cache: si costruisce a ogni chiamata. Una cache di modulo in un CRM
// multi-azienda è il modo classico di far vedere a un'azienda i dati di
// un'altra, e costruirlo costa un `filter` su un elenco di decine di righe.

import {
  SEED_FORNITORI_TENANT_1,
  riconoscitoreFornitori,
  type FornitoreRiconoscibile,
  type Riconoscitore,
} from "@shared/fornitori";
import { interruttoreAttivo } from "../platform/interruttori";
import { fornitoriDiSede } from "./anagrafica";

/** Com'era prima del 10/09/2026: i venticinque della Ruffino Group. */
export function riconoscitoreDiRipiego(): Riconoscitore {
  return riconoscitoreFornitori(SEED_FORNITORI_TENANT_1);
}

/**
 * Un fornitore dell'anagrafica diventa DUE voci riconoscibili quando ha un
 * portale: le sue chiavi, e i domini del portale che riconducono a lui.
 */
function vociDi(f: {
  ragioneSociale: string;
  chiavi?: string[];
  portaleDomini?: string[];
}): FornitoreRiconoscibile[] {
  const voci: FornitoreRiconoscibile[] = [
    { nome: f.ragioneSociale, chiavi: f.chiavi ?? [] },
  ];
  if (f.portaleDomini?.length) {
    voci.push({
      nome: f.ragioneSociale,
      chiavi: f.portaleDomini,
      portaleDi: f.ragioneSociale,
    });
  }
  return voci;
}

export function riconoscitoreDiSede(sedeId: number): Riconoscitore {
  if (!interruttoreAttivo("fornitoriAzienda")) return riconoscitoreDiRipiego();
  const attivi = fornitoriDiSede(sedeId).filter(f => f.attivo !== false);
  return riconoscitoreFornitori(attivi.flatMap(vociDi));
}
```

**Nota:** se `interruttoreAttivo` non è esportato da `server/platform/interruttori.ts` con questo nome, usa quello vero — `server/routers/sedi.ts` lo chiama così (`interruttoreAttivo("multiAzienda")`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test server/fornitori/riconoscimento`
Expected: PASS, entrambi i file.

- [ ] **Step 5: Commit**

```bash
git add server/fornitori/riconoscimento.ts server/fornitori/riconoscimento.test.ts server/fornitori/riconoscimento.confine.test.ts server/platform/interruttori.ts
git commit -m "feat(fornitori): riconoscitoreDiSede, e la guardia su chi legge il seed

L'unico posto del server che sa dell'interruttore e del seed. Nessuna
cache: si costruisce a ogni chiamata, perché una cache di modulo qui
farebbe vedere a un'azienda i fornitori di un'altra.

La guardia di confine tiene a due i file che possono importare il seed:
il ripiego a interruttore spento e l'importazione una tantum.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `allegatoDaConferma` riceve il riconoscitore

È una funzione pura in un modulo di Tars: non deve raggiungere un archivio da sé.

**Files:**
- Modify: `server/tars/documenti/confermeMancanti.ts` (import e `allegatoDaConferma`)
- Test: `server/tars/documenti/confermeMancanti.test.ts`

**Interfaces:**
- Consumes: `Riconoscitore` (Task 3)
- Produces:
  ```ts
  export function allegatoDaConferma(input: {
    nome: string;
    mimeType: string | null | undefined;
    mittente?: string | null;
    mittenteNome?: string | null;
    riconoscitore: Riconoscitore;
  }): EsitoAllegatoConferma;
  ```
  `riconoscitore` è **obbligatorio**: dimenticarlo deve essere un errore di compilazione, non un silenzioso «nessun fornitore è noto».

- [ ] **Step 1: Write the failing test**

In `server/tars/documenti/confermeMancanti.test.ts`, dentro `describe("allegatoDaConferma", …)`, aggiungi in cima al blocco:

```ts
  const rico = riconoscitoreFornitori(SEED_FORNITORI_TENANT_1);
```

e passa `riconoscitore: rico` a **ogni** chiamata di `allegatoDaConferma` già presente nel file. Poi aggiungi il test nuovo:

```ts
  it("con un elenco che non contiene quel fornitore, la porta resta chiusa", () => {
    const altra = riconoscitoreFornitori([
      { nome: "Vetreria Bianchi", chiavi: ["vetreriabianchi"] },
    ]);
    expect(
      allegatoDaConferma({
        nome: "R237_2026WU367846_20052026165105.pdf",
        mimeType: "application/pdf",
        mittente: "amministrazione@primed.it",
        riconoscitore: altra,
      })
    ).toBeNull();
  });
```

Estendi gli import del file di test con `riconoscitoreFornitori` e `SEED_FORNITORI_TENANT_1` da `@shared/fornitori`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test server/tars/documenti/confermeMancanti.test.ts`
Expected: FAIL — tsc/vitest si lamentano di `riconoscitore` non presente nel tipo dell'input.

- [ ] **Step 3: Write minimal implementation**

In `server/tars/documenti/confermeMancanti.ts`, sostituisci l'import di `@shared/fornitori`:

```ts
import type { Riconoscitore } from "@shared/fornitori";
```

e in `allegatoDaConferma` aggiungi il parametro e usalo:

```ts
export function allegatoDaConferma(input: {
  nome: string;
  mimeType: string | null | undefined;
  mittente?: string | null;
  mittenteNome?: string | null;
  /**
   * I fornitori di QUESTA sede. Obbligatorio: dimenticarlo dev'essere un
   * errore di compilazione, non un silenzioso «nessun fornitore è noto» che
   * richiuderebbe la porta aperta il 10/09/2026 senza che nessuno se ne
   * accorga.
   */
  riconoscitore: Riconoscitore;
}): EsitoAllegatoConferma {
  const daNome = nomeDaConferma(input.nome, input.mimeType);
  if (daNome) return daNome;
  if (NOME_ESCLUSO.test(input.nome)) return null;
  if (input.mimeType && !MIME_AMMESSI.test(input.mimeType)) return null;
  const noto =
    input.riconoscitore.nome(input.mittenteNome ?? null, input.mittente ?? null) ??
    input.riconoscitore.nome(input.mittente ?? null);
  return noto ? "mittente" : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test server/tars/documenti/confermeMancanti.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/tars/documenti/confermeMancanti.ts server/tars/documenti/confermeMancanti.test.ts
git commit -m "refactor(conferme): allegatoDaConferma riceve il riconoscitore della sede

È una funzione pura: non deve raggiungere un archivio da sé. Il parametro
è obbligatorio di proposito — dimenticarlo dev'essere un errore di
compilazione, non un silenzioso «nessun fornitore è noto».

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: L'archivio riconosce con i fornitori della sua sede

**Files:**
- Modify: `server/fornitori/archivio.ts` (import; `fornitoreDiComunicazione` ~195–212; la scansione ~369; `chiaviRicercaFornitore` ~237; le normalizzazioni a ~488, ~1065, ~1139)
- Test: `server/fornitori/archivio.test.ts`

**Interfaces:**
- Consumes: `riconoscitoreDiSede` (Task 4), `allegatoDaConferma` col riconoscitore (Task 5)
- Produces: `fornitoreDiComunicazione(c, interni, riconoscitore)` — terzo parametro **obbligatorio**. `chiaviRicercaFornitore(fornitore, sedeId)` guadagna la sede.

- [ ] **Step 1: Write the failing test**

In `server/fornitori/archivio.test.ts`, dentro `describe("fornitoreDiComunicazione", …)`, aggiungi in cima:

```ts
  const rico = riconoscitoreFornitori(SEED_FORNITORI_TENANT_1);
```

passa `rico` come terzo argomento a ogni chiamata già presente (dove oggi il secondo argomento manca, passa `undefined`: `fornitoreDiComunicazione({…}, undefined, rico)`), e aggiungi:

```ts
  it("un fornitore che questa azienda non ha non viene riconosciuto", () => {
    const altra = riconoscitoreFornitori([{ nome: "Vetreria Bianchi", chiavi: ["vetreriabianchi"] }]);
    // La mail è di Alias, ma per QUESTA azienda Alias non esiste: entra col
    // suo dominio, non col nome aziendale della Ruffino.
    expect(
      fornitoreDiComunicazione(
        {
          mittente: "v.gregori@aliasblindate.com",
          mittenteNome: "DE - DOOR DESIGN S.R.L. Veronica Gregori",
          allegati: [{ nome: "conferma.pdf", mimeType: "application/pdf" }],
        },
        undefined,
        altra
      )
    ).not.toBe("Alias");
  });
```

Estendi gli import del file di test con `riconoscitoreFornitori` e `SEED_FORNITORI_TENANT_1`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test server/fornitori/archivio.test.ts`
Expected: FAIL — `fornitoreDiComunicazione` accetta due parametri.

- [ ] **Step 3: Write minimal implementation**

In `server/fornitori/archivio.ts`, sostituisci l'import di `@shared/fornitori` con:

```ts
import type { Riconoscitore } from "@shared/fornitori";
import { riconoscitoreDiSede } from "./riconoscimento";
import { fornitoriDiSede } from "./anagrafica";
```

`fornitoreDiComunicazione` prende il riconoscitore come terzo parametro e usa `riconoscitore.nome` / `riconoscitore.normalizza` al posto delle funzioni di modulo:

```ts
export function fornitoreDiComunicazione(
  c: {
    mittente: string;
    mittenteNome?: string | null;
    allegati: ReadonlyArray<{ nome: string; mimeType: string }>;
  },
  interni: ReadonlySet<string> | undefined,
  riconoscitore: Riconoscitore
): string | null {
  const noto =
    riconoscitore.nome(c.mittenteNome ?? null, c.mittente) ??
    riconoscitore.nome(c.mittente);
  if (noto) return noto;
  const portaConferma = c.allegati.some(
    a =>
      allegatoDaConferma({
        nome: a.nome,
        mimeType: a.mimeType,
        mittente: c.mittente,
        mittenteNome: c.mittenteNome ?? null,
        riconoscitore,
      }) != null
  );
  if (!portaConferma) return null;
  const at = c.mittente.lastIndexOf("@");
  const dominio = at > 0 ? c.mittente.slice(at + 1).toLowerCase().replace(/^www\./, "") : "";
  if (interni?.has(dominio)) return FORNITORE_DA_RICONOSCERE;
  const dalNome = riconoscitore.normalizza(c.mittenteNome ?? null, c.mittente);
  if (dalNome) return dalNome;
  return dominio ? dominio.slice(0, 60) : FORNITORE_DA_RICONOSCERE;
}
```

`chiaviRicercaFornitore` legge l'anagrafica della sede invece del seed:

```ts
/** Le chiavi con cui cercare le comunicazioni di un fornitore fra i mittenti. */
export function chiaviRicercaFornitore(fornitore: string, sedeId: number): string[] {
  const suo = fornitoriDiSede(sedeId).find(f => f.ragioneSociale === fornitore);
  const chiavi = [...(suo?.chiavi ?? []), ...(suo?.portaleDomini ?? [])];
  return chiavi.length > 0 ? chiavi : [fornitore];
}
```

In `eseguiGiroArchivioFornitori`, costruisci il riconoscitore una volta accanto a `interni` e passalo dove serve:

```ts
  const riconoscitore = riconoscitoreDiSede(input.sedeId);
```

I tre punti che chiamavano `normalizzaFornitore` diventano:

- **≈488**, dentro il giro: `riconoscitore.normalizza(ricerca.fornitore)`, con la variabile appena costruita.
- **≈1065**, in `confermeDiSede({ sedeId, … })`: costruisci `const riconoscitore = riconoscitoreDiSede(input.sedeId);` in cima alla funzione e usa
  `riconoscitore.normalizza(lettura?.fornitore ?? null) ?? FORNITORE_DA_RICONOSCERE`.
- **≈1139**, in `consegneInArrivo({ sedeId, … })`: stessa cosa, `const riconoscitore = riconoscitoreDiSede(input.sedeId);` in cima, poi
  `riconoscitore.normalizza(p.fornitore) ?? p.fornitore ?? FORNITORE_DA_RICONOSCERE`.

Entrambe hanno già `input.sedeId` nella firma: non serve dedurre niente.

Aggiorna i chiamanti di `chiaviRicercaFornitore` in `server/routers/fornitori.ts` passando `ctx.sedeId ?? DEFAULT_SEDE_ID`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test server/fornitori`
Expected: PASS, compresi i test già presenti.

- [ ] **Step 5: Commit**

```bash
git add server/fornitori/archivio.ts server/fornitori/archivio.test.ts server/routers/fornitori.ts
git commit -m "refactor(archivio): riconosce con i fornitori della sua sede

fornitoreDiComunicazione prende il riconoscitore, chiaviRicercaFornitore
legge l'anagrafica invece del seed, e il giro lo costruisce una volta.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Il costo dalla conferma e il pre-filtro della posta

I due consumatori rimasti lato server. Vanno insieme perché nessuno dei due ha un test proprio da scrivere da zero: si verificano attraverso quelli che esistono.

**Files:**
- Modify: `server/commesse/costoDaConferma.ts:672-673`
- Modify: `server/comunicazioni/comunicazioni.ts:19` (import), `:1689` e `:1732`
- Test: `server/comunicazioni/allegatiCandidati.test.ts`

**Interfaces:**
- Consumes: `riconoscitoreDiSede` (Task 4)
- Produces: nessuna firma pubblica nuova.

- [ ] **Step 1: Write the failing test**

In `server/comunicazioni/allegatiCandidati.test.ts`, aggiungi:

```ts
  it("il pre-filtro guarda i fornitori della sede, non una costante", async () => {
    // A interruttore spento vale il seed, quindi Primed entra: è il
    // comportamento di oggi e non deve cambiare finché non si accende.
    const primed = await mail({
      mittente: "amministrazione@primed.it",
      mittenteNome: "PRIMED S.R.L.",
      allegati: [
        { nome: "R237_2026WU367846_20052026165105.pdf", mimeType: "application/pdf", size: 120_000 },
      ],
    });
    const ids = (
      await listComunicazioniConAllegatiCandidati({ sedeId: SEDE, giorniIndietro: 540 })
    ).map(c => c.id);
    expect(ids).toContain(primed.id);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm check`
Expected: FAIL — `comunicazioni.ts` e `costoDaConferma.ts` importano simboli che il Task 3 ha tolto (`SORGENTE_MITTENTE_FORNITORE`, `normalizzaFornitore`).

- [ ] **Step 3: Write minimal implementation**

In `server/commesse/costoDaConferma.ts`, sostituisci l'import di `normalizzaFornitore` con `import { riconoscitoreDiSede } from "../fornitori/riconoscimento";` e le due chiamate (≈672–673) con:

```ts
  // La sede è quella della commessa del documento — la stessa che la riga 624
  // usa già per l'identità della lettura visiva.
  const riconoscitore = riconoscitoreDiSede(Number(commessa.sedeId ?? 1));
  const fornitore =
    input.fornitore?.trim() ||
    riconoscitore.normalizza(estrazione.fornitoreCitato?.valore ?? null, mittente?.email) ||
    riconoscitore.normalizza(mittente?.nome ?? null, mittente?.email) ||
    null;
```

`commessa` è in scope da `const commessa: any = getCommessaById(documento.commessaId)`, poco sopra nella stessa funzione `registraCostoDaConferma`.

In `server/comunicazioni/comunicazioni.ts`, sostituisci l'import (riga 19) con:

```ts
import { riconoscitoreDiSede } from "../fornitori/riconoscimento";
```

e dentro `listComunicazioniConAllegatiCandidati`, al posto della costante:

```ts
  // I fornitori di QUESTA sede: la query è già per sede, e il pattern deve
  // esserlo altrettanto. Una sorgente sola per il ramo in memoria e per quello
  // in SQL: due copie divergerebbero e la mail entrerebbe da una porta e non
  // dall'altra.
  const sorgenteMittenti = riconoscitoreDiSede(input.sedeId).sorgenteMittenti();
  const mittenteFornitore = new RegExp(sorgenteMittenti, "i");
```

e nel ramo SQL sostituisci `${SORGENTE_MITTENTE_FORNITORE}` con `${sorgenteMittenti}`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm check && pnpm test server/comunicazioni server/commesse`
Expected: tsc pulito e test verdi.

- [ ] **Step 5: Commit**

```bash
git add server/commesse/costoDaConferma.ts server/comunicazioni/comunicazioni.ts server/comunicazioni/allegatiCandidati.test.ts
git commit -m "refactor(costo, posta): riconoscono con i fornitori della sede

Il pre-filtro della posta era il punto delicato: la query è già per sede e
ora lo è anche il pattern dei mittenti, con una sorgente sola per il ramo
in memoria e per quello in SQL.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Il router dell'anagrafica: campi nuovi, candidati, importazione

**Files:**
- Modify: `server/routers/fornitori.ts` (`create`, `update`, e il sotto-router `archivio`)
- Test: `server/routers/fornitori.anagrafica.test.ts` (nuovo)

**Interfaces:**
- Consumes: `fornitoriDiSede` (Task 1), `SEED_FORNITORI_TENANT_1` (Task 3), `getArchivioFornitoriStore` (esistente)
- Produces:
  - `fornitori.create` / `fornitori.update` accettano `chiavi`, `canale`, `portaleDomini`; `partitaIva` diventa facoltativa.
  - `fornitori.candidati` → `{ nome: string; dominio: string | null; conferme: number }[]`
  - `fornitori.importaSeed` → `{ creati: number }`

- [ ] **Step 1: Write the failing test**

Crea `server/routers/fornitori.anagrafica.test.ts` con tre test:

```ts
// L'anagrafica dei fornitori dal router: campi nuovi, candidati dedotti
// dall'archivio, e l'importazione una tantum dei venticinque.
import { describe, expect, it } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import { fornitoriDiSede } from "../fornitori/anagrafica";

const SEDE = 96_601;
const DIREZIONE_ID = 96_611;

function contesto(tenantId = 1): TrpcContext {
  return {
    user: { id: DIREZIONE_ID, role: "admin", ruolo: "direzione", ruoli: ["direzione"], name: "Dir" } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId: SEDE,
    sediIds: [SEDE],
    tenantId,
    tenant: null,
  };
}
const direzione = (tenantId = 1) => appRouter.createCaller(contesto(tenantId));

describe("anagrafica fornitori dal router", () => {
  it("crea un fornitore con chiavi, canale e portali, senza partita IVA", async () => {
    const f = await direzione().fornitori.create({
      ragioneSociale: "Vetreria Bianchi",
      categoria: "vetro",
      chiavi: ["vetreriabianchi", "bianchi"],
      canale: "mail",
      portaleDomini: [],
    });
    expect(f.chiavi).toEqual(["vetreriabianchi", "bianchi"]);
    expect(f.canale).toBe("mail");
    expect(f.partitaIva).toBeUndefined();
  });

  it("importa i venticinque una volta sola, e solo per il tenant 1", async () => {
    const primo = await direzione().fornitori.importaSeed();
    expect(primo.creati).toBe(25);
    const secondo = await direzione().fornitori.importaSeed();
    expect(secondo.creati).toBe(0);
    expect(fornitoriDiSede(SEDE).filter(f => f.ragioneSociale === "Alias")).toHaveLength(1);
    // Wnd nasce col portale Antenore, non come due fornitori.
    const wnd = fornitoriDiSede(SEDE).find(f => f.ragioneSociale === "Wnd");
    expect(wnd?.portaleDomini).toContain("antenore");
    await expect(direzione(2).fornitori.importaSeed()).rejects.toThrow();
  });
});
```

`appRouter` passa da `guardiaTenant` e da `requireAdmin`: senza un utente vero nello store risponde `FORBIDDEN`. Aggiungi quindi, prima del `describe` e sul modello di `server/fornitori/archivio.test.ts`:

```ts
import { getUtentiStore } from "./utenti";

{
  const utenti = getUtentiStore() as any[];
  if (!utenti.some(u => u.id === DIREZIONE_ID)) {
    utenti.push({
      id: DIREZIONE_ID,
      nome: "Dir",
      cognome: "Anagrafica",
      email: "anagrafica-dir@example.test",
      attivo: true,
      ruoli: ["direzione"],
      ruolo: "direzione",
      sediIds: [SEDE],
    });
  }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test server/routers/fornitori.anagrafica.test.ts`
Expected: FAIL — `create` non accetta `chiavi`, e `importaSeed` non esiste.

- [ ] **Step 3: Write minimal implementation**

In `server/routers/fornitori.ts`, in `create` e `update`, rendi `partitaIva` facoltativa e aggiungi allo schema Zod:

```ts
        chiavi: z.array(z.string().trim().toLowerCase().min(2).max(60)).max(20).optional(),
        canale: z.enum(["mail", "portale", "altro"]).optional(),
        portaleDomini: z.array(z.string().trim().toLowerCase().min(2).max(60)).max(10).optional(),
```

e nella creazione dai i default (`chiavi: input.chiavi ?? []`, `canale: input.canale ?? "mail"`, `portaleDomini: input.portaleDomini ?? []`).

Aggiungi due procedure al router `fornitori`:

```ts
  /**
   * I mittenti da cui è arrivata una conferma e che nell'anagrafica non ci
   * sono ancora. È così che un'azienda nuova si popola l'elenco: conferma
   * quello che le è già arrivato invece di battere venticinque nomi.
   */
  candidati: protectedProcedure.query(({ ctx }) => {
    const sedeId = ctx.sedeId ?? 1;
    const gia = new Set(fornitoriDiSede(sedeId).map(f => f.ragioneSociale.toLowerCase()));
    const conteggio = new Map<string, { dominio: string | null; conferme: number }>();
    for (const v of getArchivioFornitoriStore()) {
      if (v.sedeId !== sedeId) continue;
      const nome = String(v.fornitore ?? "").trim();
      if (!nome || nome === FORNITORE_DA_RICONOSCERE) continue;
      if (gia.has(nome.toLowerCase())) continue;
      const at = String(v.mittente ?? "").lastIndexOf("@");
      const dominio = at > 0 ? String(v.mittente).slice(at + 1).toLowerCase() : null;
      const riga = conteggio.get(nome) ?? { dominio, conferme: 0 };
      riga.conferme += 1;
      if (!riga.dominio && dominio) riga.dominio = dominio;
      conteggio.set(nome, riga);
    }
    return [...conteggio.entries()]
      .map(([nome, r]) => ({ nome, ...r }))
      .sort((a, b) => b.conferme - a.conferme);
  }),

  /**
   * I venticinque della Ruffino Group nell'anagrafica del tenant 1. UNA
   * TANTUM e su richiesta: la riga di `kv_store` esiste già, quindi un seed
   * al `firstBoot` non partirebbe mai, e uno senza quella guardia
   * calpesterebbe l'elenco di chi li ha cancellati apposta.
   */
  importaSeed: adminProcedure.mutation(({ ctx }) => {
    if ((ctx.tenantId ?? TENANT_PREDEFINITO_ID) !== TENANT_PREDEFINITO_ID) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Questo elenco è dei fornitori della Ruffino Group.",
      });
    }
    const sedeId = ctx.sedeId ?? 1;
    const gia = new Set(fornitoriDiSede(sedeId).map(f => f.ragioneSociale.toLowerCase()));
    const now = new Date();
    let creati = 0;
    // Le voci di portale del seed non sono fornitori a sé: confluiscono nel
    // produttore a cui riconducono.
    for (const voce of SEED_FORNITORI_TENANT_1) {
      if (voce.portaleDi) continue;
      if (gia.has(voce.nome.toLowerCase())) continue;
      const portali = SEED_FORNITORI_TENANT_1
        .filter(p => p.portaleDi === voce.nome)
        .flatMap(p => [...p.chiavi]);
      fornitori.push({
        id: _fornitoriStore.prossimoId(),
        sedeId,
        ragioneSociale: voce.nome,
        categoria: "altro",
        chiavi: [...voce.chiavi],
        canale: portali.length > 0 ? "portale" : "mail",
        portaleDomini: portali,
        attivo: true,
        createdAt: now,
        updatedAt: now,
      } as Fornitore);
      gia.add(voce.nome.toLowerCase());
      creati += 1;
    }
    if (creati > 0) _fornitoriStore.save();
    return { creati };
  }),
```

Aggiungi gli import mancanti: `SEED_FORNITORI_TENANT_1` da `@shared/fornitori`, `TENANT_PREDEFINITO_ID` da `../tenants/costanti`, `getArchivioFornitoriStore` e `FORNITORE_DA_RICONOSCERE` da `../fornitori/archivio`, `fornitoriDiSede` da `../fornitori/anagrafica`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test server/routers/fornitori.anagrafica.test.ts && pnpm test server/fornitori`
Expected: PASS. La guardia di confine del Task 4 deve restare verde: `server/routers/fornitori.ts` è fra i due file ammessi.

- [ ] **Step 5: Commit**

```bash
git add server/routers/fornitori.ts server/routers/fornitori.anagrafica.test.ts
git commit -m "feat(fornitori): campi nuovi, candidati dall'archivio, importazione dei 25

I candidati sono la parte che rende accettabile il lavoro per un'azienda
nuova: non batte venticinque nomi, conferma i mittenti da cui le sono già
arrivate conferme.

L'importazione è una tantum e su richiesta, mai un seed all'avvio: la riga
kv_store esiste già (firstBoot falso) e senza quella guardia si
calpesterebbe l'elenco di chi li ha cancellati apposta.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: La colonna di `/fornitori` diventa l'anagrafica, e il Magazzino legge la sede

**Files:**
- Modify: `client/src/pages/Fornitori.tsx` (la colonna sinistra, ~304)
- Modify: `client/src/pages/Magazzino.tsx:47`, `:619`, `:881`, `:1108-1111`
- Test: `client/src/pages/fornitoriAnagraficaView.test.ts` (nuovo) — la vista pura, come gli altri `*View.test.ts` del repo

**Interfaces:**
- Consumes: `fornitori.candidati`, `fornitori.importaSeed`, `fornitori.create`, `fornitori.update`, `fornitori.list`
- Produces: `client/src/lib/fornitoriView.ts` con
  ```ts
  export type VoceElenco =
    | { tipo: "anagrafica"; id: number; nome: string; conferme: number; inArrivo: number; attivo: boolean }
    | { tipo: "candidato"; nome: string; dominio: string | null; conferme: number };
  export function componiElencoFornitori(input: {
    anagrafica: ReadonlyArray<{ id: number; ragioneSociale: string; attivo: boolean }>;
    riepilogo: ReadonlyArray<{ fornitore: string; conferme: number; inArrivo: number }>;
    candidati: ReadonlyArray<{ nome: string; dominio: string | null; conferme: number }>;
  }): VoceElenco[];
  ```

- [ ] **Step 1: Write the failing test**

Crea `client/src/lib/fornitoriView.test.ts`:

```ts
// L'elenco di sinistra della pagina Fornitori: i fornitori dell'azienda,
// più i mittenti da cui è arrivata una conferma e che non sono ancora
// censiti. Chi ha da decidere sta in cima.
import { describe, expect, it } from "vitest";
import { componiElencoFornitori } from "./fornitoriView";

describe("componiElencoFornitori", () => {
  it("mette in cima chi ha conferme in attesa, e i candidati dopo l'anagrafica", () => {
    const elenco = componiElencoFornitori({
      anagrafica: [
        { id: 1, ragioneSociale: "Alias", attivo: true },
        { id: 2, ragioneSociale: "Pail", attivo: true },
      ],
      riepilogo: [
        { fornitore: "Alias", conferme: 110, inArrivo: 3 },
        { fornitore: "Pail", conferme: 0, inArrivo: 0 },
      ],
      candidati: [{ nome: "Vetreria Bianchi", dominio: "vetreriabianchi.it", conferme: 4 }],
    });
    expect(elenco.map(v => v.nome)).toEqual(["Alias", "Pail", "Vetreria Bianchi"]);
    expect(elenco[0].tipo).toBe("anagrafica");
    expect(elenco[2].tipo).toBe("candidato");
  });

  it("un fornitore censito non compare anche come candidato", () => {
    const elenco = componiElencoFornitori({
      anagrafica: [{ id: 1, ragioneSociale: "Alias", attivo: true }],
      riepilogo: [{ fornitore: "Alias", conferme: 2, inArrivo: 0 }],
      candidati: [{ nome: "Alias", dominio: "aliasblindate.com", conferme: 2 }],
    });
    expect(elenco).toHaveLength(1);
    expect(elenco[0].tipo).toBe("anagrafica");
  });

  it("un fornitore disattivato resta in elenco, dichiarato", () => {
    const elenco = componiElencoFornitori({
      anagrafica: [{ id: 1, ragioneSociale: "Korus", attivo: false }],
      riepilogo: [],
      candidati: [],
    });
    expect(elenco[0]).toMatchObject({ tipo: "anagrafica", attivo: false, conferme: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test client/src/lib/fornitoriView.test.ts`
Expected: FAIL — `./fornitoriView` non esiste.

- [ ] **Step 3: Write minimal implementation**

Crea `client/src/lib/fornitoriView.ts`:

```ts
// L'elenco di sinistra della pagina Fornitori: i fornitori dell'azienda, più
// i mittenti da cui è arrivata una conferma e che non sono ancora censiti.
//
// Vive qui e non nella pagina perché è la sola parte con una regola dentro —
// chi va in cima, chi non va mostrato due volte — e una regola si prova.

export type VoceElenco =
  | { tipo: "anagrafica"; id: number; nome: string; conferme: number; inArrivo: number; attivo: boolean }
  | { tipo: "candidato"; nome: string; dominio: string | null; conferme: number };

export function componiElencoFornitori(input: {
  anagrafica: ReadonlyArray<{ id: number; ragioneSociale: string; attivo: boolean }>;
  riepilogo: ReadonlyArray<{ fornitore: string; conferme: number; inArrivo: number }>;
  candidati: ReadonlyArray<{ nome: string; dominio: string | null; conferme: number }>;
}): VoceElenco[] {
  const conteggi = new Map(input.riepilogo.map(r => [r.fornitore.toLowerCase(), r]));
  const censiti = new Set(input.anagrafica.map(f => f.ragioneSociale.toLowerCase()));

  const dellAzienda: VoceElenco[] = input.anagrafica
    .map(f => {
      const r = conteggi.get(f.ragioneSociale.toLowerCase());
      return {
        tipo: "anagrafica" as const,
        id: f.id,
        nome: f.ragioneSociale,
        conferme: r?.conferme ?? 0,
        inArrivo: r?.inArrivo ?? 0,
        attivo: f.attivo,
      };
    })
    // Chi ha da decidere in cima; a parità, in ordine alfabetico.
    .sort((a, b) => b.conferme - a.conferme || a.nome.localeCompare(b.nome));

  const daCensire: VoceElenco[] = input.candidati
    .filter(c => !censiti.has(c.nome.toLowerCase()))
    .map(c => ({ tipo: "candidato" as const, nome: c.nome, dominio: c.dominio, conferme: c.conferme }))
    .sort((a, b) => b.conferme - a.conferme || a.nome.localeCompare(b.nome));

  return [...dellAzienda, ...daCensire];
}
```

In `client/src/pages/Fornitori.tsx`, la colonna sinistra si costruisce da `componiElencoFornitori` con le tre query. Su una voce `candidato`: un bottone «Aggiungilo ai tuoi fornitori» che chiama `fornitori.create` con `ragioneSociale: nome` e `chiavi: [dominio]` (senza l'estensione: `vetreriabianchi.it` → `vetreriabianchi`). Su una voce `anagrafica`: «Modifica» (dialogo con nome, categoria, canale, chiavi come elenco di parole, portali, attivo). A elenco vuoto e `tenants.mio.id === TENANT_PIATTAFORMA_ID`: il bottone «Importa i 25 fornitori conosciuti».

In `client/src/pages/Magazzino.tsx`, togli `import { FORNITORI } from "@shared/fornitori";` e sostituisci le quattro occorrenze con la lista dalla query `trpc.fornitori.list.useQuery({ attivo: true })`, mappata a `ragioneSociale`. La riga 1108 (`!FORNITORI.includes(p.fornitore)`) diventa `!nomi.includes(p.fornitore)`, dove `nomi` è quella lista: serve a tenere selezionabile un valore storico che non è più in anagrafica.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test client/src/lib/fornitoriView.test.ts && pnpm check`
Expected: PASS e tsc pulito.

- [ ] **Step 5: Verify in the browser**

Avvia l'anteprima e controlla la pagina `/fornitori` a **1440×900** e **390×844**: l'elenco a sinistra mostra anagrafica e candidati distinti, nessuno scroll orizzontale di pagina, nessun errore in console (React #185 in sviluppo è solo un log, in produzione spegne la pagina).

- [ ] **Step 6: Commit**

```bash
git add client/src/lib/fornitoriView.ts client/src/lib/fornitoriView.test.ts client/src/pages/Fornitori.tsx client/src/pages/Magazzino.tsx
git commit -m "feat(fornitori): la colonna di /fornitori è l'anagrafica più i candidati

Oggi quella colonna elenca i mittenti visti nella posta. Diventa i
fornitori dell'azienda più i candidati — mittenti da cui è arrivata una
conferma e che non sono censiti — con un bottone solo.

Il Magazzino smette di leggere la costante e legge la lista della sede.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Documenti e verifica finale

**Files:**
- Modify: `documento_requisiti_infissi_ops.md` (§19.1 e §36-bis)
- Modify: `handoff.md`
- Modify: `CLAUDE.md` (un invariante nuovo)

- [ ] **Step 1: Aggiorna il PRD**

In §19.1 «Anagrafica fornitore», sostituisci l'elenco dei campi con:

```markdown
- Campi: `ragioneSociale, partitaIva?, indirizzo?, citta?, telefono?, email?,
  categoria, chiavi[], canale, portaleDomini[], referenteCommerciale?,
  scontistica?, note?, attivo`.
- Categorie: `pvc, alluminio, vetro, ferramenta, persiane, blindati, accessori,
  guarnizioni, altro`.
- **Dal 10/09/2026 l'anagrafica è la fonte del riconoscimento** (spec
  `2026-09-10-fornitori-per-azienda-e-profili-design.md` §4): `chiavi` sono le
  parole e i domini con cui si riconosce il fornitore in un documento o nel
  dominio di una mail, `portaleDomini` i domini del portale con cui gli si
  ordina (`antenore.biz` per Wnd). `shared/fornitori.ts` conserva le REGOLE e
  il SEED dei venticinque della Ruffino Group, importabile una volta sola dal
  tenant 1; nessun percorso di dominio lo legge (guardia
  `server/fornitori/riconoscimento.confine.test.ts`).
- `partitaIva` è facoltativa: per riconoscere un mittente non serve.
```

In §36-bis.4 «UI», aggiungi in fondo:

```markdown
Dal 10/09/2026 l'elenco di sinistra è **l'anagrafica dei fornitori
dell'azienda** più i **candidati**: mittenti da cui è arrivata una conferma e
che nell'anagrafica non ci sono ancora, con un bottone solo per censirli. È
così che un'azienda nuova si costruisce l'elenco senza battere venticinque
nomi. A elenco vuoto, e solo per l'azienda della piattaforma, compare «Importa
i 25 fornitori conosciuti».
```

- [ ] **Step 2: Aggiungi l'invariante a CLAUDE.md**

Nella sezione «Invarianti», dopo la riga su `storeDi`:

```markdown
- I fornitori sono **dell'azienda**: il riconoscimento passa sempre da
  `riconoscitoreDiSede(sedeId)` (`server/fornitori/riconoscimento.ts`), mai da
  una costante. `SEED_FORNITORI_TENANT_1` lo importano solo il ripiego a
  interruttore spento e l'importazione una tantum del router (guardia
  `server/fornitori/riconoscimento.confine.test.ts`). Nessuna cache di modulo
  del riconoscitore: si costruisce per sede a ogni chiamata.
```

- [ ] **Step 3: Aggiorna handoff.md**

In cima, un blocco «Novità» nello stile degli altri, che dica: l'anagrafica è la fonte, l'interruttore `fornitoriAzienda` nasce spento e a spento non cambia niente, i candidati, l'importazione una tantum e perché non è un seed all'avvio, e che il difetto tolto era che l'azienda 2 vedeva i fornitori della Ruffino.

- [ ] **Step 4: Verifica completa**

```bash
pnpm check
```
Expected: nessun errore.

```bash
pnpm test
```
Expected: tutti i file passati, nessuna regressione rispetto alla base.

```bash
pnpm build
```
Expected: build riuscita.

- [ ] **Step 5: Commit**

```bash
git add documento_requisiti_infissi_ops.md handoff.md CLAUDE.md
git commit -m "docs(fornitori): PRD, handoff e invariante dei fornitori per azienda

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Dopo il merge

L'interruttore `fornitoriAzienda` nasce **spento** e a spento non cambia niente: si rilascia senza rischio. Per accenderlo:

1. Aprire `/fornitori` come tenant 1 e premere «Importa i 25 fornitori conosciuti». Verificare che Wnd abbia `antenore` fra i portali.
2. Accendere l'interruttore.
3. Forzare un giro dell'archivio e contare le voci per fornitore: devono restare quelle di prima. Se qualcosa sparisce, un fornitore ha `chiavi` diverse da quelle del seed.
4. Solo allora ha senso il **piano 2** (gli esempi e i profili di lettura): senza fornitori dell'azienda non c'è niente a cui attaccare un profilo.
