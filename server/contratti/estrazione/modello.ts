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
}): Promise<{ esito: EsitoModello; troncato: boolean; sanificazioni: string[] }> {
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
  let decodificato: unknown;
  try {
    decodificato = JSON.parse(risposta.testo);
  } catch {
    throw new Error("ESTRAZIONE_RISPOSTA_INVALIDA: JSON non decodificabile.");
  }
  const { grezzo, sanificazioni } = sanificaEsitoGrezzo(decodificato);
  const validato = schemaEsitoModello.safeParse(grezzo);
  if (!validato.success) {
    throw new Error(
      `ESTRAZIONE_RISPOSTA_INVALIDA: ${validato.error.issues.map(i => i.path.join(".") + " " + i.message).join("; ").slice(0, 300)}`
    );
  }
  return { esito: validato.data, troncato, sanificazioni };
}

const MISURA_MIN_MM = 100;
const MISURA_MAX_MM = 6000;

/**
 * Prima dello schema: i valori fuori intervallo che il modello legge davvero
 * da un documento vero — uno sconto con importo negativo, una quantità zero,
 * una misura in centimetri — non devono buttare via l'intera lettura (fase 3
 * dello studio, 06/09/2026: il contratto 32/2026 si fermava su «righe.2.
 * prezzoTotale Too small» e l'operatore restava senza proposta). Si scartano
 * le singole righe o si annullano i singoli valori, dichiarandolo in
 * `sanificazioni` (finiscono nelle avvertenze della proposta); la struttura
 * resta di competenza dello schema strict.
 */
export function sanificaEsitoGrezzo(decodificato: unknown): { grezzo: unknown; sanificazioni: string[] } {
  const sanificazioni: string[] = [];
  if (!decodificato || typeof decodificato !== "object" || Array.isArray(decodificato)) {
    return { grezzo: decodificato, sanificazioni };
  }
  const g: any = structuredClone(decodificato);
  const numero = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const testo = (v: unknown, max: number): unknown => (typeof v === "string" && v.length > max ? v.slice(0, max) : v);
  const paginaValida = (o: any) => {
    if (o && typeof o === "object" && numero(o.pagina) != null && o.pagina < 0) o.pagina = 0;
    if (o && typeof o === "object") o.frammento = testo(o.frammento, 300);
  };

  if (Array.isArray(g.righe)) {
    g.righe = g.righe.filter((r: any, i: number) => {
      if (!r || typeof r !== "object") return true;
      const nome = typeof r.descrizione === "string" && r.descrizione.trim() ? r.descrizione.trim().slice(0, 40) : `riga ${i + 1}`;
      const prezzo = numero(r.prezzoTotale);
      const unitario = numero(r.prezzoUnitario);
      if ((prezzo != null && prezzo < 0) || (unitario != null && unitario < 0)) {
        sanificazioni.push(`Riga «${nome}» con importo negativo (uno sconto?) non proposta: verificare sul documento.`);
        return false;
      }
      const quantita = numero(r.quantita);
      if (quantita != null && quantita < 1) {
        sanificazioni.push(`Riga «${nome}» con quantità ${quantita} non proposta: verificare sul documento.`);
        return false;
      }
      for (const [chiave, etichetta] of [["larghezzaMm", "larghezza"], ["altezzaMm", "altezza"]] as const) {
        const v = numero(r[chiave]);
        if (v == null) continue;
        const intero = Math.round(v);
        if (intero < MISURA_MIN_MM || intero > MISURA_MAX_MM) {
          r[chiave] = null;
          sanificazioni.push(`Riga «${nome}»: ${etichetta} ${v} mm fuori misura, da leggere a mano.`);
        } else if (intero !== v) {
          r[chiave] = intero;
        }
      }
      const ante = numero(r.nAnte);
      if (ante != null && (ante < 0 || ante > 4 || !Number.isInteger(ante))) r.nAnte = Math.min(4, Math.max(0, Math.round(ante)));
      r.descrizione = testo(r.descrizione, 300);
      if (Array.isArray(r.accessori)) r.accessori = r.accessori.slice(0, 20).map((a: unknown) => testo(a, 60));
      paginaValida(r);
      return true;
    });
  }
  for (const [gruppo, chiavi] of [["pattuito", ["totaleLordo", "totaleImponibile"]], ["posa", ["prezzo"]]] as const) {
    const o = g[gruppo];
    if (!o || typeof o !== "object") continue;
    for (const chiave of chiavi) {
      const v = numero(o[chiave]);
      if (v != null && v < 0) {
        o[chiave] = null;
        sanificazioni.push(`${gruppo === "pattuito" ? "Pattuito" : "Posa"}: importo negativo (${v}) scartato, da leggere a mano.`);
      }
    }
    paginaValida(o);
  }
  if (Array.isArray(g.rate)) {
    for (const rata of g.rate) {
      if (!rata || typeof rata !== "object") continue;
      const q = numero(rata.quotaPct);
      if (q != null && (q < 0 || q > 100)) {
        rata.quotaPct = Math.min(100, Math.max(0, q));
        sanificazioni.push(`Rata «${typeof rata.descrizione === "string" ? rata.descrizione.slice(0, 40) : "?"}»: quota ${q} % riportata a ${rata.quotaPct} %.`);
      }
      rata.descrizione = testo(rata.descrizione, 120);
      paginaValida(rata);
    }
  }
  for (const gruppo of ["cantiere", "cliente"]) paginaValida(g[gruppo]);
  return { grezzo: g, sanificazioni };
}
