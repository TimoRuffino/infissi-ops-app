// server/fatture/servizio.ts
// Il servizio di dominio della bozza: nasce dal contratto e dal computo,
// si legge, si corregge, si verifica e si annulla. È l'unico percorso di
// scrittura della fattura — router tRPC (Task 13) e Tars passano di qui —
// e l'unico posto dove vivono le regole che il repository non conosce:
// isolamento di sede, immutabilità dopo la bozza, limiti del computo,
// validazioni per l'emissione.
//
// I numeri non si scrivono mai a mano: le righe derivate e i totali
// escono da `ricalcola` (Task 4), che chiama il risolutore (Task 3).
// Qui si decide *cosa* ricalcolare, non *come*.
//
// Prefissi degli errori (il router li mappa su codici tRPC, Task 13):
//   NOT_FOUND:          la risorsa non esiste — o è di un'altra sede
//   PRECONDIZIONE:      manca qualcosa a monte (contratto, stato, altra fattura)
//   VALIDAZIONE:        l'input non sta in piedi
//   FATTURA_IMMUTABILE: dalla bozza in poi si corregge con una nota di credito
//   CONFLITTO:          revisione superata (propagato dal repository)
import { TZDate } from "@date-fns/tz";
import { DICITURE, type ChiaveDicitura } from "@shared/fatturazione/diciture";
import {
  fatturaModificabile,
  type ClienteSnapshot,
  type EventoFattura,
  type Fattura,
  type RigaFattura,
  type RigaFatturaInput,
  type ScadenzaFattura,
  type ScadenzaFatturaInput,
} from "@shared/fatturazione/tipi";
import type { Computo, Contratto } from "@shared/limiti/tipi";
import { ultimoComputo } from "../computo/servizio";
import { leggiContratto } from "../contratti/servizio";
import { getClienteById } from "../routers/clienti";
import { getCommessaById } from "../routers/commesse";
import { DEFAULT_SEDE_ID } from "../routers/sedi";
import { controlliCliente, snapshotCliente } from "./cliente";
import { generaBozza, ricalcola, scadenzeDaRate, servizioProposto, type Bozza } from "./generatore";
import { getFattureRepository, type FattureRepository, type PatchBozza } from "./repository";
import { riequilibraBeni, type EsitoRisolutore } from "./risolutore";

export type Controllo = { codice: string; esito: "ok" | "avviso" | "errore"; messaggio: string };
export type Dipendenze = {
  now?: () => Date;
  repository?: FattureRepository;
  /** Solo per i test: `false` fa nascere la bozza grezza (beni a contratto, servizi ai limiti) invece di quella bilanciata. */
  bilanciaBozza?: boolean;
};

export type ModificaBozza = {
  /** Solo righe bene/servizio non derivate, identificate per `ordine`. */
  righe?: Array<{ ordine: number; importoCent: number; descrizione?: string }>;
  /** Righe scritte a mano in bozza (R18): maniglie, voci extra. Vanno in coda al gruppo del loro tipo. */
  righeAggiunte?: Array<{
    tipo: "bene" | "servizio";
    descrizione: string;
    importoCent: number;
    aliquota: 22 | 10;
    beneSignificativo: boolean;
  }>;
  /** Ordini di righe aggiunte a mano: quelle del contratto e del computo si azzerano, non si cancellano (R18). */
  righeRimosse?: number[];
  scadenze?: ScadenzaFatturaInput[];
  note?: string | null;
  diciture?: ChiaveDicitura[];
  intestazioneCantiere?: string | null;
  /** Scala le righe bene significative finché il markup vale questo importo. */
  riequilibraBeniAMarkupCent?: number;
  scavalcoLimiti?: { attivo: boolean; motivo: string | null };
};

/** Scarto ammesso sul markup dopo il riequilibrio: l'IVA non restituisce sempre il centesimo esatto. */
const TOLLERANZA_MARKUP_CENT = 3;
/** Quante righe si aggiungono in una sola modifica: oltre non è più una correzione, è un'altra fattura. */
export const MAX_RIGHE_AGGIUNTE = 20;
export const MAX_DESCRIZIONE_RIGA = 300;
const FUSO = "Europe/Rome";

// Stesso formattatore di `risolutore.ts` e `generatore.ts`: tenuto locale
// come lì, perché è testo di messaggio e non una conversione di dominio
// (quelle stanno in @shared/euroCent).
function euro(cent: number): string {
  return (cent / 100).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function repo(dip?: Dipendenze): FattureRepository {
  return dip?.repository ?? getFattureRepository();
}
function adesso(dip?: Dipendenze): Date {
  return dip?.now?.() ?? new Date();
}
/**
 * Il giorno di calendario italiano, non quello UTC: a mezzanotte e mezza
 * di Sarzana l'UTC è ancora ieri, e una scadenza datata ieri nascerebbe
 * già «passata». Stesso `TZDate` usato dal resto del CRM (reminders,
 * briefing, agenda); il `giornoLocale` di `tars/analisi/fotografia.ts`
 * fa la stessa cosa ma vive in un modulo che tira dentro tutto Tars, e
 * un servizio di dominio non ci si appoggia.
 */
export function iso(d: Date): string {
  const locale = new TZDate(d, FUSO);
  const mm = String(locale.getMonth() + 1).padStart(2, "0");
  const gg = String(locale.getDate()).padStart(2, "0");
  return `${locale.getFullYear()}-${mm}-${gg}`;
}

function commessaInSede(sedeId: number, commessaId: number): any {
  const commessa: any = getCommessaById(commessaId);
  if (!commessa || (commessa.sedeId ?? DEFAULT_SEDE_ID) !== sedeId) {
    throw new Error("NOT_FOUND: Commessa non trovata.");
  }
  return commessa;
}

/**
 * La fattura c'è, è di questa sede ed è ancora una bozza. `perId` filtra
 * per sede: un record di un'altra sede dà `NOT_FOUND`, mai un indizio che
 * l'id esista. Ogni scrittura passa di qui prima di toccare il
 * repository, che invece si fida (v. `appendEvento`, che non controlla la
 * sede da solo).
 */
async function bozzaModificabile(repository: FattureRepository, sedeId: number, id: number): Promise<Fattura> {
  const fattura = await repository.perId(sedeId, id);
  if (!fattura) throw new Error("NOT_FOUND: Fattura non trovata.");
  if (!fatturaModificabile(fattura.stato)) {
    throw new Error(
      `FATTURA_IMMUTABILE: la fattura #${fattura.id} è in stato «${fattura.stato}»: correggi con una nota di credito.`
    );
  }
  return fattura;
}

const comeRigaInput = (r: RigaFattura): RigaFatturaInput => {
  const { id: _id, fatturaId: _fatturaId, ...resto } = r;
  return resto;
};
const comeScadenzaInput = (s: ScadenzaFattura): ScadenzaFatturaInput => ({
  numero: s.numero,
  quotaPct: s.quotaPct,
  data: s.data,
  importoCent: s.importoCent,
  descrizione: s.descrizione,
});

/**
 * Quantità e prezzo unitario di una riga corretta a mano. Fatture in
 * Cloud ricalcola il totale come `qty × net_price`: i due devono
 * rimoltiplicarsi nell'importo esatto, o la fattura emessa non
 * quadrerebbe con la bozza. Le righe generate hanno quantità 1 (il numero
 * di serramenti sta nella descrizione, «N.3 …»), quindi la divisione è
 * esatta; se una quantità diversa non divide il nuovo importo senza
 * resto, la riga diventa una riga singola da `importoCent` invece di
 * perdere centesimi nell'arrotondamento.
 */
function misuraRiga(importoCent: number, quantita: number): { quantita: number; prezzoUnitCent: number } {
  if (quantita > 0 && importoCent % quantita === 0) return { quantita, prezzoUnitCent: importoCent / quantita };
  return { quantita: 1, prezzoUnitCent: importoCent };
}

function controlliClienteDi(f: Fattura): Controllo[] {
  if (!f.clienteSnapshot) {
    return [
      { codice: "cliente_mancante", esito: "errore", messaggio: "Fattura senza anagrafica cliente: rigenera la bozza." },
    ];
  }
  return controlliCliente(f.clienteSnapshot, f.detrazioneTipo);
}

type Proposta = {
  contratto: Contratto;
  clienteSnapshot: ClienteSnapshot;
  computoId: number | null;
  bozza: Bozza;
  righe: RigaFatturaInput[];
  esito: EsitoRisolutore;
  avvertenze: string[];
};

/**
 * La proposta del sistema per una commessa: contratto, computo, snapshot
 * del cliente, righe e totali. `creaBozza` la persiste in una fattura
 * nuova e `rigeneraBozza` la sovrascrive su una esistente — «cosa
 * proporre» è la stessa domanda, cambia solo dove finisce la risposta.
 *
 * `generaBozza` non restituisce l'esito del risolutore: `ricalcola` è
 * idempotente sulle righe già complete (scarta le derivate e le rifà),
 * quindi una seconda passata dà le stesse righe più l'esito da cui
 * prendere riepilogo e totali.
 */
async function proponiDalContratto(
  repository: FattureRepository,
  sedeId: number,
  commessa: any,
  now: Date,
  bilancia = true
): Promise<Proposta> {
  const { contratto, righe } = await leggiContratto(sedeId, commessa.id);
  if (!contratto) throw new Error("PRECONDIZIONE: Manca il contratto strutturato.");
  const { computo, valido, motivo } = await ultimoComputo(sedeId, commessa.id);
  const config = await repository.config(sedeId);
  const clienteSnapshot = snapshotCliente(commessa.clienteId ? getClienteById(commessa.clienteId) : null, commessa);

  const bozza = generaBozza({
    bilancia,
    contratto,
    righe,
    computo,
    cliente: clienteSnapshot,
    commessa: { codice: commessa.codice, indirizzo: commessa.indirizzo ?? null, citta: commessa.citta ?? null },
    config,
    dataFattura: iso(now),
  });
  const avvertenze = [...bozza.avvertenze];
  // Un computo scaduto non impedisce la bozza: i limiti restano la
  // migliore stima disponibile, ma l'emissione li richiederà freschi
  // (o uno scavalco registrato). Il motivo arriva da `ultimoComputo`:
  // righe cambiate, parametri cambiati o computo incompleto.
  if (computo && !valido) {
    avvertenze.push(
      `Computo non aggiornato alle righe correnti: ricalcola i limiti.${motivo ? ` (${motivo})` : ""}`
    );
  }

  const { righe: righeComplete, esito } = ricalcola({
    righe: bozza.righe,
    pattuitoCent: contratto.pattuitoCent,
    pattuitoTipo: contratto.pattuitoTipo,
  });
  return {
    contratto,
    clienteSnapshot,
    computoId: valido && computo ? computo.id : null,
    bozza,
    righe: righeComplete,
    esito,
    avvertenze,
  };
}

// ── Creazione ───────────────────────────────────────────────────────────

export async function creaBozza(
  input: { sedeId: number; commessaId: number; actorUserId: number | null } & Dipendenze
): Promise<{ fattura: Fattura; avvertenze: string[] }> {
  const repository = repo(input);
  const now = adesso(input);
  const commessa = commessaInSede(input.sedeId, input.commessaId);

  // Una sola fattura per commessa: la seconda è una nota di credito
  // (Task 11). Le note di credito hanno un ciclo proprio e non entrano in
  // questo conteggio. Le guardie vengono prima della proposta: inutile
  // generare una bozza che non si potrà salvare.
  const precedenti = (await repository.perCommessa(input.sedeId, input.commessaId)).filter(f => f.tipo === "fattura");
  const bozzaAperta = precedenti.find(f => f.stato === "bozza");
  if (bozzaAperta) {
    throw new Error(`PRECONDIZIONE: Esiste già una bozza per questa commessa (#${bozzaAperta.id}).`);
  }
  const emessa = precedenti.find(f => f.stato !== "annullata");
  if (emessa) {
    throw new Error(`PRECONDIZIONE: La commessa ha già la fattura #${emessa.id}: usa la nota di credito.`);
  }

  const { contratto, clienteSnapshot, computoId, bozza, righe, esito, avvertenze } = await proponiDalContratto(repository, input.sedeId, commessa, now, input.bilanciaBozza ?? true);

  const fattura = await repository.crea({
    fattura: {
      sedeId: input.sedeId,
      commessaId: input.commessaId,
      computoId,
      hashRighe: contratto.hashRighe,
      tipo: "fattura",
      notaCreditoDi: null,
      stato: "bozza",
      ficDocumentId: null,
      // Numero e data li assegna Fatture in Cloud all'emissione: una
      // bozza non consuma numerazione.
      numero: null,
      data: null,
      clienteSnapshot,
      pattuitoTipo: contratto.pattuitoTipo,
      pattuitoCent: contratto.pattuitoCent,
      imponibileCent: esito.imponibileCent,
      ivaCent: esito.ivaCent,
      totaleCent: esito.totaleCent,
      deltaPattuitoCent: esito.deltaPattuitoCent,
      markupCent: esito.markupCent,
      stornoCent: esito.stornoCent,
      diciture: bozza.diciture,
      note: bozza.note,
      intestazioneCantiere: bozza.intestazioneCantiere,
      detrazioneTipo: contratto.detrazioneTipo,
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
    riepilogo: esito.riepilogo,
    scadenze: bozza.scadenze,
    now,
  });

  await repository.appendEvento({
    fatturaId: fattura.id,
    sedeId: input.sedeId,
    tipo: "creata",
    payload: { avvertenze },
    actorUserId: input.actorUserId,
  });
  return { fattura, avvertenze };
}

// ── Lettura ─────────────────────────────────────────────────────────────

export async function leggiFattura(
  sedeId: number,
  id: number,
  dip?: Dipendenze
): Promise<{ fattura: Fattura; controlli: Controllo[]; eventi: EventoFattura[] } | null> {
  const repository = repo(dip);
  const fattura = await repository.perId(sedeId, id);
  if (!fattura) return null;
  const eventi = await repository.eventi(sedeId, id);
  // Cliente e limiti si vedono sempre; la configurazione della sede è una
  // domanda sull'emissione, non sulla fattura: sta in `validaPerEmissione`.
  // Sulla nota di credito i limiti del computo non dicono nulla (Ruling
  // R14, stessa guardia di `validaPerEmissione`): in lettura sarebbero
  // solo rumore.
  const limiti =
    fattura.tipo === "nota_credito" ? [] : verificaLimiti(fattura, await computoPerLimiti(sedeId, fattura));
  return { fattura, controlli: [...controlliClienteDi(fattura), ...limiti], eventi };
}

export async function fatturePerCommessa(sedeId: number, commessaId: number, dip?: Dipendenze): Promise<Fattura[]> {
  return repo(dip).perCommessa(sedeId, commessaId);
}

// ── Modifica ────────────────────────────────────────────────────────────

function applicaRighe(
  righe: RigaFatturaInput[],
  modifiche: NonNullable<ModificaBozza["righe"]>
): RigaFatturaInput[] {
  const perOrdine = new Map(righe.map(r => [r.ordine, r]));
  const richieste = new Map<number, { importoCent: number; descrizione?: string }>();
  for (const mod of modifiche) {
    const riga = perOrdine.get(mod.ordine);
    if (!riga) throw new Error(`VALIDAZIONE: la riga ${mod.ordine} non esiste in questa fattura.`);
    if (riga.derivata) {
      throw new Error(
        `VALIDAZIONE: la riga ${mod.ordine} è derivata dal risolutore: si cambia agendo su beni e servizi.`
      );
    }
    if (riga.tipo !== "bene" && riga.tipo !== "servizio") {
      throw new Error(`VALIDAZIONE: la riga ${mod.ordine} non ha un importo da correggere.`);
    }
    if (!Number.isInteger(mod.importoCent)) {
      throw new Error(`VALIDAZIONE: l'importo della riga ${mod.ordine} non è in centesimi interi.`);
    }
    if (mod.importoCent < 0) {
      throw new Error(`VALIDAZIONE: l'importo della riga ${mod.ordine} non può essere negativo.`);
    }
    if (mod.descrizione !== undefined && mod.descrizione.trim() === "") {
      throw new Error(`VALIDAZIONE: la riga ${mod.ordine} non può restare senza descrizione.`);
    }
    // Due correzioni sulla stessa riga: quale vince non è deducibile, e
    // l'ultima che passa sarebbe un caso silenzioso.
    if (richieste.has(mod.ordine)) throw new Error(`VALIDAZIONE: ordine di riga duplicato: ${mod.ordine}.`);
    richieste.set(mod.ordine, mod);
  }
  return righe.map(r => {
    const mod = richieste.get(r.ordine);
    if (!mod) return r;
    return {
      ...r,
      importoCent: mod.importoCent,
      ...misuraRiga(mod.importoCent, r.quantita),
      descrizione: mod.descrizione?.trim() ?? r.descrizione,
    };
  });
}

/**
 * Dove finisce una riga scritta a mano: in coda alle righe del suo tipo —
 * un bene prima del markup, un servizio prima di storno e riaddebito, che
 * `ricalcola` rimette al loro posto subito dopo. Senza righe di quel tipo
 * un bene precede l'intestazione delle prestazioni (stessa scelta di
 * `posizioneMarkup` in generatore.ts) e un servizio chiude il corpo, prima
 * delle righe `nota`.
 */
function posizioneAggiunta(righe: RigaFatturaInput[], tipo: "bene" | "servizio"): number {
  const ultimo = righe.map(r => r.tipo).lastIndexOf(tipo);
  if (ultimo >= 0) return ultimo + 1;
  if (tipo === "bene") {
    const prestazioni = righe.findIndex(r => r.tipo === "intestazione" && r.descrizione === DICITURE.prestazioni);
    if (prestazioni >= 0) return prestazioni;
  }
  const primaNota = righe.findIndex(r => r.tipo === "nota");
  return primaNota >= 0 ? primaNota : righe.length;
}

/**
 * Le righe scritte a mano in bozza (R18, fatture 106 e 119: maniglie e
 * voci aggiunte in fase di fatturazione). Non hanno riga di contratto né
 * voce di computo — non vengono da nessun documento — quindi nascono
 * senza limite e con quantità 1: il numero dei pezzi sta nella
 * descrizione, come nelle righe generate. L'aliquota segue il tipo: un
 * bene è al 22 %, un servizio al 10 %; il resto lo fa `ricalcola`.
 */
function aggiungiRighe(
  righe: RigaFatturaInput[],
  aggiunte: NonNullable<ModificaBozza["righeAggiunte"]>
): RigaFatturaInput[] {
  if (aggiunte.length > MAX_RIGHE_AGGIUNTE) {
    throw new Error(`VALIDAZIONE: non si aggiungono più di ${MAX_RIGHE_AGGIUNTE} righe alla volta.`);
  }
  // Ordini provvisori oltre l'ultimo esistente: `ricalcola` rinumera tutto
  // alla fine, ma finché non lo fa nessuna riga deve condividere l'ordine
  // con un'altra (il riequilibrio dei beni le distingue così).
  let prossimoOrdine = righe.reduce((max, r) => Math.max(max, r.ordine), 0) + 1;
  let esito = righe;
  for (const a of aggiunte) {
    const descrizione = a.descrizione.trim();
    if (!descrizione) throw new Error("VALIDAZIONE: una riga aggiunta senza descrizione non si salva.");
    if (descrizione.length > MAX_DESCRIZIONE_RIGA) {
      throw new Error(
        `VALIDAZIONE: la descrizione di una riga aggiunta non può superare i ${MAX_DESCRIZIONE_RIGA} caratteri.`
      );
    }
    if (!Number.isInteger(a.importoCent) || a.importoCent < 0) {
      throw new Error(`VALIDAZIONE: l'importo della riga "${descrizione}" non è in centesimi interi non negativi.`);
    }
    const attesa = a.tipo === "bene" ? 22 : 10;
    if (a.aliquota !== attesa) {
      throw new Error(`VALIDAZIONE: una riga «${a.tipo}» va al ${attesa} %, non al ${a.aliquota} %.`);
    }
    const riga: RigaFatturaInput = {
      ordine: prossimoOrdine++,
      tipo: a.tipo,
      descrizione,
      quantita: 1,
      prezzoUnitCent: a.importoCent,
      importoCent: a.importoCent,
      aliquota: a.aliquota,
      voceComputoCodice: null,
      rigaCommessaId: null,
      limiteCent: null,
      // Solo un bene entra in B: un servizio è prestazione per definizione.
      beneSignificativo: a.tipo === "bene" && a.beneSignificativo,
      derivata: false,
    };
    const posizione = posizioneAggiunta(esito, a.tipo);
    esito = [...esito.slice(0, posizione), riga, ...esito.slice(posizione)];
  }
  return esito;
}

/**
 * Si toglie solo ciò che è stato aggiunto a mano. Una riga che viene dal
 * contratto o dal computo si azzera (`righe`), non si cancella: la fattura
 * deve continuare a mostrare cosa è stato venduto e cosa il computo aveva
 * proposto, anche a importo zero. Le derivate le rifà il risolutore.
 */
function rimuoviRighe(righe: RigaFatturaInput[], ordini: number[]): RigaFatturaInput[] {
  const perOrdine = new Map(righe.map(r => [r.ordine, r]));
  const daTogliere = new Set<number>();
  for (const ordine of ordini) {
    if (daTogliere.has(ordine)) throw new Error(`VALIDAZIONE: ordine di riga duplicato: ${ordine}.`);
    const riga = perOrdine.get(ordine);
    if (!riga) throw new Error(`VALIDAZIONE: la riga ${ordine} non esiste in questa fattura.`);
    if (riga.derivata) {
      throw new Error(
        `VALIDAZIONE: la riga ${ordine} è derivata dal risolutore: si cambia agendo su beni e servizi.`
      );
    }
    if (riga.tipo !== "bene" && riga.tipo !== "servizio") {
      throw new Error(`VALIDAZIONE: la riga ${ordine} non è una riga aggiunta a mano.`);
    }
    if (riga.rigaCommessaId != null || riga.voceComputoCodice != null) {
      throw new Error(
        `VALIDAZIONE: la riga ${ordine} viene dal contratto o dal computo: azzera l'importo, non si cancella.`
      );
    }
    daTogliere.add(ordine);
  }
  return righe.filter(r => !daTogliere.has(r.ordine));
}

/**
 * Il totale che le righe bene significative devono raggiungere perché il
 * markup valga `markupDesideratoCent`. Col pattuito imponibile è
 * un'addizione (G = B + P); col pattuito lordo bisogna invertire la
 * relazione del risolutore, che cambia forma a seconda che i beni
 * significativi superino la prestazione o no (DM 29/12/1999): si prova
 * l'ipotesi B' > P' e, se non regge, si usa l'altra.
 */
function targetBeniSignificativi(f: Fattura, altriBeniCent: number, serviziCent: number, markupDesideratoCent: number): number {
  const G = f.pattuitoCent;
  const P = altriBeniCent + serviziCent + markupDesideratoCent;
  if (f.pattuitoTipo === "imponibile") return G - P;
  const conBeniSopra = Math.round((G - 0.98 * P) / 1.22);
  return conBeniSopra > P ? conBeniSopra : Math.round(G / 1.1 - P);
}

function riequilibra(righe: RigaFatturaInput[], fattura: Fattura, markupDesideratoCent: number): RigaFatturaInput[] {
  if (!Number.isInteger(markupDesideratoCent)) {
    throw new Error("VALIDAZIONE: il markup desiderato non è in centesimi interi.");
  }
  const fisse = righe.filter(r => !r.derivata);
  const significativi = fisse.filter(r => r.tipo === "bene" && r.beneSignificativo);
  if (significativi.length === 0) {
    throw new Error("VALIDAZIONE: senza righe di beni significativi non c'è nulla da riequilibrare.");
  }
  const altri = fisse.filter(r => r.tipo === "bene" && !r.beneSignificativo).reduce((s, r) => s + r.importoCent, 0);
  const servizi = fisse.filter(r => r.tipo === "servizio").reduce((s, r) => s + r.importoCent, 0);
  // `riequilibraBeni` clampa da sé un target negativo (beni a zero).
  const nuovi = riequilibraBeni(
    significativi.map(r => r.importoCent),
    targetBeniSignificativi(fattura, altri, servizi, markupDesideratoCent)
  );
  const perOrdine = new Map(significativi.map((r, i) => [r.ordine, nuovi[i]]));
  return righe.map(r => {
    const importoCent = perOrdine.get(r.ordine);
    if (importoCent === undefined) return r;
    return { ...r, importoCent, ...misuraRiga(importoCent, r.quantita) };
  });
}

async function scadenzeAggiornate(
  sedeId: number,
  fattura: Fattura,
  richieste: ScadenzaFatturaInput[] | undefined,
  totaleCent: number,
  dataOdierna: string
): Promise<ScadenzaFatturaInput[]> {
  if (richieste) {
    if (richieste.length === 0) throw new Error("VALIDAZIONE: la fattura deve avere almeno una scadenza.");
    if (richieste.some(s => s.importoCent < 0)) {
      throw new Error("VALIDAZIONE: una scadenza non può avere un importo negativo.");
    }
    if (new Set(richieste.map(s => s.numero)).size !== richieste.length) {
      throw new Error("VALIDAZIONE: due scadenze hanno lo stesso numero.");
    }
    const somma = richieste.reduce((s, x) => s + x.importoCent, 0);
    if (somma !== totaleCent) {
      throw new Error(`VALIDAZIONE: le scadenze sommano € ${euro(somma)}, il totale è € ${euro(totaleCent)}.`);
    }
    return richieste;
  }
  // Totale invariato: le scadenze restano com'erano (comprese quelle già
  // appaiate a un pagamento FiC, che il repository conserva per numero).
  if (totaleCent === fattura.totaleCent) return fattura.scadenze.map(comeScadenzaInput);
  const { contratto } = await leggiContratto(sedeId, fattura.commessaId);
  return scadenzeDaRate(contratto?.rate ?? [], totaleCent, dataOdierna);
}

export async function aggiornaBozza(
  input: {
    sedeId: number;
    id: number;
    revisione: number;
    modifica: ModificaBozza;
    actorUserId: number | null;
  } & Dipendenze
): Promise<{ fattura: Fattura; controlli: Controllo[] }> {
  const repository = repo(input);
  const now = adesso(input);
  const fattura = await bozzaModificabile(repository, input.sedeId, input.id);
  const modifica = input.modifica;

  // Ruling R34: attivare «Procedi comunque» sui limiti si registra
  // (evento `scavalco_limiti`), e un registro senza motivo non spiega
  // niente a chi lo rileggerà. Qui, non solo nel router: vale anche per
  // una chiamata diretta al servizio. Spegnerlo è tornare alla regola e
  // non richiede una giustificazione.
  if (modifica.scavalcoLimiti?.attivo && !modifica.scavalcoLimiti.motivo?.trim()) {
    throw new Error("VALIDAZIONE: indica il motivo dello scavalco.");
  }

  let righe = fattura.righe.map(comeRigaInput);
  // Correzioni e rimozioni parlano degli ordini correnti: si applicano
  // prima delle aggiunte, che quegli ordini li sposterebbero.
  if (modifica.righe) righe = applicaRighe(righe, modifica.righe);
  if (modifica.righeRimosse) righe = rimuoviRighe(righe, modifica.righeRimosse);
  if (modifica.righeAggiunte) righe = aggiungiRighe(righe, modifica.righeAggiunte);
  if (modifica.riequilibraBeniAMarkupCent !== undefined) {
    righe = riequilibra(righe, fattura, modifica.riequilibraBeniAMarkupCent);
  }

  const { righe: righeComplete, esito } = ricalcola({
    righe,
    pattuitoCent: fattura.pattuitoCent,
    pattuitoTipo: fattura.pattuitoTipo,
  });

  const avvisi: Controllo[] = [];
  if (modifica.riequilibraBeniAMarkupCent !== undefined) {
    const scarto = esito.markupCent - modifica.riequilibraBeniAMarkupCent;
    if (Math.abs(scarto) > TOLLERANZA_MARKUP_CENT) {
      avvisi.push({
        codice: "riequilibrio_markup",
        esito: "avviso",
        messaggio: `Riequilibrio non esatto: il markup è € ${euro(esito.markupCent)} invece di € ${euro(
          modifica.riequilibraBeniAMarkupCent
        )}.`,
      });
    }
  }

  const scadenze = await scadenzeAggiornate(input.sedeId, fattura, modifica.scadenze, esito.totaleCent, iso(now));

  // Le chiavi assenti dalla modifica restano `undefined` e il repository
  // le ignora: un patch parziale non azzera nulla.
  const patch: PatchBozza = {
    imponibileCent: esito.imponibileCent,
    ivaCent: esito.ivaCent,
    totaleCent: esito.totaleCent,
    deltaPattuitoCent: esito.deltaPattuitoCent,
    markupCent: esito.markupCent,
    stornoCent: esito.stornoCent,
    note: modifica.note,
    diciture: modifica.diciture,
    intestazioneCantiere: modifica.intestazioneCantiere,
    scavalcoLimiti: modifica.scavalcoLimiti?.attivo,
    scavalcoMotivo: modifica.scavalcoLimiti ? modifica.scavalcoLimiti.motivo : undefined,
  };

  const aggiornata = await repository.aggiornaBozza({
    sedeId: input.sedeId,
    id: input.id,
    revisioneAttesa: input.revisione,
    patch,
    righe: righeComplete,
    riepilogo: esito.riepilogo,
    scadenze,
    now,
  });

  await repository.appendEvento({
    fatturaId: aggiornata.id,
    sedeId: input.sedeId,
    tipo: "modificata",
    payload: {
      campi: Object.keys(modifica),
      ...(modifica.righeAggiunte || modifica.righeRimosse
        ? {
            righeAggiunte: modifica.righeAggiunte?.length ?? 0,
            righeRimosse: modifica.righeRimosse?.length ?? 0,
          }
        : {}),
    },
    actorUserId: input.actorUserId,
  });
  if (modifica.scavalcoLimiti) {
    await repository.appendEvento({
      fatturaId: aggiornata.id,
      sedeId: input.sedeId,
      tipo: "scavalco_limiti",
      payload: { attivo: modifica.scavalcoLimiti.attivo, motivo: modifica.scavalcoLimiti.motivo },
      actorUserId: input.actorUserId,
    });
  }

  return {
    fattura: aggiornata,
    controlli: [
      ...controlliClienteDi(aggiornata),
      ...verificaLimiti(aggiornata, await computoPerLimiti(input.sedeId, aggiornata)),
      ...avvisi,
    ],
  };
}

/** Ricrea righe e scadenze dal contratto e dal computo correnti: la bozza torna alla proposta del sistema. */
export async function rigeneraBozza(
  input: { sedeId: number; id: number; revisione: number; actorUserId: number | null } & Dipendenze
): Promise<{ fattura: Fattura; avvertenze: string[] }> {
  const repository = repo(input);
  const now = adesso(input);
  const fattura = await bozzaModificabile(repository, input.sedeId, input.id);
  // Ruling R16: rigenerare rilegge il contratto e il computo — una nota di
  // credito non ha né l'uno né l'altro, le sue righe vengono dalla fattura
  // che storna (v. notaCredito.ts).
  if (fattura.tipo === "nota_credito") {
    throw new Error("PRECONDIZIONE: la nota di credito rispecchia la fattura di origine e non si rigenera.");
  }
  const commessa = commessaInSede(input.sedeId, fattura.commessaId);
  const { contratto, clienteSnapshot, computoId, bozza, righe, esito, avvertenze } = await proponiDalContratto(repository, input.sedeId, commessa, now, input.bilanciaBozza ?? true);

  const aggiornata = await repository.aggiornaBozza({
    sedeId: input.sedeId,
    id: input.id,
    revisioneAttesa: input.revisione,
    patch: {
      pattuitoCent: contratto.pattuitoCent,
      pattuitoTipo: contratto.pattuitoTipo,
      detrazioneTipo: contratto.detrazioneTipo,
      clienteSnapshot,
      computoId,
      hashRighe: contratto.hashRighe,
      diciture: bozza.diciture,
      intestazioneCantiere: bozza.intestazioneCantiere,
      imponibileCent: esito.imponibileCent,
      ivaCent: esito.ivaCent,
      totaleCent: esito.totaleCent,
      deltaPattuitoCent: esito.deltaPattuitoCent,
      markupCent: esito.markupCent,
      stornoCent: esito.stornoCent,
      // La bozza torna alla proposta del sistema: uno scavalco deciso
      // sulle righe di prima non vale più su righe che non sono più
      // quelle. Se serve ancora, si registra di nuovo (con il motivo).
      scavalcoLimiti: false,
      scavalcoMotivo: null,
      // `note` resta fuori dal patch di proposito: è testo di chi
      // fattura, non un derivato del contratto.
    },
    righe,
    riepilogo: esito.riepilogo,
    scadenze: bozza.scadenze,
    now,
  });

  await repository.appendEvento({
    fatturaId: aggiornata.id,
    sedeId: input.sedeId,
    tipo: "modificata",
    payload: { rigenerata: true, avvertenze },
    actorUserId: input.actorUserId,
  });
  return { fattura: aggiornata, avvertenze };
}

// ── Limiti e validazioni ────────────────────────────────────────────────

/**
 * Il computo per verificare i limiti (R25): quello più recente della
 * commessa, ma solo se `computoId` dice che era valido quando la bozza è
 * nata o è stata rigenerata — con `computoId` nullo le righe potrebbero non
 * corrispondere più a nessuna voce del computo attuale, e il confronto
 * userebbe un numero a caso spacciato per un limite. `verificaLimiti`
 * resta pura: questa è la lettura in più (Task 12c) che `leggiFattura`,
 * `aggiornaBozza` e `validaPerEmissione` pagano solo quando serve — con
 * `computoId` nullo non tocca il repository.
 */
async function computoPerLimiti(sedeId: number, f: Fattura): Promise<Computo | null> {
  if (f.computoId == null) return null;
  const { computo } = await ultimoComputo(sedeId, f.commessaId);
  return computo;
}

/**
 * I limiti del computo sulla bozza (spec §7.3, Ruling R25). Per riga è un
 * indicatore (avviso): un servizio sopra il proprio limite resta ammesso,
 * la detrazione del cliente ne risentirà e basta. Tre blocchi sono un
 * vincolo vero: il markup è margine sui prodotti, non sui servizi (prova
 * sul demo 04/09: il foglio e la fattura 129 sommano beni e markup contro
 * il massimale dell'Allegato A, mai markup e servizi contro le opere) —
 * prodotti (beni senza voce di computo, markup incluso) contro i
 * `massimale_*` del computo; servizi contro le opere/eventuali che il
 * generatore ha proposto; imponibile contro il limite complessivo del
 * computo (minimo CHECK1/CHECK2). Ognuno oltre il proprio limite impedisce
 * l'emissione, salvo scavalco registrato con motivo.
 */
export function verificaLimiti(f: Fattura, computo?: Computo | null): Controllo[] {
  const controlli: Controllo[] = [];
  // Le righe legate a una voce del computo: i servizi al 10 % e — da R17 —
  // le spese di documentazione, che sono un bene al 22 %. Il limite della
  // voce si verifica su tutte, riga per riga.
  const conVoce = f.righe.filter(r => r.tipo === "servizio" || r.voceComputoCodice != null);
  for (const r of conVoce) {
    if (r.limiteCent != null && r.importoCent > r.limiteCent) {
      controlli.push({
        codice: "limite_riga",
        esito: "avviso",
        messaggio: `"${r.descrizione}" supera il limite di € ${euro(r.limiteCent)}.`,
      });
    }
  }

  // Un blocco oltre il proprio limite: stessa forma per i tre confronti
  // (R25), errore a meno di scavalco registrato — allora avviso col motivo.
  const controlloBlocco = (codice: string, testo: string, importoCent: number, limiteCent: number) => {
    if (importoCent <= limiteCent) return;
    controlli.push(
      f.scavalcoLimiti
        ? { codice, esito: "avviso", messaggio: `${testo} — scavalcato: ${f.scavalcoMotivo ?? "senza motivo indicato"}.` }
        : { codice, esito: "errore", messaggio: `${testo}.` }
    );
  };

  // Ruling R26: un termine di paragone a zero (nessuna voce del gruppo, o
  // limite complessivo non calcolato) non è «entro il limite» — sarebbe un
  // «ok» falso — ma nemmeno un blocco vero: è quel blocco, da solo, che non
  // si può verificare. Gli altri due, se hanno un termine di paragone,
  // procedono comunque (a differenza di `!computo` qui sotto, dove manca
  // tutto il computo e nessuno dei tre si può giudicare).
  const blocco = (
    codice: string,
    importoCent: number,
    limiteCent: number,
    testoErrore: string,
    messaggioNonVerificabile: string
  ) => {
    if (limiteCent <= 0) {
      controlli.push({ codice: "limiti_non_verificati", esito: "avviso", messaggio: messaggioNonVerificabile });
      return;
    }
    controlloBlocco(codice, testoErrore, importoCent, limiteCent);
  };

  // Il confronto ha senso solo se il computo è arrivato con le sue voci:
  // senza, il termine di paragone sarebbe zero e ogni blocco sembrerebbe
  // fuori limite. Ma nemmeno si può dire che i limiti siano rispettati: non
  // sono stati verificati, e va detto (Ruling R8) — un «ok» qui sarebbe una
  // rassicurazione falsa.
  if (!computo) {
    controlli.push({
      codice: "limiti_non_verificati",
      esito: "avviso",
      messaggio: "Limiti non verificati: computo assente o senza voci proposte.",
    });
  } else {
    // Prodotti (R25): beni senza voce di computo — righe del contratto e
    // righe manuali (R18), la spesa di documentazione ne ha una ed esce —
    // più il markup, contro l'Allegato A (CHECK1, i `massimale_*`). Solo
    // righe non derivate (R26): markup/storno/riaddebito hanno un proprio
    // `tipo`, quindi `!r.derivata` è difensivo, non correttivo.
    const prodottiCent =
      f.righe
        .filter(r => r.tipo === "bene" && r.voceComputoCodice == null && !r.derivata)
        .reduce((s, r) => s + r.importoCent, 0) + f.markupCent;
    const massimaleCent = computo.voci
      .filter(v => v.gruppo === "prodotti" && v.codice.startsWith("massimale_"))
      .reduce((s, v) => s + v.limiteCent, 0);
    blocco(
      "limite_prodotti",
      prodottiCent,
      massimaleCent,
      `Beni e markup (€ ${euro(prodottiCent)}) superano il massimale dei prodotti (€ ${euro(massimaleCent)})`,
      "Limiti dei prodotti non verificabili: il computo non ha massimali."
    );

    // Servizi (manuali compresi, righe derivate escluse per lo stesso
    // motivo) contro le sole voci opere/eventuali che il generatore ha
    // davvero proposto: stesso insieme di `servizioProposto` (altri_servizi
    // e spese di documentazione esclusi, come in bozza).
    const serviziCent = f.righe
      .filter(r => r.tipo === "servizio" && !r.derivata)
      .reduce((s, r) => s + r.importoCent, 0);
    const opereCent = computo.voci.filter(servizioProposto).reduce((s, v) => s + v.limiteCent, 0);
    blocco(
      "limite_servizi",
      serviziCent,
      opereCent,
      `I servizi (€ ${euro(serviziCent)}) superano i limiti delle opere (€ ${euro(opereCent)})`,
      "Limiti dei servizi non verificabili: il computo non propone opere."
    );

    // Imponibile complessivo contro il limite del computo (minimo fra
    // CHECK1 e CHECK2).
    blocco(
      "limite_totale",
      f.imponibileCent,
      computo.limiteCent,
      `L'imponibile (€ ${euro(f.imponibileCent)}) supera il limite del computo (€ ${euro(computo.limiteCent)})`,
      "Limite complessivo non verificabile."
    );
  }

  if (f.markupCent < 0) {
    controlli.push({
      codice: "markup_negativo",
      esito: "errore",
      messaggio: `Il markup è negativo (€ ${euro(f.markupCent)}): servizi e altri beni superano il pattuito.`,
    });
  }

  if (controlli.length === 0) {
    controlli.push({ codice: "limiti", esito: "ok", messaggio: "Prestazioni entro i limiti del computo." });
  }
  return controlli;
}

/** Tutto quello che deve essere a posto prima di mandare la fattura a Fatture in Cloud (spec §7.4). */
export async function validaPerEmissione(
  sedeId: number,
  id: number,
  dip?: Dipendenze
): Promise<{ fattura: Fattura; controlli: Controllo[]; emettibile: boolean }> {
  const repository = repo(dip);
  const fattura = await repository.perId(sedeId, id);
  if (!fattura) throw new Error("NOT_FOUND: Fattura non trovata.");

  const controlli: Controllo[] = [...controlliClienteDi(fattura)];
  const errore = (codice: string, messaggio: string) => controlli.push({ codice, esito: "errore", messaggio });
  const avviso = (codice: string, messaggio: string) => controlli.push({ codice, esito: "avviso", messaggio });

  // Ruling R15: la nota di credito copia il cantiere e non la dicitura del
  // bonifico dell'origine (v. notaCredito.ts) — il vincolo di forma della
  // detrazione (indirizzo cantiere, dicitura del bonifico parlante) riguarda
  // la fattura che il cliente paga, non la nota che la storna.
  if (fattura.tipo !== "nota_credito" && fattura.detrazioneTipo !== "nessuna") {
    if (!fattura.intestazioneCantiere) {
      errore("cantiere", "Con la detrazione la fattura deve indicare l'indirizzo del cantiere.");
    }
    const bonifico = fattura.detrazioneTipo === "ecobonus" ? "bonifico_ecobonus" : "bonifico_ristrutturazione";
    if (!fattura.diciture.includes(bonifico)) {
      errore("dicitura_bonifico", "Manca la dicitura del bonifico parlante richiesta dalla detrazione.");
    }
  }

  // Ruling R14: una nota di credito storna una fattura già emessa, non
  // propone prestazioni nuove — il computo e i suoi limiti non la
  // riguardano. Cliente, configurazione e scadenze restano controllati
  // come per qualunque fattura.
  if (fattura.tipo !== "nota_credito" && fattura.computoId == null && !fattura.scavalcoLimiti) {
    errore("computo_non_valido", "Il computo dei limiti non è aggiornato: ricalcolalo o registra lo scavalco.");
  }

  if (fattura.scadenze.length === 0) {
    errore("scadenze_mancanti", "La fattura non ha scadenze di pagamento.");
  } else {
    const somma = fattura.scadenze.reduce((s, x) => s + x.importoCent, 0);
    if (somma !== fattura.totaleCent) {
      errore(
        "scadenze_totale",
        `Le scadenze sommano € ${euro(somma)}, il totale è € ${euro(fattura.totaleCent)}.`
      );
    }
    // Una data già passata non blocca: capita di fatturare in ritardo.
    const oggi = iso(adesso(dip));
    for (const s of fattura.scadenze) {
      if (s.data < oggi) avviso("scadenza_passata", `La scadenza del ${s.data} è già passata.`);
    }
  }

  // R19: il template della pratica edilizia esce dal generatore con i
  // segnaposto fra graffe (numero, data, comune, intestatario). Non blocca
  // — la fattura resta valida — ma stampare «{numero}» al cliente no.
  if (fattura.note?.includes("{")) {
    avviso(
      "pratica_edilizia_incompleta",
      "Le note hanno ancora segnaposto fra graffe da compilare (pratica edilizia)."
    );
  }

  const config = await repository.config(sedeId);
  if (!config.iban) errore("config_iban", "Configura l'IBAN in Impostazioni → Fatturazione.");
  if (config.vatIdsFic[22] == null) {
    errore("config_vat_22", "Configura l'aliquota IVA 22 % di Fatture in Cloud in Impostazioni → Fatturazione.");
  }
  if (config.vatIdsFic[10] == null) {
    errore("config_vat_10", "Configura l'aliquota IVA 10 % di Fatture in Cloud in Impostazioni → Fatturazione.");
  }
  if (config.paymentAccountIdFic == null) {
    errore("config_conto", "Configura il conto di pagamento Fatture in Cloud in Impostazioni → Fatturazione.");
  }
  if (!config.scopeScritturaOk) {
    errore("config_scope", "Configura i permessi di scrittura Fatture in Cloud in Impostazioni → Fatturazione.");
  }

  // Stessa ragione della guardia sul computo qui sopra (Ruling R14): i
  // limiti del computo non si applicano a una nota di credito.
  if (fattura.tipo !== "nota_credito") {
    controlli.push(...verificaLimiti(fattura, await computoPerLimiti(sedeId, fattura)));
  }
  return { fattura, controlli, emettibile: !controlli.some(c => c.esito === "errore") };
}

// ── Annullamento ────────────────────────────────────────────────────────

export async function annullaBozza(
  input: { sedeId: number; id: number; actorUserId: number | null; motivo: string | null } & Dipendenze
): Promise<Fattura> {
  const repository = repo(input);
  const now = adesso(input);
  await bozzaModificabile(repository, input.sedeId, input.id);
  const annullata = await repository.aggiornaStato({
    sedeId: input.sedeId,
    id: input.id,
    patch: { stato: "annullata" },
    now,
  });
  await repository.appendEvento({
    fatturaId: annullata.id,
    sedeId: input.sedeId,
    tipo: "annullata",
    payload: { motivo: input.motivo },
    actorUserId: input.actorUserId,
  });
  return annullata;
}
