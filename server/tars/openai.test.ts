import { afterEach, describe, expect, it, vi } from "vitest";
import { callOpenAI, OpenAIResponseError, openaiConfigured } from "./openai";

describe("OpenAI provider", () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.OPENAI_API_KEY;
  });

  it("usa Responses API e normalizza testo, function call e cache usage", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    let requestBody: any = null;
    global.fetch = vi.fn(async (_url, init: any) => {
      requestBody = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({
          id: "resp_test",
          model: "gpt-5.6-terra",
          status: "completed",
          output: [
            {
              id: "msg_1",
              type: "message",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: "Classifico la mail." }],
            },
            {
              id: "fc_1",
              type: "function_call",
              call_id: "call_1",
              name: "classifica_comunicazione",
              arguments: '{"comunicazioneId":42}',
              status: "completed",
            },
          ],
          usage: {
            input_tokens: 1_500,
            output_tokens: 120,
            input_tokens_details: {
              cached_tokens: 1_000,
              cache_write_tokens: 300,
            },
          },
        }),
        text: async () => "",
      } as any;
    }) as any;

    expect(openaiConfigured()).toBe(true);
    const response = await callOpenAI({
      model: "gpt-5.6-terra",
      instructions: "Sei Tars.",
      input: [{ role: "user", content: "Classifica la comunicazione 42" }],
      tools: [
        {
          name: "classifica_comunicazione",
          description: "Classifica una comunicazione.",
          input_schema: {
            type: "object",
            properties: { comunicazioneId: { type: "number" } },
            required: ["comunicazioneId"],
          },
        },
      ],
      promptCacheKey: "tars:smistamento:gpt-5.6-terra",
    });

    expect(requestBody).toMatchObject({
      model: "gpt-5.6-terra",
      store: false,
      text: { verbosity: "low" },
      reasoning: { effort: "medium", context: "all_turns" },
      include: ["reasoning.encrypted_content"],
      parallel_tool_calls: true,
      prompt_cache_key: "tars:smistamento:gpt-5.6-terra",
      prompt_cache_options: { mode: "explicit", ttl: "30m" },
      tools: [
        {
          type: "function",
          name: "classifica_comunicazione",
          strict: false,
        },
      ],
    });
    expect(requestBody).not.toHaveProperty("instructions");
    expect(requestBody.input[0]).toEqual({
      type: "message",
      role: "developer",
      content: [
        {
          type: "input_text",
          text: "Sei Tars.",
          prompt_cache_breakpoint: { mode: "explicit" },
        },
      ],
    });
    expect(requestBody.input[1]).toEqual({
      role: "user",
      content: "Classifica la comunicazione 42",
    });
    expect(response.text).toBe("Classifico la mail.");
    expect(response.functionCalls).toEqual([
      {
        callId: "call_1",
        name: "classifica_comunicazione",
        arguments: { comunicazioneId: 42 },
      },
    ]);
    expect(response.usage).toEqual({
      inputTokens: 1_500,
      outputTokens: 120,
      cachedInputTokens: 1_000,
      cacheWriteTokens: 300,
    });
  });

  it("nel turno conclusivo omette completamente gli strumenti", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    let requestBody: any = null;
    global.fetch = vi.fn(async (_url, init: any) => {
      requestBody = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({
          id: "resp_finale",
          model: "gpt-5.6-terra",
          status: "completed",
          output: [],
        }),
      } as any;
    }) as any;

    await callOpenAI({
      model: "gpt-5.6-terra",
      instructions: "Concludi.",
      input: [{ role: "user", content: "Riepiloga." }],
      tools: [],
      promptCacheKey: "tars:smistamento:gpt-5.6-terra",
    });

    expect(requestBody).not.toHaveProperty("tools");
    expect(requestBody).not.toHaveProperty("parallel_tool_calls");
  });

  it("sui modelli precedenti a 5.6 lascia il caching implicito", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    let requestBody: any = null;
    global.fetch = vi.fn(async (_url, init: any) => {
      requestBody = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({
          id: "resp_mini",
          model: "gpt-5.4-mini",
          status: "completed",
          output: [],
        }),
      } as any;
    }) as any;

    await callOpenAI({
      model: "gpt-5.4-mini",
      instructions: "Sei Tars.",
      input: [{ role: "user", content: "Analizza." }],
      tools: [],
      promptCacheKey: "tars:smistamento:gpt-5.4-mini",
    });

    expect(requestBody).not.toHaveProperty("prompt_cache_options");
    expect(requestBody.reasoning).toEqual({ effort: "medium" });
    expect(requestBody.input[0].content[0]).not.toHaveProperty(
      "prompt_cache_breakpoint"
    );
  });

  it("conserva la usage fatturata quando la risposta è incompleta", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        id: "resp_incomplete",
        model: "gpt-5.6-terra",
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output: [],
        usage: {
          input_tokens: 150,
          output_tokens: 20,
          input_tokens_details: {
            cached_tokens: 100,
            cache_write_tokens: 25,
          },
        },
      }),
    })) as any;

    const errore = await callOpenAI({
      model: "gpt-5.6-terra",
      instructions: "Sei Tars.",
      input: [{ role: "user", content: "Analizza." }],
      tools: [],
      promptCacheKey: "tars:test:gpt-5.6-terra",
    }).catch(e => e);

    expect(errore).toBeInstanceOf(OpenAIResponseError);
    expect(errore.usage).toEqual({
      inputTokens: 150,
      outputTokens: 20,
      cachedInputTokens: 100,
      cacheWriteTokens: 25,
    });
  });

  it.each([
    {
      nome: "stato non terminale",
      body: { status: "in_progress", output: [] },
      messaggio: /stato non terminale/i,
    },
    {
      nome: "rifiuto del modello",
      body: {
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "refusal", refusal: "Richiesta rifiutata" }],
          },
        ],
      },
      messaggio: /richiesta rifiutata/i,
    },
  ])("tratta $nome come errore", async ({ body, messaggio }) => {
    process.env.OPENAI_API_KEY = "test-key";
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        id: "resp_non_valida",
        model: "gpt-5.6-terra",
        usage: { input_tokens: 10, output_tokens: 2 },
        ...body,
      }),
    })) as any;

    await expect(
      callOpenAI({
        model: "gpt-5.6-terra",
        instructions: "Sei Tars.",
        input: [{ role: "user", content: "Analizza." }],
        tools: [],
        promptCacheKey: "tars:test:gpt-5.6-terra",
      })
    ).rejects.toThrow(messaggio);
  });

  it("non espone chiavi o payload sensibili negli errori HTTP", async () => {
    process.env.OPENAI_API_KEY = "sk-proj-secret-value";
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () =>
        JSON.stringify({
          error: {
            message:
              "Incorrect API key provided: sk-proj-secret-value. You can find your API key at the platform.",
            code: "invalid_api_key",
          },
        }),
    })) as any;

    const errore = await callOpenAI({
      model: "gpt-5.6-terra",
      instructions: "Sei Tars.",
      input: [{ role: "user", content: "Analizza." }],
      tools: [],
      promptCacheKey: "tars:test:gpt-5.6-terra",
    }).catch(e => e);

    expect(errore.message).toMatch(/chiave API non valida o revocata/i);
    expect(errore.message).not.toContain("sk-proj-secret-value");
    expect(errore.message).not.toContain("platform");
  });
});
