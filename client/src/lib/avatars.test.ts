import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  AVATAR_SLUGS,
  avatarSlugForName,
  avatarSrcSetForName,
  avatarUrlForName,
} from "./avatars";

describe("avatarUrlForName", () => {
  it("riconosce il nome proprio di una persona del team", () => {
    expect(avatarUrlForName("Timothy")).toBe("/avatars/timothy.png");
    expect(avatarUrlForName("Micol")).toBe("/avatars/micol.png");
  });

  // La sessione espone `name` nella convenzione «Cognome Nome»
  // (server/routers.ts, auth.login): il nome proprio è l'ultimo token.
  it("legge il nome proprio dalla convenzione «Cognome Nome»", () => {
    expect(avatarUrlForName("Ruffino Timothy")).toBe("/avatars/timothy.png");
    expect(avatarUrlForName("Bianchi Lidia")).toBe("/avatars/lidia.png");
  });

  it("regge anche l'ordine «Nome Cognome»", () => {
    expect(avatarUrlForName("Alessandro Rossi")).toBe(
      "/avatars/alessandro.png"
    );
  });

  it("ignora maiuscole, minuscole e spazi superflui", () => {
    expect(avatarUrlForName("  STEFANO  ")).toBe("/avatars/stefano.png");
    expect(avatarUrlForName("rUfFiNo mArCo")).toBe("/avatars/marco.png");
  });

  it("ignora gli accenti", () => {
    expect(avatarUrlForName("Nicolás")).toBe("/avatars/nicolas.png");
    expect(avatarUrlForName("Sánchez Francésco")).toBe(
      "/avatars/francesco.png"
    );
  });

  it("restituisce null per una persona senza avatar", () => {
    expect(avatarUrlForName("Rossi Giovanna")).toBeNull();
    expect(avatarUrlForName("Utente")).toBeNull();
  });

  it("restituisce null per nome assente o vuoto", () => {
    expect(avatarUrlForName(null)).toBeNull();
    expect(avatarUrlForName(undefined)).toBeNull();
    expect(avatarUrlForName("")).toBeNull();
    expect(avatarUrlForName("   ")).toBeNull();
  });

  // Un cognome non deve rubare l'avatar quando il nome proprio è già noto.
  it("preferisce il nome proprio quando anche il cognome è uno slug", () => {
    expect(avatarUrlForName("Marco Stefano")).toBe("/avatars/stefano.png");
  });
});

describe("avatarSlugForName", () => {
  it("espone lo slug grezzo o null", () => {
    expect(avatarSlugForName("Ruffino Timothy")).toBe("timothy");
    expect(avatarSlugForName("Rossi Giovanna")).toBeNull();
  });
});

describe("avatarSrcSetForName", () => {
  it("descrive la variante retina", () => {
    expect(avatarSrcSetForName("Ruffino Timothy")).toBe(
      "/avatars/timothy.png 1x, /avatars/timothy@2x.png 2x"
    );
  });

  it("resta null senza avatar", () => {
    expect(avatarSrcSetForName("Rossi Giovanna")).toBeNull();
    expect(avatarSrcSetForName(null)).toBeNull();
  });
});

// L'elenco degli slug e gli asset statici devono restare allineati: uno slug
// senza file produrrebbe un'immagine rotta nella shell.
describe("asset degli avatar", () => {
  it("ha entrambe le varianti per ogni slug", () => {
    const mancanti = AVATAR_SLUGS.flatMap(slug =>
      [`${slug}.png`, `${slug}@2x.png`].filter(
        file => !existsSync(join("client", "public", "avatars", file))
      )
    );
    expect(mancanti).toEqual([]);
  });
});
