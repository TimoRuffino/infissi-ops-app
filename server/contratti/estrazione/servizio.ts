// Servizio di lettura del contratto (piano 3, Task 6): lega insieme il
// parser del documento, la chiamata governata al modello (Task 3), la
// mappatura deterministica (Task 4) e il repository delle estrazioni
// (Task 5). Disponibilità, esecuzione idempotente, applicazione tramite
// l'unico percorso di scrittura (`salvaContratto`) e scarto: nessuna
// proposta si applica da sola, ogni passo passa da qui.
//
// Il provider reale nasce SOLO da `creaProviderPerRun` (mai un percorso
// parallelo, mai il costruttore grezzo del provider reale qui): nei test
// si inietta un provider finto tramite `DipendenzeEstrazione`. Il testo
// del documento è un dato non fidato: mai eseguito, mai un'autorità sulle
// regole di dominio — categoria, catalogo DEI e importi restano di
// `mappa.ts` e delle tariffe.
import type { EstrazioneContratto } from "@shared/contratti/estrazione";
import type { Contratto, ContrattoInput, RigaContratto, RigaContrattoInput } from "@shared/limiti/tipi";
import { sha256Hex } from "../../_core/fileStorage";
import { scaldaAnteprime } from "../../documenti/anteprime";
import { firmaOcrCorrente } from "../../documenti/ocr";
import { estraiTestoDocumento, type EsitoParser } from "../../documenti/parserRegistry";
import { interruttoreAttivo } from "../../platform/interruttori";
import { getClienteById } from "../../routers/clienti";
import { getCommessaById } from "../../routers/commesse";
import { leggiDocumentoCommessaDaStorage, type Documento } from "../../routers/preventiviContratti";
import { allineaTimelineAlBoard } from "../../routers/timeline";
import { creaProviderPerRun, statoProvider } from "../../tars/costi/providerGovernato";
import type { TarsProvider } from "../../tars/provider";
import { tariffeAttive, type Tariffe } from "../../computo/tariffe";
import { salvaContratto } from "../servizio";
import { annotaAreeProposta } from "./aree";
import { arricchisciDaLayoutWnd, riconosceLayoutWnd } from "./layoutWnd";
import { costruisciProposta, type ContestoMappa } from "./mappa";
import { estraiConModello, modelloEstrazione, type ContestoEstrazione } from "./modello";
import { PROMPT_ESTRAZIONE_VERSIONE } from "./prompt";
import { getEstrazioniRepository, type EstrazioniRepository } from "./repository";
import type { EsitoModello } from "./schema";

export type DipendenzeEstrazione = {
  provider?: TarsProvider;
  modello?: string;
  now?: () => Date;
  repository?: EstrazioniRepository;
  estraiTesto?: typeof estraiTestoDocumento;
};

/** Nome del parser di testo nativo (P3-R4): ogni altro parser conta come "letto" (ocr=true). */
const PARSER_TESTO_NATIVO = "pdf-testo-nativo";

function repoDi(dip: DipendenzeEstrazione): EstrazioniRepository {
  return dip.repository ?? getEstrazioniRepository();
}

function oraDi(dip: DipendenzeEstrazione): Date {
  return dip.now ? dip.now() : new Date();
}

function mimeEPdf(mimeType: string): boolean {
  return (mimeType ?? "").toLowerCase().includes("pdf");
}

/**
 * «Cognome Nome»: stessa convenzione di `clienteDisplay` in
 * server/routers/commesse.ts e di `snapshotCliente` in
 * server/fatture/cliente.ts — per aziende, condomini ed enti la ragione
 * sociale sta intera in `nome` e `cognome` resta vuoto, quindi il trim
 * la ricompone senza spezzarla.
 */
function nomeClienteDisplay(cliente: any | null): string | null {
  if (!cliente) return null;
  const nome = `${cliente.cognome ?? ""} ${cliente.nome ?? ""}`.trim();
  return nome || null;
}

/**
 * Disponibilità della lettura automatica: flag `contrattoEstrazione` e
 * `limiti` accesi, provider reale utilizzabile per il modello configurato.
 * Diagnostica onesta come `statoProvider`: non chiama nulla, dice solo se
 * il pulsante può accendersi e perché no.
 *
 * P3-R20: `eseguiEstrazioneContratto` chiama questa funzione come PRIMA
 * cosa, passandole il provider che ha ricevuto (sempre presente nei test).
 * Con un provider iniettato lo stato del provider REALE non conta più: chi
 * inietta un provider ha già deciso come rispondere, e verificare
 * `statoProvider` in quel caso boccerebbe ogni test in un ambiente senza
 * chiave OpenAI anche a flag accesi. Senza un provider iniettato (il
 * percorso reale, o questa funzione chiamata dalla UI per decidere se
 * MOSTRARE l'azione) il controllo resta quello di sempre: flag PIÙ provider
 * reale disponibile.
 */
export function disponibilitaEstrazione(opzioni?: { provider?: TarsProvider }): {
  disponibile: boolean;
  motivo: string | null;
  modello: string;
} {
  const modello = modelloEstrazione();
  if (!interruttoreAttivo("contrattoEstrazione")) {
    return {
      disponibile: false,
      motivo: "La lettura automatica del contratto è disattivata (FLAG_CONTRATTO_ESTRAZIONE).",
      modello,
    };
  }
  if (!interruttoreAttivo("limiti")) {
    return {
      disponibile: false,
      motivo: "Il contratto strutturato e il computo dei limiti sono disattivati (FLAG_LIMITI).",
      modello,
    };
  }
  if (opzioni?.provider) {
    return { disponibile: true, motivo: null, modello };
  }
  const stato = statoProvider(modello);
  if (stato.tipo !== "openai") {
    return { disponibile: false, motivo: stato.motivoIndisponibilita, modello };
  }
  return { disponibile: true, motivo: null, modello };
}

/** Motivo leggibile per un esito del parser che non ha prodotto testo. */
function motivoLetturaFallita(esito: Exclude<EsitoParser, { esito: "estratto" }>): string {
  if (esito.esito === "scansione_senza_testo" && !interruttoreAttivo("ocr")) {
    return "Il PDF è una scansione e l'OCR è spento.";
  }
  return esito.motivo ?? "Documento non leggibile.";
}

function erroreRispostaInvalida(errore: unknown): boolean {
  return errore instanceof Error && errore.message.startsWith("ESTRAZIONE_RISPOSTA_INVALIDA");
}

/** Stesso messaggio per `applicaEstrazione` e `scartaEstrazione`: la proposta va presa mentre è ancora "proposta". */
function assicuraStatoProposta(estrazione: EstrazioneContratto): void {
  if (estrazione.stato !== "proposta") {
    throw new Error("PRECONDIZIONE: La proposta è già stata applicata o scartata.");
  }
}

/**
 * Chiama il modello con un unico retry quando la risposta non è valida
 * (JSON non decodificabile, schema non rispettato, strumenti inesistenti):
 * `tentativo: 1` poi `tentativo: 2`, stesso `runId`. Un errore diverso non
 * si ritenta. Se anche il secondo tentativo fallisce per risposta
 * invalida, l'errore diventa la precondizione dichiarata all'operatore:
 * nessuna estrazione viene salvata.
 */
async function estraiConRetry(params: {
  pagine: readonly string[];
  contesto: ContestoEstrazione;
  provider: TarsProvider;
  modello: string;
  runId: string;
}): Promise<{ esito: EsitoModello; troncato: boolean }> {
  for (const tentativo of [1, 2] as const) {
    try {
      return await estraiConModello({
        pagine: params.pagine,
        contesto: params.contesto,
        provider: params.provider,
        modello: params.modello,
        identita: { runId: params.runId, passo: 1, tentativo, conversazioneId: null },
      });
    } catch (errore) {
      if (!erroreRispostaInvalida(errore)) throw errore;
      if (tentativo === 2) {
        throw new Error("PRECONDIZIONE: Il modello non ha restituito una proposta valida: riprova.");
      }
      // tentativo 1 con risposta invalida: si ritenta una sola volta.
    }
  }
  // Irraggiungibile: il ciclo copre esattamente i due tentativi previsti.
  throw new Error("PRECONDIZIONE: Il modello non ha restituito una proposta valida: riprova.");
}

// Esecuzioni in corso per chiave (sede, documento, forza): una richiesta
// concorrente sulla stessa chiave attende la STESSA promessa invece di
// rifare l'estrazione (doppio click, retry del client dopo un timeout di
// rete). La chiave non porta checksum né versione del prompt: anche una
// richiesta arrivata mentre il documento sta cambiando aspetta comunque il
// turno in corso, che una volta finito libera la chiave (`finally`) e
// lascia la prossima richiesta ripartire pulita, con lo stato più recente.
const inCorso = new Map<string, Promise<{ estrazione: EstrazioneContratto; riusata: boolean }>>();

export async function eseguiEstrazioneContratto(
  input: {
    sedeId: number;
    commessaId: number;
    documentoId: number;
    actorUserId: number | null;
    forza?: boolean;
  } & DipendenzeEstrazione
): Promise<{ estrazione: EstrazioneContratto; riusata: boolean }> {
  const { sedeId, commessaId, documentoId, forza = false } = input;

  // P3-R20: fail-closed come PRIMA cosa, prima di leggere qualunque cosa dal
  // fascicolo. Un flag spento non deve costare nemmeno una lettura storage.
  // Il provider ricevuto in input (sempre presente nei test) passa a
  // `disponibilitaEstrazione`, che con un provider iniettato guarda SOLO i
  // flag: lo stato del provider reale resta compito della stessa funzione
  // chiamata senza provider (la UI, per decidere se mostrare l'azione).
  const disponibilita = disponibilitaEstrazione({ provider: input.provider });
  if (!disponibilita.disponibile) {
    throw new Error(`PRECONDIZIONE: Lettura automatica non disponibile: ${disponibilita.motivo}`);
  }

  // Validazione del documento: deterministica, sede-scoped, ripetuta a ogni
  // chiamata (non conviene deduplicarla: deve fallire subito anche se
  // un'altra richiesta identica è in corso).
  const risultato = await leggiDocumentoCommessaDaStorage(documentoId, sedeId);
  if (!risultato) throw new Error("NOT_FOUND: Documento non trovato.");
  const { documento, buffer } = risultato;
  // Un documento di un'altra commessa non deve dire nulla di più di "non trovato".
  if (documento.commessaId !== commessaId) {
    throw new Error("NOT_FOUND: Documento non trovato.");
  }
  if (documento.tipo !== "contratto") {
    throw new Error("PRECONDIZIONE: Il documento non è classificato come contratto: cambia il tipo dal fascicolo.");
  }
  if (!mimeEPdf(documento.mimeType)) {
    throw new Error("PRECONDIZIONE: Solo PDF.");
  }

  const chiave = `${sedeId}|${documentoId}|${forza ? 1 : 0}`;
  const giaInCorso = inCorso.get(chiave);
  if (giaInCorso) return giaInCorso;

  const promessa = eseguiEstrazioneCorpo(input, documento, buffer).finally(() => {
    inCorso.delete(chiave);
  });
  inCorso.set(chiave, promessa);
  return promessa;
}

async function eseguiEstrazioneCorpo(
  input: {
    sedeId: number;
    commessaId: number;
    documentoId: number;
    actorUserId: number | null;
    forza?: boolean;
  } & DipendenzeEstrazione,
  documento: Documento,
  buffer: Buffer
): Promise<{ estrazione: EstrazioneContratto; riusata: boolean }> {
  const { sedeId, commessaId, documentoId, actorUserId, forza = false } = input;
  const repo = repoDi(input);
  const modelloUsato = input.modello ?? modelloEstrazione();
  const estrai = input.estraiTesto ?? estraiTestoDocumento;

  const checksum = documento.checksum ?? sha256Hex(buffer);

  // P3-R18: il riuso si decide PRIMA di leggere il testo. Estrarlo è la
  // parte cara (una scansione passa dall'OCR) e le chiavi possibili di una
  // lettura precedente si conoscono già senza leggere niente: la versione
  // del prompt nuda, se il PDF aveva un testo nativo, o con la firma OCR
  // corrente (P3-R3/P3-R4). Se una delle due risponde, il testo non serve.
  const versioneOcr = `${PROMPT_ESTRAZIONE_VERSIONE}+ocr:${await firmaOcrCorrente()}`;
  if (!forza) {
    for (const versione of [PROMPT_ESTRAZIONE_VERSIONE, versioneOcr]) {
      const precedente = await repo.riusabile(sedeId, documentoId, checksum, versione);
      if (precedente) return { estrazione: precedente, riusata: true };
    }
  }

  const esitoParser = await estrai(buffer, documento.mimeType, documento.nome);
  if (esitoParser.esito !== "estratto") {
    throw new Error(`PRECONDIZIONE: ${motivoLetturaFallita(esitoParser)}`);
  }
  // I byte sono già in mano: le pagine per le anteprime delle evidenze si
  // scaldano ora (best-effort, mai un'estrazione fallita per una vignetta).
  await scaldaAnteprime(documento, sedeId, buffer);

  // La chiave definitiva la dice il parser che ha risposto davvero.
  const testoNativo = esitoParser.parser === PARSER_TESTO_NATIVO;
  const ocr = !testoNativo;
  const promptVersione = ocr ? versioneOcr : PROMPT_ESTRAZIONE_VERSIONE;

  let provider = input.provider;
  if (!provider) {
    const stato = statoProvider(modelloUsato);
    if (stato.tipo !== "openai") {
      throw new Error(`PRECONDIZIONE: Lettura automatica non disponibile: ${stato.motivoIndisponibilita}`);
    }
    provider = creaProviderPerRun({
      modello: modelloUsato,
      sedeId,
      utenteId: actorUserId ?? 0,
      classe: "document_intelligence",
      copioneFinto: () => ({
        tipo: "messaggio",
        testo: "{}",
        uso: { input: 0, output: 0, cachedInput: 0, cacheWrite: 0 },
      }),
    });
  }

  const commessa: any = getCommessaById(commessaId);
  const cliente: any = commessa?.clienteId ? getClienteById(commessa.clienteId) : null;
  const contestoEstrazione: ContestoEstrazione = {
    clienteCommessa: nomeClienteDisplay(cliente),
    codiceCommessa: commessa?.codice ?? String(commessaId),
  };

  const now = oraDi(input);
  // Data reale (non l'orologio iniettabile dei test): due run nello stesso
  // istante restano comunque distinguibili nello storico.
  const runId = `contratto:${sedeId}:${documentoId}:${checksum.slice(0, 8)}:${Date.now()}`;

  const esitoModello = await estraiConRetry({
    pagine: esitoParser.pagine,
    contesto: contestoEstrazione,
    provider,
    modello: modelloUsato,
    runId,
  });

  let tariffe: Tariffe;
  try {
    tariffe = tariffeAttive(now);
  } catch {
    // Stesso principio di server/contratti/servizio.ts (~r. 180-186): una
    // data fuori dal periodo coperto dal listino è un problema di dati, non
    // un errore non gestito.
    throw new Error("VALIDAZIONE: tariffe non disponibili per la data del contratto.");
  }

  const contestoMappa: ContestoMappa = {
    tariffe,
    clienteCommessa: {
      nome: nomeClienteDisplay(cliente),
      indirizzo: cliente?.indirizzoLavoro || cliente?.indirizzo || null,
      citta: cliente?.cittaLavoro || cliente?.citta || null,
      codiceFiscale: cliente?.codiceFiscale ?? null,
      tipoDetrazione: cliente?.tipoDetrazione ?? null,
    },
    pagine: esitoParser.pagine,
  };

  let proposta = costruisciProposta(esitoModello.esito, contestoMappa, esitoModello.troncato);
  if (riconosceLayoutWnd(esitoParser.pagine)) {
    // I numeri del layout riscrivono misure, prezzi, pattuito e rate: i
    // controlli si ricalcolano di conseguenza (P3-R9) e per farlo servono
    // l'IVA letta dal modello e il troncamento di questa lettura.
    proposta = arricchisciDaLayoutWnd(esitoParser.pagine, proposta, {
      ivaDescrizione: esitoModello.esito.pattuito.ivaDescrizione,
      troncato: esitoModello.troncato,
    });
  }
  // Dove sta ogni evidenza sulla pagina (anteprime «Dove l'ho letto»): dalla
  // geometria del parser, dopo l'arricchimento che può riscrivere le
  // evidenze dei numeri. Senza geometria resta «pagina».
  proposta = annotaAreeProposta(proposta, esitoParser.geometria);

  const creata = await repo.crea({
    sedeId,
    commessaId,
    documentoId,
    documentoChecksum: checksum,
    stato: "proposta",
    promptVersione,
    modello: modelloUsato,
    runId,
    pagine: esitoParser.pagine.length,
    ocr,
    parser: esitoParser.parser,
    proposta,
    createdBy: actorUserId,
    applicataAt: null,
    applicataBy: null,
    scartataMotivo: null,
    now,
  });

  return { estrazione: creata, riusata: false };
}

export async function applicaEstrazione(
  input: {
    sedeId: number;
    commessaId: number;
    estrazioneId: number;
    contratto: ContrattoInput;
    righe: RigaContrattoInput[];
    actorUserId: number | null;
    /** Nome di chi applica: firma le milestone che la board porta avanti (P3-R19). */
    actorNome?: string | null;
  } & DipendenzeEstrazione
): Promise<{ contratto: Contratto; righe: RigaContratto[]; avvertenze: string[] }> {
  const repo = repoDi(input);
  const now = oraDi(input);

  const estrazione = await repo.perId(input.sedeId, input.estrazioneId);
  if (!estrazione || estrazione.commessaId !== input.commessaId) {
    throw new Error("NOT_FOUND: Estrazione non trovata.");
  }
  assicuraStatoProposta(estrazione);

  // origine/documentoId/estrazioneId sono un fatto della proposta, non
  // un'opinione del client: si forzano qui, indipendentemente da cosa
  // arriva nell'input. L'evidenza delle righe arriva invece dal client
  // (copiata dalla proposta che l'operatore ha confermato): questo
  // servizio non la ricalcola.
  const contrattoForzato: ContrattoInput = {
    ...input.contratto,
    origine: "estrazione",
    documentoId: estrazione.documentoId,
    estrazioneId: estrazione.id,
  };
  const righeForzate: RigaContrattoInput[] = input.righe.map(r => ({ ...r, origine: "estrazione" as const }));

  const esito = await salvaContratto({
    sedeId: input.sedeId,
    commessaId: input.commessaId,
    contratto: contrattoForzato,
    righe: righeForzate,
    actorUserId: input.actorUserId,
    now,
  });

  // P3-R21: il contratto è già scritto (sopra, unico percorso di
  // scrittura). Da qui in poi un errore non deve nascondere un salvataggio
  // riuscito: diventa un'avvertenza, stesso principio dello specchio del
  // pattuito in server/contratti/servizio.ts (~r. 296-306) — niente
  // rollback cross-store, il contratto resta la fonte di verità.
  try {
    await repo.aggiornaStato({
      sedeId: input.sedeId,
      id: estrazione.id,
      stato: "applicata",
      applicataBy: input.actorUserId,
      now,
    });
  } catch {
    esito.avvertenze.push("Contratto salvato, ma lo stato dell'estrazione non è stato aggiornato: riprova «Applica».");
  }

  try {
    const commessa: any = getCommessaById(input.commessaId);
    if (commessa) {
      allineaTimelineAlBoard(input.commessaId, commessa.stato, input.actorNome ?? null);
    }
  } catch {
    esito.avvertenze.push("Contratto salvato, ma la timeline non è stata aggiornata: verifica lo stato della commessa a mano.");
  }

  return esito;
}

/**
 * P3-R37: lo scarto è vincolato alla commessa esattamente come
 * l'applicazione. La sede la garantiva già il repository (`perId(sedeId,
 * id)`), ma dentro la stessa sede l'id di un'estrazione di un'altra commessa
 * era scartabile: un id indovinato bastava a togliere di mezzo la proposta di
 * un'altra commessa. Commessa che non corrisponde → NOT_FOUND, senza dire se
 * quell'id esista.
 */
export async function scartaEstrazione(
  input: {
    sedeId: number;
    commessaId: number;
    estrazioneId: number;
    motivo: string | null;
    actorUserId: number | null;
  } & DipendenzeEstrazione
): Promise<EstrazioneContratto> {
  const repo = repoDi(input);
  const now = oraDi(input);

  const estrazione = await repo.perId(input.sedeId, input.estrazioneId);
  if (!estrazione || estrazione.commessaId !== input.commessaId) {
    throw new Error("NOT_FOUND: Estrazione non trovata.");
  }
  assicuraStatoProposta(estrazione);

  return repo.aggiornaStato({
    sedeId: input.sedeId,
    id: estrazione.id,
    stato: "scartata",
    scartataMotivo: input.motivo,
    now,
  });
}

export async function ultimaEstrazione(
  sedeId: number,
  commessaId: number,
  documentoId: number,
  dip: DipendenzeEstrazione = {}
): Promise<EstrazioneContratto | null> {
  const repo = repoDi(dip);
  const trovata = await repo.ultimaPerDocumento(sedeId, documentoId);
  if (!trovata || trovata.commessaId !== commessaId) return null;
  return trovata;
}
