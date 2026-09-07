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
import { getMagazzinoStore, prodottiDelDocumento } from "../routers/magazzino";
import {
  archiviaAllegatoComunicazione,
  documentiDiSede,
  findDocumentoComunicazione,
  getDocumentoCommessaById,
  type Documento,
} from "../routers/preventiviContratti";
import { estraiConfermeNelDocumento } from "../documenti/estrazioneConferma";
import { estraiRigheMerce } from "../documenti/estrazioneMerce";
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
  /**
   * Che cosa porta la conferma, letto nello stesso giro: serve a decidere
   * PRIMA di collegare, e al magazzino per sapere che merce aspetta
   * (07/09/2026). Sono valori indicativi: quelli autorevoli nascono quando
   * la conferma entra nel fascicolo (§54.7).
   */
  imponibile: number | null;
  articoli: Array<{ nome: string; quantita: number }>;
  dataConsegna: string | null;
  settimanaConsegna: number | null;
  settimanaApprontamento: number | null;
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

/**
 * Che cosa porta la conferma, dalle pagine già lette: imponibile, articoli
 * e data di consegna. Nessuna lettura in più, nessuna scrittura: serve a
 * decidere prima di collegare e a far sapere al magazzino cosa aspetta.
 */
function contenutoDellaConferma(pagine: readonly string[] | null): {
  imponibile: number | null;
  articoli: Array<{ nome: string; quantita: number }>;
  dataConsegna: string | null;
  settimanaConsegna: number | null;
  settimanaApprontamento: number | null;
} {
  if (!pagine || pagine.length === 0) {
    return {
      imponibile: null,
      articoli: [],
      dataConsegna: null,
      settimanaConsegna: null,
      settimanaApprontamento: null,
    };
  }
  try {
    const { estrazione } = estraiConfermeNelDocumento(pagine, {
      codiceOrdine: null,
      fornitoreNome: null,
      righeOrdine: [],
    });
    return {
      imponibile: estrazione.imponibileDocumento?.valore ?? null,
      articoli: estraiRigheMerce(pagine)
        .slice(0, 12)
        .map(r => ({ nome: r.nome, quantita: r.quantita })),
      dataConsegna: estrazione.dateConsegna[0]?.valore ?? null,
      settimanaConsegna: estrazione.settimaneConsegna[0]?.valore ?? null,
      settimanaApprontamento: estrazione.settimaneApprontamento?.[0]?.valore ?? null,
    };
  } catch {
    return {
      imponibile: null,
      articoli: [],
      dataConsegna: null,
      settimanaConsegna: null,
      settimanaApprontamento: null,
    };
  }
}

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
      const contenutoDelleP = contenutoDellaConferma(ricerca.pagine);
      voce.lettura = {
        quando: adesso.toISOString(),
        fonteTesto: ricerca.fonteTesto,
        esito: ricerca.esito,
        commessaId: ricerca.commessaId,
        candidati: candidatiLeggibili(ricerca.candidati, commesse),
        motivo: ricerca.motivo,
        numeroOrdine: ricerca.riferimentoOrdine,
        ...contenutoDelleP,
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
        ...contenutoDellaConferma(null),
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
    ...contenutoDellaConferma(ricerca.pagine),
  };
  voce.updatedAt = deps.adesso();
  _store.save();
  return voce;
}

// ── Proiezioni per la pagina ───────────────────────────────────────────────

export type RiepilogoFornitore = {
  fornitore: string;
  /** Chiede una mano: incerte più quelle senza nessun indizio. */
  daCollegare: number;
  incerte: number;
  /** Collegate da Tars da sole, e messe nel fascicolo per altra via. */
  collegateTars: number;
  nelFascicolo: number;
  scartate: number;
  /** Il magazzino: consegne attese da questo fornitore, e quante in ritardo. */
  inArrivo: number;
  inRitardo: number;
  /** L'ultima conferma vista, per ordinare l'elenco. */
  ultimaIl: string | null;
};

export function riepilogoFornitori(sedeId: number): RiepilogoFornitore[] {
  const mappa = new Map<string, RiepilogoFornitore>();
  const vuoto = (fornitore: string): RiepilogoFornitore => ({
    fornitore,
    daCollegare: 0,
    incerte: 0,
    collegateTars: 0,
    nelFascicolo: 0,
    scartate: 0,
    inArrivo: 0,
    inRitardo: 0,
    ultimaIl: null,
  });
  // L'elenco unico, senza tetto: il riepilogo conta tutto quello che c'è.
  for (const conferma of confermeDiSede({ sedeId, limite: Number.MAX_SAFE_INTEGER })) {
    const riga = mappa.get(conferma.fornitore) ?? vuoto(conferma.fornitore);
    if (conferma.gruppo === "da_collegare") riga.daCollegare += 1;
    else if (conferma.gruppo === "incerta") riga.incerte += 1;
    else if (conferma.gruppo === "scartata") riga.scartate += 1;
    else if (conferma.gruppo === "collegata_tars") riga.collegateTars += 1;
    else riga.nelFascicolo += 1;
    if (!riga.ultimaIl || conferma.quando > riga.ultimaIl) riga.ultimaIl = conferma.quando;
    mappa.set(conferma.fornitore, riga);
  }
  for (const [fornitore, conteggio] of inArrivoPerFornitore(sedeId)) {
    const riga = mappa.get(fornitore) ?? vuoto(fornitore);
    riga.inArrivo = conteggio.attese;
    riga.inRitardo = conteggio.inRitardo;
    mappa.set(fornitore, riga);
  }
  return [...mappa.values()].sort(
    (a, b) =>
      b.daCollegare + b.incerte - (a.daCollegare + a.incerte) ||
      b.inRitardo - a.inRitardo ||
      String(b.ultimaIl ?? "").localeCompare(String(a.ultimaIl ?? "")) ||
      a.fornitore.localeCompare(b.fornitore)
  );
}

export { linkComunicazione };

// ── L'elenco unico delle conferme d'ordine ────────────────────────────────
// «La pagina fornitori e conferme d'ordine devono essere insieme»
// (direzione, 07/09/2026). Una conferma d'ordine può entrare da due porte:
// dall'archivio (mail del fornitore, la mette Tars) o dal fascicolo (caricata
// a mano, da FiC, dallo smistamento). L'elenco le mostra una volta sola,
// raggruppate per quello che serve decidere.

export type GruppoConferma =
  /** Tars l'ha collegata da solo: il testo cita una commessa e una sola. */
  | "collegata_tars"
  /** Nel fascicolo per altra via: caricata a mano, da FiC, dallo smistamento. */
  | "nel_fascicolo"
  /** Ha dei candidati ma nessuna certezza: sceglie una persona. */
  | "incerta"
  /** Non si capisce di chi è: va collegata a mano. */
  | "da_collegare"
  /** Non è una conferma da collegare (listino, spam, copia). */
  | "scartata";

export type MerceDiConferma = {
  /** Le consegne vere a magazzino (nascono quando la conferma è nel fascicolo). */
  consegne: number;
  articoli: number;
  dataConsegna: string | null;
  prontaDal: string | null;
  ricevute: number;
  /** Quello che la lettura ha visto nel PDF, anche prima di collegarla. */
  articoliLetti: Array<{ nome: string; quantita: number }>;
};

export type ConfermaUnificata = {
  /** Chiave stabile per React: «voce:12» o «doc:34». */
  chiave: string;
  voceId: number | null;
  documentoId: number | null;
  comunicazioneId: number | null;
  allegatoIndex: number | null;
  fornitore: string;
  nome: string;
  mimeType: string;
  /** Data della mail, o del caricamento per i documenti del fascicolo. */
  quando: string;
  mittente: string | null;
  oggetto: string | null;
  gruppo: GruppoConferma;
  /** Perché sta in quel gruppo, detto a parole. */
  motivo: string | null;
  candidati: CandidatoArchivio[];
  numeroOrdine: string | null;
  fonteTesto: FonteTesto | null;
  commessa: { id: number; codice: string | null; cliente: string | null; stato: string } | null;
  costo: { stato: string; importo: number | null };
  merce: MerceDiConferma;
  origine: string | null;
  archiviatoDa: string | null;
  decisaDa: string | null;
  /** Una persona può dire «è di questa commessa» quando il testo non la cita. */
  daConfermare: boolean;
  /** Sempre apribile: il documento del fascicolo o l'allegato della mail. */
  fileUrl: string;
  mailUrl: string | null;
  /** Le pagine rese: se ci sono, l'anteprima è un'immagine, non un iframe. */
  pagineAnteprima: number;
};

function nomiUtenti(): Map<number, string> {
  const mappa = new Map<number, string>();
  for (const u of getUtentiStore() as any[]) {
    const nome = `${u.nome ?? ""} ${u.cognome ?? ""}`.trim();
    if (nome) mappa.set(u.id, nome);
  }
  return mappa;
}

function commessaLeggibile(
  id: number | null | undefined
): { id: number; codice: string | null; cliente: string | null; stato: string } | null {
  if (id == null) return null;
  const c: any = getCommessaById(id);
  if (!c) return null;
  return {
    id: c.id,
    codice: c.codice ?? null,
    cliente: c.cliente ?? null,
    stato: String(c.stato ?? ""),
  };
}

function costoDelDocumento(
  documentoId: number | null,
  commessaId: number | null,
  documento: Documento | null
): { stato: string; importo: number | null } {
  if (documentoId == null || commessaId == null) return { stato: "in_attesa", importo: null };
  const commessa: any = getCommessaById(commessaId);
  const costo = (commessa?.costi ?? []).find((c: any) => c.documentoId === documentoId) ?? null;
  if (costo) return { stato: "registrato", importo: Number(costo.importo) };
  const lettura = documento?.letturaCosto ?? null;
  if (!lettura) return { stato: "in_attesa", importo: null };
  const esito = String(lettura.esito ?? "");
  // Il costo c'era e non c'è più: qualcuno l'ha tolto a mano.
  if (esito === "registrato" || esito === "collegato") {
    return { stato: "rimosso_a_mano", importo: null };
  }
  return { stato: esito, importo: null };
}

function merceDelDocumento(
  documentoId: number | null,
  lettura: LetturaArchivio | null
): MerceDiConferma {
  const righe = documentoId != null ? prodottiDelDocumento(documentoId) : [];
  return {
    consegne: righe.length,
    articoli: righe.reduce((n, p) => n + (p.articoli?.length ?? 0), 0),
    dataConsegna: righe[0]?.dataConsegna ?? lettura?.dataConsegna ?? null,
    prontaDal: righe[0]?.prontaDal ?? null,
    ricevute: righe.filter(p => p.arrivato).length,
    articoliLetti: lettura?.articoli ?? [],
  };
}

/** Il gruppo di una voce d'archivio: lo stato più quello che la lettura sa. */
function gruppoDellaVoce(voce: VoceArchivioFornitore, documento: Documento | null): GruppoConferma {
  if (voce.stato === "scartata") return "scartata";
  if (voce.stato === "collegata") {
    const origine = documento?.origine ?? null;
    return origine === "automatico" || origine === "smistamento" || voce.decisaDa == null
      ? "collegata_tars"
      : "nel_fascicolo";
  }
  return (voce.lettura?.candidati.length ?? 0) > 0 ? "incerta" : "da_collegare";
}

/** Il gruppo di un documento già nel fascicolo, senza voce d'archivio. */
function gruppoDelDocumento(documento: Documento): GruppoConferma {
  const origine = documento.origine ?? null;
  const automatico = origine === "automatico" || origine === "smistamento";
  const lettura: any = documento.letturaCosto ?? null;
  const senzaRiscontro =
    lettura?.riscontro === "senza_riscontro" && documento.riscontroConfermato !== true;
  if (senzaRiscontro) return "incerta";
  return automatico ? "collegata_tars" : "nel_fascicolo";
}

function motivoDelDocumento(documento: Documento, gruppo: GruppoConferma): string | null {
  const lettura: any = documento.letturaCosto ?? null;
  if (gruppo === "incerta") {
    return "Il testo non cita questa commessa: confermare che è la sua.";
  }
  return lettura?.motivo ?? null;
}

/**
 * L'elenco unico: le voci d'archivio più le conferme che stanno già nel
 * fascicolo senza esserci passate. Nessuna riga doppia (la voce d'archivio
 * collegata e il suo documento sono la stessa conferma).
 */
export function confermeDiSede(input: {
  sedeId: number;
  fornitore?: string | null;
  gruppo?: GruppoConferma | null;
  limite?: number;
}): ConfermaUnificata[] {
  const utenti = nomiUtenti();
  const righe: ConfermaUnificata[] = [];
  const documentiVisti = new Set<number>();

  for (const voce of voci) {
    if (voce.sedeId !== input.sedeId) continue;
    const documento =
      voce.documentoId != null ? getDocumentoCommessaById(voce.documentoId, voce.sedeId) : null;
    if (voce.documentoId != null) documentiVisti.add(voce.documentoId);
    const gruppo = gruppoDellaVoce(voce, documento);
    const lettura = voce.lettura ?? null;
    righe.push({
      chiave: `voce:${voce.id}`,
      voceId: voce.id,
      documentoId: voce.documentoId,
      comunicazioneId: voce.comunicazioneId,
      allegatoIndex: voce.allegatoIndex,
      fornitore: voce.fornitore,
      nome: voce.nomeFile,
      mimeType: voce.mimeType,
      quando: voce.ricevutaIl,
      mittente: voce.mittente,
      oggetto: voce.oggetto,
      gruppo,
      motivo: voce.motivoDecisione ?? lettura?.motivo ?? null,
      candidati: lettura?.candidati ?? [],
      numeroOrdine: lettura?.numeroOrdine ?? null,
      fonteTesto: lettura?.fonteTesto ?? null,
      commessa: commessaLeggibile(voce.commessaId),
      costo: costoDelDocumento(voce.documentoId, voce.commessaId, documento),
      merce: merceDelDocumento(voce.documentoId, lettura),
      origine: documento?.origine ?? (voce.stato === "collegata" ? "automatico" : null),
      archiviatoDa: documento?.createdBy != null ? utenti.get(documento.createdBy) ?? null : null,
      decisaDa: voce.decisaDa != null ? utenti.get(voce.decisaDa) ?? null : null,
      daConfermare:
        documento != null &&
        (documento.letturaCosto as any)?.riscontro === "senza_riscontro" &&
        documento.riscontroConfermato !== true,
      fileUrl:
        voce.documentoId != null
          ? `/api/documenti/${voce.documentoId}/file`
          : `/api/comunicazioni/${voce.comunicazioneId}/allegati/${voce.allegatoIndex}`,
      // Le conferme arrivano per mail: il link è quello del messaggio.
      mailUrl: `/messaggi/email?messaggio=${voce.comunicazioneId}`,
      pagineAnteprima: documento?.anteprime?.pagine ?? 0,
    });
  }

  for (const documento of documentiDiSede(input.sedeId)) {
    if (documento.tipo !== "conferma_ordine") continue;
    if (documentiVisti.has(documento.id)) continue;
    const gruppo = gruppoDelDocumento(documento);
    const lettura: any = documento.letturaCosto ?? null;
    righe.push({
      chiave: `doc:${documento.id}`,
      voceId: null,
      documentoId: documento.id,
      comunicazioneId: null,
      allegatoIndex: null,
      fornitore: normalizzaFornitore(lettura?.fornitore ?? null) ?? FORNITORE_DA_RICONOSCERE,
      nome: documento.nome,
      mimeType: documento.mimeType,
      quando: new Date(documento.createdAt).toISOString(),
      mittente: null,
      oggetto: documento.note ?? null,
      gruppo,
      motivo: motivoDelDocumento(documento, gruppo),
      candidati: [],
      numeroOrdine: lettura?.numeroOrdine ?? null,
      fonteTesto: lettura?.fonteTesto ?? null,
      commessa: commessaLeggibile(documento.commessaId),
      costo: costoDelDocumento(documento.id, documento.commessaId, documento),
      merce: merceDelDocumento(documento.id, null),
      origine: documento.origine ?? null,
      archiviatoDa: documento.createdBy != null ? utenti.get(documento.createdBy) ?? null : null,
      decisaDa: null,
      daConfermare: gruppo === "incerta",
      fileUrl: `/api/documenti/${documento.id}/file`,
      mailUrl: null,
      pagineAnteprima: documento.anteprime?.pagine ?? 0,
    });
  }

  // Prima quello che chiede una decisione, poi il resto dal più recente.
  const ordine: Record<GruppoConferma, number> = {
    da_collegare: 0,
    incerta: 1,
    collegata_tars: 2,
    nel_fascicolo: 3,
    scartata: 4,
  };
  return righe
    .filter(r => (input.fornitore ? r.fornitore === input.fornitore : true))
    .filter(r => (input.gruppo ? r.gruppo === input.gruppo : true))
    .sort(
      (a, b) => ordine[a.gruppo] - ordine[b.gruppo] || String(b.quando).localeCompare(String(a.quando))
    )
    .slice(0, input.limite ?? 300);
}

// ── Il magazzino visto dal fornitore ───────────────────────────────────────
// «Deve essere utile ANCHE al magazzino»: da qui si vede cosa deve ancora
// arrivare, da chi, per quale commessa, e si segna ricevuto senza girare
// commessa per commessa.

export type ConsegnaInArrivo = {
  prodottoId: number;
  fornitore: string;
  nome: string;
  quantita: number;
  articoli: Array<{ nome: string; quantita: number }>;
  dataConsegna: string | null;
  prontaDal: string | null;
  arrivato: boolean;
  numeroOrdine: string | null;
  documentoId: number | null;
  fileUrl: string | null;
  commessa: { id: number; codice: string | null; cliente: string | null; stato: string } | null;
  /** In ritardo rispetto alla data prevista, e di quanti giorni. */
  giorniDiRitardo: number;
};

export function consegneInArrivo(input: {
  sedeId: number;
  fornitore?: string | null;
  includiRicevute?: boolean;
  adesso?: Date;
}): ConsegnaInArrivo[] {
  const oggi = (input.adesso ?? new Date()).toISOString().slice(0, 10);
  const righe: ConsegnaInArrivo[] = [];
  for (const p of getMagazzinoStore()) {
    if (p.sedeId !== input.sedeId) continue;
    if (!input.includiRicevute && p.arrivato) continue;
    const fornitore = normalizzaFornitore(p.fornitore) ?? p.fornitore ?? FORNITORE_DA_RICONOSCERE;
    if (input.fornitore && fornitore !== input.fornitore) continue;
    const commessa = commessaLeggibile(p.commessaId);
    if (!commessa) continue;
    const giorni =
      !p.arrivato && p.dataConsegna && p.dataConsegna < oggi
        ? Math.max(
            0,
            Math.round(
              (Date.parse(`${oggi}T00:00:00Z`) - Date.parse(`${p.dataConsegna}T00:00:00Z`)) / 86_400_000
            )
          )
        : 0;
    righe.push({
      prodottoId: p.id,
      fornitore,
      nome: p.nome,
      quantita: p.quantita,
      articoli: (p.articoli ?? []).map(a => ({ nome: a.nome, quantita: a.quantita })),
      dataConsegna: p.dataConsegna,
      prontaDal: p.prontaDal,
      arrivato: p.arrivato,
      numeroOrdine: p.numeroOrdine,
      documentoId: p.documentoId,
      fileUrl: p.documentoId != null ? `/api/documenti/${p.documentoId}/file` : null,
      commessa,
      giorniDiRitardo: giorni,
    });
  }
  // Le date mancanti in fondo: quello che ha una data si pianifica prima.
  return righe.sort((a, b) => {
    if (a.arrivato !== b.arrivato) return a.arrivato ? 1 : -1;
    if (!a.dataConsegna && !b.dataConsegna) return a.commessa!.id - b.commessa!.id;
    if (!a.dataConsegna) return 1;
    if (!b.dataConsegna) return -1;
    return a.dataConsegna.localeCompare(b.dataConsegna);
  });
}

/** Quante consegne aspetta ogni fornitore, e quante sono già in ritardo. */
export function inArrivoPerFornitore(sedeId: number, adesso?: Date): Map<string, { attese: number; inRitardo: number }> {
  const mappa = new Map<string, { attese: number; inRitardo: number }>();
  for (const riga of consegneInArrivo({ sedeId, adesso })) {
    const corrente = mappa.get(riga.fornitore) ?? { attese: 0, inRitardo: 0 };
    corrente.attese += 1;
    if (riga.giorniDiRitardo > 0) corrente.inRitardo += 1;
    mappa.set(riga.fornitore, corrente);
  }
  return mappa;
}
