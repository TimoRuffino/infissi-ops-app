import { vi } from "vitest";

/** Converte i vecchi fixture leggibili a blocchi nel payload Responses API. */
export function toOpenAIResponse(fixture: any): any {
  const content = fixture.content ?? [];
  const testi = content
    .filter((block: any) => block.type === "text")
    .map((block: any) => ({ type: "output_text", text: block.text }));
  const calls = content
    .filter((block: any) => block.type === "tool_use")
    .map((block: any) => ({
      id: block.id,
      type: "function_call",
      call_id: block.id,
      name: block.name,
      arguments: JSON.stringify(block.input ?? {}),
      status: "completed",
    }));
  return {
    id: fixture.id ?? "resp_test",
    model: fixture.model ?? "gpt-5.6-terra",
    status: "completed",
    output: [
      ...(testi.length
        ? [
            {
              id: "msg_test",
              type: "message",
              role: "assistant",
              status: "completed",
              content: testi,
            },
          ]
        : []),
      ...calls,
    ],
    usage: fixture.usage ?? { input_tokens: 100, output_tokens: 50 },
  };
}

export function openaiScript(responses: any[]) {
  let i = 0;
  return vi.fn(async () => {
    const body = toOpenAIResponse(
      responses[Math.min(i++, responses.length - 1)]
    );
    return {
      ok: true,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as any;
  });
}
