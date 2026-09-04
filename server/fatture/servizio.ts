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
import type { ChiaveDicitura } from "@shared/fatturazione/diciture";
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
import type { Contratto } from "@shared/limiti/tipi";
import { ultimoComputo } from "../computo/servizio";
import { leggiContratto } from "../contratti/servizio";
import { getClienteById } from "../routers/clienti";
import { getCommessaById } from "../routers/commesse";
import { DEFAULT_SEDE_ID } from "../routers/sedi";
import { controlliCliente, snapshotCliente } from "./cliente";
import { generaBozza, ricalcola, scadenzeDaRate, type Bozza } from "./generatore";
import { getFattureRepository, type FattureRepository, type PatchBozza } from "./repository";
import { riequilibraBeni, type EsitoRisolutore } from "./risolutore";

export type Controllo = { codice: string; esito: "ok" | "avviso" | "errore"; messaggio: string };
export type Dipendenze = { now?: () => Date; repository?: FattureRepository };

export type ModificaBozza = {
  /** Solo righe bene/servizio non derivate, identificate per `ordine`. */
  righe?: Array<{ ordine: number; importoCent: number; descrizione?: string }>;
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
function iso(d: Date): string {
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
  now: Date
): Promise<Proposta> {
  const { contratto, righe } = await leggiContratto(sedeId, commessa.id);
  if (!contratto) throw new Error("PRECONDIZIONE: Manca il contratto strutturato.");
  const { computo, valido, motivo } = await ultimoComputo(sedeId, commessa.id);
  const config = await repository.config(sedeId);
  const clienteSnapshot = snapshotCliente(commessa.clienteId ? getClienteById(commessa.clienteId) : null, commessa);

  const bozza = generaBozza({
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

  const { contratto, clienteSnapshot, computoId, bozza, righe, esito, avvertenze } = await proponiDalContratto(
    repository,
    input.sedeId,
    commessa,
    now
  );

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
  return { fattura, controlli: [...controlliClienteDi(fattura), ...verificaLimiti(fattura)], eventi };
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

  let righe = fattura.righe.map(comeRigaInput);
  if (modifica.righe) righe = applicaRighe(righe, modifica.righe);
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
    payload: { campi: Object.keys(modifica) },
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
    controlli: [...controlliClienteDi(aggiornata), ...verificaLimiti(aggiornata), ...avvisi],
  };
}

/** Ricrea righe e scadenze dal contratto e dal computo correnti: la bozza torna alla proposta del sistema. */
export async function rigeneraBozza(
  input: { sedeId: number; id: number; revisione: number; actorUserId: number | null } & Dipendenze
): Promise<{ fattura: Fattura; avvertenze: string[] }> {
  const repository = repo(input);
  const now = adesso(input);
  const fattura = await bozzaModificabile(repository, input.sedeId, input.id);
  const commessa = commessaInSede(input.sedeId, fattura.commessaId);
  const { contratto, clienteSnapshot, computoId, bozza, righe, esito, avvertenze } = await proponiDalContratto(
    repository,
    input.sedeId,
    commessa,
    now
  );

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
 * I limiti del computo sulla bozza (spec §7.3). Per riga è un indicatore
 * (avviso): un servizio sopra il proprio limite resta ammesso, la
 * detrazione del cliente ne risentirà e basta. Sul totale è un blocco: la
 * prestazione complessiva oltre la somma dei limiti proposti impedisce
 * l'emissione, salvo scavalco registrato con motivo.
 */
export function verificaLimiti(f: Fattura): Controllo[] {
  const controlli: Controllo[] = [];
  const servizi = f.righe.filter(r => r.tipo === "servizio");
  for (const r of servizi) {
    if (r.limiteCent != null && r.importoCent > r.limiteCent) {
      controlli.push({
        codice: "limite_riga",
        esito: "avviso",
        messaggio: `"${r.descrizione}" supera il limite di € ${euro(r.limiteCent)}.`,
      });
    }
  }

  // Il confronto ha senso solo se il computo ha davvero proposto delle
  // voci con un limite: senza, il termine di paragone sarebbe zero e ogni
  // prestazione sembrerebbe fuori limite. Ma nemmeno si può dire che i
  // limiti siano rispettati: non sono stati verificati, e va detto
  // (Ruling R8) — un «ok» qui sarebbe una rassicurazione falsa.
  const conLimite = servizi.filter(r => r.limiteCent != null);
  if (conLimite.length === 0) {
    controlli.push({
      codice: "limiti_non_verificati",
      esito: "avviso",
      messaggio: "Limiti non verificati: computo assente o senza voci proposte.",
    });
  } else {
    const prestazione = servizi.reduce((s, r) => s + r.importoCent, 0) + f.markupCent;
    const limite = conLimite.reduce((s, r) => s + (r.limiteCent ?? 0), 0);
    if (prestazione > limite) {
      const testo = `Le prestazioni in fattura (€ ${euro(prestazione)}) superano il limite del computo (€ ${euro(limite)})`;
      controlli.push(
        f.scavalcoLimiti
          ? {
              codice: "limite_totale",
              esito: "avviso",
              messaggio: `${testo} — scavalcato: ${f.scavalcoMotivo ?? "senza motivo indicato"}.`,
            }
          : { codice: "limite_totale", esito: "errore", messaggio: `${testo}.` }
      );
    }
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

  if (fattura.detrazioneTipo !== "nessuna") {
    if (!fattura.intestazioneCantiere) {
      errore("cantiere", "Con la detrazione la fattura deve indicare l'indirizzo del cantiere.");
    }
    const bonifico = fattura.detrazioneTipo === "ecobonus" ? "bonifico_ecobonus" : "bonifico_ristrutturazione";
    if (!fattura.diciture.includes(bonifico)) {
      errore("dicitura_bonifico", "Manca la dicitura del bonifico parlante richiesta dalla detrazione.");
    }
  }

  if (fattura.computoId == null && !fattura.scavalcoLimiti) {
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

  controlli.push(...verificaLimiti(fattura));
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
