// Runner del framework di valutazione (D7, slice 5).
//
// Esegue OGNI caso attraverso la stessa pipeline della produzione
// (registro parser → OCR → estrattore → confronto → candidati) e misura,
// separatamente: correttezza e copertura per campo, precisione del
// collegamento, precisione delle differenze, confidenza OCR, tempo per
// pagina, percentuale di documenti da rivedere, falsi positivi.
//
// I numeri su fixture sintetiche NON sono accuratezza produttiva: dicono
// se la pipeline regredisce su casi controllati. L'accuratezza vera si
// misurerà su conferme reali anonimizzate in `casi-reali/` (mai nel
// repository).

import { createHash } from "node:crypto";
import { estraiTestoDocumento } from "../parserRegistry";
import { annotaAreeEstrazione, estraiConfermaOrdine } from "../estrazioneConferma";
import { confrontaConfermaConOrdine } from "../confrontoOrdine";
import { generaCandidatiOrdine } from "../candidatiOrdine";
import { disponibilitaOcr } from "../ocr";
import { costruisciCasi, type CasoEval } from "./casi";

export type GiudizioCampo = "corretto" | "errato" | "mancante" | "corretto_negativo" | "falso_positivo";

export type EsitoCaso = {
  nome: string;
  descrizione: string;
  saltato: boolean;
  tempoMs: number;
  pagine: number;
  esitoParser: string;
  parserCorretto: boolean;
  parserUsato: string | null;
  campi: Record<string, GiudizioCampo>;
  differenzeTrovate: string[];
  differenzeMancanti: string[];
  differenzeFalsePositive: string[];
  collegamentoStato: string | null;
  collegamentoStatoCorretto: boolean | null;
  collegamentoOrdineCorretto: boolean | null;
  collegamentoCertaSbagliata: boolean;
  ocrConfidenzaMedia: number | null;
  ocrDaVerificare: boolean | null;
  /** Evidenze dei campi estratti e quante hanno un riquadro sulla pagina (anteprime). */
  evidenzeTotali: number;
  evidenzeLocalizzate: number;
  note: string[];
};

export type MetricheEval = {
  casiTotali: number;
  casiEseguiti: number;
  casiSaltati: number;
  parserCorretti: number;
  campi: Record<
    string,
    { attesi: number; corretti: number; errati: number; mancanti: number; falsiPositivi: number }
  >;
  coperturaCampi: number; // estratti / attesi non-null
  correttezzaCampi: number; // corretti / estratti su attesi non-null
  falsiPositiviCampi: number;
  differenze: { attese: number; trovate: number; falsePositive: number };
  collegamento: {
    casi: number;
    statiCorretti: number;
    ordiniCorretti: number;
    certaSbagliata: number;
  };
  ocr: {
    casi: number;
    confidenzaMedia: number | null;
    percentualeDaVerificare: number | null;
    tempoMedioPerPaginaMs: number | null;
  };
  /**
   * Evidenze localizzate (anteprime «Dove l'ho letto»): quante evidenze dei
   * campi estratti hanno un riquadro sulla pagina, per fonte del testo.
   * Senza soglia, come le metriche OCR: si misura, non si promette.
   */
  evidenze: {
    totali: number;
    localizzate: number;
    perFonte: {
      nativo: { totali: number; localizzate: number };
      ocr: { totali: number; localizzate: number };
    };
  };
  tempoTotaleMs: number;
  duplicatoImprontaStabile: boolean;
};

export type RisultatoEval = {
  generatoIl: string;
  ocrDisponibile: boolean;
  lingueOcrInstallate: string[];
  casi: EsitoCaso[];
  metriche: MetricheEval;
};

function giudicaValore<T>(
  atteso: T | null,
  estratto: T | null
): GiudizioCampo {
  if (atteso == null) return estratto == null ? "corretto_negativo" : "falso_positivo";
  if (estratto == null) return "mancante";
  return estratto === atteso ? "corretto" : "errato";
}

async function eseguiCaso(
  caso: CasoEval,
  ocrDisponibile: boolean
): Promise<EsitoCaso> {
  const esito: EsitoCaso = {
    nome: caso.nome,
    descrizione: caso.descrizione,
    saltato: caso.richiedeBinari && !ocrDisponibile,
    tempoMs: 0,
    pagine: 0,
    esitoParser: "-",
    parserCorretto: false,
    parserUsato: null,
    campi: {},
    differenzeTrovate: [],
    differenzeMancanti: [],
    differenzeFalsePositive: [],
    collegamentoStato: null,
    collegamentoStatoCorretto: null,
    collegamentoOrdineCorretto: null,
    collegamentoCertaSbagliata: false,
    ocrConfidenzaMedia: null,
    ocrDaVerificare: null,
    evidenzeTotali: 0,
    evidenzeLocalizzate: 0,
    note: [],
  };
  if (esito.saltato) return esito;

  const partenza = Date.now();
  const parser = await estraiTestoDocumento(
    caso.bytes,
    "application/pdf",
    `${caso.nome}.pdf`,
    { ocr: caso.ocr === false ? false : caso.ocr }
  );
  esito.tempoMs = Date.now() - partenza;
  esito.esitoParser = parser.esito;
  esito.parserCorretto = parser.esito === caso.esitoParserAtteso;
  if (!esito.parserCorretto) {
    esito.note.push(
      `esito parser ${parser.esito}, atteso ${caso.esitoParserAtteso}`
    );
  }
  if (parser.esito !== "estratto") return esito;

  esito.parserUsato = parser.parser;
  esito.pagine = parser.pagine.length;
  if (parser.ocr) {
    esito.ocrConfidenzaMedia = parser.ocr.confidenzaMedia;
    esito.ocrDaVerificare = parser.ocr.daVerificare;
  }

  // ── Evidenze localizzate (anteprime): quante evidenze hanno un riquadro ──
  {
    const annotata = annotaAreeEstrazione(
      estraiConfermaOrdine(parser.pagine, {
        codiceOrdine: caso.contesto?.codiceOrdine ?? null,
        fornitoreNome: caso.contesto?.fornitoreNome ?? null,
        righeOrdine: caso.contesto?.righeOrdine ?? [],
      }),
      parser.geometria
    );
    const evidenze = [
      annotata.riferimentoOrdine,
      annotata.fornitoreCitato,
      annotata.numeroConferma,
      annotata.dataDocumento,
      ...annotata.dateConsegna,
      annotata.totaleDocumento,
      annotata.imponibileDocumento,
    ].filter((c): c is NonNullable<typeof c> => c != null);
    esito.evidenzeTotali = evidenze.length;
    esito.evidenzeLocalizzate = evidenze.filter(c => c.evidenza.area?.grado === "riquadro").length;
  }

  // ── Campi ─────────────────────────────────────────────────────────────
  if (caso.campiAttesi) {
    const estrazione = estraiConfermaOrdine(parser.pagine, {
      codiceOrdine: caso.contesto?.codiceOrdine ?? null,
      fornitoreNome: caso.contesto?.fornitoreNome ?? null,
      righeOrdine: caso.contesto?.righeOrdine ?? [],
    });
    esito.campi.riferimentoOrdine = giudicaValore(
      caso.campiAttesi.riferimentoOrdine,
      estrazione.riferimentoOrdine?.valore ?? null
    );
    esito.campi.dataConsegna = giudicaValore(
      caso.campiAttesi.dataConsegna,
      estrazione.dateConsegna[0]?.valore ?? null
    );
    esito.campi.totale = giudicaValore(
      caso.campiAttesi.totale,
      estrazione.totaleDocumento?.valore ?? null
    );
    if (caso.campiAttesi.quantitaPerArticolo) {
      const attese = caso.campiAttesi.quantitaPerArticolo;
      for (const riga of caso.contesto?.righeOrdine ?? []) {
        const codice = riga.codiceArticolo ?? "";
        if (!codice) continue;
        const riscontro = estrazione.righe.find(
          r => r.codiceArticolo === codice
        );
        const attesa = attese[codice];
        if (attesa == null) {
          // La riga NON deve risultare citata (es. codici simili).
          esito.campi[`riga:${codice}`] = riscontro?.trovata
            ? "falso_positivo"
            : "corretto_negativo";
        } else {
          esito.campi[`riga:${codice}`] = giudicaValore(
            attesa,
            riscontro?.quantitaDocumento?.valore ?? null
          );
        }
      }
    }
  }

  // ── Differenze ────────────────────────────────────────────────────────
  if (caso.differenze) {
    const estrazione = estraiConfermaOrdine(parser.pagine, {
      codiceOrdine: caso.differenze.ordine.codiceOrdine,
      fornitoreNome: caso.differenze.ordine.fornitoreNome,
      righeOrdine: caso.differenze.ordine.righe.map(riga => ({
        id: riga.id,
        descrizione: riga.descrizione,
        codiceArticolo: riga.codiceArticolo ?? null,
        quantita: riga.quantita,
      })),
    });
    const tipi = confrontaConfermaConOrdine(
      estrazione,
      caso.differenze.ordine
    ).map(differenza => differenza.tipo as string);
    esito.differenzeTrovate = caso.differenze.attese.filter(tipo =>
      tipi.includes(tipo)
    );
    esito.differenzeMancanti = caso.differenze.attese.filter(
      tipo => !tipi.includes(tipo)
    );
    esito.differenzeFalsePositive = caso.differenze.vietate.filter(tipo =>
      tipi.includes(tipo)
    );
  }

  // ── Collegamento ──────────────────────────────────────────────────────
  if (caso.collegamento) {
    const estrazioneLibera = estraiConfermaOrdine(parser.pagine, {
      codiceOrdine: null,
      fornitoreNome: null,
      righeOrdine: [],
    });
    const candidati = generaCandidatiOrdine({
      pagine: parser.pagine,
      estrazione: estrazioneLibera,
      ordini: caso.collegamento.ordini,
      documentoCommessaId: -1,
      ordiniRifiutati: new Set(),
      segnaliEconomici: true,
    });
    esito.collegamentoStato = candidati.stato;
    esito.collegamentoStatoCorretto =
      candidati.stato === caso.collegamento.statoAtteso;
    const migliore = candidati.candidati[0] ?? null;
    if (caso.collegamento.ordineAtteso != null) {
      esito.collegamentoOrdineCorretto =
        candidati.stato === "certa" &&
        migliore?.ordineId === caso.collegamento.ordineAtteso;
    }
    esito.collegamentoCertaSbagliata =
      candidati.stato === "certa" &&
      (caso.collegamento.statoAtteso !== "certa" ||
        migliore?.ordineId !== caso.collegamento.ordineAtteso);
  }

  return esito;
}

export async function eseguiEval(): Promise<RisultatoEval> {
  const disponibilita = await disponibilitaOcr();
  const casi = await costruisciCasi();
  const esiti: EsitoCaso[] = [];
  for (const caso of casi) {
    esiti.push(await eseguiCaso(caso, disponibilita.disponibile));
  }

  // Il caso duplicato: la stessa costruzione deve produrre la stessa
  // impronta (la rilevazione duplicati a valle si basa su questo).
  const duplicato = casi.find(caso => caso.nome === "duplicato-stessa-impronta");
  const base = casi.find(caso => caso.nome === "nativo-riferimento-esatto");
  const duplicatoImprontaStabile =
    duplicato != null &&
    base != null &&
    createHash("sha256").update(duplicato.bytes).digest("hex") ===
      createHash("sha256").update(base.bytes).digest("hex");

  const eseguiti = esiti.filter(esito => !esito.saltato);
  const campi: MetricheEval["campi"] = {};
  let estrattiSuAttesi = 0;
  let attesiNonNull = 0;
  let correttiSuAttesi = 0;
  let falsiPositiviCampi = 0;
  for (const esito of eseguiti) {
    for (const [campo, giudizio] of Object.entries(esito.campi)) {
      const chiave = campo.startsWith("riga:") ? "riga_articolo" : campo;
      campi[chiave] ??= { attesi: 0, corretti: 0, errati: 0, mancanti: 0, falsiPositivi: 0 };
      const voce = campi[chiave];
      if (giudizio === "falso_positivo") {
        voce.falsiPositivi += 1;
        falsiPositiviCampi += 1;
        continue;
      }
      if (giudizio === "corretto_negativo") continue;
      voce.attesi += 1;
      attesiNonNull += 1;
      if (giudizio === "corretto") {
        voce.corretti += 1;
        correttiSuAttesi += 1;
        estrattiSuAttesi += 1;
      } else if (giudizio === "errato") {
        voce.errati += 1;
        estrattiSuAttesi += 1;
        falsiPositiviCampi += 1;
      } else {
        voce.mancanti += 1;
      }
    }
  }

  const conCollegamento = eseguiti.filter(
    esito => esito.collegamentoStato != null
  );
  const casiOcr = eseguiti.filter(esito => esito.ocrConfidenzaMedia != null);
  const tempoPagineOcr = casiOcr.reduce((somma, esito) => somma + esito.tempoMs, 0);
  const pagineOcr = casiOcr.reduce((somma, esito) => somma + esito.pagine, 0);
  const sommaEvidenze = (lista: readonly EsitoCaso[]) => ({
    totali: lista.reduce((somma, esito) => somma + esito.evidenzeTotali, 0),
    localizzate: lista.reduce((somma, esito) => somma + esito.evidenzeLocalizzate, 0),
  });
  const evidenzeNativo = sommaEvidenze(eseguiti.filter(esito => esito.parserUsato === "pdf-testo-nativo"));
  const evidenzeOcr = sommaEvidenze(eseguiti.filter(esito => esito.parserUsato === "pdf-ocr"));

  const metriche: MetricheEval = {
    casiTotali: esiti.length,
    casiEseguiti: eseguiti.length,
    casiSaltati: esiti.length - eseguiti.length,
    parserCorretti: eseguiti.filter(esito => esito.parserCorretto).length,
    campi,
    coperturaCampi: attesiNonNull ? estrattiSuAttesi / attesiNonNull : 1,
    correttezzaCampi: estrattiSuAttesi ? correttiSuAttesi / estrattiSuAttesi : 1,
    falsiPositiviCampi,
    differenze: {
      attese: eseguiti.reduce(
        (somma, esito) =>
          somma + esito.differenzeTrovate.length + esito.differenzeMancanti.length,
        0
      ),
      trovate: eseguiti.reduce(
        (somma, esito) => somma + esito.differenzeTrovate.length,
        0
      ),
      falsePositive: eseguiti.reduce(
        (somma, esito) => somma + esito.differenzeFalsePositive.length,
        0
      ),
    },
    collegamento: {
      casi: conCollegamento.length,
      statiCorretti: conCollegamento.filter(
        esito => esito.collegamentoStatoCorretto
      ).length,
      ordiniCorretti: conCollegamento.filter(
        esito => esito.collegamentoOrdineCorretto === true
      ).length,
      certaSbagliata: conCollegamento.filter(
        esito => esito.collegamentoCertaSbagliata
      ).length,
    },
    ocr: {
      casi: casiOcr.length,
      confidenzaMedia: casiOcr.length
        ? Math.round(
            casiOcr.reduce((somma, esito) => somma + (esito.ocrConfidenzaMedia ?? 0), 0) /
              casiOcr.length
          )
        : null,
      percentualeDaVerificare: casiOcr.length
        ? Math.round(
            (100 * casiOcr.filter(esito => esito.ocrDaVerificare).length) /
              casiOcr.length
          )
        : null,
      tempoMedioPerPaginaMs: pagineOcr
        ? Math.round(tempoPagineOcr / pagineOcr)
        : null,
    },
    evidenze: {
      ...sommaEvidenze(eseguiti),
      perFonte: { nativo: evidenzeNativo, ocr: evidenzeOcr },
    },
    tempoTotaleMs: esiti.reduce((somma, esito) => somma + esito.tempoMs, 0),
    duplicatoImprontaStabile,
  };

  return {
    generatoIl: new Date().toISOString(),
    ocrDisponibile: disponibilita.disponibile,
    lingueOcrInstallate: disponibilita.lingueInstallate,
    casi: esiti,
    metriche,
  };
}

export function reportMarkdown(risultato: RisultatoEval): string {
  const m = risultato.metriche;
  const percento = (valore: number) => `${Math.round(valore * 100)}%`;
  const righe: string[] = [
    "# D7 — Eval Document Intelligence (fixture sintetiche)",
    "",
    `> Generato il ${risultato.generatoIl}. OCR ${risultato.ocrDisponibile ? `disponibile (lingue installate: ${risultato.lingueOcrInstallate.join(", ")})` : "NON disponibile: casi scansione saltati"}.`,
    ">",
    "> **Questi numeri NON dichiarano accuratezza produttiva**: le fixture",
    "> sono sintetiche e controllate. Servono a rilevare regressioni della",
    "> pipeline. L'accuratezza vera si misura sui casi reali anonimizzati",
    "> (v. procedura in fondo).",
    "",
    "## Metriche",
    "",
    `- Casi: ${m.casiEseguiti}/${m.casiTotali} eseguiti (${m.casiSaltati} saltati), esito parser corretto in ${m.parserCorretti}/${m.casiEseguiti}.`,
    `- Campi: copertura ${percento(m.coperturaCampi)}, correttezza sugli estratti ${percento(m.correttezzaCampi)}, falsi positivi ${m.falsiPositiviCampi}.`,
    `- Differenze: ${m.differenze.trovate}/${m.differenze.attese} attese trovate, ${m.differenze.falsePositive} false positive.`,
    `- Collegamento: ${m.collegamento.statiCorretti}/${m.collegamento.casi} stati corretti, ${m.collegamento.ordiniCorretti} ordini certi corretti, **${m.collegamento.certaSbagliata} «certa» sbagliate** (deve restare 0).`,
    `- OCR: ${m.ocr.casi} casi, confidenza media ${m.ocr.confidenzaMedia ?? "-"}%, da verificare ${m.ocr.percentualeDaVerificare ?? "-"}%, tempo medio ${m.ocr.tempoMedioPerPaginaMs ?? "-"} ms/pagina.`,
    `- Evidenze localizzate: ${m.evidenze.localizzate}/${m.evidenze.totali} con riquadro sulla pagina (nativo ${m.evidenze.perFonte.nativo.localizzate}/${m.evidenze.perFonte.nativo.totali}, OCR ${m.evidenze.perFonte.ocr.localizzate}/${m.evidenze.perFonte.ocr.totali}) — senza soglia.`,
    `- Impronta duplicati stabile: ${m.duplicatoImprontaStabile ? "sì" : "NO"}. Tempo totale ${m.tempoTotaleMs} ms.`,
    "",
    "### Correttezza per campo",
    "",
    "| Campo | Attesi | Corretti | Errati | Mancanti | Falsi positivi |",
    "|---|---|---|---|---|---|",
    ...Object.entries(m.campi).map(
      ([campo, voce]) =>
        `| ${campo} | ${voce.attesi} | ${voce.corretti} | ${voce.errati} | ${voce.mancanti} | ${voce.falsiPositivi} |`
    ),
    "",
    "## Casi",
    "",
    "| Caso | Esito parser | Parser | ms | Note |",
    "|---|---|---|---|---|",
    ...risultato.casi.map(esito =>
      esito.saltato
        ? `| ${esito.nome} | SALTATO (niente binari OCR) | - | - | ${esito.descrizione} |`
        : `| ${esito.nome} | ${esito.esitoParser}${esito.parserCorretto ? "" : " ⚠️"} | ${esito.parserUsato ?? "-"} | ${esito.tempoMs} | ${[...esito.note, ...esito.differenzeMancanti.map(t => `manca ${t}`), ...esito.differenzeFalsePositive.map(t => `FP ${t}`)].join("; ") || "-"} |`
    ),
    "",
    "## Aggiungere casi reali anonimizzati (procedura)",
    "",
    "1. Raccogliere conferme d'ordine PDF reali e **anonimizzarle**:",
    "   rimuovere o sostituire nomi dei clienti, indirizzi di cantiere,",
    "   contatti e prezzi se sensibili; i codici ordine/commessa possono",
    "   essere rimappati (es. ORD-X → ORD-EV-9xx) purché coerenti con",
    "   l'atteso dichiarato.",
    "2. Salvarle in `server/documenti/eval/casi-reali/` (la cartella è in",
    "   `.gitignore`: i documenti reali NON entrano mai nel repository),",
    "   una sottocartella per caso con `atteso.json` accanto al PDF.",
    "3. Quantità minima utile: ~20 conferme variate (fornitori, layout,",
    "   scansioni e nativi) per stime iniziali; 50+ per numeri stabili.",
    "4. Rieseguire `pnpm eval:documenti` e confrontare col baseline.",
    "",
  ];
  return righe.join("\n");
}

// Entry CLI: `pnpm eval:documenti` — esegue tutto e scrive il report.
const eseguitoDirettamente =
  process.argv[1]?.endsWith("runEval.ts") ||
  process.argv[1]?.endsWith("runEval.js");
if (eseguitoDirettamente) {
  const { writeFile } = await import("node:fs/promises");
  const risultato = await eseguiEval();
  const giorno = risultato.generatoIl.slice(0, 10);
  const percorso = `docs/reports/d7-eval-${giorno}.md`;
  await writeFile(percorso, reportMarkdown(risultato));
  console.log(
    `Eval completata: ${risultato.metriche.casiEseguiti}/${risultato.metriche.casiTotali} casi, report in ${percorso}`
  );
}
