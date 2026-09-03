# T3 — Proposte che si eseguono: piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** una proposta dell'analisi giornaliera smette di aprire la chat e
diventa un bottone che FA la cosa: il modello allega
`azione: {strumento, input}`, il server la verifica contro il catalogo
PRIMA di mostrarla e la esegue col ledger R1 quando l'utente clicca.

**Architecture:** il contratto vive in `PropostaAnalisi.azione`
(strumento + input come STRINGA JSON: `formatoJson` del provider è
`strict: true`, uno schema aperto non è ammesso). `verificaEsito` valida
l'azione contro whitelist + `descrittoreAzione` + `schemaInput` e la
scarta (null + avvertenza) se non regge. La mutation
`tars.eseguiPropostaAnalisi` riesegue le stesse tappe con il contesto
dell'UTENTE che clicca (catalogo fail-closed), passa dal ledger R1
(`prenota → esegui → concludi`, runId deterministico
`analisi:<id>:proposta:<indice>` ⇒ doppio click = riuso), salva
l'esecuzione dentro l'esito dell'analisi e la UI mostra «Esegui» al posto
di «Chiedi a Tars» quando l'azione c'è.

**Tech Stack:** TypeScript, Zod, tRPC 11, ledger R1 esistente
(`azioni/executions`), Vitest.

**Spec:** `docs/superpowers/plans/2026-09-03-tars-utile.md` §4 T3.

## Global Constraints

- L'azione si esegue SOLO attraverso `descrittoreAzione` + catalogo per
  contesto (capability, sede, flag, direzione): mai un'esecuzione fuori
  registro, mai bypass del ledger R1.
- Whitelist chiusa degli strumenti proponibili (tutte R1 già registrate):
  `crea_ticket`, `pianifica_intervento`, `crea_promemoria`,
  `collega_comunicazione`, `collega_fattura_commessa`, `sposta_documento`,
  `archivia_commessa`, `transizione_adiacente_commessa` — e la
  transizione MAI con `scavalcaGate` da proposta.
- `VERSIONE_ANALISI_AZIENDA` → `1.2.0`, prompt → `analisi-v5`.
- Ogni commit verde; suite completa e build al push.
- Commit chiusi da `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: contratto + verifica server-side dell'azione

**Files:**
- Modify: `server/tars/analisi/types.ts`
- Modify: `server/tars/analisi/analisi.ts`
- Modify: `server/tars/analisi/prompt.ts` (schema JSON v5 + regole)
- Test: `server/tars/analisi/analisi.test.ts`

**Interfaces:**
- Produces:

```ts
export type AzionePropostaAnalisi = {
  strumento: string;
  /** Input dello strumento come stringa JSON (formato strict del provider). */
  input: string;
};
export type EsecuzionePropostaAnalisi = {
  stato: string;
  motivo: string | null;
  azioneId: string | null;
  entitaToccate: string[];
  quando: string;
  daUtente: number;
};
// PropostaAnalisi += { azione: AzionePropostaAnalisi | null;
//                      esecuzione?: EsecuzionePropostaAnalisi | null }
export const STRUMENTI_PROPOSTE_ESEGUIBILI: readonly string[];
```

- Consumes: `descrittoreAzione` da `../azioni/registry` (il grafo import
  non torna su `analisi/`: nessun ciclo).

- [ ] **Step 1: test che falliscono.** In `analisi.test.ts` (describe
«verifica e sintesi») aggiungere:

```ts
  it("un'azione valida della whitelist resta; tool sconosciuto o input fuori schema la azzera con avvertenza", async () => {
    const f = await costruisciFotografia({ sedeId: SEDE, adesso: ADESSO, deps: depsFotografia() });
    const esito = verificaEsito(
      {
        sintesi: "Ok.",
        punti: [],
        proposte: [
          {
            testo: "Crea un ticket per il vetro rotto di COM-2026-002",
            richiestaPerTars: "Crea un ticket per COM-2026-002: vetro rotto",
            entita: ["commessa:2"],
            azione: { strumento: "crea_ticket", input: JSON.stringify({ commessaId: 2, oggetto: "Vetro rotto", categoria: "difetto_prodotto" }) },
          },
          {
            testo: "Tool inesistente",
            richiestaPerTars: "Fai qualcosa",
            entita: [],
            azione: { strumento: "cancella_tutto", input: "{}" },
          },
          {
            testo: "Input fuori schema",
            richiestaPerTars: "Crea un ticket",
            entita: ["commessa:2"],
            azione: { strumento: "crea_ticket", input: JSON.stringify({ oggetto: 12 }) },
          },
        ],
        domande: [],
      },
      f,
      "gpt-test"
    );
    expect(esito.proposte[0].azione).toMatchObject({ strumento: "crea_ticket" });
    expect(esito.proposte[1].azione).toBeNull();
    expect(esito.proposte[2].azione).toBeNull();
    expect(esito.avvertenze.join(" ")).toMatch(/2 azioni proposte non valide/);
  });
```

e nel describe «prompt» pretendere `analisi-v5` e la sezione azioni:

```ts
    expect(PROMPT_ANALISI_VERSIONE).toBe("analisi-v5");
    expect(PROMPT_ANALISI).toContain("crea_ticket");
    expect(PROMPT_ANALISI).toContain("solo se conosci TUTTI i parametri");
```

(aggiornare l'asserzione esistente `toBe("analisi-v4")`.)

Run: `pnpm vitest run server/tars/analisi/analisi.test.ts` — FAIL.

- [ ] **Step 2: tipi.** In `types.ts`: bump a `1.2.0`, aggiungere
`AzionePropostaAnalisi` e `EsecuzionePropostaAnalisi` (come sopra) e i due
campi su `PropostaAnalisi` (`azione: AzionePropostaAnalisi | null`,
`esecuzione?: EsecuzionePropostaAnalisi | null`).

- [ ] **Step 3: verifica.** In `analisi.ts`:
  - `import { descrittoreAzione } from "../azioni/registry";`
  - `export const STRUMENTI_PROPOSTE_ESEGUIBILI = ["crea_ticket", "pianifica_intervento", "crea_promemoria", "collega_comunicazione", "collega_fattura_commessa", "sposta_documento", "archivia_commessa", "transizione_adiacente_commessa"] as const;`
  - `schemaEsitoModello.proposte.items` += `azione: z.object({ strumento: z.string(), input: z.string().max(2000) }).nullable().default(null)`;
  - in `verificaEsito`, funzione locale:

```ts
  let azioniScartate = 0;
  const verificaAzione = (
    azione: { strumento: string; input: string } | null | undefined
  ): AzionePropostaAnalisi | null => {
    if (!azione) return null;
    const scarta = () => {
      azioniScartate += 1;
      return null;
    };
    if (!STRUMENTI_PROPOSTE_ESEGUIBILI.includes(azione.strumento as any)) return scarta();
    const descrittore = descrittoreAzione(azione.strumento);
    if (!descrittore) return scarta();
    let grezzo: unknown;
    try {
      grezzo = JSON.parse(azione.input);
    } catch {
      return scarta();
    }
    const valido = descrittore.strumento.schemaInput.safeParse(grezzo);
    if (!valido.success) return scarta();
    // Lo scavalco del gate non nasce MAI da una proposta.
    if ((grezzo as any)?.scavalcaGate) return scarta();
    return { strumento: azione.strumento, input: JSON.stringify(valido.data) };
  };
```

    usata nel map delle proposte (`azione: verificaAzione(p.azione)`), e in
    coda: `if (azioniScartate > 0) avvertenze.push(`${azioniScartate} azioni proposte non valide per il catalogo: restano come richieste in chat.`);`
  - `analisiDeterministica`: proposte restano `[]` (nessun cambiamento).

- [ ] **Step 4: prompt v5.** In `prompt.ts`:
  - versione `analisi-v5`;
  - `SCHEMA_JSON_ANALISI.properties.proposte.items`: `required` +=
    `"azione"`; `properties.azione = { anyOf: [ { type: "null" }, { type: "object", additionalProperties: false, required: ["strumento", "input"], properties: { strumento: { type: "string" }, input: { type: "string" } } } ] }`;
  - nel prompt, dopo la riga sulle proposte:

```
- azione: quando una proposta corrisponde ESATTAMENTE a uno di questi strumenti e conosci TUTTI i parametri dalla fotografia, compila azione con {strumento, input} dove input è una STRINGA JSON con i parametri; altrimenti azione = null e resta la richiesta in chat. Mai importi, mai scavalcaGate. Strumenti ammessi:
  - crea_ticket: input {"commessaId": <id>, "oggetto": "...", "categoria": "difetto_prodotto|montaggio|regolazione|altro"}
  - pianifica_intervento: input {"commessaId": <id>, "tipo": "rilievo|posa|assistenza", "quando": "domani alle 9"}
  - crea_promemoria: input {"testo": "...", "quando": "lunedì alle 10", "commessaId": <id opzionale>}
  - collega_comunicazione: input {"comunicazioneId": <id>, "commessaId": <id>}
  - collega_fattura_commessa: input {"ficId": <id>, "commessaId": <id>}
  - sposta_documento: input {"documentoId": <id>, "commessaId": <id destinazione>}
  - archivia_commessa: input {"commessaId": <id>}
  - transizione_adiacente_commessa: input {"commessaId": <id>, "nuovoStato": "<stato>"}
```

  NOTA esecutore: PRIMA di scrivere gli esempi, aprire gli `schemaInput`
  reali dei tool citati e correggere i nomi dei campi dell'esempio dove
  differiscono (es. `crea_promemoria` può chiamare i campi diversamente):
  gli esempi del prompt devono rispettare gli schemi veri, la verifica
  scarta ciò che non combacia.

- [ ] **Step 5: verde + commit.**

Run: `pnpm vitest run server/tars/analisi/analisi.test.ts && pnpm check`

```bash
git add server/tars/analisi/
git commit -m "feat(tars): le proposte dell'analisi portano un'azione verificata dal catalogo (T3, contratto)

azione {strumento, input JSON} nel JSON del modello; whitelist chiusa,
schemaInput e registro verificati server-side, scavalcaGate vietato,
scarti dichiarati in avvertenze. Prompt analisi-v5, versione 1.2.0.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: esecuzione col ledger R1 + persistenza dell'esito

**Files:**
- Modify: `server/tars/analisi/repository.ts` (+`aggiornaEsito`)
- Create: `server/tars/analisi/esecuzione.ts`
- Modify: `server/routers/tars.ts` (mutation `eseguiPropostaAnalisi`)
- Test: `server/tars/analisi/esecuzione.test.ts`

**Interfaces:**
- Produces:

```ts
// repository
aggiornaEsito(id: number, esito: EsitoAnalisiAzienda): Promise<void>;
// esecuzione.ts
export async function eseguiPropostaAnalisi(input: {
  contesto: ContestoRun;           // dell'utente che clicca
  record: RecordAnalisiAzienda;    // l'analisi corrente
  indice: number;
}): Promise<{ esecuzione: EsecuzionePropostaAnalisi; esito: EsitoAnalisiAzienda }>;
```

- Consumes: `descrittoreAzione`, `catalogoAzioniPerContesto` (policy),
  `prenotaEsecuzioneR1`/`concludiEsecuzioneR1`/`concludiEsecuzioneR1SenzaEffetto`/`segnaEsecuzioneR1Incerta`
  da `../azioni/executions` (stessa semantica del blocco per-tool
  dell'orchestratore, orchestratore.ts:890-970).

- [ ] **Step 1: test che falliscono** (`esecuzione.test.ts`): contesto
direzione via `costruisciContesto` (pattern di `scrittura.test.ts`),
repository memoria con `impostaRepositoryAnalisiPerTest`, flag
`FLAG_TARS`/`FLAG_TARS_L2_ACTIONS` accesi. Casi:
  1. proposta con `azione` `crea_ticket` su commessa creata al volo →
     `esecuzione.stato = "creato"`, ticket esistente nello store, esito
     dell'analisi aggiornato (`proposte[0].esecuzione` valorizzata);
  2. secondo click sulla stessa proposta → stessa esecuzione, NESSUN
     secondo ticket (idempotenza: runId deterministico + esecuzione già
     salvata);
  3. proposta senza `azione` → errore `PROPOSTA_NON_ESEGUIBILE`;
  4. utente senza capability (contesto squadra_posa, catalogo senza
     `crea_ticket`... squadra_posa HA ticket.create tramite SHARED — usare
     `collega_fattura_commessa` che esige `economia.read`) → errore
     FORBIDDEN e nessun effetto.

- [ ] **Step 2: repository.** `aggiornaEsito` in entrambe le
implementazioni (memoria: `Object.assign`; PG: `UPDATE tars_analisi_azienda
SET esito = ${sql.json(esito)} WHERE id = ${id}`).

- [ ] **Step 3: `esecuzione.ts`.** Percorso: valida indice/azione →
`descrittoreAzione` + whitelist → `catalogoAzioniPerContesto(contesto)`
contiene lo strumento (fail-closed) → `JSON.parse` + `schemaInput.parse`
→ `prenotaEsecuzioneR1({descrittore, contesto, runId:
`analisi:${record.id}:proposta:${indice}`, argomenti})` → se `riusa`
prendi l'esito dal ledger; se `esegui` chiama `strumento.esegui`, valida
con `schemaRisultato`, `concludi`/`SenzaEffetto` (catch →
`segnaEsecuzioneR1Incerta` e rilancio, come orchestratore) → costruisci
`EsecuzionePropostaAnalisi`, scrivila su `esito.proposte[indice].esecuzione`
e `repository.aggiornaEsito`. Se la proposta ha già `esecuzione`,
restituiscila senza rieseguire.

- [ ] **Step 4: mutation.** In `routers/tars.ts` accanto ad
`analisiAziendaRigenera`:

```ts
  eseguiPropostaAnalisi: procedura
    .input(z.object({ analisiId: z.number().int().positive(), indice: z.number().int().min(0).max(50) }))
    .mutation(async ({ input, ctx }) => { /* assicuraTars come analisiAzienda;
      contesto; direzione-only; record = repositoryAnalisiCorrente().ultima(sedeId);
      se record?.id !== input.analisiId → CONFLICT «l'analisi è cambiata: ricaricala»;
      eseguiPropostaAnalisi({contesto, record, indice}); ritorna
      { record: await conEntitaRisolte(recordAggiornato, sedeId), esecuzione } */ }),
```

- [ ] **Step 5: verde + commit** (messaggio: «feat(tars): il bottone
Esegui passa dal ledger R1 (T3, esecuzione)»).

---

### Task 3: UI — il bottone che fa la cosa

**Files:**
- Modify: `client/src/components/tars/TarsAnalisiAzienda.tsx`
- Modify: `client/src/components/tars/TarsProposteBoard.tsx` (se le
  proposte analisi passano di lì: verificare come vengono composte)
- Test: `client/src/lib/tarsPresentation.test.ts` o test del componente
  esistente (seguire il pattern dei test client presenti)

- [ ] **Step 1:** leggere i due componenti; dove oggi c'è «Chiedi a Tars»
  su una proposta con `azione`: bottone primario «Esegui» →
  `trpc.tars.eseguiPropostaAnalisi.useMutation` con `{analisiId, indice}`,
  `onSuccess` invalida `tars.analisiAzienda`; disabilitato in pending; se
  `proposta.esecuzione` → niente bottoni, chip «Fatto da Tars ·
  <stato>» (o il motivo se `non_eseguito`) e link «Registro». «Chiedi a
  Tars» resta per le proposte senza azione.
- [ ] **Step 2:** verificare in anteprima (`/tars?demoProposte` +
  1440/390 px, nessuno scroll orizzontale nuovo) e con i test client.
- [ ] **Step 3: commit** («feat(tars): Esegui sulla proposta, Chiedi a
  Tars solo dove serve (T3, UI)»).

---

### Task 4: matrice, docs, suite, push

- [ ] matrice: riga «proposta→azione» nella sezione guardrail (contratto
  e whitelist); tars-utile: T3 FATTO; suite+build; push su main;
  deployment SUCCESS.
