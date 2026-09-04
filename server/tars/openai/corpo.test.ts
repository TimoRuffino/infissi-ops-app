import { describe, expect, it } from "vitest";
import { inputPerResponses } from "./corpo";

describe("inputPerResponses", () => {
  it("un turno utente con immagini diventa testo + input_image nel contratto Responses", () => {
    expect(
      inputPerResponses([
        {
          ruolo: "user",
          contenuto: "Pagina 1 di 1. Trascrivi.",
          immagini: [
            { dataUrl: "data:image/png;base64,AAAA", tokenStimati: 1_800 },
            { dataUrl: "data:image/jpeg;base64,BBBB", dettaglio: "low", tokenStimati: 300 },
          ],
        },
      ])
    ).toEqual([
      {
        role: "user",
        content: [
          { type: "input_text", text: "Pagina 1 di 1. Trascrivi." },
          { type: "input_image", image_url: "data:image/png;base64,AAAA", detail: "high" },
          { type: "input_image", image_url: "data:image/jpeg;base64,BBBB", detail: "low" },
        ],
      },
    ]);
  });

  it("i turni di testo, le function call e i loro output restano come prima", () => {
    expect(
      inputPerResponses([
        { ruolo: "user", contenuto: "ciao" },
        {
          ruolo: "assistant",
          contenuto: "",
          chiamate: [{ id: "call_1", nome: "cerca", argomenti: "{}" }],
        },
        { ruolo: "tool", toolCallId: "call_1", nome: "cerca", contenuto: "[]" },
        { ruolo: "assistant", contenuto: "fatto" },
      ])
    ).toEqual([
      { role: "user", content: "ciao" },
      { type: "function_call", call_id: "call_1", name: "cerca", arguments: "{}" },
      { type: "function_call_output", call_id: "call_1", output: "[]" },
      { role: "assistant", content: "fatto" },
    ]);
  });
});
