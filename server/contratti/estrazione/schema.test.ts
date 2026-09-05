// Test dello schema strict di estrazione (piano 3, Task 2). Verifica tre
// cose distinte:
//   1. zod rifiuta gli esiti fuori dai limiti (enum sconosciuti, numeri
//      fuori range, proprietà extra a qualunque livello, frammenti troppo
//      lunghi) e accetta un esito completo valido;
//   2. SCHEMA_JSON_ESTRAZIONE rispetta le regole strict della Responses
//      API (server/tars/openai/adapter.ts): ogni proprietà in `required`,
//      `additionalProperties: false` a ogni livello, anche dentro gli
//      array — verificato da `schemaStrictValido`, sia sullo schema vero
//      sia su una copia deliberatamente rotta;
//   3. zod e JSON Schema restano uno lo specchio dell'altro: stesse liste
//      enum, stesse chiavi richieste a ogni livello annidato.
//
// Nessun dato cliente: il fixture usa un nome generico e "Sarzana", la
// stessa città-campione già usata in server/contratti/repository.pg.test.ts.

import { describe, expect, it } from "vitest";
import {
  DETRAZIONI_MODELLO,
  MATERIALI,
  OSCURANTI_ABBINATI,
  SCHEMA_JSON_ESTRAZIONE,
  TIPI_PRODOTTO,
  schemaEsitoModello,
  schemaStrictValido,
  type EsitoModello,
} from "./schema";

/** Clona passando per JSON: ogni test parte da una copia indipendente del fixture. */
function clona(valore: unknown): any {
  return JSON.parse(JSON.stringify(valore));
}

const rigaValida: EsitoModello["righe"][number] = {
  descrizione: "Finestra 2 ante PVC bianco",
  tipoProdotto: "finestra",
  materiale: "pvc",
  nAnte: 2,
  quantita: 3,
  larghezzaMm: 1200,
  altezzaMm: 1400,
  prezzoTotale: 890.5,
  prezzoUnitario: 296.83,
  oscuranteAbbinato: "tapparella",
  lamelleOrientabili: false,
  accessori: ["maniglia bianca"],
  pagina: 2,
  frammento: "Finestra 2 ante PVC bianco 120x140 cm",
};

const esitoValido: EsitoModello = {
  righe: [rigaValida],
  pattuito: {
    totaleLordo: 12500,
    totaleImponibile: null,
    ivaDescrizione: "IVA 10%",
    pagina: 1,
    frammento: "Il prezzo pattuito è di € 12.500,00",
  },
  posa: {
    inclusa: true,
    prezzo: null,
    descrizione: "Posa in opera inclusa nel prezzo",
    pagina: 1,
    frammento: "posa in opera inclusa",
  },
  rate: [
    { quotaPct: 50, descrizione: "all'ordine", scadenza: null, pagina: 3, frammento: "50% all'ordine" },
    {
      quotaPct: 50,
      descrizione: "a saldo",
      scadenza: "fine lavori",
      pagina: 3,
      frammento: "50% a saldo lavori ultimati",
    },
  ],
  cantiere: {
    indirizzo: "Via Roma 1",
    comune: "Sarzana",
    provincia: "SP",
    piano: 2,
    pagina: 1,
    frammento: "cantiere sito in Via Roma 1, Sarzana (SP)",
  },
  cliente: {
    nome: "Mario Rossi",
    codiceFiscale: null,
    pagina: 1,
    frammento: "Committente: Mario Rossi",
  },
  dataDocumento: "2026-01-10",
  dataFirma: "2026-01-15",
  riferimento: "PREV-2026-0042",
  detrazione: "ristrutturazione",
  note: "",
};

describe("schemaEsitoModello — accetta il valido, rifiuta il resto", () => {
  it("accetta un esito completo e valido", () => {
    expect(schemaEsitoModello.safeParse(esitoValido).success).toBe(true);
  });

  it("rifiuta un tipoProdotto sconosciuto", () => {
    const grezzo = clona(esitoValido);
    grezzo.righe[0].tipoProdotto = "porta_garage";
    expect(schemaEsitoModello.safeParse(grezzo).success).toBe(false);
  });

  it("rifiuta un materiale sconosciuto", () => {
    const grezzo = clona(esitoValido);
    grezzo.righe[0].materiale = "titanio";
    expect(schemaEsitoModello.safeParse(grezzo).success).toBe(false);
  });

  it("rifiuta quantita 0", () => {
    const grezzo = clona(esitoValido);
    grezzo.righe[0].quantita = 0;
    expect(schemaEsitoModello.safeParse(grezzo).success).toBe(false);
  });

  it("rifiuta nAnte 5", () => {
    const grezzo = clona(esitoValido);
    grezzo.righe[0].nAnte = 5;
    expect(schemaEsitoModello.safeParse(grezzo).success).toBe(false);
  });

  it("rifiuta pagina 0", () => {
    const grezzo = clona(esitoValido);
    grezzo.righe[0].pagina = 0;
    expect(schemaEsitoModello.safeParse(grezzo).success).toBe(false);
  });

  it("rifiuta una proprietà extra in cima (oggetto strict)", () => {
    const grezzo = clona(esitoValido);
    grezzo.extra = true;
    expect(schemaEsitoModello.safeParse(grezzo).success).toBe(false);
  });

  it("rifiuta una proprietà extra dentro una riga (strict a ogni livello)", () => {
    const grezzo = clona(esitoValido);
    grezzo.righe[0].extra = true;
    expect(schemaEsitoModello.safeParse(grezzo).success).toBe(false);
  });

  it("rifiuta una proprietà extra dentro cantiere (strict a ogni livello)", () => {
    const grezzo = clona(esitoValido);
    grezzo.cantiere.extra = true;
    expect(schemaEsitoModello.safeParse(grezzo).success).toBe(false);
  });

  it("rifiuta un frammento oltre 300 caratteri", () => {
    const grezzo = clona(esitoValido);
    grezzo.righe[0].frammento = "x".repeat(301);
    expect(schemaEsitoModello.safeParse(grezzo).success).toBe(false);
  });

  it("larghezzaMm/altezzaMm: rifiuta fuori range, accetta null", () => {
    const fuoriRange = clona(esitoValido);
    fuoriRange.righe[0].larghezzaMm = 50;
    expect(schemaEsitoModello.safeParse(fuoriRange).success).toBe(false);

    const nullo = clona(esitoValido);
    nullo.righe[0].larghezzaMm = null;
    nullo.righe[0].altezzaMm = null;
    expect(schemaEsitoModello.safeParse(nullo).success).toBe(true);
  });

  it("prezzoTotale: rifiuta negativo, accetta null", () => {
    const negativo = clona(esitoValido);
    negativo.righe[0].prezzoTotale = -1;
    expect(schemaEsitoModello.safeParse(negativo).success).toBe(false);

    const nullo = clona(esitoValido);
    nullo.righe[0].prezzoTotale = null;
    expect(schemaEsitoModello.safeParse(nullo).success).toBe(true);
  });

  it("rifiuta più di 200 righe", () => {
    const grezzo = clona(esitoValido);
    grezzo.righe = Array.from({ length: 201 }, () => clona(rigaValida));
    expect(schemaEsitoModello.safeParse(grezzo).success).toBe(false);
  });

  it("rifiuta più di 12 rate", () => {
    const grezzo = clona(esitoValido);
    grezzo.rate = Array.from({ length: 13 }, (_, i) => ({
      quotaPct: 1,
      descrizione: `rata ${i}`,
      scadenza: null,
      pagina: 1,
      frammento: "rata",
    }));
    expect(schemaEsitoModello.safeParse(grezzo).success).toBe(false);
  });

  it("accessori: rifiuta più di 20 elementi o un elemento oltre 60 caratteri", () => {
    const troppi = clona(esitoValido);
    troppi.righe[0].accessori = Array.from({ length: 21 }, (_, i) => `accessorio ${i}`);
    expect(schemaEsitoModello.safeParse(troppi).success).toBe(false);

    const lungo = clona(esitoValido);
    lungo.righe[0].accessori = ["x".repeat(61)];
    expect(schemaEsitoModello.safeParse(lungo).success).toBe(false);
  });
});

describe("le liste enum sono l'unica fonte, per zod e per il JSON Schema", () => {
  it("TIPI_PRODOTTO coincide con l'enum del JSON", () => {
    const props = (SCHEMA_JSON_ESTRAZIONE as any).properties.righe.items.properties;
    expect(props.tipoProdotto.enum).toEqual([...TIPI_PRODOTTO]);
  });

  it("MATERIALI coincide con l'enum del JSON", () => {
    const props = (SCHEMA_JSON_ESTRAZIONE as any).properties.righe.items.properties;
    expect(props.materiale.enum).toEqual([...MATERIALI]);
  });

  it("OSCURANTI_ABBINATI coincide con l'enum del JSON", () => {
    const props = (SCHEMA_JSON_ESTRAZIONE as any).properties.righe.items.properties;
    expect(props.oscuranteAbbinato.enum).toEqual([...OSCURANTI_ABBINATI]);
  });

  it("DETRAZIONI_MODELLO coincide con l'enum del JSON", () => {
    const props = (SCHEMA_JSON_ESTRAZIONE as any).properties;
    expect(props.detrazione.enum).toEqual([...DETRAZIONI_MODELLO]);
  });
});

describe("SCHEMA_JSON_ESTRAZIONE è strict a ogni livello (Responses API)", () => {
  it("schemaStrictValido non trova violazioni sullo schema reale", () => {
    expect(schemaStrictValido(SCHEMA_JSON_ESTRAZIONE)).toEqual([]);
  });

  it("trova almeno una violazione se manca una proprietà da un required annidato", () => {
    const rotto = clona(SCHEMA_JSON_ESTRAZIONE);
    rotto.properties.righe.items.required = rotto.properties.righe.items.required.filter(
      (chiave: string) => chiave !== "descrizione"
    );
    expect(schemaStrictValido(rotto).length).toBeGreaterThan(0);
  });

  it("trova almeno una violazione se manca additionalProperties:false annidato", () => {
    const rotto = clona(SCHEMA_JSON_ESTRAZIONE);
    delete rotto.properties.pattuito.additionalProperties;
    expect(schemaStrictValido(rotto).length).toBeGreaterThan(0);
  });
});

describe("il JSON Schema e il tipo EsitoModello hanno le stesse chiavi", () => {
  it("ogni required annidato coincide con le chiavi del valore tipizzato corrispondente", () => {
    const schema = SCHEMA_JSON_ESTRAZIONE as any;
    const confronta = (required: string[], oggetto: object) => {
      expect([...required].sort()).toEqual(Object.keys(oggetto).sort());
    };
    confronta(schema.required, esitoValido);
    confronta(schema.properties.righe.items.required, esitoValido.righe[0]);
    confronta(schema.properties.pattuito.required, esitoValido.pattuito);
    confronta(schema.properties.posa.required, esitoValido.posa);
    confronta(schema.properties.rate.items.required, esitoValido.rate[0]);
    confronta(schema.properties.cantiere.required, esitoValido.cantiere);
    confronta(schema.properties.cliente.required, esitoValido.cliente);
  });
});
