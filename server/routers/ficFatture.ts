// Fatture in Cloud → fatture emesse, dentro il CRM.
//
// Sola lettura verso FIC, come sempre. Le fatture entrano in uno store
// locale e da lì:
//   - alimentano la pagina Economia (fatturato, incassato, da incassare)
//   - sincronizzano le rate FiC sui soli movimenti di origine FiC
//   - trasformano le divergenze dei movimenti manuali in proposte approvabili
//   - alimentano pattuito e piano rate delle commesse collegate.
// Dal 26/08/2026 il pattuito NON e' piu' un dato contrattuale CRM: una
// commessa con almeno una fattura collegata lo deriva da quelle fatture.
//
// La riconciliazione è deterministica — niente LLM. Regole leggibili:
// match esatto → sync idempotente; ambiguo → resta in coda «da riconciliare»
// finché un operatore non sceglie il pagamento o collega la fattura.

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";
import {
  assertSedeScope,
  requireDirezioneOAmministrazione,
} from "../_core/permissions";
import { getClientiStore } from "./clienti";
import {
  applicaPattuitoDaFic,
  getCommesseStore,
  getCommessaById,
} from "./commesse";
import type { DocumentoFicPerPiano } from "../_core/commessaPattuito";
import {
  trovaCommessaPerFattura,
  type ClientePerMatch,
  type CommessaPerMatch,
} from "./ficMatch";
import { DEFAULT_SEDE_ID } from "./sedi";
import { proposte } from "../tars/stores";

// ── Store ───────────────────────────────────────────────────────────────────

export type RataFic = {
  id: number | null;
  sourceKey: string;
  importo: number;
  scadenza: string | null; // "YYYY-MM-DD"
  stato: "paid" | "not_paid" | "reversed" | string;
  dataPagamento: string | null;
};

export type ClienteMatchFic = "fiscale" | "nome_univoco" | "nessuno";
export type CommessaMatchFic =
  | "manuale"
  // Storico: aggancio per identità fiscale + unica commessa attiva. Resta
  // nel tipo perché è persistito su record già scritti.
  | "automatico_fiscale"
  // Aggancio deterministico su telefono, email, nome, indirizzo o identità
  // fiscale — la regola corrente (`ficMatch.ts`).
  | "automatico_segnali"
  | "nessuno";

export type PdfSyncFic = {
  stato: "non_collegata" | "in_attesa" | "archiviata" | "errore";
  ultimoTentativoAt: Date | null;
  ultimoErrore: string | null;
};

export type FatturaFic = {
  id: number; // id FIC — chiave dell'upsert
  // La sede il cui token FIC ha letto questa fattura. Due sedi possono
  // fatturare da due aziende diverse: senza questo campo le fatture di una
  // comparirebbero nell'Economia dell'altra.
  sedeId: number;
  tipo: "invoice" | "credit_note";
  numero: string; // "12/A"
  data: string; // "YYYY-MM-DD"
  clienteNome: string;
  clienteVat: string | null;
  clienteCf: string | null;
  // Contatti dell'intestatario, così come FiC li conosce. Servono al match
  // automatico con la commessa: telefono, email e indirizzo agganciano i
  // privati, che spesso non hanno né partita IVA né codice fiscale a
  // registro nel CRM.
  clienteEmail: string | null;
  clienteTelefono: string | null;
  clienteIndirizzo: string | null;
  clienteCitta: string | null;
  clienteCap: string | null;
  // Oggetto/descrizione del documento: può citare il codice commessa.
  descrizione: string | null;
  importoNetto: number;
  importoIva: number;
  importoLordo: number;
  rate: RataFic[];
  // Aggancio nel CRM. clienteId dal match sul nome; commessaId quando il
  // match è certo o l'operatore l'ha collegata a mano.
  clienteId: number | null;
  clienteMatch: ClienteMatchFic;
  commessaId: number | null;
  commessaMatch: CommessaMatchFic;
  collegataAMano: boolean;
  ignorata: boolean;
  // Già esaminata da Tars per il collegamento: una fattura ambigua si paga
  // una volta sola, come le mail.
  tarsAnalizzata: boolean;
  presenteInFic: boolean;
  ultimoSyncId: string | null;
  ultimoVistoAt: Date | null;
  aggiornataAt: Date;
  pdfSync: PdfSyncFic;
};

function legacyRateSourceKey(
  documentoId: number,
  rata: Partial<RataFic>,
  index: number
): string {
  const amount = Number(rata.importo ?? 0).toFixed(2);
  return `legacy:${documentoId}:${rata.scadenza ?? "-"}:${amount}:${index}`;
}

function normalizzaRatePersistite(
  documentoId: number,
  rate: readonly Partial<RataFic>[] | null | undefined
): RataFic[] {
  return (Array.isArray(rate) ? rate : []).map((rata, index) => ({
    id: rata.id == null ? null : Number(rata.id),
    sourceKey:
      rata.sourceKey ||
      (rata.id != null
        ? `rate:${Number(rata.id)}`
        : legacyRateSourceKey(documentoId, rata, index)),
    importo: Number(rata.importo ?? 0),
    scadenza: rata.scadenza ?? null,
    stato: String(rata.stato ?? "not_paid"),
    dataPagamento: rata.dataPagamento ?? null,
  }));
}

const _fattureStore = persistedStore<FatturaFic>("fic_fatture", items => {
  for (const f of items) {
    if (f.tarsAnalizzata === undefined) f.tarsAnalizzata = false;
    // Tutto lo storico è stato letto col token dell'unica sede esistente.
    if (f.sedeId === undefined) f.sedeId = DEFAULT_SEDE_ID;
    if (f.tipo === undefined) f.tipo = "invoice";
    if (f.importoIva === undefined) {
      f.importoIva = Math.max(0, f.importoLordo - f.importoNetto);
    }
    if (f.presenteInFic === undefined) f.presenteInFic = true;
    if (f.ultimoSyncId === undefined) f.ultimoSyncId = null;
    if (f.ultimoVistoAt === undefined) f.ultimoVistoAt = null;
    // Contatti e oggetto: assenti su tutto lo storico. Restano null finché il
    // sync successivo non li rilegge da FiC — il match ne fa a meno.
    if (f.clienteEmail === undefined) f.clienteEmail = null;
    if (f.clienteTelefono === undefined) f.clienteTelefono = null;
    if (f.clienteIndirizzo === undefined) f.clienteIndirizzo = null;
    if (f.clienteCitta === undefined) f.clienteCitta = null;
    if (f.clienteCap === undefined) f.clienteCap = null;
    if (f.descrizione === undefined) f.descrizione = null;
    f.rate = normalizzaRatePersistite(f.id, f.rate);
    if (f.clienteMatch === undefined) {
      f.clienteMatch = f.clienteId == null ? "nessuno" : "nome_univoco";
    }
    if (f.commessaMatch === undefined) {
      f.commessaMatch =
        f.commessaId != null && f.collegataAMano ? "manuale" : "nessuno";
    }
    if (f.pdfSync === undefined) {
      f.pdfSync = {
        stato: f.commessaId == null ? "non_collegata" : "in_attesa",
        ultimoTentativoAt: null,
        ultimoErrore: null,
      };
    } else {
      if (f.pdfSync.ultimoTentativoAt != null) {
        f.pdfSync.ultimoTentativoAt = new Date(f.pdfSync.ultimoTentativoAt);
      }
      if (f.pdfSync.ultimoErrore === undefined) f.pdfSync.ultimoErrore = null;
    }
  }
});
export const ficFatture = _fattureStore.items;
export const saveFicFatture = () => _fattureStore.save();

let scaricaFatturaPdfForTests:
  | ((sedeId: number, ficId: number) => Promise<Buffer>)
  | null = null;
export function _setScaricaFatturaPdfForTests(
  fn: ((sedeId: number, ficId: number) => Promise<Buffer>) | null
): void {
  scaricaFatturaPdfForTests = fn;
}

// ── Normalizzazione nomi (stessa della migrazione clienti) ──────────────────

function stripAcc(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}
export function normKey(s: string): string {
  return stripAcc(s)
    .toLowerCase()
    .replace(/[^a-z0-9' ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

function normFiscal(value: unknown, removeItalianPrefix = false): string {
  const normalized = String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return removeItalianPrefix && normalized.startsWith("IT")
    ? normalized.slice(2)
    : normalized;
}

// ── Ingestione (chiamata dal sync FIC) ──────────────────────────────────────

/**
 * Upsert delle fatture lette dall'API. Idempotente per id FIC: rilanciare
 * il sync aggiorna stati di pagamento e importi, non duplica. Il match del
 * cliente si rifà a ogni giro (l'anagrafica nel frattempo può essere
 * cresciuta); il commessaId collegato A MANO non si tocca mai.
 */
export type DocumentoEmessoFicInput = Pick<
  FatturaFic,
  | "id"
  | "tipo"
  | "numero"
  | "data"
  | "clienteNome"
  | "clienteVat"
  | "clienteCf"
  | "importoNetto"
  | "importoIva"
  | "importoLordo"
  | "rate"
> &
  Partial<
    Pick<
      FatturaFic,
      | "clienteEmail"
      | "clienteTelefono"
      | "clienteIndirizzo"
      | "clienteCitta"
      | "clienteCap"
      | "descrizione"
    >
  >;

export function upsertDocumentiEmessi(
  rows: DocumentoEmessoFicInput[],
  sedeId: number,
  syncId: string | null = null
): { nuove: number; aggiornate: number; idsVariati: number[] } {
  // Il match del cliente resta dentro la sede: un omonimo altrove non deve
  // agganciare la fattura al cliente sbagliato.
  const clienti = getClientiStore().filter(
    (c: any) => (c.sedeId ?? DEFAULT_SEDE_ID) === sedeId
  );
  const perNome = new Map<string, number[]>();
  const perVat = new Map<string, number[]>();
  const perCf = new Map<string, number[]>();
  for (const c of clienti) {
    const k = normKey(`${c.cognome ?? ""} ${c.nome ?? ""}`);
    if (k) perNome.set(k, [...(perNome.get(k) ?? []), c.id]);
    const vat = normFiscal(c.partitaIva, true);
    if (vat) perVat.set(vat, [...(perVat.get(vat) ?? []), c.id]);
    const cf = normFiscal(c.codiceFiscale);
    if (cf) perCf.set(cf, [...(perCf.get(cf) ?? []), c.id]);
  }

  let nuove = 0;
  let aggiornate = 0;
  const idsVariati: number[] = [];
  for (const r of rows) {
    const vatMatch = r.clienteVat
      ? perVat.get(normFiscal(r.clienteVat, true))
      : undefined;
    const cfMatch = r.clienteCf
      ? perCf.get(normFiscal(r.clienteCf))
      : undefined;
    const fiscalIds = Array.from(
      new Set([...(vatMatch ?? []), ...(cfMatch ?? [])])
    );
    const k = normKey(r.clienteNome);
    const nameMatch = perNome.get(k);
    const clienteId =
      fiscalIds.length === 1
        ? fiscalIds[0]
        : fiscalIds.length === 0 && nameMatch?.length === 1
          ? nameMatch[0]
          : null;
    const clienteMatch: ClienteMatchFic =
      fiscalIds.length === 1
        ? "fiscale"
        : fiscalIds.length === 0 && nameMatch?.length === 1
          ? "nome_univoco"
          : "nessuno";
    const rate = normalizzaRatePersistite(r.id, r.rate);

    const esistente = ficFatture.find(
      f => f.id === r.id && f.sedeId === sedeId
    );
    if (esistente) {
      const firmaPrima = JSON.stringify({
        tipo: esistente.tipo,
        data: esistente.data,
        netto: esistente.importoNetto,
        iva: esistente.importoIva,
        lordo: esistente.importoLordo,
        rate: esistente.rate,
      });
      esistente.tipo = r.tipo;
      esistente.numero = r.numero;
      esistente.data = r.data;
      esistente.clienteNome = r.clienteNome;
      esistente.clienteVat = r.clienteVat;
      esistente.clienteCf = r.clienteCf;
      // I contatti si aggiornano solo quando il sync li porta: una risposta
      // FiC priva del campo non deve cancellare quello che già sapevamo.
      if (r.clienteEmail !== undefined) esistente.clienteEmail = r.clienteEmail;
      if (r.clienteTelefono !== undefined) {
        esistente.clienteTelefono = r.clienteTelefono;
      }
      if (r.clienteIndirizzo !== undefined) {
        esistente.clienteIndirizzo = r.clienteIndirizzo;
      }
      if (r.clienteCitta !== undefined) esistente.clienteCitta = r.clienteCitta;
      if (r.clienteCap !== undefined) esistente.clienteCap = r.clienteCap;
      if (r.descrizione !== undefined) esistente.descrizione = r.descrizione;
      esistente.importoNetto = r.importoNetto;
      esistente.importoIva = r.importoIva;
      esistente.importoLordo = r.importoLordo;
      esistente.rate = rate;
      if (!esistente.collegataAMano) {
        esistente.clienteId = clienteId;
        esistente.clienteMatch = clienteMatch;
      }
      esistente.presenteInFic = true;
      esistente.ultimoSyncId = syncId;
      esistente.ultimoVistoAt = new Date();
      esistente.aggiornataAt = new Date();
      const firmaDopo = JSON.stringify({
        tipo: esistente.tipo,
        data: esistente.data,
        netto: esistente.importoNetto,
        iva: esistente.importoIva,
        lordo: esistente.importoLordo,
        rate: esistente.rate,
      });
      if (firmaPrima !== firmaDopo) idsVariati.push(r.id);
      aggiornate++;
    } else {
      ficFatture.push({
        ...r,
        clienteEmail: r.clienteEmail ?? null,
        clienteTelefono: r.clienteTelefono ?? null,
        clienteIndirizzo: r.clienteIndirizzo ?? null,
        clienteCitta: r.clienteCitta ?? null,
        clienteCap: r.clienteCap ?? null,
        descrizione: r.descrizione ?? null,
        rate,
        sedeId,
        clienteId,
        clienteMatch,
        commessaId: null,
        commessaMatch: "nessuno",
        collegataAMano: false,
        ignorata: false,
        tarsAnalizzata: false,
        presenteInFic: true,
        ultimoSyncId: syncId,
        ultimoVistoAt: new Date(),
        aggiornataAt: new Date(),
        pdfSync: {
          stato: "non_collegata",
          ultimoTentativoAt: null,
          ultimoErrore: null,
        },
      });
      idsVariati.push(r.id);
      nuove++;
    }
  }
  if (rows.length > 0) saveFicFatture();
  return { nuove, aggiornate, idsVariati };
}

export function upsertFatture(
  rows: Array<
    Omit<DocumentoEmessoFicInput, "tipo" | "importoIva"> & {
      importoIva?: number;
    }
  >,
  sedeId: number
): { nuove: number; aggiornate: number } {
  const { nuove, aggiornate } = upsertDocumentiEmessi(
    rows.map(row => ({
      ...row,
      tipo: "invoice" as const,
      importoIva:
        row.importoIva ?? Math.max(0, row.importoLordo - row.importoNetto),
    })),
    sedeId
  );
  return { nuove, aggiornate };
}

export function finalizzaSnapshotDocumentiEmessi(args: {
  sedeId: number;
  tipo: FatturaFic["tipo"];
  periodoDa: string;
  periodoA: string;
  syncId: string;
  completo: boolean;
}): number {
  if (!args.completo) return 0;
  let rimossi = 0;
  for (const documento of ficFatture) {
    if (
      documento.sedeId !== args.sedeId ||
      documento.tipo !== args.tipo ||
      documento.data < args.periodoDa ||
      documento.data > args.periodoA ||
      documento.ultimoSyncId === args.syncId ||
      !documento.presenteInFic
    ) {
      continue;
    }
    documento.presenteInFic = false;
    documento.aggiornataAt = new Date();
    rimossi++;
  }
  if (rimossi > 0) saveFicFatture();
  return rimossi;
}

// ── Riconciliazione ─────────────────────────────────────────────────────────

/**
 * La commessa giusta per una fattura, solo quando è indiscutibile:
 *   1. collegata a mano → quella
 *   2. cliente con UNA sola commessa attiva → quella
 *   3. cliente con più commesse: una sola col pattuito ≈ lordo (±1€) → quella
 * Tutto il resto → null, e la fattura resta «da riconciliare».
 */
export function commessaPerFattura(
  f: FatturaFic,
  commesse: any[]
): { commessa: any | null; motivo: string } {
  if (f.commessaId != null) {
    const c = commesse.find(
      x => x.id === f.commessaId && (x.sedeId ?? DEFAULT_SEDE_ID) === f.sedeId
    );
    return {
      commessa: c ?? null,
      motivo:
        f.commessaMatch === "automatico_fiscale"
          ? "Collegata automaticamente tramite identita fiscale."
          : "Collegata dall'operatore.",
    };
  }
  return {
    commessa: null,
    motivo:
      f.clienteId == null
        ? "Cliente non riconosciuto in anagrafica."
        : "La fattura non e ancora collegata a una commessa.",
  };
}

/**
 * Aggancia automaticamente le fatture non collegate.
 *
 * Regola voluta dalla direzione: basta UN segnale in comune — telefono,
 * email, nome e cognome, indirizzo o identità fiscale — perché la fattura
 * vada allegata alla commessa. Il solo caso non deciso è la parità fra due
 * commesse: lì la fattura resta in coda con i candidati esposti.
 *
 * Le note di credito passano dallo stesso match: abbattono il pattuito della
 * commessa che hanno rettificato, e senza aggancio resterebbero fuori.
 */
export function collegaFattureAutomatiche(sedeId: number): {
  collegate: number;
  ambigue: number;
} {
  const commesse = getCommesseStore().filter(
    (commessa: any) =>
      (commessa.sedeId ?? DEFAULT_SEDE_ID) === sedeId &&
      !commessa.archivedAt &&
      commessa.stato !== "archiviata"
  );
  const clienti = getClientiStore().filter(
    (cliente: any) => (cliente.sedeId ?? DEFAULT_SEDE_ID) === sedeId
  );
  const candidatiCommessa: CommessaPerMatch[] = commesse.map(
    (commessa: any) => ({
      id: commessa.id,
      codice: String(commessa.codice ?? ""),
      clienteId: commessa.clienteId ?? null,
      cliente: commessa.cliente ?? null,
      email: commessa.email ?? null,
      telefono: commessa.telefono ?? null,
      indirizzo: commessa.indirizzo ?? null,
      citta: commessa.citta ?? null,
    })
  );
  const anagrafiche: ClientePerMatch[] = clienti.map((cliente: any) => ({
    id: cliente.id,
    nome: cliente.nome ?? null,
    cognome: cliente.cognome ?? null,
    email: cliente.email ?? null,
    telefono: cliente.telefono ?? null,
    indirizzo: cliente.indirizzo ?? null,
    citta: cliente.citta ?? null,
    partitaIva: cliente.partitaIva ?? null,
    codiceFiscale: cliente.codiceFiscale ?? null,
  }));

  let collegate = 0;
  let ambigue = 0;
  for (const fattura of ficFatture) {
    if (
      fattura.sedeId !== sedeId ||
      !fattura.presenteInFic ||
      fattura.ignorata ||
      fattura.commessaId != null
    ) {
      continue;
    }
    const esito = trovaCommessaPerFattura({
      fattura: {
        id: fattura.id,
        numero: fattura.numero,
        clienteNome: fattura.clienteNome,
        clienteVat: fattura.clienteVat,
        clienteCf: fattura.clienteCf,
        clienteEmail: fattura.clienteEmail,
        clienteTelefono: fattura.clienteTelefono,
        clienteIndirizzo: fattura.clienteIndirizzo,
        clienteCitta: fattura.clienteCitta,
        descrizione: fattura.descrizione,
        clienteId: fattura.clienteId,
      },
      commesse: candidatiCommessa,
      clienti: anagrafiche,
    });
    if (esito.commessaId != null) {
      fattura.commessaId = esito.commessaId;
      fattura.commessaMatch = "automatico_segnali";
      fattura.collegataAMano = false;
      fattura.pdfSync.stato = "in_attesa";
      fattura.aggiornataAt = new Date();
      collegate++;
    } else if (esito.ambiguo) {
      ambigue++;
    }
  }
  if (collegate > 0) saveFicFatture();
  return { collegate, ambigue };
}

/**
 * Riporta pattuito e piano rate di ogni commessa della sede in linea con le
 * fatture FiC collegate. Dal 26/08/2026 la fonte del pattuito è FiC: qui è
 * dove quella regola diventa un dato.
 *
 * Gira su TUTTE le commesse della sede, non solo su quelle con fatture: una
 * commessa appena scollegata deve tornare manuale, e per accorgersene serve
 * guardarla anche quando il gruppo è vuoto. Idempotente — `applicaPattuitoDaFic`
 * scrive solo quando qualcosa cambia davvero.
 */
export function sincronizzaPattuitoDaFic(sedeId: number): {
  aggiornate: number;
} {
  const perCommessa = new Map<number, DocumentoFicPerPiano[]>();
  for (const documento of ficFatture) {
    if (
      documento.sedeId !== sedeId ||
      documento.commessaId == null ||
      !documento.presenteInFic ||
      documento.ignorata
    ) {
      continue;
    }
    const gruppo = perCommessa.get(documento.commessaId) ?? [];
    gruppo.push({
      id: documento.id,
      tipo: documento.tipo,
      numero: documento.numero,
      data: documento.data,
      importoLordo: documento.importoLordo,
      rate: documento.rate,
    });
    perCommessa.set(documento.commessaId, gruppo);
  }

  let aggiornate = 0;
  for (const commessa of getCommesseStore()) {
    if ((commessa.sedeId ?? DEFAULT_SEDE_ID) !== sedeId) continue;
    const documenti = perCommessa.get(commessa.id) ?? [];
    // Niente fatture e già manuale: nessun motivo di toccarla.
    if (
      documenti.length === 0 &&
      (commessa.pattuitoFicDocumentoIds ?? []).length === 0
    ) {
      continue;
    }
    if (applicaPattuitoDaFic(commessa.id, documenti).cambiato) aggiornate++;
  }
  return { aggiornate };
}

function esisteRataInCommessa(
  commessa: any,
  rata: RataFic,
  numero: string
): boolean {
  const pagamenti: any[] = Array.isArray(commessa.pagamenti)
    ? commessa.pagamenti
    : [];
  return pagamenti.some(
    p =>
      p.stato !== "stornato" &&
      // Già registrata con riferimento esplicito alla fattura…
      (p.ficSourceKey === rata.sourceKey ||
        (typeof p.note === "string" && p.note.includes(`FIC ${numero}`)) ||
      // …o stessa cifra nello stesso giorno (registrata a mano).
        (Math.abs((p.importo ?? 0) - rata.importo) < 0.01 &&
          p.data === rata.dataPagamento))
  );
}

function esisteCorrezionePendente(
  fattura: FatturaFic,
  commessaId: number
): boolean {
  return proposte.some(
    p =>
      p.tipo === "correzione_pagamento" &&
      p.commessaId === commessaId &&
      p.stato === "pendente" &&
      p.payload?.ficDocumentoId === fattura.id
  );
}

// ── Stato riconciliazione (derivato, mai scritto) ───────────────────────────

export type StatoRiconciliazione =
  | "riconciliata" // ogni rata pagata ha il suo pagamento in commessa
  | "proposta" // c'è una proposta pendente che la riguarda
  | "da_riconciliare"
  | "non_abbinabile" // cliente/commessa non individuabili
  | "ignorata";

export function statoFattura(
  f: FatturaFic,
  commesse: any[]
): { stato: StatoRiconciliazione; commessa: any | null; motivo: string } {
  if (f.ignorata) return { stato: "ignorata", commessa: null, motivo: "" };
  const { commessa, motivo } = commessaPerFattura(f, commesse);
  if (!commessa) return { stato: "non_abbinabile", commessa: null, motivo };

  // L'incasso comanda: con tutte le rate pagate già a registro la fattura
  // è riconciliata, anche se resta pendente una proposta accessoria (es.
  // il pattuito). "Riconciliata" parla di soldi, non di proposte.
  const ratePagate = f.rate.filter(r => r.stato === "paid" && r.importo > 0);
  const tutte =
    ratePagate.length > 0 &&
    ratePagate.every(r => esisteRataInCommessa(commessa, r, f.numero));
  if (tutte) return { stato: "riconciliata", commessa, motivo };

  if (esisteCorrezionePendente(f, commessa.id)) {
    return { stato: "proposta", commessa, motivo };
  }

  return { stato: "da_riconciliare", commessa, motivo };
}

/**
 * I candidati per una fattura non collegata, gia' ordinati per forza.
 *
 * Il matcher li calcola comunque per decidere; buttarli via costringeva
 * l'operatore a ricercare a mano una commessa che il server aveva gia'
 * individuato. Esposti, diventano un click.
 */
export function candidatiPerFattura(
  fattura: FatturaFic,
  commesse: readonly any[],
  clienti: readonly any[],
  massimo = 3
): Array<{
  commessaId: number;
  codice: string;
  cliente: string | null;
  motivo: string;
}> {
  if (fattura.commessaId != null) return [];
  const esito = trovaCommessaPerFattura({
    fattura: {
      id: fattura.id,
      numero: fattura.numero,
      clienteNome: fattura.clienteNome,
      clienteVat: fattura.clienteVat,
      clienteCf: fattura.clienteCf,
      clienteEmail: fattura.clienteEmail,
      clienteTelefono: fattura.clienteTelefono,
      clienteIndirizzo: fattura.clienteIndirizzo,
      clienteCitta: fattura.clienteCitta,
      descrizione: fattura.descrizione,
      clienteId: fattura.clienteId,
    },
    commesse: commesse.map(commessa => ({
      id: commessa.id,
      codice: String(commessa.codice ?? ""),
      clienteId: commessa.clienteId ?? null,
      cliente: commessa.cliente ?? null,
      email: commessa.email ?? null,
      telefono: commessa.telefono ?? null,
      indirizzo: commessa.indirizzo ?? null,
      citta: commessa.citta ?? null,
    })),
    clienti: clienti.map(cliente => ({
      id: cliente.id,
      nome: cliente.nome ?? null,
      cognome: cliente.cognome ?? null,
      email: cliente.email ?? null,
      telefono: cliente.telefono ?? null,
      indirizzo: cliente.indirizzo ?? null,
      citta: cliente.citta ?? null,
      partitaIva: cliente.partitaIva ?? null,
      codiceFiscale: cliente.codiceFiscale ?? null,
    })),
  });
  const perId = new Map(commesse.map(c => [c.id, c]));
  return esito.candidati.slice(0, massimo).map(candidato => ({
    commessaId: candidato.commessaId,
    codice: candidato.codice,
    cliente: perId.get(candidato.commessaId)?.cliente ?? null,
    motivo: candidato.segnali.map(segnale => ETICHETTA_SEGNALE[segnale]).join(" · "),
  }));
}

const ETICHETTA_SEGNALE: Record<string, string> = {
  codice_commessa: "codice in fattura",
  identita_fiscale: "P.IVA / CF",
  email: "email",
  telefono: "telefono",
  cognome_nome: "nome",
  indirizzo: "indirizzo",
};

// Una fattura di QUESTA sede. Come per le commesse: fuori sede è NOT_FOUND,
// non FORBIDDEN — un id non deve poter confermare l'esistenza di un dato
// altrui.
function trovaFattura(ficId: number, sedeId: number | null): FatturaFic {
  const sede = sedeId ?? DEFAULT_SEDE_ID;
  const f = ficFatture.find(x => x.id === ficId && x.sedeId === sede);
  if (!f) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Fattura non trovata." });
  }
  return f;
}

// ── Router ──────────────────────────────────────────────────────────────────

export const ficFattureRouter = router({
  list: protectedProcedure
    .input(z.object({ anno: z.number().int().optional() }).optional())
    .query(({ input, ctx }) => {
      requireDirezioneOAmministrazione(ctx.user);
      const anno = input?.anno ?? new Date().getFullYear();
      const sede = ctx.sedeId ?? DEFAULT_SEDE_ID;
      const commesse = getCommesseStore();
      // Il set per i candidati e' piu' stretto di quello per lo stato: una
      // fattura non si propone su una commessa archiviata.
      const commesseAgganciabili = commesse.filter(
        (commessa: any) =>
          (commessa.sedeId ?? DEFAULT_SEDE_ID) === sede &&
          !commessa.archivedAt &&
          commessa.stato !== "archiviata"
      );
      const clientiSede = getClientiStore().filter(
        (cliente: any) => (cliente.sedeId ?? DEFAULT_SEDE_ID) === sede
      );
      const proposteCollegamento = new Map(
        proposte
          .filter(
            p =>
              p.sedeId === sede &&
              p.tipo === "collega_fattura" &&
              p.stato === "pendente" &&
              typeof p.payload?.ficId === "number"
          )
          .map(p => [p.payload.ficId as number, p])
      );
      return ficFatture
        .filter(
          f =>
            f.sedeId === sede &&
            f.tipo === "invoice" &&
            f.presenteInFic &&
            f.data.startsWith(String(anno))
        )
        .map(f => {
          const s = statoFattura(f, commesse);
          const propostaCollegamento = proposteCollegamento.get(f.id);
          const commessaProposta = propostaCollegamento
            ? commesse.find(c => c.id === propostaCollegamento.commessaId)
            : null;
          const incassato = f.rate
            .filter(r => r.stato === "paid")
            .reduce((sum, r) => sum + r.importo, 0);
          return {
            id: f.id,
            numero: f.numero,
            data: f.data,
            clienteNome: f.clienteNome,
            importoLordo: f.importoLordo,
            incassato,
            stato: propostaCollegamento ? ("proposta" as const) : s.stato,
            motivo: propostaCollegamento
              ? "Tars ha individuato una possibile commessa."
              : s.motivo,
            commessaId: f.commessaId,
            commessaCodice: s.commessa?.codice ?? null,
            commessaCliente: s.commessa?.cliente ?? null,
            collegataAMano: f.collegataAMano,
            commessaMatch: f.commessaMatch,
            candidati:
              f.commessaId == null && !f.ignorata
                ? candidatiPerFattura(f, commesseAgganciabili, clientiSede)
                : [],
            pdfSync: f.pdfSync,
            propostaTars: propostaCollegamento
              ? {
                  ...propostaCollegamento,
                  commessaCodice:
                    propostaCollegamento.payload?.commessaCodice ??
                    commessaProposta?.codice ??
                    null,
                  commessaCliente: commessaProposta?.cliente ?? null,
                }
              : null,
          };
        })
        .sort((a, b) => b.data.localeCompare(a.data));
    }),

  // Collegamento manuale: l'operatore decide, la riconciliazione riparte
  // subito e produce le proposte per quella commessa.
  collega: protectedProcedure
    .input(z.object({ ficId: z.number(), commessaId: z.number().nullable() }))
    .mutation(async ({ input, ctx }) => {
      requireDirezioneOAmministrazione(ctx.user);
      const f = trovaFattura(input.ficId, ctx.sedeId);
      const sedeId = ctx.sedeId ?? DEFAULT_SEDE_ID;
      const { emptyFicPaymentSyncStats, riconciliaPagamentiFic } = await import(
        "./ficPagamenti"
      );
      let paymentStats = emptyFicPaymentSyncStats();
      let correzioniProposte = 0;
      let pdf: {
        stato: "archiviata" | "errore" | "non_collegata";
        documentoId: number | null;
        errore: string | null;
      } = {
        stato: "non_collegata",
        documentoId: null,
        errore: null,
      };
      if (input.commessaId != null) {
        const commessa = getCommessaById(input.commessaId);
        assertSedeScope(commessa ?? null, ctx.sedeId);
        f.commessaId = input.commessaId;
        f.collegataAMano = true;
        f.commessaMatch = "manuale";
        f.ignorata = false;
        f.pdfSync.stato = "in_attesa";
        f.pdfSync.ultimoErrore = null;
        f.aggiornataAt = new Date();
        saveFicFatture();
        // Il pattuito segue la fattura: collegarla la promuove a fonte FiC
        // prima ancora della riconciliazione degli incassi.
        sincronizzaPattuitoDaFic(sedeId);

        const paymentResult = riconciliaPagamentiFic({
          sedeId,
          snapshotCompleto: false,
        });
        paymentStats = paymentResult.stats;
        correzioniProposte = paymentResult.issues.length;

        const [{ ensureFicInvoiceAttachment }, { scaricaFatturaPdf }] =
          await Promise.all([
            import("./ficAllegati"),
            import("./fattureInCloud"),
          ]);
        pdf = await ensureFicInvoiceAttachment({
          sedeId,
          fattura: f,
          createdBy: ctx.user?.id ?? null,
          downloadPdf: scaricaFatturaPdfForTests ?? scaricaFatturaPdf,
        });
      } else {
        const commessaPrecedente = f.commessaId;
        f.commessaId = null;
        f.collegataAMano = false;
        f.commessaMatch = "nessuno";
        f.pdfSync.stato = "non_collegata";
        f.pdfSync.ultimoErrore = null;
        f.aggiornataAt = new Date();
        saveFicFatture();
        // Senza più fatture la commessa torna manuale: il pattuito resta al
        // valore emesso ma da qui in poi è di nuovo scrivibile a mano.
        if (commessaPrecedente != null) sincronizzaPattuitoDaFic(sedeId);
      }
      return {
        success: true as const,
        paymentStats,
        correzioniProposte,
        pdf,
        // Compatibilità temporanea per i consumer UI/Tars aggiornati ai Task 5/7.
        proposteCreate: 0,
        documentoId: pdf.documentoId,
      };
    }),

  ignora: protectedProcedure
    .input(z.object({ ficId: z.number(), ignorata: z.boolean() }))
    .mutation(({ input, ctx }) => {
      requireDirezioneOAmministrazione(ctx.user);
      const f = trovaFattura(input.ficId, ctx.sedeId);
      f.ignorata = input.ignorata;
      f.aggiornataAt = new Date();
      saveFicFatture();
      return { success: true as const };
    }),

  /**
   * Riallinea il CRM alle fatture GIA' scaricate, senza chiamare l'API.
   *
   * Il sync completo fa anche questo, ma scarica quattro flussi paginati e
   * puo' durare minuti. Qui i documenti sono gia' nello store: collegare,
   * derivare il pattuito e riconciliare gli incassi e' lavoro locale, quindi
   * immediato e ripetibile a costo zero. Serve dopo un reset del pattuito, o
   * quando cambia la regola di match e si vuole vedere l'effetto subito.
   */
  riconciliaOra: adminProcedure.mutation(async ({ ctx }) => {
    const sedeId = ctx.sedeId ?? DEFAULT_SEDE_ID;
    const [{ riconciliaPagamentiFic }, correctionHelpers] = await Promise.all([
      import("./ficPagamenti"),
      import("../tars/ficPaymentProposals"),
    ]);
    // L'ordine e' vincolante: senza collegamento non c'e' pattuito da
    // derivare, e senza pattuito la riconciliazione degli incassi lavora su
    // commesse a zero.
    const collegamenti = collegaFattureAutomatiche(sedeId);
    const pattuito = sincronizzaPattuitoDaFic(sedeId);
    const payments = riconciliaPagamentiFic({
      sedeId,
      snapshotCompleto: false,
    });
    const corrections = correctionHelpers.creaProposteCorrezionePagamento(
      payments.issues,
      sedeId
    );
    const proposteSuperate = correctionHelpers.superaProposteFicObsolete(sedeId);
    return {
      collegate: collegamenti.collegate,
      ambigue: collegamenti.ambigue,
      pattuitiAggiornati: pattuito.aggiornate,
      paymentStats: payments.stats,
      correzioniProposte: corrections.create,
      proposteSuperate,
    };
  }),
});
