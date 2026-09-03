# T1 — Gli strumenti che mancano: piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** chiudere T1 del piano «Tars utile»: registrare nel catalogo le tre
ricerche già scritte (`cerca_comunicazioni`, `cerca_fatture`,
`cerca_documenti`) e aggiungere le due scritture mancanti
(`collega_fattura_commessa`, `sposta_documento`), con test, matrice
aggiornata e deploy verificato. Registro azioni: 44 → 49, versione 1.11.0.

**Architecture:** ogni strumento Tars è un oggetto `StrumentoTars` tipizzato
che esegue la procedura canonica del CRM (caller tRPC con il contesto
server dell'utente, `callerPer`) o un servizio di dominio con authz
esplicita. Il registro (`azioni/registry.ts`) valida a load-time la
coerenza nome/capability/flag e rifiuta strumenti senza metadati: strumento
e metadati si aggiungono SEMPRE nello stesso commit, altrimenti ogni import
del registro esplode.

**Tech Stack:** TypeScript, tRPC 11, Zod, Vitest. Store in memoria nei test
(condivisi fra i test dello stesso file: id unici obbligatori).

**Spec:** `docs/superpowers/plans/2026-09-03-tars-utile.md` (§4 T1) e
`docs/tars/sessione-2026-09-02-03-consegna.md` (§4 T1 e §5). Le ricerche e
i servizi di dominio (`documentiDiSede`, `spostaDocumentoDiCommessa`) sono
GIÀ committati in `63fc685`: il §5 della consegna che li dice «non
committati» è superato.

## Global Constraints

- Ogni azione Tars passa da un servizio di dominio tipizzato o dalla stessa
  procedura tRPC del router con `callerPer` — mai SQL, mai scritture dirette.
- Sede-scoped ovunque: un record di un'altra sede produce «non trovato»,
  mai informazioni utili.
- Il registro è fail-closed: capability, flag (`tars` sempre presente),
  R4 vietato, metadati completi. `VERSIONE_REGISTRO_AZIONI` → `1.11.0`
  (bump nel Task 3, quando il catalogo raggiunge la forma finale).
- Niente modifiche sotto `client/`: T1 è solo server + docs.
- Ogni commit lascia l'albero verde (`pnpm check` + test dei file toccati);
  la suite completa, `pnpm build` e il push arrivano nel Task 5.
- Messaggi di commit in italiano nello stile del repo, chiusi da
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Comandi dal worktree corrente:
  `/Users/timmy/Ruffino Group/infissi-ops-app/.claude/worktrees/tars-production-analysis-f8a2fc`.

---

### Task 1: `collega_fattura_commessa` (scrittura R1)

**Files:**
- Modify: `server/tars/strumenti/scrittura.ts` (nuovo tool + import + export)
- Modify: `server/tars/azioni/registry.ts` (voce METADATI)
- Modify: `server/tars/azioni/registry.test.ts` (goldens 44 → 45, capability di test)
- Test: `server/tars/strumenti/scrittura.test.ts` (nuovo describe)

**Interfaces:**
- Consumes: `caller.ficFatture.collega({ficId, commessaId})` (procedura
  esistente: `requireDirezioneOAmministrazione`, pattuito, riconciliazione
  incassi, PDF nel fascicolo; ritorna `{success, paymentStats,
  correzioniProposte, pdf: {stato, documentoId, errore}, documentoId}`);
  `ficFatture` (array store, `server/routers/ficFatture.ts:189`);
  helper `commessaInSede(contesto, id)` già in scrittura.ts.
- Produces: tool `collega_fattura_commessa` v1.0.0, capability
  `["economia.read"]`, interruttore `"tarsL2Actions"`, esito con stati
  `collegata` / `non_eseguito`.

- [ ] **Step 1: test che fallisce.** In `server/tars/strumenti/scrittura.test.ts`, aggiungere agli import:

```ts
import {
  _setScaricaFatturaPdfForTests,
  ficFatture,
  upsertFatture,
} from "../../routers/ficFatture";
```

e in coda al file il describe (id fatture unici nel file: 968_101+):

```ts
describe("fatture e documenti del fascicolo (T1)", () => {
  it("collega_fattura_commessa collega, con prima/dopo; già collegata e cross-sede non eseguite", async () => {
    const ctx = await contesto();
    const commessa = await direzione().commesse.create({ cliente: "Fattura Test" });
    upsertFatture([{
      id: 968_101, numero: "130/T", data: "2026-08-01",
      clienteNome: "Fattura Test", clienteVat: null, clienteCf: null,
      importoNetto: 1000, importoLordo: 1220, rate: [],
    }], SEDE);
    upsertFatture([{
      id: 968_102, numero: "131/T", data: "2026-08-02",
      clienteNome: "Altra Sede Srl", clienteVat: null, clienteCf: null,
      importoNetto: 500, importoLordo: 610, rate: [],
    }], ALTRA_SEDE);
    _setScaricaFatturaPdfForTests(async () => Buffer.from("%PDF-1.4 finto"));
    try {
      const esito = await tool("collega_fattura_commessa").esegui(ctx, {
        ficId: 968_101, commessaId: commessa.id,
      });
      expect(esito.stato).toBe("collegata");
      expect(esito.prima).toMatchObject({ commessaId: null });
      expect(esito.dati.commessaId).toBe(commessa.id);
      const f = (ficFatture as any[]).find(x => x.id === 968_101)!;
      expect(f.commessaId).toBe(commessa.id);
      expect(f.collegataAMano).toBe(true);

      const doppia = await tool("collega_fattura_commessa").esegui(ctx, {
        ficId: 968_101, commessaId: commessa.id,
      });
      expect(doppia.stato).toBe("non_eseguito");
      expect(doppia.motivo).toContain("già collegata");

      const crossSede = await tool("collega_fattura_commessa").esegui(ctx, {
        ficId: 968_102, commessaId: commessa.id,
      });
      expect(crossSede.stato).toBe("non_eseguito");
      expect(crossSede.motivo).toContain("non trovata");
    } finally {
      _setScaricaFatturaPdfForTests(null);
    }
  });

  it("collega_fattura_commessa: senza direzione/amministrazione il router rifiuta senza leak", async () => {
    const ctxPosa = await contesto(POSA_ID, ["squadra_posa"]);
    const commessa = await direzione().commesse.create({ cliente: "Fattura Ruoli" });
    upsertFatture([{
      id: 968_103, numero: "132/T", data: "2026-08-03",
      clienteNome: "Fattura Ruoli", clienteVat: null, clienteCf: null,
      importoNetto: 100, importoLordo: 122, rate: [],
    }], SEDE);
    const esito = await tool("collega_fattura_commessa").esegui(ctxPosa, {
      ficId: 968_103, commessaId: commessa.id,
    });
    expect(esito.stato).toBe("non_eseguito");
    expect(esito.motivo).toMatch(/autorizzat|direzione|amministrazione/i);
    expect((ficFatture as any[]).find(x => x.id === 968_103)!.commessaId ?? null).toBeNull();
  });
});
```

- [ ] **Step 2: eseguirlo e vederlo fallire.**

Run: `pnpm vitest run server/tars/strumenti/scrittura.test.ts`
Expected: FAIL — `tool("collega_fattura_commessa")` è `undefined` (`.esegui` non esiste).

- [ ] **Step 3: implementazione.** In `server/tars/strumenti/scrittura.ts`:

Aggiungere l'import (dopo quello di `getCommessaById`):

```ts
import { ficFatture } from "../../routers/ficFatture";
```

Prima di `export const STRUMENTI_SCRITTURA`, la sezione:

```ts
// ── Fatture (FiC) ───────────────────────────────────────────────────────

const collegaFatturaCommessa: StrumentoTars = {
  nome: "collega_fattura_commessa",
  versione: "1.0.0",
  categoria: "economia",
  livello: "L2",
  effetto: "interno",
  reversibile: true,
  capability: ["economia.read"],
  interruttore: "tarsL2Actions",
  descrizione:
    "Collega una fattura di Fatture in Cloud a una commessa della sede: il pattuito si aggiorna dalla fattura, gli incassi si riconciliano e il PDF finisce nel fascicolo. Richiede direzione o amministrazione. Trova prima la fattura con cerca_fatture.",
  schemaInput: z
    .object({
      ficId: z.number().int().positive(),
      commessaId: z.number().int().positive(),
    })
    .strict(),
  async esegui(contesto, input): Promise<EsitoAzione> {
    assicuraL2();
    const nome = "collega_fattura_commessa";
    const fattura: any = (ficFatture as any[]).find(
      f => f.id === input.ficId && f.sedeId === contesto.sedeId
    );
    if (!fattura) return nonEseguito(nome, "Fattura non trovata in questa sede.");
    const commessa = commessaInSede(contesto, input.commessaId);
    if (!commessa) return nonEseguito(nome, "Commessa non trovata in questa sede.");
    if (commessa.archivedAt) {
      return nonEseguito(nome, "La commessa è archiviata: ripristinala prima.");
    }
    if (fattura.commessaId === input.commessaId) {
      return nonEseguito(nome, "La fattura è già collegata a questa commessa.");
    }
    const prima = {
      commessaId: fattura.commessaId ?? null,
      collegataAMano: fattura.collegataAMano ?? false,
    };
    try {
      const caller = await callerPer(contesto);
      const esito = await caller.ficFatture.collega({
        ficId: input.ficId,
        commessaId: input.commessaId,
      });
      return fatto({
        strumento: nome,
        stato: "collegata",
        azioneId: `${nome}:fattura:${input.ficId}:${Date.now()}`,
        entitaToccate: [`fattura:${input.ficId}`, `commessa:${commessa.id}`],
        prima,
        dopo: {
          ficId: input.ficId,
          numero: fattura.numero,
          commessaId: commessa.id,
          commessa: `${commessa.codice} — ${commessa.cliente}`,
          pdfNelFascicolo: esito.pdf.stato === "archiviata",
          documentoId: esito.documentoId,
        },
        evidenze: [
          evidenzaCommessa(commessa),
          {
            tipo: "entita",
            riferimento: `fattura:${input.ficId}`,
            descrizione: `Fattura n. ${fattura.numero} del ${fattura.data} — ${fattura.clienteNome}`,
          },
        ],
        avvertenze: [
          "Pattuito e incassi della commessa ora derivano dalla fattura (dominio FiC).",
          ...(esito.pdf.stato === "errore"
            ? [`PDF non archiviato: ${esito.pdf.errore ?? "errore sconosciuto"}`]
            : []),
        ],
      });
    } catch (errore) {
      return nonEseguito(nome, motivoSicuro(errore));
    }
  },
};
```

Aggiungere `collegaFatturaCommessa,` in coda all'array `STRUMENTI_SCRITTURA`
(dopo `risolviCaso`).

- [ ] **Step 4: metadati nel registro (stesso commit, o il load del modulo esplode).** In `server/tars/azioni/registry.ts`, dentro `METADATI` dopo la voce `risolvi_caso`:

```ts
  collega_fattura_commessa: r1("collega_fattura_commessa", "entita", ["generale", "economia", "commessa"], ["commessa", "cliente"], ["tars", "tarsL2Actions"], false),
```

- [ ] **Step 5: goldens del registro.** In `server/tars/azioni/registry.test.ts`:
  - nella lista capability di `contesto()` (riga ~18) aggiungere
    `"economia.read",` (senza: i test del catalogo pieno non vedrebbero il
    nuovo tool);
  - i quattro conteggi `44` (righe ~64, ~65, ~342, ~391) → `45`;
  - nella mappa dei rischi (`toEqual({ analizza_conferma_ordine: "R0", … })`)
    aggiungere `collega_fattura_commessa: "R1",`;
  - nella mappa degli scope aggiungere `collega_fattura_commessa: "entita",`;
  - nella mappa delle compensazioni R1 aggiungere
    `collega_fattura_commessa: false,`.

- [ ] **Step 6: verifica verde.**

Run: `pnpm vitest run server/tars/strumenti/scrittura.test.ts server/tars/azioni/registry.test.ts && pnpm check`
Expected: PASS (entrambi i file) e typecheck pulito.

- [ ] **Step 7: commit.**

```bash
git add server/tars/strumenti/scrittura.ts server/tars/strumenti/scrittura.test.ts server/tars/azioni/registry.ts server/tars/azioni/registry.test.ts
git commit -m "feat(tars): collega_fattura_commessa — la stessa procedura FiC del CRM

«Collega la fattura n. 130 alla commessa 168» ora è un'azione del
catalogo: stessa ficFatture.collega del router (direzione o
amministrazione), pattuito e incassi derivati dal dominio, PDF nel
fascicolo, esito con prima/dopo nel ledger R1.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `sposta_documento` (scrittura R1)

**Files:**
- Modify: `server/tars/strumenti/scrittura.ts`
- Modify: `server/tars/azioni/registry.ts`
- Modify: `server/tars/azioni/registry.test.ts` (goldens 45 → 46)
- Test: `server/tars/strumenti/scrittura.test.ts`

**Interfaces:**
- Consumes: `spostaDocumentoDiCommessa({documentoId, commessaId, sedeId,
  note})` e `getDocumentoCommessaById(id, sedeId)` da
  `server/routers/preventiviContratti.ts` (servizio di dominio: rifiuta
  destinazioni archiviate/fuori sede, rinomina se il nome è preso,
  riallinea `statoAtUpload`); `caricaDocumentoCommessaDaBuffer` (solo nel
  test, per seminare — ritorna il documento con `id`).
- Produces: tool `sposta_documento` v1.0.0, capability
  `["commessa.manage_documents"]`, interruttore `"tarsL2Actions"`, stati
  `spostato` / `non_eseguito`.

- [ ] **Step 1: test che fallisce.** In `scrittura.test.ts`, import aggiuntivo:

```ts
import {
  caricaDocumentoCommessaDaBuffer,
  getDocumentoRecordById,
} from "../../routers/preventiviContratti";
```

e dentro il describe «fatture e documenti del fascicolo (T1)»:

```ts
  it("sposta_documento: fascicolo giusto, gate ricalcolato, destinazione archiviata rifiutata", async () => {
    const ctx = await contesto();
    const origine = await direzione().commesse.create({ cliente: "Doc Origine" });
    const destinazione = await direzione().commesse.create({ cliente: "Doc Destinazione" });
    (getCommessaById(destinazione.id) as any).stato = "misure_esecutive";
    const caricato = await caricaDocumentoCommessaDaBuffer({
      commessaId: origine.id, nome: "contratto-prova.pdf", tipo: "contratto",
      mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 doc"),
      sedeId: SEDE, createdBy: DIREZIONE_ID,
    });

    const esito = await tool("sposta_documento").esegui(ctx, {
      documentoId: caricato.id, commessaId: destinazione.id,
    });
    expect(esito.stato).toBe("spostato");
    expect(esito.prima).toMatchObject({ commessaId: origine.id, statoAtUpload: "preventivo" });
    expect(esito.dati).toMatchObject({ commessaId: destinazione.id, statoAtUpload: "misure_esecutive" });
    expect(getDocumentoRecordById(caricato.id)!.commessaId).toBe(destinazione.id);

    const archiviata = await direzione().commesse.create({ cliente: "Doc Archiviata" });
    await direzione().commesse.archive({ id: archiviata.id });
    const suArchiviata = await tool("sposta_documento").esegui(ctx, {
      documentoId: caricato.id, commessaId: archiviata.id,
    });
    expect(suArchiviata.stato).toBe("non_eseguito");
    expect(suArchiviata.motivo).toContain("archiviata");
    expect(getDocumentoRecordById(caricato.id)!.commessaId).toBe(destinazione.id);
  });

  it("sposta_documento: documento di un'altra sede invisibile", async () => {
    const ctx = await contesto();
    const qui = await direzione().commesse.create({ cliente: "Doc Qui" });
    const altrove = await direzione(ALTRA_SEDE).commesse.create({ cliente: "Doc Altrove" });
    const caricato = await caricaDocumentoCommessaDaBuffer({
      commessaId: altrove.id, nome: "misure-altrove.pdf", tipo: "misure",
      mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 alt"),
      sedeId: ALTRA_SEDE, createdBy: DIREZIONE_ID,
    });
    const esito = await tool("sposta_documento").esegui(ctx, {
      documentoId: caricato.id, commessaId: qui.id,
    });
    expect(esito.stato).toBe("non_eseguito");
    expect(esito.motivo).toContain("non trovato");
  });
```

Nota su `commesse.archive`: la procedura esiste già (la usa
`strumentoArchivioCommessa`); se l'input reale fosse diverso da `{id}`,
copiare la chiamata esatta da quello strumento.

- [ ] **Step 2: eseguirlo e vederlo fallire.**

Run: `pnpm vitest run server/tars/strumenti/scrittura.test.ts`
Expected: FAIL — `tool("sposta_documento")` è `undefined`.

- [ ] **Step 3: implementazione.** In `scrittura.ts`, import aggiuntivo:

```ts
import {
  getDocumentoCommessaById,
  spostaDocumentoDiCommessa,
} from "../../routers/preventiviContratti";
```

Sotto la sezione Fatture:

```ts
// ── Documenti del fascicolo ─────────────────────────────────────────────

const spostaDocumento: StrumentoTars = {
  nome: "sposta_documento",
  versione: "1.0.0",
  categoria: "documenti",
  livello: "L2",
  effetto: "interno",
  reversibile: true,
  capability: ["commessa.manage_documents"],
  interruttore: "tarsL2Actions",
  descrizione:
    "Sposta un documento nel fascicolo di un'altra commessa della stessa sede (correzione di archiviazione, non una copia). Il gate documentale segue il documento: statoAtUpload diventa lo stato della commessa di destinazione. Trova prima il documento con cerca_documenti.",
  schemaInput: z
    .object({
      documentoId: z.number().int().positive(),
      commessaId: z.number().int().positive(),
      note: z.string().max(300).optional(),
    })
    .strict(),
  async esegui(contesto, input): Promise<EsitoAzione> {
    assicuraL2();
    const nome = "sposta_documento";
    if (!contesto.capability.has("commessa.manage_documents")) {
      return nonEseguito(nome, "Non autorizzato: servono i permessi sui documenti delle commesse.");
    }
    const documento = getDocumentoCommessaById(input.documentoId, contesto.sedeId);
    if (!documento) return nonEseguito(nome, "Documento non trovato in questa sede.");
    const prima = {
      commessaId: documento.commessaId,
      nome: documento.nome,
      statoAtUpload: documento.statoAtUpload ?? null,
    };
    try {
      const { documento: spostato, da, a } = spostaDocumentoDiCommessa({
        documentoId: input.documentoId,
        commessaId: input.commessaId,
        sedeId: contesto.sedeId,
        note: input.note,
      });
      const origine: any = getCommessaById(da);
      const destinazione: any = getCommessaById(a);
      return fatto({
        strumento: nome,
        stato: "spostato",
        azioneId: `${nome}:documento:${spostato.id}:${Date.now()}`,
        entitaToccate: [`documento:${spostato.id}`, `commessa:${da}`, `commessa:${a}`],
        prima,
        dopo: {
          documentoId: spostato.id,
          nome: spostato.nome,
          commessaId: a,
          commessa: destinazione ? `${destinazione.codice} — ${destinazione.cliente}` : null,
          statoAtUpload: spostato.statoAtUpload ?? null,
        },
        evidenze: [
          {
            tipo: "entita",
            riferimento: `documento:${spostato.id}`,
            descrizione: `${spostato.tipo} «${spostato.nome}»`,
          },
          ...(destinazione ? [evidenzaCommessa(destinazione)] : []),
        ],
        avvertenze: [
          ...(origine
            ? [`Tolto dal fascicolo di ${origine.codice ?? `commessa ${da}`}: il suo gate documentale va ricontrollato.`]
            : []),
          ...(spostato.nome !== prima.nome
            ? [`Rinominato in «${spostato.nome}»: il nome era già preso nella destinazione.`]
            : []),
        ],
      });
    } catch (errore) {
      return nonEseguito(nome, motivoSicuro(errore));
    }
  },
};
```

Attenzione a `motivoSicuro`: trasforma i messaggi con «non trovat*» in «Non
trovato in questa sede.» — per questo il test cross-sede si aspetta «non
trovato» generico, mentre «archiviata» passa testuale. Aggiungere
`spostaDocumento,` in coda a `STRUMENTI_SCRITTURA`.

- [ ] **Step 4: metadati.** In `registry.ts`, dopo la voce del Task 1:

```ts
  sposta_documento: r1("sposta_documento", "entita", ["generale", "commessa", "documenti-ordini"], ["commessa", "documento"], ["tars", "tarsL2Actions"], false),
```

- [ ] **Step 5: goldens.** In `registry.test.ts`: i quattro conteggi `45` → `46`;
  `sposta_documento: "R1",` nella mappa rischi; `sposta_documento: "entita",`
  negli scope; `sposta_documento: false,` nelle compensazioni R1.

- [ ] **Step 6: verifica verde.**

Run: `pnpm vitest run server/tars/strumenti/scrittura.test.ts server/tars/azioni/registry.test.ts && pnpm check`
Expected: PASS.

- [ ] **Step 7: commit.**

```bash
git add server/tars/strumenti/scrittura.ts server/tars/strumenti/scrittura.test.ts server/tars/azioni/registry.ts server/tars/azioni/registry.test.ts
git commit -m "feat(tars): sposta_documento — il documento nel fascicolo giusto, gate al seguito

Il servizio di dominio spostaDocumentoDiCommessa entra nel catalogo:
sede obbligatoria, destinazione archiviata rifiutata, rinomina se il
nome è preso, statoAtUpload riallineato allo stato della commessa di
arrivo. Esito con prima/dopo nel ledger R1.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: registrare le tre ricerche e chiudere il catalogo a 49 (v1.11.0)

**Files:**
- Modify: `server/tars/azioni/registry.ts` (import, `STRUMENTI_CORRENTI`, 3 voci METADATI, bump versione)
- Modify: `server/tars/azioni/registry.test.ts` (goldens 46 → 49)
- Create: `server/tars/strumenti/ricerca.test.ts`

**Interfaces:**
- Consumes: `STRUMENTI_RICERCA` da `server/tars/strumenti/ricerca.ts`
  (già scritto: `cerca_comunicazioni` L0 cap `commessa.read` flag
  `tarsCommunications`; `cerca_fatture` L0 cap `economia.read` flag `tars`;
  `cerca_documenti` L0 cap `commessa.read` flag `tars`);
  `insertComunicazione` (pattern di seed in `scrittura.test.ts:161`);
  `upsertFatture`; `caricaDocumentoCommessaDaBuffer`.
- Produces: catalogo a 49 azioni, `VERSIONE_REGISTRO_AZIONI = "1.11.0"`.

- [ ] **Step 1: goldens prima (test che fallisce).** In `registry.test.ts`:
  quattro conteggi `46` → `49`; nella mappa rischi aggiungere
  `cerca_comunicazioni: "R0",`, `cerca_fatture: "R0",`,
  `cerca_documenti: "R0",`; negli scope `cerca_comunicazioni: "sede",`,
  `cerca_fatture: "sede",`, `cerca_documenti: "sede",` (nessuna voce nelle
  compensazioni R1: sono letture).

Run: `pnpm vitest run server/tars/azioni/registry.test.ts`
Expected: FAIL — il registro ha 46 azioni, non 49.

- [ ] **Step 2: registrazione.** In `registry.ts`:
  - import: `import { STRUMENTI_RICERCA } from "../strumenti/ricerca";`
  - in `STRUMENTI_CORRENTI` aggiungere `...STRUMENTI_RICERCA,` (dopo
    `...STRUMENTI_SCRITTURA`);
  - `export const VERSIONE_REGISTRO_AZIONI = "1.10.0";` → `"1.11.0"`;
  - in `METADATI`, vicino alle altre `cerca_*`:

```ts
  cerca_comunicazioni: lettura("sede", ["generale", "comunicazioni"], ["commessa", "cliente"], ["tars", "tarsReadTools", "tarsCommunications"]),
  cerca_fatture: lettura("sede", ["generale", "economia", "commessa"], ["commessa", "cliente"]),
  cerca_documenti: lettura("sede", ["generale", "commessa", "documenti-ordini"], ["commessa", "documento"]),
```

(Il validatore esige che i flag del tool siano inclusi nei metadati:
`cerca_comunicazioni` dichiara `tarsCommunications`, le altre due solo
`tars` — le liste sopra bastano.)

Run: `pnpm vitest run server/tars/azioni/registry.test.ts`
Expected: PASS.

- [ ] **Step 3: test delle ricerche.** Creare
`server/tars/strumenti/ricerca.test.ts`:

```ts
// Ricerche T1: numero di telefono, fattura per numero, documento per
// nome; la sede altrui resta invisibile. Store in memoria condivisi nel
// file: id e nomi unici.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "../../_core/context";
import { insertComunicazione } from "../../comunicazioni/comunicazioni";
import { appRouter } from "../../routers";
import { upsertFatture } from "../../routers/ficFatture";
import { caricaDocumentoCommessaDaBuffer } from "../../routers/preventiviContratti";
import { costruisciContesto } from "../contesto";
import { STRUMENTI_RICERCA } from "./ricerca";

const SEDE = 96_821;
const ALTRA_SEDE = 96_822;
const UTENTE = 96_831;

function contestoTrpc(sedeId = SEDE): TrpcContext {
  return {
    user: { id: UTENTE, role: "admin", ruolo: "direzione", ruoli: ["direzione"], name: "Direzione Ricerca" } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}

const direzione = (sedeId = SEDE) => appRouter.createCaller(contestoTrpc(sedeId));
const tool = (nome: string) => STRUMENTI_RICERCA.find(s => s.nome === nome)!;
const contesto = () => costruisciContesto(contestoTrpc());

beforeEach(() => {
  process.env.FLAG_TARS = "on";
  process.env.FLAG_TARS_READ_TOOLS = "on";
  process.env.FLAG_TARS_COMMUNICATIONS = "on";
});
afterEach(() => {
  delete process.env.FLAG_TARS;
  delete process.env.FLAG_TARS_READ_TOOLS;
  delete process.env.FLAG_TARS_COMMUNICATIONS;
});

describe("cerca_comunicazioni", () => {
  it("trova per numero di telefono anche scritto con +39 e spazi; la sede altrui è invisibile", async () => {
    const ctx = await contesto();
    await insertComunicazione({
      sedeId: SEDE, casellaId: 9, messageId: `ric-wa-${Date.now()}`, canale: "whatsapp", direzione: "in",
      mittente: "393371563627", mittenteNome: null, destinatari: [], oggetto: null,
      testo: "Buongiorno, vorrei un preventivo per due finestre",
      allegati: [], clienteId: null, commessaId: null, matchConfidenza: "nessuna", matchMotivo: null,
      stato: "nuova", receivedAt: new Date(),
    });
    await insertComunicazione({
      sedeId: ALTRA_SEDE, casellaId: 9, messageId: `ric-wa-alt-${Date.now()}`, canale: "whatsapp", direzione: "in",
      mittente: "393385550000", mittenteNome: null, destinatari: [], oggetto: null,
      testo: "Messaggio di un'altra sede",
      allegati: [], clienteId: null, commessaId: null, matchConfidenza: "nessuna", matchMotivo: null,
      stato: "nuova", receivedAt: new Date(),
    });

    const esito = await tool("cerca_comunicazioni").esegui(ctx, {
      telefono: "+39 337 156 3627", limite: 10,
    });
    expect(esito.dati.trovate).toBeGreaterThanOrEqual(1);
    expect(esito.dati.comunicazioni[0]).toMatchObject({ canale: "whatsapp", numero: "393371563627" });
    expect(esito.dati.comunicazioni[0].link).toContain("conversazione=");

    const altrove = await tool("cerca_comunicazioni").esegui(ctx, {
      telefono: "393385550000", limite: 10,
    });
    expect(altrove.dati.trovate).toBe(0);

    await expect(
      tool("cerca_comunicazioni").esegui(ctx, { limite: 10 })
    ).rejects.toThrow(/testo o un numero/);
  });
});

describe("cerca_fatture", () => {
  it("trova per numero e segnala le non collegate; la sede altrui è invisibile", async () => {
    const ctx = await contesto();
    upsertFatture([{
      id: 968_201, numero: "777/R", data: "2026-08-10",
      clienteNome: "Ricerca Fatture Srl", clienteVat: null, clienteCf: null,
      importoNetto: 2000, importoLordo: 2440, rate: [],
    }], SEDE);
    upsertFatture([{
      id: 968_202, numero: "778/R", data: "2026-08-11",
      clienteNome: "Sede Estranea Srl", clienteVat: null, clienteCf: null,
      importoNetto: 300, importoLordo: 366, rate: [],
    }], ALTRA_SEDE);

    const esito = await tool("cerca_fatture").esegui(ctx, { numero: "777/R", limite: 10 });
    expect(esito.dati.trovate).toBe(1);
    expect(esito.dati.fatture[0]).toMatchObject({
      ficId: 968_201, numero: "777/R", commessaId: null, collegataAMano: false,
    });

    const altrove = await tool("cerca_fatture").esegui(ctx, { numero: "778/R", limite: 10 });
    expect(altrove.dati.trovate).toBe(0);

    await expect(tool("cerca_fatture").esegui(ctx, { limite: 10 })).rejects.toThrow(/numero, cliente/);
  });
});

describe("cerca_documenti", () => {
  it("trova per nome nella sede; la sede altrui è invisibile", async () => {
    const ctx = await contesto();
    const commessa = await direzione().commesse.create({ cliente: "Ricerca Documenti" });
    await caricaDocumentoCommessaDaBuffer({
      commessaId: commessa.id, nome: "ddt-ricerca-unico.pdf", tipo: "contratto",
      mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 ric"),
      sedeId: SEDE, createdBy: UTENTE,
    });
    const altrove = await direzione(ALTRA_SEDE).commesse.create({ cliente: "Doc Estraneo" });
    await caricaDocumentoCommessaDaBuffer({
      commessaId: altrove.id, nome: "ddt-estraneo-unico.pdf", tipo: "contratto",
      mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 est"),
      sedeId: ALTRA_SEDE, createdBy: UTENTE,
    });

    const esito = await tool("cerca_documenti").esegui(ctx, { nome: "ddt-ricerca", limite: 10 });
    expect(esito.dati.trovati).toBe(1);
    expect(esito.dati.documenti[0].nome).toContain("ddt-ricerca");
    expect(esito.dati.documenti[0].commessaId).toBe(commessa.id);

    const estraneo = await tool("cerca_documenti").esegui(ctx, { nome: "ddt-estraneo", limite: 10 });
    expect(estraneo.dati.trovati).toBe(0);

    await expect(tool("cerca_documenti").esegui(ctx, { limite: 10 })).rejects.toThrow(/nome, un tipo/);
  });
});
```

Avvertenze pratiche: (a) lo schema Zod ha `limite` con default — gli
strumenti vengono chiamati qui direttamente, quindi passare sempre
`limite` esplicito; (b) se `insertComunicazione` o la firma di
`caricaDocumentoCommessaDaBuffer` chiedessero campi in più, copiare il
seed esatto da `scrittura.test.ts` (comunicazioni) e dai default del
servizio; (c) se la ricerca per cifre non trovasse il numero (formato
salvato diverso), il bug è in `listComunicazioni`/`soleCifre` e va sistemato
lì, non ammorbidito nel test; il nome file del documento resta con
`keepNome` assente perché `tipo: "contratto"` rinomina — l'asserzione usa
`toContain`, non l'uguaglianza, apposta. Se anche così il nome generato non
contenesse la radice cercata, passare `keepNome: true` nel seed.

- [ ] **Step 4: eseguire i test delle ricerche.**

Run: `pnpm vitest run server/tars/strumenti/ricerca.test.ts`
Expected: PASS (gli strumenti esistono già). Se FAIL: il difetto è nello
strumento o nel servizio, correggere lì e rieseguire.

- [ ] **Step 5: verifica incrociata e commit.**

Run: `pnpm vitest run server/tars --silent && pnpm check`
Expected: PASS su tutta la cartella `server/tars`.

```bash
git add server/tars/azioni/registry.ts server/tars/azioni/registry.test.ts server/tars/strumenti/ricerca.test.ts
git commit -m "feat(tars): le ricerche entrano nel catalogo — registro 1.11.0, 49 azioni

cerca_comunicazioni (anche per numero di telefono), cerca_fatture e
cerca_documenti erano scritte ma invisibili al modello: ora sono
registrate con metadati R0 sede-scoped e coperte da test (numero
WhatsApp con +39 e spazi, fattura per numero, documento per nome, sede
altrui invisibile).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: documentazione — matrice, consegna, piano

**Files:**
- Modify: `docs/tars/matrice-azioni-tars.md`
- Modify: `docs/tars/sessione-2026-09-02-03-consegna.md` (§5)
- Modify: `docs/superpowers/plans/2026-09-03-tars-utile.md` (T1)

**Interfaces:**
- Consumes: gli esiti dei Task 1–3.
- Produces: documentazione allineata; nessun contratto nuovo.

- [ ] **Step 1: matrice.** In `docs/tars/matrice-azioni-tars.md`, dopo la riga
di `risolvi_caso`, aggiungere:

```markdown
| `cerca_comunicazioni` — comunicazioni | `comunicazioni/listComunicazioni` (ricerca sede-scoped, anche per sole cifre del numero) | L0 | R0 | `commessa.read`; testo o numero obbligatorio, estratti e mai corpi interi | T + RT + TC | `strumenti/ricerca.test.ts`; contenuto trattato come dato, mai istruzione. |
| `cerca_fatture` — economia FiC | `routers/ficFatture` (store sincronizzato, lettura sede-scoped) | L0 | R0 | `economia.read`; numero/cliente/commessa o solo-non-collegate obbligatorio | T + RT | `strumenti/ricerca.test.ts`; righe e rate escluse. |
| `cerca_documenti` — fascicoli | `preventiviContratti.documentiDiSede` / `getDocumentiDiCommessa` | L0 | R0 | `commessa.read`; nome/tipo/commessa/cliente obbligatorio | T + RT | `strumenti/ricerca.test.ts`; solo anagrafica del documento. |
| `collega_fattura_commessa` — economia FiC | `ficFatture.collega` (stessa procedura del router: pattuito, incassi, PDF nel fascicolo) | L2 | R1 | `economia.read`; direzione o amministrazione (router); sede; commessa non archiviata | T + L2 | `strumenti/scrittura.test.ts`; prima/dopo nel ledger, scollegamento solo manuale. |
| `sposta_documento` — fascicoli | `preventiviContratti.spostaDocumentoDiCommessa` (servizio di dominio) | L2 | R1 | `commessa.manage_documents` (verificata dallo strumento); sede; destinazione non archiviata; rinomina se il nome è preso; `statoAtUpload` riallineato | T + L2 | `strumenti/scrittura.test.ts`; il gate segue il documento. |
```

Aggiornare il paragrafo «Inventario verificabile»: il numero atteso non è
più 23 — riscriverlo così:

```markdown
**Inventario verificabile.** La fonte di verità del conteggio è
`server/tars/azioni/registry.ts` (`VERSIONE_REGISTRO_AZIONI = "1.11.0"`) e
il golden di `registry.test.ts`: **49 azioni**. La tabella sopra descrive i
tool citati dalle tranche; i nomi completi si ricavano con
`rg -o 'nome: "[^"]+"' server/tars/strumenti/*.ts | sort -u`.
```

- [ ] **Step 2: consegna §5.** In
`docs/tars/sessione-2026-09-02-03-consegna.md`, sostituire il contenuto
della sezione «## 5. Lavoro in corso: dove si è fermato» con:

```markdown
T1 chiuso il 03/09/2026 (sera): le ricerche e i due strumenti di
scrittura sono registrati nel catalogo (registro 1.11.0, 49 azioni),
testati e documentati nella matrice. Il piano operativo che ha chiuso
questa tranche è `docs/superpowers/plans/2026-09-03-t1-strumenti-tars-implementazione.md`.
Nessun lavoro non committato nel worktree.
```

- [ ] **Step 3: piano tars-utile.** In
`docs/superpowers/plans/2026-09-03-tars-utile.md`, nel titolo della sezione
«### T1 — Gli strumenti che mancano», aggiungere lo stato e la nota:

```markdown
### T1 — Gli strumenti che mancano (sblocca i casi già segnalati) — FATTO il 03/09/2026 per ricerche+fatture+documenti; leggi_timeline, completa_step_timeline e crea_cliente_da_messaggio restano da fare (rimandati a T2/T3)
```

- [ ] **Step 4: commit.**

```bash
git add docs/tars/matrice-azioni-tars.md docs/tars/sessione-2026-09-02-03-consegna.md docs/superpowers/plans/2026-09-03-tars-utile.md docs/superpowers/plans/2026-09-03-t1-strumenti-tars-implementazione.md
git commit -m "docs(tars): matrice e consegna allineate al catalogo 1.11.0 (T1 chiuso)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: suite completa, build, push e verifica del deploy

**Files:** nessuna modifica prevista (solo verifiche; correzioni se emergono).

- [ ] **Step 1: suite e build.**

Run: `pnpm check && pnpm test && pnpm build`
Expected: tutto verde (baseline a `b69bc34`: 154 file, 1476 test; ora
qualche test in più). Se un test non correlato fallisce per timeout da
import a freddo dei router, vale la trappola n. 5 della consegna (timeout
esplicito), non nascondere altri errori.

- [ ] **Step 2: push su main (= deploy Railway).** Il branch corrente è
`claude/tars-production-analysis-f8a2fc`; la produzione segue `main`.

```bash
git fetch origin && git checkout main && git merge --ff-only claude/tars-production-analysis-f8a2fc && git push origin main
```

Se `--ff-only` fallisce (main remoto avanzato): `git pull --rebase origin
main` sul branch di lavoro, rieseguire suite, poi ripetere il merge.
Se il checkout di `main` fallisce perché un altro worktree la tiene
occupata: `git push origin claude/tars-production-analysis-f8a2fc:main`
dopo aver verificato con `git fetch` che il push sia fast-forward
(`git merge-base --is-ancestor origin/main HEAD`).

- [ ] **Step 3: verifica del deploy (sola lettura).**

```bash
railway deployment list | head -5
```

Expected: un deployment nuovo in stato SUCCESS dopo l'ora del push. Poi nei
log (`railway logs`) nessun errore di boot del registro (un metadato
mancante farebbe crashare il server all'import: è il primo sintomo da
cercare). Le azioni nuove diventano visibili nella chat di Tars: la
verifica funzionale in produzione è chiedere a Tars «cerca la fattura n.
X» con un utente reale — da fare a voce con la direzione, non
automatizzabile da qui; dichiarare questo limite nel messaggio finale.

---

## Fuori da questo piano (prossime tranche, in ordine)

- **T2** — fotografia su preventivi fermi/gate/fatture/mail senza risposta
  (piano dedicato; include `leggi_timeline`+`completa_step_timeline`).
- **T3** — proposte eseguibili con `azione: {strumento, input}` verificata
  server-side (dipende dal catalogo T1).
- **T5** — follow-up 7/30 giorni (dipende da T2 per «fermo da»).
- **T4** — calendario (bloccata dalla domanda aperta n. 3 della consegna:
  migrazione appuntamenti Google esistenti sì/no).
- **T6** — destinatari (bloccata dalla domanda aperta n. 2: chi sono i
  commerciali assegnatari).
