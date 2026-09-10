# Conferme discordi sullo stesso ordine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando due conferme dello stesso ordine dicono cifre diverse e niente prova quale sia più recente, il CRM smette di sceglierne una a caso e lo dichiara — tenendo intanto il costo che non gonfia il margine.

**Architecture:** La regola dei duplicati esiste già e nella sostanza è giusta: stesso importo ⇒ copia, importo diverso e documento più recente ⇒ revisione. Il difetto è in `piuRecente`, che guarda `createdAt` — **quando il worker ha archiviato il file** — e su un giro di archiviazione in blocco legge rumore e lo chiama prova. La prova vera è la **data del documento**: due conferme con date diverse sono una revisione, due conferme con la stessa data non lo sono, e allora si dichiara **discordanza** invece di inventare un vincitore.

**Tech Stack:** TypeScript, Vitest, store JSONB per tenant.

**Spec:** nessuna spec a sé: il disegno è stato concordato in chat il 10/09/2026 e sta qui, nell'intestazione e nel Task 1. Il contesto è la spec ordini `docs/superpowers/specs/2026-09-10-gestione-ordini-design.md` §2 (il costo che nasce dalla conferma) e PRD §54.7.

## Il difetto, misurato in produzione (10/09/2026)

Sette ordini su sei commesse hanno copie che dichiarano imponibili diversi, con uno scarto complessivo di **€ 1.983,62**. Tutte le copie sono `testo_pdf` — non è l'OCR e non è il modello — hanno **checksum e dimensioni diverse** (file genuinamente diversi) e la **stessa `dataDocumento`**.

| Lavoro | Ordine | Le copie dicono | Costo di oggi |
|---|---|---|---|
| COM-2026-092 Jacopucci | 1684077 | 727,17 · 704,17 · 704,17 · **556,75** | **556,75** (il più basso) |
| COM-2026-095 Salvetti | 1012779 | **5.793,83** · 4.710,50 | 5.793,83 |
| COM-2026-095 Salvetti | 1012780 | **1.709,44** · 1.391,87 | 1.709,44 |
| COM-2026-091 Boldini | 1694249 | **1.028,20** · 825,90 | 1.028,20 |
| COM-2026-089 Giacomazzi | 2629990 | **279,20** · 162,20 | 279,20 |
| COM-2026-020 Cecconi | 1649797 | **2.596,23** · 2.526,23 · 2.526,23 | 2.596,23 |
| COM-2026-020 Cecconi | 1649843 | 269,50 · 269,50 · 246,50 | (da un'altra conferma) |

I quattro documenti di Jacopucci sono entrati fra le 21:08 e le 21:24 dello stesso giro d'archivio, in ordine arbitrario: `piuRecente` ha eletto l'ultimo processato, che è il più basso. **Un costo più basso gonfia il margine**, ed è il verso sbagliato in cui essere ottimisti.

## Global Constraints

- **Una conferma può girare più volte restando la stessa** (vincolo della direzione, 10/09/2026). Stesso riferimento **e stesso imponibile** ⇒ è la stessa conferma: conta **una volta sola**. Questo comportamento c'è già e non si tocca — sui dati veri è ciò che tiene insieme i due 704,17 di Jacopucci.
- **Mai due costi per lo stesso ordine.** Niente somme automatiche in questo piano: conferme parziali dello stesso ordine restano un problema aperto, dichiarato in fondo.
- **Il costo non si abbassa mai da solo.** In assenza di prova vince l'importo **più alto** fra i discordi: sottostimare il costo gonfia il margine, e un margine falso in meglio è quello che fa perdere soldi senza accorgersene.
- **Solo i costi scritti dalla regola.** Un costo che una persona ha toccato non si sovrascrive mai (`costoScrittoDallaRegola`, già in uso).
- `sedeId` e tenant come sempre; nessuno script contro il server vivo.
- Comandi: `pnpm check`, `pnpm test`, `pnpm build`.

## Struttura dei file

| File | Responsabilità |
|---|---|
| `server/commesse/letturaCostoTipi.ts` | L'esito nuovo `discorde` nella union, e il campo che ricorda con quali importi. |
| `server/commesse/revisioneConferma.ts` **(nuovo)** | `revisionePerData(dataNuovo, dataOriginale)`: la prova, isolata e pura. |
| `server/commesse/costoDaConferma.ts` | Il ramo dei duplicati usa la prova invece dell'ordine d'archiviazione. |

---

### Task 1: La prova è la data del documento, non l'ordine d'archiviazione

**Files:**
- Create: `server/commesse/revisioneConferma.ts`
- Test: `server/commesse/revisioneConferma.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type EsitoRevisione = "nuovo" | "originale" | "nessuna_prova";
  export function revisionePerData(
    dataNuovo: string | null | undefined,
    dataOriginale: string | null | undefined
  ): EsitoRevisione;
  ```
  Il Task 2 la usa al posto di `piuRecente` nel ramo dei duplicati.

- [ ] **Step 1: Write the failing test**

Crea `server/commesse/revisioneConferma.test.ts`:

```ts
// Quale delle due conferme è la revisione dell'altra — e soprattutto: quando
// NON si può dire.
//
// Fino al 10/09/2026 lo decideva `piuRecente`, che guarda quando il worker ha
// archiviato il file. Su un giro di archiviazione in blocco quell'ordine è
// rumore: i quattro documenti di COM-2026-092 sono entrati in sedici minuti,
// e il CRM ha eletto l'ultimo processato — il più basso dei quattro.
import { describe, expect, it } from "vitest";
import { revisionePerData } from "./revisioneConferma";

describe("revisionePerData", () => {
  it("date diverse: vince la più recente, ed è una prova", () => {
    expect(revisionePerData("2026-07-02", "2026-06-30")).toBe("nuovo");
    expect(revisionePerData("2026-06-30", "2026-07-02")).toBe("originale");
  });

  it("stessa data: nessuna prova, e non si inventa un vincitore", () => {
    // È il caso vero: tutte le copie di ogni ordine hanno la stessa
    // dataDocumento, perché è la data dell'ORDINE, non della revisione.
    expect(revisionePerData("2026-06-16", "2026-06-16")).toBe("nessuna_prova");
  });

  it("una data che manca non è una prova", () => {
    expect(revisionePerData(null, "2026-06-16")).toBe("nessuna_prova");
    expect(revisionePerData("2026-06-16", null)).toBe("nessuna_prova");
    expect(revisionePerData(null, null)).toBe("nessuna_prova");
    expect(revisionePerData("", "2026-06-16")).toBe("nessuna_prova");
  });

  it("una data che non si legge non è una prova", () => {
    expect(revisionePerData("boh", "2026-06-16")).toBe("nessuna_prova");
    expect(revisionePerData("2026-06-16", "31/02/2026")).toBe("nessuna_prova");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test server/commesse/revisioneConferma.test.ts`
Expected: FAIL — il modulo `./revisioneConferma` non esiste.

- [ ] **Step 3: Write minimal implementation**

```ts
// Quale delle due conferme è la revisione dell'altra.
//
// La prova è la DATA DEL DOCUMENTO, non l'ordine con cui i file sono entrati
// in archivio. `createdAt` dice quando il worker ha archiviato: su un giro in
// blocco è rumore, e il 10/09/2026 quel rumore ha eletto come costo di
// COM-2026-092 il più basso di quattro importi discordi.
//
// Quando la data non distingue, la risposta è «nessuna prova» — non un
// vincitore scelto in un altro modo. È il punto di tutto: su un valore in
// euro, «non lo so» è un'informazione, e tenerla per sé è il difetto.

export type EsitoRevisione = "nuovo" | "originale" | "nessuna_prova";

/** `YYYY-MM-DD` valida, o null. */
function giorno(valore: string | null | undefined): number | null {
  const testo = String(valore ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(testo)) return null;
  const t = Date.parse(`${testo}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  // `Date.parse` accetta il 31 febbraio e lo sposta: una data che non torna
  // com'era scritta non è una data.
  return new Date(t).toISOString().slice(0, 10) === testo ? t : null;
}

export function revisionePerData(
  dataNuovo: string | null | undefined,
  dataOriginale: string | null | undefined
): EsitoRevisione {
  const a = giorno(dataNuovo);
  const b = giorno(dataOriginale);
  if (a == null || b == null || a === b) return "nessuna_prova";
  return a > b ? "nuovo" : "originale";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test server/commesse/revisioneConferma.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/commesse/revisioneConferma.ts server/commesse/revisioneConferma.test.ts
git commit -m "feat(costo): la prova di una revisione è la data del documento

createdAt dice quando il worker ha archiviato: su un giro in blocco è
rumore. Quando la data non distingue la risposta è «nessuna prova», non
un vincitore scelto in un altro modo.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Senza prova si dichiara la discordanza, e vince l'importo più alto

**Files:**
- Modify: `server/commesse/letturaCostoTipi.ts` (union `EsitoLetturaCosto`, campo `discordi`)
- Modify: `server/commesse/costoDaConferma.ts` (ramo dei duplicati, ~758–820)
- Test: `server/commesse/costoDaConferma.test.ts`

**Interfaces:**
- Consumes: `revisionePerData` (Task 1), `costoScrittoDallaRegola`, `ritira`, `aggiornaImportoCosto` (già nel file)
- Produces: `EsitoLetturaCosto` guadagna `"discorde"`; `LetturaCostoDocumento` guadagna
  ```ts
  /** Gli imponibili discordi visti su questo ordine, il maggiore per primo. */
  discordi?: number[];
  ```

- [ ] **Step 1: Write the failing test**

In `server/commesse/costoDaConferma.test.ts`, dentro il `describe` dei duplicati, aggiungi:

```ts
  it("stesso ordine, stessa data, importi diversi: è discordanza, e vince il più alto", async () => {
    // Il caso COM-2026-092: quattro copie entrate nello stesso giro, importi
    // diversi, nessuna prova di quale sia la revisione. Prima il CRM eleggeva
    // l'ultima processata — che era la più bassa, e un costo più basso gonfia
    // il margine.
    const commessa = await inOrdine("Jacopucci Discordi");
    const alto = [
      "ALIAS Srl Porte blindate",
      "Conferma d'ordine n. 1684077 del 16/06/2026",
      "Totale imponibile: EUR 727,17",
    ];
    const basso = [
      "ALIAS Srl Porte blindate",
      "Conferma d'ordine n. 1684077 del 16/06/2026",
      "Totale imponibile: EUR 556,75",
    ];
    const primo = await carica(commessa.id, alto, { nome: "Ordini_di_Vendi_1684077(1).pdf" });
    const secondo = await carica(commessa.id, basso, { nome: "Ordini_di_Vendi_1684077(1) (2).pdf" });

    // Un costo solo, e resta il più alto: senza prova non si abbassa.
    expect(costiDi(commessa.id)).toHaveLength(1);
    expect(costiDi(commessa.id)[0].importo).toBe(727.17);
    expect(costiDi(commessa.id)[0].documentoId).toBe(primo.id);

    // E lo dice, invece di tacerlo.
    const lettura = getDocumentoRecordById(secondo.id)?.letturaCosto;
    expect(lettura?.esito).toBe("discorde");
    expect(lettura?.motivo).toMatch(/discord/i);
    expect(lettura?.discordi).toEqual([727.17, 556.75]);
  });

  it("la copia più ALTA arrivata dopo alza il costo, sempre senza prova", async () => {
    const commessa = await inOrdine("Jacopucci Alza");
    const basso = [
      "ALIAS Srl Porte blindate",
      "Conferma d'ordine n. 1684078 del 16/06/2026",
      "Totale imponibile: EUR 556,75",
    ];
    const alto = [
      "ALIAS Srl Porte blindate",
      "Conferma d'ordine n. 1684078 del 16/06/2026",
      "Totale imponibile: EUR 727,17",
    ];
    await carica(commessa.id, basso, { nome: "Ordini_di_Vendi_1684078(1).pdf" });
    await carica(commessa.id, alto, { nome: "Ordini_di_Vendi_1684078(1) (2).pdf" });
    expect(costiDi(commessa.id)).toHaveLength(1);
    expect(costiDi(commessa.id)[0].importo).toBe(727.17);
  });

  it("date diverse: la revisione vince davvero, anche se abbassa", async () => {
    const commessa = await inOrdine("Revisione Vera");
    const vecchia = [
      "ALIAS Srl Porte blindate",
      "Conferma d'ordine n. 1684079 del 16/06/2026",
      "Totale imponibile: EUR 727,17",
    ];
    const nuova = [
      "ALIAS Srl Porte blindate",
      "Conferma d'ordine n. 1684079 del 02/07/2026",
      "Totale imponibile: EUR 556,75",
    ];
    await carica(commessa.id, vecchia, { nome: "Ordini_di_Vendi_1684079(1).pdf" });
    const seconda = await carica(commessa.id, nuova, { nome: "Ordini_di_Vendi_1684079(1) (2).pdf" });
    expect(costiDi(commessa.id)).toHaveLength(1);
    expect(costiDi(commessa.id)[0].importo).toBe(556.75);
    expect(costiDi(commessa.id)[0].documentoId).toBe(seconda.id);
  });
```

Il test già presente «la stessa conferma inviata tre volte è UN costo e UNA merce» **non si tocca**: è il vincolo della direzione, e deve continuare a passare.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test server/commesse/costoDaConferma.test.ts`
Expected: FAIL — il costo è 556,75 (vince l'ultimo archiviato) e l'esito è `duplicato`, non `discorde`.

- [ ] **Step 3: Write minimal implementation**

In `server/commesse/letturaCostoTipi.ts`, nella union, dopo `"duplicato"`:

```ts
  /**
   * Stesso ordine di un'altra conferma, importo diverso, e NESSUNA prova di
   * quale sia la revisione (stessa data del documento). Il costo resta il più
   * alto fra i discordi — sottostimarlo gonfierebbe il margine — e la
   * discordanza si dichiara invece di sceglierne una in silenzio.
   */
  | "discorde"
```

e in `LetturaCostoDocumento`, accanto a `duplicatoDi`:

```ts
  /** Gli imponibili discordi visti su questo ordine, il maggiore per primo. */
  discordi?: number[];
```

In `server/commesse/costoDaConferma.ts`, importa `revisionePerData` e sostituisci il calcolo di `revisione` e il ramo `if (!revisione)`:

```ts
    const prova = revisionePerData(dataDocumento, letturaOriginale?.dataDocumento ?? null);
    const importoDiverso =
      imponibile != null &&
      imponibile > 0 &&
      costoOriginale != null &&
      Math.abs(costoOriginale.importo - imponibile) >= 0.005;
    const correggibile =
      costoOriginale != null && costoScrittoDallaRegola(costoOriginale, letturaOriginale);
    // La revisione vera: le due conferme portano date diverse, e questa è la
    // più recente. Allora vince, anche se abbassa il costo.
    const revisione = importoDiverso && correggibile && prova === "nuovo";
    // Nessuna prova e importi diversi: è una DISCORDANZA. Non si elegge un
    // vincitore con l'ordine d'archiviazione (che su un giro in blocco è
    // rumore): resta il più alto, e lo si dichiara.
    // Solo sui costi scritti dalla regola: un costo fissato da una persona
    // significa che la discordanza l'ha già risolta lei.
    const discorde = importiDiversi && correggibile && prova === "nessuna_prova";

    if (importiDiversi && correggibile && prova === "nessuna_prova") {
      const alto = Math.max(imponibile!, costoOriginale!.importo);
      const basso = Math.min(imponibile!, costoOriginale!.importo);
      // Il costo non si abbassa mai da solo; se questa copia è la più alta e
      // il costo lo ha scritto la regola, sale.
      if (correggibile && alto > costoOriginale!.importo) {
        aggiornaImportoCosto(
          commessa,
          costoOriginale!,
          alto,
          `Alzato a ${euro(alto)} da «${raw.nome}»: conferme discordi sullo stesso ordine, e senza prova di quale sia la revisione resta il più alto.`,
          { fornitore, data: dataDocumento, numeroOrdine }
        );
      }
      ritira(commessa, documento);
      const motivo = `Conferme discordi sull'ordine ${duplicato.riferimento}: «${originale.nome}» dice ${euro(
        costoOriginale!.importo
      )}, questa dice ${euro(
        imponibile!
      )}, e le due portano la stessa data — niente dice quale sia la revisione. A registro resta ${euro(
        alto
      )}, il più alto: sottostimare il costo gonfierebbe il margine. Controlla i due file e correggi il costo a mano se serve.`;
      salva({
        ...memoriaBase,
        esito: "discorde",
        motivo,
        costoId: null,
        merce: null,
        duplicatoDi: originale.id,
        discordi: [alto, basso],
        riscontro: riscontro ? { ok: true, prove: riscontro.prove } : null,
      });
      return base(documento, "discorde", motivo, {
        fonteTesto,
        imponibile,
        duplicatoDi: originale.id,
      });
    }

    if (!revisione) {
```

Il resto del ramo `if (!revisione)` e del ramo revisione resta **identico**: il primo copre «stesso importo ⇒ copia», che è il vincolo della direzione.

**Attenzione ai nomi già in scope:** il ramo esistente dichiara una `const importoDiverso` come *stringa* per il messaggio. Rinominala in `notaImporto` per non collidere con il booleano introdotto qui.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test server/commesse/costoDaConferma.test.ts`
Expected: PASS, compresi i test già presenti — in particolare «la stessa conferma inviata tre volte è UN costo».

- [ ] **Step 5: Verifica che nient'altro cambi**

Run: `pnpm check && pnpm test server/commesse server/fornitori server/routers`
Expected: PASS. `aggiornaImportoCosto` è già importato (riga 90) e la sua firma è `(commessa, costo, importo, nota, extra?)` — vuole **l'oggetto** costo, non l'id.

- [ ] **Step 6: Commit**

```bash
git add server/commesse/letturaCostoTipi.ts server/commesse/costoDaConferma.ts server/commesse/costoDaConferma.test.ts
git commit -m "fix(costo): senza prova è discordanza, e vince l'importo più alto

Sette ordini su sei commesse in produzione hanno copie con imponibili
diversi (scarto complessivo EUR 1.983,62), stessa data documento e
checksum diversi. piuRecente eleggeva l'ultimo ARCHIVIATO: su un giro in
blocco è rumore, e su COM-2026-092 ha scelto il più basso di quattro.

Ora la prova è la data del documento. Senza prova si dichiara la
discordanza e resta il più alto: sottostimare il costo gonfia il margine,
ed è il verso sbagliato in cui sbagliare.

Il vincolo della direzione resta intatto: stesso riferimento e stesso
imponibile è la stessa conferma rigirata, e conta una volta sola.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Documenti e verifica finale

**Files:**
- Modify: `documento_requisiti_infissi_ops.md` (§54.7), `handoff.md`

- [ ] **Step 1: PRD §54.7**

Aggiungi, dopo la parte sui duplicati:

```markdown
**Conferme discordi (10/09/2026).** Due conferme dello stesso ordine con
importi diversi non sono automaticamente una revisione: la prova è la **data
del documento**, non l'ordine con cui i file sono entrati in archivio
(`createdAt` dice quando il worker ha archiviato, e su un giro in blocco è
rumore). Date diverse ⇒ vince la più recente, anche se abbassa. Stessa data,
o data mancante ⇒ **discordanza**: il costo resta il **più alto** fra i
discordi — sottostimarlo gonfierebbe il margine — la lettura porta esito
`discorde` con entrambi gli importi in `discordi[]`, e il motivo dice di
controllare i due file. Stesso riferimento **e stesso imponibile** resta
`duplicato`: una conferma può girare più volte restando la stessa.
```

- [ ] **Step 2: handoff.md**

Blocco «Novità» in cima con il difetto misurato (7 ordini, 6 commesse, € 1.983,62 di scarto), la regola nuova, e il fatto che **le sei commesse in produzione non si correggono da sole**: il costo si aggiorna alla prossima rilettura di quelle conferme, oppure a mano dalla scheda.

- [ ] **Step 3: Verifica completa**

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

- [ ] **Step 4: Commit**

```bash
git add documento_requisiti_infissi_ops.md handoff.md
git commit -m "docs(costo): PRD §54.7 e handoff sulle conferme discordi

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Fuori da questo piano, dichiarato

- **Le conferme parziali.** Se due conferme dello stesso ordine portano merce **diversa**, il costo vero è la **somma**, e questo piano non la fa: le tratta come discordi e tiene la più alta — che è comunque meglio di oggi, ma non è giusto. Per distinguerle servono gli **articoli** di entrambe, e oggi le copie scartate non li hanno nemmeno estratti: verificato sui dati veri, dei quattro documenti di COM-2026-092 solo quello che ha vinto ha righe di merce. Il passo successivo è estrarre gli articoli anche per le copie che non vincono, e da lì il confronto è deterministico: articoli disgiunti ⇒ parziali ⇒ somma, articoli sovrapposti ⇒ revisione.
- **La correzione dei sei lavori di oggi.** Il codice cambia la regola, non i dati già scritti. I costi si allineano alla prossima rilettura di quelle conferme (il tasto «Rileggi» dell'archivio) o a mano dalla scheda.
- **Mostrare la discordanza in pagina.** L'esito `discorde` e il motivo ci sono; una pastiglia dedicata nell'elenco delle conferme è un'aggiunta separata.
