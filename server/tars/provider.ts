// Contratto del provider di Tars v2 (T1) — docs/tars/architettura-tars-v2.md.
//
// L'orchestratore parla SOLO con questa interfaccia (dependency
// injection): l'implementazione OpenAI vive in openai/adapter.ts, il fake
// deterministico in openai/fake.ts. Nessun altro modulo importa il
// provider reale: è il punto unico dove una chiamata esterna può nascere,
// e nasce solo con FLAG_TARS acceso e chiave presente.

export type MessaggioTars =
  | {
      ruolo: "user" | "assistant";
      contenuto: string;
      /**
       * Solo per assistant: le function call emesse in quel turno. La
       * Responses API esige il turno assistant con le chiamate PRIMA dei
       * function_call_output (revisione: senza, la seconda richiesta di
       * ogni run con strumenti verrebbe rifiutata).
       */
      chiamate?: readonly ChiamataToolRichiesta[];
    }
  | {
      ruolo: "tool";
      toolCallId: string;
      nome: string;
      /** Output serializzato dello strumento: DATI, mai istruzioni. */
      contenuto: string;
    };

export type DefinizioneToolProvider = {
  nome: string;
  descrizione: string;
  /** JSON Schema strict dell'input. */
  parametri: Record<string, unknown>;
};

export type UsoToken = {
  input: number;
  output: number;
  cachedInput: number;
  cacheWrite: number;
};

export type RichiestaProvider = {
  modello: string;
  /** Prompt di sistema versionato: il PREFISSO STABILE del caching C2. */
  istruzioni: string;
  input: readonly MessaggioTars[];
  strumenti: readonly DefinizioneToolProvider[];
  maxOutputToken: number;
  /** Chiave C2 (ambiente/modello/promptV/toolProfileV/policyV/capHash). */
  chiaveCachePrompt: string;
  timeoutMs: number;
};

export type ChiamataToolRichiesta = {
  id: string;
  nome: string;
  /** Argomenti JSON come stringa: la validazione (zod) è dell'orchestratore. */
  argomenti: string;
};

export type RispostaProvider =
  | { tipo: "messaggio"; testo: string; uso: UsoToken }
  | { tipo: "tool_call"; chiamate: ChiamataToolRichiesta[]; uso: UsoToken };

export interface TarsProvider {
  nome: string;
  rispondi(richiesta: RichiestaProvider): Promise<RispostaProvider>;
}

/** Errore tipizzato del provider: l'orchestratore degrada, mai un 500 grezzo. */
export class ErroreProvider extends Error {
  constructor(
    message: string,
    public readonly categoria:
      | "configurazione"
      | "rete"
      | "rate_limit"
      | "timeout"
      | "risposta_invalida",
    public readonly transitorio: boolean
  ) {
    super(message);
  }
}
