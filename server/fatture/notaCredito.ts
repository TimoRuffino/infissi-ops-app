// server/fatture/notaCredito.ts
// La nota di credito, totale o parziale: nasce come bozza a specchio di
// una fattura già emessa e si emette con la stessa pipeline di
// `emissione.ts` (Task 9), con `tipo: "nota_credito"` — la sonda e
// `costruisciDocumentoFic` la seguono come una fattura qualunque.
//
// Non passa dal risolutore (`risolutore.ts`): gli importi sono già
// decisi dalla fattura di origine. Totale: le righe sono uno specchio
// esatto dell'origine, segno compreso — lo storno dei beni significativi
// resta negativo com'era, la coppia storno/riaddebito è un trasferimento
// fra aliquote (22 %→10 %) a somma zero, non un importo aggiuntivo:
// invertirne il segno romperebbe il totale. Parziale: solo le righe
// bene/servizio/markup scelte, con l'importo indicato, più la stessa
// coppia storno/riaddebito ricalcolata sulla sola parte stornata
// (Q' = min(B', P'), la regola dei beni significativi del DM 29/12/1999
// applicata al sottoinsieme scelto). In entrambi i casi il riepilogo IVA
// si ricalcola con `impostaCent`: gli importi non cambiano, cambia solo
// la somma per aliquota.
//
// Prefissi degli errori (stessa convenzione di servizio.ts):
//   NOT_FOUND:     la fattura di origine non esiste — o è di un'altra sede
//   PRECONDIZIONE: stato di origine non ammesso, o nota già in bozza
//   VALIDAZIONE:   la selezione parziale non sta in piedi
import { DICITURE } from "@shared/fatturazione/diciture";
import {
  ALIQUOTE,
  type Aliquota,
  type Fattura,
  type RigaFattura,
  type RigaFatturaInput,
  type RiepilogoIva,
} from "@shared/fatturazione/tipi";
import { getFattureRepository, type FattureRepository } from "./repository";
import { impostaCent } from "./risolutore";
import { iso, type Dipendenze } from "./servizio";

function repo(dip?: Dipendenze): FattureRepository {
  return dip?.repository ?? getFattureRepository();
}
function adesso(dip?: Dipendenze): Date {
  return dip?.now?.() ?? new Date();
}

/** Gli stati da cui si può stornare: la fattura deve essere già uscita verso il cliente. */
const STATI_STORNABILI = new Set<Fattura["stato"]>([
  "emessa",
  "inviata",
  "consegnata",
  "rifiutata",
  "mancata_consegna",
]);

/** Tipi di riga selezionabili singolarmente in una nota parziale: gli altri (intestazione, storno/riaddebito, nota) non hanno un importo proprio o sono ricalcolati. */
const TIPI_SELEZIONABILI = new Set<RigaFattura["tipo"]>(["bene", "servizio", "markup"]);

const comeRigaInput = (r: RigaFattura): RigaFatturaInput => {
  const { id: _id, fatturaId: _fatturaId, ...resto } = r;
  return resto;
};

/** Riepilogo IVA dalle righe già decise: somma per aliquota e arrotonda con `impostaCent`, senza passare dal risolutore. */
function riepilogoDaRighe(righe: Array<Pick<RigaFatturaInput, "aliquota" | "importoCent">>): RiepilogoIva[] {
  const somme = new Map<Aliquota, number>();
  for (const r of righe) {
    if (r.aliquota == null) continue;
    somme.set(r.aliquota, (somme.get(r.aliquota) ?? 0) + r.importoCent);
  }
  // `ALIQUOTE` è già [22, 10]: l'ordine del riepilogo segue da sé.
  return ALIQUOTE.filter(a => (somme.get(a) ?? 0) !== 0).map(a => {
    const imponibileCent = somme.get(a)!;
    return { aliquota: a, imponibileCent, impostaCent: impostaCent(imponibileCent, a) };
  });
}

function rinumera(righe: RigaFatturaInput[]): RigaFatturaInput[] {
  return righe.map((r, i) => ({ ...r, ordine: i + 1 }));
}

/** Riga derivata come la produce `generatore.ts`: quantità 1, prezzo unitario = importo, nessun riferimento a computo o contratto. */
function rigaDerivata(tipo: "storno_bs" | "riaddebito_bs", importoCent: number, aliquota: Aliquota): RigaFatturaInput {
  return {
    ordine: 0,
    tipo,
    descrizione: tipo === "storno_bs" ? DICITURE.storno_bs : DICITURE.riaddebito_bs,
    quantita: 1,
    prezzoUnitCent: importoCent,
    importoCent,
    aliquota,
    voceComputoCodice: null,
    rigaCommessaId: null,
    limiteCent: null,
    beneSignificativo: false,
    derivata: true,
  };
}

const MAX_MOTIVO = 300;

/**
 * R20 (nota NDC-1): la nota si apre dichiarando cosa storna — «Accredito
 * su ns. fattura n. X del Y», col motivo quando c'è. È una riga
 * `intestazione`: descrittiva, a zero, senza aliquota, come le aperture
 * che il generatore mette in fattura.
 */
function intestazioneAccredito(origine: Fattura, motivo: string | null): RigaFatturaInput {
  const testo = `Accredito su ns. fattura n. ${origine.numero ?? origine.id} del ${origine.data ?? ""}`;
  return {
    ordine: 0,
    tipo: "intestazione",
    descrizione: motivo ? `${testo}: ${motivo}` : testo,
    quantita: 1,
    prezzoUnitCent: 0,
    importoCent: 0,
    aliquota: null,
    voceComputoCodice: null,
    rigaCommessaId: null,
    limiteCent: null,
    beneSignificativo: false,
    derivata: false,
  };
}

/** Totale: specchio della fattura, riga per riga, segno compreso — lo storno resta negativo com'è nell'origine (v. commento di testata). */
function righeTotale(origine: Fattura): { righe: RigaFatturaInput[]; markupCent: number; stornoCent: number } {
  return {
    righe: origine.righe.map(comeRigaInput),
    markupCent: origine.markupCent,
    stornoCent: origine.stornoCent,
  };
}

/**
 * Parziale: solo le righe bene/servizio/markup scelte (per `ordine`), con
 * l'importo indicato (0 < importo ≤ importo originale), più la coppia
 * storno/riaddebito dei beni significativi ricalcolata sulla sola parte
 * stornata: B' = beni significativi scelti, P' = altri beni + servizi +
 * markup scelti, Q' = min(B', P') se entrambi positivi altrimenti 0 —
 * stessa regola di `riepilogoPer` in risolutore.ts, qui inline perché
 * un'unica chiamata non giustifica l'esportazione della funzione.
 */
function righeParziale(
  origine: Fattura,
  selezione: Array<{ ordine: number; importoCent: number }>
): { righe: RigaFatturaInput[]; markupCent: number; stornoCent: number } {
  if (selezione.length === 0) {
    throw new Error("VALIDAZIONE: seleziona almeno una riga da stornare.");
  }
  const perOrdine = new Map(origine.righe.map(r => [r.ordine, r]));
  const scelti = new Set<number>();
  const righeScelte: Array<RigaFatturaInput & { ordineOrigine: number }> = [];
  for (const sel of selezione) {
    if (scelti.has(sel.ordine)) throw new Error(`VALIDAZIONE: ordine di riga duplicato: ${sel.ordine}.`);
    scelti.add(sel.ordine);
    const r = perOrdine.get(sel.ordine);
    if (!r) throw new Error(`VALIDAZIONE: la riga ${sel.ordine} non esiste nella fattura di origine.`);
    if (!TIPI_SELEZIONABILI.has(r.tipo)) {
      throw new Error(`VALIDAZIONE: la riga ${sel.ordine} ("${r.descrizione}") non è stornabile singolarmente.`);
    }
    if (!Number.isInteger(sel.importoCent) || sel.importoCent <= 0 || sel.importoCent > r.importoCent) {
      throw new Error(
        `VALIDAZIONE: l'importo della riga ${sel.ordine} deve essere maggiore di zero e non superiore all'originale (€ ${(r.importoCent / 100).toFixed(2)}).`
      );
    }
    righeScelte.push({
      ordineOrigine: r.ordine,
      ordine: 0,
      tipo: r.tipo,
      descrizione: r.descrizione,
      quantita: 1,
      prezzoUnitCent: sel.importoCent,
      importoCent: sel.importoCent,
      aliquota: r.aliquota,
      voceComputoCodice: r.voceComputoCodice,
      rigaCommessaId: r.rigaCommessaId,
      limiteCent: r.limiteCent,
      beneSignificativo: r.beneSignificativo,
      derivata: r.derivata,
    });
  }
  righeScelte.sort((a, b) => a.ordineOrigine - b.ordineOrigine);

  // da tenere allineato a riepilogoPer in risolutore.ts
  const B = righeScelte.filter(r => r.tipo === "bene" && r.beneSignificativo).reduce((s, r) => s + r.importoCent, 0);
  const altriBeni = righeScelte.filter(r => r.tipo === "bene" && !r.beneSignificativo).reduce((s, r) => s + r.importoCent, 0);
  const servizi = righeScelte.filter(r => r.tipo === "servizio").reduce((s, r) => s + r.importoCent, 0);
  const markupCent = righeScelte.filter(r => r.tipo === "markup").reduce((s, r) => s + r.importoCent, 0);
  const P = altriBeni + servizi + markupCent;
  const Q = B > 0 && P > 0 ? Math.min(B, P) : 0;

  const derivate = Q > 0 ? [rigaDerivata("storno_bs", -Q, 22), rigaDerivata("riaddebito_bs", Q, 10)] : [];
  const righe = righeScelte.map(({ ordineOrigine: _ordineOrigine, ...resto }) => resto);
  return { righe: rinumera([...righe, ...derivate]), markupCent, stornoCent: Q };
}

export type SelezioneNotaCredito =
  | { tipo: "totale" }
  | { tipo: "parziale"; righe: Array<{ ordine: number; importoCent: number }> };

export async function creaNotaCredito(
  input: {
    sedeId: number;
    fatturaId: number;
    actorUserId: number | null;
    selezione: SelezioneNotaCredito;
    /** Perché si accredita: finisce nell'intestazione della nota (R20). */
    motivo?: string;
  } & Dipendenze
): Promise<{ fattura: Fattura; avvertenze: string[] }> {
  const repository = repo(input);
  const now = adesso(input);
  const motivo = input.motivo?.trim() || null;
  if (motivo && motivo.length > MAX_MOTIVO) {
    throw new Error(`VALIDAZIONE: il motivo della nota di credito non può superare i ${MAX_MOTIVO} caratteri.`);
  }

  // `perId` filtra già per sede: una fattura di un'altra sede non esiste,
  // mai un indizio che esista (stesso pattern di `bozzaModificabile` in
  // servizio.ts).
  const origine = await repository.perId(input.sedeId, input.fatturaId);
  if (!origine) throw new Error("NOT_FOUND: Fattura non trovata.");
  // Ruling R16: una nota storna una fattura, non un'altra nota — a
  // catena non avrebbe un'origine unica da specchiare.
  if (origine.tipo === "nota_credito") {
    throw new Error("PRECONDIZIONE: una nota di credito non si storna con un'altra nota.");
  }
  if (!STATI_STORNABILI.has(origine.stato)) {
    throw new Error(
      `PRECONDIZIONE: la fattura #${origine.id} è in stato «${origine.stato}»: si storna solo una fattura già emessa.`
    );
  }

  // Una sola nota di credito in bozza per origine: una seconda si potrà
  // creare solo dopo che la prima è uscita dalla bozza (emessa o
  // annullata) — non prima.
  const precedenti = await repository.perCommessa(input.sedeId, origine.commessaId);
  const bozzaEsistente = precedenti.find(f => f.notaCreditoDi === origine.id && f.stato === "bozza");
  if (bozzaEsistente) {
    throw new Error(
      `PRECONDIZIONE: esiste già una nota di credito in bozza per questa fattura (#${bozzaEsistente.id}).`
    );
  }

  const { righe: righeStornate, markupCent, stornoCent } =
    input.selezione.tipo === "totale" ? righeTotale(origine) : righeParziale(origine, input.selezione.righe);
  const righe = rinumera([intestazioneAccredito(origine, motivo), ...righeStornate]);

  const riepilogo = riepilogoDaRighe(righe);
  const imponibileCent = riepilogo.reduce((s, r) => s + r.imponibileCent, 0);
  const ivaCent = riepilogo.reduce((s, r) => s + r.impostaCent, 0);
  const totaleCent = imponibileCent + ivaCent;

  const nota = await repository.crea({
    fattura: {
      sedeId: input.sedeId,
      commessaId: origine.commessaId,
      computoId: origine.computoId,
      hashRighe: origine.hashRighe,
      tipo: "nota_credito",
      notaCreditoDi: origine.id,
      stato: "bozza",
      ficDocumentId: null,
      // Numero e data li assegna Fatture in Cloud all'emissione, come per
      // ogni bozza: una nota in bozza non consuma numerazione.
      numero: null,
      data: null,
      clienteSnapshot: origine.clienteSnapshot,
      pattuitoTipo: origine.pattuitoTipo,
      pattuitoCent: totaleCent,
      imponibileCent,
      ivaCent,
      totaleCent,
      deltaPattuitoCent: 0,
      markupCent,
      stornoCent,
      diciture: ["copia_ade"],
      note: `Nota di credito a storno della fattura n. ${origine.numero ?? origine.id} del ${origine.data ?? ""}`,
      // Solo informativo (Ruling R15): il vincolo di forma della
      // detrazione non si applica alla nota, ma il cantiere resta lo
      // stesso dell'origine ed è utile vederlo anche qui.
      intestazioneCantiere: origine.intestazioneCantiere,
      detrazioneTipo: origine.detrazioneTipo,
      pdfStorageKey: null,
      xmlStorageKey: null,
      xmlSha256: null,
      documentoId: null,
      eiStatusFic: null,
      eiErrore: null,
      inviataDryRun: false,
      scavalcoLimiti: false,
      scavalcoMotivo: null,
      createdBy: input.actorUserId,
      emessaDa: null,
      emessaAt: null,
    },
    righe,
    riepilogo,
    scadenze: [{ numero: 1, quotaPct: 100, data: iso(now), importoCent: totaleCent, descrizione: "storno" }],
    now,
  });

  await repository.appendEvento({
    fatturaId: origine.id,
    sedeId: input.sedeId,
    tipo: "nota_credito",
    payload: { notaCreditoId: nota.id, tipo: input.selezione.tipo, totaleCent: nota.totaleCent },
    actorUserId: input.actorUserId,
  });
  await repository.appendEvento({
    fatturaId: nota.id,
    sedeId: input.sedeId,
    tipo: "creata",
    payload: { notaCreditoDi: origine.id, selezione: input.selezione },
    actorUserId: input.actorUserId,
  });

  return { fattura: nota, avvertenze: [] };
}
