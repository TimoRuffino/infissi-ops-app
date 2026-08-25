import { describe, expect, it } from "vitest";
import {
  buildCommandCenterSnapshot,
  rankTarsPriorities,
  type TarsPriority,
} from "./commandCenter";

function priority(overrides: Partial<TarsPriority>): TarsPriority {
  return {
    id: "proposta:1",
    canonicalKey: "ticket:1",
    title: "Richiamare il cliente",
    conclusion: "Serve una decisione oggi",
    reason: "Il cliente attende una risposta",
    confidence: "alta",
    urgency: 80,
    impact: 70,
    dueAt: null,
    clienteId: 2,
    commessaId: 3,
    proposalId: 1,
    evidence: [{ type: "commessa", id: "3", label: "COM-3", occurredAt: null }],
    createdAt: new Date("2026-08-22T08:00:00Z"),
    ...overrides,
  };
}

describe("Tars command center", () => {
  it("ordina in modo stabile per urgenza, impatto e confidenza", () => {
    const ranked = rankTarsPriorities([
      priority({
        id: "ticket:9",
        canonicalKey: "ticket:9",
        urgency: 80,
        impact: 70,
        confidence: "alta",
      }),
      priority({
        id: "fattura:7",
        canonicalKey: "fattura:7",
        urgency: 60,
        impact: 95,
        confidence: "alta",
      }),
    ]);

    expect(ranked.map(item => item.id)).toEqual(["ticket:9", "fattura:7"]);
  });

  it("deduplica per chiave canonica e scarta priorità senza prove", () => {
    const ranked = rankTarsPriorities([
      priority({ id: "prima", canonicalKey: "azione:1" }),
      priority({ id: "doppione", canonicalKey: "azione:1", urgency: 20 }),
      priority({ id: "senza-prove", canonicalKey: "azione:2", evidence: [] }),
    ]);

    expect(ranked.map(item => item.id)).toEqual(["prima"]);
  });

  it("costruisce un brief deterministico senza chiamare il modello", () => {
    const snapshot = buildCommandCenterSnapshot({
      now: new Date("2026-08-22T10:00:00Z"),
      active: true,
      openaiReady: true,
      proposals: [
        {
          id: 12,
          tipo: "domanda",
          titolo: "A chi assegno il nuovo preventivo?",
          motivazione: "Manca l'assegnatario",
          confidenza: "alta",
          payload: { comunicazioneId: 44 },
          commessaId: null,
          clienteId: null,
          chiaveAzione: "domanda:assegnatario:44",
          evidenceRefs: [
            {
              sourceType: "comunicazione",
              sourceId: "44",
              label: "Richiesta preventivo Rossi",
              version: "2026-08-22T09:25:00.000Z",
            },
          ],
          createdAt: new Date("2026-08-22T09:30:00Z"),
        },
      ],
      executions: [
        {
          id: 9,
          esito: "ok",
          createdAt: new Date("2026-08-22T09:40:00Z"),
          toolCacheHits: 3,
          proposteDuplicateBloccate: 2,
          tokensCacheRead: 800,
          tokensIn: 200,
          comunicazioneId: 44,
          contextCacheHit: true,
          factsRead: 8,
          factsRevalidated: 2,
        },
      ],
    });

    expect(snapshot.status).toBe("ready");
    expect(snapshot.brief.title).toBe("1 decisione richiede attenzione");
    expect(snapshot.priorities[0]).toMatchObject({
      proposalId: 12,
      evidence: [
        {
          type: "email",
          id: "44",
          label: "Richiesta preventivo Rossi",
        },
      ],
    });
    expect(snapshot.metrics).toMatchObject({
      pending: 1,
      duplicateAvoided: 2,
      toolCacheHits: 3,
      cacheReadPercent: 80,
      contextCacheHits: 1,
      factsRead: 8,
      factsRevalidated: 2,
      evidenceCoveragePercent: 100,
    });
  });
});
