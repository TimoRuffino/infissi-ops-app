import { describe, expect, it } from "vitest";
import { createMemorySearchRepository } from "./repository";
import { hybridSearch } from "./retriever";

async function seed() {
  const repository = createMemorySearchRepository();
  await repository.upsertSource({
    sedeId: 1,
    scope: "operativo",
    sourceType: "email",
    sourceId: "1",
    sourceVersion: "v1",
    chunks: [
      {
        content: "Richiesta finestre per COM-2026-017",
        checksum: "a",
        entityRefs: [{ type: "commessa", id: "17" }],
        occurredAt: null,
        embedding: [0.1, 0.2],
      },
    ],
  });
  await repository.upsertSource({
    sedeId: 2,
    scope: "operativo",
    sourceType: "email",
    sourceId: "2",
    sourceVersion: "v1",
    chunks: [
      {
        content: "Segreto COM-2026-017",
        checksum: "b",
        entityRefs: [],
        occurredAt: null,
        embedding: [1, 1],
      },
    ],
  });
  await repository.upsertSource({
    sedeId: 1,
    scope: "direzione",
    sourceType: "documento",
    sourceId: "3",
    sourceVersion: "v1",
    chunks: [
      {
        content: "Margine riservato finestre",
        checksum: "c",
        entityRefs: [],
        occurredAt: null,
        embedding: [1, 1],
      },
    ],
  });
  return repository;
}

describe("hybrid search", () => {
  it("esclude altra sede e scope non autorizzato prima del ranking", async () => {
    const repository = await seed();
    const hits = await hybridSearch({
      query: "finestre",
      sedeId: 1,
      userId: 7,
      scope: "operativo",
      repository,
    });
    expect(hits.map(hit => `${hit.sourceType}:${hit.sourceId}`)).toEqual([
      "email:1",
    ]);
  });

  it("rimuove tutti i chunk quando la fonte viene cancellata", async () => {
    const repository = await seed();
    await repository.deleteSource({
      sedeId: 1,
      sourceType: "email",
      sourceId: "1",
      now: new Date(),
    });
    expect(
      await hybridSearch({
        query: "COM-2026-017",
        sedeId: 1,
        userId: 7,
        scope: "direzione",
        repository,
      })
    ).toEqual([]);
  });

  it("fa vincere identificativo ed entity ref sulla sola similarita", async () => {
    const repository = await seed();
    await repository.upsertSource({
      sedeId: 1,
      scope: "operativo",
      sourceType: "nota",
      sourceId: "4",
      sourceVersion: "v1",
      chunks: [
        {
          content: "Finestre molto simili",
          checksum: "d",
          entityRefs: [],
          occurredAt: null,
          embedding: [1, 1],
        },
      ],
    });
    const hits = await hybridSearch({
      query: "COM-2026-017",
      sedeId: 1,
      userId: 7,
      scope: "operativo",
      entityRefs: [{ type: "commessa", id: "17" }],
      queryEmbedding: [1, 1],
      repository,
    });
    expect(hits[0]).toMatchObject({ sourceType: "email", sourceId: "1" });
  });

  it("restituisce al massimo otto frammenti e rivalida ogni fonte", async () => {
    const repository = createMemorySearchRepository();
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        repository.upsertSource({
          sedeId: 1,
          scope: "operativo",
          sourceType: "nota",
          sourceId: String(index),
          sourceVersion: "v1",
          chunks: [
            {
              content: `posa infissi ${index}`,
              checksum: String(index),
              entityRefs: [],
              occurredAt: null,
              embedding: null,
            },
          ],
        })
      )
    );
    const read = async (chunk: any) => chunk.sourceId !== "0";
    const hits = await hybridSearch({
      query: "posa infissi",
      sedeId: 1,
      userId: 7,
      scope: "operativo",
      limit: 20,
      repository,
      canReadSource: read,
    });
    expect(hits).toHaveLength(8);
    expect(hits.some(hit => hit.sourceId === "0")).toBe(false);
  });
});
