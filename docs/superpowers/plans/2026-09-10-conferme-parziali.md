# Conferme parziali — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Due conferme dello stesso ordine che portano merce **diversa** sono due pezzi di un ordine solo, e il costo fornitore è la loro **somma** — non la più alta delle due, che è quello che il CRM tiene oggi.

**Architecture:** Il discriminante è già nei dati e non serve indovinarlo: gli **articoli**. Articoli in comune ⇒ le due conferme parlano della stessa merce ⇒ è una revisione (o una copia), e vale la regola di ieri. Articoli **disgiunti** ⇒ sono due pezzi dello stesso ordine ⇒ si sommano. Perché il confronto sia possibile bisogna prima smettere di buttare via le prove: oggi le copie che non vincono non hanno nemmeno gli articoli estratti.

**Tech Stack:** TypeScript, Vitest.

**Spec:** nessuna spec a sé — è il seguito dichiarato del piano `docs/superpowers/plans/2026-09-10-conferme-discordi.md` («Fuori da questo piano»), che ha introdotto l'esito `discorde`. Contesto: PRD §54.7.

## Perché la somma si applica invece di essere proposta

L'estrattore delle righe di merce si dichiara a bassa confidenza, e la tentazione è proporre la somma invece di scriverla. **La direzione dell'errore dice il contrario.**

- Se sommo due conferme che erano una revisione (classificazione sbagliata), il costo risulta **troppo alto** ⇒ margine troppo basso ⇒ un lavoro sembra peggiore di com'è. Costa attenzione.
- Se **non** sommo due conferme che erano parziali, il costo è **troppo basso** ⇒ margine **gonfiato** ⇒ un lavoro sembra migliore di com'è. Costa soldi, per mesi, senza che nessuno se ne accorga.

Sommare sbaglia dalla parte giusta, ed è la stessa ragione per cui ieri, in assenza di prova, il costo è rimasto il più alto.

## Global Constraints

- **Stesso riferimento e stesso imponibile resta una copia sola** (vincolo della direzione, 10/09/2026). La somma non lo tocca: due copie identiche non hanno articoli disgiunti.
- **Niente articoli, niente somma.** Se una delle due letture non ha righe di merce, il confronto non si può fare: resta `discorde`, col più alto. Un'assenza non è una prova di disgiunzione.
- **Solo i costi scritti dalla regola.** Un costo che una persona ha fissato non si somma e non si tocca: la discordanza l'ha già risolta lei.
- **Un costo solo per ordine.** La somma aggiorna il costo esistente; non ne crea un secondo.
- Comandi: `pnpm check`, `pnpm test`, `pnpm build`.

## Struttura dei file

| File | Responsabilità |
|---|---|
| `server/commesse/letturaCostoTipi.ts` | `articoliLetti?: string[]` sulla lettura, e l'esito `parziale`. |
| `server/commesse/confrontoArticoli.ts` **(nuovo)** | `confrontoArticoli(a, b)`: disgiunti, sovrapposti o ignoto. Puro. |
| `server/commesse/costoDaConferma.ts` | Gli articoli si estraggono sempre; il ramo dei discordi diventa somma quando sono disgiunti. |

---

### Task 1: Gli articoli si estraggono anche per le copie che non vincono

Oggi solo il documento che vince passa da `applicaMerceDaConferma`: le altre copie non hanno righe di merce, e senza quelle non c'è confronto possibile. Verificato sui dati veri: dei quattro documenti di COM-2026-092, solo il vincitore ha articoli.

**Files:**
- Modify: `server/commesse/letturaCostoTipi.ts`
- Modify: `server/commesse/costoDaConferma.ts`
- Test: `server/commesse/costoDaConferma.test.ts`

**Interfaces:**
- Produces: `LetturaCostoDocumento` guadagna
  ```ts
  /** I nomi degli articoli letti nel documento, anche quando non ha prodotto costo né merce. */
  articoliLetti?: string[];
  ```
  Il Task 3 li confronta.

- [ ] **Step 1: Write the failing test**

In `server/commesse/costoDaConferma.test.ts`, dentro il describe dei duplicati, aggiungi:

```ts
  it("anche la copia che non vince porta i suoi articoli: senza, nessun confronto è possibile", async () => {
    const commessa = await inOrdine("Articoli Sempre");
    const primo = await carica(
      commessa.id,
      ALIAS_ORDINE("ARTICOLI SEMPRE", "1690001", "16/06/2026", "727,17"),
      { nome: "Ordini_di_Vendi_1690001(1).pdf" }
    );
    const secondo = await carica(
      commessa.id,
      ALIAS_ORDINE("ARTICOLI SEMPRE", "1690001", "16/06/2026", "556,75"),
      { nome: "Ordini_di_Vendi_1690001(1) (2).pdf" }
    );
    for (const doc of [primo, secondo]) {
      const letti = getDocumentoRecordById(doc.id)?.letturaCosto?.articoliLetti ?? [];
      expect(letti.length).toBeGreaterThan(0);
      expect(letti.join(" ")).toContain("PORST-C013");
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test server/commesse/costoDaConferma.test.ts`
Expected: FAIL — `articoliLetti` è `undefined` sulla seconda copia (e probabilmente su entrambe).

- [ ] **Step 3: Write minimal implementation**

In `server/commesse/letturaCostoTipi.ts`, accanto a `discordi`:

```ts
  /**
   * I nomi degli articoli letti nel documento, anche quando non ha prodotto
   * costo né merce. Servono a distinguere una conferma PARZIALE (merce
   * diversa sullo stesso ordine) da una revisione, e senza di essi quel
   * confronto è impossibile: fino al 10/09/2026 le copie che non vincevano
   * non li avevano mai estratti.
   */
  articoliLetti?: string[];
```

In `server/commesse/costoDaConferma.ts`, subito dopo che `parser.pagine` è disponibile e prima del ramo dei duplicati (accanto al calcolo di `fornitore`), aggiungi:

```ts
  // Gli articoli si leggono SEMPRE, anche se questo documento non produrrà né
  // costo né merce: sono la prova che distingue una conferma parziale da una
  // revisione, e buttarla via è ciò che ha reso il problema invisibile.
  // Costa una scansione del testo già in memoria.
  const articoliLetti = estraiRigheMerce(parser.pagine)
    .map(r => r.nome)
    .slice(0, 40);
```

e aggiungilo a `memoriaBase` (riga 712), che è l'oggetto condiviso da tutti i rami dello stesso giro — così ogni `salva({ ...memoriaBase, ... })` lo porta con sé senza ripeterlo sette volte:

```ts
  const memoriaBase = {
    fonteTesto,
    imponibile,
    fornitore,
    numeroOrdine,
    dataDocumento,
    tentativi,
    riferimenti,
    sezioni,
    evidenze,
    articoliLetti,
  };
```

`memoriaBase` sta **prima** del punto in cui `articoliLetti` andrebbe calcolato se lo si mettesse accanto a `fornitore`: calcolalo **sopra** `memoriaBase`, subito dopo che `parser.pagine` è disponibile.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test server/commesse/costoDaConferma.test.ts && pnpm check`
Expected: PASS e tsc pulito.

- [ ] **Step 5: Commit**

```bash
git add server/commesse/letturaCostoTipi.ts server/commesse/costoDaConferma.ts server/commesse/costoDaConferma.test.ts
git commit -m "feat(costo): gli articoli si leggono anche per le copie che non vincono

Senza, il confronto fra una conferma parziale e una revisione è
impossibile — ed è ciò che ha reso il problema invisibile: dei quattro
documenti di COM-2026-092 solo il vincitore aveva righe di merce.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Il confronto fra gli articoli di due conferme

**Files:**
- Create: `server/commesse/confrontoArticoli.ts`
- Test: `server/commesse/confrontoArticoli.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type EsitoConfronto = "disgiunti" | "sovrapposti" | "ignoto";
  export function confrontoArticoli(
    a: readonly string[] | null | undefined,
    b: readonly string[] | null | undefined
  ): EsitoConfronto;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// Due conferme dello stesso ordine: parlano della stessa merce o di merce
// diversa? È il discriminante fra una revisione e una conferma parziale, e
// decide se il costo è il più alto dei due o la loro somma.
import { describe, expect, it } from "vitest";
import { confrontoArticoli } from "./confrontoArticoli";

describe("confrontoArticoli", () => {
  it("nessun articolo in comune: sono due pezzi dello stesso ordine", () => {
    expect(
      confrontoArticoli(
        ["PORST-C013 PORTA BLIND.STEEL/C", "KPO50 KIT PORTA"],
        ["F85 FALSO TELAIO 2100X850", "COI5 SET COPRIFILI INTERNO"]
      )
    ).toBe("disgiunti");
  });

  it("un articolo in comune basta: parlano della stessa merce", () => {
    expect(
      confrontoArticoli(
        ["PORST-C013 PORTA BLIND.STEEL/C", "KPO50 KIT PORTA"],
        ["PORST-C013 PORTA BLIND.STEEL/C", "COI5 SET COPRIFILI"]
      )
    ).toBe("sovrapposti");
  });

  it("le differenze di scrittura non fanno due articoli", () => {
    // Lo stesso codice con spaziatura e maiuscole diverse è lo stesso codice.
    expect(
      confrontoArticoli(["PORST-C013   PORTA BLIND.STEEL/C < 1900"], ["porst-c013 porta blind.steel/c"])
    ).toBe("sovrapposti");
  });

  it("senza articoli da una parte non si può dire", () => {
    // Un'assenza non è una prova di disgiunzione: sommare qui sarebbe
    // inventare un costo.
    expect(confrontoArticoli([], ["KPO50 KIT PORTA"])).toBe("ignoto");
    expect(confrontoArticoli(["KPO50 KIT PORTA"], null)).toBe("ignoto");
    expect(confrontoArticoli(undefined, undefined)).toBe("ignoto");
  });

  it("un articolo dal nome troppo generico non conta come prova", () => {
    // «1», «NR», «-» non identificano niente: se restano solo quelli, ignoto.
    expect(confrontoArticoli(["1", "NR"], ["-", "  "])).toBe("ignoto");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test server/commesse/confrontoArticoli.test.ts`
Expected: FAIL — il modulo non esiste.

- [ ] **Step 3: Write minimal implementation**

```ts
// Due conferme dello stesso ordine parlano della stessa merce o di merce
// diversa?
//
// È il discriminante fra una REVISIONE (stessa merce, importo cambiato: vale
// l'ultima) e una conferma PARZIALE (merce diversa: i due importi si
// sommano). L'estrattore delle righe è dichiaratamente a bassa confidenza,
// quindi la regola è prudente in un verso solo: un articolo in comune basta
// per dire «stessa merce», e se non c'è abbastanza materia per decidere la
// risposta è «ignoto» — mai «disgiunti» per assenza di prove.

export type EsitoConfronto = "disgiunti" | "sovrapposti" | "ignoto";

/** Un nome che non identifica niente non è un articolo. */
function significativi(nomi: readonly string[] | null | undefined): Set<string> {
  const insieme = new Set<string>();
  for (const nome of nomi ?? []) {
    const pulito = String(nome ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    // Meno di quattro caratteri utili è un'unità di misura o un numero di
    // riga, non un articolo.
    if (pulito.replace(/\s/g, "").length < 4) continue;
    insieme.add(pulito);
  }
  return insieme;
}

export function confrontoArticoli(
  a: readonly string[] | null | undefined,
  b: readonly string[] | null | undefined
): EsitoConfronto {
  const primi = significativi(a);
  const secondi = significativi(b);
  if (primi.size === 0 || secondi.size === 0) return "ignoto";
  for (const nome of primi) if (secondi.has(nome)) return "sovrapposti";
  return "disgiunti";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test server/commesse/confrontoArticoli.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/commesse/confrontoArticoli.ts server/commesse/confrontoArticoli.test.ts
git commit -m "feat(costo): il confronto fra gli articoli di due conferme

Un articolo in comune basta per dire «stessa merce»; senza materia
sufficiente la risposta è «ignoto», mai «disgiunti» per assenza di prove.
L'estrattore delle righe è a bassa confidenza: la regola è prudente in un
verso solo.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Articoli disgiunti ⇒ il costo è la somma

**Files:**
- Modify: `server/commesse/letturaCostoTipi.ts` (esito `parziale`)
- Modify: `server/commesse/costoDaConferma.ts` (ramo della discordanza)
- Test: `server/commesse/costoDaConferma.test.ts`

**Interfaces:**
- Consumes: `articoliLetti` (Task 1), `confrontoArticoli` (Task 2), `aggiornaImportoCosto`
- Produces: `EsitoLetturaCosto` guadagna `"parziale"`.

- [ ] **Step 1: Write the failing test**

```ts
  it("stesso ordine, merce diversa: sono due pezzi e il costo è la somma", async () => {
    const commessa = await inOrdine("Parziali Somma");
    const porta = [
      "Conferma Ordine",
      "ALIAS Srl Porte blindate",
      "2026 - CV 1690010 del 16/06/2026",
      "NR 1,00PORST-C013 PORTA BLIND.STEEL/C < 1900",
      "Tot. Imponibile 727,17",
    ];
    const coprifili = [
      "Conferma Ordine",
      "ALIAS Srl Porte blindate",
      "2026 - CV 1690010 del 16/06/2026",
      "NR 1,00COI5 SET COPRIFILI INTERNO SU MISURA",
      "Tot. Imponibile 556,75",
    ];
    const primo = await carica(commessa.id, porta, { nome: "Ordini_di_Vendi_1690010(1).pdf" });
    const secondo = await carica(commessa.id, coprifili, { nome: "Ordini_di_Vendi_1690010(1) (2).pdf" });

    // Un costo solo, e vale la somma: 727,17 + 556,75.
    const costi = costiDi(commessa.id);
    expect(costi).toHaveLength(1);
    expect(costi[0].importo).toBeCloseTo(1283.92, 2);
    expect(costi[0].documentoId).toBe(primo.id);

    const lettura = getDocumentoRecordById(secondo.id)?.letturaCosto;
    expect(lettura?.esito).toBe("parziale");
    expect(lettura?.motivo).toMatch(/merce diversa|parziale/i);
  });

  it("stesso ordine, stessa merce: resta discordanza, non si somma", async () => {
    const commessa = await inOrdine("Parziali No");
    const primo = await carica(
      commessa.id,
      ALIAS_ORDINE("PARZIALI NO", "1690011", "16/06/2026", "727,17"),
      { nome: "Ordini_di_Vendi_1690011(1).pdf" }
    );
    const secondo = await carica(
      commessa.id,
      ALIAS_ORDINE("PARZIALI NO", "1690011", "16/06/2026", "556,75"),
      { nome: "Ordini_di_Vendi_1690011(1) (2).pdf" }
    );
    expect(costiDi(commessa.id)).toHaveLength(1);
    expect(costiDi(commessa.id)[0].importo).toBe(727.17);
    expect(costiDi(commessa.id)[0].documentoId).toBe(primo.id);
    expect(getDocumentoRecordById(secondo.id)?.letturaCosto?.esito).toBe("discorde");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test server/commesse/costoDaConferma.test.ts`
Expected: FAIL — il primo test dà 727,17 (il più alto) invece di 1.283,92 ed esito `discorde`.

- [ ] **Step 3: Write minimal implementation**

In `letturaCostoTipi.ts`, dopo `"discorde"`:

```ts
  /**
   * Stesso ordine di un'altra conferma ma merce DIVERSA: sono due pezzi di un
   * ordine solo, e il costo è la loro somma. Il costo resta sul primo
   * documento; questo vi contribuisce e non ne crea un secondo (10/09/2026).
   */
  | "parziale"
```

In `costoDaConferma.ts`, dentro il ramo della discordanza (`importiDiversi && correggibile && prova === "nessuna_prova"`), **prima** del calcolo di `alto`/`basso`:

```ts
      const confronto = confrontoArticoli(
        articoliLetti,
        letturaOriginale?.articoliLetti ?? null
      );
      if (confronto === "disgiunti") {
        // Merce diversa sullo stesso ordine: sono due pezzi, e il costo è la
        // somma. Si applica invece di proporla perché la direzione
        // dell'errore è quella giusta: sommare due revisioni gonfia il costo
        // (margine più basso, costa attenzione), NON sommare due parziali
        // gonfia il margine (costa soldi, e in silenzio).
        const somma = Math.round((costoOriginale!.importo + imponibile!) * 100) / 100;
        aggiornaImportoCosto(
          commessa,
          costoOriginale!,
          somma,
          `Somma di due conferme parziali dell'ordine ${duplicato.riferimento}: ${euro(
            costoOriginale!.importo
          )} + ${euro(imponibile!)} da «${raw.nome}», che porta merce diversa.`,
          { fornitore, data: dataDocumento, numeroOrdine }
        );
        ritira(commessa, documento);
        const motivo = `Conferma parziale dell'ordine ${duplicato.riferimento}: porta merce diversa da «${
          originale.nome
        }», quindi i due imponibili si sommano. A registro ${euro(somma)} (${euro(
          costoOriginale!.importo
        )} + ${euro(imponibile!)}).`;
        salva({
          ...memoriaBase,
          esito: "parziale",
          motivo,
          costoId: null,
          merce: null,
          duplicatoDi: originale.id,
          discordi: [costoOriginale!.importo, imponibile!],
          riscontro: riscontro ? { ok: true, prove: riscontro.prove } : null,
        });
        return base(documento, "parziale", motivo, {
          fonteTesto,
          imponibile,
          duplicatoDi: originale.id,
        });
      }
```

Importa `confrontoArticoli` da `./confrontoArticoli`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test server/commesse && pnpm check`
Expected: PASS, compresi i test di ieri sulla discordanza — quelli usano lo **stesso** articolo nelle due copie, quindi restano `discorde`.

- [ ] **Step 5: Commit**

```bash
git add server/commesse/letturaCostoTipi.ts server/commesse/costoDaConferma.ts server/commesse/costoDaConferma.test.ts
git commit -m "feat(costo): articoli disgiunti sullo stesso ordine si sommano

Due conferme dello stesso ordine che portano merce diversa sono due pezzi
di un ordine solo. La somma si applica invece di essere proposta perché
la direzione dell'errore è quella giusta: sommare due revisioni gonfia il
costo e costa attenzione, non sommare due parziali gonfia il margine e
costa soldi in silenzio.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Documenti e verifica finale

- [ ] **Step 1: PRD §54.7**

Sotto la voce «Conferme discordi», aggiungi:

```markdown
- **Conferme parziali (10/09/2026)**: prima di dichiarare una discordanza si
  confrontano gli **articoli** delle due conferme. Nessun articolo in comune ⇒
  sono due pezzi dello stesso ordine e il costo è la loro **somma** (esito
  `parziale`, il costo resta sul primo documento). Un articolo in comune ⇒
  stessa merce ⇒ resta `discorde`. Articoli assenti da una delle due ⇒ non si
  può dire, e resta `discorde`: un'assenza non è una prova di disgiunzione.
  Gli articoli si leggono ora per **ogni** conferma (`articoliLetti`), anche
  per quelle che non producono costo né merce — senza, il confronto era
  impossibile.
```

- [ ] **Step 2: handoff.md**

Blocco «Novità» che dica: il confronto sugli articoli, la somma applicata e non proposta con la ragione (direzione dell'errore), e che **i dati già scritti non si correggono da soli**.

- [ ] **Step 3: Verifica completa**

```bash
pnpm check
```
Expected: nessun errore.

```bash
pnpm test
```
Expected: tutti i file passati.

```bash
pnpm build
```
Expected: build riuscita.

- [ ] **Step 4: Commit**

```bash
git add documento_requisiti_infissi_ops.md handoff.md
git commit -m "docs(costo): PRD §54.7 e handoff sulle conferme parziali

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Fuori da questo piano, dichiarato

- **La merce a magazzino delle conferme parziali.** Il costo si somma, ma la consegna a magazzino resta solo quella del primo documento: la merce del secondo non entra. È il pezzo naturale successivo, e va guardato con le consegne vere sotto mano.
- **I dati già scritti.** Il codice cambia la regola, non i costi in archivio: si allineano alla prossima rilettura di quelle conferme.
