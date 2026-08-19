import { describe, expect, it } from "vitest";
import { metricheUtilizzoTars } from "../../client/src/lib/tarsUsage";

describe("metricheUtilizzoTars", () => {
  it("include letture e scritture cache nel totale processato", () => {
    expect(
      metricheUtilizzoTars({
        tokensIn: 400,
        tokensOut: 100,
        tokensCacheRead: 500,
        tokensCacheWrite5m: 100,
        tokensCacheWrite1h: 0,
      })
    ).toEqual({
      inputTotale: 1_000,
      tokenTotali: 1_100,
      cacheReadPercent: 50,
      cacheWrite: 100,
    });
  });

  it("evita percentuali non valide quando non ci sono token input", () => {
    expect(
      metricheUtilizzoTars({
        tokensIn: 0,
        tokensOut: 0,
        tokensCacheRead: 0,
        tokensCacheWrite5m: 0,
        tokensCacheWrite1h: 0,
      }).cacheReadPercent
    ).toBe(0);
  });
});
