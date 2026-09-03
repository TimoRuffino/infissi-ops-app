# T2 — La fotografia guarda dove si lavora: piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** la fotografia dell'analisi giornaliera smette di parlare di moduli
vuoti (ordini fornitore) e comincia a dire dove si lavora davvero:
preventivi fermi con età reale, gate documentali mancanti, fatture non
collegate o non incassate, comunicazioni senza risposta oltre 24 ore,
ticket senza assegnatario.

**Architecture:** `server/tars/analisi/fotografia.ts` costruisce la
fotografia deterministica da dipendenze iniettabili
(`DipendenzeFotografia`); il modello legge SOLO quel testo e la verifica
scarta ogni entità estranea. Si aggiungono tre dipendenze (fatture FiC,
gate documentale, ordini fornitore), tre sezioni nuove (preventivi, gate,
fatture), un filtro sui pattern calcolati su moduli vuoti e una sezione
«perimetro» che dichiara i moduli senza dati. Prompt bumpato ad
analisi-v4 con le regole nuove. Niente importi, come sempre.

**Tech Stack:** TypeScript, Vitest, dipendenze iniettate nei test (nessun
store reale nei test della fotografia).

**Spec:** `docs/superpowers/plans/2026-09-03-tars-utile.md` §4 T2. NOTA
D1 sospesa (03/09 sera): nessun lavoro sugli ordini — qui gli ordini
compaiono solo per DICHIARARE il modulo vuoto e tacere.

## Global Constraints

- La fotografia non contiene importi in euro (invariante esistente).
- Ogni fatto cita entità solo con riferimenti `tipo:id`; il testo usa nomi.
- Un errore in una fonte non azzera la fotografia (`tenta`).
- `VERSIONE_ANALISI_AZIENDA` → `1.1.0`.
- Ogni commit verde (`pnpm check` + test del modulo); suite completa al push.
- Commit in italiano, chiusi da `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: dipendenze nuove + sezioni preventivi/gate/fatture + perimetro

**Files:**
- Modify: `server/tars/analisi/fotografia.ts`
- Modify: `server/tars/analisi/types.ts` (bump versione)
- Test: `server/tars/analisi/analisi.test.ts`

**Interfaces:**
- Consumes: `ficFatture` (array store), `statoFattura(f, commesse)` da
  `server/routers/ficFatture.ts`; `statoHasRequiredDoc(commessaId, stato)`,
  `REQUIRED_DOC_TIPI_PER_STATO`, `DOC_TIPO_LABEL` da
  `server/routers/preventiviContratti.ts`; `getOrdiniFornitoriStore()` da
  `server/routers/fornitori.ts`.
- Produces: `DipendenzeFotografia` estesa con
  `fatture: () => any[]`,
  `statoFattura: (f: any) => string`,
  `gate: (commessaId: number, stato: string) => { ok: boolean; mancano: string[] }`,
  `ordini: () => any[]`;
  contatori nuovi `preventiviAttivi`, `preventiviFermi7`,
  `preventiviFermi30`, `gateMancanti`, `fattureNonCollegate`,
  `fattureDaRiconciliare`, `fattureAttesaIncasso`,
  `comunicazioniSenzaRisposta24h`, `ticketSenzaAssegnatario`; sezioni
  nuove `preventivi`, `gate`, `fatture`, `perimetro`.

- [ ] **Step 1: test che falliscono.** In `analisi.test.ts`, estendere
`depsFotografia` con le quattro dipendenze finte (dopo `attivita`):

```ts
    fatture: () => [
      { id: 900, sedeId: SEDE, numero: "12/B", data: "2026-08-20", clienteNome: "Bianchi Piero", commessaId: null, ignorata: false },
      { id: 901, sedeId: SEDE, numero: "13/B", data: "2026-08-21", clienteNome: "Verdi Luca", commessaId: 2, ignorata: false },
      { id: 902, sedeId: SEDE + 1, numero: "14/B", data: "2026-08-22", clienteNome: "Altra Sede", commessaId: null, ignorata: false },
    ],
    statoFattura: (f: any) => (f.id === 901 ? "da_riconciliare" : "attesa_incasso"),
    gate: (commessaId: number) =>
      commessaId === 2
        ? { ok: false, mancano: ["Ordine", "Conferma d'ordine"] }
        : { ok: true, mancano: [] },
    ordini: () => [],
```

e nel primo test (`legge solo la sede…`) aggiungere le asserzioni:

```ts
    expect(f.contatori).toMatchObject({
      preventiviAttivi: 1, preventiviFermi7: 0, preventiviFermi30: 0,
      gateMancanti: 1, fattureNonCollegate: 1, fattureDaRiconciliare: 1,
      fattureAttesaIncasso: 0, ticketSenzaAssegnatario: 1,
    });
    const gate = f.sezioni.find(s => s.chiave === "gate")!;
    expect(gate.fatti[0].testo).toContain("COM-2026-002");
    expect(gate.fatti[0].testo).toContain("Ordine");
    const fatture = f.sezioni.find(s => s.chiave === "fatture")!;
    expect(fatture.fatti.some(x => x.testo.includes("12/B"))).toBe(true);
    expect(testo).toContain("## Perimetro");
    expect(testo).toContain("Ordini fornitore: 0");
    // Il pattern «ritardi_fornitore» su modulo vuoto NON entra.
    expect(f.contatori.pattern).toBe(0);
    expect(testo).not.toContain("Ritardi fornitore");
```

e un test nuovo per i preventivi fermi (fixture dedicata):

```ts
  it("i preventivi fermi hanno una sezione con l'età reale; 7 e 30 giorni contati", async () => {
    const f = await costruisciFotografia({
      sedeId: SEDE, adesso: ADESSO,
      deps: depsFotografia({
        commesse: () => [
          { id: 51, sedeId: SEDE, codice: "COM-2026-051", cliente: "Soare", stato: "preventivo", updatedAt: giorniFa(1) },
          { id: 52, sedeId: SEDE, codice: "COM-2026-052", cliente: "Butticè", stato: "preventivo", updatedAt: giorniFa(1) },
          { id: 53, sedeId: SEDE, codice: "COM-2026-053", cliente: "Fresco", stato: "preventivo", updatedAt: giorniFa(1) },
          { id: 54, sedeId: SEDE, codice: "COM-2026-054", cliente: "Attiva", stato: "produzione", updatedAt: giorniFa(1) },
        ],
        attivita: (commessa: any) => ({
          giorni: commessa.id === 51 ? 35 : commessa.id === 52 ? 10 : commessa.id === 53 ? 2 : 40,
          fonte: "documento",
        }),
      }),
    });
    expect(f.contatori).toMatchObject({ preventiviAttivi: 3, preventiviFermi7: 2, preventiviFermi30: 1 });
    const sezione = f.sezioni.find(s => s.chiave === "preventivi")!;
    expect(sezione.fatti[0].testo).toContain("COM-2026-051");
    expect(sezione.fatti[0].testo).toContain("35 giorni");
    expect(sezione.fatti[0].testo).toContain("perso");
    expect(sezione.fatti[1].testo).toContain("da sollecitare");
    // La commessa 54 non è un preventivo: sta nella sezione «ferme», non qui.
    expect(sezione.fatti.some(x => x.entita.includes("commessa:54"))).toBe(false);
    const ferme = f.sezioni.find(s => s.chiave === "commesse")!.fatti;
    expect(ferme.some(x => x.chiave === "commessa:54:ferma")).toBe(true);
    expect(ferme.some(x => x.chiave === "commessa:51:ferma")).toBe(false);
  });
```

Run: `pnpm vitest run server/tars/analisi/analisi.test.ts`
Expected: FAIL — le dipendenze nuove non esistono nel tipo, le sezioni non
vengono prodotte (errore TypeScript sul tipo del parametro o asserzioni rosse).

- [ ] **Step 2: implementazione in `fotografia.ts`.**
  1. Import nuovi: `ficFatture`, `statoFattura` da `../../routers/ficFatture`;
     `statoHasRequiredDoc`, `REQUIRED_DOC_TIPI_PER_STATO`, `DOC_TIPO_LABEL`
     da `../../routers/preventiviContratti`; `getOrdiniFornitoriStore` da
     `../../routers/fornitori`; `getCommesseStore` già importato.
  2. Costanti: `PREVENTIVI_MASSIMI = 10`, `GATE_MASSIMI = 8`,
     `FATTURE_MASSIME = 5`.
  3. `DipendenzeFotografia` += le quattro chiavi (come nelle Interfaces).
  4. `dipendenzeFotografiaReali()` +=:

```ts
    fatture: () => ficFatture as any[],
    statoFattura: f => statoFattura(f, getCommesseStore() as any[]).stato,
    gate: (commessaId, stato) => ({
      ok: statoHasRequiredDoc(commessaId, stato),
      mancano: (REQUIRED_DOC_TIPI_PER_STATO[stato] ?? []).map(t => DOC_TIPO_LABEL[t]),
    }),
    ordini: () => getOrdiniFornitoriStore() as any[],
```

  5. Nel corpo di `costruisciFotografia`, dopo la sezione `commesse`
     (che ora ESCLUDE i preventivi dalle «ferme»: aggiungere
     `.filter(c => c.stato !== "preventivo")` in testa alla costruzione di
     `ferme`), inserire le sezioni:

```ts
  // 1-bis. Preventivi: il collo di bottiglia commerciale (D3: 7 giorni
  // sollecito, 30 perso). Età = attività reale, non updatedAt.
  const preventivi = commesse.filter(c => c.stato === "preventivo");
  const preventiviFermi = preventivi
    .map(c => ({ c, giorni: giorniFermi(c.id) }))
    .filter(x => x.giorni >= 7 && x.giorni <= giorniDormiente())
    .sort((a, b) => b.giorni - a.giorni);
  contatori.preventiviAttivi = preventivi.length;
  contatori.preventiviFermi7 = preventiviFermi.length;
  contatori.preventiviFermi30 = preventiviFermi.filter(x => x.giorni >= 30).length;
  sezioni.push({
    chiave: "preventivi",
    titolo: "Preventivi fermi (sollecito a 7 giorni, perso a 30)",
    fatti: preventiviFermi.slice(0, PREVENTIVI_MASSIMI).map(({ c, giorni }) => ({
      chiave: `commessa:${c.id}:preventivo_fermo`,
      testo: `${etichettaCommessa(c)}: preventivo senza fatti nuovi da ${giorni} giorni${
        giorni >= 30 ? " — da proporre come perso" : " — da sollecitare"
      }.`,
      entita: [`commessa:${c.id}`],
      link: `/commesse/${c.id}`,
    })),
  });

  // 1-ter. Gate documentali mancanti sulle commesse vive: il documento che
  // blocca il passo successivo. Le più attive prima: è lì che si lavora.
  const gateMancanti = commesse
    .map(c => ({ c, giorni: giorniFermi(c.id), gate: deps.gate(c.id, c.stato) }))
    .filter(x => x.giorni <= giorniDormiente() && !x.gate.ok);
  contatori.gateMancanti = gateMancanti.length;
  sezioni.push({
    chiave: "gate",
    titolo: "Gate documentali mancanti (il documento che blocca l'avanzamento)",
    fatti: [...gateMancanti]
      .sort((a, b) => a.giorni - b.giorni)
      .slice(0, GATE_MASSIMI)
      .map(({ c, gate }) => ({
        chiave: `commessa:${c.id}:gate`,
        testo: `${etichettaCommessa(c)}: in «${c.stato}» manca il documento del gate (serve: ${gate.mancano.join(" o ") || "documento di fase"}).`,
        entita: [`commessa:${c.id}`],
        link: `/commesse/${c.id}`,
      })),
  });

  // 1-quater. Fatture FiC: non collegate o incassate ma non a registro.
  // Mai importi. «attesa_incasso» è il corso normale: solo contatore.
  const fatture = deps.fatture().filter(f => f.sedeId === sedeId);
  const fattureNonCollegate = fatture.filter(f => f.commessaId == null && !f.ignorata);
  const statiFatture = fatture
    .filter(f => f.commessaId != null && !f.ignorata)
    .map(f => deps.statoFattura(f));
  contatori.fattureNonCollegate = fattureNonCollegate.length;
  contatori.fattureDaRiconciliare = statiFatture.filter(s => s === "da_riconciliare").length;
  contatori.fattureAttesaIncasso = statiFatture.filter(s => s === "attesa_incasso").length;
  const fattiFatture: FattoAnalisi[] = fattureNonCollegate
    .slice(0, FATTURE_MASSIME)
    .map(f => ({
      chiave: `fattura:${f.id}:non_collegata`,
      testo: `Fattura n. ${f.numero} del ${f.data} — ${f.clienteNome}: non collegata a nessuna commessa.`,
      entita: [`fattura:${f.id}`],
      link: "/economia",
    }));
  if (contatori.fattureDaRiconciliare > 0) {
    fattiFatture.push({
      chiave: "fatture:da_riconciliare",
      testo: `${contatori.fattureDaRiconciliare} fatture risultano incassate ma senza gli incassi a registro sulla commessa.`,
      entita: [],
      link: "/economia",
    });
  }
  sezioni.push({ chiave: "fatture", titolo: "Fatture (FiC)", fatti: fattiFatture });
```

  6. Sezione comunicazioni: dentro il ramo `if (smistamento)` aggiungere:

```ts
    const senzaRisposta24h = (smistamento.daRispondere ?? []).filter((v: any) => {
      const t = new Date(v.ricevutaIl ?? 0).getTime();
      return Number.isFinite(t) && t > 0 && adesso.getTime() - t >= 86_400_000;
    });
    contatori.comunicazioniSenzaRisposta24h = senzaRisposta24h.length;
    if (senzaRisposta24h.length > 0) {
      fattiComunicazioni.push({
        chiave: "comunicazioni:senza_risposta_24h",
        testo: `${senzaRisposta24h.length} comunicazioni attendono una risposta da oltre 24 ore.`,
        entita: senzaRisposta24h.slice(0, 5).map((v: any) => `comunicazione:${v.comunicazioneId}`),
        link: "/messaggi/email",
      });
    }
```

  7. Ticket: `contatori.ticketSenzaAssegnatario = ticket.filter(t => t.assegnatoA == null).length;`
  8. Pattern su moduli vuoti: prima della sezione pattern calcolare
     `const ordiniSede = deps.ordini().filter((o: any) => (o.sedeId ?? sedeId) === sedeId);`
     e filtrare `const listaPattern = (pattern?.pattern ?? []).filter(p => ordiniSede.length > 0 || p.chiave !== "ritardi_fornitore");`
  9. Sezione perimetro, in coda (prima del `return`):

```ts
  // 9. Perimetro: i moduli senza dati esistono nel CRM ma non in questa
  // azienda. Dichiararli evita al modello di inventarci sopra rischi
  // (03/09: «ritardi fornitore» citati con zero ordini a sistema).
  const moduliVuoti: string[] = [];
  if (ordiniSede.length === 0) moduliVuoti.push("Ordini fornitore: 0 record");
  sezioni.push({
    chiave: "perimetro",
    titolo: "Perimetro (moduli senza dati: non trarne conclusioni)",
    fatti:
      moduliVuoti.length > 0
        ? [{
            chiave: "perimetro:moduli_vuoti",
            testo: `Moduli non usati in questa azienda: ${moduliVuoti.join("; ")}. Nessuna analisi o proposta deve riguardarli.`,
            entita: [],
            link: null,
          }]
        : [],
  });
```

  10. Titolo dormienti: sostituire il testo fisso «oltre 120 giorni» con
      `` `Commesse dormienti (ferme da oltre ${giorniDormiente()} giorni): niente lavoro da proporre, al più archiviarle in blocco` ``.
  11. In `types.ts`: `VERSIONE_ANALISI_AZIENDA = "1.1.0"`.

- [ ] **Step 3: verifica.**

Run: `pnpm vitest run server/tars/analisi/analisi.test.ts && pnpm check`
Expected: PASS. Se il primo test rompe su `pattern: 1` → giusto così: il
fixture ha ordini vuoti e il pattern «ritardi_fornitore» ora sparisce
(l'asserzione aggiornata al punto 1 lo pretende).

- [ ] **Step 4: commit.**

```bash
git add server/tars/analisi/fotografia.ts server/tars/analisi/types.ts server/tars/analisi/analisi.test.ts
git commit -m "feat(tars): la fotografia guarda dove si lavora (T2)

Dentro: preventivi fermi con età reale (7/30 giorni, D3), gate
documentali mancanti sulle commesse vive, fatture non collegate o
incassate ma non a registro, comunicazioni senza risposta oltre 24 ore,
ticket senza assegnatario. Fuori: i pattern calcolati su moduli vuoti
(ritardi fornitore con zero ordini) e una sezione Perimetro dichiara i
moduli non usati. Versione analisi 1.1.0.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: prompt analisi-v4 (le regole per le sezioni nuove)

**Files:**
- Modify: `server/tars/analisi/prompt.ts`
- Test: `server/tars/analisi/analisi.test.ts` (asserzione sul prompt)

**Interfaces:**
- Consumes: le sezioni prodotte dal Task 1.
- Produces: `PROMPT_ANALISI_VERSIONE = "analisi-v4"`; regole nuove nel testo.

- [ ] **Step 1: test.** In `analisi.test.ts` aggiungere:

```ts
import { PROMPT_ANALISI, PROMPT_ANALISI_VERSIONE } from "./prompt";

describe("prompt", () => {
  it("analisi-v4: perimetro vietato, preventivi e gate spiegati", () => {
    expect(PROMPT_ANALISI_VERSIONE).toBe("analisi-v4");
    expect(PROMPT_ANALISI).toContain("Perimetro");
    expect(PROMPT_ANALISI).toContain("Preventivi fermi");
    expect(PROMPT_ANALISI).toMatch(/gate/i);
  });
});
```

Run: `pnpm vitest run server/tars/analisi/analisi.test.ts`
Expected: FAIL (versione ancora v3).

- [ ] **Step 2: implementazione.** In `prompt.ts`:
  - `PROMPT_ANALISI_VERSIONE = "analisi-v4"`;
  - nel testo del prompt, dopo la regola sulle dormienti, aggiungere:

```
- La sezione «Perimetro» elenca i moduli SENZA dati (es. ordini fornitore a zero): su quei temi non scrivere niente — nessun rischio, nessuna proposta, nessuna menzione.
- «Preventivi fermi» è il collo di bottiglia commerciale: a 7 giorni di silenzio si sollecita, a 30 si propone di chiudere come perso. Le proposte più utili nascono qui e dai «Gate documentali mancanti» (il documento che blocca l'avanzamento di una commessa).
- Le fatture non collegate o incassate ma non a registro sono lavoro amministrativo concreto: citale per numero e cliente, mai con importi.
```

- [ ] **Step 3: verifica e commit.**

Run: `pnpm vitest run server/tars/analisi/analisi.test.ts && pnpm check`
Expected: PASS.

```bash
git add server/tars/analisi/prompt.ts server/tars/analisi/analisi.test.ts
git commit -m "feat(tars): prompt analisi-v4 — perimetro vietato, preventivi e gate al centro

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: suite, docs, push

- [ ] **Step 1:** `pnpm check && pnpm test && pnpm build` — tutto verde.
- [ ] **Step 2:** aggiornare `docs/superpowers/plans/2026-09-03-tars-utile.md`:
  titolo T2 → `### T2 — La fotografia guarda dove si lavora — FATTO il 03/09/2026`.
- [ ] **Step 3:** commit docs + push fast-forward su main
  (`git push origin HEAD:main` dopo `git fetch` e
  `git merge-base --is-ancestor origin/main HEAD`), poi
  `railway deployment list` fino a SUCCESS.
