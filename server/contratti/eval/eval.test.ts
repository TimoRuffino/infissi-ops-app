// Piano 3, Task 9 — la parte DETERMINISTICA dell'eval: parser reale +
// mappatura su esiti finti coerenti con le fixture, nessuna rete. La
// chiamata vera al modello resta dietro `EVAL_CONTRATTI_REALE=on` E un
// provider governato utilizzabile (`statoProvider(...).tipo === "openai"`):
// in questo ambiente di test nessuna delle due è mai vera, quindi
// `eseguiEvalContratti()` percorre sempre l'esito finto — lo stesso runner
// che gira in produzione, non un doppio a parte.

import { describe, expect, it } from "vitest";
import { modelloEstrazione } from "../estrazione/modello";
import { statoProvider } from "../../tars/costi/providerGovernato";
import { eseguiEvalContratti, reportMarkdownContratti, type RisultatoEvalContratti } from "./runEval";

let condiviso: Promise<RisultatoEvalContratti> | null = null;
function risultato(): Promise<RisultatoEvalContratti> {
  condiviso ??= eseguiEvalContratti();
  return condiviso;
}

function caso(r: RisultatoEvalContratti, nome: string) {
  const trovato = r.casi.find(c => c.nome === nome);
  expect(trovato, `caso ${nome} presente`).toBeDefined();
  return trovato!;
}

describe("eval lettura del contratto — framework (piano 3, Task 9)", { timeout: 120_000 }, () => {
  it("senza EVAL_CONTRATTI_REALE=on il provider reale non è raggiungibile: nessuna rete possibile", () => {
    // Difesa in profondità dichiarata dal brief: anche se qualcosa
    // impostasse per errore TARS_PROVIDER/OPENAI_API_KEY in questo
    // ambiente, il test non deve MAI dipendere da una chiamata vera.
    expect(process.env.EVAL_CONTRATTI_REALE).not.toBe("on");
    expect(statoProvider(modelloEstrazione()).tipo).not.toBe("openai");
  });

  it("esegue tutti i casi sintetici e produce metriche e report senza usare il modello reale", async () => {
    const r = await risultato();
    expect(r.usoModelloReale).toBe(false);
    expect(r.metriche.casiTotali).toBeGreaterThanOrEqual(3);
    expect(r.metriche.casiEseguiti).toBeGreaterThan(0);
    const md = reportMarkdownContratti(r);
    expect(md).toContain("NON dichiarano l'accuratezza del modello reale");
    expect(md).toContain("Correttezza per campo");
    expect(md).toContain("casi-reali");
  });

  it("(WnD) layout riconosciuto: misure, quantità, prezzi, pattuito e rate corretti su ogni riga", async () => {
    const r = await risultato();
    const wnd = caso(r, "wnd-preventivo-3-righe");
    expect(wnd.saltato).toBe(false);
    expect(wnd.esitoParser).toBe("estratto");
    expect(wnd.fonteEsito).toBe("finto");
    expect(wnd.layoutWndRiconosciuto).toBe(true);
    expect(wnd.layoutWndCorretto).toBe(true);
    expect(wnd.campi.pattuitoCent).toBe("corretto");
    expect(wnd.campi.pattuitoTipo).toBe("corretto");
    expect(wnd.campi.numeroRighe).toBe("corretto");
    expect(wnd.campi.rateQuote).toBe("corretto");
    expect(wnd.campi.comuneCantiere).toBe("corretto");
    for (const indice of [0, 1, 2]) {
      expect(wnd.campi[`riga${indice}:larghezza`]).toBe("corretto");
      expect(wnd.campi[`riga${indice}:altezza`]).toBe("corretto");
      expect(wnd.campi[`riga${indice}:quantita`]).toBe("corretto");
      expect(wnd.campi[`riga${indice}:prezzo`]).toBe("corretto");
    }
    expect(wnd.controlliAttesiMancanti).toEqual([]);
    expect(wnd.controlliInattesi).toEqual([]);
  });

  it("(Word) nessun layout, pattuito unico senza aliquota: la somma resta un avviso, mai un numero inventato", async () => {
    const r = await risultato();
    const word = caso(r, "word-prosa-finestre-persiane");
    expect(word.saltato).toBe(false);
    expect(word.esitoParser).toBe("estratto");
    expect(word.layoutWndRiconosciuto).toBe(false);
    expect(word.layoutWndCorretto).toBe(true);
    expect(word.campi.pattuitoCent).toBe("corretto");
    expect(word.campi.pattuitoTipo).toBe("corretto");
    expect(word.campi.numeroRighe).toBe("corretto");
    expect(word.campi.rateQuote).toBe("corretto");
    expect(word.controlliAttesiMancanti).toEqual([]);
    expect(word.controlliInattesi).toEqual([]);
  });

  it("(scansione) senza i binari OCR il caso resta saltato; con OCR il parser risponde in modo esplicito, mai un'analisi silenziosa", async () => {
    const r = await risultato();
    const scansione = caso(r, "scansione-prosa-finestre-persiane");
    if (scansione.saltato) return; // niente pdftoppm/tesseract in questo ambiente: già conteggiato nei saltati
    expect(["estratto", "scansione_senza_testo", "illeggibile"]).toContain(scansione.esitoParser);
    // Nessuna promessa di accuratezza OCR: solo quando il testo è stato
    // estratto la mappatura gira, e allora il layout NON deve mai risultare
    // riconosciuto per errore (la prosa non ha le etichette del configuratore).
    if (scansione.esitoParser === "estratto") {
      expect(scansione.layoutWndRiconosciuto).toBe(false);
    }
  });

  it("i casi reali (casi-reali/, gitignored) ci sono solo se qualcuno li ha messi: senza cartella nessuno, con la cartella uno per sottocartella", async () => {
    const r = await risultato();
    const { readdir } = await import("node:fs/promises");
    const cartelle = await readdir(new URL("./casi-reali/", import.meta.url)).catch(() => [] as string[]);
    expect(r.casi.filter(c => c.nome.startsWith("reale-")).length).toBe(cartelle.length);
  });
});
