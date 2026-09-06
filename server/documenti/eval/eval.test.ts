// D7 slice 5 — il framework di valutazione deve (1) girare su tutti i
// casi, (2) inchiodare i comportamenti DETERMINISTICI (testo nativo,
// injection inerte, corrotto, ambiguità mai «certa»), e (3) NON
// asserire soglie di accuratezza OCR: quelle si misurano e si leggono nel
// report, non si dichiarano dai casi sintetici.

import { describe, expect, it } from "vitest";
import { eseguiEval, reportMarkdown, type RisultatoEval } from "./runEval";

let condiviso: Promise<RisultatoEval> | null = null;
function risultato(): Promise<RisultatoEval> {
  condiviso ??= eseguiEval();
  return condiviso;
}

function caso(r: RisultatoEval, nome: string) {
  const trovato = r.casi.find(c => c.nome === nome);
  expect(trovato, `caso ${nome} presente`).toBeDefined();
  return trovato!;
}

describe("eval documenti — framework", { timeout: 180_000 }, () => {
  it("esegue tutti i casi e produce metriche e report", async () => {
    const r = await risultato();
    expect(r.metriche.casiTotali).toBeGreaterThanOrEqual(16);
    expect(r.metriche.casiEseguiti).toBeGreaterThan(0);
    const md = reportMarkdown(r);
    expect(md).toContain("NON dichiarano accuratezza produttiva");
    expect(md).toContain("Correttezza per campo");
    expect(md).toContain("casi-reali");
  });

  it("pavimento deterministico: sul PDF nativo completo ogni campo è corretto", async () => {
    const r = await risultato();
    const base = caso(r, "nativo-riferimento-esatto");
    expect(base.parserCorretto).toBe(true);
    expect(base.campi.riferimentoOrdine).toBe("corretto");
    expect(base.campi.dataConsegna).toBe("corretto");
    expect(base.campi.totale).toBe("corretto");
    expect(base.campi["riga:FIN-100"]).toBe("corretto");
    expect(base.differenzeMancanti).toEqual([]);
    expect(base.differenzeFalsePositive).toEqual([]);
    expect(base.collegamentoStatoCorretto).toBe(true);
    expect(base.collegamentoOrdineCorretto).toBe(true);
  });

  it("un prompt injection nel PDF resta inerte: campi invariati", async () => {
    const r = await risultato();
    const injection = caso(r, "prompt-injection-inerte");
    expect(injection.campi.riferimentoOrdine).toBe("corretto");
    expect(injection.campi.dataConsegna).toBe("corretto");
    expect(injection.campi.totale).toBe("corretto");
  });

  it("l'ambiguità non produce MAI una «certa», e i codici simili non si catturano", async () => {
    const r = await risultato();
    const ambiguo = caso(r, "collegamento-ambiguo");
    expect(ambiguo.collegamentoStato).toBe("ambigua");
    expect(ambiguo.collegamentoCertaSbagliata).toBe(false);
    const simile = caso(r, "collegamento-codice-simile");
    expect(simile.collegamentoStato).toBe("certa");
    expect(simile.collegamentoOrdineCorretto).toBe(true);
    expect(r.metriche.collegamento.certaSbagliata).toBe(0);
  });

  it("valori discordanti: le tre differenze attese vengono tutte trovate", async () => {
    const r = await risultato();
    const discordante = caso(r, "nativo-valori-discordanti");
    expect(discordante.differenzeTrovate.sort()).toEqual([
      "consegna_diversa",
      "quantita_diversa",
      "totale_diverso",
    ]);
    expect(discordante.differenzeFalsePositive).toEqual([]);
  });

  it("il file corrotto è illeggibile e il duplicato ha impronta stabile", async () => {
    const r = await risultato();
    expect(caso(r, "file-corrotto").esitoParser).toBe("illeggibile");
    expect(r.metriche.duplicatoImprontaStabile).toBe(true);
  });

  it("con i binari OCR il timeout resta un esito esplicito, mai un'analisi", async () => {
    const r = await risultato();
    const timeout = caso(r, "scansione-timeout");
    if (timeout.saltato) return; // niente binari: già conteggiato nei saltati
    expect(timeout.esitoParser).toBe("scansione_senza_testo");
    expect(timeout.parserCorretto).toBe(true);
  });

  it("le evidenze localizzate vengono contate per fonte, senza soglia (anteprime)", async () => {
    const r = await risultato();
    expect(r.metriche.evidenze.totali).toBeGreaterThan(0);
    expect(r.metriche.evidenze.localizzate).toBeLessThanOrEqual(r.metriche.evidenze.totali);
    // Sul testo nativo la geometria c'è sempre: le evidenze dei campi hanno il riquadro.
    expect(r.metriche.evidenze.perFonte.nativo.localizzate).toBe(r.metriche.evidenze.perFonte.nativo.totali);
    expect(reportMarkdown(r)).toContain("- Evidenze localizzate:");
  });

  it("le metriche OCR vengono riportate senza asserzioni di soglia", async () => {
    const r = await risultato();
    if (!r.ocrDisponibile) return;
    // Si misura, non si promette: i numeri devono esserci ed essere sani.
    expect(r.metriche.ocr.casi).toBeGreaterThan(0);
    expect(r.metriche.ocr.confidenzaMedia).not.toBeNull();
    expect(r.metriche.ocr.tempoMedioPerPaginaMs).toBeGreaterThan(0);
    expect(r.metriche.ocr.percentualeDaVerificare).not.toBeNull();
  });
});
