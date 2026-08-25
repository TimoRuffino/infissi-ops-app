import { z } from "zod";
import { getFeatureFlags } from "../../platform/featureFlags";
import { callOpenAI } from "../openai";
import { getTarsConfig } from "../stores";
import { collectEntityFacts } from "./collectors";
import { fingerprintContext } from "./fingerprint";
import { getContextRepository, type ContextRepository } from "./repository";
import type {
  ContextFact,
  ContextSummary,
  EntityContextKey,
  EntityContextSnapshot,
} from "./types";

export const CONTEXT_SCHEMA_VERSION = "1";
export const CONTEXT_COLLECTOR_VERSION = "1";
const CONTEXT_TTL_MS = 30 * 60_000;

const summaryItemSchema = z.object({
  text: z.string().min(1).max(500),
  evidenceIds: z.array(z.string().min(1)).max(8),
});
const summarySchema = z.object({
  summary: z.string().min(1).max(2_000),
  openQuestions: z.array(summaryItemSchema).max(10),
  risks: z.array(summaryItemSchema).max(10),
  nextActions: z.array(summaryItemSchema).max(10),
});

function summaryItemJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      text: { type: "string" },
      evidenceIds: { type: "array", items: { type: "string" } },
    },
    required: ["text", "evidenceIds"],
  };
}

const SUMMARY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    openQuestions: { type: "array", items: summaryItemJsonSchema() },
    risks: { type: "array", items: summaryItemJsonSchema() },
    nextActions: { type: "array", items: summaryItemJsonSchema() },
  },
  required: ["summary", "openQuestions", "risks", "nextActions"],
};

export type ContextSynthesizer = (input: {
  key: EntityContextKey;
  facts: ContextFact[];
  evidenceIds: string[];
}) => Promise<ContextSummary>;

function evidenceId(item: ContextFact["evidence"][number]) {
  return `${item.sourceType}:${item.sourceId}:${item.version}`;
}

async function defaultSynthesizer(
  input: Parameters<ContextSynthesizer>[0]
): Promise<ContextSummary> {
  const config = getTarsConfig(input.key.sedeId);
  const response = await callOpenAI({
    model: config.modelloAutomatico,
    instructions:
      "Sintetizza un fascicolo aziendale esclusivamente dai fatti forniti. Ogni rischio, domanda e prossima azione deve citare evidenceIds presenti. Non inventare relazioni o dati mancanti.",
    input: [
      {
        role: "user",
        content: JSON.stringify({
          entity: input.key,
          evidenceIds: input.evidenceIds,
          facts: input.facts,
        }),
      },
    ],
    tools: [],
    maxTokens: 1_200,
    reasoningEffort: "low",
    promptCacheKey: `tars:context:${input.key.sedeId}:${input.key.scope}:${config.modelloAutomatico}:v1`,
    responseFormat: {
      name: "tars_entity_context",
      schema: SUMMARY_JSON_SCHEMA,
    },
  });
  return summarySchema.parse(JSON.parse(response.text));
}

function safeErrorCode(error: unknown): string {
  const raw =
    error instanceof Error ? error.message : "CONTEXT_SYNTHESIS_FAILED";
  return (raw.trim().split(/\s+/)[0] || "CONTEXT_SYNTHESIS_FAILED")
    .toUpperCase()
    .replace(/[^A-Z0-9_.:-]/g, "_")
    .slice(0, 120);
}

export async function rebuildEntityContext(input: {
  key: EntityContextKey;
  repository?: ContextRepository;
  collect?: typeof collectEntityFacts;
  synthesize?: ContextSynthesizer;
  policyVersion?: string;
  schemaVersion?: string;
  collectorVersion?: string;
  now?: Date;
}): Promise<{
  snapshot: EntityContextSnapshot | null;
  cacheHit: boolean;
  modelCalled: boolean;
  failed: boolean;
  sourceVersions: Record<string, string>;
}> {
  const repository = input.repository ?? getContextRepository();
  const collect = input.collect ?? collectEntityFacts;
  const synthesize = input.synthesize ?? defaultSynthesizer;
  const now = input.now ?? new Date();
  const policyVersion =
    input.policyVersion ??
    `policy-${getFeatureFlags(input.key.sedeId).policyMode}-v1`;
  const schemaVersion = input.schemaVersion ?? CONTEXT_SCHEMA_VERSION;
  const collectorVersion = input.collectorVersion ?? CONTEXT_COLLECTOR_VERSION;
  const collected = await collect(input.key);
  if (!collected) {
    return {
      snapshot: null,
      cacheHit: false,
      modelCalled: false,
      failed: false,
      sourceVersions: {},
    };
  }

  const previousVersions = await repository.listVersions(input.key);
  const previousValid =
    previousVersions.find(version => version.state === "ready") ?? null;
  const fingerprint = fingerprintContext({
    facts: collected.facts,
    schemaVersion,
    policyVersion,
    collectorVersion,
  });
  const saved = await repository.saveVersion({
    key: input.key,
    schemaVersion,
    collectorVersion,
    policyVersion,
    fingerprint,
    facts: collected.facts,
    summary: null,
    state: "facts_only",
    createdAt: now,
    expiresAt: new Date(now.getTime() + CONTEXT_TTL_MS),
  });
  if (!saved.created && saved.snapshot.state === "ready") {
    return {
      snapshot: saved.snapshot,
      cacheHit: true,
      modelCalled: false,
      failed: false,
      sourceVersions: collected.sourceVersions,
    };
  }

  try {
    const evidenceIds = Array.from(
      new Set(collected.facts.flatMap(item => item.evidence.map(evidenceId)))
    );
    const summary = await synthesize({
      key: input.key,
      facts: collected.facts,
      evidenceIds,
    });
    const completed = await repository.completeVersion({
      key: input.key,
      version: saved.snapshot.version,
      summary,
      expiresAt: new Date(now.getTime() + CONTEXT_TTL_MS),
    });
    return {
      snapshot: completed,
      cacheHit: false,
      modelCalled: true,
      failed: false,
      sourceVersions: collected.sourceVersions,
    };
  } catch (error) {
    await repository.markVersionFailed({
      key: input.key,
      version: saved.snapshot.version,
      errorCode: safeErrorCode(error),
    });
    const restored = previousValid
      ? await repository.activateVersion({
          key: input.key,
          version: previousValid.version,
          now,
        })
      : null;
    return {
      snapshot: restored,
      cacheHit: false,
      modelCalled: true,
      failed: true,
      sourceVersions: collected.sourceVersions,
    };
  }
}
