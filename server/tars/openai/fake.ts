// Provider FINTO e deterministico (T1): muove test, eval offline e
// sviluppo senza MAI toccare la rete. Si programma con un copione: una
// funzione che, data la richiesta (e il numero di passo), decide se
// rispondere o chiamare strumenti. Nessuna casualità: stessi input,
// stessi output.

import {
  ErroreProvider,
  type RichiestaProvider,
  type RispostaProvider,
  type TarsProvider,
} from "../provider";

export type PassoCopione = (
  richiesta: RichiestaProvider,
  passo: number
) => RispostaProvider | "errore_transitorio" | "errore_fatale";

const USO_ZERO = { input: 0, output: 0, cachedInput: 0, cacheWrite: 0 };

/** Uso token simulato e stabile: i contatori di telemetria restano testabili. */
function usoSimulato(richiesta: RichiestaProvider) {
  const inputChar =
    richiesta.istruzioni.length +
    richiesta.input.reduce((somma, m) => somma + m.contenuto.length, 0);
  return {
    input: Math.ceil(inputChar / 4),
    output: 64,
    cachedInput: Math.ceil(richiesta.istruzioni.length / 4),
    cacheWrite: 0,
  };
}

export function creaProviderFinto(copione: PassoCopione): TarsProvider {
  let passo = 0;
  return {
    nome: "finto",
    async rispondi(richiesta) {
      const esito = copione(richiesta, passo++);
      if (esito === "errore_transitorio") {
        throw new ErroreProvider("finto: errore transitorio", "rete", true);
      }
      if (esito === "errore_fatale") {
        throw new ErroreProvider(
          "finto: errore fatale",
          "configurazione",
          false
        );
      }
      return {
        ...esito,
        uso:
          esito.uso === USO_ZERO || esito.uso.input === 0
            ? usoSimulato(richiesta)
            : esito.uso,
      };
    },
  };
}

/** Scorciatoie per i copioni dei test. */
export function rispostaTesto(testo: string): RispostaProvider {
  return { tipo: "messaggio", testo, uso: { ...USO_ZERO } };
}

export function chiamataTool(
  nome: string,
  argomenti: unknown,
  id = `call_${nome}`
): RispostaProvider {
  return {
    tipo: "tool_call",
    chiamate: [{ id, nome, argomenti: JSON.stringify(argomenti) }],
    uso: { ...USO_ZERO },
  };
}
