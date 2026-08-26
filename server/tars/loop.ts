// Loop agentico di Tars.
//
// Budget rigidi (config): max tool call, max proposte, timeout. Al limite
// il loop termina con quanto raccolto — mai run infinite. Ogni esecuzione
// finisce nel registro agente_esecuzioni, completa di strumenti chiamati,
// token e riepilogo: la direzione deve poter ricostruire PERCHÉ una
// proposta esiste.

import type { TrpcContext } from "../_core/context";
import { can, type CapabilityOverride } from "../authz/policy";
import { getPolicyRepository } from "../authz/repository";
import { getFeatureFlags } from "../platform/featureFlags";
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
  currentExecutionVersions,
  type Esecuzione,
} from "./stores";
import { getContextRepository } from "./context/repository";
import type {
  EntityContextKey,
  EntityContextSnapshot,
  EvidenceRef,
} from "./context/types";
import { routeIntent } from "./planner/router";
import type { IntentDecision, TrustedIntentHint } from "./planner/intents";

export function visibilityScopeForUser(
  user: unknown,
  sedeId: number,
  overrides: CapabilityOverride[] = []
): EntityContextKey["scope"] {
  const policyUser = user as Parameters<typeof can>[0]["user"];
  const economy = can({
    user: policyUser,
    capability: "economia.read",
    activeSedeId: sedeId,
    overrides,
  });
  if (!economy.allowed) return "operativo";
  const managesPolicy = can({
    user: policyUser,
    capability: "tars.manage_policy",
    activeSedeId: sedeId,
    overrides,
  });
  return managesPolicy.allowed ? "direzione" : "amministrazione";
}

function evidenceKey(item: EvidenceRef): string {
  return `${item.sourceType}:${item.sourceId}:${item.version}`;
}

function uniqueEvidence(items: EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = evidenceKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildContextPreload(snapshot: EntityContextSnapshot): {
  content: string;
  useLiveFallback: boolean;
  evidenceRefs: EvidenceRef[];
  factsRead: number;
} {
  if (!snapshot.definitive || snapshot.stale || snapshot.state !== "ready") {
    return {
      content: `<contesto_entita_stale fingerprint="${snapshot.fingerprint}">\nIl fascicolo sintetico è scaduto e non è una fonte definitiva. Verifica i dati live prima di concludere o proporre azioni.\n</contesto_entita_stale>`,
      useLiveFallback: true,
      evidenceRefs: [],
      factsRead: 0,
    };
  }

  const facts = snapshot.facts.slice(0, 30).map(fact => ({
    tipo: fact.confidence === "certain" ? "fatto_verificato" : "inferenza",
    chiave: fact.key,
    valore: fact.value,
    evidenceIds: fact.evidence.map(evidenceKey),
  }));
  const evidenceRefs = uniqueEvidence(
    snapshot.facts.flatMap(fact => fact.evidence)
  ).slice(0, 60);
  const compact = {
    fingerprint: snapshot.fingerprint,
    scope: snapshot.key.scope,
    aggiornatoAt: snapshot.createdAt,
    sintesi: snapshot.summary,
    fatti: facts,
    prove: evidenceRefs,
  };
  return {
    content: `<contesto_entita_verificato fingerprint="${snapshot.fingerprint}" scope="${snapshot.key.scope}">\n${JSON.stringify(compact)}\n</contesto_entita_verificato>`,
    useLiveFallback: false,
    evidenceRefs,
    factsRead: facts.length,
  };
}

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
  // Fonti già verificate dal trigger deterministico (es. fatture del lotto).
  evidenceRefs?: EvidenceRef[];
  // Hint costruito da un controllo UI/server noto, mai da testo esterno.
  intentHint?: TrustedIntentHint;
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
  const sedeId = params.ctx.sedeId ?? 1;
  const featureFlags = getFeatureFlags(sedeId);
  let routedIntent: IntentDecision | null = null;
  if (
    featureFlags.plannerMode === "active" &&
    ["chat", "chat_operatore", "on_demand"].includes(params.trigger)
  ) {
    routedIntent = await routeIntent({
      request: params.richiesta,
      trigger: params.trigger,
      sedeId,
      commessaId: params.commessaId,
      comunicazioneId: params.comunicazioneId,
      source: "operator",
      serverHint: params.intentHint,
    });
  }
  const workflow = routedIntent?.workflow ?? null;
  const tools = toolDefsForTrigger(params.trigger, workflow);
  const profiloStrumenti = toolProfileForTrigger(params.trigger, workflow);
  const contextMode = featureFlags.contextEngineMode;
  let contextScope: EntityContextKey["scope"] | null = null;
  let contextSnapshot: EntityContextSnapshot | null = null;
  if (
    params.commessaId != null &&
    contextMode !== "off" &&
    tools.some(tool => tool.name === "leggi_fascicolo_commessa")
  ) {
    let overrides: CapabilityOverride[] = [];
    const userId = Number((params.ctx.user as any)?.id);
    if (Number.isSafeInteger(userId) && userId > 0) {
      try {
        overrides = await getPolicyRepository().listEffectiveOverrides({
          sedeId,
          userId,
          now: new Date(),
        });
      } catch {
        // Un guasto al registro deleghe non deve allargare la visibilità:
        // senza override si applicano soltanto le capability del ruolo.
        overrides = [];
      }
    }
    contextScope = visibilityScopeForUser(params.ctx.user, sedeId, overrides);
    try {
      contextSnapshot = await getContextRepository().getLatest({
        key: {
          sedeId,
          entityType: "commessa",
          entityId: params.commessaId,
          scope: contextScope,
        },
        now: new Date(),
      });
    } catch {
      // Il contesto incrementale è un acceleratore, non un single point of
      // failure: il preload live sottostante conserva il comportamento.
      contextSnapshot = null;
    }
  }

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
    azioniAutonome: [],
    comunicazioniClassificateIds: [],
    fascicoloPrecaricato: false,
    contextFingerprint: contextSnapshot?.fingerprint ?? null,
    contextScope,
    contextCacheHit: false,
    evidenceRefs: [],
    factsRead: 0,
    factsRevalidated: 0,
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
    ...currentExecutionVersions(),
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
    contextScope,
    evidenceRefs: [
      ...(params.evidenceRefs ?? []),
      ...(params.comunicazioneId != null
        ? [
            {
              sourceType: "comunicazione",
              sourceId: String(params.comunicazioneId),
              label: `Comunicazione #${params.comunicazioneId}`,
              version: `run:${esecuzione.id}`,
            } satisfies EvidenceRef,
          ]
        : []),
      ...(["on_demand", "chat", "chat_operatore", "seguito"].includes(
        params.trigger
      )
        ? [
            {
              sourceType: "operatore",
              sourceId: String((params.ctx.user as any)?.id ?? "unknown"),
              label: "Richiesta esplicita dell'operatore",
              version: `run:${esecuzione.id}`,
            } satisfies EvidenceRef,
          ]
        : []),
    ],
    factsRead: 0,
    factsRevalidated: 0,
  };

  const system = buildSystemPromptForTrigger(params.ctx.sedeId, params.trigger);
  // Le decisioni recenti cambiano a ogni approvazione. Stanno in coda al
  // turno utente, dopo tutto il prefisso in cache: così un click su «approva»
  // non invalida più system e strumenti, che sono la parte cara e immobile.
  const decisioni =
    params.trigger === "smistamento" ? "" : bloccoDecisioni(params.ctx.sedeId);
  let richiesta = params.richiesta;
  if (routedIntent) {
    richiesta = `<intent_router intent="${routedIntent.intent}" workflow="${routedIntent.workflow ?? "none"}" confidence="${routedIntent.confidence.toFixed(2)}" needs_clarification="${routedIntent.needsClarification}">
Profilo strumenti già limitato dal server. Capability richieste: ${routedIntent.requiredCapabilities.join(", ") || "nessuna"}.
${
  routedIntent.needsClarification
    ? "La richiesta è ambigua: non proporre effetti. Usa chiedi_chiarimento per ottenere il dato mancante."
    : "Resta nel workflow indicato; amplia la ricerca solo se i dati dimostrano che il dominio è errato."
}
</intent_router>

${richiesta}`;
  }
  if (
    params.commessaId != null &&
    tools.some(tool => tool.name === "leggi_fascicolo_commessa")
  ) {
    const preload =
      contextMode === "active" && contextSnapshot
        ? buildContextPreload(contextSnapshot)
        : null;
    if (preload && !preload.useLiveFallback) {
      esecuzione.fascicoloPrecaricato = true;
      esecuzione.contextCacheHit = true;
      rt.evidenceRefs = uniqueEvidence([
        ...(rt.evidenceRefs ?? []),
        ...preload.evidenceRefs,
      ]);
      rt.factsRead = preload.factsRead;
      richiesta = `${preload.content}

Il fascicolo sintetico sopra è già verificato e limitato allo scope dell'operatore.
Usa i riferimenti di prova; chiedi letture live soltanto per dettagli assenti.

${richiesta}`;
    } else {
      const fascicolo = await eseguiStrumento(rt, "leggi_fascicolo_commessa", {
        commessaId: params.commessaId,
      });
      if (!fascicolo.isError) {
        esecuzione.fascicoloPrecaricato = true;
        richiesta = `${preload?.content ? `${preload.content}\n\n` : ""}<fascicolo_commessa_live id="${params.commessaId}" scope="${contextScope ?? "ruolo"}">
${fascicolo.content}
</fascicolo_commessa_live>

Il fascicolo live sopra sostituisce qualsiasi sintesi scaduta. Usalo come fonte
iniziale e chiedi strumenti aggiuntivi solo per dettagli non presenti.

${richiesta}`;
      }
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
  esecuzione.evidenceRefs = uniqueEvidence(rt.evidenceRefs ?? []).slice(0, 60);
  esecuzione.factsRead = rt.factsRead ?? 0;
  esecuzione.factsRevalidated = rt.factsRevalidated ?? 0;
  esecuzione.durataMs = Date.now() - start;
  esecuzioni.push(esecuzione);
  saveEsecuzioni();
  // Autonomia: le proposte appena create dei tipi abilitati vengono eseguite
  // subito e annunciate in chat. Fuori dal try principale — un problema qui
  // non deve trasformare un run riuscito in un errore, e le proposte restano
  // comunque pendenti e approvabili a mano.
  esecuzione.azioniAutonome = await eseguiAutonomia(
    params.ctx.sedeId ?? 1,
    rt.proposteIds
  );
  if (esecuzione.azioniAutonome.length > 0) saveEsecuzioni();
  return esecuzione;
}

/**
 * Esegue in autonomia le proposte di un run. Il ponte verso il router è un
 * import dinamico: `routers/tars.ts` importa questo modulo, e un import
 * statico chiuderebbe il ciclo.
 */
async function eseguiAutonomia(
  sedeId: number,
  proposteIds: readonly number[]
): Promise<Array<{ propostaId: number; titolo: string; eseguita: boolean }>> {
  if (proposteIds.length === 0) return [];
  try {
    const [{ eseguiProposteAutonome }, { approvaPropostaComeSistema }, annunci] =
      await Promise.all([
        import("./autonomy/runner"),
        import("../routers/tars"),
        import("../chat/annunci"),
      ]);
    const azioni = await eseguiProposteAutonome({
      sedeId,
      propostaIds: proposteIds,
      approva: approvaPropostaComeSistema,
      annuncia: eseguite =>
        annunci.annunciaAzioniAutonome({ sedeId, azioni: eseguite }),
    });
    return azioni.map(azione => ({
      propostaId: azione.propostaId,
      titolo: azione.titolo,
      eseguita: azione.eseguita,
    }));
  } catch (errore: any) {
    console.error(
      `[tars] autonomia sede ${sedeId} non applicata:`,
      errore?.message ?? errore
    );
    return [];
  }
}
