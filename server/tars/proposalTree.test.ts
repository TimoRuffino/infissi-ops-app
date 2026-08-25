import { describe, expect, it } from "vitest";
import type { Proposta } from "./stores";
import { collectProposalTree } from "./proposalTree";

function proposal(
  id: number,
  origineId: number | null,
  sedeId = 1,
  second = id
): Proposta {
  return {
    id,
    origineId,
    sedeId,
    createdAt: new Date(`2026-08-25T10:00:${String(second).padStart(2, "0")}Z`),
  } as Proposta;
}

describe("proposal tree", () => {
  it("include tutti i discendenti nello stesso flusso", () => {
    const items = [proposal(10, null), proposal(11, 10), proposal(12, 11)];
    expect(collectProposalTree([10], items, 1).map(item => item.id)).toEqual([
      10, 11, 12,
    ]);
  });

  it("deduplica radici convergenti e mantiene ordine stabile", () => {
    const items = [
      proposal(10, null, 1, 10),
      proposal(11, 10, 1, 12),
      proposal(12, 10, 1, 11),
      proposal(13, 12, 1, 13),
    ];
    expect(collectProposalTree([10, 12], items, 1).map(item => item.id)).toEqual([
      10, 12, 11, 13,
    ]);
  });

  it("ignora altra sede e interrompe cicli corrotti", () => {
    const items = [
      proposal(10, 12),
      proposal(11, 10),
      proposal(12, 11),
      proposal(13, 10, 2),
    ];
    expect(collectProposalTree([10], items, 1).map(item => item.id)).toEqual([
      10, 11, 12,
    ]);
  });
});
