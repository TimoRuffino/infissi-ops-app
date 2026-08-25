import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { upsertCostiFic, ficCosti } from "../routers/ficCosti";
import { classificaCostiFic } from "./classificaCostiFic";
import { toOpenAIResponse } from "./openaiTestHelpers";

describe("classificatore costi FiC", () => {
  const realFetch = global.fetch;

  beforeAll(() => {
    process.env.OPENAI_API_KEY = "test-key";
  });

  afterAll(() => {
    global.fetch = realFetch;
    delete process.env.OPENAI_API_KEY;
  });

  it("classifica un lotto con output strutturato e cache key stabile", async () => {
    const sedeId = 85;
    upsertCostiFic(
      [
        {
          id: 88501,
          tipo: "expense",
          data: "2026-08-10",
          fornitoreId: 501,
          fornitoreNome: "Energia Test 88501",
          categoriaFic: "Utenze",
          descrizione: "Bolletta energia showroom",
          centro: null,
          numeroDocumento: "EN-1",
          importoNetto: 500,
          importoIva: 110,
          importoLordo: 610,
          rate: [],
        },
        {
          id: 88502,
          tipo: "expense",
          data: "2026-08-11",
          fornitoreId: 502,
          fornitoreNome: "Serramenti Test 88502",
          categoriaFic: "Materiali",
          descrizione: "Infissi commessa RF-2026-20",
          centro: "RF-2026-20",
          numeroDocumento: "MA-1",
          importoNetto: 2_000,
          importoIva: 440,
          importoLordo: 2_440,
          rate: [],
        },
      ],
      sedeId,
      "ai-a"
    );

    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.prompt_cache_key).toBe(
        "tars:v1:s85:classifica-costi-fic:gpt-5.6-terra"
      );
      expect(body.input.at(-1).content).toContain("88501");
      expect(body.input.at(-1).content).toContain("88502");
      expect(body.text.format.type).toBe("json_schema");
      return {
        ok: true,
        json: async () =>
          toOpenAIResponse({
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  risultati: [
                    {
                      id: 88501,
                      classificazione: "fisso",
                      confidenza: 0.96,
                      motivazione: "Utenza ricorrente dello showroom.",
                    },
                    {
                      id: 88502,
                      classificazione: "variabile_commessa",
                      confidenza: 0.98,
                      motivazione: "Materiale riferito alla commessa.",
                    },
                  ],
                }),
              },
            ],
          }),
        text: async () => "",
      } as Response;
    });
    global.fetch = fetchMock as any;

    const esito = await classificaCostiFic(sedeId, [88501, 88502]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(esito).toMatchObject({ classificati: 2, dubbi: 0, errore: null });
    expect(
      ficCosti.find(c => c.id === 88501 && c.sedeId === sedeId)
    ).toMatchObject({ classificazione: "fisso", fonteClassificazione: "tars" });
    expect(
      ficCosti.find(c => c.id === 88502 && c.sedeId === sedeId)
    ).toMatchObject({
      classificazione: "variabile_commessa",
      fonteClassificazione: "tars",
    });
  });

  it("lascia il costo dubbio quando OpenAI fallisce", async () => {
    const sedeId = 86;
    const record = {
      id: 88601,
      tipo: "expense" as const,
      data: "2026-08-12",
      fornitoreId: null,
      fornitoreNome: "Fornitore incerto 88601",
      categoriaFic: null,
      descrizione: "Servizi vari",
      centro: null,
      numeroDocumento: null,
      importoNetto: 300,
      importoIva: 66,
      importoLordo: 366,
      rate: [],
    };
    upsertCostiFic([record], sedeId, "ai-b");
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      statusText: "Server Error",
      text: async () => "provider detail",
    })) as any;

    const esito = await classificaCostiFic(sedeId, [88601]);

    expect(esito.classificati).toBe(0);
    expect(esito.dubbi).toBe(1);
    expect(esito.errore).toContain("temporaneamente non disponibile");
    expect(ficCosti.find(c => c.id === 88601)!.classificazione).toBe("dubbio");
    expect(
      upsertCostiFic([record], sedeId, "ai-b-retry").idsDaClassificare
    ).toEqual([88601]);
  });

  it("divide oltre cento costi in lotti senza perderne nessuno", async () => {
    const sedeId = 87;
    const rows = Array.from({ length: 101 }, (_, index) => ({
      id: 88700 + index,
      tipo: "expense" as const,
      data: "2026-08-13",
      fornitoreId: index,
      fornitoreNome: `Fornitore lotto ${index}`,
      categoriaFic: "Materiali",
      descrizione: "Materiali per commessa",
      centro: null,
      numeroDocumento: `L-${index}`,
      importoNetto: 100 + index,
      importoIva: 22,
      importoLordo: 122 + index,
      rate: [],
    }));
    upsertCostiFic(rows, sedeId, "ai-lotti");

    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const input = JSON.parse(body.input.at(-1).content) as Array<{
        id: number;
      }>;
      return {
        ok: true,
        json: async () =>
          toOpenAIResponse({
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  risultati: input.map(row => ({
                    id: row.id,
                    classificazione: "variabile_commessa",
                    confidenza: 0.95,
                    motivazione: "Materiale collegato ai lavori.",
                  })),
                }),
              },
            ],
          }),
        text: async () => "",
      } as Response;
    });
    global.fetch = fetchMock as any;

    const esito = await classificaCostiFic(
      sedeId,
      rows.map(row => row.id)
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(esito).toMatchObject({ classificati: 101, dubbi: 0, errore: null });
  });
});
