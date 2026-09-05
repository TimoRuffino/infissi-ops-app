// Chiamata governata al modello per la lettura del contratto (piano 3,
// Task 3): costruisce l'input a partire dalle pagine di testo estratte
// dal PDF, chiama il provider con output strutturato strict e valida la
// risposta con lo schema di server/contratti/estrazione/schema.ts. Stesso
// disegno di server/tars/smistamento/analisi.ts (analizzaConModello):
// nessuna tool call attesa, JSON.parse + safeParse come unica autorità,
// mai un esito inventato quando la risposta non torna valida.

import type { RichiestaProvider, TarsProvider } from "../../tars/provider";
import { PROMPT_ESTRAZIONE_CONTRATTO, PROMPT_ESTRAZIONE_VERSIONE } from "./prompt";
import { SCHEMA_JSON_ESTRAZIONE, schemaEsitoModello, type EsitoModello } from "./schema";

export const MODELLO_ESTRAZIONE_DEFAULT = "gpt-5.6-terra";

export function modelloEstrazione(): string {
  return process.env.TARS_MODEL_ESTRAZIONE_CONTRATTO?.trim() || MODELLO_ESTRAZIONE_DEFAULT;
}

/** Caratteri di testo del documento ammessi nel prompt (intestazione esclusa). */
export const TESTO_MASSIMO_TOTALE = 40_000;

export type ContestoEstrazione = {
  clienteCommessa: string | null;
  codiceCommessa: string;
};

/**
 * P3-R38: i marcatori delimitano le pagine, quindi un documento che li
 * contiene potrebbe fingerne una che non esiste. Le due sequenze si
 * sostituiscono con le virgolette ad angolo semplice: stessa lunghezza (il
 * conto del troncamento non cambia), testo ancora leggibile dal modello,
 * ma nessun marcatore che non abbia scritto questo codice.
 */
function neutralizzaMarcatori(testo: string): string {
  return testo.replace(/<<</g, "‹‹‹").replace(/>>>/g, "›››");
}

/**
 * Il messaggio utente per il modello: intestazione fissa (commessa,
 * cliente, numero di pagine) seguita dalle pagine intere fra marcatori
 * `<<<PAGINA n>>>`/`<<<FINE PAGINA n>>>`. Le pagine si aggiungono per
 * intero: se la pagina successiva farebbe superare `TESTO_MASSIMO_TOTALE`
 * ci si ferma prima (mai a metà marcatore) e si segnala `troncato`.
 * L'intestazione resta sempre presente, a prescindere dal taglio.
 */
export function costruisciInputModello(
  pagine: readonly string[],
  contesto: ContestoEstrazione
): { testo: string; troncato: boolean } {
  const intestazione = [
    `COMMESSA: ${contesto.codiceCommessa}`,
    `CLIENTE CRM: ${contesto.clienteCommessa ?? "-"}`,
    `PAGINE: ${pagine.length}`,
  ].join("\n");

  const blocchi: string[] = [];
  let lunghezza = intestazione.length;
  let troncato = false;
  for (let i = 0; i < pagine.length; i++) {
    const numero = i + 1;
    const blocco = `<<<PAGINA ${numero}>>>\n${neutralizzaMarcatori(pagine[i])}\n<<<FINE PAGINA ${numero}>>>`;
    // +1 per l'a-capo che separa il blocco dal precedente (o dall'intestazione).
    if (lunghezza + 1 + blocco.length > TESTO_MASSIMO_TOTALE) {
      troncato = true;
      break;
    }
    blocchi.push(blocco);
    lunghezza += 1 + blocco.length;
  }

  return { testo: [intestazione, ...blocchi].join("\n"), troncato };
}

/** Chiave C2 dell'estrazione contratto: prefisso stabile per il prompt caching. */
export function chiaveCacheEstrazione(modello: string): string {
  return `tars-contr-${PROMPT_ESTRAZIONE_VERSIONE}-${modello}`.slice(0, 64);
}

export async function estraiConModello(input: {
  pagine: readonly string[];
  contesto: ContestoEstrazione;
  provider: TarsProvider;
  modello: string;
  identita: RichiestaProvider["identita"];
  timeoutMs?: number;
}): Promise<{ esito: EsitoModello; troncato: boolean }> {
  const { testo, troncato } = costruisciInputModello(input.pagine, input.contesto);
  const richiesta: RichiestaProvider = {
    modello: input.modello,
    istruzioni: PROMPT_ESTRAZIONE_CONTRATTO,
    input: [{ ruolo: "user", contenuto: testo }],
    strumenti: [],
    maxOutputToken: 8_000,
    chiaveCachePrompt: chiaveCacheEstrazione(input.modello),
    timeoutMs: input.timeoutMs ?? 120_000,
    identita: input.identita,
    formatoJson: { nome: "estrazione_contratto", schema: SCHEMA_JSON_ESTRAZIONE },
  };
  const risposta = await input.provider.rispondi(richiesta);
  if (risposta.tipo !== "messaggio") {
    throw new Error("ESTRAZIONE_RISPOSTA_INVALIDA: il modello ha chiamato strumenti inesistenti.");
  }
  let grezzo: unknown;
  try {
    grezzo = JSON.parse(risposta.testo);
  } catch {
    throw new Error("ESTRAZIONE_RISPOSTA_INVALIDA: JSON non decodificabile.");
  }
  const validato = schemaEsitoModello.safeParse(grezzo);
  if (!validato.success) {
    throw new Error(
      `ESTRAZIONE_RISPOSTA_INVALIDA: ${validato.error.issues.map(i => i.path.join(".") + " " + i.message).join("; ").slice(0, 300)}`
    );
  }
  return { esito: validato.data, troncato };
}
