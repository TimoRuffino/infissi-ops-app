import RispostaFormattata from "@/components/tars/RispostaFormattata";
import { analizzaMarkdownOperativo } from "@/lib/markdownOperativo";
import {
  contieneRiferimenti,
  creaRisolutoreRiferimenti,
  indicizzaCommesse,
  spezzaRiferimenti,
  type FrammentoInline,
  type FrammentoRiferimento,
} from "@/lib/riferimentiTars";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function riassembla(frammenti: readonly FrammentoInline[]): string {
  return frammenti.map(frammento => frammento.testo).join("");
}

function riferimenti(testo: string): FrammentoRiferimento[] {
  return spezzaRiferimenti(testo).filter(
    (frammento): frammento is FrammentoRiferimento =>
      frammento.tipo === "riferimento"
  );
}

function chiavi(testo: string): string[] {
  return riferimenti(testo).map(frammento => frammento.chiave);
}

describe("riferimentiTars · riconoscimento", () => {
  it("non perde né riscrive un carattere del testo di partenza", () => {
    const corpus = [
      "",
      "Nessun riferimento qui dentro.",
      "Preparato — COM-2026-184 è la priorità di oggi.",
      "Ticket #37 e ticket #4 restano aperti, COM-2026-171 no.",
      "2 * 3 = 6, #12,5 metri, prezzo #12.5, codice ##37 e xCOM-2026-184.",
      "TK-0007 · TK-37 · COM 2026 84 · com_2026_184",
      "###",
      "#",
      "COM-",
    ];

    for (const sorgente of corpus) {
      expect(riassembla(spezzaRiferimenti(sorgente))).toBe(sorgente);
    }
  });

  it("riconosce il codice commessa nel formato generato dal server", () => {
    expect(chiavi("Vedi COM-2026-184 per il saldo.")).toEqual(["COM-2026-184"]);
    // Stessa normalizzazione degli estrattori server già in produzione.
    expect(chiavi("COM 2026 84")).toEqual(["COM-2026-084"]);
    expect(chiavi("com_2026_184")).toEqual(["COM-2026-184"]);
    expect(chiavi("COM-2026-1845")).toEqual(["COM-2026-1845"]);
  });

  it("mostra il codice esattamente come Tars l'ha scritto", () => {
    const [frammento] = riferimenti("Vedi COM 2026 84 in scheda.");
    expect(frammento.testo).toBe("COM 2026 84");
    expect(frammento.chiave).toBe("COM-2026-084");
  });

  it("scarta i candidati che non sono codici commessa", () => {
    // Dentro una parola: non è una citazione.
    expect(chiavi("xCOM-2026-184")).toEqual([]);
    expect(chiavi("COM-2026-184x")).toEqual([]);
    expect(chiavi("Non ho eseguito nulla: 2 * 3 azioni in attesa.")).toEqual([]);
  });

  it("continua la scansione dopo un candidato scartato", () => {
    expect(chiavi("xCOM-2026-184 ma COM-2026-171 sì")).toEqual([
      "COM-2026-171",
    ]);
  });

  it("segnala se un testo vale la pena di essere risolto", () => {
    expect(contieneRiferimenti("COM-2026-184")).toBe(true);
    expect(contieneRiferimenti("Nessun riferimento operativo.")).toBe(false);
  });
});

// I ticket sono citati eccome nelle risposte, ma non hanno una rotta di
// dettaglio: un link porterebbe alla coda `/ticket`, cioè a una lista da
// cercare a mano, e non al record che nomina. Finché non esiste
// `/ticket/:id` la citazione deve restare testo semplice, che almeno non
// promette niente.
describe("riferimentiTars · i ticket restano testo", () => {
  it("non riconosce nessuna delle forme con cui si cita un ticket", () => {
    for (const sorgente of [
      "ticket #37",
      "Chiudi #4 entro venerdì.",
      "#37",
      "TK-0037 è assegnato.",
      "TK-37",
    ]) {
      expect(riferimenti(sorgente)).toEqual([]);
      expect(contieneRiferimenti(sorgente)).toBe(false);
      expect(spezzaRiferimenti(sorgente)).toEqual([
        { tipo: "testo", testo: sorgente },
      ]);
    }
  });

  it("non collega il ticket nemmeno accanto a una commessa risolta", () => {
    const frammenti = spezzaRiferimenti("COM-2026-184, ticket #37 aperto");
    expect(frammenti.map(frammento => frammento.tipo)).toEqual([
      "riferimento",
      "testo",
    ]);
    expect(riassembla(frammenti)).toBe("COM-2026-184, ticket #37 aperto");
  });
});

describe("riferimentiTars · convivenza con il Markdown operativo", () => {
  const sorgente = [
    "**Preparato — oggi la priorità è il recupero crediti.**",
    "",
    "### 1. Critici",
    "",
    "- **Bocciardi Claudia — COM-2026-184**, da valutare: sollecito",
    "- Marra Giuseppe — COM-2026-171, saldo `4.200,00 €` scaduto",
    "",
    "1. Riaprire il ticket #37 di *Via Manzoni* per COM-2026-092",
    "2. Confermare la posa del 3 settembre",
    "",
    "---",
    "",
    "Non ho eseguito nulla: 2 * 3 azioni restano in attesa di conferma.",
  ].join("\n");

  it("lascia intatta la struttura dei blocchi", () => {
    const blocchi = analizzaMarkdownOperativo(sorgente);
    expect(blocchi.map(blocco => blocco.tipo)).toEqual([
      "paragrafo",
      "titolo",
      "elenco",
      "elenco",
      "separatore",
      "paragrafo",
    ]);
  });

  it("trova i codici dentro grassetto, elenchi e voci numerate", () => {
    const blocchi = analizzaMarkdownOperativo(sorgente);
    const trovati = blocchi.flatMap(blocco => {
      const segmenti =
        blocco.tipo === "elenco"
          ? blocco.voci.flatMap(voce => [...voce.contenuto])
          : blocco.tipo === "paragrafo"
            ? blocco.righe.flat()
            : blocco.tipo === "titolo"
              ? [...blocco.contenuto]
              : [];
      return segmenti.flatMap(segmento => chiavi(segmento.testo));
    });

    // Il primo è dentro un **grassetto**, il secondo in una voce puntata, il
    // terzo in una voce numerata accanto a un `#37` che resta testo.
    expect(trovati).toEqual(["COM-2026-184", "COM-2026-171", "COM-2026-092"]);
  });
});

describe("riferimentiTars · risoluzione", () => {
  const commesse = [
    { id: 12, codice: "COM-2026-184" },
    { id: 13, codice: "COM-2026-171" },
    { id: 14, codice: null },
  ];
  const risolvi = creaRisolutoreRiferimenti({ commesse });

  function risolviTesto(testo: string) {
    const [frammento] = riferimenti(testo);
    expect(frammento).toBeDefined();
    return risolvi(frammento);
  }

  it("collega la commessa alla sua scheda", () => {
    expect(risolviTesto("COM-2026-184")).toEqual({
      href: "/commesse/12",
      nomeAccessibile: "Apri la commessa COM-2026-184",
    });
  });

  it("non risolve un codice che non è nei dati leggibili", () => {
    // Codice inventato dal modello.
    expect(risolviTesto("COM-2026-999")).toBeNull();
    // Codice reale ma di un'altra sede: il server non lo manda, quindi non è
    // nell'indice e non può diventare un link.
    expect(risolviTesto("COM-2025-001")).toBeNull();
  });

  it("non risolve nulla quando i dati non sono ancora arrivati", () => {
    const vuoto = creaRisolutoreRiferimenti({});
    const [frammento] = riferimenti("COM-2026-184");
    expect(vuoto(frammento)).toBeNull();
  });

  it("non indicizza un codice ambiguo: meglio testo che il record sbagliato", () => {
    const indice = indicizzaCommesse([
      { id: 12, codice: "COM-2026-184" },
      { id: 99, codice: "COM 2026 184" },
    ]);
    expect(indice.get("COM-2026-184")).toBeNull();

    const ambiguo = creaRisolutoreRiferimenti({
      commesse: [
        { id: 12, codice: "COM-2026-184" },
        { id: 99, codice: "COM-2026-184" },
      ],
    });
    const [frammento] = riferimenti("COM-2026-184");
    expect(ambiguo(frammento)).toBeNull();
  });
});

describe("riferimentiTars · resa nella bolla di conversazione", () => {
  const testo = [
    "### Critici",
    "",
    "- **Bocciardi Claudia — COM-2026-184**, ticket #37 aperto",
    "- Codice inesistente COM-2026-999 e `COM-2026-184` a monospazio",
  ].join("\n");

  // Location statica: `Link` di wouter ha bisogno di un router, e in resa
  // statica basta un hook che dichiari dove ci si trova.
  const hook = (): [string, (to: string) => void] => ["/tars", () => undefined];
  const searchHook = () => "";

  function rendi(risolvi?: ReturnType<typeof creaRisolutoreRiferimenti>) {
    return renderToStaticMarkup(
      createElement(
        Router,
        { hook, searchHook },
        createElement(RispostaFormattata, {
          testo,
          risolviRiferimento: risolvi,
        })
      )
    );
  }

  const risolvi = creaRisolutoreRiferimenti({
    commesse: [{ id: 12, codice: "COM-2026-184" }],
  });

  it("senza risolutore lascia il testo esattamente com'era", () => {
    const markup = rendi();
    expect(markup).not.toContain("<a ");
    expect(markup).toContain(
      '<strong class="font-semibold text-text-1">Bocciardi Claudia — COM-2026-184</strong>'
    );
  });

  it("collega i codici risolti senza toccare la formattazione", () => {
    const markup = rendi(risolvi);

    // Il link vive dentro il grassetto e mostra il codice così com'era.
    expect(markup).toContain('href="/commesse/12"');
    expect(markup).toContain('aria-label="Apri la commessa COM-2026-184"');
    expect(markup).toMatch(
      /<strong class="font-semibold text-text-1">Bocciardi Claudia — <a[^>]*>COM-2026-184<\/a><\/strong>/
    );

    // Titolo ed elenco restano quello che erano.
    expect(markup).toContain("<h5");
    expect(markup).toContain("<ul");
    expect(markup).not.toContain("### Critici");
  });

  it("non porta da nessuna parte verso la coda ticket", () => {
    const markup = rendi(risolvi);
    expect(markup).not.toContain('href="/ticket"');
    expect(markup).toContain("ticket #37 aperto");
  });

  it("non collega un codice non risolto né il codice inline", () => {
    const markup = rendi(risolvi);
    expect(markup).not.toContain("COM-2026-999</a>");
    // `COM-2026-184` fra backtick resta letterale: il codice inline non
    // interpreta niente, per contratto del parser.
    expect(markup).toMatch(/<code[^>]*>COM-2026-184<\/code>/);
  });

  it("non introduce mai HTML costruito a mano", () => {
    expect(rendi(risolvi)).not.toContain("dangerouslySetInnerHTML");
  });

  it("dà al link un nome accessibile e un focus visibile", () => {
    const markup = rendi(risolvi);
    const link = markup.match(/<a[^>]*href="\/commesse\/12"[^>]*>/)?.[0];
    expect(link).toBeDefined();
    expect(link).toContain('aria-label="Apri la commessa COM-2026-184"');
    expect(link).toContain("focus-visible:ring-2");
    // Il nome accessibile non va duplicato in un tooltip nativo.
    expect(link).not.toContain("title=");
  });
});
