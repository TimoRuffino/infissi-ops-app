// La conferma d'ordine che entra nel fascicolo porta con sé due cose
// (direzione 03/09/2026 sera): il COSTO fornitore del margine («il costo
// deve nascere nel momento in cui la conf. ordine viene allegata alla
// commessa») e la MERCE in arrivo a magazzino («va aperto nel magazzino la
// sua commessa e compilare la merce in arrivo in base a quanto scritto
// nella conf. ordine»; una commessa può avere più conferme).
//
// Regola di dominio deterministica, come il pattuito che nasce dalla fattura
// FiC: l'importo è quello scritto nel documento (l'IMPONIBILE), le righe di
// merce sono quelle lette nel testo, lo stesso estrattore dell'analisi
// documentale. Nessun modello decide niente qui. Se l'imponibile non c'è,
// non si scorpora l'IVA per stima: il documento resta «senza imponibile» e
// la scheda lo dice; se le righe non si riconoscono, a magazzino entra una
// riga sola da completare a mano — ma la commessa compare, con la data.
//
// Due guardie aggiunte la notte del 04/09/2026, dopo il caso Giacomazzi
// (conferme archiviate dal solo oggetto della mail, e la stessa conferma
// inviata tre volte diventata tre costi):
// - RISCONTRO: una conferma archiviata da un automatismo (smistamento,
//   regola delle conferme certe) produce costo e merce solo se il suo testo
//   cita la commessa — codice, cliente, indirizzo o un ordine noto. Se non
//   la cita, si ritira ciò che era nato e si chiede a una persona.
// - DUPLICATI: due conferme con lo stesso riferimento d'ordine (nel nome
//   del file o nel testo) sono la stessa conferma: la seconda non produce
//   niente.
//
// Chi chiama: gli agganci del fascicolo (upload, archiviazione da mail,
// riclassificazione) SENZA OCR — il percorso della richiesta deve restare
// rapido — e il worker di fondo CON OCR, per le scansioni e per le conferme
// già archiviate prima di questa regola.

import { getComunicazione } from "../comunicazioni/comunicazioni";
import {
  estraiConfermeNelDocumento,
  type EstrazioneConferma,
} from "../documenti/estrazioneConferma";
import {
  dataDaSettimanaIso,
  ESTRATTORE_MERCE_VERSIONE,
  estraiRigheMerce,
} from "../documenti/estrazioneMerce";
import type { IdentitaLettura } from "../documenti/letturaVisiva";
import {
  estraiTestoDocumento,
  type EsitoParser,
  type OpzioniLettura,
} from "../documenti/parserRegistry";
import {
  riferimentiOrdineDocumento,
  riscontroCommessaNelTesto,
  stessoOrdine,
  type RiferimentiCommessa,
  type RiscontroCommessa,
} from "../documenti/riscontroCommessa";
import { getClienteById } from "../routers/clienti";
import { getCommessaById } from "../routers/commesse";
import { getOrdiniPerMargine } from "../routers/fornitori";
import { getSediStore } from "../routers/sedi";
import {
  creaProdottiDaConferma,
  getMagazzinoStore,
  isCommessaEligibleForMagazzino,
  prodottiDelDocumento,
  rimuoviProdottiDelDocumento,
} from "../routers/magazzino";
import {
  documentiDiSede,
  getDocumentiDiCommessa,
  getDocumentoRecordById,
  leggiDocumentoCommessaDaStorage,
  origineDaRecord,
  salvaLetturaCostoDocumento,
  type Documento,
} from "../routers/preventiviContratti";
import {
  aggiornaImportoCosto,
  aggiungiCosto,
  collegaCostoAlDocumento,
  costoDelDocumento,
  costoManualeCorrispondente,
  costoNatoDallaRegola,
  DESCRIZIONE_COSTO_DA_CONFERMA,
  NOTA_COSTO_DA_CONFERMA,
  riferimentoNormalizzato,
  rimuoviCostoDelDocumento,
  type CostoRegistrato,
} from "./costiRegistro";
import {
  ESITI_TERMINALI,
  TENTATIVI_MASSIMI_LETTURA,
  VERSIONE_LETTURA_COSTO,
  type EsitoLetturaCosto,
  type LetturaCostoDocumento,
  type MerceDaConferma,
} from "./letturaCostoTipi";

export type EsitoCostoDaConferma = {
  documentoId: number;
  commessaId: number | null;
  esito:
    | EsitoLetturaCosto
    /** C'era già: nessun effetto sul costo. */
    | "gia_registrato"
    /** La lettura dice «registrato» ma il costo è stato tolto a mano: si rispetta. */
    | "rimosso_a_mano"
    /** L'importo atteso da chi chiama non è quello del documento: niente. */
    | "importo_diverso"
    | "non_conferma"
    | "documento_assente"
    | "commessa_assente";
  imponibile: number | null;
  costoId: number | null;
  fonteTesto: LetturaCostoDocumento["fonteTesto"];
  motivo: string | null;
  nomeFile: string | null;
  /** Cosa è successo a magazzino in questa lettura (null = testo non letto). */
  merce: MerceDaConferma | null;
  /** Il documento di cui questa conferma è un duplicato. */
  duplicatoDi: number | null;
};

export type DipendenzeCostoDaConferma = {
  leggiDocumento: (
    documentoId: number
  ) => Promise<{ buffer: Buffer; nome: string; mimeType: string } | null>;
  /**
   * Testo del documento. `ocr` = OCR locale ammesso (worker, richiesta
   * esplicita); `visione` = identità per la lettura con il modello quando
   * l'OCR non basta (null = mai una chiamata a pagamento).
   */
  estraiTesto: (
    buffer: Buffer,
    mimeType: string,
    nome: string,
    opzioni: { ocr: boolean; visione: IdentitaLettura | null }
  ) => Promise<EsitoParser>;
  /** Il mittente della mail da cui il documento è stato archiviato: fornitore di ripiego. */
  nomeMittente: (documento: Documento) => Promise<string | null>;
  adesso: () => Date;
};

export function dipendenzeCostoDaConfermaReali(): DipendenzeCostoDaConferma {
  return {
    leggiDocumento: async documentoId => {
      const letto = await leggiDocumentoCommessaDaStorage(documentoId, null);
      if (!letto) return null;
      return {
        buffer: letto.buffer,
        nome: letto.documento.nome,
        mimeType: letto.documento.mimeType,
      };
    },
    estraiTesto: (buffer, mimeType, nome, opzioni) =>
      estraiTestoDocumento(buffer, mimeType, nome, {
        ...(opzioni.ocr ? {} : { ocr: false }),
        visione: opzioni.ocr ? opzioni.visione : null,
      }),
    nomeMittente: async documento => {
      if (documento.source !== "comunicazione" || !documento.sourceRef) return null;
      const [sede, comunicazione] = documento.sourceRef.split(":");
      const sedeId = Number(sede);
      const comunicazioneId = Number(comunicazione);
      if (!Number.isSafeInteger(sedeId) || !Number.isSafeInteger(comunicazioneId)) {
        return null;
      }
      try {
        const c = await getComunicazione(comunicazioneId, sedeId);
        return c?.mittenteNome?.trim() || null;
      } catch {
        return null;
      }
    },
    adesso: () => new Date(),
  };
}

function motivoSicuro(errore: unknown): string {
  return errore instanceof Error && errore.message
    ? errore.message.slice(0, 200)
    : "errore sconosciuto";
}

function arrotonda(valore: number): number {
  return Math.round((valore + Number.EPSILON) * 100) / 100;
}

/** «1.709,44»: scrittura italiana senza dipendere dai dati di locale di Node. */
function euro(valore: number): string {
  const [intero, decimali] = Math.abs(valore).toFixed(2).split(".");
  const conPunti = intero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${valore < 0 ? "-" : ""}${conPunti},${decimali}`;
}

/** Il documento entrato dopo nel fascicolo (a parità di istante, l'id più alto). */
function piuRecente(a: Documento, b: Documento): boolean {
  const ta = new Date(a.createdAt as any).getTime();
  const tb = new Date(b.createdAt as any).getTime();
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta > tb;
  return a.id > b.id;
}

/**
 * Il costo a registro l'ha scritto la regola e nessuna persona l'ha
 * modificato: porta descrizione e nota della regola (non è un costo manuale
 * collegato dopo) e la scheda non l'ha toccato. Solo allora una rilettura
 * migliore può correggerlo. (Non basta confrontarlo con la lettura
 * precedente: la 1.4.0 aveva già letto giusto le tre Pail a «22,00» senza
 * correggerle, e il confronto con lei le faceva sembrare modificate a mano.)
 */
function costoScrittoDallaRegola(
  costo: CostoRegistrato,
  precedente: LetturaCostoDocumento | null
): boolean {
  if (precedente?.esito === "collegato") return false;
  if (costoNatoDallaRegola(costo)) return true;
  return (
    precedente?.esito === "registrato" &&
    precedente.imponibile != null &&
    !costo.modificatoAMano &&
    Math.abs(costo.importo - precedente.imponibile) < 0.005
  );
}

/** Le archiviazioni fatte da un automatismo: qui il testo deve citare la commessa. */
export function origineAutomatica(documento: Documento): boolean {
  const origine = documento.origine ?? origineDaRecord(documento);
  return origine === "smistamento" || origine === "automatico";
}

// ── Riscontro e duplicati: condivisi con smistamento, worker e strumento ──

/** Tutto ciò che identifica una commessa dentro un documento. */
export function riferimentiDellaCommessa(commessa: any): RiferimentiCommessa {
  const riferimentiOrdine = new Set<string>();
  for (const c of Array.isArray(commessa.costi) ? commessa.costi : []) {
    if (c?.numeroOrdine) riferimentiOrdine.add(String(c.numeroOrdine));
  }
  for (const p of getMagazzinoStore()) {
    if (p.commessaId === commessa.id && p.numeroOrdine) riferimentiOrdine.add(p.numeroOrdine);
  }
  try {
    for (const o of getOrdiniPerMargine(commessa.id, commessa.sedeId ?? null)) {
      if (o.codiceOrdine) riferimentiOrdine.add(o.codiceOrdine);
    }
  } catch {
    // Il modulo ordini può non essere caricato: non è un riscontro necessario.
  }
  for (const d of getDocumentiDiCommessa(commessa.id)) {
    if (d.tipo !== "conferma_ordine") continue;
    for (const r of d.letturaCosto?.riferimenti ?? []) riferimentiOrdine.add(r);
    if (d.letturaCosto?.numeroOrdine) riferimentiOrdine.add(d.letturaCosto.numeroOrdine);
  }
  // La via dell'azienda compare in ogni conferma come destinatario: non è
  // mai la prova che il documento parla di QUESTO cantiere.
  const sede = getSediStore().find(s => s.id === commessa.sedeId);
  const paroleEscluse = String(sede?.indirizzo ?? "")
    .split(/[\s,.'’-]+/)
    .filter(p => p.length >= 3);
  // Il cognome dall'anagrafica: è la parola che identifica il cliente, i
  // nomi propri no.
  const anagrafica: any =
    Number.isInteger(commessa.clienteId) && commessa.clienteId > 0
      ? (getClienteById(commessa.clienteId) ?? null)
      : null;
  const cognome = String(anagrafica?.cognome ?? "").trim() || null;
  return {
    codice: commessa.codice ?? null,
    cliente: commessa.cliente ?? null,
    cognome,
    indirizzo: commessa.indirizzo ?? null,
    citta: commessa.citta ?? null,
    riferimentiOrdine: [...riferimentiOrdine],
    paroleEscluse,
  };
}

function riferimentiDiDocumento(documento: Documento): string[] {
  return (
    documento.letturaCosto?.riferimenti ??
    riferimentiOrdineDocumento({
      nomeFile: documento.nome,
      riferimentoOrdine: documento.letturaCosto?.numeroOrdine ?? null,
    })
  );
}

/**
 * Un'altra conferma dello stesso fascicolo che parla dello stesso ordine
 * (riferimento in comune nel nome o nel testo, oppure stesso imponibile,
 * fornitore e data) e che ha già prodotto — o avrebbe prodotto — il costo.
 */
export function confermaDuplicataNelFascicolo(input: {
  commessaId: number;
  documentoId: number | null;
  riferimenti: readonly string[];
  imponibile: number | null;
  fornitore: string | null;
  dataDocumento: string | null;
}): { documento: Documento; riferimento: string } | null {
  const commessa: any = getCommessaById(input.commessaId);
  if (!commessa) return null;
  for (const altro of getDocumentiDiCommessa(input.commessaId)) {
    if (altro.tipo !== "conferma_ordine" || altro.id === input.documentoId) continue;
    const lettura = altro.letturaCosto ?? null;
    // Un duplicato di una conferma a sua volta scartata non conta: si
    // confronta solo con chi «vale» (costo o merce a registro, o lettura che
    // li ha prodotti — anche se poi una persona li ha tolti).
    const vale =
      costoDelDocumento(commessa, altro.id) != null ||
      prodottiDelDocumento(altro.id).length > 0 ||
      lettura?.esito === "registrato" ||
      lettura?.esito === "collegato" ||
      lettura?.esito === "senza_imponibile";
    if (!vale) continue;
    const comune = stessoOrdine(riferimentiDiDocumento(altro), input.riferimenti);
    if (comune) return { documento: altro, riferimento: comune };
    if (
      input.imponibile != null &&
      lettura?.imponibile != null &&
      Math.abs(lettura.imponibile - input.imponibile) < 0.005 &&
      riferimentoNormalizzato(lettura.fornitore) === riferimentoNormalizzato(input.fornitore) &&
      (lettura.dataDocumento ?? null) === (input.dataDocumento ?? null)
    ) {
      return { documento: altro, riferimento: `imponibile ${input.imponibile}` };
    }
  }
  return null;
}

export type VerificaConfermaPerFascicolo = {
  ok: boolean;
  motivo: string;
  prove: string[];
  /** Il testo si è letto? Senza testo non si archivia da soli. */
  testoLetto: boolean;
  duplicatoDi: { documentoId: number; nome: string; riferimento: string } | null;
};

/**
 * Prima di mettere una conferma in un fascicolo DA SOLI (smistamento,
 * regola delle conferme certe, strumento Tars): il testo deve citare la
 * commessa e non deve essere una copia di una conferma già presente.
 */
export type LetturaPerVerifica = {
  /** OCR locale: assente = con i limiti di default; `false` = spento. */
  ocr?: OpzioniLettura["ocr"];
  /** Lettura visiva con il modello, con l'identità di chi paga sul ledger. */
  visione?: OpzioniLettura["visione"];
};

export async function verificaConfermaPerFascicolo(input: {
  commessaId: number;
  nomeFile: string;
  mimeType: string;
  buffer: Buffer;
  estraiTesto?: DipendenzeCostoDaConferma["estraiTesto"];
  /**
   * Senza `lettura` si legge solo il testo nativo (rapido, gratuito):
   * è il percorso di una richiesta HTTP. I worker e le approvazioni
   * passano OCR e visione: una scansione non deve fermare la conferma
   * (04/09/2026: «non deve arrendersi»).
   */
  lettura?: LetturaPerVerifica | null;
  /** Pagine già lette da chi chiama (ricerca della commessa): niente rilettura. */
  pagine?: readonly string[] | null;
}): Promise<VerificaConfermaPerFascicolo> {
  const commessa: any = getCommessaById(input.commessaId);
  if (!commessa) {
    return { ok: false, motivo: "Commessa non trovata.", prove: [], testoLetto: false, duplicatoDi: null };
  }
  const estrai = input.estraiTesto ?? dipendenzeCostoDaConfermaReali().estraiTesto;
  let parser: EsitoParser;
  try {
    parser = input.pagine?.length
      ? { esito: "estratto", parser: "fornito", versione: "0", pagine: [...input.pagine], avvertenze: [] }
      : await estrai(
          input.buffer,
          input.mimeType,
          input.nomeFile,
          input.lettura
            ? {
                ocr: input.lettura.ocr !== false,
                visione: (input.lettura.visione || null) as IdentitaLettura | null,
              }
            : { ocr: false, visione: null }
        );
  } catch (errore) {
    return {
      ok: false,
      motivo: `Testo non leggibile (${motivoSicuro(errore)}): la conferma va verificata a mano.`,
      prove: [],
      testoLetto: false,
      duplicatoDi: null,
    };
  }
  if (parser.esito !== "estratto") {
    return {
      ok: false,
      motivo:
        "Testo non leggibile (scansione o formato non supportato): senza leggere dentro la conferma non si archivia da soli.",
      prove: [],
      testoLetto: false,
      duplicatoDi: null,
    };
  }
  const { estrazione } = estraiConfermeNelDocumento(parser.pagine, {
    codiceOrdine: null,
    fornitoreNome: null,
    righeOrdine: [],
  });
  const riscontro = riscontroCommessaNelTesto(parser.pagine, riferimentiDellaCommessa(commessa));
  const duplicato = confermaDuplicataNelFascicolo({
    commessaId: commessa.id,
    documentoId: null,
    riferimenti: riferimentiOrdineDocumento({
      nomeFile: input.nomeFile,
      riferimentoOrdine: estrazione.riferimentoOrdine?.valore ?? null,
      numeroConferma: estrazione.numeroConferma?.valore ?? null,
    }),
    imponibile: estrazione.imponibileDocumento?.valore ?? null,
    fornitore: estrazione.fornitoreCitato?.valore ?? null,
    dataDocumento: estrazione.dataDocumento?.valore ?? null,
  });
  if (duplicato) {
    return {
      ok: false,
      motivo: `Stessa conferma di «${duplicato.documento.nome}» già nel fascicolo (riferimento ${duplicato.riferimento}): non si duplica.`,
      prove: riscontro.prove,
      testoLetto: true,
      duplicatoDi: {
        documentoId: duplicato.documento.id,
        nome: duplicato.documento.nome,
        riferimento: duplicato.riferimento,
      },
    };
  }
  return {
    ok: riscontro.ok,
    motivo: riscontro.motivo,
    prove: riscontro.prove,
    testoLetto: true,
    duplicatoDi: null,
  };
}

// ── La regola: costo e merce dalla conferma ────────────────────────────────

export async function registraCostoDaConferma(input: {
  documentoId: number;
  /** OCR ammesso: solo dal worker o su richiesta esplicita, mai nel percorso della richiesta. */
  ocr?: boolean;
  /** Lettura visiva con il modello quando l'OCR non basta (default: sì, se l'OCR è ammesso). */
  visione?: boolean;
  /** Chi paga la lettura visiva sul ledger: default la sede della commessa con l'utente di sistema. */
  identitaVisione?: IdentitaLettura;
  /**
   * Rilegge anche se la lettura precedente è già decisa e rimette un costo
   * tolto a mano: è la richiesta esplicita di un utente (Tars), non il worker.
   */
  forza?: boolean;
  /** Chi chiama ha già mostrato un importo all'utente: si scrive solo se coincide. */
  importoAtteso?: number | null;
  fornitore?: string | null;
  numeroOrdine?: string | null;
  nota?: string | null;
  deps?: Partial<DipendenzeCostoDaConferma>;
}): Promise<EsitoCostoDaConferma> {
  const deps: DipendenzeCostoDaConferma = {
    ...dipendenzeCostoDaConfermaReali(),
    ...input.deps,
  };
  const base = (
    documento: Documento | null,
    esito: EsitoCostoDaConferma["esito"],
    motivo: string | null,
    extra: Partial<EsitoCostoDaConferma> = {}
  ): EsitoCostoDaConferma => ({
    documentoId: input.documentoId,
    commessaId: documento?.commessaId ?? null,
    esito,
    imponibile: null,
    costoId: null,
    fonteTesto: "nessuna",
    motivo,
    nomeFile: documento?.nome ?? null,
    merce: null,
    duplicatoDi: null,
    ...extra,
  });

  const documento = getDocumentoRecordById(input.documentoId);
  if (!documento) return base(null, "documento_assente", "Documento non trovato.");
  if (documento.tipo !== "conferma_ordine") {
    return base(documento, "non_conferma", "Il documento non è una conferma d'ordine.");
  }
  const commessa: any = getCommessaById(documento.commessaId);
  if (!commessa) return base(documento, "commessa_assente", "Commessa non trovata.");

  const salva = (
    lettura: Omit<LetturaCostoDocumento, "versione" | "checksum" | "quando">
  ): LetturaCostoDocumento => {
    const completa: LetturaCostoDocumento = {
      versione: VERSIONE_LETTURA_COSTO,
      checksum: documento.checksum ?? null,
      quando: deps.adesso().toISOString(),
      ...lettura,
    };
    salvaLetturaCostoDocumento(documento.id, completa);
    return completa;
  };

  const precedente = documento.letturaCosto ?? null;
  const memoriaValida =
    precedente != null &&
    precedente.versione === VERSIONE_LETTURA_COSTO &&
    (precedente.checksum ?? null) === (documento.checksum ?? null) &&
    precedente.merce !== undefined;
  const esistente = costoDelDocumento(commessa, documento.id);

  // Decisioni già prese con questa versione e questi byte: si rispettano.
  if (memoriaValida && !input.forza) {
    if (precedente.esito === "registrato" || precedente.esito === "collegato") {
      return base(
        documento,
        esistente ? "gia_registrato" : "rimosso_a_mano",
        esistente
          ? null
          : "Il costo nato da questa conferma è stato tolto a mano: non lo rimetto da solo.",
        {
          imponibile: precedente.imponibile,
          costoId: esistente?.id ?? null,
          fonteTesto: precedente.fonteTesto,
          merce: precedente.merce ?? null,
        }
      );
    }
    if (ESITI_TERMINALI.has(precedente.esito)) {
      return base(documento, precedente.esito, precedente.motivo, {
        fonteTesto: precedente.fonteTesto,
        merce: precedente.merce ?? null,
        duplicatoDi: precedente.duplicatoDi ?? null,
      });
    }
    if (precedente.esito === "da_ocr" && !input.ocr) {
      return base(documento, "da_ocr", precedente.motivo);
    }
    if (precedente.esito === "errore" && precedente.tentativi >= TENTATIVI_MASSIMI_LETTURA) {
      return base(documento, "errore", precedente.motivo);
    }
  }
  const tentativi = memoriaValida ? (precedente?.tentativi ?? 0) : 0;
  const fallita = (
    esito: "errore" | "non_leggibile" | "da_ocr",
    motivo: string,
    fonteTesto: LetturaCostoDocumento["fonteTesto"] = "nessuna"
  ): EsitoCostoDaConferma => {
    salva({
      esito,
      fonteTesto,
      imponibile: null,
      fornitore: null,
      numeroOrdine: null,
      dataDocumento: null,
      motivo,
      tentativi: esito === "errore" ? tentativi + 1 : tentativi,
      costoId: null,
      merce: null,
      riferimenti: riferimentiOrdineDocumento({ nomeFile: documento.nome }),
    });
    return base(documento, esito, motivo);
  };

  // ── Lettura del documento (una sola volta per costo e merce) ─────────────
  let raw: { buffer: Buffer; nome: string; mimeType: string } | null;
  try {
    raw = await deps.leggiDocumento(documento.id);
  } catch (errore) {
    return fallita("errore", `Lettura dallo storage fallita: ${motivoSicuro(errore)}`);
  }
  if (!raw) return fallita("errore", "File non disponibile nello storage.");

  let parser: EsitoParser;
  try {
    parser = await deps.estraiTesto(raw.buffer, raw.mimeType, raw.nome, {
      ocr: input.ocr === true,
      visione:
        input.ocr === true && input.visione !== false
          ? (input.identitaVisione ?? { sedeId: Number(commessa.sedeId ?? 1), utenteId: 0 })
          : null,
    });
  } catch (errore) {
    return fallita("errore", `Parser fallito: ${motivoSicuro(errore)}`);
  }
  if (parser.esito === "scansione_senza_testo") {
    return input.ocr
      ? fallita(
          "non_leggibile",
          parser.motivo ??
            "PDF scansionato e OCR non riuscito: il contenuto non è stato compreso."
        )
      : fallita("da_ocr", "PDF scansionato: il testo si ricostruisce con l'OCR.");
  }
  if (parser.esito !== "estratto") {
    return fallita("non_leggibile", parser.motivo);
  }
  const fonteTesto: LetturaCostoDocumento["fonteTesto"] =
    parser.visione != null ? "visione" : parser.ocr != null ? "ocr" : "testo_pdf";

  // Un file può contenere più conferme (Bertolotto): si legge a sezioni e
  // l'imponibile è la somma, solo se ogni sezione ha il suo.
  const documentoLetto = estraiConfermeNelDocumento(parser.pagine, {
    codiceOrdine: input.numeroOrdine ?? null,
    fornitoreNome: input.fornitore ?? null,
    righeOrdine: [],
  });
  const estrazione = documentoLetto.estrazione;
  const sezioni = documentoLetto.sezioni.length;
  const imponibile =
    estrazione.imponibileDocumento?.valore != null
      ? arrotonda(estrazione.imponibileDocumento.valore)
      : null;
  const numeroOrdine =
    input.numeroOrdine?.trim() || estrazione.riferimentoOrdine?.valore || null;
  const dataDocumento = estrazione.dataDocumento?.valore ?? null;
  const fornitore =
    input.fornitore?.trim() ||
    estrazione.fornitoreCitato?.valore ||
    (await deps.nomeMittente(documento)) ||
    null;
  const riferimenti = riferimentiOrdineDocumento({
    nomeFile: raw.nome,
    riferimentoOrdine: estrazione.riferimentoOrdine?.valore ?? null,
    numeroConferma: estrazione.numeroConferma?.valore ?? null,
  });
  const riferimentoDocumento = `«${raw.nome}» (documento:${documento.id})`;
  const avvisoOcr =
    fonteTesto === "ocr"
      ? " — testo da OCR, verificare sul file"
      : fonteTesto === "visione"
        ? " — testo trascritto dal modello, verificare sul file"
        : "";
  const memoriaBase = {
    fonteTesto,
    imponibile,
    fornitore,
    numeroOrdine,
    dataDocumento,
    tentativi,
    riferimenti,
    sezioni,
  };

  // ── Riscontro: un automatismo ha messo qui la conferma, il testo deve dirlo ──
  let riscontro: RiscontroCommessa | null = null;
  if (origineAutomatica(documento) && !documento.riscontroConfermato) {
    riscontro = riscontroCommessaNelTesto(parser.pagine, riferimentiDellaCommessa(commessa));
    if (!riscontro.ok) {
      const ritirato = ritira(commessa, documento);
      const motivo = `${riscontro.motivo} Archiviata dal solo oggetto della mail: verifica il file e, se è di questa commessa, conferma; altrimenti spostala o cancellala.${
        ritirato ? " Costo e merce nati da questa conferma sono stati ritirati." : ""
      }`;
      salva({
        ...memoriaBase,
        esito: "senza_riscontro",
        motivo,
        costoId: null,
        merce: null,
        riscontro: { ok: false, prove: [] },
      });
      return base(documento, "senza_riscontro", motivo, { fonteTesto, imponibile });
    }
  }

  // ── Duplicati: stessa conferma già nel fascicolo ──────────────────────────
  const duplicato = confermaDuplicataNelFascicolo({
    commessaId: commessa.id,
    documentoId: documento.id,
    riferimenti,
    imponibile,
    fornitore,
    dataDocumento,
  });
  if (duplicato) {
    // Stesso ordine ma importo diverso, e questo documento è entrato DOPO:
    // è la conferma aggiornata, non una copia (04/09/2026, Oskura: la
    // «(2).pdf» dello stesso ordine con il totale rivisto). Il costo e la
    // merce seguono la versione più recente — se il costo dell'originale
    // era ancora quello scritto dalla regola, mai toccato da una persona.
    const originale = duplicato.documento;
    const costoOriginale = costoDelDocumento(commessa, originale.id);
    const letturaOriginale = originale.letturaCosto ?? null;
    const revisione =
      imponibile != null &&
      imponibile > 0 &&
      costoOriginale != null &&
      costoScrittoDallaRegola(costoOriginale, letturaOriginale) &&
      Math.abs(costoOriginale.importo - imponibile) >= 0.005 &&
      piuRecente(documento, originale);
    if (!revisione) {
      const ritirato = ritira(commessa, documento);
      const importoDiverso =
        imponibile != null && costoOriginale != null && Math.abs(costoOriginale.importo - imponibile) >= 0.005
          ? ` Attenzione: qui l'imponibile è ${euro(imponibile)}, a registro c'è ${euro(costoOriginale.importo)}.`
          : "";
      const motivo = `Stessa conferma di «${originale.nome}» (riferimento ${duplicato.riferimento}): il costo e la merce restano quelli dell'originale.${
        ritirato ? " Costo e merce doppi ritirati." : ""
      }${importoDiverso}`;
      salva({
        ...memoriaBase,
        esito: "duplicato",
        motivo,
        costoId: null,
        merce: null,
        duplicatoDi: originale.id,
        riscontro: riscontro ? { ok: true, prove: riscontro.prove } : null,
      });
      return base(documento, "duplicato", motivo, {
        fonteTesto,
        imponibile,
        duplicatoDi: originale.id,
      });
    }
    ritira(commessa, originale);
    salvaLetturaCostoDocumento(originale.id, {
      ...(letturaOriginale as LetturaCostoDocumento),
      esito: "duplicato",
      motivo: `Sostituita dalla versione più recente «${raw.nome}» (documento:${documento.id}): costo e merce seguono quella (qui l'imponibile era ${euro(
        letturaOriginale?.imponibile ?? costoOriginale!.importo
      )}).`,
      costoId: null,
      merce: null,
      duplicatoDi: documento.id,
      quando: deps.adesso().toISOString(),
    });
  }

  // ── Merce in arrivo a magazzino ──────────────────────────────────────────
  const merce = applicaMerceDaConferma({
    commessa,
    documento,
    pagine: parser.pagine,
    estrazione,
    fornitore,
    numeroOrdine,
    dataOrdine: dataDocumento,
    riferimentoDocumento,
    avvisoOcr,
    adesso: deps.adesso(),
    precedente: precedente?.merce ?? null,
  });

  // ── Costo fornitore ──────────────────────────────────────────────────────
  const memoriaCosto = {
    ...memoriaBase,
    merce,
    riscontro: riscontro ? { ok: true, prove: riscontro.prove } : null,
  };

  if (esistente) {
    const esitoEsistente: EsitoLetturaCosto =
      precedente?.esito === "collegato" ? "collegato" : "registrato";
    const diverso =
      imponibile != null && imponibile > 0 && Math.abs(esistente.importo - imponibile) >= 0.005;
    // Una rilettura migliore corregge un costo nato dalla regola e mai
    // toccato da nessuno (04/09/2026: conferme Pail registrate a «22,00»,
    // l'aliquota IVA letta come imponibile da un estrattore vecchio). Un
    // costo scritto o modificato da una persona non si tocca: si dice.
    if (diverso && costoScrittoDallaRegola(esistente, precedente) && input.importoAtteso == null) {
      const era = esistente.importo;
      aggiornaImportoCosto(
        commessa,
        esistente,
        imponibile!,
        `Importo corretto dalla rilettura di ${riferimentoDocumento}: era ${euro(era)}${avvisoOcr}.`,
        { fornitore, data: dataDocumento, numeroOrdine }
      );
      salva({
        ...memoriaCosto,
        esito: "registrato",
        motivo: `Importo corretto dalla rilettura: era ${euro(era)}.`,
        costoId: esistente.id,
      });
      return base(documento, "registrato", null, {
        imponibile: imponibile!,
        costoId: esistente.id,
        fonteTesto,
        merce,
      });
    }
    const motivo = diverso
      ? `La rilettura di «${raw.nome}» dice ${euro(imponibile!)}, a registro c'è ${euro(esistente.importo)} (scritto o modificato a mano): non lo tocco.`
      : null;
    salva({ ...memoriaCosto, esito: esitoEsistente, motivo, costoId: esistente.id });
    return base(documento, "gia_registrato", motivo, {
      imponibile: esistente.importo,
      costoId: esistente.id,
      fonteTesto,
      merce,
    });
  }
  // Un costo nato da questa conferma e poi tolto a mano non rinasce da solo,
  // qualunque sia la versione della lettura che lo ricorda.
  if (
    !input.forza &&
    precedente &&
    (precedente.esito === "registrato" || precedente.esito === "collegato")
  ) {
    salva({ ...memoriaCosto, esito: precedente.esito, motivo: null, costoId: null });
    return base(
      documento,
      "rimosso_a_mano",
      "Il costo nato da questa conferma è stato tolto a mano: non lo rimetto da solo.",
      { imponibile, fonteTesto, merce }
    );
  }

  if (imponibile == null || imponibile <= 0) {
    const motivo =
      documentoLetto.motivoSomma ??
      (estrazione.totaleDocumento
        ? `«${raw.nome}» dichiara un totale ma non l'imponibile: l'IVA non si scorpora per stima, il costo va registrato a mano.`
        : `In «${raw.nome}» non c'è un imponibile leggibile: il costo va registrato a mano.`);
    salva({ ...memoriaCosto, esito: "senza_imponibile", motivo, costoId: null });
    return base(documento, "senza_imponibile", motivo, { fonteTesto, merce });
  }

  if (
    input.importoAtteso != null &&
    Math.round(imponibile * 100) !== Math.round(input.importoAtteso * 100)
  ) {
    return base(
      documento,
      "importo_diverso",
      `L'imponibile letto da «${raw.nome}» è diverso da quello indicato: registro solo l'importo che sta nel documento.`,
      { imponibile, fonteTesto, merce }
    );
  }

  // La nota comincia SEMPRE con l'impronta della regola: è così che una
  // rilettura riconosce un costo scritto da lei (una nota di chi chiama va in coda).
  const nota = `${NOTA_COSTO_DA_CONFERMA}${riferimentoDocumento}${avvisoOcr}${
    sezioni > 1
      ? ` — ${sezioni} conferme nel file, imponibile = somma (${documentoLetto.sezioni
          .map(s => euro(s.estrazione.imponibileDocumento?.valore ?? 0))
          .join(" + ")})`
      : ""
  }${input.nota?.trim() ? ` — ${input.nota.trim()}` : ""}`.slice(0, 300);

  // Un costo già scritto a mano per lo stesso ordine, lo stesso importo o lo
  // stesso fornitore: la conferma lo lega al documento, non lo raddoppia.
  const manuale =
    costoManualeCorrispondente(commessa, { numeroOrdine, importo: imponibile }) ??
    costoManualePerFornitore(commessa, fornitore);
  if (manuale) {
    collegaCostoAlDocumento(commessa, manuale, documento.id, nota);
    salva({ ...memoriaCosto, esito: "collegato", motivo: null, costoId: manuale.id });
    return base(documento, "collegato", null, {
      imponibile,
      costoId: manuale.id,
      fonteTesto,
      merce,
    });
  }

  const costo = aggiungiCosto(commessa, {
    importo: imponibile,
    fornitore,
    descrizione: `${DESCRIZIONE_COSTO_DA_CONFERMA}${raw.nome}`.slice(0, 160),
    data: dataDocumento,
    numeroOrdine,
    note: nota,
    documentoId: documento.id,
  });
  salva({ ...memoriaCosto, esito: "registrato", motivo: null, costoId: costo.id });
  return base(documento, "registrato", null, {
    imponibile,
    costoId: costo.id,
    fonteTesto,
    merce,
  });
}

/** Ritira costo e merce nati da un documento che non doveva produrli. */
function ritira(commessa: any, documento: Documento): boolean {
  const costo = rimuoviCostoDelDocumento(documento.id, commessa.id);
  const merce = rimuoviProdottiDelDocumento(documento.id);
  return costo != null || merce > 0;
}

/**
 * La merce che la conferma promette, scritta a magazzino sulla commessa:
 * una riga per articolo riconosciuto, altrimenti una riga sola da completare
 * a mano — così la commessa compare comunque, con la sua data di arrivo.
 * Idempotente per documento; le righe lette da un estrattore più vecchio si
 * rigenerano se nessuno le ha toccate a mano (04/09/2026: «va ricontrollato
 * anche il magazzino»). La settimana di APPRONTAMENTO non è una consegna:
 * la data resta vuota e la nota lo dice.
 */
function applicaMerceDaConferma(input: {
  commessa: any;
  documento: Documento;
  pagine: string[];
  estrazione: EstrazioneConferma;
  fornitore: string | null;
  numeroOrdine: string | null;
  dataOrdine: string | null;
  riferimentoDocumento: string;
  avvisoOcr: string;
  adesso: Date;
  precedente: MerceDaConferma | null;
}): MerceDaConferma {
  const c = input.commessa;
  const gia = prodottiDelDocumento(input.documento.id);
  if (gia.length > 0) {
    const toccate = gia.some(
      p =>
        p.arrivato ||
        new Date(p.updatedAt as any).getTime() - new Date(p.createdAt as any).getTime() > 2_000
    );
    const vecchie = (input.precedente?.versioneEstrattore ?? null) !== ESTRATTORE_MERCE_VERSIONE;
    if (!vecchie || toccate) {
      return {
        righe: gia.length,
        dataConsegna: gia[0].dataConsegna,
        motivo: vecchie ? "Righe modificate a mano: non rigenerate." : null,
        versioneEstrattore: vecchie ? (input.precedente?.versioneEstrattore ?? null) : ESTRATTORE_MERCE_VERSIONE,
        approntamento: input.precedente?.approntamento ?? null,
      };
    }
    rimuoviProdottiDelDocumento(input.documento.id);
  }
  if (c.archivedAt || !isCommessaEligibleForMagazzino(String(c.stato ?? ""))) {
    return {
      righe: 0,
      dataConsegna: null,
      motivo: `La commessa è in «${c.stato}»: il magazzino parte da «Da ordinare».`,
      versioneEstrattore: ESTRATTORE_MERCE_VERSIONE,
      approntamento: null,
    };
  }
  const riferimento = input.dataOrdine ? new Date(`${input.dataOrdine}T00:00:00Z`) : input.adesso;
  const riferimentoValido = Number.isFinite(riferimento.getTime()) ? riferimento : input.adesso;
  const dateConsegna = input.estrazione.dateConsegna.map(d => d.valore);
  const settimaneConsegna = input.estrazione.settimaneConsegna.map(s => s.valore);
  const approntamentoDichiarato = input.estrazione.settimaneApprontamento?.[0] ?? null;
  const approntamento = approntamentoDichiarato
    ? {
        settimana: approntamentoDichiarato.valore,
        anno: approntamentoDichiarato.anno,
        dal: dataDaSettimanaIso(
          approntamentoDichiarato.valore,
          riferimentoValido,
          approntamentoDichiarato.anno
        ),
      }
    : null;
  const dataConsegna =
    dateConsegna[0] ??
    (settimaneConsegna[0] != null
      ? dataDaSettimanaIso(settimaneConsegna[0], riferimentoValido)
      : null);
  const notaConsegna =
    !dateConsegna[0] && settimaneConsegna[0] != null
      ? ` Consegna: settimana ${settimaneConsegna[0]}.`
      : !dataConsegna && approntamento
        ? ` Approntamento: settimana ${approntamento.settimana}${approntamento.anno ? `/${approntamento.anno}` : ""}${
            approntamento.dal ? ` (merce pronta dal fornitore dal ${approntamento.dal})` : ""
          }: la consegna va concordata, la data resta vuota.`
        : "";
  const righe = estraiRigheMerce(input.pagine);
  const nota = (
    righe.length > 0
      ? `Letta dalla conferma d'ordine ${input.riferimentoDocumento}${input.avvisoOcr}.${notaConsegna}`
      : `Dalla conferma d'ordine ${input.riferimentoDocumento}: righe di merce non riconosciute nel PDF, descrizione da completare a mano.${notaConsegna}`
  ).slice(0, 300);
  const creati = creaProdottiDaConferma({
    commessaId: c.id,
    sedeId: Number(c.sedeId ?? 1),
    documentoId: input.documento.id,
    righe:
      righe.length > 0
        ? righe.map(r => ({ nome: r.nome, quantita: r.quantita }))
        : [
            {
              nome: `Merce conferma d'ordine ${
                input.numeroOrdine ? `n. ${input.numeroOrdine}` : input.documento.nome
              }`,
              quantita: 1,
            },
          ],
    fornitore: input.fornitore,
    numeroOrdine: input.numeroOrdine,
    dataOrdine: input.dataOrdine,
    dataConsegna,
    note: nota,
  });
  return {
    righe: creati.length,
    dataConsegna,
    motivo:
      righe.length > 0 ? null : "Righe di merce non riconosciute: una riga sola da completare a mano.",
    versioneEstrattore: ESTRATTORE_MERCE_VERSIONE,
    approntamento,
  };
}

/** Stesso fornitore di un costo manuale senza documento: è lo stesso ordine nella quasi totalità dei casi. */
function costoManualePerFornitore(commessa: any, fornitore: string | null) {
  const atteso = riferimentoNormalizzato(fornitore);
  if (atteso.length < 4) return null;
  const costi: any[] = Array.isArray(commessa.costi) ? commessa.costi : [];
  return (
    costi.find(c => {
      if (c.documentoId != null) return false;
      const suo = riferimentoNormalizzato(c.fornitore);
      return suo.length >= 4 && (suo.includes(atteso) || atteso.includes(suo));
    }) ?? null
  );
}

// ── Cosa manca ancora: per la scheda e per la fotografia di Tars ────────────

export type ConfermaSenzaCosto = {
  documentoId: number;
  commessaId: number;
  nomeFile: string;
  esito: EsitoLetturaCosto | "in_attesa" | "rimosso_a_mano";
  motivo: string | null;
  fonteTesto: LetturaCostoDocumento["fonteTesto"];
  link: string;
  /** Il documento originale, quando questa è un duplicato. */
  duplicatoDi: number | null;
  /** Una persona può dire «è di questa commessa» e far nascere costo e merce. */
  confermabile: boolean;
};

function descriviConferma(commessa: any, documento: Documento): ConfermaSenzaCosto {
  const lettura = documento.letturaCosto ?? null;
  const esito: ConfermaSenzaCosto["esito"] = !lettura
    ? "in_attesa"
    : lettura.esito === "registrato" || lettura.esito === "collegato"
      ? "rimosso_a_mano"
      : lettura.esito;
  return {
    documentoId: documento.id,
    commessaId: commessa.id,
    nomeFile: documento.nome,
    esito,
    motivo:
      esito === "rimosso_a_mano"
        ? "Il costo nato da questa conferma è stato tolto a mano."
        : esito === "in_attesa"
          ? "Lettura in attesa del prossimo giro."
          : (lettura?.motivo ?? null),
    fonteTesto: lettura?.fonteTesto ?? "nessuna",
    link: `/api/documenti/${documento.id}/file`,
    duplicatoDi: lettura?.duplicatoDi ?? null,
    confermabile: esito === "senza_riscontro",
  };
}

/** Le conferme d'ordine del fascicolo che non hanno (più) un costo a registro. */
export function confermeSenzaCostoDi(commessaId: number): ConfermaSenzaCosto[] {
  const commessa: any = getCommessaById(commessaId);
  if (!commessa) return [];
  return getDocumentiDiCommessa(commessaId)
    .filter(d => d.tipo === "conferma_ordine" && !costoDelDocumento(commessa, d.id))
    .map(d => descriviConferma(commessa, d));
}

/**
 * Per la fotografia di Tars: le conferme della sede che il sistema NON è
 * riuscito a trasformare in costo (senza imponibile, illeggibili, senza
 * riscontro). Le letture ancora in corso non si segnalano: ci pensa il
 * worker. I duplicati non sono un problema: sono già spiegati.
 */
export function confermeSenzaCostoLeggibileDiSede(
  sedeId: number,
  limite = 20
): Array<ConfermaSenzaCosto & { codice: string | null; cliente: string | null; stato: string }> {
  const righe: Array<
    ConfermaSenzaCosto & { codice: string | null; cliente: string | null; stato: string }
  > = [];
  for (const documento of documentiDiSede(sedeId)) {
    if (documento.tipo !== "conferma_ordine") continue;
    const lettura = documento.letturaCosto;
    if (
      !lettura ||
      (lettura.esito !== "senza_imponibile" &&
        lettura.esito !== "non_leggibile" &&
        lettura.esito !== "senza_riscontro")
    ) {
      continue;
    }
    const commessa: any = getCommessaById(documento.commessaId);
    if (!commessa || commessa.archivedAt || commessa.stato === "archiviata") continue;
    if (costoDelDocumento(commessa, documento.id)) continue;
    righe.push({
      ...descriviConferma(commessa, documento),
      codice: commessa.codice ?? null,
      cliente: commessa.cliente ?? null,
      stato: String(commessa.stato ?? ""),
    });
    if (righe.length >= limite) break;
  }
  return righe;
}
