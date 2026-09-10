# Bonifica dell'archivio conferme — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Far entrare in archivio le conferme d'ordine che oggi sono invisibili — 312 mail Primed con zero voci, 94 mail dal portale Antenore non riconosciute, 59 allegati Alias chiamati «allegato» — senza riempire la coda di fatture, DDT e solleciti.

**Architecture:** Il filtro degli allegati decide oggi dal **nome del file**, a due strati: un pre-filtro grezzo nella query delle comunicazioni (`listComunicazioniConAllegatiCandidati`) e un giudizio fine (`nomeDaConferma`). Si aggiunge una terza via a entrambi gli strati: **se il mittente è un fornitore noto, il nome smette di essere un filtro e decide il testo del documento**. I nomi esclusi (fattura, DDT, listino, e da oggi «sollecito») restano esclusi anche per un mittente noto. Una voce entrata per il solo mittente che, letta, non porta né numero d'ordine né imponibile né articoli si **scarta da sola con il motivo**: la coda non deve peggiorare.

**Tech Stack:** TypeScript, Vitest, tRPC 11, Postgres (`postgres` driver, query in SQL grezzo), store JSONB `fornitori_archivio`.

**Spec:** `docs/superpowers/specs/2026-09-10-gestione-ordini-design.md`, §8. Questo piano copre **solo** §8, che la spec dichiara indipendente dal resto. Il piano 2 (la partita d'ordine, §4–§7 e §9) si scrive dopo, perché la spec §15 chiede di rimisurare i fornitori-per-lavoro a bonifica fatta.

## Global Constraints

- **Fuori da questo piano, dichiarato:** il nome Alias mangiato (`LIAS Srl`, `IAS Srl`). La spec §8.3 dice che il testo arriva già così dall'estrazione e va diagnosticato su un PDF vero: **non si scrive una regola su una causa supposta.** Nessun task lo tocca.
- Nessuna scrittura su dati autorevoli: questo piano non tocca commesse, costi, magazzino, stati né gate.
- `sedeId` su ogni lettura e scrittura; una voce d'altra sede non è visibile (`voceArchivioById` lo fa già).
- Il worker dell'archivio è un punto d'ingresso fuori richiesta: resta su `perOgniTenantAttivo`, non lo si tocca.
- Nessun modello decide: tutte le regole di questo piano sono deterministiche e leggibili.
- Comandi: `pnpm check` (tsc), `pnpm test` (vitest run), `pnpm build`. Un file solo: `pnpm test <percorso>`.
- Stile del repository: commenti in italiano che dicono **perché**, non cosa; nomi di dominio in italiano; nessun `any` nuovo.

---

### Task 1: Antenore è un portale, non un estraneo

Il dominio `antenore.biz` manda 94 mail e finisce in «Da riconoscere»: è il portale con cui si ordina da Wnd e Oknoplast, non un fornitore a sé.

**Files:**
- Modify: `shared/fornitori.ts` (dopo `FORNITORI_NOTI`, e dentro `fornitoreNoto`)
- Test: `shared/fornitori.test.ts`

**Interfaces:**
- Consumes: `FORNITORI_NOTI`, `contieneChiave` (privata, già nel file)
- Produces: `export const PORTALI: readonly Portale[]`, con `type Portale = { chiavi: readonly string[]; fornitore: string }`. `fornitoreNoto(testo, email)` mantiene la firma e il tipo di ritorno `string | null`.

- [ ] **Step 1: Write the failing test**

In `shared/fornitori.test.ts`, dentro `describe("normalizzaFornitore", ...)`, aggiungi:

```ts
  it("riconduce il portale al fornitore che rappresenta", () => {
    // Antenore è il portale di Wnd/Oknoplast (direzione, 10/09/2026): 94 mail
    // finivano in «Da riconoscere» perché il dominio non è del produttore.
    expect(fornitoreNoto(null, "noreply@antenore.biz")).toBe("Wnd");
    expect(fornitoreNoto("Antenore", null)).toBe("Wnd");
    expect(normalizzaFornitore("Portale Antenore", "info@antenore.biz")).toBe("Wnd");
    // Un fornitore vero vince sul portale: il suo dominio è più preciso.
    expect(fornitoreNoto(null, "ordini@pailporte.com")).toBe("Pail");
    // Un dominio qualunque non diventa un fornitore.
    expect(fornitoreNoto(null, "mario@gmail.com")).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test shared/fornitori.test.ts`
Expected: FAIL — `fornitoreNoto(null, "noreply@antenore.biz")` restituisce `null`, atteso `"Wnd"`.

- [ ] **Step 3: Write minimal implementation**

In `shared/fornitori.ts`, subito dopo la costante `FORNITORI`:

```ts
export type Portale = {
  /** Parole o domini che identificano il portale, in minuscolo. */
  chiavi: readonly string[];
  /** Il fornitore da cui si ordina attraverso questo portale. */
  fornitore: string;
};

/**
 * I portali con cui si ordina (direzione, 10/09/2026). Non sono fornitori:
 * sono il canale con cui si ordina DA un fornitore, e il loro dominio non è
 * quello del produttore. `antenore.biz` mandava 94 mail che finivano tutte
 * in «Da riconoscere».
 *
 * Un portale che serve più produttori riconduce a UNO solo — qui Wnd, l'unico
 * con consegne registrate. Se un giorno servisse distinguere Oknoplast, a
 * dirlo sarà il testo del documento, mai il dominio del portale.
 */
export const PORTALI: readonly Portale[] = [
  { chiavi: ["antenore"], fornitore: "Wnd" },
];
```

Poi, in `fornitoreNoto`, **dopo** il ciclo su `FORNITORI_NOTI` e **prima** di `return null`:

```ts
  // Il portale vale meno del produttore: si guarda solo se nessun fornitore
  // noto ha risposto.
  for (const p of PORTALI) {
    for (const chiave of p.chiavi) {
      if (testo && contieneChiave(testo, chiave)) return p.fornitore;
      if (dominio && contieneChiave(dominio, chiave)) return p.fornitore;
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test shared/fornitori.test.ts`
Expected: PASS, tutti i test del file compresi quelli già presenti.

- [ ] **Step 5: Commit**

```bash
git add shared/fornitori.ts shared/fornitori.test.ts
git commit -m "feat(fornitori): Antenore è il portale di Wnd, non un mittente estraneo

94 mail da antenore.biz finivano in «Da riconoscere»: il dominio del
portale non è quello del produttore. PORTALI riconduce il portale al
fornitore, e si consulta solo se nessun fornitore noto ha risposto.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Un sollecito non è una conferma

`Sollecito_Ordin_1685983(1).pdf` contiene «ordin» e passa il filtro: sette in coda.

**Files:**
- Modify: `server/tars/documenti/confermeMancanti.ts` (costante `NOME_ESCLUSO`)
- Test: `server/tars/documenti/confermeMancanti.test.ts`

**Interfaces:**
- Consumes: `nomeDaConferma(nome: string, mimeType: string | null | undefined): "conferma" | "ordine" | null` (già esportata)
- Produces: nessuna interfaccia nuova; cambia solo il comportamento di `nomeDaConferma`.

- [ ] **Step 1: Write the failing test**

In fondo a `server/tars/documenti/confermeMancanti.test.ts`, aggiungi il blocco:

```ts
describe("nomeDaConferma", () => {
  it("riconosce i nomi che dichiarano una conferma o un ordine", () => {
    expect(nomeDaConferma("Ordini_di_Vendi_1684077(1).pdf", "application/pdf")).toBe("ordine");
    expect(nomeDaConferma("Conferma ordine 4471.pdf", "application/pdf")).toBe("conferma");
    expect(nomeDaConferma("CO_4471.pdf", "application/pdf")).toBe("conferma");
    // «conf.26_29488 aggiornata.pdf» è il nome vero delle conferme Pail, e
    // dal NOME non è riconosciuto: «conf.» seguito da cifre non è nessuno
    // dei disegni previsti. Il pattern non si allarga per questo — a farla
    // entrare è il mittente noto (`allegatoDaConferma`), che è la porta
    // giusta e non promuove i nomi esclusi.
    expect(nomeDaConferma("conf.26_29488 aggiornata.pdf", "application/pdf")).toBeNull();
  });

  it("un sollecito non è una conferma d'ordine", () => {
    // Alias manda «Sollecito_Ordin_…»: contiene «ordin» e finiva in coda.
    expect(nomeDaConferma("Sollecito_Ordin_1685983(1).pdf", "application/pdf")).toBeNull();
    expect(nomeDaConferma("SOLLECITO PAGAMENTO ordine 4471.pdf", "application/pdf")).toBeNull();
  });
});
```

Aggiungi `nomeDaConferma` all'import esistente in cima al file:

```ts
import {
  confermeOrdineMancanti,
  nomeDaConferma,
  type DipendenzeConfermeMancanti,
} from "./confermeMancanti";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test server/tars/documenti/confermeMancanti.test.ts`
Expected: FAIL — `nomeDaConferma("Sollecito_Ordin_1685983(1).pdf", …)` restituisce `"ordine"`, atteso `null`.

- [ ] **Step 3: Write minimal implementation**

In `server/tars/documenti/confermeMancanti.ts`, dentro l'array che compone `NOME_ESCLUSO`, aggiungi una riga in fondo prima della chiusura:

```ts
    // Un sollecito parla di un ordine, non lo conferma (10/09/2026: sette
    // «Sollecito_Ordin_…» di Alias erano in coda come conferme).
    "sollecit",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test server/tars/documenti/confermeMancanti.test.ts`
Expected: PASS, compresi i test già presenti nel file.

- [ ] **Step 5: Commit**

```bash
git add server/tars/documenti/confermeMancanti.ts server/tars/documenti/confermeMancanti.test.ts
git commit -m "fix(conferme): un sollecito non è una conferma d'ordine

«Sollecito_Ordin_1685983.pdf» contiene «ordin» e passava il filtro: sette
in coda in archivio.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Il mittente noto apre la porta al nome che non dice niente

Primed manda 312 mail e allega `R237_2026WU367846_20052026165105.pdf`: zero voci in archivio in un anno, e con esse zero costi e zero merce attesa.

**Files:**
- Modify: `server/tars/documenti/confermeMancanti.ts` (import di `@shared/fornitori`, nuova funzione esportata dopo `nomeDaConferma`)
- Test: `server/tars/documenti/confermeMancanti.test.ts`

**Interfaces:**
- Consumes: `nomeDaConferma`, `NOME_ESCLUSO`, `MIME_AMMESSI` (private nel file), `fornitoreNoto` da `@shared/fornitori`
- Produces:
  ```ts
  export type EsitoAllegatoConferma = "conferma" | "ordine" | "mittente" | null;
  export function allegatoDaConferma(input: {
    nome: string;
    mimeType: string | null | undefined;
    mittente?: string | null;
    mittenteNome?: string | null;
  }): EsitoAllegatoConferma;
  ```
  I task 5 e 6 usano **questa** funzione, non `nomeDaConferma`, che resta esportata e invariata come giudizio sul solo nome.

- [ ] **Step 1: Write the failing test**

Aggiungi in fondo a `server/tars/documenti/confermeMancanti.test.ts`:

```ts
describe("allegatoDaConferma", () => {
  it("un mittente noto apre la porta a un nome che non dice niente", () => {
    const primed = "R237_2026WU367846_20052026165105.pdf";
    // Senza mittente il nome non basta, ed è il caso di oggi: 312 mail, zero voci.
    expect(allegatoDaConferma({ nome: primed, mimeType: "application/pdf" })).toBeNull();
    expect(
      allegatoDaConferma({ nome: primed, mimeType: "application/pdf", mittente: "amministrazione@primed.it" })
    ).toBe("mittente");
    // I 59 allegati Alias che si chiamano letteralmente «allegato».
    expect(
      allegatoDaConferma({ nome: "allegato", mimeType: "application/pdf", mittente: "v.gregori@aliasblindate.com" })
    ).toBe("mittente");
    // E il portale, via Task 1.
    expect(
      allegatoDaConferma({ nome: "Esportazione.pdf", mimeType: "application/pdf", mittente: "noreply@antenore.biz" })
    ).toBe("mittente");
  });

  it("il nome che dichiara la conferma vince: si sa già che cos'è", () => {
    expect(
      allegatoDaConferma({
        nome: "Ordini_di_Vendi_1684077(1).pdf",
        mimeType: "application/pdf",
        mittente: "v.gregori@aliasblindate.com",
      })
    ).toBe("ordine");
  });

  it("un nome escluso resta escluso anche da un fornitore noto", () => {
    // Primed manda anche i DDT, Alias i solleciti: il mittente non li promuove.
    expect(
      allegatoDaConferma({ nome: "R237_DDT_11_5_2026_9782.pdf", mimeType: "application/pdf", mittente: "amministrazione@primed.it" })
    ).toBeNull();
    expect(
      allegatoDaConferma({ nome: "Sollecito_Ordin_1685983(1).pdf", mimeType: "application/pdf", mittente: "v.gregori@aliasblindate.com" })
    ).toBeNull();
    expect(
      allegatoDaConferma({ nome: "ACCORDO COMMERCIALE 2026 listino.pdf", mimeType: "application/pdf", mittente: "vendite@oskura.it" })
    ).toBeNull();
  });

  it("un'immagine di firma non diventa una conferma", () => {
    // image001.png sono 118 allegati solo da Oskura.
    expect(
      allegatoDaConferma({ nome: "image001.png", mimeType: "image/png", mittente: "vendite@oskura.it" })
    ).toBeNull();
  });

  it("un mittente sconosciuto non apre niente", () => {
    expect(
      allegatoDaConferma({ nome: "IMG_9888.jpeg", mimeType: "image/jpeg", mittente: "mario@gmail.com" })
    ).toBeNull();
    expect(
      allegatoDaConferma({ nome: "documento.pdf", mimeType: "application/pdf", mittente: "mario@gmail.com" })
    ).toBeNull();
  });
});
```

Estendi l'import in cima al file con `allegatoDaConferma`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test server/tars/documenti/confermeMancanti.test.ts`
Expected: FAIL con `allegatoDaConferma is not a function` (o, per tsc, «has no exported member»).

- [ ] **Step 3: Write minimal implementation**

In `server/tars/documenti/confermeMancanti.ts`, aggiungi l'import in cima, accanto agli altri:

```ts
import { fornitoreNoto } from "@shared/fornitori";
```

E, subito dopo la funzione `nomeDaConferma`, aggiungi:

```ts
export type EsitoAllegatoConferma = "conferma" | "ordine" | "mittente" | null;

/**
 * Il file è un candidato conferma d'ordine. Tre modi di esserlo, in ordine:
 * il nome lo dichiara («conferma», «CO_4471»), il nome dice almeno
 * «ordine», oppure — dal 10/09/2026 — **il mittente è un fornitore noto** e
 * allora il nome smette di essere un filtro e a decidere è il testo del
 * documento, che l'archivio legge comunque nel giro dopo.
 *
 * Il perché: Primed manda 312 mail e allega
 * `R237_2026WU367846_20052026165105.pdf`; zero voci in archivio in un anno,
 * e con esse zero costi fornitore e zero merce attesa. Lo stesso vale per i
 * 59 allegati Alias chiamati letteralmente «allegato».
 *
 * I nomi ESCLUSI restano esclusi anche per un mittente noto: una fattura, un
 * DDT, un listino o un sollecito di Primed non diventano una conferma perché
 * arrivano da Primed. E il formato conta sempre: l'`image001.png` della firma
 * in calce non è un documento.
 */
export function allegatoDaConferma(input: {
  nome: string;
  mimeType: string | null | undefined;
  mittente?: string | null;
  mittenteNome?: string | null;
}): EsitoAllegatoConferma {
  const daNome = nomeDaConferma(input.nome, input.mimeType);
  if (daNome) return daNome;
  // `nomeDaConferma` ha già detto no: qui si guarda se il no veniva da un
  // divieto (nome escluso, formato) oppure solo da un nome che tace.
  if (NOME_ESCLUSO.test(input.nome)) return null;
  if (input.mimeType && !MIME_AMMESSI.test(input.mimeType)) return null;
  const noto =
    fornitoreNoto(input.mittenteNome ?? null, input.mittente ?? null) ??
    fornitoreNoto(input.mittente ?? null);
  return noto ? "mittente" : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test server/tars/documenti/confermeMancanti.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify tsc is clean**

Run: `pnpm check`
Expected: nessun errore. (Se `@shared/fornitori` non risolvesse, controlla `tsconfig.json`: l'alias esiste già ed è usato da `server/commesse/costoDaConferma.ts`.)

- [ ] **Step 6: Commit**

```bash
git add server/tars/documenti/confermeMancanti.ts server/tars/documenti/confermeMancanti.test.ts
git commit -m "feat(conferme): un mittente noto apre la porta al nome che tace

Primed manda 312 mail e allega R237_2026WU367846_20052026165105.pdf: zero
voci in archivio in un anno, quindi zero costi e zero merce attesa. Con
allegatoDaConferma il nome smette di essere un filtro quando il mittente è
un fornitore noto; a decidere resta il testo, che l'archivio legge già.

I nomi esclusi (fattura, DDT, listino, sollecito) e i formati non ammessi
restano tali anche per un mittente noto. nomeDaConferma resta invariata
come giudizio sul solo nome.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Il pre-filtro delle comunicazioni non taglia più i fornitori noti

`allegatoDaConferma` non serve a niente se la query che pesca le comunicazioni ha già buttato via la mail. Il pre-filtro grezzo (`nomeGrezzo`) scarta `R237_…pdf` prima ancora che qualcuno lo guardi, in memoria come in SQL.

**Files:**
- Modify: `shared/fornitori.ts` (nuova costante esportata)
- Modify: `server/comunicazioni/comunicazioni.ts:1672-1725` (`listComunicazioniConAllegatiCandidati`, ramo memoria e ramo SQL)
- Test: `server/comunicazioni/allegatiCandidati.test.ts`
- Test: `shared/fornitori.test.ts`

**Interfaces:**
- Consumes: `FORNITORI_NOTI`, `PORTALI` (Task 1)
- Produces: `export const SORGENTE_MITTENTE_FORNITORE: string` — la sorgente POSIX/JS del pattern che riconosce il mittente di un fornitore noto, **una sola** per i due rami. `listComunicazioniConAllegatiCandidati` mantiene firma e tipo di ritorno.

- [ ] **Step 1: Write the failing test**

In `shared/fornitori.test.ts` aggiungi un `describe` nuovo in fondo:

```ts
describe("SORGENTE_MITTENTE_FORNITORE", () => {
  const re = () => new RegExp(SORGENTE_MITTENTE_FORNITORE, "i");

  it("riconosce gli indirizzi dei fornitori veri", () => {
    for (const indirizzo of [
      "amministrazione@primed.it",
      "v.gregori@aliasblindate.com",
      "ordini@pailporte.com",
      "vendite@oskura.it",
      "noreply@antenore.biz",
      "paola.cattai@henryglass.it",
    ]) {
      expect(re().test(indirizzo)).toBe(true);
    }
  });

  it("non riconosce gli indirizzi qualunque", () => {
    for (const indirizzo of ["mario@gmail.com", "info@comune.laspezia.it", "noreply@stripe.com"]) {
      expect(re().test(indirizzo)).toBe(false);
    }
  });
});
```

Estendi l'import del file di test con `SORGENTE_MITTENTE_FORNITORE`.

In `server/comunicazioni/allegatiCandidati.test.ts`, dentro il `describe("listComunicazioniConAllegatiCandidati", …)` esistente, aggiungi un `it` nuovo. Usa l'helper `mail(extra)` già nel file (sede `98_301`, `receivedAt: giorniFa(400)` di default):

```ts
  it("una mail di un fornitore noto entra anche col nome del file muto; una qualunque no", async () => {
    // Il caso Primed: 312 mail in un anno, nome del file che non dice
    // niente, zero voci in archivio.
    const primed = await mail({
      mittente: "amministrazione@primed.it",
      mittenteNome: "PRIMED S.R.L.",
      allegati: [
        { nome: "R237_2026WU367846_20052026165105.pdf", mimeType: "application/pdf", size: 120_000 },
      ],
    });
    // Lo stesso nome muto da un mittente qualunque resta fuori.
    const estranea = await mail({
      mittente: "mario@gmail.com",
      mittenteNome: "Mario",
      allegati: [
        { nome: "R237_2026WU367846_20052026165105.pdf", mimeType: "application/pdf", size: 120_000 },
      ],
    });
    // E un formato che non è un documento resta fuori anche da un fornitore.
    const firmaOskura = await mail({
      mittente: "vendite@oskura.it",
      mittenteNome: "Oskura",
      allegati: [{ nome: "image001.png", mimeType: "image/png", size: 4_000 }],
    });

    const ids = (
      await listComunicazioniConAllegatiCandidati({ sedeId: SEDE, giorniIndietro: 540 })
    ).map(c => c.id);
    expect(ids).toContain(primed.id);
    expect(ids).not.toContain(estranea.id);
    expect(ids).not.toContain(firmaOskura.id);
  });
```

Il caso `firmaOskura` è il motivo per cui la porta del mittente si apre **solo ai documenti**: il `mimeAmmesso` del pre-filtro ammette anche `^image/` (serve ad altri consumatori), e senza questo vincolo le 118 `image001.png` di Oskura entrerebbero a ogni giro. Lo Step 3 lo implementa.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test shared/fornitori.test.ts server/comunicazioni/allegatiCandidati.test.ts`
Expected: FAIL — `SORGENTE_MITTENTE_FORNITORE` non esiste; la mail 9001 non compare fra le trovate.

- [ ] **Step 3: Write minimal implementation**

In `shared/fornitori.ts`, in fondo al file:

```ts
/**
 * Il pattern che riconosce il mittente di un fornitore noto, **una sola
 * sorgente** per il pre-filtro in memoria e per quello in SQL: due copie
 * divergerebbero, e la mail entrerebbe da una porta e non dall'altra.
 *
 * Le chiavi valgono come sottostringa, non come parola: `pailporte.com`
 * contiene «pailporte», `aliasblindate.com` contiene «aliasblindate». È
 * volutamente LARGO — il pre-filtro pesca, il giudizio fine
 * (`allegatoDaConferma`) scarta — ma non tanto da pescare tutto: le chiavi
 * di una lettera o due non esistono nella lista.
 *
 * Sintassi comune a JS e POSIX (niente `\b`, niente lookahead): la stessa
 * stringa finisce in un `RegExp` e in un `~*` di Postgres.
 */
export const SORGENTE_MITTENTE_FORNITORE: string = [
  ...FORNITORI_NOTI.flatMap(f => f.chiavi),
  ...PORTALI.flatMap(p => p.chiavi),
]
  // Uno spazio nella chiave («henry glass») nel dominio non c'è: diventa
  // «qualunque cosa o niente fra le due parole».
  .map(chiave => chiave.replace(/[^a-z0-9]+/g, "[^a-z0-9]*"))
  .sort((a, b) => b.length - a.length)
  .join("|");
```

In `server/comunicazioni/comunicazioni.ts`, dentro `listComunicazioniConAllegatiCandidati`:

Aggiungi l'import in cima al file, accanto agli altri `@shared`:

```ts
import { SORGENTE_MITTENTE_FORNITORE } from "@shared/fornitori";
```

Subito sotto `const nomeGrezzo = …`, aggiungi:

```ts
  // Un fornitore noto scrive: il nome del file non conta più (10/09/2026).
  // Primed allega `R237_…pdf` e non entrava mai. Il pre-filtro pesca, il
  // giudizio fine (`allegatoDaConferma`) scarta.
  const mittenteFornitore = new RegExp(SORGENTE_MITTENTE_FORNITORE, "i");
  // La porta del mittente si apre SOLO ai documenti: `mimeAmmesso` ammette
  // anche le immagini (servono ad altri consumatori) e senza questo vincolo
  // le 118 `image001.png` della firma in calce di Oskura entrerebbero a ogni
  // giro. Stessa lista di `MIME_AMMESSI` in `confermeMancanti.ts`.
  const mimeDocumento = /^application\/(pdf|vnd\.openxmlformats|msword|octet-stream)|^text\/plain/i;
```

Sostituisci la definizione di `allegatoCandidato` e il ramo memoria con:

```ts
  const formatoEDimensione = (a: Allegato) =>
    (!a.mimeType || mimeAmmesso.test(a.mimeType)) && (a.size ?? 0) <= MAX_BYTE;
  const allegatoCandidato = (a: Allegato, daFornitore: boolean) =>
    (nomeGrezzo.test(a.nome) || (daFornitore && !!a.mimeType && mimeDocumento.test(a.mimeType))) &&
    formatoEDimensione(a);

  if (!kvSql) {
    return memRows
      .filter(
        r =>
          r.sedeId === input.sedeId &&
          !r.deletedAt &&
          r.direzione === "in" &&
          r.categoria !== "spam" &&
          r.categoria !== "offerta_marketing" &&
          r.receivedAt.getTime() >= da.getTime() &&
          r.allegati.some(a => allegatoCandidato(a, mittenteFornitore.test(r.mittente)))
      )
      .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())
      .slice(0, limite);
  }
```

Nel ramo SQL, sostituisci la clausola `AND EXISTS (…)` con:

```ts
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(c.allegati, '[]'::jsonb)) a
        WHERE COALESCE((a->>'size')::bigint, 0) <= ${MAX_BYTE}
          AND (
            (a->>'nome') ~* '(conf|ord|acknowledg|bestat|(^|[^a-z])c\\.?o\\.?[^a-z0-9]?[0-9]|(^|[^a-z])o\\.?c\\.?[^a-z0-9]?[0-9])'
            OR (
              c.mittente ~* ${SORGENTE_MITTENTE_FORNITORE}
              AND (a->>'mimeType') ~* '^application/(pdf|vnd\\.openxmlformats|msword|octet-stream)|^text/plain'
            )
          )
      )
```

e la riga finale di ritorno con:

```ts
  // Il filtro fine su mime e dimensione per singolo allegato resta in Node:
  // la riga passa se almeno un allegato è candidato.
  return rows
    .map(fromRow)
    .filter(c => c.allegati.some(a => allegatoCandidato(a, mittenteFornitore.test(c.mittente))));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test shared/fornitori.test.ts server/comunicazioni/allegatiCandidati.test.ts`
Expected: PASS, compresi i test già presenti nei due file.

- [ ] **Step 5: Verify the other consumer still passes**

`server/tars/strumenti/ricerca.ts:288` usa la stessa query per la ricerca di Tars: adesso pesca più largo, ed è quello che si vuole.

Run: `pnpm test server/tars`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add shared/fornitori.ts shared/fornitori.test.ts server/comunicazioni/comunicazioni.ts server/comunicazioni/allegatiCandidati.test.ts
git commit -m "feat(comunicazioni): il pre-filtro non taglia più i fornitori noti

allegatoDaConferma non serviva a niente finché la query che pesca le
comunicazioni buttava via la mail prima: nomeGrezzo scartava
R237_...pdf in memoria come in SQL.

SORGENTE_MITTENTE_FORNITORE è una sorgente sola per i due rami — due
copie divergerebbero e la mail entrerebbe da una porta e non dall'altra.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: L'archivio usa il giudizio nuovo

Due punti chiamano ancora `nomeDaConferma` e continuerebbero a non vedere Primed: il riconoscimento del fornitore di una comunicazione e la scansione del giro d'archivio.

**Lo smistamento non si tocca**, ed è una verifica fatta, non una dimenticanza: `allegatoDaLeggere` (`server/tars/smistamento/worker.ts:93`) accetta già ogni PDF via `MIME_CON_TESTO`, e usa `nomeDaConferma` solo come ripiego per i mime generici. Il PDF di Primed lì passa già; portarci dentro il mittente sarebbe lavoro senza guadagno su un percorso che funziona.

**Files:**
- Modify: `server/fornitori/archivio.ts:197` (`fornitoreDiComunicazione`) e `server/fornitori/archivio.ts:369` (scansione dentro `eseguiGiroArchivioFornitori`)
- Test: `server/fornitori/archivio.test.ts`

**Interfaces:**
- Consumes: `allegatoDaConferma` (Task 3)
- Produces: nessuna interfaccia nuova. `fornitoreDiComunicazione(c, interni)` mantiene firma e tipo di ritorno `string | null`.

- [ ] **Step 1: Write the failing test**

In `server/fornitori/archivio.test.ts`, dentro `describe("eseguiGiroArchivioFornitori", …)`, aggiungi. Gli helper sono quelli del file: `SEDE` (97_701), `pdfConTesto`, `mailFornitore(extra, pdf)` (l'`extra` sovrascrive i default, mittente e allegati compresi) e `deps(pdfPerComunicazione, comunicazioni)`.

```ts
  it("una conferma Primed entra col nome muto; il suo DDT resta fuori", async () => {
    // 312 mail in un anno e zero voci: il nome del file non dice niente.
    const pdf = pdfConTesto([
      "Conferma d'ordine",
      "PRIMED S.R.L.",
      "Ns. rif. WU367846 del 20/05/2026",
      "1 ANTA-9010 LUCIDO   NR   1,00",
      "Totale imponibile: EUR 1.240,00",
    ]);
    const daPrimed = (nome: string) => ({
      mittente: "amministrazione@primed.it",
      mittenteNome: "PRIMED S.R.L.",
      oggetto: "Documenti",
      allegati: [{ nome, mimeType: "application/pdf", size: pdf.length }],
    });
    const conferma = await mailFornitore(daPrimed("R237_2026WU367846_20052026165105.pdf"), pdf);
    const ddt = await mailFornitore(daPrimed("R237_DDT_11_5_2026_9782.pdf"), pdf);

    const esito = await eseguiGiroArchivioFornitori({
      sedeId: SEDE,
      deps: deps(
        new Map([
          [conferma.id, pdf],
          [ddt.id, pdf],
        ]),
        [conferma, ddt]
      ),
    });

    expect(esito.nuove).toBe(1);
    const voci = getArchivioFornitoriStore();
    expect(voci.find(v => v.comunicazioneId === conferma.id)?.fornitore).toBe("Primed");
    expect(voci.find(v => v.comunicazioneId === ddt.id)).toBeUndefined();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test server/fornitori/archivio.test.ts`
Expected: FAIL — `esito.nuove` è `0`, atteso `1`: la mail Primed non produce nessuna voce.

- [ ] **Step 3: Write minimal implementation**

In `server/fornitori/archivio.ts`, cambia l'import:

```ts
import { allegatoDaConferma } from "../tars/documenti/confermeMancanti";
```

(sostituisce `nomeDaConferma`, che qui non serve più).

In `fornitoreDiComunicazione`, sostituisci la riga di `portaConferma`:

```ts
  const portaConferma = c.allegati.some(a =>
    allegatoDaConferma({
      nome: a.nome,
      mimeType: a.mimeType,
      mittente: c.mittente,
      mittenteNome: c.mittenteNome ?? null,
    }) != null
  );
```

Nella scansione di `eseguiGiroArchivioFornitori`, sostituisci il `continue`:

```ts
      if (
        !allegatoDaConferma({
          nome: allegato.nome,
          mimeType: allegato.mimeType,
          mittente: c.mittente,
          mittenteNome: c.mittenteNome ?? null,
        })
      ) {
        continue;
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test server/fornitori`
Expected: PASS, compresi i test già presenti nel file.

- [ ] **Step 5: Commit**

```bash
git add server/fornitori/archivio.ts server/fornitori/archivio.test.ts
git commit -m "feat(archivio): la scansione usa il giudizio col mittente

I due punti che chiamavano nomeDaConferma continuavano a non vedere
Primed: il riconoscimento del fornitore di una comunicazione e la
scansione del giro.

Lo smistamento resta com'è: allegatoDaLeggere accetta gia' ogni PDF via
MIME_CON_TESTO e usa nomeDaConferma solo come ripiego sui mime generici.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Ciò che entra dal solo mittente e non è una conferma si scarta da solo

Senza questo, Primed rovescia in coda trecento allegati: la coda passa da 230 a più di 500 e la bonifica peggiora il problema che voleva risolvere.

Il segnale è già nel dato letto: una conferma d'ordine porta **un numero d'ordine, o un imponibile, o degli articoli**. Se la lettura non trova nessuna delle tre e il file era entrato **solo** perché lo mandava un fornitore noto (cioè il suo nome non dice né «conferma» né «ordine»), la voce si scarta da sola con il motivo scritto. Nessun campo nuovo: la condizione si ricalcola dal `nomeFile` e dal `mimeType` già memorizzati.

**Files:**
- Modify: `server/fornitori/archivio.ts` (dopo la lettura, nella fase 3 di `eseguiGiroArchivioFornitori`)
- Test: `server/fornitori/archivio.test.ts`

**Interfaces:**
- Consumes: `LetturaArchivio` (`numeroOrdine`, `imponibile`, `articoli`), `nomeDaConferma` (giudizio sul solo nome), `VoceArchivioFornitore.stato`
- Produces: `export function entrataDalSoloMittente(voce: Pick<VoceArchivioFornitore, "nomeFile" | "mimeType">): boolean` — usata anche dai test.

- [ ] **Step 1: Write the failing test**

In `server/fornitori/archivio.test.ts`, sempre dentro `describe("eseguiGiroArchivioFornitori", …)`. La lettura nel test è **vera** (`creaLettoreCommessaNelDocumento` dentro `deps`), quindi l'esito si governa dal testo del PDF, non stubbando `cerca`:

```ts
  it("chi entra dal solo mittente e non porta una conferma si scarta da solo", async () => {
    // Una circolare di Primed: nessun numero d'ordine, nessun imponibile,
    // nessuna riga di merce. Senza questa regola finirebbe in coda, e con
    // essa altre trecento.
    const circolare = pdfConTesto([
      "PRIMED S.R.L.",
      "Gentile cliente,",
      "i nostri uffici resteranno chiusi dal 10 al 20 agosto.",
      "Cordiali saluti",
    ]);
    const posta = await mailFornitore(
      {
        mittente: "amministrazione@primed.it",
        mittenteNome: "PRIMED S.R.L.",
        oggetto: "Comunicazione",
        allegati: [
          { nome: "R237_2026RU6102_13062026102047.pdf", mimeType: "application/pdf", size: circolare.length },
        ],
      },
      circolare
    );

    await eseguiGiroArchivioFornitori({
      sedeId: SEDE,
      deps: deps(new Map([[posta.id, circolare]]), [posta]),
    });

    const voce = getArchivioFornitoriStore().find(v => v.comunicazioneId === posta.id);
    expect(voce?.stato).toBe("scartata");
    expect(voce?.motivoDecisione).toMatch(/non porta una conferma/i);
  });

  it("un file che si dichiara conferma resta in coda anche se la lettura non trova niente", async () => {
    // Il nome lo dichiara: quella decisione è di una persona, non del filtro.
    const circolare = pdfConTesto([
      "ALIAS Srl Porte blindate",
      "Gentile cliente, buone ferie.",
      "Cordiali saluti",
    ]);
    const posta = await mailFornitore(
      {
        allegati: [
          { nome: "Ordini_di_Vendi_9999.pdf", mimeType: "application/pdf", size: circolare.length },
        ],
      },
      circolare
    );

    await eseguiGiroArchivioFornitori({
      sedeId: SEDE,
      deps: deps(new Map([[posta.id, circolare]]), [posta]),
    });

    const voce = getArchivioFornitoriStore().find(v => v.comunicazioneId === posta.id);
    expect(voce?.stato).toBe("da_collegare");
  });
```

E il caso opposto è già coperto dal test del Task 5: la conferma Primed, che porta numero d'ordine, articolo e imponibile, resta `da_collegare`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test server/fornitori/archivio.test.ts`
Expected: FAIL — la voce 7303 ha stato `"da_collegare"`, atteso `"scartata"`.

- [ ] **Step 3: Write minimal implementation**

In `server/fornitori/archivio.ts`, accanto alle altre funzioni esportate:

```ts
/**
 * La voce è entrata SOLO perché la mandava un fornitore noto: il suo nome
 * non dichiara né una conferma né un ordine. Si ricalcola dal nome e dal
 * formato già memorizzati — nessun campo nuovo, nessun backfill.
 */
export function entrataDalSoloMittente(
  voce: Pick<VoceArchivioFornitore, "nomeFile" | "mimeType">
): boolean {
  return nomeDaConferma(voce.nomeFile, voce.mimeType) == null;
}

/** Una conferma d'ordine porta almeno una di queste tre cose. */
function letturaPortaUnaConferma(lettura: LetturaArchivio): boolean {
  return (
    lettura.numeroOrdine != null ||
    lettura.imponibile != null ||
    lettura.articoli.length > 0
  );
}
```

Aggiungi `nomeDaConferma` all'import da `../tars/documenti/confermeMancanti` (ora servono entrambe: `allegatoDaConferma` per far entrare, `nomeDaConferma` per sapere da quale porta è entrata).

Poi, nel ciclo «2. Lettura e decisione» di `eseguiGiroArchivioFornitori`, fra la riga `if (ricerca.esito === "non_leggibile") esito.nonLeggibili += 1;` e il commento `// La commessa è una sola: …`, inserisci:

```ts
      // Chi è entrato solo perché lo mandava un fornitore noto deve
      // dimostrare di essere una conferma: senza numero d'ordine, imponibile
      // o articoli è un altro foglio dello stesso fornitore — una circolare,
      // un accordo commerciale, una lettera (10/09/2026). Senza questa regola
      // la bonifica raddoppierebbe la coda invece di svuotarla.
      //
      // Un file che NON si è potuto leggere non si scarta: non averlo capito
      // non è la prova che non fosse una conferma.
      if (
        ricerca.esito !== "non_leggibile" &&
        entrataDalSoloMittente(voce) &&
        !letturaPortaUnaConferma(voce.lettura)
      ) {
        voce.stato = "scartata";
        voce.motivoDecisione =
          "Il file non porta una conferma d'ordine: nessun numero d'ordine, nessun imponibile, nessun articolo.";
        voce.decisaDa = null;
        voce.decisaAt = adesso.toISOString();
        voce.updatedAt = adesso;
        continue;
      }
```

Lo scarto sta **prima** del ramo che incrementa `esito.daCollegare`, quindi una voce scartata non compare fra le decisioni da prendere; e sta **dopo** l'assegnazione di `voce.lettura`, così il motivo si basa su quello che è stato letto davvero.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test server/fornitori/archivio.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/fornitori/archivio.ts server/fornitori/archivio.test.ts
git commit -m "feat(archivio): chi entra dal solo mittente deve dimostrare di essere una conferma

Senza questa regola Primed rovescia in coda trecento allegati e la coda
passa da 230 a oltre 500: la bonifica peggiorerebbe il problema che
voleva risolvere.

Il segnale è già nel dato letto: una conferma porta un numero d'ordine,
un imponibile o degli articoli. Nessuna delle tre e nome che non si
dichiara -> scartata col motivo. Un file che si dichiara conferma resta
in coda: quella decisione è di una persona.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Documenti e verifica finale

**Files:**
- Modify: `documento_requisiti_infissi_ops.md` (§19.4 e §36-bis.2, punto 1 «scansione»)
- Modify: `handoff.md` (nuovo blocco «Novità» in cima)

**Interfaces:**
- Consumes: tutto quello sopra. Produces: niente codice.

- [ ] **Step 1: Aggiorna il PRD**

In `documento_requisiti_infissi_ops.md`, §36-bis.2, punto **1 (scansione)**, sostituisci la frase «Ogni allegato «da conferma» (`nomeDaConferma`) entra in archivio una volta sola» con:

```markdown
   Ogni allegato candidato (`allegatoDaConferma`) entra in archivio una volta
   sola. Tre modi di essere candidato (10/09/2026): il nome dichiara una
   conferma, il nome dice almeno «ordine», oppure **il mittente è un fornitore
   noto** — e allora il nome smette di essere un filtro, perché Primed allega
   `R237_2026WU367846_….pdf` e in un anno non era mai entrato niente. I nomi
   esclusi (fattura, DDT, listino, preventivo, contratto e, da oggi,
   **sollecito**) restano esclusi anche per un mittente noto, e i formati non
   documentali pure. Chi entra dal SOLO mittente deve però dimostrarsi: se la
   lettura non trova né numero d'ordine, né imponibile, né articoli, la voce si
   scarta da sola con il motivo, e non finisce nella coda delle decisioni.
   `antenore.biz` non è un fornitore ma il **portale** con cui si ordina da Wnd
   e Oknoplast: `PORTALI` in `shared/fornitori.ts` lo riconduce al produttore.
```

In §19.4, dopo il paragrafo «Pipeline», aggiungi una riga:

```markdown
- **Chi entra (10/09/2026)**: il candidato non lo decide più il solo nome del
  file. V. §36-bis.2 punto 1.
```

- [ ] **Step 2: Aggiorna handoff.md**

In cima a `handoff.md`, dopo la riga «**Deploy:**», inserisci un blocco nello stile degli altri:

```markdown
> **Novità 10/09/2026 — bonifica dell'archivio conferme.** Il candidato
> «conferma d'ordine» non lo decide più il solo nome del file: se il mittente è
> un fornitore noto il nome smette di essere un filtro, in memoria come in SQL
> (`SORGENTE_MITTENTE_FORNITORE`, sorgente unica per i due rami). Motivo
> misurato: Primed mandava 312 mail e aveva **zero** voci in archivio, perché
> allega `R237_2026WU367846_….pdf`; stessa sorte per i 59 allegati Alias
> chiamati «allegato». `antenore.biz` è ora riconosciuto come **portale** di
> Wnd/Oknoplast (`PORTALI`) invece di finire in «Da riconoscere»; i
> «Sollecito_Ordin_…» non passano più per conferme. Perché la coda non
> raddoppi, chi entra dal SOLO mittente e alla lettura non porta né numero
> d'ordine né imponibile né articoli **si scarta da solo** con il motivo.
> **Fuori, dichiarato:** il nome Alias che arriva mangiato (`LIAS Srl`, `IAS
> Srl`) — la causa è a monte, nell'estrazione, e va diagnosticata su un PDF
> vero. Spec `docs/superpowers/specs/2026-09-10-gestione-ordini-design.md` §8;
> piano `docs/superpowers/plans/2026-09-10-bonifica-archivio-conferme.md`.
```

- [ ] **Step 3: Verifica completa**

```bash
pnpm check
```
Expected: nessun errore.

```bash
pnpm test
```
Expected: tutti i file passati; nessuna regressione rispetto alla base (355 file / 3864 test alla data della spec).

```bash
pnpm build
```
Expected: build riuscita.

- [ ] **Step 4: Commit**

```bash
git add documento_requisiti_infissi_ops.md handoff.md
git commit -m "docs(archivio): PRD e handoff allineati alla bonifica delle conferme

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Dopo il merge: che cosa guardare in produzione

Non è un task del piano — è la verifica che dice se la bonifica ha funzionato. Da fare **prima** di scrivere il piano 2, perché la spec §15 chiede di rimisurare i fornitori-per-lavoro a coda pulita.

1. Il worker gira ogni 10 minuti; forzare un giro dalla pagina Fornitori («Aggiorna archivio») per la sede.
2. Contare, con una sonda in sola lettura, le voci di `fornitori_archivio` per fornitore e per stato. Attese: Primed passa da **0** a un numero diverso da zero; Antenore sparisce da «Da riconoscere» e le sue voci compaiono sotto **Wnd**; le voci `scartata` crescono (è il funzionamento voluto, non un guasto).
3. Se `da_collegare` cresce **molto** oltre le 230 di partenza, la regola del Task 6 non sta trattenendo abbastanza: guardare i nomi dei file entrati e decidere se stringere, non se tornare indietro.
4. Rimisurare i fornitori distinti per commessa (oggi: 42 con uno, 17 con due o più). È il numero che il piano 2 usa per dimensionare la partita.
