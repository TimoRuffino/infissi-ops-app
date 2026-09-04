// La forma dell'input per la Responses API, separata dall'adapter perché
// sia una funzione pura e testabile senza toccare la rete né il provider
// reale (la guardia di confine vieta di importare l'adapter fuori dal
// governor). Nessun endpoint, nessuna chiave: solo trasformazione di dati.

import type { MessaggioTars } from "../provider";

/** I turni del run nel contratto Responses: testo, function call, e immagini come parti del contenuto. */
export function inputPerResponses(
  messaggi: readonly MessaggioTars[]
): Array<Record<string, unknown>> {
  return messaggi.flatMap((m): Array<Record<string, unknown>> => {
    if (m.ruolo === "tool") {
      return [
        {
          type: "function_call_output",
          call_id: m.toolCallId,
          output: m.contenuto,
        },
      ];
    }
    if (m.ruolo === "assistant" && m.chiamate?.length) {
      // Il turno assistant con le function call precede i loro output
      // (contratto Responses).
      return m.chiamate.map(c => ({
        type: "function_call",
        call_id: c.id,
        name: c.nome,
        arguments: c.argomenti,
      }));
    }
    // Un turno con immagini (lettura visiva dei documenti): il testo e le
    // pagine come parti del contenuto.
    if (m.ruolo === "user" && m.immagini?.length) {
      return [
        {
          role: "user",
          content: [
            { type: "input_text", text: m.contenuto },
            ...m.immagini.map(i => ({
              type: "input_image",
              image_url: i.dataUrl,
              detail: i.dettaglio ?? "high",
            })),
          ],
        },
      ];
    }
    return [{ role: m.ruolo, content: m.contenuto }];
  });
}
