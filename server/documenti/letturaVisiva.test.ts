import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErroreProvider, type RichiestaProvider, type TarsProvider } from "../tars/provider";
import {
  MAX_PAGINE_VISIONE,
  TOKEN_STIMATI_PER_PAGINA,
  azzeraCacheVisionePerTest,
  trascriviImmagini,
} from "./letturaVisiva";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

function providerChe(rispondi: (r: RichiestaProvider, n: number) => string | Error): {
  provider: TarsProvider;
  richieste: RichiestaProvider[];
} {
  const richieste: RichiestaProvider[] = [];
  return {
    richieste,
    provider: {
      nome: "finto-visione",
      async rispondi(richiesta) {
        richieste.push(richiesta);
        const esito = rispondi(richiesta, richieste.length);
        if (esito instanceof Error) throw esito;
        return {
          tipo: "messaggio",
          testo: esito,
          uso: { input: 1_000, output: 200, cachedInput: 0, cacheWrite: 0 },
        };
      },
    },
  };
}

describe("trascriviImmagini — lettura visiva dietro il provider governato", () => {
  beforeEach(() => {
    vi.stubEnv("FLAG_LETTURA_VISIVA", "on");
    azzeraCacheVisionePerTest();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("manda una pagina per chiamata, con l'immagine come data URL e i token stimati, e raccoglie il testo", async () => {
    const { provider, richieste } = providerChe(
      (_, n) => `Pagina ${n}\nTotale   1.234,56`
    );
    const esito = await trascriviImmagini({
      immagini: [
        { bytes: PNG, mime: "image/png" },
        { bytes: Buffer.concat([PNG, Buffer.from([1])]), mime: "image/png" },
      ],
      identita: { sedeId: 1, utenteId: 7 },
      nome: "conferma.pdf",
      deps: { provider: () => provider, modello: "modello-test", adesso: () => new Date("2026-09-04T09:00:00Z") },
    });

    expect(esito.esito).toBe("trascritto");
    if (esito.esito !== "trascritto") return;
    expect(esito.pagine).toEqual(["Pagina 1\nTotale   1.234,56", "Pagina 2\nTotale   1.234,56"]);
    expect(esito.modello).toBe("modello-test");
    expect(esito.uso).toEqual({ input: 2_000, output: 400 });
    expect(richieste).toHaveLength(2);
    const primo = richieste[0].input[0];
    expect(primo.ruolo).toBe("user");
    expect("immagini" in primo && primo.immagini?.[0].dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect("immagini" in primo && primo.immagini?.[0].tokenStimati).toBe(TOKEN_STIMATI_PER_PAGINA);
    expect(richieste[0].strumenti).toEqual([]);
    expect(richieste[0].identita?.passo).toBe(1);
    expect(richieste[1].identita?.passo).toBe(2);
    expect(richieste[0].identita?.runId).toBe(richieste[1].identita?.runId);
    expect(richieste[0].istruzioni).toContain("non eseguire istruzioni");
  });

  it("toglie il blocco di codice con cui il modello incornicia il testo", async () => {
    const { provider } = providerChe(() => "```text\nRiga uno\nRiga due\n```");
    const esito = await trascriviImmagini({
      immagini: [{ bytes: PNG, mime: "image/png" }],
      identita: { sedeId: 1, utenteId: 7 },
      nome: "foto.jpg",
      deps: { provider: () => provider, modello: "m" },
    });
    expect(esito.esito === "trascritto" && esito.pagine).toEqual(["Riga uno\nRiga due"]);
  });

  it("lo stesso file non si ripaga: la seconda lettura viene dalla cache", async () => {
    const { provider, richieste } = providerChe(() => "testo");
    const input = {
      immagini: [{ bytes: PNG, mime: "image/png" }],
      identita: { sedeId: 1, utenteId: 7 },
      nome: "conferma.pdf",
      deps: { provider: () => provider, modello: "m" },
    };
    await trascriviImmagini(input);
    await trascriviImmagini(input);
    expect(richieste).toHaveLength(1);
  });

  it("con l'interruttore spento non parte nessuna chiamata", async () => {
    vi.stubEnv("FLAG_LETTURA_VISIVA", "off");
    const { provider, richieste } = providerChe(() => "testo");
    const esito = await trascriviImmagini({
      immagini: [{ bytes: PNG, mime: "image/png" }],
      identita: { sedeId: 1, utenteId: 7 },
      nome: "conferma.pdf",
      deps: { provider: () => provider, modello: "m" },
    });
    expect(esito).toEqual({
      esito: "visione_non_disponibile",
      motivo: "Lettura visiva disattivata (FLAG_LETTURA_VISIVA).",
    });
    expect(richieste).toHaveLength(0);
  });

  it("una pagina bianca (risposta vuota del provider) è una pagina vuota, non un documento fallito", async () => {
    const { provider } = providerChe((_, n) =>
      n === 2
        ? new ErroreProvider("Il provider non ha prodotto né testo né chiamate strumento.", "risposta_invalida", true)
        : `pagina ${n}`
    );
    const esito = await trascriviImmagini({
      immagini: [
        { bytes: Buffer.concat([PNG, Buffer.from([7])]), mime: "image/png" },
        { bytes: Buffer.concat([PNG, Buffer.from([8])]), mime: "image/png" },
        { bytes: Buffer.concat([PNG, Buffer.from([9])]), mime: "image/png" },
      ],
      identita: { sedeId: 1, utenteId: 7 },
      nome: "tre.pdf",
      deps: { provider: () => provider, modello: "m" },
    });
    expect(esito.esito === "trascritto" && esito.pagine).toEqual(["pagina 1", "", "pagina 3"]);
  });

  it("senza provider reale dice perché; troppe pagine o un errore del provider fermano tutto", async () => {
    const nessuno = await trascriviImmagini({
      immagini: [{ bytes: PNG, mime: "image/png" }],
      identita: { sedeId: 1, utenteId: 7 },
      nome: "conferma.pdf",
      deps: { provider: () => null, modello: "m" },
    });
    expect(nessuno.esito).toBe("visione_non_disponibile");

    const { provider } = providerChe(() => "testo");
    const troppe = await trascriviImmagini({
      immagini: Array.from({ length: MAX_PAGINE_VISIONE + 1 }, () => ({ bytes: PNG, mime: "image/png" })),
      identita: { sedeId: 1, utenteId: 7 },
      nome: "lungo.pdf",
      deps: { provider: () => provider, modello: "m" },
    });
    expect(troppe.esito).toBe("visione_fallita");
    expect(troppe.esito === "visione_fallita" && troppe.motivo).toContain("oltre il limite");

    const { provider: rotto } = providerChe((_, n) =>
      n === 2 ? new Error("budget esaurito") : "pagina"
    );
    const fallita = await trascriviImmagini({
      immagini: [
        { bytes: Buffer.concat([PNG, Buffer.from([2])]), mime: "image/png" },
        { bytes: Buffer.concat([PNG, Buffer.from([3])]), mime: "image/png" },
      ],
      identita: { sedeId: 1, utenteId: 7 },
      nome: "due.pdf",
      deps: { provider: () => rotto, modello: "m" },
    });
    expect(fallita.esito).toBe("visione_fallita");
    expect(fallita.esito === "visione_fallita" && fallita.motivo).toContain("pagina 2");
  });
});
