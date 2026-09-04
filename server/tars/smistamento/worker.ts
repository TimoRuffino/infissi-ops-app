// Worker dello smistamento (02/09/2026): ogni minuto, per ogni sede
// attiva, prende le comunicazioni in ingresso non ancora smistate
// (recenti prima), le capisce e applica gli effetti deterministici.
// Fail-closed: flag, storage autorevole, provider governato. Un errore
// su una comunicazione viene registrato e non ferma le altre.

import { getSediStore } from "../../routers/sedi";
import { getClientiStore } from "../../routers/clienti";
import { getCommesseStore } from "../../routers/commesse";
import { getUtentiStore } from "../../routers/utenti";
import { caselle } from "../../comunicazioni/caselle";
import {
  cercaFiloCollegato,
  getLiveComunicazione,
  type Comunicazione,
} from "../../comunicazioni/comunicazioni";
import { leggiAllegatoRaw } from "../../comunicazioni/allegati";
import { classificaComunicazione } from "../../comunicazioni/filtroComunicazioni";
import { giorniProposte } from "./applica";
import { estraiTestoDocumento } from "../../documenti/parserRegistry";
import { tarsAttivo } from "../../platform/interruttori";
import { creaProviderPerRun, statoProvider } from "../costi/providerGovernato";
import type { TarsProvider } from "../provider";
import {
  analisiDeterministica,
  analizzaConModello,
  modelloSmistamento,
  type AllegatoPerAnalisi,
  type EsitoAnalisi,
} from "./analisi";
import { applicaSmistamento, type DipendenzeApplica } from "./applica";
import { generaCandidati, type EsitoCandidati } from "./candidati";
import { nomeDaConferma } from "../documenti/confermeMancanti";
import {
  creaLettoreCommessaNelDocumento,
  type CommessaRicercabile,
  type LettoreCommessaNelDocumento,
} from "../documenti/ricercaCommessaNelDocumento";
import type { CandidatoCollegamento } from "./types";
import {
  repositorySmistamentoAutorevoleDisponibile,
  repositorySmistamentoCorrente,
  type RepositorySmistamento,
} from "./repository";
import { VERSIONE_SMISTAMENTO } from "./types";

const INTERVALLO_MS = 60_000;
const RITARDO_BOOT_MS = 20_000;
// 10 al minuto: il flusso quotidiano (~60 in ingresso) si smaltisce in
// pochi minuti; l'arretrato di 90 giorni (~3.000) in una notte. Un giro
// che sfora il minuto non si sovrappone al successivo (guardia inCorso).
const LOTTO_PER_GIRO = 10;
/**
 * Oltre questa età si smista senza modello (D5). Era 90: il primo giorno
 * l'arretrato ha bruciato ~2.900 chiamate (27 USD) per email vecchie di
 * mesi. Ora 14 giorni, regolabile con TARS_SMISTAMENTO_GIORNI_MODELLO.
 */
export function giorniConModello(): number {
  const n = Number.parseInt(process.env.TARS_SMISTAMENTO_GIORNI_MODELLO ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : 14;
}
/** Oltre questa età non si smista affatto: storia, non lavoro. */
const GIORNI_MASSIMI = 365;
const FILO_GIORNI = 45;
const UTENTE_SISTEMA = 0;

export function smistamentoAttivo(): boolean {
  return (
    tarsAttivo("tarsSmistamento") &&
    tarsAttivo("tarsCommunications") &&
    tarsAttivo("tarsProactive") &&
    repositorySmistamentoAutorevoleDisponibile()
  );
}

const MIME_CON_TESTO = /pdf|msword|officedocument|text\/plain/i;
const ALLEGATI_CON_TESTO = 1;
const TESTO_ALLEGATO = 1_500;

export type DipendenzeWorker = {
  repository: RepositorySmistamento;
  provider: (sedeId: number) => TarsProvider | null;
  modello: string;
  filo: typeof cercaFiloCollegato;
  leggiRaw: typeof leggiAllegatoRaw;
  estraiTesto: typeof estraiTestoDocumento;
  applica?: DipendenzeApplica;
  /**
   * Cerca la commessa DENTRO una conferma d'ordine allegata (04/09/2026:
   * il fornitore scrive «PAIL_2634169 RUFFINO» nella mail e il cliente
   * solo nel PDF). Opzionale: senza, valgono solo i candidati della mail.
   */
  cercaCommessaNelDocumento?: LettoreCommessaNelDocumento;
  now: () => Date;
};

/**
 * Dipendenze di produzione: usate dal worker e dal «riesamina»
 * dell'operatore. Con un'identità, le scansioni delle conferme le legge il
 * modello a nome di chi chiede (o della sede, per il worker).
 */
export function dipendenzeSmistamentoReali(opzioni?: {
  visione?: { sedeId: number; utenteId: number } | null;
}): DipendenzeWorker {
  const base = dipendenzeReali();
  if (!opzioni?.visione) return base;
  return {
    ...base,
    cercaCommessaNelDocumento: creaLettoreCommessaNelDocumento({
      visione: opzioni.visione,
      massimoLetture: LOTTO_PER_GIRO,
    }),
  };
}

function dipendenzeReali(): DipendenzeWorker {
  const modello = modelloSmistamento();
  return {
    repository: repositorySmistamentoCorrente(),
    provider: sedeId => {
      // Provider reale governato (classe smistamento) o niente: il finto
      // non capisce nulla e in produzione sarebbe rumore.
      if (statoProvider(modello).tipo !== "openai") return null;
      return creaProviderPerRun({
        modello,
        sedeId,
        utenteId: UTENTE_SISTEMA,
        copioneFinto: () => ({
          tipo: "messaggio",
          testo: "{}",
          uso: { input: 0, output: 0, cachedInput: 0, cacheWrite: 0 },
        }),
        classe: "smistamento",
      });
    },
    modello,
    filo: cercaFiloCollegato,
    leggiRaw: leggiAllegatoRaw,
    estraiTesto: estraiTestoDocumento,
    // Un lettore per giro: al massimo un file nuovo per comunicazione del
    // lotto, scansioni trascritte dal modello con l'utente di sistema.
    cercaCommessaNelDocumento: creaLettoreCommessaNelDocumento({
      visione: null,
      massimoLetture: LOTTO_PER_GIRO,
    }),
    now: () => new Date(),
  };
}

/**
 * Il lettore di produzione paga le letture visive per sede: si crea con
 * l'identità della sede al momento dello smistamento.
 */
function lettoreConVisione(sedeId: number): LettoreCommessaNelDocumento {
  return creaLettoreCommessaNelDocumento({
    visione: { sedeId, utenteId: UTENTE_SISTEMA },
    massimoLetture: LOTTO_PER_GIRO,
  });
}

/** Punteggio di un candidato trovato nel testo del file. */
const PUNTI_TESTO_FORTE = 70;
const PUNTI_TESTO_DEBOLE = 45;
const MASSIMO_CANDIDATI = 8;

/**
 * I candidati che nascono DENTRO gli allegati «da conferma»: il testo del
 * PDF letto contro le commesse vive della sede. Un riscontro unico è un
 * verdetto certo (come il codice nella mail); più riscontri sono candidati
 * con punteggio, e li giudica il modello. Restituisce anche le pagine
 * lette, così l'archiviazione non rilegge il file.
 */
export async function candidatiDagliAllegati(input: {
  comunicazione: Comunicazione;
  candidati: EsitoCandidati;
  commesse: readonly CommessaRicercabile[];
  cerca: LettoreCommessaNelDocumento;
  leggiRaw: typeof leggiAllegatoRaw;
}): Promise<{ candidati: EsitoCandidati; letture: Map<number, string[]> }> {
  const letture = new Map<number, string[]>();
  const { comunicazione } = input;
  if (input.candidati.certo || comunicazione.commessaId != null) {
    return { candidati: input.candidati, letture };
  }
  const commesse = input.commesse.filter(c => !c.archivedAt && c.stato !== "archiviata");
  const perId = new Map(commesse.map(c => [c.id, c] as const));
  const lista: CandidatoCollegamento[] = input.candidati.candidati.map(c => ({ ...c, motivi: [...c.motivi] }));
  const aggiungi = (commessaId: number, punti: number, motivo: string) => {
    const commessa = perId.get(commessaId);
    if (!commessa) return;
    const voce = lista.find(c => c.tipo === "commessa" && c.id === commessaId);
    if (voce) {
      voce.punteggio = Math.min(100, voce.punteggio + punti);
      if (!voce.motivi.includes(motivo)) voce.motivi.push(motivo);
      return;
    }
    lista.push({
      tipo: "commessa",
      id: commessaId,
      etichetta: `${commessa.codice ?? commessaId} — ${commessa.cliente ?? "cliente"}`,
      punteggio: Math.min(100, punti),
      motivi: [motivo],
    });
  };

  for (const [indice, allegato] of comunicazione.allegati.entries()) {
    if (!nomeDaConferma(allegato.nome, allegato.mimeType)) continue;
    let ricerca;
    try {
      ricerca = await input.cerca(
        {
          sedeId: comunicazione.sedeId,
          comunicazioneId: comunicazione.id,
          allegatoIndex: indice,
          leggi: () => input.leggiRaw(comunicazione, indice),
        },
        commesse
      );
    } catch {
      continue;
    }
    if (ricerca.pagine) letture.set(indice, ricerca.pagine);
    if (ricerca.esito === "unica" && ricerca.commessaId != null) {
      const commessa = perId.get(ricerca.commessaId)!;
      const motivo = `La conferma «${allegato.nome}» cita ${ricerca.candidati.find(c => c.commessaId === ricerca.commessaId)?.prove.join(", ") ?? "la commessa"}: candidato unico fra le commesse vive.`;
      return {
        candidati: {
          certo: { commessaId: commessa.id, clienteId: commessa.clienteId ?? null, motivo },
          candidati: [
            {
              tipo: "commessa",
              id: commessa.id,
              etichetta: `${commessa.codice ?? commessa.id} — ${commessa.cliente ?? "cliente"}`,
              punteggio: 100,
              motivi: [motivo],
            },
          ],
          segnali: input.candidati.segnali,
        },
        letture,
      };
    }
    for (const c of ricerca.candidati) {
      aggiungi(
        c.commessaId,
        c.forza === "forte" ? PUNTI_TESTO_FORTE : PUNTI_TESTO_DEBOLE,
        `Il testo del file «${allegato.nome}» cita ${c.prove.join(", ")}.`
      );
    }
  }
  lista.sort((a, b) => b.punteggio - a.punteggio || (a.tipo === "commessa" ? -1 : 1) - (b.tipo === "commessa" ? -1 : 1) || a.id - b.id);
  return {
    candidati: { ...input.candidati, candidati: lista.slice(0, MASSIMO_CANDIDATI) },
    letture,
  };
}

function contestoSede(sedeId: number) {
  const utenti = (getUtentiStore() as any[]).filter(u => u.attivo !== false);
  const indirizziInterni = new Set<string>();
  for (const c of caselle as any[]) {
    if (c.sedeId === sedeId && c.indirizzo) {
      indirizziInterni.add(String(c.indirizzo).toLowerCase());
    }
  }
  for (const u of utenti) {
    if (u.email) indirizziInterni.add(String(u.email).toLowerCase());
  }
  // Cognomi E nomi del personale: l'azienda censita come cliente («Ruffino
  // Timothy», «Ruffino Group») non deve mai diventare un candidato.
  const cognomiInterni = new Set<string>(
    utenti
      .flatMap(u => [u.cognome, u.nome])
      .map(v => String(v ?? "").trim().toLowerCase())
      .filter(v => v.length >= 3)
  );
  return {
    clienti: (getClientiStore() as any[]).filter(c => c.sedeId === sedeId),
    commesse: (getCommesseStore() as any[]).filter(c => c.sedeId === sedeId),
    indirizziInterni,
    cognomiInterni,
  };
}

async function allegatiPerAnalisi(
  comunicazione: Comunicazione,
  deps: Pick<DipendenzeWorker, "leggiRaw" | "estraiTesto">
): Promise<AllegatoPerAnalisi[]> {
  const esiti: AllegatoPerAnalisi[] = [];
  let conTesto = 0;
  for (const [indice, a] of comunicazione.allegati.entries()) {
    const base = {
      indice,
      nome: a.nome,
      mimeType: a.mimeType,
      size: a.size ?? 0,
    };
    if (/^image\//i.test(a.mimeType)) {
      esiti.push({ ...base, testo: null, stato: "immagine" });
      continue;
    }
    if (!MIME_CON_TESTO.test(a.mimeType) || conTesto >= ALLEGATI_CON_TESTO) {
      esiti.push({ ...base, testo: null, stato: "non_letto" });
      continue;
    }
    try {
      const raw = await deps.leggiRaw(comunicazione, indice);
      const estratto = await deps.estraiTesto(raw.buffer, raw.mimeType, raw.nome, { ocr: false });
      if (estratto.esito === "estratto") {
        const testo = estratto.pagine.join("\n").replace(/\s+/g, " ").trim().slice(0, TESTO_ALLEGATO);
        esiti.push({ ...base, size: raw.buffer.length, testo: testo || null, stato: testo ? "testo" : "non_letto" });
        conTesto += 1;
      } else {
        esiti.push({ ...base, testo: null, stato: "non_letto" });
      }
    } catch {
      esiti.push({ ...base, testo: null, stato: "non_letto" });
    }
  }
  return esiti;
}

export type EsitoGiro = {
  sedeId: number;
  esaminate: number;
  /** Proposte aperte chiuse come scadute in questo giro. */
  scadute: number;
  analizzate: number;
  conModello: number;
  collegateCerte: number;
  proposte: number;
  archiviati: number;
  errori: number;
};

/**
 * Smista UNA comunicazione: candidati → allegati → analisi → effetti →
 * registro. Esportata per i test e per il «riesamina» dell'operatore.
 */
export async function smistaComunicazione(input: {
  comunicazione: Comunicazione;
  deps: DipendenzeWorker;
  tentativo: number;
}): Promise<{ candidati: EsitoCandidati; analisi: EsitoAnalisi; propostaStato: string; archiviati: number; conModello: boolean }> {
  const { comunicazione, deps } = input;
  const now = deps.now();
  const sede = contestoSede(comunicazione.sedeId);
  const filoCollegato = await deps.filo({
    sedeId: comunicazione.sedeId,
    canale: comunicazione.canale,
    casellaId: comunicazione.casellaId,
    controparte: comunicazione.mittente,
    oggetto: comunicazione.oggetto,
    primaDi: comunicazione.receivedAt,
    finestraGiorni: FILO_GIORNI,
    escludiId: comunicazione.id,
  });
  let candidati = generaCandidati({
    comunicazione,
    clienti: sede.clienti,
    commesse: sede.commesse,
    indirizziInterni: sede.indirizziInterni,
    cognomiInterni: sede.cognomiInterni,
    filoCollegato,
  });
  // La mail non dice di chi è, ma la conferma allegata sì: si legge dentro.
  let letture = new Map<number, string[]>();
  const cerca = deps.cercaCommessaNelDocumento;
  if (cerca && !candidati.certo && comunicazione.commessaId == null) {
    const arricchiti = await candidatiDagliAllegati({
      comunicazione,
      candidati,
      commesse: sede.commesse,
      cerca,
      leggiRaw: deps.leggiRaw,
    });
    candidati = arricchiti.candidati;
    letture = arricchiti.letture;
  }
  const allegati = await allegatiPerAnalisi(comunicazione, deps);
  const contestoCandidati = new Map(
    candidati.candidati
      .filter(c => c.tipo === "commessa")
      .map(c => {
        const commessa = sede.commesse.find((x: any) => x.id === c.id);
        return [c.id, { stato: String(commessa?.stato ?? "-"), cliente: String(commessa?.cliente ?? "-") }] as const;
      })
  );
  const etaGiorni = (now.getTime() - comunicazione.receivedAt.getTime()) / 86_400_000;
  // Spam e marketing evidenti senza alcun candidato: il filtro basta, il
  // modello non aggiungerebbe nulla (e costava quanto una mail vera).
  const filtro = classificaComunicazione({
    sedeId: comunicazione.sedeId,
    mittente: comunicazione.mittente,
    oggetto: comunicazione.oggetto,
    testo: comunicazione.testo,
    allegati: comunicazione.allegati,
    clienteId: comunicazione.clienteId,
    commessaId: comunicazione.commessaId,
  });
  const rumore =
    (filtro.categoria === "spam" || filtro.categoria === "offerta_marketing") &&
    filtro.score >= 80 &&
    !candidati.certo &&
    candidati.candidati.length === 0;
  const provider =
    !rumore && etaGiorni <= giorniConModello() ? deps.provider(comunicazione.sedeId) : null;
  const inputAnalisi = { comunicazione, candidati: candidati.candidati, segnali: candidati.segnali, allegati, contestoCandidati };
  let analisi: EsitoAnalisi;
  if (provider) {
    analisi = await analizzaConModello({
      ...inputAnalisi,
      provider,
      modello: deps.modello,
      identita: {
        runId: `smistamento:${comunicazione.sedeId}:${comunicazione.id}`,
        passo: 0,
        tentativo: input.tentativo,
        conversazioneId: null,
      },
    });
  } else {
    analisi = analisiDeterministica(inputAnalisi);
  }
  const applicato = await applicaSmistamento({
    comunicazione,
    candidati,
    analisi,
    allegati,
    deps: deps.applica,
    adesso: now,
    letture,
    // Una conferma scansionata si verifica con OCR e, se serve, col modello
    // (utente di sistema): la scansione non ferma la conferma.
    lettura: { visione: { sedeId: comunicazione.sedeId, utenteId: UTENTE_SISTEMA } },
  });
  await deps.repository.registra({
    comunicazioneId: comunicazione.id,
    sedeId: comunicazione.sedeId,
    versione: VERSIONE_SMISTAMENTO,
    stato: "analizzata",
    esito: applicato.esito,
    propostaStato: applicato.propostaStato,
    ultimoErrore: null,
    now,
  });
  return {
    candidati,
    analisi,
    propostaStato: applicato.propostaStato,
    archiviati: applicato.esito.archiviati.length,
    conModello: Boolean(provider),
  };
}

export async function eseguiGiroSmistamento(input: {
  sedeId: number;
  deps?: DipendenzeWorker;
  limite?: number;
}): Promise<EsitoGiro> {
  const deps = input.deps ?? {
    ...dipendenzeReali(),
    cercaCommessaNelDocumento: lettoreConVisione(input.sedeId),
  };
  const now = deps.now();
  const esito: EsitoGiro = {
    sedeId: input.sedeId,
    esaminate: 0,
    analizzate: 0,
    conModello: 0,
    collegateCerte: 0,
    proposte: 0,
    archiviati: 0,
    errori: 0,
    scadute: 0,
  };
  const daRicevutaAl = new Date(now.getTime() - GIORNI_MASSIMI * 86_400_000);
  const limite = input.limite ?? LOTTO_PER_GIRO;
  // Manutenzione: le proposte aperte su mail invecchiate, già gestite o
  // collegate a mano scadono da sole — nessuno deve decidere su roba morta.
  const limiteProposte = new Date(now.getTime() - giorniProposte() * 86_400_000);
  for (const record of await deps.repository.proposteAperte(input.sedeId, 200)) {
    const c = await getLiveComunicazione(record.comunicazioneId, input.sedeId);
    const morta = !c || new Date(c.receivedAt) < limiteProposte || c.stato === "gestita" || c.commessaId != null;
    if (!morta) continue;
    await deps.repository.decidiProposta({
      sedeId: input.sedeId,
      comunicazioneId: record.comunicazioneId,
      stato: "scaduta",
      utenteId: null,
      now,
    });
    esito.scadute += 1;
  }
  // Prima le proposte aperte di una versione precedente: un errore
  // sistematico corretto nel codice non deve restare in coda a chi
  // decide. Poi le comunicazioni mai smistate, recenti prima.
  const daRiesaminare = await deps.repository.proposteAperteDaRiesaminare({
    sedeId: input.sedeId,
    versioneCorrente: VERSIONE_SMISTAMENTO,
    limite,
  });
  const riesami: Comunicazione[] = [];
  for (const record of daRiesaminare) {
    const c = await getLiveComunicazione(record.comunicazioneId, input.sedeId);
    if (c) riesami.push(c);
  }
  const prossime = [
    ...riesami,
    ...(await deps.repository.prossime({
      sedeId: input.sedeId,
      daRicevutaAl,
      limite: Math.max(0, limite - riesami.length),
    })),
  ];
  for (const comunicazione of prossime) {
    esito.esaminate += 1;
    const precedente = await deps.repository.perComunicazione(input.sedeId, comunicazione.id);
    try {
      const fatto = await smistaComunicazione({
        comunicazione,
        deps,
        tentativo: (precedente?.tentativi ?? 0) + 1,
      });
      esito.analizzate += 1;
      if (fatto.conModello) esito.conModello += 1;
      if (fatto.candidati.certo) esito.collegateCerte += 1;
      if (fatto.propostaStato === "aperta") esito.proposte += 1;
      esito.archiviati += fatto.archiviati;
    } catch (errore) {
      esito.errori += 1;
      await deps.repository
        .registra({
          comunicazioneId: comunicazione.id,
          sedeId: comunicazione.sedeId,
          versione: VERSIONE_SMISTAMENTO,
          stato: "errore",
          esito: null,
          propostaStato: "nessuna",
          ultimoErrore: errore instanceof Error ? errore.message.slice(0, 300) : "errore",
          now,
        })
        .catch(() => undefined);
    }
  }
  return esito;
}

const inCorso = new Set<number>();

async function giroTutteLeSedi(): Promise<void> {
  if (!smistamentoAttivo()) return;
  for (const sede of getSediStore()) {
    if (!sede.attiva || inCorso.has(sede.id)) continue;
    inCorso.add(sede.id);
    try {
      const esito = await eseguiGiroSmistamento({ sedeId: sede.id });
      if (esito.esaminate > 0) console.info("[tars-smistamento]", esito);
    } catch (errore) {
      console.error("[tars-smistamento] giro fallito", {
        sedeId: sede.id,
        message: errore instanceof Error ? errore.message : "unknown",
      });
    } finally {
      inCorso.delete(sede.id);
    }
  }
}

export function startSmistamentoWorker(): void {
  if (!smistamentoAttivo()) {
    console.info("[tars-smistamento] spento (flag o storage)");
    return;
  }
  const boot = setTimeout(() => void giroTutteLeSedi(), RITARDO_BOOT_MS);
  boot.unref?.();
  const timer = setInterval(() => void giroTutteLeSedi(), INTERVALLO_MS);
  timer.unref?.();
  console.info("[tars-smistamento] attivo", {
    modello: modelloSmistamento(),
    lotto: LOTTO_PER_GIRO,
    intervalloMs: INTERVALLO_MS,
  });
}
