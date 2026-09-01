import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  AVATAR_TARS_SRC,
  AVATAR_TARS_SRCSET,
  classeAnelloTars,
  etichettaStatoTars,
  type StatoTarsAvatar,
} from "./avatarTars";

const STATI: readonly StatoTarsAvatar[] = [
  "disponibile",
  "in_lavoro",
  "degradato",
  "spento",
];

describe("avatar di Tars — sorgenti", () => {
  it("serve il 256 come sorgente e il 512 solo come variante 2x", () => {
    expect(AVATAR_TARS_SRC).toBe("/mascotte/avatar-256.png");
    expect(AVATAR_TARS_SRCSET).toContain(`${AVATAR_TARS_SRC} 1x`);
    expect(AVATAR_TARS_SRCSET).toContain("/mascotte/avatar-512.png 2x");
  });

  it("punta a file che esistono davvero sotto client/public", () => {
    // Un avatar rotto non fa fallire niente a runtime: resta il fallback e
    // nessuno se ne accorge. Il controllo vive qui.
    for (const url of [AVATAR_TARS_SRC, "/mascotte/avatar-512.png"]) {
      expect(
        existsSync(join("client", "public", ...url.slice(1).split("/"))),
        `asset mancante: ${url}`
      ).toBe(true);
    }
  });
});

describe("avatar di Tars — stato", () => {
  it("dice ogni stato a parole, senza affidarsi al solo colore", () => {
    expect(etichettaStatoTars("disponibile")).toBe("Disponibile");
    expect(etichettaStatoTars("in_lavoro")).toBe("In lavorazione");
    expect(etichettaStatoTars("degradato")).toBe("Operatività ridotta");
    expect(etichettaStatoTars("spento")).toBe("Disattivato");
    expect(new Set(STATI.map(etichettaStatoTars)).size).toBe(STATI.length);
  });

  it("distingue i quattro stati con anelli diversi", () => {
    expect(new Set(STATI.map(classeAnelloTars)).size).toBe(STATI.length);
    expect(classeAnelloTars("spento")).toContain("opacity-60");
  });

  it("senza stato resta identità e basta: bordo neutro, nessun segnale", () => {
    const neutro = classeAnelloTars(null);
    expect(neutro).toBe("ring-1 ring-border-soft");
    for (const stato of STATI) {
      expect(classeAnelloTars(stato)).not.toBe(neutro);
    }
  });

  it("colora solo con token semantici, mai con hex o palette numerica", () => {
    for (const stato of [...STATI, null]) {
      const classe = classeAnelloTars(stato);
      expect(classe).not.toMatch(/#[0-9a-fA-F]{3,8}/);
      expect(classe).not.toMatch(
        /-(?:gray|slate|zinc|neutral|stone)-\d{2,3}\b/
      );
      expect(classe).toMatch(/\bring-(?:success|primary|warning|border-)/);
    }
  });

  it("non anima l'avatar: il lavoro in corso lo dice già il thread", () => {
    for (const stato of [...STATI, null]) {
      expect(classeAnelloTars(stato)).not.toMatch(/animate-/);
    }
  });
});
