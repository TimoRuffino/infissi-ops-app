import type { Proposta } from "./stores";

function compareProposals(a: Proposta, b: Proposta): number {
  const time = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  return time || a.id - b.id;
}

export function collectProposalTree(
  rootIds: number[],
  all: Proposta[],
  sedeId: number
): Proposta[] {
  const scoped = all.filter(item => item.sedeId === sedeId);
  const byId = new Map(scoped.map(item => [item.id, item]));
  const children = new Map<number, Proposta[]>();
  for (const item of scoped) {
    if (item.origineId == null) continue;
    const current = children.get(item.origineId) ?? [];
    current.push(item);
    children.set(item.origineId, current);
  }
  for (const items of Array.from(children.values())) {
    items.sort(compareProposals);
  }

  const queue = rootIds
    .map(id => byId.get(id))
    .filter((item): item is Proposta => item != null)
    .sort(compareProposals);
  const result: Proposta[] = [];
  const visited = new Set<number>();

  while (queue.length > 0) {
    const item = queue.shift()!;
    if (visited.has(item.id)) continue;
    visited.add(item.id);
    result.push(item);
    queue.push(...(children.get(item.id) ?? []));
  }
  return result;
}
