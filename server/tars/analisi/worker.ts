// Worker dell'analisi azienda: una volta al giorno per sede (dalle 06:00
// ora di Roma), o su richiesta della direzione. Fail-closed: flag,
// provider governato; senza provider la sintesi è deterministica.

import { TZDate } from "@date-fns/tz";
import { tarsAttivo } from "../../platform/interruttori";
import { getSediStore } from "../../routers/sedi";
import { creaProviderPerRun, statoProvider } from "../costi/providerGovernato";
import type { TarsProvider } from "../provider";
import { analisiDeterministica, analizzaConModello, modelloAnalisi } from "./analisi";
import { costruisciFotografia, giornoLocale, type DipendenzeFotografia } from "./fotografia";
import { repositoryAnalisiCorrente, type RepositoryAnalisiAzienda } from "./repository";
import { VERSIONE_ANALISI_AZIENDA, type RecordAnalisiAzienda } from "./types";

/** Utente di sistema delle chiamate in background (stesso dello smistamento). */
const UTENTE_SISTEMA = 0;
const ORA_MINIMA_LOCALE = 6;
const INTERVALLO_MS = 5 * 60 * 1000;
/** Un'analisi in errore si ritenta da sola dopo mezz'ora, al massimo tre volte al giorno. */
export const RITENTO_ERRORE_MS = 30 * 60 * 1000;
export const TENTATIVI_MASSIMI = 3;

export type DipendenzeAnalisi = {
  repository: RepositoryAnalisiAzienda;
  provider: (sedeId: number) => TarsProvider | null;
  modello: string;
  fotografia?: DipendenzeFotografia;
  sedi: () => number[];
  now: () => Date;
};

export function analisiAziendaAttiva(): boolean {
  return tarsAttivo("tarsProactive") && tarsAttivo("tarsAnalisiAzienda");
}

export function dipendenzeAnalisiReali(): DipendenzeAnalisi {
  const modello = modelloAnalisi();
  return {
    repository: repositoryAnalisiCorrente(),
    provider: sedeId => {
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
        classe: "analisi_azienda",
      });
    },
    modello,
    sedi: () => getSediStore().map(s => s.id),
    now: () => new Date(),
  };
}

/** Genera (o rigenera) l'analisi di oggi per la sede e la salva. Non lancia: registra l'errore. */
export async function generaAnalisiAzienda(input: {
  sedeId: number;
  richiestaDa: number | null;
  deps?: DipendenzeAnalisi;
}): Promise<RecordAnalisiAzienda> {
  const deps = input.deps ?? dipendenzeAnalisiReali();
  const adesso = deps.now();
  const giorno = giornoLocale(adesso);
  try {
    const fotografia = await costruisciFotografia({
      sedeId: input.sedeId,
      adesso,
      deps: deps.fotografia,
    });
    // Le proposte già scartate oggi dalla direzione entrano nella fotografia
    // come fatto: il modello non le ripropone, nemmeno riformulate (04/09:
    // «le proposte di Tars sono inutili, se le rifiuto rimangono lì»).
    const precedente = await deps.repository.perGiorno(input.sedeId, giorno);
    const scartate = (precedente?.esito?.proposte ?? []).filter(
      p => p.esecuzione?.stato === "scartata"
    );
    if (scartate.length > 0) {
      fotografia.sezioni.push({
        chiave: "proposte_scartate",
        titolo: "Proposte già scartate oggi dalla direzione (NON riproporle, nemmeno riformulate)",
        fatti: scartate.slice(0, 12).map((p, i) => ({
          chiave: `scartata:${i}`,
          testo: p.testo,
          entita: [],
          link: null,
        })),
      });
    }
    const provider = deps.provider(input.sedeId);
    const esito = provider
      ? await analizzaConModello({
          fotografia,
          provider,
          modello: deps.modello,
          identita: {
            runId: `analisi:${input.sedeId}:${giorno}:${adesso.getTime()}`,
            passo: 0,
            tentativo: 1,
            conversazioneId: null,
          },
        })
      : analisiDeterministica(fotografia);
    return await deps.repository.salva({
      sedeId: input.sedeId,
      giorno,
      versione: VERSIONE_ANALISI_AZIENDA,
      stato: "pronta",
      esito,
      errore: null,
      richiestaDa: input.richiestaDa,
      now: adesso,
    });
  } catch (errore) {
    const messaggio = errore instanceof Error ? errore.message.slice(0, 300) : "errore";
    console.error(`[tars.analisi] sede ${input.sedeId}: ${messaggio}`);
    return await deps.repository.salva({
      sedeId: input.sedeId,
      giorno,
      versione: VERSIONE_ANALISI_AZIENDA,
      stato: "errore",
      esito: null,
      errore: messaggio,
      richiestaDa: input.richiestaDa,
      now: adesso,
    });
  }
}

/** Dopo tante ore l'analisi di oggi è vecchia: si rifà (direzione 04/09: «non ne ho più ricevute di nuove»). */
export const RIGENERA_DOPO_MS = 4 * 60 * 60 * 1000;
/** Se tutte le proposte sono state gestite (eseguite o scartate), la prossima arriva dopo mezz'ora. */
export const RIGENERA_SE_GESTITE_DOPO_MS = 30 * 60 * 1000;

/**
 * L'analisi di oggi va rifatta? Sì se è in errore ritentabile, se è
 * vecchia di più di quattro ore, o se ogni sua proposta è già stata
 * gestita da almeno mezz'ora: una lista di proposte scartate non è lavoro,
 * e senza rigenerazione la direzione non ne riceveva più fino al giorno
 * dopo (04/09/2026: «se le rifiuto rimangono lì e non ne ho più ricevute
 * di nuove»).
 */
export function analisiDaRifare(esistente: RecordAnalisiAzienda, adesso: Date): boolean {
  const eta = adesso.getTime() - esistente.generataAt.getTime();
  if (esistente.stato === "errore") {
    return esistente.tentativi < TENTATIVI_MASSIMI && eta >= RITENTO_ERRORE_MS;
  }
  if (eta >= RIGENERA_DOPO_MS) return true;
  const proposte = esistente.esito?.proposte ?? [];
  const tutteGestite = proposte.length > 0 && proposte.every(p => p.esecuzione != null);
  return tutteGestite && eta >= RIGENERA_SE_GESTITE_DOPO_MS;
}

/** Un giro: per ogni sede, se manca l'analisi di oggi (o va rifatta) ed è passata l'ora minima, la genera. */
export async function giroAnalisi(deps: DipendenzeAnalisi): Promise<{ generate: number[]; saltate: number[] }> {
  const adesso = deps.now();
  const locale = new TZDate(adesso, "Europe/Rome");
  const generate: number[] = [];
  const saltate: number[] = [];
  if (locale.getHours() < ORA_MINIMA_LOCALE) return { generate, saltate: deps.sedi() };
  const giorno = giornoLocale(adesso);
  for (const sedeId of deps.sedi()) {
    const esistente = await deps.repository.perGiorno(sedeId, giorno);
    if (esistente && !analisiDaRifare(esistente, adesso)) {
      saltate.push(sedeId);
      continue;
    }
    await generaAnalisiAzienda({ sedeId, richiestaDa: null, deps });
    generate.push(sedeId);
  }
  return { generate, saltate };
}

let timer: NodeJS.Timeout | null = null;
let inCorso = false;

export function startAnalisiAziendaWorker(): void {
  if (timer) return;
  const tick = async () => {
    if (inCorso || !analisiAziendaAttiva()) return;
    inCorso = true;
    try {
      await giroAnalisi(dipendenzeAnalisiReali());
    } catch (errore) {
      console.error("[tars.analisi] giro fallito:", errore instanceof Error ? errore.message : errore);
    } finally {
      inCorso = false;
    }
  };
  timer = setInterval(() => void tick(), INTERVALLO_MS);
  timer.unref?.();
  setTimeout(() => void tick(), 20_000).unref?.();
}

export function stopAnalisiAziendaWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
