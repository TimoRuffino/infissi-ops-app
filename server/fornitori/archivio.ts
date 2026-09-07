// L'archivio di ogni fornitore (07/09/2026, mandato della direzione: «crea
// la pagina fornitori in cui automaticamente per ogni fornitore vengono
// archiviate tutte le conf. ordine e le comunicazioni in automatico da
// Tars, da lì poi deve analizzare la conf. ordine e capire di quale
// commessa è e se non lo capisce deve dirlo e va collegata a mano, così che
// una volta collegata compaia nella commessa e da lì si ricavi poi il costo
// fornitore, stessa cosa per il prodotto in magazzino»).
//
// L'archivio è un INDICE sulle comunicazioni, non una seconda copia dei
// byte: le conferme vivono già come allegati delle mail (e nello storage).
// Qui si registra, per ogni fornitore, quale conferma è arrivata, che cosa
// ha capito la lettura e dove è finita. Tre stati soli:
//
//   da_collegare → la commessa non è certa: il motivo è scritto, e decide
//                  una persona scegliendo fra i candidati o cercandola;
//   collegata    → la conferma è nel fascicolo della commessa; da lì la
//                  regola di dominio (`commesse/costoDaConferma.ts`) fa
//                  nascere il costo fornitore e la consegna a magazzino;
//   scartata     → non è una conferma da collegare (listino, spam, copia):
//                  resta a registro con chi l'ha scartata.
//
// Chi decide la commessa è il riscontro deterministico del testo
// (`tars/documenti/ricercaCommessaNelDocumento.ts`), mai il modello: il
// modello al massimo trascrive una scansione, e la trascrizione passa dagli
// stessi controlli.

import { fornitoreNoto, normalizzaFornitore, FORNITORI_NOTI } from "@shared/fornitori";
import { persistedStore } from "../_core/persistence";
import { leggiAllegatoRaw } from "../comunicazioni/allegati";
import { caselle } from "../comunicazioni/caselle";
import { getUtentiStore } from "../routers/utenti";
import {
  getLiveComunicazione,
  listComunicazioniConAllegatiCandidati,
  setMatchComunicazione,
  type Comunicazione,
} from "../comunicazioni/comunicazioni";
import { getCommesseStore, getCommessaById } from "../routers/commesse";
import {
  archiviaAllegatoComunicazione,
  findDocumentoComunicazione,
  getDocumentoCommessaById,
  type Documento,
} from "../routers/preventiviContratti";
import { nomeDaConferma } from "../tars/documenti/confermeMancanti";
import {
  creaLettoreCommessaNelDocumento,
  type CommessaRicercabile,
  type FonteTesto,
  type LettoreCommessaNelDocumento,
} from "../tars/documenti/ricercaCommessaNelDocumento";
import { linkComunicazione } from "../tars/smistamento/segnali";

/** Cosa ha capito la lettura del documento sulla commessa. */
export type EsitoLetturaArchivio =
  | "unica"
  | "ambigua"
  | "nessuna"
  | "non_leggibile"
  | "non_letto";

export type CandidatoArchivio = {
  commessaId: number;
  codice: string | null;
  cliente: string | null;
  prove: string[];
  forza: "forte" | "debole";
};

export type LetturaArchivio = {
  quando: string;
  fonteTesto: FonteTesto;
  esito: EsitoLetturaArchivio;
  /** La commessa quando è una sola; null in tutti gli altri casi. */
  commessaId: number | null;
  candidati: CandidatoArchivio[];
  /** Detto a parole: perché è certa, perché è ambigua, perché non si legge. */
  motivo: string;
  numeroOrdine: string | null;
};

export type StatoVoceArchivio = "da_collegare" | "collegata" | "scartata";

export type VoceArchivioFornitore = {
  id: number;
  sedeId: number;
  /** Nome aziendale del fornitore (`shared/fornitori`) o il nome letto. */
  fornitore: string;
  comunicazioneId: number;
  allegatoIndex: number;
  nomeFile: string;
  mimeType: string;
  mittente: string;
  oggetto: string;
  ricevutaIl: string;
  lettura: LetturaArchivio | null;
  stato: StatoVoceArchivio;
  commessaId: number | null;
  documentoId: number | null;
  /** Perché è stata collegata o scartata, e da chi. */
  motivoDecisione: string | null;
  decisaDa: number | null;
  decisaAt: string | null;
  createdAt: Date;
  updatedAt: Date;
};

let nextId = 1;
const _store = persistedStore<VoceArchivioFornitore>("fornitori_archivio", loaded => {
  nextId = loaded.length ? Math.max(...loaded.map(v => v.id)) + 1 : 1;
});
const voci = _store.items;

export function getArchivioFornitoriStore(): readonly VoceArchivioFornitore[] {
  return voci;
}

/** Solo per i test. */
export function azzeraArchivioFornitoriPerTest(): void {
  voci.splice(0, voci.length);
  nextId = 1;
}

export function voceArchivioDiAllegato(
  sedeId: number,
  comunicazioneId: number,
  allegatoIndex: number
): VoceArchivioFornitore | null {
  return (
    voci.find(
      v =>
        v.sedeId === sedeId &&
        v.comunicazioneId === comunicazioneId &&
        v.allegatoIndex === allegatoIndex
    ) ?? null
  );
}

export function voceArchivioById(id: number, sedeId: number): VoceArchivioFornitore | null {
  return voci.find(v => v.id === id && v.sedeId === sedeId) ?? null;
}

/**
 * Il fornitore non si sa ancora: la conferma è arrivata da dentro casa (un
 * inoltro dell'ufficio) o da un mittente che non dice chi è. La voce resta
 * in archivio sotto questo nome finché la lettura del documento non trova
 * il fornitore vero (07/09/2026: 129 conferme erano finite sotto
 * «ruffinogroup.it», che è il NOSTRO dominio).
 */
export const FORNITORE_DA_RICONOSCERE = "Da riconoscere";

/** I domini di casa: caselle della sede e indirizzi delle persone. */
export function dominiInterni(sedeId: number): Set<string> {
  const domini = new Set<string>();
  const aggiungi = (email: unknown) => {
    const valore = String(email ?? "").trim().toLowerCase();
    const at = valore.lastIndexOf("@");
    if (at > 0) domini.add(valore.slice(at + 1));
  };
  for (const c of caselle as any[]) if (c.sedeId === sedeId) aggiungi(c.indirizzo);
  for (const u of getUtentiStore() as any[]) if (u.attivo !== false) aggiungi(u.email);
  return domini;
}

/**
 * Il fornitore di una comunicazione: il nome aziendale quando lo si
 * riconosce (dal mittente o dal suo dominio), altrimenti — solo se la mail
 * porta davvero una conferma — il nome del mittente ripulito o il suo
 * dominio. Un mittente INTERNO non è mai un fornitore: la conferma che
 * inoltra è di qualcun altro, e chi sia lo dirà la lettura del file.
 * Null = non è un fornitore, la mail resta fuori dall'archivio.
 */
export function fornitoreDiComunicazione(
  c: {
    mittente: string;
    mittenteNome?: string | null;
    allegati: ReadonlyArray<{ nome: string; mimeType: string }>;
  },
  interni?: ReadonlySet<string>
): string | null {
  const noto = fornitoreNoto(c.mittenteNome ?? null, c.mittente) ?? fornitoreNoto(c.mittente);
  if (noto) return noto;
  const portaConferma = c.allegati.some(a => nomeDaConferma(a.nome, a.mimeType) != null);
  if (!portaConferma) return null;
  const at = c.mittente.lastIndexOf("@");
  const dominio = at > 0 ? c.mittente.slice(at + 1).toLowerCase().replace(/^www\./, "") : "";
  if (interni?.has(dominio)) return FORNITORE_DA_RICONOSCERE;
  const dalNome = normalizzaFornitore(c.mittenteNome ?? null, c.mittente);
  if (dalNome) return dalNome;
  return dominio ? dominio.slice(0, 60) : FORNITORE_DA_RICONOSCERE;
}

/** Le chiavi con cui cercare le comunicazioni di un fornitore fra i mittenti. */
export function chiaviRicercaFornitore(fornitore: string): string[] {
  const noto = FORNITORI_NOTI.find(f => f.nome === fornitore);
  if (noto) return [...noto.chiavi];
  return [fornitore];
}

// ── Il giro: scansione, lettura, decisione ─────────────────────────────────

export type DipendenzeArchivioFornitori = {
  /** Le comunicazioni in ingresso con allegati candidati (18 mesi). */
  comunicazioni: (sedeId: number) => Promise<Comunicazione[]>;
  /** Le commesse della sede: il testo del documento si confronta con queste. */
  commesse: (sedeId: number) => CommessaRicercabile[];
  /** Legge il file e cerca la commessa dentro (memoria e tetto suoi). */
  cerca: LettoreCommessaNelDocumento;
  leggiRaw: typeof leggiAllegatoRaw;
  giaArchiviato: typeof findDocumentoComunicazione;
  archivia: typeof archiviaAllegatoComunicazione;
  collegaMail: typeof setMatchComunicazione;
  documento: (documentoId: number, sedeId: number) => Documento | null;
  /** I domini di casa: un inoltro interno non fa di noi un fornitore. */
  dominiInterni: (sedeId: number) => ReadonlySet<string>;
  adesso: () => Date;
};

export function dipendenzeArchivioFornitoriReali(
  sedeId: number,
  opzioni?: { massimoLetture?: number }
): DipendenzeArchivioFornitori {
  return {
    comunicazioni: sede =>
      listComunicazioniConAllegatiCandidati({ sedeId: sede, giorniIndietro: 540, limite: 1500 }),
    commesse: sede =>
      (getCommesseStore() as any[]).filter(c => c.sedeId === sede) as CommessaRicercabile[],
    cerca: creaLettoreCommessaNelDocumento({
      // Le scansioni le trascrive il modello, a nome della sede: è lo stesso
      // percorso del worker delle conferme, con lo stesso tetto per giro.
      visione: { sedeId, utenteId: 0 },
      massimoLetture: opzioni?.massimoLetture ?? 8,
    }),
    leggiRaw: leggiAllegatoRaw,
    giaArchiviato: findDocumentoComunicazione,
    archivia: archiviaAllegatoComunicazione,
    collegaMail: setMatchComunicazione,
    documento: (documentoId, sede) => getDocumentoCommessaById(documentoId, sede),
    dominiInterni,
    adesso: () => new Date(),
  };
}

export type EsitoGiroArchivio = {
  sedeId: number;
  /** Voci nuove entrate in archivio in questo giro. */
  nuove: number;
  lette: number;
  collegateDaSole: number;
  daCollegare: number;
  nonLeggibili: number;
  errori: number;
};

const NOTA_COLLEGAMENTO_AUTOMATICO =
  "Collegata da sola dall'archivio fornitori: il testo della conferma cita questa commessa e nessun'altra.";

function candidatiLeggibili(
  candidati: ReadonlyArray<{ commessaId: number; prove: string[]; forza: "forte" | "debole" }>,
  commesse: readonly CommessaRicercabile[]
): CandidatoArchivio[] {
  return candidati.slice(0, 6).map(c => {
    const commessa = commesse.find(x => x.id === c.commessaId) ?? null;
    return {
      commessaId: c.commessaId,
      codice: commessa?.codice ?? null,
      cliente: commessa?.cliente ?? null,
      prove: c.prove,
      forza: c.forza,
    };
  });
}

/**
 * Un giro dell'archivio per una sede: mette in archivio le conferme dei
 * fornitori arrivate per mail, le legge, e collega da sola quelle la cui
 * commessa è una sola. Non lancia: ogni voce che fallisce resta con il suo
 * motivo e il giro prosegue.
 */
export async function eseguiGiroArchivioFornitori(input: {
  sedeId: number;
  deps?: DipendenzeArchivioFornitori;
  /** Quante voci NUOVE leggere in questo giro (il lettore ha il suo tetto). */
  limite?: number;
}): Promise<EsitoGiroArchivio> {
  const deps = input.deps ?? dipendenzeArchivioFornitoriReali(input.sedeId);
  const esito: EsitoGiroArchivio = {
    sedeId: input.sedeId,
    nuove: 0,
    lette: 0,
    collegateDaSole: 0,
    daCollegare: 0,
    nonLeggibili: 0,
    errori: 0,
  };
  const comunicazioni = await deps.comunicazioni(input.sedeId);
  const commesse = deps.commesse(input.sedeId);
  const interni = deps.dominiInterni(input.sedeId);
  const adesso = deps.adesso();

  // 1. Scansione: ogni allegato «da conferma» di un fornitore entra in
  //    archivio una volta sola.
  const daLeggere: Array<{ voce: VoceArchivioFornitore; comunicazione: Comunicazione }> = [];
  for (const c of comunicazioni) {
    const fornitore = fornitoreDiComunicazione(c, interni);
    if (!fornitore) continue;
    for (const [indice, allegato] of c.allegati.entries()) {
      if (!nomeDaConferma(allegato.nome, allegato.mimeType)) continue;
      let voce = voceArchivioDiAllegato(input.sedeId, c.id, indice);
      if (!voce) {
        voce = {
          id: nextId++,
          sedeId: input.sedeId,
          fornitore,
          comunicazioneId: c.id,
          allegatoIndex: indice,
          nomeFile: allegato.nome,
          mimeType: allegato.mimeType,
          mittente: c.mittenteNome?.trim() || c.mittente,
          oggetto: c.oggetto ?? "",
          ricevutaIl: c.receivedAt.toISOString(),
          lettura: null,
          stato: "da_collegare",
          commessaId: null,
          documentoId: null,
          motivoDecisione: null,
          decisaDa: null,
          decisaAt: null,
          createdAt: adesso,
          updatedAt: adesso,
        };
        voci.push(voce);
        esito.nuove += 1;
      } else if (
        voce.fornitore !== fornitore &&
        // Un nome trovato nel documento vale più di quello del mittente: non
        // si torna a «Da riconoscere» né al dominio di casa.
        (fornitore !== FORNITORE_DA_RICONOSCERE || voce.lettura == null)
      ) {
        voce.fornitore = fornitore;
        voce.updatedAt = adesso;
      }
      // Già nel fascicolo (archiviata da un'altra strada): l'archivio lo
      // registra invece di riproporla.
      const documento = deps.giaArchiviato(input.sedeId, c.id, indice);
      if (documento) {
        if (voce.stato !== "collegata" || voce.documentoId !== documento.id) {
          voce.stato = "collegata";
          voce.commessaId = documento.commessaId;
          voce.documentoId = documento.id;
          voce.motivoDecisione =
            voce.motivoDecisione ?? "Già nel fascicolo della commessa quando l'archivio l'ha vista.";
          voce.updatedAt = adesso;
        }
        continue;
      }
      if (voce.stato === "scartata") continue;
      if (voce.lettura == null) daLeggere.push({ voce, comunicazione: c });
    }
  }

  // 2. Lettura e decisione, poche per giro.
  const limite = input.limite ?? 10;
  for (const { voce, comunicazione } of daLeggere.slice(0, limite)) {
    try {
      const ricerca = await deps.cerca(
        {
          sedeId: input.sedeId,
          comunicazioneId: voce.comunicazioneId,
          allegatoIndex: voce.allegatoIndex,
          leggi: () => deps.leggiRaw(comunicazione, voce.allegatoIndex),
        },
        commesse
      );
      if (ricerca.esito === "non_letto") continue; // tetto del lettore: al prossimo giro
      esito.lette += 1;
      voce.lettura = {
        quando: adesso.toISOString(),
        fonteTesto: ricerca.fonteTesto,
        esito: ricerca.esito,
        commessaId: ricerca.commessaId,
        candidati: candidatiLeggibili(ricerca.candidati, commesse),
        motivo: ricerca.motivo,
        numeroOrdine: ricerca.riferimentoOrdine,
      };
      // Il fornitore vero è quello scritto nel documento, non il mittente.
      if (ricerca.fornitore) {
        const meglio = normalizzaFornitore(ricerca.fornitore);
        if (meglio) voce.fornitore = meglio;
      }
      voce.updatedAt = adesso;
      if (ricerca.esito === "non_leggibile") esito.nonLeggibili += 1;

      // La commessa è una sola: si collega da sola, e da lì nascono costo e
      // merce (regola del fascicolo). Tutto il resto resta da collegare.
      const commessa =
        ricerca.esito === "unica" && ricerca.commessaId != null
          ? commesse.find(c => c.id === ricerca.commessaId && !c.archivedAt)
          : null;
      if (!commessa) {
        esito.daCollegare += 1;
        continue;
      }
      const collegata = await collegaAllaCommessa({
        voce,
        comunicazione,
        commessaId: commessa.id,
        clienteId: (commessa as any).clienteId ?? null,
        origine: "automatico",
        nota: `${NOTA_COLLEGAMENTO_AUTOMATICO} ${ricerca.motivo}`,
        motivoMail: `Conferma d'ordine collegata dall'archivio fornitori: ${ricerca.motivo}`,
        createdBy: null,
        utenteId: null,
        deps,
        adesso,
      });
      if (collegata) esito.collegateDaSole += 1;
      else esito.errori += 1;
    } catch (errore) {
      esito.errori += 1;
      voce.lettura = {
        quando: adesso.toISOString(),
        fonteTesto: "nessuna",
        esito: "non_leggibile",
        commessaId: null,
        candidati: [],
        motivo: `Lettura fallita: ${errore instanceof Error ? errore.message.slice(0, 160) : "errore"}`,
        numeroOrdine: null,
      };
      voce.updatedAt = adesso;
    }
  }
  _store.save();
  return esito;
}

/** Archivia l'allegato nel fascicolo e aggiorna la voce. Non lancia: dice se ha fatto. */
async function collegaAllaCommessa(input: {
  voce: VoceArchivioFornitore;
  comunicazione: Comunicazione;
  commessaId: number;
  clienteId: number | null;
  origine: "automatico" | "fornitori";
  nota: string;
  motivoMail: string;
  createdBy: number | null;
  utenteId: number | null;
  deps: DipendenzeArchivioFornitori;
  adesso: Date;
}): Promise<boolean> {
  const { voce, deps } = input;
  try {
    const raw = await deps.leggiRaw(input.comunicazione, voce.allegatoIndex);
    const documento = await deps.archivia({
      sedeId: voce.sedeId,
      comunicazioneId: voce.comunicazioneId,
      allegatoIndex: voce.allegatoIndex,
      commessaId: input.commessaId,
      nome: raw.nome,
      tipo: "conferma_ordine",
      mimeType: raw.mimeType,
      buffer: raw.buffer,
      createdBy: input.createdBy,
      note: input.nota.slice(0, 300),
      vietaRiassegnazione: true,
      origine: input.origine,
    });
    // La mail «di nessuno» diventa della commessa: si vede nei Messaggi e
    // nella scheda, con il motivo scritto.
    if (input.comunicazione.commessaId == null) {
      await deps.collegaMail(voce.comunicazioneId, voce.sedeId, {
        clienteId: input.clienteId ?? input.comunicazione.clienteId ?? null,
        commessaId: input.commessaId,
        confidenza: "alta",
        motivo: input.motivoMail.slice(0, 300),
      });
    }
    voce.stato = "collegata";
    voce.commessaId = input.commessaId;
    voce.documentoId = documento.id;
    voce.motivoDecisione = input.nota.slice(0, 300);
    voce.decisaDa = input.utenteId;
    voce.decisaAt = input.adesso.toISOString();
    voce.updatedAt = input.adesso;
    return true;
  } catch (errore) {
    voce.motivoDecisione = `Collegamento non riuscito: ${
      errore instanceof Error ? errore.message.slice(0, 200) : "errore"
    }`;
    voce.updatedAt = input.adesso;
    return false;
  }
}

// ── Decisioni di una persona ───────────────────────────────────────────────

export type EsitoCollegamentoArchivio = {
  voce: VoceArchivioFornitore;
  documentoId: number;
  commessaId: number;
  /** Cosa è nato nel fascicolo: il costo e la consegna della regola di dominio. */
  costo: { stato: string; importo: number | null } | null;
  consegne: number;
};

/**
 * «È di questa commessa»: la persona sceglie, la conferma entra nel
 * fascicolo e da lì la regola di dominio fa nascere costo e merce. Lancia
 * un errore leggibile quando non si può fare.
 */
export async function collegaVoceArchivio(input: {
  voceId: number;
  commessaId: number;
  sedeId: number;
  utenteId: number;
  nomeUtente: string;
  deps?: DipendenzeArchivioFornitori;
}): Promise<EsitoCollegamentoArchivio> {
  const deps = input.deps ?? dipendenzeArchivioFornitoriReali(input.sedeId);
  const voce = voceArchivioById(input.voceId, input.sedeId);
  if (!voce) throw new Error("NOT_FOUND: conferma non trovata nell'archivio.");
  if (voce.stato === "collegata" && voce.commessaId === input.commessaId && voce.documentoId != null) {
    return riepilogoCollegamento(voce, deps);
  }
  if (voce.stato === "collegata") {
    throw new Error(
      "CONFLICT: questa conferma è già collegata a una commessa. Spostala dal fascicolo se è sbagliata."
    );
  }
  const commessa: any = getCommessaById(input.commessaId);
  if (!commessa || commessa.sedeId !== input.sedeId) {
    throw new Error("NOT_FOUND: commessa non trovata in questa sede.");
  }
  if (commessa.archivedAt) {
    throw new Error("PRECONDITION_FAILED: la commessa è archiviata: ripristinala prima di collegare.");
  }
  const comunicazione = await getLiveComunicazione(voce.comunicazioneId, input.sedeId);
  if (!comunicazione) {
    throw new Error("NOT_FOUND: la mail di questa conferma non è più disponibile.");
  }
  const adesso = deps.adesso();
  const fatto = await collegaAllaCommessa({
    voce,
    comunicazione,
    commessaId: input.commessaId,
    clienteId: commessa.clienteId ?? null,
    origine: "fornitori",
    nota: `Collegata a mano dall'archivio fornitori da ${input.nomeUtente}.`,
    motivoMail: `Conferma d'ordine collegata dall'archivio fornitori da ${input.nomeUtente}.`,
    createdBy: input.utenteId,
    utenteId: input.utenteId,
    deps,
    adesso,
  });
  _store.save();
  if (!fatto) {
    throw new Error(voce.motivoDecisione ?? "Collegamento non riuscito.");
  }
  return riepilogoCollegamento(voce, deps);
}

function riepilogoCollegamento(
  voce: VoceArchivioFornitore,
  deps: DipendenzeArchivioFornitori
): EsitoCollegamentoArchivio {
  const documento = voce.documentoId != null ? deps.documento(voce.documentoId, voce.sedeId) : null;
  const commessa: any = voce.commessaId != null ? getCommessaById(voce.commessaId) : null;
  const costo = (commessa?.costi ?? []).find((c: any) => c.documentoId === voce.documentoId) ?? null;
  const lettura = documento?.letturaCosto ?? null;
  return {
    voce,
    documentoId: voce.documentoId!,
    commessaId: voce.commessaId!,
    costo: costo
      ? { stato: "registrato", importo: Number(costo.importo) }
      : lettura
        ? { stato: lettura.esito, importo: lettura.imponibile }
        : null,
    consegne: lettura?.merce?.righe ?? 0,
  };
}

/** «Non è una conferma da collegare»: resta a registro, con chi l'ha detto. */
export function scartaVoceArchivio(input: {
  voceId: number;
  sedeId: number;
  utenteId: number;
  nomeUtente: string;
  motivo?: string | null;
}): VoceArchivioFornitore {
  const voce = voceArchivioById(input.voceId, input.sedeId);
  if (!voce) throw new Error("NOT_FOUND: conferma non trovata nell'archivio.");
  if (voce.stato === "collegata") {
    throw new Error("CONFLICT: è già nel fascicolo di una commessa: toglila da lì.");
  }
  voce.stato = "scartata";
  voce.motivoDecisione = `${input.motivo?.trim() || "Non è una conferma da collegare"} — ${input.nomeUtente}.`.slice(0, 300);
  voce.decisaDa = input.utenteId;
  voce.decisaAt = new Date().toISOString();
  voce.updatedAt = new Date();
  _store.save();
  return voce;
}

/** Una voce scartata torna in coda: la si era chiusa per sbaglio. */
export function riapriVoceArchivio(input: {
  voceId: number;
  sedeId: number;
}): VoceArchivioFornitore {
  const voce = voceArchivioById(input.voceId, input.sedeId);
  if (!voce) throw new Error("NOT_FOUND: conferma non trovata nell'archivio.");
  if (voce.stato === "collegata") {
    throw new Error("CONFLICT: è nel fascicolo di una commessa.");
  }
  voce.stato = "da_collegare";
  voce.motivoDecisione = null;
  voce.decisaDa = null;
  voce.decisaAt = null;
  voce.updatedAt = new Date();
  _store.save();
  return voce;
}

/** Rilegge il file di una voce: utile dopo una correzione dell'estrattore. */
export async function rileggiVoceArchivio(input: {
  voceId: number;
  sedeId: number;
  deps?: DipendenzeArchivioFornitori;
}): Promise<VoceArchivioFornitore> {
  const deps = input.deps ?? dipendenzeArchivioFornitoriReali(input.sedeId, { massimoLetture: 1 });
  const voce = voceArchivioById(input.voceId, input.sedeId);
  if (!voce) throw new Error("NOT_FOUND: conferma non trovata nell'archivio.");
  const comunicazione = await getLiveComunicazione(voce.comunicazioneId, input.sedeId);
  if (!comunicazione) throw new Error("NOT_FOUND: la mail di questa conferma non è più disponibile.");
  const commesse = deps.commesse(input.sedeId);
  const ricerca = await deps.cerca(
    {
      sedeId: input.sedeId,
      comunicazioneId: voce.comunicazioneId,
      allegatoIndex: voce.allegatoIndex,
      leggi: () => deps.leggiRaw(comunicazione, voce.allegatoIndex),
    },
    commesse
  );
  voce.lettura = {
    quando: deps.adesso().toISOString(),
    fonteTesto: ricerca.fonteTesto,
    esito: ricerca.esito === "non_letto" ? "non_leggibile" : ricerca.esito,
    commessaId: ricerca.commessaId,
    candidati: candidatiLeggibili(ricerca.candidati, commesse),
    motivo: ricerca.motivo,
    numeroOrdine: ricerca.riferimentoOrdine,
  };
  voce.updatedAt = deps.adesso();
  _store.save();
  return voce;
}

// ── Proiezioni per la pagina ───────────────────────────────────────────────

export type RiepilogoFornitore = {
  fornitore: string;
  daCollegare: number;
  collegate: number;
  scartate: number;
  /** L'ultima conferma vista, per ordinare l'elenco. */
  ultimaIl: string | null;
};

export function riepilogoFornitori(sedeId: number): RiepilogoFornitore[] {
  const mappa = new Map<string, RiepilogoFornitore>();
  for (const v of voci) {
    if (v.sedeId !== sedeId) continue;
    const riga =
      mappa.get(v.fornitore) ??
      ({ fornitore: v.fornitore, daCollegare: 0, collegate: 0, scartate: 0, ultimaIl: null } as RiepilogoFornitore);
    if (v.stato === "da_collegare") riga.daCollegare += 1;
    else if (v.stato === "collegata") riga.collegate += 1;
    else riga.scartate += 1;
    if (!riga.ultimaIl || v.ricevutaIl > riga.ultimaIl) riga.ultimaIl = v.ricevutaIl;
    mappa.set(v.fornitore, riga);
  }
  return [...mappa.values()].sort(
    (a, b) =>
      b.daCollegare - a.daCollegare ||
      String(b.ultimaIl ?? "").localeCompare(String(a.ultimaIl ?? "")) ||
      a.fornitore.localeCompare(b.fornitore)
  );
}

export type ConfermaArchivio = VoceArchivioFornitore & {
  /** La commessa collegata, quando c'è: per mostrarla senza un secondo giro. */
  commessa: { id: number; codice: string | null; cliente: string | null; stato: string } | null;
  link: string;
  fileLink: string | null;
};

export function confermeArchivio(input: {
  sedeId: number;
  fornitore?: string | null;
  stato?: StatoVoceArchivio | null;
  limite?: number;
}): ConfermaArchivio[] {
  const ordine: Record<StatoVoceArchivio, number> = { da_collegare: 0, collegata: 1, scartata: 2 };
  return voci
    .filter(v => v.sedeId === input.sedeId)
    .filter(v => (input.fornitore ? v.fornitore === input.fornitore : true))
    .filter(v => (input.stato ? v.stato === input.stato : true))
    .sort(
      (a, b) =>
        ordine[a.stato] - ordine[b.stato] || b.ricevutaIl.localeCompare(a.ricevutaIl) || b.id - a.id
    )
    .slice(0, input.limite ?? 200)
    .map(v => {
      const commessa: any = v.commessaId != null ? getCommessaById(v.commessaId) : null;
      return {
        ...v,
        commessa: commessa
          ? {
              id: commessa.id,
              codice: commessa.codice ?? null,
              cliente: commessa.cliente ?? null,
              stato: String(commessa.stato ?? ""),
            }
          : null,
        link: `/messaggi/email?messaggio=${v.comunicazioneId}`,
        fileLink: v.documentoId != null ? `/api/documenti/${v.documentoId}/file` : null,
      };
    });
}

export { linkComunicazione };
