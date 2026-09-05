// server/fatture/generatore.ts
// La bozza nasce dal contratto (beni), dal computo (servizi entro i limiti,
// nota del calcolo) e dalle diciture; le righe derivate (markup, storno e
// riaddebito dei beni significativi) escono dal risolutore a ogni ricalcolo,
// mai a mano. Funzione pura: il servizio la chiama e persiste.
import { DICITURE, dicitureDefault, type ChiaveDicitura } from "@shared/fatturazione/diciture";
import type { ClienteSnapshot, FatturazioneConfig, PraticaEdilizia, RigaFatturaInput, ScadenzaFatturaInput } from "@shared/fatturazione/tipi";
import type { CategoriaRiga, Computo, Contratto, RataContratto, RigaContratto, VoceComputo } from "@shared/limiti/tipi";
import { riequilibraBeni, risolvi, type EsitoRisolutore } from "./risolutore";

export type InputGeneratore = {
  contratto: Contratto; righe: RigaContratto[]; computo: Computo | null;
  cliente: ClienteSnapshot | null; commessa: { codice: string; indirizzo: string | null; citta: string | null };
  /** Qui serve solo `speseDocumentazioneCent` (R17); il resto è dell'emissione (IBAN, banca, numerazione FiC…). */
  config: FatturazioneConfig;
  dataFattura: string;
  /** Default vero: la bozza nasce già dentro il pattuito (`bilancia`). Falso = proposta grezza, beni a contratto e servizi ai limiti. */
  bilancia?: boolean;
};
export type Bozza = {
  righe: RigaFatturaInput[]; scadenze: ScadenzaFatturaInput[]; diciture: ChiaveDicitura[];
  intestazioneCantiere: string | null; note: string | null; avvertenze: string[];
};

const FAMIGLIA: Partial<Record<CategoriaRiga, string>> = {
  serramento_pvc: "Serramenti in PVC", serramento_alluminio: "Serramenti in alluminio",
  serramento_legno: "Serramenti in legno", serramento_legno_alluminio: "Serramenti in legno-alluminio",
  cassonetto: "Cassonetti", tapparella: "Tapparelle", persiana: "Persiane", scuro: "Scuri",
  porta_blindata: "Porte blindate", portoncino: "Portoncini",
};

function rigaBase(tipo: RigaFatturaInput["tipo"], descrizione: string, importoCent: number, aliquota: 22 | 10 | null): RigaFatturaInput {
  return { ordine: 0, tipo, descrizione, quantita: 1, prezzoUnitCent: importoCent, importoCent, aliquota, voceComputoCodice: null, rigaCommessaId: null, limiteCent: null, beneSignificativo: false, derivata: false };
}

export function descrizioneRigaBene(r: RigaContratto): string {
  const misure = r.larghezzaMm && r.altezzaMm ? ` L${r.larghezzaMm} x H${r.altezzaMm}` : "";
  const oscurante = r.oscuranteIntegrato ? ` con ${r.oscuranteIntegrato}` : "";
  return `N.${r.quantita} ${r.descrizione}${misure}${oscurante}`;
}

function euro(cent: number): string {
  return (cent / 100).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const VOCE_SPESE_DOCUMENTAZIONE = "spese_professionali";
const DESCRIZIONE_SPESE_DOCUMENTAZIONE = "Spese per documentazione detrazione";

/**
 * R17 (fatture 92 e 106): `spese_professionali` non è una prestazione al
 * 10 %, è la riga «Spese per documentazione detrazione» al 22 % fra i beni
 * significativi — resta fuori dai servizi proposti anche quando il computo
 * la include. Esportata: `verificaLimiti` (R25) la riusa per sommare i
 * limiti delle stesse voci opere/eventuali che qui generano le righe —
 * stesso insieme, un solo posto che lo definisce.
 */
export function servizioProposto(v: VoceComputo): boolean {
  return (
    (v.gruppo === "opere" || v.gruppo === "eventuali") && v.inclusa && v.limiteCent > 0 &&
    v.codice !== "altri_servizi" && v.codice !== VOCE_SPESE_DOCUMENTAZIONE
  );
}

/** CIL/CILA/SCIA come vanno scritte in fattura; "nessuna" non produce nessuna riga. */
const ETICHETTA_PRATICA: Record<Exclude<PraticaEdilizia, "nessuna">, string> = { cil: "CIL", cila: "CILA", scia: "SCIA" };

function notaLimite(computo: Computo): string {
  const righe = computo.voci
    .filter(v => v.gruppo === "prodotti" && v.codice.startsWith("massimale_") && v.limiteCent > 0)
    .map(v => `${v.quantita.toLocaleString("it-IT", { maximumFractionDigits: 2 })} mq x ${euro(v.prezzoUnitCent)} = € ${euro(v.limiteCent)}`);
  return [`Calcolo limite massimo spesa zona climatica ${computo.zona ?? "-"}:`, ...righe, `Limite complessivo (min CHECK1/CHECK2) € ${euro(computo.limiteCent)}`].join("\n");
}

function aggiungiGiorni(iso: string, giorni: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + giorni);
  return d.toISOString().slice(0, 10);
}

const GIORNI_DEFAULT = [0, 60, 75, 90];
const RATE_DEFAULT: RataContratto[] = [
  { numero: 1, quotaPct: 50, giorni: null, data: null, descrizione: "all'ordine" },
  { numero: 2, quotaPct: 40, giorni: null, data: null, descrizione: "arrivo merce pronta" },
  { numero: 3, quotaPct: 10, giorni: null, data: null, descrizione: "posa in opera ultimata" },
];

export function scadenzeDaRate(rate: RataContratto[], totaleCent: number, dataFattura: string): ScadenzaFatturaInput[] {
  const effettive = rate.length > 0 ? rate : RATE_DEFAULT;
  const importi = effettive.map(r => Math.round((totaleCent * r.quotaPct) / 100));
  const parziale = importi.slice(0, -1).reduce((s, x) => s + x, 0);
  importi[importi.length - 1] = totaleCent - parziale;
  return effettive.map((r, i) => ({
    numero: r.numero, quotaPct: r.quotaPct, importoCent: importi[i], descrizione: r.descrizione,
    data: r.data ?? aggiungiGiorni(dataFattura, r.giorni ?? GIORNI_DEFAULT[Math.min(i, GIORNI_DEFAULT.length - 1)]),
  }));
}

function rinumera(righe: RigaFatturaInput[]): RigaFatturaInput[] {
  return righe.map((r, i) => ({ ...r, ordine: i + 1 }));
}

/**
 * Dove va il markup nel corpo (senza le note): subito dopo l'ultima riga
 * bene, se c'è. Senza righe bene (es. contratto tutto senza prezzo)
 * `lastIndexOf` torna −1: il markup non deve finire in testa, prima delle
 * intestazioni — va prima dell'intestazione «prestazioni» se c'è,
 * altrimenti in coda al corpo (Ruling R5, fix review Task 4).
 */
function posizioneMarkup(corpo: RigaFatturaInput[]): number {
  const ultimoBene = corpo.map(r => r.tipo).lastIndexOf("bene");
  if (ultimoBene >= 0) return ultimoBene + 1;
  const prestazioni = corpo.findIndex(r => r.tipo === "intestazione" && r.descrizione === DICITURE.prestazioni);
  return prestazioni >= 0 ? prestazioni : corpo.length;
}

/** Sotto questa frazione del prezzo di contratto i beni significativi non scendono da soli: oltre, scendono i servizi. */
export const FATTORE_MINIMO_BENI = 0.6;
/** Sotto questa frazione dei limiti i servizi non scendono da soli. */
export const FATTORE_MINIMO_SERVIZI = 0.4;

function esitoDi(righe: RigaFatturaInput[], pattuitoCent: number, pattuitoTipo: "lordo" | "imponibile"): EsitoRisolutore {
  const fisse = righe.filter(r => !r.derivata);
  const beni = fisse.filter(r => r.tipo === "bene");
  return risolvi({
    pattuitoCent, pattuitoTipo,
    beniSignificativiCent: beni.filter(r => r.beneSignificativo).reduce((s, r) => s + r.importoCent, 0),
    beniAltriCent: beni.filter(r => !r.beneSignificativo).reduce((s, r) => s + r.importoCent, 0),
    serviziCent: fisse.filter(r => r.tipo === "servizio").reduce((s, r) => s + r.importoCent, 0),
  });
}

/**
 * La bozza nasce con i conti che tornano, come nelle fatture reali 2026
 * (studio del 05/09 e confronto dal vivo del 05/09 notte): il pattuito è
 * fisso, i servizi restano ai limiti e, se beni e servizi lo superano,
 * prima scendono i beni significativi in proporzione (`riequilibraBeni`,
 * mai sotto `FATTORE_MINIMO_BENI` del contratto), poi i servizi in
 * proporzione (mai sotto `FATTORE_MINIMO_SERVIZI` dei limiti, arrotondati
 * all'euro per difetto), finché il markup non è più negativo.
 *
 * Perché i beni prima: a parità di lordo, ogni euro spostato dai beni
 * significativi (22 % oltre la prestazione) ai servizi (10 %) alza
 * l'imponibile — cioè il ricavo dell'azienda e la spesa detraibile del
 * cliente. È quello che la commercialista fa quando il pattuito lo
 * permette (129: servizi ai limiti, beni giù del 28 %); nei lavori
 * strettissimi taglia anche i servizi, ed è il secondo passo qui.
 * Con il pattuito capiente non cambia nulla: il markup resta il residuo.
 * Ogni intervento è scritto nelle avvertenze; l'operatore può sempre
 * rimettere mano a servizi e beni.
 */
export function bilancia(input: { righe: RigaFatturaInput[]; pattuitoCent: number; pattuitoTipo: "lordo" | "imponibile" }): { righe: RigaFatturaInput[]; avvertenze: string[] } {
  const avvertenze: string[] = [];
  const righe = input.righe.map(r => ({ ...r }));
  const m0 = esitoDi(righe, input.pattuitoCent, input.pattuitoTipo).markupCent;
  if (m0 >= 0) return { righe, avvertenze };

  // 1. Beni significativi, un passo alla volta: con il pattuito lordo la
  // prestazione dipende dai beni (IVA mista), quindi si converge in pochi giri.
  const significativi = righe.filter(r => r.tipo === "bene" && r.beneSignificativo && !r.derivata);
  const contratto = significativi.reduce((s, r) => s + r.importoCent, 0);
  const pavimentoBeni = Math.round(contratto * FATTORE_MINIMO_BENI);
  let ridotti = 0;
  for (let giro = 0; giro < 8 && significativi.length > 0; giro++) {
    const esito = esitoDi(righe, input.pattuitoCent, input.pattuitoTipo);
    if (esito.markupCent >= 0) break;
    const B = significativi.reduce((s, r) => s + r.importoCent, 0);
    if (B <= pavimentoBeni) break;
    // Con il pattuito lordo e B > P ogni euro tolto ai beni ne rende 1,22/0,98 alla prestazione.
    const resa = input.pattuitoTipo === "lordo" && esito.casoBeniSignificativi === "b_maggiore_p" ? 1.22 / 0.98 : 1;
    const target = Math.max(pavimentoBeni, B + Math.ceil(esito.markupCent / resa));
    const nuovi = riequilibraBeni(significativi.map(r => r.importoCent), target);
    significativi.forEach((r, i) => { ridotti += r.importoCent - nuovi[i]; r.importoCent = nuovi[i]; r.prezzoUnitCent = r.importoCent; });
  }
  if (ridotti > 0) {
    avvertenze.push(`Beni significativi ridotti di € ${euro(ridotti)} in proporzione (${Math.round(((contratto - ridotti) / contratto) * 100)} % del contratto) per rientrare nel pattuito con i servizi ai limiti.`);
  }

  // 2. Se non basta, i servizi in proporzione, arrotondati all'euro per difetto.
  const m1 = esitoDi(righe, input.pattuitoCent, input.pattuitoTipo).markupCent;
  const servizi = righe.filter(r => r.tipo === "servizio" && !r.derivata);
  const S = servizi.reduce((s, r) => s + r.importoCent, 0);
  if (m1 < 0 && S > 0) {
    const fattore = Math.max(FATTORE_MINIMO_SERVIZI, Math.min(1, (S + m1) / S));
    for (const r of servizi) {
      r.importoCent = Math.floor((r.importoCent * fattore) / 100) * 100;
      r.prezzoUnitCent = r.importoCent;
    }
    avvertenze.push(`Servizi proposti al ${Math.round(fattore * 100)} % dei limiti: anche con i beni al minimo il pattuito non basta.`);
  }
  return { righe, avvertenze };
}

export function ricalcola(input: { righe: RigaFatturaInput[]; pattuitoCent: number; pattuitoTipo: "lordo" | "imponibile" }): { righe: RigaFatturaInput[]; esito: EsitoRisolutore } {
  const fisse = input.righe.filter(r => !r.derivata);
  const beni = fisse.filter(r => r.tipo === "bene");
  const B = beni.filter(r => r.beneSignificativo).reduce((s, r) => s + r.importoCent, 0);
  const N = beni.filter(r => !r.beneSignificativo).reduce((s, r) => s + r.importoCent, 0);
  const S = fisse.filter(r => r.tipo === "servizio").reduce((s, r) => s + r.importoCent, 0);
  const esito = risolvi({ pattuitoCent: input.pattuitoCent, pattuitoTipo: input.pattuitoTipo, beniSignificativiCent: B, beniAltriCent: N, serviziCent: S });

  const markup = { ...rigaBase("markup", DICITURE.markup, esito.markupCent, 10), derivata: true };
  const storno = { ...rigaBase("storno_bs", DICITURE.storno_bs, -esito.stornoCent, 22), derivata: true };
  const riaddebito = { ...rigaBase("riaddebito_bs", DICITURE.riaddebito_bs, esito.stornoCent, 10), derivata: true };

  const corpo = fisse.filter(r => r.tipo !== "nota");
  const note = fisse.filter(r => r.tipo === "nota");
  const posMarkup = posizioneMarkup(corpo);
  const conMarkup = [...corpo.slice(0, posMarkup), markup, ...corpo.slice(posMarkup)];
  const ultimoServizio = conMarkup.map(r => r.tipo).lastIndexOf("servizio");
  const posizione = ultimoServizio >= 0 ? ultimoServizio + 1 : conMarkup.length;
  const conStorno = esito.stornoCent > 0
    ? [...conMarkup.slice(0, posizione), storno, riaddebito, ...conMarkup.slice(posizione)]
    : conMarkup;
  return { righe: rinumera([...conStorno, ...note]), esito };
}

export function generaBozza(input: InputGeneratore): Bozza {
  const { contratto, computo } = input;
  const avvertenze: string[] = [];
  const righe: RigaFatturaInput[] = [];

  righe.push(rigaBase("intestazione", `${DICITURE.intestazione}\n${DICITURE.seguira_ddt}`, 0, null));
  // Solo le righe che diventeranno davvero una riga bene (prezzate): una
  // famiglia non deve comparire in intestazione senza righe corrispondenti
  // (fix review Task 4).
  const significative = input.righe.filter(r => r.beneSignificativo && r.prezzoTotCent != null);
  const famiglie = [...new Set(significative.map(r => FAMIGLIA[r.categoria] ?? r.categoria))];
  righe.push(rigaBase("intestazione", `${DICITURE.beni_significativi} ${famiglie.join(", ")}`.trim(), 0, null));

  // I beni non significativi (persiane, tapparelle, zanzariere, grate, tende)
  // stanno nella prestazione: 10 % sulla riga, come nelle fatture reali 2026
  // («beni dotati di autonomia funzionale»). Il risolutore li conta già in P.
  const bene = (r: RigaContratto): RigaFatturaInput => ({
    ...rigaBase("bene", descrizioneRigaBene(r), r.prezzoTotCent ?? 0, r.beneSignificativo ? 22 : 10), rigaCommessaId: r.id, beneSignificativo: r.beneSignificativo,
  });
  for (const r of input.righe) {
    if (r.prezzoTotCent == null) { avvertenze.push(`Riga "${r.descrizione}" senza prezzo: non è in fattura.`); continue; }
    if (r.beneSignificativo) righe.push(bene(r));
  }
  // R17: le spese di documentazione chiudono il blocco dei beni
  // significativi — importo dalla configurazione di sede, limite (se c'è)
  // dalla voce del computo, così il controllo per riga resta possibile.
  if (contratto.opzioniComputo.speseProfessionali) {
    const voce = computo?.voci.find(v => v.codice === VOCE_SPESE_DOCUMENTAZIONE) ?? null;
    righe.push({
      ...rigaBase("bene", DESCRIZIONE_SPESE_DOCUMENTAZIONE, input.config.speseDocumentazioneCent, 22),
      voceComputoCodice: VOCE_SPESE_DOCUMENTAZIONE,
      limiteCent: voce && voce.limiteCent > 0 ? voce.limiteCent : null,
      beneSignificativo: true,
    });
  }

  const altri = input.righe.filter(r => !r.beneSignificativo && r.prezzoTotCent != null);
  if (altri.length > 0) {
    righe.push(rigaBase("intestazione", DICITURE.beni_autonomi, 0, null));
    for (const r of altri) righe.push(bene(r));
  }

  righe.push(rigaBase("intestazione", DICITURE.prestazioni, 0, null));
  if (computo) {
    for (const v of [...computo.voci].sort((a, b) => a.ordine - b.ordine).filter(servizioProposto)) {
      righe.push({ ...rigaBase("servizio", v.descrizione, Math.floor(v.limiteCent / 100) * 100, 10), voceComputoCodice: v.codice, limiteCent: v.limiteCent });
    }
    righe.push(rigaBase("nota", notaLimite(computo), 0, null));
  } else {
    avvertenze.push("Computo assente: nessun servizio proposto.");
  }

  const bilanciate = input.bilancia === false
    ? { righe, avvertenze: [] as string[] }
    : bilancia({ righe, pattuitoCent: contratto.pattuitoCent, pattuitoTipo: contratto.pattuitoTipo });
  avvertenze.push(...bilanciate.avvertenze);
  const { righe: complete, esito } = ricalcola({ righe: bilanciate.righe, pattuitoCent: contratto.pattuitoCent, pattuitoTipo: contratto.pattuitoTipo });
  avvertenze.push(...esito.avvertenze);

  const praticaEdilizia = input.cliente?.praticaEdilizia ?? "nessuna";
  const diciture = dicitureDefault(contratto.detrazioneTipo, praticaEdilizia);
  const quote = contratto.rate.map(r => r.quotaPct);
  if (quote.length === 0 || (quote.length === 3 && quote[0] === 50 && quote[1] === 40 && quote[2] === 10)) diciture.push("pagamento_50_40_10");
  if (!contratto.opzioniComputo.speseProfessionali) diciture.push("spese_professionali_escluse");

  // "||" e non "??": un comuneCantiere vuoto ("", non solo null) deve
  // ricadere su commessa.citta comunque (fix review Task 4).
  const luogo = `${input.commessa.indirizzo ?? ""} ${contratto.comuneCantiere || input.commessa.citta || ""}`.trim();
  const intestazioneCantiere = luogo ? `Intervento da effettuare presso ${luogo}` : null;
  if (!intestazioneCantiere && contratto.detrazioneTipo !== "nessuna") avvertenze.push("Indirizzo del cantiere mancante.");
  if (contratto.detrazioneTipo !== "nessuna" && !input.cliente?.codiceFiscale) avvertenze.push("Cliente senza codice fiscale: obbligatorio con la detrazione.");

  // R19: la riga della pratica edilizia nasce come template — il tipo lo
  // sa il CRM, numero, data, comune e intestatario no: restano fra graffe
  // finché l'operatore non li compila (`validaPerEmissione` lo ricorda).
  const note = praticaEdilizia === "nessuna"
    ? null
    : DICITURE.pratica_edilizia.replace("{tipo}", ETICHETTA_PRATICA[praticaEdilizia]);

  return {
    righe: complete,
    scadenze: scadenzeDaRate(contratto.rate, esito.totaleCent, input.dataFattura),
    diciture, intestazioneCantiere, note, avvertenze,
  };
}
