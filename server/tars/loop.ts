// Loop agentico di Tars.
//
// Budget rigidi (config): max tool call, max proposte, timeout. Al limite
// il loop termina con quanto raccolto — mai run infinite. Ogni esecuzione
// finisce nel registro agente_esecuzioni, completa di strumenti chiamati,
// token e riepilogo: la direzione deve poter ricostruire PERCHÉ una
// proposta esiste.

import type { TrpcContext } from "../_core/context";
import {
  callAnthropic,
  type AnthropicMessage,
  type ContentBlock,
} from "./anthropic";
import { bloccoDecisioni, buildSystemPrompt } from "./prompt";
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

export async function runTars(params: {
  ctx: TrpcContext;
  trigger: string;
  commessaId: number | null;
  richiesta: string; // messaggio utente per il modello
  // Turni precedenti (chat): vengono anteposti alla richiesta così il
  // modello mantiene il filo. Solo testo — i tool-use passati non servono.
  storia?: AnthropicMessage[];
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
    richiesta: params.richiesta,
    profiloStrumenti,
    strumentiDisponibili: tools.length,
    toolCacheHits: 0,
    proposteDuplicateBloccate: 0,
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
    risultatiCache: new Map(),
    toolCacheHits: 0,
    duplicatiBloccati: 0,
  };

  const system = buildSystemPrompt(params.ctx.sedeId);
  // Le decisioni recenti cambiano a ogni approvazione. Stanno in coda al
  // turno utente, dopo tutto il prefisso in cache: così un click su «approva»
  // non invalida più system e strumenti, che sono la parte cara e immobile.
  const decisioni = bloccoDecisioni(params.ctx.sedeId);
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
  const messages: AnthropicMessage[] = [
    ...(params.storia ?? []),
    {
      role: "user",
      content: decisioni ? `${decisioni}\n\n${richiesta}` : richiesta,
    },
  ];

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), config.timeoutMs);

  try {
    let toolCalls = 0;

    while (true) {
      const res = await callAnthropic({
        model: modello,
        system,
        messages,
        tools,
        signal: abort.signal,
      });
      esecuzione.tokensIn += res.usage.input_tokens;
      esecuzione.tokensOut += res.usage.output_tokens;
      esecuzione.tokensCacheRead += res.usage.cache_read_input_tokens ?? 0;
      const scritture = res.usage.cache_creation;
      if (scritture) {
        esecuzione.tokensCacheWrite5m +=
          scritture.ephemeral_5m_input_tokens ?? 0;
        esecuzione.tokensCacheWrite1h +=
          scritture.ephemeral_1h_input_tokens ?? 0;
      } else {
        // Risposta senza il dettaglio: si conta al prezzo più basso dei due,
        // che è quello dei 5 minuti — la stima sbaglia per difetto, mai
        // facendo scattare un budget che invece era capiente.
        esecuzione.tokensCacheWrite5m +=
          res.usage.cache_creation_input_tokens ?? 0;
      }

      const testo = res.content
        .filter(
          (b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text"
        )
        .map(b => b.text)
        .join("\n")
        .trim();
      if (testo) esecuzione.riepilogo = testo;

      const toolUses = res.content.filter(
        (b): b is Extract<ContentBlock, { type: "tool_use" }> =>
          b.type === "tool_use"
      );

      if (res.stop_reason !== "tool_use" || toolUses.length === 0) break;

      messages.push({ role: "assistant", content: res.content });

      // Il modello chiede più strumenti in un colpo: si eseguono insieme.
      // Sono letture indipendenti — aspettarle in fila allungava il giro
      // per niente. Il budget si conta prima, così resta deterministico
      // qualunque sia l'ordine in cui finiscono.
      const budget = toolUses.map(() => ++toolCalls <= config.maxToolCalls);
      if (budget.some(ok => !ok)) esecuzione.esito = "budget_esaurito";

      const esiti = await Promise.all(
        toolUses.map((tu, i) =>
          budget[i]
            ? eseguiStrumento(rt, tu.name, tu.input ?? {})
            : Promise.resolve({
                content:
                  "Budget di chiamate a strumenti esaurito. Chiudi ora con il riepilogo di quanto raccolto.",
                isError: true,
              })
        )
      );

      const results: ContentBlock[] = toolUses.map((tu, i) => {
        const out = esiti[i];
        esecuzione.strumenti.push({
          nome: tu.name,
          input: tu.input ?? {},
          esito: sintesiEsito(out),
        });
        return {
          type: "tool_result",
          tool_use_id: tu.id,
          content: out.content,
          ...(out.isError ? { is_error: true } : {}),
        };
      });
      messages.push({ role: "user", content: results });

      // nessuna_azione: chiediamo comunque un ultimo turno di testo? No —
      // il motivo È il riepilogo. Terminazione immediata, zero sprechi.
      if (rt.terminato) {
        if (!esecuzione.riepilogo) esecuzione.riepilogo = rt.terminato.motivo;
        break;
      }
      // Oltre il budget lasciamo al modello UN turno finale (il prossimo
      // giro: i tool result dicono di chiudere, stop_reason sarà end_turn).
    }
  } catch (e: any) {
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
  esecuzione.durataMs = Date.now() - start;
  esecuzioni.push(esecuzione);
  saveEsecuzioni();
  return esecuzione;
}
