import { describe, expect, it } from "vitest";
import { interruttoreAttivo, statoInterruttori, tarsAttivo } from "../platform/interruttori";

describe("interruttore contrattoEstrazione", () => {
  it("è nel registro, segue FLAG_CONTRATTO_ESTRAZIONE e non è un sotto-flag di Tars", () => {
    const prima = process.env.FLAG_CONTRATTO_ESTRAZIONE;
    try {
      process.env.FLAG_CONTRATTO_ESTRAZIONE = "off";
      expect(interruttoreAttivo("contrattoEstrazione")).toBe(false);
      process.env.FLAG_CONTRATTO_ESTRAZIONE = "on";
      expect(interruttoreAttivo("contrattoEstrazione")).toBe(true);
      expect(Object.keys(statoInterruttori())).toContain("contrattoEstrazione");
      // @ts-expect-error — escluso dall'unione di tarsAttivo come «limiti»
      tarsAttivo("contrattoEstrazione");
    } finally {
      if (prima === undefined) delete process.env.FLAG_CONTRATTO_ESTRAZIONE;
      else process.env.FLAG_CONTRATTO_ESTRAZIONE = prima;
    }
  });
});
