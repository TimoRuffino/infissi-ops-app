import { describe, expect, it } from "vitest";
import { sdiDryRun } from "./dryRun";

describe("sdiDryRun", () => {
  it("è acceso se la variabile manca o non dice off", () => {
    const prima = process.env.FATTURAZIONE_SDI_DRY_RUN;
    try {
      delete process.env.FATTURAZIONE_SDI_DRY_RUN;
      expect(sdiDryRun()).toBe(true);
      process.env.FATTURAZIONE_SDI_DRY_RUN = "on";
      expect(sdiDryRun()).toBe(true);
      process.env.FATTURAZIONE_SDI_DRY_RUN = "qualsiasi";
      expect(sdiDryRun()).toBe(true);
      process.env.FATTURAZIONE_SDI_DRY_RUN = "off";
      expect(sdiDryRun()).toBe(false);
      process.env.FATTURAZIONE_SDI_DRY_RUN = "false";
      expect(sdiDryRun()).toBe(false);
    } finally {
      if (prima === undefined) delete process.env.FATTURAZIONE_SDI_DRY_RUN;
      else process.env.FATTURAZIONE_SDI_DRY_RUN = prima;
    }
  });
});
