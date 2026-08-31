import { describe, expect, it } from "vitest";

import {
  DOCUMENTED_CONTRAST_PAIRS,
  auditContrastPairs,
  contrastRatio,
  relativeLuminance,
} from "../../../scripts/check-ui-contrast";

describe("audit WCAG della palette UI", () => {
  it("calcola luminanza e contrasto sRGB secondo WCAG", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#FFFFFF")).toBe(1);
    expect(contrastRatio("#000000", "#FFFFFF")).toBe(21);
    expect(contrastRatio("#777777", "#777777")).toBe(1);
  });

  it("applica 4.5 al testo normale e 3 alle superfici essenziali", () => {
    const esiti = auditContrastPairs([
      {
        name: "testo insufficiente",
        foreground: "#777777",
        background: "#FFFFFF",
        threshold: 4.5,
        kind: "text",
      },
      {
        name: "bordo sufficiente",
        foreground: "#767676",
        background: "#FFFFFF",
        threshold: 3,
        kind: "boundary",
      },
    ]);

    expect(esiti[0]).toMatchObject({ passed: false, threshold: 4.5 });
    expect(esiti[1]).toMatchObject({ passed: true, threshold: 3 });
  });

  it("mantiene conformi tutte le coppie documentate", () => {
    expect(
      auditContrastPairs(DOCUMENTED_CONTRAST_PAIRS).filter(
        esito => !esito.passed
      )
    ).toEqual([]);
  });
});
