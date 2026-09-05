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

/**
 * Quota del prezzo di contratto dei beni significativi che resta sulla riga
 * bene (22 %): il resto è il markup / servizi di vendita al 10 %. Mediana
 * delle 20 fatture 2025-2026 con foglio limiti (fase 2 dello studio: da
 * 62 % a 98 %, mediana 85 %); la commercialista sceglie una cifra tonda.
 */
export const QUOTA_BENI_SIGNIFICATIVI = 0.85;
/**
 * Le voci di servizio nell'ordine in cui la commercialista le tiene quando
 * il residuo non copre i limiti: le prime restano ai limiti, le ultime
 * spariscono per prime (assistenza muraria a zero in 14 fatture su 18,
 * smaltimento e rimozione in 6-7, sviluppo ordine e posa quasi sempre
 * intere). Una voce non in elenco va in coda.
 */
export const ORDINE_SERVIZI_DA_TENERE: ReadonlyArray<string> = [
  "sviluppo_ordine", "progettazione", "rilievo_foro", "rilievo_pezzo", "protezione", "posa", "tiro_piano", "trasporto",
  "pulizia", "rimozione_tapparelle", "rimozione_serramenti", "smaltimento", "assistenza_muraria",
  "piattaforma", "permessi_suolo", "dime", "assistenze_murarie_eventuali",
];

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
 * La bozza nasce come la fa la commercialista (fase 2 dello studio, 06/09/2026:
 * 21 fatture 2025-2026 su 22 con foglio limiti, identità al centesimo):
 *
 * 1. Il prezzo di contratto dei beni significativi resta intero, ma si
 *    divide in due righe: la riga bene al 22 % (`QUOTA_BENI_SIGNIFICATIVI`
 *    del contratto, ai 10 €) e il markup / servizi di vendita al 10 %, che
 *    è il resto. Il markup del CRM è già il residuo del risolutore: basta
 *    abbassare le righe bene e la quota vi finisce da sola.
 * 2. I servizi prendono il residuo: pattuito − beni a contratto − beni
 *    autonomi − spese. Se copre i limiti, restano ai limiti e il markup
 *    cresce (pattuito capiente). Se no, si tengono ai limiti le voci in
 *    `ORDINE_SERVIZI_DA_TENERE`, una alla volta: quella che non ci sta per
 *    intero prende quel che resta (all'euro), le successive spariscono.
 * 3. Solo se il pattuito non copre nemmeno i beni a contratto scendono i
 *    beni (è uno sconto sul contratto) finché il markup non è negativo.
 *
 * Con `quotaBeni: 1` (fattura senza detrazione) la riga bene resta a
 * contratto e non nasce nessun markup dai beni. Ogni intervento è scritto
 * nelle avvertenze; l'operatore può sempre rimettere mano a servizi e beni.
 */
export function bilancia(input: { righe: RigaFatturaInput[]; pattuitoCent: number; pattuitoTipo: "lordo" | "imponibile"; quotaBeni?: number }): { righe: RigaFatturaInput[]; avvertenze: string[] } {
  const avvertenze: string[] = [];
  let righe = input.righe.map(r => ({ ...r }));
  const markupDi = () => esitoDi(righe, input.pattuitoCent, input.pattuitoTipo).markupCent;
  const quota = Math.min(1, Math.max(0, input.quotaBeni ?? QUOTA_BENI_SIGNIFICATIVI));

  // 1. La quota dei beni che diventa markup (le spese di documentazione hanno una voce: restano a contratto).
  const significativi = righe.filter(r => r.tipo === "bene" && r.beneSignificativo && !r.derivata && r.voceComputoCodice == null);
  const contrattoBeni = significativi.reduce((s, r) => s + r.importoCent, 0);
  let quotaMarkup = 0;
  if (quota < 1 && contrattoBeni > 0) {
    const target = Math.round((contrattoBeni * quota) / 1000) * 1000;
    const nuovi = riequilibraBeni(significativi.map(r => r.importoCent), target);
    significativi.forEach((r, i) => { r.importoCent = nuovi[i]; r.prezzoUnitCent = nuovi[i]; });
    quotaMarkup = contrattoBeni - target;
    avvertenze.push(`Beni significativi in fattura a € ${euro(target)} (${Math.round(quota * 100)} % del contratto, € ${euro(contrattoBeni)}): la differenza di € ${euro(quotaMarkup)} è il markup / servizi di vendita al 10 %, come nelle fatture reali. Se il costo dei beni è più alto, alza le righe bene.`);
  }

  // 2. I servizi prendono il residuo. `deficit` è quanto manca al markup per
  // valere almeno la quota dei beni; con il pattuito lordo ogni taglio ai
  // servizi cambia l'IVA mista, quindi si ricontrolla in pochi giri.
  const servizi = righe.filter(r => r.tipo === "servizio" && !r.derivata);
  const limiti = new Map(servizi.map(r => [r, r.importoCent] as const));
  const limitiCent = servizi.reduce((s, r) => s + r.importoCent, 0);
  const posizione = (r: RigaFatturaInput) => {
    const i = ORDINE_SERVIZI_DA_TENERE.indexOf(r.voceComputoCodice ?? "");
    return i === -1 ? ORDINE_SERVIZI_DA_TENERE.length : i;
  };
  const ordinati = [...servizi].sort((a, b) => posizione(a) - posizione(b));
  let deficit = quotaMarkup - markupDi();
  if (deficit > 0 && servizi.length > 0) {
    let targetServizi = limitiCent;
    for (let giro = 0; giro < 8 && deficit > 0; giro++) {
      targetServizi = Math.max(0, Math.floor((targetServizi - deficit) / 100) * 100);
      let resto = targetServizi;
      for (const r of ordinati) {
        r.importoCent = Math.min(limiti.get(r)!, Math.floor(resto / 100) * 100);
        r.prezzoUnitCent = r.importoCent;
        resto -= r.importoCent;
      }
      deficit = quotaMarkup - markupDi();
    }
    const spariti = ordinati.filter(r => r.importoCent === 0);
    const ridotti = ordinati.filter(r => r.importoCent > 0 && r.importoCent < limiti.get(r)!);
    righe = righe.filter(r => !spariti.includes(r));
    const proposti = servizi.reduce((s, r) => s + r.importoCent, 0);
    const dettagli = [
      ...ridotti.map(r => `«${r.descrizione}» a € ${euro(r.importoCent)} invece di € ${euro(limiti.get(r)!)}`),
      ...(spariti.length > 0 ? [`non proposti: ${spariti.map(r => `«${r.descrizione}»`).join(", ")}`] : []),
    ];
    avvertenze.push(`Servizi a € ${euro(proposti)} sui € ${euro(limitiCent)} dei limiti, per rientrare nel pattuito con i beni a contratto (${dettagli.join("; ")}). Servizi ordinari e posa restano interi finché il residuo basta.`);
  }

  // 3. Il pattuito non copre nemmeno i beni: scendono i beni significativi (sconto sul contratto).
  for (let giro = 0; giro < 8 && significativi.length > 0; giro++) {
    const esito = esitoDi(righe, input.pattuitoCent, input.pattuitoTipo);
    if (esito.markupCent >= 0) break;
    const B = significativi.reduce((s, r) => s + r.importoCent, 0);
    if (B <= 0) break;
    // Con il pattuito lordo e B > P ogni euro tolto ai beni ne rende 1,22/0,98 alla prestazione.
    const resa = input.pattuitoTipo === "lordo" && esito.casoBeniSignificativi === "b_maggiore_p" ? 1.22 / 0.98 : 1;
    const nuovi = riequilibraBeni(significativi.map(r => r.importoCent), Math.max(0, B + Math.ceil(esito.markupCent / resa)));
    significativi.forEach((r, i) => { r.importoCent = nuovi[i]; r.prezzoUnitCent = nuovi[i]; });
    if (giro === 0) avvertenze.push(`Il pattuito non copre i beni a contratto (€ ${euro(contrattoBeni)}): beni significativi ridotti e nessun servizio proposto. Verifica il pattuito del contratto.`);
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

  // Senza detrazione non c'è IVA mista da governare: i beni restano a contratto (quota 1).
  const bilanciate = input.bilancia === false
    ? { righe, avvertenze: [] as string[] }
    : bilancia({ righe, pattuitoCent: contratto.pattuitoCent, pattuitoTipo: contratto.pattuitoTipo, quotaBeni: contratto.detrazioneTipo === "nessuna" ? 1 : QUOTA_BENI_SIGNIFICATIVI });
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
