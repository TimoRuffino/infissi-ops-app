import { callOpenAI } from "../openai";
import { toolDefsForTrigger } from "../tools";
import type { EvalCase, EvalObserved } from "./types";

function proposalTypeFromTool(name: string): string | null {
  const map: Record<string, string> = {
    proponi_nuovo_lead: "crea_lead",
    proponi_collega_fattura: "collega_fattura",
    proponi_rinomina_documento: "rinomina_documento",
    proponi_ticket: "ticket",
    proponi_segnalazione: "segnalazione",
    chiedi_chiarimento: "domanda",
  };
  return map[name] ?? null;
}

export async function executeLiveEvalCase(item: EvalCase): Promise<EvalObserved> {
  const startedAt = Date.now();
  const response = await callOpenAI({
    model: process.env.TARS_EVAL_MODEL ?? "gpt-5.4-mini",
    instructions:
      "Sei Tars in una valutazione isolata. Analizza soltanto il caso sintetico. " +
      "Usa gli strumenti che useresti nel CRM, non inventare risultati e non eseguire azioni.",
    input: [{ role: "user", content: JSON.stringify(item.input) }],
    tools: toolDefsForTrigger(item.trigger),
    promptCacheKey: `tars:eval:${item.trigger}`,
    reasoningEffort: "low",
  });
  const toolNames = response.functionCalls.map(call => call.name);
  return {
    toolNames,
    proposalTypes: toolNames
      .map(proposalTypeFromTool)
      .filter((value): value is string => value != null),
    importantClaims: response.text ? 1 : 0,
    citedClaims: 0,
    tokensIn: response.usage.inputTokens,
    tokensOut: response.usage.outputTokens,
    durationMs: Date.now() - startedAt,
  };
}
