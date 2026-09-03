// Il costo fornitore nasce dalla conferma d'ordine, nel momento in cui il
// documento entra nel fascicolo (direzione 03/09/2026 sera: «il costo non
// deve nascere se lo chiedo in chat, il costo deve nascere nel momento in
// cui la conf. ordine viene allegata alla commessa»).
//
// Regola di dominio deterministica, come il pattuito che nasce dalla fattura
// FiC: l'importo è quello scritto nel documento (l'IMPONIBILE, base del
// margine), letto dallo stesso estrattore dell'analisi documentale. Nessun
// modello decide niente qui. Se l'imponibile non c'è, non si scorpora l'IVA
// per stima: il documento resta «senza imponibile» e la scheda lo dice.
//
// Chi chiama: gli agganci del fascicolo (upload, archiviazione da mail,
// riclassificazione) SENZA OCR — il percorso della richiesta deve restare
// rapido — e il worker di fondo CON OCR, per le scansioni e per le conferme
// già archiviate prima di questa regola.

import { getComunicazione } from "../comunicazioni/comunicazioni";
import { estraiConfermaOrdine } from "../documenti/estrazioneConferma";
import {
  estraiTestoDocumento,
  type EsitoParser,
} from "../documenti/parserRegistry";
import { getCommessaById } from "../routers/commesse";
import {
  documentiDiSede,
  getDocumentiDiCommessa,
  getDocumentoRecordById,
  leggiDocumentoCommessaDaStorage,
  salvaLetturaCostoDocumento,
  type Documento,
} from "../routers/preventiviContratti";
import {
  aggiungiCosto,
  collegaCostoAlDocumento,
  costoDelDocumento,
  costoManualeCorrispondente,
  riferimentoNormalizzato,
} from "./costiRegistro";
import {
  ESITI_TERMINALI,
  TENTATIVI_MASSIMI_LETTURA,
  VERSIONE_LETTURA_COSTO,
  type EsitoLetturaCosto,
  type LetturaCostoDocumento,
} from "./letturaCostoTipi";

export type EsitoCostoDaConferma = {
  documentoId: number;
  commessaId: number | null;
  esito:
    | EsitoLetturaCosto
    /** C'era già: nessun effetto. */
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
};

export type DipendenzeCostoDaConferma = {
  leggiDocumento: (
    documentoId: number
  ) => Promise<{ buffer: Buffer; nome: string; mimeType: string } | null>;
  estraiTesto: (
    buffer: Buffer,
    mimeType: string,
    nome: string,
    ocr: boolean
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
    estraiTesto: (buffer, mimeType, nome, ocr) =>
      estraiTestoDocumento(buffer, mimeType, nome, ocr ? undefined : { ocr: false }),
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

export async function registraCostoDaConferma(input: {
  documentoId: number;
  /** OCR ammesso: solo dal worker o su richiesta esplicita, mai nel percorso della richiesta. */
  ocr?: boolean;
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

  // Già a registro: nessun effetto. Se il documento non lo ricorda (costo
  // scritto da Tars prima del campo `documentoId`), lo si annota adesso.
  const esistente = costoDelDocumento(commessa, documento.id);
  if (esistente) {
    const memoria = documento.letturaCosto ?? null;
    if (!memoria || (memoria.esito !== "registrato" && memoria.esito !== "collegato")) {
      salva({
        esito: "registrato",
        fonteTesto: memoria?.fonteTesto ?? "nessuna",
        imponibile: esistente.importo,
        fornitore: esistente.fornitore,
        numeroOrdine: esistente.numeroOrdine,
        dataDocumento: esistente.data,
        motivo: null,
        tentativi: memoria?.tentativi ?? 0,
        costoId: esistente.id,
      });
    }
    return base(documento, "gia_registrato", null, {
      imponibile: esistente.importo,
      costoId: esistente.id,
    });
  }

  const precedente = documento.letturaCosto ?? null;
  const memoriaValida =
    precedente != null &&
    precedente.versione === VERSIONE_LETTURA_COSTO &&
    (precedente.checksum ?? null) === (documento.checksum ?? null);
  if (memoriaValida && !input.forza) {
    if (precedente.esito === "registrato" || precedente.esito === "collegato") {
      return base(
        documento,
        "rimosso_a_mano",
        "Il costo nato da questa conferma è stato tolto a mano: non lo rimetto da solo.",
        { imponibile: precedente.imponibile, fonteTesto: precedente.fonteTesto }
      );
    }
    if (ESITI_TERMINALI.has(precedente.esito)) {
      return base(documento, precedente.esito, precedente.motivo, {
        fonteTesto: precedente.fonteTesto,
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
    });
    return base(documento, esito, motivo);
  };

  let raw: { buffer: Buffer; nome: string; mimeType: string } | null;
  try {
    raw = await deps.leggiDocumento(documento.id);
  } catch (errore) {
    return fallita("errore", `Lettura dallo storage fallita: ${motivoSicuro(errore)}`);
  }
  if (!raw) return fallita("errore", "File non disponibile nello storage.");

  let parser: EsitoParser;
  try {
    parser = await deps.estraiTesto(raw.buffer, raw.mimeType, raw.nome, input.ocr === true);
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
    parser.ocr != null ? "ocr" : "testo_pdf";

  const estrazione = estraiConfermaOrdine(parser.pagine, {
    codiceOrdine: input.numeroOrdine ?? null,
    fornitoreNome: input.fornitore ?? null,
    righeOrdine: [],
  });
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

  if (imponibile == null || imponibile <= 0) {
    const motivo = estrazione.totaleDocumento
      ? `«${raw.nome}» dichiara un totale ma non l'imponibile: l'IVA non si scorpora per stima, il costo va registrato a mano.`
      : `In «${raw.nome}» non c'è un imponibile leggibile: il costo va registrato a mano.`;
    salva({
      esito: "senza_imponibile",
      fonteTesto,
      imponibile: null,
      fornitore,
      numeroOrdine,
      dataDocumento,
      motivo,
      tentativi,
      costoId: null,
    });
    return base(documento, "senza_imponibile", motivo, { fonteTesto });
  }

  if (
    input.importoAtteso != null &&
    Math.round(imponibile * 100) !== Math.round(input.importoAtteso * 100)
  ) {
    return base(
      documento,
      "importo_diverso",
      `L'imponibile letto da «${raw.nome}» è diverso da quello indicato: registro solo l'importo che sta nel documento.`,
      { imponibile, fonteTesto }
    );
  }

  const nota = `${input.nota?.trim() ? `${input.nota.trim()} ` : ""}Letto dalla conferma d'ordine «${raw.nome}» (documento:${documento.id})${
    fonteTesto === "ocr" ? " — testo da OCR, verificare l'importo sul file" : ""
  }`.slice(0, 300);

  // Un costo già scritto a mano per lo stesso ordine, lo stesso importo o lo
  // stesso fornitore: la conferma lo lega al documento, non lo raddoppia.
  const manuale =
    costoManualeCorrispondente(commessa, { numeroOrdine, importo: imponibile }) ??
    costoManualePerFornitore(commessa, fornitore);
  if (manuale) {
    collegaCostoAlDocumento(commessa, manuale, documento.id, nota);
    salva({
      esito: "collegato",
      fonteTesto,
      imponibile,
      fornitore,
      numeroOrdine,
      dataDocumento,
      motivo: null,
      tentativi,
      costoId: manuale.id,
    });
    return base(documento, "collegato", null, {
      imponibile,
      costoId: manuale.id,
      fonteTesto,
    });
  }

  const costo = aggiungiCosto(commessa, {
    importo: imponibile,
    fornitore,
    descrizione: `Conferma d'ordine ${raw.nome}`.slice(0, 160),
    data: dataDocumento,
    numeroOrdine,
    note: nota,
    documentoId: documento.id,
  });
  salva({
    esito: "registrato",
    fonteTesto,
    imponibile,
    fornitore,
    numeroOrdine,
    dataDocumento,
    motivo: null,
    tentativi,
    costoId: costo.id,
  });
  return base(documento, "registrato", null, {
    imponibile,
    costoId: costo.id,
    fonteTesto,
  });
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
 * riuscito a trasformare in costo (senza imponibile, illeggibili). Le
 * letture ancora in corso non si segnalano: ci pensa il worker.
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
    if (!lettura || (lettura.esito !== "senza_imponibile" && lettura.esito !== "non_leggibile")) {
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
