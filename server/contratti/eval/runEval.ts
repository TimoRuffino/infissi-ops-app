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
import { arricchisciDaLayoutPreventivo, riconosceLayoutPreventivo } from "../estrazione/layoutPreventivo";
import { PAGINE_VISIONE_CONTRATTO } from "../estrazione/servizio";
import { costruisciProposta, type ContestoMappa } from "../estrazione/mappa";
import { estraiConModello, modelloEstrazione, type ContestoEstrazione } from "../estrazione/modello";
import type { EsitoModello } from "../estrazione/schema";
import { caricaCasiContrattoReali, casiContrattoSintetici, type AttesoRigaContratto, type CasoContrattoEval } from "./casi";

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

/**
 * Abbina ogni riga attesa a una riga estratta per misure (±5 mm) e
 * quantità, non per posizione: il contratto elenca coprifili e accessori
 * che la verità (foglio limiti o layout WnD) non ha, e una riga in più in
 * testa non deve far sbagliare tutte le altre. Preferenza: la riga allo
 * stesso indice se compatibile, poi la prima libera con misure e quantità
 * uguali, poi la prima libera con le sole misure. Un campo atteso assente
 * non si giudica; una riga attesa senza abbinamento è «mancante» su ogni
 * campo noto. Le righe estratte rimaste libere finiscono nelle note.
 */
function abbinaRighe(attese: AttesoRigaContratto[], proposta: PropostaContratto, esito: EsitoCasoContratto): void {
  const libere = new Set(proposta.righe.map((_, i) => i));
  const misuraOk = (attesa: number | null | undefined, effettiva: number | null): boolean => {
    if (attesa === undefined) return true;
    if (attesa === null) return effettiva === null;
    return effettiva != null && Math.abs(effettiva - attesa) <= 5;
  };
  const compatibile = (a: AttesoRigaContratto, i: number): boolean => {
    const r = proposta.righe[i];
    return misuraOk(a.larghezzaMm, r.larghezzaMm.valore) && misuraOk(a.altezzaMm, r.altezzaMm.valore);
  };
  const stessaQuantita = (a: AttesoRigaContratto, i: number): boolean =>
    a.quantita === undefined || a.quantita === proposta.righe[i].quantita.valore;
  const senzaMisure = (a: AttesoRigaContratto): boolean => a.larghezzaMm == null && a.altezzaMm == null;

  attese.forEach((attesa, indice) => {
    let scelta: number | null = null;
    if (libere.has(indice) && compatibile(attesa, indice) && stessaQuantita(attesa, indice)) scelta = indice;
    else {
      const candidati = [...libere].filter(i => compatibile(attesa, i));
      // Senza misure attese (coprifili, accessori) servono quantità e prezzo, altrimenti si abbina alla cieca.
      const stretti = candidati.filter(i =>
        stessaQuantita(attesa, i) &&
        (!senzaMisure(attesa) || attesa.prezzoTotCent === undefined || attesa.prezzoTotCent === proposta.righe[i].prezzoTotCent.valore)
      );
      scelta = stretti[0] ?? (senzaMisure(attesa) ? null : candidati[0] ?? null);
    }
    const riga = scelta != null ? proposta.righe[scelta] : null;
    if (scelta != null) libere.delete(scelta);
    const prefisso = `riga${indice}`;
    const giudica = <T,>(campo: string, atteso: T | null | undefined, effettivo: T | null) => {
      if (atteso !== undefined) esito.campi[`${prefisso}:${campo}`] = giudicaCampo(atteso, effettivo);
    };
    giudica("larghezza", attesa.larghezzaMm, riga ? riga.larghezzaMm.valore : null);
    giudica("altezza", attesa.altezzaMm, riga ? riga.altezzaMm.valore : null);
    giudica("quantita", attesa.quantita, riga ? riga.quantita.valore : null);
    giudica("prezzo", attesa.prezzoTotCent, riga ? riga.prezzoTotCent.valore : null);
    if (!riga) {
      esito.note.push(`riga attesa ${indice} senza abbinamento: L${attesa.larghezzaMm ?? "-"} x H${attesa.altezzaMm ?? "-"} q${attesa.quantita ?? "-"}`);
    }
  });
  if (libere.size > 0) {
    const descrizioni = [...libere].map(i => {
      const r = proposta.righe[i];
      return `${r.descrizione.valore.slice(0, 40)} L${r.larghezzaMm.valore ?? "-"} x H${r.altezzaMm.valore ?? "-"} q${r.quantita.valore}`;
    });
    esito.note.push(`righe estratte in più (${libere.size}): ${descrizioni.join("; ")}`);
  }
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
  // EVAL_CONTRATTI_LETTURA=visione: le scansioni passano dalla lettura visiva
  // del modello (niente OCR), con l'identità di comodo dell'eval; default:
  // OCR locale come in produzione senza identità.
  const letturaVisiva = (process.env.EVAL_CONTRATTI_LETTURA ?? "").trim().toLowerCase() === "visione";
  const parser = await estraiTestoDocumento(
    caso.bytes,
    "application/pdf",
    `${caso.nome}.pdf`,
    letturaVisiva ? { ocr: false, visione: { sedeId: 0, utenteId: 0, maxPagine: PAGINE_VISIONE_CONTRATTO } } : undefined
  );
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
  let sanificazioni: string[] = [];
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
    sanificazioni = risposta.sanificazioni;
  } else {
    // caso.esitoFinto != null qui: altrimenti il caso sarebbe stato saltato sopra.
    esito.fonteEsito = "finto";
    esitoModello = caso.esitoFinto!;
  }

  const contestoMappa: ContestoMappa = { ...caso.contesto, pagine: parser.pagine };
  let proposta: PropostaContratto = costruisciProposta(esitoModello, contestoMappa, troncato);
  const layoutRiconosciuto = riconosceLayoutWnd(parser.pagine);
  esito.layoutWndRiconosciuto = layoutRiconosciuto;
  esito.layoutWndCorretto =
    caso.atteso.layoutWndRiconosciuto === undefined ? null : layoutRiconosciuto === caso.atteso.layoutWndRiconosciuto;
  if (layoutRiconosciuto) {
    proposta = arricchisciDaLayoutWnd(parser.pagine, proposta, {
      ivaDescrizione: esitoModello.pattuito.ivaDescrizione,
      troncato,
    });
  } else if (riconosceLayoutPreventivo(parser.pagine)) {
    proposta = arricchisciDaLayoutPreventivo(parser.pagine, proposta, {
      ivaDescrizione: esitoModello.pattuito.ivaDescrizione,
      troncato,
    });
    esito.note.push("layout preventivo 2025 riconosciuto");
  }
  if (sanificazioni.length > 0) {
    proposta = { ...proposta, avvertenze: [...proposta.avvertenze, ...sanificazioni] };
    esito.note.push(`sanificazioni: ${sanificazioni.join(" · ")}`);
  }

  // Un campo assente nell'atteso non è noto: non si giudica (fase 3 dello
  // studio: la verità dei fogli limiti copre misure e quantità, non il
  // pattuito né le rate).
  if (caso.atteso.pattuitoCent !== undefined) {
    esito.campi.pattuitoCent = giudicaCampo(caso.atteso.pattuitoCent, proposta.pattuitoCent.valore);
  }
  if (caso.atteso.pattuitoTipo !== undefined) {
    esito.campi.pattuitoTipo = giudicaCampo(caso.atteso.pattuitoTipo, proposta.pattuitoTipo.valore);
  }
  if (caso.atteso.numeroRighe !== undefined) {
    esito.campi.numeroRighe = giudicaCampo(caso.atteso.numeroRighe, proposta.righe.length);
  }
  if (caso.atteso.rateQuote !== undefined) {
    esito.campi.rateQuote = giudicaCampo(
      caso.atteso.rateQuote,
      proposta.rate.valore.map(r => r.quotaPct)
    );
  }
  if (caso.atteso.comuneCantiere !== undefined) {
    esito.campi.comuneCantiere = giudicaCampo(caso.atteso.comuneCantiere, proposta.comuneCantiere.valore);
  }
  if (caso.atteso.righe) {
    abbinaRighe(caso.atteso.righe, proposta, esito);
  }

  // Con EVAL_CONTRATTI_DUMP=<cartella> ogni caso lascia testo letto, esito
  // del modello e proposta finale in un JSON: è il materiale per capire
  // PERCHÉ una riga manca (OCR, modello o mappatura). Contiene il documento
  // in chiaro: solo fuori dal repository.
  const cartellaDump = (process.env.EVAL_CONTRATTI_DUMP ?? "").trim();
  if (cartellaDump) {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    await fs.mkdir(cartellaDump, { recursive: true });
    await fs.writeFile(
      path.join(cartellaDump, `${caso.nome}.json`),
      JSON.stringify({ parser: parser.parser, avvertenzeParser: parser.avvertenze, ocr: parser.ocr ?? null, pagine: parser.pagine, troncato, esitoModello, proposta }, null, 1)
    );
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
  // EVAL_CONTRATTI_SOLO=<nome,nome>: solo quei casi (per riprovare una
  // lettura senza rifare tutte le chiamate al modello).
  const solo = (process.env.EVAL_CONTRATTI_SOLO ?? "").split(",").map(s => s.trim()).filter(Boolean);
  const casi = [...sintetici, ...reali].filter(c => solo.length === 0 || solo.some(s => c.nome === s || c.nome === `reale-${s}`));

  const esiti: EsitoCasoContratto[] = [];
  for (const caso of casi) {
    // Un caso che esplode (provider, parser) non ferma gli altri: resta nel
    // report come saltato, con il motivo nelle note.
    try {
      esiti.push(await eseguiCasoContratto(caso, { ocrDisponibile: disponibilitaOcrLocale.disponibile, providerReale, modello }));
    } catch (errore: any) {
      esiti.push({
        nome: caso.nome, descrizione: caso.descrizione, saltato: true, tempoMs: 0, esitoParser: "-", parserUsato: null, pagine: 0,
        fonteEsito: null, layoutWndRiconosciuto: null, layoutWndCorretto: null, campi: {}, controlliAttesiMancanti: [], controlliInattesi: [],
        note: [`errore: ${String(errore?.message ?? errore)}`],
      });
    }
  }

  const eseguiti = esiti.filter(esito => !esito.saltato);
  const conLayout = eseguiti.filter(esito => esito.layoutWndCorretto != null);

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
