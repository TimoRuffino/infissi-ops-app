// Loop agentico di Tars.
//
// Budget rigidi (config): max tool call, max proposte, timeout. Al limite
// il loop termina con quanto raccolto — mai run infinite. Ogni esecuzione
// finisce nel registro agente_esecuzioni, completa di strumenti chiamati,
// token e riepilogo: la direzione deve poter ricostruire PERCHÉ una
// proposta esiste.

import type { TrpcContext } from "../_core/context";
import {
  callOpenAI,
  OpenAIResponseError,
  type OpenAIInputItem,
  type OpenAIUsage,
} from "./openai";
import { bloccoDecisioni, buildSystemPromptForTrigger } from "./prompt";
import {
  eseguiStrumento,
  sintesiEsito,
  toolDefsForTrigger,
  toolProfileForTrigger,
  type ToolRuntime,
} from "./tools";
import {
  esecuzioni,
  saveEsecuzioni,
  newEsecuzioneId,
  getTarsConfig,
  type Esecuzione,
} from "./stores";

function shortHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function buildPromptCacheKey(
  sedeId: number | null,
  profiloStrumenti: string,
  modello: string
): string {
  const raw = `tars:v2:s${sedeId ?? "all"}:${profiloStrumenti}:${modello}`;
  return raw.length <= 64
    ? raw
    : `${raw.slice(0, 55)}:${shortHash(raw).slice(0, 8)}`;
}

export async function runTars(params: {
  ctx: TrpcContext;
  trigger: string;
  commessaId: number | null;
  comunicazioneId?: number | null;
  richiesta: string; // messaggio utente per il modello
  // Turni precedenti (chat): vengono anteposti alla richiesta così il
  // modello mantiene il filo. Solo testo — i tool-use passati non servono.
  storia?: Array<{ role: "user" | "assistant"; content: string }>;
  // Proposta da cui nasce questo run (seguito di una decisione).
  origineId?: number | null;
}): Promise<Esecuzione> {
  const config = getTarsConfig(params.ctx.sedeId);
  const start = Date.now();

  // I lavori di massa girano sul modello economico: smistare dieci mail è
  // un compito di aggancio, non di ragionamento — e succede molte volte al
  // giorno. Il modello pieno resta per chi lo chiede (analizza, chat) e per
  // il seguito di una decisione, dove l'errore costa di più del token.
  const TRIGGER_ECONOMICI = new Set([
    "smistamento",
    "riconciliazione_fatture",
    "audit_processi",
    "centro_azioni",
  ]);
  const modello = TRIGGER_ECONOMICI.has(params.trigger)
    ? config.modelloAutomatico
    : config.modello;
  const tools = toolDefsForTrigger(params.trigger);
  const profiloStrumenti = toolProfileForTrigger(params.trigger);

  const esecuzione: Esecuzione = {
    id: newEsecuzioneId(),
    sedeId: params.ctx.sedeId ?? 1,
    trigger: params.trigger,
    modello,
    commessaId: params.commessaId,
    comunicazioneId: params.comunicazioneId ?? null,
    richiesta: params.richiesta,
    profiloStrumenti,
    strumentiDisponibili: tools.length,
    toolCacheHits: 0,
    proposteDuplicateBloccate: 0,
    comunicazioniClassificateIds: [],
    fascicoloPrecaricato: false,
    strumenti: [],
    proposteIds: [],
    riepilogo: null,
    tokensIn: 0,
    tokensOut: 0,
    tokensCacheRead: 0,
    tokensCacheWrite5m: 0,
    tokensCacheWrite1h: 0,
    durataMs: 0,
    esito: "ok",
    errore: null,
    utenteId: (params.ctx.user as any)?.id ?? null,
    utenteNome: (params.ctx.user as any)?.name ?? null,
    createdAt: new Date(),
  };

  const rt: ToolRuntime = {
    ctx: params.ctx,
    esecuzioneId: esecuzione.id,
    trigger: params.trigger,
    maxProposte: config.maxProposte,
    proposteIds: [],
    terminato: null,
    origineId: params.origineId ?? null,
    comunicazioneId: params.comunicazioneId ?? null,
    risultatiCache: new Map(),
    toolCacheHits: 0,
    duplicatiBloccati: 0,
    comunicazioniClassificateIds: new Set(),
  };

  const system = buildSystemPromptForTrigger(params.ctx.sedeId, params.trigger);
  // Le decisioni recenti cambiano a ogni approvazione. Stanno in coda al
  // turno utente, dopo tutto il prefisso in cache: così un click su «approva»
  // non invalida più system e strumenti, che sono la parte cara e immobile.
  const decisioni =
    params.trigger === "smistamento" ? "" : bloccoDecisioni(params.ctx.sedeId);
  let richiesta = params.richiesta;
  if (
    params.commessaId != null &&
    tools.some(tool => tool.name === "leggi_fascicolo_commessa")
  ) {
    const fascicolo = await eseguiStrumento(rt, "leggi_fascicolo_commessa", {
      commessaId: params.commessaId,
    });
    if (!fascicolo.isError) {
      esecuzione.fascicoloPrecaricato = true;
      richiesta = `<fascicolo_commessa_verificato id="${params.commessaId}">
${fascicolo.content}
</fascicolo_commessa_verificato>

Il fascicolo sopra è già stato letto dal CRM per questa esecuzione. Usalo come fonte
iniziale e chiedi strumenti aggiuntivi solo per dettagli non presenti.

${params.richiesta}`;
    }
  }
  const input: OpenAIInputItem[] = [
    ...(params.storia ?? []),
    {
      role: "user",
      content: decisioni ? `${decisioni}\n\n${richiesta}` : richiesta,
    },
  ];

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), config.timeoutMs);
  const registraUsage = (usage: OpenAIUsage) => {
    const cached = usage.cachedInputTokens;
    const cacheWrite = usage.cacheWriteTokens;
    esecuzione.tokensIn += Math.max(0, usage.inputTokens - cached - cacheWrite);
    esecuzione.tokensOut += usage.outputTokens;
    esecuzione.tokensCacheRead += cached;
    // Campo storico: per OpenAI rappresenta le scritture cache a 30 minuti,
    // che hanno lo stesso moltiplicatore 1,25x del vecchio bucket 5m.
    esecuzione.tokensCacheWrite5m += cacheWrite;
  };

  try {
    let toolCalls = 0;
    let chiusuraForzata = false;

    while (true) {
      const res = await callOpenAI({
        model: modello,
        instructions: system,
        input,
        tools: chiusuraForzata ? [] : tools,
        promptCacheKey: buildPromptCacheKey(
          params.ctx.sedeId,
          profiloStrumenti,
          modello
        ),
        reasoningEffort: TRIGGER_ECONOMICI.has(params.trigger)
          ? "low"
          : "medium",
        signal: abort.signal,
      });
      registraUsage(res.usage);

      const testo = res.text;
      if (testo) esecuzione.riepilogo = testo;
      const toolUses = res.functionCalls;
      // Raggiunto il budget il modello riceve un unico turno senza
      // strumenti. Anche una risposta anomala che contenga ancora call non può
      // riaprire il ciclo o far crescere il contesto senza limite.
      if (chiusuraForzata) break;
      if (toolUses.length === 0) break;
      input.push(...res.output);

      // Il modello chiede più strumenti in un colpo: si eseguono insieme.
      // Sono letture indipendenti — aspettarle in fila allungava il giro
      // per niente. Il budget si conta prima, così resta deterministico
      // qualunque sia l'ordine in cui finiscono.
      const budget = toolUses.map(() => ++toolCalls <= config.maxToolCalls);
      const budgetEsaurito = budget.some(ok => !ok);
      const esiti = await Promise.all(
        toolUses.map((tu, i) =>
          budget[i]
            ? eseguiStrumento(rt, tu.name, tu.arguments)
            : Promise.resolve({
                content:
                  "Budget di chiamate a strumenti esaurito. Chiudi ora con il riepilogo di quanto raccolto.",
                isError: true,
              })
        )
      );

      const results: OpenAIInputItem[] = toolUses.map((tu, i) => {
        const out = esiti[i];
        esecuzione.strumenti.push({
          nome: tu.name,
          input: tu.arguments,
          esito: sintesiEsito(out),
        });
        return {
          type: "function_call_output",
          call_id: tu.callId,
          output: out.isError ? `ERRORE: ${out.content}` : out.content,
        };
      });
      input.push(...results);
      if (budgetEsaurito || toolCalls >= config.maxToolCalls) {
        esecuzione.esito = "budget_esaurito";
        chiusuraForzata = true;
      }

      // nessuna_azione: chiediamo comunque un ultimo turno di testo? No —
      // il motivo È il riepilogo. Terminazione immediata, zero sprechi.
      if (rt.terminato) {
        if (!esecuzione.riepilogo) esecuzione.riepilogo = rt.terminato.motivo;
        break;
      }
      // Raggiunto il budget lasciamo al modello UN turno finale (il prossimo
      // giro: i tool result dicono di chiudere, stop_reason sarà end_turn).
    }
  } catch (e: any) {
    if (e instanceof OpenAIResponseError) registraUsage(e.usage);
    esecuzione.esito = "errore";
    esecuzione.errore = abort.signal.aborted
      ? `Timeout esecuzione (${config.timeoutMs / 1000}s)`
      : (e?.message ?? String(e));
  } finally {
    clearTimeout(timer);
  }

  esecuzione.proposteIds = rt.proposteIds;
  esecuzione.toolCacheHits = rt.toolCacheHits ?? 0;
  esecuzione.proposteDuplicateBloccate = rt.duplicatiBloccati ?? 0;
  esecuzione.comunicazioniClassificateIds = Array.from(
    rt.comunicazioniClassificateIds ?? []
  );
  esecuzione.durataMs = Date.now() - start;
  esecuzioni.push(esecuzione);
  saveEsecuzioni();
  return esecuzione;
}
