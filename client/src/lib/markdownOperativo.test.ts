import { describe, expect, it } from "vitest";

import {
  analizzaMarkdownOperativo,
  type BloccoOperativo,
  type SegmentoInline,
} from "./markdownOperativo";

function testoDiRiga(riga: readonly SegmentoInline[]): string {
  return riga.map(segmento => segmento.testo).join("");
}

// Riassembla il testo sorgente ignorando i soli marcatori consumati: serve a
// dimostrare che il parser non perde caratteri.
function riassembla(blocchi: readonly BloccoOperativo[]): string {
  return blocchi
    .map(blocco => {
      switch (blocco.tipo) {
        case "paragrafo":
          return blocco.righe.map(testoDiRiga).join("\n");
        case "titolo":
          return testoDiRiga(blocco.contenuto);
        case "elenco":
          return blocco.voci.map(voce => testoDiRiga(voce.contenuto)).join("\n");
        case "separatore":
          return "---";
      }
    })
    .join("\n\n");
}

function segmenti(blocchi: readonly BloccoOperativo[]): SegmentoInline[] {
  return blocchi.flatMap(blocco => {
    switch (blocco.tipo) {
      case "paragrafo":
        return blocco.righe.flat();
      case "titolo":
        return [...blocco.contenuto];
      case "elenco":
        return blocco.voci.flatMap(voce => [...voce.contenuto]);
      case "separatore":
        return [];
    }
  });
}

function unicoParagrafo(sorgente: string): SegmentoInline[] {
  const blocchi = analizzaMarkdownOperativo(sorgente);
  expect(blocchi).toHaveLength(1);
  const blocco = blocchi[0];
  if (blocco.tipo !== "paragrafo") throw new Error(`atteso paragrafo, ${blocco.tipo}`);
  expect(blocco.righe).toHaveLength(1);
  return [...blocco.righe[0]];
}

describe("markdownOperativo · struttura dei blocchi", () => {
  it("non produce blocchi per stringa vuota o solo spazi", () => {
    expect(analizzaMarkdownOperativo("")).toEqual([]);
    expect(analizzaMarkdownOperativo("   ")).toEqual([]);
    expect(analizzaMarkdownOperativo("\n\n  \t \n")).toEqual([]);
  });

  it("separa i paragrafi sulla riga vuota e conserva gli a-capo singoli", () => {
    const sorgente =
      "Oggi la priorità è la commessa Bocciardi.\nIl saldo non risulta incassato.\n\nSe confermi preparo il sollecito.";
    const blocchi = analizzaMarkdownOperativo(sorgente);

    expect(blocchi).toHaveLength(2);
    expect(blocchi[0]).toMatchObject({ tipo: "paragrafo" });
    if (blocchi[0].tipo !== "paragrafo") throw new Error("atteso paragrafo");
    expect(blocchi[0].righe).toHaveLength(2);
    expect(riassembla(blocchi)).toBe(sorgente);
  });

  it("lascia un testo senza sintassi markdown identico carattere per carattere", () => {
    const sorgente =
      "Preparato — oggi la priorità è la commessa di Bocciardi Claudia.\nHo confrontato scadenze, incassi e promemoria aperti (3).\n\nNon ho eseguito nulla: attendo conferma.";
    const blocchi = analizzaMarkdownOperativo(sorgente);

    expect(riassembla(blocchi)).toBe(sorgente);
    expect(segmenti(blocchi).every(s => s.tipo === "testo")).toBe(true);
  });

  it("normalizza i fine riga Windows senza inventare righe vuote", () => {
    const blocchi = analizzaMarkdownOperativo("Prima riga\r\nSeconda riga");
    expect(blocchi).toHaveLength(1);
    if (blocchi[0].tipo !== "paragrafo") throw new Error("atteso paragrafo");
    expect(blocchi[0].righe.map(testoDiRiga)).toEqual([
      "Prima riga",
      "Seconda riga",
    ]);
  });

  it("riconosce i titoli e li mappa su tre livelli visivi", () => {
    const blocchi = analizzaMarkdownOperativo(
      "# Sintesi\n## Dettaglio\n### 1. Critici\n#### Sotto sezione"
    );

    expect(blocchi.map(blocco => blocco.tipo)).toEqual([
      "titolo",
      "titolo",
      "titolo",
      "titolo",
    ]);
    expect(
      blocchi.map(blocco => (blocco.tipo === "titolo" ? blocco.livello : null))
    ).toEqual([1, 2, 3, 3]);
    expect(
      blocchi.map(blocco =>
        blocco.tipo === "titolo" ? testoDiRiga(blocco.contenuto) : null
      )
    ).toEqual(["Sintesi", "Dettaglio", "1. Critici", "Sotto sezione"]);
  });

  it("non tratta come titolo un cancelletto senza spazio", () => {
    const parti = unicoParagrafo("#COM-2026-184 resta aperta");
    expect(parti).toEqual([
      { tipo: "testo", testo: "#COM-2026-184 resta aperta" },
    ]);
  });

  it("riconosce il separatore orizzontale", () => {
    const blocchi = analizzaMarkdownOperativo("Sopra\n\n---\n\nSotto");
    expect(blocchi.map(blocco => blocco.tipo)).toEqual([
      "paragrafo",
      "separatore",
      "paragrafo",
    ]);
  });
});

describe("markdownOperativo · elenchi", () => {
  it("raggruppa le voci puntate con i tre marcatori ammessi", () => {
    const blocchi = analizzaMarkdownOperativo(
      "- Prima voce\n* Seconda voce\n• Terza voce"
    );

    expect(blocchi).toHaveLength(1);
    if (blocchi[0].tipo !== "elenco") throw new Error("atteso elenco");
    expect(blocchi[0].ordinato).toBe(false);
    expect(blocchi[0].voci.map(voce => testoDiRiga(voce.contenuto))).toEqual([
      "Prima voce",
      "Seconda voce",
      "Terza voce",
    ]);
    expect(blocchi[0].voci.every(voce => voce.numero === null)).toBe(true);
  });

  it("formatta il contenuto inline delle voci", () => {
    const blocchi = analizzaMarkdownOperativo(
      "- **Bocciardi Claudia — COM-2026-184**, da valutare: sollecito"
    );

    if (blocchi[0]?.tipo !== "elenco") throw new Error("atteso elenco");
    expect(blocchi[0].voci[0].contenuto).toEqual([
      { tipo: "forte", testo: "Bocciardi Claudia — COM-2026-184" },
      { tipo: "testo", testo: ", da valutare: sollecito" },
    ]);
  });

  it("conserva la numerazione dichiarata dall'elenco ordinato", () => {
    const blocchi = analizzaMarkdownOperativo(
      "1. Primo passo\n2. Secondo passo\n5. Quinto passo"
    );

    expect(blocchi).toHaveLength(1);
    if (blocchi[0].tipo !== "elenco") throw new Error("atteso elenco");
    expect(blocchi[0].ordinato).toBe(true);
    expect(blocchi[0].voci.map(voce => voce.numero)).toEqual([1, 2, 5]);
  });

  it("apre un nuovo blocco quando l'elenco cambia natura", () => {
    const blocchi = analizzaMarkdownOperativo(
      "- Puntata\n1. Numerata\nCoda di paragrafo"
    );

    expect(blocchi.map(blocco => blocco.tipo)).toEqual([
      "elenco",
      "elenco",
      "paragrafo",
    ]);
    expect(
      blocchi.map(blocco => (blocco.tipo === "elenco" ? blocco.ordinato : null))
    ).toEqual([false, true, null]);
  });

  it("non scambia per elenco un corsivo a inizio riga", () => {
    const parti = unicoParagrafo("*urgente* da richiamare");
    expect(parti).toEqual([
      { tipo: "enfasi", testo: "urgente" },
      { tipo: "testo", testo: " da richiamare" },
    ]);
  });
});

describe("markdownOperativo · formattazione inline", () => {
  it("riconosce grassetto, corsivo e codice inline", () => {
    expect(
      unicoParagrafo("**Preparato** — vedi *nota* e `COM-2026-184`.")
    ).toEqual([
      { tipo: "forte", testo: "Preparato" },
      { tipo: "testo", testo: " — vedi " },
      { tipo: "enfasi", testo: "nota" },
      { tipo: "testo", testo: " e " },
      { tipo: "codice", testo: "COM-2026-184" },
      { tipo: "testo", testo: "." },
    ]);
  });

  it("accetta anche il corsivo con underscore", () => {
    expect(unicoParagrafo("stato _da confermare_ oggi")).toEqual([
      { tipo: "testo", testo: "stato " },
      { tipo: "enfasi", testo: "da confermare" },
      { tipo: "testo", testo: " oggi" },
    ]);
  });

  it("unisce il testo letterale in un solo segmento", () => {
    expect(unicoParagrafo("solo testo semplice")).toEqual([
      { tipo: "testo", testo: "solo testo semplice" },
    ]);
  });
});

describe("markdownOperativo · robustezza", () => {
  const casiLetterali = [
    "2 * 3 = 6",
    "2 * 3 = 6 * 7",
    "**non chiuso",
    "***",
    "**",
    "*",
    "_",
    "chiave_valore_default",
    "sconto_2026 e saldo_finale",
    "costo 3 ` euro",
    "``",
    "a ** b ** c",
    "50% * IVA",
    "#",
    "###",
    "- ",
  ];

  it.each(casiLetterali)(
    "non altera né perde caratteri in «%s»",
    sorgente => {
      const blocchi = analizzaMarkdownOperativo(sorgente);
      expect(riassembla(blocchi)).toBe(sorgente);
    }
  );

  it("non genera mai segmenti vuoti", () => {
    const sorgenti = [
      ...casiLetterali,
      "**Preparato** — vedi *nota* e `COM-2026-184`.",
      "***grassetto***",
      "****",
      "`` ``",
      "# Titolo\n\n- voce **forte**\n\n---\n\n1. passo",
    ];

    for (const sorgente of sorgenti) {
      const vuoti = segmenti(analizzaMarkdownOperativo(sorgente)).filter(
        segmento => segmento.testo.length === 0
      );
      expect(vuoti, `segmenti vuoti in «${sorgente}»`).toEqual([]);
    }
  });

  it("non entra in loop né lancia su input degenerati", () => {
    const degenerati = [
      "*".repeat(200),
      "`".repeat(200),
      "_".repeat(200),
      "#".repeat(200),
      "-".repeat(200),
      "\n".repeat(200),
      "**a**".repeat(200),
    ];

    for (const sorgente of degenerati) {
      expect(() => analizzaMarkdownOperativo(sorgente)).not.toThrow();
    }
  });

  it("regge una risposta operativa completa di Tars", () => {
    const sorgente = [
      "**Preparato — oggi la priorità è il recupero crediti.**",
      "",
      "### 1. Critici",
      "",
      "- **Bocciardi Claudia — COM-2026-184**, da valutare: sollecito",
      "- **Marra Giuseppe — COM-2026-171**, saldo `4.200,00 €` scaduto",
      "",
      "### 2. Da seguire",
      "",
      "1. Richiamare il cantiere di *Via Manzoni*",
      "2. Confermare la posa del 3 settembre",
      "",
      "---",
      "",
      "Non ho eseguito nulla: 2 * 3 azioni restano in attesa di conferma.",
    ].join("\n");

    const blocchi = analizzaMarkdownOperativo(sorgente);

    expect(blocchi.map(blocco => blocco.tipo)).toEqual([
      "paragrafo",
      "titolo",
      "elenco",
      "titolo",
      "elenco",
      "separatore",
      "paragrafo",
    ]);
    expect(segmenti(blocchi).some(s => s.tipo === "codice")).toBe(true);
    expect(segmenti(blocchi).some(s => s.tipo === "enfasi")).toBe(true);
    expect(segmenti(blocchi).some(s => s.tipo === "forte")).toBe(true);
    expect(riassembla(blocchi).endsWith("2 * 3 azioni restano in attesa di conferma.")).toBe(true);
  });
});
