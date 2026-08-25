import { getSearchRepository, type SearchRepository } from "./repository";
import type {
  SearchChunk,
  SearchEntityRef,
  SearchHit,
  VisibilityScope,
} from "./types";

function allowedScopes(scope: VisibilityScope): VisibilityScope[] {
  if (scope === "direzione")
    return ["operativo", "amministrazione", "direzione"];
  if (scope === "amministrazione") return ["operativo", "amministrazione"];
  return ["operativo"];
}

function cosine(a: number[] | null, b: number[] | undefined): number {
  if (!a || !b || a.length !== b.length || !a.length) return 0;
  let dot = 0,
    aa = 0,
    bb = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    aa += a[index] ** 2;
    bb += b[index] ** 2;
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

function lexicalScore(query: string, content: string) {
  const normalized = query.toLowerCase().trim();
  const haystack = content.toLowerCase();
  if (haystack.includes(normalized)) return 1;
  const terms = normalized.split(/\s+/).filter(term => term.length > 1);
  return terms.length
    ? terms.filter(term => haystack.includes(term)).length / terms.length
    : 0;
}

function entityMatch(chunk: SearchChunk, refs: SearchEntityRef[]) {
  return refs.some(ref =>
    chunk.entityRefs.some(item => item.type === ref.type && item.id === ref.id)
  );
}

export async function hybridSearch(input: {
  query: string;
  sedeId: number;
  userId: number;
  scope: VisibilityScope;
  entityRefs?: SearchEntityRef[];
  limit?: number;
  queryEmbedding?: number[];
  repository?: SearchRepository;
  canReadSource?: (chunk: SearchChunk, userId: number) => Promise<boolean>;
}): Promise<SearchHit[]> {
  const query = input.query.trim().slice(0, 500);
  if (!query) return [];
  const repository = input.repository ?? getSearchRepository();
  const candidates = await repository.searchCandidates({
    query,
    sedeId: input.sedeId,
    scopes: allowedScopes(input.scope),
    limit: 80,
  });
  const refs = input.entityRefs ?? [];
  const ranked = candidates
    .map(chunk => {
      const lexical = lexicalScore(query, chunk.content);
      const identifier =
        /(?:COM-\d{4}-\w+|[\w.+-]+@[\w.-]+|\d{6,})/i.test(query) &&
        chunk.content.toLowerCase().includes(query.toLowerCase());
      const structured = entityMatch(chunk, refs);
      const semantic = cosine(chunk.embedding, input.queryEmbedding);
      return {
        chunk,
        score:
          (identifier ? 10 : 0) + (structured ? 6 : 0) + lexical * 3 + semantic,
      };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || b.chunk.id - a.chunk.id);
  const hits: SearchHit[] = [];
  for (const item of ranked) {
    if (hits.length >= Math.min(Math.max(input.limit ?? 8, 1), 8)) break;
    if (
      input.canReadSource &&
      !(await input.canReadSource(item.chunk, input.userId))
    )
      continue;
    hits.push({
      sourceType: item.chunk.sourceType,
      sourceId: item.chunk.sourceId,
      snippet: item.chunk.content.slice(0, 500),
      score: Number(item.score.toFixed(4)),
      entityRefs: item.chunk.entityRefs,
      evidenceRef: {
        sourceType: item.chunk.sourceType,
        sourceId: item.chunk.sourceId,
        label: `${item.chunk.sourceType} #${item.chunk.sourceId}`,
        version: item.chunk.sourceVersion,
      },
    });
  }
  return hits;
}
