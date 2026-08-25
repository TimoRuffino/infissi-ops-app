import { describe, expect, it } from "vitest";
import type { TrpcContext } from "../../_core/context";
import { eseguiStrumento, TOOL_DEFS, type ToolRuntime } from "../tools";
import { getSearchRepository } from "./repository";

describe("ricerca_ibrida tool", () => {
  it("resta bloccata finche la pipeline semantica non e attiva", async () => {
    const repository = getSearchRepository();
    await repository.upsertSource({
      sedeId: 781,
      scope: "operativo",
      sourceType: "conoscenza",
      sourceId: "9001",
      sourceVersion: "v1",
      chunks: [
        {
          content:
            "La procedura per il sopralluogo richiede conferma appuntamento.",
          checksum: "tool-1",
          entityRefs: [],
          occurredAt: null,
          embedding: null,
        },
      ],
    });
    const ctx = {
      user: {
        id: 17,
        role: "user",
        ruolo: "commerciale",
        ruoli: ["commerciale"],
      },
      sedeId: 781,
      sediIds: [781],
      req: { protocol: "http", headers: {} },
      res: {},
    } as TrpcContext;
    const runtime: ToolRuntime = {
      ctx,
      esecuzioneId: 1,
      trigger: "on_demand",
      maxProposte: 3,
      proposteIds: [],
      terminato: null,
      evidenceRefs: [],
    };

    const result = await eseguiStrumento(runtime, "ricerca_ibrida", {
      query: "sopralluogo",
    });

    expect(TOOL_DEFS.some(tool => tool.name === "ricerca_ibrida")).toBe(true);
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/non attiva/i);
    expect(runtime.evidenceRefs).toEqual([]);
  });
});
