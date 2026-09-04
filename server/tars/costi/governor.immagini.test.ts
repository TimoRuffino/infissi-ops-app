import { describe, expect, it } from "vitest";
import type { RichiestaProvider } from "../provider";
import { tokenInputStimati } from "./governor";

// Le immagini della lettura visiva non si misurano in caratteri: il
// governor conta i token dichiarati da chi le allega, con lo stesso margine.

describe("tokenInputStimati — immagini", () => {
  const base: RichiestaProvider = {
    modello: "m",
    istruzioni: "x".repeat(250),
    input: [{ ruolo: "user", contenuto: "y".repeat(250) }],
    strumenti: [],
    maxOutputToken: 100,
    chiaveCachePrompt: "k",
    timeoutMs: 1_000,
  };

  it("somma i token stimati delle immagini ai caratteri del testo", () => {
    const soloTesto = tokenInputStimati(base, 1);
    expect(soloTesto).toBe(Math.ceil(500 / 2.5));
    const conImmagini = tokenInputStimati(
      {
        ...base,
        input: [
          {
            ruolo: "user",
            contenuto: "y".repeat(250),
            immagini: [
              { dataUrl: "data:image/png;base64,AAAA", tokenStimati: 1_800 },
              { dataUrl: "data:image/png;base64,BBBB", tokenStimati: 1_800 },
            ],
          },
        ],
      },
      1.2
    );
    expect(conImmagini).toBe(Math.ceil((500 / 2.5 + 3_600) * 1.2));
  });

  it("i byte dell'immagine non entrano nel conteggio dei caratteri", () => {
    const grande = tokenInputStimati(
      {
        ...base,
        input: [
          {
            ruolo: "user",
            contenuto: "y".repeat(250),
            immagini: [{ dataUrl: "data:image/png;base64," + "A".repeat(100_000), tokenStimati: 10 }],
          },
        ],
      },
      1
    );
    expect(grande).toBe(Math.ceil(500 / 2.5 + 10));
  });
});
