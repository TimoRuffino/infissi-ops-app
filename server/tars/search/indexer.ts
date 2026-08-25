import { createHash } from "node:crypto";
import type { SearchRepository } from "./repository";
import type { SearchEntityRef, VisibilityScope } from "./types";

export function chunkSearchText(
  text: string,
  size = 1_200,
  overlap = 150
): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const chunks: string[] = [];
  for (let start = 0; start < normalized.length; start += size - overlap) {
    chunks.push(normalized.slice(start, start + size));
    if (start + size >= normalized.length) break;
  }
  return chunks;
}

export async function indexSearchSource(input: {
  repository: SearchRepository;
  sedeId: number;
  scope: VisibilityScope;
  sourceType: string;
  sourceId: string;
  sourceVersion: string;
  text: string;
  entityRefs: SearchEntityRef[];
  occurredAt?: Date | null;
  embed?: (texts: string[]) => Promise<number[][]>;
}) {
  const contents = chunkSearchText(input.text);
  const embeddings = input.embed ? await input.embed(contents) : [];
  return input.repository.upsertSource({
    ...input,
    chunks: contents.map((content, index) => ({
      content,
      checksum: createHash("sha256").update(content).digest("hex"),
      entityRefs: input.entityRefs,
      occurredAt: input.occurredAt ?? null,
      embedding: embeddings[index] ?? null,
    })),
  });
}
