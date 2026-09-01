import { describe, expect, it } from "vitest";

import {
  POSE_OCCASIONALI,
  etichettaMascotte,
  posaARiposo,
  posterDi,
  puoPartireSiparietto,
  scegliSiparietto,
  vaSpecchiata,
} from "./mascotteTars";

describe("mascotte Tars — posa a riposo", () => {
  it("sta in piedi col pannello chiuso", () => {
    expect(posaARiposo(false)).toBe("idle");
  });

  it("indica il pannello quando è aperto", () => {
    expect(posaARiposo(true)).toBe("indica");
  });
});

describe("mascotte Tars — scelta del siparietto", () => {
  it("copre tutti i siparietti sull'intervallo del sorteggio", () => {
    const usciti = new Set(
      Array.from({ length: 100 }, (_, i) => scegliSiparietto(i / 100)),
    );
    expect(usciti).toEqual(new Set(POSE_OCCASIONALI));
  });

  it("regge gli estremi senza uscire dall'elenco", () => {
    expect(POSE_OCCASIONALI).toContain(scegliSiparietto(0));
    // Math.random non arriva a 1, ma un valore di confine non deve dare
    // undefined: il componente lo passerebbe come src del video.
    expect(POSE_OCCASIONALI).toContain(scegliSiparietto(0.999999));
    expect(POSE_OCCASIONALI).toContain(scegliSiparietto(1));
  });
});

describe("mascotte Tars — quando parte un siparietto", () => {
  it("parte dalla posa neutra", () => {
    expect(puoPartireSiparietto("idle", false, false)).toBe(true);
  });

  it("non parte mentre un altro siparietto è in corso", () => {
    expect(puoPartireSiparietto("evento", false, false)).toBe(false);
    expect(puoPartireSiparietto("cartello", false, false)).toBe(false);
  });

  it("non parte a pannello aperto: lì deve restare ferma a indicarlo", () => {
    expect(puoPartireSiparietto("idle", true, false)).toBe(false);
    expect(puoPartireSiparietto("indica", true, false)).toBe(false);
  });

  it("non parte con prefers-reduced-motion", () => {
    expect(puoPartireSiparietto("idle", false, true)).toBe(false);
  });
});

describe("mascotte Tars — specchiatura", () => {
  it("specchia solo la posa che indica", () => {
    expect(vaSpecchiata("indica")).toBe(true);
  });

  it("non specchia il cartello, o FATTURARE si leggerebbe al contrario", () => {
    expect(vaSpecchiata("cartello")).toBe(false);
    expect(vaSpecchiata("idle")).toBe(false);
    expect(vaSpecchiata("evento")).toBe(false);
  });
});

describe("mascotte Tars — poster fermo", () => {
  it("i siparietti ricadono sul poster neutro: da fermi non esistono", () => {
    expect(posterDi("evento")).toBe("idle");
    expect(posterDi("cartello")).toBe("idle");
  });

  it("la posa che indica ha il suo poster", () => {
    expect(posterDi("indica")).toBe("indica");
  });
});

describe("mascotte Tars — etichetta accessibile", () => {
  it("dice cosa fa il click", () => {
    expect(etichettaMascotte(false)).toBe("Chiedi a Tars");
    expect(etichettaMascotte(true)).toBe("Chiudi la domanda rapida a Tars");
  });
});
