// Quali strumenti può portare una proposta del mattino, e come si
// raccontano al modello (punto 2 del piano 08/09/2026).
//
// Vive fuori da `analisi.ts` perché lo usano sia l'analisi sia il prompt,
// e il prompt non può dipendere dall'analisi: si chiamano a vicenda.
//
// La lista non è scritta a mano. Una lista compilata a mano invecchia e
// taglia fuori strumenti che l'utente potrebbe usare — e il freno vero non
// è qui: è al click, dove `catalogoAzioniPerContesto` ricontrolla
// capability, sede e interruttori su CHI preme. La proposta non porta
// autorità.

import { REGISTRO_AZIONI } from "../azioni/registry";
import { comeDefinizioneProvider } from "../profili";

/**
 * Fuori dalle proposte anche se il registro li ammetterebbe. Lista corta,
 * esplicita e motivata: tutto il resto si deriva.
 */
export const STRUMENTI_MAI_PROPOSTI: Readonly<Record<string, string>> = {
  // Soldi: un importo non nasce da un click su una lista del mattino.
  registra_costo_fornitore: "registra un importo",
  // Cancellazione definitiva: una memoria tolta non torna.
  dimentica: "cancella definitivamente",
  // Operazione massiva su richiesta esplicita, non una proposta.
  migra_calendario_google: "importazione massiva",
};

/**
 * Le azioni di scrittura ordinaria del registro:
 * - `rischio` R1 (R0 è sola lettura; R2 e R3 passano dal gateway o dalla
 *   conferma umana e non si eseguono con un click);
 * - `livello` diverso da L3, che per definizione richiede la conferma;
 * - `effetto` interno: mai un effetto esterno da una proposta;
 * meno le eccezioni dichiarate sopra.
 */
export function azioniProponibili() {
  return REGISTRO_AZIONI.filter(
    azione =>
      azione.rischio === "R1" &&
      azione.livello !== "L3" &&
      azione.strumento.effetto === "interno" &&
      !(azione.nome in STRUMENTI_MAI_PROPOSTI)
  );
}

export function strumentiProponibili(): readonly string[] {
  return azioniProponibili().map(azione => azione.nome);
}

/** `campo: tipo`, con `?` sugli opzionali: al modello serve la forma, non lo schema. */
function formaInput(parametri: Record<string, unknown>): string {
  const proprieta = (parametri.properties ?? {}) as Record<string, any>;
  const obbligatori = new Set((parametri.required ?? []) as string[]);
  const campi = Object.entries(proprieta).map(([nome, schema]) => {
    const tipo = Array.isArray(schema?.enum)
      ? schema.enum.join("|")
      : (schema?.type ?? "any");
    return `${nome}${obbligatori.has(nome) ? "" : "?"}: ${tipo}`;
  });
  return campi.length > 0 ? `{${campi.join(", ")}}` : "{}";
}

/**
 * Il catalogo che finisce nel prompt: una riga per strumento, con la
 * descrizione del registro e la forma dell'input. Deriva dal registro, così
 * uno strumento nuovo è proponibile il giorno in cui nasce.
 */
export function catalogoProponibiliPerPrompt(): string {
  return azioniProponibili()
    .map(azione => {
      const definizione = comeDefinizioneProvider(azione.strumento);
      return `  - ${definizione.nome}: ${definizione.descrizione} — input ${formaInput(definizione.parametri)}`;
    })
    .join("\n");
}
