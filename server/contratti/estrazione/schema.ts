// Schema strict per la lettura del contratto (piano 3, Task 2): la forma
// ESATTA in cui il modello deve rispondere (Responses API, `text.format`
// con `strict: true` — vedi server/tars/openai/adapter.ts ~163-174).
// Stesso stile di server/tars/smistamento/analisi.ts: zod è l'autorità
// (ogni oggetto `.strict()`, ogni limite di validazione vive qui);
// SCHEMA_JSON_ESTRAZIONE è la sua proiezione in JSON Schema per il
// provider, mai il contrario. Le regole strict non negoziabili sono
// quelle dell'adapter: ogni proprietà di ogni oggetto in `required`,
// `additionalProperties: false` a ogni livello oggetto (anche dentro gli
// array), i campi opzionali espressi come union con `null`
// (`["string","null"]` / `["number","null"]` / `["integer","null"]`).
//
// Le quattro liste di enum sotto sono la SINGOLA fonte per entrambe le
// rappresentazioni: un valore nuovo si aggiunge solo qui, mai a mano nel
// JSON Schema (che le legge da qui) né duplicato nello zod (idem).
//
// Questo file NON sa nulla della forma finale della proposta
// (PropostaContratto, in shared/contratti/estrazione.ts): EsitoModello è
// il grezzo del modello, un vocabolario più fine (TipoProdotto/Materiale)
// di quello del CRM (CategoriaRiga). La traduzione fra i due vocabolari e
// la verifica dei candidati (come fa server/tars/smistamento/analisi.ts
// con i collegamenti) sono lavoro dei task successivi, non di questo.

import { z } from "zod";

export const TIPI_PRODOTTO = [
  "finestra",
  "portafinestra",
  "scorrevole",
  "fisso",
  "cassonetto",
  "tapparella",
  "persiana",
  "scuro",
  "zanzariera",
  "tenda",
  "pergola",
  "porta_blindata",
  "portoncino",
  "porta_interna",
  "controtelaio",
  "accessorio",
  "servizio",
  "altro",
] as const;
export type TipoProdotto = (typeof TIPI_PRODOTTO)[number];

export const MATERIALI = ["pvc", "alluminio", "legno", "legno_alluminio", "acciaio", "altro", "sconosciuto"] as const;
export type Materiale = (typeof MATERIALI)[number];

/** Oscurante abbinato secondo il modello: "nessuno" quando la riga non ne cita uno. */
export const OSCURANTI_ABBINATI = ["nessuno", "tapparella", "persiana", "scuro"] as const;
export type OscuranteAbbinato = (typeof OSCURANTI_ABBINATI)[number];

/** Detrazione fiscale come la legge il modello: "non_indicata" quando il testo non ne parla. */
export const DETRAZIONI_MODELLO = ["non_indicata", "ecobonus", "ristrutturazione"] as const;
export type DetrazioneModello = (typeof DETRAZIONI_MODELLO)[number];

// Ogni gruppo di fatti (riga, pattuito, posa, rata, cantiere, cliente)
// porta la propria evidenza: pagina del PDF e frammento di testo citato,
// anche quando i valori del gruppo sono null (il modello cita comunque
// dove ha guardato). Stessa coppia di server/contratti/servizio.ts
// (`evidenza: { pagina, frammento }`): pagina intera da 1, frammento fino
// a 300 caratteri, nessun limite inferiore (una citazione corta è lecita).
// Prova dal vivo del 05/09/2026 (tre contratti WnD veri): con lo schema
// strict il modello, quando un gruppo non ha una fonte (cantiere assente),
// risponde `pagina: 0` invece di inventare una pagina — e `min(1)` buttava
// via l'intera lettura. Lo 0 vale «nessuna evidenza»: `verificaEvidenza`
// lo tratta come pagina inesistente (campo da verificare), il resto passa.
const pagina = z.number().int().min(0);
const frammento = z.string().max(300);

const rigaEsitoSchema = z
  .object({
    // Stesso limite di rigaInputSchema.descrizione in server/contratti/servizio.ts.
    descrizione: z.string().trim().min(1).max(300),
    tipoProdotto: z.enum(TIPI_PRODOTTO),
    materiale: z.enum(MATERIALI),
    // Numero di ante (0 = es. un fisso): 0–4, come da capitolato.
    nAnte: z.number().int().min(0).max(4),
    // Stesso limite di rigaInputSchema.quantita.
    quantita: z.number().int().min(1).max(999),
    // Stesso limite di rigaInputSchema.larghezzaMm/altezzaMm.
    larghezzaMm: z.number().int().min(100).max(6000).nullable(),
    altezzaMm: z.number().int().min(100).max(6000).nullable(),
    // Importi in EURO (non centesimi): il modello legge il documento così
    // com'è scritto, la conversione in centesimi è del servizio a valle.
    prezzoTotale: z.number().min(0).nullable(),
    prezzoUnitario: z.number().min(0).nullable(),
    oscuranteAbbinato: z.enum(OSCURANTI_ABBINATI),
    lamelleOrientabili: z.boolean(),
    accessori: z.array(z.string().trim().max(60)).max(20),
    pagina,
    frammento,
  })
  .strict();

const pattuitoEsitoSchema = z
  .object({
    totaleLordo: z.number().min(0).nullable(),
    totaleImponibile: z.number().min(0).nullable(),
    ivaDescrizione: z.string().trim().nullable(),
    pagina,
    frammento,
  })
  .strict();

const posaEsitoSchema = z
  .object({
    inclusa: z.boolean(),
    prezzo: z.number().min(0).nullable(),
    descrizione: z.string().trim().nullable(),
    pagina,
    frammento,
  })
  .strict();

const rataEsitoSchema = z
  .object({
    // Stesso limite di quotaPct in server/contratti/servizio.ts e server/routers/fatture.ts.
    quotaPct: z.number().min(0).max(100),
    // Non nullable (a differenza della rata finale): il modello descrive
    // sempre la scadenza che ha letto. Stesso max di contrattoInputSchema.rate.descrizione.
    descrizione: z.string().trim().max(120),
    // Testo libero ("60 giorni dalla firma", "fine lavori"): la
    // normalizzazione a data/giorni è del servizio a valle, non di qui.
    scadenza: z.string().trim().nullable(),
    pagina,
    frammento,
  })
  .strict();

const cantiereEsitoSchema = z
  .object({
    indirizzo: z.string().trim().nullable(),
    // Stesso limite di comuneCantiere in server/contratti/servizio.ts.
    comune: z.string().trim().max(120).nullable(),
    provincia: z.string().trim().nullable(),
    // Stesso limite di piano in server/contratti/servizio.ts.
    piano: z.number().int().min(-2).max(60).nullable(),
    pagina,
    frammento,
  })
  .strict();

const clienteEsitoSchema = z
  .object({
    nome: z.string().trim().nullable(),
    codiceFiscale: z.string().trim().nullable(),
    pagina,
    frammento,
  })
  .strict();

/**
 * Esito grezzo del modello (Responses API, `SCHEMA_JSON_ESTRAZIONE`).
 * `.strict()` a ogni livello: una proprietà in più fa fallire il parse
 * tanto quanto un enum o un range fuori norma.
 */
export const schemaEsitoModello = z
  .object({
    righe: z.array(rigaEsitoSchema).max(200),
    pattuito: pattuitoEsitoSchema,
    posa: posaEsitoSchema,
    rate: z.array(rataEsitoSchema).max(12),
    cantiere: cantiereEsitoSchema,
    cliente: clienteEsitoSchema,
    dataDocumento: z.string().trim().nullable(),
    dataFirma: z.string().trim().nullable(),
    riferimento: z.string().trim().nullable(),
    detrazione: z.enum(DETRAZIONI_MODELLO),
    note: z.string().trim(),
  })
  .strict();

export type EsitoModello = z.infer<typeof schemaEsitoModello>;

/** Oggetto JSON Schema strict: required = tutte le chiavi di `properties`, sempre. */
function oggettoStrict(properties: Record<string, unknown>): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}

const evidenzaProprieta = {
  pagina: { type: "integer" },
  frammento: { type: "string" },
};

/**
 * JSON Schema strict (Responses API) speculare a `schemaEsitoModello`:
 * ogni proprietà in `required`, `additionalProperties: false` a ogni
 * livello oggetto, nullable come union di tipo. I limiti numerici e di
 * lunghezza (range, max) restano solo in zod: qui conta la FORMA, zod
 * resta l'unica autorità di validazione (vedi CLAUDE.md).
 */
export const SCHEMA_JSON_ESTRAZIONE: Record<string, unknown> = oggettoStrict({
  righe: {
    type: "array",
    items: oggettoStrict({
      descrizione: { type: "string" },
      tipoProdotto: { type: "string", enum: [...TIPI_PRODOTTO] },
      materiale: { type: "string", enum: [...MATERIALI] },
      nAnte: { type: "integer" },
      quantita: { type: "integer" },
      larghezzaMm: { type: ["integer", "null"] },
      altezzaMm: { type: ["integer", "null"] },
      prezzoTotale: { type: ["number", "null"] },
      prezzoUnitario: { type: ["number", "null"] },
      oscuranteAbbinato: { type: "string", enum: [...OSCURANTI_ABBINATI] },
      lamelleOrientabili: { type: "boolean" },
      accessori: { type: "array", items: { type: "string" } },
      ...evidenzaProprieta,
    }),
  },
  pattuito: oggettoStrict({
    totaleLordo: { type: ["number", "null"] },
    totaleImponibile: { type: ["number", "null"] },
    ivaDescrizione: { type: ["string", "null"] },
    ...evidenzaProprieta,
  }),
  posa: oggettoStrict({
    inclusa: { type: "boolean" },
    prezzo: { type: ["number", "null"] },
    descrizione: { type: ["string", "null"] },
    ...evidenzaProprieta,
  }),
  rate: {
    type: "array",
    items: oggettoStrict({
      quotaPct: { type: "number" },
      descrizione: { type: "string" },
      scadenza: { type: ["string", "null"] },
      ...evidenzaProprieta,
    }),
  },
  cantiere: oggettoStrict({
    indirizzo: { type: ["string", "null"] },
    comune: { type: ["string", "null"] },
    provincia: { type: ["string", "null"] },
    piano: { type: ["integer", "null"] },
    ...evidenzaProprieta,
  }),
  cliente: oggettoStrict({
    nome: { type: ["string", "null"] },
    codiceFiscale: { type: ["string", "null"] },
    ...evidenzaProprieta,
  }),
  dataDocumento: { type: ["string", "null"] },
  dataFirma: { type: ["string", "null"] },
  riferimento: { type: ["string", "null"] },
  detrazione: { type: "string", enum: [...DETRAZIONI_MODELLO] },
  note: { type: "string" },
});

/**
 * Ricorsione della verifica: cammina dentro `properties` e dentro `items`
 * degli array, cosicché anche gli oggetti annidati nelle liste (righe,
 * rate) siano controllati allo stesso modo del livello radice.
 */
function violazioniStrict(schema: unknown, percorso: string): string[] {
  if (schema === null || typeof schema !== "object") return [];
  const nodo = schema as Record<string, unknown>;
  const violazioni: string[] = [];

  if (nodo.type === "object") {
    const properties =
      nodo.properties && typeof nodo.properties === "object" ? (nodo.properties as Record<string, unknown>) : {};
    const required = Array.isArray(nodo.required) ? (nodo.required as unknown[]) : [];

    if (nodo.additionalProperties !== false) {
      violazioni.push(`${percorso}: additionalProperties deve essere false`);
    }
    for (const chiave of Object.keys(properties)) {
      if (!required.includes(chiave)) {
        violazioni.push(`${percorso}.${chiave}: assente da required`);
      }
    }
    for (const chiave of required) {
      if (typeof chiave === "string" && !(chiave in properties)) {
        violazioni.push(`${percorso}.${chiave}: in required ma assente da properties`);
      }
    }
    for (const [chiave, valore] of Object.entries(properties)) {
      violazioni.push(...violazioniStrict(valore, `${percorso}.${chiave}`));
    }
  }

  if (nodo.type === "array" && nodo.items != null) {
    violazioni.push(...violazioniStrict(nodo.items, `${percorso}[]`));
  }

  return violazioni;
}

/**
 * Violazioni delle regole strict della Responses API in uno JSON Schema:
 * una proprietà assente da `required` a qualunque livello (anche dentro
 * gli array), oppure un oggetto senza `additionalProperties: false`.
 * Vuoto = conforme. Usata dal test e, in futuro, da chi assembla nuovi
 * schemi per il provider (nessuna verifica manuale a occhio).
 */
export function schemaStrictValido(schema: unknown): string[] {
  return violazioniStrict(schema, "schema");
}
