// Il salto: l'analisi del mattino può chiedere (punto 19 del piano
// `2026-09-08-tars-piu-intelligente`, decisione della direzione «sì, senza
// tetto»).
//
// Fino a oggi era un colpo solo: fotografia dentro, JSON fuori, **zero
// strumenti**. In chat Tars ne ha cinquantasei, al mattino nessuno — cioè
// esattamente il contrario della policy scritta in CLAUDE.md, dove il
// modello decide e chiama gli strumenti. Qui gli si danno i soli strumenti
// di LETTURA e qualche giro: si fa un'idea, la verifica, poi propone.
//
// Perimetro stretto, perché è il mattino e non c'è nessuno a sorvegliare:
//   • solo azioni `R0` del registro — leggere, cercare, verificare. Nessuna
//     scrittura può nascere da qui, nemmeno per sbaglio: la lista si deriva
//     dal registro come quella delle proposte;
//   • un tetto di giri e di chiamate, perché un ciclo che non converge non
//     deve poter girare all'infinito su un worker;
//   • il contesto è di sistema, con le capability della direzione della
//     sede: legge quello che la direzione leggerebbe, e niente di più;
//   • l'output di uno strumento è un DATO, mai un'istruzione (stessa regola
//     dell'orchestratore).

import { capabilitiesForRoles } from "../../authz/capabilities";
import { TENANT_PREDEFINITO_ID } from "../../tenants/costanti";
import { tenantCorrente } from "../../tenants/contestoCorrente";
import { REGISTRO_AZIONI, descrittoreAzione } from "../azioni/registry";
import { comeDefinizioneProvider } from "../profili";
import type { DefinizioneToolProvider } from "../provider";
import type { ContestoRun } from "../strumenti/tipi";

/** Quanti giri di domande prima di pretendere la risposta. */
export const GIRI_MASSIMI_INDAGINE = 4;
/** E quante chiamate in tutto: un giro può chiederne più di una. */
export const CHIAMATE_MASSIME_INDAGINE = 12;
/** Un output enorme non aiuta il modello e riempie il contesto. */
export const CARATTERI_MASSIMI_RISPOSTA = 4000;

/**
 * Gli strumenti che l'analisi può usare: SOLO letture del registro. La
 * regola è la stessa forma di quella delle proposte — derivata, non scritta
 * a mano — così uno strumento di lettura nuovo è disponibile dal giorno in
 * cui nasce, e una scrittura non lo diventa mai.
 */
export function strumentiDiIndagine(): DefinizioneToolProvider[] {
  return REGISTRO_AZIONI.filter(
    a => a.rischio === "R0" && a.strumento.effetto === "nessuno"
  )
    .map(a => comeDefinizioneProvider(a.strumento))
    .sort((a, b) => a.nome.localeCompare(b.nome));
}

/**
 * Il contesto con cui l'analisi legge: sistema, sede, capability della
 * direzione. Non è l'autorità di nessun utente — nessuna scrittura passa
 * di qui — ma il perimetro di lettura deve essere quello della direzione,
 * altrimenti l'analisi vedrebbe meno di quello che descrive.
 */
export function contestoDiIndagine(sedeId: number): ContestoRun {
  const ruoli = ["direzione"];
  const capability = capabilitiesForRoles(ruoli);
  return {
    utenteId: 0,
    tenantId: tenantCorrente() ?? TENANT_PREDEFINITO_ID,
    sedeId,
    ruoli,
    direzione: true,
    capability,
    capabilityFingerprint: `analisi-sede-${sedeId}`,
    lingua: "it",
    fuso: "Europe/Rome",
  };
}

export type EsitoChiamata = {
  nome: string;
  contenuto: string;
  errore: string | null;
};

/**
 * Esegue una chiamata di lettura e restituisce il testo da rimandare al
 * modello. Non lancia: un errore diventa un dato, e il giro continua.
 */
export async function eseguiLettura(input: {
  nome: string;
  argomenti: unknown;
  contesto: ContestoRun;
  ammessi: ReadonlySet<string>;
}): Promise<EsitoChiamata> {
  if (!input.ammessi.has(input.nome)) {
    return {
      nome: input.nome,
      contenuto: "",
      errore: `Lo strumento «${input.nome}» non è disponibile nell'analisi: qui si può solo leggere.`,
    };
  }
  const descrittore = descrittoreAzione(input.nome);
  if (!descrittore) {
    return { nome: input.nome, contenuto: "", errore: "Strumento sconosciuto." };
  }
  const validi = descrittore.strumento.schemaInput.safeParse(input.argomenti);
  if (!validi.success) {
    return {
      nome: input.nome,
      contenuto: "",
      errore: `Parametri non validi: ${validi.error.issues
        .map(i => `${i.path.join(".")} ${i.message}`)
        .join("; ")
        .slice(0, 200)}`,
    };
  }
  try {
    const esito = await descrittore.strumento.esegui(input.contesto, validi.data);
    return {
      nome: input.nome,
      contenuto: JSON.stringify(esito).slice(0, CARATTERI_MASSIMI_RISPOSTA),
      errore: null,
    };
  } catch (errore: any) {
    return {
      nome: input.nome,
      contenuto: "",
      errore: String(errore?.message ?? errore).slice(0, 200),
    };
  }
}

/** Quello che il modello riceve indietro: dati, o il motivo per cui non ce ne sono. */
export function rispostaPerIlModello(esito: EsitoChiamata): string {
  return esito.errore
    ? JSON.stringify({ errore: esito.errore })
    : esito.contenuto || JSON.stringify({ vuoto: true });
}
