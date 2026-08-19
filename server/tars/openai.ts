// Client minimale per OpenAI Responses API. Tars usa fetch puro per tenere il
// provider isolato dal loop agentico e rendere espliciti tool call, cache e
// gestione degli errori.

export type TarsTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type OpenAIInputItem =
  | { role: "user" | "assistant"; content: string }
  | { type: "function_call_output"; call_id: string; output: string }
  | Record<string, unknown>;

type OpenAIOutputText = { type: "output_text"; text: string };
type OpenAIRefusal = { type: "refusal"; refusal?: string };
type OpenAIMessageOutput = {
  type: "message";
  content?: Array<OpenAIOutputText | OpenAIRefusal | Record<string, unknown>>;
  [key: string]: unknown;
};
type OpenAIFunctionCallOutput = {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
  [key: string]: unknown;
};
export type OpenAIOutputItem =
  | OpenAIMessageOutput
  | OpenAIFunctionCallOutput
  | Record<string, unknown>;

type OpenAIResponse = {
  id: string;
  model: string;
  status: "completed" | "incomplete" | "failed" | string;
  output?: OpenAIOutputItem[];
  error?: { message?: string } | null;
  incomplete_details?: { reason?: string } | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: {
      cached_tokens?: number;
      cache_write_tokens?: number;
    };
  };
};

export type OpenAIUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
};

export class OpenAIResponseError extends Error {
  readonly usage: OpenAIUsage;

  constructor(message: string, usage: OpenAIUsage) {
    super(message);
    this.name = "OpenAIResponseError";
    this.usage = usage;
  }
}

export type OpenAITarsResponse = {
  id: string;
  model: string;
  output: OpenAIOutputItem[];
  text: string;
  functionCalls: Array<{
    callId: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  usage: OpenAIUsage;
};

export function openaiConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

function apiUrl(): string {
  return process.env.OPENAI_API_URL || "https://api.openai.com/v1/responses";
}

function normalizzaUsage(body: OpenAIResponse): OpenAIUsage {
  const details = body.usage?.input_tokens_details;
  return {
    inputTokens: body.usage?.input_tokens ?? 0,
    outputTokens: body.usage?.output_tokens ?? 0,
    cachedInputTokens: details?.cached_tokens ?? 0,
    cacheWriteTokens: details?.cache_write_tokens ?? 0,
  };
}

function messaggioErroreHttp(
  status: number,
  statusText: string,
  rawBody: string
): string {
  let code = "";
  let providerMessage = "";
  try {
    const parsed = JSON.parse(rawBody) as {
      error?: { code?: string; message?: string };
    };
    code = parsed.error?.code ?? "";
    providerMessage = parsed.error?.message ?? "";
  } catch {
    // Le risposte non JSON non vengono riportate: potrebbero contenere proxy
    // HTML, header riflessi o altri dettagli non destinati al registro.
  }

  if (status === 401 || code === "invalid_api_key") {
    return "OpenAI API 401 Unauthorized: chiave API non valida o revocata.";
  }
  if (status === 429) {
    return "OpenAI API 429: limite di richieste o credito disponibile esaurito.";
  }
  if (status >= 500) {
    return `OpenAI API ${status}: servizio temporaneamente non disponibile.`;
  }

  const safeMessage = providerMessage
    .replace(/sk-[A-Za-z0-9_-]+/g, "[chiave rimossa]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
  return `OpenAI API ${status} ${statusText}${safeMessage ? `: ${safeMessage}` : ""}`;
}

export async function callOpenAI(params: {
  model: string;
  instructions: string;
  input: OpenAIInputItem[];
  tools: TarsTool[];
  maxTokens?: number;
  reasoningEffort?: "none" | "low" | "medium" | "high";
  promptCacheKey: string;
  signal?: AbortSignal;
}): Promise<OpenAITarsResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY non configurata. Impostala nelle variabili d'ambiente per attivare Tars."
    );
  }

  const cacheEsplicita = /^gpt-5\.6(?:-|$)/.test(params.model);
  const istruzioni = {
    type: "message",
    role: "developer",
    content: [
      {
        type: "input_text",
        text: params.instructions,
        ...(cacheEsplicita
          ? { prompt_cache_breakpoint: { mode: "explicit" } }
          : {}),
      },
    ],
  };

  const res = await fetch(apiUrl(), {
    method: "POST",
    signal: params.signal,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      input: [istruzioni, ...params.input],
      ...(params.tools.length > 0
        ? {
            tools: params.tools.map(tool => ({
              type: "function",
              name: tool.name,
              description: tool.description,
              parameters: tool.input_schema,
              // Gli schemi storici di Tars hanno alcuni campi opzionali.
              // Usiamo best effort finché non saranno strict-compatible.
              strict: false,
            })),
            parallel_tool_calls: true,
          }
        : {}),
      max_output_tokens: params.maxTokens ?? 4096,
      text: { verbosity: "low" },
      reasoning: {
        effort: params.reasoningEffort ?? "medium",
        ...(cacheEsplicita ? { context: "all_turns" } : {}),
      },
      // Tars gestisce la cronologia in modo stateless. Gli item cifrati
      // permettono di ripassare il reasoning tra i turni di function calling.
      include: ["reasoning.encrypted_content"],
      prompt_cache_key: params.promptCacheKey,
      ...(cacheEsplicita
        ? { prompt_cache_options: { mode: "explicit", ttl: "30m" } }
        : {}),
      store: false,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(messaggioErroreHttp(res.status, res.statusText, body));
  }

  const body = (await res.json()) as OpenAIResponse;
  const usage = normalizzaUsage(body);
  if (body.error?.message) {
    throw new OpenAIResponseError(`OpenAI API: ${body.error.message}`, usage);
  }
  if (body.status === "failed") {
    throw new OpenAIResponseError("OpenAI API: risposta fallita", usage);
  }
  if (body.status === "incomplete") {
    throw new OpenAIResponseError(
      `OpenAI API: risposta incompleta (${body.incomplete_details?.reason ?? "motivo non indicato"})`,
      usage
    );
  }
  if (body.status !== "completed") {
    throw new OpenAIResponseError(
      `OpenAI API: stato non terminale o non supportato (${body.status ?? "assente"})`,
      usage
    );
  }

  const output = body.output ?? [];
  const refusal = output
    .filter((item): item is OpenAIMessageOutput => item.type === "message")
    .flatMap(item => item.content ?? [])
    .find((item): item is OpenAIRefusal => item.type === "refusal");
  if (refusal) {
    throw new OpenAIResponseError(
      `OpenAI API: ${refusal.refusal || "richiesta rifiutata dal modello"}`,
      usage
    );
  }
  const text = output
    .filter((item): item is OpenAIMessageOutput => item.type === "message")
    .flatMap(item => item.content ?? [])
    .filter((item): item is OpenAIOutputText => item.type === "output_text")
    .map(item => item.text)
    .join("\n")
    .trim();
  const functionCalls = output
    .filter(
      (item): item is OpenAIFunctionCallOutput => item.type === "function_call"
    )
    .map(item => {
      let args: unknown;
      try {
        args = JSON.parse(item.arguments || "{}");
      } catch {
        throw new OpenAIResponseError(
          `OpenAI API: argomenti JSON non validi per lo strumento ${item.name}`,
          usage
        );
      }
      if (!args || typeof args !== "object" || Array.isArray(args)) {
        throw new OpenAIResponseError(
          `OpenAI API: argomenti non validi per lo strumento ${item.name}`,
          usage
        );
      }
      return {
        callId: item.call_id,
        name: item.name,
        arguments: args as Record<string, unknown>,
      };
    });
  return {
    id: body.id,
    model: body.model,
    output,
    text,
    functionCalls,
    usage,
  };
}
