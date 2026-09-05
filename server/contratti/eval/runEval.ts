// Runner dell'eval della lettura del contratto (piano 3, Task 9).
//
// Per ogni caso: `estraiTestoDocumento` (lo stesso parser della produzione)
// poi `costruisciProposta` — sull'«esito finto» del caso (nessuna rete),
// oppure sulla chiamata REALE al modello quando `EVAL_CONTRATTI_REALE=on` E
// il provider governato è utilizzabile (`statoProvider(...).tipo ===
// "openai"`): senza ENTRAMBE le condizioni non parte mai una chiamata a
// pagamento, anche se qualcuno passa un `provider`. Se il layout WnD viene
// riconosciuto, `arricchisciDaLayoutWnd` corregge la proposta come in
// produzione.
//
// I numeri sulle fixture sintetiche NON sono accuratezza del modello reale:
// misurano che parser e mappatura deterministica restino corretti. La
// misura vera si fa sui casi reali anonimizzati in `casi-reali/` (procedura
// in fondo al report), che oggi resta vuota.

import type { PropostaContratto } from "@shared/contratti/estrazione";
import { disponibilitaOcr } from "../../documenti/ocr";
import { estraiTestoDocumento } from "../../documenti/parserRegistry";
import { creaProviderPerRun, statoProvider } from "../../tars/costi/providerGovernato";
import type { TarsProvider } from "../../tars/provider";
import { arricchisciDaLayoutWnd, riconosceLayoutWnd } from "../estrazione/layoutWnd";
import { costruisciProposta, type ContestoMappa } from "../estrazione/mappa";
import { estraiConModello, modelloEstrazione, type ContestoEstrazione } from "../estrazione/modello";
import type { EsitoModello } from "../estrazione/schema";
import { caricaCasiContrattoReali, casiContrattoSintetici, type CasoContrattoEval } from "./casi";

export type GiudizioCampoContratto = "corretto" | "errato" | "mancante" | "corretto_negativo" | "falso_positivo";

export type EsitoCasoContratto = {
  nome: string;
  descrizione: string;
  saltato: boolean;
  tempoMs: number;
  esitoParser: string;
  parserUsato: string | null;
  pagine: number;
  fonteEsito: "finto" | "reale" | null;
  layoutWndRiconosciuto: boolean | null;
  layoutWndCorretto: boolean | null;
  campi: Record<string, GiudizioCampoContratto>;
  controlliAttesiMancanti: string[];
  controlliInattesi: string[];
  note: string[];
};

export type MetricheEvalContratti = {
  casiTotali: number;
  casiEseguiti: number;
  casiSaltati: number;
  layoutWndCasiTotali: number;
  layoutWndCasiCorretti: number;
  campi: Record<
    string,
    { attesi: number; corretti: number; errati: number; mancanti: number; falsiPositivi: number }
  >;
  coperturaCampi: number;
  correttezzaCampi: number;
  falsiPositiviCampi: number;
  controlli: { attesi: number; trovati: number; inattesi: number };
  tempoTotaleMs: number;
};

export type RisultatoEvalContratti = {
  generatoIl: string;
  modello: string;
  usoModelloReale: boolean;
  casi: EsitoCasoContratto[];
  metriche: MetricheEvalContratti;
};

function giudicaCampo<T>(atteso: T | null, effettivo: T | null): GiudizioCampoContratto {
  if (atteso == null) return effettivo == null ? "corretto_negativo" : "falso_positivo";
  if (effettivo == null) return "mancante";
  const uguale =
    Array.isArray(atteso) || Array.isArray(effettivo)
      ? JSON.stringify(atteso) === JSON.stringify(effettivo)
      : atteso === effettivo;
  return uguale ? "corretto" : "errato";
}

async function eseguiCasoContratto(
  caso: CasoContrattoEval,
  opzioni: { ocrDisponibile: boolean; providerReale: TarsProvider | null; modello: string }
): Promise<EsitoCasoContratto> {
  const esito: EsitoCasoContratto = {
    nome: caso.nome,
    descrizione: caso.descrizione,
    saltato:
      (caso.richiedeBinari && !opzioni.ocrDisponibile) || (caso.esitoFinto == null && !opzioni.providerReale),
    tempoMs: 0,
    esitoParser: "-",
    parserUsato: null,
    pagine: 0,
    fonteEsito: null,
    layoutWndRiconosciuto: null,
    layoutWndCorretto: null,
    campi: {},
    controlliAttesiMancanti: [],
    controlliInattesi: [],
    note: [],
  };
  if (esito.saltato) return esito;

  const partenza = Date.now();
  const parser = await estraiTestoDocumento(caso.bytes, "application/pdf", `${caso.nome}.pdf`);
  esito.tempoMs = Date.now() - partenza;
  esito.esitoParser = parser.esito;
  if (parser.esito !== "estratto") {
    esito.note.push(`esito parser: ${parser.esito}`);
    return esito;
  }
  esito.parserUsato = parser.parser;
  esito.pagine = parser.pagine.length;

  let esitoModello: EsitoModello;
  let troncato = false;
  if (opzioni.providerReale) {
    esito.fonteEsito = "reale";
    const contestoEstrazione: ContestoEstrazione = {
      clienteCommessa: caso.contesto.clienteCommessa.nome,
      codiceCommessa: `EVAL-${caso.nome}`,
    };
    const risposta = await estraiConModello({
      pagine: parser.pagine,
      contesto: contestoEstrazione,
      provider: opzioni.providerReale,
      modello: opzioni.modello,
      identita: { runId: `eval-contratti:${caso.nome}:${Date.now()}`, passo: 1, tentativo: 1, conversazioneId: null },
    });
    esitoModello = risposta.esito;
    troncato = risposta.troncato;
  } else {
    // caso.esitoFinto != null qui: altrimenti il caso sarebbe stato saltato sopra.
    esito.fonteEsito = "finto";
    esitoModello = caso.esitoFinto!;
  }

  const contestoMappa: ContestoMappa = { ...caso.contesto, pagine: parser.pagine };
  let proposta: PropostaContratto = costruisciProposta(esitoModello, contestoMappa, troncato);
  const layoutRiconosciuto = riconosceLayoutWnd(parser.pagine);
  esito.layoutWndRiconosciuto = layoutRiconosciuto;
  esito.layoutWndCorretto = layoutRiconosciuto === caso.atteso.layoutWndRiconosciuto;
  if (layoutRiconosciuto) {
    proposta = arricchisciDaLayoutWnd(parser.pagine, proposta, {
      ivaDescrizione: esitoModello.pattuito.ivaDescrizione,
      troncato,
    });
  }

  esito.campi.pattuitoCent = giudicaCampo(caso.atteso.pattuitoCent, proposta.pattuitoCent.valore);
  esito.campi.pattuitoTipo = giudicaCampo(caso.atteso.pattuitoTipo, proposta.pattuitoTipo.valore);
  esito.campi.numeroRighe = giudicaCampo(caso.atteso.numeroRighe, proposta.righe.length);
  esito.campi.rateQuote = giudicaCampo(
    caso.atteso.rateQuote,
    proposta.rate.valore.map(r => r.quotaPct)
  );
  if (caso.atteso.comuneCantiere !== undefined) {
    esito.campi.comuneCantiere = giudicaCampo(caso.atteso.comuneCantiere, proposta.comuneCantiere.valore);
  }
  if (caso.atteso.righe) {
    caso.atteso.righe.forEach((rigaAttesa, indice) => {
      const riga = proposta.righe[indice] ?? null;
      const prefisso = `riga${indice}`;
      esito.campi[`${prefisso}:larghezza`] = giudicaCampo(rigaAttesa.larghezzaMm, riga?.larghezzaMm.valore ?? null);
      esito.campi[`${prefisso}:altezza`] = giudicaCampo(rigaAttesa.altezzaMm, riga?.altezzaMm.valore ?? null);
      esito.campi[`${prefisso}:quantita`] = giudicaCampo(rigaAttesa.quantita, riga?.quantita.valore ?? null);
      esito.campi[`${prefisso}:prezzo`] = giudicaCampo(rigaAttesa.prezzoTotCent, riga?.prezzoTotCent.valore ?? null);
    });
  }

  const codiciControllo = proposta.controlli.map(c => c.codice);
  esito.controlliAttesiMancanti = caso.atteso.controlliAttesi.filter(codice => !codiciControllo.includes(codice));
  esito.controlliInattesi = caso.atteso.controlliVietati.filter(codice => codiciControllo.includes(codice));
  if (esito.controlliAttesiMancanti.length > 0) {
    esito.note.push(`controlli attesi mancanti: ${esito.controlliAttesiMancanti.join(", ")}`);
  }
  if (esito.controlliInattesi.length > 0) {
    esito.note.push(`controlli inattesi: ${esito.controlliInattesi.join(", ")}`);
  }

  return esito;
}

export async function eseguiEvalContratti(opzioni?: {
  provider?: TarsProvider;
  sedeId?: number;
  utenteId?: number;
}): Promise<RisultatoEvalContratti> {
  const modello = modelloEstrazione();
  const realeRichiesto = (process.env.EVAL_CONTRATTI_REALE ?? "").trim().toLowerCase() === "on";
  // Difesa in profondità: anche con EVAL_CONTRATTI_REALE=on, senza un
  // provider reale utilizzabile (chiave, flag, budget, ledger) non si crea
  // nessun provider — mai una chiamata a pagamento per sorpresa in un
  // ambiente di test (statoProvider è "finto" quando manca una qualunque
  // condizione, incluso «niente OPENAI_API_KEY»).
  const usoModelloReale = realeRichiesto && (opzioni?.provider != null || statoProvider(modello).tipo === "openai");
  const providerReale: TarsProvider | null = usoModelloReale
    ? (opzioni?.provider ??
      creaProviderPerRun({
        modello,
        sedeId: opzioni?.sedeId ?? 0,
        utenteId: opzioni?.utenteId ?? 0,
        classe: "document_intelligence",
        copioneFinto: () => ({ tipo: "messaggio", testo: "{}", uso: { input: 0, output: 0, cachedInput: 0, cacheWrite: 0 } }),
      }))
    : null;

  const [disponibilitaOcrLocale, sintetici, reali] = await Promise.all([
    disponibilitaOcr(),
    casiContrattoSintetici(),
    caricaCasiContrattoReali(),
  ]);
  const casi = [...sintetici, ...reali];

  const esiti: EsitoCasoContratto[] = [];
  for (const caso of casi) {
    esiti.push(await eseguiCasoContratto(caso, { ocrDisponibile: disponibilitaOcrLocale.disponibile, providerReale, modello }));
  }

  const eseguiti = esiti.filter(esito => !esito.saltato);
  const conLayout = eseguiti.filter(esito => esito.layoutWndRiconosciuto != null);

  const campi: MetricheEvalContratti["campi"] = {};
  let attesiNonNull = 0;
  let estrattiSuAttesi = 0;
  let correttiSuAttesi = 0;
  let falsiPositiviCampi = 0;
  for (const esito of eseguiti) {
    for (const [campo, giudizio] of Object.entries(esito.campi)) {
      campi[campo] ??= { attesi: 0, corretti: 0, errati: 0, mancanti: 0, falsiPositivi: 0 };
      const voce = campi[campo];
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

  // "attesi" conta le verifiche dichiarate dai casi ESEGUITI (un caso
  // saltato non ha verificato niente); "trovati" = attesi − mancanti.
  const controlliAttesiDichiarati = eseguiti.reduce((s, e) => {
    const caso = casi.find(c => c.nome === e.nome);
    return s + (caso?.atteso.controlliAttesi.length ?? 0);
  }, 0);
  const controlliAttesiMancantiTotali = eseguiti.reduce((s, e) => s + e.controlliAttesiMancanti.length, 0);
  const controlliInattesiTotali = eseguiti.reduce((s, e) => s + e.controlliInattesi.length, 0);

  const metriche: MetricheEvalContratti = {
    casiTotali: esiti.length,
    casiEseguiti: eseguiti.length,
    casiSaltati: esiti.length - eseguiti.length,
    layoutWndCasiTotali: conLayout.length,
    layoutWndCasiCorretti: conLayout.filter(esito => esito.layoutWndCorretto).length,
    campi,
    coperturaCampi: attesiNonNull ? estrattiSuAttesi / attesiNonNull : 1,
    correttezzaCampi: estrattiSuAttesi ? correttiSuAttesi / estrattiSuAttesi : 1,
    falsiPositiviCampi,
    controlli: {
      attesi: controlliAttesiDichiarati,
      trovati: controlliAttesiDichiarati - controlliAttesiMancantiTotali,
      inattesi: controlliInattesiTotali,
    },
    tempoTotaleMs: esiti.reduce((s, e) => s + e.tempoMs, 0),
  };

  return {
    generatoIl: new Date().toISOString(),
    modello,
    usoModelloReale,
    casi: esiti,
    metriche,
  };
}

export function reportMarkdownContratti(risultato: RisultatoEvalContratti): string {
  const m = risultato.metriche;
  const percento = (valore: number) => `${Math.round(valore * 100)}%`;
  const righe: string[] = [
    "# Piano 3 — Eval lettura del contratto (fixture sintetiche)",
    "",
    `> Generato il ${risultato.generatoIl}. Modello configurato: \`${risultato.modello}\`. Sorgente esiti: ${risultato.usoModelloReale ? "**chiamata reale al provider**" : "esito finto (nessuna rete)"}.`,
    ">",
    "> **Questi numeri NON dichiarano l'accuratezza del modello reale**: le",
    "> fixture sintetiche fissano l'esito del modello e misurano solo che",
    "> parser e mappatura deterministica restino corretti. L'accuratezza vera",
    "> si misura sui casi reali anonimizzati (procedura in fondo).",
    "",
    "## Metriche",
    "",
    `- Casi: ${m.casiEseguiti}/${m.casiTotali} eseguiti (${m.casiSaltati} saltati).`,
    `- Layout WnD: riconosciuto correttamente in ${m.layoutWndCasiCorretti}/${m.layoutWndCasiTotali} casi.`,
    `- Campi: copertura ${percento(m.coperturaCampi)}, correttezza sugli estratti ${percento(m.correttezzaCampi)}, falsi positivi ${m.falsiPositiviCampi}.`,
    `- Controlli: ${m.controlli.trovati}/${m.controlli.attesi} attesi trovati, ${m.controlli.inattesi} inattesi.`,
    `- Tempo totale ${m.tempoTotaleMs} ms.`,
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
    "| Caso | Esito parser | Fonte | Layout WnD | Note |",
    "|---|---|---|---|---|",
    ...risultato.casi.map(esito =>
      esito.saltato
        ? `| ${esito.nome} | SALTATO | - | - | ${esito.descrizione} |`
        : `| ${esito.nome} | ${esito.esitoParser} | ${esito.fonteEsito ?? "-"} | ${esito.layoutWndRiconosciuto == null ? "-" : esito.layoutWndRiconosciuto ? "sì" : "no"}${esito.layoutWndCorretto === false ? " ⚠️" : ""} | ${esito.note.join("; ") || "-"} |`
    ),
    "",
    "## Aggiungere casi reali anonimizzati (procedura)",
    "",
    "1. Raccogliere contratti/preventivi PDF reali firmati e **anonimizzarli**:",
    "   rimuovere o sostituire nome del cliente, indirizzo del cantiere, CF e",
    "   riferimenti pratica; gli importi possono restare (servono a validare",
    "   la mappatura) salvo che identifichino la commessa in modo univoco.",
    "2. Salvarli in `server/contratti/eval/casi-reali/<nome>/documento.pdf`",
    "   con `atteso.json` accanto (la cartella è in `.gitignore`: i documenti",
    "   reali NON entrano mai nel repository) — stessa procedura di",
    "   `docs/reports/d7-eval-2026-08-29.md`.",
    "3. Senza `EVAL_CONTRATTI_REALE=on` e un provider reale disponibile questi",
    "   casi restano saltati: non esiste un «esito finto» per un documento",
    "   sconosciuto, serve la lettura vera del modello.",
    "4. Rieseguire `pnpm eval:contratti` e confrontare col baseline.",
    "",
  ];
  return righe.join("\n");
}

// Entry CLI: `pnpm eval:contratti` — esegue tutto e scrive il report
// (Ruling P3-R26: l'entry point vive qui, non in un file cli.ts separato,
// come `server/documenti/eval/runEval.ts` e `server/tars/eval/runEval.ts`).
const eseguitoDirettamente =
  process.argv[1]?.endsWith("runEval.ts") || process.argv[1]?.endsWith("runEval.js");
if (eseguitoDirettamente) {
  const { writeFile } = await import("node:fs/promises");
  const risultato = await eseguiEvalContratti();
  const giorno = risultato.generatoIl.slice(0, 10);
  const percorso = `docs/reports/piano3-eval-contratti-${giorno}.md`;
  await writeFile(percorso, reportMarkdownContratti(risultato));
  console.log(
    `Eval contratti completata: ${risultato.metriche.casiEseguiti}/${risultato.metriche.casiTotali} casi, report in ${percorso}`
  );
}
