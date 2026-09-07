import { describe, expect, it } from "vitest";
import { ALL_CAPABILITIES, CAPABILITIES, capabilitiesForRoles } from "./capabilities";

describe("capability tenant.manage_proprietari (WS1)", () => {
  it("esiste nel catalogo", () => {
    expect(ALL_CAPABILITIES.has("tenant.manage_proprietari")).toBe(true);
  });

  it("la dà solo il ruolo proprietario, insieme alle condivise", () => {
    const caps = capabilitiesForRoles(["proprietario"]);
    expect(caps.has("tenant.manage_proprietari")).toBe(true);
    expect(caps.has("cliente.read")).toBe(true);
    expect(caps.has("commessa.read")).toBe(true);
    expect(caps.has("economia.read")).toBe(false);
  });

  it("la direzione ha tutto tranne quella", () => {
    const caps = capabilitiesForRoles(["direzione"]);
    expect(caps.has("tenant.manage_proprietari")).toBe(false);
    for (const c of CAPABILITIES) {
      if (c !== "tenant.manage_proprietari") expect(caps.has(c)).toBe(true);
    }
  });

  it("proprietario + direzione = tutto", () => {
    const caps = capabilitiesForRoles(["proprietario", "direzione"]);
    expect(caps.size).toBe(CAPABILITIES.length);
  });

  it("gli altri ruoli non la ricevono", () => {
    for (const r of ["amministrazione", "commerciale", "tecnico_rilievi", "squadra_posa", "post_vendita", "ordini"]) {
      expect(capabilitiesForRoles([r]).has("tenant.manage_proprietari")).toBe(false);
    }
  });
});
