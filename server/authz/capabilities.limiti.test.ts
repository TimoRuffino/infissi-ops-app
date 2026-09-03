import { describe, expect, it } from "vitest";
import { ALL_CAPABILITIES, capabilitiesForRoles } from "./capabilities";
import { interruttoreAttivo, statoInterruttori } from "../platform/interruttori";

describe("capability contratto/computo/tariffe", () => {
  it("esistono nel catalogo", () => {
    for (const c of ["contratto.read", "contratto.manage", "computo.run", "tariffe.manage"]) {
      expect(ALL_CAPABILITIES.has(c as any)).toBe(true);
    }
  });

  it("commerciale e amministrazione gestiscono il contratto e lanciano il computo", () => {
    for (const ruolo of ["commerciale", "amministrazione"]) {
      const caps = capabilitiesForRoles([ruolo]);
      expect(caps.has("contratto.read")).toBe(true);
      expect(caps.has("contratto.manage")).toBe(true);
      expect(caps.has("computo.run")).toBe(true);
      expect(caps.has("tariffe.manage")).toBe(false);
    }
  });

  it("tutti leggono il contratto, solo direzione gestisce le tariffe", () => {
    expect(capabilitiesForRoles(["squadra_posa"]).has("contratto.read")).toBe(true);
    expect(capabilitiesForRoles(["squadra_posa"]).has("contratto.manage")).toBe(false);
    expect(capabilitiesForRoles(["direzione"]).has("tariffe.manage")).toBe(true);
  });
});

describe("interruttore limiti", () => {
  it("è nel registro e segue FLAG_LIMITI", () => {
    expect(Object.keys(statoInterruttori())).toContain("limiti");
    process.env.FLAG_LIMITI = "off";
    expect(interruttoreAttivo("limiti")).toBe(false);
    process.env.FLAG_LIMITI = "on";
    expect(interruttoreAttivo("limiti")).toBe(true);
    delete process.env.FLAG_LIMITI;
  });
});
