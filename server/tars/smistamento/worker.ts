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
/** Oltre questa età si smista senza modello (D5). */
const GIORNI_CON_MODELLO = 90;
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
const ALLEGATI_CON_TESTO = 2;
const TESTO_ALLEGATO = 2_500;

export type DipendenzeWorker = {
  repository: RepositorySmistamento;
  provider: (sedeId: number) => TarsProvider | null;
  modello: string;
  filo: typeof cercaFiloCollegato;
  leggiRaw: typeof leggiAllegatoRaw;
  estraiTesto: typeof estraiTestoDocumento;
  applica?: DipendenzeApplica;
  now: () => Date;
};

/** Dipendenze di produzione: usate dal worker e dal «riesamina» dell'operatore. */
export function dipendenzeSmistamentoReali(): DipendenzeWorker {
  return dipendenzeReali();
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
    now: () => new Date(),
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
  const candidati = generaCandidati({
    comunicazione,
    clienti: sede.clienti,
    commesse: sede.commesse,
    indirizziInterni: sede.indirizziInterni,
    cognomiInterni: sede.cognomiInterni,
    filoCollegato,
  });
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
  const provider = etaGiorni <= GIORNI_CON_MODELLO ? deps.provider(comunicazione.sedeId) : null;
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
  const deps = input.deps ?? dipendenzeReali();
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
  };
  const daRicevutaAl = new Date(now.getTime() - GIORNI_MASSIMI * 86_400_000);
  const limite = input.limite ?? LOTTO_PER_GIRO;
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
