import { describe, expect, it } from "vitest";
import { CAPABILITIES, capabilitiesForRoles } from "./capabilities";
import {
  interruttoreAttivo,
  statoInterruttori,
} from "../platform/interruttori";

const NUOVE = [
  "fattura.read",
  "fattura.draft",
  "fattura.emit",
  "fattura.credit_note",
] as const;

describe("capability fatturazione", () => {
  it("esistono nel catalogo", () => {
    const tutte = new Set<string>(CAPABILITIES);
    for (const c of NUOVE) expect(tutte.has(c)).toBe(true);
  });
  it("amministrazione fa tutto, commerciale legge, tecnico niente", () => {
    const amm = capabilitiesForRoles(["amministrazione"]);
    for (const c of NUOVE) expect(amm.has(c)).toBe(true);
    const com = capabilitiesForRoles(["commerciale"]);
    expect(com.has("fattura.read")).toBe(true);
    expect(com.has("fattura.draft")).toBe(false);
    expect(com.has("fattura.emit")).toBe(false);
    const tec = capabilitiesForRoles(["tecnico_rilievi"]);
    expect(tec.has("fattura.read")).toBe(false);
  });
  it("direzione ha il set completo", () => {
    const dir = capabilitiesForRoles(["direzione"]);
    for (const c of NUOVE) expect(dir.has(c)).toBe(true);
  });
});

describe("interruttore fatturazione", () => {
  it("è nel registro e segue FLAG_FATTURAZIONE", () => {
    const prima = process.env.FLAG_FATTURAZIONE;
    try {
      process.env.FLAG_FATTURAZIONE = "off";
      expect(interruttoreAttivo("fatturazione")).toBe(false);
      process.env.FLAG_FATTURAZIONE = "on";
      expect(interruttoreAttivo("fatturazione")).toBe(true);
      expect(Object.keys(statoInterruttori())).toContain("fatturazione");
    } finally {
      if (prima === undefined) delete process.env.FLAG_FATTURAZIONE;
      else process.env.FLAG_FATTURAZIONE = prima;
    }
  });
});
