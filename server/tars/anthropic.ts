// Client minimale per l'API Anthropic (Messages) — fetch puro, zero
// dipendenze, stesso approccio di fileStorage.ts. Serve solo ciò che il
// loop di Tars usa: system con prompt caching, tool use, stop_reason.
//
// Chiave: ANTHROPIC_API_KEY (variabile Railway / .env locale, mai nel repo).

export type AnthropicTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: any }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    };

export type AnthropicMessage = {
  role: "user" | "assistant";
  content: string | ContentBlock[];
};

export type AnthropicResponse = {
  id: string;
  model: string;
  role: "assistant";
  content: ContentBlock[];
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    // Le scritture costano 1.25× a 5 minuti e 2× a un'ora: sommarle
    // insieme farebbe sbagliare la stima di spesa del 60%.
    cache_creation?: {
      ephemeral_5m_input_tokens?: number;
      ephemeral_1h_input_tokens?: number;
    };
  };
};

// Sovrascrivibile nei test (mock server) — in produzione resta il default.
const API_URL =
  process.env.ANTHROPIC_API_URL || "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

export function anthropicConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export async function callAnthropic(params: {
  model: string;
  system: string;
  messages: AnthropicMessage[];
  tools: AnthropicTool[];
  maxTokens?: number;
  signal?: AbortSignal;
}): Promise<AnthropicResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY non configurata. Impostala nelle variabili d'ambiente per attivare Tars."
    );
  }

  const res = await fetch(API_URL, {
    method: "POST",
    signal: params.signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": API_VERSION,
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: params.maxTokens ?? 4096,
      // Automatic prompt caching follows the growing conversation prefix.
      // Tool results from the previous round are read at cache price without
      // mutating message blocks or moving a manual breakpoint every turn.
      cache_control: { type: "ephemeral" },
      // Il system è identico a ogni chiamata del loop (e tra esecuzioni
      // ravvicinate): il cache_control dimezza il costo della voce più cara.
      // TTL di un'ora su system e strumenti. Sono identici fra un'esecuzione
      // e l'altra, ma i giri sono distanziati (la posta arriva quando arriva)
      // e con i 5 minuti di default la cache scadeva nei buchi: si ripagava
      // la scrittura ogni volta. Scrivere costa 2× invece di 1.25×, leggere
      // resta 0.1× — conviene da tre letture in su per finestra.
      system: [
        {
          type: "text",
          text: params.system,
          cache_control: { type: "ephemeral", ttl: "1h" },
        },
      ],
      messages: params.messages,
      // Le definizioni degli strumenti sono la seconda voce più cara del
      // prompt e non cambiano mai: il breakpoint sull'ultima le mette in
      // cache in blocco. Un giro del loop ne rilegge decine di migliaia di
      // token — a pagamento pieno, ogni volta.
      tools: params.tools.map((t, i) =>
        i === params.tools.length - 1
          ? { ...t, cache_control: { type: "ephemeral", ttl: "1h" } }
          : t
      ),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Anthropic API ${res.status} ${res.statusText}: ${body.slice(0, 500)}`
    );
  }

  return (await res.json()) as AnthropicResponse;
}
