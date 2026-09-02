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

/** Un giro: per ogni sede, se manca l'analisi di oggi ed è passata l'ora minima, la genera. */
export async function giroAnalisi(deps: DipendenzeAnalisi): Promise<{ generate: number[]; saltate: number[] }> {
  const adesso = deps.now();
  const locale = new TZDate(adesso, "Europe/Rome");
  const generate: number[] = [];
  const saltate: number[] = [];
  if (locale.getHours() < ORA_MINIMA_LOCALE) return { generate, saltate: deps.sedi() };
  const giorno = giornoLocale(adesso);
  for (const sedeId of deps.sedi()) {
    const esistente = await deps.repository.perGiorno(sedeId, giorno);
    // Pronta: fatta. In errore: si ritenta dopo mezz'ora, al massimo tre
    // volte; oltre, resta alla direzione rigenerare a mano.
    if (esistente) {
      const ritentabile =
        esistente.stato === "errore" &&
        esistente.tentativi < TENTATIVI_MASSIMI &&
        adesso.getTime() - esistente.generataAt.getTime() >= RITENTO_ERRORE_MS;
      if (!ritentabile) {
        saltate.push(sedeId);
        continue;
      }
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
